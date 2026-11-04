import { describe, expect, it } from 'vitest'
import { decodeFloatingHandoff, type FloatingHandoffV1 } from '../src/floating-handoff.ts'
import { createHostBrowserWindowController } from '../src/host-browser-window-controller.ts'
import { createFloatingWorkspaceRuntime } from '../src/client/floating-workspace-runtime.ts'
import { guestDistributionDenied } from '../src/host-distribution-guest-guard.ts'
import type { TabDocument } from '../src/foundation/model.ts'

const tab = (id: string): TabDocument => ({ id, editorId: 'test.editor', editorScope: 'session', sessionId: id,
  binding: { workspaceId: 'project', sessionId: id }, lastKnownTitle: id, state: { path: id } })
const snapshot = (...ids: string[]): FloatingHandoffV1 => ({ version: 1, tabs: ids.map(tab), expanded: true, pinnedIds: [], ...(ids[0] ? { activeId: ids[0] } : {}) })
function value<T>(result: { ok: boolean; value?: unknown }): T {
  if (!result.ok) throw new Error('Host request rejected')
  return result.value as T
}
async function hostView(shared = false) {
  const host = createHostBrowserWindowController({ origin: 'http://127.0.0.1:4200', authenticatedUrl: url => { const value = new URL(url); value.searchParams.set('token', 'test'); return value.href }, lookupWorkbench: () => true })
  const prepared = value<{ windowId: string; url: string }>(await host.handle(shared ? 'prepare-shared' : 'prepare', { workbenchId: 'one' }))
  const redeem = async () => ({ closeToken: value<{ view: { closeToken: string } }>(await host.handle('redeem', { ticket: new URL(prepared.url).searchParams.get('workbench') })).view.closeToken })
  return { host, prepared, redeem }
}

describe('temporary workspace control handoff', () => {
  it('round trips order, selected tab and independent bindings without geometry or other workbenches', async () => {
    const source = createFloatingWorkspaceRuntime(), receiver = createFloatingWorkspaceRuntime()
    source.open('one', tab('a')); source.open('one', tab('b')); source.open('other', tab('private'))
    source.patch('one', { rect: { x: 30, y: 20, width: 720, height: 480 } })
    const sent = source.snapshotHandoff('one')
    expect(JSON.stringify(sent)).not.toContain('rect'); expect(sent.tabs.map(t => t.id)).toEqual(['a', 'b'])
    receiver.restoreHandoff('one', sent)
    expect(receiver.workspace('one').activeId).toBe('b')
    expect(receiver.find('a', 'one')?.tab.binding?.sessionId).toBe('a')
    await receiver.close('a', 'one'); receiver.open('one', tab('c'))
    await receiver.transfer('b', async () => true, 'one')
    source.restoreHandoff('one', receiver.snapshotHandoff('one'))
    expect(source.find('a', 'one')).toBeUndefined()
    expect(source.find('b', 'one')?.location).toBe('area')
    expect(source.find('c', 'one')?.location).toBe('floating')
    expect(source.find('private', 'other')).toBeDefined()
    expect(source.workspace('one').rect?.x).toBe(30)
    expect(source.workspace('one').activeId).toBe('c')
    source.restoreHandoff('one', snapshot('c', 'd'))
    source.restoreHandoff('one', snapshot('d', 'c'))
    expect(source.snapshotHandoff('one').tabs.map(t => t.id)).toEqual(['d', 'c'])
  })

  it('rejects a changed identity and busy transfer before altering source content', () => {
    const runtime = createFloatingWorkspaceRuntime(); runtime.open('one', tab('a')); runtime.open('one', tab('b'))
    const changed = snapshot('b'); changed.tabs[0]!.editorId = 'different'
    expect(() => runtime.restoreHandoff('one', changed)).toThrow('身份')
    expect(runtime.find('a', 'one')).toBeDefined()
    runtime.find('a', 'one')!.busy = true
    expect(() => runtime.snapshotHandoff('one')).toThrow()
    expect(() => runtime.restoreHandoff('one', snapshot())).toThrow()
    expect(runtime.find('a', 'one')).toBeDefined()
  })

  it('validates bounded JSON, duplicate IDs and exact bindings', () => {
    expect(decodeFloatingHandoff(snapshot('a'))?.tabs[0]?.sessionStates).toBeDefined()
    expect(decodeFloatingHandoff(snapshot('a', 'a'))).toBeUndefined()
    const invalid = snapshot('a'); invalid.tabs[0]!.binding!.sessionId = 'other'
    expect(decodeFloatingHandoff(invalid)).toBeUndefined()
    expect(decodeFloatingHandoff({ ...snapshot('a'), tabs: Array(65).fill(tab('a')) })).toBeUndefined()
    expect(decodeFloatingHandoff({ ...snapshot('a'), activeId: 'missing' })).toBeUndefined()
    expect(decodeFloatingHandoff({ ...snapshot('a'), pinnedIds: ['a'] })).toBeUndefined()
    expect(decodeFloatingHandoff({ ...snapshot('a'), tabs: [{ ...tab('a'), state: 'x'.repeat(600_000) }] })).toBeUndefined()
  })

  it('accepts an explicit newer binding and new-conversation promotion, but rejects stale rebinding', () => {
    const runtime = createFloatingWorkspaceRuntime()
    runtime.open('one', tab('a'))
    const rebound = snapshot('a'); Object.assign(rebound.tabs[0]!, { sessionId: 'new', binding: { sessionId: 'new' }, bindingGeneration: 1 })
    runtime.restoreHandoff('one', rebound)
    expect(runtime.find('a', 'one')?.tab.binding?.sessionId).toBe('new')
    expect(() => runtime.restoreHandoff('one', snapshot('a'))).toThrow('身份')
    runtime.open('one', { ...tab('start'), editorId: 'workbench.conversation.start' })
    const promoted = snapshot('start'); promoted.tabs[0]!.editorId = 'workbench.conversation'
    runtime.restoreHandoff('one', promoted)
    expect(runtime.find('start', 'one')?.tab.editorId).toBe('workbench.conversation')
  })

  it('does not close a stale source instance after the other carrier takes control', async () => {
    const runtime = createFloatingWorkspaceRuntime(); runtime.open('one', tab('a'))
    runtime.hasControl = () => false
    expect(await runtime.close('a', 'one')).toBe(false)
    expect(runtime.find('a', 'one')).toBeDefined()
  })

  it('stages before navigation and applies a return receipt only after reclaim acknowledgement', async () => {
    const { host, prepared, redeem } = await hostView()
    expect((await host.handle('floating-stage', { windowId: prepared.windowId, snapshot: snapshot('a') })).ok).toBe(true)
    const view = await redeem()
    expect((await host.handle('floating-read', { windowId: prepared.windowId, closeToken: 'bad' })).ok).toBe(false)
    expect(value<{ snapshot: FloatingHandoffV1 }>(await host.handle('floating-read', { windowId: prepared.windowId, ...view })).snapshot.tabs[0]?.id).toBe('a')
    expect(value<{ snapshot: FloatingHandoffV1 }>(await host.handle('floating-read', { windowId: prepared.windowId, ...view })).snapshot.tabs[0]?.id).toBe('a')
    expect((await host.handle('floating-stage', { windowId: prepared.windowId, snapshot: snapshot('bad') })).ok).toBe(false)
    await host.handle('ready', { windowId: prepared.windowId }); await host.handle('reclaim', { windowId: prepared.windowId })
    expect(value(await host.handle('floating-read', { windowId: prepared.windowId, ...view }))).toEqual({ snapshot: null })
    expect((await host.handle('reclaimed', view)).ok).toBe(false)
    const receipt = { ...view, floating: snapshot('b') }
    expect((await host.handle('reclaimed', receipt)).ok).toBe(true)
    expect((await host.handle('reclaimed', receipt)).ok).toBe(true)
    expect((await host.handle('reclaimed', { ...view, floating: snapshot('c') })).ok).toBe(false)
    expect(value<{ snapshot: FloatingHandoffV1 }>(await host.handle('floating-read', { windowId: prepared.windowId })).snapshot.tabs[0]?.id).toBe('b')
    host.dispose()
  })

  it('never replays the outgoing snapshot when the browser disappears without a return receipt', async () => {
    const { host, prepared, redeem } = await hostView()
    await host.handle('floating-stage', { windowId: prepared.windowId, snapshot: snapshot('a') })
    const view = await redeem(); await host.handle('ready', { windowId: prepared.windowId })
    await host.handle('closed', view)
    expect(value(await host.handle('floating-read', { windowId: prepared.windowId }))).toEqual({ snapshot: null, incomplete: true })
    host.dispose()
  })

  it('accepts a bounded close receipt and denies shared views and equivalent guest routes', async () => {
    const { host, prepared, redeem } = await hostView()
    await host.handle('floating-stage', { windowId: prepared.windowId, snapshot: snapshot('a') })
    const view = await redeem(); await host.handle('ready', { windowId: prepared.windowId })
    await host.handle('closed', { ...view, floating: snapshot('b') })
    expect(value<{ snapshot: FloatingHandoffV1 }>(await host.handle('floating-read', { windowId: prepared.windowId })).snapshot.tabs[0]?.id).toBe('b')
    host.dispose()
    const shared = await hostView(true)
    expect((await shared.host.handle('floating-stage', { windowId: shared.prepared.windowId, snapshot: snapshot('a') })).ok).toBe(false)
    shared.host.dispose()
    for (const path of ['workbench-window/floating-read', '/api/workbench-window/floating-stage', '/api/workbench-window%2Ffloating-read']) expect(guestDistributionDenied(path)).toBe(true)
  })
})
