import { workbenchEditorDeclarationFailureV1, type WorkbenchEditorScopeV1 } from './module-contract.ts'

/** Public self-description repeated on every contributed Workbench editor. */
export interface WorkbenchExtensionDeclarationV1 {
  readonly schemaVersion: 1
  readonly moduleId: string
  readonly apiVersion: 1
  readonly editorIds: readonly string[]
  readonly coreCompatibility: string
  readonly dshGeneration: string
}

const WORKBENCH_EXTENSION_ID = /^[a-z0-9][a-z0-9._:-]{0,127}$/iu

/** Validate extension identity carried by an untrusted DSH Slot inject face. */
export function workbenchExtensionDeclarationFailureV1(value: unknown): string | undefined {
  try {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return '声明必须是对象。'
    const declaration = value as Partial<WorkbenchExtensionDeclarationV1>
    if (declaration.schemaVersion !== 1) return 'schemaVersion 必须为 1。'
    if (declaration.apiVersion !== 1) return 'apiVersion 必须为 1。'
    if (typeof declaration.moduleId !== 'string' || !WORKBENCH_EXTENSION_ID.test(declaration.moduleId)) return 'moduleId 无效。'
    if (!Array.isArray(declaration.editorIds) || declaration.editorIds.length === 0 || declaration.editorIds.length > 32
      || declaration.editorIds.some(id => typeof id !== 'string' || !WORKBENCH_EXTENSION_ID.test(id))) return 'editorIds 无效。'
    if (new Set(declaration.editorIds).size !== declaration.editorIds.length) return 'editorIds 不能重复。'
    if (typeof declaration.coreCompatibility !== 'string' || declaration.coreCompatibility.trim() === '' || declaration.coreCompatibility.length > 128) return 'coreCompatibility 无效。'
    if (typeof declaration.dshGeneration !== 'string' || declaration.dshGeneration.trim() === '' || declaration.dshGeneration.length > 64) return 'dshGeneration 无效。'
    return undefined
  } catch {
    return '声明字段无法安全读取。'
  }
}

export function isWorkbenchExtensionDeclarationV1(value: unknown): value is WorkbenchExtensionDeclarationV1 {
  return workbenchExtensionDeclarationFailureV1(value) === undefined
}

export function validateWorkbenchExtensionDeclarationV1(value: unknown): asserts value is WorkbenchExtensionDeclarationV1 {
  const failure = workbenchExtensionDeclarationFailureV1(value)
  if (failure !== undefined) throw new Error(`Invalid Workbench extension declaration: ${failure}`)
}

/** Profile-local Workbench opt-in. This is not a sandbox or DSH enablement grant. */
export interface WorkbenchExtensionConsentV1 {
  readonly packageName: string
  readonly moduleId: string
  readonly apiVersion: 1
  /** Last confirmed editor IDs let Core explain stale layout references after uninstall. */
  readonly editorIds: readonly string[]
  readonly contractFingerprint: string
  readonly allowedAt: number
  /** False preserves identity history while revoking Workbench catalog access. */
  readonly allowed?: boolean
}

export type WorkbenchExtensionAvailabilityV1 =
  | 'ready'
  | 'not-allowed'
  | 'confirmation-required'
  | 'editor-missing'
  | 'inventory-unavailable'
  | 'dsh-missing'
  | 'dsh-disabled'
  | 'identity-unverified'
  | 'incompatible'
  | 'invalid-contract'

export interface WorkbenchExtensionAccessRowV1 {
  readonly key: string
  readonly packageName?: string
  readonly packageVersion?: string
  readonly moduleId: string
  readonly apiVersion?: number
  readonly editorIds: readonly string[]
  readonly availability: WorkbenchExtensionAvailabilityV1
  readonly allowed: boolean
  readonly contractFingerprint?: string
  /** Structured identity evidence shown by diagnostics/settings when DSH mapping fails. */
  readonly providerDiagnostic?: WorkbenchExtensionProviderDiagnosticV1
  readonly detail: string
}

export function workbenchExtensionUnavailableCopyV1(row: WorkbenchExtensionAccessRowV1): {
  readonly title: string
  readonly detail: string
} {
  const title = row.availability === 'dsh-disabled' ? 'DSH 插件已停止'
    : row.availability === 'dsh-missing' ? 'DSH 插件已卸载'
      : row.availability === 'inventory-unavailable' ? '无法读取 DSH 插件状态'
        : row.availability === 'not-allowed' ? '此扩展未允许在 Workbench 中使用'
          : row.availability === 'confirmation-required' ? '扩展更新后需要重新确认'
            : row.availability === 'incompatible' ? '扩展版本不兼容'
              : row.availability === 'editor-missing' ? '扩展没有注册此内页'
                : row.availability === 'invalid-contract' ? '扩展声明无效'
                  : '扩展身份无法核实'
  return { title, detail: row.detail }
}

/** Find access history for a stale layout reference without exposing its editor to the picker. */
export function workbenchExtensionAccessForEditorV1(
  snapshot: WorkbenchExtensionAccessSnapshotV1 | undefined,
  editorId: string,
  registeredEditorIds: readonly string[] = [],
): WorkbenchExtensionAccessRowV1 | undefined {
  const row = snapshot?.extensions.find(item => item.editorIds.includes(editorId))
  if (row === undefined || !row.allowed || registeredEditorIds.includes(editorId)) return row
  return {
    ...row,
    availability: 'editor-missing',
    allowed: false,
    detail: 'DSH 插件仍在运行，但当前版本没有注册此内页。现有布局会保留；请安装包含该内页的扩展版本。',
  }
}

export interface WorkbenchExtensionAccessSnapshotV1 {
  readonly status: 'ready' | 'unavailable'
  readonly extensions: readonly WorkbenchExtensionAccessRowV1[]
  readonly inventoryFailures?: readonly WorkbenchExtensionInventoryFailureV1[]
}

export type WorkbenchExtensionInventoryOperationV1 = 'pluginInventory.list' | 'pluginManager.listBundles' | 'unknown'

export interface WorkbenchExtensionInventoryFailureV1 {
  readonly operation: WorkbenchExtensionInventoryOperationV1
  readonly code?: string
  readonly message: string
}

export class WorkbenchExtensionInventoryReadError extends Error {
  constructor(readonly failures: readonly WorkbenchExtensionInventoryFailureV1[]) {
    super(failures.map(failure => `${failure.operation}: ${failure.message}`).join('; '))
    this.name = 'WorkbenchExtensionInventoryReadError'
  }
}

/** Public DSH pluginInventory/list row. */
export interface WorkbenchDshRuntimePluginV1 {
  readonly entryId: string
  readonly moduleName: string
  readonly enabled: boolean
  readonly fiberPhase: string | null
}

/** Public DSH pluginManager/listBundles row identity. */
export interface WorkbenchDshBundleRowV1 {
  readonly rowId: string
  readonly moduleName: string
  readonly entryId?: string
}

export interface WorkbenchDshBundleV1 {
  readonly name: string
  readonly version?: string
  readonly installed: boolean
  readonly enabled: boolean
  readonly rows: readonly WorkbenchDshBundleRowV1[]
}

export interface WorkbenchDshExtensionInventoryV1 {
  readonly plugins: readonly WorkbenchDshRuntimePluginV1[]
  readonly bundles: readonly WorkbenchDshBundleV1[]
}

export type WorkbenchExtensionProviderDiagnosticCodeV1 =
  | 'registrant-missing'
  | 'runtime-not-found'
  | 'runtime-ambiguous'
  | 'bundle-not-found'
  | 'bundle-row-missing-entry-id'
  | 'bundle-identity-conflict'
  | 'bundle-row-ambiguous'
  | 'bundle-ambiguous'

/** Evidence for the exact DSH Slot -> runtime plugin -> bundle mapping. */
export interface WorkbenchExtensionProviderDiagnosticV1 {
  readonly code: WorkbenchExtensionProviderDiagnosticCodeV1
  readonly registrant?: string
  readonly runtimeEntryIds: readonly string[]
  readonly runtimeModuleNames: readonly string[]
  readonly bundleNames: readonly string[]
  readonly detail: string
}

export type WorkbenchExtensionProviderResolutionV1 =
  | {
      readonly status: 'matched'
      readonly bundle: WorkbenchDshBundleV1
      readonly plugin: WorkbenchDshRuntimePluginV1
    }
  | {
      readonly status: 'unmatched'
      readonly diagnostic: WorkbenchExtensionProviderDiagnosticV1
    }

/** Minimal structural surface consumed by identity validation, shared by Host settings decoding. */
export interface WorkbenchExtensionEditorRowV1 {
  readonly id: string
  readonly label: string
  readonly scope: WorkbenchEditorScopeV1
  readonly pluginId?: string
  readonly declaration?: unknown
  readonly extension?: WorkbenchExtensionDeclarationV1
}

export const workbenchExtensionConsentKey = (packageName: string, moduleId: string): string =>
  `${packageName}::${moduleId}`

function fingerprint(value: unknown): string {
  // Compatibility change detector only. This is not package provenance or a signature.
  const input = canonicalJson(value)
  const seeds = [0x811c9dc5, 0x9e3779b9, 0x85ebca6b, 0xc2b2ae35]
  return seeds.map(seed => {
    let hash = seed
    for (let index = 0; index < input.length; index += 1) {
      hash ^= input.charCodeAt(index)
      hash = Math.imul(hash, 0x01000193)
    }
    return (hash >>> 0).toString(16).padStart(8, '0')
  }).join('')
}

function canonicalJson(value: unknown): string {
  const canonicalize = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(canonicalize)
    if (input !== null && typeof input === 'object') {
      const record = input as Record<string, unknown>
      return Object.fromEntries(Object.keys(record).sort().map(key => [key, canonicalize(record[key])]))
    }
    return input
  }
  return JSON.stringify(canonicalize(value)) ?? 'null'
}

export function resolveWorkbenchExtensionProviderV1(
  registrant: string | undefined,
  inventory: WorkbenchDshExtensionInventoryV1,
): WorkbenchExtensionProviderResolutionV1 {
  const trimmedRegistrant = registrant?.trim()
  if (trimmedRegistrant === undefined || trimmedRegistrant === '') {
    return { status: 'unmatched', diagnostic: {
      code: 'registrant-missing',
      ...(registrant === undefined ? {} : { registrant }),
      runtimeEntryIds: [], runtimeModuleNames: [], bundleNames: [],
      detail: 'Slot registrant is missing or empty; DSH plugin identity cannot be verified.',
    } }
  }
  // Slot registrants can reflect either the Loader entry id or its exact module
  // specifier. Accept either only when the DSH inventory yields one unique row.
  const matches = inventory.plugins.filter(plugin => plugin.entryId === trimmedRegistrant || plugin.moduleName === trimmedRegistrant)
  if (matches.length === 0) {
    return { status: 'unmatched', diagnostic: {
      code: 'runtime-not-found', registrant: trimmedRegistrant,
      runtimeEntryIds: [], runtimeModuleNames: [], bundleNames: [],
      detail: `No active DSH runtime plugin matches Slot registrant "${trimmedRegistrant}".`,
    } }
  }
  if (matches.length !== 1) {
    return { status: 'unmatched', diagnostic: {
      code: 'runtime-ambiguous', registrant: trimmedRegistrant,
      runtimeEntryIds: matches.map(plugin => plugin.entryId),
      runtimeModuleNames: matches.map(plugin => plugin.moduleName), bundleNames: [],
      detail: `Slot registrant "${trimmedRegistrant}" matches multiple DSH runtime plugins.`,
    } }
  }
  const plugin = matches[0]!
  // Bundle identity is accepted only from DSH's exact row mapping. An unkeyed
  // row or a matching package name is not enough to prove which plugin owns it.
  const exactRows = inventory.bundles.flatMap(bundle => bundle.rows
    .filter(row => row.entryId === plugin.entryId && row.moduleName === plugin.moduleName)
    .map(row => ({ bundle, row })))
  if (exactRows.length === 0) {
    const moduleRows = inventory.bundles.flatMap(bundle => bundle.rows
      .filter(row => row.moduleName === plugin.moduleName)
      .map(row => ({ bundle, row })))
    const missingEntryId = moduleRows.some(({ row }) => row.entryId === undefined)
    return { status: 'unmatched', diagnostic: {
      code: missingEntryId ? 'bundle-row-missing-entry-id' : moduleRows.length > 0 ? 'bundle-identity-conflict' : 'bundle-not-found',
      registrant: trimmedRegistrant, runtimeEntryIds: [plugin.entryId], runtimeModuleNames: [plugin.moduleName],
      bundleNames: [...new Set(moduleRows.map(({ bundle }) => bundle.name))],
      detail: missingEntryId
        ? `DSH bundle row for "${plugin.moduleName}" has no entryId; exact plugin ownership is unverified.`
        : moduleRows.length > 0
          ? `DSH bundle rows mention "${plugin.moduleName}" but their entryId does not match "${plugin.entryId}".`
          : `No DSH bundle row maps entryId "${plugin.entryId}" and module "${plugin.moduleName}".`,
    } }
  }
  const bundles = [...new Set(exactRows.map(({ bundle }) => bundle))]
  if (exactRows.length > 1 && bundles.length === 1) {
    return { status: 'unmatched', diagnostic: {
      code: 'bundle-row-ambiguous', registrant: trimmedRegistrant,
      runtimeEntryIds: [plugin.entryId], runtimeModuleNames: [plugin.moduleName], bundleNames: [bundles[0]!.name],
      detail: `A DSH bundle contains multiple rows for entryId "${plugin.entryId}" and module "${plugin.moduleName}".`,
    } }
  }
  if (bundles.length !== 1) {
    return { status: 'unmatched', diagnostic: {
      code: 'bundle-ambiguous', registrant: trimmedRegistrant,
      runtimeEntryIds: [plugin.entryId], runtimeModuleNames: [plugin.moduleName], bundleNames: bundles.map(bundle => bundle.name),
      detail: `Multiple DSH bundles claim entryId "${plugin.entryId}" and module "${plugin.moduleName}".`,
    } }
  }
  return { status: 'matched', bundle: bundles[0]!, plugin }
}

/** Resolve live Slot editors against DSH's public plugin and bundle inventories. */
export function resolveWorkbenchExtensionAccessV1(input: {
  readonly editors: readonly WorkbenchExtensionEditorRowV1[]
  readonly inventory?: WorkbenchDshExtensionInventoryV1
  readonly consents: Readonly<Record<string, WorkbenchExtensionConsentV1>>
  readonly coreVersion: string
  readonly dshGeneration: string
  readonly coreEditorIds: readonly string[]
}): {
  readonly editors: readonly WorkbenchExtensionEditorRowV1[]
  readonly snapshot: WorkbenchExtensionAccessSnapshotV1
} {
  const groups = new Map<string, WorkbenchExtensionEditorRowV1[]>()
  const accessRows: WorkbenchExtensionAccessRowV1[] = []
  const allowedEditorKeys = new Set<string>()
  const coreEditorIds = new Set(input.coreEditorIds)

  for (const editor of input.editors) {
    if (coreEditorIds.has(editor.id)) continue
    const declaration = editor.extension
    if (declaration === undefined) {
      const providerResolution = input.inventory === undefined
        ? undefined
        : resolveWorkbenchExtensionProviderV1(editor.pluginId, input.inventory)
      const provider = providerResolution?.status === 'matched' ? providerResolution : undefined
      const matchingConsents = Object.entries(input.consents).filter(([key, consent]) =>
        consent.editorIds.includes(editor.id)
        && (provider === undefined || key === workbenchExtensionConsentKey(provider.bundle.name, consent.moduleId)))
      const priorConsent = matchingConsents.length === 1 ? matchingConsents[0]![1] : undefined
      accessRows.push({
        key: priorConsent === undefined
          ? `unverified:${editor.pluginId ?? 'unknown'}:${editor.id}`
          : workbenchExtensionConsentKey(priorConsent.packageName, priorConsent.moduleId),
        ...(priorConsent === undefined ? {} : {
          packageName: priorConsent.packageName,
          ...(provider?.bundle.version === undefined ? {} : { packageVersion: provider.bundle.version }),
          apiVersion: priorConsent.apiVersion,
        }),
        moduleId: editor.id,
        editorIds: priorConsent?.editorIds ?? [editor.id],
        availability: input.inventory === undefined ? 'inventory-unavailable' : 'identity-unverified',
        allowed: false,
        ...(providerResolution?.status === 'unmatched' ? { providerDiagnostic: providerResolution.diagnostic } : {}),
        detail: priorConsent === undefined
          ? '此内页没有 Workbench 扩展声明；为保护现有工作台，暂不加入可用内页。'
          : '此内页的扩展声明已消失。现有布局会保留；请检查 DSH 插件版本或重新启用该扩展。',
      })
      continue
    }
    const extensionFailure = workbenchExtensionDeclarationFailureV1(declaration)
    const declarationFailure = workbenchEditorDeclarationFailureV1(editor.declaration, editor.scope, editor.id)
    if (extensionFailure !== undefined || declarationFailure !== undefined) {
      accessRows.push({
        key: `invalid:${editor.pluginId ?? 'unknown'}:${editor.id}`,
        moduleId: extensionFailure === undefined ? declaration!.moduleId : editor.id,
        editorIds: [editor.id],
        availability: 'invalid-contract',
        allowed: false,
        detail: extensionFailure !== undefined
          ? `Workbench 扩展身份声明无效：${extensionFailure}`
          : `Workbench 内页声明无效：${declarationFailure}`,
      })
      continue
    }
    const extensionDeclaration = declaration!
    const groupKey = `${editor.pluginId ?? 'unknown'}::${extensionDeclaration.moduleId}`
    const group = groups.get(groupKey) ?? []
    group.push(editor)
    groups.set(groupKey, group)
  }

  const editorOwners = new Map<string, Set<string>>()
  for (const [groupKey, editors] of groups) {
    for (const editor of editors) {
      const editorKey = `${editor.scope}:${editor.id}`
      const owners = editorOwners.get(editorKey) ?? new Set<string>()
      owners.add(groupKey)
      editorOwners.set(editorKey, owners)
    }
  }
  const ambiguousEditorKeys = new Set([...editorOwners]
    .filter(([, owners]) => owners.size > 1)
    .map(([editorKey]) => editorKey))

  for (const [groupKey, editors] of groups) {
    const first = editors[0]!
    const extension = first.extension!
    const editorIds = [...new Set(editors.map(editor => editor.id))].sort()
    const declaredIds = [...extension.editorIds].sort()
    const sameDeclaration = editors.every(editor => canonicalJson(editor.extension) === canonicalJson(extension))
    const complete = canonicalJson(editorIds) === canonicalJson(declaredIds)
    const duplicateEditor = editors.length !== editorIds.length
    const hasAmbiguousEditor = editors.some(editor => ambiguousEditorKeys.has(`${editor.scope}:${editor.id}`))
    const declarationFingerprint = fingerprint({ extension, editors: editors.map(editor => ({
      id: editor.id, scope: editor.scope, declaration: consentDeclaration(editor.declaration),
    })).sort((left, right) => `${left.scope}:${left.id}`.localeCompare(`${right.scope}:${right.id}`)) })
    const providerResolution = input.inventory === undefined
      ? undefined
      : resolveWorkbenchExtensionProviderV1(first.pluginId, input.inventory)
    const provider = providerResolution?.status === 'matched' ? providerResolution : undefined
    const consentKey = provider === undefined ? undefined : workbenchExtensionConsentKey(provider.bundle.name, extension.moduleId)
    const consent = consentKey === undefined ? undefined : input.consents[consentKey]
    const knownEditorIds = [...new Set([...editorIds, ...declaredIds, ...(consent?.editorIds ?? [])])].sort()
    let availability: WorkbenchExtensionAvailabilityV1 = 'ready'
    let detail = 'DSH 包身份、运行状态和 Workbench 扩展声明已验证。'
    if (!sameDeclaration || !complete || duplicateEditor || hasAmbiguousEditor) {
      availability = 'invalid-contract'
      detail = hasAmbiguousEditor
        ? '多个扩展注册了相同的 Workbench 内页 ID；为避免错误挂载，冲突内页均不可用。'
        : duplicateEditor
          ? '此 DSH 插件重复注册了相同的 Workbench 内页 ID。'
          : '此 DSH 插件的 Workbench 声明不完整，或同一扩展中的内页声明不一致。'
    } else if (input.inventory === undefined) {
      availability = 'inventory-unavailable'
      detail = 'Workbench 暂时无法读取 DSH 插件清单；此扩展保持不可用，连接恢复后可重试。'
    } else if (provider === undefined) {
      availability = 'identity-unverified'
      detail = providerResolution?.status === 'unmatched'
        ? providerResolution.diagnostic.detail
        : '无法通过 DSH 插件清单将此内页唯一对应到已安装插件包。'
    } else if (!provider.bundle.installed) {
      availability = 'dsh-missing'
      detail = 'DSH 插件包已卸载；现有布局引用会保留，重新安装并启用原扩展后可恢复。'
    } else if (!provider.bundle.enabled || !provider.plugin.enabled || provider.plugin.fiberPhase !== 'active') {
      availability = 'dsh-disabled'
      detail = '此插件当前未由 DSH 正常运行；请在 DSH 插件管理中处理。'
    } else if (extension.coreCompatibility !== input.coreVersion || extension.dshGeneration !== input.dshGeneration) {
      availability = 'incompatible'
      detail = '扩展声明的 Workbench Core 或 DSH 版本与当前运行版本不一致。'
    }
    const consentIdentityMatches = consent !== undefined
      && consent.packageName === provider?.bundle.name
      && consent.moduleId === extension.moduleId
      && consent.apiVersion === extension.apiVersion
    const allowed = availability === 'ready' && consentIdentityMatches && consent!.allowed !== false
      && consent!.contractFingerprint === declarationFingerprint
    if (availability === 'ready' && !allowed) {
      availability = consentIdentityMatches && consent!.allowed !== false ? 'confirmation-required' : 'not-allowed'
      detail = consentIdentityMatches && consent!.allowed !== false
        ? '扩展的版本或内页声明已变化；请重新确认后再在 Workbench 中使用。'
        : consentIdentityMatches
          ? '此扩展已被禁止在 Workbench 中使用；允许后，它才会重新出现在“添加内页”中。'
          : '已发现兼容的 Workbench 扩展；允许后，它才会出现在“添加内页”中。'
    }
    if (allowed) for (const editor of editors) allowedEditorKeys.add(`${editor.scope}:${editor.id}`)
    accessRows.push({
      key: consentKey ?? groupKey,
      ...(provider === undefined ? {} : {
        packageName: provider.bundle.name,
        ...(provider.bundle.version === undefined ? {} : { packageVersion: provider.bundle.version }),
      }),
      moduleId: extension.moduleId,
      apiVersion: extension.apiVersion,
      editorIds: knownEditorIds,
      availability,
      allowed,
      contractFingerprint: declarationFingerprint,
      ...(providerResolution?.status === 'unmatched' ? { providerDiagnostic: providerResolution.diagnostic } : {}),
      detail,
    })
  }

  // Preserve consent rows after a DSH plugin is disabled or removed. The
  // corresponding layout references are left intact and can recover later.
  for (const [key, consent] of Object.entries(input.consents)) {
    if (accessRows.some(row => row.key === key)) continue
    const bundle = input.inventory?.bundles.find(item => item.name === consent.packageName)
    const runningPlugin = bundle === undefined ? undefined : input.inventory?.plugins.find(plugin =>
      bundle.rows.some(row => row.entryId === plugin.entryId && row.moduleName === plugin.moduleName))
    const availability: WorkbenchExtensionAvailabilityV1 = input.inventory === undefined
      ? 'inventory-unavailable'
      : bundle === undefined || !bundle.installed
        ? 'dsh-missing'
        : !bundle.enabled || runningPlugin === undefined || !runningPlugin.enabled || runningPlugin.fiberPhase !== 'active'
          ? 'dsh-disabled'
          : 'editor-missing'
    accessRows.push({
      key,
      packageName: consent.packageName,
      moduleId: consent.moduleId,
      apiVersion: consent.apiVersion,
      editorIds: consent.editorIds,
      availability,
      allowed: false,
      detail: availability === 'inventory-unavailable'
        ? 'Workbench 暂时无法读取 DSH 插件清单；已有布局引用已保留，连接恢复后可重试。'
        : availability === 'dsh-disabled'
          ? 'DSH 插件已停止或暂未注册 Workbench 内页；已有布局引用已保留，启用插件后可恢复。'
          : availability === 'editor-missing'
            ? 'DSH 插件正在运行，但没有注册此内页；请检查扩展版本或恢复该内页声明。'
            : 'DSH 插件包已卸载；已有布局引用已保留，重新安装并启用原扩展后可恢复。',
    })
  }

  const visibleEditors = input.editors.filter(editor => {
    if (coreEditorIds.has(editor.id)) return true
    return allowedEditorKeys.has(`${editor.scope}:${editor.id}`)
  })
  return {
    editors: visibleEditors,
    snapshot: {
      status: input.inventory === undefined ? 'unavailable' : 'ready',
      extensions: accessRows.sort((left, right) => left.moduleId.localeCompare(right.moduleId, 'en')),
    },
  }
}

// Presentation text does not change permission or matching semantics.
function consentDeclaration(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value
  const declaration = value as Record<string, unknown>
  if (!Array.isArray(declaration.conversationResources)) return declaration
  return { ...declaration, conversationResources: declaration.conversationResources.map(resource => {
    if (!resource || typeof resource !== 'object') return resource
    const { displayName: _name, description: _description, ...contract } = resource as Record<string, unknown>
    return contract
  }) }
}
