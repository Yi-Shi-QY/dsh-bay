import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { IconCloseOutlineMedium, IconRefreshOutlineMedium } from '@deepseek-ai/dsh-client-ui-primitives'
import type { WorkbenchEditorCatalogRow } from './catalog.ts'
import { WorkbenchEditorIcon } from './WorkbenchEditorIcon.tsx'
import type { ToolCatalogEntryV1, ToolKindV1, WorkbenchToolGatewayV1 } from '../tool-gateway.ts'
import type { WorkbenchGatewayToolUsageSummaryV1, WorkbenchToolGatewayUsageSnapshotV1 } from '../tool-gateway-usage.ts'
import css from './WorkbenchToolGatewayDialog.module.css'

const KIND_LABELS: Record<ToolKindV1, string> = { mcp: 'MCP', cli: 'CLI', tool: 'Tool', skill: 'Skill' }
const KIND_ICONS: Record<ToolKindV1, string> = { mcp: 'extension', cli: 'terminal', tool: 'tool', skill: 'guide' }
const KIND_DESCRIPTIONS: Record<ToolKindV1, string> = {
  mcp: '通过 MCP Provider 暴露的远程工具能力。', cli: '由 DSH / Host 执行的命令行能力。',
  tool: 'Workbench 或 DSH 原生结构化 Tool。', skill: '可以按需发现并注入的 Skill 能力。',
}
type TabId = 'visibility' | 'usage' | 'api'
type RangeId = '24h' | '7d' | '30d' | 'all'

function availabilityLabel(entry: ToolCatalogEntryV1): string {
  if (entry.availability === 'available') return '可用'
  if (entry.availability === 'revoked') return '已撤销'
  if (entry.availability === 'degraded') return entry.reason ?? '依赖或权限未满足'
  return '正在注册'
}
function iconForEntry(entry: ToolCatalogEntryV1, editors: readonly WorkbenchEditorCatalogRow[]): string {
  if (entry.editorId !== undefined) {
    const editor = editors.filter(row => row.id === entry.editorId).sort((left, right) => left.id.localeCompare(right.id))[0]
    if (editor?.icon !== undefined) return editor.icon
  }
  return KIND_ICONS[entry.kind]
}
function formatDuration(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return '暂无数据'
  if (value < 1000) return `${Math.round(value)} ms`
  return `${(value / 1000).toFixed(value >= 10000 ? 1 : 2)} s`
}
function formatTime(value: string | undefined): string {
  if (value === undefined) return '暂无'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '暂无' : new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(date)
}
function rangeWindow(range: RangeId): { from: string; to: string } {
  const to = Date.now()
  const from = range === '24h' ? to - 24 * 60 * 60 * 1000 : range === '7d' ? to - 7 * 24 * 60 * 60 * 1000 : range === '30d' ? to - 30 * 24 * 60 * 60 * 1000 : 0
  return { from: new Date(from).toISOString(), to: new Date(to).toISOString() }
}
function percentage(value: number, total: number): string { return total === 0 ? '暂无' : `${Math.round(value / total * 100)}%` }

export function WorkbenchToolGatewayDialog({ gateway, workbenchId, workbenchName, onClose, editors = [], returnFocusRef, embedded = false }: {
  gateway: WorkbenchToolGatewayV1; workbenchId: string; workbenchName: string; onClose: () => void
  editors?: readonly WorkbenchEditorCatalogRow[]; returnFocusRef?: RefObject<HTMLElement>
  /** Rendered inside the agent assembly dialog, without its own overlay. */
  embedded?: boolean
}) {
  const [revision, setRevision] = useState(0)
  const [tab, setTab] = useState<TabId>('visibility')
  const [range, setRange] = useState<RangeId>('24h')
  const [expandedModules, setExpandedModules] = useState<Set<string>>(() => new Set())
  const [expandedToolId, setExpandedToolId] = useState<string>()
  const [usage, setUsage] = useState<WorkbenchToolGatewayUsageSnapshotV1>()
  const [usageError, setUsageError] = useState<string>()
  const [busyToolId, setBusyToolId] = useState<string>()
  const [busyModuleId, setBusyModuleId] = useState<string>()
  const [error, setError] = useState<string>()
  const closeRef = useRef<HTMLButtonElement>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  const entries = useMemo(() => gateway.catalog(), [gateway, revision])
  const modules = useMemo(() => {
    const map = new Map<string, { moduleId: string; editorId?: string; entries: ToolCatalogEntryV1[] }>()
    for (const entry of entries) {
      const key = `${entry.moduleId}:${entry.editorId ?? ''}`
      const group = map.get(key) ?? { moduleId: entry.moduleId, ...(entry.editorId === undefined ? {} : { editorId: entry.editorId }), entries: [] as ToolCatalogEntryV1[] }
      group.entries.push(entry); map.set(key, group)
    }
    return [...map.values()].sort((left, right) => left.moduleId.localeCompare(right.moduleId) || (left.editorId ?? '').localeCompare(right.editorId ?? ''))
  }, [entries])
  const enabledCount = entries.filter(entry => entry.visibility === 'enabled').length
  const attentionCount = entries.filter(entry => entry.availability !== 'available').length

  useEffect(() => {
    if (embedded) return undefined
    closeRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); onCloseRef.current() } }
    window.addEventListener('keydown', onKeyDown)
    return () => { window.removeEventListener('keydown', onKeyDown); returnFocusRef?.current?.focus() }
  }, [embedded, returnFocusRef])
  useEffect(() => {
    if (tab !== 'usage') return
    const refresh = () => {
      try {
        if (typeof gateway.usageSnapshot === 'function') {
          setUsageError(undefined)
          setUsage(gateway.usageSnapshot(rangeWindow(range)))
        } else {
          setUsageError('Workbench Tool Gateway statistics are unavailable')
        }
      } catch (cause) { setUsageError(cause instanceof Error ? cause.message : 'Gateway statistics are unavailable') }
    }
    refresh()
    return gateway.subscribeUsage?.(refresh)
  }, [gateway, range, tab])
  const toggle = async (entry: ToolCatalogEntryV1) => {
    setBusyToolId(entry.id); setError(undefined)
    try { await gateway.setVisibility({ toolId: entry.id, state: entry.visibility === 'enabled' ? 'disabled' : 'enabled' }); setRevision(value => value + 1) }
    catch (cause) { setError(cause instanceof Error ? cause.message : '工具可见性保存失败，请重试。') }
    finally { setBusyToolId(undefined) }
  }
  const toggleModule = async (module: typeof modules[number]) => {
    const nextState = module.entries.every(entry => entry.visibility === 'enabled') ? 'disabled' : 'enabled'
    const key = `${module.moduleId}:${module.editorId ?? ''}`
    setBusyModuleId(key); setError(undefined)
    try {
      const result = gateway.setVisibilityBatch === undefined ? await setVisibilityFallback(gateway, module.entries, nextState) : await gateway.setVisibilityBatch({ toolIds: module.entries.map(entry => entry.id), state: nextState })
      if (result.rejected.length > 0) setError(`部分工具未更新：${result.rejected.map(row => `${row.toolId}（${row.reason}）`).join('、')}`)
      setRevision(value => value + 1)
    } catch (cause) { setError(cause instanceof Error ? cause.message : '模块工具状态保存失败，请重试。') }
    finally { setBusyModuleId(undefined) }
  }
  const content = <>
      {embedded ? null : <header className={css.header}><div className={css.headerCopy}><span className={css.eyebrow}>工作台工具目录 · revision {gateway.revision}</span><h2 id="workbench-tool-gateway-title">工具集成</h2><p>{workbenchName} <code>{workbenchId}</code></p></div><button ref={closeRef} className={css.close} type="button" aria-label="关闭工具集成" title="关闭" onClick={onClose}><IconCloseOutlineMedium size={17} /></button></header>}
      <div className={css.summary} aria-label="工具目录摘要"><Summary label="模块" value={modules.length} /><Summary label="工具" value={entries.length} /><Summary label="已启用" value={enabledCount} tone="success" /><Summary label="需处理" value={attentionCount} tone={attentionCount > 0 ? 'warning' : 'neutral'} /><Summary label="统计" value="Gateway" text /></div>
      <nav className={css.tabs} role="tablist" aria-label="工具集成工作区"><Tab id="visibility" active={tab === 'visibility'} onClick={() => setTab('visibility')}>工具开关</Tab><Tab id="usage" active={tab === 'usage'} onClick={() => setTab('usage')}>运行统计</Tab><Tab id="api" active={tab === 'api'} onClick={() => setTab('api')}>统一接口</Tab></nav>
      {error === undefined ? null : <div className={css.error} role="alert">{error}</div>}
      <div className={css.body}>{tab === 'visibility' ? <VisibilityPanel entries={entries} modules={modules} editors={editors} expandedModules={expandedModules} onRefresh={() => setRevision(value => value + 1)} onToggleModule={toggleModule} onToggle={toggle} onExpand={key => setExpandedModules(current => { const next = new Set(current); if (next.has(key)) next.delete(key); else next.add(key); return next })} busyToolId={busyToolId} busyModuleId={busyModuleId} /> : tab === 'usage' ? <UsagePanel usage={usage} usageError={usageError} range={range} onRangeChange={next => { setRange(next); setUsage(undefined); setExpandedToolId(undefined) }} expandedToolId={expandedToolId} onExpandTool={toolId => setExpandedToolId(current => current === toolId ? undefined : toolId)} editors={editors} /> : <ApiPanel entries={entries} gateway={gateway} onCopied={() => setRevision(value => value + 1)} />}</div>
      {embedded ? null : <footer className={css.footer}><span>权限最终由 DSH Runtime / Host 决定，已开始的 Session 不会被工作台强制终止。</span><button type="button" className={css.done} onClick={onClose}>完成</button></footer>}
    </>
  return embedded ? <div className={css.embedded} data-workbench-tool-gateway-embedded>{content}</div> : <div className={css.overlay} data-workbench-tool-gateway-overlay onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
    <aside className={css.dialog} role="dialog" aria-modal="true" aria-labelledby="workbench-tool-gateway-title" data-workbench-tool-gateway-dialog>{content}</aside>
  </div>
}

async function setVisibilityFallback(gateway: WorkbenchToolGatewayV1, entries: readonly ToolCatalogEntryV1[], state: 'enabled' | 'disabled') {
  const appliedToolIds: string[] = []; const rejected: Array<{ toolId: string; reason: string }> = []
  for (const entry of entries) { try { await gateway.setVisibility({ toolId: entry.id, state }); appliedToolIds.push(entry.id) } catch (cause) { rejected.push({ toolId: entry.id, reason: cause instanceof Error ? cause.message : '更新失败' }) } }
  return { appliedToolIds, rejected }
}
function Summary({ label, value, tone = 'neutral', text = false }: { label: string; value: number | string; tone?: 'neutral' | 'success' | 'warning'; text?: boolean }) { return <div className={`${css.summaryItem} ${css[`summary${tone.charAt(0).toUpperCase()}${tone.slice(1)}`]}`}><strong className={text ? css.summaryText : undefined}>{value}</strong><span>{label}</span></div> }
function Tab({ id, active, onClick, children }: { id: TabId; active: boolean; onClick: () => void; children: string }) { return <button type="button" role="tab" id={`workbench-tool-tab-${id}`} aria-selected={active} aria-controls={`workbench-tool-panel-${id}`} className={active ? css.tabActive : css.tab} onClick={onClick}>{children}</button> }

function VisibilityPanel({ entries, modules, editors, expandedModules, onRefresh, onToggleModule, onToggle, onExpand, busyToolId, busyModuleId }: { entries: readonly ToolCatalogEntryV1[]; modules: readonly { moduleId: string; editorId?: string; entries: ToolCatalogEntryV1[] }[]; editors: readonly WorkbenchEditorCatalogRow[]; expandedModules: ReadonlySet<string>; onRefresh: () => void; onToggleModule: (module: { moduleId: string; editorId?: string; entries: ToolCatalogEntryV1[] }) => void; onToggle: (entry: ToolCatalogEntryV1) => void; onExpand: (key: string) => void; busyToolId: string | undefined; busyModuleId: string | undefined }) {
  return <section id="workbench-tool-panel-visibility" role="tabpanel" aria-labelledby="workbench-tool-tab-visibility" className={css.panel}><div className={css.panelIntro}><div><h3>容器内页扩展</h3><p>先按模块查看来源，再展开模块管理它公开的 MCP、CLI、Tool 和 Skill。</p></div><button className={css.refresh} type="button" onClick={onRefresh}><IconRefreshOutlineMedium size={15} />重新发现</button></div>{modules.length === 0 ? <EmptyState entries={entries} /> : <div className={css.moduleList}>{modules.map(module => { const key = `${module.moduleId}:${module.editorId ?? ''}`; const editor = module.editorId === undefined ? undefined : editors.find(row => row.id === module.editorId); const allEnabled = module.entries.every(entry => entry.visibility === 'enabled'); const unavailable = module.entries.filter(entry => entry.availability !== 'available').length; return <article className={css.moduleCard} key={key}><div className={css.moduleHeader}><button type="button" className={css.moduleExpand} aria-expanded={expandedModules.has(key)} onClick={() => onExpand(key)}><span className={css.chevron} aria-hidden="true">{expandedModules.has(key) ? '⌄' : '›'}</span><span className={css.moduleIcon}><WorkbenchEditorIcon name={editor?.icon ?? 'extension'} /></span><span className={css.moduleIdentity}><strong>{editor?.label ?? module.moduleId}</strong><small>{module.moduleId}{module.editorId === undefined ? '' : ` · ${module.editorId}`}</small></span></button><div className={css.moduleMeta}><span>{module.entries.length} 个工具</span>{unavailable > 0 ? <span className={css.warningText}>{unavailable} 个需处理</span> : null}<button type="button" className={css.moduleToggle} onClick={() => void onToggleModule(module)} disabled={busyModuleId === key}>{allEnabled ? '全部停用' : '全部启用'}</button></div></div>{expandedModules.has(key) ? <div className={css.moduleTools}>{module.entries.toSorted((left, right) => left.kind.localeCompare(right.kind) || left.id.localeCompare(right.id)).map(entry => <ToolRow key={entry.id} entry={entry} icon={iconForEntry(entry, editor === undefined ? [] : [editor])} busy={busyToolId === entry.id} onToggle={() => onToggle(entry)} />)}</div> : null}</article> })}</div>}</section>
}
function EmptyState({ entries }: { entries: readonly ToolCatalogEntryV1[] }) { const revoked = entries.length > 0 && entries.every(entry => entry.availability !== 'available'); return <div className={css.empty}><span className={css.emptyIcon}><WorkbenchEditorIcon name={revoked ? 'extension' : 'tool'} /></span><strong>{revoked ? '工具目录中的能力当前都不可用' : entries.length === 0 ? '当前工作台还没有声明工具' : '工具目录暂时不可用'}</strong><p>{revoked ? '请检查 Provider、依赖或 DSH 权限状态。历史 Session 仍然保留。' : entries.length === 0 ? '安装或启用 standalone-provider 容器内页扩展后，点击“重新发现”即可查看它公开的能力。' : '请重新发现目录或检查 Core 与扩展的连接状态。'}</p></div> }
function ToolRow({ entry, icon, busy, onToggle }: { entry: ToolCatalogEntryV1; icon: string; busy: boolean; onToggle: () => void }) { const enabled = entry.visibility === 'enabled'; const unavailable = entry.availability !== 'available'; return <article className={css.toolRow} data-availability={entry.availability} data-visibility={entry.visibility}><span className={css.toolIcon}><WorkbenchEditorIcon name={icon} /></span><div className={css.toolIdentity}><div className={css.toolTitle}><strong>{entry.display.name}</strong><code>{entry.id}</code><span className={css.kindBadge}>{KIND_LABELS[entry.kind]}</span></div><p>{entry.display.description ?? KIND_DESCRIPTIONS[entry.kind]}</p><small>{entry.execution.providerId} · v{entry.version}{entry.artifactDigest === undefined ? '' : ` · ${entry.artifactDigest.slice(0, 12)}…`}</small>{unavailable ? <span className={css.reason}>{availabilityLabel(entry)}</span> : null}</div><button className={css.switch} type="button" role="switch" aria-checked={enabled} aria-label={`${entry.display.name} ${enabled ? '已启用' : '已停用'}`} disabled={busy} onClick={onToggle}><span className={css.switchTrack}><span className={css.switchThumb} /></span><span>{busy ? '保存中' : enabled ? '已启用' : '已停用'}</span></button></article> }

function UsagePanel({ usage, usageError, range, onRangeChange, editors, expandedToolId, onExpandTool }: { usage: WorkbenchToolGatewayUsageSnapshotV1 | undefined; usageError: string | undefined; range: RangeId; onRangeChange: (value: RangeId) => void; editors: readonly WorkbenchEditorCatalogRow[]; expandedToolId: string | undefined; onExpandTool: (toolId: string) => void }) {
  if (usageError !== undefined) return <div className={css.empty}><span className={css.emptyIcon}><WorkbenchEditorIcon name="trajectory" /></span><strong>Gateway 统计暂不可用</strong><p>{usageError}</p></div>
  if (usage === undefined) return <div className={css.loading} role="status">正在读取 Gateway 运行统计…</div>
  const successRate = percentage(usage.totals.successes, usage.totals.calls)
  const maxCalls = Math.max(...usage.buckets.map(bucket => bucket.calls), 1)
  const p95 = usage.byTool.map(item => item.p95DurationMs).filter((value): value is number => value !== undefined).sort((left, right) => left - right).at(-1)
  return <section id="workbench-tool-panel-usage" role="tabpanel" aria-labelledby="workbench-tool-tab-usage" className={css.panel}>
    <div className={css.panelIntro}><div><h3>运行统计</h3><p>数据来自当前 Workbench Tool Gateway，只记录工具调用摘要，不读取 DSH Session。</p></div><select className={css.rangeSelect} aria-label="统计时间范围" value={range} onChange={event => onRangeChange(event.target.value as RangeId)}><option value="24h">最近 24 小时</option><option value="7d">最近 7 天</option><option value="30d">最近 30 天</option><option value="all">全部时间</option></select></div>
    {usage.sourceStatus === 'partial' ? <div className={css.sourceWarning} role="status">当前运行统计可用，聚合持久化暂不可用：{usage.sourceReason ?? '稍后会自动重试。'}</div> : usage.sourceStatus === 'unavailable' ? <div className={css.sourceWarning} role="status">Gateway 统计来源不可用：{usage.sourceReason ?? '请检查 Workbench Settings。'}</div> : null}
    <div className={css.metricGrid}><Metric label="全部调用" value={usage.totals.calls.toLocaleString()} /><Metric label="成功数" value={usage.totals.successes.toLocaleString()} tone="success" /><Metric label="失败数" value={usage.totals.failures.toLocaleString()} tone={usage.totals.failures > 0 ? 'warning' : 'neutral'} /><Metric label="成功率" value={successRate} tone="success" /><Metric label="平均耗时" value={formatDuration(usage.totals.calls > 0 ? usage.totals.totalDurationMs / usage.totals.calls : undefined)} /><Metric label="P95 耗时" value={formatDuration(p95)} /></div>
    <Trend buckets={usage.buckets} maxCalls={maxCalls} />
    <div className={css.rankings}><div className={css.sectionHeading}><strong>Gateway 工具</strong><span>{usage.byTool.length} 个当前目录工具</span></div>{usage.byTool.length === 0 ? <div className={css.noData}>当前 Gateway 还没有注册工具。</div> : usage.byTool.map(item => <GatewayToolRow key={item.toolId} item={item} editor={editors.find(row => row.id === item.editorId)} expanded={expandedToolId === item.toolId} onExpand={() => onExpandTool(item.toolId)} />)}</div>
  </section>
}
function GatewayToolRow({ item, editor, expanded, onExpand }: { item: WorkbenchGatewayToolUsageSummaryV1; editor: WorkbenchEditorCatalogRow | undefined; expanded: boolean; onExpand: () => void }) {
  const status = item.calls === 0 ? '暂无调用记录' : `${item.calls} 次调用`
  return <article className={css.ranking}><button type="button" className={css.rankingButton} aria-expanded={expanded} onClick={onExpand}><span className={css.toolIcon}><WorkbenchEditorIcon name={editor?.icon ?? KIND_ICONS[item.kind]} /></span><span className={css.rankingIdentity}><strong>{editor?.label ?? item.toolId}</strong><small>{item.toolId} · {KIND_LABELS[item.kind]} · {item.moduleId}{item.editorId === undefined ? '' : ` · ${item.editorId}`}</small></span><span className={css.rankingStats}><b>{item.calls}</b><small>{status} · 成功率 {percentage(item.successes, item.calls)} · {formatDuration(item.averageDurationMs)}</small></span><span className={css.rankingChevron}>{expanded ? '⌃' : '⌄'}</span></button>{expanded ? <GatewayToolDetail item={item} /> : null}</article>
}
function GatewayToolDetail({ item }: { item: WorkbenchGatewayToolUsageSummaryV1 }) {
  return <div className={css.rankingDetail}><div className={css.detailStats}><span>成功 {item.successes}</span><span>失败 {item.failures}</span><span>拒绝 {item.rejected}</span><span>取消 {item.cancelled}</span><span>超时 {item.timeouts}</span><span>最近 {formatTime(item.lastCalledAt)}</span></div><div className={css.sectionHeading}><strong>Agent 调用分布</strong><span>{item.byAgent.length} 个 Agent</span></div>{item.byAgent.length === 0 ? <p className={css.noData}>暂无 Agent 调用记录。</p> : <ul className={css.agentList}>{item.byAgent.map(agent => <li key={agent.agentId ?? '__unassigned__'}><span>{agent.agentId ?? '未归属 Agent'}</span><span>{agent.calls} 次 · 成功 {agent.successes} · 失败 {agent.failures}</span><span>{formatDuration(agent.averageDurationMs)}</span></li>)}</ul>}<div className={css.sectionHeading}><strong>失败错误摘要</strong><span>{item.errors.length} 类</span></div>{item.errors.length === 0 ? <p className={css.noData}>暂无失败错误。</p> : <ul className={css.errorList}>{item.errors.map(error => <li key={`${error.code ?? ''}:${error.message}`}><strong>{error.code ?? 'provider.error'}</strong><span>{error.message}</span><small>{error.count} 次 · 最近 {formatTime(error.lastOccurredAt)}</small></li>)}</ul>}</div>
}
function Metric({ label, value, tone = 'neutral' }: { label: string; value: string; tone?: 'neutral' | 'success' | 'warning' }) { return <div className={`${css.metric} ${css[`metric${tone.charAt(0).toUpperCase()}${tone.slice(1)}`]}`}><strong>{value}</strong><span>{label}</span></div> }
function Trend({ buckets, maxCalls }: { buckets: readonly { startAt: string; calls: number }[]; maxCalls: number }) { const points = buckets.map((bucket, index) => `${(index / Math.max(1, buckets.length - 1)) * 100},${100 - bucket.calls / maxCalls * 86}`).join(' '); return <div className={css.trend}><div className={css.sectionHeading}><strong>调用趋势</strong><span>{buckets.length} 个时间桶</span></div><svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-label="调用趋势图" role="img"><polyline points={points || '0,100 100,100'} fill="none" vectorEffect="non-scaling-stroke" /></svg><div className={css.trendBars}>{buckets.slice(-12).map(bucket => <span key={bucket.startAt} style={{ height: `${Math.max(4, bucket.calls / maxCalls * 100)}%` }} title={`${bucket.startAt} · ${bucket.calls} 次`} />)}</div></div> }
function ApiPanel({ entries, gateway, onCopied }: { entries: readonly ToolCatalogEntryV1[]; gateway: WorkbenchToolGatewayV1; onCopied: () => void }) {
  const declaration = `interface ToolContributionV1 {
  id: string
  kind: 'mcp' | 'cli' | 'tool' | 'skill'
  moduleId: string
  editorId?: string
  version: string
  display: { name: string; description?: string }
  execution: { providerId: string; reference: unknown }
}`
  const projection = `const gateway = workbenchToolGateway.forWorkbench(workbenchId)
const projection = await gateway.projectForAgent(agentId)
// projection.allowedToolIds -> Agent allowlist`
  const invocation = `const handle = gateway.beginInvocation({
  invocationId,
  toolId,
  agentId,
})

try {
  const output = await provider.execute(input)
  gateway.completeInvocation({
    invocationId: handle.invocationId,
    outcome: 'success',
  })
  return output
} catch (error) {
  gateway.completeInvocation({
    invocationId: handle.invocationId,
    outcome: 'failure',
    error: { code: 'provider.error', message: sanitizeError(error) },
  })
  throw error
}`
  const envelope = `interface WorkbenchToolResultEnvelopeV1 {
  toolId: string
  invocationId: string
  target: { workbenchId: string; sessionId?: string; agentRunId?: string }
  output: unknown
  resources?: { resourceId: string; resourceType: string; editorId?: string }[]
}`
  return <section id="workbench-tool-panel-api" role="tabpanel" aria-labelledby="workbench-tool-tab-api" className={css.panel}>
    <div className={css.panelIntro}><div><h3>统一接口</h3><p>扩展只声明能力，DSH Runtime / Host 负责执行、凭据和最终权限。</p></div><span className={css.apiCount}>{entries.length} 个已注册工具</span></div>
    <ApiBlock title="能力声明" code={declaration} onCopied={onCopied}><p>使用 MCP、CLI、原生 Tool 和 Skill 四种 kind；moduleId、editorId、版本和 provider 用于目录诊断。</p></ApiBlock>
    <ApiBlock title="Agent 使用" code={projection} onCopied={onCopied}><p>实际投影是 Workbench visibility ∩ Agent allowlist ∩ DSH / Host authorization。目录不会整体注入上下文。</p></ApiBlock>
    <ApiBlock title="Gateway 调用记录" code={invocation} onCopied={onCopied}><p>Gateway 只记录工具、Agent、生命周期、耗时和脱敏错误摘要，不保存参数、结果、凭据、完整堆栈或 transcript。完整单次轨迹继续由 DSH 原生页面负责。</p></ApiBlock>
    <ApiBlock title="结果和资源回流" code={envelope} onCopied={onCopied}><p>资源必须携带稳定 resourceId；Core 根据 resourceType 和 editor 声明打开或激活对应容器内页。</p></ApiBlock>
    <div className={css.snapshotNote}>当前目录 revision {gateway.revision} · 快照通过 <code>gateway.snapshot()</code> 为 Agent 编译和分享提供可重复依据。</div>
  </section>
}function ApiBlock({ title, code, onCopied, children }: { title: string; code: string; onCopied: () => void; children: React.ReactNode }) { const copy = async () => { try { await navigator.clipboard?.writeText(code) } finally { onCopied() } }; return <article className={css.apiBlock}><div className={css.apiHeading}><h4>{title}</h4><button type="button" onClick={() => void copy()}>复制示例</button></div>{children}<pre>{code}</pre></article> }
