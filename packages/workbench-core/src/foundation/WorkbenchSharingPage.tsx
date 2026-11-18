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

const EXPORT_STAGES: readonly { stage: WorkbenchBundleExportStage; label: string }[] = [
  { stage: 'collect', label: '读取布局与项目' },
  { stage: 'extensions', label: '打包扩展内页' },
  { stage: 'sessions', label: '读取聊天记录' },
  { stage: 'files', label: '读取项目文件' },
  { stage: 'pack', label: '生成工作台包' },
  { stage: 'write', label: '写入文件' },
]
const IMPORT_STAGES: readonly { stage: WorkbenchBundleImportStage; label: string }[] = [
  { stage: 'verify', label: '校验工作台包' },
  { stage: 'files', label: '写入文件' },
  { stage: 'sessions', label: '恢复聊天记录' },
  { stage: 'register', label: '登记新工作台' },
  { stage: 'extensions', label: '安装扩展内页' },
]

/** Stage position plus progress inside it; a stage with unknown size counts as half done. */
function overallPercent(stages: readonly { stage: string }[], progress: JobProgress): number {
  const index = Math.max(0, stages.findIndex(row => row.stage === progress.stage))
  const within = progress.total > 0 ? Math.min(1, progress.done / progress.total) : 0.5
  return Math.round(((index + within) / stages.length) * 100)
}

const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

const KIND_LABEL: Record<BundleKind, string> = { template: '模板包', complete: '完整包' }

/** What each package kind actually carries, shown before the user commits to an export. */
const KIND_CONTENTS: Record<BundleKind, readonly { label: string; included: boolean }[]> = {
  template: [
    { label: '布局与项目声明', included: true },
    { label: '任务、记忆与扩展内页', included: true },
    { label: '项目文件与产物', included: false },
    { label: '聊天记录', included: false },
  ],
  complete: [
    { label: '布局与项目声明', included: true },
    { label: '任务、记忆与扩展内页', included: true },
    { label: '项目文件与产物', included: true },
    { label: '已关闭会话的聊天记录', included: true },
  ],
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : '工作台包操作失败，请重试。'
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
function inspectionContents(inspection: WorkbenchBundleInspectionV1): { label: string; count: number }[] {
  const counts = new Map<string, number>()
  for (const entry of inspection.manifest.entries) {
    if (entry.deleted) continue
    const label = entry.kind === 'project-file' ? '项目文件'
      : entry.kind === 'session-checkpoint' ? '聊天记录'
        : entry.kind === 'extension' ? '扩展内页'
          : entry.kind === 'memory' ? '记忆' : entry.kind === 'task' ? '任务' : entry.kind === 'attachment' ? '附件' : undefined
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

function JobProgressView({ stages, progress, title }: { stages: readonly { stage: string; label: string }[]; progress: JobProgress; title: string }) {
  const percent = overallPercent(stages, progress)
  const current = stages.findIndex(row => row.stage === progress.stage)
  const label = stages[current]?.label ?? '处理中'
  const detail = progress.total > 0 && progress.stage !== 'write' ? `${Math.min(progress.done, progress.total)} / ${progress.total}` : undefined
  return <div className={css.jobProgress} role="status" aria-live="polite">
    <div className={css.jobProgressHead}><strong>{title}</strong><span>{percent}%</span></div>
    <progress className={css.progress} max={100} value={percent} aria-label={`${title} ${percent}%`} />
    <p>{label}{detail ? ` · ${detail}` : ''}…</p>
    <ol className={css.stageList}>
      {stages.map((row, index) => <li key={row.stage} data-state={index < current ? 'done' : index === current ? 'current' : 'pending'}><span aria-hidden="true">{index < current ? <IconCheckOutlineMedium size={11} /> : null}</span>{row.label}</li>)}
    </ol>
  </div>
}

export function WorkbenchSharingPage(props: SettingsPageProps) {
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
      if (active) setError(errorText(cause))
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
    void props.openCreator(exportRepairPrompt(problem), '修复导出 · ' + problem.moduleId, {
      workbenchId, moduleId: problem.moduleId, ...(problem.packageName === undefined ? {} : { packageName: problem.packageName }),
    }).then(() => props.close?.()).catch(cause => setError(errorText(cause))).finally(() => setRepairing(undefined))
  }

  const run = async (action: () => Promise<void>) => {
    if (busy) return
    setBusy(true); setError(undefined)
    try { await action() } catch (cause) { setError(errorText(cause)) } finally { setBusy(false); setProgress(undefined) }
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
    if (!props.workbenchDirectory?.pickParentDirectory) throw new Error('当前环境不支持选择文件夹。')
    const selected = await props.workbenchDirectory.pickParentDirectory()
    if (selected) setExportFolder(selected)
  })

  const exportBundle = () => void run(async () => {
    if (!workbenchId) throw new Error('请先选择工作台。')
    if (!writable) throw new Error('此工作台正在浏览器中使用，请先收回再导出。')
    setExported(undefined)
    const checked = await client.exportCheck(workbenchId)
    setProblems(checked.problems)
    if (checked.problems.length > 0) throw new Error(`有 ${checked.problems.length} 个内页扩展需要先修复，修复后才能导出。`)
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
    if (!props.workbenchDirectory?.pickParentDirectory) throw new Error('当前环境不支持选择工作台目录。')
    const selected = await props.workbenchDirectory.pickParentDirectory()
    if (selected) setParentPath(selected)
  })

  const importBundle = () => void run(async () => {
    if (!file || !inspection) throw new Error('请先选择并检查 .dshbay.zip 文件。')
    if (browser) throw new Error('请在 DSH 桌面端导入工作台包。')
    if (!parentPath) throw new Error('请选择新工作台的父目录。')
    if (!folderName.trim()) throw new Error('请输入新工作台文件夹名。')
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

  return <section className={css.page} aria-label="工作台导出导入">
    <header className={css.header}><span className={css.headerIcon} aria-hidden="true"><IconShareOutlineMedium size={23} /></span><div><h2>工作台导出与导入</h2><p>统一使用 .dshbay.zip 容器；导入会创建新的工作台，不会覆盖或切换当前工作台。</p></div></header>
    <nav className={css.tabs} aria-label="工作台包操作">
      <button type="button" aria-pressed={mode === 'export'} onClick={() => { setMode('export'); setError(undefined) }}><IconDownloadOutlineMedium size={16} />导出工作台</button>
      <button type="button" aria-pressed={mode === 'import'} onClick={() => { setMode('import'); setError(undefined) }}><IconFolderOpenOutlineMedium size={16} />导入工作台</button>
      <button type="button" aria-pressed={mode === 'sync'} onClick={() => { setMode('sync'); setError(undefined) }} disabled={browser}><IconRefreshOutlineMedium size={16} />同步设置</button>
    </nav>

    {mode === 'export' ? <div className={css.workspace}>
      <section className={css.formPanel}><div className={css.formIntro}><h3>导出工作台</h3><p>打包当前工作台，拿到另一台机器上导入即可继续使用。文件名自动使用工作台名称。</p></div>
        <label className={css.field}>来源工作台<select value={workbenchId} disabled={browser || busy} onChange={event => { setWorkbenchId(event.target.value); setExported(undefined) }}><option value="" disabled>选择工作台</option>{Object.values(props.value?.workbenches ?? {}).map(row => <option key={row.workbenchId} value={row.workbenchId}>{row.name}</option>)}</select></label>
        <div className={css.choices} role="radiogroup" aria-label="导出类型">
          <button type="button" role="radio" className={css.choice} aria-checked={kind === 'template'} onClick={() => { setKind('template'); setExported(undefined) }}><span className={css.choiceIcon}><IconShareOutlineMedium size={21} /></span><span className={css.choiceCopy}><strong>模板包</strong><small>只带结构和扩展内页，适合分享给别人搭建同样的工作台。</small></span><span className={css.choiceCheck}>{kind === 'template' ? <IconCheckOutlineMedium size={12} /> : null}</span></button>
          <button type="button" role="radio" className={css.choice} aria-checked={kind === 'complete'} onClick={() => { setKind('complete'); setExported(undefined) }}><span className={css.choiceIcon}><IconArchiveOutlineMedium size={21} /></span><span className={css.choiceCopy}><strong>完整包</strong><small>连同项目文件和聊天记录一起带走，适合换机器或备份。</small></span><span className={css.choiceCheck}>{kind === 'complete' ? <IconCheckOutlineMedium size={12} /> : null}</span></button>
        </div>
        <ul className={css.contents} aria-label="包内内容">
          {KIND_CONTENTS[kind].map(item => <li key={item.label} data-included={item.included}><span aria-hidden="true">{item.included ? <IconCheckOutlineMedium size={14} /> : null}</span>{item.label}</li>)}
        </ul>
        {!browser ? <div className={css.destination}><IconFolderOpenOutlineMedium size={17} /><div><strong>保存到</strong><p>{exportFolder || '正在读取默认位置…'}</p><button type="button" className={css.secondaryButton} disabled={busy || !props.workbenchDirectory?.pickParentDirectory} onClick={chooseExportFolder}>更改位置</button></div></div> : null}
        {problems.length > 0 ? <div className={css.blocker} role="alert">
          <strong><IconWarningOutlineMedium size={14} /> 有 {problems.length} 个内页扩展不符合分发要求，修复后才能导出</strong>
          <ul className={css.problemList}>{problems.map(problem => {
            const key = problem.packageName ?? problem.moduleId
            return <li key={key}>
              <div><strong>{problem.packageName ?? problem.moduleId}{problem.version ? ` · ${problem.version}` : ''}</strong><p>{problem.reason}</p><small>内页：{problem.editorIds.join('、')}</small></div>
              {props.openCreator ? <button type="button" className={css.secondaryButton} disabled={busy || repairing !== undefined} onClick={() => repairInCreator(problem)}><IconAgentPresetOutlineMedium size={15} />{repairing === key ? '正在打开创造模式…' : '在创造模式中修复'}</button> : null}
            </li>
          })}</ul>
          <div className={css.noticeActions}><button type="button" className={css.secondaryButton} disabled={busy || checking} onClick={() => void recheck()}><IconRefreshOutlineMedium size={15} />{checking ? '正在检查…' : '重新检查'}</button></div>
          <p>修复会在工作台内准备独立修复目录并打开创造模式会话，问题说明会预填在输入框里。修复并重新安装扩展后，点“重新检查”。</p>
        </div> : null}
        <div className={css.actionBar}><button type="button" className={css.primaryButton} disabled={busy || browser || !workbenchId || problems.length > 0} onClick={exportBundle}><IconDownloadOutlineMedium size={16} />{progress?.operation === 'export' ? '正在导出…' : `导出${KIND_LABEL[kind]}`}</button><span>{record ? record.name : '请先选择工作台'} · .dshbay.zip · 同名文件不会被覆盖</span></div>
        {progress?.operation === 'export' ? <JobProgressView stages={EXPORT_STAGES} progress={progress.value} title={`正在导出${KIND_LABEL[kind]}`} /> : null}
        {exported ? <div className={css.notice} role="status"><strong><IconCheckOutlineMedium size={14} /> 已导出 {exported.filename} · {formatBytes(exported.bytes)}</strong>
          <p className={css.filePath}>{exported.path}</p>
          <div className={css.noticeActions}><button type="button" className={css.secondaryButton} disabled={busy} onClick={revealExport}><IconFolderOpenOutlineMedium size={15} />在文件夹中显示</button></div>
          {exported.notices.length > 0 ? <ul className={css.noticeList}>{exported.notices.map(notice => <li key={notice.sessionKey}><IconWarningOutlineMedium size={14} /><span>{notice.sessionKey}：{notice.reason}</span></li>)}</ul> : null}
        </div> : null}
      </section>
      <aside className={css.summary}><div className={css.summaryTitle}><IconArchiveOutlineMedium size={17} /><h3>打包说明</h3></div><div className={css.summaryCaption}><strong>扩展内页会一起带走</strong><span>工作台用到的扩展内页会嵌入包内，导入后自动安装，不需要在新机器上重新找。</span></div><div className={css.summaryCaption}><strong>正在进行的对话不会进入包内</strong><span>完整包只包含已经关闭的会话记录。导出时读不到的会话会被跳过并在这里说明，不影响其余内容。</span></div><div className={css.summaryCaption}><strong>这些内容不会进入包内</strong><span>.git、node_modules、符号链接，以及凭据、Token、Cookie、缓存等私密文件会按规则跳过，导出后会列出被跳过的项目。</span></div></aside>
    </div> : null}

    {mode === 'import' ? <div className={css.workspace}>
      <section className={css.formPanel}><div className={css.formIntro}><h3>导入工作台</h3><p>选择一个 .dshbay.zip，校验通过后会创建一个新的工作台，不会覆盖或切换你正在使用的工作台。</p></div>
        <label className={css.upload} data-disabled={busy || browser}><IconFolderOpenOutlineMedium size={28} /><strong>{file?.name ?? '选择 .dshbay.zip'}</strong><span>{busy && !inspection ? '正在校验…' : '校验通过后才能导入'}</span><small>旧版布局包和对话归档包会被拒绝</small><input type="file" accept=".dshbay.zip" disabled={busy || browser} onChange={event => { const candidate = event.target.files?.[0]; event.target.value = ''; if (candidate) inspectFile(candidate) }} /></label>
        {browser ? <p className={css.hint}>浏览器工作台不能选择本机目录，请在 DSH 桌面端导入。</p> : null}
        {inspection ? <div className={css.importDetails}>
          <h4>{inspection.filename.replace(/\.dshbay\.zip$/iu, '')} · {KIND_LABEL[inspection.manifest.kind]}</h4>
          <dl className={css.importCounts}>
            <div><dt>包内条目</dt><dd>{inspection.fileCount} 个</dd></div>
            <div><dt>包大小</dt><dd>{formatBytes(inspection.bytes)}</dd></div>
            {inspectionContents(inspection).map(item => <div key={item.label}><dt>{item.label}</dt><dd>{item.count} 个</dd></div>)}
            {inspection.externalDependencyCount > 0 ? <div><dt>需要另行安装的扩展</dt><dd>{inspection.externalDependencyCount} 个</dd></div> : null}
          </dl>
          {inspection.manifest.externalDependencies && inspection.manifest.externalDependencies.length > 0 ? <ul className={css.dependencyList}>{inspection.manifest.externalDependencies.map(dependency => <li key={dependency.id}><IconWarningOutlineMedium size={14} /><span>{dependency.id}{dependency.version ? ` ${dependency.version}` : ''}：{dependency.reason}</span></li>)}</ul> : null}
        </div> : null}
        {inspection && !browser ? <><label className={css.field}>新工作台文件夹名<input value={folderName} disabled={busy} onChange={event => setFolderName(event.target.value)} /></label><div className={css.destination}><IconFolderOpenOutlineMedium size={17} /><div><strong>保存到</strong><p>{parentPath || '尚未选择父目录'}</p><button type="button" className={css.secondaryButton} disabled={busy || !props.workbenchDirectory?.pickParentDirectory} onClick={chooseParent}>选择父目录</button></div></div><div className={css.actionBar}><button type="button" className={css.primaryButton} disabled={busy || !parentPath || !folderName.trim() || result !== undefined} onClick={importBundle}><IconArchiveOutlineMedium size={16} />{progress?.operation === 'import' ? '正在导入…' : '导入为新工作台'}</button><span>导入后不会自动切换</span></div></> : null}
        {progress?.operation === 'import' ? <JobProgressView stages={IMPORT_STAGES} progress={progress.value} title="正在导入工作台" /> : null}
        {result ? <div className={css.notice} role="status"><strong><IconCheckOutlineMedium size={14} /> 已创建新工作台：{result.name}</strong><p className={css.filePath}>{parentPath && folderName ? `${parentPath.replace(/[\\/]+$/u, '')}${parentPath.includes('\\') ? '\\' : '/'}${folderName.trim()}` : ''}</p><p>当前工作台未切换，可以在工作台列表里打开它。对话内页如显示“待连接”，选一个对话即可接上。</p></div> : null}
      </section>
      <aside className={css.summary}><div className={css.summaryTitle}><IconArchiveOutlineMedium size={17} /><h3>导入前会检查</h3></div><ul className={css.importIncludes}><li><IconCheckOutlineMedium size={16} /><div><strong>包的完整性</strong><p>路径、重复条目、符号链接、大小和每项内容的摘要都会核对，任何一项不符都会拒绝。</p></div></li><li><IconCheckOutlineMedium size={16} /><div><strong>扩展内页</strong><p>包内声明的扩展制品必须齐全且摘要相符，否则不会显示导入成功。</p></div></li><li><IconCheckOutlineMedium size={16} /><div><strong>不影响现有工作台</strong><p>先写入临时目录再登记，失败不会改动你已有的工作台目录。</p></div></li></ul></aside>
    </div> : null}

    {mode === 'sync' ? <div className={css.workspace}>
      <section className={css.formPanel}>
        <div className={css.formIntro}><h3>工作台同步</h3><p>同步快照和缺失对象，远端只保存 manifest 与内容对象，不生成用户需要理解的差异包。</p></div>
        <label className={css.field}>工作台<select value={workbenchId} disabled={browser || busy} onChange={event => setWorkbenchId(event.target.value)}><option value="" disabled>选择工作台</option>{Object.values(props.value?.workbenches ?? {}).map(row => <option key={row.workbenchId} value={row.workbenchId}>{row.name}</option>)}</select></label>
        <label className={css.field}>同步方式<select value={syncConfig.provider} disabled={busy || !syncLoaded || browser} onChange={event => setSyncConfig(current => ({ ...current, provider: event.target.value as WorkbenchSyncConfigV1['provider'], remote: event.target.value === 'none' ? '' : current.remote }))}><option value="none">仅本机</option><option value="folder">本地或网络文件夹</option><option value="webdav">WebDAV</option></select></label>
        {syncConfig.provider !== 'none' ? <label className={css.field}>{syncConfig.provider === 'webdav' ? 'WebDAV 地址' : '远端文件夹'}<input value={syncConfig.remote} disabled={busy || !syncLoaded || browser} placeholder={syncConfig.provider === 'webdav' ? 'https://example.com/dshbay' : 'D:\\dshbay-remote'} onChange={event => setSyncConfig(current => ({ ...current, remote: event.target.value }))} /></label> : null}
        <label className={css.field}>同步间隔（分钟）<input type="number" min={1} max={10080} value={syncConfig.intervalMinutes} disabled={busy || !syncLoaded || browser} onChange={event => setSyncConfig(current => ({ ...current, intervalMinutes: Number(event.target.value) || 1 }))} /></label>
        <label className={css.field}><span><input type="checkbox" checked={syncConfig.enabled} disabled={busy || !syncLoaded || browser || syncConfig.provider === 'none'} onChange={event => setSyncConfig(current => ({ ...current, enabled: event.target.checked }))} /> 启用定时同步</span></label>
        <div className={css.actionBar}><button type="button" className={css.primaryButton} disabled={busy || browser || !syncLoaded || !workbenchId} onClick={saveSync}><IconCheckOutlineMedium size={16} />保存设置</button><button type="button" className={css.secondaryButton} disabled={busy || browser || !syncLoaded || !workbenchId || syncConfig.provider === 'none'} onClick={syncNow}><IconRefreshOutlineMedium size={16} />立即同步</button></div>
        {browser ? <p className={css.hint}>浏览器工作台只提供查看，桌面端才能配置本地文件夹或 WebDAV。</p> : null}
      </section>
      <aside className={css.summary}><div className={css.summaryTitle}><IconRefreshOutlineMedium size={17} /><h3>同步状态</h3></div><div className={css.summaryCaption}><strong>{syncState.status === 'local' ? '仅本机' : syncState.status === 'pending' ? '待上传' : syncState.status === 'synced' ? '已同步' : syncState.status === 'offline' ? '离线' : syncState.status === 'conflict' ? '冲突' : syncState.status}</strong><span>{syncState.error ?? '凭据保存在系统凭据库，sync.json 只保存 provider、远端标识和计划配置。'}</span></div>{syncState.localSnapshotId ? <div className={css.summaryPath}>本地快照：{syncState.localSnapshotId}</div> : null}{syncState.remoteSnapshotId ? <div className={css.summaryPath}>远端快照：{syncState.remoteSnapshotId}</div> : null}</aside>
    </div> : null}
    {error ? <p className={css.error} role="alert">{error}</p> : null}
  </section>
}
