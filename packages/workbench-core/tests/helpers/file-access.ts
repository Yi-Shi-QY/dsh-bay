import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { HostWorkbenchDirectory } from '../../src/host-workbench-directory.ts'
import { HostWorkbenchAccess } from '../../src/host-workbench-access.ts'
import { HostWorkbenchMemory } from '../../src/host-workbench-memory.ts'

export async function fileAccessFixture(workbenchId = 'workbench-a') {
  const root = await mkdtemp(join(tmpdir(), 'bay-access-'))
  const ids = new Map<string, string>()
  const directory = new HostWorkbenchDirectory(join(root, 'profile'), { async create(path: string) { if (!ids.has(path)) ids.set(path, 'workspace-' + ids.size); return { id: ids.get(path)! } } } as never)
  await directory.create({ requestId: 'create-' + workbenchId, parentPath: root, folderName: workbenchId, record: {
    workbenchId, name: workbenchId, description: '', createdAt: 1, updatedAt: 1,
    document: { version: 3, activeAreaId: 'area-a', root: { kind: 'split', id: 'split', axis: 'horizontal', ratio: .5,
      first: { kind: 'area', areaId: 'area-a', moduleHistory: [] }, second: { kind: 'area', areaId: 'area-b', moduleHistory: [] } } },
  } })
  const memory = new HostWorkbenchMemory(id => directory.rootPath(id), id => directory.getSnapshot().value.workbenches[id]!)
  const access = new HostWorkbenchAccess(directory, memory)
  return { root, directory, access, async dispose() { access.dispose(); await rm(root, { recursive: true, force: true }) } }
}
