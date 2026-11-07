import { canonicalJson, decodeDeterministicZip, encodeDeterministicZip, sha256Hex as legacySha256, type WorkbenchPackageFileV1 } from './workbench-sharing.ts'
import { validatePortableLayout, type PortableLayoutV2 } from './workbench-layout-package.ts'
import { renderPortableAreaContextMarkdown, renderPortableWorkbenchContextMarkdown, validatePortableWorkbenchContext } from './workbench-context-portability.ts'
import { WORKBENCH_CORE_VERSION, WORKBENCH_DSH_GENERATION, isWorkbenchCorePackageName } from '../release-compatibility.ts'
import { CORE_PORTABLE_EDITORS } from '../distribution-contract.ts'
import { areasOf, type WorkbenchDocumentV3, type WorkbenchNodeV3 } from './document-v3.ts'

/** Compare signed geometry, retained order and selection independently of recipient IDs. */
export function distributionLayoutShape(document: WorkbenchDocumentV3): string {
  const areas = areasOf(document.root)
  const visit = (node:WorkbenchNodeV3):unknown => node.kind === 'split'
    ? {kind:node.kind,axis:node.axis,ratio:node.ratio,first:visit(node.first),second:visit(node.second)}
    : {kind:node.kind,selected:node.moduleHistory.findIndex(p=>p.moduleInstanceId===node.activeModuleInstanceId),pages:node.moduleHistory.map(p=>({editorId:p.editorId,scope:p.editorScope,title:p.lastKnownTitle}))}
  return canonicalJson({active:areas.findIndex(a=>a.areaId===document.activeAreaId),root:visit(document.root)})
}
export function sameDistributionArtifact(actual: WorkbenchPackageDependencyV4, locked: WorkbenchPackageDependencyV4): boolean {
  const strip = ({archivePath:_path,...value}:WorkbenchPackageDependencyV4) => value
  return canonicalJson(strip(actual)) === canonicalJson(strip(locked))
}

export type WorkbenchPackageModeV4 = 'layout-only' | 'online-reference' | 'offline-embedded'
/** Dependencies are installed and enabled before consumers; reject cycles. */
export function orderedDistributionDependencies(rows:WorkbenchPackageDependencyV4[]):WorkbenchPackageDependencyV4[]{
  const result:WorkbenchPackageDependencyV4[]=[],visiting=new Set<string>(),done=new Set<string>()
  const visit=(row:WorkbenchPackageDependencyV4)=>{
    if(done.has(row.packageName))return
    if(visiting.has(row.packageName))throw new Error('扩展依赖包含循环，无法安全确定启用顺序。')
    visiting.add(row.packageName)
    for(const name of row.requires){const dependency=rows.find(d=>d.packageName===name);if(!dependency)throw new Error('工作台依赖闭包不完整。');visit(dependency)}
    visiting.delete(row.packageName);done.add(row.packageName);result.push(row)
  }
  rows.forEach(visit);return result
}
export interface WorkbenchPackageDependencyV4 {
  packageName: string; version: string; moduleId: string; digest: string; archiveSha256: string; integrity: string
  editorScopes: { editorId: string; scope: 'root' | 'session' }[]
  permissions: string[]; exportPolicy: 'embed' | 'reference'; runtimeFiles: string[]
  requires: string[]; host: boolean; archivePath?: string; registryUrl?: string
  bundleEntries: { entryId: string; moduleName: string }[]
}
export interface WorkbenchPackageManifestV4 {
  schemaVersion: 4; format: 'dsh-workbench-package'; mode: WorkbenchPackageModeV4
  packageId: string; version: string; name: string; createdAt: string
  compatibility: { core: string; dsh: string; portableLayout: 2 | 3 }
  dependencies: WorkbenchPackageDependencyV4[]; permissions: string[]
  files: { path: string; size: number; sha256: string }[]
  publisher?: { displayName: string; keyId: string; publicKey: string }
  derivedFrom?: { packageId: string; version: string; archiveSha256: string }
}
export interface WorkbenchSignatureV4 { algorithm: 'ed25519'; keyId: string; signature: string }
export interface WorkbenchPackagePreviewV4 {
  digest: string; manifest: WorkbenchPackageManifestV4; layout: PortableLayoutV2
  files: readonly WorkbenchPackageFileV1[]; signature?: WorkbenchSignatureV4
}
export const PACKAGE_V4_LIMITS = { maxEntries: 128, maxFileBytes: 64 * 1024 * 1024, maxTotalBytes: 128 * 1024 * 1024 }
const sha256Hex = async (bytes: Uint8Array) => (await legacySha256(bytes)).toLowerCase()
const hex = /^[a-f0-9]{64}$/u
const name = /^(?:@[a-z0-9._-]+[/])?[a-z0-9][a-z0-9._-]*$/u
const enc = (value: unknown) => new TextEncoder().encode(canonicalJson(value))
const json = (bytes: Uint8Array) => JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown
const obj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const only = (v: object, allowed: string[]) => Object.keys(v).every(k => allowed.includes(k))
const strings = (v: unknown): v is string[] => Array.isArray(v) && v.length <= 256 && v.every(x => typeof x === 'string' && x.length > 0 && x.length <= 512) && new Set(v).size === v.length
export function safeRuntimePath(path: string): boolean {
  if (path === 'context.json' || path === 'context/工作台整体背景说明.md' || /^context\/areas\/[A-Za-z0-9._:-]{1,128}-区域说明\.md$/u.test(path)) return true
  return path.length <= 240 && path.split('/').every(p => /^[a-zA-Z0-9@_+.-]+$/u.test(p) && p !== '.' && p !== '..' && !p.endsWith('.') && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:[.]|$)/iu.test(p))
    && !path.split('/').some(p => ['node_modules', '.git', '.env'].includes(p) || p.endsWith('.map'))
}
export function signingBytesV4(manifest: WorkbenchPackageManifestV4): Uint8Array { return enc(manifest) }
export async function publisherKeyIdV4(publicKey: string): Promise<string> {
  if (!/^[A-Za-z0-9+/]{43}=$/u.test(publicKey)) throw new Error('发布者公钥无效。')
  return sha256Hex(Uint8Array.from(atob(publicKey), c => c.charCodeAt(0)))
}
export async function buildWorkbenchPackageV4(input: {
  layout: PortableLayoutV2; mode: WorkbenchPackageModeV4; dependencies?: WorkbenchPackageDependencyV4[]
  artifacts?: readonly WorkbenchPackageFileV1[]; publisher?: WorkbenchPackageManifestV4['publisher']
  derivedFrom?: WorkbenchPackageManifestV4['derivedFrom']; sign?: (bytes: Uint8Array) => Promise<string>
}): Promise<Uint8Array> {
  validatePortableLayout(input.layout)
  const contextFiles = input.layout.context === undefined ? [] : [
    { path: 'context.json', content: enc(input.layout.context) },
    { path: 'context/工作台整体背景说明.md', content: new TextEncoder().encode(renderPortableWorkbenchContextMarkdown(input.layout.context)) },
    ...Object.keys(input.layout.context.areas).sort().map(areaKey => ({ path: `context/areas/${areaKey}-区域说明.md`, content: new TextEncoder().encode(renderPortableAreaContextMarkdown(input.layout.context!, areaKey)) })),
  ]
  const files = [{ path: 'workbench.json', content: enc(input.layout) }, ...contextFiles, ...(input.artifacts ?? [])]
  const dependencies = input.dependencies ?? []
  const manifest: WorkbenchPackageManifestV4 = { schemaVersion: 4, format: 'dsh-workbench-package', mode: input.mode,
    packageId: await sha256Hex(enc({ layout: input.layout, dependencies, mode: input.mode })), version: WORKBENCH_CORE_VERSION, name: input.layout.name, createdAt: new Date().toISOString(),
    compatibility: { core: WORKBENCH_CORE_VERSION, dsh: WORKBENCH_DSH_GENERATION, portableLayout: input.layout.context === undefined ? 2 : 3 }, dependencies,
    permissions: [...new Set(dependencies.flatMap(d => d.permissions))].sort(),
    files: await Promise.all(files.map(async f => ({ path: f.path, size: f.content.length, sha256: await sha256Hex(f.content) }))),
    ...(input.publisher ? { publisher: input.publisher } : {}), ...(input.derivedFrom ? { derivedFrom: input.derivedFrom } : {}) }
  if (input.mode !== 'layout-only') {
    if (!input.publisher || !input.sign) throw new Error('完整包必须由 Host 签名。')
    files.push({ path: 'signature.json', content: enc({ algorithm: 'ed25519', keyId: input.publisher.keyId, signature: await input.sign(signingBytesV4(manifest)) }) })
  }
  const bytes = encodeDeterministicZip([{ path: 'manifest.json', content: enc(manifest) }, ...files])
  await inspectWorkbenchPackageV4(bytes)
  return bytes
}
export async function inspectWorkbenchPackageV4(bytes: Uint8Array): Promise<WorkbenchPackagePreviewV4> {
  const files = decodeDeterministicZip(bytes, PACKAGE_V4_LIMITS)
  const byPath = new Map(files.map(f => [f.path, f.content]))
  const raw = json(byPath.get('manifest.json') ?? new Uint8Array())
  if (!obj(raw) || raw.schemaVersion !== 4 || raw.format !== 'dsh-workbench-package' || !['layout-only', 'online-reference', 'offline-embedded'].includes(String(raw.mode))
    || Object.keys(raw).some(k => !['schemaVersion','format','mode','packageId','version','name','createdAt','compatibility','dependencies','permissions','files','publisher','derivedFrom'].includes(k))
    || typeof raw.packageId !== 'string' || !hex.test(raw.packageId) || typeof raw.name !== 'string' || !raw.name || raw.name.length > 160
    || typeof raw.createdAt !== 'string' || !Number.isFinite(Date.parse(raw.createdAt)) || raw.version !== WORKBENCH_CORE_VERSION
    || !obj(raw.compatibility) || raw.compatibility.core !== WORKBENCH_CORE_VERSION || raw.compatibility.dsh !== WORKBENCH_DSH_GENERATION || ![2, 3].includes(raw.compatibility.portableLayout as number)
    || !Array.isArray(raw.dependencies) || raw.dependencies.length > 32 || !strings(raw.permissions) || !Array.isArray(raw.files) || raw.files.length > 64) throw new Error('工作台 V4 包格式或版本不兼容。')
  const manifest = raw as unknown as WorkbenchPackageManifestV4
  if (!only(manifest.compatibility, ['core','dsh','portableLayout'])
    || (manifest.derivedFrom !== undefined && (!obj(manifest.derivedFrom) || !only(manifest.derivedFrom,['packageId','version','archiveSha256']) || typeof manifest.derivedFrom.packageId !== 'string' || manifest.derivedFrom.packageId.length > 214 || typeof manifest.derivedFrom.version !== 'string' || manifest.derivedFrom.version.length > 128 || !hex.test(manifest.derivedFrom.archiveSha256)))
    || (manifest.publisher !== undefined && (!obj(manifest.publisher) || !only(manifest.publisher,['displayName','keyId','publicKey']) || typeof manifest.publisher.displayName !== 'string' || !manifest.publisher.displayName.trim() || manifest.publisher.displayName.length > 160 || typeof manifest.publisher.publicKey !== 'string' || !hex.test(manifest.publisher.keyId)))) throw new Error('发布者、来源关系或兼容声明无效。')
  const declared = new Set(['manifest.json', ...(manifest.mode === 'layout-only' ? [] : ['signature.json'])])
  for (const f of manifest.files) {
    if (!obj(f) || !only(f,['path','size','sha256']) || typeof f.path !== 'string' || !safeRuntimePath(f.path) || declared.has(f.path) || !Number.isSafeInteger(f.size) || f.size < 0 || !hex.test(f.sha256)) throw new Error('工作台包文件清单无效。')
    declared.add(f.path)
    const content = byPath.get(f.path)
    if (!content || content.length !== f.size || await sha256Hex(content) !== f.sha256) throw new Error('工作台包文件摘要不匹配。')
  }
  if (declared.size !== files.length || files.some(f => !declared.has(f.path)) || !declared.has('workbench.json')) throw new Error('工作台包包含未声明文件。')
  const packages = new Set<string>(), editors = new Set<string>(), bundleIds = new Set<string>()
  for (const d of manifest.dependencies) {
    if (!obj(d) || !only(d,['packageName','version','moduleId','digest','archiveSha256','integrity','editorScopes','permissions','exportPolicy','runtimeFiles','requires','host','archivePath','registryUrl','bundleEntries'])) throw new Error('扩展依赖锁包含未知字段。')
    if (!obj(d) || typeof d.packageName !== 'string' || !name.test(d.packageName) || packages.has(d.packageName) || typeof d.version !== 'string' || !/^[0-9]+[.][0-9]+[.][0-9]+(?:-[A-Za-z0-9_.-]+)?$/u.test(d.version)
      || typeof d.moduleId !== 'string' || !/^[A-Za-z0-9_.:-]{1,128}$/u.test(d.moduleId) || !hex.test(d.digest) || !hex.test(d.archiveSha256) || !/^sha512-[A-Za-z0-9+/]+={0,2}$/u.test(d.integrity)
      || !strings(d.permissions) || !strings(d.runtimeFiles) || !d.runtimeFiles.includes('package.json') || !d.runtimeFiles.every(safeRuntimePath) || !strings(d.requires) || !d.requires.every(p => name.test(p) && p !== d.packageName) || typeof d.host !== 'boolean' || !['embed','reference'].includes(d.exportPolicy)
      || !Array.isArray(d.editorScopes) || d.editorScopes.length > 32) throw new Error('扩展依赖锁无效。')
    packages.add(d.packageName)
    if (!Array.isArray(d.bundleEntries) || !d.bundleEntries.length || d.bundleEntries.length > 64) throw new Error('Bundle 入口清单无效。')
    for (const entry of d.bundleEntries) {
      if (!obj(entry) || !only(entry,['entryId','moduleName']) || typeof entry.entryId !== 'string' || !/^[A-Za-z0-9_.:-]{1,128}$/u.test(entry.entryId) || bundleIds.has(entry.entryId) || typeof entry.moduleName !== 'string' || !(entry.moduleName === d.packageName || entry.moduleName.startsWith(d.packageName+'/'))) throw new Error('Bundle 入口 ID 重复或无效。')
      bundleIds.add(entry.entryId)
    }
    for (const e of d.editorScopes) {
      if(!obj(e)||!only(e,['editorId','scope']))throw new Error('扩展内页身份包含未知字段。')
      if (!obj(e) || typeof e.editorId !== 'string' || !/^[A-Za-z0-9_.:-]{1,128}$/u.test(e.editorId) || !['root','session'].includes(e.scope) || editors.has(`${e.scope}:${e.editorId}`)) throw new Error('扩展内页身份重复或无效。')
      editors.add(`${e.scope}:${e.editorId}`)
    }
    if (manifest.mode === 'offline-embedded') {
      if (d.exportPolicy !== 'embed' || d.archivePath !== `artifacts/${d.archiveSha256}.tgz` || !byPath.has(d.archivePath) || await sha256Hex(byPath.get(d.archivePath)!) !== d.archiveSha256) throw new Error('离线包缺少锁定的安装制品。')
    } else if (manifest.mode === 'online-reference') {
      if (d.archivePath || typeof d.registryUrl !== 'string') throw new Error('在线包缺少锁定来源。')
      const url = new URL(d.registryUrl)
      if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('在线来源必须是无凭据的 HTTPS Registry。')
    }
  }
  if (manifest.dependencies.some(d => d.requires.some(p => !packages.has(p)))) throw new Error('工作台依赖闭包不完整。')
  orderedDistributionDependencies(manifest.dependencies)
  if (canonicalJson([...new Set(manifest.dependencies.flatMap(d => d.permissions))].sort()) !== canonicalJson(manifest.permissions)) throw new Error('权限清单与依赖不一致。')
  const layoutForCount = json(byPath.get('workbench.json') ?? new Uint8Array()) as { context?: { areas?: Record<string, unknown> } }
  const contextFileCount = manifest.compatibility.portableLayout === 3 ? 2 + Object.keys(layoutForCount.context?.areas ?? {}).length : 0
  if (manifest.mode === 'layout-only' && (manifest.dependencies.length || files.length !== 2 + contextFileCount || manifest.publisher)) throw new Error('布局分享不能包含可执行制品。')
  if (manifest.mode === 'online-reference' && files.length !== 3 + contextFileCount) throw new Error('在线引用不能包含隐式制品。')
  if (manifest.mode === 'offline-embedded' && files.length !== 3 + manifest.dependencies.length + contextFileCount) throw new Error('离线包包含依赖锁之外的制品。')
  const layout = json(byPath.get('workbench.json')!)
  validatePortableLayout(layout)
  if (manifest.compatibility.portableLayout === 2 && layout.context !== undefined) throw new Error('布局版本与 Context 不一致')
  if (manifest.compatibility.portableLayout === 3) {
    if (layout.context === undefined) throw new Error('布局版本缺少 Context')
    const context = json(byPath.get('context.json') ?? new Uint8Array())
    validatePortableWorkbenchContext(context)
    if (canonicalJson(context) !== canonicalJson(layout.context)) throw new Error('context.json 与 workbench.json 不一致')
    const markdown = byPath.get('context/工作台整体背景说明.md')
    if (!markdown || new TextDecoder('utf-8', { fatal: true }).decode(markdown) !== renderPortableWorkbenchContextMarkdown(context)) throw new Error('工作台 Context Markdown 缺失或已过期')
    for (const areaKey of Object.keys(context.areas)) {
      const areaMarkdown = byPath.get(`context/areas/${areaKey}-区域说明.md`)
      if (!areaMarkdown || new TextDecoder('utf-8', { fatal: true }).decode(areaMarkdown) !== renderPortableAreaContextMarkdown(context, areaKey)) throw new Error('区域 Context Markdown 缺失或已过期: ' + areaKey)
    }
  }
  if (layout.name !== manifest.name || manifest.packageId !== await sha256Hex(enc({layout, dependencies:manifest.dependencies, mode:manifest.mode}))) throw new Error('包身份与工作台内容不一致。')
  let signature: WorkbenchSignatureV4 | undefined
  if (manifest.mode !== 'layout-only') {
    const s = json(byPath.get('signature.json') ?? new Uint8Array())
    if(!obj(s)||!only(s,['algorithm','keyId','signature']))throw new Error('签名结构无效。')
    if (!manifest.publisher || !obj(s) || s.algorithm !== 'ed25519' || typeof s.signature !== 'string' || !/^[A-Za-z0-9+/]{86}==$/u.test(s.signature)
      || s.keyId !== manifest.publisher.keyId || await publisherKeyIdV4(manifest.publisher.publicKey) !== s.keyId) throw new Error('发布者签名身份无效。')
    signature = s as unknown as WorkbenchSignatureV4
    const key = await crypto.subtle.importKey('raw', Uint8Array.from(atob(manifest.publisher.publicKey), c => c.charCodeAt(0)), { name: 'Ed25519' }, false, ['verify'])
    if (!await crypto.subtle.verify('Ed25519', key, Uint8Array.from(atob(signature.signature), c => c.charCodeAt(0)), new Uint8Array(signingBytesV4(manifest)))) throw new Error('发布者签名校验失败。')
    for (const m of layout.modules) {
      if (isWorkbenchCorePackageName(m.packageName)) {
        if (!(CORE_PORTABLE_EDITORS as readonly string[]).includes(m.editorId) || m.version !== WORKBENCH_CORE_VERSION) throw new Error('内页伪装为宿主提供的扩展。')
      } else if (!manifest.dependencies.some(d => d.packageName === m.packageName && d.version === m.version && d.digest === m.digest && d.editorScopes.some(e => e.editorId === m.editorId && e.scope === m.scope))) throw new Error('内页引用没有匹配的锁定扩展。')
    }
  }
  return { digest: await sha256Hex(bytes), manifest, layout, files, ...(signature ? { signature } : {}) }
}
