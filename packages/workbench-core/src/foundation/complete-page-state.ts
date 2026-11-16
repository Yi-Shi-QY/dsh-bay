import type { ModuleInstanceDocument } from './document-v3.ts'
import type { WorkbenchEditorCatalogRow } from './catalog.ts'
import type { CompletePageState } from '../workbench-complete-contract.ts'
import { portableStateSafe } from './workbench-layout-package.ts'
import { workbenchEditorStateFailureV1 } from '../workbench-editor-state.ts'

/** Uses the same extension contract as layout packages, retaining complete-package view identities. */
export function migrateCompletePageStates(pages: readonly ModuleInstanceDocument[], editors: readonly WorkbenchEditorCatalogRow[], direction: 'export' | 'import'): CompletePageState[] {
  return pages.map(page => {
    const editor = editors.find(row => row.id === page.editorId && row.scope === page.editorScope)
    const transform = direction === 'export' ? editor?.portability?.exportState : editor?.portability?.importState
    if (!editor || editor.declaration?.state.share !== 'portable' || !transform) throw new Error(`「${page.lastKnownTitle}」缺少内页配置${direction === 'export' ? '导出' : '恢复'}处理器。`)
    if (direction === 'import' && workbenchEditorStateFailureV1(page.state, editor.declaration)) throw new Error(`「${page.lastKnownTitle}」配置 schema 或大小不匹配。`)
    const state = transform(page.state, { version: 1, editor: { id: editor.id, scope: editor.scope, moduleInstanceId: page.moduleInstanceId, title: page.lastKnownTitle }, ...(direction === 'import' && page.binding ? { target: page.binding } : {}) })
    if (!portableStateSafe(state) || workbenchEditorStateFailureV1(state, editor.declaration)) throw new Error(`「${page.lastKnownTitle}」配置迁移结果无效。`)
    return { moduleInstanceId: page.moduleInstanceId, editorId: page.editorId, state: structuredClone(state) }
  })
}
