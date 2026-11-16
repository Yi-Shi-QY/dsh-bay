import { describe, expect, it, vi } from 'vitest'
import { readDshExtensionInventoryV1 } from '../src/client/read-dsh-extension-inventory.ts'
import { WorkbenchExtensionInventoryReadError } from '../src/workbench-extension-access.ts'

describe('readDshExtensionInventoryV1', () => {
  it('identifies which DSH inventory RPC failed', async () => {
    const remote = {
      pluginInventory: { list: vi.fn(async () => ({ ok: true, value: { entries: [] } })) },
      pluginManager: { listBundles: vi.fn(async () => ({
        ok: false, error: { code: 'connection-lost', message: 'Host connection lost' },
      })) },
    }

    await expect(readDshExtensionInventoryV1(remote)).rejects.toMatchObject({
      failures: [{
        operation: 'pluginManager.listBundles',
        code: 'connection-lost',
        message: 'Host connection lost',
      }],
    })
  })

  it('keeps both failures when both DSH inventory RPCs fail', async () => {
    const remote = {
      pluginInventory: { list: vi.fn(async () => { throw new Error('inventory endpoint unavailable') }) },
      pluginManager: { listBundles: vi.fn(async () => ({
        ok: false, error: { code: 'not-ready', message: 'plugin manager not ready' },
      })) },
    }

    try {
      await readDshExtensionInventoryV1(remote)
      throw new Error('expected inventory read to fail')
    } catch (error) {
      expect(error).toBeInstanceOf(WorkbenchExtensionInventoryReadError)
      expect((error as WorkbenchExtensionInventoryReadError).failures).toEqual([
        { operation: 'pluginInventory.list', message: 'inventory endpoint unavailable' },
        { operation: 'pluginManager.listBundles', code: 'not-ready', message: 'plugin manager not ready' },
      ])
    }
  })

  it('normalizes the DSH runtime and bundle records used for identity matching', async () => {
    const remote = {
      pluginInventory: { list: vi.fn(async () => ({ ok: true, value: { entries: [
        { entryId: 'pet-entry', moduleName: '@test/pet', enabled: true, fiberPhase: 'active' },
      ] } })) },
      pluginManager: { listBundles: vi.fn(async () => ({ ok: true, value: [{
        name: '@test/pet', version: '0.1.0', installed: true, enabled: true,
        rows: [{ rowId: 'pet', moduleName: '@test/pet', entryId: 'pet-entry' }],
      }] })) },
    }

    await expect(readDshExtensionInventoryV1(remote)).resolves.toEqual({
      plugins: [{ entryId: 'pet-entry', moduleName: '@test/pet', enabled: true, fiberPhase: 'active' }],
      bundles: [{ name: '@test/pet', version: '0.1.0', installed: true, enabled: true,
        rows: [{ rowId: 'pet', moduleName: '@test/pet', entryId: 'pet-entry' }] }],
    })
  })
})
