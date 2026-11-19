import { useWorkbenchLocale } from './workbench-locale.ts'
import { useState } from 'react'
import { Button, IconFolderOpenOutlineMedium, IconSettingsOutlineMedium } from '@deepseek-ai/dsh-client-ui-primitives'
import type { WorkbenchRecordV2 } from './persistence.ts'
import type { WorkbenchHomeProps } from './WorkbenchHome.tsx'
import { areasOf } from './document-v3.ts'
import { WorkbenchHomePreview } from './WorkbenchHomePreview.tsx'
import { WorkbenchMemoryDialog } from './WorkbenchMemoryDialog.tsx'
import { WorkbenchContextDialog } from './WorkbenchContextDialog.tsx'
import { renderAreaContextMarkdown } from './workbench-context.ts'
import css from './WorkbenchHome.module.css'

const tabs = { overview: 'home.detailTab.overview', areas: 'home.detailTab.areas', context: 'home.detailTab.context', sharing: 'home.detailTab.sharing' } as const
export function WorkbenchOverviewDetail({ record, directory, editors = [], navigate, onOpen, onReclaim, writable, busy, generateContextDraft }: WorkbenchHomeProps & {
  record: WorkbenchRecordV2; onOpen(): void; onReclaim?(): void; writable: boolean; busy: boolean
}) {
  const { t } = useWorkbenchLocale()
  const [tab, setTab] = useState<keyof typeof tabs>('overview')
  const [areaId, setAreaId] = useState<string>()
  const [context, setContext] = useState<{ areaId?: string; title: string; value: string }>()
  const [memory, setMemory] = useState(false)
  const [notice, setNotice] = useState<string>()
  const visible = areasOf(record.document.root), all = visible
  const projects = Object.values(record.projects ?? {})
  const pages = visible.flatMap(area => area.moduleHistory)
  const sessions = new Set([...Object.values(record.sessionCatalog ?? {}).map(entry => entry.sessionId ?? entry.sessionKey), ...pages.flatMap(page => page.binding ? [page.binding.sessionId] : [])])
  const unavailable = pages.filter(page => !editors.some(editor => editor.id === page.editorId && editor.scope === page.editorScope))
  const background = directory.getWorkbenchContext?.(record.workbenchId)?.human.goal ?? ''
  const manage = () => navigate?.({ section: 'workbenches', workbenchId: record.workbenchId })
  const areaLabel = (id: string) => record.areaMetadata?.[id]?.label || t('share.areaValue1', { value1: all.findIndex(area => area.areaId === id) + 1 })
  return <section className={css.selectedDetail} aria-label={t('share.detailsForValue1', { value1: record.name })}>
    <header className={css.selectedHeader}>
      <span className={css.detailEyebrow}>{!writable ? [t('home.openInBrowser'), ...(record.archivedAt ? [t('home.archived')] : [])].join(' · ') : record.archivedAt ? t('home.archived') : t('share.workspace')}</span>
      <div className={css.selectedTitle}><h2>{record.name}</h2>{!writable ? <Button variant="outline" aria-label={t('share.takeBackControlOfValue1FromThe', { value1: record.name })} disabled={busy || !onReclaim} onClick={onReclaim}>{t('home.takeBackControl')}</Button> : null}<Button variant="primary" disabled={busy || !!record.archivedAt} onClick={onOpen}>{!writable ? t('share.manageBrowserWorkbench') : t('home.openWorkbench')}</Button></div>
      <p>{record.description || t('share.noWorkbenchDescriptionYet')}</p>
      <div className={css.rootPath}><IconFolderOpenOutlineMedium size={15} /><span>{directory.getRootPath?.(record.workbenchId) ?? t('share.folderNotAvailableYet')}</span></div>
      <div className={css.detailCounters}><span>{projects.length} {t('share.projects')}</span><span>{all.length} {t('transfer.areas')}</span><span>{pages.length} {t('transfer.pages')}</span><span>{sessions.size} {t('share.conversations')}</span><Button size="sm" icon={<IconSettingsOutlineMedium size={14} />} onClick={manage}>{t('share.workbenchDetails')}</Button></div>
    </header>
    <nav className={css.detailTabs} aria-label={t('settings.workbenchDetails')} role="tablist">{Object.entries(tabs).map(([id, label]) => <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id as keyof typeof tabs)}>{t(label)}</button>)}</nav>
    <div className={css.detailContent} role="tabpanel" aria-label={t(tabs[tab])}>
      {tab === 'overview' ? <>
        {unavailable.length ? <div className={css.overviewNotice}><strong>{unavailable.length} {t('share.pagesNeedAttention')}</strong><p>{t('share.theExtensionIsMissingDisabledOrUnavailable')}</p><Button size="sm" onClick={() => navigate?.({ section: 'pages', workbenchId: record.workbenchId })}>{t('share.checkPageExtensions')}</Button></div> : null}
        <div className={css.detailSectionHeader}><h3>{t('workspace.workspaceLayout')}</h3><span>{t('share.lastSavedLayoutSelectAnAreaTo')}</span></div>
        <div className={css.detailPreview}><WorkbenchHomePreview node={record.document.root} editors={editors} onSelectArea={id => { setAreaId(id); setTab('areas') }} /></div>
        <div className={css.overviewLinks}><button onClick={() => setTab('context')}><strong>{t('share.contextAndMemory')}</strong><span>{background ? t('share.viewWorkbenchGoalsAndMemory') : t('share.addContextToGuideYourWork')}</span></button><button onClick={() => setTab('sharing')}><strong>{t('home.sharingAndTransfer')}</strong><span>{t('share.fullTransferExtensionDistributionAndOnlineAccess')}</span></button></div>
        <section className={css.detailSection}><h3>Bay Agent</h3><p>{record.bayAgentSession ? t('share.theMainConversationIsLinkedOpenIt') : t('share.openTheWorkbenchToCheckTheMain')}</p><span className={css.detailEyebrow}>{t('settings.model2')}{record.workbenchAi?.model ?? t('settings.useDshDefault')}</span></section>
      </> : null}
      {tab === 'areas' ? <><section className={css.detailSection}><h3>{t('share.projects2')}</h3><p className={css.detailHint}>{t('share.projectsKeepContextMemoryAndHistoryReopening')}</p>{projects.map(project => <article className={css.areaDetail} key={project.projectId}><div className={css.detailSectionHeader}><h3><IconFolderOpenOutlineMedium size={16} /> {project.name}</h3><span>{visible.filter(area => record.areaProjects?.[area.areaId]?.projectId === project.projectId).length} {t('share.activeAreas')}</span></div><p className={css.rootPath}>{project.relativePath}</p><p className={css.detailHint}>{project.context?.human.objective || t('share.noProjectContextYet')}</p><Button size="sm" disabled={!writable || !directory.openProject} onClick={() => { void directory.openProject!(record.workbenchId, project.projectId).then(onOpen).catch(cause => setNotice(String(cause))) }}>{t('share.openInNewArea')}</Button></article>)}{!projects.length ? <p className={css.detailHint}>{t('share.setAProjectFolderInAnArea')}</p> : null}</section><h3>{t('share.currentAreas')}</h3><p className={css.detailHint}>{t('share.areasUseProjectFoldersAndEachConversation')}</p>{all.map(area => {
        return <article className={css.areaDetail} key={area.areaId} data-selected={areaId === area.areaId || undefined}>
          <div className={css.detailSectionHeader}><h3>{areaLabel(area.areaId)}</h3><span>{t('share.active')}</span></div>
          <p className={css.rootPath}>{record.areaProjects?.[area.areaId]?.relativePath ?? t('share.projectFolderNotSet')}</p>
          {area.moduleHistory.length ? <ul className={css.pageList}>{area.moduleHistory.map(page => <li key={page.moduleInstanceId}><span>{page.lastKnownTitle || editors.find(editor => editor.id === page.editorId)?.label || page.editorId}</span><small>{page.binding ? t('share.independentConversationSource') : t('share.projectOrResourcePage')}</small></li>)}</ul> : <p className={css.detailHint}>{t('share.noOpenPages')}</p>}
          <Button size="sm" disabled={!writable || !record.areaProjects?.[area.areaId]} onClick={() => setContext({ areaId: area.areaId, title: t('share.projectContextForValue1', { value1: record.projects?.[record.areaProjects?.[area.areaId]?.projectId ?? '']?.name ?? areaLabel(area.areaId) }), value: directory.getAreaContext?.(record.workbenchId, area.areaId)?.human.objective ?? '' })}>{t('shell.editProjectContext')}</Button>
        </article>
      })}</> : null}
      {tab === 'context' ? <>{Object.keys(record.projectMigration?.unassignedContexts ?? {}).length ? <section className={css.detailSection}><h3>{t('share.unassignedLegacyContext')}</h3><p>{t('share.theseLegacyAreasCouldNotBeMatched')}</p>{Object.entries(record.projectMigration!.unassignedContexts).map(([id, value]) => <details key={id}><summary>{t('share.sourceArea')}{id}</summary><pre className={css.backgroundText}>{renderAreaContextMarkdown(value)}</pre></details>)}</section> : null}<section className={css.detailSection}><div className={css.detailSectionHeader}><h3>{t('share.workbenchContext')}</h3><Button size="sm" disabled={!writable} onClick={() => setContext({ title: t('share.workbenchContext'), value: background })}>{t('share.editContext')}</Button></div><p className={css.backgroundText}>{background || t('share.noContextYet')}</p></section><section className={css.detailSection}><h3>{t('transfer.workbenchMemory')}</h3><p>{t('share.viewFactsDecisionsAndProgressBySource')}</p><Button variant="outline" disabled={!writable || !directory.memoryRequest} onClick={() => setMemory(true)}>{t('share.viewAndManageMemory')}</Button></section></> : null}
      {tab === 'sharing' ? <><section className={css.detailSection}><h3>{t('share.workbenchPackage')}</h3><p>{t('share.useDshbayZipForTemplateOrFull')}</p><Button variant="outline" disabled={!writable} onClick={() => navigate?.({ section: 'sharing', workbenchId: record.workbenchId, shareMode: 'export' })}>{t('share.openExportAndImport')}</Button></section><section className={css.detailSection}><h3>{t('share.onlineAccess')}</h3><p>{t('share.browserAndLocalNetworkGuestsUseThis')}</p><Button variant="outline" onClick={onOpen}>{writable ? t('share.enterWorkbench') : t('share.manageBrowserAndCollaboration')}</Button></section></> : null}
      {notice ? <p role="alert">{notice}</p> : null}
    </div>
    {context ? <WorkbenchContextDialog directory={directory} workbenchId={record.workbenchId} {...(context.areaId ? { areaId: context.areaId } : {})} title={context.title} initialValue={context.value} onClose={() => setContext(undefined)} {...(generateContextDraft ? { generateDraft: generateContextDraft } : {})} /> : null}
    {memory ? <WorkbenchMemoryDialog directory={directory} workbenchId={record.workbenchId} onClose={() => setMemory(false)} /> : null}
  </section>
}
