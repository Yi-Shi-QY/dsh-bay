import type { ReactNode } from 'react'
import { WorkbenchEditorIcon } from './WorkbenchEditorIcon.tsx'
import { useWorkbenchLocale } from './workbench-locale.ts'
import css from './WorkbenchPageLoading.module.css'

interface LoadingProps {
  label?: string
  icon?: string
  compact?: boolean
}

/** Shared indeterminate loading surface for Area and floating inner pages. */
export function WorkbenchPageLoading({ label, icon = 'panel', compact = false }: LoadingProps) {
  const { t } = useWorkbenchLocale()
  const title = t('page.loading', { label: label ?? t('page.page') })
  return <div className={compact ? css.compact : css.loading} role="status" aria-live="polite" aria-atomic="true" aria-label={title} data-workbench-page-loading>
    <div className={css.content}>
      <span className={css.symbol} aria-hidden="true"><WorkbenchEditorIcon name={icon} /></span>
      <div className={css.copy}><span className={css.title}>{title}</span>{!compact ? <span className={css.caption}>{t('page.loadingHint')}</span> : null}</div>
      <span className={css.track} aria-hidden="true"><span /></span>
    </div>
  </div>
}

/** Keep the native view mounted while its real readiness state settles. */
export function WorkbenchPageTransition({ loading, children, ...props }: LoadingProps & { loading: boolean; children: ReactNode }) {
  return <div className={css.transition} aria-busy={loading || undefined}>
    <div className={css.view} hidden={loading}>{children}</div>
    {loading ? <WorkbenchPageLoading {...props} /> : null}
  </div>
}
