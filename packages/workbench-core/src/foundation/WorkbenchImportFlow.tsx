import { useWorkbenchLocale } from './workbench-locale.ts'
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
  const { t } = useWorkbenchLocale()
  const { preflight, selection, upload } = transfer
  const overview = preflight?.overview ?? job?.overview
  const percent = upload ? Math.min(100, Math.round(upload.received / Math.max(1, upload.size) * 100)) : 0
  const step = job?.stage === 'complete' ? 3 : job || transfer.jobId || selection?.state === 'consumed' ? 2 : preflight ? 1 : 0
  const folderError = workbenchFolderNameError(transfer.folderName, t)
  const target = workbenchTargetPath(selection?.displayPath ?? '', transfer.folderName)
  return <div className={sharing.importFlow}>
    <ol className={sharing.stepper} aria-label={t('transfer.importSteps')}>{[t('transfer.stepFile'), t('transfer.stepDestination'), t('transfer.stepRestore'), t('transfer.stepVerify')].map((label, index) => <li key={index} data-state={index === step ? 'current' : index < step ? 'done' : 'next'} aria-current={index === step ? 'step' : undefined}><span>{index < step ? <IconCheckCircleOutlineMedium size={16} /> : index + 1}</span><strong>{label}</strong></li>)}</ol>
    <div className={sharing.workspace}>
      <section className={sharing.formPanel}>
        <div className={sharing.formIntro}><h3>{[t('transfer.receiveWorkbench'), t('transfer.reviewDestination'), t('transfer.restoreWorkspace'), t('transfer.workbenchReady')][step]}</h3><p>{[t('transfer.receiveWorkbenchHint'), t('transfer.reviewDestinationHint'), t('transfer.restoreWorkspaceHint'), t('transfer.workbenchReadyHint')][step]}</p></div>
        {step < 2 ? <>
          {!unifiedPicker ? <label className={`${sharing.upload} ${preflight ? sharing.uploadCompact : ''}`} data-disabled={disabled || busy}>
            <IconArchiveOutlineMedium size={30} /><strong>{upload?.name || t('transfer.selectFullPackage')}</strong><span>{preflight ? t('transfer.reselectFile') : t('transfer.chooseFile')}</span><small>{t('transfer.fullPackageV5V6TarGzTgz')}</small>
            <input aria-label={t('transfer.receiveFullPackage')} type="file" accept=".gz,.tgz,.tar.gz" disabled={disabled || busy} onChange={event => { const file = event.target.files?.[0]; if (file) onFile(file); event.target.value = '' }} />
          </label> : null}
          {upload ? <div className={sharing.transferState} role="status"><span>{preflight ? t('transfer.inspectionPassed', { count: preflight.sessionCount }) : percent === 100 && busy ? t('transfer.checkingUpload') : busy ? t('transfer.uploadedProgress', { percent }) : t('transfer.uploadCanResume', { percent })}</span>{!preflight ? <progress className={sharing.progress} aria-label={percent === 100 && busy ? t('transfer.checkingProgress') : t('transfer.uploadProgress')} max={100} {...(percent === 100 && busy ? {} : { value: percent })} /> : null}</div> : null}
          {busy && upload && !preflight ? <button type="button" className={css.secondaryButton} onClick={onPause}><IconPauseOutlineMedium size={16} />{t('transfer.pauseTransferAndValidation')}</button> : null}
          {preflight ? <>
            {preflight.warnings?.map(text => <p className={sharing.hint} key={text}>{text}</p>)}
            <p className={sharing.hint}>{t('transfer.prepareFilesAndLayoutThenConfirmThe')}</p>
            <label className={sharing.field}>{t('shell.workbenchName')}<input maxLength={160} value={transfer.name ?? overview?.name ?? ''} disabled={busy || disabled} placeholder={t('transfer.nameTheImportedWorkbench')} onChange={event => onChange({ name: event.target.value })} /></label>
            <label className={sharing.field}>{t('transfer.newWorkbenchFolderName')}<input maxLength={160} value={transfer.folderName} disabled={busy || disabled} placeholder={suggestedWorkbenchFolder(overview?.name ?? '')} onChange={event => onChange({ folderName: event.target.value })} /></label>
            {transfer.folderName && folderError ? <p className={sharing.error} role="alert">{folderError}</p> : null}
            <div className={sharing.destination}><IconFolderOpenOutlineMedium size={20} /><div><strong>{t('transfer.destination')}</strong><p>{target || (selection?.state === 'selected' ? t('transfer.parentSelected') : browser ? t('transfer.clientChoosesParent') : t('transfer.destinationHint'))}</p></div></div>
            <div className={sharing.actionBar}><button type="button" className={css.secondaryButton} disabled={busy || disabled || selection?.state === 'pending'} onClick={onSelectParent}><IconFolderOpenOutlineMedium size={16} />{browser ? t('transfer.requestDestination') : t('transfer.chooseDestinationParentFolder')}</button><button type="button" className={css.primaryButton} disabled={busy || disabled || selection?.state !== 'selected' || !!folderError} onClick={onStart}><IconPlusOutlineMedium size={16} />{busy ? t('transfer.preparingImport') : t('transfer.importPaused')}</button></div>
            {selection?.state === 'pending' ? <p className={sharing.hint} role="status">{t('transfer.waitingForTheDshClientToConfirm')}</p> : null}
            {selection?.state === 'selected' ? <p className={sharing.hint} role="status">{t('transfer.theDshClientConfirmedTheDestination')}</p> : null}
            {selection?.state === 'cancelled' ? <p className={sharing.hint} role="status">{t('transfer.folderSelectionWasCanceledChooseOneTo')}</p> : null}
          </> : <p className={sharing.hint}>{unifiedPicker ? t('transfer.unifiedPickerHint') : t('transfer.fullPickerHint')}</p>}
        </> : job ? <>
          <WorkbenchCompleteJob job={job} busy={busy} disabled={disabled} {...jobActions} showReport />
          {job.stage === 'complete' && browser ? <p className={sharing.hint}>{t('transfer.openTheNewWorkbenchInTheDsh')}</p> : null}
          {job.stage === 'complete' ? <button type="button" className={css.secondaryButton} onClick={onNew}>{t('transfer.importAnotherWorkbench')}</button> : null}
        </> : <p className={sharing.hint} role="status">{t('transfer.loadingRecoveryJob')}</p>}
      </section>
      <aside className={sharing.summary} aria-label={t('transfer.importContents')}>
        <div className={sharing.summaryTitle}><IconArchiveOutlineMedium size={18} /><h3>{overview?.name ?? t('transfer.preservedProgress')}</h3></div>
        {overview ? <>
          <div className={sharing.summaryCanvas}><WorkbenchHomePreview node={overview.layout} editors={editors} /></div>
          {overview.description ? <p className={sharing.hint}>{overview.description}</p> : null}
          <div className={sharing.summaryCounts}><span>{overview.areaCount} {t('transfer.areas')}</span><span>{overview.pageCount} {t('transfer.pages')}</span><span>{t('transfer.fileContentSize', { size: (overview.bytes / 1024 / 1024).toFixed(1) })}</span></div>
          <dl className={sharing.importCounts}><div><dt><IconFolderOpenOutlineMedium size={16} />{t('transfer.projectsAndFiles')}</dt><dd>{overview.projectCount} {t('transfer.projects')} {overview.fileCount} {t('transfer.files')}</dd></div><div><dt><IconNewChatOutlineMedium size={16} />{t('transfer.conversationHistory')}</dt><dd>{preflight?.sessionCount ?? 0} {t('transfer.conversations')}</dd></div><div><dt><IconDatabaseOutlineMedium size={16} />{t('transfer.workbenchMemory')}</dt><dd>{t('transfer.memoryCount', { count: overview.memoryCount })}</dd></div><div><dt><IconBranchOutlineMedium size={16} />{t('transfer.tasks')}</dt><dd>{t('transfer.taskCount', { count: overview.taskCount })}</dd></div></dl>
        </> : <ul className={sharing.importIncludes}><li><IconFolderOpenOutlineMedium size={18} /><div><strong>{t('transfer.projectsAndFolders')}</strong><p>{t('transfer.restoreProjectFilesAndRelationshipsTogether')}</p></div></li><li><IconNewChatOutlineMedium size={18} /><div><strong>{t('transfer.conversationsAndMemory')}</strong><p>{t('transfer.keepConversationHistoryAttachmentsAndKnowledge')}</p></div></li><li><IconBranchOutlineMedium size={18} /><div><strong>{t('transfer.tasksAndProgress')}</strong><p>{t('transfer.chooseWhenToResumeAfterRestoring')}</p></div></li></ul>}
        <div className={sharing.summaryCaption}><strong>{t('transfer.continueInANewLocation')}</strong><p>{t('transfer.previewTheLayoutAndContentsAfterValidation')}</p></div>
      </aside>
    </div>
  </div>
}
