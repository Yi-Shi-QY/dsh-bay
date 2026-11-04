import type { GroupNode, SessionBindingV1 } from './model.ts'

/** The header and its visual dependents must resolve the same Area context. */
export function areaSessionBinding(
  group: GroupNode | undefined,
  workspaces: readonly { workspaceId: string; sessionIds: readonly string[] }[],
  projectNeutral: boolean | undefined,
  account: string,
): SessionBindingV1 | undefined {
  if (!group) return undefined
  if (group.areaBinding) return group.areaBinding
  const active = group.tabs.find(tab => tab.id === group.activeTabId) ?? group.tabs[0]
  if (active?.editorScope !== 'session' || active.sessionId === undefined) return undefined
  if (active.binding) return active.binding
  const workspaceId = projectNeutral
    ? workspaces.find(workspace => workspace.sessionIds.includes(active.sessionId!))?.workspaceId
    : account.startsWith('workspace:') ? account.slice('workspace:'.length) : undefined
  return { sessionId: active.sessionId, ...(workspaceId === undefined ? {} : { workspaceId }) }
}
