export const WORKBENCH_ACCESS_SERVICE = 'workbenchAccessHost'
export const WORKBENCH_ACCESS_HEADER = 'x-bay-access'
export const WORKBENCH_ACCESS_ROUTE = '/api/workbench/access/v1'
export type WorkbenchCapability = 'view' | 'message' | 'main-message' | 'read-files' | 'write-files' | 'layout' | 'context' | 'tasks' | 'memory' | 'package'
export interface WorkbenchGrant {
  template: 'shared-control'
  capabilities: readonly WorkbenchCapability[]
}
export const SHARED_CONTROL_GRANT: WorkbenchGrant = Object.freeze({
  template: 'shared-control',
  capabilities: ['view', 'message', 'main-message', 'read-files', 'write-files', 'layout', 'context', 'tasks', 'memory', 'package'] as const,
})

export interface WorkbenchAccessContext {
  readonly actor: 'desktop' | 'browser-owner' | 'lan-guest'
  readonly accessId: string
  readonly workbenchId?: string
  /** Shared-control identity used for Host session/task audit trails. */
  readonly participantId?: string
  readonly collaborationId?: string
  readonly displayName?: string
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
  if (input === undefined) return structuredClone(SHARED_CONTROL_GRANT)
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('invalid-workbench-grant')
  const value = input as Record<string, unknown>
  if (value.template !== 'shared-control') throw new Error('legacy-workbench-grant-unsupported')
  const allowed: readonly string[] = ['view', 'message', 'main-message', 'read-files', 'write-files', 'layout', 'context', 'tasks', 'memory', 'package']
  if (!Array.isArray(value.capabilities) || value.capabilities.some(item => typeof item !== 'string' || !allowed.includes(item))) throw new Error('invalid-workbench-capabilities')
  const capabilities = [...new Set(['view', ...value.capabilities])] as WorkbenchCapability[]
  if (value.areaIds !== undefined || value.paths !== undefined) throw new Error('legacy-workbench-scope-unsupported')
  return { template: 'shared-control', capabilities }
}

export function isGrantReduction(before: WorkbenchGrant, after: WorkbenchGrant): boolean {
  return after.template === 'shared-control' && after.capabilities.every(item => before.capabilities.includes(item))
}
