import type SettingsProvider from '@deepseek-ai/dsh-settings'
import { SettingsConflictError } from '@deepseek-ai/dsh-settings'
import type { WorkbenchOfflineImportSettings } from './host-offline-import.ts'

/** Incremental delivery through the original Settings service, including default-only records. */
export function createWorkbenchOfflineSettings(settings: SettingsProvider): WorkbenchOfflineImportSettings {
  const ns = 'workbench-layout'
  return {
    snapshot: () => {
      const descriptor = settings.describe().find(row => row.ns === ns)
      const value = descriptor?.value as { version?: number; workbenches?: Record<string, unknown>; invalidWorkbenches?: Record<string, unknown> } | undefined
      if (descriptor === undefined || value?.version !== 4 || value.workbenches === undefined || value.invalidWorkbenches === undefined) throw new Error('Workbench Settings must be ready before offline import')
      return { revision: descriptor.revision, records: value.workbenches, invalidIds: Object.keys(value.invalidWorkbenches) }
    },
    add: (record, revision) => {
      const descriptor = settings.describe().find(row => row.ns === ns)
      if (descriptor === undefined) throw new Error('Workbench Settings are unavailable')
      const visible = descriptor.value as { workbenches: Record<string, unknown> }
      const stored = descriptor.user as { workbenches?: Record<string, unknown> } | undefined
      // DSH dictionary defaults disappear when the first dictionary entry
      // is persisted. Materialize visible default rows in the same CAS.
      const defaults = Object.entries(visible.workbenches).filter(([id]) => !Object.hasOwn(stored?.workbenches ?? {}, id))
        .map(([id, value]) => ({ op: 'set' as const, path: ['workbenches', id], value }))
      return settings.mutate(ns, [...defaults, { op: 'set', path: ['workbenches', record.workbenchId], value: record }], revision)
    },
    conflict: error => error instanceof SettingsConflictError,
  }
}
