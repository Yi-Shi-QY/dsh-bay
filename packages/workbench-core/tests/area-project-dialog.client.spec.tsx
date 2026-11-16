// @vitest-environment jsdom
import React from 'react'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AreaProjectDialog } from '../src/foundation/AreaProjectDialog.tsx'
import { HostWorkbenchDirectory } from '../src/host-workbench-directory.ts'
import type { WorkbenchDirectory } from '../src/foundation/frame-settings-adapter.ts'

const roots: string[] = []
afterEach(async () => {
  cleanup()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

async function fixture() {
  const parent = await mkdtemp(join(tmpdir(), 'bay-area-dialog-')); roots.push(parent)
  const host = new HostWorkbenchDirectory(join(parent, 'profile'), { create: async (path: string) => ({ id: path }) } as never)
  await host.create({ requestId: 'create', parentPath: parent, folderName: '工作台', record: {
    workbenchId: 'bench', name: '工作台', description: '', createdAt: 1, updatedAt: 1,
    document: { version: 3, activeAreaId: 'area', root: { kind: 'area', areaId: 'area', moduleHistory: [] } },
  } })
  const bindAreaProject = vi.fn(async (input: Parameters<NonNullable<WorkbenchDirectory['bindAreaProject']>>[0]) => {
    const result = await host.bindArea({ ...input, expectedRevision: host.getSnapshot().revision })
    if (result.status !== 'committed') throw new Error('工作台刚刚发生变化，请重试。')
  })
  const directory = {
    getRootPath: () => host.rootPath('bench'),
    getAreaProjects: () => host.getSnapshot().value.workbenches.bench!.areaProjects ?? {},
    listProjectDirectories: (id: string, path?: string) => host.listDirectories(id, path),
    bindAreaProject,
  } as WorkbenchDirectory
  const onClose = vi.fn()
  return { host, directory, bindAreaProject, onClose, root: host.rootPath('bench') }
}

it('creates a named folder inside the workbench and persists the area binding without a Session', async () => {
  const f = await fixture()
  const view = render(<AreaProjectDialog directory={f.directory} workbenchId="bench" areaId="area" onClose={f.onClose} />)
  fireEvent.click(view.getByRole('button', { name: '新建文件夹', exact: true }))
  fireEvent.change(view.getByLabelText('文件夹名称'), { target: { value: '  社媒运营  ' } })
  fireEvent.click(view.getByRole('button', { name: '创建并使用', exact: true }))
  await waitFor(() => expect(f.onClose).toHaveBeenCalledOnce())
  expect((await stat(join(f.root, '社媒运营'))).isDirectory()).toBe(true)
  expect(f.bindAreaProject).toHaveBeenCalledExactlyOnceWith({ workbenchId: 'bench', areaId: 'area', relativePath: '社媒运营', createDirectory: true })
  const saved = JSON.parse(await readFile(join(f.root, '.bay', 'workbench.json'), 'utf8'))
  expect(saved.record.areaProjects.area.relativePath).toBe('社媒运营')
  expect(saved.record.sessionCatalog).toEqual({})
})

it('browses and selects an existing nested folder without enabling creation', async () => {
  const f = await fixture()
  await mkdir(join(f.root, 'projects', 'app'), { recursive: true })
  const view = render(<AreaProjectDialog directory={f.directory} workbenchId="bench" areaId="area" onClose={f.onClose} />)
  fireEvent.click(view.getByRole('button', { name: '选择已有文件夹', exact: true }))
  fireEvent.click(await view.findByRole('button', { name: '打开 projects' }))
  fireEvent.click(await view.findByRole('button', { name: '选择 app' }))
  fireEvent.click(view.getByRole('button', { name: '使用此文件夹' }))
  await waitFor(() => expect(f.onClose).toHaveBeenCalledOnce())
  expect(f.bindAreaProject).toHaveBeenCalledExactlyOnceWith({ workbenchId: 'bench', areaId: 'area', relativePath: 'projects/app', createDirectory: false })
})

it('keeps the name and a visible error after failure, then allows retry', async () => {
  const f = await fixture()
  f.bindAreaProject.mockRejectedValueOnce(new Error('无法写入文件夹，请检查存放位置。'))
  const view = render(<AreaProjectDialog directory={f.directory} workbenchId="bench" areaId="area" onClose={f.onClose} />)
  fireEvent.change(view.getByLabelText('文件夹名称'), { target: { value: 'research' } })
  fireEvent.click(view.getByRole('button', { name: '创建并使用' }))
  expect((await view.findByRole('alert')).textContent).toContain('无法写入文件夹')
  expect(f.onClose).not.toHaveBeenCalled()
  expect((view.getByLabelText('文件夹名称') as HTMLInputElement).value).toBe('research')
  fireEvent.click(view.getByRole('button', { name: '创建并使用' }))
  await waitFor(() => expect(f.onClose).toHaveBeenCalledOnce())
})

it.each(['../escape', '.bay', 'nested/folder', 'CON'])('rejects invalid folder name %s before submitting', async name => {
  const f = await fixture()
  const view = render(<AreaProjectDialog directory={f.directory} workbenchId="bench" areaId="area" onClose={f.onClose} />)
  fireEvent.change(view.getByLabelText('文件夹名称'), { target: { value: name } })
  expect((view.getByRole('button', { name: '创建并使用' }) as HTMLButtonElement).disabled).toBe(true)
  expect(f.bindAreaProject).not.toHaveBeenCalled()
})

it('shows directory read failures and allows a fresh read without closing the dialog', async () => {
  const f = await fixture()
  f.directory.listProjectDirectories = vi.fn().mockRejectedValueOnce(new Error('文件夹暂不可读')).mockResolvedValueOnce([{ name: 'app', relativePath: 'app' }])
  const view = render(<AreaProjectDialog directory={f.directory} workbenchId="bench" areaId="area" onClose={f.onClose} />)
  fireEvent.click(view.getByRole('button', { name: '选择已有文件夹', exact: true }))
  expect((await view.findByRole('alert')).textContent).toContain('文件夹暂不可读')
  fireEvent.click(view.getByRole('button', { name: '重试' }))
  expect(await view.findByRole('button', { name: '选择 app' })).toBeDefined()
  expect(f.onClose).not.toHaveBeenCalled()
  expect(f.bindAreaProject).not.toHaveBeenCalled()
})
