import type { WorkbenchSettingsScope } from '../client/workbench-settings-contracts.ts'
import type { LayoutImportJournal, LayoutImportReceiptV2 } from '../layout-import-journal.ts'
import type { WorkbenchEditorCatalog } from './catalog.ts'
import type { WorkbenchDirectory } from './frame-settings-adapter.ts'
import type { WorkbenchSettingsV4 } from './persistence.ts'
import type { SessionBindingV1 } from './model.ts'
import { buildLayoutPackage, inspectLayoutPackage, projectLayoutPackage, restoreLayoutPackage, type LayoutPackagePreview } from './workbench-layout-package.ts'

export interface WorkbenchLayoutPackageService {
  prepareExport(workbenchId: string): Promise<LayoutPackagePreview>
  export(workbenchId: string): Promise<Uint8Array>
  inspect(bytes: Uint8Array): Promise<LayoutPackagePreview>
  history(): Promise<LayoutImportReceiptV2[]>
  import(preview: LayoutPackagePreview, transactionId: string, bindings?: Readonly<Record<string, SessionBindingV1>>): Promise<{ workbenchId: string; warnings: string[] }>
}

/** Layout mode of package services: the existing settings CAS remains the only store. */
export function createWorkbenchLayoutPackageService(options: {
  settings: WorkbenchSettingsScope<WorkbenchSettingsV4>
  directory: WorkbenchDirectory
  editors: WorkbenchEditorCatalog
  journal: LayoutImportJournal
  canExport(id: string): boolean
  canImport(): boolean
}): WorkbenchLayoutPackageService {
  const pending = new Map<string, Promise<{ workbenchId: string; warnings: string[] }>>()
  const verified = new WeakSet<LayoutPackagePreview>()
  const inspect = async (bytes: Uint8Array) => { const preview = await inspectLayoutPackage(bytes); verified.add(preview); return preview }
  const prepareExport = async (id: string) => {
    if (!options.canExport(id)) throw new Error('请先收回这个工作台，再进行分享。')
    if (!await options.directory.flushBeforeLifecycleTransition?.()) throw new Error('当前布局尚未保存，分享已停止，请重试。')
    if (!options.canExport(id)) throw new Error('工作台运行位置已变化，请重试。')
    const record = options.settings.getSnapshot().value?.workbenches[id]
    if (!record) throw new Error('目标工作台不存在。')
    return inspect(await buildLayoutPackage(projectLayoutPackage(record, options.editors.getSnapshot())))
  }
  return {
    prepareExport,
    async export(id) { const preview = await prepareExport(id); return buildLayoutPackage(preview.layout) },
    inspect,
    history: () => options.canImport() ? options.journal.list() : Promise.resolve([]),
    import(preview, transactionId, bindings = {}) {
      if (!options.canImport()) return Promise.reject(new Error('请在 DSH 桌面端导入工作台。'))
      if (!verified.has(preview)) return Promise.reject(new Error('请先校验分享包。'))
      const existing = pending.get(transactionId)
      if (existing) return existing
      const run = async () => {
        const rows = await options.journal.list()
        let receipt = rows.find(row => row.transactionId === transactionId)
        if (receipt && receipt.archiveSha256 !== preview.digest) throw new Error('导入事务与分享包不一致。')
        if (receipt && options.settings.getSnapshot().value?.workbenches[receipt.workbenchId]) {
          await options.journal.save({ ...receipt, state: 'completed' }); return { workbenchId: receipt.workbenchId, warnings: preview.warnings }
        }
        if (receipt?.state === 'completed') throw new Error('这个导入事务已完成且工作台已删除，请发起新的副本导入。')
        receipt ??= { schemaVersion: 2, transactionId, archiveSha256: preview.digest, workbenchId: `workbench-${globalThis.crypto.randomUUID()}`, name: preview.layout.name, createdAt: Date.now(), state: 'prepared' }
        receipt = await options.journal.save(receipt)
        const snapshot = options.settings.getSnapshot()
        const value = snapshot.value
        if (!value || !snapshot.writable || !options.canImport()) throw new Error('当前无法写入工作台，请恢复连接后重试。')
        const restored = restoreLayoutPackage(preview.layout, options.editors.getSnapshot(), bindings)
        const occupied = new Set(Object.values(value.workbenches).map(row => row.name))
        let name = preview.layout.name
        for (let index = 2; occupied.has(name); index++) name = `${preview.layout.name.slice(0, 145)} ${index}`
        const result = await options.settings.patch({ operation: 'set', path: ['workbenches', receipt.workbenchId],
          value: { workbenchId: receipt.workbenchId, name, description: preview.layout.description, tags: preview.layout.tags, document: restored.document,
            createdAt: receipt.createdAt, updatedAt: receipt.createdAt, offlineOrigin: { schemaVersion: 1, packageId: preview.digest, archiveSha256: preview.digest } },
          ...(snapshot.revision === undefined ? {} : { expectedRevision: snapshot.revision }) })
        if (result.status !== 'committed') throw new Error(result.status === 'conflict' ? '设置已在其他窗口更新，导入未覆盖现有内容，请重试。' : '布局未能保存，请重试。')
        await options.journal.save({ ...receipt, state: 'completed' })
        return { workbenchId: receipt.workbenchId, warnings: [...preview.warnings, ...restored.warnings] }
      }
      const promise = run().finally(() => pending.delete(transactionId))
      pending.set(transactionId, promise)
      return promise
    },
  }
}
