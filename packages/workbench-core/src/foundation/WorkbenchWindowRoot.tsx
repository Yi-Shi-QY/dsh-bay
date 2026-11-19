import { useEffect, useState, type ReactNode } from 'react'
import type { PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import css from './WorkbenchWindowRoot.module.css'
import { requestWorkbenchClientExit } from '../client/floating-exit-guard.ts'
import { useWorkbenchLocale, type WorkbenchLocaleSource } from './workbench-locale.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    'workbench.window.surface': { kind: 'list'; scope: 'root' }
  }
}

/** Dedicated composition, selected only inside a companion-owned document. */
export function WorkbenchWindowRoot(props: PropsRenderSlots<'workbench.window.surface'> & { locale?: WorkbenchLocaleSource | undefined }): ReactNode {
  const { t } = useWorkbenchLocale(props.locale)
  const [reclaimState, setReclaimState] = useState<'requested' | 'reclaimed'>()
  useEffect(() => {
    const receive = (event: Event) => {
      const state = (event as CustomEvent<{ state?: unknown }>).detail?.state
      if (state === 'requested' || state === 'reclaimed') setReclaimState(state)
    }
    window.addEventListener('workbench-browser-reclaim', receive)
    return () => window.removeEventListener('workbench-browser-reclaim', receive)
  }, [])
  return <div className={css.root}>
    {props.renderSlot('workbench.window.surface', {})}
    {reclaimState === undefined ? null : <div className={css.lock} role="alertdialog" aria-modal="true" aria-live="polite" aria-busy={reclaimState === 'requested'}>
      <section className={css.message} data-reclaim-state={reclaimState}>
      {reclaimState === 'requested' ? <span className={css.spinner} aria-hidden="true" /> : null}
      <h1>{reclaimState === 'reclaimed' ? t('home.workbenchControlReturnedToTheDshClient') : t('home.returningControlToTheDshClient')}</h1>
      <p>{reclaimState === 'reclaimed'
        ? t('home.theDshClientNowControlsTheWorkbench')
        : t('home.thisPageIsLockedWhileTheDsh')}</p>
      {reclaimState === 'reclaimed' ? <button type="button" onClick={() => { void requestWorkbenchClientExit().then(ok => { if (ok) window.close() }) }}>{t('home.closeThisPage')}</button> : null}
      </section>
    </div>}
  </div>
}
