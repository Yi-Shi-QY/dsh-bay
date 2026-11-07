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
  const subscribe = useCallback((listener: () => void) => controller.subscribe(listener), [controller])
  const getSnapshot = useCallback(() => controller.getSnapshot(), [controller])
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  const [expanded, setExpanded] = useState(true)
  const [objective, setObjective] = useState('')
  const [areaId, setAreaId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const activeAreas = areas.length > 0 ? areas : snapshot.areas
  const submit = async () => {
    if (!objective.trim() || !areaId) return
    setBusy(true); setError(undefined)
    try { await controller.createWorkItem({ areaId, objective: objective.trim(), start: true }); setObjective('') }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setBusy(false) }
  }
  return <aside data-bay-agent-panel data-workbench-id={workbenchId} style={panelStyle} aria-label="Bay Agent 控制区">
    <header style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderBottom: '1px solid var(--dsw-alias-border-l2, #d9dcdf)' }}>
      <strong style={{ flex: 1 }}>Bay Agent</strong>
      <span style={{ fontSize: 11, color: 'var(--dsw-alias-label-secondary, #777)' }}>{snapshot.sessionId ? 'Session 已就绪' : '待启动 Session'}</span>
      <button type="button" aria-label={expanded ? '收起 Bay Agent' : '展开 Bay Agent'} onClick={() => setExpanded(value => !value)} style={{ border: 0, background: 'transparent', color: 'inherit', cursor: 'pointer' }}>{expanded ? '−' : '+'}</button>
    </header>
    {expanded ? <div style={{ overflow: 'auto', padding: 12 }}>
      <p style={{ margin: '0 0 10px', color: 'var(--dsw-alias-label-secondary, #777)' }}>Bay Agent 负责组织工作项、调度 Worker，并把需要人处理的事项放进 Attention Queue。</p>
      <div style={{ display: 'grid', gap: 6, marginBottom: 12 }}>
        <select aria-label="工作区域" value={areaId} onChange={event => setAreaId(event.currentTarget.value)} style={{ height: 30 }}>
          <option value="">选择区域</option>
          {activeAreas.map(area => <option key={area.areaId} value={area.areaId}>{area.label}</option>)}
        </select>
        <input aria-label="工作项目标" value={objective} onChange={event => setObjective(event.currentTarget.value)} placeholder="告诉 Bay Agent 要完成什么" onKeyDown={event => { if (event.key === 'Enter') void submit() }} style={{ height: 30, padding: '0 8px' }} />
        <button type="button" disabled={busy || !objective.trim() || !areaId} onClick={() => void submit()} style={{ height: 30 }}>新建并启动工作项</button>
        {error ? <div role="alert" style={{ color: '#b42318' }}>{error}</div> : null}
      </div>
      {controller.listAttention().length > 0 ? <section aria-label="Attention Queue" style={{ marginBottom: 12 }}>
        <strong>Attention Queue ({controller.listAttention().length})</strong>
        {controller.listAttention().map(row => <div key={row.attentionId} style={{ marginTop: 6, padding: 8, borderRadius: 8, background: 'var(--dsw-alias-bg-layer-2, #8882)' }}>
          <div>{row.question}</div>
          <div style={{ display: 'flex', gap: 6, marginTop: 6 }}><button type="button" onClick={() => void controller.resolveAttention(row.attentionId)}>已处理</button><button type="button" onClick={() => void controller.dismissAttention(row.attentionId)}>忽略</button><button type="button" onClick={() => void controller.recoverWorkItem(row.workItemId)}>恢复</button></div>
        </div>)}
      </section> : null}
      <section aria-label="Bay Agent 工作项">
        <strong>工作项 ({snapshot.workItems.length})</strong>
        {snapshot.workItems.length === 0 ? <div style={{ padding: '8px 0', color: 'var(--dsw-alias-label-secondary, #777)' }}>还没有工作项</div> : snapshot.workItems.map(item => <WorkItemRow key={item.workItemId} item={item} controller={controller} onOpenArea={onOpenArea} />)}
      </section>
    </div> : null}
  </aside>
}

function WorkItemRow({ item, controller, onOpenArea }: { item: BayAgentWorkItemV1; controller: BayAgentControllerV1; onOpenArea?: ((areaId: string) => void) | undefined }) {
  return <div style={{ padding: '8px 0', borderTop: '1px solid var(--dsw-alias-border-l2, #d9dcdf)' }}>
    <button type="button" onClick={() => onOpenArea?.(item.areaId)} style={{ border: 0, padding: 0, background: 'transparent', color: 'inherit', cursor: 'pointer', textAlign: 'left' }}>{item.objective}</button>
    <div style={{ fontSize: 11, color: 'var(--dsw-alias-label-secondary, #777)', marginTop: 3 }}>{item.status} · {item.areaId}</div>
    <div style={{ display: 'flex', gap: 6, marginTop: 5 }}>
      {(item.status === 'failed' || item.status === 'blocked' || item.status === 'stopped') ? <button type="button" onClick={() => void controller.retryWorkItem(item.workItemId)}>重试</button> : null}
      {item.status === 'needs_input' ? <button type="button" onClick={() => void controller.recoverWorkItem(item.workItemId)}>恢复</button> : null}
      {['running', 'queued', 'waiting'].includes(item.status) ? <button type="button" onClick={() => void controller.stopWorkItem(item.workItemId)}>停止</button> : null}
    </div>
  </div>
}
