import { mergeWorkbenchSnapshotEntries } from './workbench-snapshot-diff.ts'
import { createWorkbenchSnapshot, type WorkbenchSnapshotV1 } from './workbench-snapshot.ts'

export interface WorkbenchMergeResult {
  snapshot: WorkbenchSnapshotV1
  conflicts: readonly ReturnType<typeof mergeWorkbenchSnapshotEntries>['conflicts'][number][]
}

export async function mergeWorkbenchSnapshots(base: WorkbenchSnapshotV1, left: WorkbenchSnapshotV1, right: WorkbenchSnapshotV1): Promise<WorkbenchMergeResult> {
  const result = mergeWorkbenchSnapshotEntries(base, left, right)
  const rebuilt = await createWorkbenchSnapshot({
    kind: result.snapshot.kind,
    workbenchId: result.snapshot.workbenchId,
    parentSnapshotId: base.snapshotId,
    entries: result.snapshot.entries.map(entry => ({
      path: entry.path,
      ...(entry.logicalId === undefined ? {} : { logicalId: entry.logicalId }),
      kind: entry.kind,
      ...(entry.deleted ? { deleted: true } : { digest: entry.digest, size: entry.size, ...(entry.chunks === undefined ? {} : { chunks: entry.chunks }) }),
    })),
  })
  return { snapshot: rebuilt.snapshot, conflicts: result.conflicts }
}
