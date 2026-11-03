// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { useSyncExternalStore } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkbenchCoreSettingsSection } from '../src/foundation/WorkbenchCoreSettingsSection.tsx'
import type { WorkbenchCoreSettingsSectionProps } from '../src/foundation/WorkbenchCoreSettingsSection.tsx'
import { createProjectNeutralFrameSettings } from '../src/foundation/frame-settings-adapter.ts'
import { mutableSettings } from './settings-fixtures.ts'
import { settingsViewMemory, DESKTOP_SETTINGS_CONTEXT } from '../src/foundation/settings-context.ts'
import type { WorkbenchEditorCatalogRow } from '../src/foundation/catalog.ts'

beforeEach(() => { const memory = settingsViewMemory(DESKTOP_SETTINGS_CONTEXT); memory.section = 'workbenches'; memory.filters = {}; memory.searches = {}; delete memory.selectedId })
afterEach(cleanup)
function setup(overrides: Partial<WorkbenchCoreSettingsSectionProps> = {}) {
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
  const view = render(<WorkbenchCoreSettingsSection {...props} />)
  return { ...f, view, props, directory, close, requestClose: () => closeRequest() }
}
describe('settings product interactions', () => {
  it('keeps list layout thumbnails visual-only while preserving the detailed layout preview', () => {
    const { view } = setup()
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
    expect(view.getAllByRole('tab').map(tab => tab.textContent)).toEqual(['工作台管理', '内页与扩展', '交互偏好', '导入与分享'])
    fireEvent.keyDown(view.getByRole('tab', { name: '工作台管理' }), { key: 'ArrowDown' })
    expect(view.getByRole('tab', { name: '内页与扩展' }).getAttribute('aria-selected')).toBe('true')
    expect(document.activeElement).toBe(view.getByRole('tab', { name: '内页与扩展' }))
  })
  it('lists complete inner pages on a clean Core without Suite and offers no resource-only entry toggle', () => {
    const { view, writes } = setup({ openOptions: { section: 'pages' } })
    expect(view.getByText('3 个内页 · 扩展安装状态尚未检查')).toBeTruthy()
    expect(view.getByLabelText('显示 笔记 添加入口')).toBeTruthy()
    expect(view.queryByLabelText('显示 计划 添加入口')).toBeNull()
    expect(view.getByText('由对话结果打开')).toBeTruthy()
    expect(writes).toEqual([])
  })
  it('protects metadata on tab switch and close, keeps failed input, and retries', async () => {
    const { view, props, close, requestClose } = setup({ openOptions: { workbenchId: 'a' } })
    const update = vi.spyOn(props.workbenchDirectory!, 'updateMetadata').mockResolvedValueOnce({ status: 'conflict', expectedRevision: 1, actualRevision: 2 })
    fireEvent.change(view.getByLabelText('名称'), { target: { value: 'Edited A' } })
    fireEvent.click(view.getByRole('tab', { name: '内页与扩展' }))
    expect(view.getByRole('alertdialog', { name: '资料尚未保存' })).toBeTruthy()
    fireEvent.click(view.getByRole('button', { name: '继续编辑' }))
    fireEvent.click(view.getByRole('button', { name: '保存资料' }))
    await waitFor(() => expect(update).toHaveBeenCalled())
    await waitFor(() => expect(view.getByText(/保存失败|其他窗口/u)).toBeTruthy())
    expect((view.getByLabelText('名称') as HTMLInputElement).value).toBe('Edited A')
    fireEvent.click(view.getByRole('button', { name: '重试' }))
    await waitFor(() => expect(update).toHaveBeenCalledTimes(2))
    fireEvent.change(view.getByLabelText('名称'), { target: { value: 'Unsaved again' } })
    act(() => requestClose())
    expect(close).not.toHaveBeenCalled()
    fireEvent.click(view.getByRole('button', { name: '放弃修改' }))
    expect(close).toHaveBeenCalledOnce()
  })
  it('scopes browser data and removes global management, import and preference controls', () => {
    const context = { mode: 'browser-workbench' as const, workbenchId: 'a' }
    const { view } = setup({ settingsContext: context })
    expect(view.getAllByRole('tab').map(tab => tab.textContent)).toEqual(['当前工作台', '使用中的内页', '导出分享'])
    expect(view.queryByRole('button', { name: '导入工作台' })).toBeNull()
    expect(view.queryByRole('button', { name: '永久删除布局' })).toBeNull()
    expect(view.queryByText('B')).toBeNull()
    fireEvent.click(view.getByRole('tab', { name: '使用中的内页' }))
    expect(view.queryByLabelText('显示 笔记 添加入口')).toBeNull()
    expect(view.queryByRole('button', { name: 'DSH 插件管理' })).toBeNull()
  })
  it('shows one behavior selector without an enable checkbox and patches only the chosen row', async () => {
    const patch = vi.fn(async () => true)
    const { view } = setup({ openOptions: { section: 'interactions' }, patchInteractionPolicy: patch })
    expect(view.queryAllByRole('checkbox')).toHaveLength(0)
    fireEvent.change(view.getByLabelText('轨迹检查点击后的行为'), { target: { value: 'disabled' } })
    await waitFor(() => expect(patch).toHaveBeenCalledWith('trajectory-inspect', { enabled: false, placement: 'disabled' }))
    fireEvent.change(view.getByLabelText('文件结果点击后的行为'), { target: { value: 'new-tab' } })
    await waitFor(() => expect(patch).toHaveBeenCalledWith('file', { enabled: true, placement: 'new-tab' }))
  })
  it('unsubscribes settings listeners and performs no writes during idle navigation', () => {
    const { view, writes, listeners } = setup()
    expect(listeners.size).toBeGreaterThan(0)
    for (const name of ['内页与扩展', '交互偏好', '工作台管理']) fireEvent.click(view.getByRole('tab', { name }))
    expect(writes).toEqual([])
    view.unmount(); expect(listeners.size).toBe(0)
  })
})
