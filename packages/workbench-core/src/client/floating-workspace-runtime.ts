import type { ReactNode } from 'react'
import type { TabDocument, SessionBindingV1, JsonValue } from '../foundation/model.ts'
import type { WorkbenchConversationInteractionPolicyV1 } from '../workbench-interaction-policy.ts'
import { decodeFloatingHandoff, type FloatingHandoffV1 } from '../floating-handoff.ts'

export interface FloatingRect { x: number; y: number; width: number; height: number }
export interface FloatingGeometry { rect?: FloatingRect; launcher?: { x: number; y: number } }
export const floatingInstanceKey = (workbenchId: string, instanceId: string) => JSON.stringify([workbenchId, instanceId])
export type EditorCloseGuard = () => boolean | Promise<boolean>
export interface FloatingInstance {
  workbenchId: string
  tab: TabDocument
  location: 'floating' | 'area'
  unread: boolean
  busy: boolean
  generation: number
  pendingState?: boolean
  element?: HTMLDivElement
  render?: ReactNode
  target?: HTMLElement | undefined
}
export interface FloatingWorkspaceState extends FloatingGeometry { expanded: boolean; maximized: boolean; activeId?: string | undefined; error?: string | undefined }
export interface FloatingWorkspaceRuntime {
  subscribeContent(listener: () => void): () => void
  getContentSnapshot(): number
  route?: (input: { workbenchId: string; kind: string; options?: Record<string, unknown>; binding?: SessionBindingV1; sourceId?: string }) => boolean
  subscribe(listener: () => void): () => void
  getSnapshot(): number
  invalidate(): void
  instances: Map<string, FloatingInstance>
  find(id: string, workbenchId?: string): FloatingInstance | undefined
  workspace(id: string): FloatingWorkspaceState
  patch(id: string, patch: Partial<FloatingWorkspaceState>, persist?: boolean): void
  open(workbenchId: string, tab: TabDocument, automatic?: boolean, reveal?: boolean): string
  retain(workbenchId: string, tab: TabDocument): void
  update(id: string, tab: TabDocument, workbenchId?: string): void
  updateState(id: string, state: JsonValue, workbenchId: string): void
  prepareConversation(id: string, workbenchId: string, create: () => Promise<SessionBindingV1>): Promise<SessionBindingV1>
  present(id: string, render: ReactNode, target?: HTMLElement, workbenchId?: string): void
  detach(id: string, target: HTMLElement, workbenchId?: string): void
  close(id: string, workbenchId?: string): Promise<boolean>
  guardWorkbench(id: string): Promise<boolean>
  guardClientExit(): Promise<boolean>
  disposeWorkbench(id: string): void
  registerCloseGuard(id: string, guard: EditorCloseGuard, workbenchId?: string): () => void
  transfer(id: string, commit: (tab: TabDocument) => Promise<boolean>, workbenchId?: string): Promise<boolean>
  setCleanup(handler: (id: string) => void): void
  configureGeometry(load: () => Record<string, FloatingGeometry>, save: (id: string, value: FloatingGeometry) => void): void
  enabled: boolean
  visibleWorkbenchId?: string | undefined
  epoch: number
  parking?: HTMLElement | undefined
  routes: Map<string, NonNullable<FloatingWorkspaceRuntime['route']>>
  pendingAreaRoutes: Map<string, Parameters<NonNullable<FloatingWorkspaceRuntime['route']>>[0]>
  canUseEditor?: (workbenchId: string, editorId: string) => boolean
  hasControl?: (workbenchId: string) => boolean
  validBinding?: (binding: SessionBindingV1) => boolean
  policy?: () => WorkbenchConversationInteractionPolicyV1 | undefined
  setSurface(enabled: boolean, workbenchId?: string): void
  authorizeClose(id: string, workbenchId?: string): Promise<boolean>
  forget(id: string, workbenchId?: string): void
  hasGuard(id: string, workbenchId?: string): boolean
  focusedBinding?: SessionBindingV1 | undefined
  focusedWorkbenchId?: string | undefined
  seenAutomatic: Set<string>
  snapshotHandoff(workbenchId: string): FloatingHandoffV1
  restoreHandoff(workbenchId: string, snapshot: unknown): void
}

export function clampFloatingRect(rect: FloatingRect, width: number, height: number): FloatingRect {
  const w = Math.max(1, Math.min(width, Math.max(Math.min(360, width), rect.width)))
  const h = Math.max(1, Math.min(height, Math.max(Math.min(240, height), rect.height)))
  return { x: Math.max(0, Math.min(width - w, rect.x)), y: Math.max(0, Math.min(height - h, rect.y)), width: w, height: h }
}
export function defaultFloatingRect(width: number, height: number): FloatingRect {
  return clampFloatingRect({ x: Math.max(0, (width - 720) / 2), y: Math.max(0, (height - 480) / 2), width: 720, height: 480 }, width, height)
}

/** Client-lifetime state; only geometry crosses the persistence boundary. */
export function createFloatingWorkspaceRuntime(): FloatingWorkspaceRuntime {
  const instances = new Map<string, FloatingInstance>()
  const spaces = new Map<string, FloatingWorkspaceState>()
  const guards = new Map<string, EditorCloseGuard>()
  const listeners = new Set<() => void>()
  const contentListeners = new Set<() => void>()
  let contentRevision = 0
  const publishContent = () => { contentRevision++; for (const listener of [...contentListeners]) listener() }
  let revision = 0
  let cleanup = (_id: string) => {}
  let load = (): Record<string, FloatingGeometry> => ({})
  let save = (_id: string, _value: FloatingGeometry) => {}
  const publish = () => { revision++; for (const listener of [...listeners]) listener() }
  const workspace = (id: string) => {
    let value = spaces.get(id)
    if (!value) { value = { ...load()[id], expanded: false, maximized: false }; spaces.set(id, value) }
    return value
  }
  const find = (id: string, workbenchId?: string) => {
    if (workbenchId) return instances.get(floatingInstanceKey(workbenchId, id))
    const matches = [...instances.values()].filter(row => row.tab.id === id)
    return matches.length === 1 ? matches[0] : undefined
  }
  const keyOf = (item: FloatingInstance) => floatingInstanceKey(item.workbenchId, item.tab.id)
  const permitted = async (id: string, workbenchId?: string) => { try { const item = find(id, workbenchId); return item ? await guards.get(keyOf(item))?.() ?? true : true } catch { return false } }
  const remove = (id: string, workbenchId?: string) => {
    const item = find(id, workbenchId)
    if (!item) return
    cleanup(keyOf(item)); item.element?.remove(); instances.delete(keyOf(item)); guards.delete(keyOf(item)); publishContent()
    const space = workspace(item.workbenchId)
    if (space.activeId === id) space.activeId = [...instances.values()].find(row => row.workbenchId === item.workbenchId && row.location === 'floating')?.tab.id
  }
  const runtime: FloatingWorkspaceRuntime = {
    instances, find, enabled: false, epoch: 0, routes: new Map(), pendingAreaRoutes: new Map(), seenAutomatic: new Set(),
    route(input) {
      if (!runtime.enabled) return false
      if (input.options?.sourceEpoch !== undefined && input.options.sourceEpoch !== runtime.epoch) return false
      const source = input.sourceId ? find(input.sourceId, input.workbenchId) : undefined
      if (input.sourceId && !source || runtime.hasControl?.(input.workbenchId) === false) return false
      if (input.binding && runtime.validBinding?.(input.binding) === false) return false
      if (source && (source.busy || source.workbenchId !== input.workbenchId || source.tab.sessionId !== input.binding?.sessionId
        || source.tab.binding?.workspaceId !== input.binding?.workspaceId
        || input.options?.sourceGeneration !== undefined && input.options.sourceGeneration !== (source.tab.bindingGeneration ?? 0)
        || input.options?.sourceLocationGeneration !== undefined && input.options.sourceLocationGeneration !== source.generation)) return false
      if (input.options?.trigger === 'automatic' && input.options.floating !== true && (runtime.visibleWorkbenchId !== input.workbenchId
        || runtime.focusedWorkbenchId !== input.workbenchId || runtime.focusedBinding?.sessionId !== input.binding?.sessionId)) {
        const key = JSON.stringify([input.workbenchId, input.binding?.sessionId, input.kind, input.options.resourceAddress, input.options.eventId])
        runtime.pendingAreaRoutes.set(key, input)
        if (source) source.unread = true
        publish(); return true
      }
      return runtime.routes.get(input.workbenchId)?.(input) ?? false
    },
    setSurface(enabled, workbenchId) {
      if (runtime.enabled === enabled && runtime.visibleWorkbenchId === workbenchId) return
      if (runtime.enabled !== enabled) { runtime.epoch++; runtime.pendingAreaRoutes.clear() }
      runtime.enabled = enabled; runtime.visibleWorkbenchId = workbenchId
      publish()
    },
    authorizeClose: permitted,
    hasGuard: (id, workbenchId) => { const item = find(id, workbenchId); return !!item && guards.has(keyOf(item)) },
    forget(id, workbenchId) { remove(id, workbenchId); publish() },
    subscribeContent: listener => { contentListeners.add(listener); return () => { contentListeners.delete(listener) } },
    getContentSnapshot: () => contentRevision,
    subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener) } },
    getSnapshot: () => revision, workspace,
    invalidate: publish,
    snapshotHandoff(workbenchId) {
      const rows = [...instances.values()].filter(row => row.workbenchId === workbenchId)
      if (rows.some(row => row.busy)) throw new Error('临时内页正在操作，请稍后交接。')
      const space = workspace(workbenchId)
      const tabs = rows.filter(row => row.location === 'floating').map(row => row.tab)
      const value = decodeFloatingHandoff({ version: 1, tabs, expanded: space.expanded,
        ...(tabs.some(tab => tab.id === space.activeId) ? { activeId: space.activeId } : {}),
        pinnedIds: rows.filter(row => row.location === 'area').map(row => row.tab.id) })
      if (!value) throw new Error('临时内页超过交接容量或包含无法恢复的状态，请先固定到区域。')
      return value
    },
    restoreHandoff(workbenchId, snapshot) {
      const value = decodeFloatingHandoff(snapshot)
      if (!value) throw new Error('浮动工作区交接数据无效，原内容仍保留。')
      const rows = [...instances.values()].filter(row => row.workbenchId === workbenchId)
      if (rows.some(row => row.busy)) throw new Error('临时内页正在操作，暂时无法接收交接。')
      // Validate every identity before changing anything. Never reuse a native
      // occurrence for a different editor or conversation supplied by a receipt.
      for (const tab of value.tabs) {
        const row = find(tab.id, workbenchId)
        const promoted = row?.tab.editorId === 'workbench.conversation.start' && tab.editorId === 'workbench.conversation'
        const rebound = row && (row.tab.sessionId !== tab.sessionId || row.tab.binding?.workspaceId !== tab.binding?.workspaceId)
        if (row && ((!promoted && (row.tab.editorId !== tab.editorId || row.tab.editorScope !== tab.editorScope))
          || rebound && (tab.bindingGeneration ?? 0) <= (row.tab.bindingGeneration ?? 0))) {
          throw new Error('临时标签的来源身份已改变，交接未应用，原内容仍保留。')
        }
      }
      const incoming = new Set(value.tabs.map(tab => tab.id))
      for (const row of rows) if (row.location === 'floating' && !incoming.has(row.tab.id)) {
        if (value.pinnedIds.includes(row.tab.id)) { row.location = 'area'; row.generation++ }
        else remove(row.tab.id, workbenchId)
      }
      for (const tab of value.tabs) {
        const row = find(tab.id, workbenchId)
        if (row) { row.tab = tab; row.location = 'floating'; row.pendingState = false; row.generation++ }
        else instances.set(floatingInstanceKey(workbenchId, tab.id), { workbenchId, tab, location: 'floating', unread: false, busy: false, generation: 0 })
      }
      // Map iteration defines the tab order. Retain other workbenches in place.
      for (const tab of value.tabs) {
        const key = floatingInstanceKey(workbenchId, tab.id), row = instances.get(key)!
        instances.delete(key); instances.set(key, row)
      }
      Object.assign(workspace(workbenchId), { activeId: value.activeId, expanded: value.expanded })
      publish()
    },
    configureGeometry: (read, write) => { load = read; save = write },
    setCleanup: handler => { cleanup = handler },
    patch(id, patch, persist = false) {
      Object.assign(workspace(id), patch)
      if (persist) { const { rect, launcher } = workspace(id); save(id, { ...(rect ? { rect } : {}), ...(launcher ? { launcher } : {}) }) }
      publish()
    },
    open(workbenchId, tab, automatic = false, reveal = true) {
      const key = floatingInstanceKey(workbenchId, tab.id)
      if (!instances.has(key)) instances.set(key, { workbenchId, tab, location: 'floating', unread: automatic, busy: false, generation: 0 })
      else { const row = instances.get(key)!; if (row.busy) return tab.id; row.tab = tab; row.unread = automatic }
      if (reveal) { Object.assign(workspace(workbenchId), { activeId: tab.id, expanded: true }); instances.get(key)!.unread = false }
      publish(); return tab.id
    },
    retain(workbenchId, tab) {
      const item = find(tab.id, workbenchId)
      if (!item) instances.set(floatingInstanceKey(workbenchId, tab.id), { workbenchId, tab, location: 'area', unread: false, busy: false, generation: 0 })
      else if (item.location === 'area') {
        const sameBinding = item.tab.editorId === tab.editorId && item.tab.sessionId === tab.sessionId && item.tab.bindingGeneration === tab.bindingGeneration
        if (item.pendingState && sameBinding) item.tab = { ...tab, state: item.tab.state }
        else { item.tab = tab; item.pendingState = false }
      }
    },
    // Async editor state may arrive while a close guard or CAS is pending.
    // Preserve it even though interactive navigation/close is locked.
    update(id, tab, workbenchId) { const item = find(id, workbenchId); if (!item || item.tab === tab || tab.id !== id) return; item.tab = tab; publish() },
    updateState(id, state, workbenchId) {
      const item = find(id, workbenchId); if (!item || item.tab.state === state) return
      item.tab = { ...item.tab, state }; item.pendingState = item.location === 'area'; publish()
    },
    async prepareConversation(id, workbenchId, create) {
      const item = find(id, workbenchId)
      const epoch = runtime.epoch, generation = item?.tab.bindingGeneration ?? 0, locationGeneration = item?.generation
      const current = () => !!item && runtime.enabled && runtime.epoch === epoch && runtime.visibleWorkbenchId === workbenchId
        && find(id, workbenchId) === item && item.generation === locationGeneration
        && (item.tab.bindingGeneration ?? 0) === generation
        && runtime.hasControl?.(workbenchId) !== false && runtime.canUseEditor?.(workbenchId, item.tab.editorId) !== false
      if (!item || item.busy || !current()) throw new Error('当前无法准备新对话。')
      item.busy = true; publish()
      try {
        const binding = await create()
        if (!current() || runtime.validBinding?.(binding) === false) throw new Error('来源工作台或绑定已改变，请重新打开内页。')
        const { pendingBinding: _pending, ...tab } = item.tab
        item.tab = { ...tab, sessionId: binding.sessionId, binding, bindingGeneration: generation + 1 }
        return binding
      } finally { item.busy = false; publish() }
    },
    present(id, render, target, workbenchId) {
      const item = find(id, workbenchId); if (!item) return
      item.element ??= Object.assign(document.createElement('div'), { className: 'workbench-retained-instance' })
      Object.assign(item.element.style, { width: '100%', height: '100%', minHeight: '0', overflow: 'hidden' })
      item.render = render
      if (target) {
        item.target = target
        if (item.element.parentElement !== target) {
          const parent = target as HTMLElement & { moveBefore?: (node: Node, child: Node | null) => void }
          if (parent.moveBefore && item.element.isConnected && target.isConnected) parent.moveBefore(item.element, null)
          else target.appendChild(item.element)
        }
      }
      publishContent()
    },
    detach(id, target, workbenchId) {
      const item = find(id, workbenchId); if (item?.target !== target) return
      item.target = undefined
      if (item.element && runtime.parking) {
        const parking = runtime.parking as HTMLElement & { moveBefore?: (node: Node, child: Node | null) => void }
        if (parking.moveBefore && item.element.isConnected && parking.isConnected) parking.moveBefore(item.element, null)
        else parking.appendChild(item.element)
      } else item.element?.remove()
      queueMicrotask(publish)
    },
    async close(id, workbenchId) {
      const item = find(id, workbenchId); if (!item || item.busy || runtime.hasControl?.(item.workbenchId) === false) return false
      const before = item.tab
      item.busy = true; publish()
      try { if (!await permitted(id, workbenchId) || find(id, workbenchId) !== item || item.tab !== before || runtime.hasControl?.(item.workbenchId) === false) return false; remove(id, workbenchId); return true }
      finally { item.busy = false; publish() }
    },
    async guardWorkbench(id) {
      const owned = [...instances.values()].filter(item => item.workbenchId === id)
      const snapshot = owned.map(item => ({ item, tab: item.tab }))
      for (const item of owned) if (item.busy || !await permitted(item.tab.id, id)) return false
      return snapshot.every(({ item, tab }) => find(tab.id, id) === item && item.tab === tab)
        && [...instances.values()].filter(item => item.workbenchId === id).length === owned.length
    },
    async guardClientExit() {
      const snapshot = [...instances.values()].map(item => ({ item, tab: item.tab }))
      for (const { item } of snapshot) if (item.busy || !await permitted(item.tab.id, item.workbenchId)) return false
      return instances.size === snapshot.length && snapshot.every(({ item, tab }) => find(tab.id, item.workbenchId) === item && item.tab === tab)
    },
    disposeWorkbench(id) {
      for (const item of [...instances.values()]) if (item.workbenchId === id) remove(item.tab.id, id)
      for (const [key, input] of runtime.pendingAreaRoutes) if (input.workbenchId === id) runtime.pendingAreaRoutes.delete(key)
      spaces.delete(id); runtime.routes.delete(id); publish()
    },
    registerCloseGuard(id, guard, workbenchId) { const item = find(id, workbenchId); if (!item) return () => {}; const key = keyOf(item); guards.set(key, guard); return () => { if (guards.get(key) === guard) guards.delete(key) } },
    async transfer(id, commit, workbenchId) {
      const item = find(id, workbenchId); if (!item || item.busy || item.location !== 'floating') return false
      item.busy = true; publish()
      try {
        if (runtime.hasControl?.(item.workbenchId) === false || !await commit(item.tab)) return false
        item.location = 'area'; item.generation++; item.unread = false
        const space = workspace(item.workbenchId)
        if (space.activeId === id) space.activeId = [...instances.values()].find(row => row.workbenchId === item.workbenchId && row.location === 'floating')?.tab.id
        return true
      } finally { item.busy = false; publish() }
    },
  }
  return runtime
}
