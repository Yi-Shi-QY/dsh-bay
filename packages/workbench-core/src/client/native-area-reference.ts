import type { ISessions, SessionReference } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

declare module '@deepseek-ai/dsh-api-session-controller/client' {
  interface SessionReferenceSourceMap { workbenchArea: true }
}

/** One Workbench Area owns one native reference and releases it with the Area claim. */
export function retainWorkbenchArea(sessions: Pick<ISessions, 'retain'>, input: {
  sessionId: SessionId
  areaId: string
  claim: string
}) {
  if (!input.areaId || !input.claim || !input.sessionId) throw new Error('workbench-area-binding-missing')
  const abort = new AbortController()
  const reference: SessionReference = sessions.retain(input.sessionId, { source: 'workbenchArea', signal: abort.signal })
  let released = false
  const assertLive = () => {
    if (released) throw new Error('workbench-area-claim-expired')
    return reference.binding
  }
  return {
    reference,
    ready: reference.ready.then(() => { assertLive(); return reference }),
    assertLive,
    release() {
      if (released) return
      released = true
      abort.abort()
      reference.release()
    },
  }
}
