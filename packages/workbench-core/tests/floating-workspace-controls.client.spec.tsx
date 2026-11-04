// @vitest-environment jsdom
import type { ComponentProps } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { WorkbenchFloatingWorkspace } from '../src/foundation/WorkbenchFloatingWorkspace.tsx'
import { createFloatingWorkspaceRuntime } from '../src/client/floating-workspace-runtime.ts'
import { defaultLayout } from '../src/foundation/model.ts'

vi.mock('../src/foundation/WorkbenchFrame.tsx', () => ({ MemoizedEditor: () => null, WorkbenchFloatingMenu: () => null }))
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

function setup() {
  vi.stubGlobal('PointerEvent', MouseEvent)
  const runtime = createFloatingWorkspaceRuntime()
  runtime.setSurface(true, 'one')
  const sessions = { first: { displayTitle: '项目方案' }, second: { displayTitle: '另一段对话' } }
  const workspaceState = { items: [{ workspaceId: 'project', title: '来源项目', sessionIds: ['first', 'second'] }], archivedSessionIds: [] }
  const canvas = document.createElement('div'); document.body.append(canvas)
  const area = document.createElement('section'); area.dataset.workbenchGroup = 'target'; canvas.append(area)
  const header = document.createElement('header'); header.dataset.workbenchAreaHeader = ''; area.append(header)
  const body = document.createElement('div'); area.append(body)
  const frame = {
    useSessions: (select: (state: unknown) => unknown) => select({ byId: sessions }),
    useWorkspaces: (select: (state: unknown) => unknown) => select(workspaceState),
  } as ComponentProps<typeof WorkbenchFloatingWorkspace>['frame']
  runtime.open('one', { id: 'first', editorId: 'test', editorScope: 'session', lastKnownTitle: '内页一', state: {}, sessionId: 'first', binding: { sessionId: 'first', workspaceId: 'project' } })
  runtime.open('one', { id: 'second', editorId: 'test', editorScope: 'session', lastKnownTitle: '内页二', state: {}, sessionId: 'second', binding: { sessionId: 'second', workspaceId: 'project' } })
  const layout = defaultLayout(); if (layout.root.kind !== 'group') throw new Error('fixture')
  layout.root.id = 'target'; layout.root.tabs = []; delete layout.root.activeTabId
  const pin = vi.fn(async () => true)
  const view = render(<WorkbenchFloatingWorkspace runtime={runtime} workbenchId="one" canvasRef={{ current: canvas }} visible
    editors={[]} hidden={[]} extensionAccess={{} as never} frame={frame} layout={layout} commit={() => true} pin={pin}
    sessionMarkers={{ project: { first: { label: 'A', accentToken: 'accent-1', customized: false }, second: { label: 'B', accentToken: 'accent-2', customized: false } } }} />, { container: canvas.appendChild(document.createElement('div')) })
  return { runtime, pin, header, body, canvas, view }
}

it('shows the active tab project, existing colored marker and conversation title', () => {
  setup()
  expect(screen.getByTitle('来源项目：来源项目')).toBeTruthy()
  expect(screen.getByLabelText('绑定对话：B · 另一段对话').getAttribute('data-accent')).toBe('accent-2')
  fireEvent.click(screen.getByRole('tab', { name: /内页一/ }))
  expect(screen.getByLabelText('绑定对话：A · 项目方案')).toBeTruthy()
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
