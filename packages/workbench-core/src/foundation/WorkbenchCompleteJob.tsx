import { useWorkbenchLocale, workbenchIntlLocale } from './workbench-locale.ts'
import { IconArchiveOutlineMedium, IconCheckCircleOutlineMedium, IconWarningOutlineMedium, IconRefreshOutlineMedium, IconFolderOpenOutlineMedium, IconDownloadOutlineMedium } from '@deepseek-ai/dsh-client-ui-primitives'
import type { CompletePackageJobView } from '../workbench-complete-contract.ts'
import css from './WorkbenchSettings.module.css'
import sharing from './WorkbenchSharing.module.css'
import { useState } from 'react'


export function WorkbenchCompleteJob({ job, busy, disabled, showReport, onOpen, onResume, onCancel, onCorrectLocation, onDownload, onConfirmExtensions, onMapExtensions, onRestart, browser }: {
  job: CompletePackageJobView; busy: boolean; disabled: boolean; showReport?: boolean
  onOpen?: ((id: string) => void) | undefined
  onResume(job: CompletePackageJobView): void
  onCancel(job: CompletePackageJobView): void
  onCorrectLocation(job: CompletePackageJobView): void
  onDownload?: ((job: CompletePackageJobView) => void) | undefined
  onConfirmExtensions?: ((job: CompletePackageJobView) => void) | undefined
  onMapExtensions?: ((job: CompletePackageJobView) => void) | undefined
  onRestart?: ((job: CompletePackageJobView) => void) | undefined
  browser?: boolean | undefined
}) {
  const { t, language } = useWorkbenchLocale()
  const [approvedDigest, setApprovedDigest] = useState<string>()
  const report = job.report
  const reportBody = report ? <div className={sharing.report}>
    <dl><div><dt>{t('share.dataRecovery')}</dt><dd>{report.data === 'complete' ? t('share.restored') : report.data === 'blocked' ? t('settings.needsAttention') : t('share.inProgress')}</dd></div><div><dt>{t('share.runtimeEnvironment')}</dt><dd>{report.environment === 'ready' ? t('settings.ready') : report.environment === 'needs-setup' ? t('share.needsSetup') : t('share.notChecked')}</dd></div><div><dt>{t('share.taskStatus')}</dt><dd>{report.tasks === 'waiting-for-user' ? t('share.waitingForYouToResume') : t('share.originalStatusPreserved')}</dd></div></dl>
    {report.blockers.length ? <div><strong>{t('settings.needsAttention')}</strong><ul>{report.blockers.map((text, i) => <li key={i}>{text}</li>)}</ul></div> : null}
    {report.exclusions.length ? <div><strong>{t('share.excludedContent')}</strong><ul>{report.exclusions.map((text, i) => <li key={i}>{text}</li>)}</ul></div> : null}
    {report.environmentSteps.length ? <div><strong>{t('share.setupBeforeRunning')}</strong><ul>{report.environmentSteps.map((text, i) => <li key={i}>{text}</li>)}</ul></div> : null}
  </div> : null
  return <article className={sharing.jobDetail} data-stage={job.stage}>
    <div className={sharing.job}>
      <span className={sharing.jobIcon}>{job.stage === 'complete' ? <IconCheckCircleOutlineMedium size={20} /> : job.stage === 'failed' ? <IconWarningOutlineMedium size={20} /> : <IconArchiveOutlineMedium size={20} />}</span>
      <div className={sharing.jobCopy}><strong>{job.name || (job.kind === 'import' ? t('settings.importWorkbench') : t('home.exportWorkbench'))} · {job.kind === 'export' && job.stage === 'snapshot' ? t('share.createSnapshot') : t(`transfer.stage.${job.stage}`)}</strong><div className={sharing.jobMeta}><span>{job.files} {t('share.entries')} {(job.bytes / 1024 / 1024).toFixed(1)} MB</span>{job.updatedAt ? <time dateTime={new Date(job.updatedAt).toISOString()}>{new Date(job.updatedAt).toLocaleString(workbenchIntlLocale(language))}</time> : null}</div>
        {job.targetDisplayPath ? <small>{job.targetDisplayPath}</small> : null}
        {job.running ? <progress className={sharing.progress} aria-label={t(`transfer.stage.${job.stage}`)} /> : null}
        {job.error ? <p role="alert">{job.error}</p> : null}
      </div>
    </div>
    {job.kind === 'import' && job.stage !== 'complete' && job.extensions?.length ? <section className={sharing.report} aria-label={t('share.requiredExtensionsAndPermissions')}>
      <strong>{t('settings.requiredExtensions')}</strong>
      {job.extensions.map(({ extension, state, message }) => <div key={extension.packageName}>
        <strong>{extension.packageName} · {extension.version}</strong>
        <p>{message ?? (state === 'ready' ? t('share.matchingVersionIsActiveAndCanMigrate') : t('share.awaitingValidation'))} · {extension.artifactPath ? t('share.embeddedOfflineArtifact') : t('share.installedByTheRecipient')}</p>
        <p>{t('share.permissions')}{extension.permissions.join('、') || t('share.noAdditionalPermissions')}</p>
        <details><summary>{t('share.artifactAndMigrationDeclarations')}</summary><code>{extension.artifactSha256}</code><p>{extension.migrations.events.length} {t('share.conversationEventTypes')} {extension.migrations.workbenchData.length} {t('share.workbenchDataTypes')}</p></details>
      </div>)}
      {job.stage === 'awaiting-extensions' && !browser ? <label><input type="checkbox" checked={!!job.extensionPlanDigest && approvedDigest === job.extensionPlanDigest} onChange={event => setApprovedDigest(event.target.checked ? job.extensionPlanDigest : undefined)} />{t('share.iVerifiedTheVersionsSourcesAndPermissions')}</label> : null}
    </section> : null}
    {job.stage === 'awaiting-restart' ? <p className={sharing.hint} role="status">{t('share.filesAndLayoutAreReadyTheWorkbench')}{browser ? t('share.confirmTheRestartInTheDshClient') : t('share.saveOtherWorkRestartDshAndResume')}{t('share.theJobIdAndConversationMappingsAre')}</p> : null}
    {browser && job.stage === 'awaiting-extensions' ? <p className={sharing.hint}>{t('share.confirmExtensionsAndPermissionsInTheDsh')}</p> : null}
    <div className={sharing.jobActions}>
      {!browser && job.packageVersion === 5 && job.stage === 'awaiting-extensions' && !job.extensions && onMapExtensions ? <button className={css.primaryButton} disabled={busy || disabled} onClick={() => onMapExtensions(job)}>{t('share.checkAndMapLocalExtensions')}</button> : null}
      {!browser && job.stage === 'awaiting-extensions' && job.extensions?.length && onConfirmExtensions ? <button className={css.primaryButton} disabled={busy || disabled || approvedDigest !== job.extensionPlanDigest} onClick={() => onConfirmExtensions(job)}>{t('share.confirmExtensionsAndContinue')}</button> : null}
      {!browser && job.stage === 'awaiting-restart' && onRestart && job.restartTransactionId ? <button className={css.primaryButton} disabled={busy || disabled} onClick={() => onRestart(job)}>{t('share.restartAndResumeImport')}</button> : null}
      {job.kind === 'import' && job.stage === 'complete' && onOpen ? <button className={css.primaryButton} type="button" disabled={busy} onClick={() => onOpen(job.workbenchId)}><IconFolderOpenOutlineMedium size={16} />{t('home.openWorkbench')}</button> : null}
      {job.kind === 'export' && job.stage === 'complete' && onDownload ? <button className={css.primaryButton} type="button" disabled={busy} onClick={() => onDownload(job)}><IconDownloadOutlineMedium size={16} />{t('share.downloadFullPackage')}</button> : null}
      {job.running || ['awaiting-extensions', 'awaiting-restart', 'blocked'].includes(job.stage) ? <button className={css.secondaryButton} type="button" disabled={busy || disabled} onClick={() => onCancel(job)}>{t('share.cancelJob')}</button> : null}
      {job.canChangeDestination ? <button className={css.primaryButton} type="button" disabled={busy || disabled} onClick={() => onCorrectLocation(job)}><IconFolderOpenOutlineMedium size={16} />{t('share.changeImportLocation')}</button> : job.recoverable ? <button className={css.secondaryButton} type="button" disabled={busy || disabled} onClick={() => onResume(job)}><IconRefreshOutlineMedium size={16} />{job.stage === 'awaiting-page-state' ? t('share.restorePageSettingsAndContinue') : job.stage === 'awaiting-restart' ? t('share.checkRestartAndContinue') : t('share.resumeJob')}</button> : null}
    </div>
    {reportBody ? showReport ? reportBody : <details className={sharing.reportDetails}><summary>{t('share.viewRecoveryReport')}</summary>{reportBody}</details> : null}
  </article>
}
