import type { WorkbenchBayAgentAdapter, WorkbenchBayAgentExecutionLeaseV1 } from './workbench-bay-agent-adapter.ts'
import type { WorkbenchControlPlaneSnapshotV1 } from './workbench-control-plane.ts'

/** Bay Agent's durable, Workbench-owned unit of intent. */
export type BayAgentWorkItemStatusV1 =
  | 'proposed' | 'queued' | 'running' | 'waiting' | 'needs_input'
  | 'ready' | 'blocked' | 'failed' | 'completed' | 'stopped'

export interface BayAgentWorkItemV1 {
  workItemId: string
  workbenchId: string
  areaId: string
  objective: string
  agentPreset?: string
  workspaceId?: string
  scope?: string
  inputs: readonly string[]
  successCriteria: readonly string[]
  status: BayAgentWorkItemStatusV1
  currentAssignmentId?: string
  createdAt: number
  updatedAt: number
}

export interface BayAgentAssignmentV1 {
  assignmentId: string
  workItemId: string
  areaId: string
  runtimeName: string
  runtimeAssignmentId?: string
  workerSessionId?: string
  moduleInstanceId?: string
  nativeInputPending?: boolean
  lease?: WorkbenchBayAgentExecutionLeaseV1
  /** @deprecated alpha compatibility; use workerSessionId. */
  sessionId?: string
  state: 'pending' | 'running' | 'ended'
  reportState?: BayAgentReportStateV1
  reportSummary?: string
  createdAt: number
  startedAt?: number
  endedAt?: number
}

export type BayAgentReportStateV1 = 'progress' | 'waiting' | 'ready' | 'blocked' | 'failed' | 'dropped'

export interface BayAgentAttentionV1 {
  attentionId: string
  workItemId: string
  assignmentId?: string
  areaId: string
  kind: 'needs_input' | 'blocked' | 'failed' | 'decision'
  question: string
  status: 'open' | 'resolved' | 'dismissed'
  createdAt: number
  resolvedAt?: number
  answer?: string
}

export type BayAgentWorkerRuntimeEventV1 =
  | { type: 'assignment.input_required'; runtimeAssignmentId: string; question: string }
  | { type: 'assignment.input_cleared'; runtimeAssignmentId: string }
  | { type: 'assignment.started'; runtimeAssignmentId: string; sessionId?: string }
  | { type: 'assignment.progress'; runtimeAssignmentId: string; summary: string }
  | { type: 'assignment.report'; runtimeAssignmentId: string; state: BayAgentReportStateV1; summary: string; question?: string }
  | { type: 'assignment.failed'; runtimeAssignmentId: string; error: string }
  | { type: 'assignment.interrupted'; runtimeAssignmentId: string }

export interface BayAgentWorkerRuntimeV1 {
  readonly name: string
  createAssignment(input: {
    assignment?: BayAgentAssignmentV1
    onPrepared?: (result: { runtimeAssignmentId: string; sessionId?: string; moduleInstanceId?: string; lease?: WorkbenchBayAgentExecutionLeaseV1 }) => Promise<void>
    workItem: BayAgentWorkItemV1
    prompt: string
    lease: WorkbenchBayAgentExecutionLeaseV1
  }): Promise<{ runtimeAssignmentId: string; sessionId?: string; moduleInstanceId?: string; lease?: WorkbenchBayAgentExecutionLeaseV1 }>
  observeAssignment?(input: { workItem: BayAgentWorkItemV1; assignment: BayAgentAssignmentV1 }): Promise<void>
  cancelAssignment(input: { runtimeAssignmentId: string; reason?: string }): Promise<void>
  retryAssignment(input: {
    runtimeAssignmentId: string
    prompt: string
    lease: WorkbenchBayAgentExecutionLeaseV1
  }): Promise<{ runtimeAssignmentId: string; sessionId?: string }>
  recoverAssignment(input: {
    workItem: BayAgentWorkItemV1
    assignment: BayAgentAssignmentV1
    prompt: string
    lease: WorkbenchBayAgentExecutionLeaseV1
  }): Promise<{ runtimeAssignmentId: string; sessionId?: string }>
  subscribe(listener: (event: BayAgentWorkerRuntimeEventV1) => void): () => void
}

export interface BayAgentSessionCreatorV1 {
  create(input: { workbenchId: string; requestId: string; model?: { provider: string; model: string; reasoningEffort?: string } }): Promise<{ sessionId: string; workspaceId?: string }>
}

export interface BayAgentControllerSnapshotV1 {
  workbenchId: string
  areas: readonly { areaId: string; label: string }[]
  bayAgentSessionId?: string
  /** @deprecated alpha compatibility; use bayAgentSessionId. */
  sessionId?: string
  workItems: readonly BayAgentWorkItemV1[]
  assignments: readonly BayAgentAssignmentV1[]
  attention: readonly BayAgentAttentionV1[]
  error?: string
  agentModes?: readonly { id: string; name: string }[]
}

/** Local runtime identities are intentionally excluded from portable packages. */
export interface BayAgentWorkStateV1 {
  version: 1
  workItems: BayAgentWorkItemV1[]
  assignments: BayAgentAssignmentV1[]
  attention: BayAgentAttentionV1[]
}

export interface BayAgentControllerV1 {
  readonly runtime: BayAgentWorkerRuntimeV1
  setWorkbenchId(workbenchId: string): void
  ensureMainSession(workbenchId?: string): Promise<string | undefined>
  getSnapshot(): BayAgentControllerSnapshotV1
  subscribe(listener: () => void): () => void
  createWorkItem(input: {
    areaId: string
    objective: string
    agentPreset?: string
    workspaceId?: string
    scope?: string
    inputs?: readonly string[]
    successCriteria?: readonly string[]
    start?: boolean
  }): Promise<BayAgentWorkItemV1>
  startWorkItem(workItemId: string): Promise<BayAgentAssignmentV1>
  retryWorkItem(workItemId: string): Promise<void>
  recoverWorkItem(workItemId: string): Promise<void>
  stopWorkItem(workItemId: string, reason?: string): Promise<void>
  acceptWorkItem?(workItemId: string): Promise<void>
  resolveAttention(attentionId: string, answer?: string): Promise<void>
  dismissAttention(attentionId: string): Promise<void>
  listAttention(): readonly BayAgentAttentionV1[]
}

export interface CreateBayAgentControllerOptionsV1 {
  workbenchId: string
  adapter: WorkbenchBayAgentAdapter
  inspect: (workbenchId?: string) => WorkbenchControlPlaneSnapshotV1
  runtime: BayAgentWorkerRuntimeV1
  sessionCreator?: BayAgentSessionCreatorV1
  loadMainSession?: (workbenchId: string) => { sessionId: string; workspaceId?: string } | undefined
  persistMainSession?: (workbenchId: string, session: { sessionId: string; workspaceId?: string }) => Promise<void>
  modelForWorkbench?: (workbenchId: string) => { provider: string; model: string; reasoningEffort?: string } | undefined
  configureMainSession?: (workbenchId: string, sessionId: string, model: { provider: string; model: string; reasoningEffort?: string }) => Promise<void>
  loadWorkState?: (workbenchId: string) => BayAgentWorkStateV1 | undefined
  persistWorkState?: (workbenchId: string, state: BayAgentWorkStateV1) => Promise<void>
  now?: () => number
  createId?: (kind: string) => string
}

const defaultId = (kind: string) => `${kind}-${globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)}`

/**
 * Work Item and Assignment are Bay Agent records. A runtime assignment ID is
 * only a foreign key used by the adapter; it is never the Workbench fact.
 */
export class BayAgentController implements BayAgentControllerV1 {
  readonly runtime: BayAgentWorkerRuntimeV1
  private readonly now: () => number
  private readonly createId: (kind: string) => string
  private readonly workItems = new Map<string, BayAgentWorkItemV1>()
  private readonly assignments = new Map<string, BayAgentAssignmentV1>()
  private readonly attention = new Map<string, BayAgentAttentionV1>()
  private readonly loaded = new Set<string>()
  private readonly starts = new Map<string, Promise<BayAgentAssignmentV1>>()
  private readonly saves = new Map<string, Promise<void>>()
  private readonly listeners = new Set<() => void>()
  private snapshotCache: BayAgentControllerSnapshotV1 | undefined
  private sessionId: string | undefined
  private error: string | undefined
  private readonly mainSessions = new Map<string, { sessionId: string; workspaceId?: string }>()
  private readonly mainSessionRequests = new Map<string, Promise<string | undefined>>()
  private readonly unsubscribeRuntime: () => void

  constructor(private readonly options: CreateBayAgentControllerOptionsV1) {
    this.runtime = options.runtime
    this.now = options.now ?? (() => Date.now())
    this.createId = options.createId ?? defaultId
    this.sessionId = options.loadMainSession?.(options.workbenchId)?.sessionId
    this.unsubscribeRuntime = options.runtime.subscribe(event => {
      return this.handleRuntimeEvent(event).catch(error => { this.error = String(error); this.emit(); throw error })
    })
    this.load(options.workbenchId)
  }
  dispose(): void { this.unsubscribeRuntime(); this.listeners.clear() }
  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener) }
  setWorkbenchId(workbenchId: string): void {
    if (workbenchId === this.options.workbenchId) return
    this.options.workbenchId = workbenchId
    this.load(workbenchId)
    this.sessionId = this.options.loadMainSession?.(workbenchId)?.sessionId ?? this.mainSessions.get(workbenchId)?.sessionId
    this.emit()
  }
  getSnapshot(): BayAgentControllerSnapshotV1 {
    if (this.snapshotCache) return this.snapshotCache
    const state = this.state(this.options.workbenchId)
    return this.snapshotCache = { workbenchId: this.options.workbenchId, areas: this.readAreas(),
      ...(this.sessionId ? { bayAgentSessionId: this.sessionId, sessionId: this.sessionId } : {}),
      workItems: state.workItems, assignments: state.assignments, attention: state.attention,
      ...(this.error ? { error: this.error } : {}),
    }
  }
  listAttention(): readonly BayAgentAttentionV1[] { return this.getSnapshot().attention.filter(row => row.status === 'open') }
  private load(workbenchId: string): void {
    if (this.loaded.has(workbenchId)) return
    this.loaded.add(workbenchId)
    const state = this.options.loadWorkState?.(workbenchId)
    if (!state) return
    for (const item of state.workItems) if (item.workbenchId === workbenchId) this.workItems.set(item.workItemId, structuredClone(item))
    for (const row of state.assignments) if (this.workItems.get(row.workItemId)?.workbenchId === workbenchId) this.assignments.set(row.assignmentId, structuredClone(row))
    for (const row of state.attention) if (this.workItems.get(row.workItemId)?.workbenchId === workbenchId) this.attention.set(row.attentionId, structuredClone(row))
    let recovered = false
    for (const row of this.assignments.values()) {
      const item = this.workItems.get(row.workItemId)
      if (!item || item.workbenchId !== workbenchId || item.currentAssignmentId !== row.assignmentId || row.state === 'ended') continue
      if (row.workerSessionId && this.runtime.observeAssignment) {
        void this.runtime.observeAssignment({ workItem: item, assignment: row }).catch(error => { this.error = String(error); this.emit() })
      } else {
        this.assignments.set(row.assignmentId, { ...row, state: 'ended', endedAt: this.now(), reportState: 'waiting' })
        this.updateItem(item, { status: 'needs_input' })
        this.addAttention(item, row, 'decision', '执行中断，请检查已有对话和产物后恢复，避免重复执行。')
        recovered = true
      }
    }
    if (recovered) void this.save(workbenchId).catch(() => {})
  }
  private state(workbenchId: string): BayAgentWorkStateV1 {
    const workItems = [...this.workItems.values()].filter(row => row.workbenchId === workbenchId)
    const ids = new Set(workItems.map(row => row.workItemId))
    return structuredClone({ version: 1, workItems, assignments: [...this.assignments.values()].filter(row => ids.has(row.workItemId)), attention: [...this.attention.values()].filter(row => ids.has(row.workItemId)) })
  }
  private async save(workbenchId: string): Promise<void> {
    const state = this.state(workbenchId)
    const previous = this.saves.get(workbenchId) ?? Promise.resolve()
    const next = previous.catch(() => {}).then(() => this.options.persistWorkState?.(workbenchId, state))
    this.saves.set(workbenchId, next)
    try { await next; this.error = undefined; this.emit() }
    catch (error) { this.error = '任务状态保存失败：' + String(error); this.emit(); throw error }
    finally { if (this.saves.get(workbenchId) === next) this.saves.delete(workbenchId) }
  }
  async createWorkItem(input: { areaId: string; objective: string; agentPreset?: string; workspaceId?: string; scope?: string; inputs?: readonly string[]; successCriteria?: readonly string[]; start?: boolean }): Promise<BayAgentWorkItemV1> {
    const workbenchId = this.options.workbenchId
    const snapshot = this.options.inspect(workbenchId)
    if (!snapshot.areas.some(area => area.areaId === input.areaId && !area.archived)) throw new Error('area-not-found')
    const objective = input.objective.trim()
    if (!objective) throw new Error('objective-required')
    const at = this.now()
    const item: BayAgentWorkItemV1 = { workItemId: this.createId('work-item'), workbenchId, areaId: input.areaId, objective,
      ...(input.agentPreset ? { agentPreset: input.agentPreset } : {}), ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
      ...(input.scope?.trim() ? { scope: input.scope.trim() } : {}), inputs: [...(input.inputs ?? [])], successCriteria: [...(input.successCriteria ?? [])],
      status: input.start ? 'queued' : 'proposed', createdAt: at, updatedAt: at }
    this.workItems.set(item.workItemId, item)
    try { await this.save(workbenchId) } catch (error) { this.workItems.delete(item.workItemId); this.emit(); throw error }
    if (input.start) await this.startWorkItem(item.workItemId)
    return structuredClone(this.workItems.get(item.workItemId)!)
  }
  async startWorkItem(workItemId: string): Promise<BayAgentAssignmentV1> {
    const pending = this.starts.get(workItemId)
    if (pending) return pending
    const item = this.requireWorkItem(workItemId), active = this.latestAssignment(item)
    if (active && active.state !== 'ended') return structuredClone(active)
    const operation = this.launch(item)
    this.starts.set(workItemId, operation)
    try { return await operation } finally { this.starts.delete(workItemId) }
  }
  private async launch(item: BayAgentWorkItemV1): Promise<BayAgentAssignmentV1> {
    await this.ensureMainSession(item.workbenchId)
    const lease = this.options.adapter.captureExecutionLease({ workbenchId: item.workbenchId, areaId: item.areaId })
    const prompt = this.options.adapter.capturePrompt({ workbenchId: item.workbenchId, areaId: item.areaId, workItem: projectWorkItem(item) })
    const assignmentId = this.createId('assignment')
    const assignment: BayAgentAssignmentV1 = { assignmentId, runtimeAssignmentId: assignmentId, workItemId: item.workItemId, areaId: item.areaId, runtimeName: this.runtime.name, state: 'pending', createdAt: this.now(), lease }
    this.assignments.set(assignmentId, assignment)
    this.updateItem(item, { status: 'running', currentAssignmentId: assignmentId })
    try { await this.save(item.workbenchId) }
    catch (error) { this.assignments.delete(assignmentId); this.workItems.set(item.workItemId, item); this.emit(); throw error }
    const prepared = async (created: { runtimeAssignmentId: string; sessionId?: string; moduleInstanceId?: string; lease?: WorkbenchBayAgentExecutionLeaseV1 }) => {
      this.assignments.set(assignmentId, { ...this.assignments.get(assignmentId)!, runtimeAssignmentId: created.runtimeAssignmentId,
        ...(created.sessionId ? { workerSessionId: created.sessionId, sessionId: created.sessionId } : {}),
        ...(created.moduleInstanceId ? { moduleInstanceId: created.moduleInstanceId } : {}), ...(created.lease ? { lease: created.lease } : {}) })
      await this.save(item.workbenchId)
    }
    try {
      const result = await this.runtime.createAssignment({ workItem: structuredClone(this.workItems.get(item.workItemId)!), assignment, prompt: renderPrompt(prompt), lease, onPrepared: prepared })
      await prepared(result)
      return structuredClone(this.assignments.get(assignmentId)!)
    } catch (error) {
      const current = this.assignments.get(assignmentId)!
      this.assignments.set(assignmentId, { ...current, state: 'ended', endedAt: this.now(), reportState: 'failed', reportSummary: String(error) })
      this.updateItem(item, { status: 'failed', currentAssignmentId: assignmentId })
      this.addAttention(item, current, 'failed', '派发失败，请检查 Worker 对话后重试：' + String(error))
      await this.save(item.workbenchId)
      throw error
    }
  }
  async acceptWorkItem(id: string): Promise<void> {
    const item = this.requireWorkItem(id)
    if (item.status !== 'ready') throw new Error('Only a ready report can be accepted')
    this.updateItem(item, { status: 'completed' })
    await this.save(item.workbenchId)
  }
  async retryWorkItem(id: string): Promise<void> { await this.startWorkItem(id) }
  async recoverWorkItem(id: string): Promise<void> { await this.startWorkItem(id) }
  async stopWorkItem(id: string, reason = 'stopped-by-operator'): Promise<void> {
    await this.starts.get(id)?.catch(() => {})
    const item = this.requireWorkItem(id), assignment = this.latestAssignment(item)
    if (assignment && assignment.state !== 'ended') {
      await this.runtime.cancelAssignment({ runtimeAssignmentId: assignment.runtimeAssignmentId ?? assignment.assignmentId, reason })
      this.assignments.set(assignment.assignmentId, { ...assignment, state: 'ended', reportState: 'dropped', endedAt: this.now() })
    }
    this.updateItem(item, { status: 'stopped' }); await this.save(item.workbenchId)
  }
  async resolveAttention(id: string, answer?: string): Promise<void> {
    const row = this.attention.get(id); if (!row) throw new Error('attention-not-found')
    if (row.status !== 'open') return
    const item = this.requireWorkItem(row.workItemId)
    if (this.latestAssignment(item)?.nativeInputPending) throw new Error('请先在 Worker 原生对话中处理授权或问题。')
    if (!answer?.trim()) throw new Error('请填写答复或恢复指令。')
    this.updateItem(item, { inputs: [...item.inputs, '操作者答复：' + answer.trim()] })
    await this.save(item.workbenchId)
    await this.recoverWorkItem(item.workItemId)
    this.attention.set(id, { ...row, status: 'resolved', answer: answer.trim(), resolvedAt: this.now() })
    await this.save(item.workbenchId)
  }
  async dismissAttention(id: string): Promise<void> {
    const row = this.attention.get(id); if (!row) throw new Error('attention-not-found')
    this.attention.set(id, { ...row, status: 'dismissed', resolvedAt: this.now() })
    await this.save(this.requireWorkItem(row.workItemId).workbenchId)
  }
  async ensureMainSession(workbenchId = this.options.workbenchId): Promise<string | undefined> {
    const pending = this.mainSessionRequests.get(workbenchId)
    if (pending) return pending
    const operation = (async () => {
      const persisted = this.options.loadMainSession?.(workbenchId)
      let session = persisted ?? this.mainSessions.get(workbenchId)
      if (!session && this.options.sessionCreator) {
        const model = this.options.modelForWorkbench?.(workbenchId)
        session = await this.options.sessionCreator.create({ workbenchId, requestId: 'bay-agent-main:' + workbenchId, ...(model === undefined ? {} : { model }) })
        // Retain a successful creation if the following CAS fails; retry saving
        // the same identity instead of creating another orphan Session.
        this.mainSessions.set(workbenchId, session)
      }
      if (!session) return undefined
      if (!persisted) await this.options.persistMainSession?.(workbenchId, session)
      const model = this.options.modelForWorkbench?.(workbenchId)
      if (model !== undefined) await this.options.configureMainSession?.(workbenchId, session.sessionId, model)
      if (workbenchId === this.options.workbenchId && this.sessionId !== session.sessionId) {
        this.sessionId = session.sessionId
        this.emit()
      }
      return session.sessionId
    })()
    this.mainSessionRequests.set(workbenchId, operation)
    try { return await operation }
    finally { this.mainSessionRequests.delete(workbenchId) }
  }

  private async handleRuntimeEvent(event: BayAgentWorkerRuntimeEventV1): Promise<void> {
    const assignment = [...this.assignments.values()].find(row => row.runtimeAssignmentId === event.runtimeAssignmentId)
    if (!assignment || assignment.state === 'ended') return
    const item = this.workItems.get(assignment.workItemId)
    if (!item || item.currentAssignmentId !== assignment.assignmentId) return
    if (event.type === 'assignment.input_required') {
      if (assignment.nativeInputPending) return
      this.assignments.set(assignment.assignmentId, { ...assignment, nativeInputPending: true })
      this.updateItem(item, { status: 'needs_input' })
      this.addAttention(item, assignment, 'needs_input', event.question)
    } else if (event.type === 'assignment.input_cleared') {
      this.assignments.set(assignment.assignmentId, { ...assignment, nativeInputPending: false })
      this.updateItem(item, { status: 'running' })
      for (const row of this.attention.values()) if (row.assignmentId === assignment.assignmentId && row.status === 'open' && row.kind === 'needs_input') this.attention.set(row.attentionId, { ...row, status: 'resolved', resolvedAt: this.now() })
    } else if (event.type === 'assignment.started') {
      this.assignments.set(assignment.assignmentId, { ...assignment, state: 'running', startedAt: assignment.startedAt ?? this.now(), ...(event.sessionId ? { workerSessionId: event.sessionId, sessionId: event.sessionId } : {}) })
    } else if (event.type === 'assignment.progress' || event.type === 'assignment.report' && event.state === 'progress') {
      this.assignments.set(assignment.assignmentId, { ...assignment, reportState: 'progress', reportSummary: event.summary })
    } else {
      const state = event.type === 'assignment.interrupted' ? 'waiting' : event.type === 'assignment.failed' ? 'failed' : event.state
      const summary = event.type === 'assignment.interrupted' ? 'Worker 执行中断，请检查对话后恢复。' : event.type === 'assignment.failed' ? event.error : event.summary
      this.assignments.set(assignment.assignmentId, { ...assignment, state: 'ended', endedAt: this.now(), reportState: state, reportSummary: summary })
      this.updateItem(item, { status: state === 'dropped' ? 'stopped' : state === 'progress' ? 'running' : state })
      if (state === 'ready' && assignment.lease) {
        try {
          const result = await this.options.adapter.applyAreaAgentReport({ lease: assignment.lease, patch: { summary, completed: [summary] } })
          if (result.status !== 'committed') this.addAttention(item, assignment, 'decision', 'Worker 已报告完成，但区域背景已变化，未覆盖当前背景，请复核。')
        } catch {
          this.addAttention(item, assignment, 'decision', 'Worker 报告已保留，区域背景暂未写回，请复核。')
        }
      }
      if (state === 'blocked' || state === 'failed') this.addAttention(item, assignment, state, event.type === 'assignment.report' && event.question || summary)
      if (state === 'waiting') {
        this.updateItem(item, { status: 'needs_input' })
        this.addAttention(item, assignment, 'needs_input', event.type === 'assignment.report' && event.question || summary)
      }
    }
    await this.save(item.workbenchId)
  }
  private latestAssignment(item: BayAgentWorkItemV1): BayAgentAssignmentV1 | undefined { return item.currentAssignmentId ? this.assignments.get(item.currentAssignmentId) : undefined }
  private requireWorkItem(id: string): BayAgentWorkItemV1 { const item = this.workItems.get(id); if (!item) throw new Error('work-item-not-found'); return item }
  private updateItem(item: BayAgentWorkItemV1, patch: Partial<BayAgentWorkItemV1>): void { this.workItems.set(item.workItemId, { ...this.workItems.get(item.workItemId)!, ...patch, updatedAt: this.now() }) }
  private addAttention(item: BayAgentWorkItemV1, assignment: BayAgentAssignmentV1, kind: BayAgentAttentionV1['kind'], question: string): void {
    if ([...this.attention.values()].some(row => row.assignmentId === assignment.assignmentId && row.status === 'open' && row.kind === kind)) return
    const row: BayAgentAttentionV1 = { attentionId: this.createId('attention'), workItemId: item.workItemId, assignmentId: assignment.assignmentId, areaId: item.areaId, kind, question, status: 'open', createdAt: this.now() }
    this.attention.set(row.attentionId, row)
  }
  private readAreas(): readonly { areaId: string; label: string }[] { try { return this.options.inspect(this.options.workbenchId).areas.filter(area => !area.archived).map(area => ({ areaId: area.areaId, label: area.label })) } catch { return [] } }
  private emit(): void { this.snapshotCache = undefined; for (const listener of this.listeners) listener() }
}

export function projectWorkItem(item: BayAgentWorkItemV1): BayAgentWorkItemV1 { return structuredClone(item) }
function renderPrompt(prompt: unknown): string { return JSON.stringify(prompt, null, 2) }

/** Test/demo fixture only. Production dispatch always uses the Host runtime. */
export function createBayAgentInMemoryWorkerRuntime(options: { name?: string; autoComplete?: boolean; now?: () => number } = {}): BayAgentWorkerRuntimeV1 {
  const listeners = new Set<(event: BayAgentWorkerRuntimeEventV1) => void>(), active = new Map<string, boolean>(), now = options.now ?? (() => Date.now())
  const id = () => `runtime-assignment-${globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)}`
  const emit = (event: BayAgentWorkerRuntimeEventV1) => { for (const listener of listeners) listener(event) }
  const start = (runtimeAssignmentId: string) => { active.set(runtimeAssignmentId, true); setTimeout(() => { emit({ type: 'assignment.started', runtimeAssignmentId }); if (options.autoComplete !== false) emit({ type: 'assignment.report', runtimeAssignmentId, state: 'ready', summary: `实验 Worker 已完成（${now()}）` }) }, 0) }
  return {
    name: options.name ?? 'bay-agent-memory-worker',
    async createAssignment() { const runtimeAssignmentId = id(); start(runtimeAssignmentId); return { runtimeAssignmentId } },
    async cancelAssignment({ runtimeAssignmentId }) { if (active.get(runtimeAssignmentId)) { active.delete(runtimeAssignmentId); emit({ type: 'assignment.interrupted', runtimeAssignmentId }) } },
    async retryAssignment() { const runtimeAssignmentId = id(); start(runtimeAssignmentId); return { runtimeAssignmentId } },
    async recoverAssignment() { const runtimeAssignmentId = id(); start(runtimeAssignmentId); return { runtimeAssignmentId } },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) },
  }
}

/**
 * Adapter seam for a real external Worker Runtime. The Core only knows this
 * small client contract; it never imports the runtime implementation.
 */
export interface BayAgentExternalWorkerRuntimeClientV1 {
  createAssignment(input: { workItem: BayAgentWorkItemV1; prompt: string; lease: WorkbenchBayAgentExecutionLeaseV1 }): Promise<{ runtimeAssignmentId: string; sessionId?: string }>
  cancelAssignment(input: { runtimeAssignmentId: string; reason?: string }): Promise<void>
  retryAssignment(input: { runtimeAssignmentId: string; prompt: string; lease: WorkbenchBayAgentExecutionLeaseV1 }): Promise<{ runtimeAssignmentId: string; sessionId?: string }>
  recoverAssignment(input: { workItem: BayAgentWorkItemV1; assignment: BayAgentAssignmentV1; prompt: string; lease: WorkbenchBayAgentExecutionLeaseV1 }): Promise<{ runtimeAssignmentId: string; sessionId?: string }>
  subscribe(listener: (event: BayAgentWorkerRuntimeEventV1) => void): () => void
}

export function createBayAgentExternalWorkerRuntimeAdapter(
  client: BayAgentExternalWorkerRuntimeClientV1,
  name = 'external-worker-runtime',
): BayAgentWorkerRuntimeV1 {
  return {
    name,
    createAssignment: input => client.createAssignment(input),
    cancelAssignment: input => client.cancelAssignment(input),
    retryAssignment: input => client.retryAssignment(input),
    recoverAssignment: input => client.recoverAssignment(input),
    subscribe: listener => client.subscribe(listener),
  }
}

/** Named compatibility constructor for the planned dsh-superagent bridge.
 * The client is injected so Core stays independent from that runtime's code. */
export function createDshSuperagentWorkerRuntimeAdapter(
  client: BayAgentExternalWorkerRuntimeClientV1,
): BayAgentWorkerRuntimeV1 {
  return createBayAgentExternalWorkerRuntimeAdapter(client, 'dsh-superagent')
}
