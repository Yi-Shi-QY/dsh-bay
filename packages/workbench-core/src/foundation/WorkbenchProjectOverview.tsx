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
import { useWorkbenchLocale } from './workbench-locale.ts'
import type { WorkbenchMessageKey } from './workbench-messages.ts'
import css from './WorkbenchProjectOverview.module.css'

const statusKeys: Partial<Record<string, WorkbenchMessageKey>> = { proposed: 'task.proposed', queued: 'task.queued', running: 'task.running', waiting: 'task.waiting', needs_input: 'task.needs_input', ready: 'task.ready', blocked: 'task.blocked', failed: 'task.failed', completed: 'task.completed', stopped: 'task.stopped' }

/** Project data is independent of this Area; opening the overview never starts a conversation. */
export function WorkbenchProjectOverview({ project, directory, workbenchId, tasks, controller, onOpenSession, onAddPage, onEditBackground, writable = true }: {
  project: WorkbenchProjectV1; directory: WorkbenchDirectory; workbenchId: string
  tasks?: BayAgentControllerSnapshotV1 | undefined; controller?: BayAgentControllerV1 | undefined
  onOpenSession(session: WorkbenchSessionEntryV1): void; onAddPage(): void
  onEditBackground?: (() => void) | undefined; writable?: boolean
}) {
  const { t } = useWorkbenchLocale()
  const [memory, setMemory] = useState(false), [memoryCount, setMemoryCount] = useState<number>(), [memoryError, setMemoryError] = useState(false)
  const [error, setError] = useState(''), [busy, setBusy] = useState<string>()
  const sessions = directory.getProjectSessions?.(workbenchId, project.projectId) ?? []
  const items = tasks?.workItems.filter(item => item.projectId === project.projectId) ?? []
  const backgroundFacts = [
    { key: 'project.constraints' as const, values: project.context?.human.constraints ?? [] },
    { key: 'project.inputs' as const, values: project.context?.human.inputs ?? [] },
    { key: 'project.successCriteria' as const, values: project.context?.human.successCriteria ?? [] },
  ].filter(fact => fact.values.length > 0)
  const objective = project.context?.human.objective ?? ''
  const hasBackground = Boolean(project.context?.human.objective || project.context?.agent.summary || backgroundFacts.length)
  const memoryCountLabel = memoryCount === undefined ? t(memoryError ? 'project.unavailable' : 'project.reading') : t('project.memoryCount', { count: memoryCount >= 100 ? '100+' : memoryCount })
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
  return <section className={css.overview} aria-label={t('project.overview')}>
    <header className={css.header}>
      <div className={css.headerIdentity}>
        <span className={css.icon}><IconFolderOpenOutlineMedium size={25} /></span>
        <div className={css.headerCopy}>
          <span className={css.eyebrow}>{t('project.overview')}</span>
          <h2>{project.name}</h2>
          <p className={css.path}><IconFolderOpenOutlineMedium size={13} />{project.relativePath}</p>
        </div>
      </div>
      <Button variant="primary" disabled={!writable} icon={<IconNewChatOutlineMedium size={16} />} onClick={onAddPage}>{t('project.openPage')}</Button>
    </header>
    <p className={css.hint}>{t('project.overviewHint')}</p>
    <div className={css.summary} aria-label={t('project.summary')}>
      <div><span>{t('project.conversations')}</span><strong>{sessions.length}</strong></div>
      <div><span>{t('project.tasks')}</span><strong>{items.length}</strong></div>
      <div><span>{t('project.background')}</span><strong>{t(hasBackground ? 'project.configured' : 'project.notConfigured')}</strong></div>
      <div><span>{t('project.memory')}</span><strong>{memoryCountLabel}</strong></div>
    </div>

    <div className={css.sectionGrid}>
      <section className={css.section}>
        <div className={css.sectionHeader}>
          <div className={css.sectionTitle}><span className={css.sectionIcon}><IconListPenOutlineMedium size={17} /></span><div><h3>{t('project.background')}</h3><p>{t('project.backgroundHint')}</p></div></div>
          <Button size="sm" variant="outline" disabled={!writable || !onEditBackground} icon={<IconEditOutlineMedium size={14} />} onClick={onEditBackground}>{t('action.edit')}</Button>
        </div>
        <p className={objective ? css.background : css.emptyState}>{objective || t(backgroundFacts.length ? 'project.noObjective' : 'project.noBackground')}</p>
        {backgroundFacts.length ? <dl className={css.contextFacts}>{backgroundFacts.map(fact => <div key={fact.key}><dt>{t(fact.key)}</dt><dd>{fact.values.join(' · ')}</dd></div>)}</dl> : null}
        {project.context?.agent.summary ? <div className={css.agentNote}><span>{t('project.agentSummary')}</span><p>{project.context.agent.summary}</p></div> : null}
        {project.contextCandidates?.length ? <details className={css.legacyContext}><summary>{t('project.legacyContext', { count: project.contextCandidates.length })}</summary>{project.contextCandidates.map(row => <article key={row.areaId}><small>{t('project.sourceArea', { id: row.areaId })}</small><pre>{renderAreaContextMarkdown(row.context)}</pre></article>)}</details> : null}
      </section>

      <section className={css.section}>
        <div className={css.sectionHeader}>
          <div className={css.sectionTitle}><span className={css.sectionIcon}><IconDatabaseOutlineMedium size={17} /></span><div><h3>{t('project.memory')}</h3><p>{t('project.memoryHint')}</p></div></div>
          <Button size="sm" variant="outline" disabled={!writable || !directory.memoryRequest} icon={<IconDatabaseOutlineMedium size={14} />} onClick={() => setMemory(true)}>{t('action.manage')}</Button>
        </div>
        <p className={css.memoryDescription}>{t('project.memoryDescription')}</p>
        <div className={css.sectionMeta}>{memoryCount === undefined ? t(memoryError ? 'project.memoryFailed' : 'project.memoryReading') : memoryCount >= 100 ? t('project.memoryMany') : t('project.memoryTotal', { count: memoryCount })}</div>
      </section>
    </div>

    <section className={css.section}>
      <div className={css.sectionHeader}>
        <div className={css.sectionTitle}><span className={css.sectionIcon}><IconNewChatOutlineMedium size={17} /></span><div><h3>{t('project.conversations')} <span className={css.count}>{sessions.length}</span></h3><p>{t('project.conversationsHint')}</p></div></div>
        <Button size="sm" disabled={!writable} icon={<IconNewChatOutlineMedium size={14} />} onClick={onAddPage}>{t('editor.workbench.conversation.start')}</Button>
      </div>
      {sessions.length ? <ul className={css.list}>{sessions.map(session => <li key={session.sessionKey}><div className={css.listCopy}><strong>{session.title || t('editor.workbench.conversation')}</strong><small>{session.agentPreset}{session.role === 'worker' ? ` · ${t('project.worker')}` : ''}</small></div><Button size="sm" variant="outline" disabled={!writable || !session.sessionId} onClick={() => onOpenSession(session)}>{t('action.open')}</Button></li>)}</ul> : <p className={css.emptyState}>{t('project.noConversations')}</p>}
    </section>
    <section className={css.section}>
      <div className={css.sectionHeader}>
        <div className={css.sectionTitle}><span className={css.sectionIcon}><IconChecklistOutlineMedium size={17} /></span><div><h3>{t('project.tasks')} <span className={css.count}>{items.length}</span></h3><p>{t('project.tasksHint')}</p></div></div>
      </div>
      {items.length ? <ul className={css.list}>{items.map(item => { const status = statusKeys[item.status]; return <li key={item.workItemId}><div className={css.listCopy}><strong>{item.objective}</strong><small className={css.status}>{status ? t(status) : item.status}</small></div>{!['running', 'queued', 'completed', 'ready'].includes(item.status) && controller ? <Button size="sm" variant="outline" disabled={!writable || !!busy} icon={<IconPlayOutlineMedium size={14} />} onClick={() => { void resume(item.workItemId) }}>{t(busy === item.workItemId ? 'project.resumingTask' : 'project.resumeTask')}</Button> : null}</li> })}</ul> : <p className={css.emptyState}>{t(tasks ? 'project.noTasks' : 'project.tasksOffline')}</p>}
    </section>
    {error ? <p className={css.error} role="alert">{error}</p> : null}
    {memory ? <WorkbenchMemoryDialog directory={directory} workbenchId={workbenchId} projectId={project.projectId} onClose={() => setMemory(false)} /> : null}
  </section>
}
