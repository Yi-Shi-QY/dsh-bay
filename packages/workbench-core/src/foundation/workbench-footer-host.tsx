import { useEffect, type ReactNode } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { RenderOpts, SlotRendererHost, StoredEntry, StoreInstanceLike } from '@deepseek-ai/dsh-client-ui-slots'
import { createSlotRenderer } from './renderer/scoped-slots.tsx'
import { getWorkbenchClientSessions } from '../client/session-service.ts'

const slot = 'sidebar.footer.action'
const renderer = createSlotRenderer()
const source = <T,>(value: T) => ({ getSnapshot: () => value, subscribe: () => () => {} })

// The official Cordis panel owns the dynamic-plugin management surface in
// normal DSH mode.  Workbench must not project that owner into its private
// sidebar: doing so creates a second panel and lets the two surfaces compete
// for the same footer position.  The official sidebar remains untouched.
const WORKBENCH_HIDDEN_OFFICIAL_FOOTER_ENTRY_IDS = new Set(['cordis-panel'])

export function isAllowedWorkbenchFooterEntry(entry: StoredEntry): boolean {
  return entry.options.id !== 'dsh-workbench-enter-mode'
    && !WORKBENCH_HIDDEN_OFFICIAL_FOOTER_ENTRY_IDS.has(entry.options.id ?? '')
}

/** Render public footer contributions without declaring or mounting their Sidebar owner. */
export function createWorkbenchFooterHost(ctx: Context) {
  const sessions = getWorkbenchClientSessions(ctx)
  let live = true
  const adapted = new Map<StoredEntry, StoredEntry>()
  const denied = new Set<StoredEntry>()
  const stores = new Map<StoredEntry, StoreInstanceLike & { clearPersisted?: () => void }>()
  const copy = (entry: StoredEntry) => {
    let value = adapted.get(entry)
    if (!value) { value = { ...entry }; adapted.set(entry, value) }
    return value
  }
  const entries = () => live ? ctx.slots.entriesOfSlot(slot)
    .filter(isAllowedWorkbenchFooterEntry).map(copy).filter(entry => !denied.has(entry)) : []
  const clearStores = () => {
    for (const store of stores.values()) store.clearPersisted?.()
    stores.clear()
  }
  function Root({ owner, renderSlot }: { owner: { wide: boolean }; renderSlot: (key: string, owner: object, options?: RenderOpts) => ReactNode }) {
    useEffect(() => clearStores, [])
    return renderSlot(slot, owner)
  }
  const root: StoredEntry = { component: Root, options: {}, children: { [slot]: { kind: 'list', scope: 'root' } } }
  // Footer actions are root-scoped; they never select an official or Area Session.
  const absentScope = {
    current: source({ key: undefined, hooks: {}, keyedHooks: {}, props: {} }),
    bindingSource: () => absentScope.current,
  }
  const host: SlotRendererHost = {
    subscribe: (key, fn) => key === slot ? ctx.slots.subscribe(slot, () => {
      const current = new Set(ctx.slots.entriesOfSlot(slot).map(copy))
      for (const [entry, store] of stores) if (!current.has(entry)) { store.clearPersisted?.(); stores.delete(entry) }
      fn()
    }) : () => {},
    getVersion: key => key === slot ? ctx.slots.getVersion(slot) : 0,
    entriesOf: key => key === 'root' ? [root] : key === slot ? entries() : [],
    entriesOfSlot: key => key === 'root' ? [root] : key === slot ? entries() : [],
    specOf: key => key === 'root' ? { kind: 'single', scope: 'root' } : key === slot ? ctx.slots.spec(slot) : undefined,
    isLive: entry => live && (entry === root || ctx.slots.entries(slot).some(original => adapted.get(original) === entry)),
    reportEntryError: (_key, entry, _error, info) => { if (info.abdicate) denied.add(entry) },
    reportFactoryError: () => {},
    factoryStoreOf: () => undefined,
    retainFactoryOccurrence: () => () => {},
    subscribeFactory: () => () => {},
    getFactoryVersion: () => 0,
    factoryOf: () => undefined,
    isFactoryLive: () => false,
    storeOf: entry => {
      if (!entry.store) return undefined
      let store = stores.get(entry)
      if (!store) {
        const handle = entry.store as { create(key?: string): StoreInstanceLike & { clearPersisted?: () => void } }
        store = handle.create('workbench-footer')
        stores.set(entry, store)
      }
      return store
    },
    root: source({ key: undefined, hooks: { sessions: sessions.list, workspaces: ctx.workspaces.list }, keyedHooks: {}, props: {} }),
    scopeRevision: source(0), scope: () => absentScope, locale: ctx.locale,
  }
  return {
    render: (owner: { wide: boolean }) => live ? renderer.renderRoot(host, { owner }) : null,
    dispose: () => { live = false; clearStores(); adapted.clear(); denied.clear() },
  }
}
