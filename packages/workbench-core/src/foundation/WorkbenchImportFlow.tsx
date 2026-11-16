import { IconArchiveOutlineMedium, IconFolderOpenOutlineMedium, IconNewChatOutlineMedium, IconDatabaseOutlineMedium, IconBranchOutlineMedium, IconCheckCircleOutlineMedium, IconPlusOutlineMedium, IconPauseOutlineMedium } from '@deepseek-ai/dsh-client-ui-primitives'
import type { CompletePackageDirectoryRequest, CompletePackageJobView, CompletePackagePreflight, CompletePackageUpload } from '../workbench-complete-contract.ts'
import { suggestedWorkbenchFolder, workbenchFolderNameError, workbenchTargetPath } from '../workbench-folder-name.ts'
import { WorkbenchHomePreview } from './WorkbenchHomePreview.tsx'
import type { WorkbenchEditorCatalogRow } from './catalog.ts'
import { WorkbenchCompleteJob } from './WorkbenchCompleteJob.tsx'
import css from './WorkbenchSettings.module.css'
import sharing from './WorkbenchSharing.module.css'

export interface WorkbenchImportTransfer {
  upload?: CompletePackageUpload
  uploadRequest?: { name: string; size: number; lastModified: number; requestId: string }
  preflight?: CompletePackagePreflight
  selection?: CompletePackageDirectoryRequest
  folderName: string
  name?: string
  jobId?: string
}

export function WorkbenchImportFlow({ transfer, job, busy, browser, disabled, editors = [], unifiedPicker = false, onFile, onChange, onSelectParent, onStart, onPause, onNew, jobActions }: {
  transfer: WorkbenchImportTransfer; job: CompletePackageJobView | undefined; busy: boolean; browser: boolean; disabled: boolean
  editors?: readonly WorkbenchEditorCatalogRow[]
  unifiedPicker?: boolean
  onFile(file: File): void; onChange(value: Partial<WorkbenchImportTransfer>): void; onSelectParent(): void; onStart(): void; onPause(): void; onNew(): void
  jobActions: Pick<React.ComponentProps<typeof WorkbenchCompleteJob>, 'onOpen' | 'onResume' | 'onCancel' | 'onCorrectLocation' | 'onMapExtensions' | 'onConfirmExtensions' | 'onRestart' | 'browser'>
}) {
  const { preflight, selection, upload } = transfer
  const overview = preflight?.overview ?? job?.overview
  const percent = upload ? Math.min(100, Math.round(upload.received / Math.max(1, upload.size) * 100)) : 0
  const step = job?.stage === 'complete' ? 3 : job || transfer.jobId || selection?.state === 'consumed' ? 2 : preflight ? 1 : 0
  const folderError = workbenchFolderNameError(transfer.folderName)
  const target = workbenchTargetPath(selection?.displayPath ?? '', transfer.folderName)
  return <div className={sharing.importFlow}>
    <ol className={sharing.stepper} aria-label="导入步骤">{['选择与检查', '内容与位置', '准备扩展并恢复数据', '校验与发布'].map((label, index) => <li key={label} data-state={index === step ? 'current' : index < step ? 'done' : 'next'} aria-current={index === step ? 'step' : undefined}><span>{index < step ? <IconCheckCircleOutlineMedium size={16} /> : index + 1}</span><strong>{label}</strong></li>)}</ol>
    <div className={sharing.workspace}>
      <section className={sharing.formPanel}>
        <div className={sharing.formIntro}><h3>{['接收一个工作台', '确认内容与存放位置', '恢复你的工作空间', '工作台已准备好'][step]}</h3><p>{['选择完整工作台包，带回项目文件、对话和工作进展。', '将在新的文件夹内恢复，原有工作台保持不变。', '作业由 DSH 持续处理，重新打开此页可以继续查看。', '数据已恢复，检查运行环境后再主动继续任务。'][step]}</p></div>
        {step < 2 ? <>
          {!unifiedPicker ? <label className={`${sharing.upload} ${preflight ? sharing.uploadCompact : ''}`} data-disabled={disabled || busy}>
            <IconArchiveOutlineMedium size={30} /><strong>{upload?.name || '选择完整工作台包'}</strong><span>{preflight ? '重新选择文件' : '点击选择文件'}</span><small>完整包 V5 / V6 · .tar.gz / .tgz / .gz</small>
            <input aria-label="接收完整包" type="file" accept=".gz,.tgz,.tar.gz" disabled={disabled || busy} onChange={event => { const file = event.target.files?.[0]; if (file) onFile(file); event.target.value = '' }} />
          </label> : null}
          {upload ? <div className={sharing.transferState} role="status"><span>{preflight ? `内容检查通过 · ${preflight.sessionCount} 个会话` : percent === 100 && busy ? '上传完成，正在检查文件、对话与关联…' : `已上传 ${percent}%${busy ? '' : ' · 重新选择同一文件可以继续'}`}</span>{!preflight ? <progress className={sharing.progress} aria-label={percent === 100 && busy ? '完整包检查进度' : '完整包上传进度'} max={100} {...(percent === 100 && busy ? {} : { value: percent })} /> : null}</div> : null}
          {busy && upload && !preflight ? <button type="button" className={css.secondaryButton} onClick={onPause}><IconPauseOutlineMedium size={16} />暂停传输与检查</button> : null}
          {preflight ? <>
            {preflight.warnings?.map(text => <p className={sharing.hint} key={text}>{text}</p>)}
            <p className={sharing.hint}>先准备文件与布局，再确认所需扩展。需要重启时由你确认；会话和扩展数据恢复、校验完成后才发布工作台。</p>
            <label className={sharing.field}>工作台名称<input maxLength={160} value={transfer.name ?? overview?.name ?? ''} disabled={busy || disabled} placeholder="为接收的工作台命名" onChange={event => onChange({ name: event.target.value })} /></label>
            <label className={sharing.field}>新工作台文件夹名称<input maxLength={160} value={transfer.folderName} disabled={busy || disabled} placeholder={suggestedWorkbenchFolder(overview?.name ?? '')} onChange={event => onChange({ folderName: event.target.value })} /></label>
            {transfer.folderName && folderError ? <p className={sharing.error} role="alert">{folderError}</p> : null}
            <div className={sharing.destination}><IconFolderOpenOutlineMedium size={20} /><div><strong>目标位置</strong><p>{target || (selection?.state === 'selected' ? '已选择父目录，可重新选择以查看完整路径' : browser ? '由 DSH 客户端选择主机上的父目录' : '选择父目录后，在这里创建新的工作台文件夹')}</p></div></div>
            <div className={sharing.actionBar}><button type="button" className={css.secondaryButton} disabled={busy || disabled || selection?.state === 'pending'} onClick={onSelectParent}><IconFolderOpenOutlineMedium size={16} />{browser ? '请 DSH 客户端选择目标目录' : '选择目标父目录'}</button><button type="button" className={css.primaryButton} disabled={busy || disabled || selection?.state !== 'selected' || !!folderError} onClick={onStart}><IconPlusOutlineMedium size={16} />{busy ? '正在准备导入…' : '导入并保持暂停'}</button></div>
            {selection?.state === 'pending' ? <p className={sharing.hint} role="status">正在等待 DSH 客户端确认目标目录。确认后可在此继续导入。</p> : null}
            {selection?.state === 'selected' ? <p className={sharing.hint} role="status">DSH 客户端已确认目标目录。</p> : null}
            {selection?.state === 'cancelled' ? <p className={sharing.hint} role="status">目录选择已取消，可以重新选择。</p> : null}
          </> : <p className={sharing.hint}>{unifiedPicker ? '完整包恢复项目与工作进展；模板包复用布局、内页和配置，选择后自动进入对应流程。' : '这里接收完整工作台包。工作台模板包请在 DSH 客户端导入。'}</p>}
        </> : job ? <>
          <WorkbenchCompleteJob job={job} busy={busy} disabled={disabled} {...jobActions} showReport />
          {job.stage === 'complete' && browser ? <p className={sharing.hint}>请在 DSH 客户端打开新工作台；当前浏览器继续管理原工作台。</p> : null}
          {job.stage === 'complete' ? <button type="button" className={css.secondaryButton} onClick={onNew}>导入另一个工作台</button> : null}
        </> : <p className={sharing.hint} role="status">正在读取恢复作业…</p>}
      </section>
      <aside className={sharing.summary} aria-label="导入内容概览">
        <div className={sharing.summaryTitle}><IconArchiveOutlineMedium size={18} /><h3>{overview?.name ?? '完整保留工作进展'}</h3></div>
        {overview ? <>
          <div className={sharing.summaryCanvas}><WorkbenchHomePreview node={overview.layout} editors={editors} /></div>
          {overview.description ? <p className={sharing.hint}>{overview.description}</p> : null}
          <div className={sharing.summaryCounts}><span>{overview.areaCount} 个区域</span><span>{overview.pageCount} 个内页</span><span>{(overview.bytes / 1024 / 1024).toFixed(1)} MB 文件内容</span></div>
          <dl className={sharing.importCounts}><div><dt><IconFolderOpenOutlineMedium size={16} />项目与文件</dt><dd>{overview.projectCount} 个项目 · {overview.fileCount} 个文件</dd></div><div><dt><IconNewChatOutlineMedium size={16} />对话历史</dt><dd>{preflight?.sessionCount ?? 0} 个会话</dd></div><div><dt><IconDatabaseOutlineMedium size={16} />专属记忆</dt><dd>{overview.memoryCount} 条</dd></div><div><dt><IconBranchOutlineMedium size={16} />任务记录</dt><dd>{overview.taskCount} 项</dd></div></dl>
        </> : <ul className={sharing.importIncludes}><li><IconFolderOpenOutlineMedium size={18} /><div><strong>项目与目录</strong><p>工作文件和项目关系一起恢复</p></div></li><li><IconNewChatOutlineMedium size={18} /><div><strong>对话与记忆</strong><p>保留历史、附件和专属知识</p></div></li><li><IconBranchOutlineMedium size={18} /><div><strong>任务与进展</strong><p>恢复后由你决定何时继续</p></div></li></ul>}
        <div className={sharing.summaryCaption}><strong>换一个位置，接着工作</strong><p>检查完成后可以预览布局和内容。导入只恢复数据，模型连接与运行环境由你确认。</p></div>
      </aside>
    </div>
  </div>
}
