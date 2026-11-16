import {
  normalizeWorkbenchWindowSnapshot, unsupportedWorkbenchWindowController,
  type WorkbenchWindowControllerV1, type WorkbenchWindowOpenResultV1, type WorkbenchWindowActionResultV1,
} from './workbench-window-controller.ts'

/** Optional companion backend. Authentication stays in the native DSH carrier. */
export function createCompanionWindowController(): WorkbenchWindowControllerV1 & { dispose(): void } {
  let snapshot = unsupportedWorkbenchWindowController().getSnapshot()
  const listeners = new Set<() => void>()
  let disposed = false
  let refreshing: Promise<void> | undefined
  const request = async (body?: unknown): Promise<unknown> => {
    const response = await fetch('/api/workbench/windows', {
      ...(body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
      credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(body === undefined ? 12000 : 55000),
    })
    if (!response.ok) throw new Error(`window-backend-${response.status}`)
    return response.json()
  }
  const refresh = (): Promise<void> => {
    if (disposed) return Promise.resolve()
    return refreshing ??= (async () => {
      let value: unknown
      try { value = await request() } catch { value = undefined }
      if (disposed) return
      const next = normalizeWorkbenchWindowSnapshot(value)
      if (JSON.stringify(next) !== JSON.stringify(snapshot)) {
        snapshot = next
        for (const listener of [...listeners]) listener()
      }
    })().finally(() => { refreshing = undefined })
  }
  const act = async (body: unknown): Promise<WorkbenchWindowOpenResultV1 | WorkbenchWindowActionResultV1> => {
    try {
      const result = await request(body) as WorkbenchWindowOpenResultV1 | WorkbenchWindowActionResultV1
      await refresh()
      return result
    } catch { return { status: 'failed', code: 'window-backend-unreachable' } }
  }
  void refresh()
  // Window state is transient. This subscription never patches layout settings.
  const timer = setInterval(() => { if (listeners.size > 0) void refresh() }, 3000)
  return {
    getSnapshot: () => snapshot,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener) } },
    open: workbenchId => act({ action: 'open', workbenchId }) as Promise<WorkbenchWindowOpenResultV1>,
    focus: windowId => act({ action: 'focus', windowId }) as Promise<WorkbenchWindowActionResultV1>,
    close: windowId => act({ action: 'close', windowId }) as Promise<WorkbenchWindowActionResultV1>,
    dispose() { disposed = true; clearInterval(timer); listeners.clear() },
  }
}
