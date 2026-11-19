import { useWorkbenchLocale } from './workbench-locale.ts'
import { useState, type ReactNode } from 'react'
import { Menu, MenuItemButton, IconPlusOutlineMedium, IconFolderOpenOutlineMedium } from '@deepseek-ai/dsh-client-ui-primitives'
import { WORKBENCH_LAYOUT_PRESETS, type WorkbenchLayoutPresetId } from './workbench-layout-presets.ts'
import { WorkbenchPresetIcon } from './WorkbenchPresetIcon.tsx'
import css from './WorkbenchCreateMenu.module.css'

export function WorkbenchCreateMenu({ anchor, onSelect, onImport }: {
  anchor: (props: { onClick(): void; 'aria-expanded': boolean; 'aria-haspopup': 'menu' }) => ReactNode
  onSelect(presetId: WorkbenchLayoutPresetId): void
  onImport?: (() => void) | undefined
}) {
  const { t } = useWorkbenchLocale()
  const [open, setOpen] = useState(false)
  const select = (presetId: WorkbenchLayoutPresetId) => { setOpen(false); onSelect(presetId) }
  return <Menu open={open} onClose={() => setOpen(false)} portal autoFocus dense compact listClassName={css.menu}
    anchor={anchor({ onClick: () => setOpen(current => !current), 'aria-expanded': open, 'aria-haspopup': 'menu' })}>
    <div className={onImport ? css.actions : undefined}>
    <MenuItemButton icon={<IconPlusOutlineMedium size={18} />} onSelect={() => select('single')}>
      <span className={css.blank}><strong>{t('home.newBlankWorkbench')}</strong><small>{t('home.startWithOneEmptyArea')}</small></span>
    </MenuItemButton>
    {onImport ? <button type="button" role="menuitem" tabIndex={-1} className={css.importButton}
      aria-label={t('home.importWorkbenchPackage')} title={t('home.importWorkbenchPackage')} onClick={() => { setOpen(false); onImport() }}>
      <IconFolderOpenOutlineMedium size={18} />
    </button> : null}
    </div>
    <div className={css.layouts} role="group" aria-label={t('home.areaLayout')}>
      <div className={css.grid} onKeyDown={event => {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
        const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')]
        const index = buttons.indexOf(event.target as HTMLButtonElement)
        if (index < 0) return
        event.preventDefault(); event.stopPropagation()
        buttons[(index + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length]?.focus()
      }}>
        {WORKBENCH_LAYOUT_PRESETS.filter(row => row.id !== 'single').map(row => <button key={row.id} type="button" role="menuitem" tabIndex={-1}
          className={css.preset} title={t(`layout.preset.${row.id}`)} aria-label={t(`layout.preset.${row.id}`) + '，' + row.areas + t('home.areas3')} onClick={() => select(row.id)}>
          <WorkbenchPresetIcon node={row.root} />
        </button>)}
      </div>
    </div>
  </Menu>
}
