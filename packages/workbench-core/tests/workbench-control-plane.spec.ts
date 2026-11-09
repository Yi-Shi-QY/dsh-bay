import { describe, expect, it, vi } from 'vitest'
import { WorkbenchControlPlane, type WorkbenchControlPlaneSettings } from '../src/foundation/workbench-control-plane.ts'
import { areasOf } from '../src/foundation/document-v3.ts'
import { settingsFixture } from './settings-fixtures.ts'
import { decodeWorkbenchSettingsV4, type WorkbenchSettingsV4 } from '../src/foundation/persistence.ts'

function settingsHarness(initial = settingsFixture()) {
  let value = structuredClone(initial)
  let revision = 7
  let rejectNext = false
  const settings: WorkbenchControlPlaneSettings = {
    getSnapshot: () => ({ status: 'ready', value, revision, writable: true }),
    patch: async operation => {
      if (rejectNext) {
        rejectNext = false
        revision += 1
        return { status: 'conflict' as const, actualRevision: revision }
      }
      if (operation.expectedRevision !== revision) return { status: 'conflict' as const, actualRevision: revision }
      const workbenchId = operation.path[1]
      if (operation.path.length !== 2 || operation.path[0] !== 'workbenches' || workbenchId === undefined) return { status: 'unavailable' as const }
      value = {
        ...value,
        workbenches: { ...value.workbenches, [workbenchId]: operation.value as WorkbenchSettingsV4['workbenches'][string] },
      }
      revision += 1
      return { status: 'committed' as const, revision }
    },
  }
  return { settings, read: () => value, rejectNext: () => { rejectNext = true } }
}

describe('Workbench Control Plane', () => {
  it('appends an independent Worker without invalidating or rebinding the existing Area', async () => {
    const harness = settingsHarness(), plane = new WorkbenchControlPlane({ settings: harness.settings, createSession: async () => ({ target: { sessionId: 'new-worker', workspaceId: 'project' } }) })
    const area = plane.inspect('a').areas[0]!, before = area.modules
    const result = await plane.createSession({ workbenchId: 'a', areaId: area.areaId, requestId: 'worker-append', append: true })
    expect(result.status).toBe('committed')
    const decoded = decodeWorkbenchSettingsV4(harness.read())!
    expect(decoded.workbenches.a).toBeDefined()
    const after = areasOf(decoded.workbenches.a!.document.root)[0]!
    expect(after.moduleHistory.slice(0, before.length).map(row => row.binding)).toEqual(before.map(row => row.binding))
    expect(after.moduleHistory.at(-1)?.binding?.sessionId).toBe('new-worker')
    expect(after.areaBinding).toBeUndefined()
  })
  it('creates a managed Area through the Settings CAS seam and exposes it in the read model', async () => {
    const harness = settingsHarness()
    const plane = new WorkbenchControlPlane({
      settings: harness.settings,
      now: () => 100,
      createId: kind => kind === 'area' ? 'area-super' : 'split-super',
    })

    const result = await plane.createArea({ workbenchId: 'a', label: '重构区', objective: '重构 Control Plane', requestId: 'request-1' })
    expect(result).toMatchObject({ status: 'committed', value: { areaId: 'area-super', ownership: 'bay-agent-managed' } })
    const record = harness.read().workbenches.a!
    expect(record.areaMetadata?.['area-super']).toMatchObject({ label: '重构区', ownership: 'bay-agent-managed' })
    expect(record.areaContexts?.['area-super']).toMatchObject({ human: { objective: '重构 Control Plane' } })
    expect(areasOf(record.document.root).map(area => area.areaId)).toContain('area-super')
    expect(plane.inspect('a').areas.find(area => area.areaId === 'area-super')).toMatchObject({
      label: '重构区', ownership: 'bay-agent-managed', active: true,
    })
    const repeated = await plane.createArea({ workbenchId: 'a', label: '其他名字', requestId: 'request-1' })
    expect(repeated).toEqual(result)
  })

  it('uses Bay Agent ownership by default while accepting the legacy actor alias', async () => {
    const harness = settingsHarness()
    const plane = new WorkbenchControlPlane({ settings: harness.settings, createId: kind => `${kind}-legacy` })
    const result = await plane.createArea({ workbenchId: 'a', actor: 'superagent', requestId: 'legacy-actor' })
    expect(result).toMatchObject({ status: 'committed', value: { ownership: 'bay-agent-managed' } })
  })

  it('enforces Context ownership and compare-and-swap before writing Settings', async () => {
    const harness = settingsHarness()
    const plane = new WorkbenchControlPlane({ settings: harness.settings })
    const rejected = await plane.patchContext({
      workbenchId: 'a', scope: 'workbench', writer: 'superagent', section: 'human', expectedRevision: 0,
      patch: { goal: '不可覆盖' },
    })
    expect(rejected).toEqual({ status: 'rejected', reason: 'ownership-not-permitted' })

    const committed = await plane.patchContext({
      workbenchId: 'a', scope: 'workbench', writer: 'superagent', section: 'agent', expectedRevision: 0,
      patch: { summary: '已建立 Control Plane' },
    })
    expect(committed).toMatchObject({ status: 'committed', value: { revision: 1 } })
    expect(harness.read().workbenches.a?.context?.agent.summary).toBe('已建立 Control Plane')

    const stale = await plane.patchContext({
      workbenchId: 'a', scope: 'workbench', writer: 'superagent', section: 'agent', expectedRevision: 0,
      patch: { summary: '旧写入' },
    })
    expect(stale).toMatchObject({ status: 'conflict', source: 'context', value: { revision: 1 } })
  })

  it('creates and binds a Session, then ensures only registered editors', async () => {
    const harness = settingsHarness()
    const plane = new WorkbenchControlPlane({
      settings: harness.settings,
      createId: kind => `${kind}-1`,
      createSession: vi.fn(async input => ({ target: { ...(input.workspaceId === undefined ? {} : { workspaceId: input.workspaceId }), sessionId: 'session-1' } })),
      editors: { getSnapshot: () => [
        { id: 'workbench.workspace-files', scope: 'session', label: 'Files' },
        { id: 'workbench.plan', scope: 'root', label: 'Plan' },
      ] },
    })
    const area = await plane.createArea({ workbenchId: 'a', requestId: 'area-1' })
    if (area.status !== 'committed') throw new Error('Area creation failed')
    const session = await plane.createSession({ workbenchId: 'a', areaId: area.value.areaId, workspaceId: 'workspace-1', requestId: 'session-1' })
    expect(session).toMatchObject({ status: 'committed', value: { target: { sessionId: 'session-1', workspaceId: 'workspace-1' } } })
    const editor = await plane.ensureEditor({ workbenchId: 'a', areaId: area.value.areaId, editorId: 'workbench.workspace-files' })
    expect(editor).toMatchObject({ status: 'committed', value: { moduleInstanceId: 'module-1' } })
    const unavailable = await plane.ensureEditor({ workbenchId: 'a', areaId: area.value.areaId, editorId: 'workbench.unknown' })
    expect(unavailable).toEqual({ status: 'rejected', reason: 'editor-not-found' })
    const read = plane.getArea(area.value.areaId, 'a')
    expect(read.binding).toBeUndefined()
    expect(read.modules[0]?.binding).toEqual({ workspaceId: 'workspace-1', sessionId: 'session-1' })
    expect(read.modules.map(module => module.editorId)).toEqual(['workbench.conversation', 'workbench.workspace-files'])
  })

  it('does not turn a Settings conflict into a local success', async () => {
    const harness = settingsHarness()
    const plane = new WorkbenchControlPlane({ settings: harness.settings })
    harness.rejectNext()
    const result = await plane.patchContext({
      workbenchId: 'a', scope: 'area', areaId: 'area-a', writer: 'human', section: 'human', expectedRevision: 0,
      patch: { objective: '冲突写入' },
    })
    expect(result).toMatchObject({ status: 'conflict', source: 'settings', currentSettingsRevision: 8 })
    expect(harness.read().workbenches.a?.areaContexts?.['area-a']).toBeUndefined()
  })
})
