/** JSON-safe editor state. */
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }

/** Exact conversation identity retained by every session-scoped editor instance. */
export interface SessionBindingV1 {
  workspaceId?: string
  sessionId: string
  /** Local marker used by detached Workbench package imports. */
  detached?: boolean
}

/** Persisted v2 recursive layout for one Workspace Account. */
export interface WorkbenchLayoutDocument {
  version: 2
  root: LayoutNode
  activeGroupId: string
}

/** A split or stable editor-area node in a Workbench layout tree. */
export type LayoutNode = SplitNode | GroupNode

/** A two-child horizontal or vertical layout split. */
export interface SplitNode {
  kind: 'split'
  id: string
  axis: 'horizontal' | 'vertical'
  ratio: number
  first: LayoutNode
  second: LayoutNode
}

/** A stable leaf area whose legacy `tabs` array is kept for wire compatibility.
 *
 * Only `activeTabId` is presented at once. New Workbench V4 durable projections
 * collapse the array to the current tab; the persisted shape retains the
 * original `group`/`tabs` names so V1/V2 layouts remain readable.
 */
export interface GroupNode {
  kind: 'group'
  id: string
  activeTabId?: string
  tabs: TabDocument[]
  areaBinding?: SessionBindingV1
  areaBindingGeneration?: number
}

/** Reorder tabs within one Area while keeping the active instance stable. */
export function reorderTab(document: WorkbenchLayoutDocument, groupId: string, tabId: string, index: number): WorkbenchLayoutDocument {
  const target = groupsOf(document.root).find(item => item.id === groupId)
  if (target === undefined || !target.tabs.some(tab => tab.id === tabId)) return document
  const from = target.tabs.findIndex(tab => tab.id === tabId)
  const tabs = target.tabs.filter(tab => tab.id !== tabId)
  const at = Math.max(0, Math.min(index, tabs.length))
  tabs.splice(at, 0, target.tabs[from]!)
  if (tabs.every((tab, position) => tab === target.tabs[position])) return activate(document, groupId, tabId)
  return { ...document, activeGroupId: groupId, root: mapNode(document.root, groupId, node => ({ ...(node as GroupNode), tabs,
    ...(target.activeTabId === undefined ? {} : { activeTabId: target.activeTabId }) })) }
}

/** One persisted editor instance and its JSON-safe state. */
export interface TabDocument {
  id: string
  editorId: string
  editorScope: 'root' | 'session'
  sessionId?: string
  /** Precise binding for v2-aware commands; legacy documents are migrated lazily. */
  binding?: SessionBindingV1
  /** Anonymous recipient binding group. Never sent to Session services. */
  pendingBinding?: string
  pendingDistribution?: string
  /** Per-target editor states owned by this stable module instance. */
  sessionStates?: Record<string, JsonValue>
  /** Least-recently-used to most-recently-used target keys. */
  sessionStateOrder?: string[]
  /** Rejects state publications captured before a rebind. */
  bindingGeneration?: number
  lastKnownTitle: string
  state: JsonValue
}

/** Pointer-drop target relative to an existing group. */
export type DropEdge = 'center' | 'top' | 'right' | 'bottom' | 'left'

/** Per-tab persisted editor-state budget. */
export const MAX_EDITOR_STATE_BYTES = 256 * 1024

/** Editors owned by the stable outer shell and therefore forbidden in an Area. */
export const OUTER_SHELL_EDITOR_IDS = new Set(['dsh.workspace-browser', 'dsh.settings'])

/** Editors removed from the Workbench product surface but still found in old layouts. */
export const REMOVED_WORKBENCH_EDITOR_IDS = new Set(['dsh.tool-details'])
export const WORKBENCH_CONVERSATION_START_EDITOR = 'workbench.conversation.start'
export const WORKBENCH_CONVERSATION_EDITOR = 'workbench.conversation'
export const WORKBENCH_TRAJECTORY_EDITOR = 'workbench.agent-trajectory'
export function canonicalWorkbenchEditorId(editorId: string): string {
  switch (editorId) {
    case 'dsh.conversation-launcher':
    case 'dsh.conversation-start': return WORKBENCH_CONVERSATION_START_EDITOR
    case 'dsh.conversation': return WORKBENCH_CONVERSATION_EDITOR
    case 'dsh.agent-trajectory': return WORKBENCH_TRAJECTORY_EDITOR
    default: return editorId
  }
}

/** Deterministic layout edits retained while a Host write is unconfirmed. */
export type LayoutCommand =
  | { type: 'replace-layout'; document: WorkbenchLayoutDocument }
  | { type: 'activate'; groupId: string; tabId: string }
  | { type: 'add-tab'; groupId: string; tab: TabDocument }
  | { type: 'close-tab'; tabId: string }
  | { type: 'move-tab'; tabId: string; targetGroupId: string; edge: DropEdge; ids: { groupId: string; splitId: string }; index?: number; ratio?: number }
  | { type: 'duplicate-tab'; tabId: string; newTabId: string; targetGroupId: string; edge: DropEdge; ids: { groupId: string; splitId: string }; index?: number; ratio?: number }
  | { type: 'merge-group'; sourceGroupId: string; targetGroupId: string }
  | { type: 'swap-groups'; firstGroupId: string; secondGroupId: string }
  | { type: 'set-ratio'; splitId: string; ratio: number }
  | { type: 'update-tab-state'; tabId: string; state: JsonValue; bindingGeneration?: number }
  | { type: 'retarget-session'; tabId: string; sessionId: string; binding?: never }
  | { type: 'retarget-session'; tabId: string; binding: SessionBindingV1; sessionId?: never }
  /** Replace the current page instance while keeping its stable tab identity. */
  | { type: 'replace-tab'; tabId: string; tab: TabDocument }
  | { type: 'replace-editor'; tabId: string; editorId: string; lastKnownTitle: string }

/** Keep persisted and interactive ratios finite before they reach CSS Grid. */
const clampRatio = (ratio: number): number => Number.isFinite(ratio)
  ? Math.min(1, Math.max(0, ratio))
  : 0.5

/** Create a group with an optional initial tab list.
 * @param id - unique group id.
 * @param tabs - initial tabs in display order.
 * @returns a new group node.
 */
export function group(id: string, tabs: TabDocument[] = []): GroupNode {
  return { kind: 'group', id, tabs, ...(tabs[0] === undefined ? {} : { activeTabId: tabs[0].id }) }
}

/** Create one valid session-scoped editor instance with an initialized state bank.
 * @param id - stable module instance id.
 * @param editorId - registered session editor id.
 * @param binding - precise Workspace and Session identity.
 * @param lastKnownTitle - display label retained while the editor is unavailable.
 * @param state - initial JSON-safe module state.
 * @returns a v2 session tab whose current state and state bank agree.
 */
export function createSessionTab(
  id: string,
  editorId: string,
  binding: SessionBindingV1,
  lastKnownTitle: string,
  state: JsonValue = {},
): TabDocument {
  const current = structuredClone(state)
  const key = sessionTargetKey(binding)
  return {
    id, editorId, editorScope: 'session', sessionId: binding.sessionId, binding,
    lastKnownTitle, state: current,
    sessionStates: { [key]: structuredClone(current) }, sessionStateOrder: [key], bindingGeneration: 0,
  }
}

/** Create the default inner Workspace layout for an optional Session.
 * The application Sidebar lives in the stable outer shell, so it is not
 * duplicated as a default Area inside this document.
 * @param sessionId - Session used by the Conversation editor.
 * @param account - Workspace account key used to derive the precise binding.
 * @returns a valid v2 layout document.
 */
export function defaultLayout(sessionId?: string, account = 'ungrouped'): WorkbenchLayoutDocument {
  // Core-only installs have no inner-page module yet; keep the first Area
  // genuinely empty so an unavailable Suite editor is never presented.
  if (sessionId === undefined) return { version: 2, root: group('group-main', []), activeGroupId: 'group-main' }
  const binding = bindingForAccount(account, sessionId)
  const conversation = createSessionTab(
    `tab-conversation-${sessionId}`, 'workbench.conversation', binding, '对话',
  )
  return {
    version: 2,
    root: group('group-main', [conversation]),
    activeGroupId: 'group-main',
  }
}

/**
 * Remove Workbench editors that are no longer part of the product surface.
 * Workspace/Settings belong to the outer shell, while Tool Details is a
 * retired empty editor. Other unavailable and third-party editors stay
 * untouched so their normal placeholder/recovery semantics still work.
 *
 * @param document Workbench layout document to migrate.
 * @returns The migrated document, or the original object when no retired editor exists.
 */
export function migrateOuterShellEditors(
  document: WorkbenchLayoutDocument,
): WorkbenchLayoutDocument {
  const removed = (tab: TabDocument): boolean => OUTER_SHELL_EDITOR_IDS.has(tab.editorId)
    || REMOVED_WORKBENCH_EDITOR_IDS.has(tab.editorId)
  if (!tabsOf(document.root).some(removed)) return document
  const strip = (node: LayoutNode): LayoutNode => {
    if (node.kind === 'split') return collapseEmpty({
      ...node,
      first: strip(node.first),
      second: strip(node.second),
    })
    const tabs = node.tabs.filter(tab => !removed(tab))
    const activeTabId = tabs.some(tab => tab.id === node.activeTabId)
      ? node.activeTabId
      : tabs[0]?.id
    return {
      kind: 'group',
      id: node.id,
      tabs,
      ...(node.areaBinding === undefined ? {} : { areaBinding: structuredClone(node.areaBinding) }),
      ...(node.areaBindingGeneration === undefined ? {} : { areaBindingGeneration: node.areaBindingGeneration }),
      ...(activeTabId === undefined ? {} : { activeTabId }),
    }
  }
  const root = strip(document.root)
  const groups = groupsOf(root)
  if (groups.every(item => item.tabs.length === 0)) return defaultLayout()
  const activeGroupId = groups.some(item => item.id === document.activeGroupId && item.tabs.length > 0)
    ? document.activeGroupId
    : groups.find(item => item.tabs.length > 0)?.id
  /* v8 ignore next -- the all-empty case returns the safe default above. */
  if (activeGroupId === undefined) return defaultLayout()
  return { ...document, version: 2, root, activeGroupId }
}

/** Map one node by id while preserving the recursive tree.
 * @param node - root node to traverse.
 * @param id - node id to replace.
 * @param map - replacement function.
 * @returns the mapped tree.
 */
export function mapNode(node: LayoutNode, id: string, map: (node: LayoutNode) => LayoutNode): LayoutNode {
  if (node.id === id) return map(node)
  if (node.kind === 'group') return node
  return { ...node, first: mapNode(node.first, id, map), second: mapNode(node.second, id, map) }
}

/** Flatten all groups in depth-first order.
 * @param node - tree root.
 * @returns group nodes in traversal order.
 */
export function groupsOf(node: LayoutNode): GroupNode[] {
  return node.kind === 'group' ? [node] : [...groupsOf(node.first), ...groupsOf(node.second)]
}

/** Flatten all tabs in group traversal order.
 * @param node - tree root.
 * @returns tab documents in display order.
 */
export function tabsOf(node: LayoutNode): TabDocument[] {
  return groupsOf(node).flatMap(item => item.tabs)
}

/** Activate a tab and its containing group.
 * @param document - source layout.
 * @param groupId - target group id.
 * @param tabId - target tab id.
 * @returns updated layout, or the same object for an invalid target.
 */
export function activate(document: WorkbenchLayoutDocument, groupId: string, tabId: string): WorkbenchLayoutDocument {
  const target = groupsOf(document.root).find(item => item.id === groupId)
  if (target === undefined || !target.tabs.some(tab => tab.id === tabId)) return document
  if (document.activeGroupId === groupId && target.activeTabId === tabId) return document
  return { ...document, activeGroupId: groupId, root: mapNode(document.root, groupId, node => ({
    ...(node as GroupNode), activeTabId: tabId,
  })) }
}

/** Replace one tab's serializable state.
 * @param document - source layout.
 * @param tabId - target tab id.
 * @param state - JSON-safe replacement state.
 * @param bindingGeneration - optional generation guard captured by the publisher.
 * @returns updated layout.
 */
export function updateTabState(
  document: WorkbenchLayoutDocument,
  tabId: string,
  state: JsonValue,
  bindingGeneration?: number,
): WorkbenchLayoutDocument {
  const target = tabsOf(document.root).find(tab => tab.id === tabId)
  if (target === undefined
    || bindingGeneration !== undefined && bindingGeneration !== (target.bindingGeneration ?? 0)
    || JSON.stringify(target.state) === JSON.stringify(state)) return document
  return { ...document, root: updateGroups(document.root, item => ({
    ...item, tabs: item.tabs.map((tab) => {
      if (tab.id !== tabId || (bindingGeneration !== undefined
        && bindingGeneration !== (tab.bindingGeneration ?? 0))) return tab
      const binding = tab.binding ?? (tab.sessionId === undefined ? undefined : { sessionId: tab.sessionId })
      const carriesPreparedStart = tab.editorScope === 'root'
        && tab.editorId === WORKBENCH_CONVERSATION_START_EDITOR
        && binding !== undefined
      if (tab.editorScope !== 'session' && !carriesPreparedStart || binding === undefined) return { ...tab, state }
      const key = sessionTargetKey(binding)
      const states = { ...(tab.sessionStates ?? {}), [key]: state }
      const order = [...(tab.sessionStateOrder ?? []).filter(candidate => candidate !== key), key]
      const trimmed = trimSessionStates(states, order, key)
      return { ...tab, state, sessionStates: trimmed.states, sessionStateOrder: trimmed.order }
    }),
  })) }
}

/** Create a stable serialization key for a Workspace + Session target.
 * @param binding - precise Session binding to serialize.
 * @returns stable state-bank key for the binding.
 */
export function sessionTargetKey(binding: SessionBindingV1): string {
  return JSON.stringify([binding.workspaceId ?? null, binding.sessionId])
}

function jsonBytes(value: JsonValue): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength
}

function trimSessionStates(
  source: Record<string, JsonValue>,
  sourceOrder: readonly string[],
  currentKey: string,
): { states: Record<string, JsonValue>; order: string[] } {
  let states = { ...source }
  const order = [...sourceOrder]
  let total = Object.values(states).reduce<number>((sum, value) => sum + jsonBytes(value), 0)
  while (total > MAX_EDITOR_STATE_BYTES) {
    const candidate = order.find(key => key !== currentKey && states[key] !== undefined)
    if (candidate === undefined) break
    const candidateState = states[candidate]
    if (candidateState !== undefined) total -= jsonBytes(candidateState)
    states = Object.fromEntries(
      Object.entries(states).filter(([key]) => key !== candidate),
    )
    order.splice(order.indexOf(candidate), 1)
  }
  return { states, order: order.filter(key => states[key] !== undefined) }
}

/** Rebind an existing session editor instance while preserving its local state.
 * @param document - source layout.
 * @param tabId - target session tab.
 * @param target - replacement precise binding or legacy Session id.
 * @returns updated layout.
 */
export function retargetSession(
  document: WorkbenchLayoutDocument,
  tabId: string,
  target: string | SessionBindingV1,
): WorkbenchLayoutDocument {
  const binding = typeof target === 'string' ? { sessionId: target } : target
  const pending = groupsOf(document.root).flatMap(group => group.tabs).find(tab => tab.id === tabId)?.pendingBinding
  return { ...document, root: updateGroups(document.root, item => ({
    ...item,
    tabs: item.tabs.map((tab) => {
      if ((tab.id !== tabId && (pending === undefined || tab.pendingBinding !== pending)) || tab.editorScope !== 'session') return tab
      if (tab.pendingBinding !== undefined) return { ...createSessionTab(tab.id, tab.editorId, binding, tab.lastKnownTitle), state: tab.state, ...(tab.pendingDistribution ? {pendingDistribution:tab.pendingDistribution} : {}) }
      const oldBinding = tab.binding ?? (tab.sessionId === undefined ? undefined : { sessionId: tab.sessionId })
      const oldKey = oldBinding === undefined ? undefined : sessionTargetKey(oldBinding)
      const nextKey = sessionTargetKey(binding)
      const states = {
        ...(tab.sessionStates ?? {}),
        ...(oldKey === undefined ? {} : { [oldKey]: tab.state }),
      }
      const nextState = structuredClone(states[nextKey] ?? {})
      states[nextKey] = nextState
      const order = [
        ...(tab.sessionStateOrder ?? []).filter(key => key !== oldKey && key !== nextKey),
        ...(oldKey === undefined ? [] : [oldKey]), nextKey,
      ]
      const trimmed = trimSessionStates(states, order, nextKey)
      return {
        ...tab, sessionId: binding.sessionId, binding, state: nextState,
        sessionStates: trimmed.states, sessionStateOrder: trimmed.order,
        bindingGeneration: (tab.bindingGeneration ?? 0) + 1,
      }
    }),
  })) }
}

/** Replace one unavailable editor while preserving its instance and Session identity.
 * @param document - source layout.
 * @param tabId - target tab.
 * @param editorId - replacement editor id.
 * @param lastKnownTitle - replacement display title.
 * @returns updated layout with cleared editor state.
 */
export function replaceEditor(
  document: WorkbenchLayoutDocument,
  tabId: string,
  editorId: string,
  lastKnownTitle: string,
): WorkbenchLayoutDocument {
  return { ...document, root: updateGroups(document.root, item => ({
    ...item,
    tabs: item.tabs.map((tab) => {
      if (tab.id !== tabId) return tab
      if (tab.editorId === WORKBENCH_CONVERSATION_START_EDITOR
        && tab.editorScope === 'root'
        && tab.binding !== undefined
        && editorId === WORKBENCH_CONVERSATION_EDITOR) {
        const key = sessionTargetKey(tab.binding)
        const state = structuredClone(tab.state)
        return {
          ...tab,
          editorId,
          editorScope: 'session',
          sessionId: tab.binding.sessionId,
          lastKnownTitle,
          state,
          sessionStates: { ...(tab.sessionStates ?? {}), [key]: structuredClone(state) },
          sessionStateOrder: [...(tab.sessionStateOrder ?? []).filter(candidate => candidate !== key), key],
          bindingGeneration: (tab.bindingGeneration ?? 0) + 1,
        }
      }
      if (tab.editorScope !== 'session' || tab.binding === undefined) {
        return { ...tab, editorId, lastKnownTitle, state: {} }
      }
      const key = sessionTargetKey(tab.binding)
      return {
        ...tab, editorId, lastKnownTitle, state: {},
        sessionStates: { [key]: {} }, sessionStateOrder: [key],
        bindingGeneration: (tab.bindingGeneration ?? 0) + 1,
      }
    }),
  })) }
}

/** Replace one page instance in place without changing the tab identity.
 *
 * This command is deliberately separate from `add-tab`: the UI can make the
 * replace/add choice before dispatching it, so selecting a page from an Area
 * menu never has to infer intent from whether an equivalent tab already exists.
 */
export function replaceTab(
  document: WorkbenchLayoutDocument,
  tabId: string,
  replacement: TabDocument,
): WorkbenchLayoutDocument {
  if (replacement.id !== tabId) return document
  const exists = tabsOf(document.root).some(tab => tab.id === tabId)
  if (!exists) return document
  return { ...document, root: updateGroups(document.root, item => ({
    ...item,
    tabs: item.tabs.map(tab => tab.id === tabId ? structuredClone(replacement) : tab),
  })) }
}

/** Validate an editor state before it enters the layout document. */
/** Validate JSON serializability and the per-tab byte budget.
 * @param value - candidate editor state.
 * @returns a diagnostic string, or undefined when valid.
 */
export function editorStateFailure(value: unknown, maxBytes = MAX_EDITOR_STATE_BYTES): string | undefined {
  let encoded: string | undefined
  try {
    encoded = JSON.stringify(value)
  } catch {
    return '编辑器状态必须能够序列化为 JSON。'
  }
  if (typeof encoded !== 'string') return '编辑器状态必须是 JSON 值。'
  const bytes = new TextEncoder().encode(encoded).byteLength
  const limit = Number.isSafeInteger(maxBytes) && maxBytes > 0
    ? Math.min(maxBytes, MAX_EDITOR_STATE_BYTES)
    : MAX_EDITOR_STATE_BYTES
  if (bytes > limit) {
    return `编辑器状态为 ${String(bytes)} 字节，不能超过 ${String(limit)} 字节。`
  }
  return undefined
}

function updateGroups(node: LayoutNode, map: (group: GroupNode) => GroupNode): LayoutNode {
  if (node.kind === 'group') return map(node)
  return { ...node, first: updateGroups(node.first, map), second: updateGroups(node.second, map) }
}

/** Close a tab and collapse empty non-root branches.
 * @param document - source layout.
 * @param tabId - target tab id.
 * @returns updated layout.
 */
export function closeTab(document: WorkbenchLayoutDocument, tabId: string): WorkbenchLayoutDocument {
  if (!tabsOf(document.root).some(tab => tab.id === tabId)) return document
  const root = collapseEmpty(removeTab(document.root, tabId))
  const ids = groupsOf(root).map(item => item.id)
  const [fallbackGroupId] = ids
  /* v8 ignore next -- every LayoutNode contains at least one group. */
  if (fallbackGroupId === undefined) return document
  const activeGroupId = ids.includes(document.activeGroupId) ? document.activeGroupId : fallbackGroupId
  return { ...document, root, activeGroupId }
}

function removeTab(node: LayoutNode, tabId: string): LayoutNode {
  if (node.kind === 'split') return { ...node, first: removeTab(node.first, tabId), second: removeTab(node.second, tabId) }
  const tabs = node.tabs.filter(tab => tab.id !== tabId)
  const [firstTab] = tabs
  if (firstTab === undefined) return { kind: 'group', id: node.id, tabs }
  const activeTabId = tabs.find(tab => tab.id === node.activeTabId)?.id ?? firstTab.id
  return { kind: 'group', id: node.id, tabs, activeTabId }
}

function collapseEmpty(node: LayoutNode): LayoutNode {
  if (node.kind === 'group') return node
  const first = collapseEmpty(node.first)
  const second = collapseEmpty(node.second)
  if (first.kind === 'group' && first.tabs.length === 0) return second
  if (second.kind === 'group' && second.tabs.length === 0) return first
  return { ...node, first, second }
}

/** Set and clamp one split ratio.
 * @param document - source layout.
 * @param splitId - split id.
 * @param ratio - requested ratio.
 * @returns updated layout.
 */
export function setRatio(document: WorkbenchLayoutDocument, splitId: string, ratio: number): WorkbenchLayoutDocument {
  return { ...document, root: mapNode(document.root, splitId, node => node.kind === 'split' ? { ...node, ratio: clampRatio(ratio) } : node) }
}

/** Add a unique tab to an existing group and activate it.
 * @param document - source layout.
 * @param groupId - destination group id.
 * @param tab - tab to insert.
 * @returns updated layout or the same object when the target is invalid.
 */
export function addTab(document: WorkbenchLayoutDocument, groupId: string, tab: TabDocument): WorkbenchLayoutDocument {
  if (tabsOf(document.root).some(existing => existing.id === tab.id)) return document
  if (!groupsOf(document.root).some(existing => existing.id === groupId)) return document
  return activate({ ...document, root: mapNode(document.root, groupId, node => ({
    ...(node as GroupNode), tabs: [...(node as GroupNode).tabs, tab], activeTabId: tab.id,
  })) }, groupId, tab.id)
}

function insertTab(document: WorkbenchLayoutDocument, groupId: string, tab: TabDocument, index?: number): WorkbenchLayoutDocument {
  const root = mapNode(document.root, groupId, (node) => {
    const target = node as GroupNode
    const at = index === undefined ? target.tabs.length : Math.max(0, Math.min(index, target.tabs.length))
    return { ...target, tabs: [...target.tabs.slice(0, at), tab, ...target.tabs.slice(at)], activeTabId: tab.id }
  })
  return { ...document, root, activeGroupId: groupId }
}

/** Move or split a tab using a deterministic drop operation.
 * @param document - source layout.
 * @param tabId - tab to move.
 * @param targetGroupId - destination group.
 * @param edge - center merge or edge split direction.
 * @param ids - fresh ids used when a split is created.
 * @param index - optional insertion index for center drops.
 * @param ratio - optional split ratio before clamping to the persisted bounds.
 * @returns updated layout, or the same object for a stale command.
 */
export function moveTab(
  document: WorkbenchLayoutDocument,
  tabId: string,
  targetGroupId: string,
  edge: DropEdge,
  ids: { groupId: string; splitId: string },
  index?: number,
  ratio = 0.5,
): WorkbenchLayoutDocument {
  const tab = tabsOf(document.root).find(row => row.id === tabId)
  if (tab === undefined) return document
  const source = groupsOf(document.root).find(row => row.tabs.some(candidate => candidate.id === tabId))
  /* v8 ignore next -- tabsOf() is a flattening of these same groups, so a found tab always has one source group. */
  if (source === undefined) return document
  if (!groupsOf(document.root).some(group => group.id === targetGroupId)) return document
  if (edge === 'center' && source.id === targetGroupId) {
    const from = source.tabs.findIndex(candidate => candidate.id === tabId)
    const requested = index ?? source.tabs.length
    const adjusted = requested > from ? requested - 1 : requested
    const nextTabs = source.tabs.filter(candidate => candidate.id !== tabId)
    const at = Math.max(0, Math.min(adjusted, nextTabs.length))
    nextTabs.splice(at, 0, tab)
    if (nextTabs.every((candidate, position) => candidate === source.tabs[position])) {
      return activate(document, source.id, tab.id)
    }
    return {
      ...document,
      activeGroupId: source.id,
      root: mapNode(document.root, source.id, node => ({
        ...(node as GroupNode), tabs: nextTabs, activeTabId: tab.id,
      })),
    }
  }
  // Splitting a one-tab group around itself would only create an empty leaf.
  if (edge !== 'center' && source.id === targetGroupId && source.tabs.length === 1) {
    const horizontal = edge === 'left' || edge === 'right'
    const existingIds = new Set([...groupsOf(document.root).map(item => item.id), ...tabsOf(document.root).map(item => item.id)])
    if (existingIds.has(ids.groupId) || existingIds.has(ids.splitId) || ids.groupId === ids.splitId) return document
    const empty: GroupNode = { kind: 'group', id: source.id, tabs: [],
      ...(source.areaBinding === undefined ? {} : { areaBinding: structuredClone(source.areaBinding) }),
      ...(source.areaBindingGeneration === undefined ? {} : { areaBindingGeneration: source.areaBindingGeneration }) }
    const inserted = group(ids.groupId, [tab])
    const root = mapNode(document.root, source.id, () => ({ kind: 'split', id: ids.splitId, axis: horizontal ? 'horizontal' : 'vertical', ratio: clampRatio(ratio), first: edge === 'left' || edge === 'top' ? inserted : empty, second: edge === 'left' || edge === 'top' ? empty : inserted }))
    return { ...document, root, activeGroupId: ids.groupId }
  }
  if (edge !== 'center') {
    const existingIds = new Set([
      ...groupsOf(document.root).map(group => group.id),
      ...tabsOf(document.root).map(tab => tab.id),
    ])
    const collectSplitIds = (node: LayoutNode): void => {
      if (node.kind === 'group') return
      existingIds.add(node.id)
      collectSplitIds(node.first)
      collectSplitIds(node.second)
    }
    collectSplitIds(document.root)
    if (existingIds.has(ids.groupId) || existingIds.has(ids.splitId) || ids.groupId === ids.splitId) return document
  }
  const without = closeTab(document, tabId)
  if (edge === 'center') return insertTab(without, targetGroupId, tab, index)
  const horizontal = edge === 'left' || edge === 'right'
  const newGroup = group(ids.groupId, [tab])
  const root = mapNode(without.root, targetGroupId, target => ({
    kind: 'split', id: ids.splitId, axis: horizontal ? 'horizontal' : 'vertical', ratio: clampRatio(ratio),
    first: edge === 'left' || edge === 'top' ? newGroup : target,
    second: edge === 'left' || edge === 'top' ? target : newGroup,
  }))
  return { ...without, root, activeGroupId: ids.groupId }
}

/** Copy one editor instance and optionally split the copy into a new group.
 * @param document - source layout.
 * @param tabId - source tab id.
 * @param newTabId - fresh id for the copy.
 * @param targetGroupId - destination group.
 * @param edge - center merge or edge split direction.
 * @param ids - fresh ids used when a split is created.
 * @param index - optional insertion index.
 * @param ratio - optional split ratio before clamping to the persisted bounds.
 * @returns updated layout, or the same object for a stale command.
 */
export function duplicateTab(
  document: WorkbenchLayoutDocument,
  tabId: string,
  newTabId: string,
  targetGroupId: string,
  edge: DropEdge,
  ids: { groupId: string; splitId: string },
  index?: number,
  ratio = 0.5,
): WorkbenchLayoutDocument {
  if (tabsOf(document.root).some(tab => tab.id === newTabId)) return document
  const original = tabsOf(document.root).find(tab => tab.id === tabId)
  if (original === undefined) return document
  const copy: TabDocument = { ...structuredClone(original), id: newTabId }
  const added = addTab(document, targetGroupId, copy)
  if (edge === 'center') return added
  const previousActiveTabId = groupsOf(document.root).find(group => group.id === targetGroupId)?.activeTabId
  const moved = moveTab(added, newTabId, targetGroupId, edge, ids, index, ratio)
  if (previousActiveTabId === undefined) return moved
  return {
    ...moved,
    root: mapNode(moved.root, targetGroupId, node => ({
      ...(node as GroupNode), activeTabId: previousActiveTabId,
    })),
  }
}

/** Move every tab from one group into another and collapse the emptied branch.
 * @param document - source layout.
 * @param sourceGroupId - group whose tabs move.
 * @param targetGroupId - destination group.
 * @returns updated layout.
 */
export function mergeGroup(
  document: WorkbenchLayoutDocument,
  sourceGroupId: string,
  targetGroupId: string,
): WorkbenchLayoutDocument {
  if (sourceGroupId === targetGroupId) return document
  const source = groupsOf(document.root).find(group => group.id === sourceGroupId)
  const target = groupsOf(document.root).find(group => group.id === targetGroupId)
  if (source === undefined || target === undefined) return document
  // Session-scoped tabs in one composite Area must share exactly one binding.
  // Refuse a merge that would combine two different Sessions; callers can
  // surface the disabled action and let the user create a separate Area.
  if (!canMergeGroups(document, sourceGroupId, targetGroupId)) return document
  // Preserve the module that was visible before the Area was merged.  The
  // source group's tab order is module history, not presentation order; the
  // last historical tab may be an unavailable/legacy editor (for example the
  // old Tool Details page) and must never win merely because it happens to be
  // last in that array.
  const sourceActiveTabId = source.activeTabId ?? source.tabs.at(-1)?.id
  let next = document
  for (const tab of source.tabs) next = closeTab(next, tab.id)
  for (const tab of source.tabs) next = insertTab(next, targetGroupId, tab)
  // Pending pages adopt the destination Area's one explicit conversation.
  // Without this normalization an otherwise valid merge writes an unreadable
  // v3 document (bound Area mixed with unbound session modules).
  const binding = target.areaBinding ?? source.areaBinding
    ?? [...target.tabs, ...source.tabs].find(tab => tab.binding)?.binding
  if (binding) next = { ...next, root: mapNode(next.root, targetGroupId, node => {
    const area = node as GroupNode
    return { ...area, areaBinding: binding, tabs: area.tabs.map(tab => tab.editorScope === 'session' && tab.pendingBinding
      ? { ...createSessionTab(tab.id, tab.editorId, binding, tab.lastKnownTitle, tab.state),
        ...(tab.pendingDistribution ? { pendingDistribution: tab.pendingDistribution } : {}) } : tab) }
  }) }
  return sourceActiveTabId === undefined ? next : activate(next, targetGroupId, sourceActiveTabId)
}

function bindingKey(binding: SessionBindingV1): string {
  return `${binding.workspaceId ?? ''}\u0000${binding.sessionId}`
}

/** Whether merging two Areas preserves the shared Session binding invariant. */
export function canMergeGroups(
  document: WorkbenchLayoutDocument,
  sourceGroupId: string,
  targetGroupId: string,
): boolean {
  if (sourceGroupId === targetGroupId) return false
  const groups = groupsOf(document.root)
  const source = groups.find(group => group.id === sourceGroupId)
  const target = groups.find(group => group.id === targetGroupId)
  if (source === undefined || target === undefined) return false
  const keys = new Set<string>()
  for (const group of [source, target]) {
    if (group.areaBinding !== undefined) keys.add(bindingKey(group.areaBinding))
    for (const tab of group.tabs) if (tab.editorScope === 'session' && tab.binding !== undefined) keys.add(bindingKey(tab.binding))
  }
  return keys.size <= 1
}

/** Exchange the complete editor histories of two stable areas.
 * @param document - source layout.
 * @param firstGroupId - first area id.
 * @param secondGroupId - second area id.
 * @returns updated layout, or the same object for invalid or identical areas.
 */
export function swapGroups(
  document: WorkbenchLayoutDocument,
  firstGroupId: string,
  secondGroupId: string,
): WorkbenchLayoutDocument {
  if (firstGroupId === secondGroupId) return document
  const first = groupsOf(document.root).find(group => group.id === firstGroupId)
  const second = groupsOf(document.root).find(group => group.id === secondGroupId)
  if (first === undefined || second === undefined) return document
  return {
    ...document,
    root: updateGroups(document.root, (candidate) => {
      if (candidate.id === firstGroupId) {
        const { activeTabId: _activeTabId, ...area } = candidate
        return {
          ...area,
          tabs: structuredClone(second.tabs),
          ...(second.activeTabId === undefined ? {} : { activeTabId: second.activeTabId }),
        }
      }
      if (candidate.id === secondGroupId) {
        const { activeTabId: _activeTabId, ...area } = candidate
        return {
          ...area,
          tabs: structuredClone(first.tabs),
          ...(first.activeTabId === undefined ? {} : { activeTabId: first.activeTabId }),
        }
      }
      return candidate
    }),
  }
}

/** Apply one deterministic command; failed or stale targets are harmless no-ops.
 * @param document - current layout.
 * @param command - deterministic edit command.
 * @returns resulting layout.
 */
export function applyLayoutCommand(
  document: WorkbenchLayoutDocument,
  command: LayoutCommand,
): WorkbenchLayoutDocument {
  switch (command.type) {
    case 'replace-layout': return command.document
    case 'activate': return activate(document, command.groupId, command.tabId)
    case 'add-tab': return addTab(document, command.groupId, command.tab)
    case 'close-tab': return closeTab(document, command.tabId)
    case 'move-tab': return moveTab(
      document, command.tabId, command.targetGroupId, command.edge, command.ids, command.index, command.ratio,
    )
    case 'duplicate-tab': return duplicateTab(
      document, command.tabId, command.newTabId, command.targetGroupId, command.edge, command.ids, command.index,
      command.ratio,
    )
    case 'merge-group': return mergeGroup(document, command.sourceGroupId, command.targetGroupId)
    case 'swap-groups': return swapGroups(document, command.firstGroupId, command.secondGroupId)
    case 'set-ratio': return setRatio(document, command.splitId, command.ratio)
    case 'update-tab-state': return updateTabState(
      document, command.tabId, command.state, command.bindingGeneration,
    )
    case 'retarget-session': return retargetSession(
      document, command.tabId, command.binding ?? command.sessionId,
    )
    case 'replace-tab': return replaceTab(document, command.tabId, command.tab)
    case 'replace-editor': return replaceEditor(
      document, command.tabId, command.editorId, command.lastKnownTitle,
    )
  }
}

/** Decode, migrate, and validate a persisted layout document.
 * @param value - unknown Settings value.
 * @param account - owning Workspace account used to make legacy Session ids precise.
 * @returns validated layout or undefined for an unsupported document.
 */
export function validateLayout(value: unknown, account = 'ungrouped'): WorkbenchLayoutDocument | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const migrated = (value as { version?: unknown }).version === 1
    ? migrateLayoutV1(value, account)
    : structuredClone(value)
  if (typeof migrated !== 'object' || migrated === null
    || (migrated as { version?: unknown }).version !== 2) return undefined
  const candidate = migrated as WorkbenchLayoutDocument
  const ids = new Set<string>()
  const visit = (node: LayoutNode): boolean => {
    // oxlint-disable-next-line typescript/no-unnecessary-condition -- persisted input is validated at runtime.
    if (typeof node !== 'object' || node === null) return false
    if (typeof node.id !== 'string' || ids.has(node.id)) return false
    ids.add(node.id)
    if (node.kind === 'split') {
      // oxlint-disable-next-line typescript/no-unnecessary-condition -- persisted input is validated at runtime.
      if ((node.axis !== 'horizontal' && node.axis !== 'vertical') || !Number.isFinite(node.ratio)) return false
      node.ratio = clampRatio(node.ratio)
      return visit(node.first) && visit(node.second)
    }
    // oxlint-disable-next-line typescript/no-unnecessary-condition -- persisted input is validated at runtime.
    if (node.kind !== 'group' || !Array.isArray(node.tabs)) return false
    if (node.areaBinding !== undefined && !validBinding(node.areaBinding, node.areaBinding.sessionId, account)) return false
    for (const tab of node.tabs) {
      if (typeof tab.id !== 'string' || ids.has(tab.id) || typeof tab.editorId !== 'string') return false
      const preparedStart = tab.editorScope === 'root' && tab.editorId === WORKBENCH_CONVERSATION_START_EDITOR
      if (tab.pendingBinding !== undefined) {
        if (tab.editorScope !== 'session' || !/^binding-[1-9][0-9]{0,2}$/u.test(tab.pendingBinding)
          || tab.binding !== undefined || tab.sessionId !== undefined || tab.sessionStates !== undefined
          || tab.sessionStateOrder !== undefined || tab.bindingGeneration !== undefined) return false
      } else if (tab.editorScope === 'session') {
        if (typeof tab.sessionId !== 'string' || !validBinding(tab.binding, tab.sessionId, account)) return false
        if (!Number.isInteger(tab.bindingGeneration) || (tab.bindingGeneration ?? -1) < 0) return false
        if (!validStateBank(tab)) return false
      } else if (preparedStart && tab.binding !== undefined) {
        if (!validBinding(tab.binding, tab.binding.sessionId, account)
          || tab.sessionId !== undefined && tab.sessionId !== tab.binding.sessionId
          || !Number.isInteger(tab.bindingGeneration) || (tab.bindingGeneration ?? -1) < 0
          || !validStateBank(tab)) return false
      } else if (tab.sessionId !== undefined || tab.binding !== undefined
        || tab.sessionStates !== undefined || tab.sessionStateOrder !== undefined
        || tab.bindingGeneration !== undefined) return false
      if (typeof tab.lastKnownTitle !== 'string' || editorStateFailure(tab.state) !== undefined) return false
      ids.add(tab.id)
    }
    const sessionTabs = node.tabs.filter(tab => tab.editorScope === 'session')
    if (node.areaBinding !== undefined && sessionTabs.some(tab => tab.binding?.sessionId !== node.areaBinding!.sessionId || tab.binding?.workspaceId !== node.areaBinding!.workspaceId)) return false
    if (node.areaBindingGeneration !== undefined && (!Number.isInteger(node.areaBindingGeneration) || node.areaBindingGeneration < 0)) return false
    return node.activeTabId === undefined || node.tabs.some(tab => tab.id === node.activeTabId)
  }
  return visit(candidate.root) && groupsOf(candidate.root).some(item => item.id === candidate.activeGroupId)
    ? candidate
    : undefined
}

function bindingForAccount(account: string, sessionId: string): SessionBindingV1 {
  return account.startsWith('workspace:')
    ? { workspaceId: account.slice('workspace:'.length), sessionId }
    : { sessionId }
}

function migrateLayoutV1(value: unknown, account: string): unknown {
  const candidate = structuredClone(value) as { version?: unknown; root?: unknown; activeGroupId?: unknown }
  const migrateNode = (node: unknown): unknown => {
    if (typeof node !== 'object' || node === null) return node
    const row = node as { kind?: unknown; first?: unknown; second?: unknown; tabs?: unknown }
    if (row.kind === 'split') {
      return { ...row, first: migrateNode(row.first), second: migrateNode(row.second) }
    }
    if (!Array.isArray(row.tabs)) return row
    return {
      ...row,
      tabs: (row.tabs as unknown[]).map((tab) => {
        if (typeof tab !== 'object' || tab === null) return tab
        const entry = tab as Record<string, unknown>
        if (entry['editorScope'] !== 'session' || typeof entry['sessionId'] !== 'string') return entry
        const binding = bindingForAccount(account, entry['sessionId'])
        const key = sessionTargetKey(binding)
        return {
          ...entry, binding, sessionStates: { [key]: structuredClone(entry['state']) },
          sessionStateOrder: [key], bindingGeneration: 0,
        }
      }),
    }
  }
  return { ...candidate, version: 2, root: migrateNode(candidate.root) }
}

function validBinding(value: unknown, sessionId: string, account: string): value is SessionBindingV1 {
  if (typeof value !== 'object' || value === null) return false
  const binding = value as { workspaceId?: unknown; sessionId?: unknown }
  const accountWorkspaceId = account.startsWith('workspace:')
    ? account.slice('workspace:'.length)
    : account === 'ungrouped' ? undefined : null
  return binding.sessionId === sessionId
    && (binding.workspaceId === undefined || typeof binding.workspaceId === 'string')
    && accountWorkspaceId !== null
    && binding.workspaceId === accountWorkspaceId
}

function validStateBank(tab: TabDocument): boolean {
  const stateOrder = tab.sessionStateOrder
  // oxlint-disable-next-line typescript/no-unnecessary-condition -- persisted input is validated at runtime.
  if (typeof tab.sessionStates !== 'object' || tab.sessionStates === null
    || !Array.isArray(stateOrder) || tab.binding === undefined) return false
  const keys = Object.keys(tab.sessionStates)
  if (new Set(stateOrder).size !== stateOrder.length
    || keys.length !== stateOrder.length
    || keys.some(key => !stateOrder.includes(key))) return false
  const currentKey = sessionTargetKey(tab.binding)
  if (tab.sessionStates[currentKey] === undefined
    || JSON.stringify(tab.sessionStates[currentKey]) !== JSON.stringify(tab.state)) return false
  let total = 0
  for (const state of Object.values(tab.sessionStates)) {
    if (editorStateFailure(state) !== undefined) return false
    total += jsonBytes(state)
  }
  return total <= MAX_EDITOR_STATE_BYTES
}
