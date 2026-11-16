import type {
  SlotPreviewContextV1,
  SlotPreviewDocumentV1,
  SlotPreviewModelSelectionV1,
  SlotPreviewValue,
} from './workbench-slot-contracts.ts'
import { parseSlotPreviewDocumentV1 } from './workbench-slot-contracts.ts'
import { editorPresentationFor, type WorkbenchEditorCatalogRow } from './catalog.ts'
import { workbenchAgentPresetLabel as presetLabelFor } from './agent-preset-label.ts'
import type { WorkbenchDocumentV3, WorkbenchNodeV3, ModuleInstanceDocument } from './document-v3.ts'
import type { WorkbenchInventory, WorkbenchInventoryArea, WorkbenchInventoryPage } from './workbench-inventory.ts'

/** The serializable model consumed by both compact cards and detail previews. */
export interface WorkbenchPreviewModel {
  root: WorkbenchPreviewNode
  activeAreaId: string
  areaCount: number
}

export type WorkbenchPreviewNode = WorkbenchPreviewSplit | WorkbenchPreviewArea

export interface WorkbenchPreviewSplit {
  kind: 'split'
  axis: 'horizontal' | 'vertical'
  ratio: number
  first: WorkbenchPreviewNode
  second: WorkbenchPreviewNode
}

export interface WorkbenchPreviewArea {
  kind: 'area'
  areaId: string
  ordinal: number
  focused: boolean
  historyCount: number
  active?: WorkbenchPreviewPage
}

/** @deprecated Kept as a diagnostic compatibility field; rendering is descriptor-driven. */
export type WorkbenchPreviewEditorKind = 'launcher' | 'conversation' | 'trajectory' | 'extension' | 'unknown'

export type WorkbenchPreviewBindingState = 'bound' | 'unbound' | 'missing' | 'unknown'
export type WorkbenchPreviewStatus = 'available' | 'missing' | 'error' | 'unsupported'
export type WorkbenchPreviewError = 'no-descriptor' | 'unknown-version' | 'invalid-document' | 'unknown-node' | 'resolver-error' | 'budget-exceeded'

/** Live model selection state projected into a Workbench preview. */
export interface WorkbenchPreviewModelSelection extends SlotPreviewModelSelectionV1 {}

/** Read-only bridge supplied by the composition layer when model selection is installed. */
export interface WorkbenchPreviewModelSelectionSource {
  get(sessionId: string): WorkbenchPreviewModelSelection | undefined
  getSnapshot(): number
  subscribe(listener: () => void): () => void
}

export interface WorkbenchPreviewPage {
  moduleInstanceId: string
  editorId: string
  editorScope: 'root' | 'session'
  title: string
  pluginId?: string
  icon: string
  /** Compatibility presentation token; never selects the semantic renderer. */
  editorKind: WorkbenchPreviewEditorKind
  available: boolean
  bindingState: WorkbenchPreviewBindingState
  agentPresetId?: string
  agentPresetLabel?: string
  modelSelection?: WorkbenchPreviewModelSelection
  preview: SlotPreviewDocumentV1
  previewStatus: WorkbenchPreviewStatus
  previewError?: WorkbenchPreviewError
}

/** Minimal live Session projection needed by the restricted descriptor context. */
export interface WorkbenchPreviewSession {
  id: string
  displayTitle?: string
  agentPreset?: string
  modelSelection?: WorkbenchPreviewModelSelection
}

function editorKindFor(editorId: string, scope: 'root' | 'session'): WorkbenchPreviewEditorKind {
  if (editorId === 'workbench.conversation.start') return 'launcher'
  if (editorId === 'workbench.conversation') return 'conversation'
  if (editorId === 'workbench.agent-trajectory') return 'trajectory'
  return scope === 'session' ? 'extension' : 'unknown'
}

function moduleById(document: WorkbenchDocumentV3): Map<string, ModuleInstanceDocument> {
  const result = new Map<string, ModuleInstanceDocument>()
  const visit = (node: WorkbenchNodeV3): void => {
    if (node.kind === 'split') {
      visit(node.first)
      visit(node.second)
      return
    }
    for (const module of node.moduleHistory) result.set(module.moduleInstanceId, module)
  }
  visit(document.root)
  return result
}

function jsonStateOf(value: unknown): SlotPreviewValue {
  if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') return value
  if (Array.isArray(value)) return value as readonly SlotPreviewValue[]
  if (typeof value === 'object') return value as { readonly [key: string]: SlotPreviewValue }
  return null
}

function fallbackPreview(page: WorkbenchInventoryPage, status: WorkbenchPreviewStatus): SlotPreviewDocumentV1 {
  const detail = status === 'missing' ? '内页不可用' : status === 'unsupported' ? '该内页未声明语义预览协议' : '预览描述不可用'
  return {
    version: 1,
    ariaLabel: page.name,
    root: { kind: 'empty', label: status === 'missing' ? '内页不可用' : status === 'unsupported' ? '暂无预览描述' : '预览描述不可用', detail },
  }
}

function previewErrorFor(error: NonNullable<ReturnType<typeof parseSlotPreviewDocumentV1>['error']>): WorkbenchPreviewError {
  return error
}

function previewPage(
  page: WorkbenchInventoryPage,
  historyCount: number,
  areaActive: boolean,
  modules: ReadonlyMap<string, ModuleInstanceDocument>,
  editors: ReadonlyMap<string, WorkbenchEditorCatalogRow>,
  sessions: ReadonlyMap<string, WorkbenchPreviewSession>,
): WorkbenchPreviewPage {
  const module = modules.get(page.moduleInstanceId)
  const editor = editors.get(`${page.editorScope}:${page.editorId}`)
  const presentation = editorPresentationFor(page.editorId, page.editorScope)
  const bindingState: WorkbenchPreviewBindingState = !page.available
    ? 'missing'
    : page.editorScope === 'root'
      ? 'unbound'
      : module?.binding?.sessionId === undefined || module.binding.detached === true ? 'unbound' : 'bound'
  const sessionId = module?.binding?.detached === true ? undefined : module?.binding?.sessionId
  const session = sessionId === undefined ? undefined : sessions.get(sessionId)
  const launchState = typeof module?.state === 'object' && module.state !== null && !Array.isArray(module.state)
    ? module.state['conversationLaunch']
    : undefined
  const launchPreset = typeof launchState === 'object' && launchState !== null && !Array.isArray(launchState)
    ? launchState['agentPresetId']
    : undefined
  const agentPresetId = typeof launchPreset === 'string' && launchPreset !== ''
    ? launchPreset
    : typeof session?.agentPreset === 'string' && session.agentPreset !== '' ? session.agentPreset : undefined
  const descriptor = editor?.preview
  let previewStatus: WorkbenchPreviewStatus = page.available ? 'available' : 'missing'
  let previewError: WorkbenchPreviewError | undefined
  let preview = fallbackPreview(page, previewStatus)
  if (page.available && descriptor === undefined) {
    previewStatus = 'unsupported'
    previewError = 'no-descriptor'
    preview = fallbackPreview(page, previewStatus)
  } else if (page.available && descriptor !== undefined) {
    if ((descriptor as { version?: unknown }).version !== 1) {
      previewStatus = 'unsupported'
      previewError = 'unknown-version'
      preview = fallbackPreview(page, previewStatus)
    } else {
      const context: SlotPreviewContextV1 = {
        version: 1,
        density: 'detail',
        editor: {
          id: page.editorId,
          scope: page.editorScope,
          moduleInstanceId: page.moduleInstanceId,
          title: page.name,
          available: page.available,
          bindingState,
        },
        module: { state: jsonStateOf(module?.state) },
        ...(bindingState === 'bound' && module?.binding !== undefined ? { binding: { ...module.binding } } : {}),
        ...(session === undefined ? {} : {
          session: {
            id: session.id,
            displayTitle: session.displayTitle ?? session.id,
            ...(session.agentPreset === undefined ? {} : { agentPreset: session.agentPreset }),
            ...(session.modelSelection === undefined ? {} : { modelSelection: session.modelSelection }),
          },
        }),
        area: { historyCount, active: areaActive },
      }
      try {
        const resolved = descriptor.resolve(context)
        const parsed = parseSlotPreviewDocumentV1(resolved)
        if (parsed.document !== undefined) {
          preview = parsed.document
        } else {
          previewStatus = parsed.error === 'unknown-version' || parsed.error === 'unknown-node' || parsed.error === 'budget-exceeded' ? 'unsupported' : 'error'
          previewError = parsed.error === undefined ? 'invalid-document' : previewErrorFor(parsed.error)
          preview = fallbackPreview(page, previewStatus)
        }
      } catch {
        previewStatus = 'error'
        previewError = 'resolver-error'
        preview = fallbackPreview(page, previewStatus)
      }
    }
  }
  return {
    moduleInstanceId: page.moduleInstanceId,
    editorId: page.editorId,
    editorScope: page.editorScope,
    title: page.name,
    ...(page.pluginId === undefined ? {} : { pluginId: page.pluginId }),
    icon: editor?.icon ?? presentation.icon,
    editorKind: editorKindFor(page.editorId, page.editorScope),
    available: page.available,
    bindingState,
    ...(agentPresetId === undefined ? {} : { agentPresetId, agentPresetLabel: presetLabelFor(agentPresetId) }),
    ...(session?.modelSelection === undefined ? {} : { modelSelection: session.modelSelection }),
    preview,
    previewStatus,
    ...(previewError === undefined ? {} : { previewError }),
  }
}

/** Project the authoritative document geometry and inventory through registered semantic descriptors. */
export function deriveWorkbenchPreviewModel(
  document: WorkbenchDocumentV3,
  inventory: WorkbenchInventory,
  editors: readonly WorkbenchEditorCatalogRow[],
  sessions: readonly WorkbenchPreviewSession[] = [],
): WorkbenchPreviewModel {
  const modules = moduleById(document)
  const editorMap = new Map(editors.map(editor => [`${editor.scope}:${editor.id}`, editor]))
  const sessionMap = new Map(sessions.map(session => [session.id, session]))
  const areas = new Map(inventory.areas.map(area => [area.areaId, area]))
  const visit = (node: WorkbenchNodeV3): WorkbenchPreviewNode => {
    if (node.kind === 'split') {
      return {
        kind: 'split', axis: node.axis, ratio: Math.min(.9, Math.max(.1, node.ratio)),
        first: visit(node.first), second: visit(node.second),
      }
    }
    const area: WorkbenchInventoryArea | undefined = areas.get(node.areaId)
    const active = area?.activePage === undefined ? undefined : previewPage(area.activePage, area.pages.length, node.areaId === document.activeAreaId, modules, editorMap, sessionMap)
    return {
      kind: 'area', areaId: node.areaId, ordinal: area?.ordinal ?? 0,
      focused: node.areaId === document.activeAreaId,
      // History is intentionally not part of the durable Workbench model. Keep
      // the protocol's diagnostic field as a current-page count for compatibility.
      historyCount: area?.pages.length ?? (node.moduleHistory.length === 0 ? 0 : 1),
      ...(active === undefined ? {} : { active }),
    }
  }
  let areaCount = 0
  const count = (node: WorkbenchPreviewNode): void => {
    if (node.kind === 'area') areaCount += 1
    else { count(node.first); count(node.second) }
  }
  const root = visit(document.root)
  count(root)
  return { root, activeAreaId: document.activeAreaId, areaCount }
}
