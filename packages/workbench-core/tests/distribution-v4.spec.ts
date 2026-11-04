import { describe, it, expect } from 'vitest'
import { generateKeyPairSync, sign } from 'node:crypto'
import { mkdtemp, cp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { projectLayoutPackage,restoreLayoutPackage } from '../src/foundation/workbench-layout-package.ts'
import { buildWorkbenchPackageV4, inspectWorkbenchPackageV4, publisherKeyIdV4 } from '../src/foundation/workbench-package-v4.ts'
import { decodeDeterministicZip, encodeDeterministicZip } from '../src/foundation/workbench-sharing.ts'
import { prepareDistributionArtifact, inspectDistributionManifest, artifactHash } from '../src/host-distribution-artifacts.ts'
import { createHostDistributionService } from '../src/host-distribution-service.ts'
import { settingsFixture } from './settings-fixtures.ts'
import { WORKBENCH_CORE_VERSION } from '../src/release-compatibility.ts'
import {areasOf} from '../src/foundation/document-v3.ts'

const template=join(import.meta.dirname,'../presets/workbench-creator/skills/workbench-extension-development/templates/workbench-editor')
const layout=()=>{const r=structuredClone(settingsFixture().workbenches.a!);if(r.document.root.kind!=='area')throw new Error('fixture');r.document.root.moduleHistory=[];delete r.document.root.activeModuleInstanceId;return projectLayoutPackage(r,[])}
async function signer(){const pair=generateKeyPairSync('ed25519');const publicKey=pair.publicKey.export({format:'der',type:'spki'}).subarray(-32).toString('base64');return{publisher:{displayName:'测试房主',publicKey,keyId:await publisherKeyIdV4(publicKey)},sign:async(bytes:Uint8Array)=>sign(null,bytes,pair.privateKey).toString('base64')}}

describe('17.2 signed package contract',()=>{
  it('round trips three modes and keeps the layout payload',async()=>{
    for(const mode of ['layout-only','online-reference','offline-embedded'] as const){
      const bytes=await buildWorkbenchPackageV4({layout:layout(),mode,...mode==='layout-only'?{}:await signer()})
      const p=await inspectWorkbenchPackageV4(bytes);expect(p.manifest.mode).toBe(mode);expect(p.layout.retention).toBe('all-retained-tabs');expect(p.layout.name).toBe(layout().name)
    }
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
  it('does not permit an unknown editor to claim Core identity',async()=>{
    const l=layout();l.modules=[{editorId:'unknown',scope:'root',packageName:'@dsh-workbench/core',version:WORKBENCH_CORE_VERSION}]
    await expect(buildWorkbenchPackageV4({layout:l,mode:'offline-embedded',...await signer()})).rejects.toThrow('伪装')
  })
})

describe('explicit runtime artifact preparation',()=>{
  it('supports the real Creator root-entry template and exact runtime file set',async()=>{
    const p=await prepareDistributionArtifact(template,(name,version)=>(name==='react'&&version==='18.3.1')||(name==='@deepseek-ai/dsh-client-ui-slots'&&version==='0.2.1-rc.5'))
    expect(p.dependency.packageName).toBe('@local/workbench-editor-example')
    expect(p.dependency.archiveSha256).toBe(artifactHash(p.bytes))
    expect(p.dependency.runtimeFiles).toContain('client.js')
    expect(p.dependency.host).toBe(false)
    const l=layout(),d={...p.dependency,archivePath:'artifacts/'+p.dependency.archiveSha256+'.tgz'}
    const bytes=await buildWorkbenchPackageV4({layout:l,mode:'offline-embedded',dependencies:[d],artifacts:[{path:d.archivePath,content:p.bytes}],...await signer()})
    expect((await inspectWorkbenchPackageV4(bytes)).manifest.dependencies).toHaveLength(1)
  })
  it('rejects dependencies, install scripts, source files and escaping entries',async()=>{
    const original=JSON.parse(await readFile(join(template,'package.json'),'utf8'))
    for(const alter of [(p:any)=>p.dependencies={private:'1.0.0'},(p:any)=>p.scripts={install:'node hack.js'},(p:any)=>p.dsh.workbench.distribution.runtimeFiles.push('../secret'),(p:any)=>p.dsh.workbench.distribution.runtimeFiles.push('src/private.ts')]){
      const p=structuredClone(original);alter(p);expect(()=>inspectDistributionManifest(p)).toThrow()
    }
  })
  it('checks parsed module loads, host peers and client-only Host shims',async()=>{
    const dir=await mkdtemp(join(tmpdir(),'wb172-closure-'))
    try{
      await cp(template,dir,{recursive:true})
      const client=await readFile(join(dir,'client.js'),'utf8'),manifest=JSON.parse(await readFile(join(dir,'package.json'),'utf8'))
      const peer=(n:string,v:string)=>(n==='react'&&v==='18.3.1')||(n==='@deepseek-ai/dsh-client-ui-slots'&&v==='0.2.1-rc.5')
      for(const extra of ['require/* bypass */(variable)','import(/* bypass */"not-collected")']){
        await writeFile(join(dir,'client.js'),client+';'+extra)
        await expect(prepareDistributionArtifact(dir,peer)).rejects.toThrow()
      }
      await writeFile(join(dir,'client.js'),client)
      await expect(prepareDistributionArtifact(dir,n=>n==='react')).rejects.toThrow('宿主依赖')
      await writeFile(join(dir,'index.js'),'export function apply(ctx) { ctx.provide("test", true) }')
      await expect(prepareDistributionArtifact(dir,peer)).rejects.toThrow('空 Host')
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
      const peer=(n:string,v:string)=>(n==='react'&&v==='18.3.1')||(n==='@deepseek-ai/dsh-client-ui-slots'&&v==='0.2.1-rc.5')
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
      const bytes=await buildWorkbenchPackageV4({layout:layout(),mode:'layout-only'})
      const first=await service.inspect(bytes)
      expect(writes).toBe(0)
      await expect(service.resume(first.transactionId)).rejects.toThrow('先确认')
      await expect(service.consent(first.transactionId,'0'.repeat(64))).rejects.toThrow('不一致')
      const approved=await service.consent(first.transactionId,first.archiveSha256)
      expect(approved.state).toBe('awaiting-restore');expect(writes).toBe(0)
      const result=await service.complete(first.transactionId,layout().document,{})
      expect(result.state).toBe('ready');expect(value.openWorkbenchIds).toEqual([]);expect(writes).toBe(1)
      await service.complete(first.transactionId,layout().document,{})
      expect(writes).toBe(1)
      expect((await service.history())[0]?.state).toBe('ready')
    }finally{await rm(dir,{recursive:true,force:true})}
  })
})
