import { useState } from 'react'
import { Input, IconSearchOutlineMedium } from '@deepseek-ai/dsh-client-ui-primitives'
import { resolveWorkbenchEditorPresentation, type WorkbenchEditorCatalogRow } from './catalog.ts'
import { WorkbenchEditorIcon } from './WorkbenchEditorIcon.tsx'
import css from './WorkbenchEditorPicker.module.css'

/** The same searchable chooser serves empty Areas, add-tab and replace-tab. */
export function WorkbenchEditorPicker({ editors, mode, onSelect, unavailable }: {
  editors: readonly WorkbenchEditorCatalogRow[]; mode: 'add' | 'replace'; onSelect(editor: WorkbenchEditorCatalogRow): void
  unavailable?(editor: WorkbenchEditorCatalogRow): string | undefined
}) {
  const [query, setQuery] = useState('')
  const groups = new Map<string, { order: number; editors: WorkbenchEditorCatalogRow[] }>()
  for (const editor of editors) {
    const presentation = resolveWorkbenchEditorPresentation(editor)
    if (!editor.label.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()) && !presentation.category.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())) continue
    const group = groups.get(presentation.category) ?? { order: presentation.categoryOrder, editors: [] }
    group.editors.push(editor); groups.set(presentation.category, group)
  }
  return <div className={css.picker} onKeyDown={event => {
    const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')]
    const index = buttons.indexOf(event.target as HTMLButtonElement)
    if (event.key === 'Enter' && event.target instanceof HTMLInputElement && buttons.length === 1) { event.preventDefault(); buttons[0]?.click(); return }
    if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return
    event.preventDefault(); event.stopPropagation()
    const next = index < 0 ? event.key === 'ArrowDown' ? 0 : buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length
    buttons[next]?.focus()
  }}>
    <Input autoFocus type="search" aria-label="搜索内页" placeholder="搜索内页" icon={<IconSearchOutlineMedium size={16} />} value={query} onChange={event => setQuery(event.target.value)} />
    <div className={css.results}>
      {[...groups].sort(([, a], [, b]) => a.order - b.order).map(([category, group]) => <div key={category} role="group" aria-label={category}>
        <div className={css.category}>{category}</div>
        {group.editors.map(editor => { const presentation = resolveWorkbenchEditorPresentation(editor); return <button key={editor.scope + ':' + editor.id} type="button" role="menuitem" className={css.option}
          aria-label={(mode === 'replace' ? '切换为 ' : '添加为标签 ') + editor.label} disabled={!!unavailable?.(editor)} title={unavailable?.(editor)} onClick={() => onSelect(editor)}>
          <span className={css.icon}><WorkbenchEditorIcon name={presentation.icon} iconSvg={presentation.iconSvg} /></span><span>{editor.label}</span>
        </button> })}
      </div>)}
      {!groups.size ? <p className={css.noResults} role="status">{editors.length ? '没有匹配的内页' : '暂无可用内页，请检查扩展是否已启用。'}</p> : null}
    </div>
  </div>
}
