import { describe, expect, it } from 'vitest'
import { createWorkbenchCollaborationSession } from '../src/host-workbench-collaboration.ts'
import { createWorkbenchSharedDraftBinding } from '../src/client/workbench-shared-draft-binding.ts'
import type { WorkbenchCollaborationClientV1 } from '../src/client/workbench-collaboration-client.ts'
import type {
  WorkbenchCollaborationEventV1,
  WorkbenchCollaborationSnapshotV1,
  WorkbenchCommandResultV1,
  WorkbenchCommandV1,
} from '../src/workbench-collaboration-contract.ts'

const DRAFT = 'draft:area-a:editor-a:'

function createHost() {
  let id = 0
  const session = createWorkbenchCollaborationSession('collab', 'workbench', 'owner', {
    areas: [{ areaId: 'area-a' }],
    editors: [{ areaId: 'area-a', editorId: 'editor-a' }],
    sessions: [{ sessionId: 'session-a' }],
  }, { randomId: () => `id-${id += 1}` })
  return session
}

/**
 * A client whose network is driven by the test. Commands and events wait in
 * queues until the test delivers them, so any interleaving can be produced.
 */
function createPeer(host: ReturnType<typeof createHost>, participantId: string, role: 'owner' | 'participant', lateEditor = false) {
  const joined = host.connect({ collaborationId: 'collab', workbenchId: 'workbench', participantId, displayName: participantId, role })
  if ('error' in joined) throw new Error(joined.error)
  let snapshot: WorkbenchCollaborationSnapshotV1 = joined
  let state: ReturnType<WorkbenchCollaborationClientV1['getState']> = 'connected'
  let request = 0
  const listeners = new Set<(snapshot: WorkbenchCollaborationSnapshotV1 | undefined, event?: WorkbenchCollaborationEventV1) => void>()
  const outbox: (() => Promise<void>)[] = []
  const inbox: (() => void)[] = []
  const sent: WorkbenchCommandV1[] = []
  host.subscribe(event => {
    inbox.push(() => {
      // The real client keeps its snapshot current from events. The Host
      // snapshot at delivery time is not used here, only the event content.
      const payload = event.payload as { draftId?: string; text?: string; revision?: number }
      if ((event.kind === 'draft.changed' || event.kind === 'draft.created' || event.kind === 'draft.cleared' || event.kind === 'draft.attachments.changed') && typeof payload.draftId === 'string') {
        const previous = snapshot.drafts[payload.draftId]
        const next = event.kind === 'draft.changed' || event.kind === 'draft.attachments.changed'
          ? { ...previous!, ...(typeof payload.text === 'string' ? { text: payload.text } : {}), revision: payload.revision! }
          : payload as never
        snapshot = { ...snapshot, drafts: { ...snapshot.drafts, [payload.draftId]: next } }
      }
      for (const listener of [...listeners]) listener(snapshot, event)
    })
  })
  const client: Pick<WorkbenchCollaborationClientV1, 'participantId' | 'command' | 'subscribe' | 'getSnapshot' | 'getState'> = {
    participantId,
    command(operation) {
      if (state !== 'connected') return Promise.reject(new Error('workbench-collaboration-recovering'))
      sent.push(operation)
      const requestId = `${participantId}-${request += 1}`
      return new Promise<WorkbenchCommandResultV1>(resolve => {
        outbox.push(async () => {
          const result = await host.command({ requestId, collaborationId: 'collab', workbenchId: 'workbench', participantId, baseRevision: 0, operation })
          inbox.push(() => resolve(result))
        })
      })
    },
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener) } },
    getSnapshot: () => snapshot,
    getState: () => state,
  }
  let editor = ''
  let published = ''
  let composing = false
  const deferred: (() => void)[] = []
  const binding = createWorkbenchSharedDraftBinding({
    client, draftId: DRAFT,
    getEditorText: () => lateEditor ? published : editor,
    setEditorText: text => { editor = text },
    isComposing: () => composing,
    defer: callback => { deferred.push(callback) },
  })
  const settle = async (): Promise<void> => { for (let i = 0; i < 5; i += 1) await Promise.resolve() }
  return {
    binding, client, sent,
    text: () => editor,
    /** Publish a programmatic write the way a late editor does, then notify. */
    publish() { published = editor; binding.editorChanged() },
    type(text: string) { editor = text; published = text; binding.editorChanged() },
    compose(text: string) { composing = true; editor = text; binding.editorChanged() },
    endComposition() { composing = false; binding.compositionEnded(); for (const callback of deferred.splice(0)) callback() },
    setState(next: typeof state) { state = next; for (const listener of [...listeners]) listener(snapshot) },
    /** Send every queued command to the Host. */
    async upload() { for (const job of outbox.splice(0)) await job(); await settle() },
    /** Deliver every queued Host event and command result. */
    async download() { for (const job of inbox.splice(0)) job(); await settle() },
    pendingUploads: () => outbox.length,
  }
}

async function ensureDraft(host: ReturnType<typeof createHost>) {
  const result = await host.command({
    requestId: 'ensure', collaborationId: 'collab', workbenchId: 'workbench', participantId: 'owner', baseRevision: 0,
    operation: { kind: 'draft.ensure', draftId: DRAFT, areaId: 'area-a', editorId: 'editor-a' },
  })
  expect(result.ok).toBe(true)
}

async function quiesce(...peers: ReturnType<typeof createPeer>[]) {
  for (let round = 0; round < 10; round += 1) {
    for (const peer of peers) await peer.upload()
    for (const peer of peers) await peer.download()
  }
}

describe('Workbench shared draft binding', () => {
  it('keeps both participants and the Host on the same text when they type at once', async () => {
    const host = createHost()
    const owner = createPeer(host, 'owner', 'owner')
    const guest = createPeer(host, 'guest', 'participant')
    await ensureDraft(host)
    await quiesce(owner, guest)

    owner.type('hello')
    await quiesce(owner, guest)
    expect(guest.text()).toBe('hello')

    owner.type('hello world')
    guest.type('>> hello')
    // Both operations reach the Host before either side sees the other.
    await owner.upload()
    await guest.upload()
    owner.type('hello world!')
    await quiesce(owner, guest)

    expect(host.snapshot().drafts[DRAFT]!.text).toBe('>> hello world!')
    expect(owner.text()).toBe('>> hello world!')
    expect(guest.text()).toBe('>> hello world!')
  })

  it('never has more than one draft operation in flight', async () => {
    const host = createHost()
    const owner = createPeer(host, 'owner', 'owner')
    await ensureDraft(host)
    await quiesce(owner)
    owner.type('a')
    owner.type('ab')
    owner.type('abc')
    expect(owner.pendingUploads()).toBe(1)
    await quiesce(owner)
    expect(host.snapshot().drafts[DRAFT]!.text).toBe('abc')
    expect(owner.sent.filter(operation => operation.kind === 'draft.apply')).toHaveLength(2)
  })

  it('publishes a local draft that existed before the shared draft', async () => {
    const host = createHost()
    const owner = createPeer(host, 'owner', 'owner')
    owner.type('typed before sharing')
    await ensureDraft(host)
    await quiesce(owner)
    expect(host.snapshot().drafts[DRAFT]!.text).toBe('typed before sharing')
  })

  it('shows the Host draft to a participant who joins later', async () => {
    const host = createHost()
    const owner = createPeer(host, 'owner', 'owner')
    await ensureDraft(host)
    await quiesce(owner)
    owner.type('already here')
    await quiesce(owner)
    const guest = createPeer(host, 'guest', 'participant')
    expect(guest.text()).toBe('already here')
    expect(guest.sent).toHaveLength(0)
  })

  it('does not broadcast or overwrite text while an input method composition is open', async () => {
    const host = createHost()
    const owner = createPeer(host, 'owner', 'owner')
    const guest = createPeer(host, 'guest', 'participant')
    await ensureDraft(host)
    await quiesce(owner, guest)
    owner.type('ab')
    await quiesce(owner, guest)

    guest.compose('abni')
    owner.type('Xab')
    await quiesce(owner, guest)
    // The half finished composition was not sent and was not replaced.
    expect(host.snapshot().drafts[DRAFT]!.text).toBe('Xab')
    expect(guest.text()).toBe('abni')

    guest.compose('ab你')
    guest.endComposition()
    await quiesce(owner, guest)
    expect(host.snapshot().drafts[DRAFT]!.text).toBe('Xab你')
    expect(owner.text()).toBe('Xab你')
    expect(guest.text()).toBe('Xab你')
  })

  it('submits nothing while the Host is unreachable and catches up afterwards', async () => {
    const host = createHost()
    const owner = createPeer(host, 'owner', 'owner')
    const guest = createPeer(host, 'guest', 'participant')
    await ensureDraft(host)
    await quiesce(owner, guest)

    guest.setState('recovering')
    guest.type('offline')
    expect(guest.sent).toHaveLength(0)
    owner.type('online ')
    await quiesce(owner, guest)
    guest.setState('connected')
    await quiesce(owner, guest)

    // Both inserts target position 0. The Host places the late operation first.
    expect(host.snapshot().drafts[DRAFT]!.text).toBe('offlineonline ')
    expect(owner.text()).toBe('offlineonline ')
    expect(guest.text()).toBe('offlineonline ')
  })

  it('clears every editor when the Host clears the draft', async () => {
    const host = createHost()
    const owner = createPeer(host, 'owner', 'owner')
    const guest = createPeer(host, 'guest', 'participant')
    await ensureDraft(host)
    await quiesce(owner, guest)
    owner.type('send me')
    await quiesce(owner, guest)
    const cleared = await host.command({
      requestId: 'clear', collaborationId: 'collab', workbenchId: 'workbench', participantId: 'owner', baseRevision: 0,
      operation: { kind: 'draft.clear', draftId: DRAFT, baseRevision: host.snapshot().drafts[DRAFT]!.revision },
    })
    expect(cleared.ok).toBe(true)
    await quiesce(owner, guest)
    expect(owner.text()).toBe('')
    expect(guest.text()).toBe('')
    expect(owner.sent.filter(operation => operation.kind === 'draft.apply')).toHaveLength(1)
  })

  it('does not mistake an editor that publishes writes late for a local edit', async () => {
    const host = createHost()
    const owner = createPeer(host, 'owner', 'owner')
    const guest = createPeer(host, 'guest', 'participant', true)
    await ensureDraft(host)
    await quiesce(owner, guest)
    owner.type('first')
    await quiesce(owner, guest)
    // The guest editor accepted the write but still reports the old text.
    owner.type('first second')
    await quiesce(owner, guest)
    expect(guest.sent).toHaveLength(0)
    guest.publish()
    await quiesce(owner, guest)
    expect(guest.sent).toHaveLength(0)
    expect(host.snapshot().drafts[DRAFT]!.text).toBe('first second')
    expect(guest.text()).toBe('first second')
  })

  it('empties every editor once when the Host accepts the message, without losing later typing', async () => {
    const host = createHost()
    const owner = createPeer(host, 'owner', 'owner')
    const guest = createPeer(host, 'guest', 'participant')
    const result = await host.command({
      requestId: 'ensure-session', collaborationId: 'collab', workbenchId: 'workbench', participantId: 'owner', baseRevision: 0,
      operation: { kind: 'draft.ensure', draftId: DRAFT, areaId: 'area-a', editorId: 'editor-a', sessionId: 'session-a' },
    })
    expect(result.ok).toBe(true)
    await quiesce(owner, guest)
    owner.type('send this')
    await quiesce(owner, guest)
    expect(guest.text()).toBe('send this')

    // The owner's composer empties itself on send while the Host clears the
    // shared draft for the accepted message. The guest is already typing the
    // next message and has not seen either yet.
    owner.type('')
    host.clearSessionDrafts('session-a', 'owner')
    guest.type('send this, and next')
    await quiesce(owner, guest)

    expect(host.snapshot().drafts[DRAFT]!.text).toBe(', and next')
    expect(owner.text()).toBe(', and next')
    expect(guest.text()).toBe(', and next')
    // Clearing an already empty draft is not a new event.
    const revision = host.snapshot().drafts[DRAFT]!.revision
    host.clearSessionDrafts('other-session', 'owner')
    expect(host.snapshot().drafts[DRAFT]!.revision).toBe(revision)
  })

  it('falls back to the Host text when the Host refuses an operation', async () => {
    const host = createHost()
    const owner = createPeer(host, 'owner', 'owner')
    const guest = createPeer(host, 'guest', 'participant')
    await ensureDraft(host)
    await quiesce(owner, guest)
    owner.type('kept')
    await quiesce(owner, guest)
    host.disconnect('guest')
    await guest.download()
    guest.type('kept and refused')
    await quiesce(owner, guest)
    expect(host.snapshot().drafts[DRAFT]!.text).toBe('kept')
    expect(guest.text()).toBe('kept')
  })
})
