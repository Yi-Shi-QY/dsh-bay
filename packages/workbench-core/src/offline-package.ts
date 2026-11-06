import { WORKBENCH_CORE_MANIFEST } from './core-manifest.ts'
import { WORKBENCH_CONVERSATION_PAGE_METADATA } from './conversation-page-metadata.ts'
import type { WorkbenchModuleIdentityV1 } from './module-catalog.ts'
import { canonicalizeWorkbenchCatalogJsonV1, importWorkbenchSignedCatalogV1, WORKBENCH_DSH_PLUGIN_GENERATION_V1, WORKBENCH_UPSTREAM_COMMIT_V1,
  type WorkbenchSignedCatalogImportOptionsV1, type WorkbenchSignedCatalogImportV1 } from './signed-catalog.ts'
import { readWorkbenchOfflineArchive, writeWorkbenchOfflineArchive } from './offline-archive.ts'
import { areasOf, validateWorkbenchDocumentV3, type WorkbenchDocumentV3, type WorkbenchNodeV3 } from './foundation/document-v3.ts'
import { decodeWorkbenchHiddenEditorIds, normalizeWorkbenchTags, type WorkbenchRecordV2 } from './foundation/persistence.ts'
import type { JsonValue } from './foundation/model.ts'
import type { WorkbenchEditorCatalogRow } from './foundation/catalog.ts'
import { WORKBENCH_PACKAGE_NAME, WORKBENCH_LEGACY_PACKAGE_NAME, isWorkbenchCorePackageName } from './release-compatibility.ts'

export interface WorkbenchOfflineLayoutV1 {
  readonly schemaVersion: 1
  readonly name: string
  readonly description: string
  readonly tags: readonly string[]
  readonly hiddenEditorIds: readonly string[]
  readonly document: WorkbenchDocumentV3
  readonly bindings: readonly { readonly key: string; readonly areaIds: readonly string[]; readonly requires: readonly ['workspace', 'session', 'agent', 'model', 'permission'] }[]
}

export interface WorkbenchOfflineManifestV1 {
  readonly schemaVersion: 1
  readonly kind: 'dsh-workbench-offline'
  readonly core: { readonly packageName: typeof WORKBENCH_PACKAGE_NAME | typeof WORKBENCH_LEGACY_PACKAGE_NAME; readonly version: string; readonly offlineProtocol: 1 }
  readonly dsh: { readonly generation: string; readonly upstreamCommit: string }
  readonly layout: { readonly path: 'workbench.json'; readonly sha256: string }
  readonly catalog?: { readonly path: string; readonly sha256: string }
  readonly modules: readonly WorkbenchModuleIdentityV1[]
}

export interface WorkbenchOfflinePackageV1 {
  readonly packageId: string
  readonly manifest: WorkbenchOfflineManifestV1
  readonly layout: WorkbenchOfflineLayoutV1
  readonly archive: Uint8Array
  readonly catalogArchive?: Uint8Array
  readonly catalog?: WorkbenchSignedCatalogImportV1
}

export async function offlineSha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes).buffer)
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('')
}

function portableText(value: unknown, limit: number): string {
  if (typeof value !== 'string' || value.length > limit || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value)
    || /(?:[A-Za-z]:[\\/]|(?:^|\s)\/(?:Users|home|var|etc|tmp)\/|(?:api[_-]?key|password|secret|access[_-]?token)\s*[:=]|\bsk-[A-Za-z0-9]{16,})/iu.test(value)) throw new Error('Workbench metadata contains unsupported portable text')
  return value
}

function boundedDocument(value: unknown, detached = false): WorkbenchDocumentV3 | undefined {
  if (typeof value !== 'object' || value === null || !('root' in value)) return undefined
  const queue: Array<{ node: unknown; depth: number }> = [{ node: value.root, depth: 0 }]
  let count = 0
  while (queue.length > 0) {
    const { node, depth } = queue.pop()!
    if (++count > 127 || depth > 16 || typeof node !== 'object' || node === null || !('kind' in node)) return undefined
    if (node.kind === 'split') {
      if (!('first' in node) || !('second' in node)) return undefined
      queue.push({ node: node.first, depth: depth + 1 }, { node: node.second, depth: depth + 1 })
    }
  }
  return validateWorkbenchDocumentV3(value, { allowDetachedSession: detached })
}

function portableState(value: unknown, depth = 0): value is JsonValue {
  if (depth > 16) return false
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return typeof value !== 'string'
    || (value.length <= 32768 && !/^(?:[A-Za-z]:[\\/]|\\\\|[/]|~[/\\]|file:)/iu.test(value))
  if (typeof value === 'number') return Number.isFinite(value)
  if (Array.isArray(value)) return value.length <= 1024 && value.every(item => portableState(item, depth + 1))
  if (typeof value !== 'object') return false
  const entries = Object.entries(value as Record<string, unknown>)
  return entries.length <= 256 && entries.every(([key, child]) => !/(?:sessionId|workspaceId|credential|password|secret|token|apiKey|process|pid|windowId|draft|messages|history|absolutePath|__proto__|constructor|prototype)/iu.test(key)
    && portableState(child, depth + 1))
}

/** Supported Suite V1 has no portable draft or transcript state. Unknown state blocks export. */
export function projectWorkbenchOfflineLayout(record: WorkbenchRecordV2): WorkbenchOfflineLayoutV1 {
  return projectLayout(record, false)
}

function projectLayout(record: WorkbenchRecordV2, detached: boolean, editors: readonly WorkbenchEditorCatalogRow[] = [], allowUnknownEditors = false): WorkbenchOfflineLayoutV1 {
  if (boundedDocument(record.document, detached) === undefined) throw new Error('Workbench layout is invalid or exceeds offline limits')
  const hiddenEditorIds = decodeWorkbenchHiddenEditorIds(record.hiddenEditorIds)
  if (hiddenEditorIds === undefined || hiddenEditorIds.some(id => !WORKBENCH_CONVERSATION_PAGE_METADATA.some(page => page.id === id)
    && !editors.some(editor => editor.id === id) && !allowUnknownEditors)) throw new Error('Unknown inner-page visibility preference')
  if (record.externalBindings !== undefined && Object.keys(record.externalBindings).length !== 0) throw new Error('External bindings do not yet have an offline transfer contract')
  const areaKeys = new Map<string, string>()
  const bindingKeys = new Map<string, string>()
  const bindings: Array<{ key: string; areaIds: string[]; requires: ['workspace', 'session', 'agent', 'model', 'permission'] }> = []
  let areaNumber = 0, splitNumber = 0
  const convert = (node: WorkbenchNodeV3): WorkbenchNodeV3 => {
    if (node.kind === 'split') return { kind: 'split', id: `split-${String(++splitNumber)}`, axis: node.axis, ratio: node.ratio,
      first: convert(node.first), second: convert(node.second) }
    const areaId = `area-${String(++areaNumber)}`
    areaKeys.set(node.areaId, areaId)
    if (node.moduleHistory.length === 0) return { kind: 'area', areaId, moduleHistory: [] }
    const first = node.moduleHistory.find(module => module.binding !== undefined) ?? node.moduleHistory[0]
    const localBinding = first?.binding?.sessionId ?? (first?.pendingBinding === undefined ? undefined : `pending:${first.pendingBinding}`)
    const existingBinding = localBinding === undefined ? undefined : bindingKeys.get(localBinding)
    const key = existingBinding ?? `binding-${String(bindings.length + 1)}`
    if (existingBinding === undefined && localBinding !== undefined) {
      bindings.push({ key, areaIds: [areaId], requires: ['workspace', 'session', 'agent', 'model', 'permission'] })
      bindingKeys.set(localBinding, key)
    } else if (existingBinding !== undefined) bindings.find(row => row.key === key)!.areaIds.push(areaId)
    const moduleHistory = node.moduleHistory.map((module, index) => {
      const page = WORKBENCH_CONVERSATION_PAGE_METADATA.find(page => page.id === module.editorId && page.scope === module.editorScope)
      const editor = page === undefined ? editors.find(editor => editor.id === module.editorId && editor.scope === module.editorScope) : undefined
      if (page === undefined && editor === undefined && !allowUnknownEditors) throw new Error('Workbench contains an unsupported inner page')
      let state: JsonValue = {}
      if (page === undefined && editor?.portability?.version === 1 && editor.portability.exportState !== undefined) {
        try {
          const exported = editor.portability.exportState(module.state as never, {
            version: 1,
            editor: { id: module.editorId, scope: module.editorScope, moduleInstanceId: module.moduleInstanceId, title: module.lastKnownTitle },
          })
          if (exported === undefined || !portableState(exported)) throw new Error('invalid portable state')
          state = structuredClone(exported)
        } catch { throw new Error('Inner-page configuration has no portable contract') }
      } else if (page === undefined && allowUnknownEditors) {
        // The receiver validates the signed Catalog after this projection, so
        // preserve the already-portable custom state while it is still opaque
        // to the Core-only parser. Dropping it here would change workbench.json
        // and make every custom inner-page package fail its digest check.
        if (!portableState(module.state)) throw new Error('Inner-page configuration has no portable contract')
        state = structuredClone(module.state)
      } else if (page === undefined) {
        throw new Error('Inner-page configuration has no portable contract')
      } else if (page !== undefined && module.state !== null && (typeof module.state !== 'object' || Array.isArray(module.state)
        || Object.entries(module.state).some(([name, value]) => !['workbenchConversationDraft', 'draft'].includes(name) || typeof value !== 'string'))) throw new Error('Inner-page configuration has no portable contract')
      const moduleInstanceId = `page-${String(areaNumber)}-${String(index + 1)}`
      return { moduleInstanceId, editorId: module.editorId, editorScope: module.editorScope,
        ...(module.pendingBinding === undefined ? {} : { pendingBinding: module.pendingBinding }),
        // Draft aliases are local Session content, never portable configuration.
        state, lastKnownTitle: page?.label ?? editor?.label ?? module.lastKnownTitle ?? module.editorId }
    })
    const activeIndex = node.moduleHistory.findIndex(module => module.moduleInstanceId === node.activeModuleInstanceId)
    return { kind: 'area', areaId,
      ...(moduleHistory[activeIndex < 0 ? 0 : activeIndex] === undefined ? {} : { activeModuleInstanceId: moduleHistory[activeIndex < 0 ? 0 : activeIndex]!.moduleInstanceId }),
      moduleHistory }
  }
  const root = convert(record.document.root)
  const layout: WorkbenchOfflineLayoutV1 = { schemaVersion: 1, name: portableText(record.name, 160), description: portableText(record.description, 2000),
    tags: normalizeWorkbenchTags(record.tags ?? []).map(tag => portableText(tag, 64)), hiddenEditorIds,
    document: { version: 3, root, activeAreaId: areaKeys.get(record.document.activeAreaId)! }, bindings }
  const serialized = new TextDecoder().decode(canonicalizeWorkbenchCatalogJsonV1(layout))
  for (const area of areasOf(record.document.root)) for (const module of area.moduleHistory) {
    for (const id of [module.binding?.sessionId, module.binding?.workspaceId]) {
      if (id !== undefined && serialized.includes(id)) throw new Error('Workbench metadata contains a local binding identity')
    }
  }
  return layout
}

function identityEqual(left: WorkbenchModuleIdentityV1, right: WorkbenchModuleIdentityV1): boolean {
  return left.moduleId === right.moduleId && left.version === right.version && left.artifactDigest === right.artifactDigest
}

async function offlineCatalog(bytes: Uint8Array, options: WorkbenchSignedCatalogImportOptionsV1) {
  const files = await readWorkbenchOfflineArchive(bytes)
  return importWorkbenchSignedCatalogV1(bytes, { ...options,
    archiveReader: { read: async () => [...files].map(([path, bytes]) => ({ path, bytes })) } })
}

export async function buildWorkbenchOfflinePackage(input: {
  record: WorkbenchRecordV2
  editorModules: ReadonlyMap<string, WorkbenchModuleIdentityV1>
  editors?: readonly WorkbenchEditorCatalogRow[]
  catalogArchive?: Uint8Array
  catalogOptions?: WorkbenchSignedCatalogImportOptionsV1
}): Promise<WorkbenchOfflinePackageV1> {
  const editorIds = [...new Set([...areasOf(input.record.document.root).flatMap(area => area.moduleHistory.map(module => module.editorId)),
    ...(decodeWorkbenchHiddenEditorIds(input.record.hiddenEditorIds) ?? [])])].sort()
  if (editorIds.some(editorId => {
    const identity = input.editorModules.get(editorId)
    return identity !== undefined && identity.moduleId !== 'workbench.conversation-suite'
  })) {
    throw new Error('Core-only offline packages support Conversation Suite only. Export custom inner-page modules with the V4 offline-embedded format.')
  }
  const layout = projectLayout(input.record, false, input.editors ?? [])
  const modules: WorkbenchModuleIdentityV1[] = []
  const catalog = input.catalogArchive === undefined ? undefined : await offlineCatalog(input.catalogArchive, input.catalogOptions ?? {})
  for (const editorId of editorIds) {
    const identity = input.editorModules.get(editorId)
    const entry = identity === undefined ? undefined : catalog?.entries.find(entry => identityEqual(entry, identity))
    if (identity === undefined || entry === undefined || entry.signedCatalog?.revoked !== false
      || !entry.manifest?.provides.editorIds.includes(editorId) || catalog?.artifact(identity) === undefined) throw new Error('Offline export requires each inner page and its original trusted artifact')
    if (!modules.some(module => identityEqual(module, identity))) modules.push({ moduleId: identity.moduleId, version: identity.version, artifactDigest: identity.artifactDigest })
  }
  const layoutBytes = canonicalizeWorkbenchCatalogJsonV1(layout)
  const catalogBytes = modules.length === 0 ? undefined : input.catalogArchive
  const catalogDigest = catalogBytes === undefined ? undefined : await offlineSha256(catalogBytes)
  const manifest: WorkbenchOfflineManifestV1 = { schemaVersion: 1, kind: 'dsh-workbench-offline',
    core: { packageName: WORKBENCH_PACKAGE_NAME, version: WORKBENCH_CORE_MANIFEST.version, offlineProtocol: 1 },
    dsh: { generation: WORKBENCH_DSH_PLUGIN_GENERATION_V1, upstreamCommit: WORKBENCH_UPSTREAM_COMMIT_V1 },
    layout: { path: 'workbench.json', sha256: await offlineSha256(layoutBytes) },
    ...(catalogDigest === undefined ? {} : { catalog: { path: `catalogs/${catalogDigest}.zip`, sha256: catalogDigest } }), modules }
  const manifestBytes = canonicalizeWorkbenchCatalogJsonV1(manifest)
  const files = new Map([['manifest.json', manifestBytes], ['workbench.json', layoutBytes]])
  if (catalogBytes !== undefined && manifest.catalog !== undefined) files.set(manifest.catalog.path, catalogBytes)
  const archive = await writeWorkbenchOfflineArchive(files)
  return { packageId: await offlineSha256(manifestBytes), manifest, layout, archive,
    ...(catalogBytes === undefined || catalog === undefined ? {} : { catalogArchive: new Uint8Array(catalogBytes), catalog }) }
}

function jsonRecord(bytes: Uint8Array | undefined, limit: number): Record<string, unknown> {
  if (bytes === undefined || bytes.byteLength > limit) throw new Error('Offline JSON document is missing or too large')
  const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  if (typeof value !== 'object' || value === null || Array.isArray(value)
    || !equalBytes(bytes, canonicalizeWorkbenchCatalogJsonV1(value))) throw new Error('Offline JSON must be canonical')
  return value as Record<string, unknown>
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength && left.every((value, index) => right[index] === value)
}

/** Pure preflight. A valid archive grants no install or Settings authority. */
export async function inspectWorkbenchOfflinePackage(archive: Uint8Array, options: WorkbenchSignedCatalogImportOptionsV1 = {}): Promise<WorkbenchOfflinePackageV1> {
  const files = await readWorkbenchOfflineArchive(archive)
  const manifestRaw = jsonRecord(files.get('manifest.json'), 64 * 1024)
  if (manifestRaw.kind !== 'dsh-workbench-offline' || manifestRaw.schemaVersion !== 1) throw new Error('Unsupported offline Workbench package format')
  const manifest = manifestRaw as unknown as WorkbenchOfflineManifestV1
  if (!isWorkbenchCorePackageName(manifest.core?.packageName) || manifest.core.version !== WORKBENCH_CORE_MANIFEST.version || manifest.core.offlineProtocol !== 1
    || manifest.dsh?.generation !== WORKBENCH_DSH_PLUGIN_GENERATION_V1 || manifest.dsh.upstreamCommit !== WORKBENCH_UPSTREAM_COMMIT_V1
    || manifest.layout?.path !== 'workbench.json' || !Array.isArray(manifest.modules) || manifest.modules.length > 1
    || manifest.modules.some(module => typeof module !== 'object' || module === null || Array.isArray(module)
      || module.moduleId !== 'workbench.conversation-suite'
      || typeof module.version !== 'string' || module.version.trim() === ''
      || typeof module.artifactDigest !== 'string' || !/^[a-f0-9]{64}$/iu.test(module.artifactDigest))
    || new Set(manifest.modules.map(module => `${module.moduleId}\u0000${module.version}\u0000${module.artifactDigest.toLowerCase()}`)).size !== manifest.modules.length) throw new Error('Offline Workbench requires a compatible Core and DSH generation')
  const layoutBytes = files.get('workbench.json')
  const layoutRaw = jsonRecord(layoutBytes, 256 * 1024)
  if (layoutRaw.schemaVersion !== 1 || !Array.isArray(layoutRaw.tags) || !layoutRaw.tags.every(tag => typeof tag === 'string')
    || !Array.isArray(layoutRaw.hiddenEditorIds) || !Array.isArray(layoutRaw.bindings)) throw new Error('Invalid offline Workbench layout')
  const document = boundedDocument(layoutRaw.document, true)
  if (document === undefined) throw new Error('Invalid offline Workbench document')
  const projected = projectLayout({ workbenchId: 'shared-workbench', name: portableText(layoutRaw.name, 160), description: portableText(layoutRaw.description, 2000),
    tags: layoutRaw.tags as string[], hiddenEditorIds: layoutRaw.hiddenEditorIds as string[], document, createdAt: 0, updatedAt: 0 }, true, [], true)
  const requiredAreas = new Set(areasOf(projected.document.root).filter(area => area.moduleHistory.some(module => module.editorScope === 'session')).map(area => area.areaId))
  const bindings = layoutRaw.bindings.map((raw: unknown, index) => {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new Error('Invalid offline binding requirement')
    const row = raw as Record<string, unknown>
    if (row.key !== `binding-${String(index + 1)}` || !Array.isArray(row.areaIds) || row.areaIds.length === 0) throw new Error('Invalid offline binding key')
    for (const id of row.areaIds) if (typeof id !== 'string' || !requiredAreas.delete(id)) throw new Error('Invalid or duplicate offline binding Area')
    const result = { key: row.key as string, areaIds: row.areaIds as string[], requires: ['workspace', 'session', 'agent', 'model', 'permission'] as const }
    if (!equalBytes(canonicalizeWorkbenchCatalogJsonV1(result), canonicalizeWorkbenchCatalogJsonV1(row))) throw new Error('Unsupported offline binding requirements')
    return result
  })
  if (requiredAreas.size !== 0) throw new Error('Offline Workbench lacks recipient bindings')
  const layout: WorkbenchOfflineLayoutV1 = { ...projected, bindings }
  if (!equalBytes(layoutBytes!, canonicalizeWorkbenchCatalogJsonV1(layout)) || await offlineSha256(layoutBytes!) !== manifest.layout.sha256) throw new Error('Offline layout digest or portable field mismatch')
  const needed = new Set([...areasOf(layout.document.root).flatMap(area => area.moduleHistory.map(module => module.editorId)), ...layout.hiddenEditorIds])
  let catalogArchive: Uint8Array | undefined, catalog: WorkbenchSignedCatalogImportV1 | undefined
  const modules: WorkbenchModuleIdentityV1[] = []
  if (needed.size > 0) {
    if (manifest.catalog === undefined || !/^[a-f0-9]{64}$/u.test(manifest.catalog.sha256)
      || manifest.catalog.path !== `catalogs/${manifest.catalog.sha256}.zip`) throw new Error('Offline Workbench lacks an original trusted Catalog')
    catalogArchive = files.get(manifest.catalog.path)
    if (catalogArchive === undefined || await offlineSha256(catalogArchive) !== manifest.catalog.sha256) throw new Error('Offline Catalog digest mismatch')
    catalog = await offlineCatalog(catalogArchive, options)
    const ownedEditors = new Set<string>()
    for (const module of manifest.modules) {
      const signed = catalog.entries.find(entry => identityEqual(entry, module))
      if (signed === undefined || signed.signedCatalog?.revoked !== false) throw new Error('Offline Module identity, revocation or editor ownership mismatch')
      for (const id of signed.manifest?.provides.editorIds ?? []) {
        if (ownedEditors.has(id)) throw new Error('Offline Module editor ownership is ambiguous')
        ownedEditors.add(id)
      }
      modules.push({ moduleId: signed.moduleId, version: signed.version, artifactDigest: signed.artifactDigest })
    }
    for (const id of needed) if (!ownedEditors.has(id)) throw new Error('Offline Module identity, revocation or editor ownership mismatch')
  }
  const expected: WorkbenchOfflineManifestV1 = { schemaVersion: 1, kind: 'dsh-workbench-offline',
    core: { packageName: manifest.core.packageName, version: WORKBENCH_CORE_MANIFEST.version, offlineProtocol: 1 },
    dsh: { generation: WORKBENCH_DSH_PLUGIN_GENERATION_V1, upstreamCommit: WORKBENCH_UPSTREAM_COMMIT_V1 },
    layout: { path: 'workbench.json', sha256: manifest.layout.sha256 },
    ...(catalogArchive === undefined ? {} : { catalog: { path: manifest.catalog!.path, sha256: manifest.catalog!.sha256 } }), modules }
  if (!equalBytes(files.get('manifest.json')!, canonicalizeWorkbenchCatalogJsonV1(expected)) || files.size !== (catalogArchive === undefined ? 2 : 3)) throw new Error('Offline archive contains undeclared fields or entries')
  return { packageId: await offlineSha256(files.get('manifest.json')!), manifest: expected, layout, archive: new Uint8Array(archive),
    ...(catalog === undefined || catalogArchive === undefined ? {} : { catalog, catalogArchive }) }
}
