import type { ConversationAreaServices } from '../foundation/conversation-area-coordinator.ts'

/** Wait for the official Host stream to publish a newly created Session. */
export function waitForSessionBinding(
  ready: () => boolean,
  subscribe: (listener: () => void) => () => void,
  signal: AbortSignal,
  timeoutMs = 30_000,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let done = false
    let unsubscribe = () => {}
    let timer: ReturnType<typeof setTimeout> | undefined
    const finish = (error?: Error) => {
      if (done) return
      done = true
      unsubscribe()
      clearTimeout(timer)
      signal.removeEventListener('abort', abort)
      if (error) reject(error)
      else resolve()
    }
    const abort = () => finish(new Error('Session binding wait cancelled'))
    const check = () => {
      try { if (ready()) finish() } catch (error) { finish(error instanceof Error ? error : new Error(String(error))) }
    }
    if (signal.aborted) { abort(); return }
    signal.addEventListener('abort', abort, { once: true })
    timer = setTimeout(() => finish(new Error('Session binding was not published by the official Runtime')), timeoutMs)
    try {
      unsubscribe = subscribe(check)
      if (done) unsubscribe()
      else check()
    } catch (error) { finish(error instanceof Error ? error : new Error(String(error))) }
  })
}

interface SessionCreationServices {
  create(workspaceId: string, options?: { agentPreset?: string }): Promise<string>
}

/** Return an Area placement target from the Host's exact create result. */
export function createAreaSessionCreator(services: SessionCreationServices): ConversationAreaServices['createWorkspaceSession'] {
  return async (workspaceId, options) => {
    const sessionId = await services.create(workspaceId,
      options.agentPreset === undefined ? undefined : { agentPreset: options.agentPreset })
    return { target: { sessionId, workspaceId }, reusedBlank: false }
  }
}
