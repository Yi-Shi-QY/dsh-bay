import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { LAYOUT_IMPORT_JOURNAL_ROUTE, validLayoutImportReceipt, type LayoutImportReceiptV2 } from './layout-import-journal.ts'

export function createHostLayoutImportJournal(profile: string) {
  const root = join(profile, '.dsh-workbench', 'layout-import-v2')
  const path = join(root, 'journal.json')
  const list = (): LayoutImportReceiptV2[] => {
    if (!existsSync(path)) return []
    if (statSync(path).size > 1024 * 1024) throw new Error('journal-too-large')
    const rows: unknown = JSON.parse(readFileSync(path, 'utf8'))
    if (!Array.isArray(rows) || rows.length > 1024 || !rows.every(validLayoutImportReceipt) || new Set(rows.map(row => row.transactionId)).size !== rows.length) throw new Error('invalid-journal')
    return rows
  }
  return { list, save(receipt: LayoutImportReceiptV2) {
    if (!validLayoutImportReceipt(receipt)) throw new Error('invalid-receipt')
    const rows = list()
    const previous = rows.find(row => row.transactionId === receipt.transactionId)
    if (previous) {
      if (previous.workbenchId !== receipt.workbenchId || previous.archiveSha256 !== receipt.archiveSha256 || previous.createdAt !== receipt.createdAt || previous.name !== receipt.name) throw new Error('transaction-conflict')
      if (previous.state === 'completed') return previous
    } else if (rows.length >= 1024) throw new Error('journal-full')
    mkdirSync(root, { recursive: true })
    const temporary = join(root, `journal-${randomBytes(12).toString('hex')}.tmp`)
    writeFileSync(temporary, JSON.stringify([...rows.filter(row => row.transactionId !== receipt.transactionId), receipt]), { flag: 'wx', mode: 0o600 })
    renameSync(temporary, path)
    return receipt
  } }
}

export function installLayoutImportJournalRoute(ctx: { get<T>(name: string, strict?: boolean): T | undefined }): (() => void) | undefined {
  type Web = { register(route: { kind: 'exact'; path: string; handler(req: IncomingMessage, res: ServerResponse): Promise<void> }): () => void }
  const web = ctx.get<Web>('webServer', false)
  const profile = ctx.get<{ dir: string }>('profileContext', false)
  if (!web || !profile?.dir) return undefined
  const journal = createHostLayoutImportJournal(profile.dir)
  return web.register({ kind: 'exact', path: LAYOUT_IMPORT_JOURNAL_ROUTE, async handler(req, res) {
    const reply = (status: number, value: unknown) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(value)) }
    try {
      if (req.method === 'GET') { reply(200, journal.list()); return }
      if (req.method !== 'POST') { reply(405, { error: 'method-not-allowed' }); return }
      if (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) { reply(403, { error: 'origin-mismatch' }); return }
      let body = ''
      for await (const chunk of req) { body += String(chunk); if (Buffer.byteLength(body) > 4096) throw new Error('body-too-large') }
      const receipt: unknown = JSON.parse(body)
      if (!validLayoutImportReceipt(receipt)) throw new Error('invalid-receipt')
      reply(200, journal.save(receipt))
    } catch { reply(400, { error: '导入记录未能保存，请检查连接或记录格式。' }) }
  } })
}
