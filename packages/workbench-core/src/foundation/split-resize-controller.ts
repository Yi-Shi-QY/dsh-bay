export type SplitResizeAxisV1 = 'horizontal' | 'vertical'

export interface SplitResizeGeometryV1 {
  left: number
  top: number
  width: number
  height: number
}

export interface SplitResizeControllerPortV1 {
  readGeometry: () => SplitResizeGeometryV1 | undefined
  getTracks: (ratio: number) => string
  resolveRatio: (input: SplitResizeRatioRequestV1) => number | undefined
  writeTracks: (tracks: string) => void
  restoreTracks: (tracks: string) => void
  writeAriaValue: (value: number) => void
  setActive: (active: boolean) => void
  commit: (splitId: string, ratio: number) => boolean | void
  requestFrame: (callback: () => void) => number
  cancelFrame: (frameId: number) => void
}

export interface SplitResizeRatioRequestV1 {
  axis: SplitResizeAxisV1
  pointer: number
  startPointer: number
  persistedRatio: number
  geometry: SplitResizeGeometryV1
}

export interface SplitResizeRatioInputV1 extends SplitResizeRatioRequestV1 {
  dividerSize: number
  firstMinimum: number
  secondMinimum: number
}

export interface SplitResizeBeginV1 {
  splitId: string
  axis: SplitResizeAxisV1
  persistedRatio: number
  pointerId: number
  pointer: number
  geometry: SplitResizeGeometryV1
}

interface SplitResizeSessionStateV1 extends SplitResizeBeginV1 {
  latestRatio: number
  latestPointer: number
  anchorRatio: number
  anchorPointer: number
  moved: boolean
  geometryDirty: boolean
  invalid: boolean
  frameId: number | undefined
}

function normalizeRatio(value: number): number {
  if (!Number.isFinite(value)) return 0.5
  return Math.min(1, Math.max(0, value))
}

function extentOf(axis: SplitResizeAxisV1, geometry: SplitResizeGeometryV1): number {
  return axis === 'horizontal' ? geometry.width : geometry.height
}

/**
 * Resolve a pointer delta to the flex factor consumed by the CSS Grid tracks.
 * `minmax(minimum, factor fr)` first reserves both minimum bases, then divides
 * the remaining free space by the flex factors. Keep pointer math in that same
 * coordinate system so the transient preview and committed grid agree.
 */
export function splitResizeRatioForPointerV1(input: SplitResizeRatioInputV1): number | undefined {
  const extent = extentOf(input.axis, input.geometry)
  const available = extent - input.dividerSize
  if (!Number.isFinite(available) || available <= 0) return undefined

  const firstMinimum = Math.max(0, Number.isFinite(input.firstMinimum) ? input.firstMinimum : 0)
  const secondMinimum = Math.max(0, Number.isFinite(input.secondMinimum) ? input.secondMinimum : 0)
  const flexible = available - firstMinimum - secondMinimum
  // If projected rails consume the entire split, there is no flexible space
  // for a divider drag. The renderer may overflow its minimums, but must not
  // invent a ratio preview that CSS Grid cannot display.
  if (!Number.isFinite(flexible) || flexible <= 0) return undefined
  const minRatio = 0
  const maxRatio = 1
  const lower = firstMinimum + flexible * minRatio
  const upper = firstMinimum + flexible * maxRatio

  const startFirst = firstMinimum + normalizeRatio(input.persistedRatio) * flexible
  const requestedFirst = startFirst + input.pointer - input.startPointer
  const nextFirst = Math.min(upper, Math.max(lower, requestedFirst))
  // When a minimum or ratio bound prevents visible movement, retain the
  // persisted ratio. Otherwise merely touching the divider could rewrite a
  // hidden, constrained ratio even though the tracks did not move.
  if (Math.abs(nextFirst - startFirst) < 0.01) return normalizeRatio(input.persistedRatio)
  return normalizeRatio((nextFirst - firstMinimum) / flexible)
}

/**
 * Runtime-only divider controller. Pointer events update a small mutable
 * session and schedule one frame; React and persistent layout state are only
 * touched by the single commit emitted from finish(true).
 */
export class SplitResizeControllerV1 {
  private session: SplitResizeSessionStateV1 | undefined
  private readonly port: SplitResizeControllerPortV1

  constructor(port: SplitResizeControllerPortV1) {
    this.port = port
  }

  begin(input: SplitResizeBeginV1): boolean {
    this.finish(false)
    const extent = extentOf(input.axis, input.geometry)
    if (!Number.isFinite(extent) || extent <= 0) return false
    const persistedRatio = normalizeRatio(input.persistedRatio)
    this.session = {
      ...input,
      persistedRatio,
      latestRatio: persistedRatio,
      latestPointer: input.pointer,
      anchorRatio: persistedRatio,
      anchorPointer: input.pointer,
      moved: false,
      geometryDirty: false,
      invalid: false,
      frameId: undefined,
    }
    this.port.setActive(true)
    this.port.writeAriaValue(Math.round(persistedRatio * 100))
    return true
  }

  ownsPointer(pointerId: number): boolean {
    return this.session?.pointerId === pointerId
  }

  move(pointerId: number, pointer: number): void {
    const session = this.session
    if (session === undefined || session.pointerId !== pointerId) return
    session.latestPointer = pointer
    session.moved ||= pointer !== session.pointer
    this.schedule(session)
  }

  invalidateGeometry(): void {
    const session = this.session
    if (session === undefined) return
    session.geometryDirty = true
    // A window resize can move the currently rendered divider while the
    // pointer stays still. Re-anchor at the latest visible ratio so subsequent
    // pointer movement continues from that position instead of jumping.
    session.anchorRatio = session.latestRatio
    session.anchorPointer = session.latestPointer
    this.schedule(session)
  }

  finish(shouldCommit: boolean): void {
    const session = this.session
    if (session === undefined) return
    if (session.frameId !== undefined) this.port.cancelFrame(session.frameId)
    session.frameId = undefined
    if (shouldCommit && session.moved) this.flush(session)

    let accepted = false
    if (shouldCommit && session.moved && !session.invalid
      && session.latestRatio !== session.persistedRatio) {
      accepted = this.port.commit(session.splitId, session.latestRatio) !== false
    }
    const ratio = accepted ? session.latestRatio : session.persistedRatio
    this.port.restoreTracks(this.port.getTracks(ratio))
    this.port.setActive(false)
    this.port.writeAriaValue(Math.round(ratio * 100))
    this.session = undefined
  }

  private schedule(session: SplitResizeSessionStateV1): void {
    if (session.frameId !== undefined) return
    session.frameId = this.port.requestFrame(() => {
      if (this.session !== session) return
      this.flush(session)
    })
  }

  private flush(session: SplitResizeSessionStateV1): void {
    if (session.geometryDirty) {
      const geometry = this.port.readGeometry()
      if (geometry !== undefined && extentOf(session.axis, geometry) > 0) session.geometry = geometry
      session.geometryDirty = false
    }
    const extent = extentOf(session.axis, session.geometry)
    if (!Number.isFinite(extent) || extent <= 0) {
      session.invalid = true
      session.frameId = undefined
      return
    }
    const request: SplitResizeRatioRequestV1 = {
      axis: session.axis,
      pointer: session.latestPointer,
      startPointer: session.anchorPointer,
      persistedRatio: session.anchorRatio,
      geometry: session.geometry,
    }
    const ratio = this.port.resolveRatio(request)
    if (ratio === undefined || !Number.isFinite(ratio)) {
      session.invalid = true
      session.latestRatio = session.persistedRatio
      session.frameId = undefined
      return
    }
    session.latestRatio = ratio
    this.port.writeTracks(this.port.getTracks(ratio))
    this.port.writeAriaValue(Math.round(ratio * 100))
    session.frameId = undefined
  }
}
