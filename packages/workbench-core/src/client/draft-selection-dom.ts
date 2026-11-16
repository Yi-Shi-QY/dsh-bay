/**
 * Maps shared draft offsets to positions inside the composer DOM and back.
 *
 * A shared draft is plain text. The composer renders it as text nodes, line
 * breaks and block elements, so one draft offset is one of:
 *
 * - a position inside a text node;
 * - a `<br>`, which counts as one character;
 * - the boundary between two block elements, which counts as one newline.
 *
 * The helpers only read the DOM. They never change the composer.
 */

const BLOCK_TAGS = new Set(['P', 'DIV', 'LI', 'UL', 'OL', 'PRE', 'BLOCKQUOTE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6'])

type Segment =
  | { readonly kind: 'text'; readonly node: Text; readonly start: number; readonly length: number }
  | { readonly kind: 'break'; readonly node: Node; readonly start: number; readonly length: 1 }

/** The element holding the unsent draft inside a conversation surface. */
export function findDraftEditable(root: ParentNode): HTMLElement | undefined {
  return root.querySelector<HTMLElement>('[contenteditable="true"], [contenteditable=""], textarea') ?? undefined
}

function segmentsOf(editable: HTMLElement): { readonly segments: readonly Segment[]; readonly length: number } {
  const segments: Segment[] = []
  let length = 0
  let blockSeen = false
  const visit = (node: Node): void => {
    if (node.nodeType === 3) {
      const text = node as Text
      if (text.data.length > 0) { segments.push({ kind: 'text', node: text, start: length, length: text.data.length }); length += text.data.length }
      return
    }
    if (node.nodeType !== 1) return
    const element = node as Element
    if (element.tagName === 'BR') { segments.push({ kind: 'break', node: element, start: length, length: 1 }); length += 1; return }
    if (BLOCK_TAGS.has(element.tagName) && element !== editable) {
      // Every block after the first starts on a new line.
      if (blockSeen) { segments.push({ kind: 'break', node: element, start: length, length: 1 }); length += 1 }
      blockSeen = true
    }
    for (const child of [...element.childNodes]) visit(child)
  }
  visit(editable)
  return { segments, length }
}

/** Draft text as the composer DOM renders it. */
export function draftTextOf(editable: HTMLElement): string {
  if (editable instanceof HTMLTextAreaElement) return editable.value
  return segmentsOf(editable).segments.map(segment => segment.kind === 'text' ? segment.node.data : '\n').join('')
}

/** Draft offset of a DOM position, or undefined when it is outside the composer. */
export function draftOffsetOf(editable: HTMLElement, node: Node, offset: number): number | undefined {
  if (!editable.contains(node)) return undefined
  const { segments, length } = segmentsOf(editable)
  if (node.nodeType === 3) {
    const segment = segments.find(row => row.kind === 'text' && row.node === node)
    return segment === undefined ? undefined : segment.start + Math.min(Math.max(0, offset), segment.length)
  }
  // An element position sits before its child at `offset`.
  const child = node.childNodes[offset]
  if (child === undefined) {
    const inside = segments.filter(row => node.contains(row.node))
    const last = inside.at(-1)
    return last === undefined ? (node === editable ? length : segments.find(row => (node.compareDocumentPosition(row.node) & 4) !== 0)?.start ?? length) : last.start + last.length
  }
  const next = segments.find(row => row.node === child || child.contains(row.node) || (child.compareDocumentPosition(row.node) & 4) !== 0)
  return next === undefined ? length : next.start
}

/** Local selection of the composer in draft offsets. */
export function draftSelectionOf(root: ParentNode): { readonly start: number; readonly end: number } | undefined {
  const editable = findDraftEditable(root)
  if (editable === undefined) return undefined
  if (editable instanceof HTMLTextAreaElement) {
    return editable.ownerDocument.activeElement === editable ? { start: editable.selectionStart, end: editable.selectionEnd } : undefined
  }
  const selection = editable.ownerDocument.defaultView?.getSelection?.()
  if (selection === null || selection === undefined || selection.rangeCount === 0 || selection.anchorNode === null || selection.focusNode === null) return undefined
  const anchor = draftOffsetOf(editable, selection.anchorNode, selection.anchorOffset)
  const focus = draftOffsetOf(editable, selection.focusNode, selection.focusOffset)
  if (anchor === undefined || focus === undefined) return undefined
  return { start: Math.min(anchor, focus), end: Math.max(anchor, focus) }
}

function positionAt(editable: HTMLElement, segments: readonly Segment[], offset: number): { readonly node: Node; readonly offset: number } {
  for (const segment of segments) {
    if (segment.kind === 'text' && offset >= segment.start && offset <= segment.start + segment.length) return { node: segment.node, offset: offset - segment.start }
  }
  // The offset is on a line break: use the start of whatever follows it.
  const after = segments.find(segment => segment.kind === 'text' && segment.start >= offset)
  if (after !== undefined) return { node: after.node, offset: 0 }
  const last = segments.filter(segment => segment.kind === 'text').at(-1)
  return last === undefined ? { node: editable, offset: 0 } : { node: last.node, offset: (last as { length: number }).length }
}

/** DOM range for a draft selection. Offsets beyond the text are clamped. */
export function draftRangeAt(editable: HTMLElement, start: number, end: number): Range | undefined {
  if (editable instanceof HTMLTextAreaElement) return undefined
  const { segments, length } = segmentsOf(editable)
  const from = Math.min(Math.max(0, Math.min(start, end)), length)
  const to = Math.min(Math.max(0, Math.max(start, end)), length)
  const range = editable.ownerDocument.createRange()
  const first = positionAt(editable, segments, from)
  const last = positionAt(editable, segments, to)
  try {
    range.setStart(first.node, first.offset)
    range.setEnd(last.node, last.offset)
  } catch { return undefined }
  return range
}
