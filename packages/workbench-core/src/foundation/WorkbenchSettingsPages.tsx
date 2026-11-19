import { defaultWorkbenchTranslate, useWorkbenchLocale, workbenchIntlLocale, workbenchPageTitle, type WorkbenchTranslate } from './workbench-locale.ts'
import type { WorkbenchMessageKey } from './workbench-messages.ts'
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { IconAgentPresetOutlineMedium, IconSearchOutlineRegular, IconShareOutlineMedium, IconSettingsOutlineMedium } from '@deepseek-ai/dsh-client-ui-primitives'
import type { WorkbenchCoreSettingsSectionProps } from './WorkbenchCoreSettingsSection.tsx'
import { WorkbenchEditorIcon as EditorIcon } from './WorkbenchEditorIcon.tsx'
import { resolveWorkbenchEditorPresentation, type WorkbenchEditorCatalogRow } from './catalog.ts'
import { buildWorkbenchInventory } from './workbench-inventory.ts'
import { areasOf, type WorkbenchNodeV3 } from './document-v3.ts'
import type { WorkbenchRecordV2, WorkbenchSettingsV4, WorkbenchAiSelectionV1 } from './persistence.ts'
import type { ModelCatalog } from '@deepseek-ai/dsh-api-session-controller'
import { normalizeWorkbenchTags } from './persistence.ts'
import { DESKTOP_SETTINGS_CONTEXT, settingsTargetWritable, type SettingsViewMemory, type WorkbenchSettingsOpenOptionsV1 } from './settings-context.ts'
import { type WorkbenchExtensionAccessSnapshotV1 } from '../workbench-extension-access.ts'
import { DEFAULT_WORKBENCH_CONVERSATION_INTERACTION_POLICY, normalizeWorkbenchConversationInteractionPolicy } from '../workbench-interaction-policy.ts'
import type { WorkbenchConversationResourcePlacementV1 } from '../workbench-interaction-policy.ts'
import css from './WorkbenchSettings.module.css'
import { WorkbenchBackgroundAiSettings } from './WorkbenchBackgroundAiSettings.tsx'
import { WorkbenchEditorFolders, WorkbenchEditorFolderSelect } from './WorkbenchEditorFolders.tsx'
import { editorMenuFolder, isBuiltinEditor } from './editor-menu-preferences.ts'

export interface PendingSettingsForm { save(): Promise<boolean>; discard(): void }
export type SettingsPageProps = WorkbenchCoreSettingsSectionProps & {
  value: WorkbenchSettingsV4 | undefined
  settingsWritable?: boolean | undefined
  settingsRevision?: number | undefined
  editors: readonly WorkbenchEditorCatalogRow[]
  memory: SettingsViewMemory
  navigate(options: WorkbenchSettingsOpenOptionsV1): void
  onDirty(form: PendingSettingsForm | undefined): void
  onBackToOverview?(): void
}
export function useSettingsAction(messages: { busy: WorkbenchMessageKey; success: WorkbenchMessageKey } = { busy: 'project.saving', success: 'settings.saved' }) {
  const { t } = useWorkbenchLocale()
  const [states, setStates] = useState<Record<string, { busy: boolean; error: boolean; messageKey?: WorkbenchMessageKey; detail?: string }>>({})
  const pending = useRef(new Set<string>())
  const retries = useRef(new Map<string, () => Promise<unknown>>())
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const run = async (key: string, action: () => Promise<unknown>) => {
    if (pending.current.has(key)) return false
    pending.current.add(key)
    retries.current.set(key, action)
    setStates(current => ({ ...current, [key]: { busy: true, messageKey: messages.busy, error: false } }))
    try {
      const result = await action()
      if (result === false || (result && typeof result === 'object' && 'status' in result && result.status !== 'committed')) {
        const status = result && typeof result === 'object' && 'status' in result ? result.status : ''
        if (mounted.current) setStates(current => ({ ...current, [key]: { busy: false, error: true, messageKey: status === 'conflict' ? 'settings.saveConflict' : 'settings.actionIncomplete' } }))
        return false
      }
      if (mounted.current) setStates(current => ({ ...current, [key]: { busy: false, messageKey: messages.success, error: false } }))
      return true
    } catch (error) {
      if (mounted.current) setStates(current => ({ ...current, [key]: { busy: false, ...(error instanceof Error ? { detail: error.message } : { messageKey: 'settings.saveFailed' as const }), error: true } }))
      return false
    } finally { pending.current.delete(key) }
  }
  return { states, run, feedback: (key: string) => states[key] ? <span className={css.feedback} role={states[key].error ? 'alert' : 'status'}>{states[key].messageKey ? t(states[key].messageKey) : states[key].detail}{states[key].error ? <button onClick={() => { const retry = retries.current.get(key); if (retry) void run(key, retry) }}>{t('action.retry')}</button> : null}</span> : null }
}

export function PageIcon({ editor }: { editor: WorkbenchEditorCatalogRow }) {
  const { icon, iconSvg } = resolveWorkbenchEditorPresentation(editor)
  return <span className={css.pageIcon} data-editor-icon={icon}><EditorIcon name={icon} iconSvg={iconSvg} /></span>
}
export function BindingRequirement({ editor }: { editor: WorkbenchEditorCatalogRow | undefined }) {
  const { t } = useWorkbenchLocale()
  return <span>{editor?.resourceOnly ? t('settings.binding.resource') : editor?.declaration?.requiredBinding === 'session' ? t('settings.binding.session') : editor?.declaration?.requiredBinding === 'workspace' ? t('settings.binding.workspace') : editor?.declaration?.requiredBinding === 'none' ? t('settings.binding.none') : t('settings.binding.unknown')}</span>
}
export function LayoutDiagram({ node, editors, compact = false }: { node: WorkbenchNodeV3; editors: readonly WorkbenchEditorCatalogRow[]; compact?: boolean }): ReactNode {
  const { t } = useWorkbenchLocale()
  if (node.kind === 'split') return <div className={css.split} style={{ flexDirection: node.axis === 'horizontal' ? 'row' : 'column' }}>
    <div style={{ flex: `${node.ratio} 1 0` }}><LayoutDiagram node={node.first} editors={editors} compact={compact} /></div>
    <div style={{ flex: `${1 - node.ratio} 1 0` }}><LayoutDiagram node={node.second} editors={editors} compact={compact} /></div>
  </div>
  const page = node.moduleHistory.find(page => page.moduleInstanceId === node.activeModuleInstanceId) ?? node.moduleHistory[0]
  const editor = page && editors.find(row => row.id === page.editorId && row.scope === page.editorScope)
  return <div className={`${css.previewArea} ${compact ? css.previewAreaCompact : ''}`}>
    {page ? <span className={compact ? css.previewGlyph : undefined} aria-hidden={compact || undefined}><PageIcon editor={editor ?? { id: page.editorId, scope: page.editorScope, label: page.lastKnownTitle ?? page.editorId }} /></span> : null}
    {!compact ? <><span>{editor ? workbenchPageTitle(t, editor.id, editor.label) : page ? workbenchPageTitle(t, page.editorId, page.lastKnownTitle ?? page.editorId) : t('home.emptyArea')}</span><small>{t('layout.pageCount', { count: node.moduleHistory.length })}</small></> : null}
  </div>
}

export function WorkbenchManagementPage(props: SettingsPageProps) {
  const { t, language } = useWorkbenchLocale()
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
    <header className={css.pageHeader}><div><h3>{browser ? t('home.currentWorkbench') : t('settings.workbenchManagement')}</h3><p>{t('settings.closingViewsArchivingOrDeletingLayoutsDoes')}</p></div>
      {!browser || directory?.completeRequest ? <button className={css.primaryButton} onClick={() => props.navigate({ section: 'sharing', ...(browser ? { workbenchId: context.workbenchId } : {}), shareMode: 'import' })}>{t('settings.importWorkbench')}</button> : null}</header>
    {!selected ? <>
      <label className={css.search}><IconSearchOutlineRegular aria-hidden="true" /><input type="search" aria-label={t('home.searchWorkbenches')} placeholder={t('settings.searchNamesDescriptionsOrTags')} value={query} onChange={event => { setQuery(event.target.value); props.memory.searches.workbenches = event.target.value }} /></label>
      {!browser ? <div className={css.filters} aria-label={t('settings.workbenchStatus')}>{[['all', t('home.all')], ['open', t('home.open')], ['inactive', t('home.closed')], ['archived', t('home.archived')]].map(([id, label]) => <button key={id} aria-pressed={category === id} onClick={() => { setCategory(id!); props.memory.filters.workbenches = id! }}>{label}</button>)}</div> : null}
      <div className={css.cards}>{filtered.map(row => { const inventory = inventories.get(row.workbenchId); const writable = settingsTargetWritable(context, row.workbenchId, props.windowController)
        return <button key={row.workbenchId} className={css.card} onClick={() => select(row.workbenchId)}>
          <span className={css.cardTitle}>{row.pinnedAt ? t('settings.pinned') : ''}{row.name}</span><span className={`${css.preview} ${css.previewCompact}`}><LayoutDiagram node={row.document.root} editors={props.editors} compact /></span>
          <span>{row.description || t('settings.noDescription')}</span><small>{row.tags?.join(' · ')}</small>
          <small>{inventory ? t('settings.value1AreasValue2Pages', { value1: inventory.areas.length, value2: inventory.pageCount }) : t('settings.notChecked')} · {writable ? t('settings.local') : t('home.openInBrowser')}</small><small>{t('settings.modified')} {new Date(row.updatedAt).toLocaleString(workbenchIntlLocale(language))}</small>
        </button> })}</div>
      {filtered.length === 0 ? <div className={css.empty}>{t('settings.noMatchingWorkbenches')}</div> : null}
      {Object.values(props.value?.invalidWorkbenches ?? {}).length ? <details open={props.openOptions?.workbenchId !== undefined && props.value?.invalidWorkbenches[props.openOptions.workbenchId] !== undefined ? true : undefined}><summary>{t('settings.unreadableLegacyLayouts')}</summary>{Object.values(props.value!.invalidWorkbenches).map(row => <div key={row.workbenchId}><strong>{row.name}</strong><p>{t('settings.theLayoutHasNotBeenCheckedThe')}</p><button className={css.secondaryButton} onClick={() => downloadSettingsFile(`${row.name}-诊断.json`, JSON.stringify(row.rawRecord, null, 2), 'application/json')}>{t('settings.exportRawDiagnosticConfiguration')}</button></div>)}</details> : null}
    </> : <>
      {!browser ? <button className={css.backButton} onClick={() => props.onBackToOverview ? props.onBackToOverview() : select()}>{t('settings.backToWorkbenches')}</button> : null}
      <WorkbenchDetails key={selected.workbenchId} {...props} record={selected} onDirty={reportDirty} onRemoved={() => props.onBackToOverview ? props.onBackToOverview() : select()} action={actions} />
    </>}
    {pendingSelection ? <UnsavedFormPrompt form={pendingForm.current!} onContinue={() => setPendingSelection(undefined)} onLeave={() => { const next = pendingSelection; setPendingSelection(undefined); next() }} /> : null}
    {directory ? null : <p role="alert">{t('settings.reconnectToDshToManageWorkbenches')}</p>}
  </section>
}

export function UnsavedFormPrompt({ form, onContinue, onLeave }: { form: PendingSettingsForm; onContinue(): void; onLeave(): void }) {
  const { t } = useWorkbenchLocale()
  const [busy, setBusy] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => { const focus = document.activeElement; root.current?.querySelector<HTMLButtonElement>('button')?.focus(); return () => { if (focus instanceof HTMLElement && focus.isConnected) focus.focus() } }, [])
  return createPortal(<div className={`${css.settingsRoot} ${css.promptLayer}`}><div className={css.promptBackdrop}><div className={css.prompt} ref={root} role="alertdialog" aria-modal="true" aria-label={t('settings.unsavedChanges')} onKeyDown={event => {
    if (event.key === 'Escape') { event.stopPropagation(); onContinue() }
    if (event.key === 'Tab') { const buttons = [...root.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')]; const index = buttons.indexOf(document.activeElement as HTMLButtonElement); event.preventDefault(); buttons[(index + (event.shiftKey ? buttons.length - 1 : 1)) % buttons.length]?.focus() }
  }}><h3>{t('settings.unsavedChanges')}</h3><p>{t('settings.saveYourChangesBeforeLeavingOrDiscard')}</p><div className={css.actions}>
    <button className={css.primaryButton} disabled={busy} onClick={() => { setBusy(true); void form.save().then(ok => { setBusy(false); if (ok) onLeave() }) }}>{t('settings.saveAndLeave')}</button>
    <button className={css.secondaryButton} disabled={busy} onClick={() => { form.discard(); onLeave() }}>{t('settings.discardChanges')}</button><button className={css.secondaryButton} disabled={busy} onClick={onContinue}>{t('settings.keepEditing')}</button>
  </div></div></div></div>, document.body)
}

function WorkbenchDetails(props: SettingsPageProps & { record: WorkbenchRecordV2; onRemoved(): void; action: ReturnType<typeof useSettingsAction> }) {
  const { t } = useWorkbenchLocale()
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
  const [modelCatalog, setModelCatalog] = useState<ModelCatalog>()
  const [aiSelection, setAiSelection] = useState<WorkbenchAiSelectionV1 | undefined>(record.workbenchAi)
  const [aiDirty, setAiDirty] = useState(false)
  useEffect(() => {
    if (props.loadModelCatalog === undefined) return
    void props.loadModelCatalog().then(setModelCatalog).catch(() => {})
  }, [props.loadModelCatalog])
  useEffect(() => { setAiSelection(record.workbenchAi); setAiDirty(false) }, [record.workbenchAi])
  const save = useCallback(async () => {
    if (!directory) return false
    return action.run('metadata', () => directory.updateMetadata(record.workbenchId, { name, description, tags: tags.split(/[,，]/u).map(tag => tag.trim()).filter(Boolean) }))
  }, [name, description, tags, record.workbenchId, directory, action.run])
  const discard = useCallback(() => { setName(record.name); setDescription(record.description); setTags(record.tags?.join('，') ?? '') }, [record.name, record.description, record.tags])
  const saveRef = useRef(save); saveRef.current = save
  const discardRef = useRef(discard); discardRef.current = discard
  useEffect(() => { props.onDirty(dirty ? { save: () => saveRef.current(), discard: () => discardRef.current() } : undefined); return () => props.onDirty(undefined) }, [dirty, props.onDirty])
  const mutate = (key: string, fn: () => Promise<unknown>) => void action.run(key, fn)
  const saveAi = () => mutate('ai-model', async () => {
    if (!directory?.updateWorkbenchAi) throw new Error(t('settings.thisHostCannotSaveWorkbenchAiSettings'))
    const result = await directory.updateWorkbenchAi(record.workbenchId, aiSelection)
    if (result.status === 'committed') setAiDirty(false)
    return result
  })
  const openIds = props.value?.openWorkbenchIds ?? []
  const statusLabel = !writable ? t('home.openInBrowser') : record.archivedAt !== undefined ? t('home.archived') : openIds.includes(record.workbenchId) ? t('home.open') : t('home.closed')
  return <div className={css.detail}>
    <header className={css.detailHeader}>
      <div className={css.detailHeaderMain}>
        <div className={css.detailBackRow}><span className={css.detailEyebrow}>{t('settings.workbenchDetails')}</span><span className={css.detailId}>{record.workbenchId}</span></div>
        <h3 className={css.workbenchName}>{record.name}</h3>
        <p>{record.description || t('settings.noDescription')}{props.value?.activeWorkbenchId === record.workbenchId && openIds.includes(record.workbenchId) ? t('settings.currentWorkbench') : ''}</p>
        <div className={css.detailBadges}><span className={css.statusBadge} data-status={writable ? 'ready' : 'browser'}>{statusLabel}</span><span>{t('layout.areaCount', { count: inventory.areas.length })}</span><span>{t('layout.pageCount', { count: inventory.pageCount })}</span>{inventory.missingPageCount ? <span className={css.warningBadge}>{t('layout.unavailableCount', { count: inventory.missingPageCount })}</span> : null}</div>
      </div>
      <div className={css.detailHeaderActions}>
        {!writable ? <button className={css.primaryButton} disabled={action.states.reclaim?.busy} onClick={() => mutate('reclaim', async () => { const result = await props.windowController?.reclaim?.(record.workbenchId); if (result?.status !== 'reclaimed') throw new Error(t('settings.theTransferWasNotConfirmedCheckThe')) })}>{t('shell.takeBackControlInDsh')}</button> : null}
        {global && writable && !record.archivedAt ? <button className={css.primaryButton} disabled={!directory} onClick={() => mutate('open', () => props.onOpenWorkbench ? props.onOpenWorkbench(record.workbenchId) : directory!.openAndSelect(record.workbenchId))}>{t('home.openWorkbench')}</button> : null}
        <button className={css.secondaryButton} onClick={() => props.navigate({ section: 'sharing', workbenchId: record.workbenchId, shareMode: 'export' })} disabled={!writable}>{t('settings.share')}</button>
        {action.feedback('reclaim')}{action.feedback('open')}
      </div>
    </header>
    <section className={css.metadataSection}><div className={css.sectionHeader}><div><h4>{t('settings.detailsAndStatus')}</h4><p>{t('settings.nameDescriptionAndTagsIdentifyThisWorkbench')}</p></div><span className={css.sectionHint}>{dirty ? t('settings.unsavedChanges2') : t('settings.inSync')}</span></div><fieldset disabled={!writable || action.states.metadata?.busy || !directory} className={`${css.form} ${css.metadataForm}`}>
      <label>{t('home.name')}<input maxLength={160} value={name} onChange={event => setName(event.target.value)} /></label>
      <label className={css.metadataDescription}>{t('settings.description')}<textarea rows={3} maxLength={4000} value={description} onChange={event => setDescription(event.target.value)} /></label>
      <label>{t('settings.tags')}<input value={tags} onChange={event => setTags(event.target.value)} placeholder={t('settings.separateWithCommas')} /></label>
      <div className={css.stickyActions}><button disabled={!dirty} onClick={() => void save()}>{t('settings.saveDetails')}</button><button disabled={!dirty} onClick={discard}>{t('action.cancel')}</button>{action.feedback('metadata')}</div>
    </fieldset>{record.offlineOrigin || record.packageOrigin ? <p>{t('settings.importedFrom')}{record.offlineOrigin?.archiveSha256 ?? record.packageOrigin?.archiveSha256}</p> : null}
    {global ? <div className={css.actions}>
      <button className={css.secondaryButton} disabled={!writable || !directory} onClick={() => mutate('pin', () => directory!.setPinned(record.workbenchId, !record.pinnedAt))}>{record.pinnedAt ? t('settings.unpin') : t('settings.pin')}</button>
      {openIds.includes(record.workbenchId) ? <button className={css.secondaryButton} disabled={!writable || !directory} onClick={() => mutate('unload', () => directory!.unload(record.workbenchId))}>{t('settings.closeView')}</button> : null}
      <button className={css.secondaryButton} disabled={!writable || !directory} onClick={() => mutate('archive', () => record.archivedAt ? directory!.restore(record.workbenchId) : directory!.archive(record.workbenchId))}>{record.archivedAt ? t('home.restoreWorkbench') : t('home.archiveWorkbench')}</button>
      {['pin', 'unload', 'archive'].map(key => <span key={key}>{action.feedback(key)}</span>)}
    </div> : null}</section>
    <section className={css.metadataSection}><div className={css.sectionHeader}><div><h4>{t('settings.bayAgentModel')}</h4><p>{t('settings.usedByThisWorkbenchSPersistentMain')}</p></div></div>
      <div className={css.form}>
        <label>{t('settings.modelProvider')}<select value={aiSelection?.provider ?? ''} disabled={!writable || !props.loadModelCatalog} onChange={event => { const provider = event.target.value; const group = modelCatalog?.groups.find(row => row.id === provider); const model = group?.models[0]; setAiSelection(provider === '' || model === undefined ? undefined : { provider, model: model.id, ...(model.reasoning?.defaultEffort === undefined ? {} : { reasoningEffort: model.reasoning.defaultEffort }) }); setAiDirty(true) }}><option value="">{t('settings.useDshDefault')}</option>{modelCatalog?.groups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label>
        <label>{t('settings.model')}<select value={aiSelection?.model ?? ''} disabled={!aiSelection || !modelCatalog} onChange={event => { const model = modelCatalog?.groups.find(group => group.id === aiSelection?.provider)?.models.find(row => row.id === event.target.value); if (model && aiSelection) { setAiSelection({ ...aiSelection, model: model.id, ...(model.reasoning?.defaultEffort === undefined ? {} : { reasoningEffort: model.reasoning.defaultEffort }) }); setAiDirty(true) } }}><option value="">{t('settings.chooseAModel')}</option>{modelCatalog?.groups.find(group => group.id === aiSelection?.provider)?.models.map(model => <option key={model.id} value={model.id}>{model.name}</option>)}</select></label>
        <label>{t('settings.reasoningEffort')}<select value={aiSelection?.reasoningEffort ?? ''} disabled={!aiSelection || !modelCatalog} onChange={event => { if (aiSelection) { const value = event.target.value; setAiSelection(value === '' ? { provider: aiSelection.provider, model: aiSelection.model } : { ...aiSelection, reasoningEffort: value }); setAiDirty(true) } }}><option value="">{t('settings.modelDefault')}</option>{modelCatalog?.groups.find(group => group.id === aiSelection?.provider)?.models.find(model => model.id === aiSelection?.model)?.reasoning?.efforts.map(effort => <option key={effort.id} value={effort.id}>{effort.name}</option>)}</select></label>
        <div className={css.stickyActions}><button disabled={!aiDirty || action.states['ai-model']?.busy || !directory?.updateWorkbenchAi} onClick={saveAi}>{t('settings.saveAiSettings')}</button>{action.feedback('ai-model')}</div>
        {modelCatalog?.failures.length ? <p className={css.notice}>{t('settings.someProvidersCouldNotBeLoaded')}{modelCatalog.failures.map(row => `${row.name}: ${row.message}`).join('；')}</p> : null}
      </div>
    </section>
     <section className={css.previewSection}><div className={css.sectionHeader}><div><h4>{t('settings.layoutPreview')}</h4><p>{t('settings.showsTheSplitRatioAndActivePage')}</p></div><span className={css.sectionCount}>{t('layout.areaCount', { count: inventory.areas.length })}</span></div><div className={css.largePreview}><LayoutDiagram node={record.document.root} editors={props.editors} /></div><div className={css.previewSummary}><span>{t('layout.retainedPageCount', { count: inventory.pageCount })}</span><span>{inventory.missingPageCount ? t('settings.unavailablePagesValue1', { value1: inventory.missingPageCount }) : t('settings.allPagesReady')}</span></div></section>
    <section className={css.pagesSection}><div className={css.sectionHeader}><div><h4>{t('settings.areasAndPages')}</h4><p>{t('settings.retainedTabsAndActivePagesAreSaved')}</p></div><span className={css.sectionCount}>{t('layout.pageCount', { count: inventory.pageCount })}</span></div>{inventory.areas.map(area => <div key={area.areaId} className={css.group}><div className={css.groupHeader}><h5>{t('home.areas')} {area.ordinal}</h5><span>{t('layout.pageCount', { count: area.pages.length })}</span></div>{area.pages.map((page, index) => {
      const editor = props.editors.find(editor => editor.id === page.editorId && editor.scope === page.editorScope)
      return <div className={css.row} key={page.moduleInstanceId}><PageIcon editor={editor ?? { id: page.editorId, scope: page.editorScope, label: page.name }} /><div><strong>{index + 1}. {page.name}{page.active ? t('settings.current') : ''}</strong><p><BindingRequirement editor={editor} /> · {page.available ? t('tab.ready') : t('settings.thisPageCouldNotBeVerifiedInstalled')}</p><small>{page.editorId}</small></div></div>
    })}</div>)}</section>
    <section className={css.extensionsSection}><div className={css.sectionHeader}><div><h4>{t('settings.requiredExtensions')}</h4><p>{t('settings.extensionsThisWorkbenchUsesAndTheirCompatibility')}</p></div><span className={css.sectionCount}>{t('layout.packageCount', { count: inventory.plugins.length })}</span></div>{inventory.plugins.length ? <div className={css.pluginList}>{inventory.plugins.map(plugin => <div className={css.pluginRow} key={plugin.key}><span className={css.pluginStatus} data-status={plugin.status}>{plugin.status === 'available' ? '✓' : '!'}</span><div><strong>{plugin.pluginId ?? t('settings.providerPackageNotVerified')}</strong><p>{t('layout.pageCount', { count: plugin.pageCount })} · {plugin.status === 'available' ? t('settings.ready') : plugin.status === 'missing' ? t('settings.needsAttention') : t('settings.notChecked')}</p></div></div>)}</div> : <div className={css.emptyInline}>{t('settings.thisWorkbenchOnlyUsesNativeDshPages')}</div>}</section>
    <section className={css.shareSection}><div className={css.sectionHeader}><div><h4>{t('home.sharingAndTransfer')}</h4><p>{t('settings.aFullWorkbenchPackageIncludesRootFiles')}</p></div></div><div className={css.shareActions}><button className={css.primaryButton} disabled={!writable} onClick={() => props.navigate({ section: 'sharing', workbenchId: record.workbenchId, shareMode: 'export' })}><IconShareOutlineMedium size={16} /> {t('settings.openSharingWizard')}</button>{directory?.completeRequest ? <button className={css.secondaryButton} disabled={!writable} onClick={() => props.navigate({ section: 'sharing', workbenchId: record.workbenchId, shareMode: 'export' })}>{t('settings.fullPackageAndTransferProgress')}</button> : null}<details><summary>{t('settings.compatibilityAndDiagnostics')}</summary><p>{t('settings.rawConfigurationContainsLocalBindingsUseIt')}</p><button className={css.secondaryButton} onClick={() => downloadSettingsFile(`${record.name}-诊断.json`, JSON.stringify(record, null, 2), 'application/json')}>{t('settings.exportRawDiagnosticConfiguration')}</button></details></div></section>
    {global ? <section className={css.danger}><h4>{t('settings.dangerZone')}</h4><p>{t('settings.permanentlyDeletesTheLayoutButKeepsDsh')}</p>
      {confirmDelete ? <div className={css.actions}><button className={css.dangerButton} disabled={!writable || action.states.delete?.busy} onClick={() => mutate('delete', async () => { const result = await directory?.remove(record.workbenchId); if (result?.status === 'committed') props.onRemoved(); return result })}>{t('settings.deleteNamed', { name: record.name })}</button><button className={css.secondaryButton} onClick={() => setConfirmDelete(false)}>{t('action.cancel')}</button></div>
        : <button className={css.dangerButton} disabled={!writable || !directory} onClick={() => setConfirmDelete(true)}>{t('settings.permanentlyDeleteLayout')}</button>}{action.feedback('delete')}</section> : null}
  </div>
}

const EMPTY_EXTENSIONS: WorkbenchExtensionAccessSnapshotV1 = { status: 'unavailable', extensions: [] }
type ExtensionRow = WorkbenchExtensionAccessSnapshotV1['extensions'][number]

function extensionAvailabilityLabel(extension: ExtensionRow, t: WorkbenchTranslate = defaultWorkbenchTranslate) {
  if (extension.availability === 'ready') return extension.allowed ? t('settings.extensionStatus.enabled') : t('settings.extensionStatus.ready')
  if (extension.availability === 'not-allowed') return t('settings.extensionStatus.disabled')
  if (extension.availability === 'confirmation-required') return t('settings.extensionStatus.confirm')
  if (extension.availability === 'dsh-disabled') return t('settings.extensionStatus.dshDisabled')
  if (extension.availability === 'dsh-missing') return t('settings.extensionStatus.notInstalled')
  if (extension.availability === 'editor-missing') return t('settings.extensionStatus.pageMissing')
  if (extension.availability === 'inventory-unavailable') return t('settings.extensionStatus.unknown')
  if (extension.availability === 'identity-unverified') return t('settings.extensionStatus.unverified')
  if (extension.availability === 'incompatible') return t('settings.extensionStatus.incompatible')
  return t('settings.extensionStatus.invalid')
}
/** Build the one-shot repair brief that Creator will receive as an unsent draft. */
export function creatorRepairPrompt(extension: ExtensionRow): string {
  return [
    '请在当前项目中修复并升级这个 DSH Bay Workbench 容器内页扩展，使它适配当前 18.0 版本。',
    '',
    `扩展模块：${extension.moduleId}`,
    `包名：${extension.packageName ?? '未知'}`,
    `当前版本：${extension.packageVersion ?? '未知'}`,
    `提供的内页：${extension.editorIds.join('、') || '未知'}`,
    `当前状态：${extensionAvailabilityLabel(extension)}`,
    `诊断信息：${extension.detail}`,
    '',
    '请先读取当前项目和 workbench-extension-development 技能，检查当前 DSH/Core 版本、Slot 注册、Session 绑定、18.0 工作台目录与多会话模型，以及 offline-embedded 离线制品要求。',
    '然后分析旧扩展与当前版本的差异，制定并实施兼容升级方案。',
    '保留扩展原有身份和功能，避免修改无关模块。',
    '完成类型检查、扩展合同测试和离线制品检查后，再说明仍需人工验证的部分。',
  ].join('\n')
}

function extensionStatusTone(extension: ExtensionRow) {
  return extension.availability === 'ready' && !extension.allowed ? 'not-allowed' : extension.availability
}
function SettingsSwitch({ label, checked, disabled, onChange }: {
  label: string
  checked: boolean
  disabled?: boolean
  onChange(checked: boolean): void
}) {
  return <button type="button" role="switch" className={css.capsuleSwitch} aria-label={label}
    aria-checked={checked} disabled={disabled} onClick={() => onChange(!checked)}><span aria-hidden="true" /></button>
}

function InnerPageSettingsCard({ editor, props }: { editor: WorkbenchEditorCatalogRow; props: SettingsPageProps }) {
  const { t } = useWorkbenchLocale()
  const browser = props.settingsContext?.mode === 'browser-workbench'
  const actions = useSettingsAction()
  const builtin = isBuiltinEditor(editor.id)
  const label = workbenchPageTitle(t, editor.id, editor.label)
  return <article className={css.catalogCard} data-page-kind={builtin ? 'builtin' : 'extension'}>
    <div className={css.catalogCardHeader}><PageIcon editor={editor} /><div className={css.catalogIdentity}>
      <strong>{label}</strong><p><BindingRequirement editor={editor} /></p>
    </div><span className={css.catalogStatus}>{t('settings.ready')}</span></div>
    <p className={css.catalogMeta}>{builtin ? t('settings.builtInNativeDsh') : t('settings.registeredPage')}</p>
    {!browser && !editor.resourceOnly ? <div className={css.cardSwitchRow}><span>{t('settings.showInAddPage')}</span>
      <SettingsSwitch label={t('settings.show') + label + t('settings.inAddPage')} checked={!props.value?.globalHiddenEditorIds?.includes(editor.id)}
        disabled={actions.states.entry?.busy || !props.workbenchDirectory?.setGlobalEditorVisible}
        onChange={visible => void actions.run('entry', () => props.workbenchDirectory!.setGlobalEditorVisible!(editor.id, visible))} />
    </div> : null}
    {actions.feedback('entry')}
    {!browser && !builtin && !editor.resourceOnly ? <WorkbenchEditorFolderSelect editorId={editor.id} label={editor.label} preferences={props.value?.editorMenu} directory={props.workbenchDirectory} writable={props.settingsWritable === true} /> : null}
    <details className={css.cardDetails}><summary>{t('settings.purposeAndDeclarationDetails')}</summary><p>{workbenchPageTitle(t, editor.id, editor.declaration?.label ?? editor.label)}</p>
      <p>{t('settings.pageId')}{editor.id}</p><p>{t('settings.stateSharing')}{editor.portability?.exportState ? t('settings.portableThroughTheDeclaredHandler') : t('settings.sharePageReferenceOnly')}</p>
    </details>
  </article>
}

function ExtensionSettingsCard({ extension, props, inventoryReady }: { extension: ExtensionRow; props: SettingsPageProps; inventoryReady: boolean }) {
  const { t } = useWorkbenchLocale()
  const browser = props.settingsContext?.mode === 'browser-workbench'
  const actions = useSettingsAction()
  const [confirmRevoke, setConfirmRevoke] = useState(false)
  const repairActions = useSettingsAction({ busy: 'settings.preparingTheRepairFolderAndCreatorConversation', success: 'settings.repairConversationOpened' })
  const editors = props.editors.filter(editor => extension.editorIds.includes(editor.id))
  const leadEditor = editors[0] ?? { id: extension.editorIds[0] ?? extension.moduleId, scope: 'session' as const, label: extension.moduleId }
  const consent = props.value?.extensionConsents?.[extension.key]
  // A persisted permission can still be revoked while the plugin is offline.
  const enabled = extension.availability !== 'confirmation-required' && (consent?.allowed ?? extension.allowed)
  const canAllow = inventoryReady && ['not-allowed', 'confirmation-required', 'ready'].includes(extension.availability)
    && extension.packageName !== undefined && extension.apiVersion === 1 && !!extension.contractFingerprint
  const affected = Object.values(props.value?.workbenches ?? {}).filter(record =>
    areasOf(record.document.root).some(area => area.moduleHistory.some(page => extension.editorIds.includes(page.editorId))))
  const count = affected.reduce((sum, record) => sum + areasOf(record.document.root).reduce((total, area) =>
    total + area.moduleHistory.filter(page => extension.editorIds.includes(page.editorId)).length, 0), 0)
  const commit = async (allowed: boolean) => {
    const saved = await actions.run('permission', () => props.workbenchDirectory!.setExtensionAllowed!({
      packageName: extension.packageName!, moduleId: extension.moduleId, apiVersion: extension.apiVersion ?? 1,
      editorIds: extension.editorIds, ...(extension.contractFingerprint ? { contractFingerprint: extension.contractFingerprint } : {}),
    }, allowed))
    if (saved) setConfirmRevoke(false)
  }
  return <article className={css.catalogCard} data-page-kind="extension" data-extension-key={extension.key}>
    <div className={css.catalogCardHeader}><PageIcon editor={leadEditor} /><div className={css.catalogIdentity}>
      <strong>{editors.length === 1 ? leadEditor.label : extension.moduleId}</strong>
      <p>{t('settings.extensionPageCount', { count: extension.editorIds.length })}</p>
    </div><span className={css.catalogStatus} data-status={extensionStatusTone(extension)}>{extensionAvailabilityLabel(extension, t)}</span></div>
    <p className={css.catalogMeta}>{extension.packageName ?? t('settings.packageIdentityUnverified')}{extension.packageVersion ? ' · ' + extension.packageVersion : ''}</p>
    {!browser ? <div className={css.cardSwitchRow}><span>{extension.availability === 'confirmation-required' ? t('settings.reviewAndEnableAgain') : t('settings.enableInWorkbench')}</span>
      <SettingsSwitch label={t('settings.enableInWorkbench2') + (extension.packageName ?? extension.moduleId)} checked={enabled}
        disabled={actions.states.permission?.busy || !props.workbenchDirectory?.setExtensionAllowed || !extension.packageName || (!enabled && !canAllow)}
        onChange={allowed => { if (!allowed && count > 0) setConfirmRevoke(true); else void commit(allowed) }} />
    </div> : null}
    {extension.availability !== 'ready' ? <p className={css.cardHint}>{extension.detail}</p> : null}
    {!browser && extension.availability === 'incompatible' && props.openCreator ? <>
      <div className={css.noticeActions}>
        <button type="button" className={css.secondaryButton} disabled={repairActions.states.creator?.busy}
          onClick={() => void repairActions.run('creator', async () => {
            const workbenchId = props.value?.activeWorkbenchId
            if (!workbenchId) throw new Error(t('settings.openAWorkbenchBeforeStartingExtensionRepair'))
            await props.openCreator!(creatorRepairPrompt(extension), t('settings.updateForCompatibility') + extension.moduleId, {
              workbenchId, moduleId: extension.moduleId,
              ...(extension.packageName === undefined ? {} : { packageName: extension.packageName }),
            })
            props.close()
          })}>
          <IconAgentPresetOutlineMedium size={16} />
          {repairActions.states.creator?.busy ? t('settings.openingCreatorMode') : t('settings.repairInCreatorMode')}
        </button>
      </div>
      <p className={css.cardHint}>{t('settings.prepareASeparateRepairFolderAndOpen')}</p>
      {repairActions.feedback('creator')}
    </> : null}
    {confirmRevoke ? <div className={css.notice} role="group" aria-label={t('settings.confirmDisablingExtension')}>
      <p>{t('settings.disableExtensionImpact', { workbenches: affected.length, pages: count })}</p>
      <div className={css.noticeActions}><button className={css.dangerButton} disabled={actions.states.permission?.busy} onClick={() => void commit(false)}>{t('settings.disableExtension')}</button>
        <button className={css.secondaryButton} disabled={actions.states.permission?.busy} onClick={() => setConfirmRevoke(false)}>{t('action.cancel')}</button></div>
    </div> : null}
    {actions.feedback('permission')}
    {!browser ? extension.editorIds.filter(id => !editors.find(editor => editor.id === id)?.resourceOnly).map(id => <div key={id} className={css.extensionFolderRow}>
      {extension.editorIds.length > 1 ? <span>{editors.find(editor => editor.id === id)?.label ?? id}</span> : null}
      <WorkbenchEditorFolderSelect editorId={id} label={editors.find(editor => editor.id === id)?.label ?? id} preferences={props.value?.editorMenu} directory={props.workbenchDirectory} writable={props.settingsWritable === true} />
    </div>) : null}
    <details className={css.cardDetails}><summary>{t('settings.pagesAndPermissions')}</summary>
      <p>{t('settings.allowTheExtensionToProvideWorkbenchPages')}</p>
      <p>{t('settings.extensionUsage', { workbenches: affected.length, count })}</p>
      {extension.editorIds.map(id => {
        const editor = editors.find(row => row.id === id)
        return <div className={css.extensionPageRow} key={id}><span>{editor?.label ?? id}</span>
          {!browser && extension.allowed && editor && !editor.resourceOnly ? <SettingsSwitch label={t('settings.show') + editor.label + t('settings.inAddPage')}
            checked={!props.value?.globalHiddenEditorIds?.includes(id)} disabled={actions.states[id]?.busy || !props.workbenchDirectory?.setGlobalEditorVisible}
            onChange={visible => void actions.run(id, () => props.workbenchDirectory!.setGlobalEditorVisible!(id, visible))} /> : null}
          {actions.feedback(id)}
        </div>
      })}
      <details><summary>{t('settings.compatibilityAndDiagnostics')}</summary><pre>{JSON.stringify(extension.providerDiagnostic ?? { availability: extension.availability, moduleId: extension.moduleId, editorIds: extension.editorIds }, null, 2)}</pre></details>
    </details>
  </article>
}

export function InnerPagesSettingsPage(props: SettingsPageProps) {
  const { t } = useWorkbenchLocale()
  const browser = props.settingsContext?.mode === 'browser-workbench'
  const registry = props.extensionRegistry
  const subscribe = useCallback((listener: () => void) => registry?.subscribe(listener) ?? (() => {}), [registry])
  const get = useCallback(() => registry?.getSnapshot() ?? EMPTY_EXTENSIONS, [registry])
  const access = useSyncExternalStore(subscribe, get, get)
  const [query, setQuery] = useState(props.memory.searches.pages ?? '')
  const [filter, setFilter] = useState(props.memory.filters.pages ?? 'all')
  const actions = useSettingsAction()
  const used = useMemo(() => new Set(Object.values(props.value?.workbenches ?? {}).flatMap(row => areasOf(row.document.root)
    .flatMap(area => area.moduleHistory.map(page => page.editorScope + ':' + page.editorId)))), [props.value?.workbenches])
  const usedIds = new Set([...used].map(key => key.slice(key.indexOf(':') + 1)))
  const extensionIds = new Set(access.extensions.flatMap(extension => extension.editorIds))
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const matches = (values: (string | undefined)[]) => values.filter(Boolean).join(' ').toLocaleLowerCase().includes(normalizedQuery)
  const pages = props.editors.filter(editor => !extensionIds.has(editor.id) && (!browser || used.has(editor.scope + ':' + editor.id)))
    .filter(editor => matches([workbenchPageTitle(t, editor.id, editor.label), editor.label, editor.declaration?.label, editor.id, editorMenuFolder(editor, props.value?.editorMenu).name])
      && (browser || filter === 'all' || (filter === 'builtin' && isBuiltinEditor(editor.id)) || (filter === 'extension' && !isBuiltinEditor(editor.id))))
  const extensions = access.extensions.filter(extension => !browser || extension.editorIds.some(id => usedIds.has(id)))
    .filter(extension => matches([extension.packageName, extension.packageVersion, extension.moduleId, extension.detail, extensionAvailabilityLabel(extension, t),
      ...extension.editorIds, ...extension.editorIds.map(id => props.value?.editorMenu?.folders.find(folder => folder.id === props.value?.editorMenu?.assignments[id])?.name), ...props.editors.filter(editor => extension.editorIds.includes(editor.id)).map(editor => editor.label)])
      && (browser || filter === 'all' || filter === 'extension' || (filter === 'attention' && (extension.availability !== 'ready' || !extension.allowed))))
  return <section className={css.page + ' ' + css.innerPagesPage} data-workbench-settings-page="inner-pages">
    <header className={css.pageHeader}><div><h3>{browser ? t('home.pagesInUse') : t('empty.manage')}</h3><p>{browser ? t('settings.pagesUsedByTheCurrentWorkbench') : t('settings.manageWhichPagesCanBeAddedAnd')}</p></div>
      {!browser ? <button className={css.secondaryButton} onClick={() => void actions.run('plugins', async () => {
        if (!props.nativePluginNavigation) throw new Error(t('settings.openPluginManagerFromDshSettingsOn'))
        await props.nativePluginNavigation.open()
      })}><IconSettingsOutlineMedium size={16} /> {t('settings.dshPluginManager')}</button> : null}</header>
    {actions.feedback('plugins')}
    {!browser ? <WorkbenchEditorFolders preferences={props.value?.editorMenu} directory={props.workbenchDirectory} writable={props.settingsWritable === true} /> : null}
    <div className={css.settingsToolbar}>
      <label className={css.search}><IconSearchOutlineRegular aria-hidden="true" /><input type="search" aria-label={t('settings.searchPagesAndExtensions')} placeholder={t('settings.searchNamesExtensionsOrStatus')}
        value={query} onChange={event => { setQuery(event.target.value); props.memory.searches.pages = event.target.value }} /></label>
      {!browser ? <div className={css.filters} aria-label={t('settings.filterPages')}>{[['all', t('home.all')], ['builtin', t('settings.builtIn')], ['extension', t('page.extensions')], ['attention', t('settings.needsAttention')]].map(([id, label]) =>
        <button key={id} aria-pressed={filter === id} onClick={() => { setFilter(id!); props.memory.filters.pages = id! }}>{label}</button>)}</div> : null}
    </div>
    {access.status === 'unavailable' ? <p className={css.cardHint}>{t('settings.extensionStatusIsUnavailableCheckTheDsh')}</p> : null}
    <div className={css.catalogGrid}>
      {pages.map(editor => <InnerPageSettingsCard key={editor.scope + ':' + editor.id} editor={editor} props={props} />)}
      {extensions.map(extension => <ExtensionSettingsCard key={extension.key} extension={extension} props={props} inventoryReady={access.status === 'ready'} />)}
    </div>
    {!pages.length && !extensions.length ? <div className={css.empty}>{t('settings.noMatchingPagesOrExtensions')}</div> : null}
    {!browser ? <p className={css.settingsFootnote}>{t('settings.hidingAPageFromThePickerDoes')}</p> : null}
  </section>
}

const RESOURCE_ROWS = [
  ['file', 'document-preview'],
  ['changes-review', 'changes-review'],
  ['plan', 'plan'],
  ['subagent-chat', 'subagent-chat'],
  ['browser', 'browser'],
  ['schedule-task', 'schedule-task'],
  ['trajectory-inspect', 'agent-trajectory'],
] as const
const PLACEMENTS = ['floating', 'activate-or-add', 'new-tab', 'replace-current', 'disabled'] as const satisfies readonly WorkbenchConversationResourcePlacementV1[]
export function InteractionSettingsPage(props: SettingsPageProps) {
  const { t } = useWorkbenchLocale()
  const policy = normalizeWorkbenchConversationInteractionPolicy(props.value?.interactionPolicy)
  const showSessionAccentFrames = policy.showSessionAccentFrames !== false
  const tabFontSize = policy.tabFontSize ?? 'standard'
  const showTabCloseButtons = policy.showTabCloseButtons !== false
  const actions = useSettingsAction()
  const [reset, setReset] = useState(false)
  const declared = props.editors.flatMap(editor => (editor.declaration?.conversationResources ?? []).map(resource => ({ ...resource, editorLabel: workbenchPageTitle(t, editor.id, editor.label) })))
  const rows: { id: string; label: string; target: string; detail?: string }[] = RESOURCE_ROWS.map(([id, target]) => ({ id, label: t(`settings.resource.${id}`), target: t(`editor.workbench.${target}`) }))
  for (const resource of declared) {
    const existing = rows.find(row => row.id === resource.resourceType)
    if (existing) { if (!existing.target.includes(resource.editorLabel)) existing.target += `、${resource.editorLabel}` }
    else rows.push({ id: resource.resourceType, label: resource.displayName ?? resource.editorLabel, target: resource.editorLabel, ...(resource.description ? { detail: resource.description } : {}) })
  }
  const commit = (key: string, value: unknown) => actions.run(key, async () => { if (!props.patchInteractionPolicy) throw new Error(t('settings.thisHostCannotSaveIndividualFieldsUpdate')); return props.patchInteractionPolicy(key, value) })
  const defaultFor = (id: string) => DEFAULT_WORKBENCH_CONVERSATION_INTERACTION_POLICY.conversationResources[id] ?? { enabled: declared.find(row => row.resourceType === id)?.defaultPlacement !== 'disabled', placement: declared.find(row => row.resourceType === id)?.defaultPlacement ?? 'activate-or-add' }
  return <section className={css.page + ' ' + css.interactionPage}><header className={css.pageHeader}><div><h3>{t('home.interactionPreferences')}</h3><p>{t('settings.thesePreferencesApplyToEveryWorkbenchIn')}</p></div><button className={css.secondaryButton} disabled={actions.states.reset?.busy || !props.patchInteractionPolicy} onClick={() => setReset(true)}>{t('settings.resetClickAndDisplayPreferences')}</button></header>
    {reset ? <div className={css.notice}><p>{t('settings.resetPageClickBehaviorAndTabDisplay')}</p><div className={css.noticeActions}><button className={css.primaryButton} onClick={() => void actions.run('reset', async () => { if (!await commit('showSessionAccentFrames', true)) throw new Error(t('settings.coloredAreaBordersWereNotSaved')); if (!await commit('tabFontSize', 'standard')) throw new Error(t('settings.tabTextSizeWasNotSaved')); if (!await commit('showTabCloseButtons', true)) throw new Error(t('settings.tabCloseButtonSettingWasNotSaved')); for (const row of rows) if (!await commit(row.id, defaultFor(row.id))) throw new Error(t('settings.someRulesCouldNotBeResetTry')); if (!await commit('unknownResource', 'module-default')) throw new Error(t('settings.unknownResourcePolicyWasNotSaved')); setReset(false) })}>{t('settings.confirmReset')}</button><button className={css.secondaryButton} onClick={() => setReset(false)}>{t('action.cancel')}</button></div></div> : null}{actions.feedback('reset')}
    <WorkbenchBackgroundAiSettings {...props} />
    <div className={css.preferenceGrid}>
      <div className={css.preferenceCard}><div className={css.cardSwitchRow}><strong>{t('settings.coloredAreaBorders')}</strong>
        <SettingsSwitch label={t('settings.showColoredAreaBorders')} checked={showSessionAccentFrames} disabled={actions.states.showSessionAccentFrames?.busy || !props.patchInteractionPolicy} onChange={checked => void commit('showSessionAccentFrames', checked)} /></div>
        <p>{t('settings.useConversationMarkerColorsForAreasAnd')}</p>{actions.feedback('showSessionAccentFrames')}</div>
      <div className={css.preferenceCard}><div className={css.cardSwitchRow}><strong>{t('settings.showTabCloseButtons')}</strong>
        <SettingsSwitch label={t('settings.showPageTabCloseButtons')} checked={showTabCloseButtons} disabled={actions.states.showTabCloseButtons?.busy || !props.patchInteractionPolicy} onChange={checked => void commit('showTabCloseButtons', checked)} /></div>
        <p>{t('settings.youCanStillCloseTabsFromTheir')}</p>{actions.feedback('showTabCloseButtons')}</div>
    </div>
    <div className={css.preferenceCard + ' ' + css.inlinePreference}><div><strong>{t('settings.tabTextSize')}</strong><p>{t('settings.changesTabTitlesInAreasAndThe')}</p></div>
      <select aria-label={t('settings.tabTextSize')} value={tabFontSize} disabled={actions.states.tabFontSize?.busy || !props.patchInteractionPolicy} onChange={event => void commit('tabFontSize', event.target.value)}><option value="standard">{t('settings.standard')}</option><option value="large">{t('settings.large')}</option><option value="larger">{t('settings.larger')}</option></select>{actions.feedback('tabFontSize')}</div>
    <div className={`${css.list} ${css.resourceList}`}>{rows.map(row => {
      const current = policy.conversationResources[row.id] ?? defaultFor(row.id)
      const value = !current.enabled || current.placement === 'disabled' ? 'disabled' : current.placement
      return <article key={row.id} className={css.resourceRow}><div><strong>{row.label}</strong><p>{t('settings.targetPage')}{row.target}</p>{row.detail ? <p>{row.detail}</p> : null}<small>{t('settings.usesSharedClickRouting')}{row.id === 'trajectory-inspect' ? t('settings.nativeInspectionIsDecidedAfterRouting') : ''}</small></div>
        <label>{t('settings.onClick')}<select aria-label={t('settings.onClickValue1', { value1: row.label })} value={value} disabled={actions.states[row.id]?.busy || !props.patchInteractionPolicy} onChange={event => { const placement = event.target.value as WorkbenchConversationResourcePlacementV1; void commit(row.id, { enabled: placement !== 'disabled', placement }) }}>{PLACEMENTS.map(value => <option key={value} value={value}>{t(`settings.placement.${value}`)}</option>)}</select></label>
        <button className={css.secondaryButton} disabled={actions.states[row.id]?.busy || !props.patchInteractionPolicy} onClick={() => void commit(row.id, defaultFor(row.id))}>{t('settings.resetToDefault')}</button>{actions.feedback(row.id)}
      </article>
    })}</div>
    <div className={css.controlCard}><div><strong>{t('settings.unknownResourcePolicy')}</strong><p>{t('settings.appliedWhenAResourceDoesNotDeclare')}</p></div><label className={css.form}><select aria-label={t('settings.unknownResourcePolicy')} value={policy.unknownResource} disabled={actions.states.unknownResource?.busy || !props.patchInteractionPolicy} onChange={event => void commit('unknownResource', event.target.value)}><option value="module-default">{t('settings.followAllowedModuleDeclarations')}</option><option value="disabled">{t('settings.ignore')}</option></select></label>{actions.feedback('unknownResource')}</div>
    <p className={css.notice}>{t('settings.terminalPagesAreAvailableInAreasDsh')}</p>
  </section>
}

export function downloadSettingsFile(name: string, content: BlobPart, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = name.replace(/[<>:"/\\|?*]/gu, '-').slice(0, 150); anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
