import { WORKBENCH_OFFLINE_IMPORT_ROUTE, type WorkbenchOfflineImportReceipt, type WorkbenchOfflineImportPreflight } from './offline-import-contract.ts'

export function createWorkbenchOfflineImportBridge(fetcher: typeof fetch = fetch) {
  const request = async (suffix = '', body?: BodyInit) => {
    const response = await fetcher(WORKBENCH_OFFLINE_IMPORT_ROUTE + suffix, { method: body === undefined ? 'GET' : 'POST',
      credentials: 'same-origin', cache: 'no-store', ...(body === undefined ? {} : { body }) })
    if (!response.ok) throw new Error('离线导入未完成，请核对模块身份、重启状态和导入回执。')
    return response.json() as Promise<unknown>
  }
  return {
    preflight: (bytes: Uint8Array) => request('/preflight', new Uint8Array(bytes).buffer) as Promise<WorkbenchOfflineImportPreflight>,
    commit: (bytes: Uint8Array) => request('', new Uint8Array(bytes).buffer) as Promise<WorkbenchOfflineImportReceipt>,
    complete: (packageId: string, clientReady: boolean) => request('/complete', JSON.stringify({ packageId, clientReady })) as Promise<WorkbenchOfflineImportReceipt>,
    list: () => request() as Promise<{ receipts: WorkbenchOfflineImportReceipt[] }>,
  }
}
