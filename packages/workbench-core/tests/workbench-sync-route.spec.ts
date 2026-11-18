import { afterEach, describe, expect, it } from 'vitest'
import { readFile, mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { HostWorkbenchDirectory } from '../src/host-workbench-directory.ts'
import { installWorkbenchSyncRoute } from '../src/host-workbench-sync-route.ts'

const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })

function record(workbenchId: string) {
  return {
    workbenchId,
    name: 'Sync Test',
    description: '',
    createdAt: 1,
    updatedAt: 1,
    document: { version: 3, activeAreaId: 'area', root: { kind: 'area', areaId: 'area', moduleHistory: [] } },
  }
}

function route(directory: HostWorkbenchDirectory) {
  const handlers = new Map<string, (request: Request) => Promise<Response>>()
  const connection = {
    fetch: {
      register(config: { path: string; fetch: (request: Request) => Promise<Response> }) {
        handlers.set(config.path, config.fetch)
        return () => { handlers.delete(config.path) }
      },
    },
  }
  const dispose = installWorkbenchSyncRoute(connection as never, { directory })
  return { handlers, dispose }
}

describe('dshbay sync Host routes', () => {
  it('returns local defaults, persists folder settings, and uploads a first snapshot', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dshbay-sync-route-')); roots.push(root)
    const directory = new HostWorkbenchDirectory(join(root, 'profile'), { async create(folder: string) { return { id: folder } } } as never)
    await directory.create({ requestId: 'create-sync', parentPath: root, folderName: 'source', record: record('source'), open: false })
    const installed = route(directory)
    try {
      const configHandler = installed.handlers.get('/api/workbench/sync/v1/config')!
      const runHandler = installed.handlers.get('/api/workbench/sync/v1/run')!
      const initial = await configHandler(new Request('http://localhost/api/workbench/sync/v1/config?workbenchId=source'))
      expect(initial.ok).toBe(true)
      expect(await initial.json()).toMatchObject({ config: { provider: 'none' }, state: { status: 'local' } })

      const remote = join(root, 'remote')
      const saved = await configHandler(new Request('http://localhost/api/workbench/sync/v1/config', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workbenchId: 'source', config: { schemaVersion: 1, provider: 'folder', remote, enabled: true, intervalMinutes: 30, debounceMs: 1500 } }),
      }))
      expect(saved.ok).toBe(true)
      expect(await saved.json()).toMatchObject({ config: { provider: 'folder', remote, enabled: true } })

      const synced = await runHandler(new Request('http://localhost/api/workbench/sync/v1/run', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workbenchId: 'source' }),
      }))
      expect(synced.ok).toBe(true)
      const body = await synced.json() as { config: { remote: string }; state: { status: string; localSnapshotId?: string; remoteSnapshotId?: string } }
      expect(body.state.status).toBe('synced')
      expect(body.state.remoteSnapshotId).toBe(body.state.localSnapshotId)
      await expect(stat(join(remote, 'refs', 'source', 'head'))).resolves.toBeDefined()

      const persisted = JSON.parse(await readFile(join(directory.rootPath('source'), '.dshbay', 'sync.json'), 'utf8')) as { config: Record<string, unknown> }
      expect(persisted.config).toEqual({ schemaVersion: 1, provider: 'folder', remote, enabled: true, intervalMinutes: 30, debounceMs: 1500 })
      expect(JSON.stringify(persisted)).not.toMatch(/token|password|cookie|secret/iu)

      await writeFile(join(remote, 'refs', 'source', 'head'), 'sha256:' + 'f'.repeat(64) + '\n')
      const conflict = await runHandler(new Request('http://localhost/api/workbench/sync/v1/run', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workbenchId: 'source' }),
      }))
      expect(conflict.ok).toBe(true)
      expect((await conflict.json() as { state: { status: string } }).state.status).toBe('conflict')
    } finally { installed.dispose() }
  })

  it('rejects malformed WebDAV settings before writing them', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dshbay-sync-invalid-')); roots.push(root)
    const directory = new HostWorkbenchDirectory(join(root, 'profile'), { async create(folder: string) { return { id: folder } } } as never)
    await directory.create({ requestId: 'create-invalid', parentPath: root, folderName: 'source', record: record('source'), open: false })
    const installed = route(directory)
    try {
      const configHandler = installed.handlers.get('/api/workbench/sync/v1/config')!
      const response = await configHandler(new Request('http://localhost/api/workbench/sync/v1/config', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workbenchId: 'source', config: { schemaVersion: 1, provider: 'webdav', remote: 'file:///not-webdav', enabled: true, intervalMinutes: 30, debounceMs: 1500 } }),
      }))
      expect(response.ok).toBe(false)
      await expect(stat(join(directory.rootPath('source'), '.dshbay', 'sync.json'))).rejects.toMatchObject({ code: 'ENOENT' })
    } finally { installed.dispose() }
  })
})
