import { createServer, request as httpRequest, type IncomingMessage, type ServerResponse } from 'node:http'
import { networkInterfaces } from 'node:os'
import type { Duplex } from 'node:stream'
import { createHash } from 'node:crypto'
import { randomUUID } from 'node:crypto'
import { Readable } from 'node:stream'
import { once } from 'node:events'
import type { HostWorkbenchAccess } from './host-workbench-access.ts'
import { WORKBENCH_ACCESS_HEADER, SHARED_CONTROL_GRANT, type WorkbenchGrant, type WorkbenchAccessContext } from './workbench-access-contract.ts'
import { URL } from 'node:url'
import { guestDistributionDenied } from './host-distribution-guest-guard.ts'
import type { WorkbenchShareSessionManagerV1, WorkbenchShareSessionV1, WorkbenchShareViewLeaseV1 } from './host-workbench-share-session.ts'
import type { WorkbenchCollaborationManagerV1 } from './host-workbench-collaboration.ts'
import type { ParticipantPresenceV1, WorkbenchCollaborationEventV1, WorkbenchCommandEnvelopeV1 } from './workbench-collaboration-contract.ts'
import { WebSocketServer, type WebSocket } from 'ws'

const SHARE_COOKIE = 'dsh-workbench-share'
const MAX_PROXY_BODY = 300 * 1024 * 1024
const MAX_PROXY_IN_FLIGHT = 64
const MAX_PROXY_QUEUE = 128

interface NativeViewV1 {
  readonly schemaVersion: 1
  readonly windowId: string
  readonly workbenchId: string
  readonly mode: 'browser-workbench'
  readonly closeToken: string
}
interface PreparedViewV1 {
  readonly windowId: string
  readonly url: string
  readonly expiresAt: number
}

export interface WorkbenchShareGatewayOptionsV1 {
  readonly access?: HostWorkbenchAccess
  readonly guestHttp?: (request: Request, context: WorkbenchAccessContext) => Promise<Response>
  readonly guestUpgrade?: (request: IncomingMessage, socket: Duplex, head: Buffer, context: WorkbenchAccessContext) => void
  readonly revokeGuest?: (accessId: string) => void
  /** Dedicated shared-control channel; the legacy projected-presence endpoint is not used here. */
  readonly collaboration?: WorkbenchCollaborationManagerV1
  readonly upstreamOrigin: string
  readonly manager: WorkbenchShareSessionManagerV1
  readonly prepareView: (workbenchId: string) => Promise<PreparedViewV1>
  readonly redeemView: (ticket: string) => Promise<NativeViewV1>
  readonly closeView: (closeToken: string) => Promise<void>
  readonly networkInterfaces?: NodeJS.Dict<readonly { readonly family?: string | number; readonly address: string; readonly internal?: boolean }[] | undefined>
}

export interface WorkbenchShareGatewayMetricsV1 {
  readonly httpRequests: number
  readonly httpErrors: number
  readonly httpInFlight: number
  readonly queueDepth: number
  readonly websocketConnections: number
  readonly websocketReconnects: number
  readonly lastErrorAt?: number
}

export interface WorkbenchShareGatewayV1 {
  readonly host: string
  readonly port: number
  readonly origin: string
  startShare(workbenchId: string, grant?: WorkbenchGrant): Promise<{ readonly url: string; readonly status: 'started' | 'already-active' }>
  reduceShare(workbenchId: string, grant: WorkbenchGrant): void
  stopShare(workbenchId: string): Promise<void>
  kickGuest(workbenchId: string, leaseId: string): Promise<boolean>
  getMetrics(workbenchId: string): WorkbenchShareGatewayMetricsV1
  close(): Promise<void>
}

function digest(value: string): string { return createHash('sha256').update(value).digest('hex') }

function loopbackHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/gu, '')
  if (normalized === 'localhost' || normalized === '::1') return true
  const parts = normalized.split('.').map(Number)
  return parts.length === 4 && parts[0] === 127 && parts.every(part => Number.isInteger(part) && part >= 0 && part <= 255)
}

function privateIPv4(address: string): boolean {
  const parts = address.split('.').map(Number)
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return false
  const first = parts[0] ?? -1
  const second = parts[1] ?? -1
  return first === 10 || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 168)
}

export function selectPrivateIPv4(interfaces: WorkbenchShareGatewayOptionsV1['networkInterfaces'] = networkInterfaces()): string | undefined {
  for (const rows of Object.values(interfaces)) {
    for (const row of rows ?? []) {
      const family = typeof row.family === 'number' ? row.family === 4 : row.family === 'IPv4'
      if (family && row.internal !== true && privateIPv4(row.address)) return row.address
    }
  }
  return undefined
}

function cookieValue(request: IncomingMessage): string | undefined {
  const raw = request.headers.cookie
  if (typeof raw !== 'string') return undefined
  for (const part of raw.split(';')) {
    const [name, ...rest] = part.trim().split('=')
    if (name === SHARE_COOKIE) return rest.join('=') || undefined
  }
  return undefined
}

function normalizeRemoteAddress(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  const normalized = value.replace(/^::ffff:/iu, '')
  return normalized === '::1' ? '127.0.0.1' : normalized
}

function deviceFromUserAgent(value: string | undefined): string | undefined {
  if (value === undefined || value.trim() === '') return undefined
  const browser = /edg\//iu.test(value) ? 'Edge'
    : /chrome\//iu.test(value) ? 'Chrome'
      : /firefox\//iu.test(value) ? 'Firefox'
        : /safari\//iu.test(value) ? 'Safari' : 'Browser'
  const os = /windows/iu.test(value) ? 'Windows'
    : /mac os/iu.test(value) ? 'macOS'
      : /android/iu.test(value) ? 'Android'
        : /iphone|ipad/iu.test(value) ? 'iOS'
          : /linux/iu.test(value) ? 'Linux' : 'Unknown OS'
  return `${browser} / ${os}`
}

function validNickname(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length >= 1 && value.trim().length <= 32
    && !/[\u0000-\u001f\u007f]/u.test(value)
}

function cleanHeaders(headers: IncomingMessage['headers'], upstream: URL, cookie: string): Record<string, string | undefined> {
  const output: Record<string, string | undefined> = {}
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined || ['host', 'origin', 'cookie', 'connection', 'content-length'].includes(name)) continue
    output[name] = Array.isArray(value) ? value.join(', ') : value
  }
  output.host = upstream.host
  output.origin = upstream.origin
  output.cookie = cookie
  return output
}

function writeSecurityHeaders(response: ServerResponse, extra: Record<string, string> = {}): void {
  response.setHeader('cache-control', 'no-store')
  response.setHeader('referrer-policy', 'no-referrer')
  for (const [name, value] of Object.entries(extra)) response.setHeader(name, value)
}

async function readResponseBody(response: IncomingMessage, limit = MAX_PROXY_BODY): Promise<Buffer> {
  const chunks: Buffer[] = []; let size = 0
  for await (const chunk of response) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += bytes.byteLength
    if (size > limit) throw new Error('workbench-share-upstream-response-too-large')
    chunks.push(bytes)
  }
  return Buffer.concat(chunks, size)
}

function requestUpstream(upstream: URL, request: IncomingMessage, cookie: string, body?: Buffer): Promise<{ response: IncomingMessage; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const target = httpRequest({ hostname: upstream.hostname, port: upstream.port, path: `${upstream.pathname}${upstream.search}`, method: request.method, headers: cleanHeaders(request.headers, upstream, cookie) }, response => {
      void readResponseBody(response).then(bytes => resolve({ response, body: bytes }), reject)
    })
    target.once('error', reject)
    if (body !== undefined) target.end(body)
    else request.pipe(target)
  })
}

function responseHeaders(response: IncomingMessage, upstream: URL, gatewayOrigin: string): Record<string, string | string[]> {
  const output: Record<string, string | string[]> = {}
  for (const [name, value] of Object.entries(response.headers)) {
    if (value === undefined || name === 'set-cookie' || name === 'connection' || name === 'transfer-encoding') continue
    if (name === 'location' && typeof value === 'string') {
      try {
        const location = new URL(value, upstream)
        if (location.origin === upstream.origin) {
          // DSH auth and native browser-view redirects can carry credentials
          // or one-time tickets in the query. They are Host-only state and
          // must never become a guest-visible URL.
          location.searchParams.delete('token')
          location.searchParams.delete('workbench')
          output[name] = `${gatewayOrigin}${location.pathname}${location.search}${location.hash}`
        } else output[name] = value
      } catch { output[name] = value }
    } else output[name] = value
  }
  return output
}

function injectView(html: string, view: NativeViewV1, collaboration?: { readonly collaborationId: string; readonly participantId: string }): string {
  const marker = `<script>globalThis.__WORKBENCH_WINDOW_VIEW__=${JSON.stringify(view)};</script>`
    + (collaboration === undefined ? '' : `<script>globalThis.__WORKBENCH_COLLABORATION__=${JSON.stringify(collaboration)};</script>`)
    + '<script>history.replaceState(null,"","/workbench");</script>'
  return html.replace(/<\/head>/iu, `${marker}</head>`)
}

function leaseNativeView(lease: WorkbenchShareViewLeaseV1): NativeViewV1 | undefined {
  return lease.nativeView === undefined ? undefined : {
    schemaVersion: 1, windowId: lease.nativeView.windowId, workbenchId: lease.workbenchId,
    mode: 'browser-workbench', closeToken: lease.nativeView.closeToken,
  }
}
/**
 * A small reverse proxy bound to one private IPv4. The proxy is intentionally
 * dumb about Workbench state: it only authenticates the bearer link, leases a
 * native view, and forwards the existing DSH document/API/WebSocket carriers.
 */
export async function createWorkbenchShareGateway(options: WorkbenchShareGatewayOptionsV1): Promise<WorkbenchShareGatewayV1> {
  const host = selectPrivateIPv4(options.networkInterfaces)
  if (host === undefined) throw new Error('workbench-share-no-private-ipv4')
  const upstream = new URL(options.upstreamOrigin)
  if (upstream.protocol !== 'http:' || !loopbackHost(upstream.hostname)) throw new Error('workbench-share-upstream-must-be-loopback')
  const server = createServer((request, response) => { void handleHttp(request, response).catch(() => { if (!response.headersSent) { writeSecurityHeaders(response); response.writeHead(502); response.end('upstream unavailable') } else response.destroy() }) })
  const collaborationWss = new WebSocketServer({ noServer: true })
  const gateway = await new Promise<{ port: number }>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, host, () => { server.off('error', reject); const address = server.address(); if (address === null || typeof address === 'string') { reject(new Error('workbench-share-bind-failed')); return } resolve({ port: address.port }) })
  })
  const sessions = options.manager
  const guestSockets = new Map<string, Set<Duplex>>()
  const collaborationSockets = new Map<string, Set<WebSocket>>()
  const metrics = new Map<string, {
    httpRequests: number
    httpErrors: number
    httpInFlight: number
    queueDepth: number
    websocketConnections: number
    websocketReconnects: number
    lastErrorAt?: number
  }>()
  const metricsFor = (workbenchId: string) => {
    let value = metrics.get(workbenchId)
    if (value === undefined) {
      value = { httpRequests: 0, httpErrors: 0, httpInFlight: 0, queueDepth: 0, websocketConnections: 0, websocketReconnects: 0 }
      metrics.set(workbenchId, value)
    }
    return value
  }
  const recordRequestError = (workbenchId: string): void => {
    const value = metricsFor(workbenchId)
    value.httpErrors += 1
    value.lastErrorAt = Date.now()
  }
  let proxyInFlight = 0
  let gatewayClosed = false
  const proxyQueue: { readonly workbenchId: string; readonly resolve: (accepted: boolean) => void }[] = []
  const queueDepthFor = (workbenchId: string): number => proxyQueue.reduce((count, item) => count + (item.workbenchId === workbenchId ? 1 : 0), 0)
  const acquireProxySlot = (workbenchId: string): Promise<boolean> => {
    if (gatewayClosed) return Promise.resolve(false)
    if (proxyInFlight < MAX_PROXY_IN_FLIGHT) {
      proxyInFlight += 1
      return Promise.resolve(true)
    }
    if (proxyQueue.length >= MAX_PROXY_QUEUE) return Promise.resolve(false)
    return new Promise(resolve => { proxyQueue.push({ workbenchId, resolve }) })
  }
  const releaseProxySlot = (): void => {
    proxyInFlight = Math.max(0, proxyInFlight - 1)
    const next = proxyQueue.shift()
    if (next === undefined) return
    proxyInFlight += 1
    next.resolve(true)
  }
  const leaseInitializations = new Map<string, Promise<{ lease: WorkbenchShareViewLeaseV1; view: NativeViewV1; ownerCookie: string; documentHtml: string } | { error: string }>>()

  async function beginLease(session: WorkbenchShareSessionV1, existing?: WorkbenchShareViewLeaseV1): Promise<{ lease: WorkbenchShareViewLeaseV1; view: NativeViewV1; ownerCookie: string; documentHtml: string } | { error: string }> {
    const ownsLease = existing === undefined
    const created = existing === undefined ? sessions.createLease(session) : { lease: existing, cookie: undefined }
    if ('error' in created) return created
    try {
      const prepared = await options.prepareView(session.workbenchId)
      const preparedUrl = new URL(prepared.url)
      const document = await requestUpstream(preparedUrl, { method: 'GET', headers: {} } as IncomingMessage, '', Buffer.alloc(0))
      const setCookie = document.response.headers['set-cookie']
      const ownerCookie = Array.isArray(setCookie) ? setCookie.map(value => value.split(';', 1)[0]).join('; ') : ''
      if (ownerCookie === '') throw new Error('workbench-share-upstream-auth-cookie-missing')
      const ticket = preparedUrl.searchParams.get('workbench')
      if (ticket === null) throw new Error('workbench-share-native-ticket-missing')
      const redeemed = await options.redeemView(ticket)
      if (redeemed.schemaVersion !== 1 || typeof redeemed.windowId !== 'string'
        || typeof redeemed.workbenchId !== 'string' || redeemed.mode !== 'browser-workbench'
        || typeof redeemed.closeToken !== 'string') throw new Error('workbench-share-native-redeem-failed')
      if (!session.leases.has(created.lease.leaseId)) {
        await options.closeView(redeemed.closeToken).catch(() => {})
        throw new Error('workbench-share-session-stopped')
      }
      created.lease.nativeView = { windowId: redeemed.windowId, closeToken: redeemed.closeToken }
      if (options.access) {
        const collaborationId = options.collaboration?.get(session.workbenchId)?.snapshot().collaborationId
        const token = options.access.registerGuest(created.lease.leaseId, session.workbenchId, session.grant, () => session.leases.has(created.lease.leaseId) && sessions.getSession(session.workbenchId) === session,
          { ...(collaborationId === undefined ? {} : { collaborationId }), displayName: created.lease.nickname })
        created.lease.accessToken = token
        await options.closeView(redeemed.closeToken)
        created.lease.nativeView = { windowId: randomUUID(), closeToken: token }
      }
      created.lease.ownerCookie = ownerCookie
      return { lease: created.lease, view: leaseNativeView(created.lease)!, ownerCookie, documentHtml: document.body.toString('utf8') }
    } catch (error) {
      if (ownsLease) sessions.removeLease(created.lease)
      throw error
    }
  }

  async function handleHttp(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (request.method !== 'GET' && request.method !== 'HEAD' && request.method !== 'POST') { writeSecurityHeaders(response); response.writeHead(405); response.end(); return }
    const url = new URL(request.url ?? '/', `http://${host}:${String(gateway.port)}`)
    if (request.headers.host !== url.host || request.headers.origin !== undefined && request.headers.origin !== url.origin) { writeSecurityHeaders(response); response.writeHead(403); response.end('workbench origin denied'); return }
    if (url.pathname === '/workbench' && url.searchParams.has('share')) {
      if (request.method !== 'GET' || url.searchParams.getAll('share').length !== 1 || [...url.searchParams.keys()].some(key => key !== 'share')) { writeSecurityHeaders(response); response.writeHead(400); response.end(); return }
      const session = sessions.findByToken(url.searchParams.get('share')!)
      if (session === undefined) { writeSecurityHeaders(response); response.writeHead(410); response.end('share link expired'); return }
      const remoteAddress = normalizeRemoteAddress(request.socket.remoteAddress)
      const device = deviceFromUserAgent(request.headers['user-agent'] as string | undefined)
      const lease = sessions.createLease(session, {
        ...(remoteAddress === undefined ? {} : { ip: remoteAddress }),
        ...(device === undefined ? {} : { userAgent: device }),
      })
      if ('error' in lease) { writeSecurityHeaders(response); response.writeHead(429); response.end(lease.error); return }
      const cookie = lease.cookie
      writeSecurityHeaders(response, { location: '/workbench', 'set-cookie': `${SHARE_COOKIE}=${cookie}; Path=/; HttpOnly; SameSite=Strict` })
      response.writeHead(303); response.end(); return
    }
    const rawCookie = cookieValue(request)
    const found = rawCookie === undefined ? undefined : sessions.findLease(rawCookie)
    if (found === undefined) { writeSecurityHeaders(response); response.writeHead(401); response.end('workbench share authorization required'); return }
    const { session, lease } = found
    if (!await acquireProxySlot(session.workbenchId)) {
      recordRequestError(session.workbenchId)
      writeSecurityHeaders(response, { 'retry-after': '1', 'x-dsh-share-state': 'overloaded' })
      response.writeHead(503)
      response.end('workbench share gateway is busy')
      return
    }
    const sessionMetrics = metricsFor(session.workbenchId)
    sessionMetrics.httpRequests += 1
    sessionMetrics.httpInFlight += 1
    const remoteAddress = normalizeRemoteAddress(request.socket.remoteAddress)
    const device = deviceFromUserAgent(request.headers['user-agent'] as string | undefined)
    sessions.updateGuest(lease, {
      ...(remoteAddress === undefined ? {} : { ip: remoteAddress }),
      ...(device === undefined ? {} : { device }),
      lastSeenAt: Date.now(),
    })
    let requestFinished = false
    const finishRequest = () => {
      if (requestFinished) return
      requestFinished = true
      sessionMetrics.httpInFlight = Math.max(0, sessionMetrics.httpInFlight - 1)
      releaseProxySlot()
    }
    response.once('finish', finishRequest)
    response.once('close', finishRequest)
    const ownerCookie = lease.ownerCookie
    // All Workbench fetch routes get a Host-owned credential, never an incoming role/header.
    delete request.headers[WORKBENCH_ACCESS_HEADER]
    if (lease.accessToken) request.headers[WORKBENCH_ACCESS_HEADER] = lease.accessToken
    if (url.pathname.startsWith('/api/workbench-window/') && request.method === 'POST') {
      try {
        const envelope = JSON.parse((await readResponseBody(request, 16 * 1024)).toString('utf8'))
        const action = url.pathname.slice('/api/workbench-window/'.length)
        if (!['status', 'ready', 'heartbeat', 'metrics'].includes(action) || envelope.payload?.windowId !== lease.nativeView?.windowId) throw new Error('guest-view-denied')
        writeSecurityHeaders(response, { 'content-type': 'application/json' }); response.writeHead(200)
        response.end(JSON.stringify({ type: 'server-response', rpcId: envelope.rpcId, result: { ok: true, value: { status: 'ready' } } })); return
      } catch { writeSecurityHeaders(response); response.writeHead(403); response.end('guest view denied'); return }
    }
    if (url.pathname === '/workbench' && (url.search === '' || url.search === '?')) {
      let native = leaseNativeView(lease)
      let documentHtml: string | undefined
      if (native === undefined || ownerCookie === undefined) {
        let initialization = leaseInitializations.get(lease.leaseId)
        if (initialization === undefined) {
          initialization = beginLease(session, lease)
          leaseInitializations.set(lease.leaseId, initialization)
          void initialization.then(() => leaseInitializations.delete(lease.leaseId), () => leaseInitializations.delete(lease.leaseId))
        }
        const prepared = await initialization
        if ('error' in prepared) { writeSecurityHeaders(response); response.writeHead(429); response.end(prepared.error); return }
        native = prepared.view
        documentHtml = prepared.documentHtml
      }
      if (documentHtml === undefined) {
        const upstreamResponse = await requestUpstream(new URL('/workbench', upstream), request, ownerCookie ?? '')
        documentHtml = upstreamResponse.body.toString('utf8')
      }
      const collaborationId = options.collaboration?.get(lease.workbenchId)?.snapshot().collaborationId
      const html = injectView(documentHtml, native!, collaborationId === undefined ? undefined : { collaborationId, participantId: lease.leaseId })
      writeSecurityHeaders(response, { 'content-type': 'text/html; charset=utf-8', 'content-length': String(Buffer.byteLength(html)) })
      response.writeHead(200); response.end(request.method === 'HEAD' ? undefined : html); finishRequest(); return
    }
    if (url.pathname === '/api/workbench-window-close' && request.method === 'POST') {
      const body = await readResponseBody(request, 64 * 1024)
      try {
        const parsed = JSON.parse(body.toString('utf8')) as { closeToken?: unknown }
        if (typeof parsed.closeToken === 'string' && lease.nativeView?.closeToken === parsed.closeToken) {
          // A guest reload is independent of the owner-control lease.
          sessions.updateGuest(lease, { lastSeenAt: Date.now() })
        }
      } catch { /* malformed beacon is treated like a closed view */ }
      writeSecurityHeaders(response); response.writeHead(204); response.end(); finishRequest(); return
    }
    if (url.pathname.startsWith('/api/workbench-share/')) {
      writeSecurityHeaders(response); response.writeHead(403); response.end('share management is host-only'); return
    }
    // Shared browsers hold a proxy-owned owner cookie. Never forward package
    // authority through that cookie; these actions have no Remote/mux exports.
    if (guestDistributionDenied(url.pathname)) {
      writeSecurityHeaders(response); response.writeHead(403); response.end('package distribution is host-only'); finishRequest(); return
    }
    const scopedWorkbenchRoute = ['/api/workbench/directory/v1', '/api/workbench/bay-agent', '/api/workbench/bay-agent/draft'].includes(url.pathname)
    if (url.pathname.startsWith('/api/') && !scopedWorkbenchRoute) {
      if (!options.access || !options.guestHttp || !lease.accessToken) { writeSecurityHeaders(response); response.writeHead(403); response.end('guest capability unavailable'); return }
      const headers = new Headers()
      for (const [key, value] of Object.entries(request.headers)) if (value !== undefined && !['cookie', 'host', 'authorization', WORKBENCH_ACCESS_HEADER].includes(key)) headers.set(key, Array.isArray(value) ? value.join(', ') : value)
      const body = request.method === 'GET' || request.method === 'HEAD' ? undefined : Readable.toWeb(request) as ReadableStream<Uint8Array>
      const native = await options.guestHttp(new Request(new URL(request.url ?? '/', upstream), { method: request.method ?? 'GET', headers, ...(body ? { body, duplex: 'half' } : {}) } as RequestInit), options.access.getContext(lease.leaseId))
      native.headers.forEach((value, key) => { if (!['set-cookie', 'connection', 'transfer-encoding'].includes(key)) response.setHeader(key, value) })
      writeSecurityHeaders(response); response.writeHead(native.status)
      if (native.body) for await (const chunk of native.body) { if (!response.write(chunk)) await once(response, 'drain') }
      response.end(); return
    }
    if (scopedWorkbenchRoute && (!lease.accessToken || request.method !== 'POST')) { response.writeHead(403); response.end('workbench access required'); return }
    if (!scopedWorkbenchRoute && (!['GET', 'HEAD'].includes(request.method ?? '') || !/^\/(?:plugins\/|assets\/|favicon\.)/u.test(url.pathname))) { response.writeHead(403); response.end('guest route denied'); return }
    const upstreamUrl = new URL(`${url.pathname}${url.search}`, upstream)
    const result = await requestUpstream(upstreamUrl, request, ownerCookie ?? '')
    const headers = responseHeaders(result.response, upstream, `http://${host}:${String(gateway.port)}`)
    for (const [name, value] of Object.entries(headers)) response.setHeader(name, value)
    writeSecurityHeaders(response)
    response.writeHead(result.response.statusCode ?? 502)
    response.end(result.body)
    finishRequest()
  }

  const sendCollaboration = (socket: WebSocket, type: string, payload: unknown): void => {
    if (socket.readyState !== 1) return
    socket.send(JSON.stringify({ type, payload }))
  }

  const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

  const handleCollaborationSocket = (socket: WebSocket, found: { readonly lease: WorkbenchShareViewLeaseV1; readonly session: WorkbenchShareSessionV1 }): void => {
    const collaboration = options.collaboration?.get(found.session.workbenchId)
    if (collaboration === undefined) { sendCollaboration(socket, 'server.collaboration-ended', { reason: 'collaboration-unavailable' }); socket.close(1008); return }
    let connected = false
    let disposed = false
    const sockets = collaborationSockets.get(found.lease.leaseId) ?? new Set<WebSocket>()
    sockets.add(socket)
    collaborationSockets.set(found.lease.leaseId, sockets)
    const unsubscribe = collaboration.subscribe(event => sendCollaboration(socket, 'server.event', event))
    socket.on('message', data => {
      let message: unknown
      try { message = JSON.parse(data.toString()) } catch { sendCollaboration(socket, 'server.command-result', { ok: false, requestId: '', code: 'invalid-operation', message: 'invalid collaboration message', workbenchRevision: collaboration.snapshot().workbenchRevision, canvasRevision: collaboration.snapshot().canvasRevision }); return }
      if (!isRecord(message) || typeof message.type !== 'string' || !isRecord(message.payload)) return
      // A share stop, kick, or grant revocation removes the lease while an
      // already-upgraded WebSocket can still be physically open. Recheck the
      // lease before every collaboration message so that socket cannot keep
      // issuing commands after access has ended.
      if (!found.session.leases.has(found.lease.leaseId)) {
        sendCollaboration(socket, 'server.collaboration-ended', { reason: 'share-access-revoked' })
        socket.close(1008)
        return
      }
      if (message.type === 'client.hello') {
        const payload = message.payload
        if (payload.collaborationId !== collaboration.snapshot().collaborationId || payload.workbenchId !== found.session.workbenchId || payload.participantId !== found.lease.leaseId) {
          sendCollaboration(socket, 'server.collaboration-ended', { reason: 'collaboration-scope-denied' }); socket.close(1008); return
        }
        const joined = collaboration.connect({
          collaborationId: collaboration.snapshot().collaborationId,
          workbenchId: found.session.workbenchId,
          participantId: found.lease.leaseId,
          displayName: found.lease.nickname,
          role: 'participant',
          ...(typeof payload.lastEventId === 'string' ? { lastEventId: payload.lastEventId } : {}),
          ...(typeof payload.lastWorkbenchRevision === 'number' ? { lastWorkbenchRevision: payload.lastWorkbenchRevision } : {}),
          ...(typeof payload.lastCanvasRevision === 'number' ? { lastCanvasRevision: payload.lastCanvasRevision } : {}),
        })
        if ('error' in joined) { sendCollaboration(socket, 'server.collaboration-ended', joined); socket.close(1008); return }
        connected = true
        sendCollaboration(socket, 'server.snapshot', joined)
        if (typeof payload.lastEventId === 'string') {
          const replay = collaboration.eventsSince(payload.lastEventId)
          if (replay !== undefined) for (const event of replay) sendCollaboration(socket, 'server.event', event)
          else sendCollaboration(socket, 'server.resync-required', collaboration.snapshot())
        }
        return
      }
      if (!connected) { sendCollaboration(socket, 'server.collaboration-ended', { reason: 'collaboration-handshake-required' }); socket.close(1008); return }
      if (message.type === 'client.command') {
        const input = message.payload as unknown as WorkbenchCommandEnvelopeV1
        void collaboration.command({ ...input, collaborationId: collaboration.snapshot().collaborationId, workbenchId: found.session.workbenchId, participantId: found.lease.leaseId }).then(result => sendCollaboration(socket, 'server.command-result', result))
        return
      }
      if (message.type === 'client.presence') {
        const input = message.payload as unknown as ParticipantPresenceV1
        collaboration.publishPresence({ ...input, participantId: found.lease.leaseId, displayName: found.lease.nickname, role: 'participant', connectionState: 'connected', updatedAt: Date.now() })
        return
      }
      if (message.type === 'client.resync') sendCollaboration(socket, 'server.snapshot', collaboration.snapshot())
    })
    // Keep the collaboration carrier alive independently from the legacy
    // remote.mux heartbeat. A stale lease is closed before it can submit a
    // command, even if the browser keeps the TCP connection half-open.
    const heartbeat = setInterval(() => {
      if (disposed) return
      if (!found.session.leases.has(found.lease.leaseId)) {
        sendCollaboration(socket, 'server.collaboration-ended', { reason: 'share-access-revoked' })
        socket.close(1008, 'Share access revoked')
        return
      }
      if (socket.readyState === 1) socket.ping()
    }, 15_000)
    heartbeat.unref?.()
    const dispose = () => {
      if (disposed) return
      disposed = true
      clearInterval(heartbeat)
      unsubscribe()
      sockets.delete(socket)
      if (sockets.size === 0) collaborationSockets.delete(found.lease.leaseId)
      if (connected) collaboration.disconnect(found.lease.leaseId)
    }
    socket.once('close', dispose)
    socket.once('error', dispose)
  }

  server.on('upgrade', (request, clientSocket, head) => {
    const requestUrl = new URL(request.url ?? '/', `http://${host}:${String(gateway.port)}`)
    if (request.headers.host !== requestUrl.host || request.headers.origin !== undefined && request.headers.origin !== requestUrl.origin) { clientSocket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return }
    const rawCookie = cookieValue(request)
    const found = rawCookie === undefined ? undefined : sessions.findLease(rawCookie)
    if (requestUrl.pathname === '/api/workbench-collaboration' && request.headers.upgrade?.toLowerCase() === 'websocket') {
      if (found === undefined || options.collaboration === undefined) { clientSocket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n'); return }
      collaborationWss.handleUpgrade(request, clientSocket, head, socket => handleCollaborationSocket(socket, found))
      return
    }
    if (requestUrl.pathname !== '/api/remote.mux' || request.headers.upgrade?.toLowerCase() !== 'websocket') {
      clientSocket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n')
      return
    }
    if (found === undefined) { clientSocket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n'); return }
    const socketMetrics = metricsFor(found.session.workbenchId)
    const wasConnected = found.lease.websocketState === 'connected'
    if (!wasConnected) {
      if (found.lease.websocketReconnects > 0 || found.lease.lastSeenAt > found.lease.createdAt) socketMetrics.websocketReconnects += 1
      sessions.updateGuest(found.lease, { websocketReconnects: found.lease.websocketReconnects + (found.lease.lastSeenAt > found.lease.createdAt ? 1 : 0), websocketState: 'connected', lastSeenAt: Date.now() })
    }
    socketMetrics.websocketConnections += 1
    const sockets = guestSockets.get(found.lease.leaseId) ?? new Set<Duplex>()
    sockets.add(clientSocket)
    guestSockets.set(found.lease.leaseId, sockets)
    if (options.access && options.guestUpgrade) {
      try {
        options.guestUpgrade(request, clientSocket, head, options.access.getContext(found.lease.leaseId))
        clientSocket.once('close', () => { sockets.delete(clientSocket); socketMetrics.websocketConnections = Math.max(0, socketMetrics.websocketConnections - 1); sessions.updateGuest(found.lease, { websocketState: 'disconnected' }) })
      } catch { clientSocket.destroy() }
      return
    }
    clientSocket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n')
    return

  })

  const shareUrls = new Map<string, string>()
  let closePromise: Promise<void> | undefined
  const stopShare = async (workbenchId: string): Promise<void> => {
    const session = sessions.getSession(workbenchId)
    if (session === undefined) return
    for (const lease of session.leases.values()) {
      options.access?.revoke(lease.leaseId); options.revokeGuest?.(lease.leaseId)
      for (const socket of guestSockets.get(lease.leaseId) ?? []) socket.destroy()
      guestSockets.delete(lease.leaseId)
      for (const socket of collaborationSockets.get(lease.leaseId) ?? []) {
        sendCollaboration(socket, 'server.collaboration-ended', { reason: 'share-stopped' })
        socket.close(1000, 'Collaboration ended')
      }
      collaborationSockets.delete(lease.leaseId)
      if (lease.nativeView !== undefined) await options.closeView(lease.nativeView.closeToken).catch(() => {})
    }
    sessions.stop(workbenchId)
    await options.collaboration?.stop(workbenchId)
    shareUrls.delete(workbenchId)
    metrics.delete(workbenchId)
  }
  return {
    host, port: gateway.port, origin: `http://${host}:${String(gateway.port)}`,
    async startShare(workbenchId, grant = SHARED_CONTROL_GRANT) {
      const existing = sessions.getSession(workbenchId)
      if (existing !== undefined) {
        const current = shareUrls.get(workbenchId)
        if (current !== undefined) return { status: 'already-active', url: current }
      }
      const started = sessions.start(workbenchId, host, gateway.port, '', grant)
      if (!started.ok || started.token === undefined) throw new Error(started.error ?? 'workbench-share-start-failed')
      if (options.collaboration !== undefined) await options.collaboration.start(workbenchId, 'owner')
      const url = `http://${host}:${String(gateway.port)}/workbench?share=${encodeURIComponent(started.token)}`
      shareUrls.set(workbenchId, url)
      return { status: 'started', url }
    },
    stopShare,
    reduceShare(workbenchId, grant) {
      const session = sessions.reduce(workbenchId, grant)
      for (const lease of session.leases.values()) {
        if (lease.accessToken) options.access?.reduceGuest(lease.leaseId, session.grant)
        for (const socket of guestSockets.get(lease.leaseId) ?? []) socket.destroy()
        for (const socket of collaborationSockets.get(lease.leaseId) ?? []) {
          sendCollaboration(socket, 'server.collaboration-ended', { reason: 'share-access-revoked' })
          socket.close(1008, 'Workbench access changed')
        }
      }
    },
    async kickGuest(workbenchId, leaseId) {
      const session = sessions.getSession(workbenchId)
      const lease = sessions.revokeLease(workbenchId, leaseId, 'kicked')
      if (session === undefined || lease === undefined) return false
      options.access?.revoke(lease.leaseId); options.revokeGuest?.(lease.leaseId)
      options.collaboration?.get(workbenchId)?.disconnect(lease.leaseId)
      for (const socket of guestSockets.get(lease.leaseId) ?? []) socket.destroy()
      guestSockets.delete(lease.leaseId)
      for (const socket of collaborationSockets.get(lease.leaseId) ?? []) {
        sendCollaboration(socket, 'server.collaboration-ended', { reason: 'participant-kicked' })
        socket.close(1008, 'Participant kicked')
      }
      collaborationSockets.delete(lease.leaseId)
      if (lease.nativeView !== undefined) await options.closeView(lease.nativeView.closeToken).catch(() => {})
      return true
    },
    getMetrics(workbenchId) {
      const value = metrics.get(workbenchId)
      return {
        httpRequests: value?.httpRequests ?? 0,
        httpErrors: value?.httpErrors ?? 0,
        httpInFlight: value?.httpInFlight ?? 0,
        queueDepth: queueDepthFor(workbenchId),
        websocketConnections: value?.websocketConnections ?? 0,
        websocketReconnects: value?.websocketReconnects ?? 0,
        ...(value?.lastErrorAt === undefined ? {} : { lastErrorAt: value.lastErrorAt }),
      }
    },
    close() {
      if (closePromise !== undefined) return closePromise
      closePromise = (async () => {
        gatewayClosed = true
        while (proxyQueue.length > 0) proxyQueue.shift()!.resolve(false)
        for (const session of sessions.getSnapshot()) await stopShare(session.workbenchId)
        await options.collaboration?.dispose()
        collaborationWss.close()
        sessions.dispose(); metrics.clear()
        await new Promise<void>(resolve => server.close(() => resolve()))
      })()
      return closePromise
    },
  }
}
