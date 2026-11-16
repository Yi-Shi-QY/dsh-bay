import { describe, expect, it } from 'vitest'
import { createWorkbenchCollaborationManager } from '../src/host-workbench-collaboration.ts'
import { createWorkbenchDesktopCollaborationChannel } from '../src/host-workbench-collaboration-desktop.ts'
import { createDesktopWorkbenchCollaborationClient, type WorkbenchCollaborationRpcCall } from '../src/client/workbench-collaboration-desktop.ts'

const SEED = { areas: [{ areaId: 'area-a' }], editors: [{ areaId: 'area-a', editorId: 'editor-a' }] }

async function setup() {
  const manager = createWorkbenchCollaborationManager({ loadSeed: () => SEED })
  let desktopControls = true
  const channel = createWorkbenchDesktopCollaborationChannel({ collaboration: manager, canControl: () => desktopControls, pollHoldMs: 20 })
  const call: WorkbenchCollaborationRpcCall = async (action, payload) => {
    const result = await channel.handle(action, payload)
    if (!result.ok) throw new Error(result.code)
    return result.value
  }
  return { manager, channel, call, setDesktopControls(value: boolean) { desktopControls = value } }
}

async function until(check: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    if (check()) return
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  throw new Error('condition was not reached')
}

describe('desktop collaboration channel', () => {
  it('refuses a Workbench without a session or one a browser owner controls', async () => {
    const f = await setup()
    expect(await f.channel.handle('open', { workbenchId: 'workbench-a' })).toEqual({ ok: false, code: 'collaboration-unavailable' })
    await f.manager.start('workbench-a', 'owner')
    f.setDesktopControls(false)
    expect(await f.channel.handle('open', { workbenchId: 'workbench-a' })).toEqual({ ok: false, code: 'browser-controls-workbench' })
    expect(await f.channel.handle('poll', { connectionId: 'unknown' })).toEqual({ ok: false, code: 'collaboration-connection-not-found' })
    f.channel.dispose()
  })

  it('joins the desktop as owner and exchanges commands and events with a participant', async () => {
    const f = await setup()
    const started = await f.manager.start('workbench-a', 'owner')
    const desktop = createDesktopWorkbenchCollaborationClient({ call: f.call })
    expect(desktop.client.getState()).toBe('idle')
    desktop.setTarget('workbench-a')
    await until(() => desktop.client.getState() === 'connected')
    expect(desktop.client.getSnapshot()?.collaborationId).toBe(started.collaborationId)

    started.session.connect({ collaborationId: started.collaborationId, workbenchId: 'workbench-a', participantId: 'guest', displayName: 'Guest', role: 'participant' })
    await until(() => desktop.client.getSnapshot()?.participants.some(row => row.participantId === 'guest') === true)

    const ensured = await desktop.client.command({ kind: 'draft.ensure', draftId: 'draft-a', areaId: 'area-a', editorId: 'editor-a' })
    expect(ensured.ok).toBe(true)
    const typed = await started.session.command({
      requestId: 'guest-type', collaborationId: started.collaborationId, workbenchId: 'workbench-a', participantId: 'guest', baseRevision: 0,
      operation: { kind: 'draft.apply', operation: { draftId: 'draft-a', baseRevision: 0, requestId: 'guest-type', participantId: 'guest', operations: [{ type: 'insert', text: 'hi' }] } },
    })
    expect(typed.ok).toBe(true)
    await until(() => desktop.client.getSnapshot()?.drafts['draft-a']?.text === 'hi')
    // The owner role comes from the Host, whatever the frame claims.
    const locked = await desktop.client.command({ kind: 'canvas.set-focus-lock', locked: true })
    expect(locked.ok).toBe(true)
    expect(started.session.snapshot().sharedCanvas.fixedByOwner).toBe(true)

    desktop.dispose()
    await until(() => started.session.snapshot().participants.find(row => row.participantId === 'owner')?.connectionState === 'stale')
    f.channel.dispose()
  })

  it('ends the desktop connection when the share stops and follows a new target', async () => {
    const f = await setup()
    await f.manager.start('workbench-a', 'owner')
    const desktop = createDesktopWorkbenchCollaborationClient({ call: f.call, reconnectDelayMs: 10_000 })
    desktop.setTarget('workbench-a')
    await until(() => desktop.client.getState() === 'connected')
    await f.manager.stop('workbench-a')
    await until(() => desktop.client.getState() === 'closed')

    await f.manager.start('workbench-b', 'owner')
    desktop.setTarget('workbench-b')
    await until(() => desktop.client.getState() === 'connected')
    expect(desktop.client.getSnapshot()?.workbenchId).toBe('workbench-b')
    desktop.setTarget(undefined)
    expect(desktop.client.getState()).toBe('idle')
    expect(desktop.client.getSnapshot()).toBeUndefined()
    await expect(desktop.client.command({ kind: 'canvas.set-focus-lock', locked: true })).rejects.toThrow('workbench-collaboration-idle')
    desktop.dispose()
    f.channel.dispose()
  })

  it('ends the desktop connection when a browser owner takes the Workbench', async () => {
    const f = await setup()
    await f.manager.start('workbench-a', 'owner')
    const desktop = createDesktopWorkbenchCollaborationClient({ call: f.call, reconnectDelayMs: 10_000 })
    desktop.setTarget('workbench-a')
    await until(() => desktop.client.getState() === 'connected')
    f.setDesktopControls(false)
    await until(() => desktop.client.getState() === 'closed')
    desktop.dispose()
    f.channel.dispose()
  })

  it('keeps the owner connected while one of two owner connections remains', async () => {
    const f = await setup()
    const started = await f.manager.start('workbench-a', 'owner')
    const first = createDesktopWorkbenchCollaborationClient({ call: f.call })
    const second = createDesktopWorkbenchCollaborationClient({ call: f.call })
    first.setTarget('workbench-a')
    second.setTarget('workbench-a')
    await until(() => first.client.getState() === 'connected' && second.client.getState() === 'connected')
    const owner = () => started.session.snapshot().participants.find(row => row.participantId === 'owner')?.connectionState
    first.dispose()
    await new Promise(resolve => setTimeout(resolve, 60))
    expect(owner()).toBe('connected')
    expect((await second.client.command({ kind: 'canvas.set-focus-lock', locked: true })).ok).toBe(true)
    second.dispose()
    await until(() => owner() === 'stale')
    f.channel.dispose()
  })
})
