import { browserSafeUuid } from '../browser-safe-id.ts'
import type { WorkbenchDocumentV3, WorkbenchNodeV3 } from './document-v3.ts'

export type WorkbenchPresetNode = number | { axis: 'horizontal' | 'vertical'; ratio: number; first: WorkbenchPresetNode; second: WorkbenchPresetNode }
const columns = (first: WorkbenchPresetNode, second: WorkbenchPresetNode, ratio = .5): WorkbenchPresetNode => ({ axis: 'horizontal', ratio, first, second })
const rows = (first: WorkbenchPresetNode, second: WorkbenchPresetNode, ratio = .5): WorkbenchPresetNode => ({ axis: 'vertical', ratio, first, second })

/** Geometry only: presets never inherit another Workbench's pages, state or bindings. */
export const WORKBENCH_LAYOUT_PRESETS = [
  { id: 'single', name: '单区域', areas: 1, root: 0 },
  { id: 'columns', name: '左右双栏', areas: 2, root: columns(0, 1) },
  { id: 'rows', name: '上下双栏', areas: 2, root: rows(0, 1) },
  { id: 'main-right', name: '左主右辅', areas: 2, root: columns(0, 1, .67) },
  { id: 'main-left', name: '左辅右主', areas: 2, root: columns(0, 1, .33) },
  { id: 'left-stack', name: '左主右双区', areas: 3, root: columns(0, rows(1, 2), .6) },
  { id: 'right-stack', name: '左双区右主', areas: 3, root: columns(rows(0, 1), 2, .4) },
  { id: 'three-columns', name: '三栏', areas: 3, root: columns(0, columns(1, 2), 1 / 3) },
  { id: 'four-grid', name: '四宫格', areas: 4, root: rows(columns(0, 1), columns(2, 3)) },
] as const
export type WorkbenchLayoutPresetId = typeof WORKBENCH_LAYOUT_PRESETS[number]['id']
export interface WorkbenchAreaEditorChoice { editorId: string; scope: 'root' | 'session'; label: string }

/** Build fresh identities and inert Session pages; no Session or editor runtime is created here. */
export function createWorkbenchPresetDocument(presetId: string, choices: readonly (WorkbenchAreaEditorChoice | null)[] = []): WorkbenchDocumentV3 | undefined {
  const preset = WORKBENCH_LAYOUT_PRESETS.find(row => row.id === presetId)
  if (!preset || choices.length > preset.areas || choices.some(choice => choice !== null && (!choice || typeof choice.editorId !== 'string' || !choice.editorId.trim() || choice.editorId.length > 512 || (choice.scope !== 'root' && choice.scope !== 'session') || typeof choice.label !== 'string' || choice.label.length > 512))) return undefined
  let activeAreaId = ''
  const build = (node: WorkbenchPresetNode): WorkbenchNodeV3 => {
    if (typeof node !== 'number') return { kind: 'split', id: 'split-' + browserSafeUuid(), axis: node.axis, ratio: node.ratio, first: build(node.first), second: build(node.second) }
    const areaId = 'area-' + browserSafeUuid()
    if (!activeAreaId) activeAreaId = areaId
    const choice = choices[node]
    if (!choice) return { kind: 'area', areaId, moduleHistory: [] }
    const moduleInstanceId = 'module-' + browserSafeUuid()
    return { kind: 'area', areaId, activeModuleInstanceId: moduleInstanceId, moduleHistory: [{ moduleInstanceId, editorId: choice.editorId, editorScope: choice.scope, lastKnownTitle: choice.label, state: {}, ...(choice.scope === 'session' ? { pendingBinding: 'binding-' + (node + 1) } : {}) }] }
  }
  const root = build(preset.root)
  return { version: 3, root, activeAreaId }
}
