import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { BayAgentOrchestrationCheckpointV1, BayAgentOrchestrationEventV1, BayAgentWorkStateV1 } from './foundation/workbench-bay-agent-work.ts'

export function baySessionId(key: string): string {
  const hash = createHash('sha256').update('dsh-bay:' + key).digest('hex')
  return [hash.slice(0, 8), hash.slice(8, 12), '5' + hash.slice(13, 16), 'a' + hash.slice(17, 20), hash.slice(20, 32)].join('-')
}

const MAX_BYTES = 8 * 1024 * 1024
const validEvent = (id: string, value: unknown): value is BayAgentOrchestrationEventV1 => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const row = value as BayAgentOrchestrationEventV1
  return row.schemaVersion === 1 && typeof row.eventId === 'string' && row.eventId.length <= 256
    && Number.isInteger(row.seq) && row.seq > 0 && row.workbenchId === id && typeof row.kind === 'string'
    && Number.isFinite(row.createdAt) && ['bay-agent', 'worker', 'human', 'runtime'].includes(row.source)
    && !!row.payload && typeof row.payload === 'object' && !Array.isArray(row.payload)
}
const validCheckpoint = (id: string, value: unknown): value is BayAgentOrchestrationCheckpointV1 => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const row = value as BayAgentOrchestrationCheckpointV1
  return row.schemaVersion === 1 && row.workbenchId === id && Number.isInteger(row.compactedThroughSeq) && row.compactedThroughSeq >= 0
    && Number.isFinite(row.compactedAt) && Number.isInteger(row.retainedEventCount) && row.retainedEventCount >= 0
    && !!row.countsByKind && typeof row.countsByKind === 'object' && typeof row.summary === 'string' && row.summary.length <= 2000
}

export type BayAgentRelayRecordV1 = {
  assignmentId: string
  status: 'pending' | 'sending' | 'sent'
  attempts: number
  nextAttemptAt: number
  leaseUntil?: number
  lastError?: string
  updatedAt: number
}

/** One Host owns the snapshot, NDJSON ledger and compaction checkpoint. */
export function createBayAgentStore(profile: string) {
  const root = join(profile, '.dsh-workbench', 'bay-agent')
  type StoreRecord = { state: BayAgentWorkStateV1; relayed: string[]; relayQueue?: BayAgentRelayRecordV1[] }
  const paths = (id: string) => {
    const base = join(root, baySessionId(id))
    return { snapshot: base + '.json', events: base + '.events.ndjson', checkpoint: base + '.checkpoint.json' }
  }
  const readEvents = (id: string, path: string): BayAgentOrchestrationEventV1[] => {
    if (!existsSync(path)) return []
    if (statSync(path).size > MAX_BYTES) throw new Error('Bay Agent NDJSON ledger exceeds 8 MiB')
    const rows: BayAgentOrchestrationEventV1[] = []
    for (const line of readFileSync(path, 'utf8').split(/\r?\n/u)) {
      if (!line.trim()) continue
      let value: unknown
      try { value = JSON.parse(line) } catch { throw new Error('Invalid Bay Agent NDJSON ledger') }
      if (!validEvent(id, value)) throw new Error('Invalid Bay Agent NDJSON event')
      rows.push(value)
    }
    const ids = new Set(rows.map(row => row.eventId))
    if (ids.size !== rows.length || rows.some((row, index) => index > 0 && row.seq <= rows[index - 1]!.seq)) throw new Error('Invalid Bay Agent NDJSON ordering')
    return rows
  }
  const read = (id: string): StoreRecord => {
    const { snapshot, events: eventsPath, checkpoint: checkpointPath } = paths(id)
    let row: StoreRecord = { state: { version: 1, workItems: [], assignments: [], attention: [], nextEventSeq: 1 }, relayed: [], relayQueue: [] }
    if (existsSync(snapshot)) {
      if (statSync(snapshot).size > MAX_BYTES) throw new Error('Bay Agent snapshot exceeds 8 MiB')
      try { row = JSON.parse(readFileSync(snapshot, 'utf8')) as StoreRecord } catch { throw new Error('Invalid Bay Agent snapshot') }
    }
    const state = row.state
    if (state?.version !== 1 || !Array.isArray(state.workItems) || !Array.isArray(state.assignments) || !Array.isArray(state.attention)
      || (state.events !== undefined && !Array.isArray(state.events)) || (state.nextEventSeq !== undefined && (!Number.isInteger(state.nextEventSeq) || state.nextEventSeq < 1))
      || !Array.isArray(row.relayed)
      || (row.relayQueue !== undefined && (!Array.isArray(row.relayQueue) || !row.relayQueue.every(relay => relay && typeof relay.assignmentId === 'string' && ['pending', 'sending', 'sent'].includes(relay.status) && Number.isInteger(relay.attempts) && relay.attempts >= 0 && Number.isFinite(relay.nextAttemptAt) && Number.isFinite(relay.updatedAt))))
      || !state.workItems.every(item => item.workbenchId === id && typeof item.workItemId === 'string' && typeof item.objective === 'string' && Array.isArray(item.inputs))
      || !state.assignments.every(item => typeof item.assignmentId === 'string' && state.workItems.some(work => work.workItemId === item.workItemId))
      || !state.attention.every(item => typeof item.attentionId === 'string' && state.workItems.some(work => work.workItemId === item.workItemId))) throw new Error('Invalid Bay Agent snapshot')
    const legacyRows = state.events ?? []
    if (legacyRows.some(event => !validEvent(id, event))) throw new Error('Invalid Bay Agent legacy ledger')
    const ledger = [...legacyRows, ...readEvents(id, eventsPath)].sort((a, b) => a.seq - b.seq)
    const byId = new Map(ledger.map(event => [event.eventId, event]))
    const events = [...byId.values()].sort((a, b) => a.seq - b.seq)
    if (events.some((event, index) => index > 0 && event.seq <= events[index - 1]!.seq)) throw new Error('Invalid Bay Agent ledger sequence')
    let checkpoint = state.checkpoint
    if (existsSync(checkpointPath)) {
      if (statSync(checkpointPath).size > 128 * 1024) throw new Error('Bay Agent checkpoint exceeds 128 KiB')
      try { checkpoint = JSON.parse(readFileSync(checkpointPath, 'utf8')) as BayAgentOrchestrationCheckpointV1 } catch { throw new Error('Invalid Bay Agent checkpoint') }
    }
    if (checkpoint !== undefined && !validCheckpoint(id, checkpoint)) throw new Error('Invalid Bay Agent checkpoint')
    const maxSeq = events.reduce((max, event) => Math.max(max, event.seq), checkpoint?.compactedThroughSeq ?? 0)
    const legacyRelayed = new Set(row.relayed)
    const relayQueue = (row.relayQueue ?? []).map(relay => legacyRelayed.has(relay.assignmentId) ? { ...relay, status: 'sent' as const } : relay)
    for (const assignmentId of legacyRelayed) if (!relayQueue.some(relay => relay.assignmentId === assignmentId)) relayQueue.push({ assignmentId, status: 'sent', attempts: 1, nextAttemptAt: 0, updatedAt: Date.now() })
    return { ...row, relayQueue, state: { ...state, events, nextEventSeq: Math.max(state.nextEventSeq ?? 1, maxSeq + 1), ...(checkpoint === undefined ? {} : { checkpoint }) } }
  }
  const atomicWrite = (path: string, body: string, limit = MAX_BYTES) => {
    if (Buffer.byteLength(body) > limit) throw new Error('Bay Agent durable record is full')
    mkdirSync(root, { recursive: true })
    const temp = join(root, randomUUID() + '.tmp')
    writeFileSync(temp, body, { flag: 'wx', mode: 0o600, flush: true })
    renameSync(temp, path)
  }
  const write = (id: string, record: StoreRecord) => {
    const { snapshot, events: eventsPath, checkpoint: checkpointPath } = paths(id)
    const events = [...record.state.events ?? []].sort((a, b) => a.seq - b.seq)
    const materialized: BayAgentWorkStateV1 = { ...record.state }
    delete materialized.events
    delete materialized.checkpoint
    const relayQueue = (record.relayQueue ?? []).map(relay => ({ ...relay }))
    atomicWrite(snapshot, JSON.stringify({ state: materialized, relayed: [...new Set(record.relayed)], relayQueue }))
    atomicWrite(eventsPath, events.map(event => JSON.stringify(event)).join('\n') + (events.length ? '\n' : ''))
    if (record.state.checkpoint !== undefined) atomicWrite(checkpointPath, JSON.stringify(record.state.checkpoint), 128 * 1024)
  }
  return {
    load: (id: string) => read(id).state,
    save(id: string, state: BayAgentWorkStateV1) { write(id, { ...read(id), state }) },
    relayed: (id: string, assignmentId: string) => read(id).relayed.includes(assignmentId),
    markRelayed(id: string, assignmentId: string) {
      const row = read(id), now = Date.now(), queue = row.relayQueue ?? []
      const existing = queue.find(relay => relay.assignmentId === assignmentId)
      write(id, { ...row, relayed: row.relayed.includes(assignmentId) ? row.relayed : [...row.relayed, assignmentId], relayQueue: existing ? queue.map(relay => {
        if (relay.assignmentId !== assignmentId) return relay
        const { leaseUntil: _leaseUntil, ...withoutLease } = relay
        return { ...withoutLease, status: 'sent', updatedAt: now }
      }) : [...queue, { assignmentId, status: 'sent', attempts: 1, nextAttemptAt: 0, updatedAt: now }] })
    },
    enqueueRelay(id: string, assignmentId: string) {
      const row = read(id), now = Date.now(), queue = row.relayQueue ?? []
      if (row.relayed.includes(assignmentId) || queue.some(relay => relay.assignmentId === assignmentId)) return
      write(id, { ...row, relayQueue: [...queue, { assignmentId, status: 'pending', attempts: 0, nextAttemptAt: now, updatedAt: now }] })
    },
    claimRelay(id: string, assignmentId: string, now = Date.now()) {
      const row = read(id), queue = row.relayQueue ?? [], existing = queue.find(relay => relay.assignmentId === assignmentId)
      if (!existing || existing.status === 'sent' || existing.nextAttemptAt > now || existing.status === 'sending' && (existing.leaseUntil ?? 0) > now) return false
      const leaseUntil = now + 30_000
      write(id, { ...row, relayQueue: queue.map(relay => relay.assignmentId === assignmentId ? { ...relay, status: 'sending', attempts: relay.attempts + 1, leaseUntil, updatedAt: now } : relay) })
      return true
    },
    failRelay(id: string, assignmentId: string, error: string, now = Date.now()) {
      const row = read(id), queue = row.relayQueue ?? [], relay = queue.find(item => item.assignmentId === assignmentId)
      if (!relay || relay.status === 'sent') return
      const delay = Math.min(5 * 60_000, Math.max(1_000, 2 ** Math.min(relay.attempts, 8) * 1_000))
      write(id, { ...row, relayQueue: queue.map(item => {
        if (item.assignmentId !== assignmentId) return item
        const { leaseUntil: _leaseUntil, ...withoutLease } = item
        return { ...withoutLease, status: 'pending', nextAttemptAt: now + delay, lastError: error.slice(0, 1000), updatedAt: now }
      }) })
    },
    relayState(id: string, assignmentId: string) { return read(id).relayQueue?.find(relay => relay.assignmentId === assignmentId) },
  }
}
