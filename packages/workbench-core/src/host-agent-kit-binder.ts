/**
 * Mount the tools and skills an assembled agent selected into that agent's own scope.
 *
 * Extension executors live in `HostAgentKit`, outside every agent. When an
 * agent is created or switches preset, the binder reads its preset id and,
 * for a registered `bay:` revision, registers exactly the selected tools and
 * skills on `agent.ctx`. Nothing else can see them, and they disappear with
 * the agent scope.
 */

import type { Agent } from '@deepseek-ai/dsh-agent'
import type { AgentPresetRegistry } from '@deepseek-ai/dsh-agent-preset-registry'
import type { WorkbenchAgentDefinitionV1 } from './agent-assembly-model.ts'
import { agentKitSkillName, agentKitToolName, type HostAgentKit } from './host-agent-kit.ts'
import { currentWorkbenchExecutionOrigin } from './host-workbench-native-access.ts'

export interface AgentKitBinding { readonly workbenchId: string; readonly definition: WorkbenchAgentDefinitionV1 }

type BinderContext = {
  on(event: 'agent/created', listener: (payload: { agent: Agent }) => void): () => void
  on(event: 'agent/disposed', listener: (payload: { agent: Agent }) => void): () => void
  on(event: 'agent-preset/selected', listener: (sessionId: string, agentPreset: string) => void): () => void
}

export function installAgentKitBinder(ctx: BinderContext, options: {
  kit: HostAgentKit
  presets: Pick<AgentPresetRegistry, 'composedPreset'>
  /** Registered assembled revision for a preset id, or undefined. */
  binding(presetId: string): AgentKitBinding | undefined
}): () => void {
  const liveAgents = new Map<string, Agent>()
  const selectedPresets = new Map<string, string | undefined>()
  const mounted = new Map<string, { presetId: string; dispose: () => void; agent: Agent }>()
  const unbind = (agentId: string) => { const row = mounted.get(agentId); mounted.delete(agentId); row?.dispose() }
  const bind = (agent: Agent, presetId: string | undefined, force = false) => {
    if (force) unbind(agent.id)
    if (mounted.get(agent.id)?.presetId === presetId) return
    unbind(agent.id)
    if (!presetId) return
    const binding = options.binding(presetId)
    if (!binding) return
    mounted.set(agent.id, { presetId, agent, dispose: mount(agent, binding, options.kit) })
  }
  const offs = [
    ctx.on('agent/created', ({ agent }) => {
      liveAgents.set(agent.id, agent)
      const presetId = selectedPresets.get(agent.id) ?? options.presets.composedPreset(agent.ctx)
      selectedPresets.set(agent.id, presetId)
      bind(agent, presetId)
    }),
    ctx.on('agent/disposed', ({ agent }) => {
      liveAgents.delete(agent.id)
      selectedPresets.delete(agent.id)
      unbind(agent.id)
    }),
    ctx.on('agent-preset/selected', (sessionId, agentPreset) => {
      selectedPresets.set(sessionId, agentPreset)
      const agent = liveAgents.get(sessionId)
      if (agent) bind(agent, agentPreset)
    }),
    options.kit.subscribe(() => {
      for (const agent of liveAgents.values()) {
        const presetId = selectedPresets.get(agent.id) ?? options.presets.composedPreset(agent.ctx)
        selectedPresets.set(agent.id, presetId)
        bind(agent, presetId, true)
      }
    }),
  ]
  return () => {
    for (const off of offs) off()
    for (const id of [...mounted.keys()]) unbind(id)
    liveAgents.clear()
    selectedPresets.clear()
  }
}

function mount(agent: Agent, binding: AgentKitBinding, kit: HostAgentKit): () => void {
  const { definition, workbenchId } = binding
  const skills = new Set(definition.skills)
  const disposers: (() => void)[] = []
  for (const id of definition.tools) {
    if (skills.has(id)) continue
    const tool = kit.tool(id)
    if (!tool) continue
    disposers.push(agent.ctx.tools.register({
      name: agentKitToolName(id),
      description: tool.description,
      parameters: tool.input,
      output: { schema: {}, render: (_args, value) => [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }] },
      execute: async (args, exec) => {
        const origin = currentWorkbenchExecutionOrigin()
        const guest = origin?.actor === 'lan-guest'
        if (guest && definition.guestAccess === 'none') throw new Error('此专用 Agent 不对访客开放。')
        if (guest && definition.guestAccess === 'read-only' && tool.effect !== 'read') throw new Error('访客只能调用只读工具。')
        return tool.execute(args, { workbenchId, agentId: definition.agentId, revision: definition.revision, sessionId: agent.id, guest, signal: exec.signal })
      },
    } as Parameters<Agent['ctx']['tools']['register']>[0]))
  }
  if (definition.blocks.includes('skill')) {
    for (const id of definition.skills) {
      const skill = kit.skill(id)
      if (!skill) continue
      disposers.push(agent.ctx.skills.register({
        name: agentKitSkillName(id),
        description: skill.description,
        ...(skill.whenToUse === undefined ? {} : { whenToUse: skill.whenToUse }),
        content: skill.content,
        source: 'runtime',
        invocation: { modelInvocable: true, userInvocable: false },
      }))
    }
  }
  return () => { for (const dispose of disposers.reverse()) dispose() }
}
