import { useWorkbenchLocale, workbenchIntlLocale } from './workbench-locale.ts'
import { useState, type ReactNode } from 'react'
import { Button, Menu, IconEllipsisOutlineMedium, IconShareOutlineMedium, IconArchiveOutlineMedium, IconPinOutlineMedium, IconChevronRightOutlineMedium } from '@deepseek-ai/dsh-client-ui-primitives'
import type { WorkbenchDirectorySnapshot } from './frame-settings-adapter.ts'
import { areasOf, type WorkbenchDocumentV3 } from './document-v3.ts'
import type { WorkbenchEditorCatalogRow } from './catalog.ts'
import { WorkbenchHomePreview } from './WorkbenchHomePreview.tsx'
import css from './WorkbenchHome.module.css'
import { FloatingWorkspaceUnread } from './FloatingWorkspaceContext.tsx'

type HomeRow = WorkbenchDirectorySnapshot['rows'][number]
export function WorkbenchHomeCard({ row, document, editors, opened, writable, busy, onOpen, onRestore, onArchive, onExport, onManage, feedback }: {
  row: HomeRow; document: WorkbenchDocumentV3 | undefined; editors: readonly WorkbenchEditorCatalogRow[]
  opened: boolean; writable: boolean; busy: boolean
  onOpen(): void; onRestore(): void; onArchive(): void; onExport(): void; onManage(): void; feedback: ReactNode
}) {
  const { t, language } = useWorkbenchLocale()
  const [menuOpen, setMenuOpen] = useState(false)
  const archived = row.archivedAt !== undefined
  const areas = document ? areasOf(document.root) : undefined
  const pageCount = areas?.reduce((total, area) => total + area.moduleHistory.length, 0)
  const status = !writable ? t('home.openInBrowser') : archived ? t('home.archived') : opened ? t('home.open') : t('home.closed')
  const origin = row.offlineOrigin ? t('home.importedFromAnOfflinePackage') : row.packageOrigin ? t('home.importedFromAWorkbenchPackage') : t('home.createdLocally')
  const modified = row.updatedAt > 0 ? new Intl.DateTimeFormat(workbenchIntlLocale(language), { month: 'short', day: 'numeric' }).format(row.updatedAt) : t('home.notYetModified')
  return <article className={css.card} data-open={opened || undefined} data-archived={archived || undefined} aria-label={row.name}>
    <div className={css.cardTopline}>
      <span className={css.cardStatus} data-status={!writable ? 'browser' : archived ? 'archived' : opened ? 'open' : 'closed'}><i aria-hidden="true" />{status}</span>
      <div className={css.cardUtilities}>
        {row.pinnedAt !== undefined ? <span title={t('home.pinned2')} className={css.pin}><IconPinOutlineMedium size={14} /></span> : null}
        <Menu open={menuOpen} onClose={() => setMenuOpen(false)} align="end" portal autoFocus
          anchor={<Button size="sm" aria-label={t('home.moreActions') + row.name} aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen(value => !value)}><IconEllipsisOutlineMedium size={18} /></Button>}
          items={[
            { id: 'manage', label: t('home.manageWorkbench') },
            ...(!archived ? [
              { id: 'export', label: t('home.exportWorkbench'), icon: <IconShareOutlineMedium size={16} />, disabled: busy || !writable },
              { type: 'separator' as const, id: 'lifecycle' },
              { id: 'archive', label: t('home.archiveWorkbench'), icon: <IconArchiveOutlineMedium size={16} />, disabled: busy || !writable },
            ] : [{ id: 'restore', label: t('home.restoreWorkbench'), disabled: busy || !writable }]),
          ]}
          onSelect={id => { setMenuOpen(false); if (id === 'manage') onManage(); else if (id === 'export') onExport(); else if (id === 'archive') onArchive(); else if (id === 'restore') onRestore() }} />
      </div>
    </div>
    <div className={css.layoutPreview} aria-hidden="true">{document ? <WorkbenchHomePreview node={document.root} editors={editors} /> : <span className={css.previewUnavailable}>{t('home.layoutPreviewUnavailable')}</span>}</div>
    <div className={css.cardBody}>
      <h3 title={row.name}>{row.name}<FloatingWorkspaceUnread workbenchId={row.workbenchId} /></h3>
      <p className={css.cardDescription} title={row.description}>{row.description || t('home.aPlaceForYourConversationsFilesAnd')}</p>
      <div className={css.tags}>{row.tags?.slice(0, 3).map(tag => <span key={tag} title={tag}>{tag}</span>)}{row.tags && row.tags.length > 3 ? <span title={row.tags.slice(3).join('、')}>+{row.tags.length - 3}</span> : null}</div>
      <div className={css.cardMeta}><span>{areas ? t('layout.areaCount', { count: areas.length }) + ' · ' + t('layout.pageCount', { count: pageCount ?? 0 }) : t('home.layoutSummaryUnavailable')}</span><time dateTime={row.updatedAt > 0 ? new Date(row.updatedAt).toISOString() : undefined} title={t('home.lastModified') + (row.updatedAt > 0 ? new Date(row.updatedAt).toLocaleString(workbenchIntlLocale(language)) : modified)}>{modified}</time></div>
    </div>
    <footer className={css.cardFooter}>
      <span className={css.origin}>{origin}</span>
      <div className={css.cardActions}>
        <Button size="sm" onClick={onManage}>{t('action.manage')}</Button>
        <Button size="sm" variant="outline" disabled={busy || !writable} onClick={archived ? onRestore : onOpen}>{archived ? t('home.restore') : opened ? t('home.returnToWorkbench') : t('home.openWorkbench')}<IconChevronRightOutlineMedium size={14} /></Button>
      </div>
    </footer>
    {!writable ? <p className={css.cardNotice}>{t('home.takeBackControlFromTheBrowserOn')}</p> : null}
    {feedback ? <div className={css.cardNotice}>{feedback}</div> : null}
  </article>
}
