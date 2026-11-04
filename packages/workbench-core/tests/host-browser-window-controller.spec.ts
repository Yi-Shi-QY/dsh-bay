import { describe, expect, it, vi } from 'vitest'
import { createHostBrowserWindowController, createWorkbenchDocumentHandler, externalBrowserLaunchSpec, installWorkbenchBrowserWindowController } from '../src/host-browser-window-controller.ts'

function setup(now = () => 1_000) {
  const controller = createHostBrowserWindowController({
    origin: 'http://127.0.0.1:4200',
    authenticatedUrl: url => { const target = new URL(url); target.searchParams.set('token', 'dsh-test-token'); return target.href },
    lookupWorkbench: id => id === 'workbench-a',
    now,
  })
  return controller
}

function value<T>(result: { ok: boolean; value?: unknown }): T {
  if (!result.ok) throw new Error('Expected successful Host response')
  return result.value as T
}

describe('Host browser Workbench window controller', () => {
  it('passes the complete Windows URL to the OS handler without cmd query parsing', () => {
    const url = 'http://127.0.0.1:65489/workbench?workbench=workbench-ticket&token=dsh-launch-token'
    expect(externalBrowserLaunchSpec(url, 'win32')).toEqual({
      file: 'rundll32.exe',
      args: ['url.dll,FileProtocolHandler', url],
    })
    expect(externalBrowserLaunchSpec(url, 'win32').file).not.toBe('cmd.exe')
  })

  it('authenticates the dedicated document, preserves DSH index injections, and returns only the Workbench document marker', async () => {
    const authorizeIndex = vi.fn((request: { method: string; url: string; headers: { cookie?: string } }, response: {
      writeHead(status: number, headers?: Record<string, string>): unknown
      end(body?: string): unknown
    }) => {
      const requestUrl = new URL(request.url, 'http://dsh.invalid')
      if (requestUrl.searchParams.has('token') && request.method === 'GET') {
        response.writeHead(303, { location: './', 'set-cookie': 'dsh-session=verified; HttpOnly' })
        response.end()
        return false
      }
      if (request.headers.cookie === 'dsh-session=verified') return true
      response.writeHead(401, { 'cache-control': 'no-store' })
      response.end('Unauthorized')
      return false
    })
    const renderIndex = vi.fn((html: string) => html.replace('</head>', '<script data-dsh-startup-injection></script></head>'))
    const handler = createWorkbenchDocumentHandler(
      { authorizeIndex } as never,
      { renderIndex } as never,
      async () => '<!doctype html><html><head><title>DeepSeek Harness</title></head><body><div id="root"></div></body></html>',
    )
    const invoke = async (url: string, options: { method?: string; cookie?: string; tokenRequest?: boolean } = {}) => {
      let status = 0
      let headers: Record<string, string> = {}
      let body = ''
      await handler({
        method: options.method ?? 'GET',
        url,
        headers: { host: '127.0.0.1:4200', ...(options.cookie === undefined ? {} : { cookie: options.cookie }) },
      } as never, {
        writeHead(code: number, values?: Record<string, string>) { status = code; headers = values ?? {}; return this },
        end(value?: string) { body = value ?? ''; return this },
      } as never)
      return { status, headers, body }
    }

    const invalid = await invoke(`/workbench?token=launch&workbench=${'A'.repeat(43)}&extra=1`)
    expect(invalid.status).toBe(400)
    expect(authorizeIndex).not.toHaveBeenCalled()

    const exchange = await invoke(`/workbench?token=launch&workbench=${'A'.repeat(43)}`)
    expect(exchange.status).toBe(200)
    expect(exchange.headers['set-cookie']).toContain('dsh-session=verified')
    expect(exchange.body).toContain('history.replaceState')
    expect(exchange.body).toMatch(/<head(?:\s[^>]*)?><script>history\.replaceState\(/i)
    expect(exchange.body).not.toContain('<head<script>')

    const document = await invoke(`/workbench?workbench=${'A'.repeat(43)}`, { cookie: 'dsh-session=verified' })
    expect(document.status).toBe(200)
    expect(document.headers['cache-control']).toBe('no-store')
    expect(document.body).toContain('<html data-workbench-document="v1">')
    expect(document.body).toContain('<title>Workbench</title>')
    expect(document.body).toContain('data-dsh-startup-injection')
    expect(renderIndex).toHaveBeenCalledTimes(2)

    const unauthorized = await invoke(`/workbench?workbench=${'A'.repeat(43)}`)
    expect(unauthorized.status).toBe(401)
    expect(unauthorized.body).toBe('Unauthorized')
    const unsupportedMethod = await invoke('/workbench', { method: 'POST' })
    expect(unsupportedMethod.status).toBe(405)
  })

  it('redeems a one-time view ticket and accepts a single close receipt', async () => {
    const controller = setup()
    const prepared = value<{ status: string; windowId: string; url: string }>(await controller.handle('prepare', { workbenchId: 'workbench-a' }))
    const target = new URL(prepared.url)
    const ticket = target.searchParams.get('workbench')
    expect(target.searchParams.get('token')).toBe('dsh-test-token')
    expect(ticket).toMatch(/^[A-Za-z0-9_-]{40,64}$/u)

    const redeemed = value<{ status: string; view: { windowId: string; workbenchId: string; closeToken: string } }>(
      await controller.handle('redeem', { ticket }),
    )
    expect(redeemed).toMatchObject({ status: 'redeemed', view: { windowId: prepared.windowId, workbenchId: 'workbench-a' } })
    expect(redeemed.view.closeToken).toMatch(/^[A-Za-z0-9_-]{40,64}$/u)
    expect((await controller.handle('redeem', { ticket })).ok).toBe(false)

    expect((await controller.handle('closed', { closeToken: 'wrong-token' })).ok).toBe(false)
    const closed = value<{ status: string }>(await controller.handle('closed', { closeToken: redeemed.view.closeToken }))
    expect(closed).toEqual({ status: 'closed' })
    expect((await controller.handle('closed', { closeToken: redeemed.view.closeToken })).ok).toBe(false)
    expect(value(await controller.handle('status', { windowId: prepared.windowId }))).toEqual({ status: 'closed' })
    controller.dispose()
  })

  it('uses browser heartbeats for liveness and never treats DSH status polling as a heartbeat', async () => {
    let now = 1_000
    const controller = setup(() => now)
    const prepared = value<{ windowId: string; url: string }>(await controller.handle('prepare', { workbenchId: 'workbench-a' }))
    const ticket = new URL(prepared.url).searchParams.get('workbench')!
    const redeemed = value<{ view: { windowId: string; closeToken: string } }>(await controller.handle('redeem', { ticket }))
    await controller.handle('ready', { windowId: prepared.windowId })
    now += 60 * 60_000
    expect(value(await controller.handle('status', { windowId: prepared.windowId })))
      .toEqual({ status: 'failed', code: 'browser-view-heartbeat-timeout' })
    expect(value(await controller.handle('heartbeat', { windowId: prepared.windowId }))).toEqual({ status: 'ready' })
    now += 60 * 60_000
    expect(value(await controller.handle('heartbeat', { windowId: prepared.windowId }))).toEqual({ status: 'ready' })
    expect(value(await controller.handle('status', { windowId: prepared.windowId }))).toEqual({ status: 'ready' })
    expect(value(await controller.handle('closed', { closeToken: redeemed.view.closeToken }))).toEqual({ status: 'closed' })
    controller.dispose()
  })

  it('requires the browser view to acknowledge an explicit reclaim request', async () => {
    const controller = setup()
    const prepared = value<{ windowId: string; url: string }>(await controller.handle('prepare', { workbenchId: 'workbench-a' }))
    const ticket = new URL(prepared.url).searchParams.get('workbench')!
    const redeemed = value<{ view: { closeToken: string } }>(await controller.handle('redeem', { ticket }))
    await controller.handle('ready', { windowId: prepared.windowId })

    expect(value(await controller.handle('reclaim', { windowId: prepared.windowId })))
      .toEqual({ status: 'reclaim-requested' })
    expect(value(await controller.handle('heartbeat', { windowId: prepared.windowId })))
      .toEqual({ status: 'reclaim-requested' })
    expect(value(await controller.handle('status', { windowId: prepared.windowId })))
      .toEqual({ status: 'reclaim-requested' })
    expect((await controller.handle('reclaimed', { closeToken: 'wrong-token' })).ok).toBe(false)
    expect(value(await controller.handle('reclaimed', { closeToken: redeemed.view.closeToken })))
      .toEqual({ status: 'reclaimed' })
    expect(value(await controller.handle('status', { windowId: prepared.windowId })))
      .toEqual({ status: 'reclaimed' })
    expect((await controller.handle('reclaimed', { closeToken: redeemed.view.closeToken })).ok).toBe(true)
    controller.dispose()
  })

  it('fails closed for non-loopback origins, unknown workbenches, and malformed close receipts', async () => {
    const nonLoopback = createHostBrowserWindowController({ origin: 'http://192.168.0.5:4200',
      authenticatedUrl: url => `${url}?token=x`, lookupWorkbench: () => true })
    expect(await nonLoopback.handle('prepare', { workbenchId: 'workbench-a' })).toMatchObject({ ok: false })
    expect(await nonLoopback.handle('prepare', { workbenchId: 'missing' })).toMatchObject({ ok: false })
    expect(await nonLoopback.handle('closed', { windowId: '00000000-0000-4000-8000-000000000000' })).toMatchObject({ ok: false })
    nonLoopback.dispose()
  })

  it('launches a prepared URL through the Host fallback when the Electron renderer blocks popups', async () => {
    const openExternalBrowser = vi.fn(() => true)
    const controller = createHostBrowserWindowController({
      origin: 'http://127.0.0.1:4200',
      authenticatedUrl: url => { const target = new URL(url); target.searchParams.set('token', 'dsh-test-token'); return target.href },
      lookupWorkbench: id => id === 'workbench-a',
      openExternalBrowser,
    })
    const prepared = value<{ windowId: string; url: string }>(await controller.handle('prepare', { workbenchId: 'workbench-a' }))
    expect(value(await controller.handle('launch', { windowId: prepared.windowId }))).toEqual({ status: 'launched' })
    expect(openExternalBrowser).toHaveBeenCalledWith(prepared.url)
    const ticket = new URL(prepared.url).searchParams.get('workbench')!
    const redeemed = value<{ status: string }>(await controller.handle('redeem', { ticket }))
    expect(redeemed).toMatchObject({ status: 'redeemed' })
    expect(value(await controller.handle('opened', { windowId: prepared.windowId }))).toEqual({ status: 'redeemed' })
    expect(value(await controller.handle('ready', { windowId: prepared.windowId }))).toEqual({ status: 'ready' })
    controller.dispose()
  })

  it('accepts browser ticket redemption before the external launch promise resolves', async () => {
    let resolveLaunch: ((value: boolean) => void) | undefined
    const openExternalBrowser = vi.fn(() => new Promise<boolean>(resolve => { resolveLaunch = resolve }))
    const controller = createHostBrowserWindowController({
      origin: 'http://127.0.0.1:4200',
      authenticatedUrl: url => { const target = new URL(url); target.searchParams.set('token', 'dsh-test-token'); return target.href },
      lookupWorkbench: id => id === 'workbench-a',
      openExternalBrowser,
    })
    const prepared = value<{ windowId: string; url: string }>(await controller.handle('prepare', { workbenchId: 'workbench-a' }))
    const launch = controller.handle('launch', { windowId: prepared.windowId })
    const ticket = new URL(prepared.url).searchParams.get('workbench')!
    expect(value(await controller.handle('redeem', { ticket }))).toMatchObject({
      status: 'redeemed',
      view: { windowId: prepared.windowId, workbenchId: 'workbench-a' },
    })
    resolveLaunch?.(true)
    expect(value(await launch)).toEqual({ status: 'launched' })
    controller.dispose()
  })

  it('allows one browser view per Workbench while keeping different Workbenches independent', async () => {
    const controller = createHostBrowserWindowController({
      origin: 'http://127.0.0.1:4200',
      authenticatedUrl: url => { const target = new URL(url); target.searchParams.set('token', 'dsh-test-token'); return target.href },
      lookupWorkbench: id => id === 'workbench-a' || id === 'workbench-b',
    })
    const first = value<{ status: string; windowId: string }>(await controller.handle('prepare', { workbenchId: 'workbench-a' }))
    const duplicate = value<{ status: string; windowId: string; workbenchId: string; state: string }>(await controller.handle('prepare', { workbenchId: 'workbench-a' }))
    expect(duplicate).toEqual({ status: 'already-open', windowId: first.windowId, workbenchId: 'workbench-a', state: 'prepared' })
    const other = value<{ status: string; windowId: string }>(await controller.handle('prepare', { workbenchId: 'workbench-b' }))
    expect(other.windowId).not.toBe(first.windowId)
    controller.dispose()
  })

  it('keeps shared guest views outside the owner active view lease', async () => {
    const controller = createHostBrowserWindowController({
      origin: 'http://127.0.0.1:4200',
      authenticatedUrl: url => { const target = new URL(url); target.searchParams.set('token', 'dsh-test-token'); return target.href },
      lookupWorkbench: id => id === 'workbench-a',
    })
    const owner = value<{ windowId: string }>(await controller.handle('prepare', { workbenchId: 'workbench-a' }))
    const guestOne = value<{ windowId: string; shared: boolean }>(await controller.handle('prepare-shared', { workbenchId: 'workbench-a' }))
    const guestTwo = value<{ windowId: string; shared: boolean }>(await controller.handle('prepare-shared', { workbenchId: 'workbench-a' }))
    expect(guestOne.shared).toBe(true)
    expect(guestTwo.shared).toBe(true)
    expect(new Set([owner.windowId, guestOne.windowId, guestTwo.windowId]).size).toBe(3)
    expect(value(await controller.handle('prepare', { workbenchId: 'workbench-a' }))).toMatchObject({ status: 'already-open', windowId: owner.windowId })
    controller.dispose()
  })

  it('registers a DSH Connection close route and releases every Host registration', async () => {
    let rpcHandler: ((endpoint: string, payload: unknown) => Promise<{ ok: boolean; value?: unknown }>) | undefined
    let closeRoute: { path: string; fetch(request: Request): Promise<Response> } | undefined
    const unregisterRpc = vi.fn(async () => {})
    const unregisterFetch = vi.fn(async () => {})
    const connection = {
      authenticatedUrl: (url: string) => { const target = new URL(url); target.searchParams.set('token', 'test'); return target.href },
      rpc: {
        handle: vi.fn((_channel: string, handler: typeof rpcHandler) => { rpcHandler = handler; return unregisterRpc }),
        intercept: vi.fn((_channel: string, _matches: unknown, handler: typeof rpcHandler) => { rpcHandler = handler; return unregisterRpc }),
      },
      fetch: { register: vi.fn((route: typeof closeRoute) => { closeRoute = route; return unregisterFetch }) },
    }
    const context = {
      get: (name: string) => name === 'connection' ? connection
        : name === 'webServer' ? { getOrigin: () => 'http://127.0.0.1:4200' }
          : name === 'settings' ? { describe: () => [{ ns: 'workbench-layout', value: { workbenches: { 'workbench-a': {} } } }] }
            : undefined,
    }
    const dispose = installWorkbenchBrowserWindowController(context as never)
    expect(closeRoute?.path).toBe('/api/workbench-window-close')
    const prepared = value<{ url: string }>(await rpcHandler!('workbench-window/prepare', { workbenchId: 'workbench-a' }))
    const ticket = new URL(prepared.url).searchParams.get('workbench')!
    const redeemed = value<{ view: { closeToken: string } }>(await rpcHandler!('workbench-window/redeem', { ticket }))
    const response = await closeRoute!.fetch(new Request('http://127.0.0.1:4200/api/workbench-window-close', {
      method: 'POST', headers: { 'content-type': 'text/plain;charset=UTF-8' },
      body: JSON.stringify({ closeToken: redeemed.view.closeToken }),
    }))
    expect(response.status).toBe(204)
    await dispose?.()
    expect(unregisterRpc).toHaveBeenCalledOnce()
    expect(unregisterFetch).toHaveBeenCalledTimes(7)
  })

  it('registers desktop WebServer RPC routes with Connection response envelopes', async () => {
    let rpcHandler: ((endpoint: string, payload: unknown) => Promise<{ ok: boolean; value?: unknown }>) | undefined
    const desktopRoutes: Array<{ path: string; handler(request: unknown, response: unknown): Promise<void> }> = []
    const connection = {
      authenticatedUrl: (url: string) => { const target = new URL(url); target.searchParams.set('token', 'test-token'); return target.href },
      rpc: {
        handle: vi.fn((_channel: string, handler: typeof rpcHandler) => { rpcHandler = handler; return vi.fn(async () => {}) }),
        intercept: vi.fn((_channel: string, _matches: unknown, handler: typeof rpcHandler) => { rpcHandler = handler; return vi.fn(async () => {}) }),
      },
      fetch: { register: vi.fn(() => vi.fn(async () => {})) },
    }
    const context = {
      get: (name: string) => name === 'connection' ? connection
        : name === 'webServer' ? {
          getOrigin: () => 'http://127.0.0.1:4200',
          register: (route: typeof desktopRoutes[number]) => { desktopRoutes.push(route); return vi.fn() },
        }
          : name === 'settings' ? { describe: () => [{ ns: 'workbench-layout', value: { workbenches: { 'workbench-a': {} } } }] }
            : undefined,
    }
    const dispose = installWorkbenchBrowserWindowController(context as never)
    const route = desktopRoutes.find(row => row.path === '/api/workbench-window/prepare')
    expect(route).toBeDefined()
    expect(connection.rpc.intercept).not.toHaveBeenCalled()
    let status = 0
    let body = ''
    await route!.handler({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      async *[Symbol.asyncIterator]() {
        yield Buffer.from(JSON.stringify({ type: 'client-request', rpcId: 'rpc-1', method: 'workbench-window/prepare', payload: { workbenchId: 'workbench-a' } }))
      },
    }, {
      writeHead(code: number) { status = code },
      end(value?: string) { body = value ?? '' },
    })
    expect(status).toBe(200)
    expect(JSON.parse(body)).toMatchObject({ type: 'server-response', rpcId: 'rpc-1', result: { ok: true, value: { status: 'prepared' } } })
    dispose?.()
  })
})
