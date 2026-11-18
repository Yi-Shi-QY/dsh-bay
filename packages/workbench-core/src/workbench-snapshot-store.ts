import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { WorkbenchSnapshotObject, WorkbenchSnapshotV1 } from './workbench-snapshot.ts'
import { snapshotDigest, validateWorkbenchSnapshot } from './workbench-snapshot.ts'

const digestPattern = /^sha256:[a-f0-9]{64}$/u

async function validateObject(object: WorkbenchSnapshotObject): Promise<void> {
  if (!digestPattern.test(object.digest) || await snapshotDigest(object.content) !== object.digest) throw new Error(`snapshot object digest mismatch: ${object.digest}`)
}

export interface WorkbenchSnapshotStore {
  hasObjects(digests: readonly string[]): Promise<Set<string>>
  putObjects(objects: AsyncIterable<WorkbenchSnapshotObject> | Iterable<WorkbenchSnapshotObject>): Promise<void>
  readObject(digest: string): Promise<Uint8Array | undefined>
  writeSnapshot(snapshot: WorkbenchSnapshotV1): Promise<void>
  readSnapshot(snapshotId: string): Promise<WorkbenchSnapshotV1 | undefined>
}

export class MemoryWorkbenchSnapshotStore implements WorkbenchSnapshotStore {
  private readonly objects = new Map<string, Uint8Array>()
  private readonly snapshots = new Map<string, WorkbenchSnapshotV1>()
  async hasObjects(digests: readonly string[]): Promise<Set<string>> { return new Set(digests.filter(digest => this.objects.has(digest))) }
  async putObjects(objects: AsyncIterable<WorkbenchSnapshotObject> | Iterable<WorkbenchSnapshotObject>): Promise<void> {
    for await (const object of objects) { await validateObject(object); this.objects.set(object.digest, new Uint8Array(object.content)) }
  }
  async readObject(digest: string): Promise<Uint8Array | undefined> { const object = this.objects.get(digest); return object === undefined ? undefined : new Uint8Array(object) }
  async writeSnapshot(snapshot: WorkbenchSnapshotV1): Promise<void> { const valid = await validateWorkbenchSnapshot(snapshot); this.snapshots.set(snapshot.snapshotId, structuredClone(valid)) }
  async readSnapshot(snapshotId: string): Promise<WorkbenchSnapshotV1 | undefined> { const snapshot = this.snapshots.get(snapshotId); return snapshot === undefined ? undefined : structuredClone(snapshot) }
}

export class FileWorkbenchSnapshotStore implements WorkbenchSnapshotStore {
  constructor(readonly root: string) {}
  private objectPath(digest: string): string { return path.join(this.root, 'objects', 'sha256', digest.replace(/^sha256:/u, '')) }
  private manifestPath(snapshotId: string): string { return path.join(this.root, 'snapshots', snapshotId.replace(/[^A-Za-z0-9._-]/gu, '_'), 'manifest.json') }
  async hasObjects(digests: readonly string[]): Promise<Set<string>> {
    const found = new Set<string>()
    for (const digest of digests) { try { await readFile(this.objectPath(digest)); found.add(digest) } catch { /* absent */ } }
    return found
  }
  async putObjects(objects: AsyncIterable<WorkbenchSnapshotObject> | Iterable<WorkbenchSnapshotObject>): Promise<void> {
    for await (const object of objects) {
      await validateObject(object)
      const file = this.objectPath(object.digest)
      await mkdir(path.dirname(file), { recursive: true })
      try { await readFile(file) } catch { await writeFile(file, object.content, { flag: 'wx' }) }
    }
  }
  async readObject(digest: string): Promise<Uint8Array | undefined> { try { return new Uint8Array(await readFile(this.objectPath(digest))) } catch { return undefined } }
  async writeSnapshot(snapshot: WorkbenchSnapshotV1): Promise<void> { const valid = await validateWorkbenchSnapshot(snapshot); const file = this.manifestPath(valid.snapshotId); await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, JSON.stringify(valid) + '\n', { flag: 'wx' }).catch(async error => { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }) }
  async readSnapshot(snapshotId: string): Promise<WorkbenchSnapshotV1 | undefined> { try { return await validateWorkbenchSnapshot(JSON.parse(await readFile(this.manifestPath(snapshotId), 'utf8'))) } catch { return undefined } }
}
