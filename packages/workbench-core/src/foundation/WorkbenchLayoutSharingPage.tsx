import { browserSafeUuid } from '../browser-safe-id.ts'
import { useEffect, useRef, useState } from 'react'
import type { SettingsPageProps } from './WorkbenchSettingsPages.tsx'
import { downloadSettingsFile, LayoutDiagram, useSettingsAction } from './WorkbenchSettingsPages.tsx'
import { areasOf } from './document-v3.ts'
import type { LayoutPackagePreview } from './workbench-layout-package.ts'
import { buildLayoutPackage, layoutBindingSources } from './workbench-layout-package.ts'
import type { LayoutImportReceiptV2 } from '../layout-import-journal.ts'
import type { SessionBindingV1 } from './model.ts'
import { DESKTOP_SETTINGS_CONTEXT, settingsTargetWritable } from './settings-context.ts'
import { WorkbenchCompletePackagePanel } from './WorkbenchCompletePackagePanel.tsx'
import css from './WorkbenchSettings.module.css'
import { WorkbenchSharingPage } from './WorkbenchSharingPage.tsx'

/** Only mounted while visible; listing history never resumes an old transaction. */
export function WorkbenchLayoutSharingPage(props: SettingsPageProps) {
  return props.workbenchDirectory?.completeRequest ? <WorkbenchSharingPage {...props} /> : <LegacyLayoutSharingPage {...props} />
}
function LegacyLayoutSharingPage(props: SettingsPageProps) {
  const browser = props.settingsContext?.mode === 'browser-workbench'
  const complete = props.workbenchDirectory?.completeRequest !== undefined
  const [mode, setMode] = useState<'import' | 'export' | 'history'>(browser ? 'export' : props.openOptions?.shareMode ?? 'export')
  const [workbenchId, setWorkbenchId] = useState(props.settingsContext?.mode === 'browser-workbench' ? props.settingsContext.workbenchId : props.openOptions?.workbenchId ?? props.value?.activeWorkbenchId ?? '')
  const [preview, setPreview] = useState<LayoutPackagePreview>()
  const [history, setHistory] = useState<LayoutImportReceiptV2[]>([])
  const [bindings, setBindings] = useState<Record<string, SessionBindingV1>>({})
  const [imported, setImported] = useState<string>()
  const [copy, setCopy] = useState(false)
  const transaction = useRef(`layout-import-${browserSafeUuid()}`)
  const actions = useSettingsAction()
  const service = props.layoutPackage
  const sessions = props.useSessions(value => value)
  const refreshHistory = () => actions.run('history', async () => { if (!service) throw new Error('布局分享服务暂不可用。'); setHistory(await service.history()) })
  useEffect(() => { if (mode === 'history' && !browser && !complete) void refreshHistory() }, [mode, browser, complete, service])
  const prior = preview && history.find(row => row.archiveSha256 === preview.digest && props.value?.workbenches[row.workbenchId])
  const navigate = (next: typeof mode) => { setMode(next); setPreview(undefined); setImported(undefined); setBindings({}); setCopy(false) }
  return <section className={`${css.page} ${css.sharingPage}`}><header className={css.pageHeader}><div><h3>导入与分享</h3><p>{complete ? '完整工作台包迁移文件、对话和任务关系；布局参考包用于分享界面安排。' : '分享布局和内页引用。接收方重新绑定自己的资源；不会安装或启用扩展。'}</p></div></header>
    {!browser && !complete ? <div className={`${css.filters} ${css.flowFilters}`}>{[['export', '分享一个工作台'], ['import', '接收一个工作台'], ['history', '导入记录']].map(([id, label]) => <button key={id} aria-pressed={mode === id} onClick={() => navigate(id as typeof mode)}>{label}</button>)}</div> : null}
    {!browser && (complete || mode === 'export') ? <label className={`${css.form} ${css.controlCard}`}>选择工作台<select aria-label="分享来源工作台" value={workbenchId} onChange={event => { setWorkbenchId(event.target.value); setPreview(undefined) }}>{!Object.keys(props.value?.workbenches ?? {}).length ? <option value="">接收第一个工作台</option> : null}{Object.values(props.value?.workbenches ?? {}).map(row => <option key={row.workbenchId} value={row.workbenchId}>{row.name}</option>)}</select></label> : null}
    {complete ? <WorkbenchCompletePackagePanel workbenchId={workbenchId} browser={browser} disabled={!settingsTargetWritable(props.settingsContext ?? DESKTOP_SETTINGS_CONTEXT, workbenchId, props.windowController)} {...(props.workbenchDirectory?.pickParentDirectory ? { pickParentDirectory: props.workbenchDirectory.pickParentDirectory } : {})} /> : null}
    {!service && !complete ? <p role="alert">此宿主未接入布局分享服务，请更新 Core。</p> : null}
    {mode === 'export' || complete ? <>
      {complete ? <header className={css.sectionHeader}><div><h4>布局参考包</h4><p>仅包含区域安排和内页引用。迁移项目文件及对话历史请使用上方完整包。</p></div></header> : null}
      <ol className={`${css.steps} ${css.flowSteps}`}><li>刷新并保存当前布局</li><li>核对全部内页及资源要求</li><li>下载布局分享包</li></ol>
      <button className={css.primaryButton} disabled={!service || !workbenchId || actions.states.preview?.busy || !settingsTargetWritable(props.settingsContext ?? DESKTOP_SETTINGS_CONTEXT, workbenchId, props.windowController)} onClick={() => void actions.run('preview', async () => { setPreview(await service!.prepareExport(workbenchId)) })}>保存布局并预览分享内容</button>{actions.feedback('preview')}
      {!settingsTargetWritable(props.settingsContext ?? DESKTOP_SETTINGS_CONTEXT, workbenchId, props.windowController) ? <p role="status">这个工作台正在浏览器运行，请先收回再分享。</p> : null}
    </> : null}
    {mode === 'import' && !browser && !complete ? <>
      <ol className={css.steps}><li>选择并校验布局分享包</li><li>预览内页及缺少的扩展</li><li>重新绑定或稍后处理</li><li>新增为未打开的工作台</li></ol>
      <label className={`${css.form} ${css.controlCard}`}>布局分享包文件<input type="file" accept=".zip,.wbpkg" disabled={!service || actions.states.inspect?.busy} onChange={event => {
        const file = event.target.files?.[0]; if (!file) return
        setPreview(undefined); setImported(undefined); setCopy(false); setBindings({}); transaction.current = `layout-import-${browserSafeUuid()}`
        void actions.run('inspect', async () => { if (file.size > 32 * 1024 * 1024) throw new Error('分享包超过 32MB 限制。'); const checked = await service!.inspect(new Uint8Array(await file.arrayBuffer())); setHistory(await service!.history()); setPreview(checked) })
      }} /></label>{actions.feedback('inspect')}
      <p className={css.notice}>普通分享向导不接受原始诊断 JSON；旧布局包按原格式校验，不运行内嵌插件代码。</p>
    </> : null}
    {preview ? <div className={`${css.detail} ${css.sharePreview}`}>
      <h4>{preview.layout.name}</h4><p>{preview.layout.description}</p><p>{preview.layout.tags.join(' · ')}</p><div className={css.largePreview}><LayoutDiagram node={preview.layout.document.root} editors={props.editors} /></div>
      <p>{areasOf(preview.layout.document.root).length} 个区域 · {areasOf(preview.layout.document.root).reduce((sum, area) => sum + area.moduleHistory.length, 0)} 个内页 · 保留顺序和当前内页</p>
      <h4>模块与兼容条件</h4>{preview.layout.modules.map(module => { const editor = props.editors.find(editor => editor.id === module.editorId && editor.scope === module.scope)
        return <div className={css.row} key={`${module.scope}:${module.editorId}`}><div><strong>{editor?.label ?? module.editorId}</strong><p>{module.packageName ?? '提供包身份尚未核实'} · {module.version ?? '版本尚未检查'} · {editor ? '本机可用' : '未安装、未允许或不兼容：保留占位引用'}</p>{module.digest ? <small>制品摘要 {module.digest}</small> : null}</div></div>
      })}
      <div className={css.notice}><strong>资源重绑定要求</strong><p>不包含真实 Session／Workspace、消息、草稿、凭据、终端进程、运行任务、窗口状态和全局偏好。</p><p>缺少扩展时，请由接收方在 DSH 插件管理中确认安装，并允许在 Workbench 使用。没有可迁移处理器的内页只保留引用。</p></div>
      {preview.warnings.length ? <details open><summary>{preview.warnings.length} 条迁移说明</summary><ul>{preview.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></details> : null}
      {mode === 'export' || complete ? <div className={css.stickyActions}><button className={css.primaryButton} disabled={actions.states.download?.busy || !service} onClick={() => void actions.run('download', async () => {
        // Re-flush at download so a stale preview never exports an unsaved layout.
        const latest = await service!.prepareExport(workbenchId)
        if (latest.digest !== preview.digest) { setPreview(latest); throw new Error('布局已变化，预览已刷新，请核对后再次下载。') }
        downloadSettingsFile(`${preview.layout.name}-布局分享.zip`, new Uint8Array(await buildLayoutPackage(latest.layout)).buffer, 'application/zip')
      })}>下载布局分享包</button>{actions.feedback('download')}</div> : null}
      {mode === 'import' && !browser && !props.workbenchDirectory?.completeRequest ? <>
        {prior && !copy ? <div className={css.notice}><p>此包已导入为“{props.value?.workbenches[prior.workbenchId]?.name}”。</p><div className={css.noticeActions}><button className={css.primaryButton} onClick={() => void actions.run('open-prior', () => props.workbenchDirectory!.openAndSelect(prior.workbenchId))}>打开已有</button><button className={css.secondaryButton} onClick={() => { setCopy(true); transaction.current = `layout-import-${browserSafeUuid()}` }}>再导入一个副本</button></div>{actions.feedback('open-prior')}</div> : null}
        <h4>选择本机会话，或保留为稍后绑定</h4>{layoutBindingSources(preview.layout).map((source, index) => <label className={css.form} key={source.key}>来源对话 {index + 1}<select aria-label={`来源对话 ${index + 1}`} value={bindings[source.key]?.sessionId ?? ''} onChange={event => { const session = sessions.byId[event.target.value as keyof typeof sessions.byId]; setBindings(current => { const next = { ...current }; if (!session) delete next[source.key]; else { const workspace = props.workspaceList?.getSnapshot().items.find(item => item.sessionIds.some(id => id === session.id)); next[source.key] = { sessionId: session.id, ...(workspace ? { workspaceId: workspace.workspaceId } : {}) } }; return next }) }}><option value="">稍后绑定（不创建对话）</option>{sessions.ids.map(id => sessions.byId[id] ? <option key={id} value={id}>{sessions.byId[id]!.displayTitle}</option> : null)}</select></label>)}
        <div className={css.stickyActions}><button className={css.primaryButton} disabled={!service || actions.states.import?.busy || Boolean(imported) || Boolean(prior && !copy)} onClick={() => void actions.run('import', async () => { const result = await service!.import(preview, transaction.current, bindings); setImported(result.workbenchId) })}>确认新增到未打开</button>{actions.feedback('import')}</div>
        {imported ? <div className={css.notice} role="status"><p>已新增工作台，尚未打开，原有工作台保持当前状态。</p><button className={css.primaryButton} onClick={() => void actions.run('open', () => props.workbenchDirectory!.openAndSelect(imported))}>打开导入的工作台</button>{actions.feedback('open')}</div> : null}
      </> : null}
    </div> : null}
    {mode === 'history' && !browser && !complete ? <><button className={css.secondaryButton} disabled={actions.states.history?.busy} onClick={() => void refreshHistory()}>刷新导入记录</button>{actions.feedback('history')}<div className={`${css.list} ${css.historyList}`}>{history.map(row => <article key={row.transactionId} className={css.row}><div><strong>{row.name}</strong><p>{new Date(row.createdAt).toLocaleString()} · {row.state === 'completed' ? '已完成' : '未完成：仅保留记录，不自动恢复操作'}</p><small>{row.archiveSha256}</small></div><button className={css.secondaryButton} disabled={!props.value?.workbenches[row.workbenchId]} onClick={() => void actions.run(row.transactionId, () => props.workbenchDirectory!.openAndSelect(row.workbenchId))}>打开已有</button>{actions.feedback(row.transactionId)}</article>)}</div>{!history.length ? <div className={css.emptyInline}>暂无新版布局导入记录。旧 Suite 记录保留在历史存储中，不会自动执行。</div> : null}
      <details><summary>完整 DSH 实例搬迁</summary><p>本轮仅提供布局分享。完整实例搬迁依赖 DSH 官方宿主能力，请使用 DSH 官方迁移功能；Workbench 不复制 Profile 或凭据。</p></details>
    </> : null}
  </section>
}
