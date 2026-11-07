import { describe, expect, it, vi } from 'vitest'
import { BayAgentController, createBayAgentInMemoryWorkerRuntime, type BayAgentWorkerRuntimeV1 } from '../src/foundation/workbench-bay-agent-work.ts'
import type { WorkbenchBayAgentAdapter } from '../src/foundation/workbench-bay-agent-adapter.ts'

const snapshot = {
  version: 1 as const, workbenchId: 'wb', name: '实验台', description: '',
  context: { schemaVersion: 1 as const, revision: 0, human: { goal: '', constraints: [], preferences: [], allowedActions: [], approvalRequired: [], environment: [] }, agent: { summary: '', currentFocus: '', nextActions: [], blockers: [], proposals: [] } },
  areas: [{ areaId: 'area-a', label: 'Area A', ownership: 'bay-agent-managed' as const, active: true, archived: false, generation: 0, context: { schemaVersion: 1 as const, revision: 0, human: { objective: '', constraints: [], inputs: [], successCriteria: [] }, agent: { summary: '', completed: [], nextActions: [], blockers: [], proposals: [] } }, modules: [] }],
}

function adapter(): WorkbenchBayAgentAdapter {
  return {
    captureExecutionLease: vi.fn(() => ({ workbenchId: 'wb', areaId: 'area-a', areaGeneration: 0, workbenchContextRevision: 0, areaContextRevision: 0 })),
    capturePrompt: vi.fn(() => ({ schemaVersion: 1, capturedAt: 1, workbenchId: 'wb', workbenchContextRevision: 0, workbench: snapshot.context, area: snapshot.areas[0] })),
    applyAreaAgentReport: vi.fn(async () => ({ status: 'committed', value: snapshot.areas[0].context, settingsRevision: 1 })),
  } as unknown as WorkbenchBayAgentAdapter
}

describe('Bay Agent Work Item and Worker Runtime', () => {
  it('reuses persisted Main identity and single-flights concurrent creation', async () => {
    const create = vi.fn(async ({ workbenchId }) => ({ sessionId: 'main-' + workbenchId }))
    let stored: { sessionId: string } | undefined = { sessionId: 'persisted' }
    const make = () => new BayAgentController({ workbenchId: 'wb', inspect: () => snapshot, adapter: adapter(), runtime: createBayAgentInMemoryWorkerRuntime({ autoComplete: false }), sessionCreator: { create }, loadMainSession: () => stored, persistMainSession: async (_id, row) => { stored = row } })
    const first = make()
    expect(await first.ensureMainSession()).toBe('persisted')
    expect(create).not.toHaveBeenCalled()
    first.dispose(); stored = undefined
    const second = make()
    expect(await Promise.all([second.ensureMainSession(), second.ensureMainSession()])).toEqual(['main-wb', 'main-wb'])
    expect(create).toHaveBeenCalledTimes(1)
    second.dispose()
    const third = make(); expect(await third.ensureMainSession()).toBe('main-wb'); expect(create).toHaveBeenCalledTimes(1); third.dispose()
  })

  it('retries failed Main persistence with the same identity', async () => {
    const create = vi.fn(async () => ({ sessionId: 'same-main' })), save = vi.fn().mockRejectedValueOnce(new Error('CAS conflict')).mockResolvedValue(undefined)
    const controller = new BayAgentController({ workbenchId: 'wb', inspect: () => snapshot, adapter: adapter(), runtime: createBayAgentInMemoryWorkerRuntime(), sessionCreator: { create }, persistMainSession: save })
    await expect(controller.ensureMainSession()).rejects.toThrow('CAS conflict')
    expect(await controller.ensureMainSession()).toBe('same-main'); expect(create).toHaveBeenCalledTimes(1); expect(save).toHaveBeenCalledTimes(2)
    controller.dispose()
  })

  it('does not attach a late Main creation to the newly selected Workbench', async () => {
    let finish!: (row: { sessionId: string }) => void
    const persist = vi.fn(async () => {})
    const controller = new BayAgentController({ workbenchId: 'wb', inspect: () => snapshot, adapter: adapter(), runtime: createBayAgentInMemoryWorkerRuntime(), sessionCreator: { create: () => new Promise(resolve => { finish = resolve }) }, persistMainSession: persist })
    const pending = controller.ensureMainSession(); controller.setWorkbenchId('other'); finish({ sessionId: 'main-wb' }); await pending
    expect(controller.getSnapshot().workbenchId).toBe('other'); expect(controller.getSnapshot().bayAgentSessionId).toBeUndefined()
    expect(persist).toHaveBeenCalledWith('wb', { sessionId: 'main-wb' })
    controller.setWorkbenchId('wb'); expect(controller.getSnapshot().bayAgentSessionId).toBe('main-wb'); controller.dispose()
  })

  it('preserves scoped tasks across switches and controller restarts', async () => {
    const states = new Map<string, import('../src/foundation/workbench-bay-agent-work.ts').BayAgentWorkStateV1>()
    let count = 0
    const options = { workbenchId: 'wb', inspect: (id?: string) => ({ ...snapshot, workbenchId: id ?? 'wb' }), adapter: adapter(), runtime: createBayAgentInMemoryWorkerRuntime({ autoComplete: false }), createId: (kind: string) => kind + ++count, loadWorkState: (id: string) => states.get(id), persistWorkState: async (id: string, state: import('../src/foundation/workbench-bay-agent-work.ts').BayAgentWorkStateV1) => { states.set(id, structuredClone(state)) } }
    const first = new BayAgentController(options)
    const one = await first.createWorkItem({ areaId: 'area-a', objective: 'first' }); first.setWorkbenchId('other')
    const two = await first.createWorkItem({ areaId: 'area-a', objective: 'second' }); expect(first.getSnapshot().workItems.map(row => row.workItemId)).toEqual([two.workItemId])
    first.setWorkbenchId('wb'); expect(first.getSnapshot().workItems.map(row => row.workItemId)).toEqual([one.workItemId]); first.dispose()
    const restored = new BayAgentController({ ...options, workbenchId: 'wb' }); expect(restored.getSnapshot().workItems[0]?.objective).toBe('first'); restored.dispose()
  })

  it('persists the Assignment before dispatch and single-flights starts', async () => {
    let latest: import('../src/foundation/workbench-bay-agent-work.ts').BayAgentWorkStateV1 | undefined
    const runtime = createBayAgentInMemoryWorkerRuntime({ autoComplete: false })
    runtime.createAssignment = vi.fn(async input => { expect(latest?.assignments[0]?.assignmentId).toBe(input.assignment?.assignmentId); return { runtimeAssignmentId: 'native', sessionId: 'worker' } })
    const controller = new BayAgentController({ workbenchId: 'wb', inspect: () => snapshot, adapter: adapter(), runtime, persistWorkState: async (_id, state) => { latest = state } })
    const item = await controller.createWorkItem({ areaId: 'area-a', objective: 'once' })
    const results = await Promise.all([controller.startWorkItem(item.workItemId), controller.startWorkItem(item.workItemId)])
    expect(runtime.createAssignment).toHaveBeenCalledTimes(1); expect(results[0].assignmentId).toBe(results[1].assignmentId); expect(latest?.assignments[0]?.workerSessionId).toBe('worker'); controller.dispose()
  })

  it('persists recovery Attention for an interrupted attempt without an observable Worker', async () => {
    let saved: import('../src/foundation/workbench-bay-agent-work.ts').BayAgentWorkStateV1 | undefined
    const first = new BayAgentController({ workbenchId: 'wb', inspect: () => snapshot, adapter: adapter(), runtime: createBayAgentInMemoryWorkerRuntime({ autoComplete: false }), persistWorkState: async (_id, state) => { saved = state } })
    await first.createWorkItem({ areaId: 'area-a', objective: 'recover after restart', start: true }); first.dispose()
    const persist = vi.fn(async (_id, state) => { saved = state })
    const restored = new BayAgentController({ workbenchId: 'wb', inspect: () => snapshot, adapter: adapter(), runtime: createBayAgentInMemoryWorkerRuntime({ autoComplete: false }), loadWorkState: () => saved, persistWorkState: persist })
    await vi.waitFor(() => expect(persist).toHaveBeenCalled())
    expect(saved?.workItems[0]?.status).toBe('needs_input')
    expect(saved?.assignments[0]?.state).toBe('ended')
    expect(saved?.attention[0]?.status).toBe('open'); restored.dispose()
  })

  it('does not dispatch when saving the pending Assignment fails', async () => {
    const runtime = createBayAgentInMemoryWorkerRuntime({ autoComplete: false }); runtime.createAssignment = vi.fn(runtime.createAssignment)
    let fails = false
    const controller = new BayAgentController({ workbenchId: 'wb', inspect: () => snapshot, adapter: adapter(), runtime, persistWorkState: async () => { if (fails) throw new Error('disk full') } })
    const item = await controller.createWorkItem({ areaId: 'area-a', objective: 'save first' }); fails = true
    await expect(controller.startWorkItem(item.workItemId)).rejects.toThrow('disk full'); expect(runtime.createAssignment).not.toHaveBeenCalled(); expect(controller.getSnapshot().assignments).toHaveLength(0); controller.dispose()
  })

  it('ignores stale reports and keeps progress nonterminal; requires answers for recovery', async () => {
    let listener!: (event: import('../src/foundation/workbench-bay-agent-work.ts').BayAgentWorkerRuntimeEventV1) => void
    const runtime = createBayAgentInMemoryWorkerRuntime({ autoComplete: false }); runtime.subscribe = callback => { listener = callback; return () => {} }
    let count = 0; runtime.createAssignment = vi.fn(async () => ({ runtimeAssignmentId: 'runtime-' + ++count }))
    const controller = new BayAgentController({ workbenchId: 'wb', inspect: () => snapshot, adapter: adapter(), runtime })
    const item = await controller.createWorkItem({ areaId: 'area-a', objective: 'report', start: true })
    await listener({ type: 'assignment.report', runtimeAssignmentId: 'runtime-1', state: 'progress', summary: 'working' })
    expect(controller.getSnapshot().assignments[0]?.state).not.toBe('ended')
    await listener({ type: 'assignment.report', runtimeAssignmentId: 'runtime-1', state: 'blocked', summary: 'need details' })
    const attention = controller.listAttention()[0]!
    await expect(controller.resolveAttention(attention.attentionId)).rejects.toThrow('答复')
    await controller.resolveAttention(attention.attentionId, 'use plan B')
    await listener({ type: 'assignment.report', runtimeAssignmentId: 'runtime-1', state: 'ready', summary: 'obsolete' })
    expect(controller.getSnapshot().workItems[0]?.status).toBe('running')
    expect(controller.getSnapshot().workItems[0]?.inputs).toContain('操作者答复：use plan B')
    expect(controller.listAttention()).toHaveLength(0)
    await controller.stopWorkItem(item.workItemId); controller.dispose()
  })

  it('does not turn a native approval into a new Worker attempt', async () => {
    let listener!: (event: import('../src/foundation/workbench-bay-agent-work.ts').BayAgentWorkerRuntimeEventV1) => void
    const runtime = createBayAgentInMemoryWorkerRuntime({ autoComplete: false }); runtime.subscribe = callback => { listener = callback; return () => {} }; runtime.createAssignment = vi.fn(async () => ({ runtimeAssignmentId: 'r' }))
    const controller = new BayAgentController({ workbenchId: 'wb', inspect: () => snapshot, adapter: adapter(), runtime })
    await controller.createWorkItem({ areaId: 'area-a', objective: 'native approval', start: true })
    await listener({ type: 'assignment.input_required', runtimeAssignmentId: 'r', question: 'approval' })
    await expect(controller.resolveAttention(controller.listAttention()[0]!.attentionId, 'yes')).rejects.toThrow('原生对话')
    expect(runtime.createAssignment).toHaveBeenCalledTimes(1)
    await listener({ type: 'assignment.input_cleared', runtimeAssignmentId: 'r' })
    expect(controller.listAttention()).toHaveLength(0); expect(controller.getSnapshot().workItems[0]?.status).toBe('running'); controller.dispose()
  })
  it('keeps the external store snapshot referentially stable until the controller changes', async () => {
    const runtime = createBayAgentInMemoryWorkerRuntime()
    const controller = new BayAgentController({
      workbenchId: 'wb',
      adapter: adapter(),
      inspect: () => snapshot,
      runtime,
      createId: kind => `${kind}-stable`,
    })

    const first = controller.getSnapshot()
    expect(controller.getSnapshot()).toBe(first)

    await controller.createWorkItem({ areaId: 'area-a', objective: '触发状态变更' })

    const second = controller.getSnapshot()
    expect(second).not.toBe(first)
    expect(controller.getSnapshot()).toBe(second)
  })

  it('keeps Workbench IDs separate from runtime assignment IDs and creates a Bay Agent Session', async () => {
    const runtime = createBayAgentInMemoryWorkerRuntime({ autoComplete: true })
    const controller = new BayAgentController({ workbenchId: 'wb', adapter: adapter(), inspect: () => snapshot, runtime, sessionCreator: { create: vi.fn(async () => ({ sessionId: 'bay-session', workspaceId: 'workspace-a' })) }, createId: kind => `${kind}-1` })
    const item = await controller.createWorkItem({ areaId: 'area-a', objective: '完成实验切片', start: true })
    expect(item.workItemId).toBe('work-item-1')
    await new Promise(resolve => setTimeout(resolve, 10))
    const state = controller.getSnapshot()
    expect(state.sessionId).toBe('bay-session')
    expect(state.assignments[0]).toMatchObject({ workItemId: item.workItemId, runtimeAssignmentId: expect.stringContaining('runtime-assignment-') })
    expect(state.workItems[0]?.status).toBe('ready')
  })

  it('routes blocked reports into Attention Queue and supports recovery', async () => {
    const listeners = new Set<(event: Parameters<NonNullable<BayAgentWorkerRuntimeV1['subscribe']> extends (listener: infer L) => unknown ? L : never>[0]) => void>()
    let next = 0
    const runtime: BayAgentWorkerRuntimeV1 = {
      name: 'fake-runtime',
      async createAssignment() { const id = `r-${++next}`; setTimeout(() => listeners.forEach(listener => listener({ type: 'assignment.report', runtimeAssignmentId: id, state: 'blocked', summary: '需要确认', question: '继续吗？' })), 0); return { runtimeAssignmentId: id } },
      async cancelAssignment() {},
      async retryAssignment() { return { runtimeAssignmentId: `r-${++next}` } },
      async recoverAssignment() { return { runtimeAssignmentId: `r-${++next}` } },
      subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) },
    }
    const controller = new BayAgentController({ workbenchId: 'wb', adapter: adapter(), inspect: () => snapshot, runtime, createId: kind => `${kind}-${++next}` })
    const item = await controller.createWorkItem({ areaId: 'area-a', objective: '等待人工确认', start: true })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(controller.listAttention()[0]).toMatchObject({ kind: 'blocked', question: '继续吗？', workItemId: item.workItemId })
    await controller.recoverWorkItem(item.workItemId)
    expect(controller.getSnapshot().workItems[0]?.status).toBe('running')
  })
})
