import { areasOf, type WorkbenchDocumentV3 } from './document-v3.ts'
import type { WorkbenchEditorCatalogRow } from './catalog.ts'

/** One persisted inner page projected with its live editor and plugin status. */
export interface WorkbenchInventoryPage {
  moduleInstanceId: string
  editorId: string
  editorScope: 'root' | 'session'
  name: string
  pluginId?: string
  active: boolean
  available: boolean
}

/** One visual container in deterministic split-tree order. */
export interface WorkbenchInventoryArea {
  areaId: string
  ordinal: number
  pages: readonly WorkbenchInventoryPage[]
  activePage?: WorkbenchInventoryPage
}

export type WorkbenchPluginRequirementStatus = 'available' | 'missing' | 'unresolved'

/** Plugin requirements across every retained inner page. */
export interface WorkbenchPluginRequirement {
  key: string
  pluginId?: string
  status: WorkbenchPluginRequirementStatus
  editorIds: readonly string[]
  pageCount: number
}

/** Export-ready read model of one Workbench document and the current live Slot ledger. */
export interface WorkbenchInventory {
  areas: readonly WorkbenchInventoryArea[]
  plugins: readonly WorkbenchPluginRequirement[]
  pageCount: number
  missingPageCount: number
}

function editorKey(scope: 'root' | 'session', editorId: string): string {
  return `${scope}:${editorId}`
}

/**
 * Project one persisted Workbench into the layout/page/plugin inventory used by
 * Settings today and by a future share-package preflight.
 *
 * The document remains the sole layout authority. Live editor registrations
 * only enrich it with availability, localized labels, and the registrant that
 * provides the inner page. Missing registrations never remove retained pages.
 */
export function buildWorkbenchInventory(
  document: WorkbenchDocumentV3,
  editors: readonly WorkbenchEditorCatalogRow[],
): WorkbenchInventory {
  const liveEditors = new Map(editors.map(editor => [
    editorKey(editor.scope, editor.id), editor,
  ]))
  const pluginRows = new Map<string, {
    pluginId?: string
    status: WorkbenchPluginRequirementStatus
    editorIds: Set<string>
    pageCount: number
  }>()
  let pageCount = 0
  let missingPageCount = 0
  const areas = areasOf(document.root).map((area, ordinal): WorkbenchInventoryArea => {
    const currentModule = area.moduleHistory.find(
      module => module.moduleInstanceId === area.activeModuleInstanceId,
    ) ?? area.moduleHistory[0]
    const pages = area.moduleHistory.map((module): WorkbenchInventoryPage => {
      const editor = liveEditors.get(editorKey(module.editorScope, module.editorId))
      const available = editor !== undefined
      const pluginId = editor?.pluginId
      const pluginKey = pluginId === undefined
        ? `unresolved:${module.editorScope}:${module.editorId}`
        : `plugin:${pluginId}`
      const status: WorkbenchPluginRequirementStatus = !available
        ? 'missing'
        : pluginId === undefined ? 'unresolved' : 'available'
      const existing = pluginRows.get(pluginKey)
      if (existing === undefined) {
        pluginRows.set(pluginKey, {
          ...(pluginId === undefined ? {} : { pluginId }),
          status,
          editorIds: new Set([module.editorId]),
          pageCount: 1,
        })
      } else {
        existing.editorIds.add(module.editorId)
        existing.pageCount += 1
        if (status === 'missing' || (status === 'unresolved' && existing.status === 'available')) {
          existing.status = status
        }
      }
      pageCount += 1
      if (!available) missingPageCount += 1
      return {
        moduleInstanceId: module.moduleInstanceId,
        editorId: module.editorId,
        editorScope: module.editorScope,
        name: editor?.label ?? (module.lastKnownTitle || module.editorId),
        ...(pluginId === undefined ? {} : { pluginId }),
        // The first module is the compatibility fallback when an old document
        // omitted activeModuleInstanceId; it is still the Area's current page.
        active: module.moduleInstanceId === currentModule?.moduleInstanceId,
        available,
      }
    })
    const activePage = pages.find(page => page.active)
    return {
      areaId: area.areaId,
      ordinal: ordinal + 1,
      pages,
      ...(activePage === undefined ? {} : { activePage }),
    }
  })
  const plugins = [...pluginRows.entries()]
    .map(([key, row]): WorkbenchPluginRequirement => ({
      key,
      ...(row.pluginId === undefined ? {} : { pluginId: row.pluginId }),
      status: row.status,
      editorIds: [...row.editorIds].sort(),
      pageCount: row.pageCount,
    }))
    .sort((left, right) => {
      if (left.pluginId !== undefined && right.pluginId === undefined) return -1
      if (left.pluginId === undefined && right.pluginId !== undefined) return 1
      return (left.pluginId ?? left.editorIds[0] ?? left.key)
        .localeCompare(right.pluginId ?? right.editorIds[0] ?? right.key, 'en')
    })
  return { areas, plugins, pageCount, missingPageCount }
}
