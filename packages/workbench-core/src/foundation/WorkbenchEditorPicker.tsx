import { useState } from 'react'
import { Input, IconSearchOutlineMedium, IconChevronRightOutlineMedium, IconFolderCloseMedium, IconFolderOpenMedium } from '@deepseek-ai/dsh-client-ui-primitives'
import { resolveWorkbenchEditorPresentation, type WorkbenchEditorCatalogRow } from './catalog.ts'
import { WorkbenchEditorIcon } from './WorkbenchEditorIcon.tsx'
import css from './WorkbenchEditorPicker.module.css'
import { editorMenuFolder, type EditorMenuPreferences } from './editor-menu-preferences.ts'

// Presentation only: reopening a menu keeps its folders folded for this window.
const collapsedFolders = new Set<string>()

/** The same searchable chooser serves empty Areas, add-tab and replace-tab. */
export function WorkbenchEditorPicker({ editors, mode, onSelect, unavailable, preferences }: {
  editors: readonly WorkbenchEditorCatalogRow[]; mode: 'add' | 'replace'; onSelect(editor: WorkbenchEditorCatalogRow): void
  unavailable?(editor: WorkbenchEditorCatalogRow): string | undefined
  preferences?: EditorMenuPreferences | undefined
}) {
  const [query, setQuery] = useState('')
  const [collapsed, setCollapsed] = useState(() => new Set(collapsedFolders))
  const search = query.trim().toLocaleLowerCase()
  const toggle = (id: string, expanded: boolean) => {
    if (search) return
    if (expanded) collapsedFolders.delete(id); else collapsedFolders.add(id)
    setCollapsed(new Set(collapsedFolders))
  }
  const groups = new Map<string, { name: string; order: number; editors: WorkbenchEditorCatalogRow[] }>()
  for (const editor of editors) {
    const folder = editorMenuFolder(editor, preferences)
    if (![editor.label, editor.id, folder.name].some(value => value.toLocaleLowerCase().includes(search))) continue
    const group = groups.get(folder.id) ?? { name: folder.name, order: folder.order, editors: [] }
    group.editors.push(editor); groups.set(folder.id, group)
  }
  return <div className={css.picker} onKeyDown={event => {
    const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button[data-picker-control]:not(:disabled)')]
    const entries = buttons.filter(button => button.getAttribute('role') === 'menuitem')
    const index = buttons.indexOf(event.target as HTMLButtonElement)
    if (event.key === 'Enter' && event.target instanceof HTMLInputElement && entries.length === 1) { event.preventDefault(); entries[0]?.click(); return }
    if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return
    event.preventDefault(); event.stopPropagation()
    const next = index < 0 ? event.key === 'ArrowDown' ? 0 : buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length
    buttons[next]?.focus()
  }}>
    <Input autoFocus type="search" aria-label="搜索内页" placeholder="搜索内页" icon={<IconSearchOutlineMedium size={16} />} value={query} onChange={event => setQuery(event.target.value)} />
    <div className={css.results}>
      {[...groups].sort(([, a], [, b]) => a.order - b.order).map(([id, group]) => { const expanded = !!search || !collapsed.has(id); return <div key={id} role="group" aria-label={group.name}>
        <button type="button" data-picker-control className={css.category} aria-label={group.name} aria-expanded={expanded} disabled={!!search} title={search ? '搜索时自动展开匹配分类' : undefined}
          onClick={() => toggle(id, !expanded)} onKeyDown={event => {
            if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); event.stopPropagation(); toggle(id, event.key === 'ArrowRight') }
          }}><span className={css.chevron} data-expanded={expanded}><IconChevronRightOutlineMedium size={12} /></span>
          {expanded ? <IconFolderOpenMedium size={16} /> : <IconFolderCloseMedium size={16} />}<span className={css.categoryName}>{group.name}</span><small>{group.editors.length}</small></button>
        {expanded ? <div className={css.entries}>{group.editors.map(editor => { const presentation = resolveWorkbenchEditorPresentation(editor); return <button key={editor.scope + ':' + editor.id} type="button" role="menuitem" data-picker-control className={css.option}
          aria-label={(mode === 'replace' ? '切换为 ' : '添加为标签 ') + editor.label} disabled={!!unavailable?.(editor)} title={unavailable?.(editor)} onClick={() => onSelect(editor)}>
          <span className={css.icon}><WorkbenchEditorIcon name={presentation.icon} iconSvg={presentation.iconSvg} /></span><span>{editor.label}</span>
        </button> })}</div> : null}
      </div> })}
      {!groups.size ? <p className={css.noResults} role="status">{editors.length ? '没有匹配的内页' : '暂无可用内页，请检查扩展是否已启用。'}</p> : null}
    </div>
  </div>
}
