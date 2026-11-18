import { canonicalJson, decodeDeterministicZip, encodeDeterministicZip, type WorkbenchPackageArchiveLimitsV1, type WorkbenchPackageFileV1 } from './foundation/workbench-sharing.ts'
import { WORKBENCH_BUNDLE_MAX_BYTES, WORKBENCH_BUNDLE_MAX_ENTRIES, WORKBENCH_BUNDLE_MAX_FILE_BYTES } from './workbench-bundle-contract.ts'
import { createWorkbenchSnapshot, snapshotDigest, validateWorkbenchSnapshot, validateWorkbenchSnapshotKind, type WorkbenchBundleKind, type WorkbenchSnapshotObject, type WorkbenchSnapshotV1 } from './workbench-snapshot.ts'
import { WORKBENCH_DSH_GENERATION, isWorkbenchBundleDshCompatible } from './release-compatibility.ts'

export interface WorkbenchBundleManifestV1 extends WorkbenchSnapshotV1 {
  dshVersion: string
  /** Dependencies that cannot be embedded are explicit and must be verified at import. */
  externalDependencies?: readonly { id: string; version?: string; digest?: string; reason: string }[]
}

export interface WorkbenchBundleInput {
  snapshot: WorkbenchSnapshotV1
  dshVersion: string
  objects: readonly WorkbenchSnapshotObject[]
  externalDependencies?: readonly { id: string; version?: string; digest?: string; reason: string }[]
}

export interface WorkbenchBundle {
  manifest: WorkbenchBundleManifestV1
  objects: readonly WorkbenchSnapshotObject[]
  archive: Uint8Array
}

export interface WorkbenchBundleReaderOptions {
  limits?: WorkbenchPackageArchiveLimitsV1
  /** Host-provided verification for external extensions/environment dependencies. */
  verifyExternalDependency?: (dependency: NonNullable<WorkbenchBundleManifestV1['externalDependencies']>[number]) => boolean | Promise<boolean>
}

/**
 * The sharing-package defaults (128 entries, 64 MB) describe layout packages.
 * A workbench bundle carries project files and session checkpoints, so it uses
 * the same 512 MB budget the route advertises.
 */
export const WORKBENCH_BUNDLE_ARCHIVE_LIMITS: WorkbenchPackageArchiveLimitsV1 = {
  maxEntries: WORKBENCH_BUNDLE_MAX_ENTRIES,
  maxFileBytes: WORKBENCH_BUNDLE_MAX_FILE_BYTES,
  maxTotalBytes: WORKBENCH_BUNDLE_MAX_BYTES,
}

export const WORKBENCH_BUNDLE_MANIFEST_PATH = 'manifest.json'
export const WORKBENCH_BUNDLE_PAYLOAD_PREFIX = 'payload/'
export const WORKBENCH_BUNDLE_EXTENSION = '.dshbay.zip'
const dependencyDigest = /^sha256:[a-f0-9]{64}$/u

export function workbenchBundleFilename(workbenchName: string): string {
  // Letters and digits of any script are kept, so a Chinese name stays readable.
  const safe = workbenchName.normalize('NFC').trim().replace(/[^\p{L}\p{N}._-]+/gu, '-').replace(/^[-.]+|[-.]+$/gu, '').slice(0, 120)
  if (!safe) throw new Error('workbench name is empty')
  return safe + WORKBENCH_BUNDLE_EXTENSION
}

function utf8(value: string): Uint8Array { return new TextEncoder().encode(value) }
function decodeJson(content: Uint8Array): unknown {
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(content)) } catch { throw new Error('manifest.json is not valid UTF-8 JSON') }
}

function payloadPath(path: string): string { return WORKBENCH_BUNDLE_PAYLOAD_PREFIX + path }
function manifestSnapshot(manifest: WorkbenchBundleManifestV1): WorkbenchSnapshotV1 {
  const { dshVersion: _dshVersion, externalDependencies: _externalDependencies, ...snapshot } = manifest
  return snapshot
}

function validateExternalDependencies(value: unknown): asserts value is NonNullable<WorkbenchBundleManifestV1['externalDependencies']> | undefined {
  if (value === undefined) return
  if (!Array.isArray(value)) throw new Error('externalDependencies must be an array')
  const ids = new Set<string>()
  for (const dependency of value) {
    if (typeof dependency !== 'object' || dependency === null || typeof dependency.id !== 'string' || dependency.id.length < 1 || dependency.id.length > 256 || ids.has(dependency.id)) throw new Error('invalid external dependency')
    if (dependency.version !== undefined && (typeof dependency.version !== 'string' || dependency.version.length > 128)) throw new Error(`invalid external dependency version: ${dependency.id}`)
    if (dependency.digest !== undefined && (typeof dependency.digest !== 'string' || !dependencyDigest.test(dependency.digest))) throw new Error(`invalid external dependency digest: ${dependency.id}`)
    if (typeof dependency.reason !== 'string' || dependency.reason.length < 1 || dependency.reason.length > 1024) throw new Error(`invalid external dependency reason: ${dependency.id}`)
    ids.add(dependency.id)
  }
}

export async function buildWorkbenchBundle(input: WorkbenchBundleInput): Promise<WorkbenchBundle> {
  if (input.snapshot.format !== 'dshbay-workbench' || input.snapshot.schemaVersion !== 1) throw new Error('unsupported Workbench snapshot')
  if (input.dshVersion !== WORKBENCH_DSH_GENERATION) throw new Error(`Workbench bundles require DSH ${WORKBENCH_DSH_GENERATION}`)
  validateExternalDependencies(input.externalDependencies)
  await validateWorkbenchSnapshot(input.snapshot)
  validateWorkbenchSnapshotKind(input.snapshot.kind, input.snapshot.entries)
  if (input.snapshot.entries.filter(entry => !entry.deleted && entry.path === 'layout.json' && entry.kind === 'layout').length !== 1) throw new Error('Workbench bundle requires one layout.json entry')
  const paths = new Set<string>()
  const byDigest = new Map(input.objects.map(object => [object.digest, object]))
  const files: WorkbenchPackageFileV1[] = []
  for (const entry of input.snapshot.entries) {
    if (entry.deleted) continue
    if (paths.has(entry.path)) throw new Error(`snapshot contains duplicate archive path: ${entry.path}`)
    paths.add(entry.path)
    const object = byDigest.get(entry.digest)
    if (object === undefined) throw new Error(`missing snapshot object: ${entry.path}`)
    if (object.content.byteLength !== entry.size) throw new Error(`snapshot object size mismatch: ${entry.path}`)
    const digest = await snapshotDigest(object.content)
    if (digest !== entry.digest) throw new Error(`snapshot object digest mismatch: ${entry.path}`)
    files.push({ path: payloadPath(entry.path), content: object.content })
  }
  const manifest: WorkbenchBundleManifestV1 = {
    ...input.snapshot,
    dshVersion: input.dshVersion,
    ...(input.externalDependencies === undefined || input.externalDependencies.length === 0 ? {} : { externalDependencies: input.externalDependencies.map(dependency => ({ ...dependency })) }),
  }
  const archive = encodeDeterministicZip([{ path: WORKBENCH_BUNDLE_MANIFEST_PATH, content: utf8(canonicalJson(manifest)) }, ...files])
  return { manifest, objects: [...byDigest.values()], archive }
}

export async function readWorkbenchBundle(bytes: Uint8Array, options: WorkbenchBundleReaderOptions = {}): Promise<WorkbenchBundle> {
  const entries = decodeDeterministicZip(bytes, options.limits ?? WORKBENCH_BUNDLE_ARCHIVE_LIMITS)
  const manifestEntry = entries.find(entry => entry.path === WORKBENCH_BUNDLE_MANIFEST_PATH)
  if (manifestEntry === undefined) throw new Error('这不是 dshbay 工作台包；如果这是对话归档包，不能作为工作台恢复包。')
  const value = decodeJson(manifestEntry.content)
  if (typeof value !== 'object' || value === null || (value as { format?: unknown }).format !== 'dshbay-workbench') {
    if (entries.some(entry => /session|conversation|transcript/iu.test(entry.path))) throw new Error('这是对话归档包，不能作为工作台恢复包。')
    throw new Error('不受支持的工作台包格式；只接受 dshbay-workbench v1。')
  }
  const manifest = value as WorkbenchBundleManifestV1
  if (manifest.schemaVersion !== 1 || (manifest.kind !== 'template' && manifest.kind !== 'complete')) throw new Error('不受支持的工作台包版本；只接受 dshbay-workbench v1。')
  if (typeof manifest.dshVersion !== 'string' || !manifest.dshVersion) throw new Error('工作台包缺少 DSH 版本')
  if (!isWorkbenchBundleDshCompatible(manifest.dshVersion)) throw new Error(`工作台包来自 DSH ${manifest.dshVersion}，与当前 DSH ${WORKBENCH_DSH_GENERATION} 不属于同一版本代。`)
  validateExternalDependencies(manifest.externalDependencies)
  await validateWorkbenchSnapshot(manifestSnapshot(manifest))
  if (manifest.entries.filter(entry => !entry.deleted && entry.path === 'layout.json' && entry.kind === 'layout').length !== 1) throw new Error('Workbench bundle requires one layout.json entry')
  const payloadEntries = entries.filter(entry => entry.path.startsWith(WORKBENCH_BUNDLE_PAYLOAD_PREFIX))
  const unsupportedEntries = entries.filter(entry => entry.path !== WORKBENCH_BUNDLE_MANIFEST_PATH && !entry.path.startsWith(WORKBENCH_BUNDLE_PAYLOAD_PREFIX))
  if (unsupportedEntries.length > 0) throw new Error(`Workbench bundle contains unsupported archive entries: ${unsupportedEntries.map(entry => entry.path).join(', ')}`)
  const payload = new Map(payloadEntries.map(entry => [entry.path.slice(WORKBENCH_BUNDLE_PAYLOAD_PREFIX.length), entry.content]))
  if (payload.size !== payloadEntries.length) throw new Error('工作台包包含重复 payload 路径')
  const objects: WorkbenchSnapshotObject[] = []
  for (const entry of manifest.entries) {
    if (entry.deleted) continue
    const content = payload.get(entry.path)
    if (content === undefined) throw new Error(`工作台包缺少内容: ${entry.path}`)
    if (content.byteLength !== entry.size || await snapshotDigest(content) !== entry.digest) throw new Error(`工作台包内容校验失败: ${entry.path}`)
    objects.push({ digest: entry.digest, content: new Uint8Array(content) })
  }
  const declaredPaths = new Set(manifest.entries.filter(entry => !entry.deleted).map(entry => entry.path))
  for (const path of payload.keys()) if (!declaredPaths.has(path)) throw new Error(`工作台包包含未声明内容: ${path}`)
  for (const dependency of manifest.externalDependencies ?? []) {
    if (options.verifyExternalDependency === undefined || !(await options.verifyExternalDependency(dependency))) throw new Error(`无法验证外部扩展或环境依赖: ${dependency.id}`)
  }
  return { manifest, objects: [...new Map(objects.map(object => [object.digest, object])).values()], archive: new Uint8Array(bytes) }
}

export function isWorkbenchBundleFilename(filename: string): boolean { return filename.toLowerCase().endsWith(WORKBENCH_BUNDLE_EXTENSION) }

export function isWorkbenchBundleArchive(bytes: Uint8Array): boolean {
  try {
    const manifest = decodeDeterministicZip(bytes, WORKBENCH_BUNDLE_ARCHIVE_LIMITS).find(entry => entry.path === WORKBENCH_BUNDLE_MANIFEST_PATH)
    const value = manifest === undefined ? undefined : decodeJson(manifest.content) as { format?: unknown; schemaVersion?: unknown; dshVersion?: unknown; kind?: unknown }
    return value?.format === 'dshbay-workbench' && value.schemaVersion === 1 && (value.kind === 'template' || value.kind === 'complete') && value.dshVersion === WORKBENCH_DSH_GENERATION
  } catch { return false }
}

export { createWorkbenchSnapshot }
export type { WorkbenchBundleKind }
