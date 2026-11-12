import { describe, expect, it } from 'vitest'
import { createWorkbenchDraftOtAdapter, draftTextDelta, type DraftCommittedChangeV1 } from '../src/client/workbench-draft-ot.ts'
import {
  applyDraftOperations,
  normalizeDraftOperations,
  transformDraftOperations,
  type DraftOperationV1,
} from '../src/workbench-collaboration-contract.ts'

/** Mirrors the Host's `draft.apply` handling: late operations are the left side. */
function createHostDraft(text = '') {
  let revision = 0
  const history: { baseRevision: number; operations: readonly DraftOperationV1[] }[] = []
  return {
    text: () => text,
    revision: () => revision,
    commit(input: { baseRevision: number; operations: readonly DraftOperationV1[] }): DraftCommittedChangeV1 {
      let operations = normalizeDraftOperations(input.operations)
      for (const entry of history) {
        if (entry.baseRevision >= input.baseRevision) [operations] = transformDraftOperations(operations, entry.operations)
      }
      text = applyDraftOperations(text, operations)
      history.push({ baseRevision: revision, operations })
      revision += 1
      return { revision, text, operations }
    },
  }
}

describe('draftTextDelta', () => {
  it('describes inserts, deletes and replacements as one range', () => {
    for (const [before, after] of [['', 'abc'], ['abc', ''], ['hello world', 'hello brave world'], ['abcdef', 'abXYef'], ['aaa', 'aa'], ['same', 'same']] as const) {
      expect(applyDraftOperations(before, draftTextDelta(before, after))).toBe(after)
    }
    expect(draftTextDelta('same', 'same')).toEqual([])
  })
})

describe('Workbench draft OT adapter', () => {
  it('sends one operation at a time and keeps later typing as unsent text', () => {
    const adapter = createWorkbenchDraftOtAdapter({ text: '', revision: 0 })
    adapter.setLocalText('a')
    const first = adapter.takeOutgoing()
    expect(first).toEqual({ baseRevision: 0, operations: [{ type: 'insert', text: 'a' }] })
    adapter.setLocalText('ab')
    expect(adapter.takeOutgoing()).toBeUndefined()
    expect(adapter.hasUnsent()).toBe(true)
    expect(adapter.applyCommitted({ revision: 1, text: 'a', operations: first!.operations }, true)).toBe('ab')
    expect(adapter.takeOutgoing()).toEqual({ baseRevision: 1, operations: [{ type: 'retain', count: 1 }, { type: 'insert', text: 'b' }] })
  })

  it('converges with the Host when two participants type at the same revision', () => {
    const host = createHostDraft('hello')
    const a = createWorkbenchDraftOtAdapter({ text: 'hello', revision: 0 })
    const b = createWorkbenchDraftOtAdapter({ text: 'hello', revision: 0 })
    a.setLocalText('hello A')
    b.setLocalText('B hello')
    const fromA = host.commit(a.takeOutgoing()!)
    const fromB = host.commit(b.takeOutgoing()!)
    expect(host.text()).toBe('B hello A')

    a.applyCommitted(fromA, true)
    b.applyCommitted(fromA, false)
    // B keeps typing before its own operation is acknowledged.
    b.setLocalText(`${b.localText()}!`)
    expect(b.localText()).toBe('B hello A!')
    a.applyCommitted(fromB, false)
    b.applyCommitted(fromB, true)
    expect(a.localText()).toBe('B hello A')
    expect(b.hasInFlight()).toBe(false)

    const tail = host.commit(b.takeOutgoing()!)
    a.applyCommitted(tail, false)
    b.applyCommitted(tail, true)
    expect(host.text()).toBe('B hello A!')
    expect(a.localText()).toBe(host.text())
    expect(b.localText()).toBe(host.text())
    expect(a.hasUnsent()).toBe(false)
    expect(b.hasUnsent()).toBe(false)
  })

  it('uses the Host tie break for inserts at the same position', () => {
    const host = createHostDraft('')
    const a = createWorkbenchDraftOtAdapter({ text: '', revision: 0 })
    const b = createWorkbenchDraftOtAdapter({ text: '', revision: 0 })
    a.setLocalText('a')
    b.setLocalText('b')
    const fromA = host.commit(a.takeOutgoing()!)
    const fromB = host.commit(b.takeOutgoing()!)
    for (const change of [fromA, fromB]) {
      a.applyCommitted(change, change === fromA)
      b.applyCommitted(change, change === fromB)
    }
    expect(a.localText()).toBe(host.text())
    expect(b.localText()).toBe(host.text())
  })

  it('keeps unsent local typing when a remote delete overlaps it', () => {
    const host = createHostDraft('one two three')
    const a = createWorkbenchDraftOtAdapter({ text: 'one two three', revision: 0 })
    const b = createWorkbenchDraftOtAdapter({ text: 'one two three', revision: 0 })
    a.setLocalText('one three')
    b.setLocalText('one two three four')
    const fromA = host.commit(a.takeOutgoing()!)
    // B has not sent anything yet when the remote delete arrives.
    expect(b.applyCommitted(fromA, false)).toBe('one three four')
    a.applyCommitted(fromA, true)
    const fromB = host.commit(b.takeOutgoing()!)
    a.applyCommitted(fromB, false)
    b.applyCommitted(fromB, true)
    expect(host.text()).toBe('one three four')
    expect(a.localText()).toBe(host.text())
    expect(b.localText()).toBe(host.text())
  })

  it('stays consistent through interleaved typing from three participants', () => {
    const host = createHostDraft('')
    const clients = [0, 1, 2].map(() => createWorkbenchDraftOtAdapter({ text: '', revision: 0 }))
    const queue: { change: DraftCommittedChangeV1; actor: number }[] = []
    const delivered = [0, 0, 0]
    let seed = 7
    const random = (limit: number): number => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % limit }
    for (let step = 0; step < 400; step += 1) {
      const index = random(3)
      const client = clients[index]!
      const action = random(4)
      if (action === 0) {
        const text = client.localText()
        const at = random(text.length + 1)
        client.setLocalText(text.slice(0, at) + String.fromCharCode(97 + random(26)) + text.slice(at))
      } else if (action === 1) {
        const text = client.localText()
        if (text.length > 0) { const at = random(text.length); client.setLocalText(text.slice(0, at) + text.slice(at + 1)) }
      } else if (action === 2) {
        const outgoing = client.takeOutgoing()
        if (outgoing !== undefined) queue.push({ change: host.commit(outgoing), actor: index })
      } else if (delivered[index]! < queue.length) {
        const item = queue[delivered[index]!]!
        client.applyCommitted(item.change, item.actor === index)
        delivered[index]! += 1
      }
    }
    // Drain: deliver everything, send what is left, repeat until quiet.
    for (let round = 0; round < 20; round += 1) {
      clients.forEach((client, index) => {
        while (delivered[index]! < queue.length) {
          const item = queue[delivered[index]!]!
          client.applyCommitted(item.change, item.actor === index)
          delivered[index]! += 1
        }
        const outgoing = client.takeOutgoing()
        if (outgoing !== undefined) queue.push({ change: host.commit(outgoing), actor: index })
      })
    }
    for (const client of clients) {
      expect(client.hasInFlight()).toBe(false)
      expect(client.hasUnsent()).toBe(false)
      expect(client.localText()).toBe(host.text())
      expect(client.confirmedRevision()).toBe(host.revision())
    }
  })

  it('treats an own event that does not match the in-flight operation as a remote edit', () => {
    const adapter = createWorkbenchDraftOtAdapter({ text: 'ab', revision: 0 })
    adapter.setLocalText('abX')
    adapter.takeOutgoing()
    // Another surface of the same participant inserted at the start.
    expect(adapter.applyCommitted({ revision: 1, text: 'Yab', operations: [{ type: 'insert', text: 'Y' }] }, true)).toBe('YabX')
    expect(adapter.hasInFlight()).toBe(true)
    expect(adapter.applyCommitted({ revision: 2, text: 'YabX', operations: [{ type: 'retain', count: 3 }, { type: 'insert', text: 'X' }] }, true)).toBe('YabX')
    expect(adapter.hasInFlight()).toBe(false)
  })

  it('falls back to the Host text when the in-flight operation is rejected', () => {
    const adapter = createWorkbenchDraftOtAdapter({ text: 'host', revision: 3 })
    adapter.setLocalText('host local')
    adapter.takeOutgoing()
    expect(adapter.rejectInFlight()).toBe('host')
    expect(adapter.hasUnsent()).toBe(false)
  })

  it('keeps unsent typing across a resync and adopts the Host text when an operation was in flight', () => {
    const idle = createWorkbenchDraftOtAdapter({ text: 'base', revision: 1 })
    idle.setLocalText('base mine')
    expect(idle.resync('their base', 4)).toBe('their base mine')
    expect(idle.confirmedRevision()).toBe(4)
    expect(idle.takeOutgoing()).toEqual({ baseRevision: 4, operations: [{ type: 'retain', count: 10 }, { type: 'insert', text: ' mine' }] })

    const busy = createWorkbenchDraftOtAdapter({ text: 'base', revision: 1 })
    busy.setLocalText('base mine')
    busy.takeOutgoing()
    expect(busy.resync('their base', 4)).toBe('their base')
    expect(busy.hasInFlight()).toBe(false)
  })

  it('keeps the in-flight operation when only the draft revision moved', () => {
    const adapter = createWorkbenchDraftOtAdapter({ text: 'a', revision: 1 })
    adapter.setLocalText('ab')
    adapter.takeOutgoing()
    expect(adapter.resync('a', 2)).toBe('ab')
    expect(adapter.hasInFlight()).toBe(true)
    expect(adapter.confirmedRevision()).toBe(2)
  })

  it('treats a resync that already contains the in-flight result as its acknowledgement', () => {
    const adapter = createWorkbenchDraftOtAdapter({ text: 'a', revision: 1 })
    adapter.setLocalText('ab')
    adapter.takeOutgoing()
    adapter.setLocalText('abc')
    expect(adapter.resync('ab', 2)).toBe('abc')
    expect(adapter.hasInFlight()).toBe(false)
    expect(adapter.takeOutgoing()).toEqual({ baseRevision: 2, operations: [{ type: 'retain', count: 2 }, { type: 'insert', text: 'c' }] })
  })

  it('returns an operation that was never sent to the unsent text', () => {
    const adapter = createWorkbenchDraftOtAdapter({ text: '', revision: 0 })
    adapter.setLocalText('a')
    adapter.takeOutgoing()
    adapter.abandonInFlight()
    expect(adapter.localText()).toBe('a')
    expect(adapter.takeOutgoing()).toEqual({ baseRevision: 0, operations: [{ type: 'insert', text: 'a' }] })
  })

  it('resyncs when an event skips a revision and ignores a repeated event', () => {
    const adapter = createWorkbenchDraftOtAdapter({ text: 'a', revision: 1 })
    expect(adapter.applyCommitted({ revision: 1, text: 'ignored', operations: [] }, false)).toBe('a')
    expect(adapter.applyCommitted({ revision: 4, text: 'abc', operations: [{ type: 'retain', count: 2 }, { type: 'insert', text: 'c' }] }, false)).toBe('abc')
    expect(adapter.confirmedRevision()).toBe(4)
  })
})
