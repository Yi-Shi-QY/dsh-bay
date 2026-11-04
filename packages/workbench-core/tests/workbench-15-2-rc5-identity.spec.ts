import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { WORKBENCH_CORE_VERSION, WORKBENCH_DSH_GENERATION, WORKBENCH_UPSTREAM_COMMIT } from '../src/release-compatibility.ts'

function json(relative: string) {
  const source = readFileSync(new URL(`../../../${relative}`, import.meta.url), 'utf8').replace(/^\uFEFF/u, '')
  return JSON.parse(source) as Record<string, any>
}

describe('Workbench 15.2 rc5 identity', () => {
  it('keeps runtime metadata, Core dependencies, and migration lock on the same candidate', () => {
    const root = json('package.json')
    const core = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as Record<string, any>
    const provenance = json('provenance/dsh-0.2.1-rc.5.json')
    expect(WORKBENCH_CORE_VERSION).toBe('0.2.2-alpha.17.2')
    expect(WORKBENCH_DSH_GENERATION).toBe('0.2.1-rc.5')
    expect(WORKBENCH_UPSTREAM_COMMIT).toBe('b830ec950faba0a46dda564be3e2d854afed94f1')
    expect(root.devDependencies['@deepseek-ai/dsh']).toBe(WORKBENCH_DSH_GENERATION)
    expect(core.version).toBe(WORKBENCH_CORE_VERSION)
    expect(core.dsh.workbench).toMatchObject({ dshGeneration: WORKBENCH_DSH_GENERATION, upstreamCommit: WORKBENCH_UPSTREAM_COMMIT, candidateId: provenance.candidateId })
    expect(core.dsh.workbench.defaultInstall).toEqual(['@dsh-workbench/core'])
    expect(core.dsh.workbench.excludedModules).toEqual(['@dsh-workbench/conversation-suite', '@dsh-workbench/svgdeepseek-pet'])
    expect(core.dsh.client.officialMore).toBe('host-only-rc5-ui-entry-customization')
    for (const section of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
      for (const [name, version] of Object.entries(core[section] ?? {})) {
        if (name.startsWith('@deepseek-ai/dsh')) expect(version).toBe(WORKBENCH_DSH_GENERATION)
      }
    }
  })

  it('records rc5 Sidebar/Workspace provenance and keeps Conversation deferred', () => {
    const source = json('packages/workbench-core/rc5-sidebar-workspace-source-index.json')
    expect(source).toMatchObject({ generation: WORKBENCH_DSH_GENERATION, upstreamCommit: WORKBENCH_UPSTREAM_COMMIT, fileCount: 34 })
    expect(source.sourceDigest).toMatch(/^[a-f0-9]{64}$/u)
    const provenance = json('provenance/dsh-0.2.1-rc.5.json')
    expect(provenance.source.conversationMigration).toBe('deferred')
  })

  it('does not add the official More package as a Workbench-owned menu dependency', () => {
    const coreSource = readFileSync(new URL('../src/client/native-area-slot-renderer.tsx', import.meta.url), 'utf8')
    expect(coreSource).toContain('entry-customization')
    const packageSource = readFileSync(new URL('../package.json', import.meta.url), 'utf8')
    expect(packageSource).not.toContain('@deepseek-ai/dsh-client-ui-entry-customization')
  })

  it('keeps the shipped Creator preset on the rc5 identity', () => {
    const presetRoot = new URL('../presets/workbench-creator/skills/workbench-extension-development/', import.meta.url)
    const files = [
      'SKILL.md',
      'WORKBENCH-CONTAINER-INNER-PAGE-EXTENSION-SPEC.zh.md',
      'templates/workbench-editor/README.md',
      'templates/workbench-editor/package.json',
      'templates/workbench-editor/client.js',
    ]
    for (const file of files) {
      const source = readFileSync(new URL(file, presetRoot), 'utf8')
      expect(source).toContain(WORKBENCH_CORE_VERSION)
      expect(source).toContain(WORKBENCH_DSH_GENERATION)
      expect(source).toContain(WORKBENCH_UPSTREAM_COMMIT)
      expect(source).not.toContain('0.2.2-alpha.15')
      expect(source).not.toContain('0.2.1-rc.3')
    }
  })
})
