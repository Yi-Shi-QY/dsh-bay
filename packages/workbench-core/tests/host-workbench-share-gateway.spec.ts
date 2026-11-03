import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { describe, expect, it } from 'vitest'
import { createWorkbenchShareGateway, selectPrivateIPv4 } from '../src/host-workbench-share-gateway.ts'
import { createWorkbenchShareSessionManager } from '../src/host-workbench-share-session.ts'

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
    const upstream = await listen(createServer(async (request: IncomingMessage, response: ServerResponse) => {
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
    }))
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
      expect(document.status).toBe(200)
      expect(document.headers.get('set-cookie')).toBeNull()
      const html = await document.text()
      expect(html).toContain('__WORKBENCH_WINDOW_VIEW__')
      expect(html).toContain('history.replaceState(null,"","/workbench")')
      const proxied = await fetch(`http://${gateway.host}:${String(gateway.port)}/api/echo`, { method: 'POST', headers: { cookie: shareCookie!, 'content-type': 'text/plain' }, body: 'ok' })
      expect(proxied.status).toBe(200)
      expect(await proxied.text()).toBe('ok')
      expect(seenOwnerCookie).toBe('dsh-owner=owner-value')
      const redirect = await fetch(`http://${gateway.host}:${String(gateway.port)}/api/redirect`, { redirect: 'manual', headers: { cookie: shareCookie! } })
      expect(redirect.status).toBe(302)
      expect(redirect.headers.get('location')).toBe(`http://${gateway.host}:${String(gateway.port)}/workbench?keep=1`)
      const activeLifecycle = await fetch(`http://${gateway.host}:${String(gateway.port)}/api/workbench-share/lifecycle`, { headers: { cookie: shareCookie! } })
      expect(activeLifecycle.status).toBe(200)
      expect(await activeLifecycle.json()).toMatchObject({ state: 'active', workbenchId: 'workbench-a' })
      await gateway.stopShare('workbench-a')
      expect((await fetch(`http://${gateway.host}:${String(gateway.port)}/workbench`, { headers: { cookie: shareCookie! } })).status).toBe(401)
      const stoppedLifecycle = await fetch(`http://${gateway.host}:${String(gateway.port)}/api/workbench-share/lifecycle`, { headers: { cookie: shareCookie! } })
      expect(stoppedLifecycle.status).toBe(410)
      expect(stoppedLifecycle.headers.get('x-dsh-share-state')).toBe('stopped')
      expect(await stoppedLifecycle.json()).toEqual({ code: 'workbench-share-stopped', state: 'stopped' })
    } finally {
      await gateway.close()
      await upstream.close()
    }
  })
})
