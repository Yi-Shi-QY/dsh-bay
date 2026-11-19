import { useWorkbenchLocale, workbenchErrorNotice, workbenchNoticeText, WorkbenchMessageError, type WorkbenchNotice } from './workbench-locale.ts'
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
import type { CompletePlatform } from '../workbench-complete-contract.ts'
import { createWorkbenchManagerRestartBridge } from '../client/workbench-manager-restart.ts'
import { migrateCompletePageStates } from './complete-page-state.ts'
import type { ModuleInstanceDocument } from './document-v3.ts'

const storageKey = (id: string) => 'bay.complete-transfer.v1.' + id
function savedTransfer(id: string): WorkbenchImportTransfer {
  try { return JSON.parse(sessionStorage.getItem(storageKey(id)) ?? 'null') as WorkbenchImportTransfer ?? { folderName: '' } }
  catch { return { folderName: '' } }
}
const errorNotice = (error: unknown) => workbenchErrorNotice(error, 'transfer.operationFailed')
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
  importSelection?: { id: number; file: File } | undefined
  unifiedPicker?: boolean
  onImportBusyChange?: ((busy: boolean) => void) | undefined
}
export function WorkbenchCompletePackagePanel(props: CompletePanelProps) {
  return <CompletePackagePanel key={props.browser ? props.workbenchId : 'desktop'} {...props} />
}
function CompletePackagePanel({ workbenchId, mode = 'import', sourceControl, summary, browser = false, disabled = false, editors, pickParentDirectory, onOpenWorkbench, onImport, importSelection, unifiedPicker, onImportBusyChange }: CompletePanelProps) {
  const { t } = useWorkbenchLocale()
  const scope = browser ? workbenchId : ''
  const client = useMemo(() => createWorkbenchCompleteClient(), [])
  const [transfer, setTransfer] = useState<WorkbenchImportTransfer>(() => savedTransfer(scope))
  const [jobs, setJobs] = useState<CompletePackageJobView[]>([])
  const [error, setError] = useState<WorkbenchNotice>()
  const [busy, setBusy] = useState(false)
  const [targetPlatform, setTargetPlatform] = useState<CompletePlatform>('win32')
  const pending = useRef(false)
  const handledSelection = useRef<number>()
  useEffect(() => { onImportBusyChange?.(busy) }, [busy, onImportBusyChange])
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
      } catch (reason) { if (!controller.signal.aborted) setError(errorNotice(reason)) }
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
      } catch (reason) { if (!controller.signal.aborted) setError(errorNotice(reason)) }
      finally { loading = false }
    }
    void refresh(); const timer = setInterval(() => { void refresh() }, 1500)
    return () => { controller.abort(); clearInterval(timer) }
  }, [client, selectionId, transfer.selection?.state])
  const run = async (operation: () => Promise<void>) => {
    if (pending.current) return
    pending.current = true; setBusy(true); setError(undefined)
    try { await operation() } catch (reason) { if (mounted.current) setError(errorNotice(reason)) }
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
  useEffect(() => {
    if (!importSelection || handledSelection.current === importSelection.id) return
    handledSelection.current = importSelection.id
    chooseFile(importSelection.file)
  }, [importSelection])
  const selectParent = () => void run(async () => {
    const selection = await client.request<CompletePackageDirectoryRequest>({ action: 'directory-request', uploadId: transfer.upload!.id, requestId: 'directory-' + browserSafeUuid() })
    setTransfer(current => ({ ...current, selection }))
    if (!browser) {
      if (!pickParentDirectory) throw new WorkbenchMessageError('transfer.selectInClient')
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
    browser,
    onMapExtensions: (job: CompletePackageJobView) => { void run(async () => { rememberJob(await client.request<CompletePackageJobView>({ action: 'map-v5-extensions', id: job.id })) }) },
    onConfirmExtensions: (job: CompletePackageJobView) => { void run(async () => { rememberJob(await client.request<CompletePackageJobView>({ action: 'confirm-extensions', id: job.id, digest: job.extensionPlanDigest, confirmed: true })) }) },
    onRestart: (job: CompletePackageJobView) => { void run(async () => {
      const bridge = createWorkbenchManagerRestartBridge()
      if (!bridge || !job.restartTransactionId) throw new WorkbenchMessageError('transfer.manualRestartRequired')
      const operation = await bridge.requestRestart(job.restartTransactionId)
      await bridge.waitForRestart({ ...operation, transactionId: job.restartTransactionId })
      rememberJob(await client.request<CompletePackageJobView>({ action: 'resume', id: job.id }))
    }) },
    onOpen: !browser && onOpenWorkbench ? (id: string) => { void run(async () => { await onOpenWorkbench(id) }) } : undefined,
    onResume: (job: CompletePackageJobView) => { void run(async () => {
      if (job.stage === 'awaiting-page-state') {
        const input = await client.request<{ pages: ModuleInstanceDocument[]; digest: string }>({ action: 'page-restore-input', id: job.id })
        const pageStates = migrateCompletePageStates(input.pages, editors ?? [], 'import')
        rememberJob(await client.request<CompletePackageJobView>({ action: 'restore-pages', id: job.id, digest: input.digest, pageStates }))
      } else rememberJob(await client.request<CompletePackageJobView>({ action: 'resume', id: job.id }))
    }) },
    onCancel: (job: CompletePackageJobView) => { void run(async () => { rememberJob(await client.request<CompletePackageJobView>({ action: 'cancel', id: job.id })) }) },
    onCorrectLocation: correctLocation,
    onDownload: (job: CompletePackageJobView) => { void run(() => client.download(job.id)) },
  }
  const activeJob = jobs.find(job => job.id === transfer.jobId || job.id === transfer.selection?.jobId || selectionId && job.requestId === 'import-' + selectionId)
  const shownJobs = mode === 'history' ? jobs.filter(job => job.kind === 'import') : jobs.filter(job => job.kind === 'export')
  return <section className={sharing.complete} aria-label={t('transfer.fullWorkbenchPackage')}>
    {mode === 'export' ? <div className={summary ? sharing.workspace : undefined}><section className={sharing.formPanel}>
      <div className={sharing.formIntro}><h3>{t('transfer.exportFullWorkbench')}</h3><p>{t('transfer.includeProjectsAndProgressToBackUp')}</p></div>
      <fieldset className={sharing.sourceControl} disabled={disabled || busy}>{sourceControl}</fieldset>
      <label className={sharing.field}>{t('transfer.targetSystem')}<select value={targetPlatform} disabled={disabled || busy} onChange={event => { setTargetPlatform(event.target.value as CompletePlatform); exportRequestId.current = 'export-' + browserSafeUuid() }}><option value="win32">Windows</option><option value="darwin">macOS</option><option value="linux">Linux</option></select></label>
      <p className={sharing.hint}>{t('transfer.checkNamesLinksAndExtensionsForThe')}</p>
      <ul className={sharing.coverage} aria-label={t('transfer.whatTheFullPackageIncludes')}><li><IconFolderOpenOutlineMedium size={16} />{t('transfer.projectFilesAndFolders')}</li><li><IconNewChatOutlineMedium size={16} />{t('transfer.conversationHistoryAndAttachments')}</li><li><IconDatabaseOutlineMedium size={16} />{t('transfer.workContextAndMemory')}</li><li><IconBranchOutlineMedium size={16} />{t('transfer.taskRelationshipsAndProgress')}</li></ul>
      <div className={sharing.actionBar}><button type="button" className={css.primaryButton} disabled={disabled || busy || !workbenchId} onClick={() => { void run(async () => {
        const input = await client.request<{ revision: number; pages: ModuleInstanceDocument[] }>({ action: 'export-page-input', workbenchId })
        const pageStates = migrateCompletePageStates(input.pages ?? [], editors ?? [], 'export')
        const job = await client.request<CompletePackageJobView>({ action: 'start-export', workbenchId, targetPlatform, definitionRevision: input.revision, pageStates, requestId: exportRequestId.current })
        exportRequestId.current = 'export-' + browserSafeUuid(); rememberJob(job)
      }) }}><IconArchiveOutlineMedium size={16} />{t('transfer.generateFullPackage')}</button><span>{t('transfer.downloadBelowWhenReady')}</span></div>
    </section>{summary}</div> : null}
    {mode === 'import' ? <WorkbenchImportFlow transfer={transfer} job={activeJob} busy={busy} browser={browser} disabled={disabled || browser && !workbenchId} unifiedPicker={unifiedPicker === true} {...(editors ? { editors } : {})} onFile={chooseFile} onChange={patch => setTransfer(current => ({ ...current, ...patch }))} onSelectParent={selectParent} onStart={startImport} onPause={() => uploadAbort.current?.abort(new WorkbenchMessageError('transfer.uploadPaused'))} onNew={() => { setTransfer({ folderName: '' }); setError(undefined) }} jobActions={jobActions} /> : null}
    {error ? <p className={sharing.error} role="alert"><IconWarningOutlineMedium size={16} />{workbenchNoticeText(t, error)}</p> : null}
    {mode !== 'import' ? <section className={sharing.jobs} aria-label={t('transfer.fullPackageJobs')}><div className={sharing.sectionHeading}><h3><IconClockOutlineMedium size={17} />{mode === 'history' ? t('transfer.importHistory') : t('transfer.exportHistory')}</h3><span>{shownJobs.length} {t('transfer.jobsStatusUpdatesAutomatically')}</span></div><div className={sharing.jobList}>{shownJobs.map(job => <WorkbenchCompleteJob key={job.id} job={job} busy={busy} disabled={disabled} {...jobActions} />)}</div>{!shownJobs.length ? <div className={sharing.empty}><IconClockOutlineMedium size={24} /><p>{mode === 'history' ? t('transfer.emptyImportHistory') : t('transfer.emptyExportHistory')}</p></div> : null}</section> : null}
  </section>
}
/** Mount in the DSH desktop shell, including while a browser owns the workbench. */
export function WorkbenchImportDirectoryRequests({ pickParentDirectory }: { pickParentDirectory: () => Promise<string | undefined> }) {
  const { t } = useWorkbenchLocale()
  const client = useMemo(() => createWorkbenchCompleteClient(), [])
  const [requests, setRequests] = useState<CompletePackageDirectoryRequest[]>([]), [error, setError] = useState<WorkbenchNotice>(), [busy, setBusy] = useState(false)
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
    } catch (reason) { setError(errorNotice(reason)) } finally { setBusy(false) }
  }
  return <section className={css.notice} aria-label={t('transfer.browserImportFolderRequests')}><strong>{t('transfer.theBrowserIsWaitingForAnImport')}</strong>
    {requests.map(request => <div className={css.noticeActions} key={request.id}><span>{request.workbenchId ? t('transfer.workbenchRequest', { id: request.workbenchId }) : t('transfer.newWorkbench')}</span><button className={css.primaryButton} disabled={busy} onClick={() => { void complete(request) }}>{t('transfer.chooseDestinationFolder')}</button><button className={css.secondaryButton} disabled={busy} onClick={() => { void complete(request, true) }}>{t('transfer.cancelRequest')}</button></div>)}
    {error ? <p role="alert">{workbenchNoticeText(t, error)}</p> : null}
  </section>
}
