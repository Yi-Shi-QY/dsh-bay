import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const accentSource = readFileSync(new URL('../src/foundation/SessionAccentFrame.module.css', import.meta.url), 'utf8')
const floatingSource = readFileSync(new URL('../src/foundation/WorkbenchFloatingWorkspace.module.css', import.meta.url), 'utf8')

function zIndex(source: string, selector: string): number {
  const body = source.match(new RegExp(`${selector}\\s*\\{([^}]*)\\}`, 'u'))?.[1]
  const value = [...(body?.matchAll(/z-index:\s*(\d+)/gu) ?? [])].at(-1)?.[1]
  if (value === undefined) throw new Error(`Missing z-index for ${selector}`)
  return Number(value)
}

describe('session accent frame layering', () => {
  it('keeps locked Area markers below the floating workspace surface', () => {
    const lockedAreaMarker = zIndex(accentSource, String.raw`.frame\[data-session-frame='area'\]\[data-layout-locked='true'\]::after`)
    const floatingLayer = zIndex(floatingSource, String.raw`\.layer`)
    expect(lockedAreaMarker).toBeLessThan(floatingLayer)
  })
})
