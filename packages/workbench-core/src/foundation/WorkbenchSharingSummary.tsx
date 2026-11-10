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
  const areas = record ? areasOf(record.document.root) : []
  return <aside className={css.summary} aria-label="分享内容概览">
    <div className={css.summaryTitle}><IconPanelLeftOutlineMedium size={17} /><h3>{record?.name || '选择要分享的工作台'}</h3></div>
    {record ? <><div className={css.summaryCanvas}><WorkbenchHomePreview node={record.document.root} editors={editors} /></div><div className={css.summaryCounts}><span>{areas.length} 个可见区域</span><span>{areas.reduce((sum, area) => sum + area.moduleHistory.length, 0)} 个内页</span></div></> : null}
    {complete && rootPath ? <div className={css.summaryPath}><IconFolderOpenOutlineMedium size={14} /><span>{rootPath}</span></div> : null}
    <div className={css.summaryCaption}><strong>{complete ? '换台机器，接着工作' : '把好用的工作方式分享出去'}</strong><p>{complete ? '项目文件、对话历史、记忆与任务关系一起带走。接收方导入后，自行配置运行环境并继续任务。' : '复用区域布局、内页和可迁移配置。接收方使用自己的项目与会话，扩展按所选方式恢复。'}</p></div>
  </aside>
}
