import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import { WebSocket, WebSocketServer } from 'ws'
import { afterEach, expect, it, vi } from 'vitest'
import { createWorkbenchOwnerGateway } from '../src/host-workbench-owner-gateway.ts'
import { createWorkbenchShareGateway, selectPrivateIPv4 } from '../src/host-workbench-share-gateway.ts'
import { createWorkbenchShareSessionManager } from '../src/host-workbench-share-session.ts'
import { createHostBrowserWindowController } from '../src/host-browser-window-controller.ts'
import { createWorkbenchCollaborationManager } from '../src/host-workbench-collaboration.ts'
import { fileAccessFixture } from './helpers/file-access.ts'

const cleanups: (() => unknown)[] = []
afterEach(async () => { for (const dispose of cleanups.splice(0).reverse()) await dispose() })
async function setup(withCollaboration = true) {
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
  const collaboration = createWorkbenchCollaborationManager({
    loadSeed: () => ({
      areas: [{ areaId: 'area-a' }],
      editors: [{ areaId: 'area-a', editorId: 'workbench.conversation' }],
    }),
  })
  const gateway = await createWorkbenchOwnerGateway({ access: file.access, native: native as never, upstreamOrigin, handleView: controller.handle, handleShare: share,
    ...(withCollaboration ? { collaboration } : {}) })
  cleanups.push(() => gateway.close())
  cleanups.push(() => collaboration.dispose())
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
  return { ...file, native, upstream, gateway, controller, collaboration, prepared, opened, origin, cookie, exchange, page, rpc, prompt, received, firstChunk, share }
}

it('exchanges a real file Workbench lease for a scoped origin without exposing upstream credentials or owner bootstrap', async () => {
  const f = await setup(), page = await f.page()
  expect(page.response.status).toBe(200)
  expect(f.cookie).toMatch(/^bay-owner-[a-f0-9]+=/u)
  expect(f.exchange.headers.get('set-cookie')).not.toContain('private-owner-cookie')
  expect(page.html).toContain('scoped native document')
  expect(page.html.indexOf('__WORKBENCH_GATEWAY_PAGE__')).toBeLessThan(page.html.indexOf('nativeBoot()'))
  expect(page.html).not.toContain('OWNER PRIVATE SNAPSHOT')
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

it('keeps a normal browser-owner page on the native single-Workbench surface', async () => {
  const f = await setup(false)
  const page = await f.page()
  expect(page.html).not.toContain('__WORKBENCH_COLLABORATION__')
  expect((await f.prompt(page.proof)).status).toBe(409)
  const pageId = randomUUID()
  await f.rpc('attach', { closeToken: page.view.closeToken, pageId }, page.proof)
  await f.rpc('ready', { windowId: page.view.windowId, closeToken: page.view.closeToken, pageId }, page.proof)
  expect((await f.prompt(page.proof)).status).toBe(200)
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

it('connects the browser owner to the same shared-control session as LAN participants', async () => {
  const f = await setup()
  const page = await f.page()
  expect(page.html).toContain('__WORKBENCH_COLLABORATION__')
  const marker = JSON.parse(page.html.match(/__WORKBENCH_COLLABORATION__=(\{[^;]+\});/u)![1]!) as { collaborationId: string; participantId: string; role: string }
  expect(marker).toMatchObject({ participantId: 'owner', role: 'owner' })
  const ws = new WebSocket(f.origin.replace('http:', 'ws:') + '/api/workbench-collaboration?bay-page=' + page.proof, { headers: { cookie: f.cookie, origin: f.origin } })
  const frames: any[] = [], waiters: ((frame: any) => void)[] = []
  ws.on('message', bytes => {
    const frame = JSON.parse(bytes.toString())
    frames.push(frame)
    waiters.shift()?.(frame)
  })
  const nextFrame = () => frames.length > 0
    ? Promise.resolve(frames.shift())
    : new Promise<any>(resolve => waiters.push(resolve))
  const nextFrameOfType = async (type: string) => {
    for (;;) {
      const frame = await nextFrame()
      if (frame.type === type) return frame
    }
  }
  await new Promise<void>((resolve, reject) => { ws.once('open', () => resolve()); ws.once('error', reject) })
  try {
    ws.send(JSON.stringify({ type: 'client.hello', payload: { schemaVersion: 1, collaborationId: marker.collaborationId, workbenchId: 'workbench-a', participantId: 'owner' } }))
    const snapshot = await nextFrameOfType('server.snapshot')
    expect(snapshot.payload.participants.some((participant: any) => participant.participantId === 'owner')).toBe(true)
    ws.send(JSON.stringify({ type: 'client.command', payload: {
      requestId: randomUUID(), collaborationId: marker.collaborationId, workbenchId: 'workbench-a', participantId: 'owner', baseRevision: snapshot.payload.workbenchRevision,
      operation: { kind: 'canvas.set-viewport', viewport: { width: 1440, height: 900, scaleMode: 'contain' } },
    } }))
    const result = await nextFrameOfType('server.command-result')
    expect(result.payload.ok).toBe(true)
    expect(f.collaboration.get('workbench-a')?.snapshot().sharedCanvas.viewport.width).toBe(1440)
  } finally {
    ws.close()
  }
})

it('keeps owner and LAN participant on one live collaboration session', async () => {
  const gatewayHost = selectPrivateIPv4()
  if (gatewayHost === undefined) return
  const f = await setup()
  const ownerPage = await f.page()
  const marker = JSON.parse(ownerPage.html.match(/__WORKBENCH_COLLABORATION__=(\{[^;]+\});/u)![1]!) as { collaborationId: string }
  const upstreamOrigin = `http://127.0.0.1:${String((f.upstream.address() as { port: number }).port)}`
  const shareManager = createWorkbenchShareSessionManager({ randomToken: () => `dual-${'x'.repeat(42)}` })
  const share = await createWorkbenchShareGateway({
    access: f.access,
    collaboration: f.collaboration,
    upstreamOrigin,
    manager: shareManager,
    networkInterfaces: { WLAN: [{ address: gatewayHost, family: 'IPv4', internal: false }] },
    prepareView: async () => ({ windowId: 'window-lan-dual', url: `${upstreamOrigin}/workbench?workbench=${'l'.repeat(43)}&token=launch`, expiresAt: Date.now() + 60_000 }),
    redeemView: async () => ({ schemaVersion: 1, windowId: 'window-lan-dual', workbenchId: 'workbench-a', mode: 'browser-workbench', closeToken: `close-${'d'.repeat(40)}` }),
    closeView: async () => {},
  })
  try {
    const started = await share.startShare('workbench-a')
    const link = await fetch(started.url, { redirect: 'manual' })
    const shareCookie = link.headers.get('set-cookie')?.split(';', 1)[0]
    expect(shareCookie).toMatch(/^dsh-workbench-share=/u)
    const document = await fetch(`http://${share.host}:${String(share.port)}/workbench`, { headers: { cookie: shareCookie! } })
    expect(document.status, await document.clone().text()).toBe(200)
    const participantLease = shareManager.getSnapshot()[0]?.guests?.[0]?.leaseId
    if (!participantLease) throw new Error('participant lease missing')

    const ownerWs = new WebSocket(f.origin.replace('http:', 'ws:') + '/api/workbench-collaboration?bay-page=' + ownerPage.proof, { headers: { cookie: f.cookie, origin: f.origin } })
    const participantWs = new WebSocket(`ws://${share.host}:${String(share.port)}/api/workbench-collaboration`, { headers: { cookie: shareCookie! } })
    const collect = (socket: WebSocket) => {
      const frames: any[] = [], waiters: ((frame: any) => void)[] = []
      socket.on('message', bytes => { const frame = JSON.parse(bytes.toString()); frames.push(frame); waiters.shift()?.(frame) })
      const next = () => frames.length > 0 ? Promise.resolve(frames.shift()) : new Promise<any>(resolve => waiters.push(resolve))
      return { next, nextOfType: async (type: string) => { for (;;) { const frame = await next(); if (frame.type === type) return frame } } }
    }
    const ownerFrames = collect(ownerWs), participantFrames = collect(participantWs)
    await Promise.all([
      new Promise<void>((resolve, reject) => { ownerWs.once('open', () => resolve()); ownerWs.once('error', reject) }),
      new Promise<void>((resolve, reject) => { participantWs.once('open', () => resolve()); participantWs.once('error', reject) }),
    ])
    try {
      ownerWs.send(JSON.stringify({ type: 'client.hello', payload: { schemaVersion: 1, collaborationId: marker.collaborationId, workbenchId: 'workbench-a', participantId: 'owner' } }))
      participantWs.send(JSON.stringify({ type: 'client.hello', payload: { schemaVersion: 1, collaborationId: marker.collaborationId, workbenchId: 'workbench-a', participantId: participantLease } }))
      const [ownerSnapshot, participantSnapshot] = await Promise.all([ownerFrames.nextOfType('server.snapshot'), participantFrames.nextOfType('server.snapshot')])
      expect(ownerSnapshot.payload.collaborationId).toBe(participantSnapshot.payload.collaborationId)
      expect(ownerSnapshot.payload.workbenchId).toBe('workbench-a')

      ownerWs.send(JSON.stringify({ type: 'client.command', payload: {
        requestId: randomUUID(), collaborationId: marker.collaborationId, workbenchId: 'workbench-a', participantId: 'owner', baseRevision: ownerSnapshot.payload.workbenchRevision,
        operation: { kind: 'canvas.set-layout', layout: { version: 2, root: { kind: 'area', areaId: 'area-a', tabs: [] }, activeGroupId: 'area-a' } },
      } }))
      const nextEvent = async (frames: ReturnType<typeof collect>, kind: string) => {
        for (;;) { const frame = await frames.nextOfType('server.event'); if (frame.payload.kind === kind) return frame }
      }
      expect((await nextEvent(participantFrames, 'canvas.layout.changed')).payload.kind).toBe('canvas.layout.changed')
      participantWs.send(JSON.stringify({ type: 'client.command', payload: {
        requestId: randomUUID(), collaborationId: marker.collaborationId, workbenchId: 'workbench-a', participantId: participantLease, baseRevision: f.collaboration.get('workbench-a')?.snapshot().workbenchRevision ?? 0,
        operation: { kind: 'canvas.set-focus', focus: { areaId: 'area-a', editorId: 'workbench.conversation' } },
      } }))
      expect((await nextEvent(ownerFrames, 'canvas.focus.changed')).payload.kind).toBe('canvas.focus.changed')
      participantWs.send(JSON.stringify({ type: 'client.presence', payload: { participantId: participantLease, displayName: 'LAN', role: 'participant', areaId: 'area-a', editorId: 'workbench.conversation', intent: 'editing', connectionState: 'connected', updatedAt: Date.now() } }))
      const presence = await nextEvent(ownerFrames, 'presence.changed')
      expect(presence.payload.kind).toBe('presence.changed')
      expect(presence.payload.payload.participantId).toBe(participantLease)
    } finally {
      ownerWs.close(); participantWs.close()
    }
  } finally {
    await share.close()
    await shareManager.dispose()
  }
})
