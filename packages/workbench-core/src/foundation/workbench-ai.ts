import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { WorkbenchControlPlaneSnapshotV1 } from './workbench-control-plane.ts'
import type { WorkbenchAiSelectionV1 } from './persistence.ts'
import { backgroundAiPreferencesOf, type BackgroundAiPreferencesV1 } from './background-ai-preferences.ts'

interface WorkbenchAiDraftBaseV1 {
  currentValue: string
  selection?: WorkbenchAiSelectionV1
}

export type WorkbenchAiDraftInputV1 = WorkbenchAiDraftBaseV1 & (
  | { scope: 'create'; name: string; description: string; workbenchId?: never; areaId?: never }
  | { scope: 'workbench'; workbenchId: string; areaId?: never }
  | { scope: 'area'; workbenchId: string; areaId: string }
)
export type WorkbenchAiDraftScopeV1 = WorkbenchAiDraftInputV1['scope']
export type WorkbenchCreationDraftInputV1 = Extract<WorkbenchAiDraftInputV1, { scope: 'create' }>

export interface WorkbenchAiDraftGeneratorV1 {
  generateContextDraft(input: WorkbenchAiDraftInputV1): Promise<string>
}

/** Validate the HTTP boundary before looking up a Workbench or contacting a model. */
export function parseWorkbenchAiDraftInput(value: unknown): WorkbenchAiDraftInputV1 {
  const row = record(value)
  const currentValue = text(row.currentValue ?? '', '背景草稿', 20_000)
  let selection: WorkbenchAiSelectionV1 | undefined
  if (row.selection !== undefined) {
    const model = record(row.selection)
    selection = {
      provider: text(model.provider, '模型提供方', 512, true),
      model: text(model.model, '模型名称', 512, true),
      ...(model.reasoningEffort === undefined ? {} : { reasoningEffort: text(model.reasoningEffort, '推理强度', 128, true) }),
    }
  }
  const base = { currentValue, ...(selection === undefined ? {} : { selection }) }
  if (row.scope === 'create') {
    if (row.workbenchId !== undefined || row.areaId !== undefined) throw new Error('新建工作台草稿只能使用当前填写的名称和简介')
    return { ...base, scope: 'create', name: text(row.name, '工作台名称', 160, true), description: text(row.description, '工作台简介', 4_000) }
  }
  if (row.scope !== 'workbench' && row.scope !== 'area') throw new Error('无效的背景生成范围')
  const workbenchId = text(row.workbenchId, '工作台标识', 512, true)
  if (row.scope === 'workbench') {
    if (row.areaId !== undefined) throw new Error('工作台背景草稿不能携带区域范围')
    return { ...base, scope: 'workbench', workbenchId }
  }
  return { ...base, scope: 'area', workbenchId, areaId: text(row.areaId, '区域标识', 512, true) }
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('无效的背景生成请求')
  return value as Record<string, unknown>
}

function text(value: unknown, label: string, max: number, required = false): string {
  if (typeof value !== 'string' || value.length > max || required && !value.trim()) throw new Error(`${label}无效`)
  return value
}

/**
 * Build the one-shot prompt shared by the browser entry and the Host draft
 * service. This function only formats facts; it never owns a Session or an
 * agent loop.
 */
export function buildWorkbenchAiPrompt(
  snapshot: WorkbenchControlPlaneSnapshotV1 | undefined,
  input: WorkbenchAiDraftInputV1,
  preferences?: BackgroundAiPreferencesV1,
): string {
  const request = parseWorkbenchAiDraftInput(input)
  const configured = backgroundAiPreferencesOf(preferences)
  let facts: unknown
  if (request.scope === 'create') {
    facts = { name: request.name, description: request.description }
  } else {
    if (!snapshot || snapshot.workbenchId !== request.workbenchId) throw new Error('工作台不存在，无法生成背景草稿')
    const requestedArea = request.scope === 'area' ? snapshot.areas.find(area => area.areaId === request.areaId) : undefined
    const projectId = requestedArea?.project?.projectId
    const areas = request.scope === 'area'
      ? snapshot.areas.filter(area => (projectId ? area.project?.projectId === projectId : area.areaId === request.areaId) && !area.archived)
      : snapshot.areas.filter(area => !area.archived)
    if (request.scope === 'area' && !areas.length) throw new Error('区域不存在或已关闭，无法定位项目背景')
    const areaFacts = areas.map(area => ({
      label: area.label,
      pages: area.modules.map(module => ({ title: module.title, editorId: module.editorId, scope: module.scope })),
    }))
    if (request.scope === 'workbench') {
      facts = { name: snapshot.name, description: snapshot.description, projects: snapshot.projects, areas: areaFacts }
    } else {
      facts = { project: projectId ? snapshot.projects?.find(project => project.projectId === projectId) : undefined, areas: areaFacts, area: areaFacts[0] }
    }
  }
  return [
    configured.prompts[request.scope],
    `用户当前草稿：\n${request.currentValue.trim() || '（空）'}`,
    `本次生成依据：\n${safeJson(facts)}`,
  ].join('\n\n')
}

function safeJson(value: unknown): string {
  try { return JSON.stringify(value, null, 2) ?? 'null' } catch { return String(value) }
}

function textOfContent(content: readonly ContentBlock[] | undefined): string {
  return (content ?? [])
    .filter((block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text')
    .map(block => block.text)
    .join('')
}

/**
 * Browser-side client for the Host-owned one-shot draft service. The request
 * carries no Session id and therefore cannot append to Bay Agent history.
 */
export function createRemoteWorkbenchAiDraftGenerator(
  options: {
    fetcher?: typeof fetch
    getSelection?: (workbenchId: string) => WorkbenchAiSelectionV1 | undefined
    route: string
  },
): WorkbenchAiDraftGeneratorV1 {
  const fetcher = options.fetcher ?? fetch
  return {
    async generateContextDraft(input) {
      const request = parseWorkbenchAiDraftInput(input)
      const selection = request.selection ?? (request.scope === 'create' ? undefined : options.getSelection?.(request.workbenchId))
      const response = await fetcher(options.route, {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...request,
          ...(selection === undefined ? {} : { selection }),
        }),
      })
      const result = await response.json() as { draft?: unknown; error?: unknown }
      if (!response.ok || typeof result.draft !== 'string') {
        throw new Error(typeof result.error === 'string' ? result.error : '背景草稿服务暂时不可用')
      }
      return result.draft
    },
  }
}

export { textOfContent }
