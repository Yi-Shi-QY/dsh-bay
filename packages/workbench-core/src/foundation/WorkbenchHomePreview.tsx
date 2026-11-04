import { IconPanelLeftOutlineMedium } from '@deepseek-ai/dsh-client-ui-primitives'
import type { WorkbenchNodeV3 } from './document-v3.ts'
import { resolveWorkbenchEditorPresentation, type WorkbenchEditorCatalogRow } from './catalog.ts'
import { WorkbenchEditorIcon } from './WorkbenchEditorIcon.tsx'
import css from './WorkbenchHome.module.css'

/** A read-only miniature of the saved layout; never mounts editor runtimes. */
export function WorkbenchHomePreview({ node, editors }: { node: WorkbenchNodeV3; editors: readonly WorkbenchEditorCatalogRow[] }) {
  if (node.kind === 'split') return <div className={css.previewSplit} style={{ flexDirection: node.axis === 'horizontal' ? 'row' : 'column' }}>
    <div style={{ flex: node.ratio }}><WorkbenchHomePreview node={node.first} editors={editors} /></div>
    <div style={{ flex: 1 - node.ratio }}><WorkbenchHomePreview node={node.second} editors={editors} /></div>
  </div>
  const selected = node.moduleHistory.find(page => page.moduleInstanceId === node.activeModuleInstanceId) ?? node.moduleHistory[0]
  const editor = selected && editors.find(row => row.id === selected.editorId && row.scope === selected.editorScope)
  const presentation = resolveWorkbenchEditorPresentation(editor ?? (selected ? { id: selected.editorId, scope: selected.editorScope, label: selected.lastKnownTitle } : undefined))
  return <div className={css.previewArea}>
    <div className={css.previewTabs}>{node.moduleHistory.length ? node.moduleHistory.slice(0, 5).map(page => <span key={page.moduleInstanceId} data-selected={page === selected || undefined} />) : <span />}</div>
    <div className={css.previewBody}>
      <span className={css.previewIcon}>{selected ? <WorkbenchEditorIcon name={presentation.icon} iconSvg={presentation.iconSvg} /> : <IconPanelLeftOutlineMedium size={20} />}</span>
      <span>{editor?.label ?? selected?.lastKnownTitle ?? '空白区域'}</span>
    </div>
  </div>
}
