import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

describe('Core release source contract', () => {
  it('keeps the publish manifest public and free from workspace protocol dependencies', () => {
    const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as Record<string, unknown>
    expect(manifest.private).not.toBe(true)
    for (const section of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
      const dependencies = manifest[section] as Record<string, string> | undefined
      expect(Object.values(dependencies ?? {})).not.toContainEqual(expect.stringMatching(/^workspace:/u))
    }
  })
})
