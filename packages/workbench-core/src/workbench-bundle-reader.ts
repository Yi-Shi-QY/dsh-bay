import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { readWorkbenchBundle, type WorkbenchBundle, type WorkbenchBundleReaderOptions } from './workbench-bundle.ts'

export class WorkbenchBundleReader {
  constructor(private readonly options: WorkbenchBundleReaderOptions = {}) {}
  read(bytes: Uint8Array): Promise<WorkbenchBundle> { return readWorkbenchBundle(bytes, this.options) }
  async stage(bytes: Uint8Array, stagingRoot: string): Promise<WorkbenchBundle> {
    const bundle = await this.read(bytes)
    const directory = path.resolve(stagingRoot)
    await rm(directory, { recursive: true, force: true })
    await mkdir(directory, { recursive: true })
    await writeFile(path.join(directory, 'manifest.json'), JSON.stringify(bundle.manifest) + '\n', { flag: 'wx' })
    const objectByDigest = new Map(bundle.objects.map(object => [object.digest, object.content]))
    for (const entry of bundle.manifest.entries) {
      if (entry.deleted) continue
      const content = objectByDigest.get(entry.digest)
      if (content === undefined) throw new Error(`missing staged object: ${entry.path}`)
      const target = path.resolve(directory, 'payload', entry.path)
      if (!target.startsWith(path.resolve(directory) + path.sep)) throw new Error('unsafe staging path')
      await mkdir(path.dirname(target), { recursive: true })
      await writeFile(target, content, { flag: 'wx' })
    }
    return bundle
  }
}

export interface WorkbenchImportReceiptV1 {
  schemaVersion: 1
  transactionId: string
  snapshotId: string
  targetRoot: string
  committedAt: number
}

interface WorkbenchImportJournalV1 {
  schemaVersion: 1
  transactionId: string
  snapshotId: string
  source: string
  target: string
  receipt: string
}

async function atomicText(file: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true })
  const temporary = `${file}.${crypto.randomUUID()}.tmp`
  await writeFile(temporary, JSON.stringify(value) + '\n', { flag: 'wx' })
  await rename(temporary, file)
}

async function readReceipt(file: string): Promise<WorkbenchImportReceiptV1 | undefined> {
  try {
    const value = JSON.parse(await readFile(file, 'utf8')) as WorkbenchImportReceiptV1
    if (value.schemaVersion !== 1 || typeof value.transactionId !== 'string' || typeof value.snapshotId !== 'string' || typeof value.targetRoot !== 'string') return undefined
    return value
  } catch { return undefined }
}

/** Commit an already verified staging directory as a new workbench root. */
export async function commitStagedWorkbenchBundle(stagingRoot: string, targetRoot: string, receiptPath: string, transactionId = crypto.randomUUID()): Promise<WorkbenchImportReceiptV1> {
  const source = path.resolve(stagingRoot), target = path.resolve(targetRoot)
  if (source === target || target.startsWith(source + path.sep) || source.startsWith(target + path.sep)) throw new Error('invalid staging and target roots')
  const manifest = JSON.parse(await readFile(path.join(source, 'manifest.json'), 'utf8')) as { snapshotId?: unknown }
  if (typeof manifest.snapshotId !== 'string') throw new Error('staging manifest is invalid')
  const prior = await readReceipt(receiptPath)
  if (prior !== undefined) {
    if (prior.snapshotId !== manifest.snapshotId || path.resolve(prior.targetRoot) !== target) throw new Error('import receipt does not match staged bundle')
    return prior
  }
  try { await stat(target); throw new Error('目标工作台已存在，导入不会覆盖现有工作台') } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  await mkdir(path.dirname(target), { recursive: true })
  const journalPath = receiptPath + '.journal'
  const journal: WorkbenchImportJournalV1 = { schemaVersion: 1, transactionId, snapshotId: manifest.snapshotId, source, target, receipt: path.resolve(receiptPath) }
  await atomicText(journalPath, journal)
  try { await rename(source, target) } catch (error) {
    await rm(journalPath, { force: true }).catch(() => {})
    throw error
  }
  const receipt: WorkbenchImportReceiptV1 = { schemaVersion: 1, transactionId, snapshotId: manifest.snapshotId, targetRoot: target, committedAt: Date.now() }
  await atomicText(receiptPath, receipt)
  await rm(journalPath, { force: true }).catch(() => {})
  return receipt
}

/** Finish an import whose process stopped after the staging directory was renamed. */
export async function recoverWorkbenchBundleImport(receiptPath: string): Promise<WorkbenchImportReceiptV1 | undefined> {
  const journalPath = receiptPath + '.journal'
  let journal: WorkbenchImportJournalV1
  try { journal = JSON.parse(await readFile(journalPath, 'utf8')) as WorkbenchImportJournalV1 } catch { return readReceipt(receiptPath) }
  if (journal.schemaVersion !== 1 || typeof journal.target !== 'string' || typeof journal.receipt !== 'string') throw new Error('invalid workbench import journal')
  const existing = await readReceipt(receiptPath)
  if (existing !== undefined) { await rm(journalPath, { force: true }); return existing }
  try { await stat(journal.target) } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
  const receipt: WorkbenchImportReceiptV1 = { schemaVersion: 1, transactionId: journal.transactionId, snapshotId: journal.snapshotId, targetRoot: path.resolve(journal.target), committedAt: Date.now() }
  await atomicText(journal.receipt, receipt)
  await rm(journalPath, { force: true }).catch(() => {})
  return receipt
}

