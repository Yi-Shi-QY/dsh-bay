import { useState } from 'react'
import type { BayAgentControllerSnapshotV1, BayAgentControllerV1 } from './workbench-bay-agent-work.ts'
import css from './WorkbenchBayAgentTasks.module.css'

const labels: Record<string, string> = { proposed: '未开始', queued: '排队中', running: '执行中', waiting: '等待中', needs_input: '待处理', ready: '待验收', blocked: '受阻', failed: '失败', completed: '已验收', stopped: '已停止' }
export function WorkbenchBayAgentTasks({ controller, snapshot, workspaces, openWorker }: {
  controller: BayAgentControllerV1
  snapshot: BayAgentControllerSnapshotV1
  workspaces: readonly { workspaceId: string; title?: string; path?: string }[]
  openWorker: (sessionId: string) => void
}) {
  const [objective, setObjective] = useState(''), [areaId, setArea] = useState(''), [workspaceId, setWorkspace] = useState(''), [mode, setMode] = useState('standard')
  const [answers, setAnswers] = useState<Record<string, string>>({}), [pending, setPending] = useState(false), [error, setError] = useState('')
  const attention = snapshot.attention.filter(row => row.status === 'open')
  const run = async (operation: () => Promise<unknown>) => { if (pending) return; setPending(true); setError(''); try { await operation() } catch (error) { setError(String(error)) } finally { setPending(false) } }
  return <details className={css.tasks}>
    <summary>工作台任务 · {snapshot.workItems.filter(row => row.status === 'running').length} 执行中{attention.length ? <strong> · {attention.length} 待处理</strong> : null}</summary>
    <div className={css.scroll}>
      {error || snapshot.error ? <p role="alert" className={css.error}>{error || snapshot.error}</p> : null}
      {attention.map(row => { const assignment = snapshot.assignments.find(item => item.assignmentId === row.assignmentId); return <section key={row.attentionId} className={css.attention} aria-label="待处理事项">
        <strong>{row.question}</strong>
        {assignment?.workerSessionId ? <button onClick={() => openWorker(assignment.workerSessionId!)}>打开 Worker 对话</button> : null}
        {assignment?.nativeInputPending ? <p>请在 Worker 对话中处理原生授权或问题，状态会自动更新。</p> : <form onSubmit={event => { event.preventDefault(); void run(() => controller.resolveAttention(row.attentionId, answers[row.attentionId])) }}>
          <input aria-label="答复或恢复指令" value={answers[row.attentionId] ?? ''} onChange={event => setAnswers({ ...answers, [row.attentionId]: event.target.value })} placeholder="答复或恢复指令" required />
          <button disabled={pending || !answers[row.attentionId]?.trim()}>答复并恢复</button>
        </form>}
        <button disabled={pending} onClick={() => void run(() => controller.dismissAttention(row.attentionId))}>忽略提醒</button>
      </section> })}
      {snapshot.workItems.map(item => { const assignment = snapshot.assignments.find(row => row.assignmentId === item.currentAssignmentId); return <section key={item.workItemId} className={css.item}>
        <div className={css.title}><strong>{item.objective}</strong><span>{labels[item.status] ?? item.status}</span></div>
        <small>{snapshot.areas.find(row => row.areaId === item.areaId)?.label ?? item.areaId} · {item.agentPreset ?? 'standard'}</small>
        {assignment?.reportSummary ? <p>{assignment.reportSummary}</p> : null}
        <div className={css.actions}>
          {assignment?.workerSessionId ? <button onClick={() => openWorker(assignment.workerSessionId!)}>打开对话</button> : null}
          {item.status === 'ready' && controller.acceptWorkItem ? <button disabled={pending} onClick={() => void run(() => controller.acceptWorkItem!(item.workItemId))}>验收完成</button> : null}
          {item.status !== 'completed' ? assignment && assignment.state !== 'ended' ? <button disabled={pending} onClick={() => void run(() => controller.stopWorkItem(item.workItemId))}>停止任务</button> : <button disabled={pending} onClick={() => void run(() => controller.startWorkItem(item.workItemId))}>{item.status === 'proposed' ? '开始' : '新建执行尝试'}</button> : null}
        </div>
      </section> })}
      <form className={css.create} onSubmit={event => { event.preventDefault(); void run(async () => { await controller.createWorkItem({ areaId: areaId || snapshot.areas[0]?.areaId || '', objective, workspaceId: workspaceId || workspaces[0]?.workspaceId || '', agentPreset: mode, start: true }); setObjective('') }) }}>
        <label>新任务<input value={objective} onChange={event => setObjective(event.target.value)} placeholder="也可以直接在聊天中交给 Bay Agent" required maxLength={20000} /></label>
        <div className={css.fields}>
          <label>区域<select value={areaId || snapshot.areas[0]?.areaId || ''} onChange={event => setArea(event.target.value)}>{snapshot.areas.map(row => <option key={row.areaId} value={row.areaId}>{row.label}</option>)}</select></label>
          <label>项目<select value={workspaceId || workspaces[0]?.workspaceId || ''} onChange={event => setWorkspace(event.target.value)}>{workspaces.map(row => <option key={row.workspaceId} value={row.workspaceId}>{row.title || row.path || row.workspaceId}</option>)}</select></label>
          <label>Agent 模式<select value={mode} onChange={event => setMode(event.target.value)}>{(snapshot.agentModes?.length ? snapshot.agentModes : [{ id: "standard", name: "Standard" }]).map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
        </div>
        <button disabled={pending || !objective.trim() || !snapshot.areas.length || !workspaces.length}>创建并派发</button>
      </form>
    </div>
  </details>
}

