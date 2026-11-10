import { useEffect, useState } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import { IconPanelLeftOutlineMedium } from '@deepseek-ai/dsh-client-ui-primitives'
import type { WorkbenchDirectory } from '../foundation/frame-settings-adapter.ts'

export const workbenchPanelId = (id: string) => `dsh-bay.workbench.${id}`

/** One navigation bridge, never another workbench renderer or Session owner. */
export function installWorkbenchSidebarShortcuts(ctx: Context, directory: WorkbenchDirectory,
  open: (id: string) => Promise<void>): () => void {
  const registrations = new Map<string, { name: string; dispose(): void }>()
  const pending = new Map<string, Promise<void>>()
  const navigate = (id: string) => {
    const prior = pending.get(id)
    if (prior) return prior
    const request = open(id).then(() => {
      if (ctx.layout.panelInfo.getSnapshot().activePanelId === workbenchPanelId(id)) ctx.layout.selectPanel(null)
    }).finally(() => { pending.delete(id) })
    pending.set(id, request)
    return request
  }
  const refresh = () => {
    const snapshot = directory.getSnapshot()
    const desired = snapshot.rows.filter(row => snapshot.sidebarShortcuts?.includes(row.workbenchId) && row.archivedAt === undefined)
    for (const [id, entry] of registrations) {
      if (!desired.some(row => row.workbenchId === id && row.name === entry.name)) {
        if (ctx.layout.panelInfo.getSnapshot().activePanelId === workbenchPanelId(id)) ctx.layout.selectPanel(null)
        entry.dispose(); registrations.delete(id)
      }
    }
    for (const row of desired) {
      if (registrations.has(row.workbenchId)) continue
      const key = workbenchPanelId(row.workbenchId) as MainPanelId
      function Bridge() {
        const [error, setError] = useState<string>()
        const run = () => { setError(undefined); void navigate(row.workbenchId).catch(cause => setError(cause instanceof Error ? cause.message : '无法打开工作台')) }
        useEffect(run, [])
        return <section style={{ padding: 32 }} aria-live="polite"><h2>{row.name}</h2>{error
          ? <><p role="alert">{error}</p><button onClick={run}>重试打开</button><button onClick={() => ctx.layout.selectPanel(null)}>返回对话</button></>
          : <p>正在打开工作台…</p>}</section>
      }
      const removeMain = ctx.slots.inject('main', () => {
        const disposeMain = ctx.slots.register({ name: 'main', key }, Bridge)
        const disposeIcon = ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist', id: key, label: row.name, order: 60,
        }, ({ size }) => <IconPanelLeftOutlineMedium size={size} />))
        return () => { disposeIcon(); disposeMain() }
      })
      registrations.set(row.workbenchId, { name: row.name, dispose: removeMain })
    }
  }
  const unsubscribe = directory.subscribe(refresh)
  refresh()
  return () => { unsubscribe(); for (const entry of registrations.values()) entry.dispose(); registrations.clear() }
}
