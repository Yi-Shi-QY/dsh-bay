import { useWorkbenchLocale } from './workbench-locale.ts'
import { useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { IconFolderOpenOutlineMedium } from '@deepseek-ai/dsh-client-ui-primitives'
import css from './WorkbenchFrame.module.css'

export function WorkbenchBrowserFolderButton({ rootPath }: { rootPath: string }) {
  const { t } = useWorkbenchLocale()
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState({ top: 0, left: 12 })
  const trigger = useRef<HTMLButtonElement>(null)
  const popover = useRef<HTMLDivElement>(null)
  const id = useId()
  useLayoutEffect(() => {
    if (!open) return
    const place = () => {
      const rect = trigger.current?.getBoundingClientRect()
      if (!rect) return
      const width = Math.min(420, window.innerWidth - 24)
      setPosition({ top: rect.bottom + 8, left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)) })
    }
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !trigger.current?.contains(event.target) && !popover.current?.contains(event.target)) setOpen(false)
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      setOpen(false)
      trigger.current?.focus()
    }
    place()
    popover.current?.focus()
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape)
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('keydown', escape)
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open])
  return <div className={css.browserWorkspacePath}>
    <button ref={trigger} type="button" className={css.browserWorkspaceIconButton}
      title={t('editor.viewWorkbenchFolderPath')} aria-label={t('editor.viewWorkbenchFolderPath')}
      aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined}
      onClick={() => setOpen(value => !value)}><IconFolderOpenOutlineMedium size={17} /></button>
    {open ? createPortal(<div ref={popover} id={id} role="dialog" aria-label={t('editor.workbenchFolderPath')} tabIndex={-1}
      className={css.browserWorkspacePathPopover} style={position}>
      <strong>{t('editor.workbenchFolder')}</strong><code>{rootPath}</code>
    </div>, document.body) : null}
  </div>
}
