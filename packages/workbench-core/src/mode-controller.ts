export type WorkbenchModeV1 = 'official' | 'entering' | 'workbench' | 'exiting'
export interface WorkbenchModeSnapshotV1 { mode: WorkbenchModeV1; workbenchId?: string; focusedAreaId?: string }
export interface WorkbenchModeControllerOptionsV1 {
  resolveWorkbench?: (options: { workbenchId?: string; intent: 'resume-recent' | 'new-workbench' }) => Promise<string | undefined>
  flush?: () => Promise<boolean>
}
export interface WorkbenchModeControllerV1 {
  getSnapshot(): WorkbenchModeSnapshotV1
  subscribe(listener: () => void): () => void
  enter(options?: { workbenchId?: string; intent?: 'resume-recent' | 'new-workbench' }): Promise<void>
  exit(beforeExit?: () => void): Promise<void>
  focusArea(areaId: string): void
}
export function createWorkbenchModeController(options: WorkbenchModeControllerOptionsV1 = {}): WorkbenchModeControllerV1 {
  let snapshot: WorkbenchModeSnapshotV1 = { mode: 'official' }
  let transition: Promise<void> | undefined
  const listeners = new Set<() => void>()
  const publish = (next: WorkbenchModeSnapshotV1): void => { if (snapshot.mode === next.mode && snapshot.workbenchId === next.workbenchId && snapshot.focusedAreaId === next.focusedAreaId) return; snapshot = next; for (const listener of [...listeners]) listener() }
  const enter = async (request: { workbenchId?: string; intent?: 'resume-recent' | 'new-workbench' } = {}): Promise<void> => {
    if (snapshot.mode === 'workbench') return
    if (transition !== undefined) return transition
    transition = (async () => { publish({ mode: 'entering' }); try { const workbenchId = await options.resolveWorkbench?.({ intent: request.intent ?? 'resume-recent', ...(request.workbenchId === undefined ? {} : { workbenchId: request.workbenchId }) }); publish({ mode: 'workbench', ...(workbenchId === undefined ? {} : { workbenchId }) }) } catch (error) { publish({ mode: 'official' }); throw error } finally { transition = undefined } })()
    return transition
  }
  const exit = async (beforeExit?: () => void): Promise<void> => {
    if (snapshot.mode === 'official') return
    if (transition !== undefined) return transition
    transition = (async () => { const previous = snapshot; publish({ mode: 'exiting', ...(previous.workbenchId === undefined ? {} : { workbenchId: previous.workbenchId }), ...(previous.focusedAreaId === undefined ? {} : { focusedAreaId: previous.focusedAreaId }) }); try { const flushed = await options.flush?.() ?? true; if (!flushed) throw new Error('Workbench 布局尚未保存，无法退出工作台模式'); beforeExit?.(); publish({ mode: 'official' }) } catch (error) { publish(previous); throw error } finally { transition = undefined } })()
    return transition
  }
  return { getSnapshot: () => snapshot, subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener) } }, enter, exit, focusArea(areaId) { if (snapshot.mode === 'workbench' && snapshot.focusedAreaId !== areaId) publish({ ...snapshot, focusedAreaId: areaId }) } }
}
