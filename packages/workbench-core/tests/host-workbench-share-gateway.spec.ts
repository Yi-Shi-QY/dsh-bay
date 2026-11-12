import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { connect } from 'node:net'
import { createHash } from 'node:crypto'
import { WebSocket } from 'ws'
import { describe, expect, it } from 'vitest'
import { createWorkbenchShareGateway, selectPrivateIPv4 } from '../src/host-workbench-share-gateway.ts'
import { createWorkbenchShareSessionManager } from '../src/host-workbench-share-session.ts'
import { createWorkbenchCollaborationManager } from '../src/host-workbench-collaboration.ts'
import { fileAccessFixture } from './helpers/file-access.ts'

function body(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    request.on('data', chunk => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    request.on('error', reject)
  })
}

async function listen(server: ReturnType<typeof createServer>): Promise<{ port: number; close: () => Promise<void> }> {
  await new Promise<void>((resolve, reject) => server.listen(0, '127.0.0.1', error => error ? reject(error) : resolve()))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('upstream did not bind')
  return { port: address.port, close: () => new Promise(resolve => server.close(() => resolve())) }
}

describe('Workbench LAN share gateway', () => {
  it('exchanges a bearer link for a native view and never returns the owner cookie', async () => {
    const gatewayHost = selectPrivateIPv4()
    if (gatewayHost === undefined) return
    let seenOwnerCookie = ''
    const upstreamServer=createServer(async (request: IncomingMessage, response: ServerResponse) => {
      if (request.url?.startsWith('/workbench?workbench=')) {
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'set-cookie': ['dsh-owner=owner-value; HttpOnly'] })
        response.end('<!doctype html><html data-workbench-document="v1"><head></head><body><div id="root"></div></body></html>')
        return
      }
      if (request.url === '/api/echo') {
        seenOwnerCookie = request.headers.cookie ?? ''
        const text = await body(request)
        response.writeHead(200, { 'content-type': 'text/plain' }); response.end(text)
        return
      }
      if (request.url === '/api/redirect') {
        response.writeHead(302, { location: `http://${request.headers.host}/workbench?token=owner-token&workbench=native-ticket&keep=1` })
        response.end()
        return
      }
      response.writeHead(404); response.end()
    })
    const forwarded:Buffer[]=[]
    upstreamServer.on('upgrade',(request,socket)=>{
      const accept=createHash('sha1').update(String(request.headers['sec-websocket-key'])+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64')
      socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: '+accept+'\r\n\r\n')
      socket.on('data',chunk=>forwarded.push(Buffer.from(chunk)))
      socket.on('end',()=>socket.destroy())
    })
    const upstream = await listen(upstreamServer)
    const manager = createWorkbenchShareSessionManager({ randomToken: () => `s-${'x'.repeat(42)}` })
    let viewCounter = 0
    const gateway = await createWorkbenchShareGateway({
      upstreamOrigin: `http://127.0.0.1:${String(upstream.port)}`,
      manager,
      networkInterfaces: { WLAN: [{ address: gatewayHost, family: 'IPv4', internal: false }] },
      prepareView: async () => ({ windowId: `window-${String(++viewCounter)}`, url: `http://127.0.0.1:${String(upstream.port)}/workbench?workbench=${'t'.repeat(43)}&token=launch`, expiresAt: Date.now() + 10_000 }),
      redeemView: async () => ({ schemaVersion: 1, windowId: `window-${String(viewCounter)}`, workbenchId: 'workbench-a', mode: 'browser-workbench', closeToken: `close-${'c'.repeat(40)}` }),
      closeView: async () => {},
    })
    try {
      const started = await gateway.startShare('workbench-a')
      const link = await fetch(started.url, { redirect: 'manual' })
      expect(link.status).toBe(303)
      const shareCookie = link.headers.get('set-cookie')?.split(';', 1)[0]
      expect(shareCookie).toMatch(/^dsh-workbench-share=/u)
      const document = await fetch(`http://${gateway.host}:${String(gateway.port)}/workbench`, { headers: { cookie: shareCookie! } })
      expect(document.status, await document.clone().text()).toBe(200)
      expect(document.headers.get('set-cookie')).toBeNull()
      const html = await document.text()
      expect(html).toContain('__WORKBENCH_WINDOW_VIEW__')
      expect(html).toContain('history.replaceState(null,"","/workbench")')
      const view = JSON.parse(html.match(/__WORKBENCH_WINDOW_VIEW__=(\{[^;]+\});/u)![1]!) as { windowId: string; closeToken: string }
      const windowRpc = (action: string, payload: unknown) => fetch(`http://${gateway.host}:${String(gateway.port)}/api/workbench-window/${action}`, {
        method: 'POST', headers: { cookie: shareCookie!, 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'client-request', rpcId: action, method: `workbench-window/${action}`, payload }),
      })
      // The participant page registers itself with its own close token.
      expect((await windowRpc('attach', { closeToken: view.closeToken, pageId: 'page-1' })).status).toBe(200)
      expect((await windowRpc('attach', { closeToken: 'someone-else', pageId: 'page-1' })).status).toBe(403)
      expect((await windowRpc('status', { windowId: view.windowId })).status).toBe(200)
      // The browser client reads a floating handoff before it mounts.
      const floating = await windowRpc('floating-read', { windowId: view.windowId, closeToken: view.closeToken })
      expect(floating.status).toBe(200)
      expect((await floating.json() as { result: { ok: boolean; value: unknown } }).result).toEqual({ ok: true, value: { snapshot: null } })
      expect((await windowRpc('floating-read', { windowId: 'another-window' })).status).toBe(403)
      expect((await windowRpc('reclaim', { windowId: view.windowId })).status).toBe(403)
      const proxied = await fetch(`http://${gateway.host}:${String(gateway.port)}/api/echo`, { method: 'POST', headers: { cookie: shareCookie!, 'content-type': 'text/plain' }, body: 'ok' })
      expect(proxied.status).toBe(403)
      expect(seenOwnerCookie).toBe('')
      for(const path of ['/api/workbench/distribution/v4/export','/api/workbenchDistribution/export','/api/pluginManager/installBundle','/api/dynamicCordisRunner/run','/api/%77orkbench/distribution/v4/identities']){
        const blocked=await fetch('http://'+gateway.host+':'+gateway.port+path,{method:'POST',headers:{cookie:shareCookie!,'content-type':'application/json'},body:'{}'})
        expect(blocked.status).toBe(403)
      }
      await new Promise<void>((resolve,reject)=>{
        const socket=connect(gateway.port,gateway.host),timer=setTimeout(()=>{socket.destroy();reject(Error('guest mux was not closed'))},2000)
        socket.once('connect',()=>socket.write('GET /api/remote.mux HTTP/1.1\r\nHost: '+gateway.host+':'+gateway.port+'\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGVzdC1kaXN0cmlidXRpb24=\r\nSec-WebSocket-Version: 13\r\nCookie: '+shareCookie+'\r\n\r\n'))
        socket.once('data',()=>{
          const text=JSON.stringify({type:'open',streamId:'1',endpoint:'pluginManager/installBundle',payload:{}})
          const frame=(source:string,opcode:number,final:boolean)=>{const bytes=Buffer.from(source),mask=Buffer.from([1,2,3,4]);return Buffer.concat([Buffer.from([(final?128:0)|opcode,128|bytes.length]),mask,Buffer.from(bytes.map((b,i)=>b^mask[i%4]!))])}
          socket.write(frame(text.slice(0,40),1,false));socket.write(frame(text.slice(40),0,true))
        })
        socket.once('close',()=>{clearTimeout(timer);resolve()});socket.once('error',reject)
      })
      expect(forwarded).toEqual([])
      const redirect = await fetch(`http://${gateway.host}:${String(gateway.port)}/api/redirect`, { redirect: 'manual', headers: { cookie: shareCookie! } })
      expect(redirect.status).toBe(403)
      expect(redirect.headers.get('location')).toBeNull()
    } finally {
      await gateway.close()
      await upstream.close()
    }
  })

  it('carries a LAN participant over the dedicated collaboration WebSocket', async () => {
    const gatewayHost = selectPrivateIPv4()
    if (gatewayHost === undefined) return
    const file = await fileAccessFixture()
    const upstreamServer = createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'set-cookie': 'dsh-owner=owner-value; HttpOnly' })
      response.end('<!doctype html><html data-workbench-document="v1"><head></head><body>workbench</body></html>')
    })
    const upstream = await listen(upstreamServer)
    const manager = createWorkbenchShareSessionManager({ randomToken: () => `s-${'y'.repeat(42)}` })
    const collaboration = createWorkbenchCollaborationManager({ loadSeed: workbenchId => file.access.collaborationSeed(workbenchId) })
    const gateway = await createWorkbenchShareGateway({
      access: file.access, collaboration, upstreamOrigin: `http://127.0.0.1:${String(upstream.port)}`, manager,
      networkInterfaces: { WLAN: [{ address: gatewayHost, family: 'IPv4', internal: false }] },
      prepareView: async () => ({ windowId: 'window-lan', url: `http://127.0.0.1:${String(upstream.port)}/workbench?workbench=${'t'.repeat(43)}&token=launch`, expiresAt: Date.now() + 10_000 }),
      redeemView: async () => ({ schemaVersion: 1, windowId: 'window-lan', workbenchId: 'workbench-a', mode: 'browser-workbench', closeToken: `close-${'z'.repeat(40)}` }),
      closeView: async () => {},
    })
    try {
      const started = await gateway.startShare('workbench-a')
      const link = await fetch(started.url, { redirect: 'manual' })
      const shareCookie = link.headers.get('set-cookie')?.split(';', 1)[0]
      expect(shareCookie).toMatch(/^dsh-workbench-share=/u)
      const document = await fetch(`http://${gateway.host}:${String(gateway.port)}/workbench`, { headers: { cookie: shareCookie! } })
      expect(document.status, await document.clone().text()).toBe(200)
      const ws = new WebSocket(`ws://${gateway.host}:${String(gateway.port)}/api/workbench-collaboration`, { headers: { cookie: shareCookie! } })
      const frames: any[] = [], waiters: ((frame: any) => void)[] = []
      ws.on('message', bytes => { const frame = JSON.parse(bytes.toString()); frames.push(frame); waiters.shift()?.(frame) })
      const next = () => frames.length > 0 ? Promise.resolve(frames.shift()) : new Promise<any>(resolve => waiters.push(resolve))
      await new Promise<void>((resolve, reject) => { ws.once('open', () => resolve()); ws.once('error', reject) })
      const collaborationId = collaboration.get('workbench-a')?.snapshot().collaborationId
      const leaseId = manager.getSnapshot()[0]?.guests?.[0]?.leaseId
      if (!leaseId) throw new Error('guest lease missing')
      ws.send(JSON.stringify({ type: 'client.hello', payload: { schemaVersion: 1, collaborationId, workbenchId: 'workbench-a', participantId: leaseId } }))
      const snapshot = await nextOfType(next, 'server.snapshot')
      expect(snapshot.payload.workbenchId).toBe('workbench-a')
      ws.close()
    } finally {
      await gateway.close(); await collaboration.dispose(); await upstream.close(); await file.dispose()
    }
  })
})

async function nextOfType(next: () => Promise<any>, type: string): Promise<any> {
  for (;;) { const frame = await next(); if (frame.type === type) return frame }
}
