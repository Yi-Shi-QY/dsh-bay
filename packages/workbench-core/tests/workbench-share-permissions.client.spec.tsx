// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { requestWorkbenchShareGrant } from '../src/foundation/WorkbenchSharePermissions.tsx'

afterEach(() => cleanup())

it('renders the Workbench sharing wizard with grouped permissions and preserves the grant semantics', async () => {
  const pending = requestWorkbenchShareGrant(undefined, [{ id: 'area-a', label: '社媒运营' }, { id: 'area-b', label: '研究' }])
  const view = render(<div />)
  await waitFor(() => expect(document.body.querySelector('[role="dialog"]')).not.toBeNull())
  expect(document.body.textContent).toContain('开始局域网分享')
  expect(document.body.textContent).toContain('额外授权')
  expect(document.body.textContent).toContain('可见区域')
  const readFiles = [...document.querySelectorAll('label[data-disabled="false"]')].find(label => label.textContent?.includes('浏览项目文件'))?.querySelector('input')
  fireEvent.click(readFiles!)
  fireEvent.click(document.body.querySelector('button[type="submit"]')!)
  await expect(pending).resolves.toMatchObject({ template: 'collaborate', capabilities: expect.arrayContaining(['read-files']) })
  view.unmount()
})

it('keeps Bay Agent messaging unavailable in the review template', async () => {
  const pending = requestWorkbenchShareGrant(undefined, [])
  render(<div />)
  await waitFor(() => expect(document.body.querySelector('[role="dialog"]')).not.toBeNull())
  fireEvent.change(document.body.querySelector('select[aria-label="分享权限模板"]')!, { target: { value: 'review' } })
  const mainMessage = [...document.querySelectorAll('input[type="checkbox"]')].find(input => input.parentElement?.textContent?.includes('Bay Agent')) as HTMLInputElement | undefined
  expect(mainMessage?.disabled).toBe(true)
  fireEvent.click(document.body.querySelector('button[type="submit"]')!)
  await expect(pending).resolves.toMatchObject({ template: 'review' })
})
