import {
  WorkbenchExtensionInventoryReadError,
  type WorkbenchDshExtensionInventoryV1,
  type WorkbenchExtensionInventoryFailureV1,
  type WorkbenchExtensionInventoryOperationV1,
} from '../workbench-extension-access.ts'

interface DshExtensionInventoryRemoteV1 {
  readonly pluginInventory: { list(): Promise<unknown> }
  readonly pluginManager: { listBundles(): Promise<unknown> }
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 512
}

function unwrap<T>(result: unknown, operation: WorkbenchExtensionInventoryOperationV1): T {
  if (typeof result !== 'object' || result === null || !('ok' in result)) return result as T
  const remote = result as { ok: boolean; value?: T; error?: { code?: unknown; message?: unknown } }
  if (remote.ok) return remote.value as T
  const failure = new Error(typeof remote.error?.message === 'string' ? remote.error.message : `${operation} failed`)
  if (typeof remote.error?.code === 'string') Object.assign(failure, { code: remote.error.code })
  throw failure
}

function failureFor(operation: WorkbenchExtensionInventoryOperationV1, error: unknown): WorkbenchExtensionInventoryFailureV1 {
  const record = typeof error === 'object' && error !== null ? error as Record<string, unknown> : undefined
  const message = error instanceof Error ? error.message : String(error)
  return {
    operation,
    ...(typeof record?.code === 'string' ? { code: record.code.slice(0, 96) } : {}),
    message: message.slice(0, 500),
  }
}

async function read<T>(
  operation: WorkbenchExtensionInventoryOperationV1,
  request: () => Promise<unknown>,
  normalize: (value: unknown) => T,
): Promise<{ readonly value: T } | { readonly failure: WorkbenchExtensionInventoryFailureV1 }> {
  try {
    return { value: normalize(unwrap(await request(), operation)) }
  } catch (error) {
    return { failure: failureFor(operation, error) }
  }
}

/** Read and normalize the two public DSH inventories while retaining the failing RPC identity. */
export async function readDshExtensionInventoryV1(
  remote: DshExtensionInventoryRemoteV1,
): Promise<WorkbenchDshExtensionInventoryV1> {
  const [runtimeResult, bundleResult] = await Promise.all([
    read('pluginInventory.list', () => remote.pluginInventory.list(), value => {
      if (!record(value) || !Array.isArray(value.entries) || value.entries.some(entry =>
        !record(entry) || !nonEmptyString(entry.entryId) || !nonEmptyString(entry.moduleName)
        || typeof entry.enabled !== 'boolean' || !(typeof entry.fiberPhase === 'string' || entry.fiberPhase === null))) {
        throw Object.assign(new Error('DSH returned an invalid plugin inventory response.'), { code: 'invalid-response' })
      }
      return value as { entries: readonly { entryId: string; moduleName: string; enabled: boolean; fiberPhase: string | null }[] }
    }),
    read('pluginManager.listBundles', () => remote.pluginManager.listBundles(), value => {
      if (!Array.isArray(value) || value.some(bundle => !record(bundle)
        || !nonEmptyString(bundle.name)
        || (bundle.version !== undefined && typeof bundle.version !== 'string')
        || typeof bundle.installed !== 'boolean' || typeof bundle.enabled !== 'boolean'
        || !Array.isArray(bundle.rows) || bundle.rows.some(row => !record(row)
          || !nonEmptyString(row.rowId) || !nonEmptyString(row.moduleName)
          || (row.entryId !== undefined && !nonEmptyString(row.entryId))))) {
        throw Object.assign(new Error('DSH returned an invalid plugin bundle response.'), { code: 'invalid-response' })
      }
      return value as readonly { name: string; version?: string; installed: boolean; enabled: boolean;
        rows: readonly { rowId: string; moduleName: string; entryId?: string }[] }[]
    }),
  ])
  const failures = [
    ...('failure' in runtimeResult ? [runtimeResult.failure] : []),
    ...('failure' in bundleResult ? [bundleResult.failure] : []),
  ]
  if (failures.length > 0) throw new WorkbenchExtensionInventoryReadError(failures)
  const runtime = (runtimeResult as { readonly value: { entries: readonly {
    entryId: string; moduleName: string; enabled: boolean; fiberPhase: string | null
  }[] } }).value
  const bundles = (bundleResult as { readonly value: readonly {
    name: string; version?: string; installed: boolean; enabled: boolean
    rows: readonly { rowId: string; moduleName: string; entryId?: string }[]
  }[] }).value
  return {
    plugins: runtime.entries.map(entry => ({
      entryId: entry.entryId, moduleName: entry.moduleName,
      enabled: entry.enabled, fiberPhase: entry.fiberPhase,
    })),
    bundles: bundles.map(bundle => ({
      name: bundle.name, ...(bundle.version === undefined ? {} : { version: bundle.version }),
      installed: bundle.installed, enabled: bundle.enabled,
      rows: bundle.rows.map(row => ({
        rowId: row.rowId, moduleName: row.moduleName,
        ...(row.entryId === undefined ? {} : { entryId: row.entryId }),
      })),
    })),
  }
}
