import type { SessionBindingV1 } from './model.ts'
import type { SessionMarkerRecord } from './persistence.ts'

/** Availability state of one immutable Workspace and Session identity. */
export type ResolvedSessionStatus = 'available' | 'archived' | 'missing' | 'moved'

/** Shared display and provider decision for an exact Session binding. */
export interface ResolvedSessionTarget {
  target: SessionBindingV1
  status: ResolvedSessionStatus
  actualWorkspaceId?: string
  workspaceTitle: string
  sessionTitle: string
  marker: SessionMarkerRecord
  running: boolean
  updatedAt?: number
  shortId: string
  providerEligible: boolean
}

/** Workspace roster fields required by the Session target resolver. */
export interface SessionTargetResolverWorkspace {
  workspaceId: string
  title?: string
  path?: string
  sessionIds: readonly string[]
}

/** Session list fields required by the Session target resolver. */
export interface SessionTargetResolverSession {
  displayTitle?: string
  running?: boolean
  updatedAt?: number
}

/** Immutable fact snapshot used to resolve exact Session targets. */
export interface SessionTargetResolverSnapshot {
  workspaces: readonly SessionTargetResolverWorkspace[]
  sessions: Readonly<Record<string, SessionTargetResolverSession | undefined>>
  archivedSessionIds: readonly string[]
  markersByWorkspace: Readonly<Record<string, Readonly<Record<string, SessionMarkerRecord>>>>
}

const UNKNOWN_MARKER: SessionMarkerRecord = {
  label: '?', accentToken: 'accent-1', customized: false,
}

/**
 * Resolve one exact identity without mutating or guessing its binding.
 * @param target - persisted Workspace and Session identity.
 * @param snapshot - current Workspace, Session, archive, and marker facts.
 * @returns shared display status and provider eligibility.
 */
export function resolveSessionTarget(
  target: SessionBindingV1,
  snapshot: SessionTargetResolverSnapshot,
): ResolvedSessionTarget {
  const row = snapshot.sessions[target.sessionId]
  const boundWorkspace = target.workspaceId === undefined
    ? undefined
    : snapshot.workspaces.find(workspace => workspace.workspaceId === target.workspaceId)
  const actualWorkspace = snapshot.workspaces.find(workspace =>
    workspace.sessionIds.includes(target.sessionId))
  const archived = snapshot.archivedSessionIds.includes(target.sessionId)
  const moved = row !== undefined && (target.workspaceId === undefined
    ? actualWorkspace !== undefined
    : actualWorkspace !== undefined && actualWorkspace.workspaceId !== target.workspaceId)
  const status: ResolvedSessionStatus = archived
    ? 'archived'
    : row === undefined
      ? 'missing'
      : moved ? 'moved' : 'available'
  const marker = target.workspaceId === undefined
    ? UNKNOWN_MARKER
    : snapshot.markersByWorkspace[target.workspaceId]?.[target.sessionId] ?? UNKNOWN_MARKER
  return {
    target: structuredClone(target),
    status,
    ...(actualWorkspace === undefined ? {} : { actualWorkspaceId: actualWorkspace.workspaceId }),
    workspaceTitle: target.workspaceId === undefined
      ? '未分组'
      : boundWorkspace?.title ?? boundWorkspace?.path ?? target.workspaceId,
    sessionTitle: row?.displayTitle ?? '暂时不可用的对话',
    marker,
    running: row?.running === true,
    ...(row?.updatedAt === undefined ? {} : { updatedAt: row.updatedAt }),
    shortId: target.sessionId.slice(-8),
    providerEligible: status === 'available',
  }
}
