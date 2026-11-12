import { readFile, writeFile, unlink } from 'node:fs/promises'
import { join, resolve, dirname } from 'node:path'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { runProfilePnpm, saveManifest } from '@deepseek-ai/dsh-plugin-manager/operations'
import type { ProfileContext } from '@deepseek-ai/dsh-app-boot'
import type { WorkbenchPackageDependencyV4 } from './foundation/workbench-package-v4.ts'
import { artifactHash, readRuntimeFiles, runtimeDigest } from './host-distribution-artifacts.ts'
import {verifyNativeResolvedArtifactFiles} from './host-artifact-files.ts'

export class DistributionInstallError extends Error {
  constructor(message:string, readonly repaired:boolean) { super(message) }
}

export interface DistributionNativeManager {
  listBundles(): Promise<{ name: string; version?: string; installed: boolean; enabled: boolean; source?:string; availability?:string; readOnlyReason?: string; rows?: { moduleName: string; entryId?: string }[] }[]>
  listPlugins(): Promise<{ moduleName: string; entryId: string; enabled: boolean; fiberPhase?: string | null }[]>
  setBundleEnabled(name: string, enabled: boolean): Promise<{ application: string }>
}
export function createDistributionInstaller(options: { profile: ProfileContext; native: DistributionNativeManager; resolve(name: string): string | undefined }) {
  const verified = async (d: WorkbenchPackageDependencyV4) => {
    const root = options.resolve(d.packageName) ?? join(options.profile.dir, 'node_modules', d.packageName)
    const files=await readRuntimeFiles(root,d.runtimeFiles)
    await verifyNativeResolvedArtifactFiles(root,files)
    if (runtimeDigest(await readRuntimeFiles(root, d.runtimeFiles)) !== d.digest) throw new Error(`已安装扩展内容不一致：${d.packageName} ${d.version}。版本号相同，但属于不同构建；本次不会覆盖本机插件。`)
  }
  const check = async (d: WorkbenchPackageDependencyV4) => {
    const bundles = await options.native.listBundles()
    const plugins = await options.native.listPlugins()
    if(bundles.some(b=>b.name===d.packageName&&(b.availability==='installation'||(!b.installed&&b.version!==undefined))))throw new Error('插件由宿主安装提供，不能自动覆盖；请在 DSH 原生管理器处理：'+d.packageName)
    for (const entry of d.bundleEntries) {
      if (bundles.some(b => b.name !== d.packageName && (b.installed || b.enabled) && b.rows?.some(r => r.entryId === entry.entryId)) || plugins.some(p => p.entryId === entry.entryId && p.moduleName !== entry.moduleName)) throw new Error('Bundle 入口与已有插件冲突，请先在 DSH 插件管理器处理：'+entry.entryId)
    }
    const row = bundles.find(b => b.name === d.packageName && b.installed)
    if (!row) return { present: false, enabled: false }
    if (row.version !== d.version) throw new Error(`插件版本冲突：${d.packageName}，包要求 ${d.version}，本机已安装 ${row.version ?? '未知版本'}。尚未验证跨版本兼容，请在 DSH 插件管理器处理后继续；本次不会自动升级或降级。`)
    if (row.readOnlyReason) throw new Error(`已有插件不可修改：${d.packageName} ${row.version}。请在 DSH 插件管理器处理。`)
    await verified(d)
    return { present: true, enabled: row.enabled }
  }
  const run = async (args: string[], network: boolean, signal?: AbortSignal) => runProfilePnpm({ ...options.profile, profile: options.profile.name }, args, {
    execution: 'service', outputBytes: 32768, idleTimeoutMs: 60000, activateNewBundles: false,
    ...options.profile.packageManager, ...(signal ? { signal } : {}),
    args: [...options.profile.packageManager?.args ?? [], '--config.ignore-scripts=true', '--config.ignore-pnpmfile=true', '--config.auto-install-peers=false', ...network ? [] : ['--config.offline=true']],
  })
  return { check, verified,
    async install(d: WorkbenchPackageDependencyV4, path: string, before: () => Promise<void>, signal?: AbortSignal) {
      return withFileLock(join(options.profile.dir, 'package.json'), async () => {
        const existing = await check(d)
        if (existing.present) return { reused: true, previousEnabled: existing.enabled }
        if (artifactHash(await readFile(path)) !== d.archiveSha256) throw new Error('暂存安装包摘要不一致。')
        const saved = await Promise.all(['package.json','pnpm-lock.yaml'].map(async name => ({ name, bytes: await readFile(join(options.profile.dir,name)).catch(() => undefined) })))
        await before()
        try {
          const result = await run(['add', path, '--save-exact'], false, signal)
          if (result.exitCode !== 0 || result.timedOut) throw new Error('原生离线安装未完成；未联网补齐依赖。')
          await verified(d)
          return { reused: false, previousEnabled: false }
        } catch (error) {
          for (const f of saved) { const path = join(options.profile.dir,f.name); if (f.bytes) await writeFileAtomic(path, f.bytes.toString('utf8'), { mode: 0o600 }); else await unlink(path).catch(() => {}) }
          const repair = await run(['install', saved[1]?.bytes ? '--frozen-lockfile' : '--config.lockfile=false'], false)
          if (repair.exitCode !== 0 || repair.timedOut) throw new DistributionInstallError('原生安装失败，Profile 修复未完成。',false)
          throw new DistributionInstallError(error instanceof Error?error.message:'原生安装失败，已恢复原设置。',true)
        }
      })
    },
    async reconcile(d:WorkbenchPackageDependencyV4,path:string) {
      return withFileLock(join(options.profile.dir,'package.json'),async()=>{
        const manifest=JSON.parse(await readFile(join(options.profile.dir,'package.json'),'utf8'))
        const spec=manifest.dependencies?.[d.packageName]
        const installed=await check(d)
        if(!installed.present&&!spec)return 'absent' as const
        if(typeof spec==='string'&&spec.startsWith('file:')&&resolve(options.profile.dir,spec.slice(5))===resolve(path)){
          await verified(d);return 'owned' as const
        }
        throw new Error('中断安装的归属无法核实，请在 DSH 原生插件管理器处理。')
      })
    },
    async enable(d: WorkbenchPackageDependencyV4, enabled: boolean, beforeChange?:(selectionDigest:string)=>Promise<void>, expectedSelection?:string) {
      // Native setBundleEnabled owns the same non-reentrant lock but offers no
      // identity CAS. Persist the authorized selection through its public
      // manifest operation while holding the lock; activate only after restart.
      return withFileLock(join(options.profile.dir,'package.json'),async()=>{
        if (!(await check(d)).present) throw new Error('扩展已被其他操作移除，未更改其开关。')
        const manifest=JSON.parse(await readFile(join(options.profile.dir,'package.json'),'utf8'))
        const bundles:string[]=manifest.dsh?.profile?.bundles??[]
        const digest=(names:string[])=>artifactHash(JSON.stringify([...names].sort()))
        if(expectedSelection && digest(bundles)!==expectedSelection)throw new Error('插件选择已被其他操作更改，未覆盖；请在原生管理器核对后处理恢复。')
        const changed=bundles.includes(d.packageName)!==enabled
        if(changed){
          const next=enabled?[...bundles,d.packageName]:bundles.filter(n=>n!==d.packageName)
          await beforeChange?.(digest(next))
          manifest.dsh={...manifest.dsh,profile:{...manifest.dsh?.profile,bundles:next}}
          await saveManifest(options.profile.dir,manifest)
        }
        const plugins=await options.native.listPlugins()
        const active=plugins.some(p=>(p.moduleName===d.packageName||p.moduleName.startsWith(d.packageName+'/'))&&p.enabled&&p.fiberPhase==='active')
        return enabled ? changed || !active : active
      })
    },
    async running(d: WorkbenchPackageDependencyV4) {
      await verified(d)
      const bundle = (await options.native.listBundles()).find(b => b.name === d.packageName && b.enabled)
      const plugins = await options.native.listPlugins()
      return !!bundle?.rows?.length && bundle.rows.every(row => plugins.some(p => p.moduleName === row.moduleName && p.entryId === row.entryId && p.enabled && p.fiberPhase === 'active'))
    },
    async remove(d: WorkbenchPackageDependencyV4, expectedArtifact?:string) {
      return withFileLock(join(options.profile.dir,'package.json'), async () => {
        const current=JSON.parse(await readFile(join(options.profile.dir,'package.json'),'utf8'))
        // Reconcile a successful removal followed by a journal-write crash.
        if(!current.dependencies?.[d.packageName] && !(await options.native.listBundles()).some(b=>b.name===d.packageName&&b.installed))return
        if(current.dsh?.profile?.bundles?.includes(d.packageName)||(await options.native.listPlugins()).some(p=>(p.moduleName===d.packageName||p.moduleName.startsWith(d.packageName+'/'))&&p.enabled&&p.fiberPhase==='active'))throw new Error('扩展仍被选中或正在运行，未删除；请先在原生管理器停用并重启。')
        if(expectedArtifact){
          const manifest=JSON.parse(await readFile(join(options.profile.dir,'package.json'),'utf8')),spec=manifest.dependencies?.[d.packageName]
          if(typeof spec!=='string'||!spec.startsWith('file:')||resolve(options.profile.dir,spec.slice(5))!==resolve(expectedArtifact))throw new Error('扩展已被其他操作修改，未回退非本事务资产。')
        }
        await verified(d)
        const result = await run(['remove',d.packageName],false)
        if (result.exitCode !== 0) throw new Error('原生插件回退未完成。')
      })
    },
  }
}
