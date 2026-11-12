import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import {
  applyDraftOperations,
  createInitialSharedCanvasV1,
  createMemoryWorkbenchCollaborationStore,
  normalizeDraftOperations,
  transformDraftPosition,
  transformDraftOperations,
  type DraftOperationEnvelopeV1,
  type ParticipantPresenceV1,
  type SharedCanvasFocusV1,
  type SharedCanvasStateV1,
  type SharedDraftStateV1,
  type WorkbenchCollaborationConnectV1,
  type WorkbenchCollaborationEventV1,
  type WorkbenchCollaborationSeedV1,
  type WorkbenchCollaborationSessionV1,
  type WorkbenchCollaborationSnapshotV1,
  type WorkbenchCollaborationStoreV1,
  type WorkbenchCommandEnvelopeV1,
  type WorkbenchCommandResultV1,
  type WorkbenchCommandV1,
} from './workbench-collaboration-contract.ts'

export type {
  ParticipantPresenceV1,
  SharedCanvasFocusV1,
  SharedCanvasStateV1,
  SharedDraftStateV1,
  WorkbenchCollaborationConnectV1,
  WorkbenchCollaborationEventV1,
  WorkbenchCollaborationSeedV1,
  WorkbenchCollaborationSnapshotV1,
  WorkbenchCollaborationStoreV1,
  WorkbenchCommandEnvelopeV1,
  WorkbenchCommandResultV1,
  WorkbenchCommandV1,
} from './workbench-collaboration-contract.ts'

const MAX_PARTICIPANTS = 6
const CONTROL_LEASE_MS = 2_000
const PRESENCE_TTL_MS = 90_000

interface Lease {
  readonly leaseId: string
  readonly participantId: string
  readonly targetId: string
  expiresAt: number
}

interface SessionState {
  collaborationId: string
  workbenchId: string
  ownerParticipantId: string
  workbenchRevision: number
  canvasRevision: number
  sharedCanvas: SharedCanvasStateV1
  drafts: Record<string, SharedDraftStateV1>
  participants: Record<string, ParticipantPresenceV1>
  seed: WorkbenchCollaborationSeedV1
}

/** Extra fields kept only in the Host activity log. They are deliberately not
 * part of the client snapshot contract, but are structurally compatible with
 * it so existing stores remain usable. */
type PersistedCollaborationSnapshotV1 = WorkbenchCollaborationSnapshotV1 & {
  readonly eventLog?: readonly WorkbenchCollaborationEventV1[]
  readonly commandResults?: Readonly<Record<string, WorkbenchCommandResultV1>>
}

export interface WorkbenchCollaborationSessionViewV1 {
  snapshot(): WorkbenchCollaborationSnapshotV1
  /** Refresh durable Workbench facts without replacing live canvas or drafts. */
  refresh(seed: WorkbenchCollaborationSeedV1): void
  publishTaskSnapshot(tasks: readonly unknown[]): void
  connect(input: WorkbenchCollaborationConnectV1): WorkbenchCollaborationSnapshotV1 | { readonly error: string }
  disconnect(participantId: string): void
  command(input: WorkbenchCommandEnvelopeV1): Promise<WorkbenchCommandResultV1>
  publishPresence(presence: ParticipantPresenceV1): void
  subscribe(listener: (event: WorkbenchCollaborationEventV1) => void): () => void
  eventsSince(eventId?: string): readonly WorkbenchCollaborationEventV1[] | undefined
  acquireControlLease(participantId: string, targetId: string): { readonly ok: true; readonly leaseId: string; readonly expiresAt: number } | { readonly ok: false; readonly error: string }
  releaseControlLease(participantId: string, targetId: string, leaseId: string): boolean
}

export interface WorkbenchCollaborationManagerOptionsV1 {
  readonly now?: () => number
  readonly randomId?: () => string
  readonly maxParticipants?: number
  readonly store?: WorkbenchCollaborationStoreV1
  readonly loadSeed?: (workbenchId: string) => Promise<WorkbenchCollaborationSeedV1> | WorkbenchCollaborationSeedV1
  readonly executeCommand?: (input: {
    readonly collaborationId: string
    readonly workbenchId: string
    readonly participantId: string
    readonly operation: Exclude<WorkbenchCommandV1, { kind: 'draft.ensure' | 'draft.apply' | 'draft.set-attachments' | 'draft.set-selection' | 'draft.clear' | 'canvas.set-viewport' | 'canvas.set-focus' | 'canvas.set-focus-lock' | 'canvas.set-layout' | 'canvas.set-floating-panels' | 'layout.acquire-lease' | 'layout.release-lease' }>
  }) => Promise<unknown> | unknown
  /** Persist the shared visual layout through the Host directory writer. */
  readonly persistLayout?: (input: {
    readonly collaborationId: string
    readonly workbenchId: string
    readonly participantId: string
    readonly layout: unknown
  }) => Promise<unknown> | unknown
  /** Final Host-side authorization for every shared command. */
  readonly authorizeCommand?: (input: {
    readonly collaborationId: string
    readonly workbenchId: string
    readonly participantId: string
    readonly role: 'owner' | 'participant'
    readonly operation: WorkbenchCommandV1
  }) => Promise<void> | void
  readonly subscribeTaskChanges?: (workbenchId: string, listener: (tasks: readonly unknown[]) => void) => (() => void) | undefined
  readonly initialSnapshot?: WorkbenchCollaborationSnapshotV1
}

function cloneSnapshot(snapshot: WorkbenchCollaborationSnapshotV1): WorkbenchCollaborationSnapshotV1 {
  return structuredClone(snapshot)
}

function validViewport(viewport: { readonly width: number; readonly height: number; readonly scaleMode: SharedCanvasStateV1['viewport']['scaleMode'] }): boolean {
  return Number.isFinite(viewport.width) && viewport.width >= 320 && viewport.width <= 10_000
    && Number.isFinite(viewport.height) && viewport.height >= 240 && viewport.height <= 10_000
    && ['contain', 'cover', 'fixed'].includes(viewport.scaleMode)
}

function isOwner(state: SessionState, participantId: string): boolean {
  return state.participants[participantId]?.role === 'owner'
}

function participantSnapshot(state: SessionState): readonly ParticipantPresenceV1[] {
  return Object.values(state.participants).map(value => ({ ...value }))
}

function activeSeedLocation(seed: WorkbenchCollaborationSeedV1): Pick<ParticipantPresenceV1, 'areaId' | 'editorId' | 'sessionId'> {
  const layout = seed.sharedCanvas?.layout
  if (!layout || typeof layout !== 'object' || Array.isArray(layout)) return {}
  const value = layout as { activeGroupId?: unknown; root?: unknown }
  if (typeof value.activeGroupId !== 'string') return {}
  const activeGroupId = value.activeGroupId
  const visit = (node: unknown): { areaId: string; editorId: string; sessionId?: string } | undefined => {
    if (!node || typeof node !== 'object' || Array.isArray(node)) return undefined
    const candidate = node as { kind?: unknown; id?: unknown; activeTabId?: unknown; tabs?: unknown; first?: unknown; second?: unknown }
    if (candidate.kind === 'group' && candidate.id === activeGroupId && typeof candidate.activeTabId === 'string' && Array.isArray(candidate.tabs)) {
      const tab = candidate.tabs.find(item => item && typeof item === 'object' && (item as { id?: unknown }).id === candidate.activeTabId) as { editorId?: unknown; sessionId?: unknown } | undefined
      if (typeof tab?.editorId === 'string') return { areaId: activeGroupId, editorId: tab.editorId, ...(typeof tab.sessionId === 'string' ? { sessionId: tab.sessionId } : {}) }
    }
    return visit(candidate.first) ?? visit(candidate.second)
  }
  return visit(value.root) ?? {}
}

function stateSnapshot(state: SessionState): WorkbenchCollaborationSnapshotV1 {
  return Object.freeze({
    schemaVersion: 1,
    collaborationId: state.collaborationId,
    workbenchId: state.workbenchId,
    ownerParticipantId: state.ownerParticipantId,
    workbenchRevision: state.workbenchRevision,
    canvasRevision: state.canvasRevision,
    definition: structuredClone(state.seed.definition),
    areas: structuredClone(state.seed.areas ?? []),
    editors: structuredClone(state.seed.editors ?? []),
    sessions: structuredClone(state.seed.sessions ?? []),
    projects: structuredClone(state.seed.projects ?? []),
    tasks: structuredClone(state.seed.tasks ?? []),
    memories: structuredClone(state.seed.memories ?? []),
    contexts: structuredClone(state.seed.contexts ?? []),
    sharedCanvas: structuredClone(state.sharedCanvas),
    drafts: structuredClone(state.drafts),
    participants: participantSnapshot(state),
    redactions: ['workbench-root-path', 'credentials', 'host-process-control'],
    unavailableCapabilities: ['account', 'plugin-install', 'native-folder-picker', 'share-management', 'arbitrary-terminal'],
  })
}

function initialDrafts(seed: WorkbenchCollaborationSeedV1): Record<string, SharedDraftStateV1> {
  return Object.fromEntries(Object.entries(seed.drafts ?? {}).map(([draftId, value]) => [draftId, {
    ...structuredClone(value),
    draftId,
    revision: value.revision ?? 0,
    attachments: [...(value.attachments ?? [])],
    selections: { ...(value.selections ?? {}) },
  }]))
}

function makeState(collaborationId: string, workbenchId: string, ownerParticipantId: string, seed: WorkbenchCollaborationSeedV1): SessionState {
  return {
    collaborationId,
    workbenchId,
    ownerParticipantId,
    workbenchRevision: 0,
    canvasRevision: 0,
    sharedCanvas: createInitialSharedCanvasV1(seed.sharedCanvas),
    drafts: initialDrafts(seed),
    participants: {},
    seed,
  }
}

export function createWorkbenchCollaborationSession(
  collaborationId: string,
  workbenchId: string,
  ownerParticipantId: string,
  seed: WorkbenchCollaborationSeedV1 = {},
  options: WorkbenchCollaborationManagerOptionsV1 = {},
): WorkbenchCollaborationSessionViewV1 {
  const now = options.now ?? Date.now
  const randomId = options.randomId ?? randomUUID
  const maxParticipants = options.maxParticipants ?? MAX_PARTICIPANTS
  const listeners = new Set<(event: WorkbenchCollaborationEventV1) => void>()
  const commandResults = new Map<string, WorkbenchCommandResultV1>()
  const eventLog: WorkbenchCollaborationEventV1[] = []
  const leases = new Map<string, Lease>()
  const state = makeState(collaborationId, workbenchId, ownerParticipantId, seed)
  if (options.initialSnapshot !== undefined) {
    state.workbenchRevision = options.initialSnapshot.workbenchRevision
    state.canvasRevision = options.initialSnapshot.canvasRevision
    state.sharedCanvas = structuredClone(options.initialSnapshot.sharedCanvas)
    state.drafts = structuredClone(options.initialSnapshot.drafts)
    for (const participant of options.initialSnapshot.participants) state.participants[participant.participantId] = { ...participant, connectionState: 'stale', intent: 'recovering' }
    const persisted = options.initialSnapshot as PersistedCollaborationSnapshotV1
    if (Array.isArray(persisted.eventLog)) eventLog.push(...structuredClone(persisted.eventLog).slice(-512))
    if (persisted.commandResults !== undefined) for (const [requestId, result] of Object.entries(persisted.commandResults).slice(-512)) commandResults.set(requestId, structuredClone(result))
  }

  const pruneLeases = (): void => {
    const at = now()
    for (const [key, lease] of leases) if (lease.expiresAt <= at) leases.delete(key)
  }

  const pruneStaleParticipants = (): void => {
    const at = now()
    for (const participant of Object.values(state.participants)) {
      if (participant.role === 'owner' || participant.connectionState !== 'connected' || at - participant.updatedAt <= PRESENCE_TTL_MS) continue
      markParticipantStale(participant.participantId, at)
    }
  }

  const persist = (): void => {
    const store = options.store
    if (store === undefined) return
    const persisted: PersistedCollaborationSnapshotV1 = {
      ...stateSnapshot(state),
      ...(eventLog.length === 0 ? {} : { eventLog: structuredClone(eventLog) }),
      ...(commandResults.size === 0 ? {} : { commandResults: Object.fromEntries([...commandResults].slice(-512).map(([id, result]) => [id, structuredClone(result)])) }),
    }
    void Promise.resolve(store.save(persisted)).catch(() => {})
  }

  const rememberResult = (requestId: string, result: WorkbenchCommandResultV1): void => {
    commandResults.set(requestId, result)
    while (commandResults.size > 512) commandResults.delete(commandResults.keys().next().value as string)
    persist()
  }

  const emit = (actorId: string, kind: string, payload: unknown, requestId?: string, canvas = false): WorkbenchCollaborationEventV1 => {
    if (canvas) state.canvasRevision += 1
    else state.workbenchRevision += 1
    const event = Object.freeze({
      eventId: randomId(), collaborationId, workbenchId,
      workbenchRevision: state.workbenchRevision,
      canvasRevision: state.canvasRevision,
      actorId, ...(requestId === undefined ? {} : { requestId }), kind, payload: structuredClone(payload),
    })
    eventLog.push(event)
    if (eventLog.length > 512) eventLog.splice(0, eventLog.length - 512)
    for (const listener of [...listeners]) listener(event)
    persist()
    return event
  }

  const clearParticipantSelections = (participantId: string): void => {
    for (const draft of Object.values(state.drafts)) {
      if (draft.selections[participantId] === undefined) continue
      const selections = { ...draft.selections }
      delete selections[participantId]
      state.drafts[draft.draftId] = { ...draft, selections }
      emit(participantId, 'draft.selection.changed', { draftId: draft.draftId, participantId }, undefined, true)
    }
  }

  const markParticipantStale = (participantId: string, at = now()): void => {
    const participant = state.participants[participantId]
    if (participant === undefined) return
    const stale = { ...participant, connectionState: 'stale' as const, intent: 'recovering' as const, updatedAt: at }
    state.participants[participantId] = stale
    clearParticipantSelections(participantId)
    emit(participantId, 'presence.changed', stale, undefined, true)
    for (const [key, lease] of leases) if (lease.participantId === participantId) leases.delete(key)
  }

  const currentResult = (requestId: string): WorkbenchCommandResultV1 | undefined => commandResults.get(requestId)
  const success = (requestId: string, value?: unknown): WorkbenchCommandResultV1 => ({ ok: true, requestId, workbenchRevision: state.workbenchRevision, canvasRevision: state.canvasRevision, ...(value === undefined ? {} : { value: structuredClone(value) }) })
  const failure = (requestId: string, code: Extract<WorkbenchCommandResultV1, { ok: false }>['code'], message: string, current?: unknown): WorkbenchCommandResultV1 => ({ ok: false, requestId, code, message, workbenchRevision: state.workbenchRevision, canvasRevision: state.canvasRevision, ...(current === undefined ? {} : { current: structuredClone(current) }) })

  const leaseFor = (participantId: string, targetId: string, leaseId: string | undefined): Lease | undefined => {
    pruneLeases()
    const lease = leases.get(`${participantId}:${targetId}`)
    return lease?.leaseId === leaseId ? lease : undefined
  }

  const command = async (input: WorkbenchCommandEnvelopeV1): Promise<WorkbenchCommandResultV1> => {
    pruneStaleParticipants()
    const repeated = currentResult(input.requestId)
    if (repeated !== undefined) return repeated
    if (input.collaborationId !== collaborationId) return failure(input.requestId, 'collaboration-not-found', '协作会话不存在。')
    if (input.workbenchId !== workbenchId) return failure(input.requestId, 'workbench-mismatch', '命令不属于当前工作台。')
    if (state.participants[input.participantId] === undefined) return failure(input.requestId, 'permission-denied', '参与者不在协作会话中。')
    const participant = state.participants[input.participantId]
    if (participant === undefined || participant.connectionState !== 'connected') return failure(input.requestId, 'permission-denied', 'participant-not-connected')
    const operation = input.operation
    let result: WorkbenchCommandResultV1
    try {
      if (options.authorizeCommand !== undefined) await options.authorizeCommand({
        collaborationId,
        workbenchId,
        participantId: input.participantId,
        role: participant.role,
        operation,
      })
      if (operation.kind === 'draft.ensure') {
        const areaKnown = (state.seed.areas ?? []).some(value => value && typeof value === 'object' && (value as { areaId?: unknown }).areaId === operation.areaId)
        const editorKnown = (state.seed.editors ?? []).some(value => value && typeof value === 'object'
          && (value as { areaId?: unknown; editorId?: unknown }).areaId === operation.areaId
          && (value as { editorId?: unknown }).editorId === operation.editorId)
        const sessionKnown = operation.sessionId === undefined || (state.seed.sessions ?? []).some(value => value && typeof value === 'object' && (value as { sessionId?: unknown }).sessionId === operation.sessionId)
        if (!areaKnown || !editorKnown || !sessionKnown) result = failure(input.requestId, 'invalid-operation', '共享草稿不属于当前工作台。')
        else {
        const existing = state.drafts[operation.draftId]
        if (existing !== undefined) result = success(input.requestId, existing)
        else {
          const draft: SharedDraftStateV1 = {
            draftId: operation.draftId,
            areaId: operation.areaId,
            editorId: operation.editorId,
            ...(operation.sessionId === undefined ? {} : { sessionId: operation.sessionId }),
            text: '', revision: 0, attachments: [], selections: {},
          }
          state.drafts[operation.draftId] = draft
          emit(input.participantId, 'draft.created', draft, input.requestId)
          result = success(input.requestId, draft)
        }
        }
      } else if (operation.kind === 'draft.apply') {
        const draftInput = operation.operation
        const draft = state.drafts[draftInput.draftId]
        if (draft === undefined) { result = failure(input.requestId, 'draft-not-found', '共享草稿不存在。'); rememberResult(input.requestId, result); return result }
        let operations = normalizeDraftOperations(draftInput.operations)
        if (draftInput.baseRevision > draft.revision) { result = failure(input.requestId, 'draft-conflict', '共享草稿版本无效。', draft); rememberResult(input.requestId, result); return result }
        if (draftInput.baseRevision < draft.revision) {
          const history = eventLog.filter(event => event.kind === 'draft.changed' && event.payload && typeof event.payload === 'object' && (event.payload as { draftId?: unknown }).draftId === draftInput.draftId)
          for (const event of history) {
            const payload = event.payload as { baseRevision?: number; operations?: readonly unknown[] }
            if (payload.baseRevision !== undefined && payload.baseRevision >= draftInput.baseRevision && Array.isArray(payload.operations)) {
              ;[operations] = transformDraftOperations(operations, payload.operations as never)
            }
          }
        }
        const text = applyDraftOperations(draft.text, operations)
        const selections = Object.fromEntries(Object.entries(draft.selections).map(([participantId, selection]) => [participantId, {
          start: transformDraftPosition(selection.start, operations, 'left'),
          end: transformDraftPosition(selection.end, operations, 'right'),
        }]))
        const next: SharedDraftStateV1 = { ...draft, text, selections, revision: draft.revision + 1 }
        state.drafts[draftInput.draftId] = next
        emit(input.participantId, 'draft.changed', { draftId: draftInput.draftId, baseRevision: draft.revision, operations, text, selections, revision: next.revision }, input.requestId)
        result = success(input.requestId, next)
      } else if (operation.kind === 'draft.set-attachments') {
        const draft = state.drafts[operation.draftId]
        if (draft === undefined) result = failure(input.requestId, 'draft-not-found', '共享草稿不存在。')
        else if (operation.baseRevision !== draft.revision) result = failure(input.requestId, 'draft-conflict', '共享草稿版本已变化。', draft)
        else {
          const next = { ...draft, attachments: structuredClone(operation.attachments), revision: draft.revision + 1 }
          state.drafts[operation.draftId] = next
          emit(input.participantId, 'draft.attachments.changed', next, input.requestId)
          result = success(input.requestId, next)
        }
      } else if (operation.kind === 'draft.set-selection') {
        const draft = state.drafts[operation.draftId]
        if (draft === undefined) result = failure(input.requestId, 'draft-not-found', '共享草稿不存在。')
        else {
          const selections = { ...draft.selections }
          if (operation.selection === undefined && operation.cursor === undefined) delete selections[input.participantId]
          else selections[input.participantId] = operation.selection ?? { start: operation.cursor ?? 0, end: operation.cursor ?? 0 }
          const next = { ...draft, selections }
          state.drafts[operation.draftId] = next
          emit(input.participantId, 'draft.selection.changed', { draftId: operation.draftId, participantId: input.participantId, selection: selections[input.participantId] }, undefined, true)
          result = success(input.requestId, next)
        }
      } else if (operation.kind === 'draft.clear') {
        const draft = state.drafts[operation.draftId]
        if (draft === undefined) result = failure(input.requestId, 'draft-not-found', '共享草稿不存在。')
        else if (operation.baseRevision !== draft.revision) result = failure(input.requestId, 'draft-conflict', '共享草稿版本已变化。', draft)
        else {
          const next = { ...draft, text: '', attachments: [], revision: draft.revision + 1 }
          state.drafts[operation.draftId] = next
          emit(input.participantId, 'draft.cleared', next, input.requestId)
          result = success(input.requestId, next)
        }
      } else if (operation.kind === 'canvas.set-viewport') {
        if (!validViewport(operation.viewport)) result = failure(input.requestId, 'invalid-operation', '共享画布尺寸无效。')
        else if (operation.leaseId !== undefined && leaseFor(input.participantId, 'viewport', operation.leaseId) === undefined) result = failure(input.requestId, 'control-lease-required', '调整画布需要有效控制租约。')
        else {
          state.sharedCanvas = { ...state.sharedCanvas, viewport: { ...operation.viewport } }
          emit(input.participantId, 'canvas.viewport.changed', operation.viewport, input.requestId, true)
          result = success(input.requestId, operation.viewport)
        }
      } else if (operation.kind === 'canvas.set-focus') {
        if (state.sharedCanvas.fixedByOwner && !isOwner(state, input.participantId)) result = failure(input.requestId, 'focus-locked', '共享焦点已由房主固定。')
        else {
          state.sharedCanvas = { ...state.sharedCanvas, focus: { ...operation.focus } }
          emit(input.participantId, 'canvas.focus.changed', operation.focus, input.requestId, true)
          result = success(input.requestId, operation.focus)
        }
      } else if (operation.kind === 'canvas.set-focus-lock') {
        if (!isOwner(state, input.participantId)) result = failure(input.requestId, 'permission-denied', '只有房主可以固定共享焦点。')
        else {
          state.sharedCanvas = { ...state.sharedCanvas, fixedByOwner: operation.locked }
          emit(input.participantId, 'canvas.focus-lock.changed', { locked: operation.locked }, input.requestId, true)
          result = success(input.requestId, state.sharedCanvas)
        }
      } else if (operation.kind === 'canvas.set-layout') {
        if (operation.leaseId !== undefined && leaseFor(input.participantId, 'layout', operation.leaseId) === undefined) result = failure(input.requestId, 'control-lease-required', '调整布局需要有效控制租约。')
        else {
          if (options.persistLayout !== undefined) await options.persistLayout({
            collaborationId,
            workbenchId,
            participantId: input.participantId,
            layout: operation.layout,
          })
          state.sharedCanvas = { ...state.sharedCanvas, layout: structuredClone(operation.layout) }
          emit(input.participantId, 'canvas.layout.changed', operation.layout, input.requestId, true)
          result = success(input.requestId, operation.layout)
        }
      } else if (operation.kind === 'canvas.set-floating-panels') {
        if (operation.leaseId !== undefined && leaseFor(input.participantId, 'floating-panels', operation.leaseId) === undefined) result = failure(input.requestId, 'control-lease-required', '调整浮动面板需要有效控制租约。')
        else {
          state.sharedCanvas = { ...state.sharedCanvas, floatingPanels: structuredClone(operation.floatingPanels) }
          emit(input.participantId, 'canvas.floating-panels.changed', operation.floatingPanels, input.requestId, true)
          result = success(input.requestId, operation.floatingPanels)
        }
      } else if (operation.kind === 'layout.acquire-lease') {
        result = success(input.requestId, thisAcquire(input.participantId, operation.targetId))
      } else if (operation.kind === 'layout.release-lease') {
        result = success(input.requestId, { released: releaseControlLease(input.participantId, operation.targetId, operation.leaseId) })
      } else {
        if (input.baseRevision !== state.workbenchRevision) { result = failure(input.requestId, 'revision-conflict', '工作台状态已变化，请重新读取后重试。', stateSnapshot(state)); rememberResult(input.requestId, result); return result }
        if (options.executeCommand === undefined) result = failure(input.requestId, 'command-failed', 'Host 尚未安装工作台命令执行器。')
        else {
          const value = await options.executeCommand({ collaborationId, workbenchId, participantId: input.participantId, operation: operation as never })
          emit(input.participantId, 'workbench.command.committed', { operation: operation.kind, value }, input.requestId)
          if (options.loadSeed !== undefined) {
            const refreshed = await options.loadSeed(workbenchId)
            state.seed = { ...refreshed, sharedCanvas: state.sharedCanvas, drafts: state.drafts }
            emit(input.participantId, 'workbench.snapshot.changed', stateSnapshot(state), input.requestId)
          }
          result = success(input.requestId, value)
        }
      }
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error && typeof (error as { code?: unknown }).code === 'string'
        ? (error as { code: string }).code
        : undefined
      result = code === 'revision-conflict'
        ? failure(input.requestId, 'revision-conflict', error instanceof Error ? error.message : '工作台已经发生变化，请重新同步后重试。', stateSnapshot(state))
        : code === 'invalid-operation'
          ? failure(input.requestId, 'invalid-operation', error instanceof Error ? error.message : 'invalid collaboration operation', stateSnapshot(state))
          : code === 'capability-denied' || code === 'workbench-scope-denied' || code === 'access-expired'
            ? failure(input.requestId, 'permission-denied', error instanceof Error ? error.message : 'collaboration permission denied')
            : failure(input.requestId, 'command-failed', error instanceof Error ? error.message : 'collaboration command failed')
    }
    rememberResult(input.requestId, result)
    return result
  }

  const thisAcquire = (participantId: string, targetId: string) => {
    return acquireControlLease(participantId, targetId)
  }

  const acquireControlLease = (participantId: string, targetId: string) => {
    pruneLeases()
    const key = `${participantId}:${targetId}`
    for (const lease of leases.values()) if (lease.targetId === targetId && lease.participantId !== participantId) return { ok: false as const, error: 'control-lease-held' }
    const lease = { leaseId: randomId(), participantId, targetId, expiresAt: now() + CONTROL_LEASE_MS }
    leases.set(key, lease)
    emit(participantId, 'layout.lease.changed', { targetId, participantId, leaseId: lease.leaseId, expiresAt: lease.expiresAt }, undefined, true)
    return { ok: true as const, leaseId: lease.leaseId, expiresAt: lease.expiresAt }
  }

  const releaseControlLease = (participantId: string, targetId: string, leaseId: string): boolean => {
    const lease = leaseFor(participantId, targetId, leaseId)
    if (lease === undefined) return false
    leases.delete(`${participantId}:${targetId}`)
    emit(participantId, 'layout.lease.changed', { targetId, participantId, leaseId: undefined }, undefined, true)
    return true
  }

  const sanitizePresence = (presence: ParticipantPresenceV1): ParticipantPresenceV1 | undefined => {
    const registered = state.participants[presence.participantId]
    if (registered === undefined) return undefined
    const areaId = typeof presence.areaId === 'string' && presence.areaId.length <= 160
      && (state.seed.areas ?? []).some(value => value && typeof value === 'object' && (value as { areaId?: unknown }).areaId === presence.areaId)
      ? presence.areaId : undefined
    const editorId = typeof presence.editorId === 'string' && presence.editorId.length <= 320
      && (state.seed.editors ?? []).some(value => value && typeof value === 'object'
        && (value as { areaId?: unknown; editorId?: unknown }).areaId === areaId
        && (value as { editorId?: unknown }).editorId === presence.editorId)
      ? presence.editorId : undefined
    const sessionId = typeof presence.sessionId === 'string' && presence.sessionId.length <= 320
      && (state.seed.sessions ?? []).some(value => value && typeof value === 'object' && (value as { sessionId?: unknown }).sessionId === presence.sessionId)
      ? presence.sessionId : undefined
    const candidateDraft = typeof presence.draftId === 'string' ? state.drafts[presence.draftId] : undefined
    const draftId = candidateDraft !== undefined && candidateDraft.areaId === areaId && candidateDraft.editorId === editorId
      && candidateDraft.sessionId === sessionId ? candidateDraft.draftId : undefined
    const intent: ParticipantPresenceV1['intent'] = ['viewing', 'editing', 'dragging', 'sending', 'running', 'waiting', 'recovering'].includes(presence.intent) ? presence.intent : 'viewing'
    const selection = candidateDraft !== undefined && draftId !== undefined && presence.selection && Number.isSafeInteger(presence.selection.start) && Number.isSafeInteger(presence.selection.end)
      && presence.selection.start >= 0 && presence.selection.end >= presence.selection.start && presence.selection.end <= candidateDraft.text.length
      ? { start: presence.selection.start, end: presence.selection.end } : undefined
    const rawCursor = presence.cursor
    const cursor = candidateDraft !== undefined && draftId !== undefined && typeof rawCursor === 'number' && Number.isSafeInteger(rawCursor) && rawCursor >= 0 && rawCursor <= candidateDraft.text.length ? rawCursor : undefined
    const lastCommand = presence.lastCommand && typeof presence.lastCommand.requestId === 'string' && typeof presence.lastCommand.kind === 'string'
      ? { requestId: presence.lastCommand.requestId.slice(0, 180), kind: presence.lastCommand.kind.slice(0, 160), status: ['pending', 'committed', 'rejected'].includes(presence.lastCommand.status) ? presence.lastCommand.status : 'pending' as const }
      : registered.lastCommand
    return {
      participantId: registered.participantId,
      displayName: registered.displayName,
      role: registered.role,
      ...(areaId === undefined ? {} : { areaId }),
      ...(editorId === undefined ? {} : { editorId }),
      ...(sessionId === undefined ? {} : { sessionId }),
      intent,
      ...(draftId === undefined ? {} : { draftId }),
      ...(cursor === undefined ? {} : { cursor }),
      ...(selection === undefined ? {} : { selection }),
      ...(lastCommand === undefined ? {} : { lastCommand }),
      connectionState: presence.connectionState === 'reconnecting' ? 'reconnecting' : presence.connectionState === 'stale' ? 'stale' : 'connected',
      updatedAt: now(),
    }
  }

  return {
    snapshot: () => { pruneStaleParticipants(); return stateSnapshot(state) },
    refresh(seed) {
      state.sharedCanvas = {
        ...state.sharedCanvas,
        ...(seed.sharedCanvas?.layout === undefined ? {} : { layout: structuredClone(seed.sharedCanvas.layout) }),
      }
      state.seed = {
        ...structuredClone(seed),
        sharedCanvas: state.sharedCanvas,
        drafts: state.drafts,
      }
      const owner = state.participants[state.ownerParticipantId]
      if (owner !== undefined) {
        const location = activeSeedLocation(seed)
        state.participants[state.ownerParticipantId] = { ...owner, ...location, intent: 'viewing', connectionState: 'connected', updatedAt: now() }
        emit(state.ownerParticipantId, 'presence.changed', state.participants[state.ownerParticipantId], undefined, true)
      }
      emit(state.ownerParticipantId, 'workbench.snapshot.changed', stateSnapshot(state))
    },
    publishTaskSnapshot(tasks) {
      state.seed = { ...state.seed, tasks: structuredClone(tasks) }
      emit('host', 'task.changed', { tasks: state.seed.tasks })
    },
    connect(input) {
      pruneStaleParticipants()
      if (input.collaborationId !== collaborationId || input.workbenchId !== workbenchId) return { error: 'collaboration-not-found' }
      const connectedCount = Object.values(state.participants).filter(participant => participant.connectionState === 'connected').length
      if (state.participants[input.participantId] === undefined && connectedCount >= maxParticipants) return { error: 'participant-limit-reached' }
      state.participants[input.participantId] = {
        participantId: input.participantId,
        displayName: input.displayName,
        role: input.role,
        intent: 'viewing',
        connectionState: 'connected',
        updatedAt: now(),
      }
      emit(input.participantId, 'participant.joined', state.participants[input.participantId], undefined, true)
      return stateSnapshot(state)
    },
    disconnect(participantId) {
      if (state.participants[participantId] === undefined) return
      markParticipantStale(participantId)
      emit(participantId, 'participant.left', { participantId }, undefined, true)
    },
    command,
    publishPresence(presence) {
      pruneStaleParticipants()
      const cleaned = sanitizePresence(presence)
      if (cleaned === undefined) return
      state.participants[cleaned.participantId] = Object.freeze(cleaned)
      emit(cleaned.participantId, 'presence.changed', state.participants[cleaned.participantId], undefined, true)
    },
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener) } },
    eventsSince(eventId) {
      if (eventId === undefined) return undefined
      const index = eventLog.findIndex(event => event.eventId === eventId)
      if (index < 0) return undefined
      return eventLog.slice(index + 1).map(event => structuredClone(event))
    },
    acquireControlLease,
    releaseControlLease,
  }
}

export interface WorkbenchCollaborationManagerV1 {
  get(workbenchId: string): WorkbenchCollaborationSessionViewV1 | undefined
  getById(collaborationId: string): WorkbenchCollaborationSessionViewV1 | undefined
  start(workbenchId: string, ownerParticipantId: string, seed?: WorkbenchCollaborationSeedV1): Promise<{ readonly collaborationId: string; readonly session: WorkbenchCollaborationSessionViewV1 }>
  refresh(workbenchId: string): Promise<void>
  stop(workbenchId: string): Promise<void>
  dispose(): Promise<void>
}

/**
 * File backed activity log for one Host process. It stores only the redacted
 * collaboration snapshot, never the raw access lease or an absolute path.
 * A missing or malformed log is treated as an expired session and ignored.
 */
export function createFileWorkbenchCollaborationStore(
  rootForWorkbench: (workbenchId: string) => string | undefined,
  now: () => number = Date.now,
): WorkbenchCollaborationStoreV1 {
  const workbenchByCollaboration = new Map<string, string>()
  let writeTail: Promise<unknown> = Promise.resolve()
  const fileFor = (workbenchId: string): string | undefined => {
    const root = rootForWorkbench(workbenchId)
    return root === undefined ? undefined : path.join(root, '.bay', 'collaboration', 'active-v1.json')
  }
  const read = async (file: string): Promise<{ savedAt: number; snapshot: WorkbenchCollaborationSnapshotV1 } | undefined> => {
    try {
      const value = JSON.parse(await readFile(file, 'utf8')) as { savedAt?: unknown; snapshot?: unknown }
      if (typeof value.savedAt !== 'number' || !value.snapshot || typeof value.snapshot !== 'object') return undefined
      if (now() - value.savedAt > 24 * 60 * 60_000) return undefined
      return value as { savedAt: number; snapshot: WorkbenchCollaborationSnapshotV1 }
    } catch { return undefined }
  }
  return {
    async load(collaborationId) {
      const workbenchId = workbenchByCollaboration.get(collaborationId)
      if (workbenchId === undefined) return undefined
      const file = fileFor(workbenchId)
      if (file === undefined) return undefined
      const value = await read(file)
      return value?.snapshot.collaborationId === collaborationId ? value.snapshot : undefined
    },
    async loadActive(workbenchId) {
      const file = fileFor(workbenchId)
      if (file === undefined) return undefined
      const value = await read(file)
      if (value !== undefined) workbenchByCollaboration.set(value.snapshot.collaborationId, workbenchId)
      return value?.snapshot
    },
    save(snapshot) {
      workbenchByCollaboration.set(snapshot.collaborationId, snapshot.workbenchId)
      const job = writeTail.then(async () => {
        const file = fileFor(snapshot.workbenchId)
        if (file === undefined) return
        await mkdir(path.dirname(file), { recursive: true })
        const temporary = `${file}.${randomUUID()}.tmp`
        await writeFile(temporary, JSON.stringify({ savedAt: now(), snapshot }) + '\n', 'utf8')
        await rename(temporary, file)
      })
      writeTail = job.catch(() => {})
      return job
    },
    async remove(collaborationId) {
      const workbenchId = workbenchByCollaboration.get(collaborationId)
      if (workbenchId === undefined) return
      const file = fileFor(workbenchId)
      workbenchByCollaboration.delete(collaborationId)
      await writeTail
      if (file !== undefined) await rm(file, { force: true }).catch(() => {})
    },
  }
}

export function createWorkbenchCollaborationManager(options: WorkbenchCollaborationManagerOptionsV1 = {}): WorkbenchCollaborationManagerV1 {
  const sessions = new Map<string, { readonly workbenchId: string; readonly session: WorkbenchCollaborationSessionViewV1 }>()
  const byId = new Map<string, WorkbenchCollaborationSessionViewV1>()
  const taskSubscriptions = new Map<string, () => void>()
  const store = options.store ?? createMemoryWorkbenchCollaborationStore()
  return {
    get(workbenchId) { return sessions.get(workbenchId)?.session },
    getById(collaborationId) { return byId.get(collaborationId) },
    async start(workbenchId, ownerParticipantId, inputSeed = {}) {
      const existing = sessions.get(workbenchId)
      if (existing !== undefined) return { collaborationId: existing.session.snapshot().collaborationId, session: existing.session }
      const collaborationId = `collab-${(options.randomId ?? randomUUID)()}`
      const stored = store.loadActive === undefined ? await store.load(collaborationId) : await store.loadActive(workbenchId)
      const durable = options.loadSeed === undefined ? inputSeed : await options.loadSeed(workbenchId)
      const seed = stored === undefined ? durable : {
        ...durable,
        sharedCanvas: stored.sharedCanvas,
        drafts: stored.drafts,
      }
      const session = createWorkbenchCollaborationSession(stored?.collaborationId ?? collaborationId, workbenchId, ownerParticipantId, seed, { ...options, ...(stored === undefined ? {} : { initialSnapshot: stored }) })
      session.connect({
        collaborationId: session.snapshot().collaborationId,
        workbenchId,
        participantId: ownerParticipantId,
        displayName: '房主',
        role: 'owner',
      })
      const actualCollaborationId = session.snapshot().collaborationId
      sessions.set(workbenchId, { workbenchId, session }); byId.set(actualCollaborationId, session)
      const unsubscribeTasks = options.subscribeTaskChanges?.(workbenchId, tasks => session.publishTaskSnapshot(tasks))
      if (unsubscribeTasks !== undefined) taskSubscriptions.set(workbenchId, unsubscribeTasks)
      return { collaborationId: actualCollaborationId, session }
    },
    async refresh(workbenchId) {
      const row = sessions.get(workbenchId)
      if (row === undefined || options.loadSeed === undefined) return
      row.session.refresh(await options.loadSeed(workbenchId))
    },
    async stop(workbenchId) {
      const existing = sessions.get(workbenchId)
      if (existing === undefined) return
      taskSubscriptions.get(workbenchId)?.()
      taskSubscriptions.delete(workbenchId)
      sessions.delete(workbenchId); byId.delete(existing.session.snapshot().collaborationId)
      await store.remove(existing.session.snapshot().collaborationId)
    },
    async dispose() {
      for (const workbenchId of [...sessions.keys()]) await this.stop(workbenchId)
      sessions.clear(); byId.clear()
    },
  }
}
