import type { IncomingMessage, ServerResponse } from 'node:http'
import type { WorkbenchInstallTransactionSnapshotV1 } from './install-coordinator.ts'
import { validateWorkbenchModuleSourceRequest, type WorkbenchModuleSourceRequestV1 } from './module-source.ts'
import { WORKBENCH_DIRECT_SOURCE_INSTALL_ROUTE_V1 } from './browser-module-install.ts'
import { workbenchUserError } from './user-error.ts'

const MAX_REQUEST_BYTES = 16 * 1024

export interface WorkbenchHostDirectSourceInstallServiceV1 {
  commit(input: { readonly source: WorkbenchModuleSourceRequestV1; readonly confirmSourceChange?: boolean }): Promise<WorkbenchInstallTransactionSnapshotV1>
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []; let size = 0
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += bytes.byteLength
    if (size > MAX_REQUEST_BYTES) throw new Error('source-not-allowed')
    chunks.push(bytes)
  }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, size))) as unknown
}

function input(value: unknown): { readonly source: WorkbenchModuleSourceRequestV1; readonly confirmSourceChange?: boolean } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('source-not-allowed')
  const row = value as Record<string, unknown>
  if (Object.keys(row).some(key => !['schemaVersion', 'source', 'confirmSourceChange'].includes(key)) || row.schemaVersion !== 1 || !validateWorkbenchModuleSourceRequest(row.source)
    || (row.confirmSourceChange !== undefined && row.confirmSourceChange !== true)) throw new Error('source-not-allowed')
  return { source: row.source, ...(row.confirmSourceChange === true ? { confirmSourceChange: true } : {}) }
}

function send(response: ServerResponse, status: number, value: unknown): void {
  const bytes = Buffer.from(JSON.stringify(value), 'utf8')
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': bytes.byteLength, 'cache-control': 'no-store' })
  response.end(bytes)
}

export function installWorkbenchHostDirectSourceInstallRoute(
  ctx: { get<T = unknown>(name: string, strict?: boolean): T | undefined },
  serviceName = 'workbenchHostDirectSourceInstaller',
): (() => void) | undefined {
  const server = ctx.get<{ register(route: { kind: 'exact'; path: string; handler(request: IncomingMessage, response: ServerResponse): Promise<void> }): () => void }>('webServer', false)
  const service = ctx.get<WorkbenchHostDirectSourceInstallServiceV1>(serviceName, false)
  if (server === undefined || service === undefined) return undefined
  const off = server.register({ kind: 'exact', path: WORKBENCH_DIRECT_SOURCE_INSTALL_ROUTE_V1, async handler(request, response) {
    if (request.method !== 'POST') { send(response, 405, { error: 'source-not-allowed', message: '只允许提交结构化来源请求。', nextAction: '使用 POST 提交来源。' }); return }
    if (request.headers['sec-fetch-site'] === 'cross-site'
      || request.headers['content-type'] !== 'application/json'
      || (request.headers.origin !== undefined && request.headers.host !== undefined && (() => { try { return new URL(request.headers.origin).host !== request.headers.host } catch { return true } })())) {
      send(response, 403, { error: 'source-not-allowed', message: '此来源请求未通过同源校验。', nextAction: '请从当前 DSH 的扩展中心发起操作。' }); return
    }
    try { send(response, 200, { schemaVersion: 1, transaction: await service.commit(input(await readJson(request))) }) }
    catch (error) { const result = workbenchUserError(error instanceof Error ? error.message : undefined, 'source-resolution-failed'); send(response, 400, { ...result, error: result.code }) }
  } })
  return off
}
