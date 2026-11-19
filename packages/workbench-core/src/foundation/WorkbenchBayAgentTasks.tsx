import { useWorkbenchLocale } from './workbench-locale.ts'
import { useState } from 'react'
import type { BayAgentControllerSnapshotV1, BayAgentControllerV1 } from './workbench-bay-agent-work.ts'
import css from './WorkbenchBayAgentTasks.module.css'

export function WorkbenchBayAgentTasks({ controller, snapshot, workspaces, openWorker }: {
  controller: BayAgentControllerV1
  snapshot: BayAgentControllerSnapshotV1
  workspaces: readonly { workspaceId: string; title?: string; path?: string }[]
  openWorker: (sessionId: string) => void
}) {
  const { t } = useWorkbenchLocale()
  const [objective, setObjective] = useState(''), [areaId, setArea] = useState(''), [workspaceId, setWorkspace] = useState(''), [mode, setMode] = useState('standard')
  const [answers, setAnswers] = useState<Record<string, string>>({}), [pending, setPending] = useState(false), [error, setError] = useState('')
  const attention = snapshot.attention.filter(row => row.status === 'open')
  const selectedMode = snapshot.agentModeCapabilities?.find(row => row.id === mode)
  const run = async (operation: () => Promise<unknown>) => { if (pending) return; setPending(true); setError(''); try { await operation() } catch (error) { setError(String(error)) } finally { setPending(false) } }
  return <details className={css.tasks}>
    <summary>{t('workspace.workbenchTasks')} {snapshot.workItems.filter(row => row.status === 'running').length} {t('task.running')}{attention.length ? <strong> · {attention.length} {t('workspace.needsAttention')}</strong> : null}</summary>
    <div className={css.scroll}>
      {error || snapshot.error ? <p role="alert" className={css.error}>{error || snapshot.error}</p> : null}
      {attention.map(row => { const assignment = snapshot.assignments.find(item => item.assignmentId === row.assignmentId); return <section key={row.attentionId} className={css.attention} aria-label={t('workspace.itemsNeedingAttention')}>
        <strong>{row.question}</strong>
        {assignment?.workerSessionId ? <button onClick={() => openWorker(assignment.workerSessionId!)}>{t('workspace.openWorkerConversation')}</button> : null}
        {assignment?.nativeInputPending ? <p>{t('workspace.respondToPermissionRequestsAndQuestionsIn')}</p> : <form onSubmit={event => { event.preventDefault(); void run(() => controller.resolveAttention(row.attentionId, answers[row.attentionId])) }}>
          <input aria-label={t('workspace.replyOrInstructionsToResume')} value={answers[row.attentionId] ?? ''} onChange={event => setAnswers({ ...answers, [row.attentionId]: event.target.value })} placeholder={t('workspace.replyOrInstructionsToResume')} required />
          <button disabled={pending || !answers[row.attentionId]?.trim()}>{t('workspace.replyAndResume')}</button>
        </form>}
        <button disabled={pending} onClick={() => void run(() => controller.dismissAttention(row.attentionId))}>{t('workspace.dismissReminder')}</button>
      </section> })}
      {snapshot.workItems.map(item => { const assignment = snapshot.assignments.find(row => row.assignmentId === item.currentAssignmentId); return <section key={item.workItemId} className={css.item}>
        <div className={css.title}><strong>{item.objective}</strong><span>{t(`task.status.${item.status}`)}</span></div>
        <small>{snapshot.areas.find(row => row.areaId === item.areaId)?.label ?? item.areaId} · {item.agentPreset ?? 'standard'}</small>
        {assignment?.reportSummary ? <p>{assignment.reportSummary}</p> : null}
        <div className={css.actions}>
          {assignment?.workerSessionId ? <button onClick={() => openWorker(assignment.workerSessionId!)}>{t('workspace.openConversation')}</button> : null}
          {item.status === 'ready' && controller.acceptWorkItem ? <button disabled={pending} onClick={() => void run(() => controller.acceptWorkItem!(item.workItemId))}>{t('workspace.acceptAsComplete')}</button> : null}
          {item.status !== 'completed' ? assignment && assignment.state !== 'ended' ? <button disabled={pending} onClick={() => void run(() => controller.stopWorkItem(item.workItemId))}>{t('workspace.stopTask')}</button> : <button disabled={pending} onClick={() => void run(() => controller.startWorkItem(item.workItemId))}>{item.status === 'proposed' ? t('task.start') : t('task.newAttempt')}</button> : null}
        </div>
      </section> })}
      <form className={css.create} onSubmit={event => { event.preventDefault(); void run(async () => { await controller.createWorkItem({ areaId: areaId || snapshot.areas[0]?.areaId || '', objective, workspaceId: workspaceId || workspaces[0]?.workspaceId || '', agentPreset: mode, start: true }); setObjective('') }) }}>
        <label>{t('workspace.newTask')}<input value={objective} onChange={event => setObjective(event.target.value)} placeholder={t('workspace.youCanAlsoAssignThisInA')} required maxLength={20000} /></label>
        <div className={css.fields}>
          <label>{t('workspace.area')}<select value={areaId || snapshot.areas[0]?.areaId || ''} onChange={event => setArea(event.target.value)}>{snapshot.areas.map(row => <option key={row.areaId} value={row.areaId}>{row.label}</option>)}</select></label>
          <label>{t('workspace.project')}<select value={workspaceId || workspaces[0]?.workspaceId || ''} onChange={event => setWorkspace(event.target.value)}>{workspaces.map(row => <option key={row.workspaceId} value={row.workspaceId}>{row.title || row.path || row.workspaceId}</option>)}</select></label>
          <label>{t('workspace.agentMode')}<select value={mode} onChange={event => setMode(event.target.value)}>{(snapshot.agentModes?.length ? snapshot.agentModes : [{ id: "standard", name: "Standard" }]).map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
        </div>
        {selectedMode?.known && !selectedMode.compaction ? <p className={css.warning} role="status">{t('workspace.thisModeDoesNotCompactContextAutomatically')}</p> : null}
        {selectedMode && !selectedMode.known ? <p className={css.warning} role="status">{t('workspace.capabilitiesAreNotAvailableForThisMode')}</p> : null}
        <button disabled={pending || !objective.trim() || !snapshot.areas.length || !workspaces.length}>{t('workspace.createAndDispatch')}</button>
      </form>
    </div>
  </details>
}
