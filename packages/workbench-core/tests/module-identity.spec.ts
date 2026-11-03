import { WORKBENCH_CORE_VERSION, WORKBENCH_SUITE_VERSION, WORKBENCH_DSH_GENERATION, WORKBENCH_UPSTREAM_COMMIT } from '../src/release-compatibility.ts'
import { createServer, type RequestListener } from 'node:http'
import { once } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { installWorkbenchModuleIdentityRoute } from '../src/host-module-identity-route.ts'
import { readWorkbenchVerifiedModuleIdentity, WORKBENCH_MODULE_IDENTITY_ROUTE_V1 } from '../src/module-identity.ts'

const identity = { moduleId: 'workbench.conversation-suite', version: WORKBENCH_SUITE_VERSION, artifactDigest: 'a'.repeat(64) }

describe('verified Module identity transport', () => {
  it('waits for Host startup and projects only the verified identity over HTTP', async () => {
    const server = createServer()
    const ready = Promise.withResolvers<void>()
    const sourceGet = vi.fn(() => ({ ...identity, privateReceipt: 'must-not-cross-runtime' }))
    const services = new Map<string, unknown>([
      ['workbenchVerifiedModuleIdentity', { get: sourceGet }],
      ['workbenchModuleStartupReady', ready.promise],
      ['webServer', { register: (route: { handler: RequestListener }) => {
        server.on('request', route.handler)
        return () => server.off('request', route.handler)
      } }],
    ])
    const contextGet = vi.fn(<T>(name: string, strict = true) => (strict ? undefined : services.get(name)) as T | undefined)
    const dispose = installWorkbenchModuleIdentityRoute({ get: contextGet })
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('missing test server address')
    const url = `http://127.0.0.1:${address.port}${WORKBENCH_MODULE_IDENTITY_ROUTE_V1}`
    try {
      const response = fetch(url)
      await once(server, 'request')
      expect(sourceGet).not.toHaveBeenCalled()
      ready.resolve()
      const result = await response
      expect(result.headers.get('cache-control')).toBe('no-store')
      expect(await result.json()).toEqual({ schemaVersion: 1, identity })
      expect(contextGet).toHaveBeenCalledWith('webServer', false)
      expect(contextGet).toHaveBeenCalledWith('workbenchVerifiedModuleIdentity', false)
      expect(contextGet).toHaveBeenCalledWith('workbenchModuleStartupReady', false)
      expect((await fetch(url, { method: 'POST' })).status).toBe(405)
      await expect(readWorkbenchVerifiedModuleIdentity((_path, init) => fetch(url, init))).resolves.toEqual(identity)
    } finally {
      dispose?.()
      server.closeAllConnections()
      await new Promise<void>(resolve => server.close(() => resolve()))
    }
  })

  it.each([
    null, {}, { schemaVersion: 2, identity }, { schemaVersion: 1, identity: null },
    { schemaVersion: 1, identity: { ...identity, version: '0.2.0' } },
    { schemaVersion: 1, identity: { ...identity, moduleId: 'workbench.other' } },
    { schemaVersion: 1, identity: { ...identity, artifactDigest: 'invalid' } },
  ])('keeps the optional Suite inert for invalid identity response %j', async body => {
    await expect(readWorkbenchVerifiedModuleIdentity(async () => Response.json(body))).resolves.toBeUndefined()
  })

  it('keeps the optional Suite inert when the Host route is missing or fails', async () => {
    await expect(readWorkbenchVerifiedModuleIdentity(async () => new Response(null, { status: 404 }))).resolves.toBeUndefined()
    await expect(readWorkbenchVerifiedModuleIdentity(async () => { throw new Error('offline') })).resolves.toBeUndefined()
    await expect(readWorkbenchVerifiedModuleIdentity(async () => new Response('invalid JSON'))).resolves.toBeUndefined()
  })
})
