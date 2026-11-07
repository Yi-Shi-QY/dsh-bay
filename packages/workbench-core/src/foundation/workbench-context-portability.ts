import type { WorkbenchAreaOwnershipV1, WorkbenchAreaMetadataV1 } from './persistence.ts'
import {
  areaContextOf,
  createAreaContext,
  createWorkbenchContext,
  decodeAreaContext,
  decodeWorkbenchContext,
  renderAreaContextMarkdown,
  renderWorkbenchContextMarkdown,
  type AreaContextV1,
  type WorkbenchContextV1,
} from './workbench-context.ts'

export type WorkbenchContextExportPolicyV1 = 'human' | 'handoff'

export interface PortableWorkbenchContextV1 {
  schemaVersion: 1
  policy: WorkbenchContextExportPolicyV1
  exportedAt: string
  workbench: {
    sourceRevision: number
    human: WorkbenchContextV1['human']
    agent?: WorkbenchContextV1['agent']
  }
  areas: Record<string, {
    sourceRevision: number
    human: AreaContextV1['human']
    agent?: AreaContextV1['agent']
    sourceOwnership?: WorkbenchAreaOwnershipV1
  }>
}

export interface RestoredPortableWorkbenchContextV1 {
  context: WorkbenchContextV1
  areaContexts: Record<string, AreaContextV1>
  areaMetadata: Record<string, WorkbenchAreaMetadataV1>
}

const hasValues = (value: unknown): boolean => {
  if (typeof value === 'string') return value.trim() !== ''
  if (Array.isArray(value)) return value.length > 0 || value.some(hasValues)
  if (value !== null && typeof value === 'object') return Object.values(value).some(hasValues)
  return false
}

function revisionOf(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0
}

/** Project only portable intent. Local identities and derived runtime state never cross this seam. */
export function projectPortableWorkbenchContext(
  workbench: WorkbenchContextV1 | undefined,
  areas: Readonly<Record<string, { context?: AreaContextV1; ownership?: WorkbenchAreaOwnershipV1 }>>,
  policy: WorkbenchContextExportPolicyV1 = 'human',
  exportedAt = new Date().toISOString(),
): PortableWorkbenchContextV1 | undefined {
  const sourceWorkbench = workbench === undefined ? createWorkbenchContext() : workbench
  const projectedAreas: PortableWorkbenchContextV1['areas'] = {}
  for (const [areaKey, row] of Object.entries(areas)) {
    const source = row.context === undefined ? createAreaContext() : row.context
    const area = {
      sourceRevision: source.revision,
      human: structuredClone(source.human),
      ...(policy === 'handoff' ? { agent: structuredClone(source.agent) } : {}),
      ...(row.ownership === undefined ? {} : { sourceOwnership: row.ownership }),
    }
    if (hasValues(area.human) || (area.agent !== undefined && hasValues(area.agent)) || area.sourceOwnership !== undefined) projectedAreas[areaKey] = area
  }
  const result: PortableWorkbenchContextV1 = {
    schemaVersion: 1,
    policy,
    exportedAt,
    workbench: {
      sourceRevision: sourceWorkbench.revision,
      human: structuredClone(sourceWorkbench.human),
      ...(policy === 'handoff' ? { agent: structuredClone(sourceWorkbench.agent) } : {}),
    },
    areas: projectedAreas,
  }
  return hasValues(result.workbench.human) || result.workbench.agent !== undefined && hasValues(result.workbench.agent)
    || Object.keys(projectedAreas).length > 0 ? result : undefined
}

/** Validate an untrusted package projection before it enters Settings. */
export function validatePortableWorkbenchContext(value: unknown): asserts value is PortableWorkbenchContextV1 {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('Context projection must be an object')
  const raw = value as Record<string, unknown>
  if (raw.schemaVersion !== 1 || (raw.policy !== 'human' && raw.policy !== 'handoff')
    || typeof raw.exportedAt !== 'string' || !Number.isFinite(Date.parse(raw.exportedAt))
    || raw.workbench === null || typeof raw.workbench !== 'object' || Array.isArray(raw.workbench)
    || raw.areas === null || typeof raw.areas !== 'object' || Array.isArray(raw.areas)) throw new Error('Context projection is invalid')
  const workbench = raw.workbench as Record<string, unknown>
  if (!revisionOf(Number(workbench.sourceRevision)) || decodeWorkbenchContext({ schemaVersion: 1, revision: 0, human: workbench.human, agent: workbench.agent ?? createWorkbenchContext().agent }) === undefined) {
    throw new Error('Workbench Context projection is invalid')
  }
  if (workbench.agent !== undefined && raw.policy !== 'handoff') throw new Error('Agent handoff requires handoff policy')
  for (const [areaKey, area] of Object.entries(raw.areas as Record<string, unknown>)) {
    if (!/^[A-Za-z0-9._:-]{1,128}$/u.test(areaKey) || area === null || typeof area !== 'object' || Array.isArray(area)) throw new Error('Area Context projection is invalid')
    const row = area as Record<string, unknown>
    if (!revisionOf(Number(row.sourceRevision)) || decodeAreaContext({ schemaVersion: 1, revision: 0, human: row.human, agent: row.agent ?? createAreaContext().agent }) === undefined) throw new Error('Area Context projection is invalid')
    if (row.agent !== undefined && raw.policy !== 'handoff') throw new Error('Area Agent handoff requires handoff policy')
    if (row.sourceOwnership !== undefined && !['user-owned', 'bay-agent-managed', 'superagent-managed', 'shared', 'archived'].includes(String(row.sourceOwnership))) throw new Error('Area ownership projection is invalid')
  }
}

/** Restore Context against newly generated local Area IDs and local revisions. */
export function restorePortableWorkbenchContext(
  value: PortableWorkbenchContextV1 | undefined,
  areaIds: ReadonlyMap<string, string>,
): RestoredPortableWorkbenchContextV1 | undefined {
  if (value === undefined) return undefined
  validatePortableWorkbenchContext(value)
  const baseWorkbench = createWorkbenchContext()
  const decodedWorkbench = decodeWorkbenchContext({ schemaVersion: 1, revision: 0, human: value.workbench.human, agent: value.workbench.agent ?? baseWorkbench.agent })
  if (decodedWorkbench === undefined) throw new Error('Workbench Context projection cannot be restored')
  const areaContexts: Record<string, AreaContextV1> = {}
  const areaMetadata: Record<string, WorkbenchAreaMetadataV1> = {}
  const now = Date.now()
  for (const [areaKey, row] of Object.entries(value.areas)) {
    const localAreaId = areaIds.get(areaKey)
    if (localAreaId === undefined) throw new Error(`Context references unknown Area ${areaKey}`)
    const decodedArea = decodeAreaContext({ schemaVersion: 1, revision: 0, human: row.human, agent: row.agent ?? createAreaContext().agent })
    if (decodedArea === undefined) throw new Error(`Area Context cannot be restored: ${areaKey}`)
    areaContexts[localAreaId] = decodedArea
    areaMetadata[localAreaId] = { label: areaKey, ownership: 'user-owned', createdAt: now, updatedAt: now }
  }
  return { context: decodedWorkbench, areaContexts, areaMetadata }
}

export function renderPortableWorkbenchContextMarkdown(value: PortableWorkbenchContextV1): string {
  validatePortableWorkbenchContext(value)
  const base = createWorkbenchContext()
  const context = decodeWorkbenchContext({ schemaVersion: 1, revision: 0, human: value.workbench.human, agent: value.workbench.agent ?? base.agent })
  return context === undefined ? '' : renderWorkbenchContextMarkdown(context)
}

export function renderPortableAreaContextMarkdown(value: PortableWorkbenchContextV1, areaKey: string): string {
  const row = value.areas[areaKey]
  if (row === undefined) return ''
  const context = decodeAreaContext({ schemaVersion: 1, revision: 0, human: row.human, agent: row.agent ?? createAreaContext().agent })
  return context === undefined ? '' : renderAreaContextMarkdown(context)
}

