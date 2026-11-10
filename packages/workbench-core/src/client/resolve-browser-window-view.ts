import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { ClientConnectionRpc, ConnectionRpcResult } from '@deepseek-ai/dsh-client-connection/client'
import type { WorkbenchWindowViewV1 } from './workbench-window-view.ts'
import { WORKBENCH_WINDOW_RPC_CHANNEL, workbenchWindowRpcEndpoint } from '../workbench-window-rpc.ts'
import type { FloatingHandoffV1 } from '../floating-handoff.ts'
import { isWorkbenchShareGuestPage } from './workbench-share-guest.ts'
import { browserSafeUuid } from '../browser-safe-id.ts'

const STORAGE_KEY = 'dsh-workbench.browser-view.v1'
const RPC_TIMEOUT_MS = 8_000
const HEARTBEAT_INTERVAL_MS = 15_000
const RPC_READY_WAIT_MS = 10_000
const PAGE_ID = browserSafeUuid()
const proof = (view: WorkbenchWindowViewV1) => ({ windowId: view.windowId, closeToken: view.closeToken, pageId: PAGE_ID })

export type BrowserWorkbenchViewResolutionV1 =
  | { readonly status: 'none' }
  | { readonly status: 'ready'; readonly view: WorkbenchWindowViewV1 }
  | { readonly status: 'failed'; readonly code: string }

function validate(value: unknown): WorkbenchWindowViewV1 | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const view = value as Partial<WorkbenchWindowViewV1>
  return view.schemaVersion === 1 && typeof view.windowId === 'string' && /^[A-Za-z0-9-]{36}$/u.test(view.windowId)
    && typeof view.workbenchId === 'string' && /^[A-Za-z0-9_-]{1,160}$/u.test(view.workbenchId)
    && view.mode === 'browser-workbench'
    && typeof view.closeToken === 'string' && /^[A-Za-z0-9_-]{40,64}$/u.test(view.closeToken)
    ? Object.freeze({ schemaVersion: 1 as const, windowId: view.windowId, workbenchId: view.workbenchId, mode: 'browser-workbench' as const, closeToken: view.closeToken }) : undefined
}

function rpcFor(ctx: ClientContext): ClientConnectionRpc | undefined {
  const connection = (ctx as ClientContext & { connection?: { rpc?: ClientConnectionRpc } }).connection
  if (connection?.rpc !== undefined) return connection.rpc
  try {
    const fallback = (ctx as ClientContext & { get?: (name: string) => unknown }).get?.('connection') as { rpc?: ClientConnectionRpc } | undefined
    return fallback?.rpc
  } catch { return undefined }
}

async function waitForRpc(ctx: ClientContext): Promise<ClientConnectionRpc | undefined> {
  const immediate = rpcFor(ctx)
  if (immediate !== undefined) return immediate
  const candidate = ctx as ClientContext & { connection?: unknown; get?: unknown }
  // A plain test context or a host that does not expose Connection cannot
  // become ready later. Fail closed immediately instead of making a missing
  // provider look like a slow network problem.
  if (candidate.connection === undefined && typeof candidate.get !== 'function') return undefined
  const deadline = Date.now() + RPC_READY_WAIT_MS
  while (Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 50))
    const next = rpcFor(ctx)
    if (next !== undefined) return next
  }
  return undefined
}

async function call(rpc: ClientConnectionRpc, endpoint: string, payload: unknown): Promise<unknown> {
  const result: ConnectionRpcResult<unknown> = await rpc.call(WORKBENCH_WINDOW_RPC_CHANNEL, workbenchWindowRpcEndpoint(endpoint), payload, AbortSignal.timeout(RPC_TIMEOUT_MS))
  if (!result.ok) throw new Error(result.error.code)
  return result.value
}

function storedView(): WorkbenchWindowViewV1 | undefined {
  try {
    const value = window.sessionStorage.getItem(STORAGE_KEY)
    return value === null ? undefined : validate(JSON.parse(value))
  } catch { return undefined }
}

function rememberView(view: WorkbenchWindowViewV1): void {
  try { window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(view)) } catch { /* storage may be disabled */ }
}

function forgetView(): void {
  try { window.sessionStorage.removeItem(STORAGE_KEY) } catch { /* storage may be disabled */ }
  ;(window as unknown as { __WORKBENCH_WINDOW_VIEW__?: unknown }).__WORKBENCH_WINDOW_VIEW__ = undefined
}

async function verifyStoredView(rpc: ClientConnectionRpc | undefined, view: WorkbenchWindowViewV1): Promise<WorkbenchWindowViewV1 | undefined> {
  if (rpc === undefined) { forgetView(); return undefined }
  try {
    const result = await call(rpc, 'status', { windowId: view.windowId }) as { status?: unknown }
    if (result.status === 'ready' || result.status === 'redeemed' || result.status === 'reclaim-requested') {
      if (!isWorkbenchShareGuestPage()) await call(rpc, 'attach', { closeToken: view.closeToken, pageId: PAGE_ID })
      return view
    }
  } catch { /* a stale browser page must not regain control without Host confirmation */ }
  forgetView()
  return undefined
}

/** Detect a browser handoff before asynchronous ticket validation begins. */
export function hasBrowserWorkbenchIntent(): boolean {
  if (typeof window === 'undefined') return false
  if (window.location.pathname === '/workbench') return true
  const fragment = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : ''
  if (new URLSearchParams(fragment).has('workbench')) return true
  if ((window as unknown as { __WORKBENCH_WINDOW_VIEW__?: unknown }).__WORKBENCH_WINDOW_VIEW__ !== undefined) return true
  try { return window.sessionStorage.getItem(STORAGE_KEY) !== null } catch { return false }
}

/** Consume the one-time query ticket before the first Workbench render. */
export async function resolveBrowserWorkbenchView(ctx: ClientContext): Promise<BrowserWorkbenchViewResolutionV1> {
  if (typeof window === 'undefined') return { status: 'none' }
  const rawExisting = (window as unknown as { __WORKBENCH_WINDOW_VIEW__?: unknown }).__WORKBENCH_WINDOW_VIEW__
  const existing = validate(rawExisting)
  if (rawExisting !== undefined && existing === undefined) return { status: 'failed', code: 'browser-view-record-invalid' }
  if (existing !== undefined) {
    const verified = await verifyStoredView(await waitForRpc(ctx), existing)
    return verified === undefined ? { status: 'failed', code: 'browser-view-not-authorized' } : { status: 'ready', view: verified }
  }
  const params = new URLSearchParams(window.location.search)
  const ticket = params.get('workbench')
  if (ticket === null) {
    let hasStoredView = false
    try { hasStoredView = window.sessionStorage.getItem(STORAGE_KEY) !== null } catch { /* storage can be unavailable */ }
    if (!hasStoredView) return window.location.pathname === '/workbench'
      ? { status: 'failed', code: 'browser-view-ticket-missing' }
      : { status: 'none' }
    const stored = storedView()
    if (stored === undefined) return { status: 'failed', code: 'browser-view-record-invalid' }
    const verified = await verifyStoredView(await waitForRpc(ctx), stored)
    if (verified === undefined) return { status: 'failed', code: 'browser-view-not-authorized' }
    ;(window as unknown as { __WORKBENCH_WINDOW_VIEW__?: unknown }).__WORKBENCH_WINDOW_VIEW__ = verified
    return { status: 'ready', view: verified }
  }
  if (window.location.pathname !== '/workbench' || params.size !== 1
    || params.toString() !== `workbench=${encodeURIComponent(ticket)}`
    || !/^[A-Za-z0-9_-]{40,64}$/u.test(ticket)) return { status: 'failed', code: 'browser-view-ticket-invalid' }
  // The DSH Web Host can publish the Connection service one tick after the
  // plugin client starts. Do not fall back to the full DSH page while a valid
  // Workbench ticket is waiting for that service.
  const rpc = await waitForRpc(ctx)
  if (rpc === undefined) return { status: 'failed', code: 'browser-view-connection-unavailable' }
  try {
    const result = await call(rpc, 'redeem', { ticket }) as { status?: unknown; view?: unknown }
    const view = result.status === 'redeemed' ? validate(result.view) : undefined
    if (view !== undefined) {
      await call(rpc, 'attach', { closeToken: view.closeToken, pageId: PAGE_ID })
      // Consume the one-time query only after Host redemption succeeds.
      // A connection timeout must leave the page recoverable with its ticket.
      window.history.replaceState(null, '', window.location.pathname)
      rememberView(view)
      ;(window as unknown as { __WORKBENCH_WINDOW_VIEW__?: unknown }).__WORKBENCH_WINDOW_VIEW__ = view
      return { status: 'ready', view }
    }
    return { status: 'failed', code: 'browser-view-ticket-rejected' }
  } catch { return { status: 'failed', code: 'browser-view-ticket-rejected' } }
}

export async function reportBrowserWorkbenchReady(ctx: ClientContext, view: WorkbenchWindowViewV1): Promise<boolean> {
  const rpc = rpcFor(ctx)
  if (rpc === undefined) return false
  try {
    const current = await call(rpc, 'status', { windowId: view.windowId }) as { status?: unknown }
    if (current.status === 'ready' || current.status === 'reclaim-requested') return true
    await call(rpc, 'ready', proof(view))
    return true
  }
  catch {
    try { await call(rpc, 'failed', { ...proof(view), code: 'browser-view-runtime-failed' }) }
    catch { /* the DSH Connection lifecycle reports Host availability independently */ }
    return false
  }
}

export async function reportBrowserWorkbenchFailed(ctx: ClientContext, view: WorkbenchWindowViewV1, code: string): Promise<void> {
  const rpc = rpcFor(ctx)
  if (rpc) { try { await call(rpc, 'failed', { ...proof(view), code }) } catch { /* Host expiry remains the fallback. */ } }
}

/** Request reclaim from the browser view using its own Host-issued window identity. */
export async function requestBrowserWorkbenchReclaim(
  ctx: ClientContext,
  view: WorkbenchWindowViewV1,
): Promise<boolean> {
  const rpc = rpcFor(ctx)
  if (rpc === undefined || typeof window === 'undefined') return false
  try {
    const result = await call(rpc, 'reclaim', { windowId: view.windowId }) as { status?: unknown }
    if (result.status !== 'reclaim-requested') return false
    // Lock the browser surface as soon as Host accepts the request, then ask
    // the heartbeat owner to flush and acknowledge without waiting 15 seconds.
    window.dispatchEvent(new CustomEvent('workbench-browser-reclaim', { detail: { state: 'requested' } }))
    window.dispatchEvent(new Event('workbench-browser-reclaim-wake'))
    return true
  } catch { return false }
}

/** Keep the Host's view lease tied to the browser page, not DSH's status polling. */
export function startBrowserWorkbenchHeartbeat(
  ctx: ClientContext,
  view: WorkbenchWindowViewV1,
  onReclaimState?: (state: 'requested' | 'reclaimed') => void,
  floatingSnapshot?: () => FloatingHandoffV1,
): () => void {
  const rpc = rpcFor(ctx)
  if (rpc === undefined || typeof window === 'undefined') return () => {}
  let stopped = false
  let pending = false
  let wakeAfterPending = false
  let reclaimRequested = false
  const flushWorkbench = async (): Promise<boolean> => new Promise(resolve => {
    let settled = false
    const finish = (ok: boolean) => {
      if (settled) return
      settled = true
      window.clearTimeout(timer)
      resolve(ok)
    }
    const timer = window.setTimeout(() => finish(false), RPC_TIMEOUT_MS)
    window.dispatchEvent(new CustomEvent('workbench-browser-reclaim-flush', { detail: { complete: finish } }))
  })
  const acknowledgeReclaim = async () => {
    if (!reclaimRequested) {
      reclaimRequested = true
      onReclaimState?.('requested')
    }
    try { await call(rpc, 'reclaim-progress', { ...proof(view), phase: 'saving' }) } catch { /* Heartbeat remains the fallback on older Hosts. */ }
    if (!await flushWorkbench()) {
      try { await call(rpc, 'reclaim-progress', { ...proof(view), phase: 'saving', error: 'save-failed' }) } catch { /* retry through heartbeat */ }
      return
    }
    try { await call(rpc, 'reclaim-progress', { ...proof(view), phase: 'releasing' }) } catch { /* the receipt is authoritative */ }
    try {
      const result = await call(rpc, 'reclaimed', { closeToken: view.closeToken, ...(floatingSnapshot ? { floating: floatingSnapshot() } : {}) }) as { status?: unknown }
      if (result.status !== 'reclaimed' || stopped) return
      stopped = true
      window.clearInterval(timer)
      forgetView()
      onReclaimState?.('reclaimed')
    } catch { /* keep the browser locked and retry on its next heartbeat */ }
  }
  const heartbeat = () => {
    if (stopped) return
    if (pending) { wakeAfterPending = true; return }
    pending = true
    void call(rpc, 'heartbeat', proof(view))
      .then(async result => {
        const status = typeof result === 'object' && result !== null ? (result as { status?: unknown }).status : undefined
        if (status === 'reclaim-requested') {
          await acknowledgeReclaim()
        } else if (status === 'reclaimed' || status === 'closed' || status === 'expired' || status === 'failed') {
          // A receipt response may be lost, or the owner may reclaim a stale
          // lease. Reconnection must never revive the old browser controller.
          stopped = true
          window.clearInterval(timer)
          forgetView()
          onReclaimState?.('reclaimed')
        }
      })
      .catch(() => {}).finally(() => {
        pending = false
        if (wakeAfterPending && !stopped) {
          wakeAfterPending = false
          heartbeat()
        }
      })
  }
  const wake = () => heartbeat()
  window.addEventListener('workbench-browser-reclaim-wake', wake)
  const timer = window.setInterval(heartbeat, HEARTBEAT_INTERVAL_MS)
  let watchTimer: number | undefined
  const watch = async () => {
    if (stopped) return
    let delay = 250
    const startedAt = Date.now()
    try {
      const result = await call(rpc, 'watch-reclaim', proof(view)) as { status?: string }
      if (stopped) return
      delay = Math.max(250, 5_000 - (Date.now() - startedAt))
      if (result.status === 'reclaim-requested' || ['reclaimed', 'closed', 'expired', 'failed'].includes(result.status ?? '')) {
        heartbeat(); delay = 2_000
      }
    } catch { delay = HEARTBEAT_INTERVAL_MS }
    if (!stopped) watchTimer = window.setTimeout(() => { void watch() }, delay)
  }
  void watch()
  return () => {
    stopped = true
    window.clearInterval(timer)
    window.clearTimeout(watchTimer)
    window.removeEventListener('workbench-browser-reclaim-wake', wake)
  }
}

/** Best-effort lifecycle handoff when the browser view is closed or unloaded. */
export function reportBrowserWorkbenchClosed(ctx: ClientContext, view: WorkbenchWindowViewV1, floatingSnapshot?: () => FloatingHandoffV1): void {
  if (typeof navigator === 'undefined') return
  try {
    const notice = { action: 'suspend', closeToken: view.closeToken, pageId: PAGE_ID }
    const encode = (value: unknown) => new Blob([JSON.stringify(value)], { type: 'text/plain;charset=UTF-8' })
    const compact = encode(notice)
    const send = (body: Blob) => {
      try { return typeof navigator.sendBeacon === 'function' && navigator.sendBeacon('/api/workbench-window-close', body) } catch { return false }
    }
    try {
      const floating = floatingSnapshot?.()
      if (floating) {
        const payload = encode({ ...notice, floating })
        // Beacon/keepalive queues are commonly capped at 64 KiB. The full
        // handoff permits 512 KiB; it must never crowd out the close notice.
        if (payload.size <= 48 * 1024 && send(payload)) return
      }
    } catch { /* A busy/unserializable tab must not prevent lease suspension. */ }
    if (send(compact)) return
    if (typeof fetch === 'function') void fetch('/api/workbench-window-close', {
      method: 'POST', body: compact, credentials: 'same-origin', keepalive: true,
    }).catch(() => {})
  } catch { /* page teardown must never affect DSH or Workbench state */ }
}
