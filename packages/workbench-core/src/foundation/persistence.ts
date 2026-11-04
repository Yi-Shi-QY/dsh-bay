import type { WorkbenchLayoutDocument } from './model.ts'
import { migrateOuterShellEditors, validateLayout } from './model.ts'
import type { WorkbenchDocumentV3 } from './document-v3.ts'
import {
  normalizeWorkbenchDocument, migrateDocumentV2ToV3, removeRetiredWorkbenchEditors,
  validateWorkbenchDocumentV3,
} from './document-v3.ts'
import {
  DEFAULT_WORKBENCH_CONVERSATION_INTERACTION_POLICY,
  normalizeWorkbenchConversationInteractionPolicy, migrateWorkbenchInteractionPolicy,
  type WorkbenchConversationInteractionPolicyV1,
} from '../workbench-interaction-policy.ts'
import type { WorkbenchExtensionConsentV1 } from '../workbench-extension-access.ts'
import type { WorkbenchToolUsageAggregateV1 } from '../tool-usage.ts'
import type { WorkbenchToolGatewayUsageAggregateV1 } from '../tool-gateway-usage.ts'

/** Settings key for a Workspace-scoped or ungrouped layout. */
export type WorkspaceAccountKey = `workspace:${string}` | 'ungrouped'

/** Persisted Workbench Settings namespace. */
export interface WorkbenchSettings {
  version: 2
  layouts: Record<string, WorkbenchLayoutDocument>
  /** Client-only preservation of records whose layout schema is not v1. */
  invalidLayouts: Record<string, unknown>
  sessionMarkers: Record<string, Record<string, SessionMarkerRecord>>
  /** Transient decoder signal; omitted from the atomic root replacement. */
  migrationRequired?: true
}

/** Persisted stable identity marker for one Session within a Workspace. */
export interface SessionMarkerRecord {
  label: string
  accentToken: string
  customized: boolean
}

/**
 * Safe lineage retained when a Workbench is imported.  It contains only the
 * package identity and dependency lock metadata; executable artifacts remain
 * in the Runtime-owned Artifact Store.  Keeping this reference in Settings
 * lets a creator edit an imported Workbench and re-export it after restart.
 */
export interface WorkbenchPackageOriginV1 {
  packageId: string
  version: string
  archiveSha256: string
  /** Persisted so re-opening an imported layout-only package cannot be
   * mistaken for a complete-online package after the in-memory coordinator is
   * gone. */
  completeness?: 'layout-only' | 'complete-online' | 'complete-offline'
  dependencies: readonly {
    portableId: string
    version: string
    digest: string
    kind: 'static' | 'dynamic' | 'shared' | 'agent-preset'
    sourcePolicy: 'source-included' | 'binary-only' | 'remote'
    exportPolicy: 'embed' | 'reference' | 'forbid'
    editorIds: readonly string[]
    editorScopes?: readonly { editorId: string; scope: 'root' | 'session' }[]
    permissions: readonly string[]
    requiredBy: readonly string[]
    packageName?: string
    registryUrl?: string
    integrity?: string
    installSource?: 'npm' | 'registry' | 'embedded' | 'local'
    clientEntry?: string
    hostEntry?: string
    agentPresetId?: string
  }[]
}

/** Recipient-local opaque handles for model/MCP/workspace bindings. */
export interface WorkbenchExternalBindingRecordV1 {
  kind: 'model' | 'credential' | 'workspace' | 'session' | 'mcp' | 'filesystem'
  reference: string
}

/** One named, project-neutral visual Workbench. */
export interface WorkbenchRecordV2 {
  workbenchId: string
  name: string
  description: string
  /** User-defined discovery labels; persisted as a bounded, de-duplicated list. */
  tags?: string[]
  document: WorkbenchDocumentV3
  /** Only affects the manual Area picker; existing Areas remain available. */
  hiddenEditorIds?: string[]
  /** Workbench-local preference that disables split-ratio changes. */
  layoutLocked?: boolean
  createdAt: number
  updatedAt: number
  /** Optional import lineage used for safe creator re-export. */
  packageOrigin?: WorkbenchPackageOriginV1
  offlineOrigin?: { schemaVersion: 1; packageId: string; archiveSha256: string }
  externalBindings?: Record<string, WorkbenchExternalBindingRecordV1>
  pinnedAt?: number
  archivedAt?: number
}

/** A retained unsupported record. Its raw payload is preserved for export/recovery. */
export interface InvalidWorkbenchRecordV1 {
  workbenchId: string
  name: string
  description: string
  tags?: string[]
  createdAt?: number
  updatedAt?: number
  pinnedAt?: number
  archivedAt?: number
  rawRecord: unknown
}

/** A reusable snapshot that creates a new Workbench without owning its identity. */
export interface WorkbenchLayoutTemplateV1 {
  templateId: string
  name: string
  document: WorkbenchDocumentV3
  createdAt: number
  updatedAt: number
}

/** Persisted v3 Workbench namespace. */
export interface WorkbenchSettingsV4 {
  version: 4
  activeWorkbenchId: string
  openWorkbenchIds: string[]
  /** Global visibility preference for the inner-page menu. Legacy per-workbench
   * values remain on records so older packages and readers continue to work. */
  globalHiddenEditorIds?: string[]
  workbenches: Record<string, WorkbenchRecordV2>
  layoutTemplates: Record<string, WorkbenchLayoutTemplateV1>
  invalidWorkbenches: Record<string, InvalidWorkbenchRecordV1>
  sessionMarkers: Record<string, Record<string, SessionMarkerRecord>>
  toolGatewayPolicies?: Record<string, {
    visibility: Record<string, 'enabled' | 'disabled'>
    agentAllowlists: Record<string, string[]>
  }>
  /** Redacted Workbench-level usage summaries; DSH Session remains the detail source. */
  toolUsageAggregates?: Record<string, WorkbenchToolUsageAggregateV1>
  /** Gateway-owned redacted invocation aggregates. */
  toolGatewayUsageAggregates?: Record<string, WorkbenchToolGatewayUsageAggregateV1>
  /** User preference for routing resource actions emitted by Conversation. */
  interactionPolicy?: WorkbenchConversationInteractionPolicyV1
  /** Profile-local permission for third-party DSH bundles to contribute Workbench editors. */
  extensionConsents?: Record<string, WorkbenchExtensionConsentV1>
  /** Transient decoder signal; omitted from the atomic root replacement. */
  migrationRequired?: true
}

/** Live roster hints used only to choose the active Workbench during migration. */
export interface WorkbenchMigrationContext {
  currentSessionId?: string
  workspaces?: readonly {
    workspaceId: string
    name?: string
    title?: string
    sessionIds: readonly string[]
  }[]
}

/**
 * Decode v3 Settings or atomically migrate a complete v1/v2 namespace.
 * @param value - raw persisted Workbench namespace.
 * @param context - live Session and Workspace hints for active-layout selection.
 * @returns validated v3 Settings, or undefined for an invalid namespace.
 */
export function decodeWorkbenchSettingsV4(
  value: unknown,
  context: WorkbenchMigrationContext = {},
): WorkbenchSettingsV4 | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const candidate = value as { version?: unknown }
  if (candidate.version === 4) return decodeSettingsV4(value)
  if (candidate.version === 3) {
    const v3 = decodeSettingsV3(value)
    return v3 === undefined ? undefined : upgradeV3(v3)
  }
  const legacy = decodeWorkbenchSettings(value)
  if (legacy === undefined) return undefined
  const workbenches: Record<string, WorkbenchRecordV2> = {}
  const invalidWorkbenches: Record<string, InvalidWorkbenchRecordV1> = {}
  const workspaceNames = new Map((context.workspaces ?? []).map(workspace => [
    workspace.workspaceId, workspace.name ?? workspace.title ?? workspace.workspaceId,
  ]))
  for (const account of Object.keys(legacy.layouts).sort()) {
    const workbenchId = legacyWorkbenchId(account)
    const workspaceId = workspaceIdForAccount(account)
    const legacyDocument = legacy.layouts[account]
    /* v8 ignore next -- account came directly from Object.keys(legacy.layouts). */
    if (legacyDocument === undefined) continue
    workbenches[workbenchId] = {
      workbenchId,
      name: account === 'ungrouped'
        ? '默认工作台'
        : `${workspaceNames.get(workspaceId ?? '') ?? workspaceId} · 旧布局`,
      document: migrateDocumentV2ToV3(legacyDocument),
      description: '',
      createdAt: 0,
      updatedAt: 0,
    }
  }
  for (const [account, raw] of Object.entries(legacy.invalidLayouts)) {
    invalidWorkbenches[legacyWorkbenchId(account)] = retainedInvalid(legacyWorkbenchId(account), raw)
  }
  const preferredAccount = accountFor(context.currentSessionId, context.workspaces ?? [])
  const preferredId = legacyWorkbenchId(preferredAccount)
  const activeWorkbenchId = workbenches[preferredId] !== undefined
    ? preferredId
    : workbenches['legacy-ungrouped'] !== undefined
      ? 'legacy-ungrouped'
      : Object.keys(workbenches).sort()[0]
  if (activeWorkbenchId === undefined) return undefined
  return {
    version: 4,
    activeWorkbenchId,
    openWorkbenchIds: Object.keys(workbenches),
    workbenches,
    layoutTemplates: {},
    invalidWorkbenches,
    sessionMarkers: structuredClone(legacy.sessionMarkers),
    interactionPolicy: structuredClone(DEFAULT_WORKBENCH_CONVERSATION_INTERACTION_POLICY),
    migrationRequired: true,
  }
}

/** Backwards-compatible export for downstream packages while migration lands. */
export function decodeWorkbenchSettingsV3(value: unknown, context: WorkbenchMigrationContext = {}): WorkbenchSettingsV3 | undefined {
  if (isRecord(value) && value.version === 3) return decodeSettingsV3(value)
  const decoded = decodeWorkbenchSettingsV4(value, context)
  if (decoded === undefined) return undefined
  const workbenches: Record<string, WorkbenchRecordV1> = Object.fromEntries(
    Object.entries(decoded.workbenches).map(([id, record]) => [id, {
      workbenchId: record.workbenchId, name: record.name, document: record.document,
      createdAt: record.createdAt, updatedAt: record.updatedAt,
    }]),
  )
  return { version: 3, activeWorkbenchId: decoded.activeWorkbenchId, workbenches,
    layoutTemplates: decoded.layoutTemplates, invalidWorkbenches: Object.fromEntries(Object.entries(decoded.invalidWorkbenches).map(([id, row]) => [id, row.rawRecord])), sessionMarkers: decoded.sessionMarkers, migrationRequired: true }
}
export interface WorkbenchRecordV1 {
  workbenchId: string
  name: string
  document: WorkbenchDocumentV3
  createdAt: number
  updatedAt: number
}
export interface WorkbenchSettingsV3 {
  version: 3
  activeWorkbenchId: string
  workbenches: Record<string, WorkbenchRecordV1>
  layoutTemplates: Record<string, WorkbenchLayoutTemplateV1>
  invalidWorkbenches: Record<string, unknown>
  sessionMarkers: Record<string, Record<string, SessionMarkerRecord>>
  migrationRequired?: true
}

function retainedInvalid(workbenchId: string, raw: unknown): InvalidWorkbenchRecordV1 {
  const row = isRecord(raw) ? raw : {}
  const tags = decodeWorkbenchTags(row.tags) ?? []
  return {
    workbenchId,
    name: typeof row.name === 'string' && row.name.trim() ? row.name : workbenchId,
    description: typeof row.description === 'string' ? row.description : '',
    ...(tags.length === 0 ? {} : { tags }),
    ...(typeof row.createdAt === 'number' ? { createdAt: row.createdAt } : {}),
    ...(typeof row.updatedAt === 'number' ? { updatedAt: row.updatedAt } : {}),
    ...(typeof row.pinnedAt === 'number' ? { pinnedAt: row.pinnedAt } : {}),
    ...(typeof row.archivedAt === 'number' ? { archivedAt: row.archivedAt } : {}),
    rawRecord: structuredClone(raw),
  }
}

/** Normalize user-facing Workbench tags without allowing unbounded metadata. */
export function normalizeWorkbenchTags(value: readonly string[] | undefined): string[] {
  const result: string[] = []
  const seen = new Set<string>()
  for (const raw of value ?? []) {
    const tag = raw.trim().normalize('NFKC').slice(0, 32)
    if (tag === '') continue
    const key = tag.toLocaleLowerCase('zh-CN')
    if (seen.has(key)) continue
    seen.add(key)
    result.push(tag)
    if (result.length >= 12) break
  }
  return result
}

function decodeWorkbenchTags(value: unknown): string[] | undefined {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) return undefined
  return normalizeWorkbenchTags(value)
}

/**
 * Saved layout snapshots predate the Workbench lifecycle directory. Promote
 * them to ordinary, unloaded Workbench records so Settings, the top tab bar,
 * and the new-workbench menu all operate on one identity. The generated id is
 * deterministic and therefore safe to repeat when a migration is decoded
 * more than once.
 */
function promoteLayoutTemplates(
  templates: Record<string, WorkbenchLayoutTemplateV1>,
  workbenches: Record<string, WorkbenchRecordV2>,
  occupied: Readonly<Record<string, unknown>> = {},
): boolean {
  let promoted = false
  for (const [templateId, template] of Object.entries(templates)) {
    let workbenchId = `saved-layout-${encodeURIComponent(templateId)}`
    let suffix = 2
    while (workbenches[workbenchId] !== undefined || occupied[workbenchId] !== undefined) workbenchId = `saved-layout-${encodeURIComponent(templateId)}-${suffix++}`
    workbenches[workbenchId] = {
      workbenchId,
      name: template.name,
      description: '',
      document: structuredClone(template.document),
      createdAt: template.createdAt,
      updatedAt: template.updatedAt,
    }
    promoted = true
  }
  return promoted
}

function upgradeV3(value: WorkbenchSettingsV3): WorkbenchSettingsV4 {
  const workbenches: Record<string, WorkbenchRecordV2> = {}
  for (const [id, record] of Object.entries(value.workbenches)) {
    workbenches[id] = { ...record, description: '' }
  }
  // V3 workbench records were all loaded before the lifecycle directory
  // existed. Legacy layoutTemplates are promoted below, but they must remain
  // unloaded so they appear in Settings → Workbench → 未使用 instead of
  // unexpectedly changing the user's tab bar during migration.
  const open = Object.keys(workbenches)
  const invalidWorkbenches: Record<string, InvalidWorkbenchRecordV1> = {}
  for (const [id, raw] of Object.entries(value.invalidWorkbenches)) {
    invalidWorkbenches[id] = isRetainedInvalid(raw) ? structuredClone(raw) : retainedInvalid(id, raw)
  }
  promoteLayoutTemplates(value.layoutTemplates, workbenches, invalidWorkbenches)
  return {
    version: 4,
    activeWorkbenchId: workbenches[value.activeWorkbenchId] === undefined ? open[0] ?? '' : value.activeWorkbenchId,
    openWorkbenchIds: open,
    workbenches,
    layoutTemplates: {},
    invalidWorkbenches,
    sessionMarkers: value.sessionMarkers,
    interactionPolicy: structuredClone(DEFAULT_WORKBENCH_CONVERSATION_INTERACTION_POLICY),
    migrationRequired: true,
  }
}

function isRetainedInvalid(value: unknown): value is InvalidWorkbenchRecordV1 {
  return isRecord(value) && typeof value.workbenchId === 'string' && typeof value.name === 'string'
    && typeof value.description === 'string' && 'rawRecord' in value
}

function decodeSettingsV3(value: unknown): WorkbenchSettingsV3 | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const candidate = value as Record<string, unknown>
  if (candidate.version !== 3 || typeof candidate.activeWorkbenchId !== 'string'
    || typeof candidate.workbenches !== 'object' || candidate.workbenches === null
    || typeof candidate.invalidWorkbenches !== 'object' || candidate.invalidWorkbenches === null
    || typeof candidate.sessionMarkers !== 'object' || candidate.sessionMarkers === null) return undefined
  const workbenches: Record<string, WorkbenchRecordV1> = {}
  const layoutTemplates: Record<string, WorkbenchLayoutTemplateV1> = {}
  const invalidWorkbenches: Record<string, unknown> = {}
  let migrationRequired = candidate.migrationRequired === true
  for (const [key, raw] of Object.entries(
    candidate.invalidWorkbenches as Record<string, unknown>,
  )) invalidWorkbenches[key] = structuredClone(raw)
  for (const [key, raw] of Object.entries(candidate.workbenches as Record<string, unknown>)) {
    if (typeof raw !== 'object' || raw === null) {
      invalidWorkbenches[key] = structuredClone(raw)
      continue
    }
    const record = raw as Record<string, unknown>
    const document = validateWorkbenchDocumentV3(record.document)
    if (record.workbenchId !== key || typeof record.name !== 'string'
      || typeof record.createdAt !== 'number' || !Number.isFinite(record.createdAt)
      || typeof record.updatedAt !== 'number' || !Number.isFinite(record.updatedAt)
      || document === undefined) {
      invalidWorkbenches[key] = structuredClone(raw)
      continue
    }
    const retiredCleaned = removeRetiredWorkbenchEditors(document)
    const normalized = normalizeWorkbenchDocument(retiredCleaned)
    if (retiredCleaned !== document || normalized !== retiredCleaned) migrationRequired = true
    workbenches[key] = {
      workbenchId: key, name: record.name, document: normalized,
      createdAt: record.createdAt, updatedAt: record.updatedAt,
    }
  }
  const rawTemplates = candidate.layoutTemplates
  if (rawTemplates !== undefined && (!isRecord(rawTemplates))) return undefined
  for (const [key, raw] of Object.entries(rawTemplates ?? {})) {
    if (!isRecord(raw)) return undefined
    const document = validateWorkbenchDocumentV3(raw.document)
    if (raw.templateId !== key || typeof raw.name !== 'string'
      || typeof raw.createdAt !== 'number' || !Number.isFinite(raw.createdAt)
      || typeof raw.updatedAt !== 'number' || !Number.isFinite(raw.updatedAt)
      || document === undefined) return undefined
    const retiredCleaned = removeRetiredWorkbenchEditors(document)
    const normalized = normalizeWorkbenchDocument(retiredCleaned)
    if (retiredCleaned !== document || normalized !== retiredCleaned) migrationRequired = true
    layoutTemplates[key] = {
      templateId: key,
      name: raw.name,
      document: normalized,
      createdAt: raw.createdAt,
      updatedAt: raw.updatedAt,
    }
  }
  if (workbenches[candidate.activeWorkbenchId] === undefined) return undefined
  return {
    version: 3,
    activeWorkbenchId: candidate.activeWorkbenchId,
    workbenches,
    layoutTemplates,
    invalidWorkbenches,
    sessionMarkers: decodeSessionMarkers(candidate.sessionMarkers),
    ...(migrationRequired ? { migrationRequired: true } : {}),
  }
}

function decodeSettingsV4(value: unknown): WorkbenchSettingsV4 | undefined {
  if (!isRecord(value) || value.version !== 4 || typeof value.activeWorkbenchId !== 'string'
    || !Array.isArray(value.openWorkbenchIds) || !isRecord(value.workbenches)
    || !isRecord(value.invalidWorkbenches) || !isRecord(value.sessionMarkers)) return undefined
  const globalHiddenEditorIds = decodeWorkbenchHiddenEditorIds(value.globalHiddenEditorIds)
  if (globalHiddenEditorIds === undefined) return undefined
  const extensionConsents = decodeWorkbenchExtensionConsents(value.extensionConsents)
  if (extensionConsents === undefined) return undefined
  const toolGatewayPolicies = decodeToolGatewayPolicies(value.toolGatewayPolicies)
  if (toolGatewayPolicies === undefined) return undefined
  const toolUsageAggregates = decodeToolUsageAggregates(value.toolUsageAggregates)
  if (toolUsageAggregates === undefined) return undefined
  const toolGatewayUsageAggregates = decodeToolGatewayUsageAggregates(value.toolGatewayUsageAggregates)
  if (toolGatewayUsageAggregates === undefined) return undefined
  const workbenches: Record<string, WorkbenchRecordV2> = {}
  const invalidWorkbenches: Record<string, InvalidWorkbenchRecordV1> = {}
  let migrationRequired = value.migrationRequired === true || !isRecord(value.interactionPolicy) || value.interactionPolicy.version !== 2
  for (const [key, raw] of Object.entries(value.workbenches)) {
    if (!isRecord(raw)) { invalidWorkbenches[key] = retainedInvalid(key, raw); continue }
    const document = validateWorkbenchDocumentV3(raw.document)
    if (raw.workbenchId !== key || typeof raw.name !== 'string' || typeof raw.description !== 'string'
      || typeof raw.createdAt !== 'number' || !Number.isFinite(raw.createdAt)
      || typeof raw.updatedAt !== 'number' || !Number.isFinite(raw.updatedAt) || document === undefined) {
      invalidWorkbenches[key] = retainedInvalid(key, raw); continue
    }
    if ((raw.pinnedAt !== undefined && (typeof raw.pinnedAt !== 'number' || !Number.isFinite(raw.pinnedAt)))
      || (raw.archivedAt !== undefined && (typeof raw.archivedAt !== 'number' || !Number.isFinite(raw.archivedAt)))) {
      invalidWorkbenches[key] = retainedInvalid(key, raw); continue
    }
    const tags = decodeWorkbenchTags(raw.tags)
    if (tags === undefined) { invalidWorkbenches[key] = retainedInvalid(key, raw); continue }
    const hiddenEditorIds = decodeWorkbenchHiddenEditorIds(raw.hiddenEditorIds)
    if (hiddenEditorIds === undefined) { invalidWorkbenches[key] = retainedInvalid(key, raw); continue }
    if (raw.layoutLocked !== undefined && typeof raw.layoutLocked !== 'boolean') {
      invalidWorkbenches[key] = retainedInvalid(key, raw); continue
    }
    const packageOrigin = raw.packageOrigin === undefined ? undefined : decodePackageOrigin(raw.packageOrigin)
    const offlineOrigin = raw.offlineOrigin
    if (offlineOrigin !== undefined && (!isRecord(offlineOrigin) || offlineOrigin.schemaVersion !== 1
      || typeof offlineOrigin.packageId !== 'string' || !/^[a-f0-9]{64}$/u.test(offlineOrigin.packageId)
      || typeof offlineOrigin.archiveSha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(offlineOrigin.archiveSha256)
      || Object.keys(offlineOrigin).length !== 3)) { invalidWorkbenches[key] = retainedInvalid(key, raw); continue }
    if (raw.packageOrigin !== undefined && packageOrigin === undefined) {
      invalidWorkbenches[key] = retainedInvalid(key, raw)
      continue
    }
    const externalBindings = raw.externalBindings === undefined ? undefined : decodeExternalBindings(raw.externalBindings)
    if (raw.externalBindings !== undefined && externalBindings === undefined) {
      invalidWorkbenches[key] = retainedInvalid(key, raw)
      continue
    }
    const retiredCleaned = removeRetiredWorkbenchEditors(document)
    const normalized = normalizeWorkbenchDocument(retiredCleaned)
    if (retiredCleaned !== document || normalized !== retiredCleaned) migrationRequired = true
    workbenches[key] = {
      workbenchId: key, name: raw.name, description: raw.description,
      document: normalized, createdAt: raw.createdAt, updatedAt: raw.updatedAt,
      ...(hiddenEditorIds.length === 0 ? {} : { hiddenEditorIds }),
      ...(raw.layoutLocked === true ? { layoutLocked: true } : {}),
      ...(tags.length === 0 ? {} : { tags }),
      ...(packageOrigin === undefined ? {} : { packageOrigin }),
      ...(offlineOrigin === undefined ? {} : { offlineOrigin: { schemaVersion: 1, packageId: offlineOrigin.packageId as string, archiveSha256: offlineOrigin.archiveSha256 as string } }),
      ...(externalBindings === undefined ? {} : { externalBindings }),
      ...(raw.pinnedAt === undefined ? {} : { pinnedAt: raw.pinnedAt }),
      ...(raw.archivedAt === undefined ? {} : { archivedAt: raw.archivedAt }),
    }
  }
  for (const [key, raw] of Object.entries(value.invalidWorkbenches)) {
    invalidWorkbenches[key] = isRetainedInvalid(raw) ? structuredClone(raw) : retainedInvalid(key, raw)
  }
  const requestedOpen = value.openWorkbenchIds.filter((id): id is string => typeof id === 'string')
  if (requestedOpen.length !== value.openWorkbenchIds.length || new Set(requestedOpen).size !== requestedOpen.length) return undefined
  const open = requestedOpen.filter(id => workbenches[id] !== undefined && workbenches[id].archivedAt === undefined)
  let activeWorkbenchId = value.activeWorkbenchId
  const runnable = Object.values(workbenches)
    .filter(record => record.archivedAt === undefined)
    .sort((left, right) => right.updatedAt - left.updatedAt)
  // An empty open list is the persisted Workbench Home state. Keep the last
  // selected runnable id as a resumable reference without opening it.
  if (requestedOpen.length === 0) {
    if (workbenches[activeWorkbenchId]?.archivedAt !== undefined || workbenches[activeWorkbenchId] === undefined) {
      migrationRequired = true
      activeWorkbenchId = runnable[0]?.workbenchId ?? ''
    }
  // Preserve unreadable records while recovering a runnable selection. Returning
  // undefined lets the Settings mirror retain stale decoded data at a new revision.
  } else if (open.length !== requestedOpen.length || !open.includes(activeWorkbenchId)) {
    migrationRequired = true
    if (!open.includes(activeWorkbenchId)) activeWorkbenchId = open[0] ?? Object.keys(workbenches).find(id => workbenches[id]?.archivedAt === undefined) ?? ''
    if (activeWorkbenchId === '') {
      activeWorkbenchId = 'recovered-workbench'
      for (let suffix = 2; workbenches[activeWorkbenchId] !== undefined || invalidWorkbenches[activeWorkbenchId] !== undefined; suffix += 1) {
        activeWorkbenchId = `recovered-workbench-${String(suffix)}`
      }
      workbenches[activeWorkbenchId] = {
        workbenchId: activeWorkbenchId, name: '恢复工作台', description: '', createdAt: 0, updatedAt: 0,
        document: { version: 3, root: { kind: 'area', areaId: 'group-main', moduleHistory: [] }, activeAreaId: 'group-main' },
      }
    }
    if (!open.includes(activeWorkbenchId)) open.push(activeWorkbenchId)
  }
  const layoutTemplates: Record<string, WorkbenchLayoutTemplateV1> = {}
  for (const [key, raw] of Object.entries(isRecord(value.layoutTemplates) ? value.layoutTemplates : {})) {
    if (!isRecord(raw)) return undefined
    const document = validateWorkbenchDocumentV3(raw.document)
    if (raw.templateId !== key || typeof raw.name !== 'string' || typeof raw.createdAt !== 'number' || typeof raw.updatedAt !== 'number' || document === undefined) return undefined
    const retiredCleaned = removeRetiredWorkbenchEditors(document)
    const normalized = normalizeWorkbenchDocument(retiredCleaned)
    if (retiredCleaned !== document || normalized !== retiredCleaned) migrationRequired = true
    layoutTemplates[key] = { templateId: key, name: raw.name, document: normalized, createdAt: raw.createdAt, updatedAt: raw.updatedAt }
  }
  const promotedTemplates = promoteLayoutTemplates(layoutTemplates, workbenches, invalidWorkbenches)
  if (promotedTemplates) migrationRequired = true
  // An explicit empty global preference is authoritative.
  const legacyHiddenEditorIds = workbenches[activeWorkbenchId]?.hiddenEditorIds ?? []
  const migrateLegacyVisibility = value.globalHiddenEditorIds === undefined
  const migratedGlobalHiddenEditorIds = migrateLegacyVisibility
    ? [...legacyHiddenEditorIds]
    : globalHiddenEditorIds
  return { version: 4, activeWorkbenchId, openWorkbenchIds: open,
    globalHiddenEditorIds: migratedGlobalHiddenEditorIds,
    workbenches, layoutTemplates: {}, invalidWorkbenches, sessionMarkers: decodeSessionMarkers(value.sessionMarkers),
    interactionPolicy: migrateWorkbenchInteractionPolicy(value.interactionPolicy),
    ...(Object.keys(extensionConsents).length === 0 ? {} : { extensionConsents }),
    ...(Object.keys(toolGatewayPolicies).length === 0 ? {} : { toolGatewayPolicies }),
    ...(Object.keys(toolUsageAggregates).length === 0 ? {} : { toolUsageAggregates }),
    ...(Object.keys(toolGatewayUsageAggregates).length === 0 ? {} : { toolGatewayUsageAggregates }),
    ...(migrateLegacyVisibility || migrationRequired ? { migrationRequired: true } : {}) }
}

function decodeToolGatewayPolicies(value: unknown): WorkbenchSettingsV4['toolGatewayPolicies'] | undefined {
  if (value === undefined) return {}
  if (!isRecord(value)) return undefined
  const result: NonNullable<WorkbenchSettingsV4['toolGatewayPolicies']> = {}
  for (const [workbenchId, raw] of Object.entries(value)) {
    if (workbenchId.length < 1 || workbenchId.length > 128 || !isRecord(raw)
      || !isRecord(raw.visibility) || !isRecord(raw.agentAllowlists)) return undefined
    const visibility: Record<string, 'enabled' | 'disabled'> = {}
    for (const [toolId, state] of Object.entries(raw.visibility)) {
      if (!/^[a-z0-9][a-z0-9._:-]{0,127}$/iu.test(toolId) || (state !== 'enabled' && state !== 'disabled')) return undefined
      visibility[toolId] = state
    }
    const agentAllowlists: Record<string, string[]> = {}
    for (const [agentId, toolIds] of Object.entries(raw.agentAllowlists)) {
      if (!/^[a-z0-9][a-z0-9._:-]{0,127}$/iu.test(agentId) || !Array.isArray(toolIds)
        || toolIds.some(toolId => typeof toolId !== 'string' || !/^[a-z0-9][a-z0-9._:-]{0,127}$/iu.test(toolId))
        || new Set(toolIds).size !== toolIds.length) return undefined
      agentAllowlists[agentId] = [...toolIds].sort()
    }
    result[workbenchId] = { visibility, agentAllowlists }
  }
  return result
}

function decodeToolUsageAggregates(value: unknown): WorkbenchSettingsV4['toolUsageAggregates'] | undefined {
  if (value === undefined) return {}
  if (!isRecord(value)) return undefined
  const result: NonNullable<WorkbenchSettingsV4['toolUsageAggregates']> = {}
  for (const [workbenchId, raw] of Object.entries(value)) {
    if (!isRecord(raw) || raw.schemaVersion !== 1 || raw.retentionDays !== 30
      || typeof raw.updatedAt !== 'string' || !Number.isFinite(new Date(raw.updatedAt).getTime())
      || !isRecord(raw.totals) || !Array.isArray(raw.byTool) || !Array.isArray(raw.buckets)) return undefined
    const totals = raw.totals as Record<string, unknown>
    const numberFields = ['calls', 'successes', 'failures', 'cancelled', 'timeouts', 'totalDurationMs'] as const
    if (!numberFields.every(field => typeof totals[field] === 'number' && Number.isFinite(totals[field] as number) && (totals[field] as number) >= 0)) return undefined
    const rawByContainer = raw.byContainer
    let byContainer: Array<Record<string, unknown>> | undefined
    if (rawByContainer !== undefined) {
      if (!Array.isArray(rawByContainer)) return undefined
      byContainer = rawByContainer.filter(isRecord).map(item => ({ ...item }))
      if (byContainer.length !== rawByContainer.length) return undefined
    }
    const byTool = raw.byTool.filter(isRecord).map(item => ({ ...item }))
    const buckets = raw.buckets.filter(isRecord).map(item => ({ ...item }))
    if (byTool.length !== raw.byTool.length || buckets.length !== raw.buckets.length) return undefined
    result[workbenchId] = {
      schemaVersion: 1,
      updatedAt: raw.updatedAt,
      retentionDays: 30,
      totals: totals as unknown as WorkbenchToolUsageAggregateV1['totals'],
      ...(byContainer === undefined ? {} : { byContainer: byContainer as unknown as NonNullable<WorkbenchToolUsageAggregateV1['byContainer']> }),
      byTool: byTool as unknown as WorkbenchToolUsageAggregateV1['byTool'],
      buckets: buckets as unknown as WorkbenchToolUsageAggregateV1['buckets'],
    }
  }
  return result
}

function decodeToolGatewayUsageAggregates(value: unknown): WorkbenchSettingsV4['toolGatewayUsageAggregates'] | undefined {
  if (value === undefined) return {}
  if (!isRecord(value)) return undefined
  const result: NonNullable<WorkbenchSettingsV4['toolGatewayUsageAggregates']> = {}
  for (const [workbenchId, raw] of Object.entries(value)) {
    if (!isRecord(raw) || raw.schemaVersion !== 1 || raw.retentionDays !== 30 || typeof raw.updatedAt !== 'string'
      || !Number.isFinite(new Date(raw.updatedAt).getTime()) || !isRecord(raw.totals) || !Array.isArray(raw.byTool) || !Array.isArray(raw.buckets)) return undefined
    const totals = raw.totals as Record<string, unknown>
    const fields = ['calls', 'successes', 'failures', 'rejected', 'cancelled', 'timeouts', 'incomplete', 'totalDurationMs']
    if (!fields.every(field => typeof totals[field] === 'number' && Number.isFinite(totals[field] as number) && (totals[field] as number) >= 0)) return undefined
    result[workbenchId] = raw as unknown as WorkbenchToolGatewayUsageAggregateV1
  }
  return result
}

export function decodeWorkbenchExtensionConsents(value: unknown): Record<string, WorkbenchExtensionConsentV1> | undefined {
  if (value === undefined) return {}
  if (!isRecord(value)) return undefined
  const entries = Object.entries(value)
  if (entries.length > 128) return undefined
  const result: Record<string, WorkbenchExtensionConsentV1> = {}
  for (const [key, raw] of entries) {
    if (!isRecord(raw)) return undefined
    if (typeof raw.packageName !== 'string' || raw.packageName.length < 1 || raw.packageName.length > 214
      || typeof raw.moduleId !== 'string' || !/^[a-zA-Z0-9._:-]{1,128}$/u.test(raw.moduleId)
      || raw.apiVersion !== 1 || typeof raw.contractFingerprint !== 'string' || !/^[a-f0-9]{32}$/u.test(raw.contractFingerprint)
      || typeof raw.allowedAt !== 'number' || !Number.isFinite(raw.allowedAt)
      || (raw.allowed !== undefined && typeof raw.allowed !== 'boolean')
      || key !== `${raw.packageName}::${raw.moduleId}`) return undefined
    const editorIds = raw.editorIds === undefined ? [] : decodeWorkbenchExtensionEditorIds(raw.editorIds)
    if (editorIds === undefined) return undefined
    result[key] = {
      packageName: raw.packageName, moduleId: raw.moduleId, apiVersion: 1,
      editorIds, contractFingerprint: raw.contractFingerprint, allowedAt: raw.allowedAt,
      allowed: raw.allowed ?? true,
    }
  }
  return result
}

function decodeWorkbenchExtensionEditorIds(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || value.length > 32
    || !value.every((id): id is string => typeof id === 'string' && /^[a-zA-Z0-9._:-]{1,128}$/u.test(id))) return undefined
  return [...new Set(value)].sort()
}

export function decodeWorkbenchHiddenEditorIds(value: unknown): string[] | undefined {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > 128
    || !value.every((id): id is string => typeof id === 'string' && /^[a-zA-Z0-9._:-]{1,128}$/u.test(id))) return undefined
  return [...new Set(value)].sort()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function decodeExternalBindings(value: unknown): Record<string, WorkbenchExternalBindingRecordV1> | undefined {
  if (!isRecord(value)) return undefined
  const result: Record<string, WorkbenchExternalBindingRecordV1> = {}
  for (const [id, raw] of Object.entries(value)) {
    if (!/^[A-Za-z0-9._:-]{1,96}$/u.test(id) || !isRecord(raw)
      || !['model', 'credential', 'workspace', 'session', 'mcp', 'filesystem'].includes(raw.kind as string)
      || typeof raw.reference !== 'string' || raw.reference.trim() === '' || raw.reference.length > 512
      || /^[A-Za-z]:[\\/]/u.test(raw.reference)
      || /(?:api[-_]?key|token|password|secret|credential|transcript|session[-_]?id|workspace[-_]?id|machine[-_]?id|(?:^|[\\/])(?:Users|home|var|etc)(?:[\\/]|$))/iu.test(raw.reference)) return undefined
    result[id] = { kind: raw.kind as WorkbenchExternalBindingRecordV1['kind'], reference: raw.reference }
  }
  return result
}

function decodePackageOrigin(value: unknown): WorkbenchPackageOriginV1 | undefined {
  if (!isRecord(value) || typeof value.packageId !== 'string' || value.packageId.trim() === ''
    || typeof value.version !== 'string' || value.version.trim() === ''
    || typeof value.archiveSha256 !== 'string' || !/^[a-f0-9]{64}$/iu.test(value.archiveSha256)
    || (value.completeness !== undefined && !['layout-only', 'complete-online', 'complete-offline'].includes(value.completeness as string))
    || !Array.isArray(value.dependencies)) return undefined
  const dependencies: WorkbenchPackageOriginV1['dependencies'][number][] = []
  for (const raw of value.dependencies) {
    if (!isRecord(raw) || typeof raw.portableId !== 'string' || raw.portableId.trim() === ''
      || typeof raw.version !== 'string' || raw.version.trim() === ''
      || typeof raw.digest !== 'string' || (raw.digest !== '' && !/^[a-f0-9]{64}$/iu.test(raw.digest))
      || !['static', 'dynamic', 'shared', 'agent-preset'].includes(raw.kind as string)
      || !['source-included', 'binary-only', 'remote'].includes(raw.sourcePolicy as string)
      || !['embed', 'reference', 'forbid'].includes(raw.exportPolicy as string)
      || !Array.isArray(raw.editorIds) || !raw.editorIds.every(item => typeof item === 'string')
      || (raw.editorScopes !== undefined && (!Array.isArray(raw.editorScopes)
        || !raw.editorScopes.every(scope => isRecord(scope)
          && typeof scope.editorId === 'string'
          && (raw.editorIds as unknown[]).includes(scope.editorId)
          && (scope.scope === 'root' || scope.scope === 'session'))
        || new Set(raw.editorScopes.map(scope => isRecord(scope) ? `${String(scope.scope)}:${String(scope.editorId)}` : '')).size !== raw.editorScopes.length
        || new Set(raw.editorScopes.map(scope => isRecord(scope) ? String(scope.editorId) : '')).size !== (raw.editorIds as unknown[]).length))
      || !Array.isArray(raw.permissions) || !raw.permissions.every(item => typeof item === 'string')
      || !Array.isArray(raw.requiredBy) || !raw.requiredBy.every(item => typeof item === 'string')) return undefined
    if (raw.packageName !== undefined && (typeof raw.packageName !== 'string' || raw.packageName.trim() === ''
      || raw.packageName.length > 214 || /\s/u.test(raw.packageName)
      || !(/^[a-z0-9._~-]+$/u.test(raw.packageName) || /^@[a-z0-9._~-]+\/[a-z0-9._~-]+$/u.test(raw.packageName)))) return undefined
    if (raw.registryUrl !== undefined && typeof raw.registryUrl !== 'string') return undefined
    if (typeof raw.registryUrl === 'string') {
      try {
        const url = new URL(raw.registryUrl)
        if (url.protocol !== 'https:' && !(url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]'))) return undefined
      } catch { return undefined }
    }
    if (raw.integrity !== undefined && (typeof raw.integrity !== 'string' || !/^(?:sha512|sha256)-[A-Za-z0-9+/]+={0,2}$/u.test(raw.integrity))) return undefined
    if (raw.installSource !== undefined && !['npm', 'registry', 'embedded', 'local'].includes(raw.installSource as string)) return undefined
    if ((raw.installSource === 'npm' || raw.installSource === 'registry')
      && (typeof raw.packageName !== 'string' || typeof raw.registryUrl !== 'string')) return undefined
    if (raw.clientEntry !== undefined && typeof raw.clientEntry !== 'string') return undefined
    if (raw.hostEntry !== undefined && typeof raw.hostEntry !== 'string') return undefined
    if (raw.agentPresetId !== undefined && typeof raw.agentPresetId !== 'string') return undefined
    dependencies.push({
      portableId: raw.portableId, version: raw.version, digest: raw.digest,
      kind: raw.kind as WorkbenchPackageOriginV1['dependencies'][number]['kind'],
      sourcePolicy: raw.sourcePolicy as WorkbenchPackageOriginV1['dependencies'][number]['sourcePolicy'],
      exportPolicy: raw.exportPolicy as WorkbenchPackageOriginV1['dependencies'][number]['exportPolicy'],
      editorIds: [...raw.editorIds] as string[], permissions: [...raw.permissions] as string[],
      ...(raw.editorScopes === undefined ? {} : {
        editorScopes: raw.editorScopes.map(scope => ({
          editorId: (scope as Record<string, unknown>).editorId as string,
          scope: (scope as Record<string, unknown>).scope as 'root' | 'session',
        })),
      }),
      requiredBy: [...raw.requiredBy] as string[],
      ...(raw.packageName === undefined ? {} : { packageName: raw.packageName }),
      ...(raw.registryUrl === undefined ? {} : { registryUrl: raw.registryUrl }),
      ...(raw.integrity === undefined ? {} : { integrity: raw.integrity }),
      ...(raw.installSource === undefined ? {} : { installSource: raw.installSource as 'npm' | 'registry' | 'embedded' | 'local' }),
      ...(raw.clientEntry === undefined ? {} : { clientEntry: raw.clientEntry }),
      ...(raw.hostEntry === undefined ? {} : { hostEntry: raw.hostEntry }),
      ...(raw.agentPresetId === undefined ? {} : { agentPresetId: raw.agentPresetId }),
    })
  }
  return {
    packageId: value.packageId, version: value.version, archiveSha256: value.archiveSha256,
    ...(value.completeness === undefined ? {} : { completeness: value.completeness as NonNullable<WorkbenchPackageOriginV1['completeness']> }),
    dependencies,
  }
}

/**
 * Produce the deterministic ID used when a legacy account becomes a Workbench.
 * @param account - legacy account key.
 * @returns stable migrated Workbench identifier.
 */
export function legacyWorkbenchId(account: string): string {
  if (account === 'ungrouped') return 'legacy-ungrouped'
  return `legacy-${encodeURIComponent(account).replace(/%3A/gi, '-').replace(/%/g, '_')}`
}

function workspaceIdForAccount(account: string): string | undefined {
  return account.startsWith('workspace:') ? account.slice('workspace:'.length) : undefined
}

/** Decode Settings data while retaining unsupported layouts for diagnostics.
 * @param value - raw namespace value.
 * @returns decoded settings or undefined for an invalid namespace.
 */
export function decodeWorkbenchSettings(value: unknown): WorkbenchSettings | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const candidate = value as { version?: unknown; layouts?: unknown; invalidLayouts?: unknown; sessionMarkers?: unknown }
  if ((candidate.version !== 1 && candidate.version !== 2)
    || typeof candidate.layouts !== 'object' || candidate.layouts === null) return undefined
  if (candidate.version === 2 && (
    typeof candidate.invalidLayouts !== 'object' || candidate.invalidLayouts === null
    || typeof candidate.sessionMarkers !== 'object' || candidate.sessionMarkers === null
  )) return undefined
  const layouts: Record<string, WorkbenchLayoutDocument> = {}
  const invalidLayouts: Record<string, unknown> = {}
  for (const [key, document] of Object.entries(candidate.layouts)) {
    const decoded = validateLayout(structuredClone(document), key)
    if (decoded !== undefined) layouts[key] = migrateOuterShellEditors(decoded)
    else invalidLayouts[key] = structuredClone(document)
  }
  if (candidate.version === 2 && typeof candidate.invalidLayouts === 'object'
    && candidate.invalidLayouts !== null) {
    for (const [key, document] of Object.entries(candidate.invalidLayouts)) {
      if (layouts[key] === undefined) invalidLayouts[key] = structuredClone(document)
    }
  }
  const sessionMarkers = decodeSessionMarkers(candidate.sessionMarkers)
  return {
    version: 2, layouts, invalidLayouts, sessionMarkers,
    ...(candidate.version === 1 ? { migrationRequired: true as const } : {}),
  }
}

function decodeSessionMarkers(value: unknown): WorkbenchSettings['sessionMarkers'] {
  if (typeof value !== 'object' || value === null) return {}
  const result: WorkbenchSettings['sessionMarkers'] = {}
  for (const [workspaceId, rows] of Object.entries(value)) {
    if (typeof rows !== 'object' || rows === null) continue
    const accepted: Record<string, SessionMarkerRecord> = {}
    for (const [sessionId, marker] of Object.entries(rows as Record<string, unknown>)) {
      if (typeof marker !== 'object' || marker === null) continue
      const row = marker as Partial<SessionMarkerRecord>
      if (typeof row.label === 'string' && typeof row.accentToken === 'string'
        && typeof row.customized === 'boolean') accepted[sessionId] = { ...row } as SessionMarkerRecord
    }
    result[workspaceId] = accepted
  }
  return result
}

/** Resolve the Workspace Account containing one Session.
 * @param sessionId - target Session id, or undefined for the ungrouped account.
 * @param workspaces - Workspace roster and Session membership.
 * @returns the matching account key.
 */
export function accountFor(
  sessionId: string | undefined,
  workspaces: readonly { workspaceId: string; sessionIds: readonly string[] }[],
): WorkspaceAccountKey {
  if (sessionId === undefined) return 'ungrouped'
  const workspace = workspaces.find(item => item.sessionIds.includes(sessionId))
  return workspace === undefined ? 'ungrouped' : `workspace:${workspace.workspaceId}`
}
