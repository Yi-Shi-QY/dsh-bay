// @vitest-environment jsdom
import type { ComponentProps } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { WorkbenchFloatingWorkspace } from '../src/foundation/WorkbenchFloatingWorkspace.tsx'
import { createFloatingWorkspaceRuntime } from '../src/client/floating-workspace-runtime.ts'
import { defaultLayout } from '../src/foundation/model.ts'
import type { ConversationTabStatusSource, ConversationTabStatus } from '../src/client/conversation-tab-status.ts'

vi.mock('../src/foundation/WorkbenchFrame.tsx', () => ({ MemoizedEditor: () => null, WorkbenchFloatingMenu: () => null, PendingSessionBindingPicker: () => null }))
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

function setup(bayAgent?: ComponentProps<typeof WorkbenchFloatingWorkspace>['bayAgent'], conversationStatus?: ConversationTabStatusSource, policy?: ComponentProps<typeof WorkbenchFloatingWorkspace>['policy']) {
  vi.stubGlobal('PointerEvent', MouseEvent)
  const runtime = createFloatingWorkspaceRuntime()
  runtime.setSurface(true, 'one')
  const sessions = { first: { displayTitle: '项目方案', projectionValues: { agentPreset: 'ptc' } }, second: { displayTitle: '另一段对话', projectionValues: { agentPreset: 'standard' } }, 'main-one': { displayTitle: 'Bay Agent' } }
  const workspaceState = { items: [{ workspaceId: 'project', title: '来源项目', sessionIds: ['first', 'second'] }], archivedSessionIds: [] }
  const canvas = document.createElement('div'); document.body.append(canvas)
  const area = document.createElement('section'); area.dataset.workbenchGroup = 'target'; canvas.append(area)
  const header = document.createElement('header'); header.dataset.workbenchAreaHeader = ''; area.append(header)
  const body = document.createElement('div'); area.append(body)
  const frame = {
    conversationStatus,
    useSessions: (select: (state: unknown) => unknown) => select({ byId: sessions }),
    useWorkspaces: (select: (state: unknown) => unknown) => select(workspaceState),
  } as ComponentProps<typeof WorkbenchFloatingWorkspace>['frame']
  runtime.open('one', { id: 'first', editorId: 'test', editorScope: 'session', lastKnownTitle: '内页一', state: {}, sessionId: 'first', binding: { sessionId: 'first', workspaceId: 'project' } })
  runtime.open('one', { id: 'second', editorId: 'test', editorScope: 'session', lastKnownTitle: '内页二', state: {}, sessionId: 'second', binding: { sessionId: 'second', workspaceId: 'project' } })
  const layout = defaultLayout(); if (layout.root.kind !== 'group') throw new Error('fixture')
  layout.root.id = 'target'; layout.root.tabs = []; delete layout.root.activeTabId
  const pin = vi.fn(async () => true)
  const content = (selectedAreaBinding?: { workspaceId: string; sessionId: string }) => <WorkbenchFloatingWorkspace runtime={runtime} bayAgent={bayAgent} workbenchId="one" canvasRef={{ current: canvas }} visible selectedAreaBinding={selectedAreaBinding}
    editors={[{ id: 'workbench.conversation', scope: 'session', label: '对话', icon: 'message' }]} hidden={[]} extensionAccess={{} as never} frame={frame} layout={layout} policy={policy} commit={() => true} pin={pin}
    sessionMarkers={{ project: { first: { label: 'A', accentToken: 'accent-1', customized: false }, second: { label: 'B', accentToken: 'accent-2', customized: false } } }} />
  const view = render(content(), { container: canvas.appendChild(document.createElement('div')) })
  return { runtime, pin, header, body, area, canvas, view, layout, selectArea: (sessionId?: string) => view.rerender(content(sessionId ? { workspaceId: 'project', sessionId } : undefined)) }
}

const openPlacement = () => {
  fireEvent.click(screen.getByRole('button', { name: '浮动工作区菜单' }))
  fireEvent.click(screen.getByRole('button', { name: '放入区域' }))
}

it('previews the chosen area and split without moving until confirmed', async () => {
  const { layout, selectArea, pin, runtime, area } = setup()
  vi.spyOn(area, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 900, 700))
  layout.root = { kind: 'split', id: 'split', axis: 'horizontal', ratio: .35, first: layout.root,
    second: { kind: 'group', id: 'other', tabs: [] } }
  selectArea()
  openPlacement()
  expect(screen.getByRole('dialog', { name: '放入区域' })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '区域 2：空区域' }))
  fireEvent.click(screen.getByRole('button', { name: '下方分屏' }))
  expect(document.querySelector('[data-placement-area=other] [data-placement-edge=bottom]')).toBeTruthy()
  expect(pin).not.toHaveBeenCalled()
  fireEvent.change(screen.getByRole('combobox', { name: '目标区域' }), { target: { value: 'target' } })
  fireEvent.click(screen.getByRole('button', { name: '右侧分屏' }))
  expect(document.querySelector('[data-placement-area=target] [data-placement-edge=right]')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '确认放入' }))
  await waitFor(() => expect(pin).toHaveBeenCalledWith(expect.objectContaining({ id: 'second' }), 'target', 'right'))
  expect(pin).toHaveBeenCalledTimes(1)
  expect(runtime.find('second', 'one')?.location).toBe('area')
})

it('explains blocked joining but permits a new split for a different project, and preserves content on transfer failure', async () => {
  const { layout, selectArea, area, pin, runtime } = setup()
  if (layout.root.kind !== 'group') throw new Error('fixture')
  layout.root.project = { relativePath: 'projects/other', generation: 1, workspaceId: 'other' }
  vi.spyOn(area, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 900, 300))
  selectArea()
  openPlacement()
  expect(screen.getByRole('status').textContent).toContain('来自另一个项目')
  expect(screen.getByRole('button', { name: '确认放入' }).hasAttribute('disabled')).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: '上方分屏' }))
  expect(screen.getByRole('status').textContent).toContain('空间不足')
  fireEvent.click(screen.getByRole('button', { name: '右侧分屏' }))
  expect(screen.getByRole('button', { name: '确认放入' }).hasAttribute('disabled')).toBe(false)
  pin.mockResolvedValueOnce(false)
  fireEvent.click(screen.getByRole('button', { name: '确认放入' }))
  await waitFor(() => expect(screen.getByRole('status').textContent).toContain('未能放入区域'))
  expect(runtime.find('second', 'one')?.location).toBe('floating')
})

it('cancels preview and invalidates a removed destination instead of silently moving elsewhere', () => {
  const { layout, selectArea, pin, runtime } = setup()
  openPlacement()
  fireEvent.click(screen.getByRole('button', { name: '取消' }))
  expect(screen.queryByRole('dialog', { name: '放入区域' })).toBeNull()
  expect(pin).not.toHaveBeenCalled()
  openPlacement()
  layout.root = { kind: 'group', id: 'replacement', tabs: [] }
  selectArea()
  expect(screen.getByRole('status').textContent).toContain('目标区域已关闭')
  expect(screen.getByRole('button', { name: '确认放入' }).hasAttribute('disabled')).toBe(true)
  fireEvent.keyDown(screen.getByRole('combobox', { name: '目标区域' }), { key: 'Escape' })
  expect(screen.queryByRole('dialog', { name: '放入区域' })).toBeNull()
  expect(pin).not.toHaveBeenCalled()
  expect(runtime.find('second', 'one')?.location).toBe('floating')
})

it('revalidates the rendered area size when confirming a previously available split', () => {
  const { area, pin } = setup()
  const bounds = vi.spyOn(area, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 900, 700))
  openPlacement()
  fireEvent.click(screen.getByRole('button', { name: '左侧分屏' }))
  expect(screen.getByRole('button', { name: '确认放入' }).hasAttribute('disabled')).toBe(false)
  bounds.mockReturnValue(new DOMRect(0, 0, 400, 300))
  fireEvent.click(screen.getByRole('button', { name: '确认放入' }))
  expect(pin).not.toHaveBeenCalled()
  expect(screen.getByRole('button', { name: '确认放入' }).hasAttribute('disabled')).toBe(true)
})

it('uses shared conversation states for Bay Agent and floating duplicates, keeping identity and unread separate', async () => {
  let states: ReadonlyMap<string, ConversationTabStatus> = new Map([['main-one', { status: 'attention', label: '等待审批' }]])
  const listeners = new Set<() => void>()
  const source: ConversationTabStatusSource = { getSnapshot: () => states, subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener) } }, watch: vi.fn(() => () => {}) }
  const snapshot = { workbenchId: 'one', bayAgentSessionId: 'main-one', areas: [], workItems: [], assignments: [], attention: [] }
  const controller = { subscribe: () => () => {}, getSnapshot: () => snapshot, ensureMainSession: async () => 'main-one' } as unknown as NonNullable<ComponentProps<typeof WorkbenchFloatingWorkspace>['bayAgent']>
  const { runtime } = setup(controller, source)
  expect(screen.queryByRole('tab', { name: /Bay Agent/ })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '唤出 Bay Agent' }))
  await waitFor(() => expect(screen.getByRole('tab', { name: /Bay Agent/ }).getAttribute('aria-description')).toContain('等待审批'))
  expect(screen.getByLabelText('Bay Agent 主控页签')).toBeTruthy()
  act(() => { runtime.open('one', { id: 'duplicate', editorId: 'workbench.conversation', editorScope: 'session', sessionId: 'main-one', state: {}, lastKnownTitle: '重复对话' }, true, false) })
  expect(screen.getByRole('tab', { name: /重复对话/ }).querySelector('[data-tab-status=attention]')).not.toBeNull()
  expect(screen.getByLabelText('未读内容')).toBeTruthy()
  act(() => { states = new Map([['main-one', { status: 'completed', label: '本轮已完成' }]]); for (const listener of listeners) listener() })
  fireEvent.click(screen.getByRole('tab', { name: /重复对话/ }))
  expect(screen.getByRole('tab', { name: /重复对话/ }).getAttribute('aria-description')).toContain('本轮已完成')
  expect(screen.getByRole('tab', { name: /Bay Agent/ }).querySelector('[data-tab-status=completed]')).not.toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '浮动工作区菜单' }))
  fireEvent.click(screen.getByRole('button', { name: '全部临时内页' }))
  expect(screen.getByRole('button', { name: /重复对话.*本轮已完成/ })).toBeTruthy()
})

it('filters floating tabs by actual conversation name and Agent mode before selecting one', () => {
  const { runtime } = setup()
  fireEvent.click(screen.getByRole('button', { name: '浮动工作区菜单' }))
  fireEvent.click(screen.getByRole('button', { name: '全部临时内页' }))
  fireEvent.change(screen.getByRole('textbox', { name: '搜索临时内页' }), { target: { value: 'PTC' } })
  expect(screen.queryByRole('button', { name: /^内页二/ })).toBeNull()
  fireEvent.change(screen.getByRole('textbox', { name: '搜索临时内页' }), { target: { value: '项目方案' } })
  fireEvent.click(screen.getByRole('button', { name: /内页一.*项目方案/ }))
  expect(runtime.workspace('one').activeId).toBe('first')
})

it('shows the active tab project, existing colored marker and conversation title', () => {
  setup()
  expect(screen.getByTitle('来源项目：来源项目')).toBeTruthy()
  expect(screen.getByLabelText('绑定对话：B · 另一段对话').getAttribute('data-accent')).toBe('accent-2')
  fireEvent.click(screen.getByRole('tab', { name: /内页一/ }))
  expect(screen.getByLabelText('绑定对话：A · 项目方案')).toBeTruthy()
})

it('applies tab label size and hides floating close buttons without removing Delete close', async () => {
  const { runtime } = setup(undefined, undefined, {
    version: 2, conversationResources: {}, unknownResource: 'module-default',
    showSessionAccentFrames: true, tabFontSize: 'larger', showTabCloseButtons: false,
  })
  const tab = screen.getByRole('tab', { name: /内页一/ })
  expect(tab.querySelector('span[style]')?.getAttribute('style')).toContain('font-size: 15px')
  expect(screen.queryByRole('button', { name: '关闭 内页一' })).toBeNull()
  fireEvent.keyDown(tab, { key: 'Delete' })
  await waitFor(() => expect(runtime.find('first', 'one')).toBeUndefined())
})

it('describes every floating window control on hover', () => {
  setup()
  expect(screen.getByRole('button', { name: '关闭 内页一' }).getAttribute('title')).toBe('关闭 内页一')
  expect(screen.getByRole('button', { name: '浮动工作区菜单' }).getAttribute('title')).toBe('浮动工作区菜单')
  expect(screen.getByRole('button', { name: '最大化浮动工作区' }).getAttribute('title')).toBe('最大化浮动工作区')
  expect(screen.getByRole('button', { name: '最小化浮动工作区' }).getAttribute('title')).toBe('最小化浮动工作区')
  fireEvent.click(screen.getByRole('button', { name: '浮动工作区菜单' }))
  expect(screen.getByRole('button', { name: '关闭浮窗菜单' }).getAttribute('title')).toBe('关闭菜单')
})

it('colors the launcher from the selected Area and the expanded frame from its active tab', () => {
  const { selectArea, runtime } = setup()
  const panel = screen.getByRole('region', { name: '浮动工作区' })
  expect(panel.getAttribute('data-accent')).toBe('accent-2')
  selectArea('first')
  expect(panel.getAttribute('data-accent')).toBe('accent-2')
  fireEvent.click(screen.getByRole('button', { name: '最小化浮动工作区' }))
  expect(screen.getByRole('button', { name: '展开浮动工作区' }).getAttribute('data-accent')).toBe('accent-1')
  selectArea('second')
  expect(screen.getByRole('button', { name: '展开浮动工作区' }).getAttribute('data-accent')).toBe('accent-2')
  selectArea()
  expect(screen.getByRole('button', { name: '展开浮动工作区' }).hasAttribute('data-session-frame')).toBe(false)
  fireEvent.click(screen.getByRole('button', { name: '展开浮动工作区' }))
  fireEvent.click(screen.getByRole('tab', { name: /内页一/ }))
  expect(panel.getAttribute('data-accent')).toBe('accent-1')
  // The visual linkage must not become an automatic-event routing context.
  expect(runtime.focusedBinding).toBeUndefined()
})

it('keeps an unbound or empty floating frame neutral even with a selected bound Area', async () => {
  const { runtime, selectArea } = setup()
  selectArea('first')
  act(() => { runtime.open('one', { id: 'independent', editorId: 'root', editorScope: 'root', lastKnownTitle: '独立内页', state: {} }) })
  expect(screen.getByRole('region', { name: '浮动工作区' }).hasAttribute('data-session-frame')).toBe(false)
  await act(async () => { await runtime.close('independent', 'one'); await runtime.close('second', 'one'); await runtime.close('first', 'one') })
  expect(screen.getByRole('region', { name: '浮动工作区' }).hasAttribute('data-accent')).toBe(false)
})

it('closes the clicked temporary tab and keeps other tabs', async () => {
  const { runtime } = setup()
  fireEvent.click(screen.getByRole('button', { name: '关闭 内页一' }))
  await waitFor(() => expect(screen.queryByRole('tab', { name: /内页一/ })).toBeNull())
  expect(runtime.find('second', 'one')).toBeDefined()
  fireEvent.keyDown(screen.getByRole('tab', { name: /内页二/ }), { key: 'Delete' })
  await waitFor(() => expect(runtime.find('second', 'one')).toBeUndefined())
})

it('keeps a guarded tab and explains a cancelled close', async () => {
  const { runtime } = setup()
  runtime.registerCloseGuard('second', () => false, 'one')
  fireEvent.click(screen.getByRole('button', { name: '关闭 内页二' }))
  await screen.findByRole('status')
  expect(runtime.find('second', 'one')).toBeDefined()
})

it('uses only the Area header as a join target, including the header edge', async () => {
  const { pin, header, body, runtime } = setup()
  let hit = body
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => hit })
  const drag = () => fireEvent.pointerDown(screen.getByRole('tab', { name: /内页二/ }), { button: 0, clientX: 250, clientY: 150 })
  drag(); fireEvent.pointerMove(window, { clientX: 200, clientY: 200 }); fireEvent.pointerUp(window, { clientX: 200, clientY: 200 })
  expect(pin).not.toHaveBeenCalled()
  hit = header
  drag(); fireEvent.pointerMove(window, { clientX: 1, clientY: 10 })
  expect(screen.getByText('加入区域标签')).toBeTruthy()
  await act(async () => fireEvent.pointerUp(window, { clientX: 1, clientY: 10 }))
  expect(pin).toHaveBeenCalledWith(expect.objectContaining({ id: 'second' }), 'target', 'center')
  expect(runtime.find('second', 'one')?.location).toBe('area')
})

it('rechecks the release point and cancels Escape without moving the tab', async () => {
  const { pin, header, body, runtime } = setup()
  let hit = header
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => hit })
  const drag = () => fireEvent.pointerDown(screen.getByRole('tab', { name: /内页二/ }), { button: 0, clientX: 250, clientY: 150 })
  drag(); fireEvent.pointerMove(window, { clientX: 1, clientY: 10 }); hit = body
  await act(async () => fireEvent.pointerUp(window, { clientX: 1, clientY: 80 }))
  expect(pin).not.toHaveBeenCalled()
  hit = header; drag(); fireEvent.pointerMove(window, { clientX: 1, clientY: 10 }); fireEvent.keyDown(window, { key: 'Escape' }); fireEvent.pointerUp(window, { clientX: 1, clientY: 10 })
  expect(pin).not.toHaveBeenCalled(); expect(runtime.find('second', 'one')?.location).toBe('floating')
})


it('keeps Bay Agent in the existing floating workspace with no binding, close or pin controls', async () => {
  const snapshot = { workbenchId: 'one', bayAgentSessionId: 'main-one', areas: [], workItems: [], assignments: [], attention: [] }
  const controller = { subscribe: () => () => {}, getSnapshot: () => snapshot, ensureMainSession: vi.fn(async () => 'main-one') } as unknown as NonNullable<ComponentProps<typeof WorkbenchFloatingWorkspace>['bayAgent']>
  const { runtime, pin } = setup(controller)
  expect(screen.queryByRole('tab', { name: /Bay Agent/ })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '唤出 Bay Agent' }))
  await waitFor(() => expect(runtime.find('bay-agent-main', 'one')?.tab.sessionId).toBe('main-one'))
  fireEvent.click(screen.getByRole('tab', { name: /Bay Agent/ }))
  expect(screen.getAllByRole('region', { name: '浮动工作区' })).toHaveLength(1)
  expect(screen.queryByRole('button', { name: '关闭 Bay Agent' })).toBeNull()
  fireEvent.keyDown(screen.getByRole('tab', { name: /Bay Agent/ }), { key: 'Delete' })
  expect(runtime.find('bay-agent-main', 'one')).toBeDefined()
  fireEvent.click(screen.getByRole('button', { name: '浮动工作区菜单' }))
  expect(screen.getByRole('button', { name: '选择来源对话' }).hasAttribute('disabled')).toBe(true)
  expect(screen.getByRole('button', { name: '放入区域' }).hasAttribute('disabled')).toBe(true)
  expect(pin).not.toHaveBeenCalled()
})

it.each([true, false])('toggles the persistent Bay Agent tab without collapsing the floating workspace (other tabs: %s)', async hasOtherTabs => {
  const snapshot = { workbenchId: 'one', bayAgentSessionId: 'main-one', areas: [], workItems: [], assignments: [], attention: [] }
  const ensureMainSession = vi.fn(async () => 'main-one')
  const controller = { subscribe: () => () => {}, getSnapshot: () => snapshot, ensureMainSession } as unknown as NonNullable<ComponentProps<typeof WorkbenchFloatingWorkspace>['bayAgent']>
  const { runtime } = setup(controller)
  if (!hasOtherTabs) act(() => { runtime.forget('first', 'one'); runtime.forget('second', 'one') })

  const reveal = screen.getByRole('button', { name: '唤出 Bay Agent' })
  expect(reveal.getAttribute('aria-pressed')).toBe('false')
  fireEvent.click(reveal)
  await waitFor(() => expect(screen.getByRole('button', { name: '收回 Bay Agent' }).getAttribute('aria-pressed')).toBe('true'))
  expect(runtime.find('bay-agent-main', 'one')?.tab.sessionId).toBe('main-one')

  fireEvent.click(screen.getByRole('button', { name: '收回 Bay Agent' }))
  await waitFor(() => expect(screen.queryByRole('tab', { name: /Bay Agent/ })).toBeNull())
  expect(runtime.find('bay-agent-main', 'one')).toBeUndefined()
  expect(ensureMainSession).toHaveBeenCalledTimes(1)
  expect(runtime.workspace('one').expanded).toBe(true)
  expect(screen.getByRole('region', { name: '浮动工作区' })).toBeTruthy()
  expect(screen.queryByRole('button', { name: '展开浮动工作区' })).toBeNull()
  if (hasOtherTabs) expect(screen.getAllByRole('tab')).toHaveLength(2)
  else {
    expect(screen.queryAllByRole('tab')).toHaveLength(0)
    expect(screen.getByRole('button', { name: '添加内页' })).toBeTruthy()
  }

  fireEvent.click(screen.getByRole('button', { name: '唤出 Bay Agent' }))
  await waitFor(() => expect(runtime.find('bay-agent-main', 'one')?.tab.sessionId).toBe('main-one'))
  expect(ensureMainSession).toHaveBeenCalledTimes(2)
})

it('shows recoverable Main creation errors without replacing the floating workspace', async () => {
  const snapshot = { workbenchId: 'one', areas: [], workItems: [], assignments: [], attention: [] }
  const controller = { subscribe: () => () => {}, getSnapshot: () => snapshot, ensureMainSession: vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue('restored-main') } as unknown as NonNullable<ComponentProps<typeof WorkbenchFloatingWorkspace>['bayAgent']>
  const { runtime } = setup(controller)
  expect(screen.queryByRole('tab', { name: /Bay Agent/ })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '唤出 Bay Agent' }))
  expect(await screen.findByRole('status')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '唤出 Bay Agent' }))
  await waitFor(() => expect(runtime.find('bay-agent-main', 'one')?.tab.sessionId).toBe('restored-main'))
  expect(screen.queryByRole('status')).toBeNull()
})
