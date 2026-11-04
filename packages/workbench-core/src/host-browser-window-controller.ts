import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { isIP } from 'node:net'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { ConnectionRpcHandlerResult, HostConnectionHandle } from '@deepseek-ai/dsh-client-connection'
import { workbenchWindowEndpointForRpc } from './workbench-window-rpc.ts'
import { createWorkbenchShareSessionManager } from './host-workbench-share-session.ts'
import { createWorkbenchShareGateway, type WorkbenchShareGatewayV1 } from './host-workbench-share-gateway.ts'
import { createWorkbenchSharePresenceBroker } from './host-workbench-share-presence.ts'
import { decodeFloatingHandoff, type FloatingHandoffV1 } from './floating-handoff.ts'

const TICKET_TTL_MS = 2 * 60_000
const TERMINAL_TTL_MS = 5 * 60_000
const BROWSER_HEARTBEAT_TTL_MS = 90_000
const LOST_VIEW_RETENTION_MS = 24 * 60 * 60_000
const MAX_RECORDS = 256

export interface ExternalBrowserLaunchSpecV1 {
  readonly file: string
  readonly args: readonly string[]
}

/**
 * Build a direct OS URL-handler invocation. Windows' `start` is a cmd.exe
 * built-in, so passing a URL containing `&token=...` through `/c start` lets
 * the shell split the query into a second command before the browser sees it.
 */
export function externalBrowserLaunchSpec(url: string, platform = process.platform): ExternalBrowserLaunchSpecV1 {
  if (platform === 'win32') return { file: 'rundll32.exe', args: ['url.dll,FileProtocolHandler', url] }
  if (platform === 'darwin') return { file: 'open', args: [url] }
  return { file: 'xdg-open', args: [url] }
}

type ViewStatus = 'prepared' | 'requested' | 'redeemed' | 'ready' | 'reclaim-requested' | 'reclaimed' | 'closed' | 'failed' | 'expired'
interface ViewRecord {
  windowId: string
  workbenchId: string
  status: ViewStatus
  createdAt: number
  expiresAt: number
  updatedAt: number
  ticketHash?: string
  closeTokenHash?: string
  failureCode?: string
  browserUrl?: string
  shared?: boolean
  floating?: FloatingHandoffV1
  floatingReturned?: boolean
}

function isLoopback(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/gu, '')
  if (host === 'localhost' || host.endsWith('.localhost') || host === '::1') return true
  if (isIP(host) !== 4) return false
  return Number(host.split('.')[0]) === 127
}

function ok(value: unknown): ConnectionRpcHandlerResult {
  return { ok: true, value }
}

function fail(code: string): ConnectionRpcHandlerResult {
  return { ok: false, error: { code, message: code, details: {} } }
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined
}

function runtimeMetricSnapshot(value: unknown): Record<string, unknown> | undefined {
  const input = record(value)
  if (input === undefined) return undefined
  const output: Record<string, unknown> = {}
  for (const key of ['mountedEditorOutlets', 'reportedAt']) {
    if (typeof input[key] === 'number' && Number.isFinite(input[key])) output[key] = input[key]
  }
  const view = record(input.view)
  if (view !== undefined) {
    const safeView: Record<string, unknown> = {}
    for (const key of ['workbenchId', 'account']) if (typeof view[key] === 'string') safeView[key] = view[key]
    for (const key of ['openWorkbenches', 'areas', 'tabs', 'visibleAreas', 'collapsedAreas']) {
      if (typeof view[key] === 'number' && Number.isFinite(view[key])) safeView[key] = view[key]
    }
    output.view = safeView
  }
  const saves = record(input.layoutSaves)
  if (saves !== undefined) {
    const safeSaves: Record<string, unknown> = {}
    for (const key of ['attempted', 'inFlight', 'committed', 'conflicted', 'failed', 'lastDurationMs']) {
      if (typeof saves[key] === 'number' && Number.isFinite(saves[key])) safeSaves[key] = saves[key]
    }
    if (typeof saves.lastStatus === 'string') safeSaves.lastStatus = saves.lastStatus
    output.layoutSaves = safeSaves
  }
  return output
}

function validWorkbenchId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,160}$/u.test(value)
}

function ticketDigest(ticket: string): string {
  return createHash('sha256').update(ticket).digest('hex')
}

export interface HostBrowserWindowControllerOptionsV1 {
  readonly origin: string
  readonly authenticatedUrl: (url: string) => string
  readonly lookupWorkbench: (workbenchId: string) => boolean
  readonly openExternalBrowser?: ((url: string) => boolean | Promise<boolean>) | undefined
  readonly now?: () => number
}

/**
 * Issues one-time browser-view tickets. DSH Connection owns authentication and
 * transport; this controller owns only transient routing and readiness facts.
 */
export function createHostBrowserWindowController(options: HostBrowserWindowControllerOptionsV1) {
  const now = options.now ?? Date.now
  const views = new Map<string, ViewRecord>()
  const activeByWorkbenchId = new Map<string, string>()
  const tickets = new Map<string, ViewRecord>()
  const closeTokens = new Map<string, ViewRecord>()
  const runtimeMetricsByWindow = new Map<string, { readonly workbenchId: string; readonly snapshot: Record<string, unknown>; readonly updatedAt: number }>()
  let disposed = false

  const expire = (view: ViewRecord) => {
    if (view.status === 'prepared' || view.status === 'requested' || view.status === 'redeemed') {
      view.status = 'expired'
      view.updatedAt = now()
      if (view.ticketHash !== undefined) tickets.delete(view.ticketHash)
      delete view.ticketHash
      if (view.closeTokenHash !== undefined) closeTokens.delete(view.closeTokenHash)
      delete view.closeTokenHash
    }
    if (activeByWorkbenchId.get(view.workbenchId) === view.windowId) activeByWorkbenchId.delete(view.workbenchId)
    runtimeMetricsByWindow.delete(view.windowId)
  }

  const releaseActive = (view: ViewRecord) => {
    if (activeByWorkbenchId.get(view.workbenchId) === view.windowId) activeByWorkbenchId.delete(view.workbenchId)
  }

  const prune = () => {
    const at = now()
    for (const view of views.values()) {
      if (at >= view.expiresAt) expire(view)
      if ((view.status === 'ready' || view.status === 'reclaim-requested')
        && at - view.updatedAt >= BROWSER_HEARTBEAT_TTL_MS) {
        const reclaimExpired = view.status === 'reclaim-requested'
        view.status = 'failed'
        view.failureCode = reclaimExpired
          ? 'browser-view-reclaim-timeout'
          : 'browser-view-heartbeat-timeout'
        view.updatedAt = at
      }
      const lostView = view.status === 'failed' && view.failureCode === 'browser-view-heartbeat-timeout'
      if ((view.status === 'closed' || view.status === 'reclaimed' || view.status === 'expired'
        || (view.status === 'failed' && !lostView))
        && at - view.updatedAt >= TERMINAL_TTL_MS
        || (lostView && at - view.updatedAt >= LOST_VIEW_RETENTION_MS)) {
        if (view.closeTokenHash !== undefined) closeTokens.delete(view.closeTokenHash)
        releaseActive(view)
        runtimeMetricsByWindow.delete(view.windowId)
        views.delete(view.windowId)
      }
    }
    if (views.size >= MAX_RECORDS) {
      const oldest = [...views.values()]
        .filter(view => view.status === 'ready' || view.status === 'closed' || view.status === 'reclaimed' || view.status === 'failed' || view.status === 'expired')
        .sort((a, b) => a.updatedAt - b.updatedAt)[0]
      if (oldest !== undefined) {
        if (oldest.closeTokenHash !== undefined) closeTokens.delete(oldest.closeTokenHash)
        releaseActive(oldest)
        runtimeMetricsByWindow.delete(oldest.windowId)
        views.delete(oldest.windowId)
      }
    }
  }

  const prepare = (payload: unknown, shared = false): ConnectionRpcHandlerResult => {
    const body = record(payload)
    if (body === undefined || Object.keys(body).some(key => key !== 'workbenchId') || !validWorkbenchId(body.workbenchId)) {
      return fail('invalid-workbench-id')
    }
    if (!options.lookupWorkbench(body.workbenchId)) return fail('workbench-unavailable')
    prune()
    const activeWindowId = shared ? undefined : activeByWorkbenchId.get(body.workbenchId)
    if (activeWindowId !== undefined) {
      const active = views.get(activeWindowId)
      if (active !== undefined && ['prepared', 'requested', 'redeemed', 'ready', 'reclaim-requested'].includes(active.status)) {
        return ok({ status: 'already-open', windowId: active.windowId, workbenchId: active.workbenchId, state: active.status })
      }
      activeByWorkbenchId.delete(body.workbenchId)
    }
    if (views.size >= MAX_RECORDS) return fail('browser-view-limit-reached')
    let host: URL
    try { host = new URL(options.origin) } catch { return fail('browser-view-origin-unavailable') }
    if (!['http:', 'https:'].includes(host.protocol) || !isLoopback(host.hostname)
      || host.username !== '' || host.password !== '') return fail('browser-view-requires-loopback-host')
    host.pathname = '/workbench'
    host.search = ''
    host.hash = ''

    const at = now()
    const ticket = randomBytes(32).toString('base64url')
    const hash = ticketDigest(ticket)
    const view: ViewRecord = {
      windowId: randomUUID(), workbenchId: body.workbenchId,
      status: 'prepared', createdAt: at, expiresAt: at + TICKET_TTL_MS, updatedAt: at, ticketHash: hash, shared,
    }
    const target = new URL(host)
    target.search = new URLSearchParams({ workbench: ticket }).toString()
    let url: URL
    try { url = new URL(options.authenticatedUrl(target.href)) } catch { return fail('browser-view-auth-url-invalid') }
    const params = [...url.searchParams.keys()]
    if (url.origin !== host.origin || url.pathname !== '/workbench'
      || url.hash !== '' || params.length !== 2 || !url.searchParams.has('token')
      || url.searchParams.get('workbench') !== ticket || !url.searchParams.get('token')) {
      return fail('browser-view-auth-url-invalid')
    }
    view.browserUrl = url.href
    views.set(view.windowId, view)
    if (!shared) activeByWorkbenchId.set(view.workbenchId, view.windowId)
    tickets.set(hash, view)
    return ok({ status: 'prepared', windowId: view.windowId, url: url.href, expiresAt: view.expiresAt, shared })
  }

  const handle = async (endpoint: string, payload: unknown): Promise<ConnectionRpcHandlerResult> => {
    if (disposed) return fail('browser-view-controller-disposed')
    const body = record(payload)
    if (endpoint === 'prepare') return prepare(payload)
    if (endpoint === 'prepare-shared') return prepare(payload, true)
    if (body === undefined) return fail('invalid-request')

    if (endpoint === 'floating-stage' || endpoint === 'floating-read') {
      if (Object.keys(body).some(key => !['windowId', 'closeToken', 'snapshot'].includes(key)) || typeof body.windowId !== 'string') return fail('invalid-request')
      const view = views.get(body.windowId)
      if (!view || view.shared) return fail('floating-handoff-unauthorized')
      if (endpoint === 'floating-stage') {
        if (view.status !== 'prepared') return fail('floating-handoff-not-prepared')
        const snapshot = decodeFloatingHandoff(body.snapshot)
        if (!snapshot) return fail('invalid-floating-handoff')
        view.floating = snapshot
        return ok({ status: 'staged' })
      }
      const terminal = view.status === 'reclaimed' || view.status === 'closed'
      if (!terminal && (typeof body.closeToken !== 'string' || ticketDigest(body.closeToken) !== view.closeTokenHash)) return fail('floating-handoff-unauthorized')
      if (!terminal && !['redeemed', 'ready', 'reclaim-requested'].includes(view.status)) return fail('floating-handoff-not-ready')
      if (terminal) return ok({ snapshot: view.floatingReturned ? view.floating ?? null : null,
        incomplete: !!view.floating && !view.floatingReturned })
      // A reload must not replay the outgoing snapshot and resurrect closed tabs.
      const snapshot = view.status === 'redeemed' ? view.floating ?? null : null
      return ok({ snapshot })
    }

    if (endpoint === 'redeem') {
      if (Object.keys(body).some(key => key !== 'ticket')
        || typeof body.ticket !== 'string' || !/^[A-Za-z0-9_-]{40,64}$/u.test(body.ticket)) return fail('invalid-ticket')
      const hash = ticketDigest(body.ticket)
      const view = tickets.get(hash)
      if (view === undefined) return fail('ticket-unknown-or-replayed')
      if (now() >= view.expiresAt) { expire(view); return fail('ticket-expired') }
      if (view.status !== 'prepared' && view.status !== 'requested') return fail('ticket-unknown-or-replayed')
      tickets.delete(hash)
      delete view.ticketHash
      view.status = 'redeemed'
      view.updatedAt = now()
      const closeToken = randomBytes(32).toString('base64url')
      view.closeTokenHash = ticketDigest(closeToken)
      closeTokens.set(view.closeTokenHash, view)
      // The close token is intentionally not derived from the redeem ticket.
      // It is returned only once, after the one-time ticket has been consumed.
      return ok({ status: 'redeemed', view: {
        schemaVersion: 1, windowId: view.windowId, workbenchId: view.workbenchId, mode: 'browser-workbench',
        closeToken,
      } })
    }

    if (endpoint === 'launch') {
      if (Object.keys(body).some(key => key !== 'windowId')
        || typeof body.windowId !== 'string' || !/^[A-Za-z0-9-]{36}$/u.test(body.windowId)) return fail('invalid-window-id')
      const view = views.get(body.windowId)
      if (view === undefined) return fail('browser-view-not-found')
      if (view.status !== 'prepared' || view.browserUrl === undefined) return fail('browser-view-not-ready')
      if (options.openExternalBrowser === undefined) return fail('browser-popup-blocked')
      if (!await options.openExternalBrowser(view.browserUrl)) return fail('browser-launch-failed')
      return ok({ status: 'launched' })
    }

    if (endpoint === 'reclaim') {
      if (Object.keys(body).some(key => key !== 'windowId') || typeof body.windowId !== 'string'
        || !/^[A-Za-z0-9-]{36}$/u.test(body.windowId)) return fail('invalid-window-id')
      const view = views.get(body.windowId)
      if (view === undefined) return fail('browser-view-not-found')
      if (view.shared === true) return fail('browser-view-reclaim-not-allowed')
      const at = now()
      if (view.status === 'ready' && at - view.updatedAt >= BROWSER_HEARTBEAT_TTL_MS) {
        view.status = 'failed'
        view.failureCode = 'browser-view-heartbeat-timeout'
        view.updatedAt = at
      }
      if (view.status === 'failed' && view.failureCode === 'browser-view-heartbeat-timeout') {
        view.status = 'reclaimed'
        view.updatedAt = at
        releaseActive(view)
        runtimeMetricsByWindow.delete(view.windowId)
        delete view.failureCode
        if (view.closeTokenHash !== undefined) closeTokens.delete(view.closeTokenHash)
        delete view.closeTokenHash
        return ok({ status: view.status })
      }
      if (view.status === 'failed' && view.failureCode === 'browser-view-reclaim-timeout') {
        view.status = 'reclaim-requested'
        delete view.failureCode
      }
      if (view.status !== 'ready' && view.status !== 'reclaim-requested') return fail('browser-view-not-ready')
      view.status = 'reclaim-requested'
      view.updatedAt = at
      return ok({ status: view.status })
    }

    if (endpoint === 'reclaimed') {
      if (Object.keys(body).some(key => !['closeToken', 'floating'].includes(key)) || typeof body.closeToken !== 'string'
        || !/^[A-Za-z0-9_-]{40,64}$/u.test(body.closeToken)) return fail('invalid-close-token')
      const hash = ticketDigest(body.closeToken)
      const view = closeTokens.get(hash)
      if (view?.status === 'reclaimed' && view.closeTokenHash === hash) {
        return JSON.stringify(body.floating === undefined ? undefined : decodeFloatingHandoff(body.floating)) === JSON.stringify(view.floating) ? ok({ status: 'reclaimed' }) : fail('floating-handoff-already-returned')
      }
      if (view === undefined || view.closeTokenHash !== hash || view.status !== 'reclaim-requested') {
        return fail('browser-view-reclaim-unauthorized')
      }
      if (view.shared) return fail('floating-handoff-unauthorized')
      if (view.floating && body.floating === undefined) return fail('floating-handoff-required')
      if (body.floating !== undefined) {
        const snapshot = decodeFloatingHandoff(body.floating)
        if (!snapshot) return fail('invalid-floating-handoff')
        view.floating = snapshot
        view.floatingReturned = true
      }
      // Retain the receipt until normal expiry so a lost response can be retried.
      view.status = 'reclaimed'
      view.updatedAt = now()
      releaseActive(view)
      runtimeMetricsByWindow.delete(view.windowId)
      return ok({ status: view.status })
    }

    if (endpoint === 'metrics') {
      if (Object.keys(body).some(key => !['windowId', 'workbenchId', 'snapshot'].includes(key))
        || typeof body.windowId !== 'string' || !/^[A-Za-z0-9-]{36}$/u.test(body.windowId)
        || typeof body.workbenchId !== 'string' || !validWorkbenchId(body.workbenchId)) return fail('invalid-metrics-request')
      const view = views.get(body.windowId)
      if (view === undefined || view.workbenchId !== body.workbenchId) return fail('browser-view-not-found')
      const snapshot = runtimeMetricSnapshot(body.snapshot)
      if (snapshot === undefined) return fail('invalid-metrics-request')
      runtimeMetricsByWindow.set(view.windowId, { workbenchId: view.workbenchId, snapshot, updatedAt: now() })
      return ok({ status: 'recorded' })
    }

    if (endpoint === 'closed') {
      if (Object.keys(body).some(key => !['closeToken', 'floating'].includes(key)) || typeof body.closeToken !== 'string'
        || !/^[A-Za-z0-9_-]{40,64}$/u.test(body.closeToken)) return fail('invalid-close-token')
      const hash = ticketDigest(body.closeToken)
      const view = closeTokens.get(hash)
      if (view === undefined || view.closeTokenHash !== hash) return fail('browser-view-close-unauthorized')
      if (body.floating !== undefined) {
        if (view.shared || view.status === 'reclaimed') return fail('floating-handoff-unauthorized')
        const snapshot = decodeFloatingHandoff(body.floating)
        if (!snapshot) return fail('invalid-floating-handoff')
        view.floating = snapshot
        view.floatingReturned = true
      }
      closeTokens.delete(hash)
      delete view.closeTokenHash
      if (view.status === 'prepared' || view.status === 'requested' || view.status === 'redeemed'
        || view.status === 'ready' || view.status === 'reclaim-requested'
        || (view.status === 'failed' && view.failureCode === 'browser-view-heartbeat-timeout')) {
        view.status = 'closed'
        view.updatedAt = now()
        releaseActive(view)
        runtimeMetricsByWindow.delete(view.windowId)
        delete view.failureCode
      }
      return ok({ status: view.status })
    }

    if (endpoint === 'opened' || endpoint === 'ready' || endpoint === 'heartbeat' || endpoint === 'failed' || endpoint === 'status') {
      const allowedKeys = ['windowId', 'code']
      if (Object.keys(body).some(key => !allowedKeys.includes(key))
        || typeof body.windowId !== 'string' || !/^[A-Za-z0-9-]{36}$/u.test(body.windowId)) return fail('invalid-window-id')
      const view = views.get(body.windowId)
      if (view === undefined) return fail('browser-view-not-found')
      if (now() >= view.expiresAt && view.status !== 'ready' && view.status !== 'reclaim-requested'
        && view.status !== 'reclaimed' && view.status !== 'closed' && view.status !== 'failed') expire(view)
      const at = now()
      if ((view.status === 'ready' || view.status === 'reclaim-requested')
        && at - view.updatedAt >= BROWSER_HEARTBEAT_TTL_MS) {
        const reclaimExpired = view.status === 'reclaim-requested'
        view.status = 'failed'
        view.failureCode = reclaimExpired
          ? 'browser-view-reclaim-timeout'
          : 'browser-view-heartbeat-timeout'
        view.updatedAt = at
        if (!reclaimExpired) releaseActive(view)
      }
      if (endpoint === 'status') {
        const metrics = [...runtimeMetricsByWindow.values()]
          .filter(value => value.workbenchId === view.workbenchId)
          .sort((left, right) => right.updatedAt - left.updatedAt)[0]
        return ok({ status: view.status, ...(view.failureCode === undefined ? {} : { code: view.failureCode }), ...(metrics === undefined ? {} : { metrics: { ...metrics.snapshot, reportedAt: metrics.updatedAt } }) })
      }
      if (endpoint === 'opened') {
        if (view.status === 'prepared') { view.status = 'requested'; view.updatedAt = now() }
        return ok({ status: view.status })
      }
      if (endpoint === 'ready') {
        if (view.status !== 'redeemed' && view.status !== 'ready') return fail('browser-view-not-redeemed')
        view.status = 'ready'
        view.updatedAt = at
        return ok({ status: view.status })
      }
      if (endpoint === 'heartbeat') {
        if (view.status === 'reclaim-requested') {
          view.updatedAt = at
          return ok({ status: view.status })
        }
        if (view.status === 'failed' && view.failureCode === 'browser-view-reclaim-timeout') {
          view.status = 'reclaim-requested'
          delete view.failureCode
          view.updatedAt = at
          return ok({ status: view.status })
        }
        if (view.status === 'ready' || (view.status === 'failed' && view.failureCode === 'browser-view-heartbeat-timeout')) {
          view.status = 'ready'
          view.updatedAt = at
          delete view.failureCode
        }
        return ok({ status: view.status, ...(view.failureCode === undefined ? {} : { code: view.failureCode }) })
      }
      const code = typeof body.code === 'string' && /^[a-z0-9-]{1,80}$/u.test(body.code) ? body.code : 'browser-view-failed'
      if (view.status === 'ready') return ok({ status: view.status })
      view.status = 'failed'
      view.failureCode = code
      view.updatedAt = now()
      releaseActive(view)
      runtimeMetricsByWindow.delete(view.windowId)
      return ok({ status: view.status, code })
    }
    return fail('invalid-action')
  }

  return {
    handle,
    getRuntimeMetrics(workbenchId: string): Record<string, unknown> | undefined {
      const latest = [...runtimeMetricsByWindow.values()]
        .filter(value => value.workbenchId === workbenchId)
        .sort((left, right) => right.updatedAt - left.updatedAt)[0]
      return latest === undefined ? undefined : { ...latest.snapshot, reportedAt: latest.updatedAt }
    },
    dispose() { disposed = true; views.clear(); tickets.clear(); closeTokens.clear(); activeByWorkbenchId.clear(); runtimeMetricsByWindow.clear() },
  }
}

interface BrowserWindowHostContext {
  get<T = unknown>(name: string, strict?: boolean): T | undefined
  effect?(handler: () => (() => void) | void, key?: string): unknown
}

interface BrowserWindowWebServer {
  getOrigin(): string
  protocol?: 'http:' | 'https:'
  renderIndex?(html: string): string
  register?: (route: {
    kind: 'exact'
    path: string
    handler(request: IncomingMessage, response: ServerResponse): Promise<void>
  }) => () => void
}
interface BrowserWindowSettings {
  describe(): readonly { ns: string; value?: { workbenches?: Record<string, { archivedAt?: number }> } }[]
}
interface BrowserWindowConnection extends Pick<HostConnectionHandle, 'rpc' | 'authenticatedUrl'> {
  authorizeIndex?: (request: { method: string; headers: IncomingMessage['headers']; url: string }, response: ServerResponse) => boolean
  fetch: { register(route: {
    path: string
    methods: readonly ['POST']
    requestBody: 'buffered'
    fetch(request: Request): Promise<Response>
  }): () => Promise<void> }
}

const require = createRequire(import.meta.url)

function frontendIndexPath(): string | undefined {
  try {
    return join(dirname(require.resolve('@deepseek-ai/dsh-web-frontend/package.json')), 'dist', 'index.html')
  } catch {
    return undefined
  }
}

interface CapturedResponse {
  statusCode?: number
  headers?: Record<string, string | string[]>
  body?: string
}

interface WorkbenchDocumentAuth {
  readonly authorized: boolean
  readonly setCookie?: string | string[]
  readonly cleanupUrl?: string
}

/**
 * Authenticate a dedicated Workbench document without sending the browser
 * through the normal `/` redirect. Connection's public auth contract only
 * accepts launch tokens on `/`, so capture that response and redirect back to
 * the exact Workbench path while preserving the one-time ticket.
 */
function authorizeWorkbenchDocument(
  connection: BrowserWindowConnection,
  request: IncomingMessage,
  response: ServerResponse,
): WorkbenchDocumentAuth {
  if (connection.authorizeIndex === undefined) return { authorized: false }
  const requestUrl = new URL(request.url ?? '/workbench', 'http://dsh.invalid')
  const token = requestUrl.searchParams.get('token')
  const ticket = requestUrl.searchParams.get('workbench')
  if (token !== null) {
    if (ticket === null || !/^[A-Za-z0-9_-]{40,64}$/u.test(ticket)
      || requestUrl.searchParams.getAll('token').length !== 1
      || requestUrl.searchParams.getAll('workbench').length !== 1
      || [...requestUrl.searchParams.keys()].some(key => key !== 'token' && key !== 'workbench')) {
      response.writeHead(400, { 'cache-control': 'no-store' })
      response.end()
      return { authorized: false }
    }
    let captured: CapturedResponse = {}
    const capture: ServerResponse = {
      writeHead(statusCode: number, headers?: Record<string, string | string[]>) {
        captured = headers === undefined ? { statusCode } : { statusCode, headers }
        return capture
      },
      end(chunk?: unknown) {
        captured.body = chunk === undefined ? '' : String(chunk)
        return capture
      },
    } as unknown as ServerResponse
    const authorized = connection.authorizeIndex({ method: request.method ?? 'GET', headers: request.headers, url: `/?token=${encodeURIComponent(token)}` }, capture)
    if (authorized) return { authorized: true }
    if (captured.statusCode === 303) {
      // DSH's BrowserAuth intentionally redirects to `./` after minting its
      // authority-bound cookie. A system browser opening a custom exact route
      // can drop that cookie across our second redirect, leaving the clean
      // Workbench document unauthorized. Keep the official cookie and finish
      // the document response in one round trip instead. The page removes the
      // launch token from its address bar before Workbench starts redeeming the
      // one-time ticket.
      const setCookie = captured.headers?.['set-cookie']
      if (setCookie === undefined) {
        response.writeHead(401, { 'cache-control': 'no-store' })
        response.end()
        return { authorized: false }
      }
      return {
        authorized: true,
        setCookie,
        cleanupUrl: `/workbench?workbench=${encodeURIComponent(ticket)}`,
      }
    }
    response.writeHead(captured.statusCode ?? 401, captured.headers ?? { 'cache-control': 'no-store' })
    response.end(captured.body)
    return { authorized: false }
  }
  return {
    authorized: connection.authorizeIndex({ method: request.method ?? 'GET', headers: request.headers, url: request.url ?? '/workbench' }, response),
  }
}

export function createWorkbenchDocumentHandler(
  connection: BrowserWindowConnection,
  server: BrowserWindowWebServer,
  readIndex: () => Promise<string> = async () => {
    const indexPath = frontendIndexPath()
    if (indexPath === undefined) throw new Error('frontend-index-unavailable')
    return readFile(indexPath, 'utf8')
  },
): (request: IncomingMessage, response: ServerResponse) => Promise<void> {
  return async (request, response) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { 'cache-control': 'no-store' })
      response.end()
      return
    }
    const auth = authorizeWorkbenchDocument(connection, request, response)
    if (!auth.authorized) return
    if (server.renderIndex === undefined) {
      response.writeHead(503, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' })
      response.end('Workbench browser document is unavailable on this DSH host')
      return
    }
    try {
      const source = await readIndex()
      const rendered = server.renderIndex(source)
      const cleanup = auth.cleanupUrl === undefined ? ''
        : `<script>history.replaceState(null,"",${JSON.stringify(auth.cleanupUrl)})<\/script>`
      const html = `${rendered.replace(/<head(?=\s|>)[^>]*>/i, match => `${match}${cleanup}`)}`
        .replace(/<html(?=\s|>)/i, '<html data-workbench-document="v1"')
        .replace(/<title>[\s\S]*?<\/title>/i, '<title>Workbench</title>')
      response.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
        ...(auth.setCookie === undefined ? {} : { 'set-cookie': auth.setCookie }),
        'content-length': Buffer.byteLength(html).toString(),
      })
      response.end(request.method === 'HEAD' ? undefined : html)
    } catch {
      response.writeHead(503, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' })
      response.end('Workbench browser document failed to load')
    }
  }
}

const BROWSER_WINDOW_RPC_ACTIONS = [
  'prepare', 'launch', 'redeem', 'opened', 'ready', 'failed', 'status', 'heartbeat', 'reclaim', 'reclaimed', 'metrics',
  'floating-stage', 'floating-read',
] as const

const BROWSER_SHARE_ENDPOINTS = ['start', 'stop', 'status', 'presence', 'guest-rename', 'guest-kick'] as const

interface BrowserWindowRpcRequest {
  type?: unknown
  rpcId?: unknown
  method?: unknown
  payload?: unknown
}

function sendRpcResponse(response: ServerResponse, rpcId: string, result: ConnectionRpcHandlerResult): void {
  response.writeHead(200, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  response.end(JSON.stringify({ type: 'server-response', rpcId, result: result.ok
    ? { ok: true, value: result.value }
    : { ok: false, error: result.error } }))
}

async function readJsonBody(request: IncomingMessage, limit = 1024 * 1024): Promise<BrowserWindowRpcRequest> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += bytes.byteLength
    if (size > limit) throw new Error('request-too-large')
    chunks.push(bytes)
  }
  const value: unknown = JSON.parse(Buffer.concat(chunks, size).toString('utf8'))
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('invalid-rpc-request')
  return value as BrowserWindowRpcRequest
}

/**
 * DSH Desktop serves `/api` through its WebServer exact-route registry. Keep
 * this adapter carrier-neutral: it emits the same Connection RPC envelope as
 * `connection.rpc.intercept()` and delegates every action to one controller.
 */
function registerDesktopRpcRoutes(
  server: BrowserWindowWebServer,
  handler: (endpoint: string, payload: unknown) => Promise<ConnectionRpcHandlerResult>,
): (() => void) | undefined {
  if (typeof server.register !== 'function') return undefined
  const disposers = BROWSER_WINDOW_RPC_ACTIONS.map(endpoint => server.register!({
    kind: 'exact',
    path: `/api/workbench-window/${endpoint}`,
    async handler(request, response) {
      if (request.method !== 'POST' || request.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json') {
        response.writeHead(405, { 'cache-control': 'no-store' })
        response.end()
        return
      }
      try {
        const body = await readJsonBody(request)
        if (body.type !== 'client-request' || typeof body.rpcId !== 'string' || body.method !== `workbench-window/${endpoint}`) {
          response.writeHead(400, { 'cache-control': 'no-store' })
          response.end()
          return
        }
        sendRpcResponse(response, body.rpcId, await handler(endpoint, body.payload))
      } catch {
        response.writeHead(400, { 'cache-control': 'no-store' })
        response.end()
      }
    },
  }))
  return () => { for (const dispose of disposers) dispose() }
}

/** Register the carrier-neutral ticket route on DSH's authenticated Connection. */
export function installWorkbenchBrowserWindowController(ctx: BrowserWindowHostContext): (() => void) | undefined {
  const connection = ctx.get<BrowserWindowConnection>('connection', false)
  const server = ctx.get<BrowserWindowWebServer>('webServer', false)
  const settings = ctx.get<BrowserWindowSettings>('settings', false)
  if (connection === undefined || server === undefined || settings === undefined) return undefined
  const openExternalBrowser = process.versions.electron === undefined ? undefined : (url: string): boolean => {
    try {
      const launch = externalBrowserLaunchSpec(url)
      const child = spawn(launch.file, [...launch.args], {
        detached: true,
        ...(process.platform === 'win32' ? { windowsHide: true } : {}),
        stdio: 'ignore',
      })
      child.unref()
      return true
    } catch { return false }
  }
  const controller = createHostBrowserWindowController({
    origin: server.getOrigin(),
    authenticatedUrl: url => connection.authenticatedUrl(url),
    lookupWorkbench: workbenchId => settings.describe().some(row =>
      row.ns === 'workbench-layout' && row.value?.workbenches?.[workbenchId] !== undefined
      && row.value.workbenches[workbenchId]?.archivedAt === undefined),
    openExternalBrowser,
  })
  const shareSessions = createWorkbenchShareSessionManager()
  const presence = createWorkbenchSharePresenceBroker()
  let shareGateway: WorkbenchShareGatewayV1 | undefined
  let shareGatewayStart: Promise<WorkbenchShareGatewayV1> | undefined
  const getShareGateway = async (): Promise<WorkbenchShareGatewayV1> => {
    if (shareGateway !== undefined) return shareGateway
    shareGatewayStart ??= createWorkbenchShareGateway({
      upstreamOrigin: server.getOrigin(),
      manager: shareSessions,
      prepareView: async workbenchId => {
        const result = await controller.handle('prepare-shared', { workbenchId })
        if (!result.ok || typeof result.value !== 'object' || result.value === null) throw new Error(result.ok ? 'workbench-share-view-invalid' : result.error.code)
        const value = result.value as { windowId?: unknown; url?: unknown; expiresAt?: unknown }
        if (typeof value.windowId !== 'string' || typeof value.url !== 'string' || typeof value.expiresAt !== 'number') throw new Error('workbench-share-view-invalid')
        return { windowId: value.windowId, url: value.url, expiresAt: value.expiresAt }
      },
      redeemView: async ticket => {
        const result = await controller.handle('redeem', { ticket })
        if (!result.ok || typeof result.value !== 'object' || result.value === null) throw new Error(result.ok ? 'workbench-share-view-invalid' : result.error.code)
        const value = (result.value as { view?: unknown }).view
        if (typeof value !== 'object' || value === null) throw new Error('workbench-share-view-invalid')
        const view = value as { schemaVersion?: unknown; windowId?: unknown; workbenchId?: unknown; mode?: unknown; closeToken?: unknown }
        if (view.schemaVersion !== 1 || typeof view.windowId !== 'string' || typeof view.workbenchId !== 'string' || view.mode !== 'browser-workbench' || typeof view.closeToken !== 'string') throw new Error('workbench-share-view-invalid')
        const ready = await controller.handle('ready', { windowId: view.windowId })
        if (!ready.ok) throw new Error(ready.error.code)
        return view as never
      },
      closeView: async closeToken => { await controller.handle('closed', { closeToken }) },
    }).then(value => { shareGateway = value; return value })
    return shareGatewayStart
  }
  const shareRpc = async (endpoint: string, payload: unknown): Promise<ConnectionRpcHandlerResult> => {
    const body = record(payload)
    if (endpoint === 'start') {
      const workbenchId = body?.workbenchId
      if (body === undefined || Object.keys(body).some(key => key !== 'workbenchId') || !validWorkbenchId(workbenchId)
        || !settings.describe().some(row => row.ns === 'workbench-layout' && row.value?.workbenches?.[workbenchId] !== undefined && row.value.workbenches[workbenchId]?.archivedAt === undefined)) return fail('workbench-unavailable')
      try {
        const gateway = await getShareGateway()
        const result = await gateway.startShare(workbenchId)
        return ok(result)
      } catch (error) { return fail(error instanceof Error ? error.message : 'workbench-share-start-failed') }
    }
    if (endpoint === 'stop') {
      if (body === undefined || Object.keys(body).some(key => key !== 'workbenchId') || !validWorkbenchId(body.workbenchId)) return fail('invalid-workbench-id')
      await shareGateway?.stopShare(body.workbenchId)
      presence.clearWorkbench(body.workbenchId)
      return ok({ status: 'stopped' })
    }
    if (endpoint === 'status') {
      if (body !== undefined && Object.keys(body).some(key => key !== 'workbenchId')) return fail('invalid-request')
      const workbenchId = body?.workbenchId
      const sessions = shareSessions.getSnapshot()
        .filter(row => workbenchId === undefined || row.workbenchId === workbenchId)
        .map(row => {
          const latestMetrics = controller.getRuntimeMetrics(row.workbenchId)
          return {
            ...row,
            network: shareGateway?.getMetrics(row.workbenchId) ?? {
              httpRequests: 0, httpErrors: 0, httpInFlight: 0, queueDepth: 0,
              websocketConnections: 0, websocketReconnects: 0,
            },
            presenceCount: presence.snapshot({ workbenchId: row.workbenchId }).length,
            ...(latestMetrics === undefined ? {} : { workbenchMetrics: latestMetrics }),
          }
        })
      return ok({ sessions })
    }
    if (endpoint === 'guest-rename') {
      if (body === undefined || Object.keys(body).some(key => !['workbenchId', 'leaseId', 'nickname'].includes(key))
        || !validWorkbenchId(body.workbenchId) || !validWorkbenchId(body.leaseId)
        || typeof body.nickname !== 'string' || body.nickname.trim().length < 1 || body.nickname.trim().length > 32
        || /[\u0000-\u001f\u007f]/u.test(body.nickname)) return fail('invalid-guest-profile')
      if (!shareSessions.setNickname(body.workbenchId, body.leaseId, body.nickname.trim())) return fail('workbench-share-guest-not-found')
      return ok({ status: 'renamed' })
    }
    if (endpoint === 'guest-kick') {
      if (body === undefined || Object.keys(body).some(key => !['workbenchId', 'leaseId'].includes(key))
        || !validWorkbenchId(body.workbenchId) || !validWorkbenchId(body.leaseId)) return fail('invalid-guest-profile')
      const kicked = await shareGateway?.kickGuest(body.workbenchId, body.leaseId)
      if (kicked !== true) return fail('workbench-share-guest-not-found')
      return ok({ status: 'kicked' })
    }
    if (endpoint === 'presence') {
      if (body === undefined || typeof body.action !== 'string' || !validWorkbenchId(body.workbenchId)) return fail('invalid-presence-request')
      if (shareSessions.getSession(body.workbenchId) === undefined) return fail('workbench-share-inactive')
      if (body.action === 'publish' || body.action === 'clear') {
        const activeSession = shareSessions.getSession(body.workbenchId)
        if (activeSession === undefined) return fail('workbench-share-inactive')
      }
      if (body.action === 'read') {
        if (Object.keys(body).some(key => !['action', 'workbenchId', 'sessionId', 'areaId', 'role'].includes(key))) return fail('invalid-presence-request')
        if (body.sessionId !== undefined && !validWorkbenchId(body.sessionId)) return fail('invalid-presence-request')
        if (body.areaId !== undefined && !validWorkbenchId(body.areaId)) return fail('invalid-presence-request')
        if (body.role !== undefined && body.role !== 'host' && body.role !== 'guest') return fail('invalid-presence-request')
        return ok({ presence: presence.snapshot({
          workbenchId: body.workbenchId,
          ...(body.sessionId === undefined ? {} : { sessionId: body.sessionId }),
          ...(body.areaId === undefined ? {} : { areaId: body.areaId }),
          ...(body.role === undefined ? {} : { role: body.role }),
        }) })
      }
      if (body.action === 'clear') {
        const sessionId = body.sessionId
        const areaId = body.areaId
        if (Object.keys(body).some(key => !['action', 'workbenchId', 'participantId', 'sessionId', 'areaId'].includes(key))
          || !validWorkbenchId(body.participantId)) return fail('invalid-presence-request')
        if (sessionId !== undefined && !validWorkbenchId(sessionId)) return fail('invalid-presence-request')
        if (areaId !== undefined && !validWorkbenchId(areaId)) return fail('invalid-presence-request')
        presence.clearParticipant(body.workbenchId, body.participantId, sessionId as string | undefined, areaId as string | undefined)
        return ok({ status: 'cleared' })
      }
      if (body.action === 'publish') {
        const revision = body.revision
        if (Object.keys(body).some(key => !['action', 'workbenchId', 'sessionId', 'areaId', 'participantId', 'role', 'typing', 'draftText', 'hasAttachments', 'revision'].includes(key))) return fail('invalid-presence-request')
        if (!validWorkbenchId(body.sessionId) || !validWorkbenchId(body.areaId) || !validWorkbenchId(body.participantId)
          || (body.role !== 'host' && body.role !== 'guest') || typeof body.typing !== 'boolean'
          || typeof body.draftText !== 'string' || typeof body.hasAttachments !== 'boolean'
          || typeof revision !== 'number' || !Number.isSafeInteger(revision)) return fail('invalid-presence-request')
        const result = presence.publish({
          workbenchId: body.workbenchId,
          sessionId: body.sessionId,
          areaId: body.areaId,
          participantId: body.participantId,
          role: body.role,
          typing: body.typing,
          draftText: body.draftText,
          hasAttachments: body.hasAttachments,
          revision,
        })
        return result.ok ? ok(result) : fail(result.error)
      }
      return fail('invalid-presence-action')
    }
    return fail('invalid-action')
  }
  const registerShareRoutes = connection.fetch.register
  const unregisterShareRoutes = BROWSER_SHARE_ENDPOINTS.map(endpoint => registerShareRoutes({
    path: `/api/workbench-share/${endpoint}`, methods: ['POST'], requestBody: 'buffered',
    async fetch(request) {
      try {
        const envelope = await request.json() as { type?: unknown; rpcId?: unknown; method?: unknown; payload?: unknown }
        if (envelope.type !== 'client-request' || typeof envelope.rpcId !== 'string' || envelope.method !== `workbench-share/${endpoint}`) return new Response(null, { status: 400 })
        const result = await shareRpc(endpoint, envelope.payload)
        return new Response(JSON.stringify({ type: 'server-response', rpcId: envelope.rpcId, result: result.ok ? { ok: true, value: result.value } : { ok: false, error: result.error } }), { status: 200, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } })
      } catch { return new Response(null, { status: 400 }) }
    },
  }))
  // DSH Desktop routes its app protocol through the authenticated shared
  // `/api` carrier. A standalone RPC prefix works on plain HTTP but is
  // rejected by `dsh-app://` with HTTP 405.
  const rpcHandler = async (endpoint: string, payload: unknown) => {
    const action = workbenchWindowEndpointForRpc(endpoint)
    return action === undefined ? fail('invalid-action') : controller.handle(action, payload)
  }
  const unregisterDesktop = registerDesktopRpcRoutes(server, async (endpoint, payload) => rpcHandler(`workbench-window/${endpoint}`, payload))
  const unregisterWorkbenchDocument = typeof server.register === 'function'
    ? server.register({
      kind: 'exact',
      path: '/workbench',
      handler: createWorkbenchDocumentHandler(connection, server),
    })
    : undefined
  // A DSH Desktop WebServer exact route and the shared `/api` interceptor are
  // alternative carriers for the same request. Registering both makes one
  // launch request observable twice in hosts that dispatch both registries,
  // which can open two system-browser pages. Prefer the exact route when the
  // host exposes it and use the interceptor only as the web fallback.
  let unregister: (() => Promise<void>) | (() => void) = () => {}
  if (unregisterDesktop === undefined) {
    try {
      unregister = typeof connection.rpc.intercept === 'function'
        ? connection.rpc.intercept('/api', endpoint => workbenchWindowEndpointForRpc(endpoint) !== undefined, rpcHandler)
        : connection.rpc.handle('/workbench-window', async (endpoint, payload) => controller.handle(endpoint, payload))
    } catch {
      // The host did not expose a usable fallback carrier.
    }
  }
  const unregisterClose = connection.fetch.register({
    // Connection exact routes are mounted on the shared `/api` carrier. Keep
    // the full path here so registration succeeds before the RPC interceptor
    // is exposed to the desktop protocol.
    path: '/api/workbench-window-close', methods: ['POST'], requestBody: 'buffered',
    async fetch(request) {
      try {
        const payload = await request.json() as unknown
        const result = await controller.handle('closed', payload)
        return result.ok
          ? new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } })
          : new Response(null, { status: 400, headers: { 'cache-control': 'no-store' } })
      } catch {
        return new Response(null, { status: 400, headers: { 'cache-control': 'no-store' } })
      }
    },
  })
  return () => {
    controller.dispose()
    void shareGateway?.close()
    presence.dispose()
    shareSessions.dispose()
    unregisterWorkbenchDocument?.(); unregisterDesktop?.(); void unregister(); void unregisterClose()
    for (const dispose of unregisterShareRoutes) void dispose()
  }
}
