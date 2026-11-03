/** Runtime-only identity supplied by an authenticated Workbench browser view. */
export interface WorkbenchWindowViewV1 {
  readonly schemaVersion: 1
  readonly windowId: string
  readonly workbenchId: string
  readonly mode: 'browser-workbench'
  /** One-time close receipt, issued only after the browser redeems the view ticket. */
  readonly closeToken: string
}

export function readWorkbenchWindowView(): WorkbenchWindowViewV1 | undefined {
  if (typeof window === 'undefined') return undefined
  const value = (window as unknown as { __WORKBENCH_WINDOW_VIEW__?: WorkbenchWindowViewV1 }).__WORKBENCH_WINDOW_VIEW__
  if (value?.schemaVersion !== 1 || typeof value.windowId !== 'string'
    || typeof value.workbenchId !== 'string' || !/^[a-zA-Z0-9_-]{1,160}$/.test(value.workbenchId)
    || value.mode !== 'browser-workbench'
    || typeof value.closeToken !== 'string' || !/^[A-Za-z0-9_-]{40,64}$/.test(value.closeToken)) return undefined
  return value
}
