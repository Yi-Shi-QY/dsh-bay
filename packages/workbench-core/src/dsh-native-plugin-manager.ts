import type {
  WorkbenchModuleInstallAdapterV1,
  WorkbenchModuleVerificationInputV1,
} from './install-coordinator.ts'
import type { WorkbenchModuleIdentityV1 } from './module-catalog.ts'
import { resolve, sep } from 'node:path'

/**
 * The small structural face of DSH 0.1.6's native PluginManager.
 *
 * Every Profile mutation goes through the native manager. Runtime registration
 * still waits for Workbench verification after a fresh process starts.
 */
export interface DshNativePluginManagerV1 {
  listPlugins(): Promise<readonly DshNativePluginInfoV1[]>
  listBundles(): Promise<readonly DshNativeBundleInfoV1[]>
  inspect(spec: string, signal?: AbortSignal): Promise<DshNativePluginSpecInspectionV1>
  installBundle(spec: string, options?: DshNativeInstallBundleOptionsV1): Promise<DshNativeChangeResultV1>
  cancelInstall(requestId: string): Promise<DshNativeInstallCancellationV1>
  setPluginEnabled(entryId: string, enabled: boolean): Promise<DshNativeChangeResultV1>
  setBundleEnabled(packageName: string, enabled: boolean): Promise<DshNativeChangeResultV1>
  removeBundle(packageName: string): Promise<DshNativeChangeResultV1>
}

export interface DshNativePluginInfoV1 {
  readonly entryId: string
  readonly moduleName: string
  readonly enabled: boolean
  readonly fiberPhase?: string
  readonly patchId?: string
  readonly readOnlyReason?: string
}

export interface DshNativeBundleInfoV1 {
  readonly name: string
  readonly version?: string
  readonly installed: boolean
  readonly enabled: boolean
  readonly removable?: boolean
  readonly readOnlyReason?: string
}

export type DshNativePluginSpecInspectionV1 =
  | { readonly status: 'accepted'; readonly kind: string; readonly bundle: boolean | null; readonly name?: string; readonly version?: string }
  | { readonly status: 'refused'; readonly problem: string; readonly reason: string }

export interface DshNativeInstallBundleOptionsV1 {
  readonly enabled?: boolean
  readonly requestId?: string
  readonly approvedBuilds?: readonly string[]
}

export interface DshNativeChangeResultV1 {
  readonly changed: boolean
  readonly application: 'applied' | 'restart-required' | 'overridden' | 'failed' | 'cancelled' | string
  readonly error?: { readonly code?: string; readonly diagnostic?: string }
}

export interface DshNativeInstallCancellationV1 {
  readonly status: 'cancelled' | 'too-late' | 'not-running' | string
}

export interface DshNativePluginManagerInventoryV1 {
  readonly bundles: readonly DshNativeBundleInfoV1[]
  readonly plugins: readonly DshNativePluginInfoV1[]
  readonly refreshedAt: string
}

export interface WorkbenchDshNativePluginManagerAdapterV1 extends WorkbenchModuleInstallAdapterV1 {
  /** Re-read the native manager projection before a Workbench operation. */
  refresh(): Promise<DshNativePluginManagerInventoryV1>
  /** Last sanitized projection; no package.json or profile paths cross it. */
  inventory(): DshNativePluginManagerInventoryV1
}

export interface WorkbenchDshNativePluginManagerAdapterOptionsV1 {
  readonly profile: string
  readonly packageName: string
  readonly moduleId: string
  readonly native: DshNativePluginManagerV1
  readonly capabilities: () => readonly string[]
  readonly artifactPath: (identity: WorkbenchModuleIdentityV1) => string
  /** A fresh local spec with identical bytes avoids alpha2's same-spec ambiguous-install refusal. */
  readonly repairArtifactPath?: (identity: WorkbenchModuleIdentityV1) => string
  readonly isArtifactAvailable: (identity: WorkbenchModuleIdentityV1) => boolean
  /** Check exact archive bytes and its Module manifest before native installation. */
  readonly inspectArtifact: (identity: WorkbenchModuleIdentityV1) => Promise<void>
  readonly verify: (input: WorkbenchModuleVerificationInputV1) => Promise<void>
  /** Exact Workbench receipt identity, when this module is already owned. */
  readonly ownedIdentity?: (moduleId: string) => { version: string; artifactDigest: string } | undefined
  readonly onBeforeMutation?: (moduleId: string) => void
  readonly ownership: {
    has(moduleId: string): boolean
    add(moduleId: string): void
    remove(moduleId: string): void
  }
}

const emptyInventory = (): DshNativePluginManagerInventoryV1 => ({ bundles: [], plugins: [], refreshedAt: new Date(0).toISOString() })

function resultError(result: DshNativeChangeResultV1, operation: string): Error | undefined {
  if (result.application === 'applied' || result.application === 'restart-required') return undefined
  // A cancellation or an overridden row is not an installed/active module.
  return new Error(`dsh-native-${operation}-${result.application === 'cancelled' ? 'cancelled' : 'failed'}`)
}

/**
 * Adapt DSH's native package manager to Workbench's transaction engine.
 *
 * `install` and `rollback` are the only methods that mutate the Profile. A
 * claim only records Workbench ownership and never calls installBundle. Repair
 * reuses the native manager's exact tarball install path, which lets DSH own
 * lockfile recovery and bundle selection. The Workbench verifier remains the
 * final authority for module identity and provenance.
 */
export function createWorkbenchDshNativePluginManagerAdapterV1(
  options: WorkbenchDshNativePluginManagerAdapterOptionsV1,
): WorkbenchDshNativePluginManagerAdapterV1 {
  let current = emptyInventory()
  const identityFor = (moduleId: string): { version: string; artifactDigest: string } | undefined => {
    if (moduleId !== options.moduleId) return undefined
    if (!options.ownership.has(moduleId)) return undefined
    const bundle = current.bundles.find(row => row.name === options.packageName && row.installed)
    if (bundle === undefined || bundle.version === undefined) return undefined
    // The native manager exposes the package version, while the exact digest
    // is a Workbench receipt fact. Prefer that receipt so coordinator identity
    // checks remain exact across restarts.
    const owned = options.ownedIdentity?.(moduleId)
    return owned === undefined || owned.version !== bundle.version ? undefined : owned
  }
  const nativePackage = (identity: WorkbenchModuleIdentityV1, repair = false): string => {
    const path = resolve(repair && options.repairArtifactPath ? options.repairArtifactPath(identity) : options.artifactPath(identity))
    const profile = resolve(options.profile)
    if (path !== profile && !path.startsWith(`${profile}${sep}`)) throw new Error('dsh-native-artifact-path-invalid')
    if (!options.isArtifactAvailable(identity)) throw new Error('dsh-native-artifact-unavailable')
    return path
  }
  const refresh = async (): Promise<DshNativePluginManagerInventoryV1> => {
    const [bundles, plugins] = await Promise.all([options.native.listBundles(), options.native.listPlugins()])
    current = Object.freeze({ bundles: [...bundles], plugins: [...plugins], refreshedAt: new Date().toISOString() })
    return current
  }
  return {
    capabilities: options.capabilities,
    installed: moduleId => {
      const receiptIdentity = identityFor(moduleId)
      if (receiptIdentity === undefined) return undefined
      return receiptIdentity
    },
    async stage(module) {
      if (module.moduleId !== options.moduleId || !options.isArtifactAvailable(module)) throw new Error('dsh-native-artifact-unavailable')
    },
    async install(module) {
      if (module.moduleId !== options.moduleId) throw new Error('dsh-native-module-not-allowed')
      await refresh()
      if (current.bundles.some(row => row.name === options.packageName && row.installed)) throw new Error('profile-unowned-module')
      const spec = nativePackage(module)
      await options.inspectArtifact(module)
      options.onBeforeMutation?.(module.moduleId)
      const inspected = await options.native.inspect(spec)
      // Alpha2 inspects only a tarball's spec; the Host checked its bytes above.
      if (inspected.status !== 'accepted' || inspected.bundle === false) throw new Error('dsh-native-spec-not-bundle')
      const result = await options.native.installBundle(spec, { enabled: true })
      const failure = resultError(result, 'install')
      if (failure !== undefined) throw failure
      options.ownership.add(module.moduleId)
      await refresh()
    },
    async repair(module) {
      if (module.moduleId !== options.moduleId || !options.ownership.has(module.moduleId)) throw new Error('dsh-native-repair-requires-ownership')
      const owned = options.ownedIdentity?.(module.moduleId)
      if (owned?.version !== module.version || owned.artifactDigest !== module.artifactDigest) throw new Error('profile-identity-conflict')
      await refresh()
      const existing = current.bundles.find(row => row.name === options.packageName && row.installed)
      if (existing !== undefined && existing.version !== module.version) throw new Error('profile-identity-conflict')
      await options.inspectArtifact(module)
      const spec = nativePackage(module, true)
      options.onBeforeMutation?.(module.moduleId)
      const result = await options.native.installBundle(spec, { enabled: true })
      const failure = resultError(result, 'repair')
      if (failure !== undefined) throw failure
      await refresh()
    },
    async claim(module) {
      if (module.moduleId !== options.moduleId) throw new Error('dsh-native-module-not-allowed')
      await refresh()
      const bundle = current.bundles.find(row => row.name === options.packageName && row.installed)
      if (bundle === undefined) throw new Error('dsh-native-claim-package-missing')
      if (bundle.version !== module.version) throw new Error('dsh-native-claim-version-conflict')
      // No installBundle call here: exact-present packages are explicitly
      // claimed by Workbench after its own byte/manifest verifier succeeds.
      options.ownership.add(module.moduleId)
    },
    async unclaim(moduleId) { if (moduleId === options.moduleId) options.ownership.remove(moduleId) },
    verify: options.verify,
    async activate(moduleId) {
      if (moduleId !== options.moduleId) return
      await refresh()
      // Post-restart verification is read-only; enablement belongs to DSH.
      const bundle = current.bundles.find(row => row.name === options.packageName && row.installed)
      if (!bundle?.enabled || !identityFor(moduleId)) throw new Error('owned-module-not-verified')
    },
    async rollback(moduleId) {
      if (moduleId !== options.moduleId || !options.ownership.has(moduleId)) return
      options.onBeforeMutation?.(moduleId)
      const result = await options.native.removeBundle(options.packageName)
      const failure = resultError(result, 'remove')
      if (failure !== undefined) throw failure
      options.ownership.remove(moduleId)
      await refresh()
    },
    refresh,
    inventory: () => current,
  }
}
