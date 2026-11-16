import { describe, expect, it, vi } from 'vitest'
import { createWorkbenchToolGateway, type ToolContributionV1 } from '../src/tool-gateway.ts'

const tool = (id = 'workbench.example.search'): ToolContributionV1 => ({
  id,
  kind: 'tool',
  moduleId: 'workbench.example',
  editorId: 'example.tools',
  version: '1.0.0',
  display: { name: id },
  execution: { providerId: 'example', reference: { name: id } },
})

describe('Workbench Tool Gateway invocation usage', () => {
  it('records agent outcomes and sanitized error summaries without raw payloads', () => {
    const gateway = createWorkbenchToolGateway({ workbenchId: 'main' })
    gateway.register(tool())
    const startedAt = new Date(Date.now() - 150).toISOString()
    const start = gateway.beginInvocation({ invocationId: 'inv-1', toolId: 'workbench.example.search', agentId: 'agent-a', startedAt })
    expect(start.workbenchId).toBe('main')
    gateway.completeInvocation({ invocationId: 'inv-1', outcome: 'failure', finishedAt: new Date().toISOString(), error: { code: 'provider.error', message: 'bad\nsecret stack\n/path/to/file' } })
    const snapshot = gateway.usageSnapshot({ from: new Date(Date.now() - 3600000).toISOString(), to: new Date(Date.now() + 1000).toISOString() })
    expect(snapshot.totals).toMatchObject({ calls: 1, failures: 1 })
    expect(snapshot.totals.totalDurationMs).toBeGreaterThanOrEqual(0)
    expect(snapshot.byTool[0]).toMatchObject({ toolId: 'workbench.example.search', failures: 1 })
    expect(snapshot.byTool[0]?.byAgent[0]).toMatchObject({ agentId: 'agent-a', failures: 1 })
    expect(snapshot.byTool[0]?.errors[0]?.message).toBe('bad secret stack [path]')
    expect(JSON.stringify(snapshot)).not.toContain('"stack"')
  })

  it('rejects duplicate and unknown invocations, while duplicate completion is idempotent', () => {
    const gateway = createWorkbenchToolGateway({ workbenchId: 'main' })
    gateway.register(tool())
    gateway.beginInvocation({ invocationId: 'inv-1', toolId: 'workbench.example.search' })
    expect(() => gateway.beginInvocation({ invocationId: 'inv-1', toolId: 'workbench.example.search' })).toThrow('Duplicate invocation id')
    expect(() => gateway.beginInvocation({ invocationId: 'unknown', toolId: 'workbench.example.missing' })).toThrow('Unknown tool contribution')
    gateway.completeInvocation({ invocationId: 'inv-1', outcome: 'success' })
    gateway.completeInvocation({ invocationId: 'inv-1', outcome: 'success' })
    expect(gateway.usageSnapshot({ from: new Date(0).toISOString(), to: new Date(Date.now() + 1000).toISOString() }).totals.calls).toBe(1)
  })

  it('exposes in-flight calls as incomplete in tool and Agent summaries', () => {
    const gateway = createWorkbenchToolGateway({ workbenchId: 'main' })
    gateway.register(tool())
    gateway.beginInvocation({ invocationId: 'in-flight', toolId: 'workbench.example.search', agentId: 'agent-a' })
    const snapshot = gateway.usageSnapshot({ from: new Date(Date.now() - 60_000).toISOString(), to: new Date(Date.now() + 1000).toISOString() })
    expect(snapshot.totals).toMatchObject({ calls: 1, incomplete: 1 })
    expect(snapshot.byTool[0]).toMatchObject({ calls: 1, incomplete: 1 })
    expect(snapshot.byTool[0]?.byAgent[0]).toMatchObject({ agentId: 'agent-a', calls: 1, incomplete: 1, lastOutcome: 'incomplete' })
  })

  it('keeps runtime calls available when aggregate persistence fails', async () => {
    const persistUsage = vi.fn(async () => { throw new Error('settings unavailable') })
    const gateway = createWorkbenchToolGateway({ workbenchId: 'main', persistUsage })
    gateway.register(tool())
    gateway.completeInvocation({ invocationId: 'missing', outcome: 'failure' })
    const handle = gateway.beginInvocation({ invocationId: 'inv-1', toolId: 'workbench.example.search' })
    gateway.completeInvocation({ invocationId: handle.invocationId, outcome: 'success' })
    await new Promise(resolve => setTimeout(resolve, 10))
    const snapshot = gateway.usageSnapshot({ from: new Date(Date.now() - 60_000).toISOString(), to: new Date(Date.now() + 1000).toISOString() })
    expect(snapshot.totals.calls).toBe(1)
    expect(snapshot.sourceStatus).toBe('partial')
  })
})
