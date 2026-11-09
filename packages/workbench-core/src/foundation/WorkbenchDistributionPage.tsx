import { useEffect, useRef, useState } from 'react'
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

const labels:Record<WorkbenchPackageModeV4,string>={'layout-only':'布局分享','online-reference':'在线引用','offline-embedded':'离线嵌入'}
const states:Record<DistributionImportStatus['state'],string>={checked:'等待确认',installing:'正在安装', 'restart-required':'请重启 DSH 后继续','awaiting-restore':'等待恢复内页配置',ready:'已完成','needs-input':'安装完成，待绑定本机资源',cancelled:'已取消',failed:'未完成，请查看原因','recovery-required':'需要检查原生插件操作结果'}
export function WorkbenchDistributionPage(props:SettingsPageProps & {distributionPackage:DistributionPackageService}){
  const service=props.distributionPackage
  const [tab,setTab]=useState<'export'|'import'|'history'>(props.openOptions?.shareMode??'export')
  const [kind,setKind]=useState<WorkbenchPackageModeV4>('layout-only')
  const [id,setId]=useState(props.openOptions?.workbenchId??props.value?.activeWorkbenchId??'')
  const [prepared,setPrepared]=useState<Awaited<ReturnType<DistributionPackageService['prepareExport']>>>()
  const [row,setRow]=useState<DistributionImportStatus>()
  const [history,setHistory]=useState<DistributionImportStatus[]>([])
  const [confirmed,setConfirmed]=useState(false)
  const [legacy,setLegacy]=useState(false)
  const [bindings,setBindings]=useState<Record<string,SessionBindingV1>>({})
  const sessions=props.useSessions(value=>value)
  const generation=useRef(0),actions=useSettingsAction({busy:'正在检查分发内容与插件状态…',success:'操作已完成，请核对结果'})
  useEffect(()=>{if(tab==='history')void actions.run('history',async()=>{setHistory(await service.history())})},[tab,service])
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
  const change=(next:typeof tab)=>{generation.current++;setTab(next);setPrepared(undefined);setRow(undefined);setConfirmed(false);setLegacy(false)}
  const importStatus=(value:DistributionImportStatus)=>{setRow(value);setConfirmed(false)}
  const executeImport=async(action:()=>Promise<DistributionImportStatus>)=>{
    try{importStatus(await action())}catch(error){
      if(row){const latest=(await service.history().catch(()=>[])).find(r=>r.transactionId===row.transactionId);if(latest)setRow(latest)}
      throw error
    }
  }
  return <section className={css.page}><header className={css.pageHeader}><div><h3>工作台导入与分发</h3><p>房主导出后发送文件；接收方确认来源、安装和工作台使用授权。模型、会话与工作目录在接收方重新绑定。</p></div></header>
    <div className={css.filters}>{(['export','import','history'] as const).map(t=><button key={t} aria-pressed={tab===t} onClick={()=>change(t)}>{t==='export'?'导出工作台':t==='import'?'导入工作台':'导入记录'}</button>)}</div>
    {tab==='export'?<>
      <label className={css.form}>工作台<select aria-label="分享来源工作台" value={id} onChange={e=>{setId(e.target.value);setPrepared(undefined);generation.current++}}>{Object.values(props.value?.workbenches??{}).map(w=><option key={w.workbenchId} value={w.workbenchId}>{w.name}</option>)}</select></label>
      <label className={css.form}>导出模式<select aria-label="导出模式" value={kind} onChange={e=>{setKind(e.target.value as WorkbenchPackageModeV4);setPrepared(undefined);generation.current++}}>{Object.entries(labels).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label>
      <p>{kind==='layout-only'?'只分享布局与可迁移配置；接收方自行安装扩展。':kind==='online-reference'?'签名锁定扩展版本和内容；接收方需要访问对应 Registry。':'签名包包含自包含扩展安装制品；缺少依赖或配置迁移能力时阻止导出。'}</p>
      <button className={css.primaryButton} disabled={!id||actions.states.prepare?.busy} onClick={()=>void actions.run('prepare',async()=>{const gen=generation.current;const next=await service.prepareExport(id,kind,kind!=='layout-only');if(gen===generation.current)setPrepared(next)})}>{kind==='layout-only'?'保存布局并生成分享包':'自动准备依赖并生成分享包'}</button>{actions.feedback('prepare')}
      {kind!=='layout-only'?<p>优先复用已验证制品；缺少时由 Host 准备并校验一次，完成后直接生成包。</p>:null}
      {prepared?<div className={css.detail}><h4>{prepared.preview.layout.name} · {labels[kind]}</h4><LayoutDiagram node={prepared.preview.layout.document.root} editors={props.editors}/><p>{areasOf(prepared.preview.layout.document.root).reduce((n,a)=>n+a.moduleHistory.length,0)} 个内页，保留全部标签</p>
        {prepared.preview.manifest.publisher?<p>发布者指纹：{prepared.preview.manifest.publisher.keyId}</p>:null}
        {prepared.preview.manifest.dependencies.map(d=><p key={d.packageName}>{d.packageName} {d.version} · {d.host?'包含 Host 代码':'客户端扩展'} · 权限：{d.permissions.join('、')||'无额外声明'}</p>)}
        {prepared.preview.layout.warnings.map((w,i)=><p role="status" key={i}>{w}</p>)}
        <button className={css.primaryButton} onClick={()=>downloadSettingsFile(prepared.preview.layout.name+'-'+labels[kind]+'-'+WORKBENCH_CORE_VERSION+'.wbpkg',new Uint8Array(prepared.bytes).buffer,'application/zip')}>下载已核对的工作台包</button><p>下载的是此次预览快照；继续编辑后请重新检查生成。</p></div>:null}
    </>:null}
    {tab==='import'?<>
      <label className={css.form}>工作台包<input aria-label="工作台包文件" type="file" accept=".zip,.wbpkg" disabled={actions.states.inspect?.busy} onChange={e=>{const f=e.target.files?.[0];if(!f)return;setRow(undefined);setConfirmed(false);setBindings({});const gen=++generation.current;void actions.run('inspect',async()=>{if(f.size>128*1024*1024)throw new Error('包超过 128MB 限制。');const bytes=new Uint8Array(await f.arrayBuffer());const next=await (legacy?service.inspectLegacy(bytes):service.inspect(bytes));if(gen===generation.current)setRow(next)})}}/></label>{actions.feedback('inspect')}
      {row?<div className={css.detail}><h4>{row.name} · {labels[row.mode]}</h4><p role="status">{states[row.state]}</p><p>包摘要：{row.archiveSha256}</p>{row.keyId?<p>发布者指纹：{row.keyId}。首次接收请与房主核对；签名不代表代码安全保证。</p>:null}
        {row.dependencies.map(d=><div className={css.row} key={d.packageName}><div><strong>{d.packageName} {d.version}</strong><p>{row.installed.includes(d.packageName)?'已安装':row.reused.includes(d.packageName)||row.plannedReuse?.includes(d.packageName)?'复用现有插件':'安装或核验插件'} · {d.host?'包含可在本机执行的 Host 代码':'客户端运行代码'}</p><p>声明权限：{d.permissions.join('、')||'无额外声明'}。Workbench 授权不构成执行沙箱。</p></div></div>)}
        {row.layout?<LayoutDiagram node={row.layout.document.root} editors={props.editors}/>:null}
        {row.layout?.warnings.map((warning,index)=><p role="status" key={index}>{warning}</p>)}
        {row.layout?layoutBindingSources(row.layout).map((source,index)=><label className={css.form} key={source.key}>来源对话 {index+1}<select aria-label={'来源对话 '+(index+1)} value={bindings[source.key]?.sessionId??''} onChange={event=>{const session=sessions.byId[event.target.value as keyof typeof sessions.byId];setBindings(current=>{const next={...current};if(session)next[source.key]={sessionId:session.id};else delete next[source.key];return next})}}><option value="">稍后绑定（不创建会话）</option>{sessions.ids.map(id=>sessions.byId[id]?<option key={id} value={id}>{sessions.byId[id]!.displayTitle}</option>:null)}</select></label>):null}
        {row.pendingPageIds?.length?<><p role="status">{row.pendingPageIds.length} 个内页配置已保留在 Host，尚未执行。补齐并授权精确匹配的扩展后恢复。</p><button disabled={actions.states.restore?.busy} onClick={()=>void actions.run('restore',()=>executeImport(()=>service.restorePending(row)))}>恢复待处理配置</button>{actions.feedback('restore')}</>:null}
        {row.blockers.map((b,i)=><p role="alert" key={i}>{b}</p>)}
        {row.state==='checked'?<><label><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>我已核对来源与指纹，同意本次扩展安装、启用及 Workbench 使用授权</label><button className={css.primaryButton} disabled={!confirmed||!!row.blockers.length||actions.states.commit?.busy} onClick={()=>void actions.run('commit',async()=>{await executeImport(()=>service.confirm(row,bindings))})}>确认导入</button>{actions.feedback('commit')}</>:null}
        {['installing','restart-required','awaiting-restore','failed'].includes(row.state)?<><button disabled={importing} onClick={()=>void actions.run('resume',async()=>{await executeImport(()=>service.resume(row.transactionId,bindings))})}>检查并继续此事务</button>{actions.feedback('resume')}</>:null}
        {!['ready','needs-input','cancelled'].includes(row.state)?<><button disabled={actions.states.cancel?.busy} onClick={()=>void actions.run('cancel',async()=>{await executeImport(()=>service.cancel(row.transactionId))})}>取消并回退本次新增内容</button>{actions.feedback('cancel')}</>:null}
        {['ready','needs-input'].includes(row.state)?<><p>工作台已保存为未打开状态；不会自动创建会话。</p><button onClick={()=>void actions.run('open',()=>props.onOpenWorkbench?props.onOpenWorkbench(row.workbenchId):props.workbenchDirectory!.openAndSelect(row.workbenchId))}>打开导入的工作台</button>{actions.feedback('open')}</>:null}
      </div>:null}
    </>:null}
    {tab==='history'?<><button onClick={()=>void actions.run('history',async()=>{setHistory(await service.history())})}>刷新记录</button>{actions.feedback('history')}{history.map(h=><article key={h.transactionId} className={css.row}><div><strong>{h.name}</strong><p>{labels[h.mode]} · {states[h.state]} · {new Date(h.createdAt).toLocaleString()}</p><small>{h.archiveSha256}</small></div><button onClick={()=>{setTab('import');importStatus(h)}}>查看与继续</button></article>)}{!history.length?<p>暂无新版导入记录。</p>:null}</>:null}
  </section>
}
