import { hydrateProjects } from './host-workbench-projects.ts'
import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream, existsSync, readFileSync, readdirSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile, lstat, open, stat } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import path from 'node:path'
import { c, x } from 'tar'
import type { HostConnectionHandle } from '@deepseek-ai/dsh-client-connection'
import type { SessionController } from '@deepseek-ai/dsh-api-session-controller'
import type { SessionPersistence } from '@deepseek-ai/dsh-session-persistence'
import type { AttachmentStore } from '@deepseek-ai/dsh-attachment'
import type { WorkspaceRegistry } from '@deepseek-ai/dsh-workspace'
import { HostWorkbenchDirectory, atomicJson } from './host-workbench-directory.ts'
import { NativeSessionPortability, resolvePortablePath, type NativeSessionSnapshot } from './host-native-session-portability.ts'
import { copyTree, hashFile, readInventory, validateTargetName, writeInventory } from './host-workbench-complete-files.ts'
import { WORKBENCH_COMPLETE_ROUTE, WORKBENCH_COMPLETE_UPLOAD_ROUTE, WORKBENCH_COMPLETE_DOWNLOAD_ROUTE, WORKBENCH_COMPLETE_CHUNK_BYTES, type CompletePackageJob, type CompletePackageJobView, type CompletePackageUpload, type CompletePackageDirectoryRequest } from './workbench-complete-contract.ts'
import type { HostWorkbenchAccess } from './host-workbench-access.ts'
import type { WorkbenchAccessContext } from './workbench-access-contract.ts'
import type { BayAgentWorkStateV1 } from './foundation/workbench-bay-agent-work.ts'
import type { FileWorkbenchV1 } from './workbench-directory-contract.ts'
import { exportTaskSnapshot, restoreTaskSnapshot, remapCompletePageReferences, type CompleteTaskSnapshot } from './host-workbench-task-snapshot.ts'
import { validateWorkbenchRelations } from './foundation/area-identity.ts'
import { baySessionId } from './host-bay-agent-store.ts'
import { HostWorkbenchMemory } from './host-workbench-memory.ts'
import { areasOf, type WorkbenchNodeV3 } from './foundation/document-v3.ts'
import type { CompletePackagePreflight } from './workbench-complete-contract.ts'

export type CompleteOptions = {
  profile: string
  directory: HostWorkbenchDirectory
  persistence: SessionPersistence
  attachments?: AttachmentStore
  sessions?: SessionController
  workspaces: Pick<WorkspaceRegistry, 'create'>
  orchestration?: { load(id: string): BayAgentWorkStateV1; save(id: string, state: BayAgentWorkStateV1): void }
  access?: HostWorkbenchAccess
  /** Quiesce managed execution before snapshotting; false restores its prior policy. */
  setBarrier?: (workbenchId: string, active: boolean) => Promise<void> | void
}

const jobs = new Map<string, CompletePackageJob>()
const jobDirectory = (profile: string) => path.join(profile, '.dsh-workbench', 'complete-v5')
const validId = (id: string) => { if (!/^[A-Za-z0-9_-]{1,160}$/u.test(id)) throw new PackageRequestError(400, '无效的作业身份。'); return id }
const jobPath = (profile: string, id: string) => path.join(jobDirectory(profile), validId(id) + '.json')
const stagingDirectory = (profile: string, id: string) => path.join(jobDirectory(profile), 'staging', id)
const sha = (value: string) => createHash('sha256').update(value).digest('hex')
class PackageRequestError extends Error { constructor(readonly status: number, message: string) { super(message) } }
const message = (error: unknown) => error instanceof Error ? error.message : String(error)
const desktop: WorkbenchAccessContext = { actor: 'desktop', accessId: 'desktop' }
type StoredUpload = CompletePackageUpload & { ownerAccessId: string; archiveSha256?: string; preflight?: CompletePackagePreflight; lastChunk?: { offset: number; length: number; requestId: string; hash: string } }
type StoredDirectoryRequest = CompletePackageDirectoryRequest & { ownerAccessId: string; parentPath?: string; jobId?: string }
const uploadMetaPath = (profile: string, id: string) => path.join(jobDirectory(profile), 'uploads', validId(id) + '.json')
const uploadFilePath = (profile: string, id: string) => path.join(jobDirectory(profile), 'uploads', validId(id) + '.tar.gz')
const directoryRequestPath = (profile: string, id: string) => path.join(jobDirectory(profile), 'directories', validId(id) + '.json')
function readRecord<T>(file: string): T | undefined { return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) as T : undefined }
function records<T>(folder: string): T[] {
  if (!existsSync(folder)) return []
  return readdirSync(folder).filter(name => /^[A-Za-z0-9_-]+\.json$/u.test(name)).flatMap(name => { try { return [JSON.parse(readFileSync(path.join(folder, name), 'utf8')) as T] } catch { return [] } })
}
const publicUpload = ({ ownerAccessId: _owner, archiveSha256: _hash, preflight: _preview, lastChunk: _chunk, ...value }: StoredUpload): CompletePackageUpload => value
const publicDirectory = ({ ownerAccessId: _owner, parentPath, ...value }: StoredDirectoryRequest): CompletePackageDirectoryRequest => ({ ...value, ...(parentPath ? { displayPath: parentPath } : {}) })

const saveJob = (profile: string, job: CompletePackageJob) => {
  jobs.set(profile + ':' + job.id, job)
  atomicJson(jobPath(profile, job.id), job)
}

const update = (profile: string, job: CompletePackageJob, patch: Partial<CompletePackageJob>) => {
  Object.assign(job, patch, { updatedAt: Date.now() })
  saveJob(profile, job)
}

function persistedJob(profile: string, id: string): CompletePackageJob | undefined {
  if (jobs.has(profile + ':' + id)) return jobs.get(profile + ':' + id)
  const file = jobPath(profile, id)
  if (!existsSync(file)) return undefined
  const value = JSON.parse(readFileSync(file, 'utf8')) as CompletePackageJob
  jobs.set(profile + ':' + id, value)
  return value
}

function persistedJobForRequest(profile: string, requestId: string): CompletePackageJob | undefined {
  const directory = jobDirectory(profile)
  if (!existsSync(directory)) return undefined
  for (const name of readdirSync(directory)) {
    if (!name.endsWith('.json')) continue
    try {
      const value = JSON.parse(readFileSync(path.join(directory, name), 'utf8')) as CompletePackageJob
      if (value.requestId === requestId) { jobs.set(profile + ':' + value.id, value); return value }
    } catch { /* an interrupted write is recoverable through the next request */ }
  }
  return undefined
}

type CompleteManifest = {
  type: 'workbench-complete'
  version: 5
  workbenchId: string
  sourceRoot?: string
  sessionKeys: Record<string, string>
  workspacePaths?: Record<string, string>
  orchestration?: string
  orchestrationSha256?: string
}

async function readManifest(stage: string) {
  const manifestFile = path.join(stage, 'manifest.json')
  const manifest = JSON.parse(await readFile(manifestFile, 'utf8')) as CompleteManifest
  if (manifest.type !== 'workbench-complete' || manifest.version !== 5 || !manifest.workbenchId || !manifest.sessionKeys) {
    throw new Error('不是完整工作台包 V5。')
  }
  for (const relative of ['manifest.json', 'files.ndjson', 'workbench/.bay/workbench.json', 'native/native-sessions.json']) {
    if (!existsSync(path.join(stage, relative))) throw new Error('完整包缺少必要内容：' + relative)
  }
  const paths = new Set<string>()
  let fileCount = 0, bytes = 0
  for await (const row of readInventory(path.join(stage, 'files.ndjson'))) {
    validateTargetName(row.path, process.platform)
    const key = process.platform === 'linux' ? row.path : row.path.toLocaleLowerCase('und')
    if (paths.has(key)) throw new Error('目标平台存在文件名冲突：' + row.path)
    paths.add(key)
    if (row.type === 'file') { fileCount++; bytes += row.bytes ?? 0 }
    if (row.target !== undefined) validateTargetName(row.target, process.platform)
    const file = resolvePortablePath(path.join(stage, 'workbench'), row.path), info = await lstat(file)
    if (row.type === 'file' ? !info.isFile() || info.size !== row.bytes || await hashFile(file) !== row.sha256
      : row.type === 'directory' ? !info.isDirectory() : row.type !== 'symlink' || !info.isSymbolicLink()) throw new Error('完整包文件类型或摘要不匹配：' + row.path)
  }
  const envelope = JSON.parse(await readFile(path.join(stage, 'workbench/.bay/workbench.json'), 'utf8')) as FileWorkbenchV1
  if (![1, 2].includes(envelope.schemaVersion) || envelope.record.workbenchId !== manifest.workbenchId) throw new Error('工作台定义与清单身份不匹配。')
  validateWorkbenchRelations(envelope.record)
  const native = JSON.parse(await readFile(path.join(stage, 'native/native-sessions.json'), 'utf8')) as NativeSessionSnapshot
  for (const key of Object.keys(envelope.record.sessionCatalog ?? {})) if (!manifest.sessionKeys[key] || !native.sessions.some(row => row.key === manifest.sessionKeys[key])) throw new Error('完整包缺少对话历史：' + key)
  if (envelope.record.projectModelVersion) hydrateProjects(path.join(stage, 'workbench'), envelope.record)
  let taskCount = 0
  if (manifest.orchestration) {
    if (manifest.orchestration !== 'orchestration.json' || !manifest.orchestrationSha256 || await hashFile(path.join(stage, manifest.orchestration)) !== manifest.orchestrationSha256) throw new Error('完整包任务快照摘要不匹配。')
    const tasks = JSON.parse(await readFile(path.join(stage, manifest.orchestration), 'utf8')) as CompleteTaskSnapshot
    restoreTaskSnapshot(tasks, envelope.record, manifest.sessionKeys, 0)
    taskCount = tasks.state.workItems.length
  }
  // Preview only layout and labels, without editor state or native bindings.
  const preview = (node: WorkbenchNodeV3): WorkbenchNodeV3 => node.kind === 'split'
    ? { kind: 'split', id: node.id, axis: node.axis, ratio: node.ratio, first: preview(node.first), second: preview(node.second) }
    : { kind: 'area', areaId: node.areaId, ...(node.activeModuleInstanceId ? { activeModuleInstanceId: node.activeModuleInstanceId } : {}), moduleHistory: node.moduleHistory.map(page => ({ moduleInstanceId: page.moduleInstanceId, editorId: page.editorId, editorScope: page.editorScope, lastKnownTitle: page.lastKnownTitle, state: {} })) }
  const areas = areasOf(envelope.record.document.root)
  const memory = new HostWorkbenchMemory(() => path.join(stage, 'workbench'), () => envelope.record)
  const overview: NonNullable<CompletePackagePreflight['overview']> = {
    name: envelope.record.name, description: envelope.record.description, layout: preview(envelope.record.document.root),
    projectCount: Object.keys(envelope.record.projects ?? {}).length, areaCount: areas.length,
    pageCount: areas.reduce((sum, area) => sum + area.moduleHistory.length, 0), fileCount, bytes, taskCount,
    memoryCount: Object.values(memory.index(manifest.workbenchId).entries).filter(entry => !entry.removed).length,
  }
  return { manifest, manifestSha256: await hashFile(manifestFile), overview }
}

async function extractPackage(archive: string, stage: string) {
  await mkdir(stage, { recursive: true })
  await x({ file: archive, cwd: stage, strict: true, preservePaths: false })
  return readManifest(stage)
}

async function ephemeralPreflight(archive: string) {
  const stage = await mkdtemp(path.join(path.dirname(archive), 'workbench-v5-preflight-'))
  try {
    const result = await extractPackage(archive, stage)
    return { ...result, stage }
  } catch (error) {
    await rm(stage, { recursive: true, force: true })
    throw error
  }
}

function importedWorkbenchId(directory: HostWorkbenchDirectory, sourceId: string, jobId: string): string {
  if (directory.getSnapshot().value.workbenches[sourceId] === undefined) return sourceId
  return `${sourceId.slice(0, 150)}-import-${jobId.slice(0, 12)}`
}

/** V5 is a complete, inert snapshot. Native runtime activation never happens during import. */
export function installWorkbenchCompleteRoute(connection: HostConnectionHandle, options: CompleteOptions) {
  const running = new Map<string, { abort: AbortController; promise: Promise<CompletePackageJob> }>()
  const serial = new Map<string, Promise<unknown>>()
  let disposed = false
  const load = async (request: Request) => {
    const chunks: Uint8Array[] = []; let bytes = 0
    for await (const chunk of request.body ?? []) { bytes += chunk.length; if (bytes > 128 * 1024) throw new PackageRequestError(413, '完整包控制请求过大。'); chunks.push(chunk) }
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new PackageRequestError(400, '需要完整包操作对象。')
    return value as Record<string, unknown>
  }
  const text = (input: Record<string, unknown>, key: string) => { if (typeof input[key] !== 'string' || !input[key]) throw new PackageRequestError(400, '缺少字段：' + key); return input[key] as string }
  const actor = (request: Request) => {
    const context = options.access?.resolve(request.headers) ?? desktop
    if (context.actor === 'lan-guest') throw new PackageRequestError(403, '完整工作台包仅供主控操作。')
    return context
  }
  const authorize = (context: WorkbenchAccessContext, workbenchId: string, write = true) => {
    // Importing the first workbench is a desktop operation without an existing scope.
    if (context.actor === 'desktop' && workbenchId === '') return
    if (context.actor === 'lan-guest' || context.actor === 'browser-owner' && context.workbenchId !== workbenchId) throw new PackageRequestError(403, '不能访问其他工作台的完整包。')
    options.access?.authorize(context, write ? 'package' : 'view', { workbenchId })
  }
  const importScope = (input: Record<string, unknown>, context: WorkbenchAccessContext) => context.actor === 'desktop' && (input.workbenchId === undefined || input.workbenchId === '') ? '' : text(input, 'workbenchId')
  const owned = (context: WorkbenchAccessContext, value: { ownerAccessId?: string; workbenchId: string; accessWorkbenchId?: string }) => {
    if (context.actor === 'browser-owner' && context.accessId !== value.ownerAccessId) throw new PackageRequestError(403, '此作业属于另一个主控窗口。')
    const id = value.accessWorkbenchId ?? value.workbenchId
    // Standalone desktop imports may not have a registered source workbench.
    if (context.actor !== 'desktop' || options.directory.getSnapshot().value.workbenches[id]) authorize(context, id, false)
  }
  const authorizeJobMutation = (context: WorkbenchAccessContext, job: CompletePackageJob, cancelling = false) => {
    const id = job.accessWorkbenchId ?? job.workbenchId
    if (cancelling && context.actor === 'desktop' && options.access?.controller(id) === 'browser') throw new PackageRequestError(409, '此作业由浏览器主控，请先收回控制。')
    if (context.actor !== 'desktop' || options.directory.getSnapshot().value.workbenches[id]) authorize(context, id, !cancelling)
  }
  const readJob = (id: string, context: WorkbenchAccessContext) => { const job = persistedJob(options.profile, id); if (!job) throw new PackageRequestError(404, '找不到完整包作业。'); owned(context, job); return job }
  const readUpload = (id: string, context: WorkbenchAccessContext) => { const value = readRecord<StoredUpload>(uploadMetaPath(options.profile, id)); if (!value) throw new PackageRequestError(404, '找不到上传作业。'); owned(context, value); return value }
  const readDirectory = (id: string, context: WorkbenchAccessContext) => { const value = readRecord<StoredDirectoryRequest>(directoryRequestPath(options.profile, id)); if (!value) throw new PackageRequestError(404, '找不到目录选择请求。'); owned(context, value); return value }
  const view = (job: CompletePackageJob): CompletePackageJobView => ({ version: job.version, id: job.id, kind: job.kind, requestId: job.requestId, workbenchId: job.workbenchId,
    stage: job.stage, files: job.files, bytes: job.bytes, updatedAt: job.updatedAt, ...(job.error ? { error: job.error } : {}), report: job.report,
    ...(job.name ? { name: job.name } : {}), ...(job.targetPath || job.parentPath && job.folderName ? { targetDisplayPath: job.targetPath ?? path.join(job.parentPath!, job.folderName!) } : {}),
    running: running.has(job.id), recoverable: job.stage !== 'complete' && !running.has(job.id) && !job.replacementDirectoryId,
    canChangeDestination: job.kind === 'import' && !!job.uploadId && !job.stageDir && !job.sessionMap && !job.replacementDirectoryId && ['failed', 'cancelled'].includes(job.stage) && !running.has(job.id) })
  const lock = async <T>(key: string, operation: () => Promise<T>): Promise<T> => {
    const previous = serial.get(key) ?? Promise.resolve()
    const result = previous.catch(() => {}).then(operation)
    serial.set(key, result)
    try { return await result } finally { if (serial.get(key) === result) serial.delete(key) }
  }
  const snapshot = async <T>(workbenchId: string, operation: () => Promise<T>): Promise<T> => {
    const execute = async () => {
      let enabled = false
      try { await options.setBarrier?.(workbenchId, true); enabled = true; await options.persistence.flush(); return await operation() }
      finally { if (enabled) await options.setBarrier?.(workbenchId, false) }
    }
    return options.access ? options.access.withSnapshot(workbenchId, execute) : execute()
  }
  const progress = (job: CompletePackageJob) => { let saved = 0; return (entry: { bytes: number }) => {
    job.files++; job.bytes += entry.bytes
    if (Date.now() - saved >= 300) { saved = Date.now(); update(options.profile, job, { files: job.files, bytes: job.bytes }) }
  } }
  const folder = (name: string) => { if (!name.trim() || name.includes('/') || name.includes('\\') || name === '.' || name === '..') throw new PackageRequestError(400, '文件夹名称必须是一个名称，不能包含路径。'); validateTargetName(name, process.platform); return name }
  const failed = (job: CompletePackageJob, error: unknown, signal?: AbortSignal) => update(options.profile, job, { stage: signal?.aborted ? 'cancelled' : 'failed', error: message(error), report: { ...job.report, data: 'blocked', blockers: [message(error)] } })

  const exportPackage = async (input: Record<string, unknown>, existing?: CompletePackageJob, signal?: AbortSignal) => {
    const workbenchId = String(input.workbenchId)
    const root = options.directory.rootPath(workbenchId)
    const requestId = typeof input.requestId === 'string' ? input.requestId : randomUUID()
    const prior = existing ?? persistedJobForRequest(options.profile, requestId)
    if (prior && (prior.kind !== 'export' || prior.workbenchId !== workbenchId || input.path && path.resolve(String(input.path)) !== path.resolve(prior.path))) throw new PackageRequestError(409, '重复导出请求与原作业不同。')
    if (prior?.kind === 'export' && prior.stage === 'complete') return prior
    const archive = prior?.path ?? String(input.path || path.join(jobDirectory(options.profile), 'archives', randomUUID() + '.tar.gz'))
    const relativeArchive = path.relative(root, archive)
    if (!relativeArchive.startsWith('..' + path.sep) && relativeArchive !== '..' && !path.isAbsolute(relativeArchive)) throw new PackageRequestError(400, '导出文件必须位于工作台根目录之外。')
    const job: CompletePackageJob = prior ?? {
      version: 5, id: randomUUID(), kind: 'export', requestId, workbenchId, path: archive,
      stage: 'preflight', files: 0, bytes: 0, updatedAt: Date.now(),
      report: { data: 'pending', environment: 'unchecked', tasks: 'waiting-for-user', blockers: [], exclusions: [], environmentSteps: ['导入后由用户主动恢复插件、模型和工具链。'] },
    }
    saveJob(options.profile, job)
    const stage = await mkdtemp(path.join(options.profile, 'workbench-v5-export-'))
    try {
      signal?.throwIfAborted()
      const workbench = path.join(stage, 'workbench')
      const native = path.join(stage, 'native')
      const meta = path.join(stage, 'manifest.json')
      await snapshot(workbenchId, async () => {
      signal?.throwIfAborted()
      delete job.error
      update(options.profile, job, { stage: 'snapshot', files: 0, bytes: 0, report: { ...job.report, data: 'pending', blockers: [] } })
      const definition = options.directory.definition(workbenchId)
      await copyTree(root, workbench, {
        exclude: relative => relative.startsWith('.bay/writer.lock') || relative.startsWith('.bay/creation.json'),
        ...(signal ? { signal } : {}), progress: progress(job),
      })
      const paused = { ...definition, record: { ...definition.record, executionPaused: true } }
      atomicJson(path.join(workbench, '.bay', 'workbench.json'), paused)
      await writeInventory(workbench, path.join(stage, 'files.ndjson'), signal)
      const ids = options.directory.sessionMap(workbenchId)
      const portability = new NativeSessionPortability(options.persistence, options.attachments)
      await portability.exportSnapshot(Object.values(ids), root, native)
      signal?.throwIfAborted()
      if (options.orchestration) {
        const portable = exportTaskSnapshot(definition.record, options.orchestration.load(workbenchId), ids)
        await writeFile(path.join(stage, 'orchestration.json'), JSON.stringify(portable), 'utf8')
      }
      await writeFile(meta, JSON.stringify({
        type: 'workbench-complete', version: 5, schemaVersion: 5, workbenchId,
        record: paused.record, sessionKeys: ids, generatedAt: Date.now(),
        workspacePaths: Object.fromEntries(Object.values(options.directory.getSnapshot().value.workbenches[workbenchId]!.projects ?? options.directory.getSnapshot().value.workbenches[workbenchId]!.areaProjects ?? {}).filter(project => project.workspaceId).map(project => [project.workspaceId!, project.relativePath])),
        packageSha: sha(workbenchId + ':' + requestId), orchestration: options.orchestration ? 'orchestration.json' : undefined,
        ...(options.orchestration ? { orchestrationSha256: await hashFile(path.join(stage, 'orchestration.json')) } : {}),
      }), 'utf8')
      })
      update(options.profile, job, { stage: 'files', bytes: job.bytes, manifestSha256: await hashFile(meta) })
      await mkdir(path.dirname(archive), { recursive: true })
      const output = archive + '.partial'
      await pipeline(c({ cwd: stage, gzip: true, portable: true, noMtime: true, follow: false }, ['manifest.json', 'files.ndjson', 'workbench', 'native', ...(options.orchestration ? ['orchestration.json'] : [])]), createWriteStream(output), ...(signal ? [{ signal }] : []))
      signal?.throwIfAborted()
      await rename(output, archive)
      update(options.profile, job, { stage: 'complete', report: { ...job.report, data: 'complete' } })
      return job
    } catch (error) {
      failed(job, error, signal)
      throw error
    } finally { await rm(stage, { recursive: true, force: true }) }
  }

  const resumeImport = async (job: CompletePackageJob, signal?: AbortSignal): Promise<CompletePackageJob> => {
    signal?.throwIfAborted()
    if (job.kind !== 'import' || !job.stageDir || !job.targetPath || !job.parentPath || !job.folderName) throw new Error('导入作业缺少可恢复信息。')
    const stage = job.stageDir
    if (!existsSync(stage)) throw new Error('导入暂存目录已丢失，无法继续该作业。')
    if (job.archiveSha256 !== undefined && await hashFile(job.path) !== job.archiveSha256) throw new Error('导入归档已被替换，拒绝继续。')
    const { manifest, manifestSha256 } = await readManifest(stage)
    if (job.manifestSha256 !== undefined && job.manifestSha256 !== manifestSha256) throw new Error('导入清单已发生变化，拒绝继续。')
    const target = job.targetPath
    const targetStage = target + '.importing-' + job.id
    await realpath(job.parentPath)
    update(options.profile, job, { stage: 'files' })
    if (!existsSync(target)) await copyTree(path.join(stage, 'workbench'), targetStage, { ...(signal ? { signal } : {}), progress: progress(job) })
    signal?.throwIfAborted()
    const envelope = JSON.parse(await readFile(path.join(stage, 'workbench', '.bay', 'workbench.json'), 'utf8')) as FileWorkbenchV1
    envelope.record.workbenchId = job.workbenchId
    if (job.name) envelope.record.name = job.name
    envelope.record.executionPaused = true
    const snapshot = JSON.parse(await readFile(path.join(stage, 'native', 'native-sessions.json'), 'utf8')) as NativeSessionSnapshot
    const sessionMap = job.sessionMap === undefined
      ? Object.fromEntries(snapshot.sessions.map(row => [row.key, baySessionId('import:' + job.id + ':' + row.key)]))
      : { ...job.sessionMap }
    const logicalSessions = Object.fromEntries(Object.entries(manifest.sessionKeys).map(([key, source]) => {
      if (!sessionMap[source]) throw new Error('原生会话映射缺失：' + key)
      return [key, sessionMap[source]]
    })) as Record<string, string>
    const taskSnapshot = manifest.orchestration ? JSON.parse(await readFile(path.join(stage, manifest.orchestration), 'utf8')) as CompleteTaskSnapshot : undefined
    if (taskSnapshot && !options.orchestration) throw new Error('此宿主不能恢复完整任务快照，请启用 Bay Agent 编排存储。')
    const tasks = taskSnapshot ? restoreTaskSnapshot(taskSnapshot, envelope.record, logicalSessions, job.updatedAt) : undefined
    if (!existsSync(target)) await rename(targetStage, target)
    const workspaces: Record<string, string> = {}
    for (const [source, relative] of Object.entries(manifest.workspacePaths ?? {})) {
      validateTargetName(relative, process.platform)
      workspaces[source] = (await options.workspaces.create(path.join(target, ...relative.split('/')))).id
    }
    remapCompletePageReferences(envelope.record, { ...sessionMap, ...logicalSessions }, workspaces)
    atomicJson(path.join(target, '.bay', 'workbench.json'), envelope)
    update(options.profile, job, { stage: 'sessions', sessionMap, sourceRoot: snapshot.sourceRoot, manifestSha256 })
    const native = new NativeSessionPortability(options.persistence, options.attachments)
    signal?.throwIfAborted()
    await native.importSnapshot(snapshot, path.join(stage, 'native'), { sessionIds: sessionMap, sourceRoot: snapshot.sourceRoot, targetRoot: target })
    signal?.throwIfAborted()
    update(options.profile, job, { stage: 'relations' })
    if (tasks) options.orchestration!.save(job.workbenchId, tasks)
    if (!existsSync(target)) {
      await rename(targetStage, target)
    }
    signal?.throwIfAborted()
    update(options.profile, job, { stage: 'publish' })
    await options.directory.publishImported(target, envelope, logicalSessions)
    update(options.profile, job, { stage: 'complete', report: { ...job.report, data: 'complete', environment: 'needs-setup' } })
    await rm(stage, { recursive: true, force: true })
    return job
  }

  const importPackage = async (input: Record<string, unknown>, existing?: CompletePackageJob, signal?: AbortSignal) => {
    signal?.throwIfAborted()
    const archive = String(input.path)
    const parentPath = await realpath(String(input.parentPath))
    const folderName = folder(String(input.folderName))
    const requestId = String(input.requestId || randomUUID())
    const prior = existing ?? persistedJobForRequest(options.profile, requestId)
    if (prior && (prior.kind !== 'import' || path.resolve(prior.path) !== path.resolve(archive) || prior.parentPath !== parentPath || prior.folderName !== folderName)) throw new PackageRequestError(409, '重复导入请求与原作业不同。')
    if (prior?.kind === 'import' && prior.stageDir) return prior.stage === 'complete' ? prior : resumeImport(prior, signal)
    const archiveSha256 = await hashFile(archive)
    const id = prior?.id ?? randomUUID()
    const stageDir = stagingDirectory(options.profile, id)
    const checked = await extractPackage(archive, stageDir)
    signal?.throwIfAborted()
    const workbenchId = importedWorkbenchId(options.directory, checked.manifest.workbenchId, id)
    const targetPath = path.join(parentPath, folderName)
    if (existsSync(targetPath)) throw new Error('目标工作台文件夹已存在，请选择其他名称。')
    const job: CompletePackageJob = {
      ...prior,
      version: 5, id, kind: 'import', requestId, workbenchId, path: archive, parentPath, folderName,
      stageDir, targetPath, archiveSha256, manifestSha256: checked.manifestSha256, stage: 'snapshot', files: 0, bytes: 0, updatedAt: Date.now(),
      report: { data: 'pending', environment: 'unchecked', tasks: 'waiting-for-user', blockers: [], exclusions: [], environmentSteps: ['请在导入完成后主动检查插件和模型映射。'] },
    }
    saveJob(options.profile, job)
    try { return await resumeImport(job, signal) }
    catch (error) { failed(job, error, signal); throw error }
  }

  const launch = (job: CompletePackageJob): CompletePackageJobView => {
    if (disposed) throw new PackageRequestError(503, '完整包服务正在关闭。')
    if (job.replacementDirectoryId) throw new PackageRequestError(409, '此作业已返回目录设置，请从新的目录选择继续导入。')
    if (job.stage === 'complete' || running.has(job.id)) return view(job)
    const abort = new AbortController()
    delete job.error
    update(options.profile, job, { stage: 'queued', report: { ...job.report, data: 'pending', blockers: [] } })
    const promise = Promise.resolve().then(() => job.kind === 'export'
      ? exportPackage({ workbenchId: job.workbenchId, requestId: job.requestId, path: job.path }, job, abort.signal)
      : importPackage({ path: job.path, parentPath: job.parentPath, folderName: job.folderName, requestId: job.requestId }, job, abort.signal))
      .catch(error => { const current = persistedJob(options.profile, job.id) ?? job; failed(current, error, abort.signal); return current })
      .finally(() => running.delete(job.id))
    running.set(job.id, { abort, promise })
    return view(job)
  }
  const jobForStart = (input: Record<string, unknown>, context: WorkbenchAccessContext, kind: 'export' | 'import', location: { archive: string; parentPath?: string; folderName?: string; uploadId?: string }) => {
    const workbenchId = kind === 'import' ? importScope(input, context) : text(input, 'workbenchId'), requestId = validId(text(input, 'requestId'))
    const name = typeof input.name === 'string' ? input.name.trim().slice(0, 160) : undefined
    const inputDigest = sha(JSON.stringify({ kind, workbenchId, uploadId: location.uploadId, parentPath: location.parentPath, folderName: location.folderName, ...(name ? { name } : {}) }))
    const prior = persistedJobForRequest(options.profile, requestId)
    if (prior) {
      owned(context, prior)
      if (prior.kind !== kind || prior.inputDigest !== inputDigest) throw new PackageRequestError(409, '此请求标识已用于另一项完整包操作。')
      if (prior.stage !== 'complete' && !running.has(prior.id)) authorize(context, workbenchId)
      return prior
    }
    authorize(context, workbenchId)
    const job: CompletePackageJob = { version: 5, id: randomUUID(), kind, requestId, workbenchId, accessWorkbenchId: workbenchId, ownerAccessId: context.accessId,
      inputDigest, path: location.archive, ...(name ? { name } : {}), ...(location.parentPath ? { parentPath: location.parentPath } : {}), ...(location.folderName ? { folderName: location.folderName } : {}), ...(location.uploadId ? { uploadId: location.uploadId } : {}),
      stage: 'queued', files: 0, bytes: 0, updatedAt: Date.now(), report: { data: 'pending', environment: 'unchecked', tasks: 'waiting-for-user', blockers: [], exclusions: [], environmentSteps: ['导入后由用户主动恢复插件、模型和工具链。'] } }
    saveJob(options.profile, job)
    return job
  }
  const replyError = (error: unknown) => {
    const status = typeof error === 'object' && error !== null && 'status' in error && typeof error.status === 'number' && error.status >= 400 && error.status <= 599 ? error.status : 400
    return Response.json({ error: message(error) }, { status, headers: { 'cache-control': 'no-store' } })
  }
  const tickets = new Map<string, { context: WorkbenchAccessContext; jobId: string; expires: number }>()
  const offUpload = connection.fetch.register({ path: WORKBENCH_COMPLETE_UPLOAD_ROUTE, methods: ['POST'], requestBody: 'streaming', async fetch(request) {
    try {
      const context = actor(request), id = validId(new URL(request.url).searchParams.get('id') ?? '')
      return await lock('upload:' + id, async () => {
        const upload = readUpload(id, context)
        authorize(context, upload.workbenchId)
        if (upload.state !== 'uploading') throw new PackageRequestError(409, '上传作业已结束或取消。')
        const offset = Number(request.headers.get('x-bay-upload-offset')), length = Number(request.headers.get('x-bay-upload-length'))
        const requestId = validId(request.headers.get('x-bay-request-id') ?? '')
        if (!request.headers.has('x-bay-upload-offset') || !Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(length) || length <= 0 || length > WORKBENCH_COMPLETE_CHUNK_BYTES || offset + length > upload.size) throw new PackageRequestError(400, '上传分块范围无效。')
        const repeated = upload.lastChunk?.requestId === requestId && upload.lastChunk.offset === offset && upload.lastChunk.length === length
        if (offset !== upload.received && !repeated) throw new PackageRequestError(409, '上传位置冲突，请查询已接收字节后继续。')
        const file = await open(uploadFilePath(options.profile, id), 'r+')
        const hash = createHash('sha256'); let received = 0
        try {
          for await (const chunk of request.body ?? []) {
            request.signal.throwIfAborted(); received += chunk.byteLength
            if (received > length) throw new PackageRequestError(413, '上传分块超过声明长度。')
            hash.update(chunk)
            if (!repeated) { let written = 0; while (written < chunk.byteLength) { const result = await file.write(chunk, written, chunk.byteLength - written, offset + received - chunk.byteLength + written); if (!result.bytesWritten) throw new Error('上传文件写入中断。'); written += result.bytesWritten } }
          }
          if (received !== length) throw new PackageRequestError(400, '上传分块不完整。')
          const digest = hash.digest('hex')
          authorize(context, upload.workbenchId)
          if (repeated) { if (digest !== upload.lastChunk!.hash) throw new PackageRequestError(409, '重复上传分块的内容不同。') }
          else {
            await file.sync()
            upload.received += length; upload.updatedAt = Date.now(); upload.lastChunk = { offset, length, requestId, hash: digest }
            atomicJson(uploadMetaPath(options.profile, id), upload)
          }
        } catch (error) { if (!repeated) await file.truncate(upload.received); throw error }
        finally { await file.close() }
        return Response.json({ value: publicUpload(upload) }, { headers: { 'cache-control': 'no-store' } })
      })
    } catch (error) { return replyError(error) }
  } })
  const offDownload = connection.fetch.register({ path: WORKBENCH_COMPLETE_DOWNLOAD_ROUTE, methods: ['GET', 'HEAD'], requestBody: 'buffered', async fetch(request) {
    try {
      const params = new URL(request.url).searchParams, ticket = params.get('ticket')
      const grant = ticket ? tickets.get(ticket) : undefined
      if (!grant || grant.expires < Date.now()) throw new PackageRequestError(403, '下载许可已失效，请重新点击下载。')
      const context = grant.context.actor === 'desktop' ? actor(request) : options.access?.getContext(grant.context.accessId) ?? grant.context
      if (context.accessId !== grant.context.accessId) throw new PackageRequestError(403, '下载主控身份已改变。')
      const job = readJob(grant.jobId, context)
      if (job.kind !== 'export' || job.stage !== 'complete') throw new PackageRequestError(409, '导出尚未完成。')
      const size = (await stat(job.path)).size
      let start = 0, end = size - 1, status = 200
      const range = request.headers.get('range')
      if (range) {
        const parsed = /^bytes=(\d*)-(\d*)$/u.exec(range)
        if (!parsed || !parsed[1] && !parsed[2]) return new Response(null, { status: 416, headers: { 'content-range': `bytes */${size}` } })
        if (!parsed[1]) start = Math.max(0, size - Number(parsed[2]))
        else { start = Number(parsed[1]); if (parsed[2]) end = Math.min(size - 1, Number(parsed[2])) }
        if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end || start >= size) return new Response(null, { status: 416, headers: { 'content-range': `bytes */${size}` } })
        status = 206
      }
      const headers = { 'content-type': 'application/gzip', 'content-length': String(end - start + 1), 'accept-ranges': 'bytes', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer',
        'content-disposition': `attachment; filename="workbench-${job.id}.tar.gz"`, ...(status === 206 ? { 'content-range': `bytes ${start}-${end}/${size}` } : {}) }
      return new Response(request.method === 'HEAD' ? null : Readable.toWeb(createReadStream(job.path, { start, end, signal: request.signal })) as ReadableStream<Uint8Array>, { status, headers })
    } catch (error) { return replyError(error) }
  } })
  const offControl = connection.fetch.register({ path: WORKBENCH_COMPLETE_ROUTE, methods: ['POST'], requestBody: 'streaming', async fetch(request) {
    try {
      if (disposed) throw new PackageRequestError(503, '完整包服务正在关闭。')
      const context = actor(request)
      const input = await load(request)
      const action = String(input.action)
      let value: unknown
      if (action === 'start-export') {
        value = await lock('start:' + text(input, 'requestId'), async () => launch(jobForStart(input, context, 'export', { archive: path.join(jobDirectory(options.profile), 'archives', randomUUID() + '.tar.gz') })))
      } else if (action === 'upload-begin') {
        const workbenchId = importScope(input, context), requestId = validId(text(input, 'requestId')), name = path.basename(text(input, 'name')), size = Number(input.size)
        authorize(context, workbenchId)
        if (!Number.isSafeInteger(size) || size < 1) throw new PackageRequestError(400, '上传文件大小无效。')
        value = await lock('upload-begin:' + requestId, async () => {
          const prior = records<StoredUpload>(path.join(jobDirectory(options.profile), 'uploads')).find(row => row.requestId === requestId)
          if (prior) { owned(context, prior); if (prior.size !== size || prior.name !== name || prior.workbenchId !== workbenchId) throw new PackageRequestError(409, '上传请求与原文件不同。'); return publicUpload(prior) }
          const upload: StoredUpload = { id: randomUUID(), requestId, ownerAccessId: context.accessId, workbenchId, name, size, received: 0, state: 'uploading', updatedAt: Date.now() }
          await mkdir(path.dirname(uploadFilePath(options.profile, upload.id)), { recursive: true })
          await writeFile(uploadFilePath(options.profile, upload.id), new Uint8Array(), { flag: 'wx' })
          atomicJson(uploadMetaPath(options.profile, upload.id), upload)
          return publicUpload(upload)
        })
      } else if (action === 'upload-status') value = publicUpload(readUpload(text(input, 'id'), context))
      else if (action === 'upload-finish') {
        const id = text(input, 'id')
        value = await lock('upload:' + id, async () => {
          const upload = readUpload(id, context); authorize(context, upload.workbenchId)
          if (upload.state === 'cancelled' || upload.received !== upload.size) throw new PackageRequestError(409, '上传尚未完成或已取消。')
          const archiveSha256 = await hashFile(uploadFilePath(options.profile, id))
          const checked = await ephemeralPreflight(uploadFilePath(options.profile, id))
          try {
            upload.preflight = { valid: true, workbenchId: checked.manifest.workbenchId, sessionCount: Object.keys(checked.manifest.sessionKeys).length, manifestSha256: checked.manifestSha256, overview: checked.overview }
            upload.archiveSha256 = archiveSha256; upload.state = 'ready'; upload.updatedAt = Date.now(); atomicJson(uploadMetaPath(options.profile, id), upload)
            return upload.preflight
          }
          finally { await rm(checked.stage, { recursive: true, force: true }) }
        })
      } else if (action === 'upload-cancel') {
        const id = text(input, 'id')
        value = await lock('upload:' + id, async () => { const upload = readUpload(id, context); authorize(context, upload.workbenchId); upload.state = 'cancelled'; upload.updatedAt = Date.now(); atomicJson(uploadMetaPath(options.profile, id), upload); return publicUpload(upload) })
      } else if (action === 'directory-request') {
        const upload = readUpload(text(input, 'uploadId'), context), id = validId(text(input, 'requestId')); authorize(context, upload.workbenchId)
        if (upload.state !== 'ready') throw new PackageRequestError(409, '请先完成上传和预检。')
        const prior = readRecord<StoredDirectoryRequest>(directoryRequestPath(options.profile, id))
        if (prior) { owned(context, prior); if (prior.uploadId !== upload.id) throw new PackageRequestError(409, '目录请求已用于其他上传。'); value = publicDirectory(prior) }
        else { const selection: StoredDirectoryRequest = { id, uploadId: upload.id, workbenchId: upload.workbenchId, ownerAccessId: context.accessId, state: 'pending', updatedAt: Date.now() }; atomicJson(directoryRequestPath(options.profile, id), selection); value = publicDirectory(selection) }
      } else if (action === 'directory-status') value = publicDirectory(readDirectory(text(input, 'id'), context))
      else if (action === 'directory-pending') {
        if (context.actor !== 'desktop') throw new PackageRequestError(403, '请在 DSH 客户端选择目标目录。')
        value = records<StoredDirectoryRequest>(path.join(jobDirectory(options.profile), 'directories')).filter(row => row.state === 'pending').map(publicDirectory)
      } else if (action === 'directory-complete') {
        if (context.actor !== 'desktop') throw new PackageRequestError(403, '目标目录只能由 DSH 客户端选择。')
        const id = text(input, 'id')
        value = await lock('directory:' + id, async () => {
          const selection = readDirectory(id, context)
          if (selection.state !== 'pending') throw new PackageRequestError(409, '此目录选择请求已处理。')
          if (input.cancelled === true) selection.state = 'cancelled'
          else { selection.parentPath = await realpath(text(input, 'parentPath')); if (!(await stat(selection.parentPath)).isDirectory()) throw new PackageRequestError(400, '目标父目录不可用。'); selection.state = 'selected' }
          selection.updatedAt = Date.now(); atomicJson(directoryRequestPath(options.profile, id), selection); return publicDirectory(selection)
        })
      } else if (action === 'start-import') {
        const upload = readUpload(text(input, 'uploadId'), context), selection = readDirectory(text(input, 'directoryRequestId'), context)
        if (selection.uploadId !== upload.id || !selection.parentPath || !['selected', 'consumed'].includes(selection.state) || upload.state !== 'ready') throw new PackageRequestError(409, '目标目录尚未获得 DSH 客户端确认。')
        if (importScope(input, context) !== upload.workbenchId) throw new PackageRequestError(403, '上传不属于此工作台。')
        const name = folder(text(input, 'folderName'))
        value = await lock('directory:' + selection.id, async () => {
          const currentSelection = readDirectory(selection.id, context)
          if (currentSelection.jobId && persistedJob(options.profile, currentSelection.jobId)?.requestId !== text(input, 'requestId')) throw new PackageRequestError(409, '目录许可已用于另一个导入作业。')
          // Do not consume the selection or create a job for an invalid destination.
          if (!currentSelection.jobId && existsSync(path.join(selection.parentPath!, name))) throw new PackageRequestError(409, '目标工作台文件夹已存在，请修改文件夹名称或重新选择位置。')
          if (await hashFile(uploadFilePath(options.profile, upload.id)) !== upload.archiveSha256) throw new PackageRequestError(409, '上传归档已发生变化。')
          const job = jobForStart(input, context, 'import', { archive: uploadFilePath(options.profile, upload.id), parentPath: selection.parentPath!, folderName: name, uploadId: upload.id })
          currentSelection.state = 'consumed'; currentSelection.jobId = job.id; currentSelection.updatedAt = Date.now(); atomicJson(directoryRequestPath(options.profile, selection.id), currentSelection)
          return launch(job)
        })
      } else if (action === 'reset-import-location') {
        const job = readJob(text(input, 'id'), context)
        authorizeJobMutation(context, job)
        value = await lock('job:' + job.id, async () => {
          const upload = readUpload(job.uploadId ?? '', context)
          if (job.replacementDirectoryId) return { selection: publicDirectory(readDirectory(job.replacementDirectoryId, context)), upload: publicUpload(upload), preflight: upload.preflight }
          if (!view(job).canChangeDestination) throw new PackageRequestError(409, '此作业已经开始恢复数据，请继续原作业。')
          const id = 'retry-' + job.id
          const selection: StoredDirectoryRequest = { id, uploadId: job.uploadId!, workbenchId: job.accessWorkbenchId ?? '', ownerAccessId: context.accessId, parentPath: job.parentPath!, state: 'selected', updatedAt: Date.now() }
          atomicJson(directoryRequestPath(options.profile, id), selection)
          update(options.profile, job, { replacementDirectoryId: id, stage: 'cancelled' })
          return { selection: publicDirectory(selection), upload: publicUpload(upload), preflight: upload.preflight }
        })
      } else if (action === 'jobs') {
        const workbenchId = importScope(input, context); authorize(context, workbenchId, false)
        value = records<CompletePackageJob>(jobDirectory(options.profile)).filter(job => input.allImports === true && context.actor === 'desktop' ? job.kind === 'import' : (job.accessWorkbenchId ?? job.workbenchId) === workbenchId && (context.actor === 'desktop' || job.ownerAccessId === context.accessId)).map(view)
      } else if (action === 'cancel') {
        const job = readJob(text(input, 'id'), context)
        authorizeJobMutation(context, job, true)
        running.get(job.id)?.abort.abort(new Error('用户取消了完整包作业。'))
        if (!running.has(job.id) && job.stage !== 'complete') failed(job, new Error('用户取消了完整包作业。'), AbortSignal.abort())
        value = view(job)
      } else if (action === 'download-ticket') {
        const job = readJob(text(input, 'id'), context)
        if (job.kind !== 'export' || job.stage !== 'complete') throw new PackageRequestError(409, '请等待导出完成。')
        for (const [key, grant] of tickets) if (grant.expires < Date.now()) tickets.delete(key)
        const ticket = randomUUID(); tickets.set(ticket, { context, jobId: job.id, expires: Date.now() + 5 * 60_000 })
        value = { url: WORKBENCH_COMPLETE_DOWNLOAD_ROUTE + '?ticket=' + ticket }
      } else if (action === 'export') { authorize(context, text(input, 'workbenchId')); if (context.actor !== 'desktop') throw new PackageRequestError(403, '浏览器请使用异步导出入口。'); value = await exportPackage(input) }
      else if (action === 'import') { if (context.actor !== 'desktop') throw new PackageRequestError(403, '浏览器导入必须使用已确认的上传及目录许可。'); value = await importPackage(input) }
      else if (action === 'resume') {
        const job = readJob(text(input, 'id'), context)
        authorizeJobMutation(context, job)
        value = launch(job)
      } else if (action === 'status') value = view(readJob(text(input, 'id'), context))
      else if (action === 'preflight') {
        if (context.actor !== 'desktop') throw new PackageRequestError(403, '浏览器只能预检已上传的完整包。')
        const result = await ephemeralPreflight(String(input.path))
        try { value = { valid: true, manifest: result.manifest, manifestSha256: result.manifestSha256 } }
        finally { await rm(result.stage, { recursive: true, force: true }) }
      } else throw new Error('不支持的完整包操作。')
      return Response.json({ value }, { headers: { 'cache-control': 'no-store' } })
    } catch (error) {
      return replyError(error)
    }
  }})
  return async () => {
    disposed = true; tickets.clear()
    for (const task of running.values()) task.abort.abort(new Error('完整包服务已停止，可在下次启动后继续。'))
    await Promise.allSettled([...running.values()].map(task => task.promise))
    await Promise.allSettled([offControl(), offUpload(), offDownload()])
  }
}
