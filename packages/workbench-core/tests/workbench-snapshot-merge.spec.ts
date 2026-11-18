import { describe, expect, it } from 'vitest'
import { createWorkbenchSnapshot, validateWorkbenchSnapshot } from '../src/workbench-snapshot.ts'
import { mergeWorkbenchSnapshots } from '../src/workbench-merge.ts'

const bytes = (value: string) => new TextEncoder().encode(value)

describe('Workbench snapshot merge', () => {
  it('merges independent files and preserves a deletion tombstone', async () => {
    const base = await createWorkbenchSnapshot({ kind: 'complete', workbenchId: 'merge', entries: [
      { path: 'layout.json', kind: 'layout', content: bytes('base-layout') },
      { path: 'projects/a.txt', kind: 'project-file', content: bytes('a') },
      { path: 'projects/b.txt', kind: 'project-file', content: bytes('b') },
    ] })
    const left = await createWorkbenchSnapshot({ kind: 'complete', workbenchId: 'merge', parentSnapshotId: base.snapshot.snapshotId, entries: [
      { path: 'layout.json', kind: 'layout', content: bytes('base-layout') },
      { path: 'projects/a.txt', kind: 'project-file', content: bytes('left') },
      { path: 'projects/b.txt', kind: 'project-file', deleted: true },
    ] })
    const right = await createWorkbenchSnapshot({ kind: 'complete', workbenchId: 'merge', parentSnapshotId: base.snapshot.snapshotId, entries: [
      { path: 'layout.json', kind: 'layout', content: bytes('base-layout') },
      { path: 'projects/a.txt', kind: 'project-file', content: bytes('a') },
      { path: 'projects/b.txt', kind: 'project-file', content: bytes('b') },
      { path: 'projects/c.txt', kind: 'project-file', content: bytes('c') },
    ] })
    const result = await mergeWorkbenchSnapshots(base.snapshot, left.snapshot, right.snapshot)
    expect(result.conflicts).toHaveLength(0)
    await expect(validateWorkbenchSnapshot(result.snapshot)).resolves.toEqual(result.snapshot)
    expect(result.snapshot.entries.find(entry => entry.path === 'projects/a.txt')?.digest).toBe(left.snapshot.entries.find(entry => entry.path === 'projects/a.txt')?.digest)
    expect(result.snapshot.entries.find(entry => entry.path === 'projects/b.txt')?.deleted).toBe(true)
    expect(result.snapshot.entries.some(entry => entry.path === 'projects/c.txt')).toBe(true)
  })

  it('retains a conflict when both devices modify one entry differently', async () => {
    const base = await createWorkbenchSnapshot({ kind: 'complete', workbenchId: 'merge', entries: [{ path: 'layout.json', kind: 'layout', content: bytes('base') }] })
    const left = await createWorkbenchSnapshot({ kind: 'complete', workbenchId: 'merge', parentSnapshotId: base.snapshot.snapshotId, entries: [{ path: 'layout.json', kind: 'layout', content: bytes('left') }] })
    const right = await createWorkbenchSnapshot({ kind: 'complete', workbenchId: 'merge', parentSnapshotId: base.snapshot.snapshotId, entries: [{ path: 'layout.json', kind: 'layout', content: bytes('right') }] })
    const result = await mergeWorkbenchSnapshots(base.snapshot, left.snapshot, right.snapshot)
    expect(result.conflicts).toHaveLength(1)
    await expect(validateWorkbenchSnapshot(result.snapshot)).resolves.toBeDefined()
  })
})
