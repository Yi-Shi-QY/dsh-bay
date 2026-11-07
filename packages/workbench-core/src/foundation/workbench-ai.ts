import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { WorkbenchControlPlaneSnapshotV1 } from './workbench-control-plane.ts'
import type { WorkbenchAiSelectionV1 } from './persistence.ts'

export type WorkbenchAiDraftScopeV1 = 'workbench' | 'area'

export interface WorkbenchAiDraftInputV1 {
  workbenchId: string
  scope: WorkbenchAiDraftScopeV1
  areaId?: string
  currentValue: string
  selection?: WorkbenchAiSelectionV1
}

export interface WorkbenchAiDraftGeneratorV1 {
  generateContextDraft(input: WorkbenchAiDraftInputV1): Promise<string>
}

/**
 * Build the one-shot prompt shared by the browser entry and the Host draft
 * service. This function only formats facts; it never owns a Session or an
 * agent loop.
 */
export function buildWorkbenchAiPrompt(
  snapshot: WorkbenchControlPlaneSnapshotV1,
  editors: readonly unknown[],
  extensions: unknown,
  input: Pick<WorkbenchAiDraftInputV1, 'scope' | 'areaId' | 'currentValue'>,
): string {
  if (input.scope === 'area' && input.areaId === undefined) throw new Error('区域范围缺少 areaId，无法生成区域背景草稿')
  if (input.scope === 'workbench' && input.areaId !== undefined) throw new Error('工作台背景草稿不能携带区域范围')
  const area = input.scope === 'area' ? snapshot.areas.find(row => row.areaId === input.areaId) : undefined
  if (input.scope === 'area' && area === undefined) throw new Error('区域不存在，无法生成区域背景草稿')
  const areaFacts = (area === undefined ? snapshot.areas : [area]).map(row => ({
    areaId: row.areaId,
    label: row.label,
    ownership: row.ownership,
    context: row.context,
    modules: row.modules.map(module => ({
      moduleInstanceId: module.moduleInstanceId,
      editorId: module.editorId,
      scope: module.scope,
      title: module.title,
      available: module.available,
      binding: module.binding,
    })),
  }))
  return [
    '你是 DSH Bay 的背景说明生成器，负责生成可直接编辑的 Markdown 背景草稿。',
    input.scope === 'workbench'
      ? '当前生成范围是整个工作台。请严格依据下面提供的真实工作台、区域、容器内页和扩展信息，不得虚构不存在的区域、内页、插件、能力或约束。'
      : '当前生成范围只有下面标记的一个区域。只输出这个区域的背景说明；不要输出工作台整体背景，不要输出其他区域，不要把工作台目标改写成区域目标。严格依据当前区域和必要的工作台名称信息，不得虚构不存在的内页、插件、能力或约束。',
    input.scope === 'workbench'
      ? '输出工作台背景：全局目标、约束、协作规则、成功标准，以及 Bay Agent 应如何组织区域和会话。'
      : '输出区域背景：区域职责、输入、边界、协作关系、产出和成功标准。',
    '只输出 Markdown 正文，不要解释生成过程，不要包裹代码围栏。',
    `用户当前输入：\n${input.currentValue.trim() || '（空）'}`,
    `工作台事实：\n${safeJson(input.scope === 'workbench'
      ? { workbenchId: snapshot.workbenchId, name: snapshot.name, description: snapshot.description, context: snapshot.context }
      : { workbenchId: snapshot.workbenchId, name: snapshot.name, description: snapshot.description, generationScope: 'area-only', targetAreaId: input.areaId })}`,
    `区域与内页事实：\n${safeJson(areaFacts)}`,
    `当前可用内页声明：\n${safeJson(editors)}`,
    `当前扩展插件信息：\n${safeJson(extensions)}`,
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
      const selection = input.selection ?? options.getSelection?.(input.workbenchId)
      const response = await fetcher(options.route, {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          workbenchId: input.workbenchId,
          scope: input.scope,
          ...(input.areaId === undefined ? {} : { areaId: input.areaId }),
          currentValue: input.currentValue,
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
