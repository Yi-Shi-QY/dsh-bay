import { afterEach, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { RemoteAccessService } from '@deepseek-ai/dsh-api-remote-access'
import { mkdtemp, rm, mkdir, writeFile, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { HostWorkbenchDirectory } from '../src/host-workbench-directory.ts'
import { HostWorkbenchAccess } from '../src/host-workbench-access.ts'
import { SHARED_CONTROL_GRANT } from '../src/workbench-access-contract.ts'
import { createGuestNativeTransport, currentWorkbenchExecutionOrigin, installWorkbenchNativeMutationRoutes } from '../src/host-workbench-native-access.ts'
import type { WorkbenchRecordV2 } from '../src/foundation/persistence.ts'

const cleanup: (() => unknown)[] = []
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn() })
async function fixture(options: { sharedFetch?: (request: Request, peer: any) => Promise<Response>; services?: Record<string, unknown> } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'bay-native-access-')); cleanup.push(() => rm(root, { recursive: true, force: true }))
  const directory = new HostWorkbenchDirectory(join(root, 'profile'), { create: async () => ({ id: 'workspace' }) } as never)
  for (const id of ['one', 'other']) {
    const record: WorkbenchRecordV2 = { workbenchId: id, name: id, description: '', createdAt: 1, updatedAt: 1,
      document: { version: 3, activeAreaId: 'area', root: { kind: 'area', areaId: 'area', moduleHistory: [] } } }
    await directory.create({ requestId: id, parentPath: root, folderName: id, record })
    await directory.bindArea({ workbenchId: id, areaId: 'area', relativePath: 'project', createDirectory: true, expectedRevision: directory.getSnapshot().revision })
    await directory.registerSession(id, id + '-session', { sessionKey: id + '-logical', role: 'user', areaId: 'area', relativePath: 'project', title: id, agentPreset: 'default', createdAt: 1 })
  }
  await directory.registerSession('one', 'main', { sessionKey: 'main-logical', role: 'main', relativePath: '', title: 'Bay', agentPreset: 'default', createdAt: 1 })
  const access = new HostWorkbenchAccess(directory); cleanup.push(() => access.dispose())
  access.registerGuest('guest', 'one', SHARED_CONTROL_GRANT, () => true, { collaborationId: 'collaboration-one', displayName: '协作者' })
  const context = new Context(); cleanup.push(() => context.fiber.dispose())
  const remoteAccess = new RemoteAccessService(context)
  const hooks = new Map<string, Function>(), peers: any[] = [], guards: Function[] = [], routes = new Map<string, any>()
  const connection = {
    browserPeer: { principal: { kind: 'owner' } },
    fetch: { register: (route: any) => { routes.set(route.path, route); return async () => { routes.delete(route.path) } } },
    createPeer: ({ principal }: any) => { const controller = new AbortController(); const peer = { principal, signal: controller.signal, dispose: () => controller.abort() }; peers.push(peer); return peer },
    createSharedFetchHandler: () => ({ fetch: vi.fn(options.sharedFetch ?? (async (_request: Request, peer: any) => Response.json({ kind: peer.principal.kind }))) }),
  }
  const invoke = vi.fn(async ({ namespace, method, args, peer }: any) => {
    const sessionId = args.request?.sessionId ?? args.sessionId ?? args.agentId ?? args.workspaceFileScopeId
    const result = remoteAccess.decide({ principal: peer.principal, action: `${namespace}/${method}` as never,
      resources: sessionId ? [{ kind: 'session', id: sessionId }] : [{ kind: 'global' }], args })
    if (result.kind === 'deny') throw new Error(result.reason)
    return { accepted: true }
  })
  const services: Record<string, unknown> = {
    connection, remoteAccess, tools: { guard: (guard: Function) => { guards.push(guard); return () => guards.splice(guards.indexOf(guard), 1) } },
    typertGateway: { invoke, wireStream: {
      failure: (error: Error & { code?: string }) => ({ code: error.code ?? 'test', message: error.message, details: {} }),
      open: vi.fn(async function* () { yield { type: 'ready', host: { home: 'private-home' } } }),
    } },
    sessionPersistence: { stat: async (id: string) => ({ header: { cwd: join(root, id === 'main' ? 'one' : id.split('-')[0]!, id === 'main' ? '' : 'project') } }), open: async () => ({ read: async (offset = 0) => ({ events: offset ? [] : [{ content: [{ type: 'image', attachment: { attachmentId: 'mine' } }] }] }), [Symbol.asyncDispose]: async () => {} }) },
    workingDirectory: { get: () => join(root, 'one', 'project') },
    ...options.services,
  }
  const ctx = { get: (key: string) => services[key], on: (event: string, fn: Function) => { hooks.set(event, fn); return () => hooks.delete(event) }, tools: services.tools } as unknown as Context
  const transport = createGuestNativeTransport(ctx, access)!; cleanup.push(() => transport.dispose())
  const guest = () => access.getContext('guest')
  const http = (method: string, args: unknown, context = guest()) => transport.handleHttp(new Request('http://host/api/' + method, {
    method: 'POST', body: JSON.stringify({ type: 'client-request', rpcId: 'rpc', method, payload: { args } }), headers: { 'content-type': 'application/json' },
  }), context).then(result => result.json())
  const agent = { id: 'one-session', cancel: vi.fn(), status: 'idle', whenIdle: async () => {} }
  const message = (id = 'guest') => ({ source: { kind: 'user', principal: { kind: 'bay-workbench', actor: 'lan-guest', workbenchId: 'one', accessId: id } } })
  const step = (messages = [message()], turn = 1) => hooks.get('agent/pre-step')!({ agent, messages, turn }, async () => ({ kind: 'enter', messages }))
  const tool = (name: string, args: unknown = {}) => ({ agent, name, arguments: args, token: {}, callId: name + '-call', signal: new AbortController().signal })
  return { root, access, context, remoteAccess, ctx, guest, http, transport, hooks, guards, peers, invoke, agent, message, step, tool, routes, services }
}

it('resolves real file Workbenches, creates non-owner peers and scopes catalog grants to registered Sessions', async () => {
  const f = await fixture()
  const baseline = f.transport.bootstrap(f.guest())
  expect(baseline.owner).toBe(false)
  expect(JSON.stringify(baseline)).toContain('one-session')
  expect(JSON.stringify(baseline)).not.toContain('other-session')
  expect(f.peers[0].principal.kind).toBe('bay-workbench')
  expect(await f.http('session/prompt', { request: { sessionId: 'one-session', mode: 'steer', requestId: 'id', content: [{ type: 'text', text: 'hello' }] } })).toMatchObject({ type: 'server-response', result: { ok: true } })
  expect(f.invoke.mock.calls[0]![0].args.request.mode).toBe('steer')
  expect(await f.http('session/prompt', { request: { sessionId: 'other-session', mode: 'queue' } })).toMatchObject({ result: { ok: false } })
  expect(await f.http('session/prompt', { request: { sessionId: 'main', mode: 'queue' } })).toMatchObject({ result: { ok: true } })
  expect(f.invoke).toHaveBeenCalledTimes(2)
})

it('forwards waterfall answers ($events/result) from browser owners to the native handler', async () => {
  const f = await fixture()
  f.access.registerOwner('browser', 'one', () => true)
  const owner = f.access.getContext('browser')
  const answer = { clientId: 'client', eventId: 'event', outcome: { kind: 'result', value: { answers: [] } } }
  expect(await f.http('$events/result', answer, owner)).toEqual({ kind: 'owner' })
  expect(await f.http('$other/result', answer, owner)).toMatchObject({ result: { ok: false } })
})

it('rejects foreign attachments even when a caller knows their native reference', async () => {
  const f = await fixture()
  expect(await f.http('session/attachment', { request: { sessionId: 'one-session', attachment: { attachmentId: 'not-mine' } } })).toMatchObject({ result: { ok: false } })
  expect(await f.http('session/attachment', { request: { sessionId: 'one-session', attachment: { attachmentId: 'mine' } } })).toEqual({ kind: 'bay-workbench' })
})

it('confines native file resources to the current Workbench root and rejects foreign roots', async () => {
  const f = await fixture()
  f.access.registerGuest('reader', 'one', { ...SHARED_CONTROL_GRANT, capabilities: ['view', 'message', 'read-files'] }, () => true)
  const reader = f.access.getContext('reader')
  await writeFile(join(f.root, 'one', 'project', 'file.txt'), 'visible')
  await writeFile(join(f.root, 'other', 'project', 'private.txt'), 'private')
  await mkdir(join(f.root, 'one', 'outputs'))
  await writeFile(join(f.root, 'one', 'outputs', 'result.txt'), 'out of reader path')
  await symlink(join(f.root, 'other', 'project'), join(f.root, 'one', 'project', 'external'), 'junction')
  const read = (path: string, context = reader, options?: unknown) => f.http('workspaceFiles/readBytes', { workspaceFileScopeId: 'one-session', path, ...(options ? { options } : {}) }, context)
  expect(await read('file.txt')).toEqual({ kind: 'bay-workbench' })
  expect(await read('../../other/project/private.txt')).toMatchObject({ result: { ok: false } })
  expect(await read('external/private.txt')).toMatchObject({ result: { ok: false } })
  expect(await read('../outputs/result.txt')).toEqual({ kind: 'bay-workbench' })
  expect(await read('../.bay/workbench.json')).toMatchObject({ result: { ok: false } })
  expect(await read('file.txt', f.guest())).toEqual({ kind: 'bay-workbench' })
  expect(await f.http('workspaceFiles/readBytes', { workspaceFileScopeId: 'other-session', path: 'private.txt' }, reader)).toMatchObject({ result: { ok: false } })
  expect(await read('file.txt', reader, { baseFile: 'file.txt' })).toEqual({ kind: 'bay-workbench' })
  f.services.sessions = { get: () => ({ header: { cwd: join(f.root, 'other', 'project') } }) }
  expect(await read('private.txt')).toMatchObject({ result: { ok: false } })
  f.services.sessions = undefined
  f.access.registerOwner('browser', 'one', () => true)
  expect(await read('../outputs/result.txt', f.access.getContext('browser'))).toEqual({ kind: 'owner' })
  expect(await read('../../other/project/private.txt', f.access.getContext('browser'))).toMatchObject({ result: { ok: false } })
})

it('refreshes browser-owner grants after handoff without replacing its live peer', async () => {
  const f = await fixture()
  let ready = false
  f.access.registerOwner('browser', 'one', () => true, undefined, () => ready)
  const owner = f.access.getContext('browser'), baseline = f.transport.bootstrap(owner)
  const peer = f.peers[0]!
  expect(baseline.owner).toBe(true)
  expect(peer.principal).toEqual({ kind: 'owner' })
  expect(() => f.access.authorize(owner, 'message', { workbenchId: 'one', sessionId: 'one-session' })).toThrow('浏览器正在交接')
  ready = true
  f.transport.refresh()
  expect(() => f.access.authorize(owner, 'message', { workbenchId: 'one', sessionId: 'one-session' })).not.toThrow()
  expect(f.peers[0]).toBe(peer)
  expect(peer.signal.aborted).toBe(false)
})

it('admits owner prompts while the browser controls the Workbench', async () => {
  const f = await fixture()
  f.access.registerOwner('browser', 'one', () => true, undefined, () => true)
  expect(await f.http('session/prompt', {
    request: { sessionId: 'one-session', mode: 'steer', requestId: 'browser-owner-prompt', content: [{ type: 'text', text: 'hello from browser' }] },
  }, f.access.getContext('browser'))).toMatchObject({ type: 'server-response', result: { ok: true } })
  expect(await f.step([{ source: { kind: 'user', rpcId: 'browser-owner-prompt' } }])).toMatchObject({ kind: 'enter' })
  expect(await f.step([{ source: { kind: 'user', rpcId: 'untrusted-prompt' } }], 2)).toEqual({ kind: 'reject' })
})

it('rechecks terminal control and snapshot barriers throughout a live stream', async () => {
  const f = await fixture()
  let ready = false
  f.access.registerOwner('browser', 'one', () => true, undefined, () => ready)
  const owner = f.access.getContext('browser'), args = { args: { agentId: 'one-session', id: 'terminal' } }
  const signal = new AbortController().signal
  await expect(f.transport.openStream('terminal/attach', args, f.guest(), signal)).rejects.toThrow('主控')
  await expect(f.transport.openStream('terminal/attach', args, owner, signal)).rejects.toThrow('交接')
  ready = true
  await expect(f.transport.openStream('terminal/attach', { args: { agentId: 'other-session', id: 'terminal' } }, owner, signal)).rejects.toThrow('工作台')
  const gateway = f.services.typertGateway as { wireStream: { open: Function } }
  gateway.wireStream.open = async function* () { yield { type: 'output', data: 'first' }; yield { type: 'output', data: 'second' } }
  const stream = (await f.transport.openStream('terminal/attach', args, owner, signal))[Symbol.asyncIterator]()
  expect(await stream.next()).toMatchObject({ value: { data: 'first' }, done: false })
  await f.access.withSnapshot('one', async () => {
    await expect(stream.next()).rejects.toThrow('快照')
    await expect(f.transport.openStream('terminal/attach', args, owner, signal)).rejects.toThrow('快照')
  })
  const restored = (await f.transport.openStream('terminal/attach', args, owner, signal))[Symbol.asyncIterator]()
  expect(await restored.next()).toMatchObject({ value: { data: 'first' } })
  f.access.revoke('browser')
  await expect(restored.next()).rejects.toThrow('访问已结束')
})

it('requires one-shot tool approval, binds exact arguments, and carries origin into nested operations', async () => {
  const f = await fixture(); expect(await f.step()).toMatchObject({ kind: 'enter' })
  const exec = f.tool('bash', { command: 'echo hello' })
  const pending = f.hooks.get('tools/pre-execute')!(exec, async () => ({ kind: 'allow' }))
  await vi.waitFor(() => expect(f.transport.pending('one')).toHaveLength(1))
  const approval = f.transport.pending('one')[0]!
  expect(() => f.transport.answer(f.guest(), approval.id, true)).toThrow()
  f.transport.answer(f.access.getContext('desktop'), approval.id, true)
  expect(await pending).toMatchObject({ kind: 'allow' })
  expect(f.guards[0]!(exec)).toBeUndefined()
  expect(f.guards[0]!({ ...exec, arguments: { command: 'changed' } })).toBeTypeOf('string')
  const origin = await f.hooks.get('tools/execute')!(exec, async () => currentWorkbenchExecutionOrigin())
  expect(origin).toMatchObject({ accessId: 'guest', actor: 'lan-guest', workbenchId: 'one', participantId: 'guest', collaborationId: 'collaboration-one', displayName: '协作者' })
  f.hooks.get('tools/result')!(exec)
  expect(f.guards[0]!(exec)).toBeTypeOf('string')
})

it('shares native operations through one Host grant and invalidates execution on revoke', async () => {
  const f = await fixture()
  await f.step([f.message('guest')])
  expect(f.guards[0]!(f.tool('read', { file_path: 'file.txt' }))).toBeUndefined()
  f.access.revoke('guest')
  expect(f.agent.cancel).toHaveBeenCalledOnce()
  expect(await f.step([], 1)).toEqual({ kind: 'reject' })
})

it('lets a read-only guest use a mounted read-effect AgentKit tool without extra approval', async () => {
  const f = await fixture({ services: { workbenchAgentKit: { effectForName: (name: string) => name === 'workbench_quote_lookup' ? 'read' : undefined } } })
  await f.step([f.message('guest')])
  const exec = f.tool('workbench_quote_lookup', { quoteId: 'q-1' })
  expect(await f.hooks.get('tools/pre-execute')!(exec, async () => ({ kind: 'allow' }))).toEqual({ kind: 'allow' })
  expect(f.transport.pending('one')).toHaveLength(0)
  expect(f.guards[0]!(exec)).toBeUndefined()
})

it('fences native owner mutation routes while preserving unrelated native Sessions', async () => {
  const f = await fixture()
  cleanup.push(installWorkbenchNativeMutationRoutes(f.ctx, f.access, f.transport))
  f.access.registerOwner('browser', 'one', () => true)
  const call = (sessionId: string) => f.routes.get('/api/session/rename').fetch(new Request('http://host/api/session/rename', {
    method: 'POST', body: JSON.stringify({ type: 'client-request', rpcId: 'rename', method: 'session/rename', payload: { args: { request: { sessionId, name: 'new' } } } }),
  })).then((response: Response) => response.json())
  expect(await call('one-session')).toMatchObject({ result: { ok: false } })
  expect(await call('other-session')).toMatchObject({ result: { ok: true } })
  expect(f.invoke).toHaveBeenCalledTimes(1)
  const selectMode = (agentId: string) => f.routes.get('/api/agentPresets/select').fetch(new Request('http://host/api/agentPresets/select', {
    method: 'POST', body: JSON.stringify({ type: 'client-request', rpcId: 'mode', method: 'agentPresets/select', payload: { args: { agentId, request: { presetId: 'default' } } } }),
  })).then((response: Response) => response.json())
  expect(await selectMode('one-session')).toMatchObject({ result: { ok: false } })
  expect(await selectMode('other-session')).toMatchObject({ result: { ok: true } })
  expect(f.invoke).toHaveBeenCalledTimes(2)
})

it('waits for native execution to quiesce before publishing a snapshot and releases the boundary afterwards', async () => {
  const f = await fixture()
  let settle!: () => void
  const idle = new Promise<void>(resolve => { settle = resolve })
  f.agent.status = 'running'; f.agent.whenIdle = () => idle
  f.services.agents = { get: (id: string) => id === 'one-session' ? f.agent : undefined }
  await f.step()
  const exportFiles = vi.fn(async () => 'snapshot')
  const snapshot = f.access.withSnapshot('one', exportFiles)
  await Promise.resolve()
  expect(exportFiles).not.toHaveBeenCalled()
  expect(await f.step()).toMatchObject({ kind: 'enter' })
  expect(() => f.access.authorize(f.guest(), 'message', { workbenchId: 'one', sessionId: 'one-session' })).toThrow('快照')
  settle()
  expect(await snapshot).toBe('snapshot')
  expect(exportFiles).toHaveBeenCalledOnce()
  expect(await f.step()).toMatchObject({ kind: 'enter' })
})

it('uses effective native cwd for file permission and persists relayed provenance through the native inbox', async () => {
  const f = await fixture()
  f.access.registerGuest('reader', 'one', { ...SHARED_CONTROL_GRANT, capabilities: ['view', 'message', 'read-files'] }, () => true)
  await f.step([f.message('reader')])
  const exec = f.tool('read', { file_path: 'file.txt' })
  expect(f.guards[0]!(exec)).toBeUndefined()
  f.services.workingDirectory = { get: () => join(f.root, 'other', 'project') }
  expect(f.guards[0]!(exec)).toBeTypeOf('string')
  const replace = vi.fn(() => true)
  await f.hooks.get('tools/execute')!(exec, async () => f.hooks.get('agent/inbox/inserted')!({
    agent: { inbox: { replace } }, message: { id: 'relay', source: { kind: 'other-tool' }, content: [] },
  }))
  expect(replace).toHaveBeenCalledWith('relay', expect.objectContaining({ source: expect.objectContaining({ principal: expect.objectContaining({ kind: 'bay-workbench', accessId: 'reader' }) }) }))
})

it('filters the native boot control baseline and every later frame instead of leaking all live Sessions', async () => {
  const f = await fixture()
  const gateway = f.services.typertGateway as { wireStream: { open: Function } }
  gateway.wireStream.open = async function* () {
    yield { type: 'baseline', value: { projections: { 'one-session': { values: { title: 'visible' } }, 'other-session': { values: { title: 'private' } } } } }
    yield { type: 'projection', sessionId: 'other-session', seq: 1, changes: [{ key: 'title', val: 'private' }] }
    yield { type: 'projection', sessionId: 'one-session', seq: 2, changes: [{ key: 'title', val: 'visible next' }] }
  }
  const stream = await f.transport.openStream('session/control', { args: {} }, f.guest(), new AbortController().signal)
  const frames = []; for await (const frame of stream) frames.push(frame)
  expect(frames).toEqual([
    { type: 'baseline', value: { projections: { 'one-session': { values: { title: 'visible' } } } } },
    { type: 'projection', sessionId: 'one-session', seq: 2, changes: [{ key: 'title', val: 'visible next' }] },
  ])
  expect(JSON.stringify(f.transport.bootstrap(f.guest()))).toContain('session/control')
})

it('rejects an inherited child execution until its explicit Session catalog entry exists', async () => {
  const f = await fixture(), child = { id: 'new-worker', cancel: vi.fn() }, messages = [f.message()]
  const step = () => f.hooks.get('agent/pre-step')!({ agent: child, messages, turn: 1 }, async () => ({ kind: 'enter', messages }))
  expect(await step()).toEqual({ kind: 'reject' })
  await f.access.directory.registerSession('one', child.id, { sessionKey: 'new-logical', role: 'worker', areaId: 'area', relativePath: 'project', title: 'delegation', agentPreset: 'default', createdAt: 2 })
  expect(await step()).toMatchObject({ kind: 'enter' })
  f.access.revoke('guest')
  expect(await step()).toEqual({ kind: 'reject' })
})

it('streams only uploads for authorized Sessions and rechecks access as bytes arrive', async () => {
  const f = await fixture(), uploadStream = vi.fn(async ({ data }: { data: AsyncIterable<Uint8Array> }) => {
    let length = 0; for await (const chunk of data) length += chunk.length
    return { receiptId: 'receipt', file: { attachmentId: 'stored', bytes: length } }
  })
  f.services.fileUploads = { uploadStream }
  const upload = (sessionId: string) => f.transport.handleHttp(new Request('http://host/api/session/uploadFileBinary?sessionId=' + sessionId, {
    method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: Buffer.from('data'),
  }), f.guest())
  expect(await (await upload('one-session')).json()).toMatchObject({ ok: true, value: { receiptId: 'receipt', file: { bytes: 4 } } })
  expect((await upload('other-session')).status).toBe(403)
  expect((await upload('main')).status).toBe(200)
  expect(uploadStream).toHaveBeenCalledTimes(2)
})

it('hides other workbenches and guest-blocked assembled presets from the native picker and refuses to select them', async () => {
  const open = new Set(['bay:one:open@1'])
  const roster = { presets: [{ id: 'standard', isDefault: true }, { id: 'bay:one:open@1', isDefault: false }, { id: 'bay:one:secret@1', isDefault: false }, { id: 'bay:other:x@1', isDefault: false }] }
  const f = await fixture({
    sharedFetch: async () => Response.json({ type: 'server-response', rpcId: 'rpc', result: { ok: true, value: roster } }),
    services: { workbenchAgentAssembly: { offers: (workbenchId: string, presetId: string, guest: boolean) => !presetId.startsWith('bay:') || (workbenchId === 'one' && (!guest || open.has(presetId)) && !presetId.startsWith('bay:other:')) } },
  })
  const listed = await f.http('agentPresets/list', {}) as { result: { value: { presets: { id: string }[] } } }
  expect(listed.result.value.presets.map(row => row.id)).toEqual(['standard', 'bay:one:open@1'])
  const denied = await f.http('agentPresets/select', { agentId: 'one-session', agentPreset: 'bay:one:secret@1' })
  expect(denied).toMatchObject({ result: { ok: false } })
  expect(f.invoke).not.toHaveBeenCalled()
  const foreign = await f.http('agentPresets/select', { agentId: 'one-session', agentPreset: 'bay:other:x@1' })
  expect(foreign).toMatchObject({ result: { ok: false } })
  // Positive control: the same guest may select an open preset, so the denials above came from the preset check.
  expect(await f.http('agentPresets/select', { agentId: 'one-session', agentPreset: 'bay:one:open@1' })).toMatchObject({ result: { ok: true } })
  expect(f.invoke).toHaveBeenCalledTimes(1)
})
