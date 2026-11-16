import { describe, expect, it } from 'vitest'
import { createWorkbenchModuleInstallCoordinator, type WorkbenchModuleInstallAdapterV1 } from '../src/install-coordinator.ts'
import type { WorkbenchCompositionPackageV2 } from '../src/composition-package.ts'
import { createWorkbenchModuleCatalog } from '../src/module-catalog.ts'
import { createWorkbenchModuleInstallPlan, type WorkbenchModuleInstallPlanV1 } from '../src/install-plan.ts'
import { createWorkbenchModuleReceiptStore } from '../src/module-receipt.ts'
import { createWorkbenchInstallTransactionJournal } from '../src/transaction-journal.ts'

const digest = (character: string): string => character.repeat(64)
const core = { moduleId: 'workbench.core', version: '1.0.0', artifactDigest: digest('a') } as const
const suite = { moduleId: 'workbench.conversation-suite', version: '1.0.0', artifactDigest: digest('b') } as const

const composition = (): WorkbenchCompositionPackageV2 => ({
  format: 'dsh-workbench-package', schemaVersion: 2,
  core,
  modules: [suite],
  workbench: { document: {}, activeEditors: [] },
  dependencies: { lockDigest: digest('c'), moduleArtifacts: [], npmArtifacts: [], agentArtifacts: [], skills: [], mcp: [] },
  runtimeRequirements: { dshVersion: '>=1.0.0', capabilities: [] },
  recipientBindings: { workspace: 'needs-recipient-binding', session: 'recipient-local', credentials: 'never-exported' },
  provenance: { exporter: 'test' },
})

function signedPlan(): WorkbenchModuleInstallPlanV1 {
  const catalog = createWorkbenchModuleCatalog([{
    ...suite,
    coreCompatibility: '*',
    requires: { modules: [], capabilities: [] },
    source: { kind: 'signed-local-catalog', locator: `artifacts/${suite.artifactDigest}.tgz` },
    signedCatalog: {
      catalogId: 'team-fixture', publisherKeyId: 'dsh-workbench-team-ed25519-v1', packageName: '@dsh-workbench/conversation-suite', integrity: `sha512-${'A'.repeat(86)}`, size: 3,
      dshGeneration: '0.1.5-alpha.2', permissions: [],
      provenance: { upstreamCommit: 'b2e3b2a0125854567a4a5fcba75782e42fe84901', sourceDigest: digest('c'), patchDigest: digest('d') },
      revoked: false,
    },
    manifest: { ...suite, coreCompatibility: '*', provides: { editorIds: ['workbench.conversation-suite'], surfaces: ['workbench.conversation-suite'] }, requires: { capabilities: [], modules: [] }, activation: { mode: 'workbench', scope: 'area' } },
  }])
  return createWorkbenchModuleInstallPlan({ source: 'signed-local-catalog', requested: [{ moduleId: suite.moduleId }], catalog, capabilities: [] })
}

function adapter(options: {
  readonly installed?: Map<string, { version: string; artifactDigest: string }>
  readonly calls?: string[]
  readonly failInstall?: string
  readonly failVerify?: string
  readonly capabilities?: readonly string[]
} = {}): { calls: string[]; installed: Map<string, { version: string; artifactDigest: string }>; value: WorkbenchModuleInstallAdapterV1 } {
  const installed = options.installed ?? new Map<string, { version: string; artifactDigest: string }>()
  const calls = options.calls ?? []
  return {
    calls,
    installed,
    value: {
      capabilities: () => options.capabilities ?? [],
      installed: id => installed.get(id),
      stage: async module => { calls.push(`stage:${module.moduleId}`) },
      install: async module => {
        calls.push(`install:${module.moduleId}`)
        if (module.moduleId === options.failInstall) throw new Error('install failed')
        installed.set(module.moduleId, { version: module.version, artifactDigest: module.artifactDigest })
      },
      verify: async module => {
        calls.push(`verify:${module.moduleId}`)
        if (module.moduleId === options.failVerify) throw new Error('verification failed')
      },
      activate: async id => { calls.push(`activate:${id}`) },
      rollback: async id => { calls.push(`rollback:${id}`); installed.delete(id) },
    },
  }
}

describe('WorkbenchModuleInstallCoordinatorV1', () => {
  it('repairs an existing identity but preserves it and its receipt if restart verification fails', async () => {
    const journal = createWorkbenchInstallTransactionJournal(), value = adapter({ installed: new Map([[suite.moduleId, suite]]) })
    const previous = { ...suite, receiptId: 'previous', planId: 'previous', state: 'active' as const, installedAt: '2026-09-09T00:00:00.000Z' }
    const receipts = createWorkbenchModuleReceiptStore([previous])
    value.value = { ...value.value, repair: async module => { value.calls.push(`repair:${module.moduleId}`) } }
    const original = signedPlan(), plan = { ...original, toInstall: [], reused: [suite] }
    const first = createWorkbenchModuleInstallCoordinator(value.value, { receipts, journal })
    const tx = await first.stagePlan(plan, 'repair', [suite])
    await first.install(tx.transactionId)
    expect(value.calls).toContain(`repair:${suite.moduleId}`)
    expect(receipts.get(suite.moduleId)?.state).toBe('restart-required')
    const next = createWorkbenchModuleInstallCoordinator({ ...value.value, verify: async () => { throw new Error('still corrupted') } }, { receipts, journal })
    await expect(next.verifyAfterRestart(tx.transactionId)).rejects.toThrow('still corrupted')
    expect(value.calls).not.toContain(`rollback:${suite.moduleId}`)
    expect(value.installed.get(suite.moduleId)).toEqual(suite)
    expect(receipts.get(suite.moduleId)).toEqual(previous)
  })

  it('recovers when restart-required journal was committed before its receipt', async () => {
    const journal = createWorkbenchInstallTransactionJournal(), receipts = createWorkbenchModuleReceiptStore(), value = adapter()
    const first = createWorkbenchModuleInstallCoordinator(value.value, { receipts, journal })
    const tx = await first.stagePlan(signedPlan())
    const staged = receipts.get(suite.moduleId)!
    await first.install(tx.transactionId)
    const interruptedReceipts = createWorkbenchModuleReceiptStore([staged])
    const recovered = createWorkbenchModuleInstallCoordinator({ ...value.value, installed: id => {
      const row = interruptedReceipts.get(id); return row?.state === 'staged' ? undefined : row
    } }, { receipts: interruptedReceipts, journal })
    await recovered.verifyAfterRestart(tx.transactionId)
    expect(interruptedReceipts.get(suite.moduleId)?.state).toBe('active')
    expect(value.calls).not.toContain(`rollback:${suite.moduleId}`)
  })

  it('retries incomplete rollback after restart without recording a false rolled-back receipt', async () => {
    const journal = createWorkbenchInstallTransactionJournal(), receipts = createWorkbenchModuleReceiptStore(), value = adapter()
    const first = createWorkbenchModuleInstallCoordinator({ ...value.value, rollback: async () => { throw new Error('locked package') } }, { receipts, journal })
    const tx = await first.stagePlan(signedPlan()); await first.install(tx.transactionId)
    await expect(first.rollback(tx.transactionId)).rejects.toThrow('locked package')
    expect(receipts.get(suite.moduleId)?.state).toBe('restart-required')
    expect(journal.get(tx.transactionId)?.snapshot.state).toBe('rolling-back')
    await createWorkbenchModuleInstallCoordinator(value.value, { receipts, journal }).rollback(tx.transactionId)
    expect(receipts.get(suite.moduleId)?.state).toBe('rolled-back')
    expect(value.installed.has(suite.moduleId)).toBe(false)
  })
  it('records ownership before a failing installer leaves partially installed files', async () => {
    const journal = createWorkbenchInstallTransactionJournal(), value = adapter()
    value.value = { ...value.value, install: async module => {
      expect(journal.list()[0]?.snapshot.installedModules).toContain(module.moduleId)
      value.installed.set(module.moduleId, module)
      throw new Error('installer failed after filesystem mutation')
    } }
    const coordinator = createWorkbenchModuleInstallCoordinator(value.value, { journal })
    const { transactionId } = await coordinator.stagePlan(signedPlan(), 'workbench-install-owned-before-effects')
    await expect(coordinator.install(transactionId)).rejects.toThrow('filesystem mutation')
    expect(value.installed.has(suite.moduleId)).toBe(false)
    expect(value.calls).toContain(`rollback:${suite.moduleId}`)
  })

  it('can roll back an undelivered active Module even after a second restart', async () => {
    const journal = createWorkbenchInstallTransactionJournal(), value = adapter()
    const first = createWorkbenchModuleInstallCoordinator(value.value, { journal })
    const tx = await first.stagePlan(signedPlan()); await first.install(tx.transactionId)
    await createWorkbenchModuleInstallCoordinator(value.value, { journal }).verifyAfterRestart(tx.transactionId)
    await createWorkbenchModuleInstallCoordinator(value.value, { journal }).rollback(tx.transactionId)
    expect(value.installed.has(suite.moduleId)).toBe(false)
    expect(journal.get(tx.transactionId)?.snapshot.state).toBe('rolled-back')
  })
  it('distinguishes missing modules from exact identity reuse', async () => {
    const first = adapter()
    const missing = await createWorkbenchModuleInstallCoordinator(first.value).preflight(composition())
    expect(missing).toMatchObject({ ok: true, missingModules: ['workbench.core', 'workbench.conversation-suite'], conflicts: [] })
    const same = adapter({ installed: new Map([[core.moduleId, core], [suite.moduleId, suite]]) })
    expect(await createWorkbenchModuleInstallCoordinator(same.value).preflight(composition())).toMatchObject({ ok: true, missingModules: [], conflicts: [] })
  })

  it('reports an identity conflict and blocks staging', async () => {
    const value = adapter({ installed: new Map([[core.moduleId, { version: '0.9.0', artifactDigest: digest('a') }]]) })
    const coordinator = createWorkbenchModuleInstallCoordinator(value.value)
    expect((await coordinator.preflight(composition())).conflicts).toHaveLength(1)
    await expect(coordinator.stage(composition())).rejects.toThrow('identity conflict')
  })

  it('rolls back only newly installed Modules when installation fails', async () => {
    const value = adapter({ failInstall: suite.moduleId })
    const coordinator = createWorkbenchModuleInstallCoordinator(value.value)
    const { transactionId } = await coordinator.stage(composition())
    await expect(coordinator.install(transactionId)).rejects.toThrow('install failed')
    expect(value.calls).toEqual(expect.arrayContaining(['install:workbench.core', 'install:workbench.conversation-suite', 'rollback:workbench.core']))
  })

  it('requires a DSH restart instead of activating a newly installed Module in-process', async () => {
    const value = adapter()
    const receipts = createWorkbenchModuleReceiptStore()
    const coordinator = createWorkbenchModuleInstallCoordinator(value.value, { receipts })
    const { transactionId } = await coordinator.stagePlan(signedPlan())
    await coordinator.install(transactionId)
    expect(coordinator.getTransaction(transactionId)?.state).toBe('restart-required')
    expect(receipts.get(suite.moduleId)?.state).toBe('restart-required')
    await expect(coordinator.activate(transactionId, { explicitRecipientBinding: true })).rejects.toThrow('DSH restart')
    await expect(coordinator.verifyAfterRestart(transactionId)).rejects.toThrow('rehydrated transaction')
    expect(value.calls).not.toContain(`activate:${suite.moduleId}`)
  })

  it('claims an exact external package without installing it', async () => {
    const journal = createWorkbenchInstallTransactionJournal(), receipts = createWorkbenchModuleReceiptStore()
    const calls: string[] = []
    const value = adapter({ installed: new Map([[suite.moduleId, suite]]), calls })
    let claimed = false
    value.value = { ...value.value,
      claim: async () => { calls.push('claim'); claimed = true },
      unclaim: async () => { calls.push('unclaim'); claimed = false },
      verify: async module => { calls.push(`verify:${module.moduleId}`); if (claimed) throw new Error('claim verification failed') },
    }
    const coordinator = createWorkbenchModuleInstallCoordinator(value.value, { receipts, journal })
    const tx = await coordinator.stagePlan(signedPlan(), 'claim-exact', [], [suite])
    await coordinator.install(tx.transactionId)
    expect(calls).toContain('claim')
    expect(calls).not.toContain(`install:${suite.moduleId}`)
    expect(value.installed.get(suite.moduleId)).toEqual(suite)
    expect(receipts.get(suite.moduleId)?.state).toBe('restart-required')
  })

  it('rehydrates after restart, verifies installed identity, then activates', async () => {
    const journal = createWorkbenchInstallTransactionJournal()
    const first = adapter()
    const tx = await createWorkbenchModuleInstallCoordinator(first.value, { journal }).stagePlan(signedPlan())
    await createWorkbenchModuleInstallCoordinator(first.value, { journal }).install(tx.transactionId)
    const restarted = adapter({ installed: first.installed, calls: first.calls })
    const recovered = createWorkbenchModuleInstallCoordinator(restarted.value, { journal })
    await recovered.verifyAfterRestart(tx.transactionId)
    expect(recovered.getTransaction(tx.transactionId)?.state).toBe('active')
    expect(restarted.calls).toEqual(expect.arrayContaining([`verify:${suite.moduleId}`, `activate:${suite.moduleId}`]))
  })

  it('rolls back a newly introduced artifact when post-restart verification fails', async () => {
    const journal = createWorkbenchInstallTransactionJournal()
    const first = adapter()
    const tx = await createWorkbenchModuleInstallCoordinator(first.value, { journal }).stagePlan(signedPlan())
    await createWorkbenchModuleInstallCoordinator(first.value, { journal }).install(tx.transactionId)
    const restarted = adapter({ installed: first.installed, calls: first.calls, failVerify: suite.moduleId })
    const recovered = createWorkbenchModuleInstallCoordinator(restarted.value, { journal })
    await expect(recovered.verifyAfterRestart(tx.transactionId)).rejects.toThrow('verification failed')
    expect(restarted.calls).toContain(`rollback:${suite.moduleId}`)
    expect(restarted.installed.has(suite.moduleId)).toBe(false)
    expect(recovered.getTransaction(tx.transactionId)?.state).toBe('rolled-back')
  })

  it('never rolls back a reused exact identity after a failed verification', async () => {
    const journal = createWorkbenchInstallTransactionJournal()
    const installed = new Map<string, { version: string; artifactDigest: string }>([[suite.moduleId, suite]])
    const first = adapter({ installed })
    const plan = signedPlan()
    const tx = await createWorkbenchModuleInstallCoordinator(first.value, { journal }).stagePlan(plan)
    await createWorkbenchModuleInstallCoordinator(first.value, { journal }).install(tx.transactionId)
    const restarted = adapter({ installed, calls: first.calls, failVerify: suite.moduleId })
    await expect(createWorkbenchModuleInstallCoordinator(restarted.value, { journal }).verifyAfterRestart(tx.transactionId)).rejects.toThrow('verification failed')
    expect(restarted.calls).not.toContain(`rollback:${suite.moduleId}`)
    expect(installed.get(suite.moduleId)).toEqual(suite)
  })

  it('resumes an interrupted staged transaction after restart', async () => {
    const journal = createWorkbenchInstallTransactionJournal()
    const first = adapter()
    const tx = await createWorkbenchModuleInstallCoordinator(first.value, { journal }).stagePlan(signedPlan())
    const restarted = adapter({ installed: first.installed, calls: first.calls })
    const recovered = createWorkbenchModuleInstallCoordinator(restarted.value, { journal })
    await recovered.install(tx.transactionId)
    expect(recovered.getTransaction(tx.transactionId)?.state).toBe('restart-required')
    expect(restarted.calls).toContain(`install:${suite.moduleId}`)
    await expect(recovered.verifyAfterRestart(tx.transactionId)).rejects.toThrow('rehydrated transaction')
    const nextStart = createWorkbenchModuleInstallCoordinator(restarted.value, { journal })
    await nextStart.verifyAfterRestart(tx.transactionId)
    expect(nextStart.getTransaction(tx.transactionId)?.state).toBe('active')
  })

  it('repeats verification after interruption during the verification phase', async () => {
    const journal = createWorkbenchInstallTransactionJournal()
    const value = adapter()
    const first = createWorkbenchModuleInstallCoordinator(value.value, { journal })
    const tx = await first.stagePlan(signedPlan())
    await first.install(tx.transactionId)
    const record = journal.get(tx.transactionId)!
    journal.save({ ...record, snapshot: { ...record.snapshot, state: 'verifying' } })
    const recovered = createWorkbenchModuleInstallCoordinator(value.value, { journal })
    await recovered.verifyAfterRestart(tx.transactionId)
    expect(recovered.getTransaction(tx.transactionId)?.state).toBe('active')
    expect(value.calls).toContain(`verify:${suite.moduleId}`)
  })
})
