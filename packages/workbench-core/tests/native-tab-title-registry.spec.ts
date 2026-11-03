import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  clearWorkbenchNativeTabTitles,
  getWorkbenchNativeTabTitle,
  registerWorkbenchNativeTabTitle,
  subscribeWorkbenchNativeTabTitles,
} from '../src/client/native-tab-title-registry.tsx'

describe('Workbench native tab title registry', () => {
  afterEach(() => clearWorkbenchNativeTabTitles())

  it('releases a title seat when its disposer runs', () => {
    const render = vi.fn(() => 'Files')
    const dispose = registerWorkbenchNativeTabTitle('files-a', render)

    expect(getWorkbenchNativeTabTitle('files-a')).toBe(render)
    dispose()
    expect(getWorkbenchNativeTabTitle('files-a')).toBeUndefined()
  })

  it('does not let an older disposer remove a replacement seat', () => {
    const first = vi.fn(() => 'first')
    const second = vi.fn(() => 'second')
    const disposeFirst = registerWorkbenchNativeTabTitle('browser-a', first)
    registerWorkbenchNativeTabTitle('browser-a', second)

    disposeFirst()
    expect(getWorkbenchNativeTabTitle('browser-a')).toBe(second)
  })

  it('notifies the Frame when seats are installed and released', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeWorkbenchNativeTabTitles(listener)
    const dispose = registerWorkbenchNativeTabTitle('terminal-a', () => 'Terminal')

    expect(listener).toHaveBeenCalledTimes(1)
    dispose()
    expect(listener).toHaveBeenCalledTimes(2)
    unsubscribe()
    registerWorkbenchNativeTabTitle('terminal-b', () => 'Terminal 2')
    expect(listener).toHaveBeenCalledTimes(2)
  })
})
