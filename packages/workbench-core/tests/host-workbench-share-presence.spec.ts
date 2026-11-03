import { describe, expect, it } from 'vitest'
import { createWorkbenchSharePresenceBroker } from '../src/host-workbench-share-presence.ts'

describe('Workbench share presence broker', () => {
  it('keeps draft presence ephemeral, ordered, and scoped to one Session/Area', () => {
    let clock = 1_000
    const broker = createWorkbenchSharePresenceBroker({ now: () => clock })
    const publish = (revision: number, draftText: string, typing = true) => broker.publish({
      workbenchId: 'workbench-a', sessionId: 'session-a', areaId: 'area-a', participantId: 'host',
      role: 'host', typing, draftText, hasAttachments: false, revision,
    })
    expect(publish(1, '正在输入')).toMatchObject({ ok: true, status: 'accepted' })
    expect(broker.snapshot({ workbenchId: 'workbench-a', sessionId: 'session-a', areaId: 'area-a' })).toMatchObject([
      { draftText: '正在输入', typing: true, revision: 1 },
    ])
    expect(publish(0, '旧内容')).toMatchObject({ ok: true, status: 'accepted' })
    expect(broker.snapshot({ workbenchId: 'workbench-a', sessionId: 'session-a', areaId: 'area-a' })[0]?.draftText).toBe('正在输入')
    expect(broker.snapshot({ workbenchId: 'workbench-a', sessionId: 'session-b', areaId: 'area-a' })).toEqual([])
    clock += 3_001
    expect(broker.snapshot({ workbenchId: 'workbench-a', sessionId: 'session-a', areaId: 'area-a' })[0]?.typing).toBe(false)
    clock += 9_000
    expect(broker.snapshot({ workbenchId: 'workbench-a', sessionId: 'session-a', areaId: 'area-a' })).toEqual([])
  })

  it('clears a draft when the official Composer becomes empty and bounds its size', () => {
    const broker = createWorkbenchSharePresenceBroker({ maxDraftText: 4 })
    const base = {
      workbenchId: 'workbench-a', sessionId: 'session-a', areaId: 'area-a', participantId: 'host',
      role: 'host' as const, typing: false, hasAttachments: false,
    }
    expect(broker.publish({ ...base, revision: 1, draftText: '12345' })).toEqual({ ok: false, error: 'presence-draft-too-large' })
    expect(broker.publish({ ...base, revision: 1, draftText: '1234' })).toMatchObject({ ok: true, status: 'accepted' })
    expect(broker.publish({ ...base, revision: 2, draftText: '' })).toEqual({ ok: true, status: 'cleared' })
    expect(broker.size).toBe(0)
  })

  it('clears all participants when a share session stops', () => {
    const broker = createWorkbenchSharePresenceBroker()
    for (const participantId of ['host', 'guest-a']) broker.publish({
      workbenchId: 'workbench-a', sessionId: 'session-a', areaId: 'area-a', participantId,
      role: participantId === 'host' ? 'host' : 'guest', typing: false, draftText: 'draft', hasAttachments: false, revision: 1,
    })
    expect(broker.size).toBe(2)
    broker.clearWorkbench('workbench-a')
    expect(broker.size).toBe(0)
  })
})
