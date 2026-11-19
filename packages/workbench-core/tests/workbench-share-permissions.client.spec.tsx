// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { requestWorkbenchShareGrant } from '../src/foundation/WorkbenchSharePermissions.tsx'

import { createTestWorkbenchLocale } from './workbench-locale-fixture.ts'

afterEach(() => cleanup())

it('renders the shared-control wizard and keeps the grant scoped to one complete Workbench', async () => {
  const locale = createTestWorkbenchLocale()
  const pending = requestWorkbenchShareGrant(undefined, locale)
  const view = render(<div />)
  await waitFor(() => expect(document.body.querySelector('[role="dialog"]')).not.toBeNull())
  expect(document.body.textContent).toContain('分享工作台到局域网')
  expect(document.body.textContent).toContain('共享当前整个工作台')
  expect(document.body.textContent?.toLowerCase()).not.toContain('review')
  expect(document.body.textContent?.toLowerCase()).not.toContain('collaborate template')
  expect(document.body.querySelector('select')).toBeNull()
  const writeFiles = view.getByRole('checkbox', { name: '修改工作台文件' })
  fireEvent.click(writeFiles)
  const checked = (writeFiles as HTMLInputElement).checked
  act(() => locale.setLocale('en'))
  expect(view.getByRole('heading', { name: 'Share workbench on local network' })).toBeTruthy()
  expect(view.getByRole('checkbox', { name: 'Modify workbench files' })).toBe(writeFiles)
  expect((writeFiles as HTMLInputElement).checked).toBe(checked)
  act(() => locale.setLocale('zh'))
  expect(view.getByRole('checkbox', { name: '修改工作台文件' })).toBe(writeFiles)
  fireEvent.click(document.body.querySelector('button[type="submit"]')!)
  await expect(pending).resolves.toMatchObject({ template: 'shared-control', capabilities: expect.arrayContaining(['read-files']) })
  await expect(pending).resolves.not.toHaveProperty('areaIds')
  await expect(pending).resolves.not.toHaveProperty('paths')
  view.unmount()
})

it('allows reducing shared-control capabilities without creating a legacy projection', async () => {
  const pending = requestWorkbenchShareGrant({ template: 'shared-control', capabilities: ['view', 'message', 'read-files'] })
  render(<div />)
  await waitFor(() => expect(document.body.querySelector('[role="dialog"]')).not.toBeNull())
  const mainMessage = [...document.querySelectorAll('input[type="checkbox"]')].find(input => input.parentElement?.textContent?.includes('向主会话发送消息')) as HTMLInputElement | undefined
  expect(mainMessage?.disabled).toBe(true)
  fireEvent.click(document.body.querySelector('button[type="submit"]')!)
  await expect(pending).resolves.toMatchObject({ template: 'shared-control', capabilities: ['view', 'message', 'read-files'] })
})
