import {it,expect} from 'vitest'
import {mkdtemp,writeFile,readFile,rm,access} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,dirname} from 'node:path'
import {existsSync} from 'node:fs'
import {prepareDistributionArtifact} from '../src/host-distribution-artifacts.ts'
import {createDistributionInstaller} from '../src/host-distribution-installer.ts'

it('installs a private self-contained tarball with the real native pnpm operation in a clean offline Profile',async()=>{
  const root=await mkdtemp(join(tmpdir(),'wb172-native-'))
  try{
    await writeFile(join(root,'package.json'),JSON.stringify({name:'distribution-acceptance',private:true,dependencies:{}}))
    await writeFile(join(root,'.npmrc'),'registry=http://127.0.0.1:1/'+String.fromCharCode(10)+'store-dir='+join(root,'empty-store')+String.fromCharCode(10)+'manage-package-manager-versions=false'+String.fromCharCode(10))
    const prepared=await prepareDistributionArtifact(join(import.meta.dirname,'../presets/workbench-creator/skills/workbench-extension-development/templates/workbench-editor'),(name,version)=>(name==='react'&&version==='18.3.1')||(name==='@deepseek-ai/dsh-client-ui-slots'&&version==='0.2.2-rc.2'))
    const artifact=join(root,'private.tgz');await writeFile(artifact,prepared.bytes)
    const packageRoot=join(root,'node_modules',prepared.dependency.packageName)
    let conflicting=false
    const native={listBundles:async()=>existsSync(join(packageRoot,'package.json'))?[{name:prepared.dependency.packageName,version:prepared.dependency.version,installed:true,enabled:false}]:[],listPlugins:async()=>conflicting?[{moduleName:'@local/unrelated',entryId:prepared.dependency.bundleEntries[0]!.entryId,enabled:true,fiberPhase:'active'}]:[],setBundleEnabled:async()=>({application:'applied'})}
    const corepack=join(dirname(process.execPath),'node_modules/corepack/dist/pnpm.js')
    const installer=createDistributionInstaller({native,resolve:()=>existsSync(packageRoot)?packageRoot:undefined,profile:{name:'acceptance',dir:root,cwd:root,home:root,installAnchor:root,packageManager:{command:process.execPath,args:[corepack]}} as never})
    let mutations=0
    conflicting=true
    await expect(installer.install(prepared.dependency,artifact,async()=>{mutations++})).rejects.toThrow('入口与已有插件冲突')
    expect(mutations).toBe(0);conflicting=false
    const result=await installer.install(prepared.dependency,artifact,async()=>{mutations++})
    expect(result.reused).toBe(false);expect(mutations).toBe(1)
    await installer.verified(prepared.dependency)
    expect((await installer.install(prepared.dependency,artifact,async()=>{mutations++})).reused).toBe(true)
    expect(mutations).toBe(1)
    await expect(installer.check({...prepared.dependency,version:'9.9.9'})).rejects.toThrow('冲突')
    await installer.remove(prepared.dependency)
    expect(JSON.parse(await readFile(join(root,'package.json'),'utf8')).dependencies?.[prepared.dependency.packageName]).toBeUndefined()
    await expect(installer.remove(prepared.dependency,artifact)).resolves.toBeUndefined()
  }finally{await rm(root,{recursive:true,force:true})}
},60000)
