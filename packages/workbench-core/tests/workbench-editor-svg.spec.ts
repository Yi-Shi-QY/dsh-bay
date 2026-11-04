import { describe, expect, it } from 'vitest'
import { normalizeWorkbenchEditorSvgIcon, fallbackWorkbenchEditorSvgIcon } from '../src/foundation/workbench-editor-icons.ts'
import { resolveWorkbenchEditorPresentation, editorPresentationFor } from '../src/foundation/catalog.ts'
import { WORKBENCH_OFFICIAL_AREA_EDITOR_IDS } from '../src/client/official-area-editors.tsx'
import { workbenchEditorCatalogRowFromSlotEntry } from '../src/client/workbench-editor-slot-catalog.ts'

const icon = { version: 1, paths: ['M4 4h16v16H4Z', 'M8 8h8M8 12h5'] }
describe('Safe per-editor SVG identity', () => {
  it('projects a copied path-only descriptor through the real Slot metadata contract', () => {
    const row = workbenchEditorCatalogRowFromSlotEntry({ options: { id: 'private.notes', label: '笔记' }, registrant: 'private', inject: () => ({ workbenchEditor: { schemaVersion: 1, presentation: { iconSvg: icon } } }) }, 'root')
    expect(row.iconSvg).toEqual(icon)
    expect(row.iconSvg).not.toBe(icon)
    expect(resolveWorkbenchEditorPresentation(row).iconSvg).toEqual(icon)
  })
  it.each([
    '<svg onload="alert(1)"/>', 'https://example.com/icon.svg',
    { ...icon, onLoad: 'alert(1)' }, { ...icon, href: 'file:///private' },
    { version: 1, paths: ['M0 0<script/>'] }, { version: 1, paths: ['M0 0url(https://example.com)'] },
    { version: 1, paths: ['M0 0L'] }, { version: 1, paths: ['M0 0L1'] },
    { version: 1, paths: ['M0 0'] }, { version: 1, paths: ['M0 0L9999 9999'] },
    { version: 1, paths: ['M0 0A3 3 0 2 1 10 10'] },
    { version: 1, paths: Array(13).fill('M0 0L10 10') },
    { version: 1, paths: ['M0 0L1 1'.repeat(200)] },
  ])('rejects markup, external references, excess data and invalid geometry: %j', value => {
    expect(normalizeWorkbenchEditorSvgIcon(value)).toBeUndefined()
  })
  it('keeps legacy identities stable across surfaces and distinguishes different editor IDs', () => {
    const a = resolveWorkbenchEditorPresentation({ id: 'private.a', label: 'A', scope: 'root' })
    const again = resolveWorkbenchEditorPresentation({ id: 'private.a', label: 'Changed name', scope: 'session' })
    const b = resolveWorkbenchEditorPresentation({ id: 'private.b', label: 'B', scope: 'root' })
    expect(a.iconSvg).toEqual(again.iconSvg)
    expect(a.iconSvg).not.toEqual(b.iconSvg)
    expect(normalizeWorkbenchEditorSvgIcon(fallbackWorkbenchEditorSvgIcon('private.a'))).toBeDefined()
  })
  it('covers every built-in editor with a dedicated semantic glyph', () => {
    const names = Object.values(WORKBENCH_OFFICIAL_AREA_EDITOR_IDS).map(id => editorPresentationFor(id, 'session').icon)
    expect(names).not.toContain('extension')
    expect(new Set(names).size).toBe(names.length)
  })
})
