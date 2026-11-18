// @vitest-environment jsdom
import React, { createRef } from 'react'
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorkbenchEmptyArea } from '../src/foundation/WorkbenchEmptyArea.tsx'
import { WorkbenchEditorPicker } from '../src/foundation/WorkbenchEditorPicker.tsx'
import { editorsAvailableForWorkbenchContext, selectableWorkbenchEditors } from '../src/foundation/editor-selection.ts'
import type { WorkbenchEditorCatalogRow } from '../src/foundation/catalog.ts'
import { WorkbenchFrame } from '../src/foundation/WorkbenchFrame.tsx'
import { defaultLayout } from '../src/foundation/model.ts'
afterEach(cleanup)
const editors: WorkbenchEditorCatalogRow[] = [
  { id: 'private.notes', scope: 'root', label: '团队笔记', iconSvg: { version: 1, paths: ['M4 4h16v16H4Z', 'M8 8h8'] } },
  { id: 'workbench.terminal', scope: 'session', label: '终端' },
  { id: 'private.hidden', scope: 'root', label: '已隐藏' },
  { id: 'workbench.plan', scope: 'session', label: '资源专用计划' },
]
function renderEmptyFrame() {
  const layout = defaultLayout()
  layout.root = { kind: 'split', id: 'two-areas', axis: 'horizontal', ratio: .5, first: layout.root, second: { kind: 'group', id: 'other-area', tabs: [] } }
  const snapshot = { status: 'ready', revision: 1, writable: true, mode: 'host', value: { version: 2, layouts: { ungrouped: layout }, invalidLayouts: {}, sessionMarkers: {} } }
  const sessions = { ids: [], byId: {}, phase: 'ready' }
  const workspaces = { items: [], archivedSessionIds: [], phase: 'ready' }
  const selectSession = vi.fn(), renderSlot = vi.fn((_name: string, _owner: unknown, options: { only?: string }) => <div data-testid={options.only} />)
  const view = render(<WorkbenchFrame {...{
    renderSidebar: () => null, renderSlot, projectNeutral: true,
    useSessions: (select: (value: unknown) => unknown) => select(sessions),
    useWorkspaces: (select: (value: unknown) => unknown) => select(workspaces),
    bindLayout: () => () => {}, bindNavigation: () => () => {}, selectSession,
    settings: { getSnapshot: () => snapshot, subscribe: () => () => {}, patch: async () => ({ status: 'committed', revision: 2 }) },
    editorCatalog: { getSnapshot: () => editors, subscribe: () => () => {} },
    sidebarCompatibility: { getSnapshot: () => undefined, subscribe: () => () => {} },
  } as never} />)
  return { view, selectSession, renderSlot }
}
describe('Empty Area launch surface', () => {
  it('folds category folders, searches inside folded folders, and restores their state after searching and reopening', () => {
    const preferences = { folders: [{ id: 'picker-test-notes', name: '内容创作' }], assignments: { 'private.notes': 'picker-test-notes' } }
    const onSelect = vi.fn()
    const content = <WorkbenchEditorPicker editors={[...editors,
      { id: 'workbench.conversation', scope: 'session', label: '对话', category: '对话' },
      { id: 'workbench.conversation.start', scope: 'root', label: '新建对话' },
      { id: 'workbench.agent-trajectory', scope: 'session', label: '轨迹分析' }]} preferences={preferences} mode="add" onSelect={onSelect} />
    const view = render(content)
    const official = within(view.getByRole('group', { name: '官方内置' }))
    expect(official.getByRole('menuitem', { name: '添加为标签 对话' })).toBeTruthy()
    expect(official.getByRole('menuitem', { name: '添加为标签 新建对话' })).toBeTruthy()
    expect(official.getByRole('menuitem', { name: '添加为标签 轨迹分析' })).toBeTruthy()
    fireEvent.click(view.getByRole('button', { name: '内容创作' }))
    expect(view.queryByRole('menuitem', { name: '添加为标签 团队笔记' })).toBeNull()
    const input = view.getByRole('searchbox', { name: '搜索内页' })
    fireEvent.change(input, { target: { value: '笔记' } })
    expect(view.getByRole('menuitem', { name: '添加为标签 团队笔记' })).toBeTruthy()
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onSelect).toHaveBeenCalledWith(editors[0])
    fireEvent.change(input, { target: { value: '' } })
    expect(view.getByRole('button', { name: '内容创作' }).getAttribute('aria-expanded')).toBe('false')
    view.unmount()
    const reopened = render(content)
    expect(reopened.queryByRole('menuitem', { name: '添加为标签 团队笔记' })).toBeNull()
    fireEvent.keyDown(reopened.getByRole('button', { name: '内容创作' }), { key: 'ArrowRight' })
    expect(reopened.getByRole('menuitem', { name: '添加为标签 团队笔记' })).toBeTruthy()
  })
  it('adds a root editor only to the chosen Area and retains its SVG in the tab', async () => {
    const { view, selectSession } = renderEmptyFrame()
    fireEvent.click((await view.findAllByRole('button', { name: '添加内页：团队笔记' }))[0]!)
    await view.findByTestId('private.notes')
    expect(view.getAllByRole('button', { name: '添加内页：团队笔记' })).toHaveLength(1)
    expect(view.getByRole('tab', { name: /当前内页：团队笔记/ }).querySelector('path')?.getAttribute('d')).toBe('M4 4h16v16H4Z')
    expect(selectSession).not.toHaveBeenCalled()
  })
  it('does not offer Session editors before a project is configured', async () => {
    const { view, selectSession } = renderEmptyFrame()
    expect(view.queryByRole('button', { name: '添加内页：终端' })).toBeNull()
    expect(view.queryByText('先设置项目')).toBeDefined()
    expect(view.queryByText('当前只能添加不依赖对话的内页。设置项目后，才能开始新对话。')).toBeDefined()
    expect(selectSession).not.toHaveBeenCalled()
  })
  it('filters binding-dependent editors using the existing declaration contract', () => {
    const rows: WorkbenchEditorCatalogRow[] = [
      { id: 'notes', scope: 'root', label: '笔记', declaration: { editorId: 'notes', scope: 'root', label: '笔记', requiredBinding: 'none', runtime: { background: 'keep', collapsed: 'keep', reacquire: 'on-visible' }, state: { schemaVersion: 1, maxBytes: 1, restore: 'always', share: 'portable' } } },
      { id: 'start', scope: 'root', label: '新建对话', declaration: { editorId: 'start', scope: 'root', label: '新建对话', requiredBinding: 'workspace', runtime: { background: 'keep', collapsed: 'keep', reacquire: 'on-visible' }, state: { schemaVersion: 1, maxBytes: 1, restore: 'always', share: 'portable' } } },
      { id: 'conversation', scope: 'session', label: '对话', declaration: { editorId: 'conversation', scope: 'session', label: '对话', requiredBinding: 'session', runtime: { background: 'keep', collapsed: 'keep', reacquire: 'on-visible' }, state: { schemaVersion: 1, maxBytes: 1, restore: 'always', share: 'portable' } } },
    ]
    expect(editorsAvailableForWorkbenchContext(rows, { hasWorkspace: false, hasSession: false }).map(row => row.id)).toEqual(['notes'])
    expect(editorsAvailableForWorkbenchContext(rows, { hasWorkspace: true, hasSession: false }).map(row => row.id)).toEqual(['notes', 'start'])
    expect(editorsAvailableForWorkbenchContext(rows, { hasWorkspace: true, hasSession: true }).map(row => row.id)).toEqual(['notes', 'start', 'conversation'])
  })
  it('makes the project-free empty state actionable', () => {
    const onSetProject = vi.fn()
    const view = render(<WorkbenchEmptyArea editors={[editors[0]]} context={{ hasWorkspace: false, hasSession: false }} onSelect={vi.fn()} onBrowse={vi.fn()} onSetProject={onSetProject} triggerRef={createRef()} expanded={false} />)
    fireEvent.click(view.getByRole('button', { name: '设置项目' }))
    expect(onSetProject).toHaveBeenCalledOnce()
  })
  it('uses the live visible catalog, with SVG and readable names on every shortcut', () => {
    const onSelect = vi.fn(), onBrowse = vi.fn()
    const view = render(<WorkbenchEmptyArea editors={selectableWorkbenchEditors(editors, ['private.hidden'])} onSelect={onSelect} onBrowse={onBrowse} triggerRef={createRef()} expanded={false} />)
    expect(view.queryByText('已隐藏')).toBeNull()
    expect(view.queryByText('资源专用计划')).toBeNull()
    const notes = view.getByRole('button', { name: '添加内页：团队笔记' })
    expect(notes.querySelector('svg path')?.getAttribute('d')).toBe('M4 4h16v16H4Z')
    fireEvent.click(notes); expect(onSelect).toHaveBeenCalledWith(editors[0])
    const all = view.getByRole('button', { name: '更多内页' }); fireEvent.click(all)
    expect(onBrowse).toHaveBeenCalledWith(all)
  })
  it('makes the no-editor state actionable instead of offering an empty menu', () => {
    const onManage = vi.fn()
    const view = render(<WorkbenchEmptyArea editors={[]} onSelect={vi.fn()} onBrowse={vi.fn()} onManage={onManage} triggerRef={createRef()} expanded={false} />)
    expect(view.getByText('暂无可用内页')).toBeDefined()
    expect(view.queryByRole('button', { name: '更多内页' })).toBeNull()
    fireEvent.click(view.getByRole('button', { name: '内页与扩展' })); expect(onManage).toHaveBeenCalledOnce()
  })
  it('searches all editors and supports arrows, Enter and no-result feedback', () => {
    const onSelect = vi.fn()
    const view = render(<WorkbenchEditorPicker editors={editors} mode="add" onSelect={onSelect} />)
    const input = view.getByRole('searchbox', { name: '搜索内页' })
    fireEvent.change(input, { target: { value: '终端' } })
    expect(view.getAllByRole('menuitem')).toHaveLength(1)
    fireEvent.keyDown(input, { key: 'ArrowDown' }); expect(document.activeElement).toBe(view.getByRole('menuitem', { name: '添加为标签 终端' }))
    fireEvent.keyDown(input, { key: 'Enter' }); expect(onSelect).toHaveBeenCalledWith(editors[1])
    fireEvent.change(input, { target: { value: '不存在' } }); expect(view.getByRole('status').textContent).toBe('没有匹配的内页')
  })
})
