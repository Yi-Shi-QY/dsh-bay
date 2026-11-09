import type { GroupNode, SessionBindingV1 } from './model.ts'

/** Resolve the active page source only; an Area has no representative Session. */
export function activePageSessionBinding(
  group: GroupNode | undefined,
  workspaces: readonly { workspaceId: string; sessionIds: readonly string[] }[],
  projectNeutral: boolean | undefined,
  account: string,
): SessionBindingV1 | undefined {
  if (!group) return undefined
  const active = group.tabs.find(tab => tab.id === group.activeTabId) ?? group.tabs[0]
  if (active?.editorScope !== 'session') return active?.binding
  if (active.pendingBinding || active.sessionId === undefined) return undefined
  if (active.binding) return active.binding
  const workspaceId = projectNeutral
    ? workspaces.find(workspace => workspace.sessionIds.includes(active.sessionId!))?.workspaceId
    : account.startsWith('workspace:') ? account.slice('workspace:'.length) : undefined
  return { sessionId: active.sessionId, ...(workspaceId === undefined ? {} : { workspaceId }) }
}
