import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { WorkbenchPageLoading } from '../foundation/WorkbenchPageLoading.tsx'
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SidebarRightTabClaim, SidebarRightTabInfo } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { ShortcutCatalogEntry } from '@deepseek-ai/dsh-client-shortcuts/client'
import type { WorkbenchEditorOwnerProps } from './editor-slots.ts'
import { createWorkbenchNativeAreaSlotRenderer } from './native-area-slot-renderer.tsx'
import { retainWorkbenchArea } from './native-area-reference.ts'
import { getWorkbenchClientSessions } from './session-service.ts'
import {
  createWorkbenchNativeTabOccurrence,
  markWorkbenchNativeTabClosing,
  unmarkWorkbenchNativeTabClosing,
  type WorkbenchNativeTabOccurrence,
} from './native-tab-occurrence.ts'
import { retainWorkbenchTerminalTab, workbenchTerminalControllerTabId } from './native-terminal-retention.ts'
import { registerWorkbenchNativeTabTitle } from './native-tab-title-registry.tsx'
import { workbenchNativeSidebarForKind, workbenchNativeSidebarForResourceAddress } from './native-sidebar-registry.ts'
import {
  workbenchConversationResourceBindingForAddress,
  workbenchResourceMatchesSession,
  workbenchScheduleTaskParams,
} from './workbench-resource-opener.ts'

const nativeCloseHandlers = new Map<string, () => void>()

interface NativeOccurrenceRecord {
  readonly key: string
  readonly instanceId: string
  readonly occurrence: WorkbenchNativeTabOccurrence
}

/**
 * Keep the DSH tab occurrence alive for the Workbench tab record, rather than
 * for the currently mounted React body.  DSH stores and faces treat the
 * occurrence signal as tab lifetime: aborting it while a user merely switches
 * to another Workbench tab would forget Files/Document state and make Browser
 * checkpoints disappear.  A tab close (or Workbench teardown) is the explicit
 * owner operation that finally disposes the occurrence.
 */
const nativeOccurrences = new Map<string, NativeOccurrenceRecord>()
let pendingHostDispose: ReturnType<typeof globalThis.setTimeout> | undefined

function occurrenceKey(input: { readonly areaId: string; readonly instanceId: string; readonly kind: string; readonly sessionId: string; readonly claim: string }): string {
  return `${input.areaId}:${input.instanceId}:${input.kind}:${input.sessionId}:${input.claim}`
}

function occurrenceIdentityKey(input: { readonly areaId: string; readonly instanceId: string; readonly kind: string }): string {
  return `${input.areaId}:${input.instanceId}:${input.kind}`
}

function retainNativeOccurrence(input: {
  readonly areaId: string
  readonly instanceId: string
  readonly kind: string
  readonly sessionId: string
  readonly claim: string
  readonly contentId: string
  readonly title: string
  readonly params?: unknown
  readonly visible: boolean
  readonly focused: boolean
  readonly refreshShortcut?: ShortcutCatalogEntry | undefined
  readonly onOpenResource?: ((address: string, options?: Record<string, unknown>) => void) | undefined
  readonly onOpenTab?: ((kind: string, options?: Record<string, unknown>) => void) | undefined
  readonly onClose?: (() => void) | undefined
}): { readonly occurrence: WorkbenchNativeTabOccurrence; readonly release: () => void } {
  const key = occurrenceKey(input)
  const identity = occurrenceIdentityKey(input)
  // A tab instance can be rebound to a new Session/claim while its React
  // editor is being replaced.  Do not leave the old native controller alive
  // until the tab is eventually closed: it would retain the previous store
  // and could receive late events for the new binding.
  for (const [previousKey, previous] of [...nativeOccurrences]) {
    const previousTab = previous.occurrence.read().tab
    if (previousKey === key || previous.instanceId !== input.instanceId) continue
    const previousIdentity = occurrenceIdentityKey({ areaId: String(previous.occurrence.read().panel.id), instanceId: previous.instanceId, kind: previousTab.kind })
    if (previousIdentity !== identity) continue
    nativeOccurrences.delete(previousKey)
    previous.occurrence.dispose()
  }
  let record = nativeOccurrences.get(key)
  if (record === undefined) {
    record = {
      key,
      instanceId: input.instanceId,
      occurrence: createWorkbenchNativeTabOccurrence({
        sessionId: input.sessionId,
        areaId: input.areaId,
        instanceId: input.instanceId,
        kind: input.kind,
        contentId: input.contentId,
        title: input.title,
        params: input.params,
        visible: input.visible,
        focused: input.focused,
        ...(input.refreshShortcut === undefined ? {} : { refreshShortcut: input.refreshShortcut }),
        onOpenResource: input.onOpenResource,
        onOpenTab: input.onOpenTab,
        onClose: input.onClose,
      }),
    }
    nativeOccurrences.set(key, record)
  } else {
    record.occurrence.setActions({
      onOpenResource: input.onOpenResource,
      onOpenTab: input.onOpenTab,
      onClose: input.onClose,
    })
  }
  return {
    occurrence: record.occurrence,
    // Releasing the React view deliberately does not abort the occurrence.
    // The layout tab still exists and can be activated again later.
    release: () => {},
  }
}

/** Dispose every Area occurrence for a Workbench tab before its record closes. */
function disposeWorkbenchNativeOccurrences(instanceId: string): void {
  for (const [key, record] of [...nativeOccurrences]) {
    if (record.instanceId !== instanceId) continue
    nativeOccurrences.delete(key)
    record.occurrence.dispose()
  }
}

/** Dispose all persisted native occurrences when the Workbench host unmounts. */
export function disposeAllWorkbenchNativeOccurrences(retain: ReadonlySet<string> = new Set()): void {
  if (pendingHostDispose !== undefined) {
    globalThis.clearTimeout(pendingHostDispose)
    pendingHostDispose = undefined
  }
  for (const [key, record] of [...nativeOccurrences]) {
    if (retain.has(record.instanceId)) continue
    nativeOccurrences.delete(key)
    record.occurrence.dispose()
  }
}

/**
 * Defer host teardown by one task. React StrictMode replays an effect by
 * running its cleanup and setup back-to-back; the deferred task is cancelled
 * by the new setup so a development replay cannot abort a still-live tab.
 */
export function scheduleDisposeAllWorkbenchNativeOccurrences(retain: ReadonlySet<string> = new Set()): void {
  if (pendingHostDispose !== undefined) globalThis.clearTimeout(pendingHostDispose)
  pendingHostDispose = globalThis.setTimeout(() => {
    pendingHostDispose = undefined
    disposeAllWorkbenchNativeOccurrences(retain)
  }, 0)
}

export function cancelScheduledWorkbenchNativeDispose(): void {
  if (pendingHostDispose === undefined) return
  globalThis.clearTimeout(pendingHostDispose)
  pendingHostDispose = undefined
}

/** Register native resource cleanup behind an active Workbench Area tab. */
export function registerWorkbenchNativeClose(instanceId: string, handler: () => void): () => void {
  nativeCloseHandlers.set(instanceId, handler)
  return () => {
    if (nativeCloseHandlers.get(instanceId) === handler) nativeCloseHandlers.delete(instanceId)
  }
}

/** Run native cleanup before Core removes the Workbench tab. */
export function closeWorkbenchNative(instanceId: string): void {
  markWorkbenchNativeTabClosing(instanceId)
  try {
    nativeCloseHandlers.get(instanceId)?.()
  } finally {
    // Occurrence abort handlers run synchronously. Keep the marker set until
    // after disposal so Browser's wrapped `forget` action can distinguish an
    // explicit Workbench close from host teardown.
    disposeWorkbenchNativeOccurrences(instanceId)
    unmarkWorkbenchNativeTabClosing(instanceId)
  }
}

/**
 * Check the live DSH registration surface for one native Area body.
 *
 * Keeping this probe in the adapter gives registration loading/unloading one
 * compatibility seam and avoids treating a fallback component as proof that
 * the DSH package is installed.  The public slot registry is intentionally
 * optional here so isolated fixtures and older hosts can still report the
 * native path as unavailable without throwing from the Area tree.
 */
export function hasWorkbenchNativeSidebarRegistration(ctx: Context, entryKey: string): boolean {
  const slots = ctx.slots as unknown as {
    spec?: (slot: string) => unknown
    entriesOfSlot?: (slot: string) => readonly { readonly options: { readonly key?: string } }[]
  }
  if (slots.spec?.('sidebar.right.pane.tab') === undefined) return false
  return slots.entriesOfSlot?.('sidebar.right.pane.tab')?.some(entry => entry.options.key === entryKey) === true
}

interface ShortcutServiceProjection {
  readonly catalog?: {
    getSnapshot?: () => readonly ShortcutCatalogEntry[]
    subscribe?: (listener: () => void) => () => void
  }
}

/**
 * Read the host shortcut service without requiring the Area renderer's Fiber
 * to declare `shortcuts` itself.  Native Sidebar entries are rendered through
 * a private Workbench slot host; that host has the DSH service available, but
 * it is not a Cordis plugin Fiber with the top-level Workbench inject list.
 * Accessing `ctx.shortcuts` therefore throws even though the service is live.
 * `Context.get()` is the supported non-injected lookup for this projection.
 */
function shortcutServiceOf(ctx: Context): ShortcutServiceProjection | undefined {
  try {
    return ctx.get('shortcuts') as ShortcutServiceProjection | undefined
  } catch {
    return undefined
  }
}

function refreshShortcutOf(ctx: Context): ShortcutCatalogEntry | undefined {
  return shortcutServiceOf(ctx)?.catalog?.getSnapshot?.().find(entry => entry.id === 'page.refresh')
}

export interface NativeSidebarAreaEditorProps {
  readonly owner: WorkbenchEditorOwnerProps
  readonly ctx: Context
  readonly entryKey: string
  readonly kind: string
  readonly title: string
  readonly contentId?: string
  readonly fallback?: ReactNode
  readonly children?: ReactNode
  readonly onOpenResource?: (address: string, options?: Record<string, unknown>) => void
  readonly onOpenTab?: (kind: string, options?: Record<string, unknown>) => boolean | void
  readonly onClose?: () => void
}

/**
 * Mount one DSH right-sidebar body in a Workbench Area.
 *
 * The component deliberately creates an Area-local tab occurrence instead of
 * calling `ctx.sidebarRight.openTab()` or registering with DSH's Sidebar. The
 * native body therefore keeps its real UI/store/commands while all placement
 * and close actions remain owned by the Workbench Area.
 */
export function NativeSidebarAreaEditor({
  owner, ctx, entryKey, kind, title, contentId = `workbench://${kind}/${owner.instanceId}`,
  fallback = null, children, onOpenResource, onOpenTab, onClose,
}: NativeSidebarAreaEditorProps): ReactNode {
  const sessions = getWorkbenchClientSessions(ctx)
  const nativeInstanceId = owner.runtimeIdentity ?? owner.instanceId
  const nativeDefinition = workbenchNativeSidebarForKind(kind)
  const resourceOnly = nativeDefinition?.resourceOnly === true
  const sessionId = owner.sessionId
  const areaId = owner.runtimeIdentity ?? owner.areaId
  const claim = owner.runtimeIdentity ? `${owner.runtimeIdentity}:${owner.bindingGeneration ?? 0}` : owner.areaClaim
  const areaVisible = owner.lifecycle?.visibility === undefined || owner.lifecycle.visibility === 'visible'
  const areaFocused = owner.lifecycle?.focused === true
  const callbacks = useRef<{
    onOpenResource?: ((address: string, options?: Record<string, unknown>) => void) | undefined
    onOpenTab?: ((kind: string, options?: Record<string, unknown>) => boolean | void) | undefined
    onClose?: (() => void) | undefined
  }>({ onOpenResource, onOpenTab, onClose })
  // Native DSH bodies dispatch these actions through their tab occurrence.
  // When no explicit callback is supplied, route them to the owning Area so
  // the action cannot silently mutate DSH's global Sidebar layout.
  callbacks.current = {
    onOpenResource,
    onOpenTab: onOpenTab ?? owner.openNativeTab,
    onClose: onClose ?? owner.close,
  }
  const nativeState = owner.state !== null && typeof owner.state === 'object' && !Array.isArray(owner.state)
    ? owner.state as { readonly nativeContentId?: unknown; readonly nativeParams?: unknown }
    : undefined
  const nativeContentId = typeof nativeState?.nativeContentId === 'string' && nativeState.nativeContentId.length > 0
    ? nativeState.nativeContentId
    : resourceOnly ? undefined : contentId
  // An imported/restored Area must not rely on DSH's separate Sidebar tab-id
  // history. Its durable resource address already names the exact task.
  const nativeParams = useMemo(() => kind === 'schedule-task'
    ? workbenchScheduleTaskParams(nativeContentId) ?? nativeState?.nativeParams
    : nativeState?.nativeParams, [kind, nativeContentId, nativeState?.nativeParams])
  const resourceReady = resourceOnly === false
    || (nativeContentId !== undefined
      && workbenchNativeSidebarForResourceAddress(nativeContentId)?.kind === kind)
  const openNativeTab = useCallback((nextKind: string, placement?: Record<string, unknown>): boolean | void => {
    const replaceTab = placement?.replaceTab
    const replacesCurrent = replaceTab === nativeInstanceId
      || (kind === 'terminal' && nativeContentId !== undefined
        && replaceTab === workbenchTerminalControllerTabId(nativeInstanceId, nativeContentId))
    return callbacks.current.onOpenTab?.(nextKind, {
      ...(placement ?? {}),
      ...(replacesCurrent ? { replaceTab: true } : {}),
      ...(typeof replaceTab === 'string' && !replacesCurrent ? { replaceTab: undefined } : {}),
    })
  }, [kind, nativeContentId, nativeInstanceId])
  const closeNativeTerminal = useCallback(() => {
    if (kind !== 'terminal' || sessionId === undefined) return
    const service = (ctx as unknown as {
      webTerminals?: { close?: (sessionId: string, key: string, contentId: string, terminalId?: unknown) => void }
    }).webTerminals
    if (service?.close === undefined || nativeContentId === undefined) return
    const terminalId = nativeParams !== null && typeof nativeParams === 'object' && !Array.isArray(nativeParams)
      && 'terminalId' in nativeParams
      ? (nativeParams as { readonly terminalId?: unknown }).terminalId
      : undefined
    service.close(sessionId, workbenchTerminalControllerTabId(nativeInstanceId, nativeContentId), nativeContentId, terminalId)
  }, [ctx, kind, nativeContentId, nativeParams, nativeInstanceId, sessionId])
  const [preview, setPreview] = useState<{
    readonly address: string
    readonly entryKey: string
    readonly info: SidebarRightTabInfo
  }>()
  const previewLifetime = useRef<AbortController>()
  const closePreview = useCallback(() => {
    previewLifetime.current?.abort()
    previewLifetime.current = undefined
    setPreview(undefined)
  }, [])
  const openResourcePreview = useCallback((address: string, options?: Record<string, unknown>) => {
    // Native bodies can emit a late resource action after their Area has been
    // rebound. Do not route another Session's resource to either this Area or
    // the official global Sidebar as a silent fallback.
    if (sessionId !== undefined && !workbenchResourceMatchesSession(address, sessionId)) return
    if (callbacks.current.onOpenResource !== undefined) {
      callbacks.current.onOpenResource(address, options)
      return
    }
    const openTab = openNativeTab
    if (callbacks.current.onOpenTab !== undefined) {
      const resourceDefinition = workbenchNativeSidebarForResourceAddress(address)
      const declaredResource = workbenchConversationResourceBindingForAddress(address, owner.declaration?.conversationResources)
      const resourceKind = resourceDefinition?.kind === kind && address.startsWith('dsh-resource://file/')
        ? 'documentpreview'
        : resourceDefinition?.kind ?? declaredResource?.editorId
      const replaceTab = options?.replaceTab
      const placement = {
        nativeContentId: address,
        resourceAddress: address,
        ...(declaredResource === undefined ? {} : { resourceType: declaredResource.resourceType, editorId: declaredResource.editorId }),
        ...(options?.params === undefined ? {} : { params: options.params }),
        ...(replaceTab === true || replaceTab === nativeInstanceId ? { replaceTab: true } : {}),
        ...(options?.revealIfOpened === undefined ? {} : { revealIfOpened: options.revealIfOpened }),
      }
      // Resource-backed DSH bodies (Plan, Changes Review, Schedule, Guide and
      // Subagent) are deliberately routed by their real resource identity.
      // A pending adapter must not be disguised as a file preview.
      if (resourceKind !== undefined && openTab(resourceKind, placement) !== false) return
      if (resourceKind === undefined && openTab('documentpreview', placement) !== false) return
      // A managed instance must never bypass the coordinator after rejection.
      if (owner.runtimeIdentity) return
    }
    if (sessionId === undefined || areaId === undefined) return
    try {
      const nextClaim = ctx.sidebarRightTabs.claim(address)
      const definition = ctx.sidebarRightTabs.get(nextClaim.kind)
      if (definition === undefined) return
      closePreview()
      const lifetime = new AbortController()
      previewLifetime.current = lifetime
      ctx.resources.pin(address, lifetime.signal)
      const signal = lifetime.signal
      setPreview({
        address,
        entryKey: definition.id,
        info: {
          sidebar: { expanded: true, fullscreen: false },
          panel: { id: areaId as never, isFloating: false },
          tab: {
            id: `${nativeInstanceId}:resource` as never,
            kind: nextClaim.kind,
            contentId: nextClaim.contentId,
            title: nextClaim.title,
            visible: true,
            signal,
            navigation: { address, params: undefined, revision: 0 },
            actions: {
              close: closePreview,
              openResource: (next: string, placement?: Record<string, unknown>) => openResourcePreview(next, placement),
              openTab: (nextKind: string, placement: unknown) => openNativeTab(nextKind, placement as Record<string, unknown> | undefined),
            },
          },
        } as SidebarRightTabInfo,
      })
    } catch {
      // A missing preview definition must not mutate DSH's official Sidebar or
      // throw out of the Area render tree. The native body keeps its own error
      // surface, just as it does in DSH's official Sidebar.
    }
  }, [areaId, closePreview, ctx, openNativeTab, nativeInstanceId, sessionId])
  const occurrenceLease = useMemo(() => {
    if (!resourceReady || nativeContentId === undefined || sessionId === undefined || areaId === undefined || claim === undefined) return undefined
    return retainNativeOccurrence({
      sessionId: sessionId as SessionId,
      areaId,
      instanceId: nativeInstanceId,
      kind,
      claim,
      contentId: nativeContentId,
      title,
      params: nativeParams,
      visible: areaVisible,
      focused: areaFocused,
      ...(refreshShortcutOf(ctx) === undefined ? {} : { refreshShortcut: refreshShortcutOf(ctx) }),
      onOpenResource: openResourcePreview,
      onOpenTab: openNativeTab,
      onClose: () => callbacks.current.onClose?.(),
    })
  // The occurrence identity follows the tab instance and exact Area binding.
  // Updating callbacks is intentionally handled through the ref above so a
  // render does not tear down a native Browser/Terminal controller.
  }, [areaId, claim, ctx, kind, nativeContentId, nativeParams, openNativeTab, openResourcePreview, nativeInstanceId, resourceReady, sessionId])
  const occurrence = occurrenceLease?.occurrence

  // The lease only follows the mounted React view.  The occurrence itself is
  // released by closeWorkbenchNative when the Workbench tab record is removed.
  useEffect(() => () => occurrenceLease?.release(), [occurrenceLease])

  // Update the callbacks held by a persisted occurrence after the view is
  // remounted or the owning Area receives a new placement callback.
  useEffect(() => {
    occurrence?.setActions({
      onOpenResource: openResourcePreview,
      onOpenTab: openNativeTab,
      onClose: () => callbacks.current.onClose?.(),
    })
  }, [occurrence, openNativeTab, openResourcePreview])
  const [native, setNative] = useState<ReturnType<typeof createWorkbenchNativeAreaSlotRenderer>>()
  const [available, setAvailable] = useState<boolean>()
  const [registrationRevision, setRegistrationRevision] = useState(0)

  // DSH registrations are dynamic: a host can finish loading the native tab
  // plugin after Workbench has already entered, and a plugin can be unloaded
  // while an Area remains mounted.  Do not make the initial registration
  // probe a one-shot decision; re-run the native lease/render path whenever
  // the authoritative slot registry changes.  The listener is intentionally
  // limited to the body seat, since title registration follows the same
  // renderer lease and will be recreated with it.
  useEffect(() => {
    const slots = (ctx as unknown as { slots?: unknown }).slots as {
      subscribe?: (slot: string, listener: () => void) => () => void
    } | undefined
    if (slots?.subscribe === undefined) return
    return slots.subscribe('sidebar.right.pane.tab', () => {
      setRegistrationRevision(value => value + 1)
    })
  }, [ctx])
  const previewOccurrence = useMemo(() => {
    if (preview === undefined || sessionId === undefined || areaId === undefined) return undefined
    const refreshShortcut = refreshShortcutOf(ctx)
    return createWorkbenchNativeTabOccurrence({
      sessionId: sessionId as SessionId,
      areaId,
      instanceId: `${nativeInstanceId}:resource`,
      kind: preview.info.tab.kind,
      contentId: preview.info.tab.contentId,
      title: preview.info.tab.title,
      ...(refreshShortcut === undefined ? {} : { refreshShortcut }),
      visible: areaVisible,
      focused: areaFocused,
      onOpenResource: (address, options) => openResourcePreview(address, options),
      onOpenTab: openNativeTab,
      onClose: closePreview,
    })
  }, [areaId, closePreview, ctx, openNativeTab, openResourcePreview, nativeInstanceId, preview, sessionId])

  useEffect(() => {
    if (nativeContentId === undefined) {
      occurrence?.update({ title, params: nativeParams })
      return
    }
    occurrence?.update({ contentId: nativeContentId, title, params: nativeParams })
  }, [nativeContentId, nativeParams, occurrence, title])

  useEffect(() => {
    occurrence?.setVisible(areaVisible)
    occurrence?.setFocused(areaFocused)
  }, [areaFocused, areaVisible, occurrence])

  // DSH's native tab-info factory projects the effective keyboard binding from
  // the live shortcut catalog. Keep the Area-local occurrence on that same
  // source so Files, Browser, and Document Preview show the current binding
  // after a user changes shortcuts without reopening the tab.
  useEffect(() => {
    if (occurrence === undefined) return
    const catalog = shortcutServiceOf(ctx)?.catalog
    const sync = (): void => { occurrence.setRefreshShortcut(refreshShortcutOf(ctx)) }
    sync()
    return catalog?.subscribe?.(sync)
  }, [ctx, occurrence])

  useEffect(() => {
    previewOccurrence?.setVisible(areaVisible)
    previewOccurrence?.setFocused(areaFocused)
  }, [areaFocused, areaVisible, previewOccurrence])

  useEffect(() => {
    if (!resourceReady || sessionId === undefined || areaId === undefined || claim === undefined || occurrence === undefined) return
    let live = true
    let renderer: ReturnType<typeof createWorkbenchNativeAreaSlotRenderer> | undefined
    let lease: ReturnType<typeof retainWorkbenchArea>
    try {
      // Check the DSH registration before retaining an Area reference. When a
      // host does not ship this native body, the explicit Workbench fallback
      // owns the only reference; probing and then mounting the fallback would
      // otherwise retain the same Session twice.
      if (!hasWorkbenchNativeSidebarRegistration(ctx, entryKey)) {
        setAvailable(false)
        return
      }
      lease = retainWorkbenchArea(sessions, { sessionId: sessionId as SessionId, areaId, claim })
    } catch {
      setAvailable(false)
      return
    }
    void lease.ready.then(reference => {
      if (!live) return
      renderer = createWorkbenchNativeAreaSlotRenderer(ctx, sessionId, {}, {
        sessionReference: reference,
        areaOccurrence: occurrence,
        scopeKey: `${areaId}:${nativeInstanceId}:${entryKey}`,
      })
      setAvailable(renderer.hasEntry('sidebar.right.pane.tab', entryKey))
      setNative(renderer)
    }).catch(() => {
      if (live) setAvailable(false)
    })
    return () => {
      live = false
      renderer?.dispose()
      setNative(undefined)
      lease.release()
    }
  }, [areaId, claim, ctx, entryKey, occurrence, nativeInstanceId, registrationRevision, resourceReady, sessionId])
  useEffect(() => {
    if (!resourceReady || available !== true || kind !== 'terminal' || nativeContentId === undefined) return
    const releaseClose = registerWorkbenchNativeClose(nativeInstanceId, closeNativeTerminal)
    if (sessionId === undefined) return releaseClose
    const releaseRetention = retainWorkbenchTerminalTab(ctx, {
      instanceId: nativeInstanceId,
      tabId: workbenchTerminalControllerTabId(nativeInstanceId, nativeContentId),
      sessionId,
      contentId: nativeContentId,
    })
    return () => {
      releaseRetention()
      releaseClose()
    }
  }, [available, closeNativeTerminal, ctx, kind, nativeContentId, nativeInstanceId, resourceReady, sessionId])
  useEffect(() => {
    if (!resourceReady || available !== true || native === undefined || occurrence === undefined) return
    return registerWorkbenchNativeTabTitle(nativeInstanceId, () => native.render('sidebar.right.pane.tab.title', {}, {
      entryKey,
      hookContext: occurrence,
      fallback: null,
    }))
  }, [available, entryKey, native, occurrence, nativeInstanceId, resourceReady])
  // The occurrence is intentionally not aborted when this editor body unmounts:
  // switching Workbench tabs is a view change, not a tab close.  Its signal is
  // disposed by closeWorkbenchNative when the layout record is actually gone.
  useEffect(() => () => previewOccurrence?.dispose(), [previewOccurrence])
  useEffect(() => () => closePreview(), [closePreview])

  if (sessionId === undefined || areaId === undefined || claim === undefined) {
    return <section data-workbench-official-area-state="missing-session" style={{ padding: 20 }}>
      <strong>此内页需要来源对话</strong>
      <p>请选择此内页的来源对话。</p>
    </section>
  }
  if (!resourceReady) return <section data-workbench-native-resource-state="waiting" style={{ display: 'flex', minWidth: 0, minHeight: 0, height: '100%', flexDirection: 'column' }}>{fallback}</section>
  if (available === false) return <section
    data-workbench-native-path="fallback"
    data-workbench-native-fallback={kind}
    style={{ display: 'flex', minWidth: 0, minHeight: 0, height: '100%', flexDirection: 'column' }}
  >{fallback}</section>
  if (native === undefined || occurrence === undefined) {
    return <section data-workbench-official-area-state="native-loading" style={{ display: 'flex', flex: 1, minHeight: 0, height: '100%' }}><WorkbenchPageLoading label={title} /></section>
  }
  return <section data-workbench-native-area={kind} data-workbench-native-entry={entryKey} style={{ display: 'flex', minWidth: 0, minHeight: 0, height: '100%', flexDirection: 'column' }}>
    <div style={{ display: 'flex', minWidth: 0, minHeight: 0, flex: 1, flexDirection: 'column' }}>
      {native.render('sidebar.right.pane.tab', {}, { entryKey, hookContext: occurrence, fallback })}
    </div>
    {preview !== undefined && previewOccurrence !== undefined ? <div data-workbench-native-resource-preview style={{ display: 'flex', minWidth: 0, minHeight: 0, flex: 1, flexDirection: 'column', borderTop: '.5px solid var(--dsw-alias-border-l3, color-mix(in srgb, currentColor 16%, transparent))' }}>
      {native.render('sidebar.right.pane.tab', {}, {
        entryKey: preview.entryKey,
        hookContext: previewOccurrence,
        fallback: <p role="status" style={{ margin: 0, padding: 12 }}>DSH 没有可用的资源预览。</p>,
      })}
    </div> : null}
    {children}
  </section>
}
