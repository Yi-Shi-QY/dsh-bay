// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { requestWorkbenchShareGrant } from '../src/foundation/WorkbenchSharePermissions.tsx'

afterEach(() => cleanup())

it('renders the shared-control wizard and keeps the grant scoped to one complete Workbench', async () => {
  const pending = requestWorkbenchShareGrant(undefined, [{ id: 'area-a', label: 'Operations' }, { id: 'area-b', label: 'Research' }])
  const view = render(<div />)
  await waitFor(() => expect(document.body.querySelector('[role="dialog"]')).not.toBeNull())
  expect(document.body.textContent).toContain('Start shared-control')
  expect(document.body.textContent).toContain('same Host Workbench fact')
  expect(document.body.textContent?.toLowerCase()).not.toContain('review')
  expect(document.body.textContent?.toLowerCase()).not.toContain('collaborate template')
  expect(document.body.querySelector('select')).toBeNull()
  const writeFiles = [...document.querySelectorAll('label[data-disabled="false"]')].find(label => label.textContent?.includes('Write project files'))?.querySelector('input')
  fireEvent.click(writeFiles!)
  fireEvent.click(document.body.querySelector('button[type="submit"]')!)
  await expect(pending).resolves.toMatchObject({ template: 'shared-control', capabilities: expect.arrayContaining(['read-files']) })
  await expect(pending).resolves.not.toHaveProperty('areaIds')
  await expect(pending).resolves.not.toHaveProperty('paths')
  view.unmount()
})

it('allows reducing shared-control capabilities without creating a legacy projection', async () => {
  const pending = requestWorkbenchShareGrant({ template: 'shared-control', capabilities: ['view', 'message', 'read-files'] }, [])
  render(<div />)
  await waitFor(() => expect(document.body.querySelector('[role="dialog"]')).not.toBeNull())
  const mainMessage = [...document.querySelectorAll('input[type="checkbox"]')].find(input => input.parentElement?.textContent?.includes('Bay Agent')) as HTMLInputElement | undefined
  expect(mainMessage?.disabled).toBe(true)
  fireEvent.click(document.body.querySelector('button[type="submit"]')!)
  await expect(pending).resolves.toMatchObject({ template: 'shared-control', capabilities: ['view', 'message', 'read-files'] })
})
