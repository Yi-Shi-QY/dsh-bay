import { useEffect, useMemo, useState } from 'react'
import { IconArchiveOutlineMedium, IconCheckOutlineMedium, IconClockOutlineMedium, IconDownloadOutlineMedium, IconFolderOpenOutlineMedium, IconRefreshOutlineMedium, IconShareOutlineMedium } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SettingsPageProps } from './WorkbenchSettingsPages.tsx'
import { DESKTOP_SETTINGS_CONTEXT, settingsTargetWritable } from './settings-context.ts'
import { createWorkbenchBundleClient } from '../client/workbench-bundle.ts'
import type { WorkbenchBundleInspectionV1 } from '../workbench-bundle-contract.ts'
import { DEFAULT_WORKBENCH_SYNC_CONFIG, type WorkbenchSyncConfigV1, type WorkbenchSyncStateV1 } from '../workbench-sync-contract.ts'
import css from './WorkbenchSharing.module.css'

type BundleKind = 'template' | 'complete'
type ShareMode = 'export' | 'import' | 'history' | 'sync'

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : '工作台包操作失败，请重试。'
}

function defaultFolderName(inspection: WorkbenchBundleInspectionV1): string {
  return inspection.filename.replace(/\.dshbay\.zip$/iu, '') || 'imported-workbench'
}

export function WorkbenchSharingPage(props: SettingsPageProps) {
  const browser = props.settingsContext?.mode === 'browser-workbench'
  const client = useMemo(() => createWorkbenchBundleClient(), [])
  const initialId = browser && props.settingsContext?.mode === 'browser-workbench'
    ? props.settingsContext.workbenchId
    : props.openOptions?.workbenchId ?? props.value?.activeWorkbenchId ?? ''
  const [mode, setMode] = useState<ShareMode>(props.openOptions?.shareMode ?? 'export')
  const [kind, setKind] = useState<BundleKind>(props.openOptions?.shareType === 'complete' ? 'complete' : 'template')
  const [workbenchId, setWorkbenchId] = useState(initialId)
  const [file, setFile] = useState<File>()
  const [inspection, setInspection] = useState<WorkbenchBundleInspectionV1>()
  const [parentPath, setParentPath] = useState('')
  const [folderName, setFolderName] = useState('')
  const [result, setResult] = useState<{ workbenchId: string; name: string }>()
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

  const run = async (action: () => Promise<void>) => {
    if (busy) return
    setBusy(true); setError(undefined)
    try { await action() } catch (cause) { setError(errorText(cause)) } finally { setBusy(false) }
  }

  const exportBundle = () => void run(async () => {
    if (!workbenchId) throw new Error('请先选择工作台。')
    if (!writable) throw new Error('此工作台正在浏览器中使用，请先收回再导出。')
    const bundle = await client.export(workbenchId, kind)
    const url = URL.createObjectURL(bundle.file)
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = bundle.filename; anchor.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  })

  const inspectFile = (candidate: File) => void run(async () => {
    setFile(candidate); setInspection(undefined); setResult(undefined)
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
    const committed = await client.import(file, { parentPath, folderName: folderName.trim() })
    setResult({ workbenchId: committed.workbenchId, name: committed.name })
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
      <button type="button" aria-pressed={mode === 'history'} onClick={() => { setMode('history'); setError(undefined) }}><IconClockOutlineMedium size={16} />协议说明</button>
      <button type="button" aria-pressed={mode === 'sync'} onClick={() => { setMode('sync'); setError(undefined) }} disabled={browser}><IconRefreshOutlineMedium size={16} />同步设置</button>
    </nav>

    {mode === 'export' ? <div className={css.workspace}>
      <section className={css.formPanel}><div className={css.formIntro}><h3>导出 .dshbay.zip</h3><p>两个导出类型共用同一份快照和校验流程。文件名会自动使用工作台名称。</p></div>
        <label className={css.field}>来源工作台<select value={workbenchId} disabled={browser || busy} onChange={event => setWorkbenchId(event.target.value)}><option value="" disabled>选择工作台</option>{Object.values(props.value?.workbenches ?? {}).map(row => <option key={row.workbenchId} value={row.workbenchId}>{row.name}</option>)}</select></label>
        <div className={css.choices} role="group" aria-label="导出类型">
          <button type="button" className={css.choice} aria-pressed={kind === 'template'} onClick={() => setKind('template')}><span className={css.choiceIcon}><IconShareOutlineMedium size={21} /></span><span className={css.choiceCopy}><strong>template 模板</strong><small>布局、项目声明、扩展锁和环境锁；不包含项目文件、对话和活动 Session。</small></span><span className={css.choiceCheck}>{kind === 'template' ? <IconCheckOutlineMedium size={12} /> : null}</span></button>
          <button type="button" className={css.choice} aria-pressed={kind === 'complete'} onClick={() => setKind('complete')}><span className={css.choiceIcon}><IconArchiveOutlineMedium size={21} /></span><span className={css.choiceCopy}><strong>complete 完整包</strong><small>布局、项目文件、已关闭或显式 checkpoint 的 Session、任务、记忆、附件和扩展制品。</small></span><span className={css.choiceCheck}>{kind === 'complete' ? <IconCheckOutlineMedium size={12} /> : null}</span></button>
        </div>
        {record ? <p className={css.hint}>当前选择：{record.name} · 导出前会校验扩展制品和环境依赖。</p> : null}
        <div className={css.actionBar}><button type="button" className={css.primaryButton} disabled={busy || browser || !workbenchId} onClick={exportBundle}><IconDownloadOutlineMedium size={16} />生成并下载 {kind} 包</button><span>格式固定为 .dshbay.zip</span></div>
      </section>
      <aside className={css.summary}><div className={css.summaryTitle}><IconArchiveOutlineMedium size={17} /><h3>导出边界</h3></div><div className={css.summaryCaption}><strong>不会进入包内</strong><span>凭据、Token、Cookie、设备绑定、活动进程、插件缓存、绝对路径和 .dshbay/local。</span></div><div className={css.summaryCaption}><strong>独立对话归档</strong><span>DSH 原生 Session 导出继续由 DSH 页面提供，不能作为工作台恢复包导入。</span></div></aside>
    </div> : null}

    {mode === 'import' ? <div className={css.workspace}>
      <section className={css.formPanel}><div className={css.formIntro}><h3>导入 .dshbay.zip</h3><p>先验证 dshbay-workbench v1 manifest 和内容摘要，再创建新的未打开工作台。</p></div>
        <label className={css.upload} data-disabled={busy || browser}><IconFolderOpenOutlineMedium size={28} /><strong>{file?.name ?? '选择 .dshbay.zip'}</strong><span>只接受 dshbay-workbench v1</span><small>其他 ZIP、旧布局包和对话归档包都会被拒绝</small><input type="file" accept=".dshbay.zip" disabled={busy || browser} onChange={event => { const candidate = event.target.files?.[0]; event.target.value = ''; if (candidate) inspectFile(candidate) }} /></label>
        {browser ? <p className={css.hint}>浏览器工作台不能选择本机目录，请在 DSH 桌面端导入。</p> : null}
        {inspection ? <div className={css.importDetails}><h4>{inspection.manifest.kind} · 已通过校验</h4><p>snapshot：{inspection.manifest.snapshotId}</p><p>root digest：{inspection.manifest.rootDigest}</p><p>{inspection.fileCount} 个条目 · {inspection.projectFileCount} 个项目文件 · {inspection.externalDependencyCount} 个外部依赖</p></div> : null}
        {inspection && !browser ? <><label className={css.field}>新工作台文件夹名<input value={folderName} disabled={busy} onChange={event => setFolderName(event.target.value)} /></label><div className={css.destination}><IconFolderOpenOutlineMedium size={17} /><div><strong>目标父目录</strong><p>{parentPath || '尚未选择'}</p><button type="button" className={css.secondaryButton} disabled={busy || !props.workbenchDirectory?.pickParentDirectory} onClick={chooseParent}>选择目标父目录</button></div></div><div className={css.actionBar}><button type="button" className={css.primaryButton} disabled={busy || !parentPath || !folderName.trim()} onClick={importBundle}><IconArchiveOutlineMedium size={16} />创建新工作台</button><span>当前工作台不会切换</span></div></> : null}
        {result ? <div className={css.notice} role="status"><strong>已创建新工作台：{result.name}</strong><p>{result.workbenchId} · 当前工作台未切换。</p></div> : null}
      </section>
      <aside className={css.summary}><div className={css.summaryTitle}><IconArchiveOutlineMedium size={17} /><h3>导入规则</h3></div><ul className={css.importIncludes}><li><IconCheckOutlineMedium size={16} /><div><strong>完整校验</strong><p>路径穿越、重复条目、符号链接、大小和每个 entry digest 都会检查。</p></div></li><li><IconCheckOutlineMedium size={16} /><div><strong>扩展可验证</strong><p>缺少或无法验证的扩展制品不会显示导入成功。</p></div></li><li><IconCheckOutlineMedium size={16} /><div><strong>原子提交</strong><p>先写入隔离 staging，再登记新工作台，失败不会覆盖现有目录。</p></div></li></ul></aside>
    </div> : null}

    {mode === 'history' ? <section className={css.formPanel}><div className={css.formIntro}><h3>当前公开协议</h3><p>新版本只识别 dshbay-workbench v1，公开容器固定为 &lt;工作台名&gt;.dshbay.zip。</p></div><ul className={css.importIncludes}><li><IconCheckOutlineMedium size={16} /><div><strong>template</strong><p>用于分享布局和工作台声明，不带项目文件、对话历史或活动 Session。</p></div></li><li><IconCheckOutlineMedium size={16} /><div><strong>complete</strong><p>用于完整迁移和备份，只同步关闭的 Session 或用户显式创建的 checkpoint。</p></div></li><li><IconCheckOutlineMedium size={16} /><div><strong>旧协议</strong><p>V1/V4/V5/V6、旧 .bay、旧 layout/offline/distribution 包均显示不受支持；DSH 对话 ZIP 不能作为工作台恢复包。</p></div></li></ul></section> : null}
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
