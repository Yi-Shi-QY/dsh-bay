import { describe, expect, it } from 'vitest'
import { importPortableWorkbench, projectWorkbenchForSharing } from '../src/foundation/workbench-sharing.ts'
import { restoreWorkbenchPortableState } from '../src/foundation/workbench-portability.ts'
import type { WorkbenchEditorCatalogRow } from '../src/foundation/catalog.ts'

const extension = {
  schemaVersion: 1 as const, moduleId: 'example.pet', apiVersion: 1 as const,
  editorIds: ['example.pet.page'], coreCompatibility: '0.1.0-beta.1', dshGeneration: '0.2.2-rc.2',
}
const declaration = {
  editorId: 'example.pet.page', scope: 'root' as const, label: 'Pet', requiredBinding: 'none' as const,
  state: { schemaVersion: 1, maxBytes: 64, restore: 'if-valid' as const, share: 'portable' as const },
  runtime: { background: 'pause' as const, collapsed: 'dispose' as const, reacquire: 'on-visible' as const },
}
const catalog = (share: 'portable' | 'reference-only' | 'forbidden', scope: 'root' | 'session' = 'root'): WorkbenchEditorCatalogRow => ({
  id: 'example.pet.page', label: 'Pet', scope, pluginId: 'pet-entry', extension,
  declaration: { ...declaration, scope, state: { ...declaration.state, share } },
  portability: { version: 1, exportState: state => ({ ...(state as Record<string, unknown>), exported: true }), importState: state => ({ ...(state as Record<string, unknown>), imported: true }) },
})
const input = (editor: WorkbenchEditorCatalogRow) => ({
  name: 'Example', document: {
    version: 3 as const, activeAreaId: 'area-1', root: {
      kind: 'area' as const, areaId: 'area-1', activeModuleInstanceId: 'module-1', moduleHistory: [{
        moduleInstanceId: 'module-1', editorId: editor.id, editorScope: editor.scope, state: { local: true }, lastKnownTitle: editor.label,
      }],
    },
  }, editors: [editor], statePolicy: 'full' as const, inventory: {
    areas: [{ areaId: 'area-1', ordinal: 1, pages: [{ moduleInstanceId: 'module-1', editorId: editor.id, editorScope: editor.scope, name: editor.label, pluginId: editor.pluginId, active: true, available: true }] }],
    plugins: [], pageCount: 1, missingPageCount: 0,
  },
})

describe('Workbench extension state policy', () => {
  it('never exports reference-only or forbidden state, including descriptor-backed state', () => {
    for (const share of ['reference-only', 'forbidden'] as const) {
      const projection = projectWorkbenchForSharing(input(catalog(share)))
      expect(projection.root.kind === 'area' ? projection.root.editors[0]?.portableState : undefined).toBeNull()
    }
  })

  it('restores portable state through the descriptor when a local target exists', () => {
    const result = restoreWorkbenchPortableState(catalog('portable'), { schemaVersion: 1, local: true }, {
      editorId: 'example.pet.page', editorScope: 'root', moduleInstanceId: 'module-1', title: 'Pet',
    })
    expect(result).toMatchObject({ status: 'restored', state: { schemaVersion: 1, local: true, imported: true } })
  })

  it('honors never and always restore policies during share import', () => {
    const never = catalog('portable')
    never.declaration = { ...never.declaration!, state: { ...never.declaration!.state, restore: 'never' } }
    const neverEditor = { ...never, portability: { version: 1 as const, importState: () => {
      throw new Error('never must not call importState')
    } } }
    expect(restoreWorkbenchPortableState(neverEditor, { schemaVersion: 1, local: true }, {
      editorId: 'example.pet.page', editorScope: 'root', moduleInstanceId: 'module-1', title: 'Pet',
    })).toMatchObject({ status: 'not-restored', state: {} })

    const always = catalog('portable')
    always.declaration = { ...always.declaration!, state: { ...always.declaration!.state, restore: 'always' } }
    expect(restoreWorkbenchPortableState(always, { schemaVersion: 99, local: true }, {
      editorId: 'example.pet.page', editorScope: 'root', moduleInstanceId: 'module-1', title: 'Pet',
    })).toMatchObject({ status: 'restored', state: { schemaVersion: 99, local: true, imported: true } })
  })

  it('rejects reference-only and forbidden state before invoking an import descriptor', () => {
    for (const share of ['reference-only', 'forbidden'] as const) {
      const editor = catalog(share)
      const importState = editor.portability?.importState
      const guarded = { ...editor, portability: { version: 1 as const, importState: (state: Parameters<NonNullable<typeof importState>>[0]) => {
        throw new Error(`must not import ${String(state)}`)
      } } }
      const result = restoreWorkbenchPortableState(guarded, { schemaVersion: 1 }, {
        editorId: 'example.pet.page', editorScope: 'root', moduleInstanceId: 'module-1', title: 'Pet',
      })
      expect(result.status).toBe('not-restored')
    }
  })

  it('rejects a state snapshot that exceeds the declaration budget', () => {
    const result = restoreWorkbenchPortableState(catalog('portable'), { schemaVersion: 1, value: 'x'.repeat(100) }, {
      editorId: 'example.pet.page', editorScope: 'root', moduleInstanceId: 'module-1', title: 'Pet',
    })
    expect(result.status).toBe('failed')
  })

  it('applies extension policy while importing detached Session pages', () => {
    const source = catalog('portable', 'session')
    const projection = projectWorkbenchForSharing(input(source))
    if (projection.root.kind !== 'area') throw new Error('Expected one area')
    const importedReferenceOnly = importPortableWorkbench({
      ...projection,
      root: { ...projection.root, editors: [{ ...projection.root.editors[0]!, portableState: { schemaVersion: 1, private: true } }] },
    }, { editors: [catalog('reference-only', 'session')] })
    expect(importedReferenceOnly.document.root.kind).toBe('area')
    if (importedReferenceOnly.document.root.kind !== 'area') throw new Error('Expected imported area')
    expect(importedReferenceOnly.document.root.moduleHistory[0]?.state).toEqual({})

    const importedOversized = importPortableWorkbench({
      ...projection,
      root: { ...projection.root, editors: [{ ...projection.root.editors[0]!, portableState: { schemaVersion: 1, value: 'x'.repeat(100) } }] },
    }, { editors: [catalog('portable', 'session')] })
    if (importedOversized.document.root.kind !== 'area') throw new Error('Expected imported area')
    expect(importedOversized.document.root.moduleHistory[0]?.state).toEqual({})
    expect(importedOversized.warnings.join('\n')).toContain('分享状态不符合内页限制')
  })
})
