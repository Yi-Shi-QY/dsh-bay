import type { WorkbenchCollaborationClientV1 } from './workbench-collaboration-client.ts'
import { createWorkbenchDraftOtAdapter, type WorkbenchDraftOtAdapterV1 } from './workbench-draft-ot.ts'
import type { DraftOperationV1, SharedDraftStateV1, WorkbenchCollaborationEventV1, WorkbenchCollaborationSnapshotV1 } from '../workbench-collaboration-contract.ts'

/**
 * Connects one local composer to one Host shared draft.
 *
 * The binding owns no text of its own. The editor is read and written through
 * the supplied callbacks, the Host state arrives through the collaboration
 * client, and the OT adapter reconciles the two. Nothing is submitted while
 * the client is not connected, and nothing is written into the editor while
 * an input method composition is open.
 */
export interface WorkbenchSharedDraftBindingOptionsV1 {
  readonly client: Pick<WorkbenchCollaborationClientV1, 'participantId' | 'command' | 'subscribe' | 'getSnapshot' | 'getState'>
  readonly draftId: string
  readonly getEditorText: () => string
  readonly setEditorText: (text: string) => void
  readonly isComposing?: () => boolean
  readonly newRequestId?: () => string
  readonly defer?: (callback: () => void) => void
}

export interface WorkbenchSharedDraftBindingV1 {
  /** Call after the local editor text changed. */
  editorChanged(): void
  /** Call when an input method composition finished. */
  compositionEnded(): void
  dispose(): void
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function createWorkbenchSharedDraftBinding(options: WorkbenchSharedDraftBindingOptionsV1): WorkbenchSharedDraftBindingV1 {
  const { client, draftId } = options
  const isComposing = options.isComposing ?? (() => false)
  const newRequestId = options.newRequestId ?? (() => globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`)
  const defer = options.defer ?? (callback => { setTimeout(callback, 0) })
  let adapter: WorkbenchDraftOtAdapterV1 | undefined
  let disposed = false
  /** Host notifications that arrived while a composition was open. */
  let deferred: (() => void)[] = []

  /**
   * Editor text that was replaced by a write the editor has not published
   * yet. While the editor still reports it, it is not a local edit.
   */
  let staleEditorText: string | undefined

  const showLocal = (): void => {
    if (adapter === undefined) return
    const text = adapter.localText()
    const before = options.getEditorText()
    if (before === text) { staleEditorText = undefined; return }
    options.setEditorText(text)
    // An editor may publish a programmatic write later than it accepts it.
    staleEditorText = options.getEditorText() === before ? before : undefined
  }

  const readEditor = (): void => {
    if (adapter === undefined) return
    const text = options.getEditorText()
    if (staleEditorText !== undefined) {
      if (text === staleEditorText) return
      staleEditorText = undefined
    }
    if (text !== adapter.localText()) adapter.setLocalText(text)
  }

  const flush = (): void => {
    if (disposed || adapter === undefined || client.getState() !== 'connected') return
    const current = adapter
    const outgoing = current.takeOutgoing()
    if (outgoing === undefined) return
    client.command({
      kind: 'draft.apply',
      operation: { draftId, baseRevision: outgoing.baseRevision, requestId: newRequestId(), participantId: client.participantId, operations: outgoing.operations },
    }).then(result => {
      if (disposed || adapter !== current) return
      if (!result.ok) current.rejectInFlight()
      else if (current.hasInFlight()) {
        // The acknowledging event normally arrives first. If it did not, the
        // command result carries the committed draft.
        const value = result.value
        if (isRecord(value) && typeof value.text === 'string' && typeof value.revision === 'number') current.resync(value.text, value.revision)
      }
      if (!isComposing()) showLocal()
      flush()
    }, () => {
      // The command never reached the Host, or the collaboration is over.
      if (adapter === current) current.abandonInFlight()
    })
  }

  const start = (draft: SharedDraftStateV1): void => {
    const editorText = options.getEditorText()
    adapter = createWorkbenchDraftOtAdapter({ text: draft.text, revision: draft.revision })
    // A local draft typed before the shared draft existed becomes its first
    // content. When both sides already have text the Host draft is the fact.
    if (draft.text.length === 0 && editorText.length > 0) adapter.setLocalText(editorText)
    else showLocal()
  }

  const receive = (snapshot: WorkbenchCollaborationSnapshotV1 | undefined, event?: WorkbenchCollaborationEventV1): void => {
    if (disposed) return
    const draft = snapshot?.drafts[draftId]
    if (draft === undefined) return
    if (adapter === undefined) {
      if (isComposing()) return
      start(draft)
      flush()
      return
    }
    const current = adapter
    const payload = (event?.kind === 'draft.changed' || event?.kind === 'draft.cleared') && isRecord(event.payload) && event.payload.draftId === draftId ? event.payload : undefined
    const apply = payload !== undefined && typeof payload.revision === 'number' && typeof payload.text === 'string' && Array.isArray(payload.operations)
      ? () => { current.applyCommitted({ revision: payload.revision as number, text: payload.text as string, operations: payload.operations as readonly DraftOperationV1[] }, event?.actorId === client.participantId) }
      : () => { current.resync(draft.text, draft.revision) }
    if (isComposing()) { deferred.push(apply); return }
    readEditor()
    apply()
    showLocal()
    flush()
  }

  const drain = (): void => {
    if (disposed || adapter === undefined || isComposing()) return
    readEditor()
    const pending = deferred
    deferred = []
    for (const apply of pending) apply()
    showLocal()
    flush()
  }

  const unsubscribe = client.subscribe(receive)
  receive(client.getSnapshot())

  return {
    editorChanged() {
      if (disposed || isComposing()) return
      if (adapter === undefined) { receive(client.getSnapshot()); return }
      if (deferred.length > 0) { drain(); return }
      readEditor()
      flush()
    },
    compositionEnded() {
      // The editor commits the composed text in its own handler, which can
      // run after this one. Read the editor one task later.
      defer(() => {
        if (disposed) return
        if (adapter === undefined) receive(client.getSnapshot())
        else drain()
      })
    },
    dispose() {
      disposed = true
      deferred = []
      unsubscribe()
    },
  }
}
