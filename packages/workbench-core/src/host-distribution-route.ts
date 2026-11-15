import { AGENT_ASSEMBLY_SERVICE } from './agent-assembly-model.ts'
import type { HostAgentAssemblyStore } from './host-agent-assembly.ts'
import { readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { HostConnectionHandle } from '@deepseek-ai/dsh-client-connection'
import type { ProfileContext } from '@deepseek-ai/dsh-app-boot'
import type SettingsProvider from '@deepseek-ai/dsh-settings'
import type { CredentialProvider } from '@deepseek-ai/dsh-credentials'
import { createHostDistributionService, type HostDistributionOptions } from './host-distribution-service.ts'
import { createCompleteExtensions, WORKBENCH_COMPLETE_EXTENSIONS } from './host-complete-extensions.ts'
import { CompleteMigrationRegistry, WORKBENCH_COMPLETE_MIGRATIONS } from './host-complete-migrations.ts'
import type { DistributionNativeManager } from './host-distribution-installer.ts'
import { DISTRIBUTION_ROUTE, createHostDistributionRuntimeV4 } from './distribution-contract.ts'
import { WORKBENCH_CORE_VERSION } from './release-compatibility.ts'
import type { WorkbenchPackageDependencyV4 } from './foundation/workbench-package-v4.ts'
import type { HostWorkbenchDirectory } from './host-workbench-directory.ts'
import { WORKBENCH_DIRECTORY_SERVICE } from './workbench-directory-contract.ts'
import type { HostWorkbenchAccess } from './host-workbench-access.ts'
import { WORKBENCH_ACCESS_SERVICE } from './workbench-access-contract.ts'

interface PackageResolver { packageOf(name: string, parent: string): { name: string; version?: string; dir: string } | undefined }
export async function fetchLockedDistributionArtifact(d: WorkbenchPackageDependencyV4, profile: string): Promise<Uint8Array> {
  if(!d.registryUrl)throw new Error('缺少在线来源。')
  const registry=new URL(d.registryUrl)
  if(registry.protocol!=='https:'||registry.username||registry.password||registry.search||registry.hash)throw new Error('在线来源无效。')
  const npmrc=await readFile(join(profile,'.npmrc'),'utf8').catch(()=> '')
  const prefix=`//${registry.host}${registry.pathname.replace(/[/]?$/u,'/')}:_authToken=`
  const raw=npmrc.split(String.fromCharCode(10)).map(l=>l.trim()).find(l=>l.startsWith(prefix))?.slice(prefix.length).trim()
  const token=raw?.startsWith('${')&&raw.endsWith('}')?process.env[raw.slice(2,-1)]:raw
  const headers:Record<string,string>={accept:'application/json',...(token?{authorization:`Bearer ${token}`}:{})}
  const read=async(url:URL,limit:number)=>{
    if(url.protocol!=='https:'||url.origin!==registry.origin||url.username||url.password)throw new Error('Registry 返回了未授权的跨站制品来源。')
    const response=await fetch(url,{headers,redirect:'error',signal:AbortSignal.timeout(60000)})
    if(!response.ok||!response.body)throw new Error('在线来源无法访问，请在接收方 Profile 配置 Registry 凭据。')
    if(Number(response.headers.get('content-length')??0)>limit)throw new Error('下载内容超限。')
    const chunks:Uint8Array[]=[];let size=0
    for await(const chunk of response.body){size+=chunk.length;if(size>limit)throw new Error('下载内容超限。');chunks.push(chunk)}
    return new Uint8Array(Buffer.concat(chunks))
  }
  const metadata=JSON.parse(new TextDecoder().decode(await read(new URL(`${encodeURIComponent(d.packageName)}/${encodeURIComponent(d.version)}`,`${registry.href.replace(/[/]?$/u,'/')}`),1024*1024))) as {name?:string;version?:string;dist?:{tarball?:string;integrity?:string}}
  if(metadata.name!==d.packageName||metadata.version!==d.version||metadata.dist?.integrity!==d.integrity||!metadata.dist.tarball)throw new Error('Registry 版本或完整性与签名依赖锁不一致。')
  return read(new URL(metadata.dist.tarball),64*1024*1024)
}
export function installDistributionRoutes(ctx:{get<T>(name:string,strict?:boolean):T|undefined;provide?(name:string,value:unknown):unknown}):(()=>void)|undefined {
  const connection=ctx.get<HostConnectionHandle>('connection',false),profile=ctx.get<ProfileContext>('profileContext',false),native=ctx.get<DistributionNativeManager>('pluginManager',false),settings=ctx.get<SettingsProvider>('settings',false),resolver=ctx.get<PackageResolver>('pluginPackages',false)
  if(!connection?.fetch||!profile||!native||!settings||!resolver)return undefined
  const resolve=(name:string)=>{try{const p=resolver.packageOf(name,import.meta.url);return p?.name===name?p.dir:undefined}catch{return undefined}}
  const distributionOptions: HostDistributionOptions = {profile,native,settings,credentials:ctx.get<CredentialProvider>('credentials',false),resolve,
    directory: ctx.get<HostWorkbenchDirectory>(WORKBENCH_DIRECTORY_SERVICE, false),
    access: ctx.get<HostWorkbenchAccess>(WORKBENCH_ACCESS_SERVICE, false),
    agents: () => ctx.get<HostAgentAssemblyStore>(AGENT_ASSEMBLY_SERVICE, false),
    peerAvailable:(name,range)=>{
      if(!name.startsWith('@deepseek-ai/')&&!['react','react-dom'].includes(name))return false
      try { const p=resolver.packageOf(name,import.meta.url);if(!p?.version)return false
        // The first release accepts exact host peers. No implicit semver expansion or download.
        return p.version===range
      }catch{return false}
    },fetchArtifact:d=>fetchLockedDistributionArtifact(d,profile.dir)}
  const service=createHostDistributionService(distributionOptions)
  const migrations = ctx.get<CompleteMigrationRegistry>(WORKBENCH_COMPLETE_MIGRATIONS, false) ?? new CompleteMigrationRegistry()
  ctx.provide?.(WORKBENCH_COMPLETE_EXTENSIONS, createCompleteExtensions(distributionOptions, migrations))
  ctx.provide?.('workbenchDistributionPackagesV4',service)
  ctx.provide?.('workbenchDistributionRuntime',createHostDistributionRuntimeV4(service,WORKBENCH_CORE_VERSION))
  const actions=['export','inspect','consent','resume','complete','restore-pending','prepare-pending','cancel','history','identities'] as const
  const off=actions.map(action=>connection.fetch.register({path:`${DISTRIBUTION_ROUTE}/${action}`,methods:['POST'],requestBody:'streaming',async fetch(request){
    const reply=(status:number,value:unknown)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json','cache-control':'no-store'}})
    try{
      // Connection authenticates the owner; the LAN gateway denies this entire namespace.
      if(request.headers.get('content-type')?.split(';')[0]!=='application/json')return reply(415,{error:'需要 JSON 请求。'})
      const limit=action==='inspect'?180*1024*1024:['export','complete','restore-pending'].includes(action)?16*1024*1024:4096
      const reader=request.body?.getReader();if(!reader)throw new Error('缺少请求内容。')
      const chunks:Uint8Array[]=[];let size=0
      for(;;){const next=await reader.read();if(next.done)break;size+=next.value.length;if(size>limit){await reader.cancel();throw new Error('请求内容超限。')}chunks.push(next.value)}
      const body=JSON.parse(Buffer.concat(chunks).toString('utf8'))
      if(!body||typeof body!=='object'||Array.isArray(body))throw new Error('请求格式无效。')
      const allowed:Record<typeof action,string[]>={export:['layout','mode','prepareArtifacts','derivedFrom'],inspect:['archive'],consent:['transactionId','archiveSha256','confirmed','destination'],resume:['transactionId'],complete:['transactionId','document','consents','pendingPageIds','context'],'restore-pending':['transactionId','document','expectedDocument','restoredPageIds'],'prepare-pending':['transactionId'],cancel:['transactionId'],history:[],identities:[]}
      if(Object.keys(body).some(k=>!allowed[action].includes(k)))throw new Error('请求包含不支持的路径、命令或字段。')
      if(allowed[action].includes('transactionId')&&(typeof body.transactionId!=='string'||!/^distribution-[a-f0-9-]{36}$/u.test(body.transactionId)))throw new Error('导入记录无效。')
      let value:unknown
      if(action==='export')value=Buffer.from(await service.export(body)).toString('base64')
      else if(action==='inspect'){if(typeof body.archive!=='string'||!/^[A-Za-z0-9+/]*={0,2}$/u.test(body.archive))throw new Error('包数据无效。');value=await service.inspect(Buffer.from(body.archive,'base64'))}
      else if(action==='consent'){if(body.confirmed!==true)throw new Error('尚未确认导入。');value=await service.consent(body.transactionId,body.archiveSha256,body.destination)}
      else if(action==='resume')value=await service.resume(body.transactionId)
      else if(action==='prepare-pending')value=await service.preparePending(body.transactionId)
      else if(action==='complete')value=await service.complete(body.transactionId,body.document,body.consents,body.pendingPageIds,body.context)
      else if(action==='restore-pending')value=await service.restorePending(body.transactionId,body.document,body.expectedDocument,body.restoredPageIds)
      else if(action==='cancel')value=await service.cancel(body.transactionId)
      else if(action==='identities')value=await service.identities()
      else value=await service.history()
      return reply(200,{value})
    }catch(error){
      const message=error instanceof Error?error.message:''
      return reply(400,{error:/[一-龥]/u.test(message)&&!message.includes(profile.dir)?message:'工作台分发操作未完成；请检查包、插件状态和导入记录。'})
    }
  }}))
  return()=>{for(const dispose of off)void dispose()}
}
