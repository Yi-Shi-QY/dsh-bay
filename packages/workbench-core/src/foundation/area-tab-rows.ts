import { editorPresentationFor, type WorkbenchEditorCatalogRow, type WorkbenchEditorPresentation } from './catalog.ts'
import type { GroupNode, SessionBindingV1, TabDocument } from './model.ts'

export type WorkbenchAreaTabStatus = 'ready' | 'unbound' | 'missing' | 'paused'

export interface WorkbenchAreaTabSummary {
  id: string
  title: string
  icon: string
  status: WorkbenchAreaTabStatus
  statusLabel: string
  selected: boolean
}

export interface WorkbenchAreaTabRow {
  tab: TabDocument
  editor: WorkbenchEditorCatalogRow | undefined
  presentation: WorkbenchEditorPresentation
  summary: WorkbenchAreaTabSummary
}

export type WorkbenchEditorIndex = ReadonlyMap<
  WorkbenchEditorCatalogRow['scope'],
  ReadonlyMap<string, WorkbenchEditorCatalogRow>
>

export interface WorkbenchAreaTabRows {
  rows: readonly WorkbenchAreaTabRow[]
  summaries: readonly WorkbenchAreaTabSummary[]
}

/** Build one editor lookup indexed by both identifier and scope. */
export function indexWorkbenchEditors(
  editors: readonly WorkbenchEditorCatalogRow[],
): WorkbenchEditorIndex {
  const index = new Map<WorkbenchEditorCatalogRow['scope'], Map<string, WorkbenchEditorCatalogRow>>([
    ['root', new Map()],
    ['session', new Map()],
  ])

  for (const editor of editors) {
    const scopedIndex = index.get(editor.scope)!
    // Preserve Array.find()'s first-match behavior for malformed duplicate registrations.
    if (!scopedIndex.has(editor.id)) scopedIndex.set(editor.id, editor)
  }

  return index
}

/** Resolve an editor using the complete identity used by the Slot catalog. */
export function workbenchEditorFromIndex(
  index: WorkbenchEditorIndex,
  editorId: string,
  scope: WorkbenchEditorCatalogRow['scope'],
): WorkbenchEditorCatalogRow | undefined {
  return index.get(scope)?.get(editorId)
}

/**
 * Build tab rows with a single ordered pass over the Area's tabs. Catalog
 * lookup is constant-time and always includes scope, so duplicate IDs in the
 * root and Session registries cannot resolve to the wrong editor.
 */
export function buildWorkbenchAreaTabRows(input: {
  tabs: readonly TabDocument[]
  editorIndex: WorkbenchEditorIndex
  activeTabId: string | undefined
  areaBinding: SessionBindingV1 | undefined
  pausedTabId: string | undefined
}): WorkbenchAreaTabRows {
  const rows: WorkbenchAreaTabRow[] = []
  const summaries: WorkbenchAreaTabSummary[] = []

  for (const tab of input.tabs) {
    const editor = workbenchEditorFromIndex(input.editorIndex, tab.editorId, tab.editorScope)
    const selected = tab.id === input.activeTabId
    const status = statusFor(tab, editor, input.areaBinding, tab.id === input.pausedTabId)
    const presentation = presentationFor(editor)
    const summary: WorkbenchAreaTabSummary = {
      id: tab.id,
      title: tab.lastKnownTitle,
      icon: presentation.icon,
      status,
      statusLabel: statusLabel(status),
      selected,
    }

    rows.push({ tab, editor, presentation, summary })
    summaries.push(summary)
  }

  return { rows, summaries }
}

/** Compute Area labels once for the whole layout instead of traversing it per Area. */
export function indexWorkbenchAreaOrdinals(
  groups: readonly Pick<GroupNode, 'id'>[],
): ReadonlyMap<string, number> {
  const ordinals = new Map<string, number>()
  for (let index = 0; index < groups.length; index += 1) {
    const group = groups[index]
    if (group !== undefined) ordinals.set(group.id, index + 1)
  }
  return ordinals
}

function statusFor(
  tab: TabDocument,
  editor: WorkbenchEditorCatalogRow | undefined,
  areaBinding: SessionBindingV1 | undefined,
  paused: boolean,
): WorkbenchAreaTabStatus {
  if (editor === undefined) return 'missing'
  if (tab.pendingBinding !== undefined) return 'unbound'
  if (tab.editorScope === 'session'
    && (tab.binding?.sessionId ?? tab.sessionId ?? areaBinding?.sessionId) === undefined) return 'unbound'
  if (paused) return 'paused'
  return 'ready'
}

function statusLabel(status: WorkbenchAreaTabStatus): string {
  switch (status) {
    case 'unbound': return '待绑定'
    case 'missing': return '不可用'
    case 'paused': return '已暂停'
    default: return '就绪'
  }
}

function presentationFor(editor: WorkbenchEditorCatalogRow | undefined): WorkbenchEditorPresentation {
  if (editor === undefined) return { icon: 'panel', category: '其他', categoryOrder: 100 }
  const fallback = editorPresentationFor(editor.id, editor.scope)
  return {
    icon: editor.icon ?? fallback.icon,
    category: editor.category ?? fallback.category,
    categoryOrder: editor.categoryOrder ?? fallback.categoryOrder,
  }
}
