import { workbenchFetch } from './workbench-access.ts'
import { WORKBENCH_BUNDLE_ROUTE, type WorkbenchBundleImportResultV1, type WorkbenchBundleInspectionV1 } from '../workbench-bundle-contract.ts'
import { WORKBENCH_SYNC_ROUTE, type WorkbenchSyncConfigV1, type WorkbenchSyncResponseV1 } from '../workbench-sync-contract.ts'

function errorMessage(value: unknown): string {
  if (typeof value === 'object' && value !== null && 'error' in value && typeof value.error === 'string') return value.error
  return '工作台包服务不可用。'
}

export function createWorkbenchBundleClient(fetcher: typeof fetch = workbenchFetch) {
  const json = async <T>(response: Response): Promise<T> => {
    const value = await response.json() as unknown
    if (!response.ok) throw new Error(errorMessage(value))
    return value as T
  }
  return {
    async export(workbenchId: string, kind: 'template' | 'complete', signal?: AbortSignal): Promise<{ file: Blob; filename: string }> {
      const response = await fetcher(WORKBENCH_BUNDLE_ROUTE + '/export', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workbenchId, kind }), ...(signal ? { signal } : {}),
      })
      if (!response.ok) throw new Error(errorMessage(await response.json().catch(() => undefined)))
      const filename = response.headers.get('x-dshbay-filename') ?? `${workbenchId}.dshbay.zip`
      return { file: await response.blob(), filename }
    },
    async inspect(file: File | Uint8Array, signal?: AbortSignal): Promise<WorkbenchBundleInspectionV1> {
      const response = await fetcher(WORKBENCH_BUNDLE_ROUTE + '/inspect', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'content-type': 'application/octet-stream' },
        body: file instanceof Uint8Array ? new Blob([file as unknown as BlobPart]) : await file.arrayBuffer(), ...(signal ? { signal } : {}),
      })
      return json<WorkbenchBundleInspectionV1>(response)
    },
    async import(file: File | Uint8Array, input: { parentPath: string; folderName: string }, signal?: AbortSignal): Promise<WorkbenchBundleImportResultV1> {
      const params = new URLSearchParams({ parentPath: input.parentPath, folderName: input.folderName })
      const response = await fetcher(WORKBENCH_BUNDLE_ROUTE + '/import?' + params, {
        method: 'POST', credentials: 'same-origin',
        headers: { 'content-type': 'application/octet-stream' },
        body: file instanceof Uint8Array ? new Blob([file as unknown as BlobPart]) : await file.arrayBuffer(), ...(signal ? { signal } : {}),
      })
      return json<WorkbenchBundleImportResultV1>(response)
    },
    async syncConfig(workbenchId: string, signal?: AbortSignal): Promise<WorkbenchSyncResponseV1> {
      const params = new URLSearchParams({ workbenchId })
      const response = await fetcher(WORKBENCH_SYNC_ROUTE + '/config?' + params, { method: 'GET', credentials: 'same-origin', ...(signal ? { signal } : {}) })
      return json<WorkbenchSyncResponseV1>(response)
    },
    async saveSyncConfig(workbenchId: string, config: WorkbenchSyncConfigV1, signal?: AbortSignal): Promise<WorkbenchSyncResponseV1> {
      const response = await fetcher(WORKBENCH_SYNC_ROUTE + '/config', {
        method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workbenchId, config }), ...(signal ? { signal } : {}),
      })
      return json<WorkbenchSyncResponseV1>(response)
    },
    async syncNow(workbenchId: string, signal?: AbortSignal): Promise<WorkbenchSyncResponseV1> {
      const response = await fetcher(WORKBENCH_SYNC_ROUTE + '/run', {
        method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workbenchId }), ...(signal ? { signal } : {}),
      })
      return json<WorkbenchSyncResponseV1>(response)
    },
  }
}
