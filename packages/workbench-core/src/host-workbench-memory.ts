import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { atomicJson } from './host-workbench-directory.ts'
import { acquireFileLock } from './host-file-lock.ts'
import type { WorkbenchMemoryEntry, WorkbenchMemoryIndex, WorkbenchMemoryWrite } from './workbench-memory-contract.ts'

const digest = (text: string) => createHash('sha256').update(text).digest('hex')
const validId = (id: string) => /^[A-Za-z0-9][A-Za-z0-9_-]{0,120}$/u.test(id)

/** Immutable revisions are written first; replacing the index is the only commit point. */
export class HostWorkbenchMemory {
  constructor(private readonly rootFor: (workbenchId: string) => string) {}
  private folder(workbenchId: string) { return path.join(this.rootFor(workbenchId), '.bay', 'memory') }
  index(workbenchId: string): WorkbenchMemoryIndex {
    const file = path.join(this.folder(workbenchId), 'index.json')
    if (!existsSync(file)) return { version: 1, revision: 0, entries: {}, requests: {} }
    const index = JSON.parse(readFileSync(file, 'utf8')) as WorkbenchMemoryIndex
    if (index.version !== 1 || !Number.isSafeInteger(index.revision) || !index.entries || !index.requests) throw new Error('不支持的工作台记忆格式。')
    return index
  }
  list(workbenchId: string, query = '', areaId?: string, limit = 100): WorkbenchMemoryEntry[] {
    const needle = query.toLocaleLowerCase()
    return Object.values(this.index(workbenchId).entries).filter(row => !row.removed && (!areaId || !row.areaId || row.areaId === areaId)
      && (!needle || (row.title + '\n' + row.summary).toLocaleLowerCase().includes(needle)))
      .sort((a, b) => b.updatedAt - a.updatedAt).slice(0, Math.min(100, Math.max(1, limit)))
  }
  read(workbenchId: string, id: string, revision?: number): { entry: WorkbenchMemoryEntry; body: string } {
    if (!validId(id)) throw new Error('记忆身份无效。')
    const current = this.index(workbenchId).entries[id], version = revision ?? current?.revision
    if (!current || !Number.isSafeInteger(version) || !version || version < 1 || version > current.revision) throw new Error('记忆版本不存在。')
    const folder = path.join(this.folder(workbenchId), 'entries', id)
    const entry = JSON.parse(readFileSync(path.join(folder, version + '.json'), 'utf8')) as WorkbenchMemoryEntry
    const body = readFileSync(path.join(folder, version + '.md'), 'utf8')
    if (entry.id !== id || entry.revision !== version || entry.sha256 !== digest(body)) throw new Error('记忆正文已被外部修改，请从编辑入口保存新的修订。')
    return { entry, body }
  }
  write(workbenchId: string, input: WorkbenchMemoryWrite, author: WorkbenchMemoryEntry['author']) {
    if (!validId(input.id) || !validId(input.requestId) || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0
      || typeof input.title !== 'string' || !input.title.trim() || input.title.length > 160
      || typeof input.summary !== 'string' || input.summary.length > 1200 || typeof input.body !== 'string' || input.body.length > 100_000
      || !['candidate', 'verified', 'needs-revalidation'].includes(input.verification) || typeof input.environmentDependent !== 'boolean'
      || !input.source || !['user', 'task', 'session', 'file'].includes(input.source.kind)
      || typeof input.source.reference !== 'string' || !input.source.reference.trim() || input.source.reference.length > 2000
      || typeof input.source.description !== 'string' || input.source.description.length > 2000
      || (input.areaId !== undefined && !validId(input.areaId))) throw new Error('记忆内容或来源无效。')
    if (author === 'worker' && input.verification !== 'candidate') throw new Error('Worker 只能提交待核验记忆。')
    const release = acquireFileLock(path.join(this.rootFor(workbenchId), '.bay', 'writer.lock'))
    try {
      const index = this.index(workbenchId), fingerprint = digest(JSON.stringify({ input, author })), prior = index.requests[input.requestId]
      if (prior) {
        if (prior.fingerprint !== fingerprint) throw new Error('重复记忆请求内容不同。')
        return { status: 'committed' as const, ...this.read(workbenchId, prior.id, prior.revision) }
      }
      const before = index.entries[input.id]
      if ((before?.revision ?? 0) !== input.expectedRevision) return { status: 'conflict' as const, actualRevision: before?.revision ?? 0 }
      const entry: WorkbenchMemoryEntry = { id: input.id, revision: (before?.revision ?? 0) + 1, title: input.title.trim(), summary: input.summary,
        ...(input.areaId ? { areaId: input.areaId } : {}), verification: input.verification, environmentDependent: input.environmentDependent,
        source: input.source, updatedAt: Date.now(), author, removed: input.removed === true, sha256: digest(input.body) }
      const folder = path.join(this.folder(workbenchId), 'entries', input.id); mkdirSync(folder, { recursive: true })
      // An orphan revision from a failed commit is safe to overwrite under the writer lock.
      writeFileSync(path.join(folder, entry.revision + '.md'), input.body, { encoding: 'utf8', flush: true })
      atomicJson(path.join(folder, entry.revision + '.json'), entry)
      index.entries[entry.id] = entry; index.revision++
      index.requests[input.requestId] = { fingerprint, id: entry.id, revision: entry.revision }
      atomicJson(path.join(this.folder(workbenchId), 'index.json'), index)
      return { status: 'committed' as const, entry, body: input.body }
    } finally { release() }
  }
  projection(workbenchId: string, areaId?: string, maximumCharacters = 6000): string {
    const result: unknown[] = []; let size = 2
    for (const row of this.list(workbenchId, '', areaId)) {
      const item = { id: row.id, revision: row.revision, title: row.title, summary: row.summary, verification: row.verification, source: row.source }
      const text = JSON.stringify(item)
      if (size + text.length + 1 > maximumCharacters) break
      result.push(item); size += text.length + 1
    }
    return JSON.stringify(result)
  }
  markEnvironmentForRevalidation(workbenchId: string) {
    for (const row of this.list(workbenchId)) if (row.environmentDependent && row.verification !== 'needs-revalidation') {
      const { body } = this.read(workbenchId, row.id)
      this.write(workbenchId, { ...row, body, expectedRevision: row.revision, requestId: 'import-' + row.id + '-' + row.revision, verification: 'needs-revalidation' }, 'bay-agent')
    }
  }
}
