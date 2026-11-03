import { describe, expect, it } from 'vitest'
import { createWorkbenchModuleCatalog } from '../src/module-catalog.ts'

const digest = (character: string): string => character.repeat(64)
const entry = (moduleId: string, version: string, character: string, requires: string[] = []) => ({
  moduleId, version, artifactDigest: digest(character), coreCompatibility: '>=1.0.0 <2.0.0',
  requires: { modules: requires.map(moduleId => ({ moduleId })), capabilities: [] },
  source: { kind: 'registry' as const, locator: `npm:${moduleId}@${version}` },
})

describe('WorkbenchModuleCatalogV1', () => {
  it('resolves an exact identity and picks the newest version for an open request', () => {
    const catalog = createWorkbenchModuleCatalog([entry('workbench.shell', '1.0.0', 'a'), entry('workbench.shell', '1.2.0', 'b')])
    expect(catalog.resolve({ moduleId: 'workbench.shell' })?.version).toBe('1.2.0')
    expect(catalog.get('workbench.shell', '1.0.0', digest('a'))?.artifactDigest).toBe(digest('a'))
    expect(catalog.resolve({ moduleId: 'workbench.shell', version: '1.0.0', artifactDigest: digest('b') })).toBeUndefined()
  })

  it('rejects duplicate identities and invalid artifact digests', () => {
    expect(() => createWorkbenchModuleCatalog([entry('workbench.shell', '1.0.0', 'a'), entry('workbench.shell', '1.0.0', 'a')])).toThrow('Duplicate')
    expect(() => createWorkbenchModuleCatalog([{ ...entry('workbench.shell', '1.0.0', 'a'), artifactDigest: 'not-a-digest' }])).toThrow('SHA-256')
  })
})

