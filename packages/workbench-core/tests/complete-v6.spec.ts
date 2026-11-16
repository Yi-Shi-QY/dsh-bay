import { afterEach, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { cp, mkdtemp, mkdir, readFile, writeFile, realpath, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { c, x } from 'tar'
import { HostWorkbenchDirectory } from '../src/host-workbench-directory.ts'
import { installWorkbenchCompleteRoute, type CompleteOptions } from '../src/host-workbench-complete.ts'
import { CompleteMigrationRegistry } from '../src/host-complete-migrations.ts'
import { createCompleteExtensions, type CompleteExtensions } from '../src/host-complete-extensions.ts'
import { prepareDistributionArtifact } from '../src/host-distribution-artifacts.ts'
import { WORKBENCH_COMPLETE_ROUTE, type CompleteExtensionLock, type CompletePackageJobView } from '../src/workbench-complete-contract.ts'
import { checkInventoryPlatform } from '../src/host-workbench-complete-files.ts'

const roots: string[] = []
const disposers: (() => Promise<void>)[] = []
afterEach(async () => { for (const dispose of disposers.splice(0)) await dispose(); for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })
const workspaces = { async create(folder: string) { return { id: folder } } }
const persistence = { async flush() {}, async list() { return [] } } as CompleteOptions['persistence']
function route(options: CompleteOptions) {
  let fetch!: (request: Request) => Promise<Response>
  const dispose = installWorkbenchCompleteRoute({ fetch: { register(config: { path: string; fetch: typeof fetch }) { if (config.path === WORKBENCH_COMPLETE_ROUTE) fetch = config.fetch; return () => {} } } } as never, options)
  disposers.push(dispose)
  return { dispose, async call(input: object) { const response = await fetch(new Request('http://localhost', { method: 'POST', body: JSON.stringify(input) })); return { ok: response.ok, ...await response.json() } as { ok: boolean; value: CompletePackageJobView; error?: string } } }
}
async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'bay-v6-'))); roots.push(root)
  const profile = join(root, 'source-profile'), directory = new HostWorkbenchDirectory(profile, workspaces as never)
  await directory.create({ requestId: 'source', parentPath: root, folderName: 'source', record: { workbenchId: 'wb', name: 'V6', description: '', createdAt: 1, updatedAt: 1, document: { version: 3, activeAreaId: 'a', root: { kind: 'area', areaId: 'a', moduleHistory: [] } } } })
  await mkdir(join(root, 'source', '.git'))
  await mkdir(join(root, 'source', 'empty'))
  await writeFile(join(root, 'source', '.git', 'HEAD'), 'ref: refs/heads/main\n')
  const targetProfile = join(root, 'target-profile'), target = new HostWorkbenchDirectory(targetProfile, workspaces as never)
  return { root, directory, target, profile, targetProfile, archive: join(root, 'complete.tar.gz') }
}
const bytes = new TextEncoder().encode('controlled extension artifact')
const digest = createHash('sha256').update(bytes).digest('hex')
function extension(): CompleteExtensionLock {
  return { packageName: 'test-extension', moduleId: 'test.module', version: '1.0.0', artifactSha256: digest, permissions: ['workspace.read'], editorIds: [], exportPolicy: 'embed', platforms: ['win32', 'darwin', 'linux'], artifactPath: 'extensions/' + digest + '.tgz', migrations: { events: [], workbenchData: [{ key: 'notes', schemaVersion: 1 }] } }
}
function registerData(registry: CompleteMigrationRegistry, restore: ReturnType<typeof vi.fn>) {
  const lock = extension()
  registry.register({ ...lock, events: [], workbenchData: [{ key: 'notes', schemaVersion: 1, export: async () => ({ note: 'workbench only' }), restore }] })
}
it('prepares files, confirms extensions, survives a Host restart and publishes only after exact migrations are available', async () => {
  const f = await fixture(), senderRegistry = new CompleteMigrationRegistry(), recipientRegistry = new CompleteMigrationRegistry()
  const restored = vi.fn(async () => {})
  registerData(senderRegistry, restored)
  let installed = false, activated = false
  const install = vi.fn(async () => { installed = true; return { restartRequired: true } })
  const extensions: CompleteExtensions = {
    async collect(_record, directory) { await mkdir(join(directory, 'extensions')); await writeFile(join(directory, extension().artifactPath!), bytes); return [extension()] },
    async check(locks) { return locks.map(extension => ({ extension, state: !installed ? 'install' : !activated ? 'restart' : recipientRegistry.declaration(extension).workbenchData.length ? 'ready' : 'migration-missing' })) }, install,
  }
  const sender = route({ profile: f.profile, directory: f.directory, persistence, workspaces: workspaces as never, migrations: senderRegistry, extensions: () => extensions })
  expect(await sender.call({ action: 'export', workbenchId: 'wb', path: f.archive, targetPlatform: 'linux' })).toMatchObject({ ok: true, value: { version: 6, stage: 'complete', targetPlatform: 'linux' } })
  const recipientOptions = { profile: f.targetProfile, directory: f.target, persistence, workspaces: workspaces as never, migrations: recipientRegistry, extensions: () => extensions }
  const receiver = route({ ...recipientOptions, bootId: 'before-restart' })
  const imported = await receiver.call({ action: 'import', path: f.archive, parentPath: f.root, folderName: 'received', requestId: 'one-import' })
  expect(imported).toMatchObject({ ok: true, value: { stage: 'awaiting-extensions', version: 6 } })
  const id = imported.value.id
  expect(Object.keys(f.target.getSnapshot().value.workbenches)).toEqual([])
  expect(existsSync(join(f.root, 'received'))).toBe(false)
  expect(restored).not.toHaveBeenCalled()
  const before = JSON.parse(await readFile(join(f.targetProfile, '.dsh-workbench/complete-v5', id + '.json'), 'utf8'))
  expect(await receiver.call({ action: 'confirm-extensions', id, confirmed: true, digest: 'stale' })).toMatchObject({ ok: false })
  await receiver.call({ action: 'confirm-extensions', id, confirmed: true, digest: before.extensionPlanDigest })
  await vi.waitFor(async () => expect(await receiver.call({ action: 'status', id })).toMatchObject({ value: { stage: 'awaiting-restart', running: false } }))
  await receiver.call({ action: 'resume', id })
  await vi.waitFor(async () => expect(await receiver.call({ action: 'status', id })).toMatchObject({ value: { stage: 'awaiting-restart', running: false } }))
  expect(install).toHaveBeenCalledTimes(1)
  await receiver.dispose()
  activated = true
  const next = route({ ...recipientOptions, bootId: 'after-restart' })
  await next.call({ action: 'resume', id })
  await vi.waitFor(async () => expect(await next.call({ action: 'status', id })).toMatchObject({ value: { stage: 'blocked', running: false } }))
  expect(Object.keys(f.target.getSnapshot().value.workbenches)).toEqual([])
  registerData(recipientRegistry, restored)
  await next.call({ action: 'resume', id })
  await vi.waitFor(async () => expect(await next.call({ action: 'status', id })).toMatchObject({ value: { stage: 'complete', running: false } }))
  expect(restored).toHaveBeenCalledWith({ note: 'workbench only' }, expect.objectContaining({ jobId: id, root: join(f.root, 'received') }))
  const after = JSON.parse(await readFile(join(f.targetProfile, '.dsh-workbench/complete-v5', id + '.json'), 'utf8'))
  expect(after.sessionMap).toEqual(before.sessionMap)
  expect(after.targetPath).toBe(before.targetPath)
  expect(f.target.getSnapshot().value.workbenches.wb?.executionPaused).toBe(true)
  expect(await readFile(join(f.root, 'received/.git/HEAD'), 'utf8')).toContain('refs/heads/main')
  expect(existsSync(join(f.root, 'received/empty'))).toBe(true)
})

it('continues reading V5 archives, verifies the persisted archive before resuming, and retains staging on mismatch', async () => {
  const f = await fixture()
  const sender = route({ profile: f.profile, directory: f.directory, persistence, workspaces: workspaces as never })
  await sender.call({ action: 'export', workbenchId: 'wb', path: f.archive })
  const unpack = join(f.root, 'unpack'); await mkdir(unpack); await x({ cwd: unpack, file: f.archive })
  const manifest = JSON.parse(await readFile(join(unpack, 'manifest.json'), 'utf8')); manifest.version = 5
  await writeFile(join(unpack, 'manifest.json'), JSON.stringify(manifest))
  const oldArchive = join(f.root, 'v5.tar.gz'); await c({ cwd: unpack, file: oldArchive, gzip: true }, ['manifest.json', 'files.ndjson', 'workbench', 'native'])
  const receiver = route({ profile: f.targetProfile, directory: f.target, persistence, workspaces: workspaces as never })
  expect(await receiver.call({ action: 'preflight', path: oldArchive })).toMatchObject({ ok: true })
  const original = f.target.publishImported.bind(f.target)
  vi.spyOn(f.target, 'publishImported').mockRejectedValueOnce(new Error('disk failure')).mockImplementation(original)
  expect(await receiver.call({ action: 'import', path: oldArchive, parentPath: f.root, folderName: 'received', requestId: 'v5-once' })).toMatchObject({ ok: false, error: 'disk failure' })
  const list = await receiver.call({ action: 'jobs', allImports: true })
  const job = (list.value as unknown as CompletePackageJobView[])[0]!
  const saved = JSON.parse(await readFile(join(f.targetProfile, '.dsh-workbench/complete-v5', job.id + '.json'), 'utf8'))
  saved.version = 5
  await writeFile(join(f.targetProfile, '.dsh-workbench/complete-v5', job.id + '.json'), JSON.stringify(saved))
  const archiveBytes = await readFile(oldArchive); await writeFile(oldArchive, 'broken')
  await receiver.call({ action: 'resume', id: job.id })
  await vi.waitFor(async () => expect(await receiver.call({ action: 'status', id: job.id })).toMatchObject({ value: { stage: 'failed', running: false } }))
  expect(existsSync(saved.stageDir)).toBe(true)
  expect(Object.keys(f.target.getSnapshot().value.workbenches)).toEqual([])
  await writeFile(oldArchive, archiveBytes)
  await receiver.call({ action: 'resume', id: job.id })
  await vi.waitFor(async () => expect(await receiver.call({ action: 'status', id: job.id })).toMatchObject({ value: { stage: 'complete', running: false } }))
})

it.each(['win32', 'darwin', 'linux'] as const)('checks all three targets independently of source %s', async source => {
  const f = await fixture(), file = join(f.root, 'files.ndjson')
  await writeFile(file, ['README', 'readme'].map(path => JSON.stringify({ path, type: 'file', bytes: 1, mode: 420 })).join('\n'))
  for (const target of ['win32', 'darwin', 'linux'] as const) {
    if (target === 'linux') await expect(checkInventoryPlatform(file, target), source).resolves.toBeUndefined()
    else await expect(checkInventoryPlatform(file, target), source).rejects.toThrow('文件名冲突')
  }
})

it('collects an exact local distribution identity and never embeds reference or forbidden extension artifacts', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'bay-v6-extension-'))); roots.push(root)
  const template = join(import.meta.dirname, '../presets/workbench-creator/skills/workbench-extension-development/templates/workbench-editor')
  const extensionRoot = join(root, 'extension'), exportRoot = join(root, 'export')
  await cp(template, extensionRoot, { recursive: true }); await mkdir(exportRoot)
  const packageFile = join(extensionRoot, 'package.json')
  let manifest = JSON.parse(await readFile(packageFile, 'utf8'))
  const packageName = manifest.name as string, editorId = manifest.dsh.workbench.editors[0].editorId as string
  let installedRoot = ''
  let prepared!: Awaited<ReturnType<typeof prepareDistributionArtifact>>
  let bundle!: { name: string; version: string; installed: boolean; enabled: boolean; rows: { moduleName: string; entryId: string }[] }
  const refreshInstalled = async () => {
    prepared = await prepareDistributionArtifact(extensionRoot, () => true, { allowForbiddenIdentity: true })
    const installContainer = join(root, 'installed-' + prepared.dependency.exportPolicy)
    installedRoot = join(installContainer, 'package')
    await mkdir(installContainer)
    const archive = join(root, prepared.dependency.archiveSha256 + '.tgz')
    await writeFile(archive, prepared.bytes); await x({ cwd: installContainer, file: archive })
    bundle = { name: packageName, version: manifest.version, installed: true, enabled: true, rows: prepared.dependency.bundleEntries.map(row => ({ moduleName: row.moduleName, entryId: row.entryId })) }
  }
  await refreshInstalled()
  const native = { async listBundles() { return [bundle] }, async listPlugins() { return prepared.dependency.bundleEntries.map(row => ({ moduleName: row.moduleName, entryId: row.entryId, enabled: true, fiberPhase: 'active' })) }, async setBundleEnabled() { return { application: 'applied' as const } } }
  const profile = { dir: root, name: 'test', cwd: root, home: root, installAnchor: root, packageManager: {} }
  const adapter = createCompleteExtensions({ profile, native, resolve: () => installedRoot, peerAvailable: () => true } as never, new CompleteMigrationRegistry())
  const record = { workbenchId: 'source', document: { root: { kind: 'area', areaId: 'area', moduleHistory: [{ editorId, moduleInstanceId: 'page' }] } } } as never
  const embedded = await adapter.collect(record, exportRoot, 'linux')
  expect(embedded).toHaveLength(1)
  expect(embedded[0]).toMatchObject({ packageName, artifactSha256: prepared.dependency.archiveSha256, exportPolicy: 'embed', artifactPath: 'extensions/' + prepared.dependency.archiveSha256 + '.tgz' })
  expect(await adapter.check(embedded, 'linux', exportRoot)).toMatchObject([{ state: 'ready' }])

  manifest.dsh.workbench.distribution.exportPolicy = 'reference'
  await writeFile(packageFile, JSON.stringify(manifest))
  await refreshInstalled()
  const reference = await adapter.collect(record, join(root, 'reference-export'), 'linux')
  expect(reference[0]).toMatchObject({ exportPolicy: 'reference' })
  expect(reference[0]).not.toHaveProperty('artifactPath')
  manifest.dsh.workbench.distribution.exportPolicy = 'forbid'
  await writeFile(packageFile, JSON.stringify(manifest))
  await refreshInstalled()
  const forbidden = await adapter.collect(record, join(root, 'forbidden-export'), 'linux')
  expect(forbidden[0]).toMatchObject({ exportPolicy: 'forbid' })
  expect(forbidden[0]).not.toHaveProperty('artifactPath')
})
