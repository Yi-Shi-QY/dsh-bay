import type { SessionController } from '@deepseek-ai/dsh-api-session-controller'
import { randomUUID } from 'node:crypto'
import type { BayAgentAssignmentV1, BayAgentWorkerRuntimeEventEnvelopeV1, BayAgentWorkerRuntimeEventV1, BayAgentWorkerRuntimeV1, BayAgentWorkItemV1 } from './foundation/workbench-bay-agent-work.ts'
import { WorkbenchBayAgentAdapter, projectExecutionTarget } from './foundation/workbench-bay-agent-adapter.ts'
import type { WorkbenchControlPlane } from './foundation/workbench-control-plane.ts'

export class NativeBayWorkerRuntime implements BayAgentWorkerRuntimeV1 {
  readonly name = 'dsh-session-controller'
  readonly capabilities = { dispatch: true, reuseSession: true, observe: true, pause: true, resume: true, migrateSession: false, eventEnvelope: 1 as const }
  private readonly listeners = new Set<(event: BayAgentWorkerRuntimeEventV1) => void>()
  private readonly envelopeListeners = new Set<(envelope: BayAgentWorkerRuntimeEventEnvelopeV1) => void>()
  private readonly runtimeEpoch = randomUUID()
  private sequence = 0
  private readonly workers = new Map<string, { workItem: BayAgentWorkItemV1; assignment: BayAgentAssignmentV1; controller: AbortController }>()
  constructor(private readonly options: {
    sessions: SessionController
    plane: WorkbenchControlPlane
    decorate: (sessionId: string, workItem: BayAgentWorkItemV1, assignment: BayAgentAssignmentV1) => Promise<void>
    deliver: (sessionId: string, requestId: string, text: string, authorize?: () => void) => Promise<void>
  }) {}
  subscribe(listener: (event: BayAgentWorkerRuntimeEventV1) => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  subscribeEnvelope(listener: (envelope: BayAgentWorkerRuntimeEventEnvelopeV1) => void) { this.envelopeListeners.add(listener); return () => { this.envelopeListeners.delete(listener) } }
  async report(event: BayAgentWorkerRuntimeEventV1): Promise<void> {
    const worker = this.workers.get(event.runtimeAssignmentId), assignment = worker?.assignment
    const envelope: BayAgentWorkerRuntimeEventEnvelopeV1 = { schemaVersion: 1, eventId: `${this.runtimeEpoch}:${++this.sequence}`, emittedAt: Date.now(), runtimeName: this.name, runtimeAssignmentId: event.runtimeAssignmentId,
      ...(worker ? { workbenchId: worker.workItem.workbenchId, workItemId: worker.workItem.workItemId, ...(assignment?.assignmentId ? { assignmentId: assignment.assignmentId } : {}), ...(assignment?.workerSessionId ? { sessionId: assignment.workerSessionId } : {}) } : {}), runtimeEpoch: this.runtimeEpoch, sequence: this.sequence, event }
    await Promise.all([...this.listeners].map(listener => listener(event)))
    await Promise.all([...this.envelopeListeners].map(listener => listener(envelope)))
  }
  async createAssignment(input: Parameters<BayAgentWorkerRuntimeV1['createAssignment']>[0]) {
    if (!input.assignment) throw new Error('Bay Assignment identity required')
    const { workItem: item, assignment } = input
    const snapshot = this.options.plane.inspect(item.workbenchId)
    const area = item.projectId ? projectExecutionTarget(snapshot, item.projectId, item.areaId) : snapshot.areas.find(row => row.areaId === item.areaId)
    if (item.projectResolution === 'unresolved' || item.projectId && !area?.visible) throw new Error('请先在新区域打开此项目，再继续任务。')
    const workspaceId = area?.project?.workspaceId ?? item.workspaceId ?? area?.binding?.workspaceId ?? area?.modules.find(row => row.binding?.workspaceId)?.binding?.workspaceId
    if (!workspaceId) throw new Error('请先为任务选择一个项目（Workspace）。')
    const previous = input.previousAssignment
    const priorPage = previous?.workerSessionId ? snapshot.areas.flatMap(row => row.modules).find(row => row.binding?.sessionId === previous.workerSessionId && row.binding?.workspaceId === workspaceId) : undefined
    const priorSession = snapshot.sessions?.find(row => row.sessionId === previous?.workerSessionId && (item.projectId ? row.projectId === item.projectId : row.areaId === item.areaId) && row.workspaceId === workspaceId && row.agentPreset === (item.agentPreset ?? 'standard'))
    const priorTarget = priorSession ? { sessionId: priorSession.sessionId, workspaceId } : snapshot.sessions === undefined ? priorPage?.binding : undefined
    let reused: { target: { sessionId: string; workspaceId?: string }; moduleInstanceId: string } | undefined
    if (priorTarget) {
      const resolved = await this.options.sessions.resolveAgent(priorTarget.sessionId as never)
      if (!('error' in resolved)) {
        const state = await this.options.sessions.state({ sessionId: priorTarget.sessionId as never }, new AbortController().signal)
        if (state.running || state.queue?.length) throw new Error('原任务对话仍在执行，请等待当前轮次结束后继续。')
        if (priorPage) reused = { target: priorTarget, moduleInstanceId: priorPage.moduleInstanceId }
        else {
          const opened = await this.options.plane.openSessionView({ workbenchId: item.workbenchId, areaId: area?.areaId ?? item.areaId, target: priorTarget, title: item.objective })
          if (opened.status !== 'committed') throw new Error('无法重新打开任务对话，请重试。')
          reused = opened.value
        }
      } else if (resolved.error.code !== 'session/not-found') throw resolved.error
    }
    if (!reused) {
      const request = { workbenchId: item.workbenchId, areaId: area?.areaId ?? item.areaId, workspaceId, agentPreset: item.agentPreset ?? 'standard', title: item.objective, requestId: assignment.assignmentId, append: true }
      let created = await this.options.plane.createSession(request)
      for (let attempt = 0; created.status === 'conflict' && attempt < 3; attempt++) created = await this.options.plane.createSession(request)
      if (created.status !== 'committed') throw new Error('Worker 内页创建失败：' + JSON.stringify(created))
      reused = created.value
    }
    const { target, moduleInstanceId } = reused
    const lease = { ...new WorkbenchBayAgentAdapter(this.options.plane).captureExecutionLease({ workbenchId: item.workbenchId, areaId: area?.areaId ?? item.areaId, ...(item.projectId ? { projectId: item.projectId } : {}) }), moduleInstanceId, sessionId: target.sessionId }
    const result = { runtimeAssignmentId: assignment.assignmentId, sessionId: target.sessionId, moduleInstanceId, lease }
    await input.onPrepared?.(result)
    const prepared = { ...assignment, ...result, workerSessionId: target.sessionId }
    try {
      await this.options.decorate(target.sessionId, item, prepared)
      await this.options.deliver(target.sessionId, 'assignment:' + assignment.assignmentId, '执行以下 Bay Agent 任务。完成、受阻或需要输入时调用 bay_report；不要把空闲状态当成完成。\n' + input.prompt, () => {
        this.assertTarget(item, prepared)
      })
      await this.observeAssignment({ workItem: item, assignment: prepared })
      await this.report({ type: 'assignment.started', runtimeAssignmentId: assignment.assignmentId, sessionId: target.sessionId })
    } catch (error) {
      this.options.sessions.cancel({ sessionId: target.sessionId as never })
      this.finish(assignment.assignmentId)
      throw error
    }
    return result
  }
  async observeAssignment(input: { workItem: BayAgentWorkItemV1; assignment: BayAgentAssignmentV1 }) {
    const id = input.assignment.runtimeAssignmentId ?? input.assignment.assignmentId
    if (this.workers.has(id) || !input.assignment.workerSessionId) return
    const controller = new AbortController()
    this.workers.set(id, { ...input, controller })
    await this.options.decorate(input.assignment.workerSessionId, input.workItem, input.assignment)
    void this.monitor(id, input.assignment.workerSessionId, controller.signal).catch(async error => {
      if (!controller.signal.aborted) await this.report({ type: 'assignment.failed', runtimeAssignmentId: id, error: String(error) })
    }).catch(() => {})
  }
  private async monitor(id: string, sessionId: string, signal: AbortSignal) {
    // This is an observer only: restart never replays a possibly accepted prompt.
    let pendingInput = false
    while (!signal.aborted && this.workers.has(id)) {
      await new Promise<void>(resolve => { const abort = () => { clearTimeout(timer); resolve() }; const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve() }, 1500); signal.addEventListener('abort', abort, { once: true }) })
      if (signal.aborted) return
      const worker = this.workers.get(id)
      if (!worker) return
      try {
        this.assertTarget(worker.workItem, worker.assignment)
      } catch {
        await this.cancelAssignment({ runtimeAssignmentId: id })
        await this.report({ type: 'assignment.interrupted', runtimeAssignmentId: id })
        return
      }
      const state = await this.options.sessions.state({ sessionId: sessionId as never }, signal)
      if (state.pendingInput.length) {
        pendingInput = true
        await this.report({ type: 'assignment.input_required', runtimeAssignmentId: id, question: 'Worker 需要原生授权或答复，请打开该 Worker 对话处理。' })
        continue
      }
      if (pendingInput) { pendingInput = false; await this.report({ type: 'assignment.input_cleared', runtimeAssignmentId: id }) }
      if (!state.running && !state.queue?.length) {
        this.workers.delete(id)
        await this.report({ type: 'assignment.report', runtimeAssignmentId: id, state: 'waiting', summary: 'Worker 已停止输出，但没有提交完成报告。请检查结果后决定是否恢复。' })
        return
      }
    }
  }
  private assertTarget(item: BayAgentWorkItemV1, assignment: BayAgentAssignmentV1) {
    const snapshot = this.options.plane.inspect(item.workbenchId), area = item.projectId ? projectExecutionTarget(snapshot, item.projectId, item.areaId) : snapshot.areas.find(row => row.areaId === item.areaId)
    if (!area || area.archived || assignment.lease?.projectGeneration !== area.project?.generation) throw new Error('Worker project changed')
    if (snapshot.sessions !== undefined && !snapshot.sessions.some(row => row.sessionId === assignment.workerSessionId && (item.projectId ? row.projectId === item.projectId : row.areaId === item.areaId) && row.workspaceId === area.project?.workspaceId)) throw new Error('Worker conversation ownership changed')
  }
  finish(id: string) { this.workers.get(id)?.controller.abort(); this.workers.delete(id) }
  async cancelWorkbench(workbenchId: string) { for (const [id, row] of this.workers) if (row.workItem.workbenchId === workbenchId) await this.cancelAssignment({ runtimeAssignmentId: id }) }
  async cancelAssignment({ runtimeAssignmentId }: { runtimeAssignmentId: string }) {
    const worker = this.workers.get(runtimeAssignmentId)
    if (worker?.assignment.workerSessionId) this.options.sessions.cancel({ sessionId: worker.assignment.workerSessionId as never })
    this.finish(runtimeAssignmentId)
  }
  async retryAssignment(): Promise<never> { throw new Error('Create a new Bay Assignment before retrying') }
  async recoverAssignment(): Promise<never> { throw new Error('Create a new Bay Assignment before recovery') }
  dispose() { for (const id of [...this.workers.keys()]) this.finish(id); this.listeners.clear() }
}
