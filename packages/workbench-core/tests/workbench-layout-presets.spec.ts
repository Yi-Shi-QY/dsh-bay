import { describe, expect, it } from 'vitest'
import { WORKBENCH_LAYOUT_PRESETS, createWorkbenchPresetDocument } from '../src/foundation/workbench-layout-presets.ts'
import { areasOf } from '../src/foundation/document-v3.ts'
import { decodeWorkbenchSettingsV4 } from '../src/foundation/persistence.ts'

describe('Workbench geometry presets', () => {
  it.each(WORKBENCH_LAYOUT_PRESETS)('$name builds the declared number of empty, independent Areas', preset => {
    const first = createWorkbenchPresetDocument(preset.id)!, second = createWorkbenchPresetDocument(preset.id)!
    const areas = areasOf(first.root)
    expect(areas).toHaveLength(preset.areas)
    expect(new Set(areas.map(area => area.areaId)).size).toBe(preset.areas)
    expect(areas.every(area => area.moduleHistory.length === 0)).toBe(true)
    expect(first.activeAreaId).toBe(areas[0]!.areaId)
    expect(areasOf(second.root).every(area => !areas.some(previous => previous.areaId === area.areaId))).toBe(true)
    const decoded = decodeWorkbenchSettingsV4({ version: 4, activeWorkbenchId: 'new', openWorkbenchIds: ['new'], workbenches: { new: { workbenchId: 'new', name: 'New', description: '', createdAt: 1, updatedAt: 1, document: first } }, layoutTemplates: {}, invalidWorkbenches: {}, sessionMarkers: {} })
    expect(decoded?.workbenches.new?.document).toEqual(first)
  })
  it('maps modules to numbered Areas without inherited state or Session bindings', () => {
    const document = createWorkbenchPresetDocument('left-stack', [
      { editorId: 'test.root', scope: 'root', label: 'Root' },
      { editorId: 'test.session', scope: 'session', label: 'Session' },
      { editorId: 'test.session', scope: 'session', label: 'Session' },
    ])!
    const areas = areasOf(document.root)
    expect(document.root).toMatchObject({ kind: 'split', axis: 'horizontal', ratio: .6, second: { kind: 'split', axis: 'vertical', ratio: .5 } })
    expect(areas.map(area => area.moduleHistory[0]?.editorId)).toEqual(['test.root', 'test.session', 'test.session'])
    expect(areas[0]!.moduleHistory[0]!.pendingBinding).toBeUndefined()
    expect(areas[1]!.moduleHistory[0]!.pendingBinding).not.toBe(areas[2]!.moduleHistory[0]!.pendingBinding)
    for (const area of areas) { expect(area.areaBinding).toBeUndefined(); expect(area.moduleHistory[0]!.binding).toBeUndefined(); expect(area.moduleHistory[0]!.state).toEqual({}) }
  })
  it('rejects unknown presets, surplus modules and malformed editor identity', () => {
    expect(createWorkbenchPresetDocument('unknown')).toBeUndefined()
    expect(createWorkbenchPresetDocument('single', [null, null])).toBeUndefined()
    expect(createWorkbenchPresetDocument('single', [{ editorId: '', scope: 'root', label: 'Bad' }])).toBeUndefined()
  })
})
