import { describe, expect, it, vi } from 'vitest'
import type { ISessions, SessionEventWindow, SessionReference, SessionSnapshot } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionStatusSnapshot } from '@deepseek-ai/dsh-client-ui-session/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { createConversationTabStatusSource } from '../src/client/conversation-tab-status.ts'

function observable<T>(initial: T) {
  let value = initial
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => value,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    set(next: T) { value = next; for (const listener of listeners) listener() },
    listeners,
  }
}
const id = 'session-a' as SessionId
function turn(turn: number, seq: number, reason?: string): SessionEventWindow['entries'][number] {
  return { type: 'event', event: { type: reason ? 'turn/end' : 'turn/start', seq, time: seq, data: { turn, ...(reason ? { reason: { kind: reason } } : {}) } } } as SessionEventWindow['entries'][number]
}
function fixture(initial: SessionEventWindow['entries'] = [], patch: Partial<SessionSnapshot> = {}) {
  const session = observable<SessionSnapshot>({
    sessionId: id, pendingSubmissions: [], running: false, subagent: null, removed: false,
    openState: 'open', openError: null, hasMore: false, loadingOlder: false, promptError: null,
    blank: initial.length === 0, lastAgentError: null, promptAttempted: false, awaitingFirstTurn: false, ...patch,
  })
  const events = observable<SessionEventWindow>({ entries: initial, revision: 0, hasMore: false, change: { kind: 'replace', entries: initial } })
  const inbox = observable<unknown>({ 'next-turn': [], 'next-step': [] })
  const interactions = observable<SessionStatusSnapshot>(new Map())
  const generation = observable<{ id: number } | undefined>({ id: 1 })
  const binding = { session: { ...session, projections: { faceOf: () => inbox } }, eventSource: events }
  let rejectReady: (reason: Error) => void = () => {}
  const release = vi.fn()
  const retain = vi.fn(() => ({ binding, release, ready: new Promise((_resolve, reject) => { rejectReady = reject }) } as unknown as SessionReference))
  const source = createConversationTabStatusSource({ sessions: { retain } as Pick<ISessions, 'retain'>, interactions, generation })
  const watch = () => source.watch([id])
  const read = () => source.getSnapshot().get(id)
  const update = (patch: Partial<SessionSnapshot>) => session.set({ ...session.getSnapshot(), ...patch })
  const journal = (entries: SessionEventWindow['entries'], kind: 'append' | 'prepend' | 'replace' = 'append') => {
    const prev = events.getSnapshot()
    events.set({ revision: prev.revision + 1, hasMore: false, entries: kind === 'replace' ? entries : kind === 'prepend' ? [...entries, ...prev.entries] : [...prev.entries, ...entries], change: { kind, entries } })
  }
  const pending = (kind?: string, completionUnread = false) => interactions.set(new Map([[id, { running: true, completionUnread, ...(kind ? { pendingInteraction: { kind, key: 'request', sessionId: id } } : {}) }]]) as SessionStatusSnapshot)
  return { source, session, events, inbox, interactions, generation, retain, release, watch, read, update, journal, pending, readyFailure: () => rejectReady, rejectReady: () => rejectReady(new Error('open failed')) }
}

describe('conversation tab status from native session observations', () => {
  it('prioritizes approval, plan review and questions over running, then resumes running', () => {
    const f = fixture([turn(1, 1)], { running: true }); f.watch()
    for (const [kind, label] of [['approval', '等待审批'], ['plan-review', '等待计划确认'], ['question', '等待答复']]) {
      f.pending(kind)
      expect(f.read()).toMatchObject({ status: 'attention', label })
    }
    f.pending()
    expect(f.read()?.status).toBe('running')
  })

  it('restores a proven success and keeps it when the view clears unread or is reopened', () => {
    const f = fixture([turn(1, 1), turn(1, 3, 'completed')]); const off = f.watch()
    expect(f.read()?.status).toBe('completed')
    f.pending(undefined, true); f.pending(undefined, false)
    expect(f.read()?.status).toBe('completed')
    off(); f.watch()
    expect(f.read()?.status).toBe('completed')
  })

  it.each(['aborted', 'interrupted', 'forked', 'error', 'blocked', 'max-tokens', 'future-reason'])('never marks %s as successful', reason => {
    const f = fixture([turn(1, 1), turn(1, 3, reason)]); f.watch()
    expect(f.read()?.status).toBe(['aborted', 'interrupted', 'forked'].includes(reason) ? 'stopped' : reason === 'future-reason' ? 'unknown' : 'failed')
  })

  it('does not reuse the previous success when running arrives before the new journal', () => {
    const f = fixture([turn(1, 1), turn(1, 3, 'completed')]); f.watch()
    f.update({ running: true }); expect(f.read()?.status).toBe('running')
    f.update({ running: false }); expect(f.read()?.status).toBe('unknown')
    f.journal([turn(2, 4)]); expect(f.read()?.status).toBe('unknown')
    f.journal([turn(2, 6, 'aborted')]); expect(f.read()?.status).toBe('stopped')
  })

  it('handles turn/start arriving before the running flag, and completion before running stops', () => {
    const f = fixture([turn(1, 1), turn(1, 3, 'completed')]); f.watch()
    f.journal([turn(2, 4)]); f.update({ running: true })
    f.journal([turn(2, 6, 'completed')]); expect(f.read()?.status).toBe('running')
    f.update({ running: false }); expect(f.read()?.status).toBe('completed')
    f.journal([turn(1, 3, 'error')], 'prepend'); expect(f.read()?.status).toBe('completed')
  })

  it('does not flash green between accepted/queued input and the new run', () => {
    const f = fixture([turn(1, 1), turn(1, 3, 'completed')]); f.watch()
    f.inbox.set({ 'next-turn': [{ text: 'next' }], 'next-step': [] })
    expect(f.read()).toMatchObject({ status: 'running', label: '有输入等待处理', labelKey: 'conversation.queued' })
    f.inbox.set({ 'next-turn': [], 'next-step': [] })
    expect(f.read()?.status).toBe('unknown')
    f.journal([turn(2, 4)]); f.update({ running: true })
    f.journal([turn(2, 6, 'completed')]); f.update({ running: false })
    expect(f.read()?.status).toBe('completed')
    f.update({ awaitingFirstTurn: true }); expect(f.read()?.status).toBe('running')
  })

  it('shows send and live agent failures without inventing a successful turn', () => {
    const f = fixture([turn(1, 1), turn(1, 3, 'completed')]); f.watch()
    f.update({ promptError: { op: 'send', message: 'failed' } as SessionSnapshot['promptError'] })
    expect(f.read()?.status).toBe('failed')
    f.update({ promptError: null, running: true }); f.update({ running: false, lastAgentError: 'agent failed' })
    expect(f.read()?.status).toBe('failed')
  })

  it('supersedes old green on a fast live failure even if running was never observed', () => {
    const f = fixture([turn(1, 1), turn(1, 3, 'completed')]); f.watch()
    f.update({ lastAgentError: 'failed before the next status batch' })
    expect(f.read()?.status).toBe('failed')
    f.journal([turn(2, 4)]); f.update({ running: true })
    f.journal([turn(2, 6, 'completed')]); f.update({ running: false })
    expect(f.read()?.status).toBe('completed')
  })

  it('keeps late observations from a released binding out of the new binding', async () => {
    const f = fixture(); const off = f.watch(); const oldFailure = f.readyFailure()
    off(); const next = f.source.watch(['session-b']); oldFailure(new Error('old binding failed')); await Promise.resolve()
    expect(f.source.getSnapshot().has(id)).toBe(false)
    expect(f.source.getSnapshot().get('session-b')?.status).toBe('idle')
    next()
  })

  it('keeps disconnected results unknown until a fresh journal baseline and rescans missed deltas', () => {
    const f = fixture([turn(1, 1), turn(1, 3, 'completed')]); f.watch()
    f.generation.set(undefined); expect(f.read()?.status).toBe('unknown')
    f.journal([turn(2, 4)]); f.journal([turn(2, 6, 'aborted')])
    f.generation.set({ id: 2 }); f.pending('approval')
    expect(f.read()?.status).toBe('unknown')
    f.pending(); f.journal(f.events.getSnapshot().entries, 'replace')
    expect(f.read()?.status).toBe('stopped')
  })

  it('shares a single reference across views and releases only after the last view closes', () => {
    const f = fixture(); const a = f.watch(); const b = f.source.watch([id, id])
    expect(f.retain).toHaveBeenCalledExactlyOnceWith(id, { source: 'workbenchTabStatus' })
    a(); a(); expect(f.release).not.toHaveBeenCalled()
    b(); expect(f.release).toHaveBeenCalledTimes(1)
    expect(f.source.getSnapshot().size).toBe(0)
    expect(f.session.listeners.size + f.events.listeners.size + f.inbox.listeners.size).toBe(0)
    f.source.dispose(); expect(f.interactions.listeners.size + f.generation.listeners.size).toBe(0)
  })

  it('disposes observers and ignores late ready failures or released callbacks', async () => {
    const f = fixture(); f.watch(); f.source.dispose(); f.rejectReady(); await Promise.resolve()
    f.update({ running: true }); f.watch()
    expect(f.release).toHaveBeenCalledTimes(1)
    expect(f.source.getSnapshot().size).toBe(0)
  })

  it('recovers from initial open failure when the native session later recovers', async () => {
    const f = fixture([], { openState: 'loading' }); f.watch()
    expect(f.read()?.status).toBe('unknown')
    f.rejectReady(); await Promise.resolve(); expect(f.read()?.status).toBe('failed')
    f.journal([turn(1, 1), turn(1, 3, 'completed')], 'replace'); f.update({ openState: 'open', blank: false })
    expect(f.read()?.status).toBe('completed')
  })

  it('does not publish on unrelated interactions or unchanged token-stream state', () => {
    const f = fixture([turn(1, 1)], { running: true }); f.watch()
    const listener = vi.fn(); f.source.subscribe(listener)
    f.pending(); f.journal([]); f.journal([])
    expect(listener).not.toHaveBeenCalled()
    f.pending('approval'); expect(listener).toHaveBeenCalledTimes(1)
  })
})
