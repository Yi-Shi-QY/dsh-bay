import type { WorkbenchCoreRuntimeV1 } from './core-runtime.ts'
import type { WorkbenchSettingsScope } from './client/workbench-settings-contracts.ts'
import type { WorkbenchSettingsV4 } from './foundation/persistence.ts'
import type { WorkbenchDirectory } from './foundation/frame-settings-adapter.ts'
import type { WorkbenchEditorCatalog } from './foundation/catalog.ts'
import { createWorkbenchModuleCenterBridge } from './browser-module-center.ts'
import { WORKBENCH_CONVERSATION_PAGE_METADATA } from './conversation-page-metadata.ts'
import { buildWorkbenchOfflinePackage, inspectWorkbenchOfflinePackage, type WorkbenchOfflinePackageV1 } from './offline-package.ts'
import type { WorkbenchModuleIdentityV1 } from './module-catalog.ts'
import { createWorkbenchOfflineImportBridge } from './browser-offline-import.ts'
import type { WorkbenchOfflineImportReceipt, WorkbenchOfflineImportPreflight } from './offline-import-contract.ts'
import { createWorkbenchDshNativeOfflineBundleBridgeV1, type DshNativePortableBundleExportV1, type DshNativePortableBundleImportOptionsV1, type DshNativePortableBundleOperationV1, type DshNativePortableBundlePreviewV1 } from './dsh-native-offline-bundle.ts'

export interface WorkbenchOfflinePackageServiceV1 {
  exportWorkbench(workbenchId: string): Promise<WorkbenchOfflinePackageV1>
  inspectImport(bytes: Uint8Array): Promise<{ pkg: WorkbenchOfflinePackageV1; preflight: WorkbenchOfflineImportPreflight }>
  importWorkbench(pkg: WorkbenchOfflinePackageV1): Promise<WorkbenchOfflineImportReceipt>
  imports(): Promise<WorkbenchOfflineImportReceipt[]>
  resumeImport(packageId: string): Promise<WorkbenchOfflineImportReceipt>
  /** Full DSH Manager Portable Bundle, when the current Host advertises it. */
  nativeBundleAvailable?(): boolean
  exportNativeBundle?(options?: { readonly distribution?: 'thin' | 'embedded' | 'multi-platform' }): Promise<DshNativePortableBundleExportV1>
  inspectNativeBundle?(bytes: Uint8Array): Promise<DshNativePortableBundlePreviewV1>
  importNativeBundle?(bytes: Uint8Array, options?: DshNativePortableBundleImportOptionsV1): Promise<DshNativePortableBundleOperationV1>
  getNativeBundleStatus?(operationId: string): Promise<DshNativePortableBundleOperationV1>
}

export function createWorkbenchOfflinePackageService(options: {
  settings: WorkbenchSettingsScope<WorkbenchSettingsV4>
  directory: WorkbenchDirectory
  editorCatalog: WorkbenchEditorCatalog
  runtime: WorkbenchCoreRuntimeV1
}): WorkbenchOfflinePackageServiceV1 {
  const bridge = createWorkbenchModuleCenterBridge()
  const nativeBundle = createWorkbenchDshNativeOfflineBundleBridgeV1()
  const importer = createWorkbenchOfflineImportBridge()
  const catalogOptions = { verifiedSeams: ['workbench.conversation.areas', 'client.ui-layout', 'client.ui-settings'], allowedPermissions: ['dsh.conversation.render'] }
  const clientReady = (row: WorkbenchOfflineImportReceipt): boolean => {
    const runtime = options.runtime.getSnapshot(), editors = options.editorCatalog.getSnapshot()
    const active = row.modules.every(module => runtime.activeModules.includes(module.moduleId)
      && runtime.registeredModules.some(candidate => candidate.moduleId === module.moduleId && candidate.version === module.version && candidate.artifactDigest === module.artifactDigest))
    if (!active) return false
    return row.modules.every(module => {
      const owned = new Set(editors.filter(editor => editor.extension?.moduleId === module.moduleId).map(editor => editor.id))
      return owned.size > 0 || module.moduleId === 'workbench.conversation-suite'
    })
  }
  const finish = (row: WorkbenchOfflineImportReceipt) => ['verifying', 'committing-layout'].includes(row.state) && clientReady(row)
    ? importer.complete(row.packageId, true) : Promise.resolve(row)
  return {
    nativeBundleAvailable: () => nativeBundle !== undefined,
    ...(nativeBundle === undefined ? {} : {
      exportNativeBundle: (bundleOptions?: { readonly distribution?: 'thin' | 'embedded' | 'multi-platform' }) => nativeBundle.exportPortableBundle(bundleOptions),
      inspectNativeBundle: (bytes: Uint8Array) => nativeBundle.inspectPortableBundle(bytes),
      importNativeBundle: (bytes: Uint8Array, importOptions?: DshNativePortableBundleImportOptionsV1) => nativeBundle.importPortableBundle(bytes, importOptions),
      getNativeBundleStatus: (operationId: string) => nativeBundle.getPortableBundleStatus(operationId),
    }),
    async inspectImport(bytes) {
      const pkg = await inspectWorkbenchOfflinePackage(bytes, catalogOptions)
      return { pkg, preflight: await importer.preflight(pkg.archive) }
    },
    async importWorkbench(pkg) {
      if (options.directory.flushBeforeLifecycleTransition !== undefined && !await options.directory.flushBeforeLifecycleTransition()) throw new Error('当前工作台尚未保存。')
      await inspectWorkbenchOfflinePackage(pkg.archive, catalogOptions)
      return finish(await importer.commit(pkg.archive))
    },
    async imports() {
      const rows = (await importer.list()).receipts
      const result: WorkbenchOfflineImportReceipt[] = []
      for (const row of rows) result.push(await finish(row))
      return result
    },
    async resumeImport(packageId) {
      const row = (await importer.list()).receipts.find(row => row.packageId === packageId)
      if (row === undefined) throw new Error('导入回执不存在。')
      if (['verifying', 'committing-layout'].includes(row.state) && !clientReady(row)) {
        const runtime = options.runtime.getSnapshot()
        if (runtime.state === 'degraded' || row.modules.every(module => runtime.activeModules.includes(module.moduleId))) return importer.complete(packageId, false)
        throw new Error('浏览器内页尚未完成加载，布局保持未提交。')
      }
      return finish(row)
    },
    async exportWorkbench(workbenchId) {
      if (options.directory.flushBeforeLifecycleTransition !== undefined && !await options.directory.flushBeforeLifecycleTransition()) throw new Error('工作台尚未保存，无法导出。')
      const snapshot = options.settings.getSnapshot()
      const record = snapshot.value?.workbenches[workbenchId]
      if (snapshot.status !== 'ready' || record === undefined) throw new Error('工作台配置不可用。')
      const captured = structuredClone(record)
      const runtime = options.runtime.getSnapshot()
      const facts = await bridge.facts()
      const activeIdentities = runtime.registeredModules.filter(module => runtime.activeModules.includes(module.moduleId))
      const identities = new Map(activeIdentities.map(module => [module.moduleId, module] as const))
      for (const module of facts.inventory ?? []) {
        if (module.activation !== 'active' || module.catalogIdentity === undefined) continue
        const identity = { moduleId: module.moduleId, version: module.catalogIdentity.version, artifactDigest: module.catalogIdentity.artifactDigest }
        identities.set(identity.moduleId, identity)
      }
      const editors = options.editorCatalog.getSnapshot()
      const editorModules = new Map<string, WorkbenchModuleIdentityV1>()
      for (const editor of editors) {
        const moduleId = editor.extension?.moduleId
        const identity = moduleId === undefined ? undefined : identities.get(moduleId)
          ?? (editor.provenance?.packageVersion !== undefined && editor.provenance.artifactDigest !== undefined
            ? { moduleId, version: editor.provenance.packageVersion, artifactDigest: editor.provenance.artifactDigest }
            : undefined)
        if (identity !== undefined) editorModules.set(editor.id, identity)
      }
      const catalogArchive = facts.catalog === 'available' ? await bridge.archive() : undefined
      const built = await buildWorkbenchOfflinePackage({ record: captured, editorModules, editors, catalogOptions,
        ...(catalogArchive === undefined ? {} : { catalogArchive }) })
      return inspectWorkbenchOfflinePackage(built.archive, catalogOptions)
    },
  }
}
