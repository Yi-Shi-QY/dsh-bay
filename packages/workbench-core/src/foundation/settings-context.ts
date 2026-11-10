import type { SettingsScopeSnapshot } from '../client/workbench-settings-contracts.ts'
import type { WorkbenchWindowControllerV1 } from '../client/workbench-window-controller.ts'
import type { WorkbenchSettingsV4 } from './persistence.ts'

export type WorkbenchSettingsContextV1 = { mode: 'desktop' } | { mode: 'browser-workbench'; workbenchId: string }
export interface WorkbenchSettingsOpenOptionsV1 {
  section?: 'workbenches' | 'pages' | 'interactions' | 'sharing'
  workbenchId?: string
  shareMode?: 'import' | 'export' | 'history'
}
export const DESKTOP_SETTINGS_CONTEXT: WorkbenchSettingsContextV1 = Object.freeze({ mode: 'desktop' })

export function settingsTargetWritable(context: WorkbenchSettingsContextV1, id: string, windows?: WorkbenchWindowControllerV1): boolean {
  if (context.mode === 'browser-workbench') return context.workbenchId === id
  const snapshot = windows?.getSnapshot()
  return !(snapshot?.requests ?? (snapshot?.request ? [snapshot.request] : [])).some(row => row.workbenchId === id
    && (['requested', 'redeemed', 'ready', 'reclaiming'].includes(row.status)
      || row.status === 'failed' && ['browser-view-heartbeat-timeout', 'browser-view-reclaim-timeout'].includes(row.code ?? '')))
}

/** Project before rendering. This is a product scope, not an account permission boundary. */
export function scopeSettingsSnapshot(snapshot: SettingsScopeSnapshot<WorkbenchSettingsV4>, context: WorkbenchSettingsContextV1): SettingsScopeSnapshot<WorkbenchSettingsV4> {
  if (context.mode === 'desktop' || snapshot.value === undefined) return snapshot
  const record = snapshot.value.workbenches[context.workbenchId]
  const backgroundAi = record?.backgroundAi ?? snapshot.value.backgroundAi
  return { status: snapshot.status, revision: snapshot.revision, writable: snapshot.writable, mode: snapshot.mode,
    value: { version: 4, activeWorkbenchId: context.workbenchId, openWorkbenchIds: record ? [context.workbenchId] : [],
      workbenches: record ? { [context.workbenchId]: record } : {}, invalidWorkbenches: {}, layoutTemplates: {}, sessionMarkers: {},
      ...(snapshot.value.globalHiddenEditorIds === undefined ? {} : { globalHiddenEditorIds: [...snapshot.value.globalHiddenEditorIds] }),
      ...(snapshot.value.editorMenu === undefined ? {} : { editorMenu: structuredClone(snapshot.value.editorMenu) }),
      ...(snapshot.value.extensionConsents === undefined ? {} : { extensionConsents: structuredClone(snapshot.value.extensionConsents) }),
      ...(backgroundAi ? { backgroundAi } : {}) } }
}

export interface SettingsViewMemory {
  section: NonNullable<WorkbenchSettingsOpenOptionsV1['section']>
  searches: Record<string, string>
  filters: Record<string, string>
  scroll: Record<string, number>
  selectedId?: string
}
// Module lifetime is the window lifetime. Never serialized into settings/layouts.
const memories = new Map<string, SettingsViewMemory>()
export function settingsViewMemory(context: WorkbenchSettingsContextV1): SettingsViewMemory {
  const key = context.mode === 'desktop' ? 'desktop' : context.workbenchId
  let memory = memories.get(key)
  if (!memory) { memory = { section: 'workbenches', searches: {}, filters: {}, scroll: {} }; memories.set(key, memory) }
  return memory
}
