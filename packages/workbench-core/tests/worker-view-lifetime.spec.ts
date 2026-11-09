import { afterEach, expect, it, vi } from 'vitest'
import { NativeBayWorkerRuntime } from '../src/host-bay-agent-worker.ts'
import { createAreaContext, createWorkbenchContext } from '../src/foundation/workbench-context.ts'
import { workbenchBayAgentExecutionStaleReason } from '../src/foundation/workbench-bay-agent-adapter.ts'

afterEach(() => vi.useRealTimers())
it('reuses the durable task Session after its view is closed, and monitors without a view lease', async () => {
  vi.useFakeTimers()
  const snapshot = { version: 1 as const, workbenchId: 'wb', name: 'W', description: '', context: createWorkbenchContext(),
    areas: [{ areaId: 'a', label: 'A', ownership: 'bay-agent-managed' as const, active: false, archived: false, visible: false, generation: 1, project: { relativePath: 'app', workspaceId: 'ws', generation: 1 }, context: createAreaContext(), modules: [] }],
    sessions: [{ sessionKey: 'worker:key', sessionId: 'original', areaId: 'a', relativePath: 'app', workspaceId: 'ws', role: 'worker' as const, agentPreset: 'standard', title: 'Task', createdAt: 1 }] }
  const plane = { inspect: () => snapshot, createSession: vi.fn(), openSessionView: vi.fn(async () => ({ status: 'committed', value: { target: { sessionId: 'original', workspaceId: 'ws' }, moduleInstanceId: 'reopened' } })) }
  const sessions = { resolveAgent: vi.fn(async () => ({ agent: {} })), state: vi.fn(async () => ({ running: false, queue: [], pendingInput: [] })), cancel: vi.fn() }
  const deliver = vi.fn(async (_session, _request, _prompt, authorize) => { authorize?.() })
  const runtime = new NativeBayWorkerRuntime({ plane: plane as never, sessions: sessions as never, decorate: async () => {}, deliver })
  const item = { workbenchId: 'wb', workItemId: 'task', areaId: 'a', objective: 'Task', agentPreset: 'standard', inputs: [], successCriteria: [], status: 'running' as const, createdAt: 1, updatedAt: 1 }
  const assignment = { assignmentId: 'attempt-2', workItemId: 'task', areaId: 'a', runtimeName: runtime.name, state: 'pending' as const, createdAt: 2 }
  try {
    const result = await runtime.createAssignment({ workItem: item, assignment, previousAssignment: { ...assignment, assignmentId: 'attempt-1', workerSessionId: 'original' }, prompt: 'Continue', lease: { workbenchId: 'wb', areaId: 'a', areaGeneration: 1, projectGeneration: 1, workbenchContextRevision: 0, areaContextRevision: 0 } })
    expect(result.sessionId).toBe('original'); expect(plane.createSession).not.toHaveBeenCalled()
    expect(deliver).toHaveBeenCalledOnce()
    expect(workbenchBayAgentExecutionStaleReason(result.lease!, snapshot)).toBeUndefined()
    await vi.advanceTimersByTimeAsync(1501)
    expect(sessions.cancel).not.toHaveBeenCalled()
  } finally { runtime.dispose() }
})
