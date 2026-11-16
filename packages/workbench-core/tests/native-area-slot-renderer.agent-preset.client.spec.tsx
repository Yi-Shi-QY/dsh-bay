// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createElement, useEffect, type ComponentType } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import { createWorkbenchNativeAreaSlotRenderer } from '../src/client/native-area-slot-renderer.tsx'

function localSource<T>(value: T) {
  return { getSnapshot: () => value, subscribe: () => () => {} }
}

function nativeSeat(props: Record<string, any>) {
  const visible = props.useSessionRetainInfo((info: { retainedBy?: { mainView?: number } } | undefined) =>
    props.sessionId === undefined || (info?.retainedBy?.mainView ?? 0) > 0)
  const developerTools = props.useDeveloperTools((enabled: boolean) => enabled)
  const state = props.useAgentPresetSeat((snapshot: { options: readonly { id: string; name?: string }[]; current: string }) => snapshot)
  useEffect(() => { void props.load() }, [props.load])
  if (!visible || !developerTools || state.options.length === 0 || state.current === '') return null
  return <div>
    <button type="button" aria-label={`Agent 模式：${state.current}`}>{state.current}</button>
    {state.options.map(option => <button key={option.id} type="button" onClick={() => { void props.select(option.id) }}>
      {option.name ?? option.id}
    </button>)}
  </div>
}

function makeContext(options: {
  readonly selectPreset: ReturnType<typeof vi.fn>
  readonly listPresets?: ReturnType<typeof vi.fn>
}) {
  const entry = {
    component: nativeSeat as ComponentType<Record<string, unknown>>,
    options: { id: 'native-agent-preset' },
    inject: () => ({ hooks: { developerTools: localSource(true) } }),
  }
  const source = localSource(undefined)
  const slots = {
    spec: (name: string) => name === 'conversation.hero.agentPreset' ? { kind: 'single', scope: 'root' } : undefined,
    entries: (name: string) => name === 'conversation.hero.agentPreset' ? [entry] : [],
    entriesOfSlot: (name: string) => name === 'conversation.hero.agentPreset' ? [entry] : [],
    subscribe: () => () => {},
    getVersion: () => 0,
    factory: () => undefined,
    factoryVersion: () => 0,
    subscribeFactory: () => () => {},
    isFactoryLive: () => true,
  }
  const ctx = {
    resources: { source: () => source },
    slots,
    locale: undefined,
    configForms: { developerTools: { enabled: localSource(true) } },
    sessions: {
      list: { getSnapshot: () => ({ byId: {} }) },
    },
    remote: {
      agentPresets: {
        list: options.listPresets ?? vi.fn(async () => ({ ok: true, value: { presets: [
          { id: 'default', name: '默认模式', isDefault: true },
          { id: 'coding', name: '编码模式', isDefault: false },
        ] } })),
        select: options.selectPreset,
      },
    },
  }
  return ctx as unknown as Context
}

describe('Workbench native Agent preset Area adapter', () => {
  afterEach(() => cleanup())

  it('keeps an unbound Start choice local to that Area instead of staging DSH global state', async () => {
    const selectPreset = vi.fn()
    const ctx = makeContext({ selectPreset })
    const chooseA = vi.fn()
    const chooseB = vi.fn()
    const rendererA = createWorkbenchNativeAreaSlotRenderer(ctx, undefined, {}, { scopeKey: 'area-a:start-a', onSelectAgentPreset: chooseA })
    const rendererB = createWorkbenchNativeAreaSlotRenderer(ctx, undefined, {}, { scopeKey: 'area-b:start-b', onSelectAgentPreset: chooseB })
    const view = render(<>
      {rendererA.render('conversation.hero.agentPreset', {})}
      {rendererB.render('conversation.hero.agentPreset', {})}
    </>)

    await waitFor(() => expect(screen.getAllByRole('button', { name: /Agent 模式：default/ })).toHaveLength(2))
    const codingButtons = screen.getAllByRole('button', { name: '编码模式' })
    fireEvent.click(codingButtons[0]!)

    expect(chooseA).toHaveBeenCalledWith('coding')
    expect(chooseB).not.toHaveBeenCalled()
    expect(selectPreset).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Agent 模式：coding' })).toBeTruthy())
    expect(screen.getByRole('button', { name: 'Agent 模式：default' })).toBeTruthy()

    act(() => { view.unmount() })
    rendererA.dispose()
    rendererB.dispose()
  })

  it('applies a prepared Area choice to its exact Session id', async () => {
    const selectPreset = vi.fn(async (_sessionId: string, id: string) => ({ ok: true as const, value: id }))
    const ctx = makeContext({ selectPreset })
    const sessionReference = { sessionId: 'session-area-a' }
    const renderer = createWorkbenchNativeAreaSlotRenderer(ctx, 'session-area-a', {}, { sessionReference: sessionReference as never })
    render(renderer.render('conversation.hero.agentPreset', {}))

    await waitFor(() => expect(screen.getByRole('button', { name: /Agent 模式：default/ })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: '编码模式' }))

    await waitFor(() => expect(selectPreset).toHaveBeenCalledWith('session-area-a', 'coding'))
    expect(screen.getByRole('button', { name: 'Agent 模式：coding' })).toBeTruthy()
    renderer.dispose()
  })
})
