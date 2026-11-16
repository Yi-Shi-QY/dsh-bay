import type { WorkbenchHostAdapterV1 } from './module-contract.ts'
import type { WorkbenchModuleInstallAdapterV1 } from './install-coordinator.ts'
import type { WorkbenchModuleIdentityV1 } from './module-catalog.ts'

export interface WorkbenchHostModuleAdapterOptionsV1 {
  /** Synchronous installed identity projection supplied by the Host receipt cache. */
  installed(moduleId: string): { version: string; artifactDigest: string } | undefined
  /** Resolves bytes from the Host-owned artifact store; Core never reads paths. */
  artifact(identity: WorkbenchModuleIdentityV1): Promise<Uint8Array>
}

/**
 * Bridge the public Host adapter to Core's transaction engine.  This is the
 * only translation point between `stageModule/installModule` (Host naming)
 * and the coordinator; modules and Manager never get this authority.
 */
export function createWorkbenchHostModuleInstallAdapter(
  host: WorkbenchHostAdapterV1,
  options: WorkbenchHostModuleAdapterOptionsV1,
): WorkbenchModuleInstallAdapterV1 {
  return {
    capabilities: () => host.capabilities(),
    installed: options.installed,
    stage: async module => {
      const artifact = await options.artifact(module)
      await host.stageModule({ ...module, artifact })
    },
    install: module => host.installModule(module),
    verify: module => host.verifyModule(module),
    activate: moduleId => host.activateModule(moduleId),
    rollback: moduleId => host.rollbackModule(moduleId),
  }
}
