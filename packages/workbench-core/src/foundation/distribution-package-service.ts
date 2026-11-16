import type { PortableAgentAssemblyV1 } from '../agent-assembly-model.ts'
import { CORE_PORTABLE_EDITORS, type DistributionClientV4, type DistributionImportStatus, type DistributionImportDestination } from '../distribution-contract.ts'
import { projectLayoutPackage, restoreLayoutPackage, inspectLayoutPackage, type PortableLayoutV2 } from './workbench-layout-package.ts'
import { inspectWorkbenchPackageV4, buildWorkbenchPackageV4, type WorkbenchPackageModeV4 } from './workbench-package-v4.ts'
import type { WorkbenchEditorCatalog, WorkbenchEditorCatalogRow } from './catalog.ts'
import type { WorkbenchDirectory } from './frame-settings-adapter.ts'
import type { WorkbenchSettingsV4 } from './persistence.ts'
import type { WorkbenchSettingsScope } from '../client/workbench-settings-contracts.ts'
import type { WorkbenchExtensionRegistryV1 } from '../client/workbench-extension-registry.ts'
import type { WorkbenchExtensionConsentV1 } from '../workbench-extension-access.ts'
import type { SessionBindingV1 } from './model.ts'
import { WORKBENCH_CORE_VERSION, WORKBENCH_PACKAGE_NAME } from '../release-compatibility.ts'
import { areasOf } from './document-v3.ts'
import type { WorkbenchPackageDependencyV4 } from './workbench-package-v4.ts'

export function createDistributionPackageService(options:{client:DistributionClientV4;settings:WorkbenchSettingsScope<WorkbenchSettingsV4>;directory:WorkbenchDirectory;editors:WorkbenchEditorCatalog;rawEditors:WorkbenchEditorCatalog;registry:WorkbenchExtensionRegistryV1;canExport(id:string):boolean;canImport():boolean;agents?:(workbenchId:string)=>Promise<PortableAgentAssemblyV1|undefined>}) {
  const core=(row:WorkbenchEditorCatalogRow):WorkbenchEditorCatalogRow=>{
    if(!(CORE_PORTABLE_EDITORS as readonly string[]).includes(row.id))return row
    return {...row,distribution:{version:1,portableId:'workbench.core',packageVersion:WORKBENCH_CORE_VERSION,exportPolicy:'reference',sourcePolicy:'binary-only',provides:{editorIds:[row.id]},requires:[],permissions:[],packageName:WORKBENCH_PACKAGE_NAME},
      provenance:{version:1,runtimeKind:'static',fiberName:WORKBENCH_PACKAGE_NAME,packageName:WORKBENCH_PACKAGE_NAME,packageVersion:WORKBENCH_CORE_VERSION},
      declaration:{...row.declaration??{editorId:row.id,label:row.label,scope:row.scope,requiredBinding:row.scope==='session'?'session':'none',runtime:{background:'pause',collapsed:'dispose',reacquire:'on-visible'}},state:{schemaVersion:1,maxBytes:4096,share:'portable',restore:'if-valid'}},
      // Native resources are rebound locally. Their runtime/session payload never travels.
      portability:{version:1,exportState:()=>({schemaVersion:1}),importState:()=>({schemaVersion:1})}}
  }
  const identities=async():Promise<readonly WorkbenchPackageDependencyV4[]>=>{
    try{return await options.client.artifactIdentities()}catch{return []}
  }
  const ownerFor=(row:WorkbenchEditorCatalogRow)=>options.registry.getSnapshot().extensions.find(e=>e.moduleId===row.extension?.moduleId
    && e.editorIds.includes(row.id))
  /**
   * Slot metadata and Host artifact metadata arrive through separate seams.
   * Project one editor through both seams before it reaches a portable layout.
   * A live `distribution` declaration remains authoritative, while a verified
   * Host identity fills the common case where Slot registration only carries
   * the extension contract.
   */
  const enrich=(row:WorkbenchEditorCatalogRow, available:readonly WorkbenchPackageDependencyV4[]):WorkbenchEditorCatalogRow=>{
    const c=core(row);if(c!==row)return c
    const owner=ownerFor(row)
    const identity=available.find(d=>d.editorScopes.some(e=>e.editorId===row.id&&e.scope===row.scope)
      && owner!==undefined && d.packageName===owner.packageName && d.moduleId===owner.moduleId)
    const packageName=row.distribution?.packageName ?? identity?.packageName ?? owner?.packageName ?? row.provenance?.packageName
    const packageVersion=row.distribution?.packageVersion ?? identity?.version ?? owner?.packageVersion ?? row.provenance?.packageVersion
    const digest=identity?.digest ?? row.provenance?.artifactDigest ?? row.provenance?.dynamic?.artifactDigest
    if(packageName===undefined && packageVersion===undefined && digest===undefined)return row
    const provenance={
      version:1 as const,
      runtimeKind:row.provenance?.runtimeKind ?? 'static' as const,
      fiberName:row.provenance?.fiberName ?? row.pluginId ?? packageName ?? row.id,
      ...(row.provenance?.dynamic===undefined?{}:{dynamic:row.provenance.dynamic}),
      ...(packageName===undefined?{}:{packageName}),
      ...(packageVersion===undefined?{}:{packageVersion}),
      ...(digest===undefined?{}:{artifactDigest:digest}),
    }
    const distribution=row.distribution===undefined && packageName!==undefined
      ? {
          version:1 as const,
          portableId:identity?.moduleId ?? owner?.moduleId ?? row.extension?.moduleId ?? `${row.scope}:${row.id}`,
          packageVersion:packageVersion ?? '0.0.0',
          ...(identity?.digest===undefined?{}:{artifactDigest:identity.digest}),
          exportPolicy:identity?.exportPolicy === 'embed' ? 'embed' as const : 'reference' as const,
          sourcePolicy:'binary-only' as const,
          provides:{editorIds:[row.id]}, requires:[], permissions:[],
          packageName,
          ...(identity?.registryUrl===undefined?{}:{registryUrl:identity.registryUrl}),
          ...(identity?.integrity===undefined?{}:{integrity:identity.integrity}),
        }
      : row.distribution===undefined ? undefined : {
          ...row.distribution,
          ...(packageName===undefined?{}:{packageName}),
          ...(packageVersion===undefined?{}:{packageVersion}),
          ...(identity?.digest===undefined || row.distribution.artifactDigest!==undefined?{}:{artifactDigest:identity.digest}),
        }
    return {...row,provenance, ...(distribution===undefined?{}:{distribution})}
  }
  const catalog=async(raw=false)=>{
    const available=await identities()
    return(raw?options.rawEditors:options.editors).getSnapshot().map(row=>enrich(row,available))
  }
  const restore=async(row:DistributionImportStatus,bindings:Readonly<Record<string,SessionBindingV1>>={})=>{
    if(row.state!=='awaiting-restore'||!row.layout)return row
    await options.registry.refresh()
    const editors=await catalog(true), consents:Record<string,WorkbenchExtensionConsentV1>={}
    for(const d of row.dependencies){
      if(!d.editorScopes.length)continue
      const access=options.registry.getSnapshot().extensions.find(e=>e.packageName===d.packageName&&e.moduleId===d.moduleId)
      if(!access?.contractFingerprint||!['ready','not-allowed','confirmation-required'].includes(access.availability))throw new Error(`扩展内页尚未注册或兼容：${d.packageName}。请重启 DSH 后继续。`)
      consents[`${d.packageName}::${d.moduleId}`]={packageName:d.packageName,moduleId:d.moduleId,apiVersion:1,editorIds:d.editorScopes.map(e=>e.editorId),contractFingerprint:access.contractFingerprint,allowedAt:Date.now(),allowed:true}
    }
    const restored=restoreLayoutPackage(row.layout,row.mode==='layout-only'?await catalog():editors,options.directory.completeRequest ? {} : bindings,row.mode!=='layout-only',true)
    return options.client.complete(row.transactionId,restored.document,consents,restored.pendingPageIds,restored.context,restored.orchestration)
  }
  return {
    async prepareExport(id:string,mode:WorkbenchPackageModeV4,prepareArtifacts=false,includeBackground=false){
      if(!options.canExport(id))throw new Error('请先收回工作台再导出。')
      if(!await options.directory.flushBeforeLifecycleTransition?.())throw new Error('布局尚未保存，导出停止。')
      const record=options.settings.getSnapshot().value?.workbenches[id];if(!record||!options.canExport(id))throw new Error('工作台不可导出。')
      await options.registry.refresh()
      const available=await identities()
      const editors=options.editors.getSnapshot().map(row=>enrich(row,available))
      const layout=projectLayoutPackage(record,editors)
      // Templates carry reusable configuration, never work progress or local model choices.
      delete layout.orchestration
      delete layout.modelPreference
      const agents = await options.agents?.(id)
      if (agents && agents.definitions.length) layout.agents = agents
      if (!includeBackground) delete layout.context
      else if (layout.context) layout.context.areas = {}
      layout.schemaVersion = layout.context === undefined ? 2 : 3
      if(mode!=='layout-only'&&editors.some(e=>layout.modules.some(m=>m.editorId===e.id&&m.scope===e.scope)&&(!e.portability?.importState||!e.portability.exportState)))throw new Error('部分内页缺少配置迁移处理器，无法生成带扩展的模板包。')
      if(areasOf(record.document.root).some(a=>a.moduleHistory.some(p=>p.pendingDistribution)))throw new Error('尚有配置等待恢复，请先从导入记录完成恢复，再重新导出。')
      const bytes=await options.client.prepare({layout,mode,prepareArtifacts,...record.packageOrigin?{derivedFrom:{packageId:record.packageOrigin.packageId,version:record.packageOrigin.version,archiveSha256:record.packageOrigin.archiveSha256}}:{}})
      return {bytes,preview:await inspectWorkbenchPackageV4(bytes)}
    },
    async inspect(bytes:Uint8Array){if(!options.canImport())throw new Error('请在接收方 DSH 桌面导入模板包。');return options.client.inspect(bytes)},
    async inspectLegacy(bytes:Uint8Array){
      throw new Error('当前版本不支持此旧工作台格式，原文件未修改。请使用完整工作台包。')
    },
    async confirm(row:DistributionImportStatus,bindings:Readonly<Record<string,SessionBindingV1>>={},destination?:DistributionImportDestination){if(!options.canImport())throw new Error('只能在接收方桌面确认。');return restore(await options.client.consent(row.transactionId,row.archiveSha256,destination),bindings)},
    async resume(id:string,bindings:Readonly<Record<string,SessionBindingV1>>={}){if(!options.canImport())throw new Error('请在接收方桌面继续。');return restore(await options.client.resume(id),bindings)},
    cancel:(id:string)=>options.client.cancel(id),history:()=>options.client.history(),
    async restorePending(row:DistributionImportStatus){
      if(!options.canImport()||!row.layout||!row.pendingPageIds?.length)throw new Error('没有待恢复配置。')
      if(!options.canExport(row.workbenchId))throw new Error('请先收回工作台，再恢复内页配置。')
      await options.client.preparePending(row.transactionId)
      await options.registry.refresh()
      const current=options.settings.getSnapshot().value?.workbenches[row.workbenchId]?.document
      if(!current)throw new Error('导入的工作台已经不存在。')
      const result=restoreLayoutPackage(row.layout,await catalog(),{},false,true)
      const sources=areasOf(row.layout.document.root).flatMap(a=>a.moduleHistory),restored=areasOf(result.document.root).flatMap(a=>a.moduleHistory)
      const document=structuredClone(current),pages=areasOf(document.root).flatMap(a=>a.moduleHistory),done:string[]=[]
      for(const id of row.pendingPageIds){
        if(result.pendingPageIds.includes(id))continue
        const index=sources.findIndex(p=>p.moduleInstanceId===id),page=pages.find(p=>p.moduleInstanceId===row.pendingTargets?.[id])
        if(page&&index>=0){page.state=restored[index]!.state;done.push(id)}
      }
      if(!done.length)throw new Error('请先安装、准备运行制品并授权包名、版本、内容完全匹配的扩展。')
      return options.client.restorePending(row.transactionId,document,current,done)
    },
  }
}
export type DistributionPackageService = ReturnType<typeof createDistributionPackageService>
