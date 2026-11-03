import { WORKBENCH_TEAM_TRUST_ROOT_V1 } from '../src/signed-catalog.ts'
import { WORKBENCH_CORE_VERSION, WORKBENCH_SUITE_VERSION, WORKBENCH_DSH_GENERATION, WORKBENCH_UPSTREAM_COMMIT } from '../src/release-compatibility.ts'
import { describe, expect, it } from 'vitest'
import { canonicalizeWorkbenchCatalogJsonV1, importWorkbenchSignedCatalogV1 } from '../src/signed-catalog.ts'
import { createWorkbenchModuleInstallPlan } from '../src/install-plan.ts'

const digest = (character: string): string => character.repeat(64)
const artifact = new Uint8Array([7, 8, 9])
const integrity = `sha512-${'A'.repeat(86)}`

function catalog(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    kind: 'dsh-workbench-team-catalog',
    catalogId: 'team-fixture-20260906',
    compatibility: {
      dshGeneration: WORKBENCH_DSH_GENERATION,
      upstreamCommit: WORKBENCH_UPSTREAM_COMMIT,
      requiredSeams: ['client.ui-layout', 'client.ui-settings'],
    },
    entries: [{
      moduleId: 'workbench.conversation-suite',
      packageName: '@dsh-workbench/conversation-suite',
      version: WORKBENCH_SUITE_VERSION,
      artifact: { locator: `artifacts/${digest('a')}.tgz`, sha256: digest('a'), integrity, size: artifact.byteLength },
      dshGeneration: WORKBENCH_DSH_GENERATION,
      requiredCapabilities: ['workbench.conversation.areas'],
      permissions: ['dsh.conversation.render'],
      provenance: { upstreamCommit: WORKBENCH_UPSTREAM_COMMIT, sourceDigest: digest('b'), patchDigest: digest('c') },
      publisherKeyId: WORKBENCH_TEAM_TRUST_ROOT_V1.keyId,
      revoked: false,
      kind: 'official-builtin',
      delivery: 'official-component',
      manifest: { kind: 'official-builtin', delivery: 'official-component', coreCompatibility: WORKBENCH_CORE_VERSION, editorIds: ['workbench.conversation-suite'], scope: 'area' },
    }],
    ...overrides,
  }
}

function archive(value: Record<string, unknown>, options: { signatureValid?: boolean; catalogBytes?: Uint8Array; extra?: readonly { path: string; bytes: Uint8Array }[] } = {}) {
  const catalogBytes = options.catalogBytes ?? canonicalizeWorkbenchCatalogJsonV1(value)
  return {
    archiveReader: { read: async () => [
      { path: 'catalog.json', bytes: catalogBytes },
      { path: 'catalog.sig', bytes: new TextEncoder().encode('AQ==') },
      { path: `artifacts/${digest('a')}.tgz`, bytes: artifact },
      ...(options.extra ?? []),
    ] },
    verifier: { verify: async () => options.signatureValid ?? true },
    digests: { sha256: async () => digest('a'), sha512Integrity: async () => integrity },
    verifiedSeams: ['client.ui-layout', 'client.ui-settings'],
    allowedPermissions: ['dsh.conversation.render'],
  }
}

describe('signed local Workbench Catalog', () => {
  it('accepts a canonical, signed local catalog and returns immutable artifact bytes', async () => {
    const imported = await importWorkbenchSignedCatalogV1(new Uint8Array([1]), archive(catalog()))
    expect(imported.entries).toHaveLength(1)
    expect(imported.entries[0]).toMatchObject({
      moduleId: 'workbench.conversation-suite',
      kind: 'official-builtin',
      delivery: 'official-component',
      source: { kind: 'signed-local-catalog', locator: `artifacts/${digest('a')}.tgz` },
      signedCatalog: { publisherKeyId: WORKBENCH_TEAM_TRUST_ROOT_V1.keyId, permissions: ['dsh.conversation.render'] },
    })
    const first = imported.artifact({ moduleId: 'workbench.conversation-suite', version: WORKBENCH_SUITE_VERSION, artifactDigest: digest('a') })!
    first[0] = 42
    expect(imported.artifact({ moduleId: 'workbench.conversation-suite', version: WORKBENCH_SUITE_VERSION, artifactDigest: digest('a') })![0]).toBe(7)
  })

  it('rejects signature failure before accepting catalog contents', async () => {
    await expect(importWorkbenchSignedCatalogV1(new Uint8Array([1]), archive(catalog(), { signatureValid: false }))).rejects.toThrow('signature verification failed')
  })

  it('rejects a catalog whose bytes are not canonical JSON', async () => {
    const bytes = new TextEncoder().encode(`${new TextDecoder().decode(canonicalizeWorkbenchCatalogJsonV1(catalog()))}\n`)
    await expect(importWorkbenchSignedCatalogV1(new Uint8Array([1]), archive(catalog(), { catalogBytes: bytes }))).rejects.toThrow('canonical JSON')
  })

  it('rejects unsupported DSH generation and unavailable plugin seams', async () => {
    await expect(importWorkbenchSignedCatalogV1(new Uint8Array([1]), archive(catalog({ compatibility: { dshGeneration: '0.1.2', upstreamCommit: WORKBENCH_UPSTREAM_COMMIT, requiredSeams: [] } })))).rejects.toThrow('locked DSH plugin generation')
    await expect(importWorkbenchSignedCatalogV1(new Uint8Array([1]), { ...archive(catalog()), verifiedSeams: ['client.ui-layout'] })).rejects.toThrow('Required DSH plugin seam')
  })

  it('rejects unsafe permissions, malformed locators, and duplicate identities', async () => {
    const highRisk = catalog()
    ;((highRisk.entries as Record<string, unknown>[])[0]!.permissions as string[]).push('filesystem.write')
    await expect(importWorkbenchSignedCatalogV1(new Uint8Array([1]), archive(highRisk))).rejects.toThrow('permission is not permitted')

    const unsafeLocator = catalog()
    ;((unsafeLocator.entries as Record<string, unknown>[])[0]!.artifact as Record<string, unknown>).locator = '../module.tgz'
    await expect(importWorkbenchSignedCatalogV1(new Uint8Array([1]), archive(unsafeLocator))).rejects.toThrow('artifact identity is invalid')

    const duplicate = catalog()
    ;(duplicate.entries as unknown[]).push((duplicate.entries as unknown[])[0])
    await expect(importWorkbenchSignedCatalogV1(new Uint8Array([1]), archive(duplicate))).rejects.toThrow('Duplicate immutable catalog identity')

    const sameVersionDifferentDigest = catalog()
    const conflictingEntry = structuredClone((sameVersionDifferentDigest.entries as Record<string, unknown>[])[0]!)
    ;(conflictingEntry.artifact as Record<string, unknown>).sha256 = digest('d')
    ;(conflictingEntry.artifact as Record<string, unknown>).locator = `artifacts/${digest('d')}.tgz`
    ;(sameVersionDifferentDigest.entries as unknown[]).push(conflictingEntry)
    await expect(importWorkbenchSignedCatalogV1(new Uint8Array([1]), archive(sameVersionDifferentDigest, {
      extra: [{ path: `artifacts/${digest('d')}.tgz`, bytes: artifact }],
    }))).rejects.toThrow('multiple digests')
  })

  it('rejects malformed scalar fields and archive files not declared by the catalog', async () => {
    const invalidRevocation = catalog()
    ;((invalidRevocation.entries as Record<string, unknown>[])[0]!).revoked = 'false'
    await expect(importWorkbenchSignedCatalogV1(new Uint8Array([1]), archive(invalidRevocation))).rejects.toThrow('revoked state')

    const invalidScope = catalog()
    ;((((invalidScope.entries as Record<string, unknown>[])[0]!).manifest as Record<string, unknown>).scope) = 'global'
    await expect(importWorkbenchSignedCatalogV1(new Uint8Array([1]), archive(invalidScope))).rejects.toThrow('scope is invalid')

    await expect(importWorkbenchSignedCatalogV1(new Uint8Array([1]), archive(catalog(), {
      extra: [{ path: 'readme.txt', bytes: new Uint8Array([1]) }],
    }))).rejects.toThrow('undeclared file')
  })

  it('shows a revoked entry but blocks creation of its V1 install plan', async () => {
    const revoked = catalog()
    ;((revoked.entries as Record<string, unknown>[])[0]!).revoked = true
    const imported = await importWorkbenchSignedCatalogV1(new Uint8Array([1]), archive(revoked))
    const plan = createWorkbenchModuleInstallPlan({ source: 'signed-local-catalog', requested: [{ moduleId: 'workbench.conversation-suite' }], catalog: imported.moduleCatalog, capabilities: ['workbench.conversation.areas'] })
    expect(plan).toMatchObject({ status: 'blocked', blockers: [expect.objectContaining({ code: 'revoked' })] })
  })

  it('rejects tampered artifacts and does not use a Registry fallback', async () => {
    const options = archive(catalog())
    await expect(importWorkbenchSignedCatalogV1(new Uint8Array([1]), { ...options, digests: { sha256: async () => digest('f'), sha512Integrity: async () => integrity } })).rejects.toThrow('artifact digest mismatch')
  })
})
