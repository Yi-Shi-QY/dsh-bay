import { WORKBENCH_CORE_VERSION, WORKBENCH_SUITE_VERSION, WORKBENCH_DSH_GENERATION, WORKBENCH_UPSTREAM_COMMIT } from '../src/release-compatibility.ts'
import { describe, expect, it, vi } from 'vitest'
import { createWorkbenchModuleManager } from '../src/module-manager.ts'
import { createWorkbenchModuleInstallCoordinator } from '../src/install-coordinator.ts'
import { createWorkbenchInstallTransactionJournal } from '../src/transaction-journal.ts'
import { canonicalizeWorkbenchCatalogJsonV1, importWorkbenchSignedCatalogV1 } from '../src/signed-catalog.ts'
import { createWorkbenchBrowserSignedCatalogInstallCommit } from '../src/browser-module-install.ts'
import { WORKBENCH_TEAM_TRUST_ROOT_V1 } from '../src/signed-catalog.ts'

const digest = (character: string): string => character.repeat(64)
const artifact = new Uint8Array([1, 2, 3])
const integrity = `sha512-${'A'.repeat(86)}`

function catalog(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    kind: 'dsh-workbench-team-catalog',
    catalogId: 'manager-test-catalog',
    compatibility: { dshGeneration: WORKBENCH_DSH_GENERATION, upstreamCommit: WORKBENCH_UPSTREAM_COMMIT, requiredSeams: [] },
    entries: [{
      moduleId: 'workbench.conversation-suite', packageName: '@dsh-workbench/conversation-suite', version: WORKBENCH_SUITE_VERSION,
      artifact: { locator: `artifacts/${digest('a')}.tgz`, sha256: digest('a'), integrity, size: artifact.byteLength },
      dshGeneration: WORKBENCH_DSH_GENERATION, requiredCapabilities: ['workbench.conversation.areas'], permissions: ['dsh.conversation.render'],
      provenance: { upstreamCommit: WORKBENCH_UPSTREAM_COMMIT, sourceDigest: digest('b'), patchDigest: digest('c') },
      publisherKeyId: WORKBENCH_TEAM_TRUST_ROOT_V1.keyId, revoked: false,
      manifest: { coreCompatibility: WORKBENCH_CORE_VERSION, editorIds: ['workbench.conversation-suite'], scope: 'area' },
    }],
  }
}

function importer() {
  return async () => importWorkbenchSignedCatalogV1(new Uint8Array([1]), {
    archiveReader: { read: async () => [
      { path: 'catalog.json', bytes: canonicalizeWorkbenchCatalogJsonV1(catalog()) },
      { path: 'catalog.sig', bytes: new TextEncoder().encode('AQ==') },
      { path: `artifacts/${digest('a')}.tgz`, bytes: artifact },
    ] },
    verifier: { verify: async () => true },
    digests: { sha256: async () => digest('a'), sha512Integrity: async () => integrity },
    verifiedSeams: [], allowedPermissions: ['dsh.conversation.render'],
    trustRoot: WORKBENCH_TEAM_TRUST_ROOT_V1,
  })
}

describe('Core-owned Workbench Module Manager', () => {
  it('returns only after the Manager restart completion facts are verified', async () => {
    const restart = vi.fn(async () => ({
      operationId: 'b927cf92-7c0b-4501-9589-c32a173cf5fc',
      transactionId: 'tx-restart',
      status: {
        schemaVersion: 1 as const,
        operationId: 'b927cf92-7c0b-4501-9589-c32a173cf5fc',
        phase: 'verified' as const, transactionId: 'tx-restart', transactionState: 'active' as const, managerSucceeded: true,
        sourceRunReady: false,
        replacementRunReady: true,
        workbenchVerified: true,
      },
    }))
    const manager = createWorkbenchModuleManager({
      capabilities: () => ['workbench.conversation.areas'], installed: () => new Map(),
      importCatalog: importer(), requestRestart: restart,
    })
    await manager.importCatalogArchive(new Uint8Array([9]))
    // Host facts provide the durable transaction id used by the restart call.
    const withHost = createWorkbenchModuleManager({
      capabilities: () => ['workbench.conversation.areas'], installed: () => new Map(), importCatalog: importer(), requestRestart: restart,
      center: { retain: async () => {}, archive: async () => new Uint8Array([9]), facts: async () => ({
        schemaVersion: 1 as const, catalog: 'available' as const, activation: 'restart-required' as const,
        restartTransactionId: 'tx-restart',
      }) },
    })
    await withHost.refresh!()
    await expect(withHost.requestRestart!()).resolves.toMatchObject({ status: { phase: 'verified' } })
    expect(restart).toHaveBeenCalledWith('tx-restart', expect.any(Function))
    expect(withHost.getSnapshot()).toMatchObject({ restartStatus: { phase: 'verified', replacementRunReady: true, workbenchVerified: true } })
    expect(manager.restartAvailable).toBe(true)
  })

  it('explains manual restart for a CLI host without a Manager bridge', async () => {
    const manager = createWorkbenchModuleManager({ capabilities: () => [], installed: () => new Map(), importCatalog: importer(),
      center: { retain: async () => {}, archive: async () => new Uint8Array([9]), facts: async () => ({ schemaVersion: 1 as const, catalog: 'available' as const,
        activation: 'restart-required' as const, restartTransactionId: 'tx-cli' }) } })
    await manager.refresh!()
    expect(manager.restartAvailable).toBe(false)
    await expect(manager.requestRestart!()).rejects.toThrow('当前启动方式不支持一键安全重启')
  })

  it.each(['active', 'restart-required'] as const)('restores the retained catalog and %s Host identity after browser reload', async activation => {
    const retain = vi.fn(async () => {})
    const manager = createWorkbenchModuleManager({
      capabilities: () => ['workbench.conversation.areas'], installed: () => new Map(), importCatalog: importer(),
      center: { retain, archive: async () => new Uint8Array([9]), facts: async () => ({ schemaVersion: 1, catalog: 'available', activation,
        installed: { moduleId: 'workbench.conversation-suite', version: WORKBENCH_SUITE_VERSION, artifactDigest: digest('a') } }) },
    })
    await manager.refresh!()
    expect(manager.getSnapshot()).toMatchObject({ state: activation, catalogId: 'manager-test-catalog' })
    expect(manager.createInstallPlan('workbench.conversation-suite')).toMatchObject({ status: 'ready', toInstall: [], reused: [expect.objectContaining({ artifactDigest: digest('a') })] })
    expect(retain).not.toHaveBeenCalled()
    if (activation === 'restart-required') await expect(manager.importCatalogArchive(new Uint8Array([9]))).rejects.toThrow('restart')
  })

  it('retains the prior catalog when Host persistence fails and restores conflicts from Host facts', async () => {
    const retain = vi.fn(async () => { throw new Error('write failed') })
    const manager = createWorkbenchModuleManager({
      capabilities: () => ['workbench.conversation.areas'], installed: () => new Map(), importCatalog: importer(),
      center: { retain, archive: async () => new Uint8Array([9]), facts: async () => ({ schemaVersion: 1, catalog: 'available', activation: 'active',
        installed: { moduleId: 'workbench.conversation-suite', version: WORKBENCH_SUITE_VERSION, artifactDigest: digest('f') } }) },
    })
    await manager.refresh!()
    expect(manager.createInstallPlan('workbench.conversation-suite').status).toBe('blocked')
    const before = manager.getSnapshot()
    await expect(manager.importCatalogArchive(new Uint8Array([2]))).rejects.toThrow('write failed')
    expect(manager.getSnapshot()).toEqual(before)
  })

  it('does not present stale catalog entries after a failed refresh', async () => {
    const facts = vi.fn(async () => ({ schemaVersion: 1 as const, catalog: 'available' as const, activation: 'absent' as const }))
    const manager = createWorkbenchModuleManager({ capabilities: () => ['workbench.conversation.areas'], installed: () => new Map(), importCatalog: importer(),
      center: { facts, retain: async () => {}, archive: async () => new Uint8Array([9]) } })
    await manager.refresh!()
    facts.mockRejectedValueOnce(new Error('connection lost'))
    await manager.refresh!()
    expect(manager.getSnapshot()).toMatchObject({ entries: [], error: expect.any(String) })
    expect(() => manager.createInstallPlan('workbench.conversation-suite')).toThrow('unavailable')
  })

  it('queues native inventory invalidations received during installation until the Host settles', async () => {
    let release!: () => void
    const pending = new Promise<void>(resolve => { release = resolve })
    const facts = vi.fn(async () => ({ schemaVersion: 1 as const, catalog: 'available' as const, activation: 'absent' as const }))
    const manager = createWorkbenchModuleManager({
      capabilities: () => ['workbench.conversation.areas'], installed: () => new Map(), importCatalog: importer(),
      center: { facts, retain: async () => {}, archive: async () => new Uint8Array([9]) },
      commitSignedCatalogInstall: async () => {
        await pending
        return { transactionId: 'native-install', planId: 'plan', state: 'restart-required', stagedModules: [], installedModules: ['workbench.conversation-suite'], activatedModules: [] }
      },
    })
    await manager.refresh!()
    const install = manager.install('workbench.conversation-suite')
    const refreshed = manager.refresh!()
    expect(facts).toHaveBeenCalledOnce()
    release()
    await install
    await refreshed
    expect(facts).toHaveBeenCalledTimes(2)
  })

  it('drops an old active projection when native inventory becomes unreadable', async () => {
    const facts = vi.fn(async () => ({ schemaVersion: 1 as const, catalog: 'available' as const, activation: 'active' as const,
      installed: { moduleId: 'workbench.conversation-suite', version: WORKBENCH_SUITE_VERSION, artifactDigest: digest('a') } }))
    const manager = createWorkbenchModuleManager({ capabilities: () => [], installed: () => new Map(), importCatalog: importer(),
      center: { facts, retain: async () => {}, archive: async () => new Uint8Array([9]) } })
    await manager.refresh!()
    expect(manager.getSnapshot().state).toBe('active')
    facts.mockRejectedValueOnce(new Error('private host diagnostic'))
    await manager.refresh!()
    expect(manager.getSnapshot()).toMatchObject({ state: 'empty', entries: [], error: '模块状态恢复失败，请刷新后重试。' })
    expect(manager.getSnapshot().host).toBeUndefined()
  })

  it('accepts only catalog bytes, makes the Suite identity reviewable, and reaches restart-required through Core', async () => {
    const calls: string[] = []
    const coordinator = {
      stagePlan: async (plan: { source: string }) => { calls.push(`stage:${plan.source}`); return { transactionId: 'transaction-1' } },
      install: async (transactionId: string) => { calls.push(`install:${transactionId}`) },
      getTransaction: () => ({ transactionId: 'transaction-1', planId: 'plan-1', state: 'restart-required' as const, stagedModules: ['workbench.conversation-suite'], installedModules: ['workbench.conversation-suite'], activatedModules: [] }),
    }
    const manager = createWorkbenchModuleManager({
      coordinator: coordinator as never,
      capabilities: () => ['workbench.conversation.areas'],
      installed: () => new Map(),
      importCatalog: importer(),
      stageCatalogArtifact: async input => {
        calls.push(`artifact:${input.identity.moduleId}:${input.identity.version}:${input.identity.artifactDigest}:${input.packageName}:${input.integrity}:${[...input.tarball].join(',')}`)
      },
    })
    expect(manager.getSnapshot()).toEqual({ state: 'empty', entries: [] })
    await manager.importCatalogArchive(new Uint8Array([9]))
    expect(manager.getSnapshot()).toMatchObject({ state: 'catalog-imported', catalogId: 'manager-test-catalog', entries: [expect.objectContaining({ moduleId: 'workbench.conversation-suite', signedCatalog: expect.objectContaining({ permissions: ['dsh.conversation.render'] }) })] })
    expect(manager.createInstallPlan('workbench.conversation-suite')).toMatchObject({ source: 'signed-local-catalog', status: 'ready' })
    await expect(manager.install('workbench.conversation-suite')).resolves.toMatchObject({ state: 'restart-required' })
    expect(calls).toEqual([
      `artifact:workbench.conversation-suite:${WORKBENCH_SUITE_VERSION}:${digest('a')}:@dsh-workbench/conversation-suite:${integrity}:1,2,3`,
      'stage:signed-local-catalog',
      'install:transaction-1',
    ])
    await expect(manager.importCatalogArchive(new Uint8Array([9]))).rejects.toThrow('restart is required')
  })

  it('does not stage when the signed Catalog plan is blocked', async () => {
    const stage = async () => { throw new Error('artifact staging must not run') }
    const manager = createWorkbenchModuleManager({
      coordinator: { stagePlan: async () => { throw new Error('must not stage') }, install: async () => {}, getTransaction: () => undefined } as never,
      capabilities: () => [], installed: () => new Map(), importCatalog: importer(), stageCatalogArtifact: stage,
    })
    await manager.importCatalogArchive(new Uint8Array([9]))
    await expect(manager.install('workbench.conversation-suite')).rejects.toThrow('install plan blocked')
  })

  it('blocks installation when Host reports an unowned Profile package', async () => {
    const manager = createWorkbenchModuleManager({
      capabilities: () => ['workbench.conversation.areas'], installed: () => new Map(), importCatalog: importer(),
      center: { retain: async () => {}, archive: async () => new Uint8Array([9]), facts: async () => ({
        schemaVersion: 1 as const, catalog: 'available' as const, activation: 'absent' as const,
        profileConflict: 'unowned-module' as const,
      }) },
    })
    await manager.refresh!()
    const plan = manager.createInstallPlan('workbench.conversation-suite')
    expect(plan.status).toBe('blocked')
    expect(plan.blockers).toEqual([expect.objectContaining({ code: 'identity-conflict', message: expect.stringContaining('当前 Profile') })])
  })

  it('fails closed before Core staging when the Host artifact bridge rejects exact catalog bytes', async () => {
    const calls: string[] = []
    const manager = createWorkbenchModuleManager({
      coordinator: {
        stagePlan: async () => { calls.push('coordinator-stage'); return { transactionId: 'unreachable' } },
        install: async () => { calls.push('coordinator-install') },
        getTransaction: () => undefined,
      } as never,
      capabilities: () => ['workbench.conversation.areas'],
      installed: () => new Map(),
      importCatalog: importer(),
      stageCatalogArtifact: async input => {
        calls.push(`artifact:${input.identity.artifactDigest}`)
        throw new Error('Host rejected catalog artifact')
      },
    })
    await manager.importCatalogArchive(new Uint8Array([9]))
    await expect(manager.install('workbench.conversation-suite')).rejects.toThrow('Host rejected catalog artifact')
    expect(calls).toEqual([`artifact:${digest('a')}`])
  })

  it('fails closed when the Profile has not exposed the fixed artifact staging bridge', async () => {
    const manager = createWorkbenchModuleManager({
      coordinator: { stagePlan: async () => ({ transactionId: 'unreachable' }), install: async () => {}, getTransaction: () => undefined } as never,
      capabilities: () => ['workbench.conversation.areas'], installed: () => new Map(), importCatalog: importer(),
    })
    await manager.importCatalogArchive(new Uint8Array([9]))
    await expect(manager.install('workbench.conversation-suite')).rejects.toThrow('artifact staging bridge is unavailable')
  })

  it('sends the complete catalog archive to the Host commit bridge only after local plan review succeeds', async () => {
    const commit = async (input: { moduleId: 'workbench.conversation-suite'; archive: Uint8Array }) => {
      expect(input).toEqual({ moduleId: 'workbench.conversation-suite', archive: new Uint8Array([9]) })
      return { transactionId: 'host-commit', planId: 'host-plan', state: 'restart-required' as const, stagedModules: ['workbench.conversation-suite'], installedModules: ['workbench.conversation-suite'], activatedModules: [] }
    }
    const manager = createWorkbenchModuleManager({
      capabilities: () => ['workbench.conversation.areas'], installed: () => new Map(), importCatalog: importer(), commitSignedCatalogInstall: commit,
    })
    await manager.importCatalogArchive(new Uint8Array([9]))
    await expect(manager.install('workbench.conversation-suite')).resolves.toMatchObject({ transactionId: 'host-commit', state: 'restart-required' })
  })

  it('records exact identity repair as a durable restart transaction without restaging the artifact', async () => {
    const journal = createWorkbenchInstallTransactionJournal()
    const installed = new Map([['workbench.conversation-suite', {
      moduleId: 'workbench.conversation-suite', version: WORKBENCH_SUITE_VERSION, artifactDigest: digest('a'),
    }]])
    const calls: string[] = []
    const coordinator = createWorkbenchModuleInstallCoordinator({
      capabilities: () => ['workbench.conversation.areas'],
      installed: moduleId => installed.get(moduleId),
      stage: async module => { calls.push(`stage:${module.moduleId}`) },
      install: async module => { calls.push(`install:${module.moduleId}`) },
      verify: async module => { calls.push(`verify:${module.moduleId}`) },
      activate: async moduleId => { calls.push(`activate:${moduleId}`) },
      rollback: async moduleId => { calls.push(`rollback:${moduleId}`) },
    }, { journal })
    const manager = createWorkbenchModuleManager({
      coordinator,
      capabilities: () => ['workbench.conversation.areas'],
      installed: () => installed,
      importCatalog: importer(),
      stageCatalogArtifact: async () => { calls.push('artifact') },
    })

    await manager.importCatalogArchive(new Uint8Array([9]))
    const result = await manager.install('workbench.conversation-suite')

    expect(result.state).toBe('restart-required')
    expect(result.transactionId).not.toMatch(/^workbench-repair-/)
    expect(calls).toEqual([])
    expect(journal.get(result.transactionId)).toMatchObject({
      transactionId: result.transactionId,
      installTargets: [],
      modules: [expect.objectContaining({ moduleId: 'workbench.conversation-suite', artifactDigest: digest('a') })],
      snapshot: expect.objectContaining({ state: 'restart-required', installedModules: [], stagedModules: [] }),
    })
  })

  it('accepts the Host active identity no-op through the real browser response parser', async () => {
    const transaction = {
      transactionId: 'active-plan', planId: 'active-plan', state: 'active',
      stagedModules: [], installedModules: [], activatedModules: ['workbench.conversation-suite'],
    }
    let calls = 0
    const manager = createWorkbenchModuleManager({
      capabilities: () => ['workbench.conversation.areas'], installed: () => new Map(), importCatalog: importer(),
      commitSignedCatalogInstall: createWorkbenchBrowserSignedCatalogInstallCommit(async () => {
        calls++
        return new Response(JSON.stringify({ transaction }))
      }),
    })
    await manager.importCatalogArchive(new Uint8Array([9]))
    await expect(manager.install('workbench.conversation-suite')).resolves.toEqual(transaction)
    expect(manager.getSnapshot()).toMatchObject({ state: 'active' })
    expect(manager.getSnapshot().restartRequiredTransaction).toBeUndefined()
    await manager.install('workbench.conversation-suite')
    expect(calls).toBe(1)
    await manager.importCatalogArchive(new Uint8Array([9]))
    expect(manager.getSnapshot().state).toBe('catalog-imported')
  })

  it('rejects active responses that claim newly installed artifacts', async () => {
    const commit = createWorkbenchBrowserSignedCatalogInstallCommit(async () => new Response(JSON.stringify({
      transaction: { transactionId: 'hot-install', planId: 'plan', state: 'active',
        stagedModules: [], installedModules: ['workbench.conversation-suite'], activatedModules: ['workbench.conversation-suite'] },
    })))
    await expect(commit({ moduleId: 'workbench.conversation-suite', archive: new Uint8Array([9]) }))
      .rejects.toThrow('invalid restart-required transaction')
  })
})
