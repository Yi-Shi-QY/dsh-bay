import { validateWorkbenchModuleManifestV1, type WorkbenchModuleDeliveryV1, type WorkbenchModuleKindV1, type WorkbenchModuleManifestV1 } from './module-contract.ts'

export interface WorkbenchModuleIdentityV1 {
  readonly moduleId: string
  readonly version: string
  readonly artifactDigest: string
}

/** Facts which are available in source before a release tarball exists. */
export interface WorkbenchModuleSourceIdentityV1 {
  readonly moduleId: string
  readonly version: string
}

export interface WorkbenchModuleDependencyRequestV1 {
  readonly moduleId: string
  readonly version?: string
  readonly artifactDigest?: string
}

export interface WorkbenchModuleCatalogEntryV1 extends WorkbenchModuleIdentityV1 {
  /** Omitted only by legacy catalogs; the module classifier supplies a safe default. */
  readonly kind?: WorkbenchModuleKindV1
  /** Omitted only by legacy catalogs; derived from kind for compatibility. */
  readonly delivery?: WorkbenchModuleDeliveryV1
  readonly coreCompatibility: string
  readonly requires: {
    readonly modules: readonly WorkbenchModuleDependencyRequestV1[]
    readonly capabilities: readonly string[]
  }
  readonly source: {
    /**
     * V1 Modules are admitted only from a signed archive selected by the
     * user. The older source kinds remain here for legacy migration readers;
     * the V1 Manager never creates a plan from them.
     */
    readonly kind: 'registry' | 'embedded' | 'local' | 'signed-local-catalog'
    readonly locator: string
    readonly publisher?: string
    readonly signature?: string
  }
  /** Immutable facts checked before staging and again after DSH restarts. */
  readonly signedCatalog?: {
    readonly catalogId: string
    readonly publisherKeyId: string
    readonly packageName: string
    readonly integrity: string
    readonly size: number
    readonly dshGeneration: string
    readonly permissions: readonly string[]
    readonly provenance: {
      readonly upstreamCommit: string
      readonly sourceDigest: string
      readonly patchDigest: string
    }
    readonly revoked: boolean
  }
  readonly manifest?: WorkbenchModuleManifestV1
}

export interface WorkbenchModuleCatalogV1 {
  list(): readonly WorkbenchModuleCatalogEntryV1[]
  get(moduleId: string, version: string, artifactDigest: string): WorkbenchModuleCatalogEntryV1 | undefined
  resolve(request: WorkbenchModuleDependencyRequestV1): WorkbenchModuleCatalogEntryV1 | undefined
}

const SHA256 = /^[a-f0-9]{64}$/iu

function compareVersions(left: string, right: string): number {
  const parse = (value: string): [number[], string] => {
    const [core = '', ...suffix] = value.split('-')
    return [core.split('.').map(part => Number.parseInt(part, 10) || 0), suffix.join('-')]
  }
  const [leftCore, leftSuffix] = parse(left)
  const [rightCore, rightSuffix] = parse(right)
  for (let index = 0; index < Math.max(leftCore.length, rightCore.length); index += 1) {
    const difference = (leftCore[index] ?? 0) - (rightCore[index] ?? 0)
    if (difference !== 0) return difference
  }
  if (leftSuffix === rightSuffix) return 0
  if (leftSuffix === '') return 1
  if (rightSuffix === '') return -1
  return leftSuffix.localeCompare(rightSuffix)
}

function validateEntry(entry: WorkbenchModuleCatalogEntryV1): void {
  if (!/^workbench\.[a-z0-9][a-z0-9.-]*$/u.test(entry.moduleId)) throw new Error(`Invalid Workbench catalog moduleId: ${entry.moduleId}`)
  if (entry.kind !== undefined && entry.kind !== 'official-builtin' && entry.kind !== 'extension') throw new Error(`Invalid Workbench catalog module kind: ${String(entry.kind)}`)
  if (entry.delivery !== undefined && !['core-bundled', 'official-component', 'catalog', 'direct-source'].includes(entry.delivery)) throw new Error(`Invalid Workbench catalog delivery: ${String(entry.delivery)}`)
  if (entry.kind === 'official-builtin' && (entry.delivery === 'catalog' || entry.delivery === 'direct-source')) throw new Error(`Official builtin catalog entry cannot use extension delivery: ${entry.moduleId}`)
  if (entry.kind === 'extension' && (entry.delivery === 'core-bundled' || entry.delivery === 'official-component')) throw new Error(`Extension catalog entry cannot use official delivery: ${entry.moduleId}`)
  if (entry.version.trim() === '') throw new Error(`Catalog entry ${entry.moduleId} requires a version`)
  if (!SHA256.test(entry.artifactDigest)) throw new Error(`Catalog entry ${entry.moduleId} requires a SHA-256 artifactDigest`)
  if (entry.coreCompatibility.trim() === '') throw new Error(`Catalog entry ${entry.moduleId} requires coreCompatibility`)
  if (entry.source.locator.trim() === '') throw new Error(`Catalog entry ${entry.moduleId} requires a source locator`)
  if (entry.source.kind === 'signed-local-catalog') {
    if (!new RegExp(`^artifacts/${entry.artifactDigest.toLowerCase()}\\.tgz$`, 'iu').test(entry.source.locator)) throw new Error(`Signed catalog artifact locator does not match digest: ${entry.moduleId}`)
    const signed = entry.signedCatalog
    if (signed === undefined) throw new Error(`Signed catalog facts are required for ${entry.moduleId}`)
    if (signed.catalogId.trim() === '' || signed.publisherKeyId.trim() === '' || !/^@?[a-z0-9][a-z0-9._/-]*$/iu.test(signed.packageName)) throw new Error(`Signed catalog provenance is invalid for ${entry.moduleId}`)
    if (!/^sha512-[A-Za-z0-9+/]+={0,2}$/u.test(signed.integrity) || !Number.isSafeInteger(signed.size) || signed.size <= 0) throw new Error(`Signed catalog artifact integrity is invalid for ${entry.moduleId}`)
    if (signed.dshGeneration.trim() === '') throw new Error(`Signed catalog DSH generation is required for ${entry.moduleId}`)
    if (new Set(signed.permissions).size !== signed.permissions.length) throw new Error(`Signed catalog permissions contain duplicates for ${entry.moduleId}`)
    if (!SHA256.test(signed.provenance.sourceDigest) || !SHA256.test(signed.provenance.patchDigest) || !/^[a-f0-9]{40}$/iu.test(signed.provenance.upstreamCommit)) throw new Error(`Signed catalog provenance digest is invalid for ${entry.moduleId}`)
  } else if (entry.signedCatalog !== undefined) {
    throw new Error(`Unsigned catalog entry cannot carry signed catalog facts: ${entry.moduleId}`)
  }
  for (const dependency of entry.requires.modules) {
    if (!/^workbench\.[a-z0-9][a-z0-9.-]*$/u.test(dependency.moduleId)) throw new Error(`Invalid dependency ${dependency.moduleId} for ${entry.moduleId}`)
    if (dependency.artifactDigest !== undefined && !SHA256.test(dependency.artifactDigest)) throw new Error(`Invalid dependency digest ${dependency.moduleId}`)
  }
  if (entry.manifest !== undefined) validateWorkbenchModuleManifestV1(entry.manifest)
}

export function createWorkbenchModuleCatalog(entries: readonly WorkbenchModuleCatalogEntryV1[]): WorkbenchModuleCatalogV1 {
  const byIdentity = new Map<string, WorkbenchModuleCatalogEntryV1>()
  const byModuleVersion = new Set<string>()
  const all = [...entries]
  for (const entry of all) {
    validateEntry(entry)
    const key = `${entry.moduleId}\u0000${entry.version}\u0000${entry.artifactDigest.toLowerCase()}`
    if (byIdentity.has(key)) throw new Error(`Duplicate Workbench catalog identity: ${entry.moduleId}@${entry.version}`)
    const versionKey = `${entry.moduleId}\u0000${entry.version}`
    if (byModuleVersion.has(versionKey)) throw new Error(`Workbench catalog module version resolves to multiple digests: ${entry.moduleId}@${entry.version}`)
    byIdentity.set(key, entry)
    byModuleVersion.add(versionKey)
  }
  const list = all.sort((left, right) => left.moduleId.localeCompare(right.moduleId) || compareVersions(right.version, left.version) || left.artifactDigest.localeCompare(right.artifactDigest))
  return {
    list: () => [...list],
    get(moduleId, version, artifactDigest) {
      return byIdentity.get(`${moduleId}\u0000${version}\u0000${artifactDigest.toLowerCase()}`)
    },
    resolve(request) {
      const candidates = list.filter(entry => entry.moduleId === request.moduleId && (request.version === undefined || entry.version === request.version) && (request.artifactDigest === undefined || entry.artifactDigest.toLowerCase() === request.artifactDigest.toLowerCase()))
      return candidates[0]
    },
  }
}
