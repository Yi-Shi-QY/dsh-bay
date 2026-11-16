import { describe, expect, it, vi } from 'vitest'
import { createHostWindowController, type CompanionHandle } from '../src/host-window-controller.ts'

function handle() {
  const commands = vi.fn(async () => true)
  return { value: { command: commands, dispose: vi.fn() } satisfies CompanionHandle, commands }
}

describe('Host-owned companion window lifecycle', () => {
  it('opens one window per workbench and focuses an existing companion', async () => {
    const companion = handle()
    const launch = vi.fn(async () => companion.value)
    const controller = createHostWindowController({ supported: true, lookup: id => id === 'main' ? { name: 'Main' } : undefined,
      register: () => vi.fn(), launch })
    const first = await controller.open('main') as { status: string; windowId: string }
    expect(first.status).toBe('opened')
    expect(controller.snapshot()).toMatchObject({ supported: true, windows: [{ workbenchId: 'main' }] })
    expect(await controller.open('main')).toEqual(first)
    expect(launch).toHaveBeenCalledTimes(1)
    expect(companion.commands).toHaveBeenCalledWith('focus')
    controller.dispose()
    expect(companion.value.dispose).toHaveBeenCalledOnce()
  })

  it('rejects unknown workbenches and closes only the requested window handle', async () => {
    const companion = handle()
    const unregister = vi.fn()
    const controller = createHostWindowController({ supported: true, lookup: id => id === 'main' ? { name: 'Main' } : undefined,
      register: () => unregister, launch: async () => companion.value })
    expect(await controller.open('../main')).toMatchObject({ status: 'failed', code: 'workbench-unavailable' })
    expect(await controller.open('main')).toMatchObject({ status: 'opened' })
    const windowId = controller.snapshot().windows[0]!.windowId
    expect(await controller.action(windowId, 'close')).toEqual({ status: 'closed' })
    expect(controller.snapshot().windows).toEqual([])
    expect(unregister).toHaveBeenCalledOnce()
    expect(companion.commands).toHaveBeenCalledWith('close')
    expect(companion.value.dispose).toHaveBeenCalledOnce()
  })

  it('removes late results when Host shutdown races window startup', async () => {
    let complete!: (value: CompanionHandle) => void
    const startup = new Promise<CompanionHandle>(resolve => { complete = resolve })
    const controller = createHostWindowController({ supported: true, lookup: () => ({ name: 'Main' }),
      register: () => vi.fn(), launch: async () => startup })
    const opening = controller.open('main')
    controller.dispose()
    const companion = handle()
    complete(companion.value)
    expect(await opening).toMatchObject({ status: 'failed', code: 'window-open-cancelled' })
    expect(companion.value.dispose).toHaveBeenCalledOnce()
    expect(controller.snapshot()).toEqual({ supported: false, windows: [] })
  })

  it('fails closed when no companion runtime is installed', async () => {
    const controller = createHostWindowController({ supported: false, lookup: () => ({ name: 'Main' }),
      register: () => vi.fn(), launch: async () => handle().value })
    expect(controller.snapshot()).toEqual({ supported: false, windows: [] })
    expect(await controller.open('main')).toEqual({ status: 'unsupported', code: 'companion-runtime-unavailable' })
  })
})
