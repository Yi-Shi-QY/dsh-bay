// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import {
  beginSplitResizeMeasurement,
  finishSplitResizeMeasurement,
  recordAreaContentMount,
  recordSplitResizeCssWrite,
  recordSplitResizeFrame,
  recordSplitResizeGeometryRead,
  recordSplitResizePointerMove,
  recordSplitResizeReactCommit,
  trackWorkbenchResizeObserver,
} from '../src/foundation/split-resize-metrics.ts'

type MetricsWindow = Window & {
  __WORKBENCH_RESIZE_PERF_ENABLED__?: boolean
  __WORKBENCH_RESIZE_PERF__?: { reset(): void; snapshot(): { current?: Record<string, unknown>; activeResizeObservers: number; activeAreaMeasurementObservers: number; activeTabStripObservers: number; activeOverlayPlacementObservers: number } }
}

const target = window as MetricsWindow

afterEach(() => {
  target.__WORKBENCH_RESIZE_PERF_ENABLED__ = false
  target.__WORKBENCH_RESIZE_PERF__?.reset()
})

describe('split resize measurements', () => {
  it('records drag activity and frame timing only while explicitly enabled', () => {
    target.__WORKBENCH_RESIZE_PERF_ENABLED__ = true
    target.__WORKBENCH_RESIZE_PERF__?.reset()
    beginSplitResizeMeasurement('split-a', 1)
    recordSplitResizePointerMove()
    recordSplitResizeGeometryRead()
    recordSplitResizeCssWrite()
    recordSplitResizeFrame(performance.now() + 16, 2.5)
    recordSplitResizeReactCommit(3)
    recordAreaContentMount(true)
    recordAreaContentMount(false)
    finishSplitResizeMeasurement(true)

    expect(target.__WORKBENCH_RESIZE_PERF__?.snapshot().current).toMatchObject({
      splitId: 'split-a', pointerMoves: 1, appliedFrames: 1, geometryReads: 2,
      cssVariableWrites: 1, reactCommits: 1, reactCommitDurationMs: 3,
      areaContentMounts: 1, areaContentUnmounts: 1, committed: true,
    })
  })

  it('reports tab-strip and overlay observers separately from disabled Area measurement observers', () => {
    trackWorkbenchResizeObserver('tab-strip', 1)
    trackWorkbenchResizeObserver('overlay-placement', 1)
    expect(target.__WORKBENCH_RESIZE_PERF__?.snapshot()).toMatchObject({
      activeResizeObservers: 2,
      activeAreaMeasurementObservers: 0,
      activeTabStripObservers: 1,
      activeOverlayPlacementObservers: 1,
    })
    trackWorkbenchResizeObserver('tab-strip', -1)
    trackWorkbenchResizeObserver('overlay-placement', -1)
  })
})
