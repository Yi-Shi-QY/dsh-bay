export type WorkbenchImportTransactionStateV1 =
  | 'inspecting' | 'awaiting-trust' | 'awaiting-permissions' | 'awaiting-target-bindings'
  | 'staging' | 'waiting-restart' | 'activating' | 'verifying' | 'restoring-state'
  | 'committing' | 'ready' | 'rolling-back' | 'failed'

export interface WorkbenchImportTransactionV1 {
  schemaVersion: 1
  transactionId: string
  packageId: string
  packageVersion: string
  archiveSha256?: string
  state: WorkbenchImportTransactionStateV1
  createdAt: number
  updatedAt: number
  stagedDigests: readonly string[]
  installedPackageIds: readonly string[]
  /** The inactive Workbench created by a committed transaction. */
  workbenchId?: string
  committedRevision?: number
  /** Safe, identity-only activation receipts used to resume after a restart. */
  activatedDependencies?: readonly {
    portableId: string
    packageId: string
    version: string
    digest: string
    localPluginId?: string
    localPluginRunId?: string
    localPresetId?: string
    activationKind?: 'static' | 'dynamic' | 'agent-preset' | 'shared'
    editorIds?: readonly string[]
    requiresRestart?: boolean
  }[]
  installedPackages?: readonly {
    portableId: string
    packageName: string
    version: string
    digest: string
    packageManager: 'pnpm' | 'npm' | 'registry'
    reused: boolean
    integrity?: string
    /** Runtime-owned rollback identity; never a package or author identity. */
    rollbackToken?: string
  }[]
  error?: string
}

export interface WorkbenchImportTransactionStoreV1 {
  get(transactionId: string): WorkbenchImportTransactionV1 | undefined
  put(transaction: WorkbenchImportTransactionV1): void
  delete(transactionId: string): void
}

/**
 * Minimal synchronous persistence surface used by the durable transaction
 * adapter.  Keeping this smaller than the browser `Storage` type lets DSH
 * Host and Manager provide an atomic file or IPC-backed implementation without
 * exposing unrelated browser methods such as `length` and `key`.
 */
export interface WorkbenchImportTransactionStorageV1 {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

const MAX_TRANSACTION_DIGESTS = 256
const MAX_TRANSACTION_IDS = 256
const MAX_TRANSACTION_ERROR_BYTES = 4096
const TRANSACTION_STATES: readonly WorkbenchImportTransactionStateV1[] = [
  'inspecting', 'awaiting-trust', 'awaiting-permissions', 'awaiting-target-bindings',
  'staging', 'waiting-restart', 'activating', 'verifying', 'restoring-state',
  'committing', 'ready', 'rolling-back', 'failed',
]

const transitions: Record<WorkbenchImportTransactionStateV1, readonly WorkbenchImportTransactionStateV1[]> = {
  inspecting: ['awaiting-trust', 'awaiting-permissions', 'awaiting-target-bindings', 'staging', 'failed'],
  'awaiting-trust': ['awaiting-permissions', 'failed', 'rolling-back'],
  'awaiting-permissions': ['awaiting-target-bindings', 'staging', 'failed', 'rolling-back'],
  'awaiting-target-bindings': ['staging', 'failed', 'rolling-back'],
  staging: ['waiting-restart', 'activating', 'rolling-back', 'failed'],
  'waiting-restart': ['activating', 'rolling-back', 'failed'],
  // Activation may discover that the newly installed package is not visible
  // to the client module graph until Runtime restart.  This is a durable
  // checkpoint, not a failure: receipts are persisted before entering the
  // waiting state and resume will transition back to activating.
  activating: ['waiting-restart', 'verifying', 'rolling-back', 'failed'],
  verifying: ['restoring-state', 'rolling-back', 'failed'],
  'restoring-state': ['committing', 'rolling-back', 'failed'],
  committing: ['ready', 'rolling-back', 'failed'],
  ready: [], 'rolling-back': ['failed'], failed: [],
}

function clone(transaction: WorkbenchImportTransactionV1): WorkbenchImportTransactionV1 {
  return structuredClone(transaction)
}

/** Small durable state machine shared by browser import UI and restart resume. */
export class MemoryWorkbenchImportTransactionStore implements WorkbenchImportTransactionStoreV1 {
  private readonly rows = new Map<string, WorkbenchImportTransactionV1>()
  get(transactionId: string): WorkbenchImportTransactionV1 | undefined {
    const row = this.rows.get(transactionId)
    return row === undefined ? undefined : clone(row)
  }
  put(transaction: WorkbenchImportTransactionV1): void { this.rows.set(transaction.transactionId, clone(transaction)) }
  delete(transactionId: string): void { this.rows.delete(transactionId) }
  snapshot(): readonly WorkbenchImportTransactionV1[] { return [...this.rows.values()].map(clone) }
  restore(rows: readonly WorkbenchImportTransactionV1[]): void {
    this.rows.clear()
    for (const row of rows) this.put(row)
  }
}

/**
 * Browser durable journal for the import coordinator. The store contains
 * metadata only (phase, package identity, staged digests and installed local
 * package IDs); executable artifacts never enter localStorage. A host may
 * inject its own durable adapter, while this implementation keeps refresh
 * and normal browser restarts resumable without making IndexedDB a sync API
 * dependency of the pure import state machine.
 */
export class LocalStorageWorkbenchImportTransactionStore implements WorkbenchImportTransactionStoreV1 {
  private readonly memory = new Map<string, WorkbenchImportTransactionV1>()
  private readonly key: string
  private readonly storage: WorkbenchImportTransactionStorageV1 | undefined

  constructor(namespace = 'dsh.workbench.import.v1', storage?: WorkbenchImportTransactionStorageV1) {
    this.key = namespace
    this.storage = storage ?? (() => {
      try {
        return typeof globalThis.localStorage === 'undefined' ? undefined : globalThis.localStorage
      } catch { return undefined }
    })()
    this.read()
  }

  get(transactionId: string): WorkbenchImportTransactionV1 | undefined {
    const value = this.memory.get(transactionId)
    return value === undefined ? undefined : clone(value)
  }

  put(transaction: WorkbenchImportTransactionV1): void {
    this.memory.set(transaction.transactionId, clone(transaction))
    this.write()
  }

  delete(transactionId: string): void {
    this.memory.delete(transactionId)
    this.write()
  }

  snapshot(): readonly WorkbenchImportTransactionV1[] {
    return [...this.memory.values()].map(clone)
  }

  restore(rows: readonly WorkbenchImportTransactionV1[]): void {
    this.memory.clear()
    for (const row of rows) this.memory.set(row.transactionId, clone(row))
    this.write()
  }

  private read(): void {
    if (this.storage === undefined) return
    try {
      const raw = this.storage.getItem(this.key)
      if (raw === null) return
      const rows: unknown = JSON.parse(raw)
      if (!Array.isArray(rows)) return
      for (const row of rows) {
        if (!isTransaction(row)) continue
        this.memory.set(row.transactionId, clone(row))
      }
    } catch {
      this.memory.clear()
    }
  }

  private write(): void {
    if (this.storage === undefined) return
    try { this.storage.setItem(this.key, JSON.stringify([...this.memory.values()])) }
    catch { /* quota/private-mode failures leave the in-memory journal usable */ }
  }
}

function isTransaction(value: unknown): value is WorkbenchImportTransactionV1 {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const row = value as Partial<WorkbenchImportTransactionV1>
  const activatedDependencies = row.activatedDependencies
  const validActivatedDependencies = activatedDependencies === undefined || (
    Array.isArray(activatedDependencies) && activatedDependencies.every(item => {
      if (typeof item !== 'object' || item === null || Array.isArray(item)) return false
      const candidate = item as Record<string, unknown>
      return typeof candidate.portableId === 'string' && typeof candidate.packageId === 'string'
        && typeof candidate.version === 'string' && typeof candidate.digest === 'string'
        && (candidate.localPluginId === undefined || typeof candidate.localPluginId === 'string')
        && (candidate.localPluginRunId === undefined || typeof candidate.localPluginRunId === 'string')
        && (candidate.localPresetId === undefined || typeof candidate.localPresetId === 'string')
        && (candidate.activationKind === undefined || candidate.activationKind === 'static' || candidate.activationKind === 'dynamic' || candidate.activationKind === 'agent-preset' || candidate.activationKind === 'shared')
        && (candidate.editorIds === undefined || Array.isArray(candidate.editorIds) && candidate.editorIds.every(id => typeof id === 'string'))
        && (candidate.requiresRestart === undefined || typeof candidate.requiresRestart === 'boolean')
    })
  )
  const installedPackages = row.installedPackages
  const validInstalledPackages = installedPackages === undefined || (
    Array.isArray(installedPackages) && installedPackages.every(item => {
      if (typeof item !== 'object' || item === null || Array.isArray(item)) return false
      const candidate = item as Record<string, unknown>
      return typeof candidate.portableId === 'string' && typeof candidate.packageName === 'string'
        && typeof candidate.version === 'string' && typeof candidate.digest === 'string'
        && (candidate.packageManager === 'pnpm' || candidate.packageManager === 'npm' || candidate.packageManager === 'registry')
        && typeof candidate.reused === 'boolean'
        && (candidate.integrity === undefined || typeof candidate.integrity === 'string')
        && (candidate.rollbackToken === undefined || typeof candidate.rollbackToken === 'string'
          && /^[A-Za-z0-9._:-]{1,256}$/u.test(candidate.rollbackToken))
    })
  )
  return row.schemaVersion === 1
    && typeof row.transactionId === 'string' && /^[A-Za-z0-9._:-]{1,128}$/u.test(row.transactionId)
    && typeof row.packageId === 'string' && row.packageId.length > 0 && row.packageId.length <= 256
    && typeof row.packageVersion === 'string' && row.packageVersion.length > 0 && row.packageVersion.length <= 128
    && (row.archiveSha256 === undefined || /^[a-f0-9]{64}$/iu.test(row.archiveSha256))
    && typeof row.state === 'string' && TRANSACTION_STATES.includes(row.state as WorkbenchImportTransactionStateV1)
    && typeof row.createdAt === 'number' && Number.isFinite(row.createdAt)
    && typeof row.updatedAt === 'number' && Number.isFinite(row.updatedAt)
    && Array.isArray(row.stagedDigests) && row.stagedDigests.length <= MAX_TRANSACTION_DIGESTS
      && row.stagedDigests.every(item => typeof item === 'string' && /^[a-f0-9]{64}$/iu.test(item))
    && Array.isArray(row.installedPackageIds) && row.installedPackageIds.length <= MAX_TRANSACTION_IDS
      && row.installedPackageIds.every(item => typeof item === 'string' && item.length > 0 && item.length <= 256)
    && (row.workbenchId === undefined || typeof row.workbenchId === 'string' && row.workbenchId.length <= 256)
    && (row.committedRevision === undefined || typeof row.committedRevision === 'number' && Number.isSafeInteger(row.committedRevision))
    && (row.error === undefined || typeof row.error === 'string' && new TextEncoder().encode(row.error).byteLength <= MAX_TRANSACTION_ERROR_BYTES)
    && validActivatedDependencies
    && validInstalledPackages
}

export class WorkbenchImportTransactionControllerV1 {
  private current: WorkbenchImportTransactionV1
  constructor(initial: WorkbenchImportTransactionV1, private readonly store: WorkbenchImportTransactionStoreV1) {
    this.current = clone(initial)
    this.store.put(this.current)
  }
  /**
   * Re-open an existing journal entry without silently replacing it. A
   * caller must still validate package identity before using the controller.
   */
  static resumeOrCreate(
    initial: WorkbenchImportTransactionV1,
    store: WorkbenchImportTransactionStoreV1,
  ): WorkbenchImportTransactionControllerV1 {
    const existing = store.get(initial.transactionId)
    return new WorkbenchImportTransactionControllerV1(existing ?? initial, store)
  }
  get snapshot(): WorkbenchImportTransactionV1 { return clone(this.current) }
  transition(state: WorkbenchImportTransactionStateV1, now = Date.now(), error?: string): WorkbenchImportTransactionV1 {
    if (!transitions[this.current.state].includes(state)) throw new Error(`invalid import transaction transition: ${this.current.state} -> ${state}`)
    this.current = { ...this.current, state, updatedAt: now, ...(error === undefined ? {} : { error }) }
    this.store.put(this.current)
    return this.snapshot
  }
  update(payload: Pick<WorkbenchImportTransactionV1, 'stagedDigests' | 'installedPackageIds'>
    & Partial<Pick<WorkbenchImportTransactionV1, 'activatedDependencies' | 'installedPackages' | 'workbenchId' | 'committedRevision'>>,
  now = Date.now()): WorkbenchImportTransactionV1 {
    this.current = {
      ...this.current,
      stagedDigests: [...new Set(payload.stagedDigests)],
      installedPackageIds: [...new Set(payload.installedPackageIds)],
      ...(payload.activatedDependencies === undefined ? {} : {
        activatedDependencies: payload.activatedDependencies.map(value => ({
          ...value,
          ...(value.localPluginId === undefined ? {} : { localPluginId: value.localPluginId }),
          ...(value.localPluginRunId === undefined ? {} : { localPluginRunId: value.localPluginRunId }),
          ...(value.localPresetId === undefined ? {} : { localPresetId: value.localPresetId }),
          ...(value.activationKind === undefined ? {} : { activationKind: value.activationKind }),
          ...(value.editorIds === undefined ? {} : { editorIds: [...value.editorIds] }),
          ...(value.requiresRestart === undefined ? {} : { requiresRestart: value.requiresRestart }),
        })),
      }),
      ...(payload.installedPackages === undefined ? {} : {
        installedPackages: payload.installedPackages.map(value => ({ ...value })),
      }),
      ...(payload.workbenchId === undefined ? {} : { workbenchId: payload.workbenchId }),
      ...(payload.committedRevision === undefined ? {} : { committedRevision: payload.committedRevision }),
      updatedAt: now,
    }
    this.store.put(this.current)
    return this.snapshot
  }
}
