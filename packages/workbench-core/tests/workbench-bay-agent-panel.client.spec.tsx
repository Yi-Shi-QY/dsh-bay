// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { WorkbenchBayAgentPanel } from '../src/foundation/WorkbenchBayAgentPanel.tsx'
import type { BayAgentControllerV1 } from '../src/foundation/workbench-bay-agent-work.ts'

afterEach(cleanup)

it('mounts without changing the external store snapshot during a normal frame render', () => {
  const snapshot = { workbenchId: 'wb', areas: [{ areaId: 'area-a', label: 'Area A' }], workItems: [], assignments: [], attention: [] }
  const controller: BayAgentControllerV1 = {
    runtime: {} as never, setWorkbenchId: vi.fn(), getSnapshot: () => snapshot, subscribe: () => () => {},
    createWorkItem: vi.fn(), startWorkItem: vi.fn(), retryWorkItem: vi.fn(), recoverWorkItem: vi.fn(), stopWorkItem: vi.fn(),
    resolveAttention: vi.fn(), dismissAttention: vi.fn(), listAttention: () => [],
  }
  const view = render(<WorkbenchBayAgentPanel controller={controller} workbenchId="wb" />)
  expect(view.container.querySelector('[data-bay-agent-panel]')).not.toBeNull()
})

it('mounts with controller class methods whose this context is required', () => {
  const snapshot = { workbenchId: 'wb', areas: [{ areaId: 'area-a', label: 'Area A' }], workItems: [], assignments: [], attention: [] }
  class ControllerWithMethods {
    private readonly listeners = new Set<() => void>()
    getSnapshot() { return snapshot }
    subscribe(listener: () => void) { this.listeners.add(listener); return () => this.listeners.delete(listener) }
    setWorkbenchId() {}
    async createWorkItem() { throw new Error('unused') }
    async startWorkItem() { throw new Error('unused') }
    async retryWorkItem() {}
    async recoverWorkItem() {}
    async stopWorkItem() {}
    async resolveAttention() {}
    async dismissAttention() {}
    listAttention() { return [] }
  }
  const controller = new ControllerWithMethods() as unknown as BayAgentControllerV1
  const view = render(<WorkbenchBayAgentPanel controller={controller} workbenchId="wb" />)
  expect(view.container.querySelector('[data-bay-agent-panel]')).not.toBeNull()
})

it('requires an explicit Worker mode for manual quick dispatch', () => {
  const snapshot = { workbenchId: 'wb', areas: [{ areaId: 'area-a', label: 'Area A' }], workItems: [], assignments: [], attention: [], agentModes: [
    { id: 'creator', name: 'Creator', description: 'Create or repair DSH extensions.' },
  ] }
  const createWorkItem = vi.fn(async () => ({}))
  const controller: BayAgentControllerV1 = {
    runtime: {} as never, setWorkbenchId: vi.fn(), getSnapshot: () => snapshot, subscribe: () => () => {},
    createWorkItem, startWorkItem: vi.fn(), retryWorkItem: vi.fn(), recoverWorkItem: vi.fn(), stopWorkItem: vi.fn(),
    resolveAttention: vi.fn(), dismissAttention: vi.fn(), listAttention: () => [],
  }
  const view = render(<WorkbenchBayAgentPanel controller={controller} workbenchId="wb" />)
  const submit = view.getByRole('button', { name: '新建并启动工作项' })
  expect(submit.hasAttribute('disabled')).toBe(true)
  fireEvent.change(view.getByLabelText('工作区域'), { target: { value: 'area-a' } })
  fireEvent.change(view.getByLabelText('Worker 模式'), { target: { value: 'creator' } })
  fireEvent.change(view.getByLabelText('工作项目标'), { target: { value: 'Repair extension' } })
  expect(submit.hasAttribute('disabled')).toBe(false)
  fireEvent.click(submit)
  expect(createWorkItem).toHaveBeenCalledWith({ areaId: 'area-a', objective: 'Repair extension', agentPreset: 'creator', start: true })
})
