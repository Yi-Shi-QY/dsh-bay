import { describe, expect, it } from 'vitest'
import { validateWorkbenchCompositionPackageV2, type WorkbenchCompositionPackageV2 } from '../src/composition-package.ts'
import { createWorkbenchContributionRegistry } from '../src/contributions.ts'
import { createWorkbenchModuleRegistry } from '../src/module-registry.ts'
import type { WorkbenchModuleContextV1, WorkbenchModuleV1 } from '../src/module-contract.ts'
import { createWorkbenchModuleContextV1 } from '../src/module-contract.ts'

const digest = (character: string): string => character.repeat(64)
const validPackage = (): WorkbenchCompositionPackageV2 => ({
  format: 'dsh-workbench-package', schemaVersion: 2,
  core: { moduleId: 'workbench.core', version: '1.0.0', artifactDigest: digest('a') },
  modules: [{ moduleId: 'workbench.shell', version: '1.0.0', artifactDigest: digest('b') }],
  workbench: { document: {}, activeEditors: [] },
  dependencies: { lockDigest: digest('c'), moduleArtifacts: [], npmArtifacts: [], agentArtifacts: [], skills: [], mcp: [] },
  runtimeRequirements: { dshVersion: '>=1.0.0', capabilities: [] },
  recipientBindings: { workspace: 'needs-recipient-binding', session: 'recipient-local', credentials: 'never-exported' },
  provenance: { exporter: 'test' },
})

describe('WorkbenchCompositionPackageV2', () => {
  it('accepts exact identities and recipient-safe bindings', () => {
    expect(() => validateWorkbenchCompositionPackageV2(validPackage())).not.toThrow()
  })
  it('rejects credentials and repeated Core', () => {
    const unsafe = { ...validPackage(), recipientBindings: { ...validPackage().recipientBindings, credentials: 'exported' } }
    expect(() => validateWorkbenchCompositionPackageV2(unsafe)).toThrow('Credentials')
    expect(() => validateWorkbenchCompositionPackageV2({ ...validPackage(), modules: [validPackage().core] })).toThrow('Core')
  })
  it('rejects duplicate module identity entries', () => {
    const base = validPackage()
    const duplicate = { ...base, modules: [base.modules[0]!, base.modules[0]!] }
    expect(() => validateWorkbenchCompositionPackageV2(duplicate)).toThrow('Duplicate')
  })
  it('rejects a module artifact whose identity or locator is unsafe', () => {
    const base = validPackage()
    const artifact = { moduleId: 'workbench.shell', packageName: '@dsh-workbench/shell', version: '1.0.0', artifactDigest: digest('c'), integrity: 'sha512-A', tarball: 'artifacts/shell.tgz', size: 3 }
    expect(() => validateWorkbenchCompositionPackageV2({ ...base, dependencies: { ...base.dependencies, moduleArtifacts: [artifact] } })).toThrow('identity mismatch')
    expect(() => validateWorkbenchCompositionPackageV2({ ...base, dependencies: { ...base.dependencies, moduleArtifacts: [{ ...artifact, artifactDigest: digest('b'), tarball: '../shell.tgz' }] } })).toThrow('path')
  })
})

describe('WorkbenchModuleManifestV1', () => {
  it('rejects claims against official owners', async () => {
    const { validateWorkbenchModuleManifestV1 } = await import('../src/module-contract.ts')
    expect(() => validateWorkbenchModuleManifestV1({ moduleId: 'workbench.bad-owner', version: '1.0.0', coreCompatibility: '*', artifactDigest: digest('e'), provides: { editorIds: [], surfaces: ['conversation'] }, requires: { capabilities: [], modules: [] }, activation: { mode: 'workbench', scope: 'root' } })).toThrow('official owner')
  })
  it('rejects accidental private Core state exposure', () => {
    expect(() => createWorkbenchModuleContextV1({ repository: {}, mode: {}, surface: {}, areas: {}, sessions: {}, editors: {}, persistence: {}, settings: {}, host: {}, diagnostics: {} } as never)).toThrow('private state')
  })
})

describe('WorkbenchContributionRegistryV1', () => {
  it('registers additive module contributions and disposes them', () => {
    const registry = createWorkbenchContributionRegistry()
    const dispose = registry.register({ id: 'workbench.shell.sidebar', kind: 'surface' })
    expect(registry.list()).toHaveLength(1)
    expect(() => registry.register({ id: 'workbench.shell.sidebar', kind: 'surface' })).toThrow('conflict')
    dispose()
    expect(registry.list()).toHaveLength(0)
  })

  it('disposes contributions owned by a module during deactivation', async () => {
    const contributions = createWorkbenchContributionRegistry()
    const diagnostics = { report: () => {}, list: () => [] }
    const context = {
      mode: { getSnapshot: () => ({}), subscribe: () => () => {} }, surface: { getSnapshot: () => ({}), subscribe: () => () => {} },
      areas: { claim: () => ({}), release: () => {} }, sessions: { place: async () => ({}), bindExisting: async () => ({}), release: async () => {} },
      editors: { register: () => () => {}, catalog: () => [] }, persistence: { getSnapshot: () => ({}), update: async () => {}, subscribe: () => () => {} },
      settings: { getDirectory: () => '' }, host: {
        capabilities: () => [], invoke: async () => ({}), stageModule: async () => {}, installModule: async () => {},
        activateModule: async () => {}, rollbackModule: async () => {}, createRecipientBinding: async () => ({ bindingId: 'test' }), readReceipts: async () => [],
      }, diagnostics,
      contributions,
    } satisfies WorkbenchModuleContextV1
    const module: WorkbenchModuleV1 = {
      manifest: { moduleId: 'workbench.test', version: '1.0.0', coreCompatibility: '*', artifactDigest: digest('d'), provides: { editorIds: [], surfaces: [] }, requires: { capabilities: [], modules: [] }, activation: { mode: 'both', scope: 'root' } },
      register: () => {}, activate: async ctx => { ctx.contributions?.register({ id: 'test.contribution', kind: 'test' }) }, deactivate: async () => {}, migrate: async () => ({ status: 'unchanged' }),
    }
    const registry = createWorkbenchModuleRegistry({ context })
    registry.register(module)
    await registry.activate('workbench.test')
    expect(contributions.list()).toHaveLength(1)
    await registry.deactivate('workbench.test')
    expect(contributions.list()).toHaveLength(0)
  })
})
