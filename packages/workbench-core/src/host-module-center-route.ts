import type { IncomingMessage, ServerResponse } from 'node:http'
import type { WorkbenchModuleCenterFactsV1 } from './browser-module-center.ts'
import { WORKBENCH_CATALOG_ARCHIVE_ROUTE_V1, WORKBENCH_MODULE_CENTER_ROUTE_V1 } from './browser-module-center.ts'

export interface WorkbenchHostModuleCenterV1 {
  facts(): Promise<WorkbenchModuleCenterFactsV1>
  archive(): Promise<Uint8Array | undefined>
  retain(bytes: Uint8Array): Promise<void>
}

export function installWorkbenchModuleCenterRoutes(ctx: { get<T = unknown>(name: string, strict?: boolean): T | undefined }): (() => void) | undefined {
  const server = ctx.get<{ register(route: { kind: 'exact'; path: string; handler(request: IncomingMessage, response: ServerResponse): Promise<void> }): () => void }>('webServer', false)
  const service = ctx.get<WorkbenchHostModuleCenterV1>('workbenchHostModuleCenter', false)
  if (server === undefined || service === undefined) return undefined
  const send = (response: ServerResponse, status: number, value: unknown) => {
    response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    response.end(JSON.stringify(value))
  }
  const offFacts = server.register({ kind: 'exact', path: WORKBENCH_MODULE_CENTER_ROUTE_V1, async handler(request, response) {
    if (request.method !== 'GET') { send(response, 405, { error: 'method-not-allowed' }); return }
    try { send(response, 200, await service.facts()) }
    catch { send(response, 503, { error: 'Workbench Module status unavailable' }) }
  } })
  const offArchive = server.register({ kind: 'exact', path: WORKBENCH_CATALOG_ARCHIVE_ROUTE_V1, async handler(request, response) {
    try {
      if (request.method === 'GET') {
        const bytes = await service.archive()
        if (bytes === undefined) { send(response, 404, { error: 'No retained Catalog' }); return }
        response.writeHead(200, { 'content-type': 'application/zip', 'cache-control': 'no-store', 'content-length': bytes.byteLength })
        response.end(bytes)
        return
      }
      if (request.method !== 'POST') { send(response, 405, { error: 'method-not-allowed' }); return }
      if (request.headers['sec-fetch-site'] === 'cross-site'
        || request.headers['content-type'] !== 'application/octet-stream'
        || (request.headers.origin !== undefined && new URL(request.headers.origin).host !== request.headers.host)) {
        send(response, 403, { error: 'Same-origin archive bytes required' }); return
      }
      const chunks: Buffer[] = []
      let size = 0
      for await (const chunk of request) {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
        size += bytes.byteLength
        if (size > 64 * 1024 * 1024) throw new Error('Archive too large')
        chunks.push(bytes)
      }
      await service.retain(new Uint8Array(Buffer.concat(chunks, size)))
      send(response, 200, { schemaVersion: 1 })
    } catch { send(response, 400, { error: 'Workbench Catalog retention or verification failed' }) }
  } })
  return () => { offArchive(); offFacts() }
}
