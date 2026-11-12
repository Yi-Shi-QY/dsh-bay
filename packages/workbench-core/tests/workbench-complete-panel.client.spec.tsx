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

const importReport = { data: 'complete', environment: 'needs-setup', tasks: 'waiting-for-user', blockers: [], exclusions: ['cache/'], environmentSteps: ['选择本机模型连接'] }
function savedImport(extra: object = {}) {
  sessionStorage.setItem('bay.complete-transfer.v1.', JSON.stringify({ folderName: 'product', name: '产品研发', upload: { id: 'upload', workbenchId: '', name: 'product.tgz', size: 20, received: 20, state: 'ready' }, preflight: { valid: true, workbenchId: 'source', sessionCount: 3 }, selection: { id: 'selection', uploadId: 'upload', workbenchId: '', state: 'selected', displayPath: 'C:\\Imports' }, ...extra }))
}

it('keeps destination fields editable after a target conflict and reuses the uploaded package', async () => {
  savedImport()
  client.request.mockImplementation(async input => {
    if (input.action === 'jobs') return []
    if (input.action === 'start-import') {
      if (input.folderName === 'product') throw new Error('目标工作台文件夹已存在，请修改文件夹名称或重新选择位置。')
      return { id: 'job', requestId: input.requestId, workbenchId: 'new', kind: 'import', stage: 'queued', files: 0, bytes: 0, running: true }
    }
  })
  const view = render(<WorkbenchCompletePackagePanel workbenchId="other" mode="import" />)
  expect(view.getByText('C:\\Imports\\product')).toBeTruthy()
  fireEvent.click(view.getByRole('button', { name: '导入并保持暂停' }))
  await view.findByRole('alert')
  expect((view.getByLabelText('新工作台文件夹名称') as HTMLInputElement).disabled).toBe(false)
  expect((view.getByRole('button', { name: '选择目标父目录' }) as HTMLButtonElement).disabled).toBe(false)
  fireEvent.change(view.getByLabelText('新工作台文件夹名称'), { target: { value: 'product-copy' } })
  fireEvent.click(view.getByRole('button', { name: '导入并保持暂停' }))
  await waitFor(() => expect(client.request).toHaveBeenCalledWith(expect.objectContaining({ action: 'start-import', workbenchId: '', uploadId: 'upload', folderName: 'product-copy' })))
  expect(client.upload).not.toHaveBeenCalled()
})

it('restores the completed result after remount and opens only when explicitly requested', async () => {
  savedImport({ jobId: 'job' })
  const open = vi.fn()
  client.request.mockResolvedValue([{ id: 'job', workbenchId: 'new', name: '产品研发', kind: 'import', stage: 'complete', files: 12, bytes: 20, report: importReport }])
  const view = render(<WorkbenchCompletePackagePanel workbenchId="other" mode="import" onOpenWorkbench={open} />)
  const button = await view.findByRole('button', { name: '打开工作台' })
  expect(view.getByText('选择本机模型连接')).toBeTruthy()
  expect(view.getByText('cache/')).toBeTruthy()
  expect(open).not.toHaveBeenCalled()
  expect(client.request.mock.calls.every(([input]) => input.action === 'jobs')).toBe(true)
  fireEvent.click(button)
  await waitFor(() => expect(open).toHaveBeenCalledWith('new'))
})

it('does not tie a new desktop import to the browser-owned current workbench', async () => {
  client.request.mockResolvedValue([])
  const value = settingsFixture()
  const view = render(<WorkbenchSharingPage {...{ value, editors: [], openOptions: { shareMode: 'import' }, workbenchDirectory: { completeRequest: vi.fn() }, windowController: { getSnapshot: () => ({ requests: [{ workbenchId: value.activeWorkbenchId, status: 'ready' }] }) }, useSessions: () => ({ ids: [], byId: {} }) } as never} />)
  expect((view.getByLabelText('接收完整包') as HTMLInputElement).disabled).toBe(false)
  await waitFor(() => expect(client.request).toHaveBeenCalledWith({ action: 'jobs', workbenchId: '', allImports: true }, expect.anything()))
})

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
  expect(view.getByRole('heading', { name: '分享与迁移' })).toBeTruthy()
  expect(view.getByLabelText('接收完整包').hasAttribute('disabled')).toBe(false)
  expect(view.queryByLabelText('分享来源工作台')).toBeNull()
  fireEvent.click(view.getByRole('button', { name: '导出工作台', exact: true }))
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
  expect(view.getByRole('button', { name: '生成完整包' }).hasAttribute('disabled')).toBe(true)
  fireEvent.click(view.getByRole('button', { name: '导入工作台', exact: true }))
  expect(view.getByLabelText('接收完整包').hasAttribute('disabled')).toBe(false)
  await waitFor(() => expect(client.request).toHaveBeenCalledWith({ action: 'jobs', workbenchId: '', allImports: true }, expect.anything()))
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
  fireEvent.click(view.getByRole('button', { name: '工作台模板包', exact: true }))
  expect((view.getByLabelText('分享来源工作台') as HTMLSelectElement).value).toBe('b')
  fireEvent.click(view.getByRole('button', { name: '保存布局并生成模板包' }))
  await waitFor(() => expect(prepareExport).toHaveBeenCalledWith('b', 'layout-only', false, false))
  expect(await view.findByText('fixture-preview-unavailable')).toBeTruthy()
})

function packageFile(bytes: number[], name: string) {
  const data = new Uint8Array(bytes)
  const file = new File([data], name)
  // jsdom's File lacks the browser Blob.arrayBuffer implementation.
  Object.defineProperties(file, {
    arrayBuffer: { value: async () => data.buffer },
    slice: { value: (start: number, end: number) => ({ arrayBuffer: async () => data.slice(start, end).buffer }) },
  })
  return file
}

function unifiedTemplateFixture(openOptions = { shareMode: 'import' }) {
  client.request.mockResolvedValue([])
  const row = { transactionId: 'template', archiveSha256: 'a'.repeat(64), workbenchId: 'received', name: '研发模板', createdAt: 1, mode: 'layout-only', state: 'checked', dependencies: [], installed: [], reused: [], blockers: [], directoryRequired: true }
  const service = { inspect: vi.fn(async () => row), history: vi.fn(async () => [row]), confirm: vi.fn(async () => ({ ...row, state: 'ready' })) }
  const pick = vi.fn(async () => 'D:\\Workbenches'), open = vi.fn()
  const view = render(<WorkbenchSharingPage {...{
    value: settingsFixture(), editors: [], openOptions,
    workbenchDirectory: { completeRequest: vi.fn(), pickParentDirectory: pick }, distributionPackage: service, onOpenWorkbench: open,
    useSessions: (select: (value: object) => unknown) => select({ ids: [], byId: {} }),
  } as never} />)
  return { view, service, row, pick, open }
}

it('routes ZIP content to the template importer and requires a new folder before confirmation', async () => {
  const { view, service, pick, open, row } = unifiedTemplateFixture()
  const bytes = [0x50, 0x4b, 3, 4]
  fireEvent.change(view.getByLabelText('选择要导入的工作台包'), { target: { files: [packageFile(bytes, 'template.wbpkg')] } })
  await view.findByLabelText('模板文件夹名称')
  expect(service.inspect).toHaveBeenCalledWith(new Uint8Array(bytes))
  expect(client.upload).not.toHaveBeenCalled()
  fireEvent.click(view.getByRole('checkbox'))
  expect(view.getByRole('button', { name: '确认导入' }).hasAttribute('disabled')).toBe(true)
  fireEvent.click(view.getByRole('button', { name: '选择目标父目录' }))
  await waitFor(() => expect(view.getByRole('button', { name: '确认导入' }).hasAttribute('disabled')).toBe(false))
  fireEvent.change(view.getByLabelText('模板文件夹名称'), { target: { value: 'new-template' } })
  fireEvent.click(view.getByRole('button', { name: '确认导入' }))
  await waitFor(() => expect(service.confirm).toHaveBeenCalledWith(row, {}, { parentPath: 'D:\\Workbenches', folderName: 'new-template' }))
  await view.findByRole('button', { name: '打开导入的工作台' })
  expect(pick).toHaveBeenCalledOnce(); expect(open).not.toHaveBeenCalled()
})

it('rejects diagnostic JSON without calling either importer', async () => {
  const { view, service } = unifiedTemplateFixture()
  fireEvent.change(view.getByLabelText('选择要导入的工作台包'), { target: { files: [packageFile([123, 34, 97, 34], 'settings.json')] } })
  expect(await view.findByRole('alert')).toBeTruthy()
  expect(service.inspect).not.toHaveBeenCalled(); expect(client.upload).not.toHaveBeenCalled()
})

it('continues template history in the template workflow even when complete export is selected', async () => {
  const { view, service } = unifiedTemplateFixture({ shareMode: 'history' })
  fireEvent.click(await view.findByRole('button', { name: '查看与继续' }))
  expect(view.getByLabelText('模板文件夹名称')).toBeTruthy()
  expect(view.queryByRole('button', { name: '导入并保持暂停' })).toBeNull()
  expect(service.inspect).not.toHaveBeenCalled()
})

it('keeps a pending template inspection when switching to history and back', async () => {
  const { view, service, row } = unifiedTemplateFixture()
  let finish!: (value: typeof row) => void
  service.inspect.mockImplementation(() => new Promise(resolve => { finish = resolve }))
  fireEvent.change(view.getByLabelText('选择要导入的工作台包'), { target: { files: [packageFile([0x50, 0x4b, 3, 4], 'template.zip')] } })
  await waitFor(() => expect(service.inspect).toHaveBeenCalledOnce())
  expect(view.getByLabelText('选择要导入的工作台包').hasAttribute('disabled')).toBe(true)
  fireEvent.click(view.getByRole('button', { name: '导入记录', exact: true }))
  await act(async () => { finish(row) })
  fireEvent.click(view.getByRole('button', { name: '导入工作台', exact: true }))
  expect(view.getByLabelText('模板文件夹名称')).toBeTruthy()
  expect(service.inspect).toHaveBeenCalledOnce()
})

it('detects complete packages by content and keeps uploads alive across operation tabs', async () => {
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
  fireEvent.change(view.getByLabelText('选择要导入的工作台包'), { target: { files: [packageFile([0x1f, 0x8b, 8, 0], 'received.tgz')] } })
  await waitFor(() => expect(view.getByRole('progressbar', { name: '完整包上传进度' }).getAttribute('value')).toBe('50'))
  expect(view.getByLabelText('选择要导入的工作台包').hasAttribute('disabled')).toBe(true)
  expect(view.queryByRole('button', { name: '工作台模板包', exact: true })).toBeNull()
  fireEvent.click(view.getByRole('button', { name: '导入记录', exact: true }))
  expect(uploadSignal?.aborted).toBe(false)
  await act(async () => { finish({ upload: { id: 'upload', name: 'received.tgz', size: 20, received: 20, state: 'ready' }, preflight: { valid: true, workbenchId: 'received', sessionCount: 2 } }) })
  fireEvent.click(view.getByRole('button', { name: '导入工作台', exact: true }))
  expect((view.getByLabelText('新工作台文件夹名称') as HTMLInputElement).value).toBe('received')
  expect(view.getByRole('button', { name: '导入并保持暂停' }).hasAttribute('disabled')).toBe(true)
  expect(client.upload).toHaveBeenCalledOnce()
})
