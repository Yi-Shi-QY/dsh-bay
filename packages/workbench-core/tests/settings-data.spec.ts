import { describe, expect, it } from 'vitest'
import { buildWorkbenchInventory } from '../src/foundation/workbench-inventory.ts'
import { decodeWorkbenchSettingsV4, type WorkbenchSettingsV4 } from '../src/foundation/persistence.ts'
import { createProjectNeutralFrameSettings } from '../src/foundation/frame-settings-adapter.ts'
import { WorkbenchControlPlane } from '../src/foundation/workbench-control-plane.ts'
import { scopeSettingsSnapshot, settingsTargetWritable } from '../src/foundation/settings-context.ts'
import { createWorkbenchSettingsScope, type SettingsScopeSnapshot, type SettingsScopePathOperation } from '../src/client/workbench-settings-contracts.ts'
import type { WorkbenchDocumentV3 } from '../src/foundation/document-v3.ts'

import { documentFixture, mutableSettings, settingsFixture } from './settings-fixtures.ts'

describe('settings data scope and persistence', () => {
  it('counts every retained page and marks exactly the current page', () => {
    const model = buildWorkbenchInventory(documentFixture(), [{ id: 'workbench.conversation', scope: 'session', label: '对话', pluginId: 'core' }])
    expect(model.pageCount).toBe(2); expect(model.missingPageCount).toBe(1)
    expect(model.areas[0]?.pages.map(page => page.active)).toEqual([false, true])
    expect(model.plugins.map(plugin => plugin.pageCount).reduce((a, b) => a + b, 0)).toBe(2)
  })
  it('migrates absent global preferences once while treating explicit [] as authoritative', () => {
    const value = settingsFixture(); value.workbenches.a!.hiddenEditorIds = ['example.notes']
    expect(decodeWorkbenchSettingsV4(value)?.globalHiddenEditorIds).toEqual([])
    delete value.globalHiddenEditorIds
    expect(decodeWorkbenchSettingsV4(value)?.globalHiddenEditorIds).toEqual(['example.notes'])
    const migrated = decodeWorkbenchSettingsV4(value)!
    migrated.globalHiddenEditorIds = []
    expect(decodeWorkbenchSettingsV4(migrated)?.globalHiddenEditorIds).toEqual([])
  })
  it('reads a missing layout lock as unlocked and rejects malformed lock preferences', () => {
    const value = settingsFixture()
    expect(value.workbenches.a?.layoutLocked).toBeUndefined()
    const decoded = decodeWorkbenchSettingsV4(value)
    expect(decoded?.workbenches.a?.layoutLocked).toBeUndefined()

    value.workbenches.a!.layoutLocked = true
    expect(decodeWorkbenchSettingsV4(value)?.workbenches.a?.layoutLocked).toBe(true)
    value.workbenches.a!.layoutLocked = 'locked' as never
    expect(decodeWorkbenchSettingsV4(value)?.invalidWorkbenches.a).toBeDefined()
  })
  it('persists Workbench layout lock changes without changing modification time', async () => {
    const { source, writes } = mutableSettings()
    const { directory, settings } = createProjectNeutralFrameSettings(source)
    expect(await directory.setLayoutLocked?.('a', true)).toMatchObject({ status: 'committed' })
    expect(source.getSnapshot().value?.workbenches.a?.layoutLocked).toBe(true)
    expect(source.getSnapshot().value?.workbenches.a?.updatedAt).toBe(2)
    expect(await directory.setLayoutLocked?.('a', false)).toMatchObject({ status: 'committed' })
    expect(source.getSnapshot().value?.workbenches.a?.layoutLocked).toBeUndefined()
    expect(writes).toHaveLength(2)

    await directory.setLayoutLocked?.('a', true)
    const replacement = { version: 2 as const, root: { kind: 'group' as const, id: 'replacement-area', tabs: [] }, activeGroupId: 'replacement-area' }
    expect(await settings.patch({ operation: 'set', path: ['layouts', 'ungrouped'], value: replacement })).toMatchObject({ status: 'committed' })
    expect(source.getSnapshot().value?.workbenches.a?.layoutLocked).toBe(true)
  })
  it('changes global entry visibility without rewriting documents or modified dates', async () => {
    const { source, writes } = mutableSettings()
    const { directory } = createProjectNeutralFrameSettings(source)
    const before = structuredClone(source.getSnapshot().value?.workbenches)
    expect(await directory.setGlobalEditorVisible?.('example.notes', false)).toMatchObject({ status: 'committed' })
    expect(writes).toHaveLength(1)
    expect(source.getSnapshot().value?.globalHiddenEditorIds).toEqual(['example.notes'])
    expect(source.getSnapshot().value?.workbenches).toEqual(before)
  })
  it('limits browser directory reads and writes to its target', async () => {
    const initial = settingsFixture()
    initial.extensionConsents = {
      '@example/ins::example.ins': {
        packageName: '@example/ins', moduleId: 'example.ins', apiVersion: 1,
        editorIds: ['example.ins.page'], contractFingerprint: 'a'.repeat(32), allowedAt: 10, allowed: true,
      },
    }
    const { source, writes } = mutableSettings(initial)
    const { directory } = createProjectNeutralFrameSettings(source, { workbenchId: 'a' })
    expect(directory.getSnapshot().rows.map(row => row.workbenchId)).toEqual(['a'])
    expect(directory.getDocument?.('b')).toBeUndefined()
    expect(directory.getSnapshot().templates).toEqual([])
    expect(await directory.setLayoutLocked?.('b', true)).toMatchObject({ status: 'unavailable' })
    for (const result of await Promise.all([directory.updateMetadata('b', { name: 'bad', description: '' }), directory.remove('a'), directory.setPinned('a', true), directory.setGlobalEditorVisible!('example.notes', false)])) expect(result.status).toBe('unavailable')
    expect(writes).toEqual([])
    const scoped = scopeSettingsSnapshot(source.getSnapshot(), { mode: 'browser-workbench', workbenchId: 'a' })
    expect(Object.keys(scoped.value!.workbenches)).toEqual(['a']); expect(scoped.base).toBeUndefined()
    expect(scoped.value!.extensionConsents?.['@example/ins::example.ins']).toMatchObject({ allowed: true })
  })
  it('rechecks the selected target at the operation boundary', async () => {
    const { source } = mutableSettings()
    let browserOwned = true
    const { directory } = createProjectNeutralFrameSettings(source, { isBrowserOwned: id => id === 'a' && browserOwned })
    expect((await directory.updateMetadata('a', { name: 'Blocked', description: '' })).status).toBe('unavailable')
    expect((await directory.setLayoutLocked?.('a', true))?.status).toBe('unavailable')
    expect((await directory.updateMetadata('b', { name: 'Allowed', description: '' })).status).toBe('committed')
    browserOwned = false
    expect((await directory.updateMetadata('a', { name: 'Reclaimed', description: '' })).status).toBe('committed')
  })
  it('keeps per-field queued preferences rather than overwriting another resource row', async () => {
    const { source } = mutableSettings()
    const scope = createWorkbenchSettingsScope({ ...source, mutate: async (ops: readonly any[], expectedRevision?: number) => (await source.patch({ operation: 'set', path: ops[0].path, value: ops[0].value, expectedRevision })).status === 'committed' } as never, {} as never, () => {})
    await Promise.all(['file', 'browser'].map(key => scope.patch({ operation: 'set', path: ['interactionPolicy', 'conversationResources', key], value: { enabled: true, placement: 'new-tab' } })))
    expect(source.getSnapshot().value?.interactionPolicy?.conversationResources).toMatchObject({ file: { placement: 'new-tab' }, browser: { placement: 'new-tab' } })
  })
  it('routes human background edits through the Control Plane Context CAS seam', async () => {
    const { source } = mutableSettings()
    const controlPlane = new WorkbenchControlPlane({ settings: source })
    const { directory } = createProjectNeutralFrameSettings(source, {
      contextPatch: async input => {
        const result = await controlPlane.context.patch({
          scope: input.scope,
          workbenchId: input.workbenchId,
          ...(input.areaId === undefined ? {} : { areaId: input.areaId }),
          writer: 'human', section: 'human', expectedRevision: input.expectedRevision, patch: input.patch,
        })
        if (result.status === 'committed') return { status: 'committed', revision: result.settingsRevision }
        if (result.status === 'conflict') return { status: 'conflict', expectedRevision: input.expectedRevision, actualRevision: result.currentSettingsRevision }
        return { status: 'unavailable' }
      },
    })
    expect(await directory.updateWorkbenchBackground?.('a', '新的工作台目标')).toMatchObject({ status: 'committed' })
    expect(source.getSnapshot().value?.workbenches.a?.context?.human.goal).toBe('新的工作台目标')
    expect(source.getSnapshot().value?.workbenches.a?.context?.revision).toBe(1)
  })
})
