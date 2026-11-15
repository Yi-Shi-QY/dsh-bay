/**
 * Host registry of extension executors for assembled agents.
 */

import { AGENT_KIT_MODULE_PATTERN, type AgentKitContributionV1, type AgentKitInventoryV1, type AgentKitSkillV1, type AgentKitToolEffectV1, type AgentKitToolV1, type WorkbenchAgentKitV1 } from './agent-kit-contract.ts'
import type { WorkbenchAgentDefinitionV1 } from './agent-assembly-model.ts'

const ITEM_ID = /^[a-z0-9][a-z0-9._:-]{0,127}$/iu
const EFFECTS = new Set(['read', 'write', 'external'])

/** DSH tool names must be model-safe; catalog ids contain dots. */
export function agentKitToolName(id: string): string {
  return id.replace(/[^A-Za-z0-9_-]/gu, '_').slice(0, 64)
}

/** DSH skill names are kebab-case. */
export function agentKitSkillName(id: string): string {
  return id.toLowerCase().replace(/[^a-z0-9-]+/gu, '-').replace(/^-+|-+$/gu, '').slice(0, 64)
}

export class HostAgentKit implements WorkbenchAgentKitV1 {
  private readonly tools = new Map<string, AgentKitToolV1>()
  private readonly skills = new Map<string, AgentKitSkillV1>()
  private readonly listeners = new Set<() => void>()

  register(contribution: AgentKitContributionV1): () => void {
    if (!AGENT_KIT_MODULE_PATTERN.test(contribution.moduleId)) throw new Error(`Agent kit moduleId is invalid: ${contribution.moduleId}`)
    const prefix = contribution.moduleId + '.'
    const tools = [...contribution.tools ?? []], skills = [...contribution.skills ?? []]
    const names = new Set([...this.tools.keys()].map(agentKitToolName))
    const skillNames = new Set([...this.skills.keys()].map(agentKitSkillName))
    for (const tool of tools) {
      if (!ITEM_ID.test(tool.id) || !tool.id.startsWith(prefix)) throw new Error(`Agent kit tool id must start with ${prefix}: ${tool.id}`)
      if (this.tools.has(tool.id) || names.has(agentKitToolName(tool.id))) throw new Error(`Agent kit tool conflict: ${tool.id}`)
      if (typeof tool.execute !== 'function' || !EFFECTS.has(tool.effect) || typeof tool.description !== 'string' || typeof tool.input !== 'object' || tool.input === null) throw new Error(`Agent kit tool is invalid: ${tool.id}`)
      names.add(agentKitToolName(tool.id))
    }
    for (const skill of skills) {
      if (!ITEM_ID.test(skill.id) || !skill.id.startsWith(prefix)) throw new Error(`Agent kit skill id must start with ${prefix}: ${skill.id}`)
      if (this.skills.has(skill.id) || skillNames.has(agentKitSkillName(skill.id))) throw new Error(`Agent kit skill conflict: ${skill.id}`)
      if (typeof skill.content !== 'string' || !skill.content.trim() || typeof skill.description !== 'string') throw new Error(`Agent kit skill is invalid: ${skill.id}`)
      skillNames.add(agentKitSkillName(skill.id))
    }
    for (const tool of tools) this.tools.set(tool.id, tool)
    for (const skill of skills) this.skills.set(skill.id, skill)
    this.notify()
    let disposed = false
    return () => {
      if (disposed) return
      disposed = true
      for (const tool of tools) if (this.tools.get(tool.id) === tool) this.tools.delete(tool.id)
      for (const skill of skills) if (this.skills.get(skill.id) === skill) this.skills.delete(skill.id)
      this.notify()
    }
  }

  inventory(): AgentKitInventoryV1 {
    return {
      tools: [...this.tools.values()].map(tool => ({ id: tool.id, effect: tool.effect })).sort((left, right) => left.id.localeCompare(right.id)),
      skills: [...this.skills.keys()].sort(),
    }
  }

  tool(id: string): AgentKitToolV1 | undefined { return this.tools.get(id) }
  /** Resolve a mounted DSH tool name back to its declared effect for native policy. */
  effectForName(name: string): AgentKitToolEffectV1 | undefined {
    for (const tool of this.tools.values()) if (agentKitToolName(tool.id) === name) return tool.effect
    return undefined
  }
  skill(id: string): AgentKitSkillV1 | undefined { return this.skills.get(id) }

  /** Ids the definition selected that no Host executor provides. Skill ids also appear in `tools`. */
  missing(definition: Pick<WorkbenchAgentDefinitionV1, 'tools' | 'skills'>): readonly string[] {
    const skills = new Set(definition.skills)
    return [
      ...definition.tools.filter(id => skills.has(id) ? !this.skills.has(id) : !this.tools.has(id)),
      ...definition.skills.filter(id => !definition.tools.includes(id) && !this.skills.has(id)),
    ]
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  private notify() { for (const listener of [...this.listeners]) listener() }
}
