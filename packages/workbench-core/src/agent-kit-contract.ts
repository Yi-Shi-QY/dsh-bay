/**
 * Host contract for extension tools and skills that assembled agents can use.
 *
 * An extension's Host plugin registers executors with the `workbenchAgentKit`
 * Cordis service. Nothing registered here is visible to any agent by default:
 * Core mounts a tool or skill only into the scope of an agent whose assembled
 * definition selected it.
 */

export const AGENT_KIT_SERVICE = 'workbenchAgentKit'
export const AGENT_KIT_MODULE_PATTERN = /^workbench\.[a-z0-9][a-z0-9.-]*$/u

export type AgentKitToolEffectV1 = 'read' | 'write' | 'external'

/** Facts about the call, so an executor can scope its work to one workbench. */
export interface AgentKitCallContextV1 {
  readonly workbenchId: string
  readonly agentId: string
  readonly revision: number
  readonly sessionId: string
  readonly guest: boolean
  readonly signal: AbortSignal
}

export interface AgentKitToolV1 {
  /** `<moduleId>.<name>`; must match the client tool catalog id. */
  readonly id: string
  readonly description: string
  /** JSON Schema object for the arguments. */
  readonly input: Record<string, unknown>
  /** Guests may call `read` tools of a `read-only` agent; other effects need `approved`. */
  readonly effect: AgentKitToolEffectV1
  execute(args: unknown, context: AgentKitCallContextV1): Promise<unknown>
}

export interface AgentKitSkillV1 {
  /** `<moduleId>.<name>`; must match the client tool catalog id of kind `skill`. */
  readonly id: string
  readonly description: string
  readonly whenToUse?: string
  /** Markdown instruction body. */
  readonly content: string
}

export interface AgentKitContributionV1 {
  readonly moduleId: string
  readonly tools?: readonly AgentKitToolV1[]
  readonly skills?: readonly AgentKitSkillV1[]
}

export interface AgentKitInventoryV1 {
  readonly tools: readonly { readonly id: string; readonly effect: AgentKitToolEffectV1 }[]
  readonly skills: readonly string[]
}

export interface WorkbenchAgentKitV1 {
  /** Register one extension's executors. Returns a disposer. */
  register(contribution: AgentKitContributionV1): () => void
  inventory(): AgentKitInventoryV1
}
