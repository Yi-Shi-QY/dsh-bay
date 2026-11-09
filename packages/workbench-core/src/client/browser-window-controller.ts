import type { ClientConnectionRpc, ConnectionRpcResult } from '@deepseek-ai/dsh-client-connection/client'
import {
  normalizeWorkbenchWindowSnapshot,
  type WorkbenchWindowControllerV1,
  type WorkbenchWindowOpenResultV1,
  type WorkbenchWindowRequestV1,
  type WorkbenchWindowSnapshotV1,
} from './workbench-window-controller.ts'
import { WORKBENCH_WINDOW_RPC_CHANNEL, workbenchWindowRpcEndpoint } from '../workbench-window-rpc.ts'
import type { FloatingHandoffV1 } from '../floating-handoff.ts'

const PREPARE_TIMEOUT_MS = 8_000
const STATUS_TIMEOUT_MS = 4_000
const READY_TIMEOUT_MS = 25_000
const STATUS_POLL_INTERVAL_MS = 2_000
const HEARTBEAT_RECOVERY_WINDOW_MS = 2 * 60_000

interface PreparedView { readonly windowId: string; readonly url: string; readonly expiresAt: number }
interface BrowserWindowControllerOptions {
  readonly rpc?: ClientConnectionRpc | undefined
  readonly floating?: { snapshot(workbenchId: string): FloatingHandoffV1; restore(workbenchId: string, value: unknown): void; incomplete?(workbenchId: string): void }
}

function unwrap(result: ConnectionRpcResult<unknown>): unknown {
  if (result.ok) return result.value
  throw new Error(result.error.code)
}

function isLoopback(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/gu, '')
  if (host === 'localhost' || host.endsWith('.localhost') || host === '::1') return true
  const octets = host.split('.').map(Number)
  return octets.length === 4 && octets.every(value => Number.isInteger(value) && value >= 0 && value <= 255) && octets[0] === 127
}

/**
 * DSH's desktop build exposes a public preload bridge. Prefer that signal to
 * the UA because branded desktop builds may omit or move the Electron token.
 * The UA checks remain a compatibility fallback for older desktop shells.
 */
export function isElectronCarrier(): boolean {
  if (typeof window !== 'undefined') {
    const desktop = (window as Window & { dshDesktop?: unknown }).dshDesktop
    if (desktop !== undefined) return true
  }
  if (typeof navigator === 'undefined') return false
  return /Electron\//u.test(navigator.userAgent) || /@deepseek-ai\/dsh-desktop\//u.test(navigator.userAgent)
}

function isPreparedView(value: unknown): value is PreparedView {
  if (typeof value !== 'object' || value === null) return false
  const row = value as Partial<PreparedView>
  if (typeof row.windowId !== 'string' || !/^[A-Za-z0-9-]{36}$/u.test(row.windowId)
    || typeof row.url !== 'string' || typeof row.expiresAt !== 'number' || !Number.isFinite(row.expiresAt)) return false
  try {
    const url = new URL(row.url)
    return ['http:', 'https:'].includes(url.protocol) && isLoopback(url.hostname)
      && url.pathname === '/workbench' && url.hash === '' && url.searchParams.size === 2
      && url.searchParams.has('token') && /^[A-Za-z0-9_-]{40,64}$/u.test(url.searchParams.get('workbench') ?? '')
  } catch { return false }
}

function stableSnapshot(value: WorkbenchWindowSnapshotV1): WorkbenchWindowSnapshotV1 {
  return normalizeWorkbenchWindowSnapshot(value)
}

/** Browser carrier uses DSH Connection RPC for both the desktop IPC and web transports. */
export function createBrowserWindowController({ rpc, floating }: BrowserWindowControllerOptions = {}): WorkbenchWindowControllerV1 & {
  prepare(workbenchId: string): Promise<boolean>
  setRpc(rpc?: ClientConnectionRpc): void
  dispose(): void
} {
  const listeners = new Set<() => void>()
  const prepared = new Map<string, PreparedView>()
  const requests = new Map<string, WorkbenchWindowRequestV1>()
  const generations = new Map<string, number>()
  let activeRpc = rpc
  let disposed = false
  let snapshot = stableSnapshot({ supported: activeRpc !== undefined, windows: [] })
  const publish = (next: WorkbenchWindowSnapshotV1) => {
    if (disposed) return
    snapshot = stableSnapshot(next)
    for (const listener of [...listeners]) listener()
  }
  const generationFor = (workbenchId: string) => generations.get(workbenchId) ?? 0
  const nextGeneration = (workbenchId: string) => {
    const generation = generationFor(workbenchId) + 1
    generations.set(workbenchId, generation)
    return generation
  }
  const publishRequest = (request: WorkbenchWindowRequestV1) => {
    requests.set(request.workbenchId, request)
    publish({ supported: activeRpc !== undefined, windows: [], requests: [...requests.values()], request })
  }
  const requestFor = (workbenchId: string) => requests.get(workbenchId)
  const restored = new Set<string>()
  const restoring = new Map<string, Promise<void>>()
  const call = async (endpoint: string, payload: unknown, timeoutMs = STATUS_TIMEOUT_MS): Promise<unknown> => {
    if (activeRpc === undefined) throw new Error('dsh-connection-unavailable')
    const signal = AbortSignal.timeout(timeoutMs)
    const result = await activeRpc.call(WORKBENCH_WINDOW_RPC_CHANNEL, workbenchWindowRpcEndpoint(endpoint), payload, signal)
    return unwrap(result)
  }
  const restoreFloating = async (workbenchId: string, windowId: string) => {
    if (!floating || restored.has(windowId)) return
    const pending = restoring.get(windowId)
    if (pending) return pending
    const task = (async () => {
      const value = await call('floating-read', { windowId }) as { snapshot?: unknown; incomplete?: boolean }
      if (value.snapshot != null) floating.restore(workbenchId, value.snapshot)
      else if (value.incomplete) floating.incomplete?.(workbenchId)
      restored.add(windowId)
    })()
    restoring.set(windowId, task)
    try { await task } finally { restoring.delete(windowId) }
  }
  const prepare = async (workbenchId: string): Promise<boolean> => {
    if (disposed || !/^[A-Za-z0-9_-]{1,160}$/u.test(workbenchId)) return false
    const generation = nextGeneration(workbenchId)
    const previousPrepared = prepared.get(workbenchId)
    publishRequest({ workbenchId, status: 'preparing' })
    try {
      const result = await call('prepare', { workbenchId }, PREPARE_TIMEOUT_MS)
      if (typeof result === 'object' && result !== null && (result as { status?: unknown }).status === 'already-open') {
        const existing = result as { status: 'already-open'; windowId?: unknown; workbenchId?: unknown; state?: unknown }
        const states: readonly WorkbenchWindowRequestV1['status'][] = ['prepared', 'requested', 'redeemed', 'ready', 'reclaiming']
        if (existing.workbenchId === workbenchId && typeof existing.windowId === 'string'
          && /^[A-Za-z0-9-]{36}$/u.test(existing.windowId) && states.includes(existing.state as WorkbenchWindowRequestV1['status'])) {
          if (existing.state === 'prepared' && previousPrepared !== undefined) prepared.set(workbenchId, previousPrepared)
          publishRequest({ workbenchId, status: existing.state as WorkbenchWindowRequestV1['status'], windowId: existing.windowId, code: 'already-open' })
          return existing.state === 'prepared' && previousPrepared !== undefined
        }
      }
      if (disposed || generation !== generationFor(workbenchId) || typeof result !== 'object' || result === null
        || (result as { status?: unknown }).status !== 'prepared' || !isPreparedView(result)) throw new Error('browser-view-prepare-invalid')
      const view = result as PreparedView
      prepared.delete(workbenchId)
      prepared.set(workbenchId, view)
      publishRequest({ workbenchId, status: 'prepared' })
      return true
    } catch (error) {
      prepared.delete(workbenchId)
      if (!disposed && generation === generationFor(workbenchId)) publishRequest({
        // A failed prepare is a request failure, not proof that the DSH
        // Connection service disappeared. Keep the carrier available so the
        // menu can offer a retry and expose the real failure code.
        workbenchId, status: 'failed', code: error instanceof Error ? error.message : 'browser-view-prepare-failed',
      })
      return false
    }
  }
  const poll = async (workbenchId: string, windowId: string, generation: number) => {
    const deadline = Date.now() + READY_TIMEOUT_MS
    let ready = false
    let heartbeatRecoveryDeadline: number | undefined
    while (!disposed && generation === generationFor(workbenchId) && (ready || Date.now() < deadline)) {
      if (heartbeatRecoveryDeadline !== undefined && Date.now() >= heartbeatRecoveryDeadline) return
      await new Promise(resolve => setTimeout(resolve, ready ? STATUS_POLL_INTERVAL_MS : 800))
      if (disposed || generation !== generationFor(workbenchId)) return
      try {
        const result = await call('status', { windowId }) as { status?: unknown; code?: unknown; metrics?: unknown }
        const runtimeMetrics = typeof result.metrics === 'object' && result.metrics !== null && !Array.isArray(result.metrics)
          ? { runtimeMetrics: result.metrics as Readonly<Record<string, unknown>> } : {}
        if (result.status === 'ready') {
          publishRequest({ workbenchId, status: 'ready', windowId, ...runtimeMetrics })
          ready = true
          heartbeatRecoveryDeadline = undefined
          continue
        }
        if (result.status === 'reclaim-requested') {
          publishRequest({ workbenchId, status: 'reclaiming', windowId })
          ready = true
          continue
        }
        if (result.status === 'failed' && result.code === 'browser-view-reclaim-timeout') {
          publishRequest({ workbenchId, status: 'reclaiming', windowId, code: result.code as string })
          ready = true
          continue
        }
        if (result.status === 'reclaimed') {
          await restoreFloating(workbenchId, windowId)
          publishRequest({ workbenchId, status: 'reclaimed', windowId })
          return
        }
        if (result.status === 'failed' && result.code === 'browser-view-heartbeat-timeout') {
          publishRequest({ workbenchId, status: 'failed', windowId, code: 'browser-view-heartbeat-timeout' })
          heartbeatRecoveryDeadline ??= Date.now() + HEARTBEAT_RECOVERY_WINDOW_MS
          continue
        }
        if (result.status === 'failed' || result.status === 'expired' || result.status === 'closed') {
          if (result.status === 'closed') await restoreFloating(workbenchId, windowId)
          publishRequest({ workbenchId, status: result.status as WorkbenchWindowRequestV1['status'], windowId,
            ...(typeof result.code === 'string' ? { code: result.code } : {}) })
          return
        }
      } catch { /* a transient reconnect is handled by the next status poll */ }
    }
    if (!ready && !disposed && generation === generationFor(workbenchId)) publishRequest({
      workbenchId, status: 'failed', windowId, code: 'browser-view-ready-timeout',
    })
  }
  const waitForReclaimConfirmation = async (workbenchId: string, windowId: string, generation: number): Promise<boolean> => {
    const deadline = Date.now() + 30_000
    while (!disposed && generation === generationFor(workbenchId) && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, STATUS_POLL_INTERVAL_MS))
      if (disposed || generation !== generationFor(workbenchId)) return false
      try {
        const result = await call('status', { windowId }) as { status?: unknown }
        if (result.status === 'reclaimed') {
          await restoreFloating(workbenchId, windowId)
          publishRequest({ workbenchId, status: 'reclaimed', windowId })
          return true
        }
        if (result.status === 'closed') {
          await restoreFloating(workbenchId, windowId)
          publishRequest({ workbenchId, status: 'closed', windowId })
          return true
        }
        if (result.status !== 'reclaim-requested') return false
      } catch { /* reconnect on the next poll */ }
    }
    return false
  }
  return {
    getSnapshot: () => snapshot,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener) } },
    prepare,
    setRpc(nextRpc) {
      if (activeRpc === nextRpc) return
      activeRpc = nextRpc
      publish({ ...snapshot, supported: activeRpc !== undefined })
    },
    async open(workbenchId, reservedPopup): Promise<WorkbenchWindowOpenResultV1> {
      const view = prepared.get(workbenchId)
      if (disposed || activeRpc === undefined) return { status: 'unsupported', code: 'dsh-connection-unavailable' }
      if (view === undefined || view.expiresAt <= Date.now()) return { status: 'failed', code: 'browser-link-not-ready' }
      // Freeze the source before snapshotting; async staging must not race edits.
      publishRequest({ workbenchId, status: 'requested', windowId: view.windowId })
      try {
        if (floating) await call('floating-stage', { windowId: view.windowId, snapshot: floating.snapshot(workbenchId) }, PREPARE_TIMEOUT_MS)
      } catch (error) {
        const code = error instanceof Error ? error.message : 'floating-handoff-stage-failed'
        publishRequest({ workbenchId, status: 'failed', code })
        return { status: 'failed', code }
      }
      prepared.delete(workbenchId)
      const generation = nextGeneration(workbenchId)
      try {
        // Electron must use only the Host launcher. Calling window.open first
        // creates an extra Electron page before the system browser is started.
        // A normal web carrier still opens synchronously to preserve activation.
        const popup = reservedPopup === undefined
          ? isElectronCarrier() ? undefined : typeof window === 'undefined' ? undefined : window.open(view.url, '_blank')
          : reservedPopup
        if (popup !== undefined && popup !== null
          && typeof popup.location?.replace === 'function') popup.location.replace(view.url)
        if (isElectronCarrier() || popup === null) {
          const launched = await call('launch', { windowId: view.windowId }, PREPARE_TIMEOUT_MS) as { status?: unknown }
          if (launched.status !== 'launched') throw new Error('browser-popup-blocked')
        }
        if (popup !== undefined && popup !== null) try { popup.opener = null } catch { /* some browser policies make opener read-only */ }
        publishRequest({ workbenchId, status: 'requested', windowId: view.windowId })
        void call('opened', { windowId: view.windowId }).catch(() => {})
        void poll(workbenchId, view.windowId, generation)
        return { status: 'requested', carrier: 'browser' }
      } catch {
        const code = 'browser-popup-blocked'
        publishRequest({ workbenchId, status: 'failed', code })
        return { status: 'failed', code }
      }
    },
    async reclaim(workbenchId) {
      const current = requestFor(workbenchId)
      if (disposed || activeRpc === undefined || current?.workbenchId !== workbenchId
        || (current.status !== 'ready' && current.status !== 'reclaiming'
          && !(current.status === 'failed' && current.code === 'browser-view-heartbeat-timeout'))
        || !/^[A-Za-z0-9-]{36}$/u.test(current.windowId ?? '')) {
        return { status: 'failed', code: 'browser-view-not-ready' }
      }
      const windowId = current.windowId
      if (windowId === undefined) return { status: 'failed', code: 'browser-view-not-ready' }
      const generation = nextGeneration(workbenchId)
      publishRequest({ workbenchId, status: 'reclaiming', windowId })
      try {
        const result = await call('reclaim', { windowId, ...(current.status === 'reclaiming' ? { force: true } : {}) }) as { status?: unknown }
        if (result.status === 'reclaimed' && !disposed && generation === generationFor(workbenchId)) {
          await restoreFloating(workbenchId, windowId)
          publishRequest({ workbenchId, status: 'reclaimed', windowId })
          return { status: 'reclaimed' }
        }
        if (disposed || generation !== generationFor(workbenchId) || result.status !== 'reclaim-requested') {
          throw new Error('browser-view-reclaim-rejected')
        }
        const confirmed = await waitForReclaimConfirmation(workbenchId, windowId, generation)
        if (!confirmed) throw new Error('browser-view-reclaim-timeout')
        return { status: 'reclaimed' }
      } catch (error) {
        if (!disposed && generation === generationFor(workbenchId)) {
          let hostStatus: unknown
          try { hostStatus = (await call('status', { windowId }) as { status?: unknown }).status } catch { /* remain locked */ }
          if (hostStatus === 'ready') publishRequest({
            workbenchId, status: 'ready', windowId,
            code: error instanceof Error ? error.message : 'browser-view-reclaim-failed',
          })
          else publishRequest({
            workbenchId, status: 'reclaiming', windowId,
            code: error instanceof Error ? error.message : 'browser-view-reclaim-failed',
          })
        }
        return { status: 'failed', code: error instanceof Error ? error.message : 'browser-view-reclaim-failed' }
      }
    },
    focus: async () => ({ status: 'failed', code: 'browser-window-controlled-by-user' }),
    close: async () => ({ status: 'failed', code: 'browser-window-controlled-by-user' }),
    dispose() { disposed = true; prepared.clear(); requests.clear(); generations.clear(); listeners.clear() },
  }
}
