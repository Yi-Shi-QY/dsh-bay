import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** Core-local navigation messages; these are not DSH Runtime extensions. */
export interface SessionTarget {
  workspaceId?: string
  sessionId: SessionId
}

export interface SessionOpenCommandV1 {
  version: 1
  requestId: string
  target: SessionTarget
  disposition: 'reuse' | 'new' | 'duplicate'
  origin: 'new-session' | 'session-row' | 'module-action' | 'restore' | 'legacy'
}

export interface SessionPlacementRequestV2 {
  version: 2
  requestId: string
  disposition: 'reuse' | 'new'
  origin: 'new-session' | 'workspace-row' | 'conversation-workspace'
}

export interface SessionPlacementReservationV1 {
  reservationId: string
  requestId: string
}
