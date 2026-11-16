export interface BrowserWorkbenchShellResultV1 {
  readonly status: 'ready' | 'unsupported'
  readonly code?: string
}

const STYLE_ID = 'dsh-workbench-browser-shell-v2'
const SURFACE_SELECTOR = '[data-workbench-inner-page][data-workbench-mode="workbench"]'
const STATUS_MARKER = 'data-workbench-browser-status'
const SHARE_STATUS_MARKER = 'data-workbench-share-status'

function ensureStyle(): HTMLStyleElement {
  let style = document.getElementById(STYLE_ID) as HTMLStyleElement | null
  if (style === null) {
    style = document.createElement('style')
    style.id = STYLE_ID
    document.head.appendChild(style)
  }
  return style
}

/** Render only a failure state in a dedicated document; never cover DSH UI. */
export function mountBrowserWorkbenchStatusShell(message: string): void {
  if (typeof document === 'undefined' || typeof window === 'undefined' || document.body === null) return
  let status = document.querySelector<HTMLElement>(`[${STATUS_MARKER}]`)
  if (status === null) {
    unmountBrowserWorkbenchShell()
    const style = ensureStyle()
    style.textContent = `html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; }
body > *:not([${STATUS_MARKER}]) { visibility: hidden !important; pointer-events: none !important; }
body > [${STATUS_MARKER}] { position: fixed; inset: 0; z-index: 2147483647; display: grid; place-items: center; padding: 24px; box-sizing: border-box; color: var(--dsw-alias-label-primary, CanvasText); background: var(--dsw-alias-bg-base, Canvas); font: 14px/1.5 system-ui, sans-serif; text-align: center; }`
    status = document.createElement('main')
    status.setAttribute(STATUS_MARKER, 'true')
    status.setAttribute('role', 'status')
    status.setAttribute('aria-live', 'polite')
    document.body.appendChild(status)
  }
  status.textContent = message
}

/**
 * Validate the dedicated `/workbench` document. Workbench owns the only root
 * composition there, so success does not require hiding or inerting DSH DOM.
 */
export function mountBrowserWorkbenchShell(workbenchId: string): BrowserWorkbenchShellResultV1 {
  if (typeof document === 'undefined' || typeof window === 'undefined') {
    return { status: 'unsupported', code: 'browser-shell-document-unavailable' }
  }
  const roots = document.querySelectorAll<HTMLElement>('#root')
  const root = roots.item(0)
  const surfaces = document.querySelectorAll<HTMLElement>(SURFACE_SELECTOR)
  const surface = surfaces.item(0)
  if (window.location.pathname !== '/workbench' || document.documentElement.dataset.workbenchDocument !== 'v1'
    || roots.length !== 1 || surfaces.length !== 1 || surface === null || surface.dataset.workbenchId !== workbenchId
    || surface.getBoundingClientRect().width <= 0 || surface.getBoundingClientRect().height <= 0
    || root === null || !document.body.contains(root) || !document.body.contains(surface)) {
    return { status: 'unsupported', code: 'browser-shell-root-or-surface-missing' }
  }
  unmountBrowserWorkbenchStatusShell()
  document.documentElement.dataset.workbenchBrowserWorkbenchId = workbenchId
  document.documentElement.dataset.workbenchBrowserMode = 'browser-workbench'
  return { status: 'ready' }
}

/** Remove only Workbench document markers and failure UI. */
export function unmountBrowserWorkbenchShell(): void {
  if (typeof document === 'undefined') return
  document.querySelectorAll<HTMLElement>(`[${STATUS_MARKER}]`).forEach(node => node.remove())
  delete document.documentElement.dataset.workbenchBrowserWorkbenchId
  delete document.documentElement.dataset.workbenchBrowserMode
  document.getElementById(STYLE_ID)?.remove()
}

export function unmountBrowserWorkbenchStatusShell(): void {
  if (typeof document === 'undefined') return
  document.querySelectorAll<HTMLElement>(`[${STATUS_MARKER}]`).forEach(node => node.remove())
  document.getElementById(STYLE_ID)?.remove()
}

export function mountBrowserWorkbenchShareStatusShell(state: 'stopped' | 'kicked' | 'host-unavailable'): void {
  if (typeof document === 'undefined' || typeof window === 'undefined' || document.body === null) return
  document.querySelectorAll<HTMLElement>(`[${SHARE_STATUS_MARKER}]`).forEach(node => node.remove())
  const status = document.createElement('main')
  status.setAttribute(SHARE_STATUS_MARKER, 'true')
  status.setAttribute('role', 'alert')
  status.setAttribute('aria-live', 'assertive')
  Object.assign(status.style, {
    position: 'fixed', inset: '0', zIndex: '2147483647', display: 'grid', placeItems: 'center',
    padding: '24px', boxSizing: 'border-box', color: 'var(--dsw-alias-label-primary, CanvasText)',
    background: 'var(--dsw-alias-bg-base, Canvas)', font: '14px/1.5 system-ui, sans-serif', textAlign: 'center',
  })
  const panel = document.createElement('section')
  Object.assign(panel.style, { maxWidth: '520px', padding: '24px', border: '1px solid var(--dsw-alias-border-l2, #d9dcdf)', borderRadius: '8px', background: 'var(--dsw-alias-bg-layer-1, Canvas)', boxShadow: '0 12px 36px rgb(0 0 0 / 12%)' })
  const heading = document.createElement('h1')
  heading.textContent = state === 'stopped' ? '房主已停止共享' : 'DSH Host 暂时不可用'
  if (state === 'kicked') heading.textContent = '房主已将你断开'
  heading.style.margin = '0 0 8px'
  heading.style.fontSize = '18px'
  const message = document.createElement('p')
  message.textContent = state === 'stopped'
    ? '此 Workbench 共享已断开，当前页面不能继续操作。请联系房主获取新的共享链接。'
    : '与 DSH Host 的连接已断开，当前页面已锁定。Host 恢复后请重新打开共享链接。'
  if (state === 'kicked') message.textContent = '房主已结束本次访客连接，请使用新的分享链接重新加入。'
  message.style.margin = '0'
  panel.append(heading, message)
  status.append(panel)
  document.body.append(status)
}
