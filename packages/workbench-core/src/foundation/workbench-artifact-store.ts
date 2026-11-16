import { canonicalArtifactBytes, sha256Hex, type WorkbenchPackageFileV1 } from './workbench-sharing.ts'

export interface WorkbenchArtifactRecordV1 {
  digest: string
  portableId: string
  version: string
  /** Immutable Dynamic Package metadata, when this artifact is dynamic. */
  name?: string
  purpose?: string
  clientEntry?: string
  hostEntry?: string
  editorIds: readonly string[]
  sourcePolicy: 'source-included' | 'binary-only' | 'remote'
  permissions: readonly string[]
  size: number
  license?: string
}

export interface WorkbenchArtifactBundleV1 {
  record: WorkbenchArtifactRecordV1
  files: readonly WorkbenchPackageFileV1[]
}

export interface WorkbenchArtifactStoreV1 {
  /** Optional restore barrier for durable implementations. */
  ready?(): Promise<void>
  stage(bundle: WorkbenchArtifactBundleV1): Promise<void>
  commit(digest: string): Promise<void>
  get(digest: string): WorkbenchArtifactBundleV1 | undefined
  /** Enumerate committed bundles for creator re-export and diagnostics. */
  list?(): readonly WorkbenchArtifactBundleV1[]
  /** Enumerate transaction-owned staged bundles for restart resume. */
  listStaged?(): readonly WorkbenchArtifactBundleV1[]
  retain(digest: string, reference: string): boolean
  release(digest: string, reference: string): boolean
  /**
   * Remove unreferenced staged artifacts. When a digest list is supplied,
   * only those import-owned digests are considered; this keeps a failed
   * transaction from deleting unrelated artifacts already in the store.
   */
  cleanup(digests?: readonly string[]): readonly string[]
}

/**
 * Minimal synchronous persistence surface used by the durable browser/Host
 * adapter below.  It intentionally mirrors the Web Storage contract instead
 * of importing `Storage`, so a Manager bridge can provide the same seam
 * without pretending to be a browser.
 */
export interface WorkbenchArtifactStorageV1 {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

/** Keep artifact staging bounded even when it is fed outside the ZIP decoder. */
export const DEFAULT_WORKBENCH_ARTIFACT_LIMITS_V1 = {
  maxFiles: 128,
  maxFileBytes: 16 * 1024 * 1024,
  maxTotalBytes: 64 * 1024 * 1024,
} as const

function safeArtifactPath(path: string): boolean {
  if (path.trim() === '' || path.startsWith('/') || path.startsWith('\\') || /^[A-Za-z]:/u.test(path)) return false
  if (path.includes('\\')) return false
  return path.split('/').every(part => part !== '' && part !== '.' && part !== '..')
}

function cloneBundle(bundle: WorkbenchArtifactBundleV1): WorkbenchArtifactBundleV1 {
  return { record: structuredClone(bundle.record), files: bundle.files.map(file => ({ path: file.path, content: new Uint8Array(file.content) })) }
}

function artifactKey(digest: string): string { return digest.toUpperCase() }

function legacyArtifactBytes(files: readonly WorkbenchPackageFileV1[]): Uint8Array {
  const ordered = [...files].sort((left, right) => left.path.localeCompare(right.path, 'en'))
  const total = ordered.reduce((sum, file) => sum + file.content.byteLength, 0)
  const result = new Uint8Array(total)
  let offset = 0
  for (const file of ordered) {
    result.set(file.content, offset)
    offset += file.content.byteLength
  }
  return result
}

/** In-memory content-addressed store used by the browser adapter and tests. */
export class MemoryWorkbenchArtifactStore implements WorkbenchArtifactStoreV1 {
  private readonly committed = new Map<string, WorkbenchArtifactBundleV1>()
  private readonly staged = new Map<string, WorkbenchArtifactBundleV1>()
  private readonly references = new Map<string, Set<string>>()

  async stage(bundle: WorkbenchArtifactBundleV1): Promise<void> {
    if (bundle.files.length === 0 || bundle.files.length > DEFAULT_WORKBENCH_ARTIFACT_LIMITS_V1.maxFiles) {
      throw new Error(`artifact file count exceeds limit: ${bundle.record.digest}`)
    }
    const seen = new Set<string>()
    const folded = new Set<string>()
    for (const file of bundle.files) {
      if (!safeArtifactPath(file.path)) throw new Error(`artifact path is unsafe: ${file.path}`)
      if (file.content.byteLength > DEFAULT_WORKBENCH_ARTIFACT_LIMITS_V1.maxFileBytes) {
        throw new Error(`artifact file exceeds size limit: ${file.path}`)
      }
      if (seen.has(file.path)) throw new Error(`duplicate artifact path: ${file.path}`)
      const normalized = file.path.toLocaleLowerCase('en-US')
      if (folded.has(normalized)) throw new Error(`case-colliding artifact path: ${file.path}`)
      seen.add(file.path)
      folded.add(normalized)
    }
    const totalBytes = bundle.files.reduce((total, file) => total + file.content.byteLength, 0)
    if (totalBytes > DEFAULT_WORKBENCH_ARTIFACT_LIMITS_V1.maxTotalBytes) {
      throw new Error(`artifact exceeds total size limit: ${bundle.record.digest}`)
    }
    const framedDigest = await sha256Hex(canonicalArtifactBytes(bundle.files))
    // Accept artifacts produced before framed digesting was introduced. New
    // creator-produced artifacts use the framed digest; this compatibility
    // branch keeps existing static DSH module artifacts importable while they
    // are gradually rebuilt.
    const legacyDigest = await sha256Hex(legacyArtifactBytes(bundle.files))
    const declaredDigest = artifactKey(bundle.record.digest)
    if (framedDigest !== declaredDigest && legacyDigest !== declaredDigest) throw new Error(`artifact digest mismatch: ${bundle.record.digest}`)
    const digest = declaredDigest
    if (bundle.record.size !== totalBytes) throw new Error(`artifact size mismatch: ${bundle.record.digest}`)
    if (this.committed.has(digest)) return
    this.staged.set(digest, cloneBundle({ ...bundle, record: { ...bundle.record, digest } }))
  }

  async commit(digest: string): Promise<void> {
    const key = artifactKey(digest)
    const bundle = this.staged.get(key)
    if (bundle === undefined && !this.committed.has(key)) throw new Error(`artifact is not staged: ${digest}`)
    if (bundle !== undefined) {
      this.committed.set(key, bundle)
      this.staged.delete(key)
    }
  }

  get(digest: string): WorkbenchArtifactBundleV1 | undefined {
    const bundle = this.committed.get(artifactKey(digest))
    return bundle === undefined ? undefined : cloneBundle(bundle)
  }

  list(): readonly WorkbenchArtifactBundleV1[] {
    return [...this.committed.values()].map(cloneBundle)
  }

  listStaged(): readonly WorkbenchArtifactBundleV1[] {
    return [...this.staged.values()].map(cloneBundle)
  }

  retain(digest: string, reference: string): boolean {
    const key = artifactKey(digest)
    if (!this.committed.has(key)) return false
    const refs = this.references.get(key) ?? new Set<string>()
    refs.add(reference)
    this.references.set(key, refs)
    return true
  }

  release(digest: string, reference: string): boolean {
    const key = artifactKey(digest)
    const refs = this.references.get(key)
    if (refs === undefined) return false
    refs.delete(reference)
    if (refs.size === 0) this.references.delete(key)
    return true
  }

  cleanup(digests?: readonly string[]): readonly string[] {
    const removed: string[] = []
    const candidates = digests === undefined
      ? [...new Set([...this.staged.keys(), ...this.committed.keys()])]
      : [...new Set(digests.map(artifactKey))]
    for (const digest of candidates) {
      if (this.staged.delete(digest)) removed.push(digest)
      if (this.committed.has(digest) && !this.references.has(digest)) {
        this.committed.delete(digest)
        removed.push(digest)
      }
    }
    return removed.sort()
  }
}

interface PersistedArtifactBundleV1 {
  record: WorkbenchArtifactRecordV1
  files: readonly { path: string; content: readonly number[] }[]
}

interface PersistedArtifactStoreV1 {
  schemaVersion: 1
  committed: readonly PersistedArtifactBundleV1[]
  staged: readonly PersistedArtifactBundleV1[]
  references: Readonly<Record<string, readonly string[]>>
}

const PERSISTED_ARTIFACT_STORE_SCHEMA_V1 = 1
const DEFAULT_ARTIFACT_STORAGE_KEY = 'dsh.workbench.artifacts.v1'
const MAX_PERSISTED_ARTIFACT_ROWS = 256
const MAX_PERSISTED_REFERENCE_ROWS = 4096

function persistedBundleOf(bundle: WorkbenchArtifactBundleV1): PersistedArtifactBundleV1 {
  return {
    record: structuredClone(bundle.record),
    files: bundle.files.map(file => ({ path: file.path, content: [...file.content] })),
  }
}

function bundleOfPersisted(value: unknown): WorkbenchArtifactBundleV1 | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const row = value as Record<string, unknown>
  if (typeof row.record !== 'object' || row.record === null || Array.isArray(row.record)
    || !Array.isArray(row.files)) return undefined
  const record = row.record as Record<string, unknown>
  if (typeof record.digest !== 'string' || !/^[a-f0-9]{64}$/iu.test(record.digest)
    || typeof record.portableId !== 'string' || record.portableId.trim() === ''
    || typeof record.version !== 'string' || record.version.trim() === ''
    || (record.clientEntry !== undefined && typeof record.clientEntry !== 'string')
    || (record.hostEntry !== undefined && typeof record.hostEntry !== 'string')
    || !Array.isArray(record.editorIds) || !record.editorIds.every(item => typeof item === 'string' && item.trim() !== '')
    || (record.sourcePolicy !== 'source-included' && record.sourcePolicy !== 'binary-only' && record.sourcePolicy !== 'remote')
    || !Array.isArray(record.permissions) || !record.permissions.every(item => typeof item === 'string' && item.trim() !== '')
    || !Number.isSafeInteger(record.size) || Number(record.size) < 0
    || (record.name !== undefined && (typeof record.name !== 'string' || record.name.trim() === '' || record.name.length > 256))
    || (record.purpose !== undefined && (typeof record.purpose !== 'string' || record.purpose.trim() === '' || record.purpose.length > 2048))
    || (record.license !== undefined && typeof record.license !== 'string')) return undefined
  const files: WorkbenchPackageFileV1[] = []
  const seen = new Set<string>()
  for (const file of row.files) {
    if (typeof file !== 'object' || file === null || Array.isArray(file)) return undefined
    const item = file as Record<string, unknown>
    if (typeof item.path !== 'string' || !Array.isArray(item.content)
      || !item.content.every(byte => Number.isInteger(byte) && Number(byte) >= 0 && Number(byte) <= 255)) return undefined
    if (seen.has(item.path)) return undefined
    seen.add(item.path)
    files.push({ path: item.path, content: new Uint8Array(item.content as number[]) })
  }
  return {
    record: {
      digest: record.digest,
      portableId: record.portableId,
      version: record.version,
      ...(record.name === undefined ? {} : { name: record.name }),
      ...(record.purpose === undefined ? {} : { purpose: record.purpose }),
      ...(record.clientEntry === undefined ? {} : { clientEntry: record.clientEntry }),
      ...(record.hostEntry === undefined ? {} : { hostEntry: record.hostEntry }),
      editorIds: [...record.editorIds as string[]],
      sourcePolicy: record.sourcePolicy,
      permissions: [...record.permissions as string[]],
      size: Number(record.size),
      ...(record.license === undefined ? {} : { license: record.license }),
    },
    files,
  }
}

/**
 * Durable content-addressed store for a Host/Manager-provided key/value
 * backend.  Restoration is asynchronous because every persisted bundle is
 * re-hashed by the same `MemoryWorkbenchArtifactStore` validation path before
 * it becomes visible.  Corrupt rows are ignored and never executed.
 */
export class LocalStorageWorkbenchArtifactStore implements WorkbenchArtifactStoreV1 {
  private readonly memory = new MemoryWorkbenchArtifactStore()
  private readonly references = new Map<string, Set<string>>()
  private readonly storage: WorkbenchArtifactStorageV1
  private readonly key: string
  private readonly restorePromise: Promise<void>

  constructor(
    namespace = DEFAULT_ARTIFACT_STORAGE_KEY,
    storage?: WorkbenchArtifactStorageV1,
  ) {
    let fallback: WorkbenchArtifactStorageV1 | undefined
    try { fallback = globalThis.localStorage } catch { fallback = undefined }
    if (storage === undefined && fallback === undefined) {
      throw new Error('Workbench durable Artifact Store requires an explicit storage backend outside a browser')
    }
    this.storage = storage ?? fallback!
    this.key = namespace.trim() === '' ? DEFAULT_ARTIFACT_STORAGE_KEY : namespace
    this.restorePromise = this.restore()
  }

  /** Await before a Runtime uses `get`/`list` immediately after construction. */
  async ready(): Promise<void> { await this.restorePromise }

  private async restore(): Promise<void> {
    let parsed: unknown
    try {
      const raw = this.storage.getItem(this.key)
      if (raw === null) return
      parsed = JSON.parse(raw) as unknown
    } catch {
      this.storage.removeItem(this.key)
      return
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return
    const row = parsed as Record<string, unknown>
    if (row.schemaVersion !== PERSISTED_ARTIFACT_STORE_SCHEMA_V1
      || !Array.isArray(row.committed) || !Array.isArray(row.staged)
      || typeof row.references !== 'object' || row.references === null || Array.isArray(row.references)
      || row.committed.length > MAX_PERSISTED_ARTIFACT_ROWS || row.staged.length > MAX_PERSISTED_ARTIFACT_ROWS
      || Object.keys(row.references).length > MAX_PERSISTED_REFERENCE_ROWS) return
    for (const [kind, values] of [['committed', row.committed], ['staged', row.staged] as const]) {
      for (const candidate of values) {
        const bundle = bundleOfPersisted(candidate)
        if (bundle === undefined) continue
        try {
          await this.memory.stage(bundle)
          if (kind === 'committed') await this.memory.commit(bundle.record.digest)
        } catch {
          // A changed hashing rule or a tampered row must not block the rest
          // of the store from recovering.
        }
      }
    }
    const persistedReferences = row.references as Record<string, unknown>
    let referenceRows = 0
    for (const [digest, rawReferences] of Object.entries(persistedReferences)) {
      if (!/^[a-f0-9]{64}$/iu.test(digest) || !Array.isArray(rawReferences)) continue
      const references = rawReferences.filter(reference => typeof reference === 'string' && reference.trim() !== '' && reference.length <= 256)
      if (references.length === 0 || referenceRows + references.length > MAX_PERSISTED_REFERENCE_ROWS) continue
      for (const reference of references) {
        if (this.memory.retain(digest, reference)) {
          const set = this.references.get(artifactKey(digest)) ?? new Set<string>()
          set.add(reference)
          this.references.set(artifactKey(digest), set)
          referenceRows += 1
        }
      }
    }
  }

  private persist(): void {
    const committed = this.memory.list?.() ?? []
    const staged = this.memory.listStaged?.() ?? []
    const snapshot: PersistedArtifactStoreV1 = {
      schemaVersion: PERSISTED_ARTIFACT_STORE_SCHEMA_V1,
      committed: committed.slice(0, MAX_PERSISTED_ARTIFACT_ROWS).map(persistedBundleOf),
      staged: staged.slice(0, MAX_PERSISTED_ARTIFACT_ROWS).map(persistedBundleOf),
      references: Object.fromEntries([...this.references.entries()].map(([digest, values]) => [digest, [...values].sort()])),
    }
    try {
      this.storage.setItem(this.key, JSON.stringify(snapshot))
    } catch (error) {
      throw new Error(`Workbench Artifact Store 持久化失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  async stage(bundle: WorkbenchArtifactBundleV1): Promise<void> {
    await this.restorePromise
    await this.memory.stage(bundle)
    // Staging is transaction-owned, but still persisted so a restart can
    // resume without re-downloading an already verified artifact.
    this.persist()
  }

  async commit(digest: string): Promise<void> {
    await this.restorePromise
    await this.memory.commit(digest)
    this.persist()
  }

  get(digest: string): WorkbenchArtifactBundleV1 | undefined { return this.memory.get(digest) }

  list(): readonly WorkbenchArtifactBundleV1[] { return this.memory.list?.() ?? [] }

  listStaged(): readonly WorkbenchArtifactBundleV1[] { return this.memory.listStaged?.() ?? [] }

  retain(digest: string, reference: string): boolean {
    if (!this.memory.retain(digest, reference)) return false
    const key = artifactKey(digest)
    const values = this.references.get(key) ?? new Set<string>()
    values.add(reference)
    this.references.set(key, values)
    this.persist()
    return true
  }

  release(digest: string, reference: string): boolean {
    const released = this.memory.release(digest, reference)
    if (!released) return false
    const values = this.references.get(artifactKey(digest))
    values?.delete(reference)
    if (values !== undefined && values.size === 0) this.references.delete(artifactKey(digest))
    this.persist()
    return true
  }

  cleanup(digests?: readonly string[]): readonly string[] {
    const removed = this.memory.cleanup(digests)
    for (const digest of removed) this.references.delete(artifactKey(digest))
    this.persist()
    return removed
  }
}
