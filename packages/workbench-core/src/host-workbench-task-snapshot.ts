import { upgradeTaskProjects } from './host-workbench-task-projects.ts'
import type { BayAgentWorkStateV1 } from './foundation/workbench-bay-agent-work.ts'
import type { WorkbenchRecordV2 } from './foundation/persistence.ts'
import { workbenchAreas } from './foundation/area-identity.ts'
import { areasOf } from './foundation/document-v3.ts'
import type { JsonValue } from './foundation/model.ts'

/** Remap typed native references in page state; leave ordinary text alone. */
export function remapCompletePageReferences(record: WorkbenchRecordV2, sessions: Readonly<Record<string, string>>, workspaces: Readonly<Record<string, string>>): void {
  const session = (id: string) => {
    if (!sessions[id]) throw new Error('内页资源缺少对话映射：' + id)
    return sessions[id]!
  }
  const value = (input: JsonValue): JsonValue => {
    if (typeof input === 'string' && input.startsWith('dsh-resource://')) {
      return input.replace(/\/session\/([^/?#]+)/gu, (_match, id: string) => '/session/' + encodeURIComponent(session(decodeURIComponent(id))))
        .replace(/([?&]parent=)([^&#]+)/gu, (_match, prefix: string, id: string) => prefix + encodeURIComponent(session(decodeURIComponent(id))))
    }
    if (Array.isArray(input)) return input.map(value)
    if (!input || typeof input !== 'object') return input
    return Object.fromEntries(Object.entries(input).map(([key, child]) => {
      if (['sessionId', 'parentSessionId', 'childSessionId'].includes(key) && typeof child === 'string') return [key, session(child)]
      if (key === 'workspaceId' && typeof child === 'string') {
        if (!workspaces[child]) throw new Error('内页资源缺少项目映射。')
        return [key, workspaces[child]]
      }
      return [key, value(child)]
    }))
  }
  for (const area of areasOf(record.document.root)) for (const page of area.moduleHistory) {
    page.state = value(page.state)
    if (page.sessionStates) {
      const keys = new Map<string, string>()
      for (const key of Object.keys(page.sessionStates)) {
        const [workspaceId, sessionId] = JSON.parse(key) as [string | null, string]
        if (workspaceId && !workspaces[workspaceId]) throw new Error('内页历史状态缺少项目映射。')
        keys.set(key, JSON.stringify([workspaceId ? workspaces[workspaceId] : null, session(sessionId)]))
      }
      page.sessionStates = Object.fromEntries(Object.entries(page.sessionStates).map(([key, state]) => [keys.get(key)!, value(state)]))
      if (page.sessionStateOrder) page.sessionStateOrder = page.sessionStateOrder.map(key => { if (!keys.has(key)) throw new Error('内页历史状态顺序无效。'); return keys.get(key)! })
    }
  }
}

export interface CompleteTaskSnapshot {
  version: 1
  kind: 'workbench-task-snapshot'
  workbenchId: string
  state: BayAgentWorkStateV1
}

function validate(snapshot: CompleteTaskSnapshot, record: WorkbenchRecordV2) {
  const state = snapshot.state
  if (snapshot.version !== 1 || snapshot.kind !== 'workbench-task-snapshot' || !state || state.version !== 1
    || !Array.isArray(state.workItems) || !Array.isArray(state.assignments) || !Array.isArray(state.attention)) throw new Error('完整包任务快照格式不受支持。')
  const areas = new Set(workbenchAreas(record).map(area => area.areaId))
  const tasks = new Map(state.workItems.map(item => [item.workItemId, item]))
  const assignments = new Map(state.assignments.map(row => [row.assignmentId, row]))
  if (tasks.size !== state.workItems.length || assignments.size !== state.assignments.length || new Set(state.attention.map(row => row.attentionId)).size !== state.attention.length) throw new Error('任务快照含重复身份。')
  for (const item of state.workItems) {
    if (item.workbenchId !== snapshot.workbenchId || (record.projectModelVersion ? item.projectResolution !== 'unresolved' && (!item.projectId || !record.projects?.[item.projectId]) : !areas.has(item.areaId) || !record.areaProjects?.[item.areaId])
      || (item.currentAssignmentId && assignments.get(item.currentAssignmentId)?.workItemId !== item.workItemId)) throw new Error('任务的区域或执行引用缺失：' + item.workItemId)
  }
  for (const row of state.assignments) {
    const item = tasks.get(row.workItemId)
    if (!item || (item.projectId ? item.projectId !== row.projectId : item.areaId !== row.areaId)) throw new Error('执行记录的任务归属无效：' + row.assignmentId)
    if (row.runtimeName !== 'dsh-session-controller') throw new Error('此 Worker Runtime 尚未提供完整任务迁移适配器：' + row.runtimeName)
    const session = row.workerSessionId ?? row.sessionId
    if (session && (!record.sessionCatalog?.[session] || (item.projectId ? record.sessionCatalog[session]?.projectId !== item.projectId : record.sessionCatalog[session]?.areaId !== item.areaId))) throw new Error('任务的原对话缺失或归属不匹配：' + row.assignmentId)
  }
  for (const row of state.attention) if (!tasks.has(row.workItemId) || tasks.get(row.workItemId)!.areaId !== row.areaId || (row.assignmentId && assignments.get(row.assignmentId)?.workItemId !== row.workItemId)) throw new Error('Attention 引用无效：' + row.attentionId)
  let seq = state.checkpoint?.compactedThroughSeq ?? 0
  const eventIds = new Set<string>()
  for (const event of state.events ?? []) {
    if (event.schemaVersion !== 1 || event.workbenchId !== snapshot.workbenchId || !Number.isSafeInteger(event.seq) || event.seq <= seq || eventIds.has(event.eventId)) throw new Error('编排账本顺序或身份无效。')
    seq = event.seq; eventIds.add(event.eventId)
  }
  if (state.checkpoint && state.checkpoint.workbenchId !== snapshot.workbenchId) throw new Error('编排 checkpoint 所属工作台不匹配。')
  if (state.nextEventSeq !== undefined && state.nextEventSeq <= seq) throw new Error('编排账本的下一事件序号无效。')
}

/** Rewrite schema-owned references; natural-language summaries remain historical text. */
function references(value: unknown, sessions: Readonly<Record<string, string>>, workbenchId: string): unknown {
  if (Array.isArray(value)) return value.map(child => references(child, sessions, workbenchId))
  if (!value || typeof value !== 'object') return value
  const result: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value)) {
    if (key === 'workspaceId') continue
    if (key === 'workbenchId') { result[key] = workbenchId; continue }
    if (['sessionId', 'workerSessionId'].includes(key) && typeof child === 'string') {
      if (!sessions[child]) throw new Error('编排事件缺少可迁移的会话映射：' + child)
      result[key] = sessions[child]
    } else result[key] = references(child, sessions, workbenchId)
  }
  return result
}

export function exportTaskSnapshot(record: WorkbenchRecordV2, state: BayAgentWorkStateV1, sessionKeys: Record<string, string>): CompleteTaskSnapshot {
  const inverse = Object.fromEntries(Object.entries(sessionKeys).map(([key, id]) => [id, key]))
  const snapshot: CompleteTaskSnapshot = { version: 1, kind: 'workbench-task-snapshot', workbenchId: record.workbenchId,
    state: upgradeTaskProjects(record, references(state, inverse, record.workbenchId) as BayAgentWorkStateV1) }
  validate(snapshot, record)
  return snapshot
}

export function restoreTaskSnapshot(snapshot: CompleteTaskSnapshot, record: WorkbenchRecordV2, sessions: Record<string, string>, now: number): BayAgentWorkStateV1 {
  validate(snapshot, record)
  const state = references(snapshot.state, sessions, record.workbenchId) as BayAgentWorkStateV1
  for (const item of state.workItems) {
    item.importedFrom = { workbenchId: snapshot.workbenchId, status: item.status }
    if (['running', 'queued'].includes(item.status)) item.status = 'waiting'
  }
  for (const assignment of state.assignments) {
    assignment.importedFrom = { state: assignment.state, ...(assignment.runtimeAssignmentId ? { runtimeAssignmentId: assignment.runtimeAssignmentId } : {}) }
    delete assignment.runtimeAssignmentId; delete assignment.lease; delete assignment.nativeInputPending
    if (assignment.state !== 'ended') {
      assignment.state = 'ended'; assignment.endedAt = now
      state.attention.push({ attentionId: 'import-' + assignment.assignmentId, workItemId: assignment.workItemId, assignmentId: assignment.assignmentId,
        areaId: assignment.areaId, ...(assignment.projectId ? { projectId: assignment.projectId } : {}), kind: 'decision', status: 'open', question: '此任务从完整包恢复，原执行已停止。请核对结果后继续原任务。', createdAt: now })
    }
  }
  return state
}
