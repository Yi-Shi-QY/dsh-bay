import { mkdtempSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { baySessionId, createBayAgentStore } from '../src/host-bay-agent-store.ts'

describe('Bay Agent orchestration store', () => {
  it('loads an old V1 snapshot without a ledger and keeps the atomic format readable', () => {
    const profile = mkdtempSync(join(tmpdir(), 'dsh-bay-agent-'))
    const root = join(profile, '.dsh-workbench', 'bay-agent')
    mkdirSync(root, { recursive: true })
    writeFileSync(join(root, baySessionId('wb') + '.json'), JSON.stringify({ state: { version: 1, workItems: [], assignments: [], attention: [] }, relayed: [] }))
    const store = createBayAgentStore(profile)
    expect(store.load('wb')).toMatchObject({ version: 1, workItems: [], assignments: [], attention: [] })
    store.save('wb', { version: 1, workItems: [], assignments: [], attention: [], events: [{ schemaVersion: 1, eventId: 'event-1', seq: 1, workbenchId: 'wb', kind: 'work-item.created', createdAt: 1, source: 'bay-agent', payload: { workItemId: 'work-1' } }], nextEventSeq: 2 })
    expect(store.load('wb').events?.[0]).toMatchObject({ eventId: 'event-1', seq: 1 })
    const files = readdirSync(join(profile, '.dsh-workbench', 'bay-agent'))
    expect(files.some(name => name.endsWith('.events.ndjson'))).toBe(true)
    expect(files.some(name => name.endsWith('.json') && !name.endsWith('.events.ndjson'))).toBe(true)
  })

  it('reads a checkpoint beside a compacted NDJSON ledger', () => {
    const profile = mkdtempSync(join(tmpdir(), 'dsh-bay-agent-'))
    const store = createBayAgentStore(profile)
    const events = Array.from({ length: 3 }, (_, index) => ({ schemaVersion: 1 as const, eventId: `e-${index + 1}`, seq: index + 1, workbenchId: 'wb', kind: 'work-item.created' as const, createdAt: index + 1, source: 'bay-agent' as const, payload: {} }))
    store.save('wb', { version: 1, workItems: [], assignments: [], attention: [], events, nextEventSeq: 4, checkpoint: { schemaVersion: 1, workbenchId: 'wb', compactedThroughSeq: 9, compactedAt: 10, retainedEventCount: 3, countsByKind: { 'work-item.created': 9 }, summary: 'compacted' } })
    const restored = store.load('wb')
    expect(restored.events).toHaveLength(3)
    expect(restored.checkpoint?.compactedThroughSeq).toBe(9)
    expect(restored.nextEventSeq).toBe(10)
  })

  it('persists report relay attempts and recovers an expired send lease', () => {
    const profile = mkdtempSync(join(tmpdir(), 'dsh-bay-agent-'))
    const store = createBayAgentStore(profile)
    store.enqueueRelay('wb', 'assignment-1')
    const queued = store.relayState('wb', 'assignment-1')
    expect(store.claimRelay('wb', 'assignment-1', queued!.nextAttemptAt)).toBe(true)
    expect(store.claimRelay('wb', 'assignment-1', queued!.nextAttemptAt + 1)).toBe(false)
    store.failRelay('wb', 'assignment-1', 'temporary failure', queued!.nextAttemptAt)
    const failed = store.relayState('wb', 'assignment-1')
    expect(failed).toMatchObject({ status: 'pending', attempts: 1, lastError: 'temporary failure' })
    expect(store.claimRelay('wb', 'assignment-1', failed!.nextAttemptAt - 1)).toBe(false)
    expect(store.claimRelay('wb', 'assignment-1', failed!.nextAttemptAt)).toBe(true)
    store.markRelayed('wb', 'assignment-1')
    expect(store.relayState('wb', 'assignment-1')).toMatchObject({ status: 'sent' })
    const restored = createBayAgentStore(profile)
    expect(restored.relayState('wb', 'assignment-1')).toMatchObject({ status: 'sent' })
  })
})
