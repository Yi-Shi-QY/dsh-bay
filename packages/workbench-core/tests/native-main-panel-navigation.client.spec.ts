// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import { createWorkbenchModeController } from '../src/mode-controller.ts'
import { createNativePluginsPanelVisibility, watchNativePluginsPanel } from '../src/client/native-main-panel-navigation.ts'

function source() {
  let value: { activePanelId: MainPanelId | null } = { activePanelId: null }
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => value,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    select(panel: MainPanelId | null) {
      value = { activePanelId: panel }
      for (const listener of listeners) listener()
    },
  }
}

describe('native Plugins panel handoff', () => {
  it('hides the Workbench surface while the native panel is selected', async () => {
    const mode = createWorkbenchModeController()
    const panelInfo = source()
    const visibility = createNativePluginsPanelVisibility()
    const dispose = watchNativePluginsPanel({
      panelInfo,
      mode,
      pluginsPanelId: 'plugins' as MainPanelId,
      visibility,
    })

    await mode.enter()
    panelInfo.select('plugins' as MainPanelId)
    expect(visibility.getSnapshot()).toBe(true)
    expect(mode.getSnapshot().mode).toBe('workbench')
    panelInfo.select(null)
    expect(visibility.getSnapshot()).toBe(false)
    dispose()
  })

  it('ignores other panels and official mode', async () => {
    const mode = createWorkbenchModeController()
    const panelInfo = source()
    const visibility = createNativePluginsPanelVisibility()
    const dispose = watchNativePluginsPanel({
      panelInfo,
      mode,
      pluginsPanelId: 'plugins' as MainPanelId,
      visibility,
    })

    panelInfo.select('settings' as MainPanelId)
    expect(mode.getSnapshot().mode).toBe('official')
    await mode.enter()
    panelInfo.select('settings' as MainPanelId)
    expect(mode.getSnapshot().mode).toBe('workbench')
    expect(visibility.getSnapshot()).toBe(false)
    dispose()
  })

  it('restores the Workbench surface after returning from the native panel', async () => {
    const mode = createWorkbenchModeController()
    const panelInfo = source()
    const visibility = createNativePluginsPanelVisibility()
    const dispose = watchNativePluginsPanel({
      panelInfo,
      mode,
      pluginsPanelId: 'plugins' as MainPanelId,
      visibility,
    })

    await mode.enter()
    panelInfo.select('plugins' as MainPanelId)
    expect(visibility.getSnapshot()).toBe(true)
    panelInfo.select(null)
    expect(visibility.getSnapshot()).toBe(false)
    expect(mode.getSnapshot().mode).toBe('workbench')
    dispose()
  })

  it('returns the native Plugins panel to Conversation when entering Workbench from Plugins', async () => {
    const mode = createWorkbenchModeController()
    const panelInfo = source()
    const visibility = createNativePluginsPanelVisibility()
    const selectConversationPanel = vi.fn(() => panelInfo.select(null))
    const dispose = watchNativePluginsPanel({
      panelInfo,
      mode,
      pluginsPanelId: 'plugins' as MainPanelId,
      visibility,
      selectConversationPanel,
    })

    panelInfo.select('plugins' as MainPanelId)
    await mode.enter()

    expect(selectConversationPanel).toHaveBeenCalledOnce()
    expect(panelInfo.getSnapshot().activePanelId).toBeNull()
    expect(mode.getSnapshot().mode).toBe('workbench')
    expect(visibility.getSnapshot()).toBe(false)
    dispose()
  })

  it('uses the native Plugins DOM as a fallback when panelInfo is isolated', async () => {
    const mode = createWorkbenchModeController()
    const visibility = createNativePluginsPanelVisibility()
    const dispose = watchNativePluginsPanel({
      panelInfo: undefined,
      mode,
      pluginsPanelId: 'plugins' as MainPanelId,
      visibility,
    })

    await mode.enter()
    const panel = document.createElement('section')
    panel.dataset.pluginPanel = 'true'
    panel.getBoundingClientRect = () => ({
      x: 0, y: 0, width: 400, height: 200, top: 0, right: 400, bottom: 200, left: 0,
      toJSON: () => ({}),
    }) as DOMRect
    document.body.append(panel)
    await vi.waitFor(() => expect(visibility.getSnapshot()).toBe(true))
    panel.remove()
    await vi.waitFor(() => expect(visibility.getSnapshot()).toBe(false))
    dispose()
  })
})
