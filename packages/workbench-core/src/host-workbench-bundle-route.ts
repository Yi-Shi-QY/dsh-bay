import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, readdir, rm, lstat, stat, writeFile, rename } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import type { HostConnectionHandle } from '@deepseek-ai/dsh-client-connection'
import type { HostWorkbenchAccess } from './host-workbench-access.ts'
import { WORKBENCH_BUNDLE_MAX_BYTES, WORKBENCH_BUNDLE_MAX_FILE_BYTES, WORKBENCH_BUNDLE_ROUTE, type WorkbenchBundleExportCheckV1, type WorkbenchBundleExportStage, type WorkbenchBundleExtensionProblemV1, type WorkbenchBundleImportResultV1, type WorkbenchBundleImportStage, type WorkbenchBundleInspectionV1, type WorkbenchBundleJobV1, type WorkbenchBundleProgressV1 } from './workbench-bundle-contract.ts'
import { buildWorkbenchBundle, readWorkbenchBundle, workbenchBundleFilename, type WorkbenchBundleKind, type WorkbenchBundleManifestV1 } from './workbench-bundle.ts'
import { createWorkbenchSnapshot, normalizeSnapshotPath } from './workbench-snapshot.ts'
import type { HostWorkbenchDirectory } from './host-workbench-directory.ts'
import type { FileWorkbenchV1 } from './workbench-directory-contract.ts'
import { canonicalJson } from './foundation/workbench-sharing.ts'
import { WORKBENCH_DSH_GENERATION } from './release-compatibility.ts'
import { areasOf } from './foundation/document-v3.ts'
import type { WorkbenchSessionCheckpointSource } from './workbench-session-checkpoint.ts'
import type { WorkbenchSessionCheckpointRestorer } from './workbench-session-checkpoint.ts'
import type { SessionPersistence } from '@deepseek-ai/dsh-session-persistence'
import { existsSync } from 'node:fs'
import type { CompleteExtensions } from './host-complete-extensions.ts'
import type { CompleteExtensionLock, CompletePlatform } from './workbench-complete-contract.ts'

interface BundleRouteOptions {
  directory: HostWorkbenchDirectory
  access?: HostWorkbenchAccess
  checkpoint?: WorkbenchSessionCheckpointSource
  checkpointRestorer?: WorkbenchSessionCheckpointRestorer
  sessionPersistence?: SessionPersistence
  /** Collects the extensions a workbench's inner pages use and embeds their artifacts. */
  extensions?: () => CompleteExtensions | undefined
  /** Receives the consents recorded while installing embedded extensions. */
  saveExtensionConsents?: (consents: Record<string, import('./workbench-extension-access.ts').WorkbenchExtensionConsentV1>) => Promise<void>
}

interface BundleRouteOptions {
  directory: HostWorkbenchDirectory
  access?: HostWorkbenchAccess
  checkpoint?: WorkbenchSessionCheckpointSource
  checkpointRestorer?: WorkbenchSessionCheckpointRestorer
  sessionPersistence?: SessionPersistence
}

const text = (value: unknown, field: string): string => {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`缺少字段：${field}`)
  return value
}

async function readBody(request: Request): Promise<Uint8Array> {
  const chunks: Uint8Array[] = []
  let size = 0
  for await (const chunk of request.body ?? []) {
    size += chunk.length
    if (size > WORKBENCH_BUNDLE_MAX_BYTES) throw new Error('工作台包超过 512 MB 限制。')
    chunks.push(chunk)
  }
  const result = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length }
  return result
}

/** Folders never packaged: version control, installed dependencies and DSH's own state. */
const EXCLUDED_FOLDERS = new Set(['.git', '.dshbay', 'node_modules'])

/** Items left out of a package by a fixed rule; reported once after export. */
interface SkippedItems { symlinks: string[]; private: string[] }

const isPrivatePath = (value: string): boolean => {
  try { normalizeSnapshotPath(value); return false } catch { return true }
}

function skippedNotices(skipped: SkippedItems): { sessionKey: string; reason: string }[] {
  const sample = (rows: string[]) => rows.slice(0, 5).join('、') + (rows.length > 5 ? ' 等' : '')
  return [
    ...(skipped.symlinks.length ? [{ sessionKey: '符号链接', reason: `已跳过 ${skipped.symlinks.length} 个符号链接：${sample(skipped.symlinks)}` }] : []),
    ...(skipped.private.length ? [{ sessionKey: '私密文件', reason: `已跳过 ${skipped.private.length} 个可能含凭据或本机缓存的文件：${sample(skipped.private)}` }] : []),
  ]
}

async function walkFiles(root: string, skipped: SkippedItems, relative = ''): Promise<{ path: string; content: Uint8Array }[]> {
  const folder = path.join(root, relative)
  const rows = await readdir(folder, { withFileTypes: true })
  const result: { path: string; content: Uint8Array }[] = []
  for (const row of rows.sort((left, right) => left.name.localeCompare(right.name))) {
    if (EXCLUDED_FOLDERS.has(row.name.toLowerCase())) continue
    const next = relative ? `${relative}/${row.name}` : row.name
    const full = path.join(root, next)
    const info = await lstat(full)
    if (info.isSymbolicLink()) { skipped.symlinks.push(next); continue }
    if (isPrivatePath(next)) { skipped.private.push(next); continue }
    if (info.isDirectory()) result.push(...await walkFiles(root, skipped, next))
    else if (info.isFile()) {
      if (info.size > WORKBENCH_BUNDLE_MAX_FILE_BYTES) throw new Error(`文件超过工作台包限制：${next}`)
      result.push({ path: next.replaceAll(path.sep, '/'), content: new Uint8Array(await readFile(full)) })
    }
  }
  return result
}

type BundlePayloadKind = 'layout' | 'project-metadata' | 'project-file' | 'memory' | 'task' | 'session-checkpoint' | 'attachment' | 'extension' | 'environment'

async function walkManagedFiles(root: string, relative: string, outputPath: string, kind: BundlePayloadKind, skipped: SkippedItems): Promise<{ path: string; kind: BundlePayloadKind; content: Uint8Array }[]> {
  const folder = path.join(root, '.dshbay', relative)
  if (!existsSync(folder)) return []
  const rows = await readdir(folder, { withFileTypes: true })
  const result: { path: string; kind: BundlePayloadKind; content: Uint8Array }[] = []
  for (const row of rows.sort((left, right) => left.name.localeCompare(right.name))) {
    if (row.name === 'local' || row.name === 'cache' || row.name === 'writer.lock' || row.name === 'workbench.json') continue
    const next = relative ? `${relative}/${row.name}` : row.name
    const full = path.join(root, '.dshbay', next)
    const info = await lstat(full)
    if (info.isSymbolicLink()) { skipped.symlinks.push(`.dshbay/${next}`); continue }
    if (isPrivatePath(`${outputPath}/${row.name}`)) { skipped.private.push(`.dshbay/${next}`); continue }
    if (info.isDirectory()) result.push(...await walkManagedFiles(root, next, `${outputPath}/${row.name}`, kind, skipped))
    else if (info.isFile()) {
      if (info.size > WORKBENCH_BUNDLE_MAX_FILE_BYTES) throw new Error(`文件超过工作台包限制：.dshbay/${next}`)
      result.push({ path: `${outputPath}/${row.name}`, kind, content: new Uint8Array(await readFile(full)) })
    }
  }
  return result
}

async function walkFolder(folder: string, outputPath: string, kind: BundlePayloadKind, skipped: SkippedItems): Promise<{ path: string; kind: BundlePayloadKind; content: Uint8Array }[]> {
  if (!existsSync(folder)) return []
  const result: { path: string; kind: BundlePayloadKind; content: Uint8Array }[] = []
  for (const row of (await readdir(folder, { withFileTypes: true })).sort((left, right) => left.name.localeCompare(right.name))) {
    const full = path.join(folder, row.name)
    const info = await lstat(full)
    if (info.isSymbolicLink()) { skipped.symlinks.push(full); continue }
    if (isPrivatePath(`${outputPath}/${row.name}`)) { skipped.private.push(full); continue }
    if (info.isDirectory()) result.push(...await walkFolder(full, `${outputPath}/${row.name}`, kind, skipped))
    else if (info.isFile()) {
      if (info.size > WORKBENCH_BUNDLE_MAX_FILE_BYTES) throw new Error(`文件超过工作台包限制：${full}`)
      result.push({ path: `${outputPath}/${row.name}`, kind, content: new Uint8Array(await readFile(full)) })
    }
  }
  return result
}

/** Bundle prefix for a project's `<relativePath>/.dshbay` metadata, which snapshot paths may not name directly. */
const PROJECT_META_PREFIX = 'project-meta/'

/**
 * Every Area project keeps its identity, background and memory in
 * `<relativePath>/.dshbay`. The importer cannot load a project without
 * `project.json`, so both package kinds carry it.
 */
async function readProjectMetadata(root: string, record: FileWorkbenchV1['record'], skipped: SkippedItems): Promise<{ path: string; kind: BundlePayloadKind; content: Uint8Array }[]> {
  const result: { path: string; kind: BundlePayloadKind; content: Uint8Array }[] = []
  for (const project of Object.values(record.projects ?? {})) {
    const folder = path.join(root, ...project.relativePath.split('/'), '.dshbay')
    const prefix = `${PROJECT_META_PREFIX}${project.projectId}`
    for (const name of ['project.json', 'context.md']) {
      const file = path.join(folder, name)
      if (existsSync(file)) result.push({ path: `${prefix}/${name}`, kind: 'project-metadata', content: new Uint8Array(await readFile(file)) })
    }
    result.push(...await walkFolder(path.join(folder, 'memory'), `${prefix}/memory`, 'memory', skipped))
  }
  return result
}

async function readManagedPayload(root: string, bundleKind: WorkbenchBundleKind, skipped: SkippedItems): Promise<{ path: string; kind: BundlePayloadKind; content: Uint8Array }[]> {
  const result: { path: string; kind: BundlePayloadKind; content: Uint8Array }[] = []
  const locks: readonly [string, string, BundlePayloadKind][] = [
    ['environment.lock.json', 'meta/environment.lock.json', 'environment'],
  ]
  for (const [name, target, kind] of locks) {
    const source = path.join(root, '.dshbay', name)
    const content = new Uint8Array(existsSync(source) ? await readFile(source) : Buffer.from('{}\n'))
    result.push({ path: target, kind, content })
  }
  result.push(...await walkManagedFiles(root, 'memory', 'memory', 'memory', skipped))
  result.push(...await walkManagedFiles(root, 'tasks', 'tasks', 'task', skipped))
  if (bundleKind === 'complete') {
    result.push(...await walkManagedFiles(root, 'objects', 'objects', 'attachment', skipped))
    result.push(...await walkManagedFiles(root, 'sessions/checkpoints', 'sessions/checkpoints', 'session-checkpoint', skipped))
  }
  return result
}

/**
 * Pages keep their session binding only when that session's history travels
 * with the package. Every other session page becomes a pending page the user
 * reconnects; a session page with neither is not a valid document.
 */
function portableImportedRecord(source: FileWorkbenchV1['record'], workbenchId: string, includeSessions = false, keepBindings: ReadonlySet<string> = new Set()) {
  const record = structuredClone(source)
  record.workbenchId = workbenchId
  record.executionPaused = true
  delete record.bayAgentSession
  if (!includeSessions) record.sessionCatalog = {}
  else {
    record.sessionCatalog = Object.fromEntries(Object.entries(record.sessionCatalog ?? {}).map(([key, entry]) => [key, { ...entry }]))
  }
  let pending = 0
  for (const area of areasOf(record.document.root)) {
    area.moduleHistory = area.moduleHistory.map(page => {
      if (includeSessions && page.binding && keepBindings.has(page.binding.sessionId)) return page
      const { binding: _binding, pendingBinding: _pending, bindingGeneration: _generation, sessionStates: _states, sessionStateOrder: _order, ...rest } = page
      if (page.editorScope !== 'session') return rest
      pending += 1
      if (pending > 999) throw new Error('待重新连接的对话内页超过 999 个。')
      return { ...rest, pendingBinding: `binding-${pending}` }
    })
  }
  return record
}

const bundlePlatform = (): CompletePlatform => {
  if (process.platform === 'win32' || process.platform === 'darwin' || process.platform === 'linux') return process.platform
  throw new Error('当前系统不支持工作台扩展打包。')
}

export interface WorkbenchBundleExportNoticeV1 { sessionKey: string; reason: string }

/**
 * Extensions the workbench's inner pages use, embedded when their policy allows
 * it and listed as external dependencies otherwise. Sharing a workbench without
 * the pages it is built from would make the imported copy unloadable.
 */
async function extensionPayload(extensions: CompleteExtensions, record: FileWorkbenchV1['record'], staging: string): Promise<{
  entries: { path: string; kind: BundlePayloadKind; content: Uint8Array }[]
  externalDependencies: NonNullable<WorkbenchBundleManifestV1['externalDependencies']>
  notices: { sessionKey: string; reason: string }[]
}> {
  const collected = await extensions.collect(record, staging, bundlePlatform(), [], { packaging: true })
  const locks = collected.locks
  const entries: { path: string; kind: BundlePayloadKind; content: Uint8Array }[] = []
  const externalDependencies: { id: string; version?: string; digest?: string; reason: string }[] = []
  const declared = new TextEncoder().encode(canonicalJson(locks))
  entries.push({ path: 'meta/extensions.lock.json', kind: 'extension', content: declared })
  for (const lock of locks) {
    if (lock.exportPolicy === 'forbid') throw new Error(`扩展禁止被打包：${lock.packageName}`)
    if (lock.exportPolicy === 'embed' && lock.artifactPath) {
      entries.push({ path: lock.artifactPath, kind: 'extension', content: new Uint8Array(await readFile(path.join(staging, lock.artifactPath))) })
    } else {
      externalDependencies.push({ id: lock.packageName, version: lock.version, digest: `sha256:${lock.artifactSha256}`, reason: '扩展声明为引用安装，接收方需自行安装同一制品' })
    }
  }
  return { entries, externalDependencies, notices: collected.notices.map(notice => ({ sessionKey: notice.packageName, reason: notice.reason })) }
}

export async function buildExport(directory: HostWorkbenchDirectory, workbenchId: string, kind: WorkbenchBundleKind, checkpoint?: WorkbenchSessionCheckpointSource, extensions?: CompleteExtensions, onProgress?: (progress: WorkbenchBundleProgressV1<WorkbenchBundleExportStage>) => void) {
  const report = onProgress ?? (() => {})
  report({ stage: 'collect', done: 0, total: 0 })
  const definition = directory.definition(workbenchId)
  const registeredSessions = directory.sessionMap(workbenchId)
  const definitionWithSessions: FileWorkbenchV1 = {
    ...definition,
    record: {
      ...definition.record,
      ...(definition.record.sessionCatalog === undefined ? {} : {
        sessionCatalog: Object.fromEntries(Object.entries(definition.record.sessionCatalog).map(([key, entry]) => [key, { ...entry, ...(registeredSessions[key] === undefined ? {} : { sessionId: registeredSessions[key] }) }]))
      }),
    },
  }
  const root = directory.rootPath(workbenchId)
  // Active session ids and runtime bindings are device-local. Keep the layout
  // portable while complete snapshots carry only closed/checkpointed content.
  const sessionEntries = Object.entries(definitionWithSessions.record.sessionCatalog ?? {})
  if (kind === 'complete' && sessionEntries.length > 0 && checkpoint === undefined) throw new Error('complete 工作台包需要 RC3 Session checkpoint 服务')
  // A session registered without a live identity cannot be checkpointed. Skip
  // it instead of failing the whole export; the notice travels with the result.
  const notices: WorkbenchBundleExportNoticeV1[] = []
  const checkpointable = sessionEntries.filter(([sessionKey, entry]) => {
    if (typeof entry.sessionId === 'string' && entry.sessionId.length > 0) return true
    notices.push({ sessionKey, reason: '会话没有可导出的 Session 身份，已跳过' })
    return false
  })
  const portableDefinition: FileWorkbenchV1 = { ...definitionWithSessions, record: portableImportedRecord(definitionWithSessions.record, definitionWithSessions.record.workbenchId, kind === 'complete', new Set(Object.keys(definitionWithSessions.record.sessionCatalog ?? {}))) }
  const entries: { path: string; kind: BundlePayloadKind; content: Uint8Array }[] = [
    { path: 'layout.json', kind: 'layout', content: new TextEncoder().encode(canonicalJson(portableDefinition)) },
    { path: 'projects.json', kind: 'project-metadata', content: new TextEncoder().encode(canonicalJson(portableDefinition.record.projects ?? {})) },
  ]
  const skipped: SkippedItems = { symlinks: [], private: [] }
  entries.push(...await readManagedPayload(root, kind, skipped))
  entries.push(...await readProjectMetadata(root, definition.record, skipped))
  let externalDependencies: WorkbenchBundleManifestV1['externalDependencies']
  if (extensions) {
    report({ stage: 'extensions', done: 0, total: 0 })
    const staging = await mkdtemp(path.join(path.dirname(root), '.dshbay-extensions-'))
    try {
      const collected = await extensionPayload(extensions, definition.record, staging)
      entries.push(...collected.entries)
      externalDependencies = collected.externalDependencies
      notices.push(...collected.notices)
    } finally { await rm(staging, { recursive: true, force: true }).catch(() => {}) }
  }
  if (kind === 'complete' && checkpoint) {
    for (const [index, [sessionKey, entry]] of checkpointable.entries()) {
      report({ stage: 'sessions', done: index, total: checkpointable.length })
      const sessionId = entry.sessionId!
      try {
        await checkpoint.flushLiveSessionLog(sessionId)
        const session = await checkpoint.sessionLogZipEntries(sessionId)
        for await (const item of session) {
          if (item.path === 'attachments-missing.txt') throw new Error(`Session ${sessionId} checkpoint is missing one or more attachments`)
          const content = item.content !== undefined ? new TextEncoder().encode(item.content)
            : item.data !== undefined ? new Uint8Array(item.data)
              : item.chunks ? await collectChunks(item.chunks) : undefined
          if (!content) throw new Error(`无法读取 Session checkpoint：${sessionId}`)
          entries.push({ path: `sessions/checkpoints/${sessionId}/${item.path}`, kind: 'session-checkpoint', content })
        }
      } catch (error) {
        notices.push({ sessionKey, reason: `会话记录无法读取，已跳过：${error instanceof Error ? error.message : String(error)}` })
        for (let index = entries.length - 1; index >= 0; index -= 1) {
          if (entries[index]!.path.startsWith(`sessions/checkpoints/${sessionId}/`)) entries.splice(index, 1)
        }
      }
    }
  }
  if (kind === 'complete') {
    report({ stage: 'files', done: 0, total: 0 })
    for (const file of await walkFiles(root, skipped)) entries.push({ ...file, kind: 'project-file' })
  }
  notices.push(...skippedNotices(skipped))
  report({ stage: 'pack', done: 0, total: entries.length })
  const snapshot = await createWorkbenchSnapshot({ kind, workbenchId, entries })
  return { ...snapshot, ...(externalDependencies === undefined || externalDependencies.length === 0 ? {} : { externalDependencies }), notices }
}

async function collectChunks(chunks: AsyncIterable<Uint8Array>): Promise<Uint8Array> {
  const values: Uint8Array[] = []
  for await (const chunk of chunks) values.push(chunk)
  const content = new Uint8Array(values.reduce((total, chunk) => total + chunk.byteLength, 0))
  let offset = 0
  for (const chunk of values) { content.set(chunk, offset); offset += chunk.byteLength }
  return content
}

function inspection(bundle: Awaited<ReturnType<typeof readWorkbenchBundle>>): WorkbenchBundleInspectionV1 {
  const manifest = bundle.manifest
  const layoutEntry = manifest.entries.find(entry => entry.path === 'layout.json' && !entry.deleted)
  const layout = layoutEntry && bundle.objects.find(object => object.digest === layoutEntry.digest)
  let name = manifest.workbenchId
  if (layout) {
    try {
      const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(layout.content)) as { record?: { name?: unknown } }
      if (typeof value.record?.name === 'string' && value.record.name.trim()) name = value.record.name
    } catch { /* the reader has already validated the entry digest; import will report malformed layout */ }
  }
  return {
    valid: true,
    manifest,
    filename: workbenchBundleFilename(name),
    fileCount: manifest.entries.filter(entry => !entry.deleted).length,
    bytes: manifest.entries.reduce((sum, entry) => sum + entry.size, 0),
    projectFileCount: manifest.entries.filter(entry => entry.kind === 'project-file' && !entry.deleted).length,
    externalDependencyCount: manifest.externalDependencies?.length ?? 0,
  }
}

function importedPayloadPath(value: string): string {
  if (value === 'meta/extensions.lock.json') return '.dshbay/extensions.lock.json'
  if (value === 'meta/environment.lock.json') return '.dshbay/environment.lock.json'
  if (value.startsWith('extensions/')) return `.dshbay/${value}`
  if (value.startsWith('memory/')) return `.dshbay/${value}`
  if (value.startsWith('tasks/')) return `.dshbay/${value}`
  if (value.startsWith('objects/')) return `.dshbay/${value}`
  if (value.startsWith('sessions/checkpoints/')) return `.dshbay/${value}`
  return value
}

/** Confirms every declared external dependency is present, embedded, and matches its digest. */
function verifyEmbeddedExtensions(bundle: Awaited<ReturnType<typeof readWorkbenchBundle>>): void {
  const declared = bundle.manifest.externalDependencies ?? []
  const lockEntry = bundle.manifest.entries.find(entry => entry.path === 'meta/extensions.lock.json' && !entry.deleted)
  const lockObject = lockEntry && bundle.objects.find(object => object.digest === lockEntry.digest)
  const locks = lockObject ? JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(lockObject.content)) as CompleteExtensionLock[] : []
  if (!Array.isArray(locks)) throw new Error('扩展清单格式无效。')
  const byPackage = new Map(locks.map(lock => [lock.packageName, lock]))
  for (const dependency of declared) {
    const lock = byPackage.get(dependency.id)
    if (!lock || lock.exportPolicy === 'embed') throw new Error(`无法验证外部扩展或环境依赖: ${dependency.id}`)
  }
  for (const lock of locks) {
    if (lock.exportPolicy !== 'embed') continue
    const embedded = bundle.manifest.entries.find(entry => entry.path === lock.artifactPath && entry.kind === 'extension' && !entry.deleted)
    if (!embedded || embedded.digest !== `sha256:${lock.artifactSha256}`) throw new Error(`扩展制品缺失或摘要不符：${lock.packageName}`)
  }
}

const JOB_RETENTION_MS = 30 * 60_000

/** In-memory jobs so the page can poll progress. Finished jobs are kept briefly for the result. */
class BundleJobs {
  private readonly rows = new Map<string, WorkbenchBundleJobV1>()
  start(operation: 'export' | 'import', work: (report: (progress: WorkbenchBundleProgressV1) => void) => Promise<unknown>): string {
    const now = Date.now()
    for (const [id, row] of this.rows) if (row.state !== 'running' && now - Number(id.split(':')[0]) > JOB_RETENTION_MS) this.rows.delete(id)
    const jobId = `${now}:${randomUUID()}`
    const set = (row: WorkbenchBundleJobV1) => { this.rows.set(jobId, row) }
    let progress: WorkbenchBundleProgressV1 = { stage: operation === 'export' ? 'collect' : 'verify', done: 0, total: 0 }
    set({ jobId, operation, state: 'running', progress } as WorkbenchBundleJobV1)
    void work(next => { progress = next; set({ jobId, operation, state: 'running', progress } as WorkbenchBundleJobV1) })
      .then(result => set({ jobId, operation, state: 'done', progress, result } as WorkbenchBundleJobV1))
      .catch((error: unknown) => set({ jobId, operation, state: 'failed', progress, error: error instanceof Error ? error.message : String(error) }))
    return jobId
  }
  get(jobId: string): WorkbenchBundleJobV1 | undefined { return this.rows.get(jobId) }
}

async function defaultExportFolder(): Promise<string> {
  const downloads = path.join(homedir(), 'Downloads')
  return (await stat(downloads).catch(() => undefined))?.isDirectory() ? downloads : homedir()
}

/** Never overwrites: `名称.dshbay.zip`, then `名称 (2).dshbay.zip`, and so on. */
async function writeUnique(folder: string, filename: string, content: Uint8Array): Promise<string> {
  const stem = filename.replace(/\.dshbay\.zip$/iu, '')
  for (let attempt = 1; attempt <= 999; attempt += 1) {
    const candidate = path.join(folder, attempt === 1 ? filename : `${stem} (${attempt}).dshbay.zip`)
    try { await writeFile(candidate, content, { flag: 'wx' }); return candidate }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
  }
  throw new Error('导出位置已有太多同名工作台包，请换一个位置。')
}

/** Arguments are passed without a shell; the path is always one this route wrote. */
function revealInFileManager(file: string): Promise<void> {
  const [command, args] = process.platform === 'win32' ? ['explorer.exe', [`/select,${file}`]]
    : process.platform === 'darwin' ? ['open', ['-R', file]]
      : ['xdg-open', [path.dirname(file)]]
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'ignore', detached: true, windowsHide: false })
    child.once('error', reject)
    // explorer.exe exits with 1 even on success, so a started process is enough.
    child.once('spawn', () => { child.unref(); resolve() })
  })
}

/** The only public Workbench archive route. Legacy complete/distribution routes are intentionally separate. */
export function installWorkbenchBundleRoute(connection: HostConnectionHandle, options: BundleRouteOptions): () => void {
  const { directory, access } = options
  const actor = (request: Request) => access?.resolve(request.headers)
  const authorize = (request: Request, workbenchId: string, write = false) => {
    const current = actor(request)
    if (access && current) access.authorize(current, write ? 'layout' : 'view', { workbenchId })
  }
  const exportRoute = connection.fetch.register({ path: WORKBENCH_BUNDLE_ROUTE + '/export', methods: ['POST'], requestBody: 'streaming', async fetch(request) {
    try {
      const body = JSON.parse(new TextDecoder().decode(await readBody(request))) as Record<string, unknown>
      const workbenchId = text(body.workbenchId, 'workbenchId')
      const kind = body.kind === 'template' || body.kind === 'complete' ? body.kind : undefined
      if (!kind) throw new Error('只支持 template 或 complete 工作台包。')
      authorize(request, workbenchId)
      const snapshot = await buildExport(directory, workbenchId, kind, options.checkpoint, options.extensions?.())
      const built = await buildWorkbenchBundle({ snapshot: snapshot.snapshot, objects: snapshot.objects, dshVersion: WORKBENCH_DSH_GENERATION, ...(snapshot.externalDependencies ? { externalDependencies: snapshot.externalDependencies } : {}) })
      const filename = workbenchBundleFilename(directory.definition(workbenchId).record.name)
      return new Response(Buffer.from(built.archive), { headers: { 'content-type': 'application/zip', 'cache-control': 'no-store', 'content-length': String(built.archive.byteLength), 'x-dshbay-filename': filename, ...(snapshot.notices.length > 0 ? { 'x-dshbay-export-notices': encodeURIComponent(JSON.stringify(snapshot.notices)) } : {}) } })
    } catch (error) { return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 }) }
  } })
  const inspectRoute = connection.fetch.register({ path: WORKBENCH_BUNDLE_ROUTE + '/inspect', methods: ['POST'], requestBody: 'streaming', async fetch(request) {
    try {
      const bundle = await readWorkbenchBundle(await readBody(request))
      verifyEmbeddedExtensions(bundle)
      return Response.json(inspection(bundle), { headers: { 'cache-control': 'no-store' } })
    } catch (error) { return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 }) }
  } })
  const runImport = async (bytes: Uint8Array, parentPath: string, folderName: string, report: (progress: WorkbenchBundleProgressV1<WorkbenchBundleImportStage>) => void = () => {}): Promise<WorkbenchBundleImportResultV1> => {
    let staging: string | undefined
    try {
      report({ stage: 'verify', done: 0, total: 0 })
      const bundle = await readWorkbenchBundle(bytes)
      verifyEmbeddedExtensions(bundle)
      if (bundle.manifest.kind !== 'template' && bundle.manifest.kind !== 'complete') throw new Error('不支持的工作台包类型。')
      await directory.checkCreateLocation(parentPath, folderName)
      const layout = bundle.objects.find(object => object.digest === bundle.manifest.entries.find(entry => entry.path === 'layout.json')?.digest)
      if (!layout) throw new Error('工作台包缺少布局定义。')
      const source = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(layout.content)) as FileWorkbenchV1
      const workbenchId = `${source.record.workbenchId}-import-${randomUUID().slice(0, 12)}`.slice(0, 180)
      const sourceCatalog = source.record.sessionCatalog ?? {}
      const sessionIds: Record<string, string> = {}
      const sessionMap: Record<string, string> = {}
      for (const [sessionKey, entry] of Object.entries(sourceCatalog)) {
        const sourceSessionId = entry.sessionId ?? entry.sessionKey
        const targetSessionId = randomUUID()
        sessionIds[sourceSessionId] = targetSessionId
        sessionMap[sessionKey] = targetSessionId
      }
      const checkpointEntries: { sourceSessionId: string; path: string; content: Uint8Array }[] = []
      staging = await mkdtemp(path.join(parentPath, '.dshbay-import-'))
      const entryTotal = bundle.manifest.entries.length
      for (const [index, entry] of bundle.manifest.entries.entries()) {
        if (index % 25 === 0) report({ stage: 'files', done: index, total: entryTotal })
        if (!entry.deleted && entry.path.startsWith(PROJECT_META_PREFIX)) {
          const [, projectId, ...rest] = entry.path.split('/')
          const project = projectId ? source.record.projects?.[projectId] : undefined
          if (!project || rest.length === 0) throw new Error(`工作台包含未登记项目的资料：${entry.path}`)
          const object = bundle.objects.find(candidate => candidate.digest === entry.digest)
          if (!object) throw new Error(`工作台包缺少文件：${entry.path}`)
          const target = path.resolve(staging, ...project.relativePath.split('/'), '.dshbay', ...rest)
          if (!target.startsWith(path.resolve(staging) + path.sep)) throw new Error('工作台包路径不安全。')
          await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, object.content, { flag: 'wx' })
          continue
        }
        if (entry.deleted || !['project-file', 'session-checkpoint', 'attachment', 'extension', 'environment', 'memory', 'task'].includes(entry.kind)) continue
        const object = bundle.objects.find(candidate => candidate.digest === entry.digest)
        if (!object) throw new Error(`工作台包缺少文件：${entry.path}`)
        const target = path.resolve(staging, importedPayloadPath(entry.path))
        if (!target.startsWith(path.resolve(staging) + path.sep)) throw new Error('工作台包路径不安全。')
        await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, object.content, { flag: 'wx' })
        if (entry.kind === 'session-checkpoint' && entry.path.startsWith('sessions/checkpoints/')) {
          const parts = entry.path.split('/')
          if (parts[2]) checkpointEntries.push({ sourceSessionId: parts[2], path: entry.path, content: new Uint8Array(object.content) })
        }
      }
      const target = path.join(path.resolve(parentPath), folderName)
      // The staging directory is a sibling of the destination. Renaming it is
      // atomic on the same volume and avoids registering a half-copied import.
      await rename(staging, target)
      staging = undefined
      try {
        if (checkpointEntries.length > 0) {
          report({ stage: 'sessions', done: 0, total: 0 })
          if (!options.checkpointRestorer) throw new Error('complete 工作台包包含 Session checkpoint，但 RC3 Session 恢复服务不可用')
          await options.checkpointRestorer.restore({ entries: checkpointEntries, targetRoot: target, sessionIds, sourceCatalog })
        }
      // Template imports still need their declared project folders to exist so
      // the directory registry can create workspace handles atomically.
      const relativeProjects = [
        ...Object.values(source.record.projects ?? {}).map(project => project.relativePath),
        ...Object.values(source.record.areaProjects ?? {}).map(project => project.relativePath),
      ]
      for (const relative of new Set(relativeProjects)) {
        const projectRoot = path.resolve(target, relative)
        if (projectRoot !== target && !projectRoot.startsWith(target + path.sep)) throw new Error('工作台项目路径不安全。')
        await mkdir(projectRoot, { recursive: true })
      }
      const restoredSources = new Set(checkpointEntries.map(entry => entry.sourceSessionId))
      const restoredKeys = new Set(Object.entries(sourceCatalog).filter(([, entry]) => restoredSources.has(entry.sessionId ?? entry.sessionKey)).map(([key]) => key))
      const importedRecord = portableImportedRecord(source.record, workbenchId, checkpointEntries.length > 0, restoredKeys)
      if (checkpointEntries.length > 0) {
        // A catalog entry without restored history would point at a Session
        // that does not exist on this machine.
        importedRecord.sessionCatalog = Object.fromEntries(Object.entries(importedRecord.sessionCatalog ?? {}).filter(([key]) => restoredKeys.has(key)).map(([key, entry]) => {
          const sourceSessionId = entry.sessionId ?? entry.sessionKey
          const targetSessionId = sessionIds[sourceSessionId]
          return [key, targetSessionId === undefined ? { ...entry } : { ...entry, sessionId: targetSessionId }]
        }))
      }
      const envelope: FileWorkbenchV1 = { schemaVersion: 2, revision: 0, record: importedRecord }
      const publishedSessions = Object.fromEntries(Object.entries(sessionMap).filter(([key]) => importedRecord.sessionCatalog?.[key] !== undefined))
      report({ stage: 'register', done: 0, total: 0 })
      await directory.publishImported(target, envelope, publishedSessions, { open: false })
      const extensionLock = path.join(target, '.dshbay', 'extensions.lock.json')
      if (options.extensions?.() && existsSync(extensionLock)) {
        const locks = JSON.parse(await readFile(extensionLock, 'utf8')) as CompleteExtensionLock[]
        const embedded = Array.isArray(locks) ? locks.filter(lock => lock.exportPolicy === 'embed') : []
        if (embedded.length > 0) {
          report({ stage: 'extensions', done: 0, total: embedded.length })
          const installed = await options.extensions()!.install(embedded, path.join(target, '.dshbay'), randomUUID())
          if (installed.consents && options.saveExtensionConsents) await options.saveExtensionConsents(installed.consents)
        }
      }
      } catch (error) {
        await rm(target, { recursive: true, force: true }).catch(() => {})
        throw error
      }
      return { status: 'committed', workbenchId, name: source.record.name, kind: bundle.manifest.kind, snapshotId: bundle.manifest.snapshotId, switched: false }
    } finally { if (staging) await rm(staging, { recursive: true, force: true }).catch(() => {}) }
  }
  const failure = (error: unknown, status = 400) => Response.json({ error: error instanceof Error ? error.message : String(error) }, { status })
  const importRoute = connection.fetch.register({ path: WORKBENCH_BUNDLE_ROUTE + '/import', methods: ['POST'], requestBody: 'streaming', async fetch(request) {
    try {
      const url = new URL(request.url)
      const result = await runImport(await readBody(request), text(url.searchParams.get('parentPath'), 'parentPath'), text(url.searchParams.get('folderName'), 'folderName'))
      return Response.json(result, { headers: { 'cache-control': 'no-store' } })
    } catch (error) { return failure(error) }
  } })
  const jobs = new BundleJobs()
  const exportProblems = async (workbenchId: string): Promise<WorkbenchBundleExtensionProblemV1[]> => {
    const extensions = options.extensions?.()
    if (!extensions?.exportProblems) return []
    return extensions.exportProblems(directory.definition(workbenchId).record, bundlePlatform())
  }
  // Jobs write to and reveal paths on the Host disk, so only the desktop owner may use them.
  const desktopOnly = (request: Request) => {
    if (access && actor(request)?.actor !== 'desktop') throw new Error('请在 DSH 桌面端导出或导入工作台包。')
  }
  const exportJobRoute = connection.fetch.register({ path: WORKBENCH_BUNDLE_ROUTE + '/export-job', methods: ['POST'], requestBody: 'streaming', async fetch(request) {
    try {
      desktopOnly(request)
      const body = JSON.parse(new TextDecoder().decode(await readBody(request))) as Record<string, unknown>
      const workbenchId = text(body.workbenchId, 'workbenchId')
      const kind = body.kind === 'template' || body.kind === 'complete' ? body.kind : undefined
      if (!kind) throw new Error('只支持 template 或 complete 工作台包。')
      authorize(request, workbenchId)
      const folder = typeof body.directory === 'string' && body.directory ? body.directory : await defaultExportFolder()
      if (!path.isAbsolute(folder) || !(await stat(folder).catch(() => undefined))?.isDirectory()) throw new Error('导出位置不存在或不是文件夹。')
      const problems = await exportProblems(workbenchId)
      if (problems.length > 0) return Response.json({ error: `有 ${problems.length} 个内页扩展不符合分发要求，修复后才能导出。`, problems }, { status: 409 })
      const jobId = jobs.start('export', async report => {
        const snapshot = await buildExport(directory, workbenchId, kind, options.checkpoint, options.extensions?.(), report)
        const built = await buildWorkbenchBundle({ snapshot: snapshot.snapshot, objects: snapshot.objects, dshVersion: WORKBENCH_DSH_GENERATION, ...(snapshot.externalDependencies ? { externalDependencies: snapshot.externalDependencies } : {}) })
        report({ stage: 'write', done: 0, total: built.archive.byteLength })
        const filename = workbenchBundleFilename(directory.definition(workbenchId).record.name)
        const written = await writeUnique(folder, filename, built.archive)
        return { path: written, filename: path.basename(written), bytes: built.archive.byteLength, notices: snapshot.notices }
      })
      return Response.json({ jobId }, { headers: { 'cache-control': 'no-store' } })
    } catch (error) { return failure(error) }
  } })
  const importJobRoute = connection.fetch.register({ path: WORKBENCH_BUNDLE_ROUTE + '/import-job', methods: ['POST'], requestBody: 'streaming', async fetch(request) {
    try {
      desktopOnly(request)
      const url = new URL(request.url)
      const parentPath = text(url.searchParams.get('parentPath'), 'parentPath'), folderName = text(url.searchParams.get('folderName'), 'folderName')
      const bytes = await readBody(request)
      const jobId = jobs.start('import', report => runImport(bytes, parentPath, folderName, report))
      return Response.json({ jobId }, { headers: { 'cache-control': 'no-store' } })
    } catch (error) { return failure(error) }
  } })
  const jobRoute = connection.fetch.register({ path: WORKBENCH_BUNDLE_ROUTE + '/job', methods: ['GET'], requestBody: 'buffered', async fetch(request) {
    try {
      desktopOnly(request)
      const job = jobs.get(text(new URL(request.url).searchParams.get('jobId'), 'jobId'))
      if (!job) return failure('导出导入任务不存在或已过期。', 404)
      return Response.json(job, { headers: { 'cache-control': 'no-store' } })
    } catch (error) { return failure(error) }
  } })
  const locationRoute = connection.fetch.register({ path: WORKBENCH_BUNDLE_ROUTE + '/export-location', methods: ['GET'], requestBody: 'buffered', async fetch(request) {
    try { desktopOnly(request); return Response.json({ directory: await defaultExportFolder() }, { headers: { 'cache-control': 'no-store' } }) } catch (error) { return failure(error) }
  } })
  const checkRoute = connection.fetch.register({ path: WORKBENCH_BUNDLE_ROUTE + '/export-check', methods: ['GET'], requestBody: 'buffered', async fetch(request) {
    try {
      desktopOnly(request)
      const workbenchId = text(new URL(request.url).searchParams.get('workbenchId'), 'workbenchId')
      authorize(request, workbenchId)
      const result: WorkbenchBundleExportCheckV1 = { problems: await exportProblems(workbenchId) }
      return Response.json(result, { headers: { 'cache-control': 'no-store' } })
    } catch (error) { return failure(error) }
  } })
  const revealRoute = connection.fetch.register({ path: WORKBENCH_BUNDLE_ROUTE + '/reveal', methods: ['POST'], requestBody: 'streaming', async fetch(request) {
    try {
      desktopOnly(request)
      const body = JSON.parse(new TextDecoder().decode(await readBody(request))) as Record<string, unknown>
      // Only a file this route itself wrote can be revealed; the client never names a path.
      const job = jobs.get(text(body.jobId, 'jobId'))
      if (job?.operation !== 'export' || job.state !== 'done') throw new Error('只能打开已完成导出的文件位置。')
      await revealInFileManager(job.result.path)
      return Response.json({ revealed: true })
    } catch (error) { return failure(error) }
  } })
  return () => { checkRoute(); revealRoute(); locationRoute(); jobRoute(); importJobRoute(); exportJobRoute(); importRoute(); inspectRoute(); exportRoute() }
}
