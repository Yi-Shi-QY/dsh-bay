import { createElement, useEffect, useSyncExternalStore, type ComponentType, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react'
import { originalWorkbenchAutomaticEntry } from './native-automatic-isolation.tsx'
import { createNativeComposerOwnership } from './native-composer-ownership.ts'
import type { Context } from '@deepseek-ai/cordis'
import type { SessionReference } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SidebarRightTabInfo } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { fileAddressFor } from '@deepseek-ai/dsh-util-workspace-path'
import { isWorkbenchNativeTabClosing } from './native-tab-occurrence.ts'
import {
  workbenchBrowserAddressFor, workbenchChangesReviewAddress, workbenchResourceMatchesSession,
  type WorkbenchResourceRouteResult, type WorkbenchResourceSourceV1,
} from './workbench-resource-opener.ts'
import { bindSnapshotSelector } from '../foundation/renderer/bind.ts'
import { createSlotRenderer, renderFactoryRoot } from '../foundation/renderer/scoped-slots.tsx'
import { SlotAssemblyError } from '../foundation/renderer/errors.ts'
import { isDeferredOfficialMoreRegistration } from './workbench-more-policy.ts'
import { getWorkbenchClientSessions } from './session-service.ts'
import type {
  HocRenderOpts, RenderOpts, SlotRendererHost, SlotScope, SlotSpec, StandardSourceBinding, StoredEntry, StoredFactory, StoreInstanceLike,
} from '@deepseek-ai/dsh-client-ui-slots'

interface AgentPresetOption {
  readonly id: string
  readonly name?: string
  readonly description?: string
}

interface AgentPresetSeatState {
  readonly options: readonly AgentPresetOption[]
  readonly current: string
  readonly error: string | null
  readonly busy: boolean
  readonly introduce: boolean
}

interface AgentPresetRemote {
  list(): Promise<{
    readonly ok: true
    readonly value: { readonly presets: readonly (AgentPresetOption & { readonly isDefault: boolean; readonly broken?: string })[] }
  } | { readonly ok: false; readonly error: { readonly message: string; readonly details?: unknown } }>
  select(sessionId: string, id: string): Promise<{
    readonly ok: true
    readonly value: string
  } | { readonly ok: false; readonly error: { readonly message: string; readonly details?: unknown } }>
}

function createLocalAgentPresetSeat(initialPreset?: string) {
  let snapshot: AgentPresetSeatState = {
    options: [], current: initialPreset ?? '', error: null, busy: false, introduce: false,
  }
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    update(mutator: (draft: { -readonly [K in keyof AgentPresetSeatState]: AgentPresetSeatState[K] }) => void) {
      const next = { ...snapshot }
      mutator(next)
      snapshot = next
      for (const listener of [...listeners]) listener()
    },
  }
}

function remoteError(result: { readonly error: { readonly message: string; readonly details?: unknown } }): string {
  const details = result.error.details
  if (details !== null && typeof details === 'object' && 'reason' in details && typeof details.reason === 'string') {
    return details.reason
  }
  return result.error.message
}

const renderer = createSlotRenderer()
const keyOf = (key: string) => key as keyof import('@deepseek-ai/dsh-client-ui-slots').SlotMap & string
const source = <T,>(value: T) => ({ getSnapshot: () => value, subscribe: () => () => {} })

/**
 * DSH sidebar stores are declared with `scope: 'session'`.  A Workbench
 * renderer is created per Area tab, so keeping the instance in the renderer
 * itself accidentally turns a Session store into an Area store.  Keep the
 * native instance cache at the same identity axis as DSH and only reference
 * count it from Area renderers.
 *
 * This cache deliberately does not clear persisted data on release.  DSH's
 * native tab actions own removal of a tab's persisted record; unmounting an
 * Area is only a view lifecycle event and must not erase sibling tabs or a
 * later restore.
 */
type NativeStoreHandle = { create(scopeKey?: string): StoreInstanceLike & { clearPersisted?: () => void } }
interface SharedNativeStoreRecord {
  readonly instance: StoreInstanceLike & { clearPersisted?: () => void }
  refs: number
}
const sharedNativeStores = new WeakMap<object, Map<string | undefined, SharedNativeStoreRecord>>()

function retainNativeStore(handle: NativeStoreHandle, sessionId: string | undefined): {
  readonly instance: SharedNativeStoreRecord['instance']
  readonly release: () => void
} {
  let records = sharedNativeStores.get(handle)
  if (records === undefined) {
    records = new Map()
    sharedNativeStores.set(handle, records)
  }
  let record = records.get(sessionId)
  if (record === undefined) {
    record = { instance: sessionId === undefined ? handle.create() : handle.create(sessionId), refs: 0 }
    records.set(sessionId, record)
  }
  record.refs += 1
  let released = false
  return {
    instance: record.instance,
    release: () => {
      if (released) return
      released = true
      const current = records?.get(sessionId)
      if (current === undefined || current !== record) return
      current.refs -= 1
      if (current.refs <= 0) records?.delete(sessionId)
    },
  }
}

/**
 * Render one DSH native slot inside a Workbench Area.
 *
 * This deliberately exposes only the public leaf slot path used by the native
 * document preview. It cannot render shell/sidebar/conversation owners and it
 * supplies the Area's Session identity as the scope binding.
 */
export function createWorkbenchNativeAreaSlotRenderer(
  ctx: Context,
  sessionId: string | undefined,
  standard: Record<string, unknown>,
  options: {
    onSelectWorkspace?: (workspaceId: string) => void | Promise<void>
    onSelectAgentPreset?: (presetId: string) => void | Promise<void>
    /** Route the native Tool/Inspect action to the owning Workbench Area. */
    onInspectCall?: (callId: string) => void
    readInspectCallId?: () => string | undefined
    /** Route DSH conversation resources into this Area instead of the official Sidebar. */
    onOpenResource?: (address: string, options?: Record<string, unknown>, source?: WorkbenchResourceSourceV1) => WorkbenchResourceRouteResult | boolean | void
    /** Route DSH Markdown HTTP(S) links into the same Area resource path. */
    sessionReference?: SessionReference
    /**
     * The Workbench-owned tab occurrence.  Native Terminal uses the official
     * body but its upstream inject face historically looked up the occurrence
     * through DSH's global Sidebar tab domain.  Supplying this seam lets the
     * adapter provide the same model for an Area-local occurrence without
     * registering that occurrence in the official Sidebar.
     */
    areaOccurrence?: { readonly read: () => SidebarRightTabInfo }
    /**
     * Runtime-local store namespace for an unbound Area occurrence.  A Start
     * editor has no Session id yet, so using `undefined` as the namespace
     * would make every Start occurrence look like the same DSH store.  Core
     * supplies the Area + editor instance identity here; it is never sent to
     * DSH or persisted as a Session identity.
     */
    scopeKey?: string
  } = {},
) {
  const sessions = getWorkbenchClientSessions(ctx)
  let live = true
  const adapted = new Map<StoredEntry, StoredEntry>()
  const adaptedAreaEntries = new Map<StoredEntry, StoredEntry>()
  const composerOwnership = createNativeComposerOwnership()
  const adaptedAgentPresetEntries = new Map<StoredEntry, StoredEntry>()
  // `isLive` is the renderer's authorization check for nested renderSlot
  // calls. Entries adapted through special Browser/Terminal/Agent seams do
  // not necessarily live in `adapted`, so track every entry actually handed
  // to an Outlet explicitly.
  const authorizedEntries = new WeakSet<StoredEntry>()
  const entryScopes = new WeakMap<StoredEntry, SlotScope>()
  const denied = new Set<StoredEntry>()
  const stores = new Map<StoredEntry, Map<string | undefined, {
    readonly instance: StoreInstanceLike & { clearPersisted?: () => void }
    readonly release: () => void
  }>>()
  /**
   * DSH Factory stores have a second identity axis that ordinary slot stores
   * do not have: one exclusive handle per mounted Factory occurrence.  The
   * previous adapter returned `undefined` here, which let native bodies mount
   * without their store/action contract and made the whole sidebar appear
   * blank or inert.  Keep the same occurrence and scope axes as ui-renderer.
   */
  type FactoryRecord = {
    readonly handle: NativeStoreHandle & { readonly spec?: { readonly persist?: unknown } }
    readonly instances: Map<string, StoreInstanceLike & { clearPersisted?: () => void }>
    retainers: number
  }
  const factoryRecords = new WeakMap<StoredFactory, WeakMap<object, FactoryRecord>>()
  const factorySharedRecords = new Map<StoredFactory, Map<string, {
    readonly instance: StoreInstanceLike & { clearPersisted?: () => void }
    readonly release: () => void
  }>>()
  const roots = new Map<string, SlotRendererHost>()
  const factoryCopies = new Map<StoredFactory, StoredFactory>()
  const factoryOrigins = new Map<StoredFactory, StoredFactory>()

  const routeResource = (
    address: string,
    placement?: Record<string, unknown>,
    sourceSessionId?: string,
  ): WorkbenchResourceRouteResult => {
    if (!live) return 'rejected'
    if (options.onOpenResource === undefined) return 'native-fallback'
    const child = sourceSessionId === undefined
      ? undefined
      : (sessions as unknown as {
          subagentAddress?: (sessionId: string) => { readonly parentSessionId?: string } | undefined
        }).subagentAddress?.(sourceSessionId)
    const source: WorkbenchResourceSourceV1 | undefined = sourceSessionId === undefined
      ? undefined
      : { sessionId: sourceSessionId, ...(child?.parentSessionId === undefined ? {} : { parentSessionId: child.parentSessionId }) }
    const result = options.onOpenResource(address, placement, source)
    if (result === 'native-fallback') return result
    if (result === 'rejected' || result === false) return 'rejected'
    // Legacy Area callbacks return void after accepting a resource.
    return 'handled'
  }
  const resourceHooks = new WeakMap<object, ReturnType<typeof bindSnapshotSelector<unknown>>>()
  const useResource = (address: string) => {
    const resource = ctx.resources.source(address)
    let hook = resourceHooks.get(resource)
    if (hook === undefined) {
      hook = bindSnapshotSelector(resource)
      resourceHooks.set(resource, hook)
    }
    return hook(value => value)
  }
  const areaStandard = { ...standard, useResource }
  const rendererHost = (ctx.slots as unknown as { _host?: SlotRendererHost })._host
  const inheritedRoot = rendererHost?.root.getSnapshot()
  if (sessionId !== options.sessionReference?.sessionId) throw new Error('workbench-area-reference-mismatch')
  const inheritedSessionScope = rendererHost?.scope('session')
  // Host-less fixtures and early renderer boot can lack DSH's inherited
  // session scope. Preserve the exact Area Session identity in that fallback
  // so strict native session slots (notably conversation.header) still bind
  // to the owning Session instead of failing with an unbound scope.
  const fallbackSource = source<StandardSourceBinding>({ key: sessionId, hooks: {}, keyedHooks: {}, props: {} })
  /**
   * Project any DSH Session reference through the Area's local standard kit.
   *
   * Most native sidebar bodies stay on the Workbench Area's parent Session.
   * Subagent Chat is the important exception: its native body retains a child
   * Session and renders `conversation.content` below a nested `SessionProvider`.
   * The old adapter ignored the provider argument and always returned the parent
   * binding, which made the child Conversation read the wrong Session. Keep the
   * source selection delegated to DSH, then add the Area-local context/actions
   * at the projection boundary for every reference.
   */
  type ProjectedBindingSource = {
    readonly subscribe: (listener: () => void) => () => void
    readonly getSnapshot: () => StandardSourceBinding & { ctx: Context }
  }
  const projectedBindings = new WeakMap<object, ProjectedBindingSource>()
  const projectedBinding = (reference: SessionReference | undefined): ProjectedBindingSource => {
    const sourceForReference = inheritedSessionScope?.bindingSource(reference) ?? fallbackSource
    if (reference !== undefined) {
      const cached = projectedBindings.get(reference as object)
      if (cached !== undefined) return cached
    }
    let previous: StandardSourceBinding | undefined
    let projectedValue: StandardSourceBinding & { ctx: Context }
    const projected: ProjectedBindingSource = {
      subscribe: (listener: () => void) => sourceForReference.subscribe(listener),
      getSnapshot: () => {
        const value = sourceForReference.getSnapshot()
        if (value !== previous) {
          previous = value
          const sessionContext = (value as StandardSourceBinding & { readonly ctx?: Context }).ctx ?? ctx
          projectedValue = { ...value, ctx: sessionContext, props: { ...areaStandard, ...value.props } }
        }
        return projectedValue
      },
    }
    if (reference !== undefined) projectedBindings.set(reference as object, projected)
    return projected
  }
  const binding = projectedBinding(options.sessionReference)
  const scope = {
    current: binding,
    bindingSource: (reference?: SessionReference) => reference === undefined || reference === options.sessionReference
      ? scope.current
      : projectedBinding(reference),
    renderArea: (_binding: unknown, props: { children: ReactNode; empty?: () => ReactNode }) => live ? props.children : props.empty?.() ?? null,
  }
  const forbidden = new Set(['root', 'main', 'main.conversation', 'layout.frame', 'sidebar', 'rightbar.session', 'conversation', 'details', 'shell.overlay'])

  /**
   * DSH's official entry-customization plugin registers its More menu
   * under three ordinary action Slots.  Workbench intentionally projects
   * only Area-local native content, so that one registration must be hidden
   * at this boundary while every other action remains available.  Match both
   * fields because the public slot runtime uses `id` and older adapters use
   * the normalized `key` field.
   */
  const copy = (entry: StoredEntry): StoredEntry => {
    let value = adapted.get(entry)
    if (value === undefined) {
      value = { ...entry }
      adapted.set(entry, value)
    }
    return value
  }
  // A native header toggle shares the rightbar owner's store. Creating that
  // store adopts it globally, even when the toggle itself is visually hidden.
  const ownsNativeSidebar = (entry: StoredEntry): boolean => entry.store !== undefined
    && ctx.slots.entriesOfSlot('rightbar.session').some(owner => owner.store === entry.store)
  const entries = (slot: string, winners: boolean): readonly StoredEntry[] => {
    if (!live || forbidden.has(slot)) return []
    const values = winners ? ctx.slots.entriesOfSlot(keyOf(slot)) : ctx.slots.entries(keyOf(slot))
    const projected = values
      .filter(entry => !ownsNativeSidebar(entry) && !isDeferredOfficialMoreRegistration(slot, entry.options))
      .map(entry => slot === 'conversation.hero.agentPreset'
        ? adaptAgentPresetEntry(entry)
        : adaptAreaEntry(entry, slot))
      .filter(entry => !denied.has(entry))
    for (const entry of projected) {
      authorizedEntries.add(entry)
      const spec = ctx.slots.spec(keyOf(slot))
      if (spec !== undefined) entryScopes.set(entry, spec.scope)
    }
    return projected
  }
  const clearStores = () => {
    for (const byScope of stores.values()) {
      for (const store of byScope.values()) store.release()
    }
    stores.clear()
    for (const byScope of factorySharedRecords.values()) {
      for (const retained of byScope.values()) retained.release()
    }
    factorySharedRecords.clear()
    // WeakMap entries are released with this renderer and do not contain
    // persisted data; DSH owns persistence cleanup through its tab actions.
  }

  function factoryScopeKey(definition: StoredFactory, scopeBinding: StandardSourceBinding | undefined): string {
    if (definition.scope === 'root') return 'root'
    const key = scopeBinding?.key
    if (key === undefined) {
      throw new SlotAssemblyError(`${definition.scope} factory store resolution requires a session id`)
    }
    return key
  }

  function factoryStoreOf(
    definition: StoredFactory,
    scopeBinding: StandardSourceBinding | undefined,
    occurrence: object,
  ): StoreInstanceLike | undefined {
    const origin = factoryOrigins.get(definition) ?? definition
    const declaration = origin.store
    if (declaration === undefined) return undefined
    const scopeKey = factoryScopeKey(origin, scopeBinding)

    // A shared handle follows the ordinary (definition x scope) axis.  The
    // release is kept until renderer disposal, just like DSH's registry.
    if (typeof declaration !== 'function') {
      let byScope = factorySharedRecords.get(origin)
      if (byScope === undefined) {
        byScope = new Map()
        factorySharedRecords.set(origin, byScope)
      }
      const existing = byScope.get(scopeKey)
      if (existing !== undefined) return existing.instance
      const retained = scopeKey === 'root'
        ? { instance: declaration.create(), release: () => {} }
        : retainNativeStore(declaration, scopeKey)
      byScope.set(scopeKey, retained)
      return retained.instance
    }

    let byOccurrence = factoryRecords.get(origin)
    if (byOccurrence === undefined) {
      byOccurrence = new WeakMap()
      factoryRecords.set(origin, byOccurrence)
    }
    let record = byOccurrence.get(occurrence)
    if (record === undefined) {
      const handle = declaration() as NativeStoreHandle & { readonly spec?: { readonly persist?: unknown } }
      if (handle.spec?.persist !== undefined) {
        throw new SlotAssemblyError(`exclusive store for factory "${origin.name}" cannot declare persistence`)
      }
      record = { handle, instances: new Map(), retainers: 0 }
      byOccurrence.set(occurrence, record)
    }
    const existing = record.instances.get(scopeKey)
    if (existing !== undefined) return existing
    const instance = scopeKey === 'root' ? record.handle.create() : record.handle.create(scopeKey)
    record.instances.set(scopeKey, instance)
    return instance
  }

  function retainFactoryOccurrence(definition: StoredFactory, occurrence: object): () => void {
    const origin = factoryOrigins.get(definition) ?? definition
    if (typeof origin.store !== 'function') return () => {}
    const record = factoryRecords.get(origin)?.get(occurrence)
    if (record === undefined) return () => {}
    record.retainers += 1
    let released = false
    return () => {
      if (released) return
      released = true
      record.retainers = Math.max(0, record.retainers - 1)
    }
  }

  // SlotRegistry deliberately keeps Factory lookup on the installed renderer
  // host rather than its public registration face. Core only reads that host;
  // registration and lifecycle remain owned by DSH's renderer service.
  const slotService = ctx.slots as unknown as {
    _host?: SlotRendererHost
    factory?: (name: string) => StoredFactory | undefined
    factoryVersion?: (name: string) => number
    subscribeFactory?: (name: string, listener: () => void) => () => void
    isFactoryLive?: (definition: StoredFactory) => boolean
  }
  const installedRendererHost = slotService._host
  const slotApi = {
    factory: installedRendererHost?.factoryOf ?? slotService.factory,
    factoryVersion: installedRendererHost?.getFactoryVersion ?? slotService.factoryVersion,
    subscribeFactory: installedRendererHost?.subscribeFactory ?? slotService.subscribeFactory,
    isFactoryLive: installedRendererHost?.isFactoryLive ?? slotService.isFactoryLive,
  }

  function adaptAgentPresetEntry(entry: StoredEntry): StoredEntry {
    let value = adaptedAgentPresetEntries.get(entry)
    if (value !== undefined) return value
    const Component = entry.component as ComponentType<Record<string, unknown>>
    const seat = createLocalAgentPresetSeat(sessionId === undefined
      ? undefined
      : (() => {
          const preset = (sessions.list.getSnapshot().byId[sessionId as import('@deepseek-ai/dsh-session/types').SessionId]
            ?.projectionValues as { readonly agentPreset?: unknown } | undefined)?.agentPreset
          return typeof preset === 'string' ? preset : undefined
        })())
    const remote = (ctx as unknown as { remote: { agentPresets: AgentPresetRemote } }).remote.agentPresets
    const developerTools = (ctx as unknown as {
      configForms: { developerTools: { enabled: { getSnapshot(): boolean; subscribe(listener: () => void): () => void } } }
    }).configForms.developerTools.enabled

    const load = async () => {
      try {
        const result = await remote.list()
        if (!result.ok) {
          seat.update(state => { state.options = []; state.current = ''; state.error = remoteError(result) })
          return
        }
        const options = result.value.presets.filter(preset => preset.broken === undefined)
        const defaultPreset = options.find(preset => result.value.presets.find(row => row.id === preset.id)?.isDefault)?.id
          ?? options[0]?.id
          ?? ''
        seat.update(state => {
          state.options = options.map(({ id, name, description }) => ({
            id,
            ...(name === undefined ? {} : { name }),
            ...(description === undefined ? {} : { description }),
          }))
          state.current = state.current || defaultPreset
          state.error = null
        })
      } catch (error) {
        seat.update(state => {
          state.options = []
          state.current = ''
          state.error = error instanceof Error ? error.message : '无法读取 Agent 模式列表'
        })
      }
    }

    const select = async (presetId: string): Promise<string | undefined> => {
      seat.update(state => { state.busy = true; state.error = null })
      try {
        if (sessionId === undefined) {
          await options.onSelectAgentPreset?.(presetId)
          seat.update(state => { state.current = presetId })
          return undefined
        }
        const result = await remote.select(sessionId, presetId)
        if (!result.ok) {
          const refusal = remoteError(result)
          seat.update(state => { state.error = refusal })
          return refusal
        }
        seat.update(state => { state.current = result.value; state.error = null })
        return undefined
      } catch (error) {
        const refusal = error instanceof Error ? error.message : '无法应用此 Agent 模式'
        seat.update(state => { state.error = refusal })
        return refusal
      } finally {
        seat.update(state => { state.busy = false })
      }
    }

    const wrappedComponent: ComponentType<Record<string, unknown>> = props => createElement(Component, {
      ...props,
      // DSH's native seat intentionally shows only for its own mainView. This
      // projection exists only in this Area renderer so the native control can
      // appear without changing DSH's real retain graph or current Session.
      useSessionRetainInfo: <Selected,>(selector: (info: { referenceCount: number; retainedBy: { mainView: number } }) => Selected) =>
        selector({ referenceCount: 1, retainedBy: { mainView: 1 } }),
    })
    const originalInject = entry.inject
    value = {
      ...copy(entry),
      component: wrappedComponent,
      inject: ((...args: never[]) => {
        const original = originalInject?.(...args) ?? {}
        return {
          ...original,
          hooks: {
            ...((original.hooks as Record<string, unknown> | undefined) ?? {}),
            developerTools,
            agentPresetSeat: seat,
          },
          load,
          select,
          introduced: () => seat.update(state => { state.introduce = false }),
        }
      }) as StoredEntry['inject'],
    }
    adaptedAgentPresetEntries.set(entry, value)
    return value
  }

  /**
   * Bridge DSH Terminal's old Sidebar lookup to the Workbench occurrence.
   *
   * The upstream TerminalBody, model and xterm renderer remain unchanged. The
   * only replacement is its injected `view`/`keyedHooks` face: the official
   * package previously resolved `tabDomain.occurrence(sessionId, key)`, which
   * cannot see an Area-local tab by design. Files and Browser keep their own
   * native inject faces and therefore do not enter this path.
   */
  function adaptAreaEntry(entry: StoredEntry, slot: string): StoredEntry {
    entry = originalWorkbenchAutomaticEntry(entry)
    if (slot === 'conversation.composer.bar' && entry.inject) {
      const cached = adaptedAreaEntries.get(entry)
      if (cached) return cached
      const inject = entry.inject
      const value: StoredEntry = { ...copy(entry), inject: ((...args: never[]) => {
        const original = inject(...args)
        return { ...original, keyboard: composerOwnership.keyboard(original.keyboard) }
      }) as StoredEntry['inject'] }
      adaptedAreaEntries.set(entry, value)
      return value
    }
    const isTerminal = entry.options.key === '@deepseek-ai/dsh-client-ui-sidebar-terminal'
    const isBrowser = entry.options.key === '@deepseek-ai/dsh-client-ui-sidebar-browser'
    // DSH 0.2 registers session-scoped conversation entries with `id`, while
    // older hosts and native Sidebar entries use `key`. Keep this seam local
    // to the adapter so an upstream registration-shape change cannot bypass
    // Workbench's Area-local resource routing.
    const conversationIdentity = entry.options.key ?? entry.options.id
    const isChat = slot === 'conversation.view' && (
      conversationIdentity === '@deepseek-ai/dsh-client-ui-chat' || conversationIdentity === 'chat'
    )
    if (slot === 'conversation.view' && conversationIdentity === 'trajectory' && options.readInspectCallId) {
      const existing = adaptedAreaEntries.get(entry)
      if (existing) return existing
      const Component = entry.component as ComponentType<Record<string, unknown>>
      const value = { ...copy(entry), component: (props: Record<string, unknown>) => {
        const callId = options.readInspectCallId?.()
        return createElement(Component, { ...props, ...(callId ? { viewRequest: { view: 'trajectory', focus: callId }, completeViewRequest: () => {} } : {}) })
      } }
      adaptedAreaEntries.set(entry, value); return value
    }
    const isDeliverables = slot === 'conversation.chat.turnTail' && conversationIdentity === '@deepseek-ai/dsh-client-ui-deliverables'
    const isPlan = slot === 'conversation.chat.turnTail' && conversationIdentity === '@deepseek-ai/dsh-client-ui-plan'
    const isPlanReview = slot === 'conversation.plan-review.actions' && conversationIdentity === '@deepseek-ai/dsh-client-ui-plan'
    const isScheduleTurn = slot === 'conversation.chat.turnTail' && conversationIdentity === 'schedule-created'
    const isScheduleCatalog = slot === 'conversation.session.header.utilities' && conversationIdentity === 'schedule-catalog'
    const isSubagent = slot === 'conversation.session.header.lineage'
      || (slot === 'conversation.session.header.actions' && (
        conversationIdentity === '@deepseek-ai/dsh-client-ui-subagent'
        || conversationIdentity === 'subagent-catalog'
      ))
    // The Area occurrence bridge is only for the native body and title. Guide
    // entries have their own upstream inject contracts (for example the
    // Terminal guide's useShortcuts/loadShells/selectShell face) and must keep
    // those contracts untouched.
    if (isChat || isDeliverables || isPlan || isPlanReview || isScheduleTurn || isScheduleCatalog || isSubagent) {
      const existing = adaptedAreaEntries.get(entry)
      if (existing !== undefined) return existing
      const originalInject = entry.inject
      if (originalInject === undefined) return copy(entry)
      const Component = entry.component as ComponentType<Record<string, unknown>>
      const value: StoredEntry = {
        ...copy(entry),
        ...(isPlanReview ? { component: (props: Record<string, unknown>) => {
          const review = props.review as { callId?: string; plan?: string }, requestKey = String(props.requestKey)
          const identity = review.callId === undefined ? 'review:' + requestKey : 'call:' + review.callId
          const open = props.openReview as (review: unknown, key: string, automatic?: boolean) => boolean
          const useStore = props.useStore as ((selector: (state: { opened: Record<string, boolean> }) => boolean) => boolean) | undefined
          const opened = useStore?.(state => state.opened[identity] === true) ?? false
          useEffect(() => {
            if (!opened && open(review, requestKey, true)) (props.actions as { markOpened?: (key: string) => void })?.markOpened?.(identity)
          }, [identity, open, opened])
          const useUnmounted = (selector: (value: unknown) => unknown) => selector(undefined)
          return createElement(Component, { ...props, useSidebarMounted: useUnmounted })
        } } : {}),
        ...(isChat ? {
          component: (props: Record<string, unknown>) => {
            const onClickCapture = (event: ReactMouseEvent<HTMLDivElement>) => {
              if (!(event.target instanceof Element)) return
              const anchor = event.target.closest('a[href]')
              if (!(anchor instanceof HTMLAnchorElement) || typeof props.openExternalLink !== 'function') return
              if (anchor.protocol !== 'http:' && anchor.protocol !== 'https:') return
              event.preventDefault()
              event.stopPropagation()
              ;(props.openExternalLink as (url: string) => void)(anchor.href)
            }
            return createElement('div', { onClickCapture, style: { display: 'contents' } }, createElement(Component, props))
          },
        } : {}),
        inject: ((upstreamSessionId: string, ...args: never[]) => {
          const original = (originalInject as unknown as (...values: unknown[]) => Record<string, unknown>)(upstreamSessionId, ...args)
          if (isChat) {
            const originalOpenFile = original.openFile
            const openFile = typeof originalOpenFile === 'function'
              ? async (path: string, fileOptions?: { readonly line?: number }) => {
                const cwd = (sessions as unknown as { list?: { getSnapshot(): { byId?: Record<string, { cwd?: string }> } } }).list?.getSnapshot().byId?.[upstreamSessionId]?.cwd
                const address = fileAddressFor(upstreamSessionId as SessionId, cwd, path)
                const placement = fileOptions?.line === undefined ? undefined : { params: { line: fileOptions.line } }
                const routed = routeResource(address, placement, upstreamSessionId)
                if (routed === 'handled' || routed === 'rejected') return
                // Keep the native fallback bound to the Session that emitted
                // the click. The Area owner separately decides whether this
                // fallback is allowed by the user's routing policy.
                if (!workbenchResourceMatchesSession(address, upstreamSessionId)) return
                await originalOpenFile(path, fileOptions)
              }
              : originalOpenFile
            const originalOpenExternalLink = original.openExternalLink
            const openExternalLink = typeof originalOpenExternalLink === 'function'
              ? (url: string) => {
                const address = workbenchBrowserAddressFor(upstreamSessionId, url)
                if (address === undefined) return originalOpenExternalLink(url)
                const routed = routeResource(address, { params: { url } }, upstreamSessionId)
                if (routed === 'handled' || routed === 'rejected') return
                if (!workbenchResourceMatchesSession(address, upstreamSessionId)) return
                return originalOpenExternalLink(url)
              }
              : originalOpenExternalLink
            const originalInspectCall = original.inspectCall
            const inspectCall = typeof originalInspectCall === 'function'
              ? (callId: unknown) => {
                const address = `dsh-resource://trajectory-inspect/session/${encodeURIComponent(upstreamSessionId)}/${encodeURIComponent(String(callId))}`
                const routed = routeResource(address, undefined, upstreamSessionId)
                if (routed === 'handled' || routed === 'rejected') return
                if (!workbenchResourceMatchesSession(address, upstreamSessionId)) return
                return originalInspectCall(callId)
              }
              : originalInspectCall
            return { ...original, openFile, openExternalLink, inspectCall }
          }
          if (isPlan) {
            const originalOpenPlan = original.openPlan
            const openPlan = typeof originalOpenPlan === 'function'
              ? (callId: unknown) => {
                const child = (sessions as unknown as { subagentAddress?: (sessionId: string) => { kind?: string; parentSessionId?: string; childSessionId?: string; mode?: string } | undefined }).subagentAddress?.(upstreamSessionId)
                const address = child?.childSessionId === undefined
                  ? `dsh-resource://plan/${encodeURIComponent(upstreamSessionId)}/${encodeURIComponent(String(callId))}`
                  : `dsh-resource://plan/subagent/${encodeURIComponent(child.parentSessionId ?? upstreamSessionId)}/${encodeURIComponent(child.childSessionId)}/${encodeURIComponent(child.mode ?? 'unknown')}/${encodeURIComponent(String(callId))}`
                const routed = routeResource(address, undefined, upstreamSessionId)
                if (routed === 'handled' || routed === 'rejected') return
                if (!workbenchResourceMatchesSession(address, upstreamSessionId)) return
                return originalOpenPlan(callId)
              }
              : originalOpenPlan
            return { ...original, openPlan }
          }
          if (isPlanReview) {
            const originalOpenReview = original.openReview
            const openReview = typeof originalOpenReview === 'function'
              ? (review: { readonly callId?: unknown; readonly plan?: string }, requestKey: string, automatic = false) => {
                const address = review.callId === undefined
                  ? `dsh-resource://plan-review/${encodeURIComponent(upstreamSessionId)}/${encodeURIComponent(requestKey)}`
                  : `dsh-resource://plan/${encodeURIComponent(upstreamSessionId)}/${encodeURIComponent(String(review.callId))}`
                const routed = routeResource(address, { trigger: automatic ? 'automatic' : 'active', eventId: requestKey,
                  ...(review.callId === undefined ? { params: { planReview: { markdown: review.plan ?? '', title: (review.plan ?? '').split('\n').find(line => line.trim())?.replace(/^#+\s*/u, '') ?? '计划审阅' } } } : {}) }, upstreamSessionId)
                if (routed === 'handled' || routed === 'rejected') return routed === 'handled'
                if (!workbenchResourceMatchesSession(address, upstreamSessionId)) return
                return originalOpenReview(review, requestKey)
              }
              : originalOpenReview
            return { ...original, openReview }
          }
          if (isSubagent) {
            const originalOpenChild = original.openChild
            const originalOpenChildAside = original.openChildAside
            const openChild = typeof originalOpenChild === 'function'
              ? (address: { readonly parentSessionId: string; readonly childSessionId: string; readonly mode: string }) => {
                const resource = `dsh-resource://subagentchat/session/${encodeURIComponent(address.childSessionId)}?parent=${encodeURIComponent(address.parentSessionId)}&mode=${encodeURIComponent(address.mode)}`
                const routed = routeResource(resource, undefined, upstreamSessionId)
                if (routed === 'handled' || routed === 'rejected') return
                if (!workbenchResourceMatchesSession(resource, upstreamSessionId)) return
                // DSH's primary action switches the global main Conversation.
                // In Workbench mode, an explicit native fallback still opens
                // the official Sidebar without changing that main Session.
                return typeof originalOpenChildAside === 'function' ? originalOpenChildAside(address) : undefined
              }
              : originalOpenChild
            const openChildAside = typeof originalOpenChildAside === 'function'
              ? (address: { readonly parentSessionId: string; readonly childSessionId: string; readonly mode: string }) => {
                const resource = `dsh-resource://subagentchat/session/${encodeURIComponent(address.childSessionId)}?parent=${encodeURIComponent(address.parentSessionId)}&mode=${encodeURIComponent(address.mode)}`
                const routed = routeResource(resource, undefined, upstreamSessionId)
                if (routed === 'handled' || routed === 'rejected') return
                if (!workbenchResourceMatchesSession(resource, upstreamSessionId)) return
                return originalOpenChildAside(address)
              }
              : originalOpenChildAside
            return { ...original, openChild, openChildAside }
          }
          if (isScheduleTurn || isScheduleCatalog) {
            const originalOpenTaskDetail = original.openTaskDetail
            const openTaskDetail = typeof originalOpenTaskDetail === 'function'
              ? (taskId: unknown) => {
                const address = `dsh-resource://schedule-task/session/${encodeURIComponent(upstreamSessionId)}/${encodeURIComponent(String(taskId))}`
                const routed = routeResource(address, {
                  params: { sessionId: upstreamSessionId, id: String(taskId) },
                }, upstreamSessionId)
                if (routed === 'handled' || routed === 'rejected') return
                if (!workbenchResourceMatchesSession(address, upstreamSessionId)) return
                return originalOpenTaskDetail(taskId)
              }
              : originalOpenTaskDetail
            return { ...original, openTaskDetail }
          }
          const originalOpenReview = original.openChangesReview
          const openChangesReview = typeof originalOpenReview === 'function'
            ? (coordinates: { readonly sessionId: string; readonly seq: number; readonly turn: number }, index: number) => {
                // Deliverables are injected for one exact Session. A mismatched
                // coordinate is stale or malformed; never let it escape into
                // DSH's global Sidebar as if it were a valid native action.
                if (coordinates.sessionId !== upstreamSessionId) return
                const address = workbenchChangesReviewAddress(coordinates)
                const routed = routeResource(address, { params: { index } }, upstreamSessionId)
                if (routed === 'handled' || routed === 'rejected') return
                if (!workbenchResourceMatchesSession(address, upstreamSessionId)) return
                return originalOpenReview(coordinates, index)
              }
            : originalOpenReview
          return { ...original, openChangesReview }
        }) as StoredEntry['inject'],
      }
      adaptedAreaEntries.set(entry, value)
      return value
    }
    if ((slot !== 'sidebar.right.pane.tab' && slot !== 'sidebar.right.pane.tab.title')
      || (!isTerminal && !isBrowser) || options.areaOccurrence === undefined) {
      return copy(entry)
    }
    const existing = adaptedAreaEntries.get(entry)
    if (existing !== undefined) return existing
    const originalInject = entry.inject
    const value: StoredEntry = {
      ...copy(entry),
      ...(originalInject === undefined ? {} : {
        inject: ((_upstreamSessionId: string, actions?: object) => {
          if (isBrowser) {
            const upstreamInject = originalInject as unknown as (id: string, actions?: object) => Record<string, unknown>
            // DSH's Browser controller is intentionally Session-scoped and
            // owns a tab-id map underneath.  Keep the exact Session identity
            // here so its Desktop factory can resolve the canonical
            // Workspace/CWD and its storage partition.  Workbench tab
            // isolation comes from the Area-local occurrence id and the
            // Session-scoped store's `byTab` key; composing the controller key
            // with an Area id makes browserWorkspace() miss membership.
            // DSH's controller forgets a checkpoint whenever its occurrence
            // signal aborts and the official Sidebar no longer contains the
            // tab.  A Workbench occurrence is deliberately absent from that
            // global list, so an ordinary Workbench teardown (switching modes,
            // remounting the host, or closing the window) must preserve its
            // checkpoint.  Explicit Workbench tab close is marked by Core and
            // is the only path that may forget the bucket.
            const areaOccurrence = options.areaOccurrence
            if (areaOccurrence === undefined) return upstreamInject(_upstreamSessionId, actions)
            const tabId = String(areaOccurrence.read().tab.id)
            const areaActions = actions !== null && typeof actions === 'object'
              ? {
                  ...(actions as Record<string, unknown>),
                  forget: (...args: unknown[]) => {
                    if (!isWorkbenchNativeTabClosing(tabId)) return
                    const forget = (actions as { forget?: (...values: unknown[]) => void }).forget
                    forget?.(...args)
                  },
                }
              : actions
            return upstreamInject(_upstreamSessionId, areaActions)
          }
          const terminalService = (ctx as unknown as {
            webTerminals?: {
              view: (sessionId: string, key: string, contentId: string, terminalId?: unknown, shellPath?: string) => unknown
            }
          }).webTerminals
          const themeService = (ctx as unknown as {
            theme?: { getTheme: () => unknown; subscribe?: (listener: () => void) => () => void }
            on?: (event: string, listener: () => void) => () => void
          }).theme
          if (terminalService === undefined || sessionId === undefined) {
            return (originalInject as unknown as (id: string, actions?: object) => Record<string, unknown>)(_upstreamSessionId, actions)
          }
          const readTab = () => options.areaOccurrence!.read().tab
          const view = () => {
            const tab = readTab()
            const params = tab.navigation.params
            const terminalId = typeof params === 'object' && params !== null && 'terminalId' in params
              ? (params as { terminalId?: unknown }).terminalId
              : undefined
            const shellPath = typeof params === 'object' && params !== null && 'shellPath' in params
              ? (params as { shellPath?: unknown }).shellPath
              : undefined
            return terminalService.view(sessionId, String(tab.id), tab.navigation.address, terminalId, typeof shellPath === 'string' ? shellPath : undefined)
          }
          const theme = themeService === undefined ? undefined : {
            getSnapshot: () => themeService.getTheme(),
            subscribe: themeService.subscribe ?? ((listener: () => void) => (ctx as unknown as { on?: (event: string, listener: () => void) => () => void }).on?.('theme/change', listener) ?? (() => {})),
          }
          return {
            view: () => view(),
            keyedHooks: { terminal: () => (view() as { state: unknown }).state },
            ...(theme === undefined ? {} : { hooks: { theme } }),
          }
        }) as StoredEntry['inject'],
      }),
    }
    adaptedAreaEntries.set(entry, value)
    return value
  }
  const adaptedFactory = (definition: StoredFactory): StoredFactory => {
    if (definition.name !== 'conversation.content') return definition
    const existing = factoryCopies.get(definition)
    if (existing !== undefined) return existing
    const originalInject = definition.inject
    const copy: StoredFactory = {
      ...definition,
      ...(originalInject === undefined ? {} : {
        inject: ((...args: never[]) => {
          const injected = originalInject(...args)
          return options.onSelectWorkspace === undefined
            ? injected
            : {
                ...injected,
                selectWorkspace: (workspaceId: string) => options.onSelectWorkspace!(workspaceId),
              }
        }) as StoredFactory['inject'],
      }),
    }
    factoryCopies.set(definition, copy)
    factoryOrigins.set(copy, definition)
    return copy
  }

  function hostFor(slot: string): SlotRendererHost | undefined {
    const cached = roots.get(slot)
    if (cached !== undefined) return cached
    if (forbidden.has(slot)) return undefined
    // A Factory name is not an ordinary Slot declaration. The renderer host
    // still needs a synthetic root child spec so `renderFactoryRoot()` can
    // mount the Factory; its actual local child specs are resolved from the
    // Factory definition while the occurrence renders.
    const declared = (ctx.slots.spec(keyOf(slot))
      ?? (slot === 'conversation.content'
        ? { kind: 'single', scope: 'root' }
        : undefined)) as SlotSpec<import('@deepseek-ai/dsh-client-ui-slots').SlotEntryDef> | undefined
    if (declared === undefined) return undefined
    // The right-sidebar body receives its native tab reader through the
    // occurrence hook context supplied by the Area preview record.
    const spec = slot === 'sidebar.right.pane.tab' || slot === 'sidebar.right.pane.tab.title'
      ? {
        ...declared,
        inject: {
          hooks: {
            tabInfo: (_standard: unknown, context: unknown) => {
              // The official DSH factory returns a React hook backed by its
              // tab-domain store.  Area occurrences provide the same seam:
              // read() is the snapshot and subscribe() invalidates native
              // bodies when visibility, navigation, title, or shortcuts
              // change. Keep accepting the old read-only context for hosts
              // and fixtures that still pass a function.
              if (typeof context === 'object' && context !== null
                && 'read' in context && 'subscribe' in context
                && typeof (context as { read?: unknown }).read === 'function'
                && typeof (context as { subscribe?: unknown }).subscribe === 'function') {
                const occurrence = context as {
                  readonly read: () => SidebarRightTabInfo
                  readonly subscribe: (listener: () => void) => () => void
                }
                return () => useSyncExternalStore(occurrence.subscribe, occurrence.read, occurrence.read)
              }
              return context
            },
          },
        },
      }
      : declared
    type RootProps = {
      owner: object
      options?: RenderOpts & Partial<HocRenderOpts>
      renderSlot: (key: string, owner: object, options?: RenderOpts & Partial<HocRenderOpts>) => ReactNode
    }
    const component = ({ owner, options, renderSlot }: RootProps) => renderSlot(slot, owner, options)
    const root: StoredEntry = { component, options: {}, children: { [slot]: spec } }
    const host: SlotRendererHost = {
      subscribe: (key, listener) => key === 'root' || forbidden.has(key) ? () => {} : ctx.slots.subscribe(keyOf(key), listener),
      getVersion: key => key === 'root' || forbidden.has(key) ? 0 : ctx.slots.getVersion(keyOf(key)),
      entriesOf: key => key === 'root' ? [root] : entries(key, false),
      entriesOfSlot: key => key === 'root' ? [root] : entries(key, true),
      reportEntryError: (_key, entry, _error, info) => { if (info.abdicate) denied.add(entry) },
      reportFactoryError: () => {},
      specOf: key => key === 'root' ? { kind: 'single', scope: 'root' } : key === slot ? spec : ctx.slots.spec(keyOf(key)),
      isLive: entry => live && (entry === root || authorizedEntries.has(entry)),
      storeOf: (entry, scopeBinding) => {
        if (!entry.store || ownsNativeSidebar(entry)) return undefined
        // Nested SessionProvider (Subagent Chat) changes the store identity as
        // well as its hooks. Never substitute the Area's parent Session here.
        const storeKey = entryScopes.get(entry) === 'root'
          ? undefined
          : scopeBinding?.key ?? `workbench-area:${options.scopeKey ?? 'unbound'}`
        let byScope = stores.get(entry)
        if (byScope === undefined) {
          byScope = new Map()
          stores.set(entry, byScope)
        }
        const retained = byScope.get(storeKey)
        if (retained !== undefined) return retained.instance
        const handle = entry.store as NativeStoreHandle
        const retainedStore = retainNativeStore(handle, storeKey)
        byScope.set(storeKey, retainedStore)
        return retainedStore.instance
      },
      factoryStoreOf,
      retainFactoryOccurrence,
      subscribeFactory: (name, listener) => slotApi.subscribeFactory?.(name, listener) ?? (() => {}),
      getFactoryVersion: name => slotApi.factoryVersion?.(name) ?? 0,
      factoryOf: name => {
        const definition = slotApi.factory?.(name)
        return definition === undefined ? undefined : adaptedFactory(definition)
      },
      isFactoryLive: definition => live && (slotApi.isFactoryLive?.(factoryOrigins.get(definition) ?? definition) ?? false),
      // The editor entry supplies DSH's global standard kit.  The Area scope
      // below remains the only source of Session identity.
      root: source({
        key: undefined,
        hooks: inheritedRoot?.hooks ?? {},
        keyedHooks: inheritedRoot?.keyedHooks ?? {},
        props: { ...(inheritedRoot?.props ?? {}), ...areaStandard },
      }),
      scopeRevision: source(0),
      scope: () => scope,
      locale: ctx.locale,
    }
    roots.set(slot, host)
    return host
  }

  return {
    render(slot: string, owner: object, options?: RenderOpts & Partial<HocRenderOpts>): ReactNode {
      if (!live || forbidden.has(slot)) return options?.fallback ?? null
      const host = hostFor(slot)
      return host === undefined ? options?.fallback ?? null : renderer.renderRoot(host, { owner, options })
    },
    renderFactory(name: string, inputProps: object, options?: {
      slots?: Readonly<Record<string, import('react').FC<Record<string, unknown>>>>
      fallback?: ReactNode
    }): ReactNode {
      if (!live) return options?.fallback ?? null
      const host = hostFor('conversation.content')
      return host === undefined ? options?.fallback ?? null : renderFactoryRoot(host, name, inputProps, options)
    },
    hasEntry(slot: string, entryKey: string): boolean {
      if (!live || forbidden.has(slot)) return false
      const declared = ctx.slots.spec(keyOf(slot))
      if (declared === undefined) return false
      return ctx.slots.entriesOfSlot(keyOf(slot)).some(entry => !ownsNativeSidebar(entry) && !isDeferredOfficialMoreRegistration(slot, entry.options)
        && (entry.options.key === entryKey || entry.options.id === entryKey))
    },
    hasFactorySlot(name: string, slot: string): boolean {
      return slotApi.factory?.(name)?.slots?.[slot] !== undefined
    },
    dispose() {
      if (!live) return
      live = false
      composerOwnership.dispose()
      clearStores()
      roots.clear(); adapted.clear(); adaptedAreaEntries.clear(); adaptedAgentPresetEntries.clear(); denied.clear(); factoryCopies.clear(); factoryOrigins.clear()
    },
  }
}
