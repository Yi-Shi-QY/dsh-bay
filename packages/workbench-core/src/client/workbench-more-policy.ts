/**
 * Workbench 17.5 keeps DSH rc1's entry-customization More menu on the
 * official surface.  This policy is deliberately narrow: it identifies one
 * registration id on the three action slots where rc1 publishes it and does
 * not turn off the surrounding Slot or any other action registration.
 */
export const WORKBENCH_MORE_FILTERED_SLOTS = [
  'sidebar.panellist.actions',
  'conversation.session.header.views.actions',
  'sidebar.right.tab.guide.actions',
] as const

export type WorkbenchMoreFilteredSlot = typeof WORKBENCH_MORE_FILTERED_SLOTS[number]

export interface WorkbenchSlotRegistrationIdentity {
  readonly id?: string
  readonly key?: string
}

export function isDeferredOfficialMoreRegistration(
  slot: string,
  registration: WorkbenchSlotRegistrationIdentity,
): boolean {
  return (WORKBENCH_MORE_FILTERED_SLOTS as readonly string[]).includes(slot)
    && (registration.id === 'entry-customization' || registration.key === 'entry-customization')
}

/** Root Workbench Sidebar owns no global DSH panel list in Core-only mode. */
export function filterWorkbenchRootSidebarRegistrations<T extends WorkbenchSlotRegistrationIdentity>(
  slot: string,
  registrations: readonly T[],
): readonly T[] {
  if (slot !== 'sidebar.panellist.actions') return registrations
  return registrations.filter(registration => !isDeferredOfficialMoreRegistration(slot, registration))
}
