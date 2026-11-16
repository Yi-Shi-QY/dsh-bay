import { describe, expect, it } from 'vitest'
import { createWorkbenchModuleCatalog } from '../src/module-catalog.ts'
import { createWorkbenchModuleInstallPlan } from '../src/install-plan.ts'
import { createWorkbenchCompositionInstallPlan } from '../src/install-plan.ts'
import type { WorkbenchCompositionPackageV2 } from '../src/composition-package.ts'

const digest = (character: string): string => character.repeat(64)
const entry = (moduleId: string, character: string, requires: string[] = [], capabilities: string[] = []) => ({
  moduleId, version: '1.0.0', artifactDigest: digest(character), coreCompatibility: '*',
  requires: { modules: requires.map(moduleId => ({ moduleId })), capabilities },
  source: { kind: 'embedded' as const, locator: `artifacts/${digest(character)}` },
})

describe('WorkbenchModuleInstallPlanV1', () => {
  it('uses one plan for a market request and resolves transitive dependencies', () => {
    const catalog = createWorkbenchModuleCatalog([entry('workbench.shell', 'b', ['workbench.core']), entry('workbench.core', 'a')])
    const plan = createWorkbenchModuleInstallPlan({ source: 'market', requested: [{ moduleId: 'workbench.shell' }], catalog, capabilities: [] })
    expect(plan.status).toBe('ready')
    expect(plan.resolved.map(item => item.moduleId)).toEqual(['workbench.core', 'workbench.shell'])
    expect(plan.dependencies).toEqual([{ from: 'workbench.shell', to: 'workbench.core' }])
    expect(plan.toInstall.map(item => item.moduleId)).toEqual(['workbench.core', 'workbench.shell'])
  })

  it('distinguishes reused identities from digest conflicts', () => {
    const catalog = createWorkbenchModuleCatalog([entry('workbench.shell', 'b')])
    const reused = createWorkbenchModuleInstallPlan({ source: 'composition-package', requested: [{ moduleId: 'workbench.shell', version: '1.0.0', artifactDigest: digest('b') }], catalog, installed: new Map([['workbench.shell', { moduleId: 'workbench.shell', version: '1.0.0', artifactDigest: digest('b') }]]) })
    expect(reused).toMatchObject({ status: 'ready', toInstall: [], reused: [{ moduleId: 'workbench.shell' }] })
    const conflict = createWorkbenchModuleInstallPlan({ source: 'composition-package', requested: [{ moduleId: 'workbench.shell' }], catalog, installed: new Map([['workbench.shell', { moduleId: 'workbench.shell', version: '0.9.0', artifactDigest: digest('c') }]]) })
    expect(conflict.status).toBe('blocked')
    expect(conflict.blockers.some(blocker => blocker.code === 'identity-conflict')).toBe(true)
  })

  it('fails closed on missing capabilities, missing modules and cycles', () => {
    const catalog = createWorkbenchModuleCatalog([
      entry('workbench.shell', 'b', ['workbench.missing'], ['sessions.scope']),
      { ...entry('workbench.a', 'a', ['workbench.b']), requires: { modules: [{ moduleId: 'workbench.b' }], capabilities: [] } },
      { ...entry('workbench.b', 'b', ['workbench.a']), requires: { modules: [{ moduleId: 'workbench.a' }], capabilities: [] } },
    ])
    const blocked = createWorkbenchModuleInstallPlan({ source: 'market', requested: [{ moduleId: 'workbench.shell' }], catalog, capabilities: [] })
    expect(blocked.status).toBe('blocked')
    expect(blocked.blockers.map(blocker => blocker.code)).toEqual(expect.arrayContaining(['missing-module', 'capability']))
    const cycle = createWorkbenchModuleInstallPlan({ source: 'market', requested: [{ moduleId: 'workbench.a' }], catalog, capabilities: [] })
    expect(cycle.blockers.some(blocker => blocker.code === 'dependency-cycle')).toBe(true)
  })

  it('routes a composition package through the same plan resolver as market install', () => {
    const catalog = createWorkbenchModuleCatalog([entry('workbench.core', 'a'), entry('workbench.shell', 'b', ['workbench.core'])])
    const composition: WorkbenchCompositionPackageV2 = {
      format: 'dsh-workbench-package', schemaVersion: 2,
      core: { moduleId: 'workbench.core', version: '1.0.0', artifactDigest: digest('a') },
      modules: [{ moduleId: 'workbench.shell', version: '1.0.0', artifactDigest: digest('b') }],
      workbench: { document: {}, activeEditors: [] },
      dependencies: { lockDigest: digest('c'), moduleArtifacts: [], npmArtifacts: [], agentArtifacts: [], skills: [], mcp: [] },
      runtimeRequirements: { dshVersion: '>=1.0.0', capabilities: [] },
      recipientBindings: { workspace: 'needs-recipient-binding', session: 'recipient-local', credentials: 'never-exported' },
      provenance: { exporter: 'test' },
    }
    const plan = createWorkbenchCompositionInstallPlan(composition, catalog)
    expect(plan.source).toBe('composition-package')
    expect(plan.dependencies).toEqual([{ from: 'workbench.shell', to: 'workbench.core' }])
    expect(plan.status).toBe('ready')
  })
})
