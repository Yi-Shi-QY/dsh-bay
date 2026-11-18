import type { WorkbenchSnapshotEntryV1, WorkbenchSnapshotV1 } from './workbench-snapshot.ts'

export type WorkbenchSnapshotChangeKind = 'added' | 'modified' | 'deleted' | 'unchanged' | 'conflict'

export interface WorkbenchSnapshotChange {
  path: string
  logicalId?: string
  kind: WorkbenchSnapshotChangeKind
  before?: WorkbenchSnapshotEntryV1
  after?: WorkbenchSnapshotEntryV1
}

function key(entry: Pick<WorkbenchSnapshotEntryV1, 'path' | 'logicalId'>): string { return `${entry.path}\u0000${entry.logicalId ?? ''}` }

export function diffWorkbenchSnapshots(base: WorkbenchSnapshotV1 | undefined, next: WorkbenchSnapshotV1): readonly WorkbenchSnapshotChange[] {
  const before = new Map((base?.entries ?? []).map(entry => [key(entry), entry]))
  const after = new Map(next.entries.map(entry => [key(entry), entry]))
  const keys = new Set([...before.keys(), ...after.keys()])
  return [...keys].sort((a, b) => a.localeCompare(b, 'en')).map(entryKey => {
    const left = before.get(entryKey), right = after.get(entryKey)
    if (left === undefined && right !== undefined) return { path: right.path, ...(right.logicalId === undefined ? {} : { logicalId: right.logicalId }), kind: right.deleted ? 'deleted' as const : 'added' as const, after: right }
    if (left !== undefined && (right === undefined || right.deleted)) return { path: left.path, ...(left.logicalId === undefined ? {} : { logicalId: left.logicalId }), kind: 'deleted' as const, before: left, ...(right === undefined ? {} : { after: right }) }
    if (left === undefined || right === undefined) throw new Error('unreachable snapshot diff state')
    if (left.digest === right.digest && left.size === right.size && left.deleted === right.deleted) return { path: right.path, ...(right.logicalId === undefined ? {} : { logicalId: right.logicalId }), kind: 'unchanged', before: left, after: right }
    return { path: right.path, ...(right.logicalId === undefined ? {} : { logicalId: right.logicalId }), kind: 'modified', before: left, after: right }
  })
}

export interface WorkbenchSnapshotMergeResult {
  snapshot: WorkbenchSnapshotV1
  conflicts: readonly WorkbenchSnapshotChange[]
}

/** Three-way merge for manifest metadata. File contents remain content-addressed. */
export function mergeWorkbenchSnapshotEntries(base: WorkbenchSnapshotV1, left: WorkbenchSnapshotV1, right: WorkbenchSnapshotV1): WorkbenchSnapshotMergeResult {
  const baseMap = new Map(base.entries.map(entry => [key(entry), entry]))
  const leftMap = new Map(left.entries.map(entry => [key(entry), entry]))
  const rightMap = new Map(right.entries.map(entry => [key(entry), entry]))
  const keys = new Set([...baseMap.keys(), ...leftMap.keys(), ...rightMap.keys()])
  const conflicts: WorkbenchSnapshotChange[] = []
  const merged: WorkbenchSnapshotEntryV1[] = []
  for (const entryKey of [...keys].sort((a, b) => a.localeCompare(b, 'en'))) {
    const baseEntry = baseMap.get(entryKey), leftEntry = leftMap.get(entryKey), rightEntry = rightMap.get(entryKey)
    const same = (a: WorkbenchSnapshotEntryV1 | undefined, b: WorkbenchSnapshotEntryV1 | undefined) => JSON.stringify(a) === JSON.stringify(b)
    const selected = same(leftEntry, baseEntry) ? rightEntry : same(rightEntry, baseEntry) ? leftEntry : same(leftEntry, rightEntry) ? leftEntry : undefined
    if (selected !== undefined) { merged.push(selected); continue }
    const conflict = { path: leftEntry?.path ?? rightEntry?.path ?? baseEntry?.path ?? entryKey.split('\u0000')[0]!, ...(leftEntry?.logicalId === undefined ? {} : { logicalId: leftEntry.logicalId }), kind: 'conflict' as const, ...(baseEntry === undefined ? {} : { before: baseEntry }), ...(leftEntry === undefined ? {} : { after: leftEntry }) }
    conflicts.push(conflict)
    if (leftEntry !== undefined) merged.push(leftEntry)
  }
  const snapshot: WorkbenchSnapshotV1 = { ...left, snapshotId: '', parentSnapshotId: base.snapshotId, entries: merged.sort((a, b) => a.path.localeCompare(b.path, 'en') || (a.logicalId ?? '').localeCompare(b.logicalId ?? '')) }
  return { snapshot, conflicts }
}
