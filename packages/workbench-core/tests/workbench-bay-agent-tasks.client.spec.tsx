// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { WorkbenchBayAgentTasks } from '../src/foundation/WorkbenchBayAgentTasks.tsx'
import type { BayAgentControllerSnapshotV1, BayAgentControllerV1 } from '../src/foundation/workbench-bay-agent-work.ts'

afterEach(cleanup)

const emptySnapshot: BayAgentControllerSnapshotV1 = {
  workbenchId: 'wb',
  areas: [{ areaId: 'area-a', label: 'Area A' }],
  workItems: [],
  assignments: [],
  attention: [],
  orchestration: {
    workbenchId: 'wb',
    currentEventSeq: 0,
    activeWorkItems: [],
    activeAssignments: [],
    openAttention: [],
    recentReports: [],
    recentBlockers: [],
    recentDecisions: [],
    recentEvents: [],
  },
  agentModes: [{ id: 'standard', name: 'Standard' }, { id: 'creator', name: 'Creator' }],
  agentModeCapabilities: [
    { id: 'standard', name: 'Standard', known: true, compaction: false, toolResultPruner: false, ptc: false, subagents: false },
    { id: 'creator', name: 'Creator', known: true, compaction: false, toolResultPruner: false, ptc: false, subagents: false },
  ],
}

const controller = (): BayAgentControllerV1 => ({
  runtime: {} as never,
  setWorkbenchId: vi.fn(),
  getSnapshot: () => emptySnapshot,
  subscribe: () => () => {},
  createWorkItem: vi.fn(),
  startWorkItem: vi.fn(),
  retryWorkItem: vi.fn(),
  recoverWorkItem: vi.fn(),
  stopWorkItem: vi.fn(),
  resolveAttention: vi.fn(),
  dismissAttention: vi.fn(),
  listAttention: () => [],
})

function renderTasks(snapshot = emptySnapshot, instance = controller()) {
  render(<WorkbenchBayAgentTasks controller={instance} snapshot={snapshot} workspaces={[{ workspaceId: 'workspace-a', title: 'Project A' }]} openWorker={() => {}} />)
  return instance
}

it('shows a non-blocking warning when the selected Worker preset has no compaction', () => {
  renderTasks()
  expect(screen.getByRole('status')).toBeTruthy()
  fireEvent.change(screen.getAllByRole('textbox')[0], { target: { value: 'Long running task' } })
  expect((screen.getAllByRole('button').at(-1) as HTMLButtonElement).disabled).toBe(false)
})

it('updates the warning when the Worker mode changes and keeps the selected mode intact', () => {
  const snapshot = {
    ...emptySnapshot,
    agentModeCapabilities: [
      { id: 'standard', name: 'Standard', known: true, compaction: false, toolResultPruner: false, ptc: false, subagents: false },
      { id: 'creator', name: 'Creator', known: true, compaction: true, toolResultPruner: true, ptc: false, subagents: false },
    ],
  }
  const instance = renderTasks(snapshot)
  expect(screen.getByRole('status')).toBeTruthy()
  fireEvent.change(screen.getAllByRole('combobox')[2], { target: { value: 'creator' } })
  expect(screen.queryByRole('status')).toBeNull()
  fireEvent.change(screen.getAllByRole('textbox')[0], { target: { value: 'Keep selected mode' } })
  fireEvent.submit(screen.getAllByRole('textbox')[0].closest('form')!)
  expect(instance.createWorkItem).toHaveBeenCalledWith(expect.objectContaining({ agentPreset: 'creator' }))
})

it('reports unknown Worker capabilities without blocking task creation', () => {
  const snapshot = {
    ...emptySnapshot,
    agentModeCapabilities: [{ id: 'standard', name: 'Standard', known: false, compaction: false, toolResultPruner: false, ptc: false, subagents: false }],
  }
  const instance = renderTasks(snapshot)
  expect(screen.getByRole('status')).toBeTruthy()
  const createButton = screen.getAllByRole('button').at(-1) as HTMLButtonElement
  expect(createButton.disabled).toBe(true)
  fireEvent.change(screen.getAllByRole('textbox')[0], { target: { value: 'Task with unknown capability' } })
  expect(createButton.disabled).toBe(false)
  expect(instance.createWorkItem).not.toHaveBeenCalled()
})
