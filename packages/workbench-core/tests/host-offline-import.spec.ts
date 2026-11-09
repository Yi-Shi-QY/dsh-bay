import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fixture, catalogOptions } from './offline-fixture.ts'
import { buildWorkbenchOfflinePackage } from '../src/offline-package.ts'
import { createWorkbenchHostOfflineImporter, type WorkbenchOfflineImportSettings } from '../src/host-offline-import.ts'
import { createWorkbenchOfflineImportStore } from '../src/host-offline-import-store.ts'
import type { WorkbenchModuleCenterFactsV1 } from '../src/browser-module-center.ts'
import type { WorkbenchInstallTransactionSnapshotV1 } from '../src/install-coordinator.ts'
import { areasOf, migrateDocumentV2ToV3, projectDocumentV3ToLayoutV2, validateWorkbenchDocumentV3 } from '../src/foundation/document-v3.ts'
import { WorkbenchRepository } from '../src/foundation/repository.ts'
import { retargetSession, validateLayout } from '../src/foundation/model.ts'
import { decodeWorkbenchSettingsV4, type WorkbenchRecordV2 } from '../src/foundation/persistence.ts'

const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })

async function setup(active = false) {
  const root = await mkdtemp(join(tmpdir(), 'workbench-offline-import-')); roots.push(root)
  const pkg = await buildWorkbenchOfflinePackage(await fixture())
  const store = createWorkbenchOfflineImportStore(root)
  const records: Record<string, unknown> = { main: { name: 'Existing' } }
  let revision = 1, facts: WorkbenchModuleCenterFactsV1 = { schemaVersion: 1, catalog: 'available', activation: active ? 'active' : 'absent',
    ...(active ? { installed: pkg.manifest.modules[0]! } : {}) }
  let transaction: WorkbenchInstallTransactionSnapshotV1 | undefined
  const conflict = new Error('revision changed')
  const settings: WorkbenchOfflineImportSettings = {
    snapshot: () => ({ revision, records, invalidIds: [] }),
    add: vi.fn(async (record, expectedRevision) => { if (revision !== expectedRevision) throw conflict; records[record.workbenchId] = structuredClone(record); revision++ }),
    conflict: error => error === conflict,
  }
  const install = vi.fn(async (_bytes: Uint8Array, staged: (id: string) => void) => {
    const transactionId = 'workbench-install-test-1'
    staged(transactionId)
    transaction = { transactionId, planId: 'plan', state: 'restart-required', stagedModules: ['workbench.conversation-suite'], installedModules: ['workbench.conversation-suite'], activatedModules: [] }
    facts = { ...facts, installed: pkg.manifest.modules[0]!, activation: 'restart-required' }
    return transaction
  })
  const rollback = vi.fn(async () => { facts = { schemaVersion: 1, catalog: 'available', activation: 'absent' }; if (transaction) transaction = { ...transaction, state: 'rolled-back' } })
  let busy = false
  const options = { store, settings, catalogOptions, facts: async () => facts, verify: vi.fn(async () => {}), install, rollback,
    installation: () => transaction, exclusive: async <T>(run: () => Promise<T>) => {
      if (busy) throw new Error('busy')
      busy = true; try { return await run() } finally { busy = false }
    } }
  return { root, pkg, records, store, options, settings, install, rollback, conflict,
    create: () => createWorkbenchHostOfflineImporter(options),
    restart: () => { facts = { ...facts, installed: pkg.manifest.modules[0]!, activation: 'active' }; if (transaction) transaction = { ...transaction, state: 'active' } },
    conflictIdentity: () => { facts = { ...facts, installed: { ...pkg.manifest.modules[0]!, artifactDigest: 'f'.repeat(64) }, activation: 'active' } } }
}

describe('Host offline import recovery', () => {
  it('persists preparation, requires restart and Client verification, then adds one inactive recipient layout', async () => {
    const f = await setup(), first = f.create()
    expect(await first.preflight(f.pkg.archive)).toMatchObject({ action: 'install-and-restart' })
    expect(f.store.list()).toEqual([])
    expect((await first.commit(f.pkg.archive)).state).toBe('restart-required')
    expect(Object.keys(f.records)).toEqual(['main'])
    await expect(first.complete(f.pkg.packageId, true)).rejects.toThrow('重启验证')
    expect((await first.commit(f.pkg.archive)).state).toBe('restart-required')
    expect(f.install).toHaveBeenCalledTimes(1)
    f.restart()
    const restarted = f.create(); await restarted.recover()
    expect(restarted.list()[0]?.state).toBe('verifying')
    const done = await restarted.complete(f.pkg.packageId, true)
    expect(done.state).toBe('completed')
    const record = f.records[done.workbenchId] as WorkbenchRecordV2
    expect(record.hiddenEditorIds).toEqual(f.pkg.layout.hiddenEditorIds)
    expect(areasOf(record.document.root).map(area => area.moduleHistory[0]!.editorId)).toEqual(areasOf(f.pkg.layout.document.root).map(area => area.moduleHistory[0]!.editorId))
    expect(areasOf(record.document.root).filter(area => area.moduleHistory[0]?.pendingBinding)).toHaveLength(2)
    expect(JSON.stringify(record)).not.toContain('private-')
    expect(validateWorkbenchDocumentV3(record.document)).toBeDefined()
    const decoded = decodeWorkbenchSettingsV4({ version: 4, activeWorkbenchId: done.workbenchId, openWorkbenchIds: [done.workbenchId],
      workbenches: { [done.workbenchId]: record }, layoutTemplates: {}, invalidWorkbenches: {}, sessionMarkers: {} })
    expect(decoded?.workbenches[done.workbenchId]?.offlineOrigin).toEqual(record.offlineOrigin)
    record.name = 'Recipient edit'
    await restarted.commit(f.pkg.archive); await f.create().recover()
    expect(Object.keys(f.records)).toHaveLength(2)
    expect((f.records[done.workbenchId] as WorkbenchRecordV2).name).toBe('Recipient edit')
  })

  it('reuses an active exact module without installation or restart and preserves it after Client failure', async () => {
    const f = await setup(true), service = f.create()
    expect((await service.commit(f.pkg.archive)).state).toBe('verifying')
    expect((await service.complete(f.pkg.packageId, false)).state).toBe('failed')
    expect(f.install).not.toHaveBeenCalled(); expect(f.rollback).not.toHaveBeenCalled()
    expect(Object.keys(f.records)).toEqual(['main'])
  })

  it('rolls back only this import installation after Client verification failure', async () => {
    const f = await setup(), service = f.create()
    await service.commit(f.pkg.archive); f.restart(); await service.recover()
    expect((await service.complete(f.pkg.packageId, false)).state).toBe('failed')
    expect(f.rollback).toHaveBeenCalledWith('workbench-install-test-1')
    expect(Object.keys(f.records)).toEqual(['main'])
    expect((await service.commit(f.pkg.archive)).state).toBe('restart-required')
    f.restart(); await service.recover()
    expect((await service.complete(f.pkg.packageId, true)).state).toBe('completed')
    expect(Object.keys(f.records)).toHaveLength(2)
  })

  it('retains newly installed artifacts after another Workbench begins using them', async () => {
    const f = await setup(), service = f.create()
    await service.commit(f.pkg.archive); f.restart(); await service.recover()
    f.records.other = (await fixture()).record
    expect(await service.complete(f.pkg.packageId, false)).toMatchObject({ state: 'failed', error: 'rollback-pending' })
    expect(f.rollback).not.toHaveBeenCalled()
  })

  it('retries revision conflicts against current records without replacing other changes', async () => {
    const f = await setup(true), service = f.create()
    await service.commit(f.pkg.archive)
    vi.mocked(f.settings.add).mockImplementationOnce(async () => { f.records.concurrent = { name: 'Concurrent edit' }; throw f.conflict })
    expect((await service.complete(f.pkg.packageId, true)).state).toBe('completed')
    expect(f.records.concurrent).toEqual({ name: 'Concurrent edit' })
    expect(f.settings.add).toHaveBeenCalledTimes(2)
  })

  it('recovers Settings write failure and a crash after layout commit without duplicate delivery', async () => {
    const f = await setup(true), service = f.create()
    await service.commit(f.pkg.archive)
    vi.mocked(f.settings.add).mockRejectedValueOnce(new Error('disk unavailable'))
    expect(await service.complete(f.pkg.packageId, true)).toMatchObject({ state: 'committing-layout', error: 'layout-pending' })
    const saved = f.store.save.bind(f.store)
    vi.spyOn(f.store, 'save').mockImplementation(row => { if (row.state === 'completed') throw new Error('receipt interrupted'); saved(row) })
    await expect(service.complete(f.pkg.packageId, true)).rejects.toThrow('receipt interrupted')
    expect(Object.keys(f.records)).toHaveLength(2)
    vi.mocked(f.store.save).mockImplementation(saved)
    await f.create().recover()
    expect(f.store.list()[0]?.state).toBe('completed')
    expect(f.settings.add).toHaveBeenCalledTimes(2)
    expect(f.rollback).not.toHaveBeenCalled()
  })

  it('blocks conflicts and corrupt inputs before Profile storage or install', async () => {
    const f = await setup(), service = f.create()
    f.conflictIdentity()
    await expect(service.commit(f.pkg.archive)).rejects.toThrow('冲突')
    await expect(service.commit(new Uint8Array([1, 2]))).rejects.toThrow()
    expect(f.store.list()).toEqual([]); expect(f.install).not.toHaveBeenCalled()
  })

  it('fails closed on a corrupt durable journal', async () => {
    const f = await setup()
    await f.create().commit(f.pkg.archive)
    await writeFile(join(f.root, '.dsh-workbench', 'offline-import-v1', 'journal.json'), 'invalid')
    expect(() => f.create().list()).toThrow()
  })

  it('resumes a durable import link created before the Module journal exists', async () => {
    const f = await setup(), service = f.create()
    const archiveSha256 = (await import('../src/offline-package.ts')).offlineSha256
    f.store.retain(f.pkg.packageId, f.pkg.archive)
    f.store.save({ schemaVersion: 1, packageId: f.pkg.packageId, archiveSha256: await archiveSha256(f.pkg.archive),
      state: 'installing', modules: f.pkg.manifest.modules, workbenchId: `offline-${f.pkg.packageId}`, moduleTransactionId: 'workbench-install-unstarted' })
    await service.recover()
    expect(f.install).toHaveBeenCalledTimes(1)
    expect(service.list()[0]?.state).toBe('restart-required')
    expect(f.rollback).not.toHaveBeenCalled()
  })

  it('binds pending pages independently while preserving their types', async () => {
    const f = await setup(true), service = f.create()
    await service.commit(f.pkg.archive)
    const done = await service.complete(f.pkg.packageId, true), record = f.records[done.workbenchId] as WorkbenchRecordV2
    const repository = new WorkbenchRepository({ version: 4, activeWorkbenchId: record.workbenchId, openWorkbenchIds: [record.workbenchId],
      workbenches: { [record.workbenchId]: record }, layoutTemplates: {}, invalidWorkbenches: {}, sessionMarkers: {} })
    const pending = areasOf(record.document.root).filter(area => area.moduleHistory[0]?.pendingBinding)
    const claim = repository.claimArea(record.workbenchId, pending[0]!.areaId, 'create-a')
    const late = repository.claimArea(record.workbenchId, pending[1]!.areaId, 'create-b')
    expect(repository.bindConversation(claim, { sessionId: 'recipient-session', workspaceId: 'recipient-workspace' }, false).status).toBe('bound')
    expect(repository.bindConversation(late, { sessionId: 'late-session' }, false).status).toBe('bound')
    const bound = areasOf(repository.getWorkbench(record.workbenchId)!.document.root)
    expect(bound.slice(1).map(area => area.moduleHistory.find(module => module.binding !== undefined)?.binding?.sessionId)).toEqual(['recipient-session', 'late-session'])
    expect(bound[2]!.moduleHistory[0]!.editorId).toBe('workbench.agent-trajectory')
    const projected = projectDocumentV3ToLayoutV2(record.document)
    expect(validateLayout(projected)).toBeDefined()
    expect(migrateDocumentV2ToV3(projected)).toEqual(record.document)
    const rebound = retargetSession(projected, pending[0]!.moduleHistory[0]!.moduleInstanceId, { sessionId: 'selected-existing' })
    const reboundAreas = areasOf(migrateDocumentV2ToV3(rebound).root)
    expect(reboundAreas.find(area => area.areaId === pending[0]!.areaId)?.moduleHistory[0]?.binding?.sessionId).toBe('selected-existing')
    expect(reboundAreas.find(area => area.areaId === pending[1]!.areaId)?.moduleHistory).toEqual(pending[1]!.moduleHistory)
  })
})
