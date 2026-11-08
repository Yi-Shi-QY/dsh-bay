// @vitest-environment jsdom
import React from 'react'
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorkbenchFrame, type WorkbenchFrameProps } from '../src/foundation/WorkbenchFrame.tsx'
import { createSessionTab, defaultLayout } from '../src/foundation/model.ts'
import type { WorkbenchEditorOwnerProps } from '../src/client/editor-slots.ts'
import type { SettingsScopePatchResult, SettingsScopeSnapshot } from '../src/client/workbench-settings-contracts.ts'
import type { WorkbenchSettings } from '../src/foundation/persistence.ts'
import { migrateDocumentV2ToV3 } from '../src/foundation/document-v3.ts'
import type { WorkbenchLayoutDocument } from '../src/foundation/model.ts'
import { createWorkbenchRuntimeMetrics } from '../src/foundation/workbench-runtime-metrics.ts'
import type { WorkbenchWindowControllerV1 } from '../src/client/workbench-window-controller.ts'
import type { WorkbenchShareControllerV1 } from '../src/client/workbench-share-controller.ts'
import type { ConversationTabStatusSource, ConversationTabStatus } from '../src/client/conversation-tab-status.ts'

afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals() })

function setup(
  patch: (operation: unknown) => Promise<SettingsScopePatchResult>,
  collapsed?: 'keep' | 'dispose',
  tabTitles: readonly string[] = ['测试内页'],
  windowController?: WorkbenchWindowControllerV1,
  desktopControls?: { openSettings: () => void },
  browserContext?: {
    onImportWorkbench?: () => void
    browserView?: boolean
    browserWorkbenchId?: string
    requestBrowserReclaim?: (workbenchId: string) => Promise<boolean>
    shareController?: WorkbenchShareControllerV1
  },
  projectNeutralOverride?: boolean,
  nestedSplit?: boolean,
  nestedCollapsedSplit?: boolean,
  boundSession = false,
  showSessionAccentFrames = true,
  conversationStatus?: ConversationTabStatusSource,
  interactionPolicy?: WorkbenchFrameProps['conversationResourcePolicy'],
  pendingConversation = false,
  legacyUnboundConversation = false,
  availableSession = false,
) {
  const editorId = conversationStatus || pendingConversation || legacyUnboundConversation ? 'workbench.conversation' : 'test.editor'
  const sessionEditor = boundSession || pendingConversation || legacyUnboundConversation
  const layout = defaultLayout()
  const first = layout.root
  if (first.kind !== 'group') throw new Error('fixture must have one Area')
  first.tabs = pendingConversation
    ? tabTitles.map((title, index) => ({
      id: 'test-page-' + String(index + 1), editorId, editorScope: 'session' as const,
      pendingBinding: 'binding-' + String(index + 1), lastKnownTitle: title, state: {},
    }))
    : legacyUnboundConversation
      ? tabTitles.map((title, index) => ({
        id: 'test-page-' + String(index + 1), editorId, editorScope: 'session' as const,
        lastKnownTitle: title, state: {},
      }))
    : boundSession
    ? tabTitles.map((title, index) => createSessionTab(
      `test-page-${String(index + 1)}`, editorId, { workspaceId: 'workspace-a', sessionId: 'session-a' }, title,
    ))
    : tabTitles.map((title, index) => ({
      id: `test-page-${String(index + 1)}`, editorId: 'test.editor', editorScope: 'root' as const, lastKnownTitle: title, state: {},
    }))
  first.activeTabId = first.tabs[0]!.id
  const targetLayout = structuredClone(layout)
  if (targetLayout.root.kind !== 'group') throw new Error('fixture must have one target Area')
  targetLayout.root.tabs[0]!.lastKnownTitle = 'Workbench B page'
  const documents = new Map([
    ['one', migrateDocumentV2ToV3(layout)],
    ['two', migrateDocumentV2ToV3(targetLayout)],
  ])
  if (nestedCollapsedSplit) {
    const second = {
      ...structuredClone(first), id: 'collapsed-split-expanded-area', activeTabId: 'expanded-page-b',
      tabs: [{ ...structuredClone(first.tabs[0]!), id: 'expanded-page-b', lastKnownTitle: 'Expanded area B' }],
    }
    const third = {
      ...structuredClone(first), id: 'outer-expanded-area', activeTabId: 'expanded-page-c',
      tabs: [{ ...structuredClone(first.tabs[0]!), id: 'expanded-page-c', lastKnownTitle: 'Expanded area C' }],
    }
    layout.root = {
      kind: 'split', id: 'resize-parent-split', axis: 'horizontal', ratio: 0.5,
      first: { kind: 'split', id: 'collapsed-child-split', axis: 'vertical', ratio: 0.5, first, second },
      second: third,
    }
  } else if (nestedSplit) {
    const second = {
      ...structuredClone(first), id: 'active-area-b', activeTabId: 'active-page-b',
      tabs: [{ ...structuredClone(first.tabs[0]!), id: 'active-page-b', lastKnownTitle: 'Active area B' }],
    }
    const third = {
      ...structuredClone(first), id: 'active-area-c', activeTabId: 'active-page-c',
      tabs: [{ ...structuredClone(first.tabs[0]!), id: 'active-page-c', lastKnownTitle: 'Active area C' }],
    }
    layout.root = {
      kind: 'split', id: 'outer-split', axis: 'vertical', ratio: 0.5, first,
      second: { kind: 'split', id: 'active-split', axis: 'horizontal', ratio: 0.5, first: second, second: third },
    }
  } else if (collapsed !== undefined) {
    layout.root = {
      kind: 'split', id: 'test-split', axis: 'horizontal', ratio: 0.5, first,
      second: { ...first, id: 'other-area', activeTabId: 'other-page', tabs: [{ ...first.tabs[0]!, id: 'other-page' }] },
    }
  }
  let snapshot: SettingsScopeSnapshot<WorkbenchSettings> = {
    status: 'ready', revision: 1, writable: true, mode: 'host',
    value: { version: 2, layouts: { ungrouped: layout }, invalidLayouts: {}, sessionMarkers: {} },
  }
  const listeners = new Set<() => void>()
  const settings = {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener) },
    set: vi.fn(), unset: vi.fn(), patch: vi.fn(patch),
  }
  const sessions = boundSession || availableSession
    ? { ids: ['session-a'], byId: { 'session-a': { id: 'session-a', title: '\u7ed1\u5b9a\u5bf9\u8bdd', displayTitle: '\u7ed1\u5b9a\u5bf9\u8bdd', running: true, blank: false, updatedAt: 1, retainedBy: { mainView: 1 } } }, phase: 'ready' }
    : { byId: {}, ids: [], phase: 'ready' }
  const workspaces = boundSession || availableSession
    ? { items: [{ workspaceId: 'workspace-a', title: '\u7ed1\u5b9a\u9879\u76ee', path: '/workspace-a', sessionIds: ['session-a'] }], archivedSessionIds: [], phase: 'ready' }
    : { items: [], archivedSessionIds: [], phase: 'ready' }
  const entries = [{
    id: editorId, scope: sessionEditor ? 'session' as const : 'root' as const, label: '测试内页',
    declaration: {
      editorId, scope: sessionEditor ? 'session' as const : 'root' as const, label: '测试内页', requiredBinding: sessionEditor ? 'session' as const : 'none' as const,
      state: { schemaVersion: 1, maxBytes: 1024, restore: 'if-valid', share: 'portable' },
      runtime: { background: 'dispose', collapsed: collapsed ?? 'keep', reacquire: 'on-visible' },
    },
  }]
  let owner: WorkbenchEditorOwnerProps | undefined
  const owners = new Map<string, WorkbenchEditorOwnerProps>()
  let flush: (() => Promise<boolean>) | undefined
  const metrics = createWorkbenchRuntimeMetrics()
  let directorySnapshot: { activeWorkbenchId: string; openWorkbenchIds: string[]; rows: Array<{ workbenchId: string; name: string; layoutLocked?: boolean }>; invalidRows: never[]; templates: never[] } = { activeWorkbenchId: 'one', openWorkbenchIds: ['one', 'two'], rows: [
    { workbenchId: 'one', name: 'Workbench A' }, { workbenchId: 'two', name: 'Workbench B' },
  ], invalidRows: [], templates: [] }
  const directoryListeners = new Set<() => void>()
  const reorder = vi.fn(async (workbenchId: string, targetIndex: number) => {
    const next = directorySnapshot.openWorkbenchIds.filter(id => id !== workbenchId)
    next.splice(targetIndex, 0, workbenchId)
    directorySnapshot = { ...directorySnapshot, openWorkbenchIds: next }
    for (const listener of directoryListeners) listener()
    return { status: 'committed' as const, revision: 2 }
  })
  const saveTemplate = vi.fn(async (_name: string, _document: WorkbenchLayoutDocument) => ({ status: 'committed' as const, revision: 2 }))
  const setLayoutLocked = vi.fn(async (workbenchId: string, locked: boolean) => {
    directorySnapshot = {
      ...directorySnapshot,
      rows: directorySnapshot.rows.map(row => {
        if (row.workbenchId !== workbenchId) return row
        const { layoutLocked: _previous, ...withoutLayoutLock } = row
        return locked ? { ...withoutLayoutLock, layoutLocked: true } : withoutLayoutLock
      }),
    }
    for (const listener of directoryListeners) listener()
    return { status: 'committed' as const, revision: 2 }
  })
  const unload = vi.fn(async (workbenchId: string) => {
    directorySnapshot = {
      ...directorySnapshot,
      openWorkbenchIds: directorySnapshot.openWorkbenchIds.filter(id => id !== workbenchId),
    }
    for (const listener of directoryListeners) listener()
    return { status: 'committed' as const, revision: 2 }
  })
  const view = render(<WorkbenchFrame {...{
    projectNeutral: projectNeutralOverride ?? desktopControls === undefined,
    ...(desktopControls === undefined ? {} : { embeddedDesktop: true, desktopControls }),
    renderSidebar: () => null,
    renderSlot: (_name: string, value: WorkbenchEditorOwnerProps) => {
      owner = value
      owners.set(value.areaId!, value)
      return <div>测试内容</div>
    },
    useSessions: (select: (state: unknown) => unknown) => select(sessions),
    useWorkspaces: (select: (state: unknown) => unknown) => select(workspaces),
    bindLayout: () => () => {}, bindNavigation: () => () => {}, selectSession: vi.fn(),
    settings, runtimeMetrics: metrics,
    conversationStatus,
    ...(interactionPolicy === undefined ? {} : { conversationResourcePolicy: interactionPolicy }),
    showSessionAccentFrames,
    ...(browserContext ?? {}),
    ...(windowController === undefined ? {} : { windowController }),
    workbenchDirectory: {
      getSnapshot: () => directorySnapshot,
      getDocument: (workbenchId: string) => {
        const document = documents.get(workbenchId)
        return document === undefined ? undefined : structuredClone(document)
      },
      subscribe: listener => { directoryListeners.add(listener); return () => directoryListeners.delete(listener) },
      select: vi.fn(async (workbenchId: string) => {
        if (flush !== undefined && !await flush()) return { status: 'unavailable' as const }
        if (!directorySnapshot.openWorkbenchIds.includes(workbenchId)) return { status: 'unavailable' as const }
        snapshot = { ...snapshot, value: { ...snapshot.value!, layouts: { ungrouped: layout } } }
        for (const listener of listeners) listener()
        directorySnapshot = { ...directorySnapshot, activeWorkbenchId: workbenchId }
        for (const listener of directoryListeners) listener()
        return { status: 'committed' as const, revision: 2 }
      }),
      reorder,
      saveTemplate,
      setLayoutLocked,
      unload,
      setBeforeLifecycleTransition: (handler: () => Promise<boolean>) => { flush = handler; return () => { flush = undefined } },
    },
    editorCatalog: { getSnapshot: () => entries, subscribe: () => () => {} },
    sidebarCompatibility: { getSnapshot: () => undefined, subscribe: () => () => {} },
  } as never} />)
  return {
    view, settings, metrics, owners, persistedLayout: layout, reorder, saveTemplate, setLayoutLocked, unload, documents,
    edit: (value: number) => act(() => owner!.setState({ value })),
    rename: (workbenchId: string, name: string) => act(() => {
      directorySnapshot = { ...directorySnapshot, rows: directorySnapshot.rows.map(row =>
        row.workbenchId === workbenchId ? { ...row, name } : row,
      ) }
      for (const listener of directoryListeners) listener()
    }),
    flush: () => flush!(),
    status: (status: SettingsScopeSnapshot<WorkbenchSettings>['status']) => act(() => {
      snapshot = { ...snapshot, status }
      for (const notify of listeners) notify()
    }),
    setRemoteLayout: (next: WorkbenchLayoutDocument) => act(() => {
      snapshot = { ...snapshot, revision: (snapshot.revision ?? 0) + 1, value: { ...snapshot.value!, layouts: { ungrouped: next } } }
      for (const notify of listeners) notify()
    }),
  }
}

async function advance(ms: number) { await act(async () => { await vi.advanceTimersByTimeAsync(ms) }) }

describe('Frame layout persistence', () => {
  it('applies tab label preferences and keeps Area menu close available', () => {
    const h = setup(async () => ({ status: 'committed', revision: 2 }), undefined, ['偏好验证'],
      undefined, undefined, undefined, undefined, false, false, false, true, undefined,
      { tabFontSize: 'larger', showTabCloseButtons: false })
    const tab = h.view.container.querySelector('[data-workbench-area-tab="test-page-1"]')!
    const label = tab.querySelector<HTMLElement>('[style*="font-size"]')!
    expect(label.textContent).toBe('偏好验证')
    expect(label.style.fontSize).toBe('14px')
    expect(tab.querySelector('button[aria-label^="关闭"]')).toBeNull()

    fireEvent.click(h.view.getByRole('button', { name: '区域操作' }))
    fireEvent.click(h.view.getByRole('menuitem', { name: '关闭当前视图' }))
    expect(h.view.container.querySelector('[data-workbench-area-tab="test-page-1"]')).toBeNull()
  })

  it('shows a designed pending-conversation state and opens the existing binding picker', () => {
    const h = setup(async () => ({ status: 'committed', revision: 2 }), undefined, ['对话'],
      undefined, undefined, undefined, false, false, false, false, true, undefined, undefined, true)
    const pending = h.view.container.querySelector('[data-workbench-pending-binding]')!
    expect(pending.querySelector('h2')?.textContent).toBe('连接一个已有对话')
    expect(pending.textContent).toContain('对应的工具和运行状态')
    expect(pending.querySelector('[aria-label="绑定步骤"]')?.children).toHaveLength(2)
    expect(pending.querySelector('[data-workbench-bind-conversation]')).toBeTruthy()
    expect(h.view.getByRole('button', { name: '选择已有对话' })).toBeTruthy()

    fireEvent.click(h.view.getByRole('button', { name: '选择已有对话' }))
    expect(h.view.getByRole('listbox', { name: '可绑定的对话' })).toBeTruthy()
    expect(h.view.getByText(/没有可绑定的非空对话/)).toBeTruthy()
    expect(h.view.queryByRole('button', { name: /新建对话/ })).toBeNull()
  })

  it('binds an unbound conversation page to the selected existing session', () => {
    const h = setup(async () => ({ status: 'committed', revision: 2 }), undefined, ['旧对话'],
      undefined, undefined, undefined, undefined, false, false, false, false, undefined, undefined, false, true, true)
    expect(h.view.container.querySelector('[data-workbench-pending-binding]')).toBeTruthy()

    fireEvent.click(h.view.getByRole('button', { name: '选择已有对话' }))
    fireEvent.click(h.view.getByRole('option', { name: /绑定对话/ }))

    expect(h.view.container.querySelector('[data-workbench-pending-binding]')).toBeNull()
    expect(h.view.getByRole('button', { name: /绑定对话/ })).toBeTruthy()
  })

  it('updates conversation status across duplicate tabs, overview and collapsed preview without saving layout', async () => {
    vi.useFakeTimers()
    let states: ReadonlyMap<string, ConversationTabStatus> = new Map([['session-a', { status: 'running', label: '进行中' }]])
    const listeners = new Set<() => void>()
    const off = vi.fn()
    const source: ConversationTabStatusSource = { getSnapshot: () => states, subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener) } }, watch: vi.fn(() => off) }
    const h = setup(async () => ({ status: 'committed', revision: 2 }), 'dispose', ['对话一', '对话二'], undefined, undefined, undefined, undefined, false, false, true, true, source)
    h.settings.patch.mockClear() // Initial marker allocation is unrelated to transient tab status.
    const change = (state: ConversationTabStatus) => act(() => { states = new Map([['session-a', state]]); for (const listener of listeners) listener() })
    expect(source.watch).toHaveBeenCalledWith(['session-a'])
    change({ status: 'attention', label: '等待审批' })
    for (const el of h.view.container.querySelectorAll('[role=tab][aria-description]')) {
      expect(el.getAttribute('aria-description')).toContain('等待审批')
      expect(el.querySelector('[data-tab-status=attention]')).not.toBeNull()
    }
    expect(h.settings.patch).not.toHaveBeenCalled()
    fireEvent.click(h.view.getAllByRole('button', { name: /查看全部内页/ })[0]!)
    expect(h.view.getByRole('option', { name: /对话二.*等待审批/ })).toBeTruthy()
    fireEvent.click(h.view.getByRole('option', { name: /对话二/ }))
    change({ status: 'completed', label: '本轮已完成' })
    const area = h.view.container.querySelector<HTMLElement>('[data-workbench-group="group-main"]')!
    const collapse = area.querySelector<HTMLElement>('[data-area-collapse-toggle]')!
    fireEvent.click(collapse)
    expect(area.hasAttribute('data-area-collapsed')).toBe(true)
    expect(area.querySelectorAll('[data-tab-status=completed]')).toHaveLength(2)
    fireEvent.pointerEnter(collapse); await advance(300)
    const preview = document.querySelector('[data-area-collapse-info]')!
    expect(preview.querySelectorAll('span[data-tab-status=completed]')).toHaveLength(2)
    expect(preview.textContent).toContain('本轮已完成')
    change({ status: 'stopped', label: '本轮已停止' })
    expect(preview.querySelectorAll('span[data-tab-status=stopped]')).toHaveLength(2)
    h.view.unmount(); expect(off).toHaveBeenCalledTimes(2)
  })

  it('allows the minimal presentation to hide marker frame paint without removing the binding marker', () => {
    const h = setup(async () => ({ status: 'committed', revision: 2 }), undefined, ['绑定对话内页'], undefined, undefined, undefined, undefined, false, false, true, false)
    const canvas = h.view.container.querySelector('[data-workbench-canvas]')
    expect(canvas?.getAttribute('data-session-accent-frames')).toBe('hidden')
    expect(canvas?.querySelector('[data-session-frame="area"]')).not.toBeNull()
  })

  it('scrolls overflowing Area tabs with either wheel axis without selecting a tab', () => {
    const h = setup(async () => ({ status: 'committed', revision: 2 }), undefined, ['前台内页', '后台内页'])
    const tabs = h.view.getByRole('tablist', { name: '区域内页' })
    Object.defineProperties(tabs, { clientWidth: { value: 200 }, scrollWidth: { value: 800 } })
    const wheel = (target: Element, init: WheelEventInit) => {
      const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, ...init })
      fireEvent(target, event)
      return event
    }
    expect(wheel(h.view.getByRole('tab', { name: /当前内页：前台内页/ }), { deltaY: 80 }).defaultPrevented).toBe(true)
    expect(tabs.scrollLeft).toBe(80)
    wheel(h.view.getByRole('button', { name: '添加内页标签' }), { deltaY: -20 })
    expect(tabs.scrollLeft).toBe(60)
    wheel(tabs, { deltaX: 35, deltaY: 4 })
    expect(tabs.scrollLeft).toBe(95)
    wheel(tabs, { deltaY: 2, deltaMode: 1 })
    expect(tabs.scrollLeft).toBe(127)
    wheel(tabs, { deltaY: 1, deltaMode: 2 })
    expect(tabs.scrollLeft).toBe(327)
    wheel(tabs, { deltaY: 900 })
    expect(tabs.scrollLeft).toBe(600)
    wheel(tabs, { deltaY: -900 })
    expect(tabs.scrollLeft).toBe(0)
    expect(h.view.getByRole('tab', { name: /当前内页：前台内页/ }).getAttribute('aria-selected')).toBe('true')
    expect(h.settings.patch).not.toHaveBeenCalled()
  })

  it('preserves modified wheel input and leaves non-overflowing tabs and Area content alone', () => {
    const h = setup(async () => ({ status: 'committed', revision: 2 }))
    const tabs = h.view.getByRole('tablist', { name: '区域内页' })
    Object.defineProperties(tabs, { clientWidth: { value: 200 }, scrollWidth: { value: 800, configurable: true } })
    for (const modifier of ['ctrlKey', 'metaKey', 'altKey']) {
      const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 80, [modifier]: true })
      fireEvent(tabs, event)
      expect(event.defaultPrevented).toBe(false)
      expect(tabs.scrollLeft).toBe(0)
    }
    const contentWheel = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 80 })
    fireEvent(h.view.getByText('测试内容'), contentWheel)
    expect(contentWheel.defaultPrevented).toBe(false)
    expect(tabs.scrollLeft).toBe(0)
    Object.defineProperty(tabs, 'scrollWidth', { value: 200 })
    const noOverflowWheel = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 80 })
    fireEvent(tabs, noOverflowWheel)
    expect(noOverflowWheel.defaultPrevented).toBe(false)
    expect(tabs.scrollLeft).toBe(0)
  })

  it('detaches the current tab through the narrow Area menu without copying it', async () => {
    const h = setup(async () => ({ status: 'committed', revision: 2 }), undefined, ['拆出内页', '保留内页'])
    fireEvent.click(h.view.getByRole('button', { name: '区域操作' }))
    fireEvent.click(h.view.getByRole('menuitem', { name: '拆出当前内页' }))
    expect(h.view.container.querySelectorAll('[data-workbench-group]')).toHaveLength(2)
    expect(h.view.container.querySelectorAll('[data-workbench-area-tab]')).toHaveLength(2)
    expect(h.view.container.querySelectorAll('[data-workbench-area-tab="test-page-1"]')).toHaveLength(1)
  })

  it('keeps adding and switching pages reachable through the narrow Area menu', async () => {
    const h = setup(async () => ({ status: 'committed', revision: 2 }), undefined, ['前台内页', '后台内页'])
    fireEvent.click(h.view.getByRole('button', { name: '区域操作' }))
    fireEvent.click(h.view.getByRole('menuitem', { name: '添加内页' }))
    expect(h.view.getByRole('searchbox', { name: '搜索内页' })).toBeDefined()
    expect(h.view.getByRole('button', { name: '区域操作' }).getAttribute('aria-expanded')).toBe('true')
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(document.activeElement).toBe(h.view.getByRole('button', { name: '区域操作' }))
    fireEvent.click(h.view.getByRole('button', { name: '区域操作' }))
    fireEvent.click(h.view.getByRole('menuitem', { name: '查看全部内页' }))
    fireEvent.click(h.view.getByRole('option', { name: /后台内页/ }))
    expect(h.view.getByRole('tab', { name: /当前内页：后台内页/ }).getAttribute('aria-selected')).toBe('true')
    fireEvent.click(h.view.getByRole('button', { name: '区域操作' }))
    fireEvent.click(h.view.getByRole('menuitem', { name: '关闭当前视图' }))
    expect(h.view.queryByRole('tab', { name: /后台内页/ })).toBeNull()
    expect(h.view.getByRole('tab', { name: /当前内页：前台内页/ })).toBeDefined()
  })

  it('routes rail import independently of desktop geometry', async () => {
    const onImportWorkbench = vi.fn()
    const h = setup(async () => ({ status: 'committed', revision: 2 }), undefined, undefined, undefined, undefined, { onImportWorkbench })
    fireEvent.click(h.view.getByRole('button', { name: '新建工作台', exact: true }))
    expect(h.view.queryByText('区域划分')).toBeNull()
    fireEvent.click(h.view.getByRole('menuitem', { name: '导入工作台包' }))
    expect(onImportWorkbench).toHaveBeenCalledOnce()
    expect(h.view.queryByRole('menu')).toBeNull()
    expect(h.view.queryByRole('dialog')).toBeNull()
    expect(h.view.getByRole('tab', { name: 'Workbench A' }).getAttribute('aria-selected')).toBe('true')
  })

  it('opens compact layout icons from the rail, then names the empty workbench', async () => {
    const h = setup(async () => ({ status: 'committed', revision: 2 }))
    fireEvent.click(h.view.getByRole('button', { name: '新建工作台', exact: true }))
    expect(h.view.queryByRole('dialog')).toBeNull()
    expect(h.view.queryByText('从已保存布局新建')).toBeNull()
    expect(h.view.getAllByRole('menuitem')).toHaveLength(9)
    fireEvent.click(h.view.getByRole('menuitem', { name: '四宫格，4 个区域' }))
    await h.view.findByRole('dialog', { name: '创建工作台' })
    expect(h.view.getByText('四宫格')).toBeDefined()
    expect(h.view.queryByRole('combobox')).toBeNull()
    expect(h.view.queryByRole('button', { name: '下一步' })).toBeNull()
    fireEvent.change(h.view.getByLabelText('名称'), { target: { value: '区域创建' } })
    fireEvent.click(h.view.getByRole('button', { name: '取消', exact: true }))
    expect(h.view.queryByRole('dialog')).toBeNull()
    expect(h.view.getByRole('tab', { name: 'Workbench A' }).getAttribute('aria-selected')).toBe('true')
  })

  it('locks split resizing across the Workbench while preserving collapse and content actions', async () => {
    const h = setup(async () => ({ status: 'committed', revision: 2 }), undefined, ['区域 A'],
      undefined, undefined, undefined, undefined, true)
    const lock = h.view.getByRole('button', { name: '锁定布局尺寸' })
    fireEvent.click(lock)
    await waitFor(() => expect(h.setLayoutLocked).toHaveBeenCalledWith('one', true))
    await waitFor(() => expect(h.view.getByRole('button', { name: '解锁布局尺寸' }).getAttribute('aria-pressed')).toBe('true'))
    expect(h.view.container.querySelector<HTMLElement>('[data-workbench-canvas]')?.dataset.layoutLocked).toBe('true')

    const separators = h.view.container.querySelectorAll<HTMLElement>('[role="separator"]')
    expect(separators.length).toBeGreaterThan(0)
    for (const separator of separators) {
      expect(separator.getAttribute('aria-disabled')).toBe('true')
      expect(separator.dataset.layoutLocked).toBe('true')
      expect(separator.querySelector<HTMLElement>('[data-divider-hit-target]')?.dataset.dividerHitTarget).toBe('disabled')
      fireEvent.keyDown(separator, { key: 'ArrowRight' })
    }
    expect(h.view.container.querySelectorAll('[data-collapsed-summary-divider][data-layout-locked]').length).toBe(0)

    const swappableDivider = Array.from(separators).find(divider => divider.parentElement?.dataset.axis === 'horizontal')!
    expect(swappableDivider.tabIndex).toBe(0)
    fireEvent.pointerDown(swappableDivider, { pointerId: 91, button: 0, clientX: 200, clientY: 200 })
    expect(swappableDivider.parentElement?.dataset.workbenchResizeActive).toBeUndefined()
    fireEvent.doubleClick(swappableDivider)
    fireEvent.keyDown(swappableDivider, { key: 'F10', shiftKey: true })
    const swap = h.view.getByRole('menuitem', { name: '互换两侧区域' })
    expect(h.view.getByRole('menuitem', { name: '平衡两侧区域' }).hasAttribute('disabled')).toBe(true)
    expect(swap.hasAttribute('disabled')).toBe(false)
    fireEvent.click(swap)
    expect(h.view.container.querySelector('[data-workbench-group="active-area-b"] [role="tab"][aria-selected="true"]')?.getAttribute('aria-label')).toContain('Active area C')
    expect(h.view.container.querySelector('[data-workbench-group="active-area-c"] [role="tab"][aria-selected="true"]')?.getAttribute('aria-label')).toContain('Active area B')

    const area = h.view.container.querySelector<HTMLElement>('[data-workbench-group="group-main"]')!
    expect(area.querySelector('[data-area-collapse-toggle]')).not.toBeNull()
    fireEvent.click(area.querySelector<HTMLElement>('[data-area-collapse-toggle]')!)
    expect(area.hasAttribute('data-area-collapsed')).toBe(true)
    expect(area.querySelector('[data-area-merge-drag-handle]')).not.toBeNull()
    fireEvent.click(area.querySelector<HTMLElement>('[data-area-collapse-toggle]')!)
    expect(area.hasAttribute('data-area-collapsed')).toBe(false)
  })

  it('restores split resizing after unlocking a persisted layout lock', async () => {
    const h = setup(async () => ({ status: 'committed', revision: 2 }), undefined, ['区域 A'],
      undefined, undefined, undefined, undefined, true)
    const lock = h.view.getByRole('button', { name: '锁定布局尺寸' })
    fireEvent.click(lock)
    await waitFor(() => expect(h.view.getByRole('button', { name: '解锁布局尺寸' })).toBeTruthy())

    const lockedDivider = h.view.container.querySelector<HTMLDivElement>(
      '[data-axis="horizontal"] > [role="separator"]',
    )!
    const lockedSplitTracks = lockedDivider.parentElement!.style.getPropertyValue('--workbench-split-tracks')
    expect(lockedDivider.dataset.layoutLocked).toBe('true')
    expect(lockedDivider.querySelector<HTMLElement>('[data-divider-hit-target]')?.dataset.dividerHitTarget).toBe('disabled')

    fireEvent.click(h.view.getByRole('button', { name: '解锁布局尺寸' }))
    await waitFor(() => expect(h.view.getByRole('button', { name: '锁定布局尺寸' })).toBeTruthy())
    expect(h.view.container.querySelector<HTMLElement>('[data-workbench-canvas]')?.dataset.layoutLocked).toBeUndefined()

    const unlockedDivider = h.view.container.querySelector<HTMLDivElement>(
      '[data-axis="horizontal"] > [role="separator"]',
    )!
    expect(unlockedDivider.dataset.layoutLocked).toBeUndefined()
    expect(unlockedDivider.querySelector<HTMLElement>('[data-divider-hit-target]')?.dataset.dividerHitTarget).toBe('active')
    expect(unlockedDivider.parentElement!.style.getPropertyValue('--workbench-split-tracks')).toBe(lockedSplitTracks)

    const divider = Array.from(h.view.getAllByRole('separator', { name: '区域分隔线' }))
      .find(candidate => candidate.parentElement?.dataset.axis === 'horizontal')!
    const splitRoot = divider.parentElement!
    vi.spyOn(splitRoot, 'getBoundingClientRect').mockReturnValue({
      left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600,
      x: 0, y: 0, toJSON: () => ({}),
    } as DOMRect)
    const scheduled = new Map<number, FrameRequestCallback>()
    let nextFrame = 0
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      const id = ++nextFrame
      scheduled.set(id, callback)
      return id
    })
    vi.stubGlobal('cancelAnimationFrame', (id: number) => { scheduled.delete(id) })

    fireEvent.pointerDown(divider, { pointerId: 92, button: 0, clientX: 400, clientY: 200 })
    fireEvent.pointerMove(window, { pointerId: 92, clientX: 520, clientY: 200 })
    act(() => {
      for (const [id, callback] of scheduled) callback(performance.now() + id)
      scheduled.clear()
    })
    const transientTracks = splitRoot.style.getPropertyValue('--workbench-split-tracks-transient')
    expect(transientTracks !== '' && transientTracks !== 'initial'
      ? transientTracks : splitRoot.style.gridTemplateColumns).toContain('fr')
    fireEvent.pointerUp(window, { pointerId: 92, clientX: 520, clientY: 200 })
    expect(splitRoot.dataset.workbenchResizeActive).toBeUndefined()
    await new Promise(resolve => setTimeout(resolve, 350))
    expect(h.settings.patch).toHaveBeenCalledTimes(1)
  })

  it('applies the layout lock to the selected Workbench only', async () => {
    const h = setup(async () => ({ status: 'committed', revision: 2 }))
    fireEvent.click(h.view.getByRole('tab', { name: 'Workbench B' }))
    await waitFor(() => expect(h.view.getByRole('tab', { name: 'Workbench B' }).getAttribute('aria-selected')).toBe('true'))
    fireEvent.click(h.view.getByRole('button', { name: '锁定布局尺寸' }))
    await waitFor(() => expect(h.view.getByRole('button', { name: '解锁布局尺寸' }).getAttribute('aria-pressed')).toBe('true'))
    expect(h.setLayoutLocked).toHaveBeenCalledWith('two', true)

    fireEvent.click(h.view.getByRole('tab', { name: 'Workbench A' }))
    await waitFor(() => expect(h.view.getByRole('tab', { name: 'Workbench A' }).getAttribute('aria-selected')).toBe('true'))
    expect(h.view.getByRole('button', { name: '锁定布局尺寸' }).getAttribute('aria-pressed')).toBe('false')
    expect(h.setLayoutLocked).not.toHaveBeenCalledWith('one', true)
  })

  it('keeps collapsed summary separators on their own visual skin while locked', async () => {
    const h = setup(async () => ({ status: 'committed', revision: 2 }), 'keep', ['Collapsed area'],
      undefined, undefined, undefined, undefined, false, true)
    const collapsedArea = h.view.container.querySelector<HTMLElement>('[data-workbench-group="group-main"]')!
    fireEvent.click(collapsedArea.querySelector<HTMLElement>('[data-area-collapse-toggle]')!)
    const secondCollapsedArea = h.view.container.querySelector<HTMLElement>('[data-workbench-group="collapsed-split-expanded-area"]')!
    fireEvent.click(secondCollapsedArea.querySelector<HTMLElement>('[data-area-collapse-toggle]')!)
    fireEvent.click(h.view.getByRole('button', { name: '锁定布局尺寸' }))
    await waitFor(() => expect(h.view.getByRole('button', { name: '解锁布局尺寸' })).toBeTruthy())

    const summaryDividers = h.view.container.querySelectorAll<HTMLElement>('[data-collapsed-summary-divider]')
    expect(summaryDividers.length).toBeGreaterThan(0)
    for (const divider of summaryDividers) expect(divider.dataset.layoutLocked).toBeUndefined()

    const ordinaryDividers = h.view.container.querySelectorAll<HTMLElement>('[data-divider-hit-target]')
    expect(ordinaryDividers.length).toBeGreaterThan(0)
    for (const hitTarget of ordinaryDividers) {
      expect(hitTarget.parentElement?.dataset.layoutLocked).toBe('true')
      expect(hitTarget.dataset.dividerHitTarget).toBe('disabled')
    }
  })

  it('preserves existing split ratios during undo while the layout is locked', async () => {
    const h = setup(async () => ({ status: 'committed', revision: 2 }), undefined, ['A'],
      undefined, undefined, undefined, undefined, true)
    const divider = h.view.container.querySelector<HTMLDivElement>(
      '[data-axis="horizontal"] > [role="separator"]',
    )!
    fireEvent.keyDown(divider, { key: 'ArrowRight' })
    expect(divider.getAttribute('aria-valuenow')).toBe('55')
    fireEvent.click(h.view.getByRole('button', { name: '锁定布局尺寸' }))
    fireEvent.click(h.view.getByRole('button', { name: '撤销布局更改' }))
    const currentDivider = h.view.container.querySelector<HTMLDivElement>(
      '[data-axis="horizontal"] > [role="separator"]',
    )!
    expect(currentDivider.getAttribute('aria-valuenow')).toBe('55')
  })

  it('cancels an active divider drag when the layout is locked', async () => {
    vi.useFakeTimers()
    const h = setup(async () => ({ status: 'committed', revision: 2 }), undefined, ['Test page'],
      undefined, undefined, undefined, undefined, true)
    const divider = h.view.container.querySelector<HTMLDivElement>(
      '[data-axis="horizontal"] > [role="separator"]',
    )!
    const splitRoot = divider.parentElement!
    vi.spyOn(splitRoot, 'getBoundingClientRect').mockReturnValue({
      left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600,
      x: 0, y: 0, toJSON: () => ({}),
    } as DOMRect)
    const scheduled = new Map<number, FrameRequestCallback>()
    let nextFrame = 0
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      const id = ++nextFrame
      scheduled.set(id, callback)
      return id
    })
    vi.stubGlobal('cancelAnimationFrame', (id: number) => { scheduled.delete(id) })

    fireEvent.pointerDown(divider, { pointerId: 61, button: 0, clientX: 400, clientY: 200 })
    fireEvent.pointerMove(window, { pointerId: 61, clientX: 520, clientY: 200 })
    expect(splitRoot.dataset.workbenchResizeActive).toBe('true')
    expect(scheduled.size).toBe(1)

    fireEvent.click(h.view.getByRole('button', { name: '锁定布局尺寸' }))
    expect(splitRoot.dataset.workbenchResizeActive).toBeUndefined()
    expect(splitRoot.style.getPropertyValue('--workbench-split-tracks-transient')).toBe('initial')
    expect(scheduled.size).toBe(0)
    expect(h.settings.patch).not.toHaveBeenCalled()
    fireEvent.pointerUp(window, { pointerId: 61, clientX: 520, clientY: 200 })
    expect(h.settings.patch).not.toHaveBeenCalled()
  })

  it('keeps Workbench settings in place and puts the browser action in each Workbench tab', async () => {
    const openSettings = vi.fn()
    const h = setup(async () => ({ status: 'committed', revision: 2 }), undefined, undefined, undefined,
      { openSettings }, undefined, true)
    const settingsButton = h.view.getByRole('button', { name: '工作台设置' })
    expect(settingsButton.closest('header')).not.toBeNull()
    expect(settingsButton.closest('[data-workbench-tab]')).toBeNull()
    expect(settingsButton.querySelector('svg')).not.toBeNull()
    fireEvent.click(settingsButton)
    expect(openSettings).toHaveBeenCalledOnce()

    const tabHost = setup(async () => ({ status: 'committed', revision: 2 }))
    expect(tabHost.view.container.querySelector('[data-workbench-tab="one"] [data-action="browser"]')).toBeNull()
    fireEvent.click(tabHost.view.container.querySelector<HTMLElement>('[data-workbench-tab="one"] [data-workbench-menu-trigger]')!)
    const tabAction = tabHost.view.getByRole('menuitem', { name: /Workbench A/ })
    expect(tabAction).not.toBeNull()
    expect(tabAction.closest('[data-workbench-tab-menu="one"]')).not.toBeNull()
    expect(tabAction.closest('[data-workbench-tab]')).toBeNull()
    expect(tabAction.closest('[data-workbench-tab="two"]')).toBeNull()
    expect(settingsButton.closest('[data-workbench-tab]')).toBeNull()
  })

  it('reorders Workbench tabs through the directory and keeps the active tab selected', async () => {
    const h = setup(async () => ({ status: 'committed', revision: 2 }))
    const source = h.view.container.querySelector<HTMLElement>('[data-workbench-tab="one"]')!
    const target = h.view.container.querySelector<HTMLElement>('[data-workbench-tab="two"]')!
    const dataTransfer = { effectAllowed: '', dropEffect: '', setData: vi.fn() }
    fireEvent.dragStart(source, { dataTransfer })
    fireEvent.dragOver(target, { dataTransfer })
    fireEvent.drop(target, { dataTransfer })
    fireEvent.dragEnd(source, { dataTransfer })
    await waitFor(() => expect(h.reorder).toHaveBeenCalledWith('one', 1))
    expect(h.view.container.querySelector('[data-workbench-tabs]')?.firstElementChild?.getAttribute('data-workbench-tab')).toBe('two')
    expect(h.view.getByRole('tab', { name: 'Workbench A' }).getAttribute('aria-selected')).toBe('true')
  })

  it('keeps the complete selected Workbench name in the active tab label', () => {
    const h = setup(async () => ({ status: 'committed', revision: 2 }))
    const name = '一个很长的项目工作台名称用于确认选中标签完整显示'
    h.rename('one', name)
    const tab = h.view.getByRole('tab', { name })
    expect(tab.textContent).toContain(name)
    expect(tab.getAttribute('title')).toBe(name)
  })

  it('puts rename, save, browser and unload actions in the Workbench menu', async () => {
    const h = setup(async () => ({ status: 'committed', revision: 2 }))
    const trigger = h.view.getByRole('button', { name: '打开“Workbench A”工作台菜单' })
    vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue(new DOMRect(120, 8, 28, 28))
    fireEvent.click(trigger)
    const menu = h.view.getByRole('menu', { name: 'Workbench A工作台操作' })
    await waitFor(() => expect(menu.style.visibility).toBe(''))
    expect(menu.parentElement).toBe(document.body)
    expect(menu.style.left).toBe('120px')
    expect(menu.style.top).toBe('41px')
    expect(menu.querySelectorAll('button > svg')).toHaveLength(4)
    expect(h.view.getByRole('menuitem', { name: '重命名' })).toBeTruthy()
    expect(h.view.getByRole('menuitem', { name: '另存为布局模板' })).toBeTruthy()
    expect(h.view.getByRole('menuitem', { name: /Workbench A/ })).toBeTruthy()
    expect(h.view.getByRole('menuitem', { name: '从标签栏卸载' })).toBeTruthy()
  })

  it('applies save and unload actions to the Workbench whose menu is open', async () => {
    const h = setup(async () => ({ status: 'committed', revision: 2 }))
    fireEvent.click(h.view.getByRole('button', { name: '打开“Workbench B”工作台菜单' }))

    const save = h.view.getByRole('menuitem', { name: '另存为布局模板' }) as HTMLButtonElement
    const unload = h.view.getByRole('menuitem', { name: '从标签栏卸载' }) as HTMLButtonElement
    expect(save.disabled).toBe(false)
    expect(unload.disabled).toBe(false)

    fireEvent.click(save)
    const input = h.view.getByRole('textbox') as HTMLInputElement
    expect(input.value).toBe('Workbench B 布局')
    fireEvent.click(h.view.getByRole('button', { name: '保存布局' }))
    await waitFor(() => expect(h.saveTemplate).toHaveBeenCalledOnce())
    expect(h.saveTemplate.mock.calls[0]?.[0]).toBe('Workbench B 布局')
    const savedLayout = h.saveTemplate.mock.calls[0]?.[1]
    expect(savedLayout?.root).toMatchObject({ kind: 'group' })
    expect(JSON.stringify(savedLayout)).toContain('Workbench B page')

    fireEvent.click(h.view.getByRole('button', { name: '打开“Workbench B”工作台菜单' }))
    fireEvent.click(h.view.getByRole('menuitem', { name: '从标签栏卸载' }))
    await waitFor(() => expect(h.unload).toHaveBeenCalledWith('two'))
    expect(h.view.getByRole('tab', { name: 'Workbench A' }).getAttribute('aria-selected')).toBe('true')
  })

  it('pins a browser view to one Workbench and removes global creation controls', async () => {
    const originalTitle = document.title
    const h = setup(async () => ({ status: 'committed', revision: 2 }), undefined, undefined, undefined, undefined, {
      browserView: true, browserWorkbenchId: 'one',
    })
    expect(h.view.container.querySelector('[data-workbench-tabs]')).toBeNull()
    expect(h.view.queryByRole('tab', { name: 'Workbench A' })).toBeNull()
    expect(h.view.queryByRole('tab', { name: 'Workbench B' })).toBeNull()
    expect(h.view.queryByRole('button', { name: '新建工作台' })).toBeNull()
    expect(h.view.container.querySelector('[data-workbench-tab="two"]')).toBeNull()
    expect(h.view.container.querySelector('[data-workbench-shell-sidebar]')).toBeNull()
    expect(h.view.container.querySelector('[data-workbench-canvas]')).not.toBeNull()
    expect(document.title).toBe('Workbench A')
    h.rename('one', '复核工作台')
    expect(document.title).toBe('复核工作台')
    h.view.unmount()
    expect(document.title).toBe(originalTitle)
  })

  it('provides browser Workbench actions for undo, save, settings, and reclaim', async () => {
    const openSettings = vi.fn()
    const reclaim = vi.fn(async () => ({ status: 'reclaimed' as const }))
    const browserWindowSnapshot: WorkbenchWindowControllerV1['getSnapshot'] extends () => infer T ? T : never = {
      supported: true, windows: [], requests: [{
        workbenchId: 'one', status: 'ready', windowId: '00000000-0000-4000-8000-000000000000',
      }],
    }
    const windowController: WorkbenchWindowControllerV1 = {
      getSnapshot: () => browserWindowSnapshot,
      open: vi.fn(async () => ({ status: 'failed' as const, code: 'unused' })),
      focus: vi.fn(async () => ({ status: 'failed' as const, code: 'unsupported' })),
      close: vi.fn(async () => ({ status: 'failed' as const, code: 'unsupported' })),
      reclaim,
      subscribe: () => () => {},
    }
    const h = setup(async () => ({ status: 'committed', revision: 2 }), undefined, undefined,
      windowController, { openSettings }, {
        browserView: true, browserWorkbenchId: 'one',
        requestBrowserReclaim: vi.fn(async () => true),
      })
    expect(h.view.container.querySelector('[data-workbench-browser-toolbar]')).not.toBeNull()
    const undo = h.view.getByRole('button', { name: '撤回上一步' }) as HTMLButtonElement
    expect(undo.disabled).toBe(true)
    fireEvent.click(h.view.getByRole('button', { name: '添加内页标签' }))
    fireEvent.click(h.view.getByRole('menuitem', { name: '添加为标签 测试内页' }))
    expect(h.view.container.querySelectorAll('[data-workbench-area-tabs] [role="tab"]')).toHaveLength(2)
    expect(undo.disabled).toBe(false)
    fireEvent.click(undo)
    expect(h.view.container.querySelectorAll('[data-workbench-area-tabs] [role="tab"]')).toHaveLength(1)

    fireEvent.click(h.view.getByRole('button', { name: '保存工作台' }))
    await waitFor(() => expect(h.settings.patch).toHaveBeenCalled())
    fireEvent.click(h.view.getByRole('button', { name: '工作台设置' }))
    expect(openSettings).toHaveBeenCalledOnce()
    fireEvent.click(h.view.getByRole('button', { name: '收回到 DSH 客户端' }))
    await waitFor(() => expect(h.view.getByRole('button', { name: '收回到 DSH 客户端' })).toBeTruthy())
  })

  it('enables browser-side reclaim without a desktop request snapshot and locks after Host acceptance', async () => {
    const requestBrowserReclaim = vi.fn(async (workbenchId: string) => {
      expect(workbenchId).toBe('one')
      window.dispatchEvent(new CustomEvent('workbench-browser-reclaim', { detail: { state: 'requested' } }))
      return true
    })
    const h = setup(async () => ({ status: 'committed', revision: 2 }), undefined, undefined,
      undefined, undefined, { browserView: true, browserWorkbenchId: 'one', requestBrowserReclaim })
    const reclaim = h.view.getByRole('button', { name: '收回到 DSH 客户端' }) as HTMLButtonElement
    expect(reclaim.disabled).toBe(false)
    fireEvent.click(reclaim)
    await waitFor(() => expect(requestBrowserReclaim).toHaveBeenCalledOnce())
    await waitFor(() => expect(h.view.container.querySelector('[data-workbench-transition-wait]')?.textContent)
      .toContain('正在收回到 DSH 客户端'))
    expect((h.view.getByRole('button', { name: '收回到 DSH 客户端' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('confirms before browser Host reclaim stops an active LAN share', async () => {
    const requestBrowserReclaim = vi.fn(async () => true)
    const stop = vi.fn(async () => {})
    const session = {
      workbenchId: 'one', bindHost: '192.168.1.10', port: 4312, createdAt: Date.now(), guestCount: 1,
      guests: [],
    }
    const shareSnapshot = { supported: true, sessions: [session], links: {} }
    const shareController: WorkbenchShareControllerV1 = {
      getSnapshot: () => shareSnapshot,
      subscribe: () => () => {},
      start: vi.fn(async () => ({ status: 'already-active' as const, url: 'http://192.168.1.10:4312/workbench?share=test' })),
      stop,
      refresh: vi.fn(async () => session),
      renameGuest: vi.fn(async () => {}),
      kickGuest: vi.fn(async () => {}),
      setRpc: vi.fn(),
      dispose: vi.fn(),
    }
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const h = setup(async () => ({ status: 'committed', revision: 2 }), undefined, undefined,
      undefined, undefined, { browserView: true, browserWorkbenchId: 'one', requestBrowserReclaim, shareController })
    expect(h.view.queryByRole('button', { name: '开始局域网分享' })).toBeNull()
    expect(h.view.getByRole('button', { name: '复制局域网分享链接' })).toBeTruthy()
    fireEvent.click(h.view.getByRole('button', { name: '收回到 DSH 客户端' }))
    expect(confirm).toHaveBeenCalledWith('当前 Workbench 正在局域网分享。收回到 DSH 客户端会停止分享并断开所有访客，确定继续吗？')
    expect(stop).not.toHaveBeenCalled()
    expect(requestBrowserReclaim).not.toHaveBeenCalled()
    confirm.mockReturnValue(true)
    fireEvent.click(h.view.getByRole('button', { name: '收回到 DSH 客户端' }))
    await waitFor(() => expect(stop).toHaveBeenCalledOnce())
    await waitFor(() => expect(requestBrowserReclaim).toHaveBeenCalledOnce())
  })

  it('keeps the desktop rail usable when another Workbench owns the browser view', async () => {
    let windowSnapshot: WorkbenchWindowControllerV1['getSnapshot'] extends () => infer T ? T : never = {
      supported: true, windows: [], requests: [{
        workbenchId: 'one', status: 'ready', windowId: '00000000-0000-4000-8000-000000000000',
      }],
    }
    const listeners = new Set<() => void>()
    const controller: WorkbenchWindowControllerV1 = {
      getSnapshot: () => windowSnapshot,
      open: vi.fn(async () => ({ status: 'failed' as const, code: 'unused' })),
      focus: vi.fn(async () => ({ status: 'failed' as const, code: 'unsupported' })),
      close: vi.fn(async () => ({ status: 'failed' as const, code: 'unsupported' })),
      reclaim: vi.fn(async () => ({ status: 'failed' as const, code: 'unused' })),
      subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener) },
    }
    const h = setup(async () => ({ status: 'committed', revision: 2 }), undefined, undefined, controller)
    expect(h.view.container.querySelector('[data-workbench-browser-control-page]')).not.toBeNull()
    fireEvent.click(h.view.getByRole('tab', { name: 'Workbench B' }))
    await waitFor(() => expect(h.view.getByRole('tab', { name: 'Workbench B' }).getAttribute('aria-selected')).toBe('true'))
    expect(h.view.container.querySelector('[data-workbench-browser-control-page]')).toBeNull()
    fireEvent.click(h.view.getByRole('button', { name: '打开“Workbench B”工作台菜单' }))
    expect((h.view.getByRole('menuitem', { name: '在浏览器打开工作台“Workbench B”' }) as HTMLButtonElement).disabled).toBe(false)
    windowSnapshot = { supported: true, windows: [], requests: [{
      workbenchId: 'one', status: 'closed', windowId: '00000000-0000-4000-8000-000000000000',
    }] }
    act(() => { for (const listener of listeners) listener() })
  })

  it('shows a scoped loading surface while a dirty layout is being flushed before switching', async () => {
    vi.useFakeTimers()
    let complete!: (result: SettingsScopePatchResult) => void
    let flushedLayout: WorkbenchLayoutDocument | undefined
    const h = setup(operation => {
      flushedLayout = (operation as { value: WorkbenchLayoutDocument }).value
      return new Promise(resolve => { complete = resolve })
    })
    h.edit(1)
    await advance(300)
    expect(h.settings.patch).toHaveBeenCalledOnce()

    fireEvent.click(h.view.getByRole('tab', { name: 'Workbench B' }))
    expect(h.view.container.querySelector('[data-workbench-transition-wait]')?.textContent).toContain('正在载入Workbench B')
    expect(h.view.container.querySelector('[data-workbench-transition-wait]')).not.toBeNull()
    expect(h.view.getByRole('tab', { name: 'Workbench B' }).getAttribute('aria-selected')).toBe('true')
    expect(h.view.container.querySelector('[data-workbench-canvas]')?.hasAttribute('inert')).toBe(true)

    await act(async () => {
      complete({ status: 'committed', revision: 2 })
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })
    h.setRemoteLayout(flushedLayout!)
    expect(h.view.container.querySelector('[data-workbench-transition-wait]')).toBeNull()
    expect(h.view.getByRole('tab', { name: 'Workbench B' }).getAttribute('aria-selected')).toBe('true')
    expect(h.view.container.querySelector('[data-workbench-canvas]')?.hasAttribute('inert')).toBe(false)
    expect(h.settings.patch).toHaveBeenCalledOnce()
  })

  it('cancels transient divider tracks when a Workbench switch begins', async () => {
    const h = setup(async () => ({ status: 'committed', revision: 2 }), 'keep', ['Test page'],
      undefined, undefined, undefined, undefined, true)
    const divider = h.view.container.querySelector<HTMLDivElement>(
      '[data-axis="horizontal"] > [role="separator"]',
    )!
    const splitRoot = divider.parentElement!
    vi.spyOn(splitRoot, 'getBoundingClientRect').mockReturnValue({
      left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600,
      x: 0, y: 0, toJSON: () => ({}),
    } as DOMRect)
    const scheduled = new Map<number, FrameRequestCallback>()
    let nextFrame = 0
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      const id = ++nextFrame
      scheduled.set(id, callback)
      return id
    })
    vi.stubGlobal('cancelAnimationFrame', (id: number) => { scheduled.delete(id) })

    fireEvent.pointerDown(divider, { pointerId: 41, button: 0, clientX: 400, clientY: 200 })
    fireEvent.pointerMove(window, { pointerId: 41, clientX: 520, clientY: 200 })
    expect(splitRoot.dataset.workbenchResizeActive).toBe('true')
    expect(scheduled.size).toBe(1)

    fireEvent.click(h.view.getByRole('tab', { name: 'Workbench B' }))
    await waitFor(() => expect(h.view.getByRole('tab', { name: 'Workbench B' }).getAttribute('aria-selected')).toBe('true'))

    expect(splitRoot.dataset.workbenchResizeActive).toBeUndefined()
    expect(splitRoot.style.getPropertyValue('--workbench-split-tracks-transient')).toBe('initial')
    expect(scheduled.size).toBe(0)
    expect(h.settings.patch).not.toHaveBeenCalled()
    fireEvent.pointerUp(window, { pointerId: 41, clientX: 520, clientY: 200 })
    expect(h.settings.patch).not.toHaveBeenCalled()
  })

  it('does not write a clean layout again just to switch workbenches', async () => {
    const h = setup(async () => ({ status: 'committed', revision: 2 }))
    fireEvent.click(h.view.getByRole('tab', { name: 'Workbench B' }))
    await waitFor(() => expect(h.view.getByRole('tab', { name: 'Workbench B' }).getAttribute('aria-selected')).toBe('true'))
    expect(h.settings.patch).not.toHaveBeenCalled()
    expect(h.view.container.querySelector('[data-workbench-transition-wait]')).toBeNull()
  })

  it('shows browser connection progress only for the selected workbench', async () => {
    const activeRequestSnapshot = { supported: true as const, windows: [], requests: [
      { workbenchId: 'one', status: 'requested' as const, windowId: '00000000-0000-4000-8000-000000000000' },
    ] }
    const controller: WorkbenchWindowControllerV1 = {
      getSnapshot: () => activeRequestSnapshot,
      open: vi.fn(async () => ({ status: 'failed' as const, code: 'unused' })),
      focus: vi.fn(async () => ({ status: 'failed' as const, code: 'unsupported' })),
      close: vi.fn(async () => ({ status: 'failed' as const, code: 'unsupported' })),
      subscribe: () => () => {},
    }
    const h = setup(async () => ({ status: 'committed', revision: 2 }), undefined, ['测试内页'], controller)
    expect(h.view.container.querySelector('[data-workbench-transition-wait]')?.textContent).toContain('正在打开工作台页面')
    h.view.unmount()

    const siblingRequestSnapshot = { supported: true as const, windows: [], requests: [
      { workbenchId: 'two', status: 'requested' as const, windowId: '00000000-0000-4000-8000-000000000001' },
    ] }
    const siblingController: WorkbenchWindowControllerV1 = {
      ...controller,
      getSnapshot: () => siblingRequestSnapshot,
    }
    const sibling = setup(async () => ({ status: 'committed', revision: 2 }), undefined, ['测试内页'], siblingController)
    expect(sibling.view.container.querySelector('[data-workbench-transition-wait]')).toBeNull()
  })

  it('clears the loading surface and preserves the active workbench when flush fails', async () => {
    vi.useFakeTimers()
    const h = setup(async () => ({ status: 'unavailable' }))
    h.edit(1)
    await advance(300)
    fireEvent.click(h.view.getByRole('tab', { name: 'Workbench B' }))
    await advance(0)
    expect(h.view.container.querySelector('[data-workbench-transition-wait]')).toBeNull()
    expect(h.view.getByRole('tab', { name: 'Workbench A' }).getAttribute('aria-selected')).toBe('true')
    expect(h.view.getByRole('status').textContent).toContain('无法切换工作台')
  })

  it('shows why independent windows are unavailable on hosts without the capability', async () => {
    const h = setup(async () => ({ status: 'committed', revision: 2 }))
    expect(h.view.queryByRole('button', { name: '工作台窗口' })).toBeNull()
    fireEvent.click(h.view.getByRole('button', { name: '打开“Workbench A”工作台菜单' }))
    const trigger = document.body.querySelector<HTMLElement>('[data-workbench-tab-menu="one"] [data-action="browser"]')
    expect(trigger).not.toBeNull()
    fireEvent.click(trigger!)
    await waitFor(() => expect(h.view.getByRole('status').textContent).toContain('当前无法连接 DSH 浏览器窗口服务'))
    expect(h.view.container.querySelector('[data-workbench-tab="one"]')).not.toBeNull()
    expect(h.settings.patch).not.toHaveBeenCalled()
  })

  it('shows browser handoff and return status without persisting it in the layout', async () => {
    let windowSnapshot: WorkbenchWindowControllerV1['getSnapshot'] extends () => infer T ? T : never = {
      supported: true, windows: [], request: { workbenchId: 'one', status: 'ready', windowId: '00000000-0000-4000-8000-000000000000' },
    }
    const listeners = new Set<() => void>()
    const reclaim = vi.fn(async () => {
      windowSnapshot = { supported: true, windows: [], request: {
        workbenchId: 'one', status: 'reclaimed', windowId: '00000000-0000-4000-8000-000000000000',
      } }
      for (const listener of listeners) listener()
      return { status: 'reclaimed' as const }
    })
    const controller: WorkbenchWindowControllerV1 = {
      getSnapshot: () => windowSnapshot,
      open: vi.fn(async () => ({ status: 'failed' as const, code: 'unused' })),
      focus: vi.fn(async () => ({ status: 'failed' as const, code: 'unsupported' })),
      close: vi.fn(async () => ({ status: 'failed' as const, code: 'unsupported' })),
      reclaim,
      subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener) },
    }
    const h = setup(async () => ({ status: 'committed', revision: 2 }), undefined, ['测试内页'], controller)
    await waitFor(() => expect(h.view.container.querySelector('[data-workbench-browser-handoff="ready"]')?.textContent)
      .toBe('当前工作台正在浏览器中打开。'))
    expect(h.view.container.querySelector('[data-workbench-diagnostic]')).toBeNull()
    const controlPage = h.view.container.querySelector<HTMLElement>('[data-workbench-browser-control-page]')
    const handoffLock = controlPage
    expect(controlPage).not.toBeNull()
    expect(handoffLock!.textContent).toContain('收回到 DSH 客户端')
    expect(controlPage!.getAttribute('aria-modal')).toBeNull()
    expect(h.view.getByRole('tab', { name: 'Workbench A' })).toBeTruthy()
    fireEvent.click(h.view.getByRole('button', { name: '收回到 DSH 客户端' }))
    await waitFor(() => expect(reclaim).toHaveBeenCalledOnce())
    await waitFor(() => expect(h.view.container.querySelector('[data-workbench-browser-handoff="reclaimed"]')?.textContent)
      .toBe('工作台已收回到 DSH 客户端。'))
    expect(h.view.container.querySelector('[data-workbench-diagnostic]')).toBeNull()
    expect(h.view.container.querySelector('[data-workbench-browser-control-page]')).toBeNull()
    act(() => {
      windowSnapshot = { supported: true, windows: [], request: { workbenchId: 'one', status: 'closed' } }
      for (const listener of listeners) listener()
    })
    await waitFor(() => expect(h.view.container.querySelector('[data-workbench-browser-handoff="closed"]')?.textContent)
      .toBe('浏览器工作台已关闭，可继续在 DSH 客户端使用。'))
    act(() => {
      windowSnapshot = { supported: true, windows: [], request: { workbenchId: 'one', status: 'prepared' } }
      for (const listener of listeners) listener()
    })
    expect(h.view.container.querySelector('[data-workbench-browser-handoff="closed"]')?.textContent)
      .toBe('浏览器工作台已关闭，可继续在 DSH 客户端使用。')
    expect(h.settings.patch).not.toHaveBeenCalled()
  })

  it('opens the active Workbench through the host controller and only manages sibling windows', async () => {
    const snapshot = { supported: true, windows: [] }
    const controller: WorkbenchWindowControllerV1 = {
      getSnapshot: () => snapshot,
      open: vi.fn(async (workbenchId: string) => ({ status: 'opened' as const, windowId: `${workbenchId}-new-window` })),
      prepare: vi.fn(async () => true),
      focus: vi.fn(async () => ({ status: 'failed' as const, code: 'unsupported' })),
      close: vi.fn(async () => ({ status: 'failed' as const, code: 'unsupported' })),
      subscribe: () => () => {},
    }
    const h = setup(async () => ({ status: 'committed', revision: 2 }), undefined, ['测试内页'], controller)
    fireEvent.click(h.view.getByRole('button', { name: '打开“Workbench A”工作台菜单' }))
    const trigger = document.body.querySelector<HTMLElement>('[data-workbench-tab-menu="one"] [data-action="browser"]')
    expect(trigger).not.toBeNull()
    fireEvent.click(trigger!)
    await waitFor(() => expect(controller.open).toHaveBeenCalled())
    expect(controller.open.mock.calls[0]?.[0]).toBe('one')
    expect(h.settings.patch).not.toHaveBeenCalled()
  })

  it.each(['keep', 'dispose'] as const)('measures collapsed outlets by their actual %s policy and keeps visible siblings active', async policy => {
    vi.useFakeTimers()
    const h = setup(async () => ({ status: 'committed', revision: 2 }), policy)
    expect(h.owners.get('group-main')?.lifecycle).toMatchObject({ visibility: 'visible', focused: true })
    expect(h.owners.get('other-area')?.lifecycle).toMatchObject({ visibility: 'visible', focused: false })
    expect(h.metrics.getSnapshot()).toMatchObject({
      mountedEditorOutlets: 2, view: { areas: 2, visibleAreas: 2, collapsedAreas: 0 },
    })
    const collapse = h.view.getAllByRole('button').find(button => button.title.startsWith('向') && button.title.includes('收起'))
    expect(collapse).toBeDefined()
    fireEvent.click(collapse!)
    expect(h.metrics.getSnapshot()).toMatchObject({
      mountedEditorOutlets: policy === 'keep' ? 2 : 1,
      view: { visibleAreas: 1, collapsedAreas: 1 },
    })
    await advance(1000)
    expect(h.settings.patch).not.toHaveBeenCalled()
    h.view.unmount()
    expect(h.metrics.getSnapshot()).toMatchObject({ view: undefined, mountedEditorOutlets: 0 })
  })

  it('does not observe Area dimensions for automatic collapse and keeps manual collapse available', async () => {
    const observed: Element[] = []
    const observers: ResizeObserver[] = []
    class ResizeObserverMock implements ResizeObserver {
      constructor(private readonly callback: ResizeObserverCallback) { observers.push(this) }
      observe(target: Element) { observed.push(target) }
      unobserve() {}
      disconnect() {}
      trigger(target: Element) {
        this.callback([{
          target,
          contentRect: { width: 24, height: 24 },
        } as ResizeObserverEntry], this)
      }
    }
    vi.stubGlobal('ResizeObserver', ResizeObserverMock)

    const h = setup(async () => ({ status: 'committed', revision: 2 }), 'keep')
    const areas = Array.from(h.view.container.querySelectorAll<HTMLElement>('[data-workbench-group]'))
    expect(areas).toHaveLength(2)
    expect(observed.some(target => areas.includes(target as HTMLElement))).toBe(false)

    act(() => {
      for (const observer of observers) {
        const target = observed.shift()
        if (target !== undefined) observer.trigger(target)
      }
    })
    expect(h.view.container.querySelectorAll('[data-area-collapsed]')).toHaveLength(0)

    const firstArea = h.view.container.querySelector<HTMLElement>('[data-workbench-group="group-main"]')!
    const collapse = firstArea.querySelector<HTMLElement>('[data-area-collapse-toggle]')!
    fireEvent.click(collapse)
    expect(firstArea.hasAttribute('data-area-collapsed')).toBe(true)
    fireEvent.click(collapse)
    expect(firstArea.hasAttribute('data-area-collapsed')).toBe(false)
  })

  it('keeps inner-page outlets mounted during transient divider movement and saves one final ratio', async () => {
    vi.useFakeTimers()
    const h = setup(async () => ({ status: 'committed', revision: 2 }), 'keep')
    const divider = h.view.getByRole('separator', { name: '区域分隔线' })
    const splitRoot = divider.parentElement!
    vi.spyOn(splitRoot, 'getBoundingClientRect').mockReturnValue({
      left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600,
      x: 0, y: 0, toJSON: () => ({}),
    } as DOMRect)
    const scheduled = new Map<number, FrameRequestCallback>()
    let nextFrame = 0
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      const id = ++nextFrame
      scheduled.set(id, callback)
      return id
    })
    vi.stubGlobal('cancelAnimationFrame', (id: number) => { scheduled.delete(id) })

    expect(h.metrics.getSnapshot().mountedEditorOutlets).toBe(2)
    fireEvent.pointerDown(divider, { pointerId: 9, button: 0, clientX: 400, clientY: 200 })
    fireEvent.pointerMove(window, { pointerId: 9, clientX: 520, clientY: 200 })
    expect(scheduled.size).toBe(1)
    act(() => {
      for (const [id, callback] of scheduled) callback(performance.now() + id)
      scheduled.clear()
    })

    expect(h.metrics.getSnapshot().mountedEditorOutlets).toBe(2)
    expect(h.settings.patch).not.toHaveBeenCalled()
    const transientPreviewTracks = splitRoot.style.getPropertyValue('--workbench-split-tracks-transient')
    const previewTracks = transientPreviewTracks !== '' && transientPreviewTracks !== 'initial'
      ? transientPreviewTracks : splitRoot.style.gridTemplateColumns
    expect(previewTracks).toContain('0.652')
    fireEvent.pointerUp(window, { pointerId: 9, clientX: 520, clientY: 200 })
    const transientCommittedTracks = splitRoot.style.getPropertyValue('--workbench-split-tracks-transient')
    const committedTracks = transientCommittedTracks !== '' && transientCommittedTracks !== 'initial'
      ? transientCommittedTracks : splitRoot.style.gridTemplateColumns
    expect(committedTracks).toBe(previewTracks)
    await advance(300)
    expect(h.settings.patch).toHaveBeenCalledTimes(1)
    const savedOperation = h.settings.patch.mock.calls[0]?.[0] as { value?: WorkbenchLayoutDocument }
    expect(savedOperation.value?.root.kind).toBe('split')
    if (savedOperation.value?.root.kind === 'split') expect(savedOperation.value.root.ratio).toBeCloseTo(514 / 788, 5)
    expect(h.metrics.getSnapshot().mountedEditorOutlets).toBe(2)
    h.view.unmount()
  })

  it('keeps the bound Area accent marker present while layout is locked', async () => {
    const h = setup(async () => ({ status: 'committed', revision: 2 }), undefined, ['Bound page'],
      undefined, undefined, undefined, undefined, false, false, true)
    const area = h.view.container.querySelector<HTMLElement>('[data-workbench-group="group-main"]')!
    expect(area.dataset.sessionFrame).toBe('area')
    expect(area.dataset.accent).toBe('accent-1')
    expect(area.dataset.layoutLocked).toBeUndefined()

    fireEvent.click(h.view.container.querySelector<HTMLButtonElement>('[data-workbench-layout-lock]')!)
    await waitFor(() => expect(h.view.container.querySelector<HTMLElement>('[data-workbench-canvas]')?.dataset.layoutLocked).toBe('true'))

    const lockedArea = h.view.container.querySelector<HTMLElement>('[data-workbench-group="group-main"]')!
    expect(lockedArea.dataset.sessionFrame).toBe('area')
    expect(lockedArea.dataset.accent).toBe('accent-1')
    expect(lockedArea.dataset.layoutLocked).toBe('true')
  })

  it('freezes a collapsed branch divider while leaving the separate expanded split adjustable', async () => {
    const h = setup(async () => ({ status: 'committed', revision: 2 }), 'keep', ['Collapsed area'],
      undefined, undefined, undefined, undefined, true)
    const collapsedArea = h.view.container.querySelector<HTMLElement>('[data-workbench-group="group-main"]')!
    fireEvent.click(collapsedArea.querySelector<HTMLElement>('[data-area-collapse-toggle]')!)

    const dividers = Array.from(h.view.container.querySelectorAll<HTMLDivElement>('[role="separator"]'))
    const outer = dividers.find(divider => divider.parentElement?.dataset.axis === 'vertical')!
    const active = dividers.find(divider => divider.parentElement?.dataset.axis === 'horizontal')!
    expect(outer.getAttribute('aria-disabled')).toBe('true')
    expect(outer.dataset.layoutLocked).toBeUndefined()
    expect(outer.tabIndex).toBe(-1)
    expect(active.getAttribute('aria-disabled')).toBeNull()
    expect(active.dataset.layoutLocked).toBeUndefined()
    expect(active.querySelector<HTMLElement>('[data-divider-hit-target]')?.dataset.dividerHitTarget).toBe('active')
    expect(active.tabIndex).toBe(0)
    expect(h.view.container.querySelectorAll('[data-collapsed-summary-divider][data-layout-locked]').length).toBe(0)
    fireEvent.contextMenu(outer, { clientX: 300, clientY: 300 })
    expect(h.view.container.querySelector('[data-separator-menu]')).toBeNull()

    const outerSplit = outer.parentElement!
    vi.spyOn(outerSplit, 'getBoundingClientRect').mockReturnValue({
      left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600,
      x: 0, y: 0, toJSON: () => ({}),
    } as DOMRect)
    fireEvent.pointerDown(outer, { pointerId: 20, button: 0, clientX: 300, clientY: 300 })
    expect(outerSplit.dataset.workbenchResizeActive).toBeUndefined()

    const activeSplit = active.parentElement!
    vi.spyOn(activeSplit, 'getBoundingClientRect').mockReturnValue({
      left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600,
      x: 0, y: 0, toJSON: () => ({}),
    } as DOMRect)
    const scheduled = new Map<number, FrameRequestCallback>()
    let nextFrame = 0
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      const id = ++nextFrame
      scheduled.set(id, callback)
      return id
    })
    vi.stubGlobal('cancelAnimationFrame', (id: number) => { scheduled.delete(id) })
    fireEvent.pointerDown(active, { pointerId: 21, button: 0, clientX: 400, clientY: 200 })
    fireEvent.pointerMove(window, { pointerId: 21, clientX: 480, clientY: 200 })
    expect(scheduled.size).toBe(1)
    act(() => {
      for (const [id, callback] of scheduled) callback(performance.now() + id)
      scheduled.clear()
    })
    expect(activeSplit.dataset.workbenchResizeActive).toBe('true')
    fireEvent.pointerCancel(window, { pointerId: 21 })
    expect(activeSplit.dataset.workbenchResizeActive).toBeUndefined()
    expect(collapsedArea.hasAttribute('data-area-collapsed')).toBe(true)
    h.view.unmount()
  })

  it('keeps parent transient tracks from changing nested collapsed areas during a drag', async () => {
    const h = setup(async () => ({ status: 'committed', revision: 2 }), 'keep', ['Collapsed area'],
      undefined, undefined, undefined, undefined, false, true)
    const collapsedArea = h.view.container.querySelector<HTMLElement>('[data-workbench-group="group-main"]')!
    fireEvent.click(collapsedArea.querySelector<HTMLElement>('[data-area-collapse-toggle]')!)
    expect(collapsedArea.hasAttribute('data-area-collapsed')).toBe(true)

    const parentDivider = h.view.container.querySelector<HTMLDivElement>(
      '[data-axis="horizontal"] > [role="separator"]',
    )!
    const parentSplit = parentDivider.parentElement!
    const childSplit = h.view.container.querySelector<HTMLElement>('[data-axis="vertical"]')!
    expect(parentSplit.dataset.axis).toBe('horizontal')
    expect(childSplit.style.getPropertyValue('--workbench-split-tracks-transient')).toBe('initial')

    vi.spyOn(parentSplit, 'getBoundingClientRect').mockReturnValue({
      left: 0, top: 0, right: 900, bottom: 600, width: 900, height: 600,
      x: 0, y: 0, toJSON: () => ({}),
    } as DOMRect)
    const scheduled = new Map<number, FrameRequestCallback>()
    let nextFrame = 0
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      const id = ++nextFrame
      scheduled.set(id, callback)
      return id
    })
    vi.stubGlobal('cancelAnimationFrame', (id: number) => { scheduled.delete(id) })

    fireEvent.pointerDown(parentDivider, { pointerId: 30, button: 0, clientX: 450, clientY: 200 })
    fireEvent.pointerMove(window, { pointerId: 30, clientX: 540, clientY: 200 })
    act(() => {
      for (const [id, callback] of scheduled) callback(performance.now() + id)
      scheduled.clear()
    })

    const parentTransient = parentSplit.style.getPropertyValue('--workbench-split-tracks-transient')
    const parentPreviewTracks = parentTransient !== '' && parentTransient !== 'initial'
      ? parentTransient
      : parentSplit.style.gridTemplateColumns
    expect(parentPreviewTracks).toContain('fr')
    expect(childSplit.style.getPropertyValue('--workbench-split-tracks-transient')).toBe('initial')
    expect(collapsedArea.hasAttribute('data-area-collapsed')).toBe(true)

    fireEvent.pointerUp(window, { pointerId: 30, clientX: 540, clientY: 200 })
    expect(parentSplit.style.getPropertyValue('--workbench-split-tracks-transient')).toBe('initial')
    expect(childSplit.style.getPropertyValue('--workbench-split-tracks-transient')).toBe('initial')
    expect(collapsedArea.hasAttribute('data-area-collapsed')).toBe(true)
    h.view.unmount()
  })

  it('does not write when idle or when the editor repeats the same state', async () => {
    vi.useFakeTimers()
    const h = setup(async () => ({ status: 'committed', revision: 2 }))
    await advance(5000)
    expect(h.settings.patch).not.toHaveBeenCalled()
    h.edit(1); h.edit(2); h.edit(3)
    await advance(300)
    expect(h.settings.patch).toHaveBeenCalledTimes(1)
    h.edit(3)
    await advance(5000)
    expect(h.settings.patch).toHaveBeenCalledTimes(1)
    expect(h.metrics.getSnapshot()).toMatchObject({
      view: { openWorkbenches: 2, areas: 1, tabs: 1 },
      mountedEditorOutlets: 1, layoutSaves: { attempted: 1, committed: 1, inFlight: 0 },
    })
    h.view.unmount()
    expect(h.metrics.getSnapshot()).toMatchObject({ view: undefined, mountedEditorOutlets: 0 })
  })

  it('offers a searchable tab overview that activates a matching tab', async () => {
    vi.useFakeTimers()
    const h = setup(async () => ({ status: 'committed', revision: 2 }), undefined,
      Array.from({ length: 8 }, (_, index) => `Page ${String(index + 1)}`))
    const overview = h.view.getByRole('button', { name: /查看全部内页/ })
    fireEvent.click(overview)
    expect(h.view.getByRole('listbox', { name: '全部内页' })).toBeTruthy()
    const search = h.view.getByPlaceholderText('搜索名称、模式、项目或路径')
    fireEvent.change(search, { target: { value: 'Page 8' } })
    expect(h.view.getByRole('option', { name: /Page 8/ })).toBeTruthy()
    expect(h.view.queryByRole('option', { name: /Page 1/ })).toBeNull()
    fireEvent.click(h.view.getByRole('option', { name: /Page 8/ }))
    expect(h.view.getByRole('tab', { name: '当前内页：Page 8，点击打开内页操作' }).getAttribute('aria-selected')).toBe('true')
  })

  it('finds tabs by bound conversation name and project without changing the layout during search', () => {
    const h = setup(async () => ({ status: 'committed', revision: 2 }), undefined, ['资源一', '资源二'],
      undefined, undefined, undefined, undefined, false, false, true)
    h.settings.patch.mockClear()
    fireEvent.click(h.view.getByRole('button', { name: /查看全部内页/ }))
    const search = h.view.getByPlaceholderText('搜索名称、模式、项目或路径')
    fireEvent.change(search, { target: { value: '绑定对话' } })
    expect(h.view.getAllByRole('option')).toHaveLength(2)
    fireEvent.change(search, { target: { value: '绑定项目' } })
    expect(h.view.getAllByRole('option')).toHaveLength(2)
    fireEvent.change(search, { target: { value: '没有的对话' } })
    expect(h.view.queryAllByRole('option')).toHaveLength(0)
    expect(h.settings.patch).not.toHaveBeenCalled()
  })

  it('keeps collapsed areas discoverable through an interactive tab preview', async () => {
    vi.useFakeTimers()
    const h = setup(async () => ({ status: 'committed', revision: 2 }), 'keep', ['Page 1', 'Page 2'])
    const collapse = h.view.container.querySelector<HTMLElement>('[data-area-collapse-toggle]')
    expect(collapse).not.toBeNull()
    fireEvent.click(collapse!)
    expect(document.querySelector('[data-area-collapse-info]')).toBeNull()
    fireEvent.pointerEnter(collapse!)
    await advance(300)
    const preview = document.querySelector<HTMLElement>('[data-area-collapse-info]')
    expect(preview).not.toBeNull()
    expect(preview?.textContent).toContain('Page 1')
    expect(preview?.textContent).toContain('Page 2')
    const secondTab = Array.from(preview?.querySelectorAll('button') ?? [])
      .find(button => button.textContent?.includes('Page 2'))
    expect(secondTab).toBeDefined()
    fireEvent.click(secondTab!)
    expect(h.view.getByRole('tab', { name: '当前内页：Page 2，点击打开内页操作' }).getAttribute('aria-selected')).toBe('true')
  })

  it.each(['unavailable', 'throw'] as const)('retains edits and recovers transient save failures (%s)', async failure => {
    vi.useFakeTimers()
    let online = false
    const h = setup(async () => {
      if (online) return { status: 'committed', revision: 2 }
      if (failure === 'throw') throw new Error('network down')
      return { status: 'unavailable' }
    })
    h.edit(1)
    await advance(300)
    expect(h.settings.patch).toHaveBeenCalledTimes(1)
    h.edit(2)
    await advance(500)
    expect(h.settings.patch).toHaveBeenCalledTimes(2)
    expect(h.view.getByText('布局包含尚未保存的本地更改。')).toBeTruthy()
    online = true
    await advance(1000)
    expect(h.settings.patch).toHaveBeenCalledTimes(2)
    await advance(300)
    expect(h.settings.patch).toHaveBeenCalledTimes(3)
    expect(h.settings.patch.mock.lastCall?.[0]).toMatchObject({
      value: { root: { tabs: [{ state: { value: 2 } }] } },
    })
    expect(h.metrics.getSnapshot().layoutSaves).toMatchObject({ attempted: 3, failed: 2, committed: 1 })
  })

  it('keeps retrying the newest pending layout after temporary transport errors', async () => {
    vi.useFakeTimers()
    let attempts = 0
    const h = setup(async () => {
      attempts += 1
      if (attempts < 3) throw new Error('network down')
      return { status: 'committed', revision: attempts }
    })
    h.edit(1)
    await advance(300)
    h.edit(2)
    await advance(1000)
    expect(h.settings.patch).toHaveBeenCalledTimes(2)
    await advance(2000)
    expect(h.settings.patch).toHaveBeenCalledTimes(3)
    expect(h.settings.patch.mock.lastCall?.[0]).toMatchObject({
      value: { root: { tabs: [{ state: { value: 2 } }] } },
    })
  })

  it('resumes once after the host becomes writable again', async () => {
    vi.useFakeTimers()
    const h = setup(async () => ({ status: 'committed', revision: 2 }))
    h.status('unavailable')
    h.edit(1)
    await advance(3000)
    expect(h.settings.patch).not.toHaveBeenCalled()
    h.status('ready')
    await advance(300)
    expect(h.settings.patch).toHaveBeenCalledTimes(1)
    await advance(3000)
    expect(h.settings.patch).toHaveBeenCalledTimes(1)
  })

  it('retries autosave after a temporary lifecycle flush failure', async () => {
    vi.useFakeTimers()
    let online = false
    const h = setup(async () => online
      ? { status: 'committed', revision: 2 }
      : { status: 'unavailable' })

    h.edit(1)
    await act(async () => { expect(await h.flush()).toBe(false) })
    expect(h.settings.patch).toHaveBeenCalledTimes(1)

    online = true
    h.edit(2)
    await advance(1500)

    expect(h.settings.patch).toHaveBeenCalledTimes(2)
    expect(h.settings.patch.mock.lastCall?.[0]).toMatchObject({
      value: { root: { tabs: [{ state: { value: 2 } }] } },
    })
  })

  it('serializes an in-flight save and writes only the newest queued snapshot', async () => {
    vi.useFakeTimers()
    let complete: ((value: SettingsScopePatchResult) => void) | undefined
    const h = setup(() => new Promise(resolve => { complete = resolve }))
    h.edit(1)
    await advance(300)
    h.edit(2); h.edit(3)
    await advance(300)
    expect(h.settings.patch).toHaveBeenCalledTimes(1)
    await act(async () => { complete!({ status: 'committed', revision: 2 }) })
    await advance(300)
    expect(h.settings.patch).toHaveBeenCalledTimes(2)
    expect(h.settings.patch.mock.lastCall?.[0]).toMatchObject({ value: { root: { tabs: [{ state: { value: 3 } }] } } })
    await act(async () => { complete!({ status: 'committed', revision: 3 }) })
    await advance(1000)
    expect(h.settings.patch).toHaveBeenCalledTimes(2)
  })

  it('shares concurrent lifecycle flushes and waits for edits made during a write', async () => {
    vi.useFakeTimers()
    let complete: ((value: SettingsScopePatchResult) => void) | undefined
    const h = setup(() => new Promise(resolve => { complete = resolve }))
    h.edit(1)
    let first!: Promise<boolean>
    let second!: Promise<boolean>
    await act(async () => {
      first = h.flush()
      second = h.flush()
      await Promise.resolve()
    })
    expect(first).toBe(second)
    expect(h.settings.patch).toHaveBeenCalledTimes(1)
    h.edit(2)
    await advance(1000)
    expect(h.settings.patch).toHaveBeenCalledTimes(1)
    let finished = false
    void first.then(() => { finished = true })
    await act(async () => { complete!({ status: 'committed', revision: 2 }) })
    expect(finished).toBe(false)
    expect(h.settings.patch).toHaveBeenCalledTimes(2)
    expect(h.settings.patch.mock.lastCall?.[0]).toMatchObject({ value: { root: { tabs: [{ state: { value: 2 } }] } } })
    await act(async () => { complete!({ status: 'committed', revision: 3 }); expect(await first).toBe(true) })
    await advance(1000)
    expect(h.settings.patch).toHaveBeenCalledTimes(2)
  })

  it('keeps conflicts visible and never retries them as an overwrite', async () => {
    vi.useFakeTimers()
    const h = setup(async () => ({ status: 'conflict', expectedRevision: 1, actualRevision: 2 }))
    h.edit(1)
    await act(async () => { expect(await h.flush()).toBe(false) })
    await advance(5000)
    expect(h.settings.patch).toHaveBeenCalledTimes(1)
    expect(h.view.getByRole('button', { name: '重新载入远端' })).toBeTruthy()
    expect(h.view.getByRole('button', { name: '覆盖远端' })).toBeTruthy()
    expect(h.metrics.getSnapshot().layoutSaves).toMatchObject({ attempted: 1, conflicted: 1, inFlight: 0 })
  })

  it('blocks a lifecycle transition on a rejected write and later persists the latest edits', async () => {
    vi.useFakeTimers()
    let online = false
    const h = setup(async () => {
      if (online) return { status: 'committed', revision: 2 }
      throw new Error('disconnected')
    })
    h.edit(1)
    await act(async () => { expect(await h.flush()).toBe(false) })
    h.edit(2)
    online = true
    await advance(1500)
    expect(h.settings.patch).toHaveBeenCalledTimes(2)
    expect(h.settings.patch.mock.lastCall?.[0]).toMatchObject({
      value: { root: { tabs: [{ state: { value: 2 } }] } },
    })
    expect(h.metrics.getSnapshot().layoutSaves).toMatchObject({ attempted: 2, failed: 1, committed: 1 })
  })
})
