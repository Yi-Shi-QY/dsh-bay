import { browserSafeUuid } from '../browser-safe-id.ts'
import type {
  SlotPortableValue,
  SlotPortabilityContextV1,
  SlotPreviewDocumentV1,
} from './workbench-slot-contracts.ts'
import { areasOf, type AreaNode, type ModuleInstanceDocument, type WorkbenchDocumentV3, type WorkbenchNodeV3 } from './document-v3.ts'
import { sessionTargetKey, type SessionBindingV1 } from './model.ts'
import type { JsonValue } from './model.ts'
import { workbenchEditorStateFailureV1 } from '../workbench-editor-state.ts'
import type {
  WorkbenchEditorCatalogRow,
} from './catalog.ts'
import { restoreWorkbenchPortableState } from './workbench-portability.ts'
import type {
  WorkbenchInventory,
  WorkbenchInventoryPage,
} from './workbench-inventory.ts'
import type {
  WorkbenchDependencyCompletenessV1,
  WorkbenchAgentPresetDependencyInputV1,
  WorkbenchAgentPresetDistributionDescriptorV1,
  WorkbenchDependencySnapshotV1,
} from './workbench-distribution.ts'
import type { WorkbenchAiSelectionV1, WorkbenchPackageOriginV1, WorkbenchSettingsV4 } from './persistence.ts'
import type { WorkbenchPackageSignatureV1 } from './workbench-package-trust.ts'
import { projectPortableWorkbenchContext, renderPortableAreaContextMarkdown, renderPortableWorkbenchContextMarkdown, restorePortableWorkbenchContext, validatePortableWorkbenchContext, type PortableWorkbenchContextV1, type WorkbenchContextExportPolicyV1 } from './workbench-context-portability.ts'
import { validatePortableBayAgentOrchestration, type PortableBayAgentOrchestrationV1 } from './workbench-bay-agent-work.ts'
import type { AreaContextV1, WorkbenchContextV1 } from './workbench-context.ts'
import type { WorkbenchAreaMetadataV1 } from './persistence.ts'

/** Public projection version. It is intentionally independent from Settings V4. */
export const PORTABLE_WORKBENCH_SCHEMA_VERSION = 1 as const
/** New exports use v2; the decoder still accepts v1 archives. */
export const WORKBENCH_PACKAGE_SCHEMA_VERSION = 2 as const
export type WorkbenchPackageSchemaVersion = 1 | 2

export type PortableWorkbenchBindingPolicyV1 = 'detached'
/** `all-editors` is a legacy decoder value; new share exports must be active-only. */
export type PortableWorkbenchHistoryPolicyV1 = 'active-editors-only' | 'all-editors'
export type PortableWorkbenchStatePolicyV1 = 'none' | 'sanitized' | 'full'

export interface PortableWorkbenchV1 {
  schemaVersion: typeof PORTABLE_WORKBENCH_SCHEMA_VERSION
  format: 'dsh-portable-workbench'
  name: string
  description: string
  root: PortableWorkbenchNodeV1
  activeAreaKey: string
  bindingPolicy: PortableWorkbenchBindingPolicyV1
  historyPolicy: PortableWorkbenchHistoryPolicyV1
  statePolicy: PortableWorkbenchStatePolicyV1
  context?: PortableWorkbenchContextV1
  agentPreset?: { id: string; label?: string }
  modelPreference?: {
    provider?: string
    model?: string
    label?: string
    reasoningEffort?: string
  }
  orchestration?: PortableBayAgentOrchestrationV1
}

function workbenchAiFromPortable(value: PortableWorkbenchV1['modelPreference']): WorkbenchAiSelectionV1 | undefined {
  if (value?.provider === undefined || value.model === undefined) return undefined
  return {
    provider: value.provider,
    model: value.model,
    ...(value.reasoningEffort === undefined ? {} : { reasoningEffort: value.reasoningEffort }),
  }
}

export type PortableWorkbenchNodeV1 = PortableWorkbenchSplitV1 | PortableWorkbenchAreaV1

export interface PortableWorkbenchSplitV1 {
  kind: 'split'
  key: string
  axis: 'horizontal' | 'vertical'
  ratio: number
  first: PortableWorkbenchNodeV1
  second: PortableWorkbenchNodeV1
}

export interface PortableWorkbenchAreaV1 {
  kind: 'area'
  key: string
  ordinal: number
  activeEditorKey?: string
  editors: readonly PortableWorkbenchEditorV1[]
}

export interface PortableWorkbenchEditorV1 {
  key: string
  editorId: string
  scope: 'root' | 'session'
  label: string
  pluginRef?: string
  availability: 'available' | 'missing' | 'unresolved'
  /** Runtime capability marker; the descriptor function is never serialized. */
  portabilityProtocol?: 1
  portableState: JsonValue | null
}

export interface WorkbenchPackageCompatibilityV1 {
  dsh: { minimum: string; maximum?: string }
  uiSlots?: { minimum?: string; maximum?: string }
  previewProtocol?: { minimum: 1; maximum?: 1 }
  targets?: readonly string[]
}

export interface WorkbenchPackagePluginV1 {
  packageId: string
  version: string
  sourcePolicy: 'source-included' | 'binary-only' | 'remote'
  manifestPath: string
  clientEntry?: string
  hostEntry?: string
  editorIds: readonly string[]
  scopes: readonly ('root' | 'session')[]
  previewProtocol?: 1
  portabilityProtocol?: 1
  permissions: readonly string[]
  license?: string
}

export interface WorkbenchPackageFileRecordV1 {
  path: string
  size: number
  sha256: string
}

export interface WorkbenchPackageManifestV1 {
  schemaVersion: WorkbenchPackageSchemaVersion
  format: 'dsh-workbench-package'
  packageId: string
  name: string
  description: string
  version: string
  createdAt: string
  bindingPolicy: PortableWorkbenchBindingPolicyV1
  completeness?: WorkbenchDependencyCompletenessV1
  distributionMode?: 'online-reference' | 'offline-embedded'
  workbenchPath: 'workbench.json'
  dependencyLockPath?: 'dependencies.lock.json'
  /** Derived npm/pnpm view; dependencies.lock.json remains authoritative. */
  npmDependenciesPath?: 'dependencies.npm.json'
  sessionsPath?: 'sessions.json'
  contextPath?: 'context.json'
  contextPolicy?: WorkbenchContextExportPolicyV1
  contextDigest?: string
  orchestrationPath?: 'orchestration.json'
  previewPath?: 'preview.svg'
  previewDocumentPath?: 'preview.json'
  signaturePath?: 'signature.json'
  compatibility: WorkbenchPackageCompatibilityV1
  baseRuntime?: {
    runtimeId: string
    version: string
    providedCapabilities: readonly string[]
  }
  plugins: readonly WorkbenchPackagePluginV1[]
  permissions: readonly string[]
  files: readonly WorkbenchPackageFileRecordV1[]
  publisher?: {
    displayName: string
    keyId?: string
    source: 'local' | 'community' | 'organization' | 'official'
  }
  /** Optional creator lineage; contains no executable code or local identity. */
  derivedFrom?: {
    packageId: string
    version: string
    archiveSha256: string
  }
}

/** Explicit name for the current archive manifest; V1 remains the decoder-facing alias. */
export type WorkbenchPackageManifestV2 = Omit<WorkbenchPackageManifestV1, 'schemaVersion'> & { schemaVersion: 2 }

/** v2 session template file; real Session identities never enter a package. */
export interface WorkbenchSessionTemplateV1 {
  templateId: string
  displayTitle: string
  recommendedAgentPreset?: { id: string; label?: string }
  modelPreference?: {
    provider?: string
    model?: string
    label?: string
    reasoningEffort?: string
  }
  bindingMode: 'manual'
}

/** Read-only, identity-free Session metadata supplied by the Runtime seam. */
export interface WorkbenchSessionTemplateProjectionV1 {
  displayTitle?: string
  recommendedAgentPreset?: { id: string; label?: string }
  /** Runtime-owned descriptor; never serialized into sessions.json. */
  agentPresetDistribution?: WorkbenchAgentPresetDistributionDescriptorV1
  /** True when the recommended preset is supplied by the recipient Runtime. */
  agentPresetRuntimeProvided?: boolean
  modelPreference?: {
    provider?: string
    model?: string
    label?: string
    reasoningEffort?: string
  }
}

export interface WorkbenchSessionTemplateResolverContextV1 {
  areaIndex: number
  binding: Readonly<SessionBindingV1>
  module: Readonly<ModuleInstanceDocument>
}

/**
 * Runtime-owned, synchronous read seam for exporting safe Session hints.
 * Implementations must return JSON-safe metadata only; no Session identity,
 * transcript, credentials or executable preset composition can cross it.
 */
export type WorkbenchSessionTemplateResolverV1 = (
  context: WorkbenchSessionTemplateResolverContextV1,
) => WorkbenchSessionTemplateProjectionV1 | undefined

export interface WorkbenchSessionsFileV1 {
  schemaVersion: 1
  mode: 'manual-bind'
  templates: readonly WorkbenchSessionTemplateV1[]
  areaBindings: readonly { areaKey: string; templateId: string }[]
}

/** Recipient-selected local targets keyed only by package-local template identity. */
export type WorkbenchSessionTemplateBindingsV1 = Readonly<Record<string, SessionBindingV1>>

export interface WorkbenchPackageFileV1 {
  path: string
  content: Uint8Array
}

export interface WorkbenchPackagePluginInputV1 {
  manifest: WorkbenchPackagePluginV1
  files: readonly WorkbenchPackageFileV1[]
}

export interface WorkbenchPackageBuildInputV1 {
  packageId: string
  name: string
  description?: string
  version: string
  createdAt: string
  document: WorkbenchDocumentV3
  inventory: WorkbenchInventory
  editors: readonly WorkbenchEditorCatalogRow[]
  compatibility: WorkbenchPackageCompatibilityV1
  historyPolicy?: PortableWorkbenchHistoryPolicyV1
  statePolicy?: PortableWorkbenchStatePolicyV1
  includeState?: (module: ModuleInstanceDocument, page: WorkbenchInventoryPage) => JsonValue | undefined
  previewSvg?: string
  preview?: SlotPreviewDocumentV1
  plugins?: readonly WorkbenchPackagePluginInputV1[]
  publisher?: WorkbenchPackageManifestV1['publisher']
  agentPreset?: PortableWorkbenchV1['agentPreset']
  modelPreference?: PortableWorkbenchV1['modelPreference']
  bayAgentOrchestration?: PortableBayAgentOrchestrationV1
  workbenchContext?: WorkbenchContextV1
  areaContexts?: Readonly<Record<string, AreaContextV1>>
  areaMetadata?: Readonly<Record<string, WorkbenchAreaMetadataV1>>
  contextPolicy?: WorkbenchContextExportPolicyV1
  dependencySnapshot?: WorkbenchDependencySnapshotV1
  sessions?: WorkbenchSessionsFileV1
  sessionTemplateResolver?: WorkbenchSessionTemplateResolverV1
  distributionMode?: 'online-reference' | 'offline-embedded'
  baseRuntime?: {
    runtimeId: string
    version: string
    providedCapabilities: readonly string[]
  }
  signature?: WorkbenchPackageSignatureV1
  derivedFrom?: WorkbenchPackageManifestV1['derivedFrom']
  /** Content-addressed artifact payloads selected by the dependency snapshot. */
  artifacts?: readonly {
    digest: string
    files: readonly WorkbenchPackageFileV1[]
    record?: Readonly<Record<string, unknown>>
  }[]
  /** npm pack output kept as a separately integrity-checked payload. */
  npmArtifacts?: readonly {
    portableId: string
    digest: string
    integrity: string
    tarball: Uint8Array
  }[]
}

/** Human-readable npm/pnpm projection derived from the dependency lock. */
export interface WorkbenchNpmDependencyV1 {
  portableId: string
  packageName: string
  version: string
  digest: string
  integrity?: string
  registryUrl?: string
  requiredBy: readonly string[]
}

export interface WorkbenchNpmDependenciesFileV1 {
  schemaVersion: 1
  packageManager: 'pnpm'
  dependencies: readonly WorkbenchNpmDependencyV1[]
}

export interface BuiltWorkbenchPackageV1 {
  manifest: WorkbenchPackageManifestV1
  projection: PortableWorkbenchV1
  files: readonly WorkbenchPackageFileV1[]
}

export interface WorkbenchPackageValidationResultV1 {
  valid: boolean
  errors: readonly string[]
}

/** Project active Session bindings into identity-free manual-bind templates. */
export interface WorkbenchSessionSharingProjectionV1 {
  readonly sessions: WorkbenchSessionsFileV1
  /** Runtime-only inputs consumed by dependency solving; never written to sessions.json. */
  readonly agentPresetDependencies: readonly WorkbenchAgentPresetDependencyInputV1[]
}

export function projectWorkbenchSessionsAndAgentPresetsForSharing(
  document: WorkbenchDocumentV3,
  resolver?: WorkbenchSessionTemplateResolverV1,
): WorkbenchSessionSharingProjectionV1 {
  const templates: WorkbenchSessionTemplateV1[] = []
  const areaBindings: { areaKey: string; templateId: string }[] = []
  const agentPresetDependencies: WorkbenchAgentPresetDependencyInputV1[] = []
  const byBinding = new Map<string, string>()
  let nextTemplate = 1
  for (const [areaIndex, area] of areasOf(document.root).entries()) {
    const module = area.moduleHistory.find(item => item.moduleInstanceId === area.activeModuleInstanceId)
    if (module?.editorScope !== 'session' || module.binding === undefined) continue
    const bindingKey = sessionTargetKey(module.binding)
    let templateId = byBinding.get(bindingKey)
    if (templateId === undefined) {
      templateId = `session-template-${nextTemplate++}`
      byBinding.set(bindingKey, templateId)
      const projection = resolver?.({
        areaIndex,
        binding: structuredClone(module.binding),
        module: structuredClone(module),
      })
      templates.push({
        templateId,
        displayTitle: projection?.displayTitle?.trim() || module.lastKnownTitle || `Session ${templates.length + 1}`,
        ...(projection?.recommendedAgentPreset === undefined ? {} : { recommendedAgentPreset: structuredClone(projection.recommendedAgentPreset) }),
        ...(projection?.modelPreference === undefined ? {} : { modelPreference: structuredClone(projection.modelPreference) }),
        bindingMode: 'manual',
      })
      const recommended = projection?.recommendedAgentPreset
      if (recommended !== undefined) {
        agentPresetDependencies.push({
          presetId: recommended.id,
          templateIds: [templateId],
          ...(projection?.agentPresetDistribution === undefined ? {} : { descriptor: structuredClone(projection.agentPresetDistribution) }),
          ...(projection?.agentPresetRuntimeProvided === true ? { runtimeProvided: true } : {}),
        })
      }
    }
    // Keep this in lockstep with projectWorkbenchForSharing(): source Area IDs
    // are machine-local and must never become references in sessions.json.
    areaBindings.push({ areaKey: `area-${areaIndex + 1}`, templateId })
  }
  return {
    sessions: { schemaVersion: 1, mode: 'manual-bind', templates, areaBindings },
    agentPresetDependencies,
  }
}

export function projectWorkbenchSessionsForSharing(
  document: WorkbenchDocumentV3,
  resolver?: WorkbenchSessionTemplateResolverV1,
): WorkbenchSessionsFileV1 {
  return projectWorkbenchSessionsAndAgentPresetsForSharing(document, resolver).sessions
}

export interface WorkbenchPackageArchiveLimitsV1 {
  maxEntries: number
  maxFileBytes: number
  maxTotalBytes: number
}

export const DEFAULT_WORKBENCH_PACKAGE_ARCHIVE_LIMITS: WorkbenchPackageArchiveLimitsV1 = {
  maxEntries: 128,
  maxFileBytes: 16 * 1024 * 1024,
  maxTotalBytes: 64 * 1024 * 1024,
}

export interface DecodedWorkbenchPackageArchiveV1 {
  manifest: WorkbenchPackageManifestV1
  files: readonly WorkbenchPackageFileV1[]
}

export interface WorkbenchImportSettingsResultV1 {
  settings: WorkbenchSettingsV4
  workbenchId: string
  warnings: readonly string[]
}

export interface WorkbenchImportIdFactoryV1 {
  areaId(areaKey: string): string
  splitId(splitKey: string): string
  moduleInstanceId(editorKey: string): string
}

export interface ImportedWorkbenchV1 {
  document: WorkbenchDocumentV3
  warnings: readonly string[]
  areaKeyToAreaId: ReadonlyMap<string, string>
}

type PlainRecord = Record<string, unknown>

/** Stable JSON serialization used for portable documents and manifest bytes. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value)) ?? 'null'
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value !== null && typeof value === 'object') {
    const record = value as PlainRecord
    return Object.fromEntries(Object.keys(record).sort().map(key => [key, canonicalize(record[key])]))
  }
  return value
}

function utf8(value: string): Uint8Array {
  return new TextEncoder().encode(value)
}

/** SHA-256 in a browser/Node 24 compatible way; no Node-only import is needed. */
export async function sha256Hex(content: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', content as BufferSource)
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('').toUpperCase()
}

/** npm-compatible SHA-512 integrity string for embedded tarballs. */
export async function sha512Integrity(content: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-512', content as BufferSource)
  let binary = ''
  for (const byte of new Uint8Array(digest)) binary += String.fromCharCode(byte)
  return `sha512-${btoa(binary)}`
}

/**
 * Canonical framing for content-addressed executable artifacts.
 *
 * Concatenating file bytes alone is ambiguous (`[ab,c]` and `[a,bc]` are the
 * same byte stream), which made it possible for two different artifact trees
 * to receive the same digest.  Include the sorted relative path and explicit
 * byte lengths so the digest is stable across platforms and unambiguous.
 */
export function canonicalArtifactBytes(
  files: readonly Pick<WorkbenchPackageFileV1, 'path' | 'content'>[],
): Uint8Array {
  const ordered = [...files].sort((left, right) => left.path.localeCompare(right.path, 'en'))
  const encoder = new TextEncoder()
  const chunks: Uint8Array[] = []
  const paths = new Set<string>()
  const writeU32 = (value: number): Uint8Array => {
    const bytes = new Uint8Array(4)
    new DataView(bytes.buffer).setUint32(0, value, false)
    return bytes
  }
  for (const file of ordered) {
    if (paths.has(file.path)) throw new Error(`artifact contains duplicate path: ${file.path}`)
    paths.add(file.path)
    const path = encoder.encode(file.path)
    if (path.byteLength > 0xffffffff || file.content.byteLength > 0xffffffff) {
      throw new Error(`artifact file is too large: ${file.path}`)
    }
    chunks.push(writeU32(path.byteLength), path, writeU32(file.content.byteLength), new Uint8Array(file.content))
  }
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0)
  const result = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.byteLength
  }
  return result
}

function safePath(path: string): boolean {
  return path.length > 0 && !path.startsWith('/') && !path.startsWith('\\')
    && !/^[A-Za-z]:/.test(path)
    && !path.includes('\\')
    && !path.split(/[\\/]/u).some(part => part === '..' || part.length === 0)
}

function ratio(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0.5
}

function pageState(
  module: ModuleInstanceDocument,
  page: WorkbenchInventoryPage,
  catalog: WorkbenchEditorCatalogRow | undefined,
  statePolicy: PortableWorkbenchStatePolicyV1,
  includeState: WorkbenchPackageBuildInputV1['includeState'],
): JsonValue | null {
  if (statePolicy === 'none') return null
  const declaration = catalog?.declaration
  const isExternalEditor = catalog?.extension !== undefined && declaration !== undefined
  if (isExternalEditor && (declaration.state.share === 'forbidden' || declaration.state.share === 'reference-only')) return null
  const value = includeState?.(module, page)
    ?? (catalog?.portability?.version === 1 && catalog.portability.exportState !== undefined
      ? catalog.portability.exportState(module.state as SlotPortableValue, {
        version: 1,
        editor: {
          id: module.editorId,
          scope: module.editorScope,
          moduleInstanceId: module.moduleInstanceId,
          title: page.name,
        },
      } satisfies SlotPortabilityContextV1)
      : undefined)
  if (value === undefined) return null
  if (containsForbiddenPortableKey(value as JsonValue)) throw new Error(`portable state for ${page.editorId} contains a private field`)
  if (isExternalEditor && workbenchEditorStateFailureV1(value, declaration) !== undefined) {
    throw new Error(`portable state for ${page.editorId} exceeds its declared state limit`)
  }
  return structuredClone(value) as JsonValue
}

function containsForbiddenPortableKey(value: JsonValue): boolean {
  if (Array.isArray(value)) return value.some(containsForbiddenPortableKey)
  if (value !== null && typeof value === 'object') {
    return Object.entries(value).some(([key, nested]) =>
      /(?:credential|password|passphrase|secret|token|api[-_]?key|session[-_]?id|workspace[-_]?id|transcript|absolute[-_]?path|machine[-_]?id)/iu.test(key)
      || containsForbiddenPortableKey(nested))
  }
  return false
}

/**
 * Convert the authoritative V3 tree plus the live inventory into a portable
 * projection. Area/module IDs are never copied; package-local keys are derived
 * from deterministic traversal order instead.
 */
export function projectWorkbenchForSharing(input: WorkbenchPackageBuildInputV1): PortableWorkbenchV1 {
  const historyPolicy = input.historyPolicy ?? 'active-editors-only'
  const statePolicy = input.statePolicy ?? 'none'
  const editors = new Map(input.editors.map(editor => [`${editor.scope}:${editor.id}`, editor]))
  const sourceAreas = areasOf(input.document.root)
  let areaIndex = 0
  let splitIndex = 0
  const areaKeys = new Map<string, string>()
  sourceAreas.forEach((area, index) => areaKeys.set(area.areaId, `area-${index + 1}`))
  const projectArea = (node: AreaNode): PortableWorkbenchAreaV1 => {
    const ordinal = areaIndex + 1
    areaIndex += 1
    const inventoryArea = input.inventory.areas[ordinal - 1]
    const pageRows = inventoryArea?.pages ?? []
    const currentModule = node.moduleHistory.find(
      module => module.moduleInstanceId === node.activeModuleInstanceId,
    ) ?? node.moduleHistory[0]
    const sourcePages = historyPolicy === 'all-editors'
      ? node.moduleHistory
      : currentModule === undefined ? [] : [currentModule]
    const editorsInArea = sourcePages.map((module): PortableWorkbenchEditorV1 => {
      const sourceIndex = node.moduleHistory.indexOf(module)
      const page = pageRows.find(row => row.moduleInstanceId === module.moduleInstanceId)
      const key = `area-${ordinal}/editor-${sourceIndex + 1}`
      const catalog = editors.get(`${module.editorScope}:${module.editorId}`)
      const availability = page === undefined
        ? catalog === undefined ? 'missing' : 'unresolved'
        : !page.available ? 'missing' : page.pluginId === undefined ? 'unresolved' : 'available'
      return {
        key,
        editorId: module.editorId,
        scope: module.editorScope,
        label: page?.name ?? catalog?.label ?? module.lastKnownTitle ?? module.editorId,
        ...(page?.pluginId === undefined ? {} : { pluginRef: page.pluginId }),
        availability,
        ...(catalog?.portability?.version === 1 ? { portabilityProtocol: 1 as const } : {}),
        portableState: pageState(module, page ?? {
          moduleInstanceId: module.moduleInstanceId,
          editorId: module.editorId,
          editorScope: module.editorScope,
          name: module.lastKnownTitle || module.editorId,
          active: module.moduleInstanceId === node.activeModuleInstanceId,
          available: catalog !== undefined,
        }, catalog, statePolicy, input.includeState),
      }
    })
    const activeSource = currentModule === undefined
      ? undefined
      : node.moduleHistory.indexOf(currentModule)
    const activeEditorKey = activeSource === undefined || activeSource < 0
      || !editorsInArea.some(editor => editor.key === `area-${ordinal}/editor-${activeSource + 1}`)
      ? undefined
      : `area-${ordinal}/editor-${activeSource + 1}`
    return {
      kind: 'area', key: `area-${ordinal}`, ordinal,
      ...(activeEditorKey === undefined ? {} : { activeEditorKey }),
      editors: editorsInArea,
    }
  }
  const projectNode = (node: WorkbenchNodeV3): PortableWorkbenchNodeV1 => {
    if (node.kind === 'area') return projectArea(node)
    const key = `split-${++splitIndex}`
    return {
      kind: 'split', key, axis: node.axis, ratio: ratio(node.ratio),
      first: projectNode(node.first), second: projectNode(node.second),
    }
  }
  const activeAreaKey = areaKeys.get(input.document.activeAreaId) ?? 'area-1'
  const contextAreas = Object.fromEntries([...areaKeys.entries()].map(([sourceAreaId, packageAreaKey]) => [packageAreaKey, {
    ...(input.areaContexts?.[sourceAreaId] === undefined ? {} : { context: input.areaContexts[sourceAreaId] }),
    ...(input.areaMetadata?.[sourceAreaId]?.ownership === undefined ? {} : { ownership: input.areaMetadata[sourceAreaId].ownership }),
  }]))
  const context = projectPortableWorkbenchContext(input.workbenchContext, contextAreas, input.contextPolicy ?? 'human')
  return {
    schemaVersion: PORTABLE_WORKBENCH_SCHEMA_VERSION,
    format: 'dsh-portable-workbench',
    name: input.name,
    description: input.description ?? '',
    root: projectNode(input.document.root),
    activeAreaKey,
    bindingPolicy: 'detached',
    historyPolicy,
    statePolicy,
    ...(context === undefined ? {} : { context }),
    ...(input.agentPreset === undefined ? {} : { agentPreset: structuredClone(input.agentPreset) }),
    ...(input.modelPreference === undefined ? {} : { modelPreference: structuredClone(input.modelPreference) }),
    ...(input.bayAgentOrchestration === undefined ? {} : { orchestration: structuredClone(input.bayAgentOrchestration) }),
  }
}

function defaultImportIds(prefix: string): WorkbenchImportIdFactoryV1 {
  return {
    areaId: key => `${prefix}-area-${key.replaceAll('/', '-')}`,
    splitId: key => `${prefix}-split-${key}`,
    moduleInstanceId: key => `${prefix}-module-${key.replaceAll('/', '-')}`,
  }
}

function portableAreasOf(node: PortableWorkbenchNodeV1): PortableWorkbenchAreaV1[] {
  return node.kind === 'area' ? [node] : [...portableAreasOf(node.first), ...portableAreasOf(node.second)]
}

function sessionFileIssues(
  sessions: WorkbenchSessionsFileV1,
  projection: PortableWorkbenchV1,
): string[] {
  const issues: string[] = []
  if (sessions.schemaVersion !== 1 || sessions.mode !== 'manual-bind'
    || !Array.isArray(sessions.templates) || !Array.isArray(sessions.areaBindings)) {
    return ['sessions.json is invalid']
  }
  const areas = new Map(portableAreasOf(projection.root).map(area => [area.key, area]))
  const sessionAreaKeys = new Set([...areas.values()].filter(area =>
    area.editors.find(editor => editor.key === area.activeEditorKey)?.scope === 'session').map(area => area.key))
  const templateIds = new Set<string>()
  for (const template of sessions.templates) {
    if (typeof template?.templateId !== 'string' || template.templateId === ''
      || typeof template.displayTitle !== 'string' || template.bindingMode !== 'manual'
      || template.templateId.includes('/') || template.templateId.includes('\\')) {
      issues.push('sessions.json template is invalid')
    } else if (templateIds.has(template.templateId)) {
      issues.push(`duplicate session template: ${template.templateId}`)
    } else {
      templateIds.add(template.templateId)
    }
    const preset = template.recommendedAgentPreset
    if (preset !== undefined && (typeof preset.id !== 'string' || preset.id.trim() === ''
      || preset.id.length > 128 || (preset.label !== undefined && typeof preset.label !== 'string'))) {
      issues.push(`invalid recommended Agent preset: ${template.templateId}`)
    }
    const model = template.modelPreference
    if (model !== undefined && (typeof model !== 'object' || model === null
      || (model.provider !== undefined && typeof model.provider !== 'string')
      || (model.model !== undefined && typeof model.model !== 'string')
      || (model.label !== undefined && typeof model.label !== 'string')
      || (model.reasoningEffort !== undefined && typeof model.reasoningEffort !== 'string'))) {
      issues.push(`invalid Session model preference: ${template.templateId}`)
    }
  }
  const boundAreas = new Set<string>()
  const referencedTemplates = new Set<string>()
  for (const binding of sessions.areaBindings) {
    if (typeof binding?.areaKey !== 'string' || typeof binding.templateId !== 'string'
      || !templateIds.has(binding.templateId) || !sessionAreaKeys.has(binding.areaKey)) {
      issues.push('sessions.json area binding is invalid')
      continue
    }
    if (boundAreas.has(binding.areaKey)) issues.push(`duplicate session Area binding: ${binding.areaKey}`)
    boundAreas.add(binding.areaKey)
    referencedTemplates.add(binding.templateId)
  }
  for (const areaKey of sessionAreaKeys) {
    if (!boundAreas.has(areaKey)) issues.push(`session Area has no template binding: ${areaKey}`)
  }
  for (const templateId of templateIds) {
    if (!referencedTemplates.has(templateId)) issues.push(`unreferenced session template: ${templateId}`)
  }
  return issues
}

function importSessionPlan(
  projection: PortableWorkbenchV1,
  sessions: WorkbenchSessionsFileV1 | undefined,
  selected: WorkbenchSessionTemplateBindingsV1 | undefined,
  detachedSessionId: string,
): { bindingsByArea: ReadonlyMap<string, { templateId: string; binding: SessionBindingV1 }> } {
  if (sessions === undefined) {
    if (selected !== undefined && Object.keys(selected).length > 0) {
      throw new Error('Session template targets were supplied without sessions.json')
    }
    return { bindingsByArea: new Map() }
  }
  const issues = sessionFileIssues(sessions, projection)
  if (issues.length > 0) throw new Error(issues.join('; '))
  const templates = new Map(sessions.templates.map((template, index) => [template.templateId, index + 1]))
  for (const [templateId, binding] of Object.entries(selected ?? {})) {
    if (!templates.has(templateId)) throw new Error(`unknown Session template target: ${templateId}`)
    if (binding === null || typeof binding !== 'object' || typeof binding.sessionId !== 'string'
      || binding.sessionId.trim() === '' || binding.detached === true
      || (binding.workspaceId !== undefined && binding.workspaceId.trim() === '')) {
      throw new Error(`Session template target is not a real local Session: ${templateId}`)
    }
  }
  const targetByTemplate = new Map<string, SessionBindingV1>()
  for (const [templateId, ordinal] of templates) {
    const target = selected?.[templateId]
    targetByTemplate.set(templateId, target === undefined
      ? { sessionId: `${detachedSessionId}-template-${ordinal}`, detached: true }
      : structuredClone(target))
  }
  return {
    bindingsByArea: new Map(sessions.areaBindings.map(({ areaKey, templateId }) => [
      areaKey,
      { templateId, binding: targetByTemplate.get(templateId)! },
    ])),
  }
}

/**
 * Rehydrate a portable projection into a fresh V3 document. This is deliberately
 * a pure conversion: it never installs a plugin, opens a Session, or changes
 * Settings. Missing editor registrations remain in the tree for later recovery.
 */
export function importPortableWorkbench(
  projection: PortableWorkbenchV1,
  options: {
    ids?: WorkbenchImportIdFactoryV1
    prefix?: string
    detachedSessionId?: string
    /** Optional live catalog and target for real Session-backed hydration. */
    editors?: readonly WorkbenchEditorCatalogRow[]
    targetBinding?: SessionBindingV1
    /** V2 package Session template graph and recipient-selected local targets. */
    sessions?: WorkbenchSessionsFileV1
    templateBindings?: WorkbenchSessionTemplateBindingsV1
  } = {},
): ImportedWorkbenchV1 {
  if (!validProjection(projection)) throw new Error('invalid portable Workbench projection')
  const ids = options.ids ?? defaultImportIds(options.prefix ?? 'imported-workbench')
  // Session editors cannot be persisted without a binding in Workbench V4,
  // but a detached package must not bind itself to a real user Session. Keep
  // the editor scope and state while assigning one clearly synthetic local
  // target. The Frame will render it as unavailable until the user retargets
  // the Area to a real Session.
  const detachedSessionId = options.detachedSessionId ?? `${options.prefix ?? 'imported-workbench'}-detached-session`
  const sessionPlan = importSessionPlan(projection, options.sessions, options.templateBindings, detachedSessionId)
  if (options.targetBinding?.detached === true || options.targetBinding?.sessionId.trim() === '') {
    throw new Error('target Session binding must identify a real local Session')
  }
  const editorCatalog = new Map((options.editors ?? []).map(editor => [
    `${editor.scope}:${editor.id}`, editor,
  ]))
  const areaIds = new Map<string, string>()
  const warnings: string[] = []
  for (const template of options.sessions?.templates ?? []) {
    const preset = template.recommendedAgentPreset
    if (preset !== undefined) {
      warnings.push(`Session 模板“${template.displayTitle}”推荐 Agent 模式“${preset.label ?? preset.id}”；导入后需在目标 Session 中手动确认。`)
    }
  }
  let firstAreaId: string | undefined
  const importArea = (node: PortableWorkbenchAreaV1): AreaNode => {
    const areaId = ids.areaId(node.key)
    areaIds.set(node.key, areaId)
    firstAreaId ??= areaId
    const templateBinding = sessionPlan.bindingsByArea.get(node.key)
    const importedBinding = options.targetBinding ?? templateBinding?.binding
      ?? { sessionId: detachedSessionId, detached: true as const }
    const importedStateKey = sessionTargetKey(importedBinding)
    // Older packages could explicitly opt into `all-editors`. That policy is
    // retained in the decoder for compatibility, but importing it must not
    // reintroduce local navigation history into a newly shared Workbench.
    // Keep only the declared active editor and leave the rest behind on the
    // publisher. New exports already use `active-editors-only`.
    const sourceEditors = projection.historyPolicy === 'all-editors'
      ? node.editors.filter(editor => editor.key === node.activeEditorKey)
      : node.editors
    if (projection.historyPolicy === 'all-editors' && node.editors.length !== sourceEditors.length) {
      warnings.push(`历史内页已忽略：${node.key}`)
    }
    const moduleHistory = sourceEditors.map(editor => {
      if (editor.availability !== 'available') warnings.push(`editor unavailable: ${editor.editorId}`)
      const catalog = editorCatalog.get(`${editor.scope}:${editor.editorId}`)
      const catalogKnown = options.editors !== undefined && catalog !== undefined
      const restored = !catalogKnown
        ? { state: editor.portableState ?? {}, status: 'raw' as const }
        : restoreWorkbenchPortableState(catalog, editor.portableState, {
          editorId: editor.editorId,
          editorScope: editor.scope,
          moduleInstanceId: ids.moduleInstanceId(editor.key),
          title: editor.label,
          ...(editor.scope === 'session' && importedBinding.detached !== true ? { target: importedBinding } : {}),
        })
      if (restored.warning !== undefined) warnings.push(restored.warning)
      const base = {
        moduleInstanceId: ids.moduleInstanceId(editor.key),
        editorId: editor.editorId,
        editorScope: editor.scope,
        state: restored.state,
        lastKnownTitle: editor.label,
      }
      if (editor.scope !== 'session') return base
      return {
        ...base,
        binding: importedBinding,
        sessionStates: { [importedStateKey]: restored.state },
        sessionStateOrder: [importedStateKey],
        bindingGeneration: 0,
      }
    })
    const activeEditorKey = node.activeEditorKey
    const active = activeEditorKey === undefined
      ? undefined
      : moduleHistory.find(module => module.moduleInstanceId === ids.moduleInstanceId(activeEditorKey))
    return {
      kind: 'area', areaId, moduleHistory,
      ...(active === undefined ? {} : { activeModuleInstanceId: active.moduleInstanceId }),
    }
  }
  const importNode = (node: PortableWorkbenchNodeV1): WorkbenchNodeV3 => {
    if (node.kind === 'area') return importArea(node)
    return {
      kind: 'split', id: ids.splitId(node.key), axis: node.axis, ratio: ratio(node.ratio),
      first: importNode(node.first), second: importNode(node.second),
    }
  }
  const root = importNode(projection.root)
  const activeAreaId = areaIds.get(projection.activeAreaKey) ?? firstAreaId
  if (activeAreaId === undefined) throw new Error('portable Workbench has no Area')
  return { document: { version: 3, root, activeAreaId }, warnings, areaKeyToAreaId: areaIds }
}

function importNameKey(name: string): string {
  return name.trim().normalize('NFKC').toLocaleLowerCase('zh-CN')
}

function uniqueImportedName(base: string, occupied: readonly string[]): string {
  const requested = base.trim() || '导入工作台'
  const used = new Set(occupied.map(importNameKey))
  if (!used.has(importNameKey(requested))) return requested
  for (let index = 2; ; index += 1) {
    const candidate = `${requested} ${String(index)}`
    if (!used.has(importNameKey(candidate))) return candidate
  }
}

/**
 * Prepare a detached imported Workbench record without writing Settings. The
 * new record is deliberately not added to openWorkbenchIds or made active;
 * the caller must make that lifecycle choice through WorkbenchDirectory.
 */
export function prepareImportedWorkbenchSettings(
  current: WorkbenchSettingsV4,
  projection: PortableWorkbenchV1,
  options: {
    workbenchId?: string
    now?: number
    name?: string
    description?: string
    prefix?: string
    editors?: readonly WorkbenchEditorCatalogRow[]
    sessions?: WorkbenchSessionsFileV1
    templateBindings?: WorkbenchSessionTemplateBindingsV1
    packageOrigin?: WorkbenchPackageOriginV1
    context?: PortableWorkbenchContextV1
    bayAgentOrchestration?: PortableBayAgentOrchestrationV1
  } = {},
): WorkbenchImportSettingsResultV1 {
  const workbenchId = options.workbenchId ?? `workbench-${browserSafeUuid()}`
  const importPrefix = options.prefix ?? 'imported-workbench'
  const imported = importPortableWorkbench(projection, {
    prefix: importPrefix,
    detachedSessionId: `${importPrefix}-${workbenchId}-detached-session`,
    ...(options.editors === undefined ? {} : { editors: options.editors }),
    ...(options.sessions === undefined ? {} : { sessions: options.sessions }),
    ...(options.templateBindings === undefined ? {} : { templateBindings: options.templateBindings }),
  })
  if (workbenchId.trim() === '' || current.workbenches[workbenchId] !== undefined || current.invalidWorkbenches[workbenchId] !== undefined) {
    throw new Error(`Workbench id already exists: ${workbenchId}`)
  }
  const now = options.now ?? Date.now()
  const name = uniqueImportedName(options.name ?? projection.name, Object.values(current.workbenches).map(record => record.name))
  const importedAi = workbenchAiFromPortable(projection.modelPreference)
  const record = {
    workbenchId,
    name,
    description: (options.description ?? projection.description).trim(),
    document: imported.document,
    ...(importedAi === undefined ? {} : { workbenchAi: importedAi }),
    ...(options.context === undefined ? {} : (() => {
      const restored = restorePortableWorkbenchContext(options.context, imported.areaKeyToAreaId)
      return restored === undefined ? {} : { context: restored.context, areaContexts: restored.areaContexts, areaMetadata: restored.areaMetadata }
    })()),
    createdAt: now,
    updatedAt: now,
    ...(options.packageOrigin === undefined ? {} : { packageOrigin: structuredClone(options.packageOrigin) }),
    ...(options.bayAgentOrchestration === undefined ? {} : { bayAgentOrchestration: structuredClone(options.bayAgentOrchestration) }),
  }
  return {
    workbenchId,
    warnings: imported.warnings,
    settings: {
      ...structuredClone(current),
      workbenches: { ...structuredClone(current.workbenches), [workbenchId]: record },
      openWorkbenchIds: [...current.openWorkbenchIds],
      activeWorkbenchId: current.activeWorkbenchId,
    },
  }
}

function packageFile(path: string, content: Uint8Array): WorkbenchPackageFileV1 {
  return { path, content: new Uint8Array(content) }
}

const ZIP_LOCAL_FILE_HEADER = 0x04034b50
const ZIP_CENTRAL_DIRECTORY_HEADER = 0x02014b50
const ZIP_END_OF_CENTRAL_DIRECTORY = 0x06054b50
const ZIP_FIXED_DATE = 33 // 1980-01-01 in DOS date format.

function zipU16(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(offset, true)
}

function zipU32(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset, true)
}

function putZipU16(bytes: Uint8Array, offset: number, value: number): void {
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint16(offset, value, true)
}

function putZipU32(bytes: Uint8Array, offset: number, value: number): void {
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint32(offset, value, true)
}

function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.byteLength, 0)
  const result = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    result.set(part, offset)
    offset += part.byteLength
  }
  return result
}

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let index = 0; index < table.length; index += 1) {
    let value = index
    for (let bit = 0; bit < 8; bit += 1) value = (value & 1) === 0 ? value >>> 1 : (value >>> 1) ^ 0xedb88320
    table[index] = value >>> 0
  }
  return table
})()

function crc32(bytes: Uint8Array): number {
  let value = 0xffffffff
  for (const byte of bytes) value = CRC32_TABLE[(value ^ byte) & 0xff]! ^ (value >>> 8)
  return (value ^ 0xffffffff) >>> 0
}

function decodeZipName(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw new Error('ZIP entry name is not valid UTF-8')
  }
}

function zipEntry(path: string, content: Uint8Array): { path: string; content: Uint8Array; crc: number } {
  if (!safePath(path)) throw new Error(`invalid package path: ${path}`)
  if (content.byteLength > 0xffffffff) throw new Error(`package file is too large: ${path}`)
  return { path, content: new Uint8Array(content), crc: crc32(content) }
}

/**
 * Encode stored ZIP entries with sorted paths, fixed timestamps and no
 * platform-dependent metadata. Stored entries are intentional: the package is
 * bounded and integrity-checked, while avoiding a second compression runtime
 * in the browser importer.
 */
export function encodeDeterministicZip(entries: readonly WorkbenchPackageFileV1[]): Uint8Array {
  const normalized = entries.map(entry => zipEntry(entry.path, entry.content))
  const seen = new Set<string>()
  const folded = new Set<string>()
  for (const entry of normalized) {
    if (seen.has(entry.path)) throw new Error(`duplicate package path: ${entry.path}`)
    if (folded.has(entry.path.toLocaleLowerCase('en-US'))) throw new Error(`case-colliding package path: ${entry.path}`)
    seen.add(entry.path)
    folded.add(entry.path.toLocaleLowerCase('en-US'))
  }
  normalized.sort((left, right) => left.path.localeCompare(right.path, 'en'))
  if (normalized.length > 0xffff) throw new Error('too many ZIP entries')
  const localParts: Uint8Array[] = []
  const centralParts: Uint8Array[] = []
  let offset = 0
  for (const entry of normalized) {
    const name = utf8(entry.path)
    if (name.byteLength > 0xffff) throw new Error(`ZIP entry name is too long: ${entry.path}`)
    const local = new Uint8Array(30 + name.byteLength + entry.content.byteLength)
    putZipU32(local, 0, ZIP_LOCAL_FILE_HEADER)
    putZipU16(local, 4, 20)
    putZipU16(local, 6, 0x800)
    putZipU16(local, 8, 0)
    putZipU16(local, 10, 0)
    putZipU16(local, 12, ZIP_FIXED_DATE)
    putZipU32(local, 14, entry.crc)
    putZipU32(local, 18, entry.content.byteLength)
    putZipU32(local, 22, entry.content.byteLength)
    putZipU16(local, 26, name.byteLength)
    local.set(name, 30)
    local.set(entry.content, 30 + name.byteLength)
    localParts.push(local)

    const central = new Uint8Array(46 + name.byteLength)
    putZipU32(central, 0, ZIP_CENTRAL_DIRECTORY_HEADER)
    putZipU16(central, 4, 20)
    putZipU16(central, 6, 20)
    putZipU16(central, 8, 0x800)
    putZipU16(central, 10, 0)
    putZipU16(central, 12, 0)
    putZipU16(central, 14, ZIP_FIXED_DATE)
    putZipU32(central, 16, entry.crc)
    putZipU32(central, 20, entry.content.byteLength)
    putZipU32(central, 24, entry.content.byteLength)
    putZipU16(central, 28, name.byteLength)
    putZipU16(central, 30, 0)
    putZipU16(central, 32, 0)
    putZipU16(central, 34, 0)
    putZipU32(central, 36, 0)
    putZipU32(central, 42, offset)
    central.set(name, 46)
    centralParts.push(central)
    offset += local.byteLength
  }
  const localBytes = concatBytes(localParts)
  const centralBytes = concatBytes(centralParts)
  if (localBytes.byteLength > 0xffffffff || centralBytes.byteLength > 0xffffffff) throw new Error('ZIP archive is too large')
  const end = new Uint8Array(22)
  putZipU32(end, 0, ZIP_END_OF_CENTRAL_DIRECTORY)
  putZipU16(end, 4, 0)
  putZipU16(end, 6, 0)
  putZipU16(end, 8, normalized.length)
  putZipU16(end, 10, normalized.length)
  putZipU32(end, 12, centralBytes.byteLength)
  putZipU32(end, 16, localBytes.byteLength)
  putZipU16(end, 20, 0)
  return concatBytes([localBytes, centralBytes, end])
}

function zipEndOffset(bytes: Uint8Array): number {
  if (bytes.byteLength < 22) throw new Error('ZIP end of central directory is missing')
  const first = Math.max(0, bytes.byteLength - 0xffff - 22)
  for (let offset = bytes.byteLength - 22; offset >= first; offset -= 1) {
    if (zipU32(bytes, offset) === ZIP_END_OF_CENTRAL_DIRECTORY) return offset
  }
  throw new Error('ZIP end of central directory is missing')
}

/** Decode a bounded stored-entry ZIP archive without executing any payload. */
export function decodeDeterministicZip(
  bytes: Uint8Array,
  limits: WorkbenchPackageArchiveLimitsV1 = DEFAULT_WORKBENCH_PACKAGE_ARCHIVE_LIMITS,
): readonly WorkbenchPackageFileV1[] {
  if (bytes.byteLength > limits.maxTotalBytes) throw new Error('ZIP archive exceeds size limit')
  const endOffset = zipEndOffset(bytes)
  const count = zipU16(bytes, endOffset + 10)
  const centralSize = zipU32(bytes, endOffset + 12)
  const centralOffset = zipU32(bytes, endOffset + 16)
  if (count > limits.maxEntries || centralOffset + centralSize > endOffset) throw new Error('ZIP central directory is invalid')
  const files: WorkbenchPackageFileV1[] = []
  const seen = new Set<string>()
  const folded = new Set<string>()
  let cursor = centralOffset
  let total = 0
  for (let index = 0; index < count; index += 1) {
    if (cursor + 46 > endOffset || zipU32(bytes, cursor) !== ZIP_CENTRAL_DIRECTORY_HEADER) throw new Error('ZIP central entry is invalid')
    const flags = zipU16(bytes, cursor + 8)
    const method = zipU16(bytes, cursor + 10)
    const crc = zipU32(bytes, cursor + 16)
    const compressedSize = zipU32(bytes, cursor + 20)
    const uncompressedSize = zipU32(bytes, cursor + 24)
    const nameSize = zipU16(bytes, cursor + 28)
    const extraSize = zipU16(bytes, cursor + 30)
    const commentSize = zipU16(bytes, cursor + 32)
    const localOffset = zipU32(bytes, cursor + 42)
    const nameEnd = cursor + 46 + nameSize
    if (nameEnd + extraSize + commentSize > endOffset) throw new Error('ZIP central entry exceeds archive')
    const path = decodeZipName(bytes.slice(cursor + 46, nameEnd))
    if (!safePath(path) || path.endsWith('/')) throw new Error(`unsafe ZIP entry path: ${path}`)
    if (seen.has(path)) throw new Error(`duplicate ZIP entry: ${path}`)
    if (folded.has(path.toLocaleLowerCase('en-US'))) throw new Error(`case-colliding ZIP entry: ${path}`)
    if ((flags & 0x1) !== 0 || (flags & 0x8) !== 0 || method !== 0) throw new Error(`unsupported ZIP entry: ${path}`)
    if (uncompressedSize !== compressedSize || uncompressedSize > limits.maxFileBytes) throw new Error(`ZIP entry exceeds size limit: ${path}`)
    if (localOffset + 30 > endOffset || zipU32(bytes, localOffset) !== ZIP_LOCAL_FILE_HEADER) throw new Error(`ZIP local entry is invalid: ${path}`)
    const localNameSize = zipU16(bytes, localOffset + 26)
    const localExtraSize = zipU16(bytes, localOffset + 28)
    const localName = decodeZipName(bytes.slice(localOffset + 30, localOffset + 30 + localNameSize))
    const dataStart = localOffset + 30 + localNameSize + localExtraSize
    const dataEnd = dataStart + compressedSize
    if (localName !== path || dataEnd > endOffset || dataEnd > centralOffset) throw new Error(`ZIP local payload is invalid: ${path}`)
    const content = bytes.slice(dataStart, dataEnd)
    if (crc32(content) !== crc) throw new Error(`ZIP CRC mismatch: ${path}`)
    total += content.byteLength
    if (total > limits.maxTotalBytes) throw new Error('ZIP payload exceeds total size limit')
    files.push({ path, content: new Uint8Array(content) })
    seen.add(path)
    folded.add(path.toLocaleLowerCase('en-US'))
    cursor = nameEnd + extraSize + commentSize
  }
  if (cursor !== centralOffset + centralSize) throw new Error('ZIP central directory size mismatch')
  return files
}

/** Build the complete deterministic archive, including the manifest entry. */
export async function encodeWorkbenchPackageArchive(pkg: BuiltWorkbenchPackageV1): Promise<Uint8Array> {
  const manifest = packageFile('manifest.json', utf8(canonicalJson(pkg.manifest)))
  return encodeDeterministicZip([manifest, ...pkg.files])
}

/** Decode, validate and expose only the manifest's declared payload files. */
export async function decodeWorkbenchPackageArchive(
  bytes: Uint8Array,
  limits: WorkbenchPackageArchiveLimitsV1 = DEFAULT_WORKBENCH_PACKAGE_ARCHIVE_LIMITS,
): Promise<DecodedWorkbenchPackageArchiveV1> {
  const entries = decodeDeterministicZip(bytes, limits)
  const manifestEntry = entries.find(entry => entry.path === 'manifest.json')
  if (manifestEntry === undefined) throw new Error('manifest.json is missing')
  let manifest: unknown
  try {
    manifest = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(manifestEntry.content))
  } catch {
    throw new Error('manifest.json is not valid UTF-8 JSON')
  }
  const files = entries.filter(entry => entry.path !== 'manifest.json')
  const validation = await validateWorkbenchPackage(manifest, files)
  if (!validation.valid) throw new Error(`invalid Workbench package: ${validation.errors.join('; ')}`)
  return { manifest: manifest as WorkbenchPackageManifestV1, files }
}

/** Build deterministic payload files and a hash-indexed package manifest. */
export async function buildWorkbenchPackage(input: WorkbenchPackageBuildInputV1): Promise<BuiltWorkbenchPackageV1> {
  const projection = projectWorkbenchForSharing(input)
  // `artifactPath` is a local/embedded transport detail.  The same scanner
  // can report an embedded artifact while the caller explicitly asks for an
  // online-reference package (because this machine happens to have the
  // package installed). Normalize the lock at the final package boundary so
  // direct callers cannot emit an online archive that points at omitted bytes.
  const dependencySnapshot = input.distributionMode === 'online-reference' && input.dependencySnapshot !== undefined
    ? {
        ...input.dependencySnapshot,
        dependencies: input.dependencySnapshot.dependencies.map(({ artifactPath: _artifactPath, ...dependency }) => dependency),
      }
    : input.dependencySnapshot
  if (input.distributionMode === 'offline-embedded' && dependencySnapshot !== undefined
    && dependencySnapshot.completeness !== 'complete-offline') {
    throw new Error('offline export requires complete-offline dependency snapshot')
  }
  const npmArtifactsByPortableId = new Map((input.npmArtifacts ?? []).map(artifact => [artifact.portableId, artifact]))
  const dependencyLock = (dependencySnapshot?.dependencies ?? []).map(dependency => {
    const npmArtifact = npmArtifactsByPortableId.get(dependency.portableId)
    return npmArtifact === undefined ? dependency : {
      ...dependency,
      npmArtifactPath: `npm-artifacts/${npmArtifact.digest.toLocaleLowerCase('en-US')}.tgz`,
      integrity: npmArtifact.integrity,
    }
  })
  const npmDependencies: WorkbenchNpmDependenciesFileV1 = {
    schemaVersion: 1,
    packageManager: 'pnpm',
    dependencies: dependencyLock
      .filter(dependency => dependency.packageName !== undefined)
      .map(dependency => ({
        portableId: dependency.portableId,
        packageName: dependency.packageName!,
        version: dependency.version,
        digest: dependency.digest,
        ...(dependency.integrity === undefined ? {} : { integrity: dependency.integrity }),
        ...(dependency.registryUrl === undefined ? {} : { registryUrl: dependency.registryUrl }),
        requiredBy: [...dependency.requiredBy],
      }))
      .sort((left, right) => left.packageName.localeCompare(right.packageName, 'en') || left.version.localeCompare(right.version, 'en')),
  }
  const sessions: WorkbenchSessionsFileV1 = input.sessions
    ?? projectWorkbenchSessionsForSharing(input.document, input.sessionTemplateResolver)
  const files: WorkbenchPackageFileV1[] = [
    packageFile('workbench.json', utf8(canonicalJson(projection))),
    packageFile('dependencies.lock.json', utf8(canonicalJson(dependencyLock))),
    packageFile('dependencies.npm.json', utf8(canonicalJson(npmDependencies))),
    packageFile('sessions.json', utf8(canonicalJson(sessions))),
  ]
  if (projection.context !== undefined) {
    files.push(packageFile('context.json', utf8(canonicalJson(projection.context))))
    files.push(packageFile('context/工作台整体背景说明.md', utf8(renderPortableWorkbenchContextMarkdown(projection.context))))
    for (const areaKey of Object.keys(projection.context.areas).sort()) {
      files.push(packageFile(`context/areas/${areaKey}-区域说明.md`, utf8(renderPortableAreaContextMarkdown(projection.context, areaKey))))
    }
  }
  if (projection.orchestration !== undefined) files.push(packageFile('orchestration.json', utf8(canonicalJson(projection.orchestration))))
  const contextDigest = projection.context === undefined ? undefined : await sha256Hex(utf8(canonicalJson(projection.context)))
  if (input.previewSvg !== undefined) files.push(packageFile('preview.svg', utf8(input.previewSvg)))
  if (input.preview !== undefined) files.push(packageFile('preview.json', utf8(canonicalJson(input.preview))))
  if (input.signature !== undefined) files.push(packageFile('signature.json', utf8(canonicalJson(input.signature))))
  for (const plugin of input.plugins ?? []) {
    files.push(packageFile(plugin.manifest.manifestPath, utf8(canonicalJson(plugin.manifest))))
    files.push(...plugin.files.map(file => packageFile(file.path, file.content)))
  }
  const artifactsByDigest = new Map<string, NonNullable<WorkbenchPackageBuildInputV1['artifacts']>[number]>()
  for (const artifact of input.artifacts ?? []) {
    if (!/^[a-f0-9]{32,128}$/iu.test(artifact.digest)) throw new Error(`invalid artifact digest: ${artifact.digest}`)
    const digest = artifact.digest.toLocaleLowerCase('en-US')
    if (!artifactsByDigest.has(digest)) artifactsByDigest.set(digest, artifact)
  }
  for (const artifact of artifactsByDigest.values()) {
    const digest = artifact.digest.toLocaleLowerCase('en-US')
    const prefix = `artifacts/${digest}/`
    const record = { path: `${prefix}artifact.json`, content: new TextEncoder().encode(canonicalJson({ ...(artifact.record ?? {}), digest })) }
    files.push(packageFile(record.path, record.content))
    for (const file of artifact.files) {
      const path = file.path.startsWith(prefix) ? file.path : `${prefix}${file.path.replace(/^\/+/, '')}`
      files.push(packageFile(path, file.content))
    }
  }
  for (const artifact of input.npmArtifacts ?? []) {
    if (!/^[a-f0-9]{64}$/iu.test(artifact.digest)) throw new Error(`invalid npm artifact digest: ${artifact.portableId}`)
    if (!/^sha512-[A-Za-z0-9+/]+={0,2}$/u.test(artifact.integrity)) throw new Error(`invalid npm artifact integrity: ${artifact.portableId}`)
    files.push(packageFile(`npm-artifacts/${artifact.digest.toLocaleLowerCase('en-US')}.tgz`, artifact.tarball))
  }
  if (dependencySnapshot?.completeness === 'complete-offline') {
    const embeddedDigests = new Set((input.artifacts ?? []).map(artifact => artifact.digest.toLocaleLowerCase('en-US')))
    for (const dependency of dependencyLock) {
      if (dependency.digest === '' || dependency.exportPolicy !== 'embed' || !embeddedDigests.has(dependency.digest.toLocaleLowerCase('en-US'))) {
        throw new Error(`complete-offline export is missing embedded artifact: ${dependency.portableId}`)
      }
      if (dependency.packageName !== undefined && dependency.npmArtifactPath === undefined) {
        throw new Error(`complete-offline export is missing npm tarball: ${dependency.portableId}`)
      }
    }
  }
  const unique = new Set<string>()
  const caseFolded = new Set<string>()
  for (const file of files) {
    if (!safePath(file.path)) throw new Error(`invalid package path: ${file.path}`)
    if (unique.has(file.path)) throw new Error(`duplicate package path: ${file.path}`)
    const folded = file.path.toLocaleLowerCase('en-US')
    if (caseFolded.has(folded)) throw new Error(`case-colliding package path: ${file.path}`)
    unique.add(file.path)
    caseFolded.add(folded)
  }
  files.sort((left, right) => left.path.localeCompare(right.path, 'en'))
  const records: WorkbenchPackageFileRecordV1[] = []
  for (const file of files) records.push({ path: file.path, size: file.content.byteLength, sha256: await sha256Hex(file.content) })
  const pluginManifests = (input.plugins ?? []).map(plugin => structuredClone(plugin.manifest))
    .sort((left, right) => left.packageId.localeCompare(right.packageId, 'en'))
  const permissions = [...new Set([
    ...pluginManifests.flatMap(plugin => plugin.permissions),
    ...(dependencySnapshot?.permissions ?? []),
  ])].sort()
  return {
    projection,
    files,
    manifest: {
      schemaVersion: WORKBENCH_PACKAGE_SCHEMA_VERSION,
      format: 'dsh-workbench-package', packageId: input.packageId,
      name: input.name, description: input.description ?? '', version: input.version,
      createdAt: input.createdAt, bindingPolicy: 'detached',
      completeness: dependencySnapshot?.completeness ?? 'layout-only',
      distributionMode: input.distributionMode ?? (dependencySnapshot?.completeness === 'complete-offline' ? 'offline-embedded' : 'online-reference'),
      workbenchPath: 'workbench.json', dependencyLockPath: 'dependencies.lock.json', npmDependenciesPath: 'dependencies.npm.json', sessionsPath: 'sessions.json',
      ...(projection.context === undefined ? {} : { contextPath: 'context.json' as const, contextPolicy: projection.context.policy }),
      ...(projection.orchestration === undefined ? {} : { orchestrationPath: 'orchestration.json' as const }),
      ...(contextDigest === undefined ? {} : { contextDigest }),
      ...(input.previewSvg === undefined ? {} : { previewPath: 'preview.svg' as const }),
      ...(input.preview === undefined ? {} : { previewDocumentPath: 'preview.json' as const }),
      ...(input.signature === undefined ? {} : { signaturePath: 'signature.json' as const }),
      compatibility: structuredClone(input.compatibility), plugins: pluginManifests,
      permissions, files: records,
      baseRuntime: structuredClone(input.baseRuntime ?? {
        runtimeId: 'dsh-web', version: input.compatibility.dsh.minimum, providedCapabilities: [],
      }),
      ...(input.publisher === undefined ? {} : { publisher: structuredClone(input.publisher) }),
      ...(input.derivedFrom === undefined ? {} : { derivedFrom: structuredClone(input.derivedFrom) }),
    },
  }
}

function isRecord(value: unknown): value is PlainRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function validDependencyRegistryUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.trim() === '') return false
  try {
    const url = new URL(value)
    return url.protocol === 'https:'
      || (url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]'))
  } catch {
    return false
  }
}

function validProjection(value: unknown): value is PortableWorkbenchV1 {
  if (!isRecord(value) || value.schemaVersion !== 1 || value.format !== 'dsh-portable-workbench'
    || typeof value.name !== 'string' || typeof value.description !== 'string'
    || value.bindingPolicy !== 'detached' || (value.historyPolicy !== 'active-editors-only' && value.historyPolicy !== 'all-editors')
    || (value.statePolicy !== 'none' && value.statePolicy !== 'sanitized' && value.statePolicy !== 'full')
    || typeof value.activeAreaKey !== 'string') return false
  if (value.modelPreference !== undefined && (!isRecord(value.modelPreference)
    || Object.keys(value.modelPreference).some(key => !['provider', 'model', 'label', 'reasoningEffort'].includes(key))
    || Object.values(value.modelPreference).some(item => item !== undefined && (typeof item !== 'string' || item.length > 256)))) return false
  if (value.orchestration !== undefined) {
    try { validatePortableBayAgentOrchestration(value.orchestration) } catch { return false }
  }
  const areaKeys = new Set<string>()
  const visit = (node: unknown): boolean => {
    if (!isRecord(node) || typeof node.key !== 'string') return false
    if (node.kind === 'split') {
      return (node.axis === 'horizontal' || node.axis === 'vertical') && typeof node.ratio === 'number'
        && visit(node.first) && visit(node.second)
    }
    if (node.kind !== 'area' || typeof node.ordinal !== 'number' || !Array.isArray(node.editors)) return false
    if (areaKeys.has(node.key)) return false
    areaKeys.add(node.key)
    return node.editors.every(editor => isRecord(editor) && typeof editor.key === 'string'
      && typeof editor.editorId === 'string' && (editor.scope === 'root' || editor.scope === 'session')
      && typeof editor.label === 'string' && (editor.availability === 'available' || editor.availability === 'missing' || editor.availability === 'unresolved')
      && (editor.portableState === null || editor.portableState === undefined || isJsonValue(editor.portableState)))
  }
  if (value.context !== undefined) {
    try { validatePortableWorkbenchContext(value.context) } catch { return false }
  }
  return visit(value.root) && areaKeys.has(value.activeAreaKey)
}

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (Array.isArray(value)) return value.every(isJsonValue)
  return isRecord(value) && Object.values(value).every(isJsonValue)
}

/** Validate package structure and payload hashes without executing plugin code. */
export async function validateWorkbenchPackage(
  manifest: unknown,
  files: readonly WorkbenchPackageFileV1[],
): Promise<WorkbenchPackageValidationResultV1> {
  const errors: string[] = []
  if (!isRecord(manifest) || (manifest.schemaVersion !== 1 && manifest.schemaVersion !== 2) || manifest.format !== 'dsh-workbench-package') {
    return { valid: false, errors: ['unsupported package manifest'] }
  }
  const schemaVersion = manifest.schemaVersion
  for (const field of ['packageId', 'name', 'version', 'createdAt', 'workbenchPath']) {
    if (typeof manifest[field] !== 'string' || manifest[field] === '') errors.push(`manifest.${field} is required`)
  }
  const records = manifest.files
  if (!Array.isArray(records)) errors.push('manifest.files is required')
  const byPath = new Map(files.map(file => [file.path, file]))
  const seen = new Set<string>()
  const caseFolded = new Set<string>()
  if (byPath.size !== files.length) errors.push('duplicate payload path')
  for (const file of files) {
    if (!safePath(file.path)) errors.push(`unsafe payload path: ${file.path}`)
    const folded = file.path.toLocaleLowerCase('en-US')
    if (caseFolded.has(folded)) errors.push(`case-colliding payload path: ${file.path}`)
    caseFolded.add(folded)
  }
  if (Array.isArray(records)) {
    for (const record of records) {
      if (!isRecord(record) || typeof record.path !== 'string' || !safePath(record.path)
        || typeof record.size !== 'number' || typeof record.sha256 !== 'string') {
        errors.push('invalid file record')
        continue
      }
      if (seen.has(record.path)) errors.push(`duplicate manifest path: ${record.path}`)
      seen.add(record.path)
      const file = byPath.get(record.path)
      if (file === undefined) {
        errors.push(`missing file: ${record.path}`)
        continue
      }
      if (file.content.byteLength !== record.size) errors.push(`size mismatch: ${record.path}`)
      if (await sha256Hex(file.content) !== record.sha256) errors.push(`hash mismatch: ${record.path}`)
    }
    for (const path of byPath.keys()) {
      if (!seen.has(path)) errors.push(`unlisted payload file: ${path}`)
    }
  }
  if (manifest.derivedFrom !== undefined && (!isRecord(manifest.derivedFrom)
    || typeof manifest.derivedFrom.packageId !== 'string' || manifest.derivedFrom.packageId.trim() === ''
    || typeof manifest.derivedFrom.version !== 'string' || manifest.derivedFrom.version.trim() === ''
    || typeof manifest.derivedFrom.archiveSha256 !== 'string'
    || !/^[a-f0-9]{64}$/iu.test(manifest.derivedFrom.archiveSha256))) {
    errors.push('manifest.derivedFrom is invalid')
  }
  let decodedProjection: PortableWorkbenchV1 | undefined
  const workbench = byPath.get('workbench.json')
  if (workbench === undefined) errors.push('workbench.json is missing')
  else {
    try {
      const decoded: unknown = JSON.parse(new TextDecoder().decode(workbench.content))
      if (!validProjection(decoded)) errors.push('workbench.json is not a valid portable projection')
      else decodedProjection = decoded
    } catch { errors.push('workbench.json is not valid UTF-8 JSON') }
  }
  if (schemaVersion === 2) {
    for (const required of ['dependencies.lock.json', 'sessions.json']) {
      if (!byPath.has(required)) errors.push(`${required} is missing`)
    }
    if (manifest.dependencyLockPath !== 'dependencies.lock.json') errors.push('manifest.dependencyLockPath is required for schema v2')
    if (manifest.npmDependenciesPath !== undefined && manifest.npmDependenciesPath !== 'dependencies.npm.json') errors.push('manifest.npmDependenciesPath is invalid')
    if (manifest.npmDependenciesPath === 'dependencies.npm.json' && !byPath.has('dependencies.npm.json')) errors.push('dependencies.npm.json is missing')
    if (manifest.sessionsPath !== 'sessions.json') errors.push('manifest.sessionsPath is required for schema v2')
    if (manifest.contextPath !== undefined && manifest.contextPath !== 'context.json') errors.push('manifest.contextPath is invalid')
    if (manifest.contextPolicy !== undefined && manifest.contextPolicy !== 'human' && manifest.contextPolicy !== 'handoff') errors.push('manifest.contextPolicy is invalid')
    if (manifest.contextDigest !== undefined && (typeof manifest.contextDigest !== 'string' || !/^[A-Fa-f0-9]{64}$/u.test(manifest.contextDigest))) errors.push('manifest.contextDigest is invalid')
    if (manifest.orchestrationPath !== undefined && manifest.orchestrationPath !== 'orchestration.json') errors.push('manifest.orchestrationPath is invalid')
    if (manifest.orchestrationPath !== undefined && !byPath.has('orchestration.json')) errors.push('orchestration.json is missing')
    if (manifest.orchestrationPath === undefined && byPath.has('orchestration.json')) errors.push('orchestration.json requires manifest.orchestrationPath')
    if (manifest.contextPath !== undefined && !byPath.has('context.json')) errors.push('context.json is missing')
    if (manifest.contextPath === undefined && byPath.has('context.json')) errors.push('context.json requires manifest.contextPath')
    if (manifest.signaturePath !== undefined && manifest.signaturePath !== 'signature.json') errors.push('manifest.signaturePath is invalid')
    if (manifest.signaturePath !== undefined && !byPath.has('signature.json')) errors.push('signature.json is missing')
    if (manifest.completeness !== 'layout-only' && manifest.completeness !== 'complete-online' && manifest.completeness !== 'complete-offline') {
      errors.push('manifest.completeness is invalid for schema v2')
    }
    if (manifest.distributionMode !== 'online-reference' && manifest.distributionMode !== 'offline-embedded') {
      errors.push('manifest.distributionMode is invalid for schema v2')
    }
    if (manifest.completeness === 'complete-offline' && manifest.distributionMode !== 'offline-embedded') {
      errors.push('complete-offline package must use offline-embedded distribution mode')
    }
    if (manifest.completeness === 'complete-online' && manifest.distributionMode !== 'online-reference') {
      errors.push('complete-online package must use online-reference distribution mode')
    }
    if (manifest.baseRuntime !== undefined && (!isRecord(manifest.baseRuntime)
      || typeof manifest.baseRuntime.runtimeId !== 'string' || typeof manifest.baseRuntime.version !== 'string'
      || !Array.isArray(manifest.baseRuntime.providedCapabilities))) {
      errors.push('manifest.baseRuntime is invalid for schema v2')
    }
    const contextFile = byPath.get('context.json')
    if (decodedProjection?.context !== undefined && manifest.contextPath !== 'context.json') errors.push('workbench.json Context requires manifest.contextPath')
    if (contextFile !== undefined) {
      try {
        const context = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(contextFile.content)) as unknown
        validatePortableWorkbenchContext(context)
        if (decodedProjection?.context === undefined || canonicalJson(decodedProjection.context) !== canonicalJson(context)) errors.push('context.json does not match workbench.json')
        if (manifest.contextPolicy !== context.policy) errors.push('manifest.contextPolicy does not match context.json')
        if (manifest.contextDigest !== await sha256Hex(new TextEncoder().encode(canonicalJson(context)))) errors.push('manifest.contextDigest does not match context.json')
        const markdown = byPath.get('context/工作台整体背景说明.md')
        if (markdown === undefined || new TextDecoder('utf-8', { fatal: true }).decode(markdown.content) !== renderPortableWorkbenchContextMarkdown(context)) errors.push('Workbench Context Markdown projection is missing or stale')
        for (const areaKey of Object.keys(context.areas)) {
          const areaMarkdown = byPath.get(`context/areas/${areaKey}-区域说明.md`)
          if (areaMarkdown === undefined || new TextDecoder('utf-8', { fatal: true }).decode(areaMarkdown.content) !== renderPortableAreaContextMarkdown(context, areaKey)) errors.push(`Area Context Markdown projection is missing or stale: ${areaKey}`)
        }
      } catch { errors.push('context.json is invalid') }
    }
    const orchestrationFile = byPath.get('orchestration.json')
    if (orchestrationFile !== undefined) {
      try {
        const orchestration = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(orchestrationFile.content)) as unknown
        validatePortableBayAgentOrchestration(orchestration)
        if (decodedProjection?.orchestration === undefined || canonicalJson(decodedProjection.orchestration) !== canonicalJson(orchestration)) errors.push('orchestration.json does not match workbench.json')
      } catch { errors.push('orchestration.json is invalid') }
    }
    const lock = byPath.get('dependencies.lock.json')
    if (lock !== undefined) {
      try {
        const decoded: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(lock.content))
        if (!Array.isArray(decoded) || !decoded.every(item => isRecord(item)
          && typeof item.portableId === 'string' && typeof item.version === 'string' && typeof item.digest === 'string'
          && (item.kind === 'static' || item.kind === 'dynamic' || item.kind === 'shared' || item.kind === 'agent-preset')
          && (item.sourcePolicy === 'source-included' || item.sourcePolicy === 'binary-only' || item.sourcePolicy === 'remote')
          && (item.exportPolicy === 'embed' || item.exportPolicy === 'reference' || item.exportPolicy === 'forbid')
          && Array.isArray(item.editorIds) && item.editorIds.every(id => typeof id === 'string')
          && Array.isArray(item.requiredBy) && item.requiredBy.every(id => typeof id === 'string')
          && Array.isArray(item.permissions) && item.permissions.every(permission => typeof permission === 'string'))) {
          errors.push('dependencies.lock.json is invalid')
        } else {
          const lockRows = decoded as PlainRecord[]
          const lockIds = new Set<string>()
          for (const row of lockRows) {
            const portableId = String(row.portableId)
            const digest = typeof row.digest === 'string' ? row.digest : ''
            if (lockIds.has(portableId)) errors.push(`duplicate dependency lock: ${portableId}`)
            lockIds.add(portableId)
            if (row.kind === 'agent-preset' && (typeof row.agentPresetId !== 'string' || row.agentPresetId.trim() === '')) {
              errors.push(`agent preset dependency has no preset id: ${portableId}`)
            }
            if (digest !== '' && !/^[a-f0-9]{64}$/iu.test(digest)) {
              errors.push(`dependency digest is not SHA-256: ${portableId}`)
            }
            if (row.packageName !== undefined
              && (typeof row.packageName !== 'string' || row.packageName.length === 0 || row.packageName.length > 214
                || /\s/u.test(row.packageName)
                || !(/^[a-z0-9._~-]+$/u.test(row.packageName)
                  || /^@[a-z0-9._~-]+\/[a-z0-9._~-]+$/u.test(row.packageName)))) {
              errors.push(`dependency npm package name is invalid: ${portableId}`)
            }
            if (row.integrity !== undefined
              && (typeof row.integrity !== 'string' || !/^(?:sha512|sha256)-[A-Za-z0-9+/]+={0,2}$/u.test(row.integrity))) {
              errors.push(`dependency npm integrity is invalid: ${portableId}`)
            }
            if (row.installSource !== undefined
              && !['npm', 'registry', 'embedded', 'local'].includes(row.installSource as string)) {
              errors.push(`dependency install source is invalid: ${portableId}`)
            }
            if ((row.installSource === 'npm' || row.installSource === 'registry')
              && (row.artifactPath === undefined || manifest.completeness === 'complete-online')
              && (typeof row.packageName !== 'string' || typeof row.registryUrl !== 'string')) {
              errors.push(`Profile dependency requires packageName and registryUrl: ${portableId}`)
            }
            if ((row.installSource === 'npm' || row.installSource === 'registry')
              && (row.artifactPath === undefined || manifest.completeness === 'complete-online')
              && (typeof row.integrity !== 'string' || !/^(?:sha512|sha256)-[A-Za-z0-9+/]+={0,2}$/u.test(row.integrity))) {
              errors.push(`Profile dependency requires integrity: ${portableId}`)
            }
            if (manifest.completeness === 'complete-offline'
              && (digest === '' || row.exportPolicy !== 'embed' || typeof row.artifactPath !== 'string')) {
              errors.push(`offline dependency is not embedded: ${portableId}`)
            }
            if (manifest.completeness === 'complete-online' && digest === '') {
              errors.push(`online dependency is not digest locked: ${portableId}`)
            }
            if (manifest.completeness === 'complete-online' && row.artifactPath !== undefined) {
              errors.push(`online dependency must not reference an embedded artifact: ${portableId}`)
            }
            if (manifest.completeness === 'complete-online' && typeof row.registryUrl !== 'string') {
              errors.push(`online dependency has no recipient Registry reference: ${portableId}`)
            }
            if (manifest.completeness === 'complete-online'
              && row.installSource !== 'npm' && row.installSource !== 'registry') {
              errors.push(`online dependency has no Profile install source: ${portableId}`)
            }
            if (manifest.distributionMode === 'offline-embedded' && row.exportPolicy === 'forbid') {
              errors.push(`forbidden dependency in offline package: ${portableId}`)
            }
            if (manifest.completeness !== 'layout-only' && row.exportPolicy === 'forbid') {
              errors.push(`forbidden dependency in complete package: ${portableId}`)
            }
            if (typeof row.artifactPath === 'string' && !byPath.has(row.artifactPath)) {
              errors.push(`missing dependency artifact: ${row.artifactPath}`)
            }
            if (typeof row.npmArtifactPath === 'string') {
              const npmArtifact = byPath.get(row.npmArtifactPath)
              if (npmArtifact === undefined) errors.push(`missing npm artifact: ${row.npmArtifactPath}`)
              else if (typeof row.integrity === 'string') {
                try {
                  const actual = await sha512Integrity(npmArtifact.content)
                  if (actual !== row.integrity) errors.push(`npm artifact integrity mismatch: ${portableId}`)
                } catch { errors.push(`npm artifact integrity could not be verified: ${portableId}`) }
              }
            }
            if (manifest.completeness === 'complete-offline'
              && (row.installSource === 'npm' || row.installSource === 'registry')
              && typeof row.npmArtifactPath !== 'string') {
              errors.push(`offline npm dependency has no embedded tarball: ${portableId}`)
            }
            if (typeof row.artifactPath === 'string' && /^[a-f0-9]{64}$/iu.test(digest)) {
              const expectedPath = `artifacts/${digest}/artifact.json`
              if (row.artifactPath !== expectedPath) {
                errors.push(`dependency artifact path is not content-addressed: ${portableId}`)
              } else {
                const artifactRecord = byPath.get(row.artifactPath)
                let decodedRecord: PlainRecord | undefined
                try {
                  const decoded: unknown = artifactRecord === undefined
                    ? undefined
                    : JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(artifactRecord.content))
                  decodedRecord = isRecord(decoded) ? decoded : undefined
                  const recordForComparison: PlainRecord = decodedRecord ?? {}
                  if (!isRecord(decodedRecord) || recordForComparison.digest !== digest
                    || recordForComparison.portableId !== row.portableId
                    || recordForComparison.version !== row.version
                    || recordForComparison.sourcePolicy !== row.sourcePolicy
                    || (row.clientEntry !== undefined && recordForComparison.clientEntry !== row.clientEntry)
                    || (row.hostEntry !== undefined && recordForComparison.hostEntry !== row.hostEntry)
                    || !Array.isArray(recordForComparison.editorIds)
                    || recordForComparison.editorIds.length !== (row.editorIds as string[]).length
                    || !(row.editorIds as string[]).every(editorId => (recordForComparison.editorIds as unknown[]).includes(editorId))
                    || !Array.isArray(recordForComparison.permissions)
                    || [...new Set(recordForComparison.permissions.map(String))].sort().join('\u0000')
                      !== [...new Set((row.permissions as string[]).map(String))].sort().join('\u0000')) {
                    errors.push(`dependency artifact record does not match dependency lock: ${portableId}`)
                  }
                  if (row.kind === 'dynamic'
                    && (typeof recordForComparison.name !== 'string' || recordForComparison.name.trim() === ''
                      || typeof recordForComparison.purpose !== 'string' || recordForComparison.purpose.trim() === '')) {
                    errors.push(`dynamic dependency artifact is missing immutable name/purpose: ${portableId}`)
                  }
                } catch {
                  errors.push(`dependency artifact record is not valid JSON: ${portableId}`)
                }
                const prefix = `artifacts/${digest}/`
                const payload = files.filter(file => file.path.startsWith(prefix) && file.path !== row.artifactPath)
                  .map(file => ({ path: file.path.slice(prefix.length), content: file.content }))
                  .sort((left, right) => left.path.localeCompare(right.path, 'en'))
                const payloadSize = payload.reduce((total, file) => total + file.content.byteLength, 0)
                const recordSize = isRecord(decodedRecord) && typeof decodedRecord.size === 'number' ? decodedRecord.size : undefined
                if (recordSize !== payloadSize) {
                  errors.push(`dependency artifact record size mismatch: ${portableId}`)
                }
                const canonicalDigest = payload.length === 0
                  ? undefined
                  : (await sha256Hex(canonicalArtifactBytes(payload))).toUpperCase()
                // Packages created before framed artifact digests were
                // introduced used a simple concatenation. Keep that read
                // compatibility, but always prefer and emit the canonical
                // path+length framed digest for new packages.
                const legacyBytes = new Uint8Array(payload.reduce((total, file) => total + file.content.byteLength, 0))
                let legacyOffset = 0
                for (const file of payload) {
                  legacyBytes.set(file.content, legacyOffset)
                  legacyOffset += file.content.byteLength
                }
                const legacyDigest = payload.length === 0 ? undefined : (await sha256Hex(legacyBytes)).toUpperCase()
                if (payload.length === 0
                  || (canonicalDigest !== digest.toUpperCase() && legacyDigest !== digest.toUpperCase())) {
                  errors.push(`dependency artifact content digest mismatch: ${portableId}`)
                }
              }
            }
            if (row.registryUrl !== undefined && !validDependencyRegistryUrl(row.registryUrl)) {
              errors.push(`dependency registry URL is invalid: ${portableId}`)
            }
            if (row.sourcePolicy === 'remote' && typeof row.registryUrl !== 'string') {
              errors.push(`remote dependency has no registry URL: ${portableId}`)
            }
          }
          const npmFile = byPath.get('dependencies.npm.json')
          if (npmFile !== undefined) {
            try {
              const npmDecoded: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(npmFile.content))
              const expectedNpm = lockRows
                .filter(row => typeof row.packageName === 'string')
                .map(row => ({
                  portableId: String(row.portableId), packageName: String(row.packageName), version: String(row.version),
                  digest: String(row.digest),
                  ...(typeof row.integrity === 'string' ? { integrity: row.integrity } : {}),
                  ...(typeof row.registryUrl === 'string' ? { registryUrl: row.registryUrl } : {}),
                  requiredBy: Array.isArray(row.requiredBy) ? row.requiredBy.map(String) : [],
                }))
                .sort((left, right) => left.packageName.localeCompare(right.packageName, 'en') || left.version.localeCompare(right.version, 'en'))
              if (!isRecord(npmDecoded) || npmDecoded.schemaVersion !== 1 || npmDecoded.packageManager !== 'pnpm'
                || !Array.isArray(npmDecoded.dependencies)
                || canonicalJson(npmDecoded.dependencies) !== canonicalJson(expectedNpm)) {
                errors.push('dependencies.npm.json does not match dependencies.lock.json')
              }
            } catch { errors.push('dependencies.npm.json is not valid UTF-8 JSON') }
          }
        }
      } catch { errors.push('dependencies.lock.json is not valid UTF-8 JSON') }
    }
    const sessions = byPath.get('sessions.json')
    if (sessions !== undefined) {
      try {
        const decoded: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(sessions.content))
        if (!isRecord(decoded) || decoded.schemaVersion !== 1 || decoded.mode !== 'manual-bind'
          || !Array.isArray(decoded.templates) || !Array.isArray(decoded.areaBindings)) errors.push('sessions.json is invalid')
        else if (decodedProjection !== undefined) errors.push(...sessionFileIssues(decoded as unknown as WorkbenchSessionsFileV1, decodedProjection))
      } catch { errors.push('sessions.json is not valid UTF-8 JSON') }
    }
  }
  return { valid: errors.length === 0, errors }
}
