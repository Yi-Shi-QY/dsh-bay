// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createWorkbenchOfficialAreaEditors } from '../src/client/official-area-editors.tsx'

vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    readonly options = { disableStdin: false, theme: undefined as unknown }
    readonly parser = { registerOscHandler: () => ({ dispose: vi.fn() }) }
    readonly textarea = document.createElement('textarea')
    loadAddon() {}
    open(node: HTMLElement) { node.appendChild(this.textarea) }
    onData() { return { dispose: vi.fn() } }
    onRender() { return { dispose: vi.fn() } }
    focus() {}
    write(_value: string, callback?: () => void) { callback?.() }
    reset() {}
    resize() {}
    dispose() {}
  },
}))

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class {
    proposeDimensions() { return undefined }
  },
}))

function owner(state: Record<string, unknown> = {}) {
  return {
    instanceId: 'area-browser-test',
    areaId: 'area-browser-test',
    areaClaim: 'area-browser-test-claim',
    sessionId: 'session-test',
    state,
    setState: vi.fn(),
    close: vi.fn(),
    focus: vi.fn(),
  }
}

function snapshotStore<T>(initial: T) {
  let value = initial
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => value,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener) },
    set(next: T) { value = next; for (const listener of listeners) listener() },
  }
}

describe('official Area editor interactions', () => {
  afterEach(() => cleanup())

  it('matches the DSH browser history, address validation, and sandbox controls', () => {
    const setState = vi.fn()
    const browser = createWorkbenchOfficialAreaEditors({} as never).browser
    render(browser({ ...owner(), setState } as never))

    const address = screen.getByRole('textbox', { name: '浏览器地址' })
    fireEvent.change(address, { target: { value: 'example.com' } })
    fireEvent.submit(address.closest('form')!)
    const frame = screen.getByTitle('example.com') as HTMLIFrameElement
    expect(frame.src).toBe('https://example.com/')
    expect(frame.getAttribute('sandbox')).toContain('allow-scripts')

    fireEvent.change(address, { target: { value: 'https://second.example/path' } })
    fireEvent.submit(address.closest('form')!)
    expect((screen.getByTitle('second.example') as HTMLIFrameElement).src).toBe('https://second.example/path')
    fireEvent.click(screen.getByRole('button', { name: '后退' }))
    expect((screen.getByTitle('example.com') as HTMLIFrameElement).src).toBe('https://example.com/')
    fireEvent.click(screen.getByRole('button', { name: '前进' }))
    expect((screen.getByTitle('second.example') as HTMLIFrameElement).src).toBe('https://second.example/path')

    fireEvent.click(screen.getByRole('button', { name: '关闭沙箱限制' }))
    expect((screen.getByTitle('second.example') as HTMLIFrameElement).getAttribute('sandbox')).toBeNull()
    expect(screen.getByText(/沙箱限制已关闭/)).toBeTruthy()

    fireEvent.change(address, { target: { value: 'https://user:pass@example.com' } })
    fireEvent.submit(address.closest('form')!)
    expect(screen.getByRole('alert').textContent).toContain('地址无效')
    expect(setState).toHaveBeenCalled()
  })

  it('marks an uncontrolled iframe navigation as unknown and disables unsafe controls', () => {
    const browser = createWorkbenchOfficialAreaEditors({} as never).browser
    render(browser(owner({ history: ['https://example.com/'], index: 0, url: 'https://example.com/' }) as never))
    const frame = screen.getByTitle('example.com')
    fireEvent.load(frame)
    fireEvent.load(frame)
    expect(screen.getByText(/页面已在 iframe 内跳转/)).toBeTruthy()
    expect(screen.getByRole('button', { name: '后退' })).toMatchObject({ disabled: true })
    expect(screen.getByRole('button', { name: '在新标签页打开当前已知网址' })).toMatchObject({ disabled: true })
  })

  it('keeps a validated address-bar link available even when iframe load conceals a refusal', () => {
    const browser = createWorkbenchOfficialAreaEditors({} as never).browser
    render(browser(owner({ url: 'https://platform.deepseek.com/usage' }) as never))
    // Chromium can emit load for a CSP rejection; it does not prove success.
    fireEvent.load(screen.getByTitle('platform.deepseek.com'))
    expect(screen.getByText(/部分网站禁止内嵌/)).toBeTruthy()
    const external = screen.getByRole('link', { name: '在新标签页打开地址栏网址' })
    expect(external.getAttribute('href')).toBe('https://platform.deepseek.com/usage')
    expect(external.getAttribute('target')).toBe('_blank')
    expect(external.getAttribute('rel')).toContain('noopener')
    fireEvent.load(screen.getByTitle('platform.deepseek.com'))
    expect(external.getAttribute('href')).toBe('https://platform.deepseek.com/usage')
    fireEvent.change(screen.getByRole('textbox', { name: '浏览器地址' }), { target: { value: 'javascript:alert(1)' } })
    expect(screen.queryByRole('link', { name: '在新标签页打开地址栏网址' })).toBeNull()
  })

  it('starts a new controlled navigation when changing sandbox mode', () => {
    const browser = createWorkbenchOfficialAreaEditors({} as never).browser
    render(browser(owner({ url: 'https://example.com/' }) as never))
    fireEvent.load(screen.getByTitle('example.com'))
    fireEvent.click(screen.getByRole('button', { name: '关闭沙箱限制' }))
    fireEvent.load(screen.getByTitle('example.com'))
    expect(screen.queryByText(/页面已在 iframe 内跳转/)).toBeNull()
    expect(screen.getByRole('button', { name: '在新标签页打开当前已知网址' })).toMatchObject({ disabled: false })
  })

  it.each(['javascript:alert(1)', 'file:///etc/passwd', 'https://user:password@example.com', window.location.origin])(
    'does not load an invalid address restored from Area state: %s', url => {
      const browser = createWorkbenchOfficialAreaEditors({} as never).browser
      const view = render(browser(owner({ url, history: [url], index: 0 }) as never))
      expect(view.container.querySelector('iframe')).toBeNull()
      expect(screen.queryByRole('link', { name: '在新标签页打开地址栏网址' })).toBeNull()
      expect(screen.getByRole('alert').textContent).toContain('已保存的网址无效')
    },
  )

  it('lists and previews project files without retaining or creating a Session', async () => {
    const fetcher = vi.fn(async (_url, options) => {
      const input = JSON.parse(options.body)
      expect(input.workbenchId).toBe('wb')
      expect(input.areaId).toBe('files-area')
      return Response.json({ value: input.action === 'project-preview'
        ? { text: 'const verified = true', truncated: false }
        : { project: 'app', entries: input.relativePath ? [{ name: 'file.ts', relativePath: 'src/file.ts', kind: 'file' }]
          : [{ name: 'src', relativePath: 'src', kind: 'directory' }, { name: 'external-link', relativePath: 'external-link', kind: 'unavailable' }] } })
    })
    vi.stubGlobal('fetch', fetcher)
    const retain = vi.fn()
    try {
      const files = createWorkbenchOfficialAreaEditors({ sessions: { retain } } as never).files
      const view = render(files({ ...owner(), workbenchId: 'wb', areaId: 'files-area' } as never))
      fireEvent.click(await screen.findByRole('button', { name: /src/ }))
      fireEvent.click(await screen.findByRole('button', { name: /file.ts/ }))
      await screen.findByText('const verified = true')
      expect(retain).not.toHaveBeenCalled()
      expect(fetcher.mock.calls.map(call => JSON.parse(call[1].body).action)).toEqual(['project-entries', 'project-entries', 'project-preview'])
      view.unmount()
    } finally { vi.unstubAllGlobals() }
  })

  it('keeps shell selection, recovery, and cleanup retry on the DSH terminal service', async () => {
    const state = snapshotStore({
      phase: 'connected' as const,
      writable: true,
      title: '终端',
      info: {
        id: 'terminal-current' as never,
        title: '终端',
        shell: { path: 'pwsh', args: [], name: 'PowerShell' },
        cwd: 'C:/workspace',
        cols: 80,
        rows: 24,
        state: 'running' as const,
        exitCode: null,
      },
      environment: { cwd: 'C:/workspace', maxCols: 240, maxRows: 100, maxInputBytes: 8192, scrollback: 500 },
    })
    const model = {
      id: 'terminal-current',
      state,
      mount: vi.fn(() => vi.fn()),
      refresh: vi.fn(async () => {}),
      connect: vi.fn(),
      acknowledge: vi.fn(),
      write: vi.fn(),
      resize: vi.fn(),
      rename: vi.fn(async () => {}),
    }
    const closeFailures = snapshotStore([{ id: 'terminal-failed' as never, title: '旧终端', message: '清理失败' }])
    const view = vi.fn(() => model)
    const webTerminals = {
      view,
      close: vi.fn(),
      launchShells: vi.fn(async () => ({ shells: [
        { path: 'pwsh', args: [], name: 'PowerShell' },
        { path: 'bash', args: [], name: 'Bash' },
      ], selectedShell: 'pwsh' })),
      selectShell: vi.fn(),
      recover: vi.fn(async () => [{
        id: 'terminal-recovered' as never,
        title: '恢复终端',
        shell: { path: 'bash', args: [], name: 'Bash' },
        cwd: 'C:/workspace',
        cols: 80,
        rows: 24,
        state: 'running' as const,
        exitCode: null,
      }]),
      closeFailures,
      retryClose: vi.fn(),
    }
    const terminal = createWorkbenchOfficialAreaEditors({ webTerminals } as never).terminal
    render(terminal(owner() as never))

    expect(model.mount).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '选择 Shell' }))
    await waitFor(() => expect(screen.getByRole('menuitem', { name: 'Bash' })).toBeTruthy())
    fireEvent.click(screen.getByRole('menuitem', { name: 'Bash' }))
    expect(webTerminals.selectShell).toHaveBeenCalledWith('bash')
    expect(webTerminals.close).toHaveBeenCalledWith('session-test', 'area-browser-test', 'workbench://terminal/area-browser-test', 'terminal-current')

    fireEvent.click(screen.getByRole('button', { name: '恢复终端' }))
    await waitFor(() => expect(screen.getByRole('menuitem', { name: /恢复终端 · Bash/ })).toBeTruthy())
    fireEvent.click(screen.getByRole('menuitem', { name: /恢复终端 · Bash/ }))
    expect(webTerminals.recover).toHaveBeenCalledWith('session-test')
    expect(view).toHaveBeenCalledWith('session-test', 'area-browser-test', 'workbench://terminal/area-browser-test', 'terminal-recovered', undefined)

    expect(screen.getByRole('alert').textContent).toContain('未能结束')
    fireEvent.click(screen.getByRole('button', { name: '重试清理' }))
    expect(webTerminals.retryClose).toHaveBeenCalledWith('terminal-failed')
  })

  it('shows the native read-only handoff and does not mount xterm before terminal info exists', () => {
    const connected = snapshotStore({
      phase: 'connected' as const,
      writable: false,
      info: {
        id: 'terminal-readonly' as never,
        title: '只读终端',
        shell: { path: 'bash', args: [], name: 'Bash' },
        cwd: 'C:/workspace',
        cols: 80,
        rows: 24,
        state: 'running' as const,
        exitCode: null,
      },
    })
    const model = { state: connected, mount: vi.fn(() => vi.fn()), connect: vi.fn(), refresh: vi.fn(async () => {}), acknowledge: vi.fn(), write: vi.fn(), resize: vi.fn(), rename: vi.fn(async () => {}) }
    const webTerminals = { view: vi.fn(() => model), closeFailures: snapshotStore([]), close: vi.fn(), launchShells: vi.fn(async () => ({ shells: [], selectedShell: undefined })), selectShell: vi.fn(), recover: vi.fn(async () => []), retryClose: vi.fn() }
    const terminal = createWorkbenchOfficialAreaEditors({ webTerminals } as never).terminal
    render(terminal(owner() as never))
    fireEvent.click(screen.getByRole('button', { name: '接管输入' }))
    expect(model.connect).toHaveBeenCalled()

    cleanup()
    const loading = snapshotStore({ phase: 'loading' as const, writable: false, info: undefined })
    const loadingModel = { ...model, state: loading, mount: vi.fn(() => vi.fn()) }
    const loadingContext = { webTerminals: { ...webTerminals, view: vi.fn(() => loadingModel) } }
    const loadingTerminal = createWorkbenchOfficialAreaEditors(loadingContext as never).terminal
    render(loadingTerminal(owner() as never))
    expect(screen.getByText('正在加载终端…')).toBeTruthy()
    expect(document.querySelector('[data-workbench-terminal-screen]')).toBeNull()
  })
})
