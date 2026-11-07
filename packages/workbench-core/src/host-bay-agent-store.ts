import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { BayAgentWorkStateV1 } from './foundation/workbench-bay-agent-work.ts'

export function baySessionId(key: string): string {
  const hash = createHash('sha256').update('dsh-bay:' + key).digest('hex')
  return [hash.slice(0, 8), hash.slice(8, 12), '5' + hash.slice(13, 16), 'a' + hash.slice(17, 20), hash.slice(20, 32)].join('-')
}

/** One Host owns this journal; rename is the durability boundary before effects. */
export function createBayAgentStore(profile: string) {
  const root = join(profile, '.dsh-workbench', 'bay-agent')
  type Record = { state: BayAgentWorkStateV1; relayed: string[] }
  const read = (id: string): Record => {
    const path = join(root, baySessionId(id) + '.json')
    if (!existsSync(path)) return { state: { version: 1, workItems: [], assignments: [], attention: [] }, relayed: [] }
    if (statSync(path).size > 8 * 1024 * 1024) throw new Error('Bay Agent journal exceeds 8 MiB')
    const row = JSON.parse(readFileSync(path, 'utf8')) as Record
    if (row.state?.version !== 1 || !Array.isArray(row.state.workItems) || !Array.isArray(row.state.assignments) || !Array.isArray(row.state.attention) || !Array.isArray(row.relayed)
      || !row.state.workItems.every(item => item.workbenchId === id && typeof item.workItemId === 'string' && typeof item.objective === 'string' && Array.isArray(item.inputs))
      || !row.state.assignments.every(item => typeof item.assignmentId === 'string' && row.state.workItems.some(work => work.workItemId === item.workItemId))
      || !row.state.attention.every(item => typeof item.attentionId === 'string' && row.state.workItems.some(work => work.workItemId === item.workItemId))) throw new Error('Invalid Bay Agent journal')
    return row
  }
  const write = (id: string, row: Record) => {
    const body = JSON.stringify(row)
    if (Buffer.byteLength(body) > 8 * 1024 * 1024) throw new Error('Bay Agent journal is full')
    mkdirSync(root, { recursive: true })
    const temp = join(root, randomUUID() + '.tmp')
    writeFileSync(temp, body, { flag: 'wx', mode: 0o600, flush: true })
    renameSync(temp, join(root, baySessionId(id) + '.json'))
  }
  return {
    load: (id: string) => read(id).state,
    save(id: string, state: BayAgentWorkStateV1) { write(id, { ...read(id), state }) },
    relayed: (id: string, assignmentId: string) => read(id).relayed.includes(assignmentId),
    markRelayed(id: string, assignmentId: string) { const row = read(id); if (!row.relayed.includes(assignmentId)) write(id, { ...row, relayed: [...row.relayed, assignmentId] }) },
  }
}

