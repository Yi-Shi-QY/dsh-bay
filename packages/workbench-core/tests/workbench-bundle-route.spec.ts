import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import * as jsonl from '@deepseek-ai/dsh-session-persistence-jsonl'
import { Session, SessionId, SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { serializeSessionLog } from '@deepseek-ai/dsh-session-log-export'
import { HostWorkbenchDirectory } from '../src/host-workbench-directory.ts'
import { installWorkbenchBundleRoute } from '../src/host-workbench-bundle-route.ts'
import { createRc3WorkbenchSessionCheckpointRestorer } from '../src/host-workbench-session-checkpoint.ts'
import { readWorkbenchBundle } from '../src/workbench-bundle.ts'
import { encodeDeterministicZip } from '../src/foundation/workbench-sharing.ts'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { WorkbenchRecordV2 } from '../src/foundation/persistence.ts'

const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })

function record(workbenchId: string): WorkbenchRecordV2 {
  return { workbenchId, name: 'Route Test', description: '', createdAt: 1, updatedAt: 1,
    document: { version: 3, activeAreaId: 'area', root: { kind: 'area', areaId: 'area', moduleHistory: [] } } }
}

function route(directory: HostWorkbenchDirectory) {
  const handlers = new Map<string, (request: Request) => Promise<Response>>()
  const connection = { fetch: { register(config: { path: string; fetch: (request: Request) => Promise<Response> }) { handlers.set(config.path, config.fetch); return () => { handlers.delete(config.path) } } } }
  const dispose = installWorkbenchBundleRoute(connection as never, { directory })
  return { handlers, dispose }
}

function routeWith(directory: HostWorkbenchDirectory, options: Record<string, unknown>) {
  const handlers = new Map<string, (request: Request) => Promise<Response>>()
  const connection = { fetch: { register(config: { path: string; fetch: (request: Request) => Promise<Response> }) { handlers.set(config.path, config.fetch); return () => { handlers.delete(config.path) } } } }
  const dispose = installWorkbenchBundleRoute(connection as never, { directory, ...options } as never)
  return { handlers, dispose }
}

describe('dshbay bundle Host routes', () => {
  it('exports template and complete payloads and imports a new inert workbench', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dshbay-route-')); roots.push(root)
    const workspaces = { async create(folder: string) { return { id: folder } } }
    const sourceDirectory = new HostWorkbenchDirectory(join(root, 'source-profile'), workspaces as never)
    await sourceDirectory.create({ requestId: 'create-source', parentPath: root, folderName: 'source', record: record('source'), open: false })
    const sourceRoot = sourceDirectory.rootPath('source')
    await writeFile(join(sourceRoot, 'project.txt'), 'project')
    await mkdir(join(sourceRoot, '.dshbay', 'memory'), { recursive: true })
    await mkdir(join(sourceRoot, '.dshbay', 'tasks'), { recursive: true })
    await mkdir(join(sourceRoot, '.dshbay', 'objects'), { recursive: true })
    await writeFile(join(sourceRoot, '.dshbay', 'extensions.lock.json'), '{}\n')
    await writeFile(join(sourceRoot, '.dshbay', 'environment.lock.json'), '{"node":"24"}\n')
    await writeFile(join(sourceRoot, '.dshbay', 'memory', 'decision.json'), '{"id":"decision"}\n')
    await writeFile(join(sourceRoot, '.dshbay', 'tasks', 'task.json'), '{"id":"task"}\n')
    await writeFile(join(sourceRoot, '.dshbay', 'objects', 'attachment.bin'), 'attachment')
    const sourceRoute = route(sourceDirectory)
    try {
      const exportHandler = sourceRoute.handlers.get('/api/workbench/bundle/v1/export')!
      const templateResponse = await exportHandler(new Request('http://localhost', { method: 'POST', body: JSON.stringify({ workbenchId: 'source', kind: 'template' }) }))
      expect(templateResponse.ok).toBe(true)
      const template = await readWorkbenchBundle(new Uint8Array(await templateResponse.arrayBuffer()))
      expect(template.manifest.entries.some(entry => entry.kind === 'project-file')).toBe(false)
      expect(template.manifest.entries.some(entry => entry.kind === 'attachment')).toBe(false)
      expect(template.manifest.entries.some(entry => entry.path === 'memory/decision.json')).toBe(true)

      const completeResponse = await exportHandler(new Request('http://localhost', { method: 'POST', body: JSON.stringify({ workbenchId: 'source', kind: 'complete' }) }))
      expect(completeResponse.ok).toBe(true)
      const completeBytes = new Uint8Array(await completeResponse.arrayBuffer())
      const complete = await readWorkbenchBundle(completeBytes)
      expect(complete.manifest.entries.some(entry => entry.path === 'project.txt' && entry.kind === 'project-file')).toBe(true)
      expect(complete.manifest.entries.some(entry => entry.path === 'objects/attachment.bin' && entry.kind === 'attachment')).toBe(true)

      const recipient = new HostWorkbenchDirectory(join(root, 'recipient-profile'), workspaces as never)
      const recipientRoute = route(recipient)
      try {
        const importHandler = recipientRoute.handlers.get('/api/workbench/bundle/v1/import')!
        const importedResponse = await importHandler(new Request('http://localhost/api/workbench/bundle/v1/import?parentPath=' + encodeURIComponent(root) + '&folderName=recipient', { method: 'POST', body: completeBytes }))
        expect(importedResponse.ok).toBe(true)
        const imported = await importedResponse.json() as { switched: boolean; workbenchId: string }
        expect(imported.switched).toBe(false)
        expect(await readFile(join(root, 'recipient', 'project.txt'), 'utf8')).toBe('project')
        expect(await readFile(join(root, 'recipient', '.dshbay', 'memory', 'decision.json'), 'utf8')).toContain('decision')
        expect(recipient.getSnapshot().value.workbenches[imported.workbenchId]?.executionPaused).toBe(true)
      } finally { recipientRoute.dispose() }
    } finally { sourceRoute.dispose() }
  })

  it('round-trips a bundle larger than the layout-package archive limit', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dshbay-route-large-')); roots.push(root)
    const workspaces = { async create(folder: string) { return { id: folder } } }
    const sourceDirectory = new HostWorkbenchDirectory(join(root, 'source-profile'), workspaces as never)
    await sourceDirectory.create({ requestId: 'create-large-source', parentPath: root, folderName: 'source', record: record('source'), open: false })
    // 80 MB exceeds the 64 MB default that bundle reading used to inherit.
    await writeFile(join(sourceDirectory.rootPath('source'), 'payload.bin'), Buffer.alloc(80 * 1024 * 1024, 7))
    const sourceRoute = route(sourceDirectory)
    try {
      const exported = await sourceRoute.handlers.get('/api/workbench/bundle/v1/export')!(new Request('http://localhost', { method: 'POST', body: JSON.stringify({ workbenchId: 'source', kind: 'complete' }) }))
      expect(exported.ok).toBe(true)
      const bytes = new Uint8Array(await exported.arrayBuffer())
      const recipient = new HostWorkbenchDirectory(join(root, 'recipient-profile'), workspaces as never)
      const recipientRoute = route(recipient)
      try {
        const response = await recipientRoute.handlers.get('/api/workbench/bundle/v1/import')!(new Request('http://localhost/api/workbench/bundle/v1/import?parentPath=' + encodeURIComponent(root) + '&folderName=recipient', { method: 'POST', body: bytes }))
        expect(response.ok, JSON.stringify(await response.clone().json())).toBe(true)
        expect((await stat(join(root, 'recipient', 'payload.bin'))).size).toBe(80 * 1024 * 1024)
      } finally { recipientRoute.dispose() }
    } finally { sourceRoute.dispose() }
  })

  it('rejects DSH conversation archives at the Workbench import boundary', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dshbay-route-dialog-')); roots.push(root)
    const directory = new HostWorkbenchDirectory(join(root, 'profile'), { async create(folder: string) { return { id: folder } } } as never)
    const installed = route(directory)
    try {
      const archive = encodeDeterministicZip([{ path: 'session.v2.jsonl', content: new TextEncoder().encode('{"type":"session"}\n') }])
      const handler = installed.handlers.get('/api/workbench/bundle/v1/inspect')!
      const response = await handler(new Request('http://localhost', { method: 'POST', body: archive }))
      expect(response.ok).toBe(false)
      expect(await response.json()).toMatchObject({ error: expect.stringContaining('对话') })
    } finally { installed.dispose() }
  })

  it('removes the renamed destination when publication fails after staging', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dshbay-route-cleanup-')); roots.push(root)
    const workspaces = { async create(folder: string) { return { id: folder } } }
    const sourceDirectory = new HostWorkbenchDirectory(join(root, 'source-profile'), workspaces as never)
    await sourceDirectory.create({ requestId: 'create-cleanup-source', parentPath: root, folderName: 'source', record: record('source'), open: false })
    const sourceRoute = route(sourceDirectory)
    try {
      const exported = await sourceRoute.handlers.get('/api/workbench/bundle/v1/export')!(new Request('http://localhost', { method: 'POST', body: JSON.stringify({ workbenchId: 'source', kind: 'template' }) }))
      expect(exported.ok).toBe(true)
      const bytes = new Uint8Array(await exported.arrayBuffer())
      const recipient = new HostWorkbenchDirectory(join(root, 'recipient-profile'), workspaces as never)
      recipient.publishImported = async () => { throw new Error('publication failed') }
      const recipientRoute = route(recipient)
      try {
        const response = await recipientRoute.handlers.get('/api/workbench/bundle/v1/import')!(new Request('http://localhost/api/workbench/bundle/v1/import?parentPath=' + encodeURIComponent(root) + '&folderName=recipient', { method: 'POST', body: bytes }))
        expect(response.ok).toBe(false)
        await expect(stat(join(root, 'recipient'))).rejects.toMatchObject({ code: 'ENOENT' })
      } finally { recipientRoute.dispose() }
    } finally { sourceRoute.dispose() }
  })

  it('restores complete-package RC3 checkpoints as new recipient Sessions', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dshbay-route-session-')); roots.push(root)
    const workspaces = { async create(folder: string) { return { id: folder } } }
    const sourceDirectory = new HostWorkbenchDirectory(join(root, 'source-profile'), workspaces as never)
    await sourceDirectory.create({ requestId: 'create-session-source', parentPath: root, folderName: 'source', record: record('source'), open: false })
    await sourceDirectory.registerSession('source', 'source-session', { sessionKey: 'main', role: 'main', relativePath: '', title: 'Main', agentPreset: 'standard', createdAt: 1 })
    const sourceSession = Session.create(SessionId('source-session'), [], { version: SESSION_FORMAT_VERSION, id: SessionId('source-session'), cwd: sourceDirectory.rootPath('source'), createdAt: 1, isSeeded: false })
    sourceSession.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'checkpointed' }], source: { kind: 'user' } }), { surfaceOp: 'append' })
    const checkpointContent = new TextEncoder().encode(serializeSessionLog(sourceSession.header, sourceSession.snapshotEvents()))
    const checkpoint = {
      flushLiveSessionLog: async () => {},
      async *sessionLogZipEntries() { yield { path: 'session.v2.jsonl', data: checkpointContent } },
    }
    const sourceRoute = routeWith(sourceDirectory, { checkpoint })
    const targetPersistence = new Context()
    await jsonl.apply(targetPersistence, { root: join(root, 'target-sessions'), compression: 'none' })
    try {
      const exported = await sourceRoute.handlers.get('/api/workbench/bundle/v1/export')!(new Request('http://localhost', { method: 'POST', body: JSON.stringify({ workbenchId: 'source', kind: 'complete' }) }))
      expect(exported.ok).toBe(true)
      const bytes = new Uint8Array(await exported.arrayBuffer())
      const recipient = new HostWorkbenchDirectory(join(root, 'recipient-profile'), workspaces as never)
      const recipientRoute = routeWith(recipient, { checkpointRestorer: createRc3WorkbenchSessionCheckpointRestorer(targetPersistence.sessionPersistence) })
      try {
        const imported = await recipientRoute.handlers.get('/api/workbench/bundle/v1/import')!(new Request('http://localhost/api/workbench/bundle/v1/import?parentPath=' + encodeURIComponent(root) + '&folderName=recipient', { method: 'POST', body: bytes }))
        expect(imported.ok).toBe(true)
        const result = await imported.json() as { workbenchId: string }
        const entry = recipient.getSnapshot().value.workbenches[result.workbenchId]?.sessionCatalog?.main
        expect(entry?.sessionId).toBeDefined()
        expect(entry?.sessionId).not.toBe('source-session')
        const restored = await targetPersistence.sessionPersistence.open(SessionId(entry!.sessionId!), 'read')
        try { expect(JSON.stringify((await restored.read()).events)).toContain('checkpointed') } finally { await restored.close() }
      } finally { recipientRoute.dispose() }
    } finally { sourceRoute.dispose() }
  })

  it('embeds collected extensions and installs them on import', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dshbay-route-extension-')); roots.push(root)
    const workspaces = { async create(folder: string) { return { id: folder } } }
    const sourceDirectory = new HostWorkbenchDirectory(join(root, 'source-profile'), workspaces as never)
    await sourceDirectory.create({ requestId: 'create-extension', parentPath: root, folderName: 'source', record: record('source'), open: false })
    const artifact = new TextEncoder().encode('packed-extension')
    const digest = (await import('node:crypto')).createHash('sha256').update(artifact).digest('hex')
    const lock = [{ packageName: 'inner-page', moduleId: 'inner-page', version: '1.0.0', artifactSha256: digest, permissions: [], editorIds: ['inner.page'], exportPolicy: 'embed', platforms: ['win32'], migrations: { events: [], workbenchData: [] }, artifactPath: 'extensions/' + digest + '.tgz' }]
    let installed: unknown
    const extensions = () => ({
      async collect(_record: unknown, directory: string) {
        await mkdir(join(directory, 'extensions'), { recursive: true })
        await writeFile(join(directory, 'extensions', digest + '.tgz'), artifact)
        return { locks: lock, notices: [{ packageName: 'inner-page', reason: '安装目录含 1 个清单外的文件，已跳过：README.md' }] }
      },
      async install(rows: unknown) { installed = rows; return { restartRequired: false } },
    })
    const sourceRoute = routeWith(sourceDirectory, { extensions })
    try {
      const exported = await sourceRoute.handlers.get('/api/workbench/bundle/v1/export')!(new Request('http://localhost', { method: 'POST', body: JSON.stringify({ workbenchId: 'source', kind: 'template' }) }))
      expect(exported.ok).toBe(true)
      expect(JSON.parse(decodeURIComponent(exported.headers.get('x-dshbay-export-notices') ?? '[]'))).toMatchObject([{ sessionKey: 'inner-page' }])
      const bytes = new Uint8Array(await exported.arrayBuffer())
      const recipient = new HostWorkbenchDirectory(join(root, 'recipient-profile'), workspaces as never)
      const recipientRoute = routeWith(recipient, { extensions })
      try {
        const response = await recipientRoute.handlers.get('/api/workbench/bundle/v1/import')!(new Request('http://localhost/api/workbench/bundle/v1/import?parentPath=' + encodeURIComponent(root) + '&folderName=recipient', { method: 'POST', body: bytes }))
        expect(response.ok, JSON.stringify(await response.clone().json())).toBe(true)
        expect(installed).toMatchObject([{ packageName: 'inner-page' }])
      } finally { recipientRoute.dispose() }
    } finally { sourceRoute.dispose() }
  })
})
