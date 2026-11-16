import { describe, expect, it } from 'vitest'
import { aggregateToPersistedUsage, aggregateWorkbenchToolUsage, mapDshToolSessionEvents } from '../src/tool-usage.ts'

describe('Workbench DSH Session tool usage aggregation', () => {
  it('pairs successful, failed, timeout and incomplete calls without copying payloads', () => {
    const records = mapDshToolSessionEvents([
      { type: 'tool/call', sessionId: 's1', callId: 'a', toolId: 'example.search', workbenchId: 'main', at: '2026-10-28T00:00:00.000Z' },
      { type: 'tool/result', sessionId: 's1', callId: 'a', workbenchId: 'main', at: '2026-10-28T00:00:00.100Z' },
      { type: 'tool/call', sessionId: 's1', callId: 'b', toolId: 'example.search', workbenchId: 'main', at: '2026-10-28T00:01:00.000Z' },
      { type: 'tool/result', sessionId: 's1', callId: 'b', error: true, workbenchId: 'main', at: '2026-10-28T00:01:00.200Z' },
      { type: 'tool/call', sessionId: 's1', callId: 'c', toolId: 'example.search', workbenchId: 'main', at: '2026-10-28T00:02:00.000Z' },
      { type: 'tool/timeout', sessionId: 's1', callId: 'c', workbenchId: 'main', at: '2026-10-28T00:02:00.300Z' },
      { type: 'tool/call', sessionId: 's1', callId: 'd', toolId: 'example.search', workbenchId: 'main', at: '2026-10-28T00:03:00.000Z' },
    ], new Set(['example.search']))
    expect(records.map(record => record.outcome)).toEqual(['success', 'failure', 'timeout', 'incomplete'])
    const snapshot = aggregateWorkbenchToolUsage({ workbenchId: 'main', from: '2026-10-27T23:00:00.000Z', to: '2026-10-28T01:00:00.000Z', records, metadata: { 'example.search': { moduleId: 'workbench.example', kind: 'mcp' } } })
    expect(snapshot.totals).toMatchObject({ calls: 4, successes: 1, failures: 1, timeouts: 1 })
    expect(snapshot.byTool[0]).toMatchObject({ calls: 4, averageDurationMs: 200, p50DurationMs: 200, p95DurationMs: 300 })
    expect(snapshot.byContainer).toEqual([expect.objectContaining({ containerId: 'workbench.example:', moduleId: 'workbench.example', sessions: 1, calls: 4 })])
    expect(JSON.stringify(snapshot)).not.toContain('arguments')
  })

  it('keeps Workbench isolation and clips persisted buckets to thirty days', () => {
    const records = [{ sessionId: 's1', callId: 'a', toolId: 'tool.a', workbenchId: 'main', startedAt: '2026-10-28T00:00:00.000Z', finishedAt: '2026-10-28T00:00:00.010Z', outcome: 'success' as const, durationMs: 10 }]
    const snapshot = aggregateWorkbenchToolUsage({ workbenchId: 'other', from: '2026-10-01T00:00:00.000Z', to: '2026-10-29T00:00:00.000Z', records, metadata: { 'tool.a': { moduleId: 'workbench.example', kind: 'tool' } } })
    expect(snapshot.totals.calls).toBe(0)
    const persisted = aggregateToPersistedUsage({ ...snapshot, buckets: [{ startAt: '2026-09-01T00:00:00.000Z', endAt: '2026-09-02T00:00:00.000Z', calls: 1, successes: 1, failures: 0, cancelled: 0, totalDurationMs: 10 }] }, new Date('2026-10-28T00:00:00.000Z'))
    expect(persisted.buckets).toHaveLength(0)
    expect(persisted.byContainer).toEqual(snapshot.byContainer)
  })

  it('groups tools into editor containers in one aggregation pass', () => {
    const records = [
      { sessionId: 's1', callId: 'a', toolId: 'tool.a', workbenchId: 'main', startedAt: '2026-10-28T00:00:00.000Z', outcome: 'success' as const, durationMs: 10 },
      { sessionId: 's2', callId: 'b', toolId: 'tool.b', workbenchId: 'main', startedAt: '2026-10-28T00:01:00.000Z', outcome: 'failure' as const, durationMs: 30 },
      { sessionId: 's1', callId: 'c', toolId: 'tool.a', workbenchId: 'main', startedAt: '2026-10-28T00:02:00.000Z', outcome: 'success' as const, durationMs: 20 },
    ]
    const snapshot = aggregateWorkbenchToolUsage({ workbenchId: 'main', from: '2026-10-27T23:00:00.000Z', to: '2026-10-28T01:00:00.000Z', records, metadata: {
      'tool.a': { moduleId: 'module.a', editorId: 'editor.a', kind: 'tool' },
      'tool.b': { moduleId: 'module.a', editorId: 'editor.a', kind: 'cli' },
    } })
    expect(snapshot.byContainer).toEqual([expect.objectContaining({ containerId: 'module.a:editor.a', sessions: 2, calls: 3, successes: 2, failures: 1, totalDurationMs: 60 })])
  })

  it('keeps all-time trend buckets bounded while retaining cumulative totals', () => {
    const snapshot = aggregateWorkbenchToolUsage({
      workbenchId: 'main', from: new Date(0).toISOString(), to: '2026-10-29T00:00:00.000Z',
      records: [{ sessionId: 's1', callId: 'a', toolId: 'tool.a', workbenchId: 'main', startedAt: '2020-01-01T00:00:00.000Z', outcome: 'success', durationMs: 10 }],
      metadata: { 'tool.a': { moduleId: 'module.a', kind: 'tool' } },
    })
    expect(snapshot.totals.calls).toBe(1)
    expect(snapshot.buckets.length).toBeLessThanOrEqual(720)
    expect(snapshot.buckets[0]?.startAt).toBe('2026-09-29T00:00:00.000Z')
  })
})
