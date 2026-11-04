import { installLayoutImportJournalRoute } from './host-layout-import-journal.ts'
import { installDistributionRoutes } from './host-distribution-route.ts'
export * from './module-contract.ts'
export {
  isWorkbenchExtensionDeclarationV1,
  validateWorkbenchExtensionDeclarationV1,
  workbenchExtensionDeclarationFailureV1,
  type WorkbenchExtensionDeclarationV1,
  type WorkbenchExtensionProviderDiagnosticV1,
  type WorkbenchExtensionProviderDiagnosticCodeV1,
  type WorkbenchExtensionProviderResolutionV1,
} from './workbench-extension-access.ts'
export * from './workbench-interaction-policy.ts'
export * from './release-compatibility.ts'
export * from './module-registry.ts'
export * from './composition-package.ts'
export * from './install-coordinator.ts'
export * from './contributions.ts'
export * from './module-catalog.ts'
export * from './install-plan.ts'
export * from './module-receipt.ts'
export * from './transaction-journal.ts'
export * from './host-adapter.ts'
export * from './signed-catalog.ts'
export * from './module-manager.ts'
export * from './browser-artifact-staging.ts'
export * from './browser-module-install.ts'
export * from './host-module-install-route.ts'
export * from './host-profile-services.ts'
export * from './mode-controller.ts'
export * from './surface-controller.ts'
export * from './core-runtime.ts'
export * from './core-manifest.ts'
export * from './conversation-suite-contract.ts'
export * from './module-identity.ts'
export {
  classifyWorkbenchSourceUpdate,
  compareWorkbenchVersions,
  sameWorkbenchModuleSource,
  validateWorkbenchModuleSource,
  validateWorkbenchModuleSourceRequest,
  type WorkbenchModuleSourceV1 as WorkbenchModuleOriginV1,
  type WorkbenchModuleSourceRequestV1,
  type WorkbenchModuleTrustV1,
  type WorkbenchSourceUpdateDecisionV1,
} from './module-source.ts'
export * from './host-source-resolver.ts'
export * from './restart-contract.ts'
export * from './source-resolution.ts'
export * from './host-direct-source-install-route.ts'
export * from './host-direct-source-service.ts'
export * from './dsh-native-plugin-manager.ts'
export * from './dsh-native-offline-bundle.ts'

import { WORKBENCH_CORE_MANIFEST } from './core-manifest.ts'
import { WORKBENCH_CORE_RUNTIME_SERVICE_NAME, createWorkbenchCoreRuntime } from './core-runtime.ts'
import { installWorkbenchHostSignedCatalogInstallRoute } from './host-module-install-route.ts'
import { installWorkbenchCoreProfileServices } from './host-profile-services.ts'
import { installWorkbenchModuleIdentityRoute } from './host-module-identity-route.ts'
import { installWorkbenchModuleCenterRoutes } from './host-module-center-route.ts'
import { installWorkbenchOfflineImportRoutes } from './host-offline-import-route.ts'
import { installWorkbenchHostDirectSourceInstallRoute } from './host-direct-source-install-route.ts'
import { installWorkbenchDshNativeOfflineBundleRoutes } from './host-native-offline-bundle-route.ts'
import { WorkbenchSettingsSchema, WORKBENCH_SETTINGS_NAMESPACE } from './host-layout-settings.ts'
import { installWorkbenchBrowserWindowController } from './host-browser-window-controller.ts'
import { installWorkbenchCreatorSkillProvider } from './workbench-creator-skill.ts'

/**
 * DSH 0.1.7 projects live Workbench layout state through the plugin Config
 * schema. Marking the envelope volatile keeps it editable through the native
 * SettingsForms/ConfigForm path while the Host still owns profile writes.
 */
export const Config = WorkbenchSettingsSchema.volatile()

export const inject = ['connection', 'pluginManager', 'profileContext', 'pluginPackages', 'credentials', 'sessions', 'sessionController', 'webServer', 'settings', 'skills'] as const

interface WorkbenchCoreHostContextV1 {
  baseUrl?: string
  get?: (name: string, strict?: boolean) => unknown
  inject?: (names: readonly string[], callback: (child: WorkbenchCoreHostContextV1) => unknown) => unknown
  provide?: (name: string, value: unknown) => unknown
  effect?: (handler: () => (() => void) | void, key?: string) => unknown
}

/**
 * Core's Host entry owns Profile installation and startup verification.
 * Its browser entry embeds the Shell, Settings and Module Manager; the
 * optional Conversation Suite activates only after verified restart.
 */
export function apply(ctx: WorkbenchCoreHostContextV1): void {
  const context = ctx
  if (typeof context.provide !== 'function') return
  if (typeof context.get === 'function') {
    try { if (context.get(WORKBENCH_CORE_RUNTIME_SERVICE_NAME) !== undefined) return } catch { /* optional service */ }
  }
  // 0.1.6 exposed settings.register(); 0.1.7 discovers Config from the
  // plugin runtime and exposes it through SettingsForms. Keep the old call
  // optional for the rollback line without making it a 0.1.7 requirement.
  const settings = context.get?.('settings') as { register?: (namespace: string, schema: unknown) => void } | undefined
  settings?.register?.(WORKBENCH_SETTINGS_NAMESPACE, WorkbenchSettingsSchema)
  const disposeCreatorSkill = installWorkbenchCreatorSkillProvider(context.get?.('skills') as never)
  installWorkbenchCoreProfileServices(context as WorkbenchCoreHostContextV1 & { get<T = unknown>(name: string): T | undefined; provide(name: string, value: unknown): unknown })
  const runtime = createWorkbenchCoreRuntime({ core: WORKBENCH_CORE_MANIFEST })
  context.provide(WORKBENCH_CORE_RUNTIME_SERVICE_NAME, runtime)
  const installHostRoutes = (child: WorkbenchCoreHostContextV1) => {
    const routeContext = {
      baseUrl: context.baseUrl,
      // Resolve Connection and WebServer from the same Cordis child. Reading
      // Connection from the parent can return undefined in DSH Desktop even
      // though it is declared by this plugin.
      get: (name: string, strict?: boolean) => child.get?.(name, strict) ?? context.get?.(name, strict),
      provide: (name: string, value: unknown) => context.provide?.(name, value),
    }
    const disposeRoute = installWorkbenchHostSignedCatalogInstallRoute(routeContext as never)
    const disposeIdentity = installWorkbenchModuleIdentityRoute(routeContext as never)
    const disposeCenter = installWorkbenchModuleCenterRoutes(routeContext as never)
    const disposeLayoutJournal = installLayoutImportJournalRoute(routeContext as never)
    const disposeDistribution = installDistributionRoutes(routeContext as never)
    const disposeOffline = installWorkbenchOfflineImportRoutes(routeContext as never)
    const disposeDirectSource = installWorkbenchHostDirectSourceInstallRoute(routeContext as never)
    const disposeNativeOfflineBundle = installWorkbenchDshNativeOfflineBundleRoutes(routeContext as never)
    const disposeBrowserWindows = installWorkbenchBrowserWindowController(routeContext as never)
    return () => {
      disposeBrowserWindows?.()
      disposeNativeOfflineBundle?.()
      disposeDirectSource?.()
      disposeLayoutJournal?.()
      disposeDistribution?.()
      disposeOffline?.()
      disposeCenter?.()
      disposeIdentity?.()
      disposeRoute?.()
    }
  }
  let disposeHostRoutes: (() => void) | undefined
  if (typeof context.inject === 'function') {
    context.inject(['connection', 'webServer', 'settings'], child => {
      disposeHostRoutes = installHostRoutes(child)
      return () => { disposeHostRoutes?.(); disposeHostRoutes = undefined }
    })
  } else if (typeof context.get === 'function') {
    // Compatibility fixtures and pre-injection hosts can still boot in
    // layout-only mode; route installers fail closed when webServer is absent.
    disposeHostRoutes = installHostRoutes(context)
    installWorkbenchCreatorSkillProvider(context.get?.('skills') as never)
  }
  context.effect?.(() => () => { disposeCreatorSkill?.(); disposeHostRoutes?.(); runtime.dispose() }, 'workbench-core: runtime')
}
