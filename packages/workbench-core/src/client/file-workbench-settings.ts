import { WORKBENCH_DIRECTORY_ROUTE, type FileWorkbenchSnapshot } from '../workbench-directory-contract.ts'
import type { WorkbenchSettingsScope, SettingsScopeSnapshot, SettingsScopePathOperation, SettingsScopePatchResult } from './workbench-settings-contracts.ts'
import type { WorkbenchSettingsV4 } from '../foundation/persistence.ts'
import { workbenchFetch, publishWorkbenchAccess } from './workbench-access.ts'
import type { WorkbenchAccessBootstrap } from '../workbench-access-contract.ts'
import { browserSafeUuid } from '../browser-safe-id.ts'

/** Browser mirror only; every definition write goes to the root-directory authority. */
export function createFileWorkbenchSettings(fetcher: typeof fetch = workbenchFetch) {
  let snapshot: SettingsScopeSnapshot<WorkbenchSettingsV4> = { status: 'loading', value: undefined, revision: undefined, writable: false, mode: 'host' }
  let disposed = false, refreshing = false
  let scopedWorkbenchId: string | undefined
  const listeners = new Set<() => void>()
  const notify = () => { for (const listener of listeners) listener() }
  const request = async <T>(body: Record<string, unknown>): Promise<T> => {
    const response = await fetcher(WORKBENCH_DIRECTORY_ROUTE, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ requestId: browserSafeUuid(), ...body }) })
    const result = await response.json() as { snapshot?: FileWorkbenchSnapshot; access?: WorkbenchAccessBootstrap; value: T; error?: string }
    if (!response.ok || !result.snapshot) throw new Error(result.error ?? '工作台目录服务不可用。')
    if (result.access) { publishWorkbenchAccess(result.access); scopedWorkbenchId = result.access.context.workbenchId }
    const localBackgroundAi = scopedWorkbenchId ? result.snapshot.value.workbenches[scopedWorkbenchId]?.backgroundAi : undefined
    const next = localBackgroundAi ? { ...result.snapshot, value: { ...result.snapshot.value, backgroundAi: localBackgroundAi } } : result.snapshot
    if (!disposed && (snapshot.revision === undefined || next.revision >= snapshot.revision) && JSON.stringify(next) !== JSON.stringify(snapshot)) { snapshot = next; notify() }
    return result.value
  }
  const refresh = async () => {
    if (disposed || refreshing) return
    refreshing = true
    try { await request({ action: 'snapshot' }) }
    catch { if (!disposed) { snapshot = { ...snapshot, status: 'unavailable', writable: false }; notify() } }
    finally { refreshing = false }
  }
  const patch = (operation: SettingsScopePathOperation) => request<SettingsScopePatchResult>({ action: 'patch', operation: scopedWorkbenchId && operation.path[0] === 'backgroundAi'
    ? { ...operation, path: ['workbenches', scopedWorkbenchId, ...operation.path] }
    : operation })
  const scope: WorkbenchSettingsScope<WorkbenchSettingsV4> = { getSnapshot: () => snapshot,
    subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener) } },
    patch, set: (field, value) => patch({ operation: 'set', path: [field], value }), unset: field => patch({ operation: 'unset', path: [field] }),
  }
  const timer = setInterval(() => { void refresh() }, 1500)
  // Let Settings and Connection injection settle before the first Host read;
  // this also avoids racing the initial browser shell render.
  const initial = setTimeout(() => { void refresh() }, 250)
  return { scope, request, refresh, dispose() { disposed = true; clearTimeout(initial); clearInterval(timer); listeners.clear() } }
}
