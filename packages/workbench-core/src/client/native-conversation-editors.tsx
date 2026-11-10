import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { WorkbenchPageLoading, WorkbenchPageTransition } from '../foundation/WorkbenchPageLoading.tsx'
import type { Context } from '@deepseek-ai/cordis'
import type { SessionReference } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ConversationSnapshot } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SessionSnapshot } from '@deepseek-ai/dsh-api-session-controller/client'
import type { PropsRenderFactories, SessionProviderComponent, FactoryLocalComponent } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { WorkbenchEditorOwnerProps } from './editor-slots.ts'
import { retainWorkbenchArea } from './native-area-reference.ts'
import { createWorkbenchNativeAreaSlotRenderer } from './native-area-slot-renderer.tsx'
import { createWorkbenchSharePresenceClient, type WorkbenchSharePresenceV1 } from './workbench-share-presence.ts'

type NativeOwner = WorkbenchEditorOwnerProps & PropsRenderFactories & {
  SessionProvider: SessionProviderComponent
}

type StartPlacement =
  | { readonly phase: 'idle' }
  | { readonly phase: 'placing'; readonly workspaceId: string }
  | { readonly phase: 'failed'; readonly workspaceId: string; readonly message: string }

const TrajectoryView: FactoryLocalComponent<'conversation.content', 'views'> = ({ renderSlot }) =>
  renderSlot('conversation.session', { view: 'trajectory' })

/**
 * Keep the phase source identical to DSH's Conversation owner.  Workbench
 * supplies only the Area-local binding and the embedded occurrence; it must
 * not maintain a second blank/engaging/active state machine.
 */
type ConversationPresentation = {
  readonly phase: 'settling' | 'hero' | 'active'
  readonly hero: boolean
}

type DshConversationPhase = typeof import('@deepseek-ai/dsh-client-ui-conversation/client').conversationPhase

/**
 * Compatibility seam for DSH's public `conversationPhase` export.  The
 * package's client entry is a ModuleLoader registration script, so importing
 * it eagerly from a Workbench unit test (or a non-DSH host) would execute the
 * script before the host has installed `window.__ModuleLoader__`.  Keep the
 * exact upstream predicate behind one adapter until DSH exposes a pure
 * helper entry; the DSH version is locked by Core's peer dependency.
 */
const dshConversationPhase: DshConversationPhase = (session, conversation) => {
  return conversation.activeTargets.size > 0
    || (!session.blank && !session.awaitingFirstTurn)
    || session.running
    ? 'active'
    : session.promptAttempted
      ? 'engaging'
      : 'blank'
}

const EMPTY_CONVERSATION_SNAPSHOT: ConversationSnapshot = { views: {} as ConversationSnapshot['views'], activeTargets: new Set<string>() }
const EMPTY_CONVERSATION_SOURCE = {
  getSnapshot: (): ConversationSnapshot => EMPTY_CONVERSATION_SNAPSHOT,
  subscribe: (): (() => void) => () => {},
}
const EMPTY_SESSION_LIST_SNAPSHOT = { byId: {} as Record<string, { blank?: boolean }> }
const EMPTY_INPUT_SNAPSHOT = { draft: '', attachmentIds: [] as readonly unknown[], draftRev: 0 }

type InputStateSource = {
  readonly subscribe: (listener: () => void) => () => void
  readonly getSnapshot: () => { readonly draft?: unknown; readonly attachmentIds?: readonly unknown[]; readonly draftRev?: unknown }
}

/** Retained Session contexts identify the Session but do not grant service injection. */
function conversationInputState(ctx: Context, binding: SessionReference['binding']): InputStateSource | undefined {
  const conversation = (ctx as unknown as {
    conversation?: { input?: { for(scope: unknown): { state: InputStateSource } } }
  }).conversation
  return conversation?.input?.for(binding.ctx).state
}

function SharePresenceBar({
  ctx, owner, binding, scopeRef,
}: {
  ctx: Context
  owner: NativeOwner
  binding: SessionReference['binding']
  scopeRef: { readonly current: HTMLDivElement | null }
}) {
  const enabled = owner.sharePresenceEnabled === true
    && owner.workbenchId !== undefined && owner.sessionId !== undefined && owner.areaId !== undefined
  const client = useMemo(() => createWorkbenchSharePresenceClient(ctx), [ctx])
  const inputSource = useMemo<InputStateSource | undefined>(() => {
    try {
      return conversationInputState(ctx, binding)
    } catch {
      return undefined
    }
  }, [binding])
  const subscribeInput = useCallback((listener: () => void) => inputSource?.subscribe(listener) ?? (() => {}), [inputSource])
  const getInputSnapshot = useCallback(() => inputSource?.getSnapshot() ?? EMPTY_INPUT_SNAPSHOT, [inputSource])
  const inputSnapshot = useSyncExternalStore(subscribeInput, getInputSnapshot, getInputSnapshot)
  const [focused, setFocused] = useState(false)
  const [remotePresence, setRemotePresence] = useState<readonly WorkbenchSharePresenceV1[]>([])
  const identityKey = `${owner.workbenchId ?? ''}:${owner.sessionId ?? ''}:${owner.areaId ?? ''}`
  const draftText = typeof inputSnapshot.draft === 'string' ? inputSnapshot.draft : ''
  const attachmentIds = Array.isArray(inputSnapshot.attachmentIds) ? inputSnapshot.attachmentIds : []
  const hasAttachments = attachmentIds.length > 0
  const typing = focused && (draftText.length > 0 || hasAttachments)
  const revisionRef = useRef<{ key: string; value: number; signature: string }>({ key: '', value: 0, signature: '' })
  const revision = useMemo(() => {
    const sourceRevision = typeof inputSnapshot.draftRev === 'number' && Number.isSafeInteger(inputSnapshot.draftRev)
      ? inputSnapshot.draftRev : 0
    const signature = `${draftText}\0${hasAttachments ? '1' : '0'}\0${typing ? '1' : '0'}\0${sourceRevision}`
    if (revisionRef.current.key !== identityKey) revisionRef.current = { key: identityKey, value: 0, signature: '' }
    if (revisionRef.current.signature !== signature) {
      revisionRef.current.signature = signature
      revisionRef.current.value = Math.max(revisionRef.current.value + 1, sourceRevision)
    }
    return revisionRef.current.value
  }, [draftText, hasAttachments, identityKey, inputSnapshot.draftRev, typing])

  useEffect(() => {
    if (!enabled || scopeRef.current === null) return
    const root = scopeRef.current
    const refreshFocus = () => {
      const active = document.activeElement
      setFocused(active instanceof HTMLElement && root.contains(active) && active.isContentEditable)
    }
    root.addEventListener('focusin', refreshFocus)
    root.addEventListener('focusout', refreshFocus)
    refreshFocus()
    return () => {
      root.removeEventListener('focusin', refreshFocus)
      root.removeEventListener('focusout', refreshFocus)
    }
  }, [enabled, scopeRef, identityKey])

  useEffect(() => {
    if (!enabled || owner.workbenchId === undefined || owner.sessionId === undefined || owner.areaId === undefined) {
      setRemotePresence([])
      return
    }
    let live = true
    let pending = false
    const read = async () => {
      if (!live || pending) return
      pending = true
      try {
        client.refreshRpc()
        const result = await client.read(owner.workbenchId!, owner.sessionId!, owner.areaId!)
        if (live) setRemotePresence(result.filter(value => value.participantId !== client.participantId))
      } catch {
        // A non-shared Host and a transient reconnect both fail closed. The
        // official Conversation remains fully usable without this decoration.
      } finally { pending = false }
    }
    void read()
    const timer = window.setInterval(() => { void read() }, 800)
    return () => { live = false; window.clearInterval(timer) }
  }, [client, enabled, identityKey, owner.areaId, owner.sessionId, owner.workbenchId])

  useEffect(() => {
    if (!enabled || owner.workbenchId === undefined || owner.sessionId === undefined || owner.areaId === undefined) return
    const timer = window.setTimeout(() => {
      void client.publish({
        workbenchId: owner.workbenchId!, sessionId: owner.sessionId!, areaId: owner.areaId!,
        typing, draftText, hasAttachments, revision,
      }).catch(() => {})
    }, 140)
    return () => { window.clearTimeout(timer) }
  }, [client, draftText, enabled, hasAttachments, owner.areaId, owner.sessionId, owner.workbenchId, revision, typing])

  useEffect(() => {
    if (!enabled || owner.workbenchId === undefined || owner.sessionId === undefined || owner.areaId === undefined) return
    return () => { void client.clear(owner.workbenchId!, owner.sessionId!, owner.areaId!).catch(() => {}) }
  }, [client, enabled, identityKey, owner.areaId, owner.sessionId, owner.workbenchId])

  if (remotePresence.length === 0) return null
  return <div
    data-workbench-share-presence
    role="status"
    aria-live="polite"
    style={{ flex: '0 0 auto', display: 'flex', flexDirection: 'column', gap: 4, padding: '6px 12px', borderBottom: '1px solid var(--dsw-alias-border-tertiary, rgba(127,127,127,.2))', color: 'var(--dsw-alias-label-secondary, currentColor)', fontSize: 12 }}
  >
    {remotePresence.map(presence => <div key={`${presence.participantId}:${presence.sessionId}:${presence.areaId}`} data-workbench-share-presence-participant={presence.participantId}>
      <strong>{presence.role === 'host' ? '房主' : '访客'}{presence.typing ? '正在输入' : '未发送草稿'}</strong>
      {presence.draftText.length > 0 ? <pre style={{ margin: '2px 0 0', maxHeight: 96, overflow: 'auto', whiteSpace: 'pre-wrap', font: 'inherit' }}>{presence.draftText}</pre> : null}
      {presence.hasAttachments ? <span> · 含附件</span> : null}
    </div>)}
  </div>
}

function conversationPresentationOf(
  sessionId: string | undefined,
  session: SessionSnapshot | undefined,
  conversation: ConversationSnapshot | undefined,
  summaryBlank: boolean | undefined,
): ConversationPresentation {
  const shellPhase = session === undefined || conversation === undefined
    ? 'blank'
    : dshConversationPhase(session, conversation)
  const openState = session?.openState
  const parentAvailabilityPending = session?.subagent?.address.mode === 'continuable'
    && session.subagent.parentAvailable === undefined
  const settling = sessionId !== undefined && (
    (shellPhase === 'blank' && openState === 'loading' && summaryBlank !== true)
    || parentAvailabilityPending
  )
  const hero = sessionId === undefined
    || (shellPhase === 'blank' && (openState === 'open' || summaryBlank === true))
  return { phase: settling ? 'settling' : hero ? 'hero' : 'active', hero }
}

function useSummaryBlank(ctx: Context, sessionId: string | undefined): boolean | undefined {
  const list = (ctx.sessions as unknown as {
    list?: { subscribe(listener: () => void): () => void; getSnapshot(): { byId?: Record<string, { blank?: boolean }> } }
  }).list
  const subscribe = useCallback((listener: () => void) => list?.subscribe(listener) ?? (() => {}), [list])
  const getSnapshot = useCallback(() => list?.getSnapshot() ?? EMPTY_SESSION_LIST_SNAPSHOT, [list])
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  const value = sessionId === undefined ? undefined : snapshot.byId?.[sessionId]?.blank
  return value === true ? true : value === false ? false : undefined
}

/** DSH owns Session, Conversation and Trajectory; Core only provides Area identity and binding. */
export function createWorkbenchNativeConversationEditors(ctx: Context) {
  function useDraftCloseGuard(owner: NativeOwner, binding?: SessionReference['binding']) {
    useEffect(() => owner.registerCloseGuard?.(() => {
      if (!binding) return true
      try {
        const input = conversationInputState(ctx, binding)?.getSnapshot()
        if (!input) return false
        const draft = typeof input?.draft === 'string' ? input.draft.trim() : ''
        return !draft && !input?.attachmentIds?.length || globalThis.confirm('此对话还有未发送的文字或附件，确定关闭这个内页吗？')
      } catch { return false }
    }), [owner.registerCloseGuard, binding])
  }
  /**
   * React StrictMode replays passive effects without replacing the committed
   * renderer. Deferring disposal until the next task lets the replayed setup
   * cancel the cleanup while still releasing the renderer on a real unmount
   * or identity change.
   */
  function useNativeRendererLifetime(renderer: ReturnType<typeof createWorkbenchNativeAreaSlotRenderer> | undefined) {
    const lifetime = useRef<{ renderer: ReturnType<typeof createWorkbenchNativeAreaSlotRenderer>; token: number }>()
    useEffect(() => {
      if (renderer === undefined) return
      const previous = lifetime.current
      const token = (previous?.token ?? 0) + 1
      lifetime.current = { renderer, token }
      if (previous !== undefined && previous.renderer !== renderer) previous.renderer.dispose()
      return () => {
        queueMicrotask(() => {
          const current = lifetime.current
          if (current?.renderer !== renderer || current.token !== token) return
          renderer.dispose()
          lifetime.current = undefined
        })
      }
    }, [renderer])
  }

  function useStartRenderer(
    owner: NativeOwner,
    sessionId: string | undefined,
    reference: SessionReference | undefined,
    selectWorkspace: (workspaceId: string) => Promise<void>,
    selectAgentPreset: (presetId: string) => void,
  ) {
    const openConversationResourceRef = useRef(owner.openConversationResource)
    openConversationResourceRef.current = owner.openConversationResource
    const onOpenResource = useCallback((address: string, placement?: Record<string, unknown>, source?: Parameters<NonNullable<NativeOwner['openConversationResource']>>[2]) =>
      openConversationResourceRef.current?.(address, placement, source) ?? 'native-fallback', [])
    const startRenderer = useMemo(() => createWorkbenchNativeAreaSlotRenderer(ctx, sessionId, {}, {
      onSelectWorkspace: selectWorkspace,
      onSelectAgentPreset: selectAgentPreset,
      onOpenResource,
      ...(reference === undefined ? {} : { sessionReference: reference }),
      // Keep each Start occurrence's DSH factory state private even before it
      // has a Session. The stable Workbench occurrence id survives reopening.
      scopeKey: owner.runtimeIdentity ?? `${owner.areaId ?? 'area'}:${owner.instanceId}`,
    }), [ctx, owner.runtimeIdentity ?? owner.areaId, owner.instanceId, onOpenResource, reference, selectAgentPreset, selectWorkspace, sessionId])
    useNativeRendererLifetime(startRenderer)
    return startRenderer
  }

  function StartSurface({ owner, renderer, placement }: {
    owner: NativeOwner
    renderer: ReturnType<typeof createWorkbenchNativeAreaSlotRenderer>
    placement: StartPlacement
  }) {
    const presentation = conversationPresentationOf(undefined, undefined, undefined, undefined)
    const content = renderer.renderFactory('conversation.content', {
      variant: 'embedded', phase: presentation.phase, hero: presentation.hero,
    })
    return <section
      data-workbench-native-start
      data-workbench-placement-capable={owner.placeConversation === undefined ? 'false' : 'true'}
      data-workbench-placement-state={placement.phase}
      aria-busy={placement.phase === 'placing' || undefined}
      style={{ display: 'flex', minHeight: 0, height: '100%', flexDirection: 'column' }}
    >
      <WorkbenchPageTransition loading={placement.phase === 'placing'} label="对话" icon="message">{content}</WorkbenchPageTransition>
      {placement.phase === 'failed' ? <p role="alert" style={{ margin: 0, padding: '8px 12px', color: 'var(--dsw-alias-state-error-primary, #b42318)' }}>
        {placement.message}
      </p> : null}
    </section>
  }

  function PreparedStart({ owner, reference, renderer, placement }: {
    owner: NativeOwner
    reference: SessionReference
    renderer: ReturnType<typeof createWorkbenchNativeAreaSlotRenderer>
    placement: StartPlacement
  }) {
    useDraftCloseGuard(owner, reference.binding)
    const session = reference.binding.session
    const subscribe = useCallback((listener: () => void) => session.subscribe(listener), [session])
    const getSnapshot = useCallback(() => session.getSnapshot(), [session])
    const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
    const conversationSource = useMemo(() => {
      const uiConversation = (ctx as unknown as {
        uiConversation?: { binding(binding: unknown): { snapshot: typeof EMPTY_CONVERSATION_SOURCE } }
      }).uiConversation
      return uiConversation?.binding(reference.binding).snapshot ?? EMPTY_CONVERSATION_SOURCE
    }, [reference.binding])
    const conversation = useSyncExternalStore(
      conversationSource.subscribe,
      conversationSource.getSnapshot,
      conversationSource.getSnapshot,
    )
    const summaryBlank = useSummaryBlank(ctx, owner.sessionId)
    const promotionKey = `${owner.instanceId}:${owner.sessionId}:${owner.bindingGeneration ?? 0}`
    const attemptedPromotion = useRef<string>()
    const completePreparedConversation = owner.completePreparedConversation
    const instanceId = owner.instanceId
    const sessionId = owner.sessionId
    const bindingGeneration = owner.bindingGeneration
    const workspaceId = owner.workspaceId
    useEffect(() => {
      if (snapshot.blank !== false || sessionId === undefined
        || bindingGeneration === undefined || completePreparedConversation === undefined
        || attemptedPromotion.current === promotionKey) return
      attemptedPromotion.current = promotionKey
      completePreparedConversation({
        moduleInstanceId: instanceId,
        bindingGeneration,
        target: {
          ...(workspaceId === undefined ? {} : { workspaceId }),
          sessionId,
        },
      })
    }, [bindingGeneration, completePreparedConversation, instanceId, promotionKey, sessionId, snapshot.blank, workspaceId])
    const presentation = conversationPresentationOf(owner.sessionId, snapshot as SessionSnapshot, conversation, summaryBlank)
    const content = renderer.renderFactory('conversation.content', {
      variant: 'embedded', phase: presentation.phase, hero: presentation.hero,
    })
    return <section
      data-workbench-native-start
      data-workbench-prepared-session={owner.sessionId}
      data-workbench-session-id={owner.sessionId}
      data-workbench-conversation-ready={presentation.phase !== 'settling'}
      data-workbench-placement-state={placement.phase}
      aria-busy={placement.phase === 'placing' || undefined}
      style={{ display: 'flex', minHeight: 0, height: '100%', flexDirection: 'column' }}
    >
      <WorkbenchPageTransition loading={placement.phase === 'placing' || presentation.phase === 'settling'} label="对话" icon="message">{content}</WorkbenchPageTransition>
      {placement.phase === 'failed' ? <p role="alert" style={{ margin: 0, padding: '8px 12px', color: 'var(--dsw-alias-state-error-primary, #b42318)' }}>
        {placement.message}
      </p> : null}
    </section>
  }

  function Start(suppliedOwner: NativeOwner) {
    const owner = suppliedOwner.runtimeIdentity ? { ...suppliedOwner, areaId: suppliedOwner.runtimeIdentity, areaClaim: suppliedOwner.runtimeIdentity + ':' + (suppliedOwner.bindingGeneration ?? 0) } : suppliedOwner
    const placementRef = useRef<Promise<void>>()
    const mountedRef = useRef(true)
    const ownerRef = useRef(owner)
    const selectedAgentPresetRef = useRef<string>()
    const [placement, setPlacement] = useState<StartPlacement>({ phase: 'idle' })
    const [, setSelectedAgentPreset] = useState<string>()
    const [retained, setRetained] = useState<{
      sessionId: string
      areaClaim: string
      reference?: SessionReference
      failed?: true
    }>()
    ownerRef.current = owner
    const selectAgentPreset = useCallback((presetId: string) => {
      selectedAgentPresetRef.current = presetId
      setSelectedAgentPreset(presetId)
    }, [])
    useEffect(() => {
      mountedRef.current = true
      return () => { mountedRef.current = false }
    }, [])
    useEffect(() => {
      setRetained(undefined)
      if (owner.sessionId === undefined) return
      if (!owner.areaId || !owner.areaClaim) {
        setRetained({ sessionId: owner.sessionId, areaClaim: owner.areaClaim ?? '', failed: true })
        return
      }
      let live = true
      let lease: ReturnType<typeof retainWorkbenchArea>
      try {
        lease = retainWorkbenchArea(ctx.sessions, {
          sessionId: owner.sessionId as SessionId, areaId: owner.areaId, claim: owner.areaClaim,
        })
      } catch {
        setRetained({ sessionId: owner.sessionId, areaClaim: owner.areaClaim, failed: true })
        return
      }
      void lease.ready.then(reference => {
        if (live) setRetained({ sessionId: owner.sessionId!, areaClaim: owner.areaClaim!, reference })
      }, () => {
        if (live) setRetained({ sessionId: owner.sessionId!, areaClaim: owner.areaClaim!, failed: true })
      })
      return () => { live = false; lease.release() }
    }, [owner.sessionId, owner.areaId, owner.areaClaim])
    const selectWorkspace = useCallback((workspaceId: string): Promise<void> => {
      const existing = placementRef.current
      if (existing !== undefined) return existing
      if (ownerRef.current.sessionId !== undefined && ownerRef.current.workspaceId === workspaceId) return Promise.resolve()
      const place = ownerRef.current.placeConversation
      if (place === undefined) return Promise.reject(new Error('Workbench placement is unavailable'))
      if (mountedRef.current) setPlacement({ phase: 'placing', workspaceId })
      const agentPreset = selectedAgentPresetRef.current
      const task = place({
        workspaceId,
        presentation: 'start',
        ...(agentPreset === undefined ? {} : { agentPreset }),
      }).then(() => {
        if (mountedRef.current) setPlacement({ phase: 'idle' })
      }, reason => {
        const code = reason instanceof Error && 'code' in reason ? reason.code : undefined
        if (mountedRef.current) setPlacement({
          phase: 'failed', workspaceId,
          message: code === 'area-already-bound'
            ? '目标内页已发生变化，请重新打开新建对话入口。'
            : code === 'placement-stale'
              ? '目标内页或项目已发生变化，请重试。'
              : '无法准备此工作区对话，请重试。',
        })
        throw reason
      }).finally(() => {
        if (placementRef.current === task) placementRef.current = undefined
      })
      placementRef.current = task
      void task.catch(() => {})
      return task
    }, [])

    const matchingRetained = owner.sessionId !== undefined
      && retained?.sessionId === owner.sessionId && retained.areaClaim === owner.areaClaim
      ? retained.reference : undefined
    const renderer = useStartRenderer(
      owner,
      matchingRetained === undefined ? undefined : owner.sessionId,
      matchingRetained,
      selectWorkspace,
      selectAgentPreset,
    )

    if (owner.sessionId !== undefined) {
      if (retained?.sessionId !== owner.sessionId || retained.areaClaim !== owner.areaClaim) {
        return <WorkbenchPageLoading label="对话" icon="message" />
      }
      if (retained.failed || retained.reference === undefined) {
        return <p role="alert">{'\u5f53\u524d\u5bf9\u8bdd\u6682\u65f6\u65e0\u6cd5\u8fde\u63a5\uff0c\u8bf7\u91cd\u65b0\u8fdb\u5165\u6b64\u5de5\u4f5c\u53f0\u3002'}</p>
      }
      return <PreparedStart owner={owner} reference={retained.reference} renderer={renderer} placement={placement} />
    }
    return <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {owner.workspaceId ? <button type="button" disabled={placement.phase === 'placing'} onClick={() => { void selectWorkspace(owner.workspaceId!).catch(() => {}) }}>在区域项目中新建对话</button> : null}
      <StartSurface owner={owner} renderer={renderer} placement={placement} />
    </div>
  }

  function Content({ owner, reference, view, nativeRenderer }: {
    owner: NativeOwner
    reference: SessionReference
    view: 'chat' | 'trajectory'
    nativeRenderer: ReturnType<typeof createWorkbenchNativeAreaSlotRenderer> | undefined
  }) {
    useDraftCloseGuard(owner, reference.binding)
    const binding = reference.binding
    const source = useMemo(() => ctx.uiConversation.binding(binding).snapshot, [binding])
    const conversation = useSyncExternalStore(source.subscribe, source.getSnapshot, source.getSnapshot)
    const sessionSubscribe = useMemo(() => reference.binding.session.subscribe.bind(reference.binding.session), [binding])
    const sessionSnapshot = useMemo(() => reference.binding.session.getSnapshot.bind(reference.binding.session), [binding])
    const session = useSyncExternalStore(sessionSubscribe, sessionSnapshot, sessionSnapshot)
    const summaryBlank = useSummaryBlank(ctx, owner.sessionId)
    // Keep the phase decision identical to DSH's main Conversation owner,
    // including settling while history is opening and continuable subagent
    // parent availability is still being resolved.
    const presentation = conversationPresentationOf(owner.sessionId, session as SessionSnapshot, conversation, summaryBlank)
    // Main already belongs to its Workbench. The native new-conversation hero
    // asks for a Workspace and can replace the Session, so use its persistent
    // chat presentation even before the first message. Workers keep the hero.
    const hero = presentation.hero && owner.instanceId !== 'bay-agent-main'
    const { SessionProvider, renderFactorySlot } = owner
    const content = nativeRenderer === undefined
      ? renderFactorySlot('conversation.content', { variant: 'embedded', phase: presentation.phase, hero },
        view === 'trajectory' ? { slots: { views: TrajectoryView } } : undefined)
      : nativeRenderer.renderFactory('conversation.content', { variant: 'embedded', phase: presentation.phase, hero },
        (view === 'trajectory' ? { slots: { views: TrajectoryView } } : undefined) as never)
    // `conversation.content` is the DSH transcript/composer body. The native
    // page owner normally renders `conversation.header` beside it;
    // an Area has no page owner, so project that same header slot here. Keep
    // it through the same Area renderer as the body so header actions
    // (lineage, sub-agents, utilities) resolve this Area's Session scope.
    const header = nativeRenderer?.render('conversation.header', {}, { fallback: null }) ?? null
    const renderedContent = nativeRenderer === undefined
      ? <SessionProvider session={reference}>{content}</SessionProvider>
      : <>{header}{content}</>
    const scopeRef = useRef<HTMLDivElement>(null)
    return <div ref={scopeRef} data-workbench-native-conversation={view} data-workbench-session-id={owner.sessionId} data-workbench-conversation-ready={presentation.phase !== 'settling'} style={{ display: 'flex', minHeight: 0, height: '100%', flexDirection: 'column' }}>
      {view === 'chat' ? <SharePresenceBar ctx={ctx} owner={owner} binding={reference.binding} scopeRef={scopeRef} /> : null}
      <WorkbenchPageTransition loading={presentation.phase === 'settling'} label={view === 'trajectory' ? '轨迹' : owner.instanceId === 'bay-agent-main' ? 'Bay Agent' : '对话'} icon={view === 'trajectory' ? 'trajectory' : 'message'}>{renderedContent}</WorkbenchPageTransition>
    </div>
  }

  function Bound({ owner: suppliedOwner, view }: { owner: NativeOwner; view: 'chat' | 'trajectory' }) {
    const owner = suppliedOwner.runtimeIdentity ? { ...suppliedOwner, areaId: suppliedOwner.runtimeIdentity, areaClaim: suppliedOwner.runtimeIdentity + ':' + (suppliedOwner.bindingGeneration ?? 0) } : suppliedOwner
    const [reference, setReference] = useState<SessionReference>()
    const [error, setError] = useState('')
    const [retry, setRetry] = useState(0)
    const leaseLifetime = useRef<{ lease: ReturnType<typeof retainWorkbenchArea>; token: number }>()
    useEffect(() => {
      setReference(undefined)
      setError('')
      if (!owner.sessionId || !owner.areaId || !owner.areaClaim) {
        setError('缺少对话标识或容器归属。')
        return
      }
      let live = true
      let lease: ReturnType<typeof retainWorkbenchArea>
      try {
        lease = retainWorkbenchArea(ctx.sessions, { sessionId: owner.sessionId as SessionId, areaId: owner.areaId, claim: owner.areaClaim })
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : String(reason))
        return
      }
      const token = (leaseLifetime.current?.token ?? 0) + 1
      leaseLifetime.current = { lease, token }
      void lease.ready.then(value => { if (live) setReference(value) }, reason => { if (live) setError(reason instanceof Error ? reason.message : String(reason)) })
      return () => {
        live = false
        queueMicrotask(() => {
          const current = leaseLifetime.current
          lease.release()
          if (current?.lease === lease && current.token === token) leaseLifetime.current = undefined
        })
      }
    }, [owner.sessionId, owner.areaId, owner.areaClaim, retry])
    const openConversationResourceRef = useRef(owner.openConversationResource)
    openConversationResourceRef.current = owner.openConversationResource
    const onOpenResource = useCallback((address: string, placement?: Record<string, unknown>, source?: Parameters<NonNullable<NativeOwner['openConversationResource']>>[2]) =>
      openConversationResourceRef.current?.(address, placement, source) ?? 'native-fallback', [])
    const openNativeTabRef = useRef(owner.openNativeTab)
    openNativeTabRef.current = owner.openNativeTab
    const stateRef = useRef(owner.state); stateRef.current = owner.state
    const readInspectCallId = useCallback(() => {
      const state = stateRef.current as { nativeParams?: { inspectCallId?: unknown } } | null
      return typeof state?.nativeParams?.inspectCallId === 'string' ? state.nativeParams.inspectCallId : undefined
    }, [])
    const onInspectCall = useCallback((callId: string) => {
      openNativeTabRef.current?.('trajectory', {
        editorId: 'workbench.agent-trajectory',
        resourceType: 'trajectory-inspect',
        ...(owner.sessionId ? { resourceAddress: 'dsh-resource://trajectory-inspect/session/' + encodeURIComponent(owner.sessionId) + '/' + encodeURIComponent(callId) } : {}),
        params: { inspectCallId: callId },
      })
    }, [owner.sessionId])
    const nativeRenderer = useMemo(() => reference === undefined
      ? undefined
      : createWorkbenchNativeAreaSlotRenderer(ctx, owner.sessionId, {}, {
        sessionReference: reference,
        scopeKey: owner.runtimeIdentity ?? `${owner.areaId ?? 'area'}:${owner.instanceId}`,
        onOpenResource,
        onInspectCall,
        readInspectCallId,
      }), [ctx, onInspectCall, owner.areaId, owner.instanceId, onOpenResource, owner.sessionId, reference])
    useNativeRendererLifetime(nativeRenderer)
    if (error) return <div role="alert"><p>暂时无法连接此对话：{error}</p><button type="button" onClick={() => setRetry(value => value + 1)}>重新连接对话</button></div>
    if (!reference) return <WorkbenchPageLoading label={view === 'trajectory' ? '轨迹' : owner.instanceId === 'bay-agent-main' ? 'Bay Agent' : '对话'} icon={view === 'trajectory' ? 'trajectory' : 'message'} />
    return <Content owner={owner} reference={reference} view={view} nativeRenderer={nativeRenderer} />
  }

  return {
    start: Start,
    conversation: (owner: NativeOwner) => <Bound key={`${owner.runtimeIdentity ?? owner.areaId}:${owner.runtimeIdentity ? owner.bindingGeneration : owner.areaClaim}:${owner.sessionId}`} owner={owner} view="chat" />,
    trajectory: (owner: NativeOwner) => <Bound key={`${owner.runtimeIdentity ?? owner.areaId}:${owner.runtimeIdentity ? owner.bindingGeneration : owner.areaClaim}:${owner.sessionId}`} owner={owner} view="trajectory" />,
  }
}
