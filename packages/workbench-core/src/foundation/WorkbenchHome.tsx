import { useWorkbenchLocale } from './workbench-locale.ts'
import { useMemo, useState, useSyncExternalStore } from 'react'
import {
  Button, Input, Pill,
  IconFolderOpenOutlineMedium, IconPlusOutlineMedium,
  IconSearchOutlineMedium, IconPanelLeftOutlineMedium,
  IconAppsAddOutlineMedium, IconNewChatOutlineMedium, IconSettingsOutlineMedium,
  IconArchiveOutlineMedium, IconGlobeOutlineMedium, IconChevronRightOutlineMedium,
  IconPinOutlineMedium, IconPinFillMedium, Menu, IconEllipsisOutlineMedium,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { DESKTOP_SETTINGS_CONTEXT, settingsTargetWritable, type WorkbenchSettingsOpenOptionsV1 } from './settings-context.ts'
import type { WorkbenchWindowControllerV1 } from '../client/workbench-window-controller.ts'
import { useSettingsAction } from './WorkbenchSettingsPages.tsx'
import type { WorkbenchDirectory } from './frame-settings-adapter.ts'
import type { WorkbenchEditorCatalogRow } from './catalog.ts'
import { WorkbenchOverviewDetail } from './WorkbenchOverviewDetail.tsx'
import type { WorkbenchSettingsV4 } from './persistence.ts'
import { areasOf } from './document-v3.ts'
import { workbenchAreas } from './area-identity.ts'
import { WorkbenchCreateDialog } from './WorkbenchCreateDialog.tsx'
import { WorkbenchCreateMenu } from './WorkbenchCreateMenu.tsx'
import type { WorkbenchLayoutPresetId } from './workbench-layout-presets.ts'
import { WorkbenchHomeNavigation } from './WorkbenchHomeNavigation.tsx'
import css from './WorkbenchHome.module.css'

export interface WorkbenchHomeProps {
  value?: WorkbenchSettingsV4 | undefined
  initialSelectedId?: string
  directory: WorkbenchDirectory
  editors?: readonly WorkbenchEditorCatalogRow[]
  navigate?: ((options?: WorkbenchSettingsOpenOptionsV1) => void) | undefined
  windowController?: WorkbenchWindowControllerV1 | undefined
  onOpenWorkbench: (workbenchId: string) => Promise<void>
  onCreated: (workbenchId: string) => void
  generateContextDraft?: ((input: import('./workbench-ai.ts').WorkbenchAiDraftInputV1) => Promise<string>) | undefined
}

export function WorkbenchHome({ value, initialSelectedId, directory, editors = [], navigate, windowController, onOpenWorkbench, onCreated, generateContextDraft }: WorkbenchHomeProps) {
  const { t } = useWorkbenchLocale()
  const snapshot = useSyncExternalStore(directory.subscribe, directory.getSnapshot, directory.getSnapshot)
  const [createPreset, setCreatePreset] = useState<WorkbenchLayoutPresetId>()
  const [busyId, setBusyId] = useState<string>()
  const [menuId, setMenuId] = useState<string>()
  const [selectedId, setSelectedId] = useState(initialSelectedId ?? snapshot.activeWorkbenchId)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('all')
  const action = useSettingsAction({ busy: 'home.working', success: 'home.done' })

  const rows = useMemo(() => [...snapshot.rows].sort((left, right) => {
    if ((left.pinnedAt ?? 0) !== (right.pinnedAt ?? 0)) return (right.pinnedAt ?? 0) - (left.pinnedAt ?? 0)
    return right.updatedAt - left.updatedAt
  }), [snapshot.rows])
  const activeIds = useMemo(() => new Set(snapshot.openWorkbenchIds), [snapshot.openWorkbenchIds])
  const firstRun = rows.length === 0 && snapshot.invalidRows.length === 0


  const open = async (workbenchId: string) => {
    if (busyId !== undefined) return
    setBusyId(workbenchId)
    try { await action.run(workbenchId, () => onOpenWorkbench(workbenchId)) } finally { setBusyId(undefined) }
  }

  const restore = async (workbenchId: string) => {
    if (busyId !== undefined) return
    setBusyId(workbenchId)
    try { await action.run(workbenchId, () => directory.restore(workbenchId)) } finally { setBusyId(undefined) }
  }

  const reclaimBrowser = (workbenchId: string) => {
    if (busyId !== undefined || !windowController?.reclaim) return
    return action.run('reclaim-' + workbenchId, async () => {
      setBusyId(workbenchId)
      try {
        const result = await windowController.reclaim!(workbenchId)
        if (result.status !== 'reclaimed') {
          const message = result.code === 'browser-view-reclaim-timeout'
            ? t('home.theBrowserDidNotConfirmInTime2')
            : result.code === 'browser-view-not-ready'
              ? t('home.theBrowserWorkbenchIsNotReadyRefresh2')
              : t('home.reclaimFailed', { detail: result.code ? ` (${result.code})` : '' })
          throw new Error(message)
        }
        return true
      } finally { setBusyId(undefined) }
    })
  }

  const archive = async (workbenchId: string) => {
    if (busyId !== undefined) return
    setBusyId(workbenchId)
    try { await action.run(workbenchId, () => directory.archive(workbenchId)) } finally { setBusyId(undefined) }
  }

  const filtered = rows.filter(row => (filter === 'all' || (filter === 'archived' ? row.archivedAt !== undefined
    : row.archivedAt === undefined && (filter === 'open' ? activeIds.has(row.workbenchId) : !activeIds.has(row.workbenchId))))
    && [row.name, row.description, ...(row.tags ?? [])].join(' ').toLocaleLowerCase().includes(query.toLocaleLowerCase()))

  const filters = [
    ['all', t('home.all'), rows.length],
    ['open', t('home.open'), rows.filter(row => row.archivedAt === undefined && activeIds.has(row.workbenchId)).length],
    ['inactive', t('home.closed'), rows.filter(row => row.archivedAt === undefined && !activeIds.has(row.workbenchId)).length],
    ['archived', t('home.archived'), rows.filter(row => row.archivedAt !== undefined).length],
  ] as const

  return <main className={css.home} data-workbench-home>
    <div className={css.overview}>
      <header className={css.hero}>
        <div><h1>{t('home.yourWorkbenches')}</h1><p className={css.heroCopy}>{t('home.organizeYourConversationsFilesAndToolsIn')}</p></div>
        <div className={css.heroActions} role="group" aria-label={t('home.workbenchShortcuts')}>
          <Button variant="outline" icon={<IconFolderOpenOutlineMedium size={16} />} onClick={() => navigate?.({ section: 'sharing', shareMode: 'import' })}>{t('home.importWorkbenchPackage')}</Button>
          <WorkbenchCreateMenu onSelect={setCreatePreset} onImport={navigate ? () => navigate({ section: 'sharing', shareMode: 'import' }) : undefined} anchor={props => <Button variant="primary" icon={<IconPlusOutlineMedium size={16} />} {...props}>{t('home.createWorkbench')}</Button>} />
        </div>
      </header>
      <WorkbenchHomeNavigation navigate={options => navigate?.(options)} />

      {firstRun ? <section className={css.firstRun} aria-labelledby="workbench-home-guide-title">
        <div className={css.emptyMark} aria-hidden="true"><IconPanelLeftOutlineMedium size={30} /></div>
        <h2 id="workbench-home-guide-title">{t('home.startWithAWorkbench')}</h2>
        <p className={css.firstRunDescription}>{t('home.makeRoomForAProjectATask')}</p>
        <WorkbenchCreateMenu onSelect={setCreatePreset} onImport={navigate ? () => navigate({ section: 'sharing', shareMode: 'import' }) : undefined} anchor={props => <Button variant="primary" icon={<IconPlusOutlineMedium size={16} />} {...props}>{t('home.createYourFirstWorkbench2')}</Button>} />
        <p className={css.firstRunHint}>{t('home.haveAWorkbenchPackageFromYourTeam')}<button type="button" onClick={() => navigate?.({ section: 'sharing', shareMode: 'import' })}>{t('home.importAndContinue')}</button></p>
      </section> : <section aria-label={t('home.allWorkbenches')}>
        <div className={css.libraryToolbar}>
          <div className={css.filters} role="group" aria-label={t('home.filterByWorkbenchStatus')}>{filters.map(([id, label, count]) => <Pill key={id} active={filter === id} aria-pressed={filter === id} onClick={() => setFilter(id)}>{label}<span className={css.filterCount}>{count}</span></Pill>)}</div>
          <Input className={css.search ?? ''} icon={<IconSearchOutlineMedium size={16} />} type="search" aria-label={t('home.searchWorkbenches')} placeholder={t('home.searchWorkbenches')} value={query} onChange={event => setQuery(event.target.value)} />
        </div>
        {filtered.length ? <div className={css.masterDetail}>
          <aside className={css.workbenchList} aria-label={t('home.selectAWorkbench')}><div className={css.workbenchRows}>{filtered.map(row => {
            const selected = (filtered.some(item => item.workbenchId === selectedId) ? selectedId : filtered[0]?.workbenchId) === row.workbenchId
            const pinned = snapshot.sidebarShortcuts?.includes(row.workbenchId) === true
            const browser = !settingsTargetWritable(DESKTOP_SETTINGS_CONTEXT, row.workbenchId, windowController)
            const windowsSnapshot = windowController?.getSnapshot()
            const windowRequests = windowsSnapshot?.requests ?? (windowsSnapshot?.request ? [windowsSnapshot.request] : [])
            const browserRequest = windowRequests.find(request => request.workbenchId === row.workbenchId)
            const reclaiming = browserRequest?.status === 'reclaiming'
            const status = browser ? 'browser' : row.archivedAt !== undefined ? 'archived' : activeIds.has(row.workbenchId) ? 'open' : 'inactive'
            const record = value?.workbenches[row.workbenchId]
            const pages = record ? areasOf(record.document.root).flatMap(area => area.moduleHistory) : []
            const sessions = record ? new Set([...Object.values(record.sessionCatalog ?? {}).map(entry => entry.sessionId ?? entry.sessionKey), ...pages.flatMap(page => page.binding ? [page.binding.sessionId] : [])]) : undefined
            return <article key={row.workbenchId} className={css.workbenchRow} aria-label={row.name} data-selected={selected || undefined}>
              <button type="button" className={css.workbenchSelect} aria-label={row.name} aria-pressed={selected} onClick={() => setSelectedId(row.workbenchId)}>
                <span className={css.rowHeading}><span className={css.rowMark} aria-hidden="true"><IconPanelLeftOutlineMedium size={21} /></span><strong title={row.name}>{row.name}</strong><span className={css.rowStatus} data-status={status}>{status === 'archived' ? <IconArchiveOutlineMedium size={12} /> : status === 'browser' ? <IconGlobeOutlineMedium size={12} /> : <i aria-hidden="true" />}{status === 'browser' ? [t('home.openInBrowser'), ...(row.archivedAt !== undefined ? [t('home.archived')] : [])].join(' · ') : status === 'archived' ? t('home.archived') : status === 'open' ? t('home.open') : t('home.closed')}</span></span>
                <span className={css.rowDescription}>{row.description || t('home.addADescriptionToExplainWhatThis')}</span>
                <span className={css.rowStats} aria-label={t('home.workbenchContents')}>
                  <span title={t('home.visibleAreas')}><IconPanelLeftOutlineMedium size={14} /><b>{record ? workbenchAreas(record).length : '—'}</b><span>{t('home.areas')}</span></span>
                  <span title={t('home.openPagesInThisWorkbench')}><IconAppsAddOutlineMedium size={14} /><b>{record ? pages.length : '—'}</b><span>{t('home.pages')}</span></span>
                  <span title={t('home.conversationsAreKeptAfterTheirPagesClose')}><IconNewChatOutlineMedium size={14} /><b>{sessions?.size ?? '—'}</b><span>{t('home.conversations')}</span></span>
                </span>
              </button>
              <div className={css.workbenchRowFooter}>
                <button type="button" className={css.sidebarPin} aria-label={pinned ? t('home.pinnedToTheDshSidebar') : t('home.pinToTheDshSidebar')} title={pinned ? t('home.unpinFromTheDshSidebar') : t('home.pinToTheDshSidebar')} aria-pressed={pinned} disabled={!directory.setSidebarPinned || !!action.states['pin-' + row.workbenchId]?.busy} onClick={() => void action.run('pin-' + row.workbenchId, () => directory.setSidebarPinned!(row.workbenchId, !pinned))}>{pinned ? <IconPinFillMedium size={14} /> : <IconPinOutlineMedium size={14} />}{pinned ? t('home.pinned') : t('home.pinToSidebar')}</button>
                <div className={css.rowUtilities}>
                  {browser ? <Button size="sm" aria-label={t('home.takeBackControl1', { value1: row.name })} title={t('home.takeBackControlFromTheBrowser')} disabled={busyId !== undefined || !windowController?.reclaim} onClick={() => void reclaimBrowser(row.workbenchId)}>{reclaiming ? t('home.takingBackControl') : t('home.takeBackControl')}</Button> : null}
                  {row.archivedAt ? <Button size="sm" aria-label={t('home.restoreWorkbench1', { value1: row.name })} title={t('home.restoreWorkbench')} disabled={browser || busyId !== undefined} onClick={() => void restore(row.workbenchId)}><IconArchiveOutlineMedium size={14} /></Button> : null}
                  <Button size="sm" icon={<IconSettingsOutlineMedium size={14} />} onClick={() => navigate?.({ section: 'workbenches', workbenchId: row.workbenchId })}>{t('action.manage')}</Button>
                  <Menu open={menuId === row.workbenchId} onClose={() => setMenuId(undefined)} align="end" portal autoFocus anchor={<Button size="sm" aria-label={t('home.moreActions') + row.name} aria-haspopup="menu" aria-expanded={menuId === row.workbenchId} onClick={() => setMenuId(row.workbenchId)}><IconEllipsisOutlineMedium size={16} /></Button>} items={[{ id: 'export', label: t('home.exportWorkbench'), disabled: browser || !!row.archivedAt }, { id: 'archive', label: row.archivedAt ? t('home.restoreWorkbench') : t('home.archiveWorkbench'), disabled: browser || busyId !== undefined }]} onSelect={id => { setMenuId(undefined); if (id === 'export') navigate?.({ section: 'sharing', workbenchId: row.workbenchId, shareMode: 'export' }); else if (row.archivedAt) void restore(row.workbenchId); else void archive(row.workbenchId) }} />
                </div>
              </div>
              <div className={css.rowFeedback}>{browser ? <span role="status">{reclaiming ? t('home.waitingForTheBrowserToReleaseControl') : t('home.takeBackControlFromTheBrowserBefore')}</span> : null}{action.states['reclaim-' + row.workbenchId]?.error || action.states['reclaim-' + row.workbenchId]?.busy ? action.feedback('reclaim-' + row.workbenchId) : null}{action.states['pin-' + row.workbenchId]?.error || action.states['pin-' + row.workbenchId]?.busy ? action.feedback('pin-' + row.workbenchId) : null}{action.states[row.workbenchId]?.error || action.states[row.workbenchId]?.busy ? action.feedback(row.workbenchId) : null}</div>
            </article>
          })}</div>
            <section className={css.addWorkbenchCard} aria-label={t('home.addWorkbench')}>
              <Button className={css.addWorkbenchAction} aria-label={t('home.importWorkbenchPackage')} disabled={!navigate} onClick={() => navigate?.({ section: 'sharing', shareMode: 'import' })}><span className={css.addWorkbenchIcon}><IconFolderOpenOutlineMedium size={20} /></span><span className={css.addWorkbenchCopy}><strong>{t('home.importWorkbenchPackage')}</strong><small>{t('home.continueWithAnExistingWorkspace')}</small></span><IconChevronRightOutlineMedium size={16} /></Button>
              <WorkbenchCreateMenu onSelect={setCreatePreset} anchor={props => <Button className={css.addWorkbenchAction} aria-label={t('home.createWorkbench')} {...props}><span className={css.addWorkbenchIcon} data-accent><IconPlusOutlineMedium size={20} /></span><span className={css.addWorkbenchCopy}><strong>{t('home.createWorkbench')}</strong><small>{t('home.startFromScratchOrUseALayout')}</small></span><IconChevronRightOutlineMedium size={16} /></Button>} />
            </section>
          </aside>
          {(() => { const row = filtered.find(row => row.workbenchId === selectedId) ?? filtered[0]!; const record = value?.workbenches[row.workbenchId]; return record ? <WorkbenchOverviewDetail key={row.workbenchId} record={record} directory={directory} editors={editors} navigate={navigate} windowController={windowController} onOpenWorkbench={onOpenWorkbench} onCreated={onCreated} generateContextDraft={generateContextDraft} onOpen={() => void open(row.workbenchId)} onReclaim={() => void reclaimBrowser(row.workbenchId)} writable={settingsTargetWritable(DESKTOP_SETTINGS_CONTEXT, row.workbenchId, windowController)} busy={busyId !== undefined} /> : <section className={css.selectedDetail}><h2>{row.name}</h2><p>{t('home.loadingWorkbenchDetails')}</p><Button onClick={() => void open(row.workbenchId)}>{t('home.openWorkbench')}</Button></section> })()}
        </div> : <div className={css.noResults} role="status"><IconSearchOutlineMedium size={24} /><h2>{t('home.noWorkbenchesFound')}</h2><p>{query ? t('home.tryADifferentNameDescriptionOrTag') : t('home.noWorkbenchesInThisCategoryYet')}</p><Button variant="outline" onClick={() => { setFilter('all'); setQuery('') }}>{t('home.showAllWorkbenches')}</Button></div>}
        <p className={css.librarySummary}>{t('home.librarySummary', { total: rows.length, open: snapshot.openWorkbenchIds.length })}<span>{t('home.layoutsAndPagesAreSavedAutomatically')}</span></p>
      </section>}

      {snapshot.invalidRows.length > 0 ? <section className={css.warningSection} aria-labelledby="workbench-home-invalid-title">
        <h2 id="workbench-home-invalid-title">{t('home.workbenchesThatNeedAttention')}</h2><p>{t('home.theOriginalRecordsArePreservedSeeThe')}</p>
        {snapshot.invalidRows.map(row => <article className={css.invalidCard} key={row.workbenchId}><div><strong>{row.name || row.workbenchId}</strong><p>{row.description || t('home.thisRecordNeedsToBeMigratedOr')}</p></div><Button variant="outline" onClick={() => navigate?.({ section: 'workbenches', workbenchId: row.workbenchId })}>{t('home.viewDiagnostics')}</Button></article>)}
      </section> : null}
    </div>

    {createPreset ? <WorkbenchCreateDialog directory={directory} presetId={createPreset} onClose={() => setCreatePreset(undefined)} onCreated={onCreated} {...(generateContextDraft === undefined ? {} : { generateDraft: generateContextDraft })} /> : null}
  </main>
}
