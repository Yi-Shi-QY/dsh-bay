export const WORKBENCH_WINDOW_CONTROLLER_SERVICE_NAME = 'workbenchWindowController'

export interface WorkbenchWindowRequestV1 {
  readonly workbenchId: string
  readonly status: 'preparing' | 'prepared' | 'requested' | 'redeemed' | 'ready' | 'reclaiming' | 'reclaimed' | 'closed' | 'failed' | 'expired'
  readonly windowId?: string
  readonly code?: string
  readonly runtimeMetrics?: Readonly<Record<string, unknown>>
}

export interface WorkbenchWindowSnapshotV1 {
  readonly supported: boolean
  readonly windows: readonly {
    readonly windowId: string
    readonly workbenchId: string
    readonly focused: boolean
  }[]
  /** Per-workbench handoff state. `request` remains as a compatibility alias. */
  readonly requests?: readonly WorkbenchWindowRequestV1[]
  readonly request?: WorkbenchWindowRequestV1
}

export type WorkbenchWindowOpenResultV1 =
  | { readonly status: 'requested'; readonly carrier: 'browser' | 'dsh-native' | 'electron-child' }
  | { readonly status: 'opened'; readonly windowId: string }
  | { readonly status: 'unsupported' | 'failed'; readonly code: string }

export type WorkbenchWindowActionResultV1 =
  | { readonly status: 'focused' | 'closed' }
  | { readonly status: 'failed'; readonly code: string }

/** Host-owned window lifecycle. Layout and Session ownership stay with DSH and Core. */
export interface WorkbenchWindowControllerV1 {
  /** Must return the same immutable object until the host publishes a change. */
  getSnapshot(): WorkbenchWindowSnapshotV1
  /** Prepare the authenticated browser URL before the user clicks the open command. */
  prepare?(workbenchId: string): Promise<boolean>
  open(workbenchId: string, popup?: Window | null): Promise<WorkbenchWindowOpenResultV1>
  reclaim?(workbenchId: string): Promise<{ readonly status: 'reclaimed' | 'failed'; readonly code?: string }>
  focus(windowId: string): Promise<WorkbenchWindowActionResultV1>
  close(windowId: string): Promise<WorkbenchWindowActionResultV1>
  subscribe(listener: () => void): () => void
}

const UNSUPPORTED_SNAPSHOT: WorkbenchWindowSnapshotV1 = Object.freeze({
  supported: false,
  windows: Object.freeze([]),
})

const UNSUPPORTED_CONTROLLER: WorkbenchWindowControllerV1 = Object.freeze({
  getSnapshot: () => UNSUPPORTED_SNAPSHOT,
  open: async () => ({ status: 'unsupported' as const, code: 'host-window-api-unavailable' }),
  reclaim: async () => ({ status: 'failed' as const, code: 'host-window-api-unavailable' }),
  focus: async () => ({ status: 'failed' as const, code: 'host-window-api-unavailable' }),
  close: async () => ({ status: 'failed' as const, code: 'host-window-api-unavailable' }),
  subscribe: () => () => {},
})
const normalizedSnapshots = new WeakMap<object, WorkbenchWindowSnapshotV1>()

export function unsupportedWorkbenchWindowController(): WorkbenchWindowControllerV1 {
  return UNSUPPORTED_CONTROLLER
}

export function resolveWorkbenchWindowController(value: unknown): WorkbenchWindowControllerV1 {
  if (typeof value !== 'object' || value === null) return UNSUPPORTED_CONTROLLER
  const candidate = value as Partial<WorkbenchWindowControllerV1>
  return typeof candidate.getSnapshot === 'function'
    && typeof candidate.open === 'function'
    && typeof candidate.focus === 'function'
    && typeof candidate.close === 'function'
    && typeof candidate.subscribe === 'function'
    ? candidate as WorkbenchWindowControllerV1
    : UNSUPPORTED_CONTROLLER
}

export function normalizeWorkbenchWindowSnapshot(value: unknown): WorkbenchWindowSnapshotV1 {
  if (typeof value !== 'object' || value === null) return UNSUPPORTED_SNAPSHOT
  const cached = normalizedSnapshots.get(value)
  if (cached !== undefined) return cached
  const snapshot = value as Partial<WorkbenchWindowSnapshotV1>
  if (Object.keys(snapshot).some(key => key !== 'supported' && key !== 'windows' && key !== 'request' && key !== 'requests')
    || snapshot.supported !== true || !Array.isArray(snapshot.windows)) return UNSUPPORTED_SNAPSHOT
  const seen = new Set<string>()
  const windows = []
  for (const row of snapshot.windows) {
    if (typeof row !== 'object' || row === null
      || Object.keys(row).some(key => key !== 'windowId' && key !== 'workbenchId' && key !== 'focused')
      || typeof row.windowId !== 'string' || row.windowId.length === 0
      || typeof row.workbenchId !== 'string' || row.workbenchId.length === 0
      || typeof row.focused !== 'boolean' || seen.has(row.windowId)) return UNSUPPORTED_SNAPSHOT
    seen.add(row.windowId)
    windows.push(Object.freeze({ windowId: row.windowId, workbenchId: row.workbenchId, focused: row.focused }))
  }
  const statuses: readonly WorkbenchWindowRequestV1['status'][] = [
    'preparing', 'prepared', 'requested', 'redeemed', 'ready', 'reclaiming', 'reclaimed', 'closed', 'failed', 'expired',
  ]
  const normalizeRequest = (value: unknown): WorkbenchWindowRequestV1 | undefined => {
    if (typeof value !== 'object' || value === null) return undefined
    const row = value as Partial<WorkbenchWindowRequestV1>
    if (Object.keys(row).some(key => key !== 'workbenchId' && key !== 'status' && key !== 'windowId' && key !== 'code' && key !== 'runtimeMetrics')
      || typeof row.workbenchId !== 'string' || row.workbenchId.length === 0
      || !statuses.includes(row.status as WorkbenchWindowRequestV1['status'])
      || (row.windowId !== undefined && (typeof row.windowId !== 'string' || !/^[A-Za-z0-9-]{36}$/u.test(row.windowId)))
      || (row.code !== undefined && typeof row.code !== 'string')
      || (row.runtimeMetrics !== undefined && (typeof row.runtimeMetrics !== 'object' || row.runtimeMetrics === null || Array.isArray(row.runtimeMetrics)))) return undefined
    return Object.freeze({ workbenchId: row.workbenchId, status: row.status as WorkbenchWindowRequestV1['status'],
      ...(row.windowId === undefined ? {} : { windowId: row.windowId }),
      ...(row.code === undefined ? {} : { code: row.code }),
      ...(row.runtimeMetrics === undefined ? {} : { runtimeMetrics: Object.freeze({ ...row.runtimeMetrics }) }) })
  }
  const request = snapshot.request === undefined ? undefined : normalizeRequest(snapshot.request)
  if (snapshot.request !== undefined && request === undefined) return UNSUPPORTED_SNAPSHOT
  let requests: readonly WorkbenchWindowRequestV1[] | undefined
  if (snapshot.requests !== undefined) {
    if (!Array.isArray(snapshot.requests)) return UNSUPPORTED_SNAPSHOT
    const rows = snapshot.requests.map(normalizeRequest)
    const requestIds = new Set<string>()
    for (const row of rows) {
      if (row === undefined || requestIds.has(row.workbenchId)) return UNSUPPORTED_SNAPSHOT
      requestIds.add(row.workbenchId)
    }
    requests = Object.freeze(rows as WorkbenchWindowRequestV1[])
  }
  const normalized = Object.freeze({ supported: true, windows: Object.freeze(windows),
    ...(requests === undefined ? {} : { requests }), ...(request === undefined ? {} : { request }) })
  normalizedSnapshots.set(value, normalized)
  return normalized
}
