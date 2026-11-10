import { describe, expect, it, vi } from 'vitest'
import type { SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import { createProjectNeutralFrameSettings, type PatchableV4Scope } from '../src/foundation/frame-settings-adapter.ts'
import { decodeWorkbenchSettingsV4, type WorkbenchSettingsV4 } from '../src/foundation/persistence.ts'
import { areasOf, migrateDocumentV2ToV3 } from '../src/foundation/document-v3.ts'
import { defaultLayout } from '../src/foundation/model.ts'

function fixture() {
  const record = (id: string) => ({ workbenchId: id, name: id, description: '', tags: ['old'],
    document: migrateDocumentV2ToV3(defaultLayout()), createdAt: 1, updatedAt: 1 })
  let snapshot: SettingsScopeSnapshot<WorkbenchSettingsV4> = {
    status: 'ready', writable: true, mode: 'host', revision: 1, base: {}, user: {},
    value: { version: 4, activeWorkbenchId: 'main', openWorkbenchIds: ['main'],
      workbenches: { main: record('main'), other: record('other') },
      layoutTemplates: {}, invalidWorkbenches: {}, sessionMarkers: {} },
  }
  const patch: PatchableV4Scope['patch'] = vi.fn(async operation => {
    if (operation.expectedRevision !== snapshot.revision) return { status: 'conflict', expectedRevision: operation.expectedRevision, actualRevision: snapshot.revision }
    if (operation.operation !== 'set' || operation.path.length !== 0) throw new Error('Expected an atomic directory update')
    snapshot = { ...snapshot, value: operation.value as WorkbenchSettingsV4, revision: snapshot.revision! + 1 }
    return { status: 'committed', revision: snapshot.revision! }
  })
  const source: PatchableV4Scope = { getSnapshot: () => snapshot, subscribe: () => () => {},
    set: async () => {}, unset: async () => {}, patch }
  return { source, patch: vi.mocked(patch), ...createProjectNeutralFrameSettings(source),
    value: () => snapshot.value!, reload: () => { snapshot = { ...snapshot, value: decodeWorkbenchSettingsV4(snapshot.value) } } }
}

describe('Core directory data protection', () => {
  it('retries the identical creation payload after a committed directory fails to initialize', async () => {
    const f = fixture()
    const createFileWorkbench = vi.fn(async (input: { record: import('../src/foundation/persistence.ts').WorkbenchRecordV2 }) => {
      const current = f.source.getSnapshot()
      await f.source.patch!({ operation: 'set', path: [], value: { ...current.value!, workbenches: { ...current.value!.workbenches, [input.record.workbenchId]: input.record } }, expectedRevision: current.revision })
      if (createFileWorkbench.mock.calls.length === 1) throw new Error('Main initialization interrupted')
      return { status: 'committed' as const, workbenchId: input.record.workbenchId, revision: f.source.getSnapshot().revision! }
    })
    const adapter = createProjectNeutralFrameSettings(f.source, { createFileWorkbench })
    const input = { requestId: 'create-retry', name: '研发工作台', parentPath: 'C:/Projects', folderName: 'product', layoutPresetId: 'columns' as const }
    await expect(adapter.directory.create(input)).rejects.toThrow('Main initialization interrupted')
    expect(f.value().workbenches['workbench-create-retry']).toBeDefined()
    expect(await adapter.directory.create(input)).toMatchObject({ status: 'committed', workbenchId: 'workbench-create-retry' })
    expect(createFileWorkbench).toHaveBeenCalledTimes(2)
    expect(createFileWorkbench.mock.calls[1]![0]).toEqual(createFileWorkbench.mock.calls[0]![0])
    expect(await adapter.directory.create({ ...input, requestId: 'different-create' })).toMatchObject({ status: 'rejected', reason: 'duplicate-name' })
  })
  it('commits a preset and its modules atomically, preserving old layouts and CAS safety', async () => {
    const f = fixture(), before = structuredClone(f.value())
    const request = { name: '预设工作台', layoutPresetId: 'four-grid' as const, areaEditors: [null, { editorId: 'test.session', scope: 'session' as const, label: '会话内页' }, null, { editorId: 'test.root', scope: 'root' as const, label: '全局内页' }] }
    f.patch.mockResolvedValueOnce({ status: 'conflict', expectedRevision: 1, actualRevision: 2 })
    expect(await f.directory.create(request)).toMatchObject({ status: 'conflict' })
    expect(f.value()).toEqual(before)
    const result = await f.directory.create(request)
    expect(result).toMatchObject({ status: 'committed' })
    if (result.status !== 'committed' || !('workbenchId' in result)) throw new Error('Creation failed')
    const id = result.workbenchId
    expect(f.value().activeWorkbenchId).toBe(id)
    expect(f.value().openWorkbenchIds).toEqual(['main', id])
    expect(f.value().workbenches.main).toEqual(before.workbenches.main)
    expect(areasOf(f.value().workbenches[id]!.document.root).map(area => area.moduleHistory[0]?.editorId)).toEqual([undefined, 'test.session', undefined, 'test.root'])
    f.reload()
    expect(areasOf(f.value().workbenches[id]!.document.root)).toHaveLength(4)
    const writes = f.patch.mock.calls.length
    expect(await f.directory.create({ layoutPresetId: 'single', areaEditors: [null, null] })).toMatchObject({ status: 'rejected', reason: 'invalid-preset' })
    expect(await f.directory.create({ templateId: 'other', layoutPresetId: 'single' })).toMatchObject({ status: 'rejected', reason: 'invalid-preset' })
    expect(f.patch).toHaveBeenCalledTimes(writes)
  })

  it('reorders open Workbench ids without changing the active Workbench', async () => {
    const f = fixture()
    await f.directory.openAndSelect('other')
    expect(f.value().openWorkbenchIds).toEqual(['main', 'other'])
    expect(f.value().activeWorkbenchId).toBe('other')
    expect(await f.directory.reorder!('other', 0)).toMatchObject({ status: 'committed' })
    expect(f.value().openWorkbenchIds).toEqual(['other', 'main'])
    expect(f.value().activeWorkbenchId).toBe('other')
    f.reload()
    expect(f.directory.getSnapshot().openWorkbenchIds).toEqual(['other', 'main'])
  })

  it('reads a non-active document and unloads it without changing the active Workbench', async () => {
    const f = fixture()
    const document = f.directory.getDocument?.('other')
    expect(document).toEqual(f.value().workbenches.other?.document)
    expect(document).not.toBe(f.value().workbenches.other?.document)
    await f.directory.openAndSelect('other')
    await f.directory.select('main')
    expect(await f.directory.unload('other')).toMatchObject({ status: 'committed' })
    expect(f.value().activeWorkbenchId).toBe('main')
    expect(f.value().openWorkbenchIds).toEqual(['main'])
  })

  it('unloads the last open Workbench into the persisted Home state', async () => {
    const f = fixture()
    expect(await f.directory.unload('main')).toMatchObject({ status: 'committed' })
    expect(f.value().activeWorkbenchId).toBe('main')
    expect(f.value().openWorkbenchIds).toEqual([])
    expect(await f.directory.openAndSelect('main')).toMatchObject({ status: 'committed' })
    expect(f.value().openWorkbenchIds).toEqual(['main'])
  })

  it('keeps an empty open list and chooses a recent runnable reference for invalid Home active ids', () => {
    const value = fixture().value()
    value.workbenches.other = { ...value.workbenches.other!, updatedAt: 2 }
    const decoded = decodeWorkbenchSettingsV4({ ...value, activeWorkbenchId: '', openWorkbenchIds: [] })
    expect(decoded?.openWorkbenchIds).toEqual([])
    expect(decoded?.activeWorkbenchId).toBe('other')
    const empty = decodeWorkbenchSettingsV4({ ...value, activeWorkbenchId: '', openWorkbenchIds: [], workbenches: {} })
    expect(empty?.openWorkbenchIds).toEqual([])
    expect(empty?.activeWorkbenchId).toBe('')
  })

  it('pins a companion view while the main window selects another workbench', async () => {
    const f = fixture()
    const companion = createProjectNeutralFrameSettings(f.source, { workbenchId: 'main' })
    const before = companion.settings.getSnapshot().value
    expect(await f.directory.openAndSelect('other')).toMatchObject({ status: 'committed' })
    expect(f.value().activeWorkbenchId).toBe('other')
    expect(companion.directory.getSnapshot().activeWorkbenchId).toBe('main')
    expect(companion.settings.getSnapshot().value).toEqual(before)
    expect(await companion.directory.select('other')).toEqual({ status: 'unavailable' })
    expect(await companion.directory.create()).toEqual({ status: 'unavailable' })
    expect(f.value().activeWorkbenchId).toBe('other')
  })

  it('addresses companion layout writes to the pinned record using the original CAS', async () => {
    const f = fixture()
    const companion = createProjectNeutralFrameSettings(f.source, { workbenchId: 'other' })
    const document = defaultLayout()
    f.patch.mockResolvedValueOnce({ status: 'committed', revision: 2 })
    await expect(companion.settings.patch({ operation: 'set', path: ['layouts', 'ungrouped'], value: document, expectedRevision: 1 }))
      .resolves.toEqual({ status: 'committed', revision: 2 })
    expect(f.patch).toHaveBeenLastCalledWith(expect.objectContaining({ path: ['workbenches', 'other'], expectedRevision: 1 }))
    expect(f.value().activeWorkbenchId).toBe('main')
  })

  it('clears existing tags and preserves the layout after decoding the saved record', async () => {
    const f = fixture(), document = structuredClone(f.value().workbenches.main!.document)
    expect(await f.directory.updateMetadata('main', { name: 'main', description: 'edited', tags: [] })).toMatchObject({ status: 'committed' })
    f.reload()
    expect(f.value().workbenches.main?.tags ?? []).toEqual([])
    expect(f.value().workbenches.main?.document).toEqual(document)
  })

  it('archives the last workbench into Home and can restore and delete it', async () => {
    const f = fixture()
    expect(await f.directory.remove('other')).toMatchObject({ status: 'committed' })
    expect(await f.directory.archive('main')).toMatchObject({ status: 'committed' })
    f.reload()
    expect(f.value().openWorkbenchIds).toEqual([])
    expect(f.value().activeWorkbenchId).toBe('')
    expect(f.value().workbenches.main?.archivedAt).toBeDefined()
    expect(Object.keys(f.value().workbenches)).toEqual(['main'])
    expect(f.value().workbenches.other).toBeUndefined()
    expect(await f.directory.restore('main')).toMatchObject({ status: 'committed' })
    expect(await f.directory.openAndSelect('main')).toMatchObject({ status: 'committed' })
    expect(await f.directory.remove('main')).toMatchObject({ status: 'committed' })
    f.reload()
    expect(f.value().workbenches).toEqual({})
    expect(f.value().activeWorkbenchId).toBe('')
    expect(f.value().openWorkbenchIds).toEqual([])
    expect(await f.directory.create({ name: '重新开始' })).toMatchObject({ status: 'committed' })
  })

  it('rechecks remaining records after an awaited layout flush without reopening archived workbenches', async () => {
    const f = fixture()
    let release!: (value: boolean) => void
    f.directory.setBeforeLifecycleTransition!(() => new Promise(resolve => { release = resolve }))
    const pending = f.directory.archive('main')
    await f.directory.archive('other')
    release(true)
    expect(await pending).toMatchObject({ status: 'committed' })
    f.reload()
    expect(f.value().activeWorkbenchId).toBe('')
    expect(f.value().openWorkbenchIds).toEqual([])
    expect(f.value().workbenches.main?.archivedAt).toBeDefined()
    expect(Object.keys(f.value().workbenches)).toEqual(['main', 'other'])
  })

  it('does not open a closed workbench when removing the only open one', async () => {
    const f = fixture()
    expect(await f.directory.remove('main')).toMatchObject({ status: 'committed' })
    expect(f.value().activeWorkbenchId).toBe('other')
    expect(f.value().openWorkbenchIds).toEqual([])
    f.reload()
    expect(f.value().openWorkbenchIds).toEqual([])
  })

  it('keeps the last record when flush or CAS fails during deletion', async () => {
    const f = fixture()
    await f.directory.remove('other')
    f.directory.setBeforeLifecycleTransition!(async () => false)
    expect(await f.directory.remove('main')).toEqual({ status: 'unavailable' })
    f.directory.setBeforeLifecycleTransition!(async () => true)
    f.patch.mockResolvedValueOnce({ status: 'conflict', expectedRevision: 2, actualRevision: 3 })
    expect(await f.directory.remove('main')).toMatchObject({ status: 'conflict' })
    expect(f.value().workbenches.main).toBeDefined()
    expect(f.value().openWorkbenchIds).toEqual(['main'])
  })

  it('does not open a workbench archived while the active layout was flushing', async () => {
    const f = fixture()
    let release!: (value: boolean) => void
    f.directory.setBeforeLifecycleTransition!(() => new Promise(resolve => { release = resolve }))
    const pending = f.directory.openAndSelect('other')
    await f.directory.archive('other')
    release(true)
    expect(await pending).toEqual({ status: 'rejected', reason: 'archived' })
    f.reload()
    expect(f.value().activeWorkbenchId).toBe('main')
  })

  it('retains incompatible records across directory mutations and reloads', async () => {
    const f = fixture()
    const rawRecord = { workbenchId: 'future', name: 'Future', description: '', document: { version: 99, custom: ['retained'] }, createdAt: 1, updatedAt: 1 }
    await f.source.patch({ operation: 'set', path: [], expectedRevision: 1,
      value: { ...f.value(), invalidWorkbenches: { future: { workbenchId: 'future', name: 'Future', description: '', rawRecord } } } })
    await f.directory.archive('future')
    await f.directory.rename('main', 'Renamed')
    f.reload()
    expect(f.value().invalidWorkbenches.future?.rawRecord).toEqual(rawRecord)
    await f.directory.restore('future')
    await f.directory.remove('future')
    f.reload()
    expect(f.value().invalidWorkbenches.future).toBeUndefined()
    expect(f.value().workbenches.main?.name).toBe('Renamed')
  })

  it('retains an incompatible active document and selects an existing runnable workbench', () => {
    const f = fixture(), value = structuredClone(f.value())
    const incompatible = { ...value.workbenches.main, document: { version: 99, future: ['keep'] } }
    const decoded = decodeWorkbenchSettingsV4({ ...value, workbenches: { ...value.workbenches, main: incompatible } })
    expect(decoded?.invalidWorkbenches.main?.rawRecord).toEqual(incompatible)
    expect(decoded?.activeWorkbenchId).toBe('other')
    expect(decoded?.openWorkbenchIds).toEqual(['other'])
    expect(decodeWorkbenchSettingsV4(decoded)?.invalidWorkbenches.main?.rawRecord).toEqual(incompatible)
  })

  it('creates a recovery workbench while retaining every incompatible record', () => {
    const f = fixture(), value = structuredClone(f.value())
    const incompatible = { ...value.workbenches.main, document: { version: 99, future: ['keep'] } }
    const decoded = decodeWorkbenchSettingsV4({ ...value, workbenches: { main: incompatible } })
    expect(decoded?.invalidWorkbenches.main?.rawRecord).toEqual(incompatible)
    expect(decoded?.activeWorkbenchId).not.toBe('main')
    expect(decoded?.workbenches[decoded.activeWorkbenchId]?.document.root).toMatchObject({ kind: 'area', moduleHistory: [] })
    expect(decodeWorkbenchSettingsV4(decoded)).toEqual(decoded)
  })

  it('keeps the valid active workbench when a different open workbench becomes incompatible', () => {
    const value = fixture().value()
    const decoded = decodeWorkbenchSettingsV4({ ...value, openWorkbenchIds: ['other', 'main', 'future'],
      workbenches: { ...value.workbenches, future: { document: { version: 99 } } } })
    expect(decoded?.activeWorkbenchId).toBe('main')
    expect(decoded?.openWorkbenchIds).toEqual(['other', 'main'])
    expect(decoded?.migrationRequired).toBe(true)
  })

  it('persists global picker preferences without deleting existing pages', async () => {
    const f = fixture(), before = structuredClone(f.value())
    expect(await f.directory.setEditorVisible!('main', 'workbench.conversation.start', false)).toMatchObject({ status: 'committed' })
    f.reload()
    expect(f.value().globalHiddenEditorIds).toEqual(['workbench.conversation.start'])
    expect(f.value().workbenches.main?.document).toEqual(before.workbenches.main?.document)
    expect(f.value().workbenches.other?.hiddenEditorIds).toEqual(before.workbenches.other?.hiddenEditorIds)
    expect(await f.directory.setEditorVisible!('main', 'workbench.conversation.start', true)).toMatchObject({ status: 'committed' })
    f.reload()
    expect(f.value().workbenches.main?.hiddenEditorIds ?? []).toEqual([])
  })

  it('applies the global picker preference to every workbench and new workbenches', async () => {
    const f = fixture()
    expect(await f.directory.setGlobalEditorVisible!('workbench.conversation', false)).toMatchObject({ status: 'committed' })
    expect(f.value().globalHiddenEditorIds).toEqual(['workbench.conversation'])
    expect(f.value().workbenches.main?.hiddenEditorIds).toBeUndefined()
    expect(f.value().workbenches.other?.hiddenEditorIds).toBeUndefined()
    await f.directory.create()
    const created = f.value().workbenches[f.value().activeWorkbenchId]
    expect(created?.hiddenEditorIds).toBeUndefined()
    expect(f.directory.getSnapshot().globalHiddenEditorIds).toEqual(['workbench.conversation'])
  })

  it('validates create metadata, rejects duplicate names, and returns the new id', async () => {
    const f = fixture()
    expect(await f.directory.create({ name: 'main' })).toEqual({ status: 'rejected', reason: 'duplicate-name' })
    expect(await f.directory.create({ name: '   ' })).toEqual({ status: 'rejected', reason: 'invalid-name' })
    const created = await f.directory.create({ name: '试用工作台', description: '团队试用', tags: ['试用', '试用'] })
    expect(created).toMatchObject({ status: 'committed', workbenchId: expect.stringMatching(/^workbench-/u) })
    const id = (created as { workbenchId: string }).workbenchId
    expect(f.value().workbenches[id]).toMatchObject({ name: '试用工作台', description: '团队试用', tags: ['试用'] })
    expect(f.value().openWorkbenchIds).toContain(id)
    expect(f.value().activeWorkbenchId).toBe(id)
  })

  it('initializes a V4 root atomically when creating from empty Settings', async () => {
    let snapshot: SettingsScopeSnapshot<WorkbenchSettingsV4> = {
      status: 'ready', writable: true, mode: 'host', revision: 4, base: {}, user: {}, value: undefined,
    }
    const patch: PatchableV4Scope['patch'] = vi.fn(async operation => {
      if (operation.operation !== 'set' || operation.path.length !== 0) throw new Error('Expected root initialization')
      snapshot = { ...snapshot, value: operation.value as WorkbenchSettingsV4, revision: 5 }
      return { status: 'committed', revision: 5 }
    })
    const source: PatchableV4Scope = { getSnapshot: () => snapshot, subscribe: () => () => {},
      set: async () => {}, unset: async () => {}, patch }
    const { directory } = createProjectNeutralFrameSettings(source)
    const result = await directory.create({ name: '第一个工作台', layoutPresetId: 'columns', areaEditors: [null, null] })
    expect(result).toMatchObject({ status: 'committed' })
    expect(snapshot.value?.version).toBe(4)
    expect(areasOf(Object.values(snapshot.value!.workbenches)[0]!.document.root)).toHaveLength(2)
    expect(snapshot.value?.openWorkbenchIds).toHaveLength(1)
    expect(snapshot.value?.activeWorkbenchId).toBe((result as { workbenchId: string }).workbenchId)
    expect(patch).toHaveBeenCalledOnce()
  })

  it('saves and revokes a Workbench-only extension opt-in with an atomic settings write', async () => {
    const f = fixture()
    const layouts = structuredClone(f.value().workbenches.main?.document)
    const consent = {
      packageName: '@example/pet', moduleId: 'example.pet', apiVersion: 1,
      editorIds: ['example.pet.page'],
      contractFingerprint: '0123456789abcdef0123456789abcdef',
    }
    expect(await f.directory.setExtensionAllowed!(consent, true)).toMatchObject({ status: 'committed' })
    f.reload()
    expect(f.value().extensionConsents?.['@example/pet::example.pet']).toMatchObject(consent)
    expect(f.value().workbenches.main?.document).toEqual(layouts)
    expect(f.value().workbenches.other?.document).toEqual(layouts)

    expect(await f.directory.setExtensionAllowed!(consent, false)).toMatchObject({ status: 'committed' })
    f.reload()
    expect(f.value().extensionConsents?.['@example/pet::example.pet']).toMatchObject({
      editorIds: ['example.pet.page'], allowed: false,
    })
    expect(f.value().workbenches.main?.document).toEqual(layouts)
  })

  it('leaves existing consent unchanged when the settings revision conflicts', async () => {
    const f = fixture()
    const before = structuredClone(f.value())
    f.patch.mockResolvedValueOnce({ status: 'conflict', expectedRevision: 1, actualRevision: 2 })
    expect(await f.directory.setExtensionAllowed!({
      packageName: '@example/pet', moduleId: 'example.pet', apiVersion: 1,
      editorIds: ['example.pet.page'],
      contractFingerprint: '0123456789abcdef0123456789abcdef',
    }, true)).toMatchObject({ status: 'conflict' })
    expect(f.value()).toEqual(before)
  })

  it('preserves tags when only renaming and reports revision conflicts without deleting', async () => {
    const f = fixture()
    await f.directory.rename('main', 'Renamed')
    expect(f.value().workbenches.main?.tags).toEqual(['old'])
    const before = structuredClone(f.value())
    f.patch.mockResolvedValueOnce({ status: 'conflict', expectedRevision: 2, actualRevision: 3 })
    expect(await f.directory.remove('other')).toMatchObject({ status: 'conflict' })
    expect(f.value()).toEqual(before)
  })

  it('reports unavailable on a failed write and allows a later retry without losing data', async () => {
    const f = fixture(), before = structuredClone(f.value())
    f.patch.mockRejectedValueOnce(new Error('connection lost'))
    expect(await f.directory.remove('other')).toEqual({ status: 'unavailable' })
    expect(f.value()).toEqual(before)
    expect(await f.directory.remove('other')).toMatchObject({ status: 'committed' })
    f.reload()
    expect(f.value().workbenches.main).toEqual(before.workbenches.main)
    expect(f.value().workbenches.other).toBeUndefined()
  })

  it('preserves the active workbench when flushing fails or rejects', async () => {
    const f = fixture(), before = structuredClone(f.value())
    f.directory.setBeforeLifecycleTransition!(async () => false)
    expect(await f.directory.unload('main')).toEqual({ status: 'unavailable' })
    f.directory.setBeforeLifecycleTransition!(async () => { throw new Error('save unavailable') })
    expect(await f.directory.archive('main')).toEqual({ status: 'unavailable' })
    expect(f.value()).toEqual(before)
    expect(f.patch).not.toHaveBeenCalled()
  })
})
