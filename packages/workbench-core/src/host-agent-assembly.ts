/**
 * Host store for manually assembled agents.
 *
 * Every revision is its own file under `<workbench>/.bay/agents/<agentId>@<revision>.json`.
 * Saving writes the next revision and registers nothing. A person picks which
 * revision is the live DSH mode; registration is memory-only, so the selection
 * is stored beside the definitions and replayed before session recovery.
 *
 * A revision registers only when every selected tool and skill has a Host
 * executor in `HostAgentKit`. Imports never register: they record the
 * source's choice in `suggested.json`, and the receiving person decides.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import type { AgentPresetRegistry } from '@deepseek-ai/dsh-agent-preset-registry'
import type { HostWorkbenchDirectory } from './host-workbench-directory.ts'
import { agentDefinitionProblems, parseAgentDefinition, parseRevisionFileName, presetIdFor, validatePortableAgents, type AgentAssemblyRegistrationV1, type AgentImportSourceV1, type PortableAgentAssemblyV1, type WorkbenchAgentDefinitionV1 } from './agent-assembly-model.ts'
import { composeAgentPreset } from './host-agent-preset.ts'
import type { HostAgentKit } from './host-agent-kit.ts'

export interface AgentAssemblySaveInputV1 {
  readonly workbenchId: string
  readonly agentId: string
  readonly name: string
  readonly description: string
  readonly basePreset: WorkbenchAgentDefinitionV1['basePreset']
  readonly tools: readonly string[]
  readonly skills: readonly string[]
  readonly blocks: readonly string[]
  readonly instructions?: string
  readonly guestAccess: WorkbenchAgentDefinitionV1['guestAccess']
}

/** A session or task that still names a preset, used to warn before unregistering. */
export interface AgentAssemblySessionUseV1 { readonly sessionKey: string; readonly title: string; readonly role: string }

interface RevisionRef { readonly agentId: string; readonly revision: number }
interface AgentAssemblySelectionV1 { readonly schemaVersion: 1; readonly registered: readonly RevisionRef[] }
interface AgentAssemblySuggestionV1 { readonly schemaVersion: 1; readonly source: AgentImportSourceV1; readonly registered: readonly RevisionRef[] }
const SOURCES: readonly AgentImportSourceV1[] = ['complete', 'template-signed', 'template-unsigned']

export class HostAgentAssemblyStore {
  private readonly registered = new Map<string, () => Promise<void>>()
  private readonly rows = new Map<string, AgentAssemblyRegistrationV1>()
  /** Selection and the in-memory DSH registry must change as one operation per workbench. */
  private readonly mutationTails = new Map<string, Promise<void>>()
  /** Sessions and tasks that name a preset. The service wires this in once both stores exist. */
  sessionsUsing: (workbenchId: string, presetId: string) => readonly AgentAssemblySessionUseV1[] = () => []

  constructor(
    private readonly directory: HostWorkbenchDirectory,
    private readonly presets: Pick<AgentPresetRegistry, 'register'>,
    private readonly kit?: Pick<HostAgentKit, 'missing'>,
  ) {}

  /** The registered revision behind a preset id, for the agent kit binder. */
  binding(presetId: string): { workbenchId: string; definition: WorkbenchAgentDefinitionV1 } | undefined {
    const row = this.rows.get(presetId)
    return row?.status === 'registered' && this.registered.has(presetId) ? { workbenchId: row.workbenchId, definition: row.definition } : undefined
  }

  /** Re-derive availability after extensions come or go without changing disk selection. */
  async refreshAvailability(): Promise<void> {
    const workbenchIds = [...new Set([...this.rows.values()].map(row => row.workbenchId))]
    await Promise.all(workbenchIds.map(workbenchId => this.serial(workbenchId, async () => {
      for (const row of [...this.rows.values()].filter(item => item.workbenchId === workbenchId)) {
        const missing = this.missing(row.definition)
        if (row.status === 'registered' && missing.length > 0) {
          const dispose = this.registered.get(row.presetId)
          if (dispose !== undefined) {
            await dispose()
            this.registered.delete(row.presetId)
          }
          this.remember(row.workbenchId, row.definition, 'saved')
        } else if (row.status !== 'registered') this.remember(row.workbenchId, row.definition, 'saved')
      }
    })))
  }

  /** Remove in-memory presets after the directory permanently drops a workbench. */
  async pruneDeletedWorkbenches(): Promise<void> {
    const active = new Set(Object.keys(this.directory.getSnapshot().value.workbenches))
    const stale = new Set<string>()
    for (const row of this.rows.values()) if (!active.has(row.workbenchId)) stale.add(row.workbenchId)
    for (const presetId of this.registered.keys()) {
      const workbenchId = presetId.match(/^bay:([^:]+):/u)?.[1]
      if (workbenchId !== undefined && !active.has(workbenchId)) stale.add(workbenchId)
    }
    await Promise.all([...stale].map(workbenchId => this.serial(workbenchId, async () => {
      for (const [presetId, dispose] of [...this.registered.entries()]) {
        if (!presetId.startsWith(`bay:${workbenchId}:`)) continue
        await dispose()
        this.registered.delete(presetId)
      }
      for (const [presetId, row] of [...this.rows.entries()]) if (row.workbenchId === workbenchId) this.rows.delete(presetId)
    })))
  }

  list(workbenchId: string): readonly AgentAssemblyRegistrationV1[] {
    return [...this.rows.values()]
      .filter(row => row.workbenchId === workbenchId)
      .sort((left, right) => left.definition.name.localeCompare(right.definition.name) || left.definition.agentId.localeCompare(right.definition.agentId) || right.definition.revision - left.definition.revision)
  }

  /**
   * Whether Bay Agent may offer this preset inside one workbench. DSH presets
   * stay visible; assembled agents only show inside their own workbench, only
   * while registered, and never to a guest when `guestAccess` is `none`.
   */
  offers(workbenchId: string, presetId: string, guest: boolean): boolean {
    if (!presetId.startsWith('bay:')) return true
    const row = this.rows.get(presetId)
    if (!row || row.workbenchId !== workbenchId || row.status !== 'registered') return false
    return !guest || row.definition.guestAccess !== 'none'
  }

  /** Read every workbench and register only the revisions a person selected. */
  async restore(): Promise<readonly AgentAssemblyRegistrationV1[]> {
    await this.pruneDeletedWorkbenches()
    for (const workbenchId of Object.keys(this.directory.getSnapshot().value.workbenches).sort()) await this.restoreWorkbench(workbenchId)
    return [...this.rows.values()]
  }

  /** Replay one workbench's selection. Imports call this right after publication, so no restart is needed. */
  async restoreWorkbench(workbenchId: string): Promise<readonly AgentAssemblyRegistrationV1[]> {
    return this.serial(workbenchId, () => this.restoreWorkbenchNow(workbenchId))
  }

  private async restoreWorkbenchNow(workbenchId: string): Promise<readonly AgentAssemblyRegistrationV1[]> {
    const selected = new Set(this.readSelection(workbenchId).map(row => presetIdFor(workbenchId, row)))
    for (const definition of this.readAll(workbenchId)) {
      const presetId = presetIdFor(workbenchId, definition)
      if (selected.has(presetId) && this.missing(definition).length === 0) {
        try { await this.register(workbenchId, definition) } catch (error) { this.remember(workbenchId, definition, 'saved', error instanceof Error ? error.message : String(error)) }
      } else if (!this.registered.has(presetId)) this.remember(workbenchId, definition, 'saved')
    }
    return this.list(workbenchId)
  }

  /** Every saved revision and the current registration choice, for a template package. */
  portable(workbenchId: string): PortableAgentAssemblyV1 {
    const definitions = this.readAll(workbenchId)
    const known = new Set(definitions.map(row => `${row.agentId}@${row.revision}`))
    return { definitions, registered: this.readSelection(workbenchId).filter(row => known.has(`${row.agentId}@${row.revision}`)).map(row => ({ agentId: row.agentId, revision: row.revision })) }
  }

  /**
   * Write agents carried by a template package into a freshly created
   * workbench. Existing revisions are never overwritten, so a retry is safe.
   * Nothing registers: the source's choice becomes a suggestion.
   */
  async importPortable(workbenchId: string, agents: PortableAgentAssemblyV1, source: Exclude<AgentImportSourceV1, 'complete'>): Promise<readonly AgentAssemblyRegistrationV1[]> {
    return this.serial(workbenchId, async () => {
      validatePortableAgents(agents)
      const existing = new Set(this.readAll(workbenchId).map(row => `${row.agentId}@${row.revision}`))
      for (const definition of agents.definitions) {
        if (existing.has(`${definition.agentId}@${definition.revision}`)) continue
        await this.directory.writeAgentDefinition(workbenchId, definition.agentId, definition.revision, definition)
      }
      await this.suggest(workbenchId, source, agents.registered)
      return this.restoreWorkbenchNow(workbenchId)
    })
  }

  /**
   * A complete package copied the source's `selection.json`. Turn it into a
   * suggestion before anything reads it, so the receiving person decides.
   */
  async adoptCopiedSelection(workbenchId: string): Promise<void> {
    await this.serial(workbenchId, async () => {
      const root = this.rootOf(workbenchId)
      if (!root || !existsSync(path.join(root, '.bay', 'agents', 'selection.json'))) return
      await this.suggest(workbenchId, 'complete', this.readSelection(workbenchId))
      await this.directory.writeAgentSelection(workbenchId, { schemaVersion: 1, registered: [] } satisfies AgentAssemblySelectionV1)
    })
  }

  private async suggest(workbenchId: string, source: AgentImportSourceV1, registered: readonly RevisionRef[]) {
    const unique = [...new Map(registered.map(row => [`${row.agentId}@${row.revision}`, { agentId: row.agentId, revision: row.revision }])).values()]
    await this.directory.writeAgentSuggestion(workbenchId, { schemaVersion: 1, source, registered: unique } satisfies AgentAssemblySuggestionV1)
  }

  /** Write the next revision. The previous live revision stays registered until a person changes it. */
  async save(input: AgentAssemblySaveInputV1): Promise<AgentAssemblyRegistrationV1> {
    const definition: WorkbenchAgentDefinitionV1 = {
      schemaVersion: 1,
      agentId: input.agentId,
      name: input.name.trim(),
      description: input.description.trim(),
      basePreset: input.basePreset,
      tools: [...new Set(input.tools)].sort(),
      skills: [...new Set(input.skills)].sort(),
      blocks: [...new Set(input.blocks)],
      ...(input.instructions?.trim() ? { instructions: input.instructions.trim() } : {}),
      guestAccess: input.guestAccess,
      revision: this.nextRevision(input.workbenchId, input.agentId),
      origin: { kind: 'manual' },
      updatedAt: new Date().toISOString(),
    }
    // A revision may be saved before its extensions are installed; registering it may not.
    const problems = agentDefinitionProblems(definition, new Set(definition.tools))
    if (problems.length > 0) throw new Error(problems[0]!.message)
    await this.directory.writeAgentDefinition(input.workbenchId, definition.agentId, definition.revision, definition)
    return this.remember(input.workbenchId, definition, 'saved')
  }

  /** Make one saved revision the live DSH mode. Other revisions of the same agent stay saved. */
  async registerRevision(workbenchId: string, agentId: string, revision: number): Promise<AgentAssemblyRegistrationV1> {
    return this.serial(workbenchId, async () => {
      const definition = this.definition(workbenchId, agentId, revision)
      const missing = this.missing(definition)
      if (missing.length > 0) throw new Error(`这个修订缺少扩展提供的工具或 Skill，不能注册：${missing.join('、')}`)
      const row = await this.register(workbenchId, definition)
      await this.writeSelection(workbenchId)
      return row
    })
  }

  /**
   * Drop one revision from the DSH roster. Sessions that still name it are
   * reported so the caller can warn; the file stays, so the choice is reversible.
   */
  async unregisterRevision(workbenchId: string, agentId: string, revision: number): Promise<{ row: AgentAssemblyRegistrationV1; sessions: readonly AgentAssemblySessionUseV1[] }> {
    return this.serial(workbenchId, async () => {
      const definition = this.definition(workbenchId, agentId, revision)
      const presetId = presetIdFor(workbenchId, definition)
      const sessions = this.sessionsUsing(workbenchId, presetId)
      const dispose = this.registered.get(presetId)
      if (dispose) { await dispose(); this.registered.delete(presetId) }
      const row = this.remember(workbenchId, definition, 'saved')
      await this.writeSelection(workbenchId)
      return { row, sessions }
    })
  }

  private definition(workbenchId: string, agentId: string, revision: number): WorkbenchAgentDefinitionV1 {
    const found = this.readAll(workbenchId).find(row => row.agentId === agentId && row.revision === revision)
    if (!found) throw new Error('这个修订不存在。')
    return found
  }

  private nextRevision(workbenchId: string, agentId: string): number {
    return this.readAll(workbenchId).filter(row => row.agentId === agentId).reduce((max, row) => Math.max(max, row.revision), 0) + 1
  }

  private rootOf(workbenchId: string): string | undefined {
    try { return this.directory.rootPath(workbenchId) } catch { return undefined }
  }

  private serial<T>(workbenchId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.mutationTails.get(workbenchId) ?? Promise.resolve()
    const run = previous.then(operation, operation)
    const tail = run.then(() => undefined, () => undefined)
    this.mutationTails.set(workbenchId, tail)
    return run.finally(() => { if (this.mutationTails.get(workbenchId) === tail) this.mutationTails.delete(workbenchId) })
  }

  /** Without a kit every selected tool counts as missing: nothing executes it. */
  private missing(definition: WorkbenchAgentDefinitionV1): readonly string[] {
    return this.kit ? this.kit.missing(definition) : [...new Set([...definition.tools, ...definition.skills])]
  }

  private readSuggestion(workbenchId: string): AgentAssemblySuggestionV1 | undefined {
    const root = this.rootOf(workbenchId)
    const file = root && path.join(root, '.bay', 'agents', 'suggested.json')
    if (!file || !existsSync(file)) return undefined
    try {
      const value = JSON.parse(readFileSync(file, 'utf8')) as Partial<AgentAssemblySuggestionV1>
      if (value.schemaVersion !== 1 || !SOURCES.includes(value.source as AgentImportSourceV1) || !Array.isArray(value.registered)) return undefined
      return { schemaVersion: 1, source: value.source as AgentImportSourceV1, registered: value.registered.filter(row => typeof row?.agentId === 'string' && Number.isInteger(row.revision)) }
    } catch { return undefined }
  }

  private readAll(workbenchId: string): WorkbenchAgentDefinitionV1[] {
    const root = this.rootOf(workbenchId)
    if (!root) return []
    const folder = path.join(root, '.bay', 'agents')
    if (!existsSync(folder)) return []
    const seen = new Set<string>()
    return readdirSync(folder)
      .sort()
      .flatMap(name => {
        const parsed = parseRevisionFileName(name)
        if (!parsed) return []
        let definition: WorkbenchAgentDefinitionV1
        try { definition = parseAgentDefinition(JSON.parse(readFileSync(path.join(folder, name), 'utf8'))) }
        catch { return [] }
        // The file name wins over a stale copy inside the file, so a renamed import cannot register the old id.
        if (definition.agentId !== parsed.agentId || (parsed.revision !== undefined && definition.revision !== parsed.revision)) return []
        const key = `${definition.agentId}@${definition.revision}`
        if (seen.has(key)) return []
        seen.add(key)
        return [definition]
      })
  }

  private readSelection(workbenchId: string): readonly RevisionRef[] {
    const root = this.rootOf(workbenchId)
    if (!root) return []
    const file = path.join(root, '.bay', 'agents', 'selection.json')
    if (!existsSync(file)) return []
    try {
      const value = JSON.parse(readFileSync(file, 'utf8')) as Partial<AgentAssemblySelectionV1>
      return Array.isArray(value.registered) ? value.registered.filter(row => typeof row?.agentId === 'string' && Number.isInteger(row.revision)) : []
    } catch { return [] }
  }

  private async writeSelection(workbenchId: string): Promise<void> {
    const registered = this.list(workbenchId)
      .filter(row => row.status === 'registered')
      .map(row => ({ agentId: row.definition.agentId, revision: row.definition.revision }))
    await this.directory.writeAgentSelection(workbenchId, { schemaVersion: 1, registered } satisfies AgentAssemblySelectionV1)
  }

  private remember(workbenchId: string, definition: WorkbenchAgentDefinitionV1, status: 'saved' | 'registered', reason?: string): AgentAssemblyRegistrationV1 {
    const presetId = presetIdFor(workbenchId, definition)
    const missing = this.missing(definition)
    const suggestion = this.readSuggestion(workbenchId)
    const suggested = suggestion?.registered.some(row => row.agentId === definition.agentId && row.revision === definition.revision) ? suggestion.source : undefined
    const row: AgentAssemblyRegistrationV1 = { workbenchId, definition, presetId,
      status: status === 'registered' ? 'registered' : missing.length > 0 ? 'unavailable' : 'saved',
      ...(reason === undefined ? {} : { reason }),
      ...(missing.length === 0 ? {} : { missing }),
      ...(suggested === undefined ? {} : { suggested }) }
    this.rows.set(presetId, row)
    return row
  }

  private async register(workbenchId: string, definition: WorkbenchAgentDefinitionV1): Promise<AgentAssemblyRegistrationV1> {
    const presetId = presetIdFor(workbenchId, definition)
    if (!this.registered.has(presetId)) {
      const dispose = await this.presets.register(composeAgentPreset(workbenchId, definition))
      this.registered.set(presetId, dispose)
    }
    return this.remember(workbenchId, definition, 'registered')
  }

  async dispose(): Promise<void> {
    await Promise.all([...this.mutationTails.values()])
    for (const dispose of this.registered.values()) await dispose()
    this.registered.clear()
    this.rows.clear()
  }
}
