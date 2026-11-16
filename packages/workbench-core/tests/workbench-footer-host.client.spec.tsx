// @vitest-environment jsdom
import React from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { StoredEntry } from '@deepseek-ai/dsh-client-ui-slots'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { createWorkbenchFooterHost } from '../src/foundation/workbench-footer-host.tsx'

afterEach(cleanup)

it('renders public footer actions with no Session selected and releases removed entries', () => {
  const invoke = vi.fn(), clearPersisted = vi.fn()
  const create = vi.fn(() => ({ getSnapshot: () => ({}), subscribe: () => () => {}, actions: {}, clearPersisted }))
  const action: StoredEntry = {
    options: { id: 'creation' },
    store: { create } as never,
    component: () => <button onClick={invoke}>Created action</button>,
  }
  const ownEntry: StoredEntry = { options: { id: 'dsh-workbench-enter-mode' }, component: () => <button>Enter</button> }
  let entries = [action, ownEntry], version = 0
  const listeners = new Set<() => void>()
  const list = { getSnapshot: () => ({}), subscribe: () => () => {} }
  const ctx = {
    slots: {
      entriesOfSlot: () => entries, entries: () => entries,
      spec: () => ({ kind: 'list', scope: 'root' }),
      getVersion: () => version,
      subscribe: (_key: string, fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn) } },
    },
    sessions: { list }, workspaces: { list },
  } as unknown as Context
  const host = createWorkbenchFooterHost(ctx)
  const view = render(<>{host.render({ wide: true })}</>)
  fireEvent.click(view.getByRole('button', { name: 'Created action' }))
  expect(invoke).toHaveBeenCalledOnce()
  expect(create).toHaveBeenCalledWith('workbench-footer')
  expect(view.queryByRole('button', { name: 'Enter' })).toBeNull()
  expect(view.container.querySelector('[data-slot-error]')).toBeNull()
  act(() => { entries = [ownEntry]; version++; for (const notify of listeners) notify() })
  expect(view.queryByRole('button', { name: 'Created action' })).toBeNull()
  expect(clearPersisted).toHaveBeenCalledOnce()
  view.unmount()
  expect(listeners.size).toBe(0)
  host.dispose()
  expect(host.render({ wide: true })).toBeNull()
})
