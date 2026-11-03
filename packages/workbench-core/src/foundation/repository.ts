import type { SessionBindingV1 } from './model.ts'
import { sessionTargetKey } from './model.ts'
import {
  areasOf, normalizeWorkbenchDocument, type AreaNode, type ModuleInstanceDocument,
  type WorkbenchDocumentV3, type WorkbenchNodeV3,
} from './document-v3.ts'
import type { WorkbenchRecordV2, WorkbenchSettingsV4 } from './persistence.ts'

/** Runtime-only ownership token for one asynchronous Area placement. */
export interface AreaClaimV1 {
  workbenchId: string
  areaId: string
  areaGeneration: number
  requestId: string
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
    if (!areasOf(workbench.document.root).some(area => area.areaId === areaId)) {
      throw new Error(`Unknown Area ${areaId}`)
    }
    const key = areaKey(workbenchId, areaId)
    const areaGeneration = this.areaGenerations.get(key) ?? 0
    this.claimOwners.set(key, requestId)
    return { workbenchId, areaId, areaGeneration, requestId }
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
    if (options?.presentation === 'start') {
      const area = areasOf(workbench.document.root).find(item => item.areaId === claim.areaId)
      if (area === undefined) return { status: 'stale', reason: 'area-closed', target }
      if (area.moduleHistory.some(module => module.moduleInstanceId !== options.startModuleInstanceId
        && module.binding !== undefined && !sameBinding(module.binding, target))) {
        return { status: 'failed', code: 'area-already-bound', message: '当前 Area 已绑定其他对话' }
      }
      const start = area.moduleHistory.find(module => module.moduleInstanceId === area.activeModuleInstanceId)
      if (start === undefined || start.editorId !== 'workbench.conversation.start'
        || start.editorScope !== 'root' || start.moduleInstanceId !== options.startModuleInstanceId) {
        return { status: 'failed', code: 'start-editor-missing', message: '当前 Area 没有可用的新建对话内页' }
      }
      const root = mapArea(workbench.document.root, claim.areaId, row => ({
        ...row,
        areaBinding: structuredClone(target),
        areaBindingGeneration: (row.areaBindingGeneration ?? 0) + 1,
        moduleHistory: row.moduleHistory.map(module => {
          if (module.moduleInstanceId === start!.moduleInstanceId) {
            const state = structuredClone(module.state)
            return {
              ...module,
              // Keep the exact native Session on this root Start until DSH
              // confirms that its first prompt was accepted. This lets Core
              // restore the same native Composer after the Workbench reopens.
              editorScope: 'root' as const,
              binding: structuredClone(target),
              state,
              sessionStates: { ...(module.sessionStates ?? {}), [key]: structuredClone(state) },
              sessionStateOrder: [...(module.sessionStateOrder ?? []).filter(item => item !== key), key],
              bindingGeneration: (module.bindingGeneration ?? 0) + 1,
            }
          }
          if (module.editorScope !== 'session' || module.pendingBinding === undefined) return module
          const { pendingBinding: _pending, ...bound } = module
          const state = structuredClone(module.state)
          return {
            ...bound,
            binding: structuredClone(target),
            state,
            sessionStates: { ...(module.sessionStates ?? {}), [key]: structuredClone(state) },
            sessionStateOrder: [...(module.sessionStateOrder ?? []).filter(item => item !== key), key],
            bindingGeneration: (module.bindingGeneration ?? 0) + 1,
          }
        }),
      }))
      const areaKeyValue = areaKey(claim.workbenchId, claim.areaId)
      this.areaGenerations.set(areaKeyValue, claim.areaGeneration + 1)
      this.claimOwners.delete(areaKeyValue)
      this.replaceDocument(claim.workbenchId, { ...workbench.document, root, activeAreaId: claim.areaId }, false)
      return { status: 'bound', target, reusedBlank }
    }
    const pending = areasOf(workbench.document.root).find(area => area.areaId === claim.areaId)?.moduleHistory.find(module => module.pendingBinding !== undefined)?.pendingBinding
    if (pending !== undefined) {
      let root = workbench.document.root
      for (const area of areasOf(root)) {
        if (!area.moduleHistory.some(module => module.pendingBinding === pending)) continue
        root = mapArea(root, area.areaId, row => ({ ...row, areaBinding: structuredClone(target), areaBindingGeneration: (row.areaBindingGeneration ?? 0) + 1,
          moduleHistory: row.moduleHistory.map(module => {
            if (module.editorScope !== 'session') return module
            const { pendingBinding: _pending, ...bound } = module
            return { ...bound, binding: structuredClone(target), state: structuredClone(module.state),
              sessionStates: { ...(module.sessionStates ?? {}), [key]: structuredClone(module.state) },
              sessionStateOrder: [...(module.sessionStateOrder ?? []).filter(item => item !== key), key],
              bindingGeneration: (module.bindingGeneration ?? 0) + 1 }
          }),
        }))
        const owned = areaKey(claim.workbenchId, area.areaId)
        this.areaGenerations.set(owned, (this.areaGenerations.get(owned) ?? 0) + 1)
        this.claimOwners.delete(owned)
      }
      this.replaceDocument(claim.workbenchId, { ...workbench.document, root, activeAreaId: claim.areaId }, false)
      return { status: 'bound', target, reusedBlank }
    }
    const root = mapArea(workbench.document.root, claim.areaId, (area) => {
      const activeIndex = area.moduleHistory.findIndex(
        module => module.moduleInstanceId === area.activeModuleInstanceId,
      )
      const current = activeIndex < 0 ? undefined : area.moduleHistory[activeIndex]
      const existing = area.moduleHistory.find(module => module.editorId === 'workbench.conversation' && module.editorScope === 'session')
      // Selecting a Workspace from a Start editor is a replacement operation.
      // Keep the occurrence identity so React and the persisted layout do not
      // briefly expose two tabs for the same Area.  A second Conversation may
      // still be opened deliberately through the `+` command, which creates a
      // distinct Area/module occurrence before this path is reached.
      const replaceStart = current?.editorId === 'workbench.conversation.start'
        && current.editorScope === 'root'
      const moduleInstanceId = replaceStart
        ? current.moduleInstanceId
        : existing?.moduleInstanceId ?? `conversation-${claim.requestId}`
      const draft = current?.editorId === 'workbench.conversation.start'
        && typeof current.state === 'object' && current.state !== null && !Array.isArray(current.state)
        && typeof current.state.draft === 'string' ? current.state.draft : ''
      const state = draft === '' ? {} : { workbenchConversationDraft: draft }
      const conversation: ModuleInstanceDocument = {
        moduleInstanceId,
        editorId: 'workbench.conversation',
        editorScope: 'session',
        binding: structuredClone(target),
        state,
        sessionStates: { [key]: structuredClone(state) },
        sessionStateOrder: [key],
        bindingGeneration: (existing?.bindingGeneration ?? 0) + 1,
        lastKnownTitle: '对话',
      }
      const history = replaceStart
        ? area.moduleHistory.map(module => module.moduleInstanceId === current!.moduleInstanceId ? conversation : module)
        : area.moduleHistory.some(module => module.editorId === 'workbench.conversation')
          ? area.moduleHistory.map(module => module.editorId === 'workbench.conversation' ? conversation : module)
          : [...area.moduleHistory, conversation]
      return { ...area, areaBinding: structuredClone(target), areaBindingGeneration: (area.areaBindingGeneration ?? 0) + 1,
        activeModuleInstanceId: moduleInstanceId, moduleHistory: history.map(module => {
          if (module.editorScope !== 'session' || module === conversation) return module
          const { pendingBinding: _pending, ...rest } = module
          const oldKey = module.binding === undefined ? undefined : sessionTargetKey(module.binding)
          const sessionStates = { ...(module.sessionStates ?? {}), ...(oldKey === undefined ? {} : { [oldKey]: structuredClone(module.state) }) }
          const state = structuredClone(sessionStates[key] ?? {})
          return { ...rest, binding: structuredClone(target), state, sessionStates: { ...sessionStates, [key]: state },
            sessionStateOrder: [...new Set([...(module.sessionStateOrder ?? []), ...(oldKey === undefined ? [] : [oldKey]), key])],
            bindingGeneration: (module.bindingGeneration ?? 0) + 1 }
        }) }
    })
    const areaKeyValue = areaKey(claim.workbenchId, claim.areaId)
    this.areaGenerations.set(areaKeyValue, claim.areaGeneration + 1)
    this.claimOwners.delete(areaKeyValue)
    this.replaceDocument(claim.workbenchId, {
      ...workbench.document, root, activeAreaId: claim.areaId,
    }, false)
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
    if (area === undefined || area.areaBinding === undefined || !sameBinding(area.areaBinding, target)) return false
    const module = area.moduleHistory.find(item => item.moduleInstanceId === area.activeModuleInstanceId)
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

  bindAreaSession(workbenchId: string, areaId: string, binding: SessionBindingV1, claim: AreaClaimV1): boolean {
    const stale = this.validateClaim(claim)
    if (stale !== undefined || claim.workbenchId !== workbenchId || claim.areaId !== areaId) return false
    const record = this.settings.workbenches[workbenchId]
    const area = record === undefined ? undefined : areasOf(record.document.root).find(item => item.areaId === areaId)
    if (area === undefined || area.areaBinding !== undefined) return false
    return this.applyAreaBinding(workbenchId, areaId, binding, claim)
  }

  retargetAreaSession(workbenchId: string, areaId: string, binding: SessionBindingV1, claim: AreaClaimV1): boolean {
    const stale = this.validateClaim(claim)
    if (stale !== undefined || claim.workbenchId !== workbenchId || claim.areaId !== areaId) return false
    return this.applyAreaBinding(workbenchId, areaId, binding, claim)
  }

  private applyAreaBinding(workbenchId: string, areaId: string, binding: SessionBindingV1, claim: AreaClaimV1): boolean {
    const record = this.settings.workbenches[workbenchId]
    if (record === undefined) return false
    const key = sessionTargetKey(binding)
    const root = mapArea(record.document.root, areaId, area => ({
      ...area, areaBinding: structuredClone(binding), areaBindingGeneration: (area.areaBindingGeneration ?? 0) + 1,
      moduleHistory: area.moduleHistory.map(module => module.editorScope === 'session' ? {
        ...module, binding: structuredClone(binding), state: structuredClone(module.sessionStates?.[key] ?? module.state),
        sessionStates: { ...(module.sessionStates ?? {}), [key]: structuredClone(module.state) }, sessionStateOrder: [...(module.sessionStateOrder ?? []).filter(item => item !== key), key], bindingGeneration: (module.bindingGeneration ?? 0) + 1,
      } : module),
    }))
    const areaKeyValue = areaKey(workbenchId, areaId)
    this.areaGenerations.set(areaKeyValue, claim.areaGeneration + 1)
    this.claimOwners.delete(areaKeyValue)
    return this.replaceDocument(workbenchId, { ...record.document, root, activeAreaId: areaId }, false)
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
    const updated: WorkbenchRecordV2 = {
      ...workbench, document: normalized, updatedAt: Date.now(),
    }
    this.settings = {
      ...this.settings,
      workbenches: { ...this.settings.workbenches, [workbenchId]: updated },
    }
    this.publish()
    return true
  }

  private validateClaim(claim: AreaClaimV1): StalePlacementReason | undefined {
    const workbench = this.settings.workbenches[claim.workbenchId]
    if (workbench === undefined) return 'workbench-closed'
    const area = areasOf(workbench.document.root).find(item => item.areaId === claim.areaId)
    if (area === undefined) return 'area-closed'
    const key = areaKey(claim.workbenchId, claim.areaId)
    if ((this.areaGenerations.get(key) ?? 0) !== claim.areaGeneration) return 'area-replaced'
    if (this.claimOwners.get(key) !== claim.requestId) return 'request-superseded'
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
  return JSON.stringify([area.areaBinding, area.areaBindingGeneration, area.activeModuleInstanceId,
    ...area.moduleHistory.map(module => [module.moduleInstanceId, module.editorId, module.pendingBinding, module.binding, module.bindingGeneration])])
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
