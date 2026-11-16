/**
 * Shared Workbench collaboration contracts.
 *
 * The Host is the authority for the durable Workbench document and for the
 * live canvas.  Clients only submit commands and render snapshots/events.
 * This module intentionally contains no transport or DSH runtime imports so
 * the same protocol types and pure draft operations can be used by Host and
 * browser builds.
 */

export type WorkbenchCollaborationIntentV1 =
  | 'viewing'
  | 'editing'
  | 'dragging'
  | 'sending'
  | 'running'
  | 'waiting'
  | 'recovering'

export interface SharedCanvasViewportV1 {
  readonly width: number
  readonly height: number
  readonly scaleMode: 'contain' | 'cover' | 'fixed'
}

export interface SharedCanvasFocusV1 {
  readonly areaId: string
  readonly editorId: string
  readonly sessionId?: string
}

export interface SharedCanvasStateV1 {
  readonly viewport: SharedCanvasViewportV1
  /** Workbench layout document owned by the Host. */
  readonly layout: unknown
  readonly focus?: SharedCanvasFocusV1
  readonly floatingPanels: readonly unknown[]
  readonly fixedByOwner: boolean
}

export interface SharedDraftSelectionV1 {
  readonly start: number
  readonly end: number
}

export interface SharedDraftStateV1 {
  readonly draftId: string
  readonly areaId: string
  readonly editorId: string
  readonly sessionId?: string
  readonly text: string
  readonly revision: number
  readonly attachments: readonly unknown[]
  readonly selections: Readonly<Record<string, SharedDraftSelectionV1>>
}

export interface ParticipantPresenceV1 {
  readonly participantId: string
  readonly displayName: string
  readonly role: 'owner' | 'participant'
  readonly areaId?: string
  readonly editorId?: string
  readonly sessionId?: string
  readonly intent: WorkbenchCollaborationIntentV1
  readonly draftId?: string
  readonly cursor?: number
  readonly selection?: SharedDraftSelectionV1
  readonly lastCommand?: {
    readonly requestId: string
    readonly kind: string
    readonly status: 'pending' | 'committed' | 'rejected'
  }
  readonly connectionState: 'connected' | 'reconnecting' | 'stale'
  readonly updatedAt: number
}

export type DraftOperationV1 =
  | { readonly type: 'retain'; readonly count: number }
  | { readonly type: 'insert'; readonly text: string }
  | { readonly type: 'delete'; readonly count: number }

export interface DraftOperationEnvelopeV1 {
  readonly draftId: string
  readonly baseRevision: number
  readonly requestId: string
  readonly participantId: string
  readonly operations: readonly DraftOperationV1[]
}

export type WorkbenchCommandV1 =
  | { readonly kind: 'canvas.set-viewport'; readonly viewport: SharedCanvasViewportV1; readonly leaseId?: string }
  | { readonly kind: 'canvas.set-focus'; readonly focus: SharedCanvasFocusV1 }
  | { readonly kind: 'canvas.set-focus-lock'; readonly locked: boolean }
  | { readonly kind: 'canvas.set-layout'; readonly layout: unknown; readonly leaseId?: string }
  | { readonly kind: 'canvas.set-floating-panels'; readonly floatingPanels: readonly unknown[]; readonly leaseId?: string }
  | { readonly kind: 'layout.acquire-lease'; readonly targetId: string }
  | { readonly kind: 'layout.release-lease'; readonly targetId: string; readonly leaseId: string }
  | { readonly kind: 'draft.ensure'; readonly draftId: string; readonly areaId: string; readonly editorId: string; readonly sessionId?: string }
  | { readonly kind: 'draft.apply'; readonly operation: DraftOperationEnvelopeV1 }
  | { readonly kind: 'draft.set-attachments'; readonly draftId: string; readonly attachments: readonly unknown[]; readonly baseRevision: number }
  | { readonly kind: 'draft.set-selection'; readonly draftId: string; readonly selection?: SharedDraftSelectionV1; readonly cursor?: number; readonly baseRevision: number }
  | { readonly kind: 'draft.clear'; readonly draftId: string; readonly baseRevision: number }
  | { readonly kind: 'workbench.command'; readonly operation: string; readonly target?: unknown; readonly payload?: unknown; readonly expectedRevision?: number }

export interface WorkbenchCommandEnvelopeV1 {
  readonly requestId: string
  readonly collaborationId: string
  readonly workbenchId: string
  readonly participantId: string
  readonly baseRevision: number
  readonly operation: WorkbenchCommandV1
}

export type WorkbenchCommandResultV1 =
  | {
      readonly ok: true
      readonly requestId: string
      readonly workbenchRevision: number
      readonly canvasRevision: number
      readonly value?: unknown
    }
  | {
      readonly ok: false
      readonly requestId: string
      readonly code: 'collaboration-not-found' | 'workbench-mismatch' | 'revision-conflict' | 'permission-denied' | 'control-lease-required' | 'focus-locked' | 'draft-not-found' | 'draft-conflict' | 'file-conflict' | 'invalid-operation' | 'command-failed'
      readonly message: string
      readonly workbenchRevision: number
      readonly canvasRevision: number
      readonly current?: unknown
    }

export interface WorkbenchCollaborationEventV1 {
  readonly eventId: string
  readonly collaborationId: string
  readonly workbenchId: string
  readonly workbenchRevision: number
  readonly canvasRevision: number
  readonly actorId: string
  readonly requestId?: string
  readonly kind: string
  readonly payload: unknown
}

export interface WorkbenchCollaborationSnapshotV1 {
  readonly schemaVersion: 1
  readonly collaborationId: string
  readonly workbenchId: string
  readonly ownerParticipantId: string
  readonly workbenchRevision: number
  readonly canvasRevision: number
  readonly definition: unknown
  readonly areas: readonly unknown[]
  readonly editors: readonly unknown[]
  readonly sessions: readonly unknown[]
  readonly projects: readonly unknown[]
  readonly tasks: readonly unknown[]
  readonly memories: readonly unknown[]
  readonly contexts: readonly unknown[]
  readonly sharedCanvas: SharedCanvasStateV1
  readonly drafts: Readonly<Record<string, SharedDraftStateV1>>
  readonly participants: readonly ParticipantPresenceV1[]
  readonly redactions: readonly string[]
  readonly unavailableCapabilities: readonly string[]
}

export interface WorkbenchCollaborationSessionV1 {
  readonly collaborationId: string
  readonly workbenchId: string
  readonly ownerParticipantId: string
  readonly workbenchRevision: number
  readonly canvasRevision: number
  readonly sharedCanvas: SharedCanvasStateV1
  readonly drafts: Readonly<Record<string, SharedDraftStateV1>>
  readonly participants: Readonly<Record<string, ParticipantPresenceV1>>
}

export interface WorkbenchCollaborationConnectV1 {
  readonly collaborationId: string
  readonly workbenchId: string
  readonly participantId: string
  readonly displayName: string
  readonly role: 'owner' | 'participant'
  readonly lastEventId?: string
  readonly lastWorkbenchRevision?: number
  readonly lastCanvasRevision?: number
}

export interface WorkbenchCollaborationStoreV1 {
  load(collaborationId: string): Promise<WorkbenchCollaborationSnapshotV1 | undefined> | WorkbenchCollaborationSnapshotV1 | undefined
  /** Return the most recent non-expired session for a Workbench, if any. */
  loadActive?(workbenchId: string): Promise<WorkbenchCollaborationSnapshotV1 | undefined> | WorkbenchCollaborationSnapshotV1 | undefined
  save(snapshot: WorkbenchCollaborationSnapshotV1): Promise<void> | void
  remove(collaborationId: string): Promise<void> | void
}

export interface WorkbenchCollaborationSeedV1 {
  readonly definition?: unknown
  readonly areas?: readonly unknown[]
  readonly editors?: readonly unknown[]
  readonly sessions?: readonly unknown[]
  readonly projects?: readonly unknown[]
  readonly tasks?: readonly unknown[]
  readonly memories?: readonly unknown[]
  readonly contexts?: readonly unknown[]
  readonly sharedCanvas?: Partial<SharedCanvasStateV1>
  readonly drafts?: Readonly<Record<string, SharedDraftStateV1>>
}

export function createInitialSharedCanvasV1(seed: Partial<SharedCanvasStateV1> = {}): SharedCanvasStateV1 {
  const viewport = seed.viewport ?? { width: 1280, height: 800, scaleMode: 'contain' as const }
  return Object.freeze({
    viewport: Object.freeze({ ...viewport }),
    layout: seed.layout,
    ...(seed.focus === undefined ? {} : { focus: Object.freeze({ ...seed.focus }) }),
    floatingPanels: Object.freeze([...(seed.floatingPanels ?? [])]),
    fixedByOwner: seed.fixedByOwner === true,
  })
}

function assertCount(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('invalid-draft-operation-count')
}

export function normalizeDraftOperations(operations: readonly DraftOperationV1[]): readonly DraftOperationV1[] {
  const result: DraftOperationV1[] = []
  for (const operation of operations) {
    if (operation.type === 'insert') {
      if (operation.text.length === 0) continue
      const previous = result.at(-1)
      if (previous?.type === 'insert') result[result.length - 1] = { type: 'insert', text: previous.text + operation.text }
      else result.push({ type: 'insert', text: operation.text })
      continue
    }
    assertCount(operation.count)
    if (operation.count === 0) continue
    const previous = result.at(-1)
    if (previous?.type === operation.type) result[result.length - 1] = { type: operation.type, count: previous.count + operation.count }
    else result.push(operation)
  }
  return Object.freeze(result)
}

export function applyDraftOperations(text: string, operations: readonly DraftOperationV1[]): string {
  let cursor = 0
  let output = ''
  for (const operation of normalizeDraftOperations(operations)) {
    if (operation.type === 'retain') {
      if (cursor + operation.count > text.length) throw new Error('draft-retain-out-of-range')
      output += text.slice(cursor, cursor + operation.count)
      cursor += operation.count
    } else if (operation.type === 'delete') {
      if (cursor + operation.count > text.length) throw new Error('draft-delete-out-of-range')
      cursor += operation.count
    } else output += operation.text
  }
  output += text.slice(cursor)
  return output
}

export function transformDraftPosition(position: number, operations: readonly DraftOperationV1[], bias: 'left' | 'right' = 'right'): number {
  assertCount(position)
  let sourceOffset = 0
  let targetOffset = 0
  for (const operation of normalizeDraftOperations(operations)) {
    if (operation.type === 'retain') {
      const end = sourceOffset + operation.count
      if (position < end || (position === end && bias === 'left')) return targetOffset + position - sourceOffset
      sourceOffset = end
      targetOffset += operation.count
    } else if (operation.type === 'insert') {
      if (position === sourceOffset && bias === 'left') return targetOffset
      targetOffset += operation.text.length
    } else {
      const end = sourceOffset + operation.count
      if (position <= end) return targetOffset
      sourceOffset = end
    }
  }
  return targetOffset + Math.max(0, position - sourceOffset)
}

function takeOperation(operations: DraftOperationV1[], type: DraftOperationV1['type'], count: number): void {
  const current = operations[0]
  if (current === undefined || current.type !== type) return
  if (current.type === 'insert') return
  if (current.count === count) operations.shift()
  else operations[0] = current.type === 'retain'
    ? { type: 'retain', count: current.count - count }
    : { type: 'delete', count: current.count - count }
}

/**
 * Transform two concurrent text deltas. The first returned delta is safe to
 * apply after `right`; the second is safe to apply after `left`. Concurrent
 * inserts use the left operation as the deterministic tie breaker.
 */
export function transformDraftOperations(
  leftInput: readonly DraftOperationV1[],
  rightInput: readonly DraftOperationV1[],
): readonly [readonly DraftOperationV1[], readonly DraftOperationV1[]] {
  const left = [...normalizeDraftOperations(leftInput)]
  const right = [...normalizeDraftOperations(rightInput)]
  const leftOut: DraftOperationV1[] = []
  const rightOut: DraftOperationV1[] = []
  while (left.length > 0 || right.length > 0) {
    const a = left[0]
    const b = right[0]
    if (a?.type === 'insert') {
      leftOut.push(a)
      rightOut.push({ type: 'retain', count: a.text.length })
      left.shift()
      continue
    }
    if (b?.type === 'insert') {
      leftOut.push({ type: 'retain', count: b.text.length })
      rightOut.push(b)
      right.shift()
      continue
    }
    if (a === undefined && b !== undefined) {
      rightOut.push(b)
      right.shift()
      continue
    }
    if (b === undefined && a !== undefined) {
      leftOut.push(a)
      left.shift()
      continue
    }
    if (a === undefined || b === undefined) continue
    const aCount = a.count
    const bCount = b.count
    const count = Math.min(aCount, bCount)
    if (a.type === 'retain' && b.type === 'retain') {
      leftOut.push({ type: 'retain', count })
      rightOut.push({ type: 'retain', count })
    } else if (a.type === 'delete' && b.type === 'delete') {
      // Both remove the same source range; neither transformed operation has
      // to remove it a second time.
    } else if (a.type === 'delete' && b.type === 'retain') leftOut.push({ type: 'delete', count })
    else if (a.type === 'retain' && b.type === 'delete') rightOut.push({ type: 'delete', count })
    takeOperation(left, a.type, count)
    takeOperation(right, b.type, count)
  }
  return [normalizeDraftOperations(leftOut), normalizeDraftOperations(rightOut)]
}

export function createMemoryWorkbenchCollaborationStore(): WorkbenchCollaborationStoreV1 {
  const records = new Map<string, WorkbenchCollaborationSnapshotV1>()
  return {
    load: collaborationId => records.get(collaborationId),
    loadActive: workbenchId => [...records.values()].find(value => value.workbenchId === workbenchId),
    save(snapshot) { records.set(snapshot.collaborationId, structuredClone(snapshot)) },
    remove(collaborationId) { records.delete(collaborationId) },
  }
}
