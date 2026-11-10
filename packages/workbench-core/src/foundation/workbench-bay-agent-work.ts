import type { WorkbenchBayAgentAdapter, WorkbenchBayAgentExecutionLeaseV1 } from './workbench-bay-agent-adapter.ts'
import type { WorkbenchControlPlaneSnapshotV1 } from './workbench-control-plane.ts'

/** Bay Agent's durable, Workbench-owned unit of intent. */
export type BayAgentWorkItemStatusV1 =
  | 'proposed' | 'queued' | 'running' | 'waiting' | 'needs_input'
  | 'ready' | 'blocked' | 'failed' | 'completed' | 'stopped'

export interface BayAgentWorkItemV1 {
  importedFrom?: { workbenchId: string; status: BayAgentWorkItemStatusV1 }
  workItemId: string
  workbenchId: string
  areaId: string
  projectId?: string
  projectResolution?: 'unresolved'
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
  importedFrom?: { state: 'pending' | 'running' | 'ended'; runtimeAssignmentId?: string }
  assignmentId: string
  workItemId: string
  areaId: string
  projectId?: string
  projectResolution?: 'unresolved'
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
  projectId?: string
  projectResolution?: 'unresolved'
  kind: 'needs_input' | 'blocked' | 'failed' | 'decision'
  question: string
  status: 'open' | 'resolved' | 'dismissed'
  createdAt: number
  resolvedAt?: number
  answer?: string
}

export type BayAgentOrchestrationEventKindV1 =
  | 'work-item.created'
  | 'work-item.status'
  | 'work-item.accepted'
  | 'work-item.recovered'
  | 'assignment.created'
  | 'assignment.started'
  | 'assignment.progress'
  | 'assignment.report'
  | 'assignment.failed'
  | 'assignment.interrupted'
  | 'attention.opened'
  | 'attention.resolved'
  | 'attention.dismissed'
  | 'context.patch.committed'
  | 'context.patch.conflicted'

/**
 * The orchestration ledger contains coordination facts only. It deliberately
 * excludes transcripts, credentials, absolute paths and complete session
 * content; those remain owned by the native Session runtime.
 */
export interface BayAgentOrchestrationEventV1 {
  schemaVersion: 1
  eventId: string
  seq: number
  workbenchId: string
  kind: BayAgentOrchestrationEventKindV1
  createdAt: number
  source: 'bay-agent' | 'worker' | 'human' | 'runtime'
  idempotencyKey?: string
  payload: Readonly<Record<string, unknown>>
}

/** Metadata left behind when old ledger rows are compacted. */
export interface BayAgentOrchestrationCheckpointV1 {
  schemaVersion: 1
  workbenchId: string
  compactedThroughSeq: number
  compactedAt: number
  retainedEventCount: number
  countsByKind: Readonly<Record<string, number>>
  summary: string
}

/** A deliberately detached event projection suitable for a Workbench package. */
export interface PortableBayAgentEventV1 {
  schemaVersion: 1
  eventId: string
  seq: number
  kind: BayAgentOrchestrationEventKindV1
  createdAt: number
  source: 'bay-agent' | 'worker' | 'human' | 'runtime'
  payload: Readonly<Record<string, unknown>>
}

export interface PortableBayAgentOrchestrationV1 {
  schemaVersion: 1
  currentEventSeq: number
  events: readonly PortableBayAgentEventV1[]
  compactedThroughSeq?: number
  checkpoint?: Omit<BayAgentOrchestrationCheckpointV1, 'workbenchId'>
}

export function validatePortableBayAgentOrchestration(value: unknown): asserts value is PortableBayAgentOrchestrationV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Bay Agent portable orchestration is invalid')
  if (/(?:"(?:workbenchId|runtimeAssignmentId|workerSessionId|moduleInstanceId|sessionId|workspaceId|credential|token|secret|password|transcript|absolutePath|filePath)"\s*:)/iu.test(JSON.stringify(value))) throw new Error('Bay Agent portable orchestration contains local or sensitive identity')
  const row = value as PortableBayAgentOrchestrationV1
  if (row.schemaVersion !== 1 || !Number.isSafeInteger(row.currentEventSeq) || row.currentEventSeq < 0 || !Array.isArray(row.events) || row.events.length > 512) throw new Error('Bay Agent portable orchestration is invalid')
  let previous = 0
  const eventIds = new Set<string>()
  for (const event of row.events) {
    if (!event || typeof event !== 'object' || event.schemaVersion !== 1 || typeof event.eventId !== 'string' || eventIds.has(event.eventId) || !Number.isSafeInteger(event.seq) || event.seq <= previous || event.seq > row.currentEventSeq || typeof event.kind !== 'string' || !Number.isFinite(event.createdAt) || !['bay-agent', 'worker', 'human', 'runtime'].includes(event.source) || !event.payload || typeof event.payload !== 'object' || Array.isArray(event.payload)) throw new Error('Bay Agent portable event is invalid')
    eventIds.add(event.eventId)
    previous = event.seq
  }
  if (row.compactedThroughSeq !== undefined && (!Number.isSafeInteger(row.compactedThroughSeq) || row.compactedThroughSeq < 0 || row.compactedThroughSeq >= row.currentEventSeq)) throw new Error('Bay Agent portable checkpoint range is invalid')
  if (row.checkpoint !== undefined && (row.checkpoint.schemaVersion !== 1 || !Number.isSafeInteger(row.checkpoint.compactedThroughSeq) || row.checkpoint.compactedThroughSeq < 0 || !Number.isFinite(row.checkpoint.compactedAt) || !Number.isSafeInteger(row.checkpoint.retainedEventCount) || row.checkpoint.retainedEventCount < 0 || typeof row.checkpoint.summary !== 'string')) throw new Error('Bay Agent portable checkpoint is invalid')
}

/** Build the same detached projection used by package export from a persisted state. */
export function portableBayAgentOrchestrationFromState(state: BayAgentWorkStateV1): PortableBayAgentOrchestrationV1 {
  const events = [...state.events ?? []].sort((a, b) => a.seq - b.seq)
  const aliases = new Map<string, Map<string, string>>()
  const idAlias = (value: string, prefix: string) => { const alias = aliases.get(prefix) ?? new Map<string, string>(); aliases.set(prefix, alias); if (!alias.has(value)) alias.set(value, `${prefix}-${alias.size + 1}`); return alias.get(value)! }
  const scrub = (value: unknown, key = '', depth = 0): unknown => {
    if (depth > 5 || /(?:workbenchId|runtimeAssignmentId|workerSessionId|moduleInstanceId|sessionId|workspaceId|lease|credential|token|secret|password|transcript|absolute.?path|file.?path)/iu.test(key)) return undefined
    if (typeof value === 'string') {
      if (/workItemId/i.test(key)) return idAlias(value, 'work-item')
      if (/assignmentId/i.test(key)) return idAlias(value, 'assignment')
      if (/attentionId/i.test(key)) return idAlias(value, 'attention')
      return sanitizeEventText(value, 2000)
    }
    if (Array.isArray(value)) return value.slice(0, 32).map((entry, index) => scrub(entry, String(index), depth + 1)).filter(entry => entry !== undefined)
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).flatMap(([childKey, child]) => { const next = scrub(child, childKey, depth + 1); return next === undefined ? [] : [[childKey, next]] }))
    return value
  }
  const checkpoint = state.checkpoint
  const portableCheckpoint = checkpoint === undefined ? undefined : (({ workbenchId: _workbenchId, ...value }) => value)(checkpoint)
  return structuredClone({ schemaVersion: 1 as const, currentEventSeq: Math.max(state.nextEventSeq === undefined ? 0 : state.nextEventSeq - 1, events.at(-1)?.seq ?? 0), events: events.map(event => ({ schemaVersion: 1 as const, eventId: `event-${event.seq}`, seq: event.seq, kind: event.kind, createdAt: event.createdAt, source: event.source, payload: scrub(event.payload) as Readonly<Record<string, unknown>> })), ...(checkpoint?.compactedThroughSeq === undefined ? {} : { compactedThroughSeq: checkpoint.compactedThroughSeq }), ...(portableCheckpoint === undefined ? {} : { checkpoint: portableCheckpoint }) })
}

export interface BayAgentOrchestrationProjectionV1 {
  workbenchId: string
  currentEventSeq: number
  activeWorkItems: readonly Pick<BayAgentWorkItemV1, 'workItemId' | 'areaId' | 'objective' | 'status' | 'currentAssignmentId'>[]
  activeAssignments: readonly Pick<BayAgentAssignmentV1, 'assignmentId' | 'workItemId' | 'areaId' | 'runtimeName' | 'state' | 'reportState' | 'reportSummary'>[]
  openAttention: readonly BayAgentAttentionV1[]
  recentReports: readonly { eventId: string; seq: number; assignmentId?: string; workItemId?: string; state?: string; summary?: string; createdAt: number }[]
  recentBlockers: readonly { eventId: string; seq: number; workItemId?: string; summary?: string; createdAt: number }[]
  recentDecisions: readonly { eventId: string; seq: number; summary?: string; createdAt: number }[]
  recentEvents: readonly BayAgentOrchestrationEventV1[]
  compactedThroughSeq?: number
  checkpoint?: BayAgentOrchestrationCheckpointV1
}

export type BayAgentWorkerRuntimeEventV1 =
  | { type: 'assignment.input_required'; runtimeAssignmentId: string; question: string }
  | { type: 'assignment.input_cleared'; runtimeAssignmentId: string }
  | { type: 'assignment.started'; runtimeAssignmentId: string; sessionId?: string }
  | { type: 'assignment.progress'; runtimeAssignmentId: string; summary: string }
  | { type: 'assignment.report'; runtimeAssignmentId: string; state: BayAgentReportStateV1; summary: string; question?: string }
  | { type: 'assignment.failed'; runtimeAssignmentId: string; error: string }
  | { type: 'assignment.interrupted'; runtimeAssignmentId: string }

/** Formal cross-process envelope. The eventId is the idempotency identity. */
export interface BayAgentWorkerRuntimeEventEnvelopeV1 {
  schemaVersion: 1
  eventId: string
  emittedAt: number
  runtimeName: string
  runtimeAssignmentId: string
  /** V18 identity coordinates. Optional only for the alpha compatibility adapter. */
  workbenchId?: string
  workItemId?: string
  assignmentId?: string
  sessionId?: string
  runtimeEpoch?: string
  sequence?: number
  event: BayAgentWorkerRuntimeEventV1
}

export interface BayAgentWorkerRuntimeV1 {
  readonly name: string
  readonly capabilities?: {
    dispatch: boolean
    reuseSession: boolean
    observe: boolean
    pause: boolean
    resume: boolean
    migrateSession: boolean
    eventEnvelope: 1
  }
  createAssignment(input: {
    previousAssignment?: BayAgentAssignmentV1
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
  /** Preferred transport for external runtimes; subscribe remains for V1 compatibility. */
  subscribeEnvelope?(listener: (envelope: BayAgentWorkerRuntimeEventEnvelopeV1) => void): () => void
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
  orchestration: BayAgentOrchestrationProjectionV1
  error?: string
  agentModes?: readonly { id: string; name: string; description?: string }[]
  /** Host-reported composition capabilities for the selectable Worker modes. */
  agentModeCapabilities?: readonly {
    id: string
    name: string
    known: boolean
    compaction: boolean
    toolResultPruner: boolean
    ptc: boolean
    subagents: boolean
  }[]
}

/** Local runtime identities are intentionally excluded from portable packages. */
export interface BayAgentWorkStateV1 {
  version: 1
  workItems: BayAgentWorkItemV1[]
  assignments: BayAgentAssignmentV1[]
  attention: BayAgentAttentionV1[]
  /** Additive ledger fields; omitted by pre-ledger V1 files. */
  events?: BayAgentOrchestrationEventV1[]
  nextEventSeq?: number
  checkpoint?: BayAgentOrchestrationCheckpointV1
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
  private readonly events = new Map<string, BayAgentOrchestrationEventV1>()
  private readonly nextEventSeq = new Map<string, number>()
  private readonly checkpoints = new Map<string, BayAgentOrchestrationCheckpointV1>()
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
  private readonly unsubscribeRuntimeEnvelope: (() => void) | undefined

  constructor(private readonly options: CreateBayAgentControllerOptionsV1) {
    this.runtime = options.runtime
    this.now = options.now ?? (() => Date.now())
    this.createId = options.createId ?? defaultId
    this.sessionId = options.loadMainSession?.(options.workbenchId)?.sessionId
    this.unsubscribeRuntime = options.runtime.subscribe(event => {
      return this.handleRuntimeEvent(event).catch(error => { this.error = String(error); this.emit(); throw error })
    })
    this.unsubscribeRuntimeEnvelope = options.runtime.subscribeEnvelope?.(envelope => {
      return this.handleRuntimeEnvelope(envelope).catch(error => { this.error = String(error); this.emit(); throw error })
    })
    this.load(options.workbenchId)
  }
  dispose(): void { this.unsubscribeRuntime(); this.unsubscribeRuntimeEnvelope?.(); this.listeners.clear() }
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
      orchestration: this.getOrchestrationProjection(),
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
    for (const event of state.events ?? []) if (event.workbenchId === workbenchId && !this.events.has(event.eventId)) this.events.set(event.eventId, structuredClone(event))
    if (state.checkpoint?.workbenchId === workbenchId) this.checkpoints.set(workbenchId, structuredClone(state.checkpoint))
    const maxEventSeq = [...this.events.values()].filter(event => event.workbenchId === workbenchId).reduce((max, event) => Math.max(max, event.seq), 0)
    this.nextEventSeq.set(workbenchId, Math.max(state.nextEventSeq ?? 1, maxEventSeq + 1))
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
    const events = [...this.events.values()].filter(row => row.workbenchId === workbenchId).sort((a, b) => a.seq - b.seq)
    const checkpoint = this.checkpoints.get(workbenchId)
    return structuredClone({ version: 1, workItems, assignments: [...this.assignments.values()].filter(row => ids.has(row.workItemId)), attention: [...this.attention.values()].filter(row => ids.has(row.workItemId)), events, nextEventSeq: this.nextEventSeq.get(workbenchId) ?? 1, ...(checkpoint === undefined ? {} : { checkpoint }) })
  }
  getOrchestrationProjection(): BayAgentOrchestrationProjectionV1 {
    const workbenchId = this.options.workbenchId
    const state = this.state(workbenchId)
    const events = [...(state.events ?? [])].sort((a, b) => a.seq - b.seq)
    const activeWorkItems = state.workItems.filter(item => !['completed', 'stopped'].includes(item.status)).map(item => ({
      workItemId: item.workItemId, areaId: item.areaId, objective: item.objective, status: item.status, ...(item.currentAssignmentId ? { currentAssignmentId: item.currentAssignmentId } : {}),
    }))
    const activeAssignments = state.assignments.filter(assignment => assignment.state !== 'ended').map(assignment => ({
      assignmentId: assignment.assignmentId, workItemId: assignment.workItemId, areaId: assignment.areaId, runtimeName: assignment.runtimeName,
      state: assignment.state, ...(assignment.reportState ? { reportState: assignment.reportState } : {}), ...(assignment.reportSummary ? { reportSummary: assignment.reportSummary } : {}),
    }))
    const eventSummary = (event: BayAgentOrchestrationEventV1) => ({ eventId: event.eventId, seq: event.seq, ...(typeof event.payload.assignmentId === 'string' ? { assignmentId: event.payload.assignmentId } : {}), ...(typeof event.payload.workItemId === 'string' ? { workItemId: event.payload.workItemId } : {}), ...(typeof event.payload.state === 'string' ? { state: event.payload.state } : {}), ...(typeof event.payload.summary === 'string' ? { summary: event.payload.summary } : {}), createdAt: event.createdAt })
    const reports = events.filter(event => ['assignment.progress', 'assignment.report', 'assignment.failed', 'assignment.interrupted'].includes(event.kind)).slice(-12).reverse().map(eventSummary)
    const blockers = events.filter(event => event.kind === 'assignment.failed' || (event.kind === 'assignment.report' && event.payload.state === 'blocked') || event.kind === 'attention.opened' && event.payload.kind === 'blocked').slice(-8).reverse().map(eventSummary)
    const decisions = events.filter(event => ['attention.resolved', 'attention.dismissed', 'context.patch.committed', 'context.patch.conflicted', 'work-item.accepted'].includes(event.kind)).slice(-8).reverse().map(eventSummary)
    const checkpoint = this.checkpoints.get(workbenchId)
    return structuredClone({ workbenchId, currentEventSeq: Math.max(0, (this.nextEventSeq.get(workbenchId) ?? 1) - 1), activeWorkItems, activeAssignments, openAttention: state.attention.filter(row => row.status === 'open'), recentReports: reports, recentBlockers: blockers, recentDecisions: decisions, recentEvents: events.slice(-12).reverse(), ...(checkpoint === undefined ? {} : { compactedThroughSeq: checkpoint.compactedThroughSeq, checkpoint }) })
  }
  listOrchestrationEvents(input: { workItemId?: string; assignmentId?: string; afterSeq?: number; limit?: number } = {}): readonly BayAgentOrchestrationEventV1[] {
    const workbenchId = this.options.workbenchId
    const requestedLimit = input.limit ?? 50, limit = Number.isFinite(requestedLimit) ? Math.min(100, Math.max(1, Math.floor(requestedLimit))) : 50
    const requestedAfterSeq = input.afterSeq ?? 0, afterSeq = Number.isFinite(requestedAfterSeq) ? Math.max(0, Math.floor(requestedAfterSeq)) : 0
    return structuredClone([...this.events.values()].filter(event => event.workbenchId === workbenchId && event.seq > afterSeq
      && (input.workItemId === undefined || event.payload.workItemId === input.workItemId)
      && (input.assignmentId === undefined || event.payload.assignmentId === input.assignmentId)).sort((a, b) => a.seq - b.seq).slice(-limit))
  }
  /** Export only coordination facts; local runtime/session identities are removed. */
  getPortableOrchestration(): PortableBayAgentOrchestrationV1 {
    return portableBayAgentOrchestrationFromState(this.state(this.options.workbenchId))
  }
  /** Record a context write outcome without copying the context value into the ledger. */
  async recordContextPatch(input: { projectId?: string; areaId?: string; expectedRevision: number; status: 'committed' | 'conflict'; actualRevision?: number; patchFields: readonly string[] }): Promise<void> {
    const workbenchId = this.options.workbenchId
    const event = this.recordEvent(workbenchId, input.status === 'committed' ? 'context.patch.committed' : 'context.patch.conflicted', {
      ...(input.projectId ? { projectId: input.projectId } : {}), ...(input.areaId ? { areaId: input.areaId } : {}), expectedRevision: input.expectedRevision, ...(input.actualRevision === undefined ? {} : { actualRevision: input.actualRevision }), patchFields: [...input.patchFields],
    }, { source: 'bay-agent', idempotencyKey: `context:${input.projectId ?? input.areaId ?? 'workbench'}:${input.expectedRevision}:${input.status}:${input.patchFields.join(',')}` })
    try { await this.save(workbenchId) } catch (error) { if (event) this.removeEvent(event.eventId); throw error }
  }
  private hasEventKey(workbenchId: string, idempotencyKey: string): boolean {
    return [...this.events.values()].some(event => event.workbenchId === workbenchId && event.idempotencyKey === idempotencyKey)
  }
  private recordEvent(workbenchId: string, kind: BayAgentOrchestrationEventKindV1, payload: Record<string, unknown>, options: { source?: BayAgentOrchestrationEventV1['source']; idempotencyKey?: string } = {}): BayAgentOrchestrationEventV1 | undefined {
    if (options.idempotencyKey && this.hasEventKey(workbenchId, options.idempotencyKey)) return undefined
    const seq = this.nextEventSeq.get(workbenchId) ?? 1
    const event: BayAgentOrchestrationEventV1 = { schemaVersion: 1, eventId: this.createId('event'), seq, workbenchId, kind, createdAt: this.now(), source: options.source ?? 'bay-agent', ...(options.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : {}), payload: sanitizeEventPayload(payload) }
    this.events.set(event.eventId, event)
    this.nextEventSeq.set(workbenchId, seq + 1)
    return event
  }
  private removeEvent(eventId: string): void { this.events.delete(eventId) }
  private removeEventByKey(workbenchId: string, idempotencyKey: string): void {
    for (const event of this.events.values()) if (event.workbenchId === workbenchId && event.idempotencyKey === idempotencyKey) this.events.delete(event.eventId)
  }
  private async save(workbenchId: string): Promise<void> {
    this.compact(workbenchId)
    const state = this.state(workbenchId)
    const previous = this.saves.get(workbenchId) ?? Promise.resolve()
    const next = previous.catch(() => {}).then(() => this.options.persistWorkState?.(workbenchId, state))
    this.saves.set(workbenchId, next)
    try { await next; this.error = undefined; this.emit() }
    catch (error) { this.error = '任务状态保存失败：' + String(error); this.emit(); throw error }
    finally { if (this.saves.get(workbenchId) === next) this.saves.delete(workbenchId) }
  }
  private compact(workbenchId: string): void {
    const rows = [...this.events.values()].filter(event => event.workbenchId === workbenchId).sort((a, b) => a.seq - b.seq)
    if (rows.length <= 512) return
    const retained = rows.slice(-128)
    const removed = rows.slice(0, -128)
    if (!removed.length) return
    const countsByKind: Record<string, number> = {}
    for (const event of removed) countsByKind[event.kind] = (countsByKind[event.kind] ?? 0) + 1
    const checkpoint: BayAgentOrchestrationCheckpointV1 = { schemaVersion: 1, workbenchId, compactedThroughSeq: removed[removed.length - 1]!.seq, compactedAt: this.now(), retainedEventCount: retained.length, countsByKind, summary: `${removed.length} orchestration events compacted through seq ${removed[removed.length - 1]!.seq}` }
    for (const event of removed) this.events.delete(event.eventId)
    this.checkpoints.set(workbenchId, checkpoint)
  }
  async createWorkItem(input: { areaId: string; objective: string; agentPreset?: string; workspaceId?: string; scope?: string; inputs?: readonly string[]; successCriteria?: readonly string[]; start?: boolean }): Promise<BayAgentWorkItemV1> {
    const workbenchId = this.options.workbenchId
    const snapshot = this.options.inspect(workbenchId)
    if (!snapshot.areas.some(area => area.areaId === input.areaId && !area.archived)) throw new Error('area-not-found')
    const objective = input.objective.trim()
    if (!objective) throw new Error('objective-required')
    const at = this.now()
    const item: BayAgentWorkItemV1 = { workItemId: this.createId('work-item'), workbenchId, areaId: input.areaId, ...(snapshot.areas.find(row => row.areaId === input.areaId)?.project?.projectId ? { projectId: snapshot.areas.find(row => row.areaId === input.areaId)!.project!.projectId! } : {}), objective,
      ...(input.agentPreset ? { agentPreset: input.agentPreset } : {}), ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
      ...(input.scope?.trim() ? { scope: input.scope.trim() } : {}), inputs: [...(input.inputs ?? [])], successCriteria: [...(input.successCriteria ?? [])],
      status: input.start ? 'queued' : 'proposed', createdAt: at, updatedAt: at }
    const createdEvent = this.recordEvent(workbenchId, 'work-item.created', { workItemId: item.workItemId, areaId: item.areaId, objective: item.objective, status: item.status }, { idempotencyKey: `work-item.created:${item.workItemId}` })
    this.workItems.set(item.workItemId, item)
    try { await this.save(workbenchId) } catch (error) { this.workItems.delete(item.workItemId); if (createdEvent) this.removeEvent(createdEvent.eventId); this.emit(); throw error }
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
    if (item.projectId && !this.options.inspect(item.workbenchId).areas.some(area => area.project?.projectId === item.projectId && !area.archived)) throw new Error('请先在新区域打开此项目，再继续任务。')
    if (item.projectResolution === 'unresolved') throw new Error('此历史任务的项目归属尚未确认，请先处理待整理记录。')
    const previousAssignment = this.latestAssignment(item)
    await this.ensureMainSession(item.workbenchId)
    const lease = this.options.adapter.captureExecutionLease({ workbenchId: item.workbenchId, areaId: item.areaId, ...(item.projectId ? { projectId: item.projectId } : {}) })
    const prompt = this.options.adapter.capturePrompt({ workbenchId: item.workbenchId, areaId: item.areaId, ...(item.projectId ? { projectId: item.projectId } : {}), workItem: projectWorkItem(item) })
    const assignmentId = this.createId('assignment')
    const assignment: BayAgentAssignmentV1 = { assignmentId, runtimeAssignmentId: assignmentId, workItemId: item.workItemId, areaId: item.areaId, ...(item.projectId ? { projectId: item.projectId } : {}), runtimeName: this.runtime.name, state: 'pending', createdAt: this.now(), lease }
    const createdEvent = this.recordEvent(item.workbenchId, 'assignment.created', { assignmentId, workItemId: item.workItemId, areaId: item.areaId, ...(item.projectId ? { projectId: item.projectId } : {}), runtimeName: this.runtime.name }, { idempotencyKey: `assignment.created:${assignmentId}` })
    this.assignments.set(assignmentId, assignment)
    this.updateItem(item, { status: 'running', currentAssignmentId: assignmentId })
    try { await this.save(item.workbenchId) }
    catch (error) { this.assignments.delete(assignmentId); this.workItems.set(item.workItemId, item); if (createdEvent) this.removeEvent(createdEvent.eventId); this.removeEventByKey(item.workbenchId, `work-item.status:${item.workItemId}:${item.updatedAt}:running`); this.emit(); throw error }
    const prepared = async (created: { runtimeAssignmentId: string; sessionId?: string; moduleInstanceId?: string; lease?: WorkbenchBayAgentExecutionLeaseV1 }) => {
      this.assignments.set(assignmentId, { ...this.assignments.get(assignmentId)!, runtimeAssignmentId: created.runtimeAssignmentId,
        ...(created.sessionId ? { workerSessionId: created.sessionId, sessionId: created.sessionId } : {}),
        ...(created.moduleInstanceId ? { moduleInstanceId: created.moduleInstanceId } : {}), ...(created.lease ? { lease: created.lease } : {}) })
      await this.save(item.workbenchId)
    }
    try {
      const result = await this.runtime.createAssignment({ workItem: structuredClone(this.workItems.get(item.workItemId)!), assignment, ...(previousAssignment ? { previousAssignment: structuredClone(previousAssignment) } : {}), prompt: renderPrompt(prompt), lease, onPrepared: prepared })
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
    this.recordEvent(item.workbenchId, 'work-item.accepted', { workItemId: id, ...(item.currentAssignmentId ? { assignmentId: item.currentAssignmentId } : {}) }, { idempotencyKey: `work-item.accepted:${id}:${item.currentAssignmentId ?? ''}` })
    this.updateItem(item, { status: 'completed' })
    await this.save(item.workbenchId)
  }
  async retryWorkItem(id: string): Promise<void> { await this.startWorkItem(id) }
  async recoverWorkItem(id: string): Promise<void> {
    const item = this.requireWorkItem(id)
    this.recordEvent(item.workbenchId, 'work-item.recovered', { workItemId: id, previousStatus: item.status }, { idempotencyKey: `work-item.recovered:${id}:${item.updatedAt}` })
    await this.startWorkItem(id)
  }
  async stopWorkItem(id: string, reason = 'stopped-by-operator'): Promise<void> {
    await this.starts.get(id)?.catch(() => {})
    const item = this.requireWorkItem(id), assignment = this.latestAssignment(item)
    if (assignment && assignment.state !== 'ended') {
      await this.runtime.cancelAssignment({ runtimeAssignmentId: assignment.runtimeAssignmentId ?? assignment.assignmentId, reason })
      this.recordEvent(item.workbenchId, 'assignment.interrupted', { assignmentId: assignment.assignmentId, workItemId: item.workItemId, summary: reason }, { idempotencyKey: `assignment.interrupted:${assignment.assignmentId}` })
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
    this.recordEvent(item.workbenchId, 'attention.resolved', { attentionId: id, workItemId: row.workItemId, summary: answer.trim() }, { idempotencyKey: `attention.resolved:${id}` })
    this.attention.set(id, { ...row, status: 'resolved', answer: answer.trim(), resolvedAt: this.now() })
    await this.save(item.workbenchId)
  }
  async dismissAttention(id: string): Promise<void> {
    const row = this.attention.get(id); if (!row) throw new Error('attention-not-found')
    const workbenchId = this.requireWorkItem(row.workItemId).workbenchId
    this.recordEvent(workbenchId, 'attention.dismissed', { attentionId: id, workItemId: row.workItemId, summary: row.question }, { idempotencyKey: `attention.dismissed:${id}` })
    this.attention.set(id, { ...row, status: 'dismissed', resolvedAt: this.now() })
    await this.save(workbenchId)
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

  private async handleRuntimeEnvelope(envelope: BayAgentWorkerRuntimeEventEnvelopeV1): Promise<void> {
    if (envelope.schemaVersion !== 1 || !envelope.eventId || envelope.runtimeAssignmentId !== envelope.event.runtimeAssignmentId) return
    if (envelope.sequence !== undefined && (!Number.isSafeInteger(envelope.sequence) || envelope.sequence < 1)) return
    await this.handleRuntimeEvent(envelope.event, envelope)
  }
  private async handleRuntimeEvent(event: BayAgentWorkerRuntimeEventV1, envelope?: BayAgentWorkerRuntimeEventEnvelopeV1): Promise<void> {
    const assignment = [...this.assignments.values()].find(row => row.runtimeAssignmentId === event.runtimeAssignmentId)
    if (!assignment || assignment.state === 'ended') return
    const item = this.workItems.get(assignment.workItemId)
    if (!item || item.currentAssignmentId !== assignment.assignmentId) return
    const runtimeEventKey = envelope === undefined
      ? `runtime:${assignment.assignmentId}:${eventDigest(JSON.stringify(event))}`
      : `runtime-envelope:${envelope.eventId}`
    const runtimeMetadata = envelope === undefined ? {} : { runtimeEventId: envelope.eventId, runtimeName: envelope.runtimeName, emittedAt: envelope.emittedAt }
    if (this.hasEventKey(item.workbenchId, runtimeEventKey)) return
    if (event.type === 'assignment.input_required') {
      if (assignment.nativeInputPending) return
      this.recordEvent(item.workbenchId, 'assignment.progress', { assignmentId: assignment.assignmentId, workItemId: item.workItemId, state: 'needs_input', summary: event.question, ...runtimeMetadata }, { source: 'runtime', idempotencyKey: runtimeEventKey })
      this.assignments.set(assignment.assignmentId, { ...assignment, nativeInputPending: true })
      this.updateItem(item, { status: 'needs_input' })
      this.addAttention(item, assignment, 'needs_input', event.question)
    } else if (event.type === 'assignment.input_cleared') {
      this.recordEvent(item.workbenchId, 'assignment.progress', { assignmentId: assignment.assignmentId, workItemId: item.workItemId, state: 'running', summary: 'native input cleared', ...runtimeMetadata }, { source: 'runtime', idempotencyKey: runtimeEventKey })
      this.assignments.set(assignment.assignmentId, { ...assignment, nativeInputPending: false })
      this.updateItem(item, { status: 'running' })
      for (const row of this.attention.values()) if (row.assignmentId === assignment.assignmentId && row.status === 'open' && row.kind === 'needs_input') {
        this.recordEvent(item.workbenchId, 'attention.resolved', { attentionId: row.attentionId, workItemId: item.workItemId, summary: 'native input cleared' }, { source: 'runtime', idempotencyKey: `${runtimeEventKey}:attention:${row.attentionId}` })
        this.attention.set(row.attentionId, { ...row, status: 'resolved', resolvedAt: this.now() })
      }
    } else if (event.type === 'assignment.started') {
      this.recordEvent(item.workbenchId, 'assignment.started', { assignmentId: assignment.assignmentId, workItemId: item.workItemId, ...(event.sessionId ? { workerSessionId: event.sessionId } : {}), ...runtimeMetadata }, { source: 'runtime', idempotencyKey: runtimeEventKey })
      this.assignments.set(assignment.assignmentId, { ...assignment, state: 'running', startedAt: assignment.startedAt ?? this.now(), ...(event.sessionId ? { workerSessionId: event.sessionId, sessionId: event.sessionId } : {}) })
    } else if (event.type === 'assignment.progress' || event.type === 'assignment.report' && event.state === 'progress') {
      this.recordEvent(item.workbenchId, 'assignment.progress', { assignmentId: assignment.assignmentId, workItemId: item.workItemId, state: 'progress', summary: event.summary, ...runtimeMetadata }, { source: 'runtime', idempotencyKey: runtimeEventKey })
      this.assignments.set(assignment.assignmentId, { ...assignment, reportState: 'progress', reportSummary: event.summary })
    } else {
      const state = event.type === 'assignment.interrupted' ? 'waiting' : event.type === 'assignment.failed' ? 'failed' : event.state
      const summary = event.type === 'assignment.interrupted' ? 'Worker 执行中断，请检查对话后恢复。' : event.type === 'assignment.failed' ? event.error : event.summary
      this.recordEvent(item.workbenchId, event.type === 'assignment.interrupted' ? 'assignment.interrupted' : event.type === 'assignment.failed' ? 'assignment.failed' : 'assignment.report', { assignmentId: assignment.assignmentId, workItemId: item.workItemId, state, summary, ...runtimeMetadata }, { source: event.type === 'assignment.report' ? 'worker' : 'runtime', idempotencyKey: runtimeEventKey })
      this.assignments.set(assignment.assignmentId, { ...assignment, state: 'ended', endedAt: this.now(), reportState: state, reportSummary: summary })
      this.updateItem(item, { status: state === 'dropped' ? 'stopped' : state === 'progress' ? 'running' : state })
      if (state === 'ready' && assignment.lease) {
        try {
          const result = await this.options.adapter.applyAreaAgentReport({ lease: assignment.lease, patch: { summary, completed: [summary] } })
          if (result.status !== 'committed') this.addAttention(item, assignment, 'decision', 'Worker 已报告完成，但项目背景已变化，未覆盖当前背景，请复核。')
        } catch {
          this.addAttention(item, assignment, 'decision', 'Worker 报告已保留，项目背景暂未写回，请复核。')
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
  private updateItem(item: BayAgentWorkItemV1, patch: Partial<BayAgentWorkItemV1>): void {
    const current = this.workItems.get(item.workItemId)!
    if (patch.status !== undefined && patch.status !== current.status) this.recordEvent(item.workbenchId, 'work-item.status', { workItemId: item.workItemId, from: current.status, to: patch.status }, { idempotencyKey: `work-item.status:${item.workItemId}:${current.updatedAt}:${patch.status}` })
    this.workItems.set(item.workItemId, { ...current, ...patch, updatedAt: this.now() })
  }
  private addAttention(item: BayAgentWorkItemV1, assignment: BayAgentAssignmentV1, kind: BayAgentAttentionV1['kind'], question: string): void {
    if ([...this.attention.values()].some(row => row.assignmentId === assignment.assignmentId && row.status === 'open' && row.kind === kind)) return
    const row: BayAgentAttentionV1 = { attentionId: this.createId('attention'), workItemId: item.workItemId, assignmentId: assignment.assignmentId, areaId: item.areaId, ...(item.projectId ? { projectId: item.projectId } : {}), kind, question, status: 'open', createdAt: this.now() }
    this.recordEvent(item.workbenchId, 'attention.opened', { attentionId: row.attentionId, workItemId: item.workItemId, assignmentId: assignment.assignmentId, kind, summary: question }, { idempotencyKey: `attention.opened:${row.attentionId}` })
    this.attention.set(row.attentionId, row)
  }
  private readAreas(): readonly { areaId: string; label: string }[] { try { return this.options.inspect(this.options.workbenchId).areas.filter(area => !area.archived).map(area => ({ areaId: area.areaId, label: area.label })) } catch { return [] } }
  private emit(): void { this.snapshotCache = undefined; for (const listener of this.listeners) listener() }
}

export function projectWorkItem(item: BayAgentWorkItemV1): BayAgentWorkItemV1 { return structuredClone(item) }
function renderPrompt(prompt: unknown): string { return JSON.stringify(prompt, null, 2) }

const unsafeEventField = /(?:token|secret|password|credential|authorization|transcript|sessioncontent|absolute.?path|filepath|file.?path)/i
function sanitizeEventPayload(value: Record<string, unknown>, depth = 0): Readonly<Record<string, unknown>> {
  if (depth > 4) return {}
  const result: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value)) {
    if (unsafeEventField.test(key)) continue
    if (typeof entry === 'string') result[key] = sanitizeEventText(entry)
    else if (typeof entry === 'number' || typeof entry === 'boolean' || entry === null) result[key] = entry
    else if (Array.isArray(entry)) result[key] = entry.slice(0, 32).map(row => typeof row === 'string' ? sanitizeEventText(row, 500) : row && typeof row === 'object' ? sanitizeEventPayload(row as Record<string, unknown>, depth + 1) : row)
    else if (entry && typeof entry === 'object') result[key] = sanitizeEventPayload(entry as Record<string, unknown>, depth + 1)
  }
  return result
}
function sanitizeEventText(value: string, maxLength = 2_000): string {
  return value.replace(/[A-Za-z]:[\\/][^\s"']+|(?:^|\s)\/(?:[^\s"']+\/?)+/g, '[path]').replace(/\b(?:sk|ghp|xoxb|xoxp|token|secret)_[A-Za-z0-9_-]+\b/gi, '[redacted]').slice(0, maxLength)
}
function eventDigest(value: string): string {
  let hash = 2166136261
  for (let index = 0; index < value.length; index++) hash = Math.imul(hash ^ value.charCodeAt(index), 16777619)
  return (hash >>> 0).toString(16)
}

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

export interface BayAgentExternalWorkerRuntimeClientV2 extends BayAgentExternalWorkerRuntimeClientV1 {
  subscribeEnvelope(listener: (envelope: BayAgentWorkerRuntimeEventEnvelopeV1) => void): () => void
}

export function createBayAgentExternalWorkerRuntimeAdapter(
  client: BayAgentExternalWorkerRuntimeClientV1 | BayAgentExternalWorkerRuntimeClientV2,
  name = 'external-worker-runtime',
): BayAgentWorkerRuntimeV1 {
  return {
    name,
    createAssignment: input => client.createAssignment(input),
    cancelAssignment: input => client.cancelAssignment(input),
    retryAssignment: input => client.retryAssignment(input),
    recoverAssignment: input => client.recoverAssignment(input),
    subscribe: listener => 'subscribeEnvelope' in client ? (() => {}) : client.subscribe(listener),
    ...('subscribeEnvelope' in client ? { subscribeEnvelope: (listener: (envelope: BayAgentWorkerRuntimeEventEnvelopeV1) => void) => client.subscribeEnvelope(listener) } : {}),
  }
}

/** Named compatibility constructor for the planned dsh-superagent bridge.
 * The client is injected so Core stays independent from that runtime's code. */
export function createDshSuperagentWorkerRuntimeAdapter(
  client: BayAgentExternalWorkerRuntimeClientV1 | BayAgentExternalWorkerRuntimeClientV2,
): BayAgentWorkerRuntimeV1 {
  return createBayAgentExternalWorkerRuntimeAdapter(client, 'dsh-superagent')
}
