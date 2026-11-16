// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createBrowserWindowController } from '../src/client/browser-window-controller.ts'
import { createHostBrowserWindowController } from '../src/host-browser-window-controller.ts'
import { createFloatingWorkspaceRuntime } from '../src/client/floating-workspace-runtime.ts'

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

describe('browser Workbench handoff controller', () => {
  it('freezes the source before staging and restores the return receipt once before unlocking', async () => {
    vi.useFakeTimers()
    const host = createHostBrowserWindowController({ origin: 'http://127.0.0.1:4200', lookupWorkbench: () => true,
      authenticatedUrl: url => { const result = new URL(url); result.searchParams.set('token', 'test'); return result.href } })
    const source = createFloatingWorkspaceRuntime(), receiver = createFloatingWorkspaceRuntime()
    source.open('one', { id: 'one', editorId: 'test', editorScope: 'root', lastKnownTitle: 'one', state: {} })
    let closeToken = '', windowId = ''
    let controller: ReturnType<typeof createBrowserWindowController>
    const restore = vi.fn((id: string, data: unknown) => source.restoreHandoff(id, data))
    const rpc = { call: vi.fn(async (_channel: string, endpoint: string, payload: unknown) => {
      if (endpoint.endsWith('/floating-stage')) expect(controller.getSnapshot().request?.status).toBe('requested')
      return host.handle(endpoint.replace('workbench-window/', ''), payload)
    }) }
    controller = createBrowserWindowController({ rpc: rpc as never, floating: { snapshot: id => source.snapshotHandoff(id), restore } })
    const popup = { opener: null, location: { replace(url: string) {
      void host.handle('redeem', { ticket: new URL(url).searchParams.get('workbench') }).then(async response => {
        if (!response.ok) throw new Error('Expected redeem')
        const view = (response.value as { view: { windowId: string; closeToken: string } }).view
        closeToken = view.closeToken; windowId = view.windowId
        const read = await host.handle('floating-read', { windowId, closeToken })
        if (!read.ok) throw new Error('Expected handoff')
        receiver.restoreHandoff('one', (read.value as { snapshot: unknown }).snapshot)
        await host.handle('ready', { windowId })
      })
    } } }
    expect(await controller.prepare('one')).toBe(true)
    expect((await controller.open('one', popup as never)).status).toBe('requested')
    await vi.advanceTimersByTimeAsync(800)
    expect(controller.getSnapshot().request?.status).toBe('ready')
    await receiver.close('one', 'one')
    receiver.open('one', { id: 'two', editorId: 'test', editorScope: 'root', lastKnownTitle: 'two', state: { count: 4 } })
    const reclaim = controller.reclaim('one')
    await vi.advanceTimersByTimeAsync(0)
    expect((await host.handle('reclaimed', { closeToken, floating: receiver.snapshotHandoff('one') })).ok).toBe(true)
    await vi.advanceTimersByTimeAsync(2000)
    expect(await reclaim).toEqual({ status: 'reclaimed' })
    expect(restore).toHaveBeenCalledOnce()
    expect(source.find('one', 'one')).toBeUndefined()
    expect(source.find('two', 'one')?.tab.state).toEqual({ count: 4 })
    controller.dispose(); host.dispose()
  })
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
      { workbenchId: 'workbench-a', status: 'reclaimed', windowId: ids.get('workbench-a'), reclaimProgress: { phase: 'checking' } },
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

  it('reports a desktop restoration failure immediately and retries the released view without forcing', async () => {
    vi.useFakeTimers()
    const windowId = '00000000-0000-4000-8000-000000000007'
    let state = 'ready'
    const rpc = { call: vi.fn(async (_channel: string, endpoint: string) => {
      if (endpoint.endsWith('/prepare')) return { ok: true, value: {
        status: 'prepared', windowId, expiresAt: Date.now() + 60_000,
        url: `http://127.0.0.1:4200/workbench?token=dsh&workbench=${'T'.repeat(43)}`,
      } }
      if (endpoint.endsWith('/reclaim') && state !== 'reclaimed') {
        state = 'reclaimed'
        return { ok: true, value: { status: 'reclaim-requested' } }
      }
      return { ok: true, value: { status: state } }
    }) }
    const restoreDesktop = vi.fn().mockRejectedValueOnce(new Error('definition-refresh-failed')).mockResolvedValue(undefined)
    const controller = createBrowserWindowController({ rpc: rpc as never, restoreDesktop })
    try {
      await controller.prepare('a')
      await controller.open('a', { location: { replace() {} } } as never)
      await vi.advanceTimersByTimeAsync(800)
      const reclaim = controller.reclaim!('a')
      await vi.advanceTimersByTimeAsync(2000)
      expect(await reclaim).toEqual({ status: 'failed', code: 'definition-refresh-failed' })
      expect(restoreDesktop).toHaveBeenCalledOnce()
      expect(controller.getSnapshot().request?.reclaimProgress).toEqual({ phase: 'restoring', error: 'definition-refresh-failed' })
      expect(await controller.reclaim!('a')).toEqual({ status: 'reclaimed' })
      expect(restoreDesktop).toHaveBeenCalledTimes(2)
      expect(rpc.call.mock.calls.filter(call => call[1].endsWith('/reclaim'))).toHaveLength(2)
    } finally { controller.dispose() }
  })

  it('ignores a delayed old status response after preparing a new handoff', async () => {
    vi.useFakeTimers()
    const windowId = '00000000-0000-4000-8000-000000000008'
    let release!: (value: unknown) => void
    const restoreDesktop = vi.fn()
    const rpc = { call: vi.fn(async (_channel: string, endpoint: string) => {
      if (endpoint.endsWith('/prepare')) return { ok: true, value: {
        status: 'prepared', windowId, expiresAt: Date.now() + 60_000,
        url: `http://127.0.0.1:4200/workbench?token=dsh&workbench=${'T'.repeat(43)}`,
      } }
      if (endpoint.endsWith('/status')) return new Promise(resolve => { release = resolve })
      return { ok: true, value: { status: 'requested' } }
    }) }
    const controller = createBrowserWindowController({ rpc: rpc as never, restoreDesktop })
    try {
      await controller.prepare('a')
      await controller.open('a', { location: { replace() {} } } as never)
      await vi.advanceTimersByTimeAsync(800)
      await controller.prepare('a')
      release({ ok: true, value: { status: 'reclaimed' } })
      await vi.advanceTimersByTimeAsync(0)
      expect(restoreDesktop).not.toHaveBeenCalled()
      expect(controller.getSnapshot().request?.status).toBe('prepared')
    } finally { controller.dispose() }
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
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 @deepseek-ai/dsh-desktop/0.2.2-rc.2 Chrome/152.0.7977.130' })
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
