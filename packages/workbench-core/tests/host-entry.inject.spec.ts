import { describe, expect, it, vi } from 'vitest'
import { apply, inject } from '../src/index.ts'

describe('Core Host entry service injection', () => {
  it('resolves Host services from the Cordis inject child context', () => {
    expect(inject).toContain('webServer')
    const rootGet = vi.fn((name: string, _strict?: boolean) => {
      if (name === 'webServer') throw new Error('webServer read from root context')
      return undefined
    })
    const routeRegister = vi.fn(() => vi.fn())
    const webServer = { register: routeRegister, getOrigin: () => 'http://127.0.0.1:4200' }
    const effect = vi.fn((handler: () => (() => void) | void) => handler())
    const ctx = {
      get: rootGet,
      provide: vi.fn(),
      effect,
      inject: vi.fn((names: readonly string[], callback: (child: { get(name: string, strict?: boolean): unknown }) => unknown) => {
        expect(names).toEqual(['connection', 'webServer', 'settings'])
        return callback({ get: (name, strict) => name === 'webServer' ? webServer : rootGet(name, strict) })
      }),
    }

    expect(() => apply(ctx as never)).not.toThrow()
    expect(ctx.inject).toHaveBeenCalledOnce()
    expect(routeRegister).not.toHaveBeenCalled()
    expect(rootGet).not.toHaveBeenCalledWith('webServer')
  })

  it('registers browser window RPC through the root Connection and injected WebServer child', () => {
    expect(inject).toContain('connection')
    let rpcHandler: ((endpoint: string, payload: unknown) => unknown) | undefined
    const connection = {
      authenticatedUrl: (url: string) => { const target = new URL(url); target.searchParams.set('token', 'test'); return target.href },
      rpc: {
        handle: vi.fn((_channel: string, handler: typeof rpcHandler) => { rpcHandler = handler; return vi.fn() }),
        intercept: vi.fn((_channel: string, _matches: unknown, handler: typeof rpcHandler) => { rpcHandler = handler; return vi.fn() }),
      },
      fetch: { register: vi.fn(() => vi.fn()) },
    }
    const settings = { describe: () => [{ ns: 'workbench-layout', value: { workbenches: { 'workbench-a': {} } } }] }
    const webServer = { getOrigin: () => 'http://127.0.0.1:4200' }
    const rootGet = vi.fn((name: string) => name === 'connection' ? connection : name === 'settings' ? settings : undefined)
    const ctx = {
      get: rootGet,
      provide: vi.fn(),
      effect: vi.fn(),
      inject: vi.fn((_names: readonly string[], callback: (child: { get(name: string, strict?: boolean): unknown }) => unknown) => callback({
        get: (name: string, strict?: boolean) => {
          if (name === 'webServer') return webServer
          if (name === 'connection') return connection
          return rootGet(name)
        },
      })),
    }

    apply(ctx as never)

    expect(connection.rpc.intercept).toHaveBeenCalledWith('/api', expect.any(Function), expect.any(Function))
    expect(typeof rpcHandler).toBe('function')
    expect(connection.fetch.register).toHaveBeenCalledTimes(7)
  })
})
