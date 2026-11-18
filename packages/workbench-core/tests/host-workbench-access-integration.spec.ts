import { afterEach, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { mkdir, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileAccessFixture } from './helpers/file-access.ts'
import { createHostBrowserWindowController } from '../src/host-browser-window-controller.ts'
import { installWorkbenchDirectoryRoute } from '../src/host-workbench-directory-route.ts'
import { SHARED_CONTROL_GRANT, WORKBENCH_ACCESS_HEADER } from '../src/workbench-access-contract.ts'
import { createFileWorkbenchSettings } from '../src/client/file-workbench-settings.ts'
import { createProjectNeutralFrameSettings } from '../src/foundation/frame-settings-adapter.ts'
import { projectDocumentV3ToLayoutV2 } from '../src/foundation/document-v3.ts'
import { validateLayout } from '../src/foundation/model.ts'
import { executeWorkbenchCollaborationCommand } from '../src/host-workbench-access.ts'

const cleanup: (() => void | Promise<void>)[] = []
afterEach(async () => { for (const dispose of cleanup.splice(0).reverse()) await dispose() })
async function setup() {
  const f = await fileAccessFixture(); cleanup.push(f.dispose)
  let now = 1_000
  const controller = createHostBrowserWindowController({ origin: 'http://127.0.0.1:4200', authenticatedUrl: url => url + '&token=internal', lookupWorkbench: id => f.access.lookup(id), access: f.access, now: () => now })
  cleanup.push(() => controller.dispose())
  let route!: { fetch(request: Request): Promise<Response> }
  installWorkbenchDirectoryRoute({ fetch: { register(value: typeof route) { route = value; return () => {} } } } as never, f.directory, async () => {}, undefined, undefined, f.access)
  const call = (body: unknown, token?: string) => route.fetch(new Request('http://127.0.0.1/api/workbench/directory/v1', { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { [WORKBENCH_ACCESS_HEADER]: token } : {}) }, body: JSON.stringify(body) }))
  const open = async () => {
    const prepared = await controller.handle('prepare', { workbenchId: 'workbench-a' })
    if (!prepared.ok) throw new Error('file workbench not found')
    const value = prepared.value as { url: string; windowId: string }
    const redeemed = await controller.handle('redeem', { ticket: new URL(value.url).searchParams.get('workbench') })
    if (!redeemed.ok) throw new Error('redeem failed')
    const view = (redeemed.value as { view: { closeToken: string; windowId: string } }).view
    const proof = { windowId: view.windowId, closeToken: view.closeToken, pageId: randomUUID() }
    expect((await controller.handle('attach', { closeToken: view.closeToken, pageId: proof.pageId })).ok).toBe(true)
    return { proof, token: view.closeToken, context: f.access.resolve(new Headers({ [WORKBENCH_ACCESS_HEADER]: view.closeToken })) }
  }
  return { ...f, controller, call, open, advance(ms: number) { now += ms } }
}

describe('file workbench / control lease / guest integration', () => {
  it('routes shared Workbench snapshot and project file commands through the Host directory', async () => {
    const f = await setup()
    const root = f.directory.rootPath('workbench-a')
    const projectFile = join(root, 'notes.txt')
    await writeFile(projectFile, 'before', 'utf8')
    const read = await executeWorkbenchCollaborationCommand(f.access, {
      workbenchId: 'workbench-a', operation: { kind: 'workbench.command', operation: 'project.read', payload: { relativePath: 'notes.txt' } },
    }) as { bytes: string; hash: string }
    expect(Buffer.from(read.bytes, 'base64').toString('utf8')).toBe('before')
    const written = await executeWorkbenchCollaborationCommand(f.access, {
      workbenchId: 'workbench-a', operation: { kind: 'workbench.command', operation: 'project.write', payload: { relativePath: 'notes.txt', bytes: Buffer.from('after').toString('base64'), expectedHash: read.hash } },
    }) as { hash: string }
    expect(written.hash).not.toBe(read.hash)
    expect(await (await import('node:fs/promises')).readFile(projectFile, 'utf8')).toBe('after')
    await expect(executeWorkbenchCollaborationCommand(f.access, {
      workbenchId: 'workbench-a', operation: { kind: 'workbench.command', operation: 'project.write', payload: { relativePath: 'notes.txt', bytes: Buffer.from('lost').toString('base64'), expectedHash: read.hash } },
    })).rejects.toMatchObject({ code: 'file-conflict' })
  })

  it('rejects a participant path whose real target leaves the Workbench', async () => {
    const f = await setup()
    const outside = join(f.root, 'outside-target'); await mkdir(outside)
    await symlink(outside, join(f.directory.rootPath('workbench-a'), 'escape'), process.platform === 'win32' ? 'junction' : 'dir')
    const token = f.access.registerGuest('path-guest', 'workbench-a', SHARED_CONTROL_GRANT, () => true)
    const guest = f.access.resolve(new Headers({ [WORKBENCH_ACCESS_HEADER]: token }))
    const codeOf = (relativePath: string): unknown => {
      try { f.access.authorize(guest, 'read-files', { workbenchId: 'workbench-a', relativePath }); return undefined }
      catch (error) { return (error as { code?: unknown }).code }
    }
    expect(codeOf('escape/a.txt')).toBe('path-scope-denied')
    expect(codeOf('.dshbay/workbench.json')).toBe('path-scope-denied')
    expect(() => f.access.authorize(guest, 'read-files', { workbenchId: 'workbench-a', relativePath: 'notes/new.txt' })).not.toThrow()
  })

  it('routes shared Workbench memory through the Host command gateway with CAS and idempotency', async () => {
    const f = await setup()
    const run = (operation: Extract<Parameters<typeof executeWorkbenchCollaborationCommand>[1]['operation'], { kind: 'workbench.command' }>) => executeWorkbenchCollaborationCommand(f.access, { workbenchId: 'workbench-a', operation })
    const entry = {
      id: 'memory-shared', requestId: 'memory-write-1', expectedRevision: 0,
      title: 'Shared memory', summary: 'Visible to every collaboration participant.', body: `The Host root is ${f.directory.rootPath('workbench-a')}.`,
      verification: 'candidate', environmentDependent: false,
      source: { kind: 'user', reference: f.directory.rootPath('workbench-a'), description: 'Shared collaboration test' },
    } as const
    const first = await run({ kind: 'workbench.command', operation: 'memory.write', payload: { entry } }) as { status: string; entry: { id: string; revision: number }; body: string }
    expect(first).toMatchObject({ status: 'committed', entry: { id: 'memory-shared', revision: 1 }, body: expect.stringContaining('<workbench-root>') })
    const repeated = await run({ kind: 'workbench.command', operation: 'memory.write', payload: { entry } }) as { status: string; entry: { revision: number } }
    expect(repeated).toMatchObject({ status: 'committed', entry: { revision: 1 } })
    const listed = await run({ kind: 'workbench.command', operation: 'memory.list', payload: {} }) as readonly { id: string; title: string }[]
    expect(listed).toEqual([expect.objectContaining({ id: 'memory-shared', title: 'Shared memory' })])
    const read = await run({ kind: 'workbench.command', operation: 'memory.read', payload: { id: 'memory-shared' } }) as { entry: { revision: number }; body: string }
    expect(read).toMatchObject({ entry: { revision: 1 }, body: expect.not.stringContaining(f.directory.rootPath('workbench-a')) })
    await expect(run({ kind: 'workbench.command', operation: 'memory.write', payload: { entry: { ...entry, requestId: 'memory-write-conflict', expectedRevision: 0, title: 'stale' } } })).resolves.toMatchObject({ status: 'conflict', actualRevision: 1 })
    const seed = f.access.collaborationSeed('workbench-a')
    expect(seed.memories).toEqual([expect.objectContaining({ id: 'memory-shared', source: expect.objectContaining({ reference: '<workbench-root>' }) })])
  })

  it('routes Workbench facts, sessions, projects, and Context through explicit Host commands', async () => {
    const f = await setup()
    await f.directory.bindArea({ workbenchId: 'workbench-a', areaId: 'area-a', relativePath: 'app', createDirectory: true, expectedRevision: f.directory.getSnapshot().revision })
    await f.directory.registerSession('workbench-a', 'runtime-session-a', {
      sessionKey: 'session-a', sessionId: 'runtime-session-a', role: 'user', areaId: 'area-a', relativePath: 'app', title: 'Before', agentPreset: 'standard', createdAt: 1,
    })

    const run = (operation: Extract<Parameters<typeof executeWorkbenchCollaborationCommand>[1]['operation'], { kind: 'workbench.command' }>) => executeWorkbenchCollaborationCommand(f.access, { workbenchId: 'workbench-a', operation })
    await run({ kind: 'workbench.command', operation: 'workbench.rename', payload: { name: 'Renamed Workbench', expectedDirectoryRevision: f.directory.getSnapshot().revision } })
    expect(f.directory.getSnapshot().value.workbenches['workbench-a']!.name).toBe('Renamed Workbench')

    const createdArea = await run({ kind: 'workbench.command', operation: 'area.create', payload: { areaId: 'area-shared', label: 'Shared Area', expectedDirectoryRevision: f.directory.getSnapshot().revision } }) as { areaId: string }
    expect(createdArea.areaId).toBe('area-shared')
    await run({ kind: 'workbench.command', operation: 'area.show', payload: { areaId: 'area-shared', expectedDirectoryRevision: f.directory.getSnapshot().revision } })
    await run({ kind: 'workbench.command', operation: 'area.archive', payload: { areaId: 'area-shared', expectedDirectoryRevision: f.directory.getSnapshot().revision } })
    expect(f.directory.getSnapshot().value.workbenches['workbench-a']!.areaMetadata?.['area-shared']?.ownership).toBe('archived')

    await run({ kind: 'workbench.command', operation: 'session.rename', payload: { sessionId: 'runtime-session-a', title: 'After', expectedDirectoryRevision: f.directory.getSnapshot().revision } })
    expect(f.directory.getSnapshot().value.workbenches['workbench-a']!.sessionCatalog?.['session-a']?.title).toBe('After')

    const context = f.directory.getSnapshot().value.workbenches['workbench-a']!.context
    await run({ kind: 'workbench.command', operation: 'context.write', payload: {
      scope: 'workbench', writer: 'human', section: 'human', expectedContextRevision: context?.revision ?? 0,
      patch: { goal: 'Shared goal' }, expectedDirectoryRevision: f.directory.getSnapshot().revision,
    } })
    expect(f.directory.getSnapshot().value.workbenches['workbench-a']!.context?.human.goal).toBe('Shared goal')

    await expect(run({ kind: 'workbench.command', operation: 'context.write', payload: {
      scope: 'workbench', writer: 'human', section: 'human', expectedContextRevision: 0,
      patch: { goal: 'stale' }, expectedDirectoryRevision: f.directory.getSnapshot().revision,
    } })).rejects.toMatchObject({ code: 'revision-conflict' })

    await expect(run({ kind: 'workbench.command', operation: 'project.bind', payload: {
      areaId: 'area-a', projectId: 'missing', expectedDirectoryRevision: f.directory.getSnapshot().revision,
    } })).rejects.toMatchObject({ code: 'invalid-operation' })
    const projectId = f.directory.getSnapshot().value.workbenches['workbench-a']!.areaProjects?.['area-a']?.projectId
    if (!projectId) throw new Error('project fixture missing')
    await expect(run({ kind: 'workbench.command', operation: 'project.open', payload: {
      areaId: 'area-a', projectId, requestId: 'open-project-command', expectedDirectoryRevision: f.directory.getSnapshot().revision,
    } })).resolves.toMatchObject({ status: 'committed', areaId: expect.any(String) })
  })

  it('shares one Workbench Session marker set with browser owners and LAN participants', async () => {
    const f = await setup()
    await f.directory.bindArea({ workbenchId: 'workbench-a', areaId: 'area-a', relativePath: 'app', createDirectory: true, expectedRevision: f.directory.getSnapshot().revision })
    const workspaceId = f.directory.getSnapshot().value.workbenches['workbench-a']!.areaProjects?.['area-a']?.workspaceId
    if (!workspaceId) throw new Error('workspace fixture missing')
    for (const [key, sessionId, createdAt] of [['session-a', 'runtime-a', 1], ['session-b', 'runtime-b', 2]] as const) {
      await f.directory.registerSession('workbench-a', sessionId, { sessionKey: key, sessionId, role: 'user', areaId: 'area-a', relativePath: 'app', title: key, agentPreset: 'standard', createdAt })
    }
    // The desktop stored a marker for one Session and for a Session of
    // another Workbench in the same DSH Workspace.
    await f.directory.patch({ operation: 'set', path: ['sessionMarkers', workspaceId], value: {
      'runtime-a': { label: 'A', accentToken: 'accent-1', customized: false },
      'foreign-session': { label: 'B', accentToken: 'accent-2', customized: false },
    } })
    const token = f.access.registerGuest('marker-guest', 'workbench-a', SHARED_CONTROL_GRANT, () => true)
    const read = async () => ((await (await f.call({ action: 'snapshot' }, token)).json()) as { snapshot: { value: { sessionMarkers: Record<string, Record<string, { label: string; accentToken: string }>> } } }).snapshot.value.sessionMarkers
    const markers = await read()
    expect(markers[workspaceId]?.['runtime-a']).toMatchObject({ label: 'A', accentToken: 'accent-1' })
    // A missing marker is completed against the whole Workspace, so it does
    // not reuse the hidden Session's label, and the hidden Session stays hidden.
    expect(markers[workspaceId]?.['runtime-b']?.label).toBe('C')
    expect(markers[workspaceId]?.['foreign-session']).toBeUndefined()

    const patch = (path: string[], value: unknown, requestId: string) => f.call({ action: 'patch', requestId, operation: { operation: 'set', path, value, expectedRevision: f.directory.getSnapshot().revision } }, token)
    expect((await patch(['sessionMarkers', workspaceId, 'runtime-b'], { label: 'API', accentToken: 'accent-5', customized: true }, 'marker-1')).status).toBe(200)
    expect(f.directory.getSnapshot().value.sessionMarkers[workspaceId]?.['runtime-b']).toEqual({ label: 'API', accentToken: 'accent-5', customized: true })
    expect((await read())[workspaceId]?.['runtime-b']?.label).toBe('API')
    // Another Workbench's Session, a duplicate label and other preferences stay out of reach.
    expect((await patch(['sessionMarkers', workspaceId, 'foreign-session'], { label: 'X', accentToken: 'accent-1', customized: true }, 'marker-2')).status).toBe(403)
    expect((await patch(['sessionMarkers', workspaceId, 'runtime-a'], { label: 'B', accentToken: 'accent-1', customized: true }, 'marker-3')).status).toBe(400)
    expect((await patch(['sessionMarkers', workspaceId, 'runtime-a'], { label: 'Z', accentToken: '#ff0000', customized: true }, 'marker-4')).status).toBe(400)
    expect((await patch(['sessionMarkers', workspaceId], {}, 'marker-5')).status).toBe(403)
    expect(f.directory.getSnapshot().value.sessionMarkers[workspaceId]?.['foreign-session']?.label).toBe('B')
  })

  it('routes shared task reads and actions through the Host Bay Agent runtime', async () => {
    const f = await setup(), calls: Record<string, unknown>[] = []
    f.access.setTaskRuntime({
      snapshot: () => [{ workItemId: 'task-1', status: 'queued', objective: 'shared' }],
      request: async (_workbenchId, input) => { calls.push(input); return { accepted: true, input } },
    })
    const run = (operation: Extract<Parameters<typeof executeWorkbenchCollaborationCommand>[1]['operation'], { kind: 'workbench.command' }>) => executeWorkbenchCollaborationCommand(f.access, { workbenchId: 'workbench-a', operation })
    await expect(run({ kind: 'workbench.command', operation: 'task.list', payload: {} })).resolves.toEqual([{ workItemId: 'task-1', status: 'queued', objective: 'shared' }])
    await run({ kind: 'workbench.command', operation: 'task.create', payload: { input: { areaId: 'area-a', objective: 'shared', agentPreset: 'standard', start: false } } })
    await run({ kind: 'workbench.command', operation: 'task.action', payload: { id: 'task-1', action: 'stop' } })
    expect(calls).toEqual([
      { action: 'create', input: { areaId: 'area-a', objective: 'shared', agentPreset: 'standard', start: false } },
      { action: 'stop', id: 'task-1' },
    ])
  })

  it('persists a shared canvas layout through the 18.0 Workbench file', async () => {
    const f = await setup()
    const current = f.directory.getSnapshot().value.workbenches['workbench-a']!
    const layout = projectDocumentV3ToLayoutV2(current.document, current.areaProjects)
    if (layout.root.kind !== 'split') throw new Error('fixture layout must contain a split')
    const nextLayout = structuredClone(layout)
    if (nextLayout.root.kind === 'split') nextLayout.root.ratio = 0.7
    await f.access.persistCollaborationLayout('workbench-a', nextLayout)
    const persisted = f.directory.getSnapshot().value.workbenches['workbench-a']!
    expect(persisted.document.root.kind).toBe('split')
    if (persisted.document.root.kind === 'split') expect(persisted.document.root.ratio).toBe(0.7)
    const reloaded = JSON.parse(await (await import('node:fs/promises')).readFile(join(f.directory.rootPath('workbench-a'), '.dshbay', 'workbench.json'), 'utf8')) as { record: typeof persisted }
    expect(reloaded.record.document.root.kind).toBe('split')
    if (reloaded.record.document.root.kind === 'split') expect(reloaded.record.document.root.ratio).toBe(0.7)
  })

  it('persists a shared layout whose session pages keep state under an earlier session target', async () => {
    const f = await setup()
    const current = f.directory.getSnapshot().value.workbenches['workbench-a']!
    const layout = structuredClone(projectDocumentV3ToLayoutV2(current.document, current.areaProjects))
    if (layout.root.kind !== 'split' || layout.root.first.kind !== 'group') throw new Error('fixture layout must start with an Area')
    // Directory-backed Workbenches keep a page's state bank under the session
    // target it had when the state was written. The legacy v2 layout check
    // requires a bank entry for the current binding and rejects this.
    const earlierTarget = JSON.stringify(['workspace-earlier', 'session-earlier'])
    layout.root.first.tabs = [{
      id: 'tab-conversation', editorId: 'workbench.conversation', editorScope: 'session',
      binding: { sessionId: 'user:area-conversation-a' }, sessionId: 'user:area-conversation-a', bindingGeneration: 1,
      state: {}, sessionStates: { [earlierTarget]: {} }, sessionStateOrder: [earlierTarget], lastKnownTitle: '对话',
    } as never]
    layout.root.first.activeTabId = 'tab-conversation'
    layout.root.ratio = 0.3
    expect(validateLayout(structuredClone(layout))).toBeUndefined()
    // The layout passes the shared-layout check and reaches the directory
    // writer, which applies its own project rules exactly as for the desktop.
    await expect(f.access.persistCollaborationLayout('workbench-a', layout)).rejects.toThrow('项目目录')
    await expect(f.access.persistCollaborationLayout('workbench-a', { version: 2, root: null, activeGroupId: 'area-a' })).rejects.toThrow('共享布局无效')
  })

  it('opens without legacy Settings, freezes desktop writes and admits browser writes only after ready', async () => {
    const f = await setup(), owner = await f.open()
    expect((await f.call({ action: 'snapshot' }, owner.token)).status).toBe(200)
    const target = { workbenchId: 'workbench-a' }
    expect(() => f.access.authorize(owner.context, 'layout', target)).toThrow('交接')
    expect(() => f.access.authorize(f.access.resolve(new Headers()), 'layout', target)).toThrow('浏览器')
    expect((await f.controller.handle('ready', owner.proof)).ok).toBe(true)
    const response = await f.call({ action: 'patch', requestId: 'browser-edit', operation: { operation: 'set', path: ['workbenches', 'workbench-a', 'name'], value: 'Browser edit', expectedRevision: f.directory.getSnapshot().revision } }, owner.token)
    expect(response.status, await response.clone().text()).toBe(200)
    expect(f.directory.getSnapshot().value.workbenches['workbench-a']!.name).toBe('Browser edit')
    expect(() => f.access.authorize(owner.context, 'view', { workbenchId: 'other' })).toThrow('当前工作台')
    const desktop = structuredClone(f.directory.getSnapshot().value)
    desktop.workbenches['workbench-a']!.name = 'Bypass attempt'
    expect((await f.call({ action: 'patch', requestId: 'desktop-root', operation: { operation: 'set', path: [], value: desktop } })).status).toBe(409)
    expect(f.directory.getSnapshot().value.workbenches['workbench-a']!.name).toBe('Browser edit')
    const mirror = createFileWorkbenchSettings((async (_input, init) => f.call(JSON.parse(String(init?.body)), owner.token)) as typeof fetch)
    cleanup.push(() => mirror.dispose()); await mirror.refresh()
    const adapter = createProjectNeutralFrameSettings(mirror.scope, { workbenchId: 'workbench-a' })
    expect(await adapter.directory.rename('workbench-a', 'Scoped UI edit')).toMatchObject({ status: 'committed' })
    expect(f.directory.getSnapshot().value.workbenches['workbench-a']!.name).toBe('Scoped UI edit')
  })

  it('carries desktop Workbench editor consent into the browser-owner snapshot', async () => {
    const f = await setup()
    const current = structuredClone(f.directory.getSnapshot().value)
    current.globalHiddenEditorIds = ['example.hidden']
    current.editorMenu = { folders: [{ id: 'tools', name: '工具' }], assignments: { 'example.ins': 'tools' } }
    current.extensionConsents = {
      '@example/ins::example.ins': {
        packageName: '@example/ins', moduleId: 'example.ins', apiVersion: 1,
        editorIds: ['example.ins.page'], contractFingerprint: 'a'.repeat(32), allowedAt: 10, allowed: true,
      },
    }
    await f.directory.patch({ operation: 'set', path: [], value: current })
    const owner = await f.open()
    const scoped = f.access.snapshot(owner.context)
    expect(scoped.value.globalHiddenEditorIds).toEqual(['example.hidden'])
    expect(scoped.value.editorMenu).toEqual(current.editorMenu)
    expect(scoped.value.extensionConsents?.['@example/ins::example.ins']).toMatchObject({ allowed: true })

    const mirror = createFileWorkbenchSettings((async (_input, init) => f.call(JSON.parse(String(init?.body)), owner.token)) as typeof fetch)
    cleanup.push(() => mirror.dispose())
    await mirror.refresh()
    expect(mirror.scope.getSnapshot().value?.extensionConsents?.['@example/ins::example.ins']).toMatchObject({ allowed: true })
    expect(mirror.scope.getSnapshot().value?.globalHiddenEditorIds).toEqual(['example.hidden'])
    expect(mirror.scope.getSnapshot().value?.editorMenu).toEqual(current.editorMenu)
  })

  it('keeps exactly one active page, supports refresh grace, and rejects revoked epochs and late heartbeats', async () => {
    const f = await setup(), owner = await f.open()
    await f.controller.handle('ready', owner.proof)
    const nextPage = randomUUID()
    expect((await f.controller.handle('attach', { closeToken: owner.token, pageId: nextPage })).ok).toBe(false)
    await f.controller.handle('suspend', owner.proof)
    expect(() => f.access.authorize(owner.context, 'message', { workbenchId: 'workbench-a' })).toThrow('交接')
    f.advance(9_000)
    expect((await f.controller.handle('attach', { closeToken: owner.token, pageId: nextPage })).ok).toBe(true)
    expect((await f.controller.handle('heartbeat', owner.proof)).ok).toBe(false)
    await f.controller.handle('suspend', { ...owner.proof, pageId: nextPage })
    f.advance(10_001)
    expect(f.access.controller('workbench-a')).toBe('desktop')
    expect(() => f.access.authorize(owner.context, 'layout', { workbenchId: 'workbench-a' })).toThrow('结束')
    expect(await f.controller.handle('heartbeat', { ...owner.proof, pageId: nextPage })).toMatchObject({ ok: true, value: { status: 'closed' } })
    const replacement = await f.open()
    expect(replacement.context.controlEpoch).not.toBe(owner.context.controlEpoch)
  })

  it('guards real paths and treats shared directories as separate conversation scopes', async () => {
    const f = await setup()
    await f.directory.bindArea({ workbenchId: 'workbench-a', areaId: 'area-a', relativePath: 'app', createDirectory: true, expectedRevision: f.directory.getSnapshot().revision })
    const outside = join(f.root, 'external'); await mkdir(outside)
    await symlink(outside, join(f.directory.rootPath('workbench-a'), 'app', 'escape'), process.platform === 'win32' ? 'junction' : 'dir')
    const token = f.access.registerGuest('guest', 'workbench-a', { ...SHARED_CONTROL_GRANT, capabilities: ['view', 'read-files'] }, () => true)
    expect((await f.call({ action: 'project-read', workbenchId: 'workbench-a', relativePath: 'app/escape/a.txt' }, token)).status).toBeGreaterThanOrEqual(400)
    expect((await f.call({ action: 'project-read', workbenchId: 'workbench-a', relativePath: '.dshbay/workbench.json' }, token)).status).toBe(403)
    expect((await f.call({ action: 'register-session', workbenchId: 'workbench-a', requestId: 'steal', sessionId: 'foreign' }, token)).status).toBe(403)
    const snapshot = await (await f.call({ action: 'snapshot' }, token)).json()
    expect(snapshot.snapshot.value.workbenches['workbench-a'].fileWorkbench.rootPath).toBeUndefined()
  })

  it('waits for accepted writes and rejects new guest writes while taking a snapshot', async () => {
    const f = await setup()
    const token = f.access.registerGuest('editor', 'workbench-a', SHARED_CONTROL_GRANT, () => true)
    const guest = f.access.resolve(new Headers({ [WORKBENCH_ACCESS_HEADER]: token }))
    let finish!: () => void
    const write = f.access.run(guest, 'layout', { workbenchId: 'workbench-a' }, () => new Promise<void>(resolve => { finish = resolve }))
    let copied = false
    const snapshot = f.access.withSnapshot('workbench-a', async () => { copied = true })
    expect(copied).toBe(false)
    const value = structuredClone(f.directory.getSnapshot().value.workbenches['workbench-a']!); value.name = 'Should wait'
    const response = await f.call({ action: 'patch', requestId: 'snapshot-write', operation: { operation: 'set', path: ['workbenches', 'workbench-a'], value, expectedRevision: f.directory.getSnapshot().revision } }, token)
    expect(response.status).toBe(423)
    expect(() => f.access.authorizeAcceptedExecution(guest, 'layout', { workbenchId: 'workbench-a' })).not.toThrow()
    expect(() => f.access.authorizeAcceptedExecution(guest, 'memory', { workbenchId: 'workbench-a' })).not.toThrow()
    expect(() => f.access.authorizeAcceptedExecution(guest, 'layout', { workbenchId: 'other' })).toThrow('当前工作台')
    finish(); await write; await snapshot
    expect(copied).toBe(true)
    expect(f.access.isSnapshotting('workbench-a')).toBe(false)
  })

  it('does not call a missing directory ready or fall back to Settings', async () => {
    const f = await setup()
    expect(await f.controller.handle('prepare', { workbenchId: 'legacy-only' })).toMatchObject({ ok: false })
    const { rm } = await import('node:fs/promises')
    await rm(join(f.directory.rootPath('workbench-a'), '.dshbay', 'workbench.json'))
    expect(await f.controller.handle('prepare', { workbenchId: 'workbench-a' })).toMatchObject({ ok: false })
    await writeFile(join(f.directory.rootPath('workbench-a'), '.dshbay', 'workbench.json'), '{broken')
    expect(await f.controller.handle('prepare', { workbenchId: 'workbench-a' })).toMatchObject({ ok: false })
  })
})
