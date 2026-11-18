import { workbenchFetch } from './workbench-access.ts'
import { WORKBENCH_BUNDLE_ROUTE, type WorkbenchBundleExportCheckV1, type WorkbenchBundleImportResultV1, type WorkbenchBundleInspectionV1, type WorkbenchBundleJobV1 } from '../workbench-bundle-contract.ts'
import { WORKBENCH_SYNC_ROUTE, type WorkbenchSyncConfigV1, type WorkbenchSyncResponseV1 } from '../workbench-sync-contract.ts'

function errorMessage(value: unknown): string {
  if (typeof value === 'object' && value !== null && 'error' in value && typeof value.error === 'string') return value.error
  return '工作台包服务不可用。'
}

export function createWorkbenchBundleClient(fetcher: typeof fetch = workbenchFetch) {
  const json = async <T>(response: Response): Promise<T> => {
    // A gateway or bridge failure can answer with an empty or plain-text body;
    // report its status instead of a JSON parse error.
    const body = await response.text()
    let value: unknown
    try { value = body ? JSON.parse(body) as unknown : undefined } catch { value = undefined }
    if (!response.ok) throw new Error(value === undefined ? `工作台包服务不可用（HTTP ${response.status}${body ? '：' + body.slice(0, 120) : ''}）。` : errorMessage(value))
    if (value === undefined) throw new Error(`工作台包服务返回了无效响应（HTTP ${response.status}）。`)
    return value as T
  }
  return {
    async export(workbenchId: string, kind: 'template' | 'complete', signal?: AbortSignal): Promise<{ file: Blob; filename: string; notices: readonly { sessionKey: string; reason: string }[] }> {
      const response = await fetcher(WORKBENCH_BUNDLE_ROUTE + '/export', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workbenchId, kind }), ...(signal ? { signal } : {}),
      })
      if (!response.ok) throw new Error(errorMessage(await response.json().catch(() => undefined)))
      const filename = response.headers.get('x-dshbay-filename') ?? `${workbenchId}.dshbay.zip`
      const encoded = response.headers.get('x-dshbay-export-notices')
      const notices = encoded ? JSON.parse(decodeURIComponent(encoded)) as { sessionKey: string; reason: string }[] : []
      return { file: await response.blob(), filename, notices }
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
    /** Writes the package on the Host disk and returns a job to poll. */
    async startExport(workbenchId: string, kind: 'template' | 'complete', directory?: string): Promise<string> {
      const response = await fetcher(WORKBENCH_BUNDLE_ROUTE + '/export-job', {
        method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workbenchId, kind, ...(directory ? { directory } : {}) }),
      })
      return (await json<{ jobId: string }>(response)).jobId
    },
    async startImport(file: File, input: { parentPath: string; folderName: string }): Promise<string> {
      const params = new URLSearchParams({ parentPath: input.parentPath, folderName: input.folderName })
      const response = await fetcher(WORKBENCH_BUNDLE_ROUTE + '/import-job?' + params, {
        method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/octet-stream' }, body: await file.arrayBuffer(),
      })
      return (await json<{ jobId: string }>(response)).jobId
    },
    async job(jobId: string, signal?: AbortSignal): Promise<WorkbenchBundleJobV1> {
      const response = await fetcher(WORKBENCH_BUNDLE_ROUTE + '/job?' + new URLSearchParams({ jobId }), { method: 'GET', credentials: 'same-origin', ...(signal ? { signal } : {}) })
      return json<WorkbenchBundleJobV1>(response)
    },
    async exportLocation(): Promise<string> {
      const response = await fetcher(WORKBENCH_BUNDLE_ROUTE + '/export-location', { method: 'GET', credentials: 'same-origin' })
      return (await json<{ directory: string }>(response)).directory
    },
    /** Inner-page extensions that must be repaired before this workbench can be exported. */
    async exportCheck(workbenchId: string, signal?: AbortSignal): Promise<WorkbenchBundleExportCheckV1> {
      const response = await fetcher(WORKBENCH_BUNDLE_ROUTE + '/export-check?' + new URLSearchParams({ workbenchId }), { method: 'GET', credentials: 'same-origin', ...(signal ? { signal } : {}) })
      return json<WorkbenchBundleExportCheckV1>(response)
    },
    async reveal(jobId: string): Promise<void> {
      const response = await fetcher(WORKBENCH_BUNDLE_ROUTE + '/reveal', {
        method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jobId }),
      })
      await json<{ revealed: true }>(response)
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
