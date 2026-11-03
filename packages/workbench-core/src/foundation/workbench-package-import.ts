import type { WorkbenchSettingsScope as SettingsScope } from '../client/workbench-settings-contracts.ts'
import type { SettingsScopePatchResult } from '../client/workbench-settings-contracts.ts'
import type { WorkbenchPackageOriginV1, WorkbenchSettingsV4 } from './persistence.ts'
import type { WorkbenchEditorCatalogRow } from './catalog.ts'
import {
  decodeWorkbenchPackageArchive,
  prepareImportedWorkbenchSettings,
  type DecodedWorkbenchPackageArchiveV1,
  type PortableWorkbenchV1,
  type WorkbenchPackageCompatibilityV1,
  type WorkbenchPackageFileV1,
  type WorkbenchPackageManifestV1,
  type WorkbenchPackagePluginV1,
  type WorkbenchSessionsFileV1,
  type WorkbenchSessionTemplateBindingsV1,
  type WorkbenchPackageValidationResultV1,
  type WorkbenchNpmDependenciesFileV1,
  sha256Hex,
  validateWorkbenchPackage,
} from './workbench-sharing.ts'
import type { WorkbenchDependencyLockEntryV1 } from './workbench-distribution.ts'
import {
  decidePublisherTrust, verifyWorkbenchPackageSignature,
  type WorkbenchPackageSignatureV1, type WorkbenchPackageTrustStoreV1,
  type WorkbenchSignatureVerifierV1,
} from './workbench-package-trust.ts'
import {
  installWorkbenchPluginArtifact,
  type WorkbenchPluginArtifactInstallerV1,
} from './workbench-plugin-artifact.ts'
import type {
  WorkbenchArtifactBundleV1, WorkbenchArtifactRecordV1, WorkbenchArtifactStoreV1,
} from './workbench-artifact-store.ts'
import {
  WorkbenchImportTransactionControllerV1,
  type WorkbenchImportTransactionStateV1,
  type WorkbenchImportTransactionStoreV1,
} from './workbench-import-transaction.ts'
import type { WorkbenchRegistryV1 } from './workbench-package-registry.ts'

export type WorkbenchPackagePreflightSeverityV1 = 'error' | 'warning'

export interface WorkbenchPackagePreflightIssueV1 {
  severity: WorkbenchPackagePreflightSeverityV1
  code: string
  message: string
  path?: string
}

export interface WorkbenchPackagePreflightEnvironmentV1 {
  dshVersion: string
  uiSlotsVersion?: string
  previewProtocolVersion?: 1
  target?: string
  allowRemote?: boolean
  signature?: WorkbenchPackageSignatureV1
  signatureVerifier?: WorkbenchSignatureVerifierV1
  trustStore?: WorkbenchPackageTrustStoreV1
  packageOnlyTrustedKeys?: ReadonlySet<string>
  requireTrustedSignature?: boolean
}

export interface WorkbenchPackagePluginPlanV1 {
  manifest: WorkbenchPackagePluginV1
  files: readonly WorkbenchPackageFileV1[]
  installed: boolean
  requiresRestart: boolean
}

/**
 * Recipient-side dependency facts shown before an import can mutate the
 * Profile.  `localStatus` is deliberately separate from `packageStatus`: a
 * package may contain a perfectly valid embedded artifact which is still not
 * installed on this machine.
 */
export type WorkbenchPackageImportDependencyLocalStatusV1 =
  | 'installed' | 'available' | 'missing' | 'conflict' | 'unknown'

export type WorkbenchPackageImportDependencyPackageStatusV1 =
  | 'embedded' | 'registry' | 'unavailable'

export interface WorkbenchPackageImportDependencyStatusV1 {
  portableId: string
  packageName?: string
  version: string
  digest: string
  kind: WorkbenchDependencyLockEntryV1['kind']
  editorIds: readonly string[]
  localStatus: WorkbenchPackageImportDependencyLocalStatusV1
  packageStatus: WorkbenchPackageImportDependencyPackageStatusV1
  requiresRestart?: boolean
}

export type WorkbenchPackageImportProgressPhaseV1 =
  | 'scanning-package' | 'checking-local' | 'staging-artifacts'
  | 'installing-dependencies' | 'activating-dependencies'
  | 'verifying-editors' | 'restoring-state' | 'committing'
  | 'waiting-restart' | 'complete'

export interface WorkbenchPackageImportProgressV1 {
  phase: WorkbenchPackageImportProgressPhaseV1
  current: number
  total: number
  label: string
  dependency?: string
  requiresRestart?: boolean
}

export interface WorkbenchPackagePreflightResultV1 {
  valid: boolean
  manifest?: WorkbenchPackageManifestV1
  projection?: PortableWorkbenchV1
  plugins: readonly WorkbenchPackagePluginPlanV1[]
  permissions: readonly string[]
  dependencyLock?: readonly WorkbenchDependencyLockEntryV1[]
  npmDependencies?: WorkbenchNpmDependenciesFileV1
  agentPresets?: readonly WorkbenchDependencyLockEntryV1[]
  sessions?: WorkbenchSessionsFileV1
  issues: readonly WorkbenchPackagePreflightIssueV1[]
  /** Optional Runtime-owned inspection attached by the import UI. */
  localDependencies?: readonly WorkbenchPackageImportDependencyStatusV1[]
}

export type WorkbenchPackageImportResultV1 =
  | { status: 'committed'; workbenchId: string; revision: number; transactionId?: string }
  | { status: 'waiting-restart'; transactionId: string; reason: string }
  | { status: 'conflict'; expectedRevision: number | undefined; actualRevision: number | undefined }
  | { status: 'preflight-failed'; report: WorkbenchPackagePreflightResultV1 }
  | { status: 'unavailable'; reason?: string }

export interface WorkbenchDependencyActivationReceiptV1 {
  portableId: string
  packageId: string
  version: string
  digest: string
  /**
   * Runtime-local identities minted for this recipient. They are deliberately
   * optional for static packages, but dynamic packages must return both IDs so
   * an author-local plugin/run identity can never be silently reused.
   */
  localPluginId?: string
  localPluginRunId?: string
  /** Agent preset registries may return a recipient-local preset identity. */
  localPresetId?: string
  /** Kind is persisted only to route rollback after a Runtime restart. */
  activationKind?: 'static' | 'dynamic' | 'agent-preset' | 'shared'
  /** Runtime-owned activation proof for the editors promised by the lock. */
  editorIds?: readonly string[]
  /** Runtime may require a DSH restart before editor verification can begin. */
  requiresRestart?: boolean
}

/** Result returned by the DSH Profile npm/pnpm adapter after installation. */
export interface WorkbenchDependencyInstallReceiptV1 {
  portableId: string
  packageName: string
  version: string
  digest: string
  packageManager: 'pnpm' | 'npm' | 'registry'
  reused: boolean
  integrity?: string
  /** Runtime-owned rollback identity persisted in the durable transaction journal. */
  rollbackToken?: string
}

/**
 * Runtime-owned package installation seam. Workbench never invokes npm or
 * pnpm directly; the DSH Profile adapter owns the working directory,
 * lockfile, registry policy and process sandbox.
 */
export interface WorkbenchPackageInstallerV1 {
  install(
    dependency: WorkbenchDependencyLockEntryV1,
    options: { allowScripts: boolean; network: boolean },
  ): Promise<WorkbenchDependencyInstallReceiptV1>
  rollback(receipt: WorkbenchDependencyInstallReceiptV1): Promise<void>
}

export interface WorkbenchRequiredEditorV1 {
  editorId: string
  scope: 'root' | 'session'
}

export interface WorkbenchRequiredAgentPresetV1 {
  presetId: string
  portableId: string
  version: string
  digest: string
}

/** Runtime-owned static/dynamic activation seam; package parsing never executes code itself. */
export interface WorkbenchDependencyInstallerV1 {
  activate(
    dependency: WorkbenchDependencyLockEntryV1,
    artifact: WorkbenchArtifactBundleV1 | undefined,
  ): Promise<WorkbenchDependencyActivationReceiptV1>
  rollback(receipt: WorkbenchDependencyActivationReceiptV1): Promise<void>
}

export interface WorkbenchPackageImportOptionsV1 {
  environment: WorkbenchPackagePreflightEnvironmentV1
  workbenchId?: string
  name?: string
  description?: string
  now?: number
  prefix?: string
  installPlugins?: boolean
  pluginInstaller?: WorkbenchPluginArtifactInstallerV1
  /** Content-addressed store used for embedded dependency artifacts. */
  artifactStore?: WorkbenchArtifactStoreV1
  dependencyInstaller?: WorkbenchDependencyInstallerV1
  /**
   * Preparation may stage a complete package while deferring Dynamic Cordis
   * activation until the recipient has selected a real Session.  The package
   * remains inactive and must not be reported as ready-to-load until the
   * deferred dependencies are activated by the high-level coordinator.
   */
  deferDynamicActivation?: boolean
  /** Optional DSH Profile npm/pnpm adapter for online dependencies. */
  packageInstaller?: WorkbenchPackageInstallerV1
  loadAfterImport?: boolean
  beforeLifecycleTransition?: () => Promise<boolean>
  /** Runtime-owned post-activation seam; must verify editorId, scope and digest. */
  verifyInstalledEditors?: (
    editors: readonly WorkbenchRequiredEditorV1[],
    dependencies: readonly WorkbenchDependencyLockEntryV1[],
  ) => Promise<{ valid: boolean; reason?: string }>
  /** Runtime-owned post-activation seam for user-authored Agent presets. */
  verifyInstalledAgentPresets?: (
    presets: readonly WorkbenchRequiredAgentPresetV1[],
  ) => Promise<{ valid: boolean; reason?: string }>
  /** Optional durable controller seam. When supplied, every import phase is persisted. */
  transactionStore?: WorkbenchImportTransactionStoreV1
  transactionId?: string
  transactionNow?: () => number
  /** Optional durable receipt sink owned by the local Package Registry. */
  packageRegistry?: WorkbenchRegistryV1
  archiveSha256?: string
  receiptSource?: 'local' | 'community' | 'organization' | 'official'
  receiptSignatureState?: 'trusted' | 'package-only' | 'unsigned' | 'revoked'
  /** Recipient-selected real local targets. Omitted templates remain detached. */
  sessionTemplateBindings?: WorkbenchSessionTemplateBindingsV1
  /** Read after activation so portability.importState() uses the verified live descriptors. */
  editorCatalog?: readonly WorkbenchEditorCatalogRow[] | (() => readonly WorkbenchEditorCatalogRow[])
  /** Explicit grants from the current import review; high-risk permissions are never inferred. */
  approvedPermissions?: readonly string[]
  /** Browser-facing progress projection; it never carries executable bytes. */
  onProgress?: (progress: WorkbenchPackageImportProgressV1) => void
}

function packageOriginFromReport(
  report: WorkbenchPackagePreflightResultV1,
  archiveSha256: string | undefined,
): WorkbenchPackageOriginV1 | undefined {
  const manifest = report.manifest
  if (manifest === undefined || archiveSha256 === undefined || report.dependencyLock === undefined) return undefined
  return {
    packageId: manifest.packageId,
    version: manifest.version,
    archiveSha256,
    ...(manifest.completeness === undefined ? {} : { completeness: manifest.completeness }),
    dependencies: report.dependencyLock.map(dependency => ({
      portableId: dependency.portableId,
      version: dependency.version,
      digest: dependency.digest,
      kind: dependency.kind,
      sourcePolicy: dependency.sourcePolicy,
      exportPolicy: dependency.exportPolicy,
      editorIds: [...dependency.editorIds],
      ...(dependency.editorScopes === undefined ? {} : { editorScopes: dependency.editorScopes.map(scope => ({ ...scope })) }),
      permissions: [...dependency.permissions],
      requiredBy: [...dependency.requiredBy],
      ...(dependency.packageName === undefined ? {} : { packageName: dependency.packageName }),
      ...(dependency.registryUrl === undefined ? {} : { registryUrl: dependency.registryUrl }),
      ...(dependency.integrity === undefined ? {} : { integrity: dependency.integrity }),
      ...(dependency.installSource === undefined ? {} : { installSource: dependency.installSource }),
      ...(dependency.clientEntry === undefined ? {} : { clientEntry: dependency.clientEntry }),
      ...(dependency.hostEntry === undefined ? {} : { hostEntry: dependency.hostEntry }),
      ...(dependency.agentPresetId === undefined ? {} : { agentPresetId: dependency.agentPresetId }),
    })),
  }
}

const DEFAULT_PERMISSIONS = new Set([
  'ui.slot.register', 'preview.resolve', 'module.state.read', 'module.state.export',
])

export const WORKBENCH_HIGH_RISK_PERMISSIONS_V1 = [
  'network', 'filesystem', 'host.code', 'dynamic.cordis', 'session.read',
] as const
const HIGH_RISK_PERMISSIONS = new Set<string>(WORKBENCH_HIGH_RISK_PERMISSIONS_V1)

function versionParts(value: string): [number, number, number] | undefined {
  const match = /^(?:v)?(\d+)(?:\.(\d+))?(?:\.(\d+))?/u.exec(value.trim())
  return match === null ? undefined : [Number(match[1]), Number(match[2] ?? 0), Number(match[3] ?? 0)]
}

function versionAtLeast(actual: string, minimum: string): boolean {
  const left = versionParts(actual)
  const right = versionParts(minimum)
  if (left === undefined || right === undefined) return false
  for (let index = 0; index < 3; index += 1) {
    const leftPart = left[index] ?? 0
    const rightPart = right[index] ?? 0
    if (leftPart !== rightPart) return leftPart > rightPart
  }
  return true
}

function pathSet(manifest: WorkbenchPackageManifestV1): Set<string> {
  return new Set(manifest.files.map(file => file.path))
}

function compatibilityIssues(
  compatibility: WorkbenchPackageCompatibilityV1,
  environment: WorkbenchPackagePreflightEnvironmentV1,
): WorkbenchPackagePreflightIssueV1[] {
  const issues: WorkbenchPackagePreflightIssueV1[] = []
  if (!versionAtLeast(environment.dshVersion, compatibility.dsh.minimum)) {
    issues.push({ severity: 'error', code: 'dsh-version-incompatible', message: `需要 DSH ${compatibility.dsh.minimum} 或更高版本。` })
  }
  if (compatibility.dsh.maximum !== undefined && versionAtLeast(environment.dshVersion, compatibility.dsh.maximum)
    && environment.dshVersion !== compatibility.dsh.maximum) {
    issues.push({ severity: 'error', code: 'dsh-version-too-new', message: `此包最高支持 DSH ${compatibility.dsh.maximum}。` })
  }
  if (compatibility.uiSlots?.minimum !== undefined && environment.uiSlotsVersion !== undefined
    && !versionAtLeast(environment.uiSlotsVersion, compatibility.uiSlots.minimum)) {
    issues.push({ severity: 'error', code: 'ui-slots-version-incompatible', message: `需要 UI Slots ${compatibility.uiSlots.minimum} 或更高版本。` })
  }
  if (compatibility.previewProtocol?.minimum !== undefined
    && environment.previewProtocolVersion !== undefined
    && environment.previewProtocolVersion < compatibility.previewProtocol.minimum) {
    issues.push({ severity: 'error', code: 'preview-protocol-incompatible', message: '此包需要更高版本的预览协议。' })
  }
  if (environment.target !== undefined && compatibility.targets !== undefined
    && !compatibility.targets.includes('any') && !compatibility.targets.includes(environment.target)) {
    issues.push({ severity: 'error', code: 'platform-incompatible', message: '此包不支持当前运行平台。' })
  }
  return issues
}

function pluginIssues(
  manifest: WorkbenchPackagePluginV1,
  files: Set<string>,
  environment: WorkbenchPackagePreflightEnvironmentV1,
): WorkbenchPackagePreflightIssueV1[] {
  const issues: WorkbenchPackagePreflightIssueV1[] = []
  if (!files.has(manifest.manifestPath)) issues.push({ severity: 'error', code: 'plugin-manifest-missing', message: '插件 manifest 不在包文件清单中。', path: manifest.manifestPath })
  if (manifest.clientEntry !== undefined && !files.has(manifest.clientEntry)) issues.push({ severity: 'error', code: 'plugin-client-entry-missing', message: '插件 client entry 不在包文件清单中。', path: manifest.clientEntry })
  if (manifest.hostEntry !== undefined && !files.has(manifest.hostEntry)) issues.push({ severity: 'error', code: 'plugin-host-entry-missing', message: '插件 Host entry 不在包文件清单中。', path: manifest.hostEntry })
  if (manifest.sourcePolicy === 'remote' && environment.allowRemote !== true) issues.push({ severity: 'error', code: 'remote-editor-not-allowed', message: '当前导入策略不允许远程内页。' })
  if (manifest.previewProtocol !== undefined && manifest.previewProtocol !== 1) issues.push({ severity: 'error', code: 'unknown-preview-protocol', message: '插件声明了未知的预览协议版本。' })
  for (const permission of manifest.permissions) {
    if (!DEFAULT_PERMISSIONS.has(permission)) issues.push({ severity: 'warning', code: 'additional-permission', message: `插件请求额外权限：${permission}。`, path: manifest.packageId })
  }
  return issues
}

function projectionFromFiles(manifest: WorkbenchPackageManifestV1, files: readonly WorkbenchPackageFileV1[]): PortableWorkbenchV1 | undefined {
  const entry = files.find(file => file.path === manifest.workbenchPath)
  if (entry === undefined) return undefined
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(entry.content)) as PortableWorkbenchV1
  } catch {
    return undefined
  }
}

function jsonFile<T>(files: readonly WorkbenchPackageFileV1[], path: string): T | undefined {
  const entry = files.find(file => file.path === path)
  if (entry === undefined) return undefined
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(entry.content)) as T } catch { return undefined }
}

function safeDependencyArtifactPath(path: unknown): path is string {
  return typeof path === 'string' && path.trim() !== '' && !path.startsWith('/') && !path.startsWith('\\')
    && !/^[A-Za-z]:/u.test(path) && !path.includes('\\')
    && path.split('/').every(part => part !== '' && part !== '.' && part !== '..')
}

/** Validate the dependency lock as untrusted package data before activation. */
function dependencyLockIssues(
  value: unknown,
  completeness: WorkbenchPackageManifestV1['completeness'] | undefined,
): WorkbenchPackagePreflightIssueV1[] {
  if (!Array.isArray(value)) return [{ severity: 'error', code: 'dependency-lock-shape-invalid', message: '依赖锁定文件必须是数组。' }]
  const issues: WorkbenchPackagePreflightIssueV1[] = []
  const seen = new Set<string>()
  for (const [index, raw] of value.entries()) {
    const path = `dependencies.lock.json[${index}]`
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      issues.push({ severity: 'error', code: 'dependency-lock-entry-invalid', message: '依赖锁定项不是对象。', path })
      continue
    }
    const item = raw as Record<string, unknown>
    const portableId = typeof item.portableId === 'string' ? item.portableId : ''
    const version = typeof item.version === 'string' ? item.version : ''
    const digest = typeof item.digest === 'string' ? item.digest : undefined
    const kind = item.kind
    const sourcePolicy = item.sourcePolicy
    const exportPolicy = item.exportPolicy
    if (portableId.trim() === '' || version.trim() === '' || digest === undefined
      || !/^[a-f0-9]{64}$/iu.test(digest) && digest !== '') {
      issues.push({ severity: 'error', code: 'dependency-lock-identity-invalid', message: '依赖锁定项的 portableId、版本或 digest 无效。', path })
    }
    if (seen.has(portableId)) issues.push({ severity: 'error', code: 'dependency-lock-duplicate', message: `依赖锁定项重复：${portableId}。`, path })
    if (portableId !== '') seen.add(portableId)
    if (kind !== 'static' && kind !== 'dynamic' && kind !== 'shared' && kind !== 'agent-preset') {
      issues.push({ severity: 'error', code: 'dependency-lock-kind-invalid', message: `依赖锁定项类型无效：${portableId || index}。`, path })
    }
    if (sourcePolicy !== 'source-included' && sourcePolicy !== 'binary-only' && sourcePolicy !== 'remote') {
      issues.push({ severity: 'error', code: 'dependency-lock-source-invalid', message: `依赖来源策略无效：${portableId || index}。`, path })
    }
    if (exportPolicy !== 'embed' && exportPolicy !== 'reference' && exportPolicy !== 'forbid') {
      issues.push({ severity: 'error', code: 'dependency-lock-export-invalid', message: `依赖导出策略无效：${portableId || index}。`, path })
    }
    const editorIds = Array.isArray(item.editorIds)
      ? item.editorIds.filter((editorId): editorId is string => typeof editorId === 'string')
      : []
    if (!Array.isArray(item.editorIds) || editorIds.length !== item.editorIds.length
      || !editorIds.every(editorId => editorId.trim() !== '')
      || new Set(editorIds).size !== editorIds.length) {
      issues.push({ severity: 'error', code: 'dependency-lock-editors-invalid', message: `依赖 editor 列表无效：${portableId || index}。`, path })
    }
    if (item.editorScopes !== undefined) {
      const scopes = item.editorScopes
      if (!Array.isArray(scopes) || !scopes.every(scope => typeof scope === 'object' && scope !== null
        && typeof (scope as Record<string, unknown>).editorId === 'string'
        && typeof (scope as Record<string, unknown>).scope === 'string'
        && ((scope as Record<string, unknown>).scope === 'root' || (scope as Record<string, unknown>).scope === 'session'))
        || !Array.isArray(item.editorIds)
        || !scopes.every(scope => editorIds.includes((scope as Record<string, unknown>).editorId as string))
        || new Set(scopes.map(scope => (scope as Record<string, unknown>).editorId)).size !== editorIds.length
        || new Set(scopes.map(scope => `${(scope as Record<string, unknown>).scope}:${(scope as Record<string, unknown>).editorId}`)).size !== scopes.length) {
        issues.push({ severity: 'error', code: 'dependency-lock-editor-scopes-invalid', message: `依赖 editor scope 列表无效：${portableId || index}。`, path })
      }
    }
    if (!Array.isArray(item.requiredBy) || !item.requiredBy.every(area => typeof area === 'string' && area.trim() !== '')) {
      issues.push({ severity: 'error', code: 'dependency-lock-required-by-invalid', message: `依赖使用来源无效：${portableId || index}。`, path })
    }
    if (!Array.isArray(item.permissions) || !item.permissions.every(permission => typeof permission === 'string' && permission.trim() !== '')) {
      issues.push({ severity: 'error', code: 'dependency-lock-permissions-invalid', message: `依赖权限列表无效：${portableId || index}。`, path })
    }
    const installSource = item.installSource
    if (installSource !== undefined && installSource !== 'npm' && installSource !== 'registry' && installSource !== 'embedded' && installSource !== 'local') {
      issues.push({ severity: 'error', code: 'dependency-lock-install-source-invalid', message: `依赖安装来源无效：${portableId || index}。`, path })
    }
    if ((installSource === 'npm' || installSource === 'registry') && (item.artifactPath === undefined || completeness === 'complete-online')
      && (typeof item.packageName !== 'string' || typeof item.registryUrl !== 'string'
        || typeof item.integrity !== 'string' || !/^(?:sha512|sha256)-[A-Za-z0-9+/]+={0,2}$/u.test(item.integrity))) {
      issues.push({ severity: 'error', code: 'dependency-lock-profile-source-incomplete', message: `Profile 依赖缺少 packageName、Registry URL 或 integrity：${portableId || index}。`, path })
    }
    if (item.artifactPath !== undefined && (!safeDependencyArtifactPath(item.artifactPath)
      || typeof digest !== 'string' || digest === '' || item.artifactPath !== `artifacts/${digest}/artifact.json`)) {
      issues.push({ severity: 'error', code: 'dependency-lock-artifact-path-invalid', message: `依赖制品路径无效：${portableId || index}。`, path })
    }
    if (completeness === 'complete-offline'
      && (digest === '' || item.exportPolicy !== 'embed' || item.artifactPath === undefined)) {
      issues.push({ severity: 'error', code: 'offline-dependency-incomplete', message: `离线完整包依赖未嵌入：${portableId || index}。`, path })
    }
    if (completeness === 'complete-online' && digest === '') {
      issues.push({ severity: 'error', code: 'online-dependency-unlocked', message: `在线完整包依赖没有固定摘要：${portableId || index}。`, path })
    }
    if (completeness === 'complete-online'
      && (installSource !== 'npm' && installSource !== 'registry')) {
      issues.push({ severity: 'error', code: 'online-dependency-source-unresolved', message: `在线完整包依赖没有可由 Profile 获取的 Registry 来源：${portableId || index}。`, path })
    }
    if (completeness !== 'layout-only' && exportPolicy === 'forbid') {
      issues.push({ severity: 'error', code: 'dependency-export-forbidden', message: `完整包包含禁止分发的依赖：${portableId || index}。`, path })
    }
  }
  return issues
}

/** Validate compatibility, plugin artifact declarations and permissions only. */
export async function preflightWorkbenchPackage(
  manifest: unknown,
  files: readonly WorkbenchPackageFileV1[],
  environment: WorkbenchPackagePreflightEnvironmentV1,
): Promise<WorkbenchPackagePreflightResultV1> {
  const base: WorkbenchPackageValidationResultV1 = await validateWorkbenchPackage(manifest, files)
  if (!base.valid || typeof manifest !== 'object' || manifest === null) {
    return {
      valid: false, plugins: [], permissions: [],
      issues: base.errors.map(message => ({ severity: 'error' as const, code: 'manifest-invalid', message })),
    }
  }
  const typed = manifest as WorkbenchPackageManifestV1
  if (typeof typed.compatibility !== 'object' || typed.compatibility === null || !Array.isArray(typed.plugins) || !Array.isArray(typed.permissions)) {
    return {
      valid: false, manifest: typed, plugins: [], permissions: [],
      issues: [{ severity: 'error', code: 'manifest-shape-invalid', message: 'manifest 的兼容性、插件或权限字段无效。' }],
    }
  }
  const issues = compatibilityIssues(typed.compatibility, environment)
  const embeddedSignature = typed.signaturePath === 'signature.json'
    ? jsonFile<WorkbenchPackageSignatureV1>(files, 'signature.json')
    : undefined
  const signature = environment.signature ?? embeddedSignature
  const publisherRequiresTrust = typed.publisher?.source === 'community'
    || typed.publisher?.source === 'organization' || typed.publisher?.source === 'official'
  const signatureRequired = environment.requireTrustedSignature === true || publisherRequiresTrust
  if (signatureRequired) {
    if (signature === undefined || environment.signatureVerifier === undefined) {
      issues.push({ severity: 'error', code: 'signature-required', message: '当前策略要求包带有可验证签名。' })
    } else {
      const signatureResult = await verifyWorkbenchPackageSignature(typed, signature, environment.signatureVerifier)
      if (!signatureResult.valid || signatureResult.keyId === undefined) {
        issues.push({ severity: 'error', code: `signature-${signatureResult.reason}`, message: '发布者签名验证失败。' })
      } else if (environment.trustStore === undefined) {
        issues.push({ severity: 'error', code: 'publisher-trust-unavailable', message: '当前运行时没有发布者信任库，不能验证正式分发包。' })
      } else {
        const trust = decidePublisherTrust(signature, environment.trustStore, environment.packageOnlyTrustedKeys)
        if (trust.state !== 'trusted' && trust.state !== 'package-only') {
          issues.push({ severity: 'error', code: `publisher-${trust.state}`, message: '发布者尚未被信任。' })
        }
      }
    }
  } else if (signature === undefined) {
    issues.push({ severity: 'warning', code: 'unsigned-local-package', message: '这是未签名的本地开发包；摘要只能证明文件一致，不能证明发布者身份。' })
  } else if (environment.signatureVerifier === undefined) {
    issues.push({ severity: 'warning', code: 'signature-unverified', message: '包带有签名，但当前运行时没有签名验证器。' })
  } else {
    const signatureResult = await verifyWorkbenchPackageSignature(typed, signature, environment.signatureVerifier)
    if (!signatureResult.valid) issues.push({ severity: 'error', code: `signature-${signatureResult.reason}`, message: '发布者签名验证失败。' })
    else if (environment.trustStore !== undefined) {
      const trust = decidePublisherTrust(signature, environment.trustStore, environment.packageOnlyTrustedKeys)
      if (trust.state === 'revoked') issues.push({ severity: 'error', code: 'publisher-revoked', message: '发布者已被撤销。' })
    }
  }
  const paths = pathSet(typed)
  const dependencyLock = typed.schemaVersion === 2
    ? jsonFile<readonly WorkbenchDependencyLockEntryV1[]>(files, 'dependencies.lock.json')
    : undefined
  const npmDependencies = typed.schemaVersion === 2
    ? jsonFile<WorkbenchNpmDependenciesFileV1>(files, 'dependencies.npm.json')
    : undefined
  const agentPresets = dependencyLock?.filter(item => item.kind === 'agent-preset')
  const sessions = typed.schemaVersion === 2
    ? jsonFile<WorkbenchSessionsFileV1>(files, 'sessions.json')
    : undefined
  if (typed.schemaVersion === 1) {
    issues.push({ severity: 'warning', code: 'legacy-package-layout-only', message: 'v1 分享包只按 layout-only 处理，不能证明依赖已安装。' })
  }
  if (typed.schemaVersion === 2 && dependencyLock === undefined) {
    issues.push({ severity: 'error', code: 'dependency-lock-unreadable', message: '无法读取依赖锁定文件。' })
  }
  if (typed.schemaVersion === 2 && dependencyLock !== undefined) {
    issues.push(...dependencyLockIssues(dependencyLock, typed.completeness))
    for (const dependency of dependencyLock) {
      if (dependency.artifactPath !== undefined && !paths.has(dependency.artifactPath)) {
        issues.push({ severity: 'error', code: 'dependency-artifact-missing', message: `依赖制品不在归档中：${dependency.portableId}。`, path: dependency.artifactPath })
      }
    }
  }
  if (typed.schemaVersion === 2 && dependencyLock !== undefined && environment.allowRemote !== true
    && dependencyLock.some(item => item.artifactPath === undefined
      && (item.sourcePolicy === 'remote' || item.registryUrl !== undefined))) {
    issues.push({ severity: 'error', code: 'remote-dependency-not-allowed', message: '当前导入策略不允许依赖通过网络获取。' })
  }
  const pluginPlans = typed.plugins.map(plugin => ({
    manifest: plugin,
    files: files.filter(file => file.path === plugin.manifestPath || file.path.startsWith(`plugins/${plugin.packageId}/`)),
    installed: false,
    requiresRestart: plugin.clientEntry !== undefined || plugin.hostEntry !== undefined,
  }))
  const pluginIds = new Set<string>()
  for (const plugin of typed.plugins) {
    if (pluginIds.has(plugin.packageId)) issues.push({ severity: 'error', code: 'duplicate-plugin', message: `插件重复：${plugin.packageId}。` })
    pluginIds.add(plugin.packageId)
    issues.push(...pluginIssues(plugin, paths, environment))
  }
  const projection = projectionFromFiles(typed, files)
  if (projection === undefined) issues.push({ severity: 'error', code: 'projection-invalid', message: '无法读取 workbench.json。' })
  const permissions = [...new Set(typed.permissions)].sort()
  return {
    valid: issues.every(issue => issue.severity !== 'error'),
    manifest: typed,
    ...(projection === undefined ? {} : { projection }),
    plugins: pluginPlans,
    permissions,
    ...(dependencyLock === undefined ? {} : { dependencyLock }),
    ...(npmDependencies === undefined ? {} : { npmDependencies }),
    ...(agentPresets === undefined ? {} : { agentPresets }),
    ...(sessions === undefined ? {} : { sessions }),
    issues,
  }
}

export async function preflightWorkbenchPackageArchive(
  archive: Uint8Array,
  environment: WorkbenchPackagePreflightEnvironmentV1,
): Promise<WorkbenchPackagePreflightResultV1> {
  try {
    const decoded = await decodeWorkbenchPackageArchive(archive)
    return preflightWorkbenchPackage(decoded.manifest, decoded.files, environment)
  } catch (error) {
    return {
      valid: false, plugins: [], permissions: [],
      issues: [{ severity: 'error', code: 'archive-invalid', message: error instanceof Error ? error.message : '包归档无效。' }],
    }
  }
}

function removeTransientMigration(value: WorkbenchSettingsV4): WorkbenchSettingsV4 {
  const { migrationRequired: _migrationRequired, ...persisted } = value
  return persisted
}

function requiredEditorsOf(projection: PortableWorkbenchV1): readonly WorkbenchRequiredEditorV1[] {
  const result = new Map<string, WorkbenchRequiredEditorV1>()
  const visit = (node: PortableWorkbenchV1['root']): void => {
    if (node.kind === 'split') { visit(node.first); visit(node.second); return }
    const active = node.editors.find(editor => editor.key === node.activeEditorKey)
    if (active !== undefined) result.set(`${active.scope}:${active.editorId}`, { editorId: active.editorId, scope: active.scope })
  }
  visit(projection.root)
  return [...result.values()].sort((left, right) => `${left.scope}:${left.editorId}`.localeCompare(`${right.scope}:${right.editorId}`, 'en'))
}

function requiredEditorsOfProjectionExcluding(
  projection: PortableWorkbenchV1,
  deferredEditorIds: ReadonlySet<string>,
): readonly WorkbenchRequiredEditorV1[] {
  return requiredEditorsOf(projection).filter(editor => !deferredEditorIds.has(editor.editorId))
}

function activationReceiptIssue(
  dependency: WorkbenchDependencyLockEntryV1,
  receipt: WorkbenchDependencyActivationReceiptV1,
): string | undefined {
  if (receipt.portableId !== dependency.portableId
    || receipt.version !== dependency.version
    || receipt.digest.toUpperCase() !== dependency.digest.toUpperCase()) {
    return `依赖安装收据与锁定信息不一致：${dependency.portableId}`
  }
  if (receipt.packageId.trim() === '') return `依赖安装收据缺少本地 Package 身份：${dependency.portableId}`
  if (receipt.activationKind !== undefined && receipt.activationKind !== dependency.kind) {
    return `依赖安装收据类型与锁定信息不一致：${dependency.portableId}`
  }
  if (dependency.kind === 'dynamic'
    && (receipt.localPluginId?.trim() === '' || receipt.localPluginId === undefined
      || receipt.localPluginRunId?.trim() === '' || receipt.localPluginRunId === undefined)) {
    return `动态依赖没有返回新的本地 pluginId/pluginRunId：${dependency.portableId}`
  }
  if (dependency.kind === 'agent-preset'
    && (receipt.localPresetId?.trim() === '' || receipt.localPresetId === undefined)) {
    return `Agent 模式依赖没有返回新的本地 preset 身份：${dependency.portableId}`
  }
  if (receipt.editorIds !== undefined) {
    const expected = new Set(dependency.editorIds)
    const actual = new Set(receipt.editorIds)
    if (actual.size !== receipt.editorIds.length || actual.size !== expected.size
      || [...expected].some(editorId => !actual.has(editorId))) {
      return `依赖激活收据没有完整承诺 editorId：${dependency.portableId}`
    }
  }
  return undefined
}

/**
 * Import a validated package through the revision-aware Settings root. The
 * default path creates an unloaded Workbench; `loadAfterImport` is explicit and
 * guarded so it cannot project stale Frame layout into the imported document.
 */
export async function importWorkbenchPackageIntoSettings(
  scope: SettingsScope<WorkbenchSettingsV4>,
  decoded: DecodedWorkbenchPackageArchiveV1,
  options: WorkbenchPackageImportOptionsV1,
): Promise<WorkbenchPackageImportResultV1> {
  const reportProgress = (progress: WorkbenchPackageImportProgressV1): void => {
    try { options.onProgress?.(progress) } catch { /* UI progress must never abort an import */ }
  }
  reportProgress({ phase: 'scanning-package', current: 0, total: 1, label: '正在扫描离线分享包…' })
  const report = await preflightWorkbenchPackage(decoded.manifest, decoded.files, options.environment)
  if (!report.valid || report.projection === undefined) return { status: 'preflight-failed', report }
  reportProgress({ phase: 'scanning-package', current: 1, total: 1, label: '离线分享包扫描完成' })
  try {
    // Durable adapters restore their content-addressed rows asynchronously so
    // every lookup below observes the same committed snapshot.  The optional
    // barrier is deliberately storage-only; it never executes a package.
    await options.artifactStore?.ready?.()
    await options.packageRegistry?.ready?.()
  } catch (error) {
    return {
      status: 'unavailable',
      reason: `导入依赖存储无法恢复：${error instanceof Error ? error.message : String(error)}`,
    }
  }
  const transactionNow = options.transactionNow ?? Date.now
  const transactionStartedAt = transactionNow()
  const transactionId = report.manifest === undefined
    ? undefined
    // Keep the journal key transport-safe: package IDs may contain scoped
    // names (`@scope/pkg`) and are not suitable for the Manager header/path
    // contract. The package identity is already persisted separately in the
    // transaction row, so it does not need to be repeated in this key.
    : options.transactionId ?? `workbench-import-${transactionStartedAt}-${Math.random().toString(36).slice(2, 10)}`
  const existingTransaction = transactionId === undefined || options.transactionStore === undefined
    ? undefined
    : options.transactionStore.get(transactionId)
  if (existingTransaction !== undefined && report.manifest !== undefined
    && (existingTransaction.packageId !== report.manifest.packageId
      || existingTransaction.packageVersion !== report.manifest.version)) {
    return { status: 'unavailable', reason: '事务 ID 已被其他工作台包占用，不能复用。' }
  }
  if (existingTransaction?.archiveSha256 !== undefined
    && (options.archiveSha256 === undefined
      || existingTransaction.archiveSha256.toUpperCase() !== options.archiveSha256.toUpperCase())) {
    return { status: 'unavailable', reason: '事务 ID 对应的归档摘要不一致，不能复用。' }
  }
  if (existingTransaction?.state === 'ready') {
    if (existingTransaction.workbenchId === undefined || existingTransaction.committedRevision === undefined) {
      return { status: 'unavailable', reason: '已完成事务缺少提交结果，不能安全恢复。' }
    }
    const currentSnapshot = scope.getSnapshot()
    if (currentSnapshot.status !== 'ready' || currentSnapshot.value?.workbenches[existingTransaction.workbenchId] === undefined) {
      return { status: 'unavailable', reason: '已完成事务对应的 Workbench 不在当前 Settings 中，不能伪造恢复结果。' }
    }
    return {
      status: 'committed',
      workbenchId: existingTransaction.workbenchId,
      revision: existingTransaction.committedRevision,
      transactionId: existingTransaction.transactionId,
    }
  }
  if (existingTransaction?.state === 'failed') {
    return { status: 'unavailable', reason: existingTransaction.error ?? '该导入事务已失败，请使用新的事务 ID 重试。' }
  }
  if (existingTransaction !== undefined
    && ['activating', 'verifying', 'restoring-state', 'committing'].includes(existingTransaction.state)) {
    return {
      status: 'unavailable',
      reason: '事务已在运行时激活阶段中断，浏览器协调器不会猜测已执行的代码；请交由 Runtime coordinator 恢复或回滚后再试。',
    }
  }
  const transaction = options.transactionStore === undefined || report.manifest === undefined || transactionId === undefined
    ? undefined
    : WorkbenchImportTransactionControllerV1.resumeOrCreate({
        schemaVersion: 1,
        transactionId,
        packageId: report.manifest.packageId,
        packageVersion: report.manifest.version,
        ...(options.archiveSha256 === undefined ? {} : { archiveSha256: options.archiveSha256 }),
        state: 'inspecting',
        createdAt: transactionStartedAt,
        updatedAt: transactionStartedAt,
        stagedDigests: [],
        installedPackageIds: [],
      }, options.transactionStore)
  const transactionPhaseRank: Record<WorkbenchImportTransactionStateV1, number> = {
    inspecting: 0, 'awaiting-trust': 1, 'awaiting-permissions': 2,
    'awaiting-target-bindings': 3, staging: 4, 'waiting-restart': 5,
    activating: 6, verifying: 7, 'restoring-state': 8, committing: 9,
    ready: 10, 'rolling-back': 11, failed: 12,
  }
  const safeTransition = (state: WorkbenchImportTransactionStateV1): void => {
    if (transaction === undefined) return
    const current = transaction.snapshot.state
    if (current === state || transactionPhaseRank[current] > transactionPhaseRank[state]) return
    transaction.transition(state, transactionNow())
  }
  // Trust, permission and binding review happen in preflight/the calling UI for
  // this synchronous adapter. Persist the same state-machine stages so a host
  // can resume or audit the import without guessing where code ran.
  safeTransition('awaiting-trust')
  safeTransition('awaiting-permissions')
  const approvedPermissions = new Set(options.approvedPermissions ?? [])
  const unapprovedHighRisk = report.permissions.filter(permission =>
    HIGH_RISK_PERMISSIONS.has(permission) && !approvedPermissions.has(permission))
  if (unapprovedHighRisk.length > 0) {
    const reason = `高风险权限尚未批准：${unapprovedHighRisk.join('、')}。`
    transaction?.transition('failed', transactionNow(), reason)
    return { status: 'unavailable', reason }
  }
  safeTransition('awaiting-target-bindings')
  const snapshot = scope.getSnapshot()
  if (snapshot.status !== 'ready' || !snapshot.writable || snapshot.value === undefined) {
    transaction?.transition('failed', transactionNow(), 'Settings 不可写。')
    return { status: 'unavailable', reason: 'Settings 不可写。' }
  }
  if (options.loadAfterImport && options.beforeLifecycleTransition !== undefined && !(await options.beforeLifecycleTransition())) {
    transaction?.transition('failed', transactionNow(), '当前布局尚未成功保存。')
    return { status: 'unavailable', reason: '当前布局尚未成功保存。' }
  }
  const installedPlugins: WorkbenchPackagePluginV1[] = []
  const activatedDependencies: WorkbenchDependencyActivationReceiptV1[] = (existingTransaction?.activatedDependencies ?? [])
    .map(receipt => ({ ...receipt }))
  const installedPackages: WorkbenchDependencyInstallReceiptV1[] = (existingTransaction?.installedPackages ?? [])
    .map(receipt => ({ ...receipt }))
  const stagedArtifacts: string[] = [...(existingTransaction?.stagedDigests ?? [])]
  // Keep rollback scoped to artifacts introduced by this import. A failed
  // package must never clean an unrelated, already-installed shared artifact.
  const artifactCleanupCandidates: string[] = []
  const cleanupArtifacts = () => options.artifactStore?.cleanup(artifactCleanupCandidates)
  const rollbackRuntime = async () => {
    const failures: string[] = []
    const capture = (error: unknown): void => {
      failures.push(error instanceof Error ? error.message : String(error))
    }
    if (options.pluginInstaller !== undefined) {
      for (const plugin of [...installedPlugins].reverse()) {
        try { await options.pluginInstaller.rollback(plugin) } catch (error) { capture(error) }
      }
    }
    if (options.dependencyInstaller !== undefined) {
      for (const receipt of [...activatedDependencies].reverse()) {
        try { await options.dependencyInstaller.rollback(receipt) } catch (error) { capture(error) }
      }
    }
    if (options.packageInstaller !== undefined) {
      for (const receipt of [...installedPackages].reverse()) {
        try { await options.packageInstaller.rollback(receipt) } catch (error) { capture(error) }
      }
    }
    if (failures.length > 0 && transaction !== undefined) {
      const reason = `Runtime 回滚不完整：${failures.join('；')}`
      const state = transaction.snapshot.state
      try {
        if (state !== 'rolling-back' && state !== 'failed' && state !== 'ready') transaction.transition('rolling-back', transactionNow(), reason)
        if (transaction.snapshot.state === 'rolling-back') transaction.transition('failed', transactionNow(), reason)
        else if (transaction.snapshot.state !== 'failed' && transaction.snapshot.state !== 'ready') transaction.transition('failed', transactionNow(), reason)
      } catch {
        // The original import error remains the public result; the journal
        // update is best effort when a host is already shutting down.
      }
    }
    return failures
  }
  const failTransaction = (reason: string) => {
    if (transaction === undefined) return
    const state = transaction.snapshot.state
    if (state === 'staging' || state === 'waiting-restart' || state === 'activating'
      || state === 'verifying' || state === 'restoring-state' || state === 'committing') {
      transaction.transition('rolling-back', transactionNow(), reason)
      transaction.transition('failed', transactionNow(), reason)
    } else if (state !== 'failed' && state !== 'ready') transaction.transition('failed', transactionNow(), reason)
  }
  safeTransition('staging')
  // A journal resumed after Runtime restart is checkpointed at
  // `waiting-restart`.  Re-enter the activation phase explicitly before
  // replaying idempotent receipts; jumping directly to verification would
  // violate the durable state machine and leave the transaction stranded.
  if (transaction?.snapshot.state === 'waiting-restart') {
    transaction.transition('activating', transactionNow())
  }
  if (report.manifest?.schemaVersion === 2 && report.manifest.completeness === 'complete-offline') {
    if (options.artifactStore === undefined) {
      const reason = '离线完整包需要 Artifact Store 才能安装制品。'
      failTransaction(reason)
      return { status: 'unavailable', reason }
    }
    try {
      const embeddedDependencies = (report.dependencyLock ?? []).filter(dependency => dependency.artifactPath !== undefined)
      let stagedCount = 0
      reportProgress({ phase: 'staging-artifacts', current: 0, total: embeddedDependencies.length, label: '正在检查包内离线制品…' })
      for (const dependency of report.dependencyLock ?? []) {
        if (dependency.artifactPath === undefined) continue
        // A restart may reopen a journal after staging completed. Reuse only
        // a digest that is still present in the content-addressed store;
        // otherwise restage it from the bounded archive.
        if (stagedArtifacts.includes(dependency.digest)
          && options.artifactStore.get(dependency.digest) !== undefined) continue
        if (options.artifactStore.get(dependency.digest) === undefined) artifactCleanupCandidates.push(dependency.digest)
        const recordFile = decoded.files.find(file => file.path === dependency.artifactPath)
        const prefix = `artifacts/${dependency.digest}/`
        const payload = decoded.files
          .filter(file => file.path.startsWith(prefix) && file.path !== dependency.artifactPath)
          .map(file => ({ path: file.path.slice(prefix.length), content: file.content }))
        if (recordFile === undefined || payload.length === 0) throw new Error(`离线制品缺失：${dependency.portableId}`)
        const record = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(recordFile.content)) as WorkbenchArtifactRecordV1
        // The artifact record is part of the untrusted archive.  Its content
        // digest is checked by ArtifactStore, but that alone does not prove it
        // is the artifact promised by this dependency lock: a publisher could
        // place a valid, different package under the expected artifact path.
        // Bind the record to the lock before staging any executable bytes.
        if (record.digest.toUpperCase() !== dependency.digest.toUpperCase()
          || record.portableId !== dependency.portableId
          || record.version !== dependency.version
          || record.sourcePolicy !== dependency.sourcePolicy
          || record.editorIds.length !== dependency.editorIds.length
          || !dependency.editorIds.every(editorId => record.editorIds.includes(editorId))
          || [...new Set(record.permissions)].sort().join('\u0000') !== [...new Set(dependency.permissions)].sort().join('\u0000')) {
          throw new Error(`离线制品元数据与依赖锁不一致：${dependency.portableId}`)
        }
        if (dependency.clientEntry !== undefined && record.clientEntry !== dependency.clientEntry) {
          throw new Error(`离线制品 client entry 与依赖锁不一致：${dependency.portableId}`)
        }
        if (dependency.hostEntry !== undefined && record.hostEntry !== dependency.hostEntry) {
          throw new Error(`离线制品 host entry 与依赖锁不一致：${dependency.portableId}`)
        }
        await options.artifactStore.stage({ record, files: payload })
        await options.artifactStore.commit(dependency.digest)
        stagedArtifacts.push(dependency.digest)
        stagedCount += 1
        reportProgress({ phase: 'staging-artifacts', current: stagedCount, total: embeddedDependencies.length, dependency: dependency.portableId, label: `已准备离线制品：${dependency.portableId}` })
        transaction?.update({ stagedDigests: stagedArtifacts, installedPackageIds: installedPlugins.map(plugin => plugin.packageId) }, transactionNow())
      }
    } catch (error) {
      cleanupArtifacts()
      const reason = error instanceof Error ? error.message : '离线制品安装失败。'
      failTransaction(reason)
      return { status: 'unavailable', reason }
    }
  }
  safeTransition('activating')
  const lockedDependencies = report.dependencyLock ?? []
  const deferredDynamicDependencies = options.deferDynamicActivation === true
    ? lockedDependencies.filter(dependency => dependency.kind === 'dynamic')
    : []
  const deferredDynamicEditorIds = new Set(deferredDynamicDependencies.flatMap(dependency => dependency.editorIds))
  const activatableDependencies = lockedDependencies.filter(dependency =>
    !deferredDynamicDependencies.some(candidate => candidate.portableId === dependency.portableId
      && candidate.version === dependency.version
      && candidate.digest.toUpperCase() === dependency.digest.toUpperCase()))
  const requiresDependencyActivation = report.manifest?.schemaVersion === 2
    && report.manifest.completeness !== 'layout-only' && activatableDependencies.length > 0
  if (requiresDependencyActivation && (options.dependencyInstaller === undefined || options.verifyInstalledEditors === undefined)) {
    const reason = options.dependencyInstaller === undefined
      ? '完整包需要 Runtime 依赖安装器才能激活制品。'
      : '完整包需要 editor provenance 校验器才能提交。'
    cleanupArtifacts()
    failTransaction(reason)
    return { status: 'unavailable', reason }
  }
  if (report.manifest?.schemaVersion === 2 && report.manifest.completeness !== 'layout-only'
    && (report.agentPresets?.length ?? 0) > 0 && options.verifyInstalledAgentPresets === undefined) {
    const reason = '完整包包含 Agent 模式依赖，但 Runtime 未提供 Agent Preset 来源校验器。'
    cleanupArtifacts()
    failTransaction(reason)
    return { status: 'unavailable', reason }
  }
  if (options.dependencyInstaller !== undefined) {
    try {
      const installableDependencies = activatableDependencies.filter(dependency =>
        dependency.artifactPath !== undefined
        || dependency.installSource === 'npm'
        || dependency.installSource === 'registry')
      let activationCount = 0
      reportProgress({ phase: 'activating-dependencies', current: 0, total: installableDependencies.length, label: '正在安装并激活依赖…' })
      for (const dependency of activatableDependencies) {
        const previousActivation = activatedDependencies.find(receipt =>
          receipt.portableId === dependency.portableId
          && receipt.version === dependency.version
          && receipt.digest.toUpperCase() === dependency.digest.toUpperCase())
        if (previousActivation !== undefined) {
          const previousIssue = activationReceiptIssue(dependency, previousActivation)
          if (previousIssue !== undefined) throw new Error(previousIssue)
          continue
        }
        if ((dependency.installSource === 'npm' || dependency.installSource === 'registry') && dependency.artifactPath === undefined) {
          if (options.packageInstaller === undefined) throw new Error(`依赖声明需要 Registry 安装，但 Runtime 未提供 DSH Profile 安装器：${dependency.portableId}`)
          if (options.environment.allowRemote !== true) throw new Error(`当前导入策略不允许访问 npm Registry：${dependency.portableId}`)
          const existingPackageReceipt = installedPackages.find(receipt =>
            receipt.portableId === dependency.portableId
            && receipt.packageName === dependency.packageName
            && receipt.version === dependency.version
            && receipt.digest.toUpperCase() === dependency.digest.toUpperCase()
            && (dependency.integrity === undefined || receipt.integrity === dependency.integrity))
          if (existingPackageReceipt === undefined) {
            reportProgress({ phase: 'installing-dependencies', current: activationCount, total: installableDependencies.length, dependency: dependency.portableId, label: `正在安装依赖：${dependency.portableId}` })
            const packageReceipt = await options.packageInstaller.install(dependency, {
              // Install scripts are never enabled by preflight. A Host adapter
              // may apply a separate, explicit high-risk approval policy later.
              allowScripts: false,
              network: true,
            })
            if (packageReceipt.portableId !== dependency.portableId
              || packageReceipt.packageName !== dependency.packageName
              || packageReceipt.version !== dependency.version
              || packageReceipt.digest.toUpperCase() !== dependency.digest.toUpperCase()
              || (dependency.integrity !== undefined && packageReceipt.integrity !== dependency.integrity)) {
              throw new Error(`npm 安装收据与依赖锁定信息不一致：${dependency.portableId}`)
            }
            installedPackages.push(packageReceipt)
          }
        }
        reportProgress({ phase: 'activating-dependencies', current: activationCount, total: installableDependencies.length, dependency: dependency.portableId, label: `正在激活依赖：${dependency.portableId}` })
        const receipt = await options.dependencyInstaller.activate(dependency, options.artifactStore?.get(dependency.digest))
        const receiptIssue = activationReceiptIssue(dependency, receipt)
        if (receiptIssue !== undefined) throw new Error(receiptIssue)
        activatedDependencies.push(receipt)
        activationCount += 1
        reportProgress({ phase: 'activating-dependencies', current: activationCount, total: installableDependencies.length, dependency: dependency.portableId, label: `已激活依赖：${dependency.portableId}` })
        transaction?.update({
          stagedDigests: stagedArtifacts,
          installedPackageIds: [...activatedDependencies.map(item => item.packageId), ...installedPlugins.map(plugin => plugin.packageId)],
          activatedDependencies,
          installedPackages,
        }, transactionNow())
        if (receipt.requiresRestart === true) {
          const restartTransactionId = transaction?.snapshot.transactionId ?? transactionId
          if (restartTransactionId === undefined) throw new Error('需要重启但没有可恢复的事务 ID。')
          transaction?.transition('waiting-restart', transactionNow())
          reportProgress({ phase: 'waiting-restart', current: activationCount, total: installableDependencies.length, dependency: dependency.portableId, label: '依赖需要重启 Runtime 后继续验证', requiresRestart: true })
          return {
            status: 'waiting-restart',
            transactionId: restartTransactionId,
            reason: '依赖已暂存并激活，但 Runtime 要求重启后继续验证。',
          }
        }
      }
    } catch (error) {
      await rollbackRuntime()
      cleanupArtifacts()
      const reason = error instanceof Error ? error.message : '依赖激活失败。'
      failTransaction(reason)
      return { status: 'unavailable', reason }
    }
  }
  // v2 dependency locks are activated through the Runtime-owned dependency
  // installer above. The legacy `plugins` array is retained only for v1/
  // compatibility packages; an otherwise complete v2 package commonly has
  // no legacy plugin entries at all and must not require a second installer.
  if (options.installPlugins === true && report.plugins.length > 0) {
    if (options.pluginInstaller === undefined) {
      const reason = '未提供插件安装器。'
      await rollbackRuntime()
      cleanupArtifacts()
      failTransaction(reason)
      return { status: 'unavailable', reason }
    }
    try {
      for (const plan of report.plugins) {
        await installWorkbenchPluginArtifact(plan.manifest, plan.files, options.pluginInstaller)
        installedPlugins.push(plan.manifest)
        transaction?.update({
          stagedDigests: stagedArtifacts,
          installedPackageIds: [...activatedDependencies.map(item => item.packageId), ...installedPlugins.map(plugin => plugin.packageId)],
        }, transactionNow())
      }
    } catch (error) {
      await rollbackRuntime()
      cleanupArtifacts()
      const reason = error instanceof Error ? error.message : '插件安装失败。'
      failTransaction(reason)
      return { status: 'unavailable', reason }
    }
  }
  safeTransition('verifying')
  reportProgress({ phase: 'verifying-editors', current: 0, total: 1, label: '正在验证内页来源和摘要…' })
  if (options.verifyInstalledEditors !== undefined && report.dependencyLock !== undefined) {
      const expectedEditors = requiredEditorsOfProjectionExcluding(report.projection, deferredDynamicEditorIds)
    let verification: { valid: boolean; reason?: string }
    try {
      verification = await options.verifyInstalledEditors(expectedEditors, activatableDependencies)
    } catch (error) {
      await rollbackRuntime()
      cleanupArtifacts()
      const reason = error instanceof Error ? error.message : '内页注册来源校验失败。'
      failTransaction(reason)
      return { status: 'unavailable', reason }
    }
    if (!verification.valid) {
      await rollbackRuntime()
      cleanupArtifacts()
      const reason = verification.reason ?? '内页注册来源校验失败。'
      failTransaction(reason)
      return { status: 'unavailable', reason }
    }
  }
  reportProgress({ phase: 'verifying-editors', current: 1, total: 1, label: '内页来源验证完成' })
  if (options.verifyInstalledAgentPresets !== undefined && report.agentPresets !== undefined && report.agentPresets.length > 0) {
    const requiredPresets: WorkbenchRequiredAgentPresetV1[] = []
    for (const dependency of report.agentPresets) {
      if (dependency.agentPresetId === undefined || dependency.digest === '') {
        await rollbackRuntime()
        cleanupArtifacts()
        const reason = `Agent 模式依赖缺少固定身份或摘要：${dependency.portableId}`
        failTransaction(reason)
        return { status: 'unavailable', reason }
      }
      requiredPresets.push({
        presetId: dependency.agentPresetId,
        portableId: dependency.portableId,
        version: dependency.version,
        digest: dependency.digest,
      })
    }
    let verification: { valid: boolean; reason?: string }
    try {
      verification = await options.verifyInstalledAgentPresets(requiredPresets)
    } catch (error) {
      await rollbackRuntime()
      cleanupArtifacts()
      const reason = error instanceof Error ? error.message : 'Agent 模式来源校验失败。'
      failTransaction(reason)
      return { status: 'unavailable', reason }
    }
    if (!verification.valid) {
      await rollbackRuntime()
      cleanupArtifacts()
      const reason = verification.reason ?? 'Agent 模式来源校验失败。'
      failTransaction(reason)
      return { status: 'unavailable', reason }
    }
  }
  safeTransition('restoring-state')
  reportProgress({ phase: 'restoring-state', current: 0, total: 1, label: '正在恢复布局和可迁移状态…' })
  let result: ReturnType<typeof prepareImportedWorkbenchSettings>
  try {
    const editorCatalog = typeof options.editorCatalog === 'function'
      ? options.editorCatalog()
      : options.editorCatalog
    const packageOrigin = packageOriginFromReport(report, options.archiveSha256)
    result = prepareImportedWorkbenchSettings(snapshot.value, report.projection, {
      ...(options.workbenchId === undefined ? {} : { workbenchId: options.workbenchId }),
      ...(options.name === undefined ? {} : { name: options.name }),
      ...(options.description === undefined ? {} : { description: options.description }),
      ...(options.now === undefined ? {} : { now: options.now }),
      prefix: options.prefix ?? 'imported-workbench',
      ...(editorCatalog === undefined ? {} : { editors: editorCatalog }),
      ...(report.sessions === undefined ? {} : { sessions: report.sessions }),
      ...(options.sessionTemplateBindings === undefined ? {} : { templateBindings: options.sessionTemplateBindings }),
      ...(packageOrigin === undefined ? {} : { packageOrigin }),
    })
  } catch (error) {
    await rollbackRuntime()
    cleanupArtifacts()
    const reason = error instanceof Error ? error.message : '布局和 Session 模板恢复失败。'
    failTransaction(reason)
    return {
      status: 'preflight-failed',
      report: {
        ...report,
        valid: false,
        issues: [...report.issues, { severity: 'error', code: 'projection-invalid', message: reason }],
      },
    }
  }
  const next = options.loadAfterImport
    ? { ...result.settings, activeWorkbenchId: result.workbenchId, openWorkbenchIds: [...result.settings.openWorkbenchIds, result.workbenchId] }
    : result.settings
  safeTransition('committing')
  reportProgress({ phase: 'committing', current: 0, total: 1, label: '正在保存为未使用工作台…' })
  const previousReceipt = options.packageRegistry === undefined || report.manifest === undefined
    ? undefined : options.packageRegistry.getReceipt(report.manifest.packageId, report.manifest.version)
  let patchResult: SettingsScopePatchResult
  try {
    patchResult = await scope.patch({
      operation: 'set', path: [], value: removeTransientMigration(next),
      ...(snapshot.revision === undefined ? {} : { expectedRevision: snapshot.revision }),
    })
  } catch (error) {
    await rollbackRuntime()
    cleanupArtifacts()
    const reason = error instanceof Error ? error.message : 'Settings 写入异常。'
    failTransaction(reason)
    return { status: 'unavailable', reason }
  }
  if (patchResult.status === 'conflict') {
    await rollbackRuntime()
    cleanupArtifacts()
    failTransaction('Settings revision 冲突。')
    return patchResult
  }
  if (patchResult.status !== 'committed') {
    await rollbackRuntime()
    cleanupArtifacts()
    const reason = 'Settings 写入不可用。'
    failTransaction(reason)
    return { status: 'unavailable', reason }
  }

  // Registry receipts are a proof of a committed Workbench, not a staging
  // side effect.  Write them only after the Settings CAS succeeds.  If the
  // durable registry rejects the receipt, attempt a compensating CAS while
  // retaining the original revision guard; this keeps a failed import from
  // leaving an untracked Workbench behind.
  if (options.packageRegistry !== undefined && report.manifest !== undefined && options.archiveSha256 !== undefined) {
    try {
      options.packageRegistry.recordReceipt({
        packageId: report.manifest.packageId,
        version: report.manifest.version,
        archiveSha256: options.archiveSha256,
        dependencies: (report.dependencyLock ?? []).map(dependency => ({
          portableId: dependency.portableId, version: dependency.version, digest: dependency.digest,
        })),
        installedAt: transactionNow(),
        source: options.receiptSource ?? 'local',
        signatureState: options.receiptSignatureState ?? 'unsigned',
        referencedWorkbenches: [...new Set([...(previousReceipt?.referencedWorkbenches ?? []), result.workbenchId])],
      })
    } catch (error) {
      try {
        await scope.patch({
          operation: 'set', path: [], value: removeTransientMigration(snapshot.value),
          ...(patchResult.revision === undefined ? {} : { expectedRevision: patchResult.revision }),
        })
      } catch {
        // The public result remains unavailable; the Runtime journal records
        // the failure so a host can reconcile the orphaned Settings row.
      }
      try {
        if (previousReceipt === undefined) options.packageRegistry.removeReceipt(report.manifest.packageId, report.manifest.version)
        else options.packageRegistry.recordReceipt(previousReceipt)
      } catch { /* registry recovery is best effort after a failed write */ }
      await rollbackRuntime()
      cleanupArtifacts()
      const reason = error instanceof Error ? error.message : 'Package Registry 收据写入失败。'
      failTransaction(reason)
      return { status: 'unavailable', reason }
    }
  }
  for (const digest of stagedArtifacts) options.artifactStore?.retain(digest, result.workbenchId)
  transaction?.update({
    stagedDigests: stagedArtifacts,
    installedPackageIds: [...activatedDependencies.map(item => item.packageId), ...installedPlugins.map(plugin => plugin.packageId)],
    activatedDependencies,
    installedPackages,
    workbenchId: result.workbenchId,
    committedRevision: patchResult.revision,
  }, transactionNow())
  safeTransition('ready')
  reportProgress({ phase: 'complete', current: 1, total: 1, label: '工作台导入完成' })
  return {
    status: 'committed', workbenchId: result.workbenchId, revision: patchResult.revision,
    ...(transaction?.snapshot.transactionId === undefined ? {} : { transactionId: transaction.snapshot.transactionId }),
  }
}

/** Convenience entry point for a downloaded archive; decoding remains bounded. */
export async function importWorkbenchPackageArchiveIntoSettings(
  scope: SettingsScope<WorkbenchSettingsV4>,
  archive: Uint8Array,
  options: WorkbenchPackageImportOptionsV1,
): Promise<WorkbenchPackageImportResultV1> {
  try {
    const decoded = await decodeWorkbenchPackageArchive(archive)
    const archiveSha256 = options.archiveSha256 ?? await sha256Hex(archive)
    const report = await preflightWorkbenchPackage(decoded.manifest, decoded.files, options.environment)
    if (report.valid && options.packageRegistry?.stageArchive !== undefined) {
      await options.packageRegistry.stageArchive(archive, {
        packageId: decoded.manifest.packageId,
        version: decoded.manifest.version,
        archiveSha256,
      })
    }
    return importWorkbenchPackageIntoSettings(scope, decoded, { ...options, archiveSha256 })
  } catch (error) {
    return {
      status: 'preflight-failed',
      report: {
        valid: false, plugins: [], permissions: [],
        issues: [{ severity: 'error', code: 'archive-invalid', message: error instanceof Error ? error.message : '包归档无效。' }],
      },
    }
  }
}
