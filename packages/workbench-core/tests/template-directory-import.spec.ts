import { afterEach, expect, it, vi } from 'vitest'
import { generateKeyPairSync, sign } from 'node:crypto'
import { mkdtemp, cp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { HostWorkbenchDirectory } from '../src/host-workbench-directory.ts'
import { HostWorkbenchAccess } from '../src/host-workbench-access.ts'
import { createHostDistributionService, type HostDistributionOptions } from '../src/host-distribution-service.ts'
import { buildWorkbenchPackageV4, publisherKeyIdV4, type WorkbenchPackageModeV4 } from '../src/foundation/workbench-package-v4.ts'
import { projectLayoutPackage, restoreLayoutPackage } from '../src/foundation/workbench-layout-package.ts'
import { createWorkbenchContext } from '../src/foundation/workbench-context.ts'
import type { WorkbenchRecordV2 } from '../src/foundation/persistence.ts'
import { areasOf } from '../src/foundation/document-v3.ts'
import { createDistributionInstaller } from '../src/host-distribution-installer.ts'
import { prepareDistributionArtifact } from '../src/host-distribution-artifacts.ts'
import { workbenchExtensionContractFingerprint } from '../src/workbench-extension-access.ts'

const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })
const record = (): WorkbenchRecordV2 => ({ workbenchId: 'original', name: '研发模板', description: '', createdAt: 1, updatedAt: 1,
  document: { version: 3, activeAreaId: 'area', root: { kind: 'area', areaId: 'area', moduleHistory: [] } } })
async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'bay-template-')); roots.push(root)
  const profile = join(root, 'profile')
  const workspaces = { create: vi.fn(async () => ({ id: crypto.randomUUID() })) }
  const directory = new HostWorkbenchDirectory(profile, workspaces as never)
  const access = new HostWorkbenchAccess(directory)
  await directory.create({ requestId: 'initial', parentPath: root, folderName: 'original', record: record() })
  const mutate = vi.fn(async () => { throw new Error('Legacy Settings must not be written') })
  const options: HostDistributionOptions = { directory, access, profile: { dir: profile } as never,
    settings: { describe: () => [], mutate } as never, resolve: () => undefined, peerAvailable: () => true,
    native: { listBundles: async () => [], listPlugins: async () => [], setBundleEnabled: async () => ({ application: 'applied' }) } }
  return { root, profile, workspaces, directory, access, options, mutate, service: createHostDistributionService(options) }
}
async function archive(mode: WorkbenchPackageModeV4, source = record()) {
  const layout = projectLayoutPackage(source, [])
  const keys = generateKeyPairSync('ed25519')
  const publicKey = keys.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64')
  const bytes = await buildWorkbenchPackageV4({ layout, mode, ...(mode === 'layout-only' ? {} : {
    publisher: { publicKey, keyId: await publisherKeyIdV4(publicKey), displayName: '测试发布者' },
    sign: async (bytes: Uint8Array) => sign(null, bytes, keys.privateKey).toString('base64'),
  }) })
  return { layout, bytes }
}

it.each(['layout-only', 'online-reference', 'offline-embedded'] as const)('imports %s into a new folder, preserves the active workbench and resumes a committed publication', async mode => {
  const f = await setup()
  const source = record(); source.context = createWorkbenchContext(); source.context.human.goal = '模板背景'
  const pkg = await archive(mode, source)
  const inspected = await f.service.inspect(pkg.bytes)
  expect(inspected.directoryRequired).toBe(true)
  await expect(f.service.consent(inspected.transactionId, inspected.archiveSha256)).rejects.toThrow('父文件夹')
  const destination = { parentPath: f.root, folderName: 'received' }
  const waiting = await f.service.consent(inspected.transactionId, inspected.archiveSha256, destination)
  expect(waiting.state, waiting.blockers.join('; ')).toBe('awaiting-restore')
  await expect(f.service.consent(inspected.transactionId, inspected.archiveSha256, { ...destination, folderName: 'elsewhere' })).rejects.toThrow('不能更换')
  const restored = restoreLayoutPackage(pkg.layout, [])
  const done = await f.service.complete(waiting.transactionId, restored.document, {})
  expect(done.state).toBe('ready')
  expect(done.targetDisplayPath).toBe(join(f.root, 'received'))
  const envelope = JSON.parse(await readFile(join(f.root, 'received', '.bay', 'workbench.json'), 'utf8'))
  expect(envelope.schemaVersion).toBe(2)
  expect(envelope.record.context.human.goal).toBe('模板背景')
  expect(envelope.record.sessionCatalog).toEqual({})
  expect(f.directory.getSnapshot().value.activeWorkbenchId).toBe('original')
  expect(f.directory.getSnapshot().value.openWorkbenchIds).toEqual(['original'])
  expect(f.mutate).not.toHaveBeenCalled()
  // Simulate a crash after folder publication but before the final transaction state was saved.
  const journal = join(f.profile, '.dsh-workbench', 'distribution-v4', 'transactions', done.transactionId + '.json')
  const tx = JSON.parse(await readFile(journal, 'utf8')); tx.state = 'awaiting-restore'
  await writeFile(journal, JSON.stringify(tx))
  const directory = new HostWorkbenchDirectory(f.profile, f.workspaces as never)
  const restarted = createHostDistributionService({ ...f.options, directory })
  expect((await restarted.resume(done.transactionId)).state).toBe('ready')
  expect(Object.keys(directory.getSnapshot().value.workbenches)).toHaveLength(2)
  expect((await restarted.history())[0]?.workbenchId).toBe(done.workbenchId)
  expect(f.workspaces.create).toHaveBeenCalledTimes(2)
})

it('preserves missing-page configuration and unbound session placeholders in a folder template', async () => {
  const f = await setup(), source = record()
  const area = areasOf(source.document.root)[0]!
  area.moduleHistory = [
    { moduleInstanceId: 'notes', editorId: 'missing.notes', editorScope: 'root', state: { text: 'source' }, lastKnownTitle: '笔记' },
    { moduleInstanceId: 'chat', editorId: 'workbench.conversation', editorScope: 'session', state: {}, lastKnownTitle: '对话', binding: { sessionId: 'private-session' } },
  ]; area.activeModuleInstanceId = 'notes'
  const layout = projectLayoutPackage(source, [])
  areasOf(layout.document.root)[0]!.moduleHistory[0]!.state = { text: 'portable notes' }
  const inspected = await f.service.inspect(await buildWorkbenchPackageV4({ layout, mode: 'layout-only' }))
  await f.service.consent(inspected.transactionId, inspected.archiveSha256, { parentPath: f.root, folderName: 'missing' })
  const restored = restoreLayoutPackage(layout, [], {}, false, true)
  const result = await f.service.complete(inspected.transactionId, restored.document, {}, restored.pendingPageIds)
  expect(result.state).toBe('needs-input')
  const saved = f.directory.getSnapshot().value.workbenches[result.workbenchId]!
  const pages = areasOf(saved.document.root)[0]!.moduleHistory
  expect(pages).toHaveLength(2)
  expect(pages[0]?.pendingDistribution).toBe(result.transactionId)
  expect(pages[1]?.pendingBinding).toBeTruthy()
  expect(JSON.stringify(saved)).not.toContain('private-session')
  expect((await f.service.history())[0]?.layout).toEqual(layout)
})

it('rejects existing and invalid destinations before installation and does not create a folder when cancelled', async () => {
  const f = await setup(), pkg = await archive('layout-only')
  const row = await f.service.inspect(pkg.bytes)
  await expect(f.service.consent(row.transactionId, row.archiveSha256, { parentPath: f.root, folderName: 'original' })).rejects.toThrow('已存在')
  await expect(f.service.consent(row.transactionId, row.archiveSha256, { parentPath: f.root, folderName: '../escape' })).rejects.toThrow('名称无效')
  expect((await f.service.cancel(row.transactionId)).state).toBe('cancelled')
  expect((await readdir(f.root)).sort()).toEqual(['original', 'profile'])
  expect(f.mutate).not.toHaveBeenCalled()
})

it('refuses source-machine session bindings and legacy transactions without a folder destination', async () => {
  const f = await setup(), source = record(), area = areasOf(source.document.root)[0]!
  area.moduleHistory = [{ moduleInstanceId: 'chat', editorId: 'workbench.conversation', editorScope: 'session', state: {}, lastKnownTitle: 'Chat', binding: { sessionId: 'source-session' } }]
  area.activeModuleInstanceId = 'chat'
  const { layout, bytes } = await archive('layout-only', source), row = await f.service.inspect(bytes)
  await expect(f.service.resume(row.transactionId)).rejects.toThrow('导入位置')
  await f.service.consent(row.transactionId, row.archiveSha256, { parentPath: f.root, folderName: 'bound' })
  const restored = restoreLayoutPackage(layout, [], {}, false, true)
  const page = areasOf(restored.document.root)[0]!.moduleHistory[0]!
  page.binding = { sessionId: 'source-session' }; delete page.pendingBinding
  await expect(f.service.complete(row.transactionId, restored.document, {}, restored.pendingPageIds)).rejects.toThrow('重新绑定')
  expect(Object.keys(f.directory.getSnapshot().value.workbenches)).toEqual(['original'])
  expect(f.mutate).not.toHaveBeenCalled()
})

it.each(['0.0.1', '9.9.9'])('reports both versions and never replaces installed %s', async version => {
  const f = await setup()
  const prepared = await prepareDistributionArtifact(join(import.meta.dirname, '../presets/workbench-creator/skills/workbench-extension-development/templates/workbench-editor'), () => true)
  const installer = createDistributionInstaller({ ...f.options, native: { ...f.options.native,
    listBundles: async () => [{ name: prepared.dependency.packageName, version, installed: true, enabled: true }] } })
  const before = vi.fn()
  await expect(installer.install(prepared.dependency, 'must-not-read.tgz', before)).rejects.toThrow(`包要求 ${prepared.dependency.version}，本机已安装 ${version}`)
  expect(before).not.toHaveBeenCalled()
  const source = record(), layout = projectLayoutPackage(source, [])
  layout.modules = [{ editorId: 'workbench.example', scope: 'root', packageName: prepared.dependency.packageName, version: prepared.dependency.version, digest: prepared.dependency.digest }]
  const service = createHostDistributionService({ ...f.options, native: { ...f.options.native, listBundles: async () => [{ name: prepared.dependency.packageName, version, installed: true, enabled: true }] } })
  const row = await service.inspect(await buildWorkbenchPackageV4({ layout, mode: 'layout-only' }))
  expect(row.localExtensions).toEqual([{ packageName: prepared.dependency.packageName, requiredVersion: prepared.dependency.version, installedVersion: version, installed: true }])
})

it('restores deferred configuration in the folder with revision checks and reuses only identical plugin builds', async () => {
  const f = await setup(), pkg = join(f.root, 'plugin')
  await cp(join(import.meta.dirname, '../presets/workbench-creator/skills/workbench-extension-development/templates/workbench-editor'), pkg, { recursive: true })
  await rm(join(pkg, 'README.md'))
  const prepared = await prepareDistributionArtifact(pkg, () => true), d = prepared.dependency
  const w = JSON.parse(await readFile(join(pkg, 'package.json'), 'utf8')).dsh.workbench
  let installed = false
  const options: HostDistributionOptions = { ...f.options, resolve: () => installed ? pkg : undefined, native: { ...f.options.native,
    listBundles: async () => installed ? [{ name: d.packageName, version: d.version, installed: true, enabled: true, rows: d.bundleEntries }] : [],
    listPlugins: async () => d.bundleEntries.map(entry => ({ ...entry, enabled: true, fiberPhase: 'active' })),
  } }
  const service = createHostDistributionService(options), layout = projectLayoutPackage(record(), [])
  layout.modules = [{ editorId: 'workbench.example', scope: 'root', packageName: d.packageName, version: d.version, digest: d.digest }]
  const area = areasOf(layout.document.root)[0]!
  area.moduleHistory = [{ moduleInstanceId: 'source-page', editorId: 'workbench.example', editorScope: 'root', lastKnownTitle: 'Example', state: { schemaVersion: 1, acknowledged: true } }]
  area.activeModuleInstanceId = 'source-page'
  const row = await service.inspect(await buildWorkbenchPackageV4({ layout, mode: 'layout-only' }))
  await service.consent(row.transactionId, row.archiveSha256, { parentPath: f.root, folderName: 'deferred' })
  const restored = restoreLayoutPackage(layout, [], {}, false, true)
  await service.complete(row.transactionId, restored.document, {}, restored.pendingPageIds)
  installed = true
  const consent = { packageName: d.packageName, moduleId: d.moduleId, apiVersion: 1, editorIds: w.editorIds, allowed: true, allowedAt: 1, contractFingerprint: workbenchExtensionContractFingerprint({ schemaVersion: 1, moduleId: w.moduleId, apiVersion: 1, editorIds: w.editorIds, coreCompatibility: w.coreCompatibility, dshGeneration: w.dshGeneration }, w.editors) }
  await f.directory.patch({ operation: 'set', path: ['extensionConsents', d.packageName + '::' + d.moduleId], value: consent })
  await service.preparePending(row.transactionId)
  const installer = createDistributionInstaller(options)
  expect(await installer.check(d)).toEqual({ present: true, enabled: true })
  const current = structuredClone(f.directory.getSnapshot().value.workbenches[row.workbenchId]!.document), next = structuredClone(current)
  areasOf(next.root)[0]!.moduleHistory[0]!.state = { schemaVersion: 1, acknowledged: true }
  const stale = structuredClone(current); stale.activeAreaId = 'stale'
  await expect(service.restorePending(row.transactionId, next, stale, ['source-page'])).rejects.toThrow('另一窗口变化')
  f.access.registerOwner('browser', row.workbenchId, () => true)
  await expect(service.restorePending(row.transactionId, next, current, ['source-page'])).rejects.toThrow('请先收回')
  f.access.revoke('browser')
  expect((await service.restorePending(row.transactionId, next, current, ['source-page'])).state).toBe('ready')
  const saved = JSON.parse(await readFile(join(f.root, 'deferred', '.bay', 'workbench.json'), 'utf8'))
  expect(areasOf(saved.record.document.root)[0]!.moduleHistory[0]!.state).toEqual({ schemaVersion: 1, acknowledged: true })
  expect(areasOf(saved.record.document.root)[0]!.moduleHistory[0]!.pendingDistribution).toBeUndefined()
  expect(f.mutate).not.toHaveBeenCalled()
  await writeFile(join(pkg, 'client.js'), (await readFile(join(pkg, 'client.js'), 'utf8')) + '\n// different build\n')
  await expect(installer.check(d)).rejects.toThrow('不同构建')
})
