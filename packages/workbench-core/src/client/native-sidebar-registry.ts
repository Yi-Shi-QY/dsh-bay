/**
 * The DSH right-sidebar identities that Workbench may project into an Area.
 *
 * Keep this table as the only compatibility seam between a DSH tab kind and a
 * Workbench editor.  A DSH upgrade should change this table (and its contract
 * tests) instead of spreading package names through Frame, persistence, or
 * Area lifecycle code.
 */
export interface WorkbenchNativeSidebarDefinition {
  readonly kind: string
  /** Workbench editor id. Resource-only candidates may not be registered yet. */
  readonly editorId?: string
  readonly entryKey: string
  readonly label: string
  /** Resource-only types are opened by a native body and stay out of menus. */
  readonly resourceOnly?: boolean
  /** Whether the native body can be projected into an Area today. */
  readonly projection: 'ready' | 'resource-pending' | 'unsupported'
  /** DSH resource identity patterns required before opening this body. */
  readonly resourcePatterns?: readonly string[]
  /** DSH lifecycle surface that the adapter must preserve. */
  readonly lifecycleContract: readonly ('occurrence' | 'store' | 'children' | 'controller' | 'resource' | 'retention')[]
  /** Workbench fallback is explicit and never evidence of native parity. */
  readonly fallback: 'workbench' | 'unavailable' | 'none'
}

export const WORKBENCH_NATIVE_SIDEBAR_DEFINITIONS: readonly WorkbenchNativeSidebarDefinition[] = Object.freeze([
  {
    kind: 'files',
    editorId: 'workbench.workspace-files',
    entryKey: '@deepseek-ai/dsh-client-ui-sidebar-files',
    label: '工作区文件',
    projection: 'ready',
    lifecycleContract: ['occurrence', 'store', 'children', 'resource'],
    fallback: 'workbench',
  },
  {
    kind: 'terminal',
    editorId: 'workbench.terminal',
    entryKey: '@deepseek-ai/dsh-client-ui-sidebar-terminal',
    label: '终端',
    projection: 'ready',
    lifecycleContract: ['occurrence', 'controller', 'retention'],
    fallback: 'workbench',
  },
  {
    kind: 'browser',
    editorId: 'workbench.browser',
    entryKey: '@deepseek-ai/dsh-client-ui-sidebar-browser',
    label: '浏览器',
    projection: 'ready',
    lifecycleContract: ['occurrence', 'store', 'controller', 'retention'],
    fallback: 'workbench',
  },
  {
    kind: 'documentpreview',
    editorId: 'workbench.document-preview',
    entryKey: '@deepseek-ai/dsh-client-ui-sidebar-documentpreview',
    label: '文件预览',
    resourceOnly: true,
    projection: 'ready',
    resourcePatterns: ['dsh-resource://file/**'],
    lifecycleContract: ['occurrence', 'store', 'children', 'resource'],
    fallback: 'unavailable',
  },
  {
    kind: 'changes-review',
    editorId: 'workbench.changes-review',
    entryKey: '@deepseek-ai/dsh-client-ui-deliverables',
    label: '变更审查',
    resourceOnly: true,
    projection: 'ready',
    resourcePatterns: ['dsh-resource://changes-review/**'],
    lifecycleContract: ['occurrence', 'store', 'children', 'resource'],
    fallback: 'unavailable',
  },
  {
    kind: 'plan',
    editorId: 'workbench.plan',
    entryKey: '@deepseek-ai/dsh-client-ui-plan',
    label: '计划',
    resourceOnly: true,
    projection: 'ready',
    resourcePatterns: ['dsh-resource://plan/**', 'dsh-resource://plan-review/**'],
    lifecycleContract: ['occurrence', 'resource'],
    fallback: 'unavailable',
  },
  {
    kind: 'schedule-task',
    editorId: 'workbench.schedule-task',
    entryKey: '@deepseek-ai/dsh-client-ui-schedule/task',
    resourcePatterns: ['dsh-resource://schedule-task/session/**'],
    label: '计划任务',
    resourceOnly: true,
    projection: 'ready',
    lifecycleContract: ['occurrence', 'resource', 'retention'],
    fallback: 'unavailable',
  },
  {
    kind: 'guide',
    editorId: 'workbench.guide',
    entryKey: '@deepseek-ai/dsh-client-ui-sidebar-right/guide',
    label: '功能指南',
    resourceOnly: false,
    projection: 'ready',
    lifecycleContract: ['occurrence', 'children'],
    fallback: 'unavailable',
  },
  {
    kind: 'subagent-chat',
    editorId: 'workbench.subagent-chat',
    entryKey: '@deepseek-ai/dsh-client-ui-subagent',
    label: '子 Agent 对话',
    resourceOnly: true,
    projection: 'ready',
    resourcePatterns: ['dsh-resource://subagentchat/session/**'],
    lifecycleContract: ['occurrence', 'children', 'resource'],
    fallback: 'unavailable',
  },
])

const byKind = new Map(WORKBENCH_NATIVE_SIDEBAR_DEFINITIONS.map(definition => [definition.kind, definition]))
const byEditorId = new Map(WORKBENCH_NATIVE_SIDEBAR_DEFINITIONS.flatMap(definition =>
  definition.editorId === undefined ? [] : [[definition.editorId, definition] as const],
))
const byEntryKey = new Map(WORKBENCH_NATIVE_SIDEBAR_DEFINITIONS.map(definition => [definition.entryKey, definition]))

export function workbenchNativeSidebarForKind(kind: string): WorkbenchNativeSidebarDefinition | undefined {
  return byKind.get(kind)
}

export function workbenchNativeSidebarForEditorId(editorId: string): WorkbenchNativeSidebarDefinition | undefined {
  return byEditorId.get(editorId)
}

export function workbenchNativeSidebarForEntryKey(entryKey: string): WorkbenchNativeSidebarDefinition | undefined {
  return byEntryKey.get(entryKey)
}

/** Resolve a resource-backed adapter without claiming or opening a DSH tab. */
export function workbenchNativeSidebarForResourceAddress(address: string): WorkbenchNativeSidebarDefinition | undefined {
  return WORKBENCH_NATIVE_SIDEBAR_DEFINITIONS.find(definition =>
    definition.resourcePatterns?.some(pattern => pattern.endsWith('**')
      ? address.startsWith(pattern.slice(0, -2))
      : address === pattern) === true,
  )
}

/** Definitions with a configured native Area projection path; this is not a behavioral-parity verdict. */
export function workbenchReadyNativeSidebarDefinitions(): readonly WorkbenchNativeSidebarDefinition[] {
  return WORKBENCH_NATIVE_SIDEBAR_DEFINITIONS.filter(definition => definition.projection === 'ready' && definition.editorId !== undefined)
}
