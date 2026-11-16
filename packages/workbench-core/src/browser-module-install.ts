import type { WorkbenchInstallTransactionSnapshotV1 } from './install-coordinator.ts'
import { validateWorkbenchModuleSourceRequest, type WorkbenchModuleSourceRequestV1 } from './module-source.ts'
import { WorkbenchOperationError } from './user-error.ts'
export { WorkbenchOperationError, workbenchUserError } from './user-error.ts'
export type { WorkbenchUserErrorCodeV2, WorkbenchUserErrorV2, WorkbenchUserErrorV2 as WorkbenchUserErrorV1 } from './user-error.ts'

export const WORKBENCH_MODULE_INSTALL_ROUTE_V1 = '/api/workbench/module-install/v1'
export const WORKBENCH_DIRECT_SOURCE_INSTALL_ROUTE_V1 = '/api/workbench/direct-source-install/v1'

export interface WorkbenchModuleInstallFetchV1 {
  (input: RequestInfo | URL, init?: RequestInit): Promise<Response>
}

/** An already active identity is not a hot installation or activation. */
export function isWorkbenchUnchangedActiveInstall(snapshot: WorkbenchInstallTransactionSnapshotV1): boolean {
  return snapshot.state === 'active' && snapshot.stagedModules.length === 0
    && snapshot.installedModules.length === 0 && snapshot.activatedModules.length === 1
    && snapshot.activatedModules[0] === 'workbench.conversation-suite'
}

function base64(bytes: Uint8Array): string {
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + 0x8000, bytes.length)))
  }
  if (typeof btoa !== 'function') throw new Error('Workbench Host install requires browser Base64 support')
  return btoa(binary)
}

function transaction(value: unknown): WorkbenchInstallTransactionSnapshotV1 {
  if (typeof value !== 'object' || value === null) throw new Error('Workbench Host returned an invalid installation response')
  const result = value as { transaction?: unknown }
  const row = result.transaction
  if (typeof row !== 'object' || row === null) throw new Error('Workbench Host returned no installation transaction')
  const snapshot = row as WorkbenchInstallTransactionSnapshotV1
  if (typeof snapshot.transactionId !== 'string' || typeof snapshot.planId !== 'string'
    || !Array.isArray(snapshot.stagedModules) || !Array.isArray(snapshot.installedModules)
    || !Array.isArray(snapshot.activatedModules)
    || (snapshot.state !== 'restart-required' && !isWorkbenchUnchangedActiveInstall(snapshot))) {
    throw new Error('Workbench Host returned an invalid restart-required transaction')
  }
  return snapshot
}

/**
 * The only production browser install request. It has no caller-controlled
 * endpoint, package name, registry URL, filesystem path or Session field.
 */
export function createWorkbenchBrowserSignedCatalogInstallCommit(
  fetcher: WorkbenchModuleInstallFetchV1 = fetch,
): (input: { readonly moduleId: 'workbench.conversation-suite'; readonly archive: Uint8Array; readonly operation?: 'install' | 'claim' | 'repair' }) => Promise<WorkbenchInstallTransactionSnapshotV1> {
  return async ({ moduleId, archive, operation = 'install' }) => {
    const response = await fetcher(WORKBENCH_MODULE_INSTALL_ROUTE_V1, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ schemaVersion: 1, moduleId, ...(operation === 'install' ? {} : { operation }), catalogArchiveBase64: base64(archive) }),
    })
    if (!response.ok) {
      let code: unknown
      try { code = (await response.json() as { error?: unknown }).error } catch { /* retain the fixed safe fallback */ }
      if (code === 'profile-unowned-module-conflict') code = 'profile-unowned-module'
      throw new WorkbenchOperationError(code)
    }
    return transaction(await response.json())
  }
}

/** Host boundary for the explicitly user-approved npm/Git advanced channel. */
export function createWorkbenchBrowserDirectSourceInstallCommit(
  fetcher: WorkbenchModuleInstallFetchV1 = fetch,
): (input: { readonly source: WorkbenchModuleSourceRequestV1; readonly confirmSourceChange?: boolean }) => Promise<WorkbenchInstallTransactionSnapshotV1> {
  return async ({ source, confirmSourceChange = false }) => {
    if (!validateWorkbenchModuleSourceRequest(source)) throw new Error('source-not-allowed')
    const response = await fetcher(WORKBENCH_DIRECT_SOURCE_INSTALL_ROUTE_V1, {
      method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ schemaVersion: 1, source, ...(confirmSourceChange ? { confirmSourceChange: true } : {}) }),
    })
    if (!response.ok) {
      let code: unknown
      try { const value = await response.json() as { error?: unknown; code?: unknown }; code = value.error ?? value.code } catch { /* retain the fixed safe fallback */ }
      throw new WorkbenchOperationError(code, 'source-resolution-failed')
    }
    return transaction(await response.json())
  }
}
