import { describe, expect, it } from 'vitest'
import { workbenchModuleDeliveryFor, workbenchModuleKindFor, validateWorkbenchModuleManifestV1 } from '../src/module-contract.ts'
import { createWorkbenchModuleCatalog } from '../src/module-catalog.ts'

const digest = 'a'.repeat(64)

describe('Workbench module product categories', () => {
  it('classifies first-party DSH surfaces as official built-ins', () => {
    expect(workbenchModuleKindFor({ moduleId: 'workbench.core' })).toBe('official-builtin')
    expect(workbenchModuleKindFor({ moduleId: 'workbench.conversation-suite' })).toBe('official-builtin')
    expect(workbenchModuleDeliveryFor({ moduleId: 'workbench.core' })).toBe('core-bundled')
    expect(workbenchModuleDeliveryFor({ moduleId: 'workbench.conversation-suite' })).toBe('official-component')
  })

  it('classifies an explicitly declared module without conflating trust or source', () => {
    expect(workbenchModuleKindFor({ moduleId: 'workbench.creator', kind: 'extension' })).toBe('extension')
    expect(workbenchModuleKindFor({ moduleId: 'workbench.creator', kind: 'official-builtin' })).toBe('official-builtin')
    expect(workbenchModuleDeliveryFor({ moduleId: 'workbench.creator', kind: 'extension' })).toBe('catalog')
  })

  it('keeps the category in the manifest contract without allowing official owner takeover', () => {
    expect(() => validateWorkbenchModuleManifestV1({
      moduleId: 'workbench.creator', kind: 'extension', version: '1.0.0', coreCompatibility: '*', artifactDigest: digest,
      provides: { editorIds: ['workbench.creator'], surfaces: ['workbench.extension'] },
      requires: { capabilities: [], modules: [] }, activation: { mode: 'workbench', scope: 'root' },
    })).not.toThrow()
    expect(() => validateWorkbenchModuleManifestV1({
      moduleId: 'workbench.bad-owner', kind: 'extension', version: '1.0.0', coreCompatibility: '*', artifactDigest: digest,
      provides: { editorIds: [], surfaces: ['sidebar'] }, requires: { capabilities: [], modules: [] },
      activation: { mode: 'workbench', scope: 'root' },
    })).toThrow('official owner')
    expect(() => validateWorkbenchModuleManifestV1({
      moduleId: 'workbench.creator', kind: 'extension', delivery: 'official-component', version: '1.0.0', coreCompatibility: '*', artifactDigest: digest,
      provides: { editorIds: ['workbench.creator'], surfaces: ['workbench.extension'] }, requires: { capabilities: [], modules: [] }, activation: { mode: 'workbench', scope: 'root' },
    })).toThrow('official delivery')
    expect(() => validateWorkbenchModuleManifestV1({
      moduleId: 'workbench.conversation-suite', kind: 'official-builtin', delivery: 'direct-source', version: '1.0.0', coreCompatibility: '*', artifactDigest: digest,
      provides: { editorIds: ['workbench.conversation'], surfaces: ['workbench.conversation'] }, requires: { capabilities: [], modules: ['workbench.core'] }, activation: { mode: 'workbench', scope: 'area' },
    })).toThrow('extension delivery')
  })

  it('keeps an extension category distinct in the Catalog projection', () => {
    const catalog = createWorkbenchModuleCatalog([{
      moduleId: 'workbench.creator', kind: 'extension', version: '1.0.0', artifactDigest: digest, coreCompatibility: '*',
      requires: { modules: [], capabilities: [] }, source: { kind: 'registry', locator: 'npm:@example/creator@1.0.0' },
    }])
    expect(catalog.list()[0]?.kind).toBe('extension')
    expect(workbenchModuleKindFor(catalog.list()[0]!)).toBe('extension')
  })
})
