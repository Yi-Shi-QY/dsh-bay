import { browserSafeUuid } from '../browser-safe-id.ts'
import { areasOf, normalizeWorkbenchDocument, type AreaNode, type ModuleInstanceDocument, type WorkbenchNodeV3 } from './document-v3.ts'
import type { SessionBindingV1 } from './model.ts'
import { sessionTargetKey } from './model.ts'
import {
  areaContextOf, createAreaContext, patchAreaContext, patchWorkbenchContext,
  workbenchContextOf, type AreaContextV1, type ContextPatchOptions, type ContextPatchResult,
  type WorkbenchContextSection, type WorkbenchContextV1, type WorkbenchContextWriter,
} from './workbench-context.ts'
import type { WorkbenchAreaOwnershipV1, WorkbenchRecordV2, WorkbenchSettingsV4 } from './persistence.ts'
import { workbenchAreas, showWorkbenchArea } from './area-identity.ts'

export const WORKBENCH_CONTROL_PLANE_SERVICE_NAME = 'workbenchControlPlane'

/** The small Settings seam required by the Control Plane. */
export interface WorkbenchControlPlaneSettings {
  getSnapshot(): {
    status: 'loading' | 'ready' | 'unavailable'
    value: WorkbenchSettingsV4 | undefined
    revision: number | undefined
    writable: boolean
  }
  patch(operation: {
    operation: 'set'
    path: readonly string[]
    value: unknown
    expectedRevision?: number
  }): Promise<{
    status: 'committed' | 'conflict' | 'unavailable'
    revision?: number
    expectedRevision?: number
    actualRevision?: number
  }>
}

export interface WorkbenchControlPlaneEditorV1 {
  id: string
  scope: 'root' | 'session'
  label?: string
}

export interface WorkbenchControlPlaneOptions {
  settings: WorkbenchControlPlaneSettings
  editors?: { getSnapshot(): readonly WorkbenchControlPlaneEditorV1[] }
  createSession?: (input: { workbenchId?: string; areaId?: string; workspaceId?: string; agentPreset?: string; title?: string; requestId: string }) => Promise<{
    target: SessionBindingV1
    reusedBlank?: boolean
  }>
  now?: () => number
  createId?: (kind: string) => string
}

/** Bay Agent is the Workbench-owned control actor. `superagent` is a legacy
 * alias accepted for early alpha clients and is never used as a new default. */
export type WorkbenchControlPlaneActor = 'human' | 'bay-agent' | 'superagent'

export interface WorkbenchControlPlaneModuleV1 {
  moduleInstanceId: string
  editorId: string
  scope: 'root' | 'session'
  title: string
  available: boolean
  binding?: SessionBindingV1
}

export interface WorkbenchBayAgentSessionV1 {
  sessionId: string
  workspaceId?: string
  createdAt: number
  updatedAt: number
}

export interface WorkbenchControlPlaneAreaV1 {
  visible?: boolean
  project?: import('../workbench-directory-contract.ts').AreaProjectV1
  areaId: string
  label: string
  ownership: WorkbenchAreaOwnershipV1
  active: boolean
  archived: boolean
  /** Project generation; unrelated to active view or conversation count. */
  generation: number
  context: AreaContextV1
  binding?: SessionBindingV1
  modules: readonly WorkbenchControlPlaneModuleV1[]
}

export interface WorkbenchControlPlaneSnapshotV1 {
  version: 1
  sourceRevision?: number
  workbenchId: string
  name: string
  description: string
  context: WorkbenchContextV1
  bayAgentSession?: WorkbenchBayAgentSessionV1
  areas: readonly WorkbenchControlPlaneAreaV1[]
  sessions?: readonly (import('../workbench-directory-contract.ts').WorkbenchSessionEntryV1 & { sessionId: string; workspaceId?: string })[]
}

export type WorkbenchControlPlaneReadContext =
  | { scope: 'workbench'; workbenchId?: string }
  | { scope: 'area'; workbenchId?: string; areaId: string }

export type WorkbenchControlPlaneWriteResult<T> =
  | { status: 'committed'; value: T; settingsRevision: number }
  | { status: 'conflict'; source: 'context' | 'settings'; value?: T; currentSettingsRevision?: number }
  | { status: 'rejected'; reason: WorkbenchControlPlaneRejectionReason }
  | { status: 'unavailable' }

export type WorkbenchControlPlaneRejectionReason =
  | 'workbench-not-found'
  | 'area-not-found'
  | 'workbench-archived'
  | 'area-archived'
  | 'ownership-not-permitted'
  | 'session-service-unavailable'
  | 'editor-not-found'
  | 'editor-scope-mismatch'
  | 'session-binding-required'
  | 'area-already-bound'
  | 'invalid-input'
  | 'context-rejected'

export interface CreateAreaInputV1 {
  workbenchId?: string
  label?: string
  objective?: string
  ownership?: WorkbenchAreaOwnershipV1
  actor?: WorkbenchControlPlaneActor
  requestId?: string
}

export interface CreateAreaResultV1 {
  areaId: string
  ownership: WorkbenchAreaOwnershipV1
  settingsRevision: number
}

export interface CreateSessionInputV1 {
  title?: string
  /** Add a separate conversation without rebinding existing modules. */
  append?: boolean
  workbenchId?: string
  areaId: string
  workspaceId?: string
  agentPreset?: string
  requestId: string
  actor?: WorkbenchControlPlaneActor
}

export interface CreateSessionResultV1 {
  moduleInstanceId: string
  target: SessionBindingV1
  reusedBlank: boolean
  settingsRevision: number
}

export interface EnsureEditorInputV1 {
  sessionId?: string
  workbenchId?: string
  areaId: string
  editorId: string
  requestId?: string
  actor?: WorkbenchControlPlaneActor
}

export interface EnsureEditorResultV1 {
  areaId: string
  moduleInstanceId: string
  settingsRevision: number
}

/**
 * Semantic Workbench operations used by Bay Agent and future UI surfaces.
 * Every durable mutation is committed through the Settings CAS seam; this
 * class never edits the React Frame or the native plugin registry directly.
 */
export class WorkbenchControlPlane {
  private readonly now: () => number
  private readonly createId: (kind: string) => string
  private readonly idempotent = new Map<string, unknown>()
  readonly context = {
    read: (input: WorkbenchControlPlaneReadContext) => this.readContext(input),
    patch: (input: Parameters<WorkbenchControlPlane['patchContext']>[0]) => this.patchContext(input),
  }

  constructor(private readonly options: WorkbenchControlPlaneOptions) {
    this.now = options.now ?? (() => Date.now())
    this.createId = options.createId ?? (kind => `${kind}-${browserSafeUuid()}`)
  }

  inspect(workbenchId?: string): WorkbenchControlPlaneSnapshotV1 {
    const { snapshot, record } = this.readRecord(workbenchId)
    return {
      version: 1,
      ...(snapshot.revision === undefined ? {} : { sourceRevision: snapshot.revision }),
      workbenchId: record.workbenchId,
      name: record.name,
      description: record.description,
      context: workbenchContextOf(record.context),
      ...(record.bayAgentSession === undefined ? {} : { bayAgentSession: structuredClone(record.bayAgentSession) }),
      areas: workbenchAreas(record).map(area => this.projectArea(record, area)),
      ...(record.sessionCatalog === undefined ? {} : { sessions: Object.values(record.sessionCatalog).map(entry => ({ ...entry, sessionId: entry.sessionId ?? entry.sessionKey,
        ...(entry.areaId && record.areaProjects?.[entry.areaId]?.workspaceId ? { workspaceId: record.areaProjects[entry.areaId]!.workspaceId! } : {}) })) }),
    }
  }

  getArea(areaId: string, workbenchId?: string): WorkbenchControlPlaneAreaV1 {
    const area = this.inspect(workbenchId).areas.find(row => row.areaId === areaId)
    if (area === undefined) throw controlPlaneError('area-not-found', `Unknown Area ${areaId}`)
    return area
  }

  listAreas(workbenchId?: string): readonly WorkbenchControlPlaneAreaV1[] {
    return this.inspect(workbenchId).areas
  }

  readContext(input: WorkbenchControlPlaneReadContext): WorkbenchContextV1 | AreaContextV1 {
    const { record } = this.readRecord(input.workbenchId)
    if (input.scope === 'workbench') return workbenchContextOf(record.context)
    if (!workbenchAreas(record).some(area => area.areaId === input.areaId)) {
      throw controlPlaneError('area-not-found', `Unknown Area ${input.areaId}`)
    }
    return areaContextOf(record.areaContexts?.[input.areaId])
  }

  async patchContext(input: {
    scope: 'workbench' | 'area'
    workbenchId?: string
    areaId?: string
    writer: WorkbenchContextWriter
    section: WorkbenchContextSection
    expectedRevision: number
    patch: Record<string, unknown>
  }): Promise<WorkbenchControlPlaneWriteResult<WorkbenchContextV1 | AreaContextV1>> {
    const read = this.tryReadWritableRecord(input.workbenchId)
    if (read.status !== 'ready') return read.result
    const { snapshot, record } = read
    if (record.archivedAt !== undefined) return { status: 'rejected', reason: 'workbench-archived' }
    if (input.scope === 'workbench') {
      const source = workbenchContextOf(record.context)
      const result = input.section === 'human'
        ? patchWorkbenchContext(source, this.contextOptions<'human'>(input))
        : patchWorkbenchContext(source, this.contextOptions<'agent'>(input))
      if (result.status !== 'committed') return contextWriteFailure(result)
      const saved = await this.commitRecord(snapshot.revision, record, { ...record, context: result.context })
      return saved.status === 'committed'
        ? { status: 'committed', value: result.context, settingsRevision: saved.revision }
        : saved.status === 'conflict'
          ? settingsConflict(saved.actualRevision)
          : saved
    }
    if (input.areaId === undefined) return { status: 'rejected', reason: 'invalid-input' }
    const area = workbenchAreas(record).find(candidate => candidate.areaId === input.areaId)
    if (area === undefined) return { status: 'rejected', reason: 'area-not-found' }
    const source = areaContextOf(record.areaContexts?.[input.areaId])
    const result = input.section === 'human'
      ? patchAreaContext(source, this.contextOptions<'human'>(input))
      : patchAreaContext(source, this.contextOptions<'agent'>(input))
    if (result.status !== 'committed') return contextWriteFailure(result)
    const saved = await this.commitRecord(snapshot.revision, record, {
      ...record,
      areaContexts: { ...(record.areaContexts ?? {}), [input.areaId]: result.context },
    })
    return saved.status === 'committed'
      ? { status: 'committed', value: result.context, settingsRevision: saved.revision }
      : saved.status === 'conflict'
        ? settingsConflict(saved.actualRevision)
        : saved
  }

  async createArea(input: CreateAreaInputV1 = {}): Promise<WorkbenchControlPlaneWriteResult<CreateAreaResultV1>> {
    const actor = input.actor ?? 'bay-agent'
    const ownership = input.ownership ?? (isBayAgentActor(actor) ? 'bay-agent-managed' : 'user-owned')
    if (isBayAgentActor(actor) && ownership !== 'bay-agent-managed' && ownership !== 'superagent-managed') {
      return { status: 'rejected', reason: 'ownership-not-permitted' }
    }
    const requestKey = input.requestId === undefined ? undefined : `create-area:${input.workbenchId ?? ''}:${input.requestId}`
    const previous = requestKey === undefined ? undefined : this.idempotent.get(requestKey)
    if (previous !== undefined) return structuredClone(previous) as WorkbenchControlPlaneWriteResult<CreateAreaResultV1>
    const read = this.tryReadWritableRecord(input.workbenchId)
    if (read.status !== 'ready') return read.result
    const { snapshot, record } = read
    if (record.archivedAt !== undefined) return { status: 'rejected', reason: 'workbench-archived' }
    const areaId = this.createId('area')
    const splitId = this.createId('split')
    const area: AreaNode = { kind: 'area', areaId, moduleHistory: [] }
    const next: WorkbenchRecordV2 = {
      ...record,
      document: normalizeWorkbenchDocument({
        version: 3,
        root: { kind: 'split', id: splitId, axis: 'horizontal', ratio: 0.5, first: record.document.root, second: area },
        activeAreaId: areaId,
      }),
      areaContexts: {
        ...(record.areaContexts ?? {}),
        [areaId]: areaContextWithObjective(input.objective),
      },
      areaMetadata: {
        ...(record.areaMetadata ?? {}),
        [areaId]: {
          label: boundedText(input.label, `Area ${areasOf(record.document.root).length + 1}`),
          ownership,
          createdAt: this.now(),
          updatedAt: this.now(),
        },
      },
    }
    const saved = await this.commitRecord(snapshot.revision, record, next)
    if (saved.status !== 'committed') {
      return saved.status === 'conflict'
        ? settingsConflict(saved.actualRevision)
        : saved
    }
    const result: WorkbenchControlPlaneWriteResult<CreateAreaResultV1> = {
      status: 'committed', value: { areaId, ownership, settingsRevision: saved.revision }, settingsRevision: saved.revision,
    }
    if (requestKey !== undefined) this.idempotent.set(requestKey, result)
    return result
  }

  async createSession(input: CreateSessionInputV1): Promise<WorkbenchControlPlaneWriteResult<CreateSessionResultV1>> {
    const actor = input.actor ?? 'bay-agent'
    const requestKey = `create-session:${input.workbenchId ?? ''}:${input.areaId}:${input.requestId}`
    const previous = this.idempotent.get(requestKey)
    if (previous !== undefined) return structuredClone(previous) as WorkbenchControlPlaneWriteResult<CreateSessionResultV1>
    if (this.options.createSession === undefined) return { status: 'rejected', reason: 'session-service-unavailable' }
    const read = this.tryReadWritableRecord(input.workbenchId)
    if (read.status !== 'ready') return read.result
    const { snapshot, record } = read
    if (record.archivedAt !== undefined) return { status: 'rejected', reason: 'workbench-archived' }
    const area = workbenchAreas(record).find(candidate => candidate.areaId === input.areaId)
    if (area === undefined) return { status: 'rejected', reason: 'area-not-found' }
    const metadata = record.areaMetadata?.[input.areaId]
    const ownership = metadata?.ownership ?? 'user-owned'
    if (!input.append && !canManageArea(actor, ownership)) return { status: 'rejected', reason: 'ownership-not-permitted' }
    if (ownership === 'archived') return { status: 'rejected', reason: 'area-archived' }
    const project = record.areaProjects?.[input.areaId]
    if (record.fileWorkbench && !project?.workspaceId) return { status: 'rejected', reason: 'session-binding-required' }
    if (project?.workspaceId && input.workspaceId && project.workspaceId !== input.workspaceId) return { status: 'rejected', reason: 'invalid-input' }
    const connection = await this.options.createSession({
      workbenchId: record.workbenchId, areaId: input.areaId,
      ...((project?.workspaceId ?? input.workspaceId) === undefined ? {} : { workspaceId: (project?.workspaceId ?? input.workspaceId)! }),
      ...(input.agentPreset === undefined ? {} : { agentPreset: input.agentPreset }),
      ...(input.title === undefined ? {} : { title: input.title }),
      requestId: input.requestId,
    })
    const latest = this.tryReadWritableRecord(input.workbenchId)
    if (latest.status !== 'ready') return latest.result
    const latestArea = workbenchAreas(latest.record).find(candidate => candidate.areaId === input.areaId)
    if (latestArea === undefined) return { status: 'rejected', reason: 'area-not-found' }
    if (latest.record.archivedAt !== undefined) return { status: 'rejected', reason: 'workbench-archived' }
    const latestOwnership = latest.record.areaMetadata?.[input.areaId]?.ownership ?? 'user-owned'
    if (latestOwnership === 'archived') return { status: 'rejected', reason: 'area-archived' }
    if (!input.append && !canManageArea(actor, latestOwnership)) return { status: 'rejected', reason: 'ownership-not-permitted' }
    const existing = latestArea.moduleHistory.find(row => row.binding?.sessionId === connection.target.sessionId)
    if (existing) return { status: 'committed', value: { target: connection.target, moduleInstanceId: existing.moduleInstanceId, reusedBlank: false, settingsRevision: latest.snapshot.revision ?? 0 }, settingsRevision: latest.snapshot.revision ?? 0 }
    const moduleInstanceId = this.createId('module')
    const state = {}
    const module: ModuleInstanceDocument = {
      moduleInstanceId, editorId: 'workbench.conversation', editorScope: 'session',
      binding: structuredClone(connection.target), state,
      sessionStates: { [sessionTargetKey(connection.target)]: {} },
      sessionStateOrder: [sessionTargetKey(connection.target)], bindingGeneration: 0,
      lastKnownTitle: input.title?.slice(0, 160) || '对话',
    }
    const visibleRecord = showWorkbenchArea(latest.record, input.areaId, this.createId('split'))
    const root = mapArea(visibleRecord.document.root, input.areaId, row => {
      const { areaBinding: _binding, ...rest } = row
      return {
      ...rest,
      activeModuleInstanceId: moduleInstanceId,
      moduleHistory: [...row.moduleHistory, module],
    } })
    const saved = await this.commitRecord(latest.snapshot.revision, latest.record, {
      ...latest.record,
      document: { ...latest.record.document, root, activeAreaId: input.areaId },
    })
    if (saved.status !== 'committed') {
      return saved.status === 'conflict'
        ? settingsConflict(saved.actualRevision)
        : saved
    }
    const result: WorkbenchControlPlaneWriteResult<CreateSessionResultV1> = {
      status: 'committed',
      value: { target: structuredClone(connection.target), moduleInstanceId, reusedBlank: connection.reusedBlank === true, settingsRevision: saved.revision },
      settingsRevision: saved.revision,
    }
    this.idempotent.set(requestKey, result)
    return result
  }

  /** Reopen a durable conversation without creating or retargeting a Session. */
  async openSessionView(input: { workbenchId: string; areaId: string; target: SessionBindingV1; title: string }): Promise<WorkbenchControlPlaneWriteResult<CreateSessionResultV1>> {
    const read = this.tryReadWritableRecord(input.workbenchId)
    if (read.status !== 'ready') return read.result
    const { record, snapshot } = read
    const area = workbenchAreas(record).find(row => row.areaId === input.areaId)
    if (!area) return { status: 'rejected', reason: 'area-not-found' }
    if (record.fileWorkbench && record.areaProjects?.[input.areaId]?.workspaceId !== input.target.workspaceId) return { status: 'rejected', reason: 'invalid-input' }
    const previous = areasOf(record.document.root).flatMap(row => row.moduleHistory).find(page => page.editorId === 'workbench.conversation' && page.binding?.sessionId === input.target.sessionId)
    if (previous) return { status: 'committed', value: { target: input.target, moduleInstanceId: previous.moduleInstanceId, reusedBlank: false, settingsRevision: snapshot.revision ?? 0 }, settingsRevision: snapshot.revision ?? 0 }
    const visible = showWorkbenchArea(record, input.areaId, this.createId('split'))
    const id = this.createId('module'), key = sessionTargetKey(input.target)
    const module: ModuleInstanceDocument = { moduleInstanceId: id, editorId: 'workbench.conversation', editorScope: 'session', binding: structuredClone(input.target), bindingGeneration: 0, state: {}, sessionStates: { [key]: {} }, sessionStateOrder: [key], lastKnownTitle: input.title }
    const root = mapArea(visible.document.root, input.areaId, row => ({ ...row, moduleHistory: [...row.moduleHistory, module], activeModuleInstanceId: id }))
    const saved = await this.commitRecord(snapshot.revision, record, { ...visible, document: { ...visible.document, root, activeAreaId: input.areaId } })
    if (saved.status !== 'committed') return saved.status === 'conflict' ? settingsConflict(saved.actualRevision) : saved
    return { status: 'committed', value: { target: input.target, moduleInstanceId: id, reusedBlank: false, settingsRevision: saved.revision }, settingsRevision: saved.revision }
  }

  async ensureEditor(input: EnsureEditorInputV1): Promise<WorkbenchControlPlaneWriteResult<EnsureEditorResultV1>> {
    const read = this.tryReadWritableRecord(input.workbenchId)
    if (read.status !== 'ready') return read.result
    const { snapshot, record } = read
    if (record.archivedAt !== undefined) return { status: 'rejected', reason: 'workbench-archived' }
    const area = workbenchAreas(record).find(candidate => candidate.areaId === input.areaId)
    if (area === undefined) return { status: 'rejected', reason: 'area-not-found' }
    const metadata = record.areaMetadata?.[input.areaId]
    if (!canManageArea(input.actor ?? 'bay-agent', metadata?.ownership ?? 'user-owned')) {
      return { status: 'rejected', reason: 'ownership-not-permitted' }
    }
    const editor = this.options.editors?.getSnapshot().find(candidate => candidate.id === input.editorId)
    if (editor === undefined) return { status: 'rejected', reason: 'editor-not-found' }
    if (record.fileWorkbench && editor.scope === 'session' && !input.sessionId) return { status: 'rejected', reason: 'session-binding-required' }
    const session = input.sessionId ? Object.values(record.sessionCatalog ?? {}).find(row => row.sessionId === input.sessionId && row.relativePath === record.areaProjects?.[area.areaId]?.relativePath) : undefined
    const workspaceId = record.areaProjects?.[area.areaId]?.workspaceId
    const binding = editor.scope === 'session' ? (session ? { sessionId: input.sessionId!, ...(workspaceId ? { workspaceId } : {}) } : area.moduleHistory.find(module => input.sessionId ? module.binding?.sessionId === input.sessionId : module.moduleInstanceId === area.activeModuleInstanceId)?.binding) : undefined
    if (editor.scope === 'session' && binding === undefined) {
      return { status: 'rejected', reason: 'session-binding-required' }
    }
    const current = area.moduleHistory.find(module => module.editorId === input.editorId && module.editorScope === editor.scope && module.binding?.sessionId === binding?.sessionId)
    if (current !== undefined) {
      return { status: 'committed', value: { areaId: input.areaId, moduleInstanceId: current.moduleInstanceId, settingsRevision: snapshot.revision ?? 0 }, settingsRevision: snapshot.revision ?? 0 }
    }
    const moduleInstanceId = this.createId('module')
    const key = binding === undefined ? undefined : sessionTargetKey(binding)
    const module: ModuleInstanceDocument = {
      moduleInstanceId, editorId: editor.id, editorScope: editor.scope, state: {},
      ...(binding === undefined ? {} : {
        binding, sessionStates: { [key!]: {} }, sessionStateOrder: [key!], bindingGeneration: 0,
      }),
      lastKnownTitle: editor.label ?? editor.id,
    }
    const visible = showWorkbenchArea(record, input.areaId, this.createId('split'))
    const root = mapArea(visible.document.root, input.areaId, row => ({
      ...row, activeModuleInstanceId: moduleInstanceId, moduleHistory: [...row.moduleHistory, module],
    }))
    const saved = await this.commitRecord(snapshot.revision, record, { ...record, document: { ...record.document, root, activeAreaId: input.areaId } })
    if (saved.status !== 'committed') {
      return saved.status === 'conflict'
        ? settingsConflict(saved.actualRevision)
        : saved
    }
    return { status: 'committed', value: { areaId: input.areaId, moduleInstanceId, settingsRevision: saved.revision }, settingsRevision: saved.revision }
  }

  private projectArea(record: WorkbenchRecordV2, area: AreaNode): WorkbenchControlPlaneAreaV1 {
    const metadata = record.areaMetadata?.[area.areaId]
    return {
      areaId: area.areaId,
      label: metadata?.label ?? `区域 ${workbenchAreas(record).findIndex(row => row.areaId === area.areaId) + 1}`,
      ownership: metadata?.ownership ?? 'user-owned',
      active: record.document.activeAreaId === area.areaId,
      archived: metadata?.ownership === 'archived',
      visible: areasOf(record.document.root).some(row => row.areaId === area.areaId),
      generation: record.areaProjects?.[area.areaId]?.generation ?? 0,
      ...(record.areaProjects?.[area.areaId] ? { project: structuredClone(record.areaProjects[area.areaId]!) } : {}),
      context: areaContextOf(record.areaContexts?.[area.areaId]),
      modules: area.moduleHistory.map(module => ({
        moduleInstanceId: module.moduleInstanceId, editorId: module.editorId, scope: module.editorScope,
        title: module.lastKnownTitle, available: this.options.editors?.getSnapshot().some(editor => editor.id === module.editorId && editor.scope === module.editorScope) ?? true,
        ...(module.binding === undefined ? {} : { binding: structuredClone(module.binding) }),
      })),
    }
  }

  private readRecord(workbenchId?: string): { snapshot: ReturnType<WorkbenchControlPlaneSettings['getSnapshot']>; record: WorkbenchRecordV2 } {
    const snapshot = this.options.settings.getSnapshot()
    if (snapshot.status !== 'ready' || snapshot.value === undefined) throw controlPlaneError('workbench-not-found', 'Workbench Settings is unavailable')
    const id = workbenchId ?? snapshot.value.activeWorkbenchId
    const record = snapshot.value.workbenches[id]
    if (record === undefined) throw controlPlaneError('workbench-not-found', `Unknown Workbench ${id}`)
    return { snapshot, record }
  }

  private tryReadWritableRecord(workbenchId?: string):
    | { status: 'ready'; snapshot: ReturnType<WorkbenchControlPlaneSettings['getSnapshot']>; record: WorkbenchRecordV2 }
    | { status: 'not-ready'; result: { status: 'unavailable' } | { status: 'rejected'; reason: 'workbench-not-found' } } {
    const snapshot = this.options.settings.getSnapshot()
    if (snapshot.status !== 'ready' || snapshot.value === undefined || snapshot.revision === undefined || !snapshot.writable) {
      return { status: 'not-ready', result: { status: 'unavailable' } }
    }
    const id = workbenchId ?? snapshot.value.activeWorkbenchId
    const record = snapshot.value.workbenches[id]
    return record === undefined
      ? { status: 'not-ready', result: { status: 'rejected', reason: 'workbench-not-found' } }
      : { status: 'ready', snapshot, record }
  }

  private async commitRecord(
    expectedRevision: number | undefined,
    previous: WorkbenchRecordV2,
    next: WorkbenchRecordV2,
  ): Promise<{ status: 'committed'; revision: number } | { status: 'conflict'; actualRevision?: number } | { status: 'unavailable' }> {
    if (expectedRevision === undefined) return { status: 'unavailable' }
    const result = await this.options.settings.patch({
      operation: 'set', path: ['workbenches', previous.workbenchId],
      value: { ...structuredClone(next), updatedAt: this.now() }, expectedRevision,
    })
    if (result.status === 'committed') return { status: 'committed', revision: result.revision ?? expectedRevision + 1 }
    if (result.status === 'conflict') {
      return result.actualRevision === undefined
        ? { status: 'conflict' }
        : { status: 'conflict', actualRevision: result.actualRevision }
    }
    return { status: 'unavailable' }
  }

  private contextOptions<S extends WorkbenchContextSection>(input: {
    writer: WorkbenchContextWriter
    section: WorkbenchContextSection
    expectedRevision: number
    patch: Record<string, unknown>
  }): ContextPatchOptions<S> {
    return {
      writer: input.writer, section: input.section, expectedRevision: input.expectedRevision,
      patch: input.patch,
    } as ContextPatchOptions<S>
  }
}

function settingsConflict<T>(actualRevision: number | undefined): WorkbenchControlPlaneWriteResult<T> {
  return actualRevision === undefined
    ? { status: 'conflict', source: 'settings' }
    : { status: 'conflict', source: 'settings', currentSettingsRevision: actualRevision }
}

function contextWriteFailure<T extends WorkbenchContextV1 | AreaContextV1>(
  result: ContextPatchResult<T>,
): WorkbenchControlPlaneWriteResult<T> {
  if (result.status === 'conflict') return { status: 'conflict', source: 'context', value: result.context }
  if (result.status === 'rejected') {
    return { status: 'rejected', reason: result.reason === 'agent-cannot-write-human-context' ? 'ownership-not-permitted' : 'context-rejected' }
  }
  return { status: 'unavailable' }
}

function canManageArea(actor: WorkbenchControlPlaneActor, ownership: WorkbenchAreaOwnershipV1): boolean {
  // Shared Areas need an explicit approval capability. The first slice does
  // not model that token yet, so Bay Agent may only mutate its own Areas.
  return actor === 'human' || (isBayAgentActor(actor) && (ownership === 'bay-agent-managed' || ownership === 'superagent-managed'))
}

function isBayAgentActor(actor: WorkbenchControlPlaneActor): boolean {
  return actor === 'bay-agent' || actor === 'superagent'
}

function areaContextWithObjective(objective: string | undefined): AreaContextV1 {
  const context = createAreaContext()
  if (objective === undefined || objective.trim() === '') return context
  return { ...context, human: { ...context.human, objective: boundedText(objective, '') } }
}

function boundedText(value: string | undefined, fallback: string): string {
  const normalized = value?.normalize('NFKC').trim()
  return normalized === undefined || normalized === '' ? fallback : normalized.slice(0, 20_000)
}

function mapArea(node: WorkbenchNodeV3, areaId: string, map: (area: AreaNode) => AreaNode): WorkbenchNodeV3 {
  if (node.kind === 'area') return node.areaId === areaId ? map(node) : node
  return { ...node, first: mapArea(node.first, areaId, map), second: mapArea(node.second, areaId, map) }
}

function controlPlaneError(reason: WorkbenchControlPlaneRejectionReason, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code: reason })
}
