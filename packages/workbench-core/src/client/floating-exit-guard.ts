import type { FloatingWorkspaceRuntime } from './floating-workspace-runtime.ts'

const exitEvent = 'workbench-client-exit-request'
export function requestWorkbenchClientExit(): Promise<boolean> {
  return new Promise(resolve => {
    const detail = { handled: false, complete: resolve }
    window.dispatchEvent(new CustomEvent(exitEvent, { detail }))
    if (!detail.handled) resolve(true)
  })
}

/** Only Workbench-owned actions await guards; native forced exits remain native. */
export function installFloatingExitGuard(runtime: FloatingWorkspaceRuntime): () => void {
  let pending: Promise<boolean> | undefined, approvedUntil = 0
  const prepare = () => pending ??= (async () => {
    if (!await runtime.guardClientExit()) return false
    const temporary = [...runtime.instances.values()].filter(row => row.location === 'floating')
    if (temporary.length && !globalThis.confirm('临时内页仅保留到本次运行结束。继续后不会恢复；尚未接入保存保护的内页请先保存。是否继续？')) return false
    approvedUntil = Date.now() + 1000
    return true
  })().finally(() => { pending = undefined })
  const receive = (event: Event) => {
    const detail = (event as CustomEvent<{ handled: boolean; complete: (ok: boolean) => void }>).detail
    detail.handled = true
    void prepare().then(detail.complete, () => detail.complete(false))
  }
  const unload = (event: BeforeUnloadEvent) => {
    if (Date.now() > approvedUntil && [...runtime.instances.values()].some(row => row.location === 'floating' || row.busy)) { event.preventDefault(); event.returnValue = '' }
  }
  const refresh = (event: KeyboardEvent) => {
    if (!runtime.enabled || event.defaultPrevented || event.altKey || !(event.key === 'F5' || (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'r')) return
    event.preventDefault(); event.stopImmediatePropagation()
    void prepare().then(ok => { if (ok) window.location.reload() })
  }
  window.addEventListener(exitEvent, receive)
  window.addEventListener('beforeunload', unload)
  window.addEventListener('keydown', refresh, true)
  return () => { window.removeEventListener(exitEvent, receive); window.removeEventListener('beforeunload', unload); window.removeEventListener('keydown', refresh, true) }
}
