import {it,expect} from 'vitest'
import {mkdtemp,writeFile,readFile,rm,cp,mkdir} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,dirname} from 'node:path'
import {existsSync} from 'node:fs'
import {generateKeyPairSync,sign} from 'node:crypto'
import {prepareDistributionArtifact} from '../src/host-distribution-artifacts.ts'
import {createHostDistributionService} from '../src/host-distribution-service.ts'
import {buildWorkbenchPackageV4,publisherKeyIdV4} from '../src/foundation/workbench-package-v4.ts'
import {projectLayoutPackage} from '../src/foundation/workbench-layout-package.ts'
import {settingsFixture} from './settings-fixtures.ts'
import {workbenchExtensionContractFingerprint} from '../src/workbench-extension-access.ts'

it('resumes multi-plugin installation, reuses exact plugins, honors CAS, and cancels only owned assets',async()=>{
  const root=await mkdtemp(join(tmpdir(),'wb172-tx-')),profileDir=join(root,'profile')
  await mkdir(profileDir)
  try{
    await writeFile(join(profileDir,'package.json'),JSON.stringify({name:'acceptance',private:true,dependencies:{}}))
    await writeFile(join(profileDir,'.npmrc'),['registry=http://127.0.0.1:1/','store-dir='+join(root,'empty-store'),'manage-package-manager-versions=false',''].join(String.fromCharCode(10)))
    const prepared=[]
    for(const suffix of ['first','second']){
      const dir=join(root,suffix);await cp(join(import.meta.dirname,'../presets/workbench-creator/skills/workbench-extension-development/templates/workbench-editor'),dir,{recursive:true})
      for(const file of ['package.json','client.js','cordis.patch.yml'])await writeFile(join(dir,file),(await readFile(join(dir,file),'utf8')).replaceAll('workbench-editor-example','private-'+suffix).replaceAll('workbench.example','private.'+suffix).replaceAll('workbench.editor-example','private.'+suffix))
      prepared.push(await prepareDistributionArtifact(dir,(n,v)=>(n==='react'&&v==='18.3.1')||(n==='@deepseek-ai/dsh-client-ui-slots'&&v==='0.2.2-rc.1')))
    }
    const dependencies=prepared.map(p=>({...p.dependency,archivePath:'artifacts/'+p.dependency.archiveSha256+'.tgz'}))
    const record=structuredClone(settingsFixture().workbenches.a!);if(record.document.root.kind!=='area')throw Error('fixture');record.document.root.moduleHistory=[];delete record.document.root.activeModuleInstanceId
    const layout=projectLayoutPackage(record,[]),pair=generateKeyPairSync('ed25519'),publicKey=pair.publicKey.export({format:'der',type:'spki'}).subarray(-32).toString('base64')
    const bytes=await buildWorkbenchPackageV4({layout,mode:'offline-embedded',dependencies,artifacts:dependencies.map((d,i)=>({path:d.archivePath!,content:prepared[i]!.bytes})),publisher:{displayName:'Test',publicKey,keyId:await publisherKeyIdV4(publicKey)},sign:async bytes=>sign(null,bytes,pair.privateKey).toString('base64')})
    let activeBundles:string[]=[],value:any,revision=1,conflict=false,writes=0
    const selected=async()=>JSON.parse(await readFile(join(profileDir,'package.json'),'utf8')).dsh?.profile?.bundles??[]
    const select=async(names:string[])=>{const m=JSON.parse(await readFile(join(profileDir,'package.json'),'utf8'));m.dsh={profile:{bundles:names}};await writeFile(join(profileDir,'package.json'),JSON.stringify(m))}
    const native={
      listBundles:async()=>{const enabled=await selected();return dependencies.filter(d=>existsSync(join(profileDir,'node_modules',d.packageName,'package.json'))).map(d=>({name:d.packageName,version:d.version,installed:true,enabled:enabled.includes(d.packageName),rows:[{moduleName:d.packageName,entryId:d.moduleId}]}))},
      listPlugins:async()=>dependencies.map(d=>({moduleName:d.packageName,entryId:d.moduleId,enabled:activeBundles.includes(d.packageName),fiberPhase:activeBundles.includes(d.packageName)?'active':'pending'})),
      setBundleEnabled:async()=>{throw Error('Use identity-checked native manifest operation')},
    }
    const options={profile:{name:'acceptance',dir:profileDir,cwd:profileDir,home:root,installAnchor:profileDir,packageManager:{command:process.execPath,args:[join(dirname(process.execPath),'node_modules/corepack/dist/pnpm.js')]}} as any,native,resolve:(name:string)=>existsSync(join(profileDir,'node_modules',name))?join(profileDir,'node_modules',name):undefined,peerAvailable:(n:string,v:string)=>(n==='react'&&v==='18.3.1')||(n==='@deepseek-ai/dsh-client-ui-slots'&&v==='0.2.2-rc.1'),settings:{describe:()=>[{ns:'workbench-layout',value,revision}],mutate:async(_ns:any,ops:any[],expected:any)=>{if(conflict||expected!==revision)throw Error('CAS conflict');value=ops[0].value;revision++;writes++}} as any}
    let service=createHostDistributionService(options)
    const inspected=await service.inspect(bytes),installed=await service.consent(inspected.transactionId,inspected.archiveSha256)
    expect(installed.state).toBe('restart-required');expect(installed.installed).toHaveLength(2);expect(writes).toBe(0)
    expect((await service.cancel(installed.transactionId)).state).toBe('cancelled')
    expect(JSON.parse(await readFile(join(profileDir,'package.json'),'utf8')).dependencies??{}).toEqual({})
    const retry=await service.inspect(bytes),retried=await service.consent(retry.transactionId,retry.archiveSha256)
    expect(retried.installed).toHaveLength(2)
    // Subsequent assertions continue the fresh transaction after owned rollback.
    installed.transactionId=retried.transactionId
    service=createHostDistributionService(options);activeBundles=await selected()
    const resumed=await service.resume(installed.transactionId);expect(resumed.state).toBe('awaiting-restore');expect(resumed.installed).toHaveLength(2)
    const consents:any={}
    for(const d of dependencies){const w=JSON.parse(await readFile(join(profileDir,'node_modules',d.packageName,'package.json'),'utf8')).dsh.workbench;consents[d.packageName+'::'+d.moduleId]={packageName:d.packageName,moduleId:d.moduleId,apiVersion:1,editorIds:w.editorIds,allowed:true,allowedAt:Date.now(),contractFingerprint:workbenchExtensionContractFingerprint({schemaVersion:1,moduleId:w.moduleId,apiVersion:1,editorIds:w.editorIds,coreCompatibility:w.coreCompatibility,dshGeneration:w.dshGeneration},w.editors)}}
    conflict=true;await expect(service.complete(installed.transactionId,layout.document,consents)).rejects.toThrow('CAS');expect(writes).toBe(0)
    conflict=false;expect((await service.complete(installed.transactionId,layout.document,consents)).state).toBe('ready');expect(writes).toBe(1)
    expect((await service.cancel(installed.transactionId)).state).toBe('ready')
    await select([dependencies[1]!.packageName]);activeBundles=await selected()
    const second=await service.inspect(bytes),reused=await service.consent(second.transactionId,second.archiveSha256)
    expect(reused.reused).toHaveLength(2);expect(reused.installed).toHaveLength(0);expect(await selected()).toContain(dependencies[0]!.packageName)
    expect((await service.cancel(second.transactionId)).state).toBe('cancelled');expect(await selected()).not.toContain(dependencies[0]!.packageName)
    expect(JSON.parse(await readFile(join(profileDir,'package.json'),'utf8')).dependencies).toHaveProperty(dependencies[0]!.packageName)
    // A plugin activated after a restart cannot be called rolled back until it
    // stops in the next process. Reused packages are never removed.
    await select([]);activeBundles=[]
    const third=await service.inspect(bytes),waiting=await service.consent(third.transactionId,third.archiveSha256)
    expect(waiting.state).toBe('restart-required');expect(waiting.installed).toEqual([])
    activeBundles=await selected()
    expect((await service.cancel(third.transactionId)).state).toBe('recovery-required')
    expect(await selected()).toEqual([])
    activeBundles=[];service=createHostDistributionService(options)
    expect((await service.cancel(third.transactionId)).state).toBe('cancelled');expect(writes).toBe(1)
    const fourth=await service.inspect(bytes);await service.consent(fourth.transactionId,fourth.archiveSha256)
    const ownSelection=await selected();await select([...ownSelection,'@local/other-window'])
    expect((await service.cancel(fourth.transactionId)).state).toBe('recovery-required')
    expect(await selected()).toEqual([...ownSelection,'@local/other-window'])
  }finally{await rm(root,{recursive:true,force:true})}
},90000)
