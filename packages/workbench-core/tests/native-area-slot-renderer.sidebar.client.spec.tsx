// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, act } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useEffect, type ReactNode } from 'react'
import { createWorkbenchNativeAreaSlotRenderer } from '../src/client/native-area-slot-renderer.tsx'
import { createWorkbenchNativeTabOccurrence } from '../src/client/native-tab-occurrence.ts'
import { workbenchTerminalControllerTabId } from '../src/client/native-terminal-retention.ts'
import { openWorkbenchResource } from '../src/client/workbench-resource-opener.ts'

function source<T>(value: T) {
  return { getSnapshot: () => value, subscribe: () => () => {} }
}

function makeContext(entry: object, bindingSource: () => { getSnapshot: () => object; subscribe: (listener: () => void) => () => void }, services: Record<string, unknown> = {}) {
  const slots = {
    spec: (name: string) => name === 'sidebar.right.pane.tab' ? { kind: 'keyed', scope: 'session' } : undefined,
    entries: (name: string) => name === 'sidebar.right.pane.tab' ? [entry] : [],
    entriesOfSlot: (name: string) => name === 'sidebar.right.pane.tab' ? [entry] : [],
    subscribe: () => () => {},
    getVersion: () => 0,
    _host: { root: source({ hooks: {}, keyedHooks: {}, props: {} }), scope: () => ({ bindingSource }) },
  }
  return {
    ...services,
    slots,
    locale: undefined,
    resources: { source: () => source(undefined) },
    sessions: { list: { getSnapshot: () => ({ byId: {} }) } },
  } as never
}

describe('Workbench Area-local native sidebar adapter', () => {
  afterEach(() => cleanup())

  it.each([
    'sidebar.panellist.actions',
    'conversation.session.header.views.actions',
    'sidebar.right.tab.guide.actions',
  ])('filters only rc1 official entry-customization More registrations in Area projections (%s)', slot => {
    const officialMore = {
      component: () => <span data-testid="official-more">official More</span>,
      options: { id: 'entry-customization' },
    }
    const legalAction = {
      component: () => <span data-testid="legal-action">legal action</span>,
      options: { id: 'third-party-action' },
    }
    const entries = { [slot]: [officialMore, legalAction] }
    const context = {
      slots: {
        spec: (name: string) => name === slot ? { kind: 'list', scope: 'root' } : undefined,
        entries: (name: string) => entries[name as keyof typeof entries] ?? [],
        entriesOfSlot: (name: string) => entries[name as keyof typeof entries] ?? [],
        subscribe: () => () => {},
        getVersion: () => 0,
        _host: { root: source({ hooks: {}, keyedHooks: {}, props: {} }), scope: () => ({ bindingSource: () => source({ key: 'session-a', hooks: {}, keyedHooks: {}, props: {} }) }) },
      },
      locale: undefined,
      resources: { source: () => source(undefined) },
      sessions: { list: { getSnapshot: () => ({ byId: {} }) } },
    } as never
    const renderer = createWorkbenchNativeAreaSlotRenderer(context, 'session-a', {}, { sessionReference: { sessionId: 'session-a' } as never })
    render(renderer.render(slot, {}))
    expect(screen.queryByTestId('official-more')).toBeNull()
    expect(screen.getByTestId('legal-action')).toBeTruthy()
    expect(renderer.hasEntry(slot, 'entry-customization')).toBe(false)
    expect(renderer.hasEntry(slot, 'third-party-action')).toBe(true)
    renderer.dispose()
  })

  it('keeps the Browser controller on the exact DSH Session identity', () => {
    const inject = vi.fn((id: string) => ({ controllerId: id }))
    const entry = {
      component: (props: { controllerId: string }) => <div>{props.controllerId}</div>,
      options: { key: '@deepseek-ai/dsh-client-ui-sidebar-browser' },
      inject,
    }
    const binding = { key: 'session-a', hooks: {}, keyedHooks: {}, props: {} }
    const occurrence = createWorkbenchNativeTabOccurrence({
      sessionId: 'session-a', areaId: 'area-a', instanceId: 'browser-a', kind: 'browser', contentId: 'browser:a', title: 'Browser A',
    })
    const renderer = createWorkbenchNativeAreaSlotRenderer(makeContext(entry, () => source(binding)), 'session-a', {}, {
      scopeKey: 'area-a:browser-a',
      sessionReference: { sessionId: 'session-a' } as never,
      areaOccurrence: occurrence,
    })
    render(renderer.render('sidebar.right.pane.tab', {}, { entryKey: '@deepseek-ai/dsh-client-ui-sidebar-browser', hookContext: occurrence.read }))
    expect(screen.getByText('session-a')).toBeTruthy()
    expect(inject).toHaveBeenCalledWith('session-a', undefined)
    renderer.dispose()
    occurrence.dispose()
  })

  it('resolves Terminal through the Area occurrence instead of DSH Sidebar tabDomain', () => {
    const view = vi.fn(() => ({ state: source({ phase: 'connected' }) }))
    const originalInject = vi.fn(() => ({ view: vi.fn(() => { throw new Error('official Sidebar lookup used') }) }))
    const entry = {
      component: (props: { view: (key: string) => unknown }) => <button type="button" onClick={() => { void props.view('area-terminal') }}>Open terminal</button>,
      options: { key: '@deepseek-ai/dsh-client-ui-sidebar-terminal' },
      inject: originalInject,
    }
    const binding = { key: 'session-a', hooks: {}, keyedHooks: {}, props: {} }
    const occurrence = createWorkbenchNativeTabOccurrence({
      sessionId: 'session-a', areaId: 'area-a', instanceId: 'terminal-a', kind: 'terminal', contentId: 'workbench://terminal/terminal-a', title: 'Terminal A',
    })
    const ctx = makeContext(entry, () => source(binding), { webTerminals: { view } })
    const renderer = createWorkbenchNativeAreaSlotRenderer(ctx, 'session-a', {}, {
      scopeKey: 'area-a:terminal-a',
      sessionReference: { sessionId: 'session-a' } as never,
      areaOccurrence: occurrence,
    })
    render(renderer.render('sidebar.right.pane.tab', {}, { entryKey: '@deepseek-ai/dsh-client-ui-sidebar-terminal', hookContext: occurrence.read }))
    fireEvent.click(screen.getByRole('button', { name: 'Open terminal' }))
    expect(originalInject).not.toHaveBeenCalled()
    expect(view).toHaveBeenCalledWith(
      'session-a', workbenchTerminalControllerTabId('terminal-a', 'workbench://terminal/terminal-a'),
      'workbench://terminal/terminal-a', undefined, undefined,
    )
    renderer.dispose()
    occurrence.dispose()
  })

  it('shares a native store by Session while keeping each Area occurrence separate', () => {
    const create = vi.fn(() => ({
      getSnapshot: () => ({ byTab: {} }),
      subscribe: () => () => {},
      actions: {},
    }))
    const entry = {
      component: ({ useStore }: { useStore: <T>(selector: (value: { byTab: Record<string, unknown> }) => T) => T }) => (
        <div data-testid="session-store">{String(useStore(value => Object.keys(value.byTab).length))}</div>
      ),
      options: { key: '@deepseek-ai/dsh-client-ui-sidebar-browser' },
      store: { create },
    }
    const binding = { key: 'session-a', hooks: {}, keyedHooks: {}, props: {} }
    const context = makeContext(entry, () => source(binding))
    const occurrenceA = createWorkbenchNativeTabOccurrence({
      sessionId: 'session-a', areaId: 'area-a', instanceId: 'browser-a', kind: 'browser', contentId: 'browser:a', title: 'Browser A',
    })
    const occurrenceB = createWorkbenchNativeTabOccurrence({
      sessionId: 'session-a', areaId: 'area-b', instanceId: 'browser-b', kind: 'browser', contentId: 'browser:b', title: 'Browser B',
    })
    const rendererA = createWorkbenchNativeAreaSlotRenderer(context, 'session-a', {}, {
      scopeKey: 'area-a:browser-a', sessionReference: { sessionId: 'session-a' } as never, areaOccurrence: occurrenceA,
    })
    const rendererB = createWorkbenchNativeAreaSlotRenderer(context, 'session-a', {}, {
      scopeKey: 'area-b:browser-b', sessionReference: { sessionId: 'session-a' } as never, areaOccurrence: occurrenceB,
    })
    render(<>{rendererA.render('sidebar.right.pane.tab', {}, { entryKey: '@deepseek-ai/dsh-client-ui-sidebar-browser', hookContext: occurrenceA })}{rendererB.render('sidebar.right.pane.tab', {}, { entryKey: '@deepseek-ai/dsh-client-ui-sidebar-browser', hookContext: occurrenceB })}</>)
    expect(screen.getAllByTestId('session-store')).toHaveLength(2)
    expect(create).toHaveBeenCalledTimes(1)
    rendererA.dispose()
    rendererB.dispose()
    occurrenceA.dispose()
    occurrenceB.dispose()
  })

  it('keeps DSH Files child actions inside the same Area and forwards their owner props', () => {
    const action = {
      component: (props: { absolutePath: string }) => <button type="button">Open {props.absolutePath}</button>,
      options: { key: '@deepseek-ai/dsh-client-ui-open-in-app' },
    }
    const body = {
      component: ({ renderSlot }: { renderSlot: (slot: string, owner: object) => ReactNode }) => (
        <section data-testid="native-files-body">{renderSlot('sidebar.right.tab.files.actions', { absolutePath: 'C:/workspace' })}</section>
      ),
      options: { key: '@deepseek-ai/dsh-client-ui-sidebar-files' },
      children: { 'sidebar.right.tab.files.actions': { kind: 'list', scope: 'session' } },
    }
    const binding = { key: 'session-a', hooks: {}, keyedHooks: {}, props: {} }
    const slots = {
      spec: (name: string) => {
        if (name === 'sidebar.right.pane.tab') return { kind: 'keyed', scope: 'session' }
        if (name === 'sidebar.right.tab.files.actions') return { kind: 'list', scope: 'session' }
        return undefined
      },
      entries: (name: string) => name === 'sidebar.right.pane.tab' ? [body] : name === 'sidebar.right.tab.files.actions' ? [action] : [],
      entriesOfSlot: (name: string) => name === 'sidebar.right.pane.tab' ? [body] : name === 'sidebar.right.tab.files.actions' ? [action] : [],
      subscribe: () => () => {},
      getVersion: () => 0,
      _host: { root: source({ hooks: {}, keyedHooks: {}, props: {} }), scope: () => ({ bindingSource: () => source(binding) }) },
    }
    const occurrence = createWorkbenchNativeTabOccurrence({
      sessionId: 'session-a', areaId: 'area-a', instanceId: 'files-a', kind: 'files', contentId: 'files:a', title: 'Files A',
    })
    const renderer = createWorkbenchNativeAreaSlotRenderer({
      slots, locale: undefined, resources: { source: () => source(undefined) }, sessions: { list: { getSnapshot: () => ({ byId: {} }) } },
    } as never, 'session-a', {}, { sessionReference: { sessionId: 'session-a' } as never, areaOccurrence: occurrence })
    render(renderer.render('sidebar.right.pane.tab', {}, { entryKey: '@deepseek-ai/dsh-client-ui-sidebar-files', hookContext: occurrence }))
    expect(screen.getByRole('button', { name: 'Open C:/workspace' })).toBeTruthy()
    renderer.dispose()
    occurrence.dispose()
  })

  it('keeps DSH Document Preview action and unpreviewable child seats available', () => {
    const action = {
      component: (props: { absolutePath: string }) => <span data-testid="document-action">action:{props.absolutePath}</span>,
      options: { key: 'document-action' },
    }
    const unpreviewable = {
      component: (props: { absolutePath: string }) => <span data-testid="document-unpreviewable">unpreviewable:{props.absolutePath}</span>,
      options: { key: 'document-unpreviewable' },
    }
    const body = {
      component: ({ renderSlot }: { renderSlot: (slot: string, owner: object) => ReactNode }) => (
        <section>
          {renderSlot('sidebar.right.tab.document.actions', { absolutePath: '/workspace/readme.md' })}
          {renderSlot('sidebar.right.tab.document.unpreviewable', { absolutePath: '/workspace/readme.md' })}
        </section>
      ),
      options: { key: '@deepseek-ai/dsh-client-ui-sidebar-documentpreview' },
      children: {
        'sidebar.right.tab.document.actions': { kind: 'list', scope: 'session' },
        'sidebar.right.tab.document.unpreviewable': { kind: 'list', scope: 'session' },
      },
    }
    const binding = { key: 'session-a', hooks: {}, keyedHooks: {}, props: {} }
    const entries: Record<string, readonly object[]> = {
      'sidebar.right.pane.tab': [body],
      'sidebar.right.tab.document.actions': [action],
      'sidebar.right.tab.document.unpreviewable': [unpreviewable],
    }
    const slots = {
      spec: (name: string) => name === 'sidebar.right.pane.tab'
        ? { kind: 'keyed', scope: 'session' }
        : name in entries ? { kind: 'list', scope: 'session' } : undefined,
      entries: (name: string) => entries[name] ?? [],
      entriesOfSlot: (name: string) => entries[name] ?? [],
      subscribe: () => () => {},
      getVersion: () => 0,
      _host: { root: source({ hooks: {}, keyedHooks: {}, props: {} }), scope: () => ({ bindingSource: () => source(binding) }) },
    }
    const occurrence = createWorkbenchNativeTabOccurrence({
      sessionId: 'session-a', areaId: 'area-a', instanceId: 'document-a', kind: 'documentpreview', contentId: 'file:a', title: 'README',
    })
    const renderer = createWorkbenchNativeAreaSlotRenderer({
      slots, locale: undefined, resources: { source: () => source(undefined) }, sessions: { list: { getSnapshot: () => ({ byId: {} }) } },
    } as never, 'session-a', {}, { sessionReference: { sessionId: 'session-a' } as never, areaOccurrence: occurrence })
    render(renderer.render('sidebar.right.pane.tab', {}, { entryKey: '@deepseek-ai/dsh-client-ui-sidebar-documentpreview', hookContext: occurrence }))
    expect(screen.getByTestId('document-action').textContent).toBe('action:/workspace/readme.md')
    expect(screen.getByTestId('document-unpreviewable').textContent).toBe('unpreviewable:/workspace/readme.md')
    renderer.dispose()
    occurrence.dispose()
  })

  it('projects Files-style tab actions, refresh, and visibility into one Area occurrence', () => {
    const openResource = vi.fn()
    const refresh = vi.fn()
    const entry = {
      component: ({ useTabInfo }: { useTabInfo: () => { tab: { visible: boolean; actions: { bindCommands: (commands: { refresh: () => void }) => () => void; openResource: (address: string) => void } } } }) => {
        const { tab } = useTabInfo()
        useEffect(() => tab.actions.bindCommands({ refresh }), [tab.actions])
        return <button type="button" aria-label={tab.visible ? 'open visible file' : 'open hidden file'} onClick={() => tab.actions.openResource('dsh-resource://file/session-a/src/file.ts')}>Open file</button>
      },
      options: { key: '@deepseek-ai/dsh-client-ui-sidebar-files' },
    }
    const binding = { key: 'session-a', hooks: {}, keyedHooks: {}, props: {} }
    const occurrence = createWorkbenchNativeTabOccurrence({
      sessionId: 'session-a', areaId: 'area-a', instanceId: 'files-a', kind: 'files', contentId: 'files:a', title: 'Files A',
      onOpenResource: openResource,
    })
    const renderer = createWorkbenchNativeAreaSlotRenderer(makeContext(entry, () => source(binding)), 'session-a', {}, {
      scopeKey: 'area-a:files-a',
      sessionReference: { sessionId: 'session-a' } as never,
      areaOccurrence: occurrence,
    })
    render(renderer.render('sidebar.right.pane.tab', {}, { entryKey: '@deepseek-ai/dsh-client-ui-sidebar-files', hookContext: occurrence.read }))
    fireEvent.click(screen.getByRole('button', { name: 'open visible file' }))
    expect(openResource).toHaveBeenCalledWith('dsh-resource://file/session-a/src/file.ts', undefined)
    occurrence.refresh()
    expect(refresh).toHaveBeenCalledTimes(1)
    act(() => {
      occurrence.setVisible(false)
    })
    expect(occurrence.read().tab.visible).toBe(false)
    renderer.dispose()
    occurrence.dispose()
  })

  it('renders the native title seat with the same Area-local occurrence', () => {
    const body = {
      component: () => <div>body</div>,
      options: { key: '@deepseek-ai/dsh-client-ui-sidebar-browser' },
    }
    const title = {
      component: ({ useTabInfo }: { useTabInfo: () => { tab: { id: string; title: string; visible: boolean } } }) => {
        const tab = useTabInfo().tab
        return <span>{`${tab.id}:${tab.title}:${String(tab.visible)}`}</span>
      },
      options: { key: '@deepseek-ai/dsh-client-ui-sidebar-browser' },
    }
    const slots = {
      spec: (name: string) => name === 'sidebar.right.pane.tab' || name === 'sidebar.right.pane.tab.title'
        ? { kind: 'keyed', scope: 'session' } : undefined,
      entries: (name: string) => name === 'sidebar.right.pane.tab' ? [body] : name === 'sidebar.right.pane.tab.title' ? [title] : [],
      entriesOfSlot: (name: string) => name === 'sidebar.right.pane.tab' ? [body] : name === 'sidebar.right.pane.tab.title' ? [title] : [],
      subscribe: () => () => {}, getVersion: () => 0,
      _host: { root: source({ hooks: {}, keyedHooks: {}, props: {} }), scope: () => ({ bindingSource: () => source({ key: 'session-a', hooks: {}, keyedHooks: {}, props: {} }) }) },
    }
    const occurrence = createWorkbenchNativeTabOccurrence({
      sessionId: 'session-a', areaId: 'area-a', instanceId: 'browser-a', kind: 'browser', contentId: 'browser:a', title: 'Browser A',
    })
    const renderer = createWorkbenchNativeAreaSlotRenderer({
      slots, locale: undefined, resources: { source: () => source(undefined) }, sessions: { list: { getSnapshot: () => ({ byId: {} }) } },
    } as never, 'session-a', {}, { sessionReference: { sessionId: 'session-a' } as never, areaOccurrence: occurrence })
    render(renderer.render('sidebar.right.pane.tab.title', {}, { entryKey: '@deepseek-ai/dsh-client-ui-sidebar-browser', hookContext: occurrence }))
    expect(screen.getByText('browser-a:Browser A:true')).toBeTruthy()
    act(() => {
      occurrence.setVisible(false)
    })
    expect(screen.getByText('browser-a:Browser A:false')).toBeTruthy()
    renderer.dispose()
    occurrence.dispose()
  })

  it('authorizes nested rendering for specially adapted Browser and Terminal entries', () => {
    const child = {
      component: () => <span data-testid="nested-native-action">native action</span>,
      options: { key: 'native-child-action' },
    }
    const body = {
      component: ({ renderSlot }: { renderSlot: (slot: string, owner: object) => ReactNode }) => (
        <section>{renderSlot('sidebar.right.tab.browser.action', {})}</section>
      ),
      options: { key: '@deepseek-ai/dsh-client-ui-sidebar-browser' },
      children: { 'sidebar.right.tab.browser.action': { kind: 'single', scope: 'session' } },
    }
    const binding = { key: 'session-a', hooks: {}, keyedHooks: {}, props: {} }
    const entries: Record<string, readonly object[]> = {
      'sidebar.right.pane.tab': [body],
      'sidebar.right.tab.browser.action': [child],
    }
    const slots = {
      spec: (name: string) => name === 'sidebar.right.pane.tab'
        ? { kind: 'keyed', scope: 'session' }
        : name === 'sidebar.right.tab.browser.action' ? { kind: 'single', scope: 'session' } : undefined,
      entries: (name: string) => entries[name] ?? [],
      entriesOfSlot: (name: string) => entries[name] ?? [],
      subscribe: () => () => {},
      getVersion: () => 0,
      _host: { root: source({ hooks: {}, keyedHooks: {}, props: {} }), scope: () => ({ bindingSource: () => source(binding) }) },
    }
    const occurrence = createWorkbenchNativeTabOccurrence({
      sessionId: 'session-a', areaId: 'area-a', instanceId: 'browser-a', kind: 'browser', contentId: 'browser:a', title: 'Browser A',
    })
    const renderer = createWorkbenchNativeAreaSlotRenderer({
      slots, locale: undefined, resources: { source: () => source(undefined) }, sessions: { list: { getSnapshot: () => ({ byId: {} }) } },
    } as never, 'session-a', {}, { sessionReference: { sessionId: 'session-a' } as never, areaOccurrence: occurrence })
    render(renderer.render('sidebar.right.pane.tab', {}, { entryKey: '@deepseek-ai/dsh-client-ui-sidebar-browser', hookContext: occurrence }))
    expect(screen.getByTestId('nested-native-action').textContent).toBe('native action')
    expect(document.querySelector('[data-slot-error]')).toBeNull()
    renderer.dispose()
    occurrence.dispose()
  })

  it('provides isolated DSH Factory stores to every native Factory occurrence', () => {
    const create = vi.fn((scopeKey?: string) => ({
      getSnapshot: () => ({ value: scopeKey ?? 'root' }),
      subscribe: () => () => {},
      actions: {},
    }))
    const storeFactory = vi.fn(() => ({ spec: { init: () => ({ value: 'initial' }) }, create }))
    const definition = {
      name: 'conversation.content',
      scope: 'session-maybe',
      store: storeFactory,
      component: ({ useStore }: { useStore: <T>(selector: (state: { value: string }) => T) => T }) => (
        <span data-testid="factory-store-value">{useStore(state => state.value)}</span>
      ),
    }
    const binding = { key: 'session-a', hooks: {}, keyedHooks: {}, props: {} }
    const factoryVersion = { getSnapshot: () => 1, subscribe: () => () => {} }
    const slots = {
      spec: () => undefined,
      entries: () => [],
      entriesOfSlot: () => [],
      subscribe: () => () => {},
      getVersion: () => 0,
      _host: {
        root: source({ hooks: {}, keyedHooks: {}, props: {} }),
        scope: () => ({ bindingSource: () => source(binding) }),
        factoryOf: (name: string) => name === definition.name ? definition : undefined,
        getFactoryVersion: () => factoryVersion.getSnapshot(),
        subscribeFactory: factoryVersion.subscribe,
        isFactoryLive: (value: unknown) => value === definition,
      },
    }
    const context = {
      slots, locale: undefined, resources: { source: () => source(undefined) },
      sessions: { list: { getSnapshot: () => ({ byId: {} }) } },
    }
    const rendererA = createWorkbenchNativeAreaSlotRenderer(context as never, 'session-a', {}, {
      scopeKey: 'area-a:start-a', sessionReference: { sessionId: 'session-a' } as never,
    })
    const rendererB = createWorkbenchNativeAreaSlotRenderer(context as never, 'session-a', {}, {
      scopeKey: 'area-b:start-b', sessionReference: { sessionId: 'session-a' } as never,
    })
    render(<>{rendererA.renderFactory('conversation.content', {})}{rendererB.renderFactory('conversation.content', {})}</>)
    expect(screen.getAllByTestId('factory-store-value').map(node => node.textContent)).toEqual(['session-a', 'session-a'])
    expect(storeFactory).toHaveBeenCalledTimes(2)
    expect(create).toHaveBeenCalledTimes(2)
    expect(create).toHaveBeenNthCalledWith(1, 'session-a')
    expect(create).toHaveBeenNthCalledWith(2, 'session-a')
    rendererA.dispose()
    rendererB.dispose()
  })

  it('keeps nested DSH Factory slot bindings isolated after an Area renderer is disposed', () => {
    const node = {
      component: () => <span data-testid="nested-factory-node">native message</span>,
      options: { key: 'native-message-node' },
    }
    const userText = {
      name: 'conversation.user.text',
      scope: 'root',
      children: { 'conversation.user.text.node': { kind: 'single', scope: 'root' } },
      component: ({ renderSlot }: { renderSlot: (slot: string, owner: object) => ReactNode }) =>
        renderSlot('conversation.user.text.node', {}),
    }
    const conversation = {
      name: 'conversation.content',
      scope: 'session-maybe',
      component: ({ renderFactorySlot }: { renderFactorySlot: (name: string, props: object) => ReactNode }) =>
        renderFactorySlot('conversation.user.text', {}),
    }
    const binding = { key: 'session-a', hooks: {}, keyedHooks: {}, props: {} }
    const factoryVersion = { getSnapshot: () => 1, subscribe: () => () => {} }
    const slots = {
      spec: (name: string) => name === 'conversation.user.text.node'
        ? { kind: 'single', scope: 'root' } : undefined,
      entries: (name: string) => name === 'conversation.user.text.node' ? [node] : [],
      entriesOfSlot: (name: string) => name === 'conversation.user.text.node' ? [node] : [],
      subscribe: () => () => {},
      getVersion: () => 0,
      _host: {
        root: source({ hooks: {}, keyedHooks: {}, props: {} }),
        scope: () => ({ bindingSource: () => source(binding) }),
        factoryOf: (name: string) => name === conversation.name ? conversation
          : name === userText.name ? userText : undefined,
        getFactoryVersion: () => factoryVersion.getSnapshot(),
        subscribeFactory: factoryVersion.subscribe,
        isFactoryLive: () => true,
      },
    }
    const context = {
      slots, locale: undefined, resources: { source: () => source(undefined) },
      sessions: { list: { getSnapshot: () => ({ byId: {} }) } },
    }
    const rendererA = createWorkbenchNativeAreaSlotRenderer(context as never, 'session-a', {}, {
      scopeKey: 'area-a:conversation-a', sessionReference: { sessionId: 'session-a' } as never,
    })
    const first = render(rendererA.renderFactory('conversation.content', {}))
    expect(screen.getByTestId('nested-factory-node').textContent).toBe('native message')
    first.unmount()
    rendererA.dispose()

    const rendererB = createWorkbenchNativeAreaSlotRenderer(context as never, 'session-a', {}, {
      scopeKey: 'area-b:conversation-b', sessionReference: { sessionId: 'session-a' } as never,
    })
    render(rendererB.renderFactory('conversation.content', {}))
    expect(screen.getByTestId('nested-factory-node').textContent).toBe('native message')
    expect(document.querySelector('[data-factory-error="conversation.user.text"]')).toBeNull()
    rendererB.dispose()
  })

  it('routes the native Chat openFile action into the owning Area', async () => {
    const originalOpenFile = vi.fn(async () => {})
    const originalOpenExternalLink = vi.fn()
    const openNativeTab = vi.fn(() => true)
    const onOpenResource = vi.fn((address: string, placement?: Record<string, unknown>) =>
      openWorkbenchResource(openNativeTab, address, placement, 'session-a'))
    const entry = {
      component: (props: {
        openFile: (path: string, options?: { line?: number }) => Promise<void>
        openExternalLink: (url: string) => void
      }) => <>
        <button type="button" onClick={() => { void props.openFile('src/result.ts', { line: 18 }) }}>Open result</button>
        <button type="button" onClick={() => { props.openExternalLink('https://example.com/docs') }}>Open link</button>
      </>,
      options: { key: '@deepseek-ai/dsh-client-ui-chat' },
      inject: vi.fn(() => ({ openFile: originalOpenFile, openExternalLink: originalOpenExternalLink })),
    }
    const binding = { key: 'session-a', hooks: {}, keyedHooks: {}, props: {} }
    const slots = {
      spec: (name: string) => name === 'conversation.view' ? { kind: 'keyed', scope: 'session' } : undefined,
      entries: (name: string) => name === 'conversation.view' ? [entry] : [],
      entriesOfSlot: (name: string) => name === 'conversation.view' ? [entry] : [],
      subscribe: () => () => {},
      getVersion: () => 0,
      _host: { root: source({ hooks: {}, keyedHooks: {}, props: {} }), scope: () => ({ bindingSource: () => source(binding) }) },
    }
    const context = {
      slots,
      locale: undefined,
      resources: { source: () => source(undefined) },
      sessions: { list: { getSnapshot: () => ({ byId: { 'session-a': { cwd: '/workspace' } } }) } },
    }
    const renderer = createWorkbenchNativeAreaSlotRenderer(context as never, 'session-a', {}, {
      scopeKey: 'area-a:conversation-a',
      sessionReference: { sessionId: 'session-a' } as never,
      onOpenResource,
    })
    render(renderer.render('conversation.view', {}, { entryKey: '@deepseek-ai/dsh-client-ui-chat' }))
    fireEvent.click(screen.getByRole('button', { name: 'Open result' }))
    expect(onOpenResource).toHaveBeenCalledWith('dsh-resource://file/session/session-a/src/result.ts', { params: { line: 18 } }, { sessionId: 'session-a' })
    expect(openNativeTab).toHaveBeenCalledWith('documentpreview', {
      params: { line: 18 },
      nativeContentId: 'dsh-resource://file/session/session-a/src/result.ts',
      resourceAddress: 'dsh-resource://file/session/session-a/src/result.ts',
    })
    expect(originalOpenFile).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Open link' }))
    const browserAddress = 'dsh-resource://browser/session/session-a/https%3A%2F%2Fexample.com%2Fdocs'
    expect(onOpenResource).toHaveBeenCalledWith(browserAddress, { params: { url: 'https://example.com/docs' } }, { sessionId: 'session-a' })
    expect(openNativeTab).toHaveBeenCalledWith('browser', {
      params: { url: 'https://example.com/docs' },
      nativeContentId: browserAddress,
      resourceAddress: browserAddress,
      resourceType: 'browser',
    })
    expect(originalOpenExternalLink).not.toHaveBeenCalled()
    renderer.dispose()
  })

  it('routes the DSH 0.2 Chat registration when its identity is provided as id', async () => {
    const originalOpenFile = vi.fn(async () => {})
    const openNativeTab = vi.fn(() => true)
    const onOpenResource = vi.fn((address: string, placement?: Record<string, unknown>) =>
      openWorkbenchResource(openNativeTab, address, placement, 'session-a'))
    const entry = {
      component: (props: { openFile: (path: string) => Promise<void> }) => (
        <button type="button" onClick={() => { void props.openFile('src/rc2-result.ts') }}>Open rc2 result</button>
      ),
      // DSH 0.2's conversation.view registration uses id: 'chat'.
      options: { id: 'chat' },
      inject: vi.fn(() => ({ openFile: originalOpenFile })),
    }
    const binding = { key: 'session-a', hooks: {}, keyedHooks: {}, props: {} }
    const slots = {
      spec: (name: string) => name === 'conversation.view' ? { kind: 'keyed', scope: 'session' } : undefined,
      entries: (name: string) => name === 'conversation.view' ? [entry] : [],
      entriesOfSlot: (name: string) => name === 'conversation.view' ? [entry] : [],
      subscribe: () => () => {},
      getVersion: () => 0,
      _host: { root: source({ hooks: {}, keyedHooks: {}, props: {} }), scope: () => ({ bindingSource: () => source(binding) }) },
    }
    const context = {
      slots,
      locale: undefined,
      resources: { source: () => source(undefined) },
      sessions: { list: { getSnapshot: () => ({ byId: { 'session-a': { cwd: '/workspace' } } }) } },
    }
    const renderer = createWorkbenchNativeAreaSlotRenderer(context as never, 'session-a', {}, {
      scopeKey: 'area-a:conversation-rc2',
      sessionReference: { sessionId: 'session-a' } as never,
      onOpenResource,
    })
    render(renderer.render('conversation.view', {}))
    fireEvent.click(screen.getByRole('button', { name: 'Open rc2 result' }))
    expect(onOpenResource).toHaveBeenCalledWith(
      'dsh-resource://file/session/session-a/src/rc2-result.ts',
      undefined,
      { sessionId: 'session-a' },
    )
    expect(openNativeTab).toHaveBeenCalledWith('documentpreview', {
      nativeContentId: 'dsh-resource://file/session/session-a/src/rc2-result.ts',
      resourceAddress: 'dsh-resource://file/session/session-a/src/rc2-result.ts',
    })
    expect(originalOpenFile).not.toHaveBeenCalled()
    renderer.dispose()
  })

  it('routes native Markdown HTTP links through the Workbench Browser policy', () => {
    const originalOpenExternalLink = vi.fn()
    const openNativeTab = vi.fn(() => true)
    const onOpenResource = vi.fn((address: string, placement?: Record<string, unknown>) =>
      openWorkbenchResource(openNativeTab, address, placement, 'session-a'))
    const entry = {
      component: () => <a href="https://example.com/from-markdown" target="_blank" rel="noreferrer">Open external</a>,
      options: { id: 'chat' },
      inject: vi.fn(() => ({ openExternalLink: originalOpenExternalLink })),
    }
    const binding = { key: 'session-a', hooks: {}, keyedHooks: {}, props: {} }
    const slots = {
      spec: (name: string) => name === 'conversation.view' ? { kind: 'keyed', scope: 'session' } : undefined,
      entries: (name: string) => name === 'conversation.view' ? [entry] : [],
      entriesOfSlot: (name: string) => name === 'conversation.view' ? [entry] : [],
      subscribe: () => () => {},
      getVersion: () => 0,
      _host: { root: source({ hooks: {}, keyedHooks: {}, props: {} }), scope: () => ({ bindingSource: () => source(binding) }) },
    }
    const context = {
      slots,
      locale: undefined,
      resources: { source: () => source(undefined) },
      sessions: { list: { getSnapshot: () => ({ byId: {} }) } },
    }
    const renderer = createWorkbenchNativeAreaSlotRenderer(context as never, 'session-a', {}, {
      sessionReference: { sessionId: 'session-a' } as never,
      onOpenResource,
    })
    render(renderer.render('conversation.view', {}))
    const click = new MouseEvent('click', { bubbles: true, cancelable: true })
    screen.getByRole('link', { name: 'Open external' }).dispatchEvent(click)
    const address = 'dsh-resource://browser/session/session-a/https%3A%2F%2Fexample.com%2Ffrom-markdown'
    expect(click.defaultPrevented).toBe(true)
    expect(onOpenResource).toHaveBeenCalledWith(address, { params: { url: 'https://example.com/from-markdown' } }, { sessionId: 'session-a' })
    expect(openNativeTab).toHaveBeenCalledWith('browser', {
      params: { url: 'https://example.com/from-markdown' },
      nativeContentId: address,
      resourceAddress: address,
      resourceType: 'browser',
    })
    expect(originalOpenExternalLink).not.toHaveBeenCalled()
    renderer.dispose()
  })

  it('routes Tool Inspect before native navigation', () => {
    const originalInspectCall = vi.fn()
    const onOpenResource = vi.fn(() => 'handled' as const)
    const entry = {
      component: (props: { inspectCall: (callId: string) => void }) => (
        <button type="button" onClick={() => props.inspectCall('call-7')}>Inspect tool call</button>
      ),
      options: { id: 'chat' },
      inject: vi.fn(() => ({ inspectCall: originalInspectCall })),
    }
    const binding = { key: 'session-a', hooks: {}, keyedHooks: {}, props: {} }
    const slots = {
      spec: (name: string) => name === 'conversation.view' ? { kind: 'keyed', scope: 'session' } : undefined,
      entries: (name: string) => name === 'conversation.view' ? [entry] : [],
      entriesOfSlot: (name: string) => name === 'conversation.view' ? [entry] : [],
      subscribe: () => () => {},
      getVersion: () => 0,
      _host: { root: source({ hooks: {}, keyedHooks: {}, props: {} }), scope: () => ({ bindingSource: () => source(binding) }) },
    }
    const renderer = createWorkbenchNativeAreaSlotRenderer({
      slots,
      locale: undefined,
      resources: { source: () => source(undefined) },
      sessions: { list: { getSnapshot: () => ({ byId: {} }) } },
    } as never, 'session-a', {}, {
      sessionReference: { sessionId: 'session-a' } as never,
      onOpenResource,
    })
    render(renderer.render('conversation.view', {}))
    fireEvent.click(screen.getByRole('button', { name: 'Inspect tool call' }))
    expect(originalInspectCall).not.toHaveBeenCalled()
    expect(onOpenResource).toHaveBeenCalledWith('dsh-resource://trajectory-inspect/session/session-a/call-7', undefined, { sessionId: 'session-a' })
    renderer.dispose()
  })

  it.each([
    ['schedule-created', 'Created schedule task'],
    ['schedule-catalog', 'Open schedule catalog task'],
  ])('routes DSH schedule entry %s into the owning Area', (identity, label) => {
    const originalOpenTaskDetail = vi.fn()
    const openNativeTab = vi.fn(() => true)
    const onOpenResource = vi.fn((address: string, placement?: Record<string, unknown>) =>
      openWorkbenchResource(openNativeTab, address, placement, 'session-a'))
    const entry = {
      component: (props: { openTaskDetail: (taskId: string) => void }) => (
        <button type="button" onClick={() => props.openTaskDetail('task-42')}>{label}</button>
      ),
      options: { id: identity },
      inject: vi.fn(() => ({ openTaskDetail: originalOpenTaskDetail })),
    }
    const slot = identity === 'schedule-created' ? 'conversation.chat.turnTail' : 'conversation.session.header.utilities'
    const binding = { key: 'session-a', hooks: {}, keyedHooks: {}, props: {} }
    const slots = {
      spec: (name: string) => name === slot ? { kind: 'list', scope: 'session' } : undefined,
      entries: (name: string) => name === slot ? [entry] : [],
      entriesOfSlot: (name: string) => name === slot ? [entry] : [],
      subscribe: () => () => {},
      getVersion: () => 0,
      _host: { root: source({ hooks: {}, keyedHooks: {}, props: {} }), scope: () => ({ bindingSource: () => source(binding) }) },
    }
    const renderer = createWorkbenchNativeAreaSlotRenderer({
      slots,
      locale: undefined,
      resources: { source: () => source(undefined) },
      sessions: { list: { getSnapshot: () => ({ byId: {} }) } },
    } as never, 'session-a', {}, {
      sessionReference: { sessionId: 'session-a' } as never,
      onOpenResource,
    })
    render(renderer.render(slot, {}))
    fireEvent.click(screen.getByRole('button', { name: label }))
    const address = 'dsh-resource://schedule-task/session/session-a/task-42'
    expect(onOpenResource).toHaveBeenCalledWith(address, {
      params: { sessionId: 'session-a', id: 'task-42' },
    }, { sessionId: 'session-a' })
    expect(openNativeTab).toHaveBeenCalledWith('schedule-task', {
      params: { sessionId: 'session-a', id: 'task-42' },
      nativeContentId: address,
      resourceAddress: address,
    })
    expect(originalOpenTaskDetail).not.toHaveBeenCalled()
    renderer.dispose()
  })

  it('routes DSH 0.2 subagent navigation from its native catalog action into the Area', () => {
    const originalOpenChildAside = vi.fn()
    const openNativeTab = vi.fn(() => true)
    const onOpenResource = vi.fn((address: string, placement?: Record<string, unknown>) =>
      openWorkbenchResource(openNativeTab, address, placement, 'session-a'))
    const entry = {
      component: (props: { openChildAside: (address: { parentSessionId: string; childSessionId: string; mode: string }) => void }) => (
        <button type="button" onClick={() => props.openChildAside({ parentSessionId: 'session-a', childSessionId: 'child-b', mode: 'agent' })}>Open child conversation</button>
      ),
      options: { id: 'subagent-catalog' },
      inject: vi.fn(() => ({ openChildAside: originalOpenChildAside })),
    }
    const binding = { key: 'session-a', hooks: {}, keyedHooks: {}, props: {} }
    const slots = {
      spec: (name: string) => name === 'conversation.session.header.actions' ? { kind: 'list', scope: 'session' } : undefined,
      entries: (name: string) => name === 'conversation.session.header.actions' ? [entry] : [],
      entriesOfSlot: (name: string) => name === 'conversation.session.header.actions' ? [entry] : [],
      subscribe: () => () => {},
      getVersion: () => 0,
      _host: { root: source({ hooks: {}, keyedHooks: {}, props: {} }), scope: () => ({ bindingSource: () => source(binding) }) },
    }
    const renderer = createWorkbenchNativeAreaSlotRenderer({
      slots,
      locale: undefined,
      resources: { source: () => source(undefined) },
      sessions: { list: { getSnapshot: () => ({ byId: {} }) } },
    } as never, 'session-a', {}, {
      sessionReference: { sessionId: 'session-a' } as never,
      onOpenResource,
    })
    render(renderer.render('conversation.session.header.actions', {}))
    fireEvent.click(screen.getByRole('button', { name: 'Open child conversation' }))
    const address = 'dsh-resource://subagentchat/session/child-b?parent=session-a&mode=agent'
    expect(onOpenResource).toHaveBeenCalledWith(address, undefined, { sessionId: 'session-a' })
    expect(openNativeTab).toHaveBeenCalledWith('subagent-chat', {
      nativeContentId: address,
      resourceAddress: address,
    })
    expect(originalOpenChildAside).not.toHaveBeenCalled()
    renderer.dispose()
  })

  it('routes the native subagent primary action into the Area without switching the official main Session', () => {
    const originalOpenChild = vi.fn()
    const originalOpenChildAside = vi.fn()
    const openNativeTab = vi.fn(() => true)
    const onOpenResource = vi.fn((address: string, placement?: Record<string, unknown>) =>
      openWorkbenchResource(openNativeTab, address, placement, 'session-a'))
    const entry = {
      component: (props: { openChild: (address: { parentSessionId: string; childSessionId: string; mode: string }) => void }) => (
        <button type="button" onClick={() => props.openChild({ parentSessionId: 'session-a', childSessionId: 'child-b', mode: 'agent' })}>Open child in conversation</button>
      ),
      options: { id: 'subagent-catalog' },
      inject: vi.fn(() => ({ openChild: originalOpenChild, openChildAside: originalOpenChildAside })),
    }
    const binding = { key: 'session-a', hooks: {}, keyedHooks: {}, props: {} }
    const slots = {
      spec: (name: string) => name === 'conversation.session.header.actions' ? { kind: 'list', scope: 'session' } : undefined,
      entries: (name: string) => name === 'conversation.session.header.actions' ? [entry] : [],
      entriesOfSlot: (name: string) => name === 'conversation.session.header.actions' ? [entry] : [],
      subscribe: () => () => {},
      getVersion: () => 0,
      _host: { root: source({ hooks: {}, keyedHooks: {}, props: {} }), scope: () => ({ bindingSource: () => source(binding) }) },
    }
    const renderer = createWorkbenchNativeAreaSlotRenderer({
      slots,
      locale: undefined,
      resources: { source: () => source(undefined) },
      sessions: { list: { getSnapshot: () => ({ byId: {} }) } },
    } as never, 'session-a', {}, {
      sessionReference: { sessionId: 'session-a' } as never,
      onOpenResource,
    })
    render(renderer.render('conversation.session.header.actions', {}))
    fireEvent.click(screen.getByRole('button', { name: 'Open child in conversation' }))
    const address = 'dsh-resource://subagentchat/session/child-b?parent=session-a&mode=agent'
    expect(onOpenResource).toHaveBeenCalledWith(address, undefined, { sessionId: 'session-a' })
    expect(openNativeTab).toHaveBeenCalledWith('subagent-chat', {
      nativeContentId: address,
      resourceAddress: address,
    })
    expect(originalOpenChild).not.toHaveBeenCalled()
    expect(originalOpenChildAside).not.toHaveBeenCalled()
    renderer.dispose()
  })

  it('routes native Deliverables change reviews into the owning Area', () => {
    const originalOpenChangesReview = vi.fn()
    const openNativeTab = vi.fn(() => true)
    const onOpenResource = vi.fn((address: string, placement?: Record<string, unknown>) =>
      openWorkbenchResource(openNativeTab, address, placement, 'session-a'))
    const entry = {
      component: (props: { openChangesReview: (coordinates: { sessionId: string; seq: number; turn: number }, index: number) => void }) => (
        <button type="button" onClick={() => { props.openChangesReview({ sessionId: 'session-a', seq: 12, turn: 2 }, 1) }}>Review changes</button>
      ),
      options: { id: '@deepseek-ai/dsh-client-ui-deliverables' },
      inject: vi.fn(() => ({ openChangesReview: originalOpenChangesReview })),
    }
    const binding = { key: 'session-a', hooks: {}, keyedHooks: {}, props: {} }
    const slots = {
      spec: (name: string) => name === 'conversation.chat.turnTail' ? { kind: 'list', scope: 'session' } : undefined,
      entries: (name: string) => name === 'conversation.chat.turnTail' ? [entry] : [],
      entriesOfSlot: (name: string) => name === 'conversation.chat.turnTail' ? [entry] : [],
      subscribe: () => () => {},
      getVersion: () => 0,
      _host: { root: source({ hooks: {}, keyedHooks: {}, props: {} }), scope: () => ({ bindingSource: () => source(binding) }) },
    }
    const renderer = createWorkbenchNativeAreaSlotRenderer({
      slots,
      locale: undefined,
      resources: { source: () => source(undefined) },
      sessions: { list: { getSnapshot: () => ({ byId: {} }) } },
    } as never, 'session-a', {}, { sessionReference: { sessionId: 'session-a' } as never, onOpenResource })
    render(renderer.render('conversation.chat.turnTail', {}))
    fireEvent.click(screen.getByRole('button', { name: 'Review changes' }))
    const address = 'dsh-resource://changes-review/session/session-a/12/2'
    expect(onOpenResource).toHaveBeenCalledWith(address, { params: { index: 1 } }, { sessionId: 'session-a' })
    expect(openNativeTab).toHaveBeenCalledWith('changes-review', {
      params: { index: 1 },
      nativeContentId: address,
      resourceAddress: address,
    })
    expect(originalOpenChangesReview).not.toHaveBeenCalled()
    renderer.dispose()
  })

  it('ignores a change-review event whose Session differs from the injected Conversation', () => {
    const originalOpenChangesReview = vi.fn()
    const onOpenResource = vi.fn()
    const entry = {
      component: (props: { openChangesReview: (coordinates: { sessionId: string; seq: number; turn: number }, index: number) => void }) => (
        <button type="button" onClick={() => { props.openChangesReview({ sessionId: 'session-b', seq: 12, turn: 2 }, 1) }}>Review another Session</button>
      ),
      options: { id: '@deepseek-ai/dsh-client-ui-deliverables' },
      inject: vi.fn(() => ({ openChangesReview: originalOpenChangesReview })),
    }
    const binding = { key: 'session-a', hooks: {}, keyedHooks: {}, props: {} }
    const slots = {
      spec: (name: string) => name === 'conversation.chat.turnTail' ? { kind: 'list', scope: 'session' } : undefined,
      entries: (name: string) => name === 'conversation.chat.turnTail' ? [entry] : [],
      entriesOfSlot: (name: string) => name === 'conversation.chat.turnTail' ? [entry] : [],
      subscribe: () => () => {},
      getVersion: () => 0,
      _host: { root: source({ hooks: {}, keyedHooks: {}, props: {} }), scope: () => ({ bindingSource: () => source(binding) }) },
    }
    const renderer = createWorkbenchNativeAreaSlotRenderer({
      slots,
      locale: undefined,
      resources: { source: () => source(undefined) },
      sessions: { list: { getSnapshot: () => ({ byId: {} }) } },
    } as never, 'session-a', {}, {
      sessionReference: { sessionId: 'session-a' } as never,
      onOpenResource,
    })
    render(renderer.render('conversation.chat.turnTail', {}))
    fireEvent.click(screen.getByRole('button', { name: 'Review another Session' }))
    expect(onOpenResource).not.toHaveBeenCalled()
    expect(originalOpenChangesReview).not.toHaveBeenCalled()
    renderer.dispose()
  })

  it('does not fall through to the official Sidebar for a late child plan', () => {
    const originalOpenPlan = vi.fn()
    const entry = {
      component: (props: { openPlan: (callId: string) => void }) => <button type="button" onClick={() => props.openPlan('call-1')}>Open plan</button>,
      options: { id: '@deepseek-ai/dsh-client-ui-plan' },
      inject: vi.fn(() => ({ openPlan: originalOpenPlan })),
    }
    const binding = { key: 'session-a', hooks: {}, keyedHooks: {}, props: {} }
    const slots = {
      spec: (name: string) => name === 'conversation.chat.turnTail' ? { kind: 'list', scope: 'session' } : undefined,
      entries: (name: string) => name === 'conversation.chat.turnTail' ? [entry] : [],
      entriesOfSlot: (name: string) => name === 'conversation.chat.turnTail' ? [entry] : [],
      subscribe: () => () => {}, getVersion: () => 0,
      _host: { root: source({ hooks: {}, keyedHooks: {}, props: {} }), scope: () => ({ bindingSource: () => source(binding) }) },
    }
    const renderer = createWorkbenchNativeAreaSlotRenderer({
      slots, locale: undefined, resources: { source: () => source(undefined) },
      sessions: {
        list: { getSnapshot: () => ({ byId: {} }) },
        subagentAddress: () => ({ parentSessionId: 'session-old', childSessionId: 'session-b', mode: 'continuable' }),
      },
    } as never, 'session-a', {}, {
      sessionReference: { sessionId: 'session-a' } as never,
      // Simulate an Area that rejects the resource because it was rebound.
      onOpenResource: () => false,
    })
    render(renderer.render('conversation.chat.turnTail', {}))
    fireEvent.click(screen.getByRole('button', { name: 'Open plan' }))
    expect(originalOpenPlan).not.toHaveBeenCalled()
    renderer.dispose()
  })

  it('does not fall through when a rejected child plan still matches the renderer parent', () => {
    const originalOpenPlan = vi.fn()
    const entry = {
      component: (props: { openPlan: (callId: string) => void }) => <button type="button" onClick={() => props.openPlan('call-1')}>Open plan</button>,
      options: { id: '@deepseek-ai/dsh-client-ui-plan' },
      inject: vi.fn(() => ({ openPlan: originalOpenPlan })),
    }
    const binding = { key: 'session-a', hooks: {}, keyedHooks: {}, props: {} }
    const slots = {
      spec: (name: string) => name === 'conversation.chat.turnTail' ? { kind: 'list', scope: 'session' } : undefined,
      entries: (name: string) => name === 'conversation.chat.turnTail' ? [entry] : [],
      entriesOfSlot: (name: string) => name === 'conversation.chat.turnTail' ? [entry] : [],
      subscribe: () => () => {},
      getVersion: () => 0,
      _host: { root: source({ hooks: {}, keyedHooks: {}, props: {} }), scope: () => ({ bindingSource: () => source(binding) }) },
    }
    const renderer = createWorkbenchNativeAreaSlotRenderer({
      slots, locale: undefined, resources: { source: () => source(undefined) },
      sessions: {
        list: { getSnapshot: () => ({ byId: {} }) },
        subagentAddress: () => ({ parentSessionId: 'session-a', childSessionId: 'session-b', mode: 'continuable' }),
      },
    } as never, 'session-a', {}, {
      sessionReference: { sessionId: 'session-a' } as never,
      // A resource can match the old renderer's parent and still be rejected
      // because its owning Area has since been rebound or closed.
      onOpenResource: () => false,
    })
    render(renderer.render('conversation.chat.turnTail', {}))
    fireEvent.click(screen.getByRole('button', { name: 'Open plan' }))
    expect(originalOpenPlan).not.toHaveBeenCalled()
    renderer.dispose()
  })

  it('uses the official Sidebar only when the Area route explicitly requests native fallback', () => {
    const originalOpenPlan = vi.fn()
    const entry = {
      component: (props: { openPlan: (callId: string) => void }) => <button type="button" onClick={() => props.openPlan('call-1')}>Open plan</button>,
      options: { id: '@deepseek-ai/dsh-client-ui-plan' },
      inject: vi.fn(() => ({ openPlan: originalOpenPlan })),
    }
    const binding = { key: 'session-a', hooks: {}, keyedHooks: {}, props: {} }
    const slots = {
      spec: (name: string) => name === 'conversation.chat.turnTail' ? { kind: 'list', scope: 'session' } : undefined,
      entries: (name: string) => name === 'conversation.chat.turnTail' ? [entry] : [],
      entriesOfSlot: (name: string) => name === 'conversation.chat.turnTail' ? [entry] : [],
      subscribe: () => () => {},
      getVersion: () => 0,
      _host: { root: source({ hooks: {}, keyedHooks: {}, props: {} }), scope: () => ({ bindingSource: () => source(binding) }) },
    }
    const renderer = createWorkbenchNativeAreaSlotRenderer({
      slots, locale: undefined, resources: { source: () => source(undefined) },
      sessions: {
        list: { getSnapshot: () => ({ byId: {} }) },
        subagentAddress: () => ({ parentSessionId: 'session-a', childSessionId: 'session-b', mode: 'continuable' }),
      },
    } as never, 'session-a', {}, {
      sessionReference: { sessionId: 'session-a' } as never,
      onOpenResource: () => 'native-fallback',
    })
    render(renderer.render('conversation.chat.turnTail', {}))
    fireEvent.click(screen.getByRole('button', { name: 'Open plan' }))
    expect(originalOpenPlan).toHaveBeenCalledWith('call-1')
    renderer.dispose()
  })
})
