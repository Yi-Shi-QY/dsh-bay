import { describe, expect, it, vi } from 'vitest'
import {
  openWorkbenchResource,
  routeWorkbenchConversationResource,
  workbenchBrowserAddressFor,
  workbenchBrowserUrlFromAddress,
  workbenchChangesReviewAddress,
  workbenchResourceMatchesSession,
  workbenchResourceSessionId,
} from '../src/client/workbench-resource-opener.ts'
import { normalizeWorkbenchConversationInteractionPolicy } from '../src/workbench-interaction-policy.ts'

describe('Workbench resource opener', () => {
  it('routes a session file to the document preview and keeps navigation separate', () => {
    const openNativeTab = vi.fn(() => true)
    const address = 'dsh-resource://file/session/session-a/src/result.ts'

    expect(openWorkbenchResource(openNativeTab, address, { params: { line: 42 } }, 'session-a')).toBe(true)
    expect(openNativeTab).toHaveBeenCalledWith('documentpreview', {
      params: { line: 42 },
      nativeContentId: address,
      resourceAddress: address,
    })
    expect(workbenchResourceSessionId(address)).toBe('session-a')
  })

  it('routes a changes review address to the changes review editor', () => {
    const openNativeTab = vi.fn(() => true)
    const address = workbenchChangesReviewAddress({ sessionId: 'session-a', seq: 8, turn: 3 })

    expect(openWorkbenchResource(openNativeTab, address, { params: { index: 1 } }, 'session-a')).toBe(true)
    expect(openNativeTab).toHaveBeenCalledWith('changes-review', {
      params: { index: 1 },
      nativeContentId: address,
      resourceAddress: address,
    })
    expect(workbenchResourceSessionId(address)).toBe('session-a')
  })

  it('rejects a resource owned by another Session before opening a tab', () => {
    const openNativeTab = vi.fn(() => true)
    const address = 'dsh-resource://file/session/session-b/src/result.ts'

    expect(openWorkbenchResource(openNativeTab, address, undefined, 'session-a')).toBe(false)
    expect(openNativeTab).not.toHaveBeenCalled()
    expect(workbenchResourceMatchesSession(address, 'session-a')).toBe(false)
    expect(workbenchResourceMatchesSession(address, 'session-b')).toBe(true)
  })

  it('distinguishes explicit native fallback from Workbench rejection', () => {
    const openNativeTab = vi.fn(() => true)
    const address = 'dsh-resource://file/session/session-a/src/result.ts'
    const nativePolicy = normalizeWorkbenchConversationInteractionPolicy({
      conversationResources: { file: { enabled: true, placement: 'official-sidebar' } },
    })

    expect(routeWorkbenchConversationResource(openNativeTab, address, nativePolicy, undefined, 'session-a')).toBe('handled')
    expect(openNativeTab).toHaveBeenCalledWith('documentpreview', { floating: true, nativeContentId: address, resourceAddress: address })
    openNativeTab.mockClear()
    expect(routeWorkbenchConversationResource(openNativeTab, address, undefined, undefined, 'session-b')).toBe('rejected')
    expect(openNativeTab).not.toHaveBeenCalled()
    expect(routeWorkbenchConversationResource(() => false, address, undefined, undefined, 'session-a')).toBe('rejected')

    const absolute = 'dsh-resource://file/absolute/C:/outside/result.ts'
    expect(routeWorkbenchConversationResource(openNativeTab, absolute, undefined, undefined, 'session-a', {
      sessionId: 'session-b', parentSessionId: 'unrelated-parent',
    })).toBe('rejected')
    expect(openNativeTab).not.toHaveBeenCalled()
    expect(routeWorkbenchConversationResource(openNativeTab, address, nativePolicy, undefined, 'session-a', {
      sessionId: 'session-b', parentSessionId: 'unrelated-parent',
    })).toBe('rejected')
  })

  it('rejects a stale other-Session resource before an official-sidebar fallback', () => {
    const openNativeTab = vi.fn(() => true)
    const nativePolicy = normalizeWorkbenchConversationInteractionPolicy({
      conversationResources: { file: { enabled: true, placement: 'official-sidebar' } },
    })
    const staleAddress = 'dsh-resource://file/session/session-b/src/late-result.ts'

    for (const source of [undefined, { sessionId: 'session-a' }]) {
      expect(routeWorkbenchConversationResource(
        openNativeTab,
        staleAddress,
        nativePolicy,
        undefined,
        'session-a',
        source,
      )).toBe('rejected')
    }
    expect(openNativeTab).not.toHaveBeenCalled()
  })

  it('allows a direct child Conversation resource in its owning parent Area', () => {
    const openNativeTab = vi.fn(() => true)
    const childFile = 'dsh-resource://file/session/child-a/src/result.ts'
    expect(routeWorkbenchConversationResource(openNativeTab, childFile, undefined, undefined, 'parent-a', {
      sessionId: 'child-a', parentSessionId: 'parent-a',
    })).toBe('handled')
    expect(openNativeTab).toHaveBeenCalledWith('documentpreview', {
      floating: true,
      nativeContentId: childFile,
      resourceSource: { sessionId: 'child-a', parentSessionId: 'parent-a' },
      resourceAddress: childFile,
    })
  })

  it('consumes disabled resources and forwards configured placement to the Area', () => {
    const openNativeTab = vi.fn(() => true)
    const address = 'dsh-resource://file/session/session-a/src/result.ts'
    const disabledPolicy = normalizeWorkbenchConversationInteractionPolicy({
      conversationResources: { file: { enabled: false, placement: 'activate-or-add' } },
    })
    expect(routeWorkbenchConversationResource(openNativeTab, address, disabledPolicy, undefined, 'session-a')).toBe('handled')
    expect(openNativeTab).not.toHaveBeenCalled()

    const newTabPolicy = normalizeWorkbenchConversationInteractionPolicy({
      conversationResources: { file: { enabled: true, placement: 'new-tab' } },
    })
    expect(routeWorkbenchConversationResource(openNativeTab, address, newTabPolicy, { params: { line: 42 } }, 'session-a')).toBe('handled')
    expect(openNativeTab).toHaveBeenCalledWith('documentpreview', {
      params: { line: 42 },
      revealIfOpened: false,
      nativeContentId: address,
      resourceAddress: address,
    })

    expect(routeWorkbenchConversationResource(
      openNativeTab,
      'dsh-resource://file/session/session-b/src/late.ts',
      disabledPolicy,
      undefined,
      'session-a',
      { sessionId: 'session-b' },
    )).toBe('rejected')
  })

  it('allows Session-less absolute files and refuses unknown resource kinds', () => {
    const openNativeTab = vi.fn(() => true)
    const absolute = 'dsh-resource://file/absolute/C:/tmp/result.ts'
    expect(workbenchResourceSessionId(absolute)).toBeUndefined()
    expect(openWorkbenchResource(openNativeTab, absolute, undefined, 'session-a')).toBe(true)
    expect(openNativeTab).toHaveBeenLastCalledWith('documentpreview', {
      nativeContentId: absolute,
      resourceAddress: absolute,
    })

    openNativeTab.mockClear()
    expect(openWorkbenchResource(openNativeTab, 'dsh-resource://unknown/item', undefined, 'session-a')).toBe(false)
    expect(openNativeTab).not.toHaveBeenCalled()
  })

  it('uses an extension resource declaration when the policy follows module defaults', () => {
    const openNativeTab = vi.fn(() => true)
    const address = 'dsh-resource://workbench-report/session/session-a/report/weekly'
    const resourceBindings = [{
      resourceType: 'workbench.report',
      editorId: 'extension.report-viewer',
      resourcePatterns: ['dsh-resource://workbench-report/**'],
      defaultPlacement: 'activate-or-add' as const,
    }]

    expect(routeWorkbenchConversationResource(
      openNativeTab,
      address,
      undefined,
      undefined,
      'session-a',
      { sessionId: 'session-a' },
      resourceBindings,
    )).toBe('handled')
    expect(openNativeTab).toHaveBeenCalledWith('workbench.report', {
      editorId: 'extension.report-viewer',
      resourceSource: { sessionId: 'session-a' },
      resourceType: 'workbench.report',
      nativeContentId: address,
      resourceAddress: address,
    })
  })

  it('honors a user resource policy and requires explicit native fallback for unknown resources', () => {
    const openNativeTab = vi.fn(() => true)
    const address = 'dsh-resource://workbench-report/session/session-a/report/weekly'
    const resourceBindings = [{
      resourceType: 'workbench.report',
      editorId: 'extension.report-viewer',
      resourcePatterns: ['dsh-resource://workbench-report/**'],
      defaultPlacement: 'replace-current' as const,
    }]
    const override = normalizeWorkbenchConversationInteractionPolicy({
      conversationResources: { 'workbench.report': { enabled: true, placement: 'new-tab' } },
    })

    expect(routeWorkbenchConversationResource(
      openNativeTab, address, override, undefined, 'session-a', { sessionId: 'session-a' }, resourceBindings,
    )).toBe('handled')
    expect(openNativeTab).toHaveBeenCalledWith('workbench.report', {
      editorId: 'extension.report-viewer',
      resourceSource: { sessionId: 'session-a' },
      resourceType: 'workbench.report',
      revealIfOpened: false,
      nativeContentId: address,
      resourceAddress: address,
    })

    openNativeTab.mockClear()
    expect(routeWorkbenchConversationResource(
      openNativeTab,
      'dsh-resource://future-native/resource/session-a',
      undefined,
      undefined,
      'session-a',
      { sessionId: 'session-a' },
    )).toBe('rejected')
    expect(openNativeTab).not.toHaveBeenCalled()

    const nativeFallback = normalizeWorkbenchConversationInteractionPolicy({ unknownResource: 'official-sidebar' })
    expect(routeWorkbenchConversationResource(
      openNativeTab,
      'dsh-resource://future-native/resource/session-a',
      nativeFallback,
      undefined,
      'session-a',
      { sessionId: 'session-a' },
    )).toBe('rejected')
  })

  it('reads the native 0.2 plan and plan-review address shapes', () => {
    const plan = 'dsh-resource://plan/session-a/call-1'
    const childPlan = 'dsh-resource://plan/subagent/parent-a/child-a/continuable/call-2'
    const review = 'dsh-resource://plan-review/session-a/window-1'
    expect(workbenchResourceSessionId(plan)).toBe('session-a')
    expect(workbenchResourceSessionId(childPlan)).toBe('child-a')
    expect(workbenchResourceSessionId(review)).toBe('session-a')
    expect(workbenchResourceMatchesSession(childPlan, 'child-a')).toBe(true)
    expect(workbenchResourceMatchesSession(childPlan, 'parent-a')).toBe(true)
    expect(workbenchResourceMatchesSession(childPlan, 'unrelated')).toBe(false)
    const childChat = 'dsh-resource://subagentchat/session/child-a?parent=parent-a&mode=continuable'
    expect(workbenchResourceMatchesSession(childChat, 'parent-a')).toBe(true)
    expect(workbenchResourceMatchesSession(childChat, 'child-a')).toBe(true)
    expect(workbenchResourceMatchesSession(childChat, 'unrelated')).toBe(false)
  })

  it('routes a schedule task to the owning Area and preserves its Session identity', () => {
    const openNativeTab = vi.fn(() => true)
    const address = 'dsh-resource://schedule-task/session/session-a/task-42'
    expect(workbenchResourceSessionId(address)).toBe('session-a')
    expect(workbenchResourceMatchesSession(address, 'session-a')).toBe(true)
    expect(workbenchResourceMatchesSession(address, 'session-b')).toBe(false)
    expect(openWorkbenchResource(openNativeTab, address, { params: { sessionId: 'session-a', id: 'task-42' } }, 'session-a')).toBe(true)
    expect(openNativeTab).toHaveBeenCalledWith('schedule-task', {
      params: { sessionId: 'session-a', id: 'task-42' },
      nativeContentId: address,
      resourceAddress: address,
    })
  })

  it('routes an external HTTP link to a stable Browser resource identity', () => {
    const openNativeTab = vi.fn(() => true)
    const address = workbenchBrowserAddressFor('session-a', 'https://example.com/docs?q=1')
    expect(address).toBeDefined()
    expect(workbenchBrowserUrlFromAddress(address!)).toBe('https://example.com/docs?q=1')
    expect(openWorkbenchResource(openNativeTab, address!, undefined, 'session-a')).toBe(true)
    expect(openNativeTab).toHaveBeenCalledWith('browser', {
      params: { url: 'https://example.com/docs?q=1' },
      nativeContentId: address,
      resourceAddress: address,
      resourceType: 'browser',
    })
  })

  it('rejects non HTTP(S) browser links', () => {
    expect(workbenchBrowserAddressFor('session-a', 'javascript:alert(1)')).toBeUndefined()
    expect(workbenchBrowserUrlFromAddress('dsh-resource://browser/session/session-a/file.txt')).toBeUndefined()
  })
})
