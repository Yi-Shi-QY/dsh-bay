import { browserSafeUuid } from '../browser-safe-id.ts'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createWorkbenchCompleteClient } from '../client/workbench-complete.ts'
import type { CompletePackageDirectoryRequest, CompletePackageJobView, CompletePackagePreflight, CompletePackageUpload } from '../workbench-complete-contract.ts'
import { IconArchiveOutlineMedium, IconDownloadOutlineMedium, IconFolderOpenOutlineMedium, IconNewChatOutlineMedium, IconDatabaseOutlineMedium, IconBranchOutlineMedium, IconClockOutlineMedium, IconCheckCircleOutlineMedium, IconWarningOutlineMedium, IconRefreshOutlineMedium, IconPauseOutlineMedium, IconPlusOutlineMedium } from '@deepseek-ai/dsh-client-ui-primitives'
import css from './WorkbenchSettings.module.css'
import sharing from './WorkbenchSharing.module.css'

const labels: Record<CompletePackageJobView['stage'], string> = { queued: '等待处理', preflight: '检查内容', snapshot: '生成快照', files: '处理文件', sessions: '恢复对话', relations: '恢复关联', publish: '登记工作台', complete: '已完成', cancelled: '已取消，可继续', failed: '需要处理' }
type Transfer = { upload?: CompletePackageUpload; uploadRequest?: { name: string; size: number; lastModified: number; requestId: string }; preflight?: CompletePackagePreflight; selection?: CompletePackageDirectoryRequest; folderName: string }
const storageKey = (workbenchId: string) => 'bay.complete-transfer.v1.' + workbenchId
function savedTransfer(workbenchId: string): Transfer {
  try { return JSON.parse(sessionStorage.getItem(storageKey(workbenchId)) ?? 'null') as Transfer ?? { folderName: '' } }
  catch { return { folderName: '' } }
}
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error)

/** Shared desktop/browser panel. Bytes stay in File slices and the browser download manager. */
interface CompletePanelProps {
  workbenchId: string
  mode?: 'export' | 'import' | 'history'
  sourceControl?: ReactNode
  summary?: ReactNode
  browser?: boolean
  disabled?: boolean
  pickParentDirectory?: () => Promise<string | undefined>
}
export function WorkbenchCompletePackagePanel(props: CompletePanelProps) {
  return <CompletePackagePanel key={props.workbenchId} {...props} />
}
function CompletePackagePanel({ workbenchId, mode, sourceControl, summary, browser = false, disabled = false, pickParentDirectory }: CompletePanelProps) {
  const client = useMemo(() => createWorkbenchCompleteClient(), [])
  const [transfer, setTransfer] = useState<Transfer>(() => savedTransfer(workbenchId))
  const [jobs, setJobs] = useState<CompletePackageJobView[]>([])
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const uploadAbort = useRef<AbortController>()
  const exportRequestId = useRef('export-' + browserSafeUuid())
  const activeWorkbench = useRef(workbenchId)
  activeWorkbench.current = workbenchId
  useEffect(() => { try { sessionStorage.setItem(storageKey(workbenchId), JSON.stringify(transfer)) } catch { /* Host records retain every committed operation. */ } }, [workbenchId, transfer])
  useEffect(() => () => { uploadAbort.current?.abort() }, [])
  useEffect(() => {
    const controller = new AbortController(); let pending = false
    const refresh = async () => {
      if (pending) return
      pending = true
      try {
        const values = await client.request<CompletePackageJobView[]>({ action: 'jobs', workbenchId }, controller.signal)
        if (!controller.signal.aborted) setJobs(values.sort((a, b) => b.updatedAt - a.updatedAt))
      } catch (reason) { if (!controller.signal.aborted) setError(errorText(reason)) }
      finally { pending = false }
    }
    void refresh(); const timer = setInterval(() => { void refresh() }, 1500)
    return () => { controller.abort(); clearInterval(timer) }
  }, [client, workbenchId])
  const selectionId = transfer.selection?.id
  useEffect(() => {
    if (!selectionId || transfer.selection?.state !== 'pending') return
    const controller = new AbortController(); let pending = false
    const refresh = async () => {
      if (pending) return
      pending = true
      try {
        const selection = await client.request<CompletePackageDirectoryRequest>({ action: 'directory-status', id: selectionId }, controller.signal)
        if (!controller.signal.aborted) setTransfer(current => ({ ...current, selection }))
      } catch (reason) { if (!controller.signal.aborted) setError(errorText(reason)) }
      finally { pending = false }
    }
    void refresh(); const timer = setInterval(() => { void refresh() }, 1500)
    return () => { controller.abort(); clearInterval(timer) }
  }, [client, selectionId, transfer.selection?.state])
  const run = async (operation: () => Promise<void>) => {
    setBusy(true); setError(undefined)
    try { await operation() } catch (reason) { setError(errorText(reason)) } finally { setBusy(false) }
  }
  const chooseFile = (file: File) => run(async () => {
    const sourceId = workbenchId, abort = new AbortController(); uploadAbort.current = abort
    const same = transfer.uploadRequest?.name === file.name && transfer.uploadRequest.size === file.size && transfer.uploadRequest.lastModified === file.lastModified && transfer.upload?.state !== 'cancelled'
    const requestId = same ? transfer.uploadRequest!.requestId : 'upload-' + browserSafeUuid()
    const uploadRequest = { name: file.name, size: file.size, lastModified: file.lastModified, requestId }
    setTransfer(current => ({ folderName: current.folderName, uploadRequest }))
    const result = await client.upload(file, { workbenchId: sourceId, requestId }, upload => {
      if (activeWorkbench.current === sourceId) setTransfer(current => ({ ...current, upload }))
    }, abort.signal)
    if (activeWorkbench.current === sourceId) setTransfer({ ...result, uploadRequest, folderName: transfer.folderName || result.preflight.workbenchId.replace(/[^\p{L}\p{N}_-]/gu, '-') })
  })
  const selectParent = () => run(async () => {
    const selection = await client.request<CompletePackageDirectoryRequest>({ action: 'directory-request', uploadId: transfer.upload!.id, requestId: 'directory-' + browserSafeUuid() })
    setTransfer(current => ({ ...current, selection }))
    if (!browser) {
      if (!pickParentDirectory) throw new Error('此界面暂不可选择目录，请在 DSH 客户端处理目录请求。')
      const parentPath = await pickParentDirectory()
      const result = await client.request<CompletePackageDirectoryRequest>({ action: 'directory-complete', id: selection.id, ...(parentPath ? { parentPath } : { cancelled: true }) })
      setTransfer(current => ({ ...current, selection: result }))
    }
  })
  const startImport = () => run(async () => {
    const job = await client.request<CompletePackageJobView>({ action: 'start-import', workbenchId, uploadId: transfer.upload!.id, directoryRequestId: transfer.selection!.id, folderName: transfer.folderName, requestId: 'import-' + transfer.selection!.id })
    setJobs(current => [job, ...current.filter(row => row.id !== job.id)])
    setTransfer(current => ({ ...current, selection: { ...current.selection!, state: 'consumed' } }))
  })
  const uploadPercent = transfer.upload ? Math.min(100, Math.round(transfer.upload.received / Math.max(1, transfer.upload.size) * 100)) : 0
  const shownJobs = mode === 'history' ? jobs.filter(job => job.kind === 'import') : jobs
  return <section className={sharing.complete} aria-label="完整工作台包">
    {!mode || mode === 'export' ? <div className={summary ? sharing.workspace : undefined}>
      <section className={sharing.formPanel}>
        <div className={sharing.formIntro}><h3>导出完整工作台</h3><p>把项目与工作进展一起打包，便于备份或在另一台机器继续。</p></div>
        <fieldset className={sharing.sourceControl} disabled={disabled || busy}>{sourceControl}</fieldset>
        <ul className={sharing.coverage} aria-label="完整包包含内容">
          <li><IconFolderOpenOutlineMedium size={16} />项目文件与目录</li><li><IconNewChatOutlineMedium size={16} />对话历史与附件</li>
          <li><IconDatabaseOutlineMedium size={16} />工作背景与记忆</li><li><IconBranchOutlineMedium size={16} />任务关系与进度</li>
        </ul>
        <div className={sharing.actionBar}><button type="button" className={css.primaryButton} disabled={disabled || busy || !workbenchId} onClick={() => { void run(async () => {
          const job = await client.request<CompletePackageJobView>({ action: 'start-export', workbenchId, requestId: exportRequestId.current })
          exportRequestId.current = 'export-' + browserSafeUuid()
          setJobs(current => [job, ...current.filter(row => row.id !== job.id)])
        }) }}><IconArchiveOutlineMedium size={16} />生成完整包</button><span>完成后在下方下载</span></div>
      </section>{summary}
    </div> : null}
    {!mode || mode === 'import' ? <div className={mode ? sharing.workspace : undefined}>
      <section className={sharing.formPanel}>
        <div className={sharing.formIntro}><h3>接收完整工作台</h3><p>先选择完整包检查内容，再指定新工作台的存放位置。</p></div>
        <label className={sharing.upload} data-disabled={disabled || busy || browser && !workbenchId}>
          <IconArchiveOutlineMedium size={30} /><strong>{transfer.upload?.name || '选择完整工作台包'}</strong><span>点击选择文件</span><small>支持 .tar.gz、.tgz、.gz</small>
          <input aria-label="接收完整包" type="file" accept=".gz,.tgz,.tar.gz" disabled={disabled || busy || browser && !workbenchId} onChange={event => { const file = event.target.files?.[0]; if (file) void chooseFile(file); event.target.value = '' }} />
        </label>
        {transfer.upload ? <div className={sharing.transferState} role="status"><span>已上传 {uploadPercent}%{transfer.preflight ? ` · 内容检查通过，含 ${transfer.preflight.sessionCount} 个会话` : ' · 中断后重新选择同一文件可以继续'}</span><progress className={sharing.progress} aria-label="完整包上传进度" max={100} value={uploadPercent} /></div> : null}
        {busy && uploadAbort.current && !transfer.preflight ? <div className={sharing.jobActions}><button type="button" className={css.secondaryButton} onClick={() => uploadAbort.current?.abort(new Error('已暂停上传，可重新选择同一文件继续。'))}><IconPauseOutlineMedium size={16} />暂停上传</button></div> : null}
        {transfer.preflight ? <>
          <label className={sharing.field}>新工作台文件夹名称<input value={transfer.folderName} disabled={busy || disabled || transfer.selection?.state === 'consumed'} onChange={event => setTransfer(current => ({ ...current, folderName: event.target.value }))} /></label>
          <div className={sharing.actionBar}><button type="button" className={css.secondaryButton} disabled={busy || disabled || transfer.selection?.state === 'pending' || transfer.selection?.state === 'consumed'} onClick={() => { void selectParent() }}><IconFolderOpenOutlineMedium size={16} />{browser ? '请 DSH 客户端选择目标目录' : '选择目标父目录'}</button>
            <button type="button" className={css.primaryButton} disabled={busy || disabled || transfer.selection?.state !== 'selected' || !transfer.folderName.trim()} onClick={() => { void startImport() }}><IconPlusOutlineMedium size={16} />导入并保持暂停</button></div>
          {transfer.selection?.state === 'pending' ? <p className={sharing.hint} role="status">正在等待 DSH 客户端确认目标目录。此页面可以保持打开，确认后继续导入。</p> : null}
          {transfer.selection?.state === 'selected' ? <p className={sharing.hint} role="status">DSH 客户端已确认目标目录。</p> : null}
          {transfer.selection?.state === 'cancelled' ? <p className={sharing.hint} role="status">目录选择已取消，可以重新选择。</p> : null}
        </> : null}
      </section>
      {mode ? <aside className={sharing.summary}><div className={sharing.summaryTitle}><IconBranchOutlineMedium size={17} /><h3>恢复流程</h3></div><ol className={sharing.steps}>
        <li><div><strong>选择文件，检查完整性</strong><p>确认目录、会话及依赖信息，保留可继续的上传进度。</p></div></li>
        <li><div><strong>选择新工作台的位置</strong><p>{browser ? '由 DSH 客户端选择主机上的父目录，再回到此页继续。' : '在本机选择父目录，并设置新工作台文件夹名称。'}</p></div></li>
        <li><div><strong>恢复完成后，由你继续</strong><p>文件、历史与任务关系恢复后，检查运行环境，主动继续工作。</p></div></li>
      </ol></aside> : null}
    </div> : null}
    {error ? <p className={sharing.error} role="alert"><IconWarningOutlineMedium size={16} />{error}</p> : null}
    <section className={sharing.jobs} aria-label="完整包作业">
      <div className={sharing.sectionHeading}><h3><IconClockOutlineMedium size={17} />{mode === 'history' ? '完整包导入记录' : '传输与生成记录'}</h3><span>{shownJobs.length} 项 · 状态自动更新</span></div>
      <div className={sharing.jobList}>{shownJobs.map(job => <article className={sharing.job} key={job.id} data-stage={job.stage}>
        <span className={sharing.jobIcon} aria-hidden="true">{job.stage === 'complete' ? <IconCheckCircleOutlineMedium size={19} /> : job.stage === 'failed' ? <IconWarningOutlineMedium size={19} /> : <IconArchiveOutlineMedium size={19} />}</span>
        <div className={sharing.jobCopy}><strong>{job.kind === 'export' ? '导出' : '导入'} · {labels[job.stage]}</strong>
          <div className={sharing.jobMeta}><span>{job.files} 个条目 · {(job.bytes / 1024 / 1024).toFixed(1)} MB</span>{job.updatedAt ? <time dateTime={new Date(job.updatedAt).toISOString()}>{new Date(job.updatedAt).toLocaleString()}</time> : null}</div>
          {job.running ? <progress className={sharing.progress} aria-label={`${job.kind === 'export' ? '导出' : '导入'}：${labels[job.stage]}`} /> : null}
          {job.stage === 'complete' ? <small>{job.kind === 'import' ? '数据已恢复；环境待检查；任务等待你继续。' : '归档已就绪，可以下载。'}</small> : null}
          {job.error ? <p role="alert">{job.error}</p> : null}</div>
        <div className={sharing.jobActions}>{job.kind === 'export' && job.stage === 'complete' ? <button className={css.primaryButton} type="button" disabled={busy} onClick={() => { void run(() => client.download(job.id)) }}><IconDownloadOutlineMedium size={16} />下载完整包</button> : null}
          {job.running ? <button className={css.secondaryButton} type="button" disabled={busy} onClick={() => { void run(async () => { await client.request({ action: 'cancel', id: job.id }) }) }}>取消作业</button> : null}
          {job.recoverable ? <button className={css.secondaryButton} type="button" disabled={busy || disabled} onClick={() => { void run(async () => { await client.request({ action: 'resume', id: job.id }) }) }}><IconRefreshOutlineMedium size={16} />继续作业</button> : null}</div>
      </article>)}</div>
      {!shownJobs.length ? <div className={sharing.empty}><IconClockOutlineMedium size={24} /><p>{mode === 'history' ? '还没有完整包导入记录' : '生成或导入后，进度与结果会显示在这里'}</p></div> : null}
    </section>
  </section>
}

/** Mount in the DSH desktop shell, including while a browser owns the workbench. */
export function WorkbenchImportDirectoryRequests({ pickParentDirectory }: { pickParentDirectory: () => Promise<string | undefined> }) {
  const client = useMemo(() => createWorkbenchCompleteClient(), [])
  const [requests, setRequests] = useState<CompletePackageDirectoryRequest[]>([]), [error, setError] = useState<string>(), [busy, setBusy] = useState(false)
  useEffect(() => {
    const abort = new AbortController(); let pending = false
    const refresh = async () => { if (pending) return; pending = true
      try { const result = await client.request<CompletePackageDirectoryRequest[]>({ action: 'directory-pending' }, abort.signal); if (!abort.signal.aborted) setRequests(result) }
      catch { /* The directory service may still be starting; retry without interrupting the desktop. */ }
      finally { pending = false }
    }
    void refresh(); const timer = setInterval(() => { void refresh() }, 2500)
    return () => { abort.abort(); clearInterval(timer) }
  }, [client])
  if (!requests.length) return null
  const complete = async (request: CompletePackageDirectoryRequest, cancel = false) => {
    setBusy(true); setError(undefined)
    try {
      const parentPath = cancel ? undefined : await pickParentDirectory()
      await client.request({ action: 'directory-complete', id: request.id, ...(parentPath ? { parentPath } : { cancelled: true }) })
      setRequests(current => current.filter(row => row.id !== request.id))
    } catch (reason) { setError(errorText(reason)) } finally { setBusy(false) }
  }
  return <section className={css.notice} aria-label="浏览器导入目录请求"><strong>浏览器正在等待导入目录</strong>
    {requests.map(request => <div className={css.noticeActions} key={request.id}><span>{request.workbenchId ? '工作台 ' + request.workbenchId : '新工作台'}</span><button className={css.primaryButton} disabled={busy} onClick={() => { void complete(request) }}>选择目标目录</button><button className={css.secondaryButton} disabled={busy} onClick={() => { void complete(request, true) }}>取消请求</button></div>)}
    {error ? <p role="alert">{error}</p> : null}
  </section>
}
