import type { WorkbenchModuleContextV1, WorkbenchModuleSourceV1 } from './module-contract.ts'
import { WORKBENCH_CORE_VERSION } from './release-compatibility.ts'

export const WORKBENCH_CORE_MANIFEST = {
  moduleId: 'workbench.core', kind: 'official-builtin' as const, delivery: 'core-bundled' as const, version: WORKBENCH_CORE_VERSION, coreCompatibility: WORKBENCH_CORE_VERSION,
  provides: {
    editorIds: ['workbench.workspace-files', 'workbench.terminal', 'workbench.browser', 'workbench.document-preview', 'workbench.conversation.start', 'workbench.conversation', 'workbench.agent-trajectory', 'workbench.changes-review', 'workbench.plan', 'workbench.schedule-task', 'workbench.guide', 'workbench.subagent-chat'],
    surfaces: [
      'workbench.core',
      'workbench.mode',
      'workbench.surface',
      'workbench.frame',
      'workbench.sidebar',
      'workbench.settings',
      'workbench.module-market',
      'workbench.official-surfaces',
      'workbench.conversation',
      'workbench.agent-trajectory',
    ],
  },
  requires: { capabilities: [], modules: [] }, activation: { mode: 'both', scope: 'root' },
} as const

export function createWorkbenchCoreModule(): WorkbenchModuleSourceV1 {
  let context: WorkbenchModuleContextV1 | undefined
  return {
    manifest: WORKBENCH_CORE_MANIFEST,
    register(next) { context = next },
    async activate() { context?.diagnostics.report({ moduleId: WORKBENCH_CORE_MANIFEST.moduleId, state: 'active' }) },
    async deactivate() { context = undefined },
    async migrate() { return { status: 'unchanged' as const } },
  }
}
