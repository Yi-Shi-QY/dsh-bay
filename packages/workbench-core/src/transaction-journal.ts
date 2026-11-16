import type { WorkbenchInstallTransactionSnapshotV1 } from './install-coordinator.ts'
import type { WorkbenchModuleIdentityV1 } from './module-catalog.ts'
import type { WorkbenchModuleInstallVerificationV1 } from './install-plan.ts'
import type { WorkbenchModuleReceiptV1 } from './module-receipt.ts'

/**
 * Durable boundary for Core installation transactions.
 *
 * The Core deliberately knows nothing about Profile storage, IndexedDB or
 * node:fs.  Hosts provide a journal implementation and can persist these
 * recipient-safe snapshots wherever their runtime requires.  A record is
 * replaced atomically by transactionId; callers must never append executable
 * artifacts or credentials here.
 */
export interface WorkbenchInstallTransactionJournalRecordV1 {
  readonly transactionId: string
  readonly snapshot: WorkbenchInstallTransactionSnapshotV1
  /** The identity data needed to resume/rollback after a renderer restart. */
  readonly modules?: readonly WorkbenchModuleIdentityV1[]
  /** Signed-catalog facts needed for post-restart manifest verification. */
  readonly verification?: readonly WorkbenchModuleInstallVerificationV1[]
  readonly installTargets?: readonly WorkbenchModuleIdentityV1[]
  readonly claimTargets?: readonly WorkbenchModuleIdentityV1[]
  readonly claimedTargets?: readonly WorkbenchModuleIdentityV1[]
  /** Existing exact identities are protected from repair rollback removal. */
  readonly preservedReceipts?: readonly WorkbenchModuleReceiptV1[]
  readonly installCompleted?: boolean
  readonly updatedAt: string
}

export interface WorkbenchInstallTransactionJournalV1 {
  list(): readonly WorkbenchInstallTransactionJournalRecordV1[]
  get(transactionId: string): WorkbenchInstallTransactionJournalRecordV1 | undefined
  save(record: WorkbenchInstallTransactionJournalRecordV1): void
  remove(transactionId: string): void
}

export interface WorkbenchTransactionJournalStorageV1 {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

/** Storage-backed implementation used by the DSH Profile file/IPC adapter. */
export function createWorkbenchStorageTransactionJournal(
  storage: WorkbenchTransactionJournalStorageV1,
  key = 'dsh.workbench.module-transactions.v1',
): WorkbenchInstallTransactionJournalV1 {
  const memory = new Map<string, WorkbenchInstallTransactionJournalRecordV1>()
  const read = (): void => {
    const raw = storage.getItem(key)
    if (raw === null) return
    let rows: unknown
    try { rows = JSON.parse(raw) } catch { throw new Error('Invalid Workbench transaction journal JSON') }
    if (!Array.isArray(rows)) throw new Error('Invalid Workbench transaction journal shape')
    for (const row of rows) {
      if (typeof row !== 'object' || row === null || typeof (row as { transactionId?: unknown }).transactionId !== 'string') throw new Error('Invalid Workbench transaction journal record')
      const value = row as WorkbenchInstallTransactionJournalRecordV1
      const snapshot = value.snapshot
      const stringArray = (candidate: unknown): candidate is readonly string[] => Array.isArray(candidate) && candidate.every(item => typeof item === 'string')
      if (typeof snapshot !== 'object' || snapshot === null || snapshot.transactionId !== value.transactionId || !stringArray(snapshot.stagedModules) || !stringArray(snapshot.installedModules) || !stringArray(snapshot.activatedModules)) throw new Error(`Invalid Workbench transaction journal snapshot: ${value.transactionId}`)
      if (memory.has(value.transactionId)) throw new Error(`Duplicate Workbench transaction journal record: ${value.transactionId}`)
      memory.set(value.transactionId, value)
    }
  }
  const write = (): void => { storage.setItem(key, JSON.stringify([...memory.values()])) }
  read()
  return {
    list: () => [...memory.values()].sort((left, right) => left.transactionId.localeCompare(right.transactionId)),
    get: transactionId => memory.get(transactionId),
    save(record) { if (record.transactionId !== record.snapshot.transactionId) throw new Error(`Transaction journal identity mismatch: ${record.transactionId}`); memory.set(record.transactionId, record); write() },
    remove(transactionId) { memory.delete(transactionId); write() },
  }
}

export function createWorkbenchInstallTransactionJournal(
  initial: readonly WorkbenchInstallTransactionJournalRecordV1[] = [],
): WorkbenchInstallTransactionJournalV1 {
  const records = new Map<string, WorkbenchInstallTransactionJournalRecordV1>()
  for (const record of initial) {
    if (record.transactionId !== record.snapshot.transactionId) throw new Error(`Transaction journal identity mismatch: ${record.transactionId}`)
    if (records.has(record.transactionId)) throw new Error(`Duplicate Workbench transaction journal record: ${record.transactionId}`)
    records.set(record.transactionId, record)
  }
  return {
    list: () => [...records.values()].sort((left, right) => left.transactionId.localeCompare(right.transactionId)),
    get: transactionId => records.get(transactionId),
    save(record) {
      if (record.transactionId !== record.snapshot.transactionId) throw new Error(`Transaction journal identity mismatch: ${record.transactionId}`)
      records.set(record.transactionId, record)
    },
    remove: transactionId => { records.delete(transactionId) },
  }
}
