import {
  applyDraftOperations,
  transformDraftOperations,
  type DraftOperationV1,
} from '../workbench-collaboration-contract.ts'

/**
 * Client side of the Host-centred shared draft protocol.
 *
 * The adapter tracks three things for one draft:
 *
 * - the last text and revision the Host confirmed;
 * - at most one operation that was sent and is not acknowledged yet;
 * - the text the local editor currently shows.
 *
 * Local edits that were not sent yet are never stored as operations. They are
 * always the difference between "confirmed text + in-flight operation" and the
 * local text, so they cannot drift from what the editor renders.
 *
 * The Host treats a late operation as the left side of the transform, so its
 * insert wins a same-position tie against operations committed before it. The
 * adapter uses the same orientation for everything the Host has not committed
 * yet, which keeps every client and the Host on the same text.
 *
 * This module is pure. It has no transport, timer or DOM dependency.
 */

export interface DraftCommittedChangeV1 {
  readonly revision: number
  readonly text: string
  readonly operations: readonly DraftOperationV1[]
}

export interface DraftOutgoingOperationV1 {
  readonly baseRevision: number
  readonly operations: readonly DraftOperationV1[]
}

export interface WorkbenchDraftOtAdapterV1 {
  /** Text the local editor should show. */
  localText(): string
  confirmedText(): string
  confirmedRevision(): number
  /** True while a sent operation is waiting for the Host. */
  hasInFlight(): boolean
  /** True when the local text differs from what the Host will have after the in-flight operation. */
  hasUnsent(): boolean
  /** Record what the local editor shows now. */
  setLocalText(text: string): void
  /**
   * Take the next operation to send. Returns undefined while another
   * operation is in flight or when there is nothing to send. The returned
   * operation becomes the in-flight operation.
   */
  takeOutgoing(): DraftOutgoingOperationV1 | undefined
  /**
   * Apply a `draft.changed` event from the Host. `own` says whether this
   * participant was the actor. Returns the text the local editor should show.
   */
  applyCommitted(change: DraftCommittedChangeV1, own: boolean): string
  /**
   * The Host refused the in-flight operation. Local unsent edits cannot be
   * placed on the Host text any more, so the Host text wins.
   */
  rejectInFlight(): string
  /**
   * The in-flight operation never reached the Host. Its content becomes
   * unsent local text again and is sent with the next operation.
   */
  abandonInFlight(): void
  /**
   * Adopt a Host draft that did not arrive as a contiguous event, for example
   * after a reconnect or a `draft.cleared` event. Unsent local edits are kept
   * when no operation was in flight.
   */
  resync(text: string, revision: number): string
}

/** Smallest single-range replacement that turns `before` into `after`. */
export function draftTextDelta(before: string, after: string): readonly DraftOperationV1[] {
  if (before === after) return []
  let prefix = 0
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix += 1
  let suffix = 0
  while (suffix < before.length - prefix && suffix < after.length - prefix
    && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) suffix += 1
  const operations: DraftOperationV1[] = []
  if (prefix > 0) operations.push({ type: 'retain', count: prefix })
  const deleted = before.length - prefix - suffix
  if (deleted > 0) operations.push({ type: 'delete', count: deleted })
  const inserted = after.slice(prefix, after.length - suffix)
  if (inserted.length > 0) operations.push({ type: 'insert', text: inserted })
  if (suffix > 0) operations.push({ type: 'retain', count: suffix })
  return operations
}

export function createWorkbenchDraftOtAdapter(initial: { readonly text: string; readonly revision: number }): WorkbenchDraftOtAdapterV1 {
  let confirmedText = initial.text
  let confirmedRevision = initial.revision
  let inFlight: readonly DraftOperationV1[] | undefined
  let local = initial.text

  const afterInFlight = (): string => inFlight === undefined ? confirmedText : applyDraftOperations(confirmedText, inFlight)
  const unsent = (): readonly DraftOperationV1[] => draftTextDelta(afterInFlight(), local)

  const adopt = (text: string, revision: number): string => {
    confirmedText = text
    confirmedRevision = revision
    inFlight = undefined
    local = text
    return local
  }

  const resync = (text: string, revision: number): string => {
    if (revision < confirmedRevision) return local
    // Only the revision moved, for example after an attachment change. The
    // in-flight operation is still valid: the Host rebases late operations.
    if (text === confirmedText) { confirmedRevision = revision; return local }
    if (inFlight !== undefined) {
      // The Host already holds exactly the in-flight result, so the event that
      // would have acknowledged it was missed. Unsent typing stays intact.
      if (afterInFlight() === text) {
        confirmedText = text
        confirmedRevision = revision
        inFlight = undefined
        return local
      }
      // Otherwise the fate of the in-flight operation is unknown. Replaying it
      // is the transport's job and the Host answers by request id, so its
      // effect comes back as an ordinary committed event.
      return adopt(text, revision)
    }
    try {
      const mine = draftTextDelta(confirmedText, local)
      const theirs = draftTextDelta(confirmedText, text)
      const [, theirsAfterMine] = transformDraftOperations(mine, theirs)
      local = applyDraftOperations(local, theirsAfterMine)
      confirmedText = text
      confirmedRevision = revision
      return local
    } catch { return adopt(text, revision) }
  }

  return {
    localText: () => local,
    confirmedText: () => confirmedText,
    confirmedRevision: () => confirmedRevision,
    hasInFlight: () => inFlight !== undefined,
    hasUnsent: () => unsent().length > 0,
    setLocalText(text) { local = text },
    takeOutgoing() {
      if (inFlight !== undefined) return undefined
      const operations = unsent()
      if (operations.length === 0) return undefined
      inFlight = operations
      return { baseRevision: confirmedRevision, operations }
    },
    applyCommitted(change, own) {
      if (change.revision <= confirmedRevision) return local
      if (change.revision !== confirmedRevision + 1) return resync(change.text, change.revision)
      try {
        // An own event acknowledges the in-flight operation only when it
        // produces exactly the text this client predicted. Anything else came
        // from another surface of the same participant and is a remote edit.
        if (own && inFlight !== undefined && applyDraftOperations(confirmedText, inFlight) === change.text) {
          confirmedText = change.text
          confirmedRevision = change.revision
          inFlight = undefined
          return local
        }
        const pendingLocal = unsent()
        let remote = change.operations
        let nextInFlight = inFlight
        if (inFlight !== undefined) [nextInFlight, remote] = transformDraftOperations(inFlight, remote)
        const [, remoteForLocal] = transformDraftOperations(pendingLocal, remote)
        const nextLocal = applyDraftOperations(local, remoteForLocal)
        if (applyDraftOperations(confirmedText, change.operations) !== change.text) return adopt(change.text, change.revision)
        local = nextLocal
        confirmedText = change.text
        confirmedRevision = change.revision
        inFlight = nextInFlight
        return local
      } catch { return adopt(change.text, change.revision) }
    },
    rejectInFlight() {
      inFlight = undefined
      local = confirmedText
      return local
    },
    abandonInFlight() { inFlight = undefined },
    resync,
  }
}
