import type { ClientConnectionRpc, ConnectionRpcResult } from '@deepseek-ai/dsh-client-connection/client'
import type { WorkbenchGrant } from '../workbench-access-contract.ts'

export interface WorkbenchShareSessionSnapshotV1 {
  readonly grant?: WorkbenchGrant
  readonly grantRevision?: number
  readonly workbenchId: string
  readonly bindHost: string
  readonly port: number
  readonly createdAt: number
  readonly guestCount: number
  readonly maxGuests?: number
  readonly guests?: readonly WorkbenchShareGuestSnapshotV1[]
  readonly network?: WorkbenchShareNetworkSnapshotV1
  readonly presenceCount?: number
  readonly workbenchMetrics?: Record<string, unknown>
}

export interface WorkbenchShareGuestSnapshotV1 {
  readonly leaseId: string
  readonly nickname: string
  readonly ip?: string
  readonly device?: string
  readonly createdAt: number
  readonly lastSeenAt: number
  readonly websocketState: 'disconnected' | 'connected' | 'reconnecting'
  readonly websocketReconnects: number
  readonly rttMs?: number
  readonly lastErrorAt?: number
  readonly connectionQuality?: 'good' | 'fair' | 'unstable' | 'unknown'
}

export interface WorkbenchShareNetworkSnapshotV1 {
  readonly httpRequests: number
  readonly httpErrors: number
  readonly httpInFlight: number
  readonly queueDepth: number
  readonly websocketConnections: number
  readonly websocketReconnects: number
  readonly lastErrorAt?: number
}

export interface WorkbenchShareSnapshotV1 {
  readonly supported: boolean
  readonly sessions: readonly WorkbenchShareSessionSnapshotV1[]
  readonly links: Readonly<Record<string, string>>
}

export interface WorkbenchShareControllerV1 {
  getSnapshot(): WorkbenchShareSnapshotV1
  subscribe(listener: () => void): () => void
  start(workbenchId: string, grant?: WorkbenchGrant): Promise<{ readonly status: 'started' | 'already-active'; readonly url: string }>
  reduce?(workbenchId: string, grant: WorkbenchGrant): Promise<void>
  stop(workbenchId: string): Promise<void>
  refresh(workbenchId: string): Promise<WorkbenchShareSessionSnapshotV1 | undefined>
  renameGuest(workbenchId: string, leaseId: string, nickname: string): Promise<void>
  kickGuest(workbenchId: string, leaseId: string): Promise<void>
  setRpc(rpc?: ClientConnectionRpc): void
  dispose(): void
}

function unwrap<T>(result: ConnectionRpcResult<unknown>): T {
  if (!result.ok) throw new Error(result.error.code)
  return result.value as T
}

/** Browser-side adapter for Host share-session management. It has no page or
 * Workbench rendering knowledge; shared-control participants never receive this adapter. */
export function createWorkbenchShareController(options: { readonly rpc?: ClientConnectionRpc; readonly chooseGrant?: (workbenchId: string) => Promise<WorkbenchGrant | undefined> } = {}): WorkbenchShareControllerV1 {
  const listeners = new Set<() => void>()
  let rpc = options.rpc
  let disposed = false
  let snapshot: WorkbenchShareSnapshotV1 = Object.freeze({ supported: rpc !== undefined, sessions: Object.freeze([]), links: Object.freeze({}) })
  const publish = (next: WorkbenchShareSnapshotV1) => {
    if (disposed) return
    snapshot = Object.freeze({ ...next, sessions: Object.freeze([...next.sessions]), links: Object.freeze({ ...next.links }) })
    for (const listener of [...listeners]) listener()
  }
  const call = async <T>(endpoint: string, payload: unknown): Promise<T> => {
    if (rpc === undefined) throw new Error('workbench-share-connection-unavailable')
    const result = await rpc.call('/api', `workbench-share/${endpoint}`, payload, AbortSignal.timeout(10_000))
    return unwrap<T>(result)
  }
  const replaceSession = (workbenchId: string, session: WorkbenchShareSessionSnapshotV1 | undefined): void => {
    const sessions = snapshot.sessions.filter(row => row.workbenchId !== workbenchId)
    publish({ ...snapshot, supported: true, sessions: session === undefined ? sessions : [...sessions, session] })
  }
  const normalizeSession = (value: WorkbenchShareSessionSnapshotV1): WorkbenchShareSessionSnapshotV1 => ({
    ...value, guests: value.guests ?? [], maxGuests: value.maxGuests ?? 5,
  })
  return {
    getSnapshot: () => snapshot,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener) } },
    async start(workbenchId, input) {
      const grant = input ?? (snapshot.links[workbenchId] ? undefined : await options.chooseGrant?.(workbenchId))
      if (!snapshot.links[workbenchId] && options.chooseGrant && !grant) throw new Error('已取消分享。')
      const result = await call<{ status: 'started' | 'already-active'; url: string }>('start', { workbenchId, ...(grant ? { grant } : {}) })
      const status = await call<{ sessions?: unknown }>('status', { workbenchId })
      const session = Array.isArray(status.sessions) ? (status.sessions as WorkbenchShareSessionSnapshotV1[]).map(normalizeSession).find(row => row.workbenchId === workbenchId) : undefined
      publish({ ...snapshot, supported: true, links: { ...snapshot.links, [workbenchId]: result.url }, sessions: session === undefined ? snapshot.sessions : [...snapshot.sessions.filter(row => row.workbenchId !== workbenchId), session] })
      return result
    },
    async stop(workbenchId) {
      await call('stop', { workbenchId })
      const links = { ...snapshot.links }
      delete links[workbenchId]
      replaceSession(workbenchId, undefined)
      publish({ ...snapshot, supported: true, links })
    },
    async reduce(workbenchId, grant) { await call('reduce', { workbenchId, grant }); await this.refresh(workbenchId) },
    async refresh(workbenchId) {
      const result = await call<{ sessions?: unknown }>('status', { workbenchId })
      const rows = Array.isArray(result.sessions) ? (result.sessions as WorkbenchShareSessionSnapshotV1[]).map(normalizeSession) : []
      const session = rows.find(row => row.workbenchId === workbenchId)
      replaceSession(workbenchId, session)
      if (session === undefined && snapshot.links[workbenchId] !== undefined) {
        const links = { ...snapshot.links }
        delete links[workbenchId]
        publish({ ...snapshot, supported: true, links })
      }
      return session
    },
    async renameGuest(workbenchId, leaseId, nickname) {
      await call('guest-rename', { workbenchId, leaseId, nickname })
      await this.refresh(workbenchId)
    },
    async kickGuest(workbenchId, leaseId) {
      await call('guest-kick', { workbenchId, leaseId })
      await this.refresh(workbenchId)
    },
    setRpc(nextRpc) { rpc = nextRpc; publish({ ...snapshot, supported: nextRpc !== undefined }) },
    dispose() { disposed = true; listeners.clear() },
  }
}
