import { useState, type ReactNode } from 'react'
import { IconSettingsOutlineMedium } from '@deepseek-ai/dsh-client-ui-primitives'
import css from './WorkbenchSidebarActions.module.css'
import { WorkbenchBrandMark, WorkbenchBrandName } from './WorkbenchBrand.tsx'
import { WorkbenchSidebar } from './workbench-sidebar.tsx'
import {
  WorkbenchSidebarBrowser,
  type WorkbenchShellSidebarRoutingV1,
  type WorkbenchSidebarHostActionsV1,
} from './workbench-sidebar-browser.tsx'
import { zh as sidebarZh } from './workbench-sidebar/generated/upstream/ui-sidebar/locales.ts'

export interface WorkbenchCoreSidebarProps {
  collapsed: boolean
  width: number
  toggleSidebar: () => void
  useSessions: Parameters<typeof WorkbenchSidebarBrowser>[0]['useSessions']
  useWorkspaces: Parameters<typeof WorkbenchSidebarBrowser>[0]['useWorkspaces']
  routing: WorkbenchShellSidebarRoutingV1
  hostActions: WorkbenchSidebarHostActionsV1
  exit: () => void
  openSettings: () => void
  settingsOpen: boolean
  renderFooterActions?: (owner: { wide: boolean }) => ReactNode
}

/**
 * The Core-owned Workbench sidebar. Its shell and browser are frozen copies
 * of the locked DSH generation; only navigation is adapted to Area claims.
 */
export function WorkbenchCoreSidebar({
  collapsed, width, toggleSidebar, useSessions, useWorkspaces, routing, hostActions, exit, openSettings, settingsOpen, renderFooterActions,
}: WorkbenchCoreSidebarProps): ReactNode {
  const [navigationError, setNavigationError] = useState<string>()
  const renderSlot = (name: string, owner: { wide?: boolean; expandSidebar?: () => void; size?: number }): ReactNode => {
    if (name === 'sidebar.workspaces') {
      return <WorkbenchSidebarBrowser
        wide={owner.wide ?? !collapsed}
        expandSidebar={owner.expandSidebar ?? toggleSidebar}
        useSessions={useSessions}
        useWorkspaces={useWorkspaces}
        routing={routing}
        hostActions={hostActions}
      />
    }
    if (name === 'sidebar.settings') {
      return <button
        type="button"
        className={owner.wide ? css.action : `${css.action} ${css.rail}`}
        data-workbench-settings-entry
        aria-label="设置"
        title="设置"
        aria-haspopup="dialog"
        aria-expanded={settingsOpen}
        onClick={openSettings}
      >{owner.wide ? <IconSettingsOutlineMedium size={16} /> : <IconSettingsOutlineMedium size={18} />}{owner.wide ? <span className={css.label}>设置</span> : null}</button>
    }
    if (name === 'sidebar.footer.action') {
      return <>{renderFooterActions?.({ wide: owner.wide ?? !collapsed })}<button
        type="button"
        className={owner.wide ? css.action : `${css.action} ${css.rail}`}
        data-workbench-exit-action
        aria-label="退出工作台模式"
        title="退出工作台模式"
        onClick={exit}
      ><span className={css.returnIcon} aria-hidden="true">↩</span>{owner.wide ? <span className={css.label}>退出工作台模式</span> : null}</button></>
    }
    if (name === 'sidebar.brand.mark') return <WorkbenchBrandMark size={owner.size ?? 24} />
    if (name === 'sidebar.brand.name') return <WorkbenchBrandName />
    return null
  }
  const dictionary = new Map<string, string>(Object.entries(sidebarZh))
  const translate = (key: string): string => dictionary.get(key) ?? key
  return <><WorkbenchSidebar {...{
    collapsed,
    width,
    useSessions,
    useWorkspaces,
    startSession: (workspaceId?: string) => {
      const areaId = routing.getSnapshot().focusedAreaId
      setNavigationError(undefined)
      if (areaId === undefined) {
        setNavigationError('请先选择一个工作台区域。')
        return
      }
      void routing.startSession({ ...(workspaceId === undefined ? {} : { workspaceId }), areaId })
        .catch(error => setNavigationError(error instanceof Error ? error.message : '新建对话内页打开失败'))
    },
    toggleSidebar,
    renderSlot,
    t: translate,
  }} />{navigationError === undefined ? null : <div role="alert" style={{
    position: 'absolute', left: 8, bottom: 56, width: Math.max(200, width - 16), maxWidth: 'calc(100% - 16px)',
    padding: 12, background: 'var(--dsw-alias-bg-layer-1, Canvas)', overflowWrap: 'anywhere', zIndex: 1,
  }}>{navigationError}</div>}</>
}
