import type { RefObject } from 'react'
import { Tooltip, IconPlusOutlineMedium, IconFlatListOutlineMedium } from '@deepseek-ai/dsh-client-ui-primitives'
import { resolveWorkbenchEditorPresentation, type WorkbenchEditorCatalogRow } from './catalog.ts'
import { WorkbenchEditorIcon } from './WorkbenchEditorIcon.tsx'
import css from './WorkbenchEmptyArea.module.css'

export function WorkbenchEmptyArea({ editors, onSelect, onBrowse, onManage, triggerRef, expanded }: {
  editors: readonly WorkbenchEditorCatalogRow[]
  onSelect(editor: WorkbenchEditorCatalogRow): void
  onBrowse(anchor: HTMLButtonElement): void
  onManage?: (() => void) | undefined
  triggerRef: RefObject<HTMLButtonElement>
  expanded: boolean
}) {
  const choices = editors.slice(0, 5)
  return <div className={css.empty} data-workbench-empty-area>
    <div className={css.content}>
      <h3 className={css.heading}>{editors.length ? '添加内页' : '暂无可用内页'}</h3>
      {editors.length ? <div className={css.choices} role="group" aria-label="添加内页">
        {choices.map(editor => { const presentation = resolveWorkbenchEditorPresentation(editor); return <Tooltip key={editor.scope + ':' + editor.id} label={editor.label} side="top" portal delayMs={250}>
          <button type="button" className={css.choice} aria-label={'添加内页：' + editor.label} data-empty-editor={editor.id} onClick={() => onSelect(editor)}>
            <span className={css.icon}><WorkbenchEditorIcon name={presentation.icon} iconSvg={presentation.iconSvg} /></span><span className={css.label}>{editor.label}</span>
          </button>
        </Tooltip> })}
        <Tooltip label="更多内页" side="top" portal delayMs={250}><button ref={triggerRef} type="button" className={css.choice + ' ' + css.browse}
          aria-label="更多内页" aria-haspopup="menu" aria-expanded={expanded} data-workbench-empty-editor-trigger="true" onClick={event => onBrowse(event.currentTarget)}>
          <span className={css.icon}><IconFlatListOutlineMedium size={24} /></span><span className={css.label}>更多内页</span>
        </button></Tooltip>
      </div> : <div className={css.noEditors}><p>在设置中检查内页是否已启用。</p>{onManage ? <button type="button" onClick={onManage}><IconPlusOutlineMedium size={16} />内页与扩展</button> : null}</div>}
    </div>
  </div>
}
