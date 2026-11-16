import { validateWorkbenchModuleManifestV1, workbenchModuleKindFor, type WorkbenchModuleManifestV1, type WorkbenchModuleStaticManifestV1 } from './module-contract.ts'
import { validateWorkbenchModuleSource, validateWorkbenchModuleSourceRequest, workbenchCoreCompatibilitySatisfies, type WorkbenchModuleSourceRequestV1, type WorkbenchModuleSourceV1, type WorkbenchModuleTrustV1 } from './module-source.ts'
import { WORKBENCH_CORE_VERSION, WORKBENCH_DSH_GENERATION, WORKBENCH_UPSTREAM_COMMIT } from './release-compatibility.ts'

export interface WorkbenchDirectPackageDescriptorV1 {
  readonly packageName: string
  /** Package manifests are normally static: the final tarball digest lives in the receipt. */
  readonly manifest: WorkbenchModuleStaticManifestV1 | WorkbenchModuleManifestV1
  readonly artifactBytes: Uint8Array
  readonly dshGeneration: string
  readonly permissions: readonly string[]
  readonly provenance: { readonly upstreamCommit: string; readonly sourceDigest: string; readonly patchDigest: string }
  readonly resolvedVersion?: string
  readonly resolvedCommit?: string
  readonly registry?: string
  readonly repository?: string
  readonly subpath?: string
}

export interface WorkbenchResolvedDirectPackageV1 {
  readonly source: WorkbenchModuleSourceV1
  readonly trust: Extract<WorkbenchModuleTrustV1, 'user-approved-unverified'>
  readonly moduleId: string
  readonly packageName: string
  readonly manifest: WorkbenchModuleStaticManifestV1 | WorkbenchModuleManifestV1
  readonly artifactDigest: string
}

export type WorkbenchArtifactDigestV1 = (bytes: Uint8Array) => Promise<string>

async function defaultDigest(bytes: Uint8Array): Promise<string> {
  const subtle = globalThis.crypto?.subtle
  if (subtle === undefined) throw new Error('artifact-integrity-mismatch')
  const hash = new Uint8Array(await subtle.digest('SHA-256', new Uint8Array(bytes).buffer))
  return [...hash].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

function ownKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every(key => allowed.includes(key))
}

/**
 * Revalidates a package after the Manager has resolved/downloaded it. The
 * browser never supplies this descriptor: it is produced by the Host's npm
 * or Git authority. The artifact digest is computed from the exact bytes that
 * will be staged, then compared with the manifest and source identity.
 */
export async function resolveWorkbenchDirectPackageV1(
  request: WorkbenchModuleSourceRequestV1,
  descriptor: WorkbenchDirectPackageDescriptorV1,
  digestArtifact: WorkbenchArtifactDigestV1 = defaultDigest,
): Promise<WorkbenchResolvedDirectPackageV1> {
  if (!validateWorkbenchModuleSourceRequest(request)) throw new Error('source-not-allowed')
  if (!validateWorkbenchModuleSourceRequest({ kind: 'npm', packageName: descriptor.packageName }) || descriptor.artifactBytes.byteLength === 0 || descriptor.artifactBytes.byteLength > 64 * 1024 * 1024) throw new Error('package-manifest-invalid')
  try { validateWorkbenchModuleManifestV1(descriptor.manifest) } catch { throw new Error('package-manifest-invalid') }
  if (descriptor.dshGeneration !== WORKBENCH_DSH_GENERATION) throw new Error('module-incompatible')
  if (!workbenchCoreCompatibilitySatisfies(WORKBENCH_CORE_VERSION, descriptor.manifest.coreCompatibility)) throw new Error('module-incompatible')
  if (!Array.isArray(descriptor.permissions) || descriptor.permissions.some(permission => typeof permission !== 'string' || permission.trim() === '')) throw new Error('package-manifest-invalid')
  if (!descriptor.provenance || !/^[a-f0-9]{40}$/iu.test(descriptor.provenance.upstreamCommit) || !/^[a-f0-9]{64}$/iu.test(descriptor.provenance.sourceDigest) || !/^[a-f0-9]{64}$/iu.test(descriptor.provenance.patchDigest)) throw new Error('package-manifest-invalid')
  if (descriptor.provenance.upstreamCommit !== WORKBENCH_UPSTREAM_COMMIT) throw new Error('module-incompatible')
  if (descriptor.manifest.moduleId.trim() === '') throw new Error('package-manifest-invalid')
  if (descriptor.manifest.coreCompatibility.trim() === '') throw new Error('package-manifest-invalid')
  if (workbenchModuleKindFor(descriptor.manifest) === 'official-builtin' || descriptor.manifest.moduleId.startsWith('workbench.core')) throw new Error('source-not-allowed')
  const declaredDigest = 'artifactDigest' in descriptor.manifest ? descriptor.manifest.artifactDigest : undefined
  if (declaredDigest !== undefined && !/^[a-f0-9]{64}$/iu.test(declaredDigest)) throw new Error('package-manifest-invalid')
  const artifactDigest = (await digestArtifact(descriptor.artifactBytes)).toLowerCase()
  if (!/^[a-f0-9]{64}$/u.test(artifactDigest)) throw new Error('artifact-integrity-mismatch')
  if (declaredDigest !== undefined && declaredDigest.toLowerCase() !== artifactDigest) throw new Error('artifact-integrity-mismatch')
  if (descriptor.manifest.upstream?.commit !== undefined && !/^[a-f0-9]{40}$/iu.test(descriptor.manifest.upstream.commit)) throw new Error('package-manifest-invalid')
  if (request.kind === 'npm') {
    if (descriptor.resolvedVersion === undefined || descriptor.registry === undefined || descriptor.packageName !== request.packageName || descriptor.manifest.version !== descriptor.resolvedVersion) throw new Error('source-resolution-failed')
    const source: WorkbenchModuleSourceV1 = { kind: 'npm', packageName: request.packageName, ...(request.requestedRange === undefined ? {} : { requestedRange: request.requestedRange }), resolvedVersion: descriptor.resolvedVersion, artifactDigest, registry: descriptor.registry }
    if (!validateWorkbenchModuleSource(source) || new URL(source.registry).href !== new URL(request.registry ?? 'https://registry.npmjs.org/').href) throw new Error('source-resolution-failed')
    return { source, trust: 'user-approved-unverified', moduleId: descriptor.manifest.moduleId, packageName: descriptor.packageName, manifest: descriptor.manifest, artifactDigest }
  }
  if (descriptor.resolvedCommit === undefined || descriptor.repository === undefined || descriptor.repository !== request.repository || descriptor.subpath !== request.subpath || !/^[a-f0-9]{40}$/iu.test(descriptor.resolvedCommit)) throw new Error('source-resolution-failed')
  const source: WorkbenchModuleSourceV1 = { kind: 'git', repository: request.repository, resolvedCommit: descriptor.resolvedCommit.toLowerCase(), ...(request.subpath === undefined ? {} : { subpath: request.subpath }), artifactDigest }
  return { source, trust: 'user-approved-unverified', moduleId: descriptor.manifest.moduleId, packageName: descriptor.packageName, manifest: descriptor.manifest, artifactDigest }
}

/** Checks the fields which are easy to accidentally omit when serialising a Host result. */
export function validateWorkbenchDirectPackageDescriptorV1(value: unknown): value is WorkbenchDirectPackageDescriptorV1 {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const row = value as Record<string, unknown>
  return ownKeys(row, ['packageName', 'manifest', 'artifactBytes', 'dshGeneration', 'permissions', 'provenance', 'resolvedVersion', 'resolvedCommit', 'registry', 'repository', 'subpath'])
    && typeof row.packageName === 'string' && typeof row.dshGeneration === 'string' && typeof row.manifest === 'object' && row.manifest !== null
    && Array.isArray(row.permissions) && typeof row.provenance === 'object' && row.provenance !== null
    && row.artifactBytes instanceof Uint8Array
}
