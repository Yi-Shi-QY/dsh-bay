import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Button, Modal, IconCloseOutlineMedium, IconShareOutlineMedium, IconShieldOutlineMedium } from '@deepseek-ai/dsh-client-ui-primitives'
import { SHARED_CONTROL_GRANT, type WorkbenchCapability, type WorkbenchGrant } from '../workbench-access-contract.ts'
import { workbenchFetch } from '../client/workbench-access.ts'
import type { WorkbenchShareControllerV1, WorkbenchShareSessionSnapshotV1 } from '../client/workbench-share-controller.ts'
import css from './WorkbenchHome.module.css'

const extras: readonly [WorkbenchCapability, string, string][] = [
  ['main-message', 'Bay Agent messages', 'Allow sending messages to the Workbench main session.'],
  ['read-files', 'Read project files', 'Allow reading files inside the Workbench root.'],
  ['write-files', 'Write project files', 'Allow writing files inside the Workbench root.'],
  ['layout', 'Edit Areas and layout', 'Allow changing Areas, editors, sessions, and layout.'],
  ['context', 'Edit context', 'Allow changing Workbench and Area context.'],
  ['tasks', 'Manage tasks', 'Allow viewing, starting, pausing, and cancelling Workbench tasks.'],
  ['memory', 'Edit memory', 'Allow changing Workbench and Area memory.'],
  ['package', 'Import and export packages', 'Allow Workbench package operations.'],
]

function SharePermissions({ complete, initial }: { complete: (grant?: WorkbenchGrant) => void; initial?: WorkbenchGrant | undefined }) {
  const [grant, setGrant] = useState<WorkbenchGrant>(structuredClone(initial ?? SHARED_CONTROL_GRANT))
  const submit = () => complete({ template: 'shared-control', capabilities: [...new Set(['view', ...grant.capabilities])] as WorkbenchCapability[] })
  return <Modal open onClose={() => complete()} title={initial ? 'Adjust shared-control permissions' : 'Start shared-control'} headless className={`${css.wizardModal ?? ''} ${css.shareModal ?? ''}`}>
    <form className={`${css.wizard ?? ''} ${css.shareWizard ?? ''}`} onSubmit={event => { event.preventDefault(); submit() }}>
      <header className={css.wizardHeader}>
        <div className={css.shareHeaderCopy}>
          <div className={css.shareEyebrow}><span className={css.shareBadge}><IconShareOutlineMedium size={14} /> Shared control</span><span>Current Workbench</span></div>
          <h2>{initial ? 'Adjust shared-control permissions' : 'Start shared-control'}</h2>
          <p className={css.formHint}>Everyone uses the same Host Workbench fact, Areas, editors, sessions, canvas, drafts, and tasks.</p>
        </div>
        <Button type="button" aria-label="Close shared-control permissions" title="Close" onClick={() => complete()}><IconCloseOutlineMedium size={18} /></Button>
      </header>
      <div className={css.wizardBody}>
        <section className={css.shareSummary} aria-label="Shared-control description">
          <div className={css.shareSummaryIcon}><IconShareOutlineMedium size={18} /></div>
          <div><strong>Shared-control Workbench</strong><p>The Host authorizes each command and broadcasts the committed Workbench state to every participant.</p></div>
        </section>
        <fieldset className={css.shareFieldset}>
          <legend>Capabilities</legend>
          <p className={css.formHint}>Capabilities can be reduced during an active share. A later expansion requires creating a new share.</p>
          <div className={css.permissionGrid}>{extras.map(([key, label, description]) => {
            const disabled = !!initial && !initial.capabilities.includes(key)
            return <label className={css.permissionOption} data-disabled={disabled} key={key}>
              <input type="checkbox" checked={grant.capabilities.includes(key)} disabled={disabled} onChange={event => setGrant(current => ({ ...current, capabilities: event.target.checked ? [...current.capabilities, key] : current.capabilities.filter(value => value !== key) }))} />
              <span><strong>{label}</strong><small>{description}</small></span>
            </label>
          })}</div>
        </fieldset>
        <div className={css.shareNotice}><span className={css.shareNoticeMark}>i</span><p>Accounts, plugins, native folder selection, Host management, and other Workbench roots remain Host-only.</p></div>
      </div>
      <footer className={css.wizardActions}><span className={css.shareFooterHint}>{initial ? 'Only the current share permissions will be reduced.' : 'The full Workbench is shared through the Host collaboration session.'}</span><div><Button type="button" variant="outline" onClick={() => complete()}>Cancel</Button><Button type="submit" variant="primary">{initial ? 'Apply reduction' : 'Start sharing'}</Button></div></footer>
    </form>
  </Modal>
}

export function requestWorkbenchShareGrant(initial?: WorkbenchGrant, _areas: readonly { id: string; label: string }[] = []): Promise<WorkbenchGrant | undefined> {
  return new Promise(resolve => {
    const container = document.createElement('div'); document.body.append(container)
    const root = createRoot(container)
    let settled = false
    const complete = (grant?: WorkbenchGrant) => { if (settled) return; settled = true; resolve(grant); queueMicrotask(() => { root.unmount(); container.remove() }) }
    root.render(<SharePermissions complete={complete} initial={initial} />)
  })
}

export function WorkbenchShareGrantControls({ controller, session }: { controller: WorkbenchShareControllerV1; session: WorkbenchShareSessionSnapshotV1 }) {
  const [error, setError] = useState<string>(), [busy, setBusy] = useState(false)
  if (!controller.reduce || !session.grant) return null
  return <div><Button variant="outline" disabled={busy} onClick={() => {
    void (async () => {
      const grant = await requestWorkbenchShareGrant(session.grant)
      if (!grant) return
      setBusy(true); setError(undefined)
      try { await controller.reduce!(session.workbenchId, grant) } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) } finally { setBusy(false) }
    })()
  }}><IconShieldOutlineMedium size={16} />收紧分享权限</Button>{error ? <p role="alert">{error}</p> : null}</div>
}

type Approval = { id: string; sessionId: string; tool: string; arguments: unknown }
export function WorkbenchCollaborationApprovals({ workbenchId }: { workbenchId: string }) {
  const [pending, setPending] = useState<Approval[]>([]), [error, setError] = useState<string>()
  const request = async (action: string, extra: Record<string, unknown> = {}) => {
    const response = await workbenchFetch('/api/workbench/access/v1', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action, workbenchId, ...extra }) })
    const result = await response.json() as { value?: Approval[]; error?: string }
    if (!response.ok) throw new Error(result.error ?? '无法处理协作请求。')
    return result.value ?? []
  }
  useEffect(() => {
    let disposed = false, busy = false
    const refresh = async () => { if (busy) return; busy = true; try { const next = await request('pending'); if (!disposed) setPending(next) } catch { /* Keep native pending state; retry after reconnect. */ } finally { busy = false } }
    void refresh(); const timer = setInterval(() => { void refresh() }, 1500)
    return () => { disposed = true; clearInterval(timer) }
  }, [workbenchId])
  if (!pending.length) return null
  return <aside aria-label="协作操作确认" style={{ padding: 12, border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 8 }}><strong>协作者的 AI 正在等待确认</strong>
    {pending.map(item => <div key={item.id}><p>{item.tool} · 对话 {item.sessionId}</p><pre style={{ whiteSpace: 'pre-wrap', maxHeight: 160, overflow: 'auto' }}>{JSON.stringify(item.arguments, null, 2)}</pre>
      {[true, false].map(allow => <Button key={String(allow)} variant="outline" onClick={() => { void request('answer', { id: item.id, allow }).then(setPending).catch(reason => setError(String(reason))) }}>{allow ? '仅允许这次操作' : '拒绝'}</Button>)}</div>)}{error ? <p role="alert">{error}</p> : null}
  </aside>
}
