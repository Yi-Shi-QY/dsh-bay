export interface SplitResizeMetricRunV1 {
  splitId: string
  pointerMoves: number
  appliedFrames: number
  geometryReads: number
  cssVariableWrites: number
  reactCommits: number
  reactCommitDurationMs: number
  areaContentMounts: number
  areaContentUnmounts: number
  /** Time between consecutive RAF timestamps, approximating rendered frame cadence. */
  frameDurationsMs: number[]
  /** JavaScript time spent applying this frame's transient divider update. */
  frameWorkDurationsMs: number[]
  frameP50Ms: number
  frameP95Ms: number
  frameP99Ms: number
  frameWorkP50Ms: number
  frameWorkP95Ms: number
  frameWorkP99Ms: number
  finishedAt?: number
  committed?: boolean
}

export interface SplitResizeMetricsSnapshotV1 {
  enabled: boolean
  /** All live Workbench observers, retained for compatibility with early probes. */
  activeResizeObservers: number
  /** Area geometry observers are deliberately disabled for this performance line. */
  activeAreaMeasurementObservers: number
  /** Observers that keep tab overflow affordances in sync with the Area header. */
  activeTabStripObservers: number
  /** Observers used only to keep open floating menus and info cards positioned. */
  activeOverlayPlacementObservers: number
  current?: SplitResizeMetricRunV1
}

export type WorkbenchResizeObserverKindV1 = 'area-measurement' | 'tab-strip' | 'overlay-placement'

interface SplitResizeMetricsApiV1 {
  reset(): void
  snapshot(): SplitResizeMetricsSnapshotV1
}

interface SplitResizeMetricsWindow extends Window {
  __WORKBENCH_RESIZE_PERF_ENABLED__?: boolean
  __WORKBENCH_RESIZE_PERF__?: SplitResizeMetricsApiV1
}

type MutableRun = SplitResizeMetricRunV1 & {
  frameDurationsMs: number[]
  frameWorkDurationsMs: number[]
}

let activeResizeObservers = 0
let activeAreaMeasurementObservers = 0
let activeTabStripObservers = 0
let activeOverlayPlacementObservers = 0
let currentRun: MutableRun | undefined
let totalAreaContentMounts = 0
let totalAreaContentUnmounts = 0
let mountBaseline = 0
let unmountBaseline = 0
let lastFrameTimestamp = 0

function quantile(values: readonly number[], quantileValue: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((left, right) => left - right)
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(quantileValue * sorted.length) - 1))
  return Number(sorted[index]!.toFixed(3))
}

function refreshQuantiles(run: MutableRun): void {
  run.frameP50Ms = quantile(run.frameDurationsMs, 0.5)
  run.frameP95Ms = quantile(run.frameDurationsMs, 0.95)
  run.frameP99Ms = quantile(run.frameDurationsMs, 0.99)
  run.frameWorkP50Ms = quantile(run.frameWorkDurationsMs, 0.5)
  run.frameWorkP95Ms = quantile(run.frameWorkDurationsMs, 0.95)
  run.frameWorkP99Ms = quantile(run.frameWorkDurationsMs, 0.99)
}

function enabledWindow(): SplitResizeMetricsWindow | undefined {
  if (typeof globalThis.window === 'undefined') return undefined
  const target = globalThis.window as SplitResizeMetricsWindow
  return target.__WORKBENCH_RESIZE_PERF_ENABLED__ === true ? target : undefined
}

function snapshot(): SplitResizeMetricsSnapshotV1 {
  const target = typeof globalThis.window === 'undefined'
    ? undefined
    : globalThis.window as SplitResizeMetricsWindow
  const run = currentRun
  if (run === undefined) return {
    enabled: target?.__WORKBENCH_RESIZE_PERF_ENABLED__ === true,
    activeResizeObservers,
    activeAreaMeasurementObservers,
    activeTabStripObservers,
    activeOverlayPlacementObservers,
  }
  const current = {
    ...run,
    frameDurationsMs: [...run.frameDurationsMs],
    frameWorkDurationsMs: [...run.frameWorkDurationsMs],
  }
  refreshQuantiles(current)
  return {
    enabled: target?.__WORKBENCH_RESIZE_PERF_ENABLED__ === true,
    activeResizeObservers,
    activeAreaMeasurementObservers,
    activeTabStripObservers,
    activeOverlayPlacementObservers,
    current,
  }
}

function ensureApi(target: SplitResizeMetricsWindow): void {
  if (target.__WORKBENCH_RESIZE_PERF__ !== undefined) return
  target.__WORKBENCH_RESIZE_PERF__ = {
    reset() {
      currentRun = undefined
      totalAreaContentMounts = 0
      totalAreaContentUnmounts = 0
      mountBaseline = 0
      unmountBaseline = 0
      lastFrameTimestamp = 0
    },
    snapshot,
  }
}

function updateRun(update: (run: MutableRun) => void): void {
  const target = enabledWindow()
  if (target === undefined || currentRun === undefined) return
  ensureApi(target)
  const finishedAt = currentRun.finishedAt
  if (finishedAt !== undefined && performance.now() - finishedAt > 150) return
  update(currentRun)
  currentRun.areaContentMounts = totalAreaContentMounts - mountBaseline
  currentRun.areaContentUnmounts = totalAreaContentUnmounts - unmountBaseline
}

export function beginSplitResizeMeasurement(splitId: string, initialGeometryReads = 0): void {
  const target = enabledWindow()
  if (target === undefined) return
  ensureApi(target)
  mountBaseline = totalAreaContentMounts
  unmountBaseline = totalAreaContentUnmounts
  currentRun = {
    splitId,
    pointerMoves: 0,
    appliedFrames: 0,
    geometryReads: Math.max(0, Math.floor(initialGeometryReads)),
    cssVariableWrites: 0,
    reactCommits: 0,
    reactCommitDurationMs: 0,
    areaContentMounts: 0,
    areaContentUnmounts: 0,
    frameWorkDurationsMs: [],
    frameDurationsMs: [],
    frameP50Ms: 0,
    frameP95Ms: 0,
    frameP99Ms: 0,
    frameWorkP50Ms: 0,
    frameWorkP95Ms: 0,
    frameWorkP99Ms: 0,
  }
  lastFrameTimestamp = globalThis.performance?.now?.() ?? Date.now()
}

export function finishSplitResizeMeasurement(committed: boolean): void {
  updateRun((run) => {
    run.finishedAt = performance.now()
    run.committed = committed
  })
  if (currentRun !== undefined) refreshQuantiles(currentRun)
}

export function recordSplitResizePointerMove(): void {
  updateRun(run => { run.pointerMoves += 1 })
}

export function isWorkbenchResizeMetricsEnabled(): boolean {
  return enabledWindow() !== undefined
}

export function recordSplitResizeFrame(frameTimestamp: number, workDurationMs: number): void {
  updateRun((run) => {
    run.appliedFrames += 1
    run.frameDurationsMs.push(Math.max(0, frameTimestamp - lastFrameTimestamp))
    run.frameWorkDurationsMs.push(Math.max(0, workDurationMs))
    lastFrameTimestamp = frameTimestamp
  })
}

export function recordSplitResizeGeometryRead(): void {
  updateRun(run => { run.geometryReads += 1 })
}

export function recordSplitResizeCssWrite(): void {
  updateRun(run => { run.cssVariableWrites += 1 })
}

export function recordSplitResizeReactCommit(actualDurationMs: number): void {
  updateRun((run) => {
    run.reactCommits += 1
    run.reactCommitDurationMs += actualDurationMs
  })
}

export function recordAreaContentMount(mounted: boolean): void {
  if (mounted) totalAreaContentMounts += 1
  else totalAreaContentUnmounts += 1
  updateRun(() => {})
}

export function trackWorkbenchResizeObserver(kind: WorkbenchResizeObserverKindV1, delta: 1 | -1): void {
  activeResizeObservers = Math.max(0, activeResizeObservers + delta)
  if (kind === 'area-measurement') {
    activeAreaMeasurementObservers = Math.max(0, activeAreaMeasurementObservers + delta)
  } else if (kind === 'tab-strip') {
    activeTabStripObservers = Math.max(0, activeTabStripObservers + delta)
  } else {
    activeOverlayPlacementObservers = Math.max(0, activeOverlayPlacementObservers + delta)
  }
  updateRun(() => {})
}

export function createWorkbenchResizeObserver(
  kind: WorkbenchResizeObserverKindV1,
  callback: ResizeObserverCallback,
): { observer: ResizeObserver; disconnect: () => void } | undefined {
  if (typeof globalThis.ResizeObserver !== 'function') return undefined
  const observer = new globalThis.ResizeObserver(callback)
  trackWorkbenchResizeObserver(kind, 1)
  let connected = true
  return {
    observer,
    disconnect() {
      if (!connected) return
      connected = false
      observer.disconnect()
      trackWorkbenchResizeObserver(kind, -1)
    },
  }
}
