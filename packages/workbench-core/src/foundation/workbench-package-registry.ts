import { decodeDeterministicZip, decodeWorkbenchPackageArchive, sha256Hex, type WorkbenchPackageManifestV1 } from './workbench-sharing.ts'
import type { WorkbenchPackageSignatureV1 } from './workbench-package-trust.ts'

export type WorkbenchRegistryPublicationStatusV1 = 'published' | 'disabled'
export type WorkbenchRegistrySignatureStateV1 = 'trusted' | 'package-only' | 'unsigned' | 'revoked'
export type WorkbenchRegistryPublisherSourceV1 = 'local' | 'community' | 'organization' | 'official'

/**
 * Metadata owned by the registry, not by the executable package.  Keeping
 * this separate from the archive manifest means a catalog can add search
 * labels and object URLs without rewriting or resigning the package.
 */
export interface WorkbenchRegistryListingMetadataV1 {
  /** Stable cross-machine identity. Falls back to manifest.packageId locally. */
  portableId?: string
  tags?: readonly string[]
  packageArchiveUrl?: string
  previewSvgUrl?: string
  publisher?: {
    displayName: string
    keyId?: string
    source: WorkbenchRegistryPublisherSourceV1
  }
}

export interface WorkbenchRegistryListingV1 {
  schemaVersion: 1
  packageId: string
  portableId: string
  name: string
  description: string
  version: string
  completeness: 'layout-only' | 'complete-online' | 'complete-offline'
  distributionMode: 'online-reference' | 'offline-embedded'
  dshCompatibility: { minimum: string; maximum?: string }
  targets: readonly string[]
  tags: readonly string[]
  editorCount: number
  staticDependencyCount: number
  dynamicDependencyCount: number
  sharedDependencyCount: number
  /** Number of prepared user-authored Agent preset compositions. */
  agentPresetDependencyCount?: number
  permissionCount: number
  permissions: readonly string[]
  previewSvgUrl?: string
  packageArchiveUrl?: string
  archiveSha256: string
  archiveSize: number
  publisher: {
    displayName: string
    keyId?: string
    source: WorkbenchRegistryPublisherSourceV1
  }
  signatureState: WorkbenchRegistrySignatureStateV1
  status: WorkbenchRegistryPublicationStatusV1
  createdAt: string
  updatedAt: string
}

/** Short public name used by Registry/Catalog integrations. */
export type WorkbenchListingV1 = WorkbenchRegistryListingV1

export interface WorkbenchRegistryReleaseV1 {
  packageId: string
  version: string
  name: string
  description: string
  archiveSha256: string
  archiveSize: number
  manifest: WorkbenchPackageManifestV1
  signature?: WorkbenchPackageSignatureV1
  listing?: WorkbenchRegistryListingMetadataV1
  status: WorkbenchRegistryPublicationStatusV1
  publishedAt: number
  disabledAt?: number
  downloadCount: number
}

export interface WorkbenchRegistryPublishInputV1 {
  archive: Uint8Array
  signature?: WorkbenchPackageSignatureV1
  listing?: WorkbenchRegistryListingMetadataV1
  now?: number
}

export interface WorkbenchPackageReceiptV1 {
  packageId: string
  version: string
  archiveSha256: string
  dependencies: readonly { portableId: string; version: string; digest: string }[]
  installedAt: number
  source: 'local' | 'community' | 'organization' | 'official'
  signatureState: WorkbenchRegistrySignatureStateV1
  referencedWorkbenches: readonly string[]
}

export interface WorkbenchRegistryListOptionsV1 {
  query?: string
  compatibleDsh?: string
  completeness?: WorkbenchRegistryListingV1['completeness']
  signatureState?: WorkbenchRegistrySignatureStateV1
  tags?: readonly string[]
  includeDisabled?: boolean
  limit?: number
}

export interface WorkbenchRegistryIndexV1 {
  schemaVersion: 1
  releases: readonly WorkbenchRegistryListingV1[]
}

/** Transport seam for a static catalogue or a future Registry HTTP API. */
export interface WorkbenchRegistryCatalogTransportV1 {
  fetchIndex(): Promise<unknown>
  fetchArchive(listing: WorkbenchRegistryListingV1): Promise<Uint8Array>
}

export type WorkbenchRegistryCatalogRefreshResultV1 =
  | { valid: true; listings: readonly WorkbenchRegistryListingV1[] }
  | { valid: false; reason: string }

export interface WorkbenchRegistryCatalogV1 {
  refresh(): Promise<WorkbenchRegistryCatalogRefreshResultV1>
  list(options?: WorkbenchRegistryListOptionsV1): readonly WorkbenchRegistryListingV1[]
  get(portableId: string, version?: string): WorkbenchRegistryListingV1 | undefined
  downloadVerified(portableId: string, version?: string): Promise<
    | { valid: true; listing: WorkbenchRegistryListingV1; archive: Uint8Array; manifest: WorkbenchPackageManifestV1 }
    | { valid: false; reason: string; listing?: WorkbenchRegistryListingV1 }
  >
}

export interface WorkbenchRegistrySnapshotV1 {
  schemaVersion: 1
  releases: readonly {
    release: WorkbenchRegistryReleaseV1
    archive: Uint8Array
  }[]
  receipts?: readonly WorkbenchPackageReceiptV1[]
  stagedArchives?: readonly {
    packageId: string
    version: string
    archiveSha256: string
    archive: Uint8Array
  }[]
}

export interface WorkbenchRegistryV1 {
  /** Optional restore barrier for a durable registry adapter. */
  ready?(): Promise<void>
  publish(input: WorkbenchRegistryPublishInputV1): Promise<WorkbenchRegistryReleaseV1>
  get(packageId: string, version?: string): WorkbenchRegistryReleaseV1 | undefined
  getListing(packageId: string, version?: string): WorkbenchRegistryListingV1 | undefined
  list(options?: WorkbenchRegistryListOptionsV1): readonly WorkbenchRegistryReleaseV1[]
  listings(options?: WorkbenchRegistryListOptionsV1): readonly WorkbenchRegistryListingV1[]
  download(packageId: string, version?: string): Uint8Array | undefined
  /** Store an imported archive without publishing it to a public catalogue. */
  stageArchive?(archive: Uint8Array, identity: { packageId: string; version: string; archiveSha256: string }): Promise<void> | void
  /** Read a staged local archive after a Runtime restart. */
  stagedArchive?(packageId: string, version: string, archiveSha256?: string): Uint8Array | undefined
  disable(packageId: string, version: string, at?: number): boolean
  snapshot(): WorkbenchRegistrySnapshotV1
  restore(snapshot: WorkbenchRegistrySnapshotV1): void
  recordReceipt(receipt: WorkbenchPackageReceiptV1): void
  getReceipt(packageId: string, version: string): WorkbenchPackageReceiptV1 | undefined
  removeReceipt(packageId: string, version: string): boolean
}

export interface WorkbenchRegistryStorageV1 {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export type WorkbenchRegistryArchiveVerificationV1 =
  | { valid: true; manifest: WorkbenchPackageManifestV1; archiveSha256: string }
  | { valid: false; reason: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string')
}

function listingFromUnknown(value: unknown): WorkbenchRegistryListingV1 | undefined {
  if (!isRecord(value) || value.schemaVersion !== 1
    || typeof value.packageId !== 'string' || typeof value.portableId !== 'string'
    || typeof value.name !== 'string' || typeof value.description !== 'string'
    || typeof value.version !== 'string'
    || (value.completeness !== 'layout-only' && value.completeness !== 'complete-online' && value.completeness !== 'complete-offline')
    || (value.distributionMode !== 'online-reference' && value.distributionMode !== 'offline-embedded')
    || !isRecord(value.dshCompatibility) || typeof value.dshCompatibility.minimum !== 'string'
    || (value.dshCompatibility.maximum !== undefined && typeof value.dshCompatibility.maximum !== 'string')
    || !stringArray(value.targets) || !stringArray(value.tags)
    || !Number.isInteger(value.editorCount) || !Number.isInteger(value.staticDependencyCount)
    || !Number.isInteger(value.dynamicDependencyCount) || !Number.isInteger(value.sharedDependencyCount)
    || (value.agentPresetDependencyCount !== undefined && !Number.isInteger(value.agentPresetDependencyCount))
    || !Number.isInteger(value.permissionCount) || !stringArray(value.permissions)
    || typeof value.archiveSha256 !== 'string' || !/^[a-f0-9]{64}$/iu.test(value.archiveSha256)
    || typeof value.archiveSize !== 'number' || !Number.isInteger(value.archiveSize) || value.archiveSize < 0
    || !isRecord(value.publisher) || typeof value.publisher.displayName !== 'string'
    || (value.publisher.source !== 'local' && value.publisher.source !== 'community'
      && value.publisher.source !== 'organization' && value.publisher.source !== 'official')
    || (value.publisher.keyId !== undefined && typeof value.publisher.keyId !== 'string')
    || (value.signatureState !== 'trusted' && value.signatureState !== 'package-only'
      && value.signatureState !== 'unsigned' && value.signatureState !== 'revoked')
    || (value.status !== 'published' && value.status !== 'disabled')
    || typeof value.createdAt !== 'string' || typeof value.updatedAt !== 'string') return undefined
  if (value.previewSvgUrl !== undefined && typeof value.previewSvgUrl !== 'string') return undefined
  if (value.packageArchiveUrl !== undefined && typeof value.packageArchiveUrl !== 'string') return undefined
  if (!safeRegistryReference(value.previewSvgUrl) || !safeRegistryReference(value.packageArchiveUrl)) return undefined
  return structuredClone(value) as unknown as WorkbenchRegistryListingV1
}

export function parseWorkbenchRegistryIndex(value: unknown): WorkbenchRegistryCatalogRefreshResultV1 {
  if (!isRecord(value) || value.schemaVersion !== 1 || !Array.isArray(value.releases)) {
    return { valid: false, reason: 'registry index schema is unsupported' }
  }
  const listings: WorkbenchRegistryListingV1[] = []
  const identities = new Set<string>()
  for (const row of value.releases) {
    const listing = listingFromUnknown(row)
    if (listing === undefined) return { valid: false, reason: 'registry index contains an invalid listing' }
    const identity = `${listing.portableId}@${listing.version}`
    if (identities.has(identity)) return { valid: false, reason: `registry index contains duplicate release: ${identity}` }
    identities.add(identity)
    listings.push(listing)
  }
  return { valid: true, listings }
}

/**
 * Verify bytes downloaded from a Registry listing before handing them to the
 * importer. This is intentionally a pure hash/manifest gate; it never runs a
 * client bundle, contacts the network or mutates Settings.
 */
export async function verifyWorkbenchRegistryArchive(
  listing: WorkbenchRegistryListingV1,
  archive: Uint8Array,
): Promise<WorkbenchRegistryArchiveVerificationV1> {
  if (listing.status !== 'published') return { valid: false, reason: 'registry release is not published' }
  if (archive.byteLength !== listing.archiveSize) return { valid: false, reason: 'registry archive size mismatch' }
  const archiveSha256 = await sha256Hex(archive)
  if (archiveSha256.toLowerCase() !== listing.archiveSha256.toLowerCase()) {
    return { valid: false, reason: 'registry archive digest mismatch' }
  }
  try {
    const decoded = await decodeWorkbenchPackageArchive(archive)
    if (decoded.manifest.packageId !== listing.packageId || decoded.manifest.version !== listing.version) {
      return { valid: false, reason: 'registry archive identity does not match listing' }
    }
    if ((decoded.manifest.completeness ?? 'layout-only') !== listing.completeness
      || (decoded.manifest.distributionMode ?? 'online-reference') !== listing.distributionMode) {
      return { valid: false, reason: 'registry archive completeness does not match listing' }
    }
    return { valid: true, manifest: decoded.manifest, archiveSha256 }
  } catch (error) {
    return { valid: false, reason: error instanceof Error ? error.message : 'registry archive is invalid' }
  }
}

function filterListings(rows: readonly WorkbenchRegistryListingV1[], options: WorkbenchRegistryListOptionsV1): readonly WorkbenchRegistryListingV1[] {
  const query = options.query?.trim().toLocaleLowerCase('zh-CN')
  const requestedLimit = options.limit ?? 100
  const limit = Number.isFinite(requestedLimit) && requestedLimit >= 0 ? Math.min(1000, Math.floor(requestedLimit)) : 100
  return rows
    .filter(row => options.includeDisabled === true || row.status === 'published')
    .filter(row => options.compatibleDsh === undefined || isCompatible(options.compatibleDsh, row.dshCompatibility))
    .filter(row => options.completeness === undefined || row.completeness === options.completeness)
    .filter(row => options.signatureState === undefined || row.signatureState === options.signatureState)
    .filter(row => (options.tags ?? []).every(tag => row.tags.includes(tag)))
    .filter(row => query === undefined || query === ''
      || row.packageId.toLocaleLowerCase('zh-CN').includes(query)
      || row.portableId.toLocaleLowerCase('zh-CN').includes(query)
      || row.name.toLocaleLowerCase('zh-CN').includes(query)
      || row.description.toLocaleLowerCase('zh-CN').includes(query)
      || row.tags.some(tag => tag.toLocaleLowerCase('zh-CN').includes(query)))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt, 'en') || compareVersion(right.version, left.version))
    .slice(0, limit)
    .map(row => structuredClone(row))
}

export function createWorkbenchRegistryCatalog(
  transport: WorkbenchRegistryCatalogTransportV1,
): WorkbenchRegistryCatalogV1 {
  let rows: readonly WorkbenchRegistryListingV1[] = []
  return {
    async refresh() {
      try {
        const parsed = parseWorkbenchRegistryIndex(await transport.fetchIndex())
        if (parsed.valid) rows = parsed.listings.map(listing => structuredClone(listing))
        return parsed
      } catch (error) {
        return { valid: false, reason: error instanceof Error ? error.message : 'registry index request failed' }
      }
    },
    list(options = {}) {
      return filterListings(rows, options)
    },
    get(portableId, version) {
      const candidates = rows.filter(row => row.portableId === portableId && (version === undefined || row.version === version))
        .sort((left, right) => compareVersion(right.version, left.version))
      const row = candidates[0]
      return row === undefined ? undefined : structuredClone(row)
    },
    async downloadVerified(portableId, version) {
      const listing = this.get(portableId, version)
      if (listing === undefined) return { valid: false, reason: 'registry release not found' }
      try {
        const archive = await transport.fetchArchive(listing)
        const verification = await verifyWorkbenchRegistryArchive(listing, archive)
        return verification.valid
          ? { valid: true, listing, archive: new Uint8Array(archive), manifest: verification.manifest }
          : { valid: false, reason: verification.reason, listing }
      } catch (error) {
        return { valid: false, reason: error instanceof Error ? error.message : 'registry archive request failed', listing }
      }
    },
  }
}

function versionParts(value: string): [number, number, number] {
  const match = /^(?:v)?(\d+)(?:\.(\d+))?(?:\.(\d+))?/u.exec(value)
  return [Number(match?.[1] ?? 0), Number(match?.[2] ?? 0), Number(match?.[3] ?? 0)]
}

function compareVersion(left: string, right: string): number {
  const a = versionParts(left)
  const b = versionParts(right)
  for (let index = 0; index < 3; index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0)
    if (difference !== 0) return difference
  }
  return left.localeCompare(right, 'en')
}

function isCompatible(version: string, compatibility: { minimum: string; maximum?: string }): boolean {
  return compareVersion(version, compatibility.minimum) >= 0
    && (compatibility.maximum === undefined || compareVersion(version, compatibility.maximum) <= 0)
}

function safeRegistryReference(value: string | undefined): boolean {
  if (value === undefined || value.trim() === '') return true
  return (value.startsWith('/') && !value.startsWith('//')) || /^https?:\/\//iu.test(value)
}

function normalizeListingMetadata(metadata: WorkbenchRegistryListingMetadataV1 | undefined): WorkbenchRegistryListingMetadataV1 | undefined {
  if (metadata === undefined) return undefined
  const portableId = metadata.portableId?.trim()
  if (portableId !== undefined && (portableId === '' || portableId.length > 256)) throw new Error('registry portableId is invalid')
  const tags = [...new Set((metadata.tags ?? []).map(tag => tag.trim()).filter(Boolean))]
  if (tags.length > 32 || tags.some(tag => tag.length > 64)) throw new Error('registry tags exceed limits')
  if (!safeRegistryReference(metadata.packageArchiveUrl) || !safeRegistryReference(metadata.previewSvgUrl)) {
    throw new Error('registry references must be absolute http(s) or root-relative URLs')
  }
  const publisher = metadata.publisher === undefined ? undefined : {
    ...metadata.publisher,
    displayName: metadata.publisher.displayName.trim(),
  }
  if (publisher !== undefined && publisher.displayName === '') throw new Error('registry publisher displayName is required')
  return {
    ...(portableId === undefined ? {} : { portableId }),
    ...(tags.length === 0 ? {} : { tags }),
    ...(metadata.packageArchiveUrl === undefined ? {} : { packageArchiveUrl: metadata.packageArchiveUrl.trim() }),
    ...(metadata.previewSvgUrl === undefined ? {} : { previewSvgUrl: metadata.previewSvgUrl.trim() }),
    ...(publisher === undefined ? {} : { publisher }),
  }
}

function dependencySummary(files: readonly { path: string; content: Uint8Array }[]): {
  editors: number
  static: number
  dynamic: number
  shared: number
  agentPreset: number
} {
  const lock = files.find(file => file.path === 'dependencies.lock.json')
  if (lock === undefined) return { editors: 0, static: 0, dynamic: 0, shared: 0, agentPreset: 0 }
  try {
    const decoded: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(lock.content))
    if (!Array.isArray(decoded)) return { editors: 0, static: 0, dynamic: 0, shared: 0, agentPreset: 0 }
    const editors = new Set<string>()
    let staticCount = 0
    let dynamicCount = 0
    let sharedCount = 0
    let agentPresetCount = 0
    for (const row of decoded) {
      if (typeof row !== 'object' || row === null || Array.isArray(row)) continue
      const value = row as { kind?: unknown; editorIds?: unknown }
      if (Array.isArray(value.editorIds)) {
        for (const editorId of value.editorIds) if (typeof editorId === 'string') editors.add(editorId)
      }
      if (value.kind === 'static') staticCount += 1
      else if (value.kind === 'dynamic') dynamicCount += 1
      else if (value.kind === 'shared') sharedCount += 1
      else if (value.kind === 'agent-preset') agentPresetCount += 1
    }
    return { editors: editors.size, static: staticCount, dynamic: dynamicCount, shared: sharedCount, agentPreset: agentPresetCount }
  } catch {
    return { editors: 0, static: 0, dynamic: 0, shared: 0, agentPreset: 0 }
  }
}

function cloneRelease(release: WorkbenchRegistryReleaseV1): WorkbenchRegistryReleaseV1 {
  return structuredClone(release)
}

function listingForRelease(release: WorkbenchRegistryReleaseV1, files?: readonly { path: string; content: Uint8Array }[]): WorkbenchRegistryListingV1 {
  const summary = dependencySummary(files ?? [])
  const publisher = release.listing?.publisher ?? release.manifest.publisher ?? {
    displayName: '未知发布者', source: 'local' as const,
  }
  const signatureState: WorkbenchRegistrySignatureStateV1 = release.status === 'disabled'
    ? 'revoked'
    : release.signature === undefined ? 'unsigned' : 'package-only'
  return {
    schemaVersion: 1,
    packageId: release.packageId,
    portableId: release.listing?.portableId ?? release.packageId,
    name: release.name,
    description: release.description,
    version: release.version,
    completeness: release.manifest.completeness ?? 'layout-only',
    distributionMode: release.manifest.distributionMode ?? 'online-reference',
    dshCompatibility: structuredClone(release.manifest.compatibility.dsh),
    targets: [...(release.manifest.compatibility.targets ?? [])],
    tags: [...(release.listing?.tags ?? [])],
    editorCount: summary.editors,
    staticDependencyCount: summary.static,
    dynamicDependencyCount: summary.dynamic,
    sharedDependencyCount: summary.shared,
    agentPresetDependencyCount: summary.agentPreset,
    permissionCount: release.manifest.permissions.length,
    permissions: [...release.manifest.permissions],
    ...(release.listing?.previewSvgUrl === undefined ? {} : { previewSvgUrl: release.listing.previewSvgUrl }),
    ...(release.listing?.packageArchiveUrl === undefined ? {} : { packageArchiveUrl: release.listing.packageArchiveUrl }),
    archiveSha256: release.archiveSha256,
    archiveSize: release.archiveSize,
    publisher: structuredClone(publisher),
    signatureState,
    status: release.status,
    createdAt: release.manifest.createdAt,
    updatedAt: new Date(release.disabledAt ?? release.publishedAt).toISOString(),
  }
}

export class MemoryWorkbenchPackageRegistry implements WorkbenchRegistryV1 {
  private readonly releases = new Map<string, WorkbenchRegistryReleaseV1>()
  private readonly archives = new Map<string, Uint8Array>()
  /** Content-addressed object layer used by the fixture implementation. */
  private readonly objects = new Map<string, Uint8Array>()
  private readonly receipts = new Map<string, WorkbenchPackageReceiptV1>()
  private readonly listingFiles = new Map<string, readonly { path: string; content: Uint8Array }[]>()
  private readonly stagedArchives = new Map<string, { archiveSha256: string; archive: Uint8Array }>()

  async publish(input: WorkbenchRegistryPublishInputV1): Promise<WorkbenchRegistryReleaseV1> {
    const archive = new Uint8Array(input.archive)
    const decoded = await decodeWorkbenchPackageArchive(archive)
    if (decoded.manifest.schemaVersion !== 2) throw new Error('registry only accepts Workbench package schema v2')
    const listing = normalizeListingMetadata(input.listing)
    const manifestPublisher = decoded.manifest.publisher
    if (listing?.publisher !== undefined && manifestPublisher !== undefined
      && (listing.publisher.source !== manifestPublisher.source || listing.publisher.keyId !== manifestPublisher.keyId)) {
      throw new Error('registry publisher metadata does not match manifest')
    }
    const effectivePublisherSource = manifestPublisher?.source ?? listing?.publisher?.source ?? 'local'
    if (effectivePublisherSource !== 'local' && input.signature === undefined) {
      throw new Error('non-local registry publication requires a signature')
    }
    const key = `${decoded.manifest.packageId}@${decoded.manifest.version}`
    if (this.releases.has(key)) throw new Error(`package release already exists: ${key}`)
    if (input.signature !== undefined && (input.signature.packageId !== decoded.manifest.packageId || input.signature.version !== decoded.manifest.version)) {
      throw new Error('package signature identity does not match manifest')
    }
    const archiveSha256 = await sha256Hex(archive)
    const release: WorkbenchRegistryReleaseV1 = {
      packageId: decoded.manifest.packageId,
      version: decoded.manifest.version,
      name: decoded.manifest.name,
      description: decoded.manifest.description,
      archiveSha256,
      archiveSize: archive.byteLength,
      manifest: structuredClone(decoded.manifest),
      ...(input.signature === undefined ? {} : { signature: structuredClone(input.signature) }),
      ...(listing === undefined ? {} : { listing }),
      status: 'published', publishedAt: input.now ?? Date.now(), downloadCount: 0,
    }
    this.releases.set(key, release)
    this.archives.set(key, archive)
    this.objects.set(archiveSha256.toLowerCase(), new Uint8Array(archive))
    this.listingFiles.set(key, decoded.files.map(file => ({ path: file.path, content: new Uint8Array(file.content) })))
    return cloneRelease(release)
  }

  get(packageId: string, version?: string): WorkbenchRegistryReleaseV1 | undefined {
    if (version !== undefined) {
      const release = this.releases.get(`${packageId}@${version}`)
      return release === undefined ? undefined : cloneRelease(release)
    }
    const candidates = [...this.releases.values()]
      .filter(release => release.packageId === packageId && release.status === 'published')
      .sort((left, right) => compareVersion(right.version, left.version))
    const release = candidates[0]
    return release === undefined ? undefined : cloneRelease(release)
  }

  getListing(packageId: string, version?: string): WorkbenchRegistryListingV1 | undefined {
    const release = this.get(packageId, version)
    if (release === undefined) return undefined
    return listingForRelease(release, this.listingFiles.get(`${release.packageId}@${release.version}`))
  }

  list(options: WorkbenchRegistryListOptionsV1 = {}): readonly WorkbenchRegistryReleaseV1[] {
    const query = options.query?.trim().toLocaleLowerCase('zh-CN')
    const requestedLimit = options.limit ?? 100
    const limit = Number.isFinite(requestedLimit) && requestedLimit >= 0 ? Math.min(1000, Math.floor(requestedLimit)) : 100
    const rows = [...this.releases.values()]
      .filter(release => options.includeDisabled === true || release.status === 'published')
      .filter(release => options.compatibleDsh === undefined || isCompatible(options.compatibleDsh, release.manifest.compatibility.dsh))
      .filter(release => options.completeness === undefined || (release.manifest.completeness ?? 'layout-only') === options.completeness)
      .filter(release => options.signatureState === undefined || listingForRelease(release, this.listingFiles.get(`${release.packageId}@${release.version}`)).signatureState === options.signatureState)
      .filter(release => query === undefined || query === ''
        || release.packageId.toLocaleLowerCase('zh-CN').includes(query)
        || release.name.toLocaleLowerCase('zh-CN').includes(query)
        || release.description.toLocaleLowerCase('zh-CN').includes(query)
        || (release.listing?.tags ?? []).some(tag => tag.toLocaleLowerCase('zh-CN').includes(query)))
      .filter(release => (options.tags ?? []).every(tag => (release.listing?.tags ?? []).includes(tag)))
      .sort((left, right) => right.publishedAt - left.publishedAt || compareVersion(right.version, left.version))
      .slice(0, limit)
    return rows.map(cloneRelease)
  }

  listings(options: WorkbenchRegistryListOptionsV1 = {}): readonly WorkbenchRegistryListingV1[] {
    return this.list(options).map(release => listingForRelease(release, this.listingFiles.get(`${release.packageId}@${release.version}`)))
  }

  download(packageId: string, version?: string): Uint8Array | undefined {
    const release = this.get(packageId, version)
    if (release === undefined || release.status !== 'published') return undefined
    const key = `${release.packageId}@${release.version}`
    const archive = this.objects.get(release.archiveSha256.toLowerCase()) ?? this.archives.get(key)
    if (archive === undefined) return undefined
    const current = this.releases.get(key)
    if (current !== undefined) current.downloadCount += 1
    return new Uint8Array(archive)
  }

  stageArchive(archive: Uint8Array, identity: { packageId: string; version: string; archiveSha256: string }): void {
    if (!/^[a-f0-9]{64}$/iu.test(identity.archiveSha256) || archive.byteLength === 0) {
      throw new Error('staged archive digest or bytes are invalid')
    }
    const key = `${identity.packageId}@${identity.version}`
    const release = this.releases.get(key)
    if (release !== undefined && release.archiveSha256.toLowerCase() !== identity.archiveSha256.toLowerCase()) {
      throw new Error(`staged archive conflicts with published release: ${key}`)
    }
    const existing = this.stagedArchives.get(key)
    if (existing !== undefined && existing.archiveSha256.toLowerCase() !== identity.archiveSha256.toLowerCase()) {
      throw new Error(`staged archive identity conflict: ${key}`)
    }
    this.stagedArchives.set(key, { archiveSha256: identity.archiveSha256, archive: new Uint8Array(archive) })
  }

  stagedArchive(packageId: string, version: string, archiveSha256?: string): Uint8Array | undefined {
    const row = this.stagedArchives.get(`${packageId}@${version}`)
    if (row === undefined || (archiveSha256 !== undefined && row.archiveSha256.toLowerCase() !== archiveSha256.toLowerCase())) return undefined
    return new Uint8Array(row.archive)
  }

  disable(packageId: string, version: string, at = Date.now()): boolean {
    const key = `${packageId}@${version}`
    const release = this.releases.get(key)
    if (release === undefined) return false
    if (release.status === 'disabled') return true
    release.status = 'disabled'
    release.disabledAt = at
    return true
  }

  recordReceipt(receipt: WorkbenchPackageReceiptV1): void {
    const key = `${receipt.packageId}@${receipt.version}`
    const release = this.releases.get(key)
    if (release !== undefined && release.archiveSha256 !== receipt.archiveSha256) throw new Error('package receipt archive digest mismatch')
    this.receipts.set(key, structuredClone(receipt))
  }

  getReceipt(packageId: string, version: string): WorkbenchPackageReceiptV1 | undefined {
    const receipt = this.receipts.get(`${packageId}@${version}`)
    return receipt === undefined ? undefined : structuredClone(receipt)
  }

  removeReceipt(packageId: string, version: string): boolean {
    return this.receipts.delete(`${packageId}@${version}`)
  }

  snapshot(): WorkbenchRegistrySnapshotV1 {
    return {
      schemaVersion: 1,
      releases: [...this.releases.entries()].map(([key, release]) => ({
        release: cloneRelease(release), archive: new Uint8Array(this.archives.get(key) ?? new Uint8Array()),
      })),
      receipts: [...this.receipts.values()].map(receipt => structuredClone(receipt)),
      stagedArchives: [...this.stagedArchives.entries()].map(([key, row]) => {
        const separator = key.lastIndexOf('@')
        return {
          packageId: key.slice(0, separator), version: key.slice(separator + 1),
          archiveSha256: row.archiveSha256, archive: new Uint8Array(row.archive),
        }
      }),
    }
  }

  restore(snapshot: WorkbenchRegistrySnapshotV1): void {
    if (snapshot.schemaVersion !== 1) throw new Error('unsupported registry snapshot')
    this.releases.clear()
    this.archives.clear()
    this.objects.clear()
    this.listingFiles.clear()
    this.receipts.clear()
    this.stagedArchives.clear()
    for (const row of snapshot.releases) {
      const key = `${row.release.packageId}@${row.release.version}`
      if (this.releases.has(key)) throw new Error(`duplicate registry release: ${key}`)
      this.releases.set(key, cloneRelease(row.release))
      const archive = new Uint8Array(row.archive)
      this.archives.set(key, archive)
      this.objects.set(row.release.archiveSha256.toLowerCase(), new Uint8Array(archive))
      // Rebuild the non-executable listing projection from the immutable
      // archive. This does not validate or execute any package code; the
      // archive was already accepted before it entered the snapshot.
      try {
        this.listingFiles.set(key, decodeDeterministicZip(row.archive)
          .filter(file => file.path !== 'manifest.json')
          .map(file => ({ path: file.path, content: new Uint8Array(file.content) })))
      } catch {
        // A legacy/incomplete snapshot remains listable, but with conservative
        // dependency counts until a fresh publish replaces it.
        this.listingFiles.set(key, [])
      }
    }
    for (const receipt of snapshot.receipts ?? []) this.recordReceipt(receipt)
    for (const staged of snapshot.stagedArchives ?? []) {
      this.stageArchive(staged.archive, {
        packageId: staged.packageId, version: staged.version, archiveSha256: staged.archiveSha256,
      })
    }
  }
}

interface PersistedRegistrySnapshotV1 {
  schemaVersion: 1
  releases: readonly {
    release: WorkbenchRegistryReleaseV1
    archive: readonly number[]
  }[]
  receipts: readonly WorkbenchPackageReceiptV1[]
  stagedArchives?: readonly {
    packageId: string
    version: string
    archiveSha256: string
    archive: readonly number[]
  }[]
}

const DEFAULT_WORKBENCH_REGISTRY_STORAGE_KEY = 'dsh.workbench.registry.v1'
const MAX_REGISTRY_RELEASES = 256
const MAX_REGISTRY_ARCHIVE_BYTES = 128 * 1024 * 1024

/**
 * Recoverable registry adapter for a Host-owned key/value bridge. It persists
 * immutable package receipts and archives, but never executes package code or
 * treats a restored receipt as Runtime readiness.
 */
export class LocalStorageWorkbenchPackageRegistry implements WorkbenchRegistryV1 {
  private readonly memory = new MemoryWorkbenchPackageRegistry()
  private readonly storage: WorkbenchRegistryStorageV1
  private readonly key: string
  private readonly restorePromise: Promise<void>

  constructor(namespace = DEFAULT_WORKBENCH_REGISTRY_STORAGE_KEY, storage?: WorkbenchRegistryStorageV1) {
    let fallback: WorkbenchRegistryStorageV1 | undefined
    try { fallback = globalThis.localStorage } catch { fallback = undefined }
    if (storage === undefined && fallback === undefined) {
      throw new Error('Workbench durable Package Registry requires an explicit storage backend outside a browser')
    }
    this.storage = storage ?? fallback!
    this.key = namespace.trim() === '' ? DEFAULT_WORKBENCH_REGISTRY_STORAGE_KEY : namespace
    this.restorePromise = this.restoreFromStorage()
  }

  async ready(): Promise<void> { await this.restorePromise }

  private async restoreFromStorage(): Promise<void> {
    let parsed: unknown
    try {
      const raw = this.storage.getItem(this.key)
      if (raw === null) return
      parsed = JSON.parse(raw) as unknown
    } catch {
      this.storage.removeItem(this.key)
      return
    }
    if (!isRecord(parsed) || parsed.schemaVersion !== 1 || !Array.isArray(parsed.releases)
      || !Array.isArray(parsed.receipts) || parsed.releases.length > MAX_REGISTRY_RELEASES) return
    let archiveBytes = 0
    const rows: Array<WorkbenchRegistrySnapshotV1['releases'][number]> = []
    for (const candidate of parsed.releases) {
      if (!isRecord(candidate) || !isRecord(candidate.release) || !Array.isArray(candidate.archive)) return
      if (!candidate.archive.every(byte => Number.isInteger(byte) && Number(byte) >= 0 && Number(byte) <= 255)) return
      archiveBytes += candidate.archive.length
      if (archiveBytes > MAX_REGISTRY_ARCHIVE_BYTES) return
      const release = candidate.release as Record<string, unknown>
      if (typeof release.packageId !== 'string' || typeof release.version !== 'string'
        || typeof release.archiveSha256 !== 'string' || !/^[a-f0-9]{64}$/iu.test(release.archiveSha256)
        || typeof release.archiveSize !== 'number' || release.archiveSize !== candidate.archive.length
        || typeof release.manifest !== 'object' || release.manifest === null
        || (release.status !== 'published' && release.status !== 'disabled')) continue
      const archive = new Uint8Array(candidate.archive as number[])
      if ((await sha256Hex(archive)).toUpperCase() !== release.archiveSha256.toUpperCase()) continue
      try {
        const decoded = await decodeWorkbenchPackageArchive(archive)
        if (decoded.manifest.schemaVersion !== 2
          || decoded.manifest.packageId !== release.packageId
          || decoded.manifest.version !== release.version) continue
      } catch {
        continue
      }
      rows.push({
        release: candidate.release as unknown as WorkbenchRegistryReleaseV1,
        archive,
      })
    }
    try {
      const stagedArchiveCandidates = Array.isArray(parsed.stagedArchives) ? parsed.stagedArchives : []
      const receipts = parsed.receipts.filter(candidate => {
        if (!isRecord(candidate) || typeof candidate.packageId !== 'string' || typeof candidate.version !== 'string'
          || typeof candidate.archiveSha256 !== 'string' || !/^[a-f0-9]{64}$/iu.test(candidate.archiveSha256)
          || !Number.isFinite(candidate.installedAt)
          || (candidate.source !== 'local' && candidate.source !== 'community' && candidate.source !== 'organization' && candidate.source !== 'official')
          || (candidate.signatureState !== 'trusted' && candidate.signatureState !== 'package-only'
            && candidate.signatureState !== 'unsigned' && candidate.signatureState !== 'revoked')
          || !Array.isArray(candidate.dependencies) || !candidate.dependencies.every(dependency => isRecord(dependency)
            && typeof dependency.portableId === 'string' && typeof dependency.version === 'string'
            && typeof dependency.digest === 'string' && /^[a-f0-9]{64}$/iu.test(dependency.digest))
          || !Array.isArray(candidate.referencedWorkbenches) || !candidate.referencedWorkbenches.every(item => typeof item === 'string')) return false
        const release = rows.find(row => `${row.release.packageId}@${row.release.version}` === `${candidate.packageId}@${candidate.version}`)?.release
        if (release !== undefined) return release.archiveSha256.toUpperCase() === candidate.archiveSha256.toUpperCase()
        const staged = stagedArchiveCandidates.find(item => isRecord(item)
          && item.packageId === candidate.packageId && item.version === candidate.version)
        return staged !== undefined && staged.archiveSha256.toUpperCase() === candidate.archiveSha256.toUpperCase()
      }) as WorkbenchPackageReceiptV1[]
      // Build a mutable staging list while validating hostile localStorage;
      // the public snapshot deliberately exposes it as readonly.
      const stagedRows: Array<NonNullable<WorkbenchRegistrySnapshotV1['stagedArchives']>[number]> = []
      const stagedCandidates = parsed.stagedArchives === undefined ? [] : parsed.stagedArchives
      if (!Array.isArray(stagedCandidates) || stagedCandidates.length > MAX_REGISTRY_RELEASES) return
      for (const candidate of stagedCandidates) {
        if (!isRecord(candidate) || typeof candidate.packageId !== 'string' || typeof candidate.version !== 'string'
          || typeof candidate.archiveSha256 !== 'string' || !/^[a-f0-9]{64}$/iu.test(candidate.archiveSha256)
          || !Array.isArray(candidate.archive) || !candidate.archive.every(byte => Number.isInteger(byte) && Number(byte) >= 0 && Number(byte) <= 255)) continue
        const archive = new Uint8Array(candidate.archive as number[])
        if ((await sha256Hex(archive)).toUpperCase() !== candidate.archiveSha256.toUpperCase()) continue
        try {
          const decoded = await decodeWorkbenchPackageArchive(archive)
          if (decoded.manifest.schemaVersion !== 2 || decoded.manifest.packageId !== candidate.packageId || decoded.manifest.version !== candidate.version) continue
        } catch { continue }
        archiveBytes += archive.length
        if (archiveBytes > MAX_REGISTRY_ARCHIVE_BYTES) return
        stagedRows.push({ packageId: candidate.packageId, version: candidate.version, archiveSha256: candidate.archiveSha256, archive })
      }
      this.memory.restore({
        schemaVersion: 1,
        releases: rows,
        receipts,
        stagedArchives: stagedRows,
      })
    } catch {
      this.storage.removeItem(this.key)
    }
  }

  private persist(): void {
    const current = this.memory.snapshot()
    const snapshot: PersistedRegistrySnapshotV1 = {
      schemaVersion: 1,
      releases: current.releases.map(row => ({
        release: structuredClone(row.release),
        archive: [...row.archive],
      })),
      receipts: [...(current.receipts ?? [])].map(receipt => structuredClone(receipt)),
      stagedArchives: (current.stagedArchives ?? []).map(row => ({
        packageId: row.packageId, version: row.version, archiveSha256: row.archiveSha256,
        archive: [...row.archive],
      })),
    }
    try {
      this.storage.setItem(this.key, JSON.stringify(snapshot))
    } catch (error) {
      throw new Error(`Workbench Package Registry 持久化失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  async publish(input: WorkbenchRegistryPublishInputV1): Promise<WorkbenchRegistryReleaseV1> {
    await this.restorePromise
    const release = await this.memory.publish(input)
    this.persist()
    return release
  }
  get(packageId: string, version?: string): WorkbenchRegistryReleaseV1 | undefined { return this.memory.get(packageId, version) }
  getListing(packageId: string, version?: string): WorkbenchRegistryListingV1 | undefined { return this.memory.getListing(packageId, version) }
  list(options?: WorkbenchRegistryListOptionsV1): readonly WorkbenchRegistryReleaseV1[] { return this.memory.list(options) }
  listings(options?: WorkbenchRegistryListOptionsV1): readonly WorkbenchRegistryListingV1[] { return this.memory.listings(options) }
  download(packageId: string, version?: string): Uint8Array | undefined { return this.memory.download(packageId, version) }
  async stageArchive(archive: Uint8Array, identity: { packageId: string; version: string; archiveSha256: string }): Promise<void> {
    await this.restorePromise
    this.memory.stageArchive(archive, identity)
    this.persist()
  }
  stagedArchive(packageId: string, version: string, archiveSha256?: string): Uint8Array | undefined {
    return this.memory.stagedArchive(packageId, version, archiveSha256)
  }
  disable(packageId: string, version: string, at?: number): boolean {
    const changed = this.memory.disable(packageId, version, at)
    if (changed) this.persist()
    return changed
  }
  snapshot(): WorkbenchRegistrySnapshotV1 { return this.memory.snapshot() }
  restore(snapshot: WorkbenchRegistrySnapshotV1): void { this.memory.restore(snapshot); this.persist() }
  recordReceipt(receipt: WorkbenchPackageReceiptV1): void { this.memory.recordReceipt(receipt); this.persist() }
  getReceipt(packageId: string, version: string): WorkbenchPackageReceiptV1 | undefined { return this.memory.getReceipt(packageId, version) }
  removeReceipt(packageId: string, version: string): boolean {
    const removed = this.memory.removeReceipt(packageId, version)
    if (removed) this.persist()
    return removed
  }
}
