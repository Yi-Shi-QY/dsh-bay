// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { installFloatingExitGuard, requestWorkbenchClientExit } from '../src/client/floating-exit-guard.ts'
import { createFloatingWorkspaceRuntime } from '../src/client/floating-workspace-runtime.ts'
afterEach(() => vi.restoreAllMocks())
it('awaits editor guards and does not approve a canceled client exit', async () => {
  const runtime = createFloatingWorkspaceRuntime()
  runtime.open('one', { id: 'a', editorId: 'test', editorScope: 'root', state: {}, lastKnownTitle: 'Test' })
  const release = installFloatingExitGuard(runtime)
  const confirm = vi.spyOn(globalThis, 'confirm').mockReturnValue(true)
  try {
    const guard = runtime.registerCloseGuard('a', async () => false, 'one')
    expect(await requestWorkbenchClientExit()).toBe(false)
    expect(confirm).not.toHaveBeenCalled()
    guard(); confirm.mockReturnValue(false)
    expect(await requestWorkbenchClientExit()).toBe(false)
    confirm.mockReturnValue(true)
    expect(await requestWorkbenchClientExit()).toBe(true)
  } finally { release() }
})
it('leaves native refresh shortcuts untouched outside Workbench', () => {
  const runtime = createFloatingWorkspaceRuntime(), release = installFloatingExitGuard(runtime)
  try {
    const event = new KeyboardEvent('keydown', { key: 'r', ctrlKey: true, cancelable: true })
    window.dispatchEvent(event); expect(event.defaultPrevented).toBe(false)
  } finally { release() }
})
