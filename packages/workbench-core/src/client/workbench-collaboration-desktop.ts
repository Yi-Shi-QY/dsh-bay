import { createWorkbenchCollaborationClient, type WorkbenchCollaborationClientV1 } from './workbench-collaboration-client.ts'
import type { WorkbenchCollaborationEventV1, WorkbenchCollaborationSnapshotV1 } from '../workbench-collaboration-contract.ts'

/**
 * Desktop owner side of the collaboration session.
 *
 * The desktop has no page marker and no socket for plugins, so it reaches the
 * Host collaboration session through RPC calls. `createRpcCollaborationSocket`
 * presents those calls as the small WebSocket surface the collaboration
 * client already uses, which keeps reconnect, replay and reducers identical
 * on every surface.
 *
 * The desktop shows one Workbench at a time and a share can start or stop at
 * any moment. `createDesktopWorkbenchCollaborationClient` therefore returns
 * one stable client object that follows the current target: it is idle while
 * the active Workbench has no share and connects when it has one.
 */
export type WorkbenchCollaborationRpcCall = (action: 'open' | 'send' | 'poll' | 'close', payload: unknown) => Promise<unknown>

interface SocketLike {
  readyState: number
  onopen?: () => void
  onmessage?: (event: { data: string }) => void
  onerror?: () => void
  onclose?: () => void
  send(value: string): void
  close(): void
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Build a WebSocket-shaped constructor bound to one Workbench. */
export function createRpcCollaborationSocket(call: WorkbenchCollaborationRpcCall, workbenchId: string): new (url: string) => SocketLike {
  return class RpcCollaborationSocket implements SocketLike {
    readyState = 0
    onopen?: () => void
    onmessage?: (event: { data: string }) => void
    onerror?: () => void
    onclose?: () => void
    private connectionId: string | undefined
    /** Frames are sent one after another so the Host sees them in order. */
    private sending: Promise<void> = Promise.resolve()

    constructor(_url: string) { void this.start() }

    private async start(): Promise<void> {
      try {
        const opened = await call('open', { workbenchId })
        if (this.readyState === 3) {
          if (isRecord(opened) && typeof opened.connectionId === 'string') void call('close', { connectionId: opened.connectionId }).catch(() => {})
          return
        }
        if (!isRecord(opened) || typeof opened.connectionId !== 'string') throw new Error('collaboration-unavailable')
        this.connectionId = opened.connectionId
        this.readyState = 1
        this.onopen?.()
        void this.poll()
      } catch { this.fail() }
    }

    private async poll(): Promise<void> {
      while (this.readyState === 1) {
        let result: unknown
        try { result = await call('poll', { connectionId: this.connectionId }) } catch { this.fail(); return }
        if (this.readyState !== 1) return
        const frames = isRecord(result) && Array.isArray(result.frames) ? result.frames : []
        for (const frame of frames) this.onmessage?.({ data: JSON.stringify(frame) })
        if (isRecord(result) && result.closed === true) { this.finish(false); return }
      }
    }

    private finish(notifyHost: boolean): void {
      if (this.readyState === 3) return
      this.readyState = 3
      if (notifyHost && this.connectionId !== undefined) void call('close', { connectionId: this.connectionId }).catch(() => {})
      this.onclose?.()
    }

    private fail(): void {
      if (this.readyState === 3) return
      this.onerror?.()
      this.finish(true)
    }

    send(value: string): void {
      if (this.readyState !== 1) throw new Error('workbench-collaboration-not-connected')
      const frame = JSON.parse(value) as unknown
      this.sending = this.sending.then(async () => {
        if (this.readyState !== 1) return
        try { await call('send', { connectionId: this.connectionId, frame }) } catch { this.fail() }
      })
    }

    close(): void { this.finish(true) }
  }
}

export interface DesktopWorkbenchCollaborationClientV1 {
  /** Stable client object. It is idle while there is no target. */
  readonly client: WorkbenchCollaborationClientV1
  /** Follow this Workbench's collaboration session, or none. */
  setTarget(workbenchId: string | undefined): void
  dispose(): void
}

export function createDesktopWorkbenchCollaborationClient(options: {
  readonly call: WorkbenchCollaborationRpcCall
  readonly reconnectDelayMs?: number
}): DesktopWorkbenchCollaborationClientV1 {
  const listeners = new Set<(snapshot: WorkbenchCollaborationSnapshotV1 | undefined, event?: WorkbenchCollaborationEventV1) => void>()
  let target: string | undefined
  let inner: WorkbenchCollaborationClientV1 | undefined
  let unsubscribe: (() => void) | undefined
  let disposed = false

  const publish = (snapshot: WorkbenchCollaborationSnapshotV1 | undefined, event?: WorkbenchCollaborationEventV1): void => {
    for (const listener of [...listeners]) listener(snapshot, event)
  }
  const drop = (): void => {
    unsubscribe?.()
    unsubscribe = undefined
    inner?.disconnect()
    inner = undefined
  }

  return {
    client: {
      participantId: 'owner',
      connect: () => inner === undefined ? Promise.reject(new Error('workbench-collaboration-idle')) : inner.connect(),
      disconnect() { /* The owner of this object ends it through dispose(). */ },
      command: (operation, baseRevision) => inner === undefined
        ? Promise.reject(new Error('workbench-collaboration-idle'))
        : inner.command(operation, baseRevision),
      publishPresence(presence) { inner?.publishPresence(presence) },
      getSnapshot: () => inner?.getSnapshot(),
      subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener) } },
      getState: () => inner?.getState() ?? 'idle',
    },
    setTarget(workbenchId) {
      if (disposed || workbenchId === target) return
      target = workbenchId
      drop()
      if (workbenchId !== undefined) {
        const next = createWorkbenchCollaborationClient({
          url: 'workbench-collaboration:desktop',
          WebSocket: createRpcCollaborationSocket(options.call, workbenchId) as never,
          // The Host fills in the real collaboration identity for the owner.
          collaborationId: '', workbenchId, participantId: 'owner', displayName: '房主', role: 'owner',
          reconnectDelayMs: options.reconnectDelayMs ?? 3_000,
        })
        inner = next
        unsubscribe = next.subscribe((snapshot, event) => { if (inner === next) publish(snapshot, event) })
        void next.connect().catch(() => {})
      }
      publish(inner?.getSnapshot())
    },
    dispose() {
      disposed = true
      target = undefined
      drop()
      listeners.clear()
    },
  }
}
