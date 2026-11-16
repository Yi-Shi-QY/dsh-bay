// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { fileAccessFixture } from './helpers/file-access.ts'
import { createHostBrowserWindowController } from '../src/host-browser-window-controller.ts'
import { createBrowserWindowController } from '../src/client/browser-window-controller.ts'
import { resolveBrowserWorkbenchView, reportBrowserWorkbenchReady, reportBrowserWorkbenchClosed, startBrowserWorkbenchHeartbeat } from '../src/client/resolve-browser-window-view.ts'

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); window.sessionStorage.clear(); delete (window as unknown as Record<string, unknown>).__WORKBENCH_WINDOW_VIEW__ })

it.each(['automatic', 'manual-before-grace', 'manual-after-grace', 'manual-during-restore'] as const)('restores a closed browser page through the full desktop path: %s', async path => {
  const f = await fileAccessFixture()
  vi.useFakeTimers()
  let hostNow = Date.now()
  const host = createHostBrowserWindowController({ origin: 'http://127.0.0.1:4200', access: f.access, now: () => hostNow,
    lookupWorkbench: id => f.access.lookup(id), authenticatedUrl: url => url + '&token=test' })
  const rpc = { call: vi.fn(async (_channel: string, endpoint: string, payload: unknown) => host.handle(endpoint.replace('workbench-window/', ''), payload)) }
  let finishRestore!: () => void
  const restoreDesktop = vi.fn(async () => { if (path === 'manual-during-restore') await new Promise<void>(resolve => { finishRestore = resolve }) })
  const desktop = createBrowserWindowController({ rpc: rpc as never, restoreDesktop })
  try {
    let browserUrl = ''
    await desktop.prepare('workbench-a')
    await desktop.open('workbench-a', { location: { replace(url: string) { browserUrl = url } } } as never)
    const redeemed = await host.handle('redeem', { ticket: new URL(browserUrl).searchParams.get('workbench') })
    if (!redeemed.ok) throw new Error('redeem failed')
    ;(window as unknown as Record<string, unknown>).__WORKBENCH_WINDOW_VIEW__ = (redeemed.value as { view: unknown }).view
    const context = { connection: { rpc } }, browser = await resolveBrowserWorkbenchView(context as never)
    if (browser.status !== 'ready') throw new Error('browser identity failed')
    await reportBrowserWorkbenchReady(context as never, browser.view)
    await vi.advanceTimersByTimeAsync(800)
    let beacon: Blob | undefined
    Object.defineProperty(navigator, 'sendBeacon', { configurable: true, value: vi.fn((_url: string, body: Blob) => { beacon = body; return true }) })
    reportBrowserWorkbenchClosed(context as never, browser.view)
    const { action, ...payload } = JSON.parse(await beacon!.text())
    expect(await host.handle(action, payload)).toMatchObject({ ok: true })
    // No browser heartbeats or receipt replies exist after closing this page.
    const pending = path === 'manual-before-grace' ? desktop.reclaim!('workbench-a') : undefined
    hostNow += 10_001
    if (path === 'manual-after-grace') expect(await desktop.reclaim!('workbench-a')).toEqual({ status: 'reclaimed' })
    await vi.advanceTimersByTimeAsync(2_000)
    if (path === 'manual-during-restore') {
      const joining = desktop.reclaim!('workbench-a')
      finishRestore()
      await vi.advanceTimersByTimeAsync(0)
      expect(await joining).toEqual({ status: 'reclaimed' })
    }
    if (pending) expect(await pending).toEqual({ status: 'reclaimed' })
    expect(restoreDesktop).toHaveBeenCalledOnce()
    expect(desktop.getSnapshot().request).toMatchObject({ status: 'reclaimed', reclaimProgress: { phase: 'checking' } })
    expect(f.access.controller('workbench-a')).toBe('desktop')
    hostNow += 15_000
    expect(await host.handle('status', { windowId: browser.view.windowId })).toMatchObject({ ok: true, value: { status: path === 'automatic' || path === 'manual-during-restore' ? 'closed' : 'reclaimed' } })
    expect(await host.handle('attach', payload)).toMatchObject({ ok: false })
    expect(rpc.call.mock.calls.filter(call => call[1].endsWith('/reclaim')).every(call => !(call[2] as { force?: boolean }).force)).toBe(true)
  } finally { desktop.dispose(); host.dispose(); vi.useRealTimers(); await f.dispose() }
})

it('hands a real file workbench back immediately, reports saved phases, and waits for desktop restoration', async () => {
  const f = await fileAccessFixture()
  vi.useFakeTimers()
  const host = createHostBrowserWindowController({ origin: 'http://127.0.0.1:4200', access: f.access,
    lookupWorkbench: id => f.access.lookup(id), authenticatedUrl: url => url + '&token=test' })
  const rpc = { call: vi.fn(async (_channel: string, endpoint: string, payload: unknown) => host.handle(endpoint.replace('workbench-window/', ''), payload)) }
  let saved!: (ok: boolean) => void, restore!: () => void
  const restoreDesktop = vi.fn(() => new Promise<void>(resolve => { restore = resolve }))
  const desktop = createBrowserWindowController({ rpc: rpc as never, restoreDesktop })
  let browserUrl = ''
  await desktop.prepare('workbench-a')
  await desktop.open('workbench-a', { location: { replace(url: string) { browserUrl = url } } } as never)
  const redeem = await host.handle('redeem', { ticket: new URL(browserUrl).searchParams.get('workbench') })
  if (!redeem.ok) throw new Error('redeem failed')
  ;(window as unknown as Record<string, unknown>).__WORKBENCH_WINDOW_VIEW__ = (redeem.value as { view: unknown }).view
  const ctx = { connection: { rpc } }
  const result = await resolveBrowserWorkbenchView(ctx as never)
  if (result.status !== 'ready') throw new Error('browser identity failed')
  await reportBrowserWorkbenchReady(ctx as never, result.view)
  await vi.advanceTimersByTimeAsync(800)
  const onFlush = (event: Event) => { saved = (event as CustomEvent<{ complete(ok: boolean): void }>).detail.complete }
  window.addEventListener('workbench-browser-reclaim-flush', onFlush)
  const stop = startBrowserWorkbenchHeartbeat(ctx as never, result.view)
  try {
    const reclaim = desktop.reclaim!('workbench-a')
    const duplicate = desktop.reclaim!('workbench-a')
    expect(duplicate).toBe(reclaim)
    await vi.advanceTimersByTimeAsync(0)
    expect(saved).toBeTypeOf('function') // watch wakes before the 15-second heartbeat
    await vi.advanceTimersByTimeAsync(2000)
    expect(desktop.getSnapshot().request?.reclaimProgress?.phase).toBe('saving')
    saved(true)
    await vi.advanceTimersByTimeAsync(2000)
    expect(restoreDesktop).toHaveBeenCalledOnce()
    expect(desktop.getSnapshot().request?.reclaimProgress?.phase).toBe('restoring')
    restore()
    await vi.advanceTimersByTimeAsync(0)
    expect(await reclaim).toEqual({ status: 'reclaimed' })
    expect(desktop.getSnapshot().request?.reclaimProgress?.phase).toBe('checking')
    desktop.desktopRestored!('workbench-a', 'old-window')
    expect(desktop.getSnapshot().request?.reclaimProgress?.phase).toBe('checking')
    desktop.desktopRestored!('workbench-a', result.view.windowId)
    expect(desktop.getSnapshot().request?.reclaimProgress?.phase).toBe('complete')
    expect(rpc.call.mock.calls.filter(call => call[1].endsWith('/reclaim'))).toHaveLength(1)
  } finally { stop(); window.removeEventListener('workbench-browser-reclaim-flush', onFlush); desktop.dispose(); host.dispose(); vi.useRealTimers(); await f.dispose() }
})

it('keeps ordinary retries non-forcing and retains the explicit-force warning after recovery', async () => {
  vi.useFakeTimers()
  const host = createHostBrowserWindowController({ origin: 'http://127.0.0.1:4200', lookupWorkbench: () => true, authenticatedUrl: url => url + '&token=test' })
  const rpc = { call: vi.fn(async (_channel: string, endpoint: string, payload: unknown) => host.handle(endpoint.replace('workbench-window/', ''), payload)) }
  const desktop = createBrowserWindowController({ rpc: rpc as never })
  let browserUrl = ''
  await desktop.prepare('a'); await desktop.open('a', { location: { replace(url: string) { browserUrl = url } } } as never)
  const result = await host.handle('redeem', { ticket: new URL(browserUrl).searchParams.get('workbench') })
  if (!result.ok) throw new Error('redeem failed')
  const { windowId } = (result.value as { view: { windowId: string } }).view
  await host.handle('ready', { windowId }); await vi.advanceTimersByTimeAsync(800)
  try {
    const first = desktop.reclaim!('a'); await vi.advanceTimersByTimeAsync(30_000); expect((await first).status).toBe('failed')
    const retry = desktop.reclaim!('a'); await vi.advanceTimersByTimeAsync(30_000); expect((await retry).status).toBe('failed')
    expect(rpc.call.mock.calls.filter(call => call[1].endsWith('/reclaim')).map(call => call[2])).toEqual([{ windowId }, { windowId }])
    expect(await desktop.reclaim!('a', { force: true })).toEqual({ status: 'reclaimed' })
    desktop.desktopRestored!('a', windowId)
    expect(desktop.getSnapshot().request?.reclaimProgress).toEqual({ phase: 'complete', forced: true })
  } finally { desktop.dispose(); host.dispose() }
})
