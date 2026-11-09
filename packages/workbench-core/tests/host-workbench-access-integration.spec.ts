import { afterEach, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { mkdir, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileAccessFixture } from './helpers/file-access.ts'
import { createHostBrowserWindowController } from '../src/host-browser-window-controller.ts'
import { installWorkbenchDirectoryRoute } from '../src/host-workbench-directory-route.ts'
import { COLLABORATION_GRANT, REVIEW_GRANT, WORKBENCH_ACCESS_HEADER } from '../src/workbench-access-contract.ts'
import { createFileWorkbenchSettings } from '../src/client/file-workbench-settings.ts'
import { createProjectNeutralFrameSettings } from '../src/foundation/frame-settings-adapter.ts'

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
    expect(scoped.value.extensionConsents?.['@example/ins::example.ins']).toMatchObject({ allowed: true })

    const mirror = createFileWorkbenchSettings((async (_input, init) => f.call(JSON.parse(String(init?.body)), owner.token)) as typeof fetch)
    cleanup.push(() => mirror.dispose())
    await mirror.refresh()
    expect(mirror.scope.getSnapshot().value?.extensionConsents?.['@example/ins::example.ins']).toMatchObject({ allowed: true })
    expect(mirror.scope.getSnapshot().value?.globalHiddenEditorIds).toEqual(['example.hidden'])
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

  it('keeps guests alive when the browser hands control back and blocks Main, foreign Sessions and reduced grants', async () => {
    const f = await setup()
    for (const areaId of ['area-a', 'area-b']) await f.directory.bindArea({ workbenchId: 'workbench-a', areaId, relativePath: 'shared', createDirectory: true, expectedRevision: f.directory.getSnapshot().revision })
    for (const [sessionId, areaId, role] of [['one', 'area-a', 'user'], ['two', 'area-b', 'worker'], ['main', undefined, 'main']] as const) await f.directory.registerSession('workbench-a', sessionId, { sessionKey: sessionId, ...(areaId ? { areaId } : {}), relativePath: areaId ? 'shared' : '', role, title: sessionId, agentPreset: 'standard', createdAt: 1 })
    const token = f.access.registerGuest('guest', 'workbench-a', { ...COLLABORATION_GRANT, areaIds: ['area-a'] }, () => true)
    const guest = f.access.resolve(new Headers({ [WORKBENCH_ACCESS_HEADER]: token }))
    const scoped = f.access.snapshot(guest).value.workbenches['workbench-a']!
    expect(Object.keys(scoped.areaProjects!)).toEqual(['area-a'])
    expect(Object.keys(scoped.sessionCatalog!)).toEqual(['one'])
    expect(() => f.access.authorize(guest, 'view', { workbenchId: 'workbench-a', sessionId: 'main' })).toThrow('区域')
    const owner = await f.open(); await f.controller.handle('ready', owner.proof)
    await f.controller.handle('reclaim', { windowId: owner.proof.windowId })
    await f.controller.handle('reclaimed', { closeToken: owner.token })
    expect(f.access.controller('workbench-a')).toBe('desktop')
    expect(() => f.access.authorize(guest, 'message', { workbenchId: 'workbench-a', sessionId: 'one' })).not.toThrow()
    expect(() => f.access.authorize(guest, 'message', { workbenchId: 'workbench-a', sessionId: 'two' })).toThrow('区域')
    expect(() => f.access.authorize(guest, 'message', { workbenchId: 'workbench-a', sessionId: 'main' })).toThrow('Bay Agent')
    expect(() => f.access.authorize(guest, 'view', { workbenchId: 'workbench-a', sessionId: 'foreign' })).toThrow('会话')
    f.access.reduceGuest('guest', { ...REVIEW_GRANT, areaIds: ['area-a'] })
    expect(() => f.access.authorize(guest, 'message', { workbenchId: 'workbench-a', sessionId: 'one' })).toThrow('变化')
    const current = f.access.resolve(new Headers({ [WORKBENCH_ACCESS_HEADER]: token }))
    expect(() => f.access.authorize(current, 'message', { workbenchId: 'workbench-a', sessionId: 'one' })).toThrow('授权')
    expect(() => f.access.reduceGuest('guest', COLLABORATION_GRANT)).toThrow('重新建立')
  })

  it('guards real paths and treats shared directories as separate conversation scopes', async () => {
    const f = await setup()
    await f.directory.bindArea({ workbenchId: 'workbench-a', areaId: 'area-a', relativePath: 'app', createDirectory: true, expectedRevision: f.directory.getSnapshot().revision })
    const outside = join(f.root, 'external'); await mkdir(outside)
    await symlink(outside, join(f.directory.rootPath('workbench-a'), 'app', 'escape'), process.platform === 'win32' ? 'junction' : 'dir')
    const token = f.access.registerGuest('guest', 'workbench-a', { template: 'collaborate', capabilities: ['view', 'read-files'], paths: ['app'] }, () => true)
    expect((await f.call({ action: 'project-read', workbenchId: 'workbench-a', relativePath: 'app/escape/a.txt' }, token)).status).toBe(403)
    expect((await f.call({ action: 'project-read', workbenchId: 'workbench-a', relativePath: '.bay/workbench.json' }, token)).status).toBe(403)
    expect((await f.call({ action: 'register-session', workbenchId: 'workbench-a', requestId: 'steal', sessionId: 'foreign' }, token)).status).toBe(403)
    const snapshot = await (await f.call({ action: 'snapshot' }, token)).json()
    expect(snapshot.snapshot.value.workbenches['workbench-a'].fileWorkbench.rootPath).toBeUndefined()
  })

  it('preserves hidden definitions when an area-scoped guest edits its own background metadata', async () => {
    const f = await setup()
    const before = structuredClone(f.directory.getSnapshot().value.workbenches['workbench-a']!)
    before.areaMetadata = { 'area-a': { label: 'Visible', ownership: 'human', createdAt: 1, updatedAt: 1 }, 'area-b': { label: 'Private', ownership: 'human', createdAt: 1, updatedAt: 1 } }
    await f.directory.patch({ operation: 'set', path: ['workbenches', 'workbench-a'], value: before })
    const token = f.access.registerGuest('scoped-edit', 'workbench-a', { template: 'collaborate', capabilities: ['view', 'layout'], areaIds: ['area-a'] }, () => true)
    const actor = f.access.resolve(new Headers({ [WORKBENCH_ACCESS_HEADER]: token }))
    const scoped = f.access.snapshot(actor).value.workbenches['workbench-a']!
    expect(scoped.areaMetadata?.['area-b']).toBeUndefined()
    scoped.areaMetadata!['area-a']!.label = 'Edited visible'
    const response = await f.call({ action: 'patch', requestId: 'edit-scoped-label', operation: { operation: 'set', path: ['workbenches', 'workbench-a'], value: scoped, expectedRevision: f.directory.getSnapshot().revision } }, token)
    expect(response.status, await response.clone().text()).toBe(200)
    expect(f.directory.getSnapshot().value.workbenches['workbench-a']!.areaMetadata).toMatchObject({ 'area-a': { label: 'Edited visible' }, 'area-b': { label: 'Private' } })
  })

  it('waits for accepted writes and rejects new guest writes while taking a snapshot', async () => {
    const f = await setup()
    const token = f.access.registerGuest('editor', 'workbench-a', { template: 'collaborate', capabilities: ['view', 'layout'] }, () => true)
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
    expect(() => f.access.authorizeAcceptedExecution(guest, 'memory', { workbenchId: 'workbench-a' })).toThrow('授权')
    expect(() => f.access.authorizeAcceptedExecution(guest, 'layout', { workbenchId: 'other' })).toThrow('当前工作台')
    finish(); await write; await snapshot
    expect(copied).toBe(true)
    expect(f.access.isSnapshotting('workbench-a')).toBe(false)
  })

  it('does not call a missing directory ready or fall back to Settings', async () => {
    const f = await setup()
    expect(await f.controller.handle('prepare', { workbenchId: 'legacy-only' })).toMatchObject({ ok: false })
    const { rm } = await import('node:fs/promises')
    await rm(join(f.directory.rootPath('workbench-a'), '.bay', 'workbench.json'))
    expect(await f.controller.handle('prepare', { workbenchId: 'workbench-a' })).toMatchObject({ ok: false })
    await writeFile(join(f.directory.rootPath('workbench-a'), '.bay', 'workbench.json'), '{broken')
    expect(await f.controller.handle('prepare', { workbenchId: 'workbench-a' })).toMatchObject({ ok: false })
  })
})
