import { sessionTargetKey, type SessionBindingV1 } from './model.ts'
import type { SessionMarkerRecord } from './persistence.ts'
import { ensureSessionMarkers } from './session-markers.ts'

export interface BindingPickerSession { title?: string; displayTitle: string; blank: boolean; running: boolean; updatedAt: number }
export interface BindingPickerWorkspace { workspaceId: string; title?: string; sessionIds: readonly string[] }
export interface BindingPickerCandidate { binding: SessionBindingV1; marker: SessionMarkerRecord; workspaceTitle: string; title: string; running: boolean; updatedAt: number }

/** Build one ordered result set shared by rendering and keyboard navigation. */
export function bindingPickerCandidates(input: {
  binding: SessionBindingV1; sessions: Readonly<Record<string, BindingPickerSession | undefined>>
  workspaces: readonly BindingPickerWorkspace[]; sessionIds: readonly string[]; workspaceTitle: string
  markers: Record<string, SessionMarkerRecord>; markersByWorkspace: Record<string, Record<string, SessionMarkerRecord>>
  archivedSessionIds: readonly string[]; query: string
}): BindingPickerCandidate[] {
  const query = input.query.trim().normalize('NFKC').toLocaleLowerCase('und')
  const archived = new Set(input.archivedSessionIds), seen = new Set<string>()
  const groups = [{ workspaceId: input.binding.workspaceId, title: input.workspaceTitle, sessionIds: input.sessionIds, markers: input.markers },
    ...input.workspaces.filter(w => w.workspaceId !== input.binding.workspaceId).map(w => ({ ...w, title: w.title ?? w.workspaceId, markers: input.markersByWorkspace[w.workspaceId] ?? {} }))]
  const result: BindingPickerCandidate[] = []
  for (const group of groups) {
    const markers = ensureSessionMarkers(group.sessionIds, group.markers).markers
    for (const sessionId of group.sessionIds) {
      const binding = { sessionId, ...(group.workspaceId === undefined ? {} : { workspaceId: group.workspaceId }) }
      const key = sessionTargetKey(binding), row = input.sessions[sessionId], marker = markers[sessionId]
      if (seen.has(key) || key === sessionTargetKey(input.binding) || !row || row.blank || archived.has(sessionId) || !marker) continue
      seen.add(key)
      const title = row.title?.trim() || row.displayTitle
      if (query && ![title, row.displayTitle, marker.label, sessionId, group.title].some(text => text.normalize('NFKC').toLocaleLowerCase('und').includes(query))) continue
      result.push({ binding, marker, title, workspaceTitle: group.title, running: row.running, updatedAt: row.updatedAt })
    }
  }
  return result.sort((a, b) => b.updatedAt - a.updatedAt || sessionTargetKey(a.binding).localeCompare(sessionTargetKey(b.binding)))
}
