import { createHash } from 'node:crypto'
import { readFile, mkdir, writeFile, copyFile } from 'node:fs/promises'
import path from 'node:path'
import type { WorkbenchRecordV2 } from './foundation/persistence.ts'
import { areasOf } from './foundation/document-v3.ts'
import { CORE_PORTABLE_EDITORS } from './distribution-contract.ts'
import { createDistributionInstaller } from './host-distribution-installer.ts'
import { inspectDistributionManifest, inspectDistributionArtifact, prepareDistributionArtifact } from './host-distribution-artifacts.ts'
import type { HostDistributionOptions } from './host-distribution-service.ts'
import type { CompleteExtensionCheck, CompleteExtensionLock, CompletePlatform } from './workbench-complete-contract.ts'
import { CompleteMigrationRegistry } from './host-complete-migrations.ts'
import { atomicJson } from './host-workbench-directory.ts'
import { hashFile } from './host-workbench-complete-files.ts'
import { resolvePortablePath } from './host-native-session-portability.ts'
import { workbenchExtensionContractFingerprint, type WorkbenchExtensionConsentV1 } from './workbench-extension-access.ts'
import { orderedDistributionDependencies, sameDistributionArtifact } from './foundation/workbench-package-v4.ts'

export const WORKBENCH_COMPLETE_EXTENSIONS = 'workbenchCompleteExtensions'
const coreEditors = new Set<string>([...CORE_PORTABLE_EDITORS, 'workbench.project-overview'])
export const completeExternalEditors = (record: WorkbenchRecordV2): string[] => [...new Set(areasOf(record.document.root).flatMap(area => area.moduleHistory.map(page => page.editorId)).filter(id => !coreEditors.has(id)))]
export interface CompleteExtensions {
  collect(record: WorkbenchRecordV2, directory: string, platform: CompletePlatform, requiredPackages?: readonly string[]): Promise<CompleteExtensionLock[]>
  check(extensions: CompleteExtensionLock[], platform: CompletePlatform, packageDirectory?: string): Promise<CompleteExtensionCheck[]>
  install(extensions: CompleteExtensionLock[], directory: string, jobId: string, signal?: AbortSignal): Promise<{ restartRequired: boolean; transactionId?: string; consents?: Record<string, WorkbenchExtensionConsentV1> }>
}

/** Reuses the DSH distribution installer; the complete archive is never buffered. */
export function createCompleteExtensions(options: HostDistributionOptions, migrations: CompleteMigrationRegistry): CompleteExtensions {
  const installer = createDistributionInstaller(options)
  const platformDeclaration = (manifest: unknown): CompletePlatform[] => {
    const declared = (manifest as { dsh?: { workbench?: { platforms?: unknown } } }).dsh?.workbench?.platforms
    if (!Array.isArray(declared) || declared.some(value => !['win32', 'darwin', 'linux'].includes(value)) || !declared.length) throw new Error('扩展需要声明支持的系统 dsh.workbench.platforms。')
    return declared as CompletePlatform[]
  }
  const check: CompleteExtensions['check'] = async (extensions, platform, packageDirectory) => {
    const result: CompleteExtensionCheck[] = []
    for (const extension of extensions) {
      try {
        if (!extension.platforms.includes(platform)) throw new Error('扩展不支持接收系统：' + extension.packageName)
        if (!extension.distribution) { result.push({ extension, state: 'manual', message: '请先手动安装并映射精确版本与制品。' }); continue }
        if (extension.artifactPath) {
          if (!packageDirectory) throw new Error('缺少待检查的工作台包目录。')
          const bytes = new Uint8Array(await readFile(resolvePortablePath(packageDirectory, extension.artifactPath)))
          const embedded = await inspectDistributionArtifact(bytes, options.peerAvailable, { allowForbiddenIdentity: true })
          if (!sameDistributionArtifact(embedded.dependency, extension.distribution)) throw new Error('包内扩展制品与权限清单不一致：' + extension.packageName)
          const manifest = JSON.parse(embedded.files.get('package.json')!.toString('utf8'))
          const declaredPlatforms = platformDeclaration(manifest)
          if (JSON.stringify([...declaredPlatforms].sort()) !== JSON.stringify([...extension.platforms].sort()) || !declaredPlatforms.includes(platform)) throw new Error('扩展系统兼容声明与 V6 锁不一致：' + extension.packageName)
        }
        const present = await installer.check(extension.distribution)
        if (!present.present) { result.push({ extension, state: extension.artifactPath ? 'install' : 'manual', message: extension.artifactPath ? '使用包内离线制品安装' : '此扩展需要在接收方先行安装' }); continue }
        const bundle = (await options.native.listBundles()).find(row => row.name === extension.packageName && row.installed)
        const source = bundle?.source?.replace(/^file:/u, '')
        const installed = source?.endsWith('.tgz')
          ? await inspectDistributionArtifact(new Uint8Array(await readFile(path.resolve(options.profile.dir, source))), options.peerAvailable, { allowForbiddenIdentity: true })
          : await (async () => {
            const prepared = await prepareDistributionArtifact(options.resolve(extension.packageName) ?? path.join(options.profile.dir, 'node_modules', extension.packageName), options.peerAvailable, { allowForbiddenIdentity: true })
            return inspectDistributionArtifact(prepared.bytes, options.peerAvailable, { allowForbiddenIdentity: true })
          })()
        if (!sameDistributionArtifact(installed.dependency, extension.distribution)) throw new Error('已安装扩展制品与工作台锁定身份不完全一致：' + extension.packageName)
        const installedManifest = JSON.parse(installed.files.get('package.json')!.toString('utf8'))
        const installedPlatforms = platformDeclaration(installedManifest)
        if (JSON.stringify([...installedPlatforms].sort()) !== JSON.stringify([...extension.platforms].sort()) || !installedPlatforms.includes(platform)) throw new Error('已安装扩展系统声明与工作台锁不一致：' + extension.packageName)
        if (!present.enabled || !await installer.running(extension.distribution)) { result.push({ extension, state: 'restart', message: '需要启用扩展并重启 DSH' }); continue }
        try { migrations.assertAvailable(extension) }
        catch (error) { result.push({ extension, state: 'migration-missing', message: String(error) }); continue }
        result.push({ extension, state: 'ready' })
      } catch (error) { result.push({ extension, state: 'conflict', message: error instanceof Error ? error.message : String(error) }) }
    }
    return result
  }
  return { check,
    async collect(record, directory, platform, requiredPackages = []) {
      const editors = new Set(completeExternalEditors(record))
      const bundles = await options.native.listBundles()
      const manifests = new Map<string, { root: string; manifest: ReturnType<typeof inspectDistributionManifest> }>()
      for (const bundle of bundles.filter(row => row.installed)) {
        const root = options.resolve(bundle.name)
        if (!root) continue
        const raw = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))
        if (!requiredPackages.includes(bundle.name) && !raw.dsh?.workbench?.editors?.some((row: { editorId: string }) => editors.has(row.editorId))) continue
        manifests.set(bundle.name, { root, manifest: inspectDistributionManifest(raw) })
      }
      for (const editor of editors) if (![...manifests.values()].some(row => row.manifest.dsh.workbench.editors!.some(value => value.editorId === editor))) throw new Error('未找到内页的扩展分发声明：' + editor)
      const queue = [...new Set([...manifests.keys(), ...requiredPackages])], result: CompleteExtensionLock[] = []
      await mkdir(path.join(directory, 'extensions'), { recursive: true })
      for (let i = 0; i < queue.length; i++) {
        const packageName = queue[i]!
        let item = manifests.get(packageName)
        if (!item) {
          const root = options.resolve(packageName)
          if (!root) throw new Error('缺少扩展依赖：' + packageName)
          item = { root, manifest: inspectDistributionManifest(JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))) }
        }
        const declaration = item.manifest.dsh.workbench.distribution!
        for (const name of declaration.requires) if (!queue.includes(name)) queue.push(name)
        const platforms = platformDeclaration(item.manifest)
        if (!platforms.includes(platform)) throw new Error('扩展不支持所选目标系统：' + packageName)
        const bundle = bundles.find(row => row.name === packageName && row.installed)
        const source = bundle?.source?.replace(/^file:/u, '')
        const prepared = source?.endsWith('.tgz')
          ? await (async () => { const bytes = new Uint8Array(await readFile(path.resolve(options.profile.dir, source))); return { bytes, ...await inspectDistributionArtifact(bytes, options.peerAvailable, { allowForbiddenIdentity: true }) } })()
          : await prepareDistributionArtifact(item.root, options.peerAvailable, { allowForbiddenIdentity: true })
        await installer.verified(prepared.dependency)
        const extension: CompleteExtensionLock = { packageName, moduleId: prepared.dependency.moduleId, version: prepared.dependency.version, artifactSha256: prepared.dependency.archiveSha256,
          permissions: prepared.dependency.permissions, editorIds: prepared.dependency.editorScopes.map(row => row.editorId), exportPolicy: declaration.exportPolicy,
          platforms, migrations: { events: [], workbenchData: [] }, distribution: prepared.dependency }
        extension.migrations = migrations.declaration(extension)
        if (extension.exportPolicy === 'embed') {
          extension.artifactPath = 'extensions/' + extension.artifactSha256 + '.tgz'
          await writeFile(path.join(directory, extension.artifactPath), prepared.bytes)
        }
        result.push(extension)
      }
      const order = orderedDistributionDependencies(result.map(row => row.distribution!))
      return order.map(dependency => result.find(row => row.packageName === dependency.packageName)!)
    },
    async install(extensions, directory, jobId, signal) {
      const root = path.join(options.profile.dir, '.dsh-workbench', 'complete-extension-installs', jobId)
      await mkdir(root, { recursive: true })
      const digest = createHash('sha256').update(JSON.stringify(extensions)).digest('hex')
      const journal = path.join(root, 'transaction.json')
      const previous = await readFile(journal, 'utf8').then(value => JSON.parse(value) as { digest: string }).catch(error => { if (error.code === 'ENOENT') return undefined; throw error })
      if (previous && previous.digest !== digest) throw new Error('安装事务扩展清单已改变。')
      // A restart may interrupt any installation. check() reconciles already installed exact artifacts.
      atomicJson(journal, { jobId, digest, state: 'installing' })
      let restartRequired = false
      const consents: Record<string, WorkbenchExtensionConsentV1> = {}
      const ordered = orderedDistributionDependencies(extensions.map(extension => {
        if (!extension.distribution) throw new Error('扩展缺少原生安装身份：' + extension.packageName)
        return extension.distribution
      }))
      for (const dependency of ordered) {
        const extension = extensions.find(row => row.packageName === dependency.packageName)!
        signal?.throwIfAborted()
        const present = await installer.check(dependency)
        if (!present.present) {
          if (!extension.artifactPath) throw new Error('请先手动安装引用扩展：' + extension.packageName)
          const artifact = path.join(root, extension.artifactSha256 + '.tgz')
          await copyFile(path.join(directory, extension.artifactPath), artifact)
          if (await hashFile(artifact) !== extension.artifactSha256) throw new Error('扩展制品摘要不匹配。')
          const inspected = await inspectDistributionArtifact(new Uint8Array(await readFile(artifact)), options.peerAvailable)
          if (!sameDistributionArtifact(inspected.dependency, dependency)) throw new Error('扩展制品声明与清单不一致。')
          await installer.install(dependency, artifact, async () => { atomicJson(journal, { jobId, digest, state: 'installing', packageName: extension.packageName }) }, signal)
          restartRequired = true
        }
        if (!(await installer.check(dependency)).enabled) restartRequired = await installer.enable(dependency, true) || restartRequired
        if (!await installer.running(dependency)) restartRequired = true
        const installedRoot = options.resolve(extension.packageName) ?? path.join(options.profile.dir, 'node_modules', extension.packageName)
        const declared = inspectDistributionManifest(JSON.parse(await readFile(path.join(installedRoot, 'package.json'), 'utf8'))).dsh.workbench
        consents[extension.packageName + '::' + extension.moduleId] = { packageName: extension.packageName, moduleId: extension.moduleId, apiVersion: 1, editorIds: extension.editorIds,
          contractFingerprint: workbenchExtensionContractFingerprint({ schemaVersion: 1, moduleId: declared.moduleId, apiVersion: 1, editorIds: declared.editorIds, coreCompatibility: declared.coreCompatibility, dshGeneration: declared.dshGeneration }, declared.editors!), allowedAt: Date.now(), allowed: true }
      }
      atomicJson(journal, { jobId, digest, state: restartRequired ? 'restart-required' : 'ready' })
      return { restartRequired, consents }
    },
  }
}
