import type { PortableLayoutV2 } from './foundation/workbench-layout-package.ts'
import type { WorkbenchPackageDependencyV4, WorkbenchPackageManifestV4, WorkbenchPackageModeV4 } from './foundation/workbench-package-v4.ts'
import type { WorkbenchDocumentV3 } from './foundation/document-v3.ts'
import type { RestoredPortableWorkbenchContextV1 } from './foundation/workbench-context-portability.ts'
import type { WorkbenchExtensionConsentV1 } from './workbench-extension-access.ts'
export const DISTRIBUTION_ROUTE = '/api/workbench/distribution/v4'
export const CORE_PORTABLE_EDITORS = ['workbench.conversation.start','workbench.conversation','workbench.agent-trajectory','workbench.workspace-files','workbench.document-preview','workbench.browser','workbench.terminal','workbench.plan','workbench.changes-review','workbench.subagent-chat','workbench.schedule-task','workbench.guide'] as const
export interface DistributionImportStatus {
  transactionId: string; archiveSha256: string; workbenchId: string; name: string; createdAt: number
  mode: WorkbenchPackageModeV4; keyId?: string
  state: 'checked' | 'installing' | 'restart-required' | 'awaiting-restore' | 'ready' | 'needs-input' | 'cancelled' | 'failed' | 'recovery-required'
  dependencies: WorkbenchPackageDependencyV4[]; installed: string[]; reused: string[]; blockers: string[]
  plannedReuse?: string[]
  layout?: PortableLayoutV2
  pendingPageIds?: string[]
  pendingTargets?: Record<string,string>
}
export interface DistributionClientV4 {
  preparePending(id:string):Promise<void>
  prepare(input: { layout: PortableLayoutV2; mode: WorkbenchPackageModeV4; prepareArtifacts: boolean; derivedFrom?: WorkbenchPackageManifestV4['derivedFrom'] }): Promise<Uint8Array>
  inspect(bytes: Uint8Array): Promise<DistributionImportStatus>
  consent(id: string, digest: string): Promise<DistributionImportStatus>
  resume(id: string): Promise<DistributionImportStatus>
  complete(id: string, document: WorkbenchDocumentV3, consents: Record<string, WorkbenchExtensionConsentV1>, pendingPageIds?: string[], context?: RestoredPortableWorkbenchContextV1): Promise<DistributionImportStatus>
  restorePending(id: string, document: WorkbenchDocumentV3, expectedDocument: WorkbenchDocumentV3, restoredPageIds: string[]): Promise<DistributionImportStatus>
  cancel(id: string): Promise<DistributionImportStatus>
  history(): Promise<DistributionImportStatus[]>
  artifactIdentities(): Promise<WorkbenchPackageDependencyV4[]>
}
/** V4 authority is a compatibility extension of the existing Host runtime seam. */
export interface DistributionAuthorityV4 {
  preparePending:DistributionClientV4['preparePending']
  export(input:Parameters<DistributionClientV4['prepare']>[0]):Promise<Uint8Array>
  inspect:DistributionClientV4['inspect']; consent:DistributionClientV4['consent']; resume:DistributionClientV4['resume']
  complete:DistributionClientV4['complete']; restorePending:DistributionClientV4['restorePending']; cancel:DistributionClientV4['cancel']; history:DistributionClientV4['history']
  identities():Promise<WorkbenchPackageDependencyV4[]>
}
export function createHostDistributionRuntimeV4(packagesV4:DistributionAuthorityV4,version:string){
  return Object.freeze({version:1 as const,authority:'host' as const,label:'DSH Profile 工作台分发',identity:{runtimeId:'dsh-profile-distribution',version},
    capabilities:{durableArtifacts:true,durableRegistry:true,durableTransactions:true,staticActivation:true,dynamicActivation:false,restartResume:true},packagesV4})
}
export function createDistributionClient(fetcher: typeof fetch = fetch): DistributionClientV4 {
  const request = async <T>(action: string, body?: unknown): Promise<T> => {
    const response = await fetcher(`${DISTRIBUTION_ROUTE}/${action}`, { method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) })
    const result = await response.json() as { value?: T; error?: string }
    if (!response.ok || result.error) throw new Error(result.error ?? '工作台分发服务不可用。')
    return result.value as T
  }
  const base64 = (bytes: Uint8Array) => { let s = ''; for (let i=0;i<bytes.length;i+=16384) s += String.fromCharCode(...bytes.subarray(i,i+16384)); return btoa(s) }
  return {
    preparePending:transactionId=>request('prepare-pending',{transactionId}),
    async prepare(input) { const value = await request<string>('export', input); return Uint8Array.from(atob(value), c => c.charCodeAt(0)) },
    inspect: bytes => request('inspect', { archive: base64(bytes) }),
    consent: (transactionId, archiveSha256) => request('consent', { transactionId, archiveSha256, confirmed: true }),
    resume: transactionId => request('resume', { transactionId }),
    complete: (transactionId, document, consents, pendingPageIds = [], context) => request('complete', { transactionId, document, consents, pendingPageIds, ...(context === undefined ? {} : { context }) }),
    restorePending: (transactionId, document, expectedDocument, restoredPageIds) => request('restore-pending', { transactionId, document, expectedDocument, restoredPageIds }),
    cancel: transactionId => request('cancel', { transactionId }),
    history: () => request('history'), artifactIdentities: () => request('identities'),
  }
}
