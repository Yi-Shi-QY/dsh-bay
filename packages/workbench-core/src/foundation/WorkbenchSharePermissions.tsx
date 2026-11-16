import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Button, Modal, IconCloseOutlineMedium, IconShareOutlineMedium, IconShieldOutlineMedium } from '@deepseek-ai/dsh-client-ui-primitives'
import { SHARED_CONTROL_GRANT, type WorkbenchCapability, type WorkbenchGrant } from '../workbench-access-contract.ts'
import { workbenchFetch } from '../client/workbench-access.ts'
import type { WorkbenchShareControllerV1, WorkbenchShareSessionSnapshotV1 } from '../client/workbench-share-controller.ts'
import css from './WorkbenchHome.module.css'

const extras: readonly [WorkbenchCapability, string, string][] = [
  ['layout', '编辑区域与布局', '调整区域、内页、会话和画布布局。'],
  ['main-message', '向主会话发送消息', '在工作台主会话中发送消息。'],
  ['read-files', '读取工作台文件', '查看当前工作台目录内的文件。'],
  ['write-files', '修改工作台文件', '写入当前工作台目录内的文件。'],
  ['context', '编辑上下文', '修改工作台和区域的上下文。'],
  ['memory', '编辑记忆', '修改工作台和区域的记忆。'],
  ['tasks', '管理任务', '查看、启动、暂停和取消工作台任务。'],
  ['package', '导入与导出工作台包', '导入或导出当前工作台的内容。'],
]

function SharePermissions({ complete, initial }: { complete: (grant?: WorkbenchGrant) => void; initial?: WorkbenchGrant | undefined }) {
  const [grant, setGrant] = useState<WorkbenchGrant>(() => structuredClone(initial ?? SHARED_CONTROL_GRANT))
  const title = initial ? '调整分享权限' : '分享工作台到局域网'
  const selectedCount = extras.filter(([key]) => grant.capabilities.includes(key)).length
  const submit = () => complete({ template: 'shared-control', capabilities: [...new Set(['view', ...grant.capabilities])] as WorkbenchCapability[] })
  return <Modal open onClose={() => complete()} title={title} headless className={`${css.wizardModal ?? ''} ${css.shareModal ?? ''}`}>
    <form className={`${css.wizard ?? ''} ${css.shareWizard ?? ''}`} onSubmit={event => { event.preventDefault(); submit() }}>
      <header className={css.wizardHeader}>
        <div className={css.shareHeaderCopy}>
          <div className={css.shareEyebrow}><span className={css.shareBadge}><IconShareOutlineMedium size={14} />局域网分享</span><span>实时协作</span></div>
          <h2>{title}</h2>
          <p className={css.formHint}>{initial ? '设置当前分享中，参与者可以执行的操作。' : '让同一局域网中的参与者加入，一起使用当前工作台。'}</p>
        </div>
        <Button type="button" aria-label="关闭分享权限设置" title="关闭" onClick={() => complete()}><IconCloseOutlineMedium size={18} /></Button>
      </header>
      <div className={css.wizardBody}>
        <section className={css.shareSummary} aria-label="共享范围">
          <div className={css.shareSummaryIcon}><IconShareOutlineMedium size={18} /></div>
          <div><strong>共享当前整个工作台</strong><p>区域、内页、布局和未发送草稿会实时同步给参与者。</p></div>
        </section>
        <fieldset className={css.shareFieldset}>
          <legend>参与者权限</legend>
          <p className={css.formHint}>{initial ? '取消勾选可收回权限。如需开放新的权限，请停止分享后重新创建。' : '勾选允许参与者执行的操作。分享后可随时收紧权限。'}</p>
          <div className={css.permissionGrid}>{extras.map(([key, label, description]) => {
            const disabled = !!initial && !initial.capabilities.includes(key)
            return <label className={css.permissionOption} data-disabled={disabled} data-checked={grant.capabilities.includes(key)} key={key}>
              <input type="checkbox" aria-label={label} checked={grant.capabilities.includes(key)} disabled={disabled} onChange={event => setGrant(current => ({ ...current, capabilities: event.target.checked ? [...current.capabilities, key] : current.capabilities.filter(value => value !== key) }))} />
              <span><strong>{label}</strong><small>{description}</small>{disabled ? <small className={css.permissionUnavailable}>本次分享未开放</small> : null}</span>
            </label>
          })}</div>
        </fieldset>
        <div className={css.shareNotice}><IconShieldOutlineMedium size={16} /><div><strong>仅房主可操作</strong><p>账号、插件安装、系统目录选择、主机和分享管理。其他工作台不在本次分享范围内。</p></div></div>
      </div>
      <footer className={css.wizardActions}><span className={css.shareFooterHint}>已勾选 {selectedCount} 项权限</span><div><Button type="button" variant="outline" onClick={() => complete()}>取消</Button><Button type="submit" variant="primary">{initial ? '保存权限' : '开始分享'}</Button></div></footer>
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

export function WorkbenchShareGrantControls({ controller, session, presentation, buttonClassName }: {
  controller: WorkbenchShareControllerV1; session: WorkbenchShareSessionSnapshotV1
  presentation?: 'toolbar'; buttonClassName?: string | undefined
}) {
  const [error, setError] = useState<string>(), [busy, setBusy] = useState(false)
  if (!controller.reduce || !session.grant) return null
  const openPermissions = () => {
    void (async () => {
      const grant = await requestWorkbenchShareGrant(session.grant)
      if (!grant) return
      setBusy(true); setError(undefined)
      try { await controller.reduce!(session.workbenchId, grant) } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) } finally { setBusy(false) }
    })()
  }
  return <div className={presentation === 'toolbar' ? css.shareGrantToolbar : undefined}>
    {presentation === 'toolbar'
      ? <button type="button" className={buttonClassName} disabled={busy} onClick={openPermissions}
        title={error ?? '收紧分享权限'} aria-label="收紧分享权限" aria-haspopup="dialog"><IconShieldOutlineMedium size={17} /></button>
      : <Button variant="outline" disabled={busy} onClick={openPermissions}><IconShieldOutlineMedium size={16} />收紧分享权限</Button>}
    {error ? <p role="alert">{error}</p> : null}
  </div>
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
