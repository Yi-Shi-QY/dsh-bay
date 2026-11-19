import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { WorkbenchPageLoading, WorkbenchPageTransition } from '../foundation/WorkbenchPageLoading.tsx'
import { useWorkbenchLocale } from '../foundation/workbench-locale.ts'
import type { Context } from '@deepseek-ai/cordis'
import type { SessionReference } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ConversationSnapshot } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SessionInput } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SessionSnapshot } from '@deepseek-ai/dsh-api-session-controller/client'
import type { PropsRenderFactories, SessionProviderComponent, FactoryLocalComponent } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { WorkbenchEditorOwnerProps } from './editor-slots.ts'
import { retainWorkbenchArea } from './native-area-reference.ts'
import { createWorkbenchNativeAreaSlotRenderer } from './native-area-slot-renderer.tsx'
import type { WorkbenchCollaborationClientV1 } from './workbench-collaboration-client.ts'
import { createWorkbenchSharedDraftBinding, type WorkbenchSharedDraftBindingV1 } from './workbench-shared-draft-binding.ts'
import { draftRangeAt, draftSelectionOf, findDraftEditable } from './draft-selection-dom.ts'
import { getWorkbenchClientSessions } from './session-service.ts'

type NativeOwner = WorkbenchEditorOwnerProps & PropsRenderFactories & {
  SessionProvider: SessionProviderComponent
}

type StartPlacement =
  | { readonly phase: 'idle' }
  | { readonly phase: 'placing'; readonly workspaceId: string }
  | { readonly phase: 'failed'; readonly workspaceId: string; readonly message: 'start.alreadyBound' | 'start.stale' | 'start.failed' }

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

type InputFacade = Pick<SessionInput, 'setDraft'> & { readonly state: InputStateSource }

function conversationInput(ctx: Context, binding: SessionReference['binding']): InputFacade | undefined {
  const conversation = (ctx as unknown as {
    conversation?: { input?: { for(scope: unknown): InputFacade } }
  }).conversation
  return conversation?.input?.for(binding.ctx)
}

/** Retained Session contexts identify the Session but do not grant service injection. */
function conversationInputState(ctx: Context, binding: SessionReference['binding']): InputStateSource | undefined {
  return conversationInput(ctx, binding)?.state
}

interface RemoteDraftMark {
  readonly participantId: string
  readonly name: string
  readonly color: string
  readonly left: number
  readonly top: number
  readonly height: number
  readonly highlights: readonly { readonly left: number; readonly top: number; readonly width: number; readonly height: number }[]
}

function participantColor(participantId: string): string {
  let hash = 0
  for (let index = 0; index < participantId.length; index += 1) hash = (hash * 31 + participantId.charCodeAt(index)) >>> 0
  return `hsl(${hash % 360} 70% 45%)`
}

/** Shows where other participants' cursors and selections are in the shared draft. */
function RemoteDraftCarets({ client, owner, scopeRef }: {
  client: WorkbenchCollaborationClientV1
  owner: NativeOwner
  scopeRef: { readonly current: HTMLDivElement | null }
}) {
  const snapshot = useSyncExternalStore(client.subscribe, client.getSnapshot, client.getSnapshot)
  const draft = snapshot === undefined ? undefined : Object.values(snapshot.drafts).find(value =>
    value.areaId === owner.areaId && value.editorId === owner.editorId && value.sessionId === owner.sessionId)
  const selections = draft?.selections
  const text = draft?.text
  const participants = snapshot?.participants
  const [marks, setMarks] = useState<readonly RemoteDraftMark[]>([])
  useEffect(() => {
    const scope = scopeRef.current
    const publish = (next: readonly RemoteDraftMark[]) => setMarks(current => JSON.stringify(current) === JSON.stringify(next) ? current : next)
    if (scope === null || selections === undefined) { publish([]); return }
    const measure = () => {
      const editable = findDraftEditable(scope)
      const next: RemoteDraftMark[] = []
      if (editable !== undefined) {
        const base = scope.getBoundingClientRect()
        // The shared canvas may be scaled; positions inside it are unscaled.
        const scale = scope.offsetWidth > 0 && base.width > 0 ? base.width / scope.offsetWidth : 1
        const place = (rect: { left: number; top: number; width: number; height: number }) => ({
          left: (rect.left - base.left) / scale + scope.scrollLeft,
          top: (rect.top - base.top) / scale + scope.scrollTop,
          width: rect.width / scale, height: rect.height / scale,
        })
        for (const [participantId, selection] of Object.entries(selections)) {
          if (participantId === client.participantId) continue
          const presence = participants?.find(row => row.participantId === participantId)
          if (presence === undefined || presence.connectionState === 'stale') continue
          const range = draftRangeAt(editable, selection.start, selection.end)
          if (range === undefined || typeof range.getClientRects !== 'function') continue
          const rects = [...range.getClientRects()].filter(rect => rect.height > 0)
          const fallback = editable.getBoundingClientRect()
          const last = rects.at(-1) ?? { left: fallback.left, top: fallback.top, width: 0, height: Math.min(fallback.height, 20 * scale) }
          const caret = place(last)
          next.push({
            participantId,
            name: presence.displayName || (presence.role === 'owner' ? '\u623f\u4e3b' : '\u534f\u4f5c\u8005'),
            color: participantColor(participantId),
            left: caret.left + caret.width, top: caret.top, height: caret.height,
            highlights: selection.start === selection.end ? [] : rects.map(place),
          })
        }
      }
      publish(next)
    }
    measure()
    // The composer applies remote text in its own render pass.
    const frame = requestAnimationFrame(measure)
    window.addEventListener('resize', measure)
    scope.addEventListener('scroll', measure, true)
    return () => { cancelAnimationFrame(frame); window.removeEventListener('resize', measure); scope.removeEventListener('scroll', measure, true) }
  }, [client, participants, scopeRef, selections, text])
  if (marks.length === 0) return null
  return <div data-workbench-remote-carets aria-hidden style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden', zIndex: 2 }}>
    {marks.map(mark => <div key={mark.participantId} data-workbench-remote-caret={mark.participantId}>
      {mark.highlights.map((rect, index) => <span key={index} style={{ position: 'absolute', left: rect.left, top: rect.top, width: rect.width, height: rect.height, background: mark.color, opacity: 0.22 }} />)}
      <span style={{ position: 'absolute', left: mark.left, top: mark.top, width: 2, height: mark.height, background: mark.color }} />
      <span style={{ position: 'absolute', left: mark.left, top: mark.top - 14, padding: '0 4px', borderRadius: 3, background: mark.color, color: '#fff', fontSize: 10, lineHeight: '14px', whiteSpace: 'nowrap' }}>{mark.name}</span>
    </div>)}
  </div>
}

function CollaborationPresenceBar({ ctx, owner, binding, scopeRef, client, session, conversation }: {
  ctx: Context
  owner: NativeOwner
  binding: SessionReference['binding']
  scopeRef: { readonly current: HTMLDivElement | null }
  client: WorkbenchCollaborationClientV1
  session?: SessionSnapshot
  conversation?: ConversationSnapshot
}) {
  const { t } = useWorkbenchLocale()
  const snapshot = useSyncExternalStore(
    client.subscribe,
    client.getSnapshot,
    client.getSnapshot,
  )
  const input = useMemo<InputFacade | undefined>(() => {
    try { return conversationInput(ctx, binding) } catch { return undefined }
  }, [binding, ctx])
  const inputSource = input?.state
  const subscribeInput = useCallback((listener: () => void) => inputSource?.subscribe(listener) ?? (() => {}), [inputSource])
  const getInputSnapshot = useCallback(() => inputSource?.getSnapshot() ?? EMPTY_INPUT_SNAPSHOT, [inputSource])
  const inputSnapshot = useSyncExternalStore(subscribeInput, getInputSnapshot, getInputSnapshot)
  const focusedRef = useRef(false)
  const [focused, setFocused] = useState(false)
  const identityKey = `${owner.workbenchId ?? ''}:${owner.areaId ?? ''}:${owner.editorId ?? ''}:${owner.sessionId ?? ''}`
  const draftText = typeof inputSnapshot.draft === 'string' ? inputSnapshot.draft : ''
  const draft = snapshot === undefined ? undefined : Object.values(snapshot.drafts).find(value =>
    value.areaId === owner.areaId && value.editorId === owner.editorId && value.sessionId === owner.sessionId)
  const draftId = draft?.draftId ?? (owner.areaId && owner.editorId
    ? `draft:${owner.areaId}:${owner.editorId}:${owner.sessionId ?? ''}`
    : undefined)
  const draftBinding = useRef<WorkbenchSharedDraftBindingV1 | undefined>(undefined)
  const ensuredDraft = useRef<string | undefined>(undefined)
  const lastAttachments = useRef<string | undefined>(undefined)
  const composing = useRef(false)
  const [selection, setSelection] = useState<{ readonly start: number; readonly end: number }>()
  const role = client.participantId === 'owner' ? 'owner' as const : 'participant' as const
  const runtime = session as (SessionSnapshot & { running?: boolean; promptAttempted?: boolean }) | undefined
  useEffect(() => {
    focusedRef.current = focused
  }, [focused])
  useEffect(() => {
    if (scopeRef.current === null) return
    const root = scopeRef.current
    const refresh = () => {
      const active = document.activeElement
      const next = active instanceof HTMLElement && root.contains(active) && (active.isContentEditable || active instanceof HTMLTextAreaElement || active instanceof HTMLInputElement)
      setFocused(next)
      setSelection(draftSelectionOf(root))
    }
    const compositionStart = () => { composing.current = true }
    const compositionEnd = () => { composing.current = false; draftBinding.current?.compositionEnded(); refresh() }
    root.addEventListener('focusin', refresh)
    root.addEventListener('focusout', refresh)
    root.addEventListener('compositionstart', compositionStart)
    root.addEventListener('compositionend', compositionEnd)
    document.addEventListener('selectionchange', refresh)
    refresh()
    return () => {
      root.removeEventListener('focusin', refresh); root.removeEventListener('focusout', refresh)
      root.removeEventListener('compositionstart', compositionStart); root.removeEventListener('compositionend', compositionEnd)
      document.removeEventListener('selectionchange', refresh)
    }
  }, [scopeRef, identityKey])
  const getConnected = useCallback(() => client.getState() === 'connected', [client])
  const connected = useSyncExternalStore(client.subscribe, getConnected, getConnected)
  useEffect(() => {
    // A new connection may be a different collaboration session.
    if (!connected) { ensuredDraft.current = undefined; return }
    if (draftId === undefined || owner.areaId === undefined || owner.editorId === undefined) return
    if (ensuredDraft.current === draftId) return
    ensuredDraft.current = draftId
    void client.command({
      kind: 'draft.ensure', draftId, areaId: owner.areaId, editorId: owner.editorId,
      ...(owner.sessionId === undefined ? {} : { sessionId: owner.sessionId }),
    }).catch(() => { if (ensuredDraft.current === draftId) ensuredDraft.current = undefined })
  }, [client, connected, draftId, owner.areaId, owner.editorId, owner.sessionId])
  // The shared draft is Host state. The binding reconciles the real DSH
  // composer with it through the draft OT adapter: unconfirmed local typing
  // is transformed against remote operations instead of being overwritten.
  useEffect(() => {
    if (input === undefined || draftId === undefined) return
    const binding = createWorkbenchSharedDraftBinding({
      client, draftId,
      getEditorText: () => { const value = input.state.getSnapshot().draft; return typeof value === 'string' ? value : '' },
      setEditorText: text => { input.setDraft(text) },
      isComposing: () => composing.current,
    })
    draftBinding.current = binding
    return () => { binding.dispose(); if (draftBinding.current === binding) draftBinding.current = undefined }
  }, [client, draftId, input])
  useEffect(() => { draftBinding.current?.editorChanged() }, [draftText])
  useEffect(() => {
    if (input === undefined || draft === undefined || draftId === undefined || client.getState() !== 'connected') return
    const attachments = (inputSnapshot.attachmentIds ?? []).map(value => String(value))
    const signature = JSON.stringify(attachments)
    if (lastAttachments.current === signature) return
    lastAttachments.current = signature
    if (attachments.length === 0 && draft.attachments.length === 0) return
    if (JSON.stringify(draft.attachments) === signature) return
    void client.command({ kind: 'draft.set-attachments', draftId, attachments, baseRevision: draft.revision }).catch(() => {})
  }, [client, draft, draftId, input, inputSnapshot.attachmentIds])
  useEffect(() => {
    if (draftId === undefined || draft === undefined || selection === undefined || client.getState() !== 'connected') return
    const current = draft.selections[client.participantId]
    if (current?.start === selection.start && current.end === selection.end) return
    void client.command({ kind: 'draft.set-selection', draftId, selection, cursor: selection.end, baseRevision: draft.revision }).catch(() => {})
  }, [client, draft, draftId, selection])
  useEffect(() => {
    if (owner.workbenchId === undefined || owner.areaId === undefined || owner.editorId === undefined) return
    const timer = window.setTimeout(() => {
      client.publishPresence({
        participantId: client.participantId,
        displayName: role === 'owner' ? '\u623f\u4e3b' : '\u534f\u4f5c\u8005',
        role,
        ...(owner.areaId === undefined ? {} : { areaId: owner.areaId }),
        ...(owner.editorId === undefined ? {} : { editorId: owner.editorId }),
        ...(owner.sessionId === undefined ? {} : { sessionId: owner.sessionId }),
        intent: runtime?.running === true || (conversation?.activeTargets.size ?? 0) > 0
          ? 'running'
          : runtime?.promptAttempted === true
            ? 'sending'
            : focusedRef.current || draftText.length > 0 ? 'editing' : 'viewing',
        ...(draft?.draftId === undefined ? {} : { draftId: draft.draftId }),
        connectionState: client.getState() === 'connected' ? 'connected' : 'reconnecting',
        ...(selection === undefined ? {} : { cursor: selection.end, selection }),
        updatedAt: Date.now(),
      })
    }, 120)
    return () => window.clearTimeout(timer)
  }, [client, conversation?.activeTargets.size, draft?.draftId, draftText.length, identityKey, owner.areaId, owner.editorId, owner.sessionId, owner.workbenchId, focused, role, runtime?.promptAttempted, runtime?.running, selection])
  // A participant who lost its connection is reported once, in the Workbench
  // top bar notice; this bar shows only participants who are present.
  const remote = snapshot?.participants.filter(value => value.participantId !== client.participantId && value.connectionState !== 'stale') ?? []
  if (remote.length === 0) return null
  return <div data-workbench-collaboration-presence role="status" aria-live="polite" style={{ flex: '0 0 auto', display: 'flex', flexDirection: 'column', gap: 4, padding: '6px 12px', borderBottom: '1px solid var(--dsw-alias-border-tertiary, rgba(127,127,127,.2))', color: 'var(--dsw-alias-label-secondary, currentColor)', fontSize: 12 }}>
    {remote.map(presence => {
      const location = [presence.areaId, presence.editorId, presence.sessionId].filter(Boolean).join(' / ')
       return <div key={presence.participantId} data-workbench-collaboration-participant={presence.participantId}>
         <strong>{presence.displayName || (presence.role === 'owner' ? t('presence.owner') : t('presence.collaborator'))} · {presence.intent === 'editing' ? t('presence.editing') : presence.intent === 'sending' ? t('presence.sending') : presence.intent === 'running' ? t('presence.running') : presence.intent === 'recovering' ? t('presence.recovering') : t('presence.viewing')}</strong>
        {location ? <span> · {location}</span> : null}
      </div>
    })}
  </div>
}

function SharePresenceBar(props: {
  ctx: Context
  owner: NativeOwner
  binding: SessionReference['binding']
  scopeRef: { readonly current: HTMLDivElement | null }
  session?: SessionSnapshot
  conversation?: ConversationSnapshot
}) {
  if (props.owner.collaborationClient === undefined) return null
  return <>
    <CollaborationPresenceBar {...props} client={props.owner.collaborationClient} />
    <RemoteDraftCarets client={props.owner.collaborationClient} owner={props.owner} scopeRef={props.scopeRef} />
  </>
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
  const settling = sessionId !== undefined && (
    (shellPhase === 'blank' && openState === 'loading' && summaryBlank !== true)
  )
  const hero = sessionId === undefined
    || (shellPhase === 'blank' && (openState === 'open' || summaryBlank === true))
  return { phase: settling ? 'settling' : hero ? 'hero' : 'active', hero }
}

function useSummaryBlank(ctx: Context, sessionId: string | undefined): boolean | undefined {
  const list = (getWorkbenchClientSessions(ctx) as unknown as {
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
  const sessions = getWorkbenchClientSessions(ctx)
  function useDraftCloseGuard(owner: NativeOwner, binding?: SessionReference['binding']) {
    const { t } = useWorkbenchLocale()
    useEffect(() => owner.registerCloseGuard?.(() => {
      if (!binding) return true
      try {
        const input = conversationInputState(ctx, binding)?.getSnapshot()
        if (!input) return false
        const draft = typeof input?.draft === 'string' ? input.draft.trim() : ''
        return !draft && !input?.attachmentIds?.length || globalThis.confirm(t('start.closeDraft'))
      } catch { return false }
    }), [owner.registerCloseGuard, binding, t])
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
    const { t } = useWorkbenchLocale()
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
      <WorkbenchPageTransition loading={placement.phase === 'placing'} label={t('editor.workbench.conversation')} icon="message">{content}</WorkbenchPageTransition>
      {placement.phase === 'failed' ? <p role="alert" style={{ margin: 0, padding: '8px 12px', color: 'var(--dsw-alias-state-error-primary, #b42318)' }}>
        {t(placement.message)}
      </p> : null}
    </section>
  }

  function PreparedStart({ owner, reference, renderer, placement }: {
    owner: NativeOwner
    reference: SessionReference
    renderer: ReturnType<typeof createWorkbenchNativeAreaSlotRenderer>
    placement: StartPlacement
  }) {
    const { t } = useWorkbenchLocale()
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
      <WorkbenchPageTransition loading={placement.phase === 'placing' || presentation.phase === 'settling'} label={t('editor.workbench.conversation')} icon="message">{content}</WorkbenchPageTransition>
      {placement.phase === 'failed' ? <p role="alert" style={{ margin: 0, padding: '8px 12px', color: 'var(--dsw-alias-state-error-primary, #b42318)' }}>
        {t(placement.message)}
      </p> : null}
    </section>
  }

  function Start(suppliedOwner: NativeOwner) {
    const { t } = useWorkbenchLocale()
    const owner = suppliedOwner.runtimeIdentity ? { ...suppliedOwner, areaId: suppliedOwner.runtimeIdentity, areaClaim: suppliedOwner.runtimeIdentity + ':' + (suppliedOwner.bindingGeneration ?? 0) } : suppliedOwner
    const placementRef = useRef<Promise<void>>()
    const mountedRef = useRef(true)
    const ownerRef = useRef(owner)
    const selectedAgentPresetRef = useRef<string>()
    const autoWorkspaceRef = useRef<string>()
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
        lease = retainWorkbenchArea(sessions, {
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
            ? 'start.alreadyBound'
            : code === 'placement-stale'
              ? 'start.stale'
              : 'start.failed',
        })
        throw reason
      }).finally(() => {
        if (placementRef.current === task) placementRef.current = undefined
      })
      placementRef.current = task
      void task.catch(() => {})
      return task
    }, [])
    useEffect(() => {
      if (owner.presentation !== 'area' || owner.sessionId !== undefined || owner.workspaceId === undefined) return
      if (autoWorkspaceRef.current === owner.workspaceId) return
      autoWorkspaceRef.current = owner.workspaceId
      void selectWorkspace(owner.workspaceId).catch(() => {})
    }, [owner.presentation, owner.sessionId, owner.workspaceId, selectWorkspace])

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
        return <WorkbenchPageLoading label={t('editor.workbench.conversation')} icon="message" />
      }
      if (retained.failed || retained.reference === undefined) {
        return <p role="alert">{t('start.unavailable')}</p>
      }
      return <PreparedStart owner={owner} reference={retained.reference} renderer={renderer} placement={placement} />
    }
    return <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {owner.workspaceId ? <button type="button" disabled={placement.phase === 'placing'} onClick={() => { void selectWorkspace(owner.workspaceId!).catch(() => {}) }}>{t('start.inProject')}</button> : null}
      <StartSurface owner={owner} renderer={renderer} placement={placement} />
    </div>
  }

  function Content({ owner, reference, view, nativeRenderer }: {
    owner: NativeOwner
    reference: SessionReference
    view: 'chat' | 'trajectory'
    nativeRenderer: ReturnType<typeof createWorkbenchNativeAreaSlotRenderer> | undefined
  }) {
    const { t } = useWorkbenchLocale()
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
    return <div ref={scopeRef} data-workbench-native-conversation={view} data-workbench-session-id={owner.sessionId} data-workbench-conversation-ready={presentation.phase !== 'settling'} style={{ position: 'relative', display: 'flex', minHeight: 0, height: '100%', flexDirection: 'column' }}>
      {view === 'chat' ? <SharePresenceBar ctx={ctx} owner={owner} binding={reference.binding} scopeRef={scopeRef} session={session as SessionSnapshot} conversation={conversation} /> : null}
      <WorkbenchPageTransition loading={presentation.phase === 'settling'} label={view === 'trajectory' ? t('conversation.trace') : owner.instanceId === 'bay-agent-main' ? 'Bay Agent' : t('editor.workbench.conversation')} icon={view === 'trajectory' ? 'trajectory' : 'message'}>{renderedContent}</WorkbenchPageTransition>
    </div>
  }

  function Bound({ owner: suppliedOwner, view }: { owner: NativeOwner; view: 'chat' | 'trajectory' }) {
    const { t } = useWorkbenchLocale()
    const owner = suppliedOwner.runtimeIdentity ? { ...suppliedOwner, areaId: suppliedOwner.runtimeIdentity, areaClaim: suppliedOwner.runtimeIdentity + ':' + (suppliedOwner.bindingGeneration ?? 0) } : suppliedOwner
    const [reference, setReference] = useState<SessionReference>()
    const [error, setError] = useState('')
    const [retry, setRetry] = useState(0)
    const leaseLifetime = useRef<{ lease: ReturnType<typeof retainWorkbenchArea>; token: number }>()
    useEffect(() => {
      setReference(undefined)
      setError('')
      if (!owner.sessionId || !owner.areaId || !owner.areaClaim) {
        setError('\u7f3a\u5c11\u5bf9\u8bdd\u6807\u8bc6\u6216\u5bb9\u5668\u5f52\u5c5e')
        return
      }
      let live = true
      let lease: ReturnType<typeof retainWorkbenchArea>
      try {
        lease = retainWorkbenchArea(sessions, { sessionId: owner.sessionId as SessionId, areaId: owner.areaId, claim: owner.areaClaim })
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
    if (error) return <div role="alert"><p>{t('editor.couldNotConnectToThisConversation')}{error}</p><button type="button" onClick={() => setRetry(value => value + 1)}>{t('editor.reconnectConversation')}</button></div>
    if (!reference) return <WorkbenchPageLoading label={view === 'trajectory' ? t('conversation.trace') : owner.instanceId === 'bay-agent-main' ? 'Bay Agent' : t('editor.workbench.conversation')} icon={view === 'trajectory' ? 'trajectory' : 'message'} />
    return <Content owner={owner} reference={reference} view={view} nativeRenderer={nativeRenderer} />
  }

  return {
    start: Start,
    conversation: (owner: NativeOwner) => <Bound key={`${owner.runtimeIdentity ?? owner.areaId}:${owner.runtimeIdentity ? owner.bindingGeneration : owner.areaClaim}:${owner.sessionId}`} owner={owner} view="chat" />,
    trajectory: (owner: NativeOwner) => <Bound key={`${owner.runtimeIdentity ?? owner.areaId}:${owner.runtimeIdentity ? owner.bindingGeneration : owner.areaClaim}:${owner.sessionId}`} owner={owner} view="trajectory" />,
  }
}
