import { useRef, useState } from 'react'
import { IconShareOutlineMedium, IconArchiveOutlineMedium, IconCordisPluginOutlineMedium, IconDownloadOutlineMedium, IconFolderOpenOutlineMedium, IconClockOutlineMedium, IconCheckOutlineMedium } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SettingsPageProps } from './WorkbenchSettingsPages.tsx'
import type { DistributionPackageService } from './distribution-package-service.ts'
import { DESKTOP_SETTINGS_CONTEXT, settingsTargetWritable } from './settings-context.ts'
import { WorkbenchCompletePackagePanel } from './WorkbenchCompletePackagePanel.tsx'
import { WorkbenchDistributionPage } from './WorkbenchDistributionPage.tsx'
import { WorkbenchSharingSummary } from './WorkbenchSharingSummary.tsx'
import css from './WorkbenchSharing.module.css'
import { workbenchPackageKind } from './workbench-package-kind.ts'

export function WorkbenchSharingPage(props: SettingsPageProps & { distributionPackage?: DistributionPackageService }) {
  const browser = props.settingsContext?.mode === 'browser-workbench'
  const completeAvailable = props.workbenchDirectory?.completeRequest !== undefined
  const [format, setFormat] = useState<'complete' | 'distribution'>(completeAvailable ? props.openOptions?.shareType ?? 'complete' : 'distribution')
  const [mode, setMode] = useState<'export' | 'import' | 'history'>(props.openOptions?.shareMode ?? 'export')
  const [workbenchId, setWorkbenchId] = useState(props.settingsContext?.mode === 'browser-workbench' ? props.settingsContext.workbenchId : props.openOptions?.workbenchId ?? props.value?.activeWorkbenchId ?? '')
  const record = props.value?.workbenches[workbenchId]
  const writable = settingsTargetWritable(props.settingsContext ?? DESKTOP_SETTINGS_CONTEXT, workbenchId, props.windowController)
  const [importFormat, setImportFormat] = useState<'complete' | 'distribution'>(completeAvailable ? 'complete' : 'distribution')
  const [selection, setSelection] = useState<{ id: number; file: File; kind: 'complete' | 'distribution' }>()
  const [reading, setReading] = useState(false), [completeBusy, setCompleteBusy] = useState(false), [templateBusy, setTemplateBusy] = useState(false)
  const [importError, setImportError] = useState<string>()
  const generation = useRef(0), choosing = useRef(false)
  const unifiedPicker = completeAvailable && !!props.distributionPackage
  const visibleFormat = mode === 'import' ? importFormat : !props.distributionPackage ? 'complete' : format
  const chooseFile = async (file: File) => {
    if (choosing.current || completeBusy || templateBusy) return
    choosing.current = true; setReading(true); setImportError(undefined)
    try {
      const kind = workbenchPackageKind(new Uint8Array(await file.slice(0, 4).arrayBuffer()))
      if (kind === 'distribution' && browser) throw new Error('请在 DSH 客户端导入工作台模板包。')
      setImportFormat(kind); setSelection({ id: ++generation.current, file, kind })
    } catch (error) { setImportError(error instanceof Error ? error.message : '无法读取工作台包。') }
    finally { choosing.current = false; setReading(false) }
  }
  return <section className={css.page} aria-label="分享与迁移">
    <header className={css.header}><span className={css.headerIcon} aria-hidden="true"><IconShareOutlineMedium size={23} /></span><div><h2>分享与迁移</h2><p>把整个工作台带走，或将好用的布局与扩展分享给别人。</p></div></header>
    <nav className={css.tabs} aria-label="分享操作">
      <button type="button" aria-pressed={mode === 'export'} onClick={() => setMode('export')}><IconDownloadOutlineMedium size={16} />导出工作台</button>
      <button type="button" aria-pressed={mode === 'import'} onClick={() => setMode('import')}><IconFolderOpenOutlineMedium size={16} />导入工作台</button>
      <button type="button" aria-pressed={mode === 'history'} onClick={() => setMode('history')}><IconClockOutlineMedium size={16} />导入记录</button>
    </nav>
    {completeAvailable && props.distributionPackage && mode === 'export' ? <div className={css.choices} role="group" aria-label="工作台包类型">
      {completeAvailable ? <button type="button" className={css.choice} aria-label="完整工作台包" aria-pressed={format === 'complete'} onClick={() => setFormat('complete')}><span className={css.choiceIcon}><IconArchiveOutlineMedium size={21} /></span><span className={css.choiceCopy}><strong>完整工作台包</strong><small>项目文件、对话、记忆与任务一起迁移</small></span><span className={css.choiceCheck}>{format === 'complete' ? <IconCheckOutlineMedium size={12} /> : null}</span></button> : null}
      <button type="button" className={css.choice} aria-label="工作台模板包" aria-pressed={format === 'distribution'} onClick={() => setFormat('distribution')}><span className={css.choiceIcon}><IconCordisPluginOutlineMedium size={21} /></span><span className={css.choiceCopy}><strong>工作台模板包</strong><small>复用区域、内页和配置，使用自己的项目</small></span><span className={css.choiceCheck}>{format === 'distribution' ? <IconCheckOutlineMedium size={12} /> : null}</span></button>
    </div> : null}
    {mode === 'import' && unifiedPicker ? <section className={css.formPanel} aria-label="选择工作台包">
      <label className={css.upload} data-disabled={reading || completeBusy || templateBusy}>
        <IconFolderOpenOutlineMedium size={28} /><strong>{reading ? '正在识别包类型…' : selection?.file.name ?? '选择工作台包'}</strong>
        <span>自动识别完整工作台包或工作台模板包</span><small>.tar.gz / .tgz / .gz / .wbpkg / .zip</small>
        <input type="file" aria-label="选择要导入的工作台包" accept=".tar.gz,.tgz,.gz,.wbpkg,.zip" disabled={reading || completeBusy || templateBusy} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void chooseFile(file) }} />
      </label>
      {selection ? <p className={css.hint} role="status">已识别为{selection.kind === 'complete' ? '完整工作台包' : '工作台模板包'}，导入前还会检查包内清单和内容。</p> : null}
      {importError ? <p className={css.error} role="alert">{importError}</p> : null}
    </section> : null}
    {completeAvailable ? <div hidden={mode !== 'history' && visibleFormat !== 'complete'}>
      <WorkbenchCompletePackagePanel workbenchId={browser || record ? workbenchId : ''} mode={mode} browser={browser} disabled={mode === 'export' || browser ? !writable : false} editors={props.editors}
        unifiedPicker={unifiedPicker} importSelection={selection?.kind === 'complete' ? selection : undefined} onImportBusyChange={setCompleteBusy}
        onOpenWorkbench={props.onOpenWorkbench ?? (props.workbenchDirectory ? async id => { const result = await props.workbenchDirectory!.openAndSelect(id); if (result.status !== 'committed') throw new Error('工作台暂时无法打开，请恢复连接后重试。') } : undefined)} onImport={() => { setMode('import'); setImportFormat('complete'); setSelection(undefined) }}
        {...(props.workbenchDirectory?.pickParentDirectory ? { pickParentDirectory: props.workbenchDirectory.pickParentDirectory } : {})}
        sourceControl={browser ? <p className={css.hint}>{record?.name ?? '当前工作台'}</p> : <label className={css.field}>来源工作台<select aria-label="完整包来源工作台" value={record ? workbenchId : ''} onChange={event => setWorkbenchId(event.target.value)}><option value="" disabled>{Object.keys(props.value?.workbenches ?? {}).length ? '选择工作台' : '接收第一个工作台'}</option>{Object.values(props.value?.workbenches ?? {}).map(row => <option key={row.workbenchId} value={row.workbenchId}>{row.name}</option>)}</select>{!writable ? <span>此工作台正在浏览器中使用，请先收回再导出。</span> : null}</label>}
        summary={<WorkbenchSharingSummary record={record} editors={props.editors} rootPath={props.workbenchDirectory?.getRootPath?.(workbenchId)} complete />} />
    </div> : null}
    {props.distributionPackage ? <div hidden={mode !== 'history' && visibleFormat !== 'distribution'}><WorkbenchDistributionPage {...props} distributionPackage={props.distributionPackage} embedded active={mode === 'history' || visibleFormat === 'distribution'} viewMode={mode} onViewModeChange={next => { setMode(next); if (next === 'import') { setImportFormat('distribution'); setSelection(undefined) } }} selectedWorkbenchId={workbenchId} onWorkbenchChange={setWorkbenchId} unifiedPicker={unifiedPicker} importSelection={selection?.kind === 'distribution' ? selection : undefined} onImportBusyChange={setTemplateBusy} /></div> : null}
  </section>
}
