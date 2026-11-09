// @vitest-environment jsdom
import React from 'react'
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { WorkbenchFrame, type WorkbenchFrameProps } from '../src/foundation/WorkbenchFrame.tsx'
import { WorkbenchFloatingWorkspace } from '../src/foundation/WorkbenchFloatingWorkspace.tsx'
import { FloatingWorkspaceContext, FloatingInstanceHost } from '../src/foundation/FloatingWorkspaceContext.tsx'
import { createFloatingWorkspaceRuntime } from '../src/client/floating-workspace-runtime.ts'
import { createSessionTab, defaultLayout, retargetSession, tabsOf, type TabDocument } from '../src/foundation/model.ts'
import { createPendingSessionTab } from '../src/foundation/editor-selection.ts'
import { migrateDocumentV2ToV3 } from '../src/foundation/document-v3.ts'
import type { WorkbenchEditorOwnerProps } from '../src/client/editor-slots.ts'
import type { WorkbenchEditorCatalogRow } from '../src/foundation/catalog.ts'

afterEach(cleanup)

const editor: WorkbenchEditorCatalogRow = {
  id: 'workbench.conversation', scope: 'session', label: '对话', icon: 'message',
  declaration: { editorId: 'workbench.conversation', scope: 'session', label: '对话', requiredBinding: 'session',
    state: { schemaVersion: 1, maxBytes: 1024, restore: 'if-valid', share: 'portable' },
    runtime: { background: 'keep', collapsed: 'keep', reacquire: 'on-visible' } },
}

function fixture(initial: TabDocument[] = []) {
  const layout = defaultLayout()
  if (layout.root.kind !== 'group') throw new Error('Expected one Area')
  layout.root.tabs = initial
  layout.root.activeTabId = initial[0]?.id
  const settings = { status: 'ready', revision: 1, writable: true, mode: 'host',
    value: { version: 2, layouts: { ungrouped: layout }, invalidLayouts: {}, sessionMarkers: {} } }
  const byId = Object.fromEntries(['a', 'b', 'c', 'outside', 'archived', 'blank'].map((id, index) => [id, {
    id, title: `对话 ${id}`, displayTitle: `对话 ${id}`, running: false, blank: id === 'blank', updatedAt: index + 1, retainedBy: {},
  }]))
  const sessions = { byId, ids: Object.keys(byId), phase: 'ready', current: 'a' }
  const workspaces = { items: [
    { workspaceId: 'project', title: '区域项目', path: '/bench/app', sessionIds: ['a', 'b', 'c', 'archived', 'blank'] },
    { workspaceId: 'outside-project', title: '其他项目', path: '/outside', sessionIds: ['outside'] },
  ], archivedSessionIds: ['archived'], phase: 'ready' }
  const directorySnapshot = { activeWorkbenchId: 'one', openWorkbenchIds: ['one'], rows: [{ workbenchId: 'one', name: '测试工作台' }], invalidRows: [], templates: [] }
  const areas = { [layout.root.id]: { relativePath: 'app', workspaceId: 'project', generation: 1 } }
  const document = migrateDocumentV2ToV3(layout)
  const createWorkspaceSession = vi.fn()
  const editors = [editor]
  const frame = {
    projectNeutral: true, renderSidebar: () => null,
    renderSlot: (_: string, owner: WorkbenchEditorOwnerProps) => <div data-testid="conversation-body" data-instance={owner.instanceId} data-session={owner.sessionId}>当前对话 {owner.sessionId}</div>,
    useSessions: (select: (state: unknown) => unknown) => select(sessions),
    useWorkspaces: (select: (state: unknown) => unknown) => select(workspaces),
    bindLayout: () => () => {}, bindNavigation: () => () => {}, selectSession: vi.fn(), createWorkspaceSession,
    settings: { getSnapshot: () => settings, subscribe: () => () => {}, patch: vi.fn(async () => ({ status: 'committed', revision: 2 })) },
    workbenchDirectory: { getSnapshot: () => directorySnapshot, getDocument: () => document, getAreaProjects: () => areas,
      subscribe: () => () => {} },
    editorCatalog: { getSnapshot: () => editors, subscribe: () => () => {} },
    sidebarCompatibility: { getSnapshot: () => undefined, subscribe: () => () => {} },
  } as unknown as WorkbenchFrameProps
  return { frame, layout, createWorkspaceSession }
}

it('asks for each of three Area conversation pages and limits choices to the Area project', async () => {
  const f = fixture()
  const view = render(<WorkbenchFrame {...f.frame} />)
  const ids: string[] = []
  for (const id of ['a', 'b', 'c']) {
    fireEvent.click(view.getByRole('button', { name: '添加内页标签' }))
    fireEvent.click(view.getByRole('menuitem', { name: '添加为标签 对话' }))
    expect(view.getByRole('listbox', { name: '可选择的对话' })).toBeTruthy()
    expect(view.queryByRole('option', { name: /对话 outside/ })).toBeNull()
    expect(view.queryByRole('option', { name: /对话 archived|对话 blank/ })).toBeNull()
    expect(view.queryByTestId('conversation-body')).toBeNull()
    fireEvent.click(view.getByRole('option', { name: new RegExp(`对话 ${id} ·`) }))
    await waitFor(() => expect(view.getByTestId('conversation-body').getAttribute('data-session')).toBe(id))
    ids.push(view.getByTestId('conversation-body').getAttribute('data-instance')!)
  }
  expect(new Set(ids).size).toBe(3)
  for (const [index, id] of ['a', 'b', 'c'].entries()) {
    const tab = view.container.querySelector(`[data-workbench-area-tab="${ids[index]}"] [role="tab"]`)
      ?? view.container.querySelector(`[data-workbench-area-tab="${ids[index]}"]`)
    fireEvent.click(tab!)
    expect(view.getByTestId('conversation-body').getAttribute('data-session')).toBe(id)
  }
  expect(f.createWorkspaceSession).not.toHaveBeenCalled()
})

it('resolves one pending page even when older pages share the same pending identity', () => {
  const layout = defaultLayout()
  if (layout.root.kind !== 'group') throw new Error('Expected Area')
  const one = createPendingSessionTab(editor, 'one', layout.root, [])
  const two = { ...one, id: 'two' }
  layout.root.tabs = [one, two]
  const next = retargetSession(layout, 'two', { sessionId: 'b', workspaceId: 'project' })
  expect(tabsOf(next.root)[0]).toEqual(one)
  expect(tabsOf(next.root)[1]?.sessionId).toBe('b')
  expect(createPendingSessionTab(editor, 'three', layout.root, layout.root.tabs).pendingBinding).not.toBe(one.pendingBinding)
})

it('cancels selection without borrowing a sibling and binds only the chosen pending page', async () => {
  const f = fixture([{ id: 'pending', editorId: editor.id, editorScope: 'session', pendingBinding: 'binding-1', lastKnownTitle: '等待选择', state: {} },
    createSessionTab('existing', editor.id, { sessionId: 'a', workspaceId: 'project' }, '已有对话')])
  const view = render(<WorkbenchFrame {...f.frame} />)
  fireEvent.click(view.getByRole('button', { name: '添加内页标签' }))
  fireEvent.click(view.getByRole('menuitem', { name: '添加为标签 对话' }))
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(view.queryByRole('listbox')).toBeNull()
  expect(view.getByRole('button', { name: '选择已有对话' })).toBeTruthy()
  fireEvent.click(view.getByRole('button', { name: '选择已有对话' }))
  fireEvent.click(view.getByRole('option', { name: /对话 b ·/ }))
  await waitFor(() => expect(view.getByTestId('conversation-body').getAttribute('data-session')).toBe('b'))
  fireEvent.click(view.container.querySelector('[data-workbench-area-tab="pending"] [role="tab"]')
    ?? view.container.querySelector('[data-workbench-area-tab="pending"]')!)
  expect(view.getByRole('button', { name: '选择已有对话' })).toBeTruthy()
  expect(f.createWorkspaceSession).not.toHaveBeenCalled()
})

it('adds floating conversations with independent selection and reuses the searchable binding menu', async () => {
  const f = fixture()
  const runtime = createFloatingWorkspaceRuntime(); runtime.setSurface(true, 'one')
  runtime.focusedWorkbenchId = 'one'; runtime.focusedBinding = { sessionId: 'a', workspaceId: 'project' }
  runtime.open('one', createSessionTab('original', editor.id, runtime.focusedBinding, '已有对话'))
  const canvas = document.createElement('div')
  const view = render(<FloatingWorkspaceContext.Provider value={runtime}><FloatingInstanceHost runtime={runtime} />
    <WorkbenchFloatingWorkspace runtime={runtime} workbenchId="one" canvasRef={{ current: canvas }} visible
      editors={[editor]} hidden={[]} extensionAccess={{ extensions: [] } as never} frame={f.frame} layout={f.layout} commit={() => true} pin={async () => true} />
  </FloatingWorkspaceContext.Provider>)
  for (const id of ['b', 'c']) {
    fireEvent.click(view.getByRole('button', { name: '添加临时内页' }))
    fireEvent.click(view.getByRole('menuitem', { name: '添加为标签 对话' }))
    const active = runtime.find(runtime.workspace('one').activeId!, 'one')!
    expect(active.tab.sessionId).toBeUndefined()
    expect(view.getByRole('button', { name: '选择已有对话' })).toBeTruthy()
    expect(view.getByRole('listbox', { name: '可选择的对话' })).toBeTruthy()
    fireEvent.change(view.getByRole('searchbox', { name: '搜索对话' }), { target: { value: `对话 ${id}` } })
    expect(view.getAllByRole('option')).toHaveLength(1)
    await act(async () => { fireEvent.click(view.getByRole('option', { name: new RegExp(`对话 ${id} ·`) })) })
    expect(active.tab.sessionId).toBe(id)
    runtime.focusedBinding = active.tab.binding
  }
  expect([...runtime.instances.values()].map(row => row.tab.sessionId)).toEqual(['a', 'b', 'c'])
  fireEvent.click(view.getByRole('button', { name: '浮动工作区菜单' }))
  fireEvent.click(view.getByRole('button', { name: '选择来源对话' }))
  expect(view.getByRole('searchbox', { name: '搜索对话' })).toBeTruthy()
  await act(async () => { fireEvent.click(view.getByRole('option', { name: /对话 a ·/ })) })
  expect([...runtime.instances.values()].map(row => row.tab.sessionId)).toEqual(['a', 'b', 'a'])
  expect(f.createWorkspaceSession).not.toHaveBeenCalled()
})
