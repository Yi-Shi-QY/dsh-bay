import { createElement, useSyncExternalStore, type ComponentType } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { StoredEntry } from '@deepseek-ai/dsh-client-ui-slots'
import type { WorkbenchModeControllerV1 } from '../mode-controller.ts'

const originals = new WeakMap<StoredEntry, StoredEntry>()
export const originalWorkbenchAutomaticEntry = (entry: StoredEntry) => originals.get(entry) ?? entry

/** Isolate RC1's automatic review opener and single-root Composer ownership.
 * The global sidebar owner and its methods remain untouched. */
export function installNativeAutomaticIsolation(ctx: Context, mode: WorkbenchModeControllerV1) {
  const planReviewName = 'conversation.plan-review.actions' as keyof import('@deepseek-ai/dsh-client-ui-slots').SlotMap & string
  const composerBarName = 'conversation.composer.bar' as keyof import('@deepseek-ai/dsh-client-ui-slots').SlotMap & string

  const disposePlanReview = ctx.slots.inject(planReviewName, () => {
    const entry = ctx.slots.entriesOfSlot(planReviewName).find(row => row.options.id === '@deepseek-ai/dsh-client-ui-plan')
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
    const unregister = ctx.slots.register({ name: planReviewName, ...entry.options, priority: (entry.options.priority ?? 0) - 1,
      store: entry.store, locale: entry.locale, inject: entry.inject,
    } as never, Isolated as never)
    const shadow = ctx.slots.entriesOfSlot(planReviewName).find(row => row.component === Isolated)
    if (shadow) originals.set(shadow, entry)
    return unregister
  })

  /**
   * RC1 keeps one Lexical editor per SessionInputShell. The official DSH
   * Conversation remains mounted below the Workbench overlay, so leaving its
   * Composer mounted would make the official and Workbench roots race over the
   * same editor. Register a null shadow only while Workbench owns the surface;
   * the Area renderer unwraps this shadow back to the original entry through
   * `originalWorkbenchAutomaticEntry`, so the Workbench still renders DSH's
   * actual Composer implementation.
   */
  const disposeComposer = ctx.slots.inject(composerBarName, () => {
    const entry = ctx.slots.entriesOfSlot(composerBarName).find(row => !originals.has(row))
    if (!entry) return () => {}
    let unregister: (() => void) | undefined
    let shadow: StoredEntry | undefined
    const remove = () => {
      unregister?.()
      unregister = undefined
      if (shadow !== undefined) originals.delete(shadow)
      shadow = undefined
    }
    const add = () => {
      if (unregister !== undefined || mode.getSnapshot().mode !== 'workbench') return
      // No children/inject are copied here deliberately: the official surface
      // must render no Composer at all. Workbench unwraps the shadow and uses
      // the original declaration, including its full child contract.
      const NullComposer = () => null
      unregister = ctx.slots.register({
        name: composerBarName,
        ...entry.options,
        priority: (entry.options.priority ?? 0) - 1,
      } as never, NullComposer as never)
      shadow = ctx.slots.entriesOfSlot(composerBarName).find(row => row.component === NullComposer)
      if (shadow) originals.set(shadow, entry)
    }
    const offMode = mode.subscribe(() => {
      if (mode.getSnapshot().mode === 'workbench') add()
      else remove()
    })
    add()
    return () => { offMode(); remove() }
  })

  return () => { disposeComposer(); disposePlanReview() }
}
