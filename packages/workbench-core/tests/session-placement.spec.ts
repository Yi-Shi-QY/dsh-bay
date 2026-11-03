import { describe, expect, it, vi } from 'vitest'
import { createAreaSessionCreator, waitForSessionBinding } from '../src/client/session-placement.ts'

describe('Official Session binding publication', () => {
  it('waits for publication and releases the subscription', async () => {
    let ready = false
    let notify = () => {}
    const dispose = vi.fn()
    const waiting = waitForSessionBinding(() => ready, listener => { notify = listener; return dispose }, new AbortController().signal)
    ready = true
    notify()
    await waiting
    expect(dispose).toHaveBeenCalledTimes(1)
  })

  it('stops waiting when Core is disposed', async () => {
    const controller = new AbortController()
    const dispose = vi.fn()
    const waiting = waitForSessionBinding(() => false, () => dispose, controller.signal)
    controller.abort()
    await expect(waiting).rejects.toThrow('cancelled')
    expect(dispose).toHaveBeenCalledTimes(1)
  })

  it('fails closed if the Runtime never publishes the binding', async () => {
    const dispose = vi.fn()
    await expect(waitForSessionBinding(() => false, () => dispose, new AbortController().signal, 1)).rejects.toThrow('not published')
    expect(dispose).toHaveBeenCalledTimes(1)
  })
})

describe('Area session creation', () => {
  it('returns independent explicit targets for concurrent Areas', async () => {
    const create = vi.fn().mockResolvedValueOnce('one').mockResolvedValueOnce('two')
    const place = createAreaSessionCreator({ create })
    const targets = await Promise.all([
      place('workspace', { requestId: 'area-one' }),
      place('workspace', { requestId: 'area-two' }),
    ])
    expect(targets.map(result => result.target.sessionId)).toEqual(['one', 'two'])
    expect(targets.every(result => !result.reusedBlank)).toBe(true)
  })

  it('passes the requested Agent preset into the exact Host create call', async () => {
    const calls: Array<{ workspaceId: string; options?: { agentPreset?: string } }> = []
    const place = createAreaSessionCreator({
      create: async (workspaceId, options) => { calls.push({ workspaceId, options }); return 'session' },
    })
    expect(await place('workspace', { requestId: 'area', agentPreset: 'requested' }))
      .toEqual({ target: { sessionId: 'session', workspaceId: 'workspace' }, reusedBlank: false })
    expect(calls).toEqual([{ workspaceId: 'workspace', options: { agentPreset: 'requested' } }])
  })

  it('propagates Host create failures without publishing a false selection', async () => {
    const place = createAreaSessionCreator({
      create: async () => { throw new Error('preset rejected') },
    })
    await expect(place('workspace', { requestId: 'area', agentPreset: 'requested' })).rejects.toThrow('preset rejected')
  })
})
