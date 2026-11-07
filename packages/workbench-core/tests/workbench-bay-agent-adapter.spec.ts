import { describe, expect, it } from 'vitest'
import {
  WorkbenchBayAgentAdapter,
  buildWorkbenchBayAgentPromptContext,
  captureWorkbenchBayAgentExecutionLease,
  isWorkbenchBayAgentExecutionCurrent,
  renderWorkbenchBayAgentPromptContext,
  workbenchBayAgentExecutionStaleReason,
} from '../src/foundation/workbench-bay-agent-adapter.ts'
import { createAreaContext, createWorkbenchContext } from '../src/foundation/workbench-context.ts'
import type { WorkbenchControlPlaneSnapshotV1 } from '../src/foundation/workbench-control-plane.ts'
import { WorkbenchControlPlane } from '../src/foundation/workbench-control-plane.ts'
import { settingsFixture } from './settings-fixtures.ts'
import type { WorkbenchControlPlaneSettings } from '../src/foundation/workbench-control-plane.ts'

function snapshotFixture(): WorkbenchControlPlaneSnapshotV1 {
  const workbench = createWorkbenchContext()
  workbench.human.goal = 'Ship the next Workbench release'
  workbench.human.constraints = ['Keep imported packages portable']
  workbench.agent.summary = 'Organizing the release plan'
  const current = createAreaContext()
  current.human.objective = 'Define the adapter contract'
  current.human.successCriteria = ['CAS report is committed']
  current.agent.nextActions = ['Connect a Worker']
  const other = createAreaContext()
  other.human.objective = 'Private unrelated work'
  other.agent.summary = 'Do not expose this to the Worker'
  return {
    version: 1,
    workbenchId: 'workbench-a',
    name: 'Workbench A',
    description: '',
    context: workbench,
    areas: [
      { areaId: 'area-current', label: 'Adapter', ownership: 'bay-agent-managed', active: true, archived: false,
        generation: 4, context: current, binding: { sessionId: 'session-a', workspaceId: 'workspace-a' }, modules: [] },
      { areaId: 'area-other', label: 'Other', ownership: 'user-owned', active: false, archived: false,
        generation: 0, context: other, modules: [] },
    ],
  }
}

describe('Workbench Bay Agent adapter', () => {
  it('captures only the current Area and renders the versioned prompt context', () => {
    const context = buildWorkbenchBayAgentPromptContext({
      snapshot: snapshotFixture(),
      areaId: 'area-current',
      capturedAt: 123,
      workItem: {
        workItemId: 'item-1', objective: 'Implement the adapter', status: 'running',
        inputs: ['Context snapshot'], successCriteria: ['Report is guarded by CAS'],
      },
    })
    expect(context.capturedAt).toBe(123)
    expect(context.area?.areaId).toBe('area-current')
    expect(context.area?.generation).toBe(4)
    expect(context.workItem?.workItemId).toBe('item-1')
    expect(JSON.stringify(context)).not.toContain('Private unrelated work')
    const prompt = renderWorkbenchBayAgentPromptContext(context)
    expect(prompt).toContain('Ship the next Workbench release')
    expect(prompt).toContain('Define the adapter contract')
    expect(prompt).toContain('Workbench Context revision: 0')
    expect(prompt).toContain('Area generation: 4')
    expect(prompt).toContain('Work Item ID: item-1')
    expect(prompt).toContain('Status: running')
  })

  it('captures binding generation and detects replacement, session and Context changes', () => {
    const initial = snapshotFixture()
    const lease = captureWorkbenchBayAgentExecutionLease(initial, 'area-current')
    expect(lease).toEqual({
      workbenchId: 'workbench-a', areaId: 'area-current', sessionId: 'session-a',
      areaGeneration: 4, workbenchContextRevision: 0, areaContextRevision: 0,
    })
    expect(isWorkbenchBayAgentExecutionCurrent(lease, initial)).toBe(true)
    expect(workbenchBayAgentExecutionStaleReason(lease, { ...initial, workbenchId: 'replacement' })).toBe('workbench-replaced')
    expect(workbenchBayAgentExecutionStaleReason(lease, { ...initial, areas: initial.areas.filter(area => area.areaId !== 'area-current') })).toBe('area-missing')
    expect(workbenchBayAgentExecutionStaleReason(lease, {
      ...initial, areas: initial.areas.map(area => area.areaId === 'area-current' ? { ...area, generation: 5 } : area),
    })).toBe('area-generation-changed')
    expect(workbenchBayAgentExecutionStaleReason(lease, {
      ...initial, areas: initial.areas.map(area => area.areaId === 'area-current' ? { ...area, binding: { sessionId: 'session-b' } } : area),
    })).toBe('session-changed')
    const advanced = structuredClone(initial)
    advanced.context.revision = 1
    expect(workbenchBayAgentExecutionStaleReason(lease, advanced)).toBe('context-advanced')
  })

  it('writes an Area agent report through Control Plane CAS only while the lease is current', async () => {
    const settingsValue = settingsFixture()
    let revision = 1
    let value = structuredClone(settingsValue)
    const settings: WorkbenchControlPlaneSettings = {
      getSnapshot: () => ({ status: 'ready', value, revision, writable: true }),
      patch: async operation => {
        if (operation.expectedRevision !== revision) return { status: 'conflict' as const, actualRevision: revision }
        value = { ...value, workbenches: { ...value.workbenches, a: operation.value as typeof value.workbenches.a } }
        revision += 1
        return { status: 'committed' as const, revision }
      },
    }
    const plane = new WorkbenchControlPlane({ settings })
    const adapter = new WorkbenchBayAgentAdapter(plane, () => 456)
    const lease = adapter.captureExecutionLease({ workbenchId: 'a', areaId: 'area-a' })
    const committed = await adapter.applyAreaAgentReport({ lease, patch: { summary: 'Report committed' } })
    expect(committed).toMatchObject({ status: 'committed', value: { revision: 1 } })
    expect(plane.getArea('area-a', 'a').context.agent.summary).toBe('Report committed')

    const stale = await adapter.applyAreaAgentReport({ lease, patch: { summary: 'Must not overwrite' } })
    expect(stale).toEqual({ status: 'stale', reason: 'context-advanced' })
    expect(plane.getArea('area-a', 'a').context.agent.summary).toBe('Report committed')
  })
})
