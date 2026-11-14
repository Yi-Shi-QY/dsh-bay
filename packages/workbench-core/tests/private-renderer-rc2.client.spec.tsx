// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { createWorkbenchNativeAreaSlotRenderer } from '../src/client/native-area-slot-renderer.tsx'
import { keyedObservableHook } from '../src/foundation/renderer/bindings.tsx'

const source = <T,>(value: T) => ({ getSnapshot: () => value, subscribe: () => () => {} })
afterEach(cleanup)

function fixture(specs: Record<string, object>, entries: Record<string, object[]>) {
  const context = {
    slots: {
      spec: (name: string) => specs[name],
      entries: (name: string) => entries[name] ?? [],
      entriesOfSlot: (name: string) => entries[name] ?? [],
      subscribe: () => () => {}, getVersion: () => 0,
      _host: {
        root: source({ hooks: {}, keyedHooks: {}, props: {} }),
        scope: () => ({ bindingSource: () => source({ key: 'session-a', hooks: {}, keyedHooks: {}, props: { sessionId: 'session-a' } }) }),
      },
    },
    resources: { source: () => source(undefined) },
    sessions: { list: source({ byId: {} }) },
  }
  const createRenderer = () => createWorkbenchNativeAreaSlotRenderer(context as never, 'session-a', {}, {
    sessionReference: { sessionId: 'session-a' } as never,
  })
  return { context, createRenderer }
}

it('keeps a Markdown fence inside only the matching RC2 HOC layers', () => {
  const { createRenderer } = fixture({
    'conversation.chat.markdown.fence': { kind: 'hoc', scope: 'session' },
  }, {
    'conversation.chat.markdown.fence': [
      { options: { id: 'common' }, component: ({ children }: { children: ReactNode }) => <section data-testid="common">{children}</section> },
      { options: { id: 'math', key: 'math' }, component: ({ children, sessionId }: { children: ReactNode; sessionId: string }) => <figure data-testid="math" data-session={sessionId}>{children}</figure> },
      { options: { id: 'diff', key: 'diff' }, component: () => <div>Wrong language</div> },
    ],
  })
  const renderer = createRenderer()
  const view = render(renderer.render('conversation.chat.markdown.fence', {}, { entryKey: 'math', children: <code>x + y</code> }))
  expect(screen.getByTestId('common').contains(screen.getByTestId('math'))).toBe(true)
  expect(screen.getByTestId('math').textContent).toBe('x + y')
  expect(screen.getByTestId('math').dataset.session).toBe('session-a')
  expect(screen.queryByText('Wrong language')).toBeNull()
  view.unmount(); renderer.dispose()
})

it('preserves inline text semantics for RC2 inline slot declarations', () => {
  const child = { kind: 'single', scope: 'root', inline: true }
  const { createRenderer } = fixture({
    'conversation.header': { kind: 'single', scope: 'root' }, 'conversation.user.text.node': child,
  }, {
    'conversation.header': [{ options: {}, children: { 'conversation.user.text.node': child }, component: ({ renderSlot }: { renderSlot: (name: string, owner: object) => ReactNode }) => <p data-testid="text">Before {renderSlot('conversation.user.text.node', {})} after</p> }],
    'conversation.user.text.node': [{ options: {}, component: () => <strong>file.ts</strong> }],
  })
  const renderer = createRenderer()
  const view = render(renderer.render('conversation.header', {}))
  const text = screen.getByTestId('text')
  expect(text.textContent).toBe('Before file.ts after')
  expect(text.querySelector('[data-slot]')?.tagName).toBe('SPAN')
  view.unmount(); renderer.dispose()
})

it('resolves RC2 keyed sources by both Session and member', () => {
  const member = source('Child plan content')
  const resolve = vi.fn((key: string, field?: string) => key === 'child-b' && field === 'plan-42' ? member : undefined)
  const usePlans = keyedObservableHook(resolve, 'session-a')
  function Plan() { return <p>{String(usePlans('child-b', 'plan-42'))}</p> }
  render(<Plan />)
  expect(screen.getByText('Child plan content')).toBeTruthy()
  expect(resolve).toHaveBeenCalledWith('child-b', 'plan-42')
})

it('keeps a root-scoped native store keyless even inside a bound Area', () => {
  const create = vi.fn(() => ({ ...source('root'), actions: {} }))
  const { createRenderer } = fixture({ 'conversation.hero.frame': { kind: 'hoc', scope: 'root' } }, {
    'conversation.hero.frame': [{ options: {}, store: { create }, component: ({ children }: { children: ReactNode }) => <section>{children}</section> }],
  })
  const first = createRenderer()
  const second = createRenderer()
  const view = render(<>{first.render('conversation.hero.frame', {}, { children: 'A' })}{second.render('conversation.hero.frame', {}, { children: 'B' })}</>)
  expect(create).toHaveBeenCalledExactlyOnceWith()
  view.unmount(); first.dispose(); second.dispose()
})

it('recovers a private Conversation Factory when DSH registers it after the Area mounts', () => {
  const { context } = fixture({}, {})
  let definition: object | undefined
  let version = 0
  const listeners = new Set<() => void>()
  Object.assign(context.slots, {
    factory: () => definition, factoryVersion: () => version, isFactoryLive: () => true,
    subscribeFactory: (_name: string, listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener) },
  })
  const renderer = createWorkbenchNativeAreaSlotRenderer(context as never, 'session-a', {}, { sessionReference: { sessionId: 'session-a' } as never })
  const view = render(renderer.renderFactory('conversation.content', {}, { fallback: <p>Waiting for Conversation</p> }))
  expect(screen.getByText('Waiting for Conversation')).toBeTruthy()
  act(() => {
    definition = { name: 'conversation.content', scope: 'session', component: () => <p>Conversation ready</p> }
    version += 1
    for (const listener of listeners) listener()
  })
  expect(screen.getByText('Conversation ready')).toBeTruthy()
  act(() => { definition = undefined; version += 1; for (const listener of listeners) listener() })
  expect(screen.getByText('Waiting for Conversation')).toBeTruthy()
  view.unmount(); renderer.dispose()
})
