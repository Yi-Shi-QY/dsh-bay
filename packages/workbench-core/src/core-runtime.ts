import { createWorkbenchModeController, type WorkbenchModeControllerOptionsV1, type WorkbenchModeControllerV1 } from './mode-controller.ts'
import { createWorkbenchSurfaceController, type WorkbenchSurfaceControllerV1 } from './surface-controller.ts'
import type { WorkbenchModuleIdentityV1, WorkbenchModuleSourceIdentityV1 } from './module-catalog.ts'

export const WORKBENCH_CORE_RUNTIME_SERVICE_NAME = 'workbenchCoreRuntime'

export type WorkbenchCoreRuntimeStateV1 = 'core-only' | 'modules-ready' | 'degraded'

export interface WorkbenchCoreRuntimeSnapshotV1 {
  readonly state: WorkbenchCoreRuntimeStateV1
  readonly core: WorkbenchModuleSourceIdentityV1
  readonly registeredModules: readonly WorkbenchModuleIdentityV1[]
  readonly activeModules: readonly string[]
  readonly canEnterWorkbench: boolean
  readonly emptyState: 'no-inner-page-modules' | undefined
  readonly reason?: string
}

export interface WorkbenchCoreRuntimeV1 {
  readonly mode: WorkbenchModeControllerV1
  readonly surface: WorkbenchSurfaceControllerV1
  getSnapshot(): WorkbenchCoreRuntimeSnapshotV1
  subscribe(listener: () => void): () => void
  registerModule(identity: WorkbenchModuleIdentityV1): void
  setModuleState(moduleId: string, state: 'registered' | 'active' | 'failed', reason?: string): void
  dispose(): void
}

export interface WorkbenchCoreRuntimeOptionsV1 {
  readonly core: WorkbenchModuleSourceIdentityV1
  readonly resolveWorkbench?: WorkbenchModeControllerOptionsV1['resolveWorkbench']
  readonly flush?: WorkbenchModeControllerOptionsV1['flush']
}

/**
 * Host-owned Core state. Core includes the DSH-native Conversation surfaces;
 * optional Modules may later register their immutable identities through this
 * narrow seam, while the runtime never changes DSH's current Session.
 */
export function createWorkbenchCoreRuntime(options: WorkbenchCoreRuntimeOptionsV1): WorkbenchCoreRuntimeV1 {
  const mode = createWorkbenchModeController({
    ...(options.resolveWorkbench === undefined ? {} : { resolveWorkbench: options.resolveWorkbench }),
    ...(options.flush === undefined ? {} : { flush: options.flush }),
  })
  const surface = createWorkbenchSurfaceController()
  const modules = new Map<string, { identity: WorkbenchModuleIdentityV1; state: 'registered' | 'active' | 'failed'; reason?: string }>()
  const listeners = new Set<() => void>()
  let disposed = false
  const publish = (): void => { if (!disposed) for (const listener of [...listeners]) listener() }
  const snapshot = (): WorkbenchCoreRuntimeSnapshotV1 => {
    const rows = [...modules.values()].sort((left, right) => left.identity.moduleId.localeCompare(right.identity.moduleId))
    const failed = rows.find(row => row.state === 'failed')
    const state: WorkbenchCoreRuntimeStateV1 = failed === undefined
      // The shell and the first native editors are embedded in Core.
      ? 'modules-ready'
      : 'degraded'
    return {
      state,
      core: options.core,
      registeredModules: rows.map(row => row.identity),
      activeModules: rows.filter(row => row.state === 'active').map(row => row.identity.moduleId),
      // Core owns the mode/surface shell.  An empty module set is a valid
      // Workbench state; only a degraded Core blocks entry.
      canEnterWorkbench: state !== 'degraded',
      emptyState: undefined,
      ...(failed?.reason === undefined ? {} : { reason: failed.reason }),
    }
  }
  return {
    mode,
    surface,
    getSnapshot: snapshot,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener) } },
    registerModule(identity) {
      const existing = modules.get(identity.moduleId)
      if (existing !== undefined) {
        if (existing.identity.version !== identity.version || existing.identity.artifactDigest.toLowerCase() !== identity.artifactDigest.toLowerCase()) {
          throw new Error(`Workbench Core module identity conflict: ${identity.moduleId}`)
        }
        return
      }
      modules.set(identity.moduleId, { identity, state: 'registered' })
      publish()
    },
    setModuleState(moduleId, state, reason) {
      const row = modules.get(moduleId)
      if (row === undefined) throw new Error(`Unknown Workbench Core module: ${moduleId}`)
      row.state = state
      if (reason === undefined) delete row.reason
      else row.reason = reason
      publish()
    },
    dispose() { disposed = true; listeners.clear() },
  }
}
