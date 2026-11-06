import type { WorkbenchEditorCatalogRow } from './catalog.ts'
import { areasOf, validateWorkbenchDocumentV3, type WorkbenchDocumentV3, type WorkbenchNodeV3 } from './document-v3.ts'
import type { JsonValue, SessionBindingV1 } from './model.ts'
import type { WorkbenchRecordV2 } from './persistence.ts'
import { canonicalJson, decodeDeterministicZip, decodeWorkbenchPackageArchive, encodeDeterministicZip, importPortableWorkbench, sha256Hex, type PortableWorkbenchV1 } from './workbench-sharing.ts'
import { inspectWorkbenchOfflinePackage } from '../offline-package.ts'
import { WORKBENCH_CORE_VERSION, WORKBENCH_DSH_GENERATION, isWorkbenchCorePackageName } from '../release-compatibility.ts'
import { CORE_PORTABLE_EDITORS } from '../distribution-contract.ts'
import { workbenchEditorStateFailureV1 } from '../workbench-editor-state.ts'

export interface LayoutPackageModuleV3 { editorId: string; scope: 'root' | 'session'; packageName?: string; version?: string; digest?: string }
export interface PortableLayoutV2 {
  schemaVersion: 2
  format: 'dsh-portable-workbench'
  retention: 'all-retained-tabs'
  name: string
  description: string
  tags: string[]
  document: WorkbenchDocumentV3
  modules: LayoutPackageModuleV3[]
  warnings: string[]
}
export interface LayoutPackageManifestV3 {
  schemaVersion: 3
  format: 'dsh-workbench-package'
  mode: 'layout-only'
  compatibility: { dsh: string; core: string; portableLayout: 2 }
  files: { path: 'workbench.json'; size: number; sha256: string }[]
}
export interface LayoutPackagePreview { digest: string; layout: PortableLayoutV2; warnings: string[]; legacy: boolean }
const text = new TextEncoder()
const json = (value: unknown) => text.encode(canonicalJson(value))
const parse = (bytes: Uint8Array): unknown => JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
const id = /^[a-zA-Z0-9._:-]{1,128}$/u
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const keys = (value: object, allowed: string[]) => Object.keys(value).every(key => allowed.includes(key))

/** Descriptor output is still untrusted data. Never use raw runtime state as a fallback. */
export function portableStateSafe(value: unknown, depth = 0): value is JsonValue {
  if (depth > 16) return false
  if (value === null || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (typeof value === 'string') return value.length <= 32768 && !/^(?:[a-z]:[\\/]|\\\\|[/]|~[/\\]|file:)/iu.test(value)
  if (Array.isArray(value)) return value.length <= 1024 && value.every(item => portableStateSafe(item, depth + 1))
  if (!record(value)) return false
  return Object.entries(value).length <= 256 && Object.entries(value).every(([key, child]) =>
    !/(?:sessionId|workspaceId|credential|password|secret|token|apiKey|process|pid|windowId|draft|messages|history|absolutePath|__proto__|constructor|prototype)/iu.test(key)
    && portableStateSafe(child, depth + 1))
}

export function projectLayoutPackage(record: WorkbenchRecordV2, editors: readonly WorkbenchEditorCatalogRow[]): PortableLayoutV2 {
  const warnings: string[] = []
  const modules = new Map<string, LayoutPackageModuleV3>()
  let ordinal = 0
  let moduleOrdinal = 0
  const areaIds = new Map<string, string>()
  const visit = (node: WorkbenchNodeV3): WorkbenchNodeV3 => {
    if (node.kind === 'split') return { kind: 'split', id: `split-${++ordinal}`, axis: node.axis, ratio: node.ratio, first: visit(node.first), second: visit(node.second) }
    const areaId = `area-${++ordinal}`
    areaIds.set(node.areaId, areaId)
    let activeModuleInstanceId: string | undefined
    const moduleHistory = node.moduleHistory.map(module => {
      const moduleInstanceId = `page-${++moduleOrdinal}`
      if (module.moduleInstanceId === node.activeModuleInstanceId) activeModuleInstanceId = moduleInstanceId
      const editor = editors.find(row => row.id === module.editorId && row.scope === module.editorScope)
      const provider = editor?.distribution
      modules.set(`${module.editorScope}:${module.editorId}`, { editorId: module.editorId, scope: module.editorScope,
        ...(provider?.packageName === undefined ? {} : { packageName: provider.packageName }),
        ...(provider === undefined ? {} : { version: provider.packageVersion }),
        ...(editor?.provenance?.artifactDigest === undefined ? {} : { digest: editor.provenance.artifactDigest }) })
      let state: JsonValue = {}
      if (editor?.declaration?.state.share === 'portable' && editor.portability?.version === 1 && editor.portability.exportState) {
        try {
          const exported = editor.portability.exportState(module.state, { version: 1, editor: { id: editor.id, scope: editor.scope, moduleInstanceId: module.moduleInstanceId, title: module.lastKnownTitle } })
          if (exported !== undefined && portableStateSafe(exported) && !workbenchEditorStateFailureV1(exported, editor.declaration)) state = structuredClone(exported) as JsonValue
          else warnings.push(`「${editor.label}」配置未通过可迁移检查，仅分享内页引用。`)
        } catch { warnings.push(`「${editor.label}」配置投影失败，仅分享内页引用。`) }
      } else warnings.push(`「${editor?.label ?? module.editorId}」没有可迁移配置处理器，仅分享内页引用。`)
      return { moduleInstanceId, editorId: module.editorId, editorScope: module.editorScope, lastKnownTitle: editor?.label ?? module.editorId,
        state, ...(module.editorScope === 'session' ? { pendingBinding: 'binding-1' } : {}) }
    })
    return { kind: 'area', areaId, moduleHistory, ...(activeModuleInstanceId ? { activeModuleInstanceId } : {}) }
  }
  const root = visit(record.document.root)
  return { schemaVersion: 2, format: 'dsh-portable-workbench', retention: 'all-retained-tabs', name: record.name, description: record.description,
    tags: [...record.tags ?? []], document: { version: 3, root, activeAreaId: areaIds.get(record.document.activeAreaId)! }, modules: [...modules.values()], warnings: [...new Set(warnings)] }
}

export function validatePortableLayout(value: unknown): asserts value is PortableLayoutV2 {
  if (!record(value) || !keys(value, ['schemaVersion', 'format', 'retention', 'name', 'description', 'tags', 'document', 'modules', 'warnings'])
    || value.schemaVersion !== 2 || value.format !== 'dsh-portable-workbench' || value.retention !== 'all-retained-tabs'
    || typeof value.name !== 'string' || !value.name.trim() || value.name.length > 160 || typeof value.description !== 'string' || value.description.length > 4000
    || !Array.isArray(value.tags) || value.tags.length > 32 || value.tags.some(tag => typeof tag !== 'string' || tag.length > 64)
    || !Array.isArray(value.warnings) || value.warnings.length > 512 || value.warnings.some(warning => typeof warning !== 'string' || warning.length > 1024)
    || !Array.isArray(value.modules) || value.modules.length > 256) throw new Error('布局分享包结构或协议无效。')
  const moduleKeys = new Set<string>()
  for (const module of value.modules) {
    if (!record(module) || !keys(module, ['editorId', 'scope', 'packageName', 'version', 'digest']) || typeof module.editorId !== 'string' || !id.test(module.editorId)
      || !['root', 'session'].includes(String(module.scope)) || ['packageName', 'version'].some(key => module[key] !== undefined && (typeof module[key] !== 'string' || (module[key] as string).length > 214))
      || (module.digest !== undefined && (typeof module.digest !== 'string' || !/^[a-f0-9]{64,128}$/u.test(module.digest)))) throw new Error('模块引用无效。')
    const key = `${String(module.scope)}:${module.editorId}`
    if (moduleKeys.has(key)) throw new Error('模块引用重复。')
    moduleKeys.add(key)
  }
  let count = 0
  let pages = 0
  const identities = new Set<string>()
  const identity = (value: unknown) => { if (typeof value !== 'string' || !id.test(value) || identities.has(value)) throw new Error('布局身份无效或重复。'); identities.add(value) }
  const visit = (node: unknown, depth: number) => {
    if (!record(node) || depth > 16 || ++count > 127) throw new Error('布局层数或区域数量超限。')
    if (node.kind === 'split') {
      if (!keys(node, ['kind', 'id', 'axis', 'ratio', 'first', 'second']) || !['horizontal', 'vertical'].includes(String(node.axis)) || typeof node.ratio !== 'number' || !Number.isFinite(node.ratio) || node.ratio < 0 || node.ratio > 1) throw new Error('分屏结构无效。')
      identity(node.id); visit(node.first, depth + 1); visit(node.second, depth + 1); return
    }
    if (node.kind !== 'area' || !keys(node, ['kind', 'areaId', 'activeModuleInstanceId', 'moduleHistory']) || !Array.isArray(node.moduleHistory)) throw new Error('区域结构无效。')
    identity(node.areaId)
    for (const page of node.moduleHistory) {
      if (++pages > 256 || !record(page) || !keys(page, ['moduleInstanceId', 'editorId', 'editorScope', 'state', 'lastKnownTitle', 'pendingBinding'])
        || !moduleKeys.has(`${String(page.editorScope)}:${String(page.editorId)}`) || typeof page.lastKnownTitle !== 'string' || page.lastKnownTitle.length > 256
        || (page.pendingBinding !== undefined && page.pendingBinding !== 'binding-1') || !portableStateSafe(page.state) || json(page.state).length > 256 * 1024) throw new Error('内页引用或可迁移状态无效。')
      identity(page.moduleInstanceId)
    }
    if (node.activeModuleInstanceId !== undefined && !node.moduleHistory.some(page => page.moduleInstanceId === node.activeModuleInstanceId)) throw new Error('当前内页不在区域中。')
  }
  if (!record(value.document) || !keys(value.document, ['version', 'root', 'activeAreaId']) || value.document.version !== 3) throw new Error('布局版本无效。')
  visit(value.document.root, 0)
  if (!validateWorkbenchDocumentV3(value.document)) throw new Error('布局校验失败。')
}

export async function buildLayoutPackage(layout: PortableLayoutV2): Promise<Uint8Array> {
  validatePortableLayout(layout)
  const content = json(layout)
  const manifest: LayoutPackageManifestV3 = { schemaVersion: 3, format: 'dsh-workbench-package', mode: 'layout-only',
    compatibility: { dsh: WORKBENCH_DSH_GENERATION, core: WORKBENCH_CORE_VERSION, portableLayout: 2 }, files: [{ path: 'workbench.json', size: content.length, sha256: await sha256Hex(content) }] }
  return encodeDeterministicZip([{ path: 'manifest.json', content: json(manifest) }, { path: 'workbench.json', content }])
}

/** Older parsers validate their own formats. No embedded plugin payload is executed. */
export async function inspectLayoutPackage(bytes: Uint8Array): Promise<LayoutPackagePreview> {
  const entries = decodeDeterministicZip(bytes, { maxEntries: 128, maxFileBytes: 8 * 1024 * 1024, maxTotalBytes: 32 * 1024 * 1024 })
  const manifest = parse(entries.find(file => file.path === 'manifest.json')?.content ?? new Uint8Array())
  const digest = await sha256Hex(bytes)
  if (!record(manifest)) throw new Error('分享包 manifest 无效。')
  if (manifest.schemaVersion === 4) {
    const preview = await (await import('./workbench-package-v4.ts')).inspectWorkbenchPackageV4(bytes)
    if (preview.manifest.mode !== 'layout-only') throw new Error('此包包含扩展安装要求，请使用完整工作台导入入口。')
    return { digest: preview.digest, layout: preview.layout, warnings: preview.layout.warnings, legacy: false }
  }
  if (manifest.schemaVersion === 3) {
    if (!keys(manifest, ['schemaVersion', 'format', 'mode', 'compatibility', 'files']) || manifest.format !== 'dsh-workbench-package' || manifest.mode !== 'layout-only'
      || !record(manifest.compatibility) || !keys(manifest.compatibility, ['dsh', 'core', 'portableLayout']) || manifest.compatibility.dsh !== WORKBENCH_DSH_GENERATION
      || ![WORKBENCH_CORE_VERSION, '0.2.2-alpha.17.1'].includes(manifest.compatibility.core as string) || manifest.compatibility.portableLayout !== 2) throw new Error('分享协议或 Core／DSH 代际不兼容，需要迁移。')
    if (entries.length !== 2 || !Array.isArray(manifest.files) || manifest.files.length !== 1) throw new Error('布局分享包包含未声明文件。')
    const file = entries.find(file => file.path === 'workbench.json')
    const declared = manifest.files[0]
    if (!file || !record(declared) || !keys(declared, ['path', 'size', 'sha256']) || declared.path !== file.path || declared.size !== file.content.length || declared.sha256 !== await sha256Hex(file.content)) throw new Error('文件大小或摘要不符。')
    const layout = parse(file.content)
    validatePortableLayout(layout)
    return { digest, layout, warnings: layout.warnings, legacy: false }
  }
  let document: WorkbenchDocumentV3
  let name: string
  let description: string
  let tags: string[] = []
  if (manifest.kind === 'dsh-workbench-offline') {
    const old = await inspectWorkbenchOfflinePackage(bytes)
    if (old.manifest.dsh.generation !== WORKBENCH_DSH_GENERATION) throw new Error('旧离线包 DSH 代际不兼容，需要迁移。')
    document = old.layout.document; name = old.layout.name; description = old.layout.description; tags = [...old.layout.tags]
  } else {
    const old = await decodeWorkbenchPackageArchive(bytes)
    if (old.manifest.compatibility.dsh.minimum !== WORKBENCH_DSH_GENERATION || (old.manifest.compatibility.dsh.maximum !== undefined && old.manifest.compatibility.dsh.maximum !== WORKBENCH_DSH_GENERATION)) throw new Error('旧工作台包 DSH 代际不兼容，需要迁移。')
    const projection = parse(old.files.find(file => file.path === 'workbench.json')!.content) as PortableWorkbenchV1
    document = importPortableWorkbench(projection, { editors: [] }).document; name = projection.name; description = projection.description
  }
  const sanitized = projectLayoutPackage({ workbenchId: 'legacy', name, description, tags, createdAt: 0, updatedAt: 0, document }, [])
  sanitized.warnings.unshift('旧格式未保存或已压缩的标签无法恢复；旧内页配置仅保留引用，内嵌插件不安装。')
  validatePortableLayout(sanitized)
  return { digest, layout: sanitized, warnings: sanitized.warnings, legacy: true }
}

export function restoreLayoutPackage(layout: PortableLayoutV2, editors: readonly WorkbenchEditorCatalogRow[], bindings: Readonly<Record<string, SessionBindingV1>> = {}, strict = false, verifiedOnly = false): { document: WorkbenchDocumentV3; warnings: string[]; pendingPageIds: string[] } {
  validatePortableLayout(layout)
  const warnings: string[] = []
  const document = structuredClone(layout.document)
  const pendingPageIds: string[] = []
  const areaIds = new Map<string, string>()
  const fresh = (kind: string) => `${kind}-${globalThis.crypto.randomUUID()}`
  const visit = (node: WorkbenchNodeV3) => {
    if (node.kind === 'split') { node.id = fresh('split'); visit(node.first); visit(node.second); return }
    const oldAreaId = node.areaId
    node.areaId = fresh('area'); areaIds.set(oldAreaId, node.areaId)
    const binding = bindings[oldAreaId]
    if (binding && (binding.detached || !binding.sessionId.trim())) throw new Error('必须选择有效的本机会话。')
    if (binding) { node.areaBinding = { ...binding }; node.areaBindingGeneration = 0 }
    const current = node.activeModuleInstanceId
    for (const page of node.moduleHistory) {
      const oldId = page.moduleInstanceId
      page.moduleInstanceId = fresh('page')
      if (oldId === current) node.activeModuleInstanceId = page.moduleInstanceId
      const identity = layout.modules.find(m => m.editorId === page.editorId && m.scope === page.editorScope)
      const coreIdentity = isWorkbenchCorePackageName(identity?.packageName)
        && identity.version === WORKBENCH_CORE_VERSION && (CORE_PORTABLE_EDITORS as readonly string[]).includes(page.editorId)
      const editor = editors.find(row => row.id === page.editorId && row.scope === page.editorScope
        && (!verifiedOnly || coreIdentity || !!identity?.digest)
        && (identity?.packageName === undefined || ((row.provenance?.packageName === identity.packageName
          || (coreIdentity && isWorkbenchCorePackageName(row.provenance?.packageName)))
          && row.provenance?.packageVersion === identity.version && (identity.digest === undefined || row.provenance.artifactDigest === identity.digest))))
      const state = page.state
      let migrated = false
      page.state = {}
      if (editor?.declaration?.state.share === 'portable' && editor.portability?.version === 1 && editor.portability.importState) {
        try {
          // Validate the untrusted projection before invoking extension code.
          if (workbenchEditorStateFailureV1(state, editor.declaration)
            || (verifiedOnly && (!record(state) || state.schemaVersion !== editor.declaration.state.schemaVersion))) throw new Error('配置声明、版本或大小不匹配')
          const restored = editor.portability.importState(state, { version: 1, editor: { id: editor.id, scope: editor.scope, moduleInstanceId: page.moduleInstanceId, title: page.lastKnownTitle }, ...(binding ? { target: binding } : {}) })
          if (workbenchEditorStateFailureV1(restored, editor.declaration) || !portableStateSafe(restored)) throw new Error('配置超限、敏感或无效')
          page.state = structuredClone(restored) as JsonValue
          migrated = true
        } catch { if (strict) throw new Error(`「${page.lastKnownTitle}」配置恢复失败，导入尚未提交。`); warnings.push(`「${page.lastKnownTitle}」配置恢复失败，保留空内页引用。`) }
      } else if (Object.keys(Object(state)).length) warnings.push(`「${page.lastKnownTitle}」没有配置恢复处理器，保留引用。`)
      if (!editor) { if(strict) throw new Error(`「${page.lastKnownTitle}」扩展身份或运行状态尚未验证。`); warnings.push(`「${page.lastKnownTitle}」不可用，请在 DSH 安装并允许对应扩展。`) }
      if (strict && (!editor?.portability?.importState || editor.declaration?.state.share !== 'portable')) throw new Error(`「${page.lastKnownTitle}」缺少可靠的配置恢复处理器。`)
      if (!migrated && verifiedOnly) pendingPageIds.push(oldId)
      if (binding && (page.editorScope === 'session' || editor?.declaration?.requiredBinding !== 'none')) { page.binding = { ...binding }; page.bindingGeneration = 0; delete page.pendingBinding }
    }
  }
  visit(document.root)
  document.activeAreaId = areaIds.get(layout.document.activeAreaId)!
  if (!validateWorkbenchDocumentV3(document)) throw new Error('恢复后的布局无效。')
  return { document, warnings, pendingPageIds }
}
