import { afterEach, expect, it } from 'vitest'
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { HostWorkbenchDirectory } from '../src/host-workbench-directory.ts'
import type { WorkbenchRecordV2 } from '../src/foundation/persistence.ts'
import { createWorkbenchContext } from '../src/foundation/workbench-context.ts'

const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })
function record(): WorkbenchRecordV2 { return { workbenchId: 'workbench-one', name: 'Research', description: '', createdAt: 1, updatedAt: 1,
  document: { version: 3, activeAreaId: 'area-a', root: { kind: 'split', id: 'split', axis: 'horizontal', ratio: .5,
    first: { kind: 'area', areaId: 'area-a', moduleHistory: [] }, second: { kind: 'area', areaId: 'area-b', moduleHistory: [] } } } } }
async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'bay-directory-')); roots.push(root)
  const workspaceIds = new Map<string, string>()
  const workspaces = { async create(path: string) { if (!workspaceIds.has(path)) workspaceIds.set(path, 'workspace-' + workspaceIds.size); return { id: workspaceIds.get(path)! } } }
  const directory = new HostWorkbenchDirectory(join(root, 'profile'), workspaces as never)
  const input = { requestId: 'request-1', parentPath: root, folderName: 'Research', record: record() }
  return { root, workspaces, directory, input }
}
it('creates one file-authoritative workbench and reopens without a second profile copy', async () => {
  const f = await setup()
  const first = await f.directory.create(f.input)
  expect(await f.directory.create(f.input)).toEqual(first)
  const rootPath = f.directory.rootPath(first.workbenchId)
  expect(JSON.parse(await readFile(join(rootPath, '.bay', 'workbench.json'), 'utf8')).record.name).toBe('Research')
  const profile = JSON.parse(await readFile(join(f.root, 'profile', '.dsh-workbench', 'directory-v1', 'registry.json'), 'utf8'))
  expect(profile.preferences.workbenches).toBeUndefined()
  const reopened = new HostWorkbenchDirectory(join(f.root, 'profile'), f.workspaces as never)
  expect(reopened.getSnapshot().value.workbenches['workbench-one']?.fileWorkbench?.rootPath).toBe(rootPath)
  expect(Object.keys(reopened.getSnapshot().value.workbenches)).toHaveLength(1)
  const snapshot = reopened.getSnapshot()
  expect(await reopened.patch({ operation: 'set', path: [], value: snapshot.value, expectedRevision: snapshot.revision })).toEqual({ status: 'committed', revision: snapshot.revision })
})
it('lists and previews a zero-session project, limits large previews and rejects escapes', async () => {
  const f = await setup(); await f.directory.create(f.input)
  await f.directory.bindArea({ workbenchId: 'workbench-one', areaId: 'area-a', relativePath: 'app', createDirectory: true, expectedRevision: f.directory.getSnapshot().revision })
  const base = join(f.directory.rootPath('workbench-one'), 'app')
  await mkdir(join(base, 'src')); await writeFile(join(base, 'src', 'index.ts'), 'export const result = true')
  await writeFile(join(base, 'large.txt'), 'x'.repeat(300 * 1024))
  expect(await f.directory.projectEntries('workbench-one', 'area-a')).toMatchObject({ project: 'app', entries: [{ name: 'src', kind: 'directory' }, { name: 'large.txt', kind: 'file' }] })
  expect(await f.directory.projectPreview('workbench-one', 'area-a', 'src/index.ts')).toEqual({ text: 'export const result = true', truncated: false })
  expect(await f.directory.projectPreview('workbench-one', 'area-a', 'large.txt')).toMatchObject({ truncated: true })
  await expect(f.directory.projectPreview('workbench-one', 'area-a', '../.bay/workbench.json')).rejects.toThrow()
  await expect(f.directory.projectEntries('workbench-one', 'area-b')).rejects.toThrow('项目文件夹')
  expect(f.directory.getSnapshot().value.workbenches['workbench-one']!.sessionCatalog).toEqual({})
})
it('binds two zero-session areas to one project without merging their contexts', async () => {
  const f = await setup(); await f.directory.create(f.input)
  const bind = (areaId: string) => f.directory.bindArea({ workbenchId: 'workbench-one', areaId, relativePath: 'projects/app', createDirectory: true, expectedRevision: f.directory.getSnapshot().revision })
  await bind('area-a'); await bind('area-b')
  const record = f.directory.getSnapshot().value.workbenches['workbench-one']!
  expect(record.areaProjects?.['area-a']?.workspaceId).toBe(record.areaProjects?.['area-b']?.workspaceId)
  expect(record.sessionCatalog).toEqual({})
  expect(record.document.root.kind).toBe('split')
  await expect(f.directory.bindArea({ workbenchId: 'workbench-one', areaId: 'area-a', relativePath: '../outside', expectedRevision: f.directory.getSnapshot().revision })).rejects.toThrow()
  await expect(f.directory.bindArea({ workbenchId: 'workbench-one', areaId: 'area-a', relativePath: '.bay/memory', expectedRevision: f.directory.getSnapshot().revision })).rejects.toThrow('内部')
})
it('checks real directory links before creating anything outside the workbench', async () => {
  const f = await setup(); await f.directory.create(f.input)
  const external = join(f.root, 'outside'); await mkdir(external)
  await symlink(external, join(f.directory.rootPath('workbench-one'), 'escape'), process.platform === 'win32' ? 'junction' : 'dir')
  await expect(f.directory.resolveDirectory('workbench-one', 'escape/should-not-exist', true)).rejects.toThrow('根目录之外')
  await expect(readFile(join(external, 'should-not-exist'))).rejects.toMatchObject({ code: 'ENOENT' })
})
it('serializes optimistic updates and generates background Markdown from the committed source', async () => {
  const f = await setup(); await f.directory.create(f.input)
  const snapshot = f.directory.getSnapshot(), original = snapshot.value.workbenches['workbench-one']!
  const context = createWorkbenchContext(); context.human.goal = 'Verified goal'
  const changes = await Promise.all([
    f.directory.patch({ operation: 'set', path: ['workbenches', 'workbench-one'], value: { ...original, context }, expectedRevision: snapshot.revision }),
    f.directory.patch({ operation: 'set', path: ['workbenches', 'workbench-one'], value: { ...original, name: 'Stale' }, expectedRevision: snapshot.revision }),
  ])
  expect(changes.map(row => row.status)).toEqual(['committed', 'conflict'])
  expect(await readFile(join(f.directory.rootPath('workbench-one'), '.bay', 'context', '工作台整体背景说明.md'), 'utf8')).toContain('Verified goal')
  expect(f.directory.getSnapshot().value.workbenches['workbench-one']?.name).toBe('Research')
})
