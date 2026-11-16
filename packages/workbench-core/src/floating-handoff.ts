import type { TabDocument } from './foundation/model.ts'
import { editorStateFailure, sessionTargetKey } from './foundation/model.ts'

/** Same-Profile, in-memory handoff. Never a layout export or restart snapshot. */
export interface FloatingHandoffV1 {
  version: 1
  tabs: TabDocument[]
  activeId?: string
  expanded: boolean
  pinnedIds: string[]
}
const id = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 256
export function decodeFloatingHandoff(value: unknown): FloatingHandoffV1 | undefined {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
    const data = value as FloatingHandoffV1
    if (data.version !== 1 || !Array.isArray(data.tabs) || data.tabs.length > 64 || typeof data.expanded !== 'boolean'
      || !Array.isArray(data.pinnedIds) || data.pinnedIds.length > 512 || !data.pinnedIds.every(id)
      || new TextEncoder().encode(JSON.stringify(value)).length > 512 * 1024) return undefined
    const seen = new Set<string>()
    const tabs: TabDocument[] = []
    for (const tab of data.tabs) {
      if (!tab || !id(tab.id) || seen.has(tab.id) || !id(tab.editorId) || !['root', 'session'].includes(tab.editorScope)
        || typeof tab.lastKnownTitle !== 'string' || tab.lastKnownTitle.length > 512 || editorStateFailure(tab.state)) return undefined
      if (tab.binding !== undefined && (!tab.binding || typeof tab.binding !== 'object' || Array.isArray(tab.binding)
        || !id(tab.binding.sessionId) || tab.binding.workspaceId !== undefined && !id(tab.binding.workspaceId)
        || tab.binding.detached !== undefined && typeof tab.binding.detached !== 'boolean'
        || tab.sessionId !== tab.binding.sessionId)) return undefined
      if (tab.sessionId !== undefined && !tab.binding || tab.pendingBinding !== undefined && (!id(tab.pendingBinding) || !!tab.binding)
        || tab.pendingDistribution !== undefined && !id(tab.pendingDistribution)
        || tab.bindingGeneration !== undefined && (!Number.isSafeInteger(tab.bindingGeneration) || tab.bindingGeneration < 0)) return undefined
      if (tab.sessionStates !== undefined && (!tab.binding || !tab.sessionStates || typeof tab.sessionStates !== 'object'
        || Array.isArray(tab.sessionStates) || Object.keys(tab.sessionStates).length > 32
        || Object.entries(tab.sessionStates).some(([key, state]) => !id(key) || ['__proto__', 'constructor', 'prototype'].includes(key) || editorStateFailure(state))
        || !Array.isArray(tab.sessionStateOrder) || new Set(tab.sessionStateOrder).size !== tab.sessionStateOrder.length
        || tab.sessionStateOrder.length !== Object.keys(tab.sessionStates).length
        || tab.sessionStateOrder.some(key => !Object.hasOwn(tab.sessionStates!, key)))) return undefined
      if (tab.sessionStateOrder !== undefined && tab.sessionStates === undefined) return undefined
      seen.add(tab.id)
      tabs.push({ id: tab.id, editorId: tab.editorId, editorScope: tab.editorScope, lastKnownTitle: tab.lastKnownTitle,
        state: structuredClone(tab.state), ...(tab.binding ? { binding: { sessionId: tab.binding.sessionId,
          ...(tab.binding.workspaceId !== undefined ? { workspaceId: tab.binding.workspaceId } : {}), ...(tab.binding.detached ? { detached: true } : {}) },
          sessionId: tab.binding.sessionId, bindingGeneration: tab.bindingGeneration ?? 0,
          sessionStates: { ...structuredClone(tab.sessionStates ?? {}), [sessionTargetKey(tab.binding)]: structuredClone(tab.state) },
          sessionStateOrder: [...(tab.sessionStateOrder ?? []).filter(key => key !== sessionTargetKey(tab.binding!)), sessionTargetKey(tab.binding)] } : {}),
        ...(tab.pendingBinding ? { pendingBinding: tab.pendingBinding } : {}),
        ...(tab.pendingDistribution ? { pendingDistribution: tab.pendingDistribution } : {}) })
    }
    if (data.activeId !== undefined && !seen.has(data.activeId) || data.pinnedIds.some(key => seen.has(key))) return undefined
    return { version: 1, tabs, expanded: data.expanded, pinnedIds: [...new Set(data.pinnedIds)], ...(data.activeId ? { activeId: data.activeId } : {}) }
  } catch { return undefined }
}
