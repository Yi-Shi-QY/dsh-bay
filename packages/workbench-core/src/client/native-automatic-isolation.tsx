import { createElement, useSyncExternalStore, type ComponentType } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { StoredEntry } from '@deepseek-ai/dsh-client-ui-slots'
import type { WorkbenchModeControllerV1 } from '../mode-controller.ts'

const originals = new WeakMap<StoredEntry, StoredEntry>()
export const originalWorkbenchAutomaticEntry = (entry: StoredEntry) => originals.get(entry) ?? entry

/** Shadow only the RC5 automatic review opener. The global sidebar owner and
 * its methods remain untouched; official mode delegates the original props. */
export function installNativeAutomaticIsolation(ctx: Context, mode: WorkbenchModeControllerV1) {
  const name = 'conversation.plan-review.actions' as keyof import('@deepseek-ai/dsh-client-ui-slots').SlotMap & string
  return ctx.slots.inject(name, () => {
    const entry = ctx.slots.entriesOfSlot(name).find(row => row.options.id === '@deepseek-ai/dsh-client-ui-plan')
    if (!entry || originals.has(entry)) return () => {}
    const Component = entry.component as ComponentType<Record<string, unknown>>
    function Isolated(props: Record<string, unknown>) {
      const state = useSyncExternalStore(mode.subscribe, mode.getSnapshot, mode.getSnapshot)
      const upstream = props.useSidebarMounted as (selector: (value: unknown) => unknown) => unknown
      const mounted = (selector: (value: unknown) => unknown) => {
        const value = upstream((v: unknown) => v)
        return selector(state.mode === 'official' ? value : undefined)
      }
      return createElement(Component, { ...props, useSidebarMounted: mounted })
    }
    const unregister = ctx.slots.register({ name, ...entry.options, priority: (entry.options.priority ?? 0) - 1,
      store: entry.store, locale: entry.locale, inject: entry.inject,
    } as never, Isolated as never)
    const shadow = ctx.slots.entriesOfSlot(name).find(row => row.component === Isolated)
    if (shadow) originals.set(shadow, entry)
    return unregister
  })
}
