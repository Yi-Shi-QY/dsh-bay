import { afterEach, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NativeBayWorkerRuntime } from '../src/host-bay-agent-worker.ts'
import { HostWorkbenchDirectory } from '../src/host-workbench-directory.ts'
import { HostWorkbenchMemory } from '../src/host-workbench-memory.ts'
import { WorkbenchControlPlane } from '../src/foundation/workbench-control-plane.ts'
import { WorkbenchBayAgentAdapter } from '../src/foundation/workbench-bay-agent-adapter.ts'
import { areasOf, migrateDocumentV2ToV3, projectDocumentV3ToLayoutV2, validateWorkbenchDocumentV3 } from '../src/foundation/document-v3.ts'
import { closeGroup, groupsOf, validateLayout } from '../src/foundation/model.ts'
import { createAreaContext } from '../src/foundation/workbench-context.ts'
import { upgradeTaskProjects } from '../src/host-workbench-task-projects.ts'
import type { WorkbenchRecordV2 } from '../src/foundation/persistence.ts'
import type { BayAgentWorkStateV1 } from '../src/foundation/workbench-bay-agent-work.ts'

const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })
const record = (): WorkbenchRecordV2 => ({ workbenchId: 'wb', name: 'Projects', description: '', createdAt: 1, updatedAt: 1,
  document: { version: 3, activeAreaId: 'a', root: { kind: 'split', id: 'split', axis: 'horizontal', ratio: .5, first: { kind: 'area', areaId: 'a', moduleHistory: [] }, second: { kind: 'area', areaId: 'b', moduleHistory: [] } } } })
async function setup() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'bay-projects-'))); roots.push(root)
  const workspaces = { async create(folder: string) { return { id: folder } } }
  const profile = join(root, 'profile'), directory = new HostWorkbenchDirectory(profile, workspaces as never)
  await directory.create({ requestId: 'create', parentPath: root, folderName: 'work', record: record() })
  const current = () => structuredClone(directory.getSnapshot().value.workbenches.wb!)
  const bind = (areaId: string, relativePath: string) => directory.bindArea({ workbenchId: 'wb', areaId, relativePath, createDirectory: true, expectedRevision: directory.getSnapshot().revision })
  const save = (record: WorkbenchRecordV2) => directory.patch({ operation: 'set', path: ['workbenches', 'wb'], value: record, expectedRevision: directory.getSnapshot().revision })
  return { root, profile, workspaces, directory, current, bind, save, work: directory.rootPath('wb') }
}

it('shares directory background and memory, closes all Areas, reopens a fresh overview, and retains the original Session project on rebinding', async () => {
  const f = await setup(); await f.bind('a', 'app'); await f.bind('b', 'app')
  const id = f.current().areaProjects!.a!.projectId!
  expect(f.current().areaProjects!.b!.projectId).toBe(id)
  const plane = new WorkbenchControlPlane({ settings: f.directory })
  await plane.patchContext({ scope: 'area', workbenchId: 'wb', areaId: 'a', writer: 'human', section: 'human', expectedRevision: 0, patch: { objective: 'Build app' } })
  expect(plane.readContext({ scope: 'area', workbenchId: 'wb', areaId: 'b' }).human).toMatchObject({ objective: 'Build app' })
  expect(JSON.parse(await readFile(join(f.work, 'app', '.bay', 'project.json'), 'utf8')).context.human.objective).toBe('Build app')
  expect(JSON.parse(await readFile(join(f.work, '.bay', 'workbench.json'), 'utf8')).record.areaContexts).toBeUndefined()
  const memory = new HostWorkbenchMemory(() => f.work, () => f.current())
  memory.write('wb', { id: 'decision', requestId: 'memory-1', projectId: id, expectedRevision: 0, title: 'Decision', summary: 'Use original app', body: 'Original fact', verification: 'verified', environmentDependent: false, source: { kind: 'user', reference: 'confirmation', description: 'Confirmed' } }, 'human')
  await f.directory.registerSession('wb', 'native', { sessionKey: 'logical', role: 'worker', areaId: 'a', relativePath: 'app', title: 'Original work', agentPreset: 'cordis', createdAt: 1 })
  let current = f.current(), layout = projectDocumentV3ToLayoutV2(current.document, current.areaProjects)
  layout = closeGroup(closeGroup(layout, 'a'), 'b')
  expect(groupsOf(layout.root)).toHaveLength(0)
  expect(validateLayout(layout, 'ungrouped')).toBeDefined()
  current.document = migrateDocumentV2ToV3(layout)
  expect(validateWorkbenchDocumentV3(current.document)).toBeDefined()
  await f.save(current)
  const reopened = new HostWorkbenchDirectory(f.profile, f.workspaces as never)
  expect(areasOf(reopened.getSnapshot().value.workbenches.wb!.document.root)).toHaveLength(0)
  expect(reopened.getSnapshot().value.workbenches.wb!.areaDefinitions).toEqual({})
  expect(reopened.getSnapshot().value.workbenches.wb!.sessionCatalog!.logical!.sessionId).toBe('native')
  const opened = await reopened.openProject({ workbenchId: 'wb', projectId: id, requestId: 'open-app', expectedRevision: reopened.getSnapshot().revision })
  if (opened.status !== 'committed') throw new Error('open conflict')
  expect(['a', 'b']).not.toContain(opened.areaId)
  expect(areasOf(reopened.getSnapshot().value.workbenches.wb!.document.root)[0]!.moduleHistory).toEqual([])
  const reloadedMemory = new HostWorkbenchMemory(() => f.work, () => reopened.getSnapshot().value.workbenches.wb!)
  expect(reloadedMemory.read('wb', 'decision').body).toBe('Original fact')
  await reopened.bindArea({ workbenchId: 'wb', areaId: opened.areaId, relativePath: 'research', createDirectory: true, expectedRevision: reopened.getSnapshot().revision })
  const adapter = new WorkbenchBayAgentAdapter(new WorkbenchControlPlane({ settings: reopened }))
  expect(adapter.capturePrompt({ workbenchId: 'wb', projectId: id }).area?.human.objective).toBe('Build app')
  expect(reopened.getSnapshot().value.workbenches.wb!.sessionCatalog!.logical!.projectId).toBe(id)
})

it('upgrades current alpha data with conflicting backgrounds and all memory revisions without retaining hidden Areas', async () => {
  const f = await setup(); await f.bind('a', 'app'); await f.bind('b', 'app')
  const legacy = f.current()
  delete legacy.projectModelVersion; delete legacy.projects; delete legacy.fileWorkbench
  for (const ref of Object.values(legacy.areaProjects!)) delete ref.projectId
  legacy.areaContexts = { a: { ...createAreaContext(), revision: 2, human: { ...createAreaContext().human, objective: 'First goal' } }, b: { ...createAreaContext(), revision: 3, human: { ...createAreaContext().human, objective: 'Other goal' } } }
  legacy.document = { version: 3, activeAreaId: 'a', root: { kind: 'area', areaId: 'a', moduleHistory: [] } }
  const memory = new HostWorkbenchMemory(() => f.work)
  const input = { id: 'fact', requestId: 'old-1', areaId: 'b', expectedRevision: 0, title: 'Fact', summary: 'Fact', body: 'v1', verification: 'verified' as const, environmentDependent: false, source: { kind: 'user' as const, reference: 'original', description: 'Confirmed' } }
  memory.write('wb', input, 'human'); memory.write('wb', { ...input, requestId: 'old-2', expectedRevision: 1, body: 'v2' }, 'human')
  await rm(join(f.work, 'app', '.bay', 'project.json'))
  await writeFile(join(f.work, '.bay', 'workbench.json'), JSON.stringify({ schemaVersion: 1, revision: 7, record: legacy }))
  const upgraded = new HostWorkbenchDirectory(f.profile, f.workspaces as never)
  const saved = upgraded.getSnapshot().value.workbenches.wb!, project = Object.values(saved.projects!)[0]!
  expect(saved.areaDefinitions?.b).toBeUndefined()
  expect(project.context!.human.objective).toBe('')
  expect(project.contextCandidates?.map(row => row.context.human.objective)).toEqual(['First goal', 'Other goal'])
  const nextMemory = new HostWorkbenchMemory(() => f.work, () => saved)
  expect(nextMemory.read('wb', 'fact', 1).body).toBe('v1')
  expect(nextMemory.read('wb', 'fact', 2).body).toBe('v2')
  expect(nextMemory.read('wb', 'fact').entry.projectId).toBe(project.projectId)
  expect(JSON.parse(await readFile(join(f.work, '.bay', 'upgrades', 'project-ownership-v1', 'workbench.json'), 'utf8')).schemaVersion).toBe(1)
  const again = new HostWorkbenchDirectory(f.profile, f.workspaces as never)
  expect(Object.keys(again.getSnapshot().value.workbenches.wb!.projects!)).toEqual([project.projectId])
  expect(nextMemory.list('wb')).toHaveLength(1)
})

it('resolves legacy task ownership from its original Session after the old Area changed projects', async () => {
  const f = await setup(); await f.bind('a', 'app')
  await f.directory.registerSession('wb', 'native-worker', { sessionKey: 'worker', role: 'worker', areaId: 'a', relativePath: 'app', title: 'Work', agentPreset: 'cordis', createdAt: 1 })
  const original = f.current().areaProjects!.a!.projectId!
  await f.bind('a', 'research')
  const source: BayAgentWorkStateV1 = { version: 1, workItems: [{ workItemId: 'task', workbenchId: 'wb', areaId: 'a', objective: 'Original work', status: 'stopped', inputs: [], successCriteria: [], createdAt: 1, updatedAt: 2 }], assignments: [{ assignmentId: 'attempt', workItemId: 'task', areaId: 'a', runtimeName: 'dsh-session-controller', workerSessionId: 'native-worker', state: 'ended', createdAt: 1 }], attention: [] }
  const upgraded = upgradeTaskProjects(f.current(), source)
  expect(upgraded.workItems[0]!.projectId).toBe(original)
  expect(upgraded.assignments[0]!.projectId).toBe(original)
  expect(upgradeTaskProjects(f.current(), upgraded)).toEqual(upgraded)
})

it('continues a stopped task in a new Area with its original native Session and a fresh Assignment', async () => {
  const f = await setup(); await f.bind('a', 'app')
  await f.directory.registerSession('wb', 'native-worker', { sessionKey: 'worker', role: 'worker', areaId: 'a', relativePath: 'app', title: 'Original task', agentPreset: 'cordis', createdAt: 1 })
  const projectId = f.current().areaProjects!.a!.projectId!
  const current = f.current(); current.document = { version: 3, activeAreaId: '', root: { kind: 'area', areaId: '', moduleHistory: [] } }; await f.save(current)
  const opened = await f.directory.openProject({ workbenchId: 'wb', projectId, requestId: 'new-view', expectedRevision: f.directory.getSnapshot().revision })
  if (opened.status !== 'committed') throw new Error('conflict')
  const createSession = vi.fn(), deliver = vi.fn(), decorate = vi.fn()
  const plane = new WorkbenchControlPlane({ settings: f.directory, createSession })
  const runtime = new NativeBayWorkerRuntime({ plane, decorate, deliver, sessions: { resolveAgent: async () => ({ agent: {} }), state: async () => ({ running: false, queue: [], pendingInput: [] }), cancel() {} } as never })
  try {
    const workItem = { workItemId: 'task', workbenchId: 'wb', areaId: 'a', projectId, objective: 'Continue app', agentPreset: 'cordis', status: 'stopped' as const, inputs: [], successCriteria: [], createdAt: 1, updatedAt: 1 }
    const result = await runtime.createAssignment({ workItem, assignment: { assignmentId: 'new-attempt', workItemId: 'task', areaId: 'a', projectId, runtimeName: runtime.name, state: 'pending', createdAt: 2 }, previousAssignment: { assignmentId: 'old-attempt', workItemId: 'task', areaId: 'a', projectId, runtimeName: runtime.name, workerSessionId: 'native-worker', state: 'ended', createdAt: 1 }, prompt: 'Continue' })
    expect(result).toMatchObject({ runtimeAssignmentId: 'new-attempt', sessionId: 'native-worker', lease: { projectId, areaId: opened.areaId } })
    expect(createSession).not.toHaveBeenCalled()
    expect(deliver.mock.calls[0]!.slice(0, 2)).toEqual(['native-worker', 'assignment:new-attempt'])
    expect(areasOf(f.current().document.root)[0]!.moduleHistory[0]!.binding!.sessionId).toBe('native-worker')
  } finally { runtime.dispose() }
})
it('rejects malformed empty layout shells and isolates unreadable project metadata', async () => {
  expect(validateWorkbenchDocumentV3({ version: 3, activeAreaId: 'b', root: { kind: 'split', id: 'split', axis: 'horizontal', ratio: .5, first: { kind: 'area', areaId: '', moduleHistory: [] }, second: { kind: 'area', areaId: 'b', moduleHistory: [] } } })).toBeUndefined()
  expect(validateLayout({ version: 2, activeGroupId: '', root: { kind: 'group', id: '', tabs: [], project: { projectId: 'ghost' } } })).toBeUndefined()
  const f = await setup(); await f.bind('a', 'app')
  await writeFile(join(f.work, 'app', '.bay', 'project.json'), '{invalid')
  const reopened = new HostWorkbenchDirectory(f.profile, f.workspaces as never)
  expect(reopened.getSnapshot().value.workbenches.wb).toBeUndefined()
  expect(reopened.getSnapshot().value.invalidWorkbenches.wb).toBeDefined()
  const registryBefore = await readFile(join(f.profile, '.dsh-workbench', 'directory-v1', 'registry.json'), 'utf8')
  await reopened.patch({ operation: 'set', path: ['activeWorkbenchId'], value: '', expectedRevision: reopened.getSnapshot().revision })
  expect(await readFile(join(f.profile, '.dsh-workbench', 'directory-v1', 'registry.json'), 'utf8')).toBe(registryBefore)
})
