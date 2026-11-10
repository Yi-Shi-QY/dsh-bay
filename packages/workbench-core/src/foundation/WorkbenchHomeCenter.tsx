import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type { SettingsScopeSnapshot } from '../client/workbench-settings-contracts.ts'
import type { WorkbenchSettingsV4 } from './persistence.ts'
import type { WorkbenchCoreSettingsSectionProps } from './WorkbenchCoreSettingsSection.tsx'
import type { WorkbenchCoreSettingsPage } from './WorkbenchCoreSettingsDialog.tsx'
import type { WorkbenchDirectory } from './frame-settings-adapter.ts'
import { DESKTOP_SETTINGS_CONTEXT, type SettingsViewMemory, type WorkbenchSettingsOpenOptionsV1 } from './settings-context.ts'
import { WorkbenchCompletePackagePanel } from './WorkbenchCompletePackagePanel.tsx'
import { WorkbenchHome } from './WorkbenchHome.tsx'
import { WorkbenchHomeNavigation } from './WorkbenchHomeNavigation.tsx'
import { WorkbenchManagementPage, UnsavedFormPrompt, type PendingSettingsForm } from './WorkbenchSettingsPages.tsx'
import { WorkbenchDistributionPage } from './WorkbenchDistributionPage.tsx'
import { WorkbenchLayoutSharingPage } from './WorkbenchLayoutSharingPage.tsx'
import css from './WorkbenchHome.module.css'
import pageCss from './WorkbenchSettings.module.css'

type HomeNavigation = (options?: WorkbenchSettingsOpenOptionsV1) => void
export type WorkbenchHomeCenterProps = WorkbenchCoreSettingsPage & Pick<WorkbenchCoreSettingsSectionProps, 'useSessions' | 'useWorkspaces'> & {
  directory: WorkbenchDirectory
  workbenchSettings: HostObservable<SettingsScopeSnapshot<WorkbenchSettingsV4>>
  onOpenWorkbench(workbenchId: string): Promise<void>
  onCreated(workbenchId: string): void
  registerNavigation?: (navigate: HomeNavigation) => (() => void)
  registerBeforeLeave?: (guard: () => Promise<boolean>) => (() => void)
  onOpenSettings?: (options?: WorkbenchSettingsOpenOptionsV1) => void
  generateContextDraft?: import('./workbench-ai.ts').WorkbenchAiDraftGeneratorV1['generateContextDraft']
}

/** Desktop root: management and distribution live here, outside Settings. */
export function WorkbenchHomeCenter(props: WorkbenchHomeCenterProps) {
  const [destination, setDestination] = useState<WorkbenchSettingsOpenOptionsV1 | undefined>(props.openOptions)
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => { if (root.current) root.current.scrollTop = 0 }, [destination])
  const memory = useRef<SettingsViewMemory>({ section: 'workbenches', searches: {}, filters: { workbenches: 'all' }, scroll: {} }).current
  const form = useRef<PendingSettingsForm>()
  const [pending, setPending] = useState<{ resolve(ok: boolean): void }>()
  const pendingRef = useRef<{ resolve(ok: boolean): void }>()
  const onDirty = useCallback((next: PendingSettingsForm | undefined) => { form.current = next }, [])
  const beforeLeave = useCallback((): Promise<boolean> => {
    if (!form.current) return Promise.resolve(true)
    if (pendingRef.current) return Promise.resolve(false)
    return new Promise(resolve => { const request = { resolve }; pendingRef.current = request; setPending(request) })
  }, [])
  const navigate = useCallback<HomeNavigation>(options => {
    void beforeLeave().then(ok => {
      if (!ok) return
      if (options?.section && !['workbenches', 'sharing'].includes(options.section) && props.onOpenSettings) props.onOpenSettings(options)
      else setDestination(options?.section === 'workbenches' && !options.workbenchId ? undefined : options)
    })
  }, [beforeLeave, props.onOpenSettings])
  useEffect(() => props.registerNavigation?.(navigate), [props.registerNavigation, navigate])
  useEffect(() => props.registerBeforeLeave?.(beforeLeave), [props.registerBeforeLeave, beforeLeave])
  useEffect(() => () => pendingRef.current?.resolve(false), [])
  const finish = (ok: boolean) => {
    if (ok) form.current = undefined
    pendingRef.current?.resolve(ok); pendingRef.current = undefined; setPending(undefined)
  }
  const source = props.settingsSource ?? props.workbenchSettings
  const snapshot = useSyncExternalStore(source.subscribe, source.getSnapshot, source.getSnapshot)
  const lastValue = useRef(snapshot.value)
  if (snapshot.value !== undefined) lastValue.current = snapshot.value
  const editors = useSyncExternalStore(props.editorCatalog.subscribe, props.editorCatalog.getSnapshot, props.editorCatalog.getSnapshot)
  const subscribeWindows = useCallback((listener: () => void) => props.windowController?.subscribe(listener) ?? (() => {}), [props.windowController])
  const getWindows = useCallback(() => props.windowController?.getSnapshot(), [props.windowController])
  useSyncExternalStore(subscribeWindows, getWindows, getWindows)
  const useWorkbenchSettings: WorkbenchCoreSettingsSectionProps['useWorkbenchSettings'] = useCallback(selector => selector(snapshot), [snapshot])
  const openWorkbench = async (id: string) => { if (await beforeLeave()) await props.onOpenWorkbench(id) }
  const pageProps = { ...props, workbenchDirectory: props.directory, settingsContext: DESKTOP_SETTINGS_CONTEXT,
    useWorkbenchSettings, value: snapshot.value ?? lastValue.current, editors, memory, navigate, onDirty,
    ...(destination ? { openOptions: destination } : {}), onOpenWorkbench: openWorkbench, onBackToOverview: () => navigate(), close: () => navigate() }
  const section = destination?.section
  const count = Object.keys(snapshot.value?.workbenches ?? {}).length + Object.keys(snapshot.value?.invalidWorkbenches ?? {}).length
  const previousCount = useRef(count)
  useEffect(() => {
    if (snapshot.status === 'ready' && count === 0 && previousCount.current > 0 && section === 'workbenches') setDestination(undefined)
    previousCount.current = count
  }, [count, section, snapshot.status])
  return <div ref={root} className={css.center} data-workbench-home-center>
    {section === 'workbenches' || section === 'sharing' ? <main className={css.home} data-workbench-home>
      <WorkbenchHomeNavigation section={section} navigate={navigate} />
      <div className={css.centerContent + ' ' + pageCss.settingsRoot} style={{ height: 'auto' }}>
        {snapshot.status !== 'ready' ? <p role="alert">工作台连接暂不可用，当前资料已保留。请恢复连接后重试。</p> : null}
        {section === 'workbenches' ? <WorkbenchManagementPage key={destination?.workbenchId ?? 'list'} {...pageProps} />
          : props.distributionPackage ? <>{props.directory.completeRequest ? <WorkbenchCompletePackagePanel workbenchId={destination?.workbenchId ?? snapshot.value?.activeWorkbenchId ?? ''} {...(props.directory.pickParentDirectory ? { pickParentDirectory: props.directory.pickParentDirectory } : {})} /> : null}<WorkbenchDistributionPage key={destination?.shareMode + ':' + destination?.workbenchId} {...pageProps} distributionPackage={props.distributionPackage} /></>
            : <WorkbenchLayoutSharingPage key={destination?.shareMode + ':' + destination?.workbenchId} {...pageProps} />}
      </div>
    </main> : <WorkbenchHome value={snapshot.value ?? lastValue.current} directory={props.directory} editors={editors} navigate={navigate} {...(props.windowController ? { windowController: props.windowController } : {})} onOpenWorkbench={openWorkbench} onCreated={props.onCreated} {...(props.generateContextDraft === undefined ? {} : { generateContextDraft: props.generateContextDraft })} />}
    {pending && form.current ? <div className={pageCss.settingsRoot} style={{ height: 0, minHeight: 0 }}><UnsavedFormPrompt form={form.current} onContinue={() => finish(false)} onLeave={() => finish(true)} /></div> : null}
  </div>
}
