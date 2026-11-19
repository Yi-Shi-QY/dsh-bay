import { useWorkbenchLocale } from './workbench-locale.ts'
import { useCallback, useSyncExternalStore, useState, type CSSProperties } from 'react'
import type { BayAgentControllerV1, BayAgentWorkItemV1 } from './workbench-bay-agent-work.ts'

export interface WorkbenchBayAgentPanelProps {
  controller: BayAgentControllerV1
  workbenchId: string
  areas?: readonly { areaId: string; label: string }[]
  onOpenArea?: (areaId: string) => void
}

const panelStyle: CSSProperties = {
  position: 'absolute', right: 16, bottom: 16, width: 340, maxHeight: 'min(70vh, 620px)',
  display: 'flex', flexDirection: 'column', zIndex: 60, pointerEvents: 'auto',
  border: '1px solid var(--dsw-alias-border-l2, #d9dcdf)', borderRadius: 12,
  background: 'var(--dsw-alias-bg-layer-1, Canvas)', color: 'var(--dsw-alias-label-primary, CanvasText)',
  boxShadow: '0 10px 36px #0003', font: '13px/1.45 system-ui, sans-serif',
}

export function WorkbenchBayAgentPanel({ controller, workbenchId, areas = [], onOpenArea }: WorkbenchBayAgentPanelProps) {
  const { t } = useWorkbenchLocale()
  const subscribe = useCallback((listener: () => void) => controller.subscribe(listener), [controller])
  const getSnapshot = useCallback(() => controller.getSnapshot(), [controller])
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  const [expanded, setExpanded] = useState(true)
  const [objective, setObjective] = useState('')
  const [areaId, setAreaId] = useState('')
  const [agentPreset, setAgentPreset] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const activeAreas = areas.length > 0 ? areas : snapshot.areas
  const submit = async () => {
    if (!objective.trim() || !areaId || !agentPreset) return
    setBusy(true); setError(undefined)
    try { await controller.createWorkItem({ areaId, objective: objective.trim(), agentPreset, start: true }); setObjective('') }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setBusy(false) }
  }
  return <aside data-bay-agent-panel data-workbench-id={workbenchId} style={panelStyle} aria-label={t('workspace.bayAgentControls')}>
    <header style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderBottom: '1px solid var(--dsw-alias-border-l2, #d9dcdf)' }}>
      <strong style={{ flex: 1 }}>Bay Agent</strong>
      <span style={{ fontSize: 11, color: 'var(--dsw-alias-label-secondary, #777)' }}>{snapshot.sessionId ? t('bayAgent.ready') : t('bayAgent.notStarted')}</span>
      <button type="button" aria-label={expanded ? t('bayAgent.collapse') : t('bayAgent.expand')} onClick={() => setExpanded(value => !value)} style={{ border: 0, background: 'transparent', color: 'inherit', cursor: 'pointer' }}>{expanded ? '−' : '+'}</button>
    </header>
    {expanded ? <div style={{ overflow: 'auto', padding: 12 }}>
      <p style={{ margin: '0 0 10px', color: 'var(--dsw-alias-label-secondary, #777)' }}>{t('workspace.bayAgentOrganizesWorkDispatchesWorkersAnd')}</p>
      <div style={{ display: 'grid', gap: 6, marginBottom: 12 }}>
        <select aria-label={t('workspace.workArea')} value={areaId} onChange={event => setAreaId(event.currentTarget.value)} style={{ height: 30 }}>
          <option value="">{t('workspace.chooseAnArea')}</option>
          {activeAreas.map(area => <option key={area.areaId} value={area.areaId}>{area.label}</option>)}
        </select>
        <select aria-label={t('workspace.workerMode')} value={agentPreset} onChange={event => setAgentPreset(event.currentTarget.value)} style={{ height: 30 }}>
          <option value="">{t('workspace.chooseWorkerMode')}</option>
          {(snapshot.agentModes ?? []).map(mode => <option key={mode.id} value={mode.id} title={mode.description}>{mode.name}</option>)}
        </select>
        <input aria-label={t('workspace.workItemObjective')} value={objective} onChange={event => setObjective(event.currentTarget.value)} placeholder={t('workspace.describeWhatBayAgentShouldDo')} onKeyDown={event => { if (event.key === 'Enter') void submit() }} style={{ height: 30, padding: '0 8px' }} />
        <button type="button" disabled={busy || !objective.trim() || !areaId || !agentPreset} onClick={() => void submit()} style={{ height: 30 }}>{t('workspace.createAndStartWorkItem')}</button>
        {error ? <div role="alert" style={{ color: '#b42318' }}>{error}</div> : null}
      </div>
      {controller.listAttention().length > 0 ? <section aria-label="Attention Queue" style={{ marginBottom: 12 }}>
        <strong>Attention Queue ({controller.listAttention().length})</strong>
        {controller.listAttention().map(row => <div key={row.attentionId} style={{ marginTop: 6, padding: 8, borderRadius: 8, background: 'var(--dsw-alias-bg-layer-2, #8882)' }}>
          <div>{row.question}</div>
          <div style={{ display: 'flex', gap: 6, marginTop: 6 }}><button type="button" onClick={() => void controller.resolveAttention(row.attentionId)}>{t('workspace.handled')}</button><button type="button" onClick={() => void controller.dismissAttention(row.attentionId)}>{t('workspace.dismiss')}</button><button type="button" onClick={() => void controller.recoverWorkItem(row.workItemId)}>{t('workspace.resume')}</button></div>
        </div>)}
      </section> : null}
      <section aria-label={t('workspace.bayAgentWorkItems')}>
        <strong>{t('workspace.workItems')}{snapshot.workItems.length})</strong>
        {snapshot.workItems.length === 0 ? <div style={{ padding: '8px 0', color: 'var(--dsw-alias-label-secondary, #777)' }}>{t('workspace.noWorkItemsYet')}</div> : snapshot.workItems.map(item => <WorkItemRow key={item.workItemId} item={item} controller={controller} onOpenArea={onOpenArea} />)}
      </section>
    </div> : null}
  </aside>
}

function WorkItemRow({ item, controller, onOpenArea }: { item: BayAgentWorkItemV1; controller: BayAgentControllerV1; onOpenArea?: ((areaId: string) => void) | undefined }) {
  const { t } = useWorkbenchLocale()
  return <div style={{ padding: '8px 0', borderTop: '1px solid var(--dsw-alias-border-l2, #d9dcdf)' }}>
    <button type="button" onClick={() => onOpenArea?.(item.areaId)} style={{ border: 0, padding: 0, background: 'transparent', color: 'inherit', cursor: 'pointer', textAlign: 'left' }}>{item.objective}</button>
    <div style={{ fontSize: 11, color: 'var(--dsw-alias-label-secondary, #777)', marginTop: 3 }}>{item.status} · {item.areaId}</div>
    <div style={{ display: 'flex', gap: 6, marginTop: 5 }}>
      {(item.status === 'failed' || item.status === 'blocked' || item.status === 'stopped') ? <button type="button" onClick={() => void controller.retryWorkItem(item.workItemId)}>{t('action.retry')}</button> : null}
      {item.status === 'needs_input' ? <button type="button" onClick={() => void controller.recoverWorkItem(item.workItemId)}>{t('workspace.resume')}</button> : null}
      {['running', 'queued', 'waiting'].includes(item.status) ? <button type="button" onClick={() => void controller.stopWorkItem(item.workItemId)}>{t('workspace.stop')}</button> : null}
    </div>
  </div>
}
