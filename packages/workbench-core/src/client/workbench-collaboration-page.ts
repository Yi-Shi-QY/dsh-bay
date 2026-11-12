export interface WorkbenchCollaborationPageMarkerV1 {
  readonly collaborationId: string
  readonly participantId: string
  readonly role?: 'owner' | 'participant'
}

export function readWorkbenchCollaborationPageMarker(): WorkbenchCollaborationPageMarkerV1 | undefined {
  if (typeof window === 'undefined') return undefined
  const value = (window as Window & { __WORKBENCH_COLLABORATION__?: unknown }).__WORKBENCH_COLLABORATION__
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const candidate = value as Record<string, unknown>
  return typeof candidate.collaborationId === 'string' && candidate.collaborationId.length > 0
    && typeof candidate.participantId === 'string' && candidate.participantId.length > 0
    ? { collaborationId: candidate.collaborationId, participantId: candidate.participantId, role: candidate.role === 'owner' ? 'owner' : 'participant' }
    : undefined
}

export function isWorkbenchCollaborationPage(): boolean {
  return readWorkbenchCollaborationPageMarker() !== undefined
}
