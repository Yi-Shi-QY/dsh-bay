/** Structural facts for the one currently rendered Workbench. */
export interface WorkbenchRuntimeViewV1 {
  readonly workbenchId: string
  readonly account: string
  readonly openWorkbenches: number
  readonly areas: number
  readonly tabs: number
  readonly visibleAreas: number
  readonly collapsedAreas: number
}

type SaveOutcome = 'committed' | 'conflict' | 'unavailable'
export interface WorkbenchRuntimeMetricsSnapshotV1 {
  readonly view: WorkbenchRuntimeViewV1 | undefined
  /** Mounted Core slot outlets, including collapsed outlets kept by policy.
   * This does not count DSH's nested components or their subscriptions. */
  readonly mountedEditorOutlets: number
  /** Plugin-lifetime counters across all Workbenches; never attributed to the current view. */
  readonly layoutSaves: {
    readonly attempted: number
    readonly inFlight: number
    readonly committed: number
    readonly conflicted: number
    readonly failed: number
    readonly lastDurationMs: number | undefined
    readonly lastStatus: SaveOutcome | 'error' | undefined
  }
}

/** Internal diagnostic collector. No polling, persistent storage, or render notifications. */
export interface WorkbenchRuntimeMetricsSinkV1 {
  reportView(view: WorkbenchRuntimeViewV1): void
  clearView(): void
  mountEditorOutlet(): () => void
  measureLayoutSave<T extends { status: SaveOutcome }>(write: () => Promise<T>): Promise<T>
  getSnapshot(): WorkbenchRuntimeMetricsSnapshotV1
}

export function createWorkbenchRuntimeMetrics(
  now: () => number = () => performance.now(),
): WorkbenchRuntimeMetricsSinkV1 {
  let view: WorkbenchRuntimeViewV1 | undefined
  const outlets = new Set<symbol>()
  const saves = {
    attempted: 0, inFlight: 0, committed: 0, conflicted: 0, failed: 0,
    lastDurationMs: undefined as number | undefined,
    lastStatus: undefined as SaveOutcome | 'error' | undefined,
  }
  return {
    reportView: next => { view = { ...next } },
    clearView: () => { view = undefined },
    mountEditorOutlet() {
      const token = Symbol()
      outlets.add(token)
      return () => { outlets.delete(token) }
    },
    async measureLayoutSave(write) {
      const started = now()
      saves.attempted += 1
      saves.inFlight += 1
      try {
        const result = await write()
        saves.lastStatus = result.status
        if (result.status === 'committed') saves.committed += 1
        else if (result.status === 'conflict') saves.conflicted += 1
        else saves.failed += 1
        return result
      } catch (error) {
        saves.lastStatus = 'error'
        saves.failed += 1
        throw error
      } finally {
        saves.inFlight -= 1
        saves.lastDurationMs = Math.max(0, now() - started)
      }
    },
    getSnapshot: () => ({
      view: view === undefined ? undefined : { ...view },
      mountedEditorOutlets: outlets.size,
      layoutSaves: { ...saves },
    }),
  }
}
