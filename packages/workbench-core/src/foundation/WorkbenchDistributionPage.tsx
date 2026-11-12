import { useEffect, useRef, useState } from 'react'
import { IconCordisPluginOutlineMedium, IconDownloadOutlineMedium, IconFolderOpenOutlineMedium, IconClockOutlineMedium, IconRefreshOutlineMedium, IconArchiveOutlineMedium } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SettingsPageProps } from './WorkbenchSettingsPages.tsx'
import { downloadSettingsFile, LayoutDiagram, useSettingsAction } from './WorkbenchSettingsPages.tsx'
import type { DistributionImportStatus } from '../distribution-contract.ts'
import type { WorkbenchPackageModeV4 } from './workbench-package-v4.ts'
import type { DistributionPackageService } from './distribution-package-service.ts'
import { areasOf } from './document-v3.ts'
import { layoutBindingSources } from './workbench-layout-package.ts'
import type {SessionBindingV1} from './model.ts'
import { WORKBENCH_CORE_VERSION } from '../release-compatibility.ts'
import css from './WorkbenchSettings.module.css'
import { WorkbenchHomePreview } from './WorkbenchHomePreview.tsx'
import { WorkbenchSharingSummary } from './WorkbenchSharingSummary.tsx'
import { DESKTOP_SETTINGS_CONTEXT, settingsTargetWritable } from './settings-context.ts'
import sharing from './WorkbenchSharing.module.css'
import { suggestedWorkbenchFolder, workbenchFolderNameError, workbenchTargetPath } from '../workbench-folder-name.ts'

type PreparedExport = Awaited<ReturnType<DistributionPackageService['prepareExport']>>

function DistributionExportPreview({ prepared, kind, editors }: {
  prepared: PreparedExport
  kind: WorkbenchPackageModeV4
  editors: SettingsPageProps['editors']
}) {
  const layout = prepared.preview.layout
  const areas = areasOf(layout.document.root)
  const pageCount = areas.reduce((total, area) => total + area.moduleHistory.length, 0)
  const dependencies = prepared.preview.manifest.dependencies
  return <div className={`${css.detail} ${css.distributionPreview}`}>
    <header className={css.distributionPreviewHeader}>
      <div className={css.distributionPreviewIdentity}>
        <span className={css.detailEyebrow}>模板包预览</span>
        <h4>{layout.name}</h4>
        <p>{layout.description || '工作台布局、内页与兼容信息已准备完成。'}</p>
        {layout.tags.length ? <div className={css.detailBadges}>{layout.tags.slice(0, 4).map(tag => <span key={tag}>{tag}</span>)}</div> : null}
      </div>
      <span className={css.statusBadge} data-status={kind === 'layout-only' ? undefined : 'browser'}>{labels[kind]}</span>
    </header>

    <section className={css.distributionPreviewSection}>
      <div className={css.sectionHeader}><div><h4>布局概览</h4><p>接收方将按此结构恢复区域与内页顺序。</p></div><span className={css.sectionCount}>{areas.length} 个区域</span></div>
      <div className={css.distributionLayoutCanvas}><WorkbenchHomePreview node={layout.document.root} editors={editors} /></div>
      <div className={css.previewSummary}><span>{areas.length} 个区域</span><span>{pageCount} 个内页</span><span>保留全部标签</span></div>
    </section>

    <section className={css.distributionPreviewSection}>
      <div className={css.sectionHeader}><div><h4>扩展与兼容</h4><p>这些信息会随模板包一起校验，接收方可在导入前确认。</p></div><span className={css.sectionCount}>{dependencies.length} 项</span></div>
      {prepared.preview.manifest.publisher ? <div className={css.distributionPublisher}><span>发布者指纹</span><code>{prepared.preview.manifest.publisher.keyId}</code></div> : null}
      <div className={css.distributionDependencyList}>
        {dependencies.map(dependency => <div className={css.distributionDependency} key={dependency.packageName}>
          <span className={css.distributionDependencyIcon} aria-hidden="true"><IconCordisPluginOutlineMedium size={17} /></span>
          <div><strong>{dependency.packageName} <small>{dependency.version}</small></strong><p>{dependency.host ? '包含 Host 代码' : '客户端扩展'} · 权限：{dependency.permissions.join('、') || '无额外声明'}</p></div>
        </div>)}
        {!dependencies.length ? <div className={css.emptyInline}>当前模板包不包含额外扩展。</div> : null}
      </div>
    </section>

    {layout.warnings.length ? <details className={css.distributionWarnings} open><summary>{layout.warnings.length} 条迁移说明</summary><ul>{layout.warnings.map((warning, index) => <li role="status" key={index}>{warning}</li>)}</ul></details> : null}
    <div className={css.stickyActions}><button className={css.primaryButton} onClick={() => downloadSettingsFile(layout.name + '-' + labels[kind] + '-' + WORKBENCH_CORE_VERSION + '.wbpkg', new Uint8Array(prepared.bytes).buffer, 'application/zip')}>下载已核对的模板包</button><p>下载的是此次预览快照；继续编辑后请重新检查生成。</p></div>
  </div>
}

const labels:Record<WorkbenchPackageModeV4,string>={'layout-only':'接收方自行准备扩展','online-reference':'联网获取指定扩展','offline-embedded':'随包携带扩展'}
const states:Record<DistributionImportStatus['state'],string>={checked:'等待确认',installing:'正在安装', 'restart-required':'请重启 DSH 后继续','awaiting-restore':'等待恢复内页配置',ready:'已完成','needs-input':'已创建，部分内页待配置',cancelled:'已取消',failed:'未完成，请查看原因','recovery-required':'需要检查原生插件操作结果'}
type DistributionViewMode = 'export' | 'import' | 'history'
export function WorkbenchDistributionPage(props:SettingsPageProps & {distributionPackage:DistributionPackageService; embedded?: boolean; active?: boolean; viewMode?: DistributionViewMode; onViewModeChange?(mode: DistributionViewMode): void; selectedWorkbenchId?: string; onWorkbenchChange?(id: string): void; unifiedPicker?: boolean; importSelection?: { id: number; file: File } | undefined; onImportBusyChange?(busy: boolean): void}){
  const service=props.distributionPackage
  const [localTab,setLocalTab]=useState<DistributionViewMode>(props.openOptions?.shareMode??'export')
  const tab=props.viewMode??localTab
  const setTab=(next: DistributionViewMode)=>{setLocalTab(next);props.onViewModeChange?.(next)}
  const [kind,setKind]=useState<WorkbenchPackageModeV4>('layout-only')
  const [includeBackground, setIncludeBackground] = useState(false)
  const [parentPath, setParentPath] = useState(''), [folderName, setFolderName] = useState('')
  const folderRequired = !!props.workbenchDirectory?.completeRequest
  const handledSelection = useRef<number>(), importGeneration = useRef(0)
  const [localId,setLocalId]=useState(props.openOptions?.workbenchId??props.value?.activeWorkbenchId??'')
  const id=props.selectedWorkbenchId??localId
  const setId=(next:string)=>{setLocalId(next);props.onWorkbenchChange?.(next)}
  const writable=settingsTargetWritable(props.settingsContext??DESKTOP_SETTINGS_CONTEXT,id,props.windowController)
  const [prepared,setPrepared]=useState<Awaited<ReturnType<DistributionPackageService['prepareExport']>>>()
  const [row,setRow]=useState<DistributionImportStatus>()
  const [history,setHistory]=useState<DistributionImportStatus[]>([])
  const [confirmed,setConfirmed]=useState(false)
  const [bindings,setBindings]=useState<Record<string,SessionBindingV1>>({})
  const sessions=props.useSessions(value=>value)
  const generation=useRef(0),actions=useSettingsAction({busy:'正在检查分发内容与插件状态…',success:'操作已完成，请核对结果'})
  useEffect(()=>{if(tab==='history' && props.active !== false)void actions.run('history',async()=>{setHistory(await service.history())})},[tab,service,props.active])
  useEffect(()=>{generation.current++;setPrepared(undefined)},[id,tab])
  const importing=!!(actions.states.commit?.busy||actions.states.resume?.busy)
  useEffect(()=>{
    if(!importing||!row)return
    let disposed=false
    const timer=setInterval(()=>{void service.history().then(rows=>{
      const current=rows.find(r=>r.transactionId===row.transactionId)
      if(!disposed&&current)setRow(current)
    }).catch(()=>{})},1000)
    return()=>{disposed=true;clearInterval(timer)}
  },[importing,row?.transactionId,service])
  const change=(next:typeof tab)=>{generation.current++;setTab(next);setPrepared(undefined);setRow(undefined);setConfirmed(false)}
  const importStatus=(value:DistributionImportStatus)=>{setRow(value);setConfirmed(false)}
  const executeImport=async(action:()=>Promise<DistributionImportStatus>)=>{
    try{importStatus(await action())}catch(error){
      if(row){const latest=(await service.history().catch(()=>[])).find(r=>r.transactionId===row.transactionId);if(latest)setRow(latest)}
      throw error
    }
  }
  const busy = Object.values(actions.states).some(state => state.busy)
  useEffect(() => { props.onImportBusyChange?.(busy) }, [busy, props.onImportBusyChange])
  const receive = (file: File) => {
    setRow(undefined); setConfirmed(false); setBindings({}); setParentPath(''); setFolderName('')
    const gen = ++importGeneration.current
    void actions.run('inspect', async () => {
      if (file.size > 128 * 1024 * 1024) throw new Error('模板包超过 128 MB 限制。')
      const next = await service.inspect(new Uint8Array(await file.arrayBuffer()))
      if (gen === importGeneration.current) { setRow(next); setFolderName(suggestedWorkbenchFolder(next.name)) }
    })
  }
  useEffect(() => {
    if (!props.importSelection || handledSelection.current === props.importSelection.id) return
    handledSelection.current = props.importSelection.id; receive(props.importSelection.file)
  }, [props.importSelection])
  const record=props.value?.workbenches[id]
  return <section className={sharing.page}>
    {!props.embedded ? <><header className={sharing.header}><span className={sharing.headerIcon}><IconCordisPluginOutlineMedium size={23}/></span><div><h2>工作台模板包</h2><p>分享区域布局、内页与可迁移配置，接收方使用自己的项目和会话。</p></div></header>
      <nav className={sharing.tabs} aria-label="分享操作">{(['export','import','history'] as const).map(t=><button key={t} aria-pressed={tab===t} onClick={()=>change(t)}>{t==='export'?<IconDownloadOutlineMedium size={16}/>:t==='import'?<IconFolderOpenOutlineMedium size={16}/>:<IconClockOutlineMedium size={16}/>} {t==='export'?'导出工作台':t==='import'?'导入工作台':'导入记录'}</button>)}</nav></>:null}
    {tab==='export'?<>
      <div className={sharing.workspace}><section className={sharing.formPanel}>
        <div className={sharing.formIntro}><h3>导出工作台模板</h3><p>分享区域安排、内页和可迁移配置。项目文件、对话、记忆和任务进度使用完整工作台包迁移。</p></div>
        <label className={sharing.field}>工作台<select aria-label="分享来源工作台" value={record?id:''} onChange={e=>{setId(e.target.value);setPrepared(undefined);generation.current++}}><option value="" disabled>选择工作台</option>{Object.values(props.value?.workbenches??{}).map(w=><option key={w.workbenchId} value={w.workbenchId}>{w.name}</option>)}</select></label>
        <label className={sharing.field}>扩展交付方式<select aria-label="扩展交付方式" value={kind} onChange={e=>{setKind(e.target.value as WorkbenchPackageModeV4);setPrepared(undefined);generation.current++}}>{Object.entries(labels).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label>
        <p className={sharing.hint}>{kind==='layout-only'?'只分享布局与可迁移配置；接收方自行安装扩展。':kind==='online-reference'?'锁定扩展版本和内容；接收方需要连接对应的扩展仓库。':'包含可分发的扩展安装制品；生成前会检查依赖与配置迁移能力。'}</p>
        <label><input type="checkbox" checked={includeBackground} onChange={event => { setIncludeBackground(event.target.checked); setPrepared(undefined); generation.current++ }} />包含工作台背景说明</label>
        <p className={sharing.hint}>只携带手动填写的工作台背景；模型选择、任务进度及本机会话绑定不会进入模板。</p>
        <div className={sharing.actionBar}><button className={css.primaryButton} disabled={!record||!writable||actions.states.prepare?.busy} onClick={()=>void actions.run('prepare',async()=>{const gen=generation.current;const next=await service.prepareExport(id,kind,kind!=='layout-only',includeBackground);if(gen===generation.current)setPrepared(next)})}><IconArchiveOutlineMedium size={16}/>{kind==='layout-only'?'保存布局并生成模板包':'准备扩展并生成模板包'}</button></div>
        {actions.feedback('prepare')}{!writable?<p className={sharing.hint}>此工作台正在浏览器中使用，请先收回再导出。</p>:null}
      </section><WorkbenchSharingSummary record={record} editors={props.editors} complete={false}/></div>
      {prepared?<DistributionExportPreview prepared={prepared} kind={kind} editors={props.editors}/>:null}
    </>:null}
    {tab==='import'?<>
      <div className={sharing.workspace}><section className={sharing.formPanel}>
        <div className={sharing.formIntro}><h3>接收工作台模板</h3><p>核对区域布局与扩展清单，在新文件夹中创建工作台，再绑定自己的项目与会话。</p></div>
        {!props.unifiedPicker ? <label className={sharing.upload} data-disabled={actions.states.inspect?.busy||false}><IconCordisPluginOutlineMedium size={30}/><strong>选择工作台模板包</strong><span>点击选择文件</span><small>支持 .wbpkg、.zip · 最大 128 MB</small>
          <input aria-label="工作台包文件" type="file" accept=".zip,.wbpkg" disabled={busy} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) receive(file) }} />
        </label> : null}{actions.feedback('inspect')}
      </section><aside className={sharing.summary}><div className={sharing.summaryTitle}><IconCordisPluginOutlineMedium size={17}/><h3>导入前会检查什么</h3></div><ol className={sharing.steps}><li><div><strong>布局与内页</strong><p>查看区域安排、内页顺序和可迁移配置。</p></div></li><li><div><strong>扩展与依赖</strong><p>核对来源、版本与缺少的扩展，再确认本次安装。</p></div></li><li><div><strong>本机资源</strong><p>选择自己的项目和会话，也可以先导入、稍后绑定。</p></div></li></ol></aside></div>
      {row?<div className={sharing.importDetails}><h4>{row.name} · {labels[row.mode]}</h4><p role="status">{states[row.state]}</p><p>包摘要：{row.archiveSha256}</p>{row.keyId?<p>发布者指纹：{row.keyId}。首次接收请与房主核对；签名不代表代码安全保证。</p>:null}
        {row.targetDisplayPath ? <p>目标文件夹：{row.targetDisplayPath}</p> : null}
        {row.localExtensions?.map(extension => <p key={extension.packageName + '@' + extension.requiredVersion}>{extension.packageName}：包要求 {extension.requiredVersion ?? '未声明版本'} · 检查时本机{extension.installed ? '已安装 ' + (extension.installedVersion ?? '未知版本') : '未安装'}。{extension.installedVersion && extension.requiredVersion && extension.installedVersion !== extension.requiredVersion ? '版本不同，不会自动升级或降级。' : '恢复配置前还会核对扩展内容与授权。'}</p>)}
        {folderRequired && row.state === 'checked' ? <section className={sharing.formPanel} aria-label="模板存放位置">
          <label className={sharing.field}>新工作台文件夹名称<input aria-label="模板文件夹名称" value={folderName} disabled={busy} maxLength={160} onChange={event => setFolderName(event.target.value)} /></label>
          <p className={sharing.hint}>{parentPath ? workbenchTargetPath(parentPath, folderName) : '选择父文件夹后创建新的工作台，不覆盖已有目录。'}</p>
          <button className={css.secondaryButton} disabled={busy || !props.workbenchDirectory?.pickParentDirectory} onClick={() => void actions.run('location', async () => { const path = await props.workbenchDirectory?.pickParentDirectory?.(); if (path) setParentPath(path) })}><IconFolderOpenOutlineMedium size={16} />选择目标父目录</button>{actions.feedback('location')}
          {folderName && workbenchFolderNameError(folderName) ? <p role="alert">{workbenchFolderNameError(folderName)}</p> : null}
        </section> : null}
        {row.dependencies.map(d=><div className={css.row} key={d.packageName}><div><strong>{d.packageName} {d.version}</strong><p>{row.installed.includes(d.packageName)?'已安装':row.reused.includes(d.packageName)||row.plannedReuse?.includes(d.packageName)?'复用现有插件':'安装或核验插件'} · {d.host?'包含可在本机执行的 Host 代码':'客户端运行代码'}</p><p>声明权限：{d.permissions.join('、')||'无额外声明'}。Workbench 授权不构成执行沙箱。</p></div></div>)}
        {row.layout?<LayoutDiagram node={row.layout.document.root} editors={props.editors}/>:null}
        {row.layout?.warnings.map((warning,index)=><p role="status" key={index}>{warning}</p>)}
        {row.layout && !folderRequired ?layoutBindingSources(row.layout).map((source,index)=><label className={css.form} key={source.key}>来源对话 {index+1}<select aria-label={'来源对话 '+(index+1)} value={bindings[source.key]?.sessionId??''} onChange={event=>{const session=sessions.byId[event.target.value as keyof typeof sessions.byId];setBindings(current=>{const next={...current};if(session)next[source.key]={sessionId:session.id};else delete next[source.key];return next})}}><option value="">稍后绑定（不创建会话）</option>{sessions.ids.map(id=>sessions.byId[id]?<option key={id} value={id}>{sessions.byId[id]!.displayTitle}</option>:null)}</select></label>):null}
        {folderRequired ? <p className={sharing.hint}>导入后保持未打开。项目和会话由你重新绑定；缺少扩展的模板内页保留位置和待恢复配置。</p> : null}
        {row.pendingPageIds?.length?<><p role="status">{row.pendingPageIds.length} 个内页配置已保留在 Host，尚未执行。补齐并授权精确匹配的扩展后恢复。</p><button disabled={actions.states.restore?.busy} onClick={()=>void actions.run('restore',()=>executeImport(()=>service.restorePending(row)))}>恢复待处理配置</button>{actions.feedback('restore')}</>:null}
        {row.blockers.map((b,i)=><p role="alert" key={i}>{b}</p>)}
        {row.state==='checked'?<><label><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>{row.dependencies.length ? '我已核对来源、版本和权限，同意本次扩展安装与启用' : '我已核对模板内容，确认创建新的工作台'}</label><button className={css.primaryButton} disabled={!confirmed||busy||folderRequired&&(!parentPath||!!workbenchFolderNameError(folderName))} onClick={()=>void actions.run('commit',async()=>{await executeImport(()=>service.confirm(row,bindings,folderRequired ? { parentPath, folderName } : undefined))})}>{row.blockers.length ? '重新检查并导入' : '确认导入'}</button>{actions.feedback('commit')}</>:null}
        {['installing','restart-required','awaiting-restore','failed'].includes(row.state)?<><button disabled={importing} onClick={()=>void actions.run('resume',async()=>{await executeImport(()=>service.resume(row.transactionId,bindings))})}>检查并继续此事务</button>{actions.feedback('resume')}</>:null}
        {!['ready','needs-input','cancelled'].includes(row.state)?<><button disabled={actions.states.cancel?.busy} onClick={()=>void actions.run('cancel',async()=>{await executeImport(()=>service.cancel(row.transactionId))})}>取消并回退本次新增内容</button>{actions.feedback('cancel')}</>:null}
        {['ready','needs-input'].includes(row.state)?<><p>工作台已保存为未打开状态；不会自动创建会话。</p><button onClick={()=>void actions.run('open',()=>props.onOpenWorkbench?props.onOpenWorkbench(row.workbenchId):props.workbenchDirectory!.openAndSelect(row.workbenchId))}>打开导入的工作台</button>{actions.feedback('open')}</>:null}
      </div>:null}
    </>:null}
    {tab==='history'?<section className={sharing.history} aria-label="工作台模板导入记录"><div className={sharing.sectionHeading}><h3><IconClockOutlineMedium size={17}/>工作台模板导入记录</h3><button onClick={()=>void actions.run('history',async()=>{setHistory(await service.history())})}><IconRefreshOutlineMedium size={16}/>刷新记录</button></div>{actions.feedback('history')}
      {history.map(h=><article key={h.transactionId} className={sharing.job}><span className={sharing.jobIcon}><IconCordisPluginOutlineMedium size={18}/></span><div className={sharing.jobCopy}><strong>{h.name}</strong><p>{labels[h.mode]} · {states[h.state]}</p><div className={sharing.jobMeta}><time>{new Date(h.createdAt).toLocaleString()}</time></div></div><div className={sharing.jobActions}><button className={css.secondaryButton} onClick={()=>{setTab('import');importStatus(h);setParentPath('');setFolderName(suggestedWorkbenchFolder(h.name))}}>查看与继续</button></div></article>)}
      {!history.length?<div className={sharing.empty}><IconClockOutlineMedium size={24}/><p>暂无新版导入记录。</p></div>:null}
    </section>:null}
  </section>
}
