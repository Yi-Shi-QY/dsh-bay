import { resolveWorkbenchEditorPresentation, type WorkbenchEditorCatalogRow, type WorkbenchEditorPresentation } from './catalog.ts'
import type { GroupNode, SessionBindingV1, TabDocument } from './model.ts'
import { UNKNOWN_CONVERSATION_STATUS, type ConversationTabPhase, type ConversationTabStatus } from '../client/conversation-tab-status.ts'
import { resolveSessionTarget, type SessionTargetResolverSnapshot } from './session-target-resolver.ts'
import { buildWorkbenchTabInformation, type WorkbenchTabInformation, type WorkbenchTabInformationFacts } from './tab-information.ts'
import { defaultWorkbenchTranslate, workbenchPageTitle, type WorkbenchTranslate } from './workbench-locale.ts'

export type WorkbenchAreaTabStatus = 'ready' | 'unbound' | 'missing' | 'paused' | ConversationTabPhase

/** Only the actual conversation editor follows this Session; resource tabs keep their own semantics. */
export function conversationTabBinding(tab: TabDocument, areaBinding?: SessionBindingV1): SessionBindingV1 | undefined {
  if (tab.editorId !== 'workbench.conversation' || tab.editorScope !== 'session' || tab.pendingBinding !== undefined) return undefined
  return tab.binding ?? (tab.sessionId ? { sessionId: tab.sessionId } : undefined)
}

export function conversationTabUnavailable(binding: SessionBindingV1, facts: Omit<SessionTargetResolverSnapshot, 'markersByWorkspace'>, t: WorkbenchTranslate = defaultWorkbenchTranslate): string | undefined {
  const workspaceId = binding.workspaceId ?? facts.workspaces.find(row => row.sessionIds.includes(binding.sessionId))?.workspaceId
  const { status } = resolveSessionTarget({ sessionId: binding.sessionId, ...(workspaceId ? { workspaceId } : {}) }, { ...facts, markersByWorkspace: {} })
  return status === 'available' ? undefined : status === 'archived' ? t('tab.conversationArchived') : status === 'moved' ? t('tab.conversationMoved') : t('tab.conversationUnavailable')
}

export interface WorkbenchAreaTabSummary {
  id: string
  title: string
  icon: string
  iconSvg?: WorkbenchEditorPresentation['iconSvg']
  status: WorkbenchAreaTabStatus
  statusLabel: string
  selected: boolean
  conversation?: boolean
  information?: WorkbenchTabInformation
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
  conversations?: ReadonlyMap<string, ConversationTabStatus>
  sessionAvailability?: (binding: SessionBindingV1) => string | undefined
  information?: WorkbenchTabInformationFacts
  t?: WorkbenchTranslate
}): WorkbenchAreaTabRows {
  const rows: WorkbenchAreaTabRow[] = []
  const summaries: WorkbenchAreaTabSummary[] = []

  for (const tab of input.tabs) {
    const editor = workbenchEditorFromIndex(input.editorIndex, tab.editorId, tab.editorScope)
    const selected = tab.id === input.activeTabId
    const baseStatus = statusFor(tab, editor, input.areaBinding, tab.id === input.pausedTabId)
    const binding = conversationTabBinding(tab, input.areaBinding)
    const unavailable = binding ? input.sessionAvailability?.(binding) : undefined
    const conversation = binding && baseStatus !== 'missing' && baseStatus !== 'unbound'
      ? input.conversations?.get(binding.sessionId) ?? UNKNOWN_CONVERSATION_STATUS
      : undefined
    const status = conversation && unavailable ? 'failed' : conversation?.status ?? baseStatus
    const presentation = resolveWorkbenchEditorPresentation(editor)
    const title = input.t ? workbenchPageTitle(input.t, tab.editorId, tab.lastKnownTitle) : tab.lastKnownTitle
    const label = conversation ? unavailable ?? (conversation.labelKey === undefined ? conversation.label : (input.t ?? defaultWorkbenchTranslate)(conversation.labelKey)) : statusLabel(status, input.t)
    const summary: WorkbenchAreaTabSummary = {
      id: tab.id,
      title,
      icon: presentation.icon,
      ...(presentation.iconSvg ? { iconSvg: presentation.iconSvg } : {}),
      status,
      statusLabel: label,
      selected,
      ...(tab.editorId === 'workbench.conversation' ? { conversation: true } : {}),
      information: buildWorkbenchTabInformation({ tab, title, editor, areaBinding: input.areaBinding,
        statusLabel: label, ordinal: rows.length + 1,
        ...(input.t ? { t: input.t } : {}),
        ...(input.information ? { facts: input.information } : {}),
      }),
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
    && (tab.binding?.sessionId ?? tab.sessionId) === undefined) return 'unbound'
  if (paused) return 'paused'
  return 'ready'
}

function statusLabel(status: WorkbenchAreaTabStatus, t?: WorkbenchTranslate): string {
  switch (status) {
    case 'unbound': return t?.('tab.unbound') ?? '待绑定'
    case 'missing': return t?.('tab.unavailable') ?? '不可用'
    case 'paused': return t?.('tab.paused') ?? '已暂停'
    default: return t?.('tab.ready') ?? '就绪'
  }
}
