import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

interface RetainedTerminalTab {
  readonly sessionId: SessionId
  readonly tabId: string
  readonly contentId: string
}

/**
 * DSH keys Terminal views and retention by the native tab id. Workbench keeps
 * its layout tab id stable when replacing an editor, so include the content
 * instance in the DSH-facing identity to make an explicit replacement a new
 * terminal occurrence.
 */
export function workbenchTerminalControllerTabId(instanceId: string, contentId: string): string {
  return `workbench-terminal:${encodeURIComponent(instanceId)}:${encodeURIComponent(contentId)}`
}

interface RetentionHost {
  readonly webTerminals?: {
    retainTabs?: (tabs: readonly RetainedTerminalTab[]) => void
  }
  readonly sidebarRight?: {
    readonly openTabs?: {
      getSnapshot?: () => readonly { readonly sessionId: SessionId; readonly tabId: string; readonly contentId: string; readonly kind: string }[]
      subscribe?: (listener: () => void) => () => void
    }
  }
}

/**
 * Cordis only exposes injected services through Context.get().  Reading an
 * undeclared service as a property throws (even when optional chaining is
 * used), so keep all retention reads behind this compatibility seam.
 */
function serviceOf<T>(ctx: Context, name: string): T | undefined {
  try {
    return ctx.get(name) as T | undefined
  } catch {
    return undefined
  }
}

/**
 * DSH's terminal controller has one window-global retention projection.  The
 * official terminal plugin refreshes it from the official Sidebar only.  This
 * coordinator adds Workbench Area occurrences to the same projection while
 * leaving the official Sidebar records authoritative for their own entries.
 */
const coordinators = new WeakMap<object, WorkbenchTerminalRetention>()

class WorkbenchTerminalRetention {
  private readonly tabs = new Map<string, RetainedTerminalTab>()
  private unsubscribe: (() => void) | undefined
  private readonly sidebarRight: RetentionHost['sidebarRight'] | undefined
  private readonly webTerminals: RetentionHost['webTerminals'] | undefined

  constructor(private readonly ctx: Context) {
    this.sidebarRight = serviceOf<RetentionHost['sidebarRight']>(ctx, 'sidebarRight')
    this.webTerminals = serviceOf<RetentionHost['webTerminals']>(ctx, 'webTerminals')
    const openTabs = this.sidebarRight?.openTabs
    if (openTabs?.subscribe !== undefined) {
      this.unsubscribe = openTabs.subscribe(() => this.sync())
    }
    this.sync()
  }

  register(instanceId: string, tab: RetainedTerminalTab): () => void {
    this.tabs.set(instanceId, tab)
    this.sync()
    return () => {
      if (this.tabs.get(instanceId) !== tab) return
      this.tabs.delete(instanceId)
      this.sync()
      this.disposeIfEmpty()
    }
  }

  private sync(): void {
    const webTerminals = this.webTerminals
    if (webTerminals?.retainTabs === undefined) return
    const official = this.sidebarRight?.openTabs?.getSnapshot?.() ?? []
    const officialTerminalTabs = official
      .filter(tab => tab.kind === 'terminal')
      .map(({ sessionId, tabId, contentId }) => ({ sessionId, tabId, contentId }))
    // Keep the service as the receiver. DSH's native method updates its
    // controller-owned openTabs projection through `this`; extracting the
    // function first makes that receiver undefined in the desktop runtime.
    webTerminals.retainTabs([...officialTerminalTabs, ...this.tabs.values()])
  }

  private disposeIfEmpty(): void {
    if (this.tabs.size !== 0) return
    this.unsubscribe?.()
    this.unsubscribe = undefined
    coordinators.delete(this.ctx as unknown as object)
  }
}

/** Register a Workbench terminal occurrence in DSH's single retention owner. */
export function retainWorkbenchTerminalTab(
  ctx: Context,
  input: { readonly instanceId: string; readonly tabId?: string; readonly sessionId: string; readonly contentId: string },
): () => void {
  const key = ctx as unknown as object
  let coordinator = coordinators.get(key)
  if (coordinator === undefined) {
    coordinator = new WorkbenchTerminalRetention(ctx)
    coordinators.set(key, coordinator)
  }
  return coordinator.register(input.instanceId, {
    sessionId: input.sessionId as SessionId,
    tabId: input.tabId ?? input.instanceId,
    contentId: input.contentId,
  })
}
