import type { JsonValue } from './model.ts'

/** The complete content identity for one mounted Area editor surface. */
export interface AreaContentProjectionV1 {
  areaId: string
  tabId: string
  editorId: string
  editorScope: 'root' | 'session'
  sessionId?: string
  workspaceId?: string
  bindingGeneration?: number
  state: JsonValue
  availability: 'available' | 'missing' | 'archived' | 'moved' | 'unsupported'
  lastKnownTitle: string
  pendingBinding?: string
  sessionUnavailable?: 'archived' | 'missing' | 'moved'
}

export interface AreaContentRenderPropsV1 {
  projection: AreaContentProjectionV1
  commands: unknown
  renderSlot: unknown
  replacementEditors: readonly unknown[]
  areaClaim: string
  editor: unknown
  extensionAccess: unknown
  editorAvailable: boolean
  lifecycle: unknown
  runtimeMetrics: unknown
}

export interface AreaContentCommandIdentityV1 {
  areaId: string
  tabId: string
  editorId: string
  editorScope: 'root' | 'session'
  sessionId?: string
  bindingGeneration: number
}

/** Reject callbacks retained by an inner page after its Area binding changes. */
export function isAreaContentCommandCurrent(
  expected: AreaContentCommandIdentityV1,
  current: AreaContentCommandIdentityV1 | undefined,
): boolean {
  return current !== undefined
    && expected.areaId === current.areaId
    && expected.tabId === current.tabId
    && expected.editorId === current.editorId
    && expected.editorScope === current.editorScope
    && expected.sessionId === current.sessionId
    && expected.bindingGeneration === current.bindingGeneration
}

/**
 * Compare only values that can change what an Area's real inner page renders.
 * Split geometry and sibling layout are intentionally absent from this model.
 */
export function areAreaContentProjectionsEqual(
  previous: AreaContentProjectionV1 | undefined,
  next: AreaContentProjectionV1 | undefined,
): boolean {
  if (previous === next) return true
  if (previous === undefined || next === undefined) return false
  return previous.areaId === next.areaId
    && previous.tabId === next.tabId
    && previous.editorId === next.editorId
    && previous.editorScope === next.editorScope
    && previous.sessionId === next.sessionId
    && previous.workspaceId === next.workspaceId
    && previous.bindingGeneration === next.bindingGeneration
    && previous.state === next.state
    && previous.availability === next.availability
    && previous.lastKnownTitle === next.lastKnownTitle
    && previous.pendingBinding === next.pendingBinding
    && previous.sessionUnavailable === next.sessionUnavailable
}

/** Keep a real editor host mounted across unrelated split-shell updates. */
export function areAreaContentRenderPropsEqual(
  previous: AreaContentRenderPropsV1,
  next: AreaContentRenderPropsV1,
): boolean {
  return areAreaContentProjectionsEqual(previous.projection, next.projection)
    && previous.commands === next.commands
    && previous.renderSlot === next.renderSlot
    && previous.replacementEditors === next.replacementEditors
    && previous.areaClaim === next.areaClaim
    && previous.editor === next.editor
    && previous.extensionAccess === next.extensionAccess
    && previous.editorAvailable === next.editorAvailable
    && previous.lifecycle === next.lifecycle
    && previous.runtimeMetrics === next.runtimeMetrics
}
