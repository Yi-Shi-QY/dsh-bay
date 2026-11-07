import { generateKeyPairSync, createPrivateKey, createPublicKey, sign, createHash } from 'node:crypto'
import { readFile, mkdir, writeFile, readdir } from 'node:fs/promises'
import { join, isAbsolute, resolve as resolvePath } from 'node:path'
import { credentialKey, type CredentialProvider } from '@deepseek-ai/dsh-credentials'
import { withFileLock } from '@deepseek-ai/dsh-atomic-write'
import type { ProfileContext } from '@deepseek-ai/dsh-app-boot'
import type SettingsProvider from '@deepseek-ai/dsh-settings'
import { buildWorkbenchPackageV4, inspectWorkbenchPackageV4, signingBytesV4, publisherKeyIdV4, type WorkbenchPackageDependencyV4, type WorkbenchPackageModeV4, type WorkbenchPackageManifestV4 } from './foundation/workbench-package-v4.ts'
import { validatePortableLayout, portableStateSafe, type PortableLayoutV2 } from './foundation/workbench-layout-package.ts'
import { distributionLayoutShape, sameDistributionArtifact, orderedDistributionDependencies } from './foundation/workbench-package-v4.ts'
import { workbenchExtensionContractFingerprint } from './workbench-extension-access.ts'
import { inspectDistributionManifest } from './host-distribution-artifacts.ts'
import {workbenchEditorStateFailureV1} from './workbench-editor-state.ts'
import type {WorkbenchEditorDeclarationV1} from './module-contract.ts'
import { areasOf, validateWorkbenchDocumentV3, type WorkbenchDocumentV3, type ModuleInstanceDocument } from './foundation/document-v3.ts'
import { canonicalJson } from './foundation/workbench-sharing.ts'
import { restorePortableWorkbenchContext } from './foundation/workbench-context-portability.ts'
import { createDistributionInstaller, DistributionInstallError, type DistributionNativeManager } from './host-distribution-installer.ts'
import { atomicDistributionJson, artifactHash, prepareDistributionArtifact, inspectDistributionArtifact, readRuntimeFiles, runtimeDigest } from './host-distribution-artifacts.ts'
import { CORE_PORTABLE_EDITORS, type DistributionImportStatus } from './distribution-contract.ts'
import { WORKBENCH_CORE_VERSION, WORKBENCH_DSH_GENERATION, WORKBENCH_PACKAGE_NAME, isWorkbenchCorePackageName } from './release-compatibility.ts'
import type { WorkbenchSettingsV4 } from './foundation/persistence.ts'
import { decodeWorkbenchSettingsV4 } from './foundation/persistence.ts'
import type { WorkbenchExtensionConsentV1 } from './workbench-extension-access.ts'

interface Transaction extends DistributionImportStatus {
  profileId: string; consentDigest?: string; approvedAt?: number
  previousEnabled: Record<string, boolean>; mutation?: { kind: 'install' | 'enable'; packageName: string }; pid?: number
  pendingStates?: PortableLayoutV2; settingsRevision?: number
  pendingChecks?: Record<string,string>
  pendingRecovery?: { pageIds:string[]; expectedHash:string; committedHash:string }
  cancelRequested?: boolean
  enabledByTransaction?: string[]
  selectionDigest?: string
}
export interface HostDistributionOptions {
  profile: ProfileContext; native: DistributionNativeManager; settings: SettingsProvider; credentials?: CredentialProvider | undefined
  resolve(name: string): string | undefined; peerAvailable(name: string, range: string): boolean
  fetchArtifact?(dependency: WorkbenchPackageDependencyV4): Promise<Uint8Array>
}
const txId = /^distribution-[a-f0-9-]{36}$/u
const hash = /^[a-f0-9]{64}$/u
const finished = new Set(['ready','needs-input','cancelled'])
export function createHostDistributionService(options: HostDistributionOptions) {
  const root = join(options.profile.dir,'.dsh-workbench','distribution-v4')
  const installer = createDistributionInstaller(options)
  const profileId = artifactHash(options.profile.dir)
  const inFlight = new Map<string, Promise<DistributionImportStatus>>()
  const aborts = new Map<string, AbortController>()
  const artifactPath = (digest: string) => { if (!hash.test(digest)) throw new Error('无效制品摘要。'); return join(root,'artifacts',`${digest}.tgz`) }
  const transactionPath = (id: string) => { if (!txId.test(id)) throw new Error('无效导入事务。'); return join(root,'transactions',`${id}.json`) }
  const load = async (id: string): Promise<Transaction> => {
    const row = JSON.parse(await readFile(transactionPath(id),'utf8')) as Transaction
    if (row.transactionId !== id || row.profileId !== profileId || !hash.test(row.archiveSha256)) throw new Error('事务不属于当前 Profile。')
    return row
  }
  const save = (row: Transaction) => atomicDistributionJson(transactionPath(row.transactionId),row)
  const stagedPath=(id:string,d:WorkbenchPackageDependencyV4)=>{transactionPath(id);return join(root,'staged',id,d.archiveSha256+'.tgz')}
  const publicRow = (row: Transaction): DistributionImportStatus => {
    const { profileId:_p, consentDigest:_c, approvedAt:_a, previousEnabled:_e, mutation:_m, pid:_pid, settingsRevision:_r, pendingStates:_s, pendingChecks:_checks, pendingRecovery:_recovery, cancelRequested:_cancel, enabledByTransaction:_enabled, selectionDigest:_selection, ...value } = row
    return structuredClone(value)
  }
  const storeArtifact = async (bytes: Uint8Array, dependency: WorkbenchPackageDependencyV4) => {
    const path = artifactPath(dependency.archiveSha256)
    await mkdir(join(root,'artifacts'),{ recursive:true })
    try { await writeFile(path,bytes,{ flag:'wx', mode:0o600 }) } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e }
    if (artifactHash(await readFile(path)) !== dependency.archiveSha256) throw new Error('制品存储内容已变化。')
    await atomicDistributionJson(join(root,'artifacts',`${dependency.archiveSha256}.json`),dependency)
  }
  const prepareArtifact=async(packageName:string,pkg:string)=>{
    const bundle=(await options.native.listBundles()).find(b=>b.name===packageName&&b.installed)
    if(!bundle)throw new Error('扩展不是当前 Profile 持久安装的 Bundle。')
    const source=bundle.source?.replace(/^file:/u,'')
    if(source?.endsWith('.tgz')){
      const bytes=new Uint8Array(await readFile(isAbsolute(source)?source:resolvePath(options.profile.dir,source)))
      const checked=await inspectDistributionArtifact(bytes,options.peerAvailable)
      if(checked.dependency.packageName!==packageName||runtimeDigest(await readRuntimeFiles(pkg,checked.dependency.runtimeFiles))!==checked.dependency.digest)throw new Error('原始安装包与实际运行内容不一致。')
      return {bytes,dependency:checked.dependency}
    }
    return prepareDistributionArtifact(pkg,options.peerAvailable)
  }
  const identities = async (): Promise<WorkbenchPackageDependencyV4[]> => {
    const files = await readdir(join(root,'artifacts')).catch(() => [] as string[])
    const bundles = await options.native.listBundles()
    const rows: WorkbenchPackageDependencyV4[] = []
    for (const name of files.filter(f => /^[a-f0-9]{64}[.]json$/u.test(f))) {
      try {
        const row = JSON.parse(await readFile(join(root,'artifacts',name),'utf8')) as WorkbenchPackageDependencyV4
        if (name !== row.archiveSha256 + '.json' || !bundles.some(b => b.name === row.packageName && b.version === row.version && b.installed && !b.readOnlyReason)) continue
        const pkg = options.resolve(row.packageName)
        if (!pkg) continue
        const checked = await inspectDistributionArtifact(await readFile(artifactPath(row.archiveSha256)), options.peerAvailable)
        if (!sameDistributionArtifact(checked.dependency,row)) continue
        if (runtimeDigest(await readRuntimeFiles(pkg,checked.dependency.runtimeFiles)) !== checked.dependency.digest) continue
        rows.push(checked.dependency)
      } catch { /* stale or malformed artifacts never attest a live package */ }
    }
    return rows
  }
  const publisher = async () => {
    if (!options.credentials) throw new Error('宿主没有可持久保存的凭据服务，无法签名导出。')
    const key = credentialKey('workbench-core',`publisher-${profileId.slice(0,24)}`)
    const result = await options.credentials.modifyRecord(key,async current => {
      if (current) return undefined
      const pair = generateKeyPairSync('ed25519')
      return { kind:'grant', payload:{ privateKey:pair.privateKey.export({ type:'pkcs8',format:'pem' }).toString() } }
    })
    const pem = result?.kind === 'grant' ? (result.payload as {privateKey?:string})?.privateKey : undefined
    if (!pem) throw new Error('发布者密钥无法读取；未创建临时签名身份。')
    const persisted=await options.credentials.readRecord(key)
    if(persisted?.kind!=='grant'||(persisted.payload as {privateKey?:string})?.privateKey!==pem)throw new Error('发布者密钥未能持久保存，无法签名导出。')
    const privateKey = createPrivateKey(pem), publicDer = createPublicKey(privateKey).export({ type:'spki',format:'der' })
    const publicKey = publicDer.subarray(-32).toString('base64'), keyId = await publisherKeyIdV4(publicKey)
    await atomicDistributionJson(join(root,'publisher.json'),{ credentialId:key, keyId, publicKey })
    return { publisher:{ displayName:'工作台发布者', keyId, publicKey }, sign:async (bytes:Uint8Array) => sign(null,bytes,privateKey).toString('base64') }
  }
  const approvedDigest = (row: Transaction) => artifactHash(canonicalJson({ profileId, archive:row.archiveSha256, transactionId:row.transactionId, dependencies:row.dependencies, permissions:row.dependencies.flatMap(d=>d.permissions) }))
  const pendingCheck=(page:ModuleInstanceDocument)=>artifactHash(canonicalJson({moduleInstanceId:page.moduleInstanceId,editorId:page.editorId,editorScope:page.editorScope,state:page.state,pendingDistribution:page.pendingDistribution}))
  const previewFor = async (row:Transaction) => {
    const bytes = await readFile(join(root,'packages',`${row.archiveSha256}.wbpkg`))
    const preview = await inspectWorkbenchPackageV4(bytes)
    if (preview.digest !== row.archiveSha256 || canonicalJson(preview.manifest.dependencies) !== canonicalJson(row.dependencies)) throw new Error('导入内容与事务不一致。')
    return preview
  }
  const preflight = async (row:Transaction): Promise<string[]> => {
    const blockers:string[]=[]
    for (const d of row.dependencies) { try { await installer.check(d) } catch(e) { blockers.push((e as Error).message) } }
    return blockers
  }
  const reconcileCommit=async(row:Transaction)=>{
    const descriptor=options.settings.describe().find(d=>d.ns==='workbench-layout')
    const record=decodeWorkbenchSettingsV4(descriptor?.value)?.workbenches[row.workbenchId]
    if(!record)return false
    if(record.offlineOrigin?.archiveSha256!==row.archiveSha256)throw new Error('导入目标已被其他工作台占用。')
    row.state=row.pendingPageIds?.length||areasOf(record.document.root).some(a=>a.moduleHistory.some(p=>p.pendingBinding))?'needs-input':'ready'
    await save(row);return true
  }
  const history = async () => {
    const names = await readdir(join(root,'transactions')).catch(()=>[] as string[])
    return (await Promise.all(names.filter(n=>txId.test(n.replace(/[.]json$/u,''))).map(async name=>publicRow(await load(name.slice(0,-5)))))).sort((a,b)=>b.createdAt-a.createdAt)
  }
  const serialized = (id:string, action:()=>Promise<DistributionImportStatus>) => {
    const prior=inFlight.get(id)
    const run= (async()=>{ await prior?.catch(()=>{}); await mkdir(root,{recursive:true}); return withFileLock(join(root,'operation-lock'),action) })().finally(()=>{if(inFlight.get(id)===run)inFlight.delete(id)})
    inFlight.set(id,run); return run
  }
  const rollback = async (row:Transaction) => {
    row.cancelRequested=true;await save(row)
    const errors:string[]=[]
    for(const d of orderedDistributionDependencies(row.dependencies).reverse()) {
      if(row.installed.includes(d.packageName) && await installer.reconcile(d,stagedPath(row.transactionId,d)) === 'absent'){
        row.installed=row.installed.filter(n=>n!==d.packageName);delete row.previousEnabled[d.packageName];await save(row);continue
      }
      if(row.enabledByTransaction?.includes(d.packageName)) try {
        if(await installer.enable(d,false,async digest=>{row.selectionDigest=digest;await save(row)},row.selectionDigest)){errors.push('扩展开关已恢复，请重启 DSH 后再次取消以完成清理：'+d.packageName);continue}
      } catch(e){ errors.push((e as Error).message);continue }
      if(row.installed.includes(d.packageName)) try { await installer.remove(d,stagedPath(row.transactionId,d)); row.installed=row.installed.filter(n=>n!==d.packageName);delete row.previousEnabled[d.packageName];await save(row) } catch(e){ errors.push((e as Error).message) }
      else { delete row.previousEnabled[d.packageName];await save(row) }
    }
    row.blockers=errors; row.state=errors.length?'recovery-required':'cancelled'; await save(row)
  }
  const reconcile=async(row:Transaction)=>{
    if(!row.mutation)return
    const d=row.dependencies.find(d=>d.packageName===row.mutation!.packageName)
    if(!d)throw new Error('中断事务的扩展身份无效。')
    if(row.mutation.kind==='install'){
      const result=await installer.reconcile(d,stagedPath(row.transactionId,d))
      if(result==='owned'&&!row.installed.includes(d.packageName)){row.installed.push(d.packageName);row.previousEnabled[d.packageName]=false}
    }else await installer.check(d)
    delete row.mutation;await save(row)
  }
  const resume = (id:string) => serialized(id,async()=>{
    const row=await load(id)
    if(finished.has(row.state))return publicRow(row)
    if(await reconcileCommit(row))return publicRow(row)
    if(row.consentDigest!==approvedDigest(row))throw new Error('请先确认本次包的来源、权限、安装和工作台授权。')
    try{await reconcile(row)}catch(e){row.state='recovery-required';row.blockers=[(e as Error).message];await save(row);return publicRow(row)}
    if(row.cancelRequested){await rollback(row);return publicRow(row)}
    if((await history()).some(t=>t.transactionId!==id && ['installing','restart-required','awaiting-restore','recovery-required'].includes(t.state)))throw new Error('请先完成或取消另一个导入事务。')
    const preview=await previewFor(row)
    row.blockers=await preflight(row); if(row.blockers.length){row.state='failed'; await save(row);return publicRow(row)}
    const abort=new AbortController();aborts.set(id,abort)
    try {
      row.state='installing'; await save(row)
      for(const d of orderedDistributionDependencies(row.dependencies)) {
        if(abort.signal.aborted)throw new Error('导入已取消。')
        // Cache even reused dependencies: later configuration restoration needs Host identity evidence.
        if(preview.manifest.mode==='offline-embedded')await storeArtifact(preview.files.find(f=>f.path===d.archivePath)!.content,d)
        else if(!(await identities()).some(i=>sameDistributionArtifact(i,d))){
          const bytes=await options.fetchArtifact?.(d)
          if(!bytes)throw new Error('当前宿主未接入此在线来源，请先配置接收方 Registry。')
          const checked=await inspectDistributionArtifact(bytes,options.peerAvailable)
          if(!sameDistributionArtifact(checked.dependency,d))throw new Error('下载的安装制品与签名依赖锁不一致。')
          await storeArtifact(bytes,d)
        }
        if(!row.installed.includes(d.packageName) && !row.reused.includes(d.packageName)) {
          const present=await installer.check(d)
          if(present.present){row.reused.push(d.packageName);row.previousEnabled[d.packageName]=present.enabled;await save(row)}
          else {
            const bytes= preview.manifest.mode==='offline-embedded' ? preview.files.find(f=>f.path===d.archivePath)!.content : new Uint8Array(await readFile(artifactPath(d.archiveSha256)))
            if(!bytes)throw new Error('当前宿主未接入此在线来源，请先配置接收方 Registry。')
            const checked=await inspectDistributionArtifact(bytes,options.peerAvailable)
            if(!sameDistributionArtifact(checked.dependency,d))throw new Error('下载的安装制品与签名依赖锁不一致。')
            await storeArtifact(bytes,d)
            await mkdir(join(root,'staged',id),{recursive:true});await writeFile(stagedPath(id,d),bytes,{mode:0o600})
            const receipt=await installer.install(d,stagedPath(id,d),async()=>{row.mutation={kind:'install',packageName:d.packageName};await save(row)},abort.signal)
            delete row.mutation
            if(receipt.reused)row.reused.push(d.packageName);else row.installed.push(d.packageName)
            row.previousEnabled[d.packageName]=receipt.previousEnabled;await save(row)
          }
        }
        await installer.verified(d)
      }
      let restart=false
      for(const d of orderedDistributionDependencies(row.dependencies)) {
        if(abort.signal.aborted)throw new Error('导入已取消。')
        if(!(await installer.check(d)).enabled){restart=await installer.enable(d,true,async digest=>{row.mutation={kind:'enable',packageName:d.packageName};row.selectionDigest=digest;row.enabledByTransaction=[...new Set([...row.enabledByTransaction??[],d.packageName])];await save(row)})||restart;delete row.mutation;await save(row)}
        if(!await installer.running(d))restart=true
      }
      row.state=restart?'restart-required':'awaiting-restore';row.layout=preview.layout;row.blockers=[];await save(row)
    }catch(e){
      if(e instanceof DistributionInstallError&&e.repaired)delete row.mutation
      const message=(e as Error).message
      if(!row.mutation){await rollback(row);if(row.state!=='recovery-required'&&!abort.signal.aborted){row.state='failed';delete row.cancelRequested;row.reused=[];row.previousEnabled={};row.blockers=[message]}}
      else{row.blockers=[message];row.state='recovery-required'}
      await save(row)
    }
    finally{aborts.delete(id)}
    return publicRow(row)
  })
  return { identities, history, resume,
    async preparePending(id:string){
      const row=await load(id),preview=await previewFor(row)
      if(row.state!=='needs-input'||!row.pendingPageIds?.length)throw new Error('没有待恢复配置。')
      for(const m of preview.layout.modules){
        if(!m.packageName||!m.digest)continue
        const pkg=options.resolve(m.packageName);if(!pkg)continue
        const prepared=await prepareArtifact(m.packageName,pkg)
        if(prepared.dependency.digest!==m.digest||prepared.dependency.version!==m.version)continue
        await storeArtifact(prepared.bytes,prepared.dependency)
      }
    },
    async export(input:{layout:PortableLayoutV2;mode:WorkbenchPackageModeV4;prepareArtifacts:boolean;derivedFrom?:WorkbenchPackageManifestV4['derivedFrom']}) {
      validatePortableLayout(input.layout)
      if(input.mode==='layout-only'){
        const layout=structuredClone(input.layout)
        for(const m of layout.modules){
          if(isWorkbenchCorePackageName(m.packageName)){m.packageName=WORKBENCH_PACKAGE_NAME;continue}
          const pkg=m.packageName&&options.resolve(m.packageName)
          if(!pkg){delete m.digest;continue}
          try{
            const p=inspectDistributionManifest(JSON.parse(await readFile(join(pkg,'package.json'),'utf8')))
            if(!p.dsh.workbench.editors?.some(e=>e.editorId===m.editorId&&e.scope===m.scope))throw new Error('identity')
            m.version=p.version;m.digest=runtimeDigest(await readRuntimeFiles(pkg,p.dsh.workbench.distribution!.runtimeFiles))
          }catch{delete m.digest;layout.warnings.push('部分扩展身份尚未核实；配置将保留为待恢复数据。')}
        }
        return buildWorkbenchPackageV4({layout,mode:input.mode,...input.derivedFrom?{derivedFrom:input.derivedFrom}:{}})
      }
      if(!['online-reference','offline-embedded'].includes(input.mode))throw new Error('不支持的导出模式。')
      if(input.layout.warnings.length)throw new Error(`完整包配置迁移尚未就绪：${input.layout.warnings.join('；')}`)
      const layout=structuredClone(input.layout), available=await identities(), dependencies:WorkbenchPackageDependencyV4[]=[], artifacts:{path:string;content:Uint8Array}[]=[]
      const blockers:string[]=[]
      const queue=[...new Set(layout.modules.filter(m=>!(CORE_PORTABLE_EDITORS as readonly string[]).includes(m.editorId)).map(m=>m.packageName))]
      for(const packageName of queue){
        try {
        if(!packageName)throw new Error('内页尚未声明可验证的提供包。')
        if(dependencies.some(d=>d.packageName===packageName))continue
        const resolved=options.resolve(packageName);if(!resolved)throw new Error(`原生宿主无法定位扩展：${packageName}`)
        let d=available.find(d=>d.packageName===packageName), bytes:Uint8Array
        if(!d){if(!input.prepareArtifacts)throw new Error(`请先准备分发制品：${packageName}`);const prepared=await prepareArtifact(packageName,resolved);d=prepared.dependency;bytes=prepared.bytes;await storeArtifact(bytes,d)}
        else bytes=await readFile(artifactPath(d.archiveSha256))
        if(input.mode==='offline-embedded'){if(d.exportPolicy!=='embed')throw new Error(`扩展仅允许在线引用：${packageName}`);d={...d,archivePath:`artifacts/${d.archiveSha256}.tgz`};artifacts.push({path:d.archivePath!,content:bytes})}
        else{if(!d.registryUrl)throw new Error(`扩展没有可分发的 HTTPS Registry：${packageName}`);d={...d};delete d.archivePath}
        dependencies.push(d);for(const required of d.requires)if(!queue.includes(required))queue.push(required)
        if(dependencies.length>32)throw new Error('扩展依赖数量超限。')
        } catch(error) { blockers.push((packageName??'未知扩展')+'：'+(error as Error).message) }
      }
      if(blockers.length)throw new Error('分发检查未通过：'+blockers.join('；')+'。请补齐运行制品、处理器或来源后重试，也可主动选择布局分享。')
      for(const m of layout.modules){
        if((CORE_PORTABLE_EDITORS as readonly string[]).includes(m.editorId)){m.packageName=WORKBENCH_PACKAGE_NAME;m.version=WORKBENCH_CORE_VERSION;delete m.digest;continue}
        const d=dependencies.find(d=>d.packageName===m.packageName && d.editorScopes.some(e=>e.editorId===m.editorId&&e.scope===m.scope))
        if(!d)throw new Error('内页声明与 Host 验证的扩展身份不一致。');m.version=d.version;m.digest=d.digest
      }
      return buildWorkbenchPackageV4({layout,mode:input.mode,dependencies,artifacts,...await publisher(),...(input.derivedFrom?{derivedFrom:input.derivedFrom}:{})})
    },
    async inspect(bytes:Uint8Array){
      const p=await inspectWorkbenchPackageV4(bytes)
      if((await history()).length>=1024)throw new Error('导入记录已达 1024 条限制，请先备份并整理 Host 分发记录。')
      await mkdir(join(root,'packages'),{recursive:true});await writeFile(join(root,'packages',`${p.digest}.wbpkg`),bytes,{mode:0o600})
      const row:Transaction={transactionId:`distribution-${crypto.randomUUID()}`,archiveSha256:p.digest,workbenchId:`workbench-${crypto.randomUUID()}`,name:p.layout.name,createdAt:Date.now(),mode:p.manifest.mode,
        ...(p.manifest.publisher?{keyId:p.manifest.publisher.keyId}:{}),state:'checked',dependencies:p.manifest.dependencies,installed:[],reused:[],blockers:[],profileId,previousEnabled:{},layout:p.layout}
      if(p.manifest.mode==='offline-embedded')for(const d of row.dependencies){const checked=await inspectDistributionArtifact(p.files.find(f=>f.path===d.archivePath)!.content,options.peerAvailable);if(!sameDistributionArtifact(checked.dependency,d))throw new Error('内嵌制品身份不一致。')}
      row.blockers=await preflight(row)
      row.plannedReuse=[]
      for(const d of row.dependencies){try{if((await installer.check(d)).present)row.plannedReuse.push(d.packageName)}catch{/* conflict is already listed */}}
      await save(row);return publicRow(row)
    },
    async consent(id:string,digest:string){
      await serialized(id,async()=>{
      const row=await load(id);if(row.archiveSha256!==digest||finished.has(row.state))throw new Error('授权与当前包不一致。')
      await previewFor(row);row.blockers=await preflight(row);if(row.blockers.length)throw new Error(row.blockers.join('；'))
      row.consentDigest=approvedDigest(row);row.approvedAt=Date.now();row.state='installing';await save(row);return publicRow(row)
      }); return resume(id)
    },
    async cancel(id:string){aborts.get(id)?.abort();await inFlight.get(id);return serialized(id,async()=>{const row=await load(id);if(finished.has(row.state)||await reconcileCommit(row))return publicRow(row);try{await reconcile(row);await rollback(row)}catch(e){row.state='recovery-required';row.blockers=[(e as Error).message];await save(row)}return publicRow(row)})},
    complete(id:string,document:WorkbenchDocumentV3,consents:Record<string,WorkbenchExtensionConsentV1>,pendingPageIds:string[]=[],_context?:import('./foundation/workbench-context-portability.ts').RestoredPortableWorkbenchContextV1){return serialized(id,async()=>{
      const row=await load(id);if(row.state==='ready'||row.state==='needs-input')return publicRow(row)
      if(await reconcileCommit(row))return publicRow(row)
      if(row.state!=='awaiting-restore'||row.consentDigest!==approvedDigest(row))throw new Error('请先完成安装和运行验证。')
      const preview=await previewFor(row)
      for(const d of row.dependencies)if(!await installer.running(d))throw new Error('扩展尚未在当前进程完成注册，请重启后继续。')
      if(!validateWorkbenchDocumentV3(document))throw new Error('恢复后的工作台结构无效。')
      const expected=areasOf(preview.layout.document.root), actual=areasOf(document.root)
      if(distributionLayoutShape(preview.layout.document)!==distributionLayoutShape(document))throw new Error('恢复结果改变了已签名的区域几何、标签顺序或选中内页。')
      const sources=expected.flatMap(a=>a.moduleHistory),targets=actual.flatMap(a=>a.moduleHistory)
      if(targets.some(p=>!portableStateSafe(p.state)))throw new Error('恢复配置包含敏感字段或无法迁移的本机数据。')
      if(!Array.isArray(pendingPageIds)||new Set(pendingPageIds).size!==pendingPageIds.length||pendingPageIds.some(id=>!sources.some(p=>p.moduleInstanceId===id))||(row.mode!=='layout-only'&&pendingPageIds.length))throw new Error('待恢复配置清单无效。')
      row.pendingPageIds=[...pendingPageIds];row.pendingTargets={};row.pendingChecks={}
      for(let i=0;i<sources.length;i++)if(pendingPageIds.includes(sources[i]!.moduleInstanceId)){
        const target=targets[i]!;target.state={};target.pendingDistribution=id
        row.pendingTargets[sources[i]!.moduleInstanceId]=target.moduleInstanceId
        row.pendingChecks[target.moduleInstanceId]=pendingCheck(target)
      }
      if(expected.length!==actual.length||expected.some((a,i)=>a.moduleHistory.length!==actual[i]!.moduleHistory.length||a.moduleHistory.some((p,j)=>p.editorId!==actual[i]!.moduleHistory[j]!.editorId||p.editorScope!==actual[i]!.moduleHistory[j]!.editorScope)))throw new Error('恢复结果改变了已签名内页清单。')
      for(const [key,c] of Object.entries(consents))if(!row.dependencies.some(d=>d.packageName===c.packageName&&d.moduleId===c.moduleId&&key===`${d.packageName}::${d.moduleId}`)||!/^[a-f0-9]{32}$/u.test(c.contractFingerprint)||c.allowed===false)throw new Error('工作台扩展授权与已确认依赖不一致。')
      if(row.dependencies.some(d=>d.editorScopes.length&&!Object.values(consents).some(c=>c.packageName===d.packageName&&c.moduleId===d.moduleId)))throw new Error('缺少工作台扩展使用授权。')
      for(const d of row.dependencies){
        const c=consents[d.packageName+'::'+d.moduleId];if(!d.editorScopes.length)continue
        const pkg=options.resolve(d.packageName);if(!pkg)throw new Error('无法验证已安装扩展声明。')
        const m=inspectDistributionManifest(JSON.parse(await readFile(join(pkg,'package.json'),'utf8'))),w=m.dsh.workbench
        const fingerprint=workbenchExtensionContractFingerprint({schemaVersion:1,moduleId:w.moduleId,apiVersion:1,editorIds:w.editorIds,coreCompatibility:w.coreCompatibility,dshGeneration:w.dshGeneration},w.editors!)
        for(const page of targets){const declaration=w.editors?.find(e=>e.editorId===page.editorId&&e.scope===page.editorScope);if(declaration&&workbenchEditorStateFailureV1(page.state,declaration as WorkbenchEditorDeclarationV1))throw new Error('恢复配置不符合已验证扩展的状态约束。')}
        if(!c||c.apiVersion!==1||c.allowed!==true||c.contractFingerprint!==fingerprint||canonicalJson([...c.editorIds].sort())!==canonicalJson([...w.editorIds].sort()))throw new Error('实际注册的扩展契约与已确认的包声明不一致。')
      }
      const descriptor=options.settings.describe().find(d=>d.ns==='workbench-layout');if(!descriptor)throw new Error('工作台设置服务未连接。')
      const value=descriptor.value===undefined?undefined:decodeWorkbenchSettingsV4(descriptor.value);if(descriptor.value!==undefined&&!value)throw new Error('已有设置无法解析，未覆盖诊断数据。')
      if(row.mode==='layout-only'){
        const available=await identities()
        for(let i=0;i<sources.length;i++){
          const source=sources[i]!,target=targets[i]!
          if(pendingPageIds.includes(source.moduleInstanceId)||(CORE_PORTABLE_EDITORS as readonly string[]).includes(source.editorId))continue
          const identity=preview.layout.modules.find(m=>m.editorId===source.editorId&&m.scope===source.editorScope)
          const dependency=available.find(d=>d.packageName===identity?.packageName&&d.version===identity?.version&&d.digest===identity?.digest&&d.editorScopes.some(e=>e.editorId===source.editorId&&e.scope===source.editorScope))
          const consent=dependency&&value?.extensionConsents?.[dependency.packageName+'::'+dependency.moduleId]
          if(!dependency||!consent?.allowed||!await installer.running(dependency))throw new Error('布局配置尚未匹配已安装并授权的扩展，请保留为待恢复内页。')
          const w=inspectDistributionManifest(JSON.parse(await readFile(join(options.resolve(dependency.packageName)!,'package.json'),'utf8'))).dsh.workbench
          const fingerprint=workbenchExtensionContractFingerprint({schemaVersion:1,moduleId:w.moduleId,apiVersion:1,editorIds:w.editorIds,coreCompatibility:w.coreCompatibility,dshGeneration:w.dshGeneration},w.editors!)
          if(consent.contractFingerprint!==fingerprint||workbenchEditorStateFailureV1(target.state,w.editors!.find(e=>e.editorId===source.editorId&&e.scope===source.editorScope) as WorkbenchEditorDeclarationV1))throw new Error('布局配置与已授权的扩展契约不一致。')
        }
      }
      const existing=value?.workbenches[row.workbenchId]
      if(existing&&existing.offlineOrigin?.archiveSha256!==row.archiveSha256)throw new Error('导入目标工作台已被其他操作占用。')
      if(!existing){
        let name=preview.layout.name;for(let n=2;Object.values(value?.workbenches??{}).some(w=>w.name===name);n++)name=`${preview.layout.name.slice(0,145)} ${n}`
        const sourceAreas=areasOf(preview.layout.document.root), targetAreas=areasOf(document.root)
        const areaIds=new Map(sourceAreas.map((area,index)=>[area.areaId,targetAreas[index]?.areaId]).filter((entry):entry is [string,string] => entry[1] !== undefined))
        const restoredContext=preview.layout.context === undefined ? undefined : restorePortableWorkbenchContext(preview.layout.context,areaIds)
        const record={workbenchId:row.workbenchId,name,description:preview.layout.description,tags:preview.layout.tags,document,
          ...(preview.layout.modelPreference?.provider === undefined || preview.layout.modelPreference.model === undefined ? {} : { workbenchAi: {
            provider: preview.layout.modelPreference.provider,
            model: preview.layout.modelPreference.model,
            ...(preview.layout.modelPreference.reasoningEffort === undefined ? {} : { reasoningEffort: preview.layout.modelPreference.reasoningEffort }),
          } }),
          ...(restoredContext === undefined ? {} : { context: restoredContext.context, areaContexts: restoredContext.areaContexts, areaMetadata: restoredContext.areaMetadata }),
          createdAt:row.createdAt,updatedAt:Date.now(),offlineOrigin:{schemaVersion:1 as const,packageId:row.archiveSha256,archiveSha256:row.archiveSha256}}
        const packageOrigin={packageId:preview.manifest.packageId,version:preview.manifest.version,archiveSha256:row.archiveSha256,completeness:row.mode==='layout-only'?'layout-only' as const:row.mode==='offline-embedded'?'complete-offline' as const:'complete-online' as const,dependencies:row.dependencies.map(d=>({portableId:d.moduleId,version:d.version,digest:d.digest,kind:'static' as const,sourcePolicy:'binary-only' as const,exportPolicy:d.exportPolicy,editorIds:d.editorScopes.map(e=>e.editorId),editorScopes:d.editorScopes,permissions:d.permissions,requiredBy:[],packageName:d.packageName,...d.registryUrl?{registryUrl:d.registryUrl}:{},integrity:d.integrity}))}
        const next:WorkbenchSettingsV4={...value??{version:4,activeWorkbenchId:row.workbenchId,openWorkbenchIds:[],layoutTemplates:{},invalidWorkbenches:{},sessionMarkers:{}},workbenches:{...value?.workbenches,[row.workbenchId]:{...record,packageOrigin}},extensionConsents:{...value?.extensionConsents,...consents}}
        // Persist target mapping before CAS; retries can reconcile a committed document.
        await save(row)
        await options.settings.mutate('workbench-layout',[{op:'set',path:[],value:next}],descriptor.revision)
      }
      row.state=pendingPageIds.length||actual.some(a=>a.moduleHistory.some(p=>p.pendingBinding))?'needs-input':'ready';row.blockers=[];await save(row);return publicRow(row)
    })},
    restorePending(id:string,document:WorkbenchDocumentV3,expectedDocument:WorkbenchDocumentV3,restoredPageIds:string[]){return serialized(id,async()=>{
      const row=await load(id)
      const descriptor=options.settings.describe().find(d=>d.ns==='workbench-layout')
      const value=decodeWorkbenchSettingsV4(descriptor?.value),workbench=value?.workbenches[row.workbenchId]
      if(row.pendingRecovery&&workbench){
        const currentHash=artifactHash(canonicalJson(workbench.document))
        if(currentHash===row.pendingRecovery.committedHash){
          row.pendingPageIds=(row.pendingPageIds??[]).filter(p=>!row.pendingRecovery!.pageIds.includes(p))
          row.state=row.pendingPageIds?.length||areasOf(workbench.document.root).some(a=>a.moduleHistory.some(p=>p.pendingBinding))?'needs-input':'ready'
          delete row.pendingRecovery;await save(row);return publicRow(row)
        }
        if(currentHash!==row.pendingRecovery.expectedHash)throw new Error('配置恢复曾中断且工作台已变化，请检查导入记录。')
        delete row.pendingRecovery;await save(row)
      }
      if(row.state==='ready')return publicRow(row)
      if(row.state!=='needs-input'||!row.pendingPageIds?.length||!Array.isArray(restoredPageIds)||!restoredPageIds.length||restoredPageIds.some(p=>!row.pendingPageIds!.includes(p)))throw new Error('没有可继续恢复的配置。')
      if(!descriptor||!value||!workbench||canonicalJson(workbench.document)!==canonicalJson(expectedDocument))throw new Error('工作台已在另一窗口变化，请刷新后恢复配置。')
      const preview=await previewFor(row),available=await identities(),source=areasOf(preview.layout.document.root).flatMap(a=>a.moduleHistory)
      const next=structuredClone(workbench.document),pages=areasOf(next.root).flatMap(a=>a.moduleHistory),proposed=areasOf(document.root).flatMap(a=>a.moduleHistory)
      for(const sourceId of restoredPageIds){
        const original=source.find(p=>p.moduleInstanceId===sourceId)!,target=pages.find(p=>p.moduleInstanceId===row.pendingTargets?.[sourceId]),result=proposed.find(p=>p.moduleInstanceId===target?.moduleInstanceId)
        if(!target||!result||pendingCheck(target)!==row.pendingChecks?.[target.moduleInstanceId])throw new Error('占位内页已被修改，未覆盖用户的新配置。')
        const identity=preview.layout.modules.find(m=>m.editorId===original.editorId&&m.scope===original.editorScope)
        const d=available.find(d=>d.packageName===identity?.packageName&&d.version===identity?.version&&d.digest===identity?.digest&&d.editorScopes.some(e=>e.editorId===original.editorId&&e.scope===original.editorScope))
        const consent=d&&value.extensionConsents?.[d.packageName+'::'+d.moduleId]
        if(!d||!consent?.allowed||!await installer.running(d))throw new Error('必须先安装并授权身份完全匹配的扩展。')
        const pkg=options.resolve(d.packageName)!,w=inspectDistributionManifest(JSON.parse(await readFile(join(pkg,'package.json'),'utf8'))).dsh.workbench
        if(consent.contractFingerprint!==workbenchExtensionContractFingerprint({schemaVersion:1,moduleId:w.moduleId,apiVersion:1,editorIds:w.editorIds,coreCompatibility:w.coreCompatibility,dshGeneration:w.dshGeneration},w.editors!))throw new Error('扩展授权已失效，请重新确认。')
        if(!portableStateSafe(result.state)||workbenchEditorStateFailureV1(result.state,w.editors!.find(e=>e.editorId===original.editorId&&e.scope===original.editorScope) as WorkbenchEditorDeclarationV1))throw new Error('恢复配置不符合扩展声明。')
        target.state=result.state;delete target.pendingDistribution
      }
      if(!validateWorkbenchDocumentV3(next))throw new Error('恢复配置结构无效。')
      row.pendingRecovery={pageIds:[...restoredPageIds],expectedHash:artifactHash(canonicalJson(workbench.document)),committedHash:artifactHash(canonicalJson(next))};await save(row)
      await options.settings.mutate('workbench-layout',[{op:'set',path:[],value:{...value,workbenches:{...value.workbenches,[row.workbenchId]:{...workbench,document:next,updatedAt:Date.now()}}}}],descriptor.revision)
      delete row.pendingRecovery
      row.pendingPageIds=row.pendingPageIds.filter(p=>!restoredPageIds.includes(p));row.state=row.pendingPageIds.length||pages.some(p=>p.pendingBinding)?'needs-input':'ready';await save(row);return publicRow(row)
    })},
  }
}
