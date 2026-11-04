import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { IconSearchOutlineRegular, IconShareOutlineMedium, IconSettingsOutlineMedium } from '@deepseek-ai/dsh-client-ui-primitives'
import type { WorkbenchCoreSettingsSectionProps } from './WorkbenchCoreSettingsSection.tsx'
import { WorkbenchEditorIcon as EditorIcon } from './WorkbenchEditorIcon.tsx'
import { resolveWorkbenchEditorPresentation, type WorkbenchEditorCatalogRow } from './catalog.ts'
import { buildWorkbenchInventory } from './workbench-inventory.ts'
import { areasOf, type WorkbenchNodeV3 } from './document-v3.ts'
import type { WorkbenchRecordV2, WorkbenchSettingsV4 } from './persistence.ts'
import { normalizeWorkbenchTags } from './persistence.ts'
import { DESKTOP_SETTINGS_CONTEXT, settingsTargetWritable, type SettingsViewMemory, type WorkbenchSettingsOpenOptionsV1 } from './settings-context.ts'
import { WORKBENCH_CORE_VERSION, WORKBENCH_DSH_GENERATION } from '../release-compatibility.ts'
import { workbenchExtensionUnavailableCopyV1, type WorkbenchExtensionAccessSnapshotV1 } from '../workbench-extension-access.ts'
import { DEFAULT_WORKBENCH_CONVERSATION_INTERACTION_POLICY, normalizeWorkbenchConversationInteractionPolicy } from '../workbench-interaction-policy.ts'
import type { WorkbenchConversationResourcePlacementV1 } from '../workbench-interaction-policy.ts'
import css from './WorkbenchSettings.module.css'

export interface PendingSettingsForm { save(): Promise<boolean>; discard(): void }
export type SettingsPageProps = WorkbenchCoreSettingsSectionProps & {
  value: WorkbenchSettingsV4 | undefined
  editors: readonly WorkbenchEditorCatalogRow[]
  memory: SettingsViewMemory
  navigate(options: WorkbenchSettingsOpenOptionsV1): void
  onDirty(form: PendingSettingsForm | undefined): void
}
export function useSettingsAction(messages = { busy: '正在保存…', success: '已保存' }) {
  const [states, setStates] = useState<Record<string, { busy: boolean; message: string; error: boolean }>>({})
  const pending = useRef(new Set<string>())
  const retries = useRef(new Map<string, () => Promise<unknown>>())
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const run = async (key: string, action: () => Promise<unknown>) => {
    if (pending.current.has(key)) return false
    pending.current.add(key)
    retries.current.set(key, action)
    setStates(current => ({ ...current, [key]: { busy: true, message: messages.busy, error: false } }))
    try {
      const result = await action()
      if (result === false || (result && typeof result === 'object' && 'status' in result && result.status !== 'committed')) {
        const status = result && typeof result === 'object' && 'status' in result ? result.status : ''
        throw new Error(status === 'conflict' ? '其他窗口已更新设置，本次未覆盖。请检查后重试。' : '操作未完成，请检查目标状态并重试。')
      }
      if (mounted.current) setStates(current => ({ ...current, [key]: { busy: false, message: messages.success, error: false } }))
      return true
    } catch (error) {
      if (mounted.current) setStates(current => ({ ...current, [key]: { busy: false, message: error instanceof Error ? error.message : '保存失败，请重试。', error: true } }))
      return false
    } finally { pending.current.delete(key) }
  }
  return { states, run, feedback: (key: string) => states[key] ? <span className={css.feedback} role={states[key].error ? 'alert' : 'status'}>{states[key].message}{states[key].error ? <button onClick={() => { const retry = retries.current.get(key); if (retry) void run(key, retry) }}>重试</button> : null}</span> : null }
}

export function PageIcon({ editor }: { editor: WorkbenchEditorCatalogRow }) {
  const { icon, iconSvg } = resolveWorkbenchEditorPresentation(editor)
  return <span className={css.pageIcon} data-editor-icon={icon}><EditorIcon name={icon} iconSvg={iconSvg} /></span>
}
export function BindingRequirement({ editor }: { editor: WorkbenchEditorCatalogRow | undefined }) {
  return <span>{editor?.resourceOnly ? '由对话结果打开' : editor?.declaration?.requiredBinding === 'session' ? '需要对话' : editor?.declaration?.requiredBinding === 'workspace' ? '需要工作区' : editor?.declaration?.requiredBinding === 'none' ? '可直接使用' : '资源要求尚未检查'}</span>
}
export function LayoutDiagram({ node, editors, compact = false }: { node: WorkbenchNodeV3; editors: readonly WorkbenchEditorCatalogRow[]; compact?: boolean }): ReactNode {
  if (node.kind === 'split') return <div className={css.split} style={{ flexDirection: node.axis === 'horizontal' ? 'row' : 'column' }}>
    <div style={{ flex: `${node.ratio} 1 0` }}><LayoutDiagram node={node.first} editors={editors} compact={compact} /></div>
    <div style={{ flex: `${1 - node.ratio} 1 0` }}><LayoutDiagram node={node.second} editors={editors} compact={compact} /></div>
  </div>
  const page = node.moduleHistory.find(page => page.moduleInstanceId === node.activeModuleInstanceId) ?? node.moduleHistory[0]
  const editor = page && editors.find(row => row.id === page.editorId && row.scope === page.editorScope)
  return <div className={`${css.previewArea} ${compact ? css.previewAreaCompact : ''}`}>
    {page ? <span className={compact ? css.previewGlyph : undefined} aria-hidden={compact || undefined}><PageIcon editor={editor ?? { id: page.editorId, scope: page.editorScope, label: page.lastKnownTitle ?? page.editorId }} /></span> : null}
    {!compact ? <><span>{editor?.label ?? page?.lastKnownTitle ?? '空区域'}</span><small>{node.moduleHistory.length} 个内页</small></> : null}
  </div>
}

export function WorkbenchManagementPage(props: SettingsPageProps) {
  const context = props.settingsContext ?? DESKTOP_SETTINGS_CONTEXT
  const browser = context.mode === 'browser-workbench'
  const directory = props.workbenchDirectory
  const [query, setQuery] = useState(props.memory.searches.workbenches ?? '')
  const [category, setCategory] = useState(props.memory.filters.workbenches ?? 'all')
  const [selectedId, setSelectedId] = useState(props.openOptions?.workbenchId ?? props.memory.selectedId ?? (browser ? context.workbenchId : undefined))
  const actions = useSettingsAction()
  const rows = Object.values(props.value?.workbenches ?? {})
  const openIds = props.value?.openWorkbenchIds ?? rows.filter(row => !row.archivedAt).map(row => row.workbenchId)
  const [pendingSelection, setPendingSelection] = useState<(() => void)>()
  const pendingForm = useRef<PendingSettingsForm>()
  const select = (id?: string) => {
    const apply = () => { setSelectedId(id); if (id) props.memory.selectedId = id; else delete props.memory.selectedId }
    if (pendingForm.current) setPendingSelection(() => apply); else apply()
  }
  const selected = rows.find(row => row.workbenchId === selectedId)
  const inventories = useMemo(() => new Map(rows.map(row => [row.workbenchId, buildWorkbenchInventory(row.document, props.editors)])), [props.value?.workbenches, props.editors])
  const filtered = rows.filter(row => browser || category === 'all' || (category === 'archived' ? row.archivedAt !== undefined : row.archivedAt === undefined && (category === 'open' ? openIds.includes(row.workbenchId) : !openIds.includes(row.workbenchId))))
    .filter(row => `${row.name} ${row.description} ${row.tags?.join(' ') ?? ''}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
    .sort((a, b) => Number(Boolean(b.pinnedAt)) - Number(Boolean(a.pinnedAt)) || b.updatedAt - a.updatedAt)
  const reportDirty = useCallback((form: PendingSettingsForm | undefined) => { pendingForm.current = form; props.onDirty(form) }, [props.onDirty])
  return <section className={`${css.page} ${selected ? css.pageDetail : ''}`}>
    <header className={css.pageHeader}><div><h3>{browser ? '当前工作台' : '工作台管理'}</h3><p>关闭视图、归档或删除布局不会删除对话，也不会取消模型任务或终端进程。</p></div>
      {!browser ? <button className={css.primaryButton} onClick={() => props.navigate({ section: 'sharing', shareMode: 'import' })}>导入工作台</button> : null}</header>
    {!selected ? <>
      <label className={css.search}><IconSearchOutlineRegular aria-hidden="true" /><input type="search" aria-label="搜索工作台" placeholder="搜索名称、简介或标签" value={query} onChange={event => { setQuery(event.target.value); props.memory.searches.workbenches = event.target.value }} /></label>
      {!browser ? <div className={css.filters} aria-label="工作台状态">{[['all', '全部'], ['open', '已打开'], ['inactive', '未打开'], ['archived', '已归档']].map(([id, label]) => <button key={id} aria-pressed={category === id} onClick={() => { setCategory(id!); props.memory.filters.workbenches = id! }}>{label}</button>)}</div> : null}
      <div className={css.cards}>{filtered.map(row => { const inventory = inventories.get(row.workbenchId); const writable = settingsTargetWritable(context, row.workbenchId, props.windowController)
        return <button key={row.workbenchId} className={css.card} onClick={() => select(row.workbenchId)}>
          <span className={css.cardTitle}>{row.pinnedAt ? '置顶 · ' : ''}{row.name}</span><span className={`${css.preview} ${css.previewCompact}`}><LayoutDiagram node={row.document.root} editors={props.editors} compact /></span>
          <span>{row.description || '暂无简介'}</span><small>{row.tags?.join(' · ')}</small>
          <small>{inventory ? `${inventory.areas.length} 个区域 · ${inventory.pageCount} 个内页` : '尚未检查'} · {writable ? '本机' : '浏览器运行中'}</small><small>修改于 {new Date(row.updatedAt).toLocaleString()}</small>
        </button> })}</div>
      {filtered.length === 0 ? <div className={css.empty}>没有符合条件的工作台。</div> : null}
      {Object.values(props.value?.invalidWorkbenches ?? {}).length ? <details open={props.openOptions?.workbenchId !== undefined && props.value?.invalidWorkbenches[props.openOptions.workbenchId] !== undefined ? true : undefined}><summary>无法解析的历史布局</summary>{Object.values(props.value!.invalidWorkbenches).map(row => <div key={row.workbenchId}><strong>{row.name}</strong><p>布局尚未检查，原始记录已保留。</p><button className={css.secondaryButton} onClick={() => downloadSettingsFile(`${row.name}-诊断.json`, JSON.stringify(row.rawRecord, null, 2), 'application/json')}>导出原始诊断配置</button></div>)}</details> : null}
    </> : <>
      {!browser ? <button className={css.backButton} onClick={() => select()}>‹ 返回工作台列表</button> : null}
      <WorkbenchDetails key={selected.workbenchId} {...props} record={selected} onDirty={reportDirty} onRemoved={() => select()} action={actions} />
    </>}
    {pendingSelection ? <UnsavedFormPrompt form={pendingForm.current!} onContinue={() => setPendingSelection(undefined)} onLeave={() => { const next = pendingSelection; setPendingSelection(undefined); next() }} /> : null}
    {directory ? null : <p role="alert">工作台管理服务暂不可用，请恢复连接后重试。</p>}
  </section>
}

export function UnsavedFormPrompt({ form, onContinue, onLeave }: { form: PendingSettingsForm; onContinue(): void; onLeave(): void }) {
  const [busy, setBusy] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => { const focus = document.activeElement; root.current?.querySelector<HTMLButtonElement>('button')?.focus(); return () => { if (focus instanceof HTMLElement && focus.isConnected) focus.focus() } }, [])
  return createPortal(<div className={`${css.settingsRoot} ${css.promptLayer}`}><div className={css.promptBackdrop}><div className={css.prompt} ref={root} role="alertdialog" aria-modal="true" aria-label="资料尚未保存" onKeyDown={event => {
    if (event.key === 'Escape') { event.stopPropagation(); onContinue() }
    if (event.key === 'Tab') { const buttons = [...root.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')]; const index = buttons.indexOf(document.activeElement as HTMLButtonElement); event.preventDefault(); buttons[(index + (event.shiftKey ? buttons.length - 1 : 1)) % buttons.length]?.focus() }
  }}><h3>资料尚未保存</h3><p>保存后离开，或放弃这次资料编辑。</p><div className={css.actions}>
    <button className={css.primaryButton} disabled={busy} onClick={() => { setBusy(true); void form.save().then(ok => { setBusy(false); if (ok) onLeave() }) }}>保存并离开</button>
    <button className={css.secondaryButton} disabled={busy} onClick={() => { form.discard(); onLeave() }}>放弃修改</button><button className={css.secondaryButton} disabled={busy} onClick={onContinue}>继续编辑</button>
  </div></div></div></div>, document.body)
}

function WorkbenchDetails(props: SettingsPageProps & { record: WorkbenchRecordV2; onRemoved(): void; action: ReturnType<typeof useSettingsAction> }) {
  const { record, action, workbenchDirectory: directory } = props
  const context = props.settingsContext ?? DESKTOP_SETTINGS_CONTEXT
  const writable = settingsTargetWritable(context, record.workbenchId, props.windowController)
  const global = context.mode === 'desktop'
  const inventory = useMemo(() => buildWorkbenchInventory(record.document, props.editors), [record.document, props.editors])
  const [name, setName] = useState(record.name)
  const [description, setDescription] = useState(record.description)
  const [tags, setTags] = useState(record.tags?.join('，') ?? '')
  const normalizedTags = normalizeWorkbenchTags(tags.split(/[,，]/u))
  const dirty = name.trim() !== record.name || description.trim() !== record.description
    || JSON.stringify(normalizedTags) !== JSON.stringify(record.tags ?? [])
  const [confirmDelete, setConfirmDelete] = useState(false)
  const save = useCallback(async () => {
    if (!directory) return false
    return action.run('metadata', () => directory.updateMetadata(record.workbenchId, { name, description, tags: tags.split(/[,，]/u).map(tag => tag.trim()).filter(Boolean) }))
  }, [name, description, tags, record.workbenchId, directory, action.run])
  const discard = useCallback(() => { setName(record.name); setDescription(record.description); setTags(record.tags?.join('，') ?? '') }, [record.name, record.description, record.tags])
  const saveRef = useRef(save); saveRef.current = save
  const discardRef = useRef(discard); discardRef.current = discard
  useEffect(() => { props.onDirty(dirty ? { save: () => saveRef.current(), discard: () => discardRef.current() } : undefined); return () => props.onDirty(undefined) }, [dirty, props.onDirty])
  const mutate = (key: string, fn: () => Promise<unknown>) => void action.run(key, fn)
  const openIds = props.value?.openWorkbenchIds ?? []
  const statusLabel = !writable ? '浏览器运行中' : record.archivedAt !== undefined ? '已归档' : openIds.includes(record.workbenchId) ? '已打开' : '未打开'
  return <div className={css.detail}>
    <header className={css.detailHeader}>
      <div className={css.detailHeaderMain}>
        <div className={css.detailBackRow}><span className={css.detailEyebrow}>工作台详情</span><span className={css.detailId}>{record.workbenchId}</span></div>
        <h3 className={css.workbenchName}>{record.name}</h3>
        <p>{record.description || '暂无简介'}{props.value?.activeWorkbenchId === record.workbenchId && openIds.includes(record.workbenchId) ? ' · 当前工作台' : ''}</p>
        <div className={css.detailBadges}><span className={css.statusBadge} data-status={writable ? 'ready' : 'browser'}>{statusLabel}</span><span>{inventory.areas.length} 个区域</span><span>{inventory.pageCount} 个内页</span>{inventory.missingPageCount ? <span className={css.warningBadge}>{inventory.missingPageCount} 个不可用</span> : null}</div>
      </div>
      <div className={css.detailHeaderActions}>
        {!writable ? <button className={css.primaryButton} disabled={action.states.reclaim?.busy} onClick={() => mutate('reclaim', async () => { const result = await props.windowController?.reclaim?.(record.workbenchId); if (result?.status !== 'reclaimed') throw new Error('尚未确认收回，请检查浏览器连接后重试。') })}>收回到 DSH 客户端</button> : null}
        {global && writable && !record.archivedAt ? <button className={css.primaryButton} disabled={!directory} onClick={() => mutate('open', () => props.onOpenWorkbench ? props.onOpenWorkbench(record.workbenchId) : directory!.openAndSelect(record.workbenchId))}>打开工作台</button> : null}
        <button className={css.secondaryButton} onClick={() => props.navigate({ section: 'sharing', workbenchId: record.workbenchId, shareMode: 'export' })} disabled={!writable}>分享</button>
        {action.feedback('reclaim')}{action.feedback('open')}
      </div>
    </header>
    <section className={css.metadataSection}><div className={css.sectionHeader}><div><h4>资料与状态</h4><p>名称、简介和标签用于识别工作台，不会改变区域或对话绑定。</p></div><span className={css.sectionHint}>{dirty ? '有未保存修改' : '已同步'}</span></div><fieldset disabled={!writable || action.states.metadata?.busy || !directory} className={`${css.form} ${css.metadataForm}`}>
      <label>名称<input maxLength={160} value={name} onChange={event => setName(event.target.value)} /></label>
      <label className={css.metadataDescription}>简介<textarea rows={3} maxLength={4000} value={description} onChange={event => setDescription(event.target.value)} /></label>
      <label>标签<input value={tags} onChange={event => setTags(event.target.value)} placeholder="用逗号分隔" /></label>
      <div className={css.stickyActions}><button disabled={!dirty} onClick={() => void save()}>保存资料</button><button disabled={!dirty} onClick={discard}>取消</button>{action.feedback('metadata')}</div>
    </fieldset>{record.offlineOrigin || record.packageOrigin ? <p>导入来源：{record.offlineOrigin?.archiveSha256 ?? record.packageOrigin?.archiveSha256}</p> : null}
    {global ? <div className={css.actions}>
      <button className={css.secondaryButton} disabled={!writable || !directory} onClick={() => mutate('pin', () => directory!.setPinned(record.workbenchId, !record.pinnedAt))}>{record.pinnedAt ? '取消置顶' : '置顶'}</button>
      {openIds.includes(record.workbenchId) ? <button className={css.secondaryButton} disabled={!writable || !directory} onClick={() => mutate('unload', () => directory!.unload(record.workbenchId))}>关闭视图</button> : null}
      <button className={css.secondaryButton} disabled={!writable || !directory} onClick={() => mutate('archive', () => record.archivedAt ? directory!.restore(record.workbenchId) : directory!.archive(record.workbenchId))}>{record.archivedAt ? '恢复工作台' : '归档工作台'}</button>
      {['pin', 'unload', 'archive'].map(key => <span key={key}>{action.feedback(key)}</span>)}
    </div> : null}</section>
    <section className={css.previewSection}><div className={css.sectionHeader}><div><h4>布局预览</h4><p>显示每个区域的分屏比例和当前内页。</p></div><span className={css.sectionCount}>{inventory.areas.length} 个区域</span></div><div className={css.largePreview}><LayoutDiagram node={record.document.root} editors={props.editors} /></div><div className={css.previewSummary}><span>{inventory.pageCount} 个保留内页</span><span>{inventory.missingPageCount ? `${inventory.missingPageCount} 个内页不可用` : '全部内页已就绪'}</span></div></section>
    <section className={css.pagesSection}><div className={css.sectionHeader}><div><h4>区域与内页</h4><p>保留的标签和当前内页会随工作台一起保存。</p></div><span className={css.sectionCount}>{inventory.pageCount} 个内页</span></div>{inventory.areas.map(area => <div key={area.areaId} className={css.group}><div className={css.groupHeader}><h5>区域 {area.ordinal}</h5><span>{area.pages.length} 个内页</span></div>{area.pages.map((page, index) => {
      const editor = props.editors.find(editor => editor.id === page.editorId && editor.scope === page.editorScope)
      return <div className={css.row} key={page.moduleInstanceId}><PageIcon editor={editor ?? { id: page.editorId, scope: page.editorScope, label: page.name }} /><div><strong>{index + 1}. {page.name}{page.active ? ' · 当前' : ''}</strong><p><BindingRequirement editor={editor} /> · {page.available ? '就绪' : '未安装、未允许或无法核实，布局引用已保留'}</p><small>{page.editorId}</small></div></div>
    })}</div>)}</section>
    <section className={css.extensionsSection}><div className={css.sectionHeader}><div><h4>所需扩展</h4><p>工作台实际引用的扩展和兼容状态。</p></div><span className={css.sectionCount}>{inventory.plugins.length} 个包</span></div>{inventory.plugins.length ? <div className={css.pluginList}>{inventory.plugins.map(plugin => <div className={css.pluginRow} key={plugin.key}><span className={css.pluginStatus} data-status={plugin.status}>{plugin.status === 'available' ? '✓' : '!'}</span><div><strong>{plugin.pluginId ?? '提供包尚未核实'}</strong><p>{plugin.pageCount} 个内页 · {plugin.status === 'available' ? '已就绪' : plugin.status === 'missing' ? '需要处理' : '尚未检查'}</p></div></div>)}</div> : <div className={css.emptyInline}>此工作台只使用 DSH 原生内页，不需要额外扩展。</div>}</section>
    <section className={css.shareSection}><div className={css.sectionHeader}><div><h4>分享与诊断</h4><p>{global ? '可分享布局，或在检查通过后分发包含扩展与配置的工作台包；不包含对话、凭据或本机路径。' : '分享包只包含布局和可迁移配置，不包含对话、凭据或本机路径。'}</p></div></div><div className={css.shareActions}><button className={css.primaryButton} disabled={!writable} onClick={() => props.navigate({ section: 'sharing', workbenchId: record.workbenchId, shareMode: 'export' })}><IconShareOutlineMedium size={16} /> 分享这个工作台</button><details><summary>兼容与诊断</summary><p>原始配置包含本机绑定，只用于排查问题，不是布局分享包。</p><button className={css.secondaryButton} onClick={() => downloadSettingsFile(`${record.name}-诊断.json`, JSON.stringify(record, null, 2), 'application/json')}>导出原始诊断配置</button></details></div></section>
    {global ? <section className={css.danger}><h4>危险操作</h4><p>永久删除工作台布局，DSH 对话和运行任务保留。当前视图会自动关闭；删除最后一个工作台后回到总览。</p>
      {confirmDelete ? <div className={css.actions}><button className={css.dangerButton} disabled={!writable || action.states.delete?.busy} onClick={() => mutate('delete', async () => { const result = await directory?.remove(record.workbenchId); if (result?.status === 'committed') props.onRemoved(); return result })}>确认永久删除“{record.name}”</button><button className={css.secondaryButton} onClick={() => setConfirmDelete(false)}>取消</button></div>
        : <button className={css.dangerButton} disabled={!writable || !directory} onClick={() => setConfirmDelete(true)}>永久删除布局</button>}{action.feedback('delete')}</section> : null}
  </div>
}

const EMPTY_EXTENSIONS: WorkbenchExtensionAccessSnapshotV1 = { status: 'unavailable', extensions: [] }
export function InnerPagesSettingsPage(props: SettingsPageProps) {
  const browser = props.settingsContext?.mode === 'browser-workbench'
  const registry = props.extensionRegistry
  const subscribe = useCallback((listener: () => void) => registry?.subscribe(listener) ?? (() => {}), [registry])
  const get = useCallback(() => registry?.getSnapshot() ?? EMPTY_EXTENSIONS, [registry])
  const access = useSyncExternalStore(subscribe, get, get)
  const [query, setQuery] = useState(props.memory.searches.pages ?? '')
  const [filter, setFilter] = useState(props.memory.filters.pages ?? 'all')
  const [confirmRevoke, setConfirmRevoke] = useState<string>()
  const actions = useSettingsAction()
  const used = useMemo(() => new Set(Object.values(props.value?.workbenches ?? {}).flatMap(row => areasOf(row.document.root).flatMap(area => area.moduleHistory.map(page => `${page.editorScope}:${page.editorId}`)))), [props.value?.workbenches])
  const rows = [...props.editors]
  for (const extension of access.extensions) for (const editorId of extension.editorIds) {
    if (!rows.some(row => row.id === editorId)) rows.push({ id: editorId, scope: 'session', label: editorId })
  }
  const filtered = rows.filter(editor => !browser || used.has(`${editor.scope}:${editor.id}`)).filter(editor => {
    const extension = access.extensions.find(row => row.editorIds.includes(editor.id))
    const builtin = extension === undefined && editor.id.startsWith('workbench.') && props.editors.includes(editor)
    return `${editor.label} ${extension?.packageName ?? ''} ${editor.id}`.toLowerCase().includes(query.toLowerCase())
      && (filter === 'all' || (filter === 'builtin' && builtin) || (filter === 'extension' && !builtin) || (filter === 'attention' && extension?.availability !== 'ready' && !builtin))
  })
  return <section className={css.page}><header className={css.pageHeader}><div><h3>{browser ? '使用中的内页' : '内页与扩展'}</h3><p>Core {WORKBENCH_CORE_VERSION} · 默认原生内页随 Core 提供 · DSH {WORKBENCH_DSH_GENERATION}</p><small>测试构建：{typeof __WORKBENCH_BUILD_ID__ === 'string' ? __WORKBENCH_BUILD_ID__ : 'development'}</small></div>
    {!browser ? <button className={css.secondaryButton} onClick={() => void actions.run('plugins', async () => { if (!props.nativePluginNavigation) throw new Error('此宿主未提供插件管理入口，请从 DSH 设置打开。'); await props.nativePluginNavigation.open() })}><IconSettingsOutlineMedium size={16} /> DSH 插件管理</button> : null}</header>{actions.feedback('plugins')}
    <label className={css.search}><IconSearchOutlineRegular aria-hidden="true" /><input type="search" aria-label="搜索内页与扩展" placeholder="搜索内页名称、用途或提供包" value={query} onChange={event => { setQuery(event.target.value); props.memory.searches.pages = event.target.value }} /></label>
    {!browser ? <div className={css.filters}>{[['all', '全部'], ['builtin', '内置'], ['extension', '扩展'], ['attention', '需要处理']].map(([id, label]) => <button key={id} aria-pressed={filter === id} onClick={() => { setFilter(id!); props.memory.filters.pages = id! }}>{label}</button>)}</div> : null}
    <p className={css.pageSummary}>{filtered.length} 个内页{access.status === 'unavailable' ? ' · 扩展安装状态尚未检查' : ''}</p>
    <div className={`${css.list} ${css.editorList}`}>{filtered.map(editor => {
      const extension = access.extensions.find(row => row.editorIds.includes(editor.id))
      const available = props.editors.includes(editor)
      return <article className={css.row} key={`${editor.scope}:${editor.id}`}><PageIcon editor={editor} /><div className={css.rowBody}><strong>{editor.label}</strong><p><BindingRequirement editor={editor} /></p><small>{extension ? `${extension.packageName ?? '包身份尚未核实'} · ${extension.packageVersion ?? '版本尚未检查'}` : '内置 · DSH 原生能力'}</small><p>{extension ? extension.availability === 'ready' ? '已就绪' : workbenchExtensionUnavailableCopyV1(extension).title : available ? '已就绪' : '尚未检查'}</p>
      <details><summary>用途与声明详情</summary><p>{editor.declaration?.label ?? editor.label}</p><p>身份：{editor.id}</p><p>图标：{editor.iconSvg ? '内页自带 SVG' : resolveWorkbenchEditorPresentation(editor).icon === 'extension' ? '兼容标识；建议扩展作者补充专属图标' : '语义 SVG'}</p><p>状态分享：{editor.portability?.exportState ? '通过已声明处理器迁移' : '仅分享内页引用'}</p>{extension ? <p>{extension.detail}</p> : null}</details></div>
      {!browser && !editor.resourceOnly && available ? <label className={css.toggle}><input type="checkbox" aria-label={`显示 ${editor.label} 添加入口`} disabled={actions.states[`entry:${editor.id}`]?.busy || !props.workbenchDirectory?.setGlobalEditorVisible} checked={!props.value?.globalHiddenEditorIds?.includes(editor.id)} onChange={event => { const visible = event.target.checked; void actions.run(`entry:${editor.id}`, () => props.workbenchDirectory!.setGlobalEditorVisible!(editor.id, visible)) }} />显示添加入口{actions.feedback(`entry:${editor.id}`)}</label> : null}
      </article>
    })}</div>{!filtered.length ? <div className={css.empty}>没有符合条件的内页。</div> : null}
    {!browser ? access.extensions.map(extension => {
      const affected = Object.values(props.value?.workbenches ?? {}).filter(record => areasOf(record.document.root).some(area => area.moduleHistory.some(page => extension.editorIds.includes(page.editorId))))
      const count = affected.reduce((sum, record) => sum + areasOf(record.document.root).reduce((sum, area) => sum + area.moduleHistory.filter(page => extension.editorIds.includes(page.editorId)).length, 0), 0)
      const canAllow = ['not-allowed', 'confirmation-required', 'ready'].includes(extension.availability) && extension.packageName && extension.apiVersion && extension.contractFingerprint
      const commit = (allowed: boolean) => void actions.run(extension.key, () => props.workbenchDirectory!.setExtensionAllowed!({ packageName: extension.packageName!, moduleId: extension.moduleId, apiVersion: extension.apiVersion ?? 1, editorIds: extension.editorIds, ...(extension.contractFingerprint ? { contractFingerprint: extension.contractFingerprint } : {}) }, allowed))
      return <details key={extension.key} className={`${css.group} ${css.extensionGroup}`}><summary>{extension.packageName ?? extension.moduleId} · {extension.packageVersion ?? '版本尚未检查'}</summary><p>{extension.detail}</p><p>提供 {extension.editorIds.length} 个内页 · {affected.length} 个工作台内的 {count} 个内页引用</p><p>兼容与声明权限以 DSH 已安装包及当前声明为准。安装、停用、更新和卸载请使用 DSH 插件管理。</p>
        {confirmRevoke === extension.key ? <div className={css.notice}><p>撤销将影响 {affected.length} 个工作台中的 {count} 个内页。布局引用保留，DSH 任务继续。</p><button className={css.primaryButton} onClick={() => { commit(false); setConfirmRevoke(undefined) }}>确认撤销许可</button><button className={css.secondaryButton} onClick={() => setConfirmRevoke(undefined)}>取消</button></div> : <button className={extension.allowed ? css.secondaryButton : css.primaryButton} disabled={actions.states[extension.key]?.busy || (!extension.allowed && !canAllow) || !props.workbenchDirectory?.setExtensionAllowed} onClick={() => extension.allowed ? setConfirmRevoke(extension.key) : commit(true)}>{extension.allowed ? '撤销 Workbench 使用许可' : extension.availability === 'confirmation-required' ? '重新确认声明并允许' : '允许在 Workbench 使用'}</button>}{actions.feedback(extension.key)}
        <details><summary>兼容与诊断</summary><pre>{JSON.stringify(extension.providerDiagnostic ?? { availability: extension.availability, moduleId: extension.moduleId, editorIds: extension.editorIds }, null, 2)}</pre></details>
      </details>
    }) : null}
    {!browser ? <p className={css.notice}>隐藏添加入口只影响手动添加；已有内页与自动联动保持可用。开发扩展请参考 Core 随包提供的扩展规范及原生 DSH 创造模式参考资料。</p> : null}
  </section>
}

declare const __WORKBENCH_BUILD_ID__: string
const RESOURCE_ROWS = [
  ['file', '文件结果', 'Document Preview'], ['changes-review', '变更审查', 'Changes Review'], ['plan', '计划', 'Plan'], ['subagent-chat', '子 Agent 对话', 'Subagent'],
  ['browser', '网页链接', 'Browser'], ['schedule-task', '计划任务', 'Schedule'], ['trajectory-inspect', '轨迹检查', 'Agent 轨迹'],
] as const
const PLACEMENTS: readonly [WorkbenchConversationResourcePlacementV1, string][] = [['activate-or-add', '在当前区域打开或激活'], ['new-tab', '始终新增内页标签'], ['replace-current', '替换当前内页标签'], ['official-sidebar', '使用 DSH 原生侧栏'], ['disabled', '忽略此次点击']]
export function InteractionSettingsPage(props: SettingsPageProps) {
  const policy = normalizeWorkbenchConversationInteractionPolicy(props.value?.interactionPolicy)
  const actions = useSettingsAction()
  const [reset, setReset] = useState(false)
  const declared = props.editors.flatMap(editor => (editor.declaration?.conversationResources ?? []).map(resource => ({ ...resource, editorLabel: editor.label })))
  const rows: { id: string; label: string; target: string; detail?: string }[] = RESOURCE_ROWS.map(([id, label, target]) => ({ id, label, target }))
  for (const resource of declared) {
    const existing = rows.find(row => row.id === resource.resourceType)
    if (existing) { if (!existing.target.includes(resource.editorLabel)) existing.target += `、${resource.editorLabel}` }
    else rows.push({ id: resource.resourceType, label: resource.displayName ?? resource.editorLabel, target: resource.editorLabel, ...(resource.description ? { detail: resource.description } : {}) })
  }
  const commit = (key: string, value: unknown) => actions.run(key, async () => { if (!props.patchInteractionPolicy) throw new Error('此宿主暂不支持按字段保存，请更新 Core。'); return props.patchInteractionPolicy(key, value) })
  const defaultFor = (id: string) => DEFAULT_WORKBENCH_CONVERSATION_INTERACTION_POLICY.conversationResources[id] ?? { enabled: declared.find(row => row.resourceType === id)?.defaultPlacement !== 'disabled', placement: declared.find(row => row.resourceType === id)?.defaultPlacement ?? 'activate-or-add' }
  return <section className={css.page}><header className={css.pageHeader}><div><h3>交互偏好</h3><p>此页偏好适用于当前 DSH 实例中的所有工作台。</p></div><button className={css.secondaryButton} disabled={actions.states.reset?.busy || !props.patchInteractionPolicy} onClick={() => setReset(true)}>本页恢复默认</button></header>
    {reset ? <div className={css.notice}><p>确认恢复本页全部资源规则？工作台布局与扩展许可保留。</p><div className={css.noticeActions}><button className={css.primaryButton} onClick={() => void actions.run('reset', async () => { for (const row of rows) if (!await commit(row.id, defaultFor(row.id))) throw new Error('部分规则未能恢复，请重试。'); if (!await commit('unknownResource', 'module-default')) throw new Error('未知资源规则未保存。'); setReset(false) })}>确认恢复默认</button><button className={css.secondaryButton} onClick={() => setReset(false)}>取消</button></div></div> : null}{actions.feedback('reset')}
    <div className={`${css.list} ${css.resourceList}`}>{rows.map(row => {
      const current = policy.conversationResources[row.id] ?? defaultFor(row.id)
      const value = !current.enabled || current.placement === 'disabled' ? 'disabled' : current.placement
      return <article key={row.id} className={css.resourceRow}><div><strong>{row.label}</strong><p>目标内页：{row.target}</p>{row.detail ? <p>{row.detail}</p> : null}<small>支持统一点击路由{row.id === 'trajectory-inspect' ? ' · 路由后才决定是否调用原生检查' : ''}</small></div>
        <label>点击后的行为<select aria-label={`${row.label}点击后的行为`} value={value} disabled={actions.states[row.id]?.busy || !props.patchInteractionPolicy} onChange={event => { const placement = event.target.value as WorkbenchConversationResourcePlacementV1; void commit(row.id, { enabled: placement !== 'disabled', placement }) }}>{PLACEMENTS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <button className={css.secondaryButton} disabled={actions.states[row.id]?.busy || !props.patchInteractionPolicy} onClick={() => void commit(row.id, defaultFor(row.id))}>恢复默认</button>{actions.feedback(row.id)}
      </article>
    })}</div>
    <div className={css.controlCard}><div><strong>未知资源策略</strong><p>当资源没有明确的内页声明时使用此规则。</p></div><label className={css.form}><select aria-label="未知资源策略" value={policy.unknownResource} disabled={actions.states.unknownResource?.busy || !props.patchInteractionPolicy} onChange={event => void commit('unknownResource', event.target.value)}><option value="module-default">遵循已允许模块声明</option><option value="official-sidebar">交给 DSH 原生侧栏</option><option value="disabled">忽略</option></select></label>{actions.feedback('unknownResource')}</div>
    <p className={css.notice}>终端内页可在区域中使用。DSH 尚无独立终端结果点击协议，因此这里不提供终端占位开关。同一资源的多个提供者沿用实际路由优先级。</p>
  </section>
}

export function downloadSettingsFile(name: string, content: BlobPart, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = name.replace(/[<>:"/\\|?*]/gu, '-').slice(0, 150); anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
