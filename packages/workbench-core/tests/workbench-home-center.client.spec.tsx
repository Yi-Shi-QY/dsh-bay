// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorkbenchHomeCenter, type WorkbenchHomeCenterProps } from '../src/foundation/WorkbenchHomeCenter.tsx'
import { createProjectNeutralFrameSettings } from '../src/foundation/frame-settings-adapter.ts'
import { mutableSettings, settingsFixture } from './settings-fixtures.ts'

afterEach(cleanup)
function setup(options: { value?: ReturnType<typeof settingsFixture>; windowController?: unknown; isBrowserOwned?: (workbenchId: string) => boolean } = {}) {
  const value = options.value ?? settingsFixture(); delete value.workbenches.b
  const f = mutableSettings(value)
  const directory = createProjectNeutralFrameSettings(f.source, options.isBrowserOwned ? { isBrowserOwned: options.isBrowserOwned } : {}).directory
  const editors: never[] = []
  const onOpenWorkbench = vi.fn(async (id: string) => { await directory.openAndSelect(id) })
  const distributionPackage = { history: vi.fn(async () => []), prepareExport: vi.fn(), inspect: vi.fn(), inspectLegacy: vi.fn(), confirm: vi.fn(), resume: vi.fn(), cancel: vi.fn(), restorePending: vi.fn() }
  let guard: (() => Promise<boolean>) | undefined
  const props = { directory, workbenchSettings: f.source, editorCatalog: { getSnapshot: () => editors, subscribe: () => () => {} },
    useSessions: (select: any) => select({ ids: [], byId: {} }), useWorkspaces: (select: any) => select({ items: [] }),
    onOpenWorkbench, onCreated: vi.fn(), distributionPackage, ...(options.windowController ? { windowController: options.windowController } : {}),
    registerBeforeLeave: (next: () => Promise<boolean>) => { guard = next; return () => { guard = undefined } },
  } as WorkbenchHomeCenterProps
  return { ...f, directory, distributionPackage, onOpenWorkbench, props, view: render(<WorkbenchHomeCenter {...props} />), leave: () => guard!() }
}

describe('Workbench Home center', () => {
  it('does not prompt again after saving normalized tags and whitespace', async () => {
    const f = setup(), { view } = f
    fireEvent.click(view.getByRole('button', { name: '管理', exact: true }))
    fireEvent.change(await view.findByLabelText('名称'), { target: { value: ' A ' } })
    fireEvent.change(view.getByLabelText('标签'), { target: { value: '研发, 协作,研发' } })
    fireEvent.click(view.getByRole('button', { name: '保存资料' }))
    await waitFor(() => expect(f.source.getSnapshot().value!.workbenches.a!.tags).toEqual(['研发', '协作']))
    await waitFor(() => expect((view.getByRole('button', { name: '保存资料' }) as HTMLButtonElement).disabled).toBe(true))
    fireEvent.click(view.getByRole('button', { name: '返回总览' }))
    await view.findByRole('heading', { name: '你的工作台', exact: true })
    expect(view.queryByRole('alertdialog')).toBeNull()
  })

  it('manages, archives, restores and deletes the only open workbench without Settings', async () => {
    const f = setup(), { view } = f
    fireEvent.click(view.getByRole('button', { name: '管理', exact: true }))
    await view.findByLabelText('名称')
    expect(view.queryByRole('dialog', { name: '工作台设置' })).toBeNull()
    fireEvent.click(view.getByRole('button', { name: '归档工作台' }))
    await waitFor(() => expect(f.source.getSnapshot().value!.openWorkbenchIds).toEqual([]))
    expect(f.source.getSnapshot().value!.workbenches.a!.archivedAt).toBeDefined()
    fireEvent.click(view.getByRole('button', { name: '恢复工作台' }))
    await waitFor(() => expect(f.source.getSnapshot().value!.workbenches.a!.archivedAt).toBeUndefined())
    fireEvent.click(view.getByRole('button', { name: '打开工作台', exact: true }))
    await waitFor(() => expect(f.onOpenWorkbench).toHaveBeenCalledWith('a'))
    fireEvent.click(view.getByRole('button', { name: '永久删除布局' }))
    fireEvent.click(view.getByRole('button', { name: '确认永久删除“A”' }))
    await view.findByRole('button', { name: '创建第一个工作台' })
    expect(f.source.getSnapshot().value!.workbenches).toEqual({})
    expect(f.source.getSnapshot().value!.openWorkbenchIds).toEqual([])
    expect(f.source.getSnapshot().value!.activeWorkbenchId).toBe('')
  })

  it('keeps an archived browser-owned workbench visible and unlocks restore after reclaim', async () => {
    const value = settingsFixture()
    value.workbenches.a!.archivedAt = 3
    value.openWorkbenchIds = []
    value.activeWorkbenchId = ''
    let windowSnapshot = {
      supported: true,
      windows: [],
      requests: [{ workbenchId: 'a', status: 'ready' as const, windowId: '00000000-0000-4000-8000-000000000001' }],
    }
    const listeners = new Set<() => void>()
    const windowController = {
      getSnapshot: () => windowSnapshot,
      subscribe(listener: () => void) { listeners.add(listener); return () => listeners.delete(listener) },
      open: vi.fn(async () => ({ status: 'failed' as const, code: 'unused' })),
      reclaim: vi.fn(async () => {
        windowSnapshot = { ...windowSnapshot, requests: [{ ...windowSnapshot.requests[0]!, status: 'reclaimed' as const }] }
        listeners.forEach(listener => listener())
        return { status: 'reclaimed' as const }
      }),
      focus: vi.fn(async () => ({ status: 'failed' as const, code: 'unused' })),
      close: vi.fn(async () => ({ status: 'failed' as const, code: 'unused' })),
    }
    const f = setup({ value, windowController, isBrowserOwned: id => id === 'a' && windowSnapshot.requests[0]?.status !== 'reclaimed' })
    const row = within(f.view.getByRole('article', { name: 'A' }))
    expect(row.getByText('浏览器中 · 已归档')).toBeDefined()
    const restore = row.getByRole('button', { name: '恢复工作台：A' }) as HTMLButtonElement
    expect(restore.disabled).toBe(true)
    expect(await f.directory.restore('a')).toMatchObject({ status: 'unavailable' })
    expect(f.writes).toHaveLength(0)
    fireEvent.click(row.getByRole('button', { name: '收回控制权：A' }))
    await waitFor(() => expect(restore.disabled).toBe(false))
    expect(windowController.reclaim).toHaveBeenCalledOnce()
    fireEvent.click(restore)
    await waitFor(() => expect(f.source.getSnapshot().value!.workbenches.a!.archivedAt).toBeUndefined())
  })

  it('keeps restore locked and explains how to retry after reclaim times out', async () => {
    const value = settingsFixture()
    value.workbenches.a!.archivedAt = 3
    value.openWorkbenchIds = []
    value.activeWorkbenchId = ''
    const windowSnapshot = {
      supported: true,
      windows: [],
      requests: [{ workbenchId: 'a', status: 'ready' as const, windowId: '00000000-0000-4000-8000-000000000001' }],
    }
    const windowController = {
      getSnapshot: () => windowSnapshot,
      subscribe: () => () => {},
      open: vi.fn(async () => ({ status: 'failed' as const, code: 'unused' })),
      reclaim: vi.fn(async () => ({ status: 'failed' as const, code: 'browser-view-reclaim-timeout' })),
      focus: vi.fn(async () => ({ status: 'failed' as const, code: 'unused' })),
      close: vi.fn(async () => ({ status: 'failed' as const, code: 'unused' })),
    }
    const f = setup({ value, windowController, isBrowserOwned: id => id === 'a' })
    const row = within(f.view.getByRole('article', { name: 'A' }))
    fireEvent.click(row.getByRole('button', { name: '收回控制权：A' }))
    expect((await f.view.findByRole('alert')).textContent).toContain('浏览器没有及时确认收回')
    expect((row.getByRole('button', { name: '恢复工作台：A' }) as HTMLButtonElement).disabled).toBe(true)
    expect(f.writes).toHaveLength(0)
  })

  it('hosts template import, export and durable history in Home with three extension delivery choices', async () => {
    const f = setup(), { view } = f
    fireEvent.click(within(view.getByRole('region', { name: '添加工作台' })).getByRole('button', { name: '导入工作台包' }))
    await view.findByLabelText('工作台包文件')
    expect(view.queryByRole('dialog')).toBeNull()
    fireEvent.click(view.getByRole('button', { name: '返回总览' }))
    fireEvent.click(await view.findByRole('button', { name: '更多操作：A' }))
    fireEvent.click(await view.findByRole('menuitem', { name: '导出工作台' }))
    const select = await view.findByLabelText('扩展交付方式') as HTMLSelectElement
    expect(Array.from(select.options).map(o => o.value)).toEqual(['layout-only', 'online-reference', 'offline-embedded'])
    expect((view.getByLabelText('工作台') as HTMLSelectElement).value).toBe('a')
    fireEvent.click(view.getByRole('button', { name: '返回总览' }))
    await view.findByRole('heading', { name: '你的工作台' })
    fireEvent.click(await view.findByRole('button', { name: '导入记录' }))
    await waitFor(() => expect(f.distributionPackage.history).toHaveBeenCalled())
    expect(view.getByRole('button', { name: '刷新记录' })).toBeDefined()
  })

  it('guards leaving Home through the shell and preserves cancelled metadata edits', async () => {
    const f = setup(), { view } = f
    fireEvent.click(view.getByRole('button', { name: '管理', exact: true }))
    await view.findByLabelText('名称')
    fireEvent.change(view.getByLabelText('名称'), { target: { value: '未保存' } })
    let leaving!: Promise<boolean>
    act(() => { leaving = f.leave() })
    fireEvent.click(view.getByRole('button', { name: '继续编辑' }))
    expect(await leaving).toBe(false)
    expect((view.getByLabelText('名称') as HTMLInputElement).value).toBe('未保存')
    act(() => { leaving = f.leave() })
    fireEvent.click(view.getByRole('button', { name: '保存并离开' }))
    expect(await leaving).toBe(true)
    expect(f.source.getSnapshot().value!.workbenches.a!.name).toBe('未保存')
  })
})
