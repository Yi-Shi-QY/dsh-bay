import type { Context } from '@deepseek-ai/cordis'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'

/** Resolve the rc3 client Session service, not the Host-side SessionStore. */
export function getWorkbenchClientSessions(ctx: Context): ISessions {
  const candidateContext = ctx as unknown as {
    get?: (name: string, strict?: boolean) => unknown
    sessions?: unknown
  }
  let injected: unknown
  try {
    injected = candidateContext.get?.('sessions', false)
  } catch {
    injected = undefined
  }
  return (injected ?? candidateContext.sessions) as ISessions
}
