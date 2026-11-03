import { describe, expect, it } from 'vitest'
import { createWorkbenchShareSessionManager } from '../src/host-workbench-share-session.ts'

describe('Workbench LAN share session manager', () => {
  it('keeps one bearer link per Workbench and never stores raw tokens in snapshots', () => {
    let sequence = 0
    const manager = createWorkbenchShareSessionManager({ randomToken: () => `token-${String(++sequence).padStart(2, '0')}-${'x'.repeat(36)}` })
    const first = manager.start('workbench-a', '192.168.1.5', 4321, 'http://example/workbench')
    expect(first.ok).toBe(true)
    if (!first.ok) return
    expect(first.status).toBe('started')
    expect(first.token).toBe(`token-01-${'x'.repeat(36)}`)
    expect(manager.findByToken(first.token)).toBeDefined()
    const second = manager.start('workbench-a', '192.168.1.5', 4321, 'http://example/workbench')
    expect(second).toMatchObject({ ok: true, status: 'already-active' })
    expect(manager.getSnapshot()).toEqual([{ workbenchId: 'workbench-a', bindHost: '192.168.1.5', port: 4321, createdAt: expect.any(Number), guestCount: 0 }])
    expect(JSON.stringify(manager.getSnapshot())).not.toContain(first.token)
    manager.dispose()
    expect(manager.findByToken(first.token)).toBeUndefined()
  })

  it('limits guests, retains a lease after bearer redirect, and invalidates every lease on stop', () => {
    let sequence = 0
    const manager = createWorkbenchShareSessionManager({ maxGuests: 2, randomToken: () => `token-${String(++sequence).padStart(2, '0')}-${'x'.repeat(36)}` })
    const started = manager.start('workbench-a', '192.168.1.5', 4321, 'http://example/workbench')
    if (!started.ok || started.token === undefined) throw new Error('share session did not start')
    const session = manager.findByToken(started.token)
    expect(session).toBeDefined()
    const first = manager.createLease(session!)
    const second = manager.createLease(session!)
    expect('error' in first).toBe(false)
    expect('error' in second).toBe(false)
    if ('error' in first || 'error' in second) return
    expect(manager.findLease(first.cookie)?.lease.leaseId).toBe(first.lease.leaseId)
    expect(manager.createLease(session!)).toEqual({ error: 'workbench-share-guest-limit-reached' })
    manager.stop('workbench-a')
    expect(manager.findByToken(started.token)).toBeUndefined()
    expect(manager.findLease(first.cookie)).toBeUndefined()
    expect(manager.findLease(second.cookie)).toBeUndefined()
  })
})
