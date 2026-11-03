import type {
  WorkbenchDependencyAvailabilityV1,
  WorkbenchDependencyPackageV1,
  WorkbenchDependencyScanReportV1,
} from './workbench-distribution.ts'
import type { WorkbenchRuntimeReadinessSnapshotV1 } from './workbench-distribution-runtime.ts'
import type { WorkbenchExportPreparationStateV1 } from './workbench-export-preparation-transaction.ts'

export type WorkbenchExportReadinessModeV1 = 'online-reference' | 'offline-embedded'
export type WorkbenchExportReadinessCompletenessV1 =
  | 'complete-offline' | 'complete-online' | 'needs-preparation' | 'needs-input' | 'blocked' | 'layout-only'
export type WorkbenchReadinessKindV1 = 'ui-editor' | 'agent-preset' | 'dynamic' | 'shared' | 'mcp' | 'skill-bundle'
export type WorkbenchReadinessRepairV1 =
  | 'embed-local' | 'install-registry' | 'configure-registry' | 'prepare-distribution' | 'bind-input' | 'none'

export interface WorkbenchReadinessItemV1 {
  readonly issueId: string
  readonly kind: WorkbenchReadinessKindV1
  readonly portableId: string
  readonly packageName?: string
  readonly version?: string
  readonly digest?: string
  readonly currentAvailability: WorkbenchDependencyAvailabilityV1 | 'unresolved'
  readonly repair: WorkbenchReadinessRepairV1
  readonly consequence: string
  readonly requiredPermissions: readonly string[]
}

export interface WorkbenchReadinessIssueV1 {
  readonly issueId: string
  readonly code: string
  readonly message: string
  readonly portableId?: string
  readonly repair: WorkbenchReadinessRepairV1
}

export interface WorkbenchExportReadinessInspectionV1 {
  readonly workbenchId: string
  readonly mode: WorkbenchExportReadinessModeV1
  readonly completeness: WorkbenchExportReadinessCompletenessV1
  readonly activeEditorCount: number
  readonly agentPresetCount: number
  readonly dynamicPackageCount: number
  readonly sharedDependencyCount: number
  readonly estimatedArtifactBytes?: number
  readonly ready: readonly WorkbenchReadinessItemV1[]
  readonly repairable: readonly WorkbenchReadinessItemV1[]
  readonly requiredInputs: readonly WorkbenchRuntimeReadinessSnapshotV1['requiredInputs'][number][]
  readonly blockers: readonly WorkbenchReadinessIssueV1[]
  readonly warnings: readonly { readonly code: string; readonly message: string }[]
}

export interface WorkbenchExportReadinessInspectionInputV1 {
  readonly scan: WorkbenchDependencyScanReportV1
  readonly mode: WorkbenchExportReadinessModeV1
  readonly runtimeReadiness?: WorkbenchRuntimeReadinessSnapshotV1
}

export interface WorkbenchExportPreparationInputV1 {
  readonly workbenchId: string
  readonly mode: WorkbenchExportReadinessModeV1
  readonly issueIds?: readonly string[]
}

export interface WorkbenchExportPreparationOptionsV1 {
  readonly approvedPermissions?: readonly string[]
  readonly networkApproved?: boolean
  readonly allowScripts?: false
}

export type WorkbenchExportPreparationResultV1 =
  | { readonly status: 'committed'; readonly transactionId: string; readonly inspection: WorkbenchExportReadinessInspectionV1 }
  | { readonly status: 'failed'; readonly transactionId?: string; readonly reason: string; readonly inspection?: WorkbenchExportReadinessInspectionV1 }

/** Runtime-owned action seam; Workbench supplies the inspection projection. */
export interface WorkbenchExportReadinessCoordinatorV1 {
  /** Optional async Runtime hook; the Workbench pure scan remains the fallback. */
  inspect?(input: {
    workbenchId: string
    mode: WorkbenchExportReadinessModeV1
  }): Promise<WorkbenchExportReadinessInspectionV1 | undefined>
  prepare(
    input: WorkbenchExportPreparationInputV1,
    options?: WorkbenchExportPreparationOptionsV1,
  ): Promise<WorkbenchExportPreparationResultV1>
  recheck?(workbenchId: string, mode?: WorkbenchExportReadinessModeV1): Promise<WorkbenchExportReadinessInspectionV1 | undefined>
  /** Recover metadata-only preparation journals after a DSH restart. */
  recoverPreparations?(): Promise<readonly { transactionId: string; state: WorkbenchExportPreparationStateV1 }[]>
  /** Mark the prepared bytes as consumed by an explicitly confirmed archive. */
  commitPreparation?(transactionId: string): Promise<void>
  cancelPreparation(transactionId: string): Promise<void>
}

function packageKind(
  pkg: WorkbenchDependencyPackageV1,
  scan: WorkbenchDependencyScanReportV1,
  issueCode?: string,
): WorkbenchReadinessKindV1 {
  if (issueCode === 'agent-preset-unprepared') return 'agent-preset'
  if (issueCode === 'dynamic-metadata-missing') return 'dynamic'
  if (scan.snapshot.dynamicPackages.some(candidate => candidate.portableId === pkg.portableId)) return 'dynamic'
  if (scan.snapshot.agentPresetPackages?.some(candidate => candidate.portableId === pkg.portableId)) return 'agent-preset'
  if (pkg.editorIds.length > 0) return 'ui-editor'
  return 'shared'
}

function packageMap(scan: WorkbenchDependencyScanReportV1): Map<string, WorkbenchDependencyPackageV1> {
  return new Map([
    ...scan.snapshot.staticPackages,
    ...scan.snapshot.dynamicPackages,
    ...(scan.snapshot.agentPresetPackages ?? []),
  ].map(pkg => [pkg.portableId, pkg]))
}

function repairFor(
  pkg: WorkbenchDependencyPackageV1 | undefined,
  mode: WorkbenchExportReadinessModeV1,
): WorkbenchReadinessRepairV1 {
  if (pkg === undefined || pkg.exportPolicy === 'forbid') return 'none'
  if (pkg.availability === 'embedded') {
    // Embedded only proves local availability. Online-reference mode needs a
    // recipient-resolvable npm/Registry source as well; never promote a
    // local artifact to an online dependency without that explicit address.
    if (mode === 'online-reference'
      && (pkg.packageName === undefined || pkg.registryUrl === undefined
        || (pkg.installSource !== 'npm' && pkg.installSource !== 'registry'))) {
      return 'configure-registry'
    }
    return 'none'
  }
  if (mode === 'offline-embedded') {
    // An installed/registry package can only become offline-ready after the
    // Runtime extracts and hash-verifies its bytes. The coordinator owns that
    // operation; the scanner never fabricates bytes in the browser.
    return 'embed-local'
  }
  if (pkg.availability === 'registry') return 'none'
  if (pkg.availability === 'installed') return pkg.registryUrl === undefined ? 'configure-registry' : 'none'
  if (pkg.registryUrl !== undefined) return 'install-registry'
  return 'prepare-distribution'
}

function consequenceFor(
  pkg: WorkbenchDependencyPackageV1 | undefined,
  repair: WorkbenchReadinessRepairV1,
  mode: WorkbenchExportReadinessModeV1,
): string {
  if (repair === 'embed-local') return '从当前 Runtime 提取并校验制品后，才能生成离线嵌入包。会增加本机磁盘占用，但不改变当前 Workbench。'
  if (repair === 'install-registry') return '接收端或当前 Profile 需要访问受信任 Registry；安装后仍需验证 editor/provenance digest。'
  if (repair === 'configure-registry') return '当前只有本机安装状态，无法证明可跨机器获取；需要配置受信任 Registry 或改用离线制品。'
  if (repair === 'prepare-distribution') return '当前制品没有可验证的分发来源，必须显式准备 immutable Package，不能从 editorId 或本地路径猜测。'
  if (pkg?.availability === 'forbidden') return '该依赖声明禁止分发，只能保留为布局包。'
  return mode === 'offline-embedded' ? '当前模式要求包内包含可验证制品。' : '当前依赖来源仍需 Runtime 重新证明。'
}

function itemFor(
  scan: WorkbenchDependencyScanReportV1,
  pkg: WorkbenchDependencyPackageV1 | undefined,
  portableId: string,
  mode: WorkbenchExportReadinessModeV1,
  issueId: string,
  issueCode?: string,
): WorkbenchReadinessItemV1 {
  const kind = pkg === undefined
    ? issueCode === 'agent-preset-unprepared' ? 'agent-preset' : issueCode === 'dynamic-metadata-missing' ? 'dynamic' : 'shared'
    : packageKind(pkg, scan, issueCode)
  const repair = repairFor(pkg, mode)
  const lock = scan.snapshot.dependencies.find(candidate => candidate.portableId === portableId)
  return {
    issueId, kind, portableId,
    ...(pkg?.packageName === undefined ? {} : { packageName: pkg.packageName }),
    ...(pkg?.version === undefined ? {} : { version: pkg.version }),
    ...(pkg?.artifactDigest === undefined ? lock?.digest ? { digest: lock.digest } : {} : { digest: pkg.artifactDigest }),
    currentAvailability: pkg?.availability ?? 'unresolved',
    repair,
    consequence: consequenceFor(pkg, repair, mode),
    requiredPermissions: [...new Set(pkg?.permissions ?? lock?.permissions ?? [])].sort(),
  }
}

function repairForIssue(code: string, pkg: WorkbenchDependencyPackageV1 | undefined, mode: WorkbenchExportReadinessModeV1): WorkbenchReadinessRepairV1 {
  if (code === 'export-forbidden' || code.includes('conflict') || code === 'provider-unresolved') return 'none'
  if (code === 'agent-preset-unprepared' || code === 'dynamic-metadata-missing') return 'prepare-distribution'
  return repairFor(pkg, mode)
}

/**
 * Convert the scanner's precise blockers into the user-facing export wizard
 * vocabulary. This is a pure Workbench projection: it neither installs npm,
 * reads files nor changes DSH state. Runtime/Manager owns the later repair
 * coordinator and can consume the stable issue IDs produced here.
 */
export function inspectWorkbenchExportReadiness(
  input: WorkbenchExportReadinessInspectionInputV1,
): WorkbenchExportReadinessInspectionV1 {
  const { scan, mode } = input
  const packages = packageMap(scan)
  const issueById = new Map<string, WorkbenchReadinessItemV1>()
  const blockers: WorkbenchReadinessIssueV1[] = []
  for (const issue of scan.snapshot.blockers) {
    const portableId = issue.portableId
    const pkg = portableId === undefined ? undefined : packages.get(portableId)
    const repair = repairForIssue(issue.code, pkg, mode)
    const issueId = `${issue.code}:${portableId ?? issue.editorId ?? 'workbench'}`
    if (portableId !== undefined) issueById.set(issueId, itemFor(scan, pkg, portableId, mode, issueId, issue.code))
    blockers.push({ issueId, code: issue.code, message: issue.message, ...(portableId === undefined ? {} : { portableId }), repair })
  }
  const runtimeReadiness = input.runtimeReadiness
  for (const issue of runtimeReadiness?.blockers ?? []) {
    const issueId = `runtime:${issue.code}:${issue.dependencyId ?? 'workbench'}`
    blockers.push({ issueId, code: issue.code, message: issue.message, ...(issue.dependencyId === undefined ? {} : { portableId: issue.dependencyId }), repair: 'none' })
  }
  if (runtimeReadiness?.status === 'blocked' && runtimeReadiness.blockers.length === 0) {
    blockers.push({ issueId: 'runtime:blocked', code: 'runtime-blocked', message: 'DSH Runtime 报告依赖阻塞，但没有提供可展开的诊断。', repair: 'none' })
  }
  // A mode mismatch is a repairable issue even when the underlying scanner is
  // complete-online (for example, the user explicitly selected offline).
  for (const pkg of packages.values()) {
    const repair = repairFor(pkg, mode)
    const needsModeRepair = mode === 'offline-embedded' && pkg.availability !== 'embedded' && pkg.exportPolicy === 'embed'
    if (needsModeRepair) {
      const issueId = `availability:${pkg.portableId}`
      if (!issueById.has(issueId)) issueById.set(issueId, itemFor(scan, pkg, pkg.portableId, mode, issueId))
    }
    if (repair !== 'none' && (pkg.availability === 'missing' || pkg.availability === 'installed'
      || pkg.availability === 'embedded' || needsModeRepair)) {
      const issueId = `availability:${pkg.portableId}`
      if (!blockers.some(issue => issue.issueId === issueId)) {
        blockers.push({ issueId, code: 'dependency-not-ready', message: `依赖尚未满足${mode === 'offline-embedded' ? '离线' : '在线'}分发要求：${pkg.portableId}`, portableId: pkg.portableId, repair })
      }
    }
    const readyIssueId = `dependency:${pkg.portableId}`
    if (!issueById.has(readyIssueId)) {
      issueById.set(readyIssueId, itemFor(scan, pkg, pkg.portableId, mode, readyIssueId))
    }
  }
  const uniqueItems = new Map<string, WorkbenchReadinessItemV1>()
  for (const item of issueById.values()) {
    const previous = uniqueItems.get(item.portableId)
    // Preserve an actionable blocker over a generic package row. This keeps
    // `dynamic-metadata-missing` visible even though the same package itself
    // is otherwise embedded.
    if (previous === undefined || previous.repair === 'none' && item.repair !== 'none') uniqueItems.set(item.portableId, item)
  }
  const allItems = [...uniqueItems.values()].sort((left, right) => left.portableId.localeCompare(right.portableId, 'en'))
  const repairable = allItems.filter(item => item.repair !== 'none')
  const requiredInputs = [...(input.runtimeReadiness?.requiredInputs ?? [])]
  const invalidInputs = requiredInputs.filter(item => item.status === 'invalid')
  for (const input of invalidInputs) {
    blockers.push({ issueId: `input:${input.id}`, code: 'external-input-invalid', message: `接收端输入无效：${input.label}`, repair: 'none' })
  }
  const unresolvedInputs = requiredInputs.filter(item => item.status === 'unbound')
  const hardBlockers = blockers.filter(issue => issue.repair === 'none')
  const hasDependencyBlocker = hardBlockers.length > 0 || scan.snapshot.editors.some(editor => editor.status !== 'available')
  // A scanner may report the underlying graph as complete for one mode while
  // this wizard is evaluating the other mode.  Actionable rows must win over
  // that base completeness; otherwise an embedded local artifact was
  // incorrectly promoted to `complete-online` without a Registry source.
  const allOffline = scan.snapshot.completeness === 'complete-offline'
    && mode === 'offline-embedded' && repairable.length === 0
  const allOnline = (scan.snapshot.completeness === 'complete-offline' || scan.snapshot.completeness === 'complete-online')
    && mode === 'online-reference' && repairable.length === 0
  let completeness: WorkbenchExportReadinessCompletenessV1
  if (hasDependencyBlocker) completeness = 'blocked'
  else if (!allOffline && !allOnline && repairable.length > 0) completeness = 'needs-preparation'
  else if (unresolvedInputs.length > 0) completeness = 'needs-input'
  else if (allOffline) completeness = 'complete-offline'
  else if (allOnline) completeness = 'complete-online'
  else completeness = 'layout-only'
  return {
    workbenchId: scan.snapshot.workbenchId,
    mode, completeness,
    activeEditorCount: scan.activeEditors.length,
    agentPresetCount: scan.snapshot.agentPresets?.length ?? 0,
    dynamicPackageCount: scan.snapshot.dynamicPackages.length,
    sharedDependencyCount: scan.snapshot.staticPackages.filter(pkg => pkg.editorIds.length === 0).length,
    ready: allItems.filter(item => item.repair === 'none' && item.currentAvailability !== 'missing' && item.currentAvailability !== 'unresolved'),
    repairable, requiredInputs: unresolvedInputs,
    blockers,
    warnings: [
      ...scan.snapshot.warnings,
      ...(runtimeReadiness?.warnings ?? []),
    ],
  }
}
