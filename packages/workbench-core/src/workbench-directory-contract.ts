import type { WorkbenchRecordV2, WorkbenchSettingsV4 } from './foundation/persistence.ts'

export const WORKBENCH_DIRECTORY_ROUTE = '/api/workbench/directory/v1'
export const WORKBENCH_DIRECTORY_SERVICE = 'workbenchDirectoryHost'
export interface AreaProjectV1 { relativePath: string; generation: number; workspaceId?: string }
export interface WorkbenchSessionEntryV1 {
  sessionKey: string
  /** Local projection only; stripped from the file definition. */
  sessionId?: string
  role: 'main' | 'user' | 'worker' | 'subagent'
  areaId?: string
  relativePath: string
  title: string
  agentPreset: string
  createdAt: number
  requestId?: string
}
export interface FileWorkbenchV1 {
  schemaVersion: 1
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
