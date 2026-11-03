/** Core-owned additive contribution registry. Modules never need to reach into
 * the official DSH Slot tree; Core owns registration and disposal instead. */
export interface WorkbenchContributionV1 {
  readonly id: string
  readonly kind: string
  readonly ownerModuleId?: string
  readonly value?: unknown
}

export interface WorkbenchContributionRegistryV1 {
  register(contribution: WorkbenchContributionV1): () => void
  list(): readonly WorkbenchContributionV1[]
  clear(): void
}

export function createWorkbenchContributionRegistry(): WorkbenchContributionRegistryV1 {
  const entries = new Map<string, WorkbenchContributionV1>()
  return {
    register(contribution) {
      if (contribution.id.trim() === '' || contribution.kind.trim() === '') throw new Error('Workbench contribution requires id and kind')
      if (entries.has(contribution.id)) throw new Error(`Workbench contribution conflict: ${contribution.id}`)
      entries.set(contribution.id, contribution)
      return () => { if (entries.get(contribution.id) === contribution) entries.delete(contribution.id) }
    },
    list: () => [...entries.values()],
    clear: () => { entries.clear() },
  }
}
