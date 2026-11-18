import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { WORKBENCH_CORE_VERSION, WORKBENCH_DSH_ENGINE_RANGE, WORKBENCH_DSH_GENERATION, WORKBENCH_UPSTREAM_COMMIT } from '../src/release-compatibility.ts'
import { workbenchVersionSatisfies } from '../src/module-source.ts'

function json(relative: string) {
  return JSON.parse(readFileSync(new URL(`../../../${relative}`, import.meta.url), 'utf8').replace(/^\uFEFF/u, '')) as Record<string, any>
}

describe('Workbench DSH runtime identity', () => {
  it('pins the runtime package and DSH dependency set to one candidate', () => {
    const root = json('package.json')
    const core = json('packages/workbench-core/package.json')
    expect(core.version).toBe(WORKBENCH_CORE_VERSION)
    expect(root.version).toBe(WORKBENCH_CORE_VERSION)
    expect(core.dsh.workbench.coreCompatibility).toBe(WORKBENCH_CORE_VERSION)
    expect(WORKBENCH_DSH_GENERATION).toBe('0.2.2-rc.3')
    expect(WORKBENCH_UPSTREAM_COMMIT).toBe('ddac96760b6edf8fa0fe17cbdcf0b512f4c12b2c')
    expect(core.engines.dsh).toBe(WORKBENCH_DSH_ENGINE_RANGE)
    expect(workbenchVersionSatisfies(WORKBENCH_DSH_GENERATION, WORKBENCH_DSH_ENGINE_RANGE)).toBe(true)
    expect(workbenchVersionSatisfies('0.2.2-rc.3', WORKBENCH_DSH_ENGINE_RANGE)).toBe(true)
    expect(workbenchVersionSatisfies('0.2.2', WORKBENCH_DSH_ENGINE_RANGE)).toBe(true)
    expect(workbenchVersionSatisfies('0.2.2-rc.1', WORKBENCH_DSH_ENGINE_RANGE)).toBe(false)
    expect(workbenchVersionSatisfies('0.2.3', WORKBENCH_DSH_ENGINE_RANGE)).toBe(false)
    expect(root.version).toBe(WORKBENCH_CORE_VERSION)
    expect(root.devDependencies['@deepseek-ai/dsh']).toBe(WORKBENCH_DSH_GENERATION)
    expect(core.dsh.workbench).toMatchObject({
      dshGeneration: WORKBENCH_DSH_GENERATION,
      upstreamCommit: WORKBENCH_UPSTREAM_COMMIT,
      candidateId: `dsh-bay-${WORKBENCH_CORE_VERSION}-dsh-${WORKBENCH_DSH_GENERATION}`,
    })
    for (const section of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
      for (const [name, version] of Object.entries(core[section] ?? {})) {
        if (!name.startsWith('@deepseek-ai/dsh')) continue
        expect(version).toBe(section === 'peerDependencies' ? WORKBENCH_DSH_ENGINE_RANGE : WORKBENCH_DSH_GENERATION)
      }
    }
  })

  it('uses the RC2 menu anchor and Sidebar source while keeping Area-local session routing', () => {
    const workspaceRoot = new URL('../src/foundation/workbench-sidebar/generated/upstream/ui-workspace/', import.meta.url)
    const picker = readFileSync(new URL('WorkspacePicker.tsx', workspaceRoot), 'utf8')
    const browser = readFileSync(new URL('rows/WorkspaceBrowser.tsx', workspaceRoot), 'utf8')
    const sidebar = readFileSync(new URL('../src/foundation/workbench-sidebar/generated/upstream/ui-sidebar/SidebarRoot.tsx', import.meta.url), 'utf8')
    const sidebarIndex = readFileSync(new URL('../src/foundation/workbench-sidebar/generated/upstream/ui-sidebar/index.ts', import.meta.url), 'utf8')
    expect(picker).toContain('anchorRef={anchorRef')
    expect(picker).not.toContain('getAnchorRect')
    expect(browser).toContain('anchorRef={wsPlusRef}')
    expect(sidebar).toContain("renderFactorySlot('sidebar.panel.icon'")
    expect(sidebarIndex).toContain("name: 'sidebar.panel.icon'")
    expect(sidebarIndex).toContain('}, PanelIcon)')
    expect(sidebar).toContain("from './scroll-handoff.ts'")

    const renderer = readFileSync(new URL('../src/client/native-area-slot-renderer.tsx', import.meta.url), 'utf8')
    expect(renderer).toContain('workbenchResourceMatchesSession(resource, upstreamSessionId)')
    expect(renderer).toContain('openChildAside')
  })

  it('preserves native per-Session AgentTeam selection and named SubAgent guidance', () => {
    const plan = json('compat/dsh-0.2.2-rc.2/manifest.json')
    const preset = readFileSync(new URL('../presets/workbench-creator/skills/workbench-extension-development/SKILL.md', import.meta.url), 'utf8')
    expect(plan.runtimeBoundary.agentTeams).toBe('native-per-session-opt-in')
    expect(preset).toContain('send_message({ agent, message })')
    expect(preset).toContain('Agent Teams default off for new Sessions')
    expect(preset).toContain('Bay Agent Work Items and Assignments remain a separate Workbench domain')
  })
})
