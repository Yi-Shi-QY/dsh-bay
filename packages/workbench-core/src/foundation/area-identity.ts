import { areasOf, type AreaNode } from './document-v3.ts'
import type { WorkbenchRecordV2 } from './persistence.ts'
import type { GroupNode, SessionBindingV1, TabDocument } from './model.ts'
import type { AreaProjectV1 } from '../workbench-directory-contract.ts'

/** Visibility is a layout property, not an Area's lifetime. */
export function workbenchAreas(record: WorkbenchRecordV2): AreaNode[] {
  const visible = areasOf(record.document.root), ids = new Set(visible.map(area => area.areaId))
  return [...visible, ...Object.keys(record.areaDefinitions ?? {}).filter(id => !ids.has(id)).map(areaId => ({ kind: 'area' as const, areaId, moduleHistory: [] }))]
}

/** Validate the durable graph, including owners whose containers are hidden. */
export function validateWorkbenchRelations(record: WorkbenchRecordV2): void {
  const areas = new Set(workbenchAreas(record).map(area => area.areaId))
  const catalog = record.sessionCatalog ?? {}
  for (const [id, project] of Object.entries(record.areaProjects ?? {})) {
    if (!areas.has(id) || !project.relativePath || project.relativePath.includes('\\') || project.relativePath.split('/').some(part => !part || part === '.' || part === '..' || part.toLowerCase() === '.bay' || part.includes(':'))) throw new Error('区域项目引用无效：' + id)
  }
  for (const [key, entry] of Object.entries(catalog)) {
    // Closed sessions retain the project they were created in. Only pages
    // still present in the layout must match the area's current project.
    const relativePathValid = entry.relativePath !== '' && !entry.relativePath.includes('\\') && entry.relativePath.split('/').every(part => part && part !== '.' && part !== '..' && part.toLowerCase() !== '.bay' && !part.includes(':'))
    if (entry.sessionKey !== key || (entry.role === 'main' ? entry.relativePath !== '' : !entry.areaId || !areas.has(entry.areaId) || !relativePathValid)) throw new Error('对话归属或项目引用无效：' + key)
  }
  for (const area of areasOf(record.document.root)) for (const page of area.moduleHistory) {
    if (page.binding) {
      const entry = catalog[page.binding.sessionId] ?? Object.values(catalog).find(row => row.sessionId === page.binding!.sessionId)
      if (!entry || entry.role === 'main' || entry.relativePath !== record.areaProjects?.[area.areaId]?.relativePath) throw new Error('内页对话与区域项目不匹配：' + page.moduleInstanceId)
    }
    if (page.editorId === 'workbench.workspace-files') {
      const source = (page.state as { projectAreaId?: string }).projectAreaId ?? area.areaId
      if (!areas.has(source) || (source !== area.areaId && record.areaProjects?.[source]?.relativePath !== record.areaProjects?.[area.areaId]?.relativePath)) throw new Error('项目文件内页来源无效：' + page.moduleInstanceId)
    }
  }
  if (record.bayAgentSession) {
    const entry = catalog[record.bayAgentSession.sessionId] ?? Object.values(catalog).find(row => row.sessionId === record.bayAgentSession!.sessionId)
    if (!entry || entry.role !== 'main') throw new Error('Bay Agent 主会话引用缺失。')
  }
}

export function showWorkbenchArea(record: WorkbenchRecordV2, areaId: string, splitId: string): WorkbenchRecordV2 {
  if (areasOf(record.document.root).some(area => area.areaId === areaId)) return record
  if (!record.areaDefinitions?.[areaId]) throw new Error('区域不存在。')
  return { ...record, document: { ...record.document, activeAreaId: areaId, root: {
    kind: 'split', id: splitId, axis: 'horizontal', ratio: .5, first: record.document.root,
    second: { kind: 'area', areaId, moduleHistory: [] },
  } } }
}

export const areaOperationCopy = {
  projectMissing: '请先为此区域设置项目文件夹。',
  projectMismatch: '此内页来自另一个项目，请选择对应区域或为该项目新建区域。',
  mergeMismatch: '这两个区域使用不同的项目文件夹，无法合并显示。',
  sourceMissing: '请选择此内页的来源对话。',
  mainFixed: 'Bay Agent 主控页签保留在浮动工作区。',
}

export function placementReason(tab: TabDocument, project: AreaProjectV1 | undefined, enforceProject: boolean): string | undefined {
  if (tab.id === 'bay-agent-main') return areaOperationCopy.mainFixed
  if (!enforceProject || !tab.binding) return undefined
  if (!project) return areaOperationCopy.projectMissing
  return !tab.binding.workspaceId || tab.binding.workspaceId !== project.workspaceId ? areaOperationCopy.projectMismatch : undefined
}

export function sameEditorSource(tab: TabDocument, binding: SessionBindingV1 | undefined): boolean {
  return tab.sessionId === binding?.sessionId && tab.binding?.workspaceId === binding?.workspaceId
}

export function mergeReason(source: GroupNode, target: GroupNode): string | undefined {
  if (source.projectRequired || target.projectRequired || source.project !== undefined || target.project !== undefined) {
    if (!source.project || !target.project) return areaOperationCopy.projectMissing
    if (source.project.workspaceId && source.project.workspaceId === target.project.workspaceId) return undefined
    return source.project.relativePath === target.project.relativePath ? undefined : areaOperationCopy.mergeMismatch
  }
  const projects = new Set([...source.tabs, ...target.tabs].flatMap(tab => tab.binding?.workspaceId ? [tab.binding.workspaceId] : []))
  return projects.size > 1 ? areaOperationCopy.mergeMismatch : undefined
}
