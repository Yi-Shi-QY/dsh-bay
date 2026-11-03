// @vitest-environment jsdom
import React from 'react'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { WorkbenchWindowRoot } from '../src/foundation/WorkbenchWindowRoot.tsx'
import { SlotCore } from '@deepseek-ai/dsh-client-ui-slots'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

it('locks the browser workbench after reclaim and offers a close action only after confirmation', () => {
  const close = vi.spyOn(window, 'close').mockImplementation(() => {})
  const view = render(<WorkbenchWindowRoot renderSlot={() => <button type="button">工作台编辑器</button>} />)
  fireEvent(window, new CustomEvent('workbench-browser-reclaim', { detail: { state: 'requested' } }))
  expect(view.getByRole('button', { name: '工作台编辑器' })).toBeTruthy()
  expect(view.getByRole('alertdialog').textContent).toContain('正在等待 DSH 客户端确认')
  expect(view.getByRole('alertdialog').getAttribute('aria-busy')).toBe('true')
  expect(view.container.querySelector('[class*="spinner"]')).not.toBeNull()
  expect(view.queryByRole('button', { name: '关闭此页面' })).toBeNull()

  fireEvent(window, new CustomEvent('workbench-browser-reclaim', { detail: { state: 'reclaimed' } }))
  expect(view.getByRole('alertdialog').textContent).toContain('工作台已收回到 DSH 客户端')
  fireEvent.click(view.getByRole('button', { name: '关闭此页面' }))
  expect(close).toHaveBeenCalledOnce()
})

it('uses the public root slot priority contract for the dedicated document', () => {
  const slots = new SlotCore()
  const officialRoot = () => null
  const workbenchRoot = () => null
  slots.register({ name: 'root', priority: 0 }, officialRoot)
  slots.register({ name: 'root', priority: -100 }, workbenchRoot)
  expect(slots.entriesOfSlot('root')).toHaveLength(1)
  expect(slots.entriesOfSlot('root')[0]?.component).toBe(workbenchRoot)
})
