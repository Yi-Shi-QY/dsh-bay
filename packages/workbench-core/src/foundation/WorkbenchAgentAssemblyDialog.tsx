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

type Page = 'roster' | 'build' | 'tools'
type BuildStep = 'preset' | 'blocks' | 'tools' | 'profile'

const STEPS: readonly { id: BuildStep; label: string }[] = [
  { id: 'preset', label: '基础模式' },
  { id: 'blocks', label: '能力积木' },
  { id: 'tools', label: '工作台工具' },
  { id: 'profile', label: '身份与发布' },
]

const GUEST_OPTIONS: readonly { id: AgentGuestAccess; label: string; description: string }[] = [
  { id: 'none', label: '不开放', description: '只有本机可以派活给这个 Agent。' },
  { id: 'read-only', label: '只读', description: '访客只能用它的只读工具。' },
  { id: 'approved', label: '审批', description: '访客可以派活，写入类工具每次都要房主确认。' },
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
    const result = await response.json() as { value?: unknown; error?: string }
    if (!response.ok) throw new Error(result.error ?? 'Agent 组装请求失败。')
    return result.value
  }
  return {
    async list(workbenchId) {
      const value = await post({ action: 'list', workbenchId })
      return Array.isArray(value) ? value.flatMap(row => rowOf(row)) : []
    },
    async save(workbenchId, input) {
      const row = rowOf(await post({ action: 'save', workbenchId, ...input }))[0]
      if (row === undefined) throw new Error('保存结果不是有效的 Agent 定义。')
      return row
    },
    async register(workbenchId, agentId, revision) {
      const row = rowOf(await post({ action: 'register', workbenchId, agentId, revision }))[0]
      if (row === undefined) throw new Error('注册结果不是有效的 Agent 定义。')
      return row
    },
    async unregister(workbenchId, agentId, revision) {
      const value = await post({ action: 'unregister', workbenchId, agentId, revision }) as { row?: unknown; sessions?: unknown }
      const row = rowOf(value.row)[0]
      if (row === undefined) throw new Error('取消注册结果不是有效的 Agent 定义。')
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
  const client = useMemo(() => providedClient ?? createAgentAssemblyClient(), [providedClient])
  const [page, setPage] = useState<Page>('roster')
  const [agents, setAgents] = useState<readonly AgentAssemblyRowV1[]>([])
  const [loadError, setLoadError] = useState<string>()
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
    }, error => { if (!cancelled) setLoadError(error instanceof Error ? error.message : '读取 Agent 失败。') })
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
          <span className={css.eyebrow}>专用 Agent · {workbenchName}</span>
          <h2 id="workbench-agent-assembly-title">{page === 'build' ? (agents.some(row => row.definition.agentId === draft?.agentId) ? '修改 Agent' : '组装 Agent') : 'Agent 组装'}</h2>
          <p>{page === 'tools' ? '工作台工具目录是组装时勾选的来源。' : '把当前工作台里的能力搭成专用 Agent，再从列表里选修订注册成 DSH 模式。'}</p>
        </div>
        <button ref={closeRef} className={css.close} type="button" aria-label="关闭 Agent 组装" title="关闭" onClick={onClose}><IconCloseOutlineMedium size={17} /></button>
      </header>
      <nav className={css.tabs} role="tablist" aria-label="Agent 组装工作区">
        <Tab id="roster" active={page === 'roster' || page === 'build'} onClick={() => { setPage('roster'); setDraft(undefined) }}>已组装</Tab>
        <Tab id="tools" active={page === 'tools'} onClick={() => setPage('tools')}>工具集成</Tab>
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
  agents: readonly AgentAssemblyRowV1[]; loadError: string | undefined; catalog: readonly ToolCatalogEntryV1[]; client: AgentAssemblyClientV1
  workbenchId: string; onCreate: () => void; onEdit: (row: AgentAssemblyRowV1) => void
  onRegistered: (row: AgentAssemblyRowV1) => Promise<void>; onChanged: (row: AgentAssemblyRowV1) => void
}) {
  const [notice, setNotice] = useState<string>()
  const toggle = async (row: AgentAssemblyRowV1) => {
    setNotice(undefined)
    try {
      if (row.status === 'registered') {
        const result = await client.unregister(workbenchId, row.definition.agentId, row.definition.revision)
        onChanged(result.row)
        if (result.sessions.length > 0) setNotice(`已取消注册。这些会话仍指向该修订，恢复前需要重新注册：${result.sessions.map(session => session.title).join('、')}`)
      } else {
        await onRegistered(await client.register(workbenchId, row.definition.agentId, row.definition.revision))
      }
    } catch (cause) { setNotice(cause instanceof Error ? cause.message : '注册状态没有改成。') }
  }
  return <section className={css.panel}>
    <div className={css.panelIntro}><div><h3>这个工作台的专用 Agent</h3><p>保存只留下修订。从列表里选一个修订注册为 DSH 模式后，Bay Agent 派活才能选到它。</p></div><button type="button" className={css.primary} onClick={onCreate}>组装新 Agent</button></div>
    {loadError === undefined && notice === undefined ? null : <div className={css.error} role="alert">{notice ?? loadError}</div>}
    {agents.length === 0 ? <div className={css.empty}><strong>还没有专用 Agent</strong><p>从基础模式开始，勾选能力积木和工作台工具，保存后再注册。</p></div> : <div className={css.agentList}>{agents.map(row => <AgentCard key={row.presetId} row={row} catalog={catalog} onEdit={() => onEdit(row)} onToggle={() => void toggle(row)} />)}</div>}
  </section>
}

const SUGGESTION_TEXT: Record<NonNullable<AgentAssemblyRowV1['suggested']>, string> = {
  complete: '源工作台注册过此修订，确认后再注册。',
  'template-signed': '模板包建议注册此修订（已签名），确认后再注册。',
  'template-unsigned': '模板包建议注册此修订。该包未签名，指令可能被改过，请先检查再注册。',
}

function AgentCard({ row, catalog, onEdit, onToggle }: { row: AgentAssemblyRowV1; catalog: readonly ToolCatalogEntryV1[]; onEdit: () => void; onToggle: () => void }) {
  const agent = row.definition
  // The Host decides availability from installed executors; the catalog only adds what this browser cannot see.
  const missing = [...new Set([...(row.missing ?? []), ...agent.tools.filter(toolId => !catalog.some(entry => entry.id === toolId))])]
  const base = agentBasePresets().find(preset => preset.id === agent.basePreset)
  // A revision with missing tools cannot be registered; an already registered one can still be withdrawn.
  const unavailable = row.status === 'unavailable' || (row.status !== 'registered' && missing.length > 0)
  const status = row.status === 'registered' ? '已注册' : unavailable ? '不可用' : '未注册'
  const note = row.reason ?? (unavailable && missing.length > 0 ? `缺少工具或 Skill：${missing.join('、')}` : agent.description)
  return <article className={css.agentCard}>
    <div className={css.agentIdentity}><strong>{agent.name}</strong><small>{agent.agentId} · 修订 {agent.revision} · {base?.label ?? agent.basePreset} · {status}</small><p>{note}</p>
      {row.suggested && row.status !== 'registered' ? <p className={css.warning}>{SUGGESTION_TEXT[row.suggested]}</p> : null}</div>
    <div className={css.agentMeta}><span>{agent.blocks.length} 个积木</span><span>{agent.tools.length} 个工具</span>{missing.length > 0 ? <span className={css.warning}>{missing.length} 个工具未安装</span> : null}</div>
    <div className={css.cardActions}>
      <button type="button" className={css.secondary} onClick={onToggle} disabled={unavailable}>{row.status === 'registered' ? '取消注册' : '注册'}</button>
      <button type="button" className={css.secondary} onClick={onEdit}>修改</button>
    </div>
  </article>
}

function Builder({ draft, catalog, existing, client, workbenchId, onChange, onCancel, onPublished }: {
  draft: AgentAssemblyDraftV1; catalog: readonly ToolCatalogEntryV1[]; existing: boolean; client: AgentAssemblyClientV1
  workbenchId: string; onChange: (draft: AgentAssemblyDraftV1) => void; onCancel: () => void; onPublished: (row: AgentAssemblyRowV1) => Promise<void>
}) {
  const [step, setStep] = useState<BuildStep>('preset')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const index = STEPS.findIndex(item => item.id === step)
  const problems = useMemo(() => agentDefinitionProblems(toDefinition(draft), new Set(catalog.map(entry => entry.id))), [draft, catalog])
  const stepProblem = problems.find(problem => problem.field === (step === 'profile' ? 'name' : step === 'tools' ? 'tools' : step === 'blocks' ? 'blocks' : 'basePreset'))
  const publish = async () => {
    setBusy(true); setError(undefined)
    try { await onPublished(await client.save(workbenchId, draft)) }
    catch (cause) { setError(cause instanceof Error ? cause.message : '保存失败。') }
    finally { setBusy(false) }
  }
  return <section className={css.panel}>
    <ol className={css.steps}>{STEPS.map((item, position) => <li key={item.id}><button type="button" className={position === index ? css.stepActive : css.step} aria-current={position === index ? 'step' : undefined} onClick={() => setStep(item.id)}>{position + 1}. {item.label}</button></li>)}</ol>
    {step === 'preset' ? <PresetStep draft={draft} onChange={onChange} /> : null}
    {step === 'blocks' ? <BlockStep draft={draft} onChange={onChange} /> : null}
    {step === 'tools' ? <ToolStep draft={draft} catalog={catalog} onChange={onChange} /> : null}
    {step === 'profile' ? <ProfileStep draft={draft} existing={existing} onChange={onChange} /> : null}
    {stepProblem === undefined && error === undefined ? null : <div className={css.error} role="alert">{error ?? stepProblem?.message}</div>}
    <div className={css.builderActions}>
      <button type="button" className={css.secondary} onClick={onCancel}>返回列表</button>
      {index > 0 ? <button type="button" className={css.secondary} onClick={() => setStep(STEPS[index - 1]!.id)}>上一步</button> : null}
      {index < STEPS.length - 1
        ? <button type="button" className={css.primary} onClick={() => setStep(STEPS[index + 1]!.id)}>下一步</button>
        : <button type="button" className={css.primary} disabled={busy || problems.length > 0} onClick={() => void publish()}>{busy ? '保存中' : existing ? '保存新修订' : '保存修订'}</button>}
    </div>
  </section>
}

function PresetStep({ draft, onChange }: { draft: AgentAssemblyDraftV1; onChange: (draft: AgentAssemblyDraftV1) => void }) {
  return <div className={css.choiceList}>{agentBasePresets().map(preset => <label key={preset.id} className={draft.basePreset === preset.id ? css.choiceActive : css.choice}><input type="radio" name="base-preset" checked={draft.basePreset === preset.id} onChange={() => onChange({ ...draft, basePreset: preset.id, blocks: [...defaultBlocksFor(preset.id)] })} /><span><strong>{preset.label}</strong><small>{preset.description}</small></span></label>)}</div>
}

function BlockStep({ draft, onChange }: { draft: AgentAssemblyDraftV1; onChange: (draft: AgentAssemblyDraftV1) => void }) {
  const blocks = blocksForBase(draft.basePreset)
  if (blocks.length === 0) return <div className={css.empty}><strong>精简模式没有可选积木</strong><p>它只带身份提示词和图片读取，适合问答类助手。</p></div>
  const toggle = (id: string) => onChange({ ...draft, blocks: draft.blocks.includes(id) ? draft.blocks.filter(block => block !== id) : [...draft.blocks, id] })
  return <div className={css.choiceList}>{blocks.map(block => <label key={block.id} className={draft.blocks.includes(block.id) ? css.choiceActive : css.choice}><input type="checkbox" checked={draft.blocks.includes(block.id)} onChange={() => toggle(block.id)} /><span><strong>{block.label}</strong><small>{block.description}</small></span></label>)}</div>
}

function ToolStep({ draft, catalog, onChange }: { draft: AgentAssemblyDraftV1; catalog: readonly ToolCatalogEntryV1[]; onChange: (draft: AgentAssemblyDraftV1) => void }) {
  // AgentKit mounts native Tool and Skill executors. MCP and CLI entries remain
  // available in the Gateway page, but selecting them here would create a
  // definition that no AgentKit binder can execute.
  const enabled = catalog.filter(entry => entry.visibility === 'enabled' && (entry.kind === 'tool' || entry.kind === 'skill'))
  if (enabled.length === 0) return <div className={css.empty}><strong>工具目录里没有已启用的 Agent 工具</strong><p>先到「工具集成」页启用扩展公开的 Tool 或 Skill，再回来勾选。MCP 和 CLI 仍在工具集成页管理。</p></div>
  const toggle = (entry: ToolCatalogEntryV1) => {
    const tools = draft.tools.includes(entry.id) ? draft.tools.filter(id => id !== entry.id) : [...draft.tools, entry.id]
    const skills = entry.kind === 'skill' ? (draft.skills.includes(entry.id) ? draft.skills.filter(id => id !== entry.id) : [...draft.skills, entry.id]) : draft.skills
    onChange({ ...draft, tools, skills })
  }
  return <div className={css.choiceList}>{enabled.map(entry => <label key={entry.id} className={draft.tools.includes(entry.id) ? css.choiceActive : css.choice}><input type="checkbox" checked={draft.tools.includes(entry.id)} onChange={() => toggle(entry)} /><span><strong>{entry.display.name}</strong><small>{entry.id} · {entry.kind}{entry.display.description === undefined ? '' : ` · ${entry.display.description}`}</small></span></label>)}</div>
}

function ProfileStep({ draft, existing, onChange }: { draft: AgentAssemblyDraftV1; existing: boolean; onChange: (draft: AgentAssemblyDraftV1) => void }) {
  return <div className={css.form}>
    <label className={css.field}><span>标识</span><input value={draft.agentId} disabled={existing} placeholder="例如 quote-assistant" onChange={event => onChange({ ...draft, agentId: event.target.value.trim() })} /><small>小写字母开头，发布后不能改。</small></label>
    <label className={css.field}><span>名称</span><input value={draft.name} maxLength={80} onChange={event => onChange({ ...draft, name: event.target.value })} /></label>
    <label className={css.field}><span>描述</span><textarea value={draft.description} maxLength={400} rows={3} onChange={event => onChange({ ...draft, description: event.target.value })} /><small>Bay Agent 派活时靠这段描述选择模式。</small></label>
    <label className={css.field}><span>模式指令</span><textarea value={draft.instructions ?? ''} maxLength={AGENT_INSTRUCTION_LIMIT} rows={5} placeholder="这个 Agent 的工作方式、步骤和不要做的事。" onChange={event => { const { instructions: _drop, ...rest } = draft; onChange(event.target.value ? { ...rest, instructions: event.target.value } : rest) }} /></label>
    <fieldset className={css.guest}><legend>访客可用范围</legend><div className={css.choiceList}>{GUEST_OPTIONS.map(option => <label key={option.id} className={draft.guestAccess === option.id ? css.choiceActive : css.choice}><input type="radio" name="guest-access" checked={draft.guestAccess === option.id} onChange={() => onChange({ ...draft, guestAccess: option.id })} /><span><strong>{option.label}</strong><small>{option.description}</small></span></label>)}</div></fieldset>
  </div>
}

function toDefinition(draft: AgentAssemblyDraftV1): WorkbenchAgentDefinitionV1 {
  return { schemaVersion: 1, agentId: draft.agentId, name: draft.name, description: draft.description, basePreset: draft.basePreset, tools: draft.tools, skills: draft.skills, blocks: draft.blocks, ...(draft.instructions === undefined ? {} : { instructions: draft.instructions }), guestAccess: draft.guestAccess, revision: 1, origin: { kind: 'manual' }, updatedAt: new Date(0).toISOString() }
}
