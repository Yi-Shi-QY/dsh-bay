import type { ISessions, SessionReference } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

declare module '@deepseek-ai/dsh-api-session-controller/client' {
  interface SessionReferenceSourceMap { workbenchArea: true }
}

function unknownSession(error: unknown): boolean {
  return error instanceof Error && /unknown session/u.test(error.message)
}

/**
 * One Workbench Area owns one native reference and releases it with the Area claim.
 *
 * A Session the Host has just created may not be in this client's catalog
 * yet. For a LAN participant the native "session added" event is dropped:
 * DSH emits it before the Host records the Session in the shared Workbench,
 * so the participant is not yet authorized to see it. Retaining it would then
 * fail until a page reload pulled a fresh list. Instead the catalog is
 * refreshed once and the Session retained from the refreshed baseline.
 */
export function retainWorkbenchArea(sessions: Pick<ISessions, 'retain'> & Partial<Pick<ISessions, 'refresh'>>, input: {
  sessionId: SessionId
  areaId: string
  claim: string
}) {
  if (!input.areaId || !input.claim || !input.sessionId) throw new Error('workbench-area-binding-missing')
  const abort = new AbortController()
  const retain = (): SessionReference => sessions.retain(input.sessionId, { source: 'workbenchArea', signal: abort.signal })
  let reference: SessionReference | undefined
  let opening: Promise<SessionReference>
  let released = false
  const assertLive = () => {
    if (released) throw new Error('workbench-area-claim-expired')
    if (reference === undefined) throw new Error('workbench-area-session-pending')
    return reference.binding
  }
  try {
    reference = retain()
    opening = reference.ready.then(() => reference!)
  } catch (error) {
    if (!unknownSession(error) || sessions.refresh === undefined) throw error
    opening = sessions.refresh().then(() => {
      if (released) throw new Error('workbench-area-claim-expired')
      reference = retain()
      return reference.ready.then(() => reference!)
    })
  }
  return {
    get reference() { return reference },
    ready: opening.then(value => { assertLive(); return value }),
    assertLive,
    release() {
      if (released) return
      released = true
      abort.abort()
      reference?.release()
    },
  }
}
