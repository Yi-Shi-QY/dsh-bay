import type { WorkbenchModuleV1 } from './module-contract.ts'
import type { WorkbenchModuleRegistryV1 } from './module-registry.ts'
import type { WorkbenchModuleIdentityV1 } from './module-catalog.ts'

/** Runtime capability required for loading a newly installed Module without a DSH restart. */
export const WORKBENCH_DYNAMIC_MODULE_LOADER_CAPABILITY = 'modules.dynamic-loader'

/**
 * Return whether a Host advertises the seam required to load a newly
 * installed Module in the current DSH process.  Installing into a Profile
 * alone does not rebuild the Loader graph, so the install adapter must not
 * be mistaken for hot-load support.
 */
export function supportsWorkbenchDynamicModuleLoading(
  capabilities: readonly string[],
): boolean {
  return capabilities.includes(WORKBENCH_DYNAMIC_MODULE_LOADER_CAPABILITY)
}

export interface WorkbenchDynamicModuleHostAdapterV1 {
  refreshModuleLoader(): Promise<void>
  /** Load the exact package identity requested by the transaction. */
  loadModule(moduleId: string, expected?: Pick<WorkbenchModuleIdentityV1, 'version' | 'artifactDigest'>): Promise<WorkbenchModuleV1>
  unloadModule(moduleId: string): Promise<void>
}

export interface WorkbenchModuleLoaderV1 {
  refresh(): Promise<void>
  load(moduleId: string, expected?: Pick<WorkbenchModuleIdentityV1, 'version' | 'artifactDigest'>): Promise<void>
  unload(moduleId: string): Promise<void>
}

/**
 * Core-owned bridge from the Host's dynamic import seam to Module Registry.
 * The host owns package resolution and code execution; Core owns registration
 * and lifecycle.  Calling `load` twice for the same identity is idempotent.
 */
export function createWorkbenchModuleLoader(
  host: WorkbenchDynamicModuleHostAdapterV1,
  registry: WorkbenchModuleRegistryV1,
): WorkbenchModuleLoaderV1 {
  const loaded = new Set<string>()
  return {
    refresh: () => host.refreshModuleLoader(),
    async load(moduleId, expected) {
      if (loaded.has(moduleId)) return
      const module = await host.loadModule(moduleId, expected)
      try {
        if (module.manifest.moduleId !== moduleId) {
          throw new Error(`Workbench dynamic Module identity mismatch: expected ${moduleId}, received ${module.manifest.moduleId}`)
        }
        if (expected !== undefined && (module.manifest.version !== expected.version
          || module.manifest.artifactDigest.toLowerCase() !== expected.artifactDigest.toLowerCase())) {
          throw new Error(`Workbench dynamic Module exact identity mismatch: ${moduleId}`)
        }
        registry.register(module)
        loaded.add(moduleId)
      } catch (error) {
        // The Host has already evaluated the package by this point.  A
        // registry identity conflict or manifest rejection must not strand a
        // live Host entry outside Core's lifecycle journal.
        await host.unloadModule(moduleId).catch((cleanupError: unknown) => {
          throw new AggregateError([error, cleanupError], `Workbench Module load rollback failed: ${moduleId}`)
        })
        throw error
      }
    },
    async unload(moduleId) {
      if (!loaded.has(moduleId)) return
      await registry.deactivate(moduleId, 'shutdown')
      await host.unloadModule(moduleId)
      loaded.delete(moduleId)
    },
  }
}
