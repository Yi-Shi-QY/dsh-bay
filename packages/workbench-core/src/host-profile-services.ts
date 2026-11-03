/**
 * Profile-owned V1 installer services.
 *
 * These services live exclusively in Core's Node entry. They use a fixed,
 * content-addressed local tarball and DSH's native Plugin Manager; no Registry,
 * URL, or package selector reaches this implementation.
 */
import { createHash, randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { WORKBENCH_CORE_VERSION, WORKBENCH_DSH_GENERATION, WORKBENCH_UPSTREAM_COMMIT } from './release-compatibility.ts'
import { inspectWorkbenchHostInstallCapabilities } from './host-install-capabilities.ts'
import { createWorkbenchHostSignedCatalogInstallService, type WorkbenchHostCatalogArtifactStagerV1 } from './host-module-install-route.ts'
import { createWorkbenchModuleInstallCoordinator, type WorkbenchModuleInstallAdapterV1, type WorkbenchModuleVerificationInputV1 } from './install-coordinator.ts'
import { createWorkbenchStorageModuleReceiptStore, type WorkbenchModuleReceiptStoreV1 } from './module-receipt.ts'
import { createWorkbenchStorageTransactionJournal, type WorkbenchInstallTransactionJournalV1 } from './transaction-journal.ts'
import { createWorkbenchProfileCatalogStore } from './host-catalog-store.ts'
import type { WorkbenchHostModuleCenterV1 } from './host-module-center-route.ts'
import type SettingsProvider from '@deepseek-ai/dsh-settings'
import { createWorkbenchOfflineSettings } from './host-offline-settings.ts'
import { createWorkbenchOfflineImportStore } from './host-offline-import-store.ts'
import { createWorkbenchHostOfflineImporter } from './host-offline-import.ts'
import { readWorkbenchArtifactFiles, verifyNativeResolvedArtifactFiles } from './host-artifact-files.ts'
import { createWorkbenchHostDirectSourceInstallService, type WorkbenchDirectSourceResolverV1 } from './host-direct-source-service.ts'
import { createWorkbenchDshNativePluginManagerAdapterV1, type DshNativePluginManagerV1, type WorkbenchDshNativePluginManagerAdapterV1 } from './dsh-native-plugin-manager.ts'

const MODULE_ID = 'workbench.conversation-suite' as const
const PACKAGE_NAME = '@dsh-workbench/conversation-suite' as const
const MAX_TARBALL = 64 * 1024 * 1024
const SHA256 = /^[a-f0-9]{64}$/iu
const INTEGRITY = /^sha512-[A-Za-z0-9+/]+={0,2}$/u

function nativePluginManagerFrom(ctx: { get<T = unknown>(name: string): T | undefined }): DshNativePluginManagerV1 | undefined {
  try {
    let candidate: unknown
    try { candidate = ctx.get<unknown>('workbenchDshNativePluginManager') } catch { candidate = undefined }
    if (candidate === undefined) try { candidate = ctx.get<unknown>('pluginManager') } catch { candidate = undefined }
    if (typeof candidate !== 'object' || candidate === null) return undefined
    const required = ['listPlugins', 'listBundles', 'inspect', 'installBundle', 'cancelInstall', 'setPluginEnabled', 'setBundleEnabled', 'removeBundle'] as const
    if (!required.every(key => typeof Reflect.get(candidate, key) === 'function')) return undefined
    return candidate as DshNativePluginManagerV1
  } catch { return undefined }
}

export interface WorkbenchCoreHostProfileContextV1 {
  readonly baseUrl?: string
  get<T = unknown>(name: string): T | undefined
  provide(name: string, value: unknown): unknown
}

interface ArtifactRecord {
  readonly moduleId: typeof MODULE_ID
  readonly version: string
  readonly artifactDigest: string
  readonly packageName: typeof PACKAGE_NAME
  readonly integrity: string
  readonly size: number
  readonly file: string
}

interface PackageManifest {
  readonly name?: unknown
  readonly version?: unknown
  readonly dsh?: {
    readonly workbench?: {
      readonly moduleId?: unknown
      readonly schemaVersion?: unknown
      readonly dshGeneration?: unknown
      readonly coreCompatibility?: unknown
      readonly editorIds?: unknown
      readonly scope?: unknown
      readonly permissions?: unknown
      readonly requiredCapabilities?: unknown
      readonly provenance?: Record<string, unknown>
    }
    readonly profile?: { readonly bundles?: unknown }
  }
}

function profileRoot(ctx: WorkbenchCoreHostProfileContextV1): string | undefined {
  const native = ctx.get<{ dir: string }>('profileContext')
  if (native?.dir) return resolve(native.dir)
  if (typeof ctx.baseUrl !== 'string' || ctx.baseUrl.trim() === '') return undefined
  try {
    const url = new URL(ctx.baseUrl)
    if (url.protocol !== 'file:') return undefined
    const root = resolve(fileURLToPath(url))
    return existsSync(join(root, 'package.json')) ? root : undefined
  } catch { return undefined }
}

class AtomicProfileJsonV1 {
  constructor(private readonly path: string) { mkdirSync(dirname(path), { recursive: true }) }

  getItem(_key: string): string | null {
    try { return readFileSync(this.path, 'utf8') } catch { return null }
  }

  setItem(_key: string, value: string): void {
    const temporary = `${this.path}.${process.pid}.${randomBytes(8).toString('hex')}.tmp`
    writeFileSync(temporary, value, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
    renameSync(temporary, this.path)
  }

  removeItem(_key: string): void { try { unlinkSync(this.path) } catch { /* an absent state is already empty */ } }
}

function equalStrings(actual: unknown, expected: readonly string[]): boolean {
  return Array.isArray(actual) && actual.length === expected.length
    && actual.every(value => typeof value === 'string' && expected.includes(value))
}

/** A content-addressed Profile tarball store that rechecks bytes on every read. */
export function createWorkbenchCoreProfileArtifactStager(profile: string): WorkbenchHostCatalogArtifactStagerV1 & { artifact(identity: { readonly moduleId: string; readonly version: string; readonly artifactDigest: string }): Uint8Array | undefined } {
  const root = join(resolve(profile), '.dsh-workbench', 'module-artifacts-v1')
  const blobs = join(root, 'blobs')
  const referenceFile = join(root, 'references.json')
  mkdirSync(blobs, { recursive: true })
  const readRecords = (): ArtifactRecord[] => {
    try {
      const value = JSON.parse(readFileSync(referenceFile, 'utf8')) as unknown
      if (!Array.isArray(value)) return []
      return value.filter((row): row is ArtifactRecord => typeof row === 'object' && row !== null
        && (row as ArtifactRecord).moduleId === MODULE_ID && typeof (row as ArtifactRecord).version === 'string'
        && typeof (row as ArtifactRecord).artifactDigest === 'string' && typeof (row as ArtifactRecord).integrity === 'string'
        && (row as ArtifactRecord).packageName === PACKAGE_NAME && typeof (row as ArtifactRecord).size === 'number'
        && typeof (row as ArtifactRecord).file === 'string')
    } catch { return [] }
  }
  const writeRecords = (rows: readonly ArtifactRecord[]): void => {
    const temporary = `${referenceFile}.${process.pid}.${randomBytes(8).toString('hex')}.tmp`
    writeFileSync(temporary, `${JSON.stringify(rows)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
    renameSync(temporary, referenceFile)
  }
  const validate = (record: Pick<ArtifactRecord, 'artifactDigest' | 'integrity' | 'size'>, bytes: Uint8Array): void => {
    if (!SHA256.test(record.artifactDigest) || !INTEGRITY.test(record.integrity) || bytes.byteLength !== record.size || bytes.byteLength === 0 || bytes.byteLength > MAX_TARBALL) throw new Error('Workbench Module artifact identity is invalid')
    if (createHash('sha256').update(bytes).digest('hex') !== record.artifactDigest.toLowerCase()) throw new Error('Workbench Module artifact digest mismatch')
    if (`sha512-${createHash('sha512').update(bytes).digest('base64')}` !== record.integrity) throw new Error('Workbench Module artifact integrity mismatch')
  }
  return {
    async stage(input) {
      if (input.moduleId !== MODULE_ID || input.packageName !== PACKAGE_NAME) throw new Error('Unsupported Workbench Module artifact')
      const record: ArtifactRecord = {
        moduleId: MODULE_ID, packageName: PACKAGE_NAME, version: input.version,
        artifactDigest: input.artifactDigest.toLowerCase(), integrity: input.integrity,
        size: input.tarball.byteLength, file: `${input.artifactDigest.toLowerCase()}.tgz`,
      }
      validate(record, input.tarball)
      const previous = readRecords().find(row => row.moduleId === MODULE_ID)
      if (previous !== undefined && (previous.version !== record.version || previous.artifactDigest !== record.artifactDigest)) throw new Error('Workbench Module artifact identity conflict')
      const destination = join(blobs, record.file)
      let valid = false
      try { validate(record, new Uint8Array(readFileSync(destination))); valid = true } catch { /* Restore only the exact newly verified bytes. */ }
      if (!valid) {
        const temporary = `${destination}.${randomBytes(8).toString('hex')}.tmp`
        writeFileSync(temporary, input.tarball, { flag: 'wx', mode: 0o600 })
        renameSync(temporary, destination)
      }
      writeRecords([record])
      return undefined
    },
    artifact(identity) {
      const record = readRecords().find(row => row.moduleId === identity.moduleId)
      if (record === undefined || record.version !== identity.version || record.artifactDigest !== identity.artifactDigest.toLowerCase()) return undefined
      try {
        const bytes = new Uint8Array(readFileSync(join(blobs, record.file)))
        validate(record, bytes)
        return bytes
      } catch { return undefined }
    },
  }
}

interface NativePackageResolver {
  packageOf(specifier: string, parentURL: string): { name: string; version?: string | undefined; dir: string; manifestPath: string } | undefined
}

function locateInstalledPackage(ctx: WorkbenchCoreHostProfileContextV1, packageName: string): string {
  const pkg = ctx.get<NativePackageResolver>('pluginPackages')?.packageOf(packageName, import.meta.url)
  if (pkg?.name !== packageName) throw new Error('native-package-unresolved')
  return pkg.dir
}

async function verifyInstalled(ctx: WorkbenchCoreHostProfileContextV1, input: WorkbenchModuleVerificationInputV1, artifacts: ReturnType<typeof createWorkbenchCoreProfileArtifactStager>, trustedBytes?: Uint8Array): Promise<void> {
  if (!('packageName' in input) || input.moduleId !== MODULE_ID || input.packageName !== PACKAGE_NAME) throw new Error('Workbench Module verification lacks signed Catalog facts')
  if (input.dshGeneration !== WORKBENCH_DSH_GENERATION || input.provenance.upstreamCommit !== WORKBENCH_UPSTREAM_COMMIT) throw new Error('module-incompatible')
  const packageRoot = locateInstalledPackage(ctx, PACKAGE_NAME)
  const bytes = trustedBytes ?? artifacts.artifact(input)
  if (bytes === undefined || createHash('sha256').update(bytes).digest('hex') !== input.artifactDigest || `sha512-${createHash('sha512').update(bytes).digest('base64')}` !== input.integrity) throw new Error('Installed Workbench Module lacks its trusted artifact')
  await verifyNativeResolvedArtifactFiles(packageRoot, await readWorkbenchArtifactFiles(bytes))
  const manifest = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8')) as PackageManifest
  const declared = manifest.dsh?.workbench
  if (manifest.name !== PACKAGE_NAME || manifest.version !== input.version || declared?.schemaVersion !== 1 || declared.moduleId !== MODULE_ID
    || declared.dshGeneration !== WORKBENCH_DSH_GENERATION
    || declared.coreCompatibility !== input.coreCompatibility || !equalStrings(declared.editorIds, input.editorIds)
    || declared.scope !== input.scope || !equalStrings(declared.permissions, input.permissions)
    || !equalStrings(declared.requiredCapabilities, input.requiredCapabilities)) {
    throw new Error('Installed Workbench Module static manifest does not match signed Catalog facts')
  }
  const provenance = declared.provenance
  if (provenance?.upstreamCommit !== input.provenance.upstreamCommit
    || provenance?.sourceDigest !== input.provenance.sourceDigest
    || provenance?.patchDigest !== input.provenance.patchDigest) {
    throw new Error('Installed Workbench Module static provenance does not match signed Catalog')
  }
}

/** Install Core's Profile services when the locked DSH Host exposes them. */
export function installWorkbenchCoreProfileServices(ctx: WorkbenchCoreHostProfileContextV1): boolean {
  if (ctx.get('workbenchHostSignedCatalogInstaller') !== undefined) return true
  const profile = profileRoot(ctx)
  const native = nativePluginManagerFrom(ctx)
  if (profile === undefined) return false
  if (native === undefined) return false // Alpha2 never falls back to a second Profile writer.
  const state = join(profile, '.dsh-workbench', 'module-state-v1')
  mkdirSync(state, { recursive: true })
  const receipts: WorkbenchModuleReceiptStoreV1 = createWorkbenchStorageModuleReceiptStore(new AtomicProfileJsonV1(join(state, 'receipts.json')))
  const journal: WorkbenchInstallTransactionJournalV1 = createWorkbenchStorageTransactionJournal(new AtomicProfileJsonV1(join(state, 'journal.json')))
  const artifacts = createWorkbenchCoreProfileArtifactStager(profile)
  const capabilities = () => inspectWorkbenchHostInstallCapabilities(ctx)
  const verifiedThisStart = new Set<string>()
  const introducedPath = join(state, 'introduced.json')
  const introduced = {
    has(moduleId: string): boolean {
      try {
        const value = JSON.parse(readFileSync(introducedPath, 'utf8')) as unknown
        return Array.isArray(value) && value.includes(moduleId)
      } catch { return false }
    },
    add(moduleId: string): void {
      let values: string[] = []
      try { const value = JSON.parse(readFileSync(introducedPath, 'utf8')) as unknown; if (Array.isArray(value)) values = value.filter((item): item is string => typeof item === 'string') } catch { /* start empty */ }
      if (!values.includes(moduleId)) values.push(moduleId)
      mkdirSync(dirname(introducedPath), { recursive: true })
      const temporary = `${introducedPath}.${process.pid}.${randomBytes(8).toString('hex')}.tmp`
      writeFileSync(temporary, `${JSON.stringify(values)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
      renameSync(temporary, introducedPath)
    },
    remove(moduleId: string): void {
      let values: string[] = []
      try { const value = JSON.parse(readFileSync(introducedPath, 'utf8')) as unknown; if (Array.isArray(value)) values = value.filter((item): item is string => typeof item === 'string' && item !== moduleId) } catch { return }
      mkdirSync(dirname(introducedPath), { recursive: true })
      const temporary = `${introducedPath}.${process.pid}.${randomBytes(8).toString('hex')}.tmp`
      writeFileSync(temporary, `${JSON.stringify(values)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
      renameSync(temporary, introducedPath)
    },
  }
  const nativeAdapter = createWorkbenchDshNativePluginManagerAdapterV1({
      profile, packageName: PACKAGE_NAME, moduleId: MODULE_ID, native, capabilities,
      artifactPath: identity => join(profile, '.dsh-workbench', 'module-artifacts-v1', 'blobs', `${identity.artifactDigest.toLowerCase()}.tgz`),
      repairArtifactPath: identity => {
        const bytes = artifacts.artifact(identity)
        if (!bytes) throw new Error('artifact-integrity-mismatch')
        const directory = join(profile, '.dsh-workbench', 'module-artifacts-v1', 'repair', randomBytes(16).toString('hex'))
        mkdirSync(directory, { recursive: true })
        const target = join(directory, `${identity.artifactDigest.toLowerCase()}.tgz`)
        writeFileSync(target, bytes, { flag: 'wx', mode: 0o600 })
        return target
      },
      isArtifactAvailable: identity => artifacts.artifact(identity) !== undefined,
      inspectArtifact: async identity => {
        const bytes = artifacts.artifact(identity)
        if (!bytes) throw new Error('artifact-integrity-mismatch')
        const files = await readWorkbenchArtifactFiles(bytes)
        const pkg = JSON.parse(files.get('package.json')!.toString('utf8'))
        const declaration = pkg.dsh?.workbench
        if (pkg.name !== PACKAGE_NAME || pkg.version !== identity.version || declaration?.moduleId !== identity.moduleId
          || declaration?.dshGeneration !== WORKBENCH_DSH_GENERATION || declaration?.coreCompatibility !== WORKBENCH_CORE_VERSION
          || !files.has('dsh.bundle.patch.yml')) throw new Error('package-manifest-invalid')
      },
      verify: input => verifyInstalled(ctx, input, artifacts),
      ownedIdentity: moduleId => { const receipt = receipts.get(moduleId); return receipt === undefined ? undefined : { version: receipt.version, artifactDigest: receipt.artifactDigest } },
      onBeforeMutation: moduleId => { verifiedThisStart.delete(moduleId) },
      ownership: introduced,
    })
  const adapter = nativeAdapter
  const refreshNative = async (): Promise<void> => { await nativeAdapter?.refresh() }
  const nativePackagePresent = (): boolean => nativeAdapter?.inventory().bundles.some(bundle => bundle.name === PACKAGE_NAME && bundle.installed) ?? false
  const packagePresent = (): boolean => nativePackagePresent()
  const packageVersion = (): string | undefined => {
    const nativeVersion = nativeAdapter?.inventory().bundles.find(bundle => bundle.name === PACKAGE_NAME && bundle.installed)?.version
    if (nativeVersion !== undefined) return nativeVersion
    return undefined
  }

  const coordinator = createWorkbenchModuleInstallCoordinator(adapter, { receipts, journal })
  // Expose only a capability label and the sanitized adapter projection to
  // other Host routes. The native manager object itself never crosses into the
  // browser renderer.
  ctx.provide('workbenchProfilePackageManager', 'dsh-native-plugin-manager')
  if (nativeAdapter !== undefined) ctx.provide('workbenchDshNativePluginManagerAdapter', nativeAdapter)
  const catalogImport = { verifiedSeams: ['workbench.conversation.areas', 'client.ui-layout', 'client.ui-settings'], allowedPermissions: ['dsh.conversation.render'] }
  const catalogs = createWorkbenchProfileCatalogStore(profile, catalogImport)
  let catalogStatus: 'missing' | 'available' | 'invalid' = 'missing'
  let revoked = false
  const loadCatalog = async () => {
    try {
      const stored = await catalogs.read()
      catalogStatus = stored === undefined ? 'missing' : 'available'
      revoked = stored?.imported.entries.some(entry => entry.signedCatalog?.revoked) ?? false
      return stored
    } catch { catalogStatus = 'invalid'; revoked = true; return undefined }
  }
  const retainCatalog = async (bytes: Uint8Array) => { await catalogs.retain(bytes); await loadCatalog() }
  const service = createWorkbenchHostSignedCatalogInstallService({
    catalogImport, capabilities, receipts, journal, artifactStager: artifacts, coordinator, retainCatalog,
    profileVersion: packageVersion,
    verifyReusable: async module => {
      await adapter.verify(module)
      if (!verifiedThisStart.has(module.moduleId)) throw new Error('Workbench Module is not verified on this start')
    },
    verifyProfile: async module => { await adapter.verify(module) },
  })
  // A Manager may optionally supply an npm/Git resolver. Core still owns the
  // transaction, Profile snapshot and post-restart verification; without this
  // explicit Host seam the advanced source channel stays unavailable.
  const directResolver = ctx.get<WorkbenchDirectSourceResolverV1>('workbenchDirectSourceResolver')
  let changing = false
  let restarting = false
  const exclusive = async <T>(run: () => Promise<T>): Promise<T> => {
    if (changing || restarting) throw new Error('Workbench Profile transaction is busy')
    changing = true
    try { return await run() } finally { changing = false }
  }
  let offline: ReturnType<typeof createWorkbenchHostOfflineImporter> | undefined
  ctx.provide('workbenchHostSignedCatalogInstaller', { commit: (input: Parameters<typeof service.commit>[0]) => exclusive(async () => {
    await ready
    await refreshNative()
    if (offline?.pending()) throw new Error('Workbench offline import requires completion or recovery')
    return service.commit(input)
  }) })
  if (directResolver !== undefined && ctx.get('workbenchHostDirectSourceInstaller') === undefined) {
    const directService = createWorkbenchHostDirectSourceInstallService({
      resolver: directResolver, coordinator, receipts, journal, artifactStager: artifacts,
      capabilities, allowedPermissions: ['dsh.conversation.render'],
      profilePresent: packagePresent,
      verifyProfile: module => adapter.verify(module),
    })
    ctx.provide('workbenchHostDirectSourceInstaller', { commit: (input: Parameters<typeof directService.commit>[0]) => exclusive(async () => {
      await ready
      await refreshNative()
      if (offline?.pending() || coordinator.recoverableTransactions().length > 0) throw new Error('transaction-recovery-required')
      return directService.commit(input)
    }) })
  }
  ctx.provide('workbenchModuleReceiptStore', receipts)
  ctx.provide('workbenchModuleTransactionJournal', journal)
  ctx.provide('workbenchVerifiedModuleIdentity', Object.freeze({
    get(moduleId: typeof MODULE_ID) {
      const receipt = receipts.get(moduleId)
      if (revoked || !verifiedThisStart.has(moduleId) || receipt?.state !== 'active' || receipt.verification === undefined) return undefined
      return { moduleId: receipt.moduleId, version: receipt.version, artifactDigest: receipt.artifactDigest }
    },
  }))
  const activeAtStart = receipts.list().filter(receipt => receipt.state === 'active')
  const ready = (async () => {
    await refreshNative()
    await loadCatalog()
    if (revoked) return
    for (const transaction of coordinator.recoverableTransactions()) {
      try {
        // Installing during recovery requires another process restart.
        if (transaction.state === 'staged') {
          await coordinator.install(transaction.transactionId)
          continue
        }
        if (transaction.state === 'rolling-back') {
          await coordinator.rollback(transaction.transactionId)
          continue
        }
        await coordinator.verifyAfterRestart(transaction.transactionId)
        verifiedThisStart.add(MODULE_ID)
      } catch { /* The coordinator records failure and rollback; the Suite stays inert. */ }
    }
    for (const receipt of activeAtStart) {
      if (receipt.verification === undefined) continue
      try {
        await adapter.verify(receipt.verification)
        await adapter.activate(receipt.moduleId)
        verifiedThisStart.add(receipt.moduleId)
      } catch { /* An old receipt never authorizes an invalid package on a later start. */ }
    }
  })()
  const restartVerifier = ctx.get<{
    register(verifier: {
      prepare(transactionId: string, request: () => Promise<{ operationId: string }>): Promise<{ operationId: string }>
      read(transactionId: string): Promise<'restart-required' | 'active' | 'failed' | 'missing'>
      release(): void
    }): void
  }>('workbenchManagerRestartVerifier')
  restartVerifier?.register({
    async prepare(transactionId, request) {
      await ready
      if (changing || restarting) throw new Error('restart-busy')
      const transaction = coordinator.getTransaction(transactionId) ?? journal.get(transactionId)?.snapshot
      if (transaction?.state !== 'restart-required') throw new Error('transaction-missing')
      restarting = true
      try { return await request() }
      catch (error) { restarting = false; throw error }
    },
    async read(transactionId) {
      await ready
      const transaction = coordinator.getTransaction(transactionId) ?? journal.get(transactionId)?.snapshot
      if (transaction === undefined) return 'missing'
      if (transaction.state === 'active') {
        if (revoked || !verifiedThisStart.has(MODULE_ID)) return 'failed'
        const verification = receipts.get(MODULE_ID)?.verification
        if (verification === undefined) return 'failed'
        try { await adapter.verify(verification); return 'active' } catch { return 'failed' }
      }
      if (transaction.state === 'failed' || transaction.state === 'rolled-back') return 'failed'
      return 'restart-required'
    },
    release() { restarting = false },
  })
  // Register readiness before the Client can request a projected identity.
  // Failed recovery is represented by a null identity, never a boot failure.
  ctx.provide('workbenchModuleStartupReady', ready)
  const center: WorkbenchHostModuleCenterV1 = {
    async facts() {
      await ready
      await refreshNative()
      await loadCatalog()
      const receipt = receipts.get(MODULE_ID)
      if (receipt?.state === 'active' && receipt.verification !== undefined && verifiedThisStart.has(MODULE_ID)) {
        try {
          await adapter.verify(receipt.verification)
          await adapter.activate(receipt.moduleId)
        } catch { verifiedThisStart.delete(MODULE_ID) }
      }
      const installed = receipt !== undefined && ['installed', 'restart-required', 'active'].includes(receipt.state)
        ? { moduleId: receipt.moduleId, version: receipt.version, artifactDigest: receipt.artifactDigest } : undefined
      let profileConflict: 'unowned-module' | undefined
      try {
        const introduced = JSON.parse(readFileSync(join(state, 'introduced.json'), 'utf8')) as unknown
        const owned = Array.isArray(introduced) && introduced.includes(MODULE_ID)
        if (!owned && packagePresent()) profileConflict = 'unowned-module'
      } catch {
        if (packagePresent()) profileConflict = 'unowned-module'
      }
      const pendingRestart = coordinator.recoverableTransactions().find(row => row.state === 'restart-required')
      const currentCatalog = await loadCatalog()
      const catalogIdentity = currentCatalog?.imported.entries.find(entry => entry.moduleId === MODULE_ID)
      const packagePresentInProfile = packagePresent()
      const profileVersion = packageVersion()
      const nativeBundle = nativeAdapter.inventory().bundles.find(row => row.name === PACKAGE_NAME && row.installed)
      let exactProfileIdentity = false
      if (packagePresentInProfile && catalogIdentity?.signedCatalog !== undefined && profileVersion === catalogIdentity.version) {
        try {
          const signed = catalogIdentity.signedCatalog
          await verifyInstalled(ctx, {
            moduleId: catalogIdentity.moduleId, version: catalogIdentity.version, artifactDigest: catalogIdentity.artifactDigest,
            packageName: signed.packageName, coreCompatibility: catalogIdentity.coreCompatibility, sourceLocator: catalogIdentity.source.locator,
            integrity: signed.integrity, catalogId: signed.catalogId, publisherKeyId: signed.publisherKeyId, dshGeneration: signed.dshGeneration,
            requiredCapabilities: [...catalogIdentity.requires.capabilities], permissions: [...signed.permissions], provenance: { ...signed.provenance },
            editorIds: [...(catalogIdentity.manifest?.provides.editorIds ?? [])], scope: catalogIdentity.manifest?.activation.scope ?? 'area',
          }, artifacts, currentCatalog?.imported.artifact(catalogIdentity))
          exactProfileIdentity = true
        } catch { exactProfileIdentity = false }
      }
      const receiptState = receipt?.state
      const ownership: 'unowned' | 'owned' | 'ownership-invalid' | 'rolled-back' = receiptState === 'rolled-back'
        ? 'rolled-back' : receipt === undefined ? 'unowned' : receiptState === 'active' || receiptState === 'restart-required' || receiptState === 'installed' ? 'owned' : 'ownership-invalid'
      const externalIdentityConflict = packagePresentInProfile && catalogIdentity !== undefined && ownership !== 'owned' && !exactProfileIdentity
      const activation: 'absent' | 'restart-required' | 'verifying' | 'active' | 'failed' = receiptState === 'active'
        ? (verifiedThisStart.has(MODULE_ID) ? 'active' : 'failed') : receiptState === 'restart-required' ? 'restart-required' : 'absent'
      const nativeRuntime = nativeBundle === undefined ? 'unknown' as const
        : activation === 'restart-required' ? 'restart-required' as const
          : nativeBundle.enabled ? 'enabled' as const : 'disabled' as const
      const nativeDisabled = nativeRuntime === 'disabled'
      // Conversation is bundled in Core in Workbench 0.2.0. This legacy
      // Suite projection remains read-only for existing Profiles; a missing
      // legacy package is never an invitation to install it again.
      const inventory = [{
        moduleId: MODULE_ID, packageName: PACKAGE_NAME, kind: 'official-builtin' as const, delivery: 'official-component' as const, nativeRuntime,
        ...(receipt?.source === undefined ? {} : { source: receipt.source }),
        trust: revoked ? 'revoked' as const : receipt?.trust ?? 'user-approved-unverified' as const,
        profilePresence: packagePresentInProfile ? 'present' as const : 'absent' as const,
        ...(packagePresentInProfile ? { profileIdentity: { version: profileVersion ?? 'unknown', ...(exactProfileIdentity && catalogIdentity === undefined ? {} : exactProfileIdentity && catalogIdentity !== undefined ? { artifactDigest: catalogIdentity.artifactDigest } : {}) } } : {}),
        ...(catalogIdentity?.signedCatalog === undefined ? {} : { catalogIdentity: { version: catalogIdentity.version, artifactDigest: catalogIdentity.artifactDigest, catalogId: catalogIdentity.signedCatalog.catalogId } }),
        ownership, activation,
        entryVisibility: activation === 'active' ? 'enabled' as const : 'unavailable' as const,
         allowedActions: nativeDisabled ? ['open-details'] as const : activation === 'restart-required' ? ['restart', 'open-details'] as const : externalIdentityConflict ? ['external-uninstall-required', 'open-details'] as const : ['open-details'] as const,
        ...(externalIdentityConflict ? { diagnosticCode: 'profile-identity-conflict' } : profileConflict === undefined ? {} : { diagnosticCode: 'profile-unowned-module' }),
      }]
      return { schemaVersion: 1, catalog: catalogStatus,
        ...(installed === undefined ? {} : { installed }),
        ...(pendingRestart === undefined ? {} : { restartTransactionId: pendingRestart.transactionId }),
        ...(profileConflict === undefined ? {} : { profileConflict }),
        inventory,
        directSourceAvailable: ctx.get('workbenchHostDirectSourceInstaller') !== undefined,
        activation: installed === undefined ? 'absent'
          : revoked ? 'unverified'
          : receipt?.state === 'active' ? (verifiedThisStart.has(MODULE_ID) ? 'active' : 'unverified') : 'restart-required' }
    },
    async archive() { await ready; return (await loadCatalog())?.bytes },
    async retain(bytes) {
      await exclusive(async () => {
        await ready
        if (offline?.pending() || coordinator.recoverableTransactions().length > 0) throw new Error('Workbench Module transaction requires restart or recovery')
        await retainCatalog(bytes)
      })
    },
  }
  ctx.provide('workbenchHostModuleCenter', center)
  const settings = ctx.get<SettingsProvider>('settings')
  if (settings !== undefined && typeof settings.mutate === 'function') {
    offline = createWorkbenchHostOfflineImporter({
      store: createWorkbenchOfflineImportStore(profile), catalogOptions: catalogImport, facts: () => center.facts(), exclusive,
      settings: createWorkbenchOfflineSettings(settings),
      verify: async module => {
        const receipt = receipts.get(module.moduleId)
        if (receipt?.state !== 'active' || receipt.verification === undefined || receipt.version !== module.version || receipt.artifactDigest !== module.artifactDigest
          || !verifiedThisStart.has(module.moduleId) || revoked) throw new Error('Workbench Module is not verified on this start')
        await adapter.verify(receipt.verification)
      },
      install: (bytes, onStaged) => service.commit({ moduleId: MODULE_ID, archive: bytes }, onStaged),
      rollback: transactionId => coordinator.rollback(transactionId),
      installation: transactionId => coordinator.getTransaction(transactionId),
    })
    ctx.provide('workbenchOfflineImporter', offline)
    const offlineReady = ready.then(() => offline!.recover())
    ctx.provide('workbenchOfflineStartupReady', offlineReady)
    void offlineReady.catch(() => undefined)
  }
  void ready.catch(() => undefined)
  return true
}
