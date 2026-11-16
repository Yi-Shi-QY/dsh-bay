import type { WorkbenchRecordV2 } from './foundation/persistence.ts'
import type { BayAgentWorkStateV1 } from './foundation/workbench-bay-agent-work.ts'

/** Idempotent identity upgrade. Keep old areaId only as historical provenance. */
export function upgradeTaskProjects(record: WorkbenchRecordV2, source: BayAgentWorkStateV1): BayAgentWorkStateV1 {
  if (!record.projectModelVersion) return source
  const state = structuredClone(source)
  for (const item of state.workItems) {
    if (item.projectId || item.projectResolution === 'unresolved') continue
    const sessions = state.assignments.filter(row => row.workItemId === item.workItemId).flatMap(row => row.workerSessionId ?? row.sessionId ?? [])
    const owners = Object.values(record.sessionCatalog ?? {}).filter(entry => sessions.includes(entry.sessionKey) || !!entry.sessionId && sessions.includes(entry.sessionId))
    const candidates = [...new Set(owners.flatMap(row => row.projectId ?? []))]
    const fallback = record.projectMigration?.areaProjects[item.areaId] ?? (record.areaProjects?.[item.areaId]?.projectId ? [record.areaProjects[item.areaId]!.projectId!] : [])
    const ids = candidates.length ? candidates : fallback
    if (ids.length === 1 && record.projects?.[ids[0]!]) item.projectId = ids[0]!
    else {
      item.projectResolution = 'unresolved'; item.status = 'blocked'
      if (!state.attention.some(row => row.attentionId === 'project-upgrade-' + item.workItemId)) state.attention.push({ attentionId: 'project-upgrade-' + item.workItemId, areaId: item.areaId, workItemId: item.workItemId, kind: 'decision', status: 'open', createdAt: item.updatedAt, question: '旧任务的项目归属无法唯一确定，原记录已保留。请核对原会话目录后重新指定项目。' })
    }
    for (const assignment of state.assignments.filter(row => row.workItemId === item.workItemId)) {
      if (item.projectId) {
        assignment.projectId = item.projectId
        if (assignment.lease) assignment.lease.projectId = item.projectId
      } else if (assignment.state !== 'ended') { assignment.state = 'ended'; assignment.reportState = 'blocked' }
    }
    for (const attention of state.attention.filter(row => row.workItemId === item.workItemId)) if (item.projectId) attention.projectId = item.projectId
  }
  return state
}
