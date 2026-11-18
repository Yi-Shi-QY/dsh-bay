import { describe, expect, it } from 'vitest'
import { buildWorkbenchBundle, readWorkbenchBundle, workbenchBundleFilename } from '../src/workbench-bundle.ts'
import { createWorkbenchSnapshot } from '../src/workbench-snapshot.ts'
import { FolderWorkbenchSyncProvider } from '../src/workbench-sync-provider.ts'
import { syncWorkbenchSnapshot } from '../src/workbench-sync.ts'
import { MemoryWorkbenchSnapshotStore } from '../src/workbench-snapshot-store.ts'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const bytes = (value: string) => new TextEncoder().encode(value)

describe('dshbay workbench bundle v1', () => {
  it('produces stable snapshot and archive bytes', async () => {
    const first = await createWorkbenchSnapshot({ kind: 'complete', workbenchId: 'example', entries: [
      { path: 'projects/b.txt', kind: 'project-file', content: bytes('b') },
      { path: 'layout.json', kind: 'layout', content: bytes('{"areas":1}') },
    ] })
    const second = await createWorkbenchSnapshot({ kind: 'complete', workbenchId: 'example', entries: [
      { path: 'layout.json', kind: 'layout', content: bytes('{"areas":1}') },
      { path: 'projects/b.txt', kind: 'project-file', content: bytes('b') },
    ] })
    expect(second.snapshot.rootDigest).toBe(first.snapshot.rootDigest)
    expect(second.snapshot.snapshotId).toBe(first.snapshot.snapshotId)
    const a = await buildWorkbenchBundle({ snapshot: first.snapshot, objects: first.objects, dshVersion: '0.2.2-rc.3' })
    const b = await buildWorkbenchBundle({ snapshot: second.snapshot, objects: second.objects, dshVersion: '0.2.2-rc.3' })
    expect(a.archive).toEqual(b.archive)
    expect(workbenchBundleFilename('My Workbench')).toBe('My-Workbench.dshbay.zip')
    expect((await readWorkbenchBundle(a.archive)).manifest.format).toBe('dshbay-workbench')
  })

  it('keeps template bundles free of project files and sessions', async () => {
    await expect(createWorkbenchSnapshot({ kind: 'template', workbenchId: 'example', entries: [
      { path: 'projects/app/main.ts', kind: 'project-file', content: bytes('') },
    ] })).rejects.toThrow('template snapshot')
  })

  it('refuses snapshot objects whose content does not match the declared digest', async () => {
    const store = new MemoryWorkbenchSnapshotStore()
    await expect(store.putObjects([{ digest: 'sha256:' + '0'.repeat(64), content: bytes('wrong') }])).rejects.toThrow('digest mismatch')
  })

  it('rejects an archive whose payload digest was changed', async () => {
    const snapshot = await createWorkbenchSnapshot({ kind: 'complete', workbenchId: 'example', entries: [{ path: 'layout.json', kind: 'layout', content: bytes('{}') }] })
    const bundle = await buildWorkbenchBundle({ snapshot: snapshot.snapshot, objects: snapshot.objects, dshVersion: '0.2.2-rc.3' })
    const changed = new Uint8Array(bundle.archive)
    const marker = bytes('{}')[0]
    const index = changed.indexOf(marker)
    if (index >= 0) changed[index] = marker ^ 1
    await expect(readWorkbenchBundle(changed)).rejects.toThrow()
  })

  it('rejects bundles from the old DSH generation', async () => {
    const snapshot = await createWorkbenchSnapshot({ kind: 'complete', workbenchId: 'example', entries: [{ path: 'layout.json', kind: 'layout', content: bytes('{}') }] })
    await expect(buildWorkbenchBundle({ snapshot: snapshot.snapshot, objects: snapshot.objects, dshVersion: '0.2.2-rc.2' })).rejects.toThrow('0.2.2-rc.3')
  })

  it('uploads only missing objects and preserves head conflicts', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'dshbay-sync-'))
    try {
      const provider = new FolderWorkbenchSyncProvider(root, 'example')
      const first = await createWorkbenchSnapshot({ kind: 'complete', workbenchId: 'example', entries: [{ path: 'layout.json', kind: 'layout', content: bytes('one') }] })
      const firstSync = await syncWorkbenchSnapshot({ snapshot: first.snapshot, objects: first.objects, provider })
      expect(firstSync.status).toBe('synced')
      const second = await createWorkbenchSnapshot({ kind: 'complete', workbenchId: 'example', parentSnapshotId: first.snapshot.snapshotId, entries: [{ path: 'layout.json', kind: 'layout', content: bytes('two') }] })
      const secondSync = await syncWorkbenchSnapshot({ snapshot: second.snapshot, objects: second.objects, provider })
      expect(secondSync.uploadedDigests).toHaveLength(1)
      const stale = await createWorkbenchSnapshot({ kind: 'complete', workbenchId: 'example', parentSnapshotId: first.snapshot.snapshotId, entries: [{ path: 'layout.json', kind: 'layout', content: bytes('stale') }] })
      expect((await syncWorkbenchSnapshot({ snapshot: stale.snapshot, objects: stale.objects, provider })).status).toBe('conflict')
      await expect(readFile(path.join(root, 'refs', 'example', 'head'), 'utf8')).resolves.toContain(second.snapshot.snapshotId)

      const freshDevice = await createWorkbenchSnapshot({ kind: 'complete', workbenchId: 'example', entries: [{ path: 'layout.json', kind: 'layout', content: bytes('fresh-device') }] })
      expect((await syncWorkbenchSnapshot({ snapshot: freshDevice.snapshot, objects: freshDevice.objects, provider: new FolderWorkbenchSyncProvider(root, 'example') })).status).toBe('conflict')

      const concurrentLeft = await createWorkbenchSnapshot({ kind: 'complete', workbenchId: 'example', parentSnapshotId: second.snapshot.snapshotId, entries: [{ path: 'layout.json', kind: 'layout', content: bytes('left') }] })
      const concurrentRight = await createWorkbenchSnapshot({ kind: 'complete', workbenchId: 'example', parentSnapshotId: second.snapshot.snapshotId, entries: [{ path: 'layout.json', kind: 'layout', content: bytes('right') }] })
      const concurrent = await Promise.all([
        syncWorkbenchSnapshot({ snapshot: concurrentLeft.snapshot, objects: concurrentLeft.objects, provider: new FolderWorkbenchSyncProvider(root, 'example') }),
        syncWorkbenchSnapshot({ snapshot: concurrentRight.snapshot, objects: concurrentRight.objects, provider: new FolderWorkbenchSyncProvider(root, 'example') }),
      ])
      expect(concurrent.map(result => result.status).sort()).toEqual(['conflict', 'synced'])
    } finally { await rm(root, { recursive: true, force: true }) }
  })
})
