import { describe, expect, it } from 'vitest'
import { createWorkbenchCoreRuntime } from '../src/core-runtime.ts'
import { WORKBENCH_CORE_MANIFEST } from '../src/index.ts'

const digest = (character: string): string => character.repeat(64)

describe('Workbench Core standalone runtime', () => {
  it('declares the complete Core foundation and its DSH-owned official Area editors', () => {
    expect(WORKBENCH_CORE_MANIFEST.provides.surfaces).toEqual(expect.arrayContaining([
      'workbench.frame',
      'workbench.sidebar',
      'workbench.settings',
      'workbench.module-market',
    ]))
    expect(WORKBENCH_CORE_MANIFEST.provides.editorIds).toEqual([
      'workbench.workspace-files',
      'workbench.terminal',
      'workbench.browser',
      'workbench.document-preview',
      'workbench.conversation.start',
      'workbench.conversation',
      'workbench.agent-trajectory',
      'workbench.changes-review',
      'workbench.plan',
      'workbench.schedule-task',
      'workbench.guide',
      'workbench.subagent-chat',
    ])
    expect(WORKBENCH_CORE_MANIFEST.provides.surfaces).toContain('workbench.official-surfaces')
    expect(WORKBENCH_CORE_MANIFEST.provides.surfaces).toContain('workbench.official-surfaces')
  })

  it('starts with native conversation surfaces available without an optional Suite module', () => {
    const runtime = createWorkbenchCoreRuntime({
      core: { moduleId: 'workbench.core', version: '1.0.0', artifactDigest: digest('a') },
    })
    expect(runtime.getSnapshot()).toMatchObject({
      state: 'modules-ready',
      activeModules: [],
      registeredModules: [],
      canEnterWorkbench: true,
      emptyState: undefined,
    })
  })

  it('keeps the runtime ready when a legacy Conversation Suite identity is later observed', () => {
    const runtime = createWorkbenchCoreRuntime({
      core: { moduleId: 'workbench.core', version: '1.0.0', artifactDigest: digest('a') },
    })
    // Core owns the native surface; the legacy receipt is metadata only.
    expect(runtime.getSnapshot().canEnterWorkbench).toBe(true)
    runtime.registerModule({ moduleId: 'workbench.conversation-suite', version: '1.0.0', artifactDigest: digest('b') })
    runtime.setModuleState('workbench.conversation-suite', 'active')
    expect(runtime.getSnapshot()).toMatchObject({ state: 'modules-ready', canEnterWorkbench: true })
  })

  it('rejects an identity change instead of silently replacing a module', () => {
    const runtime = createWorkbenchCoreRuntime({
      core: { moduleId: 'workbench.core', version: '1.0.0', artifactDigest: digest('a') },
    })
    runtime.registerModule({ moduleId: 'workbench.shell', version: '1.0.0', artifactDigest: digest('b') })
    expect(() => runtime.registerModule({ moduleId: 'workbench.shell', version: '1.0.1', artifactDigest: digest('c') }))
      .toThrow('identity conflict')
  })

  it('waits for layout persistence before returning to official mode', async () => {
    let finishSave!: (saved: boolean) => void
    let writes = 0
    const runtime = createWorkbenchCoreRuntime({
      core: WORKBENCH_CORE_MANIFEST,
      flush: () => { writes++; return new Promise(resolve => { finishSave = resolve }) },
    })
    await runtime.mode.enter()
    runtime.mode.focusArea('area-fixture')
    const exiting = runtime.mode.exit()
    const duplicateExit = runtime.mode.exit()
    expect(runtime.mode.getSnapshot()).toMatchObject({ mode: 'exiting', focusedAreaId: 'area-fixture' })
    expect(writes).toBe(1)
    finishSave(true)
    await Promise.all([exiting, duplicateExit])
    expect(runtime.mode.getSnapshot()).toEqual({ mode: 'official' })
  })

  it('keeps the current Area available after a failed save and permits retry', async () => {
    let saved = false
    const runtime = createWorkbenchCoreRuntime({ core: WORKBENCH_CORE_MANIFEST, flush: async () => saved })
    await runtime.mode.enter()
    runtime.mode.focusArea('area-fixture')
    await expect(runtime.mode.exit()).rejects.toThrow('无法退出工作台模式')
    expect(runtime.mode.getSnapshot()).toMatchObject({ mode: 'workbench', focusedAreaId: 'area-fixture' })
    saved = true
    await runtime.mode.exit()
    expect(runtime.mode.getSnapshot()).toEqual({ mode: 'official' })
  })
})
