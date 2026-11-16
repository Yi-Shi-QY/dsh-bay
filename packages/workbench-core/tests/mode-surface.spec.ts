import { describe, expect, it, vi } from 'vitest'
import { createWorkbenchModeController } from '../src/mode-controller.ts'
import { createWorkbenchSurfaceController } from '../src/surface-controller.ts'

describe('Workbench Core mode/surface lifecycle', () => {
  it('keeps official mode on resolver failure and coalesces enter', async () => {
    const resolveWorkbench = vi.fn(async () => { throw new Error('unavailable') })
    const controller = createWorkbenchModeController({ resolveWorkbench })
    const first = controller.enter()
    const second = controller.enter()
    await expect(first).rejects.toThrow('unavailable')
    await expect(second).rejects.toThrow('unavailable')
    expect(resolveWorkbench).toHaveBeenCalledTimes(1)
    expect(controller.getSnapshot()).toEqual({ mode: 'official' })
  })

  it('flushes before exit and does not duplicate surface mounts', async () => {
    const flush = vi.fn(async () => true)
    const mode = createWorkbenchModeController({ resolveWorkbench: async () => 'wb-1', flush })
    await mode.enter()
    mode.focusArea('area-1')
    expect(mode.getSnapshot()).toMatchObject({ mode: 'workbench', workbenchId: 'wb-1', focusedAreaId: 'area-1' })
    const surface = createWorkbenchSurfaceController()
    surface.open('resume-workbench'); surface.open('new-conversation')
    expect(surface.getSnapshot()).toEqual({ state: 'opening', intent: 'resume-workbench' })
    await new Promise<void>(resolve => queueMicrotask(resolve))
    expect(surface.getSnapshot()).toEqual({ state: 'active', intent: 'resume-workbench' })
    await mode.exit()
    expect(flush).toHaveBeenCalledTimes(1)
    expect(mode.getSnapshot()).toEqual({ mode: 'official' })
  })
})
