import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

function json(relative: string) {
  return JSON.parse(readFileSync(new URL(`../../../${relative}`, import.meta.url), 'utf8').replace(/^\uFEFF/u, '')) as Record<string, any>
}

describe('DSH RC1 historical compatibility record', () => {
  it('keeps RC1 identity evidence separate from the current RC3 candidate', () => {
    const compatibility = json('compat/dsh-0.2.2-rc.1/manifest.json')
    const provenance = json('provenance/dsh-0.2.2-rc.1.json')
    const current = json('packages/workbench-core/package.json')

    expect(compatibility.upstream.generation).toBe('0.2.2-rc.1')
    expect(compatibility.upstream.commit).toBe('66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db')
    expect(provenance.dshGeneration).toBe(compatibility.upstream.generation)
    expect(provenance.upstream.sourceDigest).toBe(compatibility.upstream.sourceDigest)
    expect(current.dsh.workbench.dshGeneration).toBe('0.2.2-rc.3')
    expect(current.dsh.workbench.upstreamCommit).not.toBe(compatibility.upstream.commit)
  })

  it('retains the recorded 34-file index for a separately reported source audit', () => {
    const source = json('packages/workbench-core/rc1-sidebar-workspace-source-index.json')
    const compatibility = json('compat/dsh-0.2.2-rc.1/manifest.json')
    expect(source.fileCount).toBe(34)
    expect(source.sourceDigest).toBe(compatibility.upstream.sourceDigest)
    expect(source.packages).toHaveLength(source.fileCount)
  })

  it('verifies the historical source index after normalizing checkout line endings', () => {
    const output = execFileSync(process.execPath, [fileURLToPath(new URL('../../../scripts/check-rc1.mjs', import.meta.url))], { encoding: 'utf8' })
    expect(JSON.parse(output)).toMatchObject({
      sourceEvidence: 'source-mirror-matches-lf-normalized-index',
      indexedRowsConsistent: true,
      sourceDigestConsistent: true,
      mismatchCount: 0,
    })
  })
})
