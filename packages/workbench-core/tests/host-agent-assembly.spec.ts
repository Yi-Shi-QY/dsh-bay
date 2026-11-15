import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { HostAgentAssemblyStore } from '../src/host-agent-assembly.ts'
import { composeAgentPlugins } from '../src/host-agent-preset.ts'
import { installAgentAssemblyRoute } from '../src/host-agent-assembly-route.ts'
import { agentDefinitionProblems, parseAgentDefinition, remapAgentPresetId, validatePortableAgents, type WorkbenchAgentDefinitionV1 } from '../src/agent-assembly-model.ts'
import { remapNativeEvent } from '../src/host-native-session-portability.ts'
import type { HostWorkbenchDirectory } from '../src/host-workbench-directory.ts'
import { HostAgentKit } from '../src/host-agent-kit.ts'
import { installAgentKitBinder } from '../src/host-agent-kit-binder.ts'
import { presetUses } from '../src/host-agent-assembly-service.ts'
import { withWorkbenchExecutionOrigin } from '../src/host-workbench-native-access.ts'

const temps: string[] = []
afterEach(() => { for (const folder of temps.splice(0)) rmSync(folder, { recursive: true, force: true }) })

const definition = (overrides: Partial<WorkbenchAgentDefinitionV1> = {}): WorkbenchAgentDefinitionV1 => ({
  schemaVersion: 1, agentId: 'quote-assistant', name: '报价助手', description: '处理报价单', basePreset: 'standard',
  tools: ['workbench.quote.lookup'], skills: [], blocks: ['tool-fs', 'tool-shell'], guestAccess: 'none', revision: 1,
  origin: { kind: 'manual' }, updatedAt: '2026-11-15T00:00:00.000Z', ...overrides,
})

/** Directory fake that writes real files, so the store reads back what it wrote. */
function directory(workbenchIds: readonly string[] = ['main']) {
  const active = new Set(workbenchIds)
  const roots = new Map(workbenchIds.map(id => {
    const root = mkdtempSync(path.join(tmpdir(), 'agent-assembly-'))
    temps.push(root)
    return [id, root] as const
  }))
  const write = (id: string, name: string, value: unknown) => {
    const folder = path.join(roots.get(id)!, '.bay', 'agents')
    mkdirSync(folder, { recursive: true })
    writeFileSync(path.join(folder, name), JSON.stringify(value))
  }
  const fake = {
    getSnapshot: () => ({ value: { workbenches: Object.fromEntries([...active].map(id => [id, {}])) } }),
    rootPath: (id: string) => { const root = roots.get(id); if (!root) throw new Error('未知工作台'); return root },
    writeAgentDefinition: vi.fn(async (id: string, agentId: string, revision: number, value: unknown) => write(id, `${agentId}@${revision}.json`, value)),
    writeAgentSelection: vi.fn(async (id: string, value: unknown) => write(id, 'selection.json', value)),
    writeAgentSuggestion: vi.fn(async (id: string, value: unknown) => write(id, 'suggested.json', value)),
  }
  return { fake: fake as unknown as HostWorkbenchDirectory, roots, active, writer: fake.writeAgentDefinition, write }
}

const input = { workbenchId: 'main', agentId: 'quote-assistant', name: '报价助手', description: '处理报价单', basePreset: 'standard' as const, tools: ['workbench.quote.lookup'], skills: [], blocks: ['tool-fs'], guestAccess: 'none' as const }
/** A kit whose `quote` extension executes `quote.lookup` and ships the `quote.flow` skill. */
function kit() {
  const value = new HostAgentKit()
  const execute = vi.fn(async (args: unknown) => ({ echoed: args }))
  const dispose = value.register({ moduleId: 'workbench.quote',
    tools: [{ id: 'workbench.quote.lookup', description: '查询报价', input: { type: 'object' }, effect: 'read', execute },
      { id: 'workbench.quote.write', description: '改报价', input: { type: 'object' }, effect: 'write', execute }],
    skills: [{ id: 'workbench.quote.flow', description: '报价流程', content: '# 报价流程\n先查再改。' }] })
  return { value, execute, dispose }
}

const registry = () => {
  const live = new Set<string>()
  const register = vi.fn(async (preset: { id: string }) => {
    if (live.has(preset.id)) throw new Error('duplicate preset ' + preset.id)
    live.add(preset.id)
    return async () => { live.delete(preset.id) }
  })
  return { live, register }
}

it('rejects a definition whose blocks do not belong to its base preset', () => {
  const problems = agentDefinitionProblems(definition({ basePreset: 'minimal', blocks: ['tool-shell'] }), new Set(['workbench.quote.lookup']))
  expect(problems.map(problem => problem.field)).toContain('blocks')
  expect(agentDefinitionProblems(definition({ skills: ['workbench.quote.flow'], tools: [] }), new Set()).map(problem => problem.field)).toContain('skills')
  expect(() => parseAgentDefinition({ ...definition(), agentId: '1bad' })).toThrow(/标识/)
  expect(() => parseAgentDefinition({ ...definition(), skills: ['workbench.quote.flow'], tools: [] })).toThrow(/Skill/)
})

it('saves each revision as its own file and registers only the revision a person picks', async () => {
  const fixture = directory()
  const presets = registry()
  const store = new HostAgentAssemblyStore(fixture.fake, presets, kit().value)
  const first = await store.save(input)
  const second = await store.save({ ...input, name: '报价助手二版' })
  expect(first.presetId).toBe('bay:main:quote-assistant@1')
  expect(second.definition.revision).toBe(2)
  expect(presets.register).not.toHaveBeenCalled()
  expect(fixture.writer).toHaveBeenCalledWith('main', 'quote-assistant', 2, expect.objectContaining({ revision: 2 }))
  await store.registerRevision('main', 'quote-assistant', 1)
  expect([...presets.live]).toEqual(['bay:main:quote-assistant@1'])
  expect(store.list('main').map(row => [row.definition.name, row.definition.revision, row.status])).toEqual([['报价助手', 1, 'registered'], ['报价助手二版', 2, 'saved']])
  const selection = JSON.parse(readFileSync(path.join(fixture.roots.get('main')!, '.bay', 'agents', 'selection.json'), 'utf8'))
  expect(selection.registered).toEqual([{ agentId: 'quote-assistant', revision: 1 }])
  await store.dispose()

  // A new Host replays the stored choice.
  const restarted = registry()
  const again = new HostAgentAssemblyStore(fixture.fake, restarted, kit().value)
  await again.restore()
  expect([...restarted.live]).toEqual(['bay:main:quote-assistant@1'])
  await again.dispose()
})

it('serializes concurrent registration changes for one workbench', async () => {
  const fixture = directory()
  const presets = registry()
  const store = new HostAgentAssemblyStore(fixture.fake, presets, kit().value)
  await store.save(input)
  const [first, second] = await Promise.all([
    store.registerRevision('main', 'quote-assistant', 1),
    store.registerRevision('main', 'quote-assistant', 1),
  ])
  expect(first.status).toBe('registered')
  expect(second.status).toBe('registered')
  expect(presets.register).toHaveBeenCalledTimes(1)
  expect([...presets.live]).toEqual(['bay:main:quote-assistant@1'])
  await store.dispose()
})

it('reports sessions that still use a revision when it is unregistered', async () => {
  const fixture = directory()
  const presets = registry()
  const store = new HostAgentAssemblyStore(fixture.fake, presets, kit().value)
  await store.save(input)
  await store.registerRevision('main', 'quote-assistant', 1)
  store.sessionsUsing = (_id, presetId) => presetId === 'bay:main:quote-assistant@1' ? [{ sessionKey: 's1', title: '报价对话', role: 'user' }] : []
  const result = await store.unregisterRevision('main', 'quote-assistant', 1)
  expect(result.sessions.map(row => row.title)).toEqual(['报价对话'])
  expect(result.row.status).toBe('saved')
  expect(presets.live.size).toBe(0)
  await store.dispose()
})

it('offers assembled agents only inside their workbench and hides guest-blocked ones from guests', async () => {
  const fixture = directory(['main', 'other'])
  const store = new HostAgentAssemblyStore(fixture.fake, registry(), kit().value)
  await store.save(input)
  await store.save({ ...input, agentId: 'open-helper', guestAccess: 'read-only' })
  await store.registerRevision('main', 'quote-assistant', 1)
  await store.registerRevision('main', 'open-helper', 1)
  await store.save({ ...input, name: '未注册' })
  expect(store.offers('main', 'standard', false)).toBe(true)
  expect(store.offers('main', 'bay:main:quote-assistant@1', false)).toBe(true)
  expect(store.offers('main', 'bay:main:quote-assistant@2', false)).toBe(false)
  expect(store.offers('other', 'bay:main:quote-assistant@1', false)).toBe(false)
  expect(store.offers('main', 'bay:main:quote-assistant@1', true)).toBe(false)
  expect(store.offers('main', 'bay:main:open-helper@1', true)).toBe(true)
  await store.dispose()
})

it('ignores a copied file whose name and contents disagree', async () => {
  const fixture = directory()
  fixture.write('main', 'renamed@1.json', definition())
  fixture.write('main', 'selection.json', { schemaVersion: 1, registered: [{ agentId: 'renamed', revision: 1 }] })
  const presets = registry()
  const store = new HostAgentAssemblyStore(fixture.fake, presets, kit().value)
  await store.restore()
  expect(presets.register).not.toHaveBeenCalled()
  expect(store.list('main')).toEqual([])
  await store.dispose()
})

it('carries agents through a template bundle and only suggests the packaged choice on import', async () => {
  const source = directory()
  const sourceStore = new HostAgentAssemblyStore(source.fake, registry(), kit().value)
  await sourceStore.save(input)
  await sourceStore.save({ ...input, name: '报价助手二版' })
  await sourceStore.registerRevision('main', 'quote-assistant', 2)
  const bundle = JSON.parse(JSON.stringify(sourceStore.portable('main')))
  expect(() => validatePortableAgents(bundle)).not.toThrow()
  expect(bundle.registered).toEqual([{ agentId: 'quote-assistant', revision: 2 }])
  await sourceStore.dispose()

  const target = directory(['imported'])
  const presets = registry()
  const targetStore = new HostAgentAssemblyStore(target.fake, presets, kit().value)
  const rows = await targetStore.importPortable('imported', bundle, 'template-unsigned')
  expect(presets.live.size).toBe(0)
  expect(rows.map(row => [row.definition.revision, row.status, row.suggested]).sort()).toEqual([[1, 'saved', undefined], [2, 'saved', 'template-unsigned']])
  // A retry after a crash writes nothing twice and still registers nothing.
  await targetStore.importPortable('imported', bundle, 'template-unsigned')
  expect(presets.live.size).toBe(0)
  await targetStore.registerRevision('imported', 'quote-assistant', 2)
  expect([...presets.live]).toEqual(['bay:imported:quote-assistant@2'])
  await targetStore.dispose()

  expect(() => validatePortableAgents({ ...bundle, registered: [{ agentId: 'quote-assistant', revision: 9 }] })).toThrow(/不存在/)
  expect(() => validatePortableAgents({ ...bundle, definitions: [{ ...bundle.definitions[0], script: 'x' }] })).toThrow(/未知/)
})

it('turns a selection copied by a complete package into a suggestion', async () => {
  const fixture = directory(['copy'])
  fixture.write('copy', 'quote-assistant@1.json', definition({ blocks: ['tool-fs'] }))
  fixture.write('copy', 'selection.json', { schemaVersion: 1, registered: [{ agentId: 'quote-assistant', revision: 1 }] })
  const presets = registry()
  const store = new HostAgentAssemblyStore(fixture.fake, presets, kit().value)
  await store.adoptCopiedSelection('copy')
  const rows = await store.restoreWorkbench('copy')
  expect(presets.live.size).toBe(0)
  expect(rows[0]).toMatchObject({ status: 'saved', suggested: 'complete' })
  await store.dispose()
})

it('refuses to register a revision whose tools have no Host executor and registers it once they arrive', async () => {
  const fixture = directory()
  const presets = registry()
  const empty = new HostAgentKit()
  const store = new HostAgentAssemblyStore(fixture.fake, presets, empty)
  const saved = await store.save(input)
  expect(saved).toMatchObject({ status: 'unavailable', missing: ['workbench.quote.lookup'] })
  await expect(store.registerRevision('main', 'quote-assistant', 1)).rejects.toThrow(/缺少/)
  // A selection written earlier (by a person, with the extension installed) waits for the executor.
  fixture.write('main', 'selection.json', { schemaVersion: 1, registered: [{ agentId: 'quote-assistant', revision: 1 }] })
  await store.restore()
  expect(presets.live.size).toBe(0)
  empty.register({ moduleId: 'workbench.quote', tools: [{ id: 'workbench.quote.lookup', description: 'x', input: { type: 'object' }, effect: 'read', execute: async () => 1 }] })
  await store.restore()
  expect([...presets.live]).toEqual(['bay:main:quote-assistant@1'])
  await store.dispose()
})

it('withdraws a registered revision when its Host executor disappears and replays selection when it returns', async () => {
  const fixture = directory()
  const presets = registry()
  const kitted = kit()
  const store = new HostAgentAssemblyStore(fixture.fake, presets, kitted.value)
  await store.save(input)
  await store.registerRevision('main', 'quote-assistant', 1)
  expect(store.list('main')[0]).toMatchObject({ status: 'registered' })

  kitted.dispose()
  await store.refreshAvailability()
  expect(store.list('main')[0]).toMatchObject({ status: 'unavailable', missing: ['workbench.quote.lookup'] })
  expect(presets.live.size).toBe(0)

  await store.restore()
  expect(presets.live.size).toBe(0)
  kitted.value.register({ moduleId: 'workbench.quote', tools: [{ id: 'workbench.quote.lookup', description: 'x', input: { type: 'object' }, effect: 'read', execute: async () => 1 }] })
  await store.restore()
  expect([...presets.live]).toEqual(['bay:main:quote-assistant@1'])
  await store.dispose()
})

it('rejects a stored definition instead of repairing it', () => {
  expect(() => parseAgentDefinition({ ...definition(), basePreset: 'huge' })).toThrow(/基础模式/)
  expect(() => parseAgentDefinition({ ...definition(), guestAccess: 'all' })).toThrow(/访客/)
  expect(() => parseAgentDefinition({ ...definition(), tools: ['ok', 3] })).toThrow(/tools/)
  expect(() => parseAgentDefinition({ ...definition(), plugins: [] })).toThrow(/未知/)
  expect(() => parseAgentDefinition({ ...definition(), skills: ['workbench.quote.flow'] })).toThrow(/Skill/)
})

it('mounts only the selected tools and skills into the agent scope and keeps guests to the allowed effect', async () => {
  const fixture = directory()
  const kitted = kit()
  const store = new HostAgentAssemblyStore(fixture.fake, registry(), kitted.value)
  await store.save({ ...input, blocks: ['tool-fs', 'skill'], tools: ['workbench.quote.lookup', 'workbench.quote.write', 'workbench.quote.flow'], skills: ['workbench.quote.flow'], guestAccess: 'read-only' })
  await store.registerRevision('main', 'quote-assistant', 1)
  const listeners = new Map<string, Function>()
  const tools: { name: string; execute: (args: unknown, exec: { signal: AbortSignal }) => Promise<unknown> }[] = []
  const skills: { name: string; content: string }[] = []
  const agent = { id: 'session-1', ctx: { tools: { register: (row: never) => { tools.push(row); return () => tools.splice(tools.indexOf(row), 1) } }, skills: { register: (row: never) => { skills.push(row); return () => skills.splice(skills.indexOf(row), 1) } } } }
  const ctx = { on: (event: string, listener: Function) => { listeners.set(event, listener); return () => listeners.delete(event) } }
  const dispose = installAgentKitBinder(ctx as never, { kit: kitted.value, presets: { composedPreset: () => 'bay:main:quote-assistant@1' } as never, binding: id => store.binding(id) })
  listeners.get('agent/created')!({ agent })
  expect(tools.map(row => row.name).sort()).toEqual(['workbench_quote_lookup', 'workbench_quote_write'])
  expect(skills.map(row => row.name)).toEqual(['workbench-quote-flow'])
  const signal = new AbortController().signal
  await expect(tools.find(row => row.name === 'workbench_quote_lookup')!.execute({ id: 1 }, { signal })).resolves.toEqual({ echoed: { id: 1 } })
  expect(kitted.execute.mock.calls[0]![1]).toMatchObject({ workbenchId: 'main', agentId: 'quote-assistant', revision: 1, sessionId: 'session-1', guest: false })
  const guest = { accessId: 'g', workbenchId: 'main', actor: 'lan-guest' as const }
  await expect(withWorkbenchExecutionOrigin(guest, () => tools.find(row => row.name === 'workbench_quote_write')!.execute({}, { signal }))).rejects.toThrow(/只读/)
  await expect(withWorkbenchExecutionOrigin(guest, () => tools.find(row => row.name === 'workbench_quote_lookup')!.execute({}, { signal }))).resolves.toBeDefined()
  // A different preset gets nothing; switching away unmounts.
  listeners.get('agent-preset/selected')!('session-1', 'standard')
  expect(tools).toEqual([])
  expect(skills).toEqual([])
  dispose()
  await store.dispose()
})

it('mounts a specialized preset when an ordinary live agent switches into it', async () => {
  const fixture = directory()
  const kitted = kit()
  const store = new HostAgentAssemblyStore(fixture.fake, registry(), kitted.value)
  await store.save(input)
  await store.registerRevision('main', 'quote-assistant', 1)
  const listeners = new Map<string, Function>()
  const tools: { name: string }[] = []
  const agent = { id: 'session-ordinary', ctx: { tools: { register: (row: { name: string }) => { tools.push(row); return () => tools.splice(tools.indexOf(row), 1) } }, skills: { register: () => () => {} } } }
  const ctx = { on: (event: string, listener: Function) => { listeners.set(event, listener); return () => listeners.delete(event) } }
  const dispose = installAgentKitBinder(ctx as never, { kit: kitted.value, presets: { composedPreset: () => 'standard' } as never, binding: id => store.binding(id) })
  listeners.get('agent/created')!({ agent })
  expect(tools).toEqual([])
  listeners.get('agent-preset/selected')!('session-ordinary', 'bay:main:quote-assistant@1')
  expect(tools.map(row => row.name)).toEqual(['workbench_quote_lookup'])
  listeners.get('agent-preset/selected')!('session-ordinary', 'standard')
  expect(tools).toEqual([])
  dispose()
  await store.dispose()
})

it('withdraws and remounts existing agents when an executor is replaced', async () => {
  const fixture = directory()
  const kitted = kit()
  const store = new HostAgentAssemblyStore(fixture.fake, registry(), kitted.value)
  await store.save(input)
  await store.registerRevision('main', 'quote-assistant', 1)
  const listeners = new Map<string, Function>()
  const tools: { name: string; execute: (args: unknown, exec: { signal: AbortSignal }) => Promise<unknown> }[] = []
  const agent = { id: 'session-hotplug', ctx: { tools: { register: (row: never) => { tools.push(row); return () => tools.splice(tools.indexOf(row), 1) } }, skills: { register: () => () => {} } } }
  const ctx = { on: (event: string, listener: Function) => { listeners.set(event, listener); return () => listeners.delete(event) } }
  const dispose = installAgentKitBinder(ctx as never, { kit: kitted.value, presets: { composedPreset: () => 'bay:main:quote-assistant@1' } as never, binding: id => store.binding(id) })
  listeners.get('agent/created')!({ agent })
  expect(tools.map(row => row.name)).toContain('workbench_quote_lookup')
  kitted.dispose()
  expect(tools).toEqual([])
  const replacement = vi.fn(async (args: unknown) => ({ replacement: args }))
  kitted.value.register({ moduleId: 'workbench.quote', tools: [{ id: 'workbench.quote.lookup', description: '鏌ヨ鎶ヤ环', input: { type: 'object' }, effect: 'read', execute: replacement }] })
  expect(tools.map(row => row.name)).toEqual(['workbench_quote_lookup'])
  await expect(tools[0]!.execute({ id: 2 }, { signal: new AbortController().signal })).resolves.toEqual({ replacement: { id: 2 } })
  expect(replacement).toHaveBeenCalled()
  dispose()
  await store.dispose()
})

it('purges registered presets when their workbench is permanently removed', async () => {
  const fixture = directory()
  const presets = registry()
  const kitted = kit()
  const store = new HostAgentAssemblyStore(fixture.fake, presets, kitted.value)
  await store.save(input)
  await store.registerRevision('main', 'quote-assistant', 1)
  expect(presets.live.size).toBe(1)
  fixture.active.delete('main')
  await store.pruneDeletedWorkbenches()
  expect(store.list('main')).toEqual([])
  expect(store.binding('bay:main:quote-assistant@1')).toBeUndefined()
  expect(store.offers('main', 'bay:main:quote-assistant@1', false)).toBe(false)
  expect(presets.live.size).toBe(0)
  await store.dispose()
})

it('names unfinished tasks as well as sessions before an unregister', () => {
  const presetId = 'bay:main:quote-assistant@1'
  const uses = presetUses({ sessionCatalog: { s: { sessionKey: 's', role: 'user', relativePath: '', title: '报价对话', agentPreset: presetId, createdAt: 1 } } as never },
    { workItems: [{ workItemId: 'w1', objective: '整理报价', agentPreset: presetId, status: 'queued' }, { workItemId: 'w2', objective: '旧任务', agentPreset: presetId, status: 'completed' }] as never }, presetId)
  expect(uses.map(row => row.title)).toEqual(['报价对话', '任务：整理报价'])
})

it('moves assembled preset ids to the imported workbench id in session events', () => {
  expect(remapAgentPresetId('bay:old:quote-assistant@2', 'old', 'new')).toBe('bay:new:quote-assistant@2')
  expect(remapAgentPresetId('standard', 'old', 'new')).toBe('standard')
  const event = { type: 'agent-preset/selected', seq: 1, data: { agentPreset: 'bay:old:quote-assistant@2' } } as never
  const context = { sessionIds: {}, sourceRoot: 'C:\\old', targetRoot: 'C:\\new', agentPreset: (id: string) => remapAgentPresetId(id, 'old', 'new') }
  expect((remapNativeEvent(event, context) as unknown as { data: { agentPreset: string } }).data.agentPreset).toBe('bay:new:quote-assistant@2')
})

it('composes only the plugins for the selected blocks', () => {
  const standard = composeAgentPlugins(definition())
  const names = standard.map(row => (row as { name: string }).name)
  expect(names).toContain('@deepseek-ai/dsh-tool-fs')
  expect(names).toContain('@deepseek-ai/dsh-tool-bash')
  expect(names).not.toContain('@deepseek-ai/dsh-tool-web')
  const minimal = composeAgentPlugins(definition({ basePreset: 'minimal', blocks: [] }))
  expect(minimal.map(row => (row as { name: string }).name)).not.toContain('@deepseek-ai/dsh-tool-bash')
  const persona = minimal[0] as { config: { complete?: boolean } }
  expect(persona.config.complete).toBe(true)
})

it('keeps guests from saving or registering while letting them read the roster', async () => {
  const fixture = directory()
  const store = new HostAgentAssemblyStore(fixture.fake, registry(), kit().value)
  await store.save(input)
  const handlers = new Map<string, (request: Request) => Promise<Response>>()
  const connection = { fetch: { register: (route: { path: string; fetch: (request: Request) => Promise<Response> }) => { handlers.set(route.path, route.fetch); return () => {} } } }
  const access = { resolve: () => ({ actor: 'lan-guest' }), authorize: () => {} }
  installAgentAssemblyRoute(connection as never, store, access as never)
  const post = (body: unknown) => handlers.get('/api/workbench/agent-assembly')!(new Request('http://local/api/workbench/agent-assembly', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }))
  const listed = await post({ action: 'list', workbenchId: 'main' })
  expect(listed.status).toBe(200)
  expect(JSON.stringify(await listed.json())).toContain('quote-assistant')
  expect((await post({ action: 'save', workbenchId: 'main', ...input })).status).toBe(403)
  expect((await post({ action: 'register', workbenchId: 'main', agentId: 'quote-assistant', revision: 1 })).status).toBe(403)
  expect((await post({ action: 'portable', workbenchId: 'main' })).status).toBe(403)
  await store.dispose()
})
