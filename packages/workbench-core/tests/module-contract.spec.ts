import { describe, expect, it } from 'vitest'
import { validateWorkbenchEditorDeclarationV1, validateWorkbenchModuleManifestV1 } from '../src/module-contract.ts'

const declaration = {
  editorId: 'example.pet.page',
  scope: 'root' as const,
  label: 'Pet',
  requiredBinding: 'none' as const,
  state: { schemaVersion: 1, maxBytes: 2048, restore: 'if-valid' as const, share: 'forbidden' as const },
  runtime: { background: 'pause' as const, collapsed: 'dispose' as const, reacquire: 'on-visible' as const },
}

describe('Workbench editor contract', () => {
  it('rejects the unsupported area render scope', () => {
    expect(() => validateWorkbenchEditorDeclarationV1({ ...declaration, scope: 'area' })).toThrow('root 或 session')
  })

  it('rejects area editor declarations embedded in a module manifest', () => {
    expect(() => validateWorkbenchModuleManifestV1({
      moduleId: 'workbench.example', version: '1.0.0', coreCompatibility: '0.1.0-beta.1',
      artifactDigest: 'a'.repeat(64),
      provides: { editorIds: [declaration.editorId], surfaces: [], editors: [{ ...declaration, scope: 'area' }] },
      requires: { capabilities: [], modules: [] }, activation: { mode: 'workbench', scope: 'area' },
    })).toThrow('root 或 session')
  })

  it('allows area module activation while keeping its editor on a supported render scope', () => {
    expect(() => validateWorkbenchModuleManifestV1({
      moduleId: 'workbench.example', version: '1.0.0', coreCompatibility: '0.1.0-beta.1',
      artifactDigest: 'a'.repeat(64),
      provides: { editorIds: [declaration.editorId], surfaces: [], editors: [declaration] },
      requires: { capabilities: [], modules: [] }, activation: { mode: 'workbench', scope: 'area' },
    })).not.toThrow()
  })

  it('rejects duplicate editor IDs in a module manifest', () => {
    expect(() => validateWorkbenchModuleManifestV1({
      moduleId: 'workbench.example', version: '1.0.0', coreCompatibility: '0.1.0-beta.1',
      artifactDigest: 'a'.repeat(64),
      provides: { editorIds: [declaration.editorId, declaration.editorId], surfaces: [] },
      requires: { capabilities: [], modules: [] }, activation: { mode: 'workbench', scope: 'root' },
    })).toThrow('duplicate editorIds')
  })

  it('requires embedded editor declarations to exactly match editorIds', () => {
    expect(() => validateWorkbenchModuleManifestV1({
      moduleId: 'workbench.example', version: '1.0.0', coreCompatibility: '0.1.0-beta.1',
      artifactDigest: 'a'.repeat(64),
      provides: { editorIds: [declaration.editorId, 'example.other'], surfaces: [], editors: [declaration] },
      requires: { capabilities: [], modules: [] }, activation: { mode: 'workbench', scope: 'root' },
    })).toThrow('exactly match provides.editorIds')
  })

  it('rejects malformed editor IDs even when a legacy manifest omits editor declarations', () => {
    expect(() => validateWorkbenchModuleManifestV1({
      moduleId: 'workbench.example', version: '1.0.0', coreCompatibility: '0.1.0-beta.1',
      artifactDigest: 'a'.repeat(64),
      provides: { editorIds: ['bad id'], surfaces: [] },
      requires: { capabilities: [], modules: [] }, activation: { mode: 'workbench', scope: 'root' },
    })).toThrow('invalid editorId')
  })
})
