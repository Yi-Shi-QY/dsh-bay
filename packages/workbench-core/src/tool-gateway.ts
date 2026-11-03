/**
 * Workbench Alpha.15 tool integration gateway.
 *
 * The gateway is deliberately a policy and projection service. It does not
 * execute MCP, CLI, native Tool or Skill calls and it never stores secrets.
 * DSH Runtime/Host remains the execution and permission authority.
 */

export type ToolKindV1 = 'mcp' | 'cli' | 'tool' | 'skill'

export type ToolVisibilityV1 = 'enabled' | 'disabled'
export type ToolAvailabilityV1 = 'registered' | 'available' | 'degraded' | 'revoked'

export interface WorkbenchToolInvocationStartV1 {
  readonly invocationId: string
  readonly toolId: string
  readonly agentId?: string
  readonly agentRunId?: string
  readonly startedAt?: string
}

export interface WorkbenchToolInvocationHandleV1 {
  readonly workbenchId: string
  readonly invocationId: string
  readonly toolId: string
  readonly agentId?: string
  readonly agentRunId?: string
  readonly gatewayRevision: number
  readonly gatewaySnapshotDigest: string
  readonly startedAt: string
}

export type WorkbenchToolInvocationOutcomeV1 =
  | 'success'
  | 'failure'
  | 'rejected'
  | 'cancelled'
  | 'timeout'
  | 'incomplete'

export interface WorkbenchToolInvocationCompletionV1 {
  readonly invocationId: string
  readonly outcome: WorkbenchToolInvocationOutcomeV1
  readonly finishedAt?: string
  readonly error?: { readonly code?: string; readonly message: string }
}

import {
  createWorkbenchToolGatewayUsageStore,
  type WorkbenchToolGatewayUsageAggregateV1,
  type WorkbenchToolGatewayUsageSnapshotV1,
  type WorkbenchToolGatewayUsageStoreV1,
} from './tool-gateway-usage.ts'
/* type-only aliases are kept local to avoid exposing the usage store as an execution API. */

export type ContainerEditorTypeV1 =
  | 'conversation-bound'
  | 'standalone'
  | 'standalone-provider'

export interface ToolContributionV1 {
  readonly id: string
  readonly kind: ToolKindV1
  readonly moduleId: string
  readonly editorId?: string
  readonly version: string
  readonly artifactDigest?: string
  readonly display: {
    readonly name: string
    readonly description?: string
  }
  readonly schema?: {
    readonly input?: unknown
    readonly output?: unknown
    readonly error?: unknown
  }
  readonly execution: {
    readonly providerId: string
    readonly reference: unknown
  }
  readonly requires?: {
    readonly capabilities?: readonly string[]
    readonly permissions?: readonly string[]
    readonly credentials?: readonly string[]
  }
  readonly resources?: {
    readonly resourceTypes?: readonly string[]
    readonly editorIds?: readonly string[]
  }
}

export interface ToolProviderAdapterV1 {
  readonly kind: ToolKindV1
  adapt(source: Omit<ToolContributionV1, 'kind'>): ToolContributionV1
}

export interface ToolCatalogEntryV1 extends ToolContributionV1 {
  readonly visibility: ToolVisibilityV1
  readonly availability: ToolAvailabilityV1
  readonly reason?: string
}

export interface ContainerEditorContributionV1 {
  readonly id: string
  readonly moduleId: string
  readonly editorId: string
  readonly type: ContainerEditorTypeV1
  readonly binding: {
    readonly kind: 'conversation' | 'none'
    readonly target?: 'session' | 'agentRun'
  }
  readonly provides?: {
    readonly mcp?: readonly string[]
    readonly cli?: readonly string[]
    readonly tool?: readonly string[]
    readonly skill?: readonly string[]
  }
  readonly consumes?: {
    readonly toolRefs?: readonly string[]
    readonly resourceTypes?: readonly string[]
  }
}

export interface GatewayProjectionBlockedV1 {
  readonly toolId: string
  readonly reason: string
}

export interface GatewayProjectionV1 {
  readonly workbenchId: string
  readonly agentId: string
  readonly snapshotDigest: string
  readonly allowedToolIds: readonly string[]
  readonly tools: readonly ToolCatalogEntryV1[]
  readonly blocked: readonly GatewayProjectionBlockedV1[]
}

export interface GatewaySnapshotEntryV1 {
  readonly toolId: string
  readonly kind: ToolKindV1
  readonly version: string
  readonly artifactDigest?: string
  readonly visibility: ToolVisibilityV1
  readonly availability: ToolAvailabilityV1
  readonly policyDigest: string
}

export interface GatewaySnapshotV1 {
  readonly workbenchId: string
  readonly revision: number
  readonly createdAt: string
  readonly entries: readonly GatewaySnapshotEntryV1[]
  readonly agentAllowlists: readonly { readonly agentId: string; readonly toolIds: readonly string[] }[]
  readonly snapshotDigest: string
}

export interface GatewayDiagnosticSnapshotV1 {
  readonly workbenchId: string
  readonly revision: number
  readonly tools: readonly ToolCatalogEntryV1[]
  readonly editors: readonly ContainerEditorContributionV1[]
  readonly agentAllowlists: readonly { readonly agentId: string; readonly toolIds: readonly string[] }[]
}

export interface WorkbenchToolGatewayPolicyV1 {
  readonly visibility: Readonly<Record<string, ToolVisibilityV1>>
  readonly agentAllowlists: Readonly<Record<string, readonly string[]>>
}

export interface WorkbenchToolGatewayV1 {
  readonly workbenchId: string
  readonly revision: number
  register(contribution: ToolContributionV1): () => void
  registerEditor(contribution: ContainerEditorContributionV1): () => void
  catalog(): readonly ToolCatalogEntryV1[]
  editorCatalog(): readonly ContainerEditorContributionV1[]
  setVisibility(input: { readonly toolId: string; readonly state: ToolVisibilityV1 }): Promise<void>
  /** Persist a module-level visibility change as one policy transaction. */
  setVisibilityBatch(input: { readonly toolIds: readonly string[]; readonly state: ToolVisibilityV1 }): Promise<{
    readonly appliedToolIds: readonly string[]
    readonly rejected: readonly { readonly toolId: string; readonly reason: string }[]
  }>
  /**
   * Change the provider health state. `registered` is an internal lifecycle
   * state and is intentionally not writable; a provider can recover from a
   * degraded/revoked state by explicitly setting `available` again.
   */
  setAvailability(input: { readonly toolId: string; readonly state: Exclude<ToolAvailabilityV1, 'registered'>; readonly reason?: string }): Promise<void>
  setAgentAllowlist(agentId: string, toolIds: readonly string[]): Promise<void>
  policy(): WorkbenchToolGatewayPolicyV1
  projectForAgent(agentId: string): Promise<GatewayProjectionV1>
  snapshot(): Promise<GatewaySnapshotV1>
  inspect(): GatewayDiagnosticSnapshotV1
  beginInvocation(input: WorkbenchToolInvocationStartV1): WorkbenchToolInvocationHandleV1
  completeInvocation(input: WorkbenchToolInvocationCompletionV1): void
  usageSnapshot(input: { readonly from: string; readonly to: string }): WorkbenchToolGatewayUsageSnapshotV1
  subscribeUsage(listener: () => void): () => void
}

export interface WorkbenchToolGatewayManagerV1 {
  forWorkbench(workbenchId: string): WorkbenchToolGatewayV1
  active(): WorkbenchToolGatewayV1
  register(contribution: ToolContributionV1): () => void
  registerEditor(contribution: ContainerEditorContributionV1): () => void
  catalog(): readonly ToolContributionV1[]
  editorCatalog(): readonly ContainerEditorContributionV1[]
}

export interface WorkbenchToolGatewayOptionsV1 {
  readonly workbenchId: string
  readonly capabilities?: () => readonly string[]
  readonly permissions?: () => readonly string[]
  readonly credentials?: () => readonly string[]
  /** Optional DSH/Host policy hook. Returning false is fail-closed. */
  readonly authorize?: (tool: ToolContributionV1) => boolean
  readonly initialPolicy?: WorkbenchToolGatewayPolicyV1
  readonly persistPolicy?: (policy: WorkbenchToolGatewayPolicyV1) => Promise<void>
  readonly initialUsage?: WorkbenchToolGatewayUsageAggregateV1
  readonly persistUsage?: (aggregate: WorkbenchToolGatewayUsageAggregateV1) => Promise<void>
}

export interface WorkbenchToolGatewayManagerOptionsV1 {
  readonly activeWorkbenchId: () => string
  readonly capabilities?: () => readonly string[]
  readonly permissions?: () => readonly string[]
  readonly credentials?: () => readonly string[]
  readonly authorize?: (tool: ToolContributionV1) => boolean
  readonly readPolicy?: (workbenchId: string) => WorkbenchToolGatewayPolicyV1 | undefined
  readonly persistPolicy?: (workbenchId: string, policy: WorkbenchToolGatewayPolicyV1) => Promise<void>
  readonly readUsage?: (workbenchId: string) => WorkbenchToolGatewayUsageAggregateV1 | undefined
  readonly persistUsage?: (workbenchId: string, aggregate: WorkbenchToolGatewayUsageAggregateV1) => Promise<void>
}

const ID = /^[a-z0-9][a-z0-9._:-]{0,127}$/iu
const MODULE_ID = /^workbench\.[a-z0-9][a-z0-9.-]*$/u
const SHA256 = /^[a-f0-9]{64}$/iu
const TOOL_KINDS: readonly ToolKindV1[] = ['mcp', 'cli', 'tool', 'skill']
const EDITOR_TYPES: readonly ContainerEditorTypeV1[] = ['conversation-bound', 'standalone', 'standalone-provider']

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

function assertString(value: unknown, name: string, pattern?: RegExp): asserts value is string {
  if (typeof value !== 'string' || value.trim() === '' || (pattern !== undefined && !pattern.test(value))) {
    throw new Error(`${name} is invalid`)
  }
}

function assertUniqueStrings(values: readonly string[] | undefined, name: string): void {
  if (values === undefined) return
  if (values.some(value => typeof value !== 'string' || value.trim() === '') || new Set(values).size !== values.length) {
    throw new Error(`${name} must contain unique non-empty strings`)
  }
}

export function validateToolContributionV1(value: ToolContributionV1): void {
  if (!isRecord(value)) throw new Error('Tool contribution must be an object')
  assertString(value.id, 'Tool contribution id', ID)
  if (!TOOL_KINDS.includes(value.kind)) throw new Error(`Unsupported tool kind: ${String(value.kind)}`)
  assertString(value.moduleId, 'Tool contribution moduleId', MODULE_ID)
  if (value.editorId !== undefined) assertString(value.editorId, 'Tool contribution editorId', ID)
  assertString(value.version, 'Tool contribution version')
  if (value.artifactDigest !== undefined && !SHA256.test(value.artifactDigest)) throw new Error('Tool contribution artifactDigest is invalid')
  if (!isRecord(value.display)) throw new Error('Tool contribution display is required')
  assertString(value.display.name, 'Tool contribution display.name')
  if (value.display.description !== undefined && typeof value.display.description !== 'string') throw new Error('Tool contribution display.description is invalid')
  if (!isRecord(value.execution)) throw new Error('Tool contribution execution is required')
  assertString(value.execution.providerId, 'Tool contribution execution.providerId', ID)
  if (!('reference' in value.execution)) throw new Error('Tool contribution execution.reference is required')
  if (value.requires !== undefined) {
    if (!isRecord(value.requires)) throw new Error('Tool contribution requires is invalid')
    assertUniqueStrings(value.requires.capabilities, 'Tool contribution capabilities')
    assertUniqueStrings(value.requires.permissions, 'Tool contribution permissions')
    assertUniqueStrings(value.requires.credentials, 'Tool contribution credentials')
  }
  if (value.resources !== undefined) {
    if (!isRecord(value.resources)) throw new Error('Tool contribution resources is invalid')
    assertUniqueStrings(value.resources.resourceTypes, 'Tool contribution resourceTypes')
    assertUniqueStrings(value.resources.editorIds, 'Tool contribution resource editorIds')
  }
}

export function createToolProviderAdaptersV1(): Readonly<Record<ToolKindV1, ToolProviderAdapterV1>> {
  return Object.fromEntries(TOOL_KINDS.map(kind => [kind, {
    kind,
    adapt(source: Omit<ToolContributionV1, 'kind'>): ToolContributionV1 {
      const contribution: ToolContributionV1 = { ...source, kind }
      validateToolContributionV1(contribution)
      return copyTool(contribution)
    },
  }])) as Record<ToolKindV1, ToolProviderAdapterV1>
}

export function validateContainerEditorContributionV1(value: ContainerEditorContributionV1): void {
  if (!isRecord(value)) throw new Error('Container editor contribution must be an object')
  assertString(value.id, 'Container editor contribution id', ID)
  assertString(value.moduleId, 'Container editor contribution moduleId', MODULE_ID)
  assertString(value.editorId, 'Container editor contribution editorId', ID)
  if (!EDITOR_TYPES.includes(value.type)) throw new Error(`Unsupported container editor type: ${String(value.type)}`)
  if (!isRecord(value.binding) || !['conversation', 'none'].includes(value.binding.kind as string)) throw new Error('Container editor binding is invalid')
  if (value.binding.target !== undefined && !['session', 'agentRun'].includes(value.binding.target)) throw new Error('Container editor binding.target is invalid')
  if (value.type === 'conversation-bound' && value.binding.kind !== 'conversation') throw new Error('conversation-bound editor requires a conversation binding')
  if (value.type !== 'conversation-bound' && value.binding.kind !== 'none') throw new Error(`${value.type} editor cannot require a conversation binding`)
  const provides = value.provides
  if (provides !== undefined) {
    if (!isRecord(provides)) throw new Error('Container editor provides is invalid')
    for (const [kind, ids] of Object.entries(provides)) {
      if (!['mcp', 'cli', 'tool', 'skill'].includes(kind)) throw new Error(`Unsupported container editor provider: ${kind}`)
      if (!Array.isArray(ids)) throw new Error(`Container editor provider ${kind} must be an array`)
      assertUniqueStrings(ids, `Container editor provider ${kind}`)
    }
  }
  if (value.type === 'standalone-provider') {
    const count = Object.values(provides ?? {}).reduce((total, ids) => total + (Array.isArray(ids) ? ids.length : 0), 0)
    if (count === 0) throw new Error('standalone-provider editor must expose at least one tool contribution')
  } else if (Object.values(provides ?? {}).some(ids => (ids?.length ?? 0) > 0)) {
    throw new Error(`${value.type} editor cannot expose tool contributions`)
  }
  if (value.consumes !== undefined) {
    if (!isRecord(value.consumes)) throw new Error('Container editor consumes is invalid')
    assertUniqueStrings(value.consumes.toolRefs, 'Container editor toolRefs')
    assertUniqueStrings(value.consumes.resourceTypes, 'Container editor resourceTypes')
  }
}

export function validateWorkbenchToolGatewayPolicyV1(value: WorkbenchToolGatewayPolicyV1): void {
  if (!isRecord(value) || !isRecord(value.visibility) || !isRecord(value.agentAllowlists)) throw new Error('Workbench tool gateway policy is invalid')
  for (const [toolId, state] of Object.entries(value.visibility)) {
    assertString(toolId, 'Workbench tool gateway visibility toolId', ID)
    if (state !== 'enabled' && state !== 'disabled') throw new Error(`Workbench tool gateway visibility is invalid for ${toolId}`)
  }
  for (const [agentId, toolIds] of Object.entries(value.agentAllowlists)) {
    assertString(agentId, 'Workbench tool gateway Agent id', ID)
    if (!Array.isArray(toolIds)) throw new Error(`Workbench tool gateway allowlist is invalid for ${agentId}`)
    assertUniqueStrings(toolIds, `Workbench tool gateway allowlist ${agentId}`)
    for (const toolId of toolIds) assertString(toolId, 'Workbench tool gateway allowlist toolId', ID)
  }
}

function stableJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return JSON.stringify(value)
  if (value === undefined) return 'null'
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (isRecord(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`
  return JSON.stringify(String(value))
}

function syncDigest(value: unknown): string {
  const bytes = new TextEncoder().encode(stableJson(value))
  let hash = 2166136261
  for (const byte of bytes) { hash ^= byte; hash = Math.imul(hash, 16777619) }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, '0')}`
}

function cloneUnknown<T>(value: T): T {
  if (value === undefined || value === null || typeof value !== 'object') return value
  if (typeof structuredClone === 'function') {
    try { return structuredClone(value) }
    catch { /* fall through for provider references containing functions */ }
  }
  if (Array.isArray(value)) return value.map(item => cloneUnknown(item)) as T
  if (isRecord(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneUnknown(item)])) as T
  return value
}

async function sha256(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(stableJson(value))
  const subtle = globalThis.crypto?.subtle
  if (subtle !== undefined) {
    const digest = await subtle.digest('SHA-256', bytes)
    return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
  }
  // Browser/JS test hosts without Web Crypto still get a deterministic
  // diagnostic fingerprint. Production DSH hosts provide Web Crypto.
  let hash = 2166136261
  for (const byte of bytes) { hash ^= byte; hash = Math.imul(hash, 16777619) }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, '0')}`
}

function freezeSnapshot(snapshot: GatewaySnapshotV1): GatewaySnapshotV1 {
  // The snapshot is an input to Agent compilation and sharing. Freeze the
  // complete returned envelope so callers cannot accidentally mutate the
  // evidence after its digest has been recorded.
  const entries = Object.freeze(snapshot.entries.map(entry => Object.freeze({ ...entry })))
  const agentAllowlists = Object.freeze(snapshot.agentAllowlists.map(entry => Object.freeze({
    agentId: entry.agentId,
    toolIds: Object.freeze([...entry.toolIds]),
  })))
  return Object.freeze({ ...snapshot, entries, agentAllowlists })
}

function copyTool(tool: ToolContributionV1): ToolContributionV1 {
  return {
    ...tool,
    display: cloneUnknown(tool.display),
    execution: cloneUnknown(tool.execution),
    ...(tool.schema === undefined ? {} : { schema: cloneUnknown(tool.schema) }),
    ...(tool.requires === undefined ? {} : { requires: {
      ...tool.requires,
      ...(tool.requires.capabilities === undefined ? {} : { capabilities: [...tool.requires.capabilities] }),
      ...(tool.requires.permissions === undefined ? {} : { permissions: [...tool.requires.permissions] }),
      ...(tool.requires.credentials === undefined ? {} : { credentials: [...tool.requires.credentials] }),
    } }),
    ...(tool.resources === undefined ? {} : { resources: {
      ...tool.resources,
      ...(tool.resources.resourceTypes === undefined ? {} : { resourceTypes: [...tool.resources.resourceTypes] }),
      ...(tool.resources.editorIds === undefined ? {} : { editorIds: [...tool.resources.editorIds] }),
    } }),
  }
}

function copyEditor(editor: ContainerEditorContributionV1): ContainerEditorContributionV1 {
  const provides = editor.provides === undefined ? undefined : {
    ...(editor.provides.mcp === undefined ? {} : { mcp: [...editor.provides.mcp] }),
    ...(editor.provides.cli === undefined ? {} : { cli: [...editor.provides.cli] }),
    ...(editor.provides.tool === undefined ? {} : { tool: [...editor.provides.tool] }),
    ...(editor.provides.skill === undefined ? {} : { skill: [...editor.provides.skill] }),
  }
  return {
    ...editor,
    binding: { ...editor.binding },
    ...(provides === undefined ? {} : { provides }),
    ...(editor.consumes === undefined ? {} : { consumes: {
      ...editor.consumes,
      ...(editor.consumes.toolRefs === undefined ? {} : { toolRefs: [...editor.consumes.toolRefs] }),
      ...(editor.consumes.resourceTypes === undefined ? {} : { resourceTypes: [...editor.consumes.resourceTypes] }),
    } }),
  }
}

interface ToolRecordV1 {
  readonly contribution: ToolContributionV1
  visibility: ToolVisibilityV1
  availability: ToolAvailabilityV1
  reason: string | undefined
}

export function createWorkbenchToolGateway(options: WorkbenchToolGatewayOptionsV1): WorkbenchToolGatewayV1 {
  assertString(options.workbenchId, 'Workbench tool gateway workbenchId')
  const tools = new Map<string, ToolRecordV1>()
  const editors = new Map<string, ContainerEditorContributionV1>()
  validateWorkbenchToolGatewayPolicyV1(options.initialPolicy ?? { visibility: {}, agentAllowlists: {} })
  const initialPolicy = options.initialPolicy ?? { visibility: {}, agentAllowlists: {} }
  const visibilityPolicy = new Map(Object.entries(initialPolicy.visibility))
  const agentAllowlists = new Map<string, Set<string>>(Object.entries(initialPolicy.agentAllowlists).map(([agentId, toolIds]) => [agentId, new Set(toolIds)]))
  let revision = 0
  const capabilities = (): ReadonlySet<string> => new Set(options.capabilities?.() ?? [])
  const permissions = (): ReadonlySet<string> => new Set(options.permissions?.() ?? [])
  const credentials = (): ReadonlySet<string> => new Set(options.credentials?.() ?? [])

  const availability = (record: ToolRecordV1): { state: ToolAvailabilityV1; reason?: string } => {
    if (record.availability === 'revoked') return { state: 'revoked', ...(record.reason === undefined ? {} : { reason: record.reason }) }
    if (record.availability === 'degraded') return { state: 'degraded', ...(record.reason === undefined ? {} : { reason: record.reason }) }
    const missingCapabilities = (record.contribution.requires?.capabilities ?? []).filter(item => !capabilities().has(item))
    if (missingCapabilities.length > 0) return { state: 'degraded', reason: `缺少宿主能力：${missingCapabilities.join('、')}` }
    const missingPermissions = (record.contribution.requires?.permissions ?? []).filter(item => !permissions().has(item))
    if (missingPermissions.length > 0) return { state: 'degraded', reason: `缺少权限：${missingPermissions.join('、')}` }
    const missingCredentials = (record.contribution.requires?.credentials ?? []).filter(item => !credentials().has(item))
    if (missingCredentials.length > 0) return { state: 'degraded', reason: `缺少凭据连接：${missingCredentials.join('、')}` }
    if (options.authorize !== undefined && !options.authorize(record.contribution)) return { state: 'degraded', reason: 'DSH/Host 授权策略拒绝' }
    return { state: 'available' }
  }

  const catalog = (): readonly ToolCatalogEntryV1[] => [...tools.values()]
    .map(record => {
      const current = availability(record)
      return {
        ...copyTool(record.contribution),
        visibility: record.visibility,
        availability: current.state,
        ...(current.reason === undefined ? {} : { reason: current.reason }),
      }
    })
    .sort((left, right) => left.id.localeCompare(right.id))

  const allowlistSnapshot = (): readonly { readonly agentId: string; readonly toolIds: readonly string[] }[] => [...agentAllowlists.entries()]
    .map(([agentId, toolIds]) => ({ agentId, toolIds: [...toolIds].sort() }))
    .sort((left, right) => left.agentId.localeCompare(right.agentId))

  const changed = (): void => { revision += 1 }
  let usageStore: WorkbenchToolGatewayUsageStoreV1
  const usageSnapshotDigest = (): string => syncDigest({
    workbenchId: options.workbenchId,
    revision,
    tools: catalog().map(row => ({ id: row.id, version: row.version, visibility: row.visibility, availability: row.availability, reason: row.reason })),
    agentAllowlists: allowlistSnapshot(),
  })
  usageStore = createWorkbenchToolGatewayUsageStore({
    workbenchId: options.workbenchId,
    getCatalog: catalog,
    getRevision: () => revision,
    getSnapshotDigest: usageSnapshotDigest,
    ...(options.initialUsage === undefined ? {} : { initialUsage: options.initialUsage }),
    ...(options.persistUsage === undefined ? {} : { persistUsage: options.persistUsage }),
  })

  return {
    get workbenchId() { return options.workbenchId },
    get revision() { return revision },
    register(input) {
      validateToolContributionV1(input)
      if (tools.has(input.id)) throw new Error(`Tool contribution conflict: ${input.id}`)
      const visibility = visibilityPolicy.get(input.id) ?? 'enabled'
      visibilityPolicy.set(input.id, visibility)
      tools.set(input.id, { contribution: copyTool(input), visibility, availability: 'registered', reason: undefined })
      changed()
      return () => {
        if (!tools.has(input.id)) return
        for (const editor of editors.values()) {
          const refs = Object.values(editor.provides ?? {}).flatMap(ids => ids ?? [])
          if (refs.includes(input.id)) throw new Error(`Cannot remove tool ${input.id} while editor ${editor.id} exposes it`)
        }
        tools.delete(input.id)
        changed()
      }
    },
    registerEditor(input) {
      validateContainerEditorContributionV1(input)
      if (editors.has(input.id)) throw new Error(`Container editor contribution conflict: ${input.id}`)
      if ([...editors.values()].some(editor => editor.moduleId === input.moduleId && editor.editorId === input.editorId)) {
        throw new Error(`Container editor identity conflict: ${input.moduleId}/${input.editorId}`)
      }
      for (const [kind, ids] of Object.entries(input.provides ?? {})) {
        for (const toolId of ids ?? []) {
          const record = tools.get(toolId)
          if (record === undefined) throw new Error(`Container editor ${input.id} references unknown tool ${toolId}`)
          if (record.contribution.kind !== kind || record.contribution.moduleId !== input.moduleId
            || record.contribution.editorId !== input.editorId) {
            throw new Error(`Container editor ${input.id} conflicts with tool identity ${toolId}`)
          }
        }
      }
      editors.set(input.id, copyEditor(input))
      changed()
      return () => { if (editors.delete(input.id)) changed() }
    },
    catalog,
    editorCatalog: () => [...editors.values()].map(copyEditor).sort((left, right) => left.id.localeCompare(right.id)),
    async setVisibility(input) {
      assertString(input.toolId, 'Tool visibility toolId', ID)
      const record = tools.get(input.toolId)
      if (record === undefined) throw new Error(`Unknown tool contribution: ${input.toolId}`)
      if (record.visibility !== input.state) {
        const next = { ...policy(), visibility: { ...policy().visibility, [input.toolId]: input.state } }
        await options.persistPolicy?.(next)
        visibilityPolicy.set(input.toolId, input.state)
        record.visibility = input.state
        changed()
      }
    },
    async setVisibilityBatch(input) {
      assertUniqueStrings(input.toolIds, 'Tool visibility batch toolIds')
      if (input.toolIds.length === 0) return { appliedToolIds: [], rejected: [] }
      const uniqueToolIds = [...new Set(input.toolIds)]
      const rejected: Array<{ toolId: string; reason: string }> = []
      const accepted: ToolRecordV1[] = []
      for (const toolId of uniqueToolIds) {
        const record = tools.get(toolId)
        if (record === undefined) {
          rejected.push({ toolId, reason: `Unknown tool contribution: ${toolId}` })
          continue
        }
        accepted.push(record)
      }
      if (accepted.length === 0) return { appliedToolIds: [], rejected }
      // Build and persist the complete next policy before mutating local
      // records. A failed CAS or Settings write therefore leaves the catalog
      // unchanged and callers can safely retry the entire batch.
      const nextVisibility = { ...policy().visibility }
      for (const record of accepted) nextVisibility[record.contribution.id] = input.state
      const next = { ...policy(), visibility: nextVisibility }
      await options.persistPolicy?.(next)
      for (const record of accepted) {
        visibilityPolicy.set(record.contribution.id, input.state)
        record.visibility = input.state
      }
      changed()
      return { appliedToolIds: accepted.map(record => record.contribution.id), rejected }
    },
    async setAvailability(input) {
      assertString(input.toolId, 'Tool availability toolId', ID)
      const record = tools.get(input.toolId)
      if (record === undefined) throw new Error(`Unknown tool contribution: ${input.toolId}`)
      if (record.availability !== input.state || record.reason !== input.reason) {
        record.availability = input.state
        record.reason = input.reason
        changed()
      }
    },
    async setAgentAllowlist(agentId, toolIds) {
      assertString(agentId, 'Agent allowlist agentId', ID)
      assertUniqueStrings(toolIds, 'Agent allowlist toolIds')
      for (const toolId of toolIds) if (!tools.has(toolId)) throw new Error(`Unknown tool contribution in Agent allowlist: ${toolId}`)
      const next = { ...policy(), agentAllowlists: { ...policy().agentAllowlists, [agentId]: [...toolIds].sort() } }
      await options.persistPolicy?.(next)
      agentAllowlists.set(agentId, new Set(toolIds))
      changed()
    },
    policy,
    async snapshot() {
      const rows = catalog()
      const entries = await Promise.all(rows.map(async row => ({
        toolId: row.id,
        kind: row.kind,
        version: row.version,
        ...(row.artifactDigest === undefined ? {} : { artifactDigest: row.artifactDigest }),
        visibility: row.visibility,
        availability: row.availability,
        policyDigest: await sha256({
          toolId: row.id,
          visibility: row.visibility,
          availability: row.availability,
          reason: row.reason,
          agentAllowlists: allowlistSnapshot().filter(item => item.toolIds.includes(row.id)),
        }),
      })))
      const agentPolicies = allowlistSnapshot()
      const digest = await sha256({ workbenchId: options.workbenchId, revision, entries, agentAllowlists: agentPolicies })
      return freezeSnapshot({
        workbenchId: options.workbenchId,
        revision,
        createdAt: new Date().toISOString(),
        entries,
        agentAllowlists: agentPolicies,
        snapshotDigest: digest,
      })
    },
    async projectForAgent(agentId) {
      assertString(agentId, 'Agent projection agentId', ID)
      const snapshot = await this.snapshot()
      const allowlist = new Set(agentAllowlists.get(agentId) ?? [])
      const rows = catalog()
      const toolsForAgent = rows.filter(row => {
        if (row.visibility !== 'enabled') return false
        if (row.availability !== 'available') return false
        return allowlist.has(row.id)
      })
      const blocked = rows.filter(row => !toolsForAgent.some(tool => tool.id === row.id)).map(row => ({
        toolId: row.id,
        reason: row.visibility !== 'enabled' ? 'Workbench 工具可见性已关闭'
          : row.availability !== 'available' ? (row.reason ?? `工具状态为 ${row.availability}`)
            : !allowlist.has(row.id) ? 'Agent allowlist 未允许'
              : '工具未通过授权投影',
      }))
      return { workbenchId: options.workbenchId, agentId, snapshotDigest: snapshot.snapshotDigest, allowedToolIds: toolsForAgent.map(tool => tool.id), tools: toolsForAgent, blocked }
    },
    inspect() {
      return { workbenchId: options.workbenchId, revision, tools: catalog(), editors: [...editors.values()].map(copyEditor).sort((left, right) => left.id.localeCompare(right.id)), agentAllowlists: allowlistSnapshot() }
    },
    beginInvocation(input) { return usageStore.beginInvocation(input) },
    completeInvocation(input) { usageStore.completeInvocation(input) },
    usageSnapshot(input) { return usageStore.usageSnapshot(input) },
    subscribeUsage(listener) { return usageStore.subscribeUsage(listener) },
  }

  function policy(): WorkbenchToolGatewayPolicyV1 {
    return {
      visibility: Object.fromEntries([...visibilityPolicy.entries()].sort(([left], [right]) => left.localeCompare(right))),
      agentAllowlists: Object.fromEntries(allowlistSnapshot().map(entry => [entry.agentId, [...entry.toolIds]])),
    }
  }
}

export function createWorkbenchToolGatewayManager(options: WorkbenchToolGatewayManagerOptionsV1): WorkbenchToolGatewayManagerV1 {
  const gateways = new Map<string, WorkbenchToolGatewayV1>()
  const tools = new Map<string, ToolContributionV1>()
  const editors = new Map<string, ContainerEditorContributionV1>()

  const forWorkbench = (workbenchId: string): WorkbenchToolGatewayV1 => {
    assertString(workbenchId, 'Workbench tool gateway workbenchId')
    const existing = gateways.get(workbenchId)
    if (existing !== undefined) return existing
    const initialPolicy = options.readPolicy?.(workbenchId)
    const initialUsage = options.readUsage?.(workbenchId)
    const gateway = createWorkbenchToolGateway({
      workbenchId,
      ...(options.capabilities === undefined ? {} : { capabilities: options.capabilities }),
      ...(options.permissions === undefined ? {} : { permissions: options.permissions }),
      ...(options.credentials === undefined ? {} : { credentials: options.credentials }),
      ...(options.authorize === undefined ? {} : { authorize: options.authorize }),
      ...(initialPolicy === undefined ? {} : { initialPolicy }),
      ...(options.persistPolicy === undefined ? {} : { persistPolicy: policy => options.persistPolicy!(workbenchId, policy) }),
      ...(initialUsage === undefined ? {} : { initialUsage }),
      ...(options.persistUsage === undefined ? {} : { persistUsage: aggregate => options.persistUsage!(workbenchId, aggregate) }),
    })
    gateways.set(workbenchId, gateway)
    for (const contribution of tools.values()) gateway.register(contribution)
    for (const contribution of editors.values()) gateway.registerEditor(contribution)
    return gateway
  }

  return {
    forWorkbench,
    active: () => forWorkbench(options.activeWorkbenchId()),
    register(contribution) {
      validateToolContributionV1(contribution)
      if (tools.has(contribution.id)) throw new Error(`Tool contribution conflict: ${contribution.id}`)
      for (const editor of editors.values()) {
        if (Object.values(editor.provides ?? {}).some(ids => ids?.includes(contribution.id))
          && (editor.moduleId !== contribution.moduleId || editor.editorId !== contribution.editorId
            || !(editor.provides?.[contribution.kind] ?? []).includes(contribution.id))) {
          throw new Error(`Tool contribution conflicts with container editor identity: ${contribution.id}`)
        }
      }
      const disposers: Array<() => void> = []
      try {
        for (const gateway of gateways.values()) disposers.push(gateway.register(contribution))
      } catch (error) {
        for (const dispose of disposers.reverse()) dispose()
        throw error
      }
      tools.set(contribution.id, copyTool(contribution))
      return () => {
        const refs = [...editors.values()].flatMap(editor => Object.values(editor.provides ?? {}).flatMap(ids => ids ?? []))
        if (refs.includes(contribution.id)) throw new Error(`Cannot remove tool ${contribution.id} while a container editor exposes it`)
        for (const dispose of disposers) dispose()
        tools.delete(contribution.id)
      }
    },
    registerEditor(contribution) {
      validateContainerEditorContributionV1(contribution)
      if (editors.has(contribution.id)) throw new Error(`Container editor contribution conflict: ${contribution.id}`)
      if ([...editors.values()].some(editor => editor.moduleId === contribution.moduleId && editor.editorId === contribution.editorId)) {
        throw new Error(`Container editor identity conflict: ${contribution.moduleId}/${contribution.editorId}`)
      }
      const disposers: Array<() => void> = []
      try {
        for (const gateway of gateways.values()) disposers.push(gateway.registerEditor(contribution))
      } catch (error) {
        for (const dispose of disposers.reverse()) dispose()
        throw error
      }
      editors.set(contribution.id, copyEditor(contribution))
      return () => {
        for (const dispose of disposers) dispose()
        editors.delete(contribution.id)
      }
    },
    catalog: () => [...tools.values()].map(copyTool).sort((left, right) => left.id.localeCompare(right.id)),
    editorCatalog: () => [...editors.values()].map(copyEditor).sort((left, right) => left.id.localeCompare(right.id)),
  }
}
