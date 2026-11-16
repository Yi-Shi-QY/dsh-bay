// @vitest-environment jsdom
import React from 'react'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { createWorkbenchModeController } from '../src/mode-controller.ts'
import { WorkbenchCoreEntryAction } from '../src/foundation/WorkbenchCoreEntryAction.tsx'

afterEach(() => cleanup())

function renderAction() {
  const modeController = createWorkbenchModeController({
    resolveWorkbench: async () => 'recent-workbench',
  })
  const view = render(<WorkbenchCoreEntryAction wide modeController={modeController} {...({} as never)} />)
  return { modeController, view }
}

describe('Workbench official Sidebar footer action', () => {
  it('uses the same footer position to enter and exit Workbench', async () => {
    const { modeController, view } = renderAction()

    expect(view.getByRole('button', { name: '进入工作台模式' }).hasAttribute('data-workbench-entry-action')).toBe(true)
    await act(async () => { fireEvent.click(view.getByRole('button', { name: '进入工作台模式' })) })
    expect(modeController.getSnapshot().mode).toBe('workbench')

    const exit = view.getByRole('button', { name: '退出工作台模式' })
    expect(exit.hasAttribute('data-workbench-exit-action')).toBe(true)
    expect(view.queryByRole('button', { name: '进入工作台模式' })).toBeNull()
    await act(async () => { fireEvent.click(exit) })
    expect(modeController.getSnapshot().mode).toBe('official')
    expect(view.getByRole('button', { name: '进入工作台模式' }).hasAttribute('data-workbench-entry-action')).toBe(true)
  })
})
