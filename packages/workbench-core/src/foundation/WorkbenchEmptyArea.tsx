import type { RefObject } from 'react'
import { Tooltip, IconPlusOutlineMedium, IconFlatListOutlineMedium, IconFolderOpenOutlineMedium } from '@deepseek-ai/dsh-client-ui-primitives'
import { resolveWorkbenchEditorPresentation, type WorkbenchEditorCatalogRow } from './catalog.ts'
import { WorkbenchEditorIcon } from './WorkbenchEditorIcon.tsx'
import type { WorkbenchEditorAvailabilityContextV1 } from './editor-selection.ts'
import css from './WorkbenchEmptyArea.module.css'

export function WorkbenchEmptyArea({ editors, onSelect, onBrowse, onManage, triggerRef, expanded, context, onSetProject }: {
  editors: readonly WorkbenchEditorCatalogRow[]
  onSelect(editor: WorkbenchEditorCatalogRow): void
  onBrowse(anchor: HTMLButtonElement): void
  onManage?: (() => void) | undefined
  triggerRef: RefObject<HTMLButtonElement>
  expanded: boolean
  context?: WorkbenchEditorAvailabilityContextV1
  onSetProject?: (() => void) | undefined
}) {
  const hasWorkspace = context?.hasWorkspace ?? true
  const hasSession = context?.hasSession ?? true
  const startEditor = hasWorkspace && !hasSession
    ? editors.find(editor => editor.id === 'workbench.conversation.start')
    : undefined
  const choices = editors.filter(editor => editor !== startEditor).slice(0, 5)
  const heading = !hasWorkspace
    ? '先设置项目'
    : !hasSession
      ? '项目已准备好'
      : editors.length ? '添加内页' : '暂无可用内页'
  const description = !hasWorkspace
    ? '当前只能添加不依赖对话的内页。设置项目后，才能开始新对话。'
    : !hasSession
      ? '这个项目还没有对话，先新建一个对话吧。'
      : undefined
  return <div className={css.empty} data-workbench-empty-area>
    <div className={css.content}>
      <h3 className={css.heading}>{heading}</h3>
      {description ? <p className={css.description}>{description}</p> : null}
      {startEditor ? (() => { const presentation = resolveWorkbenchEditorPresentation(startEditor); return <button type="button" className={css.primaryChoice} aria-label={'添加内页：' + startEditor.label} data-empty-editor={startEditor.id} onClick={() => onSelect(startEditor)}>
        <span className={css.icon}><WorkbenchEditorIcon name={presentation.icon} iconSvg={presentation.iconSvg} /></span><span>{startEditor.label}</span>
      </button> })() : null}
      {choices.length ? <div className={css.choices} role="group" aria-label="添加内页">
        {choices.map(editor => { const presentation = resolveWorkbenchEditorPresentation(editor); return <Tooltip key={editor.scope + ':' + editor.id} label={editor.label} side="top" portal delayMs={250}>
          <button type="button" className={css.choice} aria-label={'添加内页：' + editor.label} data-empty-editor={editor.id} onClick={() => onSelect(editor)}>
            <span className={css.icon}><WorkbenchEditorIcon name={presentation.icon} iconSvg={presentation.iconSvg} /></span><span className={css.label}>{editor.label}</span>
          </button>
        </Tooltip> })}
        <Tooltip label="更多内页" side="top" portal delayMs={250}><button ref={triggerRef} type="button" className={css.choice + ' ' + css.browse}
          aria-label="更多内页" aria-haspopup="menu" aria-expanded={expanded} data-workbench-empty-editor-trigger="true" onClick={event => onBrowse(event.currentTarget)}>
          <span className={css.icon}><IconFlatListOutlineMedium size={24} /></span><span className={css.label}>更多内页</span>
        </button></Tooltip>
      </div> : !startEditor && editors.length === 0 ? <div className={css.noEditors}><p>在设置中检查内页是否已启用。</p>{onManage ? <button type="button" onClick={onManage}><IconPlusOutlineMedium size={16} />内页与扩展</button> : null}</div> : null}
      {!hasWorkspace && onSetProject ? <button type="button" className={css.projectAction} data-workbench-empty-set-project onClick={onSetProject}><IconFolderOpenOutlineMedium size={16} />设置项目</button> : null}
    </div>
  </div>
}
