import type { WorkbenchSettingsV4 } from '../src/foundation/persistence.ts'
import type { WorkbenchDocumentV3 } from '../src/foundation/document-v3.ts'
import type { SettingsScopeSnapshot, SettingsScopePathOperation } from '../src/client/workbench-settings-contracts.ts'
export const documentFixture = (): WorkbenchDocumentV3 => ({ version: 3, activeAreaId: 'area-a', root: { kind: 'area', areaId: 'area-a', activeModuleInstanceId: 'page-b',
  moduleHistory: [{ moduleInstanceId: 'page-a', editorId: 'example.notes', editorScope: 'root', lastKnownTitle: '笔记', state: {} }, { moduleInstanceId: 'page-b', editorId: 'workbench.conversation', editorScope: 'session', binding: { sessionId: 'private-session' }, bindingGeneration: 4, lastKnownTitle: '私密对话', state: {} }] } })
export const settingsFixture = (): WorkbenchSettingsV4 => ({ version: 4, activeWorkbenchId: 'a', openWorkbenchIds: ['a'], globalHiddenEditorIds: [], workbenches: Object.fromEntries(['a', 'b'].map(workbenchId => [workbenchId, { workbenchId, name: workbenchId.toUpperCase(), description: '', document: documentFixture(), createdAt: 1, updatedAt: 2 }])), invalidWorkbenches: {}, layoutTemplates: {}, sessionMarkers: {} })
export function mutableSettings(value = settingsFixture()) {
  let snapshot: SettingsScopeSnapshot<WorkbenchSettingsV4> = { status: 'ready', writable: true, revision: 1, value, mode: 'host' }
  const listeners = new Set<() => void>()
  const writes: SettingsScopePathOperation[] = []
  const source = { getSnapshot: () => snapshot, subscribe(listener: () => void) { listeners.add(listener); return () => listeners.delete(listener) }, set: async () => {}, unset: async () => {}, async patch(op: SettingsScopePathOperation) {
    if (op.expectedRevision !== undefined && op.expectedRevision !== snapshot.revision) return { status: 'conflict' as const, expectedRevision: op.expectedRevision, actualRevision: snapshot.revision }
    writes.push(op)
    const next: any = structuredClone(snapshot.value)
    let parent = next
    for (const segment of op.path.slice(0, -1)) parent = parent[segment] ??= {}
    if (!op.path.length) {
      if (op.operation === 'set') snapshot = { ...snapshot, value: structuredClone(op.value) as WorkbenchSettingsV4 }
      else snapshot = { ...snapshot, value: undefined }
    } else if (op.operation === 'set') parent[op.path.at(-1)!] = structuredClone(op.value)
    else delete parent[op.path.at(-1)!]
    snapshot = { ...snapshot, value: op.path.length ? next : snapshot.value, revision: (snapshot.revision ?? 0) + 1 }
    listeners.forEach(listener => listener())
    return { status: 'committed' as const, revision: snapshot.revision! }
  } }
  return { source, writes, listeners }
}
