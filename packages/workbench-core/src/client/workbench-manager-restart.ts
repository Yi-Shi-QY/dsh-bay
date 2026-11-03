/** Browser-only client of the Manager Protocol v3 checkpoint lifecycle. */
export * from '../restart-contract.ts'
import { restartFailure as failure, WorkbenchRestartError, isWorkbenchRestartComplete, type WorkbenchRestartPhaseV1, type WorkbenchRestartStatusV1, type WorkbenchManagerRestartBridgeV2 } from '../restart-contract.ts'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu
const TRANSACTION = /^[A-Za-z0-9._:-]{1,256}$/u
const RESUME_KEY = 'dsh.workbench.restart.resume.v1'
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
function parseStatus(value: unknown, operationId: string): WorkbenchRestartStatusV1 {
  if (!record(value) || value.schemaVersion !== 1 || value.operationId !== operationId
    || typeof value.transactionId !== 'string' || !TRANSACTION.test(value.transactionId)
    || !['restart-required', 'active', 'failed', 'missing'].includes(String(value.transactionState))
    || !['accepted', 'checkpointing', 'stopping', 'starting', 'ready', 'verified', 'failed', 'skipped'].includes(String(value.phase))
    || ['sourceRunReady', 'replacementRunReady', 'workbenchVerified', 'managerSucceeded'].some(key => typeof value[key] !== 'boolean')) throw failure('restart-failed')
  return { schemaVersion: 1, operationId, transactionId: value.transactionId,
    transactionState: value.transactionState as WorkbenchRestartStatusV1['transactionState'], phase: value.phase as WorkbenchRestartPhaseV1,
    sourceRunReady: value.sourceRunReady as boolean, replacementRunReady: value.replacementRunReady as boolean,
    managerSucceeded: value.managerSucceeded as boolean, workbenchVerified: value.workbenchVerified as boolean,
    ...(typeof value.diagnosticCode === 'string' && failure(value.diagnosticCode).code === value.diagnosticCode ? { diagnosticCode: value.diagnosticCode } : {}) }
}
interface ResumeHint { operationId: string; transactionId: string }
function saveHint(value: ResumeHint): void {
  try { globalThis.sessionStorage?.setItem(RESUME_KEY, JSON.stringify(value)) } catch { /* Host journal remains authoritative. */ }
}
function readHint(): ResumeHint | undefined {
  try {
    const raw = globalThis.sessionStorage?.getItem(RESUME_KEY)
    if (!raw || raw.length > 512) return undefined
    const value: unknown = JSON.parse(raw)
    if (record(value) && Object.keys(value).length === 2 && typeof value.operationId === 'string' && UUID.test(value.operationId)
      && typeof value.transactionId === 'string' && TRANSACTION.test(value.transactionId)) return { operationId: value.operationId, transactionId: value.transactionId }
  } catch { /* Malformed hints grant no authority. */ }
  return undefined
}
function clearHint(operationId: string): void {
  try { if (readHint()?.operationId === operationId) globalThis.sessionStorage?.removeItem(RESUME_KEY) } catch { /* Optional storage. */ }
}
/** No capability is inferred from a general Manager token or an older protocol. */
export function createWorkbenchManagerRestartBridge(): WorkbenchManagerRestartBridgeV2 | undefined {
  const doc = globalThis.document
  const fetcher = globalThis.fetch
  if (doc?.querySelector === undefined || typeof fetcher !== 'function'
    || doc.querySelector('meta[name="dsh-manager-restart"]')?.getAttribute('content') !== 'operation-status-v2') return undefined
  let token = doc.querySelector('meta[name="dsh-manager-token"]')?.getAttribute('content')?.trim()
  if (!token) return undefined
  let requesting: { transactionId: string; promise: Promise<{ operationId: string }> } | undefined
  const call = async (url: string, init: RequestInit, timeoutMs = 5_000): Promise<Response> => fetcher(url, {
    ...init, credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(timeoutMs),
  })
  const renewToken = async (timeoutMs: number): Promise<void> => {
    const response = await call('/', { method: 'GET' }, timeoutMs)
    if (!response.ok) throw new Error('reconnecting')
    const html = await response.text()
    if (html.length > 2 * 1024 * 1024) throw failure('restart-failed')
    const page = new DOMParser().parseFromString(html, 'text/html')
    const fresh = page.querySelector('meta[name="dsh-manager-token"]')?.getAttribute('content')?.trim()
    if (!fresh || page.querySelector('meta[name="dsh-manager-restart"]')?.getAttribute('content') !== 'operation-status-v2') throw new Error('reconnecting')
    token = fresh
  }
  const readStatus = async (operationId: string, timeoutMs = 5_000): Promise<WorkbenchRestartStatusV1> => {
    if (!UUID.test(operationId)) throw failure('restart-failed')
    const requestDeadline = Date.now() + Math.max(1, Math.min(timeoutMs, 5_000))
    const remaining = (): number => {
      const time = requestDeadline - Date.now()
      if (time <= 0) throw new Error('reconnecting')
      return time
    }
    const url = `/__dsh_manager/workbench-package/restart-status?operationId=${encodeURIComponent(operationId)}`
    let response = await call(url, { method: 'GET', headers: { 'x-dsh-manager-token': token! } }, remaining())
    if (response.status === 403) {
      await renewToken(remaining())
      response = await call(url, { method: 'GET', headers: { 'x-dsh-manager-token': token! } }, remaining())
    }
    if (response.status >= 500) throw new Error('reconnecting')
    const payload: unknown = await response.json()
    if (!response.ok) throw failure(record(payload) ? payload.code : undefined)
    return parseStatus(payload, operationId)
  }
  const requestRestart = (transactionId: string): Promise<{ operationId: string }> => {
    if (!TRANSACTION.test(transactionId)) return Promise.reject(failure('transaction-missing'))
    if (requesting !== undefined) return requesting.transactionId === transactionId ? requesting.promise : Promise.reject(failure('restart-busy'))
    const promise = (async () => {
      const resumed = readHint()
      // A disconnect never authorizes a second POST. Recovery is query-only.
      if (resumed !== undefined) {
        if (resumed.transactionId === transactionId) return { operationId: resumed.operationId }
        // Connectivity loss cannot prove that an operation ended. Retain the
        // hint and refuse a second POST until terminal facts are available.
        const status = await readStatus(resumed.operationId, 2_000)
        if (status.transactionId !== resumed.transactionId) throw failure('transaction-missing')
        if (status.phase !== 'failed' && status.phase !== 'skipped' && !isWorkbenchRestartComplete(status)) throw failure('restart-busy')
        clearHint(resumed.operationId)
      }
      const response = await call('/__dsh_manager/workbench-package/restart', { method: 'POST', headers: {
        'x-dsh-manager-token': token!, 'x-dsh-workbench-transaction-id': transactionId,
      } })
      const payload: unknown = await response.json()
      if (!response.ok || !record(payload) || payload.ok !== true) throw failure(record(payload) ? payload.code : undefined)
      if (typeof payload.operationId !== 'string' || !UUID.test(payload.operationId)) throw failure('restart-failed')
      saveHint({ operationId: payload.operationId, transactionId })
      return { operationId: payload.operationId }
    })().finally(() => { requesting = undefined })
    requesting = { transactionId, promise }
    return promise
  }
  const waitForRestart: WorkbenchManagerRestartBridgeV2['waitForRestart'] = async ({ operationId, transactionId, timeoutMs = 60_000, onStatus }) => {
    if (!UUID.test(operationId) || !TRANSACTION.test(transactionId)) throw failure('transaction-missing')
    const deadline = Date.now() + (Number.isFinite(timeoutMs) ? Math.max(1, Math.min(timeoutMs, 120_000)) : 60_000)
    let delay = 250
    while (Date.now() < deadline) {
      try {
        const status = await readStatus(operationId, Math.max(1, Math.min(5_000, deadline - Date.now())))
        if (status.transactionId !== transactionId) throw failure('transaction-missing')
        onStatus?.(status)
        if (status.phase === 'failed' || status.phase === 'skipped') { clearHint(operationId); throw failure(status.diagnosticCode) }
        if (isWorkbenchRestartComplete(status)) { clearHint(operationId); return { operationId, transactionId, status } }
      } catch (error) {
        if (error instanceof WorkbenchRestartError) throw error
        // The old Run disappearing is expected. Only facts can settle an op.
      }
      const remaining = deadline - Date.now()
      if (remaining <= 0) break
      await new Promise(resolve => setTimeout(resolve, Math.min(delay, remaining)))
      delay = Math.min(Math.round(delay * 1.6), 1_000)
    }
    throw failure('restart-failed')
  }
  return { requestRestart, getRestartStatus: readStatus, waitForRestart,
    resumeRestart: async onStatus => {
      const hint = readHint()
      return hint === undefined ? undefined : waitForRestart({ ...hint, ...(onStatus === undefined ? {} : { onStatus }) })
    },
  }
}
