// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createElement, StrictMode, useState, type ComponentType } from 'react'
import { createWorkbenchOfficialAreaEditors } from '../src/client/official-area-editors.tsx'

function nativeConversationContext(options: {
  readonly onOfficialWorkspaceOpen: () => void
  readonly injectArgs: unknown[][]
  readonly onHeaderAction?: () => void
}) {
  const headerEntry = {
    options: { id: 'native-conversation-header' },
    component: () => createElement('header', { 'data-testid': 'native-conversation-header' },
      createElement('button', { type: 'button', onClick: options.onHeaderAction, 'aria-label': 'DSH header action' }, 'Native action')),
  }
  const factory = {
      name: 'conversation.content',
      scope: 'session-maybe',
      slots: { widthControls: { scope: 'root' } },
      component: (props: { readonly selectWorkspace?: (workspaceId: string) => void; readonly useFactorySlot?: (name: string, fallback: ComponentType<Record<string, unknown>>) => ComponentType<Record<string, unknown>>; readonly sessionId?: string; readonly phase?: string }) => {
      const [revision, setRevision] = useState(0)
      const NativeView = props.useFactorySlot?.('widthControls', () => null) ?? (() => null)
      return <div data-native-session-id={props.sessionId}
        data-native-phase={props.phase} data-native-render-revision={revision}>
        <NativeView />
        <button type="button" onClick={() => { setRevision(value => value + 1); props.selectWorkspace?.('workspace-native') }}>
          选择工作区
        </button>
        <button type="button" aria-label="原生 Agent 模式" />
        <textarea aria-label="原生 Composer" />
      </div>
    },
    inject: (...args: never[]) => {
      options.injectArgs.push(args)
      return { selectWorkspace: options.onOfficialWorkspaceOpen }
    },
  }
  const source = <T,>(value: T) => ({ getSnapshot: () => value, subscribe: () => () => {} })
  const conversationSnapshot = source({ views: {}, activeTargets: new Set<string>() })
  const slots = {
    spec: (name: string) => name === 'conversation.content'
      ? { kind: 'single', scope: 'session-maybe' }
      : name === 'conversation.header' ? { kind: 'single', scope: 'root' } : undefined,
    entries: (name: string) => name === 'conversation.header' ? [headerEntry] : [],
    entriesOfSlot: (name: string) => name === 'conversation.header' ? [headerEntry] : [],
    subscribe: () => () => {},
    getVersion: () => 0,
    factory: (name: string) => name === 'conversation.content' ? factory : undefined,
    factoryVersion: () => 1,
    subscribeFactory: () => () => {},
    isFactoryLive: () => true,
  }
  return {
    resources: { source: () => source(undefined) },
    uiConversation: { binding: () => ({ snapshot: conversationSnapshot }) },
    slots,
    locale: undefined,
  } as never
}

describe('Core native Conversation editors', () => {
  afterEach(() => cleanup())

  it('renders the DSH Conversation Factory without a Workbench-owned Composer', () => {
    const editors = createWorkbenchOfficialAreaEditors(nativeConversationContext({
      onOfficialWorkspaceOpen: vi.fn(), injectArgs: [],
    }))
    render(createElement(editors.start as unknown as ComponentType<Record<string, unknown>>, {
      instanceId: 'start-test', areaId: 'area-test', state: {}, setState: vi.fn(), close: vi.fn(), focus: vi.fn(),
      placeConversation: vi.fn(() => Promise.resolve({ workspaceId: 'workspace-test', sessionId: 'session-test' })),
    }))
    expect(screen.getByRole('button', { name: '选择工作区' })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Agent/ })).toBeTruthy()
    expect(screen.getByRole('textbox', { name: /Composer/ })).toBeTruthy()
    expect(screen.getByText('选择工作区').parentElement?.getAttribute('data-native-phase')).toBe('hero')
    expect(screen.getByText('选择工作区').parentElement?.getAttribute('data-native-session-id')).toBeNull()
    expect(screen.queryByTestId('workbench-start-composer')).toBeNull()
    expect(screen.queryByLabelText('新建对话消息')).toBeNull()
  })

  it('renders and activates the native Conversation header inside the bound Area', async () => {
    const onHeaderAction = vi.fn()
    const sessionSnapshot = { blank: false, running: false, promptAttempted: false, awaitingFirstTurn: false, openState: 'open' }
    const session = {
      getSnapshot: () => sessionSnapshot,
      subscribe: () => () => {},
    }
    const reference = {
      sessionId: 'session-with-header',
      binding: { session },
      ready: Promise.resolve(),
      release: vi.fn(),
    }
    const ctx = nativeConversationContext({
      onOfficialWorkspaceOpen: vi.fn(), injectArgs: [], onHeaderAction,
    }) as unknown as { sessions: { retain: ReturnType<typeof vi.fn> } }
    ctx.sessions = { retain: vi.fn(() => reference) }
    const editors = createWorkbenchOfficialAreaEditors(ctx as never)
    const Conversation = editors.conversation as unknown as ComponentType<Record<string, unknown>>
    render(createElement(Conversation, {
      instanceId: 'conversation-header-test', areaId: 'area-header-test', areaClaim: 'claim-header-test',
      sessionId: 'session-with-header', state: {}, setState: vi.fn(), close: vi.fn(), focus: vi.fn(),
    }))

    const action = await screen.findByRole('button', { name: 'DSH header action' })
    expect(action.closest('[data-testid="native-conversation-header"]')).not.toBeNull()
    fireEvent.click(action)
    expect(onHeaderAction).toHaveBeenCalledOnce()
  })

  it('routes each Start picker to its own Area placement without opening the official Session', async () => {
    const onOfficialWorkspaceOpen = vi.fn()
    const injectArgs: unknown[][] = []
    const editors = createWorkbenchOfficialAreaEditors(nativeConversationContext({ onOfficialWorkspaceOpen, injectArgs }))
    const placeA = vi.fn(() => Promise.resolve({ workspaceId: 'workspace-area-a', sessionId: 'session-a' }))
    const placeB = vi.fn(() => Promise.resolve({ workspaceId: 'workspace-area-b', sessionId: 'session-b' }))
    const owner = (areaId: string, placeConversation: typeof placeA) => ({
      instanceId: `start-${areaId}`,
      areaId,
      state: {},
      setState: vi.fn(),
      close: vi.fn(),
      focus: vi.fn(),
      placeConversation,
    })

    const Start = editors.start as unknown as ComponentType<Record<string, unknown>>
    render(<>
      {createElement(Start, owner('area-a', placeA))}
      {createElement(Start, owner('area-b', placeB))}
    </>)

    const buttons = screen.getAllByRole('button', { name: '选择工作区' })
    expect(buttons).toHaveLength(2)
    expect(injectArgs).toEqual([[undefined], [undefined]])

    fireEvent.click(buttons[0]!)
    await waitFor(() => expect(placeA).toHaveBeenCalledWith({ workspaceId: 'workspace-native', presentation: 'start' }))
    expect(placeB).not.toHaveBeenCalled()
    expect(onOfficialWorkspaceOpen).not.toHaveBeenCalled()

    fireEvent.click(buttons[1]!)
    await waitFor(() => expect(placeB).toHaveBeenCalledWith({ workspaceId: 'workspace-native', presentation: 'start' }))
    expect(onOfficialWorkspaceOpen).not.toHaveBeenCalled()
  })

  it('coalesces repeated native Workspace picks into one Area binding request', async () => {
    const onOfficialWorkspaceOpen = vi.fn()
    const injectArgs: unknown[][] = []
    const editors = createWorkbenchOfficialAreaEditors(nativeConversationContext({ onOfficialWorkspaceOpen, injectArgs }))
    let resolvePlacement: ((value: { workspaceId: string; sessionId: string }) => void) | undefined
    const placeConversation = vi.fn(() => new Promise<{ workspaceId: string; sessionId: string }>(resolve => { resolvePlacement = resolve }))
    const Start = editors.start as unknown as ComponentType<Record<string, unknown>>
    render(createElement(Start, {
      instanceId: 'start-busy', areaId: 'area-busy', state: {}, setState: vi.fn(), close: vi.fn(), focus: vi.fn(), placeConversation,
    }))

    const button = screen.getByRole('button', { name: '选择工作区' })
    fireEvent.click(button)
    fireEvent.click(button)
    expect(placeConversation).toHaveBeenCalledTimes(1)
    resolvePlacement?.({ workspaceId: 'workspace-native', sessionId: 'session-busy' })
    await waitFor(() => expect(placeConversation).toHaveBeenCalledTimes(1))
  })

  it('keeps the Start surface recoverable when Workbench placement fails', async () => {
    const editors = createWorkbenchOfficialAreaEditors(nativeConversationContext({
      onOfficialWorkspaceOpen: vi.fn(), injectArgs: [],
    }))
    const placeConversation = vi.fn(async () => { throw new Error('host unavailable') })
    const Start = editors.start as unknown as ComponentType<Record<string, unknown>>
    render(createElement(Start, {
      instanceId: 'start-failed', areaId: 'area-failed', state: {}, setState: vi.fn(), close: vi.fn(), focus: vi.fn(), placeConversation,
    }))

    fireEvent.click(screen.getByRole('button', { name: '选择工作区' }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('\u65e0\u6cd5\u51c6\u5907\u6b64\u5de5\u4f5c\u533a\u5bf9\u8bdd'))
    expect(screen.queryByTestId('workbench-start-composer')).toBeNull()
    expect(screen.getByRole('button', { name: '选择工作区' })).toBeTruthy()
  })

  it.each(['accepted', 'rejected', 'closed'] as const)('promotes only an accepted prompt from a live Start (%s)', async outcome => {
    let snapshot = { blank: true, running: false, promptAttempted: false, awaitingFirstTurn: false }
    const listeners = new Set<() => void>()
    const session = {
      getSnapshot: () => snapshot,
      subscribe: (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener) },
    }
    const reference = {
      sessionId: 'session-prepared',
      binding: { session },
      ready: Promise.resolve(),
      release: vi.fn(),
    }
    const ctx = nativeConversationContext({ onOfficialWorkspaceOpen: vi.fn(), injectArgs: [] }) as unknown as {
      sessions: { retain: ReturnType<typeof vi.fn> }
    }
    ctx.sessions = { retain: vi.fn(() => reference) }
    const completePreparedConversation = vi.fn(() => true)
    const editors = createWorkbenchOfficialAreaEditors(ctx as never)
    const Start = editors.start as unknown as ComponentType<Record<string, unknown>>
    const view = render(createElement(Start, {
      instanceId: 'prepared-start', areaId: 'area-prepared', areaClaim: 'claim-1',
      sessionId: 'session-prepared', workspaceId: 'workspace-prepared', bindingGeneration: 4,
      state: {}, setState: vi.fn(), close: vi.fn(), focus: vi.fn(),
      placeConversation: vi.fn(), completePreparedConversation,
    }))

    await waitFor(() => expect(document.querySelector('[data-workbench-prepared-session="session-prepared"]')).not.toBeNull())
    expect(screen.getByRole('button', { name: /Agent/ })).toBeTruthy()
    expect(screen.getByRole('textbox', { name: /Composer/ })).toBeTruthy()
    expect(completePreparedConversation).not.toHaveBeenCalled()

    // Starting a send or awaiting turn/start alone is not native acceptance.
    act(() => {
      snapshot = { ...snapshot, promptAttempted: true, awaitingFirstTurn: true }
      for (const listener of listeners) listener()
    })
    expect(completePreparedConversation).not.toHaveBeenCalled()
    if (outcome === 'closed') view.unmount()
    act(() => {
      snapshot = { ...snapshot, blank: outcome === 'rejected' }
      for (const listener of listeners) listener()
    })
    if (outcome !== 'accepted') {
      expect(completePreparedConversation).not.toHaveBeenCalled()
      if (outcome === 'closed') {
        expect(reference.release).toHaveBeenCalledOnce()
        expect(listeners.size).toBe(0)
      }
      return
    }
    await waitFor(() => expect(completePreparedConversation).toHaveBeenCalledWith({
      moduleInstanceId: 'prepared-start',
      bindingGeneration: 4,
      target: { sessionId: 'session-prepared', workspaceId: 'workspace-prepared' },
    }))
    expect(completePreparedConversation).toHaveBeenCalledOnce()
    act(() => {
      snapshot = { ...snapshot, running: true }
      for (const listener of listeners) listener()
    })
    expect(completePreparedConversation).toHaveBeenCalledOnce()
  })

  it('keeps the native Factory live across React StrictMode effect replay', async () => {
    const editors = createWorkbenchOfficialAreaEditors(nativeConversationContext({
      onOfficialWorkspaceOpen: vi.fn(), injectArgs: [],
    }))
    const placeConversation = vi.fn(() => Promise.resolve({ workspaceId: 'workspace-strict', sessionId: 'session-strict' }))
    const Start = editors.start as unknown as ComponentType<Record<string, unknown>>
    const errors: unknown[] = []
    const originalError = console.error
    console.error = (...args: unknown[]) => { errors.push(args) }
    try {
      render(<StrictMode><Start instanceId="strict-start" areaId="strict-area" state={{}} setState={vi.fn()} close={vi.fn()} focus={vi.fn()} placeConversation={placeConversation} /></StrictMode>)
      fireEvent.click(screen.getByRole('button', { name: '选择工作区' }))
      await waitFor(() => expect(placeConversation).toHaveBeenCalledTimes(1))
      expect(errors.flat().some(value => String(value).includes('disposed Factory'))).toBe(false)
    } finally {
      console.error = originalError
    }
  })

  it('preserves placement error feedback after StrictMode effect replay', async () => {
    const editors = createWorkbenchOfficialAreaEditors(nativeConversationContext({
      onOfficialWorkspaceOpen: vi.fn(), injectArgs: [],
    }))
    const placeConversation = vi.fn(async () => { throw new Error('host unavailable') })
    const Start = editors.start as unknown as ComponentType<Record<string, unknown>>
    render(<StrictMode><Start instanceId="strict-failure" areaId="strict-area" state={{}} setState={vi.fn()} close={vi.fn()} focus={vi.fn()} placeConversation={placeConversation} /></StrictMode>)
    fireEvent.click(screen.getByRole('button', { name: '选择工作区' }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('\u65e0\u6cd5\u51c6\u5907\u6b64\u5de5\u4f5c\u533a\u5bf9\u8bdd'))
    fireEvent.click(screen.getByRole('button', { name: '选择工作区' }))
    await waitFor(() => expect(placeConversation).toHaveBeenCalledTimes(2))
  })

  it('keeps a bound Conversation Factory live across StrictMode effect replay', async () => {
    const sessionSnapshot = { blank: false, running: false, promptAttempted: false, awaitingFirstTurn: false, openState: 'open' }
    const session = {
      getSnapshot: () => sessionSnapshot,
      subscribe: () => () => {},
    }
    const reference = {
      sessionId: 'session-bound',
      binding: { session },
      ready: Promise.resolve(),
      release: vi.fn(),
    }
    const ctx = nativeConversationContext({ onOfficialWorkspaceOpen: vi.fn(), injectArgs: [] }) as unknown as {
      sessions: { retain: ReturnType<typeof vi.fn> }
    }
    const retain = vi.fn(() => reference)
    ctx.sessions = { retain }
    const editors = createWorkbenchOfficialAreaEditors(ctx as never)
    const Conversation = editors.conversation as unknown as ComponentType<Record<string, unknown>>
    const errors: unknown[] = []
    const originalError = console.error
    console.error = (...args: unknown[]) => { errors.push(args) }
    try {
      const view = render(<StrictMode><Conversation
        instanceId="bound-strict"
        areaId="bound-area"
        areaClaim="claim-bound"
        sessionId="session-bound"
        state={{}}
        setState={vi.fn()}
        close={vi.fn()}
        focus={vi.fn()}
      /></StrictMode>)
      expect(retain).toHaveBeenCalled()
      await waitFor(() => expect(screen.getByRole('textbox', { name: /Composer/ })).toBeTruthy())
      expect(errors.flat().some(value => String(value).includes('disposed Factory'))).toBe(false)

      // A second Workbench mount must receive a fresh Factory binding. The
      // scoped renderer cache is global by definition, so reusing the
      // original DSH definition here would keep the first, disposed host.
      view.unmount()
      await act(async () => { await Promise.resolve() })
      render(<StrictMode><Conversation
        instanceId="bound-strict-again"
        areaId="bound-area"
        areaClaim="claim-bound"
        sessionId="session-bound"
        state={{}}
        setState={vi.fn()}
        close={vi.fn()}
        focus={vi.fn()}
      /></StrictMode>)
      await waitFor(() => expect(screen.getByRole('textbox', { name: /Composer/ })).toBeTruthy())
      expect(document.querySelector('[data-factory-error]')).toBeNull()
      expect(errors.flat().some(value => String(value).includes('disposed Factory'))).toBe(false)
    } finally {
      console.error = originalError
    }
  })

  it('keeps a bound Conversation renderer stable when host callbacks change identity', async () => {
    const sessionSnapshot = { blank: false, running: false, promptAttempted: false, awaitingFirstTurn: false, openState: 'open' }
    const session = {
      getSnapshot: () => sessionSnapshot,
      subscribe: () => () => {},
    }
    const reference = {
      sessionId: 'session-callback-churn',
      binding: { session },
      ready: Promise.resolve(),
      release: vi.fn(),
    }
    const ctx = nativeConversationContext({ onOfficialWorkspaceOpen: vi.fn(), injectArgs: [] }) as unknown as {
      sessions: { retain: ReturnType<typeof vi.fn> }
    }
    ctx.sessions = { retain: vi.fn(() => reference) }
    const editors = createWorkbenchOfficialAreaEditors(ctx as never)
    const Conversation = editors.conversation as unknown as ComponentType<Record<string, unknown>>
    const errors: unknown[] = []
    const originalError = console.error
    console.error = (...args: unknown[]) => { errors.push(args) }
    try {
      const view = render(<Conversation
        instanceId="callback-churn"
        areaId="callback-area"
        areaClaim="callback-claim"
        sessionId="session-callback-churn"
        state={{}}
        setState={vi.fn()}
        close={vi.fn()}
        focus={vi.fn()}
        openNativeTab={vi.fn()}
      />)
      await waitFor(() => expect(screen.getByRole('textbox', { name: /Composer/ })).toBeTruthy())
      view.rerender(<Conversation
        instanceId="callback-churn"
        areaId="callback-area"
        areaClaim="callback-claim"
        sessionId="session-callback-churn"
        state={{}}
        setState={vi.fn()}
        close={vi.fn()}
        focus={vi.fn()}
        openNativeTab={vi.fn()}
      />)
      await act(async () => { await Promise.resolve() })
      expect(errors.flat().some(value => String(value).includes('disposed Factory'))).toBe(false)
    } finally {
      console.error = originalError
    }
  })
})
