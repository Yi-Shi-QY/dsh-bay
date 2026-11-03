import { describe, expect, it, vi } from 'vitest'
import { createWorkbenchModuleLoader, supportsWorkbenchDynamicModuleLoading, WORKBENCH_DYNAMIC_MODULE_LOADER_CAPABILITY } from '../src/module-loader.ts'
import { createWorkbenchModuleRegistry } from '../src/module-registry.ts'
import type { WorkbenchModuleContextV1 } from '../src/module-contract.ts'

const digest = (c: string): string => c.repeat(64)
function context(): WorkbenchModuleContextV1 {
  return { mode: { getSnapshot: () => ({}), subscribe: () => () => {} }, surface: { getSnapshot: () => ({}), subscribe: () => () => {} }, areas: { claim: () => ({}), release: () => {} }, sessions: { place: async () => ({}), bindExisting: async () => ({}), release: async () => {} }, editors: { register: () => () => {}, catalog: () => [] }, persistence: { getSnapshot: () => ({}), update: async () => {}, subscribe: () => () => {} }, settings: { getDirectory: () => '' }, host: { capabilities: () => [], invoke: async () => ({}), stageModule: async () => {}, installModule: async () => {}, activateModule: async () => {}, rollbackModule: async () => {}, createRecipientBinding: async () => ({ bindingId: 'x' }), readReceipts: async () => [] }, diagnostics: { report: () => {}, list: () => [] } }
}

describe('Workbench dynamic Module Loader', () => {
  it('only reports hot-load support when the Host advertises the capability', () => {
    expect(supportsWorkbenchDynamicModuleLoading([])).toBe(false)
    expect(supportsWorkbenchDynamicModuleLoading([WORKBENCH_DYNAMIC_MODULE_LOADER_CAPABILITY])).toBe(true)
  })

  it('refreshes, loads and registers a client Module, then unloads it', async () => {
    const refresh = vi.fn(async () => undefined)
    const unload = vi.fn(async () => undefined)
    const module = { manifest: { moduleId: 'workbench.dynamic', version: '1.0.0', coreCompatibility: '*', artifactDigest: digest('d'), provides: { editorIds: [], surfaces: [] }, requires: { capabilities: [], modules: [] }, activation: { mode: 'workbench' as const, scope: 'root' as const } }, register: () => {}, activate: async () => {}, deactivate: async () => {}, migrate: async () => ({ status: 'unchanged' as const }) }
    const host = { refreshModuleLoader: refresh, loadModule: vi.fn(async () => module), unloadModule: unload }
    const registry = createWorkbenchModuleRegistry({ context: context() })
    const loader = createWorkbenchModuleLoader(host, registry)
    await loader.refresh(); await loader.load('workbench.dynamic'); await loader.load('workbench.dynamic')
    expect(registry.get('workbench.dynamic')).toBe(module)
    await loader.unload('workbench.dynamic'); await loader.unload('workbench.dynamic')
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(host.loadModule).toHaveBeenCalledTimes(1)
    expect(unload).toHaveBeenCalledWith('workbench.dynamic')
    expect(unload).toHaveBeenCalledTimes(1)
  })

  it('unloads the Host entry when Registry registration rejects an identity conflict', async () => {
    const existing = { manifest: { moduleId: 'workbench.dynamic', version: '1.0.0', coreCompatibility: '*', artifactDigest: digest('e'), provides: { editorIds: [], surfaces: [] }, requires: { capabilities: [], modules: [] }, activation: { mode: 'workbench' as const, scope: 'root' as const } }, register: () => {}, activate: async () => {}, deactivate: async () => {}, migrate: async () => ({ status: 'unchanged' as const }) }
    const conflicting = { ...existing, manifest: { ...existing.manifest, artifactDigest: digest('f') } }
    const unload = vi.fn(async () => undefined)
    const registry = createWorkbenchModuleRegistry({ context: context() })
    registry.register(existing)
    const loader = createWorkbenchModuleLoader({ refreshModuleLoader: async () => {}, loadModule: async () => conflicting, unloadModule: unload }, registry)
    await expect(loader.load('workbench.dynamic')).rejects.toThrow('identity conflict')
    expect(unload).toHaveBeenCalledOnce()
  })

  it('rejects a Host module whose exact version or digest differs from the requested identity', async () => {
    const module = { manifest: { moduleId: 'workbench.dynamic', version: '1.0.0', coreCompatibility: '*', artifactDigest: digest('d'), provides: { editorIds: [], surfaces: [] }, requires: { capabilities: [], modules: [] }, activation: { mode: 'workbench' as const, scope: 'root' as const } }, register: () => {}, activate: async () => {}, deactivate: async () => {}, migrate: async () => ({ status: 'unchanged' as const }) }
    const unload = vi.fn(async () => undefined)
    const registry = createWorkbenchModuleRegistry({ context: context() })
    const loader = createWorkbenchModuleLoader({
      refreshModuleLoader: async () => {},
      loadModule: vi.fn(async () => module),
      unloadModule: unload,
    }, registry)
    await expect(loader.load('workbench.dynamic', { version: '1.0.1', artifactDigest: digest('d') }))
      .rejects.toThrow('exact identity mismatch')
    expect(unload).toHaveBeenCalledOnce()
    expect(registry.get('workbench.dynamic')).toBeUndefined()
  })
})
