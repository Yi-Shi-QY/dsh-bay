/**
 * Client-safe agent assembly model.
 *
 * The drawer and the Host share these types and checks. Plugin composition
 * stays in `agent-assembly.ts` because it depends on the DSH loader.
 */

export const AGENT_DEFINITION_SCHEMA_VERSION = 1
export const AGENT_ID_PATTERN = /^[a-z][a-z0-9-]{1,62}$/u
export const AGENT_INSTRUCTION_LIMIT = 8000
export const AGENT_ASSEMBLY_ROUTE = '/api/workbench/agent-assembly'
/** Cordis service name of the Host assembly store. */
export const AGENT_ASSEMBLY_SERVICE = 'workbenchAgentAssembly'
/** Promise that settles after the first restore. Session creation waits on it. */
export const AGENT_ASSEMBLY_READY = 'workbenchAgentAssemblyReady'

export type AgentBasePresetId = 'standard' | 'minimal'
export type AgentGuestAccess = 'none' | 'read-only' | 'approved'

/** One block a person can toggle while assembling an agent. */
export interface AgentAssemblyBlockV1 {
  readonly id: string
  readonly label: string
  readonly description: string
  /** Where the block comes from, so the drawer can group them. */
  readonly source: 'dsh' | 'workbench'
  readonly basePresets: readonly AgentBasePresetId[]
}

export interface WorkbenchAgentDefinitionV1 {
  readonly schemaVersion: 1
  readonly agentId: string
  readonly name: string
  readonly description: string
  readonly basePreset: AgentBasePresetId
  /** Workbench gateway tool ids this agent may call. */
  readonly tools: readonly string[]
  /** Skill names published with the selected extensions. */
  readonly skills: readonly string[]
  /** DSH blocks added on top of the base preset. */
  readonly blocks: readonly string[]
  /** Extra persona text, rendered after the base persona. */
  readonly instructions?: string
  readonly acceptance?: readonly string[]
  readonly guestAccess: AgentGuestAccess
  readonly revision: number
  readonly origin: { readonly kind: 'manual' | 'bay-proposal'; readonly approvedBy?: string; readonly approvedAt?: string }
  readonly updatedAt: string
}

export interface AgentAssemblyRegistrationV1 {
  readonly workbenchId: string
  readonly definition: WorkbenchAgentDefinitionV1
  readonly presetId: string
  /** `saved` waits for a person to register it; `unavailable` names a missing extension. */
  readonly status: 'saved' | 'registered' | 'unavailable'
  readonly reason?: string
  /** Selected tool or skill ids that no Host executor provides. */
  readonly missing?: readonly string[]
  /** The imported package's source had this revision registered; a person still decides. */
  readonly suggested?: AgentImportSourceV1
}

/** Where an imported registration suggestion came from. Unsigned packages deserve a closer look. */
export type AgentImportSourceV1 = 'complete' | 'template-signed' | 'template-unsigned'

export interface AgentAssemblyProblemV1 { readonly field: string; readonly message: string }

const BLOCKS: readonly AgentAssemblyBlockV1[] = [
  { id: 'agent-instructions', label: 'AGENTS.md', description: '读取项目和用户目录里的 AGENTS.md。', source: 'dsh', basePresets: ['standard'] },
  { id: 'tool-shell', label: '终端', description: '按系统使用 bash 或 PowerShell 执行命令。', source: 'dsh', basePresets: ['standard'] },
  { id: 'tool-fs', label: '文件读写', description: '读取、搜索和修改工作区文件。', source: 'dsh', basePresets: ['standard'] },
  { id: 'tool-web', label: '网页', description: '搜索和抓取网页内容。', source: 'dsh', basePresets: ['standard'] },
  { id: 'skill', label: 'Skill', description: '从工作区目录发现并加载 skill。', source: 'dsh', basePresets: ['standard'] },
  { id: 'agent-loop', label: 'Agent loop', description: '任务清单和向用户提问，用于多步执行。', source: 'dsh', basePresets: ['standard'] },
]

const BASE_PRESETS: Record<AgentBasePresetId, { label: string; description: string; defaultBlocks: readonly string[] }> = {
  standard: { label: '标准', description: '在标准编码 Agent 的积木上按需取舍。', defaultBlocks: ['agent-instructions', 'tool-shell', 'tool-fs', 'tool-web', 'skill', 'agent-loop'] },
  minimal: { label: '精简', description: '只有身份提示词和图片读取，适合问答类助手。', defaultBlocks: [] },
}

/** Blocks a person can add while assembling. Order is stable for the drawer. */
export function agentAssemblyBlocks(): readonly AgentAssemblyBlockV1[] { return BLOCKS }

export function agentBasePresets(): readonly { id: AgentBasePresetId; label: string; description: string; defaultBlocks: readonly string[] }[] {
  return (Object.keys(BASE_PRESETS) as AgentBasePresetId[]).map(id => ({ id, ...BASE_PRESETS[id] }))
}

export function defaultBlocksFor(basePreset: AgentBasePresetId): readonly string[] {
  return BASE_PRESETS[basePreset].defaultBlocks
}

/** Blocks that are meaningful for the chosen base preset. */
export function blocksForBase(basePreset: AgentBasePresetId): readonly AgentAssemblyBlockV1[] {
  return BLOCKS.filter(block => block.basePresets.includes(basePreset))
}

export function presetIdFor(workbenchId: string, definition: Pick<WorkbenchAgentDefinitionV1, 'agentId' | 'revision'>): string {
  return `bay:${workbenchId}:${definition.agentId}@${definition.revision}`
}

/**
 * Move an assembled-agent preset id to another workbench id. Imports give the
 * workbench a new id, so sessions and tasks must point at the new preset.
 * Other preset ids are returned unchanged.
 */
export function remapAgentPresetId(presetId: string, sourceWorkbenchId: string, targetWorkbenchId: string): string {
  const prefix = `bay:${sourceWorkbenchId}:`
  return presetId.startsWith(prefix) ? `bay:${targetWorkbenchId}:` + presetId.slice(prefix.length) : presetId
}

/** File name of one revision. The agent id and revision both sit in the name so a copied folder stays readable. */
export function revisionFileName(agentId: string, revision: number): string { return `${agentId}@${revision}.json` }

export function definitionPath(agentId: string, revision: number): string { return `.bay/agents/${revisionFileName(agentId, revision)}` }

/** Split a revision file name. Older single-file definitions are read too, but never written again. */
const RESERVED_FILES = new Set(['selection.json', 'suggested.json'])

export function parseRevisionFileName(name: string): { agentId: string; revision?: number } | undefined {
  if (RESERVED_FILES.has(name)) return undefined
  const current = /^([a-z][a-z0-9-]{1,62})@([1-9][0-9]{0,5})\.json$/u.exec(name)
  if (current) return { agentId: current[1]!, revision: Number(current[2]) }
  const legacy = /^([a-z][a-z0-9-]{1,62})\.json$/u.exec(name)
  return legacy ? { agentId: legacy[1]! } : undefined
}

/** Assembled agents carried by a template package. `registered` names the revisions to register on import. */
export interface PortableAgentAssemblyV1 {
  readonly definitions: readonly WorkbenchAgentDefinitionV1[]
  readonly registered: readonly { readonly agentId: string; readonly revision: number }[]
}

export const PORTABLE_AGENT_LIMIT = 64

/** Strict check for package data: every definition must parse back to itself. */
export function validatePortableAgents(value: unknown): asserts value is PortableAgentAssemblyV1 {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('模板包里的 Agent 清单无效。')
  const row = value as Record<string, unknown>
  if (Object.keys(row).some(key => key !== 'definitions' && key !== 'registered') || !Array.isArray(row.definitions) || !Array.isArray(row.registered)
    || row.definitions.length > PORTABLE_AGENT_LIMIT || row.registered.length > PORTABLE_AGENT_LIMIT) throw new Error('模板包里的 Agent 清单无效。')
  const keys = new Set<string>()
  for (const raw of row.definitions) {
    const definition = parseAgentDefinition(raw)
    if (JSON.stringify(sortKeys(definition)) !== JSON.stringify(sortKeys(raw))) throw new Error('模板包里的 Agent 定义含未知或不规范字段。')
    const key = `${definition.agentId}@${definition.revision}`
    if (keys.has(key)) throw new Error('模板包里的 Agent 修订重复。')
    keys.add(key)
  }
  const registered = new Set<string>()
  for (const item of row.registered) {
    if (typeof item !== 'object' || item === null || Array.isArray(item) || Object.keys(item).some(key => key !== 'agentId' && key !== 'revision')) throw new Error('模板包里的注册清单无效。')
    const { agentId, revision } = item as { agentId?: unknown; revision?: unknown }
    if (typeof agentId !== 'string' || !AGENT_ID_PATTERN.test(agentId) || typeof revision !== 'number' || !Number.isInteger(revision) || revision < 1 || revision > 999999) throw new Error('妯℃澘鍖呴噷鐨勬敞鍐屾竻鍗曟棤鏁堛€?')
    const key = `${agentId}@${revision}`
    if (!keys.has(key) || registered.has(key)) throw new Error('模板包注册了不存在或重复的 Agent 修订。')
    registered.add(key)
  }
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (typeof value !== 'object' || value === null) return value
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, sortKeys((value as Record<string, unknown>)[key])]))
}

/** Read the bundle a template export carries. Returns undefined when the Host has no assembly route. */
export async function fetchPortableAgents(workbenchId: string, fetchImpl: typeof fetch = fetch): Promise<PortableAgentAssemblyV1 | undefined> {
  const response = await fetchImpl(AGENT_ASSEMBLY_ROUTE, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'portable', workbenchId }) })
  if (response.status === 404) return undefined
  const result = await response.json() as { value?: unknown; error?: string }
  if (!response.ok) throw new Error(result.error ?? '读取专用 Agent 失败，导出停止。')
  validatePortableAgents(result.value)
  return result.value
}

/** Reject a definition before it is written or registered. */
export function agentDefinitionProblems(definition: WorkbenchAgentDefinitionV1, knownToolIds: ReadonlySet<string>): readonly AgentAssemblyProblemV1[] {
  const problems: AgentAssemblyProblemV1[] = []
  if (definition.schemaVersion !== AGENT_DEFINITION_SCHEMA_VERSION) problems.push({ field: 'schemaVersion', message: '不支持的 Agent 定义版本。' })
  if (!AGENT_ID_PATTERN.test(definition.agentId)) problems.push({ field: 'agentId', message: '标识需以小写字母开头，只含小写字母、数字和连字符。' })
  if (!definition.name.trim() || definition.name.length > 80) problems.push({ field: 'name', message: '名称需要 1 到 80 个字符。' })
  if (!definition.description.trim() || definition.description.length > 400) problems.push({ field: 'description', message: '描述需要 1 到 400 个字符。' })
  if (!(definition.basePreset in BASE_PRESETS)) problems.push({ field: 'basePreset', message: '基础模式不受支持。' })
  if (definition.instructions !== undefined && definition.instructions.length > AGENT_INSTRUCTION_LIMIT) problems.push({ field: 'instructions', message: '模式指令过长。' })
  const allowed = new Set(blocksForBase(definition.basePreset).map(block => block.id))
  for (const block of definition.blocks) if (!allowed.has(block)) problems.push({ field: 'blocks', message: `积木 ${block} 不属于 ${definition.basePreset} 基础模式。` })
  for (const toolId of definition.tools) if (!knownToolIds.has(toolId)) problems.push({ field: 'tools', message: `工具 ${toolId} 不在当前工作台目录中。` })
  if (definition.skills.length > 0 && !definition.blocks.includes('skill')) problems.push({ field: 'skills', message: '选了 Skill 就需要同时启用 Skill 积木。' })
  for (const skillId of definition.skills) if (!definition.tools.includes(skillId)) problems.push({ field: 'skills', message: `Skill ${skillId} 必须同时列在工具中。` })
  if (!['none', 'read-only', 'approved'].includes(definition.guestAccess)) problems.push({ field: 'guestAccess', message: '访客权限无效。' })
  if (!Number.isInteger(definition.revision) || definition.revision < 1) problems.push({ field: 'revision', message: '修订号无效。' })
  return problems
}

/** Parse a file the Host just read. Anything that does not match the schema exactly is rejected, never repaired. */
export function parseAgentDefinition(value: unknown): WorkbenchAgentDefinitionV1 {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Agent 定义不是对象。')
  const row = value as Record<string, unknown>
  const allowed = new Set(['schemaVersion', 'agentId', 'name', 'description', 'basePreset', 'tools', 'skills', 'blocks', 'instructions', 'acceptance', 'guestAccess', 'revision', 'origin', 'updatedAt'])
  if (Object.keys(row).some(key => !allowed.has(key))) throw new Error('Agent 定义含未知字段。')
  const text = (key: string) => { if (typeof row[key] !== 'string') throw new Error(`Agent 定义字段 ${key} 无效。`); return row[key] as string }
  const list = (key: string) => {
    const items = row[key]
    if (!Array.isArray(items) || items.length > 256 || items.some(item => typeof item !== 'string') || new Set(items).size !== items.length) throw new Error(`Agent 定义字段 ${key} 无效。`)
    return items as string[]
  }
  if (row.basePreset !== 'standard' && row.basePreset !== 'minimal') throw new Error('Agent 定义的基础模式无效。')
  if (row.guestAccess !== 'none' && row.guestAccess !== 'read-only' && row.guestAccess !== 'approved') throw new Error('Agent 定义的访客权限无效。')
  if (typeof row.revision !== 'number' || !Number.isInteger(row.revision) || row.revision < 1 || row.revision > 999999) throw new Error('Agent 定义的修订号无效。')
  if (row.instructions !== undefined && (typeof row.instructions !== 'string' || !row.instructions)) throw new Error('Agent 定义的模式指令无效。')
  const origin = row.origin as Record<string, unknown> | undefined
  if (typeof origin !== 'object' || origin === null || Array.isArray(origin) || (origin.kind !== 'manual' && origin.kind !== 'bay-proposal')
    || Object.keys(origin).some(key => !['kind', 'approvedBy', 'approvedAt'].includes(key))
    || ['approvedBy', 'approvedAt'].some(key => origin[key] !== undefined && typeof origin[key] !== 'string')) throw new Error('Agent 定义的来源无效。')
  const updatedAt = text('updatedAt')
  if (!Number.isFinite(Date.parse(updatedAt))) throw new Error('Agent 定义的更新时间无效。')
  if (row.schemaVersion !== AGENT_DEFINITION_SCHEMA_VERSION) throw new Error('不支持的 Agent 定义版本。')
  const definition: WorkbenchAgentDefinitionV1 = {
    schemaVersion: 1,
    agentId: text('agentId'),
    name: text('name'),
    description: text('description'),
    basePreset: row.basePreset,
    tools: list('tools'),
    skills: list('skills'),
    blocks: list('blocks'),
    ...(row.instructions === undefined ? {} : { instructions: row.instructions as string }),
    ...(row.acceptance === undefined ? {} : { acceptance: list('acceptance') }),
    guestAccess: row.guestAccess,
    revision: row.revision,
    origin: { kind: origin.kind, ...(typeof origin.approvedBy === 'string' ? { approvedBy: origin.approvedBy } : {}), ...(typeof origin.approvedAt === 'string' ? { approvedAt: origin.approvedAt } : {}) },
    updatedAt,
  }
  const structural = agentDefinitionProblems(definition, new Set(definition.tools)).filter(problem => problem.field !== 'tools')
  if (structural.length > 0) throw new Error(structural[0]!.message)
  if (definition.skills.some(id => !definition.tools.includes(id))) throw new Error('Agent 定义里的 skill 必须同时列在工具中。')
  return definition
}
