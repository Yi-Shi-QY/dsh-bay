export type WorkbenchModuleModeV1 = 'workbench' | 'official' | 'both'
/**
 * Render scopes currently backed by a Workbench editor Slot and layout model.
 * Keep this separate from module activation scope: modules may be activated
 * for an Area in the host while their concrete editor still renders in a
 * root or Session Slot.
 */
export type WorkbenchEditorScopeV1 = 'root' | 'session'
export type WorkbenchModuleScopeV1 = 'root' | 'session' | 'area'
export type WorkbenchEditorStateRestoreV1 = 'always' | 'if-valid' | 'never'
export type WorkbenchEditorStateShareV1 = 'portable' | 'reference-only' | 'forbidden'
export type WorkbenchEditorBackgroundRuntimeV1 = 'keep' | 'pause' | 'dispose'
export type WorkbenchEditorReacquireV1 = 'on-visible' | 'on-activate'
export type WorkbenchEditorBindingRequirementV1 = 'none' | 'workspace' | 'session'
export type WorkbenchEditorUnboundBehaviorV1 = 'available' | 'pending' | 'hidden'
export type WorkbenchEditorBindingSharingV1 = 'none' | 'area' | 'independent'

const WORKBENCH_EDITOR_ID = /^[a-z0-9][a-z0-9._:-]{0,127}$/iu
const WORKBENCH_RESOURCE_TYPE = /^[a-z0-9][a-z0-9._-]{0,63}$/u
const WORKBENCH_MAX_EDITOR_STATE_BYTES = 256 * 1024

/**
 * The binding contract is deliberately separate from the render slot scope.
 * A Session-backed editor may be pending without creating a Session, while a
 * standalone editor can render immediately without inheriting an Area's
 * Conversation. Core owns the transition and sharing semantics.
 */
export interface WorkbenchEditorBindingPolicyV1 {
  readonly requirement: WorkbenchEditorBindingRequirementV1
  readonly unbound: WorkbenchEditorUnboundBehaviorV1
  readonly sharing: WorkbenchEditorBindingSharingV1
}

/** Resource actions an editor can receive from a Conversation result. */
export interface WorkbenchConversationResourceBindingV1 {
  readonly resourceType: string
  readonly displayName?: string
  readonly description?: string
  readonly editorId: string
  readonly resourcePatterns: readonly string[]
  readonly defaultPlacement: 'activate-or-add' | 'new-tab' | 'replace-current' | 'official-sidebar' | 'disabled'
}

/**
 * Declarative editor policy owned by Core. Modules describe the state and
 * resource contract; they do not decide when the Workbench persists or
 * mounts their editor.
 */
export interface WorkbenchEditorDeclarationV1 {
  readonly editorId: string
  readonly scope: WorkbenchEditorScopeV1
  readonly label: string
  readonly state: {
    readonly schemaVersion: number
    readonly maxBytes: number
    readonly restore: WorkbenchEditorStateRestoreV1
    readonly share: WorkbenchEditorStateShareV1
  }
  /** Legacy shorthand retained for manifest compatibility. */
  readonly requiredBinding: WorkbenchEditorBindingRequirementV1
  /** Explicit lifecycle contract for unbound and Area-shared states. */
  readonly binding?: WorkbenchEditorBindingPolicyV1
  /** Optional resource routes declared by an extension editor. */
  readonly conversationResources?: readonly WorkbenchConversationResourceBindingV1[]
  readonly runtime: {
    readonly background: WorkbenchEditorBackgroundRuntimeV1
    readonly collapsed: WorkbenchEditorBackgroundRuntimeV1
    readonly reacquire: WorkbenchEditorReacquireV1
  }
}

/**
 * Validate the complete editor contract at the Core/Slot seam.
 *
 * The DSH Slot registry treats contribution metadata as untrusted input. A
 * shallow `moduleId` check is insufficient because the nested binding,
 * lifecycle and persistence policies directly affect Core-owned resources.
 * This function returns a diagnostic so catalog discovery can fail closed for
 * one editor without preventing unrelated extensions from loading.
 */
export function workbenchEditorDeclarationFailureV1(
  value: unknown,
  expectedScope?: WorkbenchEditorScopeV1,
  expectedEditorId?: string,
): string | undefined {
  try {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return '声明必须是对象。'
  const declaration = value as Partial<WorkbenchEditorDeclarationV1>
  if (typeof declaration.editorId !== 'string' || !WORKBENCH_EDITOR_ID.test(declaration.editorId)) return 'editorId 无效。'
  if (expectedEditorId !== undefined && declaration.editorId !== expectedEditorId) return 'editorId 必须与 Slot 内页 ID 一致。'
  if (declaration.scope !== 'root' && declaration.scope !== 'session') return 'scope 无效；当前内页只支持 root 或 session。'
  if (expectedScope !== undefined && declaration.scope !== expectedScope) return `scope 必须为 ${expectedScope}。`
  if (typeof declaration.label !== 'string' || declaration.label.trim() === '' || declaration.label.length > 256) return 'label 无效。'
  const state = declaration.state
  if (typeof state !== 'object' || state === null || Array.isArray(state)
    || !Number.isSafeInteger(state.schemaVersion) || state.schemaVersion < 1
    || !Number.isSafeInteger(state.maxBytes) || state.maxBytes < 1 || state.maxBytes > WORKBENCH_MAX_EDITOR_STATE_BYTES
    || !['always', 'if-valid', 'never'].includes(state.restore as string)
    || !['portable', 'reference-only', 'forbidden'].includes(state.share as string)) return 'state 合同无效。'
  if (!['none', 'workspace', 'session'].includes(declaration.requiredBinding as string)) return 'requiredBinding 无效。'
  const binding = declaration.binding
  if (binding !== undefined) {
    if (typeof binding !== 'object' || binding === null || Array.isArray(binding)
      || !['none', 'workspace', 'session'].includes(binding.requirement as string)
      || !['available', 'pending', 'hidden'].includes(binding.unbound as string)
      || !['none', 'area', 'independent'].includes(binding.sharing as string)) return 'binding 合同无效。'
    if (binding.requirement !== declaration.requiredBinding) return 'binding.requirement 必须与 requiredBinding 一致。'
    if (binding.requirement === 'none' && binding.sharing !== 'none') return '无绑定内页不能声明共享绑定。'
  }
  const runtime = declaration.runtime
  if (typeof runtime !== 'object' || runtime === null || Array.isArray(runtime)
    || !['keep', 'pause', 'dispose'].includes(runtime.background as string)
    || !['keep', 'pause', 'dispose'].includes(runtime.collapsed as string)
    || !['on-visible', 'on-activate'].includes(runtime.reacquire as string)) return 'runtime 合同无效。'
  if (declaration.conversationResources !== undefined) {
    if (!Array.isArray(declaration.conversationResources)) return 'conversationResources 必须是数组。'
    const resourceTypes = new Set<string>()
    for (const resource of declaration.conversationResources) {
      if (typeof resource !== 'object' || resource === null || Array.isArray(resource)
        || typeof resource.resourceType !== 'string' || !WORKBENCH_RESOURCE_TYPE.test(resource.resourceType)
        || resource.editorId !== declaration.editorId
        || resourceTypes.has(resource.resourceType)
        || !Array.isArray(resource.resourcePatterns) || resource.resourcePatterns.length === 0
        || resource.resourcePatterns.some((pattern: unknown) => typeof pattern !== 'string' || pattern.length === 0 || pattern.length > 256)
        || !['activate-or-add', 'new-tab', 'replace-current', 'official-sidebar', 'disabled'].includes(resource.defaultPlacement as string)) return 'conversationResources 合同无效。'
      if ((resource.displayName !== undefined && (typeof resource.displayName !== 'string' || resource.displayName.length > 128))
        || (resource.description !== undefined && (typeof resource.description !== 'string' || resource.description.length > 512))) return '资源显示说明无效。'
      resourceTypes.add(resource.resourceType)
    }
  }
  return undefined
  } catch {
    return '声明字段无法安全读取。'
  }
}

export function isWorkbenchEditorDeclarationV1(
  value: unknown,
  expectedScope?: WorkbenchEditorScopeV1,
  expectedEditorId?: string,
): value is WorkbenchEditorDeclarationV1 {
  return workbenchEditorDeclarationFailureV1(value, expectedScope, expectedEditorId) === undefined
}

export function validateWorkbenchEditorDeclarationV1(
  value: unknown,
  expectedScope?: WorkbenchEditorScopeV1,
  expectedEditorId?: string,
): asserts value is WorkbenchEditorDeclarationV1 {
  const failure = workbenchEditorDeclarationFailureV1(value, expectedScope, expectedEditorId)
  if (failure !== undefined) throw new Error(`Invalid Workbench editor declaration: ${failure}`)
}
/** Product category, independent from trust and installation source. */
export type WorkbenchModuleKindV1 = 'official-builtin' | 'extension'
/**
 * Delivery policy is deliberately separate from `kind` and from trust.  An
 * official builtin may still be shipped as its own tarball, but that tarball
 * is an official Workbench release unit rather than a community install.
 */
export type WorkbenchModuleDeliveryV1 = 'core-bundled' | 'official-component' | 'catalog' | 'direct-source'

const OFFICIAL_BUILTIN_MODULES = new Set(['workbench.core', 'workbench.conversation-suite'])

/** Classify legacy manifests without silently treating first-party modules as extensions. */
export function workbenchModuleKindFor(input: { readonly moduleId: string; readonly kind?: WorkbenchModuleKindV1 }): WorkbenchModuleKindV1 {
  if (input.kind !== undefined) return input.kind
  return OFFICIAL_BUILTIN_MODULES.has(input.moduleId) ? 'official-builtin' : 'extension'
}

/**
 * Resolve the only supported delivery channel for a module category.  The
 * browser must not infer this from a Catalog source locator: official
 * builtins are delivered by the Workbench release, while extensions are the
 * only modules eligible for user-selected Catalog or direct-source installs.
 */
export function workbenchModuleDeliveryFor(input: {
  readonly moduleId: string
  readonly kind?: WorkbenchModuleKindV1
  readonly delivery?: WorkbenchModuleDeliveryV1
}): WorkbenchModuleDeliveryV1 {
  const kind = workbenchModuleKindFor(input)
  if (kind === 'official-builtin') {
    if (input.delivery === 'core-bundled' || input.delivery === 'official-component') return input.delivery
    return input.moduleId === 'workbench.core' ? 'core-bundled' : 'official-component'
  }
  if (input.delivery === 'direct-source' || input.delivery === 'catalog') return input.delivery
  return 'catalog'
}

import type { WorkbenchModuleVerificationInputV1 } from './install-coordinator.ts'
import type { WorkbenchContributionV1 } from './contributions.ts'
import type { WorkbenchModuleManagerV1 } from './module-manager.ts'
import type { WorkbenchToolGatewayManagerV1 } from './tool-gateway.ts'
import type { WorkbenchToolUsageServiceV1 } from './tool-usage.ts'

export interface WorkbenchModuleManifestV1 {
  readonly moduleId: string
  /** New artifacts declare this explicitly; legacy artifacts use the classifier above. */
  readonly kind?: WorkbenchModuleKindV1
  /** New artifacts may declare the official release or extension channel. */
  readonly delivery?: WorkbenchModuleDeliveryV1
  readonly version: string
  readonly coreCompatibility: string
  readonly artifactDigest: string
  readonly upstream?: {
    readonly repository: string
    readonly commit: string
    readonly sourcePaths: readonly string[]
    readonly sourceDigest: string
  }
  readonly patchSet?: { readonly id: string; readonly digest: string }
  readonly provides: {
    readonly editorIds: readonly string[]
    readonly surfaces: readonly string[]
    readonly editors?: readonly WorkbenchEditorDeclarationV1[]
  }
  readonly requires: { readonly capabilities: readonly string[]; readonly modules: readonly string[] }
  readonly activation: { readonly mode: WorkbenchModuleModeV1; readonly scope: WorkbenchModuleScopeV1 }
}

/**
 * Source manifests deliberately exclude the release tarball digest. A
 * tarball cannot truthfully embed the digest of its own final bytes; the
 * signed catalog and durable receipt own that immutable release identity.
 */
export type WorkbenchModuleStaticManifestV1 = Omit<WorkbenchModuleManifestV1, 'artifactDigest'>

export type WorkbenchModuleLifecycleStateV1 = 'registered' | 'activating' | 'active' | 'deactivating' | 'failed'
export interface WorkbenchModuleDiagnosticV1 {
  readonly moduleId: string
  readonly state: WorkbenchModuleLifecycleStateV1
  readonly message?: string
}
export type WorkbenchModuleDeactivateReasonV1 = 'user' | 'rollback' | 'upgrade' | 'shutdown'
export interface WorkbenchModuleMigrationInputV1 {
  readonly fromVersion: string
  readonly toVersion: string
  readonly document: unknown
}
export interface WorkbenchModuleMigrationResultV1 {
  readonly status: 'unchanged' | 'migrated' | 'blocked'
  readonly document?: unknown
  readonly message?: string
}

export interface WorkbenchModuleContextV1 {
  readonly mode: { getSnapshot(): unknown; subscribe(listener: () => void): () => void }
  readonly surface: { getSnapshot(): unknown; subscribe(listener: () => void): () => void }
  readonly areas: { claim(workbenchId: string, areaId: string, requestId: string): unknown; release(claim: unknown): void }
  readonly sessions: { place(workspaceId: string, input: unknown): Promise<unknown>; bindExisting(sessionId: string, input: unknown): Promise<unknown>; release(bindingId: string): Promise<void> }
  readonly editors: {
    register(input: {
      editorId: string
      scope: WorkbenchEditorScopeV1
      label: string
      render: unknown
      declaration?: WorkbenchEditorDeclarationV1
    }): () => void
    catalog(): unknown
  }
  /** Additive contributions owned by a module. Core guarantees disposal on deactivate. */
  readonly contributions?: { register(input: WorkbenchContributionV1): () => void }
  /** Workbench-scoped MCP/CLI/Tool/Skill registry and policy projection. */
  readonly toolGateway?: WorkbenchToolGatewayManagerV1
  /** Optional read-only projection of DSH Session tool usage. */
  readonly toolUsageService?: WorkbenchToolUsageServiceV1
  readonly persistence: { getSnapshot(): unknown; update(workbenchId: string, update: unknown): Promise<void>; subscribe(listener: () => void): () => void }
  readonly settings: { getDirectory(): unknown }
  readonly host: WorkbenchHostAdapterV1
  readonly diagnostics: { report(diagnostic: WorkbenchModuleDiagnosticV1): void; list(): readonly WorkbenchModuleDiagnosticV1[] }
  /** Core-owned signed Catalog UI seam. It never exposes Profile, Registry,
   * filesystem, or Session authority to an inner-page Module. */
  readonly moduleManager?: WorkbenchModuleManagerV1
}

/** Host authority exposed by Core. Browser modules cannot install packages by
 * themselves; they request these operations through the profile adapter. */
export interface WorkbenchHostAdapterV1 {
  capabilities(): readonly string[]
  invoke<T>(operation: string, input: unknown): Promise<T>
  stageModule(input: { moduleId: string; version: string; artifactDigest: string; artifact: Uint8Array }): Promise<void>
  installModule(input: { moduleId: string; version: string; artifactDigest: string }): Promise<void>
  /** Host-owned post-restart package manifest and provenance verification. */
  verifyModule(input: WorkbenchModuleVerificationInputV1): Promise<void>
  activateModule(moduleId: string): Promise<void>
  rollbackModule(moduleId: string): Promise<void>
  createRecipientBinding(input: { workspaceId?: string }): Promise<{ bindingId: string }>
  readReceipts(): Promise<readonly unknown[]>
}

export interface WorkbenchModuleV1 {
  readonly manifest: WorkbenchModuleManifestV1
  register(context: WorkbenchModuleContextV1): void
  activate(context: WorkbenchModuleContextV1): Promise<void>
  deactivate(reason: WorkbenchModuleDeactivateReasonV1): Promise<void>
  migrate(input: WorkbenchModuleMigrationInputV1): Promise<WorkbenchModuleMigrationResultV1>
}

/** Source-only lifecycle shape. It becomes a full Module only when a signed
 * catalog supplies the final tarball identity after packaging. */
export interface WorkbenchModuleSourceV1 {
  readonly manifest: WorkbenchModuleStaticManifestV1
  register(context: WorkbenchModuleContextV1): void
  activate(context: WorkbenchModuleContextV1): Promise<void>
  deactivate(reason: WorkbenchModuleDeactivateReasonV1): Promise<void>
  migrate(input: WorkbenchModuleMigrationInputV1): Promise<WorkbenchModuleMigrationResultV1>
}

/**
 * Seal the public Core context before handing it to a Module.  This keeps the
 * compatibility facade honest: private repositories, event stores and DSH's
 * global current Session cannot accidentally become part of the Module API.
 */
export function createWorkbenchModuleContextV1(input: WorkbenchModuleContextV1): WorkbenchModuleContextV1 {
  const forbidden = ['repository', 'sessionStore', 'eventStore', 'currentSession', 'globalSession']
  const leaked = forbidden.find(key => key in (input as unknown as Record<string, unknown>))
  if (leaked !== undefined) throw new Error(`Workbench Module Context cannot expose Core private state: ${leaked}`)
  return Object.freeze({ ...input })
}

export function validateWorkbenchModuleManifestV1(manifest: WorkbenchModuleStaticManifestV1 | WorkbenchModuleManifestV1): void {
  if (!/^workbench\.[a-z0-9][a-z0-9.-]*$/u.test(manifest.moduleId)) throw new Error(`Invalid Workbench moduleId: ${manifest.moduleId}`)
  if (manifest.kind !== undefined && manifest.kind !== 'official-builtin' && manifest.kind !== 'extension') throw new Error(`Invalid Workbench module kind: ${String(manifest.kind)}`)
  if (manifest.delivery !== undefined && !['core-bundled', 'official-component', 'catalog', 'direct-source'].includes(manifest.delivery)) throw new Error(`Invalid Workbench module delivery: ${String(manifest.delivery)}`)
  if (workbenchModuleKindFor(manifest) === 'official-builtin' && (manifest.delivery === 'catalog' || manifest.delivery === 'direct-source')) throw new Error(`Official builtin ${manifest.moduleId} cannot use extension delivery: ${manifest.delivery}`)
  if (workbenchModuleKindFor(manifest) === 'extension' && (manifest.delivery === 'core-bundled' || manifest.delivery === 'official-component')) throw new Error(`Extension ${manifest.moduleId} cannot use official delivery: ${manifest.delivery}`)
  if (manifest.version.trim() === '') throw new Error(`Module ${manifest.moduleId} requires a version`)
  if (manifest.coreCompatibility.trim() === '') throw new Error(`Module ${manifest.moduleId} requires coreCompatibility`)
  if ('artifactDigest' in manifest && !/^[a-f0-9]{64}$/iu.test(manifest.artifactDigest)) throw new Error(`Module ${manifest.moduleId} requires a SHA-256 artifactDigest`)
  if (new Set(manifest.requires.modules).size !== manifest.requires.modules.length) throw new Error(`Module ${manifest.moduleId} contains duplicate module requirements`)
  if (manifest.requires.modules.includes(manifest.moduleId)) throw new Error(`Module ${manifest.moduleId} cannot require itself`)
  if (manifest.provides.editorIds.some(id => typeof id !== 'string' || !WORKBENCH_EDITOR_ID.test(id))) throw new Error(`Module ${manifest.moduleId} contains an invalid editorId`)
  if (new Set(manifest.provides.editorIds).size !== manifest.provides.editorIds.length) throw new Error(`Module ${manifest.moduleId} contains duplicate editorIds`)
  if (manifest.provides.editors !== undefined) {
    const declaredIds = new Set(manifest.provides.editors.map(editor => editor.editorId))
    if (declaredIds.size !== manifest.provides.editors.length) throw new Error(`Module ${manifest.moduleId} contains duplicate editor declarations`)
    if (declaredIds.size !== manifest.provides.editorIds.length
      || manifest.provides.editorIds.some(editorId => !declaredIds.has(editorId))) {
      throw new Error(`Module ${manifest.moduleId} editor declarations must exactly match provides.editorIds`)
    }
    for (const editor of manifest.provides.editors) {
      const failure = workbenchEditorDeclarationFailureV1(editor)
      if (failure !== undefined) throw new Error(`Editor declaration ${editor.editorId} is invalid: ${failure}`)
    }
  }
  const officialOwners = new Set(['root', 'layout.frame', 'sidebar', 'conversation', 'details'])
  const forbiddenSurface = manifest.provides.surfaces.find(surface => officialOwners.has(surface))
  if (forbiddenSurface !== undefined) throw new Error(`Module ${manifest.moduleId} cannot register official owner: ${forbiddenSurface}`)
  const forbiddenEditor = manifest.provides.editorIds.find(editorId => officialOwners.has(editorId))
  if (forbiddenEditor !== undefined) throw new Error(`Module ${manifest.moduleId} cannot register official editor owner: ${forbiddenEditor}`)
}
