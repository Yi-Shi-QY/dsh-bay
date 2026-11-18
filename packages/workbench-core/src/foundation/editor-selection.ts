import type { WorkbenchEditorCatalogRow } from './catalog.ts'
import { createSessionTab, type GroupNode, type JsonValue, type TabDocument, type SessionBindingV1 } from './model.ts'
import type { WorkbenchEditorBindingRequirementV1 } from '../module-contract.ts'

export interface WorkbenchEditorAvailabilityContextV1 {
  readonly hasWorkspace: boolean
  readonly hasSession: boolean
}

/** Resolve the binding contract that controls whether an editor can be added. */
export function workbenchEditorBindingRequirement(editor: WorkbenchEditorCatalogRow): WorkbenchEditorBindingRequirementV1 {
  return editor.declaration?.binding?.requirement
    ?? editor.declaration?.requiredBinding
    ?? (editor.scope === 'session' ? 'session' : 'none')
}

/** Keep the add menu aligned with the Area's current project and conversation context. */
export function editorsAvailableForWorkbenchContext(
  editors: readonly WorkbenchEditorCatalogRow[],
  context: WorkbenchEditorAvailabilityContextV1,
): readonly WorkbenchEditorCatalogRow[] {
  return editors.filter(editor => {
    const requirement = workbenchEditorBindingRequirement(editor)
    if (requirement === 'none') return true
    if (requirement === 'workspace') return context.hasWorkspace
    return context.hasWorkspace && context.hasSession
  })
}

/** Render scope does not replace the editor's declared binding requirement. */
export function createFloatingEditorTab(editor: WorkbenchEditorCatalogRow, id: string, binding?: SessionBindingV1, state: JsonValue = {}): TabDocument {
  const requirement = workbenchEditorBindingRequirement(editor)
  const requiresBinding = requirement === 'session' || editor.scope === 'session'
    || (requirement !== 'none' && editor.declaration?.binding?.unbound !== 'available')
  const canUseWorkspaceBinding = requirement !== 'workspace' || binding?.workspaceId !== undefined
  if (binding && canUseWorkspaceBinding && (requiresBinding || requirement === 'workspace')) {
    return { ...createSessionTab(id, editor.id, binding, editor.label, state), editorScope: editor.scope }
  }
  return { id, editorId: editor.id, editorScope: editor.scope, lastKnownTitle: editor.label, state,
    ...(requiresBinding ? { pendingBinding: id } : {}) }
}

/** Translate runtime-only pending identity before the durable Settings boundary. */
export function prepareFloatingTabForArea(tab: TabDocument, target: GroupNode, allTabs: readonly TabDocument[]): TabDocument {
  if (tab.editorScope === 'root' && tab.pendingBinding) throw new Error('请先为此内页选择来源对话，再放入区域。')
  if (!tab.pendingBinding) return tab
  const pending = createPendingSessionTab({ id: tab.editorId, label: tab.lastKnownTitle, scope: tab.editorScope }, tab.id, target, allTabs, tab.state)
  return { ...pending, ...(tab.pendingDistribution ? { pendingDistribution: tab.pendingDistribution } : {}) }
}

/**
 * These editors are opened from a DSH resource action (for example a plan or
 * a changes-review link).  They are not standalone pages: without the exact
 * dsh-resource:// identity their native body has nothing to render.  Keep the
 * identity list here as a defensive compatibility seam because older DSH
 * hosts may drop the `resourceOnly` registration option while projecting a
 * slot entry into Workbench.
 */
const RESOURCE_ONLY_EDITOR_IDS = new Set([
  'workbench.document-preview',
  'workbench.changes-review',
  'workbench.plan',
  'workbench.schedule-task',
  'workbench.subagent-chat',
])

/** Menu availability is a live registration plus this Workbench's visibility preference. */
export function selectableWorkbenchEditors(editors: readonly WorkbenchEditorCatalogRow[], hidden: readonly string[] = []): readonly WorkbenchEditorCatalogRow[] {
  const hasRootConversationStart = editors.some(editor =>
    editor.id === 'workbench.conversation.start' && editor.scope === 'root')
  return editors.filter(editor => !editor.resourceOnly && !RESOURCE_ONLY_EDITOR_IDS.has(editor.id) && !hidden.includes(editor.id)
    // The prepared Start renderer is also registered in the Session scope so
    // a bound Start module can keep the native Composer alive. It is a runtime
    // carrier, not a second menu action; the root declaration remains the one
    // users choose from the + menu.
    && !(hasRootConversationStart
      && editor.id === 'workbench.conversation.start' && editor.scope === 'session'))
}

/** Each pending page owns its selection; another page cannot resolve its binding. */
export function createPendingSessionTab(
  editor: WorkbenchEditorCatalogRow,
  id: string,
  group: GroupNode,
  allTabs: readonly TabDocument[],
  state: JsonValue = {},
): TabDocument {
  if (editor.scope !== 'session') throw new Error('Only Session editors require a binding')
  let pendingBinding: string | undefined
  const used = new Set([...allTabs, ...group.tabs].map(tab => tab.pendingBinding))
  for (let index = 1; index <= 999; index++) {
    const candidate = `binding-${index}`
    if (!used.has(candidate)) { pendingBinding = candidate; break }
  }
  if (pendingBinding === undefined) throw new Error('待绑定内页已达上限，请先绑定已有内页。')
  return { id, editorId: editor.id, editorScope: 'session', pendingBinding, lastKnownTitle: editor.label, state: structuredClone(state) }
}
