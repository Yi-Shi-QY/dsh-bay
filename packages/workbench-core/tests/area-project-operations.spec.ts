import { afterEach, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { HostWorkbenchDirectory } from '../src/host-workbench-directory.ts'
import { areasOf, migrateDocumentV2ToV3, projectDocumentV3ToLayoutV2 } from '../src/foundation/document-v3.ts'
import { canMergeGroups, closeGroup, closeTab, createSessionTab, duplicateTab, group, groupsOf, mergeGroup, moveTab, swapGroups } from '../src/foundation/model.ts'
import { decodeWorkbenchSettingsV4 } from '../src/foundation/persistence.ts'
import { prepareFloatingTabForArea } from '../src/foundation/editor-selection.ts'
import { WorkbenchControlPlane } from '../src/foundation/workbench-control-plane.ts'
import type { WorkbenchLayoutDocument } from '../src/foundation/model.ts'

const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })
async function fixture(sameProject = true) {
  const root = await mkdtemp(join(tmpdir(), 'bay-area-operations-')); roots.push(root)
  const workspaces = new Map<string, string>()
  const directory = new HostWorkbenchDirectory(join(root, 'profile'), { async create(path: string) { if (!workspaces.has(path)) workspaces.set(path, 'workspace-' + workspaces.size); return { id: workspaces.get(path)! } } } as never)
  const layout: WorkbenchLayoutDocument = { version: 2, activeGroupId: 'a', root: { kind: 'split', id: 'split', axis: 'horizontal', ratio: .5, first: group('a'), second: group('b') } }
  await directory.create({ requestId: 'create', parentPath: root, folderName: 'workbench', record: { workbenchId: 'wb', name: 'Workbench', description: '', createdAt: 1, updatedAt: 1, document: migrateDocumentV2ToV3(layout) } })
  for (const areaId of ['a', 'b']) await directory.bindArea({ workbenchId: 'wb', areaId, relativePath: sameProject || areaId === 'a' ? 'app' : 'research', createDirectory: true, expectedRevision: directory.getSnapshot().revision })
  for (const area of groupsOf(layout.root)) {
    const tab = createSessionTab('tab-' + area.id, 'workbench.conversation', { sessionId: 'session-' + area.id, workspaceId: directory.workspaceId('wb', area.id) }, area.id)
    area.tabs.push(tab); area.activeTabId = tab.id
  }
  const save = (document: WorkbenchLayoutDocument) => directory.patch({ operation: 'set', path: ['workbenches', 'wb'], expectedRevision: directory.getSnapshot().revision, value: { ...directory.getSnapshot().value.workbenches.wb!, document: migrateDocumentV2ToV3(document) } })
  await save(layout)
  return { directory, save, layout: projectDocumentV3ToLayoutV2(directory.getSnapshot().value.workbenches.wb!.document, directory.getSnapshot().value.workbenches.wb!.areaProjects) }
}
it('splits an existing conversation and atomically persists its project without changing its owner', async () => {
  const { directory, save, layout } = await fixture()
  await expect(save(moveTab(layout, 'tab-a', 'a', 'right', { groupId: 'new-area', splitId: 'new-split' }))).resolves.toMatchObject({ status: 'committed' })
  const record = directory.getSnapshot().value.workbenches.wb!
  expect(record.areaProjects?.['new-area']?.relativePath).toBe('app')
  expect(record.sessionCatalog?.['session-a']?.areaId).toBe('a')
  expect(areasOf(record.document.root).find(area => area.areaId === 'a')?.moduleHistory).toEqual([])
})
it('exchanges complete Area positions across projects and survives persistence', async () => {
  const { directory, save, layout } = await fixture(false)
  const swapped = swapGroups(layout, 'a', 'b')
  expect(groupsOf(swapped.root).map(area => area.id)).toEqual(['b', 'a'])
  await expect(save(swapped)).resolves.toMatchObject({ status: 'committed' })
  expect(directory.getSnapshot().value.workbenches.wb!.areaProjects?.a?.relativePath).toBe('app')
})
it('closing the last view preserves the Area and the durable conversation', async () => {
  const { directory, save, layout } = await fixture()
  await save(closeTab(layout, 'tab-a'))
  const record = directory.getSnapshot().value.workbenches.wb!
  expect(areasOf(record.document.root).map(area => area.areaId)).toContain('a')
  expect(record.sessionCatalog?.['session-a']?.areaId).toBe('a')
})
it('removes closed Area identities while retaining projects and conversations, including an empty layout', async () => {
  const { directory, save, layout } = await fixture()
  const projectId = directory.getSnapshot().value.workbenches.wb!.areaProjects!.a!.projectId!
  const closed = closeGroup(closeGroup(layout, 'a'), 'b')
  expect(groupsOf(closed.root)).toEqual([])
  await save(closed)
  let record = directory.getSnapshot().value.workbenches.wb!
  expect(record.areaProjects).toEqual({})
  expect(record.areaDefinitions).toEqual({})
  expect(record.sessionCatalog?.['session-a']).toMatchObject({ projectId, areaId: 'a' })
  const opened = await directory.openProject({ workbenchId: 'wb', projectId, requestId: 'reopen', expectedRevision: directory.getSnapshot().revision })
  if (opened.status !== 'committed') throw new Error('conflict')
  expect(['a', 'b']).not.toContain(opened.areaId)
  record = directory.getSnapshot().value.workbenches.wb!
  expect(areasOf(record.document.root)[0]!.moduleHistory).toEqual([])
  expect(record.sessionCatalog?.['session-a']?.projectId).toBe(projectId)
})
it('keeps project-open retries idempotent and rejects request IDs reused for another project', async () => {
  const { directory } = await fixture(false)
  const projects = directory.getSnapshot().value.workbenches.wb!.projects!
  const [app, research] = Object.values(projects)
  expect(app).toBeDefined(); expect(research).toBeDefined()
  const request = { workbenchId: 'wb', projectId: app!.projectId, requestId: 'open-project-request', expectedRevision: directory.getSnapshot().revision }
  const opened = await directory.openProject(request)
  expect(await directory.openProject({ ...request, expectedRevision: directory.getSnapshot().revision })).toMatchObject({ status: 'committed', areaId: opened.areaId })
  await expect(directory.openProject({ ...request, projectId: research!.projectId, expectedRevision: directory.getSnapshot().revision })).rejects.toThrow('不同项目')
})
it('merging removes the source Area and keeps independent project and conversation ownership', async () => {
  const { directory, save, layout } = await fixture()
  const projectId = directory.getSnapshot().value.workbenches.wb!.areaProjects!.a!.projectId!
  await save(mergeGroup(layout, 'a', 'b'))
  const plane = new WorkbenchControlPlane({ settings: directory })
  expect(() => plane.getArea('a', 'wb')).toThrow('Unknown Area')
  expect(plane.inspect('wb').sessions).toEqual(expect.arrayContaining([expect.objectContaining({ sessionId: 'session-a', projectId })]))
  const decoded = decodeWorkbenchSettingsV4(JSON.parse(JSON.stringify(directory.getSnapshot().value)))!
  expect(decoded.workbenches.wb!.areaDefinitions?.a).toBeUndefined()
  expect(decoded.workbenches.wb!.sessionCatalog?.['session-a']?.projectId).toBe(projectId)
  expect(decoded.workbenches.wb!.fileWorkbench).toBeDefined()
})
it('undoing closure of an empty Area restores its project without retaining a hidden Area', async () => {
  const { directory, save, layout } = await fixture()
  const empty = closeTab(layout, 'tab-a')
  await save(empty)
  const projectId = directory.getSnapshot().value.workbenches.wb!.areaProjects!.a!.projectId
  await save(closeGroup(empty, 'a'))
  expect(directory.getSnapshot().value.workbenches.wb!.areaProjects!.a).toBeUndefined()
  await save(empty)
  expect(directory.getSnapshot().value.workbenches.wb!.areaProjects!.a!.projectId).toBe(projectId)
  expect(areasOf(directory.getSnapshot().value.workbenches.wb!.document.root).find(area => area.areaId === 'a')!.moduleHistory).toEqual([])
})

it('does not merge empty Areas from different projects or move a conversation across projects', async () => {
  const { layout } = await fixture(false)
  const [a, b] = groupsOf(layout.root)
  const empty = { ...layout, root: { kind: 'split' as const, id: 'empty-split', axis: 'horizontal' as const, ratio: .5, first: { ...a!, tabs: [] }, second: { ...b!, tabs: [] } } }
  expect(canMergeGroups(empty, 'a', 'b')).toBe(false)
  expect(moveTab(layout, 'tab-a', 'b', 'center', { groupId: 'new', splitId: 'split-new' })).toBe(layout)
})

it('duplicates only the view, persists its project, and never binds a pending floating plugin to its neighbour', async () => {
  const { directory, layout, save } = await fixture()
  await save(duplicateTab(layout, 'tab-a', 'copy-a', 'a', 'right', { groupId: 'copy-area', splitId: 'copy-split' }))
  const record = directory.getSnapshot().value.workbenches.wb!
  expect(record.areaProjects?.['copy-area']?.relativePath).toBe('app')
  expect(Object.values(record.sessionCatalog!).filter(row => row.sessionId === 'session-a')).toHaveLength(1)
  expect(record.sessionCatalog?.['session-a']?.areaId).toBe('a')
  const pending = prepareFloatingTabForArea({ id: 'floating', editorId: 'workbench.trajectory', editorScope: 'session', pendingBinding: 'floating', state: {}, lastKnownTitle: 'Trajectory' }, groupsOf(layout.root)[0]!, [])
  expect(pending.binding).toBeUndefined()
  expect(pending.pendingBinding).toMatch(/^binding-/)
})
