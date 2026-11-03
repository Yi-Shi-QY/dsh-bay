import type { WorkbenchEditorCatalogRow } from './catalog.ts'
import type { GroupNode, JsonValue, TabDocument } from './model.ts'

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
