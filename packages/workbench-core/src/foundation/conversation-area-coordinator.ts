import type { SessionBindingV1 } from './model.ts'
import type { AreaClaimV1, PlacementResult } from './repository.ts'
import { WorkbenchRepository } from './repository.ts'
import { areasOf } from './document-v3.ts'

/** Exact asynchronous operation that owns one runtime-only Area claim. */
export type ConversationPlacementIntentV1 =
  | {
    type: 'create-in-workspace'
    claim: AreaClaimV1
    workspaceId: string
    agentPreset?: string
    /** Keep the Start editor visible until its first turn is submitted. */
    presentation?: 'start' | 'conversation'
    /** Stable Start occurrence that owns a prepared Session. */
    startModuleInstanceId?: string
  }
  | { type: 'open-existing'; claim: AreaClaimV1; target: SessionBindingV1 }
  | { type: 'create-from-directory'; claim: AreaClaimV1; path: string }

/** Host-owned Workspace and Session creation services used by the coordinator. */
export interface ConversationAreaServices {
  isStartCurrent?(workbenchId: string, areaId: string, moduleInstanceId: string): boolean
  connectWorkspace(workspaceId: string, options?: { agentPreset?: string }): Promise<{
    target: SessionBindingV1
    reusedBlank: boolean
  }>
  createWorkspaceSession(workspaceId: string, options: {
    requestId: string
    agentPreset?: string
  }): Promise<{
    target: SessionBindingV1
    reusedBlank: false
  }>
  createWorkspace(input: { path: string }): Promise<{ workspaceId: string }>
}

/** Coordinates Host-owned Session creation with a page-local, exact Area claim. */
export class ConversationAreaCoordinator {
  constructor(
    private readonly repository: WorkbenchRepository,
    private readonly services: ConversationAreaServices,
  ) {}

  /**
   * Resolve one creation/open intent and atomically commit it to the claimed Area.
   * @param intent - immutable placement target and creation operation.
   * @returns the bound, stale, or failed placement result.
   */
  async execute(intent: ConversationPlacementIntentV1): Promise<PlacementResult> {
    try {
      if (intent.type === 'open-existing') {
        return this.repository.bindConversation(intent.claim, intent.target, false)
      }
      if (intent.type === 'create-in-workspace' && intent.presentation === 'start') {
        if (intent.startModuleInstanceId === undefined) {
          return { status: 'failed', code: 'start-instance-missing', message: '\u65b0\u5efa\u5bf9\u8bdd\u5185\u9875\u5df2\u53d8\u5316\uff0c\u8bf7\u91cd\u65b0\u9009\u62e9 Workspace\u3002' }
        }
        if (this.services.isStartCurrent !== undefined
          && !this.services.isStartCurrent(intent.claim.workbenchId, intent.claim.areaId, intent.startModuleInstanceId)) {
          return { status: 'stale', reason: 'area-replaced' }
        }
        const document = this.repository.getWorkbench(intent.claim.workbenchId)?.document
        const area = document === undefined ? undefined : areasOf(document.root).find(item => item.areaId === intent.claim.areaId)
        const start = area?.moduleHistory.find(item => item.moduleInstanceId === area.activeModuleInstanceId)
        if (start?.moduleInstanceId !== intent.startModuleInstanceId || start.editorId !== 'workbench.conversation.start') {
          return { status: 'stale', reason: 'area-replaced' }
        }
        if (start.binding?.workspaceId === intent.workspaceId) {
          return { status: 'bound', target: start.binding, reusedBlank: false }
        }
        if (area?.moduleHistory.some(item => item.moduleInstanceId !== start.moduleInstanceId && item.binding !== undefined)) {
          return { status: 'failed', code: 'area-already-bound', message: '当前区域的其他内页正在使用已有对话，请在新区域中开始。' }
        }
      }
      const workspaceId = intent.type === 'create-in-workspace'
        ? intent.workspaceId
        : (await this.services.createWorkspace({ path: intent.path })).workspaceId
      const connection = await this.services.createWorkspaceSession(workspaceId, {
        requestId: intent.claim.requestId,
        ...(intent.type === 'create-in-workspace' && intent.agentPreset !== undefined
          ? { agentPreset: intent.agentPreset }
          : {}),
      })
      if (intent.type === 'create-in-workspace' && intent.presentation === 'start'
        && this.services.isStartCurrent !== undefined
        && !this.services.isStartCurrent(intent.claim.workbenchId, intent.claim.areaId, intent.startModuleInstanceId!)) {
        return { status: 'stale', reason: 'area-replaced', target: connection.target }
      }
      return this.repository.bindConversation(
        intent.claim, connection.target, connection.reusedBlank,
        intent.type === 'create-in-workspace' && intent.presentation === 'start'
          ? { presentation: 'start', startModuleInstanceId: intent.startModuleInstanceId! }
          : undefined,
      )
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason)
      return { status: 'failed', code: 'conversation-placement-failed', message: message.slice(0, 512) }
    }
  }
}
