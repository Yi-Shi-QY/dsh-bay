// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createWorkbenchNativeAreaSlotRenderer } from '../src/client/native-area-slot-renderer.tsx'

describe('native sidebar owner isolation', () => {
  afterEach(cleanup)
  it('does not create/adopt the native sidebar owner store from a projected header', () => {
    let adopted = 'official'
    const create = vi.fn(() => {
      adopted = 'workbench'
      return { getSnapshot: () => ({}), subscribe: () => () => {}, actions: {} }
    })
    const handle = { create }
    const corner = { component: () => <span>native toggle</span>, options: { id: 'toggle' }, store: handle }
    const safe = { component: () => <span>safe action</span>, options: { id: 'safe' } }
    const owner = { component: () => null, options: {}, store: handle }
    const ownerEntries = [owner]
    const headerEntries = [corner, safe]
    const entries = (name: string) => name === 'rightbar.session' ? ownerEntries : headerEntries
    const snapshot = { key: 'session-a', hooks: {}, keyedHooks: {}, props: {} }
    const source = { getSnapshot: () => snapshot, subscribe: () => () => {} }
    const ctx = { slots: { spec: () => ({ kind: 'list', scope: 'session' }), entries, entriesOfSlot: entries, subscribe: () => () => {}, getVersion: () => 0, _host: { root: source, scope: () => ({ bindingSource: () => source }) } }, resources: { source: () => source }, sessions: { list: { getSnapshot: () => ({ byId: {} }) } } }
    const renderer = createWorkbenchNativeAreaSlotRenderer(ctx as never, 'session-a', {}, { sessionReference: { sessionId: 'session-a' } as never })
    render(renderer.render('conversation.session.header.corner', {}))
    expect(screen.getByText('safe action')).toBeTruthy()
    expect(screen.queryByText('native toggle')).toBeNull()
    expect(create).not.toHaveBeenCalled()
    expect(adopted).toBe('official')
    expect(renderer.hasEntry('conversation.session.header.corner', 'toggle')).toBe(false)
    renderer.dispose()
    expect(adopted).toBe('official')
  })
})
