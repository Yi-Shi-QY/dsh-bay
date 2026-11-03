import type { ClientRemote, SettingsNamespaceView, SettingsPathOpView } from '@deepseek-ai/dsh-api-remotes/client'

/**
 * Small compatibility face shared by DSH 0.1.6 and 0.1.7 settings clients.
 *
 * DSH 0.1.6 exposed this as `settingsScope`; 0.1.7 exposes the same
 * revision-aware document through `configForms.get()`.  Workbench keeps its
 * own structural type so the persistence and Frame layers do not depend on
 * either upstream service name.
 */
export interface SettingsScopeSnapshot<T> {
  status: 'loading' | 'ready' | 'unavailable'
  value: T | undefined
  revision: number | undefined
  writable: boolean
  mode: 'host' | 'memory'
  base?: unknown
  user?: unknown
}

export interface SettingsScope<T> {
  getSnapshot(): SettingsScopeSnapshot<T>
  subscribe(listener: () => void): () => void
  set(field: string, value: unknown): Promise<unknown>
  unset(field: string): Promise<unknown>
  /** Native 0.1.7 ConfigForm mutation, when available. */
  mutate?(ops: readonly SettingsPathOpView[], expectedRevision?: number): Promise<boolean>
}

export type SettingsScopePathOperation =
  | { operation: 'set'; path: readonly string[]; value: unknown; expectedRevision?: number }
  | { operation: 'unset'; path: readonly string[]; expectedRevision?: number }

export type SettingsScopePatchResult =
  | { status: 'committed'; revision: number }
  | { status: 'conflict'; expectedRevision: number | undefined; actualRevision: number | undefined }
  | { status: 'unavailable' }

export type WorkbenchSettingsScope<T> = Pick<SettingsScope<T>, 'getSnapshot' | 'subscribe' | 'set' | 'unset'> & {
  patch(operation: SettingsScopePathOperation): Promise<SettingsScopePatchResult>
}

/** Uses the public atomic Settings RPC; never emulates a root update with field writes. */
export function createWorkbenchSettingsScope<T>(
  source: SettingsScope<T>,
  remote: Pick<ClientRemote, 'settings'>,
  acceptView: (view: SettingsNamespaceView) => void,
): WorkbenchSettingsScope<T> {
  let tail: Promise<unknown> = Promise.resolve()
  const patch = (operation: SettingsScopePathOperation): Promise<SettingsScopePatchResult> => {
    const copy = structuredClone(operation)
    const execute = async (): Promise<SettingsScopePatchResult> => {
      const snapshot = source.getSnapshot()
      if (snapshot.status !== 'ready' || !snapshot.writable || snapshot.mode !== 'host' || snapshot.revision === undefined) return { status: 'unavailable' }
      const expectedRevision = copy.expectedRevision ?? snapshot.revision
      if (expectedRevision !== snapshot.revision) return { status: 'conflict', expectedRevision, actualRevision: snapshot.revision }
      const ops: SettingsPathOpView[] = [copy.operation === 'set'
          ? { op: 'set', path: [...copy.path], value: copy.value as Extract<SettingsPathOpView, { op: 'set' }>['value'] }
          : { op: 'unset', path: [...copy.path] }]
      if (source.mutate !== undefined) {
        const accepted = await source.mutate(ops, expectedRevision)
        const nextRevision = source.getSnapshot().revision
        if (!accepted) return {
          status: 'conflict', expectedRevision,
          actualRevision: nextRevision,
        }
        return { status: 'committed', revision: nextRevision ?? expectedRevision }
      }
      const response = await remote.settings.mutate('workbench-layout', ops, expectedRevision)
      if (!response.ok) {
        const error = response.error
        if (error.code === 'settings/conflict') {
          const details = error.details as { expected?: number; actual?: number } | undefined
          return { status: 'conflict', expectedRevision: details?.expected ?? expectedRevision, actualRevision: details?.actual }
        }
        return { status: 'unavailable' }
      }
      acceptView(response.value)
      return { status: 'committed', revision: response.value.revision }
    }
    const run = tail.then(execute)
    tail = run.catch(() => undefined)
    return run
  }
  return {
    getSnapshot: () => source.getSnapshot(), subscribe: listener => source.subscribe(listener),
    set: async (field, value) => { await patch({ operation: 'set', path: [field], value }) },
    unset: async field => { await patch({ operation: 'unset', path: [field] }) },
    patch,
  }
}

export function patchWorkbenchSettings<T>(scope: WorkbenchSettingsScope<T>, operation: SettingsScopePathOperation, _options?: { requireAtomic?: boolean }): Promise<SettingsScopePatchResult> {
  return scope.patch(operation)
}
