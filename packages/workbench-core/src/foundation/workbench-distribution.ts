import type { WorkbenchEditorCatalogRow } from './catalog.ts'
import type { WorkbenchInventory } from './workbench-inventory.ts'

/** Runtime-owned identity of the Slot registration that currently provides an editor. */
export interface SlotRegistrationProvenanceV1 {
  readonly version: 1
  readonly runtimeKind: 'static' | 'dynamic' | 'unknown'
  readonly fiberName: string
  readonly packageName?: string
  readonly packageVersion?: string
  readonly artifactDigest?: string
  readonly dynamic?: {
    readonly portableId?: string
    readonly pluginId: string
    readonly packageId: string
    readonly pluginRunId: string
    readonly artifactDigest?: string
  }
}

/** Portable dependency declaration supplied by a static or dynamic editor package. */
export interface WorkbenchDistributionDescriptorV1 {
  readonly version: 1
  readonly portableId: string
  readonly packageVersion: string
  /** Runtime/lineage supplied artifact identity for packages without a live editor. */
  readonly artifactDigest?: string
  readonly exportPolicy: 'embed' | 'reference' | 'forbid'
  readonly sourcePolicy: 'source-included' | 'binary-only' | 'remote'
  readonly provides: { readonly editorIds: readonly string[] }
  readonly requires: readonly WorkbenchDistributionRequirementV1[]
  readonly permissions: readonly string[]
  readonly license?: string
  /** npm package name when DSH installs this dependency through a Profile. */
  readonly packageName?: string
  readonly registryUrl?: string
  /** npm lockfile-style integrity (for example `sha512-...`). */
  readonly integrity?: string
  readonly installSource?: WorkbenchDependencyInstallSourceV1
}

/** Where the Runtime is expected to obtain an executable dependency. */
export type WorkbenchDependencyInstallSourceV1 = 'npm' | 'registry' | 'embedded' | 'local'

/** A dependency edge shared by editor packages and Agent preset packages. */
export interface WorkbenchDistributionRequirementV1 {
  readonly portableId: string
  readonly versionRange: string
  readonly digest?: string
  readonly optional?: boolean
}

/**
 * Runtime-owned distribution metadata for a user-authored Agent preset.
 *
 * An Agent preset is not a Workbench editor plugin: it is a trusted Cordis
 * composition (for example `agent.cordis.yml` plus skills/assets) mounted for
 * a Session. It therefore has its own portable identity and artifact, while
 * any UI/Host plugins referenced by that composition remain separate lock
 * entries in the same dependency graph.
 */
export interface WorkbenchAgentPresetDistributionDescriptorV1 {
  readonly version: 1
  readonly portableId: string
  readonly presetId: string
  readonly packageVersion: string
  readonly artifactDigest?: string
  readonly exportPolicy: 'embed' | 'reference' | 'forbid'
  readonly sourcePolicy: 'source-included' | 'binary-only' | 'remote'
  readonly requires: readonly WorkbenchDistributionRequirementV1[]
  readonly permissions: readonly string[]
  readonly license?: string
  readonly packageName?: string
  readonly registryUrl?: string
  readonly integrity?: string
  readonly installSource?: WorkbenchDependencyInstallSourceV1
}

/** Runtime result for one active Session template's Agent preset. */
export interface WorkbenchAgentPresetDependencyInputV1 {
  readonly presetId: string
  readonly templateIds: readonly string[]
  readonly descriptor?: WorkbenchAgentPresetDistributionDescriptorV1
  /** True only for a preset supplied by the recipient's base Runtime. */
  readonly runtimeProvided?: boolean
}

export type WorkbenchDependencyAvailabilityV1 =
  | 'embedded' | 'installed' | 'registry' | 'missing' | 'forbidden'

/** One package in the resolved dependency closure. */
export interface WorkbenchDependencyPackageV1 {
  readonly portableId: string
  readonly version: string
  readonly artifactDigest?: string
  readonly sourcePolicy: WorkbenchDistributionDescriptorV1['sourcePolicy']
  readonly exportPolicy: WorkbenchDistributionDescriptorV1['exportPolicy']
  readonly clientEntry?: string
  readonly hostEntry?: string
  readonly editorIds: readonly string[]
  readonly permissions: readonly string[]
  readonly availability: WorkbenchDependencyAvailabilityV1
  readonly packageName?: string
  readonly registryUrl?: string
  readonly integrity?: string
  readonly installSource?: WorkbenchDependencyInstallSourceV1
}

/** Hash-locked package entry written to a v2 Workbench package. */
export interface WorkbenchDependencyLockEntryV1 {
  readonly portableId: string
  readonly version: string
  readonly digest: string
  readonly kind: 'static' | 'dynamic' | 'shared' | 'agent-preset'
  readonly sourcePolicy: WorkbenchDistributionDescriptorV1['sourcePolicy']
  readonly exportPolicy: WorkbenchDistributionDescriptorV1['exportPolicy']
  readonly artifactPath?: string
  /** Embedded npm tarball path; independent from the editor artifact digest. */
  readonly npmArtifactPath?: string
  /** npm package name; never used as the cross-machine portable identity. */
  readonly packageName?: string
  readonly registryUrl?: string
  /** npm lockfile integrity string, kept in the signed dependency lock. */
  readonly integrity?: string
  readonly installSource?: WorkbenchDependencyInstallSourceV1
  readonly clientEntry?: string
  readonly hostEntry?: string
  readonly editorIds: readonly string[]
  /**
   * Scope proof for each provided editor.  Older v2 packages may omit this
   * field and remain readable, but newly exported packages include it so an
   * editor registered in the wrong Slot scope cannot pass activation.
   */
  readonly editorScopes?: readonly WorkbenchDependencyEditorScopeV1[]
  /** Present only for `kind: agent-preset`; never a local runtime preset id. */
  readonly agentPresetId?: string
  readonly requiredBy: readonly string[]
  readonly permissions: readonly string[]
}

export interface WorkbenchDependencyEditorScopeV1 {
  readonly editorId: string
  readonly scope: 'root' | 'session'
}

export type WorkbenchDependencyCompletenessV1 = 'layout-only' | 'complete-online' | 'complete-offline'

export interface WorkbenchDependencyIssueV1 {
  readonly code: string
  readonly message: string
  readonly editorId?: string
  readonly portableId?: string
}

/** Unified read model consumed by Settings, package export and future import preflight. */
export interface WorkbenchDependencySnapshotV1 {
  readonly schemaVersion: 1
  readonly workbenchId: string
  readonly settingsRevision?: number
  readonly completeness: WorkbenchDependencyCompletenessV1
  readonly editors: readonly {
    readonly editorId: string
    readonly scope: 'root' | 'session'
    readonly requiredByAreaKeys: readonly string[]
    readonly provider?: SlotRegistrationProvenanceV1
    readonly status: 'available' | 'missing' | 'unresolved' | 'conflict'
  }[]
  readonly staticPackages: readonly WorkbenchDependencyPackageV1[]
  readonly dynamicPackages: readonly WorkbenchDependencyPackageV1[]
  readonly agentPresetPackages?: readonly WorkbenchDependencyPackageV1[]
  readonly agentPresets?: readonly {
    readonly presetId: string
    readonly templateIds: readonly string[]
    readonly portableId?: string
    readonly status: 'available' | 'missing' | 'unresolved' | 'conflict' | 'runtime-provided'
  }[]
  readonly runtimeProvided: readonly string[]
  readonly dependencies: readonly WorkbenchDependencyLockEntryV1[]
  readonly permissions: readonly string[]
  readonly blockers: readonly WorkbenchDependencyIssueV1[]
  readonly warnings: readonly WorkbenchDependencyIssueV1[]
}

export interface WorkbenchDependencyArtifactInfoV1 {
  readonly digest: string
  readonly availability: WorkbenchDependencyAvailabilityV1
  readonly clientEntry?: string
  readonly hostEntry?: string
  readonly files?: readonly { readonly path: string; readonly content: Uint8Array }[]
  /**
   * Runtime/Artifact Store metadata is intentionally typed at this seam.
   * Keeping this as an unbounded Record made adapters silently drop the
   * immutable Dynamic `name`/`purpose` fields while copying artifacts between
   * DSH and the Workbench scanner.
   */
  readonly record?: WorkbenchDependencyArtifactRecordV1
}

/** The scanner only needs this small, JSON-safe projection of an artifact. */
export interface WorkbenchDependencyArtifactRecordV1 {
  readonly digest?: string
  readonly portableId?: string
  readonly version?: string
  readonly name?: string
  readonly purpose?: string
  /** Agent preset identity for agent-preset artifacts; runtime-only metadata. */
  readonly presetId?: string
  readonly clientEntry?: string
  readonly hostEntry?: string
  readonly editorIds?: readonly string[]
  readonly sourcePolicy?: WorkbenchDistributionDescriptorV1['sourcePolicy']
  readonly permissions?: readonly string[]
  readonly size?: number
  readonly license?: string
}

export interface WorkbenchDependencySnapshotOptionsV1 {
  readonly workbenchId: string
  readonly settingsRevision?: number
  readonly inventory: WorkbenchInventory
  readonly editors: readonly WorkbenchEditorCatalogRow[]
  readonly distributions?: readonly WorkbenchDistributionDescriptorV1[]
  readonly artifacts?: readonly WorkbenchDependencyArtifactInfoV1[]
  readonly runtimeProvided?: readonly string[]
  readonly agentPresetDependencies?: readonly WorkbenchAgentPresetDependencyInputV1[]
}

/**
 * Canonical scan result used by Settings, Creator and package export.
 *
 * The scan is deliberately based on the persisted document plus the live Slot
 * catalog. It never walks the host's whole node_modules tree: only the active
 * editor in each Area, its declared distribution closure and the Agent preset
 * selected by the current Session templates are share requirements.
 */
export interface WorkbenchDependencyScanReportV1 {
  readonly schemaVersion: 1
  readonly workbenchId: string
  readonly inventory: WorkbenchInventory
  readonly snapshot: WorkbenchDependencySnapshotV1
  readonly activeEditors: readonly {
    readonly editorId: string
    readonly scope: 'root' | 'session'
    readonly areaKey: string
    readonly status: 'available' | 'missing' | 'unresolved' | 'conflict'
  }[]
  /** A derived view for the DSH Profile npm/pnpm adapter; lock remains authoritative. */
  readonly npmDependencies: readonly {
    readonly portableId: string
    readonly packageName: string
    readonly version: string
    readonly digest: string
    readonly integrity?: string
    readonly registryUrl?: string
    readonly requiredBy: readonly string[]
  }[]
}

/** Validate the JSON declaration before it becomes part of a dependency graph. */
export function validateWorkbenchDistributionDescriptor(value: unknown): value is WorkbenchDistributionDescriptorV1 {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const row = value as Record<string, unknown>
  if (row.version !== 1 || typeof row.portableId !== 'string' || row.portableId.trim() === '') return false
  if (typeof row.packageVersion !== 'string' || row.packageVersion.trim() === '') return false
  if (row.artifactDigest !== undefined && (typeof row.artifactDigest !== 'string' || !/^[a-f0-9]{64}$/iu.test(row.artifactDigest))) return false
  if (row.exportPolicy !== 'embed' && row.exportPolicy !== 'reference' && row.exportPolicy !== 'forbid') return false
  if (row.sourcePolicy !== 'source-included' && row.sourcePolicy !== 'binary-only' && row.sourcePolicy !== 'remote') return false
  const provides = row.provides
  const editorIds = typeof provides === 'object' && provides !== null && !Array.isArray(provides)
    ? (provides as Record<string, unknown>).editorIds : undefined
  if (!Array.isArray(editorIds) || !editorIds.every((id: unknown) => typeof id === 'string' && id.length > 0)
    || new Set(editorIds).size !== editorIds.length) return false
  if (!Array.isArray(row.requires) || !row.requires.every(requirement => {
    if (typeof requirement !== 'object' || requirement === null || Array.isArray(requirement)) return false
    const item = requirement as Record<string, unknown>
    return typeof item.portableId === 'string' && item.portableId.length > 0
      && typeof item.versionRange === 'string' && item.versionRange.length > 0
      && (item.digest === undefined || typeof item.digest === 'string' && /^[a-f0-9]{64}$/iu.test(item.digest))
      && (item.optional === undefined || typeof item.optional === 'boolean')
  })) return false
  if (!Array.isArray(row.permissions) || !row.permissions.every(permission => typeof permission === 'string' && permission.length > 0)) return false
  // `installSource` describes where a recipient may obtain bytes in an
  // online-reference package; it does not itself mean this local embedded
  // artifact performs a network call.  Network permission is enforced by the
  // Runtime prepare/activation policy when that path is actually selected.
  // A remote package is executable content fetched during installation. It
  // must declare that network boundary explicitly instead of gaining it as an
  // implicit side effect of choosing sourcePolicy: remote.
  if (row.sourcePolicy === 'remote' && !row.permissions.includes('network')) return false
  if (row.license !== undefined && typeof row.license !== 'string') return false
  return validatePackageSourceFields(row)
}

/** Validate an Agent preset distribution declaration before dependency solving. */
export function validateWorkbenchAgentPresetDistributionDescriptor(
  value: unknown,
): value is WorkbenchAgentPresetDistributionDescriptorV1 {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const row = value as Record<string, unknown>
  if (row.version !== 1 || typeof row.portableId !== 'string' || row.portableId.trim() === '') return false
  if (typeof row.presetId !== 'string' || row.presetId.trim() === '') return false
  if (typeof row.packageVersion !== 'string' || row.packageVersion.trim() === '') return false
  if (row.artifactDigest !== undefined && (typeof row.artifactDigest !== 'string' || !/^[a-f0-9]{64}$/iu.test(row.artifactDigest))) return false
  if (row.exportPolicy !== 'embed' && row.exportPolicy !== 'reference' && row.exportPolicy !== 'forbid') return false
  if (row.sourcePolicy !== 'source-included' && row.sourcePolicy !== 'binary-only' && row.sourcePolicy !== 'remote') return false
  if (!Array.isArray(row.requires) || !row.requires.every(requirement => {
    if (typeof requirement !== 'object' || requirement === null || Array.isArray(requirement)) return false
    const item = requirement as Record<string, unknown>
    return typeof item.portableId === 'string' && item.portableId.trim() !== ''
      && typeof item.versionRange === 'string' && item.versionRange.trim() !== ''
      && (item.digest === undefined || (typeof item.digest === 'string' && /^[a-f0-9]{64}$/iu.test(item.digest)))
      && (item.optional === undefined || typeof item.optional === 'boolean')
  })) return false
  if (!Array.isArray(row.permissions) || !row.permissions.every(permission => typeof permission === 'string' && permission.trim() !== '')) return false
  // See the static descriptor validator above: a Registry reference is
  // metadata until the Runtime explicitly chooses online installation.
  if (row.sourcePolicy === 'remote' && !row.permissions.includes('network')) return false
  if (row.license !== undefined && typeof row.license !== 'string') return false
  return validatePackageSourceFields(row)
}

function editorKey(scope: 'root' | 'session', id: string): string {
  return `${scope}:${id}`
}

function validNpmPackageName(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 214 || /\s/u.test(value)) return false
  if (value.startsWith('@')) {
    const parts = value.slice(1).split('/')
    return parts.length === 2 && parts.every(part => part.length > 0 && /^[a-z0-9._~-]+$/u.test(part))
  }
  return /^[a-z0-9._~-]+$/u.test(value)
}

function validNpmIntegrity(value: unknown): value is string {
  return typeof value === 'string' && /^(?:sha512|sha256)-[A-Za-z0-9+/]+={0,2}$/u.test(value)
}

function validRegistryUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.trim() === '') return false
  try {
    const url = new URL(value)
    return url.protocol === 'https:'
      || (url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]'))
  } catch {
    return false
  }
}

function validInstallSource(value: unknown): value is WorkbenchDependencyInstallSourceV1 {
  return value === 'npm' || value === 'registry' || value === 'embedded' || value === 'local'
}

function validatePackageSourceFields(row: Record<string, unknown>): boolean {
  if (row.packageName !== undefined && !validNpmPackageName(row.packageName)) return false
  if (row.registryUrl !== undefined && !validRegistryUrl(row.registryUrl)) return false
  if (row.integrity !== undefined && !validNpmIntegrity(row.integrity)) return false
  if (row.installSource !== undefined && !validInstallSource(row.installSource)) return false
  // portableId remains the cross-machine identity. npm packageName is only
  // an install hint and must be explicit when the Runtime selects npm.
  if ((row.installSource === 'npm' || row.installSource === 'registry') && !validNpmPackageName(row.packageName)) return false
  if ((row.installSource === 'npm' || row.installSource === 'registry') && typeof row.registryUrl !== 'string') return false
  if ((row.installSource === 'npm' || row.installSource === 'registry') && !validNpmIntegrity(row.integrity)) return false
  return true
}

function digestFor(
  provenance: SlotRegistrationProvenanceV1 | undefined,
): string | undefined {
  const digest = provenance?.artifactDigest ?? provenance?.dynamic?.artifactDigest
  return digest !== undefined && /^[a-f0-9]{64}$/iu.test(digest) ? digest.toLocaleLowerCase('en-US') : undefined
}

function distributionForEditor(
  editor: WorkbenchEditorCatalogRow,
  distributionsById: ReadonlyMap<string, WorkbenchDistributionDescriptorV1>,
  distributionsByPackageName: ReadonlyMap<string, WorkbenchDistributionDescriptorV1>,
): WorkbenchDistributionDescriptorV1 | undefined {
  if (editor.distribution !== undefined) return editor.distribution
  const dynamicPortableId = editor.provenance?.dynamic?.portableId
  if (dynamicPortableId !== undefined) {
    const dynamic = distributionsById.get(dynamicPortableId)
    if (dynamic !== undefined) return dynamic
  }
  const packageName = editor.provenance?.packageName
  return packageName === undefined ? undefined : distributionsByPackageName.get(packageName)
}

function portableIdForEditor(
  editor: WorkbenchEditorCatalogRow,
  distributionsById?: ReadonlyMap<string, WorkbenchDistributionDescriptorV1>,
  distributionsByPackageName?: ReadonlyMap<string, WorkbenchDistributionDescriptorV1>,
): string | undefined {
  return editor.distribution?.portableId
    ?? editor.provenance?.dynamic?.portableId
    ?? (distributionsById === undefined || distributionsByPackageName === undefined
      ? undefined
      : distributionForEditor(editor, distributionsById, distributionsByPackageName)?.portableId)
}

function packageAvailability(
  distribution: WorkbenchDistributionDescriptorV1 | WorkbenchAgentPresetDistributionDescriptorV1,
  digest: string | undefined,
  artifacts: Map<string, WorkbenchDependencyArtifactInfoV1>,
): WorkbenchDependencyAvailabilityV1 {
  if (distribution.exportPolicy === 'forbid') return 'forbidden'
  const hasRegistryReference = distribution.registryUrl !== undefined
    && (distribution.sourcePolicy === 'remote' || distribution.installSource === 'npm' || distribution.installSource === 'registry')
  if (digest === undefined) return hasRegistryReference ? 'registry' : 'missing'
  return artifacts.get(digest.toLocaleLowerCase('en-US'))?.availability
    ?? (hasRegistryReference ? 'registry' : 'missing')
}

function compareVersions(left: string, right: string): number {
  const parse = (value: string) => value.replace(/^v/u, '').split(/[.+-]/u).slice(0, 3).map(part => {
    const match = /^(\d+)/u.exec(part)
    return match === null ? 0 : Number(match[1])
  })
  const a = parse(left)
  const b = parse(right)
  for (let index = 0; index < 3; index += 1) {
    if ((a[index] ?? 0) !== (b[index] ?? 0)) return (a[index] ?? 0) - (b[index] ?? 0)
  }
  return 0
}

/** Deliberately small range reader: distribution metadata is not an npm solver. */
function satisfiesVersionRange(version: string, range: string): boolean {
  const value = range.trim()
  if (value === '' || value === '*' || value === 'latest') return true
  const exact = value.replace(/^[=v]/u, '')
  if (/^\d+(?:\.\d+){0,2}$/u.test(exact)) return compareVersions(version, exact) === 0
  const match = /^(\^|~|>=|>|<=|<)?\s*v?(\d+(?:\.\d+){0,2})$/u.exec(value)
  if (match === null) return false
  const operator = match[1] ?? '='
  const target = match[2]!
  const comparison = compareVersions(version, target)
  if (operator === '^') return comparison >= 0 && version.split('.')[0] === target.split('.')[0]
  if (operator === '~') return comparison >= 0 && version.split('.')[0] === target.split('.')[0]
  if (operator === '>=') return comparison >= 0
  if (operator === '>') return comparison > 0
  if (operator === '<=') return comparison <= 0
  if (operator === '<') return comparison < 0
  return comparison === 0
}

/**
 * Derive the active-editor dependency closure. History is intentionally absent:
 * `inventory` already contains only the current page of each Area.
 */
export function deriveWorkbenchDependencySnapshot(
  options: WorkbenchDependencySnapshotOptionsV1,
): WorkbenchDependencySnapshotV1 {
  const runtimeProvided = [...new Set(options.runtimeProvided ?? [])].sort()
  const distributionById = new Map<string, WorkbenchDistributionDescriptorV1>()
  const distributionByPackageName = new Map<string, WorkbenchDistributionDescriptorV1>()
  const conflictingPackageNames = new Set<string>()
  for (const distribution of options.distributions ?? []) {
    distributionById.set(distribution.portableId, distribution)
    if (distribution.packageName !== undefined) {
      const previous = distributionByPackageName.get(distribution.packageName)
      if (previous !== undefined && previous.portableId !== distribution.portableId) {
        conflictingPackageNames.add(distribution.packageName)
        distributionByPackageName.delete(distribution.packageName)
      } else if (previous === undefined && !conflictingPackageNames.has(distribution.packageName)) {
        distributionByPackageName.set(distribution.packageName, distribution)
      }
    }
  }
  for (const editor of options.editors) {
    if (editor.distribution !== undefined && !distributionById.has(editor.distribution.portableId)) {
      distributionById.set(editor.distribution.portableId, editor.distribution)
      if (editor.distribution.packageName !== undefined && !conflictingPackageNames.has(editor.distribution.packageName)) {
        distributionByPackageName.set(editor.distribution.packageName, editor.distribution)
      }
    }
  }
  const agentDistributionById = new Map<string, WorkbenchAgentPresetDistributionDescriptorV1>()
  const agentInputs = options.agentPresetDependencies ?? []
  const agentInputByPreset = new Map<string, WorkbenchAgentPresetDependencyInputV1>()
  const agentPresetRows = new Map<string, {
    presetId: string
    templateIds: readonly string[]
    portableId?: string
    status: 'available' | 'missing' | 'unresolved' | 'conflict' | 'runtime-provided'
  }>()
  for (const input of agentInputs) {
    const previous = agentInputByPreset.get(input.presetId)
    if (previous !== undefined) {
      const previousId = previous.descriptor?.portableId
      const currentId = input.descriptor?.portableId
      if (previousId !== currentId || previous.runtimeProvided !== input.runtimeProvided) {
        agentPresetRows.set(input.presetId, {
          presetId: input.presetId,
          templateIds: [...new Set([...previous.templateIds, ...input.templateIds])].sort(),
          ...(currentId === undefined ? previousId === undefined ? {} : { portableId: previousId } : { portableId: currentId }),
          status: 'conflict',
        })
      } else {
        agentInputByPreset.set(input.presetId, {
          ...previous,
          templateIds: [...new Set([...previous.templateIds, ...input.templateIds])].sort(),
        })
        const previousRow = agentPresetRows.get(input.presetId)
        if (previousRow !== undefined) {
          agentPresetRows.set(input.presetId, {
            ...previousRow,
            templateIds: [...new Set([...previousRow.templateIds, ...input.templateIds])].sort(),
          })
        }
      }
      continue
    }
    agentInputByPreset.set(input.presetId, input)
    const descriptor = input.descriptor
    const portableId = descriptor?.portableId
    const runtime = input.runtimeProvided === true
      || (portableId !== undefined && runtimeProvided.includes(portableId))
    const valid = descriptor === undefined || validateWorkbenchAgentPresetDistributionDescriptor(descriptor)
    const status = runtime ? 'runtime-provided' : descriptor === undefined || !valid ? 'unresolved' : 'available'
    agentPresetRows.set(input.presetId, {
      presetId: input.presetId,
      templateIds: [...new Set(input.templateIds)].sort(),
      ...(portableId === undefined ? {} : { portableId }),
      status,
    })
    if (!runtime && descriptor !== undefined && valid) agentDistributionById.set(descriptor.portableId, descriptor)
  }
  const catalog = new Map(options.editors.map(editor => [editorKey(editor.scope, editor.id), editor]))
  const artifactByDigest = new Map((options.artifacts ?? []).map(artifact => [artifact.digest.toLocaleLowerCase('en-US'), artifact]))
  const editorsByKey = new Map<string, WorkbenchDependencySnapshotV1['editors'][number]>()
  const packageUses = new Map<string, Set<string>>()
  const blockers: WorkbenchDependencyIssueV1[] = []
  const warnings: WorkbenchDependencyIssueV1[] = []

  for (const packageName of [...conflictingPackageNames].sort()) {
    blockers.push({
      code: 'distribution-package-name-conflict',
      message: `多个 portableId 声明复用了同一个 npm packageName：${packageName}`,
      portableId: packageName,
    })
  }

  for (const input of agentInputs) {
    const descriptor = input.descriptor
    if (input.runtimeProvided === true || descriptor?.portableId !== undefined && runtimeProvided.includes(descriptor.portableId)) continue
    if (descriptor === undefined) {
      blockers.push({ code: 'agent-preset-unprepared', message: `自定义 Agent 模式尚未准备分发：${input.presetId}`, portableId: input.presetId })
    } else if (!validateWorkbenchAgentPresetDistributionDescriptor(descriptor)) {
      blockers.push({ code: 'agent-preset-distribution-invalid', message: `Agent 模式分发声明无效：${input.presetId}`, portableId: input.presetId })
    }
  }
  for (const [portableId, descriptor] of agentDistributionById) {
    if (distributionById.has(portableId)) {
      blockers.push({ code: 'distribution-id-conflict', message: `编辑器插件与 Agent 模式复用了同一 portableId：${portableId}`, portableId })
    }
    // Keep the descriptor available to dependency resolution even if it is
    // not the provider of an editor.
    if (descriptor.portableId !== portableId) blockers.push({ code: 'agent-preset-portable-id-invalid', message: `Agent 模式 portableId 不一致：${portableId}`, portableId })
  }

  const duplicateEditors = new Set<string>()
  const seenEditorRows = new Set<string>()
  for (const editor of options.editors) {
    const key = editorKey(editor.scope, editor.id)
    if (seenEditorRows.has(key)) duplicateEditors.add(key)
    seenEditorRows.add(key)
  }
  for (const key of duplicateEditors) {
    const [, ...idParts] = key.split(':')
    blockers.push({ code: 'editor-provider-conflict', message: `同一 editorId 存在多个来源：${idParts.join(':')}`, editorId: idParts.join(':') })
  }
  const providerDigests = new Map<string, Set<string>>()
  for (const editor of options.editors) {
    const portableId = portableIdForEditor(editor, distributionById, distributionByPackageName)
    const digest = digestFor(editor.provenance)
    if (portableId !== undefined && digest !== undefined) {
      const digests = providerDigests.get(portableId) ?? new Set<string>()
      digests.add(digest)
      providerDigests.set(portableId, digests)
    }
  }
  for (const [portableId, digests] of providerDigests) {
    if (digests.size > 1) blockers.push({ code: 'provider-digest-conflict', message: `同一 portableId 存在多个制品摘要：${portableId}`, portableId })
  }

  for (const area of options.inventory.areas) {
    // Dependency locks must refer to the same portable Area keys used by
    // workbench.json/sessions.json. Persisted author-local area IDs are not
    // available on the recipient and cannot be used to resolve Dynamic Agent
    // bindings after import.
    const portableAreaKey = `area-${area.ordinal}`
    const page = area.activePage
    if (page === undefined) continue
    const row = catalog.get(editorKey(page.editorScope, page.editorId))
    const provider = row?.provenance
    const distribution = row === undefined
      ? undefined
      : distributionForEditor(row, distributionById, distributionByPackageName)
    const providerPortableId = row === undefined
      ? undefined
      : portableIdForEditor(row, distributionById, distributionByPackageName)
    const status = duplicateEditors.has(editorKey(page.editorScope, page.editorId))
      ? 'conflict'
      : row === undefined
      ? 'missing'
      : provider === undefined || provider.runtimeKind === 'unknown' || providerPortableId === undefined
        || provider.packageVersion === undefined
        ? 'unresolved'
        : distribution === undefined ? 'unresolved' : 'available'
    const editorEntry = {
      editorId: page.editorId,
      scope: page.editorScope,
      requiredByAreaKeys: [portableAreaKey],
      ...(provider === undefined ? {} : { provider }),
      status,
    } satisfies WorkbenchDependencySnapshotV1['editors'][number]
    const existingEditor = editorsByKey.get(editorKey(page.editorScope, page.editorId))
    if (existingEditor === undefined) editorsByKey.set(editorKey(page.editorScope, page.editorId), editorEntry)
    else {
      editorsByKey.set(editorKey(page.editorScope, page.editorId), {
        ...existingEditor,
        requiredByAreaKeys: [...new Set([...existingEditor.requiredByAreaKeys, portableAreaKey])].sort(),
        status: existingEditor.status === 'available' ? status : existingEditor.status,
      })
    }
    if (status === 'missing') blockers.push({ code: 'editor-missing', message: `内页未注册：${page.editorId}`, editorId: page.editorId })
    else if (status === 'unresolved') blockers.push({ code: 'provider-unresolved', message: `无法确定内页来源或分发声明：${page.editorId}`, editorId: page.editorId })
    if (distribution !== undefined) {
      if (provider?.packageVersion !== undefined && provider.packageVersion !== distribution.packageVersion) {
        blockers.push({
          code: 'provider-version-conflict',
          message: `内页来源版本与分发声明不一致：${page.editorId}（运行时 ${provider.packageVersion}，声明 ${distribution.packageVersion}）`,
          editorId: page.editorId,
          portableId: distribution.portableId,
        })
      }
      const current = packageUses.get(distribution.portableId) ?? new Set<string>()
      current.add(portableAreaKey)
      packageUses.set(distribution.portableId, current)
    }
  }

  // Session templates are the only Workbench-owned references to Agent
  // presets. A preset is included once even when several Areas use the same
  // template; template IDs remain package-local and carry no Session identity.
  for (const input of agentInputs) {
    if (input.runtimeProvided === true || input.descriptor === undefined) continue
    if (!validateWorkbenchAgentPresetDistributionDescriptor(input.descriptor)) continue
    const current = packageUses.get(input.descriptor.portableId) ?? new Set<string>()
    for (const templateId of input.templateIds) current.add(templateId)
    packageUses.set(input.descriptor.portableId, current)
  }

  const packages = new Map<string, WorkbenchDependencyPackageV1>()
  const packageKinds = new Map<string, 'static' | 'dynamic' | 'shared' | 'agent-preset'>()
  const agentPresetIdByPortable = new Map<string, string>()
  for (const input of agentInputs) {
    if (input.runtimeProvided === true || input.descriptor === undefined) continue
    if (validateWorkbenchAgentPresetDistributionDescriptor(input.descriptor)) agentPresetIdByPortable.set(input.descriptor.portableId, input.descriptor.presetId)
  }
  const visiting = new Set<string>()
  const visit = (portableId: string): void => {
    if (runtimeProvided.includes(portableId)) return
    const distribution = distributionById.get(portableId) ?? agentDistributionById.get(portableId)
    if (distribution === undefined) {
      blockers.push({ code: 'dependency-missing', message: `缺少依赖分发声明：${portableId}`, portableId })
      return
    }
    if (visiting.has(portableId)) {
      blockers.push({ code: 'dependency-cycle', message: `依赖存在循环：${portableId}`, portableId })
      return
    }
    const existing = packages.get(portableId)
    if (existing !== undefined) return
    visiting.add(portableId)
    const provider = options.editors.find(editor => portableIdForEditor(editor, distributionById, distributionByPackageName) === portableId)
    const provenance = provider?.provenance
    const digest = digestFor(provenance)
      ?? (agentDistributionById.has(portableId) ? agentDistributionById.get(portableId)?.artifactDigest?.toLocaleLowerCase('en-US') : undefined)
      // Shared/transitive dependencies have no live Slot provenance. Their
      // digest must come from the immutable distribution declaration (for
      // example, the sanitized lock carried by an imported Workbench).
      ?? distribution.artifactDigest?.toLocaleLowerCase('en-US')
    const availability = packageAvailability(distribution, digest, artifactByDigest)
    const artifact = digest === undefined ? undefined : artifactByDigest.get(digest)
    const packageRow: WorkbenchDependencyPackageV1 = {
      portableId, version: distribution.packageVersion,
      ...(digest === undefined ? {} : { artifactDigest: digest }),
      sourcePolicy: distribution.sourcePolicy, exportPolicy: distribution.exportPolicy,
      ...(artifact?.clientEntry === undefined ? {} : { clientEntry: artifact.clientEntry }),
      ...(artifact?.hostEntry === undefined ? {} : { hostEntry: artifact.hostEntry }),
      editorIds: 'provides' in distribution ? [...distribution.provides.editorIds].sort() : [], permissions: [...new Set(distribution.permissions)].sort(),
      availability,
      ...(distribution.packageName === undefined ? {} : { packageName: distribution.packageName }),
      ...(distribution.registryUrl === undefined ? {} : { registryUrl: distribution.registryUrl }),
      ...(distribution.integrity === undefined ? {} : { integrity: distribution.integrity }),
      ...(distribution.installSource === undefined ? {} : { installSource: distribution.installSource }),
    }
    packages.set(portableId, packageRow)
    const packageKind = agentDistributionById.has(portableId)
      ? 'agent-preset'
      : provider?.provenance?.runtimeKind === 'dynamic'
        ? 'dynamic'
        : packageRow.editorIds.length > 0 ? 'static' : 'shared'
    packageKinds.set(portableId, packageKind)
    if (packageKind === 'dynamic' && availability === 'embedded') {
      const name = artifact?.record?.name
      const purpose = artifact?.record?.purpose
      if (typeof name !== 'string' || name.trim() === '' || typeof purpose !== 'string' || purpose.trim() === '') {
        blockers.push({
          code: 'dynamic-metadata-missing',
          message: `Dynamic Package 缺少 immutable name/purpose 元数据：${portableId}`,
          portableId,
        })
      }
    }
    if (availability === 'missing') blockers.push({ code: 'artifact-missing', message: `缺少制品：${portableId}`, portableId })
    if (availability === 'forbidden') blockers.push({ code: 'export-forbidden', message: `插件禁止分发：${portableId}`, portableId })
    for (const requirement of distribution.requires) {
      if (runtimeProvided.includes(requirement.portableId)) continue
      const required = distributionById.get(requirement.portableId) ?? agentDistributionById.get(requirement.portableId)
      if (requirement.optional === true && required === undefined) {
        warnings.push({ code: 'optional-dependency-missing', message: `可选依赖不可用：${requirement.portableId}`, portableId: requirement.portableId })
        continue
      }
      if (required === undefined) {
        blockers.push({ code: 'dependency-missing', message: `缺少依赖分发声明：${requirement.portableId}`, portableId: requirement.portableId })
        continue
      }
      if (!satisfiesVersionRange(required.packageVersion, requirement.versionRange)) {
        blockers.push({ code: 'dependency-version-conflict', message: `依赖版本不满足 ${requirement.portableId}@${requirement.versionRange}：${required.packageVersion}`, portableId: requirement.portableId })
      }
      if (requirement.digest !== undefined) {
        const requiredProvider = options.editors.find(editor => portableIdForEditor(editor, distributionById, distributionByPackageName) === requirement.portableId)
        const requiredDigest = digestFor(requiredProvider?.provenance)
          ?? (agentDistributionById.get(requirement.portableId)?.artifactDigest?.toLocaleLowerCase('en-US'))
          ?? (distributionById.get(requirement.portableId)?.artifactDigest?.toLocaleLowerCase('en-US'))
        if (requiredDigest !== undefined && requiredDigest !== requirement.digest) {
          blockers.push({ code: 'dependency-digest-conflict', message: `依赖摘要冲突：${requirement.portableId}`, portableId: requirement.portableId })
        }
      }
      const parentUses = packageUses.get(requirement.portableId) ?? new Set<string>()
      parentUses.add(portableId)
      packageUses.set(requirement.portableId, parentUses)
      visit(requirement.portableId)
    }
    visiting.delete(portableId)
  }
  for (const portableId of packageUses.keys()) visit(portableId)

  const allPackages = [...packages.values()].sort((left, right) => left.portableId.localeCompare(right.portableId, 'en'))
  const staticPackages = allPackages.filter(pkg => packageKinds.get(pkg.portableId) !== 'dynamic' && packageKinds.get(pkg.portableId) !== 'agent-preset')
  const dynamicPackages = allPackages.filter(pkg => packageKinds.get(pkg.portableId) === 'dynamic')
  const agentPresetPackages = allPackages.filter(pkg => packageKinds.get(pkg.portableId) === 'agent-preset')
  const dependencies: WorkbenchDependencyLockEntryV1[] = allPackages.map(pkg => {
    const agentPresetId = agentPresetIdByPortable.get(pkg.portableId)
    const editorScopes = options.editors
      .filter(editor => portableIdForEditor(editor, distributionById, distributionByPackageName) === pkg.portableId
        && pkg.editorIds.includes(editor.id))
      .map(editor => ({ editorId: editor.id, scope: editor.scope }))
      .filter((entry, index, rows) => rows.findIndex(candidate => candidate.editorId === entry.editorId && candidate.scope === entry.scope) === index)
      .sort((left, right) => `${left.scope}:${left.editorId}`.localeCompare(`${right.scope}:${right.editorId}`, 'en'))
    return {
      portableId: pkg.portableId, version: pkg.version, digest: pkg.artifactDigest ?? '',
      kind: packageKinds.get(pkg.portableId) ?? (pkg.editorIds.length > 0 ? 'static' : 'shared'),
      sourcePolicy: pkg.sourcePolicy, exportPolicy: pkg.exportPolicy,
      ...(pkg.availability === 'embedded' && pkg.artifactDigest !== undefined ? { artifactPath: `artifacts/${pkg.artifactDigest}/artifact.json` } : {}),
      ...(pkg.packageName === undefined ? {} : { packageName: pkg.packageName }),
      ...(pkg.registryUrl === undefined ? {} : { registryUrl: pkg.registryUrl }),
      ...(pkg.integrity === undefined ? {} : { integrity: pkg.integrity }),
      ...(pkg.installSource === undefined ? {} : { installSource: pkg.installSource }),
      ...(pkg.clientEntry === undefined ? {} : { clientEntry: pkg.clientEntry }),
      ...(pkg.hostEntry === undefined ? {} : { hostEntry: pkg.hostEntry }),
      editorIds: pkg.editorIds,
      ...(editorScopes.length === 0 ? {} : { editorScopes }),
      ...(agentPresetId === undefined ? {} : { agentPresetId }),
      requiredBy: [...(packageUses.get(pkg.portableId) ?? [])].sort(), permissions: pkg.permissions,
    }
  })
  const permissions = [...new Set(allPackages.flatMap(pkg => pkg.permissions))].sort()
  const editors = [...editorsByKey.values()].sort((left, right) => editorKey(left.scope, left.editorId).localeCompare(editorKey(right.scope, right.editorId), 'en'))
  for (const [presetId, row] of agentPresetRows) {
    if (row.status !== 'available' || row.portableId === undefined) continue
    const packageRow = packages.get(row.portableId)
    if (packageRow?.availability === 'missing') agentPresetRows.set(presetId, { ...row, status: 'missing' })
    else if (packageRow?.availability === 'forbidden') agentPresetRows.set(presetId, { ...row, status: 'conflict' })
  }
  const agentPresets = [...agentPresetRows.values()].sort((left, right) => left.presetId.localeCompare(right.presetId, 'en'))
  const hasBlocker = blockers.length > 0
    || editors.some(editor => editor.status !== 'available')
    || agentPresets.some(preset => preset.status !== 'available' && preset.status !== 'runtime-provided')
  const offline = !hasBlocker && allPackages.every(pkg => pkg.availability === 'embedded' && pkg.exportPolicy === 'embed' && pkg.artifactDigest !== undefined)
  // An installed artifact proves only this machine's local state. A shareable
  // online package needs an explicit registry/reference for a clean recipient;
  // never promote an unaddressable local install to complete-online.
  // An online-reference package must be reproducible on a clean recipient.
  // A local/embedded artifact is not a Registry reference: it may prove that
  // this machine can run the dependency, but it cannot tell the recipient
  // where to obtain it.  Require an explicit package name, Registry URL and
  // install source for every non-runtime dependency.  This also prevents an
  // online export from retaining a local `artifactPath` while omitting the
  // corresponding bytes.
  const online = !hasBlocker && allPackages.every(pkg =>
    (pkg.availability === 'registry' || pkg.availability === 'installed' || pkg.availability === 'embedded')
    && pkg.artifactDigest !== undefined
    && pkg.packageName !== undefined
    && pkg.registryUrl !== undefined
    && pkg.integrity !== undefined
    && (pkg.installSource === 'npm' || pkg.installSource === 'registry'),
  )
  const completeness: WorkbenchDependencyCompletenessV1 = offline ? 'complete-offline' : online ? 'complete-online' : 'layout-only'
  return {
    schemaVersion: 1, workbenchId: options.workbenchId,
    ...(options.settingsRevision === undefined ? {} : { settingsRevision: options.settingsRevision }),
    completeness, editors, staticPackages, dynamicPackages, agentPresetPackages, agentPresets, runtimeProvided,
    dependencies, permissions, blockers, warnings,
  }
}

/** Scan one Workbench once and expose both runtime requirements and npm view. */
export function scanWorkbenchDependencies(
  options: WorkbenchDependencySnapshotOptionsV1,
): WorkbenchDependencyScanReportV1 {
  const inventory = options.inventory
  const snapshot = deriveWorkbenchDependencySnapshot({ ...options, inventory })
  const activeEditors = snapshot.editors.flatMap(editor => editor.requiredByAreaKeys.map(areaKey => ({
    editorId: editor.editorId,
    scope: editor.scope,
    areaKey,
    status: editor.status,
  }))).sort((left, right) => `${left.areaKey}:${left.scope}:${left.editorId}`.localeCompare(`${right.areaKey}:${right.scope}:${right.editorId}`, 'en'))
  const npmDependencies = snapshot.dependencies
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
    .sort((left, right) => left.packageName.localeCompare(right.packageName, 'en') || left.version.localeCompare(right.version, 'en'))
  return { schemaVersion: 1, workbenchId: options.workbenchId, inventory, snapshot, activeEditors, npmDependencies }
}
