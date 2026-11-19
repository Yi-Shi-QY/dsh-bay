import { useWorkbenchLocale, workbenchErrorNotice, workbenchNoticeText, type WorkbenchNotice } from './workbench-locale.ts'
import { useState, type ReactNode } from 'react'
import type { ContextMenus } from '@deepseek-ai/dsh-client-ui-context-menu/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SidebarSectionHookContext, UseSectionScroller } from './workbench-sidebar/generated/upstream/ui-sidebar/contract/slots.ts'
import { IconSettingsOutlineMedium } from '@deepseek-ai/dsh-client-ui-primitives'
import css from './WorkbenchSidebarActions.module.css'
import { WorkbenchBrandMark, WorkbenchBrandName } from './WorkbenchBrand.tsx'
import { WorkbenchSidebar } from './workbench-sidebar.tsx'
import {
  WorkbenchSidebarBrowser,
  type WorkbenchShellSidebarRoutingV1,
  type WorkbenchSidebarHostActionsV1,
} from './workbench-sidebar-browser.tsx'
import { en as sidebarEn, zh as sidebarZh } from './workbench-sidebar/generated/upstream/ui-sidebar/locales.ts'

const fallbackUsePanelInfo = ((selector: (value: { readonly activePanelId: null }) => unknown) => selector({ activePanelId: null })) as PropsRuntime<'shell.overlay'>['usePanelInfo']
const fallbackUseRemoteAccess = (() => true) as PropsRuntime<'shell.overlay'>['useRemoteAccess']
const fallbackUseSessionStatus = ((selector: (value: ReadonlyMap<never, never>) => unknown) => selector(new Map<never, never>())) as PropsRuntime<'shell.overlay'>['useSessionStatus']
const fallbackUseSessionRetainInfo = (() => undefined) as PropsRuntime<'shell.overlay'>['useSessionRetainInfo']
const fallbackUseSessionAccess = (() => true) as PropsRuntime<'shell.overlay'>['useSessionAccess']
const fallbackUseWorkspaceAccess = (() => true) as PropsRuntime<'shell.overlay'>['useWorkspaceAccess']
const fallbackUseContextMenu = (() => ({ getTriggerProps: (_target: unknown, handlers?: Record<string, unknown>) => handlers ?? {} })) as PropsRuntime<'shell.overlay'>['useContextMenu']
const fallbackUseResource = (() => ({ status: 'none', value: undefined, failure: undefined })) as PropsRuntime<'shell.overlay'>['useResource']
const fallbackUseSectionScroller: UseSectionScroller = () => ({ bindScrollerRef: () => {} })

export interface WorkbenchCoreSidebarProps {
  collapsed: boolean
  width: number
  toggleSidebar: () => void
  useSessions: Parameters<typeof WorkbenchSidebarBrowser>[0]['useSessions']
  useWorkspaces: Parameters<typeof WorkbenchSidebarBrowser>[0]['useWorkspaces']
  routing: WorkbenchShellSidebarRoutingV1
  hostActions: WorkbenchSidebarHostActionsV1
  contextMenus?: ContextMenus
  drawer?: boolean
  useSessionStatus: PropsRuntime<'shell.overlay'>['useSessionStatus']
  useSessionRetainInfo: PropsRuntime<'shell.overlay'>['useSessionRetainInfo']
  useSessionAccess: PropsRuntime<'shell.overlay'>['useSessionAccess']
  useWorkspaceAccess: PropsRuntime<'shell.overlay'>['useWorkspaceAccess']
  usePanelInfo: PropsRuntime<'shell.overlay'>['usePanelInfo']
  useRemoteAccess: PropsRuntime<'shell.overlay'>['useRemoteAccess']
  useContextMenu: PropsRuntime<'shell.overlay'>['useContextMenu']
  useResource: PropsRuntime<'shell.overlay'>['useResource']
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
  collapsed, width, toggleSidebar, useSessions, useWorkspaces, routing, hostActions, contextMenus, drawer = false,
  useSessionStatus = fallbackUseSessionStatus, useSessionRetainInfo = fallbackUseSessionRetainInfo,
  useSessionAccess = fallbackUseSessionAccess, useWorkspaceAccess = fallbackUseWorkspaceAccess,
  usePanelInfo = fallbackUsePanelInfo, useRemoteAccess = fallbackUseRemoteAccess,
  useContextMenu = fallbackUseContextMenu, useResource = fallbackUseResource,
  exit, openSettings, settingsOpen, renderFooterActions,
}: WorkbenchCoreSidebarProps): ReactNode {
  const { t, language } = useWorkbenchLocale()
  const [navigationError, setNavigationError] = useState<WorkbenchNotice>()
  const renderSlot = (
    name: string,
    owner: { wide?: boolean; expandSidebar?: () => void; size?: number },
    options?: { hookContext?: unknown },
  ): ReactNode => {
    if (name === 'sidebar.workspaces') {
      const hookContext = options?.hookContext as SidebarSectionHookContext | undefined
      return <WorkbenchSidebarBrowser
        wide={owner.wide ?? !collapsed}
        expandSidebar={owner.expandSidebar ?? toggleSidebar}
        useSessions={useSessions}
        useWorkspaces={useWorkspaces}
        routing={routing}
        hostActions={hostActions}
        {...(contextMenus === undefined ? {} : { contextMenus })}
        useSessionStatus={useSessionStatus}
        useSessionRetainInfo={useSessionRetainInfo}
        useSessionAccess={useSessionAccess}
        useWorkspaceAccess={useWorkspaceAccess}
        usePanelInfo={usePanelInfo}
        useRemoteAccess={useRemoteAccess}
        useContextMenu={useContextMenu}
        useResource={useResource}
        useSectionScroller={hookContext?.useSectionScroller ?? fallbackUseSectionScroller}
      />
    }
    if (name === 'sidebar.settings') {
      return <button
        type="button"
        className={owner.wide ? css.action : `${css.action} ${css.rail}`}
        data-workbench-settings-entry
        aria-label={t('shell.settings')}
        title={t('shell.settings')}
        aria-haspopup="dialog"
        aria-expanded={settingsOpen}
        onClick={openSettings}
      >{owner.wide ? <IconSettingsOutlineMedium size={16} /> : <IconSettingsOutlineMedium size={18} />}{owner.wide ? <span className={css.label}>{t('shell.settings')}</span> : null}</button>
    }
    if (name === 'sidebar.footer.action') {
      return <>{renderFooterActions?.({ wide: owner.wide ?? !collapsed })}<button
        type="button"
        className={owner.wide ? css.action : `${css.action} ${css.rail}`}
        data-workbench-exit-action
        aria-label={t('home.exitWorkbenchMode')}
        title={t('home.exitWorkbenchMode')}
        onClick={exit}
      ><span className={css.returnIcon} aria-hidden="true">↩</span>{owner.wide ? <span className={css.label}>{t('home.exitWorkbenchMode')}</span> : null}</button></>
    }
    if (name === 'sidebar.brand.mark') return <WorkbenchBrandMark size={owner.size ?? 24} />
    if (name === 'sidebar.brand.name') return <WorkbenchBrandName />
    return null
  }
  const dictionary: Readonly<Record<string, string>> = language === undefined || language === 'zh' ? sidebarZh : sidebarEn
  const translate = (key: string): string => dictionary[key] ?? key
  return <><WorkbenchSidebar {...{
    collapsed,
    width,
    drawer,
    useSessions,
    useWorkspaces,
    useRemoteAccess,
    usePanelInfo,
    useWorkspaceAccess,
    useContextMenu,
    useResource,
    useSessionStatus,
    useSessionAccess,
    useSessionRetainInfo,
    usePanels: <T,>(selector: (state: readonly never[]) => T): T => selector([]),
    renderFactorySlot: () => null,
    useEntryPins: <T,>(selector: (state: readonly string[]) => T): T => selector([]),
    useEntryActions: <T,>(selector: (state: boolean) => T): T => selector(false),
    useShortcuts: <T,>(selector: (state: readonly never[]) => T): T => selector([]),
    selectPanel: () => {},
    setPinned: () => {},
    trackEntryClick: () => {},
    startSession: (workspaceId?: string) => {
      const areaId = routing.getSnapshot().focusedAreaId
      setNavigationError(undefined)
      if (areaId === undefined) {
        setNavigationError({ key: 'sidebar.chooseArea' })
        return
      }
      void routing.startSession({ ...(workspaceId === undefined ? {} : { workspaceId }), areaId })
        .catch(error => setNavigationError(workbenchErrorNotice(error, 'sidebar.startPageFailed')))
    },
    toggleSidebar,
    renderSlot,
    t: translate,
  }} />{navigationError === undefined ? null : <div role="alert" style={{
    position: 'absolute', left: 8, bottom: 56, width: Math.max(200, width - 16), maxWidth: 'calc(100% - 16px)',
    padding: 12, background: 'var(--dsw-alias-bg-layer-1, Canvas)', overflowWrap: 'anywhere', zIndex: 1,
  }}>{workbenchNoticeText(t, navigationError)}</div>}</>
}
