import { useMemo, useState, useSyncExternalStore } from 'react'
import {
  Button, Input, Pill,
  IconFolderOpenOutlineMedium, IconPlusOutlineMedium,
  IconSearchOutlineMedium, IconPanelLeftOutlineMedium,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { DESKTOP_SETTINGS_CONTEXT, settingsTargetWritable, type WorkbenchSettingsOpenOptionsV1 } from './settings-context.ts'
import type { WorkbenchWindowControllerV1 } from '../client/workbench-window-controller.ts'
import { useSettingsAction } from './WorkbenchSettingsPages.tsx'
import type { WorkbenchDirectory } from './frame-settings-adapter.ts'
import type { WorkbenchEditorCatalogRow } from './catalog.ts'
import { WorkbenchOverviewDetail } from './WorkbenchOverviewDetail.tsx'
import type { WorkbenchSettingsV4 } from './persistence.ts'
import { IconPinOutlineMedium, Menu, IconEllipsisOutlineMedium } from '@deepseek-ai/dsh-client-ui-primitives'
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
  const snapshot = useSyncExternalStore(directory.subscribe, directory.getSnapshot, directory.getSnapshot)
  const [createPreset, setCreatePreset] = useState<WorkbenchLayoutPresetId>()
  const [busyId, setBusyId] = useState<string>()
  const [menuId, setMenuId] = useState<string>()
  const [selectedId, setSelectedId] = useState(initialSelectedId ?? snapshot.activeWorkbenchId)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('all')
  const action = useSettingsAction({ busy: '正在处理…', success: '已完成' })

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

  const archive = async (workbenchId: string) => {
    if (busyId !== undefined) return
    setBusyId(workbenchId)
    try { await action.run(workbenchId, () => directory.archive(workbenchId)) } finally { setBusyId(undefined) }
  }

  const filtered = rows.filter(row => (filter === 'all' || (filter === 'archived' ? row.archivedAt !== undefined
    : row.archivedAt === undefined && (filter === 'open' ? activeIds.has(row.workbenchId) : !activeIds.has(row.workbenchId))))
    && [row.name, row.description, ...(row.tags ?? [])].join(' ').toLocaleLowerCase().includes(query.toLocaleLowerCase()))

  const filters = [
    ['all', '全部', rows.length],
    ['open', '已打开', rows.filter(row => row.archivedAt === undefined && activeIds.has(row.workbenchId)).length],
    ['inactive', '未打开', rows.filter(row => row.archivedAt === undefined && !activeIds.has(row.workbenchId)).length],
    ['archived', '已归档', rows.filter(row => row.archivedAt !== undefined).length],
  ] as const

  return <main className={css.home} data-workbench-home>
    <div className={css.overview}>
      <header className={css.hero}>
        <div><h1>你的工作台</h1><p className={css.heroCopy}>把会话、文件和工具，整理成适合你的工作空间。</p></div>
        <div className={css.heroActions}>
          <Button variant="outline" icon={<IconFolderOpenOutlineMedium size={16} />} onClick={() => navigate?.({ section: 'sharing', shareMode: 'import' })}>导入工作台包</Button>
          <WorkbenchCreateMenu onSelect={setCreatePreset} onImport={navigate ? () => navigate({ section: 'sharing', shareMode: 'import' }) : undefined} anchor={props => <Button variant="primary" icon={<IconPlusOutlineMedium size={16} />} {...props}>创建工作台</Button>} />
        </div>
      </header>
      <WorkbenchHomeNavigation navigate={options => navigate?.(options)} />

      {firstRun ? <section className={css.firstRun} aria-labelledby="workbench-home-guide-title">
        <div className={css.emptyMark} aria-hidden="true"><IconPanelLeftOutlineMedium size={30} /></div>
        <h2 id="workbench-home-guide-title">从这里，开始你的工作台</h2>
        <p className={css.firstRunDescription}>为一个项目、一项任务，或一段专注的时间，留出自己的空间。</p>
        <WorkbenchCreateMenu onSelect={setCreatePreset} onImport={navigate ? () => navigate({ section: 'sharing', shareMode: 'import' }) : undefined} anchor={props => <Button variant="primary" icon={<IconPlusOutlineMedium size={16} />} {...props}>创建第一个工作台</Button>} />
        <p className={css.firstRunHint}>已收到团队的工作台包？<button type="button" onClick={() => navigate?.({ section: 'sharing', shareMode: 'import' })}>导入并继续</button></p>
      </section> : <section aria-label="全部工作台">
        <div className={css.libraryToolbar}>
          <div className={css.filters} role="group" aria-label="按工作台状态筛选">{filters.map(([id, label, count]) => <Pill key={id} active={filter === id} aria-pressed={filter === id} onClick={() => setFilter(id)}>{label}<span className={css.filterCount}>{count}</span></Pill>)}</div>
          <Input className={css.search ?? ''} icon={<IconSearchOutlineMedium size={16} />} type="search" aria-label="搜索工作台" placeholder="搜索工作台" value={query} onChange={event => setQuery(event.target.value)} />
        </div>
        {filtered.length ? <div className={css.masterDetail}>
          <aside className={css.workbenchList} aria-label="选择工作台">{filtered.map(row => {
            const selected = (filtered.some(item => item.workbenchId === selectedId) ? selectedId : filtered[0]?.workbenchId) === row.workbenchId
            const pinned = snapshot.sidebarShortcuts?.includes(row.workbenchId) === true
            const browser = !settingsTargetWritable(DESKTOP_SETTINGS_CONTEXT, row.workbenchId, windowController)
            return <article key={row.workbenchId} className={css.workbenchRow} aria-label={row.name} data-selected={selected || undefined}>
              <button className={css.workbenchSelect} aria-pressed={selected} onClick={() => setSelectedId(row.workbenchId)}><span className={css.rowMark}><IconPanelLeftOutlineMedium size={18} /></span><span><strong>{row.name}</strong><small>{row.description || '暂无简介'}</small></span></button>
              <div className={css.workbenchRowFooter}><button className={css.sidebarPin} aria-label={pinned ? '已固定到 DSH 侧栏' : '固定到 DSH 侧栏'} title={pinned ? '已固定到 DSH 侧栏' : '固定到 DSH 侧栏'} aria-pressed={pinned} disabled={!directory.setSidebarPinned || !!action.states['pin-' + row.workbenchId]?.busy} onClick={() => void action.run('pin-' + row.workbenchId, () => directory.setSidebarPinned!(row.workbenchId, !pinned))}><IconPinOutlineMedium size={14} />{pinned ? '已固定' : '固定到侧栏'}</button><span>{row.archivedAt ? '已归档' : browser ? '浏览器中' : activeIds.has(row.workbenchId) ? '已打开' : '未打开'}</span></div>
              {row.archivedAt ? <Button size="sm" disabled={busyId !== undefined} onClick={() => void restore(row.workbenchId)}>恢复工作台</Button> : null}
              <div className={css.rowUtilities}><Button size="sm" onClick={() => navigate?.({ section: 'workbenches', workbenchId: row.workbenchId })}>管理</Button><Menu open={menuId === row.workbenchId} onClose={() => setMenuId(undefined)} align="end" portal autoFocus anchor={<Button size="sm" aria-label={'更多操作：' + row.name} aria-haspopup="menu" aria-expanded={menuId === row.workbenchId} onClick={() => setMenuId(row.workbenchId)}><IconEllipsisOutlineMedium size={16} /></Button>} items={[{ id: 'export', label: '导出工作台', disabled: browser || !!row.archivedAt }, { id: 'archive', label: row.archivedAt ? '恢复工作台' : '归档工作台', disabled: browser || busyId !== undefined }]} onSelect={id => { setMenuId(undefined); if (id === 'export') navigate?.({ section: 'sharing', workbenchId: row.workbenchId, shareMode: 'export' }); else if (row.archivedAt) void restore(row.workbenchId); else void archive(row.workbenchId) }} /></div>
              {action.feedback('pin-' + row.workbenchId)}{action.feedback(row.workbenchId)}
            </article>
          })}</aside>
          {(() => { const row = filtered.find(row => row.workbenchId === selectedId) ?? filtered[0]!; const record = value?.workbenches[row.workbenchId]; return record ? <WorkbenchOverviewDetail key={row.workbenchId} record={record} directory={directory} editors={editors} navigate={navigate} windowController={windowController} onOpenWorkbench={onOpenWorkbench} onCreated={onCreated} generateContextDraft={generateContextDraft} onOpen={() => void open(row.workbenchId)} writable={settingsTargetWritable(DESKTOP_SETTINGS_CONTEXT, row.workbenchId, windowController)} busy={busyId !== undefined} /> : <section className={css.selectedDetail}><h2>{row.name}</h2><p>正在读取工作台详情…</p><Button onClick={() => void open(row.workbenchId)}>打开工作台</Button></section> })()}
        </div> : <div className={css.noResults} role="status"><IconSearchOutlineMedium size={24} /><h2>没有找到工作台</h2><p>{query ? '试试其他名称、简介或标签。' : '这个分类里还没有工作台。'}</p><Button variant="outline" onClick={() => { setFilter('all'); setQuery('') }}>查看全部工作台</Button></div>}
        <p className={css.librarySummary}>{rows.length} 个工作台 · {snapshot.openWorkbenchIds.length} 个已打开<span>布局和内页会自动保留</span></p>
      </section>}

      {snapshot.invalidRows.length > 0 ? <section className={css.warningSection} aria-labelledby="workbench-home-invalid-title">
        <h2 id="workbench-home-invalid-title">需要检查的工作台</h2><p>原始记录已保留，可在管理页查看诊断。</p>
        {snapshot.invalidRows.map(row => <article className={css.invalidCard} key={row.workbenchId}><div><strong>{row.name || row.workbenchId}</strong><p>{row.description || '记录格式需要迁移或修复。'}</p></div><Button variant="outline" onClick={() => navigate?.({ section: 'workbenches', workbenchId: row.workbenchId })}>打开诊断</Button></article>)}
      </section> : null}
    </div>

    {createPreset ? <WorkbenchCreateDialog directory={directory} presetId={createPreset} onClose={() => setCreatePreset(undefined)} onCreated={onCreated} {...(generateContextDraft === undefined ? {} : { generateDraft: generateContextDraft })} /> : null}
  </main>
}
