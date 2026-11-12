import { decodeFloatingHandoff, type FloatingHandoffV1 } from '../floating-handoff.ts'
import type { FloatingWorkspaceRuntime } from './floating-workspace-runtime.ts'
import type { WorkbenchCollaborationClientV1 } from './workbench-collaboration-client.ts'

/**
 * Keep one Workbench's floating workspace in the Host collaboration session.
 *
 * Shared: the floating pages, their order, the selected page and whether the
 * workspace is expanded. Not shared: window position and size, which belong
 * to each screen. The shared value is the same handoff document the desktop
 * already gives a browser owner, so the runtime validates every identity
 * before it adopts a page from another surface.
 *
 * `pinnedIds` describe which Area tabs this page retains and differ between
 * surfaces, so they are left out of the shared value; a page moved into an
 * Area reaches the others through the shared layout.
 *
 * When a surface joins, its own pages win if it is the owner or the Host has
 * no floating state yet. Otherwise it adopts the Host state, so a refreshed
 * page recovers the floating workspace instead of clearing it for everyone.
 */
export function connectSharedFloatingWorkspace(runtime: FloatingWorkspaceRuntime, client: WorkbenchCollaborationClientV1): () => void {
  let collaborationId: string | undefined
  let initialized = false
  /** The floating state this page knows the Host has: last applied or published. */
  let known: string | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let disposed = false

  const normalize = (value: unknown): FloatingHandoffV1 | undefined => {
    const decoded = decodeFloatingHandoff(value)
    return decoded === undefined ? undefined : { ...decoded, pinnedIds: [] }
  }
  const local = (workbenchId: string): FloatingHandoffV1 | undefined => {
    // A page in the middle of an operation cannot be captured; the runtime
    // publishes again when the operation ends.
    try { return normalize(runtime.snapshotHandoff(workbenchId)) } catch { return undefined }
  }
  const publish = (value: FloatingHandoffV1, signature: string): void => {
    known = signature
    void client.command({ kind: 'canvas.set-floating-panels', floatingPanels: [value] }).then(result => {
      if (!result.ok && known === signature) { known = undefined; schedule() }
    }, () => { if (known === signature) known = undefined })
  }
  const apply = (workbenchId: string, value: FloatingHandoffV1, signature: string): void => {
    try { runtime.restoreHandoff(workbenchId, value); known = signature }
    catch { /* busy or a conflicting identity: keep local pages, retry on the next change */ }
  }
  const sync = (): void => {
    timer = undefined
    if (disposed || client.getState() !== 'connected') return
    const snapshot = client.getSnapshot()
    if (snapshot === undefined) return
    if (snapshot.collaborationId !== collaborationId) { collaborationId = snapshot.collaborationId; initialized = false; known = undefined }
    const workbenchId = snapshot.workbenchId
    const mine = local(workbenchId)
    if (mine === undefined) return
    const mineSignature = JSON.stringify(mine)
    const remote = normalize(snapshot.sharedCanvas.floatingPanels?.[0])
    const remoteSignature = remote === undefined ? undefined : JSON.stringify(remote)
    if (!initialized) {
      initialized = true
      const owner = client.participantId === snapshot.ownerParticipantId
      if (mine.tabs.length > 0 && (owner || remote === undefined)) publish(mine, mineSignature)
      else if (remote !== undefined) apply(workbenchId, remote, remoteSignature!)
      else known = mineSignature
      return
    }
    if (remote !== undefined && remoteSignature !== known) { apply(workbenchId, remote, remoteSignature!); return }
    if (mineSignature !== known) publish(mine, mineSignature)
  }
  // Window drags publish on every pointer move; coalesce them.
  const schedule = (): void => { if (!disposed && timer === undefined) timer = setTimeout(sync, 60) }
  const offRuntime = runtime.subscribe(schedule)
  const offClient = client.subscribe(schedule)
  schedule()
  return () => {
    disposed = true
    if (timer !== undefined) clearTimeout(timer)
    offRuntime(); offClient()
  }
}
