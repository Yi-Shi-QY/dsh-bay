import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { filterWorkbenchRootSidebarRegistrations, isDeferredOfficialMoreRegistration } from '../src/client/workbench-more-policy.ts'

describe('Workbench 15.2 More policy', () => {
  it('filters only rc5 entry-customization on the three projected action slots', () => {
    for (const slot of [
      'sidebar.panellist.actions',
      'conversation.session.header.views.actions',
      'sidebar.right.tab.guide.actions',
    ]) {
      expect(isDeferredOfficialMoreRegistration(slot, { id: 'entry-customization' })).toBe(true)
      expect(isDeferredOfficialMoreRegistration(slot, { key: 'entry-customization' })).toBe(true)
      expect(isDeferredOfficialMoreRegistration(slot, { id: 'third-party-action' })).toBe(false)
    }
  })

  it('does not apply the filter to unrelated slots and keeps legal root actions', () => {
    expect(isDeferredOfficialMoreRegistration('sidebar.right.tab.guide.content', { id: 'entry-customization' })).toBe(false)
    expect(filterWorkbenchRootSidebarRegistrations('sidebar.panellist.actions', [
      { id: 'entry-customization' }, { id: 'third-party-action' },
    ])).toEqual([{ id: 'third-party-action' }])
    expect(filterWorkbenchRootSidebarRegistrations('sidebar.right.tab.guide.actions', [
      { id: 'entry-customization' }, { id: 'third-party-action' },
    ])).toHaveLength(2)
  })

  it('keeps the global panel-action slot out of the active Workbench root shell', () => {
    const contract = readFileSync(new URL('../src/foundation/workbench-sidebar/generated/upstream/ui-sidebar/contract/slots.ts', import.meta.url), 'utf8')
    const shell = readFileSync(new URL('../src/foundation/workbench-sidebar/generated/upstream/ui-sidebar/SidebarRoot.tsx', import.meta.url), 'utf8')
    expect(contract).not.toContain("'sidebar.panellist.actions'")
    expect(shell).not.toContain("renderSlot('sidebar.panellist.actions'")
  })
})
