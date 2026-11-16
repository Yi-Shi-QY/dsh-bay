export type WorkbenchSurfaceStateV1 = 'official' | 'opening' | 'active' | 'closing'
export type WorkbenchSurfaceIntentV1 = 'new-conversation' | 'resume-workbench'
export interface WorkbenchSurfaceSnapshotV1 { state: WorkbenchSurfaceStateV1; intent: WorkbenchSurfaceIntentV1 | undefined }
export interface WorkbenchSurfaceControllerV1 { getSnapshot(): WorkbenchSurfaceSnapshotV1; subscribe(listener: () => void): () => void; open(intent?: WorkbenchSurfaceIntentV1): void; close(): void }
export function createWorkbenchSurfaceController(): WorkbenchSurfaceControllerV1 {
  let snapshot: WorkbenchSurfaceSnapshotV1 = { state: 'official', intent: undefined }
  const listeners = new Set<() => void>()
  const publish = (next: WorkbenchSurfaceSnapshotV1): void => { if (snapshot.state === next.state && snapshot.intent === next.intent) return; snapshot = next; for (const listener of [...listeners]) listener() }
  return {
    getSnapshot: () => snapshot,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener) } },
    open(intent = 'new-conversation') { if (snapshot.state === 'active' || snapshot.state === 'opening') return; publish({ state: 'opening', intent }); queueMicrotask(() => { if (snapshot.state === 'opening' && snapshot.intent === intent) publish({ state: 'active', intent }) }) },
    close() { if (snapshot.state === 'official' || snapshot.state === 'closing') return; publish({ state: 'closing', intent: snapshot.intent }); queueMicrotask(() => { if (snapshot.state === 'closing') publish({ state: 'official', intent: undefined }) }) },
  }
}
