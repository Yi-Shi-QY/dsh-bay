import { describe, expect, it } from 'vitest'
import { createWorkbenchCollaborationClient } from '../src/client/workbench-collaboration-client.ts'

class FakeSocket {
  static instances: FakeSocket[] = []
  static reset() { FakeSocket.instances = [] }
  readonly sent: any[] = []
  readyState = 0
  onopen?: () => void
  onmessage?: (event: { data: string }) => void
  onerror?: () => void
  onclose?: () => void
  constructor(readonly url: string) { FakeSocket.instances.push(this) }
  send(value: string) { this.sent.push(JSON.parse(value)) }
  open() { this.readyState = 1; this.onopen?.() }
  receive(value: unknown) { this.onmessage?.({ data: JSON.stringify(value) }) }
  close() { if (this.readyState === 3) return; this.readyState = 3; this.onclose?.() }
}

function snapshot() {
  return {
    schemaVersion: 1,
    collaborationId: 'collab-client', workbenchId: 'workbench-a', ownerParticipantId: 'owner',
    workbenchRevision: 0, canvasRevision: 0, definition: {}, areas: [], editors: [], sessions: [], projects: [], tasks: [], memories: [], contexts: [],
    sharedCanvas: { viewport: { width: 1280, height: 800, scaleMode: 'contain' }, layout: undefined, floatingPanels: [], fixedByOwner: false },
    drafts: {}, participants: [], redactions: [], unavailableCapabilities: [],
  }
}

describe('Workbench collaboration client recovery', () => {
  it('applies Host task snapshots from collaboration events', async () => {
    FakeSocket.reset()
    const client = createWorkbenchCollaborationClient({
      url: 'ws://workbench', WebSocket: FakeSocket as never,
      collaborationId: 'collab-client', workbenchId: 'workbench-a', participantId: 'owner', displayName: 'Owner', role: 'owner',
    })
    const connected = client.connect()
    const socket = FakeSocket.instances[0]!
    socket.open()
    socket.receive({ type: 'server.snapshot', payload: snapshot() })
    await connected
    socket.receive({ type: 'server.event', payload: {
      eventId: 'task-event-1', collaborationId: 'collab-client', workbenchId: 'workbench-a',
      workbenchRevision: 1, canvasRevision: 0, actorId: 'host', kind: 'task.changed',
      payload: { tasks: [{ workItemId: 'task-1', status: 'running' }] },
    } })
    expect(client.getSnapshot()?.tasks).toEqual([{ workItemId: 'task-1', status: 'running' }])
    client.disconnect()
  })

  it('applies transformed shared selections from draft events', async () => {
    FakeSocket.reset()
    const client = createWorkbenchCollaborationClient({
      url: 'ws://workbench', WebSocket: FakeSocket as never,
      collaborationId: 'collab-client', workbenchId: 'workbench-a', participantId: 'owner', displayName: 'Owner', role: 'owner',
    })
    const connected = client.connect()
    const socket = FakeSocket.instances[0]!
    socket.open()
    socket.receive({ type: 'server.snapshot', payload: { ...snapshot(), drafts: {
      draft: { draftId: 'draft', areaId: 'area', editorId: 'editor', text: 'abcdef', revision: 0, attachments: [], selections: { remote: { start: 3, end: 5 } } },
    } } })
    await connected
    socket.receive({ type: 'server.event', payload: {
      eventId: 'draft-event-1', collaborationId: 'collab-client', workbenchId: 'workbench-a',
      workbenchRevision: 1, canvasRevision: 0, actorId: 'owner', kind: 'draft.changed',
      payload: { draftId: 'draft', text: 'abXYcdef', revision: 1, selections: { remote: { start: 5, end: 7 } } },
    } })
    expect(client.getSnapshot()?.drafts.draft?.selections.remote).toEqual({ start: 5, end: 7 })
    client.disconnect()
  })

  it('clears the shared draft on every client when the Host clears it', async () => {
    FakeSocket.reset()
    const client = createWorkbenchCollaborationClient({
      url: 'ws://workbench', WebSocket: FakeSocket as never,
      collaborationId: 'collab-client', workbenchId: 'workbench-a', participantId: 'guest', displayName: 'Guest', role: 'participant',
    })
    const connected = client.connect()
    const socket = FakeSocket.instances[0]!
    socket.open()
    socket.receive({ type: 'server.snapshot', payload: { ...snapshot(), drafts: {
      draft: { draftId: 'draft', areaId: 'area', editorId: 'editor', text: 'unsent', revision: 3, attachments: ['file-1'], selections: {} },
    } } })
    await connected
    socket.receive({ type: 'server.event', payload: {
      eventId: 'draft-cleared-1', collaborationId: 'collab-client', workbenchId: 'workbench-a',
      workbenchRevision: 0, canvasRevision: 1, actorId: 'owner', kind: 'draft.cleared',
      payload: { draftId: 'draft', areaId: 'area', editorId: 'editor', text: '', revision: 4, attachments: [], selections: {} },
    } })
    expect(client.getSnapshot()?.drafts.draft).toMatchObject({ text: '', revision: 4, attachments: [] })
    client.disconnect()
  })

  it('replays an idempotent command after reconnecting and rejects new writes while recovering', async () => {
    FakeSocket.reset()
    const client = createWorkbenchCollaborationClient({
      url: 'ws://workbench', WebSocket: FakeSocket as never, reconnectDelayMs: 0,
      collaborationId: 'collab-client', workbenchId: 'workbench-a', participantId: 'owner', displayName: 'Owner', role: 'owner',
    })
    const connected = client.connect()
    const first = FakeSocket.instances[0]!
    first.open()
    first.receive({ type: 'server.snapshot', payload: snapshot() })
    await connected
    const command = client.command({ kind: 'canvas.set-focus', focus: { areaId: 'area-a', editorId: 'workbench.conversation' } })
    const request = first.sent.find(value => value.type === 'client.command')
    expect(request?.payload.requestId).toEqual(expect.any(String))
    first.close()
    expect(client.getState()).toBe('recovering')
    await expect(client.command({ kind: 'canvas.set-focus', focus: { areaId: 'area-b', editorId: 'workbench.conversation' } })).rejects.toThrow('recovering')

    await new Promise(resolve => setTimeout(resolve, 0))
    const second = FakeSocket.instances[1]!
    second.open()
    second.receive({ type: 'server.snapshot', payload: snapshot() })
    await new Promise(resolve => setTimeout(resolve, 0))
    const replay = second.sent.find(value => value.type === 'client.command')
    expect(replay?.payload.requestId).toBe(request.payload.requestId)
    second.receive({ type: 'server.command-result', payload: { ok: true, requestId: request.payload.requestId, workbenchRevision: 1, canvasRevision: 0, value: { committed: true } } })
    await expect(command).resolves.toMatchObject({ ok: true, requestId: request.payload.requestId })
    client.disconnect()
  })
})
