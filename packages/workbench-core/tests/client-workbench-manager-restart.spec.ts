import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createWorkbenchManagerRestartBridge, type WorkbenchRestartStatusV1 } from '../src/client/workbench-manager-restart.ts'

const operationId = 'b927cf92-7c0b-4501-9589-c32a173cf5fc'
const transactionId = 'transaction-1'
const key = 'dsh.workbench.restart.resume.v1'
const complete: WorkbenchRestartStatusV1 = { schemaVersion: 1, operationId, transactionId, phase: 'verified',
  sourceRunReady: false, replacementRunReady: true, managerSucceeded: true, workbenchVerified: true, transactionState: 'active' }
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status })
const documentFor = (token: string, capability = 'operation-status-v2') => ({ querySelector: (selector: string) => ({
  getAttribute: () => selector.includes('dsh-manager-restart') ? capability : token,
}) })
function browser(fetcher: typeof fetch) { vi.stubGlobal('fetch', fetcher); vi.stubGlobal('document', documentFor('old-token')) }
beforeEach(() => {
  const store = new Map<string, string>()
  vi.stubGlobal('sessionStorage', { getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value), removeItem: (key: string) => store.delete(key) })
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe('Workbench Manager restart bridge', () => {
  it('waits through 202, disconnection, readiness and pending verification', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(json({ ok: true, operationId }, 202))
      .mockRejectedValueOnce(new TypeError('connection lost'))
      .mockResolvedValueOnce(json({ ...complete, phase: 'ready', transactionState: 'restart-required', workbenchVerified: false }))
      .mockResolvedValueOnce(json(complete))
    browser(fetcher)
    const bridge = createWorkbenchManagerRestartBridge()!
    expect(await bridge.requestRestart(transactionId)).toEqual({ operationId })
    expect(JSON.parse(sessionStorage.getItem(key)!)).toEqual({ operationId, transactionId })
    const onStatus = vi.fn()
    expect(await bridge.waitForRestart({ operationId, transactionId, onStatus })).toMatchObject({ status: complete })
    expect(onStatus.mock.calls.map(([s]) => s.phase)).toEqual(['ready', 'verified'])
    expect(sessionStorage.getItem(key)).toBeNull()
  })

  it('rotates the short-lived token using the new same-origin index without another POST', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(json({}, 403))
      .mockResolvedValueOnce(new Response('<html>new run</html>')).mockResolvedValueOnce(json(complete))
    browser(fetcher)
    vi.stubGlobal('DOMParser', class { parseFromString() { return documentFor('new-token') } })
    expect(await createWorkbenchManagerRestartBridge()!.waitForRestart({ operationId, transactionId })).toMatchObject({ status: complete })
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      expect.stringContaining('restart-status'), '/', expect.stringContaining('restart-status'),
    ])
    expect(fetcher.mock.calls[2]?.[1]).toMatchObject({ method: 'GET', headers: { 'x-dsh-manager-token': 'new-token' }, redirect: 'error', cache: 'no-store' })
    expect(sessionStorage.getItem(key)).toBeNull()
  })

  it('resumes a reloaded page using GET only, including when already active', async () => {
    sessionStorage.setItem(key, JSON.stringify({ operationId, transactionId }))
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json(complete))
    browser(fetcher)
    const bridge = createWorkbenchManagerRestartBridge()!
    expect(await bridge.requestRestart(transactionId)).toEqual({ operationId })
    expect(fetcher).not.toHaveBeenCalled()
    expect(await bridge.resumeRestart()).toMatchObject({ status: complete })
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(fetcher.mock.calls[0]?.[1]?.method).toBe('GET')
  })

  it.each([
    { ...complete, operationId: 'c927cf92-7c0b-4501-9589-c32a173cf5fc' },
    { ...complete, transactionId: 'another-transaction' },
  ])('rejects mismatched operation or transaction identity', async status => {
    browser(vi.fn<typeof fetch>().mockResolvedValue(json(status)))
    await expect(createWorkbenchManagerRestartBridge()!.waitForRestart({ operationId, transactionId })).rejects.toMatchObject({ name: 'WorkbenchRestartError' })
  })

  it.each(['managerSucceeded', 'replacementRunReady', 'workbenchVerified'] as const)('cannot complete without %s', async field => {
    browser(vi.fn<typeof fetch>().mockResolvedValue(json({ ...complete, [field]: false })))
    await expect(createWorkbenchManagerRestartBridge()!.waitForRestart({ operationId, transactionId, timeoutMs: 20 })).rejects.toMatchObject({ code: 'restart-failed' })
  })

  it('uses fixed Chinese errors without exposing Host diagnostics', async () => {
    browser(vi.fn<typeof fetch>().mockResolvedValue(json({ ...complete, phase: 'failed', diagnosticCode: 'checkpoint-failed', message: 'secret raw stack /private/path' })))
    await expect(createWorkbenchManagerRestartBridge()!.waitForRestart({ operationId, transactionId })).rejects.toMatchObject({ code: 'checkpoint-failed', message: expect.stringContaining('状态保存失败') })
  })

  it('rejects invalid acceptance and UUID before recording any hint', async () => {
    browser(vi.fn<typeof fetch>().mockResolvedValue(json({ ok: true, operationId: 'b927cf92--------------------------------' }, 202)))
    await expect(createWorkbenchManagerRestartBridge()!.requestRestart(transactionId)).rejects.toMatchObject({ code: 'restart-failed' })
    expect(sessionStorage.getItem(key)).toBeNull()
  })

  it('deduplicates concurrent submissions and blocks another transaction', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json({ ok: true, operationId }, 202))
    browser(fetcher)
    const bridge = createWorkbenchManagerRestartBridge()!
    const first = bridge.requestRestart(transactionId)
    expect(bridge.requestRestart(transactionId)).toBe(first)
    await expect(bridge.requestRestart('another')).rejects.toMatchObject({ code: 'restart-busy' })
    await first
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('requires the V2 capability, not merely a Manager token', () => {
    browser(vi.fn())
    vi.stubGlobal('document', documentFor('token', ''))
    expect(createWorkbenchManagerRestartBridge()).toBeUndefined()
    vi.stubGlobal('document', { querySelector: () => null })
    expect(createWorkbenchManagerRestartBridge()).toBeUndefined()
  })
})
