const SHA256 = /^[0-9a-f]{64}$/u
const CODE = /^[A-Z2-7]{16,32}$/u

export interface WorkbenchCopyInviteV1 {
  readonly schemaVersion: 1
  readonly kind: 'dsh-workbench-copy-invite'
  readonly inviteId: string
  readonly codeDigest: string
  readonly hostLabel: string
  readonly createdAt: number
  readonly expiresAt: number
  readonly revokedAt?: number
  readonly consumedAt?: number
  readonly package: { readonly packageId: string; readonly sha256: string; readonly bytes: number }
  readonly compatibility: { readonly dshGeneration: string; readonly coreVersion: string }
}

export type WorkbenchCopyInviteStateV1 = 'active' | 'expired' | 'revoked' | 'consumed' | 'invalid'
export type WorkbenchCopyInviteActionResultV1 =
  | { readonly status: 'revoked' | 'consumed'; readonly invite: WorkbenchCopyInviteV1 }
  | { readonly status: 'expired' | 'revoked' | 'consumed' | 'invalid' }

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every(key => keys.includes(key)) && keys.every(key => key in value)
}

export function validateWorkbenchCopyInviteV1(
  value: unknown,
  expected: { readonly dshGeneration: string; readonly coreVersion: string },
): value is WorkbenchCopyInviteV1 {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const row = value as Record<string, unknown>
  if (!exactKeys(row, ['schemaVersion', 'kind', 'inviteId', 'codeDigest', 'hostLabel', 'createdAt', 'expiresAt', 'package', 'compatibility'])) {
    const allowed = ['schemaVersion', 'kind', 'inviteId', 'codeDigest', 'hostLabel', 'createdAt', 'expiresAt', 'revokedAt', 'consumedAt', 'package', 'compatibility']
    if (Object.keys(row).some(key => !allowed.includes(key))) return false
    if (['schemaVersion', 'kind', 'inviteId', 'codeDigest', 'hostLabel', 'createdAt', 'expiresAt', 'package', 'compatibility'].some(key => !(key in row))) return false
  }
  if (row.schemaVersion !== 1 || row.kind !== 'dsh-workbench-copy-invite'
    || typeof row.inviteId !== 'string' || row.inviteId.length < 8 || row.inviteId.length > 96
    || typeof row.codeDigest !== 'string' || !SHA256.test(row.codeDigest)
    || typeof row.hostLabel !== 'string' || row.hostLabel.length === 0 || row.hostLabel.length > 120
    || !Number.isSafeInteger(row.createdAt) || (row.createdAt as number) < 0
    || !Number.isSafeInteger(row.expiresAt)
    || (row.expiresAt as number) <= (row.createdAt as number)
    || (row.expiresAt as number) - (row.createdAt as number) > 30 * 60 * 1000) return false
  if (row.revokedAt !== undefined && (!Number.isSafeInteger(row.revokedAt) || (row.revokedAt as number) < (row.createdAt as number))) return false
  if (row.consumedAt !== undefined && (!Number.isSafeInteger(row.consumedAt) || (row.consumedAt as number) < (row.createdAt as number))) return false
  if (typeof row.package !== 'object' || row.package === null || Array.isArray(row.package)) return false
  const pkg = row.package as Record<string, unknown>
  if (!exactKeys(pkg, ['packageId', 'sha256', 'bytes'])
    || typeof pkg.packageId !== 'string' || pkg.packageId.length === 0 || pkg.packageId.length > 128
    || typeof pkg.sha256 !== 'string' || !SHA256.test(pkg.sha256)
    || !Number.isSafeInteger(pkg.bytes) || (pkg.bytes as number) <= 0 || (pkg.bytes as number) > 100 * 1024 * 1024) return false
  if (typeof row.compatibility !== 'object' || row.compatibility === null || Array.isArray(row.compatibility)) return false
  const compatibility = row.compatibility as Record<string, unknown>
  return exactKeys(compatibility, ['dshGeneration', 'coreVersion'])
    && compatibility.dshGeneration === expected.dshGeneration
    && compatibility.coreVersion === expected.coreVersion
}

export function classifyWorkbenchCopyInviteV1(value: unknown, now: number,
  expected: { readonly dshGeneration: string; readonly coreVersion: string }): WorkbenchCopyInviteStateV1 {
  if (!validateWorkbenchCopyInviteV1(value, expected)) return 'invalid'
  const invite = value as WorkbenchCopyInviteV1
  if (invite.revokedAt !== undefined) return 'revoked'
  if (invite.consumedAt !== undefined) return 'consumed'
  if (now >= invite.expiresAt) return 'expired'
  return 'active'
}

export function applyWorkbenchCopyInviteActionV1(
  value: unknown,
  action: 'revoke' | 'consume',
  now: number,
  expected: { readonly dshGeneration: string; readonly coreVersion: string },
): WorkbenchCopyInviteActionResultV1 {
  const state = classifyWorkbenchCopyInviteV1(value, now, expected)
  if (state !== 'active') return { status: state }
  const invite = value as WorkbenchCopyInviteV1
  return action === 'revoke'
    ? { status: 'revoked', invite: Object.freeze({ ...invite, revokedAt: now }) }
    : { status: 'consumed', invite: Object.freeze({ ...invite, consumedAt: now }) }
}

export function validateWorkbenchCopyCode(value: string): boolean {
  return CODE.test(value)
}

async function digestCode(inviteId: string, code: string): Promise<string> {
  if (!validateWorkbenchCopyCode(code)) throw new Error('Invalid Workbench copy code')
  const data = new TextEncoder().encode(`${inviteId}.${code}`)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

export async function createWorkbenchCopyInviteV1(input: {
  readonly inviteId: string
  readonly hostLabel: string
  readonly now: number
  readonly lifetimeMs?: number
  readonly package: WorkbenchCopyInviteV1['package']
  readonly compatibility: WorkbenchCopyInviteV1['compatibility']
}): Promise<{ readonly invite: WorkbenchCopyInviteV1; readonly code: string }> {
  const lifetimeMs = input.lifetimeMs ?? 10 * 60 * 1000
  if (!Number.isSafeInteger(lifetimeMs) || lifetimeMs <= 0 || lifetimeMs > 30 * 60 * 1000) {
    throw new Error('Workbench copy invite lifetime must be within 30 minutes')
  }
  if (typeof crypto === 'undefined' || typeof crypto.getRandomValues !== 'function' || crypto.subtle === undefined) {
    throw new Error('Secure randomness is unavailable for Workbench copy invitations')
  }
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  const random = crypto.getRandomValues(new Uint8Array(20))
  const code = [...random].map(byte => alphabet[byte & 31]).join('')
  const invite: WorkbenchCopyInviteV1 = Object.freeze({
    schemaVersion: 1,
    kind: 'dsh-workbench-copy-invite',
    inviteId: input.inviteId,
    codeDigest: await digestCode(input.inviteId, code),
    hostLabel: input.hostLabel,
    createdAt: input.now,
    expiresAt: input.now + lifetimeMs,
    package: Object.freeze({ ...input.package }),
    compatibility: Object.freeze({ ...input.compatibility }),
  })
  if (!validateWorkbenchCopyInviteV1(invite, input.compatibility)) throw new Error('Invalid Workbench copy invitation input')
  return Object.freeze({ invite, code })
}

export async function verifyWorkbenchCopyInviteCodeV1(
  invite: WorkbenchCopyInviteV1,
  code: string,
): Promise<boolean> {
  if (!validateWorkbenchCopyInviteV1(invite, invite?.compatibility) || !validateWorkbenchCopyCode(code)) return false
  const actual = await digestCode(invite.inviteId, code)
  let difference = 0
  for (let index = 0; index < invite.codeDigest.length; index++) {
    difference |= invite.codeDigest.charCodeAt(index) ^ actual.charCodeAt(index)
  }
  return difference === 0
}
