import type { JsonValue, SessionBindingV1 } from '../foundation/model.ts'
import type { ReactNode } from 'react'
import type { WorkbenchEditorBackgroundRuntimeV1 } from '../module-contract.ts'
import type { WorkbenchEditorDeclarationV1 } from '../module-contract.ts'
import type { WorkbenchResourceRouteResult, WorkbenchResourceSourceV1 } from './workbench-resource-opener.ts'
import type { WorkbenchCollaborationClientV1 } from './workbench-collaboration-client.ts'

/** Core-owned instance state and explicit Area binding, independent of DSH's current Session. */
export interface WorkbenchEditorOwnerProps {
  readonly presentation?: 'floating' | 'area'
  /** Stable content identity for a movable instance; independent of placement. */
  readonly runtimeIdentity?: string
  registerCloseGuard?(guard: () => boolean | Promise<boolean>): () => void
  readonly instanceId: string
  /** Catalog identity of the mounted editor, used for collaboration presence. */
  readonly editorId?: string
  /** Runtime Workbench identity used by ephemeral LAN share presence. */
  readonly workbenchId?: string
  /** Host authoritative shared-control channel for this Workbench surface. */
  readonly collaborationClient?: WorkbenchCollaborationClientV1 | undefined
  /** Disposable display location; never use as a durable project key. */
  readonly areaId?: string
  /** Stable project identity, also supplied to project pages without a Session. */
  readonly projectId?: string
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
  /** Use Core's shared loading surface while this inner page awaits data. */
  renderLoading?(options?: { label?: string; compact?: boolean }): ReactNode
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
