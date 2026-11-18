import { waitForFileWorkbench } from './workbench-access.ts'
export { createWorkbenchBundleClient } from './workbench-bundle.ts'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-connection/client'
export type { WorkbenchEditorOwnerProps } from './editor-slots.ts'
export type { WorkbenchEditorSvgIconV1 } from '../foundation/workbench-editor-icons.ts'
export { normalizeWorkbenchEditorSvgIcon } from '../foundation/workbench-editor-icons.ts'
export type { WorkbenchEditorRegistrationMetadataV1 } from './workbench-editor-slot-catalog.ts'
export type { WorkbenchAreaMetadataV1, WorkbenchAreaOwnershipV1 } from '../foundation/persistence.ts'
export {
  WorkbenchControlPlane,
  WORKBENCH_CONTROL_PLANE_SERVICE_NAME,
} from '../foundation/workbench-control-plane.ts'
export {
  projectPortableWorkbenchContext,
  restorePortableWorkbenchContext,
  validatePortableWorkbenchContext,
} from '../foundation/workbench-context-portability.ts'
export type {
  PortableWorkbenchContextV1,
  RestoredPortableWorkbenchContextV1,
  WorkbenchContextExportPolicyV1,
} from '../foundation/workbench-context-portability.ts'
export type {
  CreateAreaInputV1,
  CreateAreaResultV1,
  CreateSessionInputV1,
  CreateSessionResultV1,
  EnsureEditorInputV1,
  EnsureEditorResultV1,
  WorkbenchControlPlaneActor,
  WorkbenchControlPlaneAreaV1,
  WorkbenchControlPlaneEditorV1,
  WorkbenchControlPlaneModuleV1,
  WorkbenchControlPlaneOptions,
  WorkbenchControlPlaneReadContext,
  WorkbenchControlPlaneRejectionReason,
  WorkbenchControlPlaneSettings,
  WorkbenchControlPlaneSnapshotV1,
  WorkbenchControlPlaneWriteResult,
} from '../foundation/workbench-control-plane.ts'
export {
  WorkbenchSuperAgentAdapter,
  buildWorkbenchAgentPromptContext,
  captureWorkbenchAgentExecutionLease,
  isWorkbenchAgentExecutionCurrent,
  renderWorkbenchAgentPromptContext,
  workbenchAgentExecutionStaleReason,
} from '../foundation/workbench-superagent-adapter.ts'
export {
  WorkbenchBayAgentAdapter,
  buildWorkbenchBayAgentPromptContext,
  captureWorkbenchBayAgentExecutionLease,
  isWorkbenchBayAgentExecutionCurrent,
  renderWorkbenchBayAgentPromptContext,
  workbenchBayAgentExecutionStaleReason,
} from '../foundation/workbench-bay-agent-adapter.ts'
export * from '../foundation/workbench-bay-agent-work.ts'
export { WorkbenchBayAgentPanel } from '../foundation/WorkbenchBayAgentPanel.tsx'
export type { WorkbenchBayAgentPanelProps } from '../foundation/WorkbenchBayAgentPanel.tsx'
export type {
  ApplyWorkbenchBayAreaAgentReportInputV1,
  BuildWorkbenchBayAgentPromptContextInputV1,
  CaptureWorkbenchBayAgentExecutionLeaseInputV1,
  CaptureWorkbenchBayAgentPromptInputV1,
  WorkbenchBayAgentExecutionLeaseV1,
  WorkbenchBayAgentExecutionStaleReason,
  WorkbenchBayAgentPromptContextV1,
  WorkbenchBayAgentReportResult,
  WorkbenchBayAgentWorkItemV1,
  WorkbenchBayAgentAdapterControlPlane,
} from '../foundation/workbench-bay-agent-adapter.ts'
export type {
  ApplyWorkbenchAreaAgentReportInputV1,
  BuildWorkbenchAgentPromptContextInputV1,
  CaptureWorkbenchAgentExecutionLeaseInputV1,
  CaptureWorkbenchAgentPromptInputV1,
  WorkbenchAgentExecutionLeaseV1,
  WorkbenchAgentExecutionStaleReason,
  WorkbenchAgentPromptContextV1,
  WorkbenchAgentReportResult,
  WorkbenchAgentWorkItemV1,
  WorkbenchSuperAgentAdapterControlPlane,
} from '../foundation/workbench-superagent-adapter.ts'
export type {
  WorkbenchEditorBackgroundRuntimeV1,
  WorkbenchEditorBindingPolicyV1,
  WorkbenchEditorBindingRequirementV1,
  WorkbenchEditorBindingSharingV1,
  WorkbenchEditorDeclarationV1,
  WorkbenchEditorScopeV1,
  WorkbenchEditorReacquireV1,
  WorkbenchEditorStateRestoreV1,
  WorkbenchEditorStateShareV1,
  WorkbenchEditorUnboundBehaviorV1,
  WorkbenchConversationResourceBindingV1,
} from '../module-contract.ts'
export type {
  WorkbenchConversationInteractionPolicyV1,
  WorkbenchConversationResourceClickPolicyV1,
  WorkbenchConversationResourcePlacementV1,
} from '../workbench-interaction-policy.ts'
export type {
  WorkbenchExtensionDeclarationV1,
  WorkbenchExtensionProviderDiagnosticV1,
  WorkbenchExtensionProviderDiagnosticCodeV1,
  WorkbenchExtensionProviderResolutionV1,
} from '../workbench-extension-access.ts'
export {
  isWorkbenchExtensionDeclarationV1,
  validateWorkbenchExtensionDeclarationV1,
  workbenchExtensionDeclarationFailureV1,
} from '../workbench-extension-access.ts'
export { WORKBENCH_WINDOW_CONTROLLER_SERVICE_NAME } from './workbench-window-controller.ts'
export type {
  WorkbenchWindowActionResultV1,
  WorkbenchWindowControllerV1,
  WorkbenchWindowOpenResultV1,
  WorkbenchWindowSnapshotV1,
} from './workbench-window-controller.ts'
export {
  isWorkbenchCollaborationSurface,
  type WorkbenchSurfaceContextV1,
  type WorkbenchSurfaceContextV2,
} from './workbench-surface-context.ts'
export {
  createWorkbenchCollaborationClient,
  type WorkbenchCollaborationClientV1,
} from './workbench-collaboration-client.ts'
export {
  isWorkbenchCollaborationPage,
  readWorkbenchCollaborationPageMarker,
  type WorkbenchCollaborationPageMarkerV1,
} from './workbench-collaboration-page.ts'
export { projectWorkbenchBrowserLifecycleV1 } from './workbench-browser-lifecycle.ts'
export type {
  WorkbenchBrowserLifecyclePhaseV1,
  WorkbenchBrowserLifecycleProjectionV1,
  WorkbenchBrowserLocalPhaseV1,
} from './workbench-browser-lifecycle.ts'
export type { WorkbenchCopyInviteV1, WorkbenchCopyInviteStateV1 } from '../online-copy-contract.ts'
export { applyWorkbenchCopyInviteActionV1, classifyWorkbenchCopyInviteV1, createWorkbenchCopyInviteV1, validateWorkbenchCopyCode, validateWorkbenchCopyInviteV1, verifyWorkbenchCopyInviteCodeV1 } from '../online-copy-contract.ts'
export { WORKBENCH_OFFICIAL_AREA_EDITOR_IDS } from './official-area-editors.tsx'
export {
  WORKBENCH_CONVERSATION_SUITE_IDENTITY_SERVICE_NAME,
  WORKBENCH_CONVERSATION_SUITE_REGISTRAR_SERVICE_NAME,
} from '../conversation-suite-contract.ts'
import { applyWorkbenchCoreFoundation } from '../foundation/apply-core.ts'
import { createWorkbenchBrowserDirectSourceInstallCommit, createWorkbenchBrowserSignedCatalogInstallCommit } from '../browser-module-install.ts'
import { createWorkbenchModuleManager } from '../module-manager.ts'
import { inspectWorkbenchClientInstallEnvironment } from './install-capabilities.ts'
import { WORKBENCH_CORE_MANIFEST } from '../core-manifest.ts'
import { WORKBENCH_CORE_RUNTIME_SERVICE_NAME, createWorkbenchCoreRuntime } from '../core-runtime.ts'
import { createWorkbenchModuleCenterBridge } from '../browser-module-center.ts'
import { createWorkbenchManagerRestartBridge } from './workbench-manager-restart.ts'
import { readWorkbenchWindowView } from './workbench-window-view.ts'
import { hasBrowserWorkbenchIntent, reportBrowserWorkbenchClosed, reportBrowserWorkbenchReady, reportBrowserWorkbenchFailed, resolveBrowserWorkbenchView, startBrowserWorkbenchHeartbeat } from './resolve-browser-window-view.ts'
import { mountBrowserWorkbenchShell, mountBrowserWorkbenchStatusShell, unmountBrowserWorkbenchShell } from './browser-workbench-shell.ts'
import { WORKBENCH_WINDOW_RPC_CHANNEL, workbenchWindowRpcEndpoint } from '../workbench-window-rpc.ts'

export { WorkspacePicker } from '../foundation/workbench-sidebar/generated/upstream/ui-workspace/WorkspacePicker.tsx'
export { zh as workbenchWorkspaceZh } from '../foundation/workbench-sidebar/generated/upstream/ui-workspace/locales.ts'
export type {
  DirectoryFlowOwnerProps,
  WorkspacePickerProps,
} from '../foundation/workbench-sidebar/generated/upstream/ui-workspace/contract/slots.ts'

/** Core uses the same injected DSH faces as the frozen Workbench Frame. */
export const inject = [
  'connection', 'slots', 'layout', 'sessions', 'workspaces', 'uiWorkspace', 'uiSession', 'configForms', 'modules', 'locale', 'conversation',
  'remote', 'remote.session', 'remote.settings', 'remote.agentPresets', 'remote.pluginInventory', 'remote.pluginManager', 'remote.workspaceFiles', 'webTerminals', 'sidebarRight', 'sidebarRightTabs', 'shortcuts', 'resources', 'contextMenus', 'theme', 'uiConversation', 'cordisInspect',
] as const

/**
 * Deliberately structural: importing the DSH Runtime type here would make the
 * Core declaration project follow the entire upstream source graph. The
 * runtime object is still the official ClientContext at execution time.
 */
interface WorkbenchCoreClientContextV1 {
  provide?: (name: string, value: unknown) => unknown
  effect?: (
    handler: () => (() => void) | void,
    key?: string,
  ) => unknown
  get?: <T = unknown>(name: string) => T | undefined
  remote?: { $on(event: 'plugin-manager/changed', listener: () => void): () => void }
  on?: (event: 'connection/reset', listener: () => void) => () => void
  connection?: { rpc?: import('@deepseek-ai/dsh-client-connection/client').ClientConnectionRpc }
}

function waitForWorkbenchSurface(workbenchId: string, timeoutMs = 20_000): Promise<boolean> {
  if (typeof document === 'undefined') return Promise.resolve(false)
  const visible = () => [...document.querySelectorAll<HTMLElement>('[data-workbench-inner-page][data-workbench-mode="workbench"]')]
    .some(node => node.dataset.workbenchId === workbenchId)
  if (visible()) return Promise.resolve(true)
  return new Promise(resolve => {
    let settled = false
    const finish = (value: boolean) => {
      if (settled) return
      settled = true
      observer.disconnect()
      clearTimeout(timer)
      resolve(value)
    }
    const observer = new MutationObserver(() => { if (visible()) finish(true) })
    observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true,
      attributeFilter: ['data-workbench-mode', 'data-workbench-id'] })
    const timer = setTimeout(() => finish(visible()), timeoutMs)
  })
}

/**
 * Core browser face. The frozen Frame, Settings projection and DSH-native
 * Conversation editors are physically embedded in this package. Optional
 * Workbench Modules remain separate and arrive through their own lifecycle.
 */
export async function apply(ctx: WorkbenchCoreClientContextV1): Promise<void> {
  const browserIntent = hasBrowserWorkbenchIntent()
  if (browserIntent) {
    mountBrowserWorkbenchStatusShell('正在验证 Workbench 浏览器窗口…')
    ctx.effect?.(() => () => { unmountBrowserWorkbenchShell() }, 'workbench: browser isolation shell')
  }
  const resolution = await resolveBrowserWorkbenchView(ctx as never)
  if (resolution.status === 'failed') {
    mountBrowserWorkbenchStatusShell(`无法打开 Workbench 浏览器窗口（${resolution.code}）。请从 DSH 客户端重新打开。`)
    return
  }
  const windowView = resolution.status === 'ready' ? resolution.view : browserIntent ? undefined : readWorkbenchWindowView()
  if (windowView) {
    try { await waitForFileWorkbench(windowView.workbenchId) }
    catch (error) { mountBrowserWorkbenchStatusShell(`工作台目录尚不可用：${error instanceof Error ? error.message : String(error)}`); reportBrowserWorkbenchClosed(ctx as never, windowView); return }
  }
  const runtime = createWorkbenchCoreRuntime({
    core: WORKBENCH_CORE_MANIFEST,
    flush: () => foundation.flush(),
    ...(windowView === undefined ? {} : { resolveWorkbench: async () => windowView.workbenchId }),
  })
  const managerRestart = createWorkbenchManagerRestartBridge()
  const moduleManager = createWorkbenchModuleManager({
    capabilities: () => inspectWorkbenchClientInstallEnvironment(ctx).capabilities,
    // This projection is intentionally advisory. The Host repeats identity
    // resolution against durable Profile receipts before committing.
    installed: () => new Map(),
    catalogImport: {
      get verifiedSeams() { return inspectWorkbenchClientInstallEnvironment(ctx).verifiedSeams },
      allowedPermissions: ['dsh.conversation.render'],
    },
    commitSignedCatalogInstall: createWorkbenchBrowserSignedCatalogInstallCommit(),
    commitDirectSourceInstall: createWorkbenchBrowserDirectSourceInstallCommit(),
    ...(windowView === undefined ? { center: createWorkbenchModuleCenterBridge() } : {}),
    ...(managerRestart === undefined ? {} : {
      resumeRestart: managerRestart.resumeRestart,
      requestRestart: async (transactionId, onStatus) => {
        const accepted = await managerRestart.requestRestart(transactionId)
        // Keep the browser API honest: acceptance is not completion. The
        // callback resolves only after Manager reports a replacement Run and
        // Workbench verification for this transaction.
        return managerRestart.waitForRestart({ operationId: accepted.operationId, transactionId, onStatus })
      },
    }),
  })
  const foundation = applyWorkbenchCoreFoundation(ctx as never, runtime.mode, moduleManager, runtime)
  if (windowView !== undefined) {
    let stopped = false
    let reclaimed = false
    let stopHeartbeat = () => {}
    let stopRuntimeMetrics = () => {}
    if (typeof window !== 'undefined') {
      const closeView = (event: PageTransitionEvent) => {
        if (!event.persisted) {
          stopped = true
          stopHeartbeat()
          stopRuntimeMetrics()
          if (!reclaimed) reportBrowserWorkbenchClosed(ctx as never, windowView,
            () => foundation.floatingRuntime.snapshotHandoff(windowView.workbenchId))
        }
      }
      window.addEventListener('pagehide', closeView)
      ctx.effect?.(() => () => {
        stopped = true
        stopHeartbeat()
        stopRuntimeMetrics()
        window.removeEventListener('pagehide', closeView)
      }, 'workbench: browser view lifecycle')
    }
    void (async () => {
      await foundation.ready()
      // Restore before mounting the floating workspace. Its persistent Main
      // placeholder can otherwise race the incoming Main binding and reject
      // a valid handoff as a stale rebind.
      if (ctx.connection?.rpc) {
        const result = await ctx.connection.rpc.call(WORKBENCH_WINDOW_RPC_CHANNEL, workbenchWindowRpcEndpoint('floating-read'), {
          windowId: windowView.windowId, closeToken: windowView.closeToken,
        }, AbortSignal.timeout(8_000))
        if (!result.ok) throw new Error('浮动工作区交接读取失败')
        const snapshot = (result.value as { snapshot?: unknown }).snapshot
        if (snapshot != null) foundation.floatingRuntime.restoreHandoff(windowView.workbenchId, snapshot)
      }
      await runtime.mode.enter({ workbenchId: windowView.workbenchId })
      if (await waitForWorkbenchSurface(windowView.workbenchId)) {
        const shell = mountBrowserWorkbenchShell(windowView.workbenchId)
        if (shell.status !== 'ready') {
          mountBrowserWorkbenchStatusShell('目标工作台无法在此 DSH 页面中安全挂载。DSH 页面内容已隔离，请从客户端重新打开工作台。')
          await reportBrowserWorkbenchFailed(ctx as never, windowView, shell.code ?? 'browser-shell-unsupported')
          return
        }
        const ready = await reportBrowserWorkbenchReady(ctx as never, windowView)
        if (!ready) {
          mountBrowserWorkbenchStatusShell('DSH Host 未确认此工作台视图，页面已锁定。请返回客户端重新打开工作台。')
          return
        }
        if (!stopped) stopHeartbeat = startBrowserWorkbenchHeartbeat(ctx as never, windowView, state => {
          if (state === 'reclaimed') reclaimed = true
          window.dispatchEvent(new CustomEvent('workbench-browser-reclaim', { detail: { state } }))
        }, () => foundation.floatingRuntime.snapshotHandoff(windowView.workbenchId))
        if (!stopped && ctx.connection?.rpc !== undefined) {
          let pendingMetrics = false
          const reportMetrics = async () => {
            if (stopped || pendingMetrics) return
            pendingMetrics = true
            try {
              await ctx.connection!.rpc!.call(WORKBENCH_WINDOW_RPC_CHANNEL, workbenchWindowRpcEndpoint('metrics'), {
                windowId: windowView.windowId,
                workbenchId: windowView.workbenchId,
                snapshot: foundation.runtimeMetrics.getSnapshot(),
              }, AbortSignal.timeout(3_000))
            } catch { /* metrics are diagnostic and must never affect Workbench operation */ }
            finally { pendingMetrics = false }
          }
          void reportMetrics()
          const timer = window.setInterval(() => { void reportMetrics() }, 1_000)
          stopRuntimeMetrics = () => { window.clearInterval(timer) }
        }
      }
      else {
        mountBrowserWorkbenchStatusShell('目标工作台未能安全挂载。DSH 页面内容已隔离，请从客户端重新打开工作台。')
        await reportBrowserWorkbenchFailed(ctx as never, windowView, 'browser-view-mount-timeout')
      }
    })().catch(async error => {
      const diagnostic = error instanceof Error ? error.message : String(error)
      mountBrowserWorkbenchStatusShell(`Workbench 浏览器窗口启动失败：${diagnostic}。请从客户端重新打开工作台。`)
      await reportBrowserWorkbenchFailed(ctx as never, windowView, 'browser-view-enter-failed')
    })
  }
  ctx.effect?.(() => {
    // Invalidate the Host projection after native management and reconnects.
    // This does not republish identities or hot-activate optional Modules.
    const refresh = () => { void moduleManager.refresh?.() }
    const offNative = ctx.remote?.$on('plugin-manager/changed', refresh)
    const offReset = ctx.on?.('connection/reset', refresh)
    return () => { offNative?.(); offReset?.() }
  }, 'workbench-core: native plugin inventory')
  ctx.effect?.(() => () => { runtime.dispose() }, 'workbench-core: client runtime')

  const provide = ctx.provide?.bind(ctx)
  provide?.(WORKBENCH_CORE_RUNTIME_SERVICE_NAME, runtime)
  provide?.('workbenchModuleManager', moduleManager)
  provide?.('workbenchRuntimeMetrics', foundation.runtimeMetrics)
  void moduleManager.resumeRestart?.().then(() => moduleManager.refresh?.())
  provide?.('workbenchCoreClientRuntime', Object.freeze({
    state: 'modules-ready' as const,
    canEnterWorkbench: true,
    emptyState: undefined,
  }))
}
