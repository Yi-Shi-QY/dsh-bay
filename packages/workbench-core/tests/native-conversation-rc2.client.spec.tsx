// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ComponentType } from 'react'
import { ConversationContent } from '@deepseek-ai/dsh-client-ui-conversation/src/client/skeleton/ConversationContent.tsx'
import { ConversationHeader } from '@deepseek-ai/dsh-client-ui-conversation/src/client/skeleton/ConversationHeader.tsx'
import { DefaultConversationViews } from '@deepseek-ai/dsh-client-ui-conversation/src/client/skeleton/DefaultConversationViews.tsx'
import { PixelWhale } from '@deepseek-ai/dsh-client-ui-brand-official/src/client/home-whale/PixelWhale.tsx'
import { SidebarChatTab, ConversationSlotPanel } from '@deepseek-ai/dsh-client-ui-subagent/src/client/sidebar-chat/index.tsx'
import { createWorkbenchOfficialAreaEditors } from '../src/client/official-area-editors.tsx'
import { createWorkbenchNativeAreaSlotRenderer } from '../src/client/native-area-slot-renderer.tsx'

const source = <T,>(value: T) => ({ getSnapshot: () => value, subscribe: () => () => {} })

/** Real RC2 content/header/view components; only remote data and leaf controls are fixtures. */
function fixture(frame: 'official' | 'absent' | 'broken' = 'official') {
  const session = source({ blank: false, openState: 'open', running: false, awaitingFirstTurn: false, promptAttempted: false })
  const conversation = source({ views: {}, activeTargets: new Set<string>() })
  const reference = { sessionId: 'session-a', binding: { ctx: {}, session }, ready: Promise.resolve(), release: vi.fn() }
  const childReference = { ...reference, sessionId: 'child-b', binding: { ctx: {}, session } }
  const hooks = { session, conversation, input: source({ draft: '', attachmentIds: [] }) }
  const absentHooks = { session: undefined, conversation: undefined, input: undefined }
  const factory = {
    name: 'conversation.content', scope: 'session-maybe', locale: 'conversation', component: ConversationContent,
    children: {
      'conversation.session': { kind: 'single', scope: 'session' },
      'conversation.composer': { kind: 'chain', scope: 'session' },
      'conversation.composer.bar': { kind: 'single', scope: 'session-maybe' },
      'conversation.input.dock': { kind: 'list', scope: 'session' },
      'conversation.hero.frame': { kind: 'hoc', scope: 'root' },
      'conversation.hero.brand.mark': { kind: 'single', scope: 'root' },
      'conversation.hero.workspace': { kind: 'single', scope: 'root' },
      'conversation.hero.agentPreset': { kind: 'single', scope: 'session-maybe' },
      'conversation.hero.options': { kind: 'list', scope: 'session' },
    },
    slots: { views: { scope: 'session' }, widthControls: { scope: 'root' } },
    inject: () => ({ hooks: { composerBlock: source(undefined) }, selectWorkspace: vi.fn() }),
  }
  const createStore = vi.fn((id: string) => ({ ...source({ view: 'chat', viewRequest: null }), actions: { setDraft: vi.fn(), completeViewRequest: vi.fn() }, id }))
  const sessionBody = {
    options: {}, component: DefaultConversationViews,
    children: { 'conversation.view': { kind: 'list', scope: 'session' } },
    store: { create: createStore },
    inject: () => ({
      hooks: { conversationViews: source([{ id: 'chat' }, { id: 'trajectory' }]), inspectCall: source(undefined) },
      bindDraftPersistence: () => () => {}, openView: vi.fn(),
    }),
  }
  const header = {
    options: {}, component: ConversationHeader,
    children: {
      'conversation.header.leading': { kind: 'single', scope: 'root' },
      'conversation.session.header': { kind: 'single', scope: 'session' },
    },
  }
  const entries: Record<string, object[]> = {
    'sidebar.right.pane.tab': [{ options: { key: '@deepseek-ai/dsh-client-ui-subagent' }, component: SidebarChatTab, children: { 'sidebar.chat.conversation': { kind: 'single', scope: 'session' } } }],
    'sidebar.chat.conversation': [{ options: {}, component: ConversationSlotPanel }],
    'conversation.hero.frame': frame === 'absent' ? [] : [{
      options: { id: 'pixel-whale' },
      component: frame === 'broken' ? () => { throw new Error('broken decoration') } : PixelWhale,
    }],
    'conversation.composer.bar': [{ options: {}, component: ({ disabled }: { disabled?: boolean }) => <textarea aria-label="Composer" disabled={disabled} /> }],
    'conversation.hero.workspace': [{ options: {}, component: ({ open, onPick }: { open: boolean; onPick: (id: string) => void }) => open ? <button onClick={() => onPick('workspace-a')}>Pick workspace A</button> : null }],
    'conversation.session': [sessionBody],
    'conversation.view': ['chat', 'trajectory'].map(id => ({ options: { id }, component: ({ sessionId }: { sessionId: string }) => <p>{id}:{sessionId}</p> })),
    'conversation.header': [header],
    'conversation.session.header': [{ options: {}, component: () => <h2>Native session header</h2> }],
  }
  const specs: Record<string, object> = {
    'sidebar.right.pane.tab': { kind: 'keyed', scope: 'session' },
    'sidebar.chat.conversation': { kind: 'single', scope: 'session' },
    ...factory.children, ...sessionBody.children, ...header.children,
    'conversation.header': { kind: 'single', scope: 'session-maybe' },
  }
  const root = source({ hooks: { sessions: source({ byId: { 'session-a': { cwd: '/project', blank: false } } }), sessionStatus: source(new Map()), workspaces: source({ phase: 'ready', items: [] }) }, keyedHooks: {}, props: {} })
  const bound = source({ key: 'session-a', ctx: reference.binding.ctx, hooks, keyedHooks: {}, props: { sessionId: 'session-a', inputActions: { persistDraft: vi.fn() } } })
  const childBound = source({ ...bound.getSnapshot(), key: 'child-b', ctx: childReference.binding.ctx, props: { ...bound.getSnapshot().props, sessionId: 'child-b' } })
  const absent = source({ key: undefined, hooks: absentHooks, keyedHooks: {}, props: { sessionId: undefined } })
  const context = {
    slots: {
      spec: (key: string) => specs[key], entries: (key: string) => entries[key] ?? [], entriesOfSlot: (key: string) => entries[key] ?? [],
      subscribe: () => () => {}, getVersion: () => 1,
      factory: (name: string) => name === factory.name ? factory : undefined,
      subscribeFactory: () => () => {}, factoryVersion: () => 1, isFactoryLive: () => true,
      _host: { root, scope: () => ({ bindingSource: (ref: unknown) => ref === undefined ? absent : ref === childReference ? childBound : bound }) },
    },
    locale: { ...source({ revision: 1 }), bind: () => (key: string) => key },
    resources: { source: () => source({ value: { reference: childReference } }) },
    sessions: { retain: () => reference, list: root.getSnapshot().hooks.sessions },
    uiConversation: { binding: () => ({ snapshot: conversation }) },
  }
  return { context, reference, createStore }
}

describe('real RC2 Conversation components inside Workbench', () => {
  const expectedDecorationError = (event: ErrorEvent) => {
    if (event.error?.message === 'broken decoration') event.preventDefault()
  }
  beforeEach(() => vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} unobserve() {} }))
  afterEach(() => { cleanup(); window.removeEventListener('error', expectedDecorationError); vi.unstubAllGlobals(); vi.restoreAllMocks() })

  it('uses the child Session store inside the real Subagent Chat body', () => {
    const { context, reference, createStore } = fixture()
    const renderer = createWorkbenchNativeAreaSlotRenderer(context as never, 'session-a', {}, { sessionReference: reference as never })
    const view = render(<>
      {renderer.render('conversation.session', { view: 'chat' })}
      {renderer.render('sidebar.right.pane.tab', {}, {
        entryKey: '@deepseek-ai/dsh-client-ui-subagent',
        hookContext: () => ({ tab: { contentId: 'dsh-resource://subagentchat/session/child-b?parent=session-a&mode=continuable' } }),
      })}
    </>)
    expect(screen.getByText('chat:session-a')).toBeTruthy()
    expect(screen.getByText('chat:child-b')).toBeTruthy()
    expect(createStore.mock.calls.map(([id]) => id).sort()).toEqual(['child-b', 'session-a'])
    view.unmount()
    renderer.dispose()
  })

  it.each(['official', 'absent', 'broken'] as const)('keeps the Start composer and picker with a %s HOC frame', async frame => {
    if (frame === 'broken') {
      vi.spyOn(console, 'error').mockImplementation(() => {})
      window.addEventListener('error', expectedDecorationError)
    }
    const { context } = fixture(frame)
    const Start = createWorkbenchOfficialAreaEditors(context as never).start as ComponentType<any>
    const placeConversation = vi.fn().mockResolvedValue({ sessionId: 'session-a', workspaceId: 'workspace-a' })
    render(<Start instanceId="start-a" areaId="area-a" state={{}} setState={vi.fn()} placeConversation={placeConversation} />)
    expect(screen.getByRole('textbox', { name: 'Composer' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'hero.chooseWorkspace' }))
    fireEvent.click(screen.getByRole('button', { name: 'Pick workspace A' }))
    await waitFor(() => expect(placeConversation).toHaveBeenCalledWith({ workspaceId: 'workspace-a', presentation: 'start' }))
    expect(document.querySelector('[data-conversation-scroll]')).not.toBeNull()
    expect(document.querySelector('[data-factory-error]')).toBeNull()
  })

  it.each(['area', 'floating'] as const)('renders real Conversation and Trajectory content in %s occurrences', async placement => {
    const { context } = fixture()
    const editors = createWorkbenchOfficialAreaEditors(context as never)
    const Conversation = editors.conversation as ComponentType<any>
    const Trajectory = editors.trajectory as ComponentType<any>
    const owner = { areaId: 'area-a', areaClaim: 'claim-a', sessionId: 'session-a', state: {}, setState: vi.fn() }
    render(<>
      <Conversation {...owner} instanceId="conversation-a" runtimeIdentity={`${placement}:conversation-a`} />
      <Trajectory {...owner} instanceId="trajectory-a" runtimeIdentity={`${placement}:trajectory-a`} />
    </>)
    await screen.findByText('chat:session-a')
    await screen.findByText('trajectory:session-a')
    expect(screen.getAllByRole('textbox', { name: 'Composer' })).toHaveLength(2)
    expect(screen.getAllByRole('heading', { name: 'Native session header' })).toHaveLength(2)
    expect(document.querySelector('[data-factory-error], [data-slot-error]')).toBeNull()
  })
})
