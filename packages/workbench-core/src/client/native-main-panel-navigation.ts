import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type { WorkbenchModeControllerV1 } from '../mode-controller.ts'

interface NativePanelInfoV1 {
  readonly activePanelId: MainPanelId | null
}

export interface NativePluginsPanelVisibilityV1 extends HostObservable<boolean> {
  set(value: boolean): void
}

export function createNativePluginsPanelVisibility(): NativePluginsPanelVisibilityV1 {
  let value = false
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => value,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener) } },
    set(next) {
      if (value === next) return
      value = next
      for (const listener of [...listeners]) listener()
    },
  }
}

/**
 * Observe the host's native Plugins navigation without taking ownership of it.
 * The Workbench surface is temporarily hidden while the host panel is visible;
 * the Workbench mode, layout and bindings remain alive for the return trip.
 */
export function watchNativePluginsPanel(input: {
  panelInfo: HostObservable<NativePanelInfoV1> | undefined
  mode: WorkbenchModeControllerV1
  pluginsPanelId: MainPanelId
  visibility: NativePluginsPanelVisibilityV1
  selectConversationPanel?: () => void
  documentRoot?: Document
}): () => void {
  let disposed = false
  let workbenchActive = input.mode.getSnapshot().mode === 'workbench'
  const root = input.documentRoot ?? (typeof document === 'undefined' ? undefined : document)
  const panelIsVisible = (): boolean => {
    if (root === undefined) return false
    const panel = root.querySelector<HTMLElement>('[data-plugin-panel="true"]')
    if (panel === null || panel.getAttribute('aria-hidden') === 'true') return false
    const rect = panel.getBoundingClientRect()
    const style = root.defaultView?.getComputedStyle(panel)
    return rect.width > 0 && rect.height > 0 && style?.display !== 'none' && style?.visibility !== 'hidden'
  }
  const sync = (): void => {
    if (disposed || !workbenchActive) return
    const panelSelected = input.panelInfo?.getSnapshot().activePanelId === input.pluginsPanelId
    input.visibility.set(panelSelected || panelIsVisible())
  }
  const unsubscribePanel = input.panelInfo?.subscribe(sync) ?? (() => {})
  const unsubscribeMode = input.mode.subscribe(() => {
    const nextWorkbenchActive = input.mode.getSnapshot().mode === 'workbench'
    if (!nextWorkbenchActive) {
      workbenchActive = false
      input.visibility.set(false)
      return
    }
    // Re-entering Workbench from the official Plugins page should show the
    // saved Workbench immediately. On first entry from the Plugins panel,
    // return DSH's central owner to its native Conversation panel first.
    if (!workbenchActive) {
      if (input.panelInfo?.getSnapshot().activePanelId === input.pluginsPanelId) {
        input.selectConversationPanel?.()
      }
      workbenchActive = true
      input.visibility.set(false)
      return
    }
    sync()
  })
  let observer: MutationObserver | undefined
  if (root !== undefined && typeof MutationObserver !== 'undefined') {
    observer = new MutationObserver(sync)
    observer.observe(root.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-hidden', 'style', 'class'] })
  }
  if (workbenchActive) sync()
  return () => {
    disposed = true
    unsubscribePanel()
    unsubscribeMode()
    observer?.disconnect()
    input.visibility.set(false)
  }
}
