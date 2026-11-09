import { describe, expect, it, vi } from 'vitest'
import { buildWorkbenchAiPrompt, createRemoteWorkbenchAiDraftGenerator, parseWorkbenchAiDraftInput } from '../src/foundation/workbench-ai.ts'
import type { WorkbenchControlPlaneSnapshotV1 } from '../src/foundation/workbench-control-plane.ts'

const snapshot: WorkbenchControlPlaneSnapshotV1 = {
  version: 1,
  workbenchId: 'wb-ai',
  name: 'AI Workbench',
  description: 'real draft generation',
  context: { schemaVersion: 1, revision: 2, human: { goal: 'deliver a verifiable workbench', constraints: ['no credentials'], preferences: [], allowedActions: [], approvalRequired: [], environment: ['DSH'] }, agent: { summary: '', currentFocus: '', nextActions: [], blockers: [], proposals: [] } },
  areas: [{ areaId: 'area-research', label: 'Research', ownership: 'user-owned', active: true, archived: false, generation: 0, context: { schemaVersion: 1, revision: 1, human: { objective: 'organize sources', constraints: [], inputs: ['source library'], successCriteria: ['form a conclusion'] }, agent: { summary: '', completed: [], nextActions: [], blockers: [], proposals: [] } }, modules: [{ moduleInstanceId: 'page-1', editorId: 'workbench.conversation', scope: 'session', title: 'Source chat', available: true, binding: { sessionId: 'session-area' } }] }],
}

describe('Workbench AI draft prompt', () => {
  it('includes the current description and all pages in all Workbench Areas', () => {
    const other = { ...snapshot.areas[0]!, areaId: 'other', label: 'Design', modules: [{ moduleInstanceId: 'page-2', editorId: 'example.notes', scope: 'root' as const, title: 'Design notes', available: true }] }
    const prompt = buildWorkbenchAiPrompt({ ...snapshot, areas: [...snapshot.areas, other] }, { workbenchId: snapshot.workbenchId, scope: 'workbench', currentValue: 'user goal supplement' })
    expect(prompt).toContain('AI Workbench')
    expect(prompt).toContain('real draft generation')
    expect(prompt).toContain('Research')
    expect(prompt).toContain('Source chat')
    expect(prompt).toContain('Design notes')
    expect(prompt).toContain('workbench.conversation')
    expect(prompt).toContain('user goal supplement')
    expect(prompt).not.toContain('session-area')
    expect(prompt).not.toContain('deliver a verifiable workbench')
  })

  it('scopes an Area draft to the selected Area instead of sending other Areas', () => {
    const secondArea = structuredClone(snapshot.areas[0]!)
    secondArea.areaId = 'area-other'; secondArea.label = 'Other'; secondArea.context.human.objective = 'other objective'
    const scopedSnapshot = { ...snapshot, areas: [...snapshot.areas, secondArea] }
    const prompt = buildWorkbenchAiPrompt(scopedSnapshot, { workbenchId: snapshot.workbenchId, scope: 'area', areaId: 'area-research', currentValue: 'area supplement' })
    expect(prompt).toContain('area supplement')
    expect(prompt).toContain('Source chat')
    expect(prompt).not.toContain('other objective')
    expect(prompt).not.toContain('Other')
    expect(prompt).not.toContain('real draft generation')
    expect(prompt).not.toContain('AI Workbench')
  })

  it('uses only unsaved name, description and current draft during creation', () => {
    const prompt = buildWorkbenchAiPrompt(snapshot, { scope: 'create', name: '新名称', description: '新简介', currentValue: '已写的目标' })
    for (const fact of ['新名称', '新简介', '已写的目标']) expect(prompt).toContain(fact)
    for (const foreign of ['AI Workbench', 'Research', 'Source chat', 'real draft generation']) expect(prompt).not.toContain(foreign)
  })

  it('validates scope, identity and model selection before making a request', () => {
    expect(() => parseWorkbenchAiDraftInput({ scope: 'area', workbenchId: 'wb-ai', currentValue: '' })).toThrow()
    expect(() => parseWorkbenchAiDraftInput({ scope: 'workbench', workbenchId: 'wb-ai', areaId: 'area-research', currentValue: '' })).toThrow()
    expect(() => parseWorkbenchAiDraftInput({ scope: 'create', name: '', description: '' })).toThrow()
    expect(() => parseWorkbenchAiDraftInput({ scope: 'create', name: 'new', description: '', workbenchId: 'wb-ai' })).toThrow()
    expect(() => parseWorkbenchAiDraftInput({ scope: 'workbench', workbenchId: 'wb-ai', selection: { provider: 3, model: 'm' } })).toThrow()
    expect(() => buildWorkbenchAiPrompt(snapshot, { workbenchId: 'wb-ai', scope: 'area', areaId: 'missing', currentValue: '' })).toThrow()
  })

  it('handles empty Areas without inventing pages and excludes archived Areas', () => {
    const empty = { ...snapshot, areas: [{ ...snapshot.areas[0]!, modules: [] }] }
    expect(buildWorkbenchAiPrompt(empty, { scope: 'area', workbenchId: 'wb-ai', areaId: 'area-research', currentValue: '' })).toContain('"pages": []')
    const archived = { ...snapshot, areas: [{ ...snapshot.areas[0]!, archived: true }] }
    expect(buildWorkbenchAiPrompt(archived, { scope: 'workbench', workbenchId: 'wb-ai', currentValue: '' })).not.toContain('Source chat')
    expect(() => buildWorkbenchAiPrompt(archived, { scope: 'area', workbenchId: 'wb-ai', areaId: 'area-research', currentValue: '' })).toThrow()
  })
})

describe('Remote Workbench AI draft client', () => {
  it('sends creation form values without looking up the active Workbench model', async () => {
    const fetcher = vi.fn(async (_url: string, init: RequestInit) => {
      expect(JSON.parse(String(init.body))).toEqual({ scope: 'create', name: '新工作台', description: '新简介', currentValue: '' })
      return Response.json({ draft: '# New' })
    })
    const getSelection = vi.fn()
    await createRemoteWorkbenchAiDraftGenerator({ route: '/draft', fetcher, getSelection }).generateContextDraft({ scope: 'create', name: '新工作台', description: '新简介', currentValue: '' })
    expect(getSelection).not.toHaveBeenCalled()
  })
  it('posts one-shot input to the dedicated route and returns the draft', async () => {
    const fetcher = vi.fn(async (_url: string, init: RequestInit) => {
      expect(JSON.parse(String(init.body))).toEqual({ workbenchId: 'wb-ai', scope: 'area', areaId: 'area-research', currentValue: 'seed', selection: { provider: 'p', model: 'm' } })
      return new Response(JSON.stringify({ draft: '# Draft' }), { status: 200 })
    })
    const result = await createRemoteWorkbenchAiDraftGenerator({ route: '/api/workbench/bay-agent/draft', fetcher, getSelection: () => ({ provider: 'p', model: 'm' }) }).generateContextDraft({ workbenchId: 'wb-ai', scope: 'area', areaId: 'area-research', currentValue: 'seed' })
    expect(result).toBe('# Draft')
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('surfaces an independent service error without touching any Session API', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ error: 'model unavailable' }), { status: 400 }))
    await expect(createRemoteWorkbenchAiDraftGenerator({ route: '/api/workbench/bay-agent/draft', fetcher }).generateContextDraft({ workbenchId: 'wb-ai', scope: 'workbench', currentValue: '' })).rejects.toThrow('model unavailable')
  })
})
