import { afterEach, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BayAgentHost } from '../src/host-bay-agent.ts'
import { createBayAgentStore, baySessionId } from '../src/host-bay-agent-store.ts'
import { settingsFixture } from './settings-fixtures.ts'

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
  const presets = { register: vi.fn(async () => async () => {}), list: async () => [{ id: 'standard', name: 'Standard' }, { id: 'bay-agent', name: 'Bay Agent' }], resolve: async (id: string) => { if (!['standard', 'creator'].includes(id)) throw new Error('unknown mode'); return { id } } }
  const llm = { prepareCall: vi.fn(async (config: any) => ({ config, stream: async function* () { yield { type: 'text-delta', index: 0, text: '# One-shot draft' }; yield { type: 'finish', reason: { kind: 'stop' } } } })) }
  let readers = 0
  const ctx = { llm, on: vi.fn(() => () => {}), get: (name: string) => name === 'agentDefaultModel' ? { currentSelection: () => ({ provider: 'provider-default', model: 'model-default' }) } : undefined, sessionPersistence: { flush: async () => { if (readers) throw new Error('Close journal readers before flushing writes') }, open: async () => { readers++; return { read: async () => ({ events: [] }), [Symbol.asyncDispose]: async () => { readers-- } } } } }
  const create = () => { const host = new BayAgentHost(ctx as never, provider as never, sessions as never, profile, presets as never); dispose.push(() => host.dispose()); return host }
  return { create, agents, sessions, presets, value, profile, llm }
}

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
