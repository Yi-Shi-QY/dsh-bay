import { areasOf } from './document-v3.ts'
import type { CreatorRepairTargetV1 } from '../workbench-directory-contract.ts'
import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore, type ComponentProps } from 'react'
import { IconPanelLeftOutlineMedium, IconCordisPluginOutlineMedium, IconShareOutlineMedium, IconSettingsOutlineMedium } from '@deepseek-ai/dsh-client-ui-primitives'
import type { WorkbenchModuleManagerV1 } from '../module-manager.ts'
import type { WorkbenchExtensionRegistryV1 } from '../client/workbench-extension-registry.ts'
import type { WorkbenchWindowControllerV1 } from '../client/workbench-window-controller.ts'
import type { WorkbenchOfflinePackageServiceV1 } from '../offline-package-service.ts'
import type { WorkbenchNativePluginNavigation } from '../client/native-plugin-navigation.ts'
import type { WorkbenchConversationInteractionPolicyV1 } from '../workbench-interaction-policy.ts'
import type { WorkbenchLayoutPackageService } from './layout-package-service.ts'
import type { SettingsScopeSnapshot } from '../client/workbench-settings-contracts.ts'
import type { WorkbenchSettingsV4 } from './persistence.ts'
import type { WorkbenchSettingsSection } from './WorkbenchFrame.tsx'
import { WorkbenchManagementPage, InnerPagesSettingsPage, InteractionSettingsPage, UnsavedFormPrompt, type PendingSettingsForm } from './WorkbenchSettingsPages.tsx'
import { WorkbenchSharingPage } from './WorkbenchSharingPage.tsx'
import type { DistributionPackageService } from './distribution-package-service.ts'
import { DESKTOP_SETTINGS_CONTEXT, scopeSettingsSnapshot, settingsViewMemory, type WorkbenchSettingsContextV1, type WorkbenchSettingsOpenOptionsV1 } from './settings-context.ts'
import css from './WorkbenchSettings.module.css'
import { WorkbenchBackgroundAiSettings } from './WorkbenchBackgroundAiSettings.tsx'
import { useWorkbenchLocale, WorkbenchLocaleContext, type WorkbenchLocaleSource } from './workbench-locale.ts'

export type WorkbenchCoreSettingsSectionProps = ComponentProps<typeof WorkbenchSettingsSection> & {
  locale?: WorkbenchLocaleSource | undefined
  settingsSource?: import('@deepseek-ai/dsh-client-ui-slots').HostObservable<SettingsScopeSnapshot<WorkbenchSettingsV4>>
  settingsContext?: WorkbenchSettingsContextV1
  openOptions?: WorkbenchSettingsOpenOptionsV1
  windowController?: WorkbenchWindowControllerV1
  layoutPackage?: WorkbenchLayoutPackageService
  distributionPackage?: DistributionPackageService
  onOpenWorkbench?: (workbenchId:string)=>Promise<void>
  patchInteractionPolicy?: (key: string, value: unknown) => Promise<boolean>
  registerCloseRequest?: (request: () => void) => (() => void)
  moduleManager?: WorkbenchModuleManagerV1
  extensionRegistry?: WorkbenchExtensionRegistryV1
  offlinePackage?: WorkbenchOfflinePackageServiceV1
  nativePluginNavigation?: WorkbenchNativePluginNavigation
  updateInteractionPolicy?: (policy: WorkbenchConversationInteractionPolicyV1) => Promise<boolean>
  loadModelCatalog?: () => Promise<import('@deepseek-ai/dsh-api-session-controller').ModelCatalog>
  saveBackgroundAi?: (value: import('./background-ai-preferences.ts').BackgroundAiPreferencesV1, expectedRevision?: number) => Promise<boolean | { status: string; revision?: number }>
  openCreator?: (prompt: string, title: string | undefined, target: CreatorRepairTargetV1) => Promise<void>
}

/** One settings view shared by the native DSH entry and the Workbench dialog. */
export function WorkbenchCoreSettingsSection(props: WorkbenchCoreSettingsSectionProps) {
  return props.locale === undefined
    ? <WorkbenchCoreSettingsContent {...props} />
    : <WorkbenchLocaleContext.Provider value={props.locale}><WorkbenchCoreSettingsContent {...props} /></WorkbenchLocaleContext.Provider>
}

function WorkbenchCoreSettingsContent(props: WorkbenchCoreSettingsSectionProps) {
  const { t } = useWorkbenchLocale()
  const context = props.settingsContext ?? DESKTOP_SETTINGS_CONTEXT
  const browser = context.mode === 'browser-workbench'
  const memory = settingsViewMemory(context)
  const snapshot = props.useWorkbenchSettings(value => value) as SettingsScopeSnapshot<WorkbenchSettingsV4>
  const scoped = scopeSettingsSnapshot(snapshot, context)
  const lastValue = useRef(scoped.value)
  if (scoped.value !== undefined) lastValue.current = scoped.value
  const [section, setSection] = useState<NonNullable<WorkbenchSettingsOpenOptionsV1['section']>>(props.openOptions?.section ?? memory.section)
  const [openOptions, setOpenOptions] = useState(props.openOptions)
  const [pendingIntent, setPendingIntent] = useState<(() => void)>()
  const form = useRef<PendingSettingsForm>()
  const onDirty = useCallback((next: PendingSettingsForm | undefined) => { form.current = next }, [])
  const panel = useRef<HTMLDivElement>(null)
  const id = useId()
  const subscribe = useCallback((listener: () => void) => props.editorCatalog.subscribe(listener), [props.editorCatalog])
  const getEditors = useCallback(() => props.editorCatalog.getSnapshot(), [props.editorCatalog])
  const allEditors = useSyncExternalStore(subscribe, getEditors, getEditors)
  const subscribeWindows = useCallback((listener: () => void) => props.windowController?.subscribe(listener) ?? (() => {}), [props.windowController])
  const getWindows = useCallback(() => props.windowController?.getSnapshot(), [props.windowController])
  useSyncExternalStore(subscribeWindows, getWindows, getWindows)
  const attempt = useCallback((action: () => void) => { if (form.current) setPendingIntent(() => action); else action() }, [])
  const navigate = useCallback((options: WorkbenchSettingsOpenOptionsV1) => attempt(() => {
    if (panel.current) memory.scroll[section] = panel.current.scrollTop
    const target = options.section ?? (browser ? 'workbenches' : 'pages')
    if (!browser && (target === 'workbenches' || target === 'sharing')) return
    if (browser && options.workbenchId && options.workbenchId !== context.workbenchId) return
    memory.section = target; setSection(target); setOpenOptions(options)
  }), [attempt, section, memory, browser, context])
  useEffect(() => props.registerCloseRequest?.(() => attempt(() => props.close())), [props.registerCloseRequest, attempt, props.close])
  useEffect(() => { if (panel.current) panel.current.scrollTop = memory.scroll[section] ?? 0 }, [section, memory])
  useEffect(() => { const start = performance.now(); const mark = `workbench-settings:${id}`; performance.mark(mark); return () => { performance.measure('workbench-settings-lifetime', { start, end: performance.now() }); performance.clearMarks(mark) } }, [id])
  const tabs = browser ? [{ id: 'workbenches', label: t('home.currentWorkbench'), icon: <IconPanelLeftOutlineMedium /> }, { id: 'pages', label: t('home.pagesInUse'), icon: <IconCordisPluginOutlineMedium /> }, { id: 'interactions', label: t('home.backgroundAi'), icon: <IconSettingsOutlineMedium /> }, { id: 'sharing', label: t('home.importAndSharing'), icon: <IconShareOutlineMedium /> }]
    : [{ id: 'pages', label: t('empty.manage'), icon: <IconCordisPluginOutlineMedium /> }, { id: 'interactions', label: t('home.interactionPreferences'), icon: <IconSettingsOutlineMedium /> }]
  const actualSection = tabs.some(tab => tab.id === section) ? section : browser ? 'workbenches' : 'pages'
  const editors = browser ? allEditors.filter(editor => Object.values(scoped.value?.workbenches ?? {}).some(record => areasOf(record.document.root).some(area => area.moduleHistory.some(page => page.editorId === editor.id && page.editorScope === editor.scope)))) : allEditors
  const pageProps = { ...props, settingsContext: context, ...(openOptions ? { openOptions } : {}), value: scoped.value ?? lastValue.current, settingsWritable: snapshot.status === 'ready' && snapshot.writable, settingsRevision: snapshot.revision, editors, memory, navigate, onDirty }
  return <div className={css.settingsRoot} data-workbench-settings="core" data-settings-mode={context.mode}>
    <div className={css.settingsLayout}>
      <nav className={css.navigation} aria-label={t('home.workbenchSettingsCategories')}><div className={css.wideNavigation} role="tablist" aria-orientation="vertical">{tabs.map((tab, index) => <button key={tab.id} role="tab" id={`${id}-${tab.id}`} aria-controls={`${id}-content`} aria-selected={actualSection === tab.id} tabIndex={actualSection === tab.id ? 0 : -1} onClick={() => navigate({ section: tab.id as typeof section })} onKeyDown={event => {
        if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
        event.preventDefault(); const next = event.key === 'Home' ? tabs[0] : event.key === 'End' ? tabs[tabs.length - 1] : tabs[(index + (['ArrowUp', 'ArrowLeft'].includes(event.key) ? tabs.length - 1 : 1)) % tabs.length]
        if (next) { navigate({ section: next.id as typeof section }); document.getElementById(`${id}-${next.id}`)?.focus() }
      }}><span className={css.navIcon}>{tab.icon}</span>{tab.label}</button>)}</div><label className={css.narrowNavigation}>{t('home.settingsCategory')}<select aria-label={t('home.workbenchSettingsCategories')} value={actualSection} onChange={event => navigate({ section: event.target.value as typeof section })}>{tabs.map(tab => <option key={tab.id} value={tab.id}>{tab.label}</option>)}</select></label></nav>
      <div ref={panel} className={css.content} id={`${id}-content`} role="tabpanel" aria-label={tabs.find(tab => tab.id === actualSection)?.label} tabIndex={0} onScroll={event => { memory.scroll[section] = event.currentTarget.scrollTop }}>
        {snapshot.status === 'loading' ? <p role="status">{t('home.loadingWorkbenchSettings')}</p> : snapshot.status !== 'ready' ? <p role="alert">{t('home.reconnectToDshToLoadSettingsUnsaved')}</p> : null}
        {actualSection === 'workbenches' ? <WorkbenchManagementPage {...pageProps} /> : actualSection === 'pages' ? <InnerPagesSettingsPage {...pageProps} /> : actualSection === 'interactions' ? browser ? <WorkbenchBackgroundAiSettings {...pageProps} /> : <InteractionSettingsPage {...pageProps} /> : browser ? <WorkbenchSharingPage {...pageProps} /> : null}
      </div>
    </div>
    {pendingIntent && form.current ? <UnsavedFormPrompt form={form.current} onContinue={() => setPendingIntent(undefined)} onLeave={() => { const next = pendingIntent; form.current = undefined; setPendingIntent(undefined); next() }} /> : null}
  </div>
}
