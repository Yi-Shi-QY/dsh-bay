// @vitest-environment jsdom
import React, { createRef } from 'react'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorkbenchEmptyArea } from '../src/foundation/WorkbenchEmptyArea.tsx'
import { WorkbenchEditorPicker } from '../src/foundation/WorkbenchEditorPicker.tsx'
import { selectableWorkbenchEditors } from '../src/foundation/editor-selection.ts'
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
  it('adds a root editor only to the chosen Area and retains its SVG in the tab', async () => {
    const { view, selectSession } = renderEmptyFrame()
    fireEvent.click((await view.findAllByRole('button', { name: '添加内页：团队笔记' }))[0]!)
    await view.findByTestId('private.notes')
    expect(view.getAllByRole('button', { name: '添加内页：团队笔记' })).toHaveLength(1)
    expect(view.getByRole('tab', { name: /当前内页：团队笔记/ }).querySelector('path')?.getAttribute('d')).toBe('M4 4h16v16H4Z')
    expect(selectSession).not.toHaveBeenCalled()
  })
  it('adds an unbound Session editor without starting or selecting a Session', async () => {
    const { view, selectSession } = renderEmptyFrame()
    fireEvent.click((await view.findAllByRole('button', { name: '添加内页：终端' }))[0]!)
    await waitFor(() => expect(view.queryByRole('tab', { name: /当前内页：终端/ })).not.toBeNull())
    expect(view.getByRole('button', { name: '选择此内页的对话' })).toBeDefined()
    expect(view.queryByTestId('workbench.terminal')).toBeNull()
    expect(selectSession).not.toHaveBeenCalled()
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
