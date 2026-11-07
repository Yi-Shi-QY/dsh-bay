import type { SessionController } from '@deepseek-ai/dsh-api-session-controller'
import type { BayAgentAssignmentV1, BayAgentWorkerRuntimeEventV1, BayAgentWorkerRuntimeV1, BayAgentWorkItemV1 } from './foundation/workbench-bay-agent-work.ts'
import { WorkbenchBayAgentAdapter } from './foundation/workbench-bay-agent-adapter.ts'
import type { WorkbenchControlPlane } from './foundation/workbench-control-plane.ts'

export class NativeBayWorkerRuntime implements BayAgentWorkerRuntimeV1 {
  readonly name = 'dsh-session-controller'
  private readonly listeners = new Set<(event: BayAgentWorkerRuntimeEventV1) => void>()
  private readonly workers = new Map<string, { workItem: BayAgentWorkItemV1; assignment: BayAgentAssignmentV1; controller: AbortController }>()
  constructor(private readonly options: {
    sessions: SessionController
    plane: WorkbenchControlPlane
    decorate: (sessionId: string, workItem: BayAgentWorkItemV1, assignment: BayAgentAssignmentV1) => Promise<void>
    deliver: (sessionId: string, requestId: string, text: string, authorize?: () => void) => Promise<void>
  }) {}
  subscribe(listener: (event: BayAgentWorkerRuntimeEventV1) => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  async report(event: BayAgentWorkerRuntimeEventV1): Promise<void> { await Promise.all([...this.listeners].map(listener => listener(event))) }
  async createAssignment(input: Parameters<BayAgentWorkerRuntimeV1['createAssignment']>[0]) {
    if (!input.assignment) throw new Error('Bay Assignment identity required')
    const { workItem: item, assignment } = input
    const area = this.options.plane.inspect(item.workbenchId).areas.find(row => row.areaId === item.areaId)
    const workspaceId = item.workspaceId ?? area?.binding?.workspaceId ?? area?.modules.find(row => row.binding?.workspaceId)?.binding?.workspaceId
    if (!workspaceId) throw new Error('请先为任务选择一个项目（Workspace）。')
    let created = await this.options.plane.createSession({ workbenchId: item.workbenchId, areaId: item.areaId, workspaceId, agentPreset: item.agentPreset ?? 'standard', requestId: assignment.assignmentId, append: true })
    for (let attempt = 0; created.status === 'conflict' && attempt < 3; attempt++) created = await this.options.plane.createSession({ workbenchId: item.workbenchId, areaId: item.areaId, workspaceId, agentPreset: item.agentPreset ?? 'standard', requestId: assignment.assignmentId, append: true })
    if (created.status !== 'committed') throw new Error('Worker 内页创建失败：' + JSON.stringify(created))
    const { target, moduleInstanceId } = created.value
    const lease = { ...new WorkbenchBayAgentAdapter(this.options.plane).captureExecutionLease({ workbenchId: item.workbenchId, areaId: item.areaId }), moduleInstanceId, sessionId: target.sessionId }
    const result = { runtimeAssignmentId: assignment.assignmentId, sessionId: target.sessionId, moduleInstanceId, lease }
    await input.onPrepared?.(result)
    const prepared = { ...assignment, ...result, workerSessionId: target.sessionId }
    try {
      await this.options.decorate(target.sessionId, item, prepared)
      await this.options.deliver(target.sessionId, 'assignment:' + assignment.assignmentId, '执行以下 Bay Agent 任务。完成、受阻或需要输入时调用 bay_report；不要把空闲状态当成完成。\n' + input.prompt, () => {
        const current = this.options.plane.inspect(item.workbenchId).areas.find(row => row.areaId === item.areaId)
        if (!current || current.archived || !current.modules.some(row => row.moduleInstanceId === moduleInstanceId && row.binding?.sessionId === target.sessionId)) throw new Error('Worker target changed before dispatch')
      })
      await this.report({ type: 'assignment.started', runtimeAssignmentId: assignment.assignmentId, sessionId: target.sessionId })
      await this.observeAssignment({ workItem: item, assignment: prepared })
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
        const area = this.options.plane.inspect(worker.workItem.workbenchId).areas.find(row => row.areaId === worker.workItem.areaId)
        if (!area || area.archived || !area.modules.some(row => row.moduleInstanceId === worker.assignment.moduleInstanceId && row.binding?.sessionId === sessionId)) throw new Error('Worker target changed')
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
