import { createHash } from 'node:crypto'
import { lstat, readFile, realpath, mkdir, writeFile, rename } from 'node:fs/promises'
import { dirname, join, relative, isAbsolute } from 'node:path'
import { c } from 'tar'
import { parse as parseYaml } from 'yaml'
import { posix } from 'node:path'
import { parse as parseJavaScript } from 'acorn'
import { isBuiltin } from 'node:module'
import { readWorkbenchArtifactFiles } from './host-artifact-files.ts'
import { canonicalJson } from './foundation/workbench-sharing.ts'
import { safeRuntimePath, type WorkbenchPackageDependencyV4 } from './foundation/workbench-package-v4.ts'
import { WORKBENCH_CORE_VERSION, WORKBENCH_DSH_GENERATION } from './release-compatibility.ts'
import { workbenchEditorDeclarationFailureV1 } from './module-contract.ts'
import { portableStateSafe } from './foundation/workbench-layout-package.ts'

export const artifactHash = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex')

/**
 * RC1 exposes these browser singletons through the Client module table. They
 * are not Profile npm packages and therefore cannot be verified by resolving
 * a peer from the Host's node_modules tree. Keep this list tied to the locked
 * DSH generation; an unknown client import still needs an explicit peer.
 */
const DSH_RC1_CLIENT_SEEDS = new Set([
  'react', 'react-dom', 'react/jsx-runtime', 'react-dom/client',
  '@deepseek-ai/cordis', 'zod', '@tanstack/react-virtual',
  '@deepseek-ai/dsh-client-store', '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-modules',
  '@deepseek-ai/dsh-client-ui-primitives', '@deepseek-ai/dsh-client-ui-dockkit',
])
export interface DistributionPackageManifest {
  name: string; version: string; license?:string; exports?: Record<string, unknown>; main?: string
  scripts?: Record<string, string>; dependencies?: Record<string, string>; optionalDependencies?: Record<string, string>; peerDependencies?: Record<string, string>
  dsh: { bundle?: { patch?: string | string[] }; client?: unknown; workbench: {
    moduleId: string; coreCompatibility: string; dshGeneration: string; editorIds: string[]; permissions?: string[]
    editors?: { editorId: string; scope: 'root' | 'session' }[]
    distribution?: { version: 1; exportPolicy: 'embed' | 'reference' | 'forbid'; runtimeKind?: 'client-only' | 'client-host'; runtimeFiles: string[]; requires: string[]; registryUrl?: string }
  } }
}
export function inspectDistributionManifest(value: unknown): DistributionPackageManifest {
  const p = value as DistributionPackageManifest
  const w = p?.dsh?.workbench, d = w?.distribution
  if (!p || !/^(?:@[a-z0-9._-]+[/])?[a-z0-9][a-z0-9._-]*$/u.test(p.name) || !/^[0-9]+[.][0-9]+[.][0-9]+(?:-[A-Za-z0-9_.-]+)?$/u.test(p.version)
    || !p.dsh?.bundle?.patch || !w || w.coreCompatibility !== WORKBENCH_CORE_VERSION || w.dshGeneration !== WORKBENCH_DSH_GENERATION
    || !/^[A-Za-z0-9_.:-]{1,128}$/u.test(w.moduleId) || !d || d.version !== 1 || !['embed','reference','forbid'].includes(d.exportPolicy)
    || !Array.isArray(d.runtimeFiles) || d.runtimeFiles.length < 1 || d.runtimeFiles.length > 256 || !d.runtimeFiles.every(f => typeof f === 'string' && safeRuntimePath(f))
    || new Set(d.runtimeFiles).size !== d.runtimeFiles.length || !d.runtimeFiles.includes('package.json')
    || !Array.isArray(d.requires) || d.requires.some(p => typeof p !== 'string' || p.length > 214)
    || !Array.isArray(w.editors) || w.editors.some(e => !/^[A-Za-z0-9_.:-]{1,128}$/u.test(e.editorId) || !['root','session'].includes(e.scope))
    || !Array.isArray(w.editorIds) || canonicalJson([...w.editorIds].sort()) !== canonicalJson(w.editors.map(e => e.editorId).sort())
    || (w.permissions !== undefined && (!Array.isArray(w.permissions) || w.permissions.some(p => typeof p !== 'string' || p.length > 128)))) throw new Error('扩展缺少有效的 17.2 分发声明、内页声明或精确运行文件清单。')
  if (Object.keys(p.dependencies ?? {}).length || Object.keys(p.optionalDependencies ?? {}).length) throw new Error('扩展仍有未打入产物的 npm 依赖；请先构建自包含运行包。')
  if(w.editors!.some(e=>workbenchEditorDeclarationFailureV1(e,e.scope,e.editorId)))throw new Error('扩展内页配置与生命周期声明无效。')
  if (['preinstall','install','postinstall','prepare'].some(s => p.scripts?.[s])) throw new Error('完整包不允许依赖安装脚本。')
  if(typeof p.license!=='string'||!p.license.trim()||!d.runtimeFiles.some(f=>/^(?:LICENSE|LICENCE|COPYING)(?:[.][a-z]+)?$/iu.test(f)))throw new Error('发布清单必须包含许可声明与许可证文件。')
  if (d.runtimeFiles.some(f => /(?:^|[/])(?:src|test|tests|[.]git)(?:[/]|$)/u.test(f) || /(?:[.]ts|[.]tsx|[.]map|[.]env|[.]npmrc|[.]pnpmfile[.]cjs|npm-shrinkwrap[.]json)$/u.test(f))) throw new Error('运行文件清单包含源码、配置或安装钩子。')
  const patch = Array.isArray(p.dsh.bundle.patch) ? p.dsh.bundle.patch : [p.dsh.bundle.patch]
  const entries = [...(p.main ? [p.main] : []), ...(p.exports ? Object.values(p.exports).flatMap(v => typeof v === 'string' ? [v] : typeof v === 'object' && v ? Object.entries(v).filter(([k]) => k !== 'types').map(([,v]) => v) : []) : []), ...patch]
  if (!entries.length || entries.some(e => typeof e !== 'string' || !safeRuntimePath(e.replace(/^[.][/]/u, '')) || !d.runtimeFiles.includes(e.replace(/^[.][/]/u, '')))) throw new Error('运行入口或 Bundle 配置不在发布清单中。')
  return p
}
export async function readRuntimeFiles(root: string, paths: readonly string[]): Promise<Map<string, Buffer>> {
  const base = await realpath(root), files = new Map<string, Buffer>()
  let total = 0
  for (const p of paths) {
    if (!safeRuntimePath(p)) throw new Error('运行文件路径无效。')
    const file = join(base, p)
    let current = base
    for (const part of p.split('/')) { current = join(current, part); if ((await lstat(current)).isSymbolicLink()) throw new Error('运行制品不允许符号链接。') }
    const resolved = await realpath(file), rel = relative(base, resolved)
    if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new Error('运行制品路径越界。')
    const stat = await lstat(file)
    if (!stat.isFile() || stat.size > 64 * 1024 * 1024 || (total += stat.size) > 128 * 1024 * 1024) throw new Error('运行制品超过大小限制。')
    files.set(p, await readFile(file))
  }
  return files
}
export function runtimeDigest(files: ReadonlyMap<string, Uint8Array>): string {
  return artifactHash(canonicalJson([...files].sort(([a],[b]) => a.localeCompare(b, 'en')).map(([path, bytes]) => ({ path, sha256: artifactHash(bytes) }))))
}
export async function inspectDistributionArtifact(bytes: Uint8Array, peerAvailable: (name: string, range: string) => boolean): Promise<{ dependency: WorkbenchPackageDependencyV4; files: ReadonlyMap<string, Buffer> }> {
  const files = await readWorkbenchArtifactFiles(bytes, { requireLegacyClient: false })
  const manifest = inspectDistributionManifest(JSON.parse(files.get('package.json')!.toString('utf8')))
  verifyDistributionClosure(manifest,files,peerAvailable)
  const d = manifest.dsh.workbench.distribution!
  const patches = manifest.dsh.bundle!.patch!
  const bundleEntries = (Array.isArray(patches) ? patches : [patches]).flatMap(path => {
    const ops = parseYaml(files.get(path.replace(/^[.][/]/u,''))!.toString('utf8'), {maxAliasCount:0}) as {insert:{id:string;name:string}[]}[]
    return ops.flatMap(op => op.insert.map(entry => ({entryId:entry.id,moduleName:entry.name})))
  })
  if(new Set(bundleEntries.map(e=>e.entryId)).size!==bundleEntries.length)throw new Error('Bundle 入口 ID 重复。')
  if(d.runtimeKind!==undefined&&!['client-only','client-host'].includes(d.runtimeKind))throw new Error('扩展运行类型无效。')
  if(d.runtimeKind==='client-only'){
    // RC1 discovers clients from Loader rows and still needs an inert shim.
    const entry=manifest.main??manifest.exports?.['.']
    if(!manifest.dsh.client||typeof entry!=='string')throw new Error('客户端扩展缺少原生注册入口。')
    const source=files.get(entry.replace(/^[.][/]/u,''))?.toString('utf8').replace(/[/][*][\s\S]*?[*][/]|[/][/][^\r\n]*/gu,'').replace(/\s+/gu,'').replace(/;$/u,'')
    if(source!=='exportfunctionapply(){}')throw new Error('client-only 只能包含空 Host 注册入口；有 Host 功能时须声明 client-host。')
  }
  if (files.size !== d.runtimeFiles.length || d.runtimeFiles.some(f => !files.has(f))) throw new Error('安装包与精确运行文件清单不一致。')
  for (const [name, range] of Object.entries(manifest.peerDependencies ?? {})) {
    if (DSH_RC1_CLIENT_SEEDS.has(name)) continue
    if (!peerAvailable(name, range)) throw new Error(`宿主未提供已验证的依赖：${name}`)
  }
  if (d.exportPolicy === 'forbid') throw new Error('扩展禁止完整分发。')
  return { files, dependency: { packageName: manifest.name, version: manifest.version, moduleId: manifest.dsh.workbench.moduleId,
    digest: runtimeDigest(files), archiveSha256: artifactHash(bytes), integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}`, bundleEntries,
    editorScopes: manifest.dsh.workbench.editors!.map(({editorId,scope})=>({editorId,scope})), permissions: [...new Set(manifest.dsh.workbench.permissions ?? [])].sort(),
    exportPolicy: d.exportPolicy, runtimeFiles: [...d.runtimeFiles], requires: [...d.requires], host: d.runtimeKind!=='client-only' && (!!manifest.main || !!manifest.exports?.['.']),
    ...(d.registryUrl ? { registryUrl: d.registryUrl } : {}) } }
}
export async function prepareDistributionArtifact(root: string, peerAvailable: (name: string, range: string) => boolean): Promise<{ bytes: Uint8Array; dependency: WorkbenchPackageDependencyV4 }> {
  const manifest = inspectDistributionManifest(JSON.parse(await readFile(join(root, 'package.json'), 'utf8')))
  const paths = manifest.dsh.workbench.distribution!.runtimeFiles
  const before = await readRuntimeFiles(root, paths)
  const chunks: Buffer[] = []
  for await (const chunk of c({ cwd: root, prefix: 'package/', gzip: true, portable: true, noMtime: true, follow: false }, paths)) chunks.push(Buffer.from(chunk))
  const bytes = new Uint8Array(Buffer.concat(chunks))
  const checked = await inspectDistributionArtifact(bytes, peerAvailable)
  if (runtimeDigest(before) !== checked.dependency.digest || runtimeDigest(await readRuntimeFiles(root, paths)) !== checked.dependency.digest) throw new Error('扩展文件在准备过程中发生变化，请重试。')
  return { bytes, dependency: checked.dependency }
}
export async function atomicDistributionJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${crypto.randomUUID()}.tmp`
  await writeFile(temporary, JSON.stringify(value), { flag: 'wx', mode: 0o600 })
  await rename(temporary, path)
}

/** Conservative release closure: no package discovery, install hooks or external file entries. */
export function verifyDistributionClosure(manifest:DistributionPackageManifest,files:ReadonlyMap<string,Buffer>,peerAvailable:(name:string,range:string)=>boolean):void {
  const allowed=new Set(files.keys()),own=manifest.name,requires=manifest.dsh.workbench.distribution!.requires
  const clientEntry = typeof manifest.exports?.['./client'] === 'string'
    ? manifest.exports['./client'].replace(/^[.][/]/u, '')
    : 'client.js'
  const check=(specifier:string,from:string)=>{
    if(isBuiltin(specifier)){
      if(manifest.dsh.workbench.distribution!.runtimeKind==='client-only')throw new Error('客户端扩展不能依赖 Node Host 能力。')
      return
    }
    if(specifier.startsWith('.')){
      const path=posix.normalize(posix.join(posix.dirname(from),specifier))
      if(!safeRuntimePath(path)||!allowed.has(path))throw new Error('运行制品引用了未收集的文件：'+path)
      return
    }
    const name=specifier.startsWith('@')?specifier.split('/').slice(0,2).join('/'):specifier.split('/')[0]!
    if(name===own||requires.includes(name))return
    // DSH's RC1 browser seeds are supplied by the Client module table. A
    // package.json client declaration and the package's client entry may name
    // them without a Profile peer; Host entries remain subject to peer checks.
    if(DSH_RC1_CLIENT_SEEDS.has(specifier) || DSH_RC1_CLIENT_SEEDS.has(name)) {
      if(from === 'package.json' || from === clientEntry) return
    }
    const range=manifest.peerDependencies?.[name]
    if(!range||!peerAvailable(name,range))throw new Error('运行制品引用了未验证的宿主依赖：'+name)
  }
  for(const [path,bytes] of files){
    if(!/[.](?:c?js|mjs)$/u.test(path))continue
    const source=bytes.toString('utf8')
    const tree=parseJavaScript(source,{ecmaVersion:'latest',sourceType:'module',allowReturnOutsideFunction:true})
    const literal=(node:unknown):string=>{
      const value=node as {type?:string;value?:unknown}
      if(value?.type!=='Literal'||typeof value.value!=='string')throw new Error('动态模块或资源路径不能证明自包含，请先将依赖打入运行产物。')
      return value.value
    }
    const walk=(value:unknown):void=>{
      if(!value||typeof value!=='object')return
      if(Array.isArray(value)){value.forEach(walk);return}
      const node=value as Record<string,any>
      if(['ImportDeclaration','ExportNamedDeclaration','ExportAllDeclaration'].includes(node.type)&&node.source)check(literal(node.source),path)
      if(node.type==='ImportExpression')check(literal(node.source),path)
      if(node.type==='CallExpression'){
        const callee=node.callee
        if(callee?.type==='Identifier'&&callee.name==='require')check(literal(node.arguments[0]),path)
        if(callee?.type==='MemberExpression'&&callee.object?.name==='module'&&callee.property?.name==='require')throw new Error('请使用可静态核对的模块入口。')
        if(callee?.name==='eval'||callee?.name==='Function'||callee?.name==='createRequire')throw new Error('动态执行或模块加载入口不能用于自包含分发。')
        const operation=callee?.name??callee?.property?.name
        if(['readFile','readFileSync','createReadStream','readlink','readlinkSync'].includes(operation)){
          const resource=literal(node.arguments[0])
          if(!resource.startsWith('./'))throw new Error('文件资源必须使用发布清单内的相对路径。')
          check(resource,path)
        }
      }
      if(node.type==='NewExpression'&&node.callee?.name==='Function')throw new Error('动态执行入口不能用于自包含分发。')
      if(node.type==='NewExpression'&&node.callee?.name==='URL'&&node.arguments[1]?.type==='MemberExpression'&&node.arguments[1]?.object?.type==='MetaProperty')check(literal(node.arguments[0]),path)
      Object.values(node).forEach(walk)
    }
    walk(tree)
  }
  const client=manifest.dsh.client as {inject?:unknown;external?:unknown}|undefined
  for(const field of ['inject','external'] as const){
    const values=client?.[field]
    if(values===undefined)continue
    if(!Array.isArray(values)||values.some(v=>typeof v!=='string'))throw new Error('客户端宿主依赖声明无效。')
    for(const name of values)check(name,'package.json')
  }
  const patches=manifest.dsh.bundle!.patch!
  for(const path of Array.isArray(patches)?patches:[patches]){
    const value=parseYaml(files.get(path.replace(/^[.][/]/u,''))!.toString('utf8'),{maxAliasCount:0}) as unknown
    if(!Array.isArray(value)||!value.length)throw new Error('Bundle 配置必须是受限的插件插入清单。')
    for(const operation of value){
      if(!operation||typeof operation!=='object'||Object.keys(operation).some(k=>k!=='insert')||!Array.isArray(operation.insert))throw new Error('Bundle 分发只允许插入本包运行入口。')
      for(const entry of operation.insert){
        if(typeof entry?.id!=='string'||!/^[A-Za-z0-9_.:-]{1,128}$/u.test(entry.id))throw new Error('Bundle 分发入口必须有明确且唯一的 ID。')
        if(entry?.config!==undefined&&!portableStateSafe(entry.config))throw new Error('Bundle 配置包含凭据、本机路径或无法迁移的数据。')
        if(manifest.dsh.workbench.distribution!.runtimeKind==='client-only'&&entry?.name!==own)throw new Error('client-only Bundle 只能加载本包的空 Host 入口。')
        if(!entry||typeof entry.name!=='string'||!(entry.name===own||entry.name.startsWith(own+'/'))||Object.keys(entry).some(k=>!['id','name','config','disabled'].includes(k)))throw new Error('Bundle 配置包含外部插件或不支持的操作。')
        if(entry.name!==own){const key='.'+entry.name.slice(own.length);if(!manifest.exports?.[key])throw new Error('Bundle 内页入口未在包 exports 声明。')}
      }
    }
  }
}
