import { createContext, useContext, useLayoutEffect, useRef, useSyncExternalStore, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { FloatingWorkspaceRuntime } from '../client/floating-workspace-runtime.ts'
import { floatingInstanceKey } from '../client/floating-workspace-runtime.ts'

export const FloatingWorkspaceContext = createContext<FloatingWorkspaceRuntime | undefined>(undefined)
export const useFloatingWorkspace = () => useContext(FloatingWorkspaceContext)

/** A background event remains discoverable from Home and closed-workbench cards. */
export function FloatingWorkspaceUnread({ workbenchId }: { workbenchId: string }) {
  const runtime = useFloatingWorkspace()
  useSyncExternalStore(runtime?.subscribe ?? (() => () => {}), runtime?.getSnapshot ?? (() => 0), () => 0)
  const count = [...(runtime?.instances.values() ?? [])].filter(row => row.workbenchId === workbenchId && row.unread).length
  if (!count) return null
  return <span role="status" aria-label="有后台更新" title={count + ' 个内页有后台更新'}
    style={{ display: 'inline-block', flexShrink: 0, width: 6, height: 6, marginInlineStart: 6, borderRadius: '50%', background: 'var(--dsw-alias-label-link, #4d6bfe)' }} />
}

/** Portal targets are stable per instance, even when their DOM parent changes. */
export function FloatingInstanceHost({ runtime }: { runtime: FloatingWorkspaceRuntime }) {
  useSyncExternalStore(runtime.subscribeContent, runtime.getContentSnapshot, runtime.getContentSnapshot)
  if (runtime.instances.size === 0) return null
  return <><div ref={element => { runtime.parking = element ?? undefined }} aria-hidden="true" data-workbench-instance-parking
    {...{ inert: '' }}
    style={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden', visibility: 'hidden', pointerEvents: 'none' }} />{[...runtime.instances.values()].map(row => row.element && row.render
    ? createPortal(row.render, row.element, floatingInstanceKey(row.workbenchId, row.tab.id)) : null)}</>
}

export function RetainedEditorTarget({ id, workbenchId, children }: { id: string; workbenchId?: string; children: ReactNode }) {
  const runtime = useFloatingWorkspace()
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const target = ref.current
    if (!runtime?.find(id, workbenchId) || !target) return
    runtime.present(id, children, target, workbenchId)
  }, [runtime, id, workbenchId, children])
  useLayoutEffect(() => {
    const target = ref.current
    return () => { if (target) runtime?.detach(id, target, workbenchId) }
  }, [runtime, id, workbenchId])
  return <div ref={ref} style={{ width: '100%', height: '100%', minHeight: 0 }} data-workbench-retained-target={id} />
}
