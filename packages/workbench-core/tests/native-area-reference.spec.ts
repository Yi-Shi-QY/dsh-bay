import { describe, expect, it, vi } from 'vitest'
import { retainWorkbenchArea } from '../src/client/native-area-reference.ts'

function sessionsWith(known: Set<string>) {
  const released: string[] = []
  const sessions = {
    retain: vi.fn((sessionId: string) => {
      if (!known.has(sessionId)) throw new Error(`sessions.retain: unknown session ${sessionId}`)
      return { binding: { sessionId }, ready: Promise.resolve(), release: () => { released.push(sessionId) } }
    }),
    refresh: vi.fn(async () => {}),
  }
  return { sessions, released }
}

describe('Workbench Area native reference', () => {
  it('retains a Session the catalog already knows without refreshing it', async () => {
    const { sessions } = sessionsWith(new Set(['session-a']))
    const lease = retainWorkbenchArea(sessions as never, { sessionId: 'session-a' as never, areaId: 'area', claim: 'claim' })
    await expect(lease.ready).resolves.toMatchObject({ binding: { sessionId: 'session-a' } })
    expect(sessions.refresh).not.toHaveBeenCalled()
  })

  it('refreshes the catalog once for a Session the Host has just created', async () => {
    // A LAN participant misses the native "added" event for a Session created
    // from its own new-conversation page; the refreshed list contains it.
    const known = new Set<string>()
    const { sessions } = sessionsWith(known)
    sessions.refresh.mockImplementation(async () => { known.add('session-new') })
    const lease = retainWorkbenchArea(sessions as never, { sessionId: 'session-new' as never, areaId: 'area', claim: 'claim' })
    await expect(lease.ready).resolves.toMatchObject({ binding: { sessionId: 'session-new' } })
    expect(sessions.refresh).toHaveBeenCalledOnce()
    expect(lease.assertLive()).toEqual({ sessionId: 'session-new' })
  })

  it('still fails for a Session the refreshed catalog does not contain', async () => {
    const { sessions } = sessionsWith(new Set())
    const lease = retainWorkbenchArea(sessions as never, { sessionId: 'session-gone' as never, areaId: 'area', claim: 'claim' })
    await expect(lease.ready).rejects.toThrow(/unknown session/u)
  })

  it('does not retain after the Area released the pending reference', async () => {
    const known = new Set<string>()
    const { sessions, released } = sessionsWith(known)
    sessions.refresh.mockImplementation(async () => { known.add('session-new') })
    const lease = retainWorkbenchArea(sessions as never, { sessionId: 'session-new' as never, areaId: 'area', claim: 'claim' })
    lease.release()
    await expect(lease.ready).rejects.toThrow('workbench-area-claim-expired')
    expect(sessions.retain).toHaveBeenCalledOnce()
    expect(released).toEqual([])
  })
})
