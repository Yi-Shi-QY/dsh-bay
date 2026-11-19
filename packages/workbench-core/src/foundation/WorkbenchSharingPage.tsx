import type { WorkbenchMessageKey } from './workbench-messages.ts'
import { useWorkbenchLocale, type WorkbenchTranslate } from './workbench-locale.ts'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { IconAgentPresetOutlineMedium, IconArchiveOutlineMedium, IconCheckOutlineMedium, IconDownloadOutlineMedium, IconFolderOpenOutlineMedium, IconRefreshOutlineMedium, IconShareOutlineMedium, IconWarningOutlineMedium } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SettingsPageProps } from './WorkbenchSettingsPages.tsx'
import { DESKTOP_SETTINGS_CONTEXT, settingsTargetWritable } from './settings-context.ts'
import { createWorkbenchBundleClient } from '../client/workbench-bundle.ts'
import type { WorkbenchBundleExportedV1, WorkbenchBundleExportStage, WorkbenchBundleExtensionProblemV1, WorkbenchBundleImportResultV1, WorkbenchBundleImportStage, WorkbenchBundleInspectionV1, WorkbenchBundleJobV1, WorkbenchBundleProgressV1 } from '../workbench-bundle-contract.ts'
import { DEFAULT_WORKBENCH_SYNC_CONFIG, type WorkbenchSyncConfigV1, type WorkbenchSyncStateV1 } from '../workbench-sync-contract.ts'
import css from './WorkbenchSharing.module.css'

type BundleKind = 'template' | 'complete'
type ShareMode = 'export' | 'import' | 'sync'
type JobProgress = WorkbenchBundleProgressV1

const EXPORT_STAGES = [
  { stage: 'collect', label: 'share.exportStage.collect' },
  { stage: 'extensions', label: 'share.exportStage.extensions' },
  { stage: 'sessions', label: 'share.exportStage.sessions' },
  { stage: 'files', label: 'share.exportStage.files' },
  { stage: 'pack', label: 'share.exportStage.pack' },
  { stage: 'write', label: 'share.exportStage.write' },
] as const satisfies readonly { stage: WorkbenchBundleExportStage; label: WorkbenchMessageKey }[]
const IMPORT_STAGES = [
  { stage: 'verify', label: 'share.importStage.verify' },
  { stage: 'files', label: 'share.importStage.files' },
  { stage: 'sessions', label: 'share.importStage.sessions' },
  { stage: 'register', label: 'share.importStage.register' },
  { stage: 'extensions', label: 'share.importStage.extensions' },
] as const satisfies readonly { stage: WorkbenchBundleImportStage; label: WorkbenchMessageKey }[]

/** Stage position plus progress inside it; a stage with unknown size counts as half done. */
function overallPercent(stages: readonly { stage: string }[], progress: JobProgress): number {
  const index = Math.max(0, stages.findIndex(row => row.stage === progress.stage))
  const within = progress.total > 0 ? Math.min(1, progress.done / progress.total) : 0.5
  return Math.round(((index + within) / stages.length) * 100)
}

const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))


/** What each package kind actually carries, shown before the user commits to an export. */
const KIND_CONTENTS: Record<BundleKind, readonly { label: WorkbenchMessageKey; included: boolean }[]> = {
  template: [
    { label: 'share.bundle.layoutMetadata', included: true },
    { label: 'share.bundle.tasksMemoryExtensions', included: true },
    { label: 'share.bundle.filesAndArtifacts', included: false },
    { label: 'share.bundle.conversationHistory', included: false },
  ],
  complete: [
    { label: 'share.bundle.layoutMetadata', included: true },
    { label: 'share.bundle.tasksMemoryExtensions', included: true },
    { label: 'share.bundle.filesAndArtifacts', included: true },
    { label: 'share.bundle.closedConversationHistory', included: true },
  ],
}

function errorText(error: unknown, t: WorkbenchTranslate): string {
  return error instanceof Error ? error.message : t('share.bundleOperationFailed')
}

function defaultFolderName(inspection: WorkbenchBundleInspectionV1): string {
  return inspection.filename.replace(/\.dshbay\.zip$/iu, '') || 'imported-workbench'
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB']
  let value = bytes / 1024
  for (const unit of units) {
    if (value < 1024 || unit === 'GB') return `${value.toFixed(value < 10 ? 1 : 0)} ${unit}`
    value /= 1024
  }
  return `${bytes} B`
}

/** Groups the manifest entries so the import preview reads as contents, not a digest. */
function inspectionContents(inspection: WorkbenchBundleInspectionV1): { label: WorkbenchMessageKey; count: number }[] {
  const counts = new Map<WorkbenchMessageKey, number>()
  for (const entry of inspection.manifest.entries) {
    if (entry.deleted) continue
    const label = entry.kind === 'project-file' ? 'share.bundle.projectFiles'
      : entry.kind === 'session-checkpoint' ? 'share.bundle.conversationHistory'
        : entry.kind === 'extension' ? 'share.bundle.extensionPages'
          : entry.kind === 'memory' ? 'share.bundle.memory' : entry.kind === 'task' ? 'share.bundle.tasks' : entry.kind === 'attachment' ? 'share.bundle.attachments' : undefined
    if (label) counts.set(label, (counts.get(label) ?? 0) + 1)
  }
  return [...counts].filter(([, count]) => count > 0).map(([label, count]) => ({ label, count }))
}

/** One-shot brief for Creator: make an inner-page extension distributable so the workbench can be exported. */
export function exportRepairPrompt(problem: WorkbenchBundleExtensionProblemV1): string {
  return [
    '这个 DSH Bay 内页扩展不符合工作台包的分发要求，导致工作台无法导出。请在当前项目中修复它，使它可以随工作台包一起分发。',
    '',
    `扩展模块：${problem.moduleId}`,
    `包名：${problem.packageName ?? '未找到已安装的扩展'}`,
    `当前版本：${problem.version ?? '未知'}`,
    `提供的内页：${problem.editorIds.join('、') || '未知'}`,
    `导出检查结果：${problem.reason}`,
    '',
    '请先读取 workbench-extension-development 技能中关于分发的要求，然后检查 package.json：',
    '- dsh.workbench.distribution（version 1、exportPolicy、精确的 runtimeFiles、requires）',
    '- dsh.workbench.platforms（声明支持的系统：win32、darwin、linux）',
    '- dsh.workbench.editors 与 editorIds 一致，dshGeneration 与 coreCompatibility 匹配当前版本',
    '- 许可证文件、无未打包的 npm 依赖、无安装脚本',
    '保留扩展原有身份和功能，避免修改无关模块。完成后构建离线制品、重新安装，再回到工作台导出页重新检查。',
  ].join('\n')
}

function JobProgressView({ stages, progress, title }: { stages: readonly { stage: string; label: WorkbenchMessageKey }[]; progress: JobProgress; title: string }) {
  const percent = overallPercent(stages, progress)
  const current = stages.findIndex(row => row.stage === progress.stage)
  const { t } = useWorkbenchLocale()
  const label = t(stages[current]?.label ?? 'share.processing')
  const detail = progress.total > 0 && progress.stage !== 'write' ? `${Math.min(progress.done, progress.total)} / ${progress.total}` : undefined
  return <div className={css.jobProgress} role="status" aria-live="polite">
    <div className={css.jobProgressHead}><strong>{title}</strong><span>{percent}%</span></div>
    <progress className={css.progress} max={100} value={percent} aria-label={`${title} ${percent}%`} />
    <p>{label}{detail ? ` · ${detail}` : ''}…</p>
    <ol className={css.stageList}>
      {stages.map((row, index) => <li key={row.stage} data-state={index < current ? 'done' : index === current ? 'current' : 'pending'}><span aria-hidden="true">{index < current ? <IconCheckOutlineMedium size={11} /> : null}</span>{t(row.label)}</li>)}
    </ol>
  </div>
}

export function WorkbenchSharingPage(props: SettingsPageProps) {
  const { t } = useWorkbenchLocale()
  const browser = props.settingsContext?.mode === 'browser-workbench'
  const client = useMemo(() => createWorkbenchBundleClient(), [])
  const initialId = browser && props.settingsContext?.mode === 'browser-workbench'
    ? props.settingsContext.workbenchId
    : props.openOptions?.workbenchId ?? props.value?.activeWorkbenchId ?? ''
  // The former protocol tab is gone; old links to it open the export tab.
  const [mode, setMode] = useState<ShareMode>(props.openOptions?.shareMode === 'import' ? 'import' : 'export')
  const [kind, setKind] = useState<BundleKind>(props.openOptions?.shareType === 'complete' ? 'complete' : 'template')
  const [workbenchId, setWorkbenchId] = useState(initialId)
  const [file, setFile] = useState<File>()
  const [inspection, setInspection] = useState<WorkbenchBundleInspectionV1>()
  const [parentPath, setParentPath] = useState('')
  const [folderName, setFolderName] = useState('')
  const [result, setResult] = useState<WorkbenchBundleImportResultV1>()
  const [exported, setExported] = useState<WorkbenchBundleExportedV1 & { jobId: string }>()
  const [exportFolder, setExportFolder] = useState('')
  const [progress, setProgress] = useState<{ operation: 'export' | 'import'; value: JobProgress }>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [syncConfig, setSyncConfig] = useState<WorkbenchSyncConfigV1>({ ...DEFAULT_WORKBENCH_SYNC_CONFIG })
  const [syncState, setSyncState] = useState<WorkbenchSyncStateV1>({ status: 'local', updatedAt: 0 })
  const [syncLoaded, setSyncLoaded] = useState(false)
  const record = props.value?.workbenches[workbenchId]
  const writable = settingsTargetWritable(props.settingsContext ?? DESKTOP_SETTINGS_CONTEXT, workbenchId, props.windowController)

  useEffect(() => {
    if (browser || mode !== 'sync' || !workbenchId) return
    let active = true
    setSyncLoaded(false)
    void client.syncConfig(workbenchId).then(response => {
      if (!active) return
      setSyncConfig(response.config)
      setSyncState(response.state)
      setSyncLoaded(true)
    }).catch(cause => {
      if (active) setError(errorText(cause, t))
    })
    return () => { active = false }
  }, [browser, client, mode, workbenchId])

  useEffect(() => {
    if (browser) return
    let active = true
    void client.exportLocation().then(folder => { if (active) setExportFolder(current => current || folder) }).catch(() => {})
    return () => { active = false }
  }, [browser, client])

  // Extensions that cannot travel block export up front, with a repair entry for each.
  const [problems, setProblems] = useState<readonly WorkbenchBundleExtensionProblemV1[]>([])
  const [checking, setChecking] = useState(false)
  const [repairing, setRepairing] = useState<string>()
  const recheck = useCallback(async (signal?: AbortSignal) => {
    if (browser || !workbenchId) { setProblems([]); return }
    setChecking(true)
    try {
      const checked = await client.exportCheck(workbenchId, signal)
      if (!signal?.aborted) setProblems(checked.problems)
    } catch { if (!signal?.aborted) setProblems([]) } finally { if (!signal?.aborted) setChecking(false) }
  }, [browser, client, workbenchId])
  useEffect(() => {
    if (mode !== 'export') return
    const controller = new AbortController()
    void recheck(controller.signal)
    return () => controller.abort()
  }, [mode, recheck])

  const repairInCreator = (problem: WorkbenchBundleExtensionProblemV1) => {
    if (!props.openCreator || repairing) return
    const key = problem.packageName ?? problem.moduleId
    setRepairing(key); setError(undefined)
    void props.openCreator(exportRepairPrompt(problem), t('share.repairExportTitle', { id: problem.moduleId }), {
      workbenchId, moduleId: problem.moduleId, ...(problem.packageName === undefined ? {} : { packageName: problem.packageName }),
    }).then(() => props.close?.()).catch(cause => setError(errorText(cause, t))).finally(() => setRepairing(undefined))
  }

  const run = async (action: () => Promise<void>) => {
    if (busy) return
    setBusy(true); setError(undefined)
    try { await action() } catch (cause) { setError(errorText(cause, t)) } finally { setBusy(false); setProgress(undefined) }
  }

  /** Polls a Host job until it settles. Transient poll failures are retried, the job keeps running. */
  const follow = async (jobId: string, operation: 'export' | 'import'): Promise<WorkbenchBundleJobV1> => {
    for (let misses = 0; ;) {
      await pause(400)
      let job: WorkbenchBundleJobV1
      try { job = await client.job(jobId); misses = 0 }
      catch (cause) { if (++misses >= 5) throw cause; continue }
      setProgress({ operation, value: job.progress })
      if (job.state === 'failed') throw new Error(job.error)
      if (job.state === 'done') return job
    }
  }

  const chooseExportFolder = () => void run(async () => {
    if (!props.workbenchDirectory?.pickParentDirectory) throw new Error(t('share.noFolderPicker'))
    const selected = await props.workbenchDirectory.pickParentDirectory()
    if (selected) setExportFolder(selected)
  })

  const exportBundle = () => void run(async () => {
    if (!workbenchId) throw new Error(t('share.selectWorkbench'))
    if (!writable) throw new Error(t('transfer.takeBackControlFromTheBrowserBefore'))
    setExported(undefined)
    const checked = await client.exportCheck(workbenchId)
    setProblems(checked.problems)
    if (checked.problems.length > 0) throw new Error(t('share.exportRepairNeeded', { count: checked.problems.length }))
    setProgress({ operation: 'export', value: { stage: 'collect', done: 0, total: 0 } })
    const jobId = await client.startExport(workbenchId, kind, exportFolder || undefined)
    const job = await follow(jobId, 'export')
    // Skipped items are a warning, not a failure: the package was produced.
    if (job.operation === 'export' && job.state === 'done') setExported({ ...job.result, jobId })
  })

  const revealExport = () => void run(async () => {
    if (!exported) return
    await client.reveal(exported.jobId)
  })

  const inspectFile = (candidate: File) => void run(async () => {
    setFile(candidate); setInspection(undefined); setResult(undefined); setParentPath(''); setFolderName('')
    const checked = await client.inspect(candidate)
    setInspection(checked)
    setFolderName(defaultFolderName(checked))
  })

  const chooseParent = () => void run(async () => {
    if (!props.workbenchDirectory?.pickParentDirectory) throw new Error(t('share.noWorkbenchFolderPicker'))
    const selected = await props.workbenchDirectory.pickParentDirectory()
    if (selected) setParentPath(selected)
  })

  const importBundle = () => void run(async () => {
    if (!file || !inspection) throw new Error(t('share.selectAndCheckBundle'))
    if (browser) throw new Error(t('share.importInDesktop'))
    if (!parentPath) throw new Error(t('share.chooseParentFolder'))
    if (!folderName.trim()) throw new Error(t('share.enterFolderName'))
    setProgress({ operation: 'import', value: { stage: 'verify', done: 0, total: 0 } })
    const jobId = await client.startImport(file, { parentPath, folderName: folderName.trim() })
    const job = await follow(jobId, 'import')
    if (job.operation === 'import' && job.state === 'done') {
      setResult(job.result)
      window.dispatchEvent(new Event('workbench-bundle-imported'))
    }
  })

  const saveSync = () => void run(async () => {
    if (!workbenchId) throw new Error('Select a workbench first')
    if (browser || !writable) throw new Error('Sync settings are available on the DSH desktop')
    const response = await client.saveSyncConfig(workbenchId, syncConfig)
    setSyncConfig(response.config)
    setSyncState(response.state)
    setSyncLoaded(true)
  })

  const syncNow = () => void run(async () => {
    if (!workbenchId) throw new Error('Select a workbench first')
    if (browser || !writable) throw new Error('Sync is available on the DSH desktop')
    // Apply edits in the form before running so "立即同步" never uses a stale
    // provider or remote from the previous saved configuration.
    const saved = await client.saveSyncConfig(workbenchId, syncConfig)
    setSyncConfig(saved.config)
    setSyncState(saved.state)
    const response = await client.syncNow(workbenchId)
    setSyncConfig(response.config)
    setSyncState(response.state)
    setSyncLoaded(true)
  })

  return <section className={css.page} aria-label={t('transfer.workbenchExportAndImport')}>
    <header className={css.header}><span className={css.headerIcon} aria-hidden="true"><IconShareOutlineMedium size={23} /></span><div><h2>{t('transfer.exportAndImportWorkbenches')}</h2><p>{t('transfer.useADshbayZipPackageImportingCreates')}</p></div></header>
    <nav className={css.tabs} aria-label={t('transfer.workbenchPackageActions')}>
      <button type="button" aria-pressed={mode === 'export'} onClick={() => { setMode('export'); setError(undefined) }}><IconDownloadOutlineMedium size={16} />{t('home.exportWorkbench')}</button>
      <button type="button" aria-pressed={mode === 'import'} onClick={() => { setMode('import'); setError(undefined) }}><IconFolderOpenOutlineMedium size={16} />{t('settings.importWorkbench')}</button>
      <button type="button" aria-pressed={mode === 'sync'} onClick={() => { setMode('sync'); setError(undefined) }} disabled={browser}><IconRefreshOutlineMedium size={16} />{t('transfer.syncSettings')}</button>
    </nav>

    {mode === 'export' ? <div className={css.workspace}>
      <section className={css.formPanel}><div className={css.formIntro}><h3>{t('home.exportWorkbench')}</h3><p>{t('transfer.packageAWorkbenchToContinueUsingIt')}</p></div>
        <label className={css.field}>{t('transfer.sourceWorkbench')}<select value={workbenchId} disabled={browser || busy} onChange={event => { setWorkbenchId(event.target.value); setExported(undefined) }}><option value="" disabled>{t('home.selectAWorkbench')}</option>{Object.values(props.value?.workbenches ?? {}).map(row => <option key={row.workbenchId} value={row.workbenchId}>{row.name}</option>)}</select></label>
        <div className={css.choices} role="radiogroup" aria-label={t('transfer.exportType')}>
          <button type="button" role="radio" className={css.choice} aria-checked={kind === 'template'} onClick={() => { setKind('template'); setExported(undefined) }}><span className={css.choiceIcon}><IconShareOutlineMedium size={21} /></span><span className={css.choiceCopy}><strong>{t('transfer.templatePackage')}</strong><small>{t('transfer.shareTheLayoutAndExtensionPagesSo')}</small></span><span className={css.choiceCheck}>{kind === 'template' ? <IconCheckOutlineMedium size={12} /> : null}</span></button>
          <button type="button" role="radio" className={css.choice} aria-checked={kind === 'complete'} onClick={() => { setKind('complete'); setExported(undefined) }}><span className={css.choiceIcon}><IconArchiveOutlineMedium size={21} /></span><span className={css.choiceCopy}><strong>{t('transfer.fullPackage')}</strong><small>{t('transfer.includeProjectFilesAndConversationHistoryFor')}</small></span><span className={css.choiceCheck}>{kind === 'complete' ? <IconCheckOutlineMedium size={12} /> : null}</span></button>
        </div>
        <ul className={css.contents} aria-label={t('transfer.packageContents')}>
          {KIND_CONTENTS[kind].map(item => <li key={item.label} data-included={item.included}><span aria-hidden="true">{item.included ? <IconCheckOutlineMedium size={14} /> : null}</span>{t(item.label)}</li>)}
        </ul>
        {!browser ? <div className={css.destination}><IconFolderOpenOutlineMedium size={17} /><div><strong>{t('transfer.saveTo')}</strong><p>{exportFolder || t('share.loadingDefaultLocation')}</p><button type="button" className={css.secondaryButton} disabled={busy || !props.workbenchDirectory?.pickParentDirectory} onClick={chooseExportFolder}>{t('transfer.changeLocation')}</button></div></div> : null}
        {problems.length > 0 ? <div className={css.blocker} role="alert">
          <strong><IconWarningOutlineMedium size={14} /> {t('share.exportRepairNeeded', { count: problems.length })}</strong>
          <ul className={css.problemList}>{problems.map(problem => {
            const key = problem.packageName ?? problem.moduleId
            return <li key={key}>
              <div><strong>{problem.packageName ?? problem.moduleId}{problem.version ? ` · ${problem.version}` : ''}</strong><p>{problem.reason}</p><small>{t('transfer.pages2')}{problem.editorIds.join('、')}</small></div>
              {props.openCreator ? <button type="button" className={css.secondaryButton} disabled={busy || repairing !== undefined} onClick={() => repairInCreator(problem)}><IconAgentPresetOutlineMedium size={15} />{repairing === key ? t('share.openingCreator') : t('share.repairInCreator')}</button> : null}
            </li>
          })}</ul>
          <div className={css.noticeActions}><button type="button" className={css.secondaryButton} disabled={busy || checking} onClick={() => void recheck()}><IconRefreshOutlineMedium size={15} />{checking ? t('home.checking') : t('transfer.checkAgain')}</button></div>
          <p>{t('transfer.repairCreatesASeparateFolderAndOpens')}</p>
        </div> : null}
        <div className={css.actionBar}><button type="button" className={css.primaryButton} disabled={busy || browser || !workbenchId || problems.length > 0} onClick={exportBundle}><IconDownloadOutlineMedium size={16} />{progress?.operation === 'export' ? t('share.exporting') : t('share.exportBundle', { kind: t(`share.bundle.${kind}`) })}</button><span>{record ? record.name : t('share.selectWorkbench')} {t('transfer.dshbayZipExistingFilesAreNotOverwritten')}</span></div>
        {progress?.operation === 'export' ? <JobProgressView stages={EXPORT_STAGES} progress={progress.value} title={t('share.exportingBundle', { kind: t(`share.bundle.${kind}`) })} /> : null}
        {exported ? <div className={css.notice} role="status"><strong><IconCheckOutlineMedium size={14} /> {t('transfer.exported')} {exported.filename} · {formatBytes(exported.bytes)}</strong>
          <p className={css.filePath}>{exported.path}</p>
          <div className={css.noticeActions}><button type="button" className={css.secondaryButton} disabled={busy} onClick={revealExport}><IconFolderOpenOutlineMedium size={15} />{t('transfer.showInFolder')}</button></div>
          {exported.notices.length > 0 ? <ul className={css.noticeList}>{exported.notices.map(notice => <li key={notice.sessionKey}><IconWarningOutlineMedium size={14} /><span>{notice.sessionKey}：{notice.reason}</span></li>)}</ul> : null}
        </div> : null}
      </section>
      <aside className={css.summary}><div className={css.summaryTitle}><IconArchiveOutlineMedium size={17} /><h3>{t('transfer.packageDetails')}</h3></div><div className={css.summaryCaption}><strong>{t('transfer.extensionPagesAreIncluded')}</strong><span>{t('transfer.extensionsUsedByTheWorkbenchArePackaged')}</span></div><div className={css.summaryCaption}><strong>{t('transfer.activeConversationsAreExcluded')}</strong><span>{t('transfer.fullPackagesContainClosedConversationsOnlyUnreadable')}</span></div><div className={css.summaryCaption}><strong>{t('transfer.excludedContent')}</strong><span>{t('transfer.theExportSkipsGitNodeModulesSymlinks')}</span></div></aside>
    </div> : null}

    {mode === 'import' ? <div className={css.workspace}>
      <section className={css.formPanel}><div className={css.formIntro}><h3>{t('settings.importWorkbench')}</h3><p>{t('transfer.chooseADshbayZipPackageAfterValidation')}</p></div>
        <label className={css.upload} data-disabled={busy || browser}><IconFolderOpenOutlineMedium size={28} /><strong>{file?.name ?? t('share.chooseBayZip')}</strong><span>{busy && !inspection ? t('share.verifying') : t('share.verifyBeforeImport')}</span><small>{t('transfer.legacyLayoutPackagesAndConversationArchivesAre')}</small><input type="file" accept=".dshbay.zip" disabled={busy || browser} onChange={event => { const candidate = event.target.files?.[0]; event.target.value = ''; if (candidate) inspectFile(candidate) }} /></label>
        {browser ? <p className={css.hint}>{t('transfer.theBrowserCannotChooseALocalFolder')}</p> : null}
        {inspection ? <div className={css.importDetails}>
          <h4>{inspection.filename.replace(/\.dshbay\.zip$/iu, '')} · {t(`share.bundle.${inspection.manifest.kind}`)}</h4>
          <dl className={css.importCounts}>
            <div><dt>{t('transfer.entries')}</dt><dd>{t('share.entryCount', { count: inspection.fileCount })}</dd></div>
            <div><dt>{t('transfer.packageSize')}</dt><dd>{formatBytes(inspection.bytes)}</dd></div>
            {inspectionContents(inspection).map(item => <div key={item.label}><dt>{t(item.label)}</dt><dd>{item.count}</dd></div>)}
            {inspection.externalDependencyCount > 0 ? <div><dt>{t('transfer.extensionsToInstallSeparately')}</dt><dd>{t('share.entryCount', { count: inspection.externalDependencyCount })}</dd></div> : null}
          </dl>
          {inspection.manifest.externalDependencies && inspection.manifest.externalDependencies.length > 0 ? <ul className={css.dependencyList}>{inspection.manifest.externalDependencies.map(dependency => <li key={dependency.id}><IconWarningOutlineMedium size={14} /><span>{dependency.id}{dependency.version ? ` ${dependency.version}` : ''}：{dependency.reason}</span></li>)}</ul> : null}
        </div> : null}
        {inspection && !browser ? <><label className={css.field}>{t('transfer.newWorkbenchFolderName2')}<input value={folderName} disabled={busy} onChange={event => setFolderName(event.target.value)} /></label><div className={css.destination}><IconFolderOpenOutlineMedium size={17} /><div><strong>{t('transfer.saveTo')}</strong><p>{parentPath || t('share.noParentFolder')}</p><button type="button" className={css.secondaryButton} disabled={busy || !props.workbenchDirectory?.pickParentDirectory} onClick={chooseParent}>{t('transfer.chooseParentFolder')}</button></div></div><div className={css.actionBar}><button type="button" className={css.primaryButton} disabled={busy || !parentPath || !folderName.trim() || result !== undefined} onClick={importBundle}><IconArchiveOutlineMedium size={16} />{progress?.operation === 'import' ? t('share.importing') : t('share.importAsNew')}</button><span>{t('transfer.theActiveWorkbenchWillNotChange')}</span></div></> : null}
        {progress?.operation === 'import' ? <JobProgressView stages={IMPORT_STAGES} progress={progress.value} title={t('transfer.importingWorkbench')} /> : null}
        {result ? <div className={css.notice} role="status"><strong><IconCheckOutlineMedium size={14} /> {t('transfer.newWorkbenchCreated')}{result.name}</strong><p className={css.filePath}>{parentPath && folderName ? `${parentPath.replace(/[\\/]+$/u, '')}${parentPath.includes('\\') ? '\\' : '/'}${folderName.trim()}` : ''}</p><p>{t('transfer.openTheNewWorkbenchFromTheList')}</p></div> : null}
      </section>
      <aside className={css.summary}><div className={css.summaryTitle}><IconArchiveOutlineMedium size={17} /><h3>{t('transfer.preImportChecks2')}</h3></div><ul className={css.importIncludes}><li><IconCheckOutlineMedium size={16} /><div><strong>{t('transfer.packageIntegrity')}</strong><p>{t('transfer.importChecksPathsDuplicateEntriesSymlinksSizes')}</p></div></li><li><IconCheckOutlineMedium size={16} /><div><strong>{t('transfer.extensionPages')}</strong><p>{t('transfer.allDeclaredExtensionArtifactsMustBePresent')}</p></div></li><li><IconCheckOutlineMedium size={16} /><div><strong>{t('transfer.existingWorkbenchesStayUnchanged')}</strong><p>{t('transfer.thePackageIsStagedBeforeRegistrationFailed')}</p></div></li></ul></aside>
    </div> : null}

    {mode === 'sync' ? <div className={css.workspace}>
      <section className={css.formPanel}>
        <div className={css.formIntro}><h3>{t('transfer.workbenchSync')}</h3><p>{t('transfer.syncSnapshotsAndMissingObjectsTheRemote')}</p></div>
        <label className={css.field}>{t('shell.workbench')}<select value={workbenchId} disabled={browser || busy} onChange={event => setWorkbenchId(event.target.value)}><option value="" disabled>{t('home.selectAWorkbench')}</option>{Object.values(props.value?.workbenches ?? {}).map(row => <option key={row.workbenchId} value={row.workbenchId}>{row.name}</option>)}</select></label>
        <label className={css.field}>{t('transfer.syncMethod')}<select value={syncConfig.provider} disabled={busy || !syncLoaded || browser} onChange={event => setSyncConfig(current => ({ ...current, provider: event.target.value as WorkbenchSyncConfigV1['provider'], remote: event.target.value === 'none' ? '' : current.remote }))}><option value="none">{t('transfer.localOnly')}</option><option value="folder">{t('transfer.localOrNetworkFolder')}</option><option value="webdav">WebDAV</option></select></label>
        {syncConfig.provider !== 'none' ? <label className={css.field}>{syncConfig.provider === 'webdav' ? t('share.webDavAddress') : t('share.remoteFolder')}<input value={syncConfig.remote} disabled={busy || !syncLoaded || browser} placeholder={syncConfig.provider === 'webdav' ? 'https://example.com/dshbay' : 'D:\\dshbay-remote'} onChange={event => setSyncConfig(current => ({ ...current, remote: event.target.value }))} /></label> : null}
        <label className={css.field}>{t('transfer.syncIntervalMinutes')}<input type="number" min={1} max={10080} value={syncConfig.intervalMinutes} disabled={busy || !syncLoaded || browser} onChange={event => setSyncConfig(current => ({ ...current, intervalMinutes: Number(event.target.value) || 1 }))} /></label>
        <label className={css.field}><span><input type="checkbox" checked={syncConfig.enabled} disabled={busy || !syncLoaded || browser || syncConfig.provider === 'none'} onChange={event => setSyncConfig(current => ({ ...current, enabled: event.target.checked }))} /> {t('transfer.enableScheduledSync')}</span></label>
        <div className={css.actionBar}><button type="button" className={css.primaryButton} disabled={busy || browser || !syncLoaded || !workbenchId} onClick={saveSync}><IconCheckOutlineMedium size={16} />{t('transfer.saveSettings')}</button><button type="button" className={css.secondaryButton} disabled={busy || browser || !syncLoaded || !workbenchId || syncConfig.provider === 'none'} onClick={syncNow}><IconRefreshOutlineMedium size={16} />{t('transfer.syncNow')}</button></div>
        {browser ? <p className={css.hint}>{t('transfer.syncSettingsAreReadOnlyInThe')}</p> : null}
      </section>
      <aside className={css.summary}><div className={css.summaryTitle}><IconRefreshOutlineMedium size={17} /><h3>{t('transfer.syncStatus')}</h3></div><div className={css.summaryCaption}><strong>{syncState.status === 'local' ? t('transfer.localOnly') : syncState.status === 'pending' ? t('share.pendingUpload') : syncState.status === 'synced' ? t('share.synced') : syncState.status === 'offline' ? t('share.offline') : syncState.status === 'conflict' ? t('transfer.conflict') : syncState.status}</strong><span>{syncState.error ?? t('share.syncCredentials')}</span></div>{syncState.localSnapshotId ? <div className={css.summaryPath}>{t('transfer.localSnapshot')}{syncState.localSnapshotId}</div> : null}{syncState.remoteSnapshotId ? <div className={css.summaryPath}>{t('transfer.remoteSnapshot')}{syncState.remoteSnapshotId}</div> : null}</aside>
    </div> : null}
    {error ? <p className={css.error} role="alert">{error}</p> : null}
  </section>
}
