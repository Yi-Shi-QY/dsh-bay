import type { ToolKindV1 } from './tool-gateway.ts'

/** Outcomes derived from DSH's durable Session events. */
export type WorkbenchToolUsageOutcomeV1 =
  | 'success'
  | 'failure'
  | 'cancelled'
  | 'timeout'
  | 'incomplete'
  | 'unknown'

export interface WorkbenchToolUsageTotalsV1 {
  readonly calls: number
  readonly successes: number
  readonly failures: number
  readonly cancelled: number
  readonly timeouts: number
  readonly incomplete?: number
  readonly totalDurationMs: number
}

export interface WorkbenchToolUsageSummaryV1 {
  readonly toolId: string
  readonly moduleId: string
  readonly editorId?: string
  readonly kind: ToolKindV1
  readonly calls: number
  readonly successes: number
  readonly failures: number
  readonly cancelled: number
  readonly timeouts: number
  readonly incomplete: number
  readonly totalDurationMs: number
  readonly averageDurationMs?: number
  readonly p50DurationMs?: number
  readonly p95DurationMs?: number
  readonly lastCalledAt?: string
  readonly lastOutcome?: WorkbenchToolUsageOutcomeV1
}

/** Lightweight Workbench container summary. It contains no raw Session data. */
export interface WorkbenchContainerUsageSummaryV1 extends WorkbenchToolUsageTotalsV1 {
  readonly containerId: string
  readonly moduleId: string
  readonly editorId?: string
  readonly sessions: number
  readonly averageDurationMs?: number
  readonly p50DurationMs?: number
  readonly p95DurationMs?: number
  readonly lastCalledAt?: string
  readonly lastOutcome?: WorkbenchToolUsageOutcomeV1
}

/** Lightweight per-Session summary used after a container is expanded. */
export interface WorkbenchSessionUsageSummaryV1 extends WorkbenchToolUsageTotalsV1 {
  readonly sessionId: string
  readonly averageDurationMs?: number
  readonly p50DurationMs?: number
  readonly p95DurationMs?: number
  readonly lastCalledAt?: string
  readonly lastOutcome?: WorkbenchToolUsageOutcomeV1
}

export interface WorkbenchToolUsageBucketV1 {
  readonly startAt: string
  readonly endAt: string
  readonly calls: number
  readonly successes: number
  readonly failures: number
  readonly cancelled: number
  readonly totalDurationMs: number
}

export interface WorkbenchToolUsageSnapshotV1 {
  readonly workbenchId: string
  readonly from: string
  readonly to: string
  readonly generatedAt: string
  readonly sourceStatus: 'ready' | 'partial' | 'unavailable'
  readonly sourceReason?: string
  readonly totals: WorkbenchToolUsageTotalsV1
  /** Optional in older Host adapters; when present this is the fast first-level view. */
  readonly byContainer?: readonly WorkbenchContainerUsageSummaryV1[]
  readonly byTool: readonly WorkbenchToolUsageSummaryV1[]
  readonly buckets: readonly WorkbenchToolUsageBucketV1[]
}

export interface WorkbenchContainerUsageSnapshotV1 {
  readonly workbenchId: string
  readonly containerId: string
  readonly moduleId: string
  readonly editorId?: string
  readonly from: string
  readonly to: string
  readonly generatedAt: string
  readonly sourceStatus: WorkbenchToolUsageSnapshotV1['sourceStatus']
  readonly sourceReason?: string
  readonly totals: WorkbenchToolUsageTotalsV1
  readonly sessions: readonly WorkbenchSessionUsageSummaryV1[]
  readonly buckets: readonly WorkbenchToolUsageBucketV1[]
}

export interface WorkbenchToolUsageSessionRefV1 {
  readonly sessionId: string
  readonly callId: string
  readonly startedAt: string
  readonly finishedAt?: string
  readonly outcome: WorkbenchToolUsageOutcomeV1
  readonly durationMs?: number
}

export interface WorkbenchToolUsageServiceV1 {
  read(input: { readonly workbenchId: string; readonly from: string; readonly to: string }): Promise<WorkbenchToolUsageSnapshotV1>
  /** Read one container's Session projection lazily after the user expands it. */
  readContainer?(input: {
    readonly workbenchId: string
    readonly containerId: string
    readonly moduleId: string
    readonly editorId?: string
    readonly from: string
    readonly to: string
  }): Promise<WorkbenchContainerUsageSnapshotV1>
  subscribe?(workbenchId: string, listener: () => void): () => void
  listSessionRefs?(input: { readonly workbenchId: string; readonly toolId: string; readonly from: string; readonly to: string }): Promise<readonly WorkbenchToolUsageSessionRefV1[]>
  /** Navigate to DSH's existing Session ToolDetails surface. */
  openSessionToolDetail?(input: { readonly sessionId: string; readonly callId: string }): Promise<void>
}

export interface WorkbenchToolUsageAggregateV1 {
  readonly schemaVersion: 1
  readonly updatedAt: string
  readonly retentionDays: 30
  readonly totals: WorkbenchToolUsageSnapshotV1['totals']
  readonly byContainer?: readonly WorkbenchContainerUsageSummaryV1[]
  readonly byTool: readonly WorkbenchToolUsageSummaryV1[]
  readonly buckets: readonly WorkbenchToolUsageBucketV1[]
}

/** A minimal event shape accepted from DSH Session projections. */
export interface DshToolSessionEventV1 {
  readonly type: 'tool/call' | 'tool/result' | 'tool/cancel' | 'tool/timeout' | 'agent/error'
  readonly sessionId: string
  readonly workbenchId?: string
  readonly at: string | number
  readonly callId: string
  readonly toolId?: string
  readonly name?: string
  readonly error?: boolean | { readonly code?: string }
}

export interface DshToolUsageRecordV1 {
  readonly sessionId: string
  readonly callId: string
  readonly toolId: string
  readonly workbenchId: string
  readonly startedAt: string
  readonly finishedAt?: string
  readonly outcome: WorkbenchToolUsageOutcomeV1
  readonly durationMs?: number
}

const ISO = (value: string | number): string => {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? new Date(0).toISOString() : date.toISOString()
}

function percentile(values: readonly number[], fraction: number): number | undefined {
  if (values.length === 0) return undefined
  const index = Math.min(values.length - 1, Math.max(0, Math.ceil(values.length * fraction) - 1))
  return values[index]
}

function summaryFor(toolId: string, rows: readonly DshToolUsageRecordV1[], metadata: { moduleId: string; editorId?: string; kind: ToolKindV1 }): WorkbenchToolUsageSummaryV1 {
  const aggregate = aggregateRows(rows)
  return {
    toolId, moduleId: metadata.moduleId, ...(metadata.editorId === undefined ? {} : { editorId: metadata.editorId }), kind: metadata.kind,
    ...aggregate,
  }
}

function aggregateRows(rows: readonly DshToolUsageRecordV1[]): Omit<WorkbenchToolUsageSummaryV1, 'toolId' | 'moduleId' | 'editorId' | 'kind'> {
  const durations: number[] = []
  let successes = 0
  let failures = 0
  let cancelled = 0
  let timeouts = 0
  let incomplete = 0
  let totalDurationMs = 0
  let last: DshToolUsageRecordV1 | undefined
  for (const row of rows) {
    if (row.durationMs !== undefined && Number.isFinite(row.durationMs)) {
      durations.push(row.durationMs)
      totalDurationMs += row.durationMs
    }
    if (row.outcome === 'success') successes++
    else if (row.outcome === 'failure') failures++
    else if (row.outcome === 'cancelled') cancelled++
    else if (row.outcome === 'timeout') timeouts++
    else if (row.outcome === 'incomplete') incomplete++
    if (last === undefined || row.startedAt > last.startedAt) last = row
  }
  type AggregateResult = {
    calls: number
    successes: number
    failures: number
    cancelled: number
    timeouts: number
    incomplete: number
    totalDurationMs: number
    averageDurationMs?: number
    p50DurationMs?: number
    p95DurationMs?: number
    lastCalledAt?: string
    lastOutcome?: WorkbenchToolUsageOutcomeV1
  }
  const result: AggregateResult = {
    calls: rows.length, successes, failures, cancelled, timeouts, incomplete, totalDurationMs,
  }
  if (durations.length > 0) {
    const ordered = durations.toSorted((left, right) => left - right)
    const p50DurationMs = percentile(ordered, .5)
    const p95DurationMs = percentile(ordered, .95)
    result.averageDurationMs = Math.round(totalDurationMs / ordered.length)
    if (p50DurationMs !== undefined) result.p50DurationMs = p50DurationMs
    if (p95DurationMs !== undefined) result.p95DurationMs = p95DurationMs
  }
  if (last !== undefined) {
    result.lastCalledAt = last.startedAt
    result.lastOutcome = last.outcome
  }
  return result
}

function containerIdFor(metadata: { moduleId: string; editorId?: string }): string {
  return `${metadata.moduleId}:${metadata.editorId ?? ''}`
}

function containerSummaryFor(containerId: string, rows: readonly DshToolUsageRecordV1[], metadata: { moduleId: string; editorId?: string }): WorkbenchContainerUsageSummaryV1 {
  return {
    containerId, moduleId: metadata.moduleId, ...(metadata.editorId === undefined ? {} : { editorId: metadata.editorId }),
    sessions: new Set(rows.map(row => row.sessionId)).size,
    ...aggregateRows(rows),
  }
}

/** Pair DSH tool/call and tool/result events without reading UI state. */
export function mapDshToolSessionEvents(events: readonly DshToolSessionEventV1[], toolIds?: ReadonlySet<string>): readonly DshToolUsageRecordV1[] {
  const open = new Map<string, DshToolUsageRecordV1>()
  const output: DshToolUsageRecordV1[] = []
  for (const event of events) {
    const key = `${event.sessionId}:${event.callId}`
    if (event.type === 'tool/call') {
      if (open.has(key)) output.push({ ...open.get(key)!, outcome: 'incomplete' })
      const toolId = event.toolId ?? event.name
      if (toolId === undefined || (toolIds !== undefined && !toolIds.has(toolId))) continue
      open.set(key, { sessionId: event.sessionId, callId: event.callId, toolId, workbenchId: event.workbenchId ?? '', startedAt: ISO(event.at), outcome: 'incomplete' })
      continue
    }
    const current = open.get(key)
    if (current === undefined) continue
    const finishedAt = ISO(event.at)
    const durationMs = Math.max(0, new Date(finishedAt).getTime() - new Date(current.startedAt).getTime())
    const outcome: WorkbenchToolUsageOutcomeV1 = event.type === 'tool/result'
      ? event.error === undefined || event.error === false ? 'success' : 'failure'
      : event.type === 'tool/cancel' ? 'cancelled'
        : event.type === 'tool/timeout' ? 'timeout' : 'failure'
    output.push({ ...current, finishedAt, durationMs, outcome })
    open.delete(key)
  }
  output.push(...open.values())
  return output
}

/** Aggregate DSH-derived references for one Workbench and time window. */
export function aggregateWorkbenchToolUsage(input: {
  workbenchId: string
  from: string
  to: string
  records: readonly DshToolUsageRecordV1[]
  metadata: Readonly<Record<string, { moduleId: string; editorId?: string; kind: ToolKindV1 }>>
  sourceStatus?: WorkbenchToolUsageSnapshotV1['sourceStatus']
  sourceReason?: string
  bucketMs?: number
}): WorkbenchToolUsageSnapshotV1 {
  const fromMs = new Date(input.from).getTime()
  const toMs = new Date(input.to).getTime()
  const records: DshToolUsageRecordV1[] = []
  const rowsByTool = new Map<string, DshToolUsageRecordV1[]>()
  const rowsByContainer = new Map<string, { rows: DshToolUsageRecordV1[]; metadata: { moduleId: string; editorId?: string } }>()
  for (const row of input.records) {
    const startedMs = new Date(row.startedAt).getTime()
    if (row.workbenchId !== input.workbenchId || startedMs < fromMs || startedMs > toMs) continue
    records.push(row)
    const toolRows = rowsByTool.get(row.toolId) ?? []
    toolRows.push(row)
    rowsByTool.set(row.toolId, toolRows)
    const toolMetadata = input.metadata[row.toolId] ?? { moduleId: 'unknown', kind: 'tool' as const }
    const metadata = { moduleId: toolMetadata.moduleId, ...(toolMetadata.editorId === undefined ? {} : { editorId: toolMetadata.editorId }) }
    const containerId = containerIdFor(metadata)
    const containerRows = rowsByContainer.get(containerId) ?? { rows: [], metadata }
    containerRows.rows.push(row)
    rowsByContainer.set(containerId, containerRows)
  }
  const byTool = [...rowsByTool.entries()]
    .map(([toolId, rows]) => summaryFor(toolId, rows, input.metadata[toolId] ?? { moduleId: 'unknown', kind: 'tool' }))
    .sort((left, right) => right.calls - left.calls || left.toolId.localeCompare(right.toolId))
  const byContainer = [...rowsByContainer.entries()]
    .map(([containerId, value]) => containerSummaryFor(containerId, value.rows, value.metadata))
    .sort((left, right) => right.calls - left.calls || left.containerId.localeCompare(right.containerId))
  const recordAggregate = aggregateRows(records)
  const totals: WorkbenchToolUsageTotalsV1 = {
    calls: recordAggregate.calls,
    successes: recordAggregate.successes,
    failures: recordAggregate.failures,
    cancelled: recordAggregate.cancelled,
    timeouts: recordAggregate.timeouts,
    incomplete: recordAggregate.incomplete,
    totalDurationMs: recordAggregate.totalDurationMs,
  }
  // The "all time" view still reports cumulative totals, but its trend is
  // intentionally limited to the retained 30-day window.  Without this cap,
  // an epoch-based start would allocate hundreds of thousands of hourly
  // buckets before the UI could render anything.
  const trendWindowMs = Math.min(Math.max(0, toMs - fromMs), 30 * 24 * 60 * 60 * 1000)
  const configuredBucketMs = input.bucketMs ?? 60 * 60 * 1000
  const bucketMs = Math.max(configuredBucketMs, trendWindowMs > 0 ? Math.ceil(trendWindowMs / 720) : configuredBucketMs)
  const trendFromMs = Math.max(fromMs, toMs - trendWindowMs)
  const bucketStart = Math.floor(trendFromMs / bucketMs) * bucketMs
  const bucketCount = Math.min(720, Math.max(0, Math.ceil((toMs - bucketStart) / bucketMs)))
  const buckets: Array<{ startAt: string; endAt: string; calls: number; successes: number; failures: number; cancelled: number; totalDurationMs: number }> = Array.from({ length: bucketCount }, (_, index) => {
    const start = bucketStart + index * bucketMs
    return { startAt: new Date(start).toISOString(), endAt: new Date(Math.min(toMs, start + bucketMs)).toISOString(), calls: 0, successes: 0, failures: 0, cancelled: 0, totalDurationMs: 0 }
  })
  for (const row of records) {
    const at = new Date(row.startedAt).getTime()
    const index = Math.floor((at - bucketStart) / bucketMs)
    const bucket = buckets[index]
    if (bucket === undefined) continue
    bucket.calls++
    if (row.outcome === 'success') bucket.successes++
    else if (row.outcome === 'failure') bucket.failures++
    else if (row.outcome === 'cancelled') bucket.cancelled++
    bucket.totalDurationMs += row.durationMs ?? 0
  }
  return { workbenchId: input.workbenchId, from: input.from, to: input.to, generatedAt: new Date().toISOString(), sourceStatus: input.sourceStatus ?? 'ready', ...(input.sourceReason === undefined ? {} : { sourceReason: input.sourceReason }), totals, byContainer, byTool, buckets }
}

export function aggregateToPersistedUsage(value: WorkbenchToolUsageSnapshotV1, now = new Date()): WorkbenchToolUsageAggregateV1 {
  const cutoff = now.getTime() - 30 * 24 * 60 * 60 * 1000
  return { schemaVersion: 1, updatedAt: now.toISOString(), retentionDays: 30, totals: value.totals, ...(value.byContainer === undefined ? {} : { byContainer: value.byContainer }), byTool: value.byTool, buckets: value.buckets.filter(bucket => new Date(bucket.endAt).getTime() >= cutoff) }
}
