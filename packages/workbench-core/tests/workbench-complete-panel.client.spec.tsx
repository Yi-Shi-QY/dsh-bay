// @vitest-environment jsdom
import React from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { WorkbenchCompletePackagePanel, WorkbenchImportDirectoryRequests } from '../src/foundation/WorkbenchCompletePackagePanel.tsx'
import { WorkbenchLayoutSharingPage } from '../src/foundation/WorkbenchLayoutSharingPage.tsx'
import { WorkbenchSharingPage } from '../src/foundation/WorkbenchSharingPage.tsx'
import { settingsFixture } from './settings-fixtures.ts'

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

it('uses the selected workbench for complete export and retains it when switching package types', async () => {
  client.request.mockImplementation(async input => input.action === 'jobs' ? [] : { id: 'export', kind: 'export', stage: 'queued', files: 0, bytes: 0 })
  const prepareExport = vi.fn(async () => { throw new Error('fixture-preview-unavailable') })
  const view = render(<WorkbenchSharingPage {...{
    value: settingsFixture(), editors: [], workbenchDirectory: { completeRequest: vi.fn() },
    distributionPackage: { prepareExport, history: vi.fn(async () => []) },
    useSessions: (select: (value: object) => unknown) => select({ ids: [], byId: {} }),
  } as never} />)
  fireEvent.change(view.getByLabelText('完整包来源工作台'), { target: { value: 'b' } })
  fireEvent.click(view.getByRole('button', { name: '生成完整包' }))
  await waitFor(() => expect(client.request).toHaveBeenCalledWith(expect.objectContaining({ action: 'start-export', workbenchId: 'b' })))
  fireEvent.click(view.getByRole('button', { name: '布局与扩展', exact: true }))
  expect((view.getByLabelText('分享来源工作台') as HTMLSelectElement).value).toBe('b')
  fireEvent.click(view.getByRole('button', { name: '保存布局并生成分享包' }))
  await waitFor(() => expect(prepareExport).toHaveBeenCalledWith('b', 'layout-only', false))
  expect(await view.findByText('fixture-preview-unavailable')).toBeTruthy()
})

it('keeps an upload alive while switching package types and restores the checked import form', async () => {
  client.request.mockResolvedValue([])
  let finish!: (value: unknown) => void
  let uploadSignal: AbortSignal | undefined
  client.upload.mockImplementation((_file, _input, onProgress, signal) => {
    uploadSignal = signal
    onProgress({ id: 'upload', name: 'received.tgz', size: 20, received: 10, state: 'uploading' })
    return new Promise(resolve => { finish = resolve })
  })
  const view = render(<WorkbenchSharingPage {...{
    value: settingsFixture(), editors: [], openOptions: { shareMode: 'import' },
    workbenchDirectory: { completeRequest: vi.fn() }, distributionPackage: { history: vi.fn(async () => []) },
    useSessions: (select: (value: object) => unknown) => select({ ids: [], byId: {} }),
  } as never} />)
  fireEvent.change(view.getByLabelText('接收完整包'), { target: { files: [new File(['data'], 'received.tgz')] } })
  expect(view.getByRole('progressbar', { name: '完整包上传进度' }).getAttribute('value')).toBe('50')
  fireEvent.click(view.getByRole('button', { name: '布局与扩展', exact: true }))
  expect(uploadSignal?.aborted).toBe(false)
  await act(async () => { finish({ upload: { id: 'upload', name: 'received.tgz', size: 20, received: 20, state: 'ready' }, preflight: { valid: true, workbenchId: 'received', sessionCount: 2 } }) })
  fireEvent.click(view.getByRole('button', { name: '完整工作台包', exact: true }))
  expect((view.getByLabelText('新工作台文件夹名称') as HTMLInputElement).value).toBe('received')
  expect(view.getByRole('button', { name: '导入并保持暂停' }).hasAttribute('disabled')).toBe(true)
  expect(client.upload).toHaveBeenCalledOnce()
})
