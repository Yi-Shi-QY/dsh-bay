import {
  canonicalWorkbenchEditorId, REMOVED_WORKBENCH_EDITOR_IDS,
} from './model.ts'
import type {
  DropEdge, JsonValue, SessionBindingV1, TabDocument, WorkbenchLayoutDocument,
} from './model.ts'

/** A project-neutral Workbench document persisted independently of Workspace membership. */
export interface WorkbenchDocumentV3 {
  version: 3
  root: WorkbenchNodeV3
  activeAreaId: string
}

/** Recursive split-tree node in a project-neutral Workbench document. */
export type WorkbenchNodeV3 = WorkbenchSplitNodeV3 | AreaNode

/** A recursive two-child split in a v3 Workbench. */
export interface WorkbenchSplitNodeV3 {
  kind: 'split'
  id: string
  axis: 'horizontal' | 'vertical'
  ratio: number
  first: WorkbenchNodeV3
  second: WorkbenchNodeV3
}

/** A visual rectangle with one current module.
 *
 * `moduleHistory` is retained in the wire shape for backwards compatibility
 * with Workbench V2/V3 documents. New durable documents contain at most the
 * current module; legacy history is collapsed at decode/write boundaries.
 */
export interface AreaNode {
  kind: 'area'
  areaId: string
  /** One explicit binding shared by all session-scoped modules in this Area. */
  areaBinding?: SessionBindingV1
  areaBindingGeneration?: number
  activeModuleInstanceId?: string
  moduleHistory: ModuleInstanceDocument[]
}

/** One stable editor module and its exact Session binding. */
export interface ModuleInstanceDocument {
  moduleInstanceId: string
  editorId: string
  editorScope: 'root' | 'session'
  binding?: SessionBindingV1
  /** Explicitly inert Session page awaiting a recipient-local binding. */
  pendingBinding?: string
  /** Inert until this Host distribution transaction restores verified state. */
  pendingDistribution?: string
  state: JsonValue
  sessionStates?: Record<string, JsonValue>
  sessionStateOrder?: string[]
  bindingGeneration?: number
  lastKnownTitle: string
}

function safeRatio(value: number): number {
  if (!Number.isFinite(value)) return 0.5
  return Math.min(1, Math.max(0, value))
}

/** High-level v3 commands whose user-facing split and copy semantics are intentionally distinct. */
export type WorkbenchCommandV3 =
  | {
    type: 'split-empty'
    sourceAreaId: string
    edge: Exclude<DropEdge, 'center'>
    ratio?: number
  }
  | {
    type: 'duplicate-view'
    moduleInstanceId: string
    edge: Exclude<DropEdge, 'center'>
    ratio?: number
  }

/** Allocates stable visual identities for Workbench document mutations. */
export type WorkbenchIdFactory = (kind: 'area' | 'module' | 'split') => string

function uniqueIdAllocator(
  createId: WorkbenchIdFactory,
  occupied: Set<string>,
): WorkbenchIdFactory {
  return (kind) => {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const candidate = createId(kind)
      if (candidate.length > 0 && !occupied.has(candidate)) {
        occupied.add(candidate)
        return candidate
      }
    }
    throw new Error(`Unable to allocate a unique ${kind} id`)
  }
}

/**
 * Apply one high-level Workbench command as a single immutable mutation.
 * @param document - current validated Workbench document.
 * @param command - split or duplicate operation to apply.
 * @param createId - identity allocator for newly created document nodes.
 * @returns the original document for a no-op, otherwise the updated document.
 */
export function applyWorkbenchCommandV3(
  document: WorkbenchDocumentV3,
  command: WorkbenchCommandV3,
  createId: WorkbenchIdFactory = kind => `${kind}-${globalThis.crypto.randomUUID()}`,
): WorkbenchDocumentV3 {
  // Commands can be replayed against a legacy in-memory document before the
  // Settings decoder has written its migration. Collapse compatibility history
  // first so duplicate/split operations never carry stale editor navigation
  // entries into the next durable snapshot.
  document = normalizeWorkbenchDocument(document)
  const occupied = new Set<string>()
  collectIds(document.root, occupied)
  const nextId = uniqueIdAllocator(createId, occupied)
  if (command.type === 'split-empty') {
    const source = areasOf(document.root).find(area => area.areaId === command.sourceAreaId)
    if (source === undefined) return document
    const sourceModule = source.moduleHistory.find(
      module => module.moduleInstanceId === source.activeModuleInstanceId,
    )
    const areaId = nextId('area')
    const moduleInstanceId = nextId('module')
    const splitId = nextId('split')
    const sourceTarget = source?.areaBinding ?? sourceModule?.binding
    const launcher: ModuleInstanceDocument = {
      moduleInstanceId,
      editorId: 'workbench.conversation.start',
      editorScope: 'root',
      lastKnownTitle: '新建对话',
      state: {},
    }
    const newArea: AreaNode = {
      kind: 'area', areaId, activeModuleInstanceId: moduleInstanceId,
      moduleHistory: [launcher],
    }
    return splitBeside(document, source.areaId, newArea, splitId, command.edge, command.ratio)
  }
  const located = findModule(document.root, command.moduleInstanceId)
  if (located === undefined) return document
  const areaId = nextId('area')
  const moduleInstanceId = nextId('module')
  const splitId = nextId('split')
  const copied: ModuleInstanceDocument = structuredClone(located.module)
  copied.moduleInstanceId = moduleInstanceId
  const newArea: AreaNode = {
    kind: 'area', areaId, ...(located.area.areaBinding === undefined ? {} : { areaBinding: structuredClone(located.area.areaBinding) }), activeModuleInstanceId: moduleInstanceId, moduleHistory: [copied],
  }
  return splitBeside(document, located.area.areaId, newArea, splitId, command.edge, command.ratio)
}

function splitBeside(
  document: WorkbenchDocumentV3,
  sourceAreaId: string,
  inserted: AreaNode,
  splitId: string,
  edge: Exclude<DropEdge, 'center'>,
  requestedRatio = 0.5,
): WorkbenchDocumentV3 {
  const axis = edge === 'left' || edge === 'right' ? 'horizontal' : 'vertical'
  const insertFirst = edge === 'left' || edge === 'top'
  const ratio = Math.min(1, Math.max(0, requestedRatio))
  const firstTrackRatio = Number((insertFirst ? ratio : 1 - ratio).toFixed(4))
  const root = replaceArea(document.root, sourceAreaId, source => ({
    kind: 'split', id: splitId, axis,
    ratio: firstTrackRatio,
    first: insertFirst ? inserted : source,
    second: insertFirst ? source : inserted,
  }))
  return { version: 3, root, activeAreaId: inserted.areaId }
}

function replaceArea(
  node: WorkbenchNodeV3,
  areaId: string,
  replace: (area: AreaNode) => WorkbenchNodeV3,
): WorkbenchNodeV3 {
  if (node.kind === 'area') return node.areaId === areaId ? replace(node) : node
  return {
    ...node,
    first: replaceArea(node.first, areaId, replace),
    second: replaceArea(node.second, areaId, replace),
  }
}

function findModule(
  node: WorkbenchNodeV3,
  moduleInstanceId: string,
): { area: AreaNode; module: ModuleInstanceDocument } | undefined {
  for (const area of areasOf(node)) {
    const module = area.moduleHistory.find(item => item.moduleInstanceId === moduleInstanceId)
    if (module !== undefined) return { area, module }
  }
  return undefined
}

function collectIds(node: WorkbenchNodeV3, result: Set<string>): void {
  if (node.kind === 'area') {
    result.add(node.areaId)
    for (const module of node.moduleHistory) result.add(module.moduleInstanceId)
    return
  }
  result.add(node.id)
  collectIds(node.first, result)
  collectIds(node.second, result)
}

/**
 * Flatten all v3 Areas in visual traversal order.
 * @param node - Workbench subtree to traverse.
 * @returns Areas in first-to-second visual order.
 */
export function areasOf(node: WorkbenchNodeV3): AreaNode[] {
  return node.kind === 'area' ? [node] : [...areasOf(node.first), ...areasOf(node.second)]
}

/**
 * Flatten all v3 module instances in visual traversal order.
 * @param node - Workbench subtree to traverse.
 * @returns module instances grouped by Area traversal order.
 */
export function modulesOf(node: WorkbenchNodeV3): ModuleInstanceDocument[] {
  return areasOf(node).flatMap(area => area.moduleHistory)
}

/**
 * Clone a reusable layout snapshot while allocating fresh visual identities.
 * @param document - template document whose bindings and state are retained.
 * @param createId - identity allocator for the cloned visual nodes.
 * @returns a cloned document with no reused Area, split, or module identity.
 */
export function cloneWorkbenchDocumentWithFreshIds(
  document: WorkbenchDocumentV3,
  createId: WorkbenchIdFactory = kind => `${kind}-${globalThis.crypto.randomUUID()}`,
): WorkbenchDocumentV3 {
  const sourceDocument = normalizeWorkbenchDocument(document)
  const occupied = new Set<string>()
  const allocate = uniqueIdAllocator(createId, occupied)
  const areaIds = new Map<string, string>()
  const cloneNode = (node: WorkbenchNodeV3): WorkbenchNodeV3 => {
    if (node.kind === 'split') return {
      kind: 'split', id: allocate('split'), axis: node.axis, ratio: safeRatio(node.ratio),
      first: cloneNode(node.first), second: cloneNode(node.second),
    }
    const areaId = allocate('area')
    areaIds.set(node.areaId, areaId)
    const moduleIds = new Map<string, string>()
    const moduleHistory = node.moduleHistory.map((module) => {
      const moduleInstanceId = allocate('module')
      moduleIds.set(module.moduleInstanceId, moduleInstanceId)
      return { ...structuredClone(module), moduleInstanceId }
    })
    const activeModuleInstanceId = node.activeModuleInstanceId === undefined
      ? undefined
      : moduleIds.get(node.activeModuleInstanceId)
    return {
      kind: 'area', areaId, moduleHistory,
      ...(node.areaBinding === undefined ? {} : { areaBinding: structuredClone(node.areaBinding) }),
      ...(node.areaBindingGeneration === undefined ? {} : { areaBindingGeneration: node.areaBindingGeneration }),
      ...(activeModuleInstanceId === undefined ? {} : { activeModuleInstanceId }),
    }
  }
  const root = cloneNode(sourceDocument.root)
  const activeAreaId = areaIds.get(sourceDocument.activeAreaId)
  if (activeAreaId === undefined) throw new Error('Active Area is missing from Workbench document')
  return { version: 3, root, activeAreaId }
}

/**
 * Losslessly convert a validated v2 account layout into a project-neutral document.
 * @param document - validated legacy account-scoped layout.
 * @returns the equivalent v3 Workbench document.
 */
export function migrateDocumentV2ToV3(document: WorkbenchLayoutDocument): WorkbenchDocumentV3 {
  const convertModule = (tab: TabDocument): ModuleInstanceDocument => ({
    moduleInstanceId: tab.id,
    editorId: tab.editorId,
    editorScope: tab.editorScope,
    ...(tab.binding === undefined ? {} : { binding: structuredClone(tab.binding) }),
    ...(tab.pendingBinding === undefined ? {} : { pendingBinding: tab.pendingBinding }),
    ...(tab.pendingDistribution === undefined ? {} : { pendingDistribution: tab.pendingDistribution }),
    state: structuredClone(tab.state),
    ...(tab.sessionStates === undefined ? {} : { sessionStates: structuredClone(tab.sessionStates) }),
    ...(tab.sessionStateOrder === undefined ? {} : { sessionStateOrder: [...tab.sessionStateOrder] }),
    ...(tab.bindingGeneration === undefined ? {} : { bindingGeneration: tab.bindingGeneration }),
    lastKnownTitle: tab.lastKnownTitle,
  })
  const convertNode = (node: WorkbenchLayoutDocument['root']): WorkbenchNodeV3 => {
    if (node.kind === 'split') return {
      kind: 'split', id: node.id, axis: node.axis, ratio: safeRatio(node.ratio),
      first: convertNode(node.first), second: convertNode(node.second),
    }
    return {
      kind: 'area',
      areaId: node.id,
      ...(node.areaBinding === undefined ? {} : { areaBinding: structuredClone(node.areaBinding) }),
      ...(node.areaBindingGeneration === undefined ? {} : { areaBindingGeneration: node.areaBindingGeneration }),
      ...(node.activeTabId === undefined ? {} : { activeModuleInstanceId: node.activeTabId }),
      moduleHistory: node.tabs.map(convertModule),
    }
  }
  return normalizeWorkbenchDocument(removeRetiredWorkbenchEditors({
    version: 3, root: convertNode(document.root), activeAreaId: document.activeGroupId,
  }))
}

/**
 * Collapse compatibility `moduleHistory` arrays to the one current module.
 *
 * Workbench navigation history is UI-local and must not be durable: the DSH
 * Session store owns conversation history. The legacy array remains in the
 * document schema so older packages can still be decoded, but every new
 * read/write projection keeps only the active module (or the first module
 * when a legacy document has no valid active id).
 */
export function compactWorkbenchDocumentHistory(
  document: WorkbenchDocumentV3,
): { document: WorkbenchDocumentV3; changed: boolean } {
  let changed = false
  const compactNode = (node: WorkbenchNodeV3): WorkbenchNodeV3 => {
    if (node.kind === 'split') {
      const first = compactNode(node.first)
      const second = compactNode(node.second)
      if (first === node.first && second === node.second) return node
      changed = true
      return { ...node, first, second }
    }
    if (node.moduleHistory.length === 0) return node
    const current = node.moduleHistory.find(
      module => module.moduleInstanceId === node.activeModuleInstanceId,
    ) ?? node.moduleHistory[0]
    if (current === undefined) return node
    const alreadyCompact = node.moduleHistory.length === 1
      && node.moduleHistory[0] === current
      && node.activeModuleInstanceId === current.moduleInstanceId
    if (alreadyCompact) return node
    changed = true
    return {
      kind: 'area', areaId: node.areaId,
      activeModuleInstanceId: current.moduleInstanceId,
      moduleHistory: [current],
    }
  }
  const root = compactNode(document.root)
  if (!changed) return { document, changed: false }
  return { document: { ...document, root }, changed: true }
}

/** Canonicalize editor ids and infer one shared Area binding while preserving tabs. */
export function normalizeWorkbenchDocument(document: WorkbenchDocumentV3): WorkbenchDocumentV3 {
  const normalizeNode = (node: WorkbenchNodeV3): WorkbenchNodeV3 => {
    if (node.kind === 'split') {
      const first = normalizeNode(node.first), second = normalizeNode(node.second)
      return first === node.first && second === node.second ? node : { ...node, first, second }
    }
    const moduleHistory = node.moduleHistory.map(module => {
      const editorId = canonicalWorkbenchEditorId(module.editorId)
      // A root Start may retain one native Session during message preparation.
      // Preserve the exact binding on reopen; only its accepted first prompt
      // promotes the occurrence to the Conversation editor.
      if (editorId === 'workbench.conversation.start') {
        return { ...module, editorId, editorScope: 'root' as const }
      }
      return editorId === module.editorId ? module : { ...module, editorId }
    })
    const sessionModules = moduleHistory.filter(module => module.editorScope === 'session'
      || (module.editorId === 'workbench.conversation.start' && module.binding !== undefined))
    const inferredBinding = sessionModules.length === 0 ? undefined : node.areaBinding ?? sessionModules[0]?.binding
    const bindingMatches = inferredBinding === undefined || sessionModules.every(module => (
      module.binding?.sessionId === inferredBinding.sessionId && module.binding?.workspaceId === inferredBinding.workspaceId
    ))
    const activeModuleInstanceId = moduleHistory.some(module => module.moduleInstanceId === node.activeModuleInstanceId)
      ? node.activeModuleInstanceId : moduleHistory[0]?.moduleInstanceId
    return {
      kind: 'area', areaId: node.areaId, moduleHistory,
      ...(bindingMatches && inferredBinding !== undefined ? { areaBinding: structuredClone(inferredBinding) } : {}),
      ...(node.areaBindingGeneration === undefined ? {} : { areaBindingGeneration: node.areaBindingGeneration }),
      ...(activeModuleInstanceId === undefined ? {} : { activeModuleInstanceId }),
    }
  }
  const root = normalizeNode(document.root)
  return root === document.root ? document : { ...document, root }
}

/**
 * Remove retired Workbench editors from a project-neutral document.
 *
 * Tool Details was an empty Workbench page.  Keeping it in a persisted module
 * history lets old layouts resurrect it after a restart, so migration replaces
 * an Area containing only that editor with the Conversation Launcher while
 * preserving every unrelated editor and stable Area/module identity.
 *
 * @param document - validated or newly migrated Workbench document.
 * @returns the cleaned document, or the same object when no retired editor exists.
 */
export function removeRetiredWorkbenchEditors(document: WorkbenchDocumentV3): WorkbenchDocumentV3 {
  const cleanNode = (node: WorkbenchNodeV3): WorkbenchNodeV3 => {
    if (node.kind === 'split') {
      const first = cleanNode(node.first)
      const second = cleanNode(node.second)
      if (first === node.first && second === node.second) return node
      return { ...node, first, second }
    }
    const removed = node.moduleHistory.filter(module => REMOVED_WORKBENCH_EDITOR_IDS.has(module.editorId))
    const moduleHistory = node.moduleHistory.filter(module => !REMOVED_WORKBENCH_EDITOR_IDS.has(module.editorId))
    if (moduleHistory.length === node.moduleHistory.length) return node
    if (moduleHistory.length === 0 && removed[0] !== undefined) {
      const launcher: ModuleInstanceDocument = {
        moduleInstanceId: removed[0].moduleInstanceId,
        editorId: 'workbench.conversation.start',
        editorScope: 'root',
        state: {},
        lastKnownTitle: '新建对话',
      }
      return { kind: 'area', areaId: node.areaId, activeModuleInstanceId: launcher.moduleInstanceId,
        moduleHistory: [launcher], ...(node.areaBinding === undefined ? {} : { areaBinding: structuredClone(node.areaBinding) }),
        ...(node.areaBindingGeneration === undefined ? {} : { areaBindingGeneration: node.areaBindingGeneration }) }
    }
    const activeModuleInstanceId = moduleHistory.some(
      module => module.moduleInstanceId === node.activeModuleInstanceId,
    )
      ? node.activeModuleInstanceId
      : moduleHistory[0]?.moduleInstanceId
    return activeModuleInstanceId === undefined
      ? { kind: 'area', areaId: node.areaId, moduleHistory,
        ...(node.areaBinding === undefined ? {} : { areaBinding: structuredClone(node.areaBinding) }),
        ...(node.areaBindingGeneration === undefined ? {} : { areaBindingGeneration: node.areaBindingGeneration }) }
      : { kind: 'area', areaId: node.areaId, activeModuleInstanceId, moduleHistory,
        ...(node.areaBinding === undefined ? {} : { areaBinding: structuredClone(node.areaBinding) }),
        ...(node.areaBindingGeneration === undefined ? {} : { areaBindingGeneration: node.areaBindingGeneration }) }
  }
  const root = cleanNode(document.root)
  return root === document.root ? document : { ...document, root }
}

/**
 * Project a v3 document onto the mature v2 reducer used by the visual Frame.
 * @param document - project-neutral Workbench document.
 * @returns a transient v2-shaped visual layout.
 */
export function projectDocumentV3ToLayoutV2(document: WorkbenchDocumentV3): WorkbenchLayoutDocument {
  const sourceDocument = normalizeWorkbenchDocument(document)
  const convertModule = (module: ModuleInstanceDocument): TabDocument => ({
    id: module.moduleInstanceId,
    editorId: module.editorId,
    editorScope: module.editorScope,
    ...(module.pendingBinding === undefined ? {} : { pendingBinding: module.pendingBinding }),
    ...(module.pendingDistribution === undefined ? {} : { pendingDistribution: module.pendingDistribution }),
    ...(module.binding === undefined ? {} : {
      binding: structuredClone(module.binding), sessionId: module.binding.sessionId,
    }),
    state: structuredClone(module.state),
    ...(module.sessionStates === undefined ? {} : { sessionStates: structuredClone(module.sessionStates) }),
    ...(module.sessionStateOrder === undefined ? {} : { sessionStateOrder: [...module.sessionStateOrder] }),
    ...(module.bindingGeneration === undefined ? {} : { bindingGeneration: module.bindingGeneration }),
    lastKnownTitle: module.lastKnownTitle,
  })
  const convertNode = (node: WorkbenchNodeV3): WorkbenchLayoutDocument['root'] => {
    if (node.kind === 'split') return {
      kind: 'split', id: node.id, axis: node.axis, ratio: safeRatio(node.ratio),
      first: convertNode(node.first), second: convertNode(node.second),
    }
    return {
      kind: 'group', id: node.areaId,
      ...(node.areaBinding === undefined ? {} : { areaBinding: structuredClone(node.areaBinding) }),
      ...(node.areaBindingGeneration === undefined ? {} : { areaBindingGeneration: node.areaBindingGeneration }),
      ...(node.activeModuleInstanceId === undefined ? {} : { activeTabId: node.activeModuleInstanceId }),
      tabs: node.moduleHistory.map(convertModule),
    }
  }
  return { version: 2, root: convertNode(sourceDocument.root), activeGroupId: sourceDocument.activeAreaId }
}

/**
 * Validate and clone a v3 document without imposing a Workspace account.
 * @param value - unknown Settings value to validate.
 * @param options - detached validation is only for offline preflight, never Settings activation.
 * @returns a safe cloned document, or undefined for invalid input.
 */
export function validateWorkbenchDocumentV3(value: unknown, options: { allowDetachedSession?: boolean } = {}): WorkbenchDocumentV3 | undefined {
  if (!isRecord(value) || value.version !== 3 || typeof value.activeAreaId !== 'string') return undefined
  const ids = new Set<string>()
  const moduleIds = new Set<string>()
  const decodeModule = (candidate: unknown): ModuleInstanceDocument | undefined => {
    if (!isRecord(candidate)
      || typeof candidate.moduleInstanceId !== 'string'
      || typeof candidate.editorId !== 'string'
      || (candidate.editorScope !== 'root' && candidate.editorScope !== 'session')
      || typeof candidate.lastKnownTitle !== 'string'
      || !isJsonValue(candidate.state)
      || moduleIds.has(candidate.moduleInstanceId)) return undefined
    const preparedStart = candidate.editorScope === 'root'
      && candidate.editorId === 'workbench.conversation.start'
    if (candidate.pendingDistribution !== undefined && (typeof candidate.pendingDistribution !== 'string' || !/^distribution-[a-f0-9-]{36}$/u.test(candidate.pendingDistribution))) return undefined
    if (candidate.editorScope === 'root' && candidate.binding !== undefined
      && (!preparedStart || !isSessionBinding(candidate.binding))) return undefined
    if (candidate.pendingBinding !== undefined && (candidate.editorScope !== 'session'
      || typeof candidate.pendingBinding !== 'string' || !/^binding-[1-9][0-9]{0,2}$/u.test(candidate.pendingBinding)
      || candidate.binding !== undefined || candidate.sessionStates !== undefined || candidate.sessionStateOrder !== undefined
      || candidate.bindingGeneration !== undefined)) return undefined
    if (preparedStart && candidate.binding !== undefined
      && (candidate.bindingGeneration === undefined
        || typeof candidate.bindingGeneration !== 'number'
        || !Number.isSafeInteger(candidate.bindingGeneration)
        || candidate.bindingGeneration < 0)) return undefined
    if (candidate.editorScope === 'session' && !isSessionBinding(candidate.binding)
      && candidate.pendingBinding === undefined
      && !(options.allowDetachedSession === true && candidate.binding === undefined)) return undefined
    if (candidate.bindingGeneration !== undefined
      && (typeof candidate.bindingGeneration !== 'number'
        || !Number.isSafeInteger(candidate.bindingGeneration)
        || candidate.bindingGeneration < 0)) return undefined
    if (candidate.sessionStates !== undefined && (!isRecord(candidate.sessionStates)
      || !Object.values(candidate.sessionStates).every(isJsonValue))) return undefined
    if (candidate.sessionStateOrder !== undefined && (!Array.isArray(candidate.sessionStateOrder)
      || !candidate.sessionStateOrder.every(item => typeof item === 'string'))) return undefined
    moduleIds.add(candidate.moduleInstanceId)
    return structuredClone(candidate) as unknown as ModuleInstanceDocument
  }
  const decodeNode = (candidate: unknown): WorkbenchNodeV3 | undefined => {
    if (!isRecord(candidate)) return undefined
    if (candidate.kind === 'area') {
      if (typeof candidate.areaId !== 'string' || ids.has(candidate.areaId)
        || !Array.isArray(candidate.moduleHistory)) return undefined
      ids.add(candidate.areaId)
      const moduleHistory: ModuleInstanceDocument[] = []
      for (const module of candidate.moduleHistory) {
        const decoded = decodeModule(module)
        if (decoded === undefined) return undefined
        moduleHistory.push(decoded)
      }
      const active = candidate.activeModuleInstanceId
      if (active !== undefined && (typeof active !== 'string'
        || !moduleHistory.some(module => module.moduleInstanceId === active))) return undefined
      if (candidate.areaBinding !== undefined && !isSessionBinding(candidate.areaBinding)) return undefined
      const sessionModules = moduleHistory.filter(module => module.editorScope === 'session'
        || (module.editorId === 'workbench.conversation.start' && module.binding !== undefined))
      const inferred = candidate.areaBinding ?? sessionModules[0]?.binding
      const matches = inferred === undefined || sessionModules.every(module => module.binding?.sessionId === inferred.sessionId && module.binding?.workspaceId === inferred.workspaceId)
      // Explicit shared binding remains strict. Without it each module may own
      // a separate conversation, as normalization and the V2 model already allow.
      if (candidate.areaBinding !== undefined && !matches) return undefined
      const areaBinding = matches ? inferred : undefined
      if (candidate.areaBindingGeneration !== undefined && (typeof candidate.areaBindingGeneration !== 'number'
        || !Number.isSafeInteger(candidate.areaBindingGeneration) || candidate.areaBindingGeneration < 0)) return undefined
      return {
        kind: 'area', areaId: candidate.areaId, moduleHistory,
        ...(areaBinding === undefined ? {} : { areaBinding: structuredClone(areaBinding) }),
        ...(candidate.areaBindingGeneration === undefined ? {} : { areaBindingGeneration: candidate.areaBindingGeneration }),
        ...(active === undefined ? {} : { activeModuleInstanceId: active }),
      }
    }
    if (candidate.kind !== 'split' || typeof candidate.id !== 'string' || ids.has(candidate.id)
      || (candidate.axis !== 'horizontal' && candidate.axis !== 'vertical')
      || typeof candidate.ratio !== 'number' || !Number.isFinite(candidate.ratio)) return undefined
    ids.add(candidate.id)
    const first = decodeNode(candidate.first)
    const second = decodeNode(candidate.second)
    if (first === undefined || second === undefined) return undefined
    return {
      kind: 'split', id: candidate.id, axis: candidate.axis,
      ratio: Math.min(1, Math.max(0, candidate.ratio)), first, second,
    }
  }
  const root = decodeNode(value.root)
  if (root === undefined || !areasOf(root).some(area => area.areaId === value.activeAreaId)) return undefined
  return { version: 3, root, activeAreaId: value.activeAreaId }
}

function isSessionBinding(value: unknown): value is SessionBindingV1 {
  return isRecord(value) && typeof value.sessionId === 'string'
    && (value.workspaceId === undefined || typeof value.workspaceId === 'string')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (Array.isArray(value)) return value.every(isJsonValue)
  return isRecord(value) && Object.values(value).every(isJsonValue)
}
