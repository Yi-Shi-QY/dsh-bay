// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { hasBrowserWorkbenchIntent, reportBrowserWorkbenchClosed, reportBrowserWorkbenchReady, requestBrowserWorkbenchReclaim, resolveBrowserWorkbenchView, startBrowserWorkbenchHeartbeat } from '../src/client/resolve-browser-window-view.ts'
import { createHostBrowserWindowController } from '../src/host-browser-window-controller.ts'

afterEach(() => {
  vi.useRealTimers()
  window.sessionStorage.clear()
  ;(window as unknown as { __WORKBENCH_WINDOW_VIEW__?: unknown }).__WORKBENCH_WINDOW_VIEW__ = undefined
  vi.restoreAllMocks()
})

describe('browser Workbench view lifecycle', () => {
  it('redeems the dedicated document query before render, stores the close receipt, and reports it on page close', async () => {
    const ticket = 'A'.repeat(43)
    const closeToken = 'B'.repeat(43)
    window.history.replaceState(null, '', `/workbench?workbench=${ticket}`)
    const rpc = { call: vi.fn(async (_channel: string, endpoint: string) => endpoint === 'workbench-window/redeem'
      ? { ok: true, value: { status: 'redeemed', view: {
        schemaVersion: 1, windowId: '00000000-0000-4000-8000-000000000000', workbenchId: 'workbench-a', mode: 'browser-workbench', closeToken,
      } } } : { ok: true, value: { status: 'ready' } }) }
    const context = { connection: { rpc } }
    const resolved = await resolveBrowserWorkbenchView(context as never)
    expect(resolved).toMatchObject({ status: 'ready', view: { workbenchId: 'workbench-a', closeToken } })
    if (resolved.status !== 'ready') throw new Error('expected ready browser view')
    expect(window.location.pathname).toBe('/workbench')
    expect(window.location.search).toBe('')
    expect(window.sessionStorage.getItem('dsh-workbench.browser-view.v1')).toContain(closeToken)

    const sendBeacon = vi.fn(() => true)
    Object.defineProperty(navigator, 'sendBeacon', { configurable: true, value: sendBeacon })
    reportBrowserWorkbenchClosed(context as never, resolved.view)
    expect(sendBeacon).toHaveBeenCalledOnce()
    expect(sendBeacon.mock.calls[0]?.[0]).toBe('/api/workbench-window-close')
    const body = sendBeacon.mock.calls[0]?.[1] as Blob
    expect(JSON.parse(await body.text())).toEqual({ closeToken })
  })

  it('recognizes a handoff before asynchronous validation and fails closed when redemption fails', async () => {
    const ticket = 'C'.repeat(43)
    window.history.replaceState(null, '', `/workbench?workbench=${ticket}`)
    expect(hasBrowserWorkbenchIntent()).toBe(true)
    const rpc = { call: vi.fn(async () => ({ ok: false, error: { code: 'ticket-unknown-or-replayed' } })) }

    expect(await resolveBrowserWorkbenchView({ connection: { rpc } } as never)).toEqual({
      status: 'failed', code: 'browser-view-ticket-rejected',
    })
    expect(window.location.search).toBe(`?workbench=${ticket}`)
  })

  it('treats a valid handoff without a ready Connection as a failed browser view, not a normal DSH page', async () => {
    window.history.replaceState(null, '', `/workbench?workbench=${'D'.repeat(43)}`)
    expect(hasBrowserWorkbenchIntent()).toBe(true)
    expect(await resolveBrowserWorkbenchView({} as never)).toEqual({
      status: 'failed', code: 'browser-view-connection-unavailable',
    })
  })

  it('returns none only when no browser handoff marker exists', async () => {
    window.history.replaceState(null, '', '/')
    expect(hasBrowserWorkbenchIntent()).toBe(false)
    expect(await resolveBrowserWorkbenchView({} as never)).toEqual({ status: 'none' })
  })

  it('sends browser liveness heartbeats and stops them when the view is disposed', async () => {
    vi.useFakeTimers()
    const rpc = { call: vi.fn(async () => ({ ok: true, value: { status: 'ready' } })) }
    const stop = startBrowserWorkbenchHeartbeat({ connection: { rpc } } as never, {
      schemaVersion: 1, windowId: '00000000-0000-4000-8000-000000000000', workbenchId: 'workbench-a', mode: 'browser-workbench', closeToken: 'B'.repeat(43),
    })
    await vi.advanceTimersByTimeAsync(15_000)
    expect(rpc.call).toHaveBeenCalledOnce()
    expect(rpc.call).toHaveBeenCalledWith('/api', 'workbench-window/heartbeat', {
      windowId: '00000000-0000-4000-8000-000000000000',
    }, expect.any(AbortSignal))
    stop()
    await vi.advanceTimersByTimeAsync(30_000)
    expect(rpc.call).toHaveBeenCalledOnce()
    vi.useRealTimers()
  })

  it('locks the browser view, flushes layout and acknowledges reclaim from the host', async () => {
    vi.useFakeTimers()
    const view = {
      schemaVersion: 1 as const, windowId: '00000000-0000-4000-8000-000000000000', mode: 'browser-workbench' as const,
      workbenchId: 'workbench-a', closeToken: 'B'.repeat(43),
    }
    const states: string[] = []
    const rpc = { call: vi.fn(async (_channel: string, endpoint: string) => endpoint === 'workbench-window/heartbeat'
      ? { ok: true, value: { status: 'reclaim-requested' } }
      : { ok: true, value: { status: 'reclaimed' } }) }
    const onFlush = (event: Event) => (event as CustomEvent<{ complete: (ok: boolean) => void }>).detail.complete(true)
    window.addEventListener('workbench-browser-reclaim-flush', onFlush)
    const stop = startBrowserWorkbenchHeartbeat({ connection: { rpc } } as never, view, state => states.push(state))
    await vi.advanceTimersByTimeAsync(15_000)
    await vi.advanceTimersByTimeAsync(0)
    expect(states).toEqual(['requested', 'reclaimed'])
    expect(rpc.call.mock.calls.map(call => call[1])).toEqual(['workbench-window/heartbeat', 'workbench-window/reclaimed'])
    expect(window.sessionStorage.getItem('dsh-workbench.browser-view.v1')).toBeNull()
    stop()
    window.removeEventListener('workbench-browser-reclaim-flush', onFlush)
    vi.useRealTimers()
  })

  it('lets the browser view request reclaim by its verified window identity and wakes heartbeat immediately', async () => {
    vi.useFakeTimers()
    const view = {
      schemaVersion: 1 as const, windowId: '00000000-0000-4000-8000-000000000000', mode: 'browser-workbench' as const,
      workbenchId: 'workbench-a', closeToken: 'B'.repeat(43),
    }
    const calls: Array<{ endpoint: string; payload: unknown }> = []
    const rpc = { call: vi.fn(async (_channel: string, endpoint: string, payload: unknown) => {
      calls.push({ endpoint, payload })
      if (endpoint === 'workbench-window/reclaim') return { ok: true, value: { status: 'reclaim-requested' } }
      if (endpoint === 'workbench-window/heartbeat') return { ok: true, value: { status: 'reclaim-requested' } }
      if (endpoint === 'workbench-window/reclaimed') return { ok: true, value: { status: 'reclaimed' } }
      return { ok: false, error: { code: 'unexpected-endpoint' } }
    }) }
    const states: string[] = []
    const onFlush = (event: Event) => (event as CustomEvent<{ complete: (ok: boolean) => void }>).detail.complete(true)
    window.addEventListener('workbench-browser-reclaim-flush', onFlush)
    const context = { connection: { rpc } }
    const stop = startBrowserWorkbenchHeartbeat(context as never, view, state => states.push(state))

    expect(await requestBrowserWorkbenchReclaim(context as never, view)).toBe(true)
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(0)
    expect(calls.map(call => call.endpoint)).toEqual([
      'workbench-window/reclaim', 'workbench-window/heartbeat', 'workbench-window/reclaimed',
    ])
    expect(calls[0]?.payload).toEqual({ windowId: view.windowId })
    expect(states).toEqual(['requested', 'reclaimed'])
    expect(window.sessionStorage.getItem('dsh-workbench.browser-view.v1')).toBeNull()

    stop()
    window.removeEventListener('workbench-browser-reclaim-flush', onFlush)
  })

  it('completes browser-button reclaim against the real Host state machine and reopens only after acknowledgement', async () => {
    vi.useFakeTimers()
    const host = createHostBrowserWindowController({
      origin: 'http://127.0.0.1:4200', authenticatedUrl: url => {
        const authenticated = new URL(url)
        authenticated.searchParams.set('token', 'short-lived-test-token')
        return authenticated.href
      }, lookupWorkbench: () => true,
    })
    const rpc = { call: vi.fn(async (_channel: string, endpoint: string, payload: unknown) => {
      const result = await host.handle(endpoint.replace('workbench-window/', ''), payload)
      return result
    }) }
    const context = { connection: { rpc } }
    const prepared = await host.handle('prepare', { workbenchId: 'workbench-a' })
    if (!prepared.ok) throw new Error('expected host view to be prepared')
    const ticket = new URL((prepared.value as { url: string }).url).searchParams.get('workbench')!
    const redeemed = await host.handle('redeem', { ticket })
    if (!redeemed.ok) throw new Error('expected browser view to be redeemed')
    const view = (redeemed.value as { view: {
      schemaVersion: 1; windowId: string; workbenchId: string; mode: 'browser-workbench'; closeToken: string
    } }).view
    await host.handle('ready', { windowId: view.windowId })

    const onFlush = (event: Event) => (event as CustomEvent<{ complete: (ok: boolean) => void }>).detail.complete(true)
    window.addEventListener('workbench-browser-reclaim-flush', onFlush)
    const stop = startBrowserWorkbenchHeartbeat(context as never, view)
    expect(await requestBrowserWorkbenchReclaim(context as never, view as never)).toBe(true)
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(0)
    expect(await host.handle('status', { windowId: view.windowId })).toEqual({ ok: true, value: { status: 'reclaimed' } })
    const next = await host.handle('prepare', { workbenchId: 'workbench-a' })
    expect(next.ok).toBe(true)
    if (!next.ok) throw new Error('expected reclaimed workbench to be available')
    expect((next.value as { status: string }).status).toBe('prepared')
    expect((next.value as { windowId: string }).windowId).not.toBe(view.windowId)

    stop()
    window.removeEventListener('workbench-browser-reclaim-flush', onFlush)
    host.dispose()
  })

  it('does not restore a browser view after the Host has reclaimed it', async () => {
    const view = {
      schemaVersion: 1, windowId: '00000000-0000-4000-8000-000000000000', mode: 'browser-workbench',
      workbenchId: 'workbench-a', closeToken: 'B'.repeat(43),
    }
    window.sessionStorage.setItem('dsh-workbench.browser-view.v1', JSON.stringify(view))
    const rpc = { call: vi.fn(async () => ({ ok: true, value: { status: 'reclaimed' } })) }
    expect(await resolveBrowserWorkbenchView({ connection: { rpc } } as never)).toMatchObject({ status: 'failed', code: 'browser-view-not-authorized' })
    expect(window.sessionStorage.getItem('dsh-workbench.browser-view.v1')).toBeNull()
  })

  it('restores a locked browser view after refresh while reclaim is pending', async () => {
    const view = {
      schemaVersion: 1, windowId: '00000000-0000-4000-8000-000000000000', mode: 'browser-workbench',
      workbenchId: 'workbench-a', closeToken: 'B'.repeat(43),
    }
    window.sessionStorage.setItem('dsh-workbench.browser-view.v1', JSON.stringify(view))
    const rpc = { call: vi.fn(async () => ({ ok: true, value: { status: 'reclaim-requested' } })) }
    const context = { connection: { rpc } }
    expect(await resolveBrowserWorkbenchView(context as never)).toMatchObject({ status: 'ready', view })
    expect(await reportBrowserWorkbenchReady(context as never, view as never)).toBe(true)
    expect(rpc.call.mock.calls.map(call => call[1])).toEqual(['workbench-window/status', 'workbench-window/status'])
    expect(window.sessionStorage.getItem('dsh-workbench.browser-view.v1')).not.toBeNull()
  })

  it('refuses to restore stale browser view records without a valid close token', async () => {
    window.history.replaceState(null, '', '/')
    ;(window as unknown as { __WORKBENCH_WINDOW_VIEW__?: unknown }).__WORKBENCH_WINDOW_VIEW__ = undefined
    window.sessionStorage.setItem('dsh-workbench.browser-view.v1', JSON.stringify({
      schemaVersion: 1, windowId: '00000000-0000-4000-8000-000000000000', workbenchId: 'workbench-a', mode: 'browser-workbench',
    }))
    expect(await resolveBrowserWorkbenchView({} as never)).toMatchObject({ status: 'failed', code: 'browser-view-record-invalid' })
  })
})
