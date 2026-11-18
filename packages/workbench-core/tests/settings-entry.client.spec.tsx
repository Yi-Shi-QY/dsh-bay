// @vitest-environment jsdom
import React from 'react'
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { WorkbenchCoreInnerPage } from '../src/foundation/WorkbenchCoreInnerPage.tsx'
import { createWorkbenchModeController } from '../src/mode-controller.ts'
import { defaultLayout } from '../src/foundation/model.ts'
import { WorkbenchCoreSettingsSection } from '../src/foundation/WorkbenchCoreSettingsSection.tsx'
import { settingsFixture } from './settings-fixtures.ts'

beforeEach(() => {
  // jsdom has no native modal implementation; browser acceptance covers its
  // top layer, focus containment, Escape and focus restoration.
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true,
    value: function (this: HTMLDialogElement) { this.setAttribute('open', '') } })
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true,
    value: function (this: HTMLDialogElement) { this.removeAttribute('open') } })
})
afterEach(() => {
  cleanup()
  Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal')
  Reflect.deleteProperty(HTMLDialogElement.prototype, 'close')
})

function bench(coreOnly = false) {
  const pendingInteractions = new Map()
  const modeController = createWorkbenchModeController()
  const settings = { status: 'ready', revision: 1, writable: true, mode: 'host', base: {}, user: {},
    value: { version: 2, layouts: { ungrouped: defaultLayout('bound', 'workspace:w') }, invalidLayouts: {}, sessionMarkers: {} } }
  const sessions = { ids: ['bound'], byId: { bound: { id: 'bound', title: '对话', displayTitle: '对话', cwd: '/w', retainedBy: { mainView: 1 } } },
    current: 'bound', phase: 'ready', subagentsByParent: {}, jobsBySession: {} }
  const workspaces = { items: [{ workspaceId: 'w', path: '/w', title: '项目', sessionIds: ['bound'] }], archivedSessionIds: [], phase: 'ready' }
  const entries = coreOnly ? [] : [{ id: 'workbench.conversation', label: '对话', scope: 'session' }]
  const editorCatalog = { getSnapshot: () => entries, subscribe: () => () => {} }
  const snapshot = { ...settings, value: undefined }
  const view = render(<WorkbenchCoreInnerPage {...{
    modeController,
    workbenchSettings: { getSnapshot: () => snapshot, subscribe: () => () => {} },
    settingsPage: { editorCatalog },
    sidebarHostActions: { sessionStatus: { getSnapshot: () => pendingInteractions, subscribe: () => () => {} } },
    renderSlot: () => <input aria-label="Area draft" />,
    useSessions: (select: (state: unknown) => unknown) => select(sessions),
    useWorkspaces: (select: (state: unknown) => unknown) => select(workspaces),
    settings: { getSnapshot: () => settings, subscribe: () => () => {}, patch: async () => ({ status: 'committed', revision: 2 }) },
    editorCatalog,
    sidebarCompatibility: { getSnapshot: () => undefined, subscribe: () => () => {} },
  } as never} />)
  return { view, modeController }
}

describe('Workbench Settings entry', () => {
  it('provides all four current-workbench sections from the browser settings entry', () => {
    const editors: never[] = []
    const settings = { status: 'ready', revision: 1, writable: true, mode: 'host', value: settingsFixture() }
    const view = render(<WorkbenchCoreSettingsSection {...{
      settingsContext: { mode: 'browser-workbench', workbenchId: 'a' }, openOptions: { section: 'interactions' },
      editorCatalog: { getSnapshot: () => editors, subscribe: () => () => {} },
      useWorkbenchSettings: (select: (state: unknown) => unknown) => select(settings),
      useSessions: (select: (state: unknown) => unknown) => select({ ids: [], byId: {} }),
      useWorkspaces: (select: (state: unknown) => unknown) => select({ items: [] }), close: () => {},
    } as never} />)
    expect(view.getAllByRole('tab').map(tab => tab.textContent)).toEqual(['当前工作台', '使用中的内页', '背景 AI', '导入与分享'])
    expect(view.getByRole('tabpanel', { name: '背景 AI' })).toBeTruthy()
    expect(view.queryByRole('tab', { name: '交互偏好' })).toBeNull()
    expect(view.queryByLabelText('新建工作台提示词')).toBeNull()
    fireEvent.click(view.getByRole('tab', { name: '导入与分享' }))
    expect(view.getByRole('tabpanel', { name: '导入与分享' })).toBeTruthy()
  })
  it('opens the migrated settings without exiting or remounting the Frame', async () => {
    const { view, modeController } = bench()
    expect(view.container.innerHTML).toBe('')
    await act(async () => { await modeController.enter() })
    const frame = view.baseElement.querySelector('[data-workbench]')
    const draft = view.getByLabelText('Area draft')
    expect(frame).not.toBeNull()
    const trigger = view.getByRole('button', { name: '设置', exact: true })
    fireEvent.click(trigger)
    await view.findByRole('dialog', { name: '工作台设置' })
    expect(view.queryByRole('tab', { name: '工作台管理' })).toBeNull()
    expect(view.queryByRole('tab', { name: '导入与分享' })).toBeNull()
    fireEvent.click(view.getByRole('tab', { name: '内页与扩展' }))
    expect(view.getByRole('heading', { name: '内页与扩展' })).toBeDefined()
    expect(modeController.getSnapshot().mode).toBe('workbench')
    fireEvent.click(view.getByRole('button', { name: '关闭工作台设置' }))
    expect(view.queryByRole('dialog')).toBeNull()
    expect(view.baseElement.querySelector('[data-workbench]')).toBe(frame)
    fireEvent.click(trigger)
    fireEvent(view.getByRole('dialog'), new Event('cancel', { bubbles: false, cancelable: true }))
    await waitFor(() => expect(view.queryByRole('dialog')).toBeNull())
    await act(async () => { await modeController.exit() })
    expect(view.container.querySelector('[data-workbench]')).toBeNull()
    expect(view.container.querySelector('[data-workbench-instance-parking] input')).toBe(draft)
    expect(view.baseElement.querySelector('[data-workbench-inner-page]')).toBeNull()
    await act(async () => { await modeController.enter() })
    expect(view.queryByRole('dialog')).toBeNull()
    view.unmount()
    expect(document.querySelector('[data-workbench-inner-page]')).toBeNull()
  })

  it('provides Settings and the catalog input before any optional Module is installed', async () => {
    const { view, modeController } = bench(true)
    await act(async () => { await modeController.enter() })
    fireEvent.click(view.getByRole('button', { name: '工作台设置', exact: true }))
    await view.findByRole('dialog', { name: '工作台设置' })
    fireEvent.click(view.getByRole('tab', { name: '内页与扩展' }))
    expect(view.getByRole('heading', { name: '内页与扩展' })).toBeDefined()
    expect(modeController.getSnapshot().mode).toBe('workbench')
  })
})
