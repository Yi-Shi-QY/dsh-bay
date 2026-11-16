import { describe, expect, it, vi } from 'vitest'
import { SlotCore } from '@deepseek-ai/dsh-client-ui-slots'
import { workbenchEditorCatalogRowFromSlotEntry } from '../src/client/workbench-editor-slot-catalog.ts'

const extension = {
  schemaVersion: 1 as const,
  moduleId: 'example.pet',
  apiVersion: 1 as const,
  editorIds: ['example.pet.page'],
  coreCompatibility: '0.1.0-beta.1',
  dshGeneration: '0.2.2-rc.2',
}
const declaration = {
  editorId: 'example.pet.page',
  scope: 'root' as const,
  label: 'Pet',
  requiredBinding: 'none' as const,
  binding: { requirement: 'none' as const, unbound: 'available' as const, sharing: 'none' as const },
  state: { schemaVersion: 1, maxBytes: 2048, restore: 'if-valid' as const, share: 'forbidden' as const },
  runtime: { background: 'pause' as const, collapsed: 'dispose' as const, reacquire: 'on-visible' as const },
}

describe('Workbench editor Slot metadata adapter', () => {
  it('reads extension metadata from DSH’s preserved inject face, not stripped custom options', () => {
    // Use DSH’s actual SlotCore: it intentionally strips custom registration
    // option fields while retaining the documented inject contribution.
    const slots = new SlotCore() as unknown as {
      record(key: string): { spec?: unknown }
      register(options: Record<string, unknown>, component: unknown): () => void
      entriesOfSlot(key: string): readonly Parameters<typeof workbenchEditorCatalogRowFromSlotEntry>[0][]
    }
    const slot = 'workbench.editor.root'
    slots.record(slot).spec = { kind: 'list', scope: 'root' }
    const inject = vi.fn(() => ({ workbenchEditor: {
      schemaVersion: 1, declaration, extension, presentation: { icon: 'tool' },
    } }))
    slots.register({
      name: slot,
      id: 'example.pet.page',
      label: 'Pet',
      order: 900,
      registrant: 'pet-entry',
      declaration,
      extension,
      presentation: { icon: 'browser' },
      inject,
    }, () => null)
    const entry = slots.entriesOfSlot(slot)[0]!
    expect(entry.options).not.toHaveProperty('extension')
    expect(entry.options).not.toHaveProperty('declaration')
    expect(entry.options).not.toHaveProperty('presentation')
    const row = workbenchEditorCatalogRowFromSlotEntry(entry, 'root')

    expect(row).toMatchObject({
      id: 'example.pet.page', label: 'Pet', order: 900, scope: 'root', pluginId: 'pet-entry',
      declaration, extension, icon: 'tool',
    })
    expect(inject).toHaveBeenCalledOnce()
  })

  it('keeps catalog discovery alive when an extension metadata provider throws', () => {
    expect(() => workbenchEditorCatalogRowFromSlotEntry({
      options: { id: 'broken.editor', label: 'Broken' },
      inject: () => { throw new Error('provider failed') },
    }, 'root')).not.toThrow()
  })

  it('ignores unsupported Workbench Slot metadata schema versions', () => {
    const row = workbenchEditorCatalogRowFromSlotEntry({
      options: { id: 'future.editor', label: 'Future' },
      inject: () => ({ workbenchEditor: { schemaVersion: 2, declaration, extension } }),
    }, 'root')

    expect(row).not.toHaveProperty('declaration')
    expect(row).not.toHaveProperty('extension')
    expect(row).not.toHaveProperty('icon')
  })

  it('rejects unknown icon tokens without hiding the contributed editor', () => {
    const row = workbenchEditorCatalogRowFromSlotEntry({
      options: { id: 'example.unknown-icon', label: 'Unknown icon' },
      inject: () => ({ workbenchEditor: { schemaVersion: 1, presentation: { icon: 'data:image/svg+xml,<svg/>' } } }),
    }, 'root')

    expect(row.id).toBe('example.unknown-icon')
    expect(row).not.toHaveProperty('icon')
  })
})
