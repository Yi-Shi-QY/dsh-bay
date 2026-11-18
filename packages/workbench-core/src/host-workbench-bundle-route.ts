import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, rm, lstat, writeFile, rename } from 'node:fs/promises'
import path from 'node:path'
import type { HostConnectionHandle } from '@deepseek-ai/dsh-client-connection'
import type { HostWorkbenchAccess } from './host-workbench-access.ts'
import { WORKBENCH_BUNDLE_MAX_BYTES, WORKBENCH_BUNDLE_ROUTE, type WorkbenchBundleImportResultV1, type WorkbenchBundleInspectionV1 } from './workbench-bundle-contract.ts'
import { buildWorkbenchBundle, readWorkbenchBundle, workbenchBundleFilename, type WorkbenchBundleKind } from './workbench-bundle.ts'
import { createWorkbenchSnapshot } from './workbench-snapshot.ts'
import type { HostWorkbenchDirectory } from './host-workbench-directory.ts'
import type { FileWorkbenchV1 } from './workbench-directory-contract.ts'
import { canonicalJson } from './foundation/workbench-sharing.ts'
import { WORKBENCH_DSH_GENERATION } from './release-compatibility.ts'
import { areasOf } from './foundation/document-v3.ts'
import type { WorkbenchSessionCheckpointSource } from './workbench-session-checkpoint.ts'
import type { WorkbenchSessionCheckpointRestorer } from './workbench-session-checkpoint.ts'
import type { SessionPersistence } from '@deepseek-ai/dsh-session-persistence'
import { existsSync } from 'node:fs'

interface BundleRouteOptions {
  directory: HostWorkbenchDirectory
  access?: HostWorkbenchAccess
  checkpoint?: WorkbenchSessionCheckpointSource
  checkpointRestorer?: WorkbenchSessionCheckpointRestorer
  sessionPersistence?: SessionPersistence
}

const text = (value: unknown, field: string): string => {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`缺少字段：${field}`)
  return value
}

async function readBody(request: Request): Promise<Uint8Array> {
  const chunks: Uint8Array[] = []
  let size = 0
  for await (const chunk of request.body ?? []) {
    size += chunk.length
    if (size > WORKBENCH_BUNDLE_MAX_BYTES) throw new Error('工作台包超过 512 MB 限制。')
    chunks.push(chunk)
  }
  const result = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length }
  return result
}

async function walkFiles(root: string, relative = ''): Promise<{ path: string; content: Uint8Array }[]> {
  const folder = path.join(root, relative)
  const rows = await readdir(folder, { withFileTypes: true })
  const result: { path: string; content: Uint8Array }[] = []
  for (const row of rows.sort((left, right) => left.name.localeCompare(right.name))) {
    if (row.name.toLowerCase() === '.dshbay' || row.name.toLowerCase() === '.git') continue
    const next = relative ? `${relative}/${row.name}` : row.name
    const full = path.join(root, next)
    const info = await lstat(full)
    if (info.isSymbolicLink()) throw new Error(`工作台包不支持符号链接：${next}`)
    if (info.isDirectory()) result.push(...await walkFiles(root, next))
    else if (info.isFile()) {
      if (info.size > WORKBENCH_BUNDLE_MAX_BYTES) throw new Error(`文件超过工作台包限制：${next}`)
      result.push({ path: next.replaceAll(path.sep, '/'), content: new Uint8Array(await readFile(full)) })
    }
  }
  return result
}

type BundlePayloadKind = 'layout' | 'project-metadata' | 'project-file' | 'memory' | 'task' | 'session-checkpoint' | 'attachment' | 'extension' | 'environment'

async function walkManagedFiles(root: string, relative: string, outputPath: string, kind: BundlePayloadKind): Promise<{ path: string; kind: BundlePayloadKind; content: Uint8Array }[]> {
  const folder = path.join(root, '.dshbay', relative)
  if (!existsSync(folder)) return []
  const rows = await readdir(folder, { withFileTypes: true })
  const result: { path: string; kind: BundlePayloadKind; content: Uint8Array }[] = []
  for (const row of rows.sort((left, right) => left.name.localeCompare(right.name))) {
    if (row.name === 'local' || row.name === 'cache' || row.name === 'writer.lock' || row.name === 'workbench.json') continue
    const next = relative ? `${relative}/${row.name}` : row.name
    const full = path.join(root, '.dshbay', next)
    const info = await lstat(full)
    if (info.isSymbolicLink()) throw new Error(`工作台包不支持符号链接：.dshbay/${next}`)
    if (info.isDirectory()) result.push(...await walkManagedFiles(root, next, `${outputPath}/${row.name}`, kind))
    else if (info.isFile()) {
      if (info.size > WORKBENCH_BUNDLE_MAX_BYTES) throw new Error(`文件超过工作台包限制：.dshbay/${next}`)
      result.push({ path: `${outputPath}/${row.name}`, kind, content: new Uint8Array(await readFile(full)) })
    }
  }
  return result
}

async function readManagedPayload(root: string, bundleKind: WorkbenchBundleKind): Promise<{ path: string; kind: BundlePayloadKind; content: Uint8Array }[]> {
  const result: { path: string; kind: BundlePayloadKind; content: Uint8Array }[] = []
  const locks: readonly [string, string, BundlePayloadKind][] = [
    ['extensions.lock.json', 'meta/extensions.lock.json', 'extension'],
    ['environment.lock.json', 'meta/environment.lock.json', 'environment'],
  ]
  for (const [name, target, kind] of locks) {
    const source = path.join(root, '.dshbay', name)
    const content = new Uint8Array(existsSync(source) ? await readFile(source) : Buffer.from('{}\n'))
    if (kind === 'extension') {
      try {
        const lock = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(content)) as { externalDependencies?: unknown }
        if (Array.isArray(lock.externalDependencies) && lock.externalDependencies.length > 0) throw new Error('扩展锁包含未嵌入且无法验证的外部制品')
      } catch (error) {
        if (error instanceof Error && error.message.includes('未嵌入')) throw error
        throw new Error('扩展锁不是有效的 UTF-8 JSON')
      }
    }
    result.push({ path: target, kind, content })
  }
  result.push(...await walkManagedFiles(root, 'memory', 'memory', 'memory'))
  result.push(...await walkManagedFiles(root, 'tasks', 'tasks', 'task'))
  if (bundleKind === 'complete') {
    result.push(...await walkManagedFiles(root, 'objects', 'objects', 'attachment'))
    result.push(...await walkManagedFiles(root, 'sessions/checkpoints', 'sessions/checkpoints', 'session-checkpoint'))
  }
  return result
}

function portableImportedRecord(source: FileWorkbenchV1['record'], workbenchId: string, includeSessions = false) {
  const record = structuredClone(source)
  record.workbenchId = workbenchId
  record.executionPaused = true
  delete record.bayAgentSession
  if (!includeSessions) record.sessionCatalog = {}
  else {
    record.sessionCatalog = Object.fromEntries(Object.entries(record.sessionCatalog ?? {}).map(([key, entry]) => [key, { ...entry }]))
  }
  for (const area of areasOf(record.document.root)) {
    area.moduleHistory = area.moduleHistory.map(page => {
      const { binding: _binding, ...withoutBinding } = page
      return withoutBinding
    })
  }
  return record
}

export async function buildExport(directory: HostWorkbenchDirectory, workbenchId: string, kind: WorkbenchBundleKind, checkpoint?: WorkbenchSessionCheckpointSource) {
  const definition = directory.definition(workbenchId)
  const registeredSessions = directory.sessionMap(workbenchId)
  const definitionWithSessions: FileWorkbenchV1 = {
    ...definition,
    record: {
      ...definition.record,
      ...(definition.record.sessionCatalog === undefined ? {} : {
        sessionCatalog: Object.fromEntries(Object.entries(definition.record.sessionCatalog).map(([key, entry]) => [key, { ...entry, ...(registeredSessions[key] === undefined ? {} : { sessionId: registeredSessions[key] }) }]))
      }),
    },
  }
  const root = directory.rootPath(workbenchId)
  // Active session ids and runtime bindings are device-local. Keep the layout
  // portable while complete snapshots carry only closed/checkpointed content.
  const sessionEntries = Object.values(definitionWithSessions.record.sessionCatalog ?? {})
  if (kind === 'complete' && sessionEntries.length > 0 && checkpoint === undefined) throw new Error('complete 工作台包需要 RC3 Session checkpoint 服务')
  if (kind === 'complete' && sessionEntries.some(entry => typeof entry.sessionId !== 'string' || entry.sessionId.length === 0)) throw new Error('complete 工作台包缺少 Session 身份')
  const portableDefinition: FileWorkbenchV1 = { ...definitionWithSessions, record: portableImportedRecord(definitionWithSessions.record, definitionWithSessions.record.workbenchId, kind === 'complete') }
  const entries: { path: string; kind: BundlePayloadKind; content: Uint8Array }[] = [
    { path: 'layout.json', kind: 'layout', content: new TextEncoder().encode(canonicalJson(portableDefinition)) },
    { path: 'projects.json', kind: 'project-metadata', content: new TextEncoder().encode(canonicalJson(portableDefinition.record.projects ?? {})) },
  ]
  entries.push(...await readManagedPayload(root, kind))
  if (kind === 'complete' && checkpoint) {
    const sessionIds = sessionEntries.map(entry => entry.sessionId!).filter((id): id is string => typeof id === 'string' && id.length > 0)
    for (const sessionId of sessionIds) {
      await checkpoint.flushLiveSessionLog(sessionId)
      const session = await checkpoint.sessionLogZipEntries(sessionId)
      for await (const entry of session) {
        if (entry.path === 'attachments-missing.txt') throw new Error(`Session ${sessionId} checkpoint is missing one or more attachments`)
        const content = entry.content !== undefined ? new TextEncoder().encode(entry.content)
          : entry.data !== undefined ? new Uint8Array(entry.data)
            : entry.chunks ? await collectChunks(entry.chunks) : undefined
        if (!content) throw new Error(`无法读取 Session checkpoint：${sessionId}`)
        entries.push({ path: `sessions/checkpoints/${sessionId}/${entry.path}`, kind: 'session-checkpoint', content })
      }
    }
  }
  if (kind === 'complete') for (const file of await walkFiles(root)) entries.push({ ...file, kind: 'project-file' })
  return createWorkbenchSnapshot({ kind, workbenchId, entries })
}

async function collectChunks(chunks: AsyncIterable<Uint8Array>): Promise<Uint8Array> {
  const values: Uint8Array[] = []
  for await (const chunk of chunks) values.push(chunk)
  const content = new Uint8Array(values.reduce((total, chunk) => total + chunk.byteLength, 0))
  let offset = 0
  for (const chunk of values) { content.set(chunk, offset); offset += chunk.byteLength }
  return content
}

function inspection(bundle: Awaited<ReturnType<typeof readWorkbenchBundle>>): WorkbenchBundleInspectionV1 {
  const manifest = bundle.manifest
  const layoutEntry = manifest.entries.find(entry => entry.path === 'layout.json' && !entry.deleted)
  const layout = layoutEntry && bundle.objects.find(object => object.digest === layoutEntry.digest)
  let name = manifest.workbenchId
  if (layout) {
    try {
      const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(layout.content)) as { record?: { name?: unknown } }
      if (typeof value.record?.name === 'string' && value.record.name.trim()) name = value.record.name
    } catch { /* the reader has already validated the entry digest; import will report malformed layout */ }
  }
  return {
    valid: true,
    manifest,
    filename: workbenchBundleFilename(name),
    fileCount: manifest.entries.filter(entry => !entry.deleted).length,
    bytes: manifest.entries.reduce((sum, entry) => sum + entry.size, 0),
    projectFileCount: manifest.entries.filter(entry => entry.kind === 'project-file' && !entry.deleted).length,
    externalDependencyCount: manifest.externalDependencies?.length ?? 0,
  }
}

function importedPayloadPath(value: string): string {
  if (value === 'meta/extensions.lock.json') return '.dshbay/extensions.lock.json'
  if (value === 'meta/environment.lock.json') return '.dshbay/environment.lock.json'
  if (value.startsWith('memory/')) return `.dshbay/${value}`
  if (value.startsWith('tasks/')) return `.dshbay/${value}`
  if (value.startsWith('objects/')) return `.dshbay/${value}`
  if (value.startsWith('sessions/checkpoints/')) return `.dshbay/${value}`
  return value
}

/** The only public Workbench archive route. Legacy complete/distribution routes are intentionally separate. */
export function installWorkbenchBundleRoute(connection: HostConnectionHandle, options: BundleRouteOptions): () => void {
  const { directory, access } = options
  const actor = (request: Request) => access?.resolve(request.headers)
  const authorize = (request: Request, workbenchId: string, write = false) => {
    const current = actor(request)
    if (access && current) access.authorize(current, write ? 'layout' : 'view', { workbenchId })
  }
  const exportRoute = connection.fetch.register({ path: WORKBENCH_BUNDLE_ROUTE + '/export', methods: ['POST'], requestBody: 'streaming', async fetch(request) {
    try {
      const body = JSON.parse(new TextDecoder().decode(await readBody(request))) as Record<string, unknown>
      const workbenchId = text(body.workbenchId, 'workbenchId')
      const kind = body.kind === 'template' || body.kind === 'complete' ? body.kind : undefined
      if (!kind) throw new Error('只支持 template 或 complete 工作台包。')
      authorize(request, workbenchId)
      const snapshot = await buildExport(directory, workbenchId, kind, options.checkpoint)
      const built = await buildWorkbenchBundle({ snapshot: snapshot.snapshot, objects: snapshot.objects, dshVersion: WORKBENCH_DSH_GENERATION })
      const filename = workbenchBundleFilename(directory.definition(workbenchId).record.name)
      return new Response(Buffer.from(built.archive), { headers: { 'content-type': 'application/zip', 'cache-control': 'no-store', 'content-length': String(built.archive.byteLength), 'x-dshbay-filename': filename } })
    } catch (error) { return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 }) }
  } })
  const inspectRoute = connection.fetch.register({ path: WORKBENCH_BUNDLE_ROUTE + '/inspect', methods: ['POST'], requestBody: 'streaming', async fetch(request) {
    try { const bundle = await readWorkbenchBundle(await readBody(request), { verifyExternalDependency: () => false }); return Response.json(inspection(bundle), { headers: { 'cache-control': 'no-store' } }) }
    catch (error) { return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 }) }
  } })
  const importRoute = connection.fetch.register({ path: WORKBENCH_BUNDLE_ROUTE + '/import', methods: ['POST'], requestBody: 'streaming', async fetch(request) {
    let staging: string | undefined
    try {
      const bundle = await readWorkbenchBundle(await readBody(request), { verifyExternalDependency: () => false })
      if (bundle.manifest.kind !== 'template' && bundle.manifest.kind !== 'complete') throw new Error('不支持的工作台包类型。')
      const url = new URL(request.url)
      const parentPath = text(url.searchParams.get('parentPath'), 'parentPath')
      const folderName = text(url.searchParams.get('folderName'), 'folderName')
      await directory.checkCreateLocation(parentPath, folderName)
      const layout = bundle.objects.find(object => object.digest === bundle.manifest.entries.find(entry => entry.path === 'layout.json')?.digest)
      if (!layout) throw new Error('工作台包缺少布局定义。')
      const source = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(layout.content)) as FileWorkbenchV1
      const workbenchId = `${source.record.workbenchId}-import-${randomUUID().slice(0, 12)}`.slice(0, 180)
      const sourceCatalog = source.record.sessionCatalog ?? {}
      const sessionIds: Record<string, string> = {}
      const sessionMap: Record<string, string> = {}
      for (const [sessionKey, entry] of Object.entries(sourceCatalog)) {
        const sourceSessionId = entry.sessionId ?? entry.sessionKey
        const targetSessionId = randomUUID()
        sessionIds[sourceSessionId] = targetSessionId
        sessionMap[sessionKey] = targetSessionId
      }
      const checkpointEntries: { sourceSessionId: string; path: string; content: Uint8Array }[] = []
      staging = await mkdtemp(path.join(parentPath, '.dshbay-import-'))
      for (const entry of bundle.manifest.entries) {
        if (entry.deleted || !['project-file', 'session-checkpoint', 'attachment', 'extension', 'environment', 'memory', 'task'].includes(entry.kind)) continue
        const object = bundle.objects.find(candidate => candidate.digest === entry.digest)
        if (!object) throw new Error(`工作台包缺少文件：${entry.path}`)
        const target = path.resolve(staging, importedPayloadPath(entry.path))
        if (!target.startsWith(path.resolve(staging) + path.sep)) throw new Error('工作台包路径不安全。')
        await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, object.content, { flag: 'wx' })
        if (entry.kind === 'session-checkpoint' && entry.path.startsWith('sessions/checkpoints/')) {
          const parts = entry.path.split('/')
          if (parts[2]) checkpointEntries.push({ sourceSessionId: parts[2], path: entry.path, content: new Uint8Array(object.content) })
        }
      }
      const target = path.join(path.resolve(parentPath), folderName)
      // The staging directory is a sibling of the destination. Renaming it is
      // atomic on the same volume and avoids registering a half-copied import.
      await rename(staging, target)
      staging = undefined
      try {
        if (checkpointEntries.length > 0) {
          if (!options.checkpointRestorer) throw new Error('complete 工作台包包含 Session checkpoint，但 RC3 Session 恢复服务不可用')
          await options.checkpointRestorer.restore({ entries: checkpointEntries, targetRoot: target, sessionIds, sourceCatalog })
        }
      // Template imports still need their declared project folders to exist so
      // the directory registry can create workspace handles atomically.
      const relativeProjects = [
        ...Object.values(source.record.projects ?? {}).map(project => project.relativePath),
        ...Object.values(source.record.areaProjects ?? {}).map(project => project.relativePath),
      ]
      for (const relative of new Set(relativeProjects)) {
        const projectRoot = path.resolve(target, relative)
        if (projectRoot !== target && !projectRoot.startsWith(target + path.sep)) throw new Error('工作台项目路径不安全。')
        await mkdir(projectRoot, { recursive: true })
      }
      const importedRecord = portableImportedRecord(source.record, workbenchId, checkpointEntries.length > 0)
      if (checkpointEntries.length > 0) {
        importedRecord.sessionCatalog = Object.fromEntries(Object.entries(importedRecord.sessionCatalog ?? {}).map(([key, entry]) => {
          const sourceSessionId = entry.sessionId ?? entry.sessionKey
          const targetSessionId = sessionIds[sourceSessionId]
          return [key, targetSessionId === undefined ? { ...entry } : { ...entry, sessionId: targetSessionId }]
        }))
      }
      const envelope: FileWorkbenchV1 = { schemaVersion: 2, revision: 0, record: importedRecord }
      await directory.publishImported(target, envelope, sessionMap, { open: false })
      } catch (error) {
        await rm(target, { recursive: true, force: true }).catch(() => {})
        throw error
      }
      const result: WorkbenchBundleImportResultV1 = { status: 'committed', workbenchId, name: source.record.name, kind: bundle.manifest.kind, snapshotId: bundle.manifest.snapshotId, switched: false }
      return Response.json(result, { headers: { 'cache-control': 'no-store' } })
    } catch (error) { return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 }) }
    finally { if (staging) await rm(staging, { recursive: true, force: true }).catch(() => {}) }
  } })
  return () => { importRoute(); inspectRoute(); exportRoute() }
}
