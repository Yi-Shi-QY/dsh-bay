import { useWorkbenchLocale } from './workbench-locale.ts'
import { IconPanelLeftOutlineMedium, IconFolderOpenOutlineMedium } from '@deepseek-ai/dsh-client-ui-primitives'
import type { WorkbenchRecordV2 } from './persistence.ts'
import type { WorkbenchEditorCatalogRow } from './catalog.ts'
import { areasOf } from './document-v3.ts'
import { WorkbenchHomePreview } from './WorkbenchHomePreview.tsx'
import css from './WorkbenchSharing.module.css'

export function WorkbenchSharingSummary({ record, editors, rootPath, complete }: {
  record: WorkbenchRecordV2 | undefined
  editors: readonly WorkbenchEditorCatalogRow[]
  rootPath?: string | undefined
  complete: boolean
}) {
  const { t } = useWorkbenchLocale()
  const areas = record ? areasOf(record.document.root) : []
  return <aside className={css.summary} aria-label={t('editor.sharedContentOverview')}>
    <div className={css.summaryTitle}><IconPanelLeftOutlineMedium size={17} /><h3>{record?.name || t('share.selectToShare')}</h3></div>
    {record ? <><div className={css.summaryCanvas}><WorkbenchHomePreview node={record.document.root} editors={editors} /></div><div className={css.summaryCounts}><span>{areas.length} {t('editor.visibleAreas')}</span><span>{areas.reduce((sum, area) => sum + area.moduleHistory.length, 0)} {t('transfer.pages')}</span></div></> : null}
    {complete && rootPath ? <div className={css.summaryPath}><IconFolderOpenOutlineMedium size={14} /><span>{rootPath}</span></div> : null}
    <div className={css.summaryCaption}><strong>{complete ? t('share.continueOnAnotherDevice') : t('share.shareWorkflow')}</strong><p>{complete ? t('share.completeSummary') : t('share.templateSummary')}</p></div>
  </aside>
}
