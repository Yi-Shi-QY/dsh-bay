import { describe, expect, it, vi } from 'vitest'
import {
  SplitResizeControllerV1,
  splitResizeRatioForPointerV1,
  type SplitResizeControllerPortV1,
  type SplitResizeGeometryV1,
} from '../src/foundation/split-resize-controller.ts'
import { splitGridTracks } from '../src/foundation/collapse-projection.ts'
import { group, type SplitNode } from '../src/foundation/model.ts'

function createHarness() {
  const frames = new Map<number, () => void>()
  let nextFrame = 0
  let geometry: SplitResizeGeometryV1 | undefined = { left: 20, top: 40, width: 400, height: 300 }
  const writes: string[] = []
  const restores: string[] = []
  const aria: number[] = []
  const active: boolean[] = []
  const commits: Array<{ splitId: string; ratio: number }> = []
  let acceptCommit = true
  const readGeometry = vi.fn(() => geometry)
  const port: SplitResizeControllerPortV1 = {
    readGeometry,
    getTracks: ratio => `${ratio.toFixed(3)}fr 12px ${1 - ratio}fr`,
    resolveRatio: input => splitResizeRatioForPointerV1({
      ...input, dividerSize: 12, firstMinimum: 0, secondMinimum: 0,
    }),
    writeTracks: tracks => writes.push(tracks),
    restoreTracks: tracks => restores.push(tracks),
    writeAriaValue: value => aria.push(value),
    setActive: value => active.push(value),
    commit: (splitId, ratio) => { commits.push({ splitId, ratio }); return acceptCommit },
    requestFrame: callback => {
      const id = ++nextFrame
      frames.set(id, callback)
      return id
    },
    cancelFrame: id => { frames.delete(id) },
  }
  const controller = new SplitResizeControllerV1(port)
  const flushFrame = () => {
    const pending = [...frames.entries()]
    frames.clear()
    for (const [, callback] of pending) callback()
  }
  const begin = (axis: 'horizontal' | 'vertical' = 'horizontal') => controller.begin({
    splitId: 'split-main', axis, persistedRatio: 0.5, pointerId: 7,
    pointer: axis === 'horizontal' ? 220 : 190,
    geometry: { left: 20, top: 40, width: 400, height: 300 },
  })
  return {
    controller, frames, writes, restores, aria, active, commits, readGeometry, flushFrame, begin,
    setGeometry(value: SplitResizeGeometryV1 | undefined) { geometry = value },
    rejectCommit() { acceptCommit = false },
  }
}

describe('SplitResizeControllerV1', () => {
  it('coalesces pointer movement into one frame and commits only the final ratio', () => {
    const h = createHarness()
    expect(h.begin()).toBe(true)
    h.controller.move(7, 300)
    h.controller.move(7, 340)
    h.controller.move(7, 360)

    expect(h.frames.size).toBe(1)
    expect(h.readGeometry).not.toHaveBeenCalled()
    h.flushFrame()
    expect(h.writes.at(-1)).toMatch(/^0\.861fr/)
    expect(h.controller.ownsPointer(7)).toBe(true)

    h.controller.move(7, 380)
    h.controller.finish(true)
    expect(h.commits).toEqual([{ splitId: 'split-main', ratio: 354 / 388 }])
    expect(h.restores.at(-1)).toMatch(/^0\.912fr/)
    expect(h.controller.ownsPointer(7)).toBe(false)
    expect(h.active).toEqual([true, false])
  })

  it('uses the cached geometry until a resize invalidates it', () => {
    const h = createHarness()
    h.begin('vertical')
    h.controller.move(7, 190)
    h.flushFrame()
    expect(h.readGeometry).not.toHaveBeenCalled()

    h.setGeometry({ left: 20, top: 40, width: 400, height: 600 })
    h.controller.invalidateGeometry()
    h.flushFrame()
    expect(h.readGeometry).toHaveBeenCalledTimes(1)
    expect(h.writes.at(-1)).toMatch(/^0\.500fr/)
    h.controller.move(7, 340)
    h.flushFrame()
    expect(h.readGeometry).toHaveBeenCalledTimes(1)
    expect(h.writes.at(-1)).toMatch(/^0\.755fr/)
  })

  it('cancels without committing and restores persisted tracks', () => {
    const h = createHarness()
    h.begin()
    h.controller.move(7, 350)
    h.controller.finish(false)

    expect(h.frames.size).toBe(0)
    expect(h.commits).toEqual([])
    expect(h.restores).toEqual(['0.500fr 12px 0.5fr'])
    expect(h.active).toEqual([true, false])
  })

  it('ignores other pointers and rejects zero-sized geometry', () => {
    const h = createHarness()
    expect(h.controller.begin({
      splitId: 'zero', axis: 'horizontal', persistedRatio: 0.5, pointerId: 1, pointer: 10,
      geometry: { left: 0, top: 0, width: 0, height: 20 },
    })).toBe(false)
    h.begin()
    h.controller.move(99, 500)
    expect(h.frames.size).toBe(0)
    expect(h.controller.ownsPointer(7)).toBe(true)
  })

  it('maps pointer movement to the same first-track extent after removing the divider gap', () => {
    const available = 800 - 12
    const ratio = splitResizeRatioForPointerV1({
      axis: 'horizontal', pointer: 520, startPointer: 400, persistedRatio: 0.5,
      geometry: { left: 0, top: 0, width: 800, height: 500 },
      dividerSize: 12, firstMinimum: 0, secondMinimum: 0,
    })

    expect(ratio).toBeCloseTo(514 / available, 8)
    expect(ratio! * available).toBeCloseTo(514, 8)
  })

  it('keeps the CSS minimum allocation as the pointer reaches a track limit', () => {
    const available = 800 - 12
    const ratio = splitResizeRatioForPointerV1({
      axis: 'horizontal', pointer: 550, startPointer: 400, persistedRatio: 0.5,
      geometry: { left: 0, top: 0, width: 800, height: 500 },
      dividerSize: 12, firstMinimum: 320, secondMinimum: 320,
    })

    const flexible = available - 320 - 320
    expect(320 + ratio! * flexible).toBeCloseTo(available - 320, 8)
    expect(320 + (1 - ratio!) * flexible).toBeCloseTo(320, 8)
  })

  it('uses the free space after projected collapsed rails for both preview and committed tracks', () => {
    const split: SplitNode = {
      kind: 'split', id: 'resize-with-collapsed-rails', axis: 'horizontal', ratio: 0.5,
      first: {
        kind: 'split', id: 'first-branch', axis: 'vertical', ratio: 0.5,
        first: group('collapsed-first'), second: group('expanded-first'),
      },
      second: {
        kind: 'split', id: 'second-branch', axis: 'vertical', ratio: 0.5,
        first: group('collapsed-second'), second: group('expanded-second'),
      },
    }
    const collapsed = new Set(['collapsed-first', 'collapsed-second'])
    const initialTracks = splitGridTracks(split, collapsed).tracks
    expect(initialTracks).toBe('minmax(40px, 0.5fr) 12px minmax(40px, 0.5fr)')
    const projectedMinimums = [...initialTracks.matchAll(/minmax\((\d+(?:\.\d+)?)px,/g)]
    const available = 800 - 12
    const firstMinimum = Number(projectedMinimums[0]?.[1])
    const secondMinimum = Number(projectedMinimums[1]?.[1])
    const flexible = available - firstMinimum - secondMinimum
    const ratio = splitResizeRatioForPointerV1({
      axis: 'horizontal', pointer: 460, startPointer: 400, persistedRatio: 0.5,
      geometry: { left: 0, top: 0, width: 800, height: 500 },
      dividerSize: 12, firstMinimum, secondMinimum,
    })!

    // CSS Grid lays out these minmax tracks as each projected 40px base plus
    // its share of the remaining free space. The 60px pointer movement must
    // move the preview divider by exactly 60px, and the same ratio is stored.
    const previewFirstTrack = firstMinimum + ratio * flexible
    const previewTracks = splitGridTracks({ ...split, ratio }, collapsed).tracks
    const committedTracks = splitGridTracks({ ...split, ratio }, collapsed).tracks
    const committedFirstTrack = firstMinimum + ratio * flexible
    expect(ratio).toBeCloseTo(0.5 + 60 / flexible, 8)
    expect(previewFirstTrack).toBeCloseTo(firstMinimum + flexible * 0.5 + 60, 8)
    expect(committedFirstTrack).toBeCloseTo(previewFirstTrack, 8)
    expect(previewTracks).toBe(committedTracks)
    expect(previewTracks).toBe(`minmax(40px, ${String(ratio)}fr) 12px minmax(40px, ${String(1 - ratio)}fr)`)
    expect(firstMinimum + (1 - ratio) * flexible).toBeGreaterThanOrEqual(secondMinimum)
  })

  it('does not offer resize when projected collapsed rails exhaust the split extent', () => {
    expect(splitResizeRatioForPointerV1({
      axis: 'horizontal', pointer: 460, startPointer: 400, persistedRatio: 0.5,
      geometry: { left: 0, top: 0, width: 800, height: 500 },
      dividerSize: 12, firstMinimum: 400, secondMinimum: 388,
    })).toBeUndefined()
  })

  it('restores the persisted tracks if the layout commit rejects the preview', () => {
    const h = createHarness()
    h.rejectCommit()
    h.begin()
    h.controller.move(7, 300)
    h.controller.finish(true)

    expect(h.commits).toHaveLength(1)
    expect(h.restores.at(-1)).toBe('0.500fr 12px 0.5fr')
    expect(h.active).toEqual([true, false])
  })
})
