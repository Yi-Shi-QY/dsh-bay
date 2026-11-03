import type { WorkbenchArtifactStoreV1 } from './workbench-artifact-store.ts'
import type {
  WorkbenchAgentPresetDependencyInputV1,
  WorkbenchAgentPresetDistributionDescriptorV1,
  WorkbenchDependencyArtifactInfoV1,
  WorkbenchDependencyLockEntryV1,
  WorkbenchDistributionDescriptorV1,
} from './workbench-distribution.ts'
import type {
  WorkbenchDependencyInstallerV1,
  WorkbenchPackageInstallerV1,
  WorkbenchPackagePreflightEnvironmentV1,
  WorkbenchRequiredAgentPresetV1,
  WorkbenchDependencyActivationReceiptV1,
} from './workbench-package-import.ts'
import type { WorkbenchImportTransactionStoreV1 } from './workbench-import-transaction.ts'
import type { WorkbenchExportPreparationTransactionStoreV1 } from './workbench-export-preparation-transaction.ts'
import type { WorkbenchRegistryV1 } from './workbench-package-registry.ts'

export type WorkbenchRuntimeReadinessStatusV1 = 'ready' | 'needs-input' | 'blocked' | 'unknown'

/** Runtime truth used by Workbench, Creator and future package registries. */
export interface WorkbenchRuntimeReadinessSnapshotV1 {
  readonly status: WorkbenchRuntimeReadinessStatusV1
  readonly runtime: {
    readonly runtimeId: string
    readonly version: string
    readonly capabilities: readonly string[]
  }
  readonly dependencies: readonly {
    readonly kind: 'ui-editor' | 'agent-preset' | 'mcp' | 'skill-bundle' | 'shared'
    readonly portableId: string
    readonly version: string
    readonly digest: string
    /** Optional capabilities may be unavailable without blocking activation. */
    readonly required?: boolean
    readonly status: 'ready' | 'missing' | 'conflict' | 'unresolved'
  }[]
  readonly requiredInputs: readonly {
    readonly id: string
    readonly kind: 'model' | 'credential' | 'workspace' | 'session' | 'mcp' | 'filesystem'
    readonly label: string
    readonly required: boolean
    readonly status: 'satisfied' | 'unbound' | 'invalid'
  }[]
  readonly blockers: readonly { readonly code: string; readonly message: string; readonly dependencyId?: string }[]
  readonly warnings: readonly { readonly code: string; readonly message: string }[]
}

/** Unclassified Runtime facts used by the Host/Manager attestation builder. */
export interface WorkbenchRuntimeReadinessFactsV1 {
  readonly runtime: WorkbenchRuntimeReadinessSnapshotV1['runtime']
  readonly dependencies: WorkbenchRuntimeReadinessSnapshotV1['dependencies']
  readonly requiredInputs: WorkbenchRuntimeReadinessSnapshotV1['requiredInputs']
  readonly blockers?: WorkbenchRuntimeReadinessSnapshotV1['blockers']
  readonly warnings?: WorkbenchRuntimeReadinessSnapshotV1['warnings']
}

/**
 * Derive the only truthful status from Runtime facts. MCP discovery failures,
 * missing skills and editor/provider conflicts belong in `blockers`; model,
 * credential, workspace and Session bindings belong in `requiredInputs`.
 * A process that merely started, or an npm package that merely exists on disk,
 * cannot produce `ready` without passing through this projection.
 */
export function deriveWorkbenchRuntimeReadinessSnapshotV1(
  facts: WorkbenchRuntimeReadinessFactsV1,
): WorkbenchRuntimeReadinessSnapshotV1 {
  const blockers = [...(facts.blockers ?? [])]
  const warnings = [...(facts.warnings ?? [])]
  const dependencies = facts.dependencies.map(dependency => ({ ...dependency }))
  const requiredInputs = facts.requiredInputs.map(input => ({ ...input }))
  const dependencyFailure = dependencies.some(dependency => dependency.required !== false && dependency.status !== 'ready')
  const invalidRequiredInput = requiredInputs.some(input => input.required && input.status === 'invalid')
  const unboundRequiredInput = requiredInputs.some(input => input.required && input.status === 'unbound')
  const status: WorkbenchRuntimeReadinessStatusV1 = blockers.length > 0 || dependencyFailure || invalidRequiredInput
    ? 'blocked'
    : unboundRequiredInput ? 'needs-input' : 'ready'
  return {
    status,
    runtime: { ...facts.runtime, capabilities: [...facts.runtime.capabilities] },
    dependencies,
    requiredInputs,
    blockers,
    warnings,
  }
}

/**
 * Validate the Runtime attestation before Settings consumes it.
 *
 * Readiness is a privileged fact supplied by Host/Manager, but it still
 * crosses a dynamic Cordis boundary.  A malformed or forged object must be
 * treated as `unknown` by callers; otherwise a missing dependency can be
 * rendered as ready and the user may switch into a half-activated Workbench.
 */
export function validateWorkbenchRuntimeReadinessSnapshotV1(
  value: unknown,
): value is WorkbenchRuntimeReadinessSnapshotV1 {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const row = value as Record<string, unknown>
  if (row.status !== 'ready' && row.status !== 'needs-input' && row.status !== 'blocked' && row.status !== 'unknown') return false
  const runtime = row.runtime
  if (typeof runtime !== 'object' || runtime === null || Array.isArray(runtime)) return false
  const runtimeRow = runtime as Record<string, unknown>
  if (typeof runtimeRow.runtimeId !== 'string' || runtimeRow.runtimeId.trim() === ''
    || typeof runtimeRow.version !== 'string' || runtimeRow.version.trim() === ''
    || !Array.isArray(runtimeRow.capabilities) || !runtimeRow.capabilities.every(item => typeof item === 'string')) return false
  if (!Array.isArray(row.dependencies) || !row.dependencies.every(item => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) return false
    const dependency = item as Record<string, unknown>
    return (dependency.kind === 'ui-editor' || dependency.kind === 'agent-preset'
      || dependency.kind === 'mcp' || dependency.kind === 'skill-bundle' || dependency.kind === 'shared')
      && typeof dependency.portableId === 'string' && dependency.portableId.trim() !== ''
      && typeof dependency.version === 'string' && dependency.version.trim() !== ''
      && typeof dependency.digest === 'string' && /^[a-f0-9]{64}$/iu.test(dependency.digest)
      && (dependency.required === undefined || typeof dependency.required === 'boolean')
      && (dependency.status === 'ready' || dependency.status === 'missing'
        || dependency.status === 'conflict' || dependency.status === 'unresolved')
  })) return false
  if (!Array.isArray(row.requiredInputs) || !row.requiredInputs.every(item => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) return false
    const input = item as Record<string, unknown>
    return typeof input.id === 'string' && /^[A-Za-z0-9._:-]{1,96}$/u.test(input.id)
      && (input.kind === 'model' || input.kind === 'credential' || input.kind === 'workspace'
        || input.kind === 'session' || input.kind === 'mcp' || input.kind === 'filesystem')
      && typeof input.label === 'string' && input.label.trim() !== ''
      && typeof input.required === 'boolean'
      && (input.status === 'satisfied' || input.status === 'unbound' || input.status === 'invalid')
  })) return false
  const validMessages = (items: unknown): boolean => Array.isArray(items) && items.every(item => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) return false
    const message = item as Record<string, unknown>
    return typeof message.code === 'string' && message.code.trim() !== ''
      && typeof message.message === 'string' && message.message.trim() !== ''
      && (message.dependencyId === undefined || typeof message.dependencyId === 'string')
  })
  if (!validMessages(row.blockers) || !validMessages(row.warnings)) return false

  // A readiness attestation is consumed by the activation gate. Accepting an
  // internally contradictory report here would let a Runtime claim `ready`
  // while a locked dependency is missing or a required external input is
  // still unbound. Such a report is malformed and must fail closed.  Keep the
  // state machine explicit: dependency failures are blockers, while an
  // otherwise healthy dependency graph with unsatisfied typed inputs is
  // `needs-input`.  A `needs-input` report must never hide a missing/conflict
  // dependency behind a friendly binding prompt.
  const dependencies = row.dependencies as readonly { required?: boolean; status: string }[]
  const requiredInputs = row.requiredInputs as readonly { required: boolean; status: string }[]
  const blockers = row.blockers as readonly unknown[]
  const hasDependencyFailure = dependencies.some(dependency => dependency.required !== false && dependency.status !== 'ready')
  const hasRequiredInputFailure = requiredInputs.some(input => input.required && input.status !== 'satisfied')
  if (row.status === 'ready' && (hasDependencyFailure || hasRequiredInputFailure || blockers.length > 0)) return false
  if (row.status === 'needs-input' && (!hasRequiredInputFailure || hasDependencyFailure || blockers.length > 0)) return false
  if (row.status === 'blocked' && blockers.length === 0 && !hasDependencyFailure
    && !requiredInputs.some(input => input.required && input.status === 'invalid')) return false
  return true
}

/**
 * Runtime-owned distribution authority consumed by Workbench.
 *
 * Editor plugins never register this object through a Slot descriptor. The
 * Host/Manager composition provides it as the `workbenchDistributionRuntime`
 * Cordis service. Workbench resolves the service at operation time so a
 * Manager adapter that arrives after the UI can still be used without
 * remounting the Frame.
 */
export interface WorkbenchDistributionRuntimeV1 {
  readonly version: 1
  readonly authority: 'host' | 'manager' | 'test'
  readonly label: string
  /** Stable Runtime identity used only for readiness diagnostics. */
  readonly identity?: {
    readonly runtimeId: string
    readonly version: string
  }
  readonly capabilities: {
    readonly durableArtifacts: boolean
    readonly durableRegistry: boolean
    readonly durableTransactions: boolean
    readonly staticActivation: boolean
    readonly dynamicActivation: boolean
    readonly restartResume: boolean
  }
  /** Optional attested Runtime readiness; absence is never treated as ready. */
  readonly readiness?: () => WorkbenchRuntimeReadinessSnapshotV1
  /** Runtime-owned raw facts; projected here instead of being assembled by UI. */
  readonly readinessFacts?: () => WorkbenchRuntimeReadinessFactsV1
  readonly artifactStore?: WorkbenchArtifactStoreV1
  readonly packageRegistry?: WorkbenchRegistryV1
  readonly transactionStore?: WorkbenchImportTransactionStoreV1
  /** Separate metadata journal for cancelable export preparation. */
  readonly exportPreparationStore?: WorkbenchExportPreparationTransactionStoreV1
  readonly dependencyInstaller?: WorkbenchDependencyInstallerV1
  /**
   * Persist a recipient-local Dynamic binding in DSH/Manager.  Workbench only
   * supplies the user-selected Session handle; the Runtime owns its storage,
   * validation and later resolution by the Dynamic Runner.
   */
  readonly bindDynamicDependency?: (input: {
    workbenchId: string
    dependency: WorkbenchDependencyLockEntryV1
    recipientSessionId: string
  }) => Promise<void> | void
  /**
   * Preferred high-level seam for deferred Dynamic activation. DSH/Manager can
   * keep binding and activation receipts scoped by Workbench while reusing its
   * existing Dynamic Runner. The browser fallback uses dependencyInstaller
   * only for older/test hosts that already provide equivalent scoping.
   */
  readonly deferredDynamicActivator?: {
    activate(input: {
      workbenchId: string
      dependencies: readonly WorkbenchDependencyLockEntryV1[]
      recipientSessions: Readonly<Record<string, string>>
    }): Promise<{ receipts: readonly WorkbenchDependencyActivationReceiptV1[] }>
    rollback(input: {
      workbenchId: string
      receipts: readonly WorkbenchDependencyActivationReceiptV1[]
    }): Promise<void>
  }
  /** DSH Profile adapter; normally delegates to the existing pnpm command. */
  readonly packageInstaller?: WorkbenchPackageInstallerV1
  /** Request a Manager-owned Runtime restart after a durable checkpoint. */
  readonly requestRestart?: (transactionId: string) => Promise<void> | void
  /** Runtime Agent Preset registry verification performed before Settings CAS. */
  readonly verifyInstalledAgentPresets?: (
    presets: readonly WorkbenchRequiredAgentPresetV1[],
  ) => Promise<{ valid: boolean; reason?: string }>
  /** Runtime-owned declarations that do not come from an active editor row. */
  distributions?(): readonly WorkbenchDistributionDescriptorV1[]
  /** Prepared Agent preset compositions available to the Runtime. */
  agentPresetDistributions?(): readonly WorkbenchAgentPresetDistributionDescriptorV1[]
  /**
   * Runtime-authoritative Agent selections for the current Workbench's
   * Session templates.  This is deliberately separate from the descriptor
   * catalogue: a package may be installed while no active Session uses it.
   */
  agentPresetDependencies?(): readonly WorkbenchAgentPresetDependencyInputV1[]
  /** Installed, embedded, or registry-addressable artifacts known to Runtime. */
  artifacts?(): readonly WorkbenchDependencyArtifactInfoV1[]
  /** Capabilities supplied by the immutable base Runtime and excluded from locks. */
  runtimeProvided?(): readonly string[]
  /** Runtime can narrow preflight policy (for example whether network is allowed). */
  environment?(): Partial<WorkbenchPackagePreflightEnvironmentV1>
}

/**
 * Explicit DSH Host/Manager composition seam. The UI package should not
 * hand-build a Runtime authority at every integration site. DSH owns the
 * concrete stores, loaders and Dynamic Runner; this factory keeps the
 * identity/capability projection in one place and never manufactures a
 * missing capability.
 */
export interface WorkbenchDshRuntimeAdapterOptionsV1 extends Omit<WorkbenchDistributionRuntimeV1, 'version' | 'authority' | 'label' | 'identity'> {
  authority: WorkbenchDistributionRuntimeV1['authority']
  label: string
  runtimeId: string
  runtimeVersion: string
}

export function createWorkbenchDshRuntimeAdapter(
  options: WorkbenchDshRuntimeAdapterOptionsV1,
): WorkbenchDistributionRuntimeV1 {
  if (options.label.trim() === '' || options.runtimeId.trim() === '' || options.runtimeVersion.trim() === '') {
    throw new Error('Workbench DSH Runtime identity is required')
  }
  return Object.freeze({
    ...options,
    version: 1 as const,
    identity: Object.freeze({ runtimeId: options.runtimeId, version: options.runtimeVersion }),
  })
}

export interface WorkbenchDistributionRuntimeStatusV1 {
  readonly available: boolean
  readonly authority: WorkbenchDistributionRuntimeV1['authority'] | 'browser'
  readonly label: string
  readonly capabilities: WorkbenchDistributionRuntimeV1['capabilities']
  readonly blockers: readonly string[]
}

export type WorkbenchDistributionRuntimeResolverV1 = () => WorkbenchDistributionRuntimeV1 | undefined

const EMPTY_CAPABILITIES: WorkbenchDistributionRuntimeV1['capabilities'] = Object.freeze({
  durableArtifacts: false,
  durableRegistry: false,
  durableTransactions: false,
  staticActivation: false,
  dynamicActivation: false,
  restartResume: false,
})

function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean'
}

/** Reject malformed services before package bytes reach a privileged adapter. */
export function validateWorkbenchDistributionRuntimeV1(
  value: unknown,
): value is WorkbenchDistributionRuntimeV1 {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const row = value as Record<string, unknown>
  if (row.version !== 1 || (row.authority !== 'host' && row.authority !== 'manager' && row.authority !== 'test')) return false
  if (typeof row.label !== 'string' || row.label.trim() === '') return false
  if (row.identity !== undefined) {
    if (typeof row.identity !== 'object' || row.identity === null || Array.isArray(row.identity)) return false
    const identity = row.identity as Record<string, unknown>
    if (typeof identity.runtimeId !== 'string' || identity.runtimeId.trim() === ''
      || typeof identity.version !== 'string' || identity.version.trim() === '') return false
  }
  if (typeof row.capabilities !== 'object' || row.capabilities === null || Array.isArray(row.capabilities)) return false
  const capabilities = row.capabilities as Record<string, unknown>
  return [
    'durableArtifacts', 'durableRegistry', 'durableTransactions',
    'staticActivation', 'dynamicActivation', 'restartResume',
  ].every(key => isBoolean(capabilities[key]))
    && (row.readiness === undefined || typeof row.readiness === 'function')
    && (row.readinessFacts === undefined || typeof row.readinessFacts === 'function')
    && (row.distributions === undefined || typeof row.distributions === 'function')
    && (row.agentPresetDistributions === undefined || typeof row.agentPresetDistributions === 'function')
    && (row.agentPresetDependencies === undefined || typeof row.agentPresetDependencies === 'function')
    && (row.verifyInstalledAgentPresets === undefined || typeof row.verifyInstalledAgentPresets === 'function')
    && (row.packageInstaller === undefined || (typeof row.packageInstaller === 'object' && row.packageInstaller !== null
      && typeof (row.packageInstaller as Record<string, unknown>).install === 'function'
      && typeof (row.packageInstaller as Record<string, unknown>).rollback === 'function'))
    && (row.requestRestart === undefined || typeof row.requestRestart === 'function')
    && (row.bindDynamicDependency === undefined || typeof row.bindDynamicDependency === 'function')
    && (row.deferredDynamicActivator === undefined || (typeof row.deferredDynamicActivator === 'object'
      && row.deferredDynamicActivator !== null
      && typeof (row.deferredDynamicActivator as Record<string, unknown>).activate === 'function'
      && typeof (row.deferredDynamicActivator as Record<string, unknown>).rollback === 'function'))
    && (row.artifacts === undefined || typeof row.artifacts === 'function')
    && (row.runtimeProvided === undefined || typeof row.runtimeProvided === 'function')
    && (row.environment === undefined || typeof row.environment === 'function')
}

/** Human-readable capability projection used by Settings and diagnostics. */
export function workbenchDistributionRuntimeStatus(
  runtime: WorkbenchDistributionRuntimeV1 | undefined,
): WorkbenchDistributionRuntimeStatusV1 {
  if (runtime === undefined) {
    return {
      available: false,
      authority: 'browser',
      label: '浏览器布局模式',
      capabilities: EMPTY_CAPABILITIES,
      blockers: ['当前 Runtime 未提供受信任的依赖安装与持久化服务，只能安全处理 layout-only 包。'],
    }
  }
  const blockers: string[] = []
  if (!runtime.capabilities.durableArtifacts || runtime.artifactStore === undefined) blockers.push('缺少持久 Artifact Store')
  if (!runtime.capabilities.durableRegistry || runtime.packageRegistry === undefined) blockers.push('缺少持久 Package Registry')
  if (!runtime.capabilities.durableTransactions || runtime.transactionStore === undefined) blockers.push('缺少持久导入事务')
  if ((!runtime.capabilities.staticActivation && !runtime.capabilities.dynamicActivation)
    || runtime.dependencyInstaller === undefined) blockers.push('缺少依赖激活器')
  if (!runtime.capabilities.restartResume) blockers.push('不支持重启后续接事务')
  return {
    available: blockers.length === 0,
    authority: runtime.authority,
    label: runtime.label,
    capabilities: runtime.capabilities,
    blockers,
  }
}
