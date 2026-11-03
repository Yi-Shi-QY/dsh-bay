import { WORKBENCH_CORE_VERSION, WORKBENCH_SUITE_VERSION, WORKBENCH_DSH_GENERATION, WORKBENCH_UPSTREAM_COMMIT } from '../src/release-compatibility.ts'
import { describe, expect, it } from 'vitest'
import { resolveWorkbenchDirectPackageV1, validateWorkbenchDirectPackageDescriptorV1 } from '../src/source-resolution.ts'
import { workbenchVersionSatisfies } from '../src/module-source.ts'

const digest = 'a'.repeat(64)
const requestNpm = { kind: 'npm' as const, packageName: '@example/workbench-suite', requestedRange: '^1.2.0', registry: 'https://registry.example.test' }
const manifest = {
  moduleId: 'workbench.example-suite', version: '1.2.3', coreCompatibility: WORKBENCH_CORE_VERSION, artifactDigest: digest,
  provides: { editorIds: ['workbench.example'], surfaces: ['workbench.extension'] }, requires: { capabilities: [], modules: [] }, activation: { mode: 'workbench' as const, scope: 'area' as const },
}

function descriptor(overrides: Record<string, unknown> = {}) {
  return { packageName: '@example/workbench-suite', manifest, artifactBytes: new Uint8Array([1, 2, 3]), dshGeneration: WORKBENCH_DSH_GENERATION, permissions: ['dsh.example.render'], provenance: { upstreamCommit: WORKBENCH_UPSTREAM_COMMIT, sourceDigest: 'c'.repeat(64), patchDigest: 'd'.repeat(64) }, resolvedVersion: '1.2.3', registry: requestNpm.registry, ...overrides }
}

describe('direct Workbench source resolution', () => {
  it('pins npm identity and marks it unverified until runtime verification', async () => {
    const result = await resolveWorkbenchDirectPackageV1(requestNpm, descriptor(), async () => digest)
    expect(result.source).toEqual({ kind: 'npm', packageName: '@example/workbench-suite', requestedRange: '^1.2.0', resolvedVersion: '1.2.3', artifactDigest: digest, registry: requestNpm.registry })
    expect(result.trust).toBe('user-approved-unverified')
  })

  it('rejects a package whose bytes do not match the manifest identity', async () => {
    await expect(resolveWorkbenchDirectPackageV1(requestNpm, descriptor(), async () => 'b'.repeat(64))).rejects.toThrow('artifact-integrity-mismatch')
  })

  it('rejects a DSH generation mismatch and mutable source result', async () => {
    await expect(resolveWorkbenchDirectPackageV1(requestNpm, descriptor({ dshGeneration: '0.1.4' }), async () => digest)).rejects.toThrow('module-incompatible')
    expect(validateWorkbenchDirectPackageDescriptorV1(descriptor())).toBe(true)
    expect(validateWorkbenchDirectPackageDescriptorV1({ ...descriptor(), artifactBytes: [1, 2, 3] })).toBe(false)
  })

  it('uses bounded semver checks for Core compatibility', () => {
    expect(workbenchVersionSatisfies('0.1.5-rc.2', '>=0.1.5-rc.2 <0.2.0')).toBe(true)
    expect(workbenchVersionSatisfies('0.2.0', '>=0.1.5-rc.2 <0.2.0')).toBe(false)
    expect(workbenchVersionSatisfies('0.1.5-rc.2', 'workspace:*')).toBe(false)
  })
})
