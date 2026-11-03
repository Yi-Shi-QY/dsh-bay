/** User-controlled routing policy for resources emitted by a DSH Conversation. */
export type WorkbenchConversationResourcePlacementV1 =
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
  readonly conversationResources: Readonly<Record<string, WorkbenchConversationResourceClickPolicyV1>>
  readonly unknownResource: 'module-default' | 'official-sidebar' | 'disabled'
}

export const DEFAULT_WORKBENCH_CONVERSATION_INTERACTION_POLICY: WorkbenchConversationInteractionPolicyV1 = Object.freeze({
  conversationResources: Object.freeze({
    file: Object.freeze({ enabled: true, placement: 'activate-or-add' }),
    'changes-review': Object.freeze({ enabled: true, placement: 'activate-or-add' }),
    plan: Object.freeze({ enabled: true, placement: 'activate-or-add' }),
    'subagent-chat': Object.freeze({ enabled: true, placement: 'activate-or-add' }),
    browser: Object.freeze({ enabled: true, placement: 'activate-or-add' }),
    'schedule-task': Object.freeze({ enabled: true, placement: 'activate-or-add' }),
    'trajectory-inspect': Object.freeze({ enabled: true, placement: 'activate-or-add' }),
  }),
  unknownResource: 'module-default',
})

const placements = new Set<WorkbenchConversationResourcePlacementV1>([
  'activate-or-add', 'new-tab', 'replace-current', 'official-sidebar', 'disabled',
])

export function normalizeWorkbenchConversationInteractionPolicy(value: unknown): WorkbenchConversationInteractionPolicyV1 {
  const result: Record<string, WorkbenchConversationResourceClickPolicyV1> = {}
  if (typeof value === 'object' && value !== null) {
    const candidate = value as { conversationResources?: unknown; unknownResource?: unknown }
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
    return {
      conversationResources: { ...DEFAULT_WORKBENCH_CONVERSATION_INTERACTION_POLICY.conversationResources, ...result },
      unknownResource: unknownResource ?? DEFAULT_WORKBENCH_CONVERSATION_INTERACTION_POLICY.unknownResource,
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
    return { handled: false }
  }
  // `disabled` is a deliberate no-op and must stop the native callback from
  // opening the same resource in DSH's global Sidebar. `official-sidebar`
  // remains the explicit escape hatch to the upstream owner.
  if (!configured.enabled || configured.placement === 'disabled') return { handled: true, options: { ignoreResource: true } }
  if (configured.placement === 'official-sidebar') return { handled: false }
  if (configured.placement === 'new-tab') return { handled: true, options: { revealIfOpened: false } }
  if (configured.placement === 'replace-current') return { handled: true, options: { replaceTab: true } }
  return { handled: true }
}
