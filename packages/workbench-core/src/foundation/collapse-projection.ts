import type {
  GroupNode, LayoutNode, SplitNode, WorkbenchLayoutDocument,
} from './model.ts'

/** Runtime-only dimensions. They are not persisted in a Workbench document. */
/** The normal Area header is 32px tall in the spacious layout. */
export const AREA_HEADER_SIZE = 32

/**
 * Minimum dimensions for an Area that is still considered usable while
 * expanded. These values are intentionally separate from the compact rail
 * footprint: a collapsed Area must remain small enough to preserve the rest
 * of the layout, while an expanded Area needs room for its body and chrome.
 */
export const EXPANDED_AREA_MIN_WIDTH = 320
export const EXPANDED_AREA_MIN_HEIGHT = 240

/** Runtime-only identity rail dimensions for collapsed Areas. */
export const COLLAPSED_AREA_WIDTH = 40
export const COLLAPSED_AREA_HEIGHT = 40
export const COLLAPSED_DIVIDER_SIZE = 12
export const AUTO_COLLAPSE_SIZE = 80
export const AUTO_COLLAPSE_REARM_SIZE = 96

export type CollapseIntent =
  | { mode: 'expanded' }
  | { mode: 'manual-area' }
  | { mode: 'auto-area'; reason: 'area-too-small' }
  | { mode: 'auto-branch'; reason: 'branch-too-small' }
  | { mode: 'manual-expanded'; rearmBlocked: true }

/** The only runtime state accepted by the projection. */
export type CollapseRuntimeState = ReadonlyMap<string, CollapseIntent>

export interface CollapseFootprint {
  width: number
  height: number
}

export interface CollapseProjectionGroup {
  kind: 'group'
  node: GroupNode
  collapsed: boolean
  /** A group rendered inside a summary is still an identity rail. */
  summary: boolean
  footprint: CollapseFootprint
}

export interface CollapseProjectionSplit {
  kind: 'split'
  node: SplitNode
  first: CollapseProjectionNode
  second: CollapseProjectionNode
  /** The split is represented by one compact summary instead of normal tracks. */
  summary: boolean
  footprint: CollapseFootprint
}

export type CollapseProjectionNode = CollapseProjectionGroup | CollapseProjectionSplit

export interface CollapseProjection {
  root: CollapseProjectionNode
  collapsedAreaIds: ReadonlySet<string>
  summarySplitIds: ReadonlySet<string>
}

export interface AreaMeasurement {
  width: number
  height: number
}

export type AreaMeasurements = ReadonlyMap<string, AreaMeasurement>

export function intentCollapses(intent: CollapseIntent | undefined): boolean {
  // Automatic collapse is intentionally disabled. Keep legacy runtime intent
  // variants readable, but only explicit user actions affect the projection.
  return intent?.mode === 'manual-area'
}

export function isAutoRearmReady(width: number, height: number): boolean {
  return Number.isFinite(width) && Number.isFinite(height)
    && width >= AUTO_COLLAPSE_REARM_SIZE
    && height >= AUTO_COLLAPSE_REARM_SIZE
}

export function isAreaTooSmall(width: number, height: number): boolean {
  return Number.isFinite(width) && Number.isFinite(height)
    && width > 0 && height > 0
    && (width < AUTO_COLLAPSE_SIZE || height < AUTO_COLLAPSE_SIZE)
}

/**
 * Compact geometry is deliberately independent of ratios and DOM dimensions.
 * Every renderer (normal split tracks and nested summaries) consumes this
 * exact result, so turning a corner cannot invent another rail size.
 */
export function compactFootprint(node: LayoutNode): CollapseFootprint {
  if (node.kind === 'group') {
    return { width: COLLAPSED_AREA_WIDTH, height: COLLAPSED_AREA_HEIGHT }
  }
  const first = compactFootprint(node.first)
  const second = compactFootprint(node.second)
  return node.axis === 'horizontal'
    ? {
      width: first.width + COLLAPSED_DIVIDER_SIZE + second.width,
      height: Math.max(first.height, second.height),
    }
    : {
      width: Math.max(first.width, second.width),
      height: first.height + COLLAPSED_DIVIDER_SIZE + second.height,
    }
}

interface ProjectedMinimum extends CollapseFootprint {
  projected: boolean
}

function projectedMinimum(node: LayoutNode, collapsedAreaIds: ReadonlySet<string>): ProjectedMinimum {
  if (node.kind === 'group') {
    return collapsedAreaIds.has(node.id)
      ? { ...compactFootprint(node), projected: true }
      : { width: 0, height: 0, projected: false }
  }
  const first = projectedMinimum(node.first, collapsedAreaIds)
  const second = projectedMinimum(node.second, collapsedAreaIds)
  if (!first.projected && !second.projected) return { width: 0, height: 0, projected: false }
  return node.axis === 'horizontal'
    ? {
      width: first.width + COLLAPSED_DIVIDER_SIZE + second.width,
      height: Math.max(first.height, second.height),
      projected: true,
    }
    : {
      width: Math.max(first.width, second.width),
      height: first.height + COLLAPSED_DIVIDER_SIZE + second.height,
      projected: true,
    }
}

/** Minimum cross-tree space required by the collapsed descendants of a node. */
export function projectedMinimumFootprint(
  node: LayoutNode,
  collapsedAreaIds: ReadonlySet<string>,
): CollapseFootprint {
  const result = projectedMinimum(node, collapsedAreaIds)
  return { width: result.width, height: result.height }
}

function collectGroups(node: LayoutNode, output: GroupNode[] = []): GroupNode[] {
  if (node.kind === 'group') output.push(node)
  else {
    collectGroups(node.first, output)
    collectGroups(node.second, output)
  }
  return output
}

function collectGroupIds(node: LayoutNode, output: Set<string>): void {
  if (node.kind === 'group') output.add(node.id)
  else {
    collectGroupIds(node.first, output)
    collectGroupIds(node.second, output)
  }
}

function collectNodeIds(node: LayoutNode, output: Set<string>): void {
  output.add(node.id)
  if (node.kind === 'split') {
    collectNodeIds(node.first, output)
    collectNodeIds(node.second, output)
  }
}

function collectSplitIds(node: LayoutNode, output: Set<string>): void {
  if (node.kind === 'group') return
  output.add(node.id)
  collectSplitIds(node.first, output)
  collectSplitIds(node.second, output)
}

export function branchFullyCollapsed(node: LayoutNode, collapsedAreaIds: ReadonlySet<string>): boolean {
  return node.kind === 'group'
    ? collapsedAreaIds.has(node.id)
    : branchFullyCollapsed(node.first, collapsedAreaIds)
      && branchFullyCollapsed(node.second, collapsedAreaIds)
}

function deriveCollapsedAreaIds(
  node: LayoutNode,
  state: CollapseRuntimeState,
  forced = false,
  output = new Set<string>(),
): Set<string> {
  const collapsed = forced || intentCollapses(state.get(node.id))
  if (node.kind === 'group') {
    if (collapsed) output.add(node.id)
    return output
  }
  deriveCollapsedAreaIds(node.first, state, collapsed, output)
  deriveCollapsedAreaIds(node.second, state, collapsed, output)
  return output
}

function projectNode(
  node: LayoutNode,
  collapsedAreaIds: ReadonlySet<string>,
  summarySplitIds: Set<string>,
  insideSummary = false,
): CollapseProjectionNode {
  if (node.kind === 'group') {
    return {
      kind: 'group', node,
      collapsed: collapsedAreaIds.has(node.id),
      summary: insideSummary,
      footprint: compactFootprint(node),
    }
  }
  const childrenCollapsed = branchFullyCollapsed(node, collapsedAreaIds)
  const summary = insideSummary || childrenCollapsed
  if (summary) summarySplitIds.add(node.id)
  return {
    kind: 'split', node,
    first: projectNode(node.first, collapsedAreaIds, summarySplitIds, summary),
    second: projectNode(node.second, collapsedAreaIds, summarySplitIds, summary),
    summary,
    footprint: compactFootprint(node),
  }
}

/**
 * Resolve runtime intents into one immutable render projection. The persisted
 * ratio is never changed here; it is only consumed by the normal-track path.
 */
export function deriveCollapseProjection(
  document: WorkbenchLayoutDocument,
  state: CollapseRuntimeState,
): CollapseProjection {
  let effectiveState = state
  let collapsedAreaIds = deriveCollapsedAreaIds(document.root, effectiveState)
  const validGroups = collectGroups(document.root)
  if (validGroups.length > 0 && collapsedAreaIds.size >= validGroups.length) {
    // A projection may receive stale or externally constructed runtime state.
    // Clear every collapsing owner on one root-to-leaf path rather than only
    // deleting a leaf from collapsedAreaIds. Otherwise an auto-branch could
    // still render a summary that contains the force-expanded leaf.
    const entryGroupId = validGroups.some(group => group.id === document.activeGroupId)
      ? document.activeGroupId
      : validGroups[0]!.id
    const next = new Map(effectiveState)
    const clearOwnersOnPath = (node: LayoutNode): boolean => {
      if (node.kind === 'group') {
        if (node.id !== entryGroupId) return false
        if (intentCollapses(next.get(node.id))) next.delete(node.id)
        return true
      }
      const containsEntry = clearOwnersOnPath(node.first) || clearOwnersOnPath(node.second)
      if (containsEntry && intentCollapses(next.get(node.id))) next.delete(node.id)
      return containsEntry
    }
    clearOwnersOnPath(document.root)
    effectiveState = next
    collapsedAreaIds = deriveCollapsedAreaIds(document.root, effectiveState)
  }
  const summarySplitIds = new Set<string>()
  return {
    root: projectNode(document.root, collapsedAreaIds, summarySplitIds),
    collapsedAreaIds,
    summarySplitIds,
  }
}

/**
 * One source of truth for split tracks. A branch receives compact tracks only
 * when the projection says it is fully collapsed; otherwise its stored ratio
 * remains authoritative.
 */
export function splitGridTracks(
  split: SplitNode,
  collapsedAreaIds: ReadonlySet<string>,
): { axis: SplitNode['axis']; tracks: string } {
  const firstCollapsed = branchFullyCollapsed(split.first, collapsedAreaIds)
  const secondCollapsed = branchFullyCollapsed(split.second, collapsedAreaIds)
  const projectedExtent = (node: LayoutNode): number => {
    const footprint = projectedMinimumFootprint(node, collapsedAreaIds)
    return split.axis === 'horizontal' ? footprint.width : footprint.height
  }
  if (!firstCollapsed && !secondCollapsed) {
    const ratio = Number.isFinite(split.ratio)
      ? Math.min(1, Math.max(0, split.ratio)) : 0.5
    const firstMinimum = projectedExtent(split.first)
    const secondMinimum = projectedExtent(split.second)
    return {
      axis: split.axis,
      tracks: `minmax(${String(firstMinimum)}px, ${String(ratio)}fr) ${COLLAPSED_DIVIDER_SIZE}px minmax(${String(secondMinimum)}px, ${String(1 - ratio)}fr)`,
    }
  }
  const extent = (node: LayoutNode): number => {
    const footprint = compactFootprint(node)
    return split.axis === 'horizontal' ? footprint.width : footprint.height
  }
  const first = firstCollapsed ? extent(split.first) : undefined
  const second = secondCollapsed ? extent(split.second) : undefined
  const firstTrack = first === undefined
    ? `minmax(${String(projectedExtent(split.first))}px, 1fr)` : `${String(first)}px`
  const secondTrack = second === undefined
    ? `minmax(${String(projectedExtent(split.second))}px, 1fr)` : `${String(second)}px`
  return { axis: split.axis, tracks: `${firstTrack} ${COLLAPSED_DIVIDER_SIZE}px ${secondTrack}` }
}

/**
 * A compact branch only consumes its footprint on the parent split's main
 * axis. When its own split turns into the parent's cross-axis, its children
 * fill the allocated cross-axis; the wrapper itself remains a compact identity
 * projection on the parent's main axis.
 */
export function summaryGridTracks(
  split: SplitNode,
  _parentAxis: SplitNode['axis'],
): { axis: SplitNode['axis']; tracks: string } {
  const first = compactFootprint(split.first)
  const second = compactFootprint(split.second)
  const ratio = Number.isFinite(split.ratio)
    ? Math.min(1, Math.max(0, split.ratio)) : 0.5
  return {
    axis: split.axis,
    tracks: split.axis === 'horizontal'
      ? `minmax(${String(first.width)}px, ${String(ratio)}fr) ${COLLAPSED_DIVIDER_SIZE}px minmax(${String(second.width)}px, ${String(1 - ratio)}fr)`
      : `minmax(${String(first.height)}px, ${String(ratio)}fr) ${COLLAPSED_DIVIDER_SIZE}px minmax(${String(second.height)}px, ${String(1 - ratio)}fr)`,
  }
}

/**
 * Turn a batch of DOM measurements into candidates without cascading one
 * observer callback into another. Fully-small nested branches are promoted to
 * a single branch candidate; their leaf candidates are removed.
 */
export function selectAutoCollapseCandidates(
  document: WorkbenchLayoutDocument,
  state: CollapseRuntimeState,
  measurements: AreaMeasurements,
): ReadonlySet<string> {
  const groups = collectGroups(document.root)
  const eligibleAreaIds = new Set<string>()
  const manuallyCollapsedAreaIds = new Set<string>()
  for (const group of groups) {
    const intent = state.get(group.id)
    if (intent?.mode === 'manual-area') {
      manuallyCollapsedAreaIds.add(group.id)
      continue
    }
    if (intent?.mode === 'manual-expanded') continue
    const measured = measurements.get(group.id)
    if (measured !== undefined && isAreaTooSmall(measured.width, measured.height)) {
      eligibleAreaIds.add(group.id)
    }
  }

  // Protect an entry point before branch promotion. Removing a leaf after its
  // ancestor became an auto-branch would create a contradictory summary with
  // one expanded child inside it.
  if (groups.length > 0 && groups.every(group =>
    manuallyCollapsedAreaIds.has(group.id) || eligibleAreaIds.has(group.id))) {
    const activeCandidate = eligibleAreaIds.has(document.activeGroupId)
      ? document.activeGroupId
      : groups.find(group => eligibleAreaIds.has(group.id))?.id
    if (activeCandidate !== undefined) eligibleAreaIds.delete(activeCandidate)
  }

  const candidates = new Set<string>(eligibleAreaIds)
  const visit = (node: LayoutNode): boolean => {
    if (node.kind === 'group') return eligibleAreaIds.has(node.id)
    const first = visit(node.first)
    const second = visit(node.second)
    if (first && second && node.id !== document.root.id) {
      const descendantIds = new Set<string>()
      collectNodeIds(node.first, descendantIds)
      collectNodeIds(node.second, descendantIds)
      for (const id of descendantIds) candidates.delete(id)
      candidates.add(node.id)
    }
    return first && second
  }
  visit(document.root)
  return candidates
}

/**
 * Atomically reconcile automatic intents from the latest measurement set.
 * Manual choices survive; old auto owners are replaced by the maximally
 * promoted candidate set so a branch and its descendants can never both own
 * the same projection.
 */
export function reconcileAutoCollapseState(
  document: WorkbenchLayoutDocument,
  state: CollapseRuntimeState,
  measurements: AreaMeasurements,
): Map<string, CollapseIntent> {
  const next = new Map<string, CollapseIntent>()
  for (const [id, intent] of state) {
    if (intent.mode === 'manual-area' || intent.mode === 'expanded') {
      next.set(id, intent)
      continue
    }
    if (intent.mode === 'manual-expanded') {
      const measured = measurements.get(id)
      next.set(id, measured !== undefined
        && isAutoRearmReady(measured.width, measured.height)
        ? { mode: 'expanded' }
        : intent)
    }
  }
  const splitIds = new Set<string>()
  collectSplitIds(document.root, splitIds)
  for (const id of selectAutoCollapseCandidates(document, next, measurements)) {
    const previous = state.get(id)
    if (splitIds.has(id)) {
      next.set(id, previous?.mode === 'auto-branch'
        ? previous
        : { mode: 'auto-branch', reason: 'branch-too-small' })
    } else {
      next.set(id, previous?.mode === 'auto-area'
        ? previous
        : { mode: 'auto-area', reason: 'area-too-small' })
    }
  }
  return next
}

export function validCollapseState(
  document: WorkbenchLayoutDocument,
  state: CollapseRuntimeState,
): Map<string, CollapseIntent> {
  const validIds = new Set<string>()
  collectGroupIds(document.root, validIds)
  const collectSplits = (node: LayoutNode): void => {
    if (node.kind === 'split') {
      validIds.add(node.id)
      collectSplits(node.first)
      collectSplits(node.second)
    }
  }
  collectSplits(document.root)
  const next = new Map<string, CollapseIntent>()
  for (const [id, intent] of state) {
    if (!validIds.has(id) || intent.mode === 'auto-area' || intent.mode === 'auto-branch') continue
    next.set(id, intent)
  }
  return next
}

/** Remove branch-owned auto intents when a user expands one of its leaves. */
export function clearAutoBranchAncestors(
  document: WorkbenchLayoutDocument,
  state: CollapseRuntimeState,
  groupId: string,
): Map<string, CollapseIntent> {
  const next = new Map(state)
  const visit = (node: LayoutNode): boolean => {
    if (node.kind === 'group') return node.id === groupId
    const contains = visit(node.first) || visit(node.second)
    if (contains && next.get(node.id)?.mode === 'auto-branch') next.delete(node.id)
    return contains
  }
  visit(document.root)
  return next
}
