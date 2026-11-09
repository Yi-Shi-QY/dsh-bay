// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { useSyncExternalStore } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkbenchHomeCenter } from '../src/foundation/WorkbenchHomeCenter.tsx'
import { WorkbenchCoreSettingsSection } from '../src/foundation/WorkbenchCoreSettingsSection.tsx'
import type { WorkbenchCoreSettingsSectionProps } from '../src/foundation/WorkbenchCoreSettingsSection.tsx'
import { createProjectNeutralFrameSettings } from '../src/foundation/frame-settings-adapter.ts'
import { mutableSettings } from './settings-fixtures.ts'
import { settingsViewMemory, DESKTOP_SETTINGS_CONTEXT } from '../src/foundation/settings-context.ts'
import type { WorkbenchEditorCatalogRow } from '../src/foundation/catalog.ts'

beforeEach(() => { const memory = settingsViewMemory(DESKTOP_SETTINGS_CONTEXT); memory.section = 'workbenches'; memory.filters = {}; memory.searches = {}; delete memory.selectedId })
afterEach(cleanup)
function setup(overrides: Partial<WorkbenchCoreSettingsSectionProps> = {}, home = false) {
  const f = mutableSettings()
  const directory = createProjectNeutralFrameSettings(f.source).directory
  const editors: WorkbenchEditorCatalogRow[] = [{ id: 'workbench.conversation', label: '对话', scope: 'session' }, { id: 'example.notes', label: '笔记', scope: 'root', declaration: { editorId: 'example.notes', scope: 'root', label: '独立笔记', requiredBinding: 'none', state: { schemaVersion: 1, maxBytes: 4096, restore: 'always', share: 'reference-only' }, runtime: { background: 'keep', collapsed: 'keep', reacquire: 'on-visible' } } }, { id: 'workbench.plan', label: '计划', scope: 'session', resourceOnly: true }]
  const close = vi.fn()
  let closeRequest = close
  const props = {
    editorCatalog: { getSnapshot: () => editors, subscribe: () => () => {} },
    workbenchDirectory: directory,
    useWorkbenchSettings: (select: any) => select(useSyncExternalStore(f.source.subscribe, f.source.getSnapshot)),
    useSessions: (select: any) => select({ ids: [], byId: {} }), useWorkspaces: (select: any) => select({ items: [] }),
    close, registerCloseRequest: (request: () => void) => { closeRequest = request; return () => { closeRequest = close } },
    ...overrides,
  } as WorkbenchCoreSettingsSectionProps
  const view = render(home ? <WorkbenchHomeCenter {...props} directory={directory} workbenchSettings={f.source} onOpenWorkbench={async id => { await directory.openAndSelect(id) }} onCreated={() => {}} /> : <WorkbenchCoreSettingsSection {...props} />)
  return { ...f, view, props, directory, close, requestClose: () => closeRequest() }
}
describe('settings product interactions', () => {
  it('keeps list layout thumbnails visual-only while preserving the detailed layout preview', () => {
    const { view } = setup({ openOptions: { section: 'workbenches' } }, true)
    const thumbnail = view.container.querySelector('[class*="previewCompact"]')
    expect(thumbnail).toBeTruthy()
    expect(thumbnail?.textContent?.trim()).toBe('')
    expect(thumbnail?.querySelectorAll('svg')).toHaveLength(1)

    fireEvent.click(thumbnail!.closest('button')!)
    const detailPreview = view.container.querySelector('[class*="largePreview"]')
    expect(detailPreview?.textContent).toContain('对话')
    expect(detailPreview?.textContent).toContain('2 个内页')
  })
  it('uses the same navigation order for keyboard and visible categories', () => {
    const { view } = setup()
    expect(view.getAllByRole('tab').map(tab => tab.textContent)).toEqual(['内页与扩展', '交互偏好'])
    fireEvent.keyDown(view.getByRole('tab', { name: '交互偏好' }), { key: 'ArrowDown' })
    expect(view.getByRole('tab', { name: '内页与扩展' }).getAttribute('aria-selected')).toBe('true')
    expect(document.activeElement).toBe(view.getByRole('tab', { name: '内页与扩展' }))
  })
  it('lists complete inner pages on a clean Core without Suite and offers no resource-only entry toggle', () => {
    const { view, writes } = setup({ openOptions: { section: 'pages' } })
    expect(view.getByLabelText('显示 笔记 添加入口')).toBeTruthy()
    expect(view.queryByLabelText('显示 计划 添加入口')).toBeNull()
    expect(view.getByText('由对话结果打开')).toBeTruthy()
    expect(writes).toEqual([])
  })
  it('shows a unified catalog with working entry switches and no permissions view', async () => {
    const { view, source } = setup({ openOptions: { section: 'pages' } })
    expect(view.queryByRole('button', { name: /扩展权限/ })).toBeNull()
    expect(view.getAllByRole('article')).toHaveLength(3)
    expect(view.queryByRole('switch', { name: '显示 计划 添加入口' })).toBeNull()
    const entry = view.getByRole('switch', { name: '显示 笔记 添加入口' })
    expect(entry.getAttribute('aria-checked')).toBe('true')
    fireEvent.click(entry)
    await waitFor(() => expect(entry.getAttribute('aria-checked')).toBe('false'))
    expect(source.getSnapshot().value?.globalHiddenEditorIds).toContain('example.notes')
    fireEvent.click(view.getByRole('button', { name: '内置', exact: true }))
    expect(view.getAllByRole('article')).toHaveLength(2)
    fireEvent.click(view.getByRole('button', { name: '需要处理', exact: true }))
    expect(view.getByText('没有符合条件的内页或扩展。')).toBeTruthy()
  })
  it('manages a multi-page extension on one card and keeps a failed switch off until retry succeeds', async () => {
    const extension = { key: '@example/pet::example.pet', packageName: '@example/pet', packageVersion: '1.2.0', moduleId: 'example.pet', apiVersion: 1,
      editorIds: ['example.pet.page', 'example.pet.settings'], availability: 'not-allowed' as const, allowed: false,
      contractFingerprint: '0123456789abcdef0123456789abcdef', detail: '允许后，此扩展才会出现在添加内页中。' }
    let snapshot: import('../src/workbench-extension-access.ts').WorkbenchExtensionAccessSnapshotV1 = { status: 'ready', extensions: [extension] }
    const listeners = new Set<() => void>()
    const setExtensionAllowed = vi.fn()
      .mockRejectedValueOnce(new Error('保存失败，请重试'))
      .mockImplementation(async () => {
        snapshot = { status: 'ready', extensions: [{ ...extension, availability: 'ready', allowed: true }] }
        listeners.forEach(listener => listener())
        return { status: 'committed', revision: 2 }
      })
    const { view } = setup({
      extensionRegistry: { getSnapshot: () => snapshot, subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener) },
        refresh: async () => {}, dispose: () => {}, catalog: { getSnapshot: () => [], subscribe: () => () => {} } },
      workbenchDirectory: { setExtensionAllowed } as unknown as WorkbenchCoreSettingsSectionProps['workbenchDirectory'],
    })
    fireEvent.click(view.getByRole('button', { name: '扩展', exact: true }))
    expect(view.container.querySelectorAll('[data-extension-key]')).toHaveLength(1)
    const toggle = view.getByRole('switch', { name: '在工作台启用 @example/pet' })
    fireEvent.click(toggle)
    await waitFor(() => expect(view.getByRole('alert').textContent).toContain('保存失败'))
    expect(toggle.getAttribute('aria-checked')).toBe('false')
    fireEvent.click(view.getByRole('button', { name: '重试' }))
    await waitFor(() => expect(toggle.getAttribute('aria-checked')).toBe('true'))
    expect(setExtensionAllowed).toHaveBeenLastCalledWith({
      packageName: '@example/pet', moduleId: 'example.pet', apiVersion: 1, editorIds: extension.editorIds, contractFingerprint: extension.contractFingerprint,
    }, true)
    fireEvent.change(view.getByRole('searchbox'), { target: { value: 'missing-package' } })
    expect(view.getByText('没有符合条件的内页或扩展。')).toBeTruthy()
    fireEvent.change(view.getByRole('searchbox'), { target: { value: 'example.pet.settings' } })
    expect(view.getByRole('switch', { name: '在工作台启用 @example/pet' })).toBeTruthy()
    expect(view.queryByRole('switch', { name: '显示 笔记 添加入口' })).toBeNull()
  })
  it('allows revoking a stored permission while the plugin is offline, with inline impact confirmation', async () => {
    const setExtensionAllowed = vi.fn(async () => ({ status: 'committed' as const, revision: 3 }))
    const extension = { key: '@example/notes::example.notes', packageName: '@example/notes', moduleId: 'example.notes', apiVersion: 1,
      editorIds: ['example.notes'], availability: 'dsh-disabled' as const, allowed: false, detail: '请在 DSH 插件管理中启用。' }
    const snapshot = { status: 'ready' as const, extensions: [extension] }
    const { view, source } = setup({
      extensionRegistry: { getSnapshot: () => snapshot, subscribe: () => () => {}, refresh: async () => {}, dispose: () => {}, catalog: { getSnapshot: () => [], subscribe: () => () => {} } },
      workbenchDirectory: { setExtensionAllowed } as unknown as WorkbenchCoreSettingsSectionProps['workbenchDirectory'],
    })
    await act(async () => { await source.patch({ operation: 'set', path: ['extensionConsents', extension.key], value: { ...extension, allowed: true } }) })
    const toggle = view.getByRole('switch', { name: '在工作台启用 @example/notes' })
    expect(toggle.getAttribute('aria-checked')).toBe('true')
    fireEvent.click(toggle)
    expect(view.getByRole('group', { name: '确认停用扩展' }).textContent).toContain('2 个工作台中的 2 个内页')
    expect(setExtensionAllowed).not.toHaveBeenCalled()
    fireEvent.click(view.getByRole('button', { name: '取消', exact: true }))
    expect(toggle.getAttribute('aria-checked')).toBe('true')
    fireEvent.click(toggle)
    fireEvent.click(view.getByRole('button', { name: '确认停用', exact: true }))
    await waitFor(() => expect(setExtensionAllowed).toHaveBeenCalledWith({
      packageName: '@example/notes', moduleId: 'example.notes', apiVersion: 1, editorIds: ['example.notes'],
    }, false))
  })
  it.each(['confirmation-required', 'ready'] as const)('requires explicit permission for a %s extension', async availability => {
    const setExtensionAllowed = vi.fn(async () => ({ status: 'committed' as const, revision: 2 }))
    const extension = { key: 'pending', packageName: '@example/pending', moduleId: 'pending', apiVersion: 1, contractFingerprint: 'f'.repeat(32),
      editorIds: ['pending.page'], availability, allowed: false, detail: '请确认当前内页声明。' }
    const snapshot = { status: 'ready' as const, extensions: [extension] }
    const { view } = setup({
      extensionRegistry: { getSnapshot: () => snapshot, subscribe: () => () => {}, refresh: async () => {}, dispose: () => {}, catalog: { getSnapshot: () => [], subscribe: () => () => {} } },
      workbenchDirectory: { setExtensionAllowed } as unknown as WorkbenchCoreSettingsSectionProps['workbenchDirectory'],
    })
    fireEvent.click(view.getByRole('button', { name: '需要处理', exact: true }))
    const toggle = view.getByRole('switch', { name: '在工作台启用 @example/pending' })
    expect(toggle.getAttribute('aria-checked')).toBe('false')
    expect(toggle.hasAttribute('disabled')).toBe(false)
    if (availability === 'confirmation-required') expect(view.getByText('重新确认并启用')).toBeTruthy()
    fireEvent.click(toggle)
    await waitFor(() => expect(setExtensionAllowed).toHaveBeenCalledWith({
      packageName: '@example/pending', moduleId: 'pending', apiVersion: 1, contractFingerprint: extension.contractFingerprint, editorIds: ['pending.page'],
    }, true))
  })
  it('keeps incompatible extensions visible but prevents enabling them', () => {
    const setExtensionAllowed = vi.fn()
    const extension = { key: 'incompatible', packageName: '@example/old', moduleId: 'old', editorIds: [], availability: 'incompatible' as const, allowed: false, detail: '需要更新扩展版本。' }
    const snapshot = { status: 'ready' as const, extensions: [extension] }
    const { view } = setup({
      extensionRegistry: { getSnapshot: () => snapshot, subscribe: () => () => {}, refresh: async () => {}, dispose: () => {}, catalog: { getSnapshot: () => [], subscribe: () => () => {} } },
      workbenchDirectory: { setExtensionAllowed } as unknown as WorkbenchCoreSettingsSectionProps['workbenchDirectory'],
    })
    fireEvent.click(view.getByRole('button', { name: '需要处理', exact: true }))
    expect(view.getAllByRole('article')).toHaveLength(1)
    expect(view.getByText('需要更新扩展版本。')).toBeTruthy()
    const toggle = view.getByRole('switch', { name: '在工作台启用 @example/old' })
    expect(toggle.hasAttribute('disabled')).toBe(true)
    fireEvent.click(toggle)
    expect(setExtensionAllowed).not.toHaveBeenCalled()
  })
  it('protects Home metadata on navigation, keeps failed input, and retries', async () => {
    const { view, props } = setup({ openOptions: { section: 'workbenches', workbenchId: 'a' } }, true)
    const update = vi.spyOn(props.workbenchDirectory!, 'updateMetadata').mockResolvedValueOnce({ status: 'conflict', expectedRevision: 1, actualRevision: 2 })
    fireEvent.change(view.getByLabelText('名称'), { target: { value: 'Edited A' } })
    fireEvent.click(view.getByRole('button', { name: '返回总览' }))
    expect(view.getByRole('alertdialog', { name: '资料尚未保存' })).toBeTruthy()
    fireEvent.click(view.getByRole('button', { name: '继续编辑' }))
    fireEvent.click(view.getByRole('button', { name: '保存资料' }))
    await waitFor(() => expect(update).toHaveBeenCalled())
    await waitFor(() => expect(view.getByText(/保存失败|其他窗口/u)).toBeTruthy())
    expect((view.getByLabelText('名称') as HTMLInputElement).value).toBe('Edited A')
    fireEvent.click(view.getByRole('button', { name: '重试' }))
    await waitFor(() => expect(update).toHaveBeenCalledTimes(2))
    fireEvent.change(view.getByLabelText('名称'), { target: { value: 'Unsaved again' } })
    fireEvent.click(view.getByRole('button', { name: '返回总览' }))
    expect(view.getByRole('alertdialog', { name: '资料尚未保存' })).toBeTruthy()
    fireEvent.click(view.getByRole('button', { name: '放弃修改' }))
    await waitFor(() => expect(view.getByRole('heading', { name: '你的工作台' })).toBeTruthy())
  })
  it('scopes browser data and exposes background settings without global management controls', () => {
    const context = { mode: 'browser-workbench' as const, workbenchId: 'a' }
    const { view } = setup({ settingsContext: context })
    expect(view.getAllByRole('tab').map(tab => tab.textContent)).toEqual(['当前工作台', '使用中的内页', '背景 AI', '导入与分享'])
    expect(view.queryByRole('button', { name: '导入工作台' })).toBeNull()
    expect(view.queryByRole('button', { name: '永久删除布局' })).toBeNull()
    expect(view.queryByText('B')).toBeNull()
    fireEvent.click(view.getByRole('tab', { name: '使用中的内页' }))
    expect(view.queryByLabelText('显示 笔记 添加入口')).toBeNull()
    expect(view.queryByRole('button', { name: 'DSH 插件管理' })).toBeNull()
    fireEvent.click(view.getByRole('tab', { name: '背景 AI' }))
    expect(view.getByLabelText('工作台背景提示词')).toBeTruthy()
    expect(view.getByLabelText('区域背景提示词')).toBeTruthy()
    expect(view.queryByLabelText('新建工作台提示词')).toBeNull()
    expect(view.queryByLabelText('显示区域容器标签色框')).toBeNull()
  })
  it('shows one behavior selector plus the marker-frame switch and patches only the chosen row', async () => {
    const patch = vi.fn(async () => true)
    const { view } = setup({ openOptions: { section: 'interactions' }, patchInteractionPolicy: patch })
    expect(view.queryAllByRole('switch')).toHaveLength(2)
    fireEvent.click(view.getByLabelText('显示区域容器标签色框'))
    await waitFor(() => expect(patch).toHaveBeenCalledWith('showSessionAccentFrames', false))
    fireEvent.change(view.getByLabelText('轨迹检查点击后的行为'), { target: { value: 'disabled' } })
    await waitFor(() => expect(patch).toHaveBeenCalledWith('trajectory-inspect', { enabled: false, placement: 'disabled' }))
    fireEvent.change(view.getByLabelText('文件结果点击后的行为'), { target: { value: 'new-tab' } })
    await waitFor(() => expect(patch).toHaveBeenCalledWith('file', { enabled: true, placement: 'new-tab' }))
  })
  it('saves tab label size and close-button visibility preferences', async () => {
    const patch = vi.fn(async () => true)
    const { view } = setup({ openOptions: { section: 'interactions' }, patchInteractionPolicy: patch })
    fireEvent.change(view.getByLabelText('内页标签文字大小'), { target: { value: 'large' } })
    await waitFor(() => expect(patch).toHaveBeenCalledWith('tabFontSize', 'large'))
    fireEvent.click(view.getByLabelText('显示内页标签关闭按钮'))
    await waitFor(() => expect(patch).toHaveBeenCalledWith('showTabCloseButtons', false))
  })
  it('unsubscribes settings listeners and performs no writes during idle navigation', () => {
    const { view, writes, listeners } = setup()
    expect(listeners.size).toBeGreaterThan(0)
    for (const name of ['内页与扩展', '交互偏好', '内页与扩展']) fireEvent.click(view.getByRole('tab', { name }))
    expect(writes).toEqual([])
    view.unmount(); expect(listeners.size).toBe(0)
  })
})
