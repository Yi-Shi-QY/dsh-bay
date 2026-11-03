import { randomUUID } from 'node:crypto'
import type { WorkbenchModuleInstallCoordinatorV1, WorkbenchInstallTransactionSnapshotV1 } from './install-coordinator.ts'
import type { WorkbenchModuleReceiptStoreV1 } from './module-receipt.ts'
import type { WorkbenchInstallTransactionJournalV1 } from './transaction-journal.ts'
import type { WorkbenchModuleSourceRequestV1, WorkbenchModuleSourceV1 } from './module-source.ts'
import type { WorkbenchModuleIdentityV1 } from './module-catalog.ts'
import type { WorkbenchModuleInstallPlanV1, WorkbenchModuleInstallVerificationV1 } from './install-plan.ts'
import { resolveWorkbenchDirectPackageV1, type WorkbenchDirectPackageDescriptorV1 } from './source-resolution.ts'
import { classifyWorkbenchSourceUpdate } from './module-source.ts'
import { inspectWorkbenchDirectTarball } from './host-source-resolver.ts'

const MODULE_ID = 'workbench.conversation-suite'
const PACKAGE_NAME = '@dsh-workbench/conversation-suite'

export interface WorkbenchDirectSourceResolvedArtifactV1 extends WorkbenchDirectPackageDescriptorV1 {
  readonly integrity: string
  readonly coreCompatibility?: string
}

export interface WorkbenchDirectSourceResolverV1 {
  resolve(source: WorkbenchModuleSourceRequestV1): Promise<WorkbenchDirectSourceResolvedArtifactV1>
}

export interface WorkbenchHostDirectSourceInstallServiceOptionsV1 {
  readonly resolver: WorkbenchDirectSourceResolverV1
  readonly coordinator: WorkbenchModuleInstallCoordinatorV1
  readonly receipts: WorkbenchModuleReceiptStoreV1
  readonly journal: WorkbenchInstallTransactionJournalV1
  readonly artifactStager: { stage(input: { moduleId: typeof MODULE_ID; version: string; artifactDigest: string; packageName: typeof PACKAGE_NAME; integrity: string; tarball: Uint8Array }): Promise<unknown> }
  readonly profilePresent: () => boolean
  readonly verifyProfile: (verification: WorkbenchModuleInstallVerificationV1) => Promise<void>
  readonly capabilities: () => readonly string[]
  readonly allowedPermissions: readonly string[]
}

function directPlan(identity: WorkbenchModuleIdentityV1, verification: WorkbenchModuleInstallVerificationV1, installed: WorkbenchModuleIdentityV1 | undefined): WorkbenchModuleInstallPlanV1 {
  const exact = installed !== undefined && installed.version === identity.version && installed.artifactDigest.toLowerCase() === identity.artifactDigest.toLowerCase()
  return {
    planId: `workbench-plan-direct-source-${identity.moduleId}@${identity.version}`,
    source: 'direct-source',
    requested: [{ moduleId: identity.moduleId, version: identity.version, artifactDigest: identity.artifactDigest }],
    resolved: [identity], toInstall: exact ? [] : [identity], reused: exact ? [identity] : [], dependencies: [],
    requiredCapabilities: [...verification.requiredCapabilities], verification: [verification], blockers: [], status: 'ready',
  }
}

export function createWorkbenchHostDirectSourceInstallService(options: WorkbenchHostDirectSourceInstallServiceOptionsV1): {
  commit(input: { readonly source: WorkbenchModuleSourceRequestV1; readonly confirmSourceChange?: boolean }): Promise<WorkbenchInstallTransactionSnapshotV1>
} {
  return {
    async commit(input) {
      const descriptor = await options.resolver.resolve(input.source)
      // Re-read manifest and provenance from bytes, even for an injected resolver.
      const inspected = await inspectWorkbenchDirectTarball(descriptor.artifactBytes)
      const resolved = await resolveWorkbenchDirectPackageV1(input.source, { ...descriptor, ...inspected })
      if (resolved.moduleId !== MODULE_ID || resolved.packageName !== PACKAGE_NAME) throw new Error('source-not-allowed')
      if (inspected.permissions.some(permission => !options.allowedPermissions.includes(permission)) || resolved.manifest.requires.capabilities.some(capability => !options.capabilities().includes(capability))) throw new Error('module-incompatible')
      const source: WorkbenchModuleSourceV1 = resolved.source
      const existingReceipt = options.receipts.get(MODULE_ID)
      if (options.coordinator.recoverableTransactions().length > 0) throw new Error('transaction-recovery-required')
      // A source switch needs its own snapshot/confirmation preview. A boolean
      // on an install request never authorizes overwriting an existing source.
      if (existingReceipt?.source !== undefined) {
        const decision = classifyWorkbenchSourceUpdate(existingReceipt.source, source)
        if (decision === 'source-change') throw new Error('source-change-requires-confirmation')
        if (decision === 'downgrade') throw new Error('version-downgrade')
        if (decision === 'identity-conflict') throw new Error('profile-identity-conflict')
        if (decision === 'update-available') throw new Error('transaction-recovery-required')
      }
      if (existingReceipt?.state === 'active' && options.profilePresent() && existingReceipt.verification !== undefined
        && existingReceipt.version === resolved.manifest.version && existingReceipt.artifactDigest === resolved.artifactDigest) {
        await options.verifyProfile(existingReceipt.verification)
        const existingTransaction = options.journal.list().find(record => record.snapshot.state === 'active' && record.modules?.some(module => module.moduleId === MODULE_ID && module.artifactDigest === resolved.artifactDigest))
        if (!existingTransaction) throw new Error('transaction-recovery-required')
        return { transactionId: existingTransaction.transactionId, planId: existingTransaction.snapshot.planId, state: 'active', stagedModules: [], installedModules: [], activatedModules: [MODULE_ID] }
      }
      if (options.profilePresent()) throw new Error('profile-unowned-module')
      if (existingReceipt !== undefined) throw new Error('transaction-recovery-required')
      const verification: WorkbenchModuleInstallVerificationV1 = {
        moduleId: MODULE_ID, version: resolved.manifest.version, artifactDigest: resolved.artifactDigest,
        origin: source,
        packageName: PACKAGE_NAME, coreCompatibility: resolved.manifest.coreCompatibility,
        sourceLocator: `artifacts/${resolved.artifactDigest}.tgz`, integrity: inspected.integrity,
        catalogId: `direct:${resolved.artifactDigest}`, publisherKeyId: 'user-approved', dshGeneration: descriptor.dshGeneration,
        requiredCapabilities: [...resolved.manifest.requires.capabilities], permissions: [...inspected.permissions],
        provenance: inspected.provenance,
        editorIds: [...resolved.manifest.provides.editorIds], scope: resolved.manifest.activation.scope,
      }
      const identity = { moduleId: MODULE_ID, version: resolved.manifest.version, artifactDigest: resolved.artifactDigest }
      await options.artifactStager.stage({ moduleId: MODULE_ID, version: identity.version, artifactDigest: identity.artifactDigest, packageName: PACKAGE_NAME, integrity: inspected.integrity, tarball: descriptor.artifactBytes })
      const plan = directPlan(identity, verification, undefined)
      const transaction = await options.coordinator.stagePlan(plan, `workbench-direct-source-${randomUUID()}`)
      await options.coordinator.install(transaction.transactionId)
      const result = options.coordinator.getTransaction(transaction.transactionId)
      if (result?.state !== 'restart-required') throw new Error('restart-required')
      return result
    },
  }
}
