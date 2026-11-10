import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, openSync, closeSync, fsyncSync, unlinkSync } from 'node:fs'
import { mkdir, realpath, readdir, stat, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import type { WorkspaceRegistry } from '@deepseek-ai/dsh-workspace'
import { areasOf, validateWorkbenchDocumentV3 } from './foundation/document-v3.ts'
import type { WorkbenchRecordV2, WorkbenchSettingsV4 } from './foundation/persistence.ts'
import { renderWorkbenchContextMarkdown, renderAreaContextMarkdown, workbenchContextOf, areaContextOf } from './foundation/workbench-context.ts'
import { portableRelativePath, resolvePortablePath } from './host-native-session-portability.ts'
import type { CreatorRepairProjectV1, CreatorRepairTargetV1, DirectoryPatch, FileWorkbenchSnapshot, FileWorkbenchV1, WorkbenchSessionEntryV1 } from './workbench-directory-contract.ts'
import { acquireFileLock } from './host-file-lock.ts'
import { workbenchAreas, showWorkbenchArea, validateWorkbenchRelations } from './foundation/area-identity.ts'
import { discoverProject, hydrateProjects, projectWrites, upgradeProjectOwnership, type ProjectWrite } from './host-workbench-projects.ts'

interface Registration { rootPath: string; workspaces: Record<string, string>; sessions: Record<string, string>; creatorRepairs?: Record<string, string>; sessionRequests?: Record<string, { areaId: string; relativePath: string; agentPreset: string; sessionId: string }> }
interface Registry {
  schemaVersion: 1
  revision: number
  registrations: Record<string, Registration>
  preferences: Omit<WorkbenchSettingsV4, 'workbenches'>
  requests: Record<string, { workbenchId: string; parentPath: string; folderName: string }>
}
const clone = <T>(value: T): T => structuredClone(value)
const filename = (root: string) => path.join(root, '.bay', 'workbench.json')
const safeId = (value: string) => /^[A-Za-z0-9][A-Za-z0-9._-]{0,180}$/u.test(value)
export function atomicJson(file: string, value: unknown): void {
  mkdirSync(path.dirname(file), { recursive: true })
  const temporary = file + '.' + randomUUID() + '.tmp'
  const handle = openSync(temporary, 'wx')
  try { writeFileSync(handle, JSON.stringify(value, null, 2) + '\n', 'utf8'); fsyncSync(handle) } finally { closeSync(handle) }
  renameSync(temporary, file)
}
function readJson<T>(file: string): T { return JSON.parse(readFileSync(file, 'utf8')) as T }

/** One Host writer owns file definitions; the profile only contains registrations and preferences. */
export class HostWorkbenchDirectory {
  private registry: Registry
  private records = new Map<string, FileWorkbenchV1>()
  private snapshot: FileWorkbenchSnapshot
  private tail: Promise<unknown> = Promise.resolve()
  private readonly registryFile: string
  private readonly journalFile: string
  private readonly listeners = new Set<() => void>()
  private areaHasTasks: (workbenchId: string, areaId: string) => boolean = () => false

  constructor(profile: string, private readonly workspaces: Pick<WorkspaceRegistry, 'create'>,
    legacy?: WorkbenchSettingsV4) {
    this.registryFile = path.join(profile, '.dsh-workbench', 'directory-v1', 'registry.json')
    this.journalFile = path.join(profile, '.dsh-workbench', 'directory-v1', 'commit.json')
    const releaseRegistry = acquireFileLock(this.registryFile + '.lock')
    try {
    this.recoverCommit()
    if (existsSync(this.registryFile)) {
      this.registry = readJson<Registry>(this.registryFile)
      if (this.registry.schemaVersion !== 1) throw new Error('不支持的工作台目录登记版本。')
    } else {
      const { workbenches: old = {}, migrationRequired: _migration, ...preferences } = legacy ?? { version: 4, activeWorkbenchId: '', openWorkbenchIds: [], workbenches: {}, invalidWorkbenches: {}, layoutTemplates: {}, sessionMarkers: {} }
      this.registry = { schemaVersion: 1, revision: 0, registrations: {}, requests: {}, preferences: { ...preferences, activeWorkbenchId: '', openWorkbenchIds: [], layoutTemplates: {}, invalidWorkbenches: {
        ...preferences.invalidWorkbenches, ...Object.fromEntries(Object.entries(old).map(([id, record]) => [id, { workbenchId: id, name: record.name, description: '17.x 工作台格式不受 18.0 支持；原数据已保留。', rawRecord: record }])) },
      } }
      atomicJson(this.registryFile, this.registry)
    }
    for (const [id, registration] of Object.entries(this.registry.registrations)) {
      try {
        let envelope = readJson<FileWorkbenchV1>(filename(registration.rootPath))
        this.validate(envelope.record)
        if (![1, 2].includes(envelope.schemaVersion) || envelope.record.workbenchId !== id) throw new Error('工作台身份或版本不匹配。')
        if (envelope.schemaVersion === 1) {
          const releaseRoot = acquireFileLock(path.join(registration.rootPath, '.bay', 'writer.lock'))
          try {
          const upgraded = upgradeProjectOwnership(registration.rootPath, envelope.record)
          const backup = { file: path.join(registration.rootPath, '.bay', 'upgrades', 'project-ownership-v1', 'workbench.json'), value: envelope }
          envelope = { schemaVersion: 2, revision: envelope.revision + 1, record: this.portable(this.reconcileAreas(upgraded.record), registration) }
          this.registry.revision++
          this.commit(this.registry, [backup, ...upgraded.writes, { file: filename(registration.rootPath), value: envelope }])
          } finally { releaseRoot() }
        }
        this.records.set(id, envelope)
      } catch (error) {
        this.registry.preferences.invalidWorkbenches[id] = { workbenchId: id, name: id, description: '工作台目录不可读取，请重新定位。', rawRecord: { rootPath: registration.rootPath, diagnostic: String(error) } }
      }
    }
    this.snapshot = this.project()
    } finally { releaseRegistry() }
  }
  getSnapshot = (): FileWorkbenchSnapshot => this.snapshot
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  private publish() { this.snapshot = this.project(); for (const listener of this.listeners) listener() }
  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.tail.then(async () => {
      const release = acquireFileLock(this.registryFile + '.lock'), roots: (() => void)[] = []
      try {
        this.recoverCommit()
        const latest = readJson<Registry>(this.registryFile)
        const changed = latest.revision !== this.registry.revision
        this.registry = latest
        for (const [id, registration] of Object.entries(latest.registrations).sort(([a], [b]) => a.localeCompare(b))) {
          if (!existsSync(filename(registration.rootPath))) continue
          roots.push(acquireFileLock(path.join(registration.rootPath, '.bay', 'writer.lock')))
          this.records.set(id, readJson<FileWorkbenchV1>(filename(registration.rootPath)))
        }
        for (const id of this.records.keys()) if (!latest.registrations[id]) this.records.delete(id)
        this.snapshot = this.project()
        if (changed) for (const listener of this.listeners) listener()
        return await operation()
      } finally { for (const unlock of roots.reverse()) unlock(); release() }
    })
    this.tail = next.catch(() => undefined); return next
  }
  setAreaTaskGuard(guard: (workbenchId: string, areaId: string) => boolean) { this.areaHasTasks = guard }
  private recoverCommit() {
    if (!existsSync(this.journalFile)) return
    const job = readJson<{ writes: ProjectWrite[] }>(this.journalFile)
    for (const write of job.writes) this.writeOne(write)
    unlinkSync(this.journalFile)
  }
  private writeOne(write: ProjectWrite) {
    if (write.text === undefined) { atomicJson(write.file, write.value); return }
    mkdirSync(path.dirname(write.file), { recursive: true })
    const temporary = write.file + '.' + randomUUID() + '.tmp'
    writeFileSync(temporary, write.text, { encoding: 'utf8', flush: true }); renameSync(temporary, write.file)
  }
  private commit(registry: Registry, writes: ProjectWrite[]) {
    const all = [...writes, { file: this.registryFile, value: registry }]
    atomicJson(this.journalFile, { writes: all })
    for (const write of all) this.writeOne(write)
    unlinkSync(this.journalFile)
    this.registry = registry
  }
  private project(): FileWorkbenchSnapshot {
    const workbenches: Record<string, WorkbenchRecordV2> = {}
    for (const [id, envelope] of this.records) {
      const registration = this.registry.registrations[id]!
      let record: WorkbenchRecordV2
      try { record = hydrateProjects(registration.rootPath, envelope.record); validateWorkbenchRelations(record) }
      catch (error) {
        this.registry.preferences.invalidWorkbenches[id] = { workbenchId: id, name: envelope.record.name, description: '工作台或项目资料无法读取，请检查目录。', rawRecord: { rootPath: registration.rootPath, diagnostic: String(error) } }
        continue
      }
      delete this.registry.preferences.invalidWorkbenches[id]
      record.fileWorkbench = { schemaVersion: envelope.schemaVersion, revision: envelope.revision, rootPath: registration.rootPath }
      for (const project of Object.values(record.projects ?? {})) {
        const workspaceId = registration.workspaces[project.relativePath]; if (workspaceId) project.workspaceId = workspaceId
      }
      for (const project of Object.values(record.areaProjects ?? {})) {
        const workspaceId = registration.workspaces[project.relativePath]; if (workspaceId) project.workspaceId = workspaceId
      }
      const hydrate = (binding: { sessionId: string; workspaceId?: string }) => {
        const catalog = record.sessionCatalog?.[binding.sessionId]
        binding.sessionId = registration.sessions[binding.sessionId] ?? binding.sessionId
        const workspaceId = catalog && registration.workspaces[catalog.relativePath]
        if (workspaceId) binding.workspaceId = workspaceId
      }
      for (const area of areasOf(record.document.root)) for (const module of area.moduleHistory) if (module.binding) hydrate(module.binding)
      if (record.bayAgentSession) hydrate(record.bayAgentSession)
      for (const entry of Object.values(record.sessionCatalog ?? {})) { const sessionId = registration.sessions[entry.sessionKey]; if (sessionId) entry.sessionId = sessionId }
      workbenches[id] = record
    }
    const value: WorkbenchSettingsV4 = { ...clone(this.registry.preferences), workbenches }
    value.openWorkbenchIds = value.openWorkbenchIds.filter(id => workbenches[id] && workbenches[id]!.archivedAt === undefined)
    if (!value.openWorkbenchIds.includes(value.activeWorkbenchId)) value.activeWorkbenchId = value.openWorkbenchIds[0] ?? ''
    return { status: 'ready', value, revision: this.registry.revision, writable: true, mode: 'host' }
  }
  private validate(record: WorkbenchRecordV2) {
    if (!record || !safeId(record.workbenchId) || typeof record.name !== 'string' || !record.name.trim() || !validateWorkbenchDocumentV3(record.document)) throw new Error('工作台定义无效。')
  }
  private portable(record: WorkbenchRecordV2, registration: Registration): WorkbenchRecordV2 {
    const portable = clone(record)
    delete portable.fileWorkbench
    const reverse = new Map(Object.entries(registration.sessions).map(([key, id]) => [id, key]))
    const bind = (binding: { sessionId: string; workspaceId?: string }, areaId?: string) => {
      const key = reverse.get(binding.sessionId) ?? binding.sessionId
      registration.sessions[key] ??= binding.sessionId
      const previous = portable.sessionCatalog?.[key]
      const relativePath = areaId ? portable.areaProjects?.[areaId]?.relativePath : ''
      if (relativePath === undefined) throw new Error('请先为区域设置项目目录。')
      if (binding.workspaceId && registration.workspaces[relativePath] !== binding.workspaceId) throw new Error('对话项目与区域目录不匹配。')
      if (previous && previous.relativePath !== relativePath) throw new Error('不能将会话移入不同项目目录。')
      portable.sessionCatalog ??= {}
      portable.sessionCatalog[key] = previous ?? { sessionKey: key, role: areaId ? 'user' : 'main', ...(areaId ? { areaId } : {}), relativePath, title: areaId ? '对话' : 'Bay Agent', agentPreset: areaId ? 'standard' : 'bay-agent', createdAt: Date.now() }
      if (areaId && portable.areaProjects?.[areaId]?.projectId) portable.sessionCatalog[key]!.projectId = portable.areaProjects[areaId]!.projectId!
      binding.sessionId = key; delete binding.workspaceId
    }
    for (const area of areasOf(portable.document.root)) {
      delete area.areaBinding
      delete area.areaBindingGeneration
      for (const module of area.moduleHistory) if (module.binding) bind(module.binding, area.areaId)
    }
    if (portable.bayAgentSession) bind(portable.bayAgentSession)
    for (const project of Object.values(portable.areaProjects ?? {})) delete project.workspaceId
    for (const entry of Object.values(portable.sessionCatalog ?? {})) delete entry.sessionId
    validateWorkbenchRelations(portable)
    if (portable.projectModelVersion) {
      delete portable.areaContexts
      for (const project of Object.values(portable.projects ?? {})) { delete project.context; delete project.contextCandidates; delete project.workspaceId }
    }
    return portable
  }
  /** Reconcile structural edits inside the same atomic commit as their layout. */
  private reconcileAreas(record: WorkbenchRecordV2, previous?: WorkbenchRecordV2): WorkbenchRecordV2 {
    const next = clone(record)
    next.areaDefinitions = {}
    for (const area of areasOf(next.document.root)) next.areaDefinitions[area.areaId] = { areaId: area.areaId }
    next.areaProjects = { ...previous?.areaProjects, ...next.areaProjects }
    const visible = areasOf(next.document.root)
    // Resolve chains of splits created before the autosave boundary.
    for (let pass = 0; pass < visible.length; pass++) for (const area of visible) {
      if (next.areaProjects[area.areaId]) continue
      const restored = area.projectRestoreId && next.projects?.[area.projectRestoreId]
      if (restored) { const { projectId, relativePath, generation, workspaceId } = restored; next.areaProjects[area.areaId] = { projectId, relativePath, generation, ...(workspaceId ? { workspaceId } : {}) }; continue }
      const source = area.projectSourceAreaId && next.areaProjects[area.projectSourceAreaId]
      const bindings = area.moduleHistory.flatMap(page => page.binding ? [page.binding] : [])
      const project = source && bindings.every(binding => binding.workspaceId === source.workspaceId) ? source
        : (bindings.length ? Object.values(next.areaProjects).find(project => project.workspaceId && bindings.every(binding => binding.workspaceId === project.workspaceId)) : undefined)
      if (project) next.areaProjects[area.areaId] = { ...project, generation: 1 }
    }
    for (const area of visible) {
      delete area.projectSourceAreaId
      delete area.projectRestoreId
      for (const page of area.moduleHistory) if (page.editorId === 'workbench.workspace-files') {
        const state = page.state as { projectAreaId?: string; projectId?: string }
        const source = next.areaProjects[state.projectAreaId ?? area.areaId], target = next.areaProjects[area.areaId]
        if (source && target && source.relativePath !== target.relativePath) throw new Error('项目文件内页只能移入同项目区域。')
        if (state.projectId && target?.projectId !== state.projectId) throw new Error('项目文件内页只能移入同项目区域。')
        if (target?.projectId) { state.projectId = target.projectId; delete state.projectAreaId }
      }
    }
    const ids = new Set(visible.map(area => area.areaId))
    next.areaProjects = Object.fromEntries(Object.entries(next.areaProjects).filter(([id]) => ids.has(id)))
    next.areaMetadata = Object.fromEntries(Object.entries(next.areaMetadata ?? {}).filter(([id]) => ids.has(id)))
    next.areaContexts = Object.fromEntries(Object.entries(next.areaContexts ?? {}).filter(([id]) => ids.has(id)))
    return next
  }
  private writeProjection(root: string, record: WorkbenchRecordV2) {
    const base = path.join(root, '.bay', 'context'); mkdirSync(base, { recursive: true })
    writeFileSync(path.join(base, '工作台整体背景说明.md'), renderWorkbenchContextMarkdown(workbenchContextOf(record.context)), 'utf8')
    for (const [id, context] of Object.entries(record.projectModelVersion ? {} : record.areaContexts ?? {})) {
      if (!safeId(id)) throw new Error('区域身份无效。')
      const folder = path.join(base, 'areas', id); mkdirSync(folder, { recursive: true })
      writeFileSync(path.join(folder, '区域说明.md'), renderAreaContextMarkdown(areaContextOf(context)), 'utf8')
    }
  }
  rootPath(id: string): string { const root = this.registry.registrations[id]?.rootPath; if (!root || !this.records.has(id)) throw new Error('工作台目录未登记或已失联。'); return root }
  async resolveDirectory(id: string, relativePath: string, create = false): Promise<string> {
    if (relativePath.split('/').some(part => part.toLowerCase() === '.bay')) throw new Error('内部工作台目录不能作为区域项目。')
    const root = await realpath(this.rootPath(id)), target = resolvePortablePath(root, relativePath)
    // Check every existing ancestor before mkdir can follow a directory link.
    let cursor = root
    for (const segment of relativePath.split('/').filter(Boolean)) {
      cursor = path.join(cursor, segment)
      try { portableRelativePath(root, await realpath(cursor)) } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        if (!create) throw new Error('区域目录不存在。')
        await mkdir(cursor)
      }
    }
    const resolved = await realpath(target)
    const actualRelative = portableRelativePath(root, resolved)
    if (actualRelative.split('/').some(part => part.toLowerCase() === '.bay')) throw new Error('内部工作台目录不能作为区域项目。')
    if (!(await stat(resolved)).isDirectory()) throw new Error('请选择文件夹。')
    return resolved
  }
  async readProjectFile(id: string, relativePath: string): Promise<Uint8Array> {
    if (!relativePath || relativePath.split('/').some(part => part.toLowerCase() === '.bay')) throw new Error('不能读取工作台内部管理目录。')
    const root = await realpath(this.rootPath(id)), target = resolvePortablePath(root, relativePath)
    const resolved = await realpath(target), actual = portableRelativePath(root, resolved)
    if (actual.split('/').some(part => part.toLowerCase() === '.bay')) throw new Error('不能读取工作台内部管理目录。')
    const info = await stat(resolved)
    if (!info.isFile()) throw new Error('请选择文件。')
    if (info.size > 16 * 1024 * 1024) throw new Error('文件超过读取上限。')
    return readFile(resolved)
  }
  async writeProjectFile(id: string, relativePath: string, value: Uint8Array): Promise<void> {
    if (!relativePath || relativePath.split('/').some(part => part.toLowerCase() === '.bay')) throw new Error('不能写入工作台内部管理目录。')
    if (value.byteLength > 16 * 1024 * 1024) throw new Error('文件超过写入上限。')
    await this.serial(async () => {
      const root = await realpath(this.rootPath(id)), target = resolvePortablePath(root, relativePath)
      await this.resolveDirectory(id, relativePath.split('/').slice(0, -1).join('/'), true)
      const temporary = target + '.' + randomUUID() + '.tmp'
      await writeFile(temporary, value, { flag: 'wx' }); renameSync(temporary, target)
    })
  }
  async listDirectories(id: string, relativePath = '') { const folder = await this.resolveDirectory(id, relativePath); return (await readdir(folder, { withFileTypes: true })).filter(row => row.name !== '.bay' && (row.isDirectory() || row.isSymbolicLink())).map(row => ({ name: row.name, relativePath: [relativePath, row.name].filter(Boolean).join('/') })) }
  async projectEntries(id: string, areaId: string, relativePath = '') {
    const record = this.snapshot.value.workbenches[id], project = record?.projects?.[areaId] ?? record?.areaProjects?.[areaId]
    if (!project) throw new Error('请先为此区域设置项目文件夹。')
    const base = await this.resolveDirectory(id, project.relativePath), directory = await this.resolveDirectory(id, [project.relativePath, relativePath].filter(Boolean).join('/'))
    portableRelativePath(base, directory)
    const rows = await readdir(directory, { withFileTypes: true })
    const selected = rows.filter(row => row.name.toLowerCase() !== '.bay').sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name)).slice(0, 2000)
    const entries = []
    for (const row of selected) {
      let kind: 'directory' | 'file' | 'unavailable' = row.isDirectory() ? 'directory' : 'file'
      try { const actual = await realpath(path.join(directory, row.name)); portableRelativePath(base, actual); if (row.isSymbolicLink()) kind = (await stat(actual)).isDirectory() ? 'directory' : 'file' } catch { kind = 'unavailable' }
      entries.push({ name: row.name, relativePath: [relativePath, row.name].filter(Boolean).join('/'), kind })
    }
    return { project: project.relativePath, truncated: rows.length > selected.length + rows.filter(row => row.name.toLowerCase() === '.bay').length, entries: entries.sort((a, b) => Number(b.kind === 'directory') - Number(a.kind === 'directory') || a.name.localeCompare(b.name)) }
  }
  async projectPreview(id: string, areaId: string, relativePath: string) {
    if (relativePath.split('/').some(part => part.toLowerCase() === '.bay')) throw new Error('不能读取工作台内部管理目录。')
    const record = this.snapshot.value.workbenches[id], project = record?.projects?.[areaId] ?? record?.areaProjects?.[areaId]
    if (!project || !relativePath) throw new Error('项目或文件不存在。')
    const base = await this.resolveDirectory(id, project.relativePath), target = await realpath(resolvePortablePath(base, relativePath))
    portableRelativePath(base, target)
    if (!(await stat(target)).isFile()) throw new Error('此路径不是文件。')
    const handle = await (await import('node:fs/promises')).open(target, 'r')
    try {
      const buffer = Buffer.alloc(256 * 1024), { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
      const content = buffer.subarray(0, bytesRead)
      return { text: content.includes(0) ? '此文件为二进制文件，无法显示文本预览。' : content.toString('utf8'), truncated: (await handle.stat()).size > bytesRead }
    } finally { await handle.close() }
  }
  async create(input: { requestId: string; parentPath: string; folderName: string; record: WorkbenchRecordV2 }) {
    return this.serial(async () => {
      if (!safeId(input.requestId) || !input.folderName.trim() || /[<>:"/\\|?*\u0000-\u001f]/u.test(input.folderName) || /[. ]$/u.test(input.folderName) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(input.folderName)) throw new Error('文件夹名称无效。')
      const parentPath = await realpath(input.parentPath), prior = this.registry.requests[input.requestId]
      if (prior) { if (prior.parentPath !== parentPath || prior.folderName !== input.folderName) throw new Error('重复请求与原创建位置不同。'); return { workbenchId: prior.workbenchId, revision: this.registry.revision } }
      this.validate(input.record)
      const rootPath = path.join(parentPath, input.folderName)
      const provisioningFile = path.join(path.dirname(this.registryFile), 'create-' + createHash('sha256').update(input.requestId).digest('hex') + '.json')
      const provisioning = existsSync(provisioningFile) ? readJson<{ rootPath: string; staging: string; requestId: string; record: WorkbenchRecordV2 }>(provisioningFile)
        : { rootPath, staging: path.join(parentPath, '.bay-create-' + randomUUID()), requestId: input.requestId, record: input.record }
      if (provisioning.rootPath !== rootPath || provisioning.record.workbenchId !== input.record.workbenchId) throw new Error('创建请求与原操作不一致。')
      if (!existsSync(provisioningFile)) {
        if (existsSync(rootPath)) throw new Error('目标文件夹已存在，请选择其他名称。')
        atomicJson(provisioningFile, provisioning)
      }
      const marker = (folder: string) => path.join(folder, '.bay', 'creation.json')
      if (!existsSync(rootPath)) {
        await mkdir(provisioning.staging, { recursive: true })
        atomicJson(marker(provisioning.staging), { requestId: input.requestId })
        renameSync(provisioning.staging, rootPath)
      }
      if (!existsSync(marker(rootPath)) || readJson<{ requestId: string }>(marker(rootPath)).requestId !== input.requestId) throw new Error('创建目录被其他内容占用。')
      const workspace = await this.workspaces.create(rootPath)
      const registry = clone(this.registry), id = input.record.workbenchId
      if (registry.registrations[id]) throw new Error('工作台身份已经存在。')
      const registration: Registration = { rootPath, workspaces: { '': workspace.id }, sessions: {} }
      const record = this.portable(this.reconcileAreas({ ...input.record, projectModelVersion: 1, projects: {}, areaProjects: {}, sessionCatalog: {} }), registration)
      const envelope: FileWorkbenchV1 = { schemaVersion: 2, revision: 0, record }
      registry.registrations[id] = registration
      registry.requests[input.requestId] = { workbenchId: id, parentPath, folderName: input.folderName }
      registry.preferences.activeWorkbenchId = id; registry.preferences.openWorkbenchIds.push(id); registry.revision++
      this.commit(registry, [{ file: filename(rootPath), value: envelope }]); this.records.set(id, envelope)
      this.writeProjection(rootPath, record); this.publish()
      unlinkSync(marker(rootPath)); unlinkSync(provisioningFile)
      return { workbenchId: id, revision: registry.revision }
    })
  }
  async bindArea(input: { workbenchId: string; areaId: string; relativePath: string; createDirectory?: boolean; expectedRevision: number }) {
    return this.serial(async () => {
      if (input.expectedRevision !== this.registry.revision) return { status: 'conflict' as const, actualRevision: this.registry.revision }
      if (!input.relativePath) throw new Error('请选择工作台根目录内的子文件夹。')
      const record = this.snapshot.value.workbenches[input.workbenchId]
      if (!record || !workbenchAreas(record).some(row => row.areaId === input.areaId)) throw new Error('区域不存在。')
      const existing = record.areaProjects?.[input.areaId]
      if (existing?.relativePath === input.relativePath) return { status: 'committed' as const, revision: this.registry.revision }
      if (this.areaHasTasks(input.workbenchId, input.areaId)) throw new Error('区域仍有进行中的 Bay Agent 任务。')
      // A session catalog entry is historical ownership, not a currently open page.
      const area = areasOf(record.document.root).find(row => row.areaId === input.areaId)
      if (area && area.moduleHistory.length > 0) throw new Error('请先关闭此区域中的内页，再切换项目文件夹。历史会话和任务记录会保留。')
      const resolved = await this.resolveDirectory(input.workbenchId, input.relativePath, input.createDirectory === true)
      const canonical = portableRelativePath(await realpath(this.rootPath(input.workbenchId)), resolved)
      if (!canonical) throw new Error('请选择工作台根目录内的子文件夹。')
      if (existing?.relativePath === canonical) return { status: 'committed' as const, revision: this.registry.revision }
      const workspace = await this.workspaces.create(resolved)
      const registry = clone(this.registry), registration = registry.registrations[input.workbenchId]!
      registration.workspaces[canonical] = workspace.id
      const changed = clone(record)
      const project = discoverProject(registration.rootPath, canonical, changed.projects ?? {})
      changed.projects = { ...changed.projects, [project.projectId]: project }
      changed.areaProjects = { ...changed.areaProjects, [input.areaId]: { projectId: project.projectId, relativePath: canonical, generation: project.generation } }
      const envelope: FileWorkbenchV1 = { schemaVersion: 2, revision: this.records.get(input.workbenchId)!.revision + 1, record: this.portable(changed, registration) }
      registry.revision++
      this.commit(registry, [...projectWrites(registration.rootPath, project), { file: filename(registration.rootPath), value: envelope }]); this.records.set(input.workbenchId, envelope); this.publish()
      return { status: 'committed' as const, revision: registry.revision }
    })
  }
  /** A repair project belongs to the workbench, independently of its Areas. */
  async prepareCreatorRepair(input: CreatorRepairTargetV1): Promise<CreatorRepairProjectV1> {
    return this.serial(async () => {
      const record = this.snapshot.value.workbenches[input.workbenchId]
      if (!record || record.archivedAt !== undefined) throw new Error('请先打开一个可用的工作台。')
      if (!input.moduleId.trim() || input.moduleId.length > 512 || (input.packageName?.length ?? 0) > 512) throw new Error('插件身份无效。')
      const identity = createHash('sha256').update(JSON.stringify([input.packageName ?? '', input.moduleId])).digest('hex').slice(0, 20)
      const sessionKey = 'creator-repair:' + identity
      const entry = record.sessionCatalog?.[sessionKey]
      const slug = input.moduleId.normalize('NFKC').replace(/[^a-zA-Z0-9_-]+/gu, '-').slice(0, 64) || 'extension'
      const relativePath = entry?.relativePath ?? `repairs/${slug}-${identity}`
      const resolved = await this.resolveDirectory(input.workbenchId, relativePath, !entry)
      const registry = clone(this.registry), registration = registry.registrations[input.workbenchId]!
      const workspaceId = (await this.workspaces.create(resolved)).id
      const existingSession = registration.sessions[sessionKey]
      const sessionId = existingSession ?? registration.creatorRepairs?.[sessionKey] ?? randomUUID()
      registration.workspaces[relativePath] = workspaceId
      registration.creatorRepairs ??= {}; registration.creatorRepairs[sessionKey] = sessionId
      if (!isDeepStrictEqual(registration, this.registry.registrations[input.workbenchId])) {
        registry.revision++; this.commit(registry, []); this.publish()
      }
      return { workspaceId, relativePath, sessionKey, sessionId, registered: !!existingSession }
    })
  }
  workspaceId(id: string, areaId?: string): string {
    const relative = areaId ? this.records.get(id)?.record.areaProjects?.[areaId]?.relativePath : ''
    const result = relative === undefined ? undefined : this.registry.registrations[id]?.workspaces[relative]
    if (!result) throw new Error('请先为区域设置项目目录。')
    return result
  }
  async registerSession(id: string, sessionId: string, entry: WorkbenchSessionEntryV1) { return this.serial(async () => {
    const record = clone(this.snapshot.value.workbenches[id]); if (!record) throw new Error('工作台不存在。')
    const registry = clone(this.registry), registration = registry.registrations[id]!
    const existingKey = Object.keys(registration.sessions).find(key => registration.sessions[key] === sessionId)
    if (existingKey) {
      const existing = record.sessionCatalog?.[existingKey]
      if (existing && existing.relativePath !== entry.relativePath) throw new Error('会话归属已登记，不能随内页位置更改。')
      if (existing) return
    }
    if (registration.sessions[entry.sessionKey] && registration.sessions[entry.sessionKey] !== sessionId) throw new Error('会话身份映射冲突。')
    registration.sessions[entry.sessionKey] = sessionId
    const writes: ProjectWrite[] = []
    if (entry.role !== 'main') {
      const project = discoverProject(registration.rootPath, entry.relativePath, record.projects ?? {})
      record.projects = { ...record.projects, [project.projectId]: project }; entry = { ...entry, projectId: project.projectId }
      writes.push(...projectWrites(registration.rootPath, project))
    }
    const envelope: FileWorkbenchV1 = { schemaVersion: 2, revision: this.records.get(id)!.revision + 1,
      record: this.portable(this.reconcileAreas({ ...record, sessionCatalog: { ...record.sessionCatalog, [entry.sessionKey]: entry } }, record), registration) }
    registry.revision++
    this.commit(registry, [...writes, { file: filename(registration.rootPath), value: envelope }]); this.records.set(id, envelope); this.publish()
  }) }
  async reserveSession(id: string, requestId: string, areaId: string, agentPreset: string, sessionId: string) { return this.serial(async () => {
    const record = this.snapshot.value.workbenches[id], project = record?.areaProjects?.[areaId]
    if (!record || record.archivedAt || !workbenchAreas(record).some(area => area.areaId === areaId) || !project?.workspaceId) throw new Error('请先为此区域设置项目文件夹。')
    const registry = clone(this.registry), registration = registry.registrations[id]!
    const requested = { areaId, relativePath: project.relativePath, agentPreset, sessionId }
    const prior = registration.sessionRequests?.[requestId]
    if (prior && !isDeepStrictEqual(prior, requested)) throw new Error('创建对话请求的目标或模式已变化，请重新发起。')
    if (!prior) { registration.sessionRequests ??= {}; registration.sessionRequests[requestId] = requested; registry.revision++; this.commit(registry, []); this.publish() }
    return { ...requested, workspaceId: project.workspaceId }
  }) }
  nativeSessionId(id: string, key: string): string | undefined { return this.registry.registrations[id]?.sessions[key] }
  sessionIds(id: string): string[] { return Object.values(this.registry.registrations[id]?.sessions ?? {}) }
  sessionMap(id: string): Record<string, string> { return clone(this.registry.registrations[id]?.sessions ?? {}) }
  async showArea(id: string, areaId: string, expectedRevision: number) {
    const record = this.snapshot.value.workbenches[id]
    if (!record) throw new Error('工作台不存在。')
    return this.patch({ operation: 'set', path: ['workbenches', id], expectedRevision, value: showWorkbenchArea(record, areaId, 'split-' + randomUUID()) })
  }
  async openProject(input: { workbenchId: string; projectId: string; requestId: string; expectedRevision: number }) {
    return this.serial(async () => {
      const record = this.snapshot.value.workbenches[input.workbenchId], project = record?.projects?.[input.projectId]
      if (!record || !project || !safeId(input.requestId)) throw new Error('项目不存在或请求无效。')
      // Stable operation-derived view identity makes retries safe without restoring closed Areas.
      const areaId = 'area-' + createHash('sha256').update(input.workbenchId + ':' + input.requestId).digest('hex').slice(0, 24)
      if (areasOf(record.document.root).some(area => area.areaId === areaId)) {
        if (record.areaProjects?.[areaId]?.projectId !== project.projectId) throw new Error('重复的项目打开请求指向了不同项目。')
        return { status: 'committed' as const, revision: this.registry.revision, areaId }
      }
      if (input.expectedRevision !== this.registry.revision) return { status: 'conflict' as const, actualRevision: this.registry.revision }
      const area = { kind: 'area' as const, areaId, moduleHistory: [] }
      const next = { ...record, document: { ...record.document, activeAreaId: areaId, root: areasOf(record.document.root).length ? { kind: 'split' as const, id: 'split-' + randomUUID(), axis: 'horizontal' as const, ratio: .5, first: record.document.root, second: area } : area },
        areaProjects: { ...record.areaProjects, [areaId]: { projectId: project.projectId, relativePath: project.relativePath, generation: project.generation } } }
      const registry = clone(this.registry), registration = registry.registrations[input.workbenchId]!
      const envelope: FileWorkbenchV1 = { schemaVersion: 2, revision: this.records.get(input.workbenchId)!.revision + 1, record: this.portable(this.reconcileAreas(next), registration) }
      registry.revision++; this.commit(registry, [{ file: filename(registration.rootPath), value: envelope }]); this.records.set(input.workbenchId, envelope); this.publish()
      return { status: 'committed' as const, revision: registry.revision, areaId }
    })
  }
  definition(id: string): FileWorkbenchV1 { this.rootPath(id); return clone(this.records.get(id)!) }
  async publishImported(rootPath: string, envelope: FileWorkbenchV1, sessionMap: Record<string, string>) { return this.serial(async () => {
    this.validate(envelope.record)
    validateWorkbenchRelations(envelope.record)
    if (![1, 2].includes(envelope.schemaVersion) || !envelope.record.executionPaused) throw new Error('导入工作台必须保持待继续状态。')
    const id = envelope.record.workbenchId, existing = this.registry.registrations[id]
    if (existing) {
      if (existing.rootPath !== rootPath || !isDeepStrictEqual(existing.sessions, sessionMap)) throw new Error('工作台导入身份冲突。')
      return
    }
    const actualRoot = await realpath(rootPath), workspaceMap: Record<string, string> = {}
    for (const relative of new Set(['', ...Object.values(envelope.record.projects ?? {}).map(row => row.relativePath), ...Object.values(envelope.record.areaProjects ?? {}).map(row => row.relativePath), ...Object.values(envelope.record.sessionCatalog ?? {}).map(row => row.relativePath)])) {
      const folder = await realpath(resolvePortablePath(actualRoot, relative)); portableRelativePath(actualRoot, folder)
      workspaceMap[relative] = (await this.workspaces.create(folder)).id
    }
    for (const key of Object.keys(envelope.record.sessionCatalog ?? {})) if (!sessionMap[key]) throw new Error('导入会话映射缺失。')
    const registry = clone(this.registry)
    registry.registrations[id] = { rootPath: actualRoot, workspaces: workspaceMap, sessions: clone(sessionMap) }
    registry.preferences.openWorkbenchIds.push(id); registry.preferences.activeWorkbenchId = id; registry.revision++
    const upgraded = upgradeProjectOwnership(actualRoot, envelope.record)
    envelope = { ...envelope, schemaVersion: 2, record: this.portable(this.reconcileAreas(upgraded.record), registry.registrations[id]!) }
    this.commit(registry, [...upgraded.writes, { file: filename(actualRoot), value: envelope }]); this.records.set(id, envelope)
    this.writeProjection(actualRoot, envelope.record); this.publish()
  }) }
  patch = (operation: DirectoryPatch): Promise<{ status: 'committed'; revision: number } | { status: 'conflict'; actualRevision: number }> => this.serial(async () => {
    if (operation.expectedRevision !== undefined && operation.expectedRevision !== this.registry.revision) return { status: 'conflict', actualRevision: this.registry.revision }
    const next = clone(this.snapshot.value)
    if (operation.path.some(part => ['__proto__', 'constructor', 'prototype'].includes(part))) throw new Error('无效设置路径。')
    if (!operation.path.length) {
      if (operation.operation !== 'set') throw new Error('不能删除工作台登记。')
      Object.assign(next, clone(operation.value))
    } else {
      let target = next as unknown as Record<string, unknown>
      for (const segment of operation.path.slice(0, -1)) { target[segment] ??= {}; target = target[segment] as Record<string, unknown> }
      const last = operation.path.at(-1)!
      if (operation.operation === 'unset') delete target[last]; else target[last] = clone(operation.value)
    }
    if (isDeepStrictEqual(next, this.snapshot.value)) return { status: 'committed', revision: this.registry.revision }
    const registry = clone(this.registry), records = new Map(this.records), writes: ProjectWrite[] = []
    for (const [id, record] of Object.entries(next.workbenches)) {
      this.validate(record)
      const registration = registry.registrations[id]
      if (!registration) throw new Error('请通过创建工作台入口选择目录；不支持旧格式工作台。')
      if (isDeepStrictEqual(record, this.snapshot.value.workbenches[id])) continue
      const before = this.snapshot.value.workbenches[id]!
      const visibleAfter = new Set(areasOf(record.document.root).map(area => area.areaId))
      for (const area of areasOf(before.document.root)) {
        if (!visibleAfter.has(area.areaId) && this.areaHasTasks(id, area.areaId)) throw new Error('此区域仍有正在运行或启动中的 Bay Agent 任务，请先停止或等待任务结束。')
      }
      if (!isDeepStrictEqual(record.areaProjects, before.areaProjects) || !isDeepStrictEqual(record.sessionCatalog, before.sessionCatalog)
        || !isDeepStrictEqual(record.fileWorkbench, before.fileWorkbench)) throw new Error('目录和会话目录只能通过宿主专用接口修改。')
      if (record.projectModelVersion !== before.projectModelVersion || !isDeepStrictEqual(record.projectMigration, before.projectMigration)
        || !isDeepStrictEqual(Object.keys(record.projects ?? {}), Object.keys(before.projects ?? {}))) throw new Error('项目登记只能通过宿主专用接口修改。')
      for (const [areaId, context] of Object.entries(record.areaContexts ?? {})) if (!record.areaProjects?.[areaId] && !isDeepStrictEqual(context, before.areaContexts?.[areaId])) throw new Error('请先关联项目，再修改项目背景。')
      for (const [projectId, project] of Object.entries(record.projects ?? {})) {
        const original = before.projects![projectId]!
        const { context: _c, contextCandidates: _s, ...reference } = project
        const { context: _oc, contextCandidates: _os, ...priorReference } = original
        if (!isDeepStrictEqual(reference, priorReference) || !isDeepStrictEqual(project.contextCandidates, original.contextCandidates)) throw new Error('项目身份不能通过布局修改。')
        const updates = Object.entries(record.areaContexts ?? {}).filter(([areaId, context]) => record.areaProjects?.[areaId]?.projectId === projectId && !isDeepStrictEqual(context, before.areaContexts?.[areaId]))
        if (updates.length > 1 && !updates.every(([, context]) => isDeepStrictEqual(context, updates[0]![1]))) throw new Error('同一项目的背景修改冲突。')
        if (updates[0]) project.context = updates[0][1]
        if (!isDeepStrictEqual(project.context, original.context)) {
          if (project.context?.revision !== (original.context?.revision ?? 0) + 1) throw new Error('项目背景版本冲突。')
          writes.push(...projectWrites(registration.rootPath, project))
        }
      }
      const portable = this.portable(this.reconcileAreas(record, before), registration)
      const envelope: FileWorkbenchV1 = { schemaVersion: 2, revision: (records.get(id)?.revision ?? 0) + 1, record: portable }
      writes.push({ file: filename(registration.rootPath), value: envelope }); records.set(id, envelope)
    }
    for (const id of records.keys()) if (!next.workbenches[id] && this.snapshot.value.workbenches[id]) { records.delete(id); delete registry.registrations[id] }
    const { workbenches: _records, migrationRequired: _migration, ...preferences } = next
    registry.preferences = preferences; registry.revision++
    this.commit(registry, writes); this.records = records
    for (const [id, envelope] of records) if (writes.some(write => write.file === filename(registry.registrations[id]!.rootPath))) this.writeProjection(registry.registrations[id]!.rootPath, envelope.record)
    this.publish(); return { status: 'committed', revision: registry.revision }
  })
}
