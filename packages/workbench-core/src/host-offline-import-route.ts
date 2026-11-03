import type { IncomingMessage, ServerResponse } from 'node:http'
import { WORKBENCH_OFFLINE_IMPORT_ROUTE } from './offline-import-contract.ts'
import type { createWorkbenchHostOfflineImporter } from './host-offline-import.ts'

/** Fixed byte and identity endpoints; no author-supplied paths or package locators. */
export function installWorkbenchOfflineImportRoutes(ctx: { get<T>(name: string, strict?: boolean): T | undefined }): (() => void) | undefined {
  type Web = { register(route: { kind: 'exact'; path: string; handler(req: IncomingMessage, res: ServerResponse): Promise<void> }): () => void }
  const web = ctx.get<Web>('webServer', false)
  const importer = ctx.get<ReturnType<typeof createWorkbenchHostOfflineImporter>>('workbenchOfflineImporter', false)
  if (web === undefined || importer === undefined) return undefined
  const reply = (response: ServerResponse, status: number, value: unknown) => {
    response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    response.end(JSON.stringify(value))
  }
  const read = async (request: IncomingMessage, limit: number) => {
    const chunks: Buffer[] = []
    let size = 0
    for await (const chunk of request) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      size += bytes.length
      if (size > limit) throw new Error('Offline request exceeds limit')
      chunks.push(bytes)
    }
    return Buffer.concat(chunks, size)
  }
  const disposers = ['', '/preflight', '/complete'].map(suffix => web.register({
    kind: 'exact', path: WORKBENCH_OFFLINE_IMPORT_ROUTE + suffix,
    handler: async (request, response) => {
      try {
        await ctx.get<Promise<void>>('workbenchOfflineStartupReady', false)
        if (suffix === '' && request.method === 'GET') { reply(response, 200, { receipts: importer.list() }); return }
        if (request.method !== 'POST') { reply(response, 405, { error: 'method-not-allowed' }); return }
        if (suffix === '/complete') {
          const value = JSON.parse((await read(request, 1024)).toString('utf8')) as { packageId?: unknown; clientReady?: unknown }
          if (typeof value.packageId !== 'string' || !/^[a-f0-9]{64}$/u.test(value.packageId)
            || typeof value.clientReady !== 'boolean' || Object.keys(value).length !== 2) throw new Error('Invalid complete request')
          reply(response, 200, await importer.complete(value.packageId, value.clientReady))
        } else {
          const bytes = new Uint8Array(await read(request, 72 * 1024 * 1024))
          reply(response, 200, suffix === '' ? await importer.commit(bytes) : await importer.preflight(bytes))
        }
      } catch {
        // Filesystem and package-manager errors may contain local paths; retain
        // only fixed public diagnostics at this HTTP boundary.
        reply(response, 400, { error: '离线包验证或导入未完成，请检查模块身份、重启状态和导入回执。' })
      }
    },
  }))
  return () => { for (const dispose of disposers.reverse()) dispose() }
}
