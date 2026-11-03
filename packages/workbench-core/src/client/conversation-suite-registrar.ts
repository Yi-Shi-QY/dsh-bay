import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { WorkbenchModuleIdentityV1 } from '../module-catalog.ts'
import type { WorkbenchCoreRuntimeV1 } from '../core-runtime.ts'
import {
  WORKBENCH_CONVERSATION_SUITE_EDITOR_IDS,
  type WorkbenchConversationSuiteRegistrarV1,
} from '../conversation-suite-contract.ts'

export {
  WORKBENCH_CONVERSATION_SUITE_EDITOR_IDS,
  WORKBENCH_CONVERSATION_SUITE_IDENTITY_SERVICE_NAME,
  WORKBENCH_CONVERSATION_SUITE_REGISTRAR_SERVICE_NAME,
} from '../conversation-suite-contract.ts'
export type { WorkbenchConversationSuiteEditorSetV1, WorkbenchConversationSuiteRegistrarV1, WorkbenchVerifiedModuleIdentitySourceV1 } from '../conversation-suite-contract.ts'

function disposerOf(value: unknown): () => void {
  return typeof value === 'function' ? value as () => void : () => {}
}

function assertConversationSuiteIdentity(identity: WorkbenchModuleIdentityV1): void {
  if (identity.moduleId !== 'workbench.conversation-suite') {
    throw new Error(`Workbench Core only accepts the Conversation Suite here: ${identity.moduleId}`)
  }
  if (!/^[a-f0-9]{64}$/iu.test(identity.artifactDigest)) {
    throw new Error('Workbench Conversation Suite requires a SHA-256 artifact digest')
  }
}

export function createWorkbenchConversationSuiteRegistrar(
  ctx: ClientContext,
  runtime: WorkbenchCoreRuntimeV1,
): WorkbenchConversationSuiteRegistrarV1 {
  let activeIdentity: WorkbenchModuleIdentityV1 | undefined

  return {
    register({ identity, editors }) {
      assertConversationSuiteIdentity(identity)
      if (activeIdentity !== undefined) {
        if (activeIdentity.version === identity.version
          && activeIdentity.artifactDigest.toLowerCase() === identity.artifactDigest.toLowerCase()) {
          return () => {}
        }
        throw new Error('Workbench Conversation Suite is already registered with a different identity')
      }
      if (editors.start === undefined || editors.conversation === undefined || editors.trajectory === undefined) {
        throw new Error('Workbench Conversation Suite must provide its three Workbench editor components')
      }

      runtime.registerModule(identity)
      const registrations: Array<() => void> = [
        disposerOf(ctx.slots.inject('workbench.editor.root', () => ctx.slots.register({
          name: 'workbench.editor.root',
          id: WORKBENCH_CONVERSATION_SUITE_EDITOR_IDS.start,
          label: '新建对话',
          order: 20,
        } as never, editors.start as never))),
        disposerOf(ctx.slots.inject('workbench.editor.session', () => ctx.slots.register({
          name: 'workbench.editor.session',
          id: WORKBENCH_CONVERSATION_SUITE_EDITOR_IDS.conversation,
          children: { 'workbench.conversation.native-scope': { kind: 'list', scope: 'session' } },
          label: '对话',
          order: 20,
        } as never, editors.conversation as never))),
        disposerOf(ctx.slots.inject('workbench.editor.session', () => ctx.slots.register({
          name: 'workbench.editor.session',
          id: WORKBENCH_CONVERSATION_SUITE_EDITOR_IDS.trajectory,
          children: { 'workbench.trajectory.native-scope': { kind: 'list', scope: 'session' } },
          label: 'Agent 轨迹',
          order: 30,
        } as never, editors.trajectory as never))),
      ]
      activeIdentity = identity
      runtime.setModuleState(identity.moduleId, 'active')

      let disposed = false
      return () => {
        if (disposed) return
        disposed = true
        for (const dispose of registrations.reverse()) dispose()
        activeIdentity = undefined
        // This is lifecycle cleanup during DSH shutdown or development
        // replacement. V1 installation itself remains restart-only.
        try { runtime.setModuleState(identity.moduleId, 'registered') } catch { /* Core is already gone. */ }
      }
    },
  }
}
