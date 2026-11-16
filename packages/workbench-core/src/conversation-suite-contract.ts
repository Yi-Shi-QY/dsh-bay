import type { WorkbenchModuleIdentityV1 } from './module-catalog.ts'

export const WORKBENCH_CONVERSATION_SUITE_REGISTRAR_SERVICE_NAME = 'workbenchConversationSuiteRegistrar'
export const WORKBENCH_CONVERSATION_SUITE_IDENTITY_SERVICE_NAME = 'workbenchConversationSuiteIdentity'

export const WORKBENCH_CONVERSATION_SUITE_EDITOR_IDS = Object.freeze({
  start: 'workbench.conversation.start',
  conversation: 'workbench.conversation',
  trajectory: 'workbench.agent-trajectory',
})

export interface WorkbenchConversationSuiteEditorSetV1 {
  readonly start: unknown
  readonly conversation: unknown
  readonly trajectory: unknown
}

/** A Host-verified catalog identity projected by Core after DSH restarts. */
export interface WorkbenchVerifiedModuleIdentitySourceV1 {
  get(moduleId: 'workbench.conversation-suite'): WorkbenchModuleIdentityV1 | undefined
}

/**
 * Contract exposed to the reviewed Conversation Suite. The browser-only Core
 * implementation retains Slot authority and accepts components through this
 * narrow registration seam.
 */
export interface WorkbenchConversationSuiteRegistrarV1 {
  register(input: {
    readonly identity: WorkbenchModuleIdentityV1
    readonly editors: WorkbenchConversationSuiteEditorSetV1
  }): () => void
}
