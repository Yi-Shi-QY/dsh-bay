import { browserSafeUuid } from '../browser-safe-id.ts'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createWorkbenchCompleteClient } from '../client/workbench-complete.ts'
import type { CompletePackageDirectoryRequest, CompletePackageJobView, CompletePackagePreflight, CompletePackageUpload } from '../workbench-complete-contract.ts'
import css from './WorkbenchSettings.module.css'

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
  browser?: boolean
  disabled?: boolean
  pickParentDirectory?: () => Promise<string | undefined>
}
export function WorkbenchCompletePackagePanel(props: CompletePanelProps) {
  return <CompletePackagePanel key={props.workbenchId} {...props} />
}
function CompletePackagePanel({ workbenchId, browser = false, disabled = false, pickParentDirectory }: CompletePanelProps) {
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
  return <section className={css.controlCard} aria-label="完整工作台包">
    <h4>完整工作台包</h4>
    <p>包含项目文件、对话、附件、记忆和任务关系。导入后保持待继续，由你决定何时恢复工作。</p>
    <div className={css.noticeActions}><button type="button" className={css.primaryButton} disabled={disabled || busy || !workbenchId} onClick={() => { void run(async () => {
      const job = await client.request<CompletePackageJobView>({ action: 'start-export', workbenchId, requestId: exportRequestId.current })
      exportRequestId.current = 'export-' + browserSafeUuid()
      setJobs(current => [job, ...current.filter(row => row.id !== job.id)])
    }) }}>生成完整包</button></div>
    <label className={css.form}>接收完整包<input type="file" accept=".gz,.tgz,.tar.gz" disabled={disabled || busy || browser && !workbenchId} onChange={event => { const file = event.target.files?.[0]; if (file) void chooseFile(file); event.target.value = '' }} /></label>
    {transfer.upload ? <p role="status">{transfer.upload.name} · 已上传 {Math.round(transfer.upload.received / Math.max(1, transfer.upload.size) * 100)}%{transfer.preflight ? ` · 内容检查通过，含 ${transfer.preflight.sessionCount} 个会话` : '，中断后重新选择同一文件可以继续'}</p> : null}
    {busy && uploadAbort.current && !transfer.preflight ? <button type="button" className={css.secondaryButton} onClick={() => uploadAbort.current?.abort(new Error('已暂停上传，可重新选择同一文件继续。'))}>暂停上传</button> : null}
    {transfer.preflight ? <>
      <label className={css.form}>新工作台文件夹名称<input value={transfer.folderName} disabled={busy || disabled || transfer.selection?.state === 'consumed'} onChange={event => setTransfer(current => ({ ...current, folderName: event.target.value }))} /></label>
      <div className={css.noticeActions}><button type="button" className={css.secondaryButton} disabled={busy || disabled || transfer.selection?.state === 'pending' || transfer.selection?.state === 'consumed'} onClick={() => { void selectParent() }}>{browser ? '请 DSH 客户端选择目标目录' : '选择目标父目录'}</button>
        <button type="button" className={css.primaryButton} disabled={busy || disabled || transfer.selection?.state !== 'selected' || !transfer.folderName.trim()} onClick={() => { void startImport() }}>导入并保持暂停</button></div>
      {transfer.selection?.state === 'pending' ? <p role="status">正在等待 DSH 客户端确认目标目录。此页面可以保持打开，确认后继续导入。</p> : null}
      {transfer.selection?.state === 'selected' ? <p role="status">DSH 客户端已确认目标目录。</p> : null}
      {transfer.selection?.state === 'cancelled' ? <p role="status">目录选择已取消，可以重新选择。</p> : null}
    </> : null}
    {error ? <p role="alert">{error}</p> : null}
    <div className={css.list} aria-label="完整包作业">{jobs.map(job => <article className={css.row} key={job.id}>
      <div><strong>{job.kind === 'export' ? '导出' : '导入'} · {labels[job.stage]}</strong><p>{job.files} 个条目 · {(job.bytes / 1024 / 1024).toFixed(1)} MB</p>
        {job.stage === 'complete' ? <small>{job.kind === 'import' ? '数据已恢复；环境待检查；任务等待你继续。' : '归档已就绪，可以下载。'}</small> : null}
        {job.error ? <p>{job.error}</p> : null}</div>
      <div className={css.noticeActions}>{job.kind === 'export' && job.stage === 'complete' ? <button className={css.primaryButton} type="button" disabled={busy} onClick={() => { void run(() => client.download(job.id)) }}>下载完整包</button> : null}
        {job.running ? <button className={css.secondaryButton} type="button" disabled={busy} onClick={() => { void run(async () => { await client.request({ action: 'cancel', id: job.id }) }) }}>取消作业</button> : null}
        {job.recoverable ? <button className={css.secondaryButton} type="button" disabled={busy || disabled} onClick={() => { void run(async () => { await client.request({ action: 'resume', id: job.id }) }) }}>继续作业</button> : null}</div>
    </article>)}</div>
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
