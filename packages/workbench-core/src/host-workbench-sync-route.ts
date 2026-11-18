import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import type { HostConnectionHandle } from '@deepseek-ai/dsh-client-connection'
import type { HostWorkbenchAccess } from './host-workbench-access.ts'
import type { HostWorkbenchDirectory } from './host-workbench-directory.ts'
import { atomicJson } from './host-workbench-directory.ts'
import { buildExport } from './host-workbench-bundle-route.ts'
import { createWorkbenchSnapshot } from './workbench-snapshot.ts'
import { syncWorkbenchSnapshot, type WorkbenchSyncResult } from './workbench-sync.ts'
import { FolderWorkbenchSyncProvider, WebDavWorkbenchSyncProvider, type WorkbenchSyncProvider } from './workbench-sync-provider.ts'
import { WorkbenchSyncScheduler } from './workbench-sync-scheduler.ts'
import {
  DEFAULT_WORKBENCH_SYNC_CONFIG,
  WORKBENCH_SYNC_ROUTE,
  normalizeWorkbenchSyncConfig,
  type WorkbenchSyncConfigV1,
  type WorkbenchSyncResponseV1,
  type WorkbenchSyncSettingsV1,
  type WorkbenchSyncStateV1,
} from './workbench-sync-contract.ts'
import type { WorkbenchSessionCheckpointSource } from './workbench-session-checkpoint.ts'

interface SyncRouteOptions {
  directory: HostWorkbenchDirectory
  checkpoint?: WorkbenchSessionCheckpointSource
  access?: HostWorkbenchAccess
}

const configPath = (directory: HostWorkbenchDirectory, workbenchId: string) => path.join(directory.rootPath(workbenchId), '.dshbay', 'sync.json')

function defaultSettings(): WorkbenchSyncSettingsV1 {
  return { schemaVersion: 1, config: { ...DEFAULT_WORKBENCH_SYNC_CONFIG }, state: { status: 'local', updatedAt: Date.now() } }
}

async function readSettings(directory: HostWorkbenchDirectory, workbenchId: string): Promise<WorkbenchSyncSettingsV1> {
  try {
    const raw = JSON.parse(await readFile(configPath(directory, workbenchId), 'utf8')) as Partial<WorkbenchSyncSettingsV1>
    const config = normalizeWorkbenchSyncConfig(raw.config)
    const state = raw.state && typeof raw.state === 'object' ? raw.state as WorkbenchSyncStateV1 : { status: 'local' as const, updatedAt: Date.now() }
    return { schemaVersion: 1, config, state: { ...state, updatedAt: typeof state.updatedAt === 'number' ? state.updatedAt : Date.now() } }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return defaultSettings()
    throw new Error(`invalid workbench sync settings: ${error instanceof Error ? error.message : String(error)}`)
  }
}

async function writeSettings(directory: HostWorkbenchDirectory, workbenchId: string, settings: WorkbenchSyncSettingsV1): Promise<void> {
  const file = configPath(directory, workbenchId)
  await mkdir(path.dirname(file), { recursive: true })
  atomicJson(file, settings)
}

function providerFor(config: WorkbenchSyncConfigV1, workbenchId: string): WorkbenchSyncProvider | undefined {
  if (config.provider === 'none') return undefined
  if (config.provider === 'folder') return new FolderWorkbenchSyncProvider(config.remote, workbenchId)
  return new WebDavWorkbenchSyncProvider(config.remote, workbenchId)
}

async function withParent(snapshot: Awaited<ReturnType<typeof buildExport>>['snapshot'], objects: Awaited<ReturnType<typeof buildExport>>['objects'], parentSnapshotId: string | undefined) {
  if (snapshot.parentSnapshotId === parentSnapshotId) return snapshot
  const byDigest = new Map(objects.map(object => [object.digest, object.content]))
  const entries = snapshot.entries.map(entry => {
    if (entry.deleted) return { path: entry.path, ...(entry.logicalId === undefined ? {} : { logicalId: entry.logicalId }), kind: entry.kind, deleted: true as const }
    const content = byDigest.get(entry.digest)
    if (content === undefined) throw new Error(`missing snapshot object: ${entry.path}`)
    return { path: entry.path, ...(entry.logicalId === undefined ? {} : { logicalId: entry.logicalId }), kind: entry.kind, content, ...(entry.chunks === undefined ? {} : { chunks: entry.chunks }) }
  })
  return (await createWorkbenchSnapshot({ kind: snapshot.kind, workbenchId: snapshot.workbenchId, ...(parentSnapshotId === undefined ? {} : { parentSnapshotId }), entries })).snapshot
}

function stateFromResult(result: WorkbenchSyncResult, previous: WorkbenchSyncStateV1): WorkbenchSyncStateV1 {
  const now = Date.now()
  const remoteSnapshotId = result.status === 'synced'
    ? result.commit?.snapshotId ?? result.remoteHead?.snapshotId
    : previous.remoteSnapshotId
  return {
    status: result.status,
    updatedAt: now,
    ...(result.localSnapshotId ? { localSnapshotId: result.localSnapshotId } : {}),
    ...(remoteSnapshotId === undefined ? {} : { remoteSnapshotId }),
    ...(result.status === 'synced' ? { lastSyncedAt: now } : previous.lastSyncedAt === undefined ? {} : { lastSyncedAt: previous.lastSyncedAt }),
    ...(result.status === 'offline' || result.status === 'conflict' ? { pendingSnapshotId: result.localSnapshotId } : {}),
    ...(result.error ? { error: result.error } : {}),
  }
}

export function installWorkbenchSyncRoute(connection: HostConnectionHandle, options: SyncRouteOptions): () => void {
  const { directory, access } = options
  const schedulers = new Map<string, WorkbenchSyncScheduler>()
  const actor = (request: Request) => access?.resolve(request.headers)
  const authorize = (request: Request, workbenchId: string, write = false) => {
    const current = actor(request)
    if (access && current) access.authorize(current, write ? 'layout' : 'view', { workbenchId })
  }
  const readJson = async (request: Request): Promise<Record<string, unknown>> => {
    const text = await request.text()
    if (text.length > 128 * 1024) throw new Error('sync request is too large')
    const value = JSON.parse(text) as unknown
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('sync request must be an object')
    return value as Record<string, unknown>
  }
  const response = (settings: WorkbenchSyncSettingsV1): Response => Response.json({ config: settings.config, state: settings.state } satisfies WorkbenchSyncResponseV1, { headers: { 'cache-control': 'no-store' } })
  const syncOne = async (workbenchId: string): Promise<WorkbenchSyncSettingsV1> => {
    const settings = await readSettings(directory, workbenchId)
    if (!settings.config.enabled || settings.config.provider === 'none') {
      const { error: _error, ...stateWithoutError } = settings.state
      const next: WorkbenchSyncSettingsV1 = { ...settings, state: { ...stateWithoutError, status: 'local', updatedAt: Date.now() } }
      await writeSettings(directory, workbenchId, next)
      return next
    }
    try {
      const provider = providerFor(settings.config, workbenchId)
      if (!provider) throw new Error('sync provider is not configured')
      const built = await buildExport(directory, workbenchId, 'complete', options.checkpoint)
      // Keep the last acknowledged remote revision as the parent. If another
      // device moved the remote head, syncWorkbenchSnapshot returns conflict
      // instead of rebasing this device over unseen changes.
      const snapshot = await withParent(built.snapshot, built.objects, settings.state.remoteSnapshotId)
      const result = await syncWorkbenchSnapshot({ snapshot, objects: built.objects, provider, remote: workbenchId })
      const next = { ...settings, state: stateFromResult(result, settings.state) }
      await writeSettings(directory, workbenchId, next)
      return next
    } catch (error) {
      const next = { ...settings, state: { ...settings.state, status: 'offline' as const, updatedAt: Date.now(), error: error instanceof Error ? error.message : String(error) } }
      await writeSettings(directory, workbenchId, next)
      return next
    }
  }
  const refreshScheduler = (workbenchId: string, config: WorkbenchSyncConfigV1) => {
    schedulers.get(workbenchId)?.dispose()
    schedulers.delete(workbenchId)
    if (!config.enabled || config.provider === 'none') return
    const scheduler = new WorkbenchSyncScheduler({ intervalMs: config.intervalMinutes * 60_000, debounceMs: config.debounceMs, sync: async () => { await syncOne(workbenchId) } })
    scheduler.start()
    schedulers.set(workbenchId, scheduler)
  }
  const unsubscribeDirectory = directory.subscribe(() => {
    for (const scheduler of schedulers.values()) scheduler.notifyChanged()
  })
  const configRoute = connection.fetch.register({ path: WORKBENCH_SYNC_ROUTE + '/config', methods: ['GET', 'POST'], requestBody: 'streaming', async fetch(request) {
    try {
      const input = request.method === 'GET' ? undefined : await readJson(request)
      const url = new URL(request.url)
      const workbenchId = typeof input?.workbenchId === 'string' ? input.workbenchId : url.searchParams.get('workbenchId')
      if (!workbenchId) throw new Error('workbenchId is required')
      authorize(request, workbenchId, request.method === 'POST')
      const current = await readSettings(directory, workbenchId)
      if (request.method === 'GET') return response(current)
      const config = normalizeWorkbenchSyncConfig(input?.config)
      const { error: _error, ...stateWithoutError } = current.state
      const next: WorkbenchSyncSettingsV1 = { ...current, config, state: { ...stateWithoutError, status: config.enabled && config.provider !== 'none' ? current.state.status : 'local', updatedAt: Date.now() } }
      await writeSettings(directory, workbenchId, next)
      refreshScheduler(workbenchId, config)
      return response(next)
    } catch (error) { return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 }) }
  } })
  const runRoute = connection.fetch.register({ path: WORKBENCH_SYNC_ROUTE + '/run', methods: ['POST'], requestBody: 'streaming', async fetch(request) {
    try {
      const input = await readJson(request)
      if (typeof input.workbenchId !== 'string' || !input.workbenchId) throw new Error('workbenchId is required')
      authorize(request, input.workbenchId, true)
      const next = await syncOne(input.workbenchId)
      return response(next)
    } catch (error) { return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 }) }
  } })
  for (const workbenchId of Object.keys(directory.getSnapshot().value.workbenches)) void readSettings(directory, workbenchId).then(settings => refreshScheduler(workbenchId, settings.config)).catch(() => {})
  return () => { unsubscribeDirectory(); for (const scheduler of schedulers.values()) scheduler.dispose(); schedulers.clear(); runRoute(); configRoute() }
}
