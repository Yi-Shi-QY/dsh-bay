import { areaContextOf } from './workbench-context.ts'
import type { SessionBindingV1 } from './model.ts'
import type {
  AreaAgentContextV1,
  AreaContextV1,
  WorkbenchBayAgentContextV1,
  WorkbenchHumanContextV1,
} from './workbench-context.ts'
import type {
  WorkbenchControlPlane,
  WorkbenchControlPlaneAreaV1,
  WorkbenchControlPlaneSnapshotV1,
  WorkbenchControlPlaneWriteResult,
} from './workbench-control-plane.ts'
import type { WorkbenchAreaOwnershipV1 } from './persistence.ts'

/** The small Work Item projection that may be sent to a Worker. */
export interface WorkbenchBayAgentWorkItemV1 {
  workItemId: string
  objective: string
  status: string
  scope?: string
  inputs?: readonly string[]
  successCriteria?: readonly string[]
}

/** Context captured at one point in time for a Bay Agent or Worker prompt. */
export interface WorkbenchBayAgentPromptContextV1 {
  schemaVersion: 1
  capturedAt: number
  workbenchId: string
  workbenchContextRevision: number
  workbench: {
    human: WorkbenchHumanContextV1
    agent: WorkbenchBayAgentContextV1
  }
  area?: {
    areaId: string
    projectId?: string
    label: string
    ownership: WorkbenchAreaOwnershipV1
    generation: number
    contextRevision: number
    human: AreaContextV1['human']
    agent: AreaContextV1['agent']
    project?: WorkbenchControlPlaneAreaV1['project']
  }
  workItem?: WorkbenchBayAgentWorkItemV1
}

export interface BuildWorkbenchBayAgentPromptContextInputV1 {
  snapshot: WorkbenchControlPlaneSnapshotV1
  areaId?: string
  projectId?: string
  workItem?: WorkbenchBayAgentWorkItemV1
  capturedAt?: number
}

/** A lease for one execution attempt against its owning Area project and Context. */
export interface WorkbenchBayAgentExecutionLeaseV1 {
  moduleInstanceId?: string
  workbenchId: string
  areaId: string
  projectId?: string
  sessionId?: string
  areaGeneration: number
  projectGeneration?: number
  workbenchContextRevision: number
  areaContextRevision: number
}

export type WorkbenchBayAgentExecutionStaleReason =
  | 'workbench-replaced'
  | 'area-missing'
  | 'area-generation-changed'
  | 'session-changed'
  | 'context-advanced'

export type WorkbenchBayAgentReportResult =
  | WorkbenchControlPlaneWriteResult<AreaContextV1>
  | { status: 'stale'; reason: WorkbenchBayAgentExecutionStaleReason }

export interface CaptureWorkbenchBayAgentPromptInputV1 {
  workbenchId?: string
  areaId?: string
  projectId?: string
  workItem?: WorkbenchBayAgentWorkItemV1
  capturedAt?: number
}

export interface CaptureWorkbenchBayAgentExecutionLeaseInputV1 {
  workbenchId?: string
  areaId: string
  projectId?: string
}

export interface ApplyWorkbenchBayAreaAgentReportInputV1 {
  lease: WorkbenchBayAgentExecutionLeaseV1
  patch: Partial<AreaAgentContextV1>
}

/**
 * Build a minimal prompt snapshot.  The current Area is included in full;
 * other Areas are intentionally represented only by their existence in the
 * Control Plane and never have their Context copied into a Worker prompt.
 */
export function buildWorkbenchBayAgentPromptContext(
  input: BuildWorkbenchBayAgentPromptContextInputV1,
): WorkbenchBayAgentPromptContextV1 {
  const { snapshot } = input
  const area = input.projectId ? projectExecutionTarget(snapshot, input.projectId, input.areaId) : input.areaId === undefined ? undefined : findArea(snapshot, input.areaId)
  return {
    schemaVersion: 1,
    capturedAt: input.capturedAt ?? Date.now(),
    workbenchId: snapshot.workbenchId,
    workbenchContextRevision: snapshot.context.revision,
    workbench: {
      human: structuredClone(snapshot.context.human),
      agent: structuredClone(snapshot.context.agent),
    },
    ...(area === undefined ? {} : { area: projectPromptArea(area) }),
    ...(input.workItem === undefined ? {} : { workItem: structuredClone(input.workItem) }),
  }
}

function findArea(snapshot: WorkbenchControlPlaneSnapshotV1, areaId: string): WorkbenchControlPlaneAreaV1 {
  const area = snapshot.areas.find(candidate => candidate.areaId === areaId)
  if (area !== undefined) return area
  throw Object.assign(new Error(`Unknown Area ${areaId}`), { code: 'area-not-found' })
}

/** Resolve business identity without requiring its old display container to exist. */
export function projectExecutionTarget(snapshot: WorkbenchControlPlaneSnapshotV1, projectId: string, preferredAreaId?: string): WorkbenchControlPlaneAreaV1 {
  const project = snapshot.projects?.find(row => row.projectId === projectId)
  if (!project) throw new Error('项目不存在，无法继续任务。')
  const view = snapshot.areas.find(row => row.areaId === preferredAreaId && row.project?.projectId === projectId) ?? snapshot.areas.find(row => row.project?.projectId === projectId)
  return { areaId: view?.areaId ?? '', label: project.name, ownership: view?.ownership ?? 'user-owned', active: view?.active ?? false, archived: false,
    visible: !!view, generation: project.generation, context: areaContextOf(project.context), project, modules: view?.modules ?? [] }
}

function projectPromptArea(area: WorkbenchControlPlaneAreaV1): NonNullable<WorkbenchBayAgentPromptContextV1['area']> {
  return {
    areaId: area.areaId,
    ...(area.project?.projectId ? { projectId: area.project.projectId } : {}),
    label: area.label,
    ownership: area.ownership,
    generation: area.generation,
    contextRevision: area.context.revision,
    human: structuredClone(area.context.human),
    agent: structuredClone(area.context.agent),
    ...(area.project === undefined ? {} : { project: structuredClone(area.project) }),
  }
}

/**
 * Render only the versioned Workbench/Area Context and Work Item projection.
 * Runtime transcripts, credentials, paths and plugin state are not available
 * to this renderer by construction.
 */
export function renderWorkbenchBayAgentPromptContext(context: WorkbenchBayAgentPromptContextV1): string {
  const lines: string[] = [
    '# Workbench Context',
    `Workbench ID: ${context.workbenchId}`,
    `Workbench Context revision: ${context.workbenchContextRevision}`,
    `Captured at: ${context.capturedAt}`,
    '',
    '## Workbench human context',
    `Goal: ${renderText(context.workbench.human.goal)}`,
    'Constraints:',
    ...renderList(context.workbench.human.constraints),
    'Preferences:',
    ...renderList(context.workbench.human.preferences),
    'Allowed actions:',
    ...renderList(context.workbench.human.allowedActions),
    'Approval required:',
    ...renderList(context.workbench.human.approvalRequired),
    'Environment:',
    ...renderList(context.workbench.human.environment),
    '',
    '## Workbench Bay Agent context',
    `Summary: ${renderText(context.workbench.agent.summary)}`,
    `Current focus: ${renderText(context.workbench.agent.currentFocus)}`,
    'Next actions:',
    ...renderList(context.workbench.agent.nextActions),
    'Blockers:',
    ...renderList(context.workbench.agent.blockers),
    'Proposals:',
    ...renderList(context.workbench.agent.proposals),
  ]
  if (context.area !== undefined) {
    lines.push(
      '',
      context.area.projectId ? '## Current Project' : '## Current Area',
      ...(context.area.projectId ? [`Project ID: ${context.area.projectId}`] : []),
      `Area ID: ${context.area.areaId}`,
      `Area label: ${context.area.label}`,
      `Area ownership: ${context.area.ownership}`,
      `Area generation: ${context.area.generation}`,
      `Area Context revision: ${context.area.contextRevision}`,
      ...(context.area.project === undefined
        ? ['Session binding: none']
        : [
            `Project: ${context.area.project.relativePath}`,
            `Project revision: ${context.area.project.generation}`,
          ]),
      '',
      '### Area human context',
      `Objective: ${renderText(context.area.human.objective)}`,
      'Constraints:',
      ...renderList(context.area.human.constraints),
      'Inputs:',
      ...renderList(context.area.human.inputs),
      'Success criteria:',
      ...renderList(context.area.human.successCriteria),
      '',
      '### Area Bay Agent context',
      `Summary: ${renderText(context.area.agent.summary)}`,
      'Completed:',
      ...renderList(context.area.agent.completed),
      'Next actions:',
      ...renderList(context.area.agent.nextActions),
      'Blockers:',
      ...renderList(context.area.agent.blockers),
      'Proposals:',
      ...renderList(context.area.agent.proposals),
    )
  }
  if (context.workItem !== undefined) {
    lines.push(
      '',
      '## Work Item',
      `Work Item ID: ${context.workItem.workItemId}`,
      `Objective: ${renderText(context.workItem.objective)}`,
      `Status: ${renderText(context.workItem.status)}`,
      ...(context.workItem.scope === undefined ? [] : [`Scope: ${context.workItem.scope}`]),
      ...(context.workItem.inputs === undefined ? [] : ['Inputs:', ...renderList(context.workItem.inputs)]),
      ...(context.workItem.successCriteria === undefined
        ? []
        : ['Success criteria:', ...renderList(context.workItem.successCriteria)]),
    )
  }
  return lines.join('\n')
}

function renderText(value: string | undefined): string {
  return value === undefined || value === '' ? '(empty)' : value
}

function renderList(values: readonly string[]): string[] {
  return values.length === 0 ? ['- (none)'] : values.map(value => `- ${value}`)
}

export function captureWorkbenchBayAgentExecutionLease(
  snapshot: WorkbenchControlPlaneSnapshotV1,
  areaId: string,
  projectId?: string,
): WorkbenchBayAgentExecutionLeaseV1 {
  const area = projectId ? projectExecutionTarget(snapshot, projectId, areaId) : findArea(snapshot, areaId)
  return {
    workbenchId: snapshot.workbenchId,
    areaId: area.areaId,
    ...(area.project?.projectId ? { projectId: area.project.projectId } : {}),
    ...(area.binding === undefined ? {} : { sessionId: area.binding.sessionId }),
    areaGeneration: area.generation,
    ...(area.project ? { projectGeneration: area.project.generation } : {}),
    workbenchContextRevision: snapshot.context.revision,
    areaContextRevision: area.context.revision,
  }
}

export function workbenchBayAgentExecutionStaleReason(
  lease: WorkbenchBayAgentExecutionLeaseV1,
  snapshot: WorkbenchControlPlaneSnapshotV1,
): WorkbenchBayAgentExecutionStaleReason | undefined {
  if (snapshot.workbenchId !== lease.workbenchId) return 'workbench-replaced'
  const area = lease.projectId ? (snapshot.projects?.some(row => row.projectId === lease.projectId) ? projectExecutionTarget(snapshot, lease.projectId, lease.areaId) : undefined) : snapshot.areas.find(candidate => candidate.areaId === lease.areaId)
  if (area === undefined) return 'area-missing'
  if (lease.projectGeneration !== area.project?.generation) return 'area-generation-changed'
  if (!lease.moduleInstanceId && area.generation !== lease.areaGeneration) return 'area-generation-changed'
  const currentSessionId = snapshot.sessions !== undefined && lease.sessionId
    ? snapshot.sessions.find(row => row.sessionId === lease.sessionId && (lease.projectId ? row.projectId === lease.projectId : row.areaId === lease.areaId))?.sessionId
    : lease.moduleInstanceId ? snapshot.areas.flatMap(row => row.modules).find(row => row.moduleInstanceId === lease.moduleInstanceId)?.binding?.sessionId : area.binding?.sessionId
  if (currentSessionId !== lease.sessionId) return 'session-changed'
  if (snapshot.context.revision !== lease.workbenchContextRevision
    || area.context.revision !== lease.areaContextRevision) return 'context-advanced'
  return undefined
}

export function isWorkbenchBayAgentExecutionCurrent(
  lease: WorkbenchBayAgentExecutionLeaseV1,
  snapshot: WorkbenchControlPlaneSnapshotV1,
): boolean {
  return workbenchBayAgentExecutionStaleReason(lease, snapshot) === undefined
}

export type WorkbenchBayAgentAdapterControlPlane = Pick<WorkbenchControlPlane, 'inspect' | 'patchContext'>

/** Bridges Bay Agent Context CAS with an external Worker execution attempt. */
export class WorkbenchBayAgentAdapter {
  constructor(
    private readonly controlPlane: WorkbenchBayAgentAdapterControlPlane,
    private readonly now: () => number = () => Date.now(),
  ) {}

  capturePrompt(input: CaptureWorkbenchBayAgentPromptInputV1 = {}): WorkbenchBayAgentPromptContextV1 {
    const snapshot = this.controlPlane.inspect(input.workbenchId)
    return buildWorkbenchBayAgentPromptContext({
      snapshot,
      ...(input.areaId === undefined ? {} : { areaId: input.areaId }),
      ...(input.projectId ? { projectId: input.projectId } : {}),
      ...(input.workItem === undefined ? {} : { workItem: input.workItem }),
      capturedAt: input.capturedAt ?? this.now(),
    })
  }

  captureExecutionLease(input: CaptureWorkbenchBayAgentExecutionLeaseInputV1): WorkbenchBayAgentExecutionLeaseV1 {
    return captureWorkbenchBayAgentExecutionLease(this.controlPlane.inspect(input.workbenchId), input.areaId, input.projectId)
  }

  async applyAreaAgentReport(input: ApplyWorkbenchBayAreaAgentReportInputV1): Promise<WorkbenchBayAgentReportResult> {
    const snapshot = this.controlPlane.inspect(input.lease.workbenchId)
    const staleReason = workbenchBayAgentExecutionStaleReason(input.lease, snapshot)
    if (staleReason !== undefined) return { status: 'stale', reason: staleReason }
    const result = await this.controlPlane.patchContext({
      scope: input.lease.projectId ? 'project' : 'area',
      ...(input.lease.projectId ? { projectId: input.lease.projectId } : {}),
      workbenchId: input.lease.workbenchId,
      areaId: input.lease.areaId,
      writer: 'bay-agent',
      section: 'agent',
      expectedRevision: input.lease.areaContextRevision,
      patch: input.patch as Record<string, unknown>,
    })
    return result.status === 'committed'
      ? { ...result, value: result.value as AreaContextV1 }
      : result as WorkbenchBayAgentReportResult
  }
}
