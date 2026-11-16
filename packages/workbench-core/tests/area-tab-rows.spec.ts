import { describe, expect, it } from 'vitest'
import {
  buildWorkbenchAreaTabRows,
  conversationTabUnavailable,
  indexWorkbenchAreaOrdinals,
  indexWorkbenchEditors,
  workbenchEditorFromIndex,
} from '../src/foundation/area-tab-rows.ts'
import type { WorkbenchEditorCatalogRow } from '../src/foundation/catalog.ts'
import type { GroupNode, TabDocument } from '../src/foundation/model.ts'

function editor(
  id: string,
  scope: WorkbenchEditorCatalogRow['scope'],
  icon: string,
): WorkbenchEditorCatalogRow {
  return { id, label: `${scope}:${id}`, scope, icon }
}

function tab(input: Partial<TabDocument> & Pick<TabDocument, 'id' | 'editorId' | 'editorScope'>): TabDocument {
  return {
    lastKnownTitle: input.id,
    state: {},
    ...input,
  }
}

describe('Workbench Area tab row model', () => {
  it('shows shared conversation activity even when its view is disposed, without coloring sibling resources', () => {
    const editorIndex = indexWorkbenchEditors([editor('workbench.conversation', 'session', 'message'), editor('files', 'session', 'folder')])
    const input = { editorIndex, activeTabId: 'chat', areaBinding: { sessionId: 'session-1' }, pausedTabId: 'chat',
      conversations: new Map([['session-1', { status: 'attention' as const, label: '等待审批' }]]),
      tabs: [tab({ id: 'chat', editorId: 'workbench.conversation', editorScope: 'session', binding: { sessionId: 'session-1' } }),
        tab({ id: 'copy', editorId: 'workbench.conversation', editorScope: 'session', sessionId: 'session-1' }),
        tab({ id: 'files', editorId: 'files', editorScope: 'session', sessionId: 'session-1' })] }
    expect(buildWorkbenchAreaTabRows(input).summaries.map(row => [row.status, row.statusLabel])).toEqual([
      ['attention', '等待审批'], ['attention', '等待审批'], ['ready', '就绪'],
    ])
  })

  it('retains missing, unbound, unavailable and unknown states ahead of an old successful result', () => {
    const chat = tab({ id: 'chat', editorId: 'workbench.conversation', editorScope: 'session', sessionId: 's' })
    const input = { tabs: [chat], editorIndex: indexWorkbenchEditors([editor('workbench.conversation', 'session', 'message')]), activeTabId: 'chat', areaBinding: undefined, pausedTabId: undefined,
      conversations: new Map([['s', { status: 'completed' as const, label: '本轮已完成' }]]) }
    expect(buildWorkbenchAreaTabRows({ ...input, editorIndex: indexWorkbenchEditors([]) }).summaries[0]?.status).toBe('missing')
    expect(buildWorkbenchAreaTabRows({ ...input, tabs: [{ ...chat, pendingBinding: 'draft' }] }).summaries[0]?.status).toBe('unbound')
    expect(buildWorkbenchAreaTabRows({ ...input, sessionAvailability: () => '此对话已归档' }).summaries[0]).toMatchObject({ status: 'failed', statusLabel: '此对话已归档' })
    expect(buildWorkbenchAreaTabRows({ ...input, conversations: new Map() }).summaries[0]?.status).toBe('unknown')
  })

  it('resolves legacy workspace-less bindings and detects archived, missing and moved conversations', () => {
    const facts = { sessions: { s: {} }, workspaces: [{ workspaceId: 'new', sessionIds: ['s'] }], archivedSessionIds: [] }
    expect(conversationTabUnavailable({ sessionId: 's' }, facts)).toBeUndefined()
    expect(conversationTabUnavailable({ sessionId: 's', workspaceId: 'old' }, facts)).toBe('对话已移出绑定项目')
    expect(conversationTabUnavailable({ sessionId: 's' }, { ...facts, archivedSessionIds: ['s'] })).toBe('此对话已归档')
    expect(conversationTabUnavailable({ sessionId: 's' }, { ...facts, sessions: {} })).toBe('此对话暂时不可用')
  })

  it('matches editors by both ID and scope while preserving Area order', () => {
    const rootEditor = editor('shared-id', 'root', 'folder')
    const sessionEditor = editor('shared-id', 'session', 'terminal')
    const duplicateRootEditor = editor('shared-id', 'root', 'panel')
    const editorIndex = indexWorkbenchEditors([rootEditor, sessionEditor, duplicateRootEditor])
    const rootTab = tab({ id: 'root-tab', editorId: 'shared-id', editorScope: 'root', lastKnownTitle: 'Root page' })
    const sessionTab = tab({
      id: 'session-tab', editorId: 'shared-id', editorScope: 'session', sessionId: 'session-1',
      lastKnownTitle: 'Session page',
    })

    const result = buildWorkbenchAreaTabRows({
      tabs: [rootTab, sessionTab], editorIndex, activeTabId: 'session-tab',
      areaBinding: undefined, pausedTabId: undefined,
    })

    expect(result.rows.map(row => row.tab.id)).toEqual(['root-tab', 'session-tab'])
    expect(result.rows[0]).toMatchObject({ editor: rootEditor, presentation: { icon: 'folder' } })
    expect(result.rows[1]).toMatchObject({ editor: sessionEditor, presentation: { icon: 'terminal' } })
    expect(result.summaries).toMatchObject([
      { id: 'root-tab', title: 'Root page', selected: false, status: 'ready' },
      { id: 'session-tab', title: 'Session page', selected: true, status: 'ready' },
    ])
    expect(workbenchEditorFromIndex(editorIndex, 'shared-id', 'root')).toBe(rootEditor)
    expect(workbenchEditorFromIndex(editorIndex, 'shared-id', 'session')).toBe(sessionEditor)
  })

  it('reflects tab reordering without changing each tab row identity', () => {
    const editorIndex = indexWorkbenchEditors([
      editor('one', 'root', 'folder'),
      editor('two', 'root', 'terminal'),
    ])
    const first = tab({ id: 'tab-one', editorId: 'one', editorScope: 'root' })
    const second = tab({ id: 'tab-two', editorId: 'two', editorScope: 'root' })
    const input = {
      editorIndex,
      activeTabId: 'tab-one',
      areaBinding: undefined,
      pausedTabId: undefined,
    }

    const before = buildWorkbenchAreaTabRows({ ...input, tabs: [first, second] })
    const after = buildWorkbenchAreaTabRows({ ...input, tabs: [second, first] })

    expect(before.rows.map(row => row.tab.id)).toEqual(['tab-one', 'tab-two'])
    expect(after.rows.map(row => row.tab.id)).toEqual(['tab-two', 'tab-one'])
    expect(after.rows[0]?.tab).toBe(second)
    expect(after.rows[1]?.tab).toBe(first)
    expect(after.summaries.map(summary => summary.id)).toEqual(['tab-two', 'tab-one'])
  })

  it('rebuilds current title, editor metadata, status and selection from new inputs', () => {
    const firstIndex = indexWorkbenchEditors([editor('page', 'session', 'message')])
    const currentTab = tab({
      id: 'one', editorId: 'page', editorScope: 'session', sessionId: 'session-1', lastKnownTitle: 'Before',
    })
    const first = buildWorkbenchAreaTabRows({
      tabs: [currentTab], editorIndex: firstIndex, activeTabId: 'one',
      areaBinding: undefined, pausedTabId: undefined,
    })
    expect(first.summaries[0]).toMatchObject({ title: 'Before', icon: 'message', selected: true, status: 'ready' })

    const updatedIndex = indexWorkbenchEditors([editor('page', 'session', 'terminal')])
    const updated = buildWorkbenchAreaTabRows({
      tabs: [tab({ ...currentTab, lastKnownTitle: 'After' })], editorIndex: updatedIndex,
      activeTabId: undefined, areaBinding: undefined, pausedTabId: undefined,
    })
    expect(updated.summaries[0]).toMatchObject({ title: 'After', icon: 'terminal', selected: false })
  })

  it('retains precise unavailable, unbound, paused and ready states', () => {
    const editorIndex = indexWorkbenchEditors([
      editor('session-page', 'session', 'message'),
      editor('root-page', 'root', 'folder'),
    ])
    const tabs = [
      tab({ id: 'ready', editorId: 'session-page', editorScope: 'session', sessionId: 'session-1' }),
      tab({ id: 'pending', editorId: 'session-page', editorScope: 'session', pendingBinding: 'draft-binding' }),
      tab({ id: 'unbound', editorId: 'session-page', editorScope: 'session' }),
      tab({ id: 'missing', editorId: 'removed-page', editorScope: 'root' }),
      tab({ id: 'paused', editorId: 'root-page', editorScope: 'root' }),
    ]

    const result = buildWorkbenchAreaTabRows({
      tabs, editorIndex, activeTabId: 'paused', areaBinding: undefined, pausedTabId: 'paused',
    })

    expect(result.summaries.map(summary => [summary.id, summary.status])).toEqual([
      ['ready', 'ready'], ['pending', 'unbound'], ['unbound', 'unbound'],
      ['missing', 'missing'], ['paused', 'paused'],
    ])
    expect(result.summaries.map(summary => summary.statusLabel)).toEqual([
      '就绪', '待绑定', '待绑定', '不可用', '已暂停',
    ])
  })

  it('scales catalog reads with editors rather than multiplying by tab count', () => {
    let editorReads = 0
    let tabReads = 0
    const sourceEditors = Array.from({ length: 24 }, (_, index) => editor(`editor-${index}`, 'root', 'panel'))
    const sourceTabs = Array.from({ length: 1024 }, (_, index) => tab({
      id: `tab-${index}`,
      editorId: `editor-${index % sourceEditors.length}`,
      editorScope: 'root',
    }))
    const editors = new Proxy(sourceEditors, {
      get(target, property, receiver) {
        if (typeof property === 'string' && /^\d+$/.test(property)) editorReads += 1
        return Reflect.get(target, property, receiver)
      },
    })
    const tabs = new Proxy(sourceTabs, {
      get(target, property, receiver) {
        if (typeof property === 'string' && /^\d+$/.test(property)) tabReads += 1
        return Reflect.get(target, property, receiver)
      },
    })
    const editorIndex = indexWorkbenchEditors(editors)

    const result = buildWorkbenchAreaTabRows({
      tabs, editorIndex, activeTabId: 'tab-500', areaBinding: undefined, pausedTabId: undefined,
    })

    expect(editorReads).toBe(sourceEditors.length)
    expect(tabReads).toBe(sourceTabs.length)
    expect(result.rows).toHaveLength(sourceTabs.length)
    expect(result.rows[500]).toMatchObject({ tab: { id: 'tab-500' }, summary: { selected: true } })
  })

  it('indexes Area ordinals once in document order', () => {
    const groups: Pick<GroupNode, 'id'>[] = [{ id: 'area-a' }, { id: 'area-b' }, { id: 'area-c' }]
    const ordinals = indexWorkbenchAreaOrdinals(groups)
    expect([...ordinals]).toEqual([['area-a', 1], ['area-b', 2], ['area-c', 3]])
  })
})
