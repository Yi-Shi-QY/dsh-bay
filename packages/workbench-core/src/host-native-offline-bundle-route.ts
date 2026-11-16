import type { IncomingMessage, ServerResponse } from 'node:http'
import { createHash, timingSafeEqual } from 'node:crypto'
import {
  DSH_NATIVE_OFFLINE_BUNDLE_SERVICE,
  MAX_NATIVE_OFFLINE_BUNDLE_BYTES,
  WORKBENCH_NATIVE_OFFLINE_BUNDLE_ROUTE_V1,
  type DshNativeOfflineBundleManagerV1,
  type DshNativePortableBundleOperationV1,
  type DshNativePortableBundlePreviewV1,
} from './dsh-native-offline-bundle.ts'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
const SHA256 = /^[a-f0-9]{64}$/iu

function manager(value: unknown): value is DshNativeOfflineBundleManagerV1 {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<DshNativeOfflineBundleManagerV1>
  return typeof candidate.exportPortableBundle === 'function'
    && typeof candidate.inspectPortableBundle === 'function'
    && typeof candidate.importPortableBundle === 'function'
    && typeof candidate.getPortableBundleStatus === 'function'
}

function sameOrigin(request: IncomingMessage): boolean {
  if (request.headers['sec-fetch-site'] === 'cross-site') return false
  const origin = request.headers.origin
  if (origin === undefined) return true
  const host = request.headers.host
  if (typeof host !== 'string') return false
  try { return new URL(origin).host === host } catch { return false }
}

function trustedRequest(request: IncomingMessage, managerToken: string | undefined): boolean {
  if (!sameOrigin(request)) return false
  if (managerToken === undefined) return true
  const supplied = request.headers['x-dsh-manager-token']
  if (typeof supplied !== 'string') return false
  const actual = Buffer.from(supplied)
  const expected = Buffer.from(managerToken)
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

async function readBytes(request: IncomingMessage, limit = MAX_NATIVE_OFFLINE_BUNDLE_BYTES): Promise<Uint8Array> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += bytes.byteLength
    if (size > limit) throw new Error('native offline bundle exceeds size limit')
    chunks.push(bytes)
  }
  return new Uint8Array(Buffer.concat(chunks, size))
}

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  response.end(JSON.stringify(value))
}

function validOperation(value: unknown): value is DshNativePortableBundleOperationV1 {
  if (typeof value !== 'object' || value === null) return false
  const row = value as Partial<DshNativePortableBundleOperationV1>
  return row.schemaVersion === 1 && typeof row.operationId === 'string' && UUID.test(row.operationId)
    && typeof row.phase === 'string' && ['accepted', 'preflighting', 'staging', 'creating-instance', 'ready', 'failed', 'cancelled'].includes(row.phase)
}

function validPreview(value: unknown): value is DshNativePortableBundlePreviewV1 {
  if (typeof value !== 'object' || value === null) return false
  const row = value as Partial<DshNativePortableBundlePreviewV1>
  return row.schemaVersion === 1 && typeof row.bundleId === 'string' && UUID.test(row.bundleId)
    && typeof row.name === 'string' && typeof row.version === 'string'
    && typeof row.archiveSha256 === 'string' && SHA256.test(row.archiveSha256)
    && typeof row.archiveSize === 'number' && Number.isSafeInteger(row.archiveSize) && row.archiveSize > 0
}

/**
 * Mount the optional Manager-owned Portable Bundle service.  No route is
 * mounted when the service is absent, allowing Core-only alpha2 instances to
 * report the capability as unsupported without pretending a layout archive is
 * a complete DSH Bundle.
 */
export function installWorkbenchDshNativeOfflineBundleRoutes(
  ctx: { get<T = unknown>(name: string, strict?: boolean): T | undefined },
): (() => void) | undefined {
  type Web = { register(route: { kind: 'exact'; path: string; handler(request: IncomingMessage, response: ServerResponse): Promise<void> }): () => void; tapIndex?: (transform: (html: string) => string) => () => void }
  const web = ctx.get<Web>('webServer', false)
  const native = ctx.get<unknown>(DSH_NATIVE_OFFLINE_BUNDLE_SERVICE, false)
  if (web === undefined || !manager(native)) return undefined
  const managerToken = ctx.get<string>('dshManagerBrowserToken', false)
  if (typeof managerToken !== 'string' || managerToken.length < 16) return undefined
  const route = (suffix: string) => `${WORKBENCH_NATIVE_OFFLINE_BUNDLE_ROUTE_V1}${suffix}`
  const disposers = [
    ...(web.tapIndex === undefined ? [] : [web.tapIndex(html => html.replace('</head>', '<meta name="dsh-manager-portable-bundle" content="v1"></head>'))]),
    web.register({ kind: 'exact', path: route(''), async handler(request, response) {
      if (!trustedRequest(request, managerToken)) { sendJson(response, 403, { code: 'request-untrusted', message: '此操作未通过来源校验。' }); return }
      if (request.method === 'GET') { sendJson(response, 200, { schemaVersion: 1, available: true }); return }
      if (request.method !== 'POST') { sendJson(response, 405, { code: 'method-not-allowed' }); return }
      try {
        const raw = await readBytes(request, 16 * 1024)
        const parsed = raw.byteLength === 0 ? {} : JSON.parse(Buffer.from(raw).toString('utf8')) as { distribution?: unknown }
        if (parsed.distribution !== undefined && !['thin', 'embedded', 'multi-platform'].includes(String(parsed.distribution))) throw new Error('invalid distribution')
        const result = await native.exportPortableBundle(parsed.distribution === undefined ? undefined : { distribution: parsed.distribution as 'thin' | 'embedded' | 'multi-platform' })
        if (!(result.archive instanceof Uint8Array) || result.archive.byteLength === 0 || result.archive.byteLength > MAX_NATIVE_OFFLINE_BUNDLE_BYTES) throw new Error('invalid native bundle archive')
        const archiveSha256 = createHash('sha256').update(result.archive).digest('hex')
        if (result.archiveSha256 !== undefined && result.archiveSha256.toLowerCase() !== archiveSha256) throw new Error('native bundle digest mismatch')
        response.writeHead(200, { 'content-type': 'application/octet-stream', 'cache-control': 'no-store', 'content-length': result.archive.byteLength,
          ...(result.filename === undefined ? {} : { 'x-dsh-bundle-filename': result.filename.slice(0, 160) }),
          ...(result.bundleId === undefined || !UUID.test(result.bundleId) ? {} : { 'x-dsh-bundle-id': result.bundleId }),
          'x-dsh-bundle-sha256': archiveSha256,
        })
        response.end(Buffer.from(result.archive))
      } catch { sendJson(response, 400, { code: 'native-bundle-export-failed', message: 'DSH 原生离线包导出未完成。' }) }
    } }),
    web.register({ kind: 'exact', path: route('/inspect'), async handler(request, response) {
      if (!trustedRequest(request, managerToken)) { sendJson(response, 403, { code: 'request-untrusted', message: '此操作未通过来源校验。' }); return }
      if (request.method !== 'POST') { sendJson(response, 405, { code: 'method-not-allowed' }); return }
      try {
        const result = await native.inspectPortableBundle(await readBytes(request))
        if (!validPreview(result)) throw new Error('invalid native bundle preview')
        sendJson(response, 200, result)
      } catch { sendJson(response, 400, { code: 'native-bundle-invalid', message: 'DSH 原生离线包无效或无法验证。' }) }
    } }),
    web.register({ kind: 'exact', path: route('/import'), async handler(request, response) {
      if (!trustedRequest(request, managerToken)) { sendJson(response, 403, { code: 'request-untrusted', message: '此操作未通过来源校验。' }); return }
      if (request.method !== 'POST') { sendJson(response, 405, { code: 'method-not-allowed' }); return }
      try {
        const trustDecisionId = request.headers['x-dsh-bundle-trust-decision']
        const result = await native.importPortableBundle(await readBytes(request), typeof trustDecisionId === 'string' ? { trustDecisionId } : {})
        if (!validOperation(result)) throw new Error('invalid native bundle operation')
        sendJson(response, 202, result)
      } catch { sendJson(response, 400, { code: 'native-bundle-import-failed', message: 'DSH 原生离线包导入未完成。' }) }
    } }),
    web.register({ kind: 'exact', path: route('/status'), async handler(request, response) {
      if (!trustedRequest(request, managerToken)) { sendJson(response, 403, { code: 'request-untrusted', message: '此操作未通过来源校验。' }); return }
      if (request.method !== 'GET') { sendJson(response, 405, { code: 'method-not-allowed' }); return }
      try {
        const url = new URL(request.url ?? '', `http://${String(request.headers.host ?? '127.0.0.1')}`)
        const operationId = url.searchParams.get('operationId')
        if ([...url.searchParams.keys()].length !== 1 || operationId === null || !UUID.test(operationId)) throw new Error('invalid operation id')
        const result = await native.getPortableBundleStatus(operationId)
        if (!validOperation(result) || result.operationId !== operationId) throw new Error('operation not found')
        sendJson(response, 200, result)
      } catch { sendJson(response, 404, { code: 'native-bundle-operation-not-found', message: 'DSH 原生离线包操作记录不存在。' }) }
    } }),
  ]
  return () => { for (const dispose of disposers.reverse()) dispose() }
}
