import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('../src/foundation/WorkbenchFrame.module.css', import.meta.url), 'utf8')

describe('Workbench editor menu layout contract', () => {
  it('does not size a one-button menu row as a trailing icon action', () => {
    const trailingActionRule = source.match(/\.editorMenuRow > button:last-child[^\{]*\{[^}]*\}/u)?.[0]
    expect(trailingActionRule).toContain(':not(:first-child)')
  })
})
