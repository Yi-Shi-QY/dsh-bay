import type { JsonValue, SessionBindingV1 } from '../foundation/model.ts'
import type { WorkbenchEditorBackgroundRuntimeV1 } from '../module-contract.ts'
import type { WorkbenchEditorDeclarationV1 } from '../module-contract.ts'
import type { WorkbenchResourceRouteResult, WorkbenchResourceSourceV1 } from './workbench-resource-opener.ts'

/** Core-owned instance state and explicit Area binding, independent of DSH's current Session. */
export interface WorkbenchEditorOwnerProps {
  readonly instanceId: string
  /** Runtime Workbench identity used by ephemeral LAN share presence. */
  readonly workbenchId?: string
  /** Whether the Host share session is active for this runtime page. */
  readonly sharePresenceEnabled?: boolean
  readonly areaId?: string
  readonly sessionId?: string
  readonly workspaceId?: string
  readonly bindingGeneration?: number
  readonly areaClaim?: string
  readonly state: JsonValue
  readonly lifecycle?: {
    readonly visibility: 'visible' | 'background' | 'collapsed'
    /** Whether this Area currently owns keyboard focus. Visibility is independent. */
    readonly focused: boolean
    readonly background?: WorkbenchEditorBackgroundRuntimeV1
    readonly collapsed?: WorkbenchEditorBackgroundRuntimeV1
  }
  /** The Core-validated declaration for this editor instance. */
  readonly declaration?: WorkbenchEditorDeclarationV1
  setState(next: JsonValue): void
  placeConversation?(input: { workspaceId: string; agentPreset?: string; presentation?: 'start' | 'conversation' }): Promise<SessionBindingV1>
  completePreparedConversation?(input: {
    moduleInstanceId: string
    bindingGeneration: number
    target: SessionBindingV1
  }): boolean
  /**
   * Dispatch a DSH-native tab action into the owning Workbench Area.
   *
   * Native sidebar bodies call `tab.actions.openTab()` and `tab.actions.close()`
   * as part of their normal interaction.  The adapter must route those actions
   * to Workbench layout commands instead of silently dropping them or opening
   * a tab in DSH's global Sidebar.
   */
  openNativeTab?(kind: string, options?: Record<string, unknown>): boolean | void
  /** Route a DSH Conversation resource into this Area, preserving explicit native fallback separately from rejection. */
  openConversationResource?(address: string, placement?: Record<string, unknown>, source?: WorkbenchResourceSourceV1): WorkbenchResourceRouteResult
  forkAt?(seq: number): void
  openSession?(sessionId: string): Promise<void>
  close(): void
  focus(): void
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    'workbench.editor.root': {
      kind: 'list'
      scope: 'root'
      owner: WorkbenchEditorOwnerProps
    }
    'workbench.editor.session': {
      kind: 'list'
      scope: 'root'
      owner: WorkbenchEditorOwnerProps
    }
  }
}
