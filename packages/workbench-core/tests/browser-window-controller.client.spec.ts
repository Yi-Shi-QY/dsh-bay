// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createBrowserWindowController } from '../src/client/browser-window-controller.ts'

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

describe('browser Workbench handoff controller', () => {
  it('can recover browser support when Connection RPC becomes available after initialization', async () => {
    const controller = createBrowserWindowController()
    expect(controller.getSnapshot().supported).toBe(false)

    const rpc = { call: vi.fn(async () => ({ ok: true, value: {
      status: 'prepared',
      windowId: '00000000-0000-4000-8000-000000000003',
      expiresAt: Date.now() + 60_000,
      url: `http://127.0.0.1:4200/workbench?token=dsh&workbench=${'T'.repeat(43)}`,
    } })) }
    controller.setRpc(rpc as never)

    expect(controller.getSnapshot().supported).toBe(true)
    expect(await controller.prepare('workbench-a')).toBe(true)
    expect(rpc.call).toHaveBeenCalledOnce()
    controller.dispose()
  })

  it('keeps the browser carrier available after a prepare failure so the menu can retry', async () => {
    const rpc = { call: vi.fn(async () => ({ ok: false, error: { code: 'workbench-unavailable' } })) }
    const controller = createBrowserWindowController({ rpc: rpc as never })

    expect(await controller.prepare('missing-workbench')).toBe(false)
    expect(controller.getSnapshot()).toMatchObject({
      supported: true,
      request: { workbenchId: 'missing-workbench', status: 'failed', code: 'workbench-unavailable' },
    })
    controller.dispose()
  })

  it('keeps handoff preparation status associated with the target workbench', async () => {
    const ids = new Map<string, string>([
      ['workbench-a', '00000000-0000-4000-8000-000000000001'],
      ['workbench-b', '00000000-0000-4000-8000-000000000002'],
    ])
    const rpc = { call: vi.fn(async (_channel: string, endpoint: string, payload: { workbenchId?: string }) => ({ ok: true, value: {
      status: 'prepared',
      windowId: ids.get(payload.workbenchId ?? '')!,
      expiresAt: Date.now() + 60_000,
      url: `http://127.0.0.1:4200/workbench?token=dsh&workbench=${'T'.repeat(43)}`,
    } })) }
    const controller = createBrowserWindowController({ rpc: rpc as never })

    expect(await controller.prepare('workbench-a')).toBe(true)
    expect(await controller.prepare('workbench-b')).toBe(true)
    expect(controller.getSnapshot().requests).toEqual([
      { workbenchId: 'workbench-a', status: 'prepared' },
      { workbenchId: 'workbench-b', status: 'prepared' },
    ])
    controller.dispose()
  })

  it('tracks concurrent browser views independently so preparing another workbench does not stop polling', async () => {
    vi.useFakeTimers()
    const ids = new Map<string, string>([
      ['workbench-a', '00000000-0000-4000-8000-000000000001'],
      ['workbench-b', '00000000-0000-4000-8000-000000000002'],
    ])
    const statuses = new Map([...ids.values()].map(id => [id, 'requested']))
    const rpc = { call: vi.fn(async (_channel: string, endpoint: string, payload: { workbenchId?: string; windowId?: string }) => {
      if (endpoint === 'workbench-window/prepare') {
        const windowId = ids.get(payload.workbenchId ?? '')!
        return { ok: true, value: {
          status: 'prepared', windowId, expiresAt: Date.now() + 60_000,
          url: `http://127.0.0.1:4200/workbench?token=dsh&workbench=${'T'.repeat(43)}`,
        } }
      }
      if (endpoint === 'workbench-window/reclaim') {
        statuses.set(payload.windowId!, 'reclaim-requested')
        return { ok: true, value: { status: 'reclaim-requested' } }
      }
      if (endpoint === 'workbench-window/status') {
        const current = statuses.get(payload.windowId!)
        if (current === 'requested') statuses.set(payload.windowId!, 'ready')
        else if (current === 'reclaim-requested') statuses.set(payload.windowId!, 'reclaimed')
        return { ok: true, value: { status: statuses.get(payload.windowId!) } }
      }
      return { ok: true, value: { status: 'requested' } }
    }) }
    vi.spyOn(window, 'open').mockReturnValue({ opener: null } as unknown as Window)
    const controller = createBrowserWindowController({ rpc: rpc as never })

    expect(await controller.prepare('workbench-a')).toBe(true)
    expect(await controller.prepare('workbench-b')).toBe(true)
    expect((await controller.open('workbench-a')).status).toBe('requested')
    expect((await controller.open('workbench-b')).status).toBe('requested')
    await vi.advanceTimersByTimeAsync(800)
    expect(controller.getSnapshot().requests).toEqual([
      { workbenchId: 'workbench-a', status: 'ready', windowId: ids.get('workbench-a') },
      { workbenchId: 'workbench-b', status: 'ready', windowId: ids.get('workbench-b') },
    ])

    const reclaimA = controller.reclaim('workbench-a')
    await vi.advanceTimersByTimeAsync(2_000)
    expect(await reclaimA).toEqual({ status: 'reclaimed' })
    expect(controller.getSnapshot().requests).toEqual([
      { workbenchId: 'workbench-a', status: 'reclaimed', windowId: ids.get('workbench-a') },
      { workbenchId: 'workbench-b', status: 'ready', windowId: ids.get('workbench-b') },
    ])
    controller.dispose()
  })

  it('waits for the browser page acknowledgement before restoring the DSH view', async () => {
    vi.useFakeTimers()
    const windowId = '00000000-0000-4000-8000-000000000000'
    let state: 'requested' | 'ready' | 'reclaim-requested' | 'reclaimed' = 'requested'
    const rpc = { call: vi.fn(async (_channel: string, endpoint: string) => {
      if (endpoint === 'workbench-window/prepare') return { ok: true, value: {
        status: 'prepared', windowId, expiresAt: Date.now() + 60_000,
        url: `http://127.0.0.1:4200/workbench?token=dsh&workbench=${'T'.repeat(43)}`,
      } }
      if (endpoint === 'workbench-window/opened') return { ok: true, value: { status: 'requested' } }
      if (endpoint === 'workbench-window/reclaim') { state = 'reclaim-requested'; return { ok: true, value: { status: state } } }
      if (endpoint === 'workbench-window/status' && state === 'requested') state = 'ready'
      else if (endpoint === 'workbench-window/status' && state === 'reclaim-requested') state = 'reclaimed'
      return { ok: true, value: { status: state } }
    }) }
    vi.spyOn(window, 'open').mockReturnValue({ opener: null } as unknown as Window)
    const controller = createBrowserWindowController({ rpc: rpc as never })

    expect(await controller.prepare('workbench-a')).toBe(true)
    expect((await controller.open('workbench-a')).status).toBe('requested')
    await vi.advanceTimersByTimeAsync(800)
    expect(controller.getSnapshot().request).toMatchObject({ status: 'ready', windowId })

    const reclaim = controller.reclaim('workbench-a')
    await vi.advanceTimersByTimeAsync(0)
    expect(controller.getSnapshot().request).toMatchObject({ status: 'reclaiming', windowId })
    await vi.advanceTimersByTimeAsync(2_000)
    expect(await reclaim).toEqual({ status: 'reclaimed' })
    expect(controller.getSnapshot().request).toMatchObject({ status: 'reclaimed', windowId })
    controller.dispose()
  })

  it('falls back to the Host launcher when Electron blocks window.open', async () => {
    const windowId = '00000000-0000-4000-8000-000000000004'
    const calls: string[] = []
    const rpc = { call: vi.fn(async (_channel: string, endpoint: string) => {
      calls.push(endpoint)
      if (endpoint === 'workbench-window/prepare') return { ok: true, value: {
        status: 'prepared', windowId, expiresAt: Date.now() + 60_000,
        url: `http://127.0.0.1:4200/workbench?token=dsh&workbench=${'T'.repeat(43)}`,
      } }
      if (endpoint === 'workbench-window/launch') return { ok: true, value: { status: 'launched' } }
      if (endpoint === 'workbench-window/opened') return { ok: true, value: { status: 'requested' } }
      return { ok: true, value: { status: 'requested' } }
    }) }
    vi.spyOn(window, 'open').mockReturnValue(null)
    const controller = createBrowserWindowController({ rpc: rpc as never })

    expect(await controller.prepare('workbench-a')).toBe(true)
    expect(await controller.open('workbench-a')).toEqual({ status: 'requested', carrier: 'browser' })
    expect(calls.slice(0, 3)).toEqual([
      'workbench-window/prepare',
      'workbench-window/launch',
      'workbench-window/opened',
    ])
    controller.dispose()
  })

  it('uses only the Host launcher in Electron and never creates an internal page', async () => {
    const windowId = '00000000-0000-4000-8000-000000000005'
    const calls: string[] = []
    const rpc = { call: vi.fn(async (_channel: string, endpoint: string) => {
      calls.push(endpoint)
      if (endpoint === 'workbench-window/prepare') return { ok: true, value: {
        status: 'prepared', windowId, expiresAt: Date.now() + 60_000,
        url: `http://127.0.0.1:4200/workbench?token=dsh&workbench=${'T'.repeat(43)}`,
      } }
      if (endpoint === 'workbench-window/launch') return { ok: true, value: { status: 'launched' } }
      if (endpoint === 'workbench-window/opened') return { ok: true, value: { status: 'requested' } }
      return { ok: true, value: { status: 'requested' } }
    }) }
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 Electron/44.7.0' })
    const popup = vi.spyOn(window, 'open')
    const controller = createBrowserWindowController({ rpc: rpc as never })

    expect(await controller.prepare('workbench-a')).toBe(true)
    expect(await controller.open('workbench-a')).toEqual({ status: 'requested', carrier: 'browser' })
    expect(popup).not.toHaveBeenCalled()
    expect(calls.slice(0, 3)).toEqual([
      'workbench-window/prepare',
      'workbench-window/launch',
      'workbench-window/opened',
    ])
    controller.dispose()
    vi.unstubAllGlobals()
  })

  it('uses only the Host launcher in the branded DSH desktop shell', async () => {
    const windowId = '00000000-0000-4000-8000-000000000006'
    const calls: string[] = []
    const rpc = { call: vi.fn(async (_channel: string, endpoint: string) => {
      calls.push(endpoint)
      if (endpoint === 'workbench-window/prepare') return { ok: true, value: {
        status: 'prepared', windowId, expiresAt: Date.now() + 60_000,
        url: `http://127.0.0.1:4200/workbench?token=dsh&workbench=${'T'.repeat(43)}`,
      } }
      if (endpoint === 'workbench-window/launch') return { ok: true, value: { status: 'launched' } }
      if (endpoint === 'workbench-window/opened') return { ok: true, value: { status: 'requested' } }
      return { ok: true, value: { status: 'requested' } }
    }) }
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 @deepseek-ai/dsh-desktop/0.2.1-rc.2 Chrome/152.0.7977.130' })
    vi.stubGlobal('dshDesktop', { protocolVersion: 1 })
    const popup = vi.spyOn(window, 'open')
    const controller = createBrowserWindowController({ rpc: rpc as never })

    expect(await controller.prepare('workbench-a')).toBe(true)
    expect(await controller.open('workbench-a')).toEqual({ status: 'requested', carrier: 'browser' })
    expect(popup).not.toHaveBeenCalled()
    expect(calls.slice(0, 3)).toEqual([
      'workbench-window/prepare',
      'workbench-window/launch',
      'workbench-window/opened',
    ])
    controller.dispose()
    vi.unstubAllGlobals()
  })
})
