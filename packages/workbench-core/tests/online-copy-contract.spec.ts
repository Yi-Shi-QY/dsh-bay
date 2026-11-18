import { describe, expect, it } from 'vitest'
import { applyWorkbenchCopyInviteActionV1, classifyWorkbenchCopyInviteV1, createWorkbenchCopyInviteV1, validateWorkbenchCopyCode, validateWorkbenchCopyInviteV1, verifyWorkbenchCopyInviteCodeV1 } from '../src/online-copy-contract.ts'

const expected = { dshGeneration: '0.2.1-rc.2', coreVersion: '0.2.2-alpha.2' }
const invite = () => ({
  schemaVersion: 1,
  kind: 'dsh-workbench-copy-invite',
  inviteId: 'invite-20261018-a',
  codeDigest: 'a'.repeat(64),
  hostLabel: 'Workbench host',
  createdAt: 1_000,
  expiresAt: 601_000,
  package: { packageId: 'package-abc', sha256: 'b'.repeat(64), bytes: 512 },
  compatibility: expected,
})

describe('Workbench LAN copy invite contract', () => {
  it('accepts only an allowlisted, short-lived copy invitation', () => {
    expect(validateWorkbenchCopyInviteV1(invite(), expected)).toBe(true)
    expect(classifyWorkbenchCopyInviteV1(invite(), 2_000, expected)).toBe('active')
    expect(classifyWorkbenchCopyInviteV1(invite(), 601_000, expected)).toBe('expired')
  })

  it('reports revoked and consumed invitations distinctly', () => {
    expect(classifyWorkbenchCopyInviteV1({ ...invite(), revokedAt: 2_000 }, 2_001, expected)).toBe('revoked')
    expect(classifyWorkbenchCopyInviteV1({ ...invite(), consumedAt: 2_000 }, 2_001, expected)).toBe('consumed')
  })

  it('makes consume and revoke one-way actions for an active invite', () => {
    const consumed = applyWorkbenchCopyInviteActionV1(invite(), 'consume', 2_000, expected)
    expect(consumed.status).toBe('consumed')
    if (consumed.status !== 'consumed') throw new Error('Expected consumed invitation')
    expect(applyWorkbenchCopyInviteActionV1(consumed.invite, 'consume', 2_001, expected)).toEqual({ status: 'consumed' })
    expect(applyWorkbenchCopyInviteActionV1(invite(), 'revoke', 2_000, expected).status).toBe('revoked')
  })

  it('rejects generation mismatch and private or runtime fields', () => {
    expect(validateWorkbenchCopyInviteV1(invite(), { ...expected, dshGeneration: '0.2.0-rc.2' })).toBe(false)
    expect(classifyWorkbenchCopyInviteV1({ ...invite(), sessionId: 'must-not-transfer' }, 2_000, expected)).toBe('invalid')
    expect(classifyWorkbenchCopyInviteV1({ ...invite(), apiKey: 'secret' }, 2_000, expected)).toBe('invalid')
  })

  it('accepts bounded high-entropy code encodings only', () => {
    expect(validateWorkbenchCopyCode('ABCDEFGH23456723')).toBe(true)
    expect(validateWorkbenchCopyCode('12345678')).toBe(false)
    expect(validateWorkbenchCopyCode('../secret')).toBe(false)
  })

  it('creates a short-lived invite with cryptographic randomness and stores only its code digest', async () => {
    const created = await createWorkbenchCopyInviteV1({ inviteId: 'invite-20261018-b', hostLabel: 'Workbench host', now: 10_000,
      package: { packageId: 'package-abc', sha256: 'b'.repeat(64), bytes: 512 }, compatibility: expected })
    expect(created.invite).toMatchObject({ createdAt: 10_000, expiresAt: 610_000 })
    expect(validateWorkbenchCopyCode(created.code)).toBe(true)
    expect(created.invite.codeDigest).not.toContain(created.code)
    await expect(verifyWorkbenchCopyInviteCodeV1(created.invite, created.code)).resolves.toBe(true)
    await expect(verifyWorkbenchCopyInviteCodeV1(created.invite, 'ABCDEFGH23456723')).resolves.toBe(false)
    await expect(verifyWorkbenchCopyInviteCodeV1({ ...created.invite, sessionId: 'private' } as never, created.code)).resolves.toBe(false)
    await expect(createWorkbenchCopyInviteV1({ inviteId: 'too-long', hostLabel: 'host', now: 0, lifetimeMs: 31 * 60_000,
      package: { packageId: 'id', sha256: 'b'.repeat(64), bytes: 1 }, compatibility: expected })).rejects.toThrow('within 30 minutes')
  })
})
