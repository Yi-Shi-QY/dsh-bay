import type { WorkbenchRecordV2 } from './persistence.ts'
import type { WorkbenchProjectV1 } from '../workbench-directory-contract.ts'
import { areaContextOf } from './workbench-context.ts'

export function projectForArea(record: WorkbenchRecordV2, areaId: string): WorkbenchProjectV1 | undefined {
  const ref = record.areaProjects?.[areaId]
  return ref?.projectId ? record.projects?.[ref.projectId] : undefined
}

export function projectForPath(record: WorkbenchRecordV2, relativePath: string): WorkbenchProjectV1 | undefined {
  return Object.values(record.projects ?? {}).find(project => project.relativePath === relativePath)
}

export function projectContextForArea(record: WorkbenchRecordV2, areaId: string) {
  return areaContextOf(record.projectModelVersion ? projectForArea(record, areaId)?.context : record.areaContexts?.[areaId])
}

/** Main and legacy fixtures remain supported; a removed view never becomes the owner. */
export function sessionProjectId(record: WorkbenchRecordV2, sessionId: string): string | undefined {
  const row = record.sessionCatalog?.[sessionId] ?? Object.values(record.sessionCatalog ?? {}).find(entry => entry.sessionId === sessionId)
  return row?.projectId ?? (row && projectForPath(record, row.relativePath)?.projectId)
}
