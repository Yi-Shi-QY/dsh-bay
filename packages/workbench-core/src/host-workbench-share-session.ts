import { createHash, randomBytes } from 'node:crypto'
import { SHARED_CONTROL_GRANT, parseWorkbenchGrant, isGrantReduction, type WorkbenchGrant } from './workbench-access-contract.ts'

const SHARE_TOKEN_BYTES = 32
const LEASE_TOKEN_BYTES = 32
const MAX_GUESTS = 5
const STOPPED_COOKIE_TOMBSTONE_MS = 30_000

export interface WorkbenchShareViewLeaseV1 {
  readonly leaseId: string
  readonly workbenchId: string
  readonly createdAt: number
  nickname: string
  ip?: string
  device?: string
  lastSeenAt: number
  websocketState: 'disconnected' | 'connected' | 'reconnecting'
  websocketReconnects: number
  rttMs?: number
  lastErrorAt?: number
  readonly shareTokenHash: string
  readonly cookieHash: string
  nativeView?: { readonly windowId: string; readonly closeToken: string }
  ownerCookie?: string
  accessToken?: string
}

export interface WorkbenchShareSessionV1 {
  readonly shareTokenHash: string
  readonly workbenchId: string
  readonly bindHost: string
  readonly port: number
  readonly createdAt: number
  readonly leases: Map<string, WorkbenchShareViewLeaseV1>
  grant: WorkbenchGrant
  grantRevision: number
}

export interface WorkbenchShareSessionManagerOptionsV1 {
  readonly now?: () => number
  readonly maxGuests?: number
  readonly randomToken?: () => string
}

export type WorkbenchShareCookieStateV1 =
  | { readonly status: 'active'; readonly lease: WorkbenchShareViewLeaseV1; readonly session: WorkbenchShareSessionV1 }
  | { readonly status: 'stopped' | 'kicked' }

export interface WorkbenchShareGuestSnapshotV1 {
  readonly leaseId: string
  readonly nickname: string
  readonly ip?: string
  readonly device?: string
  readonly createdAt: number
  readonly lastSeenAt: number
  readonly websocketState: WorkbenchShareViewLeaseV1['websocketState']
  readonly websocketReconnects: number
  readonly rttMs?: number
  readonly lastErrorAt?: number
  readonly connectionQuality: 'good' | 'fair' | 'unstable' | 'unknown'
}

function connectionQualityFor(lease: WorkbenchShareViewLeaseV1): WorkbenchShareGuestSnapshotV1['connectionQuality'] {
  if (lease.rttMs === undefined) return 'unknown'
  if (lease.websocketReconnects > 0 || lease.lastErrorAt !== undefined || lease.rttMs > 300) return 'unstable'
  if (lease.rttMs >= 100) return 'fair'
  return 'good'
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function token(randomToken: () => string): string {
  return randomToken()
}

function validId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,160}$/u.test(value)
}

/**
 * In-memory bearer-link and guest lease authority for one Host process.
 * Raw tokens are returned only to the caller that creates a link; all maps
 * retain hashes so a heap snapshot cannot directly reveal a usable link.
 */
export function createWorkbenchShareSessionManager(options: WorkbenchShareSessionManagerOptionsV1 = {}) {
  const now = options.now ?? Date.now
  const maxGuests = options.maxGuests ?? MAX_GUESTS
  const randomToken = options.randomToken ?? (() => randomBytes(SHARE_TOKEN_BYTES).toString('base64url'))
  const sessions = new Map<string, WorkbenchShareSessionV1>()
  const byWorkbench = new Map<string, WorkbenchShareSessionV1>()
  const byShareToken = new Map<string, WorkbenchShareSessionV1>()
  const byCookie = new Map<string, WorkbenchShareViewLeaseV1>()
  const revokedCookies = new Map<string, { revokedAt: number; status: 'stopped' | 'kicked' }>()
  let disposed = false

  const pruneStoppedCookies = (): void => {
    const cutoff = now() - STOPPED_COOKIE_TOMBSTONE_MS
    for (const [cookieHash, revoked] of revokedCookies) {
      if (revoked.revokedAt < cutoff) revokedCookies.delete(cookieHash)
    }
  }

  const createLease = (session: WorkbenchShareSessionV1, metadata: { readonly ip?: string; readonly userAgent?: string } = {}): { lease: WorkbenchShareViewLeaseV1; cookie: string } | { error: string } => {
    if (session.leases.size >= maxGuests) return { error: 'workbench-share-guest-limit-reached' }
    const cookie = token(randomToken)
    const leaseId = token(randomToken)
    const lease: WorkbenchShareViewLeaseV1 = {
      leaseId, workbenchId: session.workbenchId, createdAt: now(),
      nickname: `访客-${leaseId.slice(0, 4)}`,
      ...(metadata.ip === undefined ? {} : { ip: metadata.ip }),
      ...(metadata.userAgent === undefined ? {} : { device: metadata.userAgent }),
      lastSeenAt: now(), websocketState: 'disconnected', websocketReconnects: 0,
      shareTokenHash: session.shareTokenHash, cookieHash: digest(cookie),
    }
    session.leases.set(lease.leaseId, lease)
    byCookie.set(lease.cookieHash, lease)
    return { lease, cookie }
  }

  const removeLease = (lease: WorkbenchShareViewLeaseV1): void => {
    const session = byShareToken.get(lease.shareTokenHash)
    session?.leases.delete(lease.leaseId)
    byCookie.delete(lease.cookieHash)
  }

  const updateGuest = (lease: WorkbenchShareViewLeaseV1, patch: {
    readonly ip?: string
    readonly device?: string
    readonly lastSeenAt?: number
    readonly websocketState?: WorkbenchShareViewLeaseV1['websocketState']
    readonly websocketReconnects?: number
    readonly rttMs?: number
    readonly lastErrorAt?: number
  }): void => {
    if (patch.ip !== undefined) lease.ip = patch.ip
    if (patch.device !== undefined) lease.device = patch.device
    if (patch.lastSeenAt !== undefined) lease.lastSeenAt = patch.lastSeenAt
    if (patch.websocketState !== undefined) lease.websocketState = patch.websocketState
    if (patch.websocketReconnects !== undefined) lease.websocketReconnects = patch.websocketReconnects
    if (patch.rttMs !== undefined) lease.rttMs = patch.rttMs
    if (patch.lastErrorAt !== undefined) lease.lastErrorAt = patch.lastErrorAt
  }

  const setNickname = (workbenchId: string, leaseId: string, nickname: string): boolean => {
    const session = byWorkbench.get(workbenchId)
    const lease = session?.leases.get(leaseId)
    if (lease === undefined) return false
    lease.nickname = nickname
    lease.lastSeenAt = now()
    return true
  }

  const revokeLease = (workbenchId: string, leaseId: string, status: 'kicked' | 'stopped' = 'kicked'): WorkbenchShareViewLeaseV1 | undefined => {
    const session = byWorkbench.get(workbenchId)
    const lease = session?.leases.get(leaseId)
    if (lease === undefined) return undefined
    session!.leases.delete(leaseId)
    byCookie.delete(lease.cookieHash)
    revokedCookies.set(lease.cookieHash, { revokedAt: now(), status })
    return lease
  }

  const start = (workbenchId: string, bindHost: string, port: number, url: string, grant: WorkbenchGrant = SHARED_CONTROL_GRANT) => {
    if (disposed) return { ok: false as const, error: 'workbench-share-manager-disposed' }
    if (!validId(workbenchId)) return { ok: false as const, error: 'invalid-workbench-id' }
    const existing = byWorkbench.get(workbenchId)
    if (existing !== undefined) {
      return { ok: true as const, status: 'already-active' as const, session: existing, url }
    }
    const raw = token(randomToken)
    const session: WorkbenchShareSessionV1 = {
      shareTokenHash: digest(raw), workbenchId, bindHost, port, createdAt: now(), leases: new Map(),
      grant: parseWorkbenchGrant(grant), grantRevision: 1,
    }
    sessions.set(session.shareTokenHash, session)
    byWorkbench.set(workbenchId, session)
    byShareToken.set(session.shareTokenHash, session)
    return { ok: true as const, status: 'started' as const, session, token: raw, url }
  }

  const findByToken = (raw: string): WorkbenchShareSessionV1 | undefined => {
    if (disposed || !/^[A-Za-z0-9_-]{40,64}$/u.test(raw)) return undefined
    return byShareToken.get(digest(raw))
  }

  const findLease = (raw: string): { lease: WorkbenchShareViewLeaseV1; session: WorkbenchShareSessionV1 } | undefined => {
    if (disposed || !/^[A-Za-z0-9_-]{40,96}$/u.test(raw)) return undefined
    const lease = byCookie.get(digest(raw))
    if (lease === undefined) return undefined
    const session = byShareToken.get(lease.shareTokenHash)
    return session === undefined ? undefined : { lease, session }
  }

  const findCookieState = (raw: string): WorkbenchShareCookieStateV1 | undefined => {
    if (disposed || !/^[A-Za-z0-9_-]{40,96}$/u.test(raw)) return undefined
    pruneStoppedCookies()
    const lease = byCookie.get(digest(raw))
    if (lease !== undefined) {
      const session = byShareToken.get(lease.shareTokenHash)
      return session === undefined ? { status: 'stopped' } : { status: 'active', lease, session }
    }
    return revokedCookies.get(digest(raw)) === undefined ? undefined : { status: revokedCookies.get(digest(raw))!.status }
  }

  const stop = (workbenchId: string): WorkbenchShareSessionV1 | undefined => {
    const session = byWorkbench.get(workbenchId)
    if (session === undefined) return undefined
    byWorkbench.delete(workbenchId)
    byShareToken.delete(session.shareTokenHash)
    sessions.delete(session.shareTokenHash)
    for (const lease of session.leases.values()) {
      byCookie.delete(lease.cookieHash)
      revokedCookies.set(lease.cookieHash, { revokedAt: now(), status: 'stopped' })
    }
    session.leases.clear()
    return session
  }

  return {
    start,
    findByToken,
    findLease,
    findCookieState,
    createLease,
    removeLease,
    updateGuest,
    setNickname,
    revokeLease,
    stop,
    reduce(workbenchId: string, input: WorkbenchGrant) {
      const session = byWorkbench.get(workbenchId), next = parseWorkbenchGrant(input)
      if (!session || !isGrantReduction(session.grant, next)) throw new Error('扩大权限需要重新建立分享。')
      session.grant = next; session.grantRevision++
      return session
    },
    getSession(workbenchId: string) { return byWorkbench.get(workbenchId) },
    getSnapshot() {
      return [...sessions.values()].map(session => ({
        workbenchId: session.workbenchId,
        bindHost: session.bindHost,
        port: session.port,
        createdAt: session.createdAt,
        grant: session.grant, grantRevision: session.grantRevision,
        guestCount: session.leases.size,
        ...(session.leases.size === 0 ? {} : { guests: [...session.leases.values()].map(lease => ({
          leaseId: lease.leaseId,
          nickname: lease.nickname,
          ...(lease.ip === undefined ? {} : { ip: lease.ip }),
          ...(lease.device === undefined ? {} : { device: lease.device }),
          createdAt: lease.createdAt,
          lastSeenAt: lease.lastSeenAt,
          websocketState: lease.websocketState,
          websocketReconnects: lease.websocketReconnects,
          ...(lease.rttMs === undefined ? {} : { rttMs: lease.rttMs }),
          ...(lease.lastErrorAt === undefined ? {} : { lastErrorAt: lease.lastErrorAt }),
          connectionQuality: connectionQualityFor(lease),
        } satisfies WorkbenchShareGuestSnapshotV1)) }),
      }))
    },
    dispose() {
      disposed = true
      for (const session of sessions.values()) session.leases.clear()
      sessions.clear(); byWorkbench.clear(); byShareToken.clear(); byCookie.clear(); revokedCookies.clear()
    },
    get maxGuests() { return maxGuests },
  }
}

export type WorkbenchShareSessionManagerV1 = ReturnType<typeof createWorkbenchShareSessionManager>
