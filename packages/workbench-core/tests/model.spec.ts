import { describe, expect, it } from 'vitest'
import {
  applyLayoutCommand, createSessionTab, defaultLayout, group, groupsOf, replaceEditor, replaceTab, sessionTargetKey,
  validateLayout, type WorkbenchLayoutDocument,
} from '../src/foundation/model.ts'

describe('Workbench layout related-editor placement', () => {
  it('keeps the source Conversation active when moving a new copy right', () => {
    const binding = { workspaceId: 'workspace', sessionId: 'session' }
    const sourceConversation = createSessionTab('source-conversation', 'workbench.conversation', binding, '对话')
    const start = { id: 'start', editorId: 'workbench.conversation.start', editorScope: 'root' as const, lastKnownTitle: '新建对话', state: {} }
    const document: WorkbenchLayoutDocument = {
      version: 2,
      activeGroupId: 'area-1',
      root: { ...group('area-1', [start, sourceConversation]), activeTabId: sourceConversation.id },
    }
    const copy = createSessionTab('right-conversation', 'workbench.conversation', binding, '对话')
    const added = applyLayoutCommand(document, { type: 'add-tab', groupId: 'area-1', tab: copy })
    const restored = applyLayoutCommand(added, { type: 'activate', groupId: 'area-1', tabId: sourceConversation.id })
    const split = applyLayoutCommand(restored, {
      type: 'move-tab', tabId: copy.id, targetGroupId: 'area-1', edge: 'right',
      ids: { groupId: 'area-2', splitId: 'split-1' }, ratio: 0.5,
    })
    const areas = groupsOf(split.root)
    expect(areas).toHaveLength(2)
    expect(areas.find(area => area.id === 'area-1')?.activeTabId).toBe(sourceConversation.id)
    expect(areas.find(area => area.id === 'area-2')?.activeTabId).toBe(copy.id)
    expect(areas.find(area => area.id === 'area-1')?.tabs.map(tab => tab.editorId)).toEqual(['workbench.conversation.start', 'workbench.conversation'])
  })

  it('accepts a prepared Start carrier in root scope and keeps its binding', () => {
    const binding = { workspaceId: 'workspace', sessionId: 'session' }
    const key = sessionTargetKey(binding)
    const start = {
      id: 'start', editorId: 'workbench.conversation.start', editorScope: 'root' as const,
      sessionId: binding.sessionId, binding, bindingGeneration: 1,
      sessionStates: { [key]: {} }, sessionStateOrder: [key],
      lastKnownTitle: '新建对话', state: {},
    }
    const document: WorkbenchLayoutDocument = {
      version: 2, activeGroupId: 'area-1', root: group('area-1', [start]),
    }
    expect(validateLayout(document, 'workspace:workspace')).toBeDefined()
    const activated = replaceEditor(document, 'start', 'workbench.conversation', '对话')
    const tab = groupsOf(activated.root)[0]?.tabs[0]
    expect(tab).toMatchObject({
      editorId: 'workbench.conversation', editorScope: 'session', sessionId: binding.sessionId, binding,
    })
  })

  it('continues to reject a binding on unrelated root editors', () => {
    const binding = { workspaceId: 'workspace', sessionId: 'session' }
    const key = sessionTargetKey(binding)
    const browser = {
      id: 'browser', editorId: 'workbench.browser', editorScope: 'root' as const,
      sessionId: binding.sessionId, binding, bindingGeneration: 1,
      sessionStates: { [key]: {} }, sessionStateOrder: [key],
      lastKnownTitle: '浏览器', state: {},
    }
    const document: WorkbenchLayoutDocument = {
      version: 2, activeGroupId: 'area-1', root: group('area-1', [browser]),
    }
    expect(validateLayout(document, 'ungrouped')).toBeUndefined()
  })

  it('replaces a page in place while preserving its stable tab identity', () => {
    const document: WorkbenchLayoutDocument = {
      version: 2,
      activeGroupId: 'area-1',
      root: group('area-1', [{
        id: 'page-1', editorId: 'workbench.conversation.start', editorScope: 'root',
        lastKnownTitle: '新建对话', state: { draft: 'hello' },
      }]),
    }
    const replacement = createSessionTab('page-1', 'workbench.conversation', {
      workspaceId: 'workspace', sessionId: 'session',
    }, '对话')
    const result = replaceTab(document, 'page-1', replacement)
    const tab = groupsOf(result.root)[0]?.tabs[0]
    expect(tab).toMatchObject({ id: 'page-1', editorId: 'workbench.conversation', sessionId: 'session' })
    expect(groupsOf(result.root)[0]?.tabs).toHaveLength(1)
    expect(validateLayout(result, 'workspace:workspace')).toBeDefined()
    expect(replaceTab(document, 'missing', replacement)).toBe(document)
  })

  it('dispatches replace-tab independently from add-tab', () => {
    const document = defaultLayout('session')
    const replacement = { id: 'tab-conversation-session', editorId: 'workbench.conversation.start', editorScope: 'root' as const,
      lastKnownTitle: '新建对话', state: {} }
    const result = applyLayoutCommand(document, { type: 'replace-tab', tabId: replacement.id, tab: replacement })
    expect(groupsOf(result.root)[0]?.tabs.map(tab => tab.editorId)).toEqual(['workbench.conversation.start'])
    expect(validateLayout(result)).toBeDefined()
  })
})
