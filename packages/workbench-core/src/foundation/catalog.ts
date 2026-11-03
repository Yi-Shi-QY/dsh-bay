import type {
  SlotPortabilityDescriptorV1,
  SlotPreviewDescriptorV1,
} from './workbench-slot-contracts.ts'
import type {
  SlotRegistrationProvenanceV1,
  WorkbenchDistributionDescriptorV1,
} from './workbench-distribution.ts'
import type { WorkbenchEditorDeclarationV1 } from '../module-contract.ts'
import type { WorkbenchExtensionDeclarationV1 } from '../workbench-extension-access.ts'

/** One live editor contribution projected from the Slot ledger. */
export interface WorkbenchEditorCatalogRow {
  id: string
  label: string
  scope: 'root' | 'session'
  /** Stable Cordis/Slot registrant providing this inner-page editor. */
  pluginId?: string
  /** Stable presentation token. Unknown/third-party editors may omit it. */
  icon?: string
  /** Human-facing menu group. Unknown/third-party editors fall back to 扩展. */
  category?: string
  /** Stable category order; lower values are shown first. */
  categoryOrder?: number
  /** Optional versioned semantic preview descriptor. */
  preview?: SlotPreviewDescriptorV1
  /** Optional runtime-only local-to-share state projection descriptor. */
  portability?: SlotPortabilityDescriptorV1
  /** Runtime-owned origin; never accepted from plugin registration options. */
  provenance?: SlotRegistrationProvenanceV1
  /** Optional package distribution declaration for dependency solving. */
  distribution?: WorkbenchDistributionDescriptorV1
  /** Core-only marker for editors opened by a native resource action. */
  resourceOnly?: boolean
  /** Core-owned state and resource lifecycle policy. */
  declaration?: WorkbenchEditorDeclarationV1
  /** Untrusted self-description, accepted only after DSH package mapping and Core consent. */
  extension?: WorkbenchExtensionDeclarationV1
}

/** Stable icon and category metadata used by the Area editor picker. */
export interface WorkbenchEditorPresentation {
  icon: string
  category: string
  categoryOrder: number
}

/** Stable semantic icon names accepted from Workbench inner-page extensions. */
export const WORKBENCH_EDITOR_ICON_NAMES = Object.freeze([
  'plus-message', 'message', 'trajectory', 'folder', 'terminal', 'browser',
  'file-preview', 'changes', 'plan', 'schedule', 'guide', 'subagent', 'tool',
  'extension', 'panel',
] as const)

export type WorkbenchEditorIconName = typeof WORKBENCH_EDITOR_ICON_NAMES[number]

const workbenchEditorIconNames = new Set<string>(WORKBENCH_EDITOR_ICON_NAMES)

/** Reject arbitrary presentation values and fall back to the generic extension glyph. */
export function normalizeWorkbenchEditorIconName(value: unknown): WorkbenchEditorIconName | undefined {
  return typeof value === 'string' && workbenchEditorIconNames.has(value)
    ? value as WorkbenchEditorIconName
    : undefined
}

/**
 * Resolve built-in presentation metadata with a safe external-editor fallback.
 * @param id - registered editor identifier.
 * @param scope - root or Session editor scope.
 * @returns the stable icon and category presentation.
 */
export function editorPresentationFor(
  id: string,
  scope: 'root' | 'session',
): WorkbenchEditorPresentation {
  switch (id) {
    case 'workbench.conversation.start':
      return { icon: 'plus-message', category: '对话', categoryOrder: 10 }
    case 'workbench.conversation':
      return { icon: 'message', category: '对话', categoryOrder: 10 }
    case 'workbench.agent-trajectory':
      return { icon: 'trajectory', category: '分析', categoryOrder: 20 }
    case 'workbench.workspace-files':
      return { icon: 'folder', category: '官方内置', categoryOrder: 30 }
    case 'workbench.terminal':
      return { icon: 'terminal', category: '官方内置', categoryOrder: 30 }
    case 'workbench.browser':
      return { icon: 'browser', category: '官方内置', categoryOrder: 30 }
    case 'workbench.document-preview':
      return { icon: 'file-preview', category: '官方内置', categoryOrder: 30 }
    case 'workbench.changes-review':
      return { icon: 'changes', category: '官方内置', categoryOrder: 30 }
    case 'workbench.plan':
      return { icon: 'plan', category: '官方内置', categoryOrder: 30 }
    case 'workbench.schedule-task':
      return { icon: 'schedule', category: '官方内置', categoryOrder: 30 }
    case 'workbench.guide':
      return { icon: 'guide', category: '官方内置', categoryOrder: 30 }
    case 'workbench.subagent-chat':
      return { icon: 'subagent', category: '官方内置', categoryOrder: 30 }
    default:
      return {
        icon: 'extension',
        category: '扩展',
        categoryOrder: 90,
      }
  }
}

/** React-compatible external store over the live editor Slot ledger. */
export interface WorkbenchEditorCatalog {
  getSnapshot(): readonly WorkbenchEditorCatalogRow[]
  subscribe(listener: () => void): () => void
}

/** Read descriptor identity defensively before it reaches UI surfaces. */
export function editorPresentationFromPreview(
  preview: WorkbenchEditorCatalogRow['preview'] | undefined,
): Partial<Pick<WorkbenchEditorCatalogRow, 'icon' | 'category' | 'categoryOrder'>> {
  const declared = preview?.presentation
  if (declared === undefined) return {}
  const result: Partial<Pick<WorkbenchEditorCatalogRow, 'icon' | 'category' | 'categoryOrder'>> = {}
  if (typeof declared.icon === 'string' && declared.icon.length > 0 && declared.icon.length <= 64) result.icon = declared.icon
  if (typeof declared.category === 'string' && declared.category.length > 0 && declared.category.length <= 64) result.category = declared.category
  if (typeof declared.categoryOrder === 'number' && Number.isFinite(declared.categoryOrder)) result.categoryOrder = declared.categoryOrder
  return result
}
