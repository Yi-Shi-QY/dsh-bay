import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

describe('Core release identity source contract', () => {
  it('does not claim a tarball digest before packaging computes one', () => {
    const source = readFileSync(new URL('../src/core-manifest.ts', import.meta.url), 'utf8')
    expect(source).not.toMatch(/artifactDigest\s*:/u)
    expect(source).not.toContain('1111111111111111111111111111111111111111111111111111111111111111')
  })
})
