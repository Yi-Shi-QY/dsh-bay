import { createFloatingWorkspaceRuntime } from '../client/floating-workspace-runtime.ts'
import { FloatingWorkspaceContext, FloatingInstanceHost } from './FloatingWorkspaceContext.tsx'
import type { WorkbenchSettingsOpenOptionsV1 } from './settings-context.ts'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { IconSettingsOutlineMedium } from '@deepseek-ai/dsh-client-ui-primitives'
import type { HostObservable, PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ContextMenus } from '@deepseek-ai/dsh-client-ui-context-menu/client'
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
import { isWorkbenchCollaborationPage } from '../client/workbench-collaboration-page.ts'
import { DESKTOP_WORKBENCH_SURFACE_V1 } from '../client/workbench-surface-context.ts'
import type { WorkbenchCollaborationClientV1 } from '../client/workbench-collaboration-client.ts'

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
    'settings' | 'editorCatalog' | 'extensionRegistry' | 'sidebarCompatibility' | 'workbenchDirectory' | 'runtimeMetrics' | 'floatingRuntime'
     | 'connectWorkspace' | 'createWorkspaceSession' | 'createWorkspace' | 'pickDirectory' | 'openOfficialSession' | 'windowController' | 'surfaceContext' | 'collaborationClient' | 'requestBrowserReclaim' | 'toolGateway' | 'shareController' | 'bayAgent' | 'generateContextDraft' | 'conversationStatus'>
  & {
    modeController: WorkbenchModeControllerV1
    extensionRegistry?: import('../client/workbench-extension-registry.ts').WorkbenchExtensionRegistryV1
    nativePluginsPanelVisible?: HostObservable<boolean>
    workbenchSettings: HostObservable<SettingsScopeSnapshot<WorkbenchSettingsV4>>
    sidebarHostActions: WorkbenchSidebarHostActionsV1
    contextMenus?: ContextMenus
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
  const fallbackRuntime = useMemo(() => createFloatingWorkspaceRuntime(), [])
  const runtime = props.floatingRuntime ?? fallbackRuntime
  return <FloatingWorkspaceContext.Provider value={runtime}><WorkbenchCoreInnerPageView {...props} floatingRuntime={runtime} /><FloatingInstanceHost runtime={runtime} /></FloatingWorkspaceContext.Provider>
}
function WorkbenchCoreInnerPageView(props: WorkbenchCoreInnerPageProps): ReactNode {
  const surfaceContext = props.surfaceContext ?? DESKTOP_WORKBENCH_SURFACE_V1
  const browserSurface = surfaceContext.kind !== 'desktop'
  const browserWorkbenchId = surfaceContext.kind === 'desktop' ? undefined : surfaceContext.workbenchId
  const sharedControlPage = isWorkbenchCollaborationPage()
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
    browserSurface || directory === undefined || directorySnapshot.openWorkbenchIds.length > 0 ? 'workbench' : 'home'
  ))
  useEffect(() => {
    if (!directory || browserSurface) return
    const open = async (workbenchId: string) => {
      if (!await beforeHomeLeave()) throw new Error('\u8bf7\u5148\u5904\u7406\u603b\u89c8\u4e2d\u5c1a\u672a\u4fdd\u5b58\u7684\u4fee\u6539\u3002')
      const result = await directory.openAndSelect(workbenchId)
      if (result.status !== 'committed') throw new Error('\u65e0\u6cd5\u6253\u5f00\u5de5\u4f5c\u53f0\uff0c\u8bf7\u68c0\u67e5\u76ee\u5f55\u548c\u4fdd\u5b58\u72b6\u6001\u3002')
      await props.modeController.enter({ workbenchId })
      setSurfaceView('workbench')
    }
    directory.openInSurface = open
    return () => { if (directory.openInSurface === open) delete directory.openInSurface }
  }, [directory, browserSurface, props.modeController, beforeHomeLeave])
  const openSettings = useCallback((options?: WorkbenchSettingsOpenOptionsV1) => {
    if (!browserSurface && directory && (options?.section === 'workbenches' || options?.section === 'sharing')) {
      void (async () => {
        if (!(await directory.flushBeforeLifecycleTransition?.() ?? true)) return
        if (homeNavigation.current) homeNavigation.current(options)
        else setHomeOptions(options)
        setSurfaceView('home'); setSettingsOpen(false)
      })()
      return
    }
    setSettingsOptions(options); setSettingsOpen(true)
  }, [browserSurface, directory])
  useEffect(() => {
    if (browserSurface) {
      setSurfaceView('workbench')
      return
    }
    if (directory !== undefined && directorySnapshot.openWorkbenchIds.length === 0) setSurfaceView('home')
  }, [directory, directorySnapshot.openWorkbenchIds.length, browserSurface])
  const nativePluginsPanelVisible = useSyncExternalStore(
    props.nativePluginsPanelVisible?.subscribe ?? (() => () => {}),
    props.nativePluginsPanelVisible?.getSnapshot ?? (() => false),
    props.nativePluginsPanelVisible?.getSnapshot ?? (() => false),
  )
  useLayoutEffect(() => {
    const id = browserWorkbenchId ?? ('activeWorkbenchId' in directorySnapshot ? directorySnapshot.activeWorkbenchId : undefined)
    const enabled = mode.mode === 'workbench' && (!browserWorkbenchId || props.floatingRuntime?.hasControl?.(browserWorkbenchId) !== false)
    props.floatingRuntime?.setSurface(enabled, enabled && !nativePluginsPanelVisible && surfaceView === 'workbench' ? id : undefined)
  }, [props.floatingRuntime, browserWorkbenchId, mode.mode, surfaceView, directorySnapshot, nativePluginsPanelVisible])
  // A browser Workbench view is its own page surface. It must not inherit the
  // Electron titlebar/sidebar offsets from the DSH desktop document.
  const measuredDesktopGeometry = useWorkbenchDesktopGeometry()
  const desktopGeometry = browserSurface ? EMPTY_DESKTOP_GEOMETRY : measuredDesktopGeometry
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
      scheduleDisposeAllWorkbenchNativeOccurrences(new Set(props.floatingRuntime?.instances.keys()))
    }
  }, [mode.mode])
  useEffect(() => { if (mode.mode !== 'workbench') closeSettings() }, [mode.mode, closeSettings])
  const renderSidebar = useCallback<WorkbenchFrameProps['renderSidebar']>(sidebar => (
    <WorkbenchCoreSidebar {...sidebar}
      {...(props.contextMenus === undefined ? {} : { contextMenus: props.contextMenus })}
      useSessionStatus={props.useSessionStatus}
      useSessionRetainInfo={props.useSessionRetainInfo}
      useSessionAccess={props.useSessionAccess}
      useWorkspaceAccess={props.useWorkspaceAccess}
      usePanelInfo={props.usePanelInfo}
      useRemoteAccess={props.useRemoteAccess}
      useContextMenu={props.useContextMenu}
      useResource={props.useResource}
      {...(props.renderFooterActions === undefined ? {} : { renderFooterActions: props.renderFooterActions })}
      openSettings={openSettings} settingsOpen={settingsOpen} exit={() => {
      setExitError(undefined)
      void props.modeController.exit().catch(() => setExitError('\u5e03\u5c40\u672a\u80fd\u4fdd\u5b58\uff0c\u8bf7\u6062\u590d\u8fde\u63a5\u6216\u89e3\u51b3\u5e03\u5c40\u51b2\u7a81\u540e\u91cd\u8bd5\u9000\u51fa\u3002'))
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
        <h1 style={{ margin: '12px 0 0', fontSize: 18, fontWeight: 600 }}>{'\u6b63\u5728\u8f7d\u5165\u5de5\u4f5c\u53f0'}</h1>
        <p style={{ margin: '8px 0 0', color: 'var(--dsw-alias-label-secondary, #62676d)' }}>{'\u6b63\u5728\u8bfb\u53d6\u5e03\u5c40\u5e76\u6062\u590d\u533a\u57df\u5185\u5bb9\u2026'}</p>
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
    showSessionAccentFrames: settingsSnapshot.value?.interactionPolicy?.showSessionAccentFrames !== false,
    surfaceView: browserSurface ? 'workbench' : surfaceView,
    onShowHome: browserSurface ? undefined : () => {
      if (homeNavigation.current) homeNavigation.current()
      else setHomeOptions(undefined)
      setSurfaceView('home')
    },
    onShowWorkbench: browserSurface ? undefined : () => setSurfaceView('workbench'),
    onImportWorkbench: browserSurface || sharedControlPage ? undefined : () => openSettings({ section: 'sharing', shareMode: 'import' }),
    onManageEditors: sharedControlPage ? undefined : () => openSettings({ section: 'pages' }),
    beforeHomeLeave,
    renderHome: directory === undefined || browserSurface ? null : <WorkbenchHomeCenter
      {...props.settingsPage}
      directory={directory}
      {...(homeOptions ? { openOptions: homeOptions } : {})}
      workbenchSettings={props.workbenchSettings}
      useSessions={props.useSessions} useWorkspaces={props.useWorkspaces}
      registerNavigation={registerHomeNavigation}
      onOpenSettings={openSettings}
      registerBeforeLeave={registerHomeLeave}
      onOpenWorkbench={async workbenchId => {
        const result = await directory.openAndSelect(workbenchId)
        if (result.status !== 'committed') throw new Error('\u65e0\u6cd5\u6253\u5f00\u5de5\u4f5c\u53f0')
        setSurfaceView('workbench')
      }}
      onCreated={() => {
        setSurfaceView('workbench')
      }}
    />,
    embeddedDesktop: desktopGeometry.desktop,
    ...((desktopGeometry.desktop || browserSurface) ? { desktopControls: {
      openSettings,
    } } : {}),
  }

  // Keep the plugin surface above official fixed footer panels. The public
  // overlay slot retains lifecycle ownership; exiting removes this portal.
  const surfaceStyle: CSSProperties = desktopGeometry.desktop
    ? { position: 'fixed', top: desktopGeometry.top, left: desktopGeometry.left, right: 0, bottom: 0, zIndex: WORKBENCH_SURFACE_LAYER }
    : { position: 'fixed', inset: 0, zIndex: WORKBENCH_SURFACE_LAYER }

  return createPortal(<div data-workbench-inner-page data-workbench-mode={mode.mode} data-workbench-id={mode.workbenchId} data-workbench-surface={surfaceContext.kind} data-workbench-desktop-content={desktopGeometry.desktop || undefined} aria-busy={mode.mode === 'exiting'} style={surfaceStyle}>
    <div {...(mode.mode === 'exiting' ? { inert: '' } : {})} style={{ position: 'absolute', inset: 0 }}>
      <WorkbenchFrame {...frameProps} />
    </div>
    {catalog.length === 0 && surfaceView === 'workbench' ? <section data-workbench-core-empty-state style={{
      position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', pointerEvents: 'none',
    }}>
      <div style={{ width: 'min(540px, calc(100% - 48px))', padding: 28, border: '1px solid currentColor', borderRadius: 8, background: 'var(--dsw-alias-bg-layer-1, Canvas)', pointerEvents: 'auto' }}>
        <strong>还没有可用的容器内页</strong>
        <p>{'\u5f53\u524d Core \u6ca1\u6709\u6ce8\u518c\u53ef\u7528\u7684\u5185\u9875\u3002\u8bf7\u6253\u5f00\u201c\u5de5\u4f5c\u53f0\u8bbe\u7f6e\u201d\u68c0\u67e5 Core \u7248\u672c\uff1b\u529f\u80fd\u6269\u5c55\u9700\u4ece\u53d7\u4fe1\u4efb\u76ee\u5f55\u5bfc\u5165\u3002'}</p>
        {sharedControlPage ? null : <button type="button" onClick={() => openSettings()}><IconSettingsOutlineMedium size={16} /> {'\u5de5\u4f5c\u53f0\u8bbe\u7f6e'}</button>}
      </div>
    </section> : null}
    {settingsOpen && mode.mode === 'workbench' ? <WorkbenchCoreSettingsDialog
      {...props.settingsPage} {...(settingsOptions ? { openOptions: settingsOptions } : {})} workbenchSettings={props.workbenchSettings} onClose={closeSettings}
      onOpenWorkbench={async id => {
        const result=await directory?.openAndSelect(id)
        if(result?.status!=='committed')throw new Error('\u65e0\u6cd5\u6253\u5f00\u5de5\u4f5c\u53f0\uff0c\u8bf7\u68c0\u67e5\u4fdd\u5b58\u72b6\u6001\u3002')
        setSurfaceView('workbench');closeSettings()
      }}
      useSessions={props.useSessions} useWorkspaces={props.useWorkspaces}
    /> : null}
    {mode.mode === 'exiting' ? <div role="status" style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}>{'\u6b63\u5728\u4fdd\u5b58\u5e76\u9000\u51fa\u5de5\u4f5c\u53f0\u6a21\u5f0f\u2026'}</div> : null}
    {exitError === undefined ? null : <div role="alert" style={{ position: 'absolute', bottom: 16, left: 16, right: 16, padding: 12, background: 'var(--dsw-alias-bg-layer-1, Canvas)' }}>{exitError}</div>}
  </div>, document.body)
}
