import { describe, expect, it, vi } from 'vitest'
import { buildWorkbenchAiPrompt, createRemoteWorkbenchAiDraftGenerator } from '../src/foundation/workbench-ai.ts'
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
  it('includes Workbench, Area, page, extension, and user facts without a Session', () => {
    const prompt = buildWorkbenchAiPrompt(snapshot, [{ id: 'workbench.conversation', scope: 'session', label: 'Conversation' }], { extensions: [{ packageName: 'example.plugin' }] }, { scope: 'workbench', currentValue: 'user goal supplement' })
    expect(prompt).toContain('deliver a verifiable workbench')
    expect(prompt).toContain('organize sources')
    expect(prompt).toContain('workbench.conversation')
    expect(prompt).toContain('example.plugin')
    expect(prompt).toContain('user goal supplement')
  })

  it('scopes an Area draft to the selected Area instead of sending other Areas', () => {
    const secondArea = structuredClone(snapshot.areas[0]!)
    secondArea.areaId = 'area-other'; secondArea.label = 'Other'; secondArea.context.human.objective = 'other objective'
    const scopedSnapshot = { ...snapshot, areas: [...snapshot.areas, secondArea] }
    const prompt = buildWorkbenchAiPrompt(scopedSnapshot, [], undefined, { scope: 'area', areaId: 'area-research', currentValue: 'area supplement' })
    expect(prompt).toContain('area supplement')
    expect(prompt).toContain('organize sources')
    expect(prompt).not.toContain('other objective')
    expect(prompt).toContain('area-only')
  })

  it('rejects invalid scope and area identity before making a request', () => {
    expect(() => buildWorkbenchAiPrompt(snapshot, [], undefined, { scope: 'area', currentValue: '' })).toThrow()
    expect(() => buildWorkbenchAiPrompt(snapshot, [], undefined, { scope: 'workbench', areaId: 'area-research', currentValue: '' })).toThrow()
    expect(() => buildWorkbenchAiPrompt(snapshot, [], undefined, { scope: 'area', areaId: 'missing', currentValue: '' })).toThrow()
  })
})

describe('Remote Workbench AI draft client', () => {
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
