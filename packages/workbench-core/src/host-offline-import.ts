import type { WorkbenchModuleCenterFactsV1 } from './browser-module-center.ts'
import type { WorkbenchOfflineImportStore } from './host-offline-import-store.ts'
import type { WorkbenchOfflineImportReceipt, WorkbenchOfflineImportPreflight } from './offline-import-contract.ts'
import type { WorkbenchInstallTransactionSnapshotV1 } from './install-coordinator.ts'
import type { WorkbenchSignedCatalogImportOptionsV1 } from './signed-catalog.ts'
import type { WorkbenchModuleIdentityV1 } from './module-catalog.ts'
import { inspectWorkbenchOfflinePackage, offlineSha256, type WorkbenchOfflinePackageV1 } from './offline-package.ts'
import { areasOf, cloneWorkbenchDocumentWithFreshIds, validateWorkbenchDocumentV3 } from './foundation/document-v3.ts'
import type { WorkbenchRecordV2 } from './foundation/persistence.ts'

export interface WorkbenchOfflineImportSettings {
  snapshot(): { revision: number; records: Record<string, unknown>; invalidIds: readonly string[] }
  add(record: WorkbenchRecordV2, expectedRevision: number): Promise<void>
  conflict(error: unknown): boolean
}

export interface WorkbenchHostOfflineImportOptions {
  store: WorkbenchOfflineImportStore
  settings: WorkbenchOfflineImportSettings
  catalogOptions: WorkbenchSignedCatalogImportOptionsV1
  facts(): Promise<WorkbenchModuleCenterFactsV1>
  verify(module: WorkbenchModuleIdentityV1): Promise<void>
  install(bytes: Uint8Array, onStaged: (transactionId: string) => void): Promise<WorkbenchInstallTransactionSnapshotV1>
  rollback(transactionId: string): Promise<void>
  installation(transactionId: string): WorkbenchInstallTransactionSnapshotV1 | undefined
  exclusive<T>(run: () => Promise<T>): Promise<T>
}

function exact(left: WorkbenchModuleIdentityV1, right: WorkbenchModuleIdentityV1) {
  return left.moduleId === right.moduleId && left.version === right.version && left.artifactDigest === right.artifactDigest
}

/** The Host serializes import ownership, Module installation and incremental Settings delivery. */
export function createWorkbenchHostOfflineImporter(options: WorkbenchHostOfflineImportOptions) {
  const receipt = (packageId: string) => options.store.list().find(row => row.packageId === packageId)
  const save = (row: WorkbenchOfflineImportReceipt, state: WorkbenchOfflineImportReceipt['state'], error?: WorkbenchOfflineImportReceipt['error']) => {
    const { error: _oldError, ...rest } = row
    const next = { ...rest, state, ...(error === undefined ? {} : { error }) }
    options.store.save(next)
    return next
  }
  const delivered = (row: WorkbenchOfflineImportReceipt) => {
    const record = options.settings.snapshot().records[row.workbenchId] as WorkbenchRecordV2 | undefined
    return record?.offlineOrigin?.packageId === row.packageId && record.offlineOrigin.archiveSha256 === row.archiveSha256
  }
  const read = async (row: WorkbenchOfflineImportReceipt) => {
    const bytes = options.store.archive(row.packageId)
    if (await offlineSha256(bytes) !== row.archiveSha256) throw new Error('Prepared offline archive changed')
    const pkg = await inspectWorkbenchOfflinePackage(bytes, options.catalogOptions)
    if (pkg.packageId !== row.packageId || JSON.stringify(pkg.manifest.modules) !== JSON.stringify(row.modules)) throw new Error('Prepared offline identity changed')
    return pkg
  }
  const check = async (pkg: WorkbenchOfflinePackageV1): Promise<WorkbenchOfflineImportPreflight> => {
    options.settings.snapshot()
    const previous = receipt(pkg.packageId)
    if (previous?.state === 'completed') return { packageId: pkg.packageId, action: 'already-imported' }
    const pending = options.store.list().find(row => row.packageId !== pkg.packageId && !['completed', 'failed'].includes(row.state))
    if (pending !== undefined) throw new Error('另一个离线导入需要先完成或恢复。')
    const facts = await options.facts()
    const module = pkg.manifest.modules[0]
    if (module !== undefined && facts.installed !== undefined && !exact(module, facts.installed)) throw new Error('已安装内页模块的版本或摘要冲突。')
    if (module !== undefined && facts.activation === 'unverified') throw new Error('本机模块未通过验证，需要先恢复相同身份。')
    if (previous !== undefined) return { packageId: pkg.packageId, action: 'resume' }
    if (facts.activation === 'restart-required') throw new Error('现有模块事务需要先重启 DSH。')
    if (module !== undefined && facts.activation === 'active') await options.verify(module)
    return { packageId: pkg.packageId, action: module !== undefined && facts.activation === 'absent' ? 'install-and-restart' : 'reuse' }
  }
  const fail = async (row: WorkbenchOfflineImportReceipt): Promise<WorkbenchOfflineImportReceipt> => {
    if (delivered(row)) return save(row, 'completed')
    if (row.moduleTransactionId !== undefined) {
      const inUse = Object.values(options.settings.snapshot().records).some(raw => {
        const document = validateWorkbenchDocumentV3((raw as WorkbenchRecordV2 | null)?.document)
        return document !== undefined && areasOf(document.root).some(area => area.moduleHistory.some(module =>
          ['workbench.conversation', 'workbench.conversation.start', 'workbench.agent-trajectory'].includes(module.editorId)))
      })
      if (inUse) return save(row, 'failed', 'rollback-pending')
      try { await options.rollback(row.moduleTransactionId) }
      catch { return save(row, 'failed', 'rollback-pending') }
    }
    return save(row, 'failed', 'module-failed')
  }
  const advance = async (row: WorkbenchOfflineImportReceipt, pkg: WorkbenchOfflinePackageV1): Promise<WorkbenchOfflineImportReceipt> => {
    if (row.state === 'completed' || delivered(row)) return row.state === 'completed' ? row : save(row, 'completed')
    const module = row.modules[0]
    if (module === undefined) return save(row, 'verifying')
    const facts = await options.facts()
    if (facts.activation === 'active' && facts.installed !== undefined && exact(facts.installed, module)) {
      await options.verify(module)
      return save(row, 'verifying')
    }
    if (row.moduleTransactionId !== undefined) {
      const transaction = options.installation(row.moduleTransactionId)
      if (transaction === undefined && row.state === 'installing') {
        const { moduleTransactionId: _unstarted, ...rest } = row
        row = save(rest, 'prepared')
      } else {
        if (transaction === undefined || ['failed', 'rolled-back', 'active'].includes(transaction.state)) return fail(row)
        return save(row, 'restart-required')
      }
    }
    if (!['prepared', 'installing'].includes(row.state) || pkg.catalogArchive === undefined) return fail(row)
    row = save(row, 'installing')
    try {
      const transaction = await options.install(pkg.catalogArchive, transactionId => {
        row = { ...row, moduleTransactionId: transactionId }
        options.store.save(row)
      })
      return save(row, transaction.state === 'active' ? 'verifying' : 'restart-required')
    } catch { return fail(row) }
  }
  const createRecord = (row: WorkbenchOfflineImportReceipt, pkg: WorkbenchOfflinePackageV1, occupied: Record<string, unknown>): WorkbenchRecordV2 => {
    const document = structuredClone(pkg.layout.document)
    for (const area of areasOf(document.root)) for (const module of area.moduleHistory) {
      if (module.editorScope === 'session') module.pendingBinding = pkg.layout.bindings.find(binding => binding.areaIds.includes(area.areaId))!.key
    }
    let serial = 0
    const fresh = cloneWorkbenchDocumentWithFreshIds(document, kind => `${row.workbenchId}-${kind}-${String(++serial)}`)
    if (validateWorkbenchDocumentV3(fresh) === undefined) throw new Error('Imported recipient layout is invalid')
    const names = new Set(Object.values(occupied).map(record => String((record as { name?: unknown } | null)?.name ?? '').trim().normalize('NFKC').toLowerCase()))
    const base = pkg.layout.name.trim() || '导入工作台'
    let name = base, suffix = 1
    while (names.has(name.normalize('NFKC').toLowerCase())) name = `${base} ${String(++suffix)}`
    const now = Date.now()
    return { workbenchId: row.workbenchId, name, description: pkg.layout.description, tags: [...pkg.layout.tags], hiddenEditorIds: [...pkg.layout.hiddenEditorIds],
      document: fresh, createdAt: now, updatedAt: now, offlineOrigin: { schemaVersion: 1, packageId: row.packageId, archiveSha256: row.archiveSha256 } }
  }
  const complete = async (packageId: string, clientReady: boolean) => {
    let row = receipt(packageId)
    if (row === undefined) throw new Error('Offline import transaction is missing')
    if (row.state === 'completed' || delivered(row)) return row.state === 'completed' ? row : save(row, 'completed')
    if (!clientReady) return fail(row)
    if (!['verifying', 'committing-layout'].includes(row.state)) throw new Error('离线导入尚未完成重启验证。')
    const pkg = await read(row)
    await check(pkg)
    for (const module of row.modules) {
      const facts = await options.facts()
      if (facts.activation !== 'active' || facts.installed === undefined || !exact(facts.installed, module)) return fail(row)
      await options.verify(module)
    }
    row = save(row, 'committing-layout')
    for (let attempt = 0; attempt < 4; attempt++) {
      const snapshot = options.settings.snapshot()
      if (delivered(row)) return save(row, 'completed')
      if (snapshot.records[row.workbenchId] !== undefined || snapshot.invalidIds.includes(row.workbenchId)) return save(row, 'committing-layout', 'layout-pending')
      try { await options.settings.add(createRecord(row, pkg, snapshot.records), snapshot.revision) }
      catch (error) {
        if (options.settings.conflict(error)) continue
        return save(row, 'committing-layout', 'layout-pending')
      }
      return save(row, 'completed')
    }
    return save(row, 'committing-layout', 'layout-pending')
  }
  return {
    list: () => options.store.list(),
    pending: () => options.store.list().some(row => row.state !== 'completed' && (row.state !== 'failed' || row.error === 'rollback-pending')),
    preflight: async (bytes: Uint8Array) => check(await inspectWorkbenchOfflinePackage(bytes, options.catalogOptions)),
    commit: (bytes: Uint8Array) => options.exclusive(async () => {
      const pkg = await inspectWorkbenchOfflinePackage(bytes, options.catalogOptions)
      await check(pkg)
      let row = receipt(pkg.packageId)
      if (row?.state === 'failed') {
        if (row.error === 'rollback-pending') throw new Error('此导入事务仍需完成回滚恢复。')
        const { moduleTransactionId: _previousTransaction, ...rest } = row
        row = save(rest, 'prepared')
      }
      if (row === undefined) {
        row = { schemaVersion: 1, packageId: pkg.packageId, archiveSha256: await offlineSha256(bytes), modules: pkg.manifest.modules,
          workbenchId: `offline-${pkg.packageId}`, state: 'prepared' }
        options.store.retain(row.packageId, bytes)
        options.store.save(row)
      }
      return advance(row, pkg)
    }),
    complete: (packageId: string, clientReady: boolean) => options.exclusive(() => complete(packageId, clientReady)),
    recover: () => options.exclusive(async () => {
      for (let row of options.store.list()) {
        if (row.state === 'completed' || (row.state === 'failed' && row.error !== 'rollback-pending')) continue
        try {
          if (row.error === 'rollback-pending') { await fail(row); continue }
          row = await advance(row, await read(row))
        } catch { await fail(row) }
      }
    }),
  }
}
