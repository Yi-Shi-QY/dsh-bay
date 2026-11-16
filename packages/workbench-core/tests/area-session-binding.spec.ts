import { expect, it } from 'vitest'
import { activePageSessionBinding } from '../src/foundation/area-session-binding.ts'
import type { GroupNode } from '../src/foundation/model.ts'

const workspaces = [{ workspaceId: 'project', sessionIds: ['one', 'two'] }]
const group: GroupNode = { kind: 'group', id: 'area', activeTabId: 'page', tabs: [
  { id: 'page', editorId: 'test', editorScope: 'session', sessionId: 'one', lastKnownTitle: 'Page', state: {} },
] }

it('ignores a retired Area binding on independent pages', () => {
  const areaBinding = { workspaceId: 'project', sessionId: 'two' }
  expect(activePageSessionBinding({ ...group, areaBinding, tabs: [{ ...group.tabs[0]!, editorScope: 'root' }] }, workspaces, true, 'ungrouped')).toBeUndefined()
})

it('resolves legacy Session-only tabs exactly like the header', () => {
  expect(activePageSessionBinding(group, workspaces, true, 'ungrouped')).toEqual({ workspaceId: 'project', sessionId: 'one' })
  expect(activePageSessionBinding(group, workspaces, false, 'workspace:legacy')).toEqual({ workspaceId: 'legacy', sessionId: 'one' })
})

it('keeps empty and unbound root or pending Session Areas neutral', () => {
  expect(activePageSessionBinding(undefined, workspaces, true, 'ungrouped')).toBeUndefined()
  expect(activePageSessionBinding({ ...group, tabs: [] }, workspaces, true, 'ungrouped')).toBeUndefined()
  expect(activePageSessionBinding({ ...group, tabs: [{ ...group.tabs[0]!, editorScope: 'root' }] }, workspaces, true, 'ungrouped')).toBeUndefined()
  expect(activePageSessionBinding({ ...group, tabs: [{ id: 'page', editorId: 'test', editorScope: 'session', pendingBinding: 'binding-1', lastKnownTitle: 'Page', state: {} }] }, workspaces, true, 'ungrouped')).toBeUndefined()
})

it('retains an unavailable binding instead of borrowing the current project', () => {
  const binding = { workspaceId: 'deleted-project', sessionId: 'deleted-session' }
  expect(activePageSessionBinding({ ...group, tabs: [{ ...group.tabs[0]!, binding }] }, workspaces, true, 'ungrouped')).toBe(binding)
})

it('uses the active page binding and keeps pending pages neutral despite an old Area binding', () => {
  const areaBinding = { workspaceId: 'project', sessionId: 'two' }
  expect(activePageSessionBinding({ ...group, areaBinding }, workspaces, true, 'ungrouped')).toEqual({ workspaceId: 'project', sessionId: 'one' })
  expect(activePageSessionBinding({ ...group, areaBinding, tabs: [{ id: 'page', editorId: 'workbench.conversation', editorScope: 'session', pendingBinding: 'binding-1', lastKnownTitle: 'Pending', state: {} }] }, workspaces, true, 'ungrouped')).toBeUndefined()
})
