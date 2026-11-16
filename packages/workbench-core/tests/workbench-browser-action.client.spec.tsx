// @vitest-environment jsdom
import React from 'react'
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { WorkbenchBrowserAction } from '../src/foundation/WorkbenchBrowserAction.tsx'

afterEach(cleanup)

function mount(overrides: Partial<React.ComponentProps<typeof WorkbenchBrowserAction>> = {}) {
  const props: React.ComponentProps<typeof WorkbenchBrowserAction> = {
    workbenchId: 'one',
    workbenchName: 'Workbench A',
    windowSnapshot: { supported: true, windows: [] },
    onPrepareOpen: vi.fn(async () => true),
    onOpenWindow: vi.fn(async () => {}),
    ...overrides,
  }
  return { props, view: render(<WorkbenchBrowserAction {...props} />) }
}

it('prepares and opens from one user click', async () => {
  const prepare = vi.fn(async () => true)
  const open = vi.fn(async () => {})
  const onTransition = vi.fn()
  const { view } = mount({ onPrepareOpen: prepare, onOpenWindow: open, onTransition })
  fireEvent.click(view.getByRole('button', { name: /Workbench A/u }))
  await waitFor(() => expect(prepare).toHaveBeenCalledWith('one'))
  await waitFor(() => expect(open).toHaveBeenCalledWith('one'))
  expect(open).toHaveBeenCalledOnce()
  expect(onTransition.mock.calls.map(call => call[1])).toEqual(['preparing', 'opening', 'idle'])
})

it('prevents duplicate opens while the combined action is busy', async () => {
  let complete!: () => void
  const open = vi.fn(() => new Promise<void>(resolve => { complete = resolve }))
  const { view } = mount({ onOpenWindow: open })
  const action = view.getByRole('button', { name: /Workbench A/u }) as HTMLButtonElement
  fireEvent.click(action)
  await waitFor(() => expect(open).toHaveBeenCalledOnce())
  expect(action.disabled).toBe(true)
  fireEvent.click(action)
  expect(open).toHaveBeenCalledOnce()
  await act(async () => { complete() })
})

it('allows retrying a failed preparation and opens on the retry click', async () => {
  const prepare = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true)
  const open = vi.fn(async () => {})
  const { view } = mount({ onPrepareOpen: prepare, onOpenWindow: open })
  fireEvent.click(view.getByRole('button', { name: /Workbench A/u }))
  const retry = await view.findByRole('button', { name: /Workbench A/u })
  fireEvent.click(retry)
  await waitFor(() => expect(open).toHaveBeenCalledOnce())
  expect(prepare).toHaveBeenCalledTimes(2)
})

it('keeps the action available to explain a missing host capability', async () => {
  const prepare = vi.fn(async () => false)
  const { view } = mount({ windowSnapshot: { supported: false, windows: [] }, onPrepareOpen: prepare })
  const action = view.getByRole('button', { name: /服务不可用/u })
  expect((action as HTMLButtonElement).disabled).toBe(false)
  fireEvent.click(action)
  await waitFor(() => expect(prepare).toHaveBeenCalledWith('one'))
})

it('shows a per-workbench reclaim action when its browser view is ready', async () => {
  const reclaim = vi.fn(async () => {})
  const onTransition = vi.fn()
  const { view } = mount({
    windowSnapshot: { supported: true, windows: [], requests: [
      { workbenchId: 'one', status: 'ready', windowId: '00000000-0000-4000-8000-000000000001' },
    ] },
    onReclaim: reclaim,
    onTransition,
  })
  fireEvent.click(view.getByRole('button', { name: /收回/u }))
  await waitFor(() => expect(reclaim).toHaveBeenCalledWith('one'))
  expect(onTransition.mock.calls.map(call => call[1])).toEqual(['reclaiming', 'idle'])
})

it('offers reclaim after the Host reports a lost browser heartbeat', async () => {
  const reclaim = vi.fn(async () => {})
  const { view } = mount({
    windowSnapshot: { supported: true, windows: [], requests: [
      { workbenchId: 'one', status: 'failed', code: 'browser-view-heartbeat-timeout', windowId: '00000000-0000-4000-8000-000000000001' },
    ] },
    onReclaim: reclaim,
  })
  const action = view.getByRole('button', { name: /收回/u }) as HTMLButtonElement
  expect(action.disabled).toBe(false)
  fireEvent.click(action)
  await waitFor(() => expect(reclaim).toHaveBeenCalledWith('one'))
})

it('does not invoke opening while this workbench is already being handed off', () => {
  const open = vi.fn(async () => {})
  const { view } = mount({
    windowSnapshot: { supported: true, windows: [], request: { workbenchId: 'one', status: 'requested' } },
    onOpenWindow: open,
  })
  const action = view.getByRole('button', { name: /正在浏览器中打开/u }) as HTMLButtonElement
  expect(action.disabled).toBe(true)
  expect(open).not.toHaveBeenCalled()
})

it('does not reserve an internal popup in the branded DSH desktop shell', async () => {
  vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 @deepseek-ai/dsh-desktop/0.2.2-rc.2 Chrome/152.0.7977.130' })
  vi.stubGlobal('dshDesktop', { protocolVersion: 1 })
  const open = vi.fn(async () => {})
  const popup = vi.spyOn(window, 'open')
  const { view } = mount({ onOpenWindow: open })
  fireEvent.click(view.getByRole('button', { name: /Workbench A/u }))
  await waitFor(() => expect(open).toHaveBeenCalledWith('one'))
  expect(open).toHaveBeenCalledOnce()
  expect(popup).not.toHaveBeenCalled()
  vi.unstubAllGlobals()
})
