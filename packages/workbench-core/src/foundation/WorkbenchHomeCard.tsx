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
  const [menuOpen, setMenuOpen] = useState(false)
  const archived = row.archivedAt !== undefined
  const areas = document ? areasOf(document.root) : undefined
  const pageCount = areas?.reduce((total, area) => total + area.moduleHistory.length, 0)
  const status = !writable ? '浏览器运行中' : archived ? '已归档' : opened ? '已打开' : '未打开'
  const origin = row.offlineOrigin ? '离线包导入' : row.packageOrigin ? '工作台包导入' : '本地创建'
  const modified = row.updatedAt > 0 ? new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric' }).format(row.updatedAt) : '尚未修改'
  return <article className={css.card} data-open={opened || undefined} data-archived={archived || undefined} aria-label={row.name}>
    <div className={css.cardTopline}>
      <span className={css.cardStatus} data-status={!writable ? 'browser' : archived ? 'archived' : opened ? 'open' : 'closed'}><i aria-hidden="true" />{status}</span>
      <div className={css.cardUtilities}>
        {row.pinnedAt !== undefined ? <span title="已置顶" className={css.pin}><IconPinOutlineMedium size={14} /></span> : null}
        <Menu open={menuOpen} onClose={() => setMenuOpen(false)} align="end" portal autoFocus
          anchor={<Button size="sm" aria-label={'更多操作：' + row.name} aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen(value => !value)}><IconEllipsisOutlineMedium size={18} /></Button>}
          items={[
            { id: 'manage', label: '管理工作台' },
            ...(!archived ? [
              { id: 'export', label: '导出工作台', icon: <IconShareOutlineMedium size={16} />, disabled: busy || !writable },
              { type: 'separator' as const, id: 'lifecycle' },
              { id: 'archive', label: '归档工作台', icon: <IconArchiveOutlineMedium size={16} />, disabled: busy || !writable },
            ] : [{ id: 'restore', label: '恢复工作台', disabled: busy || !writable }]),
          ]}
          onSelect={id => { setMenuOpen(false); if (id === 'manage') onManage(); else if (id === 'export') onExport(); else if (id === 'archive') onArchive(); else if (id === 'restore') onRestore() }} />
      </div>
    </div>
    <div className={css.layoutPreview} aria-hidden="true">{document ? <WorkbenchHomePreview node={document.root} editors={editors} /> : <span className={css.previewUnavailable}>布局预览暂不可用</span>}</div>
    <div className={css.cardBody}>
      <h3 title={row.name}>{row.name}<FloatingWorkspaceUnread workbenchId={row.workbenchId} /></h3>
      <p className={css.cardDescription} title={row.description}>{row.description || '会话、文件和工具，在这里各就其位。'}</p>
      <div className={css.tags}>{row.tags?.slice(0, 3).map(tag => <span key={tag} title={tag}>{tag}</span>)}{row.tags && row.tags.length > 3 ? <span title={row.tags.slice(3).join('、')}>+{row.tags.length - 3}</span> : null}</div>
      <div className={css.cardMeta}><span>{areas ? areas.length + ' 个区域 · ' + pageCount + ' 个内页' : '布局摘要不可用'}</span><time dateTime={row.updatedAt > 0 ? new Date(row.updatedAt).toISOString() : undefined} title={'最后修改：' + (row.updatedAt > 0 ? new Date(row.updatedAt).toLocaleString() : modified)}>{modified}</time></div>
    </div>
    <footer className={css.cardFooter}>
      <span className={css.origin}>{origin}</span>
      <div className={css.cardActions}>
        <Button size="sm" onClick={onManage}>管理</Button>
        <Button size="sm" variant="outline" disabled={busy || !writable} onClick={archived ? onRestore : onOpen}>{archived ? '恢复' : opened ? '返回工作台' : '打开工作台'}<IconChevronRightOutlineMedium size={14} /></Button>
      </div>
    </footer>
    {!writable ? <p className={css.cardNotice}>在浏览器运行中，请从管理页收回后操作。</p> : null}
    {feedback ? <div className={css.cardNotice}>{feedback}</div> : null}
  </article>
}
