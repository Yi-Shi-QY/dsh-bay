/**
 * Versioned human/Agent context for a Workbench and its Areas.
 *
 * Context is deliberately separate from the visual document.  The document
 * describes where editors are rendered; Context describes why the Workbench
 * exists and what the current work means.  Human and Bay Agent writes use
 * different sections so an Agent can maintain its own report without gaining
 * the ability to rewrite the operator's goal or constraints.
 */

export const WORKBENCH_CONTEXT_SCHEMA_VERSION = 1 as const

const MAX_TEXT = 20_000
const MAX_ITEM = 1_000
const MAX_ITEMS = 64
const MAX_CONTEXT_BYTES = 64 * 1024

export type WorkbenchContextSection = 'human' | 'agent'
/** Bay Agent is the Workbench-owned control agent. `superagent` is retained as
 * a deprecated wire alias for early alpha callers. */
export type WorkbenchContextWriter = 'human' | 'bay-agent' | 'superagent'

export interface WorkbenchHumanContextV1 {
  goal: string
  constraints: string[]
  preferences: string[]
  allowedActions: string[]
  approvalRequired: string[]
  environment: string[]
}

export interface WorkbenchAgentContextV1 {
  summary: string
  currentFocus: string
  nextActions: string[]
  blockers: string[]
  proposals: string[]
}

/** Bay Agent's durable status section. Kept as an alias so the ownership of
 * this context is explicit in Bay-facing APIs while the persisted `agent`
 * field stays schema-compatible. */
export type WorkbenchBayAgentContextV1 = WorkbenchAgentContextV1

/** Persisted context for the whole Workbench. */
export interface WorkbenchContextV1 {
  schemaVersion: typeof WORKBENCH_CONTEXT_SCHEMA_VERSION
  revision: number
  human: WorkbenchHumanContextV1
  agent: WorkbenchAgentContextV1
}

export interface AreaHumanContextV1 {
  objective: string
  constraints: string[]
  inputs: string[]
  successCriteria: string[]
}

export interface AreaAgentContextV1 {
  summary: string
  completed: string[]
  nextActions: string[]
  blockers: string[]
  proposals: string[]
}

/** Persisted context for one Area. */
export interface AreaContextV1 {
  schemaVersion: typeof WORKBENCH_CONTEXT_SCHEMA_VERSION
  revision: number
  human: AreaHumanContextV1
  agent: AreaAgentContextV1
}

export interface ContextPatchOptions<S extends WorkbenchContextSection> {
  writer: WorkbenchContextWriter
  section: S
  expectedRevision: number
  patch: Partial<S extends 'human' ? WorkbenchHumanContextV1 : WorkbenchAgentContextV1>
}

export type ContextPatchResult<T> =
  | { status: 'committed'; context: T }
  | { status: 'conflict'; context: T }
  | { status: 'rejected'; reason: ContextRejectionReason }

export type ContextRejectionReason =
  | 'agent-cannot-write-human-context'
  | 'revision-invalid'
  | 'patch-invalid'
  | 'context-too-large'

const emptyHuman = (): WorkbenchHumanContextV1 => ({
  goal: '', constraints: [], preferences: [], allowedActions: [], approvalRequired: [], environment: [],
})

const emptyAgent = (): WorkbenchAgentContextV1 => ({
  summary: '', currentFocus: '', nextActions: [], blockers: [], proposals: [],
})

const emptyAreaHuman = (): AreaHumanContextV1 => ({
  objective: '', constraints: [], inputs: [], successCriteria: [],
})

const emptyAreaAgent = (): AreaAgentContextV1 => ({
  summary: '', completed: [], nextActions: [], blockers: [], proposals: [],
})

export function createWorkbenchContext(): WorkbenchContextV1 {
  return { schemaVersion: WORKBENCH_CONTEXT_SCHEMA_VERSION, revision: 0, human: emptyHuman(), agent: emptyAgent() }
}

export function createAreaContext(): AreaContextV1 {
  return { schemaVersion: WORKBENCH_CONTEXT_SCHEMA_VERSION, revision: 0, human: emptyAreaHuman(), agent: emptyAreaAgent() }
}

/** Return a safe default when an older Workbench has no Context yet. */
export function workbenchContextOf(value: WorkbenchContextV1 | undefined): WorkbenchContextV1 {
  return value === undefined ? createWorkbenchContext() : structuredClone(value)
}

/** Return a safe default when an older Area has no Context yet. */
export function areaContextOf(value: AreaContextV1 | undefined): AreaContextV1 {
  return value === undefined ? createAreaContext() : structuredClone(value)
}

/** Validate and normalize a persisted Workbench Context. */
export function decodeWorkbenchContext(value: unknown): WorkbenchContextV1 | undefined {
  if (!isRecord(value) || value.schemaVersion !== WORKBENCH_CONTEXT_SCHEMA_VERSION || !validRevision(value.revision)) return undefined
  const human = decodeHuman(value.human)
  const agent = decodeWorkbenchAgent(value.agent)
  if (human === undefined || agent === undefined) return undefined
  const context: WorkbenchContextV1 = { schemaVersion: WORKBENCH_CONTEXT_SCHEMA_VERSION, revision: value.revision, human, agent }
  return contextBytes(context) <= MAX_CONTEXT_BYTES ? context : undefined
}

/** Validate and normalize a persisted Area Context. */
export function decodeAreaContext(value: unknown): AreaContextV1 | undefined {
  if (!isRecord(value) || value.schemaVersion !== WORKBENCH_CONTEXT_SCHEMA_VERSION || !validRevision(value.revision)) return undefined
  const human = decodeAreaHuman(value.human)
  const agent = decodeAreaAgent(value.agent)
  if (human === undefined || agent === undefined) return undefined
  const context: AreaContextV1 = { schemaVersion: WORKBENCH_CONTEXT_SCHEMA_VERSION, revision: value.revision, human, agent }
  return contextBytes(context) <= MAX_CONTEXT_BYTES ? context : undefined
}

/** Decode Area Contexts and reject keys that do not belong to the Workbench document. */
export function decodeAreaContexts(value: unknown, areaIds: readonly string[]): Record<string, AreaContextV1> | undefined {
  if (!isRecord(value)) return undefined
  const known = new Set(areaIds)
  const result: Record<string, AreaContextV1> = {}
  for (const [areaId, raw] of Object.entries(value)) {
    if (!known.has(areaId)) return undefined
    const context = decodeAreaContext(raw)
    if (context === undefined) return undefined
    result[areaId] = context
  }
  return result
}

/** Patch only one owned section with compare-and-swap semantics. */
export function patchWorkbenchContext(
  source: WorkbenchContextV1,
  options: ContextPatchOptions<'human'>,
): ContextPatchResult<WorkbenchContextV1>
export function patchWorkbenchContext(
  source: WorkbenchContextV1,
  options: ContextPatchOptions<'agent'>,
): ContextPatchResult<WorkbenchContextV1>
export function patchWorkbenchContext(
  source: WorkbenchContextV1,
  options: ContextPatchOptions<WorkbenchContextSection>,
): ContextPatchResult<WorkbenchContextV1> {
  if (isBayAgentWriter(options.writer) && options.section === 'human') return { status: 'rejected', reason: 'agent-cannot-write-human-context' }
  return patchContext(source, options)
}

/** Patch one Area Context section with the same ownership and revision rules. */
export function patchAreaContext(
  source: AreaContextV1,
  options: ContextPatchOptions<'human'>,
): ContextPatchResult<AreaContextV1>
export function patchAreaContext(
  source: AreaContextV1,
  options: ContextPatchOptions<'agent'>,
): ContextPatchResult<AreaContextV1>
export function patchAreaContext(
  source: AreaContextV1,
  options: ContextPatchOptions<WorkbenchContextSection>,
): ContextPatchResult<AreaContextV1> {
  if (isBayAgentWriter(options.writer) && options.section === 'human') return { status: 'rejected', reason: 'agent-cannot-write-human-context' }
  return patchContext(source, options)
}

function isBayAgentWriter(writer: WorkbenchContextWriter): boolean {
  return writer === 'bay-agent' || writer === 'superagent'
}

function patchContext<T extends WorkbenchContextV1 | AreaContextV1>(
  source: T,
  options: ContextPatchOptions<WorkbenchContextSection>,
): ContextPatchResult<T> {
  if (!validRevision(options.expectedRevision)) return { status: 'rejected', reason: 'revision-invalid' }
  if (source.revision !== options.expectedRevision) return { status: 'conflict', context: structuredClone(source) }
  const next = structuredClone(source) as T
  const current = next[options.section]
  const patch = options.patch as Partial<typeof current>
  if (!isRecord(patch)) return { status: 'rejected', reason: 'patch-invalid' }
  const merged = { ...current, ...patch }
  const decoded = options.section === 'human'
    ? ('goal' in current ? decodeHuman(merged) : decodeAreaHuman(merged))
    : ('completed' in current ? decodeAreaAgent(merged) : decodeWorkbenchAgent(merged))
  if (decoded === undefined) return { status: 'rejected', reason: 'patch-invalid' }
  ;(next as unknown as Record<WorkbenchContextSection, unknown>)[options.section] = decoded
  next.revision += 1
  if (contextBytes(next) > MAX_CONTEXT_BYTES) return { status: 'rejected', reason: 'context-too-large' }
  return { status: 'committed', context: next }
}

/** Render the structured Context into the human-readable Markdown projection. */
export function renderWorkbenchContextMarkdown(context: WorkbenchContextV1): string {
  return [
    '# 工作台整体背景说明',
    '',
    '## 目标', context.human.goal || '（尚未设置）',
    '',
    '## 长期约束', bulletList(context.human.constraints),
    '',
    '## 偏好', bulletList(context.human.preferences),
    '',
    '## 允许自动执行', bulletList(context.human.allowedActions),
    '',
    '## 需要人工确认', bulletList(context.human.approvalRequired),
    '',
    '## 已知环境', bulletList(context.human.environment),
    '',
    '## Agent 摘要', context.agent.summary || '（尚无摘要）',
    '',
    '## 当前重点', context.agent.currentFocus || '（尚未设置）',
    '',
    '## 下一步', bulletList(context.agent.nextActions),
    '',
    '## 阻塞项', bulletList(context.agent.blockers),
    '',
    '## 提案', bulletList(context.agent.proposals),
    '',
  ].join('\n')
}

export function renderAreaContextMarkdown(context: AreaContextV1): string {
  return [
    '# 区域说明',
    '',
    '## 目标', context.human.objective || '（尚未设置）',
    '',
    '## 约束', bulletList(context.human.constraints),
    '',
    '## 输入和依赖', bulletList(context.human.inputs),
    '',
    '## 成功标准', bulletList(context.human.successCriteria),
    '',
    '## Agent 摘要', context.agent.summary || '（尚无摘要）',
    '',
    '## 已完成', bulletList(context.agent.completed),
    '',
    '## 下一步', bulletList(context.agent.nextActions),
    '',
    '## 阻塞项', bulletList(context.agent.blockers),
    '',
    '## 提案', bulletList(context.agent.proposals),
    '',
  ].join('\n')
}

function decodeHuman(value: unknown): WorkbenchHumanContextV1 | undefined {
  if (!isRecord(value)) return undefined
  const goal = text(value.goal)
  const constraints = textList(value.constraints)
  const preferences = textList(value.preferences)
  const allowedActions = textList(value.allowedActions)
  const approvalRequired = textList(value.approvalRequired)
  const environment = textList(value.environment)
  if (goal === undefined || constraints === undefined || preferences === undefined || allowedActions === undefined
    || approvalRequired === undefined || environment === undefined) return undefined
  return { goal, constraints, preferences, allowedActions, approvalRequired, environment }
}

function decodeAreaHuman(value: unknown): AreaHumanContextV1 | undefined {
  if (!isRecord(value)) return undefined
  const objective = text(value.objective)
  const constraints = textList(value.constraints)
  const inputs = textList(value.inputs)
  const successCriteria = textList(value.successCriteria)
  if (objective === undefined || constraints === undefined || inputs === undefined || successCriteria === undefined) return undefined
  return { objective, constraints, inputs, successCriteria }
}

function decodeWorkbenchAgent(value: unknown): WorkbenchAgentContextV1 | undefined {
  const fields = decodeAgentFields(value)
  if (fields === undefined || !('currentFocus' in fields)) return undefined
  return { summary: fields.summary, currentFocus: fields.currentFocus, nextActions: fields.nextActions, blockers: fields.blockers, proposals: fields.proposals }
}

function decodeAreaAgent(value: unknown): AreaAgentContextV1 | undefined {
  const fields = decodeAgentFields(value)
  if (fields === undefined || !('completed' in fields)) return undefined
  return { summary: fields.summary, completed: fields.completed, nextActions: fields.nextActions, blockers: fields.blockers, proposals: fields.proposals }
}

function decodeAgentFields(value: unknown): {
  summary: string
  currentFocus?: string
  completed?: string[]
  nextActions: string[]
  blockers: string[]
  proposals: string[]
} | undefined {
  if (!isRecord(value)) return undefined
  const summary = text(value.summary)
  const currentFocus = 'currentFocus' in value ? text(value.currentFocus) : ''
  const nextActions = textList(value.nextActions)
  const blockers = textList(value.blockers)
  const proposals = textList(value.proposals)
  if (summary === undefined || currentFocus === undefined || nextActions === undefined || blockers === undefined || proposals === undefined) return undefined
  const completed = 'completed' in value ? textList(value.completed) : undefined
  if ('completed' in value && completed === undefined) return undefined
  return { summary, currentFocus, ...(completed === undefined ? {} : { completed }), nextActions, blockers, proposals }
}

function text(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.normalize('NFKC').trim()
  return normalized.length <= MAX_TEXT ? normalized : undefined
}

function textList(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || value.length > MAX_ITEMS || value.some(item => typeof item !== 'string')) return undefined
  const result = value.map(item => item.normalize('NFKC').trim())
  return result.some(item => item.length > MAX_ITEM) ? undefined : [...new Set(result)]
}

function validRevision(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function contextBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength
}

function bulletList(values: readonly string[]): string {
  return values.length === 0 ? '（无）' : values.map(value => `- ${value}`).join('\n')
}
