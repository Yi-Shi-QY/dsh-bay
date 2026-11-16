// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { draftOffsetOf, draftRangeAt, draftSelectionOf, draftTextOf, findDraftEditable } from '../src/client/draft-selection-dom.ts'
import { collaborationStatusLabel, fitSharedCanvas } from '../src/foundation/WorkbenchSharedCanvasViewport.tsx'

function composer(html: string): HTMLElement {
  document.body.innerHTML = `<div id="scope"><p>history</p><div contenteditable="true">${html}</div></div>`
  return findDraftEditable(document.getElementById('scope')!)!
}

describe('draft selection DOM mapping', () => {
  it('reads paragraphs and line breaks as newlines', () => {
    expect(draftTextOf(composer('<p>one</p><p>two<br>three</p>'))).toBe('one\ntwo\nthree')
    expect(draftTextOf(composer('plain <b>bold</b> text'))).toBe('plain bold text')
    expect(draftTextOf(composer(''))).toBe('')
  })

  it('maps DOM positions to draft offsets across blocks', () => {
    const editable = composer('<p>one</p><p>two</p>')
    const [first, second] = [...editable.querySelectorAll('p')]
    expect(draftOffsetOf(editable, first!.firstChild!, 2)).toBe(2)
    expect(draftOffsetOf(editable, second!.firstChild!, 0)).toBe(4)
    expect(draftOffsetOf(editable, second!.firstChild!, 3)).toBe(7)
    expect(draftOffsetOf(editable, editable, 0)).toBe(0)
    expect(draftOffsetOf(editable, editable, 2)).toBe(7)
    expect(draftOffsetOf(editable, document.body, 0)).toBeUndefined()
  })

  it('round trips every offset through a DOM range', () => {
    const editable = composer('<p>ab</p><p>cd<br>e</p>')
    const text = draftTextOf(editable)
    for (let offset = 0; offset <= text.length; offset += 1) {
      const range = draftRangeAt(editable, offset, offset)!
      const back = draftOffsetOf(editable, range.startContainer, range.startOffset)!
      // A position on a line break resolves to the start of the next line.
      expect([offset, offset + 1]).toContain(back)
      if (text[offset] !== '\n') expect(back).toBe(offset)
    }
    const clamped = draftRangeAt(editable, 2, 999)!
    expect(draftOffsetOf(editable, clamped.endContainer, clamped.endOffset)).toBe(text.length)
  })

  it('reports the local selection in draft offsets', () => {
    const editable = composer('<p>one</p><p>two</p>')
    const second = editable.querySelectorAll('p')[1]!.firstChild!
    const range = document.createRange()
    range.setStart(second, 1)
    range.setEnd(second, 3)
    const selection = window.getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)
    expect(draftSelectionOf(document.getElementById('scope')!)).toEqual({ start: 5, end: 7 })
    selection.removeAllRanges()
    expect(draftSelectionOf(document.getElementById('scope')!)).toBeUndefined()
  })
})

describe('shared canvas fit', () => {
  const viewport = (scaleMode: 'contain' | 'cover' | 'fixed') => ({ width: 1600, height: 900, scaleMode })

  it('renders untouched when the page already has the logical size or a size is unusable', () => {
    expect(fitSharedCanvas(viewport('contain'), { width: 1600, height: 900 })).toBeUndefined()
    expect(fitSharedCanvas(undefined, { width: 800, height: 600 })).toBeUndefined()
    expect(fitSharedCanvas(viewport('contain'), { width: 0, height: 600 })).toBeUndefined()
  })

  it('contains the whole canvas and centres it', () => {
    expect(fitSharedCanvas(viewport('contain'), { width: 800, height: 600 })).toEqual({ width: 1600, height: 900, scale: 0.5, offsetX: 0, offsetY: 75, scroll: false })
    const larger = fitSharedCanvas(viewport('contain'), { width: 3200, height: 2000 })!
    expect(larger.scale).toBe(2)
    expect(larger.offsetY).toBe(100)
  })

  it('covers the page or keeps logical pixels by scrolling', () => {
    const cover = fitSharedCanvas(viewport('cover'), { width: 800, height: 600 })!
    expect(cover.scale).toBeCloseTo(600 / 900)
    expect(cover.scroll).toBe(true)
    expect(fitSharedCanvas(viewport('fixed'), { width: 800, height: 600 })).toMatchObject({ scale: 1, scroll: true, offsetX: 0, offsetY: 0 })
    expect(fitSharedCanvas(viewport('fixed'), { width: 2000, height: 1000 })).toMatchObject({ scale: 1, scroll: false, offsetX: 200, offsetY: 50 })
  })

  it('labels every connection state that is not connected', () => {
    expect(collaborationStatusLabel('connected')).toBeUndefined()
    expect(collaborationStatusLabel(undefined)).toBeUndefined()
    for (const state of ['connecting', 'recovering', 'closed'] as const) expect(collaborationStatusLabel(state)).toBeTypeOf('string')
  })
})
