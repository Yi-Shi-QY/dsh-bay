import { BAY_AGENT_ROUTE } from '../bay-agent-contract.ts'
import { workbenchFetch } from './workbench-access.ts'
import type { BayAgentControllerSnapshotV1, BayAgentControllerV1, BayAgentWorkerRuntimeV1 } from '../foundation/workbench-bay-agent-work.ts'

/** Browser owns presentation only; Host owns lifecycle, delivery and persistence. */
export function createRemoteBayAgentController(initialWorkbenchId: string, fetcher: typeof fetch = workbenchFetch, refreshSessions?: () => Promise<unknown>): BayAgentControllerV1 & { dispose(): void } {
  let workbenchId = initialWorkbenchId, disposed = false, sequence = 0, applied = 0
  const empty = (id: string): BayAgentControllerSnapshotV1 => ({ workbenchId: id, areas: [], workItems: [], assignments: [], attention: [], orchestration: { workbenchId: id, currentEventSeq: 0, activeWorkItems: [], activeAssignments: [], openAttention: [], recentReports: [], recentBlockers: [], recentDecisions: [], recentEvents: [] } })
  let snapshot = empty(workbenchId)
  const listeners = new Set<() => void>(), ensures = new Map<string, Promise<string | undefined>>()
  const notify = () => { for (const listener of listeners) listener() }
  const request = async (id: string, action: string, input: Record<string, unknown> = {}) => {
    const order = ++sequence
    try {
      const response = await fetcher(BAY_AGENT_ROUTE, { method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ workbenchId: id, action, ...input }) })
      const result = await response.json() as { snapshot: BayAgentControllerSnapshotV1; value?: unknown; error?: string }
      if (!response.ok || !result.snapshot || result.snapshot.workbenchId !== id) throw new Error(result.error ?? 'Bay Agent 宿主暂不可用。')
      if (!disposed && id === workbenchId && order >= applied) { applied = order; if (JSON.stringify(snapshot) !== JSON.stringify(result.snapshot)) { snapshot = result.snapshot; notify() } }
      return result
    } catch (error) {
      if (!disposed && id === workbenchId && order >= applied) { applied = order; snapshot = { ...snapshot, error: String(error) }; notify() }
      throw error
    }
  }
  let refreshing = false
  const timer = setInterval(() => {
    if (disposed || refreshing || !listeners.size) return
    refreshing = true
    void request(workbenchId, 'snapshot').catch(() => {}).finally(() => { refreshing = false })
  }, 1800)
  const unsupported = async (): Promise<never> => { throw new Error('Worker Runtime is owned by the Host') }
  const runtime: BayAgentWorkerRuntimeV1 = { name: 'dsh-session-controller', createAssignment: unsupported, retryAssignment: unsupported, recoverAssignment: unsupported, cancelAssignment: unsupported, subscribe: () => () => {} }
  return {
    runtime,
    setWorkbenchId(id) { if (id === workbenchId) return; workbenchId = id; snapshot = empty(id); notify() },
    getSnapshot: () => snapshot,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener) } },
    async ensureMainSession(id = workbenchId) {
      const pending = ensures.get(id); if (pending) return pending
      const operation = request(id, 'ensure').then(async result => {
        // A Host-created Session must be known to the native client catalog before retain().
        await refreshSessions?.()
        return result.snapshot.bayAgentSessionId
      })
      ensures.set(id, operation)
      try { return await operation } finally { ensures.delete(id) }
    },
    async createWorkItem(input) { const result = await request(workbenchId, 'create', { input }); return result.value as Awaited<ReturnType<BayAgentControllerV1['createWorkItem']>> },
    async startWorkItem(id) { const result = await request(workbenchId, 'start', { id }); return result.value as Awaited<ReturnType<BayAgentControllerV1['startWorkItem']>> },
    async acceptWorkItem(id) { await request(workbenchId, 'accept', { id }) },
    async retryWorkItem(id) { await request(workbenchId, 'recover', { id }) },
    async recoverWorkItem(id) { await request(workbenchId, 'recover', { id }) },
    async stopWorkItem(id) { await request(workbenchId, 'stop', { id }) },
    async resolveAttention(id, answer) { await request(workbenchId, 'answer', { id, answer }) },
    async dismissAttention(id) { await request(workbenchId, 'dismiss', { id }) },
    listAttention: () => snapshot.attention.filter(row => row.status === 'open'),
    dispose() { disposed = true; clearInterval(timer); listeners.clear() },
  }
}
