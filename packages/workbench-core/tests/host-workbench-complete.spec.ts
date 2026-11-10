import { afterEach, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import * as jsonl from '@deepseek-ai/dsh-session-persistence-jsonl'
import { Session, SessionId, SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { BayAgentWorkStateV1 } from '../src/foundation/workbench-bay-agent-work.ts'
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { HostWorkbenchDirectory } from '../src/host-workbench-directory.ts'
import { installWorkbenchCompleteRoute } from '../src/host-workbench-complete.ts'
import type { WorkbenchRecordV2 } from '../src/foundation/persistence.ts'

const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })
function record(): WorkbenchRecordV2 { return { workbenchId: 'complete-wb', name: 'Complete', description: 'test', createdAt: 1, updatedAt: 1,
  document: { version: 3, activeAreaId: 'area-a', root: { kind: 'area', areaId: 'area-a', moduleHistory: [] } } } }
it('exports and imports an inert V5 package with files, definition and empty native session set', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'bay-complete-'))); roots.push(root)
  const workspaceIds = new Map<string, string>(), workspaces = { async create(folder: string) { const id = workspaceIds.get(folder) ?? 'workspace-' + workspaceIds.size; workspaceIds.set(folder, id); return { id } } }
  const directory = new HostWorkbenchDirectory(join(root, 'profile'), workspaces as never)
  await directory.create({ requestId: 'create-one', parentPath: root, folderName: 'source', record: record() })
  const source = directory.rootPath('complete-wb'); await (await import('node:fs/promises')).writeFile(join(source, 'visible.txt'), 'preserved')
  let handler: ((request: Request) => Promise<Response>) | undefined
  const connection = { fetch: { register(config: { fetch: (request: Request) => Promise<Response> }) { handler = config.fetch; return () => {} } } }
  installWorkbenchCompleteRoute(connection as never, { profile: join(root, 'profile'), directory, persistence: { async flush() {}, async list() { return [] } } as never, workspaces: workspaces as never })
  const archive = join(root, 'complete.tar.gz')
  const exportResponse = await handler!(new Request('http://localhost', { method: 'POST', body: JSON.stringify({ action: 'export', workbenchId: 'complete-wb', path: archive }) })), exported = await exportResponse.json() as { value?: { stage: string }; error?: string }
  expect(exportResponse.ok, exported.error).toBe(true)
  expect(exported.value.stage).toBe('complete')
  const recipientProfile = join(root, 'recipient-profile'), directory2 = new HostWorkbenchDirectory(recipientProfile, workspaces as never)
  let importHandler: ((request: Request) => Promise<Response>) | undefined
  const connection2 = { fetch: { register(config: { fetch: (request: Request) => Promise<Response> }) { importHandler = config.fetch; return () => {} } } }
  installWorkbenchCompleteRoute(connection2 as never, { profile: recipientProfile, directory: directory2, persistence: { async flush() {}, async list() { return [] } } as never, workspaces: workspaces as never })
  const requestId = 'import-once'
  const imported = await (await importHandler!(new Request('http://localhost', { method: 'POST', body: JSON.stringify({ action: 'import', path: archive, parentPath: root, folderName: 'recipient', requestId }) }))).json() as { value: { id: string; stage: string } }
  expect(imported.value.stage).toBe('complete')
  const retried = await (await importHandler!(new Request('http://localhost', { method: 'POST', body: JSON.stringify({ action: 'import', path: archive, parentPath: root, folderName: 'recipient', requestId }) }))).json() as { value: { id: string; stage: string } }
  expect(retried.value).toMatchObject({ id: imported.value.id, stage: 'complete' })
  const snapshot = directory2.getSnapshot().value.workbenches['complete-wb']
  expect(snapshot?.executionPaused).toBe(true)
  expect(await readFile(join(root, 'recipient', 'visible.txt'), 'utf8')).toBe('preserved')
})

it('restores hidden task ownership, logical session mappings and final cwd; retry does not duplicate Sessions or run tasks', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'bay-complete-task-'))); roots.push(root)
  const source = new Context(), target = new Context()
  await jsonl.apply(source, { root: join(root, 'source-store'), compression: 'none' })
  await jsonl.apply(target, { root: join(root, 'target-store'), compression: 'none' })
  try {
    const workspaces = { async create(folder: string) { return { id: folder } } }
    const directory = new HostWorkbenchDirectory(join(root, 'profile'), workspaces as never)
    await directory.create({ requestId: 'create-task', parentPath: root, folderName: 'source', record: { ...record(), areaDefinitions: { hidden: { areaId: 'hidden' } } } })
    for (const areaId of ['area-a', 'hidden']) await directory.bindArea({ workbenchId: 'complete-wb', areaId, relativePath: 'app', createDirectory: true, expectedRevision: directory.getSnapshot().revision })
    const repair = await directory.prepareCreatorRepair({ workbenchId: 'complete-wb', moduleId: 'local.pomodoro' })
    for (const id of ['native-main', 'native-worker', repair.sessionId]) {
      const main = id === 'native-main', isRepair = id === repair.sessionId
      const relativePath = main ? '' : isRepair ? repair.relativePath : 'app'
      const session = Session.create(SessionId(id), [], { version: SESSION_FORMAT_VERSION, id: SessionId(id), cwd: join(directory.rootPath('complete-wb'), relativePath), createdAt: 1, isSeeded: false })
      session.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'Preserved task history' }], source: { kind: 'user' } }), { surfaceOp: 'append' })
      const log = await source.sessionPersistence.create(session.header)
      try { await log.append(session.snapshotEvents()); await log.flush() } finally { await log.close() }
      await directory.registerSession('complete-wb', id, { sessionKey: main ? 'main:key' : isRepair ? repair.sessionKey : 'worker:key', role: main ? 'main' : isRepair ? 'user' : 'worker', ...(main || isRepair ? {} : { areaId: 'hidden' }), relativePath, title: id, agentPreset: main ? 'bay-agent' : isRepair ? 'cordis' : 'standard', createdAt: 1 })
    }
    const sourceRecord = directory.getSnapshot().value.workbenches['complete-wb']!
    if (sourceRecord.document.root.kind !== 'area') throw new Error('Expected Area')
    const workspaceId = directory.workspaceId('complete-wb', 'hidden')
    const stateKey = JSON.stringify([workspaceId, 'native-worker'])
    sourceRecord.document.root.moduleHistory = ['view-1', 'view-2'].map(moduleInstanceId => ({ moduleInstanceId, editorId: 'workbench.document-preview', editorScope: 'session',
      binding: { sessionId: 'native-worker', workspaceId }, state: { resourceAddress: 'dsh-resource://file/session/native-worker/result.txt' }, lastKnownTitle: 'Result',
      sessionStates: { [stateKey]: { resourceAddress: 'dsh-resource://file/session/native-worker/result.txt' } }, sessionStateOrder: [stateKey] }))
    sourceRecord.document.root.activeModuleInstanceId = 'view-1'
    await directory.patch({ operation: 'set', path: ['workbenches', 'complete-wb'], value: sourceRecord, expectedRevision: directory.getSnapshot().revision })
    const state: BayAgentWorkStateV1 = { version: 1,
      workItems: [{ workItemId: 'task', workbenchId: 'complete-wb', areaId: 'hidden', objective: 'Continue original work', status: 'running', currentAssignmentId: 'attempt', inputs: [], successCriteria: [], createdAt: 1, updatedAt: 2 }],
      assignments: [{ assignmentId: 'attempt', workItemId: 'task', areaId: 'hidden', runtimeName: 'dsh-session-controller', runtimeAssignmentId: 'old-run', workerSessionId: 'native-worker', state: 'running', createdAt: 2 }], attention: [],
      events: [{ schemaVersion: 1, eventId: 'event', seq: 5, workbenchId: 'complete-wb', kind: 'assignment.started', source: 'runtime', createdAt: 2, payload: { workItemId: 'task', assignmentId: 'attempt', sessionId: 'native-worker' } }], nextEventSeq: 6,
      checkpoint: { schemaVersion: 1, workbenchId: 'complete-wb', compactedThroughSeq: 4, compactedAt: 1, retainedEventCount: 1, countsByKind: {}, summary: 'Earlier work' } }
    const route = (options: Parameters<typeof installWorkbenchCompleteRoute>[1]) => {
      let fetch!: (request: Request) => Promise<Response>
      installWorkbenchCompleteRoute({ fetch: { register(config: { fetch: typeof fetch }) { fetch = config.fetch; return () => {} } } } as never, options)
      return async (input: object) => { const response = await fetch(new Request('http://localhost', { method: 'POST', body: JSON.stringify(input) })); return { ok: response.ok, ...await response.json() } }
    }
    const archive = join(root, 'complete.tar.gz')
    const exporter = route({ profile: join(root, 'profile'), directory, persistence: source.sessionPersistence, workspaces: workspaces as never, orchestration: { load: () => state, save() {} } })
    expect(await exporter({ action: 'export', workbenchId: 'complete-wb', path: archive })).toMatchObject({ ok: true })
    const recipient = new HostWorkbenchDirectory(join(root, 'recipient-profile'), workspaces as never)
    const save = vi.fn().mockImplementationOnce(() => { throw new Error('injected task write failure') }).mockImplementation(() => {})
    const importer = route({ profile: join(root, 'recipient-profile'), directory: recipient, persistence: target.sessionPersistence, workspaces: workspaces as never, orchestration: { load: () => state, save } })
    const input = { action: 'import', requestId: 'task-import-once', path: archive, parentPath: root, folderName: 'recipient' }
    expect(await importer(input)).toMatchObject({ ok: false, error: 'injected task write failure' })
    expect(recipient.getSnapshot().value.workbenches['complete-wb']).toBeUndefined()
    expect(await importer(input)).toMatchObject({ ok: true, value: { stage: 'complete' } })
    expect(await importer(input)).toMatchObject({ ok: true, value: { stage: 'complete' } })
    const restored = recipient.getSnapshot().value.workbenches['complete-wb']!
    const workerId = restored.sessionCatalog!['worker:key']!.sessionId!
    const tasks = save.mock.calls.at(-1)![1] as BayAgentWorkStateV1
    expect(restored.areaDefinitions?.hidden).toEqual({ areaId: 'hidden' })
    expect(tasks.workItems[0]).toMatchObject({ areaId: 'hidden', status: 'waiting', importedFrom: { status: 'running' } })
    expect(tasks.assignments[0]).toMatchObject({ workerSessionId: workerId, state: 'ended', importedFrom: { runtimeAssignmentId: 'old-run' } })
    expect(tasks.assignments[0]?.runtimeAssignmentId).toBeUndefined()
    expect(tasks.checkpoint?.compactedThroughSeq).toBe(4)
    expect(tasks.events?.[0]?.payload.sessionId).toBe(workerId)
    expect(tasks.attention).toHaveLength(1)
    expect(restored.executionPaused).toBe(true)
    if (restored.document.root.kind !== 'area') throw new Error('Expected Area')
    expect(restored.document.root.moduleHistory.map(page => page.binding?.sessionId)).toEqual([workerId, workerId])
    expect(restored.document.root.moduleHistory[0]?.state).toEqual({ resourceAddress: 'dsh-resource://file/session/' + workerId + '/result.txt' })
    expect(restored.document.root.moduleHistory[0]?.sessionStateOrder).toEqual([JSON.stringify([join(root, 'recipient', 'app'), workerId])])
    expect(await target.sessionPersistence.list()).toHaveLength(3)
    const restoredRepair = await recipient.prepareCreatorRepair({ workbenchId: 'complete-wb', moduleId: 'local.pomodoro' })
    expect(restoredRepair).toMatchObject({ registered: true, relativePath: repair.relativePath, sessionKey: repair.sessionKey })
    expect(restoredRepair.sessionId).not.toBe(repair.sessionId)
    const repairLog = await target.sessionPersistence.open(SessionId(restoredRepair.sessionId), 'read')
    try { expect(repairLog.header.cwd).toBe(join(root, 'recipient', repair.relativePath)); expect((await repairLog.read(0, 10)).events.some(event => event.type === 'user/message')).toBe(true) } finally { await repairLog.close() }
    const handle = await target.sessionPersistence.open(SessionId(workerId), 'read')
    try { expect(handle.header.cwd).toBe(join(root, 'recipient', 'app')); expect((await handle.read(0, 10)).events.filter(event => event.type === 'user/message')).toHaveLength(1) } finally { await handle.close() }
  } finally { await source.fiber.dispose(); await target.fiber.dispose() }
})
