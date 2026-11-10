import { useState } from 'react'
import { IconShareOutlineMedium, IconArchiveOutlineMedium, IconCordisPluginOutlineMedium, IconDownloadOutlineMedium, IconFolderOpenOutlineMedium, IconClockOutlineMedium, IconCheckOutlineMedium } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SettingsPageProps } from './WorkbenchSettingsPages.tsx'
import type { DistributionPackageService } from './distribution-package-service.ts'
import { DESKTOP_SETTINGS_CONTEXT, settingsTargetWritable } from './settings-context.ts'
import { WorkbenchCompletePackagePanel } from './WorkbenchCompletePackagePanel.tsx'
import { WorkbenchDistributionPage } from './WorkbenchDistributionPage.tsx'
import { WorkbenchSharingSummary } from './WorkbenchSharingSummary.tsx'
import css from './WorkbenchSharing.module.css'

export function WorkbenchSharingPage(props: SettingsPageProps & { distributionPackage: DistributionPackageService }) {
  const completeAvailable = props.workbenchDirectory?.completeRequest !== undefined
  const [format, setFormat] = useState<'complete' | 'distribution'>(completeAvailable ? props.openOptions?.shareType ?? 'complete' : 'distribution')
  const [mode, setMode] = useState<'export' | 'import' | 'history'>(props.openOptions?.shareMode ?? 'export')
  const [workbenchId, setWorkbenchId] = useState(props.openOptions?.workbenchId ?? props.value?.activeWorkbenchId ?? '')
  const record = props.value?.workbenches[workbenchId]
  const writable = settingsTargetWritable(props.settingsContext ?? DESKTOP_SETTINGS_CONTEXT, workbenchId, props.windowController)
  return <section className={css.page} aria-label="分享与迁移">
    <header className={css.header}><span className={css.headerIcon} aria-hidden="true"><IconShareOutlineMedium size={23} /></span><div><h2>分享与迁移</h2><p>把整个工作台带走，或将好用的布局与扩展分享给别人。</p></div></header>
    <nav className={css.tabs} aria-label="分享操作">
      <button type="button" aria-pressed={mode === 'export'} onClick={() => setMode('export')}><IconDownloadOutlineMedium size={16} />导出工作台</button>
      <button type="button" aria-pressed={mode === 'import'} onClick={() => setMode('import')}><IconFolderOpenOutlineMedium size={16} />导入工作台</button>
      <button type="button" aria-pressed={mode === 'history'} onClick={() => setMode('history')}><IconClockOutlineMedium size={16} />导入记录</button>
    </nav>
    {completeAvailable ? <div className={css.choices} role="group" aria-label="工作台包类型">
      {completeAvailable ? <button type="button" className={css.choice} aria-label="完整工作台包" aria-pressed={format === 'complete'} onClick={() => setFormat('complete')}><span className={css.choiceIcon}><IconArchiveOutlineMedium size={21} /></span><span className={css.choiceCopy}><strong>完整工作台包</strong><small>项目文件、对话、记忆与任务一起迁移</small></span><span className={css.choiceCheck}>{format === 'complete' ? <IconCheckOutlineMedium size={12} /> : null}</span></button> : null}
      <button type="button" className={css.choice} aria-label="布局与扩展" aria-pressed={format === 'distribution'} onClick={() => setFormat('distribution')}><span className={css.choiceIcon}><IconCordisPluginOutlineMedium size={21} /></span><span className={css.choiceCopy}><strong>布局与扩展</strong><small>复用区域安排、内页和扩展配置</small></span><span className={css.choiceCheck}>{format === 'distribution' ? <IconCheckOutlineMedium size={12} /> : null}</span></button>
    </div> : null}
    {completeAvailable ? <div hidden={format !== 'complete'}>
      <WorkbenchCompletePackagePanel workbenchId={record ? workbenchId : ''} mode={mode} disabled={!writable}
        {...(props.workbenchDirectory?.pickParentDirectory ? { pickParentDirectory: props.workbenchDirectory.pickParentDirectory } : {})}
        sourceControl={<label className={css.field}>来源工作台<select aria-label="完整包来源工作台" value={record ? workbenchId : ''} onChange={event => setWorkbenchId(event.target.value)}><option value="" disabled>选择工作台</option>{Object.values(props.value?.workbenches ?? {}).map(row => <option key={row.workbenchId} value={row.workbenchId}>{row.name}</option>)}</select>{!writable ? <span>此工作台正在浏览器中使用，请先收回再导出。</span> : null}</label>}
        summary={<WorkbenchSharingSummary record={record} editors={props.editors} rootPath={props.workbenchDirectory?.getRootPath?.(workbenchId)} complete />} />
    </div> : null}
    <div hidden={format !== 'distribution'}><WorkbenchDistributionPage {...props} embedded active={format === 'distribution'} viewMode={mode} onViewModeChange={setMode} selectedWorkbenchId={workbenchId} onWorkbenchChange={setWorkbenchId} /></div>
  </section>
}
