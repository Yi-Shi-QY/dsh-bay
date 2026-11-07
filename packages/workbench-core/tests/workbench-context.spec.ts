import { describe, expect, it } from 'vitest'
import {
  areaContextOf,
  createAreaContext,
  createWorkbenchContext,
  decodeAreaContexts,
  decodeAreaContext,
  decodeWorkbenchContext,
  patchAreaContext,
  patchWorkbenchContext,
  renderAreaContextMarkdown,
  renderWorkbenchContextMarkdown,
} from '../src/foundation/workbench-context.ts'
import { decodeWorkbenchSettingsV4 } from '../src/foundation/persistence.ts'
import { documentFixture, settingsFixture } from './settings-fixtures.ts'

describe('Workbench and Area Context', () => {
  it('creates bounded empty contexts and renders their Markdown projections', () => {
    const workbench = createWorkbenchContext()
    const area = createAreaContext()
    expect(workbench.revision).toBe(0)
    expect(area.revision).toBe(0)
    expect(renderWorkbenchContextMarkdown(workbench)).toContain('# 工作台整体背景说明')
    expect(renderAreaContextMarkdown(area)).toContain('# 区域说明')
  })

  it('lets Super Agent update only its own section with compare-and-swap', () => {
    const source = createWorkbenchContext()
    const committed = patchWorkbenchContext(source, {
      writer: 'superagent', section: 'agent', expectedRevision: 0,
      patch: { summary: '正在整理工作台', nextActions: ['读取 Area 状态'] },
    })
    expect(committed.status).toBe('committed')
    if (committed.status !== 'committed') return
    expect(committed.context.revision).toBe(1)
    expect(committed.context.agent.summary).toBe('正在整理工作台')
    expect(committed.context.human.goal).toBe('')

    const conflict = patchWorkbenchContext(committed.context, {
      writer: 'superagent', section: 'agent', expectedRevision: 0,
      patch: { summary: '旧写入' },
    })
    expect(conflict).toEqual({ status: 'conflict', context: committed.context })
  })

  it('rejects a Super Agent write to human context', () => {
    const result = patchWorkbenchContext(createWorkbenchContext(), {
      writer: 'superagent', section: 'human', expectedRevision: 0,
      patch: { goal: '未经确认的目标' },
    })
    expect(result).toEqual({ status: 'rejected', reason: 'agent-cannot-write-human-context' })
  })

  it('allows a human to set the human section and rejects malformed persisted data', () => {
    const committed = patchAreaContext(createAreaContext(), {
      writer: 'human', section: 'human', expectedRevision: 0,
      patch: { objective: '重构工作台控制平面', successCriteria: ['可恢复', '可审计'] },
    })
    expect(committed.status).toBe('committed')
    expect(decodeAreaContext(committed.status === 'committed' ? committed.context : null)).toEqual(committed.status === 'committed' ? committed.context : undefined)
    expect(decodeWorkbenchContext({ schemaVersion: 1, revision: 0, human: {}, agent: {} })).toBeUndefined()
  })

  it('keeps Area Context keys aligned with the persisted Area ids', () => {
    const area = createAreaContext()
    expect(decodeAreaContexts({ 'area-a': area }, ['area-a'])).toEqual({ 'area-a': area })
    expect(decodeAreaContexts({ 'area-missing': area }, ['area-a'])).toBeUndefined()
  })

  it('round-trips Context through Workbench Settings and keeps older records valid', () => {
    const value = settingsFixture()
    const context = createWorkbenchContext()
    const areaContext = createAreaContext()
    const raw = {
      ...value,
      workbenches: {
        a: { ...value.workbenches.a!, context, areaContexts: { 'area-a': areaContext } },
        b: value.workbenches.b!,
      },
    }
    expect(decodeWorkbenchSettingsV4(raw)?.workbenches.a?.context).toEqual(context)
    expect(decodeWorkbenchSettingsV4(raw)?.workbenches.a?.areaContexts).toEqual({ 'area-a': areaContext })
    expect(decodeWorkbenchSettingsV4(value)?.workbenches.a?.context).toBeUndefined()
  })

  it('retains a malformed Context as an invalid Workbench instead of activating it', () => {
    const value = settingsFixture()
    const raw = {
      ...value,
      workbenches: {
        ...value.workbenches,
        a: { ...value.workbenches.a!, context: { schemaVersion: 1, revision: -1 } },
      },
    }
    const decoded = decodeWorkbenchSettingsV4(raw)
    expect(decoded?.workbenches.a).toBeUndefined()
    expect(decoded?.invalidWorkbenches.a?.rawRecord).toEqual(raw.workbenches.a)
  })

  it('provides a default Area Context for legacy Areas', () => {
    expect(areaContextOf(undefined)).toEqual(createAreaContext())
    expect(areaContextOf(createAreaContext())).toEqual(createAreaContext())
    expect(documentFixture().activeAreaId).toBe('area-a')
  })
})
