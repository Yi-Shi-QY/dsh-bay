// @vitest-environment jsdom
import { useEffect, type ComponentType } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { installNativeAutomaticIsolation, originalWorkbenchAutomaticEntry } from '../src/client/native-automatic-isolation.tsx'
import { createWorkbenchNativeAreaSlotRenderer } from '../src/client/native-area-slot-renderer.tsx'

afterEach(cleanup)
it('isolates the official Composer root and automatic effects while Workbench owns the surface', () => {
  const open = vi.fn(), mark = vi.fn(), listeners = new Set<() => void>()
  let state = { mode: 'official' }
  function Original({ useSidebarMounted }: { useSidebarMounted: (selector: (v: unknown) => boolean) => boolean }) {
    const mounted = useSidebarMounted(v => !!v)
    useEffect(() => { if (mounted) { open('automatic'); mark() } }, [mounted])
    return <button onClick={() => open('manual')}>Open review</button>
  }
  const original = { component: Original, options: { id: '@deepseek-ai/dsh-client-ui-plan' } }
  const composerOriginal = { component: () => <div data-testid="official-composer" />, options: {} }
  const entriesByName = new Map<string, Array<typeof original | typeof composerOriginal>>([
    ['conversation.plan-review.actions', [original]],
    ['conversation.composer.bar', [composerOriginal]],
  ])
  let shadow = original
  const unregister = vi.fn()
  const slots = {
    entriesOfSlot: (name: string) => entriesByName.get(name) ?? [],
    inject: (_name: string, effect: () => unknown) => effect(),
    register: (options: { name: string }, component: typeof Original) => {
      const current = entriesByName.get(options.name) ?? []
      const entry = { options: options as typeof original.options, component }
      entriesByName.set(options.name, [...current, entry] as never)
      if (options.name === 'conversation.plan-review.actions') shadow = entry as never
      return () => { unregister(); entriesByName.set(options.name, current) }
    },
  }
  const dispose = installNativeAutomaticIsolation({ slots } as never, { subscribe: (fn: () => void) => { listeners.add(fn); return () => listeners.delete(fn) }, getSnapshot: () => state } as never)
  expect(originalWorkbenchAutomaticEntry(shadow as never)).toBe(original)
  const Isolated = shadow.component as ComponentType<{ useSidebarMounted: (selector: (v: unknown) => boolean) => boolean }>
  render(<Isolated useSidebarMounted={selector => selector({ sessionId: 'a' })} />)
  expect(open).toHaveBeenCalledWith('automatic'); open.mockClear(); mark.mockClear()
  act(() => { state = { mode: 'workbench' }; listeners.forEach(fn => fn()) })
  expect(open).not.toHaveBeenCalled(); expect(mark).not.toHaveBeenCalled()
  const composerEntries = entriesByName.get('conversation.composer.bar')!
  expect(composerEntries).toHaveLength(2)
  expect(originalWorkbenchAutomaticEntry(composerEntries[1] as never)).toBe(composerOriginal)
  fireEvent.click(screen.getByText('Open review')); expect(open).toHaveBeenCalledWith('manual')
  open.mockClear()
  act(() => { state = { mode: 'official' }; listeners.forEach(fn => fn()) })
  expect(open).toHaveBeenCalledWith('automatic'); expect(mark).toHaveBeenCalledTimes(1)
  expect(entriesByName.get('conversation.composer.bar')).toHaveLength(1)
  dispose(); expect(unregister).toHaveBeenCalledTimes(2)
})

it('routes temporary plan text with distinct automatic and active triggers without the native controller', () => {
  const nativeOpen = vi.fn(), nativeMark = vi.fn(), route = vi.fn(() => 'handled' as const)
  const entry = {
    options: { id: '@deepseek-ai/dsh-client-ui-plan' },
    inject: () => ({ openReview: nativeOpen, useSidebarMounted: (selector: (v: unknown) => unknown) => selector({}), actions: { markOpened: nativeMark } }),
    component: ({ openReview, review, requestKey, useSidebarMounted }: any) => {
      const mounted = useSidebarMounted((v: unknown) => !!v)
      useEffect(() => { if (mounted) { openReview(review, requestKey); nativeMark() } }, [mounted])
      return <button onClick={() => openReview(review, requestKey)}>Review</button>
    },
  }
  const snapshot = { key: 'session-a', hooks: {}, keyedHooks: {}, props: {} }
  const source = { getSnapshot: () => snapshot, subscribe: () => () => {} }
  const registered = [entry], empty: typeof registered = []
  const entries = (name: string) => name === 'conversation.plan-review.actions' ? registered : empty
  const ctx = { slots: { spec: () => ({ kind: 'list', scope: 'session' }), entries, entriesOfSlot: entries, subscribe: () => () => {}, getVersion: () => 0, _host: { root: source, scope: () => ({ bindingSource: () => source }) } }, resources: { source: () => source }, sessions: { list: { getSnapshot: () => ({ byId: {} }) } } }
  const renderer = createWorkbenchNativeAreaSlotRenderer(ctx as never, 'session-a', {}, { sessionReference: { sessionId: 'session-a' } as never, onOpenResource: route })
  render(renderer.render('conversation.plan-review.actions', { review: { plan: '# Temporary plan\nKeep this text' }, requestKey: 'review-1' } as never))
  expect(route).toHaveBeenCalledWith('dsh-resource://plan-review/session-a/review-1', expect.objectContaining({ trigger: 'automatic', eventId: 'review-1', params: { planReview: { markdown: '# Temporary plan\nKeep this text', title: 'Temporary plan' } } }), expect.objectContaining({ sessionId: 'session-a' }))
  fireEvent.click(screen.getByText('Review'))
  expect(route).toHaveBeenLastCalledWith(expect.any(String), expect.objectContaining({ trigger: 'active' }), expect.any(Object))
  expect(nativeOpen).not.toHaveBeenCalled(); expect(nativeMark).toHaveBeenCalledWith('review:review-1')
  renderer.dispose()
})
