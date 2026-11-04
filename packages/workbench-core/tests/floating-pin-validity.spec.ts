import { expect, it } from 'vitest'
import { createFloatingEditorTab, prepareFloatingTabForArea } from '../src/foundation/editor-selection.ts'
import { addTab, createSessionTab, group, mergeGroup, type WorkbenchLayoutDocument } from '../src/foundation/model.ts'
import { migrateDocumentV2ToV3, validateWorkbenchDocumentV3 } from '../src/foundation/document-v3.ts'

it.each([false, true])('preserves a readable document when merging pending and bound Areas (reverse=%s)', reverse => {
  const binding = { sessionId: 'session', workspaceId: 'workspace' }
  const pending = { id: 'pending', editorId: 'workbench.conversation', editorScope: 'session' as const,
    pendingBinding: 'binding-1', lastKnownTitle: 'Conversation', state: { keep: true } }
  const layout: WorkbenchLayoutDocument = { version: 2, activeGroupId: 'pending-area', root: { kind: 'split', id: 'split', axis: 'horizontal', ratio: .5,
    first: { ...group('bound-area', [createSessionTab('bound', 'workbench.conversation', binding, 'Conversation')]), areaBinding: binding },
    second: group('pending-area', [pending]) } }
  expect(validateWorkbenchDocumentV3(migrateDocumentV2ToV3(layout))).toBeDefined()
  const merged = mergeGroup(layout, reverse ? 'bound-area' : 'pending-area', reverse ? 'pending-area' : 'bound-area')
  expect(validateWorkbenchDocumentV3(migrateDocumentV2ToV3(merged))).toBeDefined()
  expect(merged.root.kind === 'group' && merged.root.tabs.find(t => t.id === 'pending')).toMatchObject({ id: 'pending', binding, state: { keep: true } })
})

it('translates floating pending IDs before durable placement without changing the source', () => {
  const temporary = createFloatingEditorTab({ id: 'workbench.conversation', label: 'Conversation', scope: 'session' }, 'floating-one')
  const layout: WorkbenchLayoutDocument = { version: 2, root: group('empty'), activeGroupId: 'empty' }
  expect(validateWorkbenchDocumentV3(migrateDocumentV2ToV3(addTab(layout, 'empty', temporary)))).toBeUndefined()
  const placed = prepareFloatingTabForArea(temporary, group('empty'), [])
  expect(placed.pendingBinding).toBe('binding-1')
  expect(temporary.pendingBinding).toBe('floating-one')
  expect(validateWorkbenchDocumentV3(migrateDocumentV2ToV3(addTab(layout, 'empty', placed)))).toBeDefined()
  const another = prepareFloatingTabForArea({ ...temporary, id: 'another' }, group('other'), [placed])
  expect(another.pendingBinding).toBe('binding-2')
  const bound = prepareFloatingTabForArea(temporary, { ...group('bound'), areaBinding: { sessionId: 'session' } }, [])
  expect(bound.pendingBinding).toBeUndefined(); expect(bound.sessionId).toBe('session')
})
