import { useWorkbenchLocale, workbenchIntlLocale } from './workbench-locale.ts'
import { useEffect, useRef, useState } from 'react'
import { IconCordisPluginOutlineMedium, IconDownloadOutlineMedium, IconFolderOpenOutlineMedium, IconClockOutlineMedium, IconRefreshOutlineMedium, IconArchiveOutlineMedium } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SettingsPageProps } from './WorkbenchSettingsPages.tsx'
import { downloadSettingsFile, LayoutDiagram, useSettingsAction } from './WorkbenchSettingsPages.tsx'
import type { DistributionImportStatus } from '../distribution-contract.ts'
import type { WorkbenchPackageModeV4 } from './workbench-package-v4.ts'
import type { DistributionPackageService } from './distribution-package-service.ts'
import { areasOf } from './document-v3.ts'
import { layoutBindingSources } from './workbench-layout-package.ts'
import type {SessionBindingV1} from './model.ts'
import { WORKBENCH_CORE_VERSION } from '../release-compatibility.ts'
import css from './WorkbenchSettings.module.css'
import { WorkbenchHomePreview } from './WorkbenchHomePreview.tsx'
import { WorkbenchSharingSummary } from './WorkbenchSharingSummary.tsx'
import { DESKTOP_SETTINGS_CONTEXT, settingsTargetWritable } from './settings-context.ts'
import sharing from './WorkbenchSharing.module.css'
import { suggestedWorkbenchFolder, workbenchFolderNameError, workbenchTargetPath } from '../workbench-folder-name.ts'

type PreparedExport = Awaited<ReturnType<DistributionPackageService['prepareExport']>>

function DistributionExportPreview({ prepared, kind, editors }: {
  prepared: PreparedExport
  kind: WorkbenchPackageModeV4
  editors: SettingsPageProps['editors']
}) {
  const { t } = useWorkbenchLocale()
  const layout = prepared.preview.layout
  const areas = areasOf(layout.document.root)
  const pageCount = areas.reduce((total, area) => total + area.moduleHistory.length, 0)
  const dependencies = prepared.preview.manifest.dependencies
  return <div className={`${css.detail} ${css.distributionPreview}`}>
    <header className={css.distributionPreviewHeader}>
      <div className={css.distributionPreviewIdentity}>
        <span className={css.detailEyebrow}>{t('transfer.templatePackagePreview')}</span>
        <h4>{layout.name}</h4>
        <p>{layout.description || t('transfer.prepared')}</p>
        {layout.tags.length ? <div className={css.detailBadges}>{layout.tags.slice(0, 4).map(tag => <span key={tag}>{tag}</span>)}</div> : null}
      </div>
      <span className={css.statusBadge} data-status={kind === 'layout-only' ? undefined : 'browser'}>{t(`transfer.labels.${kind}`)}</span>
    </header>

    <section className={css.distributionPreviewSection}>
      <div className={css.sectionHeader}><div><h4>{t('transfer.layoutOverview')}</h4><p>{t('transfer.theRecipientWillRestoreAreasAndPages')}</p></div><span className={css.sectionCount}>{areas.length} {t('transfer.areas')}</span></div>
      <div className={css.distributionLayoutCanvas}><WorkbenchHomePreview node={layout.document.root} editors={editors} /></div>
      <div className={css.previewSummary}><span>{areas.length} {t('transfer.areas')}</span><span>{pageCount} {t('transfer.pages')}</span><span>{t('transfer.allTabsAreKept')}</span></div>
    </section>

    <section className={css.distributionPreviewSection}>
      <div className={css.sectionHeader}><div><h4>{t('transfer.extensionsAndCompatibility')}</h4><p>{t('transfer.recipientsCanVerifyTheseDetailsBeforeImporting')}</p></div><span className={css.sectionCount}>{t('transfer.dependencyCount', { count: dependencies.length })}</span></div>
      {prepared.preview.manifest.publisher ? <div className={css.distributionPublisher}><span>{t('transfer.publisherFingerprint')}</span><code>{prepared.preview.manifest.publisher.keyId}</code></div> : null}
      <div className={css.distributionDependencyList}>
        {dependencies.map(dependency => <div className={css.distributionDependency} key={dependency.packageName}>
          <span className={css.distributionDependencyIcon} aria-hidden="true"><IconCordisPluginOutlineMedium size={17} /></span>
          <div><strong>{dependency.packageName} <small>{dependency.version}</small></strong><p>{dependency.host ? t('transfer.hostCode') : t('transfer.clientExtension')} {t('transfer.permissions')}{dependency.permissions.join('、') || t('transfer.noDeclarations')}</p></div>
        </div>)}
        {!dependencies.length ? <div className={css.emptyInline}>{t('transfer.thisTemplateContainsNoAdditionalExtensions')}</div> : null}
      </div>
    </section>

    {layout.warnings.length ? <details className={css.distributionWarnings} open><summary>{layout.warnings.length} {t('transfer.transferNotes')}</summary><ul>{layout.warnings.map((warning, index) => <li role="status" key={index}>{warning}</li>)}</ul></details> : null}
    <div className={css.stickyActions}><button className={css.primaryButton} onClick={() => downloadSettingsFile(layout.name + '-' + t(`transfer.labels.${kind}`) + '-' + WORKBENCH_CORE_VERSION + '.wbpkg', new Uint8Array(prepared.bytes).buffer, 'application/zip')}>{t('transfer.downloadVerifiedTemplate')}</button><p>{t('transfer.theDownloadUsesThisPreviewGenerateA')}</p></div>
  </div>
}

type DistributionViewMode = 'export' | 'import' | 'history'
export function WorkbenchDistributionPage(props:SettingsPageProps & {distributionPackage:DistributionPackageService; embedded?: boolean; active?: boolean; viewMode?: DistributionViewMode; onViewModeChange?(mode: DistributionViewMode): void; selectedWorkbenchId?: string; onWorkbenchChange?(id: string): void; unifiedPicker?: boolean; importSelection?: { id: number; file: File } | undefined; onImportBusyChange?(busy: boolean): void}){
  const { t, language } = useWorkbenchLocale()
  const service=props.distributionPackage
  const [localTab,setLocalTab]=useState<DistributionViewMode>(props.openOptions?.shareMode??'export')
  const tab=props.viewMode??localTab
  const setTab=(next: DistributionViewMode)=>{setLocalTab(next);props.onViewModeChange?.(next)}
  const [kind,setKind]=useState<WorkbenchPackageModeV4>('layout-only')
  const [includeBackground, setIncludeBackground] = useState(false)
  const [parentPath, setParentPath] = useState(''), [folderName, setFolderName] = useState('')
  const folderRequired = !!props.workbenchDirectory?.completeRequest
  const handledSelection = useRef<number>(), importGeneration = useRef(0)
  const [localId,setLocalId]=useState(props.openOptions?.workbenchId??props.value?.activeWorkbenchId??'')
  const id=props.selectedWorkbenchId??localId
  const setId=(next:string)=>{setLocalId(next);props.onWorkbenchChange?.(next)}
  const writable=settingsTargetWritable(props.settingsContext??DESKTOP_SETTINGS_CONTEXT,id,props.windowController)
  const [prepared,setPrepared]=useState<Awaited<ReturnType<DistributionPackageService['prepareExport']>>>()
  const [row,setRow]=useState<DistributionImportStatus>()
  const [history,setHistory]=useState<DistributionImportStatus[]>([])
  const [confirmed,setConfirmed]=useState(false)
  const [bindings,setBindings]=useState<Record<string,SessionBindingV1>>({})
  const sessions=props.useSessions(value=>value)
  const generation=useRef(0),actions=useSettingsAction({busy:'transfer.checkingDistribution',success:'transfer.actionComplete'})
  useEffect(()=>{if(tab==='history' && props.active !== false)void actions.run('history',async()=>{setHistory(await service.history())})},[tab,service,props.active])
  useEffect(()=>{generation.current++;setPrepared(undefined)},[id,tab])
  const importing=!!(actions.states.commit?.busy||actions.states.resume?.busy)
  useEffect(()=>{
    if(!importing||!row)return
    let disposed=false
    const timer=setInterval(()=>{void service.history().then(rows=>{
      const current=rows.find(r=>r.transactionId===row.transactionId)
      if(!disposed&&current)setRow(current)
    }).catch(()=>{})},1000)
    return()=>{disposed=true;clearInterval(timer)}
  },[importing,row?.transactionId,service])
  const change=(next:typeof tab)=>{generation.current++;setTab(next);setPrepared(undefined);setRow(undefined);setConfirmed(false)}
  const importStatus=(value:DistributionImportStatus)=>{setRow(value);setConfirmed(false)}
  const executeImport=async(action:()=>Promise<DistributionImportStatus>)=>{
    try{importStatus(await action())}catch(error){
      if(row){const latest=(await service.history().catch(()=>[])).find(r=>r.transactionId===row.transactionId);if(latest)setRow(latest)}
      throw error
    }
  }
  const busy = Object.values(actions.states).some(state => state.busy)
  useEffect(() => { props.onImportBusyChange?.(busy) }, [busy, props.onImportBusyChange])
  const receive = (file: File) => {
    setRow(undefined); setConfirmed(false); setBindings({}); setParentPath(''); setFolderName('')
    const gen = ++importGeneration.current
    void actions.run('inspect', async () => {
      if (file.size > 128 * 1024 * 1024) throw new Error(t('transfer.maxTemplateSize'))
      const next = await service.inspect(new Uint8Array(await file.arrayBuffer()))
      if (gen === importGeneration.current) { setRow(next); setFolderName(suggestedWorkbenchFolder(next.name)) }
    })
  }
  useEffect(() => {
    if (!props.importSelection || handledSelection.current === props.importSelection.id) return
    handledSelection.current = props.importSelection.id; receive(props.importSelection.file)
  }, [props.importSelection])
  const record=props.value?.workbenches[id]
  return <section className={sharing.page}>
    {!props.embedded ? <><header className={sharing.header}><span className={sharing.headerIcon}><IconCordisPluginOutlineMedium size={23}/></span><div><h2>{t('transfer.workbenchTemplatePackage')}</h2><p>{t('transfer.shareTheLayoutPagesAndPortableSettings')}</p></div></header>
      <nav className={sharing.tabs} aria-label={t('transfer.sharingActions')}>{(['export','import','history'] as const).map(section=><button key={section} aria-pressed={tab===section} onClick={()=>change(section)}>{section==='export'?<IconDownloadOutlineMedium size={16}/>:section==='import'?<IconFolderOpenOutlineMedium size={16}/>:<IconClockOutlineMedium size={16}/>} {t(section==='export'?'home.exportWorkbench':section==='import'?'settings.importWorkbench':'home.importHistory')}</button>)}</nav></>:null}
    {tab==='export'?<>
      <div className={sharing.workspace}><section className={sharing.formPanel}>
        <div className={sharing.formIntro}><h3>{t('transfer.exportWorkbenchTemplate')}</h3><p>{t('transfer.shareLayoutPagesAndPortableSettingsUse')}</p></div>
        <label className={sharing.field}>{t('shell.workbench')}<select aria-label={t('transfer.workbenchToShare')} value={record?id:''} onChange={e=>{setId(e.target.value);setPrepared(undefined);generation.current++}}><option value="" disabled>{t('home.selectAWorkbench')}</option>{Object.values(props.value?.workbenches??{}).map(w=><option key={w.workbenchId} value={w.workbenchId}>{w.name}</option>)}</select></label>
        <label className={sharing.field}>{t('transfer.extensionDeliveryMethod')}<select aria-label={t('transfer.extensionDeliveryMethod')} value={kind} onChange={e=>{setKind(e.target.value as WorkbenchPackageModeV4);setPrepared(undefined);generation.current++}}>{(['layout-only', 'online-reference', 'offline-embedded'] as const).map(mode => <option key={mode} value={mode}>{t(`transfer.labels.${mode}`)}</option>)}</select></label>
        <p className={sharing.hint}>{kind==='layout-only'?t('transfer.layoutOnlyDescription'):kind==='online-reference'?t('transfer.onlineDescription'):t('transfer.offlineDescription')}</p>
        <label><input type="checkbox" checked={includeBackground} onChange={event => { setIncludeBackground(event.target.checked); setPrepared(undefined); generation.current++ }} />{t('transfer.includeWorkbenchContext')}</label>
        <p className={sharing.hint}>{t('transfer.onlyManuallyEnteredContextIsIncludedModel')}</p>
        <div className={sharing.actionBar}><button className={css.primaryButton} disabled={!record||!writable||actions.states.prepare?.busy} onClick={()=>void actions.run('prepare',async()=>{const gen=generation.current;const next=await service.prepareExport(id,kind,kind!=='layout-only',includeBackground);if(gen===generation.current)setPrepared(next)})}><IconArchiveOutlineMedium size={16}/>{kind==='layout-only'?t('transfer.buildLayoutTemplate'):t('transfer.buildExtensionTemplate')}</button></div>
        {actions.feedback('prepare')}{!writable?<p className={sharing.hint}>{t('transfer.takeBackControlFromTheBrowserBefore')}</p>:null}
      </section><WorkbenchSharingSummary record={record} editors={props.editors} complete={false}/></div>
      {prepared?<DistributionExportPreview prepared={prepared} kind={kind} editors={props.editors}/>:null}
    </>:null}
    {tab==='import'?<>
      <div className={sharing.workspace}><section className={sharing.formPanel}>
        <div className={sharing.formIntro}><h3>{t('transfer.importAWorkbenchTemplate')}</h3><p>{t('transfer.reviewTheLayoutAndExtensionsCreateA')}</p></div>
        {!props.unifiedPicker ? <label className={sharing.upload} data-disabled={actions.states.inspect?.busy||false}><IconCordisPluginOutlineMedium size={30}/><strong>{t('transfer.chooseWorkbenchTemplatePackage')}</strong><span>{t('transfer.chooseFile')}</span><small>{t('transfer.wbpkgOrZipUpTo128Mb')}</small>
          <input aria-label={t('transfer.workbenchPackageFile')} type="file" accept=".zip,.wbpkg" disabled={busy} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) receive(file) }} />
        </label> : null}{actions.feedback('inspect')}
      </section><aside className={sharing.summary}><div className={sharing.summaryTitle}><IconCordisPluginOutlineMedium size={17}/><h3>{t('transfer.preImportChecks')}</h3></div><ol className={sharing.steps}><li><div><strong>{t('transfer.layoutAndPages')}</strong><p>{t('transfer.reviewAreasPageOrderAndPortableSettings')}</p></div></li><li><div><strong>{t('transfer.extensionsAndDependencies')}</strong><p>{t('transfer.verifySourcesVersionsAndMissingExtensionsBefore')}</p></div></li><li><div><strong>{t('transfer.localResources')}</strong><p>{t('transfer.linkYourOwnProjectsAndConversationsNow')}</p></div></li></ol></aside></div>
      {row?<div className={sharing.importDetails}><h4>{row.name} · {t(`transfer.labels.${row.mode}`)}</h4><p role="status">{t(`transfer.states.${row.state}`)}</p><p>{t('transfer.packageDigest')}{row.archiveSha256}</p>{row.keyId?<p>{t('transfer.publisherFingerprint2')}{row.keyId}{t('transfer.verifyFirstTimeImportsWithTheSender')}</p>:null}
        {row.targetDisplayPath ? <p>{t('transfer.destinationFolder')}{row.targetDisplayPath}</p> : null}
        {row.localExtensions?.map(extension => <p key={extension.packageName + '@' + extension.requiredVersion}>{extension.packageName}{t('transfer.packageRequires')} {extension.requiredVersion ?? t('transfer.undeclaredVersion')} {t('transfer.locallyInstalledAtCheckTime')}{extension.installed ? t('transfer.installedVersionPrefix') + (extension.installedVersion ?? t('transfer.unknownVersion')) : t('transfer.notInstalled')}。{extension.installedVersion && extension.requiredVersion && extension.installedVersion !== extension.requiredVersion ? t('transfer.noVersionChange') : t('transfer.verifyBeforeRestore')}</p>)}
        {folderRequired && row.state === 'checked' ? <section className={sharing.formPanel} aria-label={t('transfer.templateLocation')}>
          <label className={sharing.field}>{t('transfer.newWorkbenchFolderName')}<input aria-label={t('transfer.templateFolderName')} value={folderName} disabled={busy} maxLength={160} onChange={event => setFolderName(event.target.value)} /></label>
          <p className={sharing.hint}>{parentPath ? workbenchTargetPath(parentPath, folderName) : t('transfer.createNewFolder')}</p>
          <button className={css.secondaryButton} disabled={busy || !props.workbenchDirectory?.pickParentDirectory} onClick={() => void actions.run('location', async () => { const path = await props.workbenchDirectory?.pickParentDirectory?.(); if (path) setParentPath(path) })}><IconFolderOpenOutlineMedium size={16} />{t('transfer.chooseDestinationParentFolder')}</button>{actions.feedback('location')}
          {folderName && workbenchFolderNameError(folderName, t) ? <p role="alert">{workbenchFolderNameError(folderName, t)}</p> : null}
        </section> : null}
        {row.dependencies.map(d=><div className={css.row} key={d.packageName}><div><strong>{d.packageName} {d.version}</strong><p>{row.installed.includes(d.packageName)?t('transfer.installed'):row.reused.includes(d.packageName)||row.plannedReuse?.includes(d.packageName)?t('transfer.reusePlugin'):t('transfer.installOrVerify')} · {d.host?t('transfer.localHostCode'):t('transfer.clientCode')}</p><p>{t('transfer.declaredPermissions')}{d.permissions.join('、')||t('transfer.noDeclarations')}{t('transfer.workbenchAuthorizationDoesNotSandboxExecution')}</p></div></div>)}
        {row.layout?<LayoutDiagram node={row.layout.document.root} editors={props.editors}/>:null}
        {row.layout?.warnings.map((warning,index)=><p role="status" key={index}>{warning}</p>)}
        {row.layout && !folderRequired ?layoutBindingSources(row.layout).map((source,index)=><label className={css.form} key={source.key}>{t('transfer.sourceConversation')} {index+1}<select aria-label={t('transfer.sourceConversation') + ' ' + (index+1)} value={bindings[source.key]?.sessionId??''} onChange={event=>{const session=sessions.byId[event.target.value as keyof typeof sessions.byId];setBindings(current=>{const next={...current};if(session)next[source.key]={sessionId:session.id};else delete next[source.key];return next})}}><option value="">{t('transfer.linkLaterWithoutCreatingAConversation')}</option>{sessions.ids.map(id=>sessions.byId[id]?<option key={id} value={id}>{sessions.byId[id]!.displayTitle}</option>:null)}</select></label>):null}
        {folderRequired ? <p className={sharing.hint}>{t('transfer.theImportedWorkbenchStaysClosedReconnectProjects')}</p> : null}
        {row.pendingPageIds?.length?<><p role="status">{row.pendingPageIds.length} {t('transfer.pageConfigurationsAreSavedButInactiveInstall')}</p><button disabled={actions.states.restore?.busy} onClick={()=>void actions.run('restore',()=>executeImport(()=>service.restorePending(row)))}>{t('transfer.restorePendingSettings')}</button>{actions.feedback('restore')}</>:null}
        {row.blockers.map((b,i)=><p role="alert" key={i}>{b}</p>)}
        {row.state==='checked'?<><label><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>{row.dependencies.length ? t('transfer.approveExtensions') : t('transfer.approveTemplate')}</label><button className={css.primaryButton} disabled={!confirmed||busy||folderRequired&&(!parentPath||!!workbenchFolderNameError(folderName, t))} onClick={()=>void actions.run('commit',async()=>{await executeImport(()=>service.confirm(row,bindings,folderRequired ? { parentPath, folderName } : undefined))})}>{row.blockers.length ? t('transfer.recheckImport') : t('transfer.confirmImport')}</button>{actions.feedback('commit')}</>:null}
        {['installing','restart-required','awaiting-restore','failed'].includes(row.state)?<><button disabled={importing} onClick={()=>void actions.run('resume',async()=>{await executeImport(()=>service.resume(row.transactionId,bindings))})}>{t('transfer.checkAndResumeThisImport')}</button>{actions.feedback('resume')}</>:null}
        {!['ready','needs-input','cancelled'].includes(row.state)?<><button disabled={actions.states.cancel?.busy} onClick={()=>void actions.run('cancel',async()=>{await executeImport(()=>service.cancel(row.transactionId))})}>{t('transfer.cancelAndRollBackNewContent')}</button>{actions.feedback('cancel')}</>:null}
        {['ready','needs-input'].includes(row.state)?<><p>{t('transfer.theWorkbenchWasSavedWithoutOpeningIt')}</p><button onClick={()=>void actions.run('open',()=>props.onOpenWorkbench?props.onOpenWorkbench(row.workbenchId):props.workbenchDirectory!.openAndSelect(row.workbenchId))}>{t('transfer.openImportedWorkbench')}</button>{actions.feedback('open')}</>:null}
      </div>:null}
    </>:null}
    {tab==='history'?<section className={sharing.history} aria-label={t('transfer.templateImportHistory')}><div className={sharing.sectionHeading}><h3><IconClockOutlineMedium size={17}/>{t('transfer.templateImportHistory')}</h3><button onClick={()=>void actions.run('history',async()=>{setHistory(await service.history())})}><IconRefreshOutlineMedium size={16}/>{t('transfer.refreshHistory')}</button></div>{actions.feedback('history')}
      {history.map(h=><article key={h.transactionId} className={sharing.job}><span className={sharing.jobIcon}><IconCordisPluginOutlineMedium size={18}/></span><div className={sharing.jobCopy}><strong>{h.name}</strong><p>{t(`transfer.labels.${h.mode}`)} · {t(`transfer.states.${h.state}`)}</p><div className={sharing.jobMeta}><time>{new Date(h.createdAt).toLocaleString(workbenchIntlLocale(language))}</time></div></div><div className={sharing.jobActions}><button className={css.secondaryButton} onClick={()=>{setTab('import');importStatus(h);setParentPath('');setFolderName(suggestedWorkbenchFolder(h.name))}}>{t('transfer.reviewAndResume')}</button></div></article>)}
      {!history.length?<div className={sharing.empty}><IconClockOutlineMedium size={24}/><p>{t('transfer.noRecentImports')}</p></div>:null}
    </section>:null}
  </section>
}
