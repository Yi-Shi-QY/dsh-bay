import { browserSafeUuid } from '../browser-safe-id.ts'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createWorkbenchCompleteClient } from '../client/workbench-complete.ts'
import type { CompletePackageDirectoryRequest, CompletePackageJobView, CompletePackagePreflight, CompletePackageUpload } from '../workbench-complete-contract.ts'
import { IconArchiveOutlineMedium, IconFolderOpenOutlineMedium, IconNewChatOutlineMedium, IconDatabaseOutlineMedium, IconBranchOutlineMedium, IconClockOutlineMedium, IconWarningOutlineMedium } from '@deepseek-ai/dsh-client-ui-primitives'
import { suggestedWorkbenchFolder } from '../workbench-folder-name.ts'
import type { WorkbenchEditorCatalogRow } from './catalog.ts'
import { WorkbenchImportFlow, type WorkbenchImportTransfer } from './WorkbenchImportFlow.tsx'
import { WorkbenchCompleteJob } from './WorkbenchCompleteJob.tsx'
import css from './WorkbenchSettings.module.css'
import sharing from './WorkbenchSharing.module.css'

const storageKey = (id: string) => 'bay.complete-transfer.v1.' + id
function savedTransfer(id: string): WorkbenchImportTransfer {
  try { return JSON.parse(sessionStorage.getItem(storageKey(id)) ?? 'null') as WorkbenchImportTransfer ?? { folderName: '' } }
  catch { return { folderName: '' } }
}
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error)
interface CompletePanelProps {
  workbenchId: string
  mode?: 'export' | 'import' | 'history'
  sourceControl?: ReactNode
  summary?: ReactNode
  browser?: boolean
  disabled?: boolean
  editors?: readonly WorkbenchEditorCatalogRow[]
  pickParentDirectory?: () => Promise<string | undefined>
  onOpenWorkbench?: ((id: string) => void | Promise<unknown>) | undefined
  onImport?: (() => void) | undefined
}
export function WorkbenchCompletePackagePanel(props: CompletePanelProps) {
  return <CompletePackagePanel key={props.browser ? props.workbenchId : 'desktop'} {...props} />
}
function CompletePackagePanel({ workbenchId, mode = 'import', sourceControl, summary, browser = false, disabled = false, editors, pickParentDirectory, onOpenWorkbench, onImport }: CompletePanelProps) {
  const scope = browser ? workbenchId : ''
  const client = useMemo(() => createWorkbenchCompleteClient(), [])
  const [transfer, setTransfer] = useState<WorkbenchImportTransfer>(() => savedTransfer(scope))
  const [jobs, setJobs] = useState<CompletePackageJobView[]>([])
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const pending = useRef(false)
  const uploadAbort = useRef<AbortController>()
  const exportRequestId = useRef('export-' + browserSafeUuid())
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; uploadAbort.current?.abort() } }, [])
  useEffect(() => { try { sessionStorage.setItem(storageKey(scope), JSON.stringify(transfer)) } catch { /* Host keeps committed operations. */ } }, [scope, transfer])
  useEffect(() => {
    const controller = new AbortController(); let loading = false
    const refresh = async () => {
      if (loading) return
      loading = true
      try {
        const values = await client.request<CompletePackageJobView[]>({ action: 'jobs', workbenchId: mode === 'export' ? workbenchId : scope, ...(!browser && mode !== 'export' ? { allImports: true } : {}) }, controller.signal)
        if (!controller.signal.aborted) setJobs(values.sort((a, b) => b.updatedAt - a.updatedAt))
      } catch (reason) { if (!controller.signal.aborted) setError(errorText(reason)) }
      finally { loading = false }
    }
    void refresh(); const timer = setInterval(() => { void refresh() }, 1500)
    return () => { controller.abort(); clearInterval(timer) }
  }, [client, workbenchId, scope, mode, browser])
  const selectionId = transfer.selection?.id
  useEffect(() => {
    if (!selectionId || transfer.selection?.state !== 'pending') return
    const controller = new AbortController(); let loading = false
    const refresh = async () => {
      if (loading) return
      loading = true
      try {
        const selection = await client.request<CompletePackageDirectoryRequest>({ action: 'directory-status', id: selectionId }, controller.signal)
        if (!controller.signal.aborted) setTransfer(current => ({ ...current, selection }))
      } catch (reason) { if (!controller.signal.aborted) setError(errorText(reason)) }
      finally { loading = false }
    }
    void refresh(); const timer = setInterval(() => { void refresh() }, 1500)
    return () => { controller.abort(); clearInterval(timer) }
  }, [client, selectionId, transfer.selection?.state])
  const run = async (operation: () => Promise<void>) => {
    if (pending.current) return
    pending.current = true; setBusy(true); setError(undefined)
    try { await operation() } catch (reason) { if (mounted.current) setError(errorText(reason)) }
    finally { pending.current = false; if (mounted.current) setBusy(false) }
  }
  const rememberJob = (job: CompletePackageJobView) => setJobs(current => [job, ...current.filter(row => row.id !== job.id)])
  const chooseFile = (file: File) => void run(async () => {
    const abort = new AbortController(); uploadAbort.current = abort
    const same = transfer.uploadRequest?.name === file.name && transfer.uploadRequest.size === file.size && transfer.uploadRequest.lastModified === file.lastModified && transfer.upload?.state !== 'cancelled'
    const requestId = same ? transfer.uploadRequest!.requestId : 'upload-' + browserSafeUuid()
    const uploadRequest = { name: file.name, size: file.size, lastModified: file.lastModified, requestId }
    setTransfer({ folderName: '', uploadRequest })
    const result = await client.upload(file, { workbenchId: scope, requestId }, upload => { if (mounted.current) setTransfer(current => ({ ...current, upload })) }, abort.signal)
    if (mounted.current) setTransfer({ ...result, uploadRequest, name: result.preflight.overview?.name ?? '', folderName: suggestedWorkbenchFolder(result.preflight.overview?.name ?? result.preflight.workbenchId) })
  })
  const selectParent = () => void run(async () => {
    const selection = await client.request<CompletePackageDirectoryRequest>({ action: 'directory-request', uploadId: transfer.upload!.id, requestId: 'directory-' + browserSafeUuid() })
    setTransfer(current => ({ ...current, selection }))
    if (!browser) {
      if (!pickParentDirectory) throw new Error('请在 DSH 客户端处理目录选择请求。')
      const parentPath = await pickParentDirectory()
      const result = await client.request<CompletePackageDirectoryRequest>({ action: 'directory-complete', id: selection.id, ...(parentPath ? { parentPath } : { cancelled: true }) })
      setTransfer(current => ({ ...current, selection: result }))
    }
  })
  const startImport = () => void run(async () => {
    // A lost start response must resolve the existing job before resubmitting edits.
    const selection = await client.request<CompletePackageDirectoryRequest>({ action: 'directory-status', id: transfer.selection!.id })
    const job = selection?.jobId
      ? await client.request<CompletePackageJobView>({ action: 'status', id: selection.jobId })
      : await client.request<CompletePackageJobView>({ action: 'start-import', workbenchId: scope, uploadId: transfer.upload!.id, directoryRequestId: transfer.selection!.id, folderName: transfer.folderName, ...(transfer.name?.trim() ? { name: transfer.name.trim() } : {}), requestId: 'import-' + transfer.selection!.id })
    rememberJob(job)
    setTransfer(current => ({ ...current, jobId: job.id, selection: { ...current.selection!, state: 'consumed', jobId: job.id } }))
  })
  const correctLocation = (job: CompletePackageJobView) => void run(async () => {
    const result = await client.request<{ selection: CompletePackageDirectoryRequest; upload: CompletePackageUpload; preflight?: CompletePackagePreflight }>({ action: 'reset-import-location', id: job.id })
    const preflight = result.preflight ?? await client.request<CompletePackagePreflight>({ action: 'upload-finish', id: result.upload.id })
    setTransfer({ selection: result.selection, upload: result.upload, preflight, name: job.name ?? preflight.overview?.name ?? '', folderName: suggestedWorkbenchFolder(job.name ?? preflight.overview?.name ?? preflight.workbenchId) })
    onImport?.()
  })
  const jobActions = {
    onOpen: !browser && onOpenWorkbench ? (id: string) => { void run(async () => { await onOpenWorkbench(id) }) } : undefined,
    onResume: (job: CompletePackageJobView) => { void run(async () => { rememberJob(await client.request<CompletePackageJobView>({ action: 'resume', id: job.id })) }) },
    onCancel: (job: CompletePackageJobView) => { void run(async () => { rememberJob(await client.request<CompletePackageJobView>({ action: 'cancel', id: job.id })) }) },
    onCorrectLocation: correctLocation,
    onDownload: (job: CompletePackageJobView) => { void run(() => client.download(job.id)) },
  }
  const activeJob = jobs.find(job => job.id === transfer.jobId || job.id === transfer.selection?.jobId || selectionId && job.requestId === 'import-' + selectionId)
  const shownJobs = mode === 'history' ? jobs.filter(job => job.kind === 'import') : jobs.filter(job => job.kind === 'export')
  return <section className={sharing.complete} aria-label="完整工作台包">
    {mode === 'export' ? <div className={summary ? sharing.workspace : undefined}><section className={sharing.formPanel}>
      <div className={sharing.formIntro}><h3>导出完整工作台</h3><p>把项目与工作进展一起打包，便于备份或在另一台机器继续。</p></div>
      <fieldset className={sharing.sourceControl} disabled={disabled || busy}>{sourceControl}</fieldset>
      <ul className={sharing.coverage} aria-label="完整包包含内容"><li><IconFolderOpenOutlineMedium size={16} />项目文件与目录</li><li><IconNewChatOutlineMedium size={16} />对话历史与附件</li><li><IconDatabaseOutlineMedium size={16} />工作背景与记忆</li><li><IconBranchOutlineMedium size={16} />任务关系与进度</li></ul>
      <div className={sharing.actionBar}><button type="button" className={css.primaryButton} disabled={disabled || busy || !workbenchId} onClick={() => { void run(async () => { const job = await client.request<CompletePackageJobView>({ action: 'start-export', workbenchId, requestId: exportRequestId.current }); exportRequestId.current = 'export-' + browserSafeUuid(); rememberJob(job) }) }}><IconArchiveOutlineMedium size={16} />生成完整包</button><span>完成后在下方下载</span></div>
    </section>{summary}</div> : null}
    {mode === 'import' ? <WorkbenchImportFlow transfer={transfer} job={activeJob} busy={busy} browser={browser} disabled={disabled || browser && !workbenchId} {...(editors ? { editors } : {})} onFile={chooseFile} onChange={patch => setTransfer(current => ({ ...current, ...patch }))} onSelectParent={selectParent} onStart={startImport} onPause={() => uploadAbort.current?.abort(new Error('已暂停，可重新选择同一文件继续。'))} onNew={() => { setTransfer({ folderName: '' }); setError(undefined) }} jobActions={jobActions} /> : null}
    {error ? <p className={sharing.error} role="alert"><IconWarningOutlineMedium size={16} />{error}</p> : null}
    {mode !== 'import' ? <section className={sharing.jobs} aria-label="完整包作业"><div className={sharing.sectionHeading}><h3><IconClockOutlineMedium size={17} />{mode === 'history' ? '完整包导入记录' : '导出记录'}</h3><span>{shownJobs.length} 项 · 状态自动更新</span></div><div className={sharing.jobList}>{shownJobs.map(job => <WorkbenchCompleteJob key={job.id} job={job} busy={busy} disabled={disabled} {...jobActions} />)}</div>{!shownJobs.length ? <div className={sharing.empty}><IconClockOutlineMedium size={24} /><p>{mode === 'history' ? '还没有完整包导入记录' : '生成完整包后，在这里查看进度与下载'}</p></div> : null}</section> : null}
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
