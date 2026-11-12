import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { existsSync, realpathSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import type { HostWorkbenchDirectory } from './host-workbench-directory.ts'
import type { HostWorkbenchMemory } from './host-workbench-memory.ts'
import type { FileWorkbenchSnapshot } from './workbench-directory-contract.ts'
import { areasOf, migrateDocumentV2ToV3, normalizeWorkbenchDocument, projectDocumentV3ToLayoutV2, validateWorkbenchDocumentV3 } from './foundation/document-v3.ts'
import { validateLayout } from './foundation/model.ts'
import {
  areaContextOf,
  patchAreaContext,
  patchWorkbenchContext,
  workbenchContextOf,
  type WorkbenchContextSection,
  type WorkbenchContextWriter,
} from './foundation/workbench-context.ts'
import { WORKBENCH_ACCESS_HEADER, isGrantReduction, parseWorkbenchGrant, type WorkbenchAccessContext, type WorkbenchAccessTarget, type WorkbenchCapability, type WorkbenchGrant } from './workbench-access-contract.ts'
import type { WorkbenchCollaborationSeedV1, WorkbenchCommandV1 } from './workbench-collaboration-contract.ts'
import type { DirectoryPatch } from './workbench-directory-contract.ts'
import type { WorkbenchMemoryWrite } from './workbench-memory-contract.ts'
import type { WorkbenchMemoryEntry } from './workbench-memory-contract.ts'

const hash = (token: string) => createHash('sha256').update(token).digest('hex')
const contentHash = (value: Uint8Array) => createHash('sha256').update(value).digest('hex')
const DESKTOP: WorkbenchAccessContext = Object.freeze({ actor: 'desktop', accessId: 'desktop' })
const ALL: readonly WorkbenchCapability[] = ['view', 'message', 'main-message', 'read-files', 'write-files', 'layout', 'context', 'tasks', 'memory', 'package']
type Lease = { context: WorkbenchAccessContext; active: () => boolean; tokenHash: string; writable?: (capability: WorkbenchCapability) => boolean }

export interface HostWorkbenchTaskRuntime {
  snapshot(workbenchId: string): readonly unknown[]
  request(workbenchId: string, input: Record<string, unknown>): Promise<unknown> | unknown
  subscribe?(workbenchId: string, listener: (tasks: readonly unknown[]) => void): () => void
}

export class WorkbenchAccessError extends Error {
  constructor(readonly code: string, message: string, readonly status = 403) { super(message) }
}

function commandPayload(operation: Extract<WorkbenchCommandV1, { kind: 'workbench.command' }>): Record<string, unknown> {
  return operation.payload && typeof operation.payload === 'object' && !Array.isArray(operation.payload)
    ? operation.payload as Record<string, unknown> : {}
}

function commandText(value: unknown, field: string, maxLength = 160): string {
  if (typeof value !== 'string') throw new WorkbenchAccessError('invalid-operation', `${field} must be a string`, 400)
  const text = value.normalize('NFKC').trim()
  if (text.length === 0 || text.length > maxLength) throw new WorkbenchAccessError('invalid-operation', `${field} is invalid`, 400)
  return text
}

function commandRecord(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new WorkbenchAccessError('invalid-operation', `${field} must be an object`, 400)
  return value as Record<string, unknown>
}

function memoryWritePayload(value: unknown): WorkbenchMemoryWrite {
  const entry = commandRecord(value, 'entry')
  const text = (field: string, maximum: number): string => commandText(entry[field], `entry.${field}`, maximum)
  const expectedRevision = entry.expectedRevision
  if (typeof expectedRevision !== 'number' || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
    throw new WorkbenchAccessError('invalid-operation', 'entry.expectedRevision is invalid', 400)
  }
  const source = commandRecord(entry.source, 'entry.source')
  const sourceKind = source.kind
  if (sourceKind !== 'user' && sourceKind !== 'task' && sourceKind !== 'session' && sourceKind !== 'file') {
    throw new WorkbenchAccessError('invalid-operation', 'entry.source.kind is invalid', 400)
  }
  const verification = entry.verification
  if (verification !== 'candidate' && verification !== 'verified' && verification !== 'needs-revalidation') {
    throw new WorkbenchAccessError('invalid-operation', 'entry.verification is invalid', 400)
  }
  if (typeof entry.environmentDependent !== 'boolean') throw new WorkbenchAccessError('invalid-operation', 'entry.environmentDependent is invalid', 400)
  return {
    ...(typeof entry.projectId === 'string' ? { projectId: commandText(entry.projectId, 'entry.projectId', 320) } : {}),
    requestId: text('requestId', 180),
    id: text('id', 120),
    expectedRevision,
    title: text('title', 160),
    summary: typeof entry.summary === 'string' ? entry.summary : (() => { throw new WorkbenchAccessError('invalid-operation', 'entry.summary is invalid', 400) })(),
    body: typeof entry.body === 'string' ? entry.body : (() => { throw new WorkbenchAccessError('invalid-operation', 'entry.body is invalid', 400) })(),
    source: {
      kind: sourceKind,
      reference: typeof source.reference === 'string' ? source.reference : (() => { throw new WorkbenchAccessError('invalid-operation', 'entry.source.reference is invalid', 400) })(),
      description: typeof source.description === 'string' ? source.description : (() => { throw new WorkbenchAccessError('invalid-operation', 'entry.source.description is invalid', 400) })(),
    },
    verification,
    environmentDependent: entry.environmentDependent,
    ...(typeof entry.areaId === 'string' ? { areaId: commandText(entry.areaId, 'entry.areaId', 160) } : {}),
    ...(entry.removed === undefined ? {} : { removed: entry.removed === true }),
  }
}

function directoryRevision(access: HostWorkbenchAccess, payload: Record<string, unknown>): number {
  const current = access.directory.getSnapshot().revision
  if (payload.expectedDirectoryRevision !== undefined) {
    if (typeof payload.expectedDirectoryRevision !== 'number' || !Number.isSafeInteger(payload.expectedDirectoryRevision) || payload.expectedDirectoryRevision < 0) {
      throw new WorkbenchAccessError('invalid-operation', 'expectedDirectoryRevision is invalid', 400)
    }
    if (payload.expectedDirectoryRevision !== current) throw new WorkbenchAccessError('revision-conflict', 'Workbench directory changed', 409)
  }
  return current
}

function redactWorkbenchRoot(access: HostWorkbenchAccess, workbenchId: string, value: string): string {
  let root: string | undefined
  try { root = access.getRecord(workbenchId).fileWorkbench?.rootPath } catch { root = undefined }
  if (root === undefined || root.length === 0) return value
  const variants = [root, root.replaceAll('\\', '/'), root.replaceAll('/', '\\')]
  let result = value
  for (const variant of variants) if (variant.length > 0) result = result.split(variant).join('<workbench-root>')
  return result
}

function redactMemoryEntry(access: HostWorkbenchAccess, workbenchId: string, entry: WorkbenchMemoryEntry): WorkbenchMemoryEntry {
  return {
    ...structuredClone(entry),
    title: redactWorkbenchRoot(access, workbenchId, entry.title),
    summary: redactWorkbenchRoot(access, workbenchId, entry.summary),
    source: {
      ...entry.source,
      reference: redactWorkbenchRoot(access, workbenchId, entry.source.reference),
      description: redactWorkbenchRoot(access, workbenchId, entry.source.description),
    },
  }
}

function redactMemoryBody(access: HostWorkbenchAccess, workbenchId: string, value: { readonly entry: WorkbenchMemoryEntry; readonly body: string }) {
  return { entry: redactMemoryEntry(access, workbenchId, value.entry), body: redactWorkbenchRoot(access, workbenchId, value.body) }
}

async function patchWorkbenchRecord(access: HostWorkbenchAccess, workbenchId: string, next: unknown, expectedRevision: number): Promise<unknown> {
  const result = await access.directory.patch({ operation: 'set', path: ['workbenches', workbenchId], value: next, expectedRevision })
  if (result.status === 'conflict') throw new WorkbenchAccessError('revision-conflict', 'Workbench directory changed', 409)
  if (result.status !== 'committed') throw new WorkbenchAccessError('command-failed', 'Workbench directory is unavailable', 503)
  return result
}

function contextWritePayload(payload: Record<string, unknown>): {
  scope: 'workbench' | 'area' | 'project'
  areaId?: string
  projectId?: string
  writer: WorkbenchContextWriter
  section: WorkbenchContextSection
  expectedRevision: number
  patch: Record<string, unknown>
} {
  const scope = payload.scope
  if (scope !== 'workbench' && scope !== 'area' && scope !== 'project') throw new WorkbenchAccessError('invalid-operation', 'context scope is invalid', 400)
  const writer = payload.writer
  if (writer !== 'human' && writer !== 'bay-agent' && writer !== 'superagent') throw new WorkbenchAccessError('invalid-operation', 'context writer is invalid', 400)
  const section = payload.section
  if (section !== 'human' && section !== 'agent') throw new WorkbenchAccessError('invalid-operation', 'context section is invalid', 400)
  const expectedRevision = payload.expectedContextRevision
  if (typeof expectedRevision !== 'number' || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw new WorkbenchAccessError('invalid-operation', 'expectedContextRevision is invalid', 400)
  return {
    scope,
    ...(typeof payload.areaId === 'string' ? { areaId: payload.areaId } : {}),
    ...(typeof payload.projectId === 'string' ? { projectId: payload.projectId } : {}),
    writer, section, expectedRevision,
    patch: commandRecord(payload.patch, 'context patch'),
  }
}

/**
 * Execute transport-neutral Workbench commands. Every mutation goes through
 * the Host directory CAS seam so desktop, browser-owner, and LAN participants
 * observe the same durable fact and revision. Session execution and task
 * runtime operations remain on DSH's native Host session path.
 */
export async function executeWorkbenchCollaborationCommand(access: HostWorkbenchAccess, input: {
  readonly workbenchId: string
  readonly operation: Extract<WorkbenchCommandV1, { kind: 'workbench.command' }>
}): Promise<unknown> {
  const operation = input.operation
  const payload = commandPayload(operation)
  const workbenchId = input.workbenchId
  if (operation.operation === 'snapshot') return access.collaborationSeed(workbenchId)
  if (operation.operation === 'memory.list') {
    if (access.memory === undefined) throw new WorkbenchAccessError('command-unavailable', 'Workbench memory is unavailable', 503)
    return access.memory.list(workbenchId, typeof payload.query === 'string' ? payload.query : '', typeof payload.areaId === 'string' ? payload.areaId : undefined).map(entry => redactMemoryEntry(access, workbenchId, entry))
  }
  if (operation.operation === 'memory.read') {
    if (access.memory === undefined) throw new WorkbenchAccessError('command-unavailable', 'Workbench memory is unavailable', 503)
    const id = commandText(payload.id, 'id', 120)
    return redactMemoryBody(access, workbenchId, access.memory.read(workbenchId, id, payload.revision === undefined ? undefined : Number(payload.revision)))
  }
  if (operation.operation === 'memory.write') {
    if (access.memory === undefined) throw new WorkbenchAccessError('command-unavailable', 'Workbench memory is unavailable', 503)
    const result = access.memory.write(workbenchId, memoryWritePayload(payload.entry), 'human')
    return result.status === 'committed' ? { ...result, ...redactMemoryBody(access, workbenchId, result) } : result
  }
  if (operation.operation === 'task.list') {
    if (access.taskRuntime === undefined) throw new WorkbenchAccessError('command-unavailable', 'Workbench task runtime is unavailable', 503)
    return access.taskRuntime.snapshot(workbenchId)
  }
  if (operation.operation === 'task.create') {
    if (access.taskRuntime === undefined) throw new WorkbenchAccessError('command-unavailable', 'Workbench task runtime is unavailable', 503)
    const input = commandRecord(payload.input, 'input')
    return access.taskRuntime.request(workbenchId, { action: 'create', input: structuredClone(input) })
  }
  if (operation.operation === 'task.action') {
    if (access.taskRuntime === undefined) throw new WorkbenchAccessError('command-unavailable', 'Workbench task runtime is unavailable', 503)
    const id = commandText(payload.id, 'id', 160), action = payload.action
    if (!['accept', 'start', 'recover', 'stop', 'answer', 'dismiss'].includes(String(action))) throw new WorkbenchAccessError('invalid-operation', 'task action is invalid', 400)
    return access.taskRuntime.request(workbenchId, { action: String(action), id, ...(payload.answer === undefined ? {} : { answer: commandText(payload.answer, 'answer', 20_000) }) })
  }
  if (operation.operation === 'workbench.rename') {
    const name = commandText(payload.name, 'name')
    const duplicate = Object.values(access.directory.getSnapshot().value.workbenches).some(value => value.workbenchId !== workbenchId && value.name.normalize('NFKC').trim().toLocaleLowerCase('zh-CN') === name.toLocaleLowerCase('zh-CN'))
    if (duplicate) throw new WorkbenchAccessError('invalid-operation', 'A Workbench with this name already exists', 409)
    const record = structuredClone(access.getRecord(workbenchId))
    const expectedRevision = directoryRevision(access, payload)
    record.name = name
    await patchWorkbenchRecord(access, workbenchId, record, expectedRevision)
    return { workbenchId, name, revision: access.directory.getSnapshot().revision }
  }
  if (operation.operation === 'area.create') {
    const record = structuredClone(access.getRecord(workbenchId))
    const areaId = typeof payload.areaId === 'string' ? commandText(payload.areaId, 'areaId', 160) : `area-${randomUUID()}`
    if (areasOf(record.document.root).some(area => area.areaId === areaId)) throw new WorkbenchAccessError('invalid-operation', 'area already exists', 409)
    const area = { kind: 'area' as const, areaId, moduleHistory: [] }
    const currentAreas = areasOf(record.document.root)
    const root = currentAreas.length === 0
      ? area
      : { kind: 'split' as const, id: `split-${randomUUID()}`, axis: 'horizontal' as const, ratio: 0.5, first: record.document.root, second: area }
    record.document = normalizeWorkbenchDocument({ ...record.document, root, activeAreaId: areaId })
    record.areaMetadata = {
      ...(record.areaMetadata ?? {}),
      [areaId]: {
        label: typeof payload.label === 'string' ? commandText(payload.label, 'label') : `Area ${currentAreas.length + 1}`,
        ownership: payload.ownership === 'shared' || payload.ownership === 'bay-agent-managed' || payload.ownership === 'superagent-managed' ? payload.ownership : 'user-owned',
        createdAt: Date.now(), updatedAt: Date.now(),
      },
    }
    const expectedRevision = directoryRevision(access, payload)
    await patchWorkbenchRecord(access, workbenchId, record, expectedRevision)
    return { areaId, revision: access.directory.getSnapshot().revision }
  }
  if (operation.operation === 'area.show') {
    const areaId = commandText(payload.areaId, 'areaId', 160)
    const expectedRevision = directoryRevision(access, payload)
    const result = await access.directory.showArea(workbenchId, areaId, expectedRevision)
    if (result.status === 'conflict') throw new WorkbenchAccessError('revision-conflict', 'Workbench directory changed', 409)
    return { areaId, revision: access.directory.getSnapshot().revision }
  }
  if (operation.operation === 'area.archive') {
    const areaId = commandText(payload.areaId, 'areaId', 160)
    const record = structuredClone(access.getRecord(workbenchId))
    if (!areasOf(record.document.root).some(area => area.areaId === areaId)) throw new WorkbenchAccessError('invalid-operation', 'area does not belong to this Workbench', 404)
    const current = record.areaMetadata?.[areaId]
    record.areaMetadata = {
      ...(record.areaMetadata ?? {}),
      [areaId]: { label: current?.label ?? areaId, ownership: 'archived', createdAt: current?.createdAt ?? Date.now(), updatedAt: Date.now(), archivedAt: Date.now() },
    }
    const expectedRevision = directoryRevision(access, payload)
    await patchWorkbenchRecord(access, workbenchId, record, expectedRevision)
    return { areaId, archived: true, revision: access.directory.getSnapshot().revision }
  }
  if (operation.operation === 'session.rename') {
    const sessionId = commandText(payload.sessionId, 'sessionId', 320)
    const title = commandText(payload.title, 'title')
    const expectedRevision = directoryRevision(access, payload)
    try {
      const result = await access.directory.renameSession(workbenchId, sessionId, title, expectedRevision)
      if (result.status === 'conflict') throw new WorkbenchAccessError('revision-conflict', 'Workbench directory changed', 409)
    } catch (error) {
      if (error instanceof WorkbenchAccessError) throw error
      throw new WorkbenchAccessError('invalid-operation', error instanceof Error ? error.message : 'session does not belong to this Workbench', 404)
    }
    return { sessionId, title, revision: access.directory.getSnapshot().revision }
  }
  if (operation.operation === 'project.bind') {
    const areaId = commandText(payload.areaId, 'areaId', 160)
    const projectId = commandText(payload.projectId, 'projectId', 320)
    const record = structuredClone(access.getRecord(workbenchId))
    const project = record.projects?.[projectId]
    if (project === undefined) throw new WorkbenchAccessError('invalid-operation', 'project does not belong to this Workbench', 404)
    if (!areasOf(record.document.root).some(area => area.areaId === areaId)) throw new WorkbenchAccessError('invalid-operation', 'area does not belong to this Workbench', 404)
    const expectedRevision = directoryRevision(access, payload)
    const result = await access.directory.bindArea({ workbenchId, areaId, relativePath: project.relativePath, expectedRevision })
    if (result.status === 'conflict') throw new WorkbenchAccessError('revision-conflict', 'Workbench directory changed', 409)
    return { areaId, projectId, revision: access.directory.getSnapshot().revision }
  }
  if (operation.operation === 'project.open') {
    if (typeof payload.projectId === 'string') {
      const requestId = commandText(payload.requestId ?? `${workbenchId}:project-open`, 'requestId', 180)
      const expectedRevision = directoryRevision(access, payload)
      const result = await access.directory.openProject({ workbenchId, projectId: commandText(payload.projectId, 'projectId', 320), requestId, expectedRevision })
      if (result.status === 'conflict') throw new WorkbenchAccessError('revision-conflict', 'Workbench directory changed', 409)
      return result
    }
    const areaId = commandText(payload.areaId, 'areaId', 160)
    const record = access.getRecord(workbenchId)
    const area = areasOf(record.document.root).find(value => value.areaId === areaId)
    if (area === undefined) throw new WorkbenchAccessError('invalid-operation', 'area does not belong to this Workbench', 404)
    const project = record.areaProjects?.[areaId]
    if (project === undefined) throw new WorkbenchAccessError('invalid-operation', 'area has no project', 404)
    return { areaId, project: structuredClone(project), projectDefinition: project.projectId === undefined ? undefined : structuredClone(record.projects?.[project.projectId]) }
  }
  if (operation.operation === 'context.write') {
    const input = contextWritePayload(payload)
    const snapshot = access.directory.getSnapshot()
    const record = structuredClone(access.getRecord(workbenchId))
    let next = record
    let value: unknown
    if (input.scope === 'workbench') {
      const result = input.section === 'human'
        ? patchWorkbenchContext(workbenchContextOf(record.context), { writer: input.writer, section: 'human', expectedRevision: input.expectedRevision, patch: input.patch as never })
        : patchWorkbenchContext(workbenchContextOf(record.context), { writer: input.writer, section: 'agent', expectedRevision: input.expectedRevision, patch: input.patch as never })
      if (result.status === 'conflict') throw new WorkbenchAccessError('revision-conflict', 'Workbench context changed', 409)
      if (result.status !== 'committed') throw new WorkbenchAccessError('invalid-operation', result.reason, 400)
      next = { ...record, context: result.context }
      value = result.context
    } else if (input.scope === 'project') {
      const projectId = input.projectId
      if (projectId === undefined || record.projects?.[projectId] === undefined) throw new WorkbenchAccessError('invalid-operation', 'project does not belong to this Workbench', 404)
      const project = record.projects[projectId]!
      const result = input.section === 'human'
        ? patchAreaContext(areaContextOf(project.context), { writer: input.writer, section: 'human', expectedRevision: input.expectedRevision, patch: input.patch as never })
        : patchAreaContext(areaContextOf(project.context), { writer: input.writer, section: 'agent', expectedRevision: input.expectedRevision, patch: input.patch as never })
      if (result.status === 'conflict') throw new WorkbenchAccessError('revision-conflict', 'Project context changed', 409)
      if (result.status !== 'committed') throw new WorkbenchAccessError('invalid-operation', result.reason, 400)
      next = { ...record, projects: { ...(record.projects ?? {}), [projectId]: { ...project, context: result.context } } }
      value = result.context
    } else {
      const areaId = input.areaId
      if (areaId === undefined || !areasOf(record.document.root).some(area => area.areaId === areaId)) throw new WorkbenchAccessError('invalid-operation', 'area does not belong to this Workbench', 404)
      const result = input.section === 'human'
        ? patchAreaContext(areaContextOf(record.areaContexts?.[areaId]), { writer: input.writer, section: 'human', expectedRevision: input.expectedRevision, patch: input.patch as never })
        : patchAreaContext(areaContextOf(record.areaContexts?.[areaId]), { writer: input.writer, section: 'agent', expectedRevision: input.expectedRevision, patch: input.patch as never })
      if (result.status === 'conflict') throw new WorkbenchAccessError('revision-conflict', 'Area context changed', 409)
      if (result.status !== 'committed') throw new WorkbenchAccessError('invalid-operation', result.reason, 400)
      next = { ...record, areaContexts: { ...(record.areaContexts ?? {}), [areaId]: result.context } }
      value = result.context
    }
    const expectedRevision = directoryRevision(access, payload)
    await patchWorkbenchRecord(access, workbenchId, next, expectedRevision)
    return { value, revision: access.directory.getSnapshot().revision }
  }
  if (operation.operation === 'directory.patch') {
    const patch = payload.patch as DirectoryPatch | undefined
    if (!patch || !Array.isArray(patch.path) || patch.path[0] !== 'workbenches' || patch.path[1] !== workbenchId) throw new WorkbenchAccessError('workbench-scope-denied', '目录修改不属于当前工作台。', 403)
    const expectedRevision = operation.expectedRevision ?? access.directory.getSnapshot().revision
    const result = await access.directory.patch({ ...patch, expectedRevision })
    if (result.status === 'conflict') throw new WorkbenchAccessError('revision-conflict', '工作台目录已发生变化，请重新同步后重试。', 409)
    return result
  }
  if (operation.operation === 'project.read') {
    const relativePath = payload.relativePath
    if (typeof relativePath !== 'string') throw new WorkbenchAccessError('invalid-operation', '缺少工作台相对路径。', 400)
    const bytes = await access.directory.readProjectFile(workbenchId, relativePath)
    return { relativePath, bytes: Buffer.from(bytes).toString('base64'), hash: contentHash(bytes) }
  }
  if (operation.operation === 'project.write') {
    const relativePath = payload.relativePath, encoded = payload.bytes
    if (typeof relativePath !== 'string' || typeof encoded !== 'string') throw new WorkbenchAccessError('invalid-operation', '文件写入缺少路径或内容。', 400)
    const bytes = Buffer.from(encoded, 'base64')
    if (typeof payload.expectedHash === 'string') {
      const current = await access.directory.readProjectFile(workbenchId, relativePath)
      if (contentHash(current) !== payload.expectedHash) throw new WorkbenchAccessError('file-conflict', '文件已被其他参与者修改，请重新读取后重试。', 409)
    }
    await access.directory.writeProjectFile(workbenchId, relativePath, bytes)
    return { relativePath, bytes: bytes.byteLength, hash: contentHash(bytes) }
  }
  if (operation.operation === 'project.entries') {
    const areaId = payload.areaId
    if (typeof areaId !== 'string') throw new WorkbenchAccessError('invalid-operation', '缺少项目区域身份。', 400)
    return access.directory.projectEntries(workbenchId, areaId, typeof payload.relativePath === 'string' ? payload.relativePath : '')
  }
  if (operation.operation === 'project.preview') {
    const areaId = payload.areaId, relativePath = payload.relativePath
    if (typeof areaId !== 'string' || typeof relativePath !== 'string') throw new WorkbenchAccessError('invalid-operation', '缺少项目预览路径。', 400)
    return access.directory.projectPreview(workbenchId, areaId, relativePath)
  }
  throw new WorkbenchAccessError('command-unavailable', `Host 尚未安装工作台命令：${operation.operation}`, 501)
}

/** The Host owns access identities; transports never supply trusted role or grant fields. */
export class HostWorkbenchAccess {
  private readonly leases = new Map<string, Lease>()
  private readonly tokens = new Map<string, string>()
  private readonly owners = new Map<string, { accessId: string; epoch: number }>()
  private epoch = 0
  private readonly barriers = new Set<string>()
  private readonly writes = new Map<string, Set<Promise<unknown>>>()
  private readonly snapshotParticipants = new Set<(id: string) => Promise<() => void | Promise<void>>>()
  private readonly revokeListeners = new Set<(id: string) => void>()
  private readonly definitions = new Map<string, { stamp: string; valid: boolean }>()
  private taskRuntimeValue: HostWorkbenchTaskRuntime | undefined

  constructor(readonly directory: HostWorkbenchDirectory, readonly memory?: HostWorkbenchMemory) {}

  get taskRuntime(): HostWorkbenchTaskRuntime | undefined { return this.taskRuntimeValue }
  setTaskRuntime(runtime: HostWorkbenchTaskRuntime | undefined): void {
    this.taskRuntimeValue = runtime
  }
  subscribeTaskChanges(workbenchId: string, listener: (tasks: readonly unknown[]) => void): (() => void) | undefined {
    return this.taskRuntimeValue?.subscribe?.(workbenchId, listener)
  }

  lookup(workbenchId: string): boolean {
    const record = this.directory.getSnapshot().value.workbenches[workbenchId]
    if (!record || record.archivedAt !== undefined || typeof record.fileWorkbench?.rootPath !== 'string') return false
    try {
      const file = path.join(record.fileWorkbench.rootPath, '.bay', 'workbench.json'), stat = statSync(file)
      const stamp = [file, stat.mtimeMs, stat.ctimeMs, stat.size, stat.ino].join(':')
      const prior = this.definitions.get(workbenchId)
      if (prior?.stamp === stamp) return prior.valid
      const data = JSON.parse(readFileSync(file, 'utf8'))
      const valid = [1, 2].includes(Number(data?.schemaVersion)) && data.record?.workbenchId === workbenchId && data.record?.document?.version === 3
      this.definitions.set(workbenchId, { stamp, valid })
      return valid
    } catch { return false }
  }
  getRecord(workbenchId: string) {
    if (!this.lookup(workbenchId)) throw new WorkbenchAccessError('workbench-unavailable', '工作台目录丢失、已归档或定义损坏，请在 DSH 中检查目录和 .bay/workbench.json。', 404)
    return this.directory.getSnapshot().value.workbenches[workbenchId]!
  }
  sessionTarget(sessionId: string): WorkbenchAccessTarget | undefined {
    for (const record of Object.values(this.directory.getSnapshot().value.workbenches)) {
      const entry = Object.values(record.sessionCatalog ?? {}).find(row => row.sessionId === sessionId)
      if (entry) return { workbenchId: record.workbenchId, sessionId, ...(entry.areaId ? { areaId: entry.areaId } : {}) }
      if (record.bayAgentSession?.sessionId === sessionId) return { workbenchId: record.workbenchId, sessionId }
    }
    return undefined
  }
  private install(context: WorkbenchAccessContext, active: () => boolean, token = randomBytes(32).toString('base64url')) {
    this.revoke(context.accessId)
    const tokenHash = hash(token)
    this.leases.set(context.accessId, { context: Object.freeze(context), active, tokenHash })
    this.tokens.set(tokenHash, context.accessId)
    return token
  }
  registerOwner(accessId: string, workbenchId: string, active: () => boolean, token?: string, writable?: (capability: WorkbenchCapability) => boolean) {
    this.getRecord(workbenchId)
    const previous = this.owners.get(workbenchId)
    if (previous) this.revoke(previous.accessId)
    const epoch = ++this.epoch
    const credential = this.install({ actor: 'browser-owner', accessId, workbenchId, controlEpoch: epoch }, active, token)
    if (writable) this.leases.get(accessId)!.writable = writable
    this.owners.set(workbenchId, { accessId, epoch })
    return credential
  }
  registerGuest(accessId: string, workbenchId: string, grant: WorkbenchGrant, getActive: () => boolean, identity: { readonly collaborationId?: string; readonly displayName?: string } = {}) {
    this.getRecord(workbenchId)
    return this.install({ actor: 'lan-guest', accessId, workbenchId, participantId: accessId, ...identity, grantRevision: 1, grant: parseWorkbenchGrant(grant) }, getActive)
  }
  reduceGuest(accessId: string, grant: WorkbenchGrant) {
    const lease = this.leases.get(accessId), next = parseWorkbenchGrant(grant)
    if (!lease || lease.context.actor !== 'lan-guest' || !isGrantReduction(lease.context.grant!, next)) throw new WorkbenchAccessError('grant-expansion-denied', '扩大权限需要重新建立分享。')
    lease.context = Object.freeze({ ...lease.context, grant: next, grantRevision: lease.context.grantRevision! + 1 })
    for (const notify of this.revokeListeners) notify(accessId)
  }
  getContext(accessId: string): WorkbenchAccessContext {
    if (accessId === 'desktop') return DESKTOP
    const lease = this.leases.get(accessId)
    if (!lease || !lease.active()) { this.revoke(accessId); throw new WorkbenchAccessError('access-expired', '访问已结束，请重新打开工作台。', 401) }
    return lease.context
  }
  resolve(headers: Headers): WorkbenchAccessContext {
    const token = headers.get(WORKBENCH_ACCESS_HEADER) ?? headers.get('cookie')?.split(';').map(value => value.trim()).find(value => value.startsWith('bay-browser-access='))?.slice('bay-browser-access='.length) ?? null
    if (token === null) return DESKTOP
    const id = this.tokens.get(hash(token))
    if (!id) throw new WorkbenchAccessError('access-expired', '访问凭证已失效。', 401)
    return this.getContext(id)
  }
  onRevoke(listener: (id: string) => void) { this.revokeListeners.add(listener); return () => { this.revokeListeners.delete(listener) } }
  revoke(accessId: string) {
    const lease = this.leases.get(accessId)
    if (!lease) return
    this.leases.delete(accessId); this.tokens.delete(lease.tokenHash)
    if (lease.context.workbenchId && this.owners.get(lease.context.workbenchId)?.accessId === accessId) this.owners.delete(lease.context.workbenchId)
    for (const notify of this.revokeListeners) notify(accessId)
  }
  controller(workbenchId: string): 'desktop' | 'browser' {
    const owner = this.owners.get(workbenchId)
    if (owner) { try { this.getContext(owner.accessId); return 'browser' } catch { /* revoke stale owner */ } }
    return 'desktop'
  }
  capabilities(context: WorkbenchAccessContext): readonly WorkbenchCapability[] { return context.actor === 'lan-guest' ? this.getContext(context.accessId).grant!.capabilities : ALL }

  authorize(context: WorkbenchAccessContext, capability: WorkbenchCapability, target: WorkbenchAccessTarget): void {
    this.checkAuthorization(context, capability, target, false)
  }
  /** Only the native snapshot participant may drain execution accepted before its barrier. */
  authorizeAcceptedExecution(context: WorkbenchAccessContext, capability: WorkbenchCapability, target: WorkbenchAccessTarget): void {
    this.checkAuthorization(context, capability, target, true)
  }
  private checkAuthorization(context: WorkbenchAccessContext, capability: WorkbenchCapability, target: WorkbenchAccessTarget, acceptedExecution: boolean): void {
    const current = this.getContext(context.accessId)
    if (current.workbenchId !== undefined && current.workbenchId !== target.workbenchId) throw new WorkbenchAccessError('workbench-scope-denied', '此访问只允许当前工作台。')
    if (context.grantRevision !== current.grantRevision || context.controlEpoch !== current.controlEpoch) throw new WorkbenchAccessError('access-revision-conflict', '访问权限已变化，请刷新后重试。', 409)
    const record = this.getRecord(target.workbenchId)
    const read = capability === 'view' || capability === 'read-files'
    if (!read && current.actor === 'browser-owner' && this.leases.get(current.accessId)?.writable?.(capability) === false) throw new WorkbenchAccessError('browser-not-ready', '浏览器正在交接，请完成交接后再操作。', 409)
    if (!read && !acceptedExecution && this.barriers.has(target.workbenchId)) throw new WorkbenchAccessError('snapshot-in-progress', '正在生成工作台快照，请稍后重试。', 423)
    if (!read && current.actor === 'desktop' && this.controller(target.workbenchId) === 'browser') throw new WorkbenchAccessError('browser-controls-workbench', '此工作台由浏览器控制，请先收回。', 409)
    if (target.sessionId) {
      const actual = this.sessionTarget(target.sessionId)
      if (!actual || actual.workbenchId !== target.workbenchId || target.areaId && target.areaId !== actual.areaId && !(record.projectModelVersion && Object.values(record.sessionCatalog ?? {}).some(entry => entry.sessionId === target.sessionId && entry.projectId === record.areaProjects?.[target.areaId!]?.projectId))) throw new WorkbenchAccessError('session-scope-denied', '会话不属于指定工作台或区域。')
      if (current.actor === 'lan-guest' && capability === 'message') {
        const main = record.bayAgentSession?.sessionId === target.sessionId || Object.values(record.sessionCatalog ?? {}).some(row => row.sessionId === target.sessionId && row.role === 'main')
        if (main && !current.grant!.capabilities.includes('main-message')) throw new WorkbenchAccessError('main-message-denied', '主控未授权向 Bay Agent 发送消息。')
      }
    }
    if (current.actor !== 'lan-guest') return
    const grant = current.grant!
    if (!grant.capabilities.includes(capability)) throw new WorkbenchAccessError('capability-denied', '此操作需要主控授权：' + capability)
    if (target.relativePath !== undefined) {
      const relative = target.relativePath
      if (relative.startsWith('/') || relative.includes('\\') || relative.split('/').some(part => part === '..' || part.toLowerCase() === '.bay') || /[\u0000-\u001f:]/u.test(relative)) throw new WorkbenchAccessError('path-scope-denied', '文件路径不在授权范围内。')
      const root = realpathSync(record.fileWorkbench!.rootPath!), absolute = path.resolve(root, relative)
      let existing = absolute
      while (!existsSync(existing) && path.dirname(existing) !== existing) existing = path.dirname(existing)
      const resolved = path.resolve(realpathSync(existing), path.relative(existing, absolute))
      const actual = path.relative(root, resolved).split(path.sep).join('/')
      // The lexical path is inside the Workbench; the resolved one must be
      // too, otherwise a symlink or junction leads out of the shared root or
      // into the Host-private `.bay` directory.
      if (actual === '..' || actual.startsWith('../') || path.isAbsolute(actual) || actual.split('/').some(part => part.toLowerCase() === '.bay')) throw new WorkbenchAccessError('path-scope-denied', '文件链接目标不在工作台内。')
    }
  }
  /** Build the full, redacted Workbench seed used by shared-control sessions. */
  collaborationSeed(workbenchId: string): WorkbenchCollaborationSeedV1 {
    const source = structuredClone(this.getRecord(workbenchId))
    const definition = source as typeof source & { fileWorkbench?: { rootPath?: string } }
    if (definition.fileWorkbench) delete definition.fileWorkbench.rootPath
    const areas = areasOf(source.document.root)
    const editors = areas.flatMap(area => area.moduleHistory.map(page => ({
      areaId: area.areaId,
      moduleInstanceId: page.moduleInstanceId,
      editorId: page.editorId,
      state: structuredClone(page.state),
      ...(page.binding === undefined ? {} : { binding: structuredClone(page.binding) }),
    })))
    return {
      definition,
      areas: structuredClone(areas),
      editors,
      projects: Object.values(source.projects ?? {}).map(value => structuredClone(value)),
      sessions: Object.values(source.sessionCatalog ?? {}).map(value => structuredClone(value)),
      contexts: [
        ...(source.context === undefined ? [] : [structuredClone(source.context)]),
        ...Object.values(source.areaContexts ?? {}).map(value => structuredClone(value)),
      ],
      tasks: this.taskRuntime?.snapshot(workbenchId) ?? [],
      memories: this.memory?.list(workbenchId).map(entry => redactMemoryEntry(this, workbenchId, entry)) ?? [],
      // The durable Workbench document is the initial shared canvas layout.
      // Live collaboration may replace it through canvas commands, while
      // directory changes refresh it for every connected participant.
      sharedCanvas: { layout: projectDocumentV3ToLayoutV2(source.document, source.areaProjects) },
      drafts: {},
    }
  }

  /**
   * Persist a collaboration layout through the same atomic directory writer
   * used by the desktop surface. The caller supplies the layout projection
   * consumed by the shared canvas; it is validated and converted back to the
   * durable v3 document before the patch is committed.
   */
  async persistCollaborationLayout(workbenchId: string, layout: unknown) {
    const shape = layout as { version?: unknown; root?: unknown; activeGroupId?: unknown } | null
    if (typeof shape !== 'object' || shape === null || shape.version !== 2 || typeof shape.root !== 'object' || shape.root === null || typeof shape.activeGroupId !== 'string') {
      throw new WorkbenchAccessError('invalid-layout', '共享布局无效，无法保存。', 400)
    }
    let document: ReturnType<typeof migrateDocumentV2ToV3>
    try { document = migrateDocumentV2ToV3(structuredClone(layout) as Parameters<typeof migrateDocumentV2ToV3>[0]) }
    catch { throw new WorkbenchAccessError('invalid-layout', '共享布局无法转换为工作台定义。', 400) }
    if (!validateWorkbenchDocumentV3(document)) throw new WorkbenchAccessError('invalid-layout', '共享布局无法转换为工作台定义。', 400)
    const snapshot = this.directory.getSnapshot()
    const record = snapshot.value.workbenches[workbenchId]
    if (record === undefined) throw new WorkbenchAccessError('workbench-unavailable', '工作台不存在。', 404)
    const next = structuredClone(record)
    next.document = document
    const result = await this.directory.patch({
      operation: 'set',
      path: ['workbenches', workbenchId],
      expectedRevision: snapshot.revision,
      value: next,
    })
    if (result.status === 'conflict') throw new WorkbenchAccessError('revision-conflict', '工作台已经发生变化，请重新同步后再保存布局。', 409)
    return result
  }
  snapshot(context: WorkbenchAccessContext): FileWorkbenchSnapshot {
    const source = this.directory.getSnapshot()
    if (!context.workbenchId) return source
    this.authorize(context, 'view', { workbenchId: context.workbenchId })
    const record = structuredClone(this.getRecord(context.workbenchId))
    // Browser-owner and LAN shared-control participants consume the same
    // redacted Workbench fact. There is no guest projection or editor allowlist.
    if (context.actor === 'lan-guest' && record.fileWorkbench) delete record.fileWorkbench.rootPath
    const ownerGlobals = context.actor === 'browser-owner' || context.grant?.template === 'shared-control' ? {
      ...(source.value.globalHiddenEditorIds === undefined ? {} : { globalHiddenEditorIds: [...source.value.globalHiddenEditorIds] }),
      ...(source.value.editorMenu === undefined ? {} : { editorMenu: structuredClone(source.value.editorMenu) }),
      ...(source.value.extensionConsents === undefined ? {} : { extensionConsents: structuredClone(source.value.extensionConsents) }),
    } : {}
    return { ...source, writable: context.actor !== 'lan-guest' || this.capabilities(context).some(c => ['layout', 'context', 'tasks'].includes(c)), value: {
      version: 4, activeWorkbenchId: context.workbenchId, openWorkbenchIds: [context.workbenchId], workbenches: { [context.workbenchId]: record }, invalidWorkbenches: {}, layoutTemplates: {}, sessionMarkers: {},
      ...ownerGlobals,
      ...(context.actor === 'browser-owner' && source.value.backgroundAi ? { backgroundAi: source.value.backgroundAi } : {}),
    } }
  }
  async run<T>(context: WorkbenchAccessContext, capability: WorkbenchCapability, target: WorkbenchAccessTarget, operation: () => Promise<T>): Promise<T> {
    this.authorize(context, capability, target)
    const set = this.writes.get(target.workbenchId) ?? new Set<Promise<unknown>>()
    this.writes.set(target.workbenchId, set)
    const result = operation(); set.add(result)
    try { return await result } finally { set.delete(result) }
  }
  registerSnapshotParticipant(participant: (id: string) => Promise<() => void | Promise<void>>) { this.snapshotParticipants.add(participant); return () => { this.snapshotParticipants.delete(participant) } }
  async withSnapshot<T>(workbenchId: string, operation: () => Promise<T>): Promise<T> {
    if (this.barriers.has(workbenchId)) throw new WorkbenchAccessError('snapshot-in-progress', '已有快照作业正在进行。', 423)
    this.barriers.add(workbenchId)
    const releases: (() => void | Promise<void>)[] = []
    try {
      for (const participant of this.snapshotParticipants) releases.push(await participant(workbenchId))
      await Promise.all(this.writes.get(workbenchId) ?? [])
      return await operation()
    } finally {
      try { for (const release of releases.reverse()) { try { await release() } catch { /* Always release the remaining participants and the write barrier. */ } } }
      finally { this.barriers.delete(workbenchId) }
    }
  }
  isSnapshotting(workbenchId: string) { return this.barriers.has(workbenchId) }
  dispose() { for (const id of [...this.leases.keys()]) this.revoke(id); this.snapshotParticipants.clear(); this.revokeListeners.clear() }
}
