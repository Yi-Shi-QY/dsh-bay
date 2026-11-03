import type { SessionListState as OfficialSessionListState, SessionSummary as OfficialSessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionStatusSnapshot } from '@deepseek-ai/dsh-client-ui-session/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

export type PendingInteractionStatus = 'approval' | 'plan-review' | 'question'
export type SessionSummary = OfficialSessionSummary & { pendingInteraction?: PendingInteractionStatus; completed?: boolean }
export type SessionListState = Omit<OfficialSessionListState, 'byId'> & { byId: Record<SessionId, SessionSummary>; current?: SessionId | undefined }

/** Project the official interaction feed and Workbench focus for the frozen browser. */
export function projectWorkbenchSidebarSessions(
  list: OfficialSessionListState,
  current: SessionId | undefined,
  pending: SessionStatusSnapshot,
): SessionListState {
  const byId: Record<SessionId, SessionSummary> = { ...list.byId }
  for (const [sessionId, interaction] of pending) {
    const summary = byId[sessionId]
    const kind = interaction.pendingInteraction?.kind
    if (summary !== undefined) byId[sessionId] = { ...summary, completed: interaction.completionUnread }
    if (summary !== undefined && (kind === 'approval' || kind === 'plan-review' || kind === 'question')) {
      byId[sessionId] = { ...byId[sessionId]!, pendingInteraction: kind }
    }
  }
  return { ...list, byId, current }
}
