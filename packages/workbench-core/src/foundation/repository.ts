import type { SessionBindingV1 } from './model.ts'
import { sessionTargetKey } from './model.ts'
import {
  areasOf, normalizeWorkbenchDocument, type AreaNode, type ModuleInstanceDocument,
  type WorkbenchDocumentV3, type WorkbenchNodeV3,
} from './document-v3.ts'
import type { WorkbenchAreaMetadataV1, WorkbenchRecordV2, WorkbenchSettingsV4 } from './persistence.ts'
import {
  areaContextOf, patchAreaContext, patchWorkbenchContext, workbenchContextOf,
  type AreaContextV1, type ContextPatchOptions, type ContextPatchResult, type WorkbenchContextV1,
} from './workbench-context.ts'

/** Runtime-only ownership token for one asynchronous Area placement. */
export interface AreaClaimV1 {
  workbenchId: string
  areaId: string
  areaGeneration: number
  requestId: string
  moduleInstanceId?: string
  moduleFingerprint?: string
}

/** Why a previously reserved Area can no longer accept an async result. */
export type StalePlacementReason =
  | 'workbench-closed'
  | 'area-closed'
  | 'area-replaced'
  | 'request-superseded'

/** Atomic Conversation placement outcome returned to UI callers. */
export type PlacementResult =
  | { status: 'bound'; target: SessionBindingV1; reusedBlank: boolean }
  | { status: 'stale'; target?: SessionBindingV1; reason: StalePlacementReason }
  | { status: 'failed'; code: string; message: string }

export interface ConversationBindingOptionsV1 {
  /** Keep the current Start editor visible until the first submitted turn. */
  presentation?: 'start' | 'conversation'
  /** Exact Start occurrence whose Workspace picker initiated this binding. */
  startModuleInstanceId?: string
}

/**
 * Project-neutral Workbench state owner.
 *
 * Settings I/O is intentionally kept outside this deterministic core: the
 * React/Settings adapter persists snapshots and can replay the same document
 * mutations after a CAS conflict. Area generations and claims are page-local
 * and therefore can never leak into Settings.
 */
export class WorkbenchRepository {
  private settings: WorkbenchSettingsV4
  private readonly areaGenerations = new Map<string, number>()
  private readonly claimOwners = new Map<string, string>()
  private readonly listeners = new Set<() => void>()

  constructor(settings: WorkbenchSettingsV4) {
    this.settings = structuredClone(settings)
    for (const workbench of Object.values(this.settings.workbenches)) {
      for (const area of areasOf(workbench.document.root)) {
        this.areaGenerations.set(areaKey(workbench.workbenchId, area.areaId), 0)
      }
    }
  }

  /**
   * Read the current project-neutral Workbench state.
   * @returns the current immutable Settings snapshot.
   */
  getSnapshot(): WorkbenchSettingsV4 {
    return this.settings
  }

  /**
   * Read one named Workbench.
   * @param workbenchId - stable Workbench identifier.
   * @returns the Workbench record, or undefined when closed.
   */
  getWorkbench(workbenchId: string): WorkbenchRecordV2 | undefined {
    return this.settings.workbenches[workbenchId]
  }

  /** Read a Workbench Context without exposing the mutable Settings object. */
  getWorkbenchContext(workbenchId: string): WorkbenchContextV1 | undefined {
    const record = this.settings.workbenches[workbenchId]
    return record === undefined ? undefined : workbenchContextOf(record.context)
  }

  /** Read one Area Context, returning a safe default for legacy Areas. */
  getAreaContext(workbenchId: string, areaId: string): AreaContextV1 | undefined {
    const record = this.settings.workbenches[workbenchId]
    if (record === undefined || !areasOf(record.document.root).some(area => area.areaId === areaId)) return undefined
    return areaContextOf(record.areaContexts?.[areaId])
  }

  /** Apply a checked Workbench Context patch to the page-local repository. */
  patchWorkbenchContext(
    workbenchId: string,
    options: ContextPatchOptions<'human'> | ContextPatchOptions<'agent'>,
  ): ContextPatchResult<WorkbenchContextV1> {
    const record = this.settings.workbenches[workbenchId]
    if (record === undefined) return { status: 'rejected', reason: 'patch-invalid' }
    const source = workbenchContextOf(record.context)
    const result = options.section === 'human'
      ? patchWorkbenchContext(source, options)
      : patchWorkbenchContext(source, options)
    if (result.status !== 'committed') return result
    this.replaceRecord(workbenchId, { ...record, context: result.context })
    return result
  }

  /** Apply a checked Area Context patch to the page-local repository. */
  patchAreaContext(
    workbenchId: string,
    areaId: string,
    options: ContextPatchOptions<'human'> | ContextPatchOptions<'agent'>,
  ): ContextPatchResult<AreaContextV1> {
    const record = this.settings.workbenches[workbenchId]
    if (record === undefined || !areasOf(record.document.root).some(area => area.areaId === areaId)) {
      return { status: 'rejected', reason: 'patch-invalid' }
    }
    const current = areaContextOf(record.areaContexts?.[areaId])
    const result = options.section === 'human'
      ? patchAreaContext(current, options)
      : patchAreaContext(current, options)
    if (result.status !== 'committed') return result
    this.replaceRecord(workbenchId, {
      ...record,
      areaContexts: { ...(record.areaContexts ?? {}), [areaId]: result.context },
    })
    return result
  }

  /** Persist Area ownership metadata in the page-local repository. */
  setAreaMetadata(workbenchId: string, areaId: string, metadata: WorkbenchAreaMetadataV1): boolean {
    const record = this.settings.workbenches[workbenchId]
    if (record === undefined || !areasOf(record.document.root).some(area => area.areaId === areaId)) return false
    this.replaceRecord(workbenchId, { ...record, areaMetadata: { ...(record.areaMetadata ?? {}), [areaId]: structuredClone(metadata) } })
    return true
  }

  /**
   * Subscribe to repository snapshot changes.
   * @param listener - callback invoked after a committed mutation.
   * @returns an unsubscribe callback.
   */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /**
   * Activate one existing Workbench.
   * @param workbenchId - Workbench to activate.
   * @returns whether the Workbench exists.
   */
  activateWorkbench(workbenchId: string): boolean {
    if (this.settings.workbenches[workbenchId] === undefined) return false
    if (this.settings.activeWorkbenchId === workbenchId) return true
    this.settings = { ...this.settings, activeWorkbenchId: workbenchId }
    this.publish()
    return true
  }

  /**
   * Activate one Area without changing any Session binding.
   * @param workbenchId - owning Workbench.
   * @param areaId - Area to activate.
   * @returns whether the target Area exists.
   */
  activateArea(workbenchId: string, areaId: string): boolean {
    const workbench = this.settings.workbenches[workbenchId]
    if (workbench === undefined || !areasOf(workbench.document.root).some(area => area.areaId === areaId)) return false
    if (workbench.document.activeAreaId === areaId) return true
    this.replaceDocument(workbenchId, { ...workbench.document, activeAreaId: areaId }, false)
    return true
  }

  /**
   * Claim one Area; a later request for the same Area supersedes the owner.
   * @param workbenchId - owning Workbench.
   * @param areaId - destination Area.
   * @param requestId - asynchronous placement request identity.
   * @returns the runtime-only claim to validate at commit time.
   */
  claimArea(workbenchId: string, areaId: string, requestId: string): AreaClaimV1 {
    const workbench = this.settings.workbenches[workbenchId]
    if (workbench === undefined) throw new Error(`Unknown Workbench ${workbenchId}`)
    const area = areasOf(workbench.document.root).find(area => area.areaId === areaId)
    if (!area) {
      throw new Error(`Unknown Area ${areaId}`)
    }
    const module = area.moduleHistory.find(page => page.moduleInstanceId === area.activeModuleInstanceId)
    const key = areaKey(workbenchId, areaId)
    const areaGeneration = this.areaGenerations.get(key) ?? 0
    this.claimOwners.set(key + ':' + (module?.moduleInstanceId ?? ''), requestId)
    return { workbenchId, areaId, areaGeneration, requestId, ...(module ? { moduleInstanceId: module.moduleInstanceId, moduleFingerprint: moduleFingerprint(module) } : {}) }
  }

  /**
   * Validate a claim and replace that Area's active module with Conversation.
   * @param claim - runtime Area ownership token.
   * @param target - exact Workspace and Session identity.
   * @param reusedBlank - whether Host reused the Workspace's blank Session.
   * @returns the bound result or the precise stale reason.
   */
  bindConversation(
    claim: AreaClaimV1,
    target: SessionBindingV1,
    reusedBlank: boolean,
    options?: ConversationBindingOptionsV1,
  ): PlacementResult {
    const stale = this.validateClaim(claim)
    if (stale !== undefined) return { status: 'stale', reason: stale, target }
    const workbench = this.settings.workbenches[claim.workbenchId]
    /* v8 ignore next -- validateClaim already established the Workbench. */
    if (workbench === undefined) return { status: 'stale', reason: 'workbench-closed', target }
    const key = sessionTargetKey(target)
    const area = areasOf(workbench.document.root).find(row => row.areaId === claim.areaId)
    if (!area) return { status: 'stale', reason: 'area-closed', target }
    const current = area.moduleHistory.find(row => row.moduleInstanceId === claim.moduleInstanceId)
    const prepared = options?.presentation === 'start'
    if (prepared && (current?.editorId !== 'workbench.conversation.start' || current.moduleInstanceId !== options.startModuleInstanceId)) return { status: 'failed', code: 'start-editor-missing', message: '新建对话内页已变化，请重试。' }
    const existing = area.moduleHistory.find(row => row.binding?.sessionId === target.sessionId && row.editorId === 'workbench.conversation')
    const replaceStart = current?.editorId === 'workbench.conversation.start'
    const moduleInstanceId = replaceStart ? current.moduleInstanceId : existing?.moduleInstanceId ?? 'conversation-' + claim.requestId
    const state = replaceStart ? structuredClone(current.state) : {}
    const conversation: ModuleInstanceDocument = {
      moduleInstanceId, editorId: prepared ? 'workbench.conversation.start' : 'workbench.conversation',
      editorScope: prepared ? 'root' : 'session', binding: structuredClone(target), state,
      sessionStates: { [key]: structuredClone(state) }, sessionStateOrder: [key], bindingGeneration: (current?.bindingGeneration ?? 0) + 1,
      lastKnownTitle: prepared ? '新建对话' : '对话',
    }
    const { areaBinding: _legacy, ...unbound } = area
    const nextArea = { ...unbound, activeModuleInstanceId: moduleInstanceId,
      moduleHistory: area.moduleHistory.some(row => row.moduleInstanceId === moduleInstanceId)
        ? area.moduleHistory.map(row => row.moduleInstanceId === moduleInstanceId ? conversation : row)
        : [...area.moduleHistory, conversation] }
    const root = mapArea(workbench.document.root, claim.areaId, () => nextArea)
    const owned = areaKey(claim.workbenchId, claim.areaId)
    this.areaGenerations.set(owned, claim.areaGeneration + 1)
    this.claimOwners.delete(owned + ':' + (claim.moduleInstanceId ?? ''))
    this.replaceDocument(claim.workbenchId, { ...workbench.document, root, activeAreaId: claim.areaId }, false)
    return { status: 'bound', target, reusedBlank }
  }

  /** Convert a prepared Start module into Conversation without adding a tab. */
  activatePreparedConversation(
    workbenchId: string,
    areaId: string,
    target: SessionBindingV1,
    moduleInstanceId: string,
    bindingGeneration: number,
  ): boolean {
    const workbench = this.settings.workbenches[workbenchId]
    if (workbench === undefined) return false
    const area = areasOf(workbench.document.root).find(item => item.areaId === areaId)
    if (area === undefined) return false
    const module = area.moduleHistory.find(item => item.moduleInstanceId === moduleInstanceId)
    if (module === undefined || module.editorId !== 'workbench.conversation.start'
      || module.moduleInstanceId !== moduleInstanceId || module.editorScope !== 'root'
      || module.binding === undefined || !sameBinding(module.binding, target)
      || module.bindingGeneration !== bindingGeneration) return false
    const root = mapArea(workbench.document.root, areaId, row => ({
      ...row,
      activeModuleInstanceId: module.moduleInstanceId,
      moduleHistory: row.moduleHistory.map(candidate => candidate.moduleInstanceId === module.moduleInstanceId
        ? { ...candidate, editorId: 'workbench.conversation', editorScope: 'session' as const, lastKnownTitle: '对话' }
        : candidate),
    }))
    return this.replaceDocument(workbenchId, { ...workbench.document, root, activeAreaId: areaId }, false)
  }

  /**
   * Close one Area while preserving a valid split tree.
   * @param workbenchId - owning Workbench.
   * @param areaId - Area to remove.
   * @returns whether the Area was closed.
   */
  closeArea(workbenchId: string, areaId: string): boolean {
    const workbench = this.settings.workbenches[workbenchId]
    if (workbench === undefined) return false
    const root = removeArea(workbench.document.root, areaId)
    if (root === undefined || root === workbench.document.root) return false
    const remaining = areasOf(root)
    const activeAreaId = remaining.some(area => area.areaId === workbench.document.activeAreaId)
      ? workbench.document.activeAreaId
      : remaining[0]?.areaId
    /* v8 ignore next -- removing one child always leaves its split sibling. */
    if (activeAreaId === undefined) return false
    this.replaceDocument(workbenchId, { version: 3, root, activeAreaId }, false)
    return true
  }

  /**
   * Replace one Workbench document and reconcile runtime Area generations.
   * @param workbenchId - Workbench to update.
   * @param document - validated replacement document.
   * @param invalidateChangedAreas - whether changed Area fingerprints invalidate claims.
   * @returns whether the Workbench exists and was replaced.
   */
  replaceDocument(workbenchId: string, document: WorkbenchDocumentV3, invalidateChangedAreas = true): boolean {
    const workbench = this.settings.workbenches[workbenchId]
    if (workbench === undefined) return false
    const normalized = normalizeWorkbenchDocument(document)
    if (invalidateChangedAreas) this.reconcileAreaGenerations(workbenchId, workbench.document, normalized)
    this.replaceRecord(workbenchId, { ...workbench, document: normalized })
    return true
  }

  private replaceRecord(workbenchId: string, record: WorkbenchRecordV2): void {
    this.settings = {
      ...this.settings,
      workbenches: { ...this.settings.workbenches, [workbenchId]: { ...record, updatedAt: Date.now() } },
    }
    this.publish()
  }

  private validateClaim(claim: AreaClaimV1): StalePlacementReason | undefined {
    const workbench = this.settings.workbenches[claim.workbenchId]
    if (workbench === undefined) return 'workbench-closed'
    const area = areasOf(workbench.document.root).find(item => item.areaId === claim.areaId)
    if (area === undefined) return 'area-closed'
    const key = areaKey(claim.workbenchId, claim.areaId)
    if (claim.moduleInstanceId) {
      const module = area.moduleHistory.find(page => page.moduleInstanceId === claim.moduleInstanceId)
      if (!module || moduleFingerprint(module) !== claim.moduleFingerprint) return 'area-replaced'
    } else if ((this.areaGenerations.get(key) ?? 0) !== claim.areaGeneration) return 'area-replaced'
    if (this.claimOwners.get(key + ':' + (claim.moduleInstanceId ?? '')) !== claim.requestId) return 'request-superseded'
    return undefined
  }

  private reconcileAreaGenerations(
    workbenchId: string,
    previous: WorkbenchDocumentV3,
    next: WorkbenchDocumentV3,
  ): void {
    const oldAreas = new Map(areasOf(previous.root).map(area => [area.areaId, areaFingerprint(area)]))
    for (const area of areasOf(next.root)) {
      const key = areaKey(workbenchId, area.areaId)
      const before = oldAreas.get(area.areaId)
      if (before === undefined) this.areaGenerations.set(key, 0)
      else if (before !== areaFingerprint(area)) {
        this.areaGenerations.set(key, (this.areaGenerations.get(key) ?? 0) + 1)
      }
      oldAreas.delete(area.areaId)
    }
  }

  private publish(): void {
    for (const listener of this.listeners) listener()
  }
}

function areaKey(workbenchId: string, areaId: string): string {
  return `${workbenchId}\u0000${areaId}`
}

function sameBinding(left: SessionBindingV1, right: SessionBindingV1): boolean {
  return left.sessionId === right.sessionId && left.workspaceId === right.workspaceId
}

function areaFingerprint(area: AreaNode): string {
  return JSON.stringify([
    ...area.moduleHistory.map(module => [module.moduleInstanceId, module.editorId, module.pendingBinding, module.binding, module.bindingGeneration])])
}

function moduleFingerprint(module: ModuleInstanceDocument): string {
  return JSON.stringify([module.editorId, module.pendingBinding, module.binding, module.bindingGeneration])
}

function mapArea(
  node: WorkbenchNodeV3,
  areaId: string,
  map: (area: AreaNode) => AreaNode,
): WorkbenchNodeV3 {
  if (node.kind === 'area') return node.areaId === areaId ? map(node) : node
  return { ...node, first: mapArea(node.first, areaId, map), second: mapArea(node.second, areaId, map) }
}

function removeArea(node: WorkbenchNodeV3, areaId: string): WorkbenchNodeV3 | undefined {
  if (node.kind === 'area') return node.areaId === areaId ? undefined : node
  const first = removeArea(node.first, areaId)
  const second = removeArea(node.second, areaId)
  if (first === undefined) return second
  if (second === undefined) return first
  if (first === node.first && second === node.second) return node
  return { ...node, first, second }
}
