import type { WorkbenchRecordV2, WorkbenchSettingsV4 } from './foundation/persistence.ts'

export const WORKBENCH_DIRECTORY_ROUTE = '/api/workbench/directory/v1'
export const WORKBENCH_DIRECTORY_SERVICE = 'workbenchDirectoryHost'
export interface AreaProjectV1 { projectId?: string; relativePath: string; generation: number; workspaceId?: string }
/** Directory-owned data. Context is hydrated by Host; only the reference is in workbench.json. */
export interface WorkbenchProjectV1 extends AreaProjectV1 {
  projectId: string
  name: string
  context?: import('./foundation/workbench-context.ts').AreaContextV1
  contextCandidates?: { areaId: string; context: import('./foundation/workbench-context.ts').AreaContextV1 }[]
}
/** The upstream Creator preset is registered as cordis, not creator. */
export const CREATOR_REPAIR_AGENT_PRESET = 'cordis'
export interface CreatorRepairTargetV1 { workbenchId: string; moduleId: string; packageName?: string }
export interface CreatorRepairProjectV1 {
  workspaceId: string
  relativePath: string
  sessionKey: string
  sessionId: string
  registered: boolean
}
export interface WorkbenchSessionEntryV1 {
  sessionKey: string
  /** Local projection only; stripped from the file definition. */
  sessionId?: string
  role: 'main' | 'user' | 'worker' | 'subagent'
  projectId?: string
  /** Historical presentation location only in the project ownership model. */
  areaId?: string
  relativePath: string
  title: string
  agentPreset: string
  createdAt: number
  requestId?: string
}
export interface FileWorkbenchV1 {
  schemaVersion: 1 | 2
  revision: number
  record: WorkbenchRecordV2
}
export interface FileWorkbenchSnapshot {
  status: 'ready' | 'unavailable'
  value: WorkbenchSettingsV4
  revision: number
  writable: boolean
  mode: 'host'
}
export interface DirectoryPatch {
  operation: 'set' | 'unset'
  path: readonly string[]
  value?: unknown
  expectedRevision?: number
}
