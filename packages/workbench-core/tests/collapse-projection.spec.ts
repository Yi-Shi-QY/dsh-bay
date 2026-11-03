import { describe, expect, it } from 'vitest'
import { group, type WorkbenchLayoutDocument } from '../src/foundation/model.ts'
import {
  COLLAPSED_AREA_HEIGHT,
  COLLAPSED_AREA_WIDTH,
  COLLAPSED_DIVIDER_SIZE,
  deriveCollapseProjection,
  EXPANDED_AREA_MIN_HEIGHT,
  EXPANDED_AREA_MIN_WIDTH,
  intentCollapses,
  compactFootprint,
  splitGridTracks,
  validCollapseState,
  type CollapseIntent,
} from '../src/foundation/collapse-projection.ts'

function twoAreaDocument(): WorkbenchLayoutDocument {
  return {
    version: 2,
    root: {
      kind: 'split',
      id: 'split-root',
      axis: 'horizontal',
      ratio: 0.5,
      first: group('area-a'),
      second: group('area-b'),
    },
    activeGroupId: 'area-a',
  }
}

describe('collapse projection', () => {
  it('keeps expanded minimums separate from compact rail dimensions', () => {
    expect({ width: EXPANDED_AREA_MIN_WIDTH, height: EXPANDED_AREA_MIN_HEIGHT }).toEqual({ width: 320, height: 240 })
    expect({ width: COLLAPSED_AREA_WIDTH, height: COLLAPSED_AREA_HEIGHT }).toEqual({ width: 40, height: 40 })
    expect(COLLAPSED_DIVIDER_SIZE).toBe(12)
    expect(compactFootprint(group('area-a'))).toEqual({ width: 40, height: 40 })
  })

  it('preserves the 15.1 static split-track algorithm at the ratio limits', () => {
    const document = twoAreaDocument()
    const split = document.root
    if (split.kind !== 'split') throw new Error('test fixture must contain a split root')

    expect(splitGridTracks({ ...split, ratio: 0 }, new Set()).tracks)
      .toBe('minmax(0px, 0fr) 12px minmax(0px, 1fr)')
    expect(splitGridTracks({ ...split, ratio: 1 }, new Set()).tracks)
      .toBe('minmax(0px, 1fr) 12px minmax(0px, 0fr)')

    const source = splitGridTracks({ ...split, ratio: 0.25 }, new Set()).tracks
    expect(source).not.toContain('min(')
    expect(source).not.toContain('calc(')
  })

  it('does not project automatic collapse intents', () => {
    const document = twoAreaDocument()
    const state = new Map<string, CollapseIntent>([
      ['area-a', { mode: 'auto-area', reason: 'area-too-small' }],
      ['split-root', { mode: 'auto-branch', reason: 'branch-too-small' }],
    ])

    expect(intentCollapses(state.get('area-a'))).toBe(false)
    expect(intentCollapses(state.get('split-root'))).toBe(false)
    expect(deriveCollapseProjection(document, state).collapsedAreaIds.size).toBe(0)
  })

  it('removes stale automatic runtime state while preserving manual choices', () => {
    const document = twoAreaDocument()
    const state = new Map<string, CollapseIntent>([
      ['area-a', { mode: 'auto-area', reason: 'area-too-small' }],
      ['split-root', { mode: 'auto-branch', reason: 'branch-too-small' }],
      ['area-b', { mode: 'manual-area' }],
    ])

    const cleaned = validCollapseState(document, state)
    expect(cleaned.has('area-a')).toBe(false)
    expect(cleaned.has('split-root')).toBe(false)
    expect(cleaned.get('area-b')).toEqual({ mode: 'manual-area' })
    expect([...deriveCollapseProjection(document, cleaned).collapsedAreaIds]).toEqual(['area-b'])
  })
})
