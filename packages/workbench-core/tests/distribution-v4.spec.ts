import { describe, it, expect } from 'vitest'
import { generateKeyPairSync, sign } from 'node:crypto'
import { mkdtemp, cp, readFile, writeFile, rm, mkdir, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { existsSync } from 'node:fs'
import { projectLayoutPackage,restoreLayoutPackage } from '../src/foundation/workbench-layout-package.ts'
import { buildWorkbenchPackageV4, inspectWorkbenchPackageV4, publisherKeyIdV4 } from '../src/foundation/workbench-package-v4.ts'
import { decodeDeterministicZip, encodeDeterministicZip } from '../src/foundation/workbench-sharing.ts'
import { prepareDistributionArtifact, inspectDistributionManifest, artifactHash } from '../src/host-distribution-artifacts.ts'
import { createHostDistributionService } from '../src/host-distribution-service.ts'
import { HostWorkbenchDirectory } from '../src/host-workbench-directory.ts'
import { settingsFixture } from './settings-fixtures.ts'
import { WORKBENCH_CORE_VERSION } from '../src/release-compatibility.ts'
import {areasOf} from '../src/foundation/document-v3.ts'
import { workbenchExtensionContractFingerprint } from '../src/workbench-extension-access.ts'
import { createAreaContext, createWorkbenchContext } from '../src/foundation/workbench-context.ts'

const template=join(import.meta.dirname,'../presets/workbench-creator/skills/workbench-extension-development/templates/workbench-editor')
const sessionTemplate=join(import.meta.dirname,'../presets/workbench-creator/skills/workbench-extension-development/templates/workbench-editor-variants/session-client.js')
const layout=()=>{const r=structuredClone(settingsFixture().workbenches.a!);if(r.document.root.kind!=='area')throw new Error('fixture');r.document.root.moduleHistory=[];delete r.document.root.activeModuleInstanceId;return projectLayoutPackage(r,[])}
async function signer(){const pair=generateKeyPairSync('ed25519');const publicKey=pair.publicKey.export({format:'der',type:'spki'}).subarray(-32).toString('base64');return{publisher:{displayName:'测试房主',publicKey,keyId:await publisherKeyIdV4(publicKey)},sign:async(bytes:Uint8Array)=>sign(null,bytes,pair.privateKey).toString('base64')}}

describe('17.2 signed package contract',()=>{
  it('carries Workbench and Area Context through V4 package files and rejects stale projections',async()=>{
    const record=structuredClone(settingsFixture().workbenches.a!)
    const workbenchContext=createWorkbenchContext();workbenchContext.human.goal='V4 工作台目标';record.context=workbenchContext
    const areaContext=createAreaContext();areaContext.human.objective='V4 区域目标';record.areaContexts={'area-a':areaContext}
    const projected=projectLayoutPackage(record,[])
    const bytes=await buildWorkbenchPackageV4({layout:projected,mode:'layout-only'})
    const preview=await inspectWorkbenchPackageV4(bytes)
    expect(preview.manifest.compatibility.portableLayout).toBe(3)
    expect(preview.files.map(file=>file.path)).toEqual(expect.arrayContaining(['context.json','context/工作台整体背景说明.md','context/areas/area-1-区域说明.md']))
    const files=decodeDeterministicZip(bytes).map(file=>file.path==='context/工作台整体背景说明.md'?{...file,content:new TextEncoder().encode('stale')}:file)
    await expect(inspectWorkbenchPackageV4(encodeDeterministicZip(files))).rejects.toThrow()
  })
  it('round trips three modes and keeps the layout payload',async()=>{
    for(const mode of ['layout-only','online-reference','offline-embedded'] as const){
      const bytes=await buildWorkbenchPackageV4({layout:layout(),mode,...mode==='layout-only'?{}:await signer()})
      const p=await inspectWorkbenchPackageV4(bytes);expect(p.manifest.mode).toBe(mode);expect(p.layout.retention).toBe('all-retained-tabs');expect(p.layout.name).toBe(layout().name)
    }
  })
  it('accepts V4 archives and Core pages from the previous beta candidate',async()=>{
    const l=layout()
    if(l.document.root.kind!=='area')throw Error('fixture')
    l.document.root.moduleHistory=[{moduleInstanceId:'guide-page',editorId:'workbench.guide',editorScope:'root',state:{schemaVersion:1},lastKnownTitle:'Guide'}]
    l.document.root.activeModuleInstanceId='guide-page'
    l.modules=[{editorId:'workbench.guide',scope:'root',packageName:'dsh-bay',version:'0.1.0-beta.0'}]
    const current=await buildWorkbenchPackageV4({layout:l,mode:'layout-only'})
    const files=decodeDeterministicZip(current).map(file=>{
      if(file.path!=='manifest.json')return file
      const manifest=JSON.parse(new TextDecoder().decode(file.content))
      manifest.version='0.1.0-beta.0'
      manifest.compatibility.core='0.1.0-beta.0'
      return{...file,content:new TextEncoder().encode(JSON.stringify(manifest))}
    })
    const preview=await inspectWorkbenchPackageV4(encodeDeterministicZip(files))
    expect(preview.manifest.compatibility.core).toBe('0.1.0-beta.0')
    expect(preview.layout.modules[0]?.version).toBe('0.1.0-beta.0')
  })
  it('imports RC1 V4 data packages without relaxing embedded extension generation checks',async()=>{
    const current=await buildWorkbenchPackageV4({layout:layout(),mode:'layout-only'})
    const files=decodeDeterministicZip(current).map(file=>{
      if(file.path!=='manifest.json')return file
      const manifest=JSON.parse(new TextDecoder().decode(file.content))
      manifest.compatibility.dsh='0.2.2-rc.1'
      return{...file,content:new TextEncoder().encode(JSON.stringify(manifest))}
    })
    expect((await inspectWorkbenchPackageV4(encodeDeterministicZip(files))).manifest.compatibility.dsh).toBe('0.2.2-rc.1')
  })
  it('rejects payload tampering, key substitution and undeclared files',async()=>{
    const original=await buildWorkbenchPackageV4({layout:layout(),mode:'offline-embedded',...await signer()})
    const files=decodeDeterministicZip(original)
    for(const kind of ['payload','key','extra']){
      const changed=files.map(f=>({path:f.path,content:new Uint8Array(f.content)}))
      if(kind==='extra')changed.push({path:'extra.js',content:new Uint8Array([1])})
      else if(kind==='payload')changed.find(f=>f.path==='workbench.json')!.content=new TextEncoder().encode('{}')
      else{const m=changed.find(f=>f.path==='manifest.json')!;const v=JSON.parse(new TextDecoder().decode(m.content));v.publisher.publicKey=(await signer()).publisher.publicKey;m.content=new TextEncoder().encode(JSON.stringify(v))}
      await expect(inspectWorkbenchPackageV4(encodeDeterministicZip(changed))).rejects.toThrow()
    }
  })
  it.each(['dsh-bay','@dsh-workbench/core'])('does not permit an unknown editor to claim %s identity',async(packageName)=>{
    const l=layout();l.modules=[{editorId:'unknown',scope:'root',packageName,version:WORKBENCH_CORE_VERSION}]
    await expect(buildWorkbenchPackageV4({layout:l,mode:'offline-embedded',...await signer()})).rejects.toThrow('伪装')
  })
  it.each(['dsh-bay','@dsh-workbench/core'])('verifies and restores signed Core pages from %s archives',async(packageName)=>{
    const l=layout()
    if(l.document.root.kind!=='area')throw Error('fixture')
    l.document.root.moduleHistory=[{moduleInstanceId:'guide-page',editorId:'workbench.guide',editorScope:'root',state:{schemaVersion:1},lastKnownTitle:'Guide'}]
    l.document.root.activeModuleInstanceId='guide-page'
    l.modules=[{editorId:'workbench.guide',scope:'root',packageName,version:WORKBENCH_CORE_VERSION}]
    const bytes=await buildWorkbenchPackageV4({layout:l,mode:'offline-embedded',...await signer()})
    const preview=await inspectWorkbenchPackageV4(bytes)
    expect(preview.layout.modules[0]?.packageName).toBe(packageName)
    expect(preview.signature).toBeDefined()
    const editor:any={id:'workbench.guide',label:'Guide',scope:'root',
      provenance:{version:1,runtimeKind:'static',fiberName:'dsh-bay',packageName:'dsh-bay',packageVersion:WORKBENCH_CORE_VERSION},
      declaration:{editorId:'workbench.guide',scope:'root',label:'Guide',requiredBinding:'none',state:{schemaVersion:1,maxBytes:4096,share:'portable',restore:'if-valid'},runtime:{background:'pause',collapsed:'dispose',reacquire:'on-visible'}},
      portability:{version:1,importState:()=>({schemaVersion:1})}}
    const restored=restoreLayoutPackage(preview.layout,[editor],{},true,true)
    expect(restored.warnings).toEqual([])
    expect(restored.pendingPageIds).toEqual([])
    expect(areasOf(restored.document.root)[0]!.moduleHistory[0]!.state).toEqual({schemaVersion:1})
  })
})

describe('explicit runtime artifact preparation',()=>{
  it('prepares the Session editor variant as an embeddable offline artifact',async()=>{
    const dir=await mkdtemp(join(tmpdir(),'wb180-session-artifact-'))
    try{
      await cp(template,dir,{recursive:true})
      await writeFile(join(dir,'client.js'),await readFile(sessionTemplate))
      const manifest=JSON.parse(await readFile(join(dir,'package.json'),'utf8'))
      manifest.dsh.workbench.scope='session'
      manifest.dsh.workbench.editors[0].scope='session'
      await writeFile(join(dir,'package.json'),JSON.stringify(manifest))
      const prepared=await prepareDistributionArtifact(dir,(name,version)=>(name==='react'&&version==='18.3.1')||(name==='@deepseek-ai/dsh-client-ui-slots'&&version==='0.2.2-rc.2'))
      expect(prepared.dependency.editorScopes).toEqual([{editorId:'workbench.example',scope:'session'}])
      expect(prepared.dependency.exportPolicy).toBe('embed')
      expect(prepared.dependency.runtimeFiles).toEqual(expect.arrayContaining(['package.json','client.js','cordis.patch.yml','LICENSE']))
    }finally{await rm(dir,{recursive:true,force:true})}
  })
  it('supports the real Creator root-entry template and exact runtime file set',async()=>{
    const p=await prepareDistributionArtifact(template,(name,version)=>(name==='react'&&version==='18.3.1')||(name==='@deepseek-ai/dsh-client-ui-slots'&&version==='0.2.2-rc.2'))
    expect(p.dependency.packageName).toBe('@local/workbench-editor-example')
    expect(p.dependency.archiveSha256).toBe(artifactHash(p.bytes))
    expect(p.dependency.runtimeFiles).toContain('client.js')
    expect(p.dependency.host).toBe(false)
    const l=layout(),d={...p.dependency,archivePath:'artifacts/'+p.dependency.archiveSha256+'.tgz'}
    const bytes=await buildWorkbenchPackageV4({layout:l,mode:'offline-embedded',dependencies:[d],artifacts:[{path:d.archivePath,content:p.bytes}],...await signer()})
    expect((await inspectWorkbenchPackageV4(bytes)).manifest.dependencies).toHaveLength(1)
  })
  it('accepts RC1 Client seed modules without requiring Profile npm peers',async()=>{
    const p=await prepareDistributionArtifact(template,()=>false)
    expect(p.dependency.packageName).toBe('@local/workbench-editor-example')
    expect(p.dependency.runtimeFiles).toContain('client.js')
  })
  it.each(['settings', 'folder'])('exports, embeds, imports and restores a custom editor into %s',async destinationMode=>{
    const dir=await mkdtemp(join(tmpdir(),'wb172-custom-offline-')),source=join(dir,'source')
    let value:any=undefined,revision=1,stored:any,sourcePhase=true,active=false
    try{
      await cp(template,source,{recursive:true});await rm(join(source,'README.md'))
      const prepared=await prepareDistributionArtifact(source,()=>false)
      await writeFile(join(dir,'package.json'),JSON.stringify({name:'offline-receiver',private:true,dependencies:{}}))
      await writeFile(join(dir,'.npmrc'),['registry=http://127.0.0.1:1/','store-dir='+join(dir,'empty-store'),'manage-package-manager-versions=false',''].join(String.fromCharCode(10)))
      const w=JSON.parse(await readFile(join(source,'package.json'),'utf8')).dsh.workbench
      const editor:any={id:'workbench.example',label:'Example',scope:'root',pluginId:'@local/workbench-editor-example',
        declaration:w.editors[0],extension:{schemaVersion:1,moduleId:w.moduleId,apiVersion:1,editorIds:w.editorIds,coreCompatibility:w.coreCompatibility,dshGeneration:w.dshGeneration},
        distribution:{version:1,portableId:w.moduleId,packageVersion:w.version,packageName:prepared.dependency.packageName,artifactDigest:prepared.dependency.digest,exportPolicy:'embed',sourcePolicy:'binary-only',provides:{editorIds:w.editorIds},requires:[],permissions:[]},
        provenance:{version:1,runtimeKind:'client-only',fiberName:prepared.dependency.packageName,packageName:prepared.dependency.packageName,packageVersion:w.version,artifactDigest:prepared.dependency.digest},
        portability:{version:1,exportState:(state:any)=>({schemaVersion:1,acknowledged:state?.acknowledged===true}),importState:(state:any)=>({schemaVersion:1,acknowledged:state?.acknowledged===true})}}
      const record=structuredClone(settingsFixture().workbenches.a!);if(record.document.root.kind!=='area')throw Error('fixture')
      record.document.root.moduleHistory=[{moduleInstanceId:'custom-page',editorId:editor.id,editorScope:'root',state:{schemaVersion:1,acknowledged:true},lastKnownTitle:'Example'}]
      record.document.root.activeModuleInstanceId='custom-page'
      const customLayout=projectLayoutPackage(record,[editor])
      const credentials:any={record:undefined,modifyRecord:async(_key:any,mutate:any)=>{credentials.record=await mutate(credentials.record)??credentials.record;return credentials.record},readRecord:async()=>credentials.record}
      const installedRoot=join(dir,'node_modules',prepared.dependency.packageName)
      const selected=async()=>JSON.parse(await readFile(join(dir,'package.json'),'utf8')).dsh?.profile?.bundles??[]
      const native={
        listBundles:async()=>sourcePhase?[{name:prepared.dependency.packageName,version:prepared.dependency.version,installed:true,enabled:true,rows:prepared.dependency.bundleEntries.map((entry:any)=>({moduleName:entry.moduleName,entryId:entry.entryId}))}]:existsSync(join(installedRoot,'package.json'))?[{name:prepared.dependency.packageName,version:prepared.dependency.version,installed:true,enabled:(await selected()).includes(prepared.dependency.packageName),rows:prepared.dependency.bundleEntries.map((entry:any)=>({moduleName:entry.moduleName,entryId:entry.entryId}))}]:[],
        listPlugins:async()=>sourcePhase||active?prepared.dependency.bundleEntries.map((entry:any)=>({moduleName:entry.moduleName,entryId:entry.entryId,enabled:true,fiberPhase:'active'})):[],
        setBundleEnabled:async()=>({application:'applied'}),
      }
      const options:any={profile:{name:'custom-offline',dir,cwd:dir,home:dir,installAnchor:dir,packageManager:{command:process.execPath,args:[join(dirname(process.execPath),'node_modules/corepack/dist/pnpm.js')]}} as any,native,resolve:()=>existsSync(join(installedRoot,'package.json'))?installedRoot:source,peerAvailable:()=>false,credentials,settings:{describe:()=>[{ns:'workbench-layout',value,revision}],mutate:async(_ns:any,ops:any[],expected:any)=>{if(expected!==revision)throw Error('CAS');stored=ops[0].value;value=stored;revision++}}}
      const directory = destinationMode === 'folder' ? new HostWorkbenchDirectory(dir, { create: async () => ({ id: crypto.randomUUID() }) } as never) : undefined
      if (directory) options.directory = directory
      const service=createHostDistributionService(options)
      const packageBytes=await service.export({layout:customLayout,mode:'offline-embedded',prepareArtifacts:true})
      sourcePhase=false
      const preview=await inspectWorkbenchPackageV4(packageBytes)
      expect(preview.manifest.mode).toBe('offline-embedded')
      expect(preview.manifest.dependencies).toHaveLength(1)
      expect(preview.manifest.dependencies[0]?.exportPolicy).toBe('embed')
      expect(preview.files.some(file=>file.path===preview.manifest.dependencies[0]?.archivePath)).toBe(true)
      const row=await service.inspect(packageBytes)
      expect(row.blockers).toEqual([])
      const awaiting=await service.consent(row.transactionId,row.archiveSha256,directory ? { parentPath: dir, folderName: 'received' } : undefined)
      expect(awaiting.state).toBe('restart-required')
      expect(existsSync(join(installedRoot,'package.json'))).toBe(true)
      active=true
      const resumed=await service.resume(row.transactionId)
      expect(resumed.state).toBe('awaiting-restore')
      const manifest=JSON.parse(await readFile(join(source,'package.json'),'utf8')).dsh.workbench
      const consent={ [prepared.dependency.packageName+'::'+prepared.dependency.moduleId]:{packageName:prepared.dependency.packageName,moduleId:prepared.dependency.moduleId,apiVersion:1,editorIds:manifest.editorIds,allowed:true,allowedAt:Date.now(),contractFingerprint:workbenchExtensionContractFingerprint({schemaVersion:1,moduleId:manifest.moduleId,apiVersion:1,editorIds:manifest.editorIds,coreCompatibility:manifest.coreCompatibility,dshGeneration:manifest.dshGeneration},manifest.editors)} }
      const restored=restoreLayoutPackage(preview.layout,[editor],{},true,true)
      const done=await service.complete(row.transactionId,restored.document,consent as any,restored.pendingPageIds)
      expect(done.state).toBe('ready')
      if (directory) {
        expect(stored).toBeUndefined()
        stored = directory.getSnapshot().value
        expect(stored.openWorkbenchIds).toEqual([])
        expect(stored.extensionConsents).toMatchObject(consent)
        expect(await realpath(directory.rootPath(row.workbenchId))).toBe(await realpath(join(dir, 'received')))
      }
      expect(stored.workbenches[row.workbenchId].packageOrigin.completeness).toBe('complete-offline')
      expect(areasOf(stored.workbenches[row.workbenchId].document.root)[0]!.moduleHistory[0]!.state).toEqual({schemaVersion:1,acknowledged:true})
    }finally{await rm(dir,{recursive:true,force:true})}
  })
  it('rejects dependencies, install scripts, source files and escaping entries',async()=>{
    const original=JSON.parse(await readFile(join(template,'package.json'),'utf8'))
    for(const alter of [(p:any)=>p.dependencies={private:'1.0.0'},(p:any)=>p.scripts={install:'node hack.js'},(p:any)=>p.dsh.workbench.distribution.runtimeFiles.push('../secret'),(p:any)=>p.dsh.workbench.distribution.runtimeFiles.push('src/private.ts')]){
      const p=structuredClone(original);alter(p);expect(()=>inspectDistributionManifest(p)).toThrow()
    }
  })
  it('requires RC2-built executable extension artifacts even when RC1 data archives remain importable',async()=>{
    const manifest=JSON.parse(await readFile(join(template,'package.json'),'utf8'))
    manifest.dsh.workbench.dshGeneration='0.2.2-rc.1'
    expect(()=>inspectDistributionManifest(manifest)).toThrow()
  })
  it('checks parsed module loads, host peers and client-only Host shims',async()=>{
    const dir=await mkdtemp(join(tmpdir(),'wb172-closure-'))
    try{
      await cp(template,dir,{recursive:true})
      const client=await readFile(join(dir,'client.js'),'utf8'),manifest=JSON.parse(await readFile(join(dir,'package.json'),'utf8'))
      const peer=(n:string,v:string)=>(n==='react'&&v==='18.3.1')||(n==='@deepseek-ai/dsh-client-ui-slots'&&v==='0.2.2-rc.2')
      for(const extra of ['require/* bypass */(variable)','import(/* bypass */"not-collected")']){
        await writeFile(join(dir,'client.js'),client+';'+extra)
        await expect(prepareDistributionArtifact(dir,peer)).rejects.toThrow()
      }
      await writeFile(join(dir,'client.js'),client+'\nimport "host-only"')
      await expect(prepareDistributionArtifact(dir,n=>n==='react')).rejects.toThrow()
      await writeFile(join(dir,'client.js'),client)
      // RC1 browser seeds no longer require a Profile peer.
      await writeFile(join(dir,'index.js'),'export function apply(ctx) { ctx.provide("test", true) }')
      await expect(prepareDistributionArtifact(dir,peer)).rejects.toThrow('空 Host')
      await writeFile(join(dir,'client.js'),client)
      manifest.dsh.workbench.distribution.runtimeKind='client-host'
      await writeFile(join(dir,'package.json'),JSON.stringify(manifest))
      expect((await prepareDistributionArtifact(dir,peer)).dependency.host).toBe(true)
    }finally{await rm(dir,{recursive:true,force:true})}
  })
})

describe('Host distribution transaction boundaries',()=>{
  it('persists publisher identity in the credential provider and refuses ephemeral keys',async()=>{
    const dir=await mkdtemp(join(tmpdir(),'wb172-publisher-'));let record:any
    const credentials={modifyRecord:async(_key:any,mutate:any)=>{record=await mutate(record)??record;return record},readRecord:async()=>record}
    const options={profile:{dir} as any,resolve:()=>undefined,peerAvailable:()=>false,native:{listBundles:async()=>[],listPlugins:async()=>[],setBundleEnabled:async()=>({application:'applied'})},credentials,settings:{describe:()=>[]}} as any
    try{
      const service=createHostDistributionService(options)
      const first=await inspectWorkbenchPackageV4(await service.export({layout:layout(),mode:'offline-embedded',prepareArtifacts:false}))
      const second=await inspectWorkbenchPackageV4(await createHostDistributionService(options).export({layout:layout(),mode:'offline-embedded',prepareArtifacts:false}))
      expect(first.manifest.publisher).toEqual(second.manifest.publisher)
      const identity=await readFile(join(dir,'.dsh-workbench/distribution-v4/publisher.json'),'utf8');expect(identity).not.toContain('PRIVATE KEY')
      credentials.readRecord=async()=>undefined
      await expect(service.export({layout:layout(),mode:'offline-embedded',prepareArtifacts:false})).rejects.toThrow('持久保存')
    }finally{await rm(dir,{recursive:true,force:true})}
  })
  it('revalidates stored identities and reconciles a deferred-config CAS after a crash',async()=>{
    const dir=await mkdtemp(join(tmpdir(),'wb172-recover-')),pkg=join(dir,'runtime')
    try{
      await cp(template,pkg,{recursive:true})
      await rm(join(pkg,'README.md'))
      const peer=(n:string,v:string)=>(n==='react'&&v==='18.3.1')||(n==='@deepseek-ai/dsh-client-ui-slots'&&v==='0.2.2-rc.2')
      const prepared=await prepareDistributionArtifact(pkg,peer),d=prepared.dependency
      const w=JSON.parse(await readFile(join(pkg,'package.json'),'utf8')).dsh.workbench
      const {workbenchExtensionContractFingerprint}=await import('../src/workbench-extension-access.ts')
      const l=layout();if(l.document.root.kind!=='area')throw Error('fixture')
      l.modules=[{editorId:'workbench.example',scope:'root',packageName:d.packageName,version:d.version,digest:d.digest}]
      l.document.root.moduleHistory=[{moduleInstanceId:'page-1',editorId:'workbench.example',editorScope:'root',lastKnownTitle:'Example',state:{schemaVersion:1,acknowledged:true}}];l.document.root.activeModuleInstanceId='page-1'
      let value:any,revision=1,installed=false,crash=false
      const options={profile:{name:'test',dir,cwd:dir,home:dir,installAnchor:dir} as any,peerAvailable:peer,resolve:()=>installed?pkg:undefined,
        native:{listBundles:async()=>installed?[{name:d.packageName,version:d.version,installed:true,enabled:true,rows:[{moduleName:d.packageName,entryId:'example'}]}]:[],listPlugins:async()=>[{moduleName:d.packageName,entryId:'example',enabled:true,fiberPhase:'active'}],setBundleEnabled:async()=>({application:'applied'})},
        settings:{describe:()=>[{ns:'workbench-layout',value,revision}],mutate:async(_n:any,ops:any[],expected:any)=>{if(expected!==revision)throw Error('CAS');value=ops[0].value;revision++;if(crash)throw Error('crash after CAS')}} as any}
      let service=createHostDistributionService(options)
      const row=await service.inspect(await buildWorkbenchPackageV4({layout:l,mode:'layout-only'}));await service.consent(row.transactionId,row.archiveSha256)
      const restored=restoreLayoutPackage(l,[],{},false,true);await service.complete(row.transactionId,restored.document,{},restored.pendingPageIds)
      installed=true
      value.extensionConsents={[d.packageName+'::'+d.moduleId]:{packageName:d.packageName,moduleId:d.moduleId,apiVersion:1,editorIds:w.editorIds,allowed:true,allowedAt:1,contractFingerprint:workbenchExtensionContractFingerprint({schemaVersion:1,moduleId:w.moduleId,apiVersion:1,editorIds:w.editorIds,coreCompatibility:w.coreCompatibility,dshGeneration:w.dshGeneration},w.editors)}}
      await service.preparePending(row.transactionId);expect(await service.identities()).toHaveLength(1)
      const metadata=join(dir,'.dsh-workbench/distribution-v4/artifacts',d.archiveSha256+'.json')
      await writeFile(metadata,JSON.stringify({...d,host:true}));expect(await service.identities()).toHaveLength(0)
      await service.preparePending(row.transactionId)
      const current=structuredClone(value.workbenches[row.workbenchId].document),next=structuredClone(current)
      areasOf(next.root)[0]!.moduleHistory[0]!.state={schemaVersion:1,acknowledged:true}
      crash=true;await expect(service.restorePending(row.transactionId,next,current,['page-1'])).rejects.toThrow('crash')
      crash=false;service=createHostDistributionService(options)
      expect((await service.restorePending(row.transactionId,next,current,['page-1'])).state).toBe('ready')
      expect(areasOf(value.workbenches[row.workbenchId].document.root)[0]!.moduleHistory[0]!.pendingDistribution).toBeUndefined()
      expect(revision).toBe(3)
    }finally{await rm(dir,{recursive:true,force:true})}
  })
  it('rejects approval reused across transactions or changed permissions',async()=>{
    const dir=await mkdtemp(join(tmpdir(),'wb172-approval-'))
    try{
      const service=createHostDistributionService({profile:{dir} as any,resolve:()=>undefined,peerAvailable:()=>false,native:{listBundles:async()=>[],listPlugins:async()=>[],setBundleEnabled:async()=>({application:'applied'})},settings:{describe:()=>[{ns:'workbench-layout',value:undefined,revision:0}]} as any})
      const bytes=await buildWorkbenchPackageV4({layout:layout(),mode:'layout-only'}),first=await service.inspect(bytes),second=await service.inspect(bytes)
      await service.consent(first.transactionId,first.archiveSha256)
      const root=join(dir,'.dsh-workbench/distribution-v4/transactions'),a=JSON.parse(await readFile(join(root,first.transactionId+'.json'),'utf8')),b=JSON.parse(await readFile(join(root,second.transactionId+'.json'),'utf8'))
      b.consentDigest=a.consentDigest;await writeFile(join(root,second.transactionId+'.json'),JSON.stringify(b))
      await expect(service.resume(second.transactionId)).rejects.toThrow('先确认')
      a.dependencies=[{permissions:['new-permission']}];await writeFile(join(root,first.transactionId+'.json'),JSON.stringify(a))
      await expect(service.resume(first.transactionId)).rejects.toThrow('先确认')
    }finally{await rm(dir,{recursive:true,force:true})}
  })
  it('preserves missing-extension state in the durable journal and blocks structural substitution',async()=>{
    const dir=await mkdtemp(join(tmpdir(),'wb172-pending-'));let value:any,revision=1
    try{
      const l=layout();if(l.document.root.kind!=='area')throw new Error('fixture')
      l.modules=[{editorId:'private.editor',scope:'root',packageName:'@local/private',version:'1.0.0',digest:'a'.repeat(64)}]
      l.document.root.moduleHistory=[{moduleInstanceId:'page-1',editorId:'private.editor',editorScope:'root',lastKnownTitle:'私有内页',state:{schemaVersion:1,color:'blue'}}];l.document.root.activeModuleInstanceId='page-1'
      const options={profile:{name:'test',dir,cwd:dir,home:dir,installAnchor:dir} as any,native:{listBundles:async()=>[],listPlugins:async()=>[],setBundleEnabled:async()=>({application:'applied'})},resolve:()=>undefined,peerAvailable:()=>false,settings:{describe:()=>[{ns:'workbench-layout',value,revision}],mutate:async(_n:any,ops:any[],r:any)=>{if(r!==revision)throw new Error('conflict');value=ops[0].value;revision++}} as any}
      const service=createHostDistributionService(options),row=await service.inspect(await buildWorkbenchPackageV4({layout:l,mode:'layout-only'}));await service.consent(row.transactionId,row.archiveSha256)
      const restored=restoreLayoutPackage(l,[],{},false,true);expect(restored.pendingPageIds).toEqual(['page-1'])
      const altered=structuredClone(restored.document);areasOf(altered.root)[0]!.moduleHistory[0]!.lastKnownTitle='changed'
      await expect(service.complete(row.transactionId,altered,{},restored.pendingPageIds)).rejects.toThrow('几何')
      const complete=await service.complete(row.transactionId,restored.document,{},restored.pendingPageIds)
      expect(complete.state).toBe('needs-input');expect(areasOf(value.workbenches[row.workbenchId].document.root)[0]!.moduleHistory[0]!.pendingDistribution).toBe(row.transactionId)
      const reopened=createHostDistributionService(options),history=await reopened.history()
      expect(areasOf(history[0]!.layout!.document.root)[0]!.moduleHistory[0]!.state).toEqual({schemaVersion:1,color:'blue'})
      expect(history[0]!.pendingPageIds).toEqual(['page-1'])
      expect(value.workbenches[row.workbenchId].packageOrigin.completeness).toBe('layout-only')
    }finally{await rm(dir,{recursive:true,force:true})}
  })
  it('never calls a same-editor-id provider with a different locked identity',()=>{
    const l=layout();if(l.document.root.kind!=='area')throw new Error('fixture')
    l.modules=[{editorId:'private.editor',scope:'root',packageName:'@local/private',version:'1.0.0',digest:'a'.repeat(64)}]
    l.document.root.moduleHistory=[{moduleInstanceId:'page-1',editorId:'private.editor',editorScope:'root',lastKnownTitle:'private',state:{schemaVersion:1}}]
    let calls=0
    const result=restoreLayoutPackage(l,[{id:'private.editor',scope:'root',provenance:{packageName:'@local/other',packageVersion:'1.0.0',artifactDigest:'a'.repeat(64)},portability:{version:1,importState:()=>{calls++;return{schemaVersion:1}}}} as any],{},false,true)
    expect(calls).toBe(0);expect(result.pendingPageIds).toEqual(['page-1'])
  })
  it('requires digest-bound approval and initializes an empty Settings document only at final commit',async()=>{
    const dir=await mkdtemp(join(tmpdir(),'wb-distribution-'))
    let value:any=undefined,revision=1,writes=0
    try{
      const service=createHostDistributionService({profile:{name:'test',dir,cwd:dir,home:dir,installAnchor:join(dir,'package.json')} as any,
        native:{listBundles:async()=>[],listPlugins:async()=>[],setBundleEnabled:async()=>({application:'applied'})},resolve:()=>undefined,peerAvailable:()=>false,
        settings:{describe:()=>[{ns:'workbench-layout',value,revision}],mutate:async(_ns:any,ops:any[],expected:any)=>{expect(expected).toBe(revision);value=ops[0].value;revision++;writes++}} as any})
      const source=structuredClone(settingsFixture().workbenches.a!);if(source.document.root.kind!=='area')throw Error('fixture');source.document.root.moduleHistory=[];delete source.document.root.activeModuleInstanceId;const context=createWorkbenchContext();context.human.goal='Host 导入目标';source.context=context
      const contextLayout=projectLayoutPackage(source,[])
      const bytes=await buildWorkbenchPackageV4({layout:contextLayout,mode:'layout-only'})
      const first=await service.inspect(bytes)
      expect(writes).toBe(0)
      await expect(service.resume(first.transactionId)).rejects.toThrow('先确认')
      await expect(service.consent(first.transactionId,'0'.repeat(64))).rejects.toThrow('不一致')
      const approved=await service.consent(first.transactionId,first.archiveSha256)
      expect(approved.state).toBe('awaiting-restore');expect(writes).toBe(0)
      const result=await service.complete(first.transactionId,contextLayout.document,{})
      expect(result.state).toBe('ready');expect(value.openWorkbenchIds).toEqual([]);expect(writes).toBe(1)
      expect(value.workbenches[first.workbenchId].context.human.goal).toBe('Host 导入目标')
      await service.complete(first.transactionId,contextLayout.document,{})
      expect(writes).toBe(1)
      expect((await service.history())[0]?.state).toBe('ready')
    }finally{await rm(dir,{recursive:true,force:true})}
  })
})
