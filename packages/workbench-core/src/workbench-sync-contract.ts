import type { WorkbenchSyncStatus } from './workbench-sync.ts'

export const WORKBENCH_SYNC_ROUTE = '/api/workbench/sync/v1'

export type WorkbenchSyncProviderKind = 'none' | 'folder' | 'webdav'

export interface WorkbenchSyncConfigV1 {
  schemaVersion: 1
  provider: WorkbenchSyncProviderKind
  /** Local/network folder path or WebDAV base URL. Credentials are external. */
  remote: string
  enabled: boolean
  intervalMinutes: number
  debounceMs: number
}

export interface WorkbenchSyncStateV1 {
  status: WorkbenchSyncStatus | 'local'
  updatedAt: number
  lastSyncedAt?: number
  localSnapshotId?: string
  remoteSnapshotId?: string
  pendingSnapshotId?: string
  error?: string
}

export interface WorkbenchSyncSettingsV1 {
  schemaVersion: 1
  config: WorkbenchSyncConfigV1
  state: WorkbenchSyncStateV1
}

export interface WorkbenchSyncResponseV1 {
  config: WorkbenchSyncConfigV1
  state: WorkbenchSyncStateV1
}

export const DEFAULT_WORKBENCH_SYNC_CONFIG: WorkbenchSyncConfigV1 = {
  schemaVersion: 1,
  provider: 'none',
  remote: '',
  enabled: false,
  intervalMinutes: 30,
  debounceMs: 1500,
}

export function normalizeWorkbenchSyncConfig(value: unknown): WorkbenchSyncConfigV1 {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('sync config must be an object')
  const candidate = value as Partial<WorkbenchSyncConfigV1>
  if (candidate.schemaVersion !== 1 || !['none', 'folder', 'webdav'].includes(candidate.provider as string)) throw new Error('unsupported sync config')
  if (typeof candidate.remote !== 'string' || candidate.remote.length > 4096) throw new Error('sync remote is invalid')
  if (typeof candidate.enabled !== 'boolean') throw new Error('sync enabled flag is invalid')
  if (!Number.isInteger(candidate.intervalMinutes) || candidate.intervalMinutes! < 1 || candidate.intervalMinutes! > 7 * 24 * 60) throw new Error('sync interval is invalid')
  if (!Number.isInteger(candidate.debounceMs) || candidate.debounceMs! < 250 || candidate.debounceMs! > 60_000) throw new Error('sync debounce is invalid')
  const provider = candidate.provider!
  if (provider !== 'none' && candidate.remote!.trim().length === 0) throw new Error('sync remote is required')
  if (provider === 'webdav' && !/^https?:\/\//iu.test(candidate.remote!)) throw new Error('WebDAV remote must be an http(s) URL')
  return { schemaVersion: 1, provider, remote: candidate.remote!.trim(), enabled: candidate.enabled!, intervalMinutes: candidate.intervalMinutes!, debounceMs: candidate.debounceMs! }
}
