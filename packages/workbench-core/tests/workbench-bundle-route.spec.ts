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

  it('blocks an extension lock that declares unverifiable external artifacts', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dshbay-route-extension-')); roots.push(root)
    const directory = new HostWorkbenchDirectory(join(root, 'profile'), { async create(folder: string) { return { id: folder } } } as never)
    await directory.create({ requestId: 'create-extension', parentPath: root, folderName: 'source', record: record('source'), open: false })
    await writeFile(join(directory.rootPath('source'), '.dshbay', 'extensions.lock.json'), '{"externalDependencies":[{"id":"adapter","reason":"platform"}]}\n')
    const installed = route(directory)
    try {
      const handler = installed.handlers.get('/api/workbench/bundle/v1/export')!
      const response = await handler(new Request('http://localhost', { method: 'POST', body: JSON.stringify({ workbenchId: 'source', kind: 'template' }) }))
      expect(response.ok).toBe(false)
      expect(await response.json()).toMatchObject({ error: expect.any(String) })
    } finally { installed.dispose() }
  })
})
