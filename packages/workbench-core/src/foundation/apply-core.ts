import { installFloatingExitGuard } from '../client/floating-exit-guard.ts'
import { createDistributionClient } from '../distribution-contract.ts'
import { createWorkbenchPackageService } from './workbench-package-service.ts'
import { createWorkbenchLayoutPackageService } from './layout-package-service.ts'
import { createLayoutImportJournal } from '../layout-import-journal.ts'
import { scopeSettingsSnapshot, settingsTargetWritable, DESKTOP_SETTINGS_CONTEXT } from './settings-context.ts'
/**
 * Core-only browser composition. The frozen Frame is owned by Core, while
 * inner-page editors arrive only from a separately installed Module after a
 * DSH restart. This file intentionally contains no Dynamic Loader bridge.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-connection/client'
import { createFloatingWorkspaceRuntime } from '../client/floating-workspace-runtime.ts'
import { connectFloatingUiPreferences } from '../client/floating-ui-preferences.ts'
import { installNativeAutomaticIsolation } from '../client/native-automatic-isolation.tsx'
import { closeWorkbenchNative } from '../client/native-sidebar-area-editor.tsx'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type { WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-api-terminal-controller/client'
import type {} from '@deepseek-ai/dsh-client-ui-theme/client'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type { ContextMenus } from '@deepseek-ai/dsh-client-ui-context-menu/client'
import { createNativePluginNavigation } from '../client/native-plugin-navigation.ts'
import { createNativePluginsPanelVisibility, watchNativePluginsPanel } from '../client/native-main-panel-navigation.ts'
import { createAreaSessionCreator } from '../client/session-placement.ts'
import { createWorkbenchSettingsScope, type SettingsScope } from '../client/workbench-settings-contracts.ts'
import type { WorkbenchEditorCatalog, WorkbenchEditorCatalogRow } from './catalog.ts'
import { decodeWorkbenchSettingsV4, type WorkbenchSettingsV4 } from './persistence.ts'
import { createProjectNeutralFrameSettings, type WorkbenchDirectoryContextPatch } from './frame-settings-adapter.ts'
import type { SidebarCompatibilityProbe } from './WorkbenchFrame.tsx'
import { WorkbenchCoreSettingsSection } from './WorkbenchCoreSettingsSection.tsx'
import { WorkbenchCoreInnerPage, type WorkbenchCoreInnerPageInjection } from './WorkbenchCoreInnerPage.tsx'
import { WorkbenchCoreEntryAction } from './WorkbenchCoreEntryAction.tsx'
import { createWorkbenchModeController, type WorkbenchModeControllerV1 } from '../mode-controller.ts'
import type { WorkbenchModuleManagerV1 } from '../module-manager.ts'
import { createWorkbenchExtensionRegistryV1 } from '../client/workbench-extension-registry.ts'
import { readDshExtensionInventoryV1 } from '../client/read-dsh-extension-inventory.ts'
import { WORKBENCH_CORE_VERSION, WORKBENCH_DSH_GENERATION } from '../release-compatibility.ts'
import type { WorkbenchCoreRuntimeV1 } from '../core-runtime.ts'
import { createWorkbenchOfflinePackageService } from '../offline-package-service.ts'
import type { WorkbenchSidebarHostActionsV1 } from './workbench-sidebar-browser.tsx'
import { createWorkbenchFooterHost } from './workbench-footer-host.tsx'
import { createWorkbenchOfficialAreaEditors } from '../client/official-area-editors.tsx'
import { registerWorkbenchOfficialAreaEditors } from '../client/official-area-registrar.ts'
import {
  createWorkbenchCreatorInspectProvider,
  type WorkbenchCreatorInspectRegistryLike,
} from '../client/workbench-creator-inspect.ts'
import { WorkbenchControlPlane, WORKBENCH_CONTROL_PLANE_SERVICE_NAME } from './workbench-control-plane.ts'
import { createWorkbenchRuntimeMetrics, type WorkbenchRuntimeMetricsSnapshotV1 } from './workbench-runtime-metrics.ts'
import type { WorkbenchConversationInteractionPolicyV1 } from '../workbench-interaction-policy.ts'
import {
  resolveWorkbenchWindowController,
  WORKBENCH_WINDOW_CONTROLLER_SERVICE_NAME,
} from '../client/workbench-window-controller.ts'
import { createBrowserWindowController } from '../client/browser-window-controller.ts'
import { requestBrowserWorkbenchReclaim } from '../client/resolve-browser-window-view.ts'
import { readWorkbenchWindowView } from '../client/workbench-window-view.ts'
import { WorkbenchWindowRoot } from './WorkbenchWindowRoot.tsx'
import { workbenchEditorCatalogRowFromSlotEntry } from '../client/workbench-editor-slot-catalog.ts'
import { createWorkbenchToolGatewayManager, type WorkbenchToolGatewayManagerV1 } from '../tool-gateway.ts'
import type { WorkbenchToolUsageServiceV1 } from '../tool-usage.ts'
import { createWorkbenchShareController } from '../client/workbench-share-controller.ts'
import { createConversationTabStatusSource } from '../client/conversation-tab-status.ts'
import { isWorkbenchShareGuestPage } from '../client/workbench-share-guest.ts'
import { createRemoteBayAgentController } from '../client/bay-agent-controller.ts'
import type { BayAgentControllerV1 } from './workbench-bay-agent-work.ts'
import { BAY_AGENT_DRAFT_ROUTE } from '../bay-agent-contract.ts'
import { createRemoteWorkbenchAiDraftGenerator } from './workbench-ai.ts'

export const inject = [
  'connection', 'slots', 'layout', 'sessions', 'workspaces', 'uiWorkspace', 'uiSession', 'configForms', 'modules', 'locale', 'conversation',
  'remote', 'remote.session', 'remote.settings', 'remote.agentPresets', 'remote.pluginInventory', 'remote.pluginManager', 'remote.workspaceFiles', 'webTerminals', 'sidebarRight', 'sidebarRightTabs', 'shortcuts', 'resources', 'contextMenus', 'theme', 'uiConversation', 'cordisInspect',
] as const

function editorCatalogFor(ctx: ClientContext): WorkbenchEditorCatalog {
  let rootVersion = -1
  let sessionVersion = -1
  let rows: readonly WorkbenchEditorCatalogRow[] = []
  return {
    getSnapshot: () => {
      const nextRootVersion = ctx.slots.getVersion('workbench.editor.root')
      const nextSessionVersion = ctx.slots.getVersion('workbench.editor.session')
      if (rootVersion !== nextRootVersion || sessionVersion !== nextSessionVersion) {
        rootVersion = nextRootVersion
        sessionVersion = nextSessionVersion
        const entries = (scope: 'root' | 'session') => ctx.slots.entriesOfSlot(`workbench.editor.${scope}`)
          .map(entry => workbenchEditorCatalogRowFromSlotEntry(entry, scope))
        rows = [...entries('session'), ...entries('root')]
          .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id))
          .map(({ order: _order, ...row }) => row)
      }
      return rows
    },
    subscribe(listener) {
      const offRoot = ctx.slots.subscribe('workbench.editor.root', listener)
      const offSession = ctx.slots.subscribe('workbench.editor.session', listener)
      return () => { offRoot(); offSession() }
    },
  }
}

function unwrapRemoteResult<T>(result: unknown, operation: string): T {
  if (typeof result === 'object' && result !== null && 'ok' in result) {
    const remote = result as { ok: boolean; value?: T; error?: { message?: string } }
    if (remote.ok) return remote.value as T
    throw new Error(remote.error?.message ?? `${operation} failed`)
  }
  return result as T
}

/** The frozen Workspace Browser receives only official Runtime operations. */
function sidebarHostActionsFor(ctx: ClientContext): WorkbenchSidebarHostActionsV1 {
  return {
    sessionStatus: ctx.uiSession.sessionStatus,
    searchSessions: async (query, signal) => unwrapRemoteResult(await ctx.sessions.search(query, signal), 'session search'),
    searchResultLimit: ctx.sessions.searchResultLimit,
    renameSession: (sessionId, title) => ctx.sessions.using(sessionId, { source: 'controllerOperation' }, async reference => {
      unwrapRemoteResult(await reference.binding.session.rename(title), 'session rename')
    }),
    forkSession: sessionId => ctx.sessions.fork({ sessionId, increaseTitle: true }),
    renameWorkspace: async (workspaceId, title) => { await ctx.workspaces.rename(workspaceId, title) },
    deleteWorkspace: workspaceId => ctx.workspaces.delete(workspaceId),
    insertWorkspaceBefore: (workspaceId, beforeWorkspaceId) => ctx.workspaces.insertBefore(workspaceId, beforeWorkspaceId),
    archiveSession: sessionId => ctx.workspaces.archiveSession(sessionId),
    unarchiveSession: sessionId => ctx.workspaces.unarchiveSession(sessionId),
    insertSessionBefore: async (workspaceId, sessionId, beforeSessionId) => { await ctx.workspaces.insertSessionBefore(workspaceId, sessionId, beforeSessionId) },
    createWorkspace: input => ctx.workspaces.create(input),
    pickDirectory: () => ctx.uiWorkspace.pickDirectory(),
  }
}

/** Register the embedded Core foundation without claiming an official owner. */
export function applyWorkbenchCoreFoundation(
  ctx: ClientContext,
  modeController: WorkbenchModeControllerV1 = createWorkbenchModeController(),
  moduleManager?: WorkbenchModuleManagerV1,
  runtime?: WorkbenchCoreRuntimeV1,
): { flush: () => Promise<boolean>; runtimeMetrics: { getSnapshot(): WorkbenchRuntimeMetricsSnapshotV1 }; floatingRuntime: ReturnType<typeof createFloatingWorkspaceRuntime>; bayAgent?: BayAgentControllerV1 } {
  const runtimeMetrics = createWorkbenchRuntimeMetrics()
  const floatingRuntime = createFloatingWorkspaceRuntime()
  if (!isWorkbenchShareGuestPage()) ctx.effect(() => installNativeAutomaticIsolation(ctx, modeController), 'workbench: automatic review isolation')
  floatingRuntime.setCleanup(closeWorkbenchNative)
  const decode = (value: unknown): WorkbenchSettingsV4 | undefined => {
    const currentSessionId = Object.values(ctx.sessions.list.getSnapshot().byId).find(row => (row.retainedBy.mainView ?? 0) > 0)?.id
    return decodeWorkbenchSettingsV4(value, {
      ...(currentSessionId === undefined ? {} : { currentSessionId }),
      workspaces: ctx.workspaces.list.getSnapshot().items.map(workspace => ({
        workspaceId: workspace.workspaceId,
        name: workspace.title,
        sessionIds: workspace.sessionIds,
      })),
  })
  }
  const suppliedToolUsageService = (ctx as unknown as { get?: (name: string, strict?: boolean) => unknown }).get?.('workbenchToolUsageService') as WorkbenchToolUsageServiceV1 | undefined
  // DSH 0.1.7 renamed settingsScope.bind() to configForms.get(). Keep the
  // decoder and Workbench revision semantics local to this adapter, while
  // retaining a lazy 0.1.6 fallback for isolated unit fixtures and rollback.
  const compatible = ctx as ClientContext & {
    configForms?: { get<T>(entryId: string): {
      getSnapshot(): { status: 'loading' | 'ready' | 'unavailable'; value: unknown; revision: number | undefined; writable: boolean; base?: unknown; user?: unknown }
      subscribe(listener: () => void): () => void
      set(field: string, value: unknown): Promise<boolean>
      unset(field: string): Promise<boolean>
      mutate(ops: readonly unknown[], expectedRevision?: number): Promise<boolean>
    } }
    settingsScope?: { bind<T>(options: { namespace: string; decode: (value: unknown) => T }): SettingsScope<T> }
  }
  const settingsNamespace = 'workbench-layout'
  const configForm = compatible.configForms?.get<unknown>(settingsNamespace)
  const legacySettings = configForm === undefined
    ? compatible.settingsScope?.bind<WorkbenchSettingsV4>({ namespace: settingsNamespace, decode: value => decode(value) as WorkbenchSettingsV4 })
    : undefined
  if (configForm === undefined && legacySettings === undefined) throw new Error('Workbench settings service is unavailable')
  let configFormSnapshot: {
    status: 'loading' | 'ready' | 'unavailable'
    value: unknown
    revision: number | undefined
    writable: boolean
    base?: unknown
    user?: unknown
  } | undefined
  let workbenchConfigSnapshot: ReturnType<SettingsScope<WorkbenchSettingsV4>['getSnapshot']> | undefined
  const sourceSettings: SettingsScope<WorkbenchSettingsV4> = configForm === undefined
    ? legacySettings!
    : {
      getSnapshot: () => {
        const snapshot = configForm.getSnapshot()
        if (configFormSnapshot !== undefined
          && configFormSnapshot.status === snapshot.status
          && configFormSnapshot.value === snapshot.value
          && configFormSnapshot.revision === snapshot.revision
          && configFormSnapshot.writable === snapshot.writable
          && configFormSnapshot.base === snapshot.base
          && configFormSnapshot.user === snapshot.user) return workbenchConfigSnapshot!
        configFormSnapshot = snapshot
        workbenchConfigSnapshot = { ...snapshot, mode: 'host', value: snapshot.value === undefined ? undefined : decode(snapshot.value) }
        return workbenchConfigSnapshot
      },
      subscribe: listener => configForm.subscribe(listener),
      set: (field, value) => configForm.set(field, value),
      unset: field => configForm.unset(field),
      mutate: (ops, expectedRevision) => configForm.mutate(ops, expectedRevision),
    }
  const settings = createWorkbenchSettingsScope(sourceSettings, ctx.remote, () => undefined)
  floatingRuntime.policy = () => sourceSettings.getSnapshot().value?.interactionPolicy
  ctx.effect(() => {
    let pending = false
    const migrate = () => {
      const snapshot = sourceSettings.getSnapshot(), raw = configForm?.getSnapshot().value as { interactionPolicy?: { version?: number } } | undefined
      if (pending || !configForm || snapshot.status !== 'ready' || !snapshot.writable || snapshot.revision === undefined || raw?.interactionPolicy?.version === 2 || !snapshot.value?.interactionPolicy) return
      pending = true
      void settings.patch({ operation: 'set', path: ['interactionPolicy'], value: snapshot.value.interactionPolicy, expectedRevision: snapshot.revision }).finally(() => { pending = false })
    }
    const off = sourceSettings.subscribe(migrate); migrate(); return off
  }, 'workbench: interaction preference migration')
  const suppliedToolGateway = (ctx as unknown as { get?: (name: string, strict?: boolean) => unknown }).get?.('workbenchToolGateway') as WorkbenchToolGatewayManagerV1 | undefined
  const toolGateway = suppliedToolGateway ?? createWorkbenchToolGatewayManager({
    activeWorkbenchId: () => ((settings.getSnapshot().value as WorkbenchSettingsV4 | undefined)?.activeWorkbenchId ?? 'main'),
    readPolicy: workbenchId => (settings.getSnapshot().value as WorkbenchSettingsV4 | undefined)?.toolGatewayPolicies?.[workbenchId],
    persistPolicy: async (workbenchId, policy) => {
      const snapshot = settings.getSnapshot()
      if (snapshot.status !== 'ready' || !snapshot.writable || snapshot.revision === undefined) throw new Error('Workbench Tool Gateway policy cannot be saved because Settings is unavailable')
      const result = await settings.patch({ operation: 'set', path: ['toolGatewayPolicies', workbenchId], value: policy, expectedRevision: snapshot.revision })
      if (result.status !== 'committed') throw new Error('Workbench Tool Gateway policy save failed')
    },
  })
  if (suppliedToolGateway === undefined) (ctx as unknown as { provide?: (name: string, value: unknown) => unknown }).provide?.('workbenchToolGateway', toolGateway)
  let suppliedWindowController: unknown
  try {
    suppliedWindowController = (ctx as unknown as { get?: (name: string, strict?: boolean) => unknown })
      .get?.(WORKBENCH_WINDOW_CONTROLLER_SERVICE_NAME, false)
  } catch { /* DSH rc.3 may omit the optional native window lifecycle service. */ }
  // DSH exposes Connection as an injected Cordis service. Some client
  // contexts also mirror it on `ctx.connection`, while the plugin entry only
  // guarantees the service lookup. Resolve both shapes so the browser carrier
  // is not silently downgraded to `supported: false` on desktop.
  const resolveClientConnection = () => {
    const directConnection = (ctx as unknown as {
      connection?: Partial<import('@deepseek-ai/dsh-client-connection/client').ConnectionHandle>
    }).connection
    if (directConnection !== undefined) return directConnection
    try {
      return ((ctx as unknown as { get?: (name: string, strict?: boolean) => unknown })
        .get?.('connection', false) as Partial<import('@deepseek-ai/dsh-client-connection/client').ConnectionHandle> | undefined)
    } catch { return undefined }
  }
  const resolveConnectionRpc = () => resolveClientConnection()?.rpc
  const connectionRpc = resolveConnectionRpc()
  const shareGuest = isWorkbenchShareGuestPage()
  const shareController = shareGuest ? undefined
    : createWorkbenchShareController(connectionRpc === undefined ? {} : { rpc: connectionRpc })
  if (shareController !== undefined) {
    ctx.effect?.(() => {
      const refreshConnection = () => { shareController.setRpc(resolveConnectionRpc()) }
      const offReset = ctx.on?.('connection/reset', refreshConnection)
      refreshConnection()
      return () => { offReset?.(); shareController.dispose() }
    }, 'workbench: LAN share controller')
  }
  const browserController = suppliedWindowController === undefined
    ? createBrowserWindowController({
      rpc: connectionRpc,
      floating: { snapshot: id => floatingRuntime.snapshotHandoff(id), restore: (id, value) => floatingRuntime.restoreHandoff(id, value),
        incomplete: id => floatingRuntime.patch(id, { error: '浏览器未完成临时标签交接，已保留此端原有内容。请使用“收回到 DSH 客户端”完成交接。', expanded: true }) },
    }) : undefined
  if (browserController !== undefined) {
    ctx.effect(() => {
      const refreshConnection = () => { browserController.setRpc(resolveConnectionRpc()) }
      const offReset = ctx.on?.('connection/reset', refreshConnection)
      refreshConnection()
      return () => { offReset?.(); browserController.dispose() }
    }, 'workbench: browser window controller')
  }
  const windowController = resolveWorkbenchWindowController(suppliedWindowController ?? browserController)
  const windowView = readWorkbenchWindowView()
  let companionControl = true
  if (windowView) ctx.effect(() => {
    const revoke = (event: Event) => {
      const state = (event as CustomEvent<{ state?: string }>).detail?.state
      if (state === 'requested' || state === 'reclaimed') { companionControl = false; floatingRuntime.setSurface(false) }
    }
    window.addEventListener('workbench-browser-reclaim', revoke)
    return () => window.removeEventListener('workbench-browser-reclaim', revoke)
  }, 'workbench: suspend temporary interactions on control handoff')
  floatingRuntime.hasControl = id => windowView ? companionControl && windowView.workbenchId === id : settingsTargetWritable(DESKTOP_SETTINGS_CONTEXT, id, windowController)
  floatingRuntime.validBinding = binding => {
    const sessions = ctx.sessions.list.getSnapshot().byId
    const workspaces = ctx.workspaces.list.getSnapshot()
    return !!sessions[binding.sessionId as keyof typeof sessions] && !workspaces.archivedSessionIds.includes(binding.sessionId as never)
      && (!binding.workspaceId || workspaces.items.some(row => row.workspaceId === binding.workspaceId && row.sessionIds.includes(binding.sessionId as never)))
  }
  if (!shareGuest) ctx.effect(() => connectFloatingUiPreferences(floatingRuntime, windowView !== undefined), 'workbench: floating UI preferences')
  let contextPatch: WorkbenchDirectoryContextPatch | undefined
  const { settings: frameSettings, directory } = createProjectNeutralFrameSettings(settings,
    windowView === undefined
      ? {
        isBrowserOwned: id => !settingsTargetWritable(DESKTOP_SETTINGS_CONTEXT, id, windowController),
        contextPatch: input => contextPatch === undefined ? Promise.resolve({ status: 'unavailable' as const }) : contextPatch(input),
      }
      : {
        workbenchId: windowView.workbenchId,
        contextPatch: input => contextPatch === undefined ? Promise.resolve({ status: 'unavailable' as const }) : contextPatch(input),
      })
  for (const operation of ['archive', 'remove'] as const) {
    const original = directory[operation].bind(directory)
    directory[operation] = async id => {
      const temporary = [...floatingRuntime.instances.values()].filter(row => row.workbenchId === id && row.location === 'floating')
      if (!await floatingRuntime.guardWorkbench(id)) return { status: 'unavailable' }
      if (temporary.length && !globalThis.confirm('此工作台还有 ' + temporary.length + ' 个临时内页。继续后将关闭，重启无法恢复；未接入保存保护的扩展可能有未保存内容。是否继续？')) return { status: 'unavailable' }
      const result = await original(id)
      if (result.status === 'committed') floatingRuntime.disposeWorkbench(id)
      return result
    }
  }
  ctx.effect(() => installFloatingExitGuard(floatingRuntime), 'workbench: temporary content exit protection')
  const slotEditorCatalog = editorCatalogFor(ctx)
  const extensionRegistry = createWorkbenchExtensionRegistryV1({
    catalog: slotEditorCatalog,
    settings: sourceSettings,
    coreEditorIds: [
      'workbench.conversation.start', 'workbench.conversation', 'workbench.agent-trajectory',
      'workbench.workspace-files', 'workbench.document-preview', 'workbench.browser',
      'workbench.terminal', 'workbench.plan', 'workbench.changes-review',
      'workbench.subagent-chat', 'workbench.schedule-task', 'workbench.guide',
    ],
    coreVersion: WORKBENCH_CORE_VERSION,
    dshGeneration: WORKBENCH_DSH_GENERATION,
    readDshInventory: () => readDshExtensionInventoryV1(ctx.remote),
    subscribeDshChanges: listener => ctx.remote.$on('plugin-manager/changed', listener),
    subscribeConnectionReset: listener => {
      const off = ctx.on?.('connection/reset', listener)
      return () => { off?.() }
    },
  })
  ctx.effect(() => () => extensionRegistry.dispose(), 'workbench: extension registry')
  const editorCatalog = extensionRegistry.catalog
  floatingRuntime.canUseEditor = (id, editorId) => {
    const row = directory.getSnapshot().rows.find(row => row.workbenchId === id)
    return !!row && row.archivedAt === undefined && editorCatalog.getSnapshot().some(editor => editor.id === editorId)
  }
  ctx.effect(() => extensionRegistry.subscribe(floatingRuntime.invalidate), 'workbench: retained editor authorization')
  const nativePluginsPanelVisible = createNativePluginsPanelVisibility()
  const panelInfo = (ctx as unknown as {
    layout?: { panelInfo?: HostObservable<{ readonly activePanelId: MainPanelId | null }> }
  }).layout?.panelInfo
  if (panelInfo !== undefined) {
    ctx.effect(() => watchNativePluginsPanel({
      panelInfo,
      mode: modeController,
      pluginsPanelId: 'plugins' as MainPanelId,
      visibility: nativePluginsPanelVisible,
      selectConversationPanel: () => ctx.layout.selectPanel(null),
    }), 'workbench: native Plugins panel handoff')
  } else {
    ctx.effect(() => watchNativePluginsPanel({
      panelInfo: undefined,
      mode: modeController,
      pluginsPanelId: 'plugins' as MainPanelId,
      visibility: nativePluginsPanelVisible,
      selectConversationPanel: () => ctx.layout.selectPanel(null),
    }), 'workbench: native Plugins panel DOM handoff')
  }
  const creatorInspect = createWorkbenchCreatorInspectProvider({
    settings: sourceSettings,
    editorCatalog,
    sessions: ctx.sessions,
    workspaces: ctx.workspaces,
  })
  let controlPlane: WorkbenchControlPlane
  let suppliedControlPlane: unknown
  try {
    suppliedControlPlane = (ctx as unknown as { get(name: string, strict?: boolean): unknown })
      .get(WORKBENCH_CONTROL_PLANE_SERVICE_NAME, false)
  } catch { /* The first Core instance owns the local Control Plane service. */ }
  if (suppliedControlPlane !== undefined) {
    controlPlane = suppliedControlPlane as WorkbenchControlPlane
  } else {
    controlPlane = new WorkbenchControlPlane({
      settings: {
        getSnapshot: settings.getSnapshot,
        patch: async operation => {
          const result = await settings.patch(operation)
          if (result.status === 'committed') return { status: 'committed' as const, revision: result.revision }
          if (result.status === 'conflict') return {
            status: 'conflict' as const,
            ...(result.actualRevision === undefined ? {} : { actualRevision: result.actualRevision }),
          }
          return { status: 'unavailable' as const }
        },
      },
      editors: editorCatalog,
      createSession: async input => {
        if (input.workspaceId === undefined) throw new Error('Control Plane Session creation requires a Workspace')
        const sessionId = await ctx.sessions.create({
          workspaceId: input.workspaceId as WorkspaceId,
          ...(input.agentPreset === undefined ? {} : { agentPreset: input.agentPreset }),
        })
        return { target: { workspaceId: input.workspaceId, sessionId }, reusedBlank: false }
      },
    })
    ;(ctx as unknown as { provide?: (name: string, value: unknown) => unknown }).provide?.(WORKBENCH_CONTROL_PLANE_SERVICE_NAME, controlPlane)
  }
  const bayAgent = createRemoteBayAgentController(windowView?.workbenchId ?? settings.getSnapshot().value?.activeWorkbenchId ?? 'main', fetch, () => ctx.sessions.refresh())
  const aiDraftGenerator = createRemoteWorkbenchAiDraftGenerator({
    route: BAY_AGENT_DRAFT_ROUTE,
    fetcher: fetch,
    getSelection: workbenchId => settings.getSnapshot().value?.workbenches[workbenchId]?.workbenchAi,
  })
  ;(ctx as unknown as { provide?: (name: string, value: unknown) => unknown }).provide?.('bayAgentController', bayAgent)
  ctx.effect(() => {
    const sync = () => {
      const workbenchId = windowView?.workbenchId ?? settings.getSnapshot().value?.activeWorkbenchId
      if (workbenchId === undefined || !settings.getSnapshot().value?.workbenches[workbenchId] || isWorkbenchShareGuestPage()) return
      bayAgent.setWorkbenchId(workbenchId)
    }
    const off = settings.subscribe(sync)
    sync()
    return off
  }, 'workbench: persistent bay-agent main session')
  ctx.effect(() => () => bayAgent.dispose(), 'workbench: bay-agent controller')
  contextPatch = async input => {
    const result = await controlPlane.context.patch({
      scope: input.scope,
      workbenchId: input.workbenchId,
      ...(input.areaId === undefined ? {} : { areaId: input.areaId }),
      writer: 'human',
      section: 'human',
      expectedRevision: input.expectedRevision,
      patch: input.patch,
    })
    if (result.status === 'committed') return { status: 'committed', revision: result.settingsRevision }
    if (result.status === 'conflict') return {
      status: 'conflict' as const,
      expectedRevision: input.expectedRevision,
      actualRevision: result.currentSettingsRevision,
    }
    if (result.status === 'unavailable') return { status: 'unavailable' as const }
    if (result.reason === 'workbench-not-found' || result.reason === 'area-not-found') {
      return { status: 'rejected' as const, reason: 'not-found' as const }
    }
    if (result.reason === 'workbench-archived' || result.reason === 'area-archived') {
      return { status: 'rejected' as const, reason: 'archived' as const }
    }
    return { status: 'unavailable' as const }
  }
  let inspectRegistry: WorkbenchCreatorInspectRegistryLike | undefined
  try {
    inspectRegistry = (ctx as unknown as { get(name: string): unknown }).get('cordisInspect') as WorkbenchCreatorInspectRegistryLike | undefined
  } catch { /* Workbench can run without the optional Creator host bridge. */ }
  if (inspectRegistry !== undefined && typeof inspectRegistry.register === 'function') {
    ctx.effect(() => inspectRegistry.register(creatorInspect), 'workbench: creator inspect provider')
  }
  const officialAreaEditors = createWorkbenchOfficialAreaEditors(ctx)
  // Register the renderer entries before the first Workbench surface is
  // rendered. The slot declarations themselves may still be deferred by the
  // DSH slot service, but the registration must not wait for a later effect
  // turn or the Area would show only a stale tab label and fallback body.
  const disposeOfficialAreaEditors = registerWorkbenchOfficialAreaEditors(ctx, officialAreaEditors)
  ctx.effect(() => disposeOfficialAreaEditors, 'workbench: official DSH Area editors')
  const settingsContext = windowView === undefined ? DESKTOP_SETTINGS_CONTEXT : { mode: 'browser-workbench' as const, workbenchId: windowView.workbenchId }
  let scopedSource: ReturnType<typeof settings.getSnapshot> | undefined
  let scopedSnapshot: ReturnType<typeof settings.getSnapshot>
  const settingsView = { subscribe: settings.subscribe, getSnapshot: () => {
    const snapshot = settings.getSnapshot()
    if (snapshot !== scopedSource) { scopedSource = snapshot; scopedSnapshot = scopeSettingsSnapshot(snapshot, settingsContext) }
    return scopedSnapshot
  } }
  const settingsPage = {
    ...(windowView === undefined ? { distributionPackage: createWorkbenchPackageService({version:4,client: createDistributionClient(), settings, directory, editors: editorCatalog, rawEditors: slotEditorCatalog, registry: extensionRegistry, canExport: id => settingsTargetWritable(settingsContext, id, windowController), canImport: () => settingsContext.mode === 'desktop'}) } : {}),
    layoutPackage: createWorkbenchLayoutPackageService({ settings, directory, editors: editorCatalog, journal: createLayoutImportJournal(),
      canExport: id => settingsTargetWritable(settingsContext, id, windowController), canImport: () => settingsContext.mode === 'desktop' }),
    settingsContext,
    settingsSource: settingsView,
    windowController,

    editorCatalog,
    nativePluginNavigation: createNativePluginNavigation({
      mode: modeController,
      available: () => typeof ctx.layout?.selectPanel === 'function' && ctx.slots.entriesOfSlot('main').some(entry => entry.options.key === 'plugins'),
      subscribe: listener => ctx.slots.subscribe('main', listener),
      selectPanel: () => ctx.layout.selectPanel('plugins' as MainPanelId),
    }),
    ...(windowView === undefined ? { sessionList: ctx.sessions.list, workspaceList: ctx.workspaces.list } : {}),
    workbenchDirectory: directory,
     loadModelCatalog: async (): Promise<import('@deepseek-ai/dsh-api-session-controller').ModelCatalog> => unwrapRemoteResult<import('@deepseek-ai/dsh-api-session-controller').ModelCatalog>(await ctx.remote.session.modelCatalog(), 'model catalog'),
    ...(windowView === undefined ? { extensionRegistry } : {}),
    updateInteractionPolicy: async (policy: WorkbenchConversationInteractionPolicyV1) => {
      if (windowView !== undefined) return false
      const result = await settings.patch({ operation: 'set', path: ['interactionPolicy'], value: policy })
      return result.status === 'committed'
    },
    patchInteractionPolicy: async (key: string, value: unknown) => {
      if (windowView !== undefined) return false
      const result = await settings.patch({ operation: 'set', path: key === 'unknownResource' || key === 'showSessionAccentFrames' || key === 'tabFontSize' || key === 'showTabCloseButtons' ? ['interactionPolicy', key] : ['interactionPolicy', 'conversationResources', key], value })
      return result.status === 'committed'
    },
    ...(moduleManager === undefined ? {} : { moduleManager }),
    ...(runtime === undefined ? {} : { offlinePackage: createWorkbenchOfflinePackageService({ settings, directory, editorCatalog, runtime }) }),
  }
  const sidebarCompatibility: SidebarCompatibilityProbe = {
    getSnapshot: () => ctx.slots.entriesOfSlot('sidebar')[0] === undefined
      ? '当前没有可用的 Sidebar owner；固定导航与设置入口会保持为空，直到 owner 注册。'
      : undefined,
    subscribe: listener => ctx.slots.subscribe('sidebar', listener),
  }

  const footer = createWorkbenchFooterHost(ctx)
  const conversationStatus = createConversationTabStatusSource({
    sessions: ctx.sessions, interactions: ctx.uiSession.sessionStatus,
    generation: resolveClientConnection()?.generation ?? { getSnapshot: () => undefined, subscribe: () => () => {} },
  })
  ctx.effect(() => () => conversationStatus.dispose(), 'workbench: conversation tab status')
  ctx.effect(() => footer.dispose, 'workbench: private footer host')
  // Use the public root shadowing contract only in our dedicated document.
  // The official Desktop document keeps its original root and owners.
  if (windowView !== undefined) {
    ctx.effect(() => ctx.slots.register({
      name: 'root', priority: -100,
      children: { 'workbench.window.surface': { kind: 'list', scope: 'root' } },
    }, WorkbenchWindowRoot), 'workbench: companion document composition')
  }
  const surfaceSlot = windowView === undefined ? 'shell.overlay' : 'workbench.window.surface'
  ctx.slots.inject(surfaceSlot, () => ctx.slots.register({
    name: surfaceSlot,
    id: 'dsh-workbench-inner-page',
    order: 20,
    children: {
      'workbench.editor.root': { kind: 'list', scope: 'root' },
      'workbench.editor.session': { kind: 'list', scope: 'root' },
    },
    inject: (): WorkbenchCoreInnerPageInjection => ({
      modeController,
      bayAgent,
      conversationStatus,
      generateContextDraft: aiDraftGenerator.generateContextDraft,
      floatingRuntime,
      toolGateway,
      ...(suppliedToolUsageService === undefined ? {} : { toolUsageService: suppliedToolUsageService }),
      extensionRegistry,
      browserView: windowView !== undefined,
      ...(windowView === undefined ? {} : { browserWorkbenchId: windowView.workbenchId }),
      ...(windowView === undefined || shareGuest ? {} : {
        requestBrowserReclaim: (workbenchId: string) => workbenchId === windowView.workbenchId
          ? requestBrowserWorkbenchReclaim(ctx as never, windowView)
          : Promise.resolve(false),
      }),
      nativePluginsPanelVisible,
      workbenchSettings: settings,
      settingsPage,
      renderFooterActions: footer.render,
      editorCatalog,
      sidebarCompatibility,
      settings: frameSettings,
      workbenchDirectory: directory,
      windowController,
      ...(shareController === undefined ? {} : { shareController }),
      runtimeMetrics,
      connectWorkspace: async (workspaceId, options) => {
        const previous = new Set(ctx.sessions.list.getSnapshot().ids)
        const sessionId = await ctx.uiWorkspace.connectWorkspace(workspaceId as WorkspaceId, options)
        return { target: { workspaceId, sessionId }, reusedBlank: previous.has(sessionId) }
      },
      createWorkspaceSession: createAreaSessionCreator({
        create: (workspaceId, options) => ctx.sessions.create({
          workspaceId: workspaceId as WorkspaceId,
          ...(options?.agentPreset === undefined ? {} : { agentPreset: options.agentPreset }),
        }),
      }),
      createWorkspace: path => ctx.workspaces.create({ path }),
      pickDirectory: () => ctx.uiWorkspace.pickDirectory(),
      sidebarHostActions: sidebarHostActionsFor(ctx),
      contextMenus: ctx.contextMenus as ContextMenus,
      openOfficialSession: (sessionId, assertClaim) => modeController.exit(() => {
        assertClaim()
        if (!ctx.sessions.list.getSnapshot().byId[sessionId as SessionId]) throw new Error('此对话已不可用')
        ctx.uiWorkspace.openSession(sessionId as SessionId)
      }),
    }),
  }, WorkbenchCoreInnerPage))

  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action',
    id: 'dsh-workbench-enter-mode',
    order: 20,
    inject: () => ({ modeController }),
  }, WorkbenchCoreEntryAction))

  // Keep the migrated management page and its revision-aware directory on
  // the official Settings seam; Module Manager is an additional projection.
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'workbench',
    order: 30,
    label: '工作台',
    inject: () => ({
      hooks: { workbenchSettings: settingsView },
      ...settingsPage,
    }),
  }, WorkbenchCoreSettingsSection))
  return {
    floatingRuntime,
    bayAgent,
    flush: () => directory.flushBeforeLifecycleTransition!(),
    runtimeMetrics: Object.freeze({ getSnapshot: runtimeMetrics.getSnapshot }),
  }
}
