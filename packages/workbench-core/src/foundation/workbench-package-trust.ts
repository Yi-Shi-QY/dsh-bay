import { canonicalJson, sha256Hex, type WorkbenchPackageManifestV1 } from './workbench-sharing.ts'

export type WorkbenchPackageSignatureAlgorithmV1 = 'ed25519' | 'ecdsa-p256-sha256'

export interface WorkbenchPackageSignatureV1 {
  schemaVersion: 1
  packageId: string
  version: string
  manifestSha256: string
  algorithm: WorkbenchPackageSignatureAlgorithmV1
  keyId: string
  publicKey: string
  signature: string
  signedAt: string
}

export type WorkbenchPublisherTrustStateV1 = 'trusted' | 'package-only' | 'unknown' | 'revoked'

export interface WorkbenchPublisherTrustRecordV1 {
  keyId: string
  displayName: string
  publicKey: string
  state: WorkbenchPublisherTrustStateV1
  addedAt: number
  revokedAt?: number
}

export interface WorkbenchSignatureVerifierV1 {
  verify(input: {
    algorithm: WorkbenchPackageSignatureAlgorithmV1
    publicKey: string
    signature: string
    message: Uint8Array
  }): Promise<boolean>
}

export interface WorkbenchPackageTrustStoreV1 {
  get(keyId: string): WorkbenchPublisherTrustRecordV1 | undefined
  put(record: WorkbenchPublisherTrustRecordV1): void
  revoke(keyId: string, at?: number): boolean
}

export interface WorkbenchPackageTrustDecisionV1 {
  state: WorkbenchPublisherTrustStateV1
  keyId: string
  displayName?: string
  reason: 'trusted-publisher' | 'trusted-package' | 'unknown-publisher' | 'revoked-publisher' | 'invalid-signature'
}

export type WorkbenchPackagePermissionDecisionV1 = 'allow' | 'deny' | 'ask'

export interface WorkbenchPackagePermissionPolicyV1 {
  decide(permission: string, context: { packageId: string; pluginId?: string; update: boolean }): WorkbenchPackagePermissionDecisionV1
}

export interface WorkbenchPackagePermissionReportV1 {
  requested: readonly string[]
  decisions: Readonly<Record<string, WorkbenchPackagePermissionDecisionV1>>
  allowed: boolean
  newlyRequested: readonly string[]
}

/**
 * Canonical signing view. `signature.json` cannot hash itself; every other file
 * record (including dependency locks and artifact payloads) remains covered.
 */
export function workbenchManifestSigningView(
  manifest: WorkbenchPackageManifestV1,
): WorkbenchPackageManifestV1 {
  const { signaturePath: _signaturePath, ...unsigned } = structuredClone(manifest)
  return {
    ...unsigned,
    files: unsigned.files.filter(file => file.path !== 'signature.json'),
  }
}

export function manifestBytes(manifest: WorkbenchPackageManifestV1): Uint8Array {
  return new TextEncoder().encode(canonicalJson(workbenchManifestSigningView(manifest)))
}

export async function createUnsignedSignatureEnvelope(
  manifest: WorkbenchPackageManifestV1,
  input: { keyId: string; publicKey: string; algorithm: WorkbenchPackageSignatureAlgorithmV1; signature: string; signedAt?: string },
): Promise<WorkbenchPackageSignatureV1> {
  return {
    schemaVersion: 1,
    packageId: manifest.packageId,
    version: manifest.version,
    manifestSha256: await sha256Hex(manifestBytes(manifest)),
    algorithm: input.algorithm,
    keyId: input.keyId,
    publicKey: input.publicKey,
    signature: input.signature,
    signedAt: input.signedAt ?? new Date(0).toISOString(),
  }
}

export async function verifyWorkbenchPackageSignature(
  manifest: WorkbenchPackageManifestV1,
  signature: unknown,
  verifier: WorkbenchSignatureVerifierV1,
): Promise<{ valid: boolean; reason: 'valid' | 'missing' | 'malformed' | 'manifest-mismatch' | 'cryptographic-failure'; keyId?: string }> {
  if (signature === undefined || signature === null) return { valid: false, reason: 'missing' }
  if (typeof signature !== 'object' || Array.isArray(signature)) return { valid: false, reason: 'malformed' }
  const envelope = signature as Partial<WorkbenchPackageSignatureV1>
  if (envelope.schemaVersion !== 1 || envelope.packageId !== manifest.packageId || envelope.version !== manifest.version
    || (envelope.algorithm !== 'ed25519' && envelope.algorithm !== 'ecdsa-p256-sha256')
    || typeof envelope.keyId !== 'string' || typeof envelope.publicKey !== 'string'
    || typeof envelope.signature !== 'string' || typeof envelope.manifestSha256 !== 'string') return { valid: false, reason: 'malformed' }
  const digest = await sha256Hex(manifestBytes(manifest))
  if (digest !== envelope.manifestSha256) return { valid: false, reason: 'manifest-mismatch', keyId: envelope.keyId }
  try {
    const valid = await verifier.verify({
      algorithm: envelope.algorithm, publicKey: envelope.publicKey,
      signature: envelope.signature, message: manifestBytes(manifest),
    })
    return valid ? { valid: true, reason: 'valid', keyId: envelope.keyId } : { valid: false, reason: 'cryptographic-failure', keyId: envelope.keyId }
  } catch {
    return { valid: false, reason: 'cryptographic-failure', keyId: envelope.keyId }
  }
}

export class MemoryWorkbenchPublisherTrustStore implements WorkbenchPackageTrustStoreV1 {
  private readonly records = new Map<string, WorkbenchPublisherTrustRecordV1>()

  get(keyId: string): WorkbenchPublisherTrustRecordV1 | undefined {
    const record = this.records.get(keyId)
    return record === undefined ? undefined : structuredClone(record)
  }

  put(record: WorkbenchPublisherTrustRecordV1): void {
    this.records.set(record.keyId, structuredClone(record))
  }

  revoke(keyId: string, at = Date.now()): boolean {
    const record = this.records.get(keyId)
    if (record === undefined) return false
    this.records.set(keyId, { ...record, state: 'revoked', revokedAt: at })
    return true
  }
}

export function decidePublisherTrust(
  signature: WorkbenchPackageSignatureV1,
  store: WorkbenchPackageTrustStoreV1,
  packageOnlyTrustedKeys: ReadonlySet<string> = new Set(),
): WorkbenchPackageTrustDecisionV1 {
  const record = store.get(signature.keyId)
  if (record?.state === 'revoked') return { state: 'revoked', keyId: signature.keyId, displayName: record.displayName, reason: 'revoked-publisher' }
  if (record?.state === 'trusted') return { state: 'trusted', keyId: signature.keyId, displayName: record.displayName, reason: 'trusted-publisher' }
  if (packageOnlyTrustedKeys.has(signature.keyId)) return {
    state: 'package-only', keyId: signature.keyId,
    ...(record?.displayName === undefined ? {} : { displayName: record.displayName }),
    reason: 'trusted-package',
  }
  return {
    state: 'unknown', keyId: signature.keyId,
    ...(record?.displayName === undefined ? {} : { displayName: record.displayName }),
    reason: 'unknown-publisher',
  }
}

export function buildPermissionReport(
  requested: readonly string[],
  policy: WorkbenchPackagePermissionPolicyV1,
  context: { packageId: string; pluginId?: string; update: boolean },
  previous: readonly string[] = [],
): WorkbenchPackagePermissionReportV1 {
  const unique = [...new Set(requested)].sort()
  const previousSet = new Set(previous)
  const decisions = Object.fromEntries(unique.map(permission => [permission, policy.decide(permission, context)]))
  const newlyRequested = unique.filter(permission => !previousSet.has(permission))
  return {
    requested: unique, decisions, newlyRequested,
    allowed: unique.every(permission => decisions[permission] === 'allow'),
  }
}
