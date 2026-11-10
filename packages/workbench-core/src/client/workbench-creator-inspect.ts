import type {
  SettingsScope, SettingsScopeSnapshot,
} from './workbench-settings-contracts.ts'
import { areasOf, type AreaNode, type ModuleInstanceDocument, type WorkbenchNodeV3 } from '../foundation/document-v3.ts'
import type { WorkbenchEditorCatalog, WorkbenchEditorCatalogRow } from '../foundation/catalog.ts'
import type { JsonValue } from '../foundation/model.ts'
import type { WorkbenchAreaOwnershipV1, WorkbenchSettingsV4 } from '../foundation/persistence.ts'
import { areaContextOf, workbenchContextOf, type AreaContextV1, type WorkbenchContextV1 } from '../foundation/workbench-context.ts'

/** Versioned, bounded read model exposed to Workbench Creator agents. */
export interface WorkbenchCreatorInspectSnapshotV1 {
  version: 1
  source: {
    status: 'ready' | 'loading' | 'error' | 'offline' | 'unknown'
    writable: boolean
    revision?: number
    migrationRequired: boolean
  }
  workbenches: {
    activeWorkbenchId?: string
    openWorkbenchIds: readonly string[]
    counts: { open: number; unused: number; archived: number; unavailable: number }
    rows: readonly WorkbenchCreatorWorkbenchRowV1[]
  }
  current?: WorkbenchCreatorCurrentV1
  editors: readonly WorkbenchCreatorEditorV1[]
  supportedIntents: readonly string[]
}

export interface WorkbenchCreatorWorkbenchRowV1 {
  workbenchId: string
  name: string
  description: string
  createdAt?: number
  updatedAt?: number
  pinned: boolean
  archived: boolean
  availability: 'available' | 'unavailable'
  loaded: boolean
}

export interface WorkbenchCreatorCurrentV1 {
  workbenchId: string
  name: string
  description: string
  createdAt: number
  updatedAt: number
  context: WorkbenchContextV1
  document: WorkbenchCreatorLayoutNodeV1
  activeAreaId: string
  projects?: readonly import('../workbench-directory-contract.ts').WorkbenchProjectV1[]
  areas: readonly WorkbenchCreatorAreaV1[]
}

export type WorkbenchCreatorLayoutNodeV1 =
  | {
    kind: 'split'
    id: string
    axis: 'horizontal' | 'vertical'
    ratio: number
    first: WorkbenchCreatorLayoutNodeV1
    second: WorkbenchCreatorLayoutNodeV1
  }
  | {
    kind: 'area'
    id: string
    ordinal: number
  }

export interface WorkbenchCreatorAreaV1 {
  areaId: string
  projectId?: string
  ordinal: number
  active: boolean
  historyCount: number
  label?: string
  ownership: WorkbenchAreaOwnershipV1
  context: AreaContextV1
  current?: WorkbenchCreatorModuleV1
}

export interface WorkbenchCreatorModuleV1 {
  moduleInstanceId: string
  editorId: string
  scope: 'root' | 'session'
  title: string
  available: boolean
  pluginId?: string
  preview?: { version: number }
  binding?: {
    workspaceId?: string
    sessionId: string
    state: WorkbenchCreatorBindingState
    workspaceTitle?: string
    sessionTitle?: string
    running?: boolean
    updatedAt?: number
    agentPreset?: string
    model?: {
      provider?: string
      model?: string
      modelLabel?: string
      reasoningEffort?: string
      reasoningEffortLabel?: string
      routable: boolean | null
      status: string
    }
  }
  /** Values are private to the editor; inspection reports presence only. */
  state: { present: boolean; kind: string }
}

export type WorkbenchCreatorBindingState = 'bound' | 'unbound' | 'missing' | 'unknown'

/** A minimal structural face so Workbench stays optional beside Cordis. */
export interface WorkbenchCreatorInspectRegistryLike {
  register(registration: WorkbenchCreatorInspectProviderRegistrationV1): () => void
}

export interface WorkbenchCreatorInspectProviderRegistrationV1 {
  manifest: {
    id: string
    description: string
    methods: readonly [{
      name: string
      description: string
      inputSchema: JsonValue
      outputSchema: JsonValue
    }]
  }
  query(method: string, input: JsonValue | undefined): Promise<JsonValue>
}

export interface WorkbenchCreatorInspectOptions {
  settings: SettingsScope<WorkbenchSettingsV4>
  editorCatalog: WorkbenchEditorCatalog
  sessions?: {
    list: {
      getSnapshot(): {
        byId: Record<string, {
          displayTitle: string
          running: boolean
          updatedAt: number
          agentPreset?: string
        } | undefined>
        ids: readonly string[]
      }
      subscribe(listener: () => void): () => void
    }
  }
  workspaces?: {
    list: {
      getSnapshot(): {
        items: readonly {
          workspaceId: string
          title?: string
          path?: string
          sessionIds: readonly string[]
        }[]
        archivedSessionIds: readonly string[]
      }
      subscribe(listener: () => void): () => void
    }
  }
  modelSelectionSource?: {
    get(sessionId: string): {
      provider?: string
      model?: string
      modelLabel?: string
      reasoningEffort?: string
      reasoningEffortLabel?: string
      routable: boolean | null
      status: string
    } | undefined
  }
}

const EMPTY_INPUT: JsonValue = { type: 'object', properties: {}, additionalProperties: false }

/**
 * Build the only model-facing Workbench context. This intentionally reads the
 * V4 Settings source and the live catalog instead of the Frame's V2 React
 * projection, so a Creator can never mistake compatibility data for authority.
 */
export function deriveWorkbenchCreatorInspectSnapshot(
  options: WorkbenchCreatorInspectOptions,
): WorkbenchCreatorInspectSnapshotV1 {
  const source = options.settings.getSnapshot() as SettingsScopeSnapshot<WorkbenchSettingsV4>
  const value = source.value
  const rows: WorkbenchCreatorWorkbenchRowV1[] = []
  const openWorkbenchIds = value?.openWorkbenchIds ?? []
  const open = new Set(openWorkbenchIds)
  for (const record of Object.values(value?.workbenches ?? {})) {
    rows.push({
      workbenchId: record.workbenchId,
      name: record.name,
      description: record.description,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      pinned: record.pinnedAt !== undefined,
      archived: record.archivedAt !== undefined,
      availability: 'available',
      loaded: open.has(record.workbenchId),
    })
  }
  for (const record of Object.values(value?.invalidWorkbenches ?? {})) {
    rows.push({
      workbenchId: record.workbenchId,
      name: record.name,
      description: record.description,
      ...(record.createdAt === undefined ? {} : { createdAt: record.createdAt }),
      ...(record.updatedAt === undefined ? {} : { updatedAt: record.updatedAt }),
      pinned: record.pinnedAt !== undefined,
      archived: record.archivedAt !== undefined,
      availability: 'unavailable',
      loaded: false,
    })
  }
  const counts = { open: 0, unused: 0, archived: 0, unavailable: 0 }
  for (const row of rows) {
    if (row.availability === 'unavailable') {
      counts.unavailable += 1
      if (row.archived) counts.archived += 1
    } else if (row.archived) counts.archived += 1
    else if (row.loaded) counts.open += 1
    else counts.unused += 1
  }
  const activeRecord = value?.activeWorkbenchId === undefined
    ? undefined
    : value.workbenches[value.activeWorkbenchId]
  const sessions = options.sessions?.list.getSnapshot()
  const workspaces = options.workspaces?.list.getSnapshot()
  const editorRows = options.editorCatalog.getSnapshot().map(editor => projectEditor(editor))
  const sourceStatus = normalizeSourceStatus(source.status)
  return {
    version: 1,
    source: {
      status: sourceStatus,
      writable: source.writable === true,
      ...(source.revision === undefined ? {} : { revision: source.revision }),
      migrationRequired: value?.migrationRequired === true,
    },
    workbenches: {
      ...(value?.activeWorkbenchId === undefined ? {} : { activeWorkbenchId: value.activeWorkbenchId }),
      openWorkbenchIds: [...openWorkbenchIds],
      counts,
      rows: rows.sort((left, right) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0)),
    },
    ...(activeRecord === undefined || value === undefined ? {} : {
      current: {
        workbenchId: activeRecord.workbenchId,
        name: activeRecord.name,
        description: activeRecord.description,
        createdAt: activeRecord.createdAt,
        updatedAt: activeRecord.updatedAt,
        context: workbenchContextOf(activeRecord.context),
        document: projectLayoutNode(activeRecord.document.root),
        activeAreaId: activeRecord.document.activeAreaId,
        projects: structuredClone(Object.values(activeRecord.projects ?? {})),
        areas: areasOf(activeRecord.document.root).map((area, ordinal) => ({ ...(activeRecord.areaProjects?.[area.areaId]?.projectId ? { projectId: activeRecord.areaProjects[area.areaId]!.projectId! } : {}), ...projectArea(
          area, ordinal, activeRecord.document.activeAreaId, activeRecord.areaMetadata?.[area.areaId],
          areaContextOf(activeRecord.areaContexts?.[area.areaId]),
          editorRows, sessions, workspaces, options.modelSelectionSource,
        ) })),
      },
    }),
    editors: editorRows,
    supportedIntents: [
      'inspect', 'plan.split', 'plan.set-ratio', 'plan.select-editor', 'plan.bind-session',
      'plan.close-area', 'plan.move-area', 'plan.save-as',
    ],
  }
}

/** Create the read-only provider registered by the optional Cordis client runner. */
export function createWorkbenchCreatorInspectProvider(
  options: WorkbenchCreatorInspectOptions,
): WorkbenchCreatorInspectProviderRegistrationV1 {
  return {
    manifest: {
      id: 'WorkbenchCreator',
      description: 'Current Workbench identity, canonical split-tree, exact Area bindings, editor catalog, and safe creation capabilities.',
      methods: [{
        name: 'inspect',
        description: 'Read a bounded, JSON-safe Workbench Creator context. This is read-only and never returns transcripts, credentials, functions, or raw stores.',
        inputSchema: EMPTY_INPUT,
        outputSchema: { type: 'object', description: 'WorkbenchCreatorInspectSnapshotV1' },
      }],
    },
    query: async (method) => {
      if (method !== 'inspect') throw new Error(`unknown WorkbenchCreator inspect method "${method}"`)
      return deriveWorkbenchCreatorInspectSnapshot(options) as unknown as JsonValue
    },
  }
}

function projectEditor(editor: WorkbenchEditorCatalogRow): WorkbenchCreatorEditorV1 {
  return {
    id: editor.id,
    label: editor.label,
    scope: editor.scope,
    ...(editor.pluginId === undefined ? {} : { pluginId: editor.pluginId }),
    available: true,
    ...(editor.preview === undefined ? {} : { preview: { version: editor.preview.version } }),
  }
}

export interface WorkbenchCreatorEditorV1 {
  id: string
  label: string
  scope: 'root' | 'session'
  pluginId?: string
  available: boolean
  preview?: { version: number }
}

function projectLayoutNode(node: WorkbenchNodeV3, ordinals = new Map<string, number>()): WorkbenchCreatorLayoutNodeV1 {
  if (node.kind === 'area') {
    if (!ordinals.has(node.areaId)) ordinals.set(node.areaId, ordinals.size + 1)
    return { kind: 'area', id: node.areaId, ordinal: ordinals.get(node.areaId)! }
  }
  return {
    kind: 'split', id: node.id, axis: node.axis, ratio: node.ratio,
    first: projectLayoutNode(node.first, ordinals), second: projectLayoutNode(node.second, ordinals),
  }
}

function projectArea(
  area: AreaNode,
  ordinal: number,
  activeAreaId: string,
  metadata: { label: string; ownership: WorkbenchAreaOwnershipV1 } | undefined,
  context: AreaContextV1,
  editors: readonly WorkbenchCreatorEditorV1[],
  sessions: ReturnType<NonNullable<WorkbenchCreatorInspectOptions['sessions']>['list']['getSnapshot']> | undefined,
  workspaces: ReturnType<NonNullable<WorkbenchCreatorInspectOptions['workspaces']>['list']['getSnapshot']> | undefined,
  modelSelectionSource: WorkbenchCreatorInspectOptions['modelSelectionSource'],
): WorkbenchCreatorAreaV1 {
  const current = area.moduleHistory.find(module => module.moduleInstanceId === area.activeModuleInstanceId)
    ?? area.moduleHistory[0]
  return {
    areaId: area.areaId,
    ordinal: ordinal + 1,
    active: area.areaId === activeAreaId,
    historyCount: area.moduleHistory.length,
    ...(metadata?.label === undefined ? {} : { label: metadata.label }),
    ownership: metadata?.ownership ?? 'user-owned',
    context,
    ...(current === undefined ? {} : {
      current: projectModule(current, editors, sessions, workspaces, modelSelectionSource),
    }),
  }
}

function projectModule(
  module: ModuleInstanceDocument,
  editors: readonly WorkbenchCreatorEditorV1[],
  sessions: ReturnType<NonNullable<WorkbenchCreatorInspectOptions['sessions']>['list']['getSnapshot']> | undefined,
  workspaces: ReturnType<NonNullable<WorkbenchCreatorInspectOptions['workspaces']>['list']['getSnapshot']> | undefined,
  modelSelectionSource: WorkbenchCreatorInspectOptions['modelSelectionSource'],
): WorkbenchCreatorModuleV1 {
  const editor = editors.find(candidate => candidate.id === module.editorId && candidate.scope === module.editorScope)
  const binding = module.binding
  const session = binding === undefined ? undefined : sessions?.byId[binding.sessionId]
  const workspace = binding?.workspaceId === undefined
    ? undefined
    : workspaces?.items.find(candidate => candidate.workspaceId === binding.workspaceId)
  const member = binding === undefined ? undefined : workspaces?.items.some(candidate => candidate.sessionIds.includes(binding.sessionId))
  const archived = binding === undefined ? false : workspaces?.archivedSessionIds.includes(binding.sessionId) === true
  const model = binding === undefined ? undefined : modelSelectionSource?.get(binding.sessionId)
  const bindingState: WorkbenchCreatorBindingState = binding === undefined
      ? 'unbound'
      : session === undefined || archived ? 'missing' : member === false ? 'unknown' : 'bound'
  return {
    moduleInstanceId: module.moduleInstanceId,
    editorId: module.editorId,
    scope: module.editorScope,
    title: module.lastKnownTitle || editor?.label || module.editorId,
    available: editor !== undefined,
    ...(editor?.pluginId === undefined ? {} : { pluginId: editor.pluginId }),
    ...(editor?.preview === undefined ? {} : { preview: editor.preview }),
    ...(binding === undefined ? {} : {
      binding: {
        ...(binding.workspaceId === undefined ? {} : { workspaceId: binding.workspaceId }),
        sessionId: binding.sessionId,
        state: bindingState,
        ...(workspace?.title === undefined ? {} : { workspaceTitle: workspace.title }),
        ...(session === undefined ? {} : {
          sessionTitle: session.displayTitle,
          running: session.running,
          updatedAt: session.updatedAt,
          ...(session.agentPreset === undefined ? {} : { agentPreset: session.agentPreset }),
          ...(model === undefined ? {} : { model }),
        }),
      },
    }),
    state: { present: module.state !== null, kind: Array.isArray(module.state) ? 'array' : module.state === null ? 'null' : typeof module.state },
  }
}

function normalizeSourceStatus(value: unknown): WorkbenchCreatorInspectSnapshotV1['source']['status'] {
  if (value === 'ready' || value === 'loading' || value === 'error' || value === 'offline') return value
  return 'unknown'
}
