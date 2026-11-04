// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { createWorkbenchOfficialAreaEditors } from '../src/client/official-area-editors.tsx'
import { closeWorkbenchNative } from '../src/client/native-sidebar-area-editor.tsx'

function snapshotStore<T>(initial: T) {
  let value = initial
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => value,
    subscribe(listener: () => void) { listeners.add(listener); return () => listeners.delete(listener) },
    set(next: T) { value = next; for (const listener of [...listeners]) listener() },
  }
}

function owner() {
  return {
    instanceId: 'native-area-test', areaId: 'native-area-test', areaClaim: 'native-area-claim',
    sessionId: 'session-test', state: {}, setState: vi.fn(), close: vi.fn(), focus: vi.fn(),
  }
}

function nativeContext() {
  const binding = snapshotStore({ key: 'session-test', hooks: {}, keyedHooks: {}, props: {} })
  const bodyEntries: Array<{ component: (props: { useTabInfo: () => { tab: { title: string } } }) => ReactNode; options: { key: string } }> = []
  const slotsListeners = new Set<() => void>()
  const resource = snapshotStore(undefined)
  const slots = {
    spec: (name: string) => name === 'sidebar.right.pane.tab' ? { kind: 'keyed', scope: 'session' } : undefined,
    entries: (name: string) => name === 'sidebar.right.pane.tab' ? bodyEntries : [],
    entriesOfSlot: (name: string) => name === 'sidebar.right.pane.tab' ? bodyEntries : [],
    subscribe: (_name: string, listener: () => void) => { slotsListeners.add(listener); return () => slotsListeners.delete(listener) },
    getVersion: () => 0,
    _host: { root: snapshotStore({ hooks: {}, keyedHooks: {}, props: {} }), scope: () => ({ bindingSource: () => binding }) },
  }
  const reference = { sessionId: 'session-test', binding: {}, ready: Promise.resolve(), release: vi.fn() }
  const shortcutService = {
    catalog: {
      getSnapshot: () => [{ id: 'page.refresh', label: 'Refresh', binding: 'Ctrl+R' }],
      subscribe: () => () => {},
    },
  }
  const context = {
    slots,
    sessions: { retain: vi.fn(() => reference), list: { getSnapshot: () => ({ byId: {} }), subscribe: () => () => {} } },
    resources: { source: () => resource, pin: vi.fn() },
    locale: { getSnapshot: () => ({ revision: 0 }), subscribe: () => () => {}, bind: () => () => '' },
    sidebarRightTabs: { claim: vi.fn(), get: vi.fn() },
    get: (name: string) => name === 'shortcuts' ? shortcutService : undefined,
  }
  return {
    context,
    install(entry: { component: (props: { useTabInfo: () => { tab: { title: string } } }) => ReactNode; options: { key: string } }) {
      bodyEntries.push(entry)
      for (const listener of [...slotsListeners]) listener()
    },
    uninstall() {
      bodyEntries.splice(0)
      for (const listener of [...slotsListeners]) listener()
    },
    reference,
  }
}

describe('Workbench native Sidebar Area editor lifecycle', () => {
  afterEach(() => cleanup())

  it('switches from fallback to the DSH body when registration arrives, then back when it is removed', async () => {
    const fixture = nativeContext()
    const editors = createWorkbenchOfficialAreaEditors(fixture.context as never)
    render(editors.browser(owner() as never))

    expect(screen.getByText('输入 HTTP(S) 地址开始浏览')).toBeTruthy()
    expect(screen.queryByTestId('native-browser-body')).toBeNull()

    fixture.install({
      options: { key: '@deepseek-ai/dsh-client-ui-sidebar-browser' },
      component: ({ useTabInfo }) => <div data-testid="native-browser-body">{useTabInfo().tab.title}</div>,
    })
    await waitFor(() => expect(screen.getByTestId('native-browser-body')).toBeTruthy())
    expect(screen.queryByText('输入 HTTP(S) 地址开始浏览')).toBeNull()
    expect(fixture.reference.release).not.toHaveBeenCalled()

    act(() => fixture.uninstall())
    await waitFor(() => expect(screen.getByText('输入 HTTP(S) 地址开始浏览')).toBeTruthy())
    expect(screen.queryByTestId('native-browser-body')).toBeNull()
    expect(fixture.reference.release).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['browser', '@deepseek-ai/dsh-client-ui-sidebar-browser'],
    ['terminal', '@deepseek-ai/dsh-client-ui-sidebar-terminal'],
  ] as const)('does not mount a Workbench fallback when the DSH %s body is registered', async (kind, entryKey) => {
    const fixture = nativeContext()
    const editors = createWorkbenchOfficialAreaEditors(fixture.context as never)
    const editor = editors[kind]
    render(editor(owner() as never))

    fixture.install({
      options: { key: entryKey },
      component: () => <div data-testid={`native-${kind}-body`}>native {kind}</div>,
    })
    await waitFor(() => expect(screen.getByTestId(`native-${kind}-body`)).toBeTruthy())
    expect(screen.queryByTestId('workbench-browser-fallback')).toBeNull()
    expect(screen.queryByTestId('workbench-terminal-fallback')).toBeNull()
  })

  it('reads the shortcut catalog through Context.get for an Area-local renderer', async () => {
    const fixture = nativeContext()
    const guardedContext = new Proxy(fixture.context, {
      get(target, property, receiver) {
        if (property === 'shortcuts') throw new Error('shortcuts must not be read as an injected property')
        return Reflect.get(target, property, receiver)
      },
    })
    const editors = createWorkbenchOfficialAreaEditors(guardedContext as never)
    render(editors.browser(owner() as never))

    fixture.install({
      options: { key: '@deepseek-ai/dsh-client-ui-sidebar-browser' },
      component: () => <div data-testid="native-browser-body">native browser</div>,
    })
    await waitFor(() => expect(screen.getByTestId('native-browser-body')).toBeTruthy())
  })

  it('keeps resource-backed native pages address-less until DSH supplies a real resource', async () => {
    const fixture = nativeContext()
    const editors = createWorkbenchOfficialAreaEditors(fixture.context as never)
    render(editors.changesReview(owner() as never))

    // A Workbench tab without a dsh-resource://changes-review address must
    // stay in the native waiting state. Mounting ReviewTab with a fabricated
    // workbench:// identity would throw inside the upstream renderer.
    expect(document.querySelector('[data-workbench-native-resource-state="waiting"]')).toBeTruthy()
    expect(document.querySelector('[data-workbench-native-area="changes-review"]')).toBeNull()
  })

  it('keeps native occurrences separate for reused layout IDs and stable during relocation', async () => {
    const fixture = nativeContext(), editors = createWorkbenchOfficialAreaEditors(fixture.context as never)
    const tabs = new Map<string, unknown>(), snapshots = new Map<string, unknown>()
    fixture.install({
      options: { key: '@deepseek-ai/dsh-client-ui-sidebar-browser' },
      component: ({ useTabInfo }) => {
        const tab = useTabInfo().tab as unknown as { id: string; signal: AbortSignal }
        tabs.set(tab.id, tab.signal); snapshots.set(tab.id, tab)
        return <div data-testid={tab.id}>browser</div>
      },
    })
    const one = JSON.stringify(['one', 'shared']), two = JSON.stringify(['two', 'shared'])
    const content = (areaId: string) => <>{editors.browser({ ...owner(), instanceId: 'shared', runtimeIdentity: one, areaId, bindingGeneration: 0 } as never)}{editors.browser({ ...owner(), instanceId: 'shared', runtimeIdentity: two, areaId: 'second', bindingGeneration: 0 } as never)}</>
    const view = render(content('floating'))
    await waitFor(() => expect(tabs.size).toBe(2))
    const signal = tabs.get(one) as AbortSignal, other = tabs.get(two) as AbortSignal
    view.rerender(content('area'))
    await waitFor(() => expect(tabs.get(one)).toBe(signal))
    act(() => closeWorkbenchNative(one))
    expect(signal.aborted).toBe(true); expect(other.aborted).toBe(false)
    act(() => closeWorkbenchNative(two))
  })
})
