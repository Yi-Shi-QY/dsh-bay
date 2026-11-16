export const LAYOUT_IMPORT_JOURNAL_ROUTE = '/api/workbench/layout-import/v2'
export interface LayoutImportReceiptV2 {
  schemaVersion: 2
  transactionId: string
  archiveSha256: string
  workbenchId: string
  name: string
  createdAt: number
  state: 'prepared' | 'completed'
}
export function validLayoutImportReceipt(value: unknown): value is LayoutImportReceiptV2 {
  if (!value || typeof value !== 'object') return false
  const row = value as LayoutImportReceiptV2
  return Object.keys(row).length === 7 && row.schemaVersion === 2 && /^layout-import-[a-f0-9-]{36}$/u.test(row.transactionId)
    && /^[a-f0-9]{64}$/u.test(row.archiveSha256) && /^workbench-[a-f0-9-]{36}$/u.test(row.workbenchId)
    && typeof row.name === 'string' && row.name.length > 0 && row.name.length <= 160 && Number.isFinite(row.createdAt)
    && (row.state === 'prepared' || row.state === 'completed')
}
export interface LayoutImportJournal {
  list(): Promise<LayoutImportReceiptV2[]>
  save(receipt: LayoutImportReceiptV2): Promise<LayoutImportReceiptV2>
}
export function createLayoutImportJournal(fetcher: typeof fetch = fetch): LayoutImportJournal {
  const request = async (receipt?: LayoutImportReceiptV2) => {
    const response = await fetcher(LAYOUT_IMPORT_JOURNAL_ROUTE, { credentials: 'same-origin', cache: 'no-store',
      ...(receipt ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(receipt) } : {}) })
    if (!response.ok) throw new Error('导入记录暂不可用，请恢复连接后重试。')
    return response.json() as Promise<unknown>
  }
  return {
    async list() { const result = await request(); if (!Array.isArray(result) || !result.every(validLayoutImportReceipt)) throw new Error('导入记录无效。'); return result },
    async save(receipt) { const result = await request(receipt); if (!validLayoutImportReceipt(result)) throw new Error('导入回执无效。'); return result },
  }
}
