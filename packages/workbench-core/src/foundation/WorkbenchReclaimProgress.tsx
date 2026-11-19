import { useWorkbenchLocale } from './workbench-locale.ts'
import { reclaimLabels, reclaimPhases, type WorkbenchReclaimProgress as Progress } from '../workbench-reclaim.ts'
import css from './WorkbenchBrowserControlPage.module.css'

export function WorkbenchReclaimProgress({ value }: { value: Progress }) {
  const { t } = useWorkbenchLocale()
  const completed = reclaimPhases.indexOf(value.phase)
  return <section className={css.reclaimProgress} aria-live="polite" data-workbench-reclaim-progress>
    <div><strong>{value.error ? t('window.reclaimNeedsAction') : value.phase === 'complete' ? t('window.returnedToDsh') : t('window.reclaiming')}</strong><span>{completed} {t('workspace.5Steps')}</span></div>
    <progress max={5} value={completed} aria-label={t('workspace.controlTransferProgress')} />
    <p>{value.error ?? reclaimLabels[value.phase]}</p>
    {value.forced ? <p className={css.forceWarning}>{t('workspace.theLastSavedStateWasUsedUnsubmitted')}</p> : null}
    {value.recovery === 'page-closed' ? <p>{value.phase === 'complete' ? t('window.restoredClosedTab') : t('window.restoringClosedTab')}{t('workspace.changesNotSavedBeforeClosingCouldNot')}</p> : null}
  </section>
}
