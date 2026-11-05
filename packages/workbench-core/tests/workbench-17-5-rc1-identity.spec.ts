import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { WORKBENCH_CORE_VERSION, WORKBENCH_DSH_GENERATION, WORKBENCH_UPSTREAM_COMMIT } from '../src/release-compatibility.ts'

function json(relative: string) {
  const source = readFileSync(new URL(`../../../${relative}`, import.meta.url), 'utf8').replace(/^\uFEFF/u, '')
  return JSON.parse(source) as Record<string, any>
}

describe('Workbench 17.5 rc1 identity', () => {
  it('keeps runtime metadata, Core dependencies, and migration lock on the same candidate', () => {
    const root = json('package.json')
    const core = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as Record<string, any>
    const provenance = json('provenance/dsh-0.2.2-rc.1.json')
    expect(WORKBENCH_CORE_VERSION).toBe('0.2.2-alpha.17.5')
    expect(WORKBENCH_DSH_GENERATION).toBe('0.2.2-rc.1')
    expect(WORKBENCH_UPSTREAM_COMMIT).toBe('66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db')
    expect(root.devDependencies['@deepseek-ai/dsh']).toBe(WORKBENCH_DSH_GENERATION)
    expect(core.version).toBe(WORKBENCH_CORE_VERSION)
    expect(core.dsh.workbench).toMatchObject({ dshGeneration: WORKBENCH_DSH_GENERATION, upstreamCommit: WORKBENCH_UPSTREAM_COMMIT, candidateId: provenance.candidateId })
    expect(core.dsh.workbench.defaultInstall).toEqual(['@dsh-workbench/core'])
    expect(core.dsh.workbench.excludedModules).toEqual(['@dsh-workbench/conversation-suite', '@dsh-workbench/svgdeepseek-pet'])
    expect(core.dsh.client.officialMore).toBe('host-only-rc1-ui-entry-customization')
    expect(core.dsh.client.external).not.toContain('@deepseek-ai/dsh-api-workspace-controller/default-workspace')
    for (const section of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
      for (const [name, version] of Object.entries(core[section] ?? {})) {
        if (name.startsWith('@deepseek-ai/dsh')) expect(version).toBe(WORKBENCH_DSH_GENERATION)
      }
    }
  })

  it('records rc1 Sidebar/Workspace provenance and keeps Conversation deferred', () => {
    const source = json('packages/workbench-core/rc1-sidebar-workspace-source-index.json')
    expect(source).toMatchObject({ generation: WORKBENCH_DSH_GENERATION, upstreamCommit: WORKBENCH_UPSTREAM_COMMIT, fileCount: 34 })
    expect(source.sourceDigest).toMatch(/^[a-f0-9]{64}$/u)
    const provenance = json('provenance/dsh-0.2.2-rc.1.json')
    expect(provenance.source.conversationMigration).toBe('deferred')
  })

  it('bundles the RC1 default Workspace label helper without a module-table request', () => {
    const core = json('packages/workbench-core/package.json')
    const workspaceRoot = 'packages/workbench-core/src/foundation/workbench-sidebar/generated/upstream/ui-workspace/'
    const picker = readFileSync(new URL(`../../../${workspaceRoot}WorkspacePicker.tsx`, import.meta.url), 'utf8')
    const browser = readFileSync(new URL(`../../../${workspaceRoot}rows/WorkspaceBrowser.tsx`, import.meta.url), 'utf8')
    expect(picker).toContain('default-workspace.ts')
    expect(browser).toContain('default-workspace.ts')
    expect(picker).not.toContain('@deepseek-ai/dsh-api-workspace-controller/default-workspace')
    expect(browser).not.toContain('@deepseek-ai/dsh-api-workspace-controller/default-workspace')
    expect(core.dsh.client.external).not.toContain('@deepseek-ai/dsh-api-workspace-controller/default-workspace')
  })

  it('does not add the official More package as a Workbench-owned menu dependency', () => {
    const coreSource = readFileSync(new URL('../src/client/native-area-slot-renderer.tsx', import.meta.url), 'utf8')
    expect(coreSource).toContain('entry-customization')
    const packageSource = readFileSync(new URL('../package.json', import.meta.url), 'utf8')
    expect(packageSource).not.toContain('@deepseek-ai/dsh-client-ui-entry-customization')
  })

  it('keeps the shipped Creator preset on the rc1 identity', () => {
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
