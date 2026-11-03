import type {
  SidebarRightTabActions,
  SidebarRightTabInfo,
  SidebarRightTabNavigation,
} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { ShortcutCatalogEntry } from '@deepseek-ai/dsh-client-shortcuts/client'
import { workbenchTerminalControllerTabId } from './native-terminal-retention.ts'

// BrowserController receives DSH's official `isTabOpen` callback. A
// Workbench occurrence is intentionally outside the official Sidebar list, so
// its controller must distinguish host teardown (keep the persisted
// checkpoint) from an explicit Workbench tab close (forget the bucket).
const closingWorkbenchTabs = new Set<string>()
const liveWorkbenchTabs = new Set<string>()

export function markWorkbenchNativeTabClosing(instanceId: string): void {
  closingWorkbenchTabs.add(instanceId)
}

export function unmarkWorkbenchNativeTabClosing(instanceId: string): void {
  closingWorkbenchTabs.delete(instanceId)
}

export function isWorkbenchNativeTabClosing(instanceId: string): boolean {
  return closingWorkbenchTabs.has(instanceId)
}

export function isWorkbenchNativeTab(instanceId: string): boolean {
  return liveWorkbenchTabs.has(instanceId)
}

/**
 * The small Area-owned part of a DSH right-sidebar occurrence.
 *
 * DSH's native Files, Terminal and Browser bodies are written against this
 * occurrence contract rather than against React props.  Workbench must keep
 * the occurrence local to an Area so native `tabActions` cannot accidentally
 * operate on the official Sidebar layout.
 */
export interface WorkbenchNativeTabOccurrenceOptions {
  readonly sessionId: string
  readonly areaId: string
  readonly instanceId: string
  readonly kind: string
  readonly contentId: string
  readonly title: string
  readonly params?: unknown
  readonly visible?: boolean
  readonly focused?: boolean
  /** Effective DSH shortcut shown by the native page controls. */
  readonly refreshShortcut?: ShortcutCatalogEntry | undefined
  readonly onOpenResource?: ((address: string, options?: Record<string, unknown>) => void) | undefined
  readonly onOpenTab?: ((kind: string, options?: Record<string, unknown>) => void) | undefined
  readonly onClose?: (() => void) | undefined
}

export interface WorkbenchNativeTabOccurrence {
  /** Read function supplied to DSH's contextual `tabInfo` hook. */
  readonly read: () => SidebarRightTabInfo
  /** React-compatible invalidation source for DSH's contextual tab hook. */
  readonly subscribe: (listener: () => void) => () => void
  readonly signal: AbortSignal
  readonly setVisible: (visible: boolean) => void
  readonly setFocused: (focused: boolean) => void
  /** Update the effective shortcut without replacing the occurrence. */
  readonly setRefreshShortcut: (shortcut: ShortcutCatalogEntry | undefined) => void
  /** Update Area actions after the React view is remounted without replacing the tab occurrence. */
  readonly setActions: (actions: {
    readonly onOpenResource?: ((address: string, options?: Record<string, unknown>) => void) | undefined
    readonly onOpenTab?: ((kind: string, options?: Record<string, unknown>) => void) | undefined
    readonly onClose?: (() => void) | undefined
  }) => void
  /** Update navigation/title without replacing the Area-local occurrence. */
  readonly update: (input: { readonly contentId?: string; readonly title?: string; readonly params?: unknown }) => void
  readonly navigate: (address: string, params?: unknown) => void
  /** Invoke the latest refresh command registered by the native body. */
  readonly refresh: () => void
  readonly dispose: () => void
}

/**
 * Create one Area-local tab occurrence.  This helper deliberately does not
 * register anything with `ctx.sidebarRight`; its callbacks are supplied by the
 * owning Area and can therefore be tested for isolation before a native body
 * is enabled by default.
 */
export function createWorkbenchNativeTabOccurrence(
  options: WorkbenchNativeTabOccurrenceOptions,
): WorkbenchNativeTabOccurrence {
  const controller = new AbortController()
  let disposed = false
  let visible = options.visible ?? true
  let focused = options.focused ?? true
  let title = options.title
  let contentId = options.contentId
  let refreshShortcut = options.refreshShortcut
  let handlers = {
    onOpenResource: options.onOpenResource,
    onOpenTab: options.onOpenTab,
    onClose: options.onClose,
  }
  const listeners = new Set<() => void>()
  let commands: { readonly refresh?: () => void } | undefined
  let navigation: SidebarRightTabNavigation = {
    address: contentId,
    params: options.params as SidebarRightTabNavigation['params'],
    revision: 0,
  }

  const ensureLive = (): boolean => !disposed && !controller.signal.aborted
  liveWorkbenchTabs.add(options.instanceId)
  const actions: SidebarRightTabActions = {
    bindCommands(next) {
      if (!ensureLive()) return () => {}
      commands = next
      return () => {
        if (commands === next) commands = undefined
      }
    },
    openResource(address, placement) {
      if (!ensureLive()) return
      handlers.onOpenResource?.(address, placement as Record<string, unknown> | undefined)
    },
    openTab(kind, placement) {
      if (!ensureLive()) return
      handlers.onOpenTab?.(kind, placement as Record<string, unknown> | undefined)
    },
    close() {
      if (!ensureLive()) return
      handlers.onClose?.()
    },
  }

  let snapshot: SidebarRightTabInfo
  const publish = (): void => {
    const nativeTabId = options.kind === 'terminal'
      ? workbenchTerminalControllerTabId(options.instanceId, contentId)
      : options.instanceId
    snapshot = {
      sidebar: { expanded: true, fullscreen: false },
      panel: { id: options.areaId as never },
      tab: {
        id: nativeTabId as never,
        kind: options.kind,
        contentId,
        title,
        visible,
        signal: controller.signal,
        navigation,
        actions,
        refreshShortcut,
        // DSH's public TabInfo currently exposes visibility, while Workbench
        // keeps focus as a separate runtime dimension for the Area adapter.
        focused,
      },
    } as SidebarRightTabInfo
    for (const listener of [...listeners]) listener()
  }
  publish()
  const read = (): SidebarRightTabInfo => snapshot

  return {
    read,
    subscribe: listener => {
      if (disposed) return () => {}
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    signal: controller.signal,
    setVisible: value => {
      if (!ensureLive() || visible === value) return
      visible = value
      publish()
    },
    setFocused: value => {
      if (!ensureLive() || focused === value) return
      focused = value
      publish()
    },
    setRefreshShortcut: value => {
      if (!ensureLive() || refreshShortcut === value) return
      refreshShortcut = value
      publish()
    },
    setActions: value => {
      if (!ensureLive()) return
      handlers = {
        onOpenResource: value.onOpenResource,
        onOpenTab: value.onOpenTab,
        onClose: value.onClose,
      }
    },
    update: input => {
      if (!ensureLive()) return
      let changed = false
      if (typeof input.contentId === 'string' && input.contentId.length > 0 && contentId !== input.contentId) {
        contentId = input.contentId
        changed = true
      }
      if (typeof input.title === 'string' && title !== input.title) {
        title = input.title
        changed = true
      }
      const nextAddress = contentId
      const nextParams = input.params as SidebarRightTabNavigation['params']
      if (navigation.address !== nextAddress || JSON.stringify(navigation.params) !== JSON.stringify(nextParams)) {
        navigation = { address: nextAddress, params: nextParams, revision: navigation.revision + 1 }
        changed = true
      }
      if (changed) publish()
    },
    navigate: (address, params) => {
      if (!ensureLive()) return
      contentId = address
      navigation = { address, params: params as SidebarRightTabNavigation['params'], revision: navigation.revision + 1 }
      publish()
    },
    refresh: () => {
      if (!ensureLive()) return
      commands?.refresh?.()
    },
    dispose: () => {
      if (disposed) return
      disposed = true
      commands = undefined
      listeners.clear()
      controller.abort()
      liveWorkbenchTabs.delete(options.instanceId)
    },
  }
}
