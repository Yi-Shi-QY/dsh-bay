import { describe, expect, it } from 'vitest'
import { isWorkbenchExtensionDeclarationV1, resolveWorkbenchExtensionAccessV1, resolveWorkbenchExtensionProviderV1, validateWorkbenchExtensionDeclarationV1, workbenchExtensionAccessForEditorV1, workbenchExtensionDeclarationFailureV1, workbenchExtensionUnavailableCopyV1, type WorkbenchDshExtensionInventoryV1 } from '../src/workbench-extension-access.ts'
import type { WorkbenchEditorCatalogRow } from '../src/foundation/catalog.ts'

const extension = {
  schemaVersion: 1 as const,
  moduleId: 'example.pet',
  apiVersion: 1 as const,
  editorIds: ['example.pet.page'],
  coreCompatibility: '0.1.0-beta.0',
  dshGeneration: '0.2.2-rc.2',
}
const declaration = {
  editorId: 'example.pet.page', scope: 'root' as const, label: 'Pet', requiredBinding: 'none' as const,
  binding: { requirement: 'none' as const, unbound: 'available' as const, sharing: 'none' as const },
  state: { schemaVersion: 1, maxBytes: 2048, restore: 'if-valid' as const, share: 'forbidden' as const },
  runtime: { background: 'pause' as const, collapsed: 'dispose' as const, reacquire: 'on-visible' as const },
}
const editor: WorkbenchEditorCatalogRow = {
  id: 'example.pet.page', label: 'Pet', scope: 'root', pluginId: 'pet-entry', declaration, extension,
}
const coreEditor: WorkbenchEditorCatalogRow = {
  id: 'workbench.conversation', label: '对话', scope: 'session', pluginId: 'workbench-core',
}
const inventory: WorkbenchDshExtensionInventoryV1 = {
  plugins: [{ entryId: 'pet-entry', moduleName: '@example/pet', enabled: true, fiberPhase: 'active' }],
  bundles: [{ name: '@example/pet', version: '1.0.0', installed: true, enabled: true,
    rows: [{ rowId: 'pet-row', moduleName: '@example/pet', entryId: 'pet-entry' }] }],
}
const emptyConsents = {}
const resolve = (input: Partial<Parameters<typeof resolveWorkbenchExtensionAccessV1>[0]> = {}) =>
  resolveWorkbenchExtensionAccessV1({
    editors: [coreEditor, editor], inventory, consents: emptyConsents,
    coreVersion: '0.1.0-beta.1', dshGeneration: '0.2.2-rc.2', coreEditorIds: ['workbench.conversation'], ...input,
  })

describe('Workbench extension identity and Core opt-in', () => {
  it('reports precise provider identity diagnostics instead of collapsing mapping failures', () => {
    expect(resolveWorkbenchExtensionProviderV1(undefined, inventory)).toMatchObject({
      status: 'unmatched', diagnostic: { code: 'registrant-missing' },
    })
    expect(resolveWorkbenchExtensionProviderV1('missing-entry', inventory)).toMatchObject({
      status: 'unmatched', diagnostic: { code: 'runtime-not-found', registrant: 'missing-entry' },
    })
    expect(resolveWorkbenchExtensionProviderV1('pet-entry', {
      plugins: [inventory.plugins[0]!, { ...inventory.plugins[0]!, moduleName: '@example/other' }], bundles: inventory.bundles,
    })).toMatchObject({ status: 'unmatched', diagnostic: { code: 'runtime-ambiguous' } })
    expect(resolveWorkbenchExtensionProviderV1('pet-entry', {
      plugins: inventory.plugins, bundles: [{ ...inventory.bundles[0]!, rows: [{ rowId: 'pet', moduleName: '@example/pet' }] }],
    })).toMatchObject({ status: 'unmatched', diagnostic: { code: 'bundle-row-missing-entry-id' } })
    expect(resolveWorkbenchExtensionProviderV1('pet-entry', {
      plugins: inventory.plugins, bundles: [{ ...inventory.bundles[0]!, rows: [{ rowId: 'pet', moduleName: '@example/pet', entryId: 'other-entry' }] }],
    })).toMatchObject({ status: 'unmatched', diagnostic: { code: 'bundle-identity-conflict' } })
    expect(resolveWorkbenchExtensionProviderV1('pet-entry', {
      plugins: inventory.plugins, bundles: [inventory.bundles[0]!, { ...inventory.bundles[0]!, name: '@example/other' }],
    })).toMatchObject({ status: 'unmatched', diagnostic: { code: 'bundle-ambiguous', bundleNames: ['@example/pet', '@example/other'] } })
  })

  it('returns a complete provider mapping when the exact DSH row is unique', () => {
    expect(resolveWorkbenchExtensionProviderV1('pet-entry', inventory)).toEqual({
      status: 'matched', bundle: inventory.bundles[0], plugin: inventory.plugins[0],
    })
  })

  it('validates the public extension identity contract and rejects duplicate editor IDs', () => {
    expect(isWorkbenchExtensionDeclarationV1(extension)).toBe(true)
    expect(workbenchExtensionDeclarationFailureV1({ ...extension, editorIds: ['example.pet.page', 'example.pet.page'] }))
      .toBe('editorIds 不能重复。')
    expect(() => validateWorkbenchExtensionDeclarationV1({ ...extension, coreCompatibility: ' ' }))
      .toThrow('coreCompatibility 无效')
  })

  it('contains throwing getters in untrusted Slot metadata and reports an invalid contract', () => {
    const malformed = Object.defineProperty({}, 'schemaVersion', {
      get() { throw new Error('malformed extension metadata') },
    })
    expect(workbenchExtensionDeclarationFailureV1(malformed)).toBe('声明字段无法安全读取。')
    const result = resolve({ editors: [{ ...editor, extension: malformed as never }] })
    expect(result.snapshot.extensions[0]).toMatchObject({ availability: 'invalid-contract', allowed: false })
  })

  it('keeps an earlier beta extension compatible and excludes it until Workbench allows it', () => {
    const pending = resolve()
    expect(pending.editors.map(row => row.id)).toEqual(['workbench.conversation'])
    expect(pending.snapshot.extensions[0]).toMatchObject({
      packageName: '@example/pet', moduleId: 'example.pet', availability: 'not-allowed', allowed: false,
    })

    const discovered = pending.snapshot.extensions[0]!
    const allowed = resolve({ consents: {
      [`${discovered.packageName}::${discovered.moduleId}`]: {
        packageName: discovered.packageName!, moduleId: discovered.moduleId, apiVersion: 1,
        editorIds: discovered.editorIds,
        contractFingerprint: discovered.contractFingerprint!, allowedAt: 10,
      },
    } })
    expect(allowed.editors.map(row => row.id)).toContain('example.pet.page')
    expect(allowed.snapshot.extensions[0]).toMatchObject({ availability: 'ready', allowed: true })
  })

  it('does not trust Slot identity when DSH mapping is missing or ambiguous', () => {
    const missing = resolve({ inventory: { plugins: [], bundles: [] } })
    expect(missing.snapshot.extensions[0]).toMatchObject({
      availability: 'identity-unverified', allowed: false,
      providerDiagnostic: { code: 'runtime-not-found' },
      detail: 'No active DSH runtime plugin matches Slot registrant "pet-entry".',
    })
    expect(missing.editors.map(row => row.id)).toEqual(['workbench.conversation'])

    const ambiguous = resolve({ editors: [{ ...editor, pluginId: '@example/pet' }], inventory: {
      plugins: [inventory.plugins[0]!, { ...inventory.plugins[0]!, entryId: 'second-entry' }],
      bundles: inventory.bundles,
    } })
    expect(ambiguous.snapshot.extensions[0]).toMatchObject({ availability: 'identity-unverified', allowed: false })
  })

  it('blocks DSH-disabled, incompatible, undeclared, and malformed extensions', () => {
    const disabled = resolve({ inventory: {
      plugins: [{ ...inventory.plugins[0]!, enabled: false }], bundles: inventory.bundles,
    } })
    expect(disabled.snapshot.extensions[0]?.availability).toBe('dsh-disabled')

    expect(resolve({ editors: [{ ...editor, extension: { ...extension, dshGeneration: '0.2.0-rc.2' } }] })
      .snapshot.extensions[0]?.availability).toBe('incompatible')
    expect(resolve({ editors: [{ ...editor, extension: undefined }] })
      .snapshot.extensions[0]?.availability).toBe('identity-unverified')
    expect(resolve({ editors: [{ ...editor, extension: { ...extension, editorIds: [] } }] })
      .snapshot.extensions[0]?.availability).toBe('invalid-contract')
  })

  it('invalidates a saved opt-in when the editor contract changes and retains consent when removed', () => {
    const current = resolve().snapshot.extensions[0]!
    const saved = {
      [`${current.packageName}::${current.moduleId}`]: {
        packageName: current.packageName!, moduleId: current.moduleId, apiVersion: 1,
        editorIds: current.editorIds,
        contractFingerprint: current.contractFingerprint!, allowedAt: 10,
      },
    }
    const changed = resolve({ editors: [coreEditor, { ...editor, declaration: { ...declaration, label: 'Changed' } }], consents: saved })
    expect(changed.snapshot.extensions[0]).toMatchObject({ availability: 'confirmation-required', allowed: false,
      editorIds: ['example.pet.page'] })
    expect(changed.editors.map(row => row.id)).toEqual(['workbench.conversation'])

    const removed = resolve({ editors: [coreEditor], inventory: { plugins: [], bundles: [] }, consents: saved })
    expect(removed.snapshot.extensions).toEqual([expect.objectContaining({
      key: `${current.packageName}::${current.moduleId}`, availability: 'dsh-missing', allowed: false,
      editorIds: ['example.pet.page'],
    })])
    expect(workbenchExtensionAccessForEditorV1(removed.snapshot, 'example.pet.page')?.availability).toBe('dsh-missing')
    expect(workbenchExtensionAccessForEditorV1(removed.snapshot, 'another.extension')).toBeUndefined()
  })

  it('keeps revoked identities for stale layouts without exposing them in the picker', () => {
    const current = resolve().snapshot.extensions[0]!
    const revoked = resolve({ consents: {
      [`${current.packageName}::${current.moduleId}`]: {
        packageName: current.packageName!, moduleId: current.moduleId, apiVersion: 1,
        editorIds: current.editorIds, contractFingerprint: current.contractFingerprint!, allowedAt: 10, allowed: false,
      },
    } })
    expect(revoked.editors.map(row => row.id)).toEqual(['workbench.conversation'])
    expect(revoked.snapshot.extensions[0]).toMatchObject({
      availability: 'not-allowed', allowed: false, editorIds: ['example.pet.page'],
    })
  })

  it('distinguishes a missing editor declaration from a missing DSH package', () => {
    const current = resolve().snapshot.extensions[0]!
    const saved = {
      [`${current.packageName}::${current.moduleId}`]: {
        packageName: current.packageName!, moduleId: current.moduleId, apiVersion: 1 as const,
        editorIds: current.editorIds, contractFingerprint: current.contractFingerprint!, allowedAt: 10,
      },
    }
    const missingDeclaration = resolve({ editors: [coreEditor, { ...editor, extension: undefined }], consents: saved })
    expect(missingDeclaration.snapshot.extensions).toContainEqual(expect.objectContaining({
      key: `${current.packageName}::${current.moduleId}`, availability: 'identity-unverified',
      editorIds: ['example.pet.page'],
    }))

    const unavailable = resolve({ inventory: undefined, consents: saved })
    expect(unavailable.snapshot.extensions[0]).toMatchObject({ availability: 'inventory-unavailable', allowed: false })
  })

  it('provides recovery-focused copy for stale editor references', () => {
    const current = resolve().snapshot.extensions[0]!
    const removed = resolve({ editors: [coreEditor], inventory: { plugins: [], bundles: [] }, consents: {
      [`${current.packageName}::${current.moduleId}`]: {
        packageName: current.packageName!, moduleId: current.moduleId, apiVersion: 1,
        editorIds: current.editorIds, contractFingerprint: current.contractFingerprint!, allowedAt: 10,
      },
    } }).snapshot.extensions[0]!
    expect(workbenchExtensionUnavailableCopyV1(removed)).toEqual({
      title: 'DSH 插件已卸载', detail: 'DSH 插件包已卸载；已有布局引用已保留，重新安装并启用原扩展后可恢复。',
    })
  })
})
