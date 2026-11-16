import { expect, it } from 'vitest'
import { changeEditorMenuPreferences, decodeEditorMenuPreferences, editorMenuFolder } from '../src/foundation/editor-menu-preferences.ts'
import { createProjectNeutralFrameSettings } from '../src/foundation/frame-settings-adapter.ts'
import { decodeWorkbenchSettingsV4 } from '../src/foundation/persistence.ts'
import { WorkbenchSettingsSchema } from '../src/host-layout-settings.ts'
import { mutableSettings } from './settings-fixtures.ts'

it('saves folders and editor assignments through settings, survives decoding and renaming, and resets deleted folders', async () => {
  const f = mutableSettings(), directory = createProjectNeutralFrameSettings(f.source).directory
  const workbenches = structuredClone(f.source.getSnapshot().value!.workbenches)
  await directory.updateEditorMenu!({ type: 'create', id: 'tools', name: '开发工具' })
  await directory.updateEditorMenu!({ type: 'assign', editorId: 'example.notes', folderId: 'tools' })
  await directory.updateEditorMenu!({ type: 'rename', id: 'tools', name: '项目工具' })
  const value = f.source.getSnapshot().value!
  const parsed = decodeWorkbenchSettingsV4(WorkbenchSettingsSchema(value))!
  expect(parsed.editorMenu).toEqual({ folders: [{ id: 'tools', name: '项目工具' }], assignments: { 'example.notes': 'tools' } })
  expect(createProjectNeutralFrameSettings(mutableSettings(parsed).source).directory.getSnapshot().editorMenu).toEqual(parsed.editorMenu)
  expect(value.workbenches).toEqual(workbenches)
  expect(f.writes.every(write => write.expectedRevision !== undefined)).toBe(true)
  await directory.updateEditorMenu!({ type: 'remove', id: 'tools' })
  expect(directory.getSnapshot().editorMenu).toEqual({ folders: [], assignments: {} })
})

it('rejects ambiguous names and dangling mappings while retaining mappings for temporarily unavailable extensions', () => {
  const preferences = changeEditorMenuPreferences(undefined, { type: 'create', id: 'tools', name: '工具' })
  expect(() => changeEditorMenuPreferences(preferences, { type: 'create', id: 'duplicate', name: ' 工具 ' })).toThrow('同名')
  expect(() => changeEditorMenuPreferences(preferences, { type: 'rename', id: 'tools', name: '官方内置' })).toThrow('名称')
  expect(() => changeEditorMenuPreferences(preferences, { type: 'assign', editorId: 'example.notes', folderId: 'gone' })).toThrow('不存在')
  expect(() => changeEditorMenuPreferences(preferences, { type: 'assign', editorId: 'workbench.conversation', folderId: 'tools' })).toThrow('扩展')
  expect(decodeEditorMenuPreferences({ folders: [], assignments: { 'example.notes': 'gone' } })).toBeUndefined()
  expect(decodeEditorMenuPreferences({ ...preferences, assignments: { 'temporarily.offline': 'tools' } })?.assignments).toEqual({ 'temporarily.offline': 'tools' })
  expect(editorMenuFolder({ id: 'workbench.conversation', scope: 'session', label: '对话', category: '对话' }, preferences).name).toBe('官方内置')
})

it('projects the same organization in a browser while disallowing profile changes there', async () => {
  const f = mutableSettings()
  const desktop = createProjectNeutralFrameSettings(f.source).directory
  await desktop.updateEditorMenu!({ type: 'create', id: 'tools', name: '工具' })
  const browser = createProjectNeutralFrameSettings(f.source, { workbenchId: 'a' }).directory
  expect(browser.getSnapshot().editorMenu).toEqual(desktop.getSnapshot().editorMenu)
  expect(await browser.updateEditorMenu!({ type: 'remove', id: 'tools' })).toEqual({ status: 'unavailable' })
  expect(desktop.getSnapshot().editorMenu!.folders).toHaveLength(1)
})
