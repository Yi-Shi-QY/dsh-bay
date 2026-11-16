import type {
  ToolCatalogEntryV1,
  ToolKindV1,
  WorkbenchToolInvocationCompletionV1,
  WorkbenchToolInvocationHandleV1,
  WorkbenchToolInvocationOutcomeV1,
  WorkbenchToolInvocationStartV1,
} from './tool-gateway.ts'

export interface WorkbenchToolUsageBucketV1 {
  readonly startAt: string
  readonly endAt: string
  readonly calls: number
  readonly successes: number
  readonly failures: number
  readonly rejected: number
  readonly cancelled: number
  readonly timeouts: number
  readonly incomplete: number
  readonly totalDurationMs: number
}

export interface WorkbenchToolErrorSummaryV1 {
  readonly code?: string
  readonly message: string
  readonly count: number
  readonly lastOccurredAt: string
}

interface MutableError {
  code?: string
  message: string
  count: number
  lastOccurredAt: string
}

export interface WorkbenchToolAgentUsageSummaryV1 {
  readonly agentId?: string
  readonly calls: number
  readonly successes: number
  readonly failures: number
  readonly rejected: number
  readonly cancelled: number
  readonly timeouts: number
  readonly incomplete: number
  readonly totalDurationMs: number
  readonly averageDurationMs?: number
  readonly lastCalledAt?: string
  readonly lastOutcome?: WorkbenchToolInvocationOutcomeV1
}

export interface WorkbenchGatewayToolUsageSummaryV1 {
  readonly toolId: string
  readonly moduleId: string
  readonly editorId?: string
  readonly kind: ToolKindV1
  readonly calls: number
  readonly successes: number
  readonly failures: number
  readonly rejected: number
  readonly cancelled: number
  readonly timeouts: number
  readonly incomplete: number
  readonly totalDurationMs: number
  readonly averageDurationMs?: number
  readonly p50DurationMs?: number
  readonly p95DurationMs?: number
  readonly lastCalledAt?: string
  readonly lastOutcome?: WorkbenchToolInvocationOutcomeV1
  readonly byAgent: readonly WorkbenchToolAgentUsageSummaryV1[]
  readonly errors: readonly WorkbenchToolErrorSummaryV1[]
}

export interface WorkbenchToolGatewayUsageTotalsV1 {
  readonly calls: number
  readonly successes: number
  readonly failures: number
  readonly rejected: number
  readonly cancelled: number
  readonly timeouts: number
  readonly incomplete: number
  readonly totalDurationMs: number
}

export interface WorkbenchToolGatewayUsageSnapshotV1 {
  readonly workbenchId: string
  readonly gatewayRevision: number
  readonly gatewaySnapshotDigest: string
  readonly from: string
  readonly to: string
  readonly generatedAt: string
  readonly sourceStatus: 'ready' | 'partial' | 'unavailable'
  readonly sourceReason?: string
  readonly totals: WorkbenchToolGatewayUsageTotalsV1
  readonly byTool: readonly WorkbenchGatewayToolUsageSummaryV1[]
  readonly buckets: readonly WorkbenchToolUsageBucketV1[]
}

export interface WorkbenchToolGatewayUsageAggregateV1 {
  readonly schemaVersion: 1
  readonly updatedAt: string
  readonly retentionDays: 30
  readonly totals: WorkbenchToolGatewayUsageTotalsV1
  readonly byTool: readonly WorkbenchGatewayToolUsageSummaryV1[]
  readonly buckets: readonly WorkbenchToolUsageBucketV1[]
  /** Compact per-tool time buckets. No invocation parameters or results are stored. */
  readonly byToolBuckets?: readonly {
    readonly toolId: string
    readonly bucket: WorkbenchToolUsageBucketV1
  }[]
  readonly byAgentBuckets?: readonly {
    readonly toolId: string
    readonly agentId?: string
    readonly bucket: WorkbenchToolUsageBucketV1
  }[]
  readonly gatewayRevision?: number
  readonly gatewaySnapshotDigest?: string
}

interface MutableTotals {
  calls: number
  successes: number
  failures: number
  rejected: number
  cancelled: number
  timeouts: number
  incomplete: number
  totalDurationMs: number
}

interface MutableAgent extends MutableTotals {
  agentId?: string
  lastCalledAt?: string
  lastOutcome?: WorkbenchToolInvocationOutcomeV1
}

interface MutableTool extends MutableTotals {
  toolId: string
  moduleId: string
  editorId?: string
  kind: ToolKindV1
  lastCalledAt?: string
  lastOutcome?: WorkbenchToolInvocationOutcomeV1
  durations: number[]
  byAgent: Map<string, MutableAgent>
  errors: MutableError[]
}

interface ActiveInvocation extends WorkbenchToolInvocationHandleV1 {}

export interface WorkbenchToolGatewayUsageStoreV1 {
  beginInvocation(input: WorkbenchToolInvocationStartV1): WorkbenchToolInvocationHandleV1
  completeInvocation(input: WorkbenchToolInvocationCompletionV1): void
  usageSnapshot(input: { readonly from: string; readonly to: string }): WorkbenchToolGatewayUsageSnapshotV1
  subscribeUsage(listener: () => void): () => void
  aggregate(): WorkbenchToolGatewayUsageAggregateV1
}

export interface CreateWorkbenchToolGatewayUsageStoreOptionsV1 {
  readonly workbenchId: string
  readonly getCatalog: () => readonly ToolCatalogEntryV1[]
  readonly getRevision: () => number
  readonly getSnapshotDigest: () => string
  readonly initialUsage?: WorkbenchToolGatewayUsageAggregateV1
  readonly persistUsage?: (aggregate: WorkbenchToolGatewayUsageAggregateV1) => Promise<void>
}

const MAX_ERRORS = 8
const MAX_DURATION_SAMPLES = 256
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000

function emptyTotals(): MutableTotals {
  return { calls: 0, successes: 0, failures: 0, rejected: 0, cancelled: 0, timeouts: 0, incomplete: 0, totalDurationMs: 0 }
}

function outcomeKey(agentId: string | undefined): string { return agentId ?? '__unassigned__' }
function dateOf(value: string | number | undefined, fallback = Date.now()): Date {
  const date = value === undefined ? new Date(fallback) : new Date(value)
  return Number.isFinite(date.getTime()) ? date : new Date(fallback)
}
function iso(value: string | number | undefined, fallback = Date.now()): string { return dateOf(value, fallback).toISOString() }
function bucketStart(value: string): number {
  const time = dateOf(value).getTime()
  return Math.floor(time / (60 * 60 * 1000)) * 60 * 60 * 1000
}
function clampMessage(value: string): string {
  return value.replace(/[A-Za-z]:[\\/][^\s]+|\/[A-Za-z0-9._~-][^\s]*/gu, '[path]').replace(/[\u0000-\u001f\u007f\u2028\u2029]+/gu, ' ').replace(/\s+/gu, ' ').trim().slice(0, 240)
}
function percentile(values: readonly number[], fraction: number): number | undefined {
  if (values.length === 0) return undefined
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1))]
}
function copyTotals(value: MutableTotals): WorkbenchToolGatewayUsageTotalsV1 {
  return { calls: value.calls, successes: value.successes, failures: value.failures, rejected: value.rejected, cancelled: value.cancelled, timeouts: value.timeouts, incomplete: value.incomplete, totalDurationMs: value.totalDurationMs }
}
function addOutcome(target: MutableTotals, outcome: WorkbenchToolInvocationOutcomeV1, durationMs: number): void {
  target.calls += 1
  target.totalDurationMs += durationMs
  if (outcome === 'success') target.successes += 1
  else if (outcome === 'failure') target.failures += 1
  else if (outcome === 'rejected') target.rejected += 1
  else if (outcome === 'cancelled') target.cancelled += 1
  else if (outcome === 'timeout') target.timeouts += 1
  else target.incomplete += 1
}
function emptyBucket(start: number): MutableTotals & { start: number } { return { ...emptyTotals(), start } }
function bucketView(value: MutableTotals & { start: number }): WorkbenchToolUsageBucketV1 {
  return { startAt: new Date(value.start).toISOString(), endAt: new Date(value.start + 60 * 60 * 1000).toISOString(), ...copyTotals(value) }
}

export function createWorkbenchToolGatewayUsageStore(options: CreateWorkbenchToolGatewayUsageStoreOptionsV1): WorkbenchToolGatewayUsageStoreV1 {
  const tools = new Map<string, MutableTool>()
  const cumulative = emptyTotals()
  const buckets = new Map<number, MutableTotals & { start: number }>()
  const toolBuckets = new Map<string, Map<number, MutableTotals & { start: number }>>()
  const agentBuckets = new Map<string, Map<string, Map<number, MutableTotals & { start: number }>>>()
  const active = new Map<string, ActiveInvocation>()
  const completed = new Set<string>()
  const listeners = new Set<() => void>()
  let persistenceStatus: 'ready' | 'partial' | 'unavailable' = options.persistUsage === undefined ? 'ready' : 'ready'
  let persistenceReason: string | undefined
  let persistTimer: ReturnType<typeof setTimeout> | undefined

  const ensureTool = (entry: ToolCatalogEntryV1): MutableTool => {
    const existing = tools.get(entry.id)
    if (existing !== undefined) return existing
    const created: MutableTool = { ...emptyTotals(), toolId: entry.id, moduleId: entry.moduleId, ...(entry.editorId === undefined ? {} : { editorId: entry.editorId }), kind: entry.kind, durations: [], byAgent: new Map(), errors: [] }
    tools.set(entry.id, created)
    return created
  }
  const catalogMap = (): Map<string, ToolCatalogEntryV1> => new Map(options.getCatalog().map(entry => [entry.id, entry]))
  const hydrate = (): void => {
    const initial = options.initialUsage
    if (initial === undefined) return
    const cutoff = Date.now() - RETENTION_MS
    Object.assign(cumulative, initial.totals)
    const initialBuckets = initial.buckets ?? []
    for (const raw of initialBuckets) {
      const start = bucketStart(raw.startAt)
      if (start < cutoff) continue
      const value = emptyBucket(start)
      Object.assign(value, raw)
      buckets.set(value.start, value)
    }
    for (const raw of initial.byTool ?? []) {
      const tool = ensureTool({ id: raw.toolId, moduleId: raw.moduleId, ...(raw.editorId === undefined ? {} : { editorId: raw.editorId }), kind: raw.kind, version: 'restored', display: { name: raw.toolId }, execution: { providerId: 'restored', reference: null }, visibility: 'enabled', availability: 'available' })
      Object.assign(tool, { calls: raw.calls, successes: raw.successes, failures: raw.failures, rejected: raw.rejected, cancelled: raw.cancelled, timeouts: raw.timeouts, incomplete: raw.incomplete, totalDurationMs: raw.totalDurationMs, lastCalledAt: raw.lastCalledAt, lastOutcome: raw.lastOutcome })
      tool.errors = raw.errors.map(error => ({ ...error }))
      tool.byAgent = new Map(raw.byAgent.map(agent => [outcomeKey(agent.agentId), { ...emptyTotals(), ...agent }]))
    }
    for (const raw of initial.byToolBuckets ?? []) {
      const start = bucketStart(raw.bucket.startAt)
      if (start < cutoff) continue
      const map = toolBuckets.get(raw.toolId) ?? new Map<number, MutableTotals & { start: number }>()
      const value = emptyBucket(start); Object.assign(value, raw.bucket); map.set(value.start, value); toolBuckets.set(raw.toolId, map)
    }
    for (const raw of initial.byAgentBuckets ?? []) {
      const start = bucketStart(raw.bucket.startAt)
      if (start < cutoff) continue
      const toolsForAgent = agentBuckets.get(raw.toolId) ?? new Map<string, Map<number, MutableTotals & { start: number }>>()
      const rows = toolsForAgent.get(outcomeKey(raw.agentId)) ?? new Map<number, MutableTotals & { start: number }>()
      const value = emptyBucket(start); Object.assign(value, raw.bucket); rows.set(value.start, value); toolsForAgent.set(outcomeKey(raw.agentId), rows); agentBuckets.set(raw.toolId, toolsForAgent)
    }
  }
  hydrate()

  let notificationScheduled = false
  const notify = (): void => {
    if (notificationScheduled) return
    notificationScheduled = true
    queueMicrotask(() => {
      notificationScheduled = false
      for (const listener of listeners) listener()
    })
  }
  const schedulePersist = (): void => {
    if (options.persistUsage === undefined || persistTimer !== undefined) return
    persistTimer = setTimeout(() => {
      persistTimer = undefined
      const request = options.persistUsage!(aggregate())
      void request.then(() => { persistenceStatus = 'ready'; persistenceReason = undefined }).catch(error => { persistenceStatus = 'partial'; persistenceReason = error instanceof Error ? clampMessage(error.message) : 'Gateway statistics persistence failed' })
    }, 0)
  }
  const updateBucket = (toolId: string, at: string, outcome: WorkbenchToolInvocationOutcomeV1, duration: number): void => {
    const start = bucketStart(at)
    const global = buckets.get(start) ?? emptyBucket(start); addOutcome(global, outcome, duration); buckets.set(start, global)
    const map = toolBuckets.get(toolId) ?? new Map<number, MutableTotals & { start: number }>(); const row = map.get(start) ?? emptyBucket(start); addOutcome(row, outcome, duration); map.set(start, row); toolBuckets.set(toolId, map)
    const cutoff = Date.now() - RETENTION_MS
    for (const [key] of buckets) if (key < cutoff) buckets.delete(key)
    for (const mapValue of toolBuckets.values()) for (const [key] of mapValue) if (key < cutoff) mapValue.delete(key)
  }
  const updateAgentBucket = (toolId: string, agentId: string | undefined, at: string, outcome: WorkbenchToolInvocationOutcomeV1, duration: number): void => {
    const byAgent = agentBuckets.get(toolId) ?? new Map<string, Map<number, MutableTotals & { start: number }>>()
    const rows = byAgent.get(outcomeKey(agentId)) ?? new Map<number, MutableTotals & { start: number }>()
    const start = bucketStart(at); const bucket = rows.get(start) ?? emptyBucket(start); addOutcome(bucket, outcome, duration); rows.set(start, bucket); byAgent.set(outcomeKey(agentId), rows); agentBuckets.set(toolId, byAgent)
    const cutoff = Date.now() - RETENTION_MS
    for (const agentRows of byAgent.values()) for (const [key] of agentRows) if (key < cutoff) agentRows.delete(key)
  }
  const addError = (tool: MutableTool, error: WorkbenchToolInvocationCompletionV1['error'], at: string): void => {
    if (error === undefined) return
    const message = clampMessage(error.message)
    if (message === '') return
    const code = error.code?.trim().slice(0, 96) || undefined
    const existing = tool.errors.find(item => item.code === code && item.message === message)
    if (existing !== undefined) { existing.count += 1; existing.lastOccurredAt = at; return }
    tool.errors.unshift({ ...(code === undefined ? {} : { code }), message, count: 1, lastOccurredAt: at })
    if (tool.errors.length > MAX_ERRORS) tool.errors.length = MAX_ERRORS
  }
  const snapshotDigest = (): string => options.getSnapshotDigest() || `gateway-${options.getRevision()}`

  const aggregate = (): WorkbenchToolGatewayUsageAggregateV1 => {
    const current = options.getCatalog()
    const byTool = current.map(entry => toolSummary(entry, tools.get(entry.id), undefined)).filter((value): value is WorkbenchGatewayToolUsageSummaryV1 => value !== undefined)
    const allBuckets = [...buckets.values()].sort((left, right) => left.start - right.start).map(bucketView)
    return { schemaVersion: 1, updatedAt: new Date().toISOString(), retentionDays: 30, totals: totalsForRange(undefined), byTool, buckets: allBuckets, byToolBuckets: [...toolBuckets.entries()].flatMap(([toolId, rows]) => [...rows.values()].sort((left, right) => left.start - right.start).map(bucket => ({ toolId, bucket: bucketView(bucket) }))), byAgentBuckets: [...agentBuckets.entries()].flatMap(([toolId, agents]) => [...agents.entries()].flatMap(([agentId, rows]) => [...rows.values()].sort((left, right) => left.start - right.start).map(bucket => ({ toolId, ...(agentId === '__unassigned__' ? {} : { agentId }), bucket: bucketView(bucket) })))), gatewayRevision: options.getRevision(), gatewaySnapshotDigest: snapshotDigest() }
  }
  const totalsForRange = (range: { from: number; to: number } | undefined): MutableTotals => {
    if (range === undefined) return { ...cumulative }
    const result = emptyTotals()
    for (const bucket of buckets.values()) if (range === undefined || (bucket.start < range.to && bucket.start + 60 * 60 * 1000 > range.from)) Object.assign(result, { calls: result.calls + bucket.calls, successes: result.successes + bucket.successes, failures: result.failures + bucket.failures, rejected: result.rejected + bucket.rejected, cancelled: result.cancelled + bucket.cancelled, timeouts: result.timeouts + bucket.timeouts, incomplete: result.incomplete + bucket.incomplete, totalDurationMs: result.totalDurationMs + bucket.totalDurationMs })
    return result
  }
  const toolSummary = (entry: ToolCatalogEntryV1, state: MutableTool | undefined, range: { from: number; to: number } | undefined): WorkbenchGatewayToolUsageSummaryV1 | undefined => {
    const source = state ?? { ...emptyTotals(), toolId: entry.id, moduleId: entry.moduleId, ...(entry.editorId === undefined ? {} : { editorId: entry.editorId }), kind: entry.kind, durations: [], byAgent: new Map(), errors: [] } as MutableTool
    const values = range === undefined ? undefined : [...(toolBuckets.get(entry.id)?.values() ?? [])].filter(bucket => bucket.start < range.to && bucket.start + 60 * 60 * 1000 > range.from)
    const totals = range === undefined ? source : (values ?? []).reduce<MutableTotals>((result, bucket) => { result.calls += bucket.calls; result.successes += bucket.successes; result.failures += bucket.failures; result.rejected += bucket.rejected; result.cancelled += bucket.cancelled; result.timeouts += bucket.timeouts; result.incomplete += bucket.incomplete; result.totalDurationMs += bucket.totalDurationMs; return result }, emptyTotals())
    const agents = range === undefined ? [...source.byAgent.values()] : [...(agentBuckets.get(entry.id)?.entries() ?? [])].map(([agentKey, rows]) => {
      const totals = [...rows.values()].filter(bucket => bucket.start < range.to && bucket.start + 60 * 60 * 1000 > range.from).reduce<MutableTotals>((result, bucket) => { result.calls += bucket.calls; result.successes += bucket.successes; result.failures += bucket.failures; result.rejected += bucket.rejected; result.cancelled += bucket.cancelled; result.timeouts += bucket.timeouts; result.incomplete += bucket.incomplete; result.totalDurationMs += bucket.totalDurationMs; return result }, emptyTotals())
      return { ...totals, ...(agentKey === '__unassigned__' ? {} : { agentId: agentKey }) } as MutableAgent
    })
    const byAgent = agents.sort((left, right) => right.calls - left.calls).map(agent => ({ ...(agent.agentId === undefined ? {} : { agentId: agent.agentId }), calls: agent.calls, successes: agent.successes, failures: agent.failures, rejected: agent.rejected, cancelled: agent.cancelled, timeouts: agent.timeouts, incomplete: agent.incomplete, totalDurationMs: agent.totalDurationMs, ...(agent.calls === 0 ? {} : { averageDurationMs: agent.totalDurationMs / agent.calls }), ...(agent.lastCalledAt === undefined ? {} : { lastCalledAt: agent.lastCalledAt }), ...(agent.lastOutcome === undefined ? {} : { lastOutcome: agent.lastOutcome }) }))
    const p50 = percentile(source.durations, 0.5)
    const p95 = percentile(source.durations, 0.95)
    return { toolId: entry.id, moduleId: entry.moduleId, ...(entry.editorId === undefined ? {} : { editorId: entry.editorId }), kind: entry.kind, ...copyTotals(totals), ...(totals.calls === 0 ? {} : { averageDurationMs: totals.totalDurationMs / totals.calls }), ...(p50 === undefined ? {} : { p50DurationMs: p50 }), ...(p95 === undefined ? {} : { p95DurationMs: p95 }), ...(source.lastCalledAt === undefined ? {} : { lastCalledAt: source.lastCalledAt }), ...(source.lastOutcome === undefined ? {} : { lastOutcome: source.lastOutcome }), byAgent, errors: source.errors.map(error => ({ ...error })) }
  }

  const store: WorkbenchToolGatewayUsageStoreV1 = {
    beginInvocation(input) {
      const entry = catalogMap().get(input.toolId)
      if (entry === undefined) throw new Error(`Unknown tool contribution: ${input.toolId}`)
      ensureTool(entry)
      if (active.has(input.invocationId) || completed.has(input.invocationId)) throw new Error(`Duplicate invocation id: ${input.invocationId}`)
      const startedAt = iso(input.startedAt)
      const handle: WorkbenchToolInvocationHandleV1 = { workbenchId: options.workbenchId, invocationId: input.invocationId, toolId: input.toolId, ...(input.agentId === undefined ? {} : { agentId: input.agentId }), ...(input.agentRunId === undefined ? {} : { agentRunId: input.agentRunId }), gatewayRevision: options.getRevision(), gatewaySnapshotDigest: snapshotDigest(), startedAt }
      active.set(input.invocationId, handle); return handle
    },
    completeInvocation(input) {
      const handle = active.get(input.invocationId)
      if (handle === undefined) return
      active.delete(input.invocationId); completed.add(input.invocationId)
      if (completed.size > 10000) completed.delete(completed.values().next().value as string)
      const finishedAt = iso(input.finishedAt)
      const duration = Math.max(0, dateOf(finishedAt).getTime() - dateOf(handle.startedAt).getTime())
      const entry = catalogMap().get(handle.toolId); const state = tools.get(handle.toolId)
      if (entry === undefined || state === undefined) return
      addOutcome(state, input.outcome, duration); addOutcome(cumulative, input.outcome, duration); state.lastCalledAt = finishedAt; state.lastOutcome = input.outcome
      if (input.outcome === 'failure' || input.outcome === 'rejected') addError(state, input.error, finishedAt)
      if (input.outcome !== 'incomplete') { state.durations.push(duration); if (state.durations.length > MAX_DURATION_SAMPLES) state.durations.shift() }
      const agent = state.byAgent.get(outcomeKey(handle.agentId)) ?? { ...emptyTotals(), ...(handle.agentId === undefined ? {} : { agentId: handle.agentId }) } as MutableAgent
      addOutcome(agent, input.outcome, duration); agent.lastCalledAt = finishedAt; agent.lastOutcome = input.outcome; state.byAgent.set(outcomeKey(handle.agentId), agent)
      updateBucket(handle.toolId, finishedAt, input.outcome, duration); updateAgentBucket(handle.toolId, handle.agentId, finishedAt, input.outcome, duration); schedulePersist(); notify()
    },
    usageSnapshot(input) {
      if (persistenceStatus === 'partial') schedulePersist()
      const from = dateOf(input.from, Date.now() - 24 * 60 * 60 * 1000).getTime(); const to = dateOf(input.to).getTime(); const range = { from, to }
      const current = catalogMap(); const byTool = [...current.values()].map(entry => toolSummary(entry, tools.get(entry.id), range)).filter((row): row is WorkbenchGatewayToolUsageSummaryV1 => row !== undefined)
      const activeByTool = new Map<string, ActiveInvocation[]>()
      for (const handle of active.values()) {
        const started = dateOf(handle.startedAt).getTime()
        if (started >= from && started <= to && current.has(handle.toolId)) {
          const rows = activeByTool.get(handle.toolId) ?? []
          rows.push(handle)
          activeByTool.set(handle.toolId, rows)
        }
      }
      const byToolWithActive = byTool.map(row => {
        const activeRows = activeByTool.get(row.toolId)
        if (activeRows === undefined || activeRows.length === 0) return row
        const agents = new Map(row.byAgent.map(agent => [outcomeKey(agent.agentId), { ...agent }]))
        for (const handle of activeRows) {
          const key = outcomeKey(handle.agentId)
          const agent = agents.get(key) ?? { ...(handle.agentId === undefined ? {} : { agentId: handle.agentId }), calls: 0, successes: 0, failures: 0, rejected: 0, cancelled: 0, timeouts: 0, incomplete: 0, totalDurationMs: 0 }
          agents.set(key, { ...agent, calls: agent.calls + 1, incomplete: agent.incomplete + 1, lastCalledAt: handle.startedAt, lastOutcome: 'incomplete' })
        }
        const byAgent = [...agents.values()].sort((left, right) => right.calls - left.calls).map(agent => ({ ...agent, ...(agent.calls === 0 ? {} : { averageDurationMs: agent.totalDurationMs / agent.calls }) }))
        return { ...row, calls: row.calls + activeRows.length, incomplete: row.incomplete + activeRows.length, byAgent }
      })
      const isAllTime = from <= 0
      const totals = isAllTime ? { ...cumulative } : totalsForRange(range)
      for (const handle of active.values()) if (dateOf(handle.startedAt).getTime() <= to && dateOf(handle.startedAt).getTime() >= from) { totals.calls += 1; totals.incomplete += 1 }
      const hours = [...buckets.values()].filter(bucket => bucket.start < to && bucket.start + 60 * 60 * 1000 > from).sort((left, right) => left.start - right.start)
      const step = to - from <= 24 * 60 * 60 * 1000 ? 60 * 60 * 1000 : 24 * 60 * 60 * 1000
      const grouped = new Map<number, MutableTotals & { start: number }>()
      for (const bucket of hours) { const start = Math.floor(bucket.start / step) * step; const row = grouped.get(start) ?? emptyBucket(start); row.calls += bucket.calls; row.successes += bucket.successes; row.failures += bucket.failures; row.rejected += bucket.rejected; row.cancelled += bucket.cancelled; row.timeouts += bucket.timeouts; row.incomplete += bucket.incomplete; row.totalDurationMs += bucket.totalDurationMs; grouped.set(start, row) }
      return { workbenchId: options.workbenchId, gatewayRevision: options.getRevision(), gatewaySnapshotDigest: snapshotDigest(), from: new Date(from).toISOString(), to: new Date(to).toISOString(), generatedAt: new Date().toISOString(), sourceStatus: persistenceStatus, ...(persistenceReason === undefined ? {} : { sourceReason: persistenceReason }), totals: copyTotals(totals), byTool: byToolWithActive, buckets: [...grouped.values()].sort((left, right) => left.start - right.start).map(bucketView) }
    },
    subscribeUsage(listener) { listeners.add(listener); return () => listeners.delete(listener) },
    aggregate,
  }
  return store
}
