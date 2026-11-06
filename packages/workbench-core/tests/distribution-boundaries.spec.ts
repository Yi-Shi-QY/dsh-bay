import {it,expect,vi,afterEach} from 'vitest'
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {fetchLockedDistributionArtifact} from '../src/host-distribution-route.ts'
import {prepareDistributionArtifact} from '../src/host-distribution-artifacts.ts'
import {orderedDistributionDependencies} from '../src/foundation/workbench-package-v4.ts'
import {restoreLayoutPackage,projectLayoutPackage,portableStateSafe} from '../src/foundation/workbench-layout-package.ts'
import {settingsFixture} from './settings-fixtures.ts'
import {createWorkbenchExtensionRegistryV1} from '../src/client/workbench-extension-registry.ts'
import {WorkbenchSettingsSchema} from '../src/host-layout-settings.ts'
import {validateWorkbenchDistributionRuntimeV1} from '../src/foundation/workbench-distribution-runtime.ts'
import {createHostDistributionRuntimeV4} from '../src/distribution-contract.ts'
import {createDistributionPackageService} from '../src/foundation/distribution-package-service.ts'
import {buildLayoutPackage} from '../src/foundation/workbench-layout-package.ts'
import {inspectWorkbenchPackageV4} from '../src/foundation/workbench-package-v4.ts'

afterEach(()=>vi.unstubAllGlobals())
it('rejects portable projections carrying local paths on every supported platform',()=>{
  for(const path of ['/mnt/private','/opt/team/file','~/private','file:///private','C:/private'])expect(portableStateSafe({schemaVersion:1,path})).toBe(false)
  expect(portableStateSafe({schemaVersion:1,relative:'assets/icon.svg'})).toBe(true)
})
it('explicitly converts 17.1 layout content to V4 without installing embedded extensions',async()=>{
  const layout=projectLayoutPackage(settingsFixture().workbenches.a!,[])
  const inspect=vi.fn(async(bytes:Uint8Array)=>inspectWorkbenchPackageV4(bytes))
  const service=createDistributionPackageService({client:{inspect},canImport:()=>true} as any)
  const result=await service.inspectLegacy(await buildLayoutPackage(layout)) as any
  expect(result.manifest.mode).toBe('layout-only');expect(result.manifest.dependencies).toEqual([])
  expect(result.layout.document).toEqual(layout.document)
  expect(result.layout.warnings.join(' ')).toContain('不会自动安装')
})
it('awaited inventory refresh waits for the newest overlapping read',async()=>{
  const pending:((value:any)=>void)[]=[]
  const registry=createWorkbenchExtensionRegistryV1({catalog:{getSnapshot:()=>[],subscribe:()=>()=>{}},settings:{getSnapshot:()=>({value:undefined}),subscribe:()=>()=>{}},coreEditorIds:[],coreVersion:'test',dshGeneration:'test',readDshInventory:()=>new Promise(resolve=>pending.push(resolve))})
  pending[0]!({plugins:[],bundles:[]});await Promise.resolve()
  let complete=false;const older=registry.refresh().then(()=>{complete=true}),newer=registry.refresh()
  pending[1]!({plugins:[],bundles:[]});await Promise.resolve();await Promise.resolve()
  expect(complete).toBe(false)
  pending[2]!({plugins:[],bundles:[]});await Promise.all([older,newer]);expect(complete).toBe(true);registry.dispose()
})
it('starts a new native Profile without an implicit workbench',()=>{
  const value=WorkbenchSettingsSchema(undefined)
  expect(value.workbenches).toEqual({});expect(value.openWorkbenchIds).toEqual([])
})
it('does not advertise an incomplete V4 authority',()=>{
  expect(validateWorkbenchDistributionRuntimeV1(createHostDistributionRuntimeV4({} as never,'test'))).toBe(false)
})
it('sorts plugin dependencies and rejects cyclic closures',()=>{
  const a={packageName:'a',requires:['b']} as any,b={packageName:'b',requires:[]} as any
  expect(orderedDistributionDependencies([a,b]).map(d=>d.packageName)).toEqual(['b','a'])
  b.requires=['a'];expect(()=>orderedDistributionDependencies([a,b])).toThrow('循环')
})
it('rejects oversized or wrong-schema input before invoking the import handler',()=>{
  const r=structuredClone(settingsFixture().workbenches.a!);if(r.document.root.kind!=='area')throw Error('fixture')
  r.document.root.moduleHistory=r.document.root.moduleHistory.slice(0,1);r.document.root.activeModuleInstanceId=r.document.root.moduleHistory[0]!.moduleInstanceId
  const l=projectLayoutPackage(r,[]),page=l.document.root.kind==='area'?l.document.root.moduleHistory[0]!:undefined
  l.modules[0]={editorId:'example.notes',scope:'root',packageName:'@private/notes',version:'1.0.0',digest:'a'.repeat(64)}
  const restore=vi.fn(()=>({schemaVersion:1}))
  const editor={id:'example.notes',scope:'root',provenance:{packageName:'@private/notes',packageVersion:'1.0.0',artifactDigest:'a'.repeat(64)},declaration:{state:{schemaVersion:1,maxBytes:40,share:'portable'}},portability:{version:1,importState:restore}} as any
  for(const state of [{schemaVersion:2},{schemaVersion:1,value:'a'.repeat(100)}]){page!.state=state;expect(restoreLayoutPackage(l,[editor],{},false,true).pendingPageIds).toHaveLength(1)}
  expect(restore).not.toHaveBeenCalled()
})
it('uses only recipient credentials and rejects changed online locks and cross-origin downloads',async()=>{
  const root=await mkdtemp(join(tmpdir(),'wb172-online-'))
  try{
    const p=await prepareDistributionArtifact(join(import.meta.dirname,'../presets/workbench-creator/skills/workbench-extension-development/templates/workbench-editor'),(n,v)=>(n==='react'&&v==='18.3.1')||(n==='@deepseek-ai/dsh-client-ui-slots'&&v==='0.2.2-rc.1'))
    const d={...p.dependency,registryUrl:'https://registry.example/team/'}
    await writeFile(join(root,'.npmrc'),'//registry.example/team/:_authToken=recipient-test-only')
    const requests:any[]=[];let changed=false,cross=false
    vi.stubGlobal('fetch',vi.fn(async(url:URL,options:any)=>{
      requests.push({url:url.href,headers:options.headers,redirect:options.redirect})
      return url.pathname.endsWith('.tgz')?new Response(p.bytes):new Response(JSON.stringify({name:d.packageName,version:d.version,dist:{integrity:changed?'sha512-changed':d.integrity,tarball:cross?'https://other.example/private.tgz':'https://registry.example/team/private.tgz'}}))
    }))
    expect(await fetchLockedDistributionArtifact(d,root)).toEqual(p.bytes)
    expect(requests).toHaveLength(2);expect(requests.every(r=>r.headers.authorization==='Bearer recipient-test-only'&&r.redirect==='error')).toBe(true)
    changed=true;await expect(fetchLockedDistributionArtifact(d,root)).rejects.toThrow('完整性')
    changed=false;cross=true;await expect(fetchLockedDistributionArtifact(d,root)).rejects.toThrow('跨站')
    vi.stubGlobal('fetch',vi.fn(async()=>new Response('',{status:401})))
    await expect(fetchLockedDistributionArtifact(d,root)).rejects.toThrow('凭据')
  }finally{await rm(root,{recursive:true,force:true})}
})
