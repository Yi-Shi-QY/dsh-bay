import { describe, expect, it, vi } from 'vitest'
import { createWorkbenchExtensionRegistryV1 } from '../src/client/workbench-extension-registry.ts'
import type { WorkbenchDshExtensionInventoryV1 } from '../src/workbench-extension-access.ts'
import type { WorkbenchEditorCatalog, WorkbenchEditorCatalogRow } from '../src/foundation/catalog.ts'
import { WorkbenchExtensionInventoryReadError } from '../src/workbench-extension-access.ts'

describe('Workbench extension registry', () => {
  it('does not let an older concurrent inventory refresh overwrite the newest result', async () => {
    const page: WorkbenchEditorCatalogRow = {
      id: 'test.pet', label: 'Pet', scope: 'root', pluginId: 'pet-entry',
      declaration: {
        editorId: 'test.pet', scope: 'root', label: 'Pet', requiredBinding: 'none',
        state: { schemaVersion: 1, maxBytes: 100, restore: 'if-valid', share: 'forbidden' },
        runtime: { background: 'pause', collapsed: 'dispose', reacquire: 'on-visible' },
      },
      extension: { schemaVersion: 1, moduleId: 'test.pet', apiVersion: 1, editorIds: ['test.pet'],
        coreCompatibility: '1.0.0', dshGeneration: '0.2.1-rc.2' },
    }
    const catalog: WorkbenchEditorCatalog = { getSnapshot: () => [page], subscribe: () => () => {} }
    const inventory = (enabled: boolean): WorkbenchDshExtensionInventoryV1 => ({
      plugins: [{ entryId: 'pet-entry', moduleName: '@test/pet', enabled, fiberPhase: enabled ? 'active' : 'stopped' }],
      bundles: [{ name: '@test/pet', version: '1.0.0', installed: true, enabled,
        rows: [{ rowId: 'pet', moduleName: '@test/pet', entryId: 'pet-entry' }] }],
    })
    let resolveFirst: ((value: WorkbenchDshExtensionInventoryV1) => void) | undefined
    let call = 0
    const registry = createWorkbenchExtensionRegistryV1({
      catalog,
      settings: { getSnapshot: () => ({ value: undefined }), subscribe: () => () => {} },
      coreEditorIds: [], coreVersion: '1.0.0', dshGeneration: '0.2.1-rc.2',
      readDshInventory: () => {
        call += 1
        if (call === 1) return new Promise(resolve => { resolveFirst = resolve })
        return Promise.resolve(inventory(false))
      },
    })
    const first = registry.refresh()
    const second = registry.refresh()
    await second
    expect(registry.getSnapshot().extensions[0]?.availability).toBe('dsh-disabled')
    resolveFirst?.(inventory(true))
    await first
    expect(registry.getSnapshot().extensions[0]?.availability).toBe('dsh-disabled')
    registry.dispose()
  })

  it('ignores a late inventory result after dispose', async () => {
    const page: WorkbenchEditorCatalogRow = {
      id: 'test.pet', label: 'Pet', scope: 'root', pluginId: 'pet-entry',
      extension: { schemaVersion: 1, moduleId: 'test.pet', apiVersion: 1, editorIds: ['test.pet'],
        coreCompatibility: '1.0.0', dshGeneration: '0.2.1-rc.2' },
    }
    let resolveInventory: ((value: WorkbenchDshExtensionInventoryV1) => void) | undefined
    const registry = createWorkbenchExtensionRegistryV1({
      catalog: { getSnapshot: () => [page], subscribe: () => () => {} },
      settings: { getSnapshot: () => ({ value: undefined }), subscribe: () => () => {} },
      coreEditorIds: [], coreVersion: '1.0.0', dshGeneration: '0.2.1-rc.2',
      readDshInventory: () => new Promise(resolve => { resolveInventory = resolve }),
    })
    const listener = vi.fn()
    registry.subscribe(listener)
    const refresh = registry.refresh()
    registry.dispose()
    resolveInventory?.({ plugins: [], bundles: [] })
    await refresh
    expect(listener).not.toHaveBeenCalled()
  })

  it('filters the live catalog until a persisted consent is added, then reacts to revoke', async () => {
    const page: WorkbenchEditorCatalogRow = {
      id: 'test.pet', label: 'Pet', scope: 'root', pluginId: 'pet-entry',
      declaration: {
        editorId: 'test.pet', scope: 'root', label: 'Pet', requiredBinding: 'none',
        state: { schemaVersion: 1, maxBytes: 100, restore: 'if-valid', share: 'forbidden' },
        runtime: { background: 'pause', collapsed: 'dispose', reacquire: 'on-visible' },
      },
      extension: { schemaVersion: 1, moduleId: 'test.pet', apiVersion: 1, editorIds: ['test.pet'],
        coreCompatibility: '1.0.0', dshGeneration: '0.2.1-rc.2' },
    }
    const core: WorkbenchEditorCatalogRow = { id: 'core.page', label: 'Core', scope: 'root' }
    const rows = [core, page]
    const source: WorkbenchEditorCatalog = { getSnapshot: () => rows, subscribe: () => () => {} }
    let settingsListeners: Array<() => void> = []
    let settingsValue: Record<string, never> | { extensionConsents: Record<string, { packageName: string; moduleId: string; apiVersion: 1; editorIds: readonly string[]; contractFingerprint: string; allowedAt: number }> } = {}
    const settings = {
      getSnapshot: () => ({ value: settingsValue as never }),
      subscribe(listener: () => void) { settingsListeners.push(listener); return () => { settingsListeners = settingsListeners.filter(item => item !== listener) } },
    }
    const inventory: WorkbenchDshExtensionInventoryV1 = {
      plugins: [{ entryId: 'pet-entry', moduleName: '@test/pet', enabled: true, fiberPhase: 'active' }],
      bundles: [{ name: '@test/pet', version: '1.0.0', installed: true, enabled: true,
        rows: [{ rowId: 'pet', moduleName: '@test/pet', entryId: 'pet-entry' }] }],
    }
    const registry = createWorkbenchExtensionRegistryV1({
      catalog: source, settings, coreEditorIds: ['core.page'], coreVersion: '1.0.0', dshGeneration: '0.2.1-rc.2',
      readDshInventory: async () => inventory,
    })
    await registry.refresh()
    expect(registry.getSnapshot().extensions[0]?.availability).toBe('not-allowed')
    expect(registry.catalog.getSnapshot().map(row => row.id)).toEqual(['core.page'])

    const row = registry.getSnapshot().extensions[0]!
    settingsValue = { extensionConsents: { [`${row.packageName}::${row.moduleId}`]: {
      packageName: row.packageName!, moduleId: row.moduleId, apiVersion: 1,
      editorIds: row.editorIds,
      contractFingerprint: row.contractFingerprint!, allowedAt: 10,
    } } }
    settingsListeners.forEach(listener => listener())
    expect(registry.catalog.getSnapshot().map(item => item.id)).toEqual(['core.page', 'test.pet'])

    settingsValue = {}
    settingsListeners.forEach(listener => listener())
    expect(registry.catalog.getSnapshot().map(item => item.id)).toEqual(['core.page'])
    registry.dispose()
  })

  it('reports inventory failure as unavailable and never exposes third-party editors', async () => {
    const editor: WorkbenchEditorCatalogRow = {
      id: 'unsafe.page', label: 'Unsafe', scope: 'root', pluginId: 'unknown',
      extension: { schemaVersion: 1, moduleId: 'unsafe', apiVersion: 1, editorIds: ['unsafe.page'],
        coreCompatibility: '1.0.0', dshGeneration: '0.2.1-rc.2' },
    }
    const catalog: WorkbenchEditorCatalog = { getSnapshot: () => [editor], subscribe: () => () => {} }
    const registry = createWorkbenchExtensionRegistryV1({
      catalog,
      settings: { getSnapshot: () => ({ value: undefined }), subscribe: () => () => {} },
      coreEditorIds: [], coreVersion: '1.0.0', dshGeneration: '0.2.1-rc.2',
      readDshInventory: async () => { throw new Error('offline') },
    })
    await registry.refresh()
    expect(registry.getSnapshot().status).toBe('unavailable')
    expect(registry.catalog.getSnapshot()).toEqual([])
    registry.dispose()
  })

  it('retains the failing DSH inventory operation for diagnosis', async () => {
    const editor: WorkbenchEditorCatalogRow = {
      id: 'unsafe.page', label: 'Unsafe', scope: 'root', pluginId: 'unknown',
      extension: { schemaVersion: 1, moduleId: 'unsafe', apiVersion: 1, editorIds: ['unsafe.page'],
        coreCompatibility: '1.0.0', dshGeneration: '0.2.1-rc.2' },
    }
    const registry = createWorkbenchExtensionRegistryV1({
      catalog: { getSnapshot: () => [editor], subscribe: () => () => {} },
      settings: { getSnapshot: () => ({ value: undefined }), subscribe: () => () => {} },
      coreEditorIds: [], coreVersion: '1.0.0', dshGeneration: '0.2.1-rc.2',
      readDshInventory: async () => {
        throw new WorkbenchExtensionInventoryReadError([{
          operation: 'pluginManager.listBundles', code: 'connection-lost', message: 'Host connection lost',
        }])
      },
    })
    await registry.refresh()
    expect(registry.getSnapshot().inventoryFailures).toEqual([{
      operation: 'pluginManager.listBundles', code: 'connection-lost', message: 'Host connection lost',
    }])
    registry.dispose()
  })

  it('retries the inventory after a DSH connection reset', async () => {
    const page: WorkbenchEditorCatalogRow = {
      id: 'test.pet', label: 'Pet', scope: 'root', pluginId: 'pet-entry',
      extension: { schemaVersion: 1, moduleId: 'test.pet', apiVersion: 1, editorIds: ['test.pet'],
        coreCompatibility: '1.0.0', dshGeneration: '0.2.1-rc.2' },
    }
    const inventory: WorkbenchDshExtensionInventoryV1 = {
      plugins: [{ entryId: 'pet-entry', moduleName: '@test/pet', enabled: true, fiberPhase: 'active' }],
      bundles: [{ name: '@test/pet', version: '1.0.0', installed: true, enabled: true,
        rows: [{ rowId: 'pet', moduleName: '@test/pet', entryId: 'pet-entry' }] }],
    }
    let attempts = 0
    let available = false
    let onReset: (() => void) | undefined
    const registry = createWorkbenchExtensionRegistryV1({
      catalog: { getSnapshot: () => [page], subscribe: () => () => {} },
      settings: { getSnapshot: () => ({ value: undefined }), subscribe: () => () => {} },
      coreEditorIds: [], coreVersion: '1.0.0', dshGeneration: '0.2.1-rc.2',
      readDshInventory: async () => {
        attempts += 1
        if (!available) throw new Error('connection not ready')
        return inventory
      },
      subscribeConnectionReset(listener) { onReset = listener; return () => { onReset = undefined } },
    })
    await registry.refresh()
    expect(registry.getSnapshot().status).toBe('unavailable')
    const updated = new Promise<void>(resolve => registry.subscribe(resolve))
    available = true
    onReset?.()
    await updated
    expect(attempts).toBeGreaterThanOrEqual(2)
    expect(registry.getSnapshot().status).toBe('ready')
    registry.dispose()
  })

  it('reacts to DSH plugin lifecycle changes and removes a disabled editor from the live catalog', async () => {
    const page: WorkbenchEditorCatalogRow = {
      id: 'test.pet', label: 'Pet', scope: 'root', pluginId: 'pet-entry',
      declaration: {
        editorId: 'test.pet', scope: 'root', label: 'Pet', requiredBinding: 'none',
        state: { schemaVersion: 1, maxBytes: 100, restore: 'if-valid', share: 'forbidden' },
        runtime: { background: 'pause', collapsed: 'dispose', reacquire: 'on-visible' },
      },
      extension: { schemaVersion: 1, moduleId: 'test.pet', apiVersion: 1, editorIds: ['test.pet'],
        coreCompatibility: '1.0.0', dshGeneration: '0.2.1-rc.2' },
    }
    const catalog: WorkbenchEditorCatalog = { getSnapshot: () => [page], subscribe: () => () => {} }
    const enabled: WorkbenchDshExtensionInventoryV1 = {
      plugins: [{ entryId: 'pet-entry', moduleName: '@test/pet', enabled: true, fiberPhase: 'active' }],
      bundles: [{ name: '@test/pet', version: '1.0.0', installed: true, enabled: true,
        rows: [{ rowId: 'pet', moduleName: '@test/pet', entryId: 'pet-entry' }] }],
    }
    let inventory = enabled
    let onDshChanged: (() => void) | undefined
    const registry = createWorkbenchExtensionRegistryV1({
      catalog,
      settings: { getSnapshot: () => ({ value: undefined }), subscribe: () => () => {} },
      coreEditorIds: [], coreVersion: '1.0.0', dshGeneration: '0.2.1-rc.2',
      readDshInventory: async () => inventory,
      subscribeDshChanges(listener) { onDshChanged = listener; return () => { onDshChanged = undefined } },
    })
    await registry.refresh()
    expect(registry.getSnapshot().extensions[0]?.availability).toBe('not-allowed')
    expect(registry.catalog.getSnapshot()).toEqual([])

    inventory = {
      plugins: [{ ...enabled.plugins[0]!, enabled: false, fiberPhase: 'stopped' }],
      bundles: [{ ...enabled.bundles[0]!, enabled: false }],
    }
    const updated = new Promise<void>(resolve => registry.subscribe(resolve))
    onDshChanged?.()
    await updated
    expect(registry.getSnapshot().extensions[0]?.availability).toBe('dsh-disabled')
    expect(registry.catalog.getSnapshot()).toEqual([])

    registry.dispose()
    expect(onDshChanged).toBeUndefined()
  })
})
