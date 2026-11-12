import { SESSION_ACCENT_TOKENS, allocateSessionMarker } from './foundation/session-markers.ts'
import type { SessionMarkerRecord, WorkbenchRecordV2 } from './foundation/persistence.ts'
import type { WorkbenchSessionEntryV1 } from './workbench-directory-contract.ts'

type MarkersByWorkspace = Readonly<Record<string, Readonly<Record<string, SessionMarkerRecord>>>>

/** The DSH Workspace a catalogued Workbench Session belongs to, if the Host knows it. */
export function workbenchSessionWorkspace(record: WorkbenchRecordV2, entry: WorkbenchSessionEntryV1): string | undefined {
  const byProject = entry.projectId === undefined ? undefined : record.projects?.[entry.projectId]?.workspaceId
  if (byProject) return byProject
  const byArea = entry.areaId === undefined ? undefined : record.areaProjects?.[entry.areaId]?.workspaceId
  if (byArea) return byArea
  return Object.values(record.projects ?? {}).find(project => project.relativePath === entry.relativePath)?.workspaceId
}

/** Locate a Session of this Workbench and its Workspace. */
export function workbenchSessionLocation(record: WorkbenchRecordV2, sessionId: string): { readonly workspaceId: string } | undefined {
  const entry = Object.values(record.sessionCatalog ?? {}).find(row => row.sessionId === sessionId)
  const workspaceId = entry === undefined ? undefined : workbenchSessionWorkspace(record, entry)
  return workspaceId === undefined ? undefined : { workspaceId }
}

/**
 * Session markers for one Workbench, as every surface must see them.
 *
 * Markers are a Host profile preference keyed by Workspace. A browser owner or
 * LAN participant only receives the markers of this Workbench's Sessions, so a
 * Session of another Workbench is never disclosed. A catalogued Session with
 * no stored marker yet receives the marker the Host would allocate against the
 * complete Workspace, in catalog creation order. Every surface therefore shows
 * the same label and colour instead of allocating its own from a different
 * Session list.
 */
export function workbenchSessionMarkers(record: WorkbenchRecordV2, all: MarkersByWorkspace): Record<string, Record<string, SessionMarkerRecord>> {
  const output: Record<string, Record<string, SessionMarkerRecord>> = {}
  const working = new Map<string, Record<string, SessionMarkerRecord>>()
  const entries = Object.values(record.sessionCatalog ?? {})
    .filter((entry): entry is WorkbenchSessionEntryV1 & { sessionId: string } => typeof entry.sessionId === 'string' && entry.sessionId.length > 0)
    .sort((left, right) => left.createdAt - right.createdAt || left.sessionId.localeCompare(right.sessionId))
  for (const entry of entries) {
    const workspaceId = workbenchSessionWorkspace(record, entry)
    if (workspaceId === undefined) continue
    let markers = working.get(workspaceId)
    if (markers === undefined) { markers = { ...all[workspaceId] }; working.set(workspaceId, markers) }
    const marker = markers[entry.sessionId] ?? allocateSessionMarker(markers)
    markers[entry.sessionId] = marker
    ;(output[workspaceId] ??= {})[entry.sessionId] = structuredClone(marker)
  }
  return output
}

/** Accept a marker written by a scoped surface only in its stored shape. */
export function validSessionMarker(value: unknown): value is SessionMarkerRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const marker = value as Record<string, unknown>
  const keys = Object.keys(marker)
  if (keys.some(key => !['label', 'accentToken', 'customized'].includes(key))) return false
  if (typeof marker.label !== 'string' || marker.label.trim().length === 0 || marker.label.length > 32 || /[\u0000-\u001f\u007f]/u.test(marker.label)) return false
  if (typeof marker.accentToken !== 'string' || !(SESSION_ACCENT_TOKENS as readonly string[]).includes(marker.accentToken)) return false
  return typeof marker.customized === 'boolean'
}
