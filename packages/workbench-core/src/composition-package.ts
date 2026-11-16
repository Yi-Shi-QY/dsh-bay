import type { WorkbenchModuleManifestV1 } from './module-contract.ts'

export interface WorkbenchCompositionPackageV2 {
  readonly format: 'dsh-workbench-package'
  readonly schemaVersion: 2
  readonly core: Pick<WorkbenchModuleManifestV1, 'moduleId' | 'version' | 'artifactDigest'>
  readonly modules: readonly Pick<WorkbenchModuleManifestV1, 'moduleId' | 'version' | 'artifactDigest'>[]
  readonly workbench: { readonly document: unknown; readonly activeEditors: readonly string[] }
  readonly dependencies: {
    readonly lockDigest: string
    readonly moduleArtifacts: readonly WorkbenchCompositionModuleArtifactV1[]
    readonly npmArtifacts: readonly unknown[]
    readonly agentArtifacts: readonly unknown[]
    readonly skills: readonly unknown[]
    readonly mcp: readonly unknown[]
  }
  readonly runtimeRequirements: { readonly dshVersion: string; readonly capabilities: readonly string[] }
  readonly recipientBindings: { readonly workspace: 'needs-recipient-binding'; readonly session: 'recipient-local'; readonly credentials: 'never-exported' }
  readonly provenance: { readonly exporter: string; readonly derivedFrom?: string }
}

/**
 * Host-resolvable module artifact reference. The tarball path is transport
 * metadata for the package archive only; it is never handed to Core as a
 * filesystem authority. A Host artifact reader resolves this identity from
 * its own staging store before installation.
 */
export interface WorkbenchCompositionModuleArtifactV1 {
  readonly moduleId: string
  readonly packageName: string
  readonly version: string
  readonly artifactDigest: string
  readonly integrity: string
  readonly tarball: string
  readonly size: number
}

const SHA256 = /^[a-f0-9]{64}$/iu
const PACKAGE_NAME = /^(?:@[a-z0-9](?:[a-z0-9._~-]*[a-z0-9])?\/)?[a-z0-9](?:[a-z0-9._~-]*[a-z0-9])?$/iu
const INTEGRITY = /^sha(?:256|384|512)-[A-Za-z0-9+/]+={0,2}$/u
const safeRelative = (value: string): boolean => value.trim() !== ''
  && !value.startsWith('/') && !value.startsWith('\\') && !/^[A-Za-z]:/u.test(value)
  && !value.includes('\\') && value.split('/').every(part => part !== '' && part !== '.' && part !== '..')
export function validateWorkbenchCompositionPackageV2(value: unknown): asserts value is WorkbenchCompositionPackageV2 {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Workbench composition package must be an object')
  const pkg = value as Partial<WorkbenchCompositionPackageV2>
  if (pkg.format !== 'dsh-workbench-package' || pkg.schemaVersion !== 2) throw new Error('Unsupported Workbench composition package format')
  if (pkg.core?.moduleId !== 'workbench.core') throw new Error('Composition package must declare workbench.core')
  if (pkg.core.version.trim() === '' || !SHA256.test(pkg.core.artifactDigest)) throw new Error('Invalid Core exact identity')
  if (!Array.isArray(pkg.modules)) throw new Error('Composition package modules must be an array')
  const ids = new Set<string>()
  for (const module of pkg.modules) {
    if (typeof module?.moduleId !== 'string' || !module.moduleId.startsWith('workbench.')) throw new Error('Invalid module id')
    if (ids.has(module.moduleId)) throw new Error(`Duplicate module: ${module.moduleId}`)
    ids.add(module.moduleId)
    if (module.version.trim() === '' || !SHA256.test(module.artifactDigest)) throw new Error(`Invalid exact identity: ${module.moduleId}`)
  }
  if (pkg.modules.some(module => module.moduleId === 'workbench.core')) throw new Error('Core must not be repeated in modules')
  if (pkg.dependencies === undefined || !Array.isArray(pkg.dependencies.moduleArtifacts)) throw new Error('Composition package moduleArtifacts must be an array')
  const identities = new Map([[pkg.core.moduleId, pkg.core], ...pkg.modules.map(module => [module.moduleId, module] as const)])
  const artifactIds = new Set<string>()
  for (const artifact of pkg.dependencies.moduleArtifacts) {
    if (typeof artifact !== 'object' || artifact === null || Array.isArray(artifact)) throw new Error('Invalid module artifact reference')
    const row = artifact as Partial<WorkbenchCompositionModuleArtifactV1>
    if (typeof row.moduleId !== 'string' || !identities.has(row.moduleId)) throw new Error(`Unknown module artifact: ${String(row.moduleId)}`)
    if (artifactIds.has(row.moduleId)) throw new Error(`Duplicate module artifact: ${row.moduleId}`)
    artifactIds.add(row.moduleId)
    const identity = identities.get(row.moduleId)!
    if (typeof row.packageName !== 'string' || !PACKAGE_NAME.test(row.packageName)) throw new Error(`Invalid module artifact packageName: ${row.moduleId}`)
    if (row.version !== identity.version || row.artifactDigest?.toLowerCase() !== identity.artifactDigest.toLowerCase()) throw new Error(`Module artifact identity mismatch: ${row.moduleId}`)
    if (typeof row.integrity !== 'string' || !INTEGRITY.test(row.integrity)) throw new Error(`Invalid module artifact integrity: ${row.moduleId}`)
    if (typeof row.tarball !== 'string' || !safeRelative(row.tarball)) throw new Error(`Invalid module artifact path: ${row.moduleId}`)
    if (!Number.isSafeInteger(row.size) || (row.size ?? 0) <= 0) throw new Error(`Invalid module artifact size: ${row.moduleId}`)
  }
  if (pkg.recipientBindings?.credentials !== 'never-exported') throw new Error('Credentials cannot be exported')
  if (pkg.recipientBindings?.session !== 'recipient-local') throw new Error('Session bindings must be recipient-local')
  if (pkg.recipientBindings?.workspace !== 'needs-recipient-binding') throw new Error('Workspace binding must be recipient-bound')
}
