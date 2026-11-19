import { useWorkbenchLocale, WorkbenchLocaleContext, type WorkbenchLocaleSource } from './workbench-locale.ts'
import { useContext, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Button, Modal, IconCloseOutlineMedium, IconShareOutlineMedium, IconShieldOutlineMedium } from '@deepseek-ai/dsh-client-ui-primitives'
import { SHARED_CONTROL_GRANT, type WorkbenchCapability, type WorkbenchGrant } from '../workbench-access-contract.ts'
import { workbenchFetch } from '../client/workbench-access.ts'
import type { WorkbenchShareControllerV1, WorkbenchShareSessionSnapshotV1 } from '../client/workbench-share-controller.ts'
import css from './WorkbenchHome.module.css'

const extras = ['layout', 'main-message', 'read-files', 'write-files', 'context', 'memory', 'tasks', 'package'] as const satisfies readonly WorkbenchCapability[]

function SharePermissions({ complete, initial }: { complete: (grant?: WorkbenchGrant) => void; initial?: WorkbenchGrant | undefined }) {
  const { t } = useWorkbenchLocale()
  const [grant, setGrant] = useState<WorkbenchGrant>(() => structuredClone(initial ?? SHARED_CONTROL_GRANT))
  const title = initial ? t('share.adjustSharingPermissions') : t('share.shareWorkbenchOnLocalNetwork')
  const selectedCount = extras.filter(key => grant.capabilities.includes(key)).length
  const submit = () => complete({ template: 'shared-control', capabilities: [...new Set(['view', ...grant.capabilities])] as WorkbenchCapability[] })
  return <Modal open onClose={() => complete()} title={title} headless className={`${css.wizardModal ?? ''} ${css.shareModal ?? ''}`}>
    <form className={`${css.wizard ?? ''} ${css.shareWizard ?? ''}`} onSubmit={event => { event.preventDefault(); submit() }}>
      <header className={css.wizardHeader}>
        <div className={css.shareHeaderCopy}>
          <div className={css.shareEyebrow}><span className={css.shareBadge}><IconShareOutlineMedium size={14} />{t('share.localNetworkSharing')}</span><span>{t('share.liveCollaboration')}</span></div>
          <h2>{title}</h2>
          <p className={css.formHint}>{initial ? t('share.setWhatParticipantsCanDoInThis') : t('share.letPeopleOnTheSameLocalNetwork')}</p>
        </div>
        <Button type="button" aria-label={t('share.closeSharingPermissions')} title={t('action.close')} onClick={() => complete()}><IconCloseOutlineMedium size={18} /></Button>
      </header>
      <div className={css.wizardBody}>
        <section className={css.shareSummary} aria-label={t('share.sharingScope')}>
          <div className={css.shareSummaryIcon}><IconShareOutlineMedium size={18} /></div>
          <div><strong>{t('share.shareTheEntireWorkbench')}</strong><p>{t('share.areasPagesLayoutsAndUnsentDraftsSync')}</p></div>
        </section>
        <fieldset className={css.shareFieldset}>
          <legend>{t('share.participantPermissions')}</legend>
          <p className={css.formHint}>{initial ? t('share.clearACheckboxToRevokeAccessTo') : t('share.chooseWhatParticipantsCanDoYouCan')}</p>
          <div className={css.permissionGrid}>{extras.map(key => {
            const label = t(`share.permission.${key}`)
            const description = t(`share.permission.${key}.detail`)
            const disabled = !!initial && !initial.capabilities.includes(key)
            return <label className={css.permissionOption} data-disabled={disabled} data-checked={grant.capabilities.includes(key)} key={key}>
              <input type="checkbox" aria-label={label} checked={grant.capabilities.includes(key)} disabled={disabled} onChange={event => setGrant(current => ({ ...current, capabilities: event.target.checked ? [...current.capabilities, key] : current.capabilities.filter(value => value !== key) }))} />
              <span><strong>{label}</strong><small>{description}</small>{disabled ? <small className={css.permissionUnavailable}>{t('share.notAllowedByThisShare')}</small> : null}</span>
            </label>
          })}</div>
        </fieldset>
        <div className={css.shareNotice}><IconShieldOutlineMedium size={16} /><div><strong>{t('share.hostOnly')}</strong><p>{t('share.onlyTheHostManagesAccountsPluginInstallation')}</p></div></div>
      </div>
      <footer className={css.wizardActions}><span className={css.shareFooterHint}>{t('share.permissionsSelected', { count: selectedCount })}</span><div><Button type="button" variant="outline" onClick={() => complete()}>{t('action.cancel')}</Button><Button type="submit" variant="primary">{initial ? t('share.savePermissions') : t('share.startSharing')}</Button></div></footer>
    </form>
  </Modal>
}

export function requestWorkbenchShareGrant(initial?: WorkbenchGrant, locale?: WorkbenchLocaleSource): Promise<WorkbenchGrant | undefined> {
  return new Promise(resolve => {
    const container = document.createElement('div'); document.body.append(container)
    const root = createRoot(container)
    let settled = false
    const complete = (grant?: WorkbenchGrant) => { if (settled) return; settled = true; resolve(grant); queueMicrotask(() => { root.unmount(); container.remove() }) }
    root.render(<WorkbenchLocaleContext.Provider value={locale}><SharePermissions complete={complete} initial={initial} /></WorkbenchLocaleContext.Provider>)
  })
}

export function WorkbenchShareGrantControls({ controller, session, presentation, buttonClassName }: {
  controller: WorkbenchShareControllerV1; session: WorkbenchShareSessionSnapshotV1
  presentation?: 'toolbar'; buttonClassName?: string | undefined
}) {
  const { t } = useWorkbenchLocale()
  const locale = useContext(WorkbenchLocaleContext)
  const [error, setError] = useState<string>(), [busy, setBusy] = useState(false)
  if (!controller.reduce || !session.grant) return null
  const openPermissions = () => {
    void (async () => {
      const grant = await requestWorkbenchShareGrant(session.grant, locale)
      if (!grant) return
      setBusy(true); setError(undefined)
      try { await controller.reduce!(session.workbenchId, grant) } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) } finally { setBusy(false) }
    })()
  }
  return <div className={presentation === 'toolbar' ? css.shareGrantToolbar : undefined}>
    {presentation === 'toolbar'
      ? <button type="button" className={buttonClassName} disabled={busy} onClick={openPermissions}
        title={error ?? t('share.restrictSharingPermissions')} aria-label={t('share.restrictSharingPermissions')} aria-haspopup="dialog"><IconShieldOutlineMedium size={17} /></button>
      : <Button variant="outline" disabled={busy} onClick={openPermissions}><IconShieldOutlineMedium size={16} />{t('share.restrictSharingPermissions')}</Button>}
    {error ? <p role="alert">{error}</p> : null}
  </div>
}

type Approval = { id: string; sessionId: string; tool: string; arguments: unknown }
export function WorkbenchCollaborationApprovals({ workbenchId }: { workbenchId: string }) {
  const { t } = useWorkbenchLocale()
  const [pending, setPending] = useState<Approval[]>([]), [error, setError] = useState<string>()
  const request = async (action: string, extra: Record<string, unknown> = {}) => {
    const response = await workbenchFetch('/api/workbench/access/v1', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action, workbenchId, ...extra }) })
    const result = await response.json() as { value?: Approval[]; error?: string }
    if (!response.ok) throw new Error(result.error ?? t('share.couldNotProcessTheCollaborationRequest'))
    return result.value ?? []
  }
  useEffect(() => {
    let disposed = false, busy = false
    const refresh = async () => { if (busy) return; busy = true; try { const next = await request('pending'); if (!disposed) setPending(next) } catch { /* Keep native pending state; retry after reconnect. */ } finally { busy = false } }
    void refresh(); const timer = setInterval(() => { void refresh() }, 1500)
    return () => { disposed = true; clearInterval(timer) }
  }, [workbenchId])
  if (!pending.length) return null
  return <aside aria-label={t('share.collaborationApprovals')} style={{ padding: 12, border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 8 }}><strong>{t('share.aCollaboratorSAiIsWaitingFor')}</strong>
    {pending.map(item => <div key={item.id}><p>{item.tool} {t('share.conversation')} {item.sessionId}</p><pre style={{ whiteSpace: 'pre-wrap', maxHeight: 160, overflow: 'auto' }}>{JSON.stringify(item.arguments, null, 2)}</pre>
      {[true, false].map(allow => <Button key={String(allow)} variant="outline" onClick={() => { void request('answer', { id: item.id, allow }).then(setPending).catch(reason => setError(String(reason))) }}>{allow ? t('share.allowThisActionOnly') : t('share.deny')}</Button>)}</div>)}{error ? <p role="alert">{error}</p> : null}
  </aside>
}
