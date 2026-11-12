import { randomUUID } from 'node:crypto'
import type { WorkbenchCollaborationManagerV1, WorkbenchCollaborationSessionViewV1 } from './host-workbench-collaboration.ts'
import type { ParticipantPresenceV1, WorkbenchCommandEnvelopeV1 } from './workbench-collaboration-contract.ts'

/**
 * Collaboration carrier for the DSH desktop owner.
 *
 * The desktop page talks to the Host through DSH's authenticated RPC carrier,
 * which has no socket of its own for plugins. This channel therefore speaks
 * the same collaboration frames as the WebSocket gateways over four calls:
 * `open`, `send`, `poll` and `close`. Server frames wait in one ordered queue
 * per connection and only `poll` drains it, so the client sees them in the
 * order the Host produced them.
 *
 * The desktop always joins as the owner participant. It may only join while
 * it controls the Workbench; a Workbench handed to a browser owner refuses
 * the desktop until it is reclaimed.
 */
export interface WorkbenchDesktopCollaborationChannelOptionsV1 {
  readonly collaboration: Pick<WorkbenchCollaborationManagerV1, 'get'>
  /** False while a browser owner controls the Workbench. */
  readonly canControl: (workbenchId: string) => boolean
  readonly now?: () => number
  readonly randomId?: () => string
  /** Longest time one `poll` waits for a frame. */
  readonly pollHoldMs?: number
  /** A connection that is not polled for this long is closed. */
  readonly idleMs?: number
}

export type WorkbenchDesktopCollaborationResultV1 =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly code: string }

export interface WorkbenchDesktopCollaborationChannelV1 {
  handle(action: string, payload: unknown): Promise<WorkbenchDesktopCollaborationResultV1>
  dispose(): void
}

export const WORKBENCH_DESKTOP_COLLABORATION_ACTIONS = ['open', 'send', 'poll', 'close'] as const

const OWNER = 'owner'
const OWNER_NAME = '房主'

interface Connection {
  readonly id: string
  readonly workbenchId: string
  readonly session: WorkbenchCollaborationSessionViewV1
  readonly queue: unknown[]
  readonly unsubscribe: () => void
  wake: (() => void) | undefined
  joined: boolean
  ended: boolean
  lastSeen: number
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

export function createWorkbenchDesktopCollaborationChannel(options: WorkbenchDesktopCollaborationChannelOptionsV1): WorkbenchDesktopCollaborationChannelV1 {
  const now = options.now ?? Date.now
  const randomId = options.randomId ?? randomUUID
  const pollHoldMs = options.pollHoldMs ?? 1_500
  const idleMs = options.idleMs ?? 30_000
  const connections = new Map<string, Connection>()
  let disposed = false

  const enqueue = (connection: Connection, type: string, payload: unknown): void => {
    if (connection.ended && type !== 'server.collaboration-ended') return
    connection.queue.push({ type, payload })
    const wake = connection.wake
    connection.wake = undefined
    wake?.()
  }

  const release = (connection: Connection): void => {
    if (!connections.delete(connection.id)) return
    connection.unsubscribe()
    if (connection.joined) connection.session.disconnect(OWNER)
    connection.joined = false
    const wake = connection.wake
    connection.wake = undefined
    wake?.()
  }

  /** End a connection whose session stopped or whose Workbench changed hands. */
  const endIfUnavailable = (connection: Connection): boolean => {
    if (connection.ended) return true
    const reason = options.collaboration.get(connection.workbenchId) !== connection.session ? 'share-stopped'
      : !options.canControl(connection.workbenchId) ? 'browser-controls-workbench' : undefined
    if (reason === undefined) return false
    connection.ended = true
    enqueue(connection, 'server.collaboration-ended', { reason })
    return true
  }

  const sweep = setInterval(() => {
    const at = now()
    for (const connection of [...connections.values()]) if (at - connection.lastSeen > idleMs) release(connection)
  }, Math.max(1_000, Math.floor(idleMs / 3)))
  sweep.unref?.()

  const open = (payload: Record<string, unknown>): WorkbenchDesktopCollaborationResultV1 => {
    const workbenchId = payload.workbenchId
    if (typeof workbenchId !== 'string' || workbenchId.length === 0) return { ok: false, code: 'invalid-workbench-id' }
    const session = options.collaboration.get(workbenchId)
    if (session === undefined) return { ok: false, code: 'collaboration-unavailable' }
    if (!options.canControl(workbenchId)) return { ok: false, code: 'browser-controls-workbench' }
    const id = randomId()
    const connection: Connection = {
      id, workbenchId, session, queue: [], wake: undefined, joined: false, ended: false, lastSeen: now(),
      unsubscribe: session.subscribe(event => { const current = connections.get(id); if (current !== undefined) enqueue(current, 'server.event', event) }),
    }
    connections.set(id, connection)
    return { ok: true, value: { connectionId: id, collaborationId: session.snapshot().collaborationId } }
  }

  const send = (connection: Connection, frame: Record<string, unknown>): WorkbenchDesktopCollaborationResultV1 => {
    const payload = record(frame.payload)
    if (typeof frame.type !== 'string' || payload === undefined) return { ok: false, code: 'invalid-frame' }
    if (endIfUnavailable(connection)) return { ok: true, value: {} }
    const session = connection.session
    const collaborationId = session.snapshot().collaborationId
    if (frame.type === 'client.hello') {
      // A repeated hello on one connection must not count as a second owner.
      const joined = connection.joined ? session.snapshot() : session.connect({ collaborationId, workbenchId: connection.workbenchId, participantId: OWNER, displayName: OWNER_NAME, role: 'owner' })
      if ('error' in joined) {
        connection.ended = true
        enqueue(connection, 'server.collaboration-ended', { reason: joined.error })
        return { ok: true, value: {} }
      }
      connection.joined = true
      enqueue(connection, 'server.snapshot', joined)
      if (typeof payload.lastEventId === 'string') {
        const replay = session.eventsSince(payload.lastEventId)
        if (replay === undefined) enqueue(connection, 'server.resync-required', session.snapshot())
        else for (const event of replay) enqueue(connection, 'server.event', event)
      }
      return { ok: true, value: {} }
    }
    if (!connection.joined) return { ok: false, code: 'collaboration-handshake-required' }
    if (frame.type === 'client.command') {
      const command = payload as unknown as WorkbenchCommandEnvelopeV1
      void session.command({ ...command, collaborationId, workbenchId: connection.workbenchId, participantId: OWNER })
        .then(result => enqueue(connection, 'server.command-result', result), () => {})
    } else if (frame.type === 'client.presence') {
      session.publishPresence({ ...(payload as unknown as ParticipantPresenceV1), participantId: OWNER, displayName: OWNER_NAME, role: 'owner', connectionState: 'connected', updatedAt: now() })
    } else if (frame.type === 'client.resync') enqueue(connection, 'server.snapshot', session.snapshot())
    else return { ok: false, code: 'invalid-frame' }
    return { ok: true, value: {} }
  }

  const poll = async (connection: Connection): Promise<WorkbenchDesktopCollaborationResultV1> => {
    endIfUnavailable(connection)
    if (connection.queue.length === 0 && !connection.ended) {
      await new Promise<void>(resolve => {
        const timer = setTimeout(() => { if (connection.wake === done) connection.wake = undefined; resolve() }, pollHoldMs)
        const done = () => { clearTimeout(timer); resolve() }
        // Only one poll waits at a time. A second one replaces the first.
        connection.wake?.()
        connection.wake = done
      })
      endIfUnavailable(connection)
    }
    const frames = connection.queue.splice(0)
    const closed = connection.ended || !connections.has(connection.id)
    if (closed) release(connection)
    return { ok: true, value: { frames, closed } }
  }

  return {
    async handle(action, input) {
      if (disposed) return { ok: false, code: 'collaboration-unavailable' }
      const payload = record(input)
      if (payload === undefined) return { ok: false, code: 'invalid-request' }
      if (action === 'open') return open(payload)
      const connection = typeof payload.connectionId === 'string' ? connections.get(payload.connectionId) : undefined
      if (connection === undefined) return { ok: false, code: 'collaboration-connection-not-found' }
      connection.lastSeen = now()
      if (action === 'send') {
        const frame = record(payload.frame)
        return frame === undefined ? { ok: false, code: 'invalid-frame' } : send(connection, frame)
      }
      if (action === 'poll') return poll(connection)
      if (action === 'close') { release(connection); return { ok: true, value: {} } }
      return { ok: false, code: 'invalid-action' }
    },
    dispose() {
      disposed = true
      clearInterval(sweep)
      for (const connection of [...connections.values()]) release(connection)
    },
  }
}
