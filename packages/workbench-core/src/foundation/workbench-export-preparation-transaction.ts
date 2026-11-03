/**
 * Durable journal for export-side dependency preparation.
 *
 * Import and export have deliberately different terminal meanings: import
 * commits an inactive Workbench record, while export preparation must remain
 * cancelable until the user explicitly confirms the archive download.  This
 * small metadata-only state machine keeps those lifecycles from sharing an
 * invalid terminal transition.  It never stores executable bytes.
 */

export type WorkbenchExportPreparationStateV1 =
  | 'inspecting'
  | 'awaiting-trust'
  | 'awaiting-permissions'
  | 'resolving-repair-plan'
  | 'staging-artifacts'
  | 'installing-registry-dependencies'
  | 'refreshing-runtime'
  | 'verifying-editors-and-agents'
  | 'rechecking-readiness'
  | 'awaiting-export-confirmation'
  | 'exporting'
  | 'committed'
  | 'rolling-back'
  | 'failed'

export interface WorkbenchExportPreparationTransactionV1 {
  readonly schemaVersion: 1
  readonly transactionId: string
  readonly workbenchId: string
  readonly mode: 'online-reference' | 'offline-embedded'
  readonly issueIds: readonly string[]
  readonly stagedDigests: readonly string[]
  readonly installedPackageIds: readonly string[]
  readonly state: WorkbenchExportPreparationStateV1
  readonly createdAt: number
  readonly updatedAt: number
  readonly error?: string
}

export interface WorkbenchExportPreparationTransactionStoreV1 {
  get(transactionId: string): WorkbenchExportPreparationTransactionV1 | undefined
  put(transaction: WorkbenchExportPreparationTransactionV1): void
  delete(transactionId: string): void
  /** Optional enumeration seam used by Runtime restart recovery. */
  snapshot?(): readonly WorkbenchExportPreparationTransactionV1[]
}

const transitions: Record<WorkbenchExportPreparationStateV1, readonly WorkbenchExportPreparationStateV1[]> = {
  inspecting: ['awaiting-trust', 'resolving-repair-plan', 'rolling-back', 'failed'],
  'awaiting-trust': ['awaiting-permissions', 'rolling-back', 'failed'],
  'awaiting-permissions': ['resolving-repair-plan', 'rolling-back', 'failed'],
  'resolving-repair-plan': ['staging-artifacts', 'installing-registry-dependencies', 'rolling-back', 'failed'],
  'staging-artifacts': ['installing-registry-dependencies', 'refreshing-runtime', 'rolling-back', 'failed'],
  'installing-registry-dependencies': ['refreshing-runtime', 'rolling-back', 'failed'],
  'refreshing-runtime': ['verifying-editors-and-agents', 'rolling-back', 'failed'],
  'verifying-editors-and-agents': ['rechecking-readiness', 'rolling-back', 'failed'],
  'rechecking-readiness': ['awaiting-export-confirmation', 'rolling-back', 'failed'],
  'awaiting-export-confirmation': ['exporting', 'rolling-back', 'failed'],
  exporting: ['committed', 'rolling-back', 'failed'],
  committed: [],
  'rolling-back': ['failed'],
  failed: [],
}

function clone(value: WorkbenchExportPreparationTransactionV1): WorkbenchExportPreparationTransactionV1 {
  return structuredClone(value)
}

function validId(value: string, max = 256): boolean {
  return value.trim() !== '' && value.length <= max && /^[A-Za-z0-9._:@/-]+$/u.test(value)
}

function validOpaqueTransactionId(value: string): boolean {
  const trimmed = value.trim()
  return trimmed !== '' && trimmed.length <= 160
    && !trimmed.includes('..') && !trimmed.includes('/') && !trimmed.includes('\\')
    && !/^[A-Za-z]:/u.test(trimmed) && !trimmed.startsWith('.')
    && /^[A-Za-z0-9._:@-]+$/u.test(trimmed)
}

function assertOpaqueTransactionId(value: string): void {
  if (!validOpaqueTransactionId(value)) throw new Error('invalid Workbench export preparation transaction id')
}

function validate(value: WorkbenchExportPreparationTransactionV1): void {
  if (value.schemaVersion !== 1 || !validOpaqueTransactionId(value.transactionId) || !validId(value.workbenchId)
    || (value.mode !== 'online-reference' && value.mode !== 'offline-embedded')
    || !Array.isArray(value.issueIds) || value.issueIds.length > 256
    || !value.issueIds.every(item => validId(item, 320))
    || !Array.isArray(value.stagedDigests) || value.stagedDigests.length > 256
    || !value.stagedDigests.every(item => /^[a-f0-9]{64}$/iu.test(item))
    || !Array.isArray(value.installedPackageIds) || value.installedPackageIds.length > 256
    || !value.installedPackageIds.every(item => validId(item))
    || !transitions[value.state]
    || !Number.isFinite(value.createdAt) || !Number.isFinite(value.updatedAt)
    || (value.error !== undefined && value.error.length > 4096)) {
    throw new Error('invalid Workbench export preparation transaction')
  }
}

export class MemoryWorkbenchExportPreparationTransactionStoreV1 implements WorkbenchExportPreparationTransactionStoreV1 {
  private readonly rows = new Map<string, WorkbenchExportPreparationTransactionV1>()
  get(transactionId: string): WorkbenchExportPreparationTransactionV1 | undefined {
    assertOpaqueTransactionId(transactionId)
    const row = this.rows.get(transactionId)
    return row === undefined ? undefined : clone(row)
  }
  put(transaction: WorkbenchExportPreparationTransactionV1): void {
    validate(transaction)
    this.rows.set(transaction.transactionId, clone(transaction))
  }
  delete(transactionId: string): void { assertOpaqueTransactionId(transactionId); this.rows.delete(transactionId) }
  snapshot(): readonly WorkbenchExportPreparationTransactionV1[] { return [...this.rows.values()].map(clone) }
}

export interface WorkbenchExportPreparationTransactionStorageV1 {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

/** LocalStorage adapter for metadata-only export journals. */
export class LocalStorageWorkbenchExportPreparationTransactionStoreV1 implements WorkbenchExportPreparationTransactionStoreV1 {
  private readonly memory = new MemoryWorkbenchExportPreparationTransactionStoreV1()
  private readonly storage: WorkbenchExportPreparationTransactionStorageV1 | undefined
  private readonly key: string

  constructor(namespace = 'dsh.workbench.export-preparation.v1', storage?: WorkbenchExportPreparationTransactionStorageV1) {
    this.key = namespace.trim() === '' ? 'dsh.workbench.export-preparation.v1' : namespace
    this.storage = storage ?? (() => {
      try { return typeof globalThis.localStorage === 'undefined' ? undefined : globalThis.localStorage } catch { return undefined }
    })()
    this.restore()
  }

  get(transactionId: string): WorkbenchExportPreparationTransactionV1 | undefined { assertOpaqueTransactionId(transactionId); return this.memory.get(transactionId) }
  put(transaction: WorkbenchExportPreparationTransactionV1): void {
    this.memory.put(transaction)
    this.persist()
  }
  delete(transactionId: string): void {
    assertOpaqueTransactionId(transactionId)
    this.memory.delete(transactionId)
    this.persist()
  }
  snapshot(): readonly WorkbenchExportPreparationTransactionV1[] { return this.memory.snapshot() }

  private restore(): void {
    if (this.storage === undefined) return
    try {
      const raw = this.storage.getItem(this.key)
      if (raw === null) return
      const decoded: unknown = JSON.parse(raw)
      if (!Array.isArray(decoded) || decoded.length > 256) return
      for (const candidate of decoded) {
        if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) continue
        try { this.memory.put(candidate as WorkbenchExportPreparationTransactionV1) } catch { /* isolate corrupt rows */ }
      }
    } catch { /* corrupted journal is ignored; no executable state is involved */ }
  }

  private persist(): void {
    if (this.storage === undefined) return
    try { this.storage.setItem(this.key, JSON.stringify(this.memory.snapshot())) } catch { /* best effort */ }
  }
}

export class WorkbenchExportPreparationTransactionControllerV1 {
  private current: WorkbenchExportPreparationTransactionV1
  constructor(initial: WorkbenchExportPreparationTransactionV1, private readonly store: WorkbenchExportPreparationTransactionStoreV1) {
    validate(initial)
    this.current = clone(initial)
    this.store.put(this.current)
  }
  get snapshot(): WorkbenchExportPreparationTransactionV1 { return clone(this.current) }
  transition(state: WorkbenchExportPreparationStateV1, now = Date.now(), error?: string): WorkbenchExportPreparationTransactionV1 {
    if (state !== this.current.state && !transitions[this.current.state].includes(state)) {
      throw new Error(`invalid export preparation transition: ${this.current.state} -> ${state}`)
    }
    this.current = { ...this.current, state, updatedAt: now, ...(error === undefined ? {} : { error }) }
    this.store.put(this.current)
    return this.snapshot
  }
  update(payload: Pick<WorkbenchExportPreparationTransactionV1, 'issueIds' | 'stagedDigests' | 'installedPackageIds'>, now = Date.now()): WorkbenchExportPreparationTransactionV1 {
    this.current = {
      ...this.current,
      issueIds: [...new Set(payload.issueIds)],
      stagedDigests: [...new Set(payload.stagedDigests)],
      installedPackageIds: [...new Set(payload.installedPackageIds)],
      updatedAt: now,
    }
    this.store.put(this.current)
    return this.snapshot
  }
}
