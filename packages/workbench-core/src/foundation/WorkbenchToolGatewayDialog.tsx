import { useWorkbenchLocale, workbenchIntlLocale, workbenchErrorNotice, workbenchNoticeText, type WorkbenchNotice, type WorkbenchTranslate } from './workbench-locale.ts'
import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { IconCloseOutlineMedium, IconRefreshOutlineMedium } from '@deepseek-ai/dsh-client-ui-primitives'
import type { WorkbenchEditorCatalogRow } from './catalog.ts'
import { WorkbenchEditorIcon } from './WorkbenchEditorIcon.tsx'
import type { ToolCatalogEntryV1, ToolKindV1, WorkbenchToolGatewayV1 } from '../tool-gateway.ts'
import type { WorkbenchGatewayToolUsageSummaryV1, WorkbenchToolGatewayUsageSnapshotV1 } from '../tool-gateway-usage.ts'
import css from './WorkbenchToolGatewayDialog.module.css'

const KIND_LABELS: Record<ToolKindV1, string> = { mcp: 'MCP', cli: 'CLI', tool: 'Tool', skill: 'Skill' }
const KIND_ICONS: Record<ToolKindV1, string> = { mcp: 'extension', cli: 'terminal', tool: 'tool', skill: 'guide' }
const KIND_DESCRIPTIONS: Record<ToolKindV1, `tools.kind.${ToolKindV1}`> = {
  mcp: 'tools.kind.mcp', cli: 'tools.kind.cli',
  tool: 'tools.kind.tool', skill: 'tools.kind.skill',
}
type TabId = 'visibility' | 'usage' | 'api'
type RangeId = '24h' | '7d' | '30d' | 'all'

function availabilityLabel(t: WorkbenchTranslate, entry: ToolCatalogEntryV1): string {
  if (entry.availability === 'available') return t('tools.available')
  if (entry.availability === 'revoked') return t('tools.revoked')
  if (entry.availability === 'degraded') return entry.reason ?? t('tools.missingRequirement')
  return t('tools.registering')
}
function iconForEntry(entry: ToolCatalogEntryV1, editors: readonly WorkbenchEditorCatalogRow[]): string {
  if (entry.editorId !== undefined) {
    const editor = editors.filter(row => row.id === entry.editorId).sort((left, right) => left.id.localeCompare(right.id))[0]
    if (editor?.icon !== undefined) return editor.icon
  }
  return KIND_ICONS[entry.kind]
}
function formatDuration(t: WorkbenchTranslate, value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return t('tools.noData')
  if (value < 1000) return `${Math.round(value)} ms`
  return `${(value / 1000).toFixed(value >= 10000 ? 1 : 2)} s`
}
function formatTime(t: WorkbenchTranslate, value: string | undefined, language?: string): string {
  if (value === undefined) return t('tools.notAvailable')
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? t('tools.notAvailable') : new Intl.DateTimeFormat(workbenchIntlLocale(language), { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(date)
}
function rangeWindow(range: RangeId): { from: string; to: string } {
  const to = Date.now()
  const from = range === '24h' ? to - 24 * 60 * 60 * 1000 : range === '7d' ? to - 7 * 24 * 60 * 60 * 1000 : range === '30d' ? to - 30 * 24 * 60 * 60 * 1000 : 0
  return { from: new Date(from).toISOString(), to: new Date(to).toISOString() }
}
function percentage(t: WorkbenchTranslate, value: number, total: number): string { return total === 0 ? t('tools.notAvailable') : `${Math.round(value / total * 100)}%` }

export function WorkbenchToolGatewayDialog({ gateway, workbenchId, workbenchName, onClose, editors = [], returnFocusRef, embedded = false }: {
  gateway: WorkbenchToolGatewayV1; workbenchId: string; workbenchName: string; onClose: () => void
  editors?: readonly WorkbenchEditorCatalogRow[]; returnFocusRef?: RefObject<HTMLElement>
  /** Rendered inside the agent assembly dialog, without its own overlay. */
  embedded?: boolean
}) {
  const { t } = useWorkbenchLocale()
  const [revision, setRevision] = useState(0)
  const [tab, setTab] = useState<TabId>('visibility')
  const [range, setRange] = useState<RangeId>('24h')
  const [expandedModules, setExpandedModules] = useState<Set<string>>(() => new Set())
  const [expandedToolId, setExpandedToolId] = useState<string>()
  const [usage, setUsage] = useState<WorkbenchToolGatewayUsageSnapshotV1>()
  const [usageError, setUsageError] = useState<WorkbenchNotice>()
  const [busyToolId, setBusyToolId] = useState<string>()
  const [busyModuleId, setBusyModuleId] = useState<string>()
  const [error, setError] = useState<WorkbenchNotice>()
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
          setUsageError({ key: 'tools.usageUnavailable' })
        }
      } catch (cause) { setUsageError(workbenchErrorNotice(cause, 'tools.usageUnavailable')) }
    }
    refresh()
    return gateway.subscribeUsage?.(refresh)
  }, [gateway, range, tab])
  const toggle = async (entry: ToolCatalogEntryV1) => {
    setBusyToolId(entry.id); setError(undefined)
    try { await gateway.setVisibility({ toolId: entry.id, state: entry.visibility === 'enabled' ? 'disabled' : 'enabled' }); setRevision(value => value + 1) }
    catch (cause) { setError(workbenchErrorNotice(cause, 'tools.saveVisibility')) }
    finally { setBusyToolId(undefined) }
  }
  const toggleModule = async (module: typeof modules[number]) => {
    const nextState = module.entries.every(entry => entry.visibility === 'enabled') ? 'disabled' : 'enabled'
    const key = `${module.moduleId}:${module.editorId ?? ''}`
    setBusyModuleId(key); setError(undefined)
    try {
      const result = gateway.setVisibilityBatch === undefined ? await setVisibilityFallback(gateway, module.entries, nextState) : await gateway.setVisibilityBatch({ toolIds: module.entries.map(entry => entry.id), state: nextState })
      if (result.rejected.length > 0) setError({ key: 'tools.partialUpdate', params: { details: result.rejected.map(row => row.reason ? `${row.toolId} (${row.reason})` : row.toolId).join(', ') } })
      setRevision(value => value + 1)
    } catch (cause) { setError(workbenchErrorNotice(cause, 'tools.saveModule')) }
    finally { setBusyModuleId(undefined) }
  }
  const content = <>
      {embedded ? null : <header className={css.header}><div className={css.headerCopy}><span className={css.eyebrow}>{t('tools.catalogRevision', { revision: gateway.revision })}</span><h2 id="workbench-tool-gateway-title">{t('editor.toolIntegration')}</h2><p>{workbenchName} <code>{workbenchId}</code></p></div><button ref={closeRef} className={css.close} type="button" aria-label={t('tools.closeToolIntegration')} title={t('action.close')} onClick={onClose}><IconCloseOutlineMedium size={17} /></button></header>}
      <div className={css.summary} aria-label={t('tools.toolCatalogSummary')}><Summary label={t('tools.modules')} value={modules.length} /><Summary label={t('tools.tools')} value={entries.length} /><Summary label={t('tools.enabled')} value={enabledCount} tone="success" /><Summary label={t('tools.needsAttention')} value={attentionCount} tone={attentionCount > 0 ? 'warning' : 'neutral'} /><Summary label={t('tools.statistics')} value="Gateway" text /></div>
      <nav className={css.tabs} role="tablist" aria-label={t('tools.toolIntegrationWorkspace')}><Tab id="visibility" active={tab === 'visibility'} onClick={() => setTab('visibility')}>{t('tools.toolControls')}</Tab><Tab id="usage" active={tab === 'usage'} onClick={() => setTab('usage')}>{t('tools.runtimeStatistics')}</Tab><Tab id="api" active={tab === 'api'} onClick={() => setTab('api')}>{t('tools.unifiedInterface')}</Tab></nav>
      {error === undefined ? null : <div className={css.error} role="alert">{workbenchNoticeText(t, error)}</div>}
      <div className={css.body}>{tab === 'visibility' ? <VisibilityPanel entries={entries} modules={modules} editors={editors} expandedModules={expandedModules} onRefresh={() => setRevision(value => value + 1)} onToggleModule={toggleModule} onToggle={toggle} onExpand={key => setExpandedModules(current => { const next = new Set(current); if (next.has(key)) next.delete(key); else next.add(key); return next })} busyToolId={busyToolId} busyModuleId={busyModuleId} /> : tab === 'usage' ? <UsagePanel usage={usage} usageError={usageError} range={range} onRangeChange={next => { setRange(next); setUsage(undefined); setExpandedToolId(undefined) }} expandedToolId={expandedToolId} onExpandTool={toolId => setExpandedToolId(current => current === toolId ? undefined : toolId)} editors={editors} /> : <ApiPanel entries={entries} gateway={gateway} onCopied={() => setRevision(value => value + 1)} />}</div>
      {embedded ? null : <footer className={css.footer}><span>{t('tools.dshControlsFinalPermissionsTheWorkbenchDoes')}</span><button type="button" className={css.done} onClick={onClose}>{t('tools.done')}</button></footer>}
    </>
  return embedded ? <div className={css.embedded} data-workbench-tool-gateway-embedded>{content}</div> : <div className={css.overlay} data-workbench-tool-gateway-overlay onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
    <aside className={css.dialog} role="dialog" aria-modal="true" aria-labelledby="workbench-tool-gateway-title" data-workbench-tool-gateway-dialog>{content}</aside>
  </div>
}

async function setVisibilityFallback(gateway: WorkbenchToolGatewayV1, entries: readonly ToolCatalogEntryV1[], state: 'enabled' | 'disabled') {
  const appliedToolIds: string[] = []; const rejected: Array<{ toolId: string; reason: string }> = []
  for (const entry of entries) { try { await gateway.setVisibility({ toolId: entry.id, state }); appliedToolIds.push(entry.id) } catch (cause) { rejected.push({ toolId: entry.id, reason: cause instanceof Error ? cause.message : '' }) } }
  return { appliedToolIds, rejected }
}
function Summary({ label, value, tone = 'neutral', text = false }: { label: string; value: number | string; tone?: 'neutral' | 'success' | 'warning'; text?: boolean }) { return <div className={`${css.summaryItem} ${css[`summary${tone.charAt(0).toUpperCase()}${tone.slice(1)}`]}`}><strong className={text ? css.summaryText : undefined}>{value}</strong><span>{label}</span></div> }
function Tab({ id, active, onClick, children }: { id: TabId; active: boolean; onClick: () => void; children: string }) { return <button type="button" role="tab" id={`workbench-tool-tab-${id}`} aria-selected={active} aria-controls={`workbench-tool-panel-${id}`} className={active ? css.tabActive : css.tab} onClick={onClick}>{children}</button> }

function VisibilityPanel({ entries, modules, editors, expandedModules, onRefresh, onToggleModule, onToggle, onExpand, busyToolId, busyModuleId }: { entries: readonly ToolCatalogEntryV1[]; modules: readonly { moduleId: string; editorId?: string; entries: ToolCatalogEntryV1[] }[]; editors: readonly WorkbenchEditorCatalogRow[]; expandedModules: ReadonlySet<string>; onRefresh: () => void; onToggleModule: (module: { moduleId: string; editorId?: string; entries: ToolCatalogEntryV1[] }) => void; onToggle: (entry: ToolCatalogEntryV1) => void; onExpand: (key: string) => void; busyToolId: string | undefined; busyModuleId: string | undefined }) {
  const { t } = useWorkbenchLocale()
  return <section id="workbench-tool-panel-visibility" role="tabpanel" aria-labelledby="workbench-tool-tab-visibility" className={css.panel}><div className={css.panelIntro}><div><h3>{t('tools.pageExtensions')}</h3><p>{t('tools.browseSourcesByModuleThenExpandA')}</p></div><button className={css.refresh} type="button" onClick={onRefresh}><IconRefreshOutlineMedium size={15} />{t('tools.rediscover')}</button></div>{modules.length === 0 ? <EmptyState entries={entries} /> : <div className={css.moduleList}>{modules.map(module => { const key = `${module.moduleId}:${module.editorId ?? ''}`; const editor = module.editorId === undefined ? undefined : editors.find(row => row.id === module.editorId); const allEnabled = module.entries.every(entry => entry.visibility === 'enabled'); const unavailable = module.entries.filter(entry => entry.availability !== 'available').length; return <article className={css.moduleCard} key={key}><div className={css.moduleHeader}><button type="button" className={css.moduleExpand} aria-expanded={expandedModules.has(key)} onClick={() => onExpand(key)}><span className={css.chevron} aria-hidden="true">{expandedModules.has(key) ? '⌄' : '›'}</span><span className={css.moduleIcon}><WorkbenchEditorIcon name={editor?.icon ?? 'extension'} /></span><span className={css.moduleIdentity}><strong>{editor?.label ?? module.moduleId}</strong><small>{module.moduleId}{module.editorId === undefined ? '' : ` · ${module.editorId}`}</small></span></button><div className={css.moduleMeta}><span>{module.entries.length} {t('editor.tools')}</span>{unavailable > 0 ? <span className={css.warningText}>{unavailable} {t('tools.needAttention')}</span> : null}<button type="button" className={css.moduleToggle} onClick={() => void onToggleModule(module)} disabled={busyModuleId === key}>{allEnabled ? t('tools.disableAll') : t('tools.enableAll')}</button></div></div>{expandedModules.has(key) ? <div className={css.moduleTools}>{module.entries.toSorted((left, right) => left.kind.localeCompare(right.kind) || left.id.localeCompare(right.id)).map(entry => <ToolRow key={entry.id} entry={entry} icon={iconForEntry(entry, editor === undefined ? [] : [editor])} busy={busyToolId === entry.id} onToggle={() => onToggle(entry)} />)}</div> : null}</article> })}</div>}</section>
}
function EmptyState({ entries }: { entries: readonly ToolCatalogEntryV1[] }) { const { t } = useWorkbenchLocale(); const revoked = entries.length > 0 && entries.every(entry => entry.availability !== 'available'); return <div className={css.empty}><span className={css.emptyIcon}><WorkbenchEditorIcon name={revoked ? 'extension' : 'tool'} /></span><strong>{revoked ? t('tools.allUnavailable') : entries.length === 0 ? t('tools.noDeclaredTools') : t('tools.catalogUnavailable')}</strong><p>{revoked ? t('tools.checkProvider') : entries.length === 0 ? t('tools.enableProvider') : t('tools.checkConnection')}</p></div> }
function ToolRow({ entry, icon, busy, onToggle }: { entry: ToolCatalogEntryV1; icon: string; busy: boolean; onToggle: () => void }) {
  const { t } = useWorkbenchLocale(); const enabled = entry.visibility === 'enabled'; const unavailable = entry.availability !== 'available'; return <article className={css.toolRow} data-availability={entry.availability} data-visibility={entry.visibility}><span className={css.toolIcon}><WorkbenchEditorIcon name={icon} /></span><div className={css.toolIdentity}><div className={css.toolTitle}><strong>{entry.display.name}</strong><code>{entry.id}</code><span className={css.kindBadge}>{KIND_LABELS[entry.kind]}</span></div><p>{entry.display.description ?? t(KIND_DESCRIPTIONS[entry.kind])}</p><small>{entry.execution.providerId} · v{entry.version}{entry.artifactDigest === undefined ? '' : ` · ${entry.artifactDigest.slice(0, 12)}…`}</small>{unavailable ? <span className={css.reason}>{availabilityLabel(t, entry)}</span> : null}</div><button className={css.switch} type="button" role="switch" aria-checked={enabled} aria-label={`${entry.display.name} ${enabled ? t('tools.enabled') : t('tools.disabled')}`} disabled={busy} onClick={onToggle}><span className={css.switchTrack}><span className={css.switchThumb} /></span><span>{busy ? t('tools.saving') : enabled ? t('tools.enabled') : t('tools.disabled')}</span></button></article> }

function UsagePanel({ usage, usageError, range, onRangeChange, editors, expandedToolId, onExpandTool }: { usage: WorkbenchToolGatewayUsageSnapshotV1 | undefined; usageError: WorkbenchNotice | undefined; range: RangeId; onRangeChange: (value: RangeId) => void; editors: readonly WorkbenchEditorCatalogRow[]; expandedToolId: string | undefined; onExpandTool: (toolId: string) => void }) {
  const { t } = useWorkbenchLocale()
  if (usageError !== undefined) return <div className={css.empty}><span className={css.emptyIcon}><WorkbenchEditorIcon name="trajectory" /></span><strong>{t('tools.gatewayStatisticsUnavailable')}</strong><p>{workbenchNoticeText(t, usageError)}</p></div>
  if (usage === undefined) return <div className={css.loading} role="status">{t('tools.loadingGatewayStatistics')}</div>
  const successRate = percentage(t, usage.totals.successes, usage.totals.calls)
  const maxCalls = Math.max(...usage.buckets.map(bucket => bucket.calls), 1)
  const p95 = usage.byTool.map(item => item.p95DurationMs).filter((value): value is number => value !== undefined).sort((left, right) => left - right).at(-1)
  return <section id="workbench-tool-panel-usage" role="tabpanel" aria-labelledby="workbench-tool-tab-usage" className={css.panel}>
    <div className={css.panelIntro}><div><h3>{t('tools.runtimeStatistics')}</h3><p>{t('tools.theWorkbenchToolGatewayRecordsASummary')}</p></div><select className={css.rangeSelect} aria-label={t('tools.statisticsTimeRange')} value={range} onChange={event => onRangeChange(event.target.value as RangeId)}><option value="24h">{t('tools.last24Hours')}</option><option value="7d">{t('tools.last7Days')}</option><option value="30d">{t('tools.last30Days')}</option><option value="all">{t('tools.allTime')}</option></select></div>
    {usage.sourceStatus === 'partial' ? <div className={css.sourceWarning} role="status">{t('tools.liveStatisticsAreAvailableButSavedAggregates')}{usage.sourceReason ?? t('tools.retrySoon')}</div> : usage.sourceStatus === 'unavailable' ? <div className={css.sourceWarning} role="status">{t('tools.gatewayStatisticsSourceUnavailable')}{usage.sourceReason ?? t('tools.checkSettings')}</div> : null}
    <div className={css.metricGrid}><Metric label={t('tools.totalCalls')} value={usage.totals.calls.toLocaleString()} /><Metric label={t('tools.successfulCalls')} value={usage.totals.successes.toLocaleString()} tone="success" /><Metric label={t('tools.failedCalls')} value={usage.totals.failures.toLocaleString()} tone={usage.totals.failures > 0 ? 'warning' : 'neutral'} /><Metric label={t('tools.successRate')} value={successRate} tone="success" /><Metric label={t('tools.averageDuration')} value={formatDuration(t, usage.totals.calls > 0 ? usage.totals.totalDurationMs / usage.totals.calls : undefined)} /><Metric label={t('tools.p95Duration')} value={formatDuration(t, p95)} /></div>
    <Trend buckets={usage.buckets} maxCalls={maxCalls} />
    <div className={css.rankings}><div className={css.sectionHeading}><strong>{t('tools.gatewayTools')}</strong><span>{usage.byTool.length} {t('tools.toolsInTheCurrentCatalog')}</span></div>{usage.byTool.length === 0 ? <div className={css.noData}>{t('tools.noToolsAreRegisteredWithThisGateway')}</div> : usage.byTool.map(item => <GatewayToolRow key={item.toolId} item={item} editor={editors.find(row => row.id === item.editorId)} expanded={expandedToolId === item.toolId} onExpand={() => onExpandTool(item.toolId)} />)}</div>
  </section>
}
function GatewayToolRow({ item, editor, expanded, onExpand }: { item: WorkbenchGatewayToolUsageSummaryV1; editor: WorkbenchEditorCatalogRow | undefined; expanded: boolean; onExpand: () => void }) {
  const { t } = useWorkbenchLocale()
  const status = item.calls === 0 ? t('tools.noCalls') : t('tools.callCount', { count: item.calls })
  return <article className={css.ranking}><button type="button" className={css.rankingButton} aria-expanded={expanded} onClick={onExpand}><span className={css.toolIcon}><WorkbenchEditorIcon name={editor?.icon ?? KIND_ICONS[item.kind]} /></span><span className={css.rankingIdentity}><strong>{editor?.label ?? item.toolId}</strong><small>{item.toolId} · {KIND_LABELS[item.kind]} · {item.moduleId}{item.editorId === undefined ? '' : ` · ${item.editorId}`}</small></span><span className={css.rankingStats}><b>{item.calls}</b><small>{status} {t('tools.successRate2')} {percentage(t, item.successes, item.calls)} · {formatDuration(t, item.averageDurationMs)}</small></span><span className={css.rankingChevron}>{expanded ? '⌃' : '⌄'}</span></button>{expanded ? <GatewayToolDetail item={item} /> : null}</article>
}
function GatewayToolDetail({ item }: { item: WorkbenchGatewayToolUsageSummaryV1 }) {
  const { t, language } = useWorkbenchLocale()
  return <div className={css.rankingDetail}><div className={css.detailStats}><span>{t('tools.succeeded')} {item.successes}</span><span>{t('task.failed')} {item.failures}</span><span>{t('tools.denied')} {item.rejected}</span><span>{t('tools.canceled')} {item.cancelled}</span><span>{t('tools.timedOut')} {item.timeouts}</span><span>{t('tools.latest')} {formatTime(t, item.lastCalledAt, language)}</span></div><div className={css.sectionHeading}><strong>{t('tools.callsByAgent')}</strong><span>{item.byAgent.length} {t('tools.agents')}</span></div>{item.byAgent.length === 0 ? <p className={css.noData}>{t('tools.noAgentCallsYet')}</p> : <ul className={css.agentList}>{item.byAgent.map(agent => <li key={agent.agentId ?? '__unassigned__'}><span>{agent.agentId ?? t('tools.unassignedAgent')}</span><span>{agent.calls} {t('tools.callsSucceeded')} {agent.successes} {t('tools.failed')} {agent.failures}</span><span>{formatDuration(t, agent.averageDurationMs)}</span></li>)}</ul>}<div className={css.sectionHeading}><strong>{t('tools.failureSummaries')}</strong><span>{t('tools.failureCategories', { count: item.errors.length })}</span></div>{item.errors.length === 0 ? <p className={css.noData}>{t('tools.noFailures')}</p> : <ul className={css.errorList}>{item.errors.map(error => <li key={`${error.code ?? ''}:${error.message}`}><strong>{error.code ?? 'provider.error'}</strong><span>{error.message}</span><small>{error.count} {t('tools.callsLatest')} {formatTime(t, error.lastOccurredAt, language)}</small></li>)}</ul>}</div>
}
function Metric({ label, value, tone = 'neutral' }: { label: string; value: string; tone?: 'neutral' | 'success' | 'warning' }) { return <div className={`${css.metric} ${css[`metric${tone.charAt(0).toUpperCase()}${tone.slice(1)}`]}`}><strong>{value}</strong><span>{label}</span></div> }
function Trend({ buckets, maxCalls }: { buckets: readonly { startAt: string; calls: number }[]; maxCalls: number }) {
  const { t } = useWorkbenchLocale(); const points = buckets.map((bucket, index) => `${(index / Math.max(1, buckets.length - 1)) * 100},${100 - bucket.calls / maxCalls * 86}`).join(' '); return <div className={css.trend}><div className={css.sectionHeading}><strong>{t('tools.callTrends')}</strong><span>{buckets.length} {t('tools.timeBuckets')}</span></div><svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-label={t('tools.callTrendChart')} role="img"><polyline points={points || '0,100 100,100'} fill="none" vectorEffect="non-scaling-stroke" /></svg><div className={css.trendBars}>{buckets.slice(-12).map(bucket => <span key={bucket.startAt} style={{ height: `${Math.max(4, bucket.calls / maxCalls * 100)}%` }} title={t('tools.trendTooltip', { time: bucket.startAt, count: bucket.calls })} />)}</div></div> }
function ApiPanel({ entries, gateway, onCopied }: { entries: readonly ToolCatalogEntryV1[]; gateway: WorkbenchToolGatewayV1; onCopied: () => void }) {
  const { t } = useWorkbenchLocale()
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
    <div className={css.panelIntro}><div><h3>{t('tools.unifiedInterface')}</h3><p>{t('tools.extensionsDeclareCapabilitiesDshHandlesExecutionCredentials')}</p></div><span className={css.apiCount}>{entries.length} {t('tools.registeredTools')}</span></div>
    <ApiBlock title={t('tools.capabilityDeclarations')} code={declaration} onCopied={onCopied}><p>{t('tools.supportedKindsAreMcpCliNativeTool')}</p></ApiBlock>
    <ApiBlock title={t('tools.agentAccess')} code={projection} onCopied={onCopied}><p>{t('tools.toolsAreAvailableOnlyWhenVisibleIn')}</p></ApiBlock>
    <ApiBlock title={t('tools.gatewayCallHistory')} code={invocation} onCopied={onCopied}><p>{t('tools.theGatewayRecordsToolsAgentsLifecycleEvents')}</p></ApiBlock>
    <ApiBlock title={t('tools.resultsAndResources')} code={envelope} onCopied={onCopied}><p>{t('tools.resourcesNeedAStableResourceidBayCore')}</p></ApiBlock>
    <div className={css.snapshotNote}>{t('tools.currentRevision', { revision: gateway.revision })} {t('tools.snapshotValid')} <code>gateway.snapshot()</code> {t('tools.providesAReproducibleInputForAgentCompilation')}</div>
  </section>
}function ApiBlock({ title, code, onCopied, children }: { title: string; code: string; onCopied: () => void; children: React.ReactNode }) {
  const { t } = useWorkbenchLocale(); const copy = async () => { try { await navigator.clipboard?.writeText(code) } finally { onCopied() } }; return <article className={css.apiBlock}><div className={css.apiHeading}><h4>{title}</h4><button type="button" onClick={() => void copy()}>{t('tools.copyExample')}</button></div>{children}<pre>{code}</pre></article> }
