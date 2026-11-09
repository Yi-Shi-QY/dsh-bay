export const WORKBENCH_ACCESS_SERVICE = 'workbenchAccessHost'
export const WORKBENCH_ACCESS_HEADER = 'x-bay-access'
export const WORKBENCH_ACCESS_ROUTE = '/api/workbench/access/v1'
/** Editors with explicit scoped native or directory adapters for LAN views. */
export const WORKBENCH_GUEST_EDITORS: readonly string[] = ['workbench.conversation', 'workbench.conversation.start', 'workbench.agent-trajectory', 'workbench.workspace-files', 'workbench.document-preview', 'workbench.plan', 'workbench.guide']

export type WorkbenchCapability = 'view' | 'message' | 'main-message' | 'read-files' | 'write-files' | 'layout' | 'context' | 'tasks' | 'memory' | 'package'
export interface WorkbenchGrant {
  template: 'review' | 'collaborate'
  capabilities: readonly WorkbenchCapability[]
  /** Omitted means all Areas of this Workbench; never another Workbench. */
  areaIds?: readonly string[]
  /** File access is further limited to these Workbench-relative directories. */
  paths?: readonly string[]
}
export const COLLABORATION_GRANT: WorkbenchGrant = Object.freeze({ template: 'collaborate', capabilities: ['view', 'message'] as const })
export const REVIEW_GRANT: WorkbenchGrant = Object.freeze({ template: 'review', capabilities: ['view'] as const })
export interface WorkbenchAccessContext {
  readonly actor: 'desktop' | 'browser-owner' | 'lan-guest'
  readonly accessId: string
  readonly workbenchId?: string
  readonly controlEpoch?: number
  readonly grantRevision?: number
  readonly grant?: WorkbenchGrant
}
export interface WorkbenchAccessTarget { workbenchId: string; areaId?: string; sessionId?: string; relativePath?: string }
export interface WorkbenchAccessBootstrap {
  context: WorkbenchAccessContext
  capabilities: readonly WorkbenchCapability[]
  controller: 'desktop' | 'browser'
}

export function parseWorkbenchGrant(input: unknown): WorkbenchGrant {
  if (input === undefined) return structuredClone(COLLABORATION_GRANT)
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('无效的分享权限。')
  const value = input as Record<string, unknown>
  if (value.template !== 'review' && value.template !== 'collaborate') throw new Error('请选择审阅或协作模板。')
  const allowed: readonly string[] = ['view', 'message', 'main-message', 'read-files', 'write-files', 'layout', 'context', 'tasks']
  if (!Array.isArray(value.capabilities) || value.capabilities.some(item => typeof item !== 'string' || !allowed.includes(item))) throw new Error('不支持的访客权限。')
  const capabilities = [...new Set(['view', ...value.capabilities])] as WorkbenchCapability[]
  if (value.template === 'review' && capabilities.some(item => item === 'message' || item === 'main-message')) throw new Error('审阅模板不能发送会话消息。')
  const strings = (key: 'areaIds' | 'paths') => {
    const list = value[key]
    if (list === undefined) return undefined
    if (!Array.isArray(list) || list.some(item => typeof item !== 'string' || item.includes('\\') || item.startsWith('/') || item.split('/').some((part: string) => part === '..' || part === '.') || /[\u0000-\u001f:]/u.test(item))) throw new Error('无效的分享范围。')
    return [...new Set(list)] as string[]
  }
  const areaIds = strings('areaIds'), paths = strings('paths')
  return { template: value.template, capabilities, ...(areaIds ? { areaIds } : {}), ...(paths ? { paths } : {}) }
}

export function isGrantReduction(before: WorkbenchGrant, after: WorkbenchGrant): boolean {
  const subset = (old: readonly string[] | undefined, next: readonly string[] | undefined) => old === undefined || next !== undefined && next.every(item => old.includes(item))
  return after.capabilities.every(item => before.capabilities.includes(item)) && subset(before.areaIds, after.areaIds)
    && (before.paths === undefined || after.paths !== undefined && after.paths.every(item => before.paths!.some(parent => parent === '' || item === parent || item.startsWith(parent + '/'))))
}
