import type { SessionMarkerRecord } from './persistence.ts'

/** Theme-owned accents; arbitrary RGB values never enter persisted settings. */
export const SESSION_ACCENT_TOKENS = [
  'accent-1', 'accent-2', 'accent-3', 'accent-4', 'accent-5', 'accent-6',
  'accent-7', 'accent-8', 'accent-9', 'accent-10', 'accent-11', 'accent-12',
] as const

/** Small, platform-native emoji palette for quick Session identity labels. */
export const SESSION_MARKER_EMOJIS = [
  '😀', '🚀', '🧠', '🛠️', '🎨', '🧪', '📌', '🔥', '✨', '🌱', '🔭', '💡',
  '🧭', '📝', '📚', '🧩', '⚙️', '✅', '⏳', '🎯', '📊', '🔒', '🌟', '🐛',
  '☕', '🏗️', '🖥️', '💬', '📎', '🗂️', '🔧', '🛰️', '📦', '🧹', '🎉', '🧯',
] as const

/** Result of validating a user-supplied Workspace-local Session label. */
export type SessionLabelValidation =
  | { ok: true; label: string }
  | { ok: false; code: 'empty' | 'length' | 'control' }
  | { ok: false; code: 'conflict'; conflictSessionId: string }

function automaticLabel(index: number): string {
  let cursor = index + 1
  let label = ''
  while (cursor > 0) {
    cursor -= 1
    label = String.fromCharCode(65 + (cursor % 26)) + label
    cursor = Math.floor(cursor / 26)
  }
  return label
}

function normalizedIdentity(label: string): string {
  return label.normalize('NFKC').toLocaleLowerCase('und')
}

function graphemes(value: string): string[] {
  const Segmenter = (Intl as unknown as {
    Segmenter?: new(locales?: string | string[], options?: { granularity: 'grapheme' }) => {
      segment(input: string): Iterable<{ segment: string }>
    }
  }).Segmenter
  return Segmenter === undefined
    ? Array.from(value)
    : [...new Segmenter(undefined, { granularity: 'grapheme' }).segment(value)].map(row => row.segment)
}

/** Allocate the first unused automatic label and deterministic preset accent.
 * @param markers - existing markers in the owning Workspace.
 * @returns a new automatic marker that does not conflict with existing labels.
 */
export function allocateSessionMarker(
  markers: Readonly<Record<string, SessionMarkerRecord>>,
): SessionMarkerRecord {
  const used = new Set(Object.values(markers).map(marker => normalizedIdentity(marker.label)))
  for (let index = 0; ; index += 1) {
    const label = automaticLabel(index)
    if (used.has(normalizedIdentity(label))) continue
    return {
      label,
      accentToken: SESSION_ACCENT_TOKENS[index % SESSION_ACCENT_TOKENS.length] ?? 'accent-1',
      customized: false,
    }
  }
}

/** Lazily add identities for Sessions that reached the Workspace UI.
 * @param sessionIds - Sessions currently projected into the Workspace UI.
 * @param existing - already persisted Workspace marker records.
 * @returns complete markers and whether any marker was added.
 */
export function ensureSessionMarkers(
  sessionIds: readonly string[],
  existing: Readonly<Record<string, SessionMarkerRecord>>,
): { markers: Record<string, SessionMarkerRecord>; changed: boolean } {
  const markers = { ...existing }
  let changed = false
  for (const sessionId of sessionIds) {
    if (markers[sessionId] !== undefined) continue
    markers[sessionId] = allocateSessionMarker(markers)
    changed = true
  }
  return { markers, changed }
}

/** Validate a custom short label against Unicode and Workspace uniqueness rules.
 * @param rawLabel - user-provided label before trimming and normalization.
 * @param markers - existing markers in the owning Workspace.
 * @param currentSessionId - Session allowed to retain its own normalized label.
 * @returns normalized label or a specific validation failure.
 */
export function validateSessionLabel(
  rawLabel: string,
  markers: Readonly<Record<string, SessionMarkerRecord>>,
  currentSessionId: string,
): SessionLabelValidation {
  const label = rawLabel.trim().normalize('NFKC')
  if (label.length === 0) return { ok: false, code: 'empty' }
  if (/\p{Cc}/u.test(label)) return { ok: false, code: 'control' }
  const parts = graphemes(label)
  if (parts.length < 1 || parts.length > 3) return { ok: false, code: 'length' }
  const identity = normalizedIdentity(label)
  const conflict = Object.entries(markers).find(([sessionId, marker]) =>
    sessionId !== currentSessionId && normalizedIdentity(marker.label) === identity)
  return conflict === undefined
    ? { ok: true, label }
    : { ok: false, code: 'conflict', conflictSessionId: conflict[0] }
}
