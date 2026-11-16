import type { WorkbenchModuleIdentityV1 } from './module-catalog.ts'
import type { WorkbenchModuleDeliveryV1, WorkbenchModuleKindV1 } from './module-contract.ts'
import type { WorkbenchModuleSourceV1, WorkbenchModuleTrustV1 } from './module-source.ts'

export type WorkbenchModuleInventoryOwnershipV1 = 'unowned' | 'owned' | 'ownership-invalid' | 'rolled-back'
export type WorkbenchModuleInventoryActivationV1 = 'absent' | 'restart-required' | 'verifying' | 'active' | 'failed'
export type WorkbenchModuleInventoryActionV1 = 'install' | 'provision-official' | 'claim' | 'repair' | 'update' | 'restart' | 'open-details' | 'external-uninstall-required'
export type WorkbenchModuleNativeRuntimeV1 = 'enabled' | 'disabled' | 'restart-required' | 'failed' | 'unknown'

export interface WorkbenchModuleInventoryV1 {
  readonly moduleId: string
  readonly packageName: string
  /** Optional for legacy V1 Host responses; alpha2 Host always returns it. */
  readonly kind?: WorkbenchModuleKindV1
  /** Optional for legacy V1 Host responses; derived from kind when absent. */
  readonly delivery?: WorkbenchModuleDeliveryV1
  /** DSH owns this state. Workbench only projects it. */
  /** Optional for legacy V1 Host responses; alpha2 Host always returns it. */
  readonly nativeRuntime?: WorkbenchModuleNativeRuntimeV1
  readonly source?: WorkbenchModuleSourceV1
  readonly profilePresence: 'absent' | 'present'
  readonly profileIdentity?: { readonly version: string; readonly artifactDigest?: string }
  readonly catalogIdentity?: { readonly version: string; readonly artifactDigest: string; readonly catalogId: string }
  readonly ownership: WorkbenchModuleInventoryOwnershipV1
  readonly activation: WorkbenchModuleInventoryActivationV1
  readonly entryVisibility: 'enabled' | 'hidden' | 'unavailable'
  readonly trust?: WorkbenchModuleTrustV1
  readonly updateAvailable?: boolean
  readonly sourceChangeRequiresConfirmation?: boolean
  readonly allowedActions: readonly WorkbenchModuleInventoryActionV1[]
  readonly diagnosticCode?: string
}

export const WORKBENCH_MODULE_CENTER_ROUTE_V1 = '/api/workbench/module-center/v1'
export const WORKBENCH_CATALOG_ARCHIVE_ROUTE_V1 = '/api/workbench/catalog-archive/v1'

export interface WorkbenchModuleCenterFactsV1 {
  readonly schemaVersion: 1
  readonly catalog: 'missing' | 'available' | 'invalid'
  readonly installed?: WorkbenchModuleIdentityV1
  readonly activation: 'absent' | 'restart-required' | 'active' | 'unverified'
  readonly restartTransactionId?: string
  /** The Profile contains a same-name package that Core does not own. */
  readonly profileConflict?: 'unowned-module'
  readonly inventory?: readonly WorkbenchModuleInventoryV1[]
  readonly catalogs?: readonly {
    readonly catalogId: string
    readonly publisherKeyId: string
    readonly version?: string
    readonly importedAt?: string
    readonly revoked?: boolean
  }[]
  readonly directSourceAvailable?: boolean
}

export interface WorkbenchModuleCenterBridgeV1 {
  facts(): Promise<WorkbenchModuleCenterFactsV1>
  archive(): Promise<Uint8Array>
  retain(bytes: Uint8Array): Promise<void>
}

/** Fixed same-origin endpoints; callers can supply bytes, never locators. */
export function createWorkbenchModuleCenterBridge(fetcher: typeof fetch = fetch): WorkbenchModuleCenterBridgeV1 {
  const checked = async (response: Response): Promise<Response> => {
    if (!response.ok) throw new Error(`Workbench Module center request failed (${String(response.status)})`)
    return response
  }
  return {
    async facts() {
      const value = await (await checked(await fetcher(WORKBENCH_MODULE_CENTER_ROUTE_V1, { credentials: 'same-origin', cache: 'no-store' }))).json() as WorkbenchModuleCenterFactsV1
      if (value.schemaVersion !== 1 || !['missing', 'available', 'invalid'].includes(value.catalog)
        || !['absent', 'restart-required', 'active', 'unverified'].includes(value.activation)
        || (value.profileConflict !== undefined && value.profileConflict !== 'unowned-module')
        || (value.inventory !== undefined && (!Array.isArray(value.inventory) || value.inventory.some(row => typeof row !== 'object' || row === null || typeof (row as WorkbenchModuleInventoryV1).moduleId !== 'string'
          || typeof (row as WorkbenchModuleInventoryV1).packageName !== 'string'
          || ((row as WorkbenchModuleInventoryV1).kind !== undefined && !['official-builtin', 'extension'].includes((row as WorkbenchModuleInventoryV1).kind!))
          || ((row as WorkbenchModuleInventoryV1).delivery !== undefined && !['core-bundled', 'official-component', 'catalog', 'direct-source'].includes((row as WorkbenchModuleInventoryV1).delivery!))
          || ((row as WorkbenchModuleInventoryV1).nativeRuntime !== undefined && !['enabled', 'disabled', 'restart-required', 'failed', 'unknown'].includes((row as WorkbenchModuleInventoryV1).nativeRuntime!))
          || !['absent', 'present'].includes((row as WorkbenchModuleInventoryV1).profilePresence)
          || !['unowned', 'owned', 'ownership-invalid', 'rolled-back'].includes((row as WorkbenchModuleInventoryV1).ownership)
          || !['absent', 'restart-required', 'verifying', 'active', 'failed'].includes((row as WorkbenchModuleInventoryV1).activation)
          || !['enabled', 'hidden', 'unavailable'].includes((row as WorkbenchModuleInventoryV1).entryVisibility)
          || !Array.isArray((row as WorkbenchModuleInventoryV1).allowedActions))))
        || (value.restartTransactionId !== undefined && !/^[A-Za-z0-9._:-]{1,256}$/u.test(value.restartTransactionId))
        || (value.directSourceAvailable !== undefined && typeof value.directSourceAvailable !== 'boolean')
        || (value.installed !== undefined && (value.installed.moduleId !== 'workbench.conversation-suite'
          || typeof value.installed.version !== 'string' || !/^[a-f0-9]{64}$/u.test(value.installed.artifactDigest)))) throw new Error('Invalid Workbench Module center response')
      return value
    },
    async archive() {
      return new Uint8Array(await (await checked(await fetcher(WORKBENCH_CATALOG_ARCHIVE_ROUTE_V1, { credentials: 'same-origin', cache: 'no-store' }))).arrayBuffer())
    },
    async retain(bytes) {
      await checked(await fetcher(WORKBENCH_CATALOG_ARCHIVE_ROUTE_V1, { method: 'POST', credentials: 'same-origin',
        headers: { 'content-type': 'application/octet-stream' }, body: new Uint8Array(bytes).buffer }))
    },
  }
}
