import { useWorkbenchLocale } from './workbench-locale.ts'
import { useCallback, useEffect, useId, useRef, useSyncExternalStore } from 'react'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type { SettingsScopeSnapshot } from '../client/workbench-settings-contracts.ts'
import { IconCloseOutlineMedium } from '@deepseek-ai/dsh-client-ui-primitives'
import type { WorkbenchSettingsV4 } from './persistence.ts'
import { WorkbenchCoreSettingsSection, type WorkbenchCoreSettingsSectionProps } from './WorkbenchCoreSettingsSection.tsx'
import css from './WorkbenchCoreSettingsDialog.module.css'

export type WorkbenchCoreSettingsPage = Omit<WorkbenchCoreSettingsSectionProps, 'useWorkbenchSettings' | 'useSessions' | 'useWorkspaces' | 'close'>

/** A Core-owned view of the same settings data contributed to official DSH. */
export function WorkbenchCoreSettingsDialog({ workbenchSettings, onClose, ...page }: WorkbenchCoreSettingsPage & Pick<WorkbenchCoreSettingsSectionProps, 'useSessions' | 'useWorkspaces'> & {
  workbenchSettings: HostObservable<SettingsScopeSnapshot<WorkbenchSettingsV4>>
  onClose: () => void
}) {
  const { t } = useWorkbenchLocale()
  const dialog = useRef<HTMLDialogElement>(null)
  const closeButton = useRef<HTMLButtonElement>(null)
  const titleId = useId()
  const closeRequest = useRef<() => void>(onClose)
  const registerCloseRequest = useCallback((request: () => void) => { closeRequest.current = request; return () => { closeRequest.current = onClose } }, [onClose])
  const requestClose = () => closeRequest.current()
  const source = page.settingsSource ?? workbenchSettings
  const snapshot = useSyncExternalStore(source.subscribe, source.getSnapshot, source.getSnapshot)
  const useWorkbenchSettings: WorkbenchCoreSettingsSectionProps['useWorkbenchSettings'] = useCallback(selector => selector(snapshot), [snapshot])

  useEffect(() => {
    const element = dialog.current!
    const previousFocus = document.activeElement
    // The native top layer supplies focus containment and makes the mounted
    // Frame inert without losing any Area state or taking an official owner.
    element.showModal()
    closeButton.current?.focus()
    return () => {
      element.close()
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus()
    }
  }, [])

  return <dialog
    ref={dialog}
    className={css.dialog}
    aria-labelledby={titleId}
    data-workbench-settings-dialog
    onClose={onClose}
    onCancel={event => { event.preventDefault(); requestClose() }}
    onClick={event => {
      if (event.target !== event.currentTarget) return
      const rect = event.currentTarget.getBoundingClientRect()
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) requestClose()
    }}
  >
    <header className={css.header}>
      <h2 id={titleId}>{t('home.workbenchSettings')}</h2>
      <button ref={closeButton} className={css.close} type="button" aria-label={t('home.closeWorkbenchSettings')} title={t('home.closeWorkbenchSettings')} onClick={requestClose}>
        <IconCloseOutlineMedium size={16} />
      </button>
    </header>
    <div className={css.content}>
      <WorkbenchCoreSettingsSection {...page} useWorkbenchSettings={useWorkbenchSettings} close={onClose} registerCloseRequest={registerCloseRequest} />
    </div>
  </dialog>
}
