import type { WorkbenchSettingsScope as SettingsScope } from '../client/workbench-settings-contracts.ts'
import {createDistributionPackageService, type DistributionPackageService} from './distribution-package-service.ts'
import type { SettingsScopePatchResult } from '../client/workbench-settings-contracts.ts'
import type { WorkbenchEditorCatalog, WorkbenchEditorCatalogRow } from './catalog.ts'
import { buildWorkbenchInventory } from './workbench-inventory.ts'
import {
  scanWorkbenchDependencies,
  validateWorkbenchAgentPresetDistributionDescriptor,
  type WorkbenchDependencyScanReportV1,
  type WorkbenchDependencyArtifactInfoV1,
  type WorkbenchAgentPresetDependencyInputV1,
  type WorkbenchAgentPresetDistributionDescriptorV1,
  type WorkbenchDependencySnapshotV1,
  type WorkbenchDependencyLockEntryV1,
  type WorkbenchDistributionDescriptorV1,
} from './workbench-distribution.ts'
import {
  buildWorkbenchPackage,
  encodeWorkbenchPackageArchive,
  importPortableWorkbench,
  projectWorkbenchSessionsAndAgentPresetsForSharing,
  type BuiltWorkbenchPackageV1,
  type WorkbenchPackageCompatibilityV1,
  type WorkbenchPackageManifestV1,
  type WorkbenchSessionTemplateBindingsV1,
  type WorkbenchSessionTemplateResolverV1,
} from './workbench-sharing.ts'
import {
  importWorkbenchPackageArchiveIntoSettings,
  preflightWorkbenchPackageArchive,
  type WorkbenchPackageImportOptionsV1,
  type WorkbenchPackageImportResultV1,
  type WorkbenchPackageImportDependencyStatusV1,
  type WorkbenchDependencyInstallerV1,
  type WorkbenchPackageInstallerV1,
  type WorkbenchPackagePreflightEnvironmentV1,
  type WorkbenchPackagePreflightResultV1,
  type WorkbenchDependencyActivationReceiptV1,
  type WorkbenchDependencyInstallReceiptV1,
} from './workbench-package-import.ts'
import type { WorkbenchExternalBindingRecordV1, WorkbenchPackageOriginV1, WorkbenchSettingsV4 } from './persistence.ts'
import type { WorkbenchArtifactBundleV1, WorkbenchArtifactRecordV1, WorkbenchArtifactStoreV1 } from './workbench-artifact-store.ts'
import type { WorkbenchImportTransactionStoreV1 } from './workbench-import-transaction.ts'
import {
  WorkbenchExportPreparationTransactionControllerV1,
  type WorkbenchExportPreparationStateV1,
  type WorkbenchExportPreparationTransactionStoreV1,
} from './workbench-export-preparation-transaction.ts'
import type { WorkbenchRegistryV1 } from './workbench-package-registry.ts'
import {
  type WorkbenchDistributionRuntimeResolverV1,
  type WorkbenchRuntimeReadinessSnapshotV1,
  type WorkbenchDistributionRuntimeStatusV1,
  validateWorkbenchDistributionRuntimeV1,
  validateWorkbenchRuntimeReadinessSnapshotV1,
  workbenchDistributionRuntimeStatus,
} from './workbench-distribution-runtime.ts'
import {
  inspectWorkbenchExportReadiness,
  type WorkbenchExportReadinessInspectionV1,
  type WorkbenchExportReadinessModeV1,
  type WorkbenchExportReadinessCoordinatorV1,
  type WorkbenchExportPreparationInputV1,
  type WorkbenchExportPreparationOptionsV1,
  type WorkbenchExportPreparationResultV1,
} from './workbench-export-readiness.ts'
import { createWorkbenchHttpExportArtifactProvider, type WorkbenchExportArtifactProviderV1 } from './workbench-export-artifact-provider.ts'

/** The small runtime face consumed by the Settings import/export wizard. */
export interface WorkbenchPackageServiceV1 {
  /** Pure archive inspection. It never installs, runs code or writes Settings. */
  preflight?(archive: Uint8Array): Promise<WorkbenchPackagePreflightResultV1>
  preflightArchive(archive: Uint8Array): Promise<WorkbenchPackagePreflightResultV1>
  importArchive(
    archive: Uint8Array,
    options?: Pick<WorkbenchPackageImportOptionsV1,
      'installPlugins' | 'loadAfterImport' | 'verifyInstalledEditors' | 'transactionId'
      | 'verifyInstalledAgentPresets' | 'sessionTemplateBindings' | 'approvedPermissions' | 'deferDynamicActivation' | 'onProgress'>,
  ): Promise<WorkbenchPackageImportResultV1>
  /** Check the recipient Runtime before any package bytes are installed. */
  inspectImportDependencies?: (
    report: WorkbenchPackagePreflightResultV1,
  ) => Promise<readonly WorkbenchPackageImportDependencyStatusV1[]>
  /** Safe creator-facing one-click preparation: installs and verifies dependencies,
   * but never activates or switches the imported Workbench. */
  prepareImport?: (
    archive: Uint8Array,
    options?: Pick<WorkbenchPackageImportOptionsV1, 'transactionId' | 'sessionTemplateBindings' | 'approvedPermissions' | 'onProgress'>,
  ) => Promise<WorkbenchPackageImportResultV1>
  /** Resume a journaled post-restart transaction using the Runtime registry's
   * verified archive.  No archive bytes are accepted from the UI on resume. */
  resumeImport?: (transactionId: string) => Promise<WorkbenchPackageImportResultV1>
  /** High-level import coordinator. Preparation always commits an inactive record;
   * Dynamic Runner dependencies are deferred until bind() has selected a Session. */
  prepare?(
    archive: Uint8Array,
    options?: Pick<WorkbenchPackageImportOptionsV1, 'transactionId' | 'approvedPermissions' | 'sessionTemplateBindings' | 'onProgress'>,
  ): Promise<WorkbenchImportPreparationResultV1>
  /** Bind recipient-owned Session/Workspace references without importing author identity. */
  bind?(
    workbenchId: string,
    bindings: WorkbenchExternalBindingInputV1,
  ): Promise<WorkbenchBindingResultV1>
  /** Final, explicit lifecycle action. This is the only high-level method allowed to switch active Workbench. */
  activate?(workbenchId: string): Promise<WorkbenchActivationResultV1>
  exportArchive(workbenchId: string, options?: WorkbenchPackageExportOptionsV1): Promise<WorkbenchPackageExportResultV1>
  /**
   * Optional for backwards-compatible Settings integrations. The runtime
   * service created by `createWorkbenchPackageService` always provides it,
   * but older host/test adapters may only implement import/export/preflight.
   */
  inspectDependencies?: (workbenchId: string) => WorkbenchDependencySnapshotV1 | undefined
  /** Full creator-facing scan, including active Areas and derived npm view. */
  scanDependencies?: (workbenchId: string) => WorkbenchDependencyScanReportV1 | undefined
  /** Pure export-side projection used by the readiness wizard. */
  inspectExportReadiness?: (
    workbenchId: string,
    mode: WorkbenchExportReadinessModeV1,
  ) => WorkbenchExportReadinessInspectionV1 | undefined
  /** Optional Runtime-owned repair actions. The plugin never implements npm/Runner actions itself. */
  exportReadinessCoordinator?: WorkbenchExportReadinessCoordinatorV1
  /** Direct creator action. Kept separate so UI does not depend on optional seam shape. */
  prepareExportDependencies?: (
    input: WorkbenchExportPreparationInputV1,
    options?: WorkbenchExportPreparationOptionsV1,
  ) => Promise<WorkbenchExportPreparationResultV1>
  /** Live Runtime capability report; unlike package metadata this may change after boot. */
  runtimeStatus?: () => WorkbenchDistributionRuntimeStatusV1
  /** Attested external dependency readiness; absent Runtime is explicitly unknown. */
  runtimeReadiness?: () => WorkbenchRuntimeReadinessSnapshotV1
  subscribeRuntime?: (listener: () => void) => () => void
  /** Optional Runtime-owned request to restart and resume a waiting import. */
  requestRestart?: (transactionId: string) => Promise<void> | void
  /** Live capability projection. A Runtime object alone does not imply that
   * this instance is Manager-supervised or can safely relaunch itself. */
  restartAvailable?: () => boolean
}

export type WorkbenchExternalBindingKindV1 = 'model' | 'credential' | 'workspace' | 'session' | 'mcp' | 'filesystem'

/**
 * Recipient-owned references only. Values are opaque local handles, never
 * credentials, tokens, absolute paths, Session transcripts or author IDs.
 */
export interface WorkbenchExternalBindingInputV1 {
  sessionTemplateBindings?: WorkbenchSessionTemplateBindingsV1
  inputs?: Readonly<Record<string, WorkbenchExternalBindingRefV1>>
}

export interface WorkbenchExternalBindingRefV1 {
  kind: WorkbenchExternalBindingKindV1
  reference: string
}

const EXTERNAL_BINDING_FORBIDDEN = /(?:api[-_]?key|token|password|secret|credential|transcript|session[-_]?id|workspace[-_]?id|machine[-_]?id|(?:^|[\\/])(?:Users|home|var|etc)(?:[\\/]|$))/iu

function validateExternalBindingRef(value: WorkbenchExternalBindingRefV1): boolean {
  return typeof value.reference === 'string'
    && value.reference.trim() !== ''
    && value.reference.length <= 512
    && !EXTERNAL_BINDING_FORBIDDEN.test(value.reference)
}

export type WorkbenchImportPreparationResultV1 =
  | {
      status: 'ready-to-bind'
      workbenchId: string
      revision: number
      report: WorkbenchPackagePreflightResultV1
      requiredInputs: WorkbenchRuntimeReadinessSnapshotV1['requiredInputs']
    }
  | Extract<WorkbenchPackageImportResultV1, { status: 'preflight-failed' | 'conflict' | 'unavailable' | 'waiting-restart' }>

export type WorkbenchBindingResultV1 =
  | {
      status: 'committed'
      workbenchId: string
      revision: number
      pendingInputs: WorkbenchRuntimeReadinessSnapshotV1['requiredInputs']
    }
  | { status: 'conflict'; expectedRevision: number | undefined; actualRevision: number | undefined }
  | { status: 'unavailable'; reason: string }

export type WorkbenchActivationResultV1 =
  | { status: 'committed'; workbenchId: string; revision: number }
  | { status: 'needs-input'; workbenchId: string; inputs: WorkbenchRuntimeReadinessSnapshotV1['requiredInputs'] }
  | { status: 'conflict'; expectedRevision: number | undefined; actualRevision: number | undefined }
  | { status: 'unavailable'; reason: string }

export interface WorkbenchPackageExportOptionsV1 {
  distributionMode?: 'online-reference' | 'offline-embedded'
}

export type WorkbenchPackageExportResultV1 =
  | {
      status: 'committed'
      filename: string
      archive: Uint8Array
      manifest: WorkbenchPackageManifestV1
    }
  | {
      status: 'unavailable'
      reason: string
    }

export interface WorkbenchPackageServiceOptionsV1 {
  scope: SettingsScope<WorkbenchSettingsV4>
  editorCatalog: WorkbenchEditorCatalog
  environment: WorkbenchPackagePreflightEnvironmentV1
  /** Optional package version used for local exports. */
  packageVersion?: string
  /** Runtime-owned distribution declarations; no package paths are guessed. */
  distributions?: readonly WorkbenchDistributionDescriptorV1[]
  /** Content-addressed artifacts already staged in the local store. */
  artifacts?: readonly WorkbenchDependencyArtifactInfoV1[]
  /** Content-addressed store used by complete-offline imports. */
  artifactStore?: WorkbenchArtifactStoreV1
  /** Durable import phase journal owned by the Package Registry adapter. */
  transactionStore?: WorkbenchImportTransactionStoreV1
  /** Separate durable journal for cancelable export-side preparation. */
  exportPreparationStore?: WorkbenchExportPreparationTransactionStoreV1
  /** Optional Runtime-owned read seam for identity-free Agent/model hints. */
  sessionTemplateResolver?: WorkbenchSessionTemplateResolverV1
  /** Optional Runtime-owned export repair coordinator; never implemented in the browser. */
  exportReadinessCoordinator?: WorkbenchExportReadinessCoordinatorV1
  /** Local registry receives a receipt only after editor verification and Settings commit. */
  packageRegistry?: WorkbenchRegistryV1
  /** Static/Dynamic Runtime adapter used only after preflight approval. */
  dependencyInstaller?: WorkbenchDependencyInstallerV1
  /** DSH Profile adapter that delegates online package installs to pnpm/npm. */
  packageInstaller?: WorkbenchPackageInstallerV1
  /** Runtime-owned catalog verification used before the Workbench CAS commit. */
  verifyInstalledEditors?: WorkbenchPackageImportOptionsV1['verifyInstalledEditors']
  /** Runtime-owned Agent preset provenance verification before Settings CAS. */
  verifyInstalledAgentPresets?: WorkbenchPackageImportOptionsV1['verifyInstalledAgentPresets']
  /** Capabilities supplied by the DSH base runtime and excluded from the package. */
  runtimeProvided?: readonly string[]
  /** Late-bound Host/Manager authority. Browser-only compositions leave it absent. */
  distributionRuntime?: WorkbenchDistributionRuntimeResolverV1
  subscribeDistributionRuntime?: (listener: () => void) => () => void
  /** Host-owned npm pack/read seam. The default uses the DSH loopback route. */
  exportArtifactProvider?: WorkbenchExportArtifactProviderV1
  /** Optional Manager/Launcher restart bridge used by the import confirmation UI. */
  requestRestart?: (transactionId: string) => Promise<void> | void
}

function safeFilename(value: string): string {
  const normalized = value.trim().replace(/[\\/:*?"<>|]+/gu, '-').replace(/\s+/gu, ' ')
  return normalized === '' ? 'workbench' : normalized.slice(0, 96)
}

function compatibilityFor(environment: WorkbenchPackagePreflightEnvironmentV1): WorkbenchPackageCompatibilityV1 {
  return {
    dsh: { minimum: environment.dshVersion },
    previewProtocol: { minimum: 1 },
    targets: ['web'],
  }
}

/**
 * Create the browser-facing package service from the same Settings scope and
 * Slot catalog used by the Frame. Export intentionally contains a detached
 * layout projection; executable plugin artifacts are included only from the
 * Runtime-owned catalog/Artifact Store and never guessed from plugin IDs.
 */
type WorkbenchPackageServiceOptionsV4 = Parameters<typeof createDistributionPackageService>[0] & {version:4}
export function createWorkbenchPackageService(options:WorkbenchPackageServiceOptionsV4):DistributionPackageService
export function createWorkbenchPackageService(options:WorkbenchPackageServiceOptionsV1):WorkbenchPackageServiceV1
export function createWorkbenchPackageService(options:WorkbenchPackageServiceOptionsV1|WorkbenchPackageServiceOptionsV4):DistributionPackageService|WorkbenchPackageServiceV1 {
  return 'version' in options ? createDistributionPackageService(options) : createLegacyWorkbenchPackageService(options)
}
function createLegacyWorkbenchPackageService(
  options: WorkbenchPackageServiceOptionsV1,
): WorkbenchPackageServiceV1 {
  const runtime = () => {
    const candidate = options.distributionRuntime?.()
    // This is a privileged Host/Manager boundary. Checking only `version`
    // would allow a plugin-shaped object to masquerade as the Runtime and
    // make the coordinator call untrusted callbacks. Invalid authorities
    // collapse to the safe layout-only fallback.
    return validateWorkbenchDistributionRuntimeV1(candidate) ? candidate : undefined
  }
  const environment = (): WorkbenchPackagePreflightEnvironmentV1 => ({
    ...options.environment,
    ...(runtime()?.environment?.() ?? {}),
  })
  const runtimeArtifacts = (): readonly WorkbenchDependencyArtifactInfoV1[] => runtime()?.artifacts?.() ?? []
  const exportArtifactProvider = options.exportArtifactProvider ?? createWorkbenchHttpExportArtifactProvider()
  const preparedNpmArtifacts = new Map<string, { digest: string; integrity: string; tarball: Uint8Array }>()
  // Host pack bytes are kept in the short-lived preparation journal when the
  // Profile has no durable Artifact Store (for example the ordinary web
  // profile). They are still re-verified at archive construction time.
  const preparedExportArtifacts = new Map<string, WorkbenchDependencyArtifactInfoV1>()
  const storedArtifacts = (): readonly WorkbenchDependencyArtifactInfoV1[] => {
    const store = runtime()?.artifactStore ?? options.artifactStore
    return store?.list?.().map(bundle => ({
      digest: bundle.record.digest,
      availability: 'embedded' as const,
      ...(bundle.record.clientEntry === undefined ? {} : { clientEntry: bundle.record.clientEntry }),
      ...(bundle.record.hostEntry === undefined ? {} : { hostEntry: bundle.record.hostEntry }),
      files: bundle.files,
      record: { ...bundle.record },
    })) ?? []
  }
  const originRequirements = (origin: WorkbenchPackageOriginV1, portableId: string) =>
    origin.dependencies
      .filter(candidate => candidate.requiredBy.includes(portableId))
      .map(candidate => ({
        portableId: candidate.portableId,
        versionRange: candidate.version,
        ...(candidate.digest === '' ? {} : { digest: candidate.digest }),
      }))
  const originDescriptors = (origin: WorkbenchPackageOriginV1 | undefined): readonly WorkbenchDistributionDescriptorV1[] =>
    (origin?.dependencies ?? [])
      // Keep shared/transitive rows as descriptors too.  An imported
      // Workbench may no longer expose a shared package through an editor
      // directly, but an active editor can still require it transitively.
      // Dropping editorIds===[] here made a creator re-export report that
      // dependency as "missing" after the first import, even though its
      // immutable lock row and artifact receipt were still present.
      .filter(dependency => dependency.kind !== 'agent-preset')
      .map(dependency => ({
        version: 1,
        portableId: dependency.portableId,
        packageVersion: dependency.version,
        ...(dependency.digest === '' ? {} : { artifactDigest: dependency.digest }),
        exportPolicy: dependency.exportPolicy,
        sourcePolicy: dependency.sourcePolicy,
        provides: { editorIds: [...dependency.editorIds] },
        requires: origin === undefined ? [] : originRequirements(origin, dependency.portableId),
        permissions: [...dependency.permissions],
        ...(dependency.packageName === undefined ? {} : { packageName: dependency.packageName }),
        ...(dependency.registryUrl === undefined ? {} : { registryUrl: dependency.registryUrl }),
        ...(dependency.integrity === undefined ? {} : { integrity: dependency.integrity }),
        ...(dependency.installSource === undefined ? {} : { installSource: dependency.installSource }),
      }))
  const runtimeDistributions = (): readonly WorkbenchDistributionDescriptorV1[] => runtime()?.distributions?.() ?? []
  const runtimeAgentPresetDistributions = (): readonly WorkbenchAgentPresetDistributionDescriptorV1[] => runtime()?.agentPresetDistributions?.() ?? []
  const runtimeAgentPresetDependencies = (): readonly WorkbenchAgentPresetDependencyInputV1[] => runtime()?.agentPresetDependencies?.() ?? []
  const runtimeProvided = (): readonly string[] => [
    ...(options.runtimeProvided ?? []),
    ...(runtime()?.runtimeProvided?.() ?? []),
  ]
  const preflight = (archive: Uint8Array) => preflightWorkbenchPackageArchive(archive, environment())
  const inspectImportDependencies = async (
    report: WorkbenchPackagePreflightResultV1,
  ): Promise<readonly WorkbenchPackageImportDependencyStatusV1[]> => {
    const dependencies = report.dependencyLock ?? []
    const catalog = options.editorCatalog.getSnapshot()
    const runtimeAvailable = runtime() !== undefined
      || options.artifactStore !== undefined
      || options.artifacts !== undefined
    const artifacts = [
      ...(options.artifacts ?? []),
      ...runtimeArtifacts(),
      ...storedArtifacts(),
    ]
    const digestOf = (row: WorkbenchEditorCatalogRow): string | undefined =>
      row.provenance?.artifactDigest ?? row.provenance?.dynamic?.artifactDigest
    return dependencies.map(dependency => {
      const matchingArtifact = artifacts.find(artifact =>
        artifact.digest.toUpperCase() === dependency.digest.toUpperCase()
        && (artifact.availability === 'installed' || artifact.availability === 'embedded'))
      const installedArtifact = matchingArtifact?.availability === 'installed'
      const expectedEditors = dependency.editorIds
      const installedEditors = expectedEditors.length > 0 && expectedEditors.every(editorId => {
        const expectedScope = dependency.editorScopes?.find(item => item.editorId === editorId)?.scope
        return catalog.some(row => row.id === editorId
          && (expectedScope === undefined || row.scope === expectedScope)
          && digestOf(row)?.toUpperCase() === dependency.digest.toUpperCase())
      })
      const conflictingEditors = expectedEditors.some(editorId => {
        const rows = catalog.filter(row => row.id === editorId)
        if (rows.length === 0) return false
        const expectedScope = dependency.editorScopes?.find(item => item.editorId === editorId)?.scope
        return rows.some(row => (expectedScope !== undefined && row.scope !== expectedScope)
          || digestOf(row)?.toUpperCase() !== dependency.digest.toUpperCase())
      })
      const localStatus: WorkbenchPackageImportDependencyStatusV1['localStatus'] = installedEditors
        // Dependencies without an editor (shared libraries, MCP and skill
        // bundles) have no catalog row to prove activation.  A Runtime-owned
        // artifact explicitly marked `installed` is the only safe equivalent
        // proof; an embedded/staged artifact remains merely available.
        || (expectedEditors.length === 0 && installedArtifact) ? 'installed'
        : conflictingEditors ? 'conflict'
          : matchingArtifact !== undefined ? 'available'
            : runtimeAvailable ? 'missing' : 'unknown'
      const packageStatus: WorkbenchPackageImportDependencyStatusV1['packageStatus'] =
        dependency.artifactPath !== undefined || dependency.npmArtifactPath !== undefined
          ? 'embedded'
          : dependency.installSource === 'npm' || dependency.installSource === 'registry' || dependency.registryUrl !== undefined
            ? 'registry' : 'unavailable'
      const pluginPlan = report.plugins.find(plugin =>
        plugin.manifest.packageId === dependency.portableId
          || plugin.manifest.packageId === dependency.packageName)
      return {
        portableId: dependency.portableId,
        ...(dependency.packageName === undefined ? {} : { packageName: dependency.packageName }),
        version: dependency.version,
        digest: dependency.digest,
        kind: dependency.kind,
        editorIds: [...dependency.editorIds],
        localStatus,
        packageStatus,
        ...(pluginPlan?.requiresRestart === true ? { requiresRestart: true } : {}),
      }
    })
  }
  /**
   * A short-lived coordinator cache bridges the two explicit user actions
   * (`prepare` and `bind`). It contains only the already-validated portable
   * projection and identity-free session templates; executable bytes remain in
   * the Runtime Artifact Store. Durable lineage is still carried by the
   * committed Workbench packageOrigin and Registry receipt.
   */
  type PreparedWorkbench = {
    report: WorkbenchPackagePreflightResultV1
    projection: NonNullable<WorkbenchPackagePreflightResultV1['projection']>
    boundInputs: Readonly<Record<string, WorkbenchExternalBindingRefV1>>
    sessionTemplateBindings?: WorkbenchSessionTemplateBindingsV1
    deferredDynamicReceipts: WorkbenchDependencyActivationReceiptV1[]
    transactionId?: string
  }
  const preparedWorkbenches = new Map<string, PreparedWorkbench>()
  const runImport = (archive: Uint8Array, importOptions: Pick<WorkbenchPackageImportOptionsV1,
    'installPlugins' | 'loadAfterImport' | 'verifyInstalledEditors' | 'transactionId'
    | 'verifyInstalledAgentPresets' | 'sessionTemplateBindings' | 'approvedPermissions' | 'deferDynamicActivation' | 'onProgress'> = {}) => importWorkbenchPackageArchiveIntoSettings(
      options.scope,
      archive,
      {
        environment: environment(),
        installPlugins: importOptions.installPlugins ?? false,
        loadAfterImport: importOptions.loadAfterImport ?? false,
        ...((runtime()?.artifactStore ?? options.artifactStore) === undefined ? {} : { artifactStore: runtime()?.artifactStore ?? options.artifactStore }),
        ...((runtime()?.transactionStore ?? options.transactionStore) === undefined ? {} : { transactionStore: runtime()?.transactionStore ?? options.transactionStore }),
        ...((runtime()?.packageRegistry ?? options.packageRegistry) === undefined ? {} : { packageRegistry: runtime()?.packageRegistry ?? options.packageRegistry }),
        ...(importOptions.transactionId === undefined ? {} : { transactionId: importOptions.transactionId }),
        ...(importOptions.sessionTemplateBindings === undefined ? {} : { sessionTemplateBindings: importOptions.sessionTemplateBindings }),
        ...(importOptions.approvedPermissions === undefined ? {} : { approvedPermissions: importOptions.approvedPermissions }),
        ...(importOptions.deferDynamicActivation === undefined ? {} : { deferDynamicActivation: importOptions.deferDynamicActivation }),
        ...(importOptions.onProgress === undefined ? {} : { onProgress: importOptions.onProgress }),
        editorCatalog: () => options.editorCatalog.getSnapshot(),
        ...((runtime()?.dependencyInstaller ?? options.dependencyInstaller) === undefined ? {} : { dependencyInstaller: runtime()?.dependencyInstaller ?? options.dependencyInstaller }),
        ...((runtime()?.packageInstaller ?? options.packageInstaller) === undefined ? {} : { packageInstaller: runtime()?.packageInstaller ?? options.packageInstaller }),
        ...(importOptions.verifyInstalledEditors !== undefined
          ? { verifyInstalledEditors: importOptions.verifyInstalledEditors }
          : options.verifyInstalledEditors !== undefined ? { verifyInstalledEditors: options.verifyInstalledEditors } : {}),
        ...(importOptions.verifyInstalledAgentPresets !== undefined
          ? { verifyInstalledAgentPresets: importOptions.verifyInstalledAgentPresets }
          : options.verifyInstalledAgentPresets !== undefined
            ? { verifyInstalledAgentPresets: options.verifyInstalledAgentPresets }
            : runtime()?.verifyInstalledAgentPresets === undefined ? {} : { verifyInstalledAgentPresets: runtime()!.verifyInstalledAgentPresets }),
      },
    )
  const resumeImport = async (transactionId: string): Promise<WorkbenchPackageImportResultV1> => {
    const transactionStore = runtime()?.transactionStore ?? options.transactionStore
    const transaction = transactionStore?.get(transactionId)
    if (transaction === undefined) return { status: 'unavailable', reason: '找不到可恢复的工作台导入事务。' }
    const registry = runtime()?.packageRegistry ?? options.packageRegistry
    const archive = registry?.download(transaction.packageId, transaction.packageVersion)
      ?? registry?.stagedArchive?.(transaction.packageId, transaction.packageVersion, transaction.archiveSha256)
    if (transaction.state === 'ready') {
      if (transaction.workbenchId === undefined || transaction.committedRevision === undefined) {
        return { status: 'unavailable', reason: '已完成事务缺少提交结果，不能安全恢复。' }
      }
      // Rehydrate the short-lived preparation cache when the UI process was
      // restarted after commit.  The Settings row remains durable, but
      // session-template binding still needs the validated portable projection.
      if (archive !== undefined) {
        const report = await preflight(archive)
        if (report.valid && report.projection !== undefined) {
          preparedWorkbenches.set(transaction.workbenchId, { report, projection: report.projection, boundInputs: {}, deferredDynamicReceipts: [], transactionId: transaction.transactionId })
        }
      }
      return { status: 'committed', workbenchId: transaction.workbenchId, revision: transaction.committedRevision }
    }
    if (transaction.state === 'failed' || transaction.state === 'rolling-back') {
      return { status: 'unavailable', reason: transaction.error ?? '该导入事务已失败，不能继续执行。' }
    }
    if (archive === undefined) {
      return { status: 'unavailable', reason: 'Runtime Registry 未提供该事务的原始归档，无法在重启后安全继续。' }
    }
    const report = await preflight(archive)
    if (!report.valid) return { status: 'preflight-failed', report }
    const result = await runImport(archive, {
      transactionId,
      installPlugins: report.manifest?.schemaVersion === 2 && report.manifest.completeness !== 'layout-only',
      loadAfterImport: false,
      deferDynamicActivation: true,
    })
    if (result.status === 'committed' && report.projection !== undefined) {
      preparedWorkbenches.set(result.workbenchId, { report, projection: report.projection, boundInputs: {}, deferredDynamicReceipts: [], ...(result.transactionId === undefined ? {} : { transactionId: result.transactionId }) })
    }
    return result
  }
  const runtimeReadinessSnapshot = (): WorkbenchRuntimeReadinessSnapshotV1 => {
    let candidate: unknown
    try { candidate = runtime()?.readiness?.() } catch { candidate = undefined }
    if (validateWorkbenchRuntimeReadinessSnapshotV1(candidate)) return candidate
    const identity = runtime()?.identity
    return {
      status: 'unknown',
      runtime: {
        runtimeId: identity?.runtimeId ?? 'unknown',
        version: identity?.version ?? environment().dshVersion,
        capabilities: [],
      },
      dependencies: [], requiredInputs: [],
      blockers: [{ code: 'runtime-readiness-unavailable', message: '当前 Runtime 未提供可证明的依赖就绪报告。' }],
      warnings: [],
    }
  }
  const pendingRequiredInputs = (
    boundInputs: Readonly<Record<string, WorkbenchExternalBindingRefV1>> | undefined,
    readiness = runtimeReadinessSnapshot(),
  ): WorkbenchRuntimeReadinessSnapshotV1['requiredInputs'] => readiness.requiredInputs.map(input => {
    const binding = boundInputs?.[input.id]
    return binding === undefined || binding.reference.trim() === '' || input.status === 'invalid'
      ? input
      : { ...input, status: 'satisfied' as const }
  })
  const patchSettings = async (
    mutate: (settings: WorkbenchSettingsV4) => WorkbenchSettingsV4,
  ): Promise<SettingsScopePatchResult> => {
    const snapshot = options.scope.getSnapshot()
    if (snapshot.status !== 'ready' || snapshot.writable !== true || snapshot.value === undefined) {
      return { status: 'unavailable' }
    }
    return options.scope.patch({
      operation: 'set', path: [], value: mutate(snapshot.value),
      ...(snapshot.revision === undefined ? {} : { expectedRevision: snapshot.revision }),
    })
  }
  const prepare = async (
    archive: Uint8Array,
    importOptions: Pick<WorkbenchPackageImportOptionsV1, 'transactionId' | 'approvedPermissions' | 'sessionTemplateBindings' | 'onProgress'> = {},
  ): Promise<WorkbenchImportPreparationResultV1> => {
    const report = await preflight(archive)
    if (!report.valid || report.projection === undefined) return { status: 'preflight-failed', report }
    const result = await runImport(archive, {
      // Legacy v1 `plugins` entries are descriptive only. They are not proof
      // of an installable artifact and must never turn a layout import into a
      // hard failure merely because no legacy plugin installer is present.
      installPlugins: report.manifest?.schemaVersion === 2 && report.manifest.completeness !== 'layout-only',
      loadAfterImport: false,
      deferDynamicActivation: true,
      ...importOptions,
    })
    if (result.status !== 'committed') return result
    preparedWorkbenches.set(result.workbenchId, {
      report,
      projection: report.projection,
      boundInputs: {},
      deferredDynamicReceipts: [],
      ...(result.transactionId === undefined ? {} : { transactionId: result.transactionId }),
    })
    return {
      status: 'ready-to-bind',
      workbenchId: result.workbenchId,
      revision: result.revision,
      report,
      requiredInputs: pendingRequiredInputs({}),
    }
  }
  const bind = async (
    workbenchId: string,
    bindings: WorkbenchExternalBindingInputV1,
  ): Promise<WorkbenchBindingResultV1> => {
    const prepared = preparedWorkbenches.get(workbenchId)
    const snapshot = options.scope.getSnapshot()
    const record = snapshot.status === 'ready' ? snapshot.value?.workbenches[workbenchId] : undefined
    if (record === undefined || snapshot.value === undefined) {
      return { status: 'unavailable', reason: '工作台尚未通过当前导入协调器准备，无法绑定外部资源。' }
    }
    const selectedBindings = bindings.sessionTemplateBindings
    let nextDocument = record.document
    if (selectedBindings !== undefined && prepared !== undefined) {
      try {
        nextDocument = importPortableWorkbench(prepared.projection, {
          ...(prepared.report.sessions === undefined ? {} : { sessions: prepared.report.sessions }),
          templateBindings: selectedBindings,
          prefix: `bound-${workbenchId}`,
          detachedSessionId: `bound-${workbenchId}-detached-session`,
        }).document
      } catch (error) {
        return { status: 'unavailable', reason: error instanceof Error ? error.message : 'Session 模板绑定无效。' }
      }
    }
    if (selectedBindings !== undefined && prepared === undefined) {
      return { status: 'unavailable', reason: 'Session 模板绑定需要重新载入原始分享包后才能安全恢复。' }
    }
    const nextInputs: Record<string, WorkbenchExternalBindingRefV1> = {
      ...(prepared?.boundInputs ?? record.externalBindings ?? {}),
      ...(bindings.inputs ?? {}),
    }
    const readiness = runtimeReadinessSnapshot()
    for (const [id, input] of Object.entries(nextInputs)) {
      if (!/^[A-Za-z0-9._:-]{1,96}$/u.test(id) || !validateExternalBindingRef(input)) {
        return { status: 'unavailable', reason: `外部绑定“${id}”不是安全的本地引用。请勿填写凭据、令牌、绝对路径或 Session 身份。` }
      }
      const declared = readiness.requiredInputs.find(candidate => candidate.id === id)
      if (declared !== undefined && declared.kind !== input.kind) {
        return { status: 'unavailable', reason: `外部绑定“${id}”的类型不匹配：需要 ${declared.kind}，收到 ${input.kind}。` }
      }
      // Once a real Runtime has supplied a readiness contract, only declared
      // typed inputs are writable. This avoids persisting arbitrary opaque
      // references which no activation path can consume. An unknown Runtime
      // retains the layout-only escape hatch because it cannot attest a
      // schema yet and therefore must not pretend to validate one.
      if (readiness.status !== 'unknown' && declared === undefined) {
        return { status: 'unavailable', reason: `外部绑定“${id}”不在当前 Runtime 的待绑定清单中。` }
      }
    }
    const serializedExternalBindings = Object.fromEntries(Object.entries(nextInputs).map(([id, input]) => [id, { kind: input.kind, reference: input.reference } satisfies WorkbenchExternalBindingRecordV1]))
    const patchResult = await patchSettings(current => ({
      ...current,
      workbenches: {
        ...current.workbenches,
        [workbenchId]: {
          ...current.workbenches[workbenchId]!,
          document: nextDocument,
          ...(Object.keys(serializedExternalBindings).length === 0 ? {} : { externalBindings: serializedExternalBindings }),
          updatedAt: Date.now(),
        },
      },
    }))
    if (patchResult.status === 'conflict') {
      return { status: 'conflict', expectedRevision: patchResult.expectedRevision, actualRevision: patchResult.actualRevision }
    }
    if (patchResult.status !== 'committed') return { status: 'unavailable', reason: 'Settings 写入不可用，绑定未保存。' }
    if (prepared !== undefined) preparedWorkbenches.set(workbenchId, {
      ...prepared,
      boundInputs: nextInputs,
      ...(selectedBindings === undefined ? {} : { sessionTemplateBindings: selectedBindings }),
    })
    return { status: 'committed', workbenchId, revision: patchResult.revision, pendingInputs: pendingRequiredInputs(nextInputs, readiness) }
  }

  const recipientSessionForDynamicDependency = (
    prepared: PreparedWorkbench,
    dependency: WorkbenchDependencyLockEntryV1,
  ): string | undefined => {
    const sessions = prepared.report.sessions
    const bindings = prepared.sessionTemplateBindings
    if (sessions === undefined || bindings === undefined) return undefined
    const templateByArea = new Map(sessions.areaBindings.map(binding => [binding.areaKey, binding.templateId]))
    const recipients = new Set<string>()
    for (const reference of dependency.requiredBy) {
      const templateId = templateByArea.get(reference) ?? reference
      const target = bindings[templateId]
      if (target?.sessionId.trim()) recipients.add(target.sessionId)
    }
    return recipients.size === 1 ? [...recipients][0] : undefined
  }

  const activateDeferredDynamics = async (
    workbenchId: string,
    prepared: PreparedWorkbench,
  ): Promise<{ valid: true } | { valid: false; reason: string }> => {
    const dependencies = (prepared.report.dependencyLock ?? []).filter(dependency => dependency.kind === 'dynamic'
      && !prepared.deferredDynamicReceipts.some(receipt => receipt.portableId === dependency.portableId
        && receipt.version === dependency.version
        && receipt.digest.toUpperCase() === dependency.digest.toUpperCase()))
    if (dependencies.length === 0) return { valid: true }
    const highLevel = runtime()?.deferredDynamicActivator
    const recipientSessions: Record<string, string> = {}
    for (const dependency of dependencies) {
      const recipientSessionId = recipientSessionForDynamicDependency(prepared, dependency)
      if (recipientSessionId === undefined) return { valid: false, reason: `动态内页“${dependency.portableId}”尚未绑定唯一的接收端 Session。` }
      recipientSessions[`${dependency.portableId}\u0000${dependency.version}\u0000${dependency.digest.toUpperCase()}`] = recipientSessionId
    }
    const persistReceipts = (receipts: readonly WorkbenchDependencyActivationReceiptV1[]): void => {
      if (prepared.transactionId === undefined) return
      const store = runtime()?.transactionStore ?? options.transactionStore
      const transaction = store?.get(prepared.transactionId)
      if (transaction === undefined) return
      const identities = new Set((transaction.activatedDependencies ?? []).map(receipt =>
        `${receipt.portableId}\u0000${receipt.version}\u0000${receipt.digest.toUpperCase()}`))
      store?.put({
        ...transaction,
        activatedDependencies: [
          ...(transaction.activatedDependencies ?? []),
          ...receipts.filter(receipt => !identities.has(`${receipt.portableId}\u0000${receipt.version}\u0000${receipt.digest.toUpperCase()}`)),
        ],
        updatedAt: Date.now(),
      })
    }
    if (highLevel !== undefined) {
      let highLevelReceipts: readonly WorkbenchDependencyActivationReceiptV1[] = []
      try {
        const result = await highLevel.activate({ workbenchId, dependencies, recipientSessions })
        highLevelReceipts = result.receipts
        const expected = new Map(dependencies.map(dependency => [
          `${dependency.portableId}\u0000${dependency.version}\u0000${dependency.digest.toUpperCase()}`,
          dependency,
        ]))
        for (const receipt of result.receipts) {
          const dependency = expected.get(`${receipt.portableId}\u0000${receipt.version}\u0000${receipt.digest.toUpperCase()}`)
          if (dependency === undefined || receipt.packageId.trim() === ''
            || receipt.localPluginId?.trim() === '' || receipt.localPluginId === undefined
            || receipt.localPluginRunId?.trim() === '' || receipt.localPluginRunId === undefined) {
            throw new Error('DSH Runtime 返回了不完整的 Dynamic 激活收据。')
          }
        }
        if (result.receipts.length !== dependencies.length) throw new Error('DSH Runtime 未返回所有 Dynamic 激活收据。')
        if (options.verifyInstalledEditors !== undefined) {
          const verification = await options.verifyInstalledEditors(requiredEditorsOfProjection(prepared.projection), prepared.report.dependencyLock ?? [])
          if (!verification.valid) throw new Error(verification.reason ?? 'Dynamic 内页注册来源校验失败。')
        }
        prepared.deferredDynamicReceipts.push(...result.receipts)
        persistReceipts(result.receipts)
        return { valid: true }
      } catch (error) {
        if (highLevelReceipts.length > 0) {
          try { await highLevel.rollback({ workbenchId, receipts: highLevelReceipts }) } catch { /* durable coordinator will retry rollback */ }
        }
        return { valid: false, reason: error instanceof Error ? error.message : 'Dynamic 依赖激活失败。' }
      }
    }
    const installer = runtime()?.dependencyInstaller ?? options.dependencyInstaller
    if (installer === undefined) return { valid: false, reason: '当前 Runtime 未提供 Dynamic 依赖激活器。' }
    const artifactStore = runtime()?.artifactStore ?? options.artifactStore
    const newlyActivated: WorkbenchDependencyActivationReceiptV1[] = []
    try {
      for (const dependency of dependencies) {
        if (prepared.deferredDynamicReceipts.some(receipt => receipt.portableId === dependency.portableId
          && receipt.version === dependency.version
          && receipt.digest.toUpperCase() === dependency.digest.toUpperCase())) continue
        const recipientSessionId = recipientSessionForDynamicDependency(prepared, dependency)
        if (recipientSessionId === undefined) {
          throw new Error(`动态内页“${dependency.portableId}”尚未绑定唯一的接收端 Session。`)
        }
        await runtime()?.bindDynamicDependency?.({ workbenchId, dependency, recipientSessionId })
        const receipt = await installer.activate(dependency, artifactStore?.get(dependency.digest))
        if (receipt.portableId !== dependency.portableId
          || receipt.version !== dependency.version
          || receipt.digest.toUpperCase() !== dependency.digest.toUpperCase()
          || receipt.localPluginId?.trim() === '' || receipt.localPluginId === undefined
          || receipt.localPluginRunId?.trim() === '' || receipt.localPluginRunId === undefined) {
          throw new Error(`Dynamic 依赖激活收据与锁定信息不一致：${dependency.portableId}（缺少新的 pluginId/pluginRunId）`)
        }
        newlyActivated.push(receipt)
      }
      if (options.verifyInstalledEditors !== undefined) {
        const verification = await options.verifyInstalledEditors(
          requiredEditorsOfProjection(prepared.projection),
          prepared.report.dependencyLock ?? [],
        )
        if (!verification.valid) throw new Error(verification.reason ?? 'Dynamic 内页注册来源校验失败。')
      }
      prepared.deferredDynamicReceipts.push(...newlyActivated)
      persistReceipts(newlyActivated)
      return { valid: true }
    } catch (error) {
      for (const receipt of [...newlyActivated].reverse()) {
        try { await installer.rollback(receipt) } catch { /* preserve original failure; retry remains explicit */ }
      }
      return { valid: false, reason: error instanceof Error ? error.message : 'Dynamic 依赖激活失败。' }
    }
  }

  function requiredEditorsOfProjection(projection: NonNullable<WorkbenchPackagePreflightResultV1['projection']>): readonly { editorId: string; scope: 'root' | 'session' }[] {
    const result = new Map<string, { editorId: string; scope: 'root' | 'session' }>()
    const visit = (node: typeof projection.root): void => {
      if (node.kind === 'split') { visit(node.first); visit(node.second); return }
      const active = node.editors.find(editor => editor.key === node.activeEditorKey)
      if (active !== undefined) result.set(`${active.scope}:${active.editorId}`, { editorId: active.editorId, scope: active.scope })
    }
    visit(projection.root)
    return [...result.values()]
  }
  const activate = async (workbenchId: string): Promise<WorkbenchActivationResultV1> => {
    const snapshot = options.scope.getSnapshot()
    const record = snapshot.status === 'ready' ? snapshot.value?.workbenches[workbenchId] : undefined
    if (record === undefined || snapshot.value === undefined) return { status: 'unavailable', reason: '目标工作台不存在或 Settings 不可读。' }
    const prepared = preparedWorkbenches.get(workbenchId)
    const completeness = prepared?.report.manifest?.completeness
      ?? record.packageOrigin?.completeness
      // Older packageOrigin records did not persist a completeness level. Do
      // not infer that they are online-complete merely because they have a
      // dependency list: v1 plugins are descriptive metadata, not proof that
      // the recipient can install or activate anything. They must be
      // re-scanned/prepared as a v2 package before activation can claim
      // complete-online or complete-offline.
      ?? 'layout-only'
    const pending = pendingRequiredInputs(prepared?.boundInputs ?? record.externalBindings)
    const requiredPending = pending.filter(input => input.required && input.status !== 'satisfied')
    if (completeness !== 'layout-only') {
      if (prepared !== undefined) {
        const deferred = await activateDeferredDynamics(workbenchId, prepared)
        if (!deferred.valid) return { status: 'unavailable', reason: deferred.reason }
      }
      const readiness = runtimeReadinessSnapshot()
      if (readiness.status === 'blocked') return { status: 'unavailable', reason: readiness.blockers.map(blocker => blocker.message).join('；') || 'Runtime 依赖仍被阻塞。' }
      if (readiness.status === 'unknown') return { status: 'unavailable', reason: '当前 Runtime 未提供可证明的依赖就绪报告。' }
      const lockedDependencies = prepared?.report.dependencyLock
        ?? record.packageOrigin?.dependencies.map((dependency: WorkbenchPackageOriginV1['dependencies'][number]) => ({
          portableId: dependency.portableId,
          version: dependency.version,
          digest: dependency.digest,
        }))
        ?? []
      const readinessIssues = lockedDependencies.flatMap((dependency: WorkbenchDependencyLockEntryV1 | { portableId: string; version: string; digest: string }) => {
        const live = readiness.dependencies.find(candidate => candidate.portableId === dependency.portableId)
        if (live === undefined) return [`依赖尚未出现在 Runtime readiness：${dependency.portableId}`]
        if (live.version !== dependency.version || live.digest.toUpperCase() !== dependency.digest.toUpperCase()) {
          return [`依赖版本或摘要不匹配：${dependency.portableId}`]
        }
        return live.status === 'ready' ? [] : [`依赖尚未就绪：${dependency.portableId}（${live.status}）`]
      })
      if (readinessIssues.length > 0) return { status: 'unavailable', reason: readinessIssues.join('；') }
      if (requiredPending.length > 0 || readiness.status === 'needs-input') return { status: 'needs-input', workbenchId, inputs: pending }
    }
    const patchResult = await patchSettings(current => ({
      ...current,
      activeWorkbenchId: workbenchId,
      openWorkbenchIds: current.openWorkbenchIds.includes(workbenchId)
        ? [...current.openWorkbenchIds]
        : [...current.openWorkbenchIds, workbenchId],
    }))
    if (patchResult.status === 'conflict') return { status: 'conflict', expectedRevision: patchResult.expectedRevision, actualRevision: patchResult.actualRevision }
    if (patchResult.status !== 'committed') return { status: 'unavailable', reason: 'Settings 写入不可用，工作台未切换。' }
    return { status: 'committed', workbenchId, revision: patchResult.revision }
  }
  const scanDependencies = (workbenchId: string): WorkbenchDependencyScanReportV1 | undefined => {
    const snapshot = options.scope.getSnapshot()
    const record = snapshot.value?.workbenches[workbenchId]
    if (snapshot.status !== 'ready' || record === undefined) return undefined
    const editors = options.editorCatalog.getSnapshot()
    const sharing = projectWorkbenchSessionsAndAgentPresetsForSharing(record.document, options.sessionTemplateResolver)
    const origin = record.packageOrigin
    const inherited = origin?.dependencies ?? []
    const descriptors = originDescriptors(origin)
    const liveDescriptors = [...(options.distributions ?? []), ...runtimeDistributions()]
    const effectiveEditors = editors.map(editor => {
      if (editor.distribution !== undefined) return editor
      const dependency = inherited.find((candidate: WorkbenchPackageOriginV1['dependencies'][number]) => candidate.kind !== 'agent-preset'
        && candidate.editorIds.includes(editor.id)
        && (candidate.editorScopes === undefined
          || candidate.editorScopes.some(scope => scope.editorId === editor.id && scope.scope === editor.scope)))
      // A creator may update an imported dependency in-place. Prefer the
      // current Runtime/manifest declaration over the imported lineage; the
      // lineage is only the fallback that makes a previously imported shared
      // dependency discoverable after a restart.
      const distribution = liveDescriptors.find((candidate: WorkbenchDistributionDescriptorV1) => candidate.portableId === dependency?.portableId)
        ?? descriptors.find((candidate: WorkbenchDistributionDescriptorV1) => candidate.portableId === dependency?.portableId)
      return distribution === undefined ? editor : { ...editor, distribution }
    })
    const preparedAgentPresets = [...runtimeAgentPresetDistributions()]
    // The Runtime is authoritative for which preset a live Session actually
    // uses. The portable projection still contributes template bindings for
    // older integrations, but it must not silently replace an active Runtime
    // composition with a stale UI descriptor.
    const presetInputs = new Map<string, WorkbenchAgentPresetDependencyInputV1>()
    const runtimePresetInputs = runtimeAgentPresetDependencies().filter(input => {
      if (typeof input !== 'object' || input === null || typeof input.presetId !== 'string' || input.presetId.trim() === ''
        || !Array.isArray(input.templateIds) || !input.templateIds.every(templateId => typeof templateId === 'string')) return false
      return input.descriptor === undefined || validateWorkbenchAgentPresetDistributionDescriptor(input.descriptor)
    })
    const runtimePresetIds = new Set(runtimePresetInputs.map(input => input.presetId))
    for (const input of [...runtimePresetInputs, ...sharing.agentPresetDependencies]) {
      const previous = presetInputs.get(input.presetId)
      if (previous === undefined) {
        presetInputs.set(input.presetId, input)
      } else {
        presetInputs.set(input.presetId, {
          ...previous,
          templateIds: [...new Set([...previous.templateIds, ...input.templateIds])].sort(),
          ...(previous.descriptor === undefined && input.descriptor !== undefined
            && !runtimePresetIds.has(input.presetId) ? { descriptor: input.descriptor } : {}),
        })
      }
    }
    const liveAgentPresetDependencies = [...presetInputs.values()].map(input => {
      if (input.descriptor !== undefined) return input
      const descriptor = preparedAgentPresets.find((candidate: WorkbenchAgentPresetDistributionDescriptorV1) => candidate.presetId === input.presetId)
      if (descriptor !== undefined) return { ...input, descriptor }
      const inheritedDependency = inherited.find((candidate: WorkbenchPackageOriginV1['dependencies'][number]) => candidate.kind === 'agent-preset' && candidate.agentPresetId === input.presetId)
      if (inheritedDependency === undefined || origin === undefined) return input
      return {
        ...input,
        descriptor: {
          version: 1 as const,
          portableId: inheritedDependency.portableId,
          presetId: input.presetId,
          packageVersion: inheritedDependency.version,
          ...(inheritedDependency.digest === '' ? {} : { artifactDigest: inheritedDependency.digest }),
          exportPolicy: inheritedDependency.exportPolicy,
          sourcePolicy: inheritedDependency.sourcePolicy,
          requires: originRequirements(origin, inheritedDependency.portableId),
          permissions: [...inheritedDependency.permissions],
          ...(inheritedDependency.packageName === undefined ? {} : { packageName: inheritedDependency.packageName }),
          ...(inheritedDependency.registryUrl === undefined ? {} : { registryUrl: inheritedDependency.registryUrl }),
          ...(inheritedDependency.integrity === undefined ? {} : { integrity: inheritedDependency.integrity }),
          ...(inheritedDependency.installSource === undefined ? {} : { installSource: inheritedDependency.installSource }),
        },
      }
    })
    const livePresetIds = new Set(liveAgentPresetDependencies.map(input => input.presetId))
    // Imported package lineage is a recovery hint, not a license to carry
    // every historical Agent dependency forever.  Only retain an inherited
    // preset when one of the current session templates still references it;
    // deleting/replacing an Area therefore removes the old preset from the
    // next dependency scan and re-export.
    const currentTemplateIds = new Set(sharing.sessions.templates.map(template => template.templateId))
    const inheritedAgentPresetDependencies = inherited
      .filter((dependency: WorkbenchPackageOriginV1['dependencies'][number]) => dependency.kind === 'agent-preset' && dependency.agentPresetId !== undefined)
      .filter((dependency: WorkbenchPackageOriginV1['dependencies'][number]) => !livePresetIds.has(dependency.agentPresetId!))
      .filter((dependency: WorkbenchPackageOriginV1['dependencies'][number]) => dependency.requiredBy
        .some((reference: string) => currentTemplateIds.has(reference)))
      .map((dependency: WorkbenchPackageOriginV1['dependencies'][number]) => ({
        presetId: dependency.agentPresetId!,
        templateIds: dependency.requiredBy.filter((reference: string) => reference.startsWith('session-template-')),
        descriptor: {
          version: 1 as const,
          portableId: dependency.portableId,
          presetId: dependency.agentPresetId!,
          packageVersion: dependency.version,
          ...(dependency.digest === '' ? {} : { artifactDigest: dependency.digest }),
          exportPolicy: dependency.exportPolicy,
          sourcePolicy: dependency.sourcePolicy,
          requires: origin === undefined ? [] : originRequirements(origin, dependency.portableId),
          permissions: [...dependency.permissions],
          ...(dependency.packageName === undefined ? {} : { packageName: dependency.packageName }),
          ...(dependency.registryUrl === undefined ? {} : { registryUrl: dependency.registryUrl }),
          ...(dependency.integrity === undefined ? {} : { integrity: dependency.integrity }),
          ...(dependency.installSource === undefined ? {} : { installSource: dependency.installSource }),
        },
      }))
    const agentPresetDependencies = [...liveAgentPresetDependencies, ...inheritedAgentPresetDependencies]
    return scanWorkbenchDependencies({
      workbenchId,
      inventory: buildWorkbenchInventory(record.document, editors),
      editors: effectiveEditors,
      ...(snapshot.revision === undefined ? {} : { settingsRevision: snapshot.revision }),
      // Imported lineage is a fallback for packages that no longer expose a
      // live descriptor (notably shared/transitive rows). Current static or
      // Dynamic Runtime declarations must win when a creator updates a
      // dependency and re-exports the Workbench.
      distributions: [...descriptors, ...(options.distributions ?? []), ...runtimeDistributions()],
      artifacts: [...(options.artifacts ?? []), ...runtimeArtifacts(), ...storedArtifacts(), ...preparedExportArtifacts.values()],
      runtimeProvided: runtimeProvided(),
      agentPresetDependencies,
    })
  }
  const inspectDependencies = (workbenchId: string): WorkbenchDependencySnapshotV1 | undefined => scanDependencies(workbenchId)?.snapshot
  const inspectExportReadinessFor = (
    workbenchId: string,
    mode: WorkbenchExportReadinessModeV1,
  ): WorkbenchExportReadinessInspectionV1 | undefined => {
    const scan = scanDependencies(workbenchId)
    if (scan === undefined) return undefined
    // Export preparation is a distinct capability from import activation. A
    // browser profile may have no Dynamic/transaction attestation yet while
    // Host can still read and embed the current static npm artifacts. Only an
    // explicit, contradictory Runtime attestation participates in export
    // blockers; an absent attestation is not a reason to disable static pack.
    const authority = runtime()
    const readiness = authority?.readiness === undefined && authority?.readinessFacts === undefined
      ? undefined
      : runtimeReadinessSnapshot()
    return inspectWorkbenchExportReadiness({ scan, mode, ...(readiness === undefined ? {} : { runtimeReadiness: readiness }) })
  }
  /**
   * Browser/UI code deliberately has no npm, filesystem or Dynamic Runner
   * implementation.  This small default coordinator is only assembled when a
   * Runtime authority is present; every side effect still crosses the
   * Runtime-owned artifact/package-manager seams.  Hosts may replace it with
   * a richer durable coordinator through `options.exportReadinessCoordinator`.
   */
  type ExportPreparationRecord = {
    readonly transactionId: string
    readonly workbenchId: string
    readonly mode: WorkbenchExportReadinessModeV1
    readonly store?: WorkbenchArtifactStoreV1
    readonly stagedDigests: readonly string[]
    readonly installedPackages: readonly WorkbenchDependencyInstallReceiptV1[]
    readonly transaction?: WorkbenchExportPreparationTransactionControllerV1
    readonly readyForExport: boolean
    readonly npmArtifacts?: readonly { portableId: string; digest: string; integrity: string; tarball: Uint8Array }[]
  }
  const exportPreparations = new Map<string, ExportPreparationRecord>()
  let exportPreparationRecoveryDone = false
  const highRiskPreparationPermissions = new Set(['network', 'filesystem', 'host.code', 'dynamic.cordis', 'session.read'])
  const preparationTransaction = (workbenchId: string, mode: WorkbenchExportReadinessModeV1, transactionId: string): WorkbenchExportPreparationTransactionControllerV1 | undefined => {
    const store = runtime()?.exportPreparationStore ?? options.exportPreparationStore
    if (store === undefined) return undefined
    const now = Date.now()
    return new WorkbenchExportPreparationTransactionControllerV1({
      schemaVersion: 1,
      transactionId, workbenchId, mode,
      issueIds: [], stagedDigests: [], installedPackageIds: [],
      state: 'inspecting',
      createdAt: now,
      updatedAt: now,
    }, store)
  }
  const safePreparationTransition = (transaction: WorkbenchExportPreparationTransactionControllerV1 | undefined, state: Parameters<WorkbenchExportPreparationTransactionControllerV1['transition']>[0], error?: string): void => {
    if (transaction === undefined) return
    try { transaction.transition(state, Date.now(), error) } catch { /* a Host restart may close the journal; the operation still fails closed */ }
  }
  const rollbackExportPreparation = async (record: ExportPreparationRecord): Promise<void> => {
    const failures: string[] = []
    const packageInstaller = runtime()?.packageInstaller ?? options.packageInstaller
    if (packageInstaller !== undefined) {
      for (const receipt of [...record.installedPackages].reverse()) {
        try { await packageInstaller.rollback(receipt) } catch (error) { failures.push(error instanceof Error ? error.message : String(error)) }
      }
    }
    if (record.store !== undefined && record.stagedDigests.length > 0) {
      // Successful preparation retains a temporary export reference so the
      // bytes survive until the user confirms the archive. Cancellation must
      // release that reference before scoped cleanup can reclaim newly staged
      // artifacts; shared/Workbench-owned references remain untouched.
      for (const digest of record.stagedDigests) record.store.release(digest, `workbench-export:${record.workbenchId}`)
      record.store.cleanup(record.stagedDigests)
    }
    if (record.transaction !== undefined) {
      safePreparationTransition(record.transaction, 'rolling-back', failures.length === 0 ? undefined : `准备回滚不完整：${failures.join('；')}`)
      safePreparationTransition(record.transaction, 'failed', failures.length === 0 ? undefined : `准备回滚不完整：${failures.join('；')}`)
    }
    exportPreparations.delete(record.transactionId)
  }
  /**
   * Reconcile export journals after a renderer/DSH restart.  A preparation
   * journal never contains executable bytes, so recovery can safely release
   * only its temporary Artifact Store reference.  A journal that reached the
   * confirmation boundary is retained as resumable metadata; the caller may
   * explicitly confirm or cancel it later.  Earlier phases are failed closed
   * instead of being presented as ready.
   */
  const recoverExportPreparations = async (): Promise<readonly { transactionId: string; state: WorkbenchExportPreparationStateV1 }[]> => {
    if (exportPreparationRecoveryDone) {
      return [...exportPreparations.values()].map(record => ({ transactionId: record.transactionId, state: record.transaction?.snapshot.state ?? (record.readyForExport ? 'awaiting-export-confirmation' : 'failed') }))
    }
    exportPreparationRecoveryDone = true
    const store = runtime()?.exportPreparationStore ?? options.exportPreparationStore
    const artifactStore = runtime()?.artifactStore ?? options.artifactStore
    await artifactStore?.ready?.()
    const rows = store?.snapshot?.() ?? []
    const recovered: Array<{ transactionId: string; state: WorkbenchExportPreparationStateV1 }> = []
    for (const row of rows) {
      if (row.state === 'committed' || row.state === 'failed') continue
      const rowStore = store
      if (row.state === 'awaiting-export-confirmation' && rowStore !== undefined) {
        const transaction = new WorkbenchExportPreparationTransactionControllerV1(row, rowStore)
        exportPreparations.set(row.transactionId, {
          transactionId: row.transactionId,
          workbenchId: row.workbenchId,
          mode: row.mode,
          ...((runtime()?.artifactStore ?? options.artifactStore) === undefined
            ? {}
            : { store: runtime()?.artifactStore ?? options.artifactStore }),
          stagedDigests: [...row.stagedDigests],
          installedPackages: [],
          transaction,
          readyForExport: true,
          npmArtifacts: [],
        })
        recovered.push({ transactionId: row.transactionId, state: row.state })
        continue
      }
      if (artifactStore !== undefined) {
        for (const digest of row.stagedDigests) artifactStore.release(digest, `workbench-export:${row.workbenchId}`)
        artifactStore.cleanup(row.stagedDigests)
      }
      if (rowStore !== undefined) {
        try {
          const transaction = new WorkbenchExportPreparationTransactionControllerV1(row, rowStore)
          transaction.transition('rolling-back', Date.now(), 'DSH 重启时准备尚未达到导出确认边界，已安全回滚。')
          transaction.transition('failed', Date.now(), 'DSH 重启时准备尚未达到导出确认边界，已安全回滚。')
        } catch {
          rowStore.delete(row.transactionId)
        }
      }
      recovered.push({ transactionId: row.transactionId, state: 'failed' })
    }
    return recovered
  }
  const createDefaultExportReadinessCoordinator = (): WorkbenchExportReadinessCoordinatorV1 | undefined => {
    // A resolver is itself a Runtime seam. Do not expose a browser-side
    // pseudo-installer when no authority was supplied.
    return {
      inspect: async input => { await recoverExportPreparations(); return inspectExportReadinessFor(input.workbenchId, input.mode) },
      recoverPreparations: recoverExportPreparations,
      prepare: async (input, preparationOptions = {}) => {
        await recoverExportPreparations()
        const previous = [...exportPreparations.values()].find(record => record.workbenchId === input.workbenchId && record.mode === input.mode && record.readyForExport)
        if (previous !== undefined) {
          const current = inspectExportReadinessFor(input.workbenchId, input.mode)
          if (current !== undefined && current.repairable.length === 0 && current.blockers.length === 0) {
            return { status: 'committed', transactionId: previous.transactionId, inspection: current }
          }
        }
        const transactionId = `export-${input.workbenchId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
        const transaction = preparationTransaction(input.workbenchId, input.mode, transactionId)
        const stagedDigests: string[] = []
        const installedPackages: WorkbenchDependencyInstallReceiptV1[] = []
        const npmArtifacts: { portableId: string; digest: string; integrity: string; tarball: Uint8Array }[] = []
        const store = runtime()?.artifactStore ?? options.artifactStore
        const packageInstaller = runtime()?.packageInstaller ?? options.packageInstaller
        await store?.ready?.()
        const initial = inspectExportReadinessFor(input.workbenchId, input.mode)
        if (initial === undefined) return { status: 'failed', transactionId, reason: '工作台依赖快照不可读取。' }
        if (initial.blockers.some(issue => issue.repair === 'none') || initial.completeness === 'blocked') {
          return { status: 'failed', transactionId, reason: '当前工作台存在不能通过准备动作自动解决的阻塞项。', inspection: initial }
        }
        const issueIds = new Set(input.issueIds ?? initial.repairable.map(item => item.issueId))
        const selected = initial.repairable.filter(item => issueIds.has(item.issueId))
        if (selected.length === 0) return { status: 'committed', transactionId, inspection: initial }
        safePreparationTransition(transaction, 'awaiting-trust')
        safePreparationTransition(transaction, 'awaiting-permissions')
        safePreparationTransition(transaction, 'resolving-repair-plan')
        safePreparationTransition(transaction, 'staging-artifacts')
        try {
          const scan = scanDependencies(input.workbenchId)
          if (scan === undefined) throw new Error('工作台依赖快照不可读取。')
          const lockById = new Map(scan.snapshot.dependencies.map(dependency => [dependency.portableId, dependency]))
          const npmDependencies = selected
            .map(item => lockById.get(item.portableId))
            .filter((dependency): dependency is NonNullable<typeof dependency> => dependency !== undefined
              && dependency.packageName !== undefined)
          if (input.mode === 'offline-embedded' && npmDependencies.length > 0) {
            const packed = await exportArtifactProvider.prepare({ dependencies: npmDependencies.map(dependency => ({
              portableId: dependency.portableId,
              packageName: dependency.packageName!,
              version: dependency.version,
              digest: dependency.digest,
              editorIds: dependency.editorIds,
              ...(dependency.clientEntry === undefined ? {} : { clientEntry: dependency.clientEntry }),
              ...(dependency.hostEntry === undefined ? {} : { hostEntry: dependency.hostEntry }),
              permissions: dependency.permissions,
              sourcePolicy: dependency.sourcePolicy,
            })) })
            for (const artifact of packed.npmArtifacts) {
              npmArtifacts.push({ portableId: artifact.portableId, digest: artifact.digest, integrity: artifact.integrity, tarball: new Uint8Array(artifact.tarball) })
              preparedNpmArtifacts.set(artifact.portableId, { digest: artifact.digest, integrity: artifact.integrity, tarball: new Uint8Array(artifact.tarball) })
            }
            for (const artifact of packed.artifacts) {
              if (artifact.files === undefined) continue
              preparedExportArtifacts.set(artifact.digest.toLocaleLowerCase('en-US'), artifact)
              if (store === undefined) continue
              const record = artifact.record
              const bundle: WorkbenchArtifactBundleV1 = {
                record: {
                  digest: artifact.digest,
                  portableId: record?.portableId ?? artifact.digest,
                  version: record?.version ?? '0.0.0',
                  editorIds: record?.editorIds ?? [],
                  sourcePolicy: record?.sourcePolicy ?? 'binary-only',
                  permissions: record?.permissions ?? [],
                  size: artifact.files.reduce((total, file) => total + file.content.byteLength, 0),
                },
                files: artifact.files,
              }
              if (store.get(artifact.digest) === undefined) {
                await store.stage(bundle)
                await store.commit(artifact.digest)
                stagedDigests.push(artifact.digest)
              }
            }
          }
          // The Host export provider may have just materialized a verified
          // client artifact for this preparation. Include that short-lived
          // journal entry in the same lookup used for staging; otherwise the
          // preparation would pack successfully and then claim the bytes are
          // unavailable, rolling back every offline export.
          const runtimeArtifactInfos = [
            ...(options.artifacts ?? []),
            ...runtimeArtifacts(),
            ...storedArtifacts(),
            ...preparedExportArtifacts.values(),
          ]
          for (const item of selected) {
            const lock = lockById.get(item.portableId)
            if (lock === undefined) throw new Error(`依赖锁中缺少条目：${item.portableId}`)
            const missingPermissions = [...new Set(lock.permissions.filter(permission => highRiskPreparationPermissions.has(permission)))]
              .filter(permission => !(preparationOptions.approvedPermissions ?? []).includes(permission))
            if (missingPermissions.length > 0) throw new Error(`依赖 ${item.portableId} 需要明确批准权限：${missingPermissions.join('、')}`)
            if (item.repair === 'embed-local') {
              if (store === undefined) throw new Error(`Runtime 未提供 Artifact Store，无法提取：${item.portableId}`)
              const info = runtimeArtifactInfos.find(candidate => candidate.digest.toUpperCase() === lock.digest.toUpperCase() && candidate.files !== undefined)
              if (info === undefined || info.files === undefined || info.files.length === 0) {
                throw new Error(`Runtime 无法提供已验证的制品字节：${item.portableId}`)
              }
              const totalBytes = info.files.reduce((total, file) => total + file.content.byteLength, 0)
              const sourceRecord = info.record
              const record: WorkbenchArtifactRecordV1 = {
                digest: lock.digest,
                portableId: lock.portableId,
                version: lock.version,
                ...(sourceRecord?.name === undefined ? {} : { name: sourceRecord.name }),
                ...(sourceRecord?.purpose === undefined ? {} : { purpose: sourceRecord.purpose }),
                ...(lock.clientEntry === undefined ? {} : { clientEntry: lock.clientEntry }),
                ...(lock.hostEntry === undefined ? {} : { hostEntry: lock.hostEntry }),
                editorIds: [...lock.editorIds],
                sourcePolicy: lock.sourcePolicy,
                permissions: [...lock.permissions],
                size: totalBytes,
                ...(sourceRecord?.license === undefined ? {} : { license: sourceRecord.license }),
              }
              const bundle: WorkbenchArtifactBundleV1 = { record, files: info.files.map(file => ({ path: file.path, content: new Uint8Array(file.content) })) }
              if (store.get(lock.digest) === undefined) {
                await store.stage(bundle)
                await store.commit(lock.digest)
                stagedDigests.push(lock.digest)
              }
            } else if (item.repair === 'install-registry') {
              safePreparationTransition(transaction, 'installing-registry-dependencies')
              if (preparationOptions.networkApproved !== true) throw new Error(`安装 ${item.portableId} 需要明确批准网络访问。`)
              if (packageInstaller === undefined) throw new Error(`Runtime 未提供 DSH Profile npm/pnpm 安装器：${item.portableId}`)
              const receipt = await packageInstaller.install(lock, { allowScripts: false, network: true })
              if (receipt.portableId !== lock.portableId || receipt.version !== lock.version
                || receipt.digest.toUpperCase() !== lock.digest.toUpperCase()) {
                throw new Error(`Registry 安装收据与依赖锁不一致：${item.portableId}`)
              }
              installedPackages.push(receipt)
            } else if (item.repair === 'configure-registry' || item.repair === 'prepare-distribution') {
              throw new Error(`依赖 ${item.portableId} 需要用户补充分发资料，不能由 Runtime 自动猜测。`)
            }
          }
          if (transaction !== undefined) transaction.update({ issueIds: selected.map(item => item.issueId), stagedDigests, installedPackageIds: installedPackages.map(receipt => receipt.packageName) })
          safePreparationTransition(transaction, 'refreshing-runtime')
          safePreparationTransition(transaction, 'verifying-editors-and-agents')
          const inspection = inspectExportReadinessFor(input.workbenchId, input.mode)
          if (inspection === undefined) throw new Error('准备后无法重新扫描工作台依赖。')
          if (inspection.completeness === 'blocked' || inspection.completeness === 'needs-preparation' || inspection.completeness === 'layout-only') {
            const details = [
              ...inspection.blockers.map(issue => issue.message),
              ...inspection.repairable.map(item => `${item.portableId}: ${item.consequence}`),
            ].filter(Boolean).join('；')
            throw new Error(`准备动作完成后仍有未解决依赖${details === '' ? '' : `：${details}`}；本次准备已回滚。`)
          }
          for (const digest of stagedDigests) store?.retain(digest, `workbench-export:${input.workbenchId}`)
          safePreparationTransition(transaction, 'rechecking-readiness')
          safePreparationTransition(transaction, 'awaiting-export-confirmation')
          const record: ExportPreparationRecord = { transactionId, workbenchId: input.workbenchId, mode: input.mode, ...(store === undefined ? {} : { store }), stagedDigests, installedPackages, ...(transaction === undefined ? {} : { transaction }), readyForExport: true, npmArtifacts }
          exportPreparations.set(transactionId, record)
          return { status: 'committed', transactionId, inspection }
        } catch (error) {
          const record: ExportPreparationRecord = { transactionId, workbenchId: input.workbenchId, mode: input.mode, ...(store === undefined ? {} : { store }), stagedDigests, installedPackages, ...(transaction === undefined ? {} : { transaction }), readyForExport: false }
          await rollbackExportPreparation(record)
          const inspection = inspectExportReadinessFor(input.workbenchId, input.mode)
          return {
            status: 'failed', transactionId,
            reason: error instanceof Error ? error.message : '依赖准备失败。',
            ...(inspection === undefined ? {} : { inspection }),
          }
        }
      },
      recheck: async (workbenchId, mode = 'offline-embedded') => { await recoverExportPreparations(); return inspectExportReadinessFor(workbenchId, mode) },
      commitPreparation: async transactionId => {
        await recoverExportPreparations()
        const record = exportPreparations.get(transactionId)
        if (record === undefined || !record.readyForExport) return
        safePreparationTransition(record.transaction, 'exporting')
        if (record.store !== undefined) {
          for (const digest of record.stagedDigests) {
            record.store.release(digest, `workbench-export:${record.workbenchId}`)
            record.store.retain(digest, `workbench:${record.workbenchId}`)
          }
        }
        safePreparationTransition(record.transaction, 'committed')
        exportPreparations.delete(transactionId)
      },
      cancelPreparation: async transactionId => {
        await recoverExportPreparations()
        const record = exportPreparations.get(transactionId)
        if (record === undefined) return
        await rollbackExportPreparation(record)
      },
    }
  }
  const exportReadinessCoordinator = options.exportReadinessCoordinator ?? createDefaultExportReadinessCoordinator()
  // Resolve the callback at invocation time. Host services may be published
  // after the client package service is constructed; capturing `runtime()`
  // once here would permanently hide the Manager restart capability during
  // that normal startup ordering race.
  const restartAvailable = options.requestRestart !== undefined || options.distributionRuntime !== undefined
    ? (): boolean => {
        if (options.requestRestart !== undefined) return true
        const candidate = runtime()
        return candidate?.capabilities.restartResume === true && typeof candidate.requestRestart === 'function'
      }
    : undefined
  const requestRestart = restartAvailable === undefined ? undefined
    : async (transactionId: string): Promise<void> => {
        const callback = runtime()?.requestRestart ?? options.requestRestart
        if (!restartAvailable() || callback === undefined) throw new Error('当前启动方式不支持一键安全重启。请先关闭此 DSH 实例，再使用相同 Profile 重新启动。')
        await callback(transactionId)
      }
  return {
    preflight,
    preflightArchive: preflight,
    inspectImportDependencies,
    inspectDependencies,
    scanDependencies,
    inspectExportReadiness: inspectExportReadinessFor,
    ...(exportReadinessCoordinator === undefined ? {} : { exportReadinessCoordinator }),
    prepareExportDependencies: async (input, preparationOptions = {}) => {
      const coordinator = exportReadinessCoordinator
      if (coordinator === undefined) return { status: 'failed', reason: '当前 Workbench 没有可用的依赖准备协调器。' }
      return coordinator.prepare(input, preparationOptions)
    },
    prepare,
    resumeImport,
    bind,
    activate,
    prepareImport: async (archive, importOptions = {}) => {
      const report = await preflight(archive)
      return runImport(archive, {
      installPlugins: report.manifest?.schemaVersion === 2 && report.manifest.completeness !== 'layout-only',
      loadAfterImport: false,
      deferDynamicActivation: true,
      ...importOptions,
      })
    },
    ...(requestRestart === undefined ? {} : { requestRestart }),
    ...(restartAvailable === undefined ? {} : { restartAvailable }),
    runtimeStatus: () => workbenchDistributionRuntimeStatus(runtime()),
    // Expose the same validated attestation used by activation.  A malformed
    // or thrown Runtime callback must be downgraded to `unknown` consistently
    // in both the coordinator and the Settings diagnostics UI.
    runtimeReadiness: runtimeReadinessSnapshot,
    ...(options.subscribeDistributionRuntime === undefined ? {} : { subscribeRuntime: options.subscribeDistributionRuntime }),
    importArchive: runImport,
    exportArchive: async (workbenchId, exportOptions = {}) => {
      const snapshot = options.scope.getSnapshot()
      const record = snapshot.value?.workbenches[workbenchId]
      if (snapshot.status !== 'ready' || record === undefined) {
        return { status: 'unavailable', reason: '工作台当前不可读取或 Settings 不可用。' }
      }
      try {
        const editors = options.editorCatalog.getSnapshot()
        const inventory = buildWorkbenchInventory(record.document, editors)
        const scannedDependencySnapshot = inspectDependencies(workbenchId)
        if (scannedDependencySnapshot === undefined) return { status: 'unavailable', reason: '工作台依赖快照不可读取。' }
        const distributionMode = exportOptions.distributionMode
          ?? (scannedDependencySnapshot.completeness === 'complete-offline' ? 'offline-embedded' : 'online-reference')
        const runtimeReadiness = runtimeReadinessSnapshot()
        // A package can only claim executable completeness when the Runtime
        // has attested its activation surface. Older/browser-only DSH builds
        // still get a safe layout package, but never a falsely complete one.
        const artifactStoreForExport = runtime()?.artifactStore ?? options.artifactStore
        const verifiedOfflineArtifacts = distributionMode === 'offline-embedded'
          && scannedDependencySnapshot.completeness === 'complete-offline'
          && scannedDependencySnapshot.dependencies.every(dependency => dependency.digest !== ''
            && artifactStoreForExport?.get(dependency.digest) !== undefined)
        const baseDependencySnapshot: WorkbenchDependencySnapshotV1 = (runtimeReadiness.status === 'unknown' && !verifiedOfflineArtifacts) || runtimeReadiness.status === 'blocked'
          ? {
              ...scannedDependencySnapshot,
              completeness: 'layout-only',
              warnings: [...scannedDependencySnapshot.warnings, ...runtimeReadiness.blockers.map(issue => ({ code: issue.code, message: issue.message }))],
            }
          : distributionMode === 'online-reference' && scannedDependencySnapshot.completeness === 'complete-offline'
            ? { ...scannedDependencySnapshot, completeness: 'complete-online' }
            : scannedDependencySnapshot
        // Online-reference archives carry the lock and npm/Registry view, but
        // never carry executable bytes.  A local scanner may still have
        // attached `artifactPath` because the same dependency is embedded in
        // this Runtime; leaving that path in an online/layout lock would make
        // the recipient expect a file which is intentionally not present.
        // Strip it at the package boundary and let the explicit Registry
        // fields (or the layout-only warning) describe the true source.
        const dependencySnapshot: WorkbenchDependencySnapshotV1 = distributionMode === 'online-reference'
          ? {
              ...baseDependencySnapshot,
              dependencies: baseDependencySnapshot.dependencies.map(({ artifactPath: _artifactPath, ...dependency }) => dependency),
            }
          : baseDependencySnapshot
        if (distributionMode === 'offline-embedded' && dependencySnapshot.completeness !== 'complete-offline') {
          return { status: 'unavailable', reason: `无法导出离线完整包：${dependencySnapshot.blockers.map(issue => issue.message).join('；') || '缺少可嵌入制品或 Runtime readiness。'}` }
        }
        const selectedDigests = new Set(dependencySnapshot.dependencies
          .map(dependency => dependency.digest.toLocaleUpperCase('en-US'))
          .filter(digest => digest !== ''))
        // A Workbench may have been imported from an offline archive and then
        // edited before its first re-share.  Rehydrate missing npm tarballs
        // lazily from the Host Profile seam instead of silently emitting a
        // lock that claims bytes which are not present in this archive.
        if (distributionMode === 'offline-embedded') {
          const missingNpm = dependencySnapshot.dependencies.filter(dependency =>
            dependency.packageName !== undefined && !preparedNpmArtifacts.has(dependency.portableId))
          if (missingNpm.length > 0) {
            try {
              const packed = await exportArtifactProvider.prepare({ dependencies: missingNpm.map(dependency => ({
                portableId: dependency.portableId,
                packageName: dependency.packageName!,
                version: dependency.version,
                digest: dependency.digest,
                editorIds: dependency.editorIds,
                ...(dependency.clientEntry === undefined ? {} : { clientEntry: dependency.clientEntry }),
                ...(dependency.hostEntry === undefined ? {} : { hostEntry: dependency.hostEntry }),
                permissions: dependency.permissions,
                sourcePolicy: dependency.sourcePolicy,
              })) })
              for (const artifact of packed.npmArtifacts) {
                preparedNpmArtifacts.set(artifact.portableId, { digest: artifact.digest, integrity: artifact.integrity, tarball: new Uint8Array(artifact.tarball) })
              }
            } catch (error) {
              return { status: 'unavailable', reason: error instanceof Error ? error.message : '无法准备 npm 制品。' }
            }
          }
        }
        const npmArtifacts = dependencySnapshot.dependencies
          .filter(dependency => dependency.packageName !== undefined)
          .flatMap(dependency => {
            const prepared = preparedNpmArtifacts.get(dependency.portableId)
            return prepared === undefined ? [] : [{
              portableId: dependency.portableId,
              digest: prepared.digest,
              integrity: prepared.integrity,
              tarball: new Uint8Array(prepared.tarball),
            }]
          })
        const built: BuiltWorkbenchPackageV1 = await buildWorkbenchPackage({
          packageId: `local.${workbenchId}`,
          name: record.name,
          description: record.description,
          version: options.packageVersion ?? '0.0.0-local',
          createdAt: new Date(record.createdAt).toISOString(),
          document: record.document,
          inventory,
          editors,
          compatibility: compatibilityFor(environment()),
          // A share package describes the working layout, not the editor
          // navigation history kept inside each Area. Export only the active
          // editor per Area; local history remains available on the publisher
          // and is never copied into a recipient's Workbench.
          historyPolicy: 'active-editors-only',
          // Share only the explicit portability projection of an editor's
          // local state. Editors without a descriptor remain layout-only;
          // Workbench never exports their complete V4 state bank.
          statePolicy: 'sanitized',
          dependencySnapshot,
          sessions: projectWorkbenchSessionsAndAgentPresetsForSharing(record.document, options.sessionTemplateResolver).sessions,
          ...(options.sessionTemplateResolver === undefined ? {} : { sessionTemplateResolver: options.sessionTemplateResolver }),
          artifacts: distributionMode === 'offline-embedded'
            ? [...(options.artifacts ?? []), ...runtimeArtifacts(), ...storedArtifacts(), ...preparedExportArtifacts.values()]
              .filter(artifact => artifact.files !== undefined && selectedDigests.has(artifact.digest.toLocaleUpperCase('en-US'))).map(artifact => ({
            digest: artifact.digest, files: artifact.files ?? [],
            ...(artifact.record === undefined ? {} : { record: { ...artifact.record } }),
              }))
            : [],
          npmArtifacts: distributionMode === 'offline-embedded' ? npmArtifacts : [],
          distributionMode,
          publisher: { displayName: '本地工作台', source: 'local' },
          ...(record.packageOrigin === undefined ? {} : {
            derivedFrom: {
              packageId: record.packageOrigin.packageId,
              version: record.packageOrigin.version,
              archiveSha256: record.packageOrigin.archiveSha256,
            },
          }),
        })
        const archive = await encodeWorkbenchPackageArchive(built)
        return {
          status: 'committed',
          filename: `dsh-workbench-${safeFilename(record.name)}.dsh-workbench-package.zip`,
          archive,
          manifest: built.manifest,
        }
      } catch (error) {
        return {
          status: 'unavailable',
          reason: error instanceof Error ? error.message : '工作台包导出失败。',
        }
      }
    },
  }
}
