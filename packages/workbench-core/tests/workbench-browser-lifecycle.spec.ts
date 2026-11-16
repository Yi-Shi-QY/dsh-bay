import { describe, expect, it } from 'vitest'
import { projectWorkbenchBrowserLifecycleV1 } from '../src/client/workbench-browser-lifecycle.ts'

describe('Workbench browser lifecycle projection', () => {
  it('uses the Host request as the authority over local feedback', () => {
    expect(projectWorkbenchBrowserLifecycleV1({ workbenchId: 'one', status: 'redeemed' }, 'idle')).toMatchObject({
      phase: 'initializing', busy: true, canReclaim: false, desktopLocked: true,
    })
    expect(projectWorkbenchBrowserLifecycleV1({ workbenchId: 'one', status: 'ready' }, 'reclaiming')).toMatchObject({
      phase: 'ready', busy: false, canReclaim: true, desktopLocked: true, browserControlsWorkbench: true,
    })
  })

  it('keeps reclaim available after a browser heartbeat or reclaim timeout', () => {
    expect(projectWorkbenchBrowserLifecycleV1({
      workbenchId: 'one', status: 'failed', code: 'browser-view-heartbeat-timeout',
    })).toMatchObject({ phase: 'failed', canReclaim: true })
    expect(projectWorkbenchBrowserLifecycleV1({
      workbenchId: 'one', status: 'failed', code: 'browser-view-reclaim-timeout',
    })).toMatchObject({ phase: 'failed', canReclaim: true })
  })

  it('does not offer reclaim after an initialization failure or expiry', () => {
    expect(projectWorkbenchBrowserLifecycleV1({ workbenchId: 'one', status: 'failed', code: 'browser-shell-unsupported' }))
      .toMatchObject({ phase: 'failed', canReclaim: false, busy: false, desktopLocked: false, browserControlsWorkbench: false })
    expect(projectWorkbenchBrowserLifecycleV1({ workbenchId: 'one', status: 'expired' }))
      .toMatchObject({ phase: 'expired', canReclaim: false })
  })
})
