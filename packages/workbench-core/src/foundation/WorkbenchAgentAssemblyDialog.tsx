import { workbenchMessages, type WorkbenchMessageKey } from './workbench-messages.ts'
import { useWorkbenchLocale, workbenchErrorNotice, workbenchNoticeText, WorkbenchMessageError, type WorkbenchNotice } from './workbench-locale.ts'
import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { IconCloseOutlineMedium } from '@deepseek-ai/dsh-client-ui-primitives'
import type { WorkbenchEditorCatalogRow } from './catalog.ts'
import { WorkbenchToolGatewayDialog } from './WorkbenchToolGatewayDialog.tsx'
import type { ToolCatalogEntryV1, WorkbenchToolGatewayV1 } from '../tool-gateway.ts'
import {
  AGENT_ASSEMBLY_ROUTE,
  AGENT_INSTRUCTION_LIMIT,
  agentBasePresets,
  agentDefinitionProblems,
  blocksForBase,
  defaultBlocksFor,
  type AgentBasePresetId,
  type AgentGuestAccess,
  type WorkbenchAgentDefinitionV1,
} from '../agent-assembly-model.ts'
import css from './WorkbenchAgentAssemblyDialog.module.css'

const PRESET_MESSAGES = {
  'standard': { label: 'assembly.option.standard', description: 'assembly.description.standard' },
  'minimal': { label: 'assembly.option.minimal', description: 'assembly.description.minimal' },
} satisfies Record<string, { label: WorkbenchMessageKey; description: WorkbenchMessageKey }>

const BLOCK_MESSAGES: Readonly<Record<string, { label: WorkbenchMessageKey; description: WorkbenchMessageKey }>> = {
  'agent-instructions': { label: 'assembly.option.agent-instructions', description: 'assembly.description.agent-instructions' },
  'tool-shell': { label: 'assembly.option.tool-shell', description: 'assembly.description.tool-shell' },
  'tool-fs': { label: 'assembly.option.tool-fs', description: 'assembly.description.tool-fs' },
  'tool-web': { label: 'assembly.option.tool-web', description: 'assembly.description.tool-web' },
  'skill': { label: 'assembly.option.skill', description: 'assembly.description.skill' },
  'agent-loop': { label: 'assembly.option.agent-loop', description: 'assembly.description.agent-loop' },
} satisfies Record<string, { label: WorkbenchMessageKey; description: WorkbenchMessageKey }>

type Page = 'roster' | 'build' | 'tools'
type BuildStep = 'preset' | 'blocks' | 'tools' | 'profile'

const STEPS: readonly { id: BuildStep; label: WorkbenchMessageKey }[] = [
  { id: 'preset', label: 'assembly.step.preset' },
  { id: 'blocks', label: 'assembly.step.blocks' },
  { id: 'tools', label: 'assembly.step.tools' },
  { id: 'profile', label: 'assembly.step.profile' },
]

const GUEST_OPTIONS: readonly { id: AgentGuestAccess; label: WorkbenchMessageKey; description: WorkbenchMessageKey }[] = [
  { id: 'none', label: 'assembly.guest.none', description: 'assembly.guest.noneHelp' },
  { id: 'read-only', label: 'assembly.guest.read-only', description: 'assembly.guest.readOnlyHelp' },
  { id: 'approved', label: 'assembly.guest.approved', description: 'assembly.guest.approvedHelp' },
]

export interface AgentAssemblyRowV1 {
  readonly definition: WorkbenchAgentDefinitionV1
  readonly presetId: string
  readonly status: 'saved' | 'registered' | 'unavailable'
  readonly reason?: string
  /** Selected tools or skills that no Host extension executes. The Host refuses to register while this is non-empty. */
  readonly missing?: readonly string[]
  /** The imported package's source had this revision registered. */
  readonly suggested?: 'complete' | 'template-signed' | 'template-unsigned'
}

export interface AgentAssemblySessionUseV1 { readonly sessionKey: string; readonly title: string; readonly role: string }

export interface AgentAssemblyClientV1 {
  list(workbenchId: string): Promise<readonly AgentAssemblyRowV1[]>
  save(workbenchId: string, input: AgentAssemblyDraftV1): Promise<AgentAssemblyRowV1>
  register(workbenchId: string, agentId: string, revision: number): Promise<AgentAssemblyRowV1>
  unregister(workbenchId: string, agentId: string, revision: number): Promise<{ row: AgentAssemblyRowV1; sessions: readonly AgentAssemblySessionUseV1[] }>
}

/** Default client talks to the Host route. Tests pass their own. */
export function createAgentAssemblyClient(fetchImpl: typeof fetch = fetch): AgentAssemblyClientV1 {
  const post = async (body: Record<string, unknown>): Promise<unknown> => {
    const response = await fetchImpl(AGENT_ASSEMBLY_ROUTE, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    const result = await response.json() as { value?: unknown; error?: string; messageKey?: string; params?: Record<string, string> }
    if (!response.ok) {
      const key = result.messageKey
      if (typeof key === 'string' && key.startsWith('assembly.') && Object.hasOwn(workbenchMessages.zh, key)) {
        throw new WorkbenchMessageError(key as WorkbenchMessageKey, result.params)
      }
      throw result.error ? new Error(result.error) : new WorkbenchMessageError('assembly.requestFailed')
    }
    return result.value
  }
  return {
    async list(workbenchId) {
      const value = await post({ action: 'list', workbenchId })
      return Array.isArray(value) ? value.flatMap(row => rowOf(row)) : []
    },
    async save(workbenchId, input) {
      const row = rowOf(await post({ action: 'save', workbenchId, ...input }))[0]
      if (row === undefined) throw new WorkbenchMessageError('assembly.invalidSaveResult')
      return row
    },
    async register(workbenchId, agentId, revision) {
      const row = rowOf(await post({ action: 'register', workbenchId, agentId, revision }))[0]
      if (row === undefined) throw new WorkbenchMessageError('assembly.invalidRegisterResult')
      return row
    },
    async unregister(workbenchId, agentId, revision) {
      const value = await post({ action: 'unregister', workbenchId, agentId, revision }) as { row?: unknown; sessions?: unknown }
      const row = rowOf(value.row)[0]
      if (row === undefined) throw new WorkbenchMessageError('assembly.invalidUnregisterResult')
      return { row, sessions: Array.isArray(value.sessions) ? value.sessions.flatMap(sessionOf) : [] }
    },
  }
}

export interface AgentAssemblyDraftV1 {
  readonly agentId: string
  readonly name: string
  readonly description: string
  readonly basePreset: AgentBasePresetId
  readonly blocks: readonly string[]
  readonly tools: readonly string[]
  readonly skills: readonly string[]
  readonly instructions?: string
  readonly guestAccess: AgentGuestAccess
}

function rowOf(value: unknown): AgentAssemblyRowV1[] {
  if (typeof value !== 'object' || value === null) return []
  const row = value as Partial<AgentAssemblyRowV1>
  if (row.definition === undefined || typeof row.presetId !== 'string') return []
  const status = row.status === 'registered' || row.status === 'unavailable' ? row.status : 'saved'
  const missing = Array.isArray(row.missing) ? row.missing.filter((id): id is string => typeof id === 'string') : []
  const suggested = row.suggested === 'complete' || row.suggested === 'template-signed' || row.suggested === 'template-unsigned' ? row.suggested : undefined
  return [{ definition: row.definition, presetId: row.presetId, status, ...(typeof row.reason === 'string' ? { reason: row.reason } : {}),
    ...(missing.length ? { missing } : {}), ...(suggested ? { suggested } : {}) }]
}

function sessionOf(value: unknown): AgentAssemblySessionUseV1[] {
  if (typeof value !== 'object' || value === null) return []
  const row = value as Partial<AgentAssemblySessionUseV1>
  if (typeof row.sessionKey !== 'string' || typeof row.title !== 'string') return []
  return [{ sessionKey: row.sessionKey, title: row.title, role: typeof row.role === 'string' ? row.role : 'user' }]
}

export function WorkbenchAgentAssemblyDialog({ workbenchId, workbenchName, gateway, editors = [], client: providedClient, onClose, returnFocusRef }: {
  workbenchId: string; workbenchName: string; gateway: WorkbenchToolGatewayV1
  editors?: readonly WorkbenchEditorCatalogRow[]; client?: AgentAssemblyClientV1; onClose: () => void; returnFocusRef?: RefObject<HTMLElement>
}) {
  const { t } = useWorkbenchLocale()
  const client = useMemo(() => providedClient ?? createAgentAssemblyClient(), [providedClient])
  const [page, setPage] = useState<Page>('roster')
  const [agents, setAgents] = useState<readonly AgentAssemblyRowV1[]>([])
  const [loadError, setLoadError] = useState<WorkbenchNotice>()
  const [draft, setDraft] = useState<AgentAssemblyDraftV1 | undefined>()
  const closeRef = useRef<HTMLButtonElement>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  const catalog = useMemo(() => gateway.catalog(), [gateway, agents])

  useEffect(() => {
    closeRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); onCloseRef.current() } }
    window.addEventListener('keydown', onKeyDown)
    return () => { window.removeEventListener('keydown', onKeyDown); returnFocusRef?.current?.focus() }
  }, [returnFocusRef])
  useEffect(() => {
    let cancelled = false
    client.list(workbenchId).then(async rows => {
      if (cancelled) return
      setAgents(rows)
      // Imports register agents on the Host; the tool allowlist is workbench policy and catches up here.
      const known = new Set(gateway.catalog().map(entry => entry.id))
      const current = gateway.policy().agentAllowlists
      for (const row of rows) {
        const { agentId, tools } = row.definition
        if (row.status !== 'registered' || !tools.every(toolId => known.has(toolId))) continue
        if ([...(current[agentId] ?? [])].sort().join('\n') === [...tools].sort().join('\n')) continue
        await gateway.setAgentAllowlist(agentId, tools).catch(() => undefined)
      }
    }, error => { if (!cancelled) setLoadError(workbenchErrorNotice(error, 'assembly.loadFailed')) })
    return () => { cancelled = true }
  }, [client, gateway, workbenchId])

  const startNew = () => setDraft({ agentId: '', name: '', description: '', basePreset: 'standard', blocks: [...defaultBlocksFor('standard')], tools: [], skills: [], guestAccess: 'none' })
  const edit = (row: AgentAssemblyRowV1) => {
    const definition = row.definition
    setDraft({ agentId: definition.agentId, name: definition.name, description: definition.description, basePreset: definition.basePreset, blocks: [...definition.blocks], tools: [...definition.tools], skills: [...definition.skills], ...(definition.instructions === undefined ? {} : { instructions: definition.instructions }), guestAccess: definition.guestAccess })
  }
  const remember = (row: AgentAssemblyRowV1) => setAgents(current => [...current.filter(item => item.presetId !== row.presetId), row].sort((left, right) => left.definition.name.localeCompare(right.definition.name) || right.definition.revision - left.definition.revision))
  const published = async (row: AgentAssemblyRowV1) => { remember(row); setDraft(undefined) }
  const registered = async (row: AgentAssemblyRowV1) => {
    await gateway.setAgentAllowlist(row.definition.agentId, row.definition.tools)
    remember(row)
  }

  return <div className={css.overlay} data-workbench-agent-assembly-overlay onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
    <aside className={css.dialog} role="dialog" aria-modal="true" aria-labelledby="workbench-agent-assembly-title" data-workbench-agent-assembly-dialog>
      <header className={css.header}>
        <div className={css.headerCopy}>
          <span className={css.eyebrow}>{t('editor.dedicatedAgent')} {workbenchName}</span>
          <h2 id="workbench-agent-assembly-title">{page === 'build' ? (agents.some(row => row.definition.agentId === draft?.agentId) ? t('assembly.editTitle') : t('assembly.buildTitle')) : t('assembly.title')}</h2>
          <p>{page === 'tools' ? t('assembly.toolHelp') : t('assembly.help')}</p>
        </div>
        <button ref={closeRef} className={css.close} type="button" aria-label={t('editor.closeAgentAssembly')} title={t('action.close')} onClick={onClose}><IconCloseOutlineMedium size={17} /></button>
      </header>
      <nav className={css.tabs} role="tablist" aria-label={t('editor.agentAssemblyWorkspace')}>
        <Tab id="roster" active={page === 'roster' || page === 'build'} onClick={() => { setPage('roster'); setDraft(undefined) }}>{t('editor.assembled')}</Tab>
        <Tab id="tools" active={page === 'tools'} onClick={() => setPage('tools')}>{t('editor.toolIntegration')}</Tab>
      </nav>
      <div className={css.body}>
        {page === 'tools'
          ? <WorkbenchToolGatewayDialog embedded gateway={gateway} workbenchId={workbenchId} workbenchName={workbenchName} editors={editors} onClose={onClose} />
          : draft === undefined
            ? <Roster agents={agents} loadError={loadError} catalog={catalog} client={client} workbenchId={workbenchId} onCreate={startNew} onEdit={edit} onRegistered={registered} onChanged={remember} />
            : <Builder draft={draft} catalog={catalog} existing={agents.some(row => row.definition.agentId === draft.agentId)} client={client} workbenchId={workbenchId} onChange={setDraft} onCancel={() => setDraft(undefined)} onPublished={published} />}
      </div>
    </aside>
  </div>
}

function Tab({ id, active, onClick, children }: { id: 'roster' | 'tools'; active: boolean; onClick: () => void; children: string }) {
  return <button type="button" role="tab" id={`workbench-agent-tab-${id}`} aria-selected={active} className={active ? css.tabActive : css.tab} onClick={onClick}>{children}</button>
}

function Roster({ agents, loadError, catalog, client, workbenchId, onCreate, onEdit, onRegistered, onChanged }: {
  agents: readonly AgentAssemblyRowV1[]; loadError: WorkbenchNotice | undefined; catalog: readonly ToolCatalogEntryV1[]; client: AgentAssemblyClientV1
  workbenchId: string; onCreate: () => void; onEdit: (row: AgentAssemblyRowV1) => void
  onRegistered: (row: AgentAssemblyRowV1) => Promise<void>; onChanged: (row: AgentAssemblyRowV1) => void
}) {
  const { t } = useWorkbenchLocale()
  const [notice, setNotice] = useState<WorkbenchNotice>()
  const toggle = async (row: AgentAssemblyRowV1) => {
    setNotice(undefined)
    try {
      if (row.status === 'registered') {
        const result = await client.unregister(workbenchId, row.definition.agentId, row.definition.revision)
        onChanged(result.row)
        if (result.sessions.length > 0) setNotice({ key: 'assembly.sessionsStillUseRevision', params: { titles: result.sessions.map(session => session.title).join(', ') } })
      } else {
        await onRegistered(await client.register(workbenchId, row.definition.agentId, row.definition.revision))
      }
    } catch (cause) { setNotice(workbenchErrorNotice(cause, 'assembly.registrationFailed')) }
  }
  return <section className={css.panel}>
    <div className={css.panelIntro}><div><h3>{t('editor.dedicatedAgentsForThisWorkbench')}</h3><p>{t('editor.savingCreatesARevisionRegisterARevision')}</p></div><button type="button" className={css.primary} onClick={onCreate}>{t('editor.assembleAnAgent')}</button></div>
    {loadError === undefined && notice === undefined ? null : <div className={css.error} role="alert">{workbenchNoticeText(t, notice ?? loadError)}</div>}
    {agents.length === 0 ? <div className={css.empty}><strong>{t('editor.noDedicatedAgentsYet')}</strong><p>{t('editor.startWithABaseModeChooseCapabilities')}</p></div> : <div className={css.agentList}>{agents.map(row => <AgentCard key={row.presetId} row={row} catalog={catalog} onEdit={() => onEdit(row)} onToggle={() => void toggle(row)} />)}</div>}
  </section>
}

const SUGGESTION_TEXT: Record<NonNullable<AgentAssemblyRowV1['suggested']>, WorkbenchMessageKey> = {
  complete: 'assembly.fromComplete',
  'template-signed': 'assembly.fromSigned',
  'template-unsigned': 'assembly.fromUnsigned',
}

function AgentCard({ row, catalog, onEdit, onToggle }: { row: AgentAssemblyRowV1; catalog: readonly ToolCatalogEntryV1[]; onEdit: () => void; onToggle: () => void }) {
  const { t } = useWorkbenchLocale()
  const agent = row.definition
  // The Host decides availability from installed executors; the catalog only adds what this browser cannot see.
  const missing = [...new Set([...(row.missing ?? []), ...agent.tools.filter(toolId => !catalog.some(entry => entry.id === toolId))])]
  const base = agentBasePresets().find(preset => preset.id === agent.basePreset)
  // A revision with missing tools cannot be registered; an already registered one can still be withdrawn.
  const unavailable = row.status === 'unavailable' || (row.status !== 'registered' && missing.length > 0)
  const status = row.status === 'registered' ? t('assembly.registered') : unavailable ? t('assembly.unavailable') : t('assembly.notRegistered')
  const note = row.reason ?? (unavailable && missing.length > 0 ? t('assembly.missingTools', { tools: missing.join(', ') }) : agent.description)
  return <article className={css.agentCard}>
    <div className={css.agentIdentity}><strong>{agent.name}</strong><small>{agent.agentId} {t('editor.revision')} {agent.revision} · {base ? t(PRESET_MESSAGES[base.id].label) : agent.basePreset} · {status}</small><p>{note}</p>
      {row.suggested && row.status !== 'registered' ? <p className={css.warning}>{t(SUGGESTION_TEXT[row.suggested])}</p> : null}</div>
    <div className={css.agentMeta}><span>{agent.blocks.length} {t('editor.capabilityBlocks')}</span><span>{agent.tools.length} {t('editor.tools')}</span>{missing.length > 0 ? <span className={css.warning}>{missing.length} {t('editor.toolsNotInstalled')}</span> : null}</div>
    <div className={css.cardActions}>
      <button type="button" className={css.secondary} onClick={onToggle} disabled={unavailable}>{row.status === 'registered' ? t('assembly.unregister') : t('assembly.register')}</button>
      <button type="button" className={css.secondary} onClick={onEdit}>{t('editor.edit')}</button>
    </div>
  </article>
}

function Builder({ draft, catalog, existing, client, workbenchId, onChange, onCancel, onPublished }: {
  draft: AgentAssemblyDraftV1; catalog: readonly ToolCatalogEntryV1[]; existing: boolean; client: AgentAssemblyClientV1
  workbenchId: string; onChange: (draft: AgentAssemblyDraftV1) => void; onCancel: () => void; onPublished: (row: AgentAssemblyRowV1) => Promise<void>
}) {
  const { t } = useWorkbenchLocale()
  const [step, setStep] = useState<BuildStep>('preset')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<WorkbenchNotice>()
  const index = STEPS.findIndex(item => item.id === step)
  const problems = useMemo(() => agentDefinitionProblems(toDefinition(draft), new Set(catalog.map(entry => entry.id))), [draft, catalog])
  const stepProblem = problems.find(problem => problem.field === (step === 'profile' ? 'name' : step === 'tools' ? 'tools' : step === 'blocks' ? 'blocks' : 'basePreset'))
  const publish = async () => {
    setBusy(true); setError(undefined)
    try { await onPublished(await client.save(workbenchId, draft)) }
    catch (cause) { setError(workbenchErrorNotice(cause, 'assembly.saveFailed')) }
    finally { setBusy(false) }
  }
  return <section className={css.panel}>
    <ol className={css.steps}>{STEPS.map((item, position) => <li key={item.id}><button type="button" className={position === index ? css.stepActive : css.step} aria-current={position === index ? 'step' : undefined} onClick={() => setStep(item.id)}>{position + 1}. {t(item.label)}</button></li>)}</ol>
    {step === 'preset' ? <PresetStep draft={draft} onChange={onChange} /> : null}
    {step === 'blocks' ? <BlockStep draft={draft} onChange={onChange} /> : null}
    {step === 'tools' ? <ToolStep draft={draft} catalog={catalog} onChange={onChange} /> : null}
    {step === 'profile' ? <ProfileStep draft={draft} existing={existing} onChange={onChange} /> : null}
    {stepProblem === undefined && error === undefined ? null : <div className={css.error} role="alert">{workbenchNoticeText(t, error) ?? (stepProblem && t(stepProblem.messageKey, stepProblem.params))}</div>}
    <div className={css.builderActions}>
      <button type="button" className={css.secondary} onClick={onCancel}>{t('editor.backToList')}</button>
      {index > 0 ? <button type="button" className={css.secondary} onClick={() => setStep(STEPS[index - 1]!.id)}>{t('editor.back')}</button> : null}
      {index < STEPS.length - 1
        ? <button type="button" className={css.primary} onClick={() => setStep(STEPS[index + 1]!.id)}>{t('editor.next')}</button>
        : <button type="button" className={css.primary} disabled={busy || problems.length > 0} onClick={() => void publish()}>{busy ? t('assembly.saving') : existing ? t('assembly.saveNewRevision') : t('assembly.saveRevision')}</button>}
    </div>
  </section>
}

function PresetStep({ draft, onChange }: { draft: AgentAssemblyDraftV1; onChange: (draft: AgentAssemblyDraftV1) => void }) {
  const { t } = useWorkbenchLocale()
  return <div className={css.choiceList}>{agentBasePresets().map(preset => <label key={preset.id} className={draft.basePreset === preset.id ? css.choiceActive : css.choice}><input type="radio" name="base-preset" checked={draft.basePreset === preset.id} onChange={() => onChange({ ...draft, basePreset: preset.id, blocks: [...defaultBlocksFor(preset.id)] })} /><span><strong>{t(PRESET_MESSAGES[preset.id].label)}</strong><small>{t(PRESET_MESSAGES[preset.id].description)}</small></span></label>)}</div>
}

function BlockStep({ draft, onChange }: { draft: AgentAssemblyDraftV1; onChange: (draft: AgentAssemblyDraftV1) => void }) {
  const { t } = useWorkbenchLocale()
  const blocks = blocksForBase(draft.basePreset)
  if (blocks.length === 0) return <div className={css.empty}><strong>{t('editor.minimalModeHasNoOptionalCapabilities')}</strong><p>{t('editor.itIncludesAnIdentityPromptAndImage')}</p></div>
  const toggle = (id: string) => onChange({ ...draft, blocks: draft.blocks.includes(id) ? draft.blocks.filter(block => block !== id) : [...draft.blocks, id] })
  return <div className={css.choiceList}>{blocks.map(block => <label key={block.id} className={draft.blocks.includes(block.id) ? css.choiceActive : css.choice}><input type="checkbox" checked={draft.blocks.includes(block.id)} onChange={() => toggle(block.id)} /><span><strong>{BLOCK_MESSAGES[block.id] ? t(BLOCK_MESSAGES[block.id]!.label) : block.label}</strong><small>{BLOCK_MESSAGES[block.id] ? t(BLOCK_MESSAGES[block.id]!.description) : block.description}</small></span></label>)}</div>
}

function ToolStep({ draft, catalog, onChange }: { draft: AgentAssemblyDraftV1; catalog: readonly ToolCatalogEntryV1[]; onChange: (draft: AgentAssemblyDraftV1) => void }) {
  const { t } = useWorkbenchLocale()
  // AgentKit mounts native Tool and Skill executors. MCP and CLI entries remain
  // available in the Gateway page, but selecting them here would create a
  // definition that no AgentKit binder can execute.
  const enabled = catalog.filter(entry => entry.visibility === 'enabled' && (entry.kind === 'tool' || entry.kind === 'skill'))
  if (enabled.length === 0) return <div className={css.empty}><strong>{t('editor.noEnabledAgentToolsInTheCatalog')}</strong><p>{t('editor.enableAnExtensionToolOrSkillUnder')}</p></div>
  const toggle = (entry: ToolCatalogEntryV1) => {
    const tools = draft.tools.includes(entry.id) ? draft.tools.filter(id => id !== entry.id) : [...draft.tools, entry.id]
    const skills = entry.kind === 'skill' ? (draft.skills.includes(entry.id) ? draft.skills.filter(id => id !== entry.id) : [...draft.skills, entry.id]) : draft.skills
    onChange({ ...draft, tools, skills })
  }
  return <div className={css.choiceList}>{enabled.map(entry => <label key={entry.id} className={draft.tools.includes(entry.id) ? css.choiceActive : css.choice}><input type="checkbox" checked={draft.tools.includes(entry.id)} onChange={() => toggle(entry)} /><span><strong>{entry.display.name}</strong><small>{entry.id} · {entry.kind}{entry.display.description === undefined ? '' : ` · ${entry.display.description}`}</small></span></label>)}</div>
}

function ProfileStep({ draft, existing, onChange }: { draft: AgentAssemblyDraftV1; existing: boolean; onChange: (draft: AgentAssemblyDraftV1) => void }) {
  const { t } = useWorkbenchLocale()
  return <div className={css.form}>
    <label className={css.field}><span>{t('editor.identifier')}</span><input value={draft.agentId} disabled={existing} placeholder={t('editor.eGQuoteAssistant')} onChange={event => onChange({ ...draft, agentId: event.target.value.trim() })} /><small>{t('editor.startWithALowercaseLetterThisCannot')}</small></label>
    <label className={css.field}><span>{t('home.name')}</span><input value={draft.name} maxLength={80} onChange={event => onChange({ ...draft, name: event.target.value })} /></label>
    <label className={css.field}><span>{t('editor.description')}</span><textarea value={draft.description} maxLength={400} rows={3} onChange={event => onChange({ ...draft, description: event.target.value })} /><small>{t('editor.bayAgentUsesThisDescriptionWhenChoosing')}</small></label>
    <label className={css.field}><span>{t('editor.modeInstructions')}</span><textarea value={draft.instructions ?? ''} maxLength={AGENT_INSTRUCTION_LIMIT} rows={5} placeholder={t('editor.howThisAgentWorksAndWhatIt')} onChange={event => { const { instructions: _drop, ...rest } = draft; onChange(event.target.value ? { ...rest, instructions: event.target.value } : rest) }} /></label>
    <fieldset className={css.guest}><legend>{t('editor.guestAccess')}</legend><div className={css.choiceList}>{GUEST_OPTIONS.map(option => <label key={option.id} className={draft.guestAccess === option.id ? css.choiceActive : css.choice}><input type="radio" name="guest-access" checked={draft.guestAccess === option.id} onChange={() => onChange({ ...draft, guestAccess: option.id })} /><span><strong>{t(option.label)}</strong><small>{t(option.description)}</small></span></label>)}</div></fieldset>
  </div>
}

function toDefinition(draft: AgentAssemblyDraftV1): WorkbenchAgentDefinitionV1 {
  return { schemaVersion: 1, agentId: draft.agentId, name: draft.name, description: draft.description, basePreset: draft.basePreset, tools: draft.tools, skills: draft.skills, blocks: draft.blocks, ...(draft.instructions === undefined ? {} : { instructions: draft.instructions }), guestAccess: draft.guestAccess, revision: 1, origin: { kind: 'manual' }, updatedAt: new Date(0).toISOString() }
}
