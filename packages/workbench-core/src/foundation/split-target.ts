/**
 * Pointer-to-drop-target geometry for Area splitting.
 *
 * The naming in this module is deliberately user-facing: columns means a
 * left/right result and rows means a top/bottom result.  It avoids the
 * horizontal/vertical axis ambiguity that exists in the persisted layout
 * model (where the axis describes the CSS track direction).
 */

export type SplitTargetEdge = 'left' | 'right' | 'top' | 'bottom'
/** User-facing result orientation: columns are left/right, rows are top/bottom. */
export type SplitTargetOrientation = 'columns' | 'rows'

/** Pixel dimensions of the Area receiving the pointer gesture. */
export interface SplitTargetRect {
  width: number
  height: number
}

/** Pointer coordinates relative to the target Area. */
export interface SplitTargetPoint {
  /** Coordinates relative to the target rectangle. */
  x: number
  y: number
}

/** Minimum geometry and neutral-band policy for split targeting. */
export interface SplitTargetOptions {
  minimumWidth: number
  minimumHeight: number
  dividerSize?: number
  /** Width of the neutral center band, as a fraction of the target. */
  centerBand?: number
}

/** Resolved split edge, neutral center, or geometry rejection. */
export type SplitTarget =
  | {
    kind: 'edge'
    edge: SplitTargetEdge
    orientation: SplitTargetOrientation
    /** Fraction occupied by the inserted Area, clamped to [0.2, 0.8]. */
    ratio: number
  }
  | { kind: 'center' }
  | {
    kind: 'invalid'
    reason: 'too-narrow'
  }

const DEFAULT_DIVIDER_SIZE = 6
const DEFAULT_CENTER_BAND = 0.2
const MIN_RATIO = 0.2
const MAX_RATIO = 0.8

function clampUnit(value: number): number {
  if (!Number.isFinite(value)) return 0.5
  return Math.max(0, Math.min(1, value))
}

function clampRatio(value: number): number {
  return Number(Math.max(MIN_RATIO, Math.min(MAX_RATIO, value)).toFixed(4))
}

/**
 * Convert a pointer's normalized split-line position into the fraction owned
 * by the inserted Area.  Persisted split commands describe the inserted
 * Area's size, while pointer coordinates describe the divider's position
 * from the rectangle's left/top edge.  Right and bottom insertions therefore
 * need the complementary fraction.
 * @param edge - side on which the new Area will be inserted.
 * @param pointerPosition - normalized divider position from the left or top.
 * @returns clamped fraction owned by the inserted Area.
 */
export function insertedRatioAtPointer(
  edge: SplitTargetEdge,
  pointerPosition: number,
): number {
  const position = clampUnit(pointerPosition)
  return clampRatio(edge === 'right' || edge === 'bottom' ? 1 - position : position)
}

function orientationFor(edge: SplitTargetEdge): SplitTargetOrientation {
  return edge === 'left' || edge === 'right' ? 'columns' : 'rows'
}

/**
 * Resolve a pointer into Blender-style diagonal dock targets.
 *
 * The center is intentionally neutral.  For a target that is large enough in
 * both dimensions, two diagonal boundaries divide the remaining space into
 * four edge targets.  When one dimension cannot fit two Areas, only the other
 * axis remains selectable, matching Blender's narrow-area behavior.
 * @param rect - target Area dimensions.
 * @param point - pointer position relative to that Area.
 * @param options - minimum Area size and divider geometry.
 * @returns edge placement, neutral center, or invalid geometry.
 */
export function resolveSplitTarget(
  rect: SplitTargetRect,
  point: SplitTargetPoint,
  options: SplitTargetOptions,
): SplitTarget {
  const width = rect.width
  const height = rect.height
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return { kind: 'invalid', reason: 'too-narrow' }
  }

  const x = clampUnit(point.x / width)
  const yTop = clampUnit(point.y / height)
  // Blender's screen coordinates grow upwards.  Browser client coordinates
  // grow downwards, so invert Y before applying the same diagonal geometry.
  const y = 1 - yTop
  const centerBand = Math.max(0.04, Math.min(0.8, options.centerBand ?? DEFAULT_CENTER_BAND))
  const centerMin = 0.5 - centerBand / 2
  const centerMax = 0.5 + centerBand / 2
  if (x > centerMin && x < centerMax && y > centerMin && y < centerMax) {
    return { kind: 'center' }
  }

  const dividerSize = options.dividerSize ?? DEFAULT_DIVIDER_SIZE
  const canColumns = width >= options.minimumWidth * 2 + dividerSize
  const canRows = height >= options.minimumHeight * 2 + dividerSize
  if (!canColumns && !canRows) return { kind: 'invalid', reason: 'too-narrow' }

  let edge: SplitTargetEdge
  if (!canColumns) {
    edge = yTop < 0.5 ? 'top' : 'bottom'
  }
  else if (!canRows) {
    edge = x < 0.5 ? 'left' : 'right'
  }
  else {
    const aspect = width / height
    // These are Blender's two diagonal tests, expressed in normalized
    // coordinates.  The +1e-6 keeps points on a corner deterministic.
    const upperLeft = x / (y + 1e-6) < aspect
    const lowerLeft = x / (1 - y + 1e-6) < aspect
    if (upperLeft && !lowerLeft) edge = 'top'
    else if (!upperLeft && lowerLeft) edge = 'bottom'
    else if (upperLeft && lowerLeft) edge = 'left'
    else edge = 'right'
  }

  const pointerPosition = edge === 'left' || edge === 'right' ? x : yTop
  return {
    kind: 'edge', edge, orientation: orientationFor(edge),
    ratio: insertedRatioAtPointer(edge, pointerPosition),
  }
}
