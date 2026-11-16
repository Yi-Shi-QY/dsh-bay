import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { createFloatingUiSettings } from '../src/host-floating-ui-settings.ts'
import { guestDistributionDenied } from '../src/host-distribution-guest-guard.ts'

it('isolates Profile/client geometry and refuses extra state or path keys', () => {
  const root = mkdtempSync(join(tmpdir(), 'floating-ui-'))
  try {
    const first = createFloatingUiSettings(join(root, 'a')), second = createFloatingUiSettings(join(root, 'b'))
    first.save('desktop', 'workbench', { rect: { x: 1, y: 2, width: 720, height: 480 } })
    expect(first.list('desktop').workbench?.rect?.x).toBe(1)
    expect(first.list('companion')).toEqual({}); expect(second.list('desktop')).toEqual({})
    expect(() => first.save('desktop', '../invalid', {})).toThrow()
    expect(() => first.save('desktop', 'workbench', { tabs: ['private'] })).toThrow()
    expect(guestDistributionDenied('/workbench/ui-settings')).toBe(true)
    expect(guestDistributionDenied('/api/workbench%2fui-settings')).toBe(true)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
