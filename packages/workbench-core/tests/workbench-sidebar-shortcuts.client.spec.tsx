// @vitest-environment jsdom
import { StrictMode, type ComponentType } from 'react'
import { act, cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { createProjectNeutralFrameSettings } from '../src/foundation/frame-settings-adapter.ts'
import { installWorkbenchSidebarShortcuts, workbenchPanelId } from '../src/client/workbench-sidebar-shortcuts.tsx'
import { mutableSettings } from './settings-fixtures.ts'

afterEach(cleanup)
function setup() {
  const f = mutableSettings(), directory = createProjectNeutralFrameSettings(f.source).directory
  const entries = new Map<string, { options: { name: string; key?: string; id?: string; label?: string }; component: ComponentType }>()
  let activePanelId: string | null = null
  const injections = new Map<string, Set<{ start(): void; stop(): void }>>()
  const declared = new Set(['main', 'sidebar.panellist'])
  const ctx = { slots: {
    inject(name: string, start: () => () => void) {
      let dispose: (() => void) | undefined
      const injection = { start() { dispose ??= start() }, stop() { dispose?.(); dispose = undefined } }
      const list = injections.get(name) ?? new Set(); list.add(injection); injections.set(name, list)
      if (declared.has(name)) injection.start()
      return () => { injection.stop(); list.delete(injection) }
    },
    register(options: { name: string; key?: string; id?: string; label?: string }, component: ComponentType) {
      const identity = options.name + ':' + (options.key ?? options.id)
      expect(entries.has(identity)).toBe(false)
      if (options.name === 'sidebar.panellist') expect(entries.has('main:' + options.id)).toBe(true)
      entries.set(identity, { options, component }); return () => { entries.delete(identity) }
    },
  }, layout: { panelInfo: { getSnapshot: () => ({ activePanelId }) }, selectPanel: vi.fn((id: string | null) => { activePanelId = id }) } }
  const open = vi.fn(async (_id: string) => {})
  const dispose = installWorkbenchSidebarShortcuts(ctx as never, directory, open)
  const reloadSidebar = () => { for (const entry of injections.get('sidebar.panellist') ?? []) entry.stop(); for (const entry of injections.get('sidebar.panellist') ?? []) entry.start() }
  return { ...f, directory, entries, ctx, open, dispose, reloadSidebar, select: (id: string) => { activePanelId = workbenchPanelId(id) } }
}

it('keeps sidebar pins independent of ordering, labels and view lifetime, and cleans registrations', async () => {
  const f = setup()
  expect(f.entries.size).toBe(0)
  await f.directory.setSidebarPinned!('a', true)
  await f.directory.setSidebarPinned!('b', true)
  expect(f.source.getSnapshot().value?.workbenches.a?.pinnedAt).toBeUndefined()
  expect(f.entries.size).toBe(4)
  await f.directory.rename('a', '重命名')
  expect(f.entries.get('sidebar.panellist:' + workbenchPanelId('a'))?.options.label).toBe('重命名')
  await f.directory.unload('a')
  expect(f.entries.size).toBe(4)
  await f.directory.archive('a')
  expect(f.entries.size).toBe(2)
  expect(f.source.getSnapshot().value?.sidebarShortcuts).toEqual(['a', 'b'])
  await f.directory.restore('a'); f.reloadSidebar()
  expect(f.entries.size).toBe(4)
  await f.directory.remove('a')
  expect(f.source.getSnapshot().value?.sidebarShortcuts).toEqual(['b'])
  expect(f.entries.size).toBe(2)
  f.dispose(); expect(f.entries.size).toBe(0)
})

it('navigates once under effect replay, then resets native selection so exiting cannot reopen it', async () => {
  const f = setup(); await f.directory.setSidebarPinned!('a', true)
  f.select('a')
  const Bridge = f.entries.get('main:' + workbenchPanelId('a'))!.component
  render(<StrictMode><Bridge /></StrictMode>)
  await waitFor(() => expect(f.ctx.layout.selectPanel).toHaveBeenCalledWith(null))
  expect(f.open).toHaveBeenCalledExactlyOnceWith('a')
  f.dispose()
})

it('preserves failed navigation and exposes retry without creating a replacement workbench', async () => {
  const f = setup(); await f.directory.setSidebarPinned!('a', true); f.select('a')
  f.open.mockRejectedValueOnce(new Error('工作台目录不可用'))
  const Bridge = f.entries.get('main:' + workbenchPanelId('a'))!.component
  const view = render(<Bridge />)
  await view.findByText('工作台目录不可用')
  expect(f.ctx.layout.selectPanel).not.toHaveBeenCalled()
  await act(async () => { view.getByText('重试打开').click() })
  expect(f.open).toHaveBeenCalledTimes(2)
  expect(Object.keys(f.source.getSnapshot().value!.workbenches)).toEqual(['a', 'b'])
  f.dispose()
})
