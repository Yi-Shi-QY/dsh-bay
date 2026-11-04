import type { WorkbenchEditorCatalogRow } from './catalog.ts'
import { createSessionTab, type GroupNode, type JsonValue, type TabDocument, type SessionBindingV1 } from './model.ts'

/** Render scope does not replace the editor's declared binding requirement. */
export function createFloatingEditorTab(editor: WorkbenchEditorCatalogRow, id: string, binding?: SessionBindingV1, state: JsonValue = {}): TabDocument {
  const requirement = editor.declaration?.binding?.requirement ?? editor.declaration?.requiredBinding ?? (editor.scope === 'session' ? 'session' : 'none')
  const requiresBinding = requirement !== 'none' || editor.scope === 'session'
  if (requiresBinding && binding && (requirement !== 'workspace' || binding.workspaceId)) {
    return { ...createSessionTab(id, editor.id, binding, editor.label, state), editorScope: editor.scope }
  }
  return { id, editorId: editor.id, editorScope: editor.scope, lastKnownTitle: editor.label, state,
    ...(requiresBinding ? { pendingBinding: id } : {}) }
}

/** Translate runtime-only pending identity before the durable Settings boundary. */
export function prepareFloatingTabForArea(tab: TabDocument, target: GroupNode, allTabs: readonly TabDocument[]): TabDocument {
  if (tab.editorScope === 'root' && tab.pendingBinding) throw new Error('请先为此内页选择来源对话，再放入区域。')
  if (!tab.pendingBinding) return tab
  const binding = target.areaBinding ?? target.tabs.find(row => row.binding)?.binding
  if (binding) return { ...createSessionTab(tab.id, tab.editorId, binding, tab.lastKnownTitle, tab.state),
    ...(tab.pendingDistribution ? { pendingDistribution: tab.pendingDistribution } : {}) }
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

/** Pending identifiers are unique across the layout, and shared only within one Area. */
export function createPendingSessionTab(
  editor: WorkbenchEditorCatalogRow,
  id: string,
  group: GroupNode,
  allTabs: readonly TabDocument[],
  state: JsonValue = {},
): TabDocument {
  if (editor.scope !== 'session') throw new Error('Only Session editors require a binding')
  let pendingBinding = group.tabs.find(tab => tab.pendingBinding !== undefined)?.pendingBinding
  if (pendingBinding === undefined) {
    const used = new Set(allTabs.map(tab => tab.pendingBinding))
    for (let index = 1; index <= 999; index++) {
      const candidate = `binding-${index}`
      if (!used.has(candidate)) { pendingBinding = candidate; break }
    }
  }
  if (pendingBinding === undefined) throw new Error('待绑定区域已达上限，请先绑定已有区域。')
  return { id, editorId: editor.id, editorScope: 'session', pendingBinding, lastKnownTitle: editor.label, state: structuredClone(state) }
}
