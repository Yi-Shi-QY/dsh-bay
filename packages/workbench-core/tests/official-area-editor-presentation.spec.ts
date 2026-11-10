import { describe, expect, it } from 'vitest'
import { WORKBENCH_CORE_MANIFEST } from '../src/core-manifest.ts'
import { editorPresentationFor, normalizeWorkbenchEditorIconName, WORKBENCH_EDITOR_ICON_NAMES } from '../src/foundation/catalog.ts'
import { WORKBENCH_OFFICIAL_AREA_EDITOR_IDS } from '../src/client/official-area-editors.tsx'

describe('official DSH Area editor identities', () => {
  it('uses the generic extension glyph for unknown editors and accepts only stable icon tokens', () => {
    expect(editorPresentationFor('example.extension', 'root').icon).toBe('extension')
    expect(editorPresentationFor('example.extension', 'session').icon).toBe('extension')
    expect(WORKBENCH_EDITOR_ICON_NAMES).toHaveLength(15)
    for (const name of WORKBENCH_EDITOR_ICON_NAMES) expect(normalizeWorkbenchEditorIconName(name)).toBe(name)
    expect(normalizeWorkbenchEditorIconName('data:image/svg+xml,<svg/>')).toBeUndefined()
    expect(normalizeWorkbenchEditorIconName(null)).toBeUndefined()
  })

  it('keeps the native capability editors in the official builtin category', () => {
    expect(Object.values(WORKBENCH_OFFICIAL_AREA_EDITOR_IDS)).toEqual([
      'workbench.workspace-files', 'workbench.terminal', 'workbench.browser',
      'workbench.document-preview',
      'workbench.conversation.start', 'workbench.conversation', 'workbench.agent-trajectory',
      'workbench.changes-review', 'workbench.plan', 'workbench.schedule-task', 'workbench.guide', 'workbench.subagent-chat',
    ])
    expect(editorPresentationFor('workbench.workspace-files', 'session')).toMatchObject({ category: '官方内置', categoryOrder: 30 })
    expect(editorPresentationFor('workbench.terminal', 'session')).toMatchObject({ category: '官方内置', categoryOrder: 30 })
    expect(editorPresentationFor('workbench.browser', 'session')).toMatchObject({ category: '官方内置', categoryOrder: 30 })
    expect(editorPresentationFor('workbench.document-preview', 'session')).toMatchObject({ category: '官方内置', categoryOrder: 30 })
    expect(editorPresentationFor('workbench.conversation.start', 'root')).toMatchObject({ category: '官方内置', categoryOrder: 30 })
    expect(editorPresentationFor('workbench.conversation', 'session')).toMatchObject({ category: '官方内置', categoryOrder: 30 })
    expect(editorPresentationFor('workbench.agent-trajectory', 'session')).toMatchObject({ category: '官方内置', categoryOrder: 30 })
    expect(editorPresentationFor('workbench.changes-review', 'session')).toMatchObject({ category: '官方内置', categoryOrder: 30 })
    expect(editorPresentationFor('workbench.plan', 'session')).toMatchObject({ category: '官方内置', categoryOrder: 30 })
    expect(editorPresentationFor('workbench.schedule-task', 'session')).toMatchObject({ category: '官方内置', categoryOrder: 30 })
    expect(editorPresentationFor('workbench.guide', 'session')).toMatchObject({ category: '官方内置', categoryOrder: 30 })
    expect(editorPresentationFor('workbench.subagent-chat', 'session')).toMatchObject({ category: '官方内置', categoryOrder: 30 })
  })

  it('ships the native capability editors with Core instead of the community catalog', () => {
    expect(WORKBENCH_CORE_MANIFEST.kind).toBe('official-builtin')
    expect(WORKBENCH_CORE_MANIFEST.delivery).toBe('core-bundled')
    expect(WORKBENCH_CORE_MANIFEST.provides.editorIds).toEqual(Object.values(WORKBENCH_OFFICIAL_AREA_EDITOR_IDS))
    expect(WORKBENCH_CORE_MANIFEST.provides.surfaces).toContain('workbench.official-surfaces')
  })
})
