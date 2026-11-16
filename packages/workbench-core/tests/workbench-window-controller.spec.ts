import { describe, expect, it, vi } from 'vitest'
import {
  normalizeWorkbenchWindowSnapshot,
  resolveWorkbenchWindowController,
  unsupportedWorkbenchWindowController,
  type WorkbenchWindowControllerV1,
} from '../src/client/workbench-window-controller.ts'

describe('Workbench window host contract', () => {
  it('fails closed when the DSH host does not provide a window controller', async () => {
    const controller = resolveWorkbenchWindowController(undefined)
    expect(controller.getSnapshot()).toEqual({ supported: false, windows: [] })
    expect(await controller.open('workbench-a')).toEqual({
      status: 'unsupported', code: 'host-window-api-unavailable',
    })
  })

  it('accepts an explicit host controller and forwards lifecycle operations', async () => {
    const snapshot = { supported: true, windows: [{ windowId: 'window-a', workbenchId: 'workbench-a', focused: true }] }
    const controller: WorkbenchWindowControllerV1 = {
      getSnapshot: () => snapshot,
      open: vi.fn(async (workbenchId: string) => ({ status: 'opened' as const, windowId: `window-${workbenchId}` })),
      focus: vi.fn(async () => ({ status: 'focused' as const })),
      close: vi.fn(async () => ({ status: 'closed' as const })),
      subscribe: () => () => {},
    }
    expect(resolveWorkbenchWindowController(controller)).toBe(controller)
    expect(normalizeWorkbenchWindowSnapshot(snapshot)).toBe(normalizeWorkbenchWindowSnapshot(snapshot))
    await expect(controller.open('workbench-a')).resolves.toEqual({ status: 'opened', windowId: 'window-workbench-a' })
    await expect(controller.focus('window-a')).resolves.toEqual({ status: 'focused' })
    await expect(controller.close('window-a')).resolves.toEqual({ status: 'closed' })
    expect(controller.open).toHaveBeenCalledWith('workbench-a')
  })

  it('rejects malformed and duplicate runtime window identities', () => {
    expect(normalizeWorkbenchWindowSnapshot({ supported: true, windows: [
      { windowId: 'same', workbenchId: 'a', focused: true },
      { windowId: 'same', workbenchId: 'b', focused: false },
    ] })).toEqual({ supported: false, windows: [] })
    expect(normalizeWorkbenchWindowSnapshot({ supported: true, windows: [
      { windowId: 'window-a', workbenchId: 'workbench-a', focused: true, sessionId: 'private' },
    ] })).toEqual({ supported: false, windows: [] })
  })

  it('uses a stable unsupported snapshot and a no-op subscription', () => {
    const controller = unsupportedWorkbenchWindowController()
    const listener = vi.fn()
    expect(controller.getSnapshot()).toBe(controller.getSnapshot())
    expect(controller.subscribe(listener)()).toBeUndefined()
    expect(listener).not.toHaveBeenCalled()
  })
})
