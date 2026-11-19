import { useState, useSyncExternalStore, type ReactNode } from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { WorkbenchModeControllerV1 } from '../mode-controller.ts'
import { useWorkbenchLocale, workbenchErrorNotice, workbenchNoticeText, type WorkbenchNotice, type WorkbenchLocaleSource } from './workbench-locale.ts'
import css from './WorkbenchSidebarActions.module.css'

export type WorkbenchCoreEntryActionProps = PropsRuntime<'sidebar.footer.action'> & {
  modeController: WorkbenchModeControllerV1
  locale?: WorkbenchLocaleSource | undefined
}

/** Workbench glyph preserved from the single-plugin entry action. */
function IconWorkbench16({ size }: { size: number }): ReactNode {
  return <svg
    width={size} height={size} viewBox="0 0 16 16" aria-hidden="true" focusable="false"
    fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round"
  >
    <rect x="1.75" y="2" width="12.5" height="12" rx="2" />
    <path d="M8 2.5v11M2.5 8h5" />
    <path d="M10.5 5.5h1.75M10.5 8h1.75M10.5 10.5h1.75" />
  </svg>
}

/**
 * The single Workbench mode action in the official Sidebar footer.
 *
 * Keeping entry and exit in this slot gives the two host modes the same
 * spatial affordance and avoids adding a second desktop-only exit control.
 */
export function WorkbenchCoreEntryAction({ wide, modeController, locale }: WorkbenchCoreEntryActionProps): ReactNode {
  const { t } = useWorkbenchLocale(locale)
  const [notice, setError] = useState<WorkbenchNotice>()
  const error = workbenchNoticeText(t, notice)
  const mode = useSyncExternalStore(modeController.subscribe, modeController.getSnapshot)
  if (mode.mode !== 'official' && mode.mode !== 'workbench') return null
  const inWorkbench = mode.mode === 'workbench'
  const label = inWorkbench ? t('home.exitWorkbenchMode') : t('home.enterWorkbenchMode')
  return <>
    <button
      type="button"
      className={wide ? css.action : `${css.action} ${css.rail}`}
      {...(inWorkbench ? { 'data-workbench-exit-action': true } : { 'data-workbench-entry-action': true })}
      aria-label={label}
      title={error ?? label}
      onClick={() => {
        setError(undefined)
        const transition = inWorkbench
          ? modeController.exit()
          : modeController.enter({ intent: 'resume-recent' })
        void transition.catch(reason => {
          setError(workbenchErrorNotice(reason, inWorkbench ? 'shell.exitFailed' : 'shell.enterFailed'))
        })
      }}
    >
      {inWorkbench ? <span className={css.returnIcon} aria-hidden="true">↩</span> : <IconWorkbench16 size={wide ? 16 : 18} />}
      {wide ? <span className={css.label}>{label}</span> : null}
    </button>
    {wide && error !== undefined ? <p role="alert" style={{ margin: '2px 8px 6px', fontSize: 11 }}>{error}</p> : null}
  </>
}
