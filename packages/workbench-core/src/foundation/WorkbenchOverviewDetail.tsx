import { useState } from 'react'
import { Button, IconFolderOpenOutlineMedium, IconSettingsOutlineMedium } from '@deepseek-ai/dsh-client-ui-primitives'
import type { WorkbenchRecordV2 } from './persistence.ts'
import type { WorkbenchHomeProps } from './WorkbenchHome.tsx'
import { areasOf } from './document-v3.ts'
import { WorkbenchHomePreview } from './WorkbenchHomePreview.tsx'
import { WorkbenchMemoryDialog } from './WorkbenchMemoryDialog.tsx'
import { WorkbenchContextDialog } from './WorkbenchContextDialog.tsx'
import { renderAreaContextMarkdown } from './workbench-context.ts'
import css from './WorkbenchHome.module.css'

const tabs = { overview: '概览', areas: '项目与区域', context: '背景与记忆', sharing: '分享与迁移' } as const
export function WorkbenchOverviewDetail({ record, directory, editors = [], navigate, onOpen, onReclaim, writable, busy, generateContextDraft }: WorkbenchHomeProps & {
  record: WorkbenchRecordV2; onOpen(): void; onReclaim?(): void; writable: boolean; busy: boolean
}) {
  const [tab, setTab] = useState<keyof typeof tabs>('overview')
  const [areaId, setAreaId] = useState<string>()
  const [context, setContext] = useState<{ areaId?: string; title: string; value: string }>()
  const [memory, setMemory] = useState(false)
  const [notice, setNotice] = useState<string>()
  const visible = areasOf(record.document.root), all = visible
  const projects = Object.values(record.projects ?? {})
  const pages = visible.flatMap(area => area.moduleHistory)
  const sessions = new Set([...Object.values(record.sessionCatalog ?? {}).map(entry => entry.sessionId ?? entry.sessionKey), ...pages.flatMap(page => page.binding ? [page.binding.sessionId] : [])])
  const unavailable = pages.filter(page => !editors.some(editor => editor.id === page.editorId && editor.scope === page.editorScope))
  const background = directory.getWorkbenchContext?.(record.workbenchId)?.human.goal ?? ''
  const manage = () => navigate?.({ section: 'workbenches', workbenchId: record.workbenchId })
  const areaLabel = (id: string) => record.areaMetadata?.[id]?.label || `区域 ${all.findIndex(area => area.areaId === id) + 1}`
  return <section className={css.selectedDetail} aria-label={`${record.name}详情`}>
    <header className={css.selectedHeader}>
      <span className={css.detailEyebrow}>{!writable ? `正在浏览器中使用${record.archivedAt ? ' · 已归档' : ''}` : record.archivedAt ? '已归档' : '工作空间'}</span>
      <div className={css.selectedTitle}><h2>{record.name}</h2>{!writable ? <Button variant="outline" aria-label={`收回“${record.name}”的浏览器控制权`} disabled={busy || !onReclaim} onClick={onReclaim}>收回控制权</Button> : null}<Button variant="primary" disabled={busy || !!record.archivedAt} onClick={onOpen}>{!writable ? '管理浏览器工作台' : '打开工作台'}</Button></div>
      <p>{record.description || '还没有填写工作台简介。'}</p>
      <div className={css.rootPath}><IconFolderOpenOutlineMedium size={15} /><span>{directory.getRootPath?.(record.workbenchId) ?? '目录尚不可用'}</span></div>
      <div className={css.detailCounters}><span>{projects.length} 个项目</span><span>{all.length} 个区域</span><span>{pages.length} 个内页</span><span>{sessions.size} 个独立会话</span><Button size="sm" icon={<IconSettingsOutlineMedium size={14} />} onClick={manage}>工作台资料</Button></div>
    </header>
    <nav className={css.detailTabs} aria-label="工作台详情" role="tablist">{Object.entries(tabs).map(([id, label]) => <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id as keyof typeof tabs)}>{label}</button>)}</nav>
    <div className={css.detailContent} role="tabpanel" aria-label={tabs[tab]}>
      {tab === 'overview' ? <>
        {unavailable.length ? <div className={css.overviewNotice}><strong>{unavailable.length} 个内页需要检查</strong><p>扩展尚未安装、未启用或暂不可用，内页引用已保留。</p><Button size="sm" onClick={() => navigate?.({ section: 'pages', workbenchId: record.workbenchId })}>检查内页扩展</Button></div> : null}
        <div className={css.detailSectionHeader}><h3>工作区布局</h3><span>最近保存的布局 · 点击区域查看</span></div>
        <div className={css.detailPreview}><WorkbenchHomePreview node={record.document.root} editors={editors} onSelectArea={id => { setAreaId(id); setTab('areas') }} /></div>
        <div className={css.overviewLinks}><button onClick={() => setTab('context')}><strong>背景与记忆</strong><span>{background ? '查看工作台目标与专属记忆' : '添加背景，让工作更有方向'}</span></button><button onClick={() => setTab('sharing')}><strong>分享与迁移</strong><span>完整迁移、扩展分发与在线访问</span></button></div>
        <section className={css.detailSection}><h3>Bay Agent</h3><p>{record.bayAgentSession ? '持久主会话已关联。进入工作台后，从浮动工作区顶栏唤出，继续处理任务与待办。' : '主会话状态尚未读取。进入工作台后查看。'}</p><span className={css.detailEyebrow}>模型：{record.workbenchAi?.model ?? '跟随 DSH 默认'}</span></section>
      </> : null}
      {tab === 'areas' ? <><section className={css.detailSection}><h3>项目</h3><p className={css.detailHint}>项目保留背景、记忆和历史，区域负责展示。重新打开项目会创建新区域。</p>{projects.map(project => <article className={css.areaDetail} key={project.projectId}><div className={css.detailSectionHeader}><h3><IconFolderOpenOutlineMedium size={16} /> {project.name}</h3><span>{visible.filter(area => record.areaProjects?.[area.areaId]?.projectId === project.projectId).length} 个区域展示</span></div><p className={css.rootPath}>{project.relativePath}</p><p className={css.detailHint}>{project.context?.human.objective || '项目背景尚未填写'}</p><Button size="sm" disabled={!writable || !directory.openProject} onClick={() => { void directory.openProject!(record.workbenchId, project.projectId).then(onOpen).catch(cause => setNotice(String(cause))) }}>在新区域打开</Button></article>)}{!projects.length ? <p className={css.detailHint}>为区域关联文件夹后，项目会出现在这里。</p> : null}</section><h3>当前区域</h3><p className={css.detailHint}>区域关联项目目录，每个对话内页保留自己的会话。关闭区域不会删除项目文件。</p>{all.map(area => {
        return <article className={css.areaDetail} key={area.areaId} data-selected={areaId === area.areaId || undefined}>
          <div className={css.detailSectionHeader}><h3>{areaLabel(area.areaId)}</h3><span>展示中</span></div>
          <p className={css.rootPath}>{record.areaProjects?.[area.areaId]?.relativePath ?? '待设置项目目录'}</p>
          {area.moduleHistory.length ? <ul className={css.pageList}>{area.moduleHistory.map(page => <li key={page.moduleInstanceId}><span>{page.lastKnownTitle || editors.find(editor => editor.id === page.editorId)?.label || page.editorId}</span><small>{page.binding ? '独立会话来源' : '项目或资源内页'}</small></li>)}</ul> : <p className={css.detailHint}>当前没有打开的内页</p>}
          <Button size="sm" disabled={!writable || !record.areaProjects?.[area.areaId]} onClick={() => setContext({ areaId: area.areaId, title: `${record.projects?.[record.areaProjects?.[area.areaId]?.projectId ?? '']?.name ?? areaLabel(area.areaId)}项目背景`, value: directory.getAreaContext?.(record.workbenchId, area.areaId)?.human.objective ?? '' })}>编辑项目背景</Button>
        </article>
      })}</> : null}
      {tab === 'context' ? <>{Object.keys(record.projectMigration?.unassignedContexts ?? {}).length ? <section className={css.detailSection}><h3>待整理的旧背景</h3><p>这些旧区域的项目来源无法唯一确定，原文已保留。请在确认归属后整理到对应项目背景中。</p>{Object.entries(record.projectMigration!.unassignedContexts).map(([id, value]) => <details key={id}><summary>来源区域：{id}</summary><pre className={css.backgroundText}>{renderAreaContextMarkdown(value)}</pre></details>)}</section> : null}<section className={css.detailSection}><div className={css.detailSectionHeader}><h3>工作台背景</h3><Button size="sm" disabled={!writable} onClick={() => setContext({ title: '工作台背景', value: background })}>编辑背景</Button></div><p className={css.backgroundText}>{background || '背景尚未填写，保持为空。'}</p></section><section className={css.detailSection}><h3>专属记忆</h3><p>查看事实、决策与进展，按来源和修订记录管理。只在打开时读取记忆。</p><Button variant="outline" disabled={!writable || !directory.memoryRequest} onClick={() => setMemory(true)}>查看与管理记忆</Button></section></> : null}
      {tab === 'sharing' ? <><section className={css.detailSection}><h3>工作台包</h3><p>统一使用 .dshbay.zip，提供 template 和 complete 两种快照类型。导入后创建新工作台，不会覆盖或切换当前工作台。</p><Button variant="outline" disabled={!writable} onClick={() => navigate?.({ section: 'sharing', workbenchId: record.workbenchId, shareMode: 'export' })}>打开导出导入</Button></section><section className={css.detailSection}><h3>在线访问</h3><p>浏览器和局域网访客使用本机的目录与服务。进入工作台，从顶栏菜单开启访问或管理连接。</p><Button variant="outline" onClick={onOpen}>{writable ? '进入工作台' : '管理浏览器与协作'}</Button></section></> : null}
      {notice ? <p role="alert">{notice}</p> : null}
    </div>
    {context ? <WorkbenchContextDialog directory={directory} workbenchId={record.workbenchId} {...(context.areaId ? { areaId: context.areaId } : {})} title={context.title} initialValue={context.value} onClose={() => setContext(undefined)} {...(generateContextDraft ? { generateDraft: generateContextDraft } : {})} /> : null}
    {memory ? <WorkbenchMemoryDialog directory={directory} workbenchId={record.workbenchId} onClose={() => setMemory(false)} /> : null}
  </section>
}
