// @vitest-environment jsdom
import React from 'react'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorkbenchFrame } from '../src/foundation/WorkbenchFrame.tsx'
import { defaultLayout } from '../src/foundation/model.ts'
import { createWorkbenchRuntimeMetrics } from '../src/foundation/workbench-runtime-metrics.ts'

afterEach(cleanup)

describe('Start entry in a bound Area', () => {
  it('offers Start without altering the official current Session', async () => {
    const layout = defaultLayout('bound', 'workspace:w')
    const settings = { status: 'ready', revision: 1, writable: true, mode: 'host', base: {}, user: {},
      value: { version: 2, layouts: { 'workspace:w': layout }, invalidLayouts: {}, sessionMarkers: {} } }
    const sessions = { ids: ['bound'], byId: { bound: { id: 'bound', title: '已有对话', displayTitle: '已有对话', cwd: '/w', retainedBy: { mainView: 1 } } },
      current: 'bound', phase: 'ready', subagentsByParent: {}, jobsBySession: {} }
    const workspaces = { items: [{ workspaceId: 'w', path: '/w', title: '项目', sessionIds: ['bound'] }], archivedSessionIds: [], phase: 'ready' }
    const entries = [
      { id: 'workbench.conversation.start', label: '新建对话', scope: 'root' },
      { id: 'workbench.conversation', label: '对话', scope: 'session' },
    ]
    const selectSession = vi.fn()
    const runtimeMetrics = createWorkbenchRuntimeMetrics()
    let renderedOwner: { lifecycle?: { visibility: string; focused: boolean } } | undefined
    const view = render(<WorkbenchFrame {...{
      renderSidebar: () => null,
      renderSlot: (_name: string, owner: unknown, options: { only?: string }) => {
        renderedOwner = owner as { lifecycle?: { visibility: string; focused: boolean } }
        return <div data-testid={options.only} />
      },
      useSessions: (select: (state: unknown) => unknown) => select(sessions),
      useWorkspaces: (select: (state: unknown) => unknown) => select(workspaces),
      bindLayout: () => () => {}, bindNavigation: () => () => {}, selectSession,
      settings: { getSnapshot: () => settings, subscribe: () => () => {}, patch: async () => ({ status: 'committed', revision: 2 }) },
      editorCatalog: { getSnapshot: () => entries, subscribe: () => () => {} },
      sidebarCompatibility: { getSnapshot: () => undefined, subscribe: () => () => {} },
      runtimeMetrics,
    } as never} />)
    await view.findByTestId('workbench.conversation')
    expect(renderedOwner?.lifecycle).toMatchObject({ visibility: 'visible', focused: true })
    expect(runtimeMetrics.getSnapshot()).toMatchObject({
      view: { areas: 1, tabs: 1, visibleAreas: 1 }, mountedEditorOutlets: 1,
    })
    fireEvent.click(view.getByRole('button', { name: '添加内页标签' }))
    fireEvent.click(await view.findByRole('menuitem', { name: '添加为标签 新建对话' }))
    await waitFor(() => expect(view.queryByTestId('workbench.conversation.start')).not.toBeNull())
    expect(view.getByRole('tab', { name: '切换到对话' })).toBeTruthy()
    expect(selectSession).not.toHaveBeenCalled()
  })

  it('replaces the active tab in place and adds a separate tab from the Area plus button', async () => {
    const layout = defaultLayout('bound', 'workspace:w')
    const settings = { status: 'ready', revision: 1, writable: true, mode: 'host', base: {}, user: {},
      value: { version: 2, layouts: { 'workspace:w': layout }, invalidLayouts: {}, sessionMarkers: {} } }
    const sessions = { ids: ['bound'], byId: { bound: { id: 'bound', title: '已有对话', displayTitle: '已有对话', cwd: '/w', retainedBy: { mainView: 1 } } },
      current: 'bound', phase: 'ready', subagentsByParent: {}, jobsBySession: {} }
    const workspaces = { items: [{ workspaceId: 'w', path: '/w', title: '项目', sessionIds: ['bound'] }], archivedSessionIds: [], phase: 'ready' }
    const entries = [
      { id: 'workbench.conversation.start', label: '新建对话', scope: 'root' },
      { id: 'workbench.conversation', label: '对话', scope: 'session' },
      { id: 'workbench.browser', label: '浏览器', scope: 'root' },
    ]
    const view = render(<WorkbenchFrame {...{
      renderSidebar: () => null,
      renderSlot: (_name: string, _owner: unknown, options: { only?: string }) => <div data-testid={options.only} />,
      useSessions: (select: (state: unknown) => unknown) => select(sessions),
      useWorkspaces: (select: (state: unknown) => unknown) => select(workspaces),
      bindLayout: () => () => {}, bindNavigation: () => () => {}, selectSession: vi.fn(),
      settings: { getSnapshot: () => settings, subscribe: () => () => {}, patch: async () => ({ status: 'committed', revision: 2 }) },
      editorCatalog: { getSnapshot: () => entries, subscribe: () => () => {} },
      sidebarCompatibility: { getSnapshot: () => undefined, subscribe: () => () => {} },
    } as never} />)

    fireEvent.click(await view.findByRole('tab', { name: /当前内页：对话/ }))
    fireEvent.click(await view.findByRole('menuitem', { name: '切换为 浏览器' }))
    await waitFor(() => expect(view.getAllByRole('tab')).toHaveLength(1))
    expect(view.getByRole('tab', { name: /当前内页：浏览器/ })).toBeTruthy()

    fireEvent.click(view.getByRole('button', { name: '添加内页标签' }))
    fireEvent.click(await view.findByRole('menuitem', { name: '添加为标签 浏览器' }))
    await waitFor(() => expect(view.getAllByRole('tab')).toHaveLength(2))
    expect(view.getAllByRole('tab').some(tab => tab.getAttribute('aria-label')?.startsWith('切换到浏览器'))).toBe(true)
  })
})
