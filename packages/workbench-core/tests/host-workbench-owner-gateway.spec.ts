import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import { WebSocket, WebSocketServer } from 'ws'
import { afterEach, expect, it, vi } from 'vitest'
import { createWorkbenchOwnerGateway } from '../src/host-workbench-owner-gateway.ts'
import { createHostBrowserWindowController } from '../src/host-browser-window-controller.ts'
import { fileAccessFixture } from './helpers/file-access.ts'

const cleanups: (() => unknown)[] = []
afterEach(async () => { for (const dispose of cleanups.splice(0).reverse()) await dispose() })
async function setup() {
  const file = await fileAccessFixture(); cleanups.push(() => file.dispose())
  const received: { path: string; cookie: string; access: string }[] = []
  let receivedChunk!: () => void
  const firstChunk = new Promise<void>(resolve => { receivedChunk = resolve })
  const upstream = createServer(async (request, response) => {
    if (request.url?.startsWith('/workbench?')) {
      response.writeHead(200, { 'content-type': 'text/html', 'set-cookie': 'dsh-owner=private-owner-cookie; HttpOnly' })
      response.end('<html><head></head><body>OWNER PRIVATE SNAPSHOT</body></html>'); return
    }
    received.push({ path: request.url!, cookie: request.headers.cookie ?? '', access: String(request.headers['x-bay-access'] ?? '') })
    let length = 0
    for await (const chunk of request) { length += chunk.length; receivedChunk() }
    response.writeHead(200, { 'content-type': 'application/json', 'set-cookie': 'should-not-leak=value' })
    response.end(JSON.stringify({ length }))
  })
  await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', resolve))
  cleanups.push(() => new Promise<void>(resolve => { upstream.closeAllConnections(); upstream.close(() => resolve()) }))
  const upstreamOrigin = `http://127.0.0.1:${(upstream.address() as { port: number }).port}`
  const controller = createHostBrowserWindowController({ origin: upstreamOrigin, access: file.access,
    lookupWorkbench: id => file.access.lookup(id), authenticatedUrl: value => value + '&token=private-launch-token' })
  const initial = await controller.handle('prepare', { workbenchId: 'workbench-a' })
  if (!initial.ok) throw new Error('prepare failed')
  const prepared = initial.value as { windowId: string; url: string; expiresAt: number }
  const wss = new WebSocketServer({ noServer: true }); cleanups.push(() => { wss.close() })
  const native = {
    renderDocument: vi.fn(async () => '<html data-workbench-document="v1"><head><script>nativeBoot()</script></head><body>scoped native document</body></html>'),
    bootstrap: vi.fn(() => ({ type: 'baseline', owner: false, grants: [] })),
    handleHttp: vi.fn(async (request: Request, context: any) => Response.json({ actor: context.actor, workbenchId: context.workbenchId, authorization: request.headers.get('authorization') })),
    handleUpgrade: vi.fn((request, socket, head, context, authorize) => wss.handleUpgrade(request, socket, head, ws => {
      ws.send(JSON.stringify({ actor: context.actor, workbenchId: context.workbenchId, path: request.url }))
      ws.on('message', bytes => { const frame = JSON.parse(bytes.toString()); try { authorize(frame.endpoint, {}, frame.phase); ws.send('allowed') } catch { ws.send('denied') } })
    })),
  }
  const share = vi.fn(async () => ({ ok: true as const, value: {} }))
  const gateway = await createWorkbenchOwnerGateway({ access: file.access, native: native as never, upstreamOrigin, handleView: controller.handle, handleShare: share })
  cleanups.push(() => gateway.close())
  const opened = await gateway.prepare({ ...prepared, workbenchId: 'workbench-a' })
  const origin = new URL(opened.url).origin
  const exchange = await fetch(opened.url, { redirect: 'manual' })
  expect(exchange.status).toBe(303)
  const cookie = exchange.headers.get('set-cookie')!.split(';', 1)[0]!
  const page = async () => {
    const response = await fetch(origin + '/workbench', { headers: { cookie } }), html = await response.text()
    const proof = JSON.parse(html.match(/__WORKBENCH_GATEWAY_PAGE__=("[^"\r\n]+")/u)![1]!) as string
    const view = JSON.parse(html.match(/__WORKBENCH_WINDOW_VIEW__=(\{[^;]+\});/u)![1]!)
    return { response, html, proof, view }
  }
  const rpc = (action: string, payload: unknown, proof: string) => fetch(origin + '/api/workbench-window/' + action, {
    method: 'POST', headers: { cookie, 'x-bay-page': proof, 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId: 'rpc', method: 'workbench-window/' + action, payload }),
  })
  const prompt = (proof: string) => fetch(origin + '/api/session/prompt', { method: 'POST', headers: { cookie, 'x-bay-page': proof, authorization: 'forged-owner', 'x-bay-access': 'forged-access' }, body: '{}' })
  return { ...file, native, upstream, gateway, controller, prepared, opened, origin, cookie, exchange, page, rpc, prompt, received, firstChunk, share }
}

it('exchanges a real file Workbench lease for a scoped origin without exposing upstream credentials or owner bootstrap', async () => {
  const f = await setup(), page = await f.page()
  expect(page.response.status).toBe(200)
  expect(f.cookie).toMatch(/^bay-owner-[a-f0-9]+=/u)
  expect(f.exchange.headers.get('set-cookie')).not.toContain('private-owner-cookie')
  expect(page.html).toContain('scoped native document')
  expect(page.html.indexOf('__WORKBENCH_GATEWAY_PAGE__')).toBeLessThan(page.html.indexOf('nativeBoot()'))
  expect(page.html).not.toContain('OWNER PRIVATE SNAPSHOT')
  expect(page.html).not.toContain('__WORKBENCH_SHARE_GUEST__')
  expect(page.html).not.toContain('private-launch-token')
  expect((await fetch(f.opened.url, { redirect: 'manual' })).status).toBe(410)
  expect((await f.prompt(page.proof)).status).toBe(409)
  const pageId = randomUUID()
  expect(await (await f.rpc('attach', { closeToken: page.view.closeToken, pageId }, page.proof)).json()).toMatchObject({ result: { ok: true } })
  expect(await (await f.rpc('ready', { windowId: page.view.windowId, closeToken: page.view.closeToken, pageId }, page.proof)).json()).toMatchObject({ result: { ok: true } })
  expect(await (await f.prompt(page.proof)).json()).toEqual({ actor: 'browser-owner', workbenchId: 'workbench-a', authorization: null })
  expect(f.received).toEqual([])
  expect((await f.rpc('status', { windowId: randomUUID() }, page.proof)).status).toBe(403)
  const ws = new WebSocket(f.origin.replace('http:', 'ws:') + '/api/remote.mux?bay-page=' + page.proof, { headers: { cookie: f.cookie, origin: f.origin } })
  const frame = await new Promise<string>((resolve, reject) => { ws.once('message', bytes => resolve(bytes.toString())); ws.once('error', reject) })
  expect(JSON.parse(frame)).toEqual({ actor: 'browser-owner', workbenchId: 'workbench-a', path: '/api/remote.mux' })
  ws.close()
})

it('binds writes to one attached page, resumes refresh and rejects the previous page proof', async () => {
  const f = await setup(), first = await f.page(), pageId = randomUUID()
  await f.rpc('attach', { closeToken: first.view.closeToken, pageId }, first.proof)
  await f.rpc('ready', { windowId: first.view.windowId, closeToken: first.view.closeToken, pageId }, first.proof)
  const second = await f.page(), nextPage = randomUUID()
  expect(await (await f.rpc('attach', { closeToken: second.view.closeToken, pageId: nextPage }, second.proof)).json()).toMatchObject({ result: { ok: false } })
  expect((await f.prompt(second.proof)).status).toBe(409)
  expect((await f.prompt(first.proof)).status).toBe(200)
  await fetch(f.origin + '/api/workbench-window-close', { method: 'POST', headers: { cookie: f.cookie }, body: JSON.stringify({ action: 'suspend', closeToken: first.view.closeToken, pageId }) })
  expect(await (await f.rpc('attach', { closeToken: second.view.closeToken, pageId: nextPage }, second.proof)).json()).toMatchObject({ result: { ok: true } })
  expect((await f.prompt(first.proof)).status).toBe(409)
  expect((await f.prompt(second.proof)).status).toBe(200)
})

it('checks page ownership for every logical WebSocket request, including a pre-attach socket', async () => {
  const f = await setup(), page = await f.page()
  const ws = new WebSocket(f.origin.replace('http:', 'ws:') + '/api/remote.mux?bay-page=' + page.proof, { headers: { cookie: f.cookie, origin: f.origin } })
  await new Promise<void>((resolve, reject) => { ws.once('message', () => resolve()); ws.once('error', reject) })
  const frame = (endpoint: string, phase: string) => new Promise<string>(resolve => { ws.once('message', bytes => resolve(bytes.toString())); ws.send(JSON.stringify({ endpoint, phase })) })
  expect(await frame('session/control', 'open')).toBe('allowed')
  expect(await frame('terminal/write', 'open')).toBe('denied')
  expect(await frame('session/control', 'item')).toBe('denied')
  const pageId = randomUUID()
  await f.rpc('attach', { closeToken: page.view.closeToken, pageId }, page.proof)
  await f.rpc('ready', { windowId: page.view.windowId, closeToken: page.view.closeToken, pageId }, page.proof)
  expect(await frame('terminal/write', 'open')).toBe('allowed')
  f.access.revoke(page.view.windowId)
  expect(await frame('session/control', 'out')).toBe('denied')
  ws.close()
})

it('streams package upload before the whole body arrives and sets only the Host-owned scope credential', async () => {
  const f = await setup(), page = await f.page(), pageId = randomUUID()
  await f.rpc('attach', { closeToken: page.view.closeToken, pageId }, page.proof)
  await f.rpc('ready', { windowId: page.view.windowId, closeToken: page.view.closeToken, pageId }, page.proof)
  const body = new ReadableStream({ async start(controller) {
    controller.enqueue(Buffer.alloc(1024, 1))
    await f.firstChunk
    controller.enqueue(Buffer.alloc(2048, 2)); controller.close()
  } })
  const response = await fetch(f.origin + '/api/workbench/complete/v5/upload', { method: 'POST', headers: { cookie: f.cookie, 'x-bay-page': page.proof, 'x-bay-access': 'forged' }, body, duplex: 'half' } as RequestInit)
  expect(await response.json()).toEqual({ length: 3072 })
  expect(response.headers.get('set-cookie')).toBeNull()
  expect(f.received).toEqual([{ path: '/api/workbench/complete/v5/upload', cookie: 'dsh-owner=private-owner-cookie', access: page.view.closeToken }])
})
