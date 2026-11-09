import { afterEach, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BayAgentHost } from '../src/host-bay-agent.ts'
import { createBayAgentStore, baySessionId } from '../src/host-bay-agent-store.ts'
import { settingsFixture } from './settings-fixtures.ts'
import { backgroundAiPreferencesOf } from '../src/foundation/background-ai-preferences.ts'

const dispose: (() => void)[] = []
afterEach(() => { dispose.splice(0).reverse().forEach(close => close()) })
function setup() {
  const profile = mkdtempSync(join(tmpdir(), 'bay-host-test-')); dispose.push(() => rmSync(profile, { recursive: true, force: true }))
  const value = settingsFixture(); delete value.workbenches.b; let revision = 1
  const provider = { writable: true, describe: () => [{ ns: 'workbench-layout', value, user: value, revision }], mutate: vi.fn(async (_ns, ops, expected) => { if (expected !== revision) throw new Error('bad CAS'); for (const op of ops) value.workbenches[op.path[1]] = op.value; revision++ }) }
  const agents = new Map<string, any>()
  const makeAgent = (id: string) => {
    const tools = new Map<string, any>(), sections = new Map<string, any>(), inbox = { nextStep: [], nextTurn: [] as any[] }
    const agent = { id, inbox, ctx: { tools: { register: (tool: any) => { tools.set(tool.name, tool); return () => tools.delete(tool.name) } }, systemPrompt: { section: (section: any) => { sections.set(section.name, section); return () => sections.delete(section.name) } } }, tools, sections, followup: vi.fn((message: any) => inbox.nextTurn.push(message)) }
    agents.set(id, agent); return agent
  }
  const sessions = {
    resolveAgent: vi.fn(async (id: string) => agents.has(id) ? { agent: agents.get(id) } : { error: { code: 'session/not-found' } }),
    create: vi.fn(async ({ sessionId }: { sessionId: string }) => { makeAgent(sessionId); return { sessionId } }),
    rename: vi.fn(async () => ({})),
    selectModel: vi.fn(async () => ({})), cancel: vi.fn(), state: vi.fn(async () => ({ running: true, active: true, queue: [], pendingInput: [] })),
  }
  const presets = { register: vi.fn(async () => async () => {}), list: async () => [{ id: 'standard', name: 'Standard' }, { id: 'creator', name: 'Creator' }, { id: 'bay-agent', name: 'Bay Agent' }], compositionInventory: async () => [
    { id: 'standard', rows: [
      { entryId: 'compaction-basic', moduleName: '@deepseek-ai/dsh-compaction-basic', enabled: true },
      { entryId: 'tool-result-pruner', moduleName: '@deepseek-ai/dsh-compaction-tool-result-pruner', enabled: true },
      { entryId: 'tool-subagent', moduleName: '@deepseek-ai/dsh-tool-subagent', enabled: true },
    ] },
    { id: 'creator', rows: [{ entryId: 'tool-fs', moduleName: '@deepseek-ai/dsh-tool-fs', enabled: true }] },
  ], resolve: async (id: string) => { if (!['standard', 'creator'].includes(id)) throw new Error('unknown mode'); return { id } } }
  const stream = vi.fn(async function* (_options: any) { yield { type: 'text-delta', index: 0, text: '# One-shot draft' }; yield { type: 'finish', reason: { kind: 'stop' } } })
  const llm = { prepareCall: vi.fn(async (config: any) => ({ config, stream })) }
  let readers = 0
  const ctx = { llm, on: vi.fn(() => () => {}), get: (name: string) => name === 'llm' ? llm : name === 'agentDefaultModel' ? { currentSelection: () => ({ provider: 'provider-default', model: 'model-default' }) } : undefined, sessionPersistence: { flush: async () => { if (readers) throw new Error('Close journal readers before flushing writes') }, open: async () => { readers++; return { read: async () => ({ events: [] }), [Symbol.asyncDispose]: async () => { readers-- } } } } }
  const create = (context: unknown = ctx) => { const host = new BayAgentHost(context as never, provider as never, sessions as never, profile, presets as never); dispose.push(() => host.dispose()); return host }
  return { create, agents, sessions, presets, value, profile, llm, stream, ctx }
}

it('generates a draft from a real Cordis plugin context with a separately provided LLM service', async () => {
  const fixture = setup(), root = new Context()
  await root.plugin({ name: 'draft-model-service', apply(ctx) { ctx.provide('llm', fixture.llm as never) } })
  let host: BayAgentHost | undefined
  await root.plugin({ name: 'draft-consumer', apply(ctx) { host = fixture.create(ctx) } })
  await expect(host!.generateBackgroundDraft({ workbenchId: 'a', scope: 'workbench', currentValue: '', selection: { provider: 'p', model: 'm' } })).resolves.toBe('# One-shot draft')
  expect(fixture.stream).toHaveBeenCalledOnce()
})

it('uses every page in the selected Area without leaking other Areas or Workbench goals', async () => {
  const fixture = setup(), record = fixture.value.workbenches.a!
  record.name = 'global-name-marker'; record.description = 'global-description-marker'
  record.document.root = { kind: 'split', id: 'split', axis: 'horizontal', ratio: 0.5, first: record.document.root,
    second: { kind: 'area', areaId: 'other-area', moduleHistory: [{ moduleInstanceId: 'other-page', editorId: 'other.plugin', editorScope: 'root', lastKnownTitle: 'other-page-marker', state: {} }] } }
  const host = fixture.create()
  await host.generateBackgroundDraft({ workbenchId: 'a', scope: 'area', areaId: 'area-a', currentValue: 'area-seed' })
  const prompt = JSON.stringify(fixture.stream.mock.calls[0]![0].messages)
  expect(prompt).toContain('笔记'); expect(prompt).toContain('私密对话'); expect(prompt).toContain('area-seed')
  for (const foreign of ['other-area', 'other.plugin', 'other-page-marker', 'global-description-marker']) expect(prompt).not.toContain(foreign)
})

it('generates a creation draft from unsaved name and description without a Workbench or Main Session', async () => {
  const fixture = setup(); fixture.value.workbenches = {}; fixture.value.openWorkbenchIds = []
  const host = fixture.create()
  await expect(host.generateBackgroundDraft({ scope: 'create', name: '新研究工作台', description: '比较两种电池材料', currentValue: '中文交付' })).resolves.toBe('# One-shot draft')
  const prompt = JSON.stringify(fixture.stream.mock.calls[0]![0].messages)
  expect(prompt).toContain('新研究工作台'); expect(prompt).toContain('比较两种电池材料'); expect(prompt).toContain('中文交付')
  expect(fixture.sessions.create).not.toHaveBeenCalled()
  expect(fixture.value.workbenches).toEqual({})
})

it('uses saved background model and prompts for all three entrances, independently of the Main Session model', async () => {
  const fixture = setup(), host = fixture.create()
  fixture.value.workbenches.a!.workbenchAi = { provider: 'main-provider', model: 'main-model' }
  const main = await host.ensure('a')
  const createCount = fixture.sessions.create.mock.calls.length, selectionCount = fixture.sessions.selectModel.mock.calls.length
  const prefs = { ...backgroundAiPreferencesOf(), selection: { provider: 'draft-provider', model: 'draft-model', reasoningEffort: 'low' }, systemPrompt: 'Shared instructions', prompts: { create: 'Create instructions', workbench: 'Workbench instructions', area: 'Area instructions' } }
  fixture.value.backgroundAi = prefs
  await host.generateBackgroundDraft({ scope: 'create', name: 'New name', description: 'New goal', currentValue: '' })
  await host.generateBackgroundDraft({ scope: 'workbench', workbenchId: 'a', currentValue: '' })
  await host.generateBackgroundDraft({ scope: 'area', workbenchId: 'a', areaId: 'area-a', currentValue: '' })
  for (const [index, scope] of (['create', 'workbench', 'area'] as const).entries()) {
    expect(fixture.llm.prepareCall.mock.calls[index]![0]).toEqual(prefs.selection)
    const call = fixture.stream.mock.calls[index]![0]
    expect(call.system).toBe('Shared instructions')
    const messages = JSON.stringify(call.messages)
    expect(messages).toContain(prefs.prompts[scope])
    for (const other of (['create', 'workbench', 'area'] as const).filter(other => other !== scope)) expect(messages).not.toContain(prefs.prompts[other])
  }
  expect(fixture.sessions.create).toHaveBeenCalledTimes(createCount)
  expect(fixture.sessions.selectModel).toHaveBeenCalledTimes(selectionCount)
  expect(fixture.agents.get(main)?.followup).not.toHaveBeenCalled()
})

it('loads updated background preferences on the next call and restores DSH default independently of Bay settings', async () => {
  const fixture = setup(), host = fixture.create()
  fixture.value.workbenches.a!.workbenchAi = { provider: 'main-provider', model: 'main-model' }
  fixture.value.backgroundAi = { ...backgroundAiPreferencesOf(), selection: { provider: 'draft', model: 'm' } }
  const input = { scope: 'workbench' as const, workbenchId: 'a', currentValue: '' }
  await host.generateBackgroundDraft(input)
  fixture.value.backgroundAi = { ...backgroundAiPreferencesOf(), systemPrompt: 'Changed system', prompts: { create: 'New', workbench: 'Changed Workbench', area: 'Area' } }
  await host.generateBackgroundDraft(input)
  expect(fixture.llm.prepareCall).toHaveBeenLastCalledWith({ provider: 'provider-default', model: 'model-default' }, expect.any(AbortSignal))
  expect(fixture.stream.mock.calls[1]![0].system).toBe('Changed system')
  expect(JSON.stringify(fixture.stream.mock.calls[1]![0].messages)).toContain('Changed Workbench')
  await host.generateBackgroundDraft({ ...input, selection: { provider: 'explicit', model: 'override' } })
  expect(fixture.llm.prepareCall).toHaveBeenLastCalledWith({ provider: 'explicit', model: 'override' }, expect.any(AbortSignal))
})

it('uses portable workbench draft preferences for workbench and area calls while creation follows Host defaults', async () => {
  const fixture = setup(), host = fixture.create()
  const main = await host.ensure('a'), initialSessionCount = fixture.sessions.create.mock.calls.length
  const profile = { ...backgroundAiPreferencesOf(), selection: { provider: 'host', model: 'default' }, systemPrompt: 'Host default' }
  const local = { ...backgroundAiPreferencesOf(), selection: { provider: 'portable', model: 'small' }, systemPrompt: 'Portable workbench' }
  fixture.value.backgroundAi = profile
  fixture.value.workbenches.a!.backgroundAi = local
  await host.generateBackgroundDraft({ scope: 'workbench', workbenchId: 'a', currentValue: '' })
  await host.generateBackgroundDraft({ scope: 'area', workbenchId: 'a', areaId: 'area-a', currentValue: '' })
  await host.generateBackgroundDraft({ scope: 'create', name: 'New', description: '', currentValue: '' })
  expect(fixture.llm.prepareCall.mock.calls.map(([config]) => config)).toEqual([local.selection, local.selection, profile.selection])
  expect(fixture.stream.mock.calls.map(([options]) => options.system)).toEqual([local.systemPrompt, local.systemPrompt, profile.systemPrompt])
  expect(fixture.sessions.create).toHaveBeenCalledTimes(initialSessionCount)
  expect(fixture.agents.get(main)?.followup).not.toHaveBeenCalled()
})

it('registers Bay Main with native session compaction and tool-result pruning', async () => {
  const fixture = setup(), host = fixture.create()
  await host.ensure('a')
  const registration = fixture.presets.register.mock.calls[0]?.[0] as { id: string; plugins: Array<{ id: string; isolate?: Record<string, boolean>; config?: Array<{ id: string; name: string; config?: Record<string, number> }> }> }
  expect(registration.id).toBe('bay-agent')
  const compaction = registration.plugins.find(row => row.id === 'compaction')
  expect(compaction?.isolate).toEqual({ compaction: true, toolResultPruner: true })
  expect(compaction?.config?.map(row => row.name)).toEqual([
    '@deepseek-ai/dsh-compaction-basic',
    '@deepseek-ai/dsh-command-compact',
    '@deepseek-ai/dsh-compaction-tool-result-pruner',
  ])
  expect(compaction?.config?.[2]?.config).toEqual({ thresholdChars: 8192, headChars: 4096, tailChars: 1024 })
})

it('reports native Worker preset capabilities without changing the selected mode', async () => {
  const fixture = setup(), host = fixture.create()
  await host.ensure('a')
  expect(host.snapshot('a').agentModeCapabilities).toEqual([
    { id: 'standard', name: 'Standard', known: true, compaction: true, toolResultPruner: true, ptc: false, subagents: true },
    { id: 'creator', name: 'Creator', known: true, compaction: false, toolResultPruner: false, ptc: false, subagents: false },
  ])
  await expect(host.request({ workbenchId: 'a', action: 'create', input: { areaId: 'area-a', objective: 'Keep creator mode', agentPreset: 'creator', workspaceId: 'workspace-a' } })).resolves.toMatchObject({ value: expect.anything() })
  expect(fixture.sessions.create).toHaveBeenLastCalledWith(expect.objectContaining({ agentPreset: 'creator' }))
})

it('provisions a Workbench-owned Main Session without requiring a project and reuses it on Host restart', async () => {
  const fixture = setup(), host = fixture.create()
  const id = await host.ensure('a')
  expect(id).toBe(baySessionId('main:a'))
  expect(fixture.value.workbenches.a?.bayAgentSession?.sessionId).toBe(id)
  expect(fixture.sessions.create).toHaveBeenCalledWith({ sessionId: id, agentPreset: 'bay-agent' })
  expect(fixture.sessions.rename).toHaveBeenCalledWith({ sessionId: id, title: 'Bay Agent' })
  expect(fixture.agents.get(id)?.tools.has('bay_dispatch')).toBe(true)
  host.dispose()
  const restored = fixture.create(); expect(await restored.ensure('a')).toBe(id)
  expect(fixture.sessions.create.mock.calls.filter(([request]) => request.sessionId === id)).toHaveLength(1)
})

it('dispatches a native Worker, persists its mapping before the prompt, and accepts an explicit report', async () => {
  const fixture = setup(), host = fixture.create(), main = await host.ensure('a')
  const area = host.plane.inspect('a').areas[0]!
  const original = area.modules.map(row => row.binding)
  const result = await host.request({ workbenchId: 'a', action: 'create', input: { areaId: area.areaId, objective: 'Implement task', workspaceId: 'workspace-a', agentPreset: 'creator', successCriteria: ['verified'] } })
  const assignment = result.snapshot.assignments[0]!
  expect(assignment.workerSessionId).not.toBe(main)
  expect(assignment.moduleInstanceId).toBeTruthy()
  expect(fixture.sessions.create).toHaveBeenCalledWith(expect.objectContaining({ sessionId: assignment.workerSessionId, agentPreset: 'creator', workspaceId: 'workspace-a' }))
  expect(host.plane.inspect('a').areas[0]!.modules.slice(0, original.length).map(row => row.binding)).toEqual(original)
  const worker = fixture.agents.get(assignment.workerSessionId!)!
  expect(worker.inbox.nextTurn[0].source.kind).toBe('bay-agent')
  expect(createBayAgentStore(fixture.profile).load('a').assignments[0]?.workerSessionId).toBe(assignment.workerSessionId)
  await worker.tools.get('bay_report').execute({ state: 'ready', summary: 'Verified result' })
  expect(host.snapshot('a').workItems[0]?.status).toBe('ready')
  await host.request({ workbenchId: 'a', action: 'accept', id: result.snapshot.workItems[0]!.workItemId })
  expect(host.snapshot('a').workItems[0]?.status).toBe('completed')
  await expect(worker.tools.get('bay_report').execute({ state: 'ready', summary: 'late' })).rejects.toThrow('current')
})

it('reads context at prompt time and refuses human-context edits through Bay tools', async () => {
  const fixture = setup(), host = fixture.create(), id = await host.ensure('a')
  const agent = fixture.agents.get(id)!
  const section = agent.sections.get('bay-agent-workbench')
  const result = await agent.tools.get('bay_context').execute({ expectedRevision: 0, patch: { summary: 'New summary' } })
  expect(result.result.status).toBe('committed')
  expect(section.text()).toContain('New summary')
  expect(host.snapshot('a').orchestration.currentEventSeq).toBeGreaterThan(0)
  const history = await agent.tools.get('bay_history').execute({ limit: 10 })
  expect(history.result.events.some((event: { kind: string }) => event.kind === 'context.patch.committed')).toBe(true)
  const bad = await agent.tools.get('bay_context').execute({ expectedRevision: 1, patch: { goal: 'Overwrite human goal' } })
  expect(bad.result.status).toBe('rejected')
  expect(section.text()).not.toContain('Overwrite human goal')
})

it('generates background drafts with one direct LLM call and leaves the Main Session untouched', async () => {
  const fixture = setup(), host = fixture.create(), main = await host.ensure('a')
  const area = host.plane.inspect('a').areas[0]!
  const createsBefore = fixture.sessions.create.mock.calls.length
  const draft = await host.generateBackgroundDraft({ workbenchId: 'a', scope: 'area', areaId: area.areaId, currentValue: '' })
  expect(draft).toBe('# One-shot draft')
  expect(fixture.llm.prepareCall).toHaveBeenCalledWith({ provider: 'provider-default', model: 'model-default' }, expect.any(AbortSignal))
  expect(fixture.sessions.create.mock.calls.length).toBe(createsBefore)
  expect(fixture.agents.get(main)?.followup).not.toHaveBeenCalled()
  expect(fixture.agents.get(main)?.inbox.nextTurn).toHaveLength(0)
  const result = await fixture.agents.get(main)?.tools.get('bay_generate_background').execute({ scope: 'workbench', currentValue: 'seed' })
  expect(result.result.persistentSessionUnchanged).toBe(true)
  expect(fixture.llm.prepareCall).toHaveBeenCalledTimes(2)
  expect(fixture.agents.get(main)?.followup).not.toHaveBeenCalled()
})

it('does not dispatch missing modes or cross-workbench targets', async () => {
  const fixture = setup(), host = fixture.create(); await host.ensure('a')
  await expect(host.request({ workbenchId: 'a', action: 'create', input: { areaId: 'foreign', objective: 'bad', agentPreset: 'unknown' } })).rejects.toThrow('unknown mode')
  await expect(host.request({ workbenchId: 'a', action: 'create', input: { areaId: 'foreign', objective: 'bad' } })).rejects.toThrow('area-not-found')
  expect(host.snapshot('a').workItems).toHaveLength(0)
})
