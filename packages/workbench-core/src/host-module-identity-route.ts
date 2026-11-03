import type { IncomingMessage, ServerResponse } from 'node:http'
import type { WorkbenchVerifiedModuleIdentitySourceV1 } from './conversation-suite-contract.ts'
import { WORKBENCH_MODULE_IDENTITY_ROUTE_V1 } from './module-identity.ts'

interface IdentityRouteContext {
  get<T = unknown>(name: string, strict?: boolean): T | undefined
}

export function installWorkbenchModuleIdentityRoute(ctx: IdentityRouteContext): (() => void) | undefined {
  // These services are provided by Core's current Host fiber immediately
  // before route installation, while that fiber can still be pending.
  const server = ctx.get<{ register(route: { kind: 'exact'; path: string; handler(request: IncomingMessage, response: ServerResponse): Promise<void> }): () => void }>('webServer', false)
  const source = ctx.get<WorkbenchVerifiedModuleIdentitySourceV1>('workbenchVerifiedModuleIdentity', false)
  const ready = ctx.get<Promise<void>>('workbenchModuleStartupReady', false)
  if (server === undefined || source === undefined || ready === undefined) return undefined
  const dispose = server.register({ kind: 'exact', path: WORKBENCH_MODULE_IDENTITY_ROUTE_V1, async handler(request, response) {
    if (request.method !== 'GET') { response.writeHead(405); response.end(); return }
    // The loader and Client are separate runtimes. No Host service objects,
    // paths, receipts or capabilities are exposed across this boundary.
    const identity = await ready.then(() => source.get('workbench.conversation-suite'), () => undefined)
    const payload = identity === undefined ? null : {
      moduleId: identity.moduleId, version: identity.version, artifactDigest: identity.artifactDigest,
    }
    response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    response.end(JSON.stringify({ schemaVersion: 1, identity: payload }))
  } })
  return dispose
}
