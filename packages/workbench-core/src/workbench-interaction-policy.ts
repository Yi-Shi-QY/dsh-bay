/** User-controlled routing policy for resources emitted by a DSH Conversation. */
export type WorkbenchConversationResourcePlacementV1 =
  | 'floating'
  | 'activate-or-add'
  | 'new-tab'
  | 'replace-current'
  | 'official-sidebar'
  | 'disabled'

export interface WorkbenchConversationResourceClickPolicyV1 {
  readonly enabled: boolean
  readonly placement: WorkbenchConversationResourcePlacementV1
}

export interface WorkbenchConversationInteractionPolicyV1 {
  readonly version?: 2
  readonly conversationResources: Readonly<Record<string, WorkbenchConversationResourceClickPolicyV1>>
  readonly unknownResource: 'module-default' | 'official-sidebar' | 'disabled'
  /** Whether conversation marker colors should be painted around Areas and the floating workspace. */
  readonly showSessionAccentFrames?: boolean
  /** Font size used by Workbench Area and floating-workspace tab labels. */
  readonly tabFontSize?: 'standard' | 'large' | 'larger'
  /** Whether tab close buttons may be shown on active/hovered tabs. */
  readonly showTabCloseButtons?: boolean
}

export const DEFAULT_WORKBENCH_CONVERSATION_INTERACTION_POLICY: WorkbenchConversationInteractionPolicyV1 = Object.freeze({
  version: 2,
  conversationResources: Object.freeze({
    file: Object.freeze({ enabled: true, placement: 'floating' }),
    'changes-review': Object.freeze({ enabled: true, placement: 'floating' }),
    plan: Object.freeze({ enabled: true, placement: 'floating' }),
    'subagent-chat': Object.freeze({ enabled: true, placement: 'floating' }),
    browser: Object.freeze({ enabled: true, placement: 'floating' }),
    'schedule-task': Object.freeze({ enabled: true, placement: 'floating' }),
    'trajectory-inspect': Object.freeze({ enabled: true, placement: 'floating' }),
  }),
  unknownResource: 'module-default',
  showSessionAccentFrames: true,
  tabFontSize: 'standard',
  showTabCloseButtons: true,
})

const placements = new Set<WorkbenchConversationResourcePlacementV1>([
  'floating', 'activate-or-add', 'new-tab', 'replace-current', 'official-sidebar', 'disabled',
])

export function normalizeWorkbenchConversationInteractionPolicy(value: unknown): WorkbenchConversationInteractionPolicyV1 {
  const result: Record<string, WorkbenchConversationResourceClickPolicyV1> = {}
  if (typeof value === 'object' && value !== null) {
    const candidate = value as { conversationResources?: unknown; unknownResource?: unknown; showSessionAccentFrames?: unknown; tabFontSize?: unknown; showTabCloseButtons?: unknown }
    if (typeof candidate.conversationResources === 'object' && candidate.conversationResources !== null) {
      for (const [key, raw] of Object.entries(candidate.conversationResources)) {
        if (!/^[a-z0-9][a-z0-9._-]{0,63}$/u.test(key) || typeof raw !== 'object' || raw === null) continue
        const row = raw as { enabled?: unknown; placement?: unknown }
        if (typeof row.enabled !== 'boolean' || typeof row.placement !== 'string' || !placements.has(row.placement as WorkbenchConversationResourcePlacementV1)) continue
        result[key] = { enabled: row.enabled, placement: row.placement as WorkbenchConversationResourcePlacementV1 }
        if (Object.keys(result).length >= 64) break
      }
    }
    const unknownResource = candidate.unknownResource === 'official-sidebar' || candidate.unknownResource === 'disabled' || candidate.unknownResource === 'module-default'
      ? candidate.unknownResource
      : undefined
    const showSessionAccentFrames = typeof candidate.showSessionAccentFrames === 'boolean'
      ? candidate.showSessionAccentFrames
      : DEFAULT_WORKBENCH_CONVERSATION_INTERACTION_POLICY.showSessionAccentFrames ?? true
    const tabFontSize = candidate.tabFontSize === 'large' || candidate.tabFontSize === 'larger' || candidate.tabFontSize === 'standard'
      ? candidate.tabFontSize
      : DEFAULT_WORKBENCH_CONVERSATION_INTERACTION_POLICY.tabFontSize ?? 'standard'
    const showTabCloseButtons = typeof candidate.showTabCloseButtons === 'boolean'
      ? candidate.showTabCloseButtons
      : DEFAULT_WORKBENCH_CONVERSATION_INTERACTION_POLICY.showTabCloseButtons ?? true
    return {
      version: 2,
      conversationResources: { ...DEFAULT_WORKBENCH_CONVERSATION_INTERACTION_POLICY.conversationResources, ...result },
      unknownResource: unknownResource ?? DEFAULT_WORKBENCH_CONVERSATION_INTERACTION_POLICY.unknownResource,
      showSessionAccentFrames,
      tabFontSize,
      showTabCloseButtons,
    }
  }
  return structuredClone(DEFAULT_WORKBENCH_CONVERSATION_INTERACTION_POLICY)
}

export function conversationResourcePolicyFor(
  resourceType: string | undefined,
  policy: WorkbenchConversationInteractionPolicyV1 | undefined,
): WorkbenchConversationResourceClickPolicyV1 | undefined {
  if (resourceType === undefined) return undefined
  const normalized = normalizeWorkbenchConversationInteractionPolicy(policy)
  return normalized.conversationResources[resourceType]
}

export function conversationResourceActionFor(
  resourceType: string | undefined,
  policy: WorkbenchConversationInteractionPolicyV1 | undefined,
): { readonly handled: boolean; readonly options?: Readonly<Record<string, unknown>> } {
  const normalized = normalizeWorkbenchConversationInteractionPolicy(policy)
  const configured = resourceType === undefined
    ? undefined
    : normalized.conversationResources[resourceType]
  if (configured === undefined) {
    // A resource type that is not explicitly listed is still an unknown
    // resource from Workbench's point of view.  Do not let the mere presence
    // of a string silently bypass the user's unknown-resource policy.
    if (normalized.unknownResource === 'module-default') return { handled: true }
    if (normalized.unknownResource === 'disabled') return { handled: true, options: { ignoreResource: true } }
    return { handled: true, options: { floating: true } }
  }
  // `disabled` is a deliberate no-op and must stop the native callback from
  // opening the same resource in DSH's global Sidebar. `official-sidebar`
  // is legacy input only and now resolves to the floating host.
  if (!configured.enabled || configured.placement === 'disabled') return { handled: true, options: { ignoreResource: true } }
  if (configured.placement === 'official-sidebar' || configured.placement === 'floating') return { handled: true, options: { floating: true } }
  if (configured.placement === 'new-tab') return { handled: true, options: { revealIfOpened: false } }
  if (configured.placement === 'replace-current') return { handled: true, options: { replaceTab: true } }
  return { handled: true }
}

/** One-time migration; normalization alone never resets an explicit current preference. */
export function migrateWorkbenchInteractionPolicy(value: unknown): WorkbenchConversationInteractionPolicyV1 {
  const policy = normalizeWorkbenchConversationInteractionPolicy(value)
  if (value && typeof value === 'object' && 'version' in value && value.version === 2) return policy
  return { version: 2, conversationResources: Object.fromEntries(Object.entries(policy.conversationResources).map(([key, row]) => [key, { ...row, placement: !row.enabled || row.placement === 'disabled' ? 'disabled' : 'floating' }])), unknownResource: policy.unknownResource === 'disabled' ? 'disabled' : 'module-default', showSessionAccentFrames: policy.showSessionAccentFrames ?? true, tabFontSize: policy.tabFontSize ?? 'standard', showTabCloseButtons: policy.showTabCloseButtons ?? true }
}

export function workbenchTabFontSizePx(value: WorkbenchConversationInteractionPolicyV1['tabFontSize'], base = 12): number {
  return base + (value === 'large' ? 1 : value === 'larger' ? 2 : 0)
}
