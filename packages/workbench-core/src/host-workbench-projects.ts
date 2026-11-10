import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync, realpathSync, lstatSync } from 'node:fs'
import path from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import type { WorkbenchRecordV2 } from './foundation/persistence.ts'
import { areasOf } from './foundation/document-v3.ts'
import { areaContextOf, createAreaContext, decodeAreaContext, renderAreaContextMarkdown } from './foundation/workbench-context.ts'
import { portableRelativePath, resolvePortablePath } from './host-native-session-portability.ts'
import type { WorkbenchProjectV1 } from './workbench-directory-contract.ts'
import type { WorkbenchMemoryEntry, WorkbenchMemoryIndex } from './workbench-memory-contract.ts'

export interface ProjectWrite { file: string; value?: unknown; text?: string }
export interface ProjectFile { schemaVersion: 1; projectId: string; name: string; context: ReturnType<typeof createAreaContext>; contextCandidates?: WorkbenchProjectV1['contextCandidates'] }

/** Metadata is never allowed to follow a .bay symlink outside the managed project. */
export function projectMetadataFolder(root: string, relativePath: string): string {
  const absolute = realpathSync(resolvePortablePath(root, relativePath))
  const relative = portableRelativePath(realpathSync(root), absolute)
  if (!relative || relative.split('/').some(segment => segment.toLowerCase() === '.bay')) throw new Error('项目目录无效。')
  const folder = path.join(absolute, '.bay')
  if (existsSync(folder) && (lstatSync(folder).isSymbolicLink() || realpathSync(folder) !== folder)) throw new Error('项目管理目录不能是链接。')
  return folder
}

export function readProject(root: string, ref: WorkbenchProjectV1): WorkbenchProjectV1 {
  const file = path.join(projectMetadataFolder(root, ref.relativePath), 'project.json')
  const data = JSON.parse(readFileSync(file, 'utf8')) as ProjectFile
  const context = decodeAreaContext(data.context)
  if (data.schemaVersion !== 1 || data.projectId !== ref.projectId || !context || typeof data.name !== 'string') throw new Error('项目定义损坏或身份不匹配：' + ref.relativePath)
  if (data.contextCandidates?.some(row => typeof row.areaId !== 'string' || !decodeAreaContext(row.context))) throw new Error('项目背景来源记录无效。')
  return { ...ref, name: data.name, context, ...(data.contextCandidates ? { contextCandidates: data.contextCandidates } : {}) }
}

export function projectWrites(root: string, project: WorkbenchProjectV1): ProjectWrite[] {
  const folder = projectMetadataFolder(root, project.relativePath)
  const context = project.context === undefined ? createAreaContext() : decodeAreaContext(project.context)
  if (!context) throw new Error('项目背景格式无效。')
  const data: ProjectFile = { schemaVersion: 1, projectId: project.projectId, name: project.name, context, ...(project.contextCandidates ? { contextCandidates: project.contextCandidates } : {}) }
  return [{ file: path.join(folder, 'project.json'), value: data }, { file: path.join(folder, 'context.md'), text: renderAreaContextMarkdown(data.context) }]
}

export function discoverProject(root: string, relativePath: string, projects: Record<string, WorkbenchProjectV1>): WorkbenchProjectV1 {
  const canonical = portableRelativePath(realpathSync(root), realpathSync(resolvePortablePath(root, relativePath)))
  const existing = Object.values(projects).find(row => row.relativePath === canonical)
  if (existing) return existing
  const file = path.join(projectMetadataFolder(root, canonical), 'project.json')
  if (existsSync(file)) {
    const data = JSON.parse(readFileSync(file, 'utf8')) as ProjectFile
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,120}$/u.test(data.projectId)) throw new Error('项目身份无效。')
    if (projects[data.projectId]) throw new Error('此目录是已有项目的副本，项目身份重复。请先为副本建立独立身份。')
    return readProject(root, { projectId: data.projectId, relativePath: canonical, generation: 1, name: data.name })
  }
  return { projectId: 'project-' + randomUUID(), relativePath: canonical, generation: 1, name: path.basename(canonical), context: createAreaContext() }
}

export function hydrateProjects(root: string, record: WorkbenchRecordV2): WorkbenchRecordV2 {
  if (!record.projectModelVersion) return structuredClone(record)
  const next = structuredClone(record)
  next.projects = Object.fromEntries(Object.entries(next.projects ?? {}).map(([id, ref]) => [id, readProject(root, ref)]))
  next.areaContexts = Object.fromEntries(Object.entries(next.areaProjects ?? {}).flatMap(([areaId, ref]) => {
    const project = ref.projectId && next.projects?.[ref.projectId]
    return project ? [[areaId, structuredClone(areaContextOf(project.context))]] : []
  }))
  return next
}

/** Preserve all legacy facts before removing hidden display identities. No native sessions are created. */
export function upgradeProjectOwnership(root: string, source: WorkbenchRecordV2): { record: WorkbenchRecordV2; writes: ProjectWrite[] } {
  if (source.projectModelVersion) return { record: hydrateProjects(root, source), writes: [] }
  const record = structuredClone(source), writes: ProjectWrite[] = []
  record.projectModelVersion = 1; record.projects = {}
  record.projectMigration = { areaProjects: {}, unassignedContexts: {} }
  const byPath = new Map<string, WorkbenchProjectV1>()
  const ensure = (relative: string) => {
    let project = byPath.get(relative)
    if (!project) { project = discoverProject(root, relative, record.projects!); record.projects![project.projectId] = project; byPath.set(relative, project) }
    return project
  }
  for (const [areaId, ref] of Object.entries(record.areaProjects ?? {})) {
    const project = ensure(ref.relativePath)
    record.areaProjects![areaId] = { projectId: project.projectId, relativePath: project.relativePath, generation: project.generation }
    record.projectMigration.areaProjects[areaId] = [project.projectId]
  }
  for (const session of Object.values(record.sessionCatalog ?? {})) {
    if (session.role === 'main') continue
    const project = ensure(session.relativePath); session.projectId = project.projectId; session.relativePath = project.relativePath
    if (session.areaId) record.projectMigration.areaProjects[session.areaId] = [...new Set([...(record.projectMigration.areaProjects[session.areaId] ?? []), project.projectId])]
  }
  const sources = new Map<string, NonNullable<WorkbenchProjectV1['contextCandidates']>>()
  for (const [areaId, context] of Object.entries(record.areaContexts ?? {})) {
    if (isDeepStrictEqual({ ...context, revision: 0 }, createAreaContext())) continue
    const ids = record.projectMigration.areaProjects[areaId] ?? []
    if (ids.length !== 1) { record.projectMigration.unassignedContexts[areaId] = context; continue }
    const candidates = sources.get(ids[0]!) ?? []; candidates.push({ areaId, context }); sources.set(ids[0]!, candidates)
  }
  for (const project of Object.values(record.projects)) {
    const candidates = sources.get(project.projectId) ?? []
    const distinct = candidates.filter((row, i) => !candidates.slice(0, i).some(prior => isDeepStrictEqual({ ...prior.context, revision: 0 }, { ...row.context, revision: 0 })))
    const current = areaContextOf(project.context)
    if (distinct.length === 1 && isDeepStrictEqual({ ...current, revision: 0 }, createAreaContext())) project.context = distinct[0]!.context
    else if (distinct.length && !distinct.every(row => isDeepStrictEqual({ ...row.context, revision: 0 }, { ...current, revision: 0 }))) project.contextCandidates = candidates
    writes.push(...projectWrites(root, project))
  }
  const visible = new Set(areasOf(record.document.root).map(area => area.areaId))
  record.areaDefinitions = Object.fromEntries([...visible].map(areaId => [areaId, { areaId }]))
  record.areaProjects = Object.fromEntries(Object.entries(record.areaProjects ?? {}).filter(([id]) => visible.has(id)))
  record.areaMetadata = Object.fromEntries(Object.entries(record.areaMetadata ?? {}).filter(([id]) => visible.has(id)))
  delete record.areaContexts
  writes.push(...upgradeProjectMemories(root, record))
  return { record, writes }
}

function upgradeProjectMemories(root: string, record: WorkbenchRecordV2): ProjectWrite[] {
  const folder = path.join(root, '.bay', 'memory'), file = path.join(folder, 'index.json')
  if (!existsSync(file)) return []
  const index = JSON.parse(readFileSync(file, 'utf8')) as WorkbenchMemoryIndex
  const writes: ProjectWrite[] = [{ file: path.join(root, '.bay', 'upgrades', 'project-ownership-v1', 'memory-index.json'), value: index }]
  const retained = structuredClone(index), indexes = new Map<string, WorkbenchMemoryIndex>()
  for (const entry of Object.values(index.entries)) {
    if (!entry.areaId) continue
    const candidates = record.projectMigration?.areaProjects[entry.areaId] ?? []
    if (candidates.length !== 1) continue // Preserved in the global index as unresolved provenance.
    const projectId = candidates[0]!, project = record.projects![projectId]!
    const target = path.join(projectMetadataFolder(root, project.relativePath), 'memory')
    let destination = indexes.get(projectId)
    if (!destination) {
      destination = existsSync(path.join(target, 'index.json')) ? JSON.parse(readFileSync(path.join(target, 'index.json'), 'utf8')) as WorkbenchMemoryIndex : { version: 1, revision: 0, entries: {}, requests: {} }
      indexes.set(projectId, destination)
    }
    if (destination.entries[entry.id]) throw new Error('项目记忆身份冲突：' + entry.id)
    for (let revision = 1; revision <= entry.revision; revision++) {
      const old = path.join(folder, 'entries', entry.id, String(revision))
      const metadata = JSON.parse(readFileSync(old + '.json', 'utf8')) as WorkbenchMemoryEntry
      writes.push({ file: path.join(target, 'entries', entry.id, revision + '.json'), value: { ...metadata, projectId } }, { file: path.join(target, 'entries', entry.id, revision + '.md'), text: readFileSync(old + '.md', 'utf8') })
    }
    destination.entries[entry.id] = { ...entry, projectId }; destination.revision++
    delete retained.entries[entry.id]
    for (const [id, request] of Object.entries(index.requests)) if (request.id === entry.id) { destination.requests[id] = request; delete retained.requests[id] }
  }
  for (const [id, value] of indexes) writes.push({ file: path.join(projectMetadataFolder(root, record.projects![id]!.relativePath), 'memory', 'index.json'), value })
  retained.revision++; writes.push({ file, value: retained })
  return writes
}
