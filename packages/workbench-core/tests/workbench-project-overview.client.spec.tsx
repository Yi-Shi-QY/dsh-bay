// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { WorkbenchProjectOverview } from '../src/foundation/WorkbenchProjectOverview.tsx'
import type { WorkbenchDirectory } from '../src/foundation/frame-settings-adapter.ts'
import type { WorkbenchProjectV1, WorkbenchSessionEntryV1 } from '../src/workbench-directory-contract.ts'

afterEach(cleanup)

it('keeps project background, memory, sessions and resumable tasks available in the overview', async () => {
  const memoryRequest = vi.fn(async () => [{ id: 'm1', title: 'Decision', removed: false }])
  const session: WorkbenchSessionEntryV1 = { sessionKey: 's1', sessionId: 'session-1', role: 'user', projectId: 'project-1', relativePath: 'projects/app', title: 'Implementation', agentPreset: 'standard', createdAt: 1 }
  const directory = {
    memoryRequest,
    getProjectSessions: () => [session],
  } as unknown as WorkbenchDirectory
  const project = {
    projectId: 'project-1', workspaceId: 'workspace-1', relativePath: 'projects/app', name: 'App', generation: 1,
    context: { human: { objective: 'Ship the app', constraints: ['Keep API stable'], inputs: ['Design system'], successCriteria: ['All tests pass'] }, agent: { summary: 'API work is complete' } },
  } as unknown as WorkbenchProjectV1
  const onEditBackground = vi.fn(), onAddPage = vi.fn(), onOpenSession = vi.fn()
  const recoverWorkItem = vi.fn(async () => {})
  const view = render(<WorkbenchProjectOverview project={project} directory={directory} workbenchId="workbench-1"
    tasks={{ workItems: [{ workItemId: 'task-1', projectId: 'project-1', objective: 'Finish UI', status: 'waiting' }] } as never}
    controller={{ recoverWorkItem } as never} onOpenSession={onOpenSession} onAddPage={onAddPage} onEditBackground={onEditBackground} />)

  expect(view.getByText('Ship the app')).toBeTruthy()
  expect(view.getByText('Keep API stable')).toBeTruthy()
  expect(view.getByText('Design system')).toBeTruthy()
  expect(view.getByText('All tests pass')).toBeTruthy()
  expect(view.getByText('API work is complete')).toBeTruthy()
  fireEvent.click(view.getByRole('button', { name: '编辑' }))
  expect(onEditBackground).toHaveBeenCalledOnce()

  await waitFor(() => expect(view.getByText('1 条')).toBeTruthy())
  expect(memoryRequest).toHaveBeenCalledWith({ action: 'memory-list', workbenchId: 'workbench-1', projectId: 'project-1' })
  fireEvent.click(view.getByRole('button', { name: /管理/ }))
  expect(await view.findByRole('dialog')).toBeTruthy()
  await waitFor(() => expect(memoryRequest).toHaveBeenCalledWith(expect.objectContaining({ action: 'memory-list', projectId: 'project-1' })))

  fireEvent.click(view.getByRole('button', { name: '打开', exact: true }))
  expect(onOpenSession).toHaveBeenCalledExactlyOnceWith(session)
  fireEvent.click(view.getByRole('button', { name: '新建对话' }))
  expect(onAddPage).toHaveBeenCalledOnce()
  fireEvent.click(view.getByRole('button', { name: '继续任务' }))
  await waitFor(() => expect(recoverWorkItem).toHaveBeenCalledExactlyOnceWith('task-1'))
})
