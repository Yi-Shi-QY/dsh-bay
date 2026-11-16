import { WORKBENCH_CORE_VERSION, WORKBENCH_SUITE_VERSION, WORKBENCH_DSH_GENERATION, WORKBENCH_UPSTREAM_COMMIT } from '../src/release-compatibility.ts'
import { describe, expect, it, vi } from 'vitest'
import { canonicalizeWorkbenchCatalogJsonV1 } from '../src/signed-catalog.ts'
import { createWorkbenchModuleReceiptStore } from '../src/module-receipt.ts'
import { createWorkbenchInstallTransactionJournal } from '../src/transaction-journal.ts'
import { createWorkbenchHostSignedCatalogInstallService } from '../src/host-module-install-route.ts'
import { installWorkbenchHostSignedCatalogInstallRoute } from '../src/host-module-install-route.ts'
import { createWorkbenchProfileCatalogStore } from '../src/host-catalog-store.ts'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WORKBENCH_TEAM_TRUST_ROOT_V1 } from '../src/signed-catalog.ts'

const digest = (character: string): string => character.repeat(64)
const artifact = new Uint8Array([7, 8, 9])
const integrity = `sha512-${'A'.repeat(86)}`

function catalog(revoked = false): Record<string, unknown> {
  return {
    schemaVersion: 1,
    kind: 'dsh-workbench-team-catalog',
    catalogId: 'host-route-test-catalog',
    compatibility: { dshGeneration: WORKBENCH_DSH_GENERATION, upstreamCommit: WORKBENCH_UPSTREAM_COMMIT, requiredSeams: [] },
    entries: [{
      moduleId: 'workbench.conversation-suite', packageName: '@dsh-workbench/conversation-suite', version: WORKBENCH_SUITE_VERSION,
      artifact: { locator: `artifacts/${digest('a')}.tgz`, sha256: digest('a'), integrity, size: artifact.byteLength },
      dshGeneration: WORKBENCH_DSH_GENERATION, requiredCapabilities: ['workbench.conversation.areas'], permissions: ['dsh.conversation.render'],
      provenance: { upstreamCommit: WORKBENCH_UPSTREAM_COMMIT, sourceDigest: digest('b'), patchDigest: digest('c') },
      publisherKeyId: WORKBENCH_TEAM_TRUST_ROOT_V1.keyId, revoked,
      manifest: { coreCompatibility: WORKBENCH_CORE_VERSION, editorIds: ['workbench.conversation-suite'], scope: 'area' },
    }],
  }
}

function importOptions(value: Record<string, unknown>, signature = true) {
  return {
    archiveReader: { read: async () => [
      { path: 'catalog.json', bytes: canonicalizeWorkbenchCatalogJsonV1(value) },
      { path: 'catalog.sig', bytes: new TextEncoder().encode('AQ==') },
      { path: `artifacts/${digest('a')}.tgz`, bytes: artifact },
    ] },
    verifier: { verify: async () => signature },
    digests: { sha256: async () => digest('a'), sha512Integrity: async () => integrity },
    verifiedSeams: [], allowedPermissions: ['dsh.conversation.render'],
    trustRoot: WORKBENCH_TEAM_TRUST_ROOT_V1,
  }
}

function coordinator() {
  const transaction = {
    transactionId: 'host-transaction-1', planId: 'host-plan', state: 'restart-required' as const,
    stagedModules: ['workbench.conversation-suite'], installedModules: ['workbench.conversation-suite'], activatedModules: [],
  }
  return {
    stagePlan: vi.fn(async () => ({ transactionId: transaction.transactionId })),
    install: vi.fn(async () => undefined),
    getTransaction: vi.fn(() => transaction),
  }
}

describe('Host signed-catalog install authority', () => {
  it('returns the durable pending transaction for repeat clicks without retaining another catalog or staging', async () => {
    const host = coordinator(), stage = vi.fn(), retainCatalog = vi.fn()
    const identity = { moduleId: 'workbench.conversation-suite', version: WORKBENCH_SUITE_VERSION, artifactDigest: digest('a') }
    const receipt = { ...identity, receiptId: 'receipt', planId: 'plan-before-restart', state: 'restart-required' as const, installedAt: '2026-09-19T00:00:00Z' }
    const snapshot = { transactionId: 'durable-transaction', planId: receipt.planId, state: 'restart-required' as const, installedModules: [identity.moduleId], stagedModules: [identity.moduleId], activatedModules: [] }
    const service = createWorkbenchHostSignedCatalogInstallService({
      catalogImport: importOptions(catalog()), capabilities: () => ['workbench.conversation.areas'],
      receipts: createWorkbenchModuleReceiptStore([receipt]),
      journal: createWorkbenchInstallTransactionJournal([{ transactionId: snapshot.transactionId, snapshot, modules: [identity], updatedAt: receipt.installedAt }]),
      artifactStager: { stage }, coordinator: host as never, retainCatalog,
    })
    expect(await service.commit({ moduleId: 'workbench.conversation-suite', archive: new Uint8Array([1]) })).toEqual(snapshot)
    expect(stage).not.toHaveBeenCalled()
    expect(host.stagePlan).not.toHaveBeenCalled()
    expect(retainCatalog).not.toHaveBeenCalled()
  })
  it('retains the original archive across store recreation and refuses altered bytes or unsafe references', async () => {
    const profile = await mkdtemp(join(tmpdir(), 'workbench-catalog-store-'))
    try {
      const options = importOptions(catalog()), bytes = new Uint8Array([1, 9, 7, 3])
      const store = createWorkbenchProfileCatalogStore(profile, options)
      expect(await store.read()).toBeUndefined()
      await store.retain(bytes)
      const fresh = createWorkbenchProfileCatalogStore(profile, options)
      expect((await fresh.read())?.bytes).toEqual(bytes)
      const root = join(profile, '.dsh-workbench', 'catalog-archives-v1')
      const ref = await readFile(join(root, 'current.sha256'), 'utf8')
      await expect(createWorkbenchProfileCatalogStore(profile, importOptions(catalog(), false)).retain(new Uint8Array([2]))).rejects.toThrow('signature')
      expect(await readFile(join(root, 'current.sha256'), 'utf8')).toBe(ref)
      await writeFile(join(root, `${ref}.zip`), new Uint8Array([0]))
      await expect(fresh.read()).rejects.toThrow('verification failed')
      await store.retain(bytes)
      expect((await fresh.read())?.bytes).toEqual(bytes)
      await writeFile(join(root, 'current.sha256'), '../outside')
      await expect(fresh.read()).rejects.toThrow('reference is invalid')
    } finally { await rm(profile, { recursive: true, force: true }) }
  })

  it('keeps installation untouched if original catalog retention fails', async () => {
    const host = coordinator(), stage = vi.fn(async () => {})
    const service = createWorkbenchHostSignedCatalogInstallService({
      catalogImport: importOptions(catalog()), capabilities: () => ['workbench.conversation.areas'],
      receipts: createWorkbenchModuleReceiptStore(), journal: createWorkbenchInstallTransactionJournal(), artifactStager: { stage }, coordinator: host as never,
      retainCatalog: async () => { throw new Error('catalog write failed') },
    })
    await expect(service.commit({ moduleId: 'workbench.conversation-suite', archive: new Uint8Array([1]) })).rejects.toThrow('catalog write failed')
    expect(stage).not.toHaveBeenCalled()
    expect(host.stagePlan).not.toHaveBeenCalled()
  })

  it('registers the route when Host services are visible only through non-strict lookup', () => {
    const service = { commit: vi.fn() }
    const register = vi.fn(() => vi.fn())
    const services = new Map<string, unknown>([
      ['webServer', { register }],
      ['workbenchHostSignedCatalogInstaller', service],
    ])
    const get = vi.fn(<T>(name: string, strict = true) => (strict ? undefined : services.get(name)) as T | undefined)
    const dispose = installWorkbenchHostSignedCatalogInstallRoute({ get })
    expect(dispose).toEqual(expect.any(Function))
    expect(register).toHaveBeenCalledWith(expect.objectContaining({ path: '/api/workbench/module-install/v1' }))
    expect(get).toHaveBeenCalledWith('webServer', false)
    expect(get).toHaveBeenCalledWith('workbenchHostSignedCatalogInstaller', false)
  })

  it('revalidates the complete archive, stages only its exact artifact, then commits a restart transaction', async () => {
    const stage = vi.fn(async () => undefined)
    const host = coordinator()
    const service = createWorkbenchHostSignedCatalogInstallService({
      catalogImport: importOptions(catalog()),
      capabilities: () => ['workbench.conversation.areas'],
      receipts: createWorkbenchModuleReceiptStore(), journal: createWorkbenchInstallTransactionJournal(),
      artifactStager: { stage }, coordinator: host as never,
    })
    await expect(service.commit({ moduleId: 'workbench.conversation-suite', archive: new Uint8Array([1]) })).resolves.toMatchObject({ state: 'restart-required' })
    expect(stage).toHaveBeenCalledWith(expect.objectContaining({
      moduleId: 'workbench.conversation-suite', artifactDigest: digest('a'), packageName: '@dsh-workbench/conversation-suite', tarball: artifact,
    }))
    expect(host.stagePlan).toHaveBeenCalledOnce()
    expect(host.install).toHaveBeenCalledWith('host-transaction-1')
  })

  it('rejects signature failure and revocation before staging or transaction creation', async () => {
    const stage = vi.fn(async () => undefined)
    const host = coordinator()
    const unsigned = createWorkbenchHostSignedCatalogInstallService({
      catalogImport: importOptions(catalog(), false), capabilities: () => ['workbench.conversation.areas'],
      receipts: createWorkbenchModuleReceiptStore(), journal: createWorkbenchInstallTransactionJournal(), artifactStager: { stage }, coordinator: host as never,
    })
    await expect(unsigned.commit({ moduleId: 'workbench.conversation-suite', archive: new Uint8Array([1]) })).rejects.toThrow('signature verification failed')

    const revoked = createWorkbenchHostSignedCatalogInstallService({
      catalogImport: importOptions(catalog(true)), capabilities: () => ['workbench.conversation.areas'],
      receipts: createWorkbenchModuleReceiptStore(), journal: createWorkbenchInstallTransactionJournal(), artifactStager: { stage }, coordinator: host as never,
    })
    await expect(revoked.commit({ moduleId: 'workbench.conversation-suite', archive: new Uint8Array([1]) })).rejects.toThrow('revoked')
    expect(stage).not.toHaveBeenCalled()
    expect(host.stagePlan).not.toHaveBeenCalled()
  })

  it('reuses a verified exact active identity without staging or a new transaction', async () => {
    const stage = vi.fn(async () => undefined)
    const host = coordinator()
    const receipts = createWorkbenchModuleReceiptStore([{
      receiptId: 'active-plan:workbench.conversation-suite', planId: 'active-plan', moduleId: 'workbench.conversation-suite',
      version: WORKBENCH_SUITE_VERSION, artifactDigest: digest('a'), state: 'active', installedAt: '2026-09-06T00:00:00.000Z',
    }])
    const service = createWorkbenchHostSignedCatalogInstallService({
      catalogImport: importOptions(catalog()), capabilities: () => ['workbench.conversation.areas'], receipts,
      journal: createWorkbenchInstallTransactionJournal(), artifactStager: { stage }, coordinator: host as never,
      verifyReusable: async () => {},
    })

    await expect(service.commit({ moduleId: 'workbench.conversation-suite', archive: new Uint8Array([1]) })).resolves.toMatchObject({ planId: 'active-plan', state: 'active' })
    expect(stage).not.toHaveBeenCalled()
    expect(host.stagePlan).not.toHaveBeenCalled()
    expect(host.install).not.toHaveBeenCalled()
  })

  it('stages an exact active identity for protected repair when installed bytes fail verification', async () => {
    const host = coordinator(), stage = vi.fn(async () => {})
    const receipts = createWorkbenchModuleReceiptStore([{
      receiptId: 'active:workbench.conversation-suite', planId: 'active', moduleId: 'workbench.conversation-suite',
      version: WORKBENCH_SUITE_VERSION, artifactDigest: digest('a'), state: 'active', installedAt: '2026-09-06T00:00:00.000Z',
    }])
    const service = createWorkbenchHostSignedCatalogInstallService({
      catalogImport: importOptions(catalog()), capabilities: () => ['workbench.conversation.areas'], receipts,
      journal: createWorkbenchInstallTransactionJournal(), artifactStager: { stage }, coordinator: host as never,
      verifyReusable: async () => { throw new Error('corrupted installed bytes') },
    })
    expect((await service.commit({ moduleId: 'workbench.conversation-suite', archive: new Uint8Array([1]) })).state).toBe('restart-required')
    expect(stage).toHaveBeenCalledOnce()
    expect(host.stagePlan).toHaveBeenCalledWith(expect.objectContaining({ toInstall: [], reused: [expect.objectContaining({ moduleId: 'workbench.conversation-suite' })] }),
      expect.any(String), [expect.objectContaining({ moduleId: 'workbench.conversation-suite', artifactDigest: digest('a') })])
  })
})
