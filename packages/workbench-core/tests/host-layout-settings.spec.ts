import { describe, expect, it, vi } from 'vitest'
import { Config, apply } from '../src/index.ts'
import { createWorkbenchOfflineSettings } from '../src/host-offline-settings.ts'

function descriptor(value: Record<string, unknown>, revision = 1) {
  return { ns: 'workbench-layout', value, user: {}, base: {}, revision, schema: {}, autoGenerate: false, applies: 'live' as const }
}

describe('Core Host layout settings ownership on DSH 0.1.7', () => {
  it('exports a volatile Config envelope for native SettingsForms', () => {
    const json = Config.toJSON() as { meta?: { volatile?: boolean } }
    const refs = (json as unknown as { uid: number; refs: Record<string, { meta?: { volatile?: boolean } }> }).refs
    expect(refs[String((json as unknown as { uid: number }).uid)].meta?.volatile).toBe(true)
  })

  it('uses the native settings descriptor and revision fence for offline imports', async () => {
    const state = {
      value: {
        version: 4,
        activeWorkbenchId: 'main',
        openWorkbenchIds: ['main'],
        workbenches: { main: { workbenchId: 'main', name: '主工作台' } },
        invalidWorkbenches: {},
      } as Record<string, unknown>,
      revision: 3,
    }
    const settings = {
      describe: () => [descriptor(state.value, state.revision)],
      mutate: vi.fn(async (_ns: string, ops: readonly { op: string; path: readonly string[]; value?: unknown }[], expected?: number) => {
        if (expected !== state.revision) throw new Error('changed since read')
        for (const op of ops) {
          if (op.op === 'set' && op.path[0] === 'workbenches' && op.path[1] !== undefined) {
            state.value.workbenches = { ...(state.value.workbenches as Record<string, unknown>), [op.path[1]]: op.value }
          }
        }
        state.revision += 1
      }),
    }
    const adapter = createWorkbenchOfflineSettings(settings as never)
    const before = adapter.snapshot()
    await adapter.add({ workbenchId: 'imported', name: 'Imported', description: '', document: {} } as never, before.revision)
    expect(adapter.snapshot().records.imported).toMatchObject({ workbenchId: 'imported' })
    expect(settings.mutate).toHaveBeenCalledWith('workbench-layout', expect.any(Array), 3)
  })

  it('keeps the legacy host registration optional while 0.1.7 discovers Config', () => {
    const provide = vi.fn()
    const get = vi.fn((name: string) => name === 'settings' ? {} : undefined)
    apply({ provide, get } as never)
    expect(provide).toHaveBeenCalled()
  })
})
