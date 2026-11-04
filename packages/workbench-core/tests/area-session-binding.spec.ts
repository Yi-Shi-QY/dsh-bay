import { expect, it } from 'vitest'
import { areaSessionBinding } from '../src/foundation/area-session-binding.ts'
import type { GroupNode } from '../src/foundation/model.ts'

const workspaces = [{ workspaceId: 'project', sessionIds: ['one', 'two'] }]
const group: GroupNode = { kind: 'group', id: 'area', activeTabId: 'page', tabs: [
  { id: 'page', editorId: 'test', editorScope: 'session', sessionId: 'one', lastKnownTitle: 'Page', state: {} },
] }

it('keeps explicit Area identity across independent and pending inner pages', () => {
  const areaBinding = { workspaceId: 'project', sessionId: 'two' }
  expect(areaSessionBinding({ ...group, areaBinding, tabs: [{ ...group.tabs[0]!, editorScope: 'root' }] }, workspaces, true, 'ungrouped')).toBe(areaBinding)
})

it('resolves legacy Session-only tabs exactly like the header', () => {
  expect(areaSessionBinding(group, workspaces, true, 'ungrouped')).toEqual({ workspaceId: 'project', sessionId: 'one' })
  expect(areaSessionBinding(group, workspaces, false, 'workspace:legacy')).toEqual({ workspaceId: 'legacy', sessionId: 'one' })
})

it('keeps empty and unbound root or pending Session Areas neutral', () => {
  expect(areaSessionBinding(undefined, workspaces, true, 'ungrouped')).toBeUndefined()
  expect(areaSessionBinding({ ...group, tabs: [] }, workspaces, true, 'ungrouped')).toBeUndefined()
  expect(areaSessionBinding({ ...group, tabs: [{ ...group.tabs[0]!, editorScope: 'root' }] }, workspaces, true, 'ungrouped')).toBeUndefined()
  expect(areaSessionBinding({ ...group, tabs: [{ id: 'page', editorId: 'test', editorScope: 'session', pendingBinding: 'binding-1', lastKnownTitle: 'Page', state: {} }] }, workspaces, true, 'ungrouped')).toBeUndefined()
})

it('retains an unavailable binding instead of borrowing the current project', () => {
  const binding = { workspaceId: 'deleted-project', sessionId: 'deleted-session' }
  expect(areaSessionBinding({ ...group, tabs: [{ ...group.tabs[0]!, binding }] }, workspaces, true, 'ungrouped')).toBe(binding)
})
