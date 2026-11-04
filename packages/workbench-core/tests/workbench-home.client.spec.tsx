// @vitest-environment jsdom
import React from 'react'
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorkbenchHome } from '../src/foundation/WorkbenchHome.tsx'
import { migrateDocumentV2ToV3 } from '../src/foundation/document-v3.ts'
import { defaultLayout } from '../src/foundation/model.ts'

afterEach(() => cleanup())

function directory(overrides: Record<string, unknown> = {}) {
  const snapshot = {
    activeWorkbenchId: undefined as string | undefined,
    openWorkbenchIds: [] as string[],
    rows: [] as Array<{ workbenchId: string; name: string; description: string; createdAt: number; updatedAt: number }>,
    invalidRows: [],
    templates: [],
    ...overrides,
  }
  return {
    getSnapshot: () => snapshot,
    subscribe: () => () => {},
    getDocument: () => migrateDocumentV2ToV3(defaultLayout()),
    openAndSelect: vi.fn(async () => ({ status: 'committed' as const, revision: 2 })),
    create: vi.fn(async () => ({ status: 'committed' as const, revision: 2, workbenchId: 'created' })),
    archive: vi.fn(async () => ({ status: 'committed' as const, revision: 2 })),
    restore: vi.fn(async () => ({ status: 'committed' as const, revision: 2 })),
    ...overrides,
  }
}

describe('Workbench Home', () => {
  it('creates only empty preset Areas without offering or submitting editor choices', async () => {
    const d = directory()
    const onCreated = vi.fn()
    const view = render(<WorkbenchHome directory={d as never} editors={[{ id: 'test.root', scope: 'root', label: '笔记' }]} onOpenWorkbench={vi.fn()} onCreated={onCreated} />)
    fireEvent.click(view.getByRole('button', { name: '创建工作台', exact: true }))
    expect(view.getAllByRole('menuitem')).toHaveLength(9)
    expect(view.queryByRole('dialog')).toBeNull()
    const preset = view.getByRole('menuitem', { name: '左主右双区，3 个区域' })
    expect(preset.querySelectorAll('svg rect')).toHaveLength(3)
    fireEvent.click(preset)
    fireEvent.change(view.getByLabelText('名称'), { target: { value: '研究工作台' } })
    expect(view.queryByRole('combobox')).toBeNull()
    expect(view.queryByText('选择内页')).toBeNull()
    expect(view.queryByRole('button', { name: '下一步' })).toBeNull()
    fireEvent.click(view.getByRole('button', { name: '创建并打开' }))
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('created'))
    expect(d.create).toHaveBeenCalledWith({ name: '研究工作台', description: '', layoutPresetId: 'left-stack' })
  })

  it('imports from the compact menu without creating a workbench or showing a layout heading', async () => {
    const d = directory()
    const navigate = vi.fn()
    const view = render(<WorkbenchHome directory={d as never} navigate={navigate} onOpenWorkbench={vi.fn()} onCreated={vi.fn()} />)
    const anchor = view.getByRole('button', { name: '创建工作台', exact: true })
    fireEvent.click(anchor)
    const menu = view.getByRole('menu')
    expect(within(menu).queryByText('区域划分')).toBeNull()
    expect(within(menu).getByRole('group', { name: '区域划分' })).toBeDefined()
    expect(within(menu).getAllByRole('menuitem')).toHaveLength(10)
    await waitFor(() => expect(document.activeElement).toBe(within(menu).getByRole('menuitem', { name: /新建空白工作台/ })))
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' })
    const importAction = within(menu).getByRole('menuitem', { name: '导入工作台包' })
    expect(document.activeElement).toBe(importAction)
    fireEvent.click(importAction)
    expect(navigate).toHaveBeenCalledWith({ section: 'sharing', shareMode: 'import' })
    expect(anchor.getAttribute('aria-expanded')).toBe('false')
    expect(d.create).not.toHaveBeenCalled()
    expect(view.queryByRole('dialog')).toBeNull()
  })

  it('supports keyboard navigation and Escape without creating anything', async () => {
    const d = directory()
    const view = render(<WorkbenchHome directory={d as never} onOpenWorkbench={vi.fn()} onCreated={vi.fn()} />)
    const anchor = view.getByRole('button', { name: '创建工作台', exact: true })
    fireEvent.click(anchor)
    await waitFor(() => expect(document.activeElement?.getAttribute('role')).toBe('menuitem'))
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' })
    const columns = view.getByRole('menuitem', { name: '左右双栏，2 个区域' })
    expect(document.activeElement).toBe(columns)
    fireEvent.keyDown(columns, { key: 'ArrowRight' })
    expect(document.activeElement).toBe(view.getByRole('menuitem', { name: '上下双栏，2 个区域' }))
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
    await waitFor(() => expect(anchor.getAttribute('aria-expanded')).toBe('false'))
    expect(document.activeElement).toBe(anchor)
    expect(d.create).not.toHaveBeenCalled()
  })

  it('filters open, closed and archived cards, searches tags and preserves diagnostics', () => {
    const navigate = vi.fn()
    const rows = [
      { workbenchId: 'open', name: '开发空间', description: '项目开发', tags: ['研发'], updatedAt: 3, createdAt: 1 },
      { workbenchId: 'closed', name: '资料整理', description: '团队知识', updatedAt: 2, createdAt: 1 },
      { workbenchId: 'archived', name: '历史项目', description: '', archivedAt: 3, updatedAt: 1, createdAt: 1 },
    ]
    const view = render(<WorkbenchHome directory={directory({ rows, openWorkbenchIds: ['open'], invalidRows: [{ workbenchId: 'broken', name: '待修复' }] }) as never} navigate={navigate} onOpenWorkbench={vi.fn()} onCreated={vi.fn()} />)
    expect(view.getAllByRole('article')).toHaveLength(4)
    expect(within(view.getByRole('article', { name: '开发空间' })).getByText('已打开')).toBeDefined()
    fireEvent.click(view.getByRole('button', { name: /^已归档/ }))
    expect(view.getByRole('heading', { name: '历史项目' })).toBeDefined()
    expect(view.queryByRole('heading', { name: '开发空间' })).toBeNull()
    fireEvent.click(within(view.getByRole('group', { name: '按工作台状态筛选' })).getByRole('button', { name: /^全部/ }))
    fireEvent.change(view.getByRole('searchbox', { name: '搜索工作台' }), { target: { value: '研发' } })
    expect(view.getByRole('heading', { name: '开发空间' })).toBeDefined()
    expect(view.queryByRole('heading', { name: '资料整理' })).toBeNull()
    fireEvent.click(view.getByRole('button', { name: '打开诊断' }))
    expect(navigate).toHaveBeenCalledWith({ section: 'workbenches', workbenchId: 'broken' })
    fireEvent.change(view.getByRole('searchbox'), { target: { value: '不存在' } })
    expect(view.getByText('没有找到工作台')).toBeDefined()
    fireEvent.click(view.getByRole('button', { name: '查看全部工作台' }))
    expect(view.getAllByRole('article')).toHaveLength(4)
  })

  it('keeps the selected preset and input after failure and supports retry', async () => {
    const d = directory({ templates: [{ templateId: 'saved', name: '双栏模板' }], getDocument: () => undefined })
    d.create = vi.fn().mockResolvedValueOnce({ status: 'rejected', reason: 'duplicate-name' }).mockResolvedValueOnce({ status: 'committed', workbenchId: 'created' })
    const onCreated = vi.fn()
    const view = render(<WorkbenchHome directory={d as never} onOpenWorkbench={vi.fn()} onCreated={onCreated} />)
    fireEvent.click(view.getByRole('button', { name: '创建工作台', exact: true }))
    fireEvent.click(view.getByRole('menuitem', { name: '左右双栏，2 个区域' }))
    const dialog = view.getByRole('dialog', { name: '创建工作台' })
    fireEvent.change(within(dialog).getByLabelText('名称'), { target: { value: '团队空间' } })
    fireEvent.change(within(dialog).getByLabelText('简介（可选）'), { target: { value: '共同研究' } })
    expect(within(dialog).queryByRole('combobox')).toBeNull()
    expect(view.queryByText('双栏模板')).toBeNull()
    fireEvent.click(within(dialog).getByRole('button', { name: '创建并打开' }))
    await view.findByRole('alert')
    expect(onCreated).not.toHaveBeenCalled()
    expect((view.getByLabelText('名称') as HTMLInputElement).value).toBe('团队空间')
    expect(within(dialog).getByText('左右双栏')).toBeDefined()
    fireEvent.click(within(dialog).getByRole('button', { name: '创建并打开' }))
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('created'))
    expect(d.create).toHaveBeenLastCalledWith({ layoutPresetId: 'columns', name: '团队空间', description: '共同研究' })
    expect(view.queryByRole('dialog')).toBeNull()
  })

  it('lets the native menu archive the last card without opening a workbench', async () => {
    const d = directory({ rows: [{ workbenchId: 'one', name: '唯一工作台', description: '', createdAt: 1, updatedAt: 1 }] })
    const onOpenWorkbench = vi.fn()
    const view = render(<WorkbenchHome directory={d as never} onOpenWorkbench={onOpenWorkbench} onCreated={vi.fn()} />)
    const anchor = view.getByRole('button', { name: '更多操作：唯一工作台' })
    fireEvent.click(anchor)
    expect(anchor.getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(await view.findByRole('menuitem', { name: '归档工作台' }))
    await waitFor(() => expect(d.archive).toHaveBeenCalledWith('one'))
    expect(onOpenWorkbench).not.toHaveBeenCalled()
    expect(anchor.getAttribute('aria-expanded')).toBe('false')
  })

  it('creates the first blank workbench directly after naming it', async () => {
    const d = directory()
    const onCreated = vi.fn()
    const view = render(<WorkbenchHome directory={d as never} onOpenWorkbench={vi.fn(async () => {})} onCreated={onCreated} />)
    expect(view.getByText('从这里，开始你的工作台')).toBeDefined()
    fireEvent.click(view.getByRole('button', { name: '创建第一个工作台' }))
    fireEvent.click(view.getByRole('menuitem', { name: /新建空白工作台/ }))
    expect((view.getByRole('button', { name: '创建并打开' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(view.getByLabelText('名称'), { target: { value: '试用工作台' } })
    fireEvent.click(view.getByRole('button', { name: '创建并打开' }))
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('created'))
    expect(d.create).toHaveBeenCalledWith({ name: '试用工作台', description: '', layoutPresetId: 'single' })
  })

  it('cancels the naming dialog without creating a workbench', () => {
    const d = directory()
    const view = render(<WorkbenchHome directory={d as never} onOpenWorkbench={vi.fn()} onCreated={vi.fn()} />)
    fireEvent.click(view.getByRole('button', { name: '创建工作台', exact: true }))
    fireEvent.click(view.getByRole('menuitem', { name: '四宫格，4 个区域' }))
    fireEvent.change(view.getByLabelText('名称'), { target: { value: '未完成' } })
    fireEvent.click(view.getByRole('button', { name: '取消' }))
    expect(view.queryByRole('dialog')).toBeNull()
    expect(d.create).not.toHaveBeenCalled()
  })

  it('opens cards and promotes sharing actions to Home', async () => {
    const onOpenWorkbench = vi.fn(async () => {})
    const openSettings = vi.fn()
    const snapshot = {
      activeWorkbenchId: 'one',
      openWorkbenchIds: [],
      rows: [{ workbenchId: 'one', name: '试用工作台', description: '团队试用', createdAt: 1, updatedAt: 2 }],
      invalidRows: [], templates: [],
    }
    const view = render(<WorkbenchHome
      directory={directory({ getSnapshot: () => snapshot }) as never}
      navigate={openSettings}
      onOpenWorkbench={onOpenWorkbench}
      onCreated={() => {}}
    />)
    fireEvent.click(view.getByRole('button', { name: '打开工作台' }))
    await waitFor(() => expect(onOpenWorkbench).toHaveBeenCalledWith('one'))
    fireEvent.click(view.getByRole('button', { name: '更多操作：试用工作台' }))
    fireEvent.click(await view.findByRole('menuitem', { name: '导出工作台' }))
    expect(openSettings).toHaveBeenCalledWith({ section: 'sharing', workbenchId: 'one', shareMode: 'export' })
    fireEvent.click(view.getByRole('button', { name: '导入工作台包' }))
    expect(openSettings).toHaveBeenCalledWith({ section: 'sharing', shareMode: 'import' })
  })
})
