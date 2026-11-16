// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { mountBrowserWorkbenchShell, mountBrowserWorkbenchStatusShell, unmountBrowserWorkbenchShell } from '../src/client/browser-workbench-shell.ts'

afterEach(() => {
  unmountBrowserWorkbenchShell()
  document.body.innerHTML = ''
})

describe('browser Workbench shell', () => {
  function prepareDedicatedDocument(workbenchId = 'workbench-a'): HTMLElement {
    window.history.replaceState(null, '', '/workbench')
    document.documentElement.dataset.workbenchDocument = 'v1'
    document.body.innerHTML = [
      `<div id="root"><div data-workbench-inner-page data-workbench-mode="workbench" data-workbench-id="${workbenchId}">Target Workbench</div></div>`,
    ].join('')
    const surface = document.querySelector<HTMLElement>('[data-workbench-id]')!
    surface.getBoundingClientRect = () => ({ width: 800, height: 600 } as DOMRect)
    return surface
  }

  it('accepts only the dedicated Workbench document and leaves DSH DOM ownership untouched', () => {
    prepareDedicatedDocument()
    expect(mountBrowserWorkbenchShell('workbench-a')).toEqual({ status: 'ready' })
    expect(document.documentElement.dataset.workbenchBrowserMode).toBe('browser-workbench')
    expect(document.documentElement.dataset.workbenchBrowserWorkbenchId).toBe('workbench-a')
    expect(document.querySelector('#root')?.hasAttribute('inert')).toBe(false)
    expect(document.querySelector('#root')?.hasAttribute('aria-hidden')).toBe(false)
    expect(document.getElementById('dsh-workbench-browser-shell-v2')).toBeNull()
  })

  it('removes only its document markers when unmounted', () => {
    prepareDedicatedDocument()
    expect(mountBrowserWorkbenchShell('workbench-a').status).toBe('ready')
    unmountBrowserWorkbenchShell()
    expect(document.documentElement.dataset.workbenchBrowserMode).toBeUndefined()
    expect(document.documentElement.dataset.workbenchBrowserWorkbenchId).toBeUndefined()
    expect(document.documentElement.dataset.workbenchDocument).toBe('v1')
    expect(document.querySelector('#root')).not.toBeNull()
  })

  it('fails closed when the stable DSH root or target surface is missing', () => {
    window.history.replaceState(null, '', '/workbench')
    document.documentElement.dataset.workbenchDocument = 'v1'
    document.body.innerHTML = '<div id="root"></div>'
    expect(mountBrowserWorkbenchShell('workbench-a')).toEqual({ status: 'unsupported', code: 'browser-shell-root-or-surface-missing' })
    document.body.innerHTML = '<div id="root"><div data-workbench-inner-page data-workbench-mode="workbench" data-workbench-id="other"></div></div>'
    expect(mountBrowserWorkbenchShell('workbench-a')).toEqual({ status: 'unsupported', code: 'browser-shell-root-or-surface-missing' })
  })

  it('fails closed if more than the fixed target Workbench surface is rendered', () => {
    prepareDedicatedDocument()
    document.querySelector('#root')!.insertAdjacentHTML('beforeend', '<div data-workbench-inner-page data-workbench-mode="workbench" data-workbench-id="workbench-b"></div>')
    expect(mountBrowserWorkbenchShell('workbench-a')).toEqual({ status: 'unsupported', code: 'browser-shell-root-or-surface-missing' })
  })

  it('shows a visible failure state without pretending the full DSH page is a Workbench view', () => {
    document.body.innerHTML = '<div id="root"><nav>DSH navigation</nav><main>Official Conversation</main></div>'

    mountBrowserWorkbenchStatusShell('正在验证工作台…')
    expect(document.querySelector('[data-workbench-browser-status]')?.textContent).toBe('正在验证工作台…')
    expect(mountBrowserWorkbenchShell('workbench-a')).toMatchObject({ status: 'unsupported' })

    mountBrowserWorkbenchStatusShell('无法打开工作台，请返回 DSH 客户端重新打开。')
    expect(document.querySelector('[data-workbench-browser-status]')?.textContent).toContain('无法打开工作台')
    expect(document.getElementById('dsh-workbench-browser-shell-v2')?.textContent).toContain('body > *:not([data-workbench-browser-status])')
  })

  it('replaces the temporary failure state after the dedicated document is verified', () => {
    prepareDedicatedDocument()
    mountBrowserWorkbenchStatusShell('正在验证工作台…')

    expect(mountBrowserWorkbenchShell('workbench-a')).toEqual({ status: 'ready' })
    expect(document.querySelector('[data-workbench-browser-status]')).toBeNull()
    expect(document.querySelector('[data-workbench-inner-page]')?.textContent).toBe('Target Workbench')
  })
})
