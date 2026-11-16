import { describe, expect, it } from 'vitest'
import { createWorkbenchStorageModuleReceiptStore } from '../src/module-receipt.ts'

function storage(): { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void } {
  const values = new Map<string, string>()
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value) },
    removeItem: key => { values.delete(key) },
  }
}

const row = (state: 'staged' | 'installed' | 'active' = 'active') => ({
  receiptId: 'plan:workbench.shell', planId: 'plan', moduleId: 'workbench.shell',
  version: '1.0.0', artifactDigest: 'a'.repeat(64), state, installedAt: '2026-09-05T00:00:00.000Z',
})

describe('durable Core module receipts', () => {
  it('round-trips identity-only receipts across a new store instance', () => {
    const backing = storage()
    const first = createWorkbenchStorageModuleReceiptStore(backing)
    first.put(row('installed'))
    const second = createWorkbenchStorageModuleReceiptStore(backing)
    expect(second.get('workbench.shell')).toMatchObject({ moduleId: 'workbench.shell', state: 'installed' })
  })

  it('rejects malformed persisted snapshots before exposing records', () => {
    const backing = storage()
    backing.setItem('dsh.workbench.module-receipts.v1', JSON.stringify([{ moduleId: 'workbench.shell' }]))
    expect(() => createWorkbenchStorageModuleReceiptStore(backing)).toThrow('Invalid Workbench module receipt record')
  })
})
