import { describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { projectLayoutPackage, buildLayoutPackage, inspectLayoutPackage, restoreLayoutPackage } from '../src/foundation/workbench-layout-package.ts'
import { buildWorkbenchPackage, decodeDeterministicZip, decodeWorkbenchPackageArchive, encodeDeterministicZip, sha256Hex } from '../src/foundation/workbench-sharing.ts'
import { buildWorkbenchInventory } from '../src/foundation/workbench-inventory.ts'
import { WORKBENCH_DSH_GENERATION } from '../src/release-compatibility.ts'
import { createWorkbenchLayoutPackageService } from '../src/foundation/layout-package-service.ts'
import { createProjectNeutralFrameSettings } from '../src/foundation/frame-settings-adapter.ts'
import { createHostLayoutImportJournal } from '../src/host-layout-import-journal.ts'
import { areasOf } from '../src/foundation/document-v3.ts'
import { mutableSettings, settingsFixture } from './settings-fixtures.ts'
import type { WorkbenchEditorCatalogRow } from '../src/foundation/catalog.ts'
import type { LayoutImportReceiptV2 } from '../src/layout-import-journal.ts'
import { createAreaContext, createWorkbenchContext } from '../src/foundation/workbench-context.ts'

const descriptor: WorkbenchEditorCatalogRow = { id: 'example.notes', scope: 'root', label: '笔记',
  declaration: { editorId: 'example.notes', scope: 'root', label: '笔记', requiredBinding: 'none', state: { schemaVersion: 1, maxBytes: 4096, share: 'portable', restore: 'if-valid' }, runtime: { background: 'keep', collapsed: 'keep', reacquire: 'on-visible' } },
  portability: { version: 1, exportState: () => ({ color: 'blue' }), importState: value => value } }
const fixture = () => projectLayoutPackage({ ...settingsFixture().workbenches.a!, tags: ['开发'] }, [descriptor])
const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value))
async function alter(bytes: Uint8Array, transform: (manifest: any, layout: any) => void) {
  const files = decodeDeterministicZip(bytes)
  const manifest = JSON.parse(new TextDecoder().decode(files[0]!.content))
  const layout = JSON.parse(new TextDecoder().decode(files[1]!.content))
  transform(manifest, layout)
  const content = encode(layout)
  manifest.files = [{ path: 'workbench.json', size: content.length, sha256: await sha256Hex(content) }]
  return encodeDeterministicZip([{ path: 'manifest.json', content: encode(manifest) }, { path: 'workbench.json', content }])
}
describe('layout sharing manifest v3 / portable layout v2', () => {
  it('restores distinct sources independently while mapping multiple views of one source once', async () => {
    const record = structuredClone(settingsFixture().workbenches.a!)
    const area = areasOf(record.document.root)[0]!
    area.moduleHistory = ['one', 'two', 'one'].map((sessionId, index) => ({ moduleInstanceId: 'view-' + index, editorId: 'workbench.conversation', editorScope: 'session', binding: { sessionId }, lastKnownTitle: 'Conversation', state: {} }))
    area.activeModuleInstanceId = 'view-0'
    const projected = projectLayoutPackage(record, [])
    const checked = await inspectLayoutPackage(await buildLayoutPackage(projected))
    const bindings = areasOf(checked.layout.document.root)[0]!.moduleHistory.map(page => page.pendingBinding)
    expect(bindings[0]).toBe(bindings[2]); expect(bindings[0]).not.toBe(bindings[1])
    const restored = restoreLayoutPackage(checked.layout, [], { [bindings[0]!]: { sessionId: 'local-one' }, [bindings[1]!]: { sessionId: 'local-two' } })
    expect(areasOf(restored.document.root)[0]!.moduleHistory.map(page => page.binding?.sessionId)).toEqual(['local-one', 'local-two', 'local-one'])
    expect(areasOf(restored.document.root)[0]!.areaBinding).toBeUndefined()
  })
  it('exports backgrounds without Bay Main or runtime identities and restores a fresh local Workbench', async () => {
    const record = structuredClone(settingsFixture().workbenches.a!)
    record.bayAgentSession = { sessionId: 'private-bay-main', workspaceId: 'private-main-project', createdAt: 1, updatedAt: 2 }
    record.context = createWorkbenchContext(); record.context.human.goal = 'Portable goal'
    const projected = projectLayoutPackage(record, [descriptor])
    const files = decodeDeterministicZip(await buildLayoutPackage(projected))
    const payload = files.map(file => new TextDecoder().decode(file.content)).join('\n')
    expect(payload).not.toContain('private-bay-main')
    expect(payload).not.toContain('private-main-project')
    expect(payload).not.toContain('bayAgentSession')
    expect(files.every(file => !/journal|runtime|assignment/i.test(file.path))).toBe(true)
    const restored = restoreLayoutPackage(projected, [descriptor])
    expect(restored.context?.context.human.goal).toBe('Portable goal')
    expect(restored).not.toHaveProperty('bayAgentSession')
  })
  it('does not include the local Workbench layout lock preference in a shared layout package', () => {
    const record = { ...settingsFixture().workbenches.a!, layoutLocked: true }
    const projected = projectLayoutPackage(record, [descriptor])
    expect(projected).not.toHaveProperty('layoutLocked')
  })
  it('exports only detached Bay Agent orchestration history', async () => {
    const record = structuredClone(settingsFixture().workbenches.a!)
    record.bayAgentOrchestration = { schemaVersion: 1, currentEventSeq: 1, events: [{ schemaVersion: 1, eventId: 'event-1', seq: 1, kind: 'assignment.report', createdAt: 1, source: 'runtime', payload: { workItemId: 'work-item-1', assignmentId: 'assignment-1', summary: 'ready' } }], checkpoint: { schemaVersion: 1, compactedThroughSeq: 0, compactedAt: 1, retainedEventCount: 1, countsByKind: {}, summary: 'none' } }
    const projected = projectLayoutPackage(record, [descriptor])
    const bytes = await buildLayoutPackage(projected)
    const files = decodeDeterministicZip(bytes)
    expect(files.some(file => file.path === 'orchestration.json')).toBe(true)
    const payload = files.map(file => new TextDecoder().decode(file.content)).join('\n')
    expect((await inspectLayoutPackage(bytes)).layout.orchestration?.events[0]?.payload).toMatchObject({ workItemId: 'work-item-1', assignmentId: 'assignment-1' })
    expect(restoreLayoutPackage(projected, [descriptor]).orchestration?.currentEventSeq).toBe(1)
  })
  it('exports human Context and restores it with fresh local Area ids and user ownership', () => {
    const record = structuredClone(settingsFixture().workbenches.a!)
    const workbenchContext = createWorkbenchContext()
    workbenchContext.human.goal = '迁移后的工作台目标'
    const areaContext = createAreaContext()
    areaContext.human.objective = '迁移后的区域目标'
    record.context = workbenchContext
    record.areaContexts = { 'area-a': areaContext }
    record.areaMetadata = { 'area-a': { label: '源区域', ownership: 'superagent-managed', createdAt: 1, updatedAt: 1 } }
    const projected = projectLayoutPackage(record, [descriptor])
    expect(projected.context?.workbench.human.goal).toBe('迁移后的工作台目标')
    expect(projected.context?.areas['area-1']?.sourceOwnership).toBe('superagent-managed')
    const restored = restoreLayoutPackage(projected, [descriptor])
    expect(restored.context?.context.human.goal).toBe('迁移后的工作台目标')
    const localAreaId = areasOf(restored.document.root)[0]!.areaId
    expect(restored.context?.areaContexts[localAreaId]?.human.objective).toBe('迁移后的区域目标')
    expect(restored.context?.areaMetadata[localAreaId]?.ownership).toBe('user-owned')
  })
  it('includes Context JSON and Markdown projections in complete package exports', async () => {
    const record = structuredClone(settingsFixture().workbenches.a!)
    const context = createWorkbenchContext(); context.human.goal = '完整包目标'; record.context = context
    const areaContext = createAreaContext(); areaContext.human.objective = '完整包区域目标'; record.areaContexts = { 'area-a': areaContext }
    record.bayAgentOrchestration = { schemaVersion: 1, currentEventSeq: 1, events: [{ schemaVersion: 1, eventId: 'event-1', seq: 1, kind: 'work-item.created', createdAt: 1, source: 'bay-agent', payload: { workItemId: 'work-item-1' } }] }
    const packageValue = await buildWorkbenchPackage({
      packageId: 'local.a', name: record.name, description: record.description, version: '0.0.0-test', createdAt: new Date(record.createdAt).toISOString(),
      document: record.document, inventory: buildWorkbenchInventory(record.document, [descriptor]), editors: [descriptor],
      compatibility: { dsh: { minimum: WORKBENCH_DSH_GENERATION }, targets: ['web'] },
      workbenchContext: record.context, areaContexts: record.areaContexts, bayAgentOrchestration: record.bayAgentOrchestration, contextPolicy: 'human',
    })
    expect(packageValue.manifest.contextPath).toBe('context.json')
    expect(packageValue.manifest.orchestrationPath).toBe('orchestration.json')
    expect(packageValue.files.some(file => file.path === 'context/工作台整体背景说明.md')).toBe(true)
    expect(packageValue.files.some(file => file.path === 'context/areas/area-1-区域说明.md')).toBe(true)
    const decoded = await decodeWorkbenchPackageArchive(await (async () => {
      const manifest = { path: 'manifest.json', content: new TextEncoder().encode(JSON.stringify(packageValue.manifest)) }
      return encodeDeterministicZip([manifest, ...packageValue.files])
    })())
    expect(decoded.manifest.contextDigest).toMatch(/^[A-Fa-f0-9]{64}$/u)
    expect(decoded.files.some(file => file.path === 'context.json')).toBe(true)
  })
  it('exports layout-only Context as schema 3 files and rejects Context tampering', async () => {
    const record = structuredClone(settingsFixture().workbenches.a!)
    const context = createWorkbenchContext(); context.human.goal = '布局包工作台目标'; record.context = context
    const areaContext = createAreaContext(); areaContext.human.objective = '布局包区域目标'; record.areaContexts = { 'area-a': areaContext }
    const layout = projectLayoutPackage(record, [descriptor])
    expect(layout.schemaVersion).toBe(3)
    const bytes = await buildLayoutPackage(layout)
    const entries = [...decodeDeterministicZip(bytes)]
    expect(entries.map(entry => entry.path)).toEqual(expect.arrayContaining(['manifest.json', 'workbench.json', 'context.json', 'context/工作台整体背景说明.md', 'context/areas/area-1-区域说明.md']))
    const manifest = JSON.parse(new TextDecoder().decode(entries.find(entry => entry.path === 'manifest.json')!.content))
    expect(manifest.compatibility.portableLayout).toBe(3)
    expect(await inspectLayoutPackage(bytes)).toMatchObject({ layout: { schemaVersion: 3 } })
    const contextEntry = entries.find(entry => entry.path === 'context.json')!
    const tampered = encodeDeterministicZip(entries.map(entry => entry.path === contextEntry.path ? { ...entry, content: encode({ ...JSON.parse(new TextDecoder().decode(entry.content)), workbench: { ...JSON.parse(new TextDecoder().decode(entry.content)).workbench, human: { ...JSON.parse(new TextDecoder().decode(entry.content)).workbench.human, goal: 'tampered' } } }) } : entry))
    await expect(inspectLayoutPackage(tampered)).rejects.toThrow()
  })

  it('preserves all tabs, current tab, order and tags without local session state', async () => {
    const bytes = await buildLayoutPackage(fixture())
    const preview = await inspectLayoutPackage(bytes)
    expect(preview.layout.schemaVersion).toBe(2)
    const area = areasOf(preview.layout.document.root)[0]!
    expect(area.moduleHistory.map(page => page.editorId)).toEqual(['example.notes', 'workbench.conversation'])
    expect(area.activeModuleInstanceId).toBe(area.moduleHistory[1]!.moduleInstanceId)
    expect(preview.layout.tags).toEqual(['开发'])
    expect(JSON.stringify(preview.layout)).not.toContain('private-session')
    expect(JSON.stringify(preview.layout)).not.toContain('私密对话')
    expect(preview.layout.warnings).toHaveLength(1)
  })
  it('rejects layout packages from the previous 18.x candidate', async () => {
    const bytes = await buildLayoutPackage(fixture())
    const files = decodeDeterministicZip(bytes).map(file => {
      if (file.path !== 'manifest.json') return file
      const manifest = JSON.parse(new TextDecoder().decode(file.content))
      manifest.compatibility.core = '0.2.2-alpha.18.0'
      return { ...file, content: encode(manifest) }
    })
    await expect(inspectLayoutPackage(encodeDeterministicZip(files))).rejects.toThrow()
  })
  it('rejects an RC1 layout archive even when its portable schema and file digests are valid', async () => {
    const bytes = await alter(await buildLayoutPackage(fixture()), manifest => {
      manifest.compatibility.dsh = '0.2.2-rc.1'
    })
    await expect(inspectLayoutPackage(bytes)).rejects.toThrow()
  })
  it('allocates fresh local identities and leaves session pages pending without fake sessions', () => {
    const a = restoreLayoutPackage(fixture(), [descriptor]); const b = restoreLayoutPackage(fixture(), [descriptor])
    expect(a.document.activeAreaId).not.toBe(b.document.activeAreaId)
    const area = areasOf(a.document.root)[0]!
    expect(area.moduleHistory[0]!.state).toEqual({ color: 'blue' })
    expect(area.moduleHistory[1]!.binding).toBeUndefined()
    expect(area.moduleHistory[1]!.pendingBinding).toBe('binding-1')
    expect(areasOf(b.document.root)[0]!.moduleHistory[0]!.moduleInstanceId).not.toBe(area.moduleHistory[0]!.moduleInstanceId)
  })
  it('rebinds only explicitly selected recipient-local sessions', () => {
    const layout = fixture()
    const restored = restoreLayoutPackage(layout, [descriptor], { 'binding-1': { sessionId: 'recipient' } })
    const page = areasOf(restored.document.root)[0]!.moduleHistory[1]!
    expect(page.binding).toEqual({ sessionId: 'recipient' }); expect(page.pendingBinding).toBeUndefined()
    expect(areasOf(restored.document.root)[0]!.moduleHistory[0]!.binding).toBeUndefined()
  })
  it('uses references when portability processors are absent or fail; never restores raw unknown state', () => {
    const layout = fixture()
    expect(areasOf(restoreLayoutPackage(layout, []).document.root)[0]!.moduleHistory[0]!.state).toEqual({})
    const throwing = { ...descriptor, portability: { version: 1 as const, exportState() { throw new Error('failed') } } }
    const safe = projectLayoutPackage(settingsFixture().workbenches.a!, [throwing])
    expect(areasOf(safe.document.root)[0]!.moduleHistory[0]!.state).toEqual({})
    expect(safe.warnings.some(warning => warning.includes('投影失败'))).toBe(true)
  })
  it('blocks private fields and absolute paths even if an extension calls its state portable', () => {
    for (const state of [{ token: 'secret' }, { path: 'C:\\Users\\private\\file' }, { deep: { sessionId: 'hidden' } }]) {
      const layout = projectLayoutPackage(settingsFixture().workbenches.a!, [{ ...descriptor, portability: { version: 1, exportState: () => state } }])
      expect(areasOf(layout.document.root)[0]!.moduleHistory[0]!.state).toEqual({})
    }
  })
  it.each(['protocol', 'generation', 'core', 'size', 'duplicate', 'credentials', 'depth'])('rejects invalid package: %s', async kind => {
    const bytes = await alter(await buildLayoutPackage(fixture()), (manifest, layout) => {
      if (kind === 'protocol') manifest.compatibility.portableLayout = 99
      if (kind === 'generation') manifest.compatibility.dsh = '0.2.1-rc.2'
      if (kind === 'core') manifest.compatibility.core = '0.2.2-alpha.13'
      if (kind === 'size') layout.document.root.moduleHistory[0].state = { text: 'x'.repeat(300000) }
      if (kind === 'duplicate') layout.document.root.moduleHistory[1].moduleInstanceId = layout.document.root.moduleHistory[0].moduleInstanceId
      if (kind === 'credentials') layout.document.root.moduleHistory[0].state = { credentials: 'secret' }
      if (kind === 'depth') { let node: any = layout.document.root; for (let i = 0; i < 18; i++) node = { kind: 'split', id: `s${i}`, axis: 'horizontal', ratio: .5, first: node, second: structuredClone(layout.document.root) }; layout.document.root = node }
    })
    await expect(inspectLayoutPackage(bytes)).rejects.toThrow()
  })
  it('rejects damaged digests, undeclared payloads and raw diagnostic JSON', async () => {
    const files = [...decodeDeterministicZip(await buildLayoutPackage(fixture()))]
    files[1] = { path: 'workbench.json', content: encode({ bad: true }) }
    await expect(inspectLayoutPackage(encodeDeterministicZip(files))).rejects.toThrow('摘要')
    await expect(inspectLayoutPackage(encode(settingsFixture()))).rejects.toThrow()
    expect(() => encodeDeterministicZip([{ path: '../escape', content: encode({}) }])).toThrow()
  })
})

describe('layout-only import service and private journal', () => {
  function setup() {
    const { source, writes } = mutableSettings()
    const { directory } = createProjectNeutralFrameSettings(source)
    const receipts: LayoutImportReceiptV2[] = []
    const journal = { list: async () => structuredClone(receipts), save: async (row: LayoutImportReceiptV2) => { const index = receipts.findIndex(item => item.transactionId === row.transactionId); if (index >= 0) receipts.splice(index, 1); receipts.push(structuredClone(row)); return row } }
    const service = createWorkbenchLayoutPackageService({ settings: source, directory, journal, editors: { getSnapshot: () => [descriptor], subscribe: () => () => {} }, canImport: () => true, canExport: () => true })
    return { source, writes, service, receipts, directory }
  }
  it('adds one inactive Workbench for a duplicate submission without switching or creating sessions', async () => {
    const { source, service, writes, receipts } = setup()
    const preview = await service.inspect(await buildLayoutPackage(fixture()))
    const transactionId = `layout-import-${crypto.randomUUID()}`
    const [a, b] = await Promise.all([service.import(preview, transactionId), service.import(preview, transactionId)])
    expect(a.workbenchId).toBe(b.workbenchId)
    expect(source.getSnapshot().value?.activeWorkbenchId).toBe('a')
    expect(source.getSnapshot().value?.openWorkbenchIds).toEqual(['a'])
    expect(Object.keys(source.getSnapshot().value!.workbenches)).toHaveLength(3)
    expect(writes).toHaveLength(1); expect(receipts[0]?.state).toBe('completed')
    await service.import(preview, transactionId)
    expect(writes).toHaveLength(1)
    await service.import(preview, `layout-import-${crypto.randomUUID()}`)
    expect(Object.keys(source.getSnapshot().value!.workbenches)).toHaveLength(4)
  })
  it('stops export if flush fails and listing records does not write settings', async () => {
    const { service, directory, writes } = setup()
    directory.setBeforeLifecycleTransition!(async () => false)
    await expect(service.export('a')).rejects.toThrow('尚未保存')
    await service.history(); expect(writes).toEqual([])
  })
  it('never runs a forged preview or imports from a browser-scoped service', async () => {
    const { service, source, directory } = setup()
    await expect(service.import({ digest: 'a'.repeat(64), layout: fixture(), warnings: [], legacy: false }, `layout-import-${crypto.randomUUID()}`)).rejects.toThrow('先校验')
    const restricted = createWorkbenchLayoutPackageService({ settings: source, directory, editors: { getSnapshot: () => [], subscribe: () => () => {} }, journal: { list: vi.fn(), save: vi.fn() }, canImport: () => false, canExport: id => id === 'a' })
    await expect(restricted.export('b')).rejects.toThrow('收回')
    expect(await restricted.history()).toEqual([])
    await expect(restricted.import(await service.inspect(await buildLayoutPackage(fixture())), `layout-import-${crypto.randomUUID()}`)).rejects.toThrow('桌面端')
  })
  it('writes a separate versioned journal and prevents completed transaction rollback', () => {
    const root = mkdtempSync(join(tmpdir(), 'wb-settings-'))
    try {
      const store = createHostLayoutImportJournal(root)
      const row: LayoutImportReceiptV2 = { schemaVersion: 2, transactionId: `layout-import-${crypto.randomUUID()}`, archiveSha256: 'a'.repeat(64), workbenchId: `workbench-${crypto.randomUUID()}`, name: 'Imported', createdAt: 1, state: 'prepared' }
      store.save(row); store.save({ ...row, state: 'completed' }); store.save(row)
      expect(store.list()).toEqual([{ ...row, state: 'completed' }])
      expect(() => store.save({ ...row, archiveSha256: 'b'.repeat(64) })).toThrow('transaction-conflict')
      expect(createHostLayoutImportJournal(root).list()).toHaveLength(1)
    } finally { rmSync(root, { recursive: true, force: true }) }
  })
})
