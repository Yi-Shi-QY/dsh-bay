import { createHash, randomBytes } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { once } from 'node:events'
import { Readable, type Duplex } from 'node:stream'
import type { ConnectionRpcHandlerResult } from '@deepseek-ai/dsh-client-connection'
import type { HostWorkbenchAccess } from './host-workbench-access.ts'
import { WorkbenchAccessError } from './host-workbench-access.ts'
import type { WorkbenchAccessContext } from './workbench-access-contract.ts'
import { WORKBENCH_ACCESS_HEADER } from './workbench-access-contract.ts'
import type { createGuestNativeTransport } from './host-workbench-native-access.ts'
import type { WorkbenchCollaborationManagerV1, WorkbenchCollaborationSessionViewV1 } from './host-workbench-collaboration.ts'
import type { ParticipantPresenceV1, WorkbenchCommandEnvelopeV1 } from './workbench-collaboration-contract.ts'
import { WebSocketServer, type WebSocket } from 'ws'

interface PreparedOwnerView { windowId: string; workbenchId: string; url: string; expiresAt: number }
interface OwnerView { schemaVersion: 1; windowId: string; workbenchId: string; mode: 'browser-workbench'; closeToken: string }
export interface WorkbenchOwnerGatewayOptions {
  access: HostWorkbenchAccess
  native: NonNullable<ReturnType<typeof createGuestNativeTransport>>
  upstreamOrigin: string
  handleView(action: string, payload: unknown): Promise<ConnectionRpcHandlerResult>
  handleShare?(action: string, payload: unknown, context: WorkbenchAccessContext): Promise<ConnectionRpcHandlerResult>
  collaboration?: WorkbenchCollaborationManagerV1
}
const WORKBENCH_ROUTES = new Set([
  '/api/workbench/directory/v1', '/api/workbench/bay-agent', '/api/workbench/bay-agent/draft', '/api/workbench/access/v1',
  '/api/workbench/complete/v5', '/api/workbench/complete/v5/upload', '/api/workbench/complete/v5/download',
])
const VIEW_ACTIONS = new Set(['opened', 'ready', 'failed', 'status', 'heartbeat', 'watch-reclaim', 'reclaim-progress', 'metrics', 'attach', 'suspend', 'reclaim', 'reclaimed', 'floating-read', 'floating-stage'])
const SHARE_ACTIONS = new Set(['start', 'stop', 'status', 'guest-rename', 'guest-kick', 'reduce'])
const BOOT_READS = new Set(['/api/session/list', '/api/session/search', '/api/session/modelCatalog', '/api/session/page', '/api/session/projections', '/api/session/state', '/api/session/attachment', '/api/agentPresets/list'])
const BOOT_STREAMS = new Set(['$events', 'remoteAccess/follow', 'session/control', 'session/follow', 'session/observeEvent', 'session/observeState', 'session/observeProjections', 'workspace/follow'])
const PAGE_HEADER = 'x-bay-page'
const obj = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const digest = (value: string) => createHash('sha256').update(value).digest('hex')
const scriptJson = (value: unknown) => JSON.stringify(value).replace(/</gu, '\\u003c')
const loopback = (host: string) => host === 'localhost' || host === '[::1]' || /^127\.(?:\d{1,3}\.){2}\d{1,3}$/u.test(host)

async function boundedBody(body: AsyncIterable<Uint8Array>, limit = 16 * 1024 * 1024) {
  const chunks: Buffer[] = []; let size = 0
  for await (const chunk of body) {
    size += chunk.byteLength
    if (size > limit) throw new Error('请求内容超过允许大小。')
    chunks.push(Buffer.from(chunk))
  }
  return Buffer.concat(chunks, size)
}
function headers(response: ServerResponse) {
  response.setHeader('cache-control', 'no-store')
  response.setHeader('referrer-policy', 'no-referrer')
  response.setHeader('x-content-type-options', 'nosniff')
  response.setHeader('x-frame-options', 'DENY')
}
function reject(response: ServerResponse, status: number, message: string) {
  headers(response); response.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' }); response.end(message)
}
function rpc(response: ServerResponse, rpcId: unknown, result: ConnectionRpcHandlerResult) {
  headers(response); response.writeHead(200, { 'content-type': 'application/json' })
  response.end(JSON.stringify({ type: 'server-response', rpcId, result }))
}
async function sendResponse(response: ServerResponse, upstream: Response, head: boolean) {
  upstream.headers.forEach((value, key) => {
    if (!['set-cookie', 'connection', 'transfer-encoding', 'content-encoding', 'content-length', 'location', 'access-control-allow-origin', 'access-control-allow-credentials'].includes(key)) response.setHeader(key, value)
  })
  headers(response); response.writeHead(upstream.status)
  if (!head && upstream.body) for await (const chunk of upstream.body) {
    if (response.destroyed) break
    if (!response.write(chunk)) await once(response, 'drain')
  }
  else await upstream.body?.cancel()
  response.end()
}

/**
 * Each browser lease receives its own loopback origin. Only its HttpOnly local
 * cookie reaches the browser; the upstream owner credential never leaves Host.
 * Native HTTP and mux both terminate as the same non-owner scoped Peer.
 */
export async function createWorkbenchOwnerGateway(options: WorkbenchOwnerGatewayOptions) {
  const upstream = new URL(options.upstreamOrigin)
  if (!['http:', 'https:'].includes(upstream.protocol) || !loopback(upstream.hostname) || upstream.username || upstream.password) throw new Error('浏览器工作台仅支持本机 Host。')
  const entries = new Map<string, { url: string; close(): Promise<void> }>()
  const preparing = new Map<string, Promise<{ url: string }>>()
  let disposed = false

  const prepare = async (input: PreparedOwnerView): Promise<{ url: string }> => {
    if (disposed) throw new Error('浏览器工作台服务已关闭。')
    const existing = entries.get(input.windowId)
    if (existing) return { url: existing.url }
    const inflight = preparing.get(input.windowId)
    if (inflight) return inflight
    const pending = (async () => {
      const original = new URL(input.url)
      const nativeTicket = original.searchParams.get('workbench')
      if (original.origin !== upstream.origin || original.pathname !== '/workbench' || !nativeTicket) throw new Error('无效的原生浏览器工作台地址。')
      const ticket = randomBytes(32).toString('base64url'), cookie = randomBytes(32).toString('base64url')
      const cookieName = 'bay-owner-' + randomBytes(8).toString('hex'), cookieHash = digest(cookie)
      const sockets = new Map<Duplex, string>()
      const collaborationWss = new WebSocketServer({ noServer: true })
      const pageProofs = new Set<string>()
      let activeProof: string | undefined, activePageId: string | undefined
      let view: OwnerView | undefined, ownerCookie = '', ticketAvailable = true, documentHtml: string | undefined
      let origin = '', closed = false, initializing: Promise<void> | undefined
      const server = createServer((request, response) => { void handle(request, response).catch(error => {
        if (!response.headersSent) reject(response, error instanceof WorkbenchAccessError ? error.status : 503,
          error instanceof WorkbenchAccessError ? error.message : '浏览器工作台连接失败，请在 DSH 中查看状态后重试。')
        else response.destroy()
      }) })
      const trusted = (request: IncomingMessage) => request.headers.host === new URL(origin).host
        && (request.headers.origin === undefined || request.headers.origin === origin)
      const authenticated = (request: IncomingMessage) => request.headers.cookie?.split(';').some(part => {
        const at = part.indexOf('='); return at > 0 && part.slice(0, at).trim() === cookieName && digest(part.slice(at + 1)) === cookieHash
      }) === true
      const actor = () => {
        if (!view) throw new Error('工作台尚未兑换。')
        const value = options.access.getContext(view.windowId)
        if (value.actor !== 'browser-owner' || value.workbenchId !== input.workbenchId) throw new Error('工作台控制身份已变化。')
        options.access.authorize(value, 'view', { workbenchId: input.workbenchId })
        return value
      }
      const sendCollaboration = (socket: WebSocket, type: string, payload: unknown): void => {
        if (socket.readyState === 1) socket.send(JSON.stringify({ type, payload }))
      }
      const handleCollaboration = async (socket: WebSocket, collaboration: WorkbenchCollaborationSessionViewV1): Promise<void> => {
        let connected = false
        let disposed = false
        const unsubscribe = collaboration.subscribe(event => sendCollaboration(socket, 'server.event', event))
        const endIfRevoked = (): boolean => {
          try { actor(); return false } catch {
            sendCollaboration(socket, 'server.collaboration-ended', { reason: 'owner-access-revoked' })
            socket.close(1008, 'Owner access revoked')
            return true
          }
        }
        socket.on('message', data => {
          let message: unknown
          try { message = JSON.parse(data.toString()) } catch { return }
          if (!message || typeof message !== 'object' || Array.isArray(message)) return
          const value = message as { type?: unknown; payload?: unknown }
          if (typeof value.type !== 'string' || !value.payload || typeof value.payload !== 'object' || Array.isArray(value.payload)) return
          if (endIfRevoked()) return
          const payload = value.payload as Record<string, unknown>
          if (value.type === 'client.hello') {
            if (payload.collaborationId !== collaboration.snapshot().collaborationId || payload.workbenchId !== input.workbenchId || payload.participantId !== 'owner') {
              sendCollaboration(socket, 'server.collaboration-ended', { reason: 'collaboration-scope-denied' }); socket.close(1008); return
            }
            const joined = collaboration.connect({ collaborationId: collaboration.snapshot().collaborationId, workbenchId: input.workbenchId, participantId: 'owner', displayName: '房主', role: 'owner' })
            if ('error' in joined) { sendCollaboration(socket, 'server.collaboration-ended', joined); socket.close(1008); return }
            connected = true; sendCollaboration(socket, 'server.snapshot', joined)
            if (typeof payload.lastEventId === 'string') {
              const replay = collaboration.eventsSince(payload.lastEventId)
              if (replay !== undefined) for (const event of replay) sendCollaboration(socket, 'server.event', event)
              else sendCollaboration(socket, 'server.resync-required', collaboration.snapshot())
            }
            return
          }
          if (!connected) return
          if (value.type === 'client.command') {
            const command = payload as unknown as WorkbenchCommandEnvelopeV1
            void collaboration.command({ ...command, collaborationId: collaboration.snapshot().collaborationId, workbenchId: input.workbenchId, participantId: 'owner' }).then(result => sendCollaboration(socket, 'server.command-result', result))
          } else if (value.type === 'client.presence') {
            collaboration.publishPresence({ ...(payload as unknown as ParticipantPresenceV1), participantId: 'owner', displayName: '房主', role: 'owner', connectionState: 'connected', updatedAt: Date.now() })
          } else if (value.type === 'client.resync') sendCollaboration(socket, 'server.snapshot', collaboration.snapshot())
        })
        const heartbeat = setInterval(() => { if (!disposed) endIfRevoked() }, 15_000)
        heartbeat.unref?.()
        const dispose = () => {
          if (disposed) return
          disposed = true
          clearInterval(heartbeat)
          unsubscribe()
          if (connected) collaboration.disconnect('owner')
        }
        socket.once('close', dispose); socket.once('error', dispose)
      }
      const initialize = async () => {
        const cookieParts = new Map<string, string>()
        let target = original
        for (let attempt = 0; attempt < 4; attempt++) {
          const response = await fetch(target, { redirect: 'manual', headers: { cookie: [...cookieParts.values()].join('; '), 'accept-encoding': 'identity' } })
          for (const value of response.headers.getSetCookie()) {
            const first = value.split(';', 1)[0]!, separator = first.indexOf('=')
            if (separator > 0) cookieParts.set(first.slice(0, separator), first)
          }
          if ([301, 302, 303, 307, 308].includes(response.status)) {
            const location = response.headers.get('location'); await response.body?.cancel()
            if (!location) throw new Error('Host 未提供有效跳转。')
            target = new URL(location, target)
            if (target.origin !== upstream.origin) throw new Error('Host 跳转越界。')
            continue
          }
          if (!response.ok || !response.headers.get('content-type')?.includes('text/html') || !response.body) { await response.body?.cancel(); throw new Error('Host 工作台页面不可用。') }
          documentHtml = (await boundedBody(response.body)).toString('utf8')
          ownerCookie = [...cookieParts.values()].join('; ')
          break
        }
        if (!ownerCookie || !documentHtml) throw new Error('Host 页面认证未完成。')
        const redeemed = await options.handleView('redeem', { ticket: nativeTicket })
        const candidate = obj(redeemed.ok ? obj(redeemed.value).view : undefined)
        if (candidate.schemaVersion !== 1 || candidate.windowId !== input.windowId || candidate.workbenchId !== input.workbenchId || candidate.mode !== 'browser-workbench' || typeof candidate.closeToken !== 'string') throw new Error('工作台身份兑换失败。')
        view = candidate as unknown as OwnerView
        actor()
      }
      const proxy = async (request: IncomingMessage, response: ServerResponse, url: URL) => {
        const sourceHeaders = new Headers({ cookie: ownerCookie, origin: upstream.origin, 'accept-encoding': 'identity', [WORKBENCH_ACCESS_HEADER]: view!.closeToken })
        for (const name of ['content-type', 'accept', 'range', 'if-range']) {
          const value = request.headers[name]
          if (typeof value === 'string') sourceHeaders.set(name, value)
        }
        const lifetime = new AbortController()
        const abort = () => lifetime.abort()
        request.once('aborted', abort); response.once('close', abort)
        try {
          const body = request.method === 'GET' || request.method === 'HEAD' ? undefined : Readable.toWeb(request)
          const result = await fetch(new URL(url.pathname + url.search, upstream), { method: request.method ?? 'GET', redirect: 'manual', headers: sourceHeaders, signal: lifetime.signal,
            ...(body ? { body, duplex: 'half' } : {}) } as RequestInit)
          if (result.status >= 300 && result.status < 400) { await result.body?.cancel(); reject(response, 502, 'Host 意外要求重新认证。'); return }
          await sendResponse(response, result, request.method === 'HEAD')
        } finally { request.off('aborted', abort); response.off('close', abort) }
      }
      async function handle(request: IncomingMessage, response: ServerResponse) {
        if (closed || !trusted(request)) { reject(response, 403, '工作台来源不匹配。'); return }
        const url = new URL(request.url ?? '/', origin), method = request.method ?? 'GET'
        if (url.pathname === '/workbench' && url.searchParams.has('workbench')) {
          if (method !== 'GET' || !ticketAvailable || Date.now() >= input.expiresAt || url.searchParams.get('workbench') !== ticket
            || url.searchParams.get('token') !== ticket || url.searchParams.size !== 2) { reject(response, 410, '浏览器打开链接已失效。'); return }
          ticketAvailable = false
          initializing ??= initialize()
          await initializing
          headers(response); response.writeHead(303, { location: '/workbench', 'set-cookie': `${cookieName}=${cookie}; Path=/; HttpOnly; SameSite=Strict` }); response.end(); return
        }
        if (!authenticated(request) || !view) { reject(response, 401, '请从 DSH 打开此工作台。'); return }
        if (url.pathname.startsWith('/api/workbench-window/') && method === 'POST') {
          const action = url.pathname.slice('/api/workbench-window/'.length)
          const proof = request.headers[PAGE_HEADER]
          const envelope = obj(JSON.parse((await boundedBody(request, 1024 * 1024)).toString('utf8'))), payload = obj(envelope.payload)
          if (typeof proof !== 'string' || !pageProofs.has(proof) || !VIEW_ACTIONS.has(action) || envelope.method !== 'workbench-window/' + action
            || payload.windowId !== undefined && payload.windowId !== view.windowId
            || payload.workbenchId !== undefined && payload.workbenchId !== view.workbenchId
            || payload.closeToken !== undefined && payload.closeToken !== view.closeToken) { reject(response, 403, '此页面只能操作自己的控制租约。'); return }
          if (!['attach', 'status', 'failed'].includes(action) && proof !== activeProof) { reject(response, 409, '此页面没有活动控制连接。'); return }
          const result = await options.handleView(action, payload)
          if (result.ok && action === 'attach' && typeof payload.pageId === 'string') {
            activeProof = proof; activePageId = payload.pageId
            for (const [socket, previousProof] of sockets) if (previousProof !== proof) socket.destroy()
          }
          if (result.ok && ['suspend', 'reclaimed'].includes(action)) {
            activeProof = undefined; activePageId = undefined
            for (const socket of sockets.keys()) socket.destroy()
          }
          rpc(response, envelope.rpcId, result); return
        }
        if (url.pathname === '/api/workbench-window-close' && method === 'POST') {
          const payload = obj(JSON.parse((await boundedBody(request, 1024 * 1024)).toString('utf8')))
          if (payload.closeToken !== view.closeToken || payload.action !== 'suspend' || payload.pageId !== activePageId) { reject(response, 403, '关闭凭证不匹配。'); return }
          const { action: _action, ...body } = payload
          const result = await options.handleView('suspend', body)
          if (result.ok) { activeProof = undefined; activePageId = undefined; for (const socket of sockets.keys()) socket.destroy() }
          headers(response); response.writeHead(204); response.end(); return
        }
        const context = actor()
        if (url.pathname === '/workbench' && !url.search && (method === 'GET' || method === 'HEAD')) {
          // Refresh gets fresh native grants and the same logical view; attach
          // validates the single active page connection before any ready write.
          const pageProof = randomBytes(24).toString('base64url'); pageProofs.add(pageProof)
          if (pageProofs.size > 32) for (const item of pageProofs) { if (item !== activeProof) { pageProofs.delete(item); break } }
          const collaboration = options.collaboration === undefined ? undefined : await options.collaboration.start(input.workbenchId, 'owner')
          const collaborationMarker = collaboration === undefined ? '' : `globalThis.__WORKBENCH_COLLABORATION__=${scriptJson({ collaborationId: collaboration.collaborationId, participantId: 'owner', role: 'owner' })};`
          const injection = `<script>globalThis.__WORKBENCH_WINDOW_VIEW__=${scriptJson(view)};globalThis.__DSH_REMOTE_ACCESS__=${scriptJson(options.native.bootstrap(context))};globalThis.__WORKBENCH_GATEWAY_PAGE__=${scriptJson(pageProof)};${collaborationMarker}
 (()=>{const p=globalThis.__WORKBENCH_GATEWAY_PAGE__,f=globalThis.fetch.bind(globalThis);globalThis.fetch=(input,init)=>{const u=new URL(input instanceof Request?input.url:String(input),location.href);if(u.origin===location.origin&&u.pathname.startsWith('/api/')){const h=new Headers(init?.headers??(input instanceof Request?input.headers:undefined));h.set('${PAGE_HEADER}',p);return f(input,{...init,headers:h})}return f(input,init)};const W=globalThis.WebSocket;globalThis.WebSocket=class extends W{constructor(url,protocols){const u=new URL(String(url),location.href);if(u.host===location.host&&(u.pathname==='/api/remote.mux'||u.pathname==='/api/workbench-collaboration'))u.searchParams.set('bay-page',p);if(protocols===undefined)super(u.href);else super(u.href,protocols)}};if(typeof Worker==='function'){const send=Worker.prototype.postMessage;Worker.prototype.postMessage=function(message,transfer){if(message&&typeof message.url==='string'){const u=new URL(message.url,location.href);if(u.origin===location.origin&&u.pathname==='/api/session/uploadFileBinary')message={...message,headers:{...message.headers,'${PAGE_HEADER}':p}}}return transfer===undefined?send.call(this,message):send.call(this,message,transfer)}}})();</script>`
          const html = (await options.native.renderDocument(context)).replace(/<head(?:\s[^>]*)?>/iu, head => head + injection)
          headers(response); response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); response.end(method === 'HEAD' ? undefined : html); return
        }
        const proof = request.headers[PAGE_HEADER]
        if (url.pathname.startsWith('/api/') && (typeof proof !== 'string' || !pageProofs.has(proof)
          || proof !== activeProof && !BOOT_READS.has(url.pathname))) { reject(response, 409, '请等待此页面取得工作台控制连接。'); return }
        if (url.pathname.startsWith('/api/workbench-share/') && method === 'POST') {
          const action = url.pathname.slice('/api/workbench-share/'.length)
          const envelope = obj(JSON.parse((await boundedBody(request, 1024 * 1024)).toString('utf8'))), payload = obj(envelope.payload)
          if (!SHARE_ACTIONS.has(action) || !options.handleShare || envelope.method !== 'workbench-share/' + action || payload.workbenchId !== undefined && payload.workbenchId !== input.workbenchId) { reject(response, 403, '分享操作不在当前工作台范围内。'); return }
          rpc(response, envelope.rpcId, await options.handleShare(action, { ...payload, workbenchId: input.workbenchId }, context)); return
        }
        if (WORKBENCH_ROUTES.has(url.pathname)) { await proxy(request, response, url); return }
        if (url.pathname.startsWith('/api/')) {
          const lifetime = new AbortController(), abort = () => lifetime.abort()
          request.once('aborted', abort); response.once('close', abort)
          try {
            const body = method === 'GET' || method === 'HEAD' ? undefined : Readable.toWeb(request)
            const result = await options.native.handleHttp(new Request(new URL(url.pathname + url.search, upstream), {
              method, signal: lifetime.signal, headers: { 'content-type': request.headers['content-type'] ?? 'application/json' }, ...(body ? { body, duplex: 'half' } : {}),
            } as RequestInit), context)
            await sendResponse(response, result, method === 'HEAD')
          } finally { request.off('aborted', abort); response.off('close', abort) }
          return
        }
        if (['GET', 'HEAD'].includes(method) && (/^\/(?:plugins\/|assets\/|favicon(?:-dark)?\.)/u.test(url.pathname)
          || ['/manifest.webmanifest', '/apple-touch-icon.png'].includes(url.pathname))) { await proxy(request, response, url); return }
        reject(response, 403, '此入口未向浏览器工作台开放。')
      }
      server.on('upgrade', (request, socket, head) => {
        try {
          const url = new URL(request.url ?? '/', origin), proof = url.searchParams.get('bay-page')
          if (closed || !trusted(request) || !authenticated(request) || !proof || !pageProofs.has(proof)) throw new Error('unauthorized')
          if (url.pathname === '/api/workbench-collaboration' && options.collaboration !== undefined) {
            const collaboration = options.collaboration.get(input.workbenchId)
            if (collaboration === undefined) throw new Error('collaboration-unavailable')
            collaborationWss.handleUpgrade(request, socket, head, upgraded => { void handleCollaboration(upgraded, collaboration) })
            return
          }
          if (url.pathname !== '/api/remote.mux') throw new Error('unauthorized')
          request.url = '/api/remote.mux'
          options.native.handleUpgrade(request, socket, head, actor(), (endpoint, _payload, phase) => {
            actor()
            if (!pageProofs.has(proof) || proof !== activeProof && (!BOOT_STREAMS.has(endpoint) || phase === 'item' && endpoint !== '$events')) throw new Error('此页面没有活动控制连接。')
          })
          sockets.set(socket, proof); socket.once('close', () => sockets.delete(socket))
        } catch { socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n') }
      })
      await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve() }) })
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('无法建立本机浏览器入口。')
      origin = `http://127.0.0.1:${address.port}`
      const url = `${origin}/workbench?workbench=${ticket}&token=${ticket}`
      let revokedTimer: ReturnType<typeof setTimeout> | undefined
      const expiredTimer = setTimeout(() => { if (!view) void close() }, Math.max(1, Math.min(2_147_483_647, input.expiresAt - Date.now())))
      expiredTimer.unref()
      const unsubscribe = options.access.onRevoke(id => {
        if (id !== input.windowId || !view) return
        // Retain a short terminal-status channel so the page can display the
        // handoff result. Native peers are revoked immediately by the adapter.
        revokedTimer ??= setTimeout(() => { void close() }, 60_000)
        revokedTimer.unref()
      })
      const close = async () => {
        if (closed) return
        closed = true
        clearTimeout(expiredTimer); if (revokedTimer) clearTimeout(revokedTimer); unsubscribe()
        for (const socket of sockets.keys()) socket.destroy()
        collaborationWss.close()
        server.closeAllConnections()
        await new Promise<void>(resolve => server.close(() => resolve()))
      }
      entries.set(input.windowId, { url, close })
      if (disposed) { await close(); throw new Error('浏览器工作台服务已关闭。') }
      return { url }
    })()
    preparing.set(input.windowId, pending)
    try { return await pending } finally { preparing.delete(input.windowId) }
  }
  return { prepare, async close() {
    disposed = true
    await Promise.allSettled([...preparing.values()])
    await Promise.all([...entries.values()].map(entry => entry.close()))
    entries.clear()
  } }
}
