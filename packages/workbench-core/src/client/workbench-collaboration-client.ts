import type {
  ParticipantPresenceV1,
  WorkbenchCollaborationConnectV1,
  WorkbenchCollaborationEventV1,
  WorkbenchCollaborationSnapshotV1,
  WorkbenchCommandEnvelopeV1,
  WorkbenchCommandResultV1,
  WorkbenchCommandV1,
} from '../workbench-collaboration-contract.ts'

export interface WorkbenchCollaborationClientOptionsV1 extends WorkbenchCollaborationConnectV1 {
  readonly url: string
  readonly WebSocket?: typeof WebSocket
  readonly reconnect?: boolean
  readonly reconnectDelayMs?: number
}

export interface WorkbenchCollaborationClientV1 {
  readonly participantId: string
  connect(): Promise<WorkbenchCollaborationSnapshotV1>
  disconnect(): void
  command(operation: WorkbenchCommandV1, baseRevision?: number): Promise<WorkbenchCommandResultV1>
  publishPresence(presence: ParticipantPresenceV1): void
  getSnapshot(): WorkbenchCollaborationSnapshotV1 | undefined
  subscribe(listener: (snapshot: WorkbenchCollaborationSnapshotV1 | undefined, event?: WorkbenchCollaborationEventV1) => void): () => void
  getState(): 'idle' | 'connecting' | 'connected' | 'recovering' | 'closed'
}

type WireMessage =
  | { readonly type: 'client.hello'; readonly payload: WorkbenchCollaborationConnectV1 }
  | { readonly type: 'client.command'; readonly payload: WorkbenchCommandEnvelopeV1 }
  | { readonly type: 'client.presence'; readonly payload: ParticipantPresenceV1 }
  | { readonly type: 'client.resync'; readonly payload: WorkbenchCollaborationConnectV1 }
  | { readonly type: 'server.snapshot'; readonly payload: WorkbenchCollaborationSnapshotV1 }
  | { readonly type: 'server.command-result'; readonly payload: WorkbenchCommandResultV1 }
  | { readonly type: 'server.event'; readonly payload: WorkbenchCollaborationEventV1 }
  | { readonly type: 'server.presence'; readonly payload: ParticipantPresenceV1 }
  | { readonly type: 'server.resync-required'; readonly payload: WorkbenchCollaborationSnapshotV1 }
  | { readonly type: 'server.collaboration-ended'; readonly payload: { readonly reason?: string } }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function newRequestId(): string {
  const random = globalThis.crypto?.randomUUID?.()
  return random === undefined ? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}` : random
}

export function createWorkbenchCollaborationClient(options: WorkbenchCollaborationClientOptionsV1): WorkbenchCollaborationClientV1 {
  const WebSocketCtor = options.WebSocket ?? globalThis.WebSocket
  const listeners = new Set<(snapshot: WorkbenchCollaborationSnapshotV1 | undefined, event?: WorkbenchCollaborationEventV1) => void>()
  const pending = new Map<string, {
    readonly resolve: (result: WorkbenchCommandResultV1) => void
    readonly reject: (error: Error) => void
    readonly envelope: WorkbenchCommandEnvelopeV1
    sent: boolean
  }>()
  let socket: WebSocket | undefined
  let snapshot: WorkbenchCollaborationSnapshotV1 | undefined
  let state: WorkbenchCollaborationClientV1['getState'] extends () => infer T ? T : never = 'idle'
  let closedByCaller = false
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined
  let latestEventId: string | undefined
  let lastPresence: ParticipantPresenceV1 | undefined

  const publish = (event?: WorkbenchCollaborationEventV1) => {
    for (const listener of [...listeners]) listener(snapshot, event)
  }
  const hello = (): WorkbenchCollaborationConnectV1 => ({
    collaborationId: options.collaborationId,
    workbenchId: options.workbenchId,
    participantId: options.participantId,
    displayName: options.displayName,
    role: options.role,
    ...(snapshot === undefined ? {} : {
      ...(latestEventId === undefined ? {} : { lastEventId: latestEventId }),
      lastWorkbenchRevision: snapshot.workbenchRevision,
      lastCanvasRevision: snapshot.canvasRevision,
    }),
  })
  const send = (message: WireMessage): void => {
    if (socket?.readyState !== 1) throw new Error('workbench-collaboration-not-connected')
    socket.send(JSON.stringify(message))
  }
  const flushPending = (): void => {
    if (state !== 'connected' || socket?.readyState !== 1) return
    for (const item of pending.values()) {
      if (item.sent) continue
      try {
        send({ type: 'client.command', payload: item.envelope })
        item.sent = true
      } catch { return }
    }
  }
  const presenceHeartbeat = typeof globalThis.setInterval === 'function'
    ? globalThis.setInterval(() => {
      if (lastPresence === undefined || state !== 'connected') return
      try { send({ type: 'client.presence', payload: { ...lastPresence, connectionState: 'connected', updatedAt: Date.now() } }) } catch { /* reconnect state is visible through the client */ }
    }, 15_000)
    : undefined
  const scheduleReconnect = () => {
    if (closedByCaller || options.reconnect === false || reconnectTimer !== undefined) return
    state = 'recovering'
    reconnectTimer = setTimeout(() => { reconnectTimer = undefined; void open() }, options.reconnectDelayMs ?? 1_000)
    publish()
  }
  const open = (): Promise<WorkbenchCollaborationSnapshotV1> => new Promise((resolve, reject) => {
    if (WebSocketCtor === undefined) { state = 'closed'; reject(new Error('websocket-unavailable')); return }
    state = snapshot === undefined ? 'connecting' : 'recovering'
    const next = new WebSocketCtor(options.url)
    socket = next
    next.onopen = () => {
      try { send({ type: 'client.hello', payload: hello() }) }
      catch (error) { reject(error instanceof Error ? error : new Error(String(error))) }
    }
    next.onmessage = event => {
      let message: unknown
      try { message = JSON.parse(typeof event.data === 'string' ? event.data : String(event.data)) } catch { return }
      if (!isRecord(message) || typeof message.type !== 'string') return
      if (message.type === 'server.snapshot' || message.type === 'server.resync-required') {
        if (!isRecord(message.payload)) return
        snapshot = message.payload as unknown as WorkbenchCollaborationSnapshotV1
        state = 'connected'
        publish()
        // Host command results are idempotent by requestId. Replaying requests
        // that were in flight when the socket disappeared is therefore safe,
        // and makes a reconnect recover a lost response without duplicating a
        // message, task, or file write.
        queueMicrotask(flushPending)
        resolve(snapshot)
        return
      }
      if (message.type === 'server.command-result' && isRecord(message.payload) && typeof message.payload.requestId === 'string') {
        const waiter = pending.get(message.payload.requestId)
        if (waiter === undefined) return
        pending.delete(message.payload.requestId)
        waiter.resolve(message.payload as unknown as WorkbenchCommandResultV1)
        return
      }
      if (message.type === 'server.event' && isRecord(message.payload)) {
        const eventValue = message.payload as unknown as WorkbenchCollaborationEventV1
        applyEvent(eventValue)
        publish(eventValue)
        return
      }
      if (message.type === 'server.presence' && isRecord(message.payload)) {
        const presence = message.payload as unknown as ParticipantPresenceV1
        if (snapshot !== undefined) {
          const participants = snapshot.participants.filter(row => row.participantId !== presence.participantId)
          snapshot = { ...snapshot, participants: [...participants, presence] }
          publish()
        }
        return
      }
      if (message.type === 'server.collaboration-ended') {
        state = 'closed'
        for (const waiter of pending.values()) waiter.reject(new Error('collaboration-ended'))
        pending.clear()
        publish()
      }
    }
    next.onerror = () => { if (state === 'connecting') reject(new Error('workbench-collaboration-connection-failed')); scheduleReconnect() }
    next.onclose = () => {
      socket = undefined
      for (const item of pending.values()) item.sent = false
      if (state !== 'closed') scheduleReconnect()
    }
  })

  const applyEvent = (event: WorkbenchCollaborationEventV1): void => {
    if (snapshot === undefined) return
    latestEventId = event.eventId
    snapshot = { ...snapshot, workbenchRevision: event.workbenchRevision, canvasRevision: event.canvasRevision }
    if (event.kind === 'workbench.snapshot.changed' && isRecord(event.payload) && event.payload.schemaVersion === 1) {
      snapshot = event.payload as unknown as WorkbenchCollaborationSnapshotV1
      return
    }
    if (event.kind === 'canvas.viewport.changed' && isRecord(event.payload)) snapshot = { ...snapshot, sharedCanvas: { ...snapshot.sharedCanvas, viewport: event.payload as never } }
    else if (event.kind === 'canvas.focus.changed' && isRecord(event.payload)) snapshot = { ...snapshot, sharedCanvas: { ...snapshot.sharedCanvas, focus: event.payload as never } }
    else if (event.kind === 'canvas.focus-lock.changed' && isRecord(event.payload)) snapshot = { ...snapshot, sharedCanvas: { ...snapshot.sharedCanvas, fixedByOwner: event.payload.locked === true } }
    else if (event.kind === 'canvas.layout.changed') snapshot = { ...snapshot, sharedCanvas: { ...snapshot.sharedCanvas, layout: event.payload } }
    else if (event.kind === 'canvas.floating-panels.changed' && Array.isArray(event.payload)) snapshot = { ...snapshot, sharedCanvas: { ...snapshot.sharedCanvas, floatingPanels: event.payload } }
    else if (event.kind === 'task.changed' && isRecord(event.payload) && Array.isArray(event.payload.tasks)) snapshot = { ...snapshot, tasks: event.payload.tasks }
    else if ((event.kind === 'draft.created' || event.kind === 'draft.cleared') && isRecord(event.payload) && typeof event.payload.draftId === 'string') {
      const { baseRevision: _baseRevision, operations: _operations, ...fields } = event.payload
      const draft = fields as unknown as WorkbenchCollaborationSnapshotV1['drafts'][string]
      snapshot = { ...snapshot, drafts: { ...snapshot.drafts, [draft.draftId]: draft } }
    }
    else if (event.kind === 'draft.changed' && isRecord(event.payload) && typeof event.payload.draftId === 'string') {
      const previous = snapshot.drafts[event.payload.draftId]
      if (previous !== undefined && typeof event.payload.text === 'string' && typeof event.payload.revision === 'number') snapshot = { ...snapshot, drafts: { ...snapshot.drafts, [event.payload.draftId]: {
        ...previous, text: event.payload.text, revision: event.payload.revision,
        ...(isRecord(event.payload.selections) ? { selections: event.payload.selections as never } : {}),
      } } }
    }
    else if (event.kind === 'draft.attachments.changed' && isRecord(event.payload) && typeof event.payload.draftId === 'string') {
      const previous = snapshot.drafts[event.payload.draftId]
      if (previous !== undefined && Array.isArray(event.payload.attachments) && typeof event.payload.revision === 'number') snapshot = { ...snapshot, drafts: { ...snapshot.drafts, [event.payload.draftId]: { ...previous, attachments: event.payload.attachments, revision: event.payload.revision } } }
    }
    else if (event.kind === 'draft.selection.changed' && isRecord(event.payload) && typeof event.payload.draftId === 'string' && typeof event.payload.participantId === 'string') {
      const previous = snapshot.drafts[event.payload.draftId]
      if (previous !== undefined) {
        const selections = { ...previous.selections }
        if (event.payload.selection === undefined) delete selections[event.payload.participantId]
        else selections[event.payload.participantId] = event.payload.selection as never
        snapshot = { ...snapshot, drafts: { ...snapshot.drafts, [event.payload.draftId]: { ...previous, selections } } }
      }
    }
    else if (event.kind === 'participant.joined' || event.kind === 'presence.changed') {
      if (isRecord(event.payload) && typeof event.payload.participantId === 'string') {
        const participant = event.payload as unknown as ParticipantPresenceV1
        snapshot = { ...snapshot, participants: [...snapshot.participants.filter(row => row.participantId !== participant.participantId), participant] }
      }
    }
    else if (event.kind === 'participant.left' && isRecord(event.payload) && typeof event.payload.participantId === 'string') {
      const participantId = event.payload.participantId
      snapshot = { ...snapshot, participants: snapshot.participants.filter(row => row.participantId !== participantId) }
    }
  }


  return {
    participantId: options.participantId,
    connect: open,
    disconnect() {
      closedByCaller = true
      if (reconnectTimer !== undefined) clearTimeout(reconnectTimer)
      if (presenceHeartbeat !== undefined) clearInterval(presenceHeartbeat)
      state = 'closed'
      socket?.close()
      socket = undefined
      for (const waiter of pending.values()) waiter.reject(new Error('workbench-collaboration-closed'))
      pending.clear()
    },
    command(operation, baseRevision = snapshot?.workbenchRevision ?? 0) {
      if (state !== 'connected' || socket?.readyState !== 1) return Promise.reject(new Error('workbench-collaboration-recovering'))
      const requestId = newRequestId()
      const envelope: WorkbenchCommandEnvelopeV1 = {
        requestId, collaborationId: options.collaborationId, workbenchId: options.workbenchId,
        participantId: options.participantId, baseRevision, operation,
      }
      return new Promise((resolve, reject) => {
        const item = { resolve, reject, envelope, sent: false }
        pending.set(requestId, item)
        try {
          send({ type: 'client.command', payload: envelope })
          item.sent = true
        } catch (error) { pending.delete(requestId); reject(error instanceof Error ? error : new Error(String(error))) }
      })
    },
    publishPresence(presence) {
      lastPresence = { ...presence, updatedAt: Date.now() }
      try { send({ type: 'client.presence', payload: lastPresence }) } catch { /* connection state is visible through the client */ }
    },
    getSnapshot: () => snapshot,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener) } },
    getState: () => state,
  }
}
