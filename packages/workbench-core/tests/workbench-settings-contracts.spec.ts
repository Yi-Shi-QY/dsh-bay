import { describe, expect, it } from 'vitest'
import { createWorkbenchSettingsScope } from '../src/client/workbench-settings-contracts.ts'

describe('Core Settings mutation bridge', () => {
  it('uses one atomic mutate request and folds the returned revision', async () => {
    let snapshot: any = { status: 'ready', writable: true, mode: 'host', revision: 7, value: { a: 1 } }
    const requests: unknown[] = []
    const scope = createWorkbenchSettingsScope({ getSnapshot: () => snapshot, subscribe: () => () => {} } as any, {
      settings: { mutate: async (ns: string, ops: unknown, expectedRevision: number) => { requests.push({ ns, ops, expectedRevision }); return { ok: true, value: { revision: 8, value: { a: 2 } } } } },
    } as any, view => { snapshot = { ...snapshot, revision: view.revision, value: view.value } })
    expect(await scope.patch({ operation: 'set', path: ['a'], value: 2 })).toEqual({ status: 'committed', revision: 8 })
    expect(requests).toEqual([{ ns: 'workbench-layout', expectedRevision: 7, ops: [{ op: 'set', path: ['a'], value: 2 }] }])
    expect(scope.getSnapshot()).toMatchObject({ revision: 8, value: { a: 2 } })
  })

  it('refuses stale callers before sending a request', async () => {
    let calls = 0
    const scope = createWorkbenchSettingsScope({ getSnapshot: () => ({ status: 'ready', writable: true, mode: 'host', revision: 9, value: {} }), subscribe: () => () => {} } as any, { settings: { mutate: async () => { calls += 1; throw new Error('must not send') } } } as any, () => {})
    expect(await scope.patch({ operation: 'set', path: [], value: {}, expectedRevision: 8 })).toEqual({ status: 'conflict', expectedRevision: 8, actualRevision: 9 })
    expect(calls).toBe(0)
  })

  it('reports a Host CAS conflict without publishing the rejected value', async () => {
    let published = false
    const scope = createWorkbenchSettingsScope({ getSnapshot: () => ({ status: 'ready', writable: true, mode: 'host', revision: 4 }), subscribe: () => () => {} } as any, {
      settings: { mutate: async () => ({ ok: false, error: { code: 'settings/conflict', details: { expected: 4, actual: 5 } } }) },
    } as any, () => { published = true })
    expect(await scope.patch({ operation: 'unset', path: ['layout'] })).toEqual({ status: 'conflict', expectedRevision: 4, actualRevision: 5 })
    expect(published).toBe(false)
  })

  it('continues the queue after a transport exception and snapshots queued input', async () => {
    let calls = 0
    const requests: any[] = []
    const scope = createWorkbenchSettingsScope({ getSnapshot: () => ({ status: 'ready', writable: true, mode: 'host', revision: 4 }), subscribe: () => () => {} } as any, {
      settings: { mutate: async (ns: string, ops: unknown, expectedRevision: number) => {
        requests.push({ ns, ops, expectedRevision })
        if (++calls === 1) throw new Error('disconnected')
        return { ok: true, value: { revision: 5 } }
      } },
    } as any, () => {})
    const first = scope.patch({ operation: 'unset', path: ['old'] })
    const value = { a: 1 }
    const second = scope.patch({ operation: 'set', path: [], value })
    value.a = 2
    await expect(first).rejects.toThrow('disconnected')
    await expect(second).resolves.toEqual({ status: 'committed', revision: 5 })
    expect(requests[1].ops[0].value).toEqual({ a: 1 })
  })
})
