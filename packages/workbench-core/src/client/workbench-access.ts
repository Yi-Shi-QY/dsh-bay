import { WORKBENCH_ACCESS_HEADER, type WorkbenchAccessBootstrap } from '../workbench-access-contract.ts'

let bootstrap: WorkbenchAccessBootstrap | undefined
const listeners = new Set<() => void>()
export function publishWorkbenchAccess(value: WorkbenchAccessBootstrap) { bootstrap = value; for (const listener of listeners) listener() }
export const workbenchAccess = { getSnapshot: () => bootstrap, subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } } }
export function workbenchAccessHeaders(input?: HeadersInit): Headers {
  const headers = new Headers(input)
  if (typeof window !== 'undefined') {
    const view = (window as unknown as { __WORKBENCH_WINDOW_VIEW__?: { accessToken?: string; closeToken?: string } }).__WORKBENCH_WINDOW_VIEW__
    const token = view?.accessToken ?? view?.closeToken
    if (token) headers.set(WORKBENCH_ACCESS_HEADER, token)
  }
  return headers
}
export const workbenchFetch: typeof fetch = (input, init) => fetch(input, { ...init, headers: workbenchAccessHeaders(init?.headers) })

export async function waitForFileWorkbench(workbenchId: string, signal?: AbortSignal): Promise<void> {
  const deadline = Date.now() + 15_000
  let diagnostic = '工作台目录服务尚未就绪。'
  do {
    signal?.throwIfAborted()
    try {
      const response = await workbenchFetch('/api/workbench/directory/v1', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'snapshot', workbenchId }), signal: signal ?? AbortSignal.timeout(5_000) })
      const result = await response.json() as { snapshot?: { status: string; value: { workbenches: Record<string, unknown> } }; access?: WorkbenchAccessBootstrap; error?: string }
      if (response.ok && result.snapshot?.status === 'ready' && result.snapshot.value.workbenches[workbenchId]) { if (result.access) publishWorkbenchAccess(result.access); return }
      diagnostic = result.error ?? '目标工作台没有出现在文件目录快照中。'
      if ([401, 403, 404].includes(response.status)) throw new Error(diagnostic)
    } catch (error) { diagnostic = error instanceof Error ? error.message : String(error) }
    await new Promise(resolve => setTimeout(resolve, 250))
  } while (Date.now() < deadline)
  throw new Error(diagnostic)
}
