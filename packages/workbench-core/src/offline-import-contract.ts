import type { WorkbenchModuleIdentityV1 } from './module-catalog.ts'

export const WORKBENCH_OFFLINE_IMPORT_ROUTE = '/api/workbench/offline-import/v1'
export type WorkbenchOfflineImportState = 'prepared' | 'installing' | 'restart-required' | 'verifying' | 'committing-layout' | 'completed' | 'failed'

/** Identity-only recovery record; portable layout and artifacts live in the original archive. */
export interface WorkbenchOfflineImportReceipt {
  schemaVersion: 1
  packageId: string
  archiveSha256: string
  state: WorkbenchOfflineImportState
  modules: readonly WorkbenchModuleIdentityV1[]
  workbenchId: string
  moduleTransactionId?: string
  error?: 'module-failed' | 'layout-pending' | 'recovery-failed' | 'rollback-pending'
}

export interface WorkbenchOfflineImportPreflight {
  packageId: string
  action: 'install-and-restart' | 'reuse' | 'resume' | 'already-imported'
}
