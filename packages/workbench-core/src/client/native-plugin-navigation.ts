import type { WorkbenchModeControllerV1 } from '../mode-controller.ts'

/** Navigation only: package mutations remain with the native DSH panel. */
export interface WorkbenchNativePluginNavigation {
  getSnapshot(): boolean
  subscribe(listener: () => void): () => void
  open(): Promise<void>
}

export class WorkbenchNativePluginNavigationError extends Error {
  constructor() {
    super('无法打开 DSH 原生插件管理。请确认布局已保存、连接正常，并且原生插件管理已启用。')
  }
}

export function createNativePluginNavigation(input: {
  mode: WorkbenchModeControllerV1
  available(): boolean
  subscribe(listener: () => void): () => void
  selectPanel(): void
}): WorkbenchNativePluginNavigation {
  return {
    getSnapshot: input.available,
    subscribe: input.subscribe,
    async open() {
      const select = () => {
        if (!input.available()) throw new WorkbenchNativePluginNavigationError()
        input.selectPanel()
      }
      try {
        if (!input.available()) throw new WorkbenchNativePluginNavigationError()
        if (input.mode.getSnapshot().mode === 'official') select()
        else {
          let selected = false
          await input.mode.exit(() => { select(); selected = true })
          // An existing mode transition may complete without our callback.
          if (!selected) throw new WorkbenchNativePluginNavigationError()
        }
      } catch { throw new WorkbenchNativePluginNavigationError() }
    },
  }
}
