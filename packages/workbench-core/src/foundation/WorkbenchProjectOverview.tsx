import { useEffect, useState } from 'react'
import {
  Button,
  IconChecklistOutlineMedium,
  IconDatabaseOutlineMedium,
  IconEditOutlineMedium,
  IconFolderOpenOutlineMedium,
  IconListPenOutlineMedium,
  IconNewChatOutlineMedium,
  IconPlayOutlineMedium,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { WorkbenchDirectory } from './frame-settings-adapter.ts'
import type { WorkbenchProjectV1, WorkbenchSessionEntryV1 } from '../workbench-directory-contract.ts'
import type { BayAgentControllerV1, BayAgentControllerSnapshotV1 } from './workbench-bay-agent-work.ts'
import type { WorkbenchMemoryEntry } from '../workbench-memory-contract.ts'
import { WorkbenchMemoryDialog } from './WorkbenchMemoryDialog.tsx'
import { renderAreaContextMarkdown } from './workbench-context.ts'
import css from './WorkbenchProjectOverview.module.css'

const statusLabels: Record<string, string> = { proposed: '待开始', queued: '排队中', running: '执行中', waiting: '等待继续', needs_input: '等待答复', ready: '待验收', blocked: '受阻', failed: '失败', completed: '已完成', stopped: '已停止' }

/** Project data is independent of this Area; opening the overview never starts a conversation. */
export function WorkbenchProjectOverview({ project, directory, workbenchId, tasks, controller, onOpenSession, onAddPage, onEditBackground, writable = true }: {
  project: WorkbenchProjectV1; directory: WorkbenchDirectory; workbenchId: string
  tasks?: BayAgentControllerSnapshotV1 | undefined; controller?: BayAgentControllerV1 | undefined
  onOpenSession(session: WorkbenchSessionEntryV1): void; onAddPage(): void
  onEditBackground?: (() => void) | undefined; writable?: boolean
}) {
  const [memory, setMemory] = useState(false), [memoryCount, setMemoryCount] = useState<number>(), [memoryError, setMemoryError] = useState(false)
  const [error, setError] = useState(''), [busy, setBusy] = useState<string>()
  const sessions = directory.getProjectSessions?.(workbenchId, project.projectId) ?? []
  const items = tasks?.workItems.filter(item => item.projectId === project.projectId) ?? []
  const backgroundFacts = [
    { label: '约束', values: project.context?.human.constraints ?? [] },
    { label: '输入与依赖', values: project.context?.human.inputs ?? [] },
    { label: '成功标准', values: project.context?.human.successCriteria ?? [] },
  ].filter(fact => fact.values.length > 0)
  const objective = project.context?.human.objective ?? ''
  const hasBackground = Boolean(project.context?.human.objective || project.context?.agent.summary || backgroundFacts.length)
  const memoryCountLabel = memoryCount === undefined ? (memoryError ? '暂不可用' : '读取中') : memoryCount >= 100 ? '100+ 条' : `${memoryCount} 条`
  useEffect(() => {
    if (!directory.memoryRequest) return
    let live = true
    setMemoryError(false)
    void directory.memoryRequest<WorkbenchMemoryEntry[]>({ action: 'memory-list', workbenchId, projectId: project.projectId })
      .then(rows => { if (live) setMemoryCount(rows.length) })
      .catch(() => { if (live) setMemoryError(true) })
    return () => { live = false }
  }, [directory, workbenchId, project.projectId])
  const resume = async (id: string) => { setBusy(id); setError(''); try { await controller?.recoverWorkItem(id) } catch (reason) { setError(String(reason)) } finally { setBusy(undefined) } }
  return <section className={css.overview} aria-label="项目概览">
    <header className={css.header}>
      <div className={css.headerIdentity}>
        <span className={css.icon}><IconFolderOpenOutlineMedium size={25} /></span>
        <div className={css.headerCopy}>
          <span className={css.eyebrow}>项目概览</span>
          <h2>{project.name}</h2>
          <p className={css.path}><IconFolderOpenOutlineMedium size={13} />{project.relativePath}</p>
        </div>
      </div>
      <Button variant="primary" disabled={!writable} icon={<IconNewChatOutlineMedium size={16} />} onClick={onAddPage}>打开内页</Button>
    </header>
    <p className={css.hint}>项目文件夹承载背景、记忆、对话和任务。关闭区域不会删除项目，之后可以从其他区域继续使用。</p>
    <div className={css.summary} aria-label="项目摘要">
      <div><span>已有对话</span><strong>{sessions.length}</strong></div>
      <div><span>项目任务</span><strong>{items.length}</strong></div>
      <div><span>项目背景</span><strong>{hasBackground ? '已设置' : '未设置'}</strong></div>
      <div><span>项目记忆</span><strong>{memoryCountLabel}</strong></div>
    </div>

    <div className={css.sectionGrid}>
      <section className={css.section}>
        <div className={css.sectionHeader}>
          <div className={css.sectionTitle}><span className={css.sectionIcon}><IconListPenOutlineMedium size={17} /></span><div><h3>项目背景</h3><p>目标和协作约束</p></div></div>
          <Button size="sm" variant="outline" disabled={!writable || !onEditBackground} icon={<IconEditOutlineMedium size={14} />} onClick={onEditBackground}>编辑</Button>
        </div>
        <p className={objective ? css.background : css.emptyState}>{objective || (backgroundFacts.length ? '项目目标尚未设置。' : '还没有填写项目背景。添加目标后，Bay Agent 和项目会话都能在正确的上下文中工作。')}</p>
        {backgroundFacts.length ? <dl className={css.contextFacts}>{backgroundFacts.map(fact => <div key={fact.label}><dt>{fact.label}</dt><dd>{fact.values.join(' · ')}</dd></div>)}</dl> : null}
        {project.context?.agent.summary ? <div className={css.agentNote}><span>Bay Agent 摘要</span><p>{project.context.agent.summary}</p></div> : null}
        {project.contextCandidates?.length ? <details className={css.legacyContext}><summary>{project.contextCandidates.length} 份旧背景待整理</summary>{project.contextCandidates.map(row => <article key={row.areaId}><small>来源区域：{row.areaId}</small><pre>{renderAreaContextMarkdown(row.context)}</pre></article>)}</details> : null}
      </section>

      <section className={css.section}>
        <div className={css.sectionHeader}>
          <div className={css.sectionTitle}><span className={css.sectionIcon}><IconDatabaseOutlineMedium size={17} /></span><div><h3>项目记忆</h3><p>事实、决策与阶段进展</p></div></div>
          <Button size="sm" variant="outline" disabled={!writable || !directory.memoryRequest} icon={<IconDatabaseOutlineMedium size={14} />} onClick={() => setMemory(true)}>管理</Button>
        </div>
        <p className={css.memoryDescription}>记忆保存在项目文件夹中，与展示这个项目的区域无关。每次修改都会保留来源和修订记录，并随完整工作台包导出。</p>
        <div className={css.sectionMeta}>{memoryCount === undefined ? (memoryError ? '当前无法读取记忆列表' : '正在读取记忆列表…') : memoryCount >= 100 ? '当前项目有 100 条以上记忆' : `当前项目有 ${memoryCount} 条记忆`}</div>
      </section>
    </div>

    <section className={css.section}>
      <div className={css.sectionHeader}>
        <div className={css.sectionTitle}><span className={css.sectionIcon}><IconNewChatOutlineMedium size={17} /></span><div><h3>已有对话 <span className={css.count}>{sessions.length}</span></h3><p>手动打开历史会话，不会自动恢复全部内页</p></div></div>
        <Button size="sm" disabled={!writable} icon={<IconNewChatOutlineMedium size={14} />} onClick={onAddPage}>新建对话</Button>
      </div>
      {sessions.length ? <ul className={css.list}>{sessions.map(session => <li key={session.sessionKey}><div className={css.listCopy}><strong>{session.title || '对话'}</strong><small>{session.agentPreset}{session.role === 'worker' ? ' · 任务对话' : ''}</small></div><Button size="sm" variant="outline" disabled={!writable || !session.sessionId} onClick={() => onOpenSession(session)}>打开</Button></li>)}</ul> : <p className={css.emptyState}>还没有对话，从“新建对话”开始。</p>}
    </section>
    <section className={css.section}>
      <div className={css.sectionHeader}>
        <div className={css.sectionTitle}><span className={css.sectionIcon}><IconChecklistOutlineMedium size={17} /></span><div><h3>项目任务 <span className={css.count}>{items.length}</span></h3><p>持续任务和最近一次执行</p></div></div>
      </div>
      {items.length ? <ul className={css.list}>{items.map(item => <li key={item.workItemId}><div className={css.listCopy}><strong>{item.objective}</strong><small className={css.status}>{statusLabels[item.status] ?? item.status}</small></div>{!['running', 'queued', 'completed', 'ready'].includes(item.status) && controller ? <Button size="sm" variant="outline" disabled={!writable || !!busy} icon={<IconPlayOutlineMedium size={14} />} onClick={() => { void resume(item.workItemId) }}>{busy === item.workItemId ? '继续中…' : '继续任务'}</Button> : null}</li>)}</ul> : <p className={css.emptyState}>{tasks ? '还没有项目任务。' : '任务服务尚未连接，已有记录不会被删除。'}</p>}
    </section>
    {error ? <p className={css.error} role="alert">{error}</p> : null}
    {memory ? <WorkbenchMemoryDialog directory={directory} workbenchId={workbenchId} projectId={project.projectId} onClose={() => setMemory(false)} /> : null}
  </section>
}
