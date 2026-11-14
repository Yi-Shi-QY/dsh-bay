import { expect, it, vi } from 'vitest'
import { createRemoteBayAgentController } from '../src/client/bay-agent-controller.ts'

it('waits for native catalog discovery before exposing Main as ready', async () => {
  let finish!: () => void
  const refresh = vi.fn(() => new Promise<void>(resolve => { finish = resolve }))
  const fetcher = vi.fn(async () => Response.json({ snapshot: { workbenchId: 'one', bayAgentSessionId: 'main', areas: [], workItems: [], assignments: [], attention: [] } }))
  const controller = createRemoteBayAgentController('one', fetcher as never, refresh)
  let ready = false
  const main = controller.ensureMainSession().then(id => { ready = true; return id })
  await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(1))
  expect(ready).toBe(false)
  finish(); expect(await main).toBe('main'); controller.dispose()
})

it('keeps late responses scoped to their original Workbench', async () => {
  const finish = new Map<string, (response: Response) => void>()
  const fetcher = vi.fn(async (_url: unknown, init: RequestInit) => new Promise<Response>(resolve => { finish.set(JSON.parse(String(init.body)).workbenchId, resolve) }))
  const controller = createRemoteBayAgentController('one', fetcher as never)
  const first = controller.ensureMainSession(); controller.setWorkbenchId('two'); const second = controller.ensureMainSession()
  const response = (id: string) => Response.json({ snapshot: { workbenchId: id, bayAgentSessionId: 'main-' + id, areas: [], workItems: [], assignments: [], attention: [] } })
  finish.get('two')!(response('two')); await second
  finish.get('one')!(response('one')); await first
  expect(controller.getSnapshot().workbenchId).toBe('two'); expect(controller.getSnapshot().bayAgentSessionId).toBe('main-two'); controller.dispose()
})

it('single-flights Main requests and exposes host errors without a demo fallback', async () => {
  const fetcher = vi.fn(async () => Response.json({ error: 'host unavailable' }, { status: 503 }))
  const controller = createRemoteBayAgentController('one', fetcher as never)
  const results = await Promise.allSettled([controller.ensureMainSession(), controller.ensureMainSession()])
  expect(fetcher).toHaveBeenCalledTimes(1); expect(results.every(row => row.status === 'rejected')).toBe(true)
  expect(controller.getSnapshot().error).toContain('host unavailable'); expect(controller.getSnapshot().bayAgentSessionId).toBeUndefined(); controller.dispose()
})

it('does not poll or issue actions while the directory has no active Workbench', async () => {
  vi.useFakeTimers()
  const fetcher = vi.fn(async () => Response.json({ error: 'invalid workbench' }, { status: 400 }))
  const controller = createRemoteBayAgentController('one', fetcher as never)
  const unsubscribe = controller.subscribe(() => {})
  controller.setWorkbenchId('')

  await vi.advanceTimersByTimeAsync(5000)
  await expect(controller.ensureMainSession()).rejects.toThrow('请选择工作台。')
  expect(fetcher).not.toHaveBeenCalled()
  unsubscribe()
  controller.dispose()
  vi.useRealTimers()
})
