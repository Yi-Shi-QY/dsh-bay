import { canonicalJson } from './foundation/workbench-sharing.ts'
import type { WorkbenchSnapshotV1, WorkbenchSnapshotObject } from './workbench-snapshot.ts'
import { snapshotDigest, validateWorkbenchSnapshot } from './workbench-snapshot.ts'
import type { CommitResult, RemoteHead, WorkbenchSyncProvider } from './workbench-sync-provider.ts'

export type WorkbenchSyncStatus = 'synced' | 'offline' | 'conflict' | 'pending'

export interface WorkbenchSyncResult {
  status: WorkbenchSyncStatus
  localSnapshotId: string
  remoteHead?: RemoteHead
  commit?: CommitResult
  uploadedDigests: readonly string[]
  error?: string
}

export interface WorkbenchSyncInput {
  snapshot: WorkbenchSnapshotV1
  objects: readonly WorkbenchSnapshotObject[]
  provider: WorkbenchSyncProvider
  remote?: string
}

export async function syncWorkbenchSnapshot(input: WorkbenchSyncInput): Promise<WorkbenchSyncResult> {
  await validateWorkbenchSnapshot(input.snapshot)
  const remote = input.remote ?? input.snapshot.workbenchId
  let head: RemoteHead
  try { head = await input.provider.inspectHead(remote) } catch (error) { return { status: 'offline', localSnapshotId: input.snapshot.snapshotId, uploadedDigests: [], error: String(error) } }
  // A snapshot without a parent is only valid for an empty remote. Treat a
  // remote head as a conflict instead of allowing a fresh device to replace it.
  if (input.snapshot.parentSnapshotId !== head.snapshotId) return { status: 'conflict', localSnapshotId: input.snapshot.snapshotId, remoteHead: head, uploadedDigests: [], error: '远端工作台版本已变化或缺失，无法安全提交' }
  const uniqueObjects = new Map<string, WorkbenchSnapshotObject>()
  for (const object of input.objects) {
    if (!/^sha256:[a-f0-9]{64}$/u.test(object.digest) || await snapshotDigest(object.content) !== object.digest) throw new Error(`snapshot object digest mismatch: ${object.digest}`)
    uniqueObjects.set(object.digest, object)
  }
  const digests = [...uniqueObjects.keys()]
  let existing: Set<string>
  try { existing = await input.provider.hasObjects(digests) } catch (error) { return { status: 'offline', localSnapshotId: input.snapshot.snapshotId, remoteHead: head, uploadedDigests: [], error: String(error) } }
  const missing = [...uniqueObjects.values()].filter(object => !existing.has(object.digest))
  try { await input.provider.putObjects((async function* () { for (const object of missing) yield object })()) } catch (error) { return { status: 'offline', localSnapshotId: input.snapshot.snapshotId, remoteHead: head, uploadedDigests: [], error: String(error) } }
  const manifest = new TextEncoder().encode(canonicalJson(input.snapshot))
  let commit: CommitResult
  try { commit = await input.provider.commitHead({ ...(head.snapshotId === undefined ? {} : { expectedParent: head.snapshotId }), manifest }) } catch (error) { return { status: 'offline', localSnapshotId: input.snapshot.snapshotId, remoteHead: head, uploadedDigests: missing.map(object => object.digest), error: String(error) } }
  if (commit.status === 'conflict') return { status: 'conflict', localSnapshotId: input.snapshot.snapshotId, remoteHead: head, commit, uploadedDigests: missing.map(object => object.digest), error: '远端工作台已在其他设备发生变化' }
  return { status: 'synced', localSnapshotId: input.snapshot.snapshotId, remoteHead: head, commit, uploadedDigests: missing.map(object => object.digest) }
}
