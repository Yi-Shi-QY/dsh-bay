import type { WorkbenchSettingsOpenOptionsV1 } from './settings-context.ts'
import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { IconSettingsOutlineMedium } from '@deepseek-ai/dsh-client-ui-primitives'
import type { HostObservable, PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SettingsScopeSnapshot } from '../client/workbench-settings-contracts.ts'
import type { WorkbenchModeControllerV1 } from '../mode-controller.ts'
import type { WorkbenchSettingsV4 } from './persistence.ts'
import type { WorkbenchFrameProps } from './WorkbenchFrame.tsx'
import { WorkbenchFrame } from './WorkbenchFrame.tsx'
import { WorkbenchHomeCenter } from './WorkbenchHomeCenter.tsx'
import {
  cancelScheduledWorkbenchNativeDispose,
  scheduleDisposeAllWorkbenchNativeOccurrences,
} from '../client/native-sidebar-area-editor.tsx'
import { WorkbenchCoreSidebar } from './WorkbenchCoreSidebar.tsx'
import type { WorkbenchSidebarHostActionsV1 } from './workbench-sidebar-browser.tsx'
import { WorkbenchCoreSettingsDialog, type WorkbenchCoreSettingsPage } from './WorkbenchCoreSettingsDialog.tsx'
import type { WorkbenchToolGatewayManagerV1 } from '../tool-gateway.ts'
import type { WorkbenchShareControllerV1 } from '../client/workbench-share-controller.ts'
import { isWorkbenchShareGuestPage } from '../client/workbench-share-guest.ts'

// Locked DSH footer panels use 30; public menus use 100 and modals use 1000.
const WORKBENCH_SURFACE_LAYER = 40

interface WorkbenchDesktopGeometryV1 {
  /** Whether the official shell exposes a native Desktop titlebar. */
  desktop: boolean
  /** Viewport coordinates of the official DSH content rectangle. */
  top: number
  left: number
}

const EMPTY_DESKTOP_GEOMETRY: WorkbenchDesktopGeometryV1 = { desktop: false, top: 0, left: 0 }
const EMPTY_WORKBENCH_DIRECTORY_SNAPSHOT = { openWorkbenchIds: [], rows: [], invalidRows: [], templates: [] } as const

/**
 * Read the official shell geometry without depending on its hashed class names
 * or a fixed Windows titlebar/sidebar width. The 0.1.7 shell publishes the
 * titlebar attribute and renders a centre column whose left edge is the exact
 * boundary after the official Sidebar. Workbench must start at that boundary
 * so it cannot intercept native window controls or the official Sidebar.
 */
function readDesktopGeometry(): WorkbenchDesktopGeometryV1 {
  if (typeof document === 'undefined') return EMPTY_DESKTOP_GEOMETRY
  const root = document.documentElement
  const desktop = root.dataset.platform === 'win32' && root.hasAttribute('data-windows-titlebar')
  if (!desktop) return EMPTY_DESKTOP_GEOMETRY
  const centre = document.querySelector<HTMLElement>('#root [class*="centerCol"]')
  const rect = centre?.getBoundingClientRect()
  if (rect !== undefined && rect.width > 0 && rect.height > 0) {
    return { desktop: true, top: Math.max(0, rect.top), left: Math.max(0, rect.left) }
  }
  const titlebar = Number.parseFloat(getComputedStyle(root).getPropertyValue('--dsh-windows-titlebar-height'))
  return { desktop: true, top: Number.isFinite(titlebar) ? Math.max(0, titlebar) : 0, left: 0 }
}

function useWorkbenchDesktopGeometry(): WorkbenchDesktopGeometryV1 {
  const [geometry, setGeometry] = useState<WorkbenchDesktopGeometryV1>(() => readDesktopGeometry())
  useLayoutEffect(() => {
    const refresh = () => {
      const next = readDesktopGeometry()
      setGeometry(previous => previous.desktop === next.desktop
        && previous.top === next.top && previous.left === next.left ? previous : next)
    }
    refresh()
    const root = document.documentElement
    const centre = document.querySelector<HTMLElement>('#root [class*="centerCol"]')
    const observer = typeof ResizeObserver === 'undefined' || centre === null
      ? undefined
      : new ResizeObserver(refresh)
    if (observer !== undefined && centre !== null) observer.observe(centre)
    window.addEventListener('resize', refresh)
    const mutationObserver = new MutationObserver(refresh)
    mutationObserver.observe(root, { attributes: true, attributeFilter: ['data-platform', 'data-windows-titlebar'] })
    return () => {
      observer?.disconnect()
      mutationObserver.disconnect()
      window.removeEventListener('resize', refresh)
    }
  }, [])
  return geometry
}

export type WorkbenchCoreInnerPageInjection =
  Pick<WorkbenchFrameProps,
    'settings' | 'editorCatalog' | 'extensionRegistry' | 'sidebarCompatibility' | 'workbenchDirectory' | 'runtimeMetrics'
     | 'connectWorkspace' | 'createWorkspaceSession' | 'createWorkspace' | 'pickDirectory' | 'openOfficialSession' | 'windowController' | 'browserView' | 'browserWorkbenchId' | 'requestBrowserReclaim' | 'toolGateway' | 'shareController'>
  & {
    modeController: WorkbenchModeControllerV1
    extensionRegistry?: import('../client/workbench-extension-registry.ts').WorkbenchExtensionRegistryV1
    nativePluginsPanelVisible?: HostObservable<boolean>
    workbenchSettings: HostObservable<SettingsScopeSnapshot<WorkbenchSettingsV4>>
    sidebarHostActions: WorkbenchSidebarHostActionsV1
    settingsPage: WorkbenchCoreSettingsPage
    renderFooterActions?: (owner: { wide: boolean }) => ReactNode
    requestBrowserReclaim?: (workbenchId: string) => Promise<boolean>
    shareController?: WorkbenchShareControllerV1
  }

export type WorkbenchCoreInnerPageProps =
  & PropsRuntime<'shell.overlay'>
  & PropsRenderSlots<'workbench.editor.root' | 'workbench.editor.session'>
  & WorkbenchCoreInnerPageInjection

/**
 * The Workbench surface is an overlay contribution, so official DSH remains
 * mounted and untouched until the user explicitly enters Workbench mode.
 */
export function WorkbenchCoreInnerPage(props: WorkbenchCoreInnerPageProps): ReactNode {
  const shareGuest = isWorkbenchShareGuestPage()
  const [exitError, setExitError] = useState<string>()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsOptions, setSettingsOptions] = useState<WorkbenchSettingsOpenOptionsV1>()
  const [homeOptions, setHomeOptions] = useState<WorkbenchSettingsOpenOptionsV1>()
  const homeNavigation = useRef<(options?: WorkbenchSettingsOpenOptionsV1) => void>()
  const homeLeave = useRef<() => Promise<boolean>>()
  const registerHomeNavigation = useCallback((navigate: (options?: WorkbenchSettingsOpenOptionsV1) => void) => {
    homeNavigation.current = navigate; return () => { homeNavigation.current = undefined }
  }, [])
  const registerHomeLeave = useCallback((guard: () => Promise<boolean>) => {
    homeLeave.current = guard; return () => { homeLeave.current = undefined }
  }, [])
  const beforeHomeLeave = useCallback(() => homeLeave.current?.() ?? Promise.resolve(true), [])
  const closeSettings = useCallback(() => setSettingsOpen(false), [])
  const mode = useSyncExternalStore(
    props.modeController.subscribe,
    props.modeController.getSnapshot,
    props.modeController.getSnapshot,
  )
  const catalog = useSyncExternalStore(
    props.editorCatalog.subscribe,
    props.editorCatalog.getSnapshot,
    props.editorCatalog.getSnapshot,
  )
  const settingsSnapshot = useSyncExternalStore(
    props.workbenchSettings.subscribe,
    props.workbenchSettings.getSnapshot,
    props.workbenchSettings.getSnapshot,
  )
  const directory = props.workbenchDirectory
  const directorySnapshot = useSyncExternalStore(
    directory?.subscribe ?? (() => () => {}),
    directory?.getSnapshot ?? (() => EMPTY_WORKBENCH_DIRECTORY_SNAPSHOT),
    directory?.getSnapshot ?? (() => EMPTY_WORKBENCH_DIRECTORY_SNAPSHOT),
  )
  const [surfaceView, setSurfaceView] = useState<'home' | 'workbench'>(() => (
    props.browserView === true || directory === undefined || directorySnapshot.openWorkbenchIds.length > 0 ? 'workbench' : 'home'
  ))
  const openSettings = useCallback((options?: WorkbenchSettingsOpenOptionsV1) => {
    if (props.browserView !== true && directory && (options?.section === 'workbenches' || options?.section === 'sharing')) {
      void (async () => {
        if (!(await directory.flushBeforeLifecycleTransition?.() ?? true)) return
        if (homeNavigation.current) homeNavigation.current(options)
        else setHomeOptions(options)
        setSurfaceView('home'); setSettingsOpen(false)
      })()
      return
    }
    setSettingsOptions(options); setSettingsOpen(true)
  }, [props.browserView, directory])
  useEffect(() => {
    if (props.browserView === true) {
      setSurfaceView('workbench')
      return
    }
    if (directory !== undefined && directorySnapshot.openWorkbenchIds.length === 0) setSurfaceView('home')
  }, [directory, directorySnapshot.openWorkbenchIds.length, props.browserView])
  const nativePluginsPanelVisible = useSyncExternalStore(
    props.nativePluginsPanelVisible?.subscribe ?? (() => () => {}),
    props.nativePluginsPanelVisible?.getSnapshot ?? (() => false),
    props.nativePluginsPanelVisible?.getSnapshot ?? (() => false),
  )
  // A browser Workbench view is its own page surface. It must not inherit the
  // Electron titlebar/sidebar offsets from the DSH desktop document.
  const measuredDesktopGeometry = useWorkbenchDesktopGeometry()
  const desktopGeometry = props.browserView === true ? EMPTY_DESKTOP_GEOMETRY : measuredDesktopGeometry
  // Native DSH tab occurrences belong to the Workbench host lifetime, not to
  // an individual React body. Defer teardown so StrictMode's effect replay
  // cannot abort a live occurrence during development, while an actual host
  // unmount still releases Browser/Files/Terminal controllers.
  useEffect(() => {
    cancelScheduledWorkbenchNativeDispose()
    return () => { scheduleDisposeAllWorkbenchNativeOccurrences() }
  }, [])
  useEffect(() => {
    if (mode.mode === 'workbench' || mode.mode === 'entering') {
      cancelScheduledWorkbenchNativeDispose()
    } else {
      scheduleDisposeAllWorkbenchNativeOccurrences()
    }
  }, [mode.mode])
  useEffect(() => { if (mode.mode !== 'workbench') closeSettings() }, [mode.mode, closeSettings])
  const renderSidebar = useCallback<WorkbenchFrameProps['renderSidebar']>(sidebar => (
    <WorkbenchCoreSidebar {...sidebar}
      {...(props.renderFooterActions === undefined ? {} : { renderFooterActions: props.renderFooterActions })}
      openSettings={openSettings} settingsOpen={settingsOpen} exit={() => {
      setExitError(undefined)
      void props.modeController.exit().catch(() => setExitError('布局未能保存，请恢复连接或解决布局冲突后重试退出。'))
    }} />
  ), [props.modeController, props.renderFooterActions, openSettings, settingsOpen])

  if (mode.mode === 'official') return null
  if (mode.mode === 'entering') {
    const enteringStyle: CSSProperties = desktopGeometry.desktop
      ? { position: 'fixed', top: desktopGeometry.top, left: desktopGeometry.left, right: 0, bottom: 0, zIndex: WORKBENCH_SURFACE_LAYER, display: 'grid', placeItems: 'center' }
      : { position: 'fixed', inset: 0, zIndex: WORKBENCH_SURFACE_LAYER, display: 'grid', placeItems: 'center' }
    return createPortal(<div data-workbench-inner-page data-workbench-mode={mode.mode} data-workbench-desktop-content={desktopGeometry.desktop || undefined} role="status" aria-live="polite" aria-busy="true" style={{
      ...enteringStyle, color: 'var(--dsw-alias-label-primary, CanvasText)',
      background: 'var(--dsw-alias-bg-base, Canvas)', font: '14px/1.5 system-ui, sans-serif',
    }}>
      <section style={{ width: 'min(440px, calc(100% - 48px))', padding: 24, border: '1px solid var(--dsw-alias-border-l2, #d9dcdf)', borderRadius: 8, background: 'var(--dsw-alias-bg-layer-1, Canvas)', textAlign: 'center' }}>
        <span aria-hidden="true" style={{ display: 'inline-block', width: 24, height: 24, border: '2px solid var(--dsw-alias-border-l2, #d9dcdf)', borderTopColor: 'var(--dsw-alias-label-link, #1769d2)', borderRadius: '50%', animation: 'dsh-workbench-enter-spin 800ms linear infinite' }} />
        <h1 style={{ margin: '12px 0 0', fontSize: 18, fontWeight: 600 }}>正在载入工作台</h1>
        <p style={{ margin: '8px 0 0', color: 'var(--dsw-alias-label-secondary, #62676d)' }}>正在读取布局并恢复区域内容…</p>
      </section>
      <style>{'@keyframes dsh-workbench-enter-spin { to { transform: rotate(360deg); } } @media (prefers-reduced-motion: reduce) { [data-workbench-mode="entering"] span { animation: none !important; } }'}</style>
    </div>, document.body)
  }

  // The official DSH Plugins panel owns the central column when selected from
  // the native sidebar. Keep Workbench mode and its layout alive, but remove
  // this portal from hit testing and painting so the native panel is usable.
  if (nativePluginsPanelVisible) {
    return createPortal(<div data-workbench-inner-page data-workbench-mode={mode.mode}
      data-workbench-native-panel-hidden="plugins" aria-hidden="true"
      style={{ display: 'none' }} />, document.body)
  }

  const frameProps: WorkbenchFrameProps = {
    ...props,
    renderSidebar,
    bindLayout: () => () => {},
    bindNavigation: () => () => {},
    // Workbench Areas keep explicit bindings. Never move DSH's current Session.
    selectSession: () => {},
    projectNeutral: true,
    conversationResourcePolicy: settingsSnapshot.value?.interactionPolicy,
    surfaceView: props.browserView === true ? 'workbench' : surfaceView,
    onShowHome: props.browserView === true ? undefined : () => {
      if (homeNavigation.current) homeNavigation.current()
      else setHomeOptions(undefined)
      setSurfaceView('home')
    },
    onShowWorkbench: props.browserView === true ? undefined : () => setSurfaceView('workbench'),
    onImportWorkbench: props.browserView === true || shareGuest ? undefined : () => openSettings({ section: 'sharing', shareMode: 'import' }),
    onManageEditors: shareGuest ? undefined : () => openSettings({ section: 'pages' }),
    beforeHomeLeave,
    renderHome: directory === undefined || props.browserView === true ? null : <WorkbenchHomeCenter
      {...props.settingsPage}
      directory={directory}
      {...(homeOptions ? { openOptions: homeOptions } : {})}
      workbenchSettings={props.workbenchSettings}
      useSessions={props.useSessions} useWorkspaces={props.useWorkspaces}
      registerNavigation={registerHomeNavigation}
      registerBeforeLeave={registerHomeLeave}
      onOpenWorkbench={async workbenchId => {
        const result = await directory.openAndSelect(workbenchId)
        if (result.status !== 'committed') throw new Error('无法打开工作台')
        setSurfaceView('workbench')
      }}
      onCreated={() => {
        setSurfaceView('workbench')
      }}
    />,
    embeddedDesktop: desktopGeometry.desktop,
    ...((desktopGeometry.desktop || (props.browserView === true && !shareGuest)) ? { desktopControls: {
      openSettings,
    } } : {}),
  }

  // Keep the plugin surface above official fixed footer panels. The public
  // overlay slot retains lifecycle ownership; exiting removes this portal.
  const surfaceStyle: CSSProperties = desktopGeometry.desktop
    ? { position: 'fixed', top: desktopGeometry.top, left: desktopGeometry.left, right: 0, bottom: 0, zIndex: WORKBENCH_SURFACE_LAYER }
    : { position: 'fixed', inset: 0, zIndex: WORKBENCH_SURFACE_LAYER }

  return createPortal(<div data-workbench-inner-page data-workbench-mode={mode.mode} data-workbench-id={mode.workbenchId} data-workbench-desktop-content={desktopGeometry.desktop || undefined} aria-busy={mode.mode === 'exiting'} style={surfaceStyle}>
    <div {...(mode.mode === 'exiting' ? { inert: '' } : {})} style={{ position: 'absolute', inset: 0 }}>
      <WorkbenchFrame {...frameProps} />
    </div>
    {catalog.length === 0 && surfaceView === 'workbench' ? <section data-workbench-core-empty-state style={{
      position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', pointerEvents: 'none',
    }}>
      <div style={{ width: 'min(540px, calc(100% - 48px))', padding: 28, border: '1px solid currentColor', borderRadius: 8, background: 'var(--dsw-alias-bg-layer-1, Canvas)', pointerEvents: 'auto' }}>
        <strong>还没有可用的容器内页</strong>
        <p>当前 Core 没有注册可用的内页。请打开“工作台设置”检查 Core 版本；功能扩展需从受信任目录导入。</p>
        {shareGuest ? null : <button type="button" onClick={() => openSettings()}><IconSettingsOutlineMedium size={16} /> 工作台设置</button>}
      </div>
    </section> : null}
    {settingsOpen && mode.mode === 'workbench' ? <WorkbenchCoreSettingsDialog
      {...props.settingsPage} {...(settingsOptions ? { openOptions: settingsOptions } : {})} workbenchSettings={props.workbenchSettings} onClose={closeSettings}
      onOpenWorkbench={async id => {
        const result=await directory?.openAndSelect(id)
        if(result?.status!=='committed')throw new Error('无法打开工作台，请检查保存状态。')
        setSurfaceView('workbench');closeSettings()
      }}
      useSessions={props.useSessions} useWorkspaces={props.useWorkspaces}
    /> : null}
    {mode.mode === 'exiting' ? <div role="status" style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}>正在保存并退出工作台模式…</div> : null}
    {exitError === undefined ? null : <div role="alert" style={{ position: 'absolute', bottom: 16, left: 16, right: 16, padding: 12, background: 'var(--dsw-alias-bg-layer-1, Canvas)' }}>{exitError}</div>}
  </div>, document.body)
}
