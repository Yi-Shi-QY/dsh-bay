import { describe, expect, it, vi } from 'vitest'
import { createWorkbenchRuntimeMetrics } from '../src/foundation/workbench-runtime-metrics.ts'

describe('passive Workbench runtime diagnostics', () => {
  it('records completed durations and outcomes without storing write payloads', async () => {
    let now = 10
    const metrics = createWorkbenchRuntimeMetrics(() => now)
    let resolve!: (value: { status: 'committed'; revision: number }) => void
    const write = vi.fn(() => new Promise<{ status: 'committed'; revision: number }>(done => { resolve = done }))
    const pending = metrics.measureLayoutSave(write)
    expect(metrics.getSnapshot().layoutSaves).toMatchObject({ attempted: 1, inFlight: 1, lastDurationMs: undefined })
    now = 45
    resolve({ status: 'committed', revision: 2 })
    expect(await pending).toEqual({ status: 'committed', revision: 2 })
    expect(metrics.getSnapshot().layoutSaves).toMatchObject({ committed: 1, inFlight: 0, lastDurationMs: 35 })
    await expect(metrics.measureLayoutSave(async () => { throw new Error('private-host-error') })).rejects.toThrow('private-host-error')
    expect(metrics.getSnapshot().layoutSaves).toMatchObject({ failed: 1, inFlight: 0, lastStatus: 'error' })
    expect(JSON.stringify(metrics.getSnapshot())).not.toContain('private-host-error')
  })

  it('keeps outlet cleanup idempotent and snapshots independent from the collector', () => {
    const metrics = createWorkbenchRuntimeMetrics()
    const release = metrics.mountEditorOutlet()
    release(); release()
    const second = metrics.mountEditorOutlet()
    expect(metrics.getSnapshot().mountedEditorOutlets).toBe(1)
    const copy = metrics.getSnapshot()
    Object.assign(copy.layoutSaves, { attempted: 999 })
    expect(metrics.getSnapshot().layoutSaves.attempted).toBe(0)
    second()
    expect(metrics.getSnapshot().mountedEditorOutlets).toBe(0)
  })
})
