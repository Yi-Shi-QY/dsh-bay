// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { WorkbenchHome } from '../src/foundation/WorkbenchHome.tsx'
import { WorkbenchBrowserControlPage } from '../src/foundation/WorkbenchBrowserControlPage.tsx'
import { createProjectNeutralFrameSettings } from '../src/foundation/frame-settings-adapter.ts'
import { mutableSettings, settingsFixture } from './settings-fixtures.ts'
import { defaultLayout } from '../src/foundation/model.ts'

afterEach(cleanup)
it('selects independently from opening and pinning, drills into saved areas, and reads memory only on demand', async () => {
  const value = settingsFixture(); value.workbenches.a!.areaDefinitions = { closed: { areaId: 'closed', createdAt: 1 } } as never
  const f = mutableSettings(value), directory = createProjectNeutralFrameSettings(f.source).directory
  directory.memoryRequest = vi.fn(async () => []) as never
  const open = vi.fn(async () => {})
  const view = render(<WorkbenchHome directory={directory} value={value} onOpenWorkbench={open} onCreated={() => {}} />)
  expect(view.queryByRole('button', { name: '工作台管理', exact: true })).toBeNull()
  fireEvent.click(within(view.getByRole('article', { name: 'B' })).getByRole('button', { pressed: false, name: /B/ }))
  expect(view.getByRole('region', { name: 'B详情' })).toBeDefined()
  expect(open).not.toHaveBeenCalled()
  fireEvent.click(within(view.getByRole('article', { name: 'B' })).getByRole('button', { name: '固定到 DSH 侧栏' }))
  await waitFor(() => expect(f.source.getSnapshot().value?.sidebarShortcuts).toEqual(['b']))
  expect(open).not.toHaveBeenCalled()
  fireEvent.click(view.getByRole('button', { name: '打开工作台', exact: true }))
  await waitFor(() => expect(open).toHaveBeenCalledExactlyOnceWith('b'))
  fireEvent.click(view.getByRole('button', { name: /查看区域/ }))
  expect(view.getByRole('tab', { name: '区域与内页' }).getAttribute('aria-selected')).toBe('true')
  expect(view.getByText('私密对话')).toBeDefined()
  fireEvent.click(view.getByRole('tab', { name: '背景与记忆' }))
  expect(directory.memoryRequest).not.toHaveBeenCalled()
  fireEvent.click(view.getByRole('button', { name: '查看与管理记忆' }))
  await waitFor(() => expect(directory.memoryRequest).toHaveBeenCalledWith(expect.objectContaining({ action: 'memory-list', workbenchId: 'b' })))
})

it('allows reclaim with sharing active and surfaces false results rather than success', async () => {
  const requestReclaim = vi.fn(async () => false)
  const shareController = { refresh: vi.fn(async () => {}), stop: vi.fn(), guests: vi.fn(async () => []) }
  const view = render(<WorkbenchBrowserControlPage workbenchId="a" workbenchName="开发空间" browserStatus="ready" layout={defaultLayout()}
    shareSnapshot={{ sessions: [{ workbenchId: 'a', guestCount: 2, maxGuests: 5 }], links: {}, supported: true } as never}
    shareController={shareController as never} requestReclaim={requestReclaim} />)
  const button = view.getByRole('button', { name: '收回到 DSH 客户端' })
  expect((button as HTMLButtonElement).disabled).toBe(false)
  fireEvent.click(button)
  await view.findByText('尚未完成收回，请检查下方进度并重试。')
  expect(requestReclaim).toHaveBeenCalledExactlyOnceWith({ force: false })
  expect(shareController.stop).not.toHaveBeenCalled()
  expect(view.queryByText('Workbench Host')).toBeNull()
})
