import { defaultWorkbenchTranslate } from '../foundation/workbench-locale.ts'
import type { WorkbenchMessageKey } from '../foundation/workbench-messages.ts'
import type { ISessions, SessionReference, SessionSnapshot, SessionEventWindow } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionStatusSnapshot } from '@deepseek-ai/dsh-client-ui-session/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

declare module '@deepseek-ai/dsh-api-session-controller/client' {
  interface SessionReferenceSourceMap { workbenchTabStatus: true }
}

interface Source<T> { getSnapshot(): T; subscribe(listener: () => void): () => void }
export type ConversationTabPhase = 'idle' | 'running' | 'attention' | 'completed' | 'failed' | 'stopped' | 'unknown'
export interface ConversationTabStatus { readonly status: ConversationTabPhase; readonly label: string; readonly labelKey?: WorkbenchMessageKey }
export interface ConversationTabStatusSource extends Source<ReadonlyMap<string, ConversationTabStatus>> {
  /** Observe only conversations with an open tab; duplicate views share one reference. */
  watch(sessionIds: readonly string[]): () => void
}

function conversationStatus(status: ConversationTabPhase, labelKey: WorkbenchMessageKey): ConversationTabStatus {
  return { status, label: defaultWorkbenchTranslate(labelKey), labelKey }
}

export const UNKNOWN_CONVERSATION_STATUS = conversationStatus('unknown', 'conversation.syncing')

interface TurnOutcome { turn: number; seq: number; reason?: string }

/** Only durable turn boundaries prove completion; transient chunks and unread flags do not. */
function latestTurn(window: SessionEventWindow, previous?: TurnOutcome): TurnOutcome | undefined {
  const incremental = previous !== undefined && window.change.kind === 'append'
  let result = incremental ? previous : undefined
  const entries = incremental && window.change.kind === 'append' ? window.change.entries : window.entries
  for (const entry of entries) {
    if (entry.type !== 'event') continue
    const event = entry.event
    if (event.type !== 'turn/start' && event.type !== 'turn/end') continue
    if (result && (event.data.turn < result.turn || event.data.turn === result.turn && event.seq <= result.seq)) continue
    result = { turn: event.data.turn, seq: event.seq, ...(event.type === 'turn/end' ? { reason: event.data.reason.kind } : {}) }
  }
  return result
}

function hasQueuedInput(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  return ['next-turn', 'next-step'].some(key => {
    const entries = (value as Record<string, unknown>)[key]
    return Array.isArray(entries) && entries.length > 0
  })
}

function phaseOf(snapshot: SessionSnapshot, pending: string | undefined, turn: TurnOutcome | undefined, awaitingNewTurn: boolean, queued: boolean, liveFailure: boolean): ConversationTabStatus {
  if (snapshot.removed) return conversationStatus('failed', 'conversation.unavailable')
  if (snapshot.openState === 'error' || snapshot.openError) return conversationStatus('failed', 'conversation.connectionFailed')
  if (snapshot.openState !== 'open') return UNKNOWN_CONVERSATION_STATUS
  if (pending) return conversationStatus('attention', pending === 'approval' ? 'conversation.awaitingApproval'
    : pending === 'plan-review' ? 'conversation.awaitingPlan' : pending === 'question' ? 'conversation.awaitingAnswer' : 'conversation.attention')
  if (snapshot.running) return conversationStatus('running', 'conversation.running')
  if (snapshot.pendingSubmissions.length || snapshot.awaitingFirstTurn) return conversationStatus('running', 'conversation.awaitingTurn')
  if (snapshot.promptError?.op === 'send') return conversationStatus('failed', 'conversation.sendFailed')
  if (liveFailure || snapshot.lastAgentError && (!turn?.reason || awaitingNewTurn)) return conversationStatus('failed', 'conversation.failed')
  if (queued) return conversationStatus('running', 'conversation.queued')
  if (awaitingNewTurn) return conversationStatus('unknown', 'conversation.confirming')
  if (!turn) return snapshot.blank ? conversationStatus('idle', 'conversation.idle') : conversationStatus('unknown', 'conversation.unknown')
  switch (turn.reason) {
    case 'completed': return conversationStatus('completed', 'conversation.completed')
    case 'aborted': return conversationStatus('stopped', 'conversation.stopped')
    case 'interrupted': return conversationStatus('stopped', 'conversation.interrupted')
    case 'forked': return conversationStatus('stopped', 'conversation.forked')
    case 'error': return conversationStatus('failed', 'conversation.failed')
    case 'blocked': return conversationStatus('failed', 'conversation.blocked')
    case 'max-tokens': return conversationStatus('failed', 'conversation.outputLimit')
    default: return conversationStatus('unknown', 'conversation.unknown')
  }
}

interface Observation {
  count: number
  reference?: SessionReference
  off: (() => void)[]
  turn?: TurnOutcome | undefined
  revision?: number | undefined
  busy?: boolean | undefined
  /** Last settled boundary observed when a new run began, before its journal arrives. */
  previousEnd?: number | undefined
  lastAgentError?: string | null | undefined
  agentErrorBoundary?: number | undefined
  fresh: boolean
  failed: boolean
}

/** Read-only observer: owns no prompt, approval, navigation or main-view/read acknowledgement. */
export function createConversationTabStatusSource(options: {
  sessions: Pick<ISessions, 'retain'>
  interactions: Source<SessionStatusSnapshot>
  generation: Source<{ readonly id: number } | undefined>
}): ConversationTabStatusSource & { dispose(): void } {
  const observations = new Map<string, Observation>()
  const listeners = new Set<() => void>()
  let snapshot: ReadonlyMap<string, ConversationTabStatus> = new Map()
  let generation = options.generation.getSnapshot()?.id
  let disposed = false
  const publish = (id: string, next: ConversationTabStatus | undefined) => {
    const previous = snapshot.get(id)
    if (previous?.status === next?.status && previous?.label === next?.label && previous?.labelKey === next?.labelKey) return
    const updated = new Map(snapshot)
    if (next) updated.set(id, next); else updated.delete(id)
    snapshot = updated
    for (const listener of listeners) listener()
  }
  const update = (id: string, observation: Observation) => {
    if (disposed || observations.get(id) !== observation) return
    if (generation === undefined || !observation.fresh) {
      publish(id, conversationStatus('unknown', generation === undefined ? 'conversation.disconnected' : 'conversation.syncing'))
      return
    }
    if (observation.failed || !observation.reference) { publish(id, conversationStatus('failed', 'conversation.connectionFailed')); return }
    try {
      const binding = observation.reference.binding
      const session = binding.session.getSnapshot()
      const window = binding.eventSource.getSnapshot()
      const previousTurn = observation.turn
      if (window.revision !== observation.revision) {
        // A disconnected observer may have missed several append deltas.
        observation.turn = latestTurn(window, window.revision === (observation.revision ?? -1) + 1 ? observation.turn : undefined)
        observation.revision = window.revision
      }
      // A fast failed run can start and stop between batched running updates.
      // A newly observed error must still supersede the previous green result.
      if (session.lastAgentError !== observation.lastAgentError) {
        if (session.lastAgentError && observation.lastAgentError !== undefined) observation.agentErrorBoundary = observation.turn?.seq ?? -1
        if (!session.lastAgentError) observation.agentErrorBoundary = undefined
        observation.lastAgentError = session.lastAgentError
      }
      if (observation.agentErrorBoundary !== undefined && observation.turn?.reason && observation.turn.seq > observation.agentErrorBoundary) observation.agentErrorBoundary = undefined
      const queued = hasQueuedInput(binding.session.projections.faceOf('inbox').getSnapshot())
      const busy = session.running || session.pendingSubmissions.length > 0 || session.awaitingFirstTurn || queued
      // running can arrive ahead of turn/start. Never reuse the old successful turn
      // if that new run stops before its durable boundary has reached this Client.
      if (busy && observation.busy !== true && (previousTurn ?? observation.turn)?.reason) observation.previousEnd = (previousTurn ?? observation.turn)!.seq
      if (observation.previousEnd !== undefined && observation.turn && observation.turn.seq > observation.previousEnd) observation.previousEnd = undefined
      observation.busy = busy
      const interaction = options.interactions.getSnapshot().get(id as SessionId)?.pendingInteraction?.kind
      publish(id, phaseOf(session, interaction, observation.turn, observation.previousEnd !== undefined, queued, observation.agentErrorBoundary !== undefined))
    } catch { publish(id, conversationStatus('unknown', 'conversation.resync')) }
  }
  const acquire = (id: string, observation: Observation) => {
    try {
      const reference = options.sessions.retain(id as SessionId, { source: 'workbenchTabStatus' })
      observation.reference = reference
      const binding = reference.binding
      observation.off.push(binding.session.subscribe(() => {
        if (binding.session.getSnapshot().openState === 'open') observation.failed = false
        update(id, observation)
      }))
      observation.off.push(binding.session.projections.faceOf('inbox').subscribe(() => update(id, observation)))
      observation.off.push(binding.eventSource.subscribe(() => {
        if (generation !== undefined && binding.eventSource.getSnapshot().change.kind === 'replace') {
          observation.fresh = true
          observation.failed = false
        }
        update(id, observation)
      }))
      void reference.ready.then(() => update(id, observation), () => {
        observation.failed = true
        update(id, observation)
      })
    } catch { observation.failed = true }
    update(id, observation)
  }
  const offInteractions = options.interactions.subscribe(() => {
    for (const [id, observation] of observations) update(id, observation)
  })
  const offGeneration = options.generation.subscribe(() => {
    const next = options.generation.getSnapshot()?.id
    if (next === generation) return
    generation = next
    for (const [id, observation] of observations) {
      // Resume must publish a fresh event window before old results become usable.
      observation.fresh = false
      update(id, observation)
    }
  })
  return {
    getSnapshot: () => snapshot,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener) } },
    watch(sessionIds) {
      if (disposed) return () => {}
      const ids = [...new Set(sessionIds.filter(Boolean))]
      for (const id of ids) {
        const existing = observations.get(id)
        if (existing) { existing.count++; continue }
        const observation: Observation = { count: 1, off: [], fresh: generation !== undefined, failed: false }
        observations.set(id, observation)
        acquire(id, observation)
      }
      let released = false
      return () => {
        if (released) return
        released = true
        for (const id of ids) {
          const observation = observations.get(id)
          if (!observation || --observation.count > 0) continue
          observations.delete(id)
          for (const off of observation.off) off()
          observation.reference?.release()
          publish(id, undefined)
        }
      }
    },
    dispose() {
      if (disposed) return
      disposed = true
      offInteractions(); offGeneration()
      for (const observation of observations.values()) {
        for (const off of observation.off) off()
        observation.reference?.release()
      }
      observations.clear(); listeners.clear(); snapshot = new Map()
    },
  }
}
