import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Button, Modal, IconCloseOutlineMedium, IconShareOutlineMedium, IconShieldOutlineMedium } from '@deepseek-ai/dsh-client-ui-primitives'
import { COLLABORATION_GRANT, REVIEW_GRANT, type WorkbenchCapability, type WorkbenchGrant } from '../workbench-access-contract.ts'
import { workbenchFetch } from '../client/workbench-access.ts'
import type { WorkbenchShareControllerV1, WorkbenchShareSessionSnapshotV1 } from '../client/workbench-share-controller.ts'
import css from './WorkbenchHome.module.css'

const extras: readonly [WorkbenchCapability, string, string][] = [
  ['main-message', '向 Bay Agent 发送消息', '允许访客直接向工作台主控提出请求。'],
  ['read-files', '浏览项目文件', '允许读取已授权区域中的项目文件。'],
  ['write-files', '修改项目文件', '允许 AI 在授权范围内写入项目文件。'],
  ['layout', '修改区域和布局', '允许调整区域、内页和工作台布局。'],
  ['context', '编辑背景', '允许更新工作台或区域的背景说明。'],
  ['tasks', '管理任务', '允许查看、派发、暂停和恢复工作台任务。'],
]
type ShareArea = { id: string; label: string }
function SharePermissions({ complete, initial, areas }: { complete: (grant?: WorkbenchGrant) => void; initial?: WorkbenchGrant | undefined; areas: readonly ShareArea[] }) {
  const [grant, setGrant] = useState<WorkbenchGrant>(structuredClone(initial ?? COLLABORATION_GRANT))
  const [paths, setPaths] = useState(initial?.paths?.join('\n') ?? '')
  const [restrictAreas, setRestrictAreas] = useState(initial?.areaIds !== undefined)
  const [areaIds, setAreaIds] = useState<readonly string[]>(initial?.areaIds ?? areas.map(area => area.id))
  const selectedTemplateLabel = grant.template === 'review' ? '审阅模式' : '协作模式'
  const submit = () => complete({ ...grant, ...(restrictAreas ? { areaIds, capabilities: grant.capabilities.filter(key => key !== 'main-message') } : {}), ...(paths.trim() ? { paths: paths.split('\n').map(value => value.trim()).filter(Boolean) } : {}) })
  return <Modal open onClose={() => complete()} title={initial ? '收紧局域网权限' : '开始局域网分享'} headless className={`${css.wizardModal ?? ''} ${css.shareModal ?? ''}`}>
    <form className={`${css.wizard ?? ''} ${css.shareWizard ?? ''}`} onSubmit={event => { event.preventDefault(); submit() }}>
      <header className={css.wizardHeader}>
        <div className={css.shareHeaderCopy}>
          <div className={css.shareEyebrow}><span className={css.shareBadge}><IconShareOutlineMedium size={14} />局域网协作</span><span>当前工作台</span></div>
          <h2>{initial ? '收紧访问权限' : '开始局域网分享'}</h2>
          <p className={css.formHint}>访客通过这台主机访问当前工作台。分享期间可以收紧权限，扩大权限需要重新建立分享。</p>
        </div>
        <Button type="button" aria-label="关闭局域网协作权限" title="关闭" onClick={() => complete()}><IconCloseOutlineMedium size={18} /></Button>
      </header>
      <div className={css.wizardBody}>
        <section className={css.shareSummary} aria-label="分享模式说明">
          <div className={css.shareSummaryIcon}><IconShareOutlineMedium size={18} /></div>
          <div><strong>{selectedTemplateLabel}</strong><p>{grant.template === 'review' ? '访客可以查看布局、区域和可见会话历史。' : '访客可以查看工作台，并在已有会话中发送消息。'}</p></div>
        </section>

        <section className={css.shareSection} aria-labelledby="share-template-title">
          <div className={css.shareSectionHeader}><div><h3 id="share-template-title">参与方式</h3><p className={css.formHint}>先选择基础模板，再按需开放额外能力。</p></div><span className={css.shareSectionValue}>{selectedTemplateLabel}</span></div>
          <label className={css.shareSelectField}><span>权限模板</span><select aria-label="分享权限模板" value={grant.template} onChange={event => setGrant(current => ({ ...current, template: event.target.value === 'review' ? 'review' : 'collaborate', capabilities: event.target.value === 'review' ? current.capabilities.filter(key => key !== 'message' && key !== 'main-message') : initial?.capabilities ?? COLLABORATION_GRANT.capabilities }))}><option value="collaborate" disabled={initial?.template === 'review'}>协作 · 查看并在已有对话发消息</option><option value="review">审阅 · 只查看</option></select></label>
        </section>

        <fieldset className={css.shareFieldset}>
          <legend>额外授权</legend>
          <p className={css.formHint}>只开放完成协作所需的能力，后续可以随时收紧。</p>
          <div className={css.permissionGrid}>{extras.map(([key, label, description]) => {
            const disabled = !!initial && !initial.capabilities.includes(key) || key === 'main-message' && grant.template === 'review'
            return <label className={css.permissionOption} data-disabled={disabled} key={key}>
              <input type="checkbox" checked={grant.capabilities.includes(key)} disabled={disabled} onChange={event => setGrant(current => ({ ...current, capabilities: event.target.checked ? [...current.capabilities, key] : current.capabilities.filter(value => value !== key) }))} />
              <span><strong>{label}</strong><small>{description}</small></span>
            </label>
          })}</div>
        </fieldset>

        {areas.length > 0 ? <fieldset className={css.shareFieldset}>
          <legend>可见区域</legend>
          <p className={css.formHint}>限制区域后，未选区域的背景和会话不会分享；Bay Agent 主会话不属于区域分享。</p>
          <label className={css.shareToggle}><input type="checkbox" checked={restrictAreas} disabled={initial?.areaIds !== undefined} onChange={event => setRestrictAreas(event.target.checked)} /><span><strong>仅分享指定区域</strong><small>适合只开放一个项目或一组项目。</small></span></label>
          {restrictAreas ? <div className={css.areaOptionList}>{areas.map(area => <label className={css.areaOption} key={area.id} data-disabled={!!initial?.areaIds && !initial.areaIds.includes(area.id)}><input type="checkbox" checked={areaIds.includes(area.id)} disabled={!!initial?.areaIds && !initial.areaIds.includes(area.id)} onChange={event => setAreaIds(current => event.target.checked ? [...current, area.id] : current.filter(id => id !== area.id))} /><span>{area.label}</span></label>)}</div> : null}
        </fieldset> : null}

        {grant.capabilities.some(key => key === 'read-files' || key === 'write-files') ? <label className={css.sharePathField}><span>项目文件范围</span><small className={css.formHint}>每行填写一个相对目录；留空表示整个工作台的项目文件。</small><textarea aria-label="分享文件目录范围" value={paths} onChange={event => setPaths(event.target.value)} placeholder={'projects/app\noutputs'} /></label> : null}
        <div className={css.shareNotice}><span className={css.shareNoticeMark}>i</span><p>AI 超出授权范围的操作会交给主控确认。访客不能安装插件、修改账号或导出完整工作台包。</p></div>
      </div>
      <footer className={css.wizardActions}><span className={css.shareFooterHint}>{initial ? '只会收紧当前分享权限' : '权限可以在分享期间继续收紧'}</span><div><Button type="button" variant="outline" onClick={() => complete()}>取消</Button><Button type="submit" variant="primary">{initial ? '应用收紧权限' : '开始分享'}</Button></div></footer>
    </form>
  </Modal>
}

export function requestWorkbenchShareGrant(initial?: WorkbenchGrant, areas: readonly ShareArea[] = []): Promise<WorkbenchGrant | undefined> {
  return new Promise(resolve => {
    const container = document.createElement('div'); document.body.append(container)
    const root = createRoot(container)
    let settled = false
    const complete = (grant?: WorkbenchGrant) => { if (settled) return; settled = true; resolve(grant); queueMicrotask(() => { root.unmount(); container.remove() }) }
    root.render(<SharePermissions complete={complete} initial={initial} areas={areas} />)
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
