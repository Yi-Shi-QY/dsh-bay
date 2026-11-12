import { describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  applyDraftOperations,
  createMemoryWorkbenchCollaborationStore,
  transformDraftPosition,
  transformDraftOperations,
} from '../src/workbench-collaboration-contract.ts'
import { createFileWorkbenchCollaborationStore, createWorkbenchCollaborationManager, createWorkbenchCollaborationSession } from '../src/host-workbench-collaboration.ts'

describe('Workbench collaboration contract', () => {
  it('applies and transforms concurrent draft operations without losing text', () => {
    const base = 'ab'
    const left = [{ type: 'retain', count: 1 }, { type: 'insert', text: 'L' }] as const
    const right = [{ type: 'retain', count: 1 }, { type: 'insert', text: 'R' }] as const
    const [leftAfterRight, rightAfterLeft] = transformDraftOperations(left, right)
    const leftResult = applyDraftOperations(applyDraftOperations(base, right), leftAfterRight)
    const rightResult = applyDraftOperations(applyDraftOperations(base, left), rightAfterLeft)
    expect(leftResult).toBe(rightResult)
    expect(leftResult).toContain('L')
    expect(leftResult).toContain('R')
  })

  it('maps shared cursor and selection positions through insertions and deletions', () => {
    const insert = [{ type: 'retain', count: 2 }, { type: 'insert', text: 'XY' }] as const
    expect(transformDraftPosition(2, insert, 'left')).toBe(2)
    expect(transformDraftPosition(2, insert, 'right')).toBe(4)
    expect(transformDraftPosition(5, insert)).toBe(7)
    const remove = [{ type: 'retain', count: 1 }, { type: 'delete', count: 3 }] as const
    expect(transformDraftPosition(3, remove)).toBe(1)
    expect(transformDraftPosition(5, remove)).toBe(2)
  })
})

describe('Host Workbench collaboration session', () => {
  it('shares canvas, focus, presence and idempotent commands through one session', async () => {
    const events: string[] = []
    const session = createWorkbenchCollaborationSession('collab-a', 'workbench-a', 'owner', {
      drafts: { draft: { draftId: 'draft', areaId: 'area-a', editorId: 'workbench.conversation', text: '', revision: 0, attachments: [], selections: {} } },
    }, { randomId: (() => { let i = 0; return () => `event-${++i}` })() })
    session.subscribe(event => { events.push(event.kind) })
    expect(session.connect({ collaborationId: 'collab-a', workbenchId: 'workbench-a', participantId: 'owner', displayName: '房主', role: 'owner' })).not.toHaveProperty('error')
    expect(session.connect({ collaborationId: 'collab-a', workbenchId: 'workbench-a', participantId: 'guest', displayName: '协作者', role: 'participant' })).not.toHaveProperty('error')
    const result = await session.command({
      requestId: 'focus-1', collaborationId: 'collab-a', workbenchId: 'workbench-a', participantId: 'guest', baseRevision: 0,
      operation: { kind: 'canvas.set-focus', focus: { areaId: 'area-a', editorId: 'workbench.conversation' } },
    })
    expect(result.ok).toBe(true)
    const repeated = await session.command({
      requestId: 'focus-1', collaborationId: 'collab-a', workbenchId: 'workbench-a', participantId: 'guest', baseRevision: 0,
      operation: { kind: 'canvas.set-focus', focus: { areaId: 'area-a', editorId: 'workbench.conversation' } },
    })
    expect(repeated).toEqual(result)
    session.publishPresence({ participantId: 'guest', displayName: '协作者', role: 'participant', areaId: 'area-a', editorId: 'workbench.conversation', intent: 'editing', connectionState: 'connected', updatedAt: 0 })
    expect(session.snapshot().participants).toEqual(expect.arrayContaining([expect.objectContaining({ participantId: 'guest', intent: 'editing' })]))
    expect(events).toEqual(expect.arrayContaining(['participant.joined', 'canvas.focus.changed', 'presence.changed']))
  })

  it('replays events after a reconnect cursor and requests resync for an expired cursor', async () => {
    const session = createWorkbenchCollaborationSession('collab-replay', 'workbench-replay', 'owner', {}, { randomId: (() => { let i = 0; return () => `replay-${++i}` })() })
    session.connect({ collaborationId: 'collab-replay', workbenchId: 'workbench-replay', participantId: 'owner', displayName: 'Owner', role: 'owner' })
    await session.command({
      requestId: 'replay-first', collaborationId: 'collab-replay', workbenchId: 'workbench-replay', participantId: 'owner', baseRevision: 0,
      operation: { kind: 'canvas.set-focus', focus: { areaId: 'area-a', editorId: 'workbench.conversation' } },
    })
    const cursor = session.eventsSince('replay-1')
    expect(cursor).toBeDefined()
    await session.command({
      requestId: 'replay-second', collaborationId: 'collab-replay', workbenchId: 'workbench-replay', participantId: 'owner', baseRevision: 0,
      operation: { kind: 'canvas.set-focus', focus: { areaId: 'area-b', editorId: 'workbench.conversation' } },
    })
    expect(session.eventsSince('replay-1')).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'canvas.focus.changed' })]))
    expect(session.eventsSince('missing-cursor')).toBeUndefined()
  })

  it('uses a target lease to protect continuous canvas changes', async () => {
    const session = createWorkbenchCollaborationSession('collab-b', 'workbench-b', 'owner')
    session.connect({ collaborationId: 'collab-b', workbenchId: 'workbench-b', participantId: 'owner', displayName: '房主', role: 'owner' })
    session.connect({ collaborationId: 'collab-b', workbenchId: 'workbench-b', participantId: 'guest', displayName: '协作者', role: 'participant' })
    const first = session.acquireControlLease('owner', 'layout')
    expect(first.ok).toBe(true)
    const second = session.acquireControlLease('guest', 'layout')
    expect(second).toEqual({ ok: false, error: 'control-lease-held' })
    if (first.ok) expect(session.releaseControlLease('owner', 'layout', first.leaseId)).toBe(true)
    expect(session.acquireControlLease('guest', 'layout').ok).toBe(true)
    const denied = await session.command({
      requestId: 'layout-1', collaborationId: 'collab-b', workbenchId: 'workbench-b', participantId: 'owner', baseRevision: 0,
      operation: { kind: 'canvas.set-layout', layout: { split: 0.5 }, leaseId: 'stale' },
    })
    expect(denied).toMatchObject({ ok: false, code: 'control-lease-required' })
  })
})

describe('Workbench collaboration manager', () => {
  it('publishes task changes from the Host runtime to the shared snapshot', async () => {
    let listener: ((tasks: readonly unknown[]) => void) | undefined
    const manager = createWorkbenchCollaborationManager({
      loadSeed: () => ({ tasks: [{ workItemId: 'task-1', status: 'queued' }] }),
      subscribeTaskChanges: (_workbenchId, next) => { listener = next; return () => { listener = undefined } },
      randomId: () => 'task-session',
    })
    const started = await manager.start('workbench-task', 'owner')
    started.session.connect({ collaborationId: started.collaborationId, workbenchId: 'workbench-task', participantId: 'owner', displayName: 'Owner', role: 'owner' })
    listener?.([{ workItemId: 'task-1', status: 'running' }])
    expect(started.session.snapshot().tasks).toEqual([{ workItemId: 'task-1', status: 'running' }])
    await manager.stop('workbench-task')
    expect(listener).toBeUndefined()
  })

  it('keeps one session per Workbench and persists snapshots through its store', async () => {
    const store = createMemoryWorkbenchCollaborationStore()
    const manager = createWorkbenchCollaborationManager({ store, randomId: () => 'id' })
    const first = await manager.start('workbench-a', 'owner')
    const second = await manager.start('workbench-a', 'owner-2')
    expect(second.collaborationId).toBe(first.collaborationId)
    first.session.connect({ collaborationId: first.collaborationId, workbenchId: 'workbench-a', participantId: 'owner', displayName: '房主', role: 'owner' })
    await first.session.command({
      requestId: 'viewport-1', collaborationId: first.collaborationId, workbenchId: 'workbench-a', participantId: 'owner', baseRevision: 0,
      operation: { kind: 'canvas.set-viewport', viewport: { width: 1440, height: 900, scaleMode: 'contain' } },
    })
    expect(first.session.snapshot().sharedCanvas.viewport.width).toBe(1440)
    expect(manager.getById(first.collaborationId)).toBe(first.session)
    await manager.stop('workbench-a')
    expect(manager.get('workbench-a')).toBeUndefined()
  })

  it('restores an active session with its original collaboration identity', async () => {
    const store = createMemoryWorkbenchCollaborationStore()
    const first = createWorkbenchCollaborationManager({ store, randomId: () => 'first' })
    const started = await first.start('workbench-recover', 'owner')
    await started.session.command({
      requestId: 'recover-layout', collaborationId: started.collaborationId, workbenchId: 'workbench-recover', participantId: 'owner', baseRevision: 0,
      operation: { kind: 'canvas.set-focus', focus: { areaId: 'area-a', editorId: 'workbench.conversation' } },
    })
    await Promise.resolve()
    const second = createWorkbenchCollaborationManager({ store, randomId: () => 'second' })
    const restored = await second.start('workbench-recover', 'owner-2')
    expect(restored.collaborationId).toBe(started.collaborationId)
    expect(restored.session.snapshot().sharedCanvas.focus).toEqual({ areaId: 'area-a', editorId: 'workbench.conversation' })
    expect(restored.session.snapshot().participants).toEqual(expect.arrayContaining([expect.objectContaining({ participantId: 'owner', connectionState: 'stale' })]))
  })

  it('recovers the active snapshot from the Workbench collaboration log', async () => {
    const root = await mkdtemp(join(tmpdir(), 'bay-collaboration-'))
    try {
      const store = createFileWorkbenchCollaborationStore(id => id === 'workbench-file' ? root : undefined)
      const first = createWorkbenchCollaborationManager({ store, randomId: () => 'file-session' })
      const started = await first.start('workbench-file', 'owner')
      await started.session.command({
        requestId: 'file-focus', collaborationId: started.collaborationId, workbenchId: 'workbench-file', participantId: 'owner', baseRevision: 0,
        operation: { kind: 'canvas.set-focus', focus: { areaId: 'area-a', editorId: 'workbench.conversation' } },
      })
      await new Promise(resolve => setTimeout(resolve, 10))
      expect(JSON.parse(await readFile(join(root, '.bay', 'collaboration', 'active-v1.json'), 'utf8')).snapshot.sharedCanvas.focus).toEqual({ areaId: 'area-a', editorId: 'workbench.conversation' })
      const second = createWorkbenchCollaborationManager({ store, randomId: () => 'new-session' })
      const restored = await second.start('workbench-file', 'owner-2')
      expect(restored.collaborationId).toBe(started.collaborationId)
      expect(restored.session.snapshot().sharedCanvas.focus).toEqual({ areaId: 'area-a', editorId: 'workbench.conversation' })
      await second.stop('workbench-file')
      await expect(readFile(join(root, '.bay', 'collaboration', 'active-v1.json'), 'utf8')).rejects.toThrow()
    } finally { await rm(root, { recursive: true, force: true }) }
  })

  it('restores the event cursor and command idempotency from the activity log', async () => {
    const root = await mkdtemp(join(tmpdir(), 'bay-collaboration-log-'))
    try {
      const store = createFileWorkbenchCollaborationStore(id => id === 'workbench-log' ? root : undefined)
      const first = createWorkbenchCollaborationManager({ store, randomId: () => 'logged-session' })
      const started = await first.start('workbench-log', 'owner')
      const accepted = await started.session.command({
        requestId: 'logged-command', collaborationId: started.collaborationId, workbenchId: 'workbench-log', participantId: 'owner', baseRevision: 0,
        operation: { kind: 'canvas.set-focus', focus: { areaId: 'area-a', editorId: 'workbench.conversation' } },
      })
      await new Promise(resolve => setTimeout(resolve, 10))
      const second = createWorkbenchCollaborationManager({ store, randomId: () => 'restored-session' })
      const restored = await second.start('workbench-log', 'owner-2')
      expect(restored.session.eventsSince('logged-session')).toEqual(expect.arrayContaining([expect.objectContaining({ requestId: 'logged-command', kind: 'canvas.focus.changed' })]))
      const repeated = await restored.session.command({
        requestId: 'logged-command', collaborationId: restored.collaborationId, workbenchId: 'workbench-log', participantId: 'owner-2', baseRevision: 0,
        operation: { kind: 'canvas.set-focus', focus: { areaId: 'area-a', editorId: 'workbench.conversation' } },
      })
      expect(repeated).toEqual(accepted)
      await second.stop('workbench-log')
    } finally { await rm(root, { recursive: true, force: true }) }
  })

  it('refreshes durable Workbench facts without replacing live canvas or drafts', async () => {
    const session = createWorkbenchCollaborationSession('collab-refresh', 'workbench-refresh', 'owner', {
      definition: { name: 'before' },
      sharedCanvas: { layout: { version: 2, root: { kind: 'group', id: 'before', tabs: [] }, activeGroupId: 'before' } },
      drafts: { draft: { draftId: 'draft', areaId: 'area-a', editorId: 'workbench.conversation', text: 'local', revision: 0, attachments: [], selections: {} } },
    })
    session.connect({ collaborationId: 'collab-refresh', workbenchId: 'workbench-refresh', participantId: 'owner', displayName: '房主', role: 'owner' })
    await session.command({
      requestId: 'draft-refresh', collaborationId: 'collab-refresh', workbenchId: 'workbench-refresh', participantId: 'owner', baseRevision: 0,
      operation: { kind: 'draft.apply', operation: { draftId: 'draft', baseRevision: 0, requestId: 'draft-refresh', participantId: 'owner', operations: [{ type: 'retain', count: 5 }, { type: 'insert', text: '!' }] } },
    })
    session.refresh({
      definition: { name: 'after' },
      sharedCanvas: { layout: { version: 2, root: { kind: 'group', id: 'after', tabs: [] }, activeGroupId: 'after' } },
      drafts: { replacement: { draftId: 'replacement', areaId: 'area-b', editorId: 'workbench.conversation', text: 'must not replace live draft', revision: 0, attachments: [], selections: {} } },
    })
    const snapshot = session.snapshot()
    expect(snapshot.definition).toEqual({ name: 'after' })
    expect(snapshot.sharedCanvas.layout).toMatchObject({ activeGroupId: 'after' })
    expect(snapshot.drafts.draft?.text).toBe('local!')
    expect(snapshot.drafts.replacement).toBeUndefined()
  })

  it('persists a shared layout before acknowledging the canvas command', async () => {
    const persisted: unknown[] = []
    const session = createWorkbenchCollaborationSession('collab-persist', 'workbench-persist', 'owner', {}, {
      persistLayout: async input => { persisted.push(input.layout); return { status: 'committed' } },
    })
    session.connect({ collaborationId: 'collab-persist', workbenchId: 'workbench-persist', participantId: 'owner', displayName: '房主', role: 'owner' })
    const layout = { version: 2, root: { kind: 'group', id: 'area-a', tabs: [] }, activeGroupId: 'area-a' }
    const result = await session.command({
      requestId: 'layout-persist-1', collaborationId: 'collab-persist', workbenchId: 'workbench-persist', participantId: 'owner', baseRevision: 0,
      operation: { kind: 'canvas.set-layout', layout },
    })
    expect(result.ok).toBe(true)
    expect(persisted).toEqual([layout])
    expect(session.snapshot().sharedCanvas.layout).toEqual(layout)
  })

  it('creates one shared draft identity for all participants', async () => {
    const session = createWorkbenchCollaborationSession('collab-draft', 'workbench-draft', 'owner', {
      areas: [{ areaId: 'area' }],
      editors: [{ areaId: 'area', editorId: 'editor' }],
      sessions: [{ sessionId: 'session' }],
    })
    session.connect({ collaborationId: 'collab-draft', workbenchId: 'workbench-draft', participantId: 'owner', displayName: '房主', role: 'owner' })
    session.connect({ collaborationId: 'collab-draft', workbenchId: 'workbench-draft', participantId: 'guest', displayName: '参与者', role: 'participant' })
    const first = await session.command({
      requestId: 'draft-ensure-owner', collaborationId: 'collab-draft', workbenchId: 'workbench-draft', participantId: 'owner', baseRevision: 0,
      operation: { kind: 'draft.ensure', draftId: 'draft:area:editor:session', areaId: 'area', editorId: 'editor', sessionId: 'session' },
    })
    expect(first.ok).toBe(true)
    const second = await session.command({
      requestId: 'draft-ensure-guest', collaborationId: 'collab-draft', workbenchId: 'workbench-draft', participantId: 'guest', baseRevision: 1,
      operation: { kind: 'draft.ensure', draftId: 'draft:area:editor:session', areaId: 'area', editorId: 'editor', sessionId: 'session' },
    })
    expect(second).toMatchObject({ ok: true, value: { draftId: 'draft:area:editor:session', revision: 0 } })
    expect(Object.keys(session.snapshot().drafts)).toEqual(['draft:area:editor:session'])
  })

  it('moves remote selections with each committed shared draft operation', async () => {
    const session = createWorkbenchCollaborationSession('collab-selection', 'workbench-selection', 'owner', {
      drafts: { draft: { draftId: 'draft', areaId: 'area', editorId: 'editor', text: 'abcdef', revision: 0, attachments: [], selections: { remote: { start: 3, end: 5 } } } },
    })
    session.connect({ collaborationId: 'collab-selection', workbenchId: 'workbench-selection', participantId: 'owner', displayName: 'Owner', role: 'owner' })
    const result = await session.command({
      requestId: 'selection-insert', collaborationId: 'collab-selection', workbenchId: 'workbench-selection', participantId: 'owner', baseRevision: 0,
      operation: { kind: 'draft.apply', operation: { draftId: 'draft', baseRevision: 0, requestId: 'selection-insert', participantId: 'owner', operations: [{ type: 'retain', count: 2 }, { type: 'insert', text: 'XY' }] } },
    })
    expect(result.ok).toBe(true)
    expect(session.snapshot().drafts.draft?.text).toBe('abXYcdef')
    expect(session.snapshot().drafts.draft?.selections.remote).toEqual({ start: 5, end: 7 })
  })

  it('moves a participant to recovering after the presence TTL expires', async () => {
    let now = 1_000
    const session = createWorkbenchCollaborationSession('collab-ttl', 'workbench-ttl', 'owner', {
      drafts: { draft: { draftId: 'draft', areaId: 'area', editorId: 'editor', text: 'text', revision: 0, attachments: [], selections: { guest: { start: 1, end: 2 } } } },
    }, { now: () => now })
    session.connect({ collaborationId: 'collab-ttl', workbenchId: 'workbench-ttl', participantId: 'owner', displayName: '房主', role: 'owner' })
    session.connect({ collaborationId: 'collab-ttl', workbenchId: 'workbench-ttl', participantId: 'guest', displayName: '参与者', role: 'participant' })
    now += 90_001
    expect(session.snapshot().participants).toEqual(expect.arrayContaining([expect.objectContaining({ participantId: 'guest', connectionState: 'stale', intent: 'recovering' })]))
    expect(session.snapshot().drafts.draft?.selections).toEqual({})
    const result = await session.command({
      requestId: 'stale-command', collaborationId: 'collab-ttl', workbenchId: 'workbench-ttl', participantId: 'guest', baseRevision: 0,
      operation: { kind: 'canvas.set-focus', focus: { areaId: 'area', editorId: 'editor' } },
    })
    expect(result).toMatchObject({ ok: false, code: 'permission-denied' })
  })

  it('clears remote draft selections as soon as a participant disconnects', () => {
    const session = createWorkbenchCollaborationSession('collab-disconnect', 'workbench-disconnect', 'owner', {
      drafts: { draft: { draftId: 'draft', areaId: 'area', editorId: 'editor', text: 'text', revision: 0, attachments: [], selections: { participant: { start: 1, end: 2 } } } },
    })
    session.connect({ collaborationId: 'collab-disconnect', workbenchId: 'workbench-disconnect', participantId: 'owner', displayName: 'Owner', role: 'owner' })
    session.connect({ collaborationId: 'collab-disconnect', workbenchId: 'workbench-disconnect', participantId: 'participant', displayName: 'Participant', role: 'participant' })
    session.disconnect('participant')
    expect(session.snapshot().drafts.draft?.selections).toEqual({})
  })

  it('reuses a participant slot after a participant disconnects', () => {
    const session = createWorkbenchCollaborationSession('collab-slots', 'workbench-slots', 'owner', {}, { maxParticipants: 2 })
    session.connect({ collaborationId: 'collab-slots', workbenchId: 'workbench-slots', participantId: 'owner', displayName: 'Owner', role: 'owner' })
    session.connect({ collaborationId: 'collab-slots', workbenchId: 'workbench-slots', participantId: 'first', displayName: 'First', role: 'participant' })
    session.disconnect('first')
    expect(session.connect({ collaborationId: 'collab-slots', workbenchId: 'workbench-slots', participantId: 'second', displayName: 'Second', role: 'participant' })).not.toHaveProperty('error')
  })

  it('runs Host authorization before accepting a shared command', async () => {
    const session = createWorkbenchCollaborationSession('collab-auth', 'workbench-auth', 'owner', {}, {
      authorizeCommand: ({ role }) => { if (role === 'participant') { const error = new Error('capability-denied'); Object.assign(error, { code: 'capability-denied' }); throw error } },
    })
    session.connect({ collaborationId: 'collab-auth', workbenchId: 'workbench-auth', participantId: 'owner', displayName: '房主', role: 'owner' })
    session.connect({ collaborationId: 'collab-auth', workbenchId: 'workbench-auth', participantId: 'guest', displayName: '参与者', role: 'participant' })
    const result = await session.command({
      requestId: 'auth-denied', collaborationId: 'collab-auth', workbenchId: 'workbench-auth', participantId: 'guest', baseRevision: 0,
      operation: { kind: 'canvas.set-focus', focus: { areaId: 'area', editorId: 'editor' } },
    })
    expect(result).toMatchObject({ ok: false, code: 'permission-denied' })
  })

  it('sanitizes presence against the shared Workbench facts', () => {
    const session = createWorkbenchCollaborationSession('collab-presence', 'workbench-presence', 'owner', {
      areas: [{ areaId: 'area-a' }], editors: [{ areaId: 'area-a', editorId: 'editor-a' }], sessions: [{ sessionId: 'session-a' }],
      drafts: { draft: { draftId: 'draft', areaId: 'area-a', editorId: 'editor-a', sessionId: 'session-a', text: 'hello', revision: 0, attachments: [], selections: {} } },
    })
    session.connect({ collaborationId: 'collab-presence', workbenchId: 'workbench-presence', participantId: 'owner', displayName: 'Owner', role: 'owner' })
    session.publishPresence({ participantId: 'owner', displayName: 'forged', role: 'participant', areaId: 'outside', editorId: '/absolute/path', sessionId: 'outside', draftId: 'missing', intent: 'invalid' as never, connectionState: 'connected', updatedAt: 0 })
    expect(session.snapshot().participants).toEqual([expect.objectContaining({ participantId: 'owner', displayName: 'Owner', role: 'owner', intent: 'viewing' })])
    expect(session.snapshot().participants[0]).not.toHaveProperty('areaId')
    expect(session.snapshot().participants[0]).not.toHaveProperty('editorId')
  })

  it('does not publish a layout after Host persistence rejects it', async () => {
    const session = createWorkbenchCollaborationSession('collab-persist-fail', 'workbench-persist-fail', 'owner', {}, {
      persistLayout: async () => { throw new Error('revision-conflict') },
    })
    session.connect({ collaborationId: 'collab-persist-fail', workbenchId: 'workbench-persist-fail', participantId: 'owner', displayName: '房主', role: 'owner' })
    const result = await session.command({
      requestId: 'layout-persist-fail-1', collaborationId: 'collab-persist-fail', workbenchId: 'workbench-persist-fail', participantId: 'owner', baseRevision: 0,
      operation: { kind: 'canvas.set-layout', layout: { version: 2, root: { kind: 'group', id: 'area-a', tabs: [] }, activeGroupId: 'area-a' } },
    })
    expect(result).toMatchObject({ ok: false, code: 'command-failed' })
    expect(session.snapshot().sharedCanvas.layout).toBeUndefined()
  })
})
