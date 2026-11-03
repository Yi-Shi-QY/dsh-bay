import { randomBytes } from 'node:crypto'
import { closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { WorkbenchOfflineImportReceipt } from './offline-import-contract.ts'
import { WORKBENCH_SUITE_VERSION } from './release-compatibility.ts'

const digest = /^[a-f0-9]{64}$/u
const states = ['prepared', 'installing', 'restart-required', 'verifying', 'committing-layout', 'completed', 'failed']

export interface WorkbenchOfflineImportStore {
  list(): WorkbenchOfflineImportReceipt[]
  save(receipt: WorkbenchOfflineImportReceipt): void
  retain(packageId: string, bytes: Uint8Array): void
  archive(packageId: string): Uint8Array
}

/** Atomic Profile-owned files. A damaged journal never silently becomes an empty one. */
export function createWorkbenchOfflineImportStore(profile: string): WorkbenchOfflineImportStore {
  const root = join(profile, '.dsh-workbench', 'offline-import-v1')
  const journal = join(root, 'journal.json')
  const atomic = (path: string, bytes: string | Uint8Array) => {
    mkdirSync(root, { recursive: true })
    const temporary = `${path}.${randomBytes(12).toString('hex')}.tmp`
    const fd = openSync(temporary, 'wx', 0o600)
    try { writeFileSync(fd, bytes); fsyncSync(fd) } finally { closeSync(fd) }
    renameSync(temporary, path)
  }
  const archivePath = (packageId: string) => {
    if (!digest.test(packageId)) throw new Error('Invalid offline package identity')
    return join(root, `${packageId}.zip`)
  }
  const read = (path: string, limit: number) => {
    const info = lstatSync(path)
    if (!info.isFile() || info.size > limit) throw new Error('Invalid offline import storage file')
    return readFileSync(path)
  }
  const list = (): WorkbenchOfflineImportReceipt[] => {
    if (!existsSync(journal)) return []
    const rows: unknown = JSON.parse(read(journal, 256 * 1024).toString('utf8'))
    if (!Array.isArray(rows) || rows.length > 256) throw new Error('Invalid offline import journal')
    const ids = new Set<string>()
    for (const raw of rows) {
      const row = raw as WorkbenchOfflineImportReceipt | null
      if (!row || row.schemaVersion !== 1 || !digest.test(row.packageId) || !digest.test(row.archiveSha256)
        || row.workbenchId !== `offline-${row.packageId}` || !states.includes(row.state) || ids.has(row.packageId)
        || !Array.isArray(row.modules) || row.modules.length > 1 || row.modules.some(module => module.moduleId !== 'workbench.conversation-suite'
          || module.version !== WORKBENCH_SUITE_VERSION || !digest.test(module.artifactDigest) || Object.keys(module).length !== 3)
        || (row.moduleTransactionId !== undefined && !/^workbench-install-[a-z0-9-]{1,96}$/u.test(row.moduleTransactionId))
        || (row.error !== undefined && !['module-failed', 'layout-pending', 'recovery-failed', 'rollback-pending'].includes(row.error))
        || Object.keys(row).some(key => !['schemaVersion', 'packageId', 'archiveSha256', 'state', 'modules', 'workbenchId', 'moduleTransactionId', 'error'].includes(key))) throw new Error('Invalid offline import journal record')
      ids.add(row.packageId)
    }
    return rows as WorkbenchOfflineImportReceipt[]
  }
  return {
    list,
    save(receipt) {
      const rows = list().filter(row => row.packageId !== receipt.packageId)
      if (rows.length >= 256) throw new Error('Offline import receipt limit reached')
      atomic(journal, JSON.stringify([...rows, receipt]))
    },
    retain(packageId, bytes) {
      if (bytes.byteLength === 0 || bytes.byteLength > 72 * 1024 * 1024) throw new Error('Offline import archive exceeds limit')
      atomic(archivePath(packageId), bytes)
    },
    archive: packageId => new Uint8Array(read(archivePath(packageId), 72 * 1024 * 1024)),
  }
}
