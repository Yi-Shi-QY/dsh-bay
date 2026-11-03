import type { ReactNode } from 'react'

export type WorkbenchNativeTabTitleRenderer = () => ReactNode

const renderers = new Map<string, WorkbenchNativeTabTitleRenderer>()
const listeners = new Set<() => void>()

function notify(): void {
  for (const listener of [...listeners]) listener()
}

/**
 * Register the title seat rendered by one Area-local DSH tab occurrence.
 *
 * The Frame owns the Workbench tab chrome, while DSH still owns the title
 * component itself.  Keeping this registry outside the layout document means
 * React nodes and native store handles never enter persisted or shared state.
 */
export function registerWorkbenchNativeTabTitle(
  instanceId: string,
  render: WorkbenchNativeTabTitleRenderer,
): () => void {
  renderers.set(instanceId, render)
  notify()
  return () => {
    if (renderers.get(instanceId) !== render) return
    renderers.delete(instanceId)
    notify()
  }
}

export function getWorkbenchNativeTabTitle(instanceId: string): WorkbenchNativeTabTitleRenderer | undefined {
  return renderers.get(instanceId)
}

export function subscribeWorkbenchNativeTabTitles(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Runtime-only registry cleanup for tests and host teardown. */
export function clearWorkbenchNativeTabTitles(): void {
  if (renderers.size === 0) return
  renderers.clear()
  notify()
}
