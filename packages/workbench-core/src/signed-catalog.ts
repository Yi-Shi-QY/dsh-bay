import { createWorkbenchModuleCatalog, type WorkbenchModuleCatalogEntryV1, type WorkbenchModuleCatalogV1, type WorkbenchModuleIdentityV1 } from './module-catalog.ts'
import type { WorkbenchModuleDeliveryV1, WorkbenchModuleKindV1 } from './module-contract.ts'

import { WORKBENCH_CORE_VERSION, WORKBENCH_DSH_GENERATION, WORKBENCH_UPSTREAM_COMMIT } from './release-compatibility.ts'
export const WORKBENCH_DSH_PLUGIN_GENERATION_V1 = WORKBENCH_DSH_GENERATION
export const WORKBENCH_UPSTREAM_COMMIT_V1 = WORKBENCH_UPSTREAM_COMMIT

/** Isolated alpha2 acceptance trust root. The private key stays outside the worktree; never publish this build as stable. */
export const WORKBENCH_TEAM_TRUST_ROOT_V1 = {
  keyId: 'workbench-alpha2-local-20260918',
  publicKey: 'MiwkMvulme17/Osu0p2Q8S5zzKLt62spRv6nejVhNFA=',
} as const

export interface WorkbenchSignedCatalogV1 {
  readonly schemaVersion: 1
  readonly kind: 'dsh-workbench-team-catalog'
  readonly catalogId: string
  readonly compatibility: {
    readonly dshGeneration: typeof WORKBENCH_DSH_PLUGIN_GENERATION_V1
    readonly upstreamCommit: typeof WORKBENCH_UPSTREAM_COMMIT_V1
    readonly requiredSeams: readonly string[]
  }
  readonly entries: readonly WorkbenchSignedCatalogEntryV1[]
}

export interface WorkbenchSignedCatalogEntryV1 {
  readonly moduleId: string
  readonly packageName: string
  readonly kind?: WorkbenchModuleKindV1
  readonly delivery?: WorkbenchModuleDeliveryV1
  readonly version: string
  readonly artifact: {
    readonly locator: string
    readonly sha256: string
    readonly integrity: string
    readonly size: number
  }
  readonly dshGeneration: typeof WORKBENCH_DSH_PLUGIN_GENERATION_V1
  readonly requiredCapabilities: readonly string[]
  readonly permissions: readonly string[]
  readonly provenance: {
    readonly upstreamCommit: typeof WORKBENCH_UPSTREAM_COMMIT_V1
    readonly sourceDigest: string
    readonly patchDigest: string
  }
  readonly publisherKeyId: string
  readonly revoked: boolean
  readonly manifest?: {
    readonly kind?: WorkbenchModuleKindV1
    readonly delivery?: WorkbenchModuleDeliveryV1
    readonly coreCompatibility: string
    readonly editorIds: readonly string[]
    readonly scope: 'root' | 'session' | 'area'
  }
}

export interface WorkbenchEd25519VerifierV1 {
  verify(input: { readonly publicKey: Uint8Array; readonly message: Uint8Array; readonly signature: Uint8Array }): Promise<boolean>
}

export interface WorkbenchDigestProviderV1 {
  sha256(bytes: Uint8Array): Promise<string>
  sha512Integrity(bytes: Uint8Array): Promise<string>
}

export interface WorkbenchCatalogArchiveEntryV1 {
  readonly path: string
  readonly bytes: Uint8Array
}

export interface WorkbenchCatalogArchiveReaderV1 {
  read(bytes: Uint8Array): Promise<readonly WorkbenchCatalogArchiveEntryV1[]>
}

export interface WorkbenchSignedCatalogImportOptionsV1 {
  readonly verifier?: WorkbenchEd25519VerifierV1
  readonly digests?: WorkbenchDigestProviderV1
  readonly archiveReader?: WorkbenchCatalogArchiveReaderV1
  readonly trustRoot?: { readonly keyId: string; readonly publicKey: string }
  readonly verifiedSeams?: readonly string[]
  readonly allowedPermissions?: readonly string[]
}

export interface WorkbenchSignedCatalogImportV1 {
  readonly catalog: WorkbenchSignedCatalogV1
  readonly moduleCatalog: WorkbenchModuleCatalogV1
  readonly entries: readonly WorkbenchModuleCatalogEntryV1[]
  artifact(identity: WorkbenchModuleIdentityV1): Uint8Array | undefined
}

const SHA256 = /^[a-f0-9]{64}$/iu
const SHA512_INTEGRITY = /^sha512-[A-Za-z0-9+/]+={0,2}$/u
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u
const HIGH_RISK_PERMISSION = /(?:^|[.:/])(filesystem(?:[.:/]write)?|network(?:[.:/]unrestricted)?|subprocess|credentials?)(?:$|[.:/])/iu
const REQUIRED_ARCHIVE_FILES = new Set(['catalog.json', 'catalog.sig'])
const MAX_ARCHIVE_BYTES = 300 * 1024 * 1024
const MAX_CATALOG_ENTRIES = 8

function toBase64(bytes: Uint8Array): string {
  let value = ''
  for (let offset = 0; offset < bytes.length; offset += 0x8000) value += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + 0x8000, bytes.length)))
  if (typeof btoa === 'function') return btoa(value)
  const BufferConstructor = (globalThis as { Buffer?: { from(value: string, encoding: string): { toString(encoding: string): string } } }).Buffer
  if (BufferConstructor !== undefined) return BufferConstructor.from(value, 'binary').toString('base64')
  throw new Error('Workbench Catalog runtime does not support Base64 encoding')
}

function fromBase64(value: string): Uint8Array {
  if (!BASE64.test(value)) throw new Error('Workbench Catalog signature is not valid base64')
  if (typeof atob === 'function') {
    const decoded = atob(value)
    return Uint8Array.from(decoded, character => character.charCodeAt(0))
  }
  const BufferConstructor = (globalThis as { Buffer?: { from(value: string, encoding: string): Uint8Array } }).Buffer
  if (BufferConstructor !== undefined) return new Uint8Array(BufferConstructor.from(value, 'base64'))
  throw new Error('Workbench Catalog runtime does not support Base64 decoding')
}

function readU16(bytes: Uint8Array, offset: number): number {
  if (offset + 2 > bytes.length) throw new Error('Malformed Workbench Catalog archive')
  return bytes[offset]! | (bytes[offset + 1]! << 8)
}

function readU32(bytes: Uint8Array, offset: number): number {
  if (offset + 4 > bytes.length) throw new Error('Malformed Workbench Catalog archive')
  return (bytes[offset]! | (bytes[offset + 1]! << 8) | (bytes[offset + 2]! << 16) | (bytes[offset + 3]! << 24)) >>> 0
}

function archivePath(value: string): boolean {
  return value !== '' && !value.includes('\\') && !value.startsWith('/') && !value.split('/').some(part => part === '' || part === '.' || part === '..')
}

/** Returns an owned ArrayBuffer for Web Platform APIs that reject SharedArrayBuffer views. */
function ownedArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return copy.buffer
}

async function inflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream !== 'function') throw new Error('Workbench Catalog runtime cannot read compressed archive entries')
  const stream = new Blob([ownedArrayBuffer(bytes)]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

/** Minimal browser ZIP reader. Catalogs are local, bounded and have no need for a runtime ZIP dependency. */
export const WORKBENCH_CATALOG_ZIP_READER_V1: WorkbenchCatalogArchiveReaderV1 = {
  async read(bytes) {
    if (bytes.byteLength > MAX_ARCHIVE_BYTES) throw new Error('Workbench Catalog archive exceeds the V1 size limit')
    let end = -1
    for (let offset = Math.max(0, bytes.length - 0xffff - 22); offset <= bytes.length - 22; offset += 1) {
      if (readU32(bytes, offset) === 0x06054b50) end = offset
    }
    if (end < 0) throw new Error('Malformed Workbench Catalog ZIP end record')
    const count = readU16(bytes, end + 10)
    const centralOffset = readU32(bytes, end + 16)
    if (count > 64) throw new Error('Workbench Catalog contains too many archive entries')
    const rows: WorkbenchCatalogArchiveEntryV1[] = []
    let cursor = centralOffset
    for (let index = 0; index < count; index += 1) {
      if (readU32(bytes, cursor) !== 0x02014b50) throw new Error('Malformed Workbench Catalog central directory')
      const flags = readU16(bytes, cursor + 8)
      const method = readU16(bytes, cursor + 10)
      const compressedSize = readU32(bytes, cursor + 20)
      const uncompressedSize = readU32(bytes, cursor + 24)
      const nameLength = readU16(bytes, cursor + 28)
      const extraLength = readU16(bytes, cursor + 30)
      const commentLength = readU16(bytes, cursor + 32)
      const localOffset = readU32(bytes, cursor + 42)
      if ((flags & 1) !== 0 || (flags & 8) !== 0 || (method !== 0 && method !== 8)) throw new Error('Workbench Catalog ZIP uses an unsupported entry encoding')
      const path = new TextDecoder().decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength))
      if (!archivePath(path) || rows.some(row => row.path === path)) throw new Error(`Unsafe or duplicate Workbench Catalog archive path: ${path}`)
      if (uncompressedSize > MAX_ARCHIVE_BYTES || compressedSize > MAX_ARCHIVE_BYTES || readU32(bytes, localOffset) !== 0x04034b50) throw new Error('Malformed Workbench Catalog archive entry')
      const localNameLength = readU16(bytes, localOffset + 26)
      const localExtraLength = readU16(bytes, localOffset + 28)
      const dataStart = localOffset + 30 + localNameLength + localExtraLength
      const compressed = bytes.subarray(dataStart, dataStart + compressedSize)
      if (compressed.byteLength !== compressedSize) throw new Error('Truncated Workbench Catalog archive entry')
      const content = method === 0 ? new Uint8Array(compressed) : await inflateRaw(compressed)
      if (content.byteLength !== uncompressedSize) throw new Error('Workbench Catalog archive entry size mismatch')
      rows.push({ path, bytes: content })
      cursor += 46 + nameLength + extraLength + commentLength
    }
    return rows
  },
}

function canonical(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Catalog JSON contains a non-finite number')
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (typeof value === 'object') {
    const object = value as Record<string, unknown>
    return `{${Object.keys(object).sort().map(key => `${JSON.stringify(key)}:${canonical(object[key])}`).join(',')}}`
  }
  throw new Error('Catalog JSON contains an unsupported value')
}

export function canonicalizeWorkbenchCatalogJsonV1(value: unknown): Uint8Array {
  return new TextEncoder().encode(canonical(value))
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false
  for (let index = 0; index < left.byteLength; index += 1) if (left[index] !== right[index]) return false
  return true
}

async function defaultDigest(algorithm: 'SHA-256' | 'SHA-512', bytes: Uint8Array): Promise<Uint8Array> {
  if (globalThis.crypto?.subtle === undefined) throw new Error('Workbench Catalog runtime lacks Web Crypto digest support')
  return new Uint8Array(await globalThis.crypto.subtle.digest(algorithm, ownedArrayBuffer(bytes)))
}

export const WORKBENCH_WEB_DIGESTS_V1: WorkbenchDigestProviderV1 = {
  async sha256(bytes) { return [...await defaultDigest('SHA-256', bytes)].map(value => value.toString(16).padStart(2, '0')).join('') },
  async sha512Integrity(bytes) { return `sha512-${toBase64(await defaultDigest('SHA-512', bytes))}` },
}

export const WORKBENCH_WEB_ED25519_VERIFIER_V1: WorkbenchEd25519VerifierV1 = {
  async verify(input) {
    if (globalThis.crypto?.subtle === undefined) throw new Error('Workbench Catalog runtime lacks Web Crypto Ed25519 support')
    let key: CryptoKey
    try { key = await globalThis.crypto.subtle.importKey('raw', ownedArrayBuffer(input.publicKey), { name: 'Ed25519' }, false, ['verify']) }
    catch { throw new Error('Workbench Catalog runtime lacks Web Crypto Ed25519 support') }
    return globalThis.crypto.subtle.verify({ name: 'Ed25519' }, key, ownedArrayBuffer(input.signature), ownedArrayBuffer(input.message))
  },
}

function assertRecord(value: unknown, message: string): asserts value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(message)
}

function string(value: unknown, message: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(message)
  return value
}

function nonNegativeSafeInteger(value: unknown, message: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) throw new Error(message)
  return value
}

function boolean(value: unknown, message: string): boolean {
  if (typeof value !== 'boolean') throw new Error(message)
  return value
}

function scope(value: unknown): 'root' | 'session' | 'area' {
  if (value !== 'root' && value !== 'session' && value !== 'area') throw new Error('Catalog module scope is invalid')
  return value
}

function moduleKind(value: unknown): WorkbenchModuleKindV1 | undefined {
  if (value === undefined) return undefined
  if (value !== 'official-builtin' && value !== 'extension') throw new Error('Catalog module kind is invalid')
  return value
}

function moduleDelivery(value: unknown): WorkbenchModuleDeliveryV1 | undefined {
  if (value === undefined) return undefined
  if (value !== 'core-bundled' && value !== 'official-component' && value !== 'catalog' && value !== 'direct-source') throw new Error('Catalog module delivery is invalid')
  return value
}

function strings(value: unknown, message: string): readonly string[] {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string' || item.trim() === '') || new Set(value).size !== value.length) throw new Error(message)
  return value
}

function parseCatalog(bytes: Uint8Array): WorkbenchSignedCatalogV1 {
  let value: unknown
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) } catch { throw new Error('catalog.json is not valid UTF-8 JSON') }
  if (!equalBytes(bytes, canonicalizeWorkbenchCatalogJsonV1(value))) throw new Error('catalog.json must be canonical JSON')
  assertRecord(value, 'catalog.json must be an object')
  if (value.schemaVersion !== 1 || value.kind !== 'dsh-workbench-team-catalog') throw new Error('Unsupported Workbench Catalog format')
  const compatibility = value.compatibility
  assertRecord(compatibility, 'Catalog compatibility is missing')
  const entries = value.entries
  if (!Array.isArray(entries) || entries.length === 0 || entries.length > MAX_CATALOG_ENTRIES) throw new Error('Catalog entries are invalid')
  const parsed = entries.map(entry => {
    assertRecord(entry, 'Catalog entry is invalid')
    const artifact = entry.artifact
    const provenance = entry.provenance
    assertRecord(artifact, 'Catalog artifact is invalid')
    assertRecord(provenance, 'Catalog provenance is invalid')
    const manifest = entry.manifest
    if (manifest !== undefined) assertRecord(manifest, 'Catalog module manifest is invalid')
    const parsedEntry: WorkbenchSignedCatalogEntryV1 = {
      moduleId: string(entry.moduleId, 'Catalog moduleId is missing'),
      packageName: string(entry.packageName, 'Catalog packageName is missing'),
      version: string(entry.version, 'Catalog version is missing'),
      artifact: { locator: string(artifact.locator, 'Catalog artifact locator is missing'), sha256: string(artifact.sha256, 'Catalog artifact SHA-256 is missing'), integrity: string(artifact.integrity, 'Catalog artifact integrity is missing'), size: nonNegativeSafeInteger(artifact.size, 'Catalog artifact size is invalid') },
      dshGeneration: string(entry.dshGeneration, 'Catalog DSH generation is missing') as typeof WORKBENCH_DSH_PLUGIN_GENERATION_V1,
      requiredCapabilities: strings(entry.requiredCapabilities, 'Catalog capabilities are invalid'),
      permissions: strings(entry.permissions, 'Catalog permissions are invalid'),
      provenance: { upstreamCommit: string(provenance.upstreamCommit, 'Catalog upstream commit is missing') as typeof WORKBENCH_UPSTREAM_COMMIT_V1, sourceDigest: string(provenance.sourceDigest, 'Catalog source digest is missing'), patchDigest: string(provenance.patchDigest, 'Catalog patch digest is missing') },
      publisherKeyId: string(entry.publisherKeyId, 'Catalog publisher key ID is missing'),
      revoked: boolean(entry.revoked, 'Catalog revoked state is invalid'),
      ...(moduleKind(entry.kind) === undefined ? {} : { kind: moduleKind(entry.kind)! }),
      ...(moduleDelivery(entry.delivery) === undefined ? {} : { delivery: moduleDelivery(entry.delivery)! }),
      ...(manifest === undefined ? {} : { manifest: { ...(moduleKind(manifest.kind) === undefined ? {} : { kind: moduleKind(manifest.kind)! }), ...(moduleDelivery(manifest.delivery) === undefined ? {} : { delivery: moduleDelivery(manifest.delivery)! }), coreCompatibility: string(manifest.coreCompatibility, 'Catalog core compatibility is missing'), editorIds: strings(manifest.editorIds, 'Catalog editor IDs are invalid'), scope: scope(manifest.scope) } }),
    }
    return parsedEntry
  })
  return {
    schemaVersion: 1,
    kind: 'dsh-workbench-team-catalog',
    catalogId: string(value.catalogId, 'Catalog ID is missing'),
    compatibility: { dshGeneration: string(compatibility.dshGeneration, 'Catalog DSH generation is missing') as typeof WORKBENCH_DSH_PLUGIN_GENERATION_V1, upstreamCommit: string(compatibility.upstreamCommit, 'Catalog upstream commit is missing') as typeof WORKBENCH_UPSTREAM_COMMIT_V1, requiredSeams: strings(compatibility.requiredSeams, 'Catalog required seams are invalid') },
    entries: parsed,
  }
}

function validateCatalog(catalog: WorkbenchSignedCatalogV1, options: Required<Pick<WorkbenchSignedCatalogImportOptionsV1, 'verifiedSeams' | 'allowedPermissions'>>, trustRoot: { readonly keyId: string }): void {
  if (catalog.compatibility.dshGeneration !== WORKBENCH_DSH_PLUGIN_GENERATION_V1 || catalog.compatibility.upstreamCommit !== WORKBENCH_UPSTREAM_COMMIT_V1) throw new Error('Catalog is incompatible with the locked DSH plugin generation')
  const seams = new Set(options.verifiedSeams)
  const missingSeam = catalog.compatibility.requiredSeams.find(seam => !seams.has(seam))
  if (missingSeam !== undefined) throw new Error(`Required DSH plugin seam is unavailable: ${missingSeam}`)
  const identities = new Set<string>()
  const versions = new Set<string>()
  for (const entry of catalog.entries) {
    if (!/^workbench\.[a-z0-9][a-z0-9.-]*$/u.test(entry.moduleId) || !/^@?[a-z0-9][a-z0-9._/-]*$/iu.test(entry.packageName)) throw new Error(`V1 Catalog does not admit Module: ${entry.moduleId}`)
    if (entry.publisherKeyId !== trustRoot.keyId) throw new Error(`Catalog entry uses an untrusted publisher key: ${entry.moduleId}`)
    if (!SHA256.test(entry.artifact.sha256) || entry.artifact.locator !== `artifacts/${entry.artifact.sha256.toLowerCase()}.tgz` || !SHA512_INTEGRITY.test(entry.artifact.integrity) || !Number.isSafeInteger(entry.artifact.size) || entry.artifact.size <= 0) throw new Error(`Catalog artifact identity is invalid: ${entry.moduleId}`)
    if (entry.dshGeneration !== WORKBENCH_DSH_PLUGIN_GENERATION_V1 || entry.provenance.upstreamCommit !== WORKBENCH_UPSTREAM_COMMIT_V1 || !SHA256.test(entry.provenance.sourceDigest) || !SHA256.test(entry.provenance.patchDigest)) throw new Error(`Catalog provenance is incompatible: ${entry.moduleId}`)
    const identity = `${entry.moduleId}\u0000${entry.version}\u0000${entry.artifact.sha256.toLowerCase()}`
    if (identities.has(identity)) throw new Error(`Duplicate immutable catalog identity: ${entry.moduleId}@${entry.version}`)
    identities.add(identity)
    const versionIdentity = `${entry.moduleId}\u0000${entry.version}`
    if (versions.has(versionIdentity)) throw new Error(`Catalog module version resolves to multiple digests: ${entry.moduleId}@${entry.version}`)
    versions.add(versionIdentity)
    for (const permission of entry.permissions) {
      if (HIGH_RISK_PERMISSION.test(permission) || !options.allowedPermissions.includes(permission)) throw new Error(`Catalog permission is not permitted in V1: ${permission}`)
    }
  }
}

/**
 * Validates a complete local team archive. No Registry URL, package name or
 * file path supplied outside this archive can enter the returned catalog.
 */
export async function importWorkbenchSignedCatalogV1(bytes: Uint8Array, options: WorkbenchSignedCatalogImportOptionsV1 = {}): Promise<WorkbenchSignedCatalogImportV1> {
  const reader = options.archiveReader ?? WORKBENCH_CATALOG_ZIP_READER_V1
  const verifier = options.verifier ?? WORKBENCH_WEB_ED25519_VERIFIER_V1
  const digests = options.digests ?? WORKBENCH_WEB_DIGESTS_V1
  const trustRoot = options.trustRoot ?? WORKBENCH_TEAM_TRUST_ROOT_V1
  const entries = await reader.read(bytes)
  const files = new Map<string, Uint8Array>()
  for (const entry of entries) {
    if (files.has(entry.path) || !archivePath(entry.path)) throw new Error(`Unsafe or duplicate Workbench Catalog archive path: ${entry.path}`)
    files.set(entry.path, new Uint8Array(entry.bytes))
  }
  for (const required of REQUIRED_ARCHIVE_FILES) if (!files.has(required)) throw new Error(`Workbench Catalog archive is missing ${required}`)
  const catalogBytes = files.get('catalog.json')!
  const signatureText = new TextDecoder('utf-8', { fatal: true }).decode(files.get('catalog.sig')!).trim()
  const signature = fromBase64(signatureText)
  const verified = await verifier.verify({ publicKey: fromBase64(trustRoot.publicKey), message: catalogBytes, signature })
  if (!verified) throw new Error('Workbench Catalog signature verification failed')
  const catalog = parseCatalog(catalogBytes)
  validateCatalog(catalog, { verifiedSeams: options.verifiedSeams ?? [], allowedPermissions: options.allowedPermissions ?? [] }, trustRoot)
  const allowedFiles = new Set([...REQUIRED_ARCHIVE_FILES, ...catalog.entries.map(entry => entry.artifact.locator)])
  const unexpected = [...files.keys()].find(path => !allowedFiles.has(path))
  if (unexpected !== undefined || files.size !== allowedFiles.size) throw new Error(`Workbench Catalog archive contains an undeclared file: ${unexpected ?? 'duplicate artifact locator'}`)
  const artifacts = new Map<string, Uint8Array>()
  for (const entry of catalog.entries) {
    const artifact = files.get(entry.artifact.locator)
    if (artifact === undefined) throw new Error(`Catalog artifact is missing: ${entry.artifact.locator}`)
    if (artifact.byteLength !== entry.artifact.size) throw new Error(`Catalog artifact size mismatch: ${entry.moduleId}`)
    if ((await digests.sha256(artifact)).toLowerCase() !== entry.artifact.sha256.toLowerCase()) throw new Error(`Catalog artifact digest mismatch: ${entry.moduleId}`)
    if (await digests.sha512Integrity(artifact) !== entry.artifact.integrity) throw new Error(`Catalog artifact integrity mismatch: ${entry.moduleId}`)
    artifacts.set(`${entry.moduleId}\u0000${entry.version}\u0000${entry.artifact.sha256.toLowerCase()}`, new Uint8Array(artifact))
  }
  const moduleEntries: WorkbenchModuleCatalogEntryV1[] = catalog.entries.map(entry => {
    const kind = entry.kind ?? entry.manifest?.kind
    const delivery = entry.delivery ?? entry.manifest?.delivery
    return {
      moduleId: entry.moduleId,
      version: entry.version,
      ...(kind === undefined ? {} : { kind }),
      ...(delivery === undefined ? {} : { delivery }),
      artifactDigest: entry.artifact.sha256.toLowerCase(),
      coreCompatibility: entry.manifest?.coreCompatibility ?? WORKBENCH_CORE_VERSION,
      requires: { modules: [], capabilities: entry.requiredCapabilities },
      source: { kind: 'signed-local-catalog', locator: entry.artifact.locator, publisher: entry.publisherKeyId, signature: 'ed25519-detached' },
      signedCatalog: { catalogId: catalog.catalogId, publisherKeyId: entry.publisherKeyId, packageName: entry.packageName, integrity: entry.artifact.integrity, size: entry.artifact.size, dshGeneration: entry.dshGeneration, permissions: entry.permissions, provenance: entry.provenance, revoked: entry.revoked },
      ...(entry.manifest === undefined ? {} : { manifest: { moduleId: entry.moduleId, version: entry.version, ...(kind === undefined ? {} : { kind }), ...(delivery === undefined ? {} : { delivery }), coreCompatibility: entry.manifest.coreCompatibility, artifactDigest: entry.artifact.sha256.toLowerCase(), provides: { editorIds: entry.manifest.editorIds, surfaces: [`${entry.moduleId}`] }, requires: { capabilities: entry.requiredCapabilities, modules: [] }, activation: { mode: 'workbench', scope: entry.manifest.scope } } }),
    }
  })
  const moduleCatalog = createWorkbenchModuleCatalog(moduleEntries)
  return {
    catalog,
    moduleCatalog,
    entries: moduleCatalog.list(),
    artifact(identity) { const artifact = artifacts.get(`${identity.moduleId}\u0000${identity.version}\u0000${identity.artifactDigest.toLowerCase()}`); return artifact === undefined ? undefined : new Uint8Array(artifact) },
  }
}
