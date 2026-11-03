import { describe, expect, it } from 'vitest'
import {
  areAreaContentProjectionsEqual,
  areAreaContentRenderPropsEqual,
  isAreaContentCommandCurrent,
  type AreaContentProjectionV1,
  type AreaContentRenderPropsV1,
} from '../src/foundation/area-content-projection.ts'

const stableState = { draft: 'same' }

function projection(overrides: Partial<AreaContentProjectionV1> = {}): AreaContentProjectionV1 {
  return {
    areaId: 'area-a', tabId: 'tab-a', editorId: 'workbench.conversation', editorScope: 'session',
    sessionId: 'session-a', workspaceId: 'workspace-a', bindingGeneration: 4,
    state: stableState, availability: 'available', lastKnownTitle: 'Conversation',
    ...overrides,
  }
}

function renderProps(overrides: Partial<AreaContentRenderPropsV1> = {}): AreaContentRenderPropsV1 {
  return {
    projection: projection(), commands: {}, renderSlot: () => null, replacementEditors: [],
    areaClaim: 'claim-a', editor: {}, extensionAccess: {}, editorAvailable: true,
    lifecycle: { visibility: 'visible', focused: true }, runtimeMetrics: undefined,
    ...overrides,
  }
}

describe('Area content projection', () => {
  it('keeps an editor surface stable when only unrelated split-shell data changes', () => {
    expect(areAreaContentProjectionsEqual(projection(), projection())).toBe(true)
  })

  it.each([
    { tabId: 'tab-b' },
    { editorId: 'workbench.files' },
    { sessionId: 'session-b' },
    { workspaceId: 'workspace-b' },
    { bindingGeneration: 5 },
    { state: { draft: 'changed' } },
    { availability: 'missing' as const },
    { lastKnownTitle: 'Renamed' },
    { pendingBinding: 'workspace' },
    { sessionUnavailable: 'moved' as const },
  ])('treats content-affecting field changes as a new projection (%s)', change => {
    expect(areAreaContentProjectionsEqual(projection(), projection(change))).toBe(false)
  })

  it('rejects a command facade retained across tab, editor, or binding changes', () => {
    const identity = {
      areaId: 'area-a', tabId: 'tab-a', editorId: 'workbench.conversation', editorScope: 'session' as const,
      sessionId: 'session-a', bindingGeneration: 4,
    }
    expect(isAreaContentCommandCurrent(identity, { ...identity })).toBe(true)
    expect(isAreaContentCommandCurrent(identity, { ...identity, bindingGeneration: 5 })).toBe(false)
    expect(isAreaContentCommandCurrent(identity, { ...identity, tabId: 'tab-b' })).toBe(false)
    expect(isAreaContentCommandCurrent(identity, undefined)).toBe(false)
  })

  it('memoizes only when content projection and all render capabilities stay current', () => {
    const previous = renderProps()
    expect(areAreaContentRenderPropsEqual(previous, { ...previous })).toBe(true)
    expect(areAreaContentRenderPropsEqual(previous, { ...previous, areaClaim: 'claim-b' })).toBe(false)
    expect(areAreaContentRenderPropsEqual(previous, { ...previous, lifecycle: { visibility: 'visible', focused: false } })).toBe(false)
    expect(areAreaContentRenderPropsEqual(previous, { ...previous, editorAvailable: false })).toBe(false)
  })
})
