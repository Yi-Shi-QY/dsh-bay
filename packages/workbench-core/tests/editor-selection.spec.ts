import { describe, expect, it } from 'vitest'
import type { WorkbenchEditorCatalogRow } from '../src/foundation/catalog.ts'
import { selectableWorkbenchEditors } from '../src/foundation/editor-selection.ts'

describe('selectable Workbench editors', () => {
  it('keeps resource-backed DSH editors out of standalone add/replace choices', () => {
    const editors: WorkbenchEditorCatalogRow[] = [
      { id: 'workbench.conversation', label: 'Conversation', scope: 'session' },
      { id: 'workbench.workspace-files', label: 'Files', scope: 'session' },
      { id: 'workbench.document-preview', label: 'File preview', scope: 'session' },
      { id: 'workbench.changes-review', label: 'Changes review', scope: 'session' },
      { id: 'workbench.plan', label: 'Plan', scope: 'session' },
      { id: 'workbench.schedule-task', label: 'Schedule task', scope: 'session' },
      { id: 'workbench.subagent-chat', label: 'Subagent chat', scope: 'session' },
      // Older catalog projections may not preserve the resourceOnly marker.
      { id: 'workbench.plan', label: 'Plan without marker', scope: 'session', resourceOnly: false },
      { id: 'extension.custom', label: 'Custom extension', scope: 'session', resourceOnly: true },
    ]

    expect(selectableWorkbenchEditors(editors).map(editor => editor.id)).toEqual([
      'workbench.conversation',
      'workbench.workspace-files',
    ])
  })

  it('still allows a resource-backed native editor when invoked directly by a DSH resource action', () => {
    // Resource actions bypass the picker and resolve their stable editor id
    // directly; only the standalone chooser is filtered.
    const editor: WorkbenchEditorCatalogRow = {
      id: 'workbench.plan', label: 'Plan', scope: 'session', resourceOnly: true,
    }
    expect(selectableWorkbenchEditors([editor])).toEqual([])
    expect(editor.id).toBe('workbench.plan')
  })
})
