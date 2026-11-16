/**
 * Structural contract for the DSH Manager Portable Bundle seam.
 *
 * DSH 0.1.6's PluginManager owns Profile package operations.  A complete
 * `.dshbundle` (Runtime, sanitized Instance and extensions) belongs to DSH
 * Manager.  Workbench only consumes this contract and never receives paths,
 * process handles, or package-manager commands.
 */
export interface DshNativePortableBundleExportV1 {
  readonly archive: Uint8Array
  readonly filename?: string
  readonly bundleId?: string
  readonly archiveSha256?: string
  readonly archiveSize?: number
}

export interface DshNativePortableBundlePreviewV1 {
  readonly schemaVersion: 1
  readonly bundleId: string
  readonly name: string
  readonly version: string
  readonly publisherName?: string
  readonly publisherKeyId?: string
  readonly archiveSha256: string
  readonly archiveSize: number
  readonly runtimeDistribution?: 'thin' | 'embedded' | 'multi-platform' | string
  readonly runtimeArtifactId?: string
  readonly extensionCount?: number
  readonly requiredInputCount?: number
}

export type DshNativePortableBundleOperationPhaseV1 =
  | 'accepted'
  | 'preflighting'
  | 'staging'
  | 'creating-instance'
  | 'ready'
  | 'failed'
  | 'cancelled'

export interface DshNativePortableBundleOperationV1 {
  readonly schemaVersion: 1
  readonly operationId: string
  readonly phase: DshNativePortableBundleOperationPhaseV1
  readonly bundleId?: string
  readonly instanceId?: string
  readonly diagnosticCode?: string
  readonly message?: string
}

export interface DshNativePortableBundleImportOptionsV1 {
  /** The Manager owns trust decisions; this is an opaque, user-confirmed id. */
  readonly trustDecisionId?: string
}

/** Host-only Manager implementation, discovered from a DSH Context service. */
export interface DshNativeOfflineBundleManagerV1 {
  exportPortableBundle(options?: { readonly distribution?: 'thin' | 'embedded' | 'multi-platform' }): Promise<DshNativePortableBundleExportV1>
  inspectPortableBundle(archive: Uint8Array): Promise<DshNativePortableBundlePreviewV1>
  importPortableBundle(archive: Uint8Array, options?: DshNativePortableBundleImportOptionsV1): Promise<DshNativePortableBundleOperationV1>
  getPortableBundleStatus(operationId: string): Promise<DshNativePortableBundleOperationV1>
}

export interface DshNativeOfflineBundleAdapterV1 {
  readonly status: 'available'
  exportPortableBundle(options?: { readonly distribution?: 'thin' | 'embedded' | 'multi-platform' }): Promise<DshNativePortableBundleExportV1>
  inspectPortableBundle(archive: Uint8Array): Promise<DshNativePortableBundlePreviewV1>
  importPortableBundle(archive: Uint8Array, options?: DshNativePortableBundleImportOptionsV1): Promise<DshNativePortableBundleOperationV1>
  getPortableBundleStatus(operationId: string): Promise<DshNativePortableBundleOperationV1>
}

export interface DshNativeOfflineBundleUnavailableV1 {
  readonly status: 'unsupported'
  readonly reason: 'manager-bridge-unavailable'
}

export const DSH_NATIVE_OFFLINE_BUNDLE_SERVICE = 'workbenchDshNativeOfflineBundle'
export const WORKBENCH_NATIVE_OFFLINE_BUNDLE_ROUTE_V1 = '/api/workbench/native-offline-bundle/v1'
export const MAX_NATIVE_OFFLINE_BUNDLE_BYTES = 512 * 1024 * 1024

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
const SHA256 = /^[a-f0-9]{64}$/iu

function isManager(value: unknown): value is DshNativeOfflineBundleManagerV1 {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<DshNativeOfflineBundleManagerV1>
  return typeof candidate.exportPortableBundle === 'function'
    && typeof candidate.inspectPortableBundle === 'function'
    && typeof candidate.importPortableBundle === 'function'
    && typeof candidate.getPortableBundleStatus === 'function'
}

/** Adapt a Manager-provided service without importing Manager packages. */
export function createWorkbenchDshNativeOfflineBundleAdapterV1(
  manager: unknown,
): DshNativeOfflineBundleAdapterV1 | DshNativeOfflineBundleUnavailableV1 {
  if (!isManager(manager)) return { status: 'unsupported', reason: 'manager-bridge-unavailable' }
  return {
    status: 'available',
    exportPortableBundle: options => manager.exportPortableBundle(options),
    inspectPortableBundle: archive => manager.inspectPortableBundle(new Uint8Array(archive)),
    importPortableBundle: (archive, options) => manager.importPortableBundle(new Uint8Array(archive), options),
    getPortableBundleStatus: operationId => manager.getPortableBundleStatus(operationId),
  }
}

function isOperation(value: unknown): value is DshNativePortableBundleOperationV1 {
  if (typeof value !== 'object' || value === null) return false
  const row = value as Partial<DshNativePortableBundleOperationV1>
  return row.schemaVersion === 1 && typeof row.operationId === 'string' && UUID.test(row.operationId)
    && typeof row.phase === 'string' && ['accepted', 'preflighting', 'staging', 'creating-instance', 'ready', 'failed', 'cancelled'].includes(row.phase)
}

function isPreview(value: unknown): value is DshNativePortableBundlePreviewV1 {
  if (typeof value !== 'object' || value === null) return false
  const row = value as Partial<DshNativePortableBundlePreviewV1>
  return row.schemaVersion === 1 && typeof row.bundleId === 'string' && UUID.test(row.bundleId)
    && typeof row.name === 'string' && typeof row.version === 'string'
    && typeof row.archiveSha256 === 'string' && SHA256.test(row.archiveSha256)
    && typeof row.archiveSize === 'number' && Number.isSafeInteger(row.archiveSize) && row.archiveSize > 0
}

/** Browser bridge; only created when Manager advertises the capability meta. */
export interface WorkbenchDshNativeOfflineBundleBridgeV1 extends DshNativeOfflineBundleAdapterV1 {}

export function createWorkbenchDshNativeOfflineBundleBridgeV1(fetcher: typeof fetch = fetch): WorkbenchDshNativeOfflineBundleBridgeV1 | undefined {
  const doc = globalThis.document
  if (doc?.querySelector?.('meta[name="dsh-manager-portable-bundle"]')?.getAttribute('content') !== 'v1') return undefined
  const base = WORKBENCH_NATIVE_OFFLINE_BUNDLE_ROUTE_V1
  const managerToken = doc?.querySelector?.('meta[name="dsh-manager-token"]')?.getAttribute('content') ?? undefined
  const tokenHeaders = managerToken === undefined ? {} : { 'x-dsh-manager-token': managerToken }
  const checked = async (response: Response): Promise<Response> => {
    if (!response.ok) {
      const payload = await response.json().catch(() => undefined) as { message?: unknown } | undefined
      throw new Error(typeof payload?.message === 'string' ? payload.message : 'DSH 原生离线包操作失败。')
    }
    return response
  }
  return {
    status: 'available',
    async exportPortableBundle(options) {
      const response = await checked(await fetcher(base, { method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: { 'content-type': 'application/json', ...tokenHeaders }, body: JSON.stringify(options ?? {}) }))
      const archive = new Uint8Array(await response.arrayBuffer())
      if (archive.byteLength === 0 || archive.byteLength > MAX_NATIVE_OFFLINE_BUNDLE_BYTES) throw new Error('DSH 原生离线包大小无效。')
      const filename = response.headers.get('x-dsh-bundle-filename') ?? undefined
      const bundleId = response.headers.get('x-dsh-bundle-id') ?? undefined
      const archiveSha256 = response.headers.get('x-dsh-bundle-sha256') ?? undefined
      return { archive, ...(filename === undefined ? {} : { filename }), ...(bundleId === undefined ? {} : { bundleId }), ...(archiveSha256 === undefined ? {} : { archiveSha256 }), archiveSize: archive.byteLength }
    },
    async inspectPortableBundle(archive) {
      const value = await (await checked(await fetcher(`${base}/inspect`, { method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: { 'content-type': 'application/octet-stream', ...tokenHeaders }, body: new Uint8Array(archive).buffer }))).json() as unknown
      if (!isPreview(value)) throw new Error('DSH 原生离线包预览无效。')
      return value
    },
    async importPortableBundle(archive, options) {
      const headers: Record<string, string> = { 'content-type': 'application/octet-stream', ...tokenHeaders }
      if (options?.trustDecisionId !== undefined) headers['x-dsh-bundle-trust-decision'] = options.trustDecisionId
      const value = await (await checked(await fetcher(`${base}/import`, { method: 'POST', credentials: 'same-origin', cache: 'no-store', headers, body: new Uint8Array(archive).buffer }))).json() as unknown
      if (!isOperation(value)) throw new Error('DSH 原生离线包操作回执无效。')
      return value
    },
    async getPortableBundleStatus(operationId) {
      if (!UUID.test(operationId)) throw new Error('DSH 原生离线包操作标识无效。')
      const value = await (await checked(await fetcher(`${base}/status?operationId=${encodeURIComponent(operationId)}`, { credentials: 'same-origin', cache: 'no-store', headers: tokenHeaders }))).json() as unknown
      if (!isOperation(value) || value.operationId !== operationId) throw new Error('DSH 原生离线包操作记录无效。')
      return value
    },
  }
}
