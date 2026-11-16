import type { WorkbenchModuleDependencyRequestV1, WorkbenchModuleCatalogEntryV1, WorkbenchModuleCatalogV1, WorkbenchModuleIdentityV1 } from './module-catalog.ts'
import { validateWorkbenchCompositionPackageV2, type WorkbenchCompositionPackageV2 } from './composition-package.ts'
import type { WorkbenchModuleSourceV1 } from './module-source.ts'

export type WorkbenchInstallPlanSourceV1 = 'market' | 'composition-package' | 'signed-local-catalog' | 'direct-source'
export type WorkbenchInstallPlanStatusV1 = 'ready' | 'blocked'

export interface WorkbenchModuleInstallPlanRequestV1 extends WorkbenchModuleDependencyRequestV1 {}

export interface WorkbenchInstallPlanBlockerV1 {
  readonly code: 'missing-module' | 'dependency-cycle' | 'capability' | 'identity-conflict' | 'invalid-request' | 'revoked' | 'untrusted-source'
  readonly moduleId?: string
  readonly message: string
}

export interface WorkbenchModuleInstallPlanV1 {
  readonly planId: string
  readonly source: WorkbenchInstallPlanSourceV1
  readonly requested: readonly WorkbenchModuleInstallPlanRequestV1[]
  readonly resolved: readonly WorkbenchModuleIdentityV1[]
  readonly toInstall: readonly WorkbenchModuleIdentityV1[]
  readonly reused: readonly WorkbenchModuleIdentityV1[]
  readonly dependencies: readonly { readonly from: string; readonly to: string }[]
  readonly requiredCapabilities: readonly string[]
  /** Facts which the Host repeats after restart before a Module is activated. */
  readonly verification: readonly WorkbenchModuleInstallVerificationV1[]
  readonly blockers: readonly WorkbenchInstallPlanBlockerV1[]
  readonly status: WorkbenchInstallPlanStatusV1
}

export interface WorkbenchModuleInstallVerificationV1 extends WorkbenchModuleIdentityV1 {
  /** Host-resolved direct origin, persisted before any Profile mutation. */
  readonly origin?: WorkbenchModuleSourceV1
  readonly packageName: string
  readonly coreCompatibility: string
  readonly sourceLocator: string
  readonly integrity: string
  readonly catalogId: string
  readonly publisherKeyId: string
  readonly dshGeneration: string
  readonly requiredCapabilities: readonly string[]
  readonly permissions: readonly string[]
  readonly provenance: {
    readonly upstreamCommit: string
    readonly sourceDigest: string
    readonly patchDigest: string
  }
  readonly editorIds: readonly string[]
  readonly scope: string
}

export interface WorkbenchInstallPlanInputV1 {
  readonly source: WorkbenchInstallPlanSourceV1
  readonly requested: readonly WorkbenchModuleInstallPlanRequestV1[]
  readonly catalog: WorkbenchModuleCatalogV1
  readonly installed?: ReadonlyMap<string, WorkbenchModuleIdentityV1>
  readonly capabilities?: readonly string[]
  readonly profileConflict?: 'unowned-module'
}

/**
 * Composition imports deliberately use the same resolver as a market install.
 * The package is only a request source; it must not create a second installer
 * or bypass catalog identity, dependency and capability checks.
 */
export function createWorkbenchCompositionInstallPlan(
  composition: WorkbenchCompositionPackageV2,
  catalog: WorkbenchModuleCatalogV1,
  options: Pick<WorkbenchInstallPlanInputV1, 'installed' | 'capabilities'> = {},
): WorkbenchModuleInstallPlanV1 {
  validateWorkbenchCompositionPackageV2(composition)
  return createWorkbenchModuleInstallPlan({
    source: 'composition-package',
    requested: [composition.core, ...composition.modules],
    catalog,
    ...options,
  })
}

const identityKey = (identity: WorkbenchModuleIdentityV1): string => `${identity.moduleId}\u0000${identity.version}\u0000${identity.artifactDigest.toLowerCase()}`
const requestKey = (request: WorkbenchModuleDependencyRequestV1): string => `${request.moduleId}\u0000${request.version ?? ''}\u0000${request.artifactDigest?.toLowerCase() ?? ''}`

export function createWorkbenchModuleInstallPlan(input: WorkbenchInstallPlanInputV1): WorkbenchModuleInstallPlanV1 {
  const blockers: WorkbenchInstallPlanBlockerV1[] = []
  if (input.profileConflict === 'unowned-module') blockers.push({
    code: 'identity-conflict', moduleId: 'workbench.conversation-suite',
    message: '当前 Profile 已存在未由 Workbench 管理的内页模块，无法直接接管。请使用原安装来源修复，或在干净 Profile 中重新安装。',
  })
  const resolved = new Map<string, WorkbenchModuleCatalogEntryV1>()
  const resolutionOrder: string[] = []
  const edges: Array<{ from: string; to: string }> = []
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const requested = [...input.requested]

  const visit = (request: WorkbenchModuleDependencyRequestV1, parent?: string): void => {
    if (!/^workbench\.[a-z0-9][a-z0-9.-]*$/u.test(request.moduleId)) {
      blockers.push({ code: 'invalid-request', moduleId: request.moduleId, message: `Invalid module request: ${request.moduleId}` })
      return
    }
    const entry = input.catalog.resolve(request)
    if (entry === undefined) {
      blockers.push({ code: 'missing-module', moduleId: request.moduleId, message: `Module is not present in catalog: ${request.moduleId}` })
      return
    }
    if (parent !== undefined) edges.push({ from: parent, to: entry.moduleId })
    const key = entry.moduleId
    if (visiting.has(key)) {
      blockers.push({ code: 'dependency-cycle', moduleId: key, message: `Module dependency cycle includes ${key}` })
      return
    }
    const previous = resolved.get(key)
    if (previous !== undefined && identityKey(previous) !== identityKey(entry)) {
      blockers.push({ code: 'identity-conflict', moduleId: key, message: `Module request resolves to conflicting identities: ${key}` })
      return
    }
    if (visited.has(key)) return
    resolved.set(key, entry)
    if (input.source === 'signed-local-catalog' && entry.source.kind !== 'signed-local-catalog') {
      blockers.push({ code: 'untrusted-source', moduleId: key, message: `V1 Module must come from a signed local catalog: ${key}` })
    }
    if (entry.signedCatalog?.revoked === true) {
      blockers.push({ code: 'revoked', moduleId: key, message: `Catalog entry is revoked: ${key}` })
    }
    visiting.add(key)
    for (const capability of entry.requires.capabilities) {
      if (!(input.capabilities ?? []).includes(capability)) blockers.push({ code: 'capability', moduleId: key, message: `Missing capability ${capability} for ${key}` })
    }
    for (const dependency of entry.requires.modules) visit(dependency, key)
    visiting.delete(key)
    visited.add(key)
    resolutionOrder.push(key)
  }

  const duplicateRequests = new Set<string>()
  for (const request of requested) {
    const key = requestKey(request)
    if (duplicateRequests.has(key)) continue
    duplicateRequests.add(key)
    visit(request)
  }

  // Dependencies are emitted before their dependants so the same order can be
  // used safely by Core staging, installation and activation.
  const resolvedIdentities = resolutionOrder.map(moduleId => resolved.get(moduleId)!).map(entry => ({ moduleId: entry.moduleId, version: entry.version, artifactDigest: entry.artifactDigest }))
  const toInstall: WorkbenchModuleIdentityV1[] = []
  const reused: WorkbenchModuleIdentityV1[] = []
  for (const identity of resolvedIdentities) {
    const installed = input.installed?.get(identity.moduleId)
    if (installed === undefined) toInstall.push(identity)
    else if (identityKey(installed) === identityKey(identity)) reused.push(identity)
    else blockers.push({ code: 'identity-conflict', moduleId: identity.moduleId, message: `Installed module identity conflicts with requested ${identity.moduleId}` })
  }
  const uniqueBlockers = [...new Map(blockers.map(blocker => [`${blocker.code}\u0000${blocker.moduleId ?? ''}\u0000${blocker.message}`, blocker])).values()]
  const requiredCapabilities = [...new Set([...resolved.values()].flatMap(entry => entry.requires.capabilities))].sort()
  const verification = resolvedIdentities.flatMap(identity => {
    const entry = resolved.get(identity.moduleId)!
    const signed = entry.signedCatalog
    if (signed === undefined) return []
    return [{
      ...identity,
      packageName: signed.packageName,
      coreCompatibility: entry.coreCompatibility,
      sourceLocator: entry.source.locator,
      integrity: signed.integrity,
      catalogId: signed.catalogId,
      publisherKeyId: signed.publisherKeyId,
      dshGeneration: signed.dshGeneration,
      requiredCapabilities: [...entry.requires.capabilities],
      permissions: [...signed.permissions],
      provenance: { ...signed.provenance },
      editorIds: [...(entry.manifest?.provides.editorIds ?? [])],
      scope: entry.manifest?.activation.scope ?? 'area',
    } satisfies WorkbenchModuleInstallVerificationV1]
  })
  const planId = `workbench-plan-${input.source}-${resolvedIdentities.map(identity => `${identity.moduleId}@${identity.version}`).join(',') || 'empty'}`
  return {
    planId,
    source: input.source,
    requested,
    resolved: resolvedIdentities,
    toInstall,
    reused,
    dependencies: [...new Map(edges.map(edge => [`${edge.from}\u0000${edge.to}`, edge])).values()],
    requiredCapabilities,
    verification,
    blockers: uniqueBlockers,
    status: uniqueBlockers.length === 0 ? 'ready' : 'blocked',
  }
}
