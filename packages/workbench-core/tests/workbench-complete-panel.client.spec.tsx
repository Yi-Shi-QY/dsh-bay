// @vitest-environment jsdom
import React from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { WorkbenchCompletePackagePanel, WorkbenchImportDirectoryRequests } from '../src/foundation/WorkbenchCompletePackagePanel.tsx'
import { WorkbenchLayoutSharingPage } from '../src/foundation/WorkbenchLayoutSharingPage.tsx'

const client = vi.hoisted(() => ({ request: vi.fn(), upload: vi.fn(), download: vi.fn() }))
vi.mock('../src/client/workbench-complete.ts', () => ({ createWorkbenchCompleteClient: () => client }))
afterEach(() => { cleanup(); vi.resetAllMocks(); sessionStorage.clear() })

it('keeps browser import disabled until desktop selection is confirmed and retains data across a remount', async () => {
  const selection = { id: 'selection', uploadId: 'upload', workbenchId: 'wb', state: 'pending', updatedAt: 1 }
  client.request.mockImplementation(async input => input.action === 'jobs' ? [] : input.action === 'directory-status' ? selection : undefined)
  sessionStorage.setItem('bay.complete-transfer.v1.wb', JSON.stringify({ folderName: 'received', upload: { id: 'upload', name: 'project.tar.gz', size: 10, received: 10, state: 'ready' }, preflight: { valid: true, workbenchId: 'source', sessionCount: 2 }, selection }))
  const view = render(<WorkbenchCompletePackagePanel workbenchId="wb" browser />)
  expect(view.getByRole('button', { name: '导入并保持暂停' }).hasAttribute('disabled')).toBe(true)
  expect(view.getByText(/正在等待 DSH 客户端确认目标目录/)).toBeTruthy()
  await waitFor(() => expect(client.request).toHaveBeenCalledWith({ action: 'directory-status', id: 'selection' }, expect.anything()))
  view.unmount()
  selection.state = 'selected'
  const next = render(<WorkbenchCompletePackagePanel workbenchId="wb" browser />)
  await waitFor(() => expect(next.getByRole('button', { name: '导入并保持暂停' }).hasAttribute('disabled')).toBe(false))
  expect((next.getByLabelText('新工作台文件夹名称') as HTMLInputElement).value).toBe('received')
  expect(client.request.mock.calls.some(([input]) => input.action === 'directory-complete')).toBe(false)
})

it('desktop confirmation uses the chosen Host path and dismisses only that request', async () => {
  const pick = vi.fn(async () => 'D:\\workbenches')
  client.request.mockImplementation(async input => input.action === 'directory-pending' ? [{ id: 'pick', uploadId: 'upload', workbenchId: 'wb', state: 'pending' }] : { state: 'selected' })
  const view = render(<WorkbenchImportDirectoryRequests pickParentDirectory={pick} />)
  fireEvent.click(await view.findByRole('button', { name: '选择目标目录' }))
  await waitFor(() => expect(client.request).toHaveBeenCalledWith({ action: 'directory-complete', id: 'pick', parentPath: 'D:\\workbenches' }))
  expect(pick).toHaveBeenCalledOnce()
  await waitFor(() => expect(view.queryByRole('button', { name: '选择目标目录' })).toBeNull())
})

it('exposes browser complete import and export for the current workbench from the sharing page', async () => {
  client.request.mockImplementation(async input => input.action === 'jobs' ? [] : { id: 'export', kind: 'export', stage: 'queued', files: 0, bytes: 0 })
  const view = render(<WorkbenchLayoutSharingPage {...{
    settingsContext: { mode: 'browser-workbench', workbenchId: 'current' },
    openOptions: { workbenchId: 'other', shareMode: 'import' },
    workbenchDirectory: { completeRequest: vi.fn() },
    useSessions: (select: (value: object) => unknown) => select({ ids: [], byId: {} }),
  } as never} />)
  expect(view.getByRole('heading', { name: '导入与分享' })).toBeTruthy()
  expect(view.getByLabelText('接收完整包').hasAttribute('disabled')).toBe(false)
  expect(view.queryByLabelText('分享来源工作台')).toBeNull()
  fireEvent.click(view.getByRole('button', { name: '生成完整包' }))
  await waitFor(() => expect(client.request).toHaveBeenCalledWith(expect.objectContaining({ action: 'start-export', workbenchId: 'current' })))
  expect(client.request.mock.calls.some(([input]) => input.workbenchId === 'other')).toBe(false)
})

it('offers first-workbench import on an empty desktop without enabling export', async () => {
  client.request.mockResolvedValue([])
  const view = render(<WorkbenchLayoutSharingPage {...{
    workbenchDirectory: { completeRequest: vi.fn(), pickParentDirectory: vi.fn() },
    useSessions: (select: (value: object) => unknown) => select({ ids: [], byId: {} }),
  } as never} />)
  expect(view.getByRole('option', { name: '接收第一个工作台' })).toBeTruthy()
  expect(view.getByLabelText('接收完整包').hasAttribute('disabled')).toBe(false)
  expect(view.getByRole('button', { name: '生成完整包' }).hasAttribute('disabled')).toBe(true)
  await waitFor(() => expect(client.request).toHaveBeenCalledWith({ action: 'jobs', workbenchId: '' }, expect.anything()))
})
