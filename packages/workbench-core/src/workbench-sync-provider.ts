import { mkdir, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { snapshotDigest } from './workbench-snapshot.ts'
import type { WorkbenchSnapshotObject } from './workbench-snapshot.ts'

export interface RemoteHead {
  workbenchId?: string
  snapshotId?: string
  manifestDigest?: string
}

export interface SyncObject extends WorkbenchSnapshotObject {}

export interface CommitResult {
  status: 'committed' | 'conflict'
  snapshotId?: string
  currentHead?: string
}

export interface WorkbenchSyncProvider {
  inspectHead(remote: string): Promise<RemoteHead>
  readManifest(snapshotId: string): Promise<Uint8Array>
  hasObjects(digests: readonly string[]): Promise<Set<string>>
  putObjects(objects: AsyncIterable<SyncObject>): Promise<void>
  commitHead(input: { expectedParent?: string; manifest: Uint8Array }): Promise<CommitResult>
}

function snapshotIdFromManifest(bytes: Uint8Array): string {
  const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as { snapshotId?: unknown }
  if (typeof value.snapshotId !== 'string' || !value.snapshotId) throw new Error('manifest has no snapshotId')
  return value.snapshotId
}

async function atomicWrite(file: string, content: Uint8Array | string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true })
  const temporary = file + '.tmp-' + crypto.randomUUID()
  await writeFile(temporary, content, { flag: 'wx' })
  await rename(temporary, file)
}

async function acquireFileLock(file: string, timeoutMs = 30_000): Promise<() => Promise<void>> {
  const started = Date.now()
  await mkdir(path.dirname(file), { recursive: true })
  for (;;) {
    try {
      const handle = await open(file, 'wx')
      await handle.writeFile(JSON.stringify({ pid: process.pid, createdAt: Date.now() }) + '\n')
      await handle.close()
      return async () => { await rm(file, { force: true }) }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      try {
        const info = await stat(file)
        if (Date.now() - info.mtimeMs > timeoutMs) await rm(file, { force: true })
      } catch (statError) {
        if ((statError as NodeJS.ErrnoException).code !== 'ENOENT') throw statError
      }
      if (Date.now() - started >= timeoutMs) throw new Error('同步远端提交锁等待超时')
      await new Promise(resolve => setTimeout(resolve, 25))
    }
  }
}

export class FolderWorkbenchSyncProvider implements WorkbenchSyncProvider {
  private commitTail: Promise<unknown> = Promise.resolve()
  constructor(readonly root: string, readonly workbenchId = 'default') {}
  private objectPath(digest: string): string { return path.join(this.root, 'objects', 'sha256', digest.replace(/^sha256:/u, '')) }
  private manifestPath(snapshotId: string): string { return path.join(this.root, 'snapshots', snapshotId.replace(/[^A-Za-z0-9._-]/gu, '_'), 'manifest.json') }
  private headPath(remote = this.workbenchId): string { return path.join(this.root, 'refs', remote.replace(/[^A-Za-z0-9._-]/gu, '_'), 'head') }
  private lockPath(remote = this.workbenchId): string { return path.join(this.root, 'leases', remote.replace(/[^A-Za-z0-9._-]/gu, '_') + '.lock') }
  async inspectHead(remote = this.workbenchId): Promise<RemoteHead> {
    try { const snapshotId = (await readFile(this.headPath(remote), 'utf8')).trim(); return snapshotId ? { workbenchId: remote, snapshotId } : { workbenchId: remote } } catch { return { workbenchId: remote } }
  }
  async readManifest(snapshotId: string): Promise<Uint8Array> { return new Uint8Array(await readFile(this.manifestPath(snapshotId))) }
  async hasObjects(digests: readonly string[]): Promise<Set<string>> {
    const result = new Set<string>()
    for (const digest of digests) { try { await readFile(this.objectPath(digest)); result.add(digest) } catch { /* missing */ } }
    return result
  }
  async putObjects(objects: AsyncIterable<SyncObject>): Promise<void> {
    for await (const object of objects) {
      if (!/^sha256:[a-f0-9]{64}$/u.test(object.digest) || await snapshotDigest(object.content) !== object.digest) throw new Error(`sync object digest mismatch: ${object.digest}`)
      const file = this.objectPath(object.digest)
      try { await readFile(file) } catch { await atomicWrite(file, object.content) }
    }
  }
  async commitHead(input: { expectedParent?: string; manifest: Uint8Array }): Promise<CommitResult> {
    const operation = this.commitTail.then(async () => {
      const release = await acquireFileLock(this.lockPath())
      try {
        // The lock is shared by provider instances and processes. Re-read the
        // head after acquiring it so expectedParent is a real compare-and-swap.
        const current = await this.inspectHead()
        if (current.snapshotId !== input.expectedParent) return { status: 'conflict' as const, ...(current.snapshotId === undefined ? {} : { currentHead: current.snapshotId }) }
        const snapshotId = snapshotIdFromManifest(input.manifest)
        const manifest = this.manifestPath(snapshotId)
        try { await readFile(manifest) } catch { await atomicWrite(manifest, input.manifest) }
        await atomicWrite(this.headPath(), snapshotId + '\n')
        return { status: 'committed' as const, snapshotId }
      } finally { await release() }
    })
    this.commitTail = operation.catch(() => undefined)
    return operation
  }
}

export interface WebDavResponseLike {
  ok: boolean
  status: number
  arrayBuffer(): Promise<ArrayBuffer>
  text(): Promise<string>
  headers?: { get(name: string): string | null }
}

export interface WebDavFetchLike {
  (input: string, init?: { method?: string; headers?: Record<string, string>; body?: Uint8Array | string }): Promise<WebDavResponseLike>
}

const transientWebDavStatuses = new Set([408, 425, 429, 500, 502, 503, 504])

function responseHeader(response: WebDavResponseLike, name: string): string | undefined {
  const value = response.headers?.get(name)
  return value === null || value === undefined || value.length === 0 ? undefined : value
}

function responseLength(response: WebDavResponseLike): number | undefined {
  const value = responseHeader(response, 'content-length')
  if (value === undefined || !/^\d+$/u.test(value)) return undefined
  const length = Number(value)
  return Number.isSafeInteger(length) ? length : undefined
}

async function retryDelay(attempt: number): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 25 * 2 ** attempt))
}

export class WebDavWorkbenchSyncProvider implements WorkbenchSyncProvider {
  private readonly headEtags = new Map<string, string>()
  constructor(readonly baseUrl: string, readonly workbenchId: string, readonly fetcher: WebDavFetchLike = globalThis.fetch as unknown as WebDavFetchLike) {}
  private url(relative: string): string { return this.baseUrl.replace(/\/+$/u, '') + '/' + relative.split('/').map(encodeURIComponent).join('/') }
  private async request(input: string, init?: { method?: string; headers?: Record<string, string>; body?: Uint8Array | string }): Promise<WebDavResponseLike> {
    let lastError: unknown
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const response = await this.fetcher(input, init)
        if (!transientWebDavStatuses.has(response.status) || attempt === 2) return response
      } catch (error) {
        lastError = error
        if (attempt === 2) throw error
      }
      await retryDelay(attempt)
    }
    throw lastError instanceof Error ? lastError : new Error('WebDAV request failed')
  }
  private stagingPath(kind: 'objects' | 'manifests', digest: string): string {
    return `staging/${kind}/${digest.replace(/^sha256:/u, '')}`
  }
  private async putTemporary(relative: string, content: Uint8Array): Promise<void> {
    const initial = await this.request(this.url(relative), {
      method: 'PUT',
      headers: { 'content-type': 'application/octet-stream', 'if-none-match': '*' },
      body: content,
    })
    if (initial.ok) return
    if (initial.status !== 412 && initial.status !== 409) throw new Error(`WebDAV temporary upload failed: ${initial.status}`)
    // A deterministic staging path lets a retry continue an interrupted upload.
    // Servers that do not implement Content-Range are handled by a clean retry.
    const existing = await this.request(this.url(relative), { method: 'HEAD' })
    const offset = existing.ok ? responseLength(existing) : undefined
    if (offset === content.byteLength) return
    if (offset !== undefined && offset > 0 && offset < content.byteLength) {
      const resumed = await this.request(this.url(relative), {
        method: 'PUT',
        headers: { 'content-type': 'application/octet-stream', 'content-range': `bytes ${offset}-${content.byteLength - 1}/${content.byteLength}` },
        body: content.slice(offset),
      })
      if (resumed.ok) {
        const completed = await this.request(this.url(relative), { method: 'HEAD' })
        if (completed.ok && responseLength(completed) === content.byteLength) return
      }
    }
    await this.request(this.url(relative), { method: 'DELETE' })
    const retry = await this.request(this.url(relative), { method: 'PUT', headers: { 'content-type': 'application/octet-stream', 'if-none-match': '*' }, body: content })
    if (!retry.ok && retry.status !== 412 && retry.status !== 409) throw new Error(`WebDAV temporary upload failed: ${retry.status}`)
  }
  private async moveTemporary(source: string, target: string, content: Uint8Array): Promise<void> {
    const response = await this.request(this.url(source), {
      method: 'MOVE',
      headers: { Destination: this.url(target), Overwrite: 'F' },
    })
    if (response.ok || response.status === 201 || response.status === 204 || response.status === 412 || response.status === 409) return
    if (response.status !== 405 && response.status !== 501) throw new Error(`WebDAV temporary commit failed: ${response.status}`)
    // Some WebDAV-compatible storage only implements PUT. Preserve the same
    // no-overwrite behavior there and let an existing object win the race.
    const fallback = await this.request(this.url(target), { method: 'PUT', headers: { 'content-type': 'application/octet-stream', 'if-none-match': '*' }, body: content })
    if (!fallback.ok && fallback.status !== 412 && fallback.status !== 409) throw new Error(`WebDAV object upload failed: ${fallback.status}`)
  }
  private async removeTemporary(relative: string): Promise<void> {
    try { await this.request(this.url(relative), { method: 'DELETE' }) } catch { /* best effort cleanup */ }
  }
  async inspectHead(remote = this.workbenchId): Promise<RemoteHead> {
    const response = await this.request(this.url(`refs/${remote}/head`))
    if (response.status === 404) { this.headEtags.delete(remote); return { workbenchId: remote } }
    if (!response.ok) throw new Error(`WebDAV head read failed: ${response.status}`)
    const etag = responseHeader(response, 'etag')
    if (etag) this.headEtags.set(remote, etag)
    else this.headEtags.delete(remote)
    return { workbenchId: remote, snapshotId: (await response.text()).trim(), ...(etag === undefined ? {} : { manifestDigest: etag }) }
  }
  async readManifest(snapshotId: string): Promise<Uint8Array> {
    const response = await this.request(this.url(`snapshots/${snapshotId}/manifest.json`))
    if (!response.ok) throw new Error(`WebDAV manifest read failed: ${response.status}`)
    return new Uint8Array(await response.arrayBuffer())
  }
  async hasObjects(digests: readonly string[]): Promise<Set<string>> {
    const found = new Set<string>()
    for (const digest of digests) {
      const response = await this.request(this.url(`objects/sha256/${digest.replace(/^sha256:/u, '')}`), { method: 'HEAD' })
      if (response.ok) found.add(digest)
      else if (response.status !== 404) throw new Error(`WebDAV object check failed: ${response.status}`)
    }
    return found
  }
  async putObjects(objects: AsyncIterable<SyncObject>): Promise<void> {
    for await (const object of objects) {
      if (!/^sha256:[a-f0-9]{64}$/u.test(object.digest) || await snapshotDigest(object.content) !== object.digest) throw new Error(`sync object digest mismatch: ${object.digest}`)
      const target = `objects/sha256/${object.digest.replace(/^sha256:/u, '')}`
      const temporary = this.stagingPath('objects', object.digest)
      await this.putTemporary(temporary, object.content)
      try { await this.moveTemporary(temporary, target, object.content) } finally { await this.removeTemporary(temporary) }
    }
  }
  async commitHead(input: { expectedParent?: string; manifest: Uint8Array }): Promise<CommitResult> {
    const current = await this.inspectHead()
    if (current.snapshotId !== input.expectedParent) return { status: 'conflict', ...(current.snapshotId === undefined ? {} : { currentHead: current.snapshotId }) }
    const snapshotId = snapshotIdFromManifest(input.manifest)
    const temporary = this.stagingPath('manifests', snapshotId)
    await this.putTemporary(temporary, input.manifest)
    try { await this.moveTemporary(temporary, `snapshots/${snapshotId}/manifest.json`, input.manifest) } finally { await this.removeTemporary(temporary) }
    const etag = this.headEtags.get(this.workbenchId)
    const headers = input.expectedParent === undefined
      ? { 'content-type': 'text/plain; charset=utf-8', 'if-none-match': '*' }
      : { 'content-type': 'text/plain; charset=utf-8', 'if-match': etag ?? '*' }
    const headResponse = await this.request(this.url(`refs/${this.workbenchId}/head`), { method: 'PUT', headers, body: snapshotId + '\n' })
    if (headResponse.status === 409 || headResponse.status === 412) {
      const latest = await this.inspectHead()
      if (latest.snapshotId === snapshotId) return { status: 'committed', snapshotId }
      return { status: 'conflict', ...(latest.snapshotId === undefined ? {} : { currentHead: latest.snapshotId }) }
    }
    if (!headResponse.ok) throw new Error(`WebDAV head commit failed: ${headResponse.status}`)
    const nextEtag = responseHeader(headResponse, 'etag')
    if (nextEtag) this.headEtags.set(this.workbenchId, nextEtag)
    return { status: 'committed', snapshotId }
  }
}

export const createFolderWorkbenchSyncProvider = (root: string, workbenchId?: string) => new FolderWorkbenchSyncProvider(root, workbenchId)
export const createWebDavWorkbenchSyncProvider = (baseUrl: string, workbenchId: string, fetcher?: WebDavFetchLike) => new WebDavWorkbenchSyncProvider(baseUrl, workbenchId, fetcher)
