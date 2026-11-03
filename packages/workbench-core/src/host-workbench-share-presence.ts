import { createHash } from 'node:crypto'

const PRESENCE_TTL_MS = 12_000
const TYPING_TTL_MS = 3_000
const MAX_DRAFT_TEXT = 8 * 1024
const MAX_PARTICIPANTS_PER_WORKBENCH = 6

export interface WorkbenchSharePresenceV1 {
  readonly workbenchId: string
  readonly sessionId: string
  readonly areaId: string
  readonly participantId: string
  readonly role: 'host' | 'guest'
  readonly typing: boolean
  readonly draftText: string
  readonly hasAttachments: boolean
  readonly revision: number
  readonly updatedAt: number
}

export interface WorkbenchSharePresencePublishV1 {
  readonly workbenchId: string
  readonly sessionId: string
  readonly areaId: string
  readonly participantId: string
  readonly role: 'host' | 'guest'
  readonly typing: boolean
  readonly draftText: string
  readonly hasAttachments: boolean
  readonly revision: number
}

export interface WorkbenchSharePresenceBrokerOptionsV1 {
  readonly now?: () => number
  readonly maxDraftText?: number
  readonly maxParticipantsPerWorkbench?: number
}

export type WorkbenchSharePresencePublishResultV1 =
  | { readonly ok: true; readonly status: 'accepted' | 'cleared'; readonly presence?: WorkbenchSharePresenceV1 }
  | { readonly ok: false; readonly error: string }

function validId(value: unknown, max = 160): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max && /^[A-Za-z0-9_-]+$/u.test(value)
}

function keyOf(value: Pick<WorkbenchSharePresenceV1, 'workbenchId' | 'sessionId' | 'areaId' | 'participantId'>): string {
  return createHash('sha256').update(`${value.workbenchId}\0${value.sessionId}\0${value.areaId}\0${value.participantId}`).digest('hex')
}

export function createWorkbenchSharePresenceBroker(options: WorkbenchSharePresenceBrokerOptionsV1 = {}) {
  const now = options.now ?? Date.now
  const maxDraftText = options.maxDraftText ?? MAX_DRAFT_TEXT
  const maxParticipantsPerWorkbench = options.maxParticipantsPerWorkbench ?? MAX_PARTICIPANTS_PER_WORKBENCH
  const records = new Map<string, WorkbenchSharePresenceV1>()

  const prune = (): void => {
    const at = now()
    for (const [key, presence] of records) {
      if (at - presence.updatedAt >= PRESENCE_TTL_MS) records.delete(key)
    }
  }

  const publish = (input: WorkbenchSharePresencePublishV1): WorkbenchSharePresencePublishResultV1 => {
    prune()
    if (!validId(input.workbenchId) || !validId(input.sessionId) || !validId(input.areaId) || !validId(input.participantId, 96)) return { ok: false, error: 'invalid-presence-identity' }
    if (input.role !== 'host' && input.role !== 'guest') return { ok: false, error: 'invalid-presence-role' }
    if (!Number.isSafeInteger(input.revision) || input.revision < 0) return { ok: false, error: 'invalid-presence-revision' }
    if (typeof input.draftText !== 'string' || input.draftText.length > maxDraftText) return { ok: false, error: 'presence-draft-too-large' }
    if (typeof input.typing !== 'boolean' || typeof input.hasAttachments !== 'boolean') return { ok: false, error: 'invalid-presence-payload' }
    const key = keyOf(input)
    const previous = records.get(key)
    if (previous !== undefined && input.revision < previous.revision) return { ok: true, status: 'accepted', presence: previous }
    if (input.draftText === '' && !input.hasAttachments) {
      records.delete(key)
      return { ok: true, status: 'cleared' }
    }
    const participants = new Set([...records.values()]
      .filter(presence => presence.workbenchId === input.workbenchId)
      .map(presence => presence.participantId))
    if (previous === undefined && !participants.has(input.participantId) && participants.size >= maxParticipantsPerWorkbench) return { ok: false, error: 'presence-participant-limit-reached' }
    const at = now()
    const presence: WorkbenchSharePresenceV1 = Object.freeze({
      workbenchId: input.workbenchId, sessionId: input.sessionId, areaId: input.areaId,
      participantId: input.participantId, role: input.role,
      typing: input.typing,
      draftText: input.draftText, hasAttachments: input.hasAttachments,
      revision: input.revision, updatedAt: at,
    })
    records.set(key, presence)
    return { ok: true, status: 'accepted', presence }
  }

  const snapshot = (filter: { readonly workbenchId: string; readonly sessionId?: string; readonly areaId?: string; readonly role?: WorkbenchSharePresenceV1['role'] }): readonly WorkbenchSharePresenceV1[] => {
    prune()
    return [...records.values()]
      .filter(presence => presence.workbenchId === filter.workbenchId
        && (filter.sessionId === undefined || presence.sessionId === filter.sessionId)
        && (filter.areaId === undefined || presence.areaId === filter.areaId)
        && (filter.role === undefined || presence.role === filter.role))
      .map(presence => ({ ...presence, typing: presence.typing && now() - presence.updatedAt < TYPING_TTL_MS }))
  }

  return {
    publish,
    snapshot,
    clearWorkbench(workbenchId: string): void {
      for (const [key, presence] of records) if (presence.workbenchId === workbenchId) records.delete(key)
    },
    clearParticipant(workbenchId: string, participantId: string, sessionId?: string, areaId?: string): void {
      for (const [key, presence] of records) {
        if (presence.workbenchId === workbenchId && presence.participantId === participantId
          && (sessionId === undefined || presence.sessionId === sessionId)
          && (areaId === undefined || presence.areaId === areaId)) records.delete(key)
      }
    },
    dispose(): void { records.clear() },
    get size(): number { prune(); return records.size },
  }
}

export type WorkbenchSharePresenceBrokerV1 = ReturnType<typeof createWorkbenchSharePresenceBroker>
