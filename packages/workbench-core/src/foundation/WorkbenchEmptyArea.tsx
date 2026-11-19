import type { RefObject } from 'react'
import { Tooltip, IconPlusOutlineMedium, IconFlatListOutlineMedium, IconFolderOpenOutlineMedium } from '@deepseek-ai/dsh-client-ui-primitives'
import { resolveWorkbenchEditorPresentation, type WorkbenchEditorCatalogRow } from './catalog.ts'
import { WorkbenchEditorIcon } from './WorkbenchEditorIcon.tsx'
import type { WorkbenchEditorAvailabilityContextV1 } from './editor-selection.ts'
import { useWorkbenchLocale, workbenchPageTitle } from './workbench-locale.ts'
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
  const { t } = useWorkbenchLocale()
  const hasWorkspace = context?.hasWorkspace ?? true
  const hasSession = context?.hasSession ?? true
  const startEditor = hasWorkspace && !hasSession
    ? editors.find(editor => editor.id === 'workbench.conversation.start')
    : undefined
  const choices = editors.filter(editor => editor !== startEditor).slice(0, 5)
  const heading = !hasWorkspace
    ? t('empty.setup')
    : !hasSession
      ? t('empty.ready')
      : t(editors.length ? 'page.add' : 'page.none')
  const description = !hasWorkspace
    ? t('empty.setupHint')
    : !hasSession
      ? t('empty.readyHint')
      : undefined
  return <div className={css.empty} data-workbench-empty-area>
    <div className={css.content}>
      <h3 className={css.heading}>{heading}</h3>
      {description ? <p className={css.description}>{description}</p> : null}
      {startEditor ? (() => { const presentation = resolveWorkbenchEditorPresentation(startEditor); const name = workbenchPageTitle(t, startEditor.id, startEditor.label); return <button type="button" className={css.primaryChoice} aria-label={t('page.addNamed', { name })} data-empty-editor={startEditor.id} onClick={() => onSelect(startEditor)}>
        <span className={css.icon}><WorkbenchEditorIcon name={presentation.icon} iconSvg={presentation.iconSvg} /></span><span>{name}</span>
      </button> })() : null}
      {choices.length ? <div className={css.choices} role="group" aria-label={t('page.add')}>
        {choices.map(editor => { const presentation = resolveWorkbenchEditorPresentation(editor); const name = workbenchPageTitle(t, editor.id, editor.label); return <Tooltip key={editor.scope + ':' + editor.id} label={name} side="top" portal delayMs={250}>
          <button type="button" className={css.choice} aria-label={t('page.addNamed', { name })} data-empty-editor={editor.id} onClick={() => onSelect(editor)}>
            <span className={css.icon}><WorkbenchEditorIcon name={presentation.icon} iconSvg={presentation.iconSvg} /></span><span className={css.label}>{name}</span>
          </button>
        </Tooltip> })}
        <Tooltip label={t('empty.more')} side="top" portal delayMs={250}><button ref={triggerRef} type="button" className={css.choice + ' ' + css.browse}
          aria-label={t('empty.more')} aria-haspopup="menu" aria-expanded={expanded} data-workbench-empty-editor-trigger="true" onClick={event => onBrowse(event.currentTarget)}>
          <span className={css.icon}><IconFlatListOutlineMedium size={24} /></span><span className={css.label}>{t('empty.more')}</span>
        </button></Tooltip>
      </div> : !startEditor && editors.length === 0 ? <div className={css.noEditors}><p>{t('empty.settingsHint')}</p>{onManage ? <button type="button" onClick={onManage}><IconPlusOutlineMedium size={16} />{t('empty.manage')}</button> : null}</div> : null}
      {!hasWorkspace && onSetProject ? <button type="button" className={css.projectAction} data-workbench-empty-set-project onClick={onSetProject}><IconFolderOpenOutlineMedium size={16} />{t('empty.setProject')}</button> : null}
    </div>
  </div>
}
