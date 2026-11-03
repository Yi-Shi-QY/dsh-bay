// @vitest-environment jsdom
import React from 'react'
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WorkbenchEditorOwnerProps } from '../src/client/editor-slots.ts'
import { WorkbenchFrame } from '../src/foundation/WorkbenchFrame.tsx'
import { defaultLayout } from '../src/foundation/model.ts'

afterEach(cleanup)

describe('Prepared native Start through the Frame', () => {
  it.each(['accept', 'replace'] as const)('keeps one exact tab through preparation and %s', async action => {
    const layout = defaultLayout()
    if (layout.root.kind !== 'group') throw new Error('Expected Area')
    layout.root.tabs = [{
      id: 'native-start', editorId: 'workbench.conversation.start', editorScope: 'root',
      lastKnownTitle: '新建对话', state: {},
    }]
    layout.root.activeTabId = 'native-start'
    const settings = {
      status: 'ready', revision: 1, writable: true, mode: 'host',
      value: { version: 2, layouts: { ungrouped: layout }, invalidLayouts: {}, sessionMarkers: {} },
    }
    const sessions = {
      ids: ['created'], byId: { created: { id: 'created', displayTitle: '新会话', blank: true, running: false, cwd: '/w', retainedBy: {} } },
      current: 'official-current', phase: 'ready',
    }
    const workspaces = {
      items: [{ workspaceId: 'w', path: '/w', title: 'Workspace', sessionIds: ['created'] }],
      archivedSessionIds: [], phase: 'ready',
    }
    const entries = [
      { id: 'workbench.conversation.start', label: '新建对话', scope: 'root' },
      { id: 'workbench.conversation', label: '对话', scope: 'session' },
      { id: 'workbench.browser', label: '浏览器', scope: 'root' },
    ]
    let owner!: WorkbenchEditorOwnerProps
    const selectSession = vi.fn()
    const createWorkspaceSession = vi.fn(async () => ({
      target: { workspaceId: 'w', sessionId: 'created' }, reusedBlank: false,
    }))
    const patch = vi.fn(async () => ({ status: 'committed', revision: 2 }))
    const view = render(<WorkbenchFrame {...{
      projectNeutral: true, renderSidebar: () => null,
      renderSlot: (_: string, next: WorkbenchEditorOwnerProps, options: { only?: string }) => {
        owner = next
        return <div data-testid={options.only} />
      },
      useSessions: (select: (state: unknown) => unknown) => select(sessions),
      useWorkspaces: (select: (state: unknown) => unknown) => select(workspaces),
      bindLayout: () => () => {}, bindNavigation: () => () => {}, selectSession, createWorkspaceSession,
      settings: { getSnapshot: () => settings, subscribe: () => () => {}, patch },
      editorCatalog: { getSnapshot: () => entries, subscribe: () => () => {} },
      sidebarCompatibility: { getSnapshot: () => undefined, subscribe: () => () => {} },
    } as never} />)
    await act(async () => { await owner.placeConversation!({ workspaceId: 'w', presentation: 'start' }) })
    expect(owner).toMatchObject({
      instanceId: 'native-start', sessionId: 'created', workspaceId: 'w', bindingGeneration: 1,
    })
    expect(view.getByTestId('workbench.conversation.start')).toBeTruthy()
    expect(view.getAllByRole('tab')).toHaveLength(1)
    expect(createWorkspaceSession).toHaveBeenCalledOnce()
    expect(selectSession).not.toHaveBeenCalled()
    const prepared = owner
    if (action === 'replace') {
      fireEvent.click(view.getByRole('tab', { name: /当前内页：新建对话/ }))
      fireEvent.click(await view.findByRole('menuitem', { name: '切换为 浏览器' }))
    }
    act(() => {
      expect(prepared.completePreparedConversation!({
        moduleInstanceId: prepared.instanceId, bindingGeneration: prepared.bindingGeneration!,
        target: { workspaceId: 'w', sessionId: 'created' },
      })).toBe(action === 'accept')
    })
    await waitFor(() => expect(view.getByTestId(action === 'accept' ? 'workbench.conversation' : 'workbench.browser')).toBeTruthy())
    expect(view.getAllByRole('tab')).toHaveLength(1)
    expect(owner.instanceId).toBe('native-start')
    expect(selectSession).not.toHaveBeenCalled()
  })
})
