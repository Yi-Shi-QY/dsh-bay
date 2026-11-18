import { canonicalJson, sha256Hex } from './foundation/workbench-sharing.ts'

export const WORKBENCH_SNAPSHOT_FORMAT = 'dshbay-workbench' as const
export const WORKBENCH_SNAPSHOT_SCHEMA_VERSION = 1 as const

export type WorkbenchBundleKind = 'template' | 'complete'
export type WorkbenchSnapshotEntryKind =
  | 'layout'
  | 'project-metadata'
  | 'project-file'
  | 'memory'
  | 'task'
  | 'session-checkpoint'
  | 'attachment'
  | 'extension'
  | 'environment'

export interface WorkbenchSnapshotEntryV1 {
  path: string
  logicalId?: string
  kind: WorkbenchSnapshotEntryKind
  digest: string
  size: number
  chunks?: readonly string[]
  /** A tombstone is retained so an older device cannot resurrect a deletion. */
  deleted?: true
}

export interface WorkbenchSnapshotV1 {
  format: typeof WORKBENCH_SNAPSHOT_FORMAT
  schemaVersion: typeof WORKBENCH_SNAPSHOT_SCHEMA_VERSION
  kind: WorkbenchBundleKind
  workbenchId: string
  snapshotId: string
  parentSnapshotId?: string
  rootDigest: string
  entries: readonly WorkbenchSnapshotEntryV1[]
}

export interface WorkbenchSnapshotObject {
  digest: string
  content: Uint8Array
}

export interface WorkbenchSnapshotInput {
  kind: WorkbenchBundleKind
  workbenchId: string
  parentSnapshotId?: string
  entries: readonly {
    path: string
    logicalId?: string
    kind: WorkbenchSnapshotEntryKind
    content?: Uint8Array
    digest?: string
    size?: number
    chunks?: readonly string[]
    deleted?: boolean
  }[]
}

const forbiddenPathParts = new Set(['.dshbay', '.git'])
const forbiddenName = /(?:^|\/)(?:credentials?|tokens?|cookies?|local|cache|sessions?\/active)(?:\/|$)/iu
const snapshotEntryKinds = new Set<WorkbenchSnapshotEntryKind>([
  'layout', 'project-metadata', 'project-file', 'memory', 'task',
  'session-checkpoint', 'attachment', 'extension', 'environment',
])
const digestPattern = /^sha256:[a-f0-9]{64}$/u
const snapshotIdPattern = digestPattern

function assertLogicalId(value: unknown, path: string): asserts value is string {
  if (value !== undefined && (typeof value !== 'string' || value.length < 1 || value.length > 256 || /[\u0000\r\n]/u.test(value))) {
    throw new Error(`invalid snapshot logicalId: ${path}`)
  }
}

function assertSnapshotId(value: unknown, field: string): asserts value is string | undefined {
  if (value !== undefined && (typeof value !== 'string' || !snapshotIdPattern.test(value))) throw new Error(`invalid snapshot ${field}`)
}

function assertChunks(value: unknown, path: string): asserts value is readonly string[] | undefined {
  if (value === undefined) return
  if (!Array.isArray(value) || value.some(chunk => typeof chunk !== 'string' || !digestPattern.test(chunk))) throw new Error(`invalid snapshot chunks: ${path}`)
}

function assertEntryKind(value: unknown, path: string): asserts value is WorkbenchSnapshotEntryKind {
  if (typeof value !== 'string' || !snapshotEntryKinds.has(value as WorkbenchSnapshotEntryKind)) throw new Error(`invalid snapshot entry kind: ${path}`)
}

export function normalizeSnapshotPath(value: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.includes('\\')) throw new Error(`invalid snapshot path: ${value}`)
  const normalized = value.normalize('NFC').replace(/^\.\//u, '')
  if (normalized.startsWith('/') || /^[A-Za-z]:/u.test(normalized)) throw new Error(`invalid snapshot path: ${value}`)
  const parts = normalized.split('/')
  if (parts.some(part => part.length === 0 || part === '.' || part === '..')) throw new Error(`invalid snapshot path: ${value}`)
  if (parts.some(part => forbiddenPathParts.has(part.toLowerCase()))) throw new Error(`snapshot path is private: ${value}`)
  if (forbiddenName.test(normalized)) throw new Error(`snapshot path is private: ${value}`)
  return parts.join('/')
}

export function snapshotDigest(value: Uint8Array): Promise<string> {
  return sha256Hex(value).then(hex => `sha256:${hex.toLowerCase()}`)
}

function utf8(value: string): Uint8Array { return new TextEncoder().encode(value) }

function snapshotEntryKey(entry: Pick<WorkbenchSnapshotEntryV1, 'path' | 'logicalId'>): string {
  return `${entry.path}\u0000${entry.logicalId ?? ''}`
}

function sortEntries(entries: readonly WorkbenchSnapshotEntryV1[]): WorkbenchSnapshotEntryV1[] {
  return [...entries].sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1
    : (left.logicalId ?? '') < (right.logicalId ?? '') ? -1 : (left.logicalId ?? '') > (right.logicalId ?? '') ? 1 : 0)
}

function rootPayload(input: Pick<WorkbenchSnapshotV1, 'format' | 'schemaVersion' | 'kind' | 'workbenchId' | 'parentSnapshotId' | 'entries'>): Uint8Array {
  return utf8(canonicalJson({ ...input, entries: sortEntries(input.entries) }))
}

export async function createWorkbenchSnapshot(input: WorkbenchSnapshotInput): Promise<{
  snapshot: WorkbenchSnapshotV1
  objects: readonly WorkbenchSnapshotObject[]
}> {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,180}$/u.test(input.workbenchId)) throw new Error('invalid workbench id')
  assertSnapshotId(input.parentSnapshotId, 'parentSnapshotId')
  const objects: WorkbenchSnapshotObject[] = []
  const seen = new Set<string>()
  const entries: WorkbenchSnapshotEntryV1[] = []
  for (const source of input.entries) {
    const path = normalizeSnapshotPath(source.path)
    assertEntryKind(source.kind, path)
    assertLogicalId(source.logicalId, path)
    assertChunks(source.chunks, path)
    const candidate = { ...source, path }
    const key = snapshotEntryKey(candidate)
    if (seen.has(key)) throw new Error(`duplicate snapshot entry: ${path}`)
    seen.add(key)
    if (source.deleted === true) {
      if (source.content !== undefined || source.digest !== undefined || source.size !== undefined) throw new Error(`tombstone cannot contain content: ${path}`)
      entries.push({ path, ...(source.logicalId === undefined ? {} : { logicalId: source.logicalId }), kind: source.kind, digest: 'sha256:' + '0'.repeat(64), size: 0, ...(source.chunks === undefined ? {} : { chunks: [...source.chunks] }), deleted: true })
      continue
    }
    if (source.content === undefined && source.digest === undefined) throw new Error(`snapshot entry has no content: ${path}`)
    const content = source.content === undefined ? undefined : new Uint8Array(source.content)
    const digest = content === undefined ? source.digest! : await snapshotDigest(content)
    if (!digestPattern.test(digest)) throw new Error(`invalid snapshot digest: ${path}`)
    if (source.digest !== undefined && source.digest !== digest) throw new Error(`snapshot digest mismatch: ${path}`)
    const size = source.size ?? content?.byteLength
    if (size === undefined || !Number.isSafeInteger(size) || size < 0) throw new Error(`invalid snapshot size: ${path}`)
    if (content !== undefined) objects.push({ digest, content })
    entries.push({ path, ...(source.logicalId === undefined ? {} : { logicalId: source.logicalId }), kind: source.kind, digest, size, ...(source.chunks === undefined ? {} : { chunks: [...source.chunks] }) })
  }
  const base = { format: WORKBENCH_SNAPSHOT_FORMAT, schemaVersion: WORKBENCH_SNAPSHOT_SCHEMA_VERSION, kind: input.kind, workbenchId: input.workbenchId, ...(input.parentSnapshotId === undefined ? {} : { parentSnapshotId: input.parentSnapshotId }), entries: sortEntries(entries) } as const
  validateWorkbenchSnapshotKind(input.kind, entries)
  const rootDigest = await snapshotDigest(rootPayload(base))
  const snapshotId = await snapshotDigest(utf8(canonicalJson({ ...base, rootDigest })))
  return { snapshot: { ...base, rootDigest, snapshotId }, objects: [...new Map(objects.map(object => [object.digest, object])).values()] }
}

export function validateWorkbenchSnapshotKind(kind: WorkbenchBundleKind, entries: readonly Pick<WorkbenchSnapshotEntryV1, 'kind' | 'path'>[]): void {
  if (kind !== 'template') return
  const forbidden = entries.find(entry => entry.kind === 'project-file' || entry.kind === 'session-checkpoint' || /(?:^|\/)(?:sessions?|conversations?|transcripts?)(?:\/|$)/iu.test(entry.path))
  if (forbidden !== undefined) throw new Error(`template snapshot cannot contain ${forbidden.kind}: ${forbidden.path}`)
}

export async function validateWorkbenchSnapshot(value: unknown): Promise<WorkbenchSnapshotV1> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('snapshot must be an object')
  const candidate = value as Partial<WorkbenchSnapshotV1>
  if (candidate.format !== WORKBENCH_SNAPSHOT_FORMAT || candidate.schemaVersion !== 1) throw new Error('unsupported Workbench snapshot')
  if (candidate.kind !== 'template' && candidate.kind !== 'complete') throw new Error('invalid snapshot kind')
  if (typeof candidate.workbenchId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,180}$/u.test(candidate.workbenchId)
    || typeof candidate.snapshotId !== 'string' || typeof candidate.rootDigest !== 'string' || !Array.isArray(candidate.entries)) throw new Error('invalid snapshot manifest')
  if (!snapshotIdPattern.test(candidate.snapshotId) || !digestPattern.test(candidate.rootDigest)) throw new Error('invalid snapshot digest')
  assertSnapshotId(candidate.parentSnapshotId, 'parentSnapshotId')
  const entries = candidate.entries.map(entry => {
    if (typeof entry !== 'object' || entry === null || typeof entry.path !== 'string' || typeof entry.kind !== 'string' || typeof entry.digest !== 'string' || typeof entry.size !== 'number') throw new Error('invalid snapshot entry')
    const normalized = normalizeSnapshotPath(entry.path)
    assertEntryKind(entry.kind, entry.path)
    assertLogicalId(entry.logicalId, entry.path)
    assertChunks(entry.chunks, entry.path)
    if (normalized !== entry.path || !digestPattern.test(entry.digest) || !Number.isSafeInteger(entry.size) || entry.size < 0) throw new Error(`invalid snapshot entry: ${entry.path}`)
    if (entry.deleted === true && (entry.size !== 0 || entry.digest !== 'sha256:' + '0'.repeat(64))) throw new Error(`invalid tombstone: ${entry.path}`)
    if (entry.deleted === true && Object.prototype.hasOwnProperty.call(entry, 'content')) throw new Error(`invalid tombstone: ${entry.path}`)
    return { path: entry.path, ...(entry.logicalId === undefined ? {} : { logicalId: entry.logicalId }), kind: entry.kind, digest: entry.digest, size: entry.size, ...(entry.chunks === undefined ? {} : { chunks: [...entry.chunks] }), ...(entry.deleted === true ? { deleted: true as const } : {}) }
  })
  const keys = new Set<string>()
  for (const entry of entries) {
    const entryKey = snapshotEntryKey(entry)
    if (keys.has(entryKey)) throw new Error(`duplicate snapshot entry: ${entry.path}`)
    keys.add(entryKey)
  }
  const sorted = sortEntries(entries)
  if (canonicalJson(entries) !== canonicalJson(sorted)) throw new Error('snapshot entries are not sorted')
  const base = { format: candidate.format, schemaVersion: 1, kind: candidate.kind, workbenchId: candidate.workbenchId, ...(candidate.parentSnapshotId === undefined ? {} : { parentSnapshotId: candidate.parentSnapshotId }), entries: sorted } as const
  validateWorkbenchSnapshotKind(candidate.kind, sorted)
  const expectedRoot = await snapshotDigest(rootPayload(base))
  if (candidate.rootDigest !== expectedRoot) throw new Error('snapshot root digest mismatch')
  const expectedId = await snapshotDigest(utf8(canonicalJson({ ...base, rootDigest: expectedRoot })))
  if (candidate.snapshotId !== expectedId) throw new Error('snapshot id mismatch')
  return { ...base, rootDigest: candidate.rootDigest, snapshotId: candidate.snapshotId }
}
