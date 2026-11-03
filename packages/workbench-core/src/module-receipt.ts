import type { WorkbenchModuleIdentityV1 } from './module-catalog.ts'
import type { WorkbenchModuleInstallVerificationV1 } from './install-plan.ts'
import { validateWorkbenchModuleSource, type WorkbenchModuleSourceV1, type WorkbenchModuleTrustV1 } from './module-source.ts'

export type WorkbenchModuleReceiptStateV1 = 'staged' | 'installed' | 'restart-required' | 'active' | 'disabled' | 'rolled-back'

export interface WorkbenchModuleReceiptV1 extends WorkbenchModuleIdentityV1 {
  readonly receiptId: string
  readonly planId: string
  readonly state: WorkbenchModuleReceiptStateV1
  readonly installedAt: string
  /** Signed Catalog facts retained for the next-start verification. */
  readonly verification?: WorkbenchModuleInstallVerificationV1
  readonly provenance?: { readonly source?: string; readonly upstreamCommit?: string; readonly patchDigest?: string }
  /** Exact user/catalog source retained for same-source updates. */
  readonly source?: WorkbenchModuleSourceV1
  readonly trust?: WorkbenchModuleTrustV1
  readonly verifiedAt?: string
  readonly claimedFromExternal?: boolean
}

export interface WorkbenchModuleReceiptStoreV1 {
  list(): readonly WorkbenchModuleReceiptV1[]
  get(moduleId: string): WorkbenchModuleReceiptV1 | undefined
  put(receipt: WorkbenchModuleReceiptV1): void
  remove(moduleId: string): void
}

/** Minimal synchronous storage shape implemented by a Profile/Manager. */
export interface WorkbenchModuleReceiptStorageV1 {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

/**
 * Durable receipt projection.  Only module identity, state and provenance are
 * persisted; executable bytes, sessions and credentials never cross this
 * boundary.  The storage owner is responsible for atomic replacement.
 */
export function createWorkbenchStorageModuleReceiptStore(
  storage: WorkbenchModuleReceiptStorageV1,
  key = 'dsh.workbench.module-receipts.v1',
): WorkbenchModuleReceiptStoreV1 {
  const memory = new Map<string, WorkbenchModuleReceiptV1>()
  const read = (): void => {
    const raw = storage.getItem(key)
    if (raw === null) return
    let parsed: unknown
    try { parsed = JSON.parse(raw) } catch { throw new Error('Invalid Workbench module receipt JSON') }
    if (!Array.isArray(parsed)) throw new Error('Invalid Workbench module receipt shape')
    for (const row of parsed) {
      if (typeof row !== 'object' || row === null
        || typeof (row as { moduleId?: unknown }).moduleId !== 'string'
        || typeof (row as { version?: unknown }).version !== 'string'
        || typeof (row as { artifactDigest?: unknown }).artifactDigest !== 'string'
        || typeof (row as { receiptId?: unknown }).receiptId !== 'string'
        || typeof (row as { planId?: unknown }).planId !== 'string'
        || typeof (row as { state?: unknown }).state !== 'string'
        || typeof (row as { installedAt?: unknown }).installedAt !== 'string') {
        throw new Error('Invalid Workbench module receipt record')
      }
      const value = row as WorkbenchModuleReceiptV1
      if ((value.source !== undefined && (!validateWorkbenchModuleSource(value.source)
        || value.source.artifactDigest.toLowerCase() !== value.artifactDigest.toLowerCase()))
        || (value.trust !== undefined && !['catalog-verified', 'user-approved-unverified', 'runtime-verified', 'revoked'].includes(value.trust))
        || (value.claimedFromExternal !== undefined && typeof value.claimedFromExternal !== 'boolean')
        || (value.verifiedAt !== undefined && (typeof value.verifiedAt !== 'string' || !Number.isFinite(Date.parse(value.verifiedAt))))) {
        throw new Error('Invalid Workbench module receipt source')
      }
      if (memory.has(value.moduleId)) throw new Error(`Duplicate Workbench module receipt: ${value.moduleId}`)
      memory.set(value.moduleId, value)
    }
  }
  const write = (): void => { storage.setItem(key, JSON.stringify([...memory.values()])) }
  read()
  const base = createWorkbenchModuleReceiptStore([...memory.values()])
  return {
    list: () => base.list(),
    get: moduleId => base.get(moduleId),
    put(receipt) { base.put(receipt); memory.set(receipt.moduleId, receipt); write() },
    remove(moduleId) { base.remove(moduleId); memory.delete(moduleId); write() },
  }
}

export function createWorkbenchModuleReceiptStore(initial: readonly WorkbenchModuleReceiptV1[] = []): WorkbenchModuleReceiptStoreV1 {
  const receipts = new Map<string, WorkbenchModuleReceiptV1>()
  for (const receipt of initial) {
    if (receipts.has(receipt.moduleId)) throw new Error(`Duplicate Workbench module receipt: ${receipt.moduleId}`)
    receipts.set(receipt.moduleId, receipt)
  }
  return {
    list: () => [...receipts.values()].sort((left, right) => left.moduleId.localeCompare(right.moduleId)),
    get: moduleId => receipts.get(moduleId),
    put(receipt) {
      const previous = receipts.get(receipt.moduleId)
      if (previous !== undefined && (previous.version !== receipt.version || previous.artifactDigest.toLowerCase() !== receipt.artifactDigest.toLowerCase())) throw new Error(`Workbench module receipt identity conflict: ${receipt.moduleId}`)
      if (previous !== undefined && previous.state !== receipt.state) {
        // Exact repair enters staged from active; rollback may restore the
        // journal's previous active receipt. Identity conflicts stay rejected.
        const allowed = previous.state === 'staged' ? receipt.state === 'installed' || receipt.state === 'restart-required' || receipt.state === 'rolled-back' || receipt.state === 'active'
          : previous.state === 'installed' ? receipt.state === 'restart-required' || receipt.state === 'active' || receipt.state === 'rolled-back'
            : previous.state === 'restart-required' ? receipt.state === 'active' || receipt.state === 'rolled-back'
              : previous.state === 'active' ? receipt.state === 'disabled' || receipt.state === 'rolled-back' || receipt.state === 'staged'
              : previous.state === 'disabled' ? receipt.state === 'active' || receipt.state === 'rolled-back'
                : previous.state === 'rolled-back' ? receipt.state === 'staged'
                  : false
        if (!allowed) throw new Error(`Invalid Workbench module receipt transition: ${previous.state} → ${receipt.state}`)
      }
      receipts.set(receipt.moduleId, receipt)
    },
    remove: moduleId => { receipts.delete(moduleId) },
  }
}
