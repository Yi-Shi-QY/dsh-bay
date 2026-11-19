import { WorkbenchProjectOverview } from './WorkbenchProjectOverview.tsx'
import { WorkbenchBrowserFolderButton } from './WorkbenchBrowserFolderButton.tsx'
import { connectSharedFloatingWorkspace } from '../client/shared-floating-workspace.ts'
import { WorkbenchImportDirectoryRequests } from './WorkbenchCompletePackagePanel.tsx'
import { WorkbenchCollaborationApprovals, WorkbenchShareGrantControls } from './WorkbenchSharePermissions.tsx'
import { workbenchAccess } from '../client/workbench-access.ts'
import { RetainedEditorTarget, useFloatingWorkspace, FloatingWorkspaceUnread } from './FloatingWorkspaceContext.tsx'
import type { FloatingWorkspaceRuntime } from '../client/floating-workspace-runtime.ts'
import { floatingInstanceKey } from '../client/floating-workspace-runtime.ts'
import { WorkbenchFloatingWorkspace, FloatingWorkspaceToolbarButton } from './WorkbenchFloatingWorkspace.tsx'
import { WorkbenchEmptyArea } from './WorkbenchEmptyArea.tsx'
import { WorkbenchPageLoading } from './WorkbenchPageLoading.tsx'
import { WorkbenchEditorPicker } from './WorkbenchEditorPicker.tsx'
import type { WorkbenchEditorSvgIconV1 } from './workbench-editor-icons.ts'
import { WorkbenchCreateDialog } from './WorkbenchCreateDialog.tsx'
import { WorkbenchContextDialog } from './WorkbenchContextDialog.tsx'
import { AreaProjectDialog } from './AreaProjectDialog.tsx'
import { AreaProjectButton } from './AreaProjectButton.tsx'
import { WorkbenchMemoryDialog } from './WorkbenchMemoryDialog.tsx'
import { WorkbenchCreateMenu } from './WorkbenchCreateMenu.tsx'
import type { WorkbenchLayoutPresetId } from './workbench-layout-presets.ts'
import { WorkbenchEditorIcon as EditorIcon } from './WorkbenchEditorIcon.tsx'
import { WorkbenchTabStatus } from './WorkbenchTabStatus.tsx'
import { WorkbenchTabTooltip } from './WorkbenchTabTooltip.tsx'
import type { WorkbenchTabInformationSession } from './tab-information.ts'
import type { ConversationTabStatusSource } from '../client/conversation-tab-status.ts'
import { useConversationTabStatus } from '../client/use-conversation-tab-status.ts'
import {
  memo, Profiler, Suspense, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore,
  type ChangeEvent, type CSSProperties, type KeyboardEvent, type MutableRefObject, type ProfilerOnRenderCallback, type ReactNode, type RefObject,
} from 'react'
import { createPortal } from 'react-dom'
import {
  IconChevronLeftOutlineMedium, IconChevronRightOutlineMedium, IconCloseOutlineMedium,
  IconChevronDownOutlineMedium, IconChevronUpOutlineMedium, IconCheckOutlineMedium,
  IconCompareSplitOutlineMedium, IconCopyOutlineMedium, IconDatabaseOutlineMedium,
  IconEditOutlineMedium,
  IconEllipsisOutlineMedium, IconFlatListOutlineMedium, IconFolderOpenOutlineMedium, IconListPenOutlineMedium,
  IconLinkOutlineMedium, IconPlusOutlineMedium, IconSearchOutlineMedium, IconSettingsOutlineMedium,
  IconShareOutlineMedium, IconPinOutlineMedium,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { WorkbenchCoreSidebarProps } from './WorkbenchCoreSidebar.tsx'
import type {
  HostObservable, InjectFace, PropsRenderSlots, PropsRuntime,
} from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { WorkspaceSnapshot as WorkspaceListState } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { SettingsScopeSnapshot, WorkbenchSettingsScope as SettingsScope } from '../client/workbench-settings-contracts.ts'
import type {
  SessionOpenCommandV1, SessionPlacementRequestV2, SessionPlacementReservationV1, SessionTarget,
} from './workbench-session-navigation.ts'
import {
  resolveWorkbenchEditorPresentation,
  type WorkbenchEditorCatalog,
  type WorkbenchEditorCatalogRow,
} from './catalog.ts'
import {
  buildWorkbenchAreaTabRows,
  conversationTabBinding,
  conversationTabUnavailable,
  indexWorkbenchAreaOrdinals,
  indexWorkbenchEditors,
  workbenchEditorFromIndex,
  type WorkbenchAreaTabSummary,
  type WorkbenchEditorIndex,
} from './area-tab-rows.ts'
import {
  applyLayoutCommand, canMergeGroups, createSessionTab, defaultLayout, groupsOf, migrateOuterShellEditors,
  sessionTargetKey, tabsOf,
  type DropEdge, type GroupNode, type JsonValue, type LayoutCommand, type LayoutNode,
  type SessionBindingV1, type SplitNode, type TabDocument, type WorkbenchLayoutDocument,
} from './model.ts'
import { workbenchEditorStateFailureV1 } from '../workbench-editor-state.ts'
import { activePageSessionBinding } from './area-session-binding.ts'
import accentFrameCss from './SessionAccentFrame.module.css'
import {
  accountFor, normalizeWorkbenchTags, type SessionMarkerRecord, type WorkbenchSettings, type WorkbenchSettingsV4,
  type WorkspaceAccountKey,
} from './persistence.ts'
import {
  allocateSessionMarker, ensureSessionMarkers, SESSION_ACCENT_TOKENS, SESSION_MARKER_EMOJIS, validateSessionLabel,
} from './session-markers.ts'
import { sessionBindingCopy } from './binding-copy.ts'
import { useWorkbenchLocale, workbenchPageTitle } from './workbench-locale.ts'
import { placementReason, sameEditorSource, areaOperationCopy } from './area-identity.ts'
import type { WorkbenchDirectory } from './frame-settings-adapter.ts'
import {
  applyWorkbenchCommandV3, migrateDocumentV2ToV3, projectDocumentV3ToLayoutV2, validateWorkbenchDocumentV3,
} from './document-v3.ts'
import { buildWorkbenchInventory } from './workbench-inventory.ts'
import {
  deriveWorkbenchPreviewModel,
  type WorkbenchPreviewArea as PreviewArea,
  type WorkbenchPreviewModel,
  type WorkbenchPreviewModelSelectionSource,
  type WorkbenchPreviewNode,
  type WorkbenchPreviewPage,
  type WorkbenchPreviewSession,
} from './workbench-preview.ts'
import type { SlotPreviewNodeV1 } from './workbench-slot-contracts.ts'
import {
  WORKBENCH_HIGH_RISK_PERMISSIONS_V1,
  type WorkbenchPackageImportDependencyStatusV1,
  type WorkbenchPackageImportProgressV1,
  type WorkbenchPackageImportResultV1, type WorkbenchPackagePreflightResultV1,
} from './workbench-package-import.ts'
import type {
  WorkbenchExternalBindingRefV1,
  WorkbenchPackageServiceV1,
} from './workbench-package-service.ts'
import type { WorkbenchEditorBindingPolicyV1 } from '../module-contract.ts'
import type { WorkbenchDistributionRuntimeStatusV1, WorkbenchRuntimeReadinessSnapshotV1 } from './workbench-distribution-runtime.ts'
import type {
  WorkbenchDependencyAvailabilityV1, WorkbenchDependencyIssueV1,
  WorkbenchDependencyLockEntryV1, WorkbenchDependencySnapshotV1,
} from './workbench-distribution.ts'
import type {
  WorkbenchExportReadinessInspectionV1,
  WorkbenchReadinessRepairV1,
} from './workbench-export-readiness.ts'
import { workbenchExtensionAccessForEditorV1, workbenchExtensionUnavailableCopyV1, type WorkbenchExtensionAccessRowV1, type WorkbenchExtensionAccessSnapshotV1 } from '../workbench-extension-access.ts'
import type { WorkbenchExtensionRegistryV1 } from '../client/workbench-extension-registry.ts'
import { WorkbenchRepository, type PlacementResult } from './repository.ts'
import { ConversationAreaCoordinator } from './conversation-area-coordinator.ts'
import type { WorkbenchShellSidebarRoutingV1, WorkbenchSidebarHostActionsV1 } from './workbench-sidebar-browser.tsx'
import {
  resolveSessionTarget, type ResolvedSessionTarget,
} from './session-target-resolver.ts'
import {
  insertedRatioAtPointer, resolveSplitTarget,
  type SplitTarget, type SplitTargetEdge, type SplitTargetOrientation,
} from './split-target.ts'
import {
  AREA_HEADER_SIZE,
  COLLAPSED_DIVIDER_SIZE,
  EXPANDED_AREA_MIN_HEIGHT,
  EXPANDED_AREA_MIN_WIDTH,
  compactFootprint,
  deriveCollapseProjection,
  projectedMinimumFootprint,
  summaryGridTracks,
  splitGridTracks,
  validCollapseState,
  type CollapseIntent,
} from './collapse-projection.ts'
import {
  areAreaContentRenderPropsEqual,
  isAreaContentCommandCurrent,
  type AreaContentRenderPropsV1,
  type AreaContentCommandIdentityV1,
  type AreaContentProjectionV1,
} from './area-content-projection.ts'
import {
  SplitResizeControllerV1,
  splitResizeRatioForPointerV1,
} from './split-resize-controller.ts'
import {
  beginSplitResizeMeasurement,
  createWorkbenchResizeObserver,
  finishSplitResizeMeasurement,
  isWorkbenchResizeMetricsEnabled,
  recordAreaContentMount,
  recordSplitResizeCssWrite,
  recordSplitResizeFrame,
  recordSplitResizeGeometryRead,
  recordSplitResizePointerMove,
  recordSplitResizeReactCommit,
} from './split-resize-metrics.ts'
import css from './WorkbenchFrame.module.css'
import { WorkbenchBrowserAction } from './WorkbenchBrowserAction.tsx'
import { createPendingSessionTab, editorsAvailableForWorkbenchContext, prepareFloatingTabForArea, selectableWorkbenchEditors } from './editor-selection.ts'
import type { WorkbenchRuntimeMetricsSinkV1 } from './workbench-runtime-metrics.ts'
import { WorkbenchBrowserControlPage } from './WorkbenchBrowserControlPage.tsx'
import { closeWorkbenchNative } from '../client/native-sidebar-area-editor.tsx'
import { workbenchNativeSidebarForKind, workbenchNativeSidebarForResourceAddress } from '../client/native-sidebar-registry.ts'
import {
  routeWorkbenchConversationResource, workbenchConversationResourceType, workbenchResourceMatchesSession,
  type WorkbenchResourceRouteResult, type WorkbenchResourceSourceV1,
} from '../client/workbench-resource-opener.ts'
import {
  conversationResourceActionFor,
  normalizeWorkbenchConversationInteractionPolicy, workbenchTabFontSizePx,
  type WorkbenchConversationInteractionPolicyV1,
} from '../workbench-interaction-policy.ts'
import {
  getWorkbenchNativeTabTitle,
  subscribeWorkbenchNativeTabTitles,
} from '../client/native-tab-title-registry.tsx'
import {
  normalizeWorkbenchWindowSnapshot,
  unsupportedWorkbenchWindowController,
  type WorkbenchWindowControllerV1,
} from '../client/workbench-window-controller.ts'
import type { WorkbenchToolGatewayManagerV1 } from '../tool-gateway.ts'
import type { WorkbenchToolUsageServiceV1 } from '../tool-usage.ts'
import { WorkbenchAgentAssemblyDialog } from './WorkbenchAgentAssemblyDialog.tsx'
import type { WorkbenchShareControllerV1, WorkbenchShareSnapshotV1 } from '../client/workbench-share-controller.ts'
import { DESKTOP_WORKBENCH_SURFACE_V1, type WorkbenchSurfaceContextV1, type WorkbenchSurfaceContextV2 } from '../client/workbench-surface-context.ts'
import type { WorkbenchCollaborationClientV1 } from '../client/workbench-collaboration-client.ts'
import { collaborationStatusLabel } from './WorkbenchSharedCanvasViewport.tsx'
import type { SharedCanvasFocusV1, WorkbenchCollaborationSnapshotV1 } from '../workbench-collaboration-contract.ts'
import type { BayAgentControllerV1 } from './workbench-bay-agent-work.ts'
import { bayAgentWorkbenchTarget } from '../client/bay-agent-controller.ts'

const EMPTY_WORKBENCH_SHARE_SNAPSHOT: WorkbenchShareSnapshotV1 = Object.freeze({
  supported: false, sessions: Object.freeze([]), links: Object.freeze({}),
})

function sharedLayoutOf(value: unknown): WorkbenchLayoutDocument | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const candidate = value as { version?: unknown; root?: unknown; activeGroupId?: unknown }
  return candidate.version === 2 && typeof candidate.activeGroupId === 'string' && typeof candidate.root === 'object' && candidate.root !== null
    ? value as WorkbenchLayoutDocument
    : undefined
}

type WorkbenchSelectionTrace = {
  readonly id: string
  readonly targetWorkbenchId: string
}

type WorkbenchFrameTransition = {
  readonly kind: 'selection'
  readonly fromWorkbenchId: string
  readonly workbenchId: string
}

function workbenchSelectionMark(trace: WorkbenchSelectionTrace | undefined, phase: string): void {
  if (trace === undefined || typeof performance === 'undefined') return
  const diagnostics = (globalThis as { __DSH_WORKBENCH_PERF_DIAGNOSTICS__?: unknown }).__DSH_WORKBENCH_PERF_DIAGNOSTICS__
  if (diagnostics !== true) return
  performance.mark(`dsh-workbench-selection:${trace.id}:${phase}`)
}

export type WorkbenchFrameProps =
  // Workbench is rendered under its additive shell.overlay contribution.
  // `layout.frame` remains exclusively owned by official DSH.
  & PropsRuntime<'root'>
  & PropsRenderSlots<'workbench.editor.root' | 'workbench.editor.session'>
  & {
    renderSidebar: (props: Omit<WorkbenchCoreSidebarProps, 'exit' | 'openSettings' | 'settingsOpen'>) => ReactNode
    bindLayout: (actions: { toggleSidebar: () => void; openDetails: () => void; closeDetails: () => void }) => () => void
    bindNavigation: (handler: WorkbenchNavigationHandler) => () => void
    selectSession: (sessionId: SessionId) => void
    settings: SettingsScope<WorkbenchSettings>
    floatingRuntime?: FloatingWorkspaceRuntime
    editorCatalog: WorkbenchEditorCatalog
    extensionRegistry?: WorkbenchExtensionRegistryV1
    sidebarCompatibility: SidebarCompatibilityProbe
    projectNeutral?: boolean
    workbenchDirectory?: WorkbenchDirectory
    connectWorkspace?: (workspaceId: string, options?: { agentPreset?: string }) => Promise<{
      target: SessionBindingV1
      reusedBlank: boolean
    }>
    createWorkspaceSession?: (workspaceId: string, options: {
      requestId: string
      agentPreset?: string
      /** Create through the Host so the Session joins this Workbench's catalog. */
      workbenchId?: string
      areaId?: string
    }) => Promise<{
      target: SessionBindingV1
      reusedBlank: false
    }>
    createWorkspace?: (path: string) => Promise<{ workspaceId: string }>
    pickDirectory?: () => Promise<string | null>
    sidebarHostActions: WorkbenchSidebarHostActionsV1
    openOfficialSession?: (sessionId: string, assertClaim: () => void) => Promise<void>
    /** Desktop embeds Workbench in the official DSH content column. */
    embeddedDesktop?: boolean
    desktopControls?: { openSettings: (options?: import('./settings-context.ts').WorkbenchSettingsOpenOptionsV1) => void }
     /** Optional host-owned native window lifecycle; absent on DSH hosts without this capability. */
     windowController?: WorkbenchWindowControllerV1
    /** Workbench-scoped MCP/CLI/Tool/Skill discovery and visibility policy. */
     toolGateway?: WorkbenchToolGatewayManagerV1
    /** Optional read-only DSH Session usage projection for the gateway drawer. */
    toolUsageService?: WorkbenchToolUsageServiceV1
    /** Rendering surface; browser surfaces remain pinned to one Host workbench. */
    surfaceContext?: WorkbenchSurfaceContextV1 | WorkbenchSurfaceContextV2
    /** Host-authoritative collaboration channel for shared-control surfaces. */
    collaborationClient?: WorkbenchCollaborationClientV1 | undefined
    /** Browser view initiates reclaim with its own Host-issued window identity. */
    requestBrowserReclaim?: (workbenchId: string) => Promise<boolean>
    /** Optional host diagnostics sink. Metrics are runtime-only and never persisted. */
    runtimeMetrics?: WorkbenchRuntimeMetricsSinkV1
    /** Host-only LAN share management; shared-control participants do not receive this adapter. */
    shareController?: WorkbenchShareControllerV1
    /** User preference for Conversation resource routing in Workbench mode. */
    conversationResourcePolicy?: WorkbenchConversationInteractionPolicyV1 | undefined
    /** Paint conversation marker colors around Areas and the floating workspace. */
    showSessionAccentFrames?: boolean
    /** UI-only surface inside Workbench mode. Browser views always remain workbench. */
    surfaceView?: 'home' | 'workbench'
    /** Fixed rail entry for the virtual Workbench Home surface. */
    onShowHome?: (() => void) | undefined
    /** Return to the layout surface after a Workbench is selected or created. */
    onShowWorkbench?: (() => void) | undefined
    onImportWorkbench?: (() => void) | undefined
    onManageEditors?: (() => void) | undefined
    beforeHomeLeave?: (() => Promise<boolean>) | undefined
    /** Content rendered in place of the layout canvas while Home is active. */
    renderHome?: ReactNode | undefined
    /** Bay Agent's Workbench-owned controller and runtime state. */
    bayAgent?: BayAgentControllerV1
    conversationStatus?: ConversationTabStatusSource
    /** DSH-native Bay Agent draft generation for human context editing. */
    generateContextDraft?: import('./workbench-ai.ts').WorkbenchAiDraftGeneratorV1['generateContextDraft']
  }

interface WorkbenchNavigationHandler {
  dispatch(command: SessionOpenCommandV1): void
  reserve(request: SessionPlacementRequestV2): SessionPlacementReservationV1
  resolve(reservation: SessionPlacementReservationV1, target: SessionTarget): void
}

/** Reactive diagnostic for the currently winning top-level Sidebar owner. */
export interface SidebarCompatibilityProbe {
  getSnapshot(): string | undefined
  subscribe(listener: () => void): () => void
}

type WorkbenchPatchResult =
  | { status: 'committed'; revision: number }
  | { status: 'conflict'; expectedRevision: number | undefined; actualRevision: number | undefined }
  | { status: 'unavailable' }

type WorkbenchSettingsScope = SettingsScope<WorkbenchSettings> & {
  patch(operation:
    | { operation: 'set'; path: readonly string[]; value: unknown; expectedRevision?: number }
    | { operation: 'unset'; path: readonly string[]; expectedRevision?: number }
  ): Promise<WorkbenchPatchResult>
}

type RenderSlot = WorkbenchFrameProps['renderSlot']
type Commit = (command: LayoutCommand) => boolean | void

const reportWorkbenchLayoutCommit: ProfilerOnRenderCallback = (_id, _phase, actualDuration) => {
  recordSplitResizeReactCommit(actualDuration)
}

const EMPTY_WORKBENCH_EXTENSION_ACCESS: WorkbenchExtensionAccessSnapshotV1 = {
  status: 'unavailable', extensions: [],
}

type FloatingMenuSide = 'left' | 'right' | 'top' | 'bottom'

function findAreaTabElement(root: Element | null, tabId: string): HTMLElement | undefined {
  if (root === null) return undefined
  return [...root.querySelectorAll<HTMLElement>('[data-workbench-area-tab]')]
    .find(element => element.dataset.workbenchAreaTab === tabId)
}

/**
 * A menu in the Area header cannot safely be positioned inside the Area tree:
 * every split is an intentional overflow boundary, and a collapsed rail is
 * often only one 30px header thick. Keep the trigger in the Area for event semantics but
 * render the surface at body level, where one fixed positioning algorithm can
 * flip and clamp it without knowing how deeply nested the Area is.
 */
export function WorkbenchFloatingMenu({
  kind, ownerId, anchorRef, surfaceRef, side, align = 'start', className, label, children,
}: {
  kind: 'editor' | 'area' | 'binding'
  ownerId: string
  anchorRef: RefObject<HTMLElement>
  surfaceRef: RefObject<HTMLDivElement>
  side: FloatingMenuSide
  align?: 'start' | 'end'
  className: string | undefined
  label?: string
  children: ReactNode
}) {
  const [position, setPosition] = useState<{ left: number, top: number, maxHeight?: number }>()

  useLayoutEffect(() => {
    const place = () => {
      const anchor = anchorRef.current
      const menu = surfaceRef.current
      if (anchor === null || menu === null) return
      const anchorRect = anchor.getBoundingClientRect()
      const canvasRect = anchor.closest<HTMLElement>('[data-workbench-canvas]')?.getBoundingClientRect()
      const menuWidth = menu.offsetWidth
      const menuHeight = menu.offsetHeight
      const margin = 12
      const gap = 6
      const viewportWidth = window.innerWidth
      const viewportHeight = window.innerHeight
      const boundaryLeft = Math.max(margin, canvasRect?.left ?? margin)
      const boundaryTop = Math.max(margin, canvasRect?.top ?? margin)
      const boundaryRight = Math.min(viewportWidth - margin, canvasRect?.right ?? viewportWidth - margin)
      const boundaryBottom = Math.min(viewportHeight - margin, canvasRect?.bottom ?? viewportHeight - margin)
      let resolvedSide = side
      if (resolvedSide === 'right' && anchorRect.right + gap + menuWidth > boundaryRight
        && anchorRect.left - gap - menuWidth >= boundaryLeft) resolvedSide = 'left'
      else if (resolvedSide === 'left' && anchorRect.left - gap - menuWidth < boundaryLeft
        && anchorRect.right + gap + menuWidth <= boundaryRight) resolvedSide = 'right'
      else if (kind !== 'binding' && resolvedSide === 'bottom' && anchorRect.bottom + gap + menuHeight > boundaryBottom
        && anchorRect.top - gap - menuHeight >= boundaryTop) resolvedSide = 'top'
      else if (resolvedSide === 'top' && anchorRect.top - gap - menuHeight < boundaryTop
        && anchorRect.bottom + gap + menuHeight <= boundaryBottom) resolvedSide = 'bottom'

      let left = align === 'end' ? anchorRect.right - menuWidth : anchorRect.left
      let top = anchorRect.bottom + gap
      if (resolvedSide === 'right') {
        left = anchorRect.right + gap
        top = anchorRect.top
      } else if (resolvedSide === 'left') {
        left = anchorRect.left - menuWidth - gap
        top = anchorRect.top
      } else if (resolvedSide === 'top') {
        top = anchorRect.top - menuHeight - gap
      }
      setPosition({
        left: Math.min(Math.max(left, boundaryLeft), Math.max(boundaryLeft, boundaryRight - menuWidth)),
        top: kind === 'binding' ? top : Math.min(Math.max(top, boundaryTop), Math.max(boundaryTop, boundaryBottom - menuHeight)),
        ...(kind === 'binding' ? { maxHeight: Math.max(0, boundaryBottom - top) } : {}),
      })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    const trackedObserver = createWorkbenchResizeObserver('overlay-placement', place)
    if (surfaceRef.current !== null) trackedObserver?.observer.observe(surfaceRef.current)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
      trackedObserver?.disconnect()
    }
  }, [align, anchorRef, kind, side, surfaceRef])

  if (typeof document === 'undefined') return null
  return createPortal(
    <div
      ref={surfaceRef}
      className={[className, css.floatingMenu].filter(Boolean).join(' ')}
      role={kind === 'binding' ? 'dialog' : 'menu'}
      aria-label={label}
      data-workbench-floating-menu={kind}
      data-workbench-floating-menu-owner={ownerId}
      style={position === undefined
        ? { visibility: 'hidden', left: 0, top: 0 }
        : { left: position.left, top: position.top, ...(position.maxHeight === undefined ? {} : { maxHeight: position.maxHeight }) }}
      onPointerDown={(event) => { event.stopPropagation() }}
      onClick={(event) => { event.stopPropagation() }}
    >
      {children}
    </div>,
    document.body,
  )
}

function WorkbenchFloatingInfo({
  anchorRef, id, ownerId, side, open, icon, iconSvg, title, detail, tabs, onExpand, onActivate, onPointerEnter, onPointerLeave,
}: {
  anchorRef: RefObject<HTMLElement>
  id: string
  ownerId: string
  side: FloatingMenuSide
  open: boolean
  icon: string
  iconSvg?: WorkbenchEditorSvgIconV1 | undefined
  title: string
  detail: string
  tabs?: readonly WorkbenchAreaTabSummary[]
  onExpand?: () => void
  onActivate?: (tabId: string) => void
  onPointerEnter?: () => void
  onPointerLeave?: () => void
}) {
  const { t } = useWorkbenchLocale()
  const surfaceRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState<{ left: number, top: number }>()

  useLayoutEffect(() => {
    if (!open) return
    const place = () => {
      const anchor = anchorRef.current
      const surface = surfaceRef.current
      if (anchor === null || surface === null) return
      const anchorRect = anchor.getBoundingClientRect()
      const surfaceWidth = surface.offsetWidth
      const surfaceHeight = surface.offsetHeight
      const margin = 10
      const gap = 7
      const viewportWidth = window.innerWidth
      const viewportHeight = window.innerHeight
      let resolvedSide = side
      if (resolvedSide === 'right' && anchorRect.right + gap + surfaceWidth > viewportWidth - margin
        && anchorRect.left - gap - surfaceWidth >= margin) resolvedSide = 'left'
      else if (resolvedSide === 'left' && anchorRect.left - gap - surfaceWidth < margin
        && anchorRect.right + gap + surfaceWidth <= viewportWidth - margin) resolvedSide = 'right'
      else if (resolvedSide === 'bottom' && anchorRect.bottom + gap + surfaceHeight > viewportHeight - margin
        && anchorRect.top - gap - surfaceHeight >= margin) resolvedSide = 'top'
      else if (resolvedSide === 'top' && anchorRect.top - gap - surfaceHeight < margin
        && anchorRect.bottom + gap + surfaceHeight <= viewportHeight - margin) resolvedSide = 'bottom'

      let left = anchorRect.left
      let top = anchorRect.bottom + gap
      if (resolvedSide === 'right') {
        left = anchorRect.right + gap
        top = anchorRect.top
      } else if (resolvedSide === 'left') {
        left = anchorRect.left - surfaceWidth - gap
        top = anchorRect.top
      } else if (resolvedSide === 'top') {
        top = anchorRect.top - surfaceHeight - gap
      }
      setPosition({
        left: Math.min(Math.max(left, margin), Math.max(margin, viewportWidth - margin - surfaceWidth)),
        top: Math.min(Math.max(top, margin), Math.max(margin, viewportHeight - margin - surfaceHeight)),
      })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    const trackedObserver = createWorkbenchResizeObserver('overlay-placement', place)
    if (surfaceRef.current !== null) trackedObserver?.observer.observe(surfaceRef.current)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
      trackedObserver?.disconnect()
    }
  }, [anchorRef, open, side])

  if (!open || typeof document === 'undefined') return null
  return createPortal(
    <div
      id={id}
      ref={surfaceRef}
      className={css.areaCollapseInfo}
      role={tabs === undefined ? 'tooltip' : 'dialog'}
      data-area-collapse-info
      data-area-collapse-info-owner={ownerId}
      data-interactive={tabs !== undefined || undefined}
      style={position === undefined
        ? { visibility: 'hidden', left: 0, top: 0 }
        : { left: position.left, top: position.top }}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
    >
      <span className={css.areaCollapseInfoIcon} data-editor-icon={icon} aria-hidden="true">
        <EditorIcon name={icon} iconSvg={iconSvg} />
      </span>
      <span className={css.areaCollapseInfoCopy}>
        <strong>{title}</strong>
        <small>{detail}</small>
      </span>
      {tabs === undefined ? null : <>
        <div className={css.areaCollapseInfoTabs} role="list" aria-label={t('layout.collapsedAreaPages')}>
          {tabs.map(tab => <WorkbenchTabTooltip key={tab.id} summary={tab}><button
            type="button"
            className={css.areaCollapseInfoTab}
            data-selected={tab.selected || undefined}
            data-tab-status={tab.status}
            aria-current={tab.selected ? 'page' : undefined}
            aria-label={tab.information?.accessibleLabel ?? tab.title}
            onClick={() => onActivate?.(tab.id)}
          >
            <WorkbenchTabStatus summary={tab} />
            <span className={css.areaCollapseInfoTabIcon} data-editor-icon={tab.icon}><EditorIcon name={tab.icon} iconSvg={tab.iconSvg} /></span>
            <span className={css.areaCollapseInfoTabTitle}>{tab.title}{tab.information?.detail ? <small>{tab.information.detail}</small> : null}</span>
            <small>{tab.statusLabel}</small>
          </button></WorkbenchTabTooltip>)}
        </div>
        <button type="button" className={css.areaCollapseInfoExpand} onClick={() => onExpand?.()}>{t('layout.expandArea')}</button>
      </>}
    </div>,
    document.body,
  )
}

function recordsLayoutHistory(command: LayoutCommand): boolean {
  return command.type !== 'activate' && command.type !== 'update-tab-state'
}

interface ConflictState {
  remote: WorkbenchLayoutDocument
  local: WorkbenchLayoutDocument
}

interface AccountDraft {
  layout: WorkbenchLayoutDocument
  past: WorkbenchLayoutDocument[]
  future: WorkbenchLayoutDocument[]
  pending: LayoutCommand[]
  saveState: 'saved' | 'saving' | 'offline' | 'conflict'
  conflict?: ConflictState
  lastSaved: WorkbenchLayoutDocument
}

const nextId = (() => {
  let value = 0
  return (prefix: string): string => `${prefix}-${Date.now().toString(36)}-${String(++value)}`
})()

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (Array.isArray(value)) return value.every(isJsonValue)
  if (typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).every(isJsonValue)
  }
  return false
}

/** Keep the native tab's navigation identity in the Workbench tab state. */
function nativeTabState(kind: string, options: Record<string, unknown> | undefined): JsonValue {
  const params = options?.params
  const explicitContentId = typeof options?.nativeContentId === 'string' && options.nativeContentId.length > 0
    ? options.nativeContentId
    : typeof options?.resourceAddress === 'string' && options.resourceAddress.length > 0
      ? options.resourceAddress
      : undefined
  // Resource-backed DSH pages require a real dsh-resource:// identity. Keep
  // an unbound Workbench tab address-less so the native body can render its
  // waiting state without receiving a fabricated workbench:// URL.
  const contentId = explicitContentId ?? (workbenchNativeSidebarForKind(kind)?.resourceOnly === true
    ? undefined
    : `workbench://${kind}/${nextId('native-content')}`)
  return {
    ...(contentId === undefined ? {} : { nativeContentId: contentId }),
    ...(isJsonValue(params) ? { nativeParams: params } : {}),
    ...(typeof options?.resourceAddress === 'string' && options.resourceAddress.length > 0
      ? { resourceAddress: options.resourceAddress }
      : {}),
  }
}

const SHELL_SIDEBAR_DEFAULT = 280
const SHELL_SIDEBAR_COLLAPSED = 56
const SHELL_NARROW_BREAKPOINT = 1024
// Runtime-only rails retain enough room to identify the editor that remains
// mounted. Left/right rails need width; top/bottom rails need height.
// A fully-collapsed nested branch is rendered as a compact identity summary.
// The cross-axis allocation is deliberately larger than a single rail so the
// summary can show editor names without reserving the branch's full size.
const SPLIT_DIVIDER_SIZE = COLLAPSED_DIVIDER_SIZE
const EMPTY_WORKBENCH_DIRECTORY_SNAPSHOT = { openWorkbenchIds: [], globalHiddenEditorIds: [], rows: [], invalidRows: [], templates: [] } as const
const EMPTY_SESSION_LIST_SNAPSHOT = {
  ids: [], byId: {}, current: undefined, phase: 'ready', subagentsByParent: {},
  jobsBySession: {}, currentAddress: undefined,
} as unknown as SessionListState
const EMPTY_WORKSPACE_LIST_SNAPSHOT = {
  items: [], archivedSessionIds: [], state: 'idle', phase: 'ready', error: null,
  baselinesReady: false, recentWorkspaceId: undefined,
} as unknown as WorkspaceListState
const EMPTY_MODEL_SELECTION_SOURCE: WorkbenchPreviewModelSelectionSource = {
  get: () => undefined,
  getSnapshot: () => 0,
  subscribe: () => () => {},
}
const EMPTY_WORKBENCH_DIRECTORY: WorkbenchDirectory = {
  getSnapshot: () => EMPTY_WORKBENCH_DIRECTORY_SNAPSHOT,
  subscribe: () => () => {},
  select: () => Promise.resolve({ status: 'unavailable' }),
  create: () => Promise.resolve({ status: 'unavailable' }),
  saveTemplate: () => Promise.resolve({ status: 'unavailable' }),
  rename: () => Promise.resolve({ status: 'unavailable' }),
  updateMetadata: () => Promise.resolve({ status: 'unavailable' }),
  updateWorkbenchBackground: () => Promise.resolve({ status: 'unavailable' }),
  updateAreaBackground: () => Promise.resolve({ status: 'unavailable' }),
  openAndSelect: () => Promise.resolve({ status: 'unavailable' }),
  unload: () => Promise.resolve({ status: 'unavailable' }),
  setPinned: () => Promise.resolve({ status: 'unavailable' }),
  archive: () => Promise.resolve({ status: 'unavailable' }),
  restore: () => Promise.resolve({ status: 'unavailable' }),
  remove: () => Promise.resolve({ status: 'unavailable' }),
  setBeforeLifecycleTransition: () => () => {},
  close: () => Promise.resolve({ status: 'unavailable' }),
}

/**
 * React's useSyncExternalStore requires getSnapshot() to return the same
 * reference when the underlying value did not change. Host bridges commonly
 * decode a fresh JSON object for every read, so cache equivalent JSON-safe
 * directory snapshots at the plugin boundary instead of forcing every DSH
 * adapter to know React's identity requirement.
 */
function cachedDirectorySnapshot<T>(read: () => T): () => T {
  let cached: T | undefined
  let fingerprint: string | undefined
  return () => {
    const next = read()
    let nextFingerprint: string | undefined
    try { nextFingerprint = JSON.stringify(next) }
    catch { nextFingerprint = undefined }
    if (cached !== undefined && nextFingerprint !== undefined && nextFingerprint === fingerprint) return cached
    cached = next
    fingerprint = nextFingerprint
    return next
  }
}

function SaveLayoutIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <path d="M3.5 3.5h10.8l2.2 2.2v10.8h-13z" />
      <path d="M6 3.5v5h7v-5M6.5 16.5v-5h7v5" />
    </svg>
  )
}

function CloseWorkbenchIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <path d="m5.5 5.5 9 9m0-9-9 9" />
    </svg>
  )
}

function UndoLayoutIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <path d="M7 5 3.5 8.5 7 12" />
      <path d="M4 8.5h6.5a5 5 0 0 1 5 5" />
    </svg>
  )
}

function RedoLayoutIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <path d="m13 5 3.5 3.5L13 12" />
      <path d="M16 8.5H9.5a5 5 0 0 0-5 5" />
    </svg>
  )
}

function WorkbenchLayoutLockIcon({ locked }: { locked: boolean }) {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <rect x="3.5" y="8.5" width="13" height="9" rx="1.8" />
      {locked
        ? <path d="M6.5 8.5V6a3.5 3.5 0 0 1 7 0v2.5" />
        : <path d="M6.5 8.5V6a3.5 3.5 0 0 1 6.5-1.9" />}
      <path d="M10 12v2.5" />
    </svg>
  )
}

/** A compact return-to-desktop glyph for the browser Workbench view. */
function ReturnToDesktopIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <rect x="8" y="3.5" width="8.5" height="10" rx="1.5" />
      <path d="M3.5 10h8m-4-3.5L4 10l3.5 3.5" />
    </svg>
  )
}

function AreaCollapseIcon({ direction }: { direction: CollapseEdge }) {
  const common = {
    viewBox: '0 0 20 20',
    'aria-hidden': true,
    focusable: false,
  } as const
  if (direction === 'left') {
    return <svg {...common}><path d="M4.5 3.5v13M15.5 10h-8m3-3-3 3 3 3" /></svg>
  }
  if (direction === 'right') {
    return <svg {...common}><path d="M15.5 3.5v13M4.5 10h8m-3-3 3 3-3 3" /></svg>
  }
  if (direction === 'up') {
    return <svg {...common}><path d="M3.5 4.5h13M10 15.5v-8m-3 3 3-3 3 3" /></svg>
  }
  return <svg {...common}><path d="M3.5 15.5h13M10 4.5v8m-3-3 3 3 3-3" /></svg>
}


function frameRepository(document: WorkbenchLayoutDocument, workbenchId: string): WorkbenchRepository {
  const now = Date.now()
  return new WorkbenchRepository({
    version: 4,
    activeWorkbenchId: workbenchId,
    openWorkbenchIds: [workbenchId],
    workbenches: {
      [workbenchId]: {
        workbenchId, name: '主工作台', document: migrateDocumentV2ToV3(document),
        description: '', createdAt: now, updatedAt: now,
      },
    },
    layoutTemplates: {}, invalidWorkbenches: {}, sessionMarkers: {},
  })
}

function comparableWorkbenchName(name: string): string {
  return name.trim().normalize('NFKC').toLocaleLowerCase('zh-CN')
}

function bindingOfActive(document: WorkbenchLayoutDocument): SessionBindingV1 | undefined {
  const group = groupsOf(document.root).find(row => row.id === document.activeGroupId)
  const tab = group?.tabs.find(row => row.id === group.activeTabId)
  return tab?.binding ?? (tab?.sessionId === undefined ? undefined : { sessionId: tab.sessionId })
}

function focusOfLayout(document: WorkbenchLayoutDocument): SharedCanvasFocusV1 | undefined {
  const group = groupsOf(document.root).find(row => row.id === document.activeGroupId)
  const tab = group === undefined ? undefined : activeTab(group)
  if (group === undefined || tab === undefined) return undefined
  return { areaId: group.id, editorId: tab.editorId, ...(tab.sessionId === undefined ? {} : { sessionId: tab.sessionId }) }
}

/**
 * Collaboration participants are reported through the Workbench top bar's
 * status area, the same place as the browser handoff state. A participant who
 * lost its connection is a notice ("… 已失联"), never an extra row in the
 * Workbench identity, so the toolbar keeps one notice surface.
 */
function CollaborationParticipantNotice({ snapshot, currentParticipantId, className }: {
  readonly snapshot: WorkbenchCollaborationSnapshotV1 | undefined
  readonly currentParticipantId?: string | undefined
  readonly className: string | undefined
}) {
  const { t } = useWorkbenchLocale()
  const participants = snapshot?.participants.filter(row => row.participantId !== currentParticipantId) ?? []
  if (participants.length === 0) return null
  const intentLabel = (intent: string) => intent === 'editing' ? t('collab.editing') : intent === 'sending' ? t('collab.sending') : intent === 'running' ? t('collab.running') : intent === 'recovering' ? t('collab.recovering') : t('collab.viewing')
  const nameOf = (participant: typeof participants[number]) => participant.displayName || (participant.role === 'owner' ? t('collab.owner') : t('collab.participant'))
  const names = (rows: typeof participants) => rows.length <= 2 ? rows.map(nameOf).join(t('list.separator')) : t('collab.summary', { names: rows.slice(0, 2).map(nameOf).join(t('list.separator')), count: rows.length })
  const stale = participants.filter(row => row.connectionState === 'stale')
  const live = participants.filter(row => row.connectionState !== 'stale')
  const label = stale.length > 0
    ? t('collab.disconnectedNamed', { names: names(stale) })
    : live.length === 1 ? `${nameOf(live[0]!)} · ${intentLabel(live[0]!.intent)}` : t('collab.online', { count: live.length })
  const detail = participants.map(participant => `${nameOf(participant)} · ${participant.connectionState === 'stale' ? t('collab.disconnected') : intentLabel(participant.intent)}`).join('\n')
  return <span
    className={className}
    role="status"
    aria-live="polite"
    title={detail}
    data-workbench-collaboration-participants
    data-workbench-collaboration-notice={stale.length > 0 ? 'stale' : 'live'}
  >{label}</span>
}

function accountForBinding(
  binding: SessionBindingV1,
): WorkspaceAccountKey {
  return binding.workspaceId === undefined ? 'ungrouped' : `workspace:${binding.workspaceId}`
}

function adjacentGroup(document: WorkbenchLayoutDocument, groupId: string, direction: 'previous' | 'next'): GroupNode | undefined {
  const groups = groupsOf(document.root)
  const at = groups.findIndex(group => group.id === groupId)
  return groups[at + (direction === 'previous' ? -1 : 1)]
}

function openSessionCommands(
  document: WorkbenchLayoutDocument,
  target: SessionBindingV1,
  disposition: 'reuse' | 'new' | 'duplicate',
): LayoutCommand[] {
  const sessionId = target.sessionId as SessionId
  const existing = tabsOf(document.root).find(tab =>
    tab.editorId === 'workbench.conversation'
    && tab.binding?.workspaceId === target.workspaceId
    && tab.sessionId === sessionId)
  if (existing !== undefined && disposition !== 'duplicate') {
    const owner = groupsOf(document.root).find(group => group.tabs.some(tab => tab.id === existing.id))
    /* v8 ignore next -- existing came from tabsOf() over these same groups, so the owning group is present. */
    return owner === undefined ? [] : [{ type: 'activate', groupId: owner.id, tabId: existing.id }]
  }
  if (existing !== undefined) {
    const owner = groupsOf(document.root).find(group => group.tabs.some(tab => tab.id === existing.id))
    /* v8 ignore next -- existing came from tabsOf() over these same groups. */
    if (owner === undefined) return []
    return [{
      type: 'duplicate-tab', tabId: existing.id, newTabId: nextId('tab'),
      targetGroupId: owner.id, edge: 'right',
      ids: { groupId: nextId('group'), splitId: nextId('split') },
    }]
  }
  const groups = groupsOf(document.root)
  const focused = groups.find(group => group.id === document.activeGroupId)
  const activeGroup = groups.some(group => group.project)
    ? (focused?.project?.workspaceId === target.workspaceId ? focused : groups.find(group => group.project?.workspaceId === target.workspaceId))
    : focused
  if (!activeGroup) return []
  const tab = createSessionTab(nextId('tab'), 'workbench.conversation', target, '对话')
  if (disposition === 'reuse') return [{ type: 'add-tab', groupId: activeGroup.id, tab }]
  const commands: LayoutCommand[] = [{ type: 'add-tab', groupId: activeGroup.id, tab }]
  // Adding the new tab makes it active. Restore the prior Area view before
  // moving the new tab out; move-tab then focuses the new right-hand Area
  // without exposing an older hidden editor in the source Area.
  if (activeGroup?.activeTabId !== undefined) {
    commands.push({ type: 'activate', groupId: activeGroup.id, tabId: activeGroup.activeTabId })
  }
  commands.push({
    type: 'move-tab', tabId: tab.id, targetGroupId: activeGroup.id, edge: 'right',
    ids: { groupId: nextId('group'), splitId: nextId('split') },
  })
  return commands
}

function applyCommands(document: WorkbenchLayoutDocument, commands: readonly LayoutCommand[]): WorkbenchLayoutDocument {
  return commands.reduce(applyLayoutCommand, document)
}

function downloadJson(filename: string, value: unknown): void {
  const blob = new Blob([`${JSON.stringify(value, null, 2)}\n`], { type: 'application/json' })
  downloadBlob(filename, blob)
}

/**
 * Prefer a Host-backed download for large/generated archives. Embedded DSH
 * browsers do not always persist Blob URLs even after a successful click;
 * the Host route gives the browser a normal attachment response. Blob URLs
 * remain the compatibility fallback for older profiles without the route.
 */
async function downloadArchive(filename: string, bytes: Uint8Array): Promise<void> {
  try {
    const response = await fetch('/api/workbench/distribution/download', {
      method: 'POST',
      headers: {
        'content-type': 'application/zip',
        'x-dsh-workbench-filename': filename,
      },
      body: bytes.slice().buffer,
    })
    if (response.ok) {
      const payload = await response.json() as { url?: unknown }
      if (typeof payload.url === 'string' && payload.url.length > 0) {
        // Navigation to a Content-Disposition attachment is not gated by the
        // transient user-activation token that embedded Chromium removes
        // while the async archive is being assembled. The page stays loaded
        // because the response is an attachment, while the browser owns the
        // actual filesystem download.
        window.location.assign(payload.url)
        return
      }
    }
  } catch { /* fall back to the browser-owned Blob download */ }
  downloadBlob(filename, new Blob([bytes.slice().buffer as ArrayBuffer], { type: 'application/zip' }), true)
}

/**
 * Trigger a browser download in a way that works for Blob URLs in Chromium,
 * Firefox and the embedded DSH browser.  The previous implementation clicked
 * a detached anchor and revoked the URL synchronously; that can make the
 * browser report success while never committing the bytes to disk.
 */
function downloadBlob(filename: string, blob: Blob, deferRevoke = false): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.rel = 'noopener'
  link.style.display = 'none'
  document.body.appendChild(link)
  link.click()
  // Let the browser consume the Blob URL before releasing it.  Keep cleanup
  // detached from the click event so a slow download manager still receives
  // the complete archive.
  const cleanup = () => {
    link.remove()
    URL.revokeObjectURL(url)
  }
  if (deferRevoke) window.setTimeout(cleanup, 1000)
  else cleanup()
}

function withoutRecordKey<T>(
  source: Readonly<Record<string, T>>,
  removedKey: string,
): Record<string, T> {
  return Object.fromEntries(
    Object.entries(source).filter(([key]) => key !== removedKey),
  )
}

export function WorkbenchFrame(props: WorkbenchFrameProps) {
  const { t } = useWorkbenchLocale()
  const surfaceContext = props.surfaceContext ?? DESKTOP_WORKBENCH_SURFACE_V1
  const isBrowserSurface = surfaceContext.kind !== 'desktop'
  const surfaceWorkbenchId = surfaceContext.kind === 'browser-owner' || surfaceContext.kind === 'lan-participant' ? surfaceContext.workbenchId : undefined
  const resizeCanvasRef = useRef<HTMLDivElement>(null)
  const floatingPinPending = useRef(false)
  const {
    renderSlot, useSessions, useWorkspaces, bindLayout, bindNavigation, editorCatalog,
    selectSession, settings, sidebarCompatibility, projectNeutral = false, embeddedDesktop = false, desktopControls,
    windowController = unsupportedWorkbenchWindowController(),
    connectWorkspace, createWorkspaceSession, createWorkspace, sidebarHostActions, openOfficialSession, runtimeMetrics,
    conversationResourcePolicy,
  } = props
  const surfaceView = isBrowserSurface ? 'workbench' : (props.surfaceView ?? 'workbench')
  const subscribeExtensionRegistry = useCallback(
    (listener: () => void) => props.extensionRegistry?.subscribe(listener) ?? (() => {}), [props.extensionRegistry],
  )
  const getExtensionAccess = useCallback(
    () => props.extensionRegistry?.getSnapshot() ?? EMPTY_WORKBENCH_EXTENSION_ACCESS,
    [props.extensionRegistry],
  )
  const extensionAccess = useSyncExternalStore(subscribeExtensionRegistry, getExtensionAccess, getExtensionAccess)
  const current = useSessions(state => Object.values(state.byId).find(row => (row.retainedBy.mainView ?? 0) > 0)?.id)
  const sessionRows = useSessions(state => state.byId)
  const workspaces = useWorkspaces(state => state.items)
  const archivedSessionIds = useWorkspaces(state => state.archivedSessionIds)
  const subscribeSettingsScope = useCallback((listener: () => void) => settings.subscribe(listener), [settings])
  const getSettingsScopeSnapshot = useCallback(() => settings.getSnapshot(), [settings])
  const settingsSnapshot = useSyncExternalStore(
    subscribeSettingsScope, getSettingsScopeSnapshot, getSettingsScopeSnapshot,
  )
  const workbenchDirectory = props.workbenchDirectory ?? EMPTY_WORKBENCH_DIRECTORY
  // Both the browser owner and LAN participants render the same Host-owned
  // collaboration canvas.  The owner keeps share-management controls through
  // the surface policy, but its layout and shared draft state still flow via
  // the collaboration session so every surface observes one truth.
  const collaborationControlled = (surfaceContext.kind === 'lan-participant' || surfaceContext.kind === 'browser-owner')
    && props.collaborationClient !== undefined
  const subscribeCollaboration = useCallback(
    (listener: () => void) => props.collaborationClient?.subscribe(() => { listener() }) ?? (() => {}),
    [props.collaborationClient],
  )
  const getCollaborationSnapshot = useCallback(
    () => props.collaborationClient?.getSnapshot(), [props.collaborationClient],
  )
  const collaborationSnapshot = useSyncExternalStore(
    subscribeCollaboration, getCollaborationSnapshot, getCollaborationSnapshot,
  )
  const getCollaborationState = useCallback(
    () => props.collaborationClient?.getState(), [props.collaborationClient],
  )
  const collaborationState = useSyncExternalStore(subscribeCollaboration, getCollaborationState, getCollaborationState)
  // While the Host is unreachable or the collaboration is over, the last
  // snapshot stays visible and shared writes are refused.
  const collaborationStatus = collaborationControlled ? collaborationStatusLabel(collaborationState, t) : undefined
  const subscribeWorkbenchDirectory = useCallback(
    (listener: () => void) => workbenchDirectory.subscribe(listener), [workbenchDirectory],
  )
  const getWorkbenchDirectorySnapshot = useMemo(
    () => cachedDirectorySnapshot(() => workbenchDirectory.getSnapshot()), [workbenchDirectory],
  )
  const workbenchDirectorySnapshot = useSyncExternalStore(
    subscribeWorkbenchDirectory, getWorkbenchDirectorySnapshot, getWorkbenchDirectorySnapshot,
  )
  const subscribeBayAgent = useCallback((listener: () => void) => props.bayAgent?.subscribe(listener) ?? (() => {}), [props.bayAgent])
  const getBayAgentSnapshot = useCallback(() => props.bayAgent?.getSnapshot(), [props.bayAgent])
  const bayAgentSnapshot = useSyncExternalStore(subscribeBayAgent, getBayAgentSnapshot, getBayAgentSnapshot)
  const activeBayAgentAreaIds = useMemo(() => {
    const activeItems = new Map((bayAgentSnapshot?.workItems ?? [])
      .filter(row => row.status === 'queued' || row.status === 'running')
      .map(row => [row.workItemId, row] as const))
    const projects = workbenchDirectory.getAreaProjects?.(bayAgentSnapshot?.workbenchId ?? '') ?? {}
    const owners = (row: { areaId: string; projectId?: string }) => row.projectId ? Object.entries(projects).filter(([, project]) => project.projectId === row.projectId).map(([id]) => id) : [row.areaId]
    return new Set([
      ...([...activeItems.values()].filter(row => row.status === 'running').flatMap(owners)),
      ...(bayAgentSnapshot?.assignments
        .filter(row => row.state !== 'ended' && activeItems.has(row.workItemId))
        .flatMap(owners) ?? []),
    ])
  }, [bayAgentSnapshot, workbenchDirectory, workbenchDirectorySnapshot])
  const selectionTraceRef = useRef<WorkbenchSelectionTrace>()
  const subscribeWorkbenchWindows = useCallback(
    (listener: () => void) => windowController.subscribe(listener), [windowController],
  )
  const getWorkbenchWindowSnapshot = useCallback(
    () => normalizeWorkbenchWindowSnapshot(windowController.getSnapshot()), [windowController],
  )
  const workbenchWindowSnapshot = useSyncExternalStore(
    subscribeWorkbenchWindows, getWorkbenchWindowSnapshot, getWorkbenchWindowSnapshot,
  )
  const shareController = props.shareController
  const subscribeWorkbenchShare = useCallback(
    (listener: () => void) => shareController?.subscribe(listener) ?? (() => {}), [shareController],
  )
  const getWorkbenchShareSnapshot = useCallback(
    () => shareController?.getSnapshot() ?? EMPTY_WORKBENCH_SHARE_SNAPSHOT, [shareController],
  )
  const workbenchShareSnapshot = useSyncExternalStore(
    subscribeWorkbenchShare, getWorkbenchShareSnapshot, getWorkbenchShareSnapshot,
  )
  const accessSnapshot = useSyncExternalStore(workbenchAccess.subscribe, workbenchAccess.getSnapshot, workbenchAccess.getSnapshot)
  const canEditLayout = accessSnapshot?.capabilities.includes('layout') !== false
  const [shareBusy, setShareBusy] = useState(false)
  const [shareNotice, setShareNotice] = useState<string>()
  useEffect(() => {
    const surfaceShareWorkbenchId = surfaceWorkbenchId
    if (isBrowserSurface !== true || surfaceShareWorkbenchId === undefined || shareController === undefined) return
    let disposed = false
    const refresh = () => {
      if (!disposed) void shareController.refresh(surfaceShareWorkbenchId).catch(() => {})
    }
    refresh()
    const timer = window.setInterval(refresh, 1000)
    return () => { disposed = true; window.clearInterval(timer) }
  }, [isBrowserSurface, surfaceWorkbenchId, shareController])
  const browserOwnedWorkbenchIds = useMemo(() => {
    if (isBrowserSurface === true) return new Set<string>()
    const requests = [
      ...(workbenchWindowSnapshot.requests ?? []),
      ...(workbenchWindowSnapshot.request === undefined ? [] : [workbenchWindowSnapshot.request]),
    ]
    return new Set(requests
      .filter(row => ['preparing', 'prepared', 'requested', 'redeemed', 'ready', 'reclaiming'].includes(row.status))
      .map(row => row.workbenchId))
  }, [isBrowserSurface, workbenchWindowSnapshot.request, workbenchWindowSnapshot.requests])
  const isBrowserOwnedWorkbench = useCallback(
    (workbenchId: string) => isBrowserSurface !== true && browserOwnedWorkbenchIds.has(workbenchId),
    [browserOwnedWorkbenchIds, isBrowserSurface],
  )
  const browserOwnedWorkbench = isBrowserOwnedWorkbench(workbenchDirectorySnapshot.activeWorkbenchId ?? '')
  const loadedWorkbenchIds = workbenchDirectorySnapshot.openWorkbenchIds ?? workbenchDirectorySnapshot.rows.map(row => row.workbenchId)
  const visibleWorkbenchIds = isBrowserSurface === true && surfaceWorkbenchId !== undefined
    ? loadedWorkbenchIds.filter(workbenchId => workbenchId === surfaceWorkbenchId)
    : loadedWorkbenchIds
  const openWorkbenchRows = visibleWorkbenchIds
    .map(workbenchId => workbenchDirectorySnapshot.rows.find(row => row.workbenchId === workbenchId))
    .filter((row): row is NonNullable<typeof row> => row !== undefined)
  const browserWorkbenchName = isBrowserSurface === true && surfaceWorkbenchId !== undefined
    ? workbenchDirectorySnapshot.rows.find(row => row.workbenchId === surfaceWorkbenchId)?.name
    : undefined
  const preciseAccountsRef = useRef(new Map<SessionId, WorkspaceAccountKey>())
  const rosterAccount = accountFor(current, workspaces)
  const account = projectNeutral ? 'ungrouped' : current === undefined
    ? rosterAccount
    : preciseAccountsRef.current.get(current) ?? rosterAccount
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth)
  const [sidebarExpanded, setSidebarExpanded] = useState(true)
  const [narrowSidebarExpanded, setNarrowSidebarExpanded] = useState(false)
  const [layout, setLayout] = useState<WorkbenchLayoutDocument>(() => {
    const shared = sharedLayoutOf(collaborationSnapshot?.sharedCanvas.layout)
    if (collaborationControlled && shared !== undefined) return shared
    const persisted = settings.getSnapshot().value?.layouts[account]
    return persisted === undefined ? defaultLayout(projectNeutral ? undefined : current, account) : migrateOuterShellEditors(persisted)
  })
  const [frameTransition, setFrameTransition] = useState<WorkbenchFrameTransition>()
  const displayedWorkbenchId = frameTransition?.workbenchId ?? workbenchDirectorySnapshot.activeWorkbenchId
  const selectedWorkbenchId = surfaceWorkbenchId ?? workbenchDirectorySnapshot.activeWorkbenchId
  const bayAgentWorkbenchId = bayAgentWorkbenchTarget(selectedWorkbenchId, workbenchDirectorySnapshot.rows)
  useEffect(() => {
    props.bayAgent?.setWorkbenchId(bayAgentWorkbenchId)
  }, [bayAgentWorkbenchId, props.bayAgent])
  const activeWorkbenchRow = workbenchDirectorySnapshot.rows.find(row => row.workbenchId === selectedWorkbenchId)
  const [layoutLockOverride, setLayoutLockOverride] = useState<{ workbenchId: string; locked: boolean }>()
  const layoutLocked = layoutLockOverride !== undefined && layoutLockOverride.workbenchId === selectedWorkbenchId
    ? layoutLockOverride.locked
    : activeWorkbenchRow?.layoutLocked === true
  const persistedLayoutLocked = activeWorkbenchRow?.layoutLocked === true
  const layoutLockPending = layoutLockOverride !== undefined
    && layoutLockOverride.workbenchId === selectedWorkbenchId
    && persistedLayoutLocked !== layoutLockOverride.locked
  useEffect(() => {
    if (selectedWorkbenchId !== undefined && layoutLockOverride?.workbenchId === selectedWorkbenchId
      && persistedLayoutLocked === layoutLockOverride?.locked) setLayoutLockOverride(undefined)
  }, [layoutLockOverride, persistedLayoutLocked, selectedWorkbenchId])
  const selectedLayout = settingsSnapshot.value?.layouts.ungrouped
  const selectionLayoutReady = frameTransition?.kind === 'selection'
    && selectedWorkbenchId === frameTransition.workbenchId
    && selectedLayout !== undefined
    && JSON.stringify(migrateOuterShellEditors(layout)) === JSON.stringify(migrateOuterShellEditors(selectedLayout))
  const placementWorkbenchId = surfaceWorkbenchId
    ?? (frameTransition?.kind === 'selection' && !selectionLayoutReady
      ? frameTransition.fromWorkbenchId
      : selectedWorkbenchId ?? 'legacy-frame')
  const placementRepositoryRef = useRef<{
    workbenchId: string
    repository: WorkbenchRepository
  }>()
  if (placementRepositoryRef.current?.workbenchId !== placementWorkbenchId) {
    placementRepositoryRef.current = {
      workbenchId: placementWorkbenchId,
      repository: frameRepository(layout, placementWorkbenchId),
    }
  }
  useLayoutEffect(() => {
    const transition = frameTransition
    if (transition?.kind !== 'selection' || transition.workbenchId !== workbenchDirectorySnapshot.activeWorkbenchId
      || selectedLayout === undefined
      || JSON.stringify(migrateOuterShellEditors(layout)) !== JSON.stringify(migrateOuterShellEditors(selectedLayout))) return
    const trace = selectionTraceRef.current
    if (trace?.targetWorkbenchId === transition.workbenchId) {
      workbenchSelectionMark(trace, 'layout-committed')
      selectionTraceRef.current = undefined
    }
    setFrameTransition(current => current?.workbenchId === transition.workbenchId ? undefined : current)
  }, [frameTransition, layout, selectedLayout, workbenchDirectorySnapshot.activeWorkbenchId])
  const [past, setPast] = useState<WorkbenchLayoutDocument[]>([])
  const [future, setFuture] = useState<WorkbenchLayoutDocument[]>([])
  // Collapse is runtime-only and user-controlled. The render tree consumes
  // its immutable projection; viewport measurements never change this state.
  const [collapseRuntimeState, setCollapseRuntimeState] = useState<Map<string, CollapseIntent>>(() => new Map())
  const [pending, setPending] = useState<LayoutCommand[]>([])
  // Persistence is snapshot based: a newer document supersedes every older
  // queued command. This keeps rapid editor state changes from producing a
  // write per event while retaining the latest local document for recovery.
  const [persistenceTick, setPersistenceTick] = useState(0)
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'offline' | 'conflict'>('saved')
  const [workbenchClosing, setWorkbenchClosing] = useState(false)
  const [createPreset, setCreatePreset] = useState<WorkbenchLayoutPresetId>()
  const [contextDialog, setContextDialog] = useState<{ workbenchId: string; areaId?: string }>()
  const [memoryWorkbenchId, setMemoryWorkbenchId] = useState<string>()
  const [projectDialog, setProjectDialog] = useState<{ workbenchId: string; areaId: string }>()
  const [workbenchMenuOpenId, setWorkbenchMenuOpenId] = useState<string>()
  const [toolGatewayOpenId, setToolGatewayOpenId] = useState<string>()
  const [workbenchMenuPosition, setWorkbenchMenuPosition] = useState<{ top: number; left: number }>()
  const [draggedWorkbenchId, setDraggedWorkbenchId] = useState<string>()
  const [dragOverWorkbenchId, setDragOverWorkbenchId] = useState<string>()
  const [workbenchReordering, setWorkbenchReordering] = useState(false)
  const [templateDialogOpen, setTemplateDialogOpen] = useState(false)
  const [templateName, setTemplateName] = useState('')
  const [templateTargetWorkbenchId, setTemplateTargetWorkbenchId] = useState<string>()
  const [templateError, setTemplateError] = useState<string>()
  const [templateSaving, setTemplateSaving] = useState(false)
  const [renamingWorkbenchId, setRenamingWorkbenchId] = useState<string>()
  const [workbenchNameDraft, setWorkbenchNameDraft] = useState('')
  const [workbenchNameError, setWorkbenchNameError] = useState<string>()
  const [workbenchRenaming, setWorkbenchRenaming] = useState(false)
  const createWorkbenchButtonRef = useRef<HTMLButtonElement>(null)
  const workbenchMenuRef = useRef<HTMLDivElement>(null)
  const workbenchMenuAnchorRef = useRef<HTMLButtonElement>()
  const toolGatewayReturnFocusRef = useRef<HTMLElement | null>(null)
  const suppressWorkbenchClickRef = useRef(false)
  const templateReturnFocusRef = useRef<HTMLElement>()
  const templateNameId = useId()
  const [conflict, setConflict] = useState<ConflictState>()
  const [stateDiagnostic, setStateDiagnostic] = useState<string>()
  const toggleLayoutLocked = useCallback(() => {
    if (selectedWorkbenchId === undefined || workbenchDirectory.setLayoutLocked === undefined
      || isBrowserOwnedWorkbench(selectedWorkbenchId)) return
    const next = !layoutLocked
    setLayoutLockOverride({ workbenchId: selectedWorkbenchId, locked: next })
    setStateDiagnostic(undefined)
    void workbenchDirectory.setLayoutLocked(selectedWorkbenchId, next).then(result => {
      if (result.status !== 'committed') {
        setLayoutLockOverride(current => current?.workbenchId === selectedWorkbenchId ? undefined : current)
        setStateDiagnostic(next ? t('shell.couldNotLockAreaSizesCheckThat') : t('shell.couldNotUnlockAreaSizesCheckThat'))
      }
    }).catch(() => {
      setLayoutLockOverride(current => current?.workbenchId === selectedWorkbenchId ? undefined : current)
      setStateDiagnostic(next ? t('shell.couldNotLockAreaSizesTryAgain') : t('shell.couldNotUnlockAreaSizesTryAgain'))
    })
  }, [isBrowserOwnedWorkbench, layoutLocked, selectedWorkbenchId, workbenchDirectory])
  const [reclaimingBrowserWorkbench, setReclaimingBrowserWorkbench] = useState(false)
  const [browserActionTransition, setBrowserActionTransition] = useState<{
    readonly workbenchId: string
    readonly phase: 'preparing' | 'opening' | 'reclaiming'
  }>()
  const [browserHandoff, setBrowserHandoff] = useState<{
    readonly workbenchId: string
    readonly status: 'requested' | 'ready' | 'reclaiming' | 'reclaimed' | 'closed' | 'failed' | 'expired'
    readonly code?: string
  }>()
  const [markerOverrides, setMarkerOverrides] = useState<Record<string, Record<string, SessionMarkerRecord>>>({})
  const [splitPlacement, setSplitPlacement] = useState<SplitPlacement>()
  const [invalidLayout, setInvalidLayout] = useState<unknown>(
    () => settings.getSnapshot().value?.invalidLayouts[account],
  )
  const documentRef = useRef(layout)
  const accountRef = useRef(account)
  const collapseScopeRef = useRef(`${account}|${placementWorkbenchId}`)
  const pendingRef = useRef(pending)
  const saveTimerRef = useRef<number>()
  const saveInFlightRef = useRef<Promise<void>>()
  const savePausedRef = useRef(false)
  const saveRetryTimerRef = useRef<number>()
  const saveRetryAttemptRef = useRef(0)
  const flushInFlightRef = useRef<Promise<boolean>>()
  const lastSavedRef = useRef(layout)
  // Fence only revisions committed by this mounted Frame. The Settings scope
  // may hydrate its real value after first exposing a default snapshot with
  // the same revision, and that same-revision hydration must remain visible.
  const lastSavedRevisionRef = useRef<number>()
  const sharedLayoutAppliedRef = useRef<string>()
  const sharedLayoutFlightRef = useRef(false)
  const sharedLayoutRatioSplitRef = useRef<string>()
  const publishedFocusRef = useRef<string>()
  const conflictRef = useRef(conflict)
  const invalidLayoutRef = useRef(invalidLayout)
  const deferredOpenRef = useRef<{
    account: WorkspaceAccountKey
    target: SessionBindingV1
    disposition: 'reuse' | 'new' | 'duplicate'
  }>()
  const navigationReservationsRef = useRef(new Map<string, {
    holder: { workbenchId: string; repository: WorkbenchRepository }
    claim: ReturnType<WorkbenchRepository['claimArea']>
  }>())
  const markerPersistAttemptsRef = useRef(new Set<string>())
  const draftsRef = useRef(new Map<WorkspaceAccountKey, AccountDraft>())
  const subscribeEditors = useCallback((listener: () => void) => editorCatalog.subscribe(listener), [editorCatalog])
  const getEditors = useCallback(() => editorCatalog.getSnapshot(), [editorCatalog])
  const editors = useSyncExternalStore(subscribeEditors, getEditors, getEditors)
  const editorIndex = useMemo(() => indexWorkbenchEditors(editors), [editors])
  const groupOrdinals = useMemo(() => indexWorkbenchAreaOrdinals(groupsOf(layout.root)), [layout.root])
  const subscribeSidebarCompatibility = useCallback(
    (listener: () => void) => sidebarCompatibility.subscribe(listener),
    [sidebarCompatibility],
  )
  const getSidebarCompatibility = useCallback(
    () => sidebarCompatibility.getSnapshot(),
    [sidebarCompatibility],
  )
  const sidebarDiagnostic = useSyncExternalStore(
    subscribeSidebarCompatibility,
    getSidebarCompatibility,
    getSidebarCompatibility,
  )
  documentRef.current = layout
  pendingRef.current = pending
  conflictRef.current = conflict
  invalidLayoutRef.current = invalidLayout

  const sharedLayout = collaborationControlled ? collaborationSnapshot?.sharedCanvas.layout : undefined
  useEffect(() => {
    const incoming = sharedLayoutOf(sharedLayout)
    if (incoming === undefined || sharedLayoutFlightRef.current) return
    // The Host layout is adopted only when the Host changed it. Events that
    // leave the layout alone must not replace a local edit that is still on
    // its way to the Host.
    const serialized = JSON.stringify(incoming)
    if (serialized === sharedLayoutAppliedRef.current) return
    sharedLayoutAppliedRef.current = serialized
    if (serialized === JSON.stringify(documentRef.current)) return
    documentRef.current = incoming
    lastSavedRef.current = incoming
    lastSavedRevisionRef.current = undefined
    setLayout(incoming)
    setPending([])
    setPast([])
    setFuture([])
    setConflict(undefined)
    setSaveState('saved')
  }, [sharedLayout])

  // The shared focus is derived from the layout, which already records the
  // active Area and tab. Publishing it keeps the Host's focus fact current
  // for presence; nothing is applied back from it.
  const layoutFocus = collaborationControlled ? focusOfLayout(layout) : undefined
  const layoutFocusKey = layoutFocus === undefined ? undefined : JSON.stringify(layoutFocus)
  useEffect(() => {
    const client = props.collaborationClient
    if (layoutFocusKey === undefined || client === undefined || collaborationState !== 'connected') return
    if (publishedFocusRef.current === layoutFocusKey) return
    publishedFocusRef.current = layoutFocusKey
    void client.command({ kind: 'canvas.set-focus', focus: JSON.parse(layoutFocusKey) as SharedCanvasFocusV1 }).catch(() => {})
  }, [collaborationState, layoutFocusKey, props.collaborationClient])

  // The floating workspace is shared state of the collaboration session, on
  // every surface that joins it, including the desktop owner.
  useEffect(() => {
    if (props.floatingRuntime === undefined || props.collaborationClient === undefined) return
    return connectSharedFloatingWorkspace(props.floatingRuntime, props.collaborationClient)
  }, [props.floatingRuntime, props.collaborationClient])

  useEffect(() => {
    if (surfaceContext.kind === 'lan-participant' || props.collaborationClient === undefined || collaborationState !== 'connected') return
    let timer: number | undefined
    const publishViewport = () => {
      if (timer !== undefined) window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        const viewport = {
          width: Math.max(320, Math.min(10_000, Math.round(window.innerWidth))),
          height: Math.max(240, Math.min(10_000, Math.round(window.innerHeight))),
          scaleMode: 'contain' as const,
        }
        const current = collaborationSnapshot?.sharedCanvas.viewport
        if (current?.width === viewport.width && current.height === viewport.height && current.scaleMode === viewport.scaleMode) return
        void props.collaborationClient?.command({ kind: 'canvas.set-viewport', viewport }, collaborationSnapshot?.workbenchRevision).catch(() => {})
      }, 120)
    }
    publishViewport()
    window.addEventListener('resize', publishViewport)
    return () => { window.removeEventListener('resize', publishViewport); if (timer !== undefined) window.clearTimeout(timer) }
  }, [collaborationSnapshot?.sharedCanvas.viewport, collaborationSnapshot?.workbenchRevision, collaborationState, props.collaborationClient, surfaceContext.kind])

  const collapseProjection = useMemo(
    () => deriveCollapseProjection(layout, collapseRuntimeState),
    [collapseRuntimeState, layout],
  )
  const collapsedAreaIds = collapseProjection.collapsedAreaIds
  useEffect(() => {
    if (runtimeMetrics === undefined) return
    const groups = groupsOf(layout.root)
    runtimeMetrics.reportView({
      workbenchId: placementWorkbenchId,
      account,
      openWorkbenches: loadedWorkbenchIds.length,
      areas: groups.length,
      tabs: groups.reduce((total, group) => total + group.tabs.length, 0),
      visibleAreas: groups.filter(group => !collapsedAreaIds.has(group.id)).length,
      collapsedAreas: collapsedAreaIds.size,
    })
  }, [account, collapsedAreaIds, layout, placementWorkbenchId, runtimeMetrics, loadedWorkbenchIds.length])
  useEffect(() => () => runtimeMetrics?.clearView(), [runtimeMetrics])

  const patchLayout = useCallback((operation: Parameters<WorkbenchSettingsScope['patch']>[0]) => {
    const write = () => (settings as WorkbenchSettingsScope).patch(operation)
    return runtimeMetrics === undefined ? write() : runtimeMetrics.measureLayoutSave(write)
  }, [settings, runtimeMetrics])

  const settingsWritable = !collaborationControlled && settingsSnapshot.status === 'ready'
    && settingsSnapshot.writable && settingsSnapshot.mode === 'host'
    && settingsSnapshot.revision !== undefined
  // The browser owner keeps its owner-only layout controls while its canvas
  // is the Host collaboration canvas; those writes go through the session.
  const ownerCollaborationWritable = collaborationControlled && surfaceContext.kind === 'browser-owner'
  const scheduleAutosaveRetry = useCallback(() => {
    if (saveRetryTimerRef.current !== undefined) return
    const attempt = saveRetryAttemptRef.current
    const delay = Math.min(30_000, 1_000 * 2 ** Math.min(attempt, 5))
    saveRetryAttemptRef.current = attempt + 1
    saveRetryTimerRef.current = window.setTimeout(() => {
      saveRetryTimerRef.current = undefined
      setPersistenceTick(value => value + 1)
    }, delay)
  }, [])
  useEffect(() => {
    if (!settingsWritable) return
    // A readiness transition is a retry signal. Revisions and unrelated
    // Session updates do not restart a failed autosave.
    savePausedRef.current = false
    saveRetryAttemptRef.current = 0
    if (saveRetryTimerRef.current !== undefined) {
      window.clearTimeout(saveRetryTimerRef.current)
      saveRetryTimerRef.current = undefined
    }
    setPersistenceTick(value => value + 1)
  }, [settingsWritable])
  const retrySave = useCallback(() => {
    savePausedRef.current = false
    saveRetryAttemptRef.current = 0
    if (saveRetryTimerRef.current !== undefined) {
      window.clearTimeout(saveRetryTimerRef.current)
      saveRetryTimerRef.current = undefined
    }
    setStateDiagnostic(undefined)
    setPersistenceTick(value => value + 1)
  }, [])
  useEffect(() => () => {
    if (saveRetryTimerRef.current !== undefined) window.clearTimeout(saveRetryTimerRef.current)
  }, [])

  useEffect(() => {
    setCollapseRuntimeState(previous => {
      const next = validCollapseState(layout, previous)
      return next.size === previous.size && [...next].every(([id, intent]) => previous.get(id) === intent)
        ? previous : next
    })
  }, [layout])

  useEffect(() => {
    // Collapse is a local presentation preference. Never carry it across a
    // Workspace account or Workbench document switch, even when ids happen to
    // be reused by the incoming layout.
    const scope = `${account}|${placementWorkbenchId}`
    if (collapseScopeRef.current === scope) return
    collapseScopeRef.current = scope
    setCollapseRuntimeState(new Map())
  }, [account, placementWorkbenchId])

  useEffect(() => {
    const holder = placementRepositoryRef.current
    if (holder === undefined || holder.workbenchId !== placementWorkbenchId) return
    holder.repository.replaceDocument(
      holder.workbenchId, migrateDocumentV2ToV3(layout),
    )
  }, [layout, placementWorkbenchId])

  useEffect(() => {
    const attemptedRevisions = new Set<number>()
    const persistMigration = () => {
      const snapshot = settings.getSnapshot()
      const value = snapshot.value
      if (snapshot.status !== 'ready' || ! snapshot.writable
        || snapshot.revision === undefined || value?.migrationRequired !== true
        || attemptedRevisions.has(snapshot.revision)) return
      attemptedRevisions.add(snapshot.revision)
      const { migrationRequired: _migrationRequired, ...persisted } = value
      void (settings as WorkbenchSettingsScope).patch({
        operation: 'set', path: [], value: persisted, expectedRevision: snapshot.revision,
      })
    }
    persistMigration()
    return settings.subscribe(persistMigration)
  }, [settings])

  useEffect(() => {
    const onResize = () => { setViewportWidth(window.innerWidth) }
    window.addEventListener('resize', onResize)
    return () => { window.removeEventListener('resize', onResize) }
  }, [])

  const originalDocumentTitleRef = useRef<string>()
  useEffect(() => {
    if (isBrowserSurface !== true) return
    originalDocumentTitleRef.current = document.title
    return () => {
      if (originalDocumentTitleRef.current !== undefined) document.title = originalDocumentTitleRef.current
      originalDocumentTitleRef.current = undefined
    }
  }, [isBrowserSurface])
  useEffect(() => {
    if (isBrowserSurface === true) document.title = browserWorkbenchName?.trim() || 'Workbench'
  }, [browserWorkbenchName, isBrowserSurface])

  useEffect(() => {
    if (workbenchMenuOpenId === undefined) return
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (workbenchMenuRef.current?.contains(target)) return
      if (target instanceof Element && target.closest('[data-workbench-menu-trigger]') !== null) return
      setWorkbenchMenuOpenId(undefined)
      setWorkbenchMenuPosition(undefined)
      workbenchMenuAnchorRef.current = undefined
    }
    document.addEventListener('pointerdown', closeOnOutsidePointer)
    return () => { document.removeEventListener('pointerdown', closeOnOutsidePointer) }
  }, [workbenchMenuOpenId])

  useLayoutEffect(() => {
    if (workbenchMenuOpenId === undefined) return
    const placeMenu = () => {
      const anchor = workbenchMenuAnchorRef.current
      const menu = workbenchMenuRef.current
      if (anchor === null || anchor === undefined || menu === null) return
      const anchorRect = anchor.getBoundingClientRect()
      const margin = 8
      const gap = 5
      const menuWidth = menu.offsetWidth || 208
      const menuHeight = menu.offsetHeight || 166
      const maxLeft = Math.max(margin, window.innerWidth - menuWidth - margin)
      const left = Math.min(Math.max(margin, anchorRect.left), maxLeft)
      const below = anchorRect.bottom + gap
      const top = below + menuHeight <= window.innerHeight - margin
        ? below
        : Math.max(margin, anchorRect.top - menuHeight - gap)
      setWorkbenchMenuPosition(current => current?.left === left && current.top === top
        ? current
        : { top, left })
    }
    placeMenu()
    window.addEventListener('resize', placeMenu)
    window.addEventListener('scroll', placeMenu, true)
    return () => {
      window.removeEventListener('resize', placeMenu)
      window.removeEventListener('scroll', placeMenu, true)
    }
  }, [workbenchMenuOpenId])

  const narrowShell = viewportWidth < SHELL_NARROW_BREAKPOINT
  const sidebarCollapsed = narrowShell ? !narrowSidebarExpanded : !sidebarExpanded
  const sidebarWidth = sidebarCollapsed ? SHELL_SIDEBAR_COLLAPSED : SHELL_SIDEBAR_DEFAULT
  const toggleSidebar = useCallback(() => {
    if (viewportWidth < SHELL_NARROW_BREAKPOINT) {
      setNarrowSidebarExpanded(expanded => !expanded)
    } else {
      setSidebarExpanded(expanded => !expanded)
    }
  }, [viewportWidth])

  useEffect(() => {
    const reconcileSettings = () => {
      const settingsSnapshot = settings.getSnapshot()
      const snapshot = settingsSnapshot.value
      const remote = snapshot?.layouts[accountRef.current]
      setInvalidLayout(snapshot?.invalidLayouts[accountRef.current])
      const localDirty = documentRef.current !== lastSavedRef.current
        && JSON.stringify(documentRef.current) !== JSON.stringify(lastSavedRef.current)
      if (remote === undefined || pendingRef.current.length !== 0
        || conflictRef.current !== undefined || localDirty) return
      const sameOrOlderRevision = settingsSnapshot.revision !== undefined
        && lastSavedRevisionRef.current !== undefined
        && settingsSnapshot.revision <= lastSavedRevisionRef.current
        && JSON.stringify(remote) !== JSON.stringify(lastSavedRef.current)
      if (sameOrOlderRevision) return
      const cleanedRemote = migrateOuterShellEditors(remote)
      lastSavedRef.current = cleanedRemote
      setLayout(cleanedRemote)
      setSaveState('saved')
    }
    // Hydration can finish between the first render and this passive effect.
    // Reconcile once before subscribing so that transition cannot be missed.
    reconcileSettings()
    return settings.subscribe(reconcileSettings)
  }, [settings])

  useEffect(() => {
    if (accountRef.current === account) return
    const previousAccount = accountRef.current
    const previous: AccountDraft = {
      layout: documentRef.current,
      past,
      future,
      pending: pendingRef.current,
      saveState,
      ...(conflictRef.current === undefined ? {} : { conflict: conflictRef.current }),
      lastSaved: lastSavedRef.current,
    }
    draftsRef.current.set(previousAccount, previous)
    // Keep an offline/failed draft local. Account changes must not turn a
    // paused autosave into a silent background retry; the user can retry from
    // the visible save banner after the host becomes writable again.
    if (previous.pending.length !== 0 && previous.conflict === undefined
      && !savePausedRef.current && settingsWritable) {
      void patchLayout({
        operation: 'set', path: ['layouts', previousAccount], value: previous.layout,
      }).then((result) => {
        const cached = draftsRef.current.get(previousAccount)
        /* v8 ignore next -- the same effect inserts this draft before starting the patch and never deletes map entries. */
        if (cached === undefined) return
        if (result.status === 'committed') {
          draftsRef.current.set(previousAccount, {
            ...cached,
            pending: cached.pending.slice(previous.pending.length),
            saveState: 'saved',
            lastSaved: previous.layout,
          })
        } else if (result.status === 'unavailable') {
          draftsRef.current.set(previousAccount, { ...cached, saveState: 'offline' })
        } else {
          const remote = settings.getSnapshot().value?.layouts[previousAccount] ?? cached.lastSaved
          draftsRef.current.set(previousAccount, {
            ...cached,
            saveState: 'conflict',
            conflict: { remote, local: cached.layout },
          })
        }
      })
    }
    accountRef.current = account
    const cached = draftsRef.current.get(account)
    // Offline is a transient transport state now. Restoring an account must
    // not inherit a permanent pause; only an unresolved conflict requires an
    // explicit decision before writes resume.
    savePausedRef.current = cached?.saveState === 'conflict'
    const saved = settings.getSnapshot().value
    const persisted = saved?.layouts[account]
    let next = cached?.layout
      ?? (persisted === undefined ? defaultLayout(projectNeutral ? undefined : current, account) : migrateOuterShellEditors(persisted))
    const nextLastSaved = cached?.lastSaved ?? next
    let nextPast = cached?.past ?? []
    let nextPending = cached?.pending ?? []
    const deferred = deferredOpenRef.current
    if (deferred !== undefined && deferred.account === account) {
      if (saved?.invalidLayouts[account] === undefined) {
        const commands = openSessionCommands(next, deferred.target, deferred.disposition)
        /* v8 ignore next -- openSessionCommands always returns an activate or add command for a valid Session. */
        if (commands.length !== 0) {
          nextPast = [...nextPast.slice(-49), next]
          next = applyCommands(next, commands)
          nextPending = [{ type: 'replace-layout', document: next }]
        }
      }
      deferredOpenRef.current = undefined
    }
    lastSavedRef.current = nextLastSaved
    lastSavedRevisionRef.current = undefined
    setPast(nextPast)
    setFuture(cached?.future ?? [])
    setPending(nextPending)
    setConflict(cached?.conflict)
    setLayout(next)
    setInvalidLayout(saved?.invalidLayouts[account])
    setSaveState(nextPending.length !== 0
      ? 'saving'
      : cached?.saveState ?? (settings.getSnapshot().status === 'ready' ? 'saved' : 'offline'))
  }, [account, current, future, past, saveState, settings, patchLayout, settingsWritable])

  useEffect(() => {
    if (surfaceView === 'home') return
    if (collaborationControlled) return
    if (pending.length === 0 || conflict !== undefined
      || saveInFlightRef.current !== undefined || flushInFlightRef.current !== undefined) return
    if (savePausedRef.current || !settingsWritable) {
      setSaveState('offline')
      return
    }
    setSaveState('saving')
    const timer = window.setTimeout(() => {
      saveTimerRef.current = undefined
      const submitted = pending
      const submittedDocument = documentRef.current
      const saving = patchLayout({
        operation: 'set', path: ['layouts', account], value: submittedDocument,
      }).then((result) => {
        if (accountRef.current !== account) return
        if (result.status === 'committed') {
          saveRetryAttemptRef.current = 0
          lastSavedRef.current = submittedDocument
          lastSavedRevisionRef.current = result.revision
          const currentDocument = documentRef.current
          const hasNewerDocument = JSON.stringify(currentDocument) !== JSON.stringify(submittedDocument)
          const remaining = hasNewerDocument
            ? [{ type: 'replace-layout' as const, document: currentDocument }]
            : []
          pendingRef.current = remaining
          setPending(remaining)
          setSaveState(remaining.length === 0 ? 'saved' : 'saving')
          return
        }
        if (result.status === 'conflict') {
          const remote = settings.getSnapshot().value?.layouts[account] ?? defaultLayout(projectNeutral ? undefined : current, account)
          const replayed = pendingRef.current.reduce(applyLayoutCommand, remote)
          lastSavedRef.current = remote
          setLayout(replayed)
          setConflict({ remote, local: replayed })
          setSaveState('conflict')
          return
        }
        // Temporary host/transport failures keep the latest pending snapshot
        // and retry with bounded backoff. Conflicts remain the only terminal
        // autosave state because they require an explicit user decision.
        savePausedRef.current = false
        setSaveState('offline')
        scheduleAutosaveRetry()
      }).catch(() => {
        if (accountRef.current !== account) return
        savePausedRef.current = false
        setSaveState('offline')
        scheduleAutosaveRetry()
      }).finally(() => {
        if (saveInFlightRef.current === saving) {
          saveInFlightRef.current = undefined
          // A failed write has already scheduled its bounded retry. Avoid
          // immediately starting another write from the in-flight cleanup.
          if (saveRetryTimerRef.current === undefined) {
            setPersistenceTick(value => value + 1)
          }
        }
      })
      saveInFlightRef.current = saving
    }, 250)
    saveTimerRef.current = timer
    return () => {
      window.clearTimeout(timer)
      if (saveTimerRef.current === timer) saveTimerRef.current = undefined
    }
  }, [account, collaborationControlled, conflict, current, pending, persistenceTick, projectNeutral, settings, patchLayout, scheduleAutosaveRetry, settingsWritable, surfaceView])

  const reloadRemote = useCallback(() => {
    const remote = conflictRef.current?.remote
    /* v8 ignore next -- this callback is rendered only while conflict carries a remote document. */
    if (remote === undefined) return
    savePausedRef.current = false
    lastSavedRef.current = remote
    setLayout(remote)
    setPending([])
    setPast([])
    setFuture([])
    setConflict(undefined)
    setSaveState('saved')
  }, [])

  const overwriteRemote = useCallback(() => {
    savePausedRef.current = false
    /* v8 ignore next -- this callback is rendered only while conflict carries the local replay. */
    const local = conflictRef.current?.local ?? documentRef.current
    setLayout(local)
    setPending([{ type: 'replace-layout', document: local }])
    setConflict(undefined)
    setSaveState('saving')
  }, [])

  const exportLocal = useCallback(() => {
    /* v8 ignore next -- this callback is rendered only while conflict carries the local replay. */
    const local = conflictRef.current?.local ?? documentRef.current
    downloadJson(`dsh-workbench-layout-${accountRef.current.replace(':', '-')}.json`, local)
  }, [])

  const exportInvalid = useCallback(() => {
    /* v8 ignore next -- this callback is rendered only while invalidLayoutRef holds the raw record. */
    if (invalidLayoutRef.current === undefined) return
    downloadJson(
      `dsh-workbench-unsupported-${accountRef.current.replace(':', '-')}.json`,
      invalidLayoutRef.current,
    )
  }, [])

  const resetInvalid = useCallback(() => {
    void patchLayout({
      operation: 'unset', path: ['layouts', accountRef.current],
    }).then((result) => {
      if (result.status !== 'committed') {
        setStateDiagnostic(t('shell.couldNotResetTheLayoutReconnectOr'))
        return
      }
      const next = defaultLayout(projectNeutral ? undefined : current, account)
      lastSavedRef.current = next
      setInvalidLayout(undefined)
      setLayout(next)
      setPast([])
      setFuture([])
      setPending([])
      setSaveState('saved')
      setStateDiagnostic(undefined)
    })
  }, [current, settings, patchLayout])

  const guardedCommands = useRef(new WeakSet<object>())
  const pendingDestructiveCommands = useRef(new Set<string>())
  /**
   * Send the current layout to the Host collaboration session. Only one
   * write is in flight; edits made meanwhile are sent as one more write when
   * it returns. A refused write restores the layout the Host holds.
   */
  const submitSharedLayout = useCallback(() => {
    const client = props.collaborationClient
    if (client === undefined || sharedLayoutFlightRef.current) return
    sharedLayoutFlightRef.current = true
    setSaveState('saving')
    void (async () => {
      let failure: string | undefined
      try {
        for (;;) {
          const submitted = documentRef.current
          const splitId = sharedLayoutRatioSplitRef.current
          sharedLayoutRatioSplitRef.current = undefined
          let leaseId: string | undefined
          if (splitId !== undefined) {
            const lease = await client.command({ kind: 'layout.acquire-lease', targetId: `split:${splitId}` })
            const value = lease.ok && lease.value && typeof lease.value === 'object' ? lease.value as { leaseId?: unknown; ok?: unknown } : undefined
            if (value?.ok !== true || typeof value.leaseId !== 'string') { failure = t('shell.anotherParticipantIsMovingThisDivider'); break }
            leaseId = value.leaseId
          }
          const result = await client.command({ kind: 'canvas.set-layout', layout: submitted, ...(leaseId === undefined ? {} : { leaseId }) })
          if (leaseId !== undefined && splitId !== undefined) void client.command({ kind: 'layout.release-lease', targetId: `split:${splitId}`, leaseId }).catch(() => {})
          if (!result.ok) { failure = result.message; break }
          if (documentRef.current === submitted) break
        }
      } catch {
        failure = collaborationStatusLabel(client.getState(), t) ?? t('shell.collaborationDisconnected')
      } finally {
        sharedLayoutFlightRef.current = false
      }
      const host = sharedLayoutOf(client.getSnapshot()?.sharedCanvas.layout)
      if (host !== undefined) {
        const serialized = JSON.stringify(host)
        sharedLayoutAppliedRef.current = serialized
        if (serialized !== JSON.stringify(documentRef.current)) {
          documentRef.current = host
          lastSavedRef.current = host
          setLayout(host)
          if (failure !== undefined) { setPast([]); setFuture([]) }
        }
      }
      setSaveState('saved')
      if (failure !== undefined) setStateDiagnostic(t('shell.layoutChangesWereNotSavedRestoredThe', { value1: failure }))
    })()
  }, [props.collaborationClient])

  // Undo, redo and other whole-document replacements queue a pending layout.
  // On a collaboration canvas that layout goes to the Host session.
  useEffect(() => {
    if (!collaborationControlled || pending.length === 0) return
    pendingRef.current = []
    setPending([])
    submitSharedLayout()
  }, [collaborationControlled, pending, submitSharedLayout])

  const commit = useCallback<Commit>((command) => {
    if (!canEditLayout) { setStateDiagnostic(t('shell.thisShareDoesNotAllowLayoutChanges')); return false }
    if (floatingPinPending.current) return false
    const currentWorkbenchId = props.floatingRuntime?.visibleWorkbenchId
    if (currentWorkbenchId && props.floatingRuntime?.hasControl?.(currentWorkbenchId) === false) return false
    if (browserOwnedWorkbench) {
      setStateDiagnostic(t('shell.takeBackControlFromTheBrowserBefore'))
      return false
    }
    if (invalidLayoutRef.current !== undefined) {
      setStateDiagnostic(t('shell.thisLayoutVersionIsUnsupportedExportThe'))
      return false
    }
    if ((layoutLocked || layoutLockPending) && command.type === 'set-ratio') {
      setStateDiagnostic(t('shell.unlockTheLayoutToResizeAreas'))
      return false
    }
    const before = documentRef.current
    const candidate = applyLayoutCommand(before, command)
    if (candidate === before) return false
    if (!validateWorkbenchDocumentV3(migrateDocumentV2ToV3(candidate))) {
      setStateDiagnostic(t('shell.thisActionWouldCreateAnInvalidLayout'))
      return false
    }
    if (collaborationControlled) {
      const client = props.collaborationClient
      if (client === undefined) return false
      if (client.getState() !== 'connected') {
        setStateDiagnostic(collaborationStatusLabel(client.getState(), t) ?? t('shell.connectToTheCollaborationSessionBeforeEditing'))
        return false
      }
    }
    const nextTabs = tabsOf(candidate.root)
    const displaced = tabsOf(before.root).filter(old => {
      const next = nextTabs.find(tab => tab.id === old.id)
      return !next || next.editorId !== old.editorId || next.sessionId !== old.sessionId || next.bindingGeneration !== old.bindingGeneration
        || command.type === 'replace-tab' && command.tabId === old.id
    })
    if (displaced.length && props.floatingRuntime && !guardedCommands.current.has(command)) {
      const runtime = props.floatingRuntime, owner = accountRef.current, ownerWorkbenchId = currentWorkbenchId
      if (displaced.some(tab => pendingDestructiveCommands.current.has(tab.id) || runtime.find(tab.id, ownerWorkbenchId)?.busy)) return false
      for (const tab of displaced) pendingDestructiveCommands.current.add(tab.id)
      void (async () => {
        try {
          for (const tab of displaced) if (!await runtime.authorizeClose(tab.id, ownerWorkbenchId)) return
          if (accountRef.current !== owner || runtime.visibleWorkbenchId !== ownerWorkbenchId || documentRef.current !== before) return
          guardedCommands.current.add(command); commit(command)
        } finally { for (const tab of displaced) pendingDestructiveCommands.current.delete(tab.id) }
      })()
      return false
    }
    setLayout((previous) => {
      const next = applyLayoutCommand(previous, command)
      if (next === previous) return previous
      documentRef.current = next
      if (recordsLayoutHistory(command)) {
        setPast(history => [...history.slice(-49), previous])
        setFuture([])
      }
      setPending(() => {
        if (collaborationControlled) return []
        const nextPending: LayoutCommand[] = [{ type: 'replace-layout', document: next }]
        pendingRef.current = nextPending
        return nextPending
      })
      return next
    })
    if (collaborationControlled) {
      // The state updater above may run later; the submitter reads this ref.
      documentRef.current = candidate
      if (command.type === 'set-ratio') sharedLayoutRatioSplitRef.current = command.splitId
      submitSharedLayout()
    }
    for (const tab of displaced) {
      if (props.floatingRuntime?.find(tab.id, currentWorkbenchId)) props.floatingRuntime.forget(tab.id, currentWorkbenchId)
      else closeWorkbenchNative(tab.id)
    }
    return true
  }, [browserOwnedWorkbench, collaborationControlled, layoutLockPending, layoutLocked, props.collaborationClient, props.floatingRuntime, canEditLayout, submitSharedLayout])

  const replaceVisibleDocument = useCallback((next: WorkbenchLayoutDocument) => {
    const previous = documentRef.current
    if (next === previous) return
    documentRef.current = next
    setPast(history => [...history.slice(-49), previous])
    setFuture([])
    setPending(() => {
      const nextPending: LayoutCommand[] = [{ type: 'replace-layout', document: next }]
      pendingRef.current = nextPending
      return nextPending
    })
    setLayout(next)
  }, [])

  const splitEmpty = useCallback((
    sourceAreaId: string,
    edge: Exclude<DropEdge, 'center'>,
    ratio = 0.5,
  ) => {
    const document = documentRef.current
    const next = projectDocumentV3ToLayoutV2(applyWorkbenchCommandV3(
      migrateDocumentV2ToV3(document),
      { type: 'split-empty', sourceAreaId, edge, ratio },
      kind => nextId(kind),
    ), workbenchDirectory.getAreaProjects?.(workbenchDirectory.getSnapshot().activeWorkbenchId ?? ''))
    if (next.root !== document.root) replaceVisibleDocument(next)
  }, [replaceVisibleDocument])

  const finishPlacement = useCallback((
    holder: { workbenchId: string; repository: WorkbenchRepository },
    result: PlacementResult,
  ): PlacementResult => {
    if (result.status !== 'bound' || placementRepositoryRef.current !== holder) return result
    const record = holder.repository.getWorkbench(holder.workbenchId)
    if (record === undefined) return result
    const next = projectDocumentV3ToLayoutV2(record.document, record.areaProjects)
    replaceVisibleDocument(next)
    return result
  }, [replaceVisibleDocument])

  const completePreparedConversation = useCallback((input: {
    areaId: string
    moduleInstanceId: string
    bindingGeneration: number
    target: SessionBindingV1
  }): boolean => {
    const group = groupsOf(documentRef.current.root).find(candidate => candidate.id === input.areaId)
    const active = group?.tabs.find(tab => tab.id === input.moduleInstanceId)
    if (active === undefined || active.id !== input.moduleInstanceId
      || active.editorId !== 'workbench.conversation.start'
      || active.bindingGeneration !== input.bindingGeneration
      || active.binding?.sessionId !== input.target.sessionId
      || active.binding?.workspaceId !== input.target.workspaceId) return false
    const holder = placementRepositoryRef.current
    if (holder === undefined) return false
    holder.repository.replaceDocument(holder.workbenchId, migrateDocumentV2ToV3(documentRef.current))
    if (!holder.repository.activatePreparedConversation(
      holder.workbenchId, input.areaId, input.target, input.moduleInstanceId, input.bindingGeneration,
    )) return false
    const record = holder.repository.getWorkbench(holder.workbenchId)
    if (record === undefined) return false
    replaceVisibleDocument(projectDocumentV3ToLayoutV2(record.document, record.areaProjects))
    return true
  }, [replaceVisibleDocument])

  const coordinatorFor = useCallback((holder: {
    workbenchId: string
    repository: WorkbenchRepository
  }): ConversationAreaCoordinator => {
    return new ConversationAreaCoordinator(holder.repository, {
      isStartCurrent: (workbenchId, areaId, moduleInstanceId) => {
        if (placementRepositoryRef.current !== holder || workbenchId !== holder.workbenchId) return false
        const group = groupsOf(documentRef.current.root).find(candidate => candidate.id === areaId)
        const active = group?.tabs.find(tab => tab.id === moduleInstanceId)
        return active?.id === moduleInstanceId && active.editorId === 'workbench.conversation.start'
      },
      connectWorkspace: async (workspaceId, options) => {
        if (connectWorkspace === undefined) throw new Error('Workspace connection is unavailable')
        return connectWorkspace(workspaceId, options)
      },
      createWorkspaceSession: async (workspaceId, options) => {
        if (createWorkspaceSession === undefined) throw new Error('Independent Session creation is unavailable')
        return createWorkspaceSession(workspaceId, options)
      },
      createWorkspace: async (input) => {
        if (createWorkspace === undefined) throw new Error('Workspace creation is unavailable')
        return createWorkspace(input.path)
      },
    })
  }, [connectWorkspace, createWorkspace, createWorkspaceSession])

  const placeConversation = useCallback(async (
    areaId: string,
    input: { workspaceId: string; agentPreset?: string; presentation?: 'start' | 'conversation'; startModuleInstanceId?: string },
  ): Promise<SessionBindingV1> => {
    const holder = placementRepositoryRef.current
    if (holder === undefined) throw new Error('Workbench placement owner is unavailable')
    if (workbenchDirectory.getAreaProjects) {
      const project = workbenchDirectory.getAreaProjects(holder.workbenchId)[areaId]
      if (!project?.workspaceId) throw new Error(t('shell.setAProjectFolderInTheArea'))
      if (input.workspaceId !== project.workspaceId) throw new Error(t('shell.newConversationsMustUseThisAreaS'))
    }
    holder.repository.replaceDocument(holder.workbenchId, migrateDocumentV2ToV3(documentRef.current))
    const requestId = nextId('area-conversation')
    const claim = holder.repository.claimArea(holder.workbenchId, areaId, requestId)
    const result = await coordinatorFor(holder).execute({
      type: 'create-in-workspace', claim, workspaceId: input.workspaceId,
      ...(input.agentPreset === undefined ? {} : { agentPreset: input.agentPreset }),
      ...(input.presentation === undefined ? {} : { presentation: input.presentation }),
      ...(input.startModuleInstanceId === undefined ? {} : { startModuleInstanceId: input.startModuleInstanceId }),
    })
    finishPlacement(holder, result)
    if (result.status === 'failed') throw Object.assign(new Error(result.message), { code: result.code })
    if (result.status === 'stale') {
      throw Object.assign(new Error(`Conversation placement expired: ${result.reason}`), { code: 'placement-stale' })
    }
    return result.target
  }, [coordinatorFor, finishPlacement])

  const bindSidebarSession = useCallback(async (input: {
    sessionId: string
    areaId: string
    strategy: 'replace-focused-area'
  }): Promise<void> => {
    const holder = placementRepositoryRef.current
    if (holder === undefined) throw new Error('Workbench placement owner is unavailable')
    holder.repository.replaceDocument(holder.workbenchId, migrateDocumentV2ToV3(documentRef.current))
    const claim = holder.repository.claimArea(holder.workbenchId, input.areaId, nextId('sidebar-open'))
    const workspace = workspaces.find(item => item.sessionIds.includes(input.sessionId as SessionId))
    const result = await coordinatorFor(holder).execute({
      type: 'open-existing', claim,
      target: { ...(workspace === undefined ? {} : { workspaceId: workspace.workspaceId }), sessionId: input.sessionId },
    })
    finishPlacement(holder, result)
    if (result.status === 'failed') throw new Error(result.message)
    if (result.status === 'stale') throw new Error(`Conversation placement expired: ${result.reason}`)
  }, [coordinatorFor, finishPlacement, workspaces])

  const startSidebarSession = useCallback(async (input: {
    workspaceId?: string
    areaId: string
    agentPreset?: string
  }): Promise<void> => {
    const editorId = 'workbench.conversation.start'
    if (!editorCatalog.getSnapshot().some(editor => editor.id === editorId && editor.scope === 'root')) {
      throw new Error(t('shell.theNativeConversationPageIsNotReady'))
    }
    const document = documentRef.current
    const ownerWorkbenchId = props.floatingRuntime?.visibleWorkbenchId
    const group = groupsOf(document.root).find(candidate => candidate.id === input.areaId)
    if (group === undefined) throw new Error(t('shell.workbenchAreaValue1WasNotFound', { value1: input.areaId }))
    const tab: TabDocument = {
      id: nextId('tab'), editorId, editorScope: 'root', lastKnownTitle: '新建对话', state: {},
    }
    // Add first: closing the last tab first would collapse a split Area and
    // leave no destination for the new Start editor.
    const commands: LayoutCommand[] = [{ type: 'add-tab', groupId: group.id, tab }]
    if (group.activeTabId !== undefined) {
      if (props.floatingRuntime && !await props.floatingRuntime.authorizeClose(group.activeTabId, ownerWorkbenchId)) return
      if (documentRef.current !== document || props.floatingRuntime?.visibleWorkbenchId !== ownerWorkbenchId) return
      commands.push({ type: 'close-tab', tabId: group.activeTabId })
    }
    const next = applyCommands(document, commands)
    // Opening Start invalidates pending placement in this Area. Workspace and
    // Agent selection stay local until the first non-empty composer submit.
    const holder = placementRepositoryRef.current
    holder?.repository.replaceDocument(holder.workbenchId, migrateDocumentV2ToV3(next))
    replaceVisibleDocument(next)
    if (group.activeTabId) { props.floatingRuntime?.forget(group.activeTabId, ownerWorkbenchId); closeWorkbenchNative(group.activeTabId) }
  }, [editorCatalog, replaceVisibleDocument, props.floatingRuntime])

  const sidebarRouting = useMemo<WorkbenchShellSidebarRoutingV1>(() => {
    const activeBinding = bindingOfActive(layout)
    const snapshot = Object.freeze({
      focusedAreaId: migrateDocumentV2ToV3(layout).activeAreaId,
      ...(activeBinding === undefined ? {} : { focusedSessionId: activeBinding.sessionId }),
    })
    return {
      getSnapshot: () => snapshot,
      // The Frame re-renders whenever its visible document changes. The
      // immutable snapshot above is therefore sufficient for the nested
      // browser without creating a global Session-selection subscription.
      subscribe: () => () => {},
      startSession: startSidebarSession,
      bindExistingSession: bindSidebarSession,
    }
  }, [bindSidebarSession, layout, startSidebarSession])

  useEffect(() => {
    if (splitPlacement === undefined) return
    const cancel = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') setSplitPlacement(undefined)
    }
    window.addEventListener('keydown', cancel)
    return () => { window.removeEventListener('keydown', cancel) }
  }, [splitPlacement])

  const dispatchNavigation = useCallback((command: SessionOpenCommandV1) => {
    const { sessionId } = command.target
    const legacyWorkspace = command.origin === 'legacy'
      ? workspaces.find(item => item.sessionIds.includes(sessionId))
      : undefined
    const target = command.origin === 'legacy'
      ? {
        ...legacyWorkspace === undefined
          ? {}
          : { workspaceId: legacyWorkspace.workspaceId },
        sessionId,
      }
      : command.target
    const targetAccount = accountForBinding(target)
    preciseAccountsRef.current.set(sessionId, targetAccount)
    if (!projectNeutral && targetAccount !== accountRef.current) {
      deferredOpenRef.current = { account: targetAccount, target, disposition: command.disposition }
      selectSession(sessionId)
      return
    }
    const commands = openSessionCommands(documentRef.current, target, command.disposition)
    if (!commands.length) { setStateDiagnostic(t('shell.thisConversationBelongsToAnotherProjectOpen')); return }
    for (const layoutCommand of commands) commit(layoutCommand)
  }, [commit, projectNeutral, selectSession, workspaces])

  const reserveNavigation = useCallback((
    request: SessionPlacementRequestV2,
  ): SessionPlacementReservationV1 => {
    const holder = placementRepositoryRef.current
    const reservation: SessionPlacementReservationV1 = {
      reservationId: nextId('reservation'), requestId: request.requestId,
    }
    if (holder === undefined) return reservation

    let document = migrateDocumentV2ToV3(documentRef.current)
    holder.repository.replaceDocument(holder.workbenchId, document)
    if (request.disposition === 'new') {
      document = applyWorkbenchCommandV3(
        document,
        { type: 'split-empty', sourceAreaId: document.activeAreaId, edge: 'right' },
        kind => nextId(kind),
      )
      holder.repository.replaceDocument(holder.workbenchId, document)
      replaceVisibleDocument(projectDocumentV3ToLayoutV2(document, workbenchDirectory.getAreaProjects?.(holder.workbenchId)))
    }
    const claim = holder.repository.claimArea(
      holder.workbenchId, document.activeAreaId, request.requestId,
    )
    navigationReservationsRef.current.set(reservation.reservationId, { holder, claim })
    return reservation
  }, [replaceVisibleDocument])

  const resolveNavigation = useCallback((
    reservation: SessionPlacementReservationV1,
    target: SessionTarget,
  ) => {
    const row = navigationReservationsRef.current.get(reservation.reservationId)
    if (row === undefined || reservation.requestId !== row.claim.requestId) return
    navigationReservationsRef.current.delete(reservation.reservationId)
    void coordinatorFor(row.holder).execute({
      type: 'open-existing', claim: row.claim, target,
    }).then(result => finishPlacement(row.holder, result))
  }, [coordinatorFor, finishPlacement])

  const navigationHandler = useMemo<WorkbenchNavigationHandler>(() => ({
    dispatch: dispatchNavigation,
    reserve: reserveNavigation,
    resolve: resolveNavigation,
  }), [dispatchNavigation, reserveNavigation, resolveNavigation])

  useEffect(() => bindNavigation(navigationHandler), [bindNavigation, navigationHandler])
  useEffect(() => () => { navigationReservationsRef.current.clear() }, [])
  useEffect(() => bindLayout({
    toggleSidebar,
    // Tool Details was removed from Workbench. Keep the legacy layout seam
    // callable, but never materialize a retired editor or mutate the Area.
    openDetails: () => {},
    closeDetails: () => {},
  }), [bindLayout, toggleSidebar])

  useEffect(() => {
    // Independent Workbench Areas never drive the official main Session.
    if (projectNeutral) return
    const activeBinding = bindingOfActive(layout)
    const activeSession = activeBinding?.sessionId
    const resolved = activeBinding === undefined ? undefined : resolveSessionTarget(activeBinding, {
      workspaces,
      sessions: sessionRows,
      archivedSessionIds,
      markersByWorkspace: settingsSnapshot.value?.sessionMarkers ?? {},
    })
    // During a Workspace switch the previous account's tree remains mounted
    // for one render. Do not drive the global current Session back from that
    // stale tree, or a real external store will oscillate between the two
    // accounts before the deferred navigation command can settle.
    if (activeSession !== undefined
      && activeBinding !== undefined
      && accountForBinding(activeBinding) === account
      && resolved?.providerEligible === true
      && activeSession !== current
    ) {
      selectSession(activeSession as SessionId)
    }
  }, [account, archivedSessionIds, current, layout, projectNeutral, selectSession, sessionRows,
    settingsSnapshot.value?.sessionMarkers, workspaces])

  const undoLayout = useCallback(() => {
    const previous = past.at(-1)
    if (previous === undefined) return
    const currentDocument = documentRef.current
    const restored = layoutLocked || layoutLockPending ? preserveSplitRatios(currentDocument, previous) : previous
    documentRef.current = restored
    setPast(rows => rows.slice(0, -1))
    setFuture(rows => [...rows.slice(-49), currentDocument])
    setLayout(restored)
    setPending(() => {
      const nextPending: LayoutCommand[] = [{ type: 'replace-layout', document: restored }]
      pendingRef.current = nextPending
      return nextPending
    })
  }, [layoutLockPending, layoutLocked, past])

  const redoLayout = useCallback(() => {
    const next = future.at(-1)
    if (next === undefined) return
    const currentDocument = documentRef.current
    const restored = layoutLocked || layoutLockPending ? preserveSplitRatios(currentDocument, next) : next
    documentRef.current = restored
    setFuture(rows => rows.slice(0, -1))
    setPast(rows => [...rows.slice(-49), currentDocument])
    setLayout(restored)
    setPending(() => {
      const nextPending: LayoutCommand[] = [{ type: 'replace-layout', document: restored }]
      pendingRef.current = nextPending
      return nextPending
    })
  }, [future, layoutLockPending, layoutLocked])

  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      const target = event.target
      if (target instanceof Element
        && target.closest('input, textarea, select, [contenteditable="true"]')) return
      if (event.ctrlKey && event.key.toLowerCase() === 'w') {
        const group = groupsOf(documentRef.current.root)
          .find(row => row.id === documentRef.current.activeGroupId)
        if (group?.activeTabId !== undefined) {
          event.preventDefault()
          commit({ type: 'close-tab', tabId: group.activeTabId })
        }
      }
      if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'd') {
        const group = groupsOf(documentRef.current.root)
          .find(row => row.id === documentRef.current.activeGroupId)
        if (group?.activeTabId !== undefined) {
          event.preventDefault()
          commit({
            type: 'duplicate-tab', tabId: group.activeTabId, newTabId: nextId('tab'), targetGroupId: group.id,
            edge: 'right', ids: { groupId: nextId('group'), splitId: nextId('split') },
          })
        }
      }
      if (event.ctrlKey && event.altKey && !event.shiftKey
        && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
        const group = groupsOf(documentRef.current.root)
          .find(row => row.id === documentRef.current.activeGroupId)
        /* v8 ignore next -- activeGroupId is validated whenever a layout document is created or loaded. */
        const target = group === undefined ? undefined : adjacentGroup(
          documentRef.current, group.id, event.key === 'ArrowLeft' ? 'previous' : 'next',
        )
        const targetTab = target === undefined ? undefined : activeTab(target)
        if (group?.activeTabId !== undefined && target !== undefined && targetTab !== undefined) {
          event.preventDefault()
          commit({ type: 'activate', groupId: target.id, tabId: targetTab.id })
        }
      }
      if (event.ctrlKey && event.altKey && event.shiftKey
        && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
        const group = groupsOf(documentRef.current.root)
          .find(row => row.id === documentRef.current.activeGroupId)
        /* v8 ignore next -- activeGroupId is an invariant of WorkbenchLayoutDocument. */
        if (group?.activeTabId !== undefined) {
          const edge = {
            ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'top', ArrowDown: 'bottom',
          }[event.key] as Exclude<DropEdge, 'center'>
          event.preventDefault()
          splitEmpty(group.id, edge)
        }
      }
    }
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('keydown', onKey) }
  }, [commit, splitEmpty])

  const activeWorkspace = account === 'ungrouped'
    ? undefined
    : workspaces.find(row => `workspace:${row.workspaceId}` === account)
  const markerWorkspaceId = activeWorkspace?.workspaceId
  const markerProjections = useMemo(() => Object.fromEntries<ReturnType<typeof ensureSessionMarkers>>(workspaces.map(workspace => [
    workspace.workspaceId,
    ensureSessionMarkers(workspace.sessionIds, {
      ...settingsSnapshot.value?.sessionMarkers[workspace.workspaceId],
      ...markerOverrides[workspace.workspaceId],
    }),
  ])), [markerOverrides, settingsSnapshot.value?.sessionMarkers, workspaces])
  const markerProjection = markerWorkspaceId === undefined
    ? ensureSessionMarkers([], {})
    : markerProjections[markerWorkspaceId] ?? ensureSessionMarkers(activeWorkspace?.sessionIds ?? [], {})
  const allWorkspaceSessionMarkers = useMemo(() => ({
    ...settingsSnapshot.value?.sessionMarkers,
    ...Object.fromEntries(Object.entries(markerProjections)
      .map(([workspaceId, projection]) => [workspaceId, projection.markers])),
  }), [markerProjections, settingsSnapshot.value?.sessionMarkers])
  const markerSignature = JSON.stringify(allWorkspaceSessionMarkers)
  const markerProjectionChanged = Object.values(markerProjections).some(projection => projection.changed)
  const markerOverrideActive = Object.values(markerOverrides).some(rows => Object.keys(rows).length !== 0)
  useEffect(() => {
    if (isBrowserSurface || !markerProjectionChanged || markerOverrideActive
      || settingsSnapshot.status !== 'ready' || ! settingsSnapshot.writable
      || settingsSnapshot.revision === undefined) return
    const attempt = `all:${String(settingsSnapshot.revision)}:${markerSignature}`
    if (markerPersistAttemptsRef.current.has(attempt)) return
    markerPersistAttemptsRef.current.add(attempt)
    void (settings as WorkbenchSettingsScope).patch({
      operation: 'set', path: ['sessionMarkers'],
      value: allWorkspaceSessionMarkers, expectedRevision: settingsSnapshot.revision,
    })
  }, [allWorkspaceSessionMarkers, markerOverrideActive, markerProjectionChanged, markerSignature, settings, settingsSnapshot, isBrowserSurface])
  const updateSessionMarker = useCallback((
    requestedWorkspaceId: string | undefined,
    sessionId: string,
    marker: SessionMarkerRecord,
  ) => {
    const workspaceId = requestedWorkspaceId ?? markerWorkspaceId
    if (workspaceId === undefined) return
    setMarkerOverrides(current => ({
      ...current,
      [workspaceId]: { ...current[workspaceId], [sessionId]: marker },
    }))
    // Browser owners and LAN participants save the marker on the Host as
    // well; a page-local marker would differ from every other surface.
    const snapshot = settings.getSnapshot()
    if (snapshot.status !== 'ready' || ! snapshot.writable || snapshot.revision === undefined) {
      setStateDiagnostic(t('shell.reconnectToSaveTheConversationMarker'))
      return
    }
    const discard = (message: string) => {
      setMarkerOverrides((current) => {
        const workspaceRows = withoutRecordKey(current[workspaceId] ?? {}, sessionId)
        return { ...current, [workspaceId]: workspaceRows }
      })
      setStateDiagnostic(message)
    }
    void (settings as WorkbenchSettingsScope).patch({
      operation: 'set', path: ['sessionMarkers', workspaceId, sessionId],
      value: marker, expectedRevision: snapshot.revision,
    }).then((result) => {
      if (result.status === 'committed') {
        // On a shared surface the Host marker is the fact. The response has
        // already refreshed the snapshot, and a kept local override would
        // hide a later change made by another participant.
        if (isBrowserSurface) setMarkerOverrides((current) => ({ ...current, [workspaceId]: withoutRecordKey(current[workspaceId] ?? {}, sessionId) }))
        return
      }
      discard(t('shell.theMarkerChangedElsewhereTheRemoteMarker'))
    }, (error: unknown) => {
      discard(error instanceof Error && error.message ? t('shell.couldNotSaveMarkerValue1', { value1: error.message }) : t('shell.couldNotSaveMarkerReconnectAndTry'))
    })
  }, [markerWorkspaceId, settings, isBrowserSurface])
  const workspaceTitle = activeWorkspace?.title ?? t('shell.ungrouped')
  const sessionTitle = current === undefined ? undefined : sessionRows[current]?.displayTitle
  const flushCurrentWorkbench = useCallback((): Promise<boolean> => {
    if (floatingPinPending.current) return Promise.resolve(false)
    if (surfaceView === 'home') return props.beforeHomeLeave?.() ?? Promise.resolve(true)
    if (flushInFlightRef.current !== undefined) return flushInFlightRef.current
    // A lifecycle transition must still honor dirty snapshots and conflicts,
    // but a clean document has nothing to flush. Avoid making every
    // Workbench switch wait for an unnecessary CAS round trip.
    if (saveInFlightRef.current === undefined && pendingRef.current.length === 0
      && conflictRef.current === undefined
      && JSON.stringify(documentRef.current) === JSON.stringify(lastSavedRef.current)) return Promise.resolve(true)
    if (saveTimerRef.current !== undefined) {
      window.clearTimeout(saveTimerRef.current)
      saveTimerRef.current = undefined
    }
    const flushAccount = accountRef.current
    const run = async (): Promise<boolean> => {
      // Serialize lifecycle flushes with autosave, then drain edits made
      // during the write. Returning true for an older snapshot loses edits
      // as soon as the directory switches the active Workbench.
      await saveInFlightRef.current
      if (accountRef.current !== flushAccount) return false
      if (conflictRef.current !== undefined) {
        setStateDiagnostic(t('shell.chooseTheLocalOrRemoteLayoutTo'))
        return false
      }
      while (pendingRef.current.length !== 0) {
        const submittedDocument = documentRef.current
        const settingsSnapshot = settings.getSnapshot()
        setSaveState('saving')
        const result = await patchLayout({
          operation: 'set', path: ['layouts', flushAccount], value: submittedDocument,
          ...(settingsSnapshot.status === 'ready' && settingsSnapshot.revision !== undefined
            ? { expectedRevision: settingsSnapshot.revision } : {}),
        }).catch(() => ({ status: 'unavailable' as const }))
        if (accountRef.current !== flushAccount) return false
        if (result.status !== 'committed') {
          // Lifecycle flushes must not permanently suspend normal autosave
          // after a transient host or transport failure.
          savePausedRef.current = result.status === 'conflict'
          if (result.status === 'conflict') {
            const remote = settings.getSnapshot().value?.layouts[flushAccount] ?? lastSavedRef.current
            const nextConflict = { remote, local: documentRef.current }
            conflictRef.current = nextConflict
            setConflict(nextConflict)
          } else {
            scheduleAutosaveRetry()
          }
          setSaveState(result.status === 'conflict' ? 'conflict' : 'offline')
          setStateDiagnostic(t('shell.couldNotSaveTheCurrentWorkbenchReconnect'))
          return false
        }
        savePausedRef.current = false
        saveRetryAttemptRef.current = 0
        lastSavedRef.current = submittedDocument
        lastSavedRevisionRef.current = result.revision
        const currentDocument = documentRef.current
        const remaining = JSON.stringify(currentDocument) === JSON.stringify(submittedDocument)
          ? []
          : [{ type: 'replace-layout' as const, document: currentDocument }]
        pendingRef.current = remaining
        setPending(remaining)
        setSaveState(remaining.length === 0 ? 'saved' : 'saving')
      }
      return true
    }
    const flushing = run().finally(() => {
      if (flushInFlightRef.current === flushing) flushInFlightRef.current = undefined
      if (saveRetryTimerRef.current === undefined) {
        setPersistenceTick(value => value + 1)
      }
    })
    flushInFlightRef.current = flushing
    return flushing
  }, [settings, patchLayout, scheduleAutosaveRetry, surfaceView, props.beforeHomeLeave])
  const flushForLifecycleTransition = useCallback(() => {
    const diagnostics = (globalThis as { __DSH_WORKBENCH_PERF_DIAGNOSTICS__?: unknown }).__DSH_WORKBENCH_PERF_DIAGNOSTICS__ === true
    if (!diagnostics) return flushCurrentWorkbench()
    const trace = selectionTraceRef.current
    workbenchSelectionMark(trace, 'flush-start')
    const result = flushCurrentWorkbench()
    void result.then(committed => workbenchSelectionMark(trace, committed ? 'flush-committed' : 'flush-failed'))
    return result
  }, [flushCurrentWorkbench])
  const pinFloatingTab = async (tab: TabDocument, areaId: string, edge: DropEdge): Promise<boolean> => {
    const ownerId = selectedWorkbenchId
    if (!ownerId || floatingPinPending.current || browserOwnedWorkbench || !(settingsWritable || ownerCollaborationWritable) || !await flushCurrentWorkbench()) return false
    if (floatingPinPending.current || ownerId !== workbenchDirectory.getSnapshot().activeWorkbenchId || props.floatingRuntime?.hasControl?.(ownerId) === false
      || props.floatingRuntime?.canUseEditor?.(ownerId, tab.editorId) === false
      || tab.binding && props.floatingRuntime?.validBinding?.(tab.binding) === false) return false
    const before = documentRef.current
    const target = groupsOf(before.root).find(group => group.id === areaId)
    if (!target || tabsOf(before.root).some(existing => existing.id === tab.id)) return false
    const targetProject = workbenchDirectory.getAreaProjects?.(ownerId)[areaId]
    const reason = placementReason(tab, targetProject, workbenchDirectory.getAreaProjects !== undefined)
    if (tab.id === 'bay-agent-main' || edge === 'center' && reason) throw new Error(reason ?? areaOperationCopy.mainFixed)
    if (edge !== 'center') {
      const element = [...(resizeCanvasRef.current?.querySelectorAll<HTMLElement>('[data-workbench-group]') ?? [])].find(item => item.dataset.workbenchGroup === areaId)
      const rect = element?.getBoundingClientRect()
      const horizontal = edge === 'left' || edge === 'right'
      if (rect && !splitCanFit(horizontal ? rect.width : rect.height, horizontal ? EXPANDED_AREA_MIN_WIDTH : EXPANDED_AREA_MIN_HEIGHT)) throw new Error(t('shell.theDestinationAreaIsTooSmallTo'))
    }
    const placed = prepareFloatingTabForArea(tab, edge === 'center' ? target : { kind: 'group', id: 'new-area', tabs: [] }, tabsOf(before.root))
    let next = applyLayoutCommand(before, { type: 'add-tab', groupId: areaId, tab: placed })
    if (edge !== 'center') {
      const ids = { groupId: nextId('group'), splitId: nextId('split') }
      next = applyLayoutCommand(next, { type: 'move-tab', tabId: tab.id, targetGroupId: areaId, edge, ids })
      const source = tab.binding?.workspaceId ? Object.entries(workbenchDirectory.getAreaProjects?.(ownerId) ?? {}).find(([, project]) => project.workspaceId === tab.binding?.workspaceId) : undefined
      const projectSplit = (node: LayoutNode): LayoutNode => {
        if (node.kind === 'split') return { ...node, first: projectSplit(node.first), second: projectSplit(node.second) }
        if (node.id !== ids.groupId) return node
        const { project: _project, projectSourceAreaId: _hint, ...rest } = node
        return { ...rest, ...(source ? { project: source[1], projectSourceAreaId: source[0] } : {}) }
      }
      next = { ...next, root: projectSplit(next.root) }
    }
    if (!validateWorkbenchDocumentV3(migrateDocumentV2ToV3(next))) throw new Error(t('shell.thePageCouldNotBeSavedTo'))
    if (ownerCollaborationWritable) {
      const client = props.collaborationClient
      if (client === undefined || next === before) return false
      floatingPinPending.current = true
      try {
        const result = await client.command({ kind: 'canvas.set-layout', layout: next }).catch(() => undefined)
        if (result?.ok !== true) return false
        const latest = props.floatingRuntime?.find(tab.id, ownerId)?.tab
        const visible = latest && latest.state !== tab.state
          ? applyLayoutCommand(next, { type: 'update-tab-state', tabId: tab.id, state: latest.state, bindingGeneration: placed.bindingGeneration ?? 0 }) : next
        const committedTab = tabsOf(visible.root).find(item => item.id === tab.id)
        if (committedTab) props.floatingRuntime?.update(tab.id, committedTab, ownerId)
        documentRef.current = visible; lastSavedRef.current = visible
        pendingRef.current = []; setPending([]); setLayout(visible); setSaveState('saved')
        setPast([]); setFuture([])
        // A controller can finish work while the Host commits the placement.
        if (visible !== next) void client.command({ kind: 'canvas.set-layout', layout: visible }).catch(() => {})
        return true
      } finally { floatingPinPending.current = false }
    }
    const snapshot = settings.getSnapshot()
    if (snapshot.revision === undefined || next === before) return false
    floatingPinPending.current = true
    try {
      const result = await patchLayout({ operation: 'set', path: ['layouts', accountRef.current], value: next, expectedRevision: snapshot.revision })
      if (result.status !== 'committed') return false
      const latest = props.floatingRuntime?.find(tab.id, ownerId)?.tab
      const visible = latest && latest.state !== tab.state
        ? applyLayoutCommand(next, { type: 'update-tab-state', tabId: tab.id, state: latest.state, bindingGeneration: placed.bindingGeneration ?? 0 }) : next
      const committedTab = tabsOf(visible.root).find(item => item.id === tab.id)
      if (committedTab) props.floatingRuntime?.update(tab.id, committedTab, ownerId)
      // A controller can finish work while CAS is pending. Keep that newer
      // state in the normal autosave/conflict pipeline after the durable move.
      const remaining: LayoutCommand[] = visible === next ? [] : [{ type: 'replace-layout', document: visible }]
      documentRef.current = visible; lastSavedRef.current = next; lastSavedRevisionRef.current = result.revision
      pendingRef.current = remaining; setPending(remaining); setLayout(visible); setSaveState(remaining.length ? 'saving' : 'saved')
      // The first durable placement is a transaction boundary. Layout undo
      // must not silently remove a live temporary instance after commit.
      setPast([]); setFuture([])
      return true
    } finally { floatingPinPending.current = false }
  }
  const saveCurrentWorkbench = useCallback(async () => {
    if (!settingsWritable) {
      setStateDiagnostic(t('shell.couldNotSaveTheWorkbenchReconnectAnd'))
      return
    }
    const committed = await flushCurrentWorkbench()
    if (committed) {
      setSaveState('saved')
      setStateDiagnostic(t('shell.workbenchSaved'))
    }
  }, [flushCurrentWorkbench, settingsWritable])
  useEffect(() => workbenchDirectory.setBeforeLifecycleTransition?.(flushForLifecycleTransition), [flushForLifecycleTransition, workbenchDirectory])
  useEffect(() => {
    const requestFlush = (event: Event) => {
      const complete = (event as CustomEvent<{ complete?: unknown }>).detail?.complete
      if (typeof complete !== 'function') return
      void flushCurrentWorkbench().then(
        result => (complete as (ok: boolean) => void)(result),
        () => (complete as (ok: boolean) => void)(false),
      )
    }
    window.addEventListener('workbench-browser-reclaim-flush', requestFlush)
    return () => window.removeEventListener('workbench-browser-reclaim-flush', requestFlush)
  }, [flushCurrentWorkbench])
  const selectWorkbench = useCallback(async (workbenchId: string) => {
    if (surfaceView === 'home' && !(await (props.beforeHomeLeave?.() ?? Promise.resolve(true)))) return
    const currentWorkbenchId = workbenchDirectory.getSnapshot().activeWorkbenchId
    if (currentWorkbenchId === workbenchId) {
      props.onShowWorkbench?.()
      return
    }
    if (frameTransition !== undefined) return
    const trace = { id: nextId('workbench-switch'), targetWorkbenchId: workbenchId }
    selectionTraceRef.current = trace
    workbenchSelectionMark(trace, 'requested')
    setFrameTransition({ kind: 'selection', fromWorkbenchId: currentWorkbenchId ?? 'legacy-frame', workbenchId })
    const result = await workbenchDirectory.select(workbenchId)
    workbenchSelectionMark(trace, result.status === 'committed' ? 'directory-committed' : 'directory-failed')
    if (result.status !== 'committed') {
      selectionTraceRef.current = undefined
      setFrameTransition(current => current?.workbenchId === workbenchId ? undefined : current)
      setStateDiagnostic(t('shell.couldNotSwitchWorkbenchesSettingsChangedElsewhere'))
      return
    }
    props.onShowWorkbench?.()
    navigationReservationsRef.current.clear()
    setStateDiagnostic(undefined)
  }, [frameTransition, props.onShowWorkbench, workbenchDirectory, surfaceView, props.beforeHomeLeave])
  const reorderWorkbench = useCallback(async (workbenchId: string, targetIndex: number) => {
    if (isBrowserSurface === true || workbenchReordering || workbenchDirectory.reorder === undefined) return
    setWorkbenchReordering(true)
    try {
      const result = await workbenchDirectory.reorder(workbenchId, targetIndex)
      if (result.status !== 'committed') {
        setStateDiagnostic(t('shell.couldNotReorderWorkbenchesSettingsChangedElsewhere'))
      } else {
        setStateDiagnostic(undefined)
      }
    } finally {
      setWorkbenchReordering(false)
    }
  }, [isBrowserSurface, workbenchDirectory, workbenchReordering])
  const openTemplateDialog = useCallback((targetWorkbenchId?: string, returnFocus?: HTMLElement) => {
    const snapshot = workbenchDirectory.getSnapshot()
    const workbenchId = targetWorkbenchId ?? snapshot.activeWorkbenchId
    const target = snapshot.rows.find(row => row.workbenchId === workbenchId)
    templateReturnFocusRef.current = returnFocus
    setTemplateTargetWorkbenchId(workbenchId)
    setTemplateName(target === undefined ? '' : t('layout.templateName', { name: target.name }))
    setTemplateError(undefined)
    setTemplateDialogOpen(true)
  }, [workbenchDirectory])
  const closeTemplateDialog = useCallback(() => {
    if (templateSaving) return
    setTemplateDialogOpen(false)
    setTemplateTargetWorkbenchId(undefined)
    setTemplateError(undefined)
    requestAnimationFrame(() => {
      templateReturnFocusRef.current?.focus()
      templateReturnFocusRef.current = undefined
    })
  }, [templateSaving])
  const saveWorkbenchTemplate = useCallback(async () => {
    if (templateSaving) return
    const name = templateName.trim()
    if (name.length === 0) {
      setTemplateError(t('shell.enterALayoutName'))
      return
    }
    const snapshot = workbenchDirectory.getSnapshot()
    const targetWorkbenchId = templateTargetWorkbenchId ?? snapshot.activeWorkbenchId
    const target = snapshot.rows.find(row => row.workbenchId === targetWorkbenchId)
    if (targetWorkbenchId === undefined || target === undefined) {
      setTemplateError(t('shell.theDestinationWorkbenchIsUnavailableReopenThe'))
      return
    }
    if (isBrowserOwnedWorkbench(targetWorkbenchId)) {
      setTemplateError(t('shell.takeBackControlInDshFirst'))
      return
    }
    const duplicate = snapshot.templates.some(
      template => comparableWorkbenchName(template.name) === comparableWorkbenchName(name),
    )
    if (duplicate) {
      setTemplateError(t('shell.aLayoutNamedValue1AlreadyExistsChoose', { value1: name }))
      return
    }
    setTemplateSaving(true)
    setTemplateError(undefined)
    try {
      let document: WorkbenchLayoutDocument
      if (targetWorkbenchId === snapshot.activeWorkbenchId) {
        if (!await flushCurrentWorkbench()) return false
        const afterFlush = workbenchDirectory.getSnapshot()
        if (afterFlush.activeWorkbenchId === targetWorkbenchId) {
          document = documentRef.current
        } else {
          const persisted = workbenchDirectory.getDocument?.(targetWorkbenchId)
          if (persisted === undefined) {
            setTemplateError(t('shell.theDestinationLayoutIsTemporarilyUnavailableReopen'))
            return
          }
          document = projectDocumentV3ToLayoutV2(persisted, workbenchDirectory.getAreaProjects?.(targetWorkbenchId))
        }
      } else {
        const persisted = workbenchDirectory.getDocument?.(targetWorkbenchId)
        if (persisted === undefined) {
          setTemplateError(t('shell.theDestinationLayoutIsUnavailableReopenThe'))
          return
        }
        document = projectDocumentV3ToLayoutV2(persisted, workbenchDirectory.getAreaProjects?.(targetWorkbenchId))
      }
      const latest = workbenchDirectory.getSnapshot()
      if (!latest.rows.some(row => row.workbenchId === targetWorkbenchId)) {
        setTemplateError(t('shell.theDestinationWorkbenchIsNoLongerAvailable'))
        return
      }
      if (isBrowserOwnedWorkbench(targetWorkbenchId)) {
        setTemplateError(t('shell.takeBackControlInDshFirst'))
        return
      }
      const result = await workbenchDirectory.saveTemplate(name, document)
      if (result.status !== 'committed') {
        setTemplateError(result.status === 'rejected' && result.reason === 'duplicate-name'
          ? t('shell.aLayoutNamedValue1AlreadyExistsChoose', { value1: name })
          : t('shell.couldNotSaveTheLayoutSettingsChanged'))
        return
      }
      setTemplateDialogOpen(false)
      setTemplateTargetWorkbenchId(undefined)
      setStateDiagnostic(t('shell.savedValue1AsTheLayoutValue2', { value1: target.name, value2: name }))
      requestAnimationFrame(() => {
        templateReturnFocusRef.current?.focus()
        templateReturnFocusRef.current = undefined
      })
    } finally {
      setTemplateSaving(false)
    }
  }, [flushCurrentWorkbench, isBrowserOwnedWorkbench, templateName, templateSaving, templateTargetWorkbenchId, workbenchDirectory])
  const startWorkbenchRename = useCallback((workbenchId: string, name: string) => {
    setRenamingWorkbenchId(workbenchId)
    setWorkbenchNameDraft(name)
    setWorkbenchNameError(undefined)
  }, [])
  const cancelWorkbenchRename = useCallback(() => {
    setRenamingWorkbenchId(undefined)
    setWorkbenchNameError(undefined)
  }, [])
  const commitWorkbenchRename = useCallback(async () => {
    const workbenchId = renamingWorkbenchId
    if (workbenchId === undefined || workbenchRenaming) return
    const name = workbenchNameDraft.trim()
    if (name.length === 0) {
      setWorkbenchNameError(t('shell.enterAWorkbenchName'))
      setStateDiagnostic(t('shell.enterAWorkbenchName'))
      return
    }
    const duplicate = workbenchDirectory.getSnapshot().rows.some(row => row.workbenchId !== workbenchId
      && comparableWorkbenchName(row.name) === comparableWorkbenchName(name))
    if (duplicate) {
      setWorkbenchNameError(t('shell.aWorkbenchNamedValue1AlreadyExists', { value1: name }))
      setStateDiagnostic(t('shell.aWorkbenchNamedValue1AlreadyExists', { value1: name }))
      return
    }
    setWorkbenchRenaming(true)
    setWorkbenchNameError(undefined)
    try {
      if (workbenchId === workbenchDirectory.getSnapshot().activeWorkbenchId
        && !await flushCurrentWorkbench()) return
      if (collaborationControlled && props.collaborationClient !== undefined
        && (surfaceContext.kind === 'browser-owner' || surfaceContext.kind === 'lan-participant')
        && surfaceContext.workbenchId === workbenchId) {
        const command = await props.collaborationClient.command({
          kind: 'workbench.command', operation: 'workbench.rename',
          payload: { name },
        }, collaborationSnapshot?.workbenchRevision)
        if (!command.ok) {
          const message = command.message || 'Unable to rename the Workbench while collaboration state is changing.'
          setWorkbenchNameError(message)
          setStateDiagnostic(message)
          return
        }
      } else {
        const result = await workbenchDirectory.rename(workbenchId, name)
        if (result.status !== 'committed') {
          const message = result.status === 'rejected' && result.reason === 'duplicate-name'
            ? t('shell.aWorkbenchNamedValue1AlreadyExists', { value1: name })
            : result.status === 'conflict'
              ? t('shell.anotherOperationUpdatedTheWorkbenchRenameIt')
              : t('shell.couldNotRenameTheWorkbenchFolderIs')
          setWorkbenchNameError(message)
          setStateDiagnostic(message)
          return
        }
      }
      setRenamingWorkbenchId(undefined)
      setStateDiagnostic(undefined)
    } catch (error) {
      const message = t('shell.couldNotRenameValue1', { value1: error instanceof Error ? error.message : String(error) })
      setWorkbenchNameError(message)
      setStateDiagnostic(message)
    } finally {
      setWorkbenchRenaming(false)
    }
  }, [collaborationControlled, collaborationSnapshot?.workbenchRevision, flushCurrentWorkbench, props.collaborationClient, renamingWorkbenchId, surfaceContext.kind, workbenchDirectory, workbenchNameDraft, workbenchRenaming])
  const unloadWorkbench = useCallback(async (targetWorkbenchId?: string) => {
    if (workbenchClosing) return
    const snapshot = workbenchDirectory.getSnapshot()
    const workbenchId = targetWorkbenchId ?? snapshot.activeWorkbenchId
    const target = snapshot.rows.find(row => row.workbenchId === workbenchId)
    if (workbenchId === undefined || target === undefined) return
    setWorkbenchClosing(true)
    try {
      const result = await (workbenchDirectory.unload?.(workbenchId) ?? workbenchDirectory.close(workbenchId))
      if (result.status !== 'committed') {
        setStateDiagnostic(t('shell.couldNotUnloadValue1SettingsChangedElsewhere', { value1: target.name }))
        return
      }
      if (snapshot.activeWorkbenchId === workbenchId) navigationReservationsRef.current.clear()
      setStateDiagnostic(undefined)
    } finally {
      setWorkbenchClosing(false)
    }
  }, [workbenchClosing, workbenchDirectory])
  const prepareWorkbenchWindow = useCallback(async (targetWorkbenchId?: string) => {
    const workbenchId = targetWorkbenchId ?? workbenchDirectory.getSnapshot().activeWorkbenchId
    if (!workbenchWindowSnapshot.supported) {
      setStateDiagnostic(t('shell.theDshBrowserWindowServiceIsUnavailable'))
      return false
    }
    if (workbenchId === undefined) {
      setStateDiagnostic(t('shell.noWorkbenchAvailableToOpen'))
      return false
    }
    try {
      if (workbenchId === workbenchDirectory.getSnapshot().activeWorkbenchId && !await flushCurrentWorkbench()) return false
      const prepared = await windowController.prepare?.(workbenchId)
      if (prepared !== true) throw new Error('browser-link-prepare-failed')
      setStateDiagnostic(undefined)
      return true
    } catch {
      setStateDiagnostic(t('shell.couldNotPrepareTheBrowserPageThe'))
      return false
    }
  }, [flushCurrentWorkbench, windowController, workbenchDirectory, workbenchWindowSnapshot.supported])
  const openWorkbenchWindow = useCallback(async (targetWorkbenchId?: string, reservedPopup?: Window | null) => {
    const workbenchId = targetWorkbenchId ?? workbenchDirectory.getSnapshot().activeWorkbenchId
    if (workbenchId === undefined) return
    try {
      const result = await windowController.open(workbenchId, reservedPopup)
      if (result.status === 'requested') setStateDiagnostic(undefined)
      else if (result.status === 'unsupported') setStateDiagnostic(t('shell.theDshBrowserWindowServiceIsUnavailable'))
      else if (result.status === 'opened') setStateDiagnostic(t('shell.workbenchOpenedInANewWindow'))
      else setStateDiagnostic(t('shell.couldNotOpenTheWorkbenchPageValue1', { value1: result.code }))
    } catch {
      setStateDiagnostic(t('shell.couldNotOpenTheWorkbenchPageThe'))
    }
  }, [windowController, workbenchDirectory])
  const reclaimWorkbenchWindow = useCallback(async (workbenchId: string, options?: { force?: boolean }) => {
    if (isBrowserSurface === true) {
      if (workbenchId !== surfaceWorkbenchId || props.requestBrowserReclaim === undefined) {
        setStateDiagnostic(t('shell.couldNotConfirmControlOfThisBrowser'))
        return
      }
      setReclaimingBrowserWorkbench(true)
      try {
        const accepted = await props.requestBrowserReclaim(workbenchId)
        if (accepted) {
          setBrowserHandoff({ workbenchId, status: 'reclaiming' })
          setStateDiagnostic(undefined)
        } else {
          setStateDiagnostic(t('shell.theRequestDidNotReachDshThe'))
        }
      } catch {
        setStateDiagnostic(t('shell.theRequestDidNotReachDshThe'))
      } finally {
        setReclaimingBrowserWorkbench(false)
      }
      return
    }
    const snapshot = windowController.getSnapshot()
    const request = snapshot.requests?.find(row => row.workbenchId === workbenchId)
      ?? (snapshot.request?.workbenchId === workbenchId ? snapshot.request : undefined)
    if (request?.status !== 'ready' && request?.status !== 'reclaiming' && request?.status !== 'failed') return false
    setReclaimingBrowserWorkbench(true)
    try {
      const result = await windowController.reclaim?.(workbenchId, options)
      if (result?.status !== 'reclaimed') { setStateDiagnostic(t('shell.controlTransferIsIncompleteValue1CheckThe', { value1: result?.code ?? t('shell.connectionUnavailable') })); return false }
      setStateDiagnostic(undefined)
      return true
    } catch {
      setStateDiagnostic(t('shell.theTransferIsStillPendingTheBrowser'))
      return false
    } finally { setReclaimingBrowserWorkbench(false) }
  }, [isBrowserSurface, surfaceWorkbenchId, props.requestBrowserReclaim, shareController, workbenchShareSnapshot.sessions, windowController])
  const reportBrowserActionTransition = useCallback((workbenchId: string, phase: 'preparing' | 'opening' | 'reclaiming' | 'idle') => {
    setBrowserActionTransition(current => {
      if (phase === 'idle') return current?.workbenchId === workbenchId ? undefined : current
      return { workbenchId, phase }
    })
  }, [])
  useEffect(() => {
    const workbenchId = surfaceWorkbenchId ?? workbenchDirectorySnapshot.activeWorkbenchId
    const request = workbenchWindowSnapshot.requests?.find(row => row.workbenchId === workbenchId)
      ?? (workbenchWindowSnapshot.request?.workbenchId === workbenchId ? workbenchWindowSnapshot.request : undefined)
    if (request === undefined) {
      setBrowserHandoff(undefined)
      return
    }
    if (request.status === 'requested' || request.status === 'ready' || request.status === 'reclaiming'
      || request.status === 'reclaimed' || request.status === 'closed'
      || request.status === 'failed' || request.status === 'expired') {
      setBrowserHandoff({ workbenchId: request.workbenchId, status: request.status,
        ...(request.code === undefined ? {} : { code: request.code }) })
    }
    setStateDiagnostic(undefined)
  }, [workbenchWindowSnapshot.requests, workbenchWindowSnapshot.request, workbenchDirectorySnapshot.activeWorkbenchId, surfaceWorkbenchId])
  useEffect(() => {
    if (isBrowserSurface !== true || surfaceWorkbenchId === undefined) return
    const onReclaim = (event: Event) => {
      const state = (event as CustomEvent<{ state?: unknown }>).detail?.state
      if (state === 'requested') setBrowserHandoff({ workbenchId: surfaceWorkbenchId!, status: 'reclaiming' })
      else if (state === 'reclaimed') setBrowserHandoff({ workbenchId: surfaceWorkbenchId!, status: 'reclaimed' })
    }
    window.addEventListener('workbench-browser-reclaim', onReclaim)
    return () => window.removeEventListener('workbench-browser-reclaim', onReclaim)
  }, [isBrowserSurface, surfaceWorkbenchId])
  const onWorkbenchTabKeyDown = useCallback((
    event: KeyboardEvent<HTMLButtonElement>, workbenchId: string, workbenchName: string,
  ) => {
    if (event.key === 'F2') {
      if (frameTransition !== undefined) return
      event.preventDefault()
      event.stopPropagation()
      startWorkbenchRename(workbenchId, workbenchName)
      return
    }
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    const currentSnapshot = workbenchDirectory.getSnapshot()
    const rows = (currentSnapshot.openWorkbenchIds ?? currentSnapshot.rows.map(row => row.workbenchId))
      .map(id => currentSnapshot.rows.find(row => row.workbenchId === id))
      .filter((row): row is NonNullable<typeof row> => row !== undefined)
    const currentIndex = rows.findIndex(row => row.workbenchId === workbenchId)
    if (currentIndex < 0 || rows.length === 0) return
    event.preventDefault()
    event.stopPropagation()
    const nextIndex = event.key === 'Home' ? 0
      : event.key === 'End' ? rows.length - 1
        : event.key === 'ArrowLeft' ? (currentIndex - 1 + rows.length) % rows.length
          : (currentIndex + 1) % rows.length
    const next = rows[nextIndex]
    if (next !== undefined) void selectWorkbench(next.workbenchId)
  }, [frameTransition, selectWorkbench, startWorkbenchRename, workbenchDirectory])
  const saveLabel = saveState === 'saved' ? t('shell.layoutSaved')
    : saveState === 'saving' ? t('shell.savingLayout')
      : saveState === 'offline' ? t('shell.layoutNotSaved') : t('shell.layoutHasConflicts')
  const handoffWorkbenchId = surfaceWorkbenchId ?? displayedWorkbenchId
  const browserHandoffRequest = workbenchWindowSnapshot.requests?.find(
    row => row.workbenchId === handoffWorkbenchId,
  ) ?? (browserHandoff?.workbenchId === handoffWorkbenchId ? browserHandoff : undefined)
  const activeBrowserOwned = isBrowserSurface !== true
    && (browserHandoffRequest?.status === 'ready' || browserHandoffRequest?.status === 'reclaiming'
      || (browserHandoffRequest?.status === 'failed' && (browserHandoffRequest.code === 'browser-view-heartbeat-timeout' || browserHandoffRequest.code === 'browser-view-reclaim-timeout')))
  const reclaimWindowId = browserHandoffRequest && 'windowId' in browserHandoffRequest ? browserHandoffRequest.windowId : undefined
  const reclaimProgress = browserHandoffRequest && 'reclaimProgress' in browserHandoffRequest ? browserHandoffRequest.reclaimProgress : undefined
  useEffect(() => {
    if (isBrowserSurface || browserHandoffRequest?.status !== 'reclaimed' || !reclaimWindowId || reclaimProgress?.phase !== 'checking' || surfaceView !== 'workbench') return
    const { workbenchId } = browserHandoffRequest
    const windowId = reclaimWindowId
    let finished = false
    const finish = (error?: string) => {
      if (finished) return
      finished = true
      windowController.desktopRestored?.(workbenchId, windowId, error)
    }
    const inspect = () => {
      const canvas = resizeCanvasRef.current
      if (!canvas || frameTransition || !canvas.querySelector('[data-workbench-group]')) return
      const inputReady = (root: HTMLElement, sessionId: string) => {
        const bound = [...root.querySelectorAll<HTMLElement>('[data-workbench-session-id]')].find(element => element.dataset.workbenchSessionId === sessionId && element.dataset.workbenchConversationReady === 'true')
        const input = bound?.querySelector<HTMLElement>('[contenteditable="true"], textarea:not(:disabled)')
        return !!input && input.getAttribute('aria-disabled') !== 'true'
      }
      const areas = [...canvas.querySelectorAll<HTMLElement>('[data-workbench-group]:not([data-area-collapsed="true"])')]
      const waiting = areas.some(area => {
        const group = groupsOf(documentRef.current.root).find(group => group.id === area.dataset.workbenchGroup)
        const current = group && activeTab(group)
        if (!current || !['workbench.conversation', 'workbench.conversation.start'].includes(current.editorId) || !current.binding) return false
        return !inputReady(area, current.binding.sessionId)
      })
      const floatingWaiting = [...canvas.querySelectorAll<HTMLElement>('[data-workbench-floating-visible="true"]')].some(element => {
        const sessionId = element.dataset.workbenchFloatingSession
        return sessionId && ['workbench.conversation', 'workbench.conversation.start'].includes(element.dataset.workbenchFloatingEditor ?? '') && !inputReady(element, sessionId)
      })
      if (!waiting && !floatingWaiting) finish()
    }
    const observer = new MutationObserver(inspect)
    if (resizeCanvasRef.current) observer.observe(resizeCanvasRef.current, { subtree: true, childList: true, attributes: true, attributeFilter: ['contenteditable', 'disabled', 'aria-disabled', 'data-workbench-session-id', 'data-workbench-conversation-ready', 'data-workbench-floating-visible', 'data-workbench-floating-session'] })
    const frame = requestAnimationFrame(inspect)
    const timeout = setTimeout(() => finish(t('shell.controlIsBackReconnectAnyConversationsThat')), 12_000)
    return () => { observer.disconnect(); cancelAnimationFrame(frame); clearTimeout(timeout) }
  }, [browserHandoffRequest?.status, reclaimWindowId, reclaimProgress?.phase, frameTransition, surfaceView, isBrowserSurface, windowController])
  const browserOpening = isBrowserSurface !== true
    && ['preparing', 'prepared', 'requested', 'redeemed'].includes(browserHandoffRequest?.status ?? '')
  const browserActionPhase = browserActionTransition?.workbenchId === handoffWorkbenchId
    ? browserActionTransition?.phase : undefined
  const browserRuntimeMetrics = browserHandoffRequest !== undefined && 'runtimeMetrics' in browserHandoffRequest
    ? browserHandoffRequest.runtimeMetrics : undefined
  const browserWorkbenchMetrics = browserHandoffRequest === undefined ? undefined
    : workbenchShareSnapshot.sessions.find(session => session.workbenchId === browserHandoffRequest.workbenchId)?.workbenchMetrics ?? browserRuntimeMetrics
  const browserShareActive = surfaceWorkbenchId !== undefined && (
    workbenchShareSnapshot.links[surfaceWorkbenchId] !== undefined
      || workbenchShareSnapshot.sessions.some(session => session.workbenchId === surfaceWorkbenchId)
  )
  const layoutActionsEnabled = canEditLayout && frameTransition === undefined
    && !browserOpening
    && browserActionPhase === undefined
    && !browserOwnedWorkbench
    && !(isBrowserSurface === true && browserHandoffRequest?.status === 'reclaiming')
  const resizeEnabled = layoutActionsEnabled && !layoutLocked
  const browserHandoffLabel = browserHandoffRequest?.status === 'closed'
    ? t('shell.theBrowserClosedAndControlReturnedTo')
    : browserHandoffRequest?.status === 'reclaimed'
      ? t('shell.theDshClientIsBackInControl')
    : browserHandoffRequest?.status === 'ready'
      ? t('shell.theWorkbenchIsConnectedAndOpenIn')
      : browserHandoffRequest?.status === 'reclaiming'
        ? t('shell.waitingForTheBrowserToConfirmThe')
      : browserHandoffRequest?.status === 'requested'
        ? t('shell.openingThisWorkbenchInTheBrowser')
        : browserHandoffRequest?.status === 'failed'
          ? browserHandoffRequest.code === 'browser-view-heartbeat-timeout'
            ? t('shell.theBrowserDisconnectedTakeBackControlTo')
            : t('shell.theBrowserIsDisconnectedContinueInThe')
        : browserHandoffRequest?.status === 'expired'
          ? t('shell.thisBrowserLinkExpiredOpenTheWorkbench')
          : undefined
  const embeddedShell = embeddedDesktop || isBrowserSurface === true

  return (
    <div
      className={css.frame}
      style={{
        gridTemplateColumns: embeddedShell ? 'minmax(0, 1fr)' : `${sidebarWidth}px minmax(0, 1fr)`,
        '--workbench-area-header-size': `${AREA_HEADER_SIZE}px`,
      } as CSSProperties}
      data-workbench
      data-workbench-surface={surfaceContext.kind}
      data-sidebar-collapsed={sidebarCollapsed || undefined}
      onContextMenuCapture={splitPlacement === undefined ? undefined : (event) => {
        event.preventDefault()
        event.stopPropagation()
        setSplitPlacement(undefined)
      }}
    >
      {!embeddedShell ? <aside className={css.shellSidebar} data-workbench-shell-sidebar>
        {props.renderSidebar({
          collapsed: sidebarCollapsed,
          width: sidebarWidth,
          toggleSidebar,
          useSessions,
          useWorkspaces,
          useSessionStatus: props.useSessionStatus,
          useSessionRetainInfo: props.useSessionRetainInfo,
          useSessionAccess: props.useSessionAccess,
          useWorkspaceAccess: props.useWorkspaceAccess,
          usePanelInfo: props.usePanelInfo,
          useRemoteAccess: props.useRemoteAccess,
          useContextMenu: props.useContextMenu,
          useResource: props.useResource,
          routing: sidebarRouting,
          hostActions: sidebarHostActions,
        })}
      </aside> : null}
      <main className={css.workspaceShell} data-workbench-workspace data-workbench-browser-view={isBrowserSurface || undefined}>
        {isBrowserSurface !== true && workbenchDirectory.pickParentDirectory ? <WorkbenchImportDirectoryRequests pickParentDirectory={workbenchDirectory.pickParentDirectory} /> : null}
        {selectedWorkbenchId && !activeBrowserOwned ? <WorkbenchCollaborationApprovals workbenchId={selectedWorkbenchId} /> : null}

        {isBrowserSurface === true ? (
          <header className={`${css.workspaceBar} ${css.browserWorkspaceBar}`} data-workbench-browser-toolbar>
            <div className={css.browserWorkspaceIdentity}>
              <span className={css.browserWorkspaceKicker}>{t('shell.workbench')}</span>
              <strong>{browserWorkbenchName ?? t('home.currentWorkbench')}</strong>
              {surfaceWorkbenchId !== undefined && workbenchDirectory.getRootPath?.(surfaceWorkbenchId) !== undefined
                ? <WorkbenchBrowserFolderButton key={surfaceWorkbenchId} rootPath={workbenchDirectory.getRootPath(surfaceWorkbenchId)!} /> : null}
              {browserHandoffLabel === undefined ? null : <span className={css.browserWorkspaceStatus} role="status" aria-live="polite">{browserHandoffLabel}</span>}
              <CollaborationParticipantNotice className={css.browserWorkspaceStatus} snapshot={collaborationSnapshot} currentParticipantId={props.collaborationClient?.participantId} />
              {collaborationStatus === undefined ? null : <span className={css.browserWorkspaceStatus} role="status" aria-live="polite" data-workbench-collaboration-state={collaborationState}>{collaborationStatus}</span>}
            </div>
            <div className={`${css.workspaceActions} ${css.browserWorkspaceActions}`} data-workbench-layout-actions>
              <span
                className={css.visuallyHidden}
                aria-live="polite"
                aria-atomic="true"
                data-state={saveState}
              >{saveLabel}</span>
              {props.floatingRuntime && selectedWorkbenchId ? <FloatingWorkspaceToolbarButton runtime={props.floatingRuntime} workbenchId={selectedWorkbenchId} canvasRef={resizeCanvasRef} className={css.browserWorkspaceIconButton} disabled={browserOpening} /> : null}
              {workbenchDirectory.setLayoutLocked === undefined ? null : <button
                type="button"
                className={css.browserWorkspaceIconButton}
                onClick={toggleLayoutLocked}
              disabled={surfaceView === 'home' || !(settingsWritable || ownerCollaborationWritable) || layoutLockPending || browserHandoffRequest?.status === 'reclaiming'
                || frameTransition !== undefined}
                aria-label={layoutLocked ? t('shell.unlockLayoutSizing') : t('shell.lockLayoutSizing')}
                title={layoutLocked ? t('shell.layoutSizingIsLockedClickToUnlock') : t('shell.lockLayoutSizingToPreventDraggingDividers')}
                aria-pressed={layoutLocked}
                data-workbench-layout-lock={layoutLocked ? 'locked' : 'unlocked'}
              ><WorkbenchLayoutLockIcon locked={layoutLocked} /></button>}
              {props.collaborationClient !== undefined ? <button
                type="button"
                className={css.browserWorkspaceIconButton}
                disabled={props.collaborationClient.participantId !== 'owner' || browserHandoffRequest?.status === 'reclaiming'}
                onClick={() => { void props.collaborationClient?.command({ kind: 'canvas.set-focus-lock', locked: !collaborationSnapshot?.sharedCanvas.fixedByOwner }).catch(() => {}) }}
                aria-label={collaborationSnapshot?.sharedCanvas.fixedByOwner ? t('shell.unlockSharedFocus') : t('shell.lockSharedFocus')}
                title={collaborationSnapshot?.sharedCanvas.fixedByOwner ? t('shell.theOwnerLockedSharedFocusClickTo') : t('shell.lockTheCurrentSharedFocus')}
                aria-pressed={collaborationSnapshot?.sharedCanvas.fixedByOwner === true}
                data-workbench-focus-lock={collaborationSnapshot?.sharedCanvas.fixedByOwner ? 'locked' : 'unlocked'}
              ><IconPinOutlineMedium size={17} /></button> : null}
              <div className={css.browserWorkspaceActionGroup} role="group" aria-label={t('shell.layoutHistoryActions')}>
                <button
                  type="button"
                  className={css.browserWorkspaceIconButton}
                  onClick={undoLayout}
                  disabled={surfaceView === 'home' || past.length === 0}
                  aria-label={t('shell.undoLastChange')}
                  title={t('shell.undoLastChange')}
                ><UndoLayoutIcon /></button>
                <button
                  type="button"
                  className={css.browserWorkspaceIconButton}
                  onClick={redoLayout}
                  disabled={surfaceView === 'home' || future.length === 0}
                  aria-label={t('shell.redoLayoutChange')}
                  title={t('shell.redoLayoutChange')}
                ><RedoLayoutIcon /></button>
              </div>
              <span className={css.browserWorkspaceActionDivider} role="separator" aria-orientation="vertical" />
              <div className={css.browserWorkspaceActionGroup} role="group" aria-label={t('shell.workbenchActions')}>
                <button
                  type="button"
                  className={css.browserWorkspaceIconButton}
                  onClick={() => { void saveCurrentWorkbench() }}
                  disabled={!settingsWritable || saveState === 'saving'}
                  aria-label={t('shell.saveWorkbench')}
                  title={saveState === 'saving' ? t('shell.savingWorkbench') : t('shell.saveWorkbench')}
                  data-state={saveState}
                ><SaveLayoutIcon /></button>
                {desktopControls === undefined ? null : <button
                  type="button"
                  className={css.browserWorkspaceIconButton}
                  onClick={() => desktopControls.openSettings()}
                  aria-label={t('home.workbenchSettings')}
                  title={t('home.workbenchSettings')}
                ><IconSettingsOutlineMedium size={17} /></button>}
              </div>
              <span className={css.browserWorkspaceActionDivider} role="separator" aria-orientation="vertical" />
              {props.shareController !== undefined && surfaceWorkbenchId !== undefined ? <>
                <div className={css.browserWorkspaceActionGroup} role="group" aria-label={t('shell.workbenchSharingOnLocalNetwork')}>
                  <button
                    type="button"
                    className={css.browserWorkspaceIconButton}
                    disabled={shareBusy}
                    aria-label={browserShareActive ? t('shell.copyLocalNetworkShareLink') : t('shell.startLocalNetworkSharing')}
                    title={shareNotice ?? (browserShareActive ? t('shell.copyLocalNetworkShareLink') : t('shell.startLocalNetworkSharing'))}
                    onClick={() => {
                      setShareBusy(true); setShareNotice(undefined)
                      void props.shareController!.start(surfaceWorkbenchId!).then(async result => {
                        await navigator.clipboard?.writeText(result.url)
                        setShareNotice(t('shell.linkCopiedGuestsCanParticipateWithinThe'))
                      }).catch(error => setShareNotice(error instanceof Error ? error.message : t('shell.couldNotStartSharing'))).finally(() => setShareBusy(false))
                    }}
                  >{browserShareActive ? <IconCopyOutlineMedium size={17} /> : <IconShareOutlineMedium size={17} />}</button>
                  {!browserShareActive ? null : <button
                    type="button"
                    className={css.browserWorkspaceIconButton}
                    disabled={shareBusy}
                    aria-label={t('shell.stopLocalNetworkSharing')}
                    title={t('shell.stopLocalNetworkSharing')}
                    onClick={() => {
                      setShareBusy(true); setShareNotice(undefined)
                      void props.shareController!.stop(surfaceWorkbenchId!).then(() => setShareNotice(t('shell.localNetworkSharingStopped'))).catch(error => setShareNotice(error instanceof Error ? error.message : t('shell.couldNotStopSharing'))).finally(() => setShareBusy(false))
                    }}
                  ><IconCloseOutlineMedium size={17} /></button>}
                  {workbenchShareSnapshot.sessions.filter(session => session.workbenchId === surfaceWorkbenchId).map(session => <WorkbenchShareGrantControls key={session.workbenchId} controller={props.shareController!} session={session} presentation="toolbar" buttonClassName={css.browserWorkspaceIconButton} />)}
                </div>
                <span className={css.browserWorkspaceActionDivider} role="separator" aria-orientation="vertical" />
              </> : null}
              <button
                type="button"
                className={`${css.browserWorkspaceIconButton} ${css.browserWorkspaceReclaim}`}
                onClick={() => { if (handoffWorkbenchId !== undefined) void reclaimWorkbenchWindow(handoffWorkbenchId) }}
                disabled={handoffWorkbenchId === undefined || reclaimingBrowserWorkbench || (isBrowserSurface === true
                  ? props.requestBrowserReclaim === undefined || browserHandoff?.status === 'reclaiming' || browserHandoff?.status === 'reclaimed'
                  : browserHandoffRequest?.status !== 'ready' && browserHandoffRequest?.status !== 'reclaiming')}
                aria-label={t('shell.takeBackControlInDsh')}
                title={reclaimingBrowserWorkbench ? t('shell.takingBackControlInDsh') : t('shell.takeBackControlInDsh')}
                aria-busy={reclaimingBrowserWorkbench}
                data-state={reclaimingBrowserWorkbench ? 'reclaiming' : undefined}
              ><ReturnToDesktopIcon /></button>
            </div>
          </header>
        ) : <header className={css.workspaceBar}>
          {projectNeutral ? (
            <div className={css.workbenchRail}>
              <div className={css.workbenchTabs} role="tablist" aria-label={t('shell.workbenchOverview')}>
                <div className={css.workbenchTab} data-active={surfaceView === 'home' || undefined} role="presentation">
                <button
                  type="button"
                  className={css.workbenchTabTrigger}
                  role={props.workbenchDirectory === undefined ? undefined : 'tab'}
                  aria-selected={surfaceView === 'home'}
                  tabIndex={surfaceView === 'home' ? 0 : -1}
                  data-workbench-home-entry
                  onClick={() => { void flushCurrentWorkbench().then(ok => { if (ok) props.onShowHome?.() }) }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      void flushCurrentWorkbench().then(ok => { if (ok) props.onShowHome?.() })
                    }
                  }}
                >{t('shell.workbenchOverview')}</button>
                </div>
              </div>
              <div className={css.workbenchTabs} role="tablist" aria-label={t('shell.workbench')} data-workbench-tabs>
                {openWorkbenchRows.map((row) => {
                  const displayed = row.workbenchId === displayedWorkbenchId
                  const active = surfaceView === 'workbench' && displayed
                  const renaming = row.workbenchId === renamingWorkbenchId
                  const browserOwned = isBrowserOwnedWorkbench(row.workbenchId)
                  const canReadTargetDocument = displayed || workbenchDirectory.getDocument !== undefined
                  return (
                    <div
                      key={row.workbenchId}
                      className={css.workbenchTab}
                      data-active={active || undefined}
                      data-dragging={draggedWorkbenchId === row.workbenchId || undefined}
                      data-drag-over={dragOverWorkbenchId === row.workbenchId && draggedWorkbenchId !== row.workbenchId || undefined}
                      data-workbench-tab={row.workbenchId}
                      role="presentation"
                      draggable={false}
                      onDragStart={(event) => {
                        if (renaming || workbenchDirectory.reorder === undefined
                          || (event.target instanceof Element && event.target.closest('[data-workbench-menu-trigger]') !== null)) {
                          event.preventDefault()
                          return
                        }
                        suppressWorkbenchClickRef.current = true
                        setWorkbenchMenuOpenId(undefined)
                        setWorkbenchMenuPosition(undefined)
                        workbenchMenuAnchorRef.current = undefined
                        event.dataTransfer.effectAllowed = 'move'
                        event.dataTransfer.setData('text/plain', row.workbenchId)
                        setDraggedWorkbenchId(row.workbenchId)
                        setDragOverWorkbenchId(undefined)
                      }}
                      onDragOver={(event) => {
                        if (draggedWorkbenchId === undefined || draggedWorkbenchId === row.workbenchId
                          || workbenchDirectory.reorder === undefined) return
                        event.preventDefault()
                        event.dataTransfer.dropEffect = 'move'
                        setDragOverWorkbenchId(row.workbenchId)
                      }}
                      onDrop={(event) => {
                        event.preventDefault()
                        const sourceId = draggedWorkbenchId
                        const targetIndex = openWorkbenchRows.findIndex(item => item.workbenchId === row.workbenchId)
                        setDraggedWorkbenchId(undefined)
                        setDragOverWorkbenchId(undefined)
                        if (sourceId === undefined || targetIndex < 0 || sourceId === row.workbenchId) return
                        void reorderWorkbench(sourceId, targetIndex)
                      }}
                      onDragEnd={() => {
                        setDraggedWorkbenchId(undefined)
                        setDragOverWorkbenchId(undefined)
                        window.setTimeout(() => { suppressWorkbenchClickRef.current = false }, 0)
                      }}
                    >
                      {renaming ? (
                        <input
                          className={css.workbenchNameInput}
                          aria-label={t('shell.workbenchName')}
                          aria-invalid={workbenchNameError === undefined ? undefined : true}
                          title={workbenchNameError}
                          value={workbenchNameDraft}
                          disabled={workbenchRenaming}
                          autoFocus
                          onFocus={(event) => { event.currentTarget.select() }}
                          onChange={(event) => {
                            setWorkbenchNameDraft(event.currentTarget.value)
                            setWorkbenchNameError(undefined)
                            setStateDiagnostic(undefined)
                          }}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                              event.preventDefault()
                              event.stopPropagation()
                              void commitWorkbenchRename()
                            } else if (event.key === 'Escape') {
                              event.preventDefault()
                              event.stopPropagation()
                              cancelWorkbenchRename()
                            }
                          }}
                        />
                      ) : (
                        <button
                          type="button"
                          className={css.workbenchTabTrigger}
                          role="tab"
                          aria-selected={active}
                          tabIndex={active ? 0 : -1}
                          title={row.name}
                          onClick={() => {
                            if (suppressWorkbenchClickRef.current) return
                            void selectWorkbench(row.workbenchId)
                          }}
                          onKeyDown={(event) => { onWorkbenchTabKeyDown(event, row.workbenchId, row.name) }}
                        >
                          <span className={css.workbenchTabLabel}>{row.name}</span>
                          <FloatingWorkspaceUnread workbenchId={row.workbenchId} />
                        </button>
                      )}
                      <span className={css.workbenchTabActions} role="group" aria-label={t('shell.actionsForValue1', { value1: row.name })}>
                        <button
                          type="button"
                          className={css.workbenchMenuTrigger}
                          data-workbench-menu-trigger
                          aria-label={t('shell.openWorkbenchMenuForValue1', { value1: row.name })}
                          title={t('shell.openWorkbenchMenuForValue1', { value1: row.name })}
                          aria-haspopup="menu"
                          aria-expanded={workbenchMenuOpenId === row.workbenchId}
                          onKeyDown={(event) => {
                            if (event.key !== 'ArrowDown') return
                            event.preventDefault()
                            if (workbenchMenuOpenId === row.workbenchId) {
                              workbenchMenuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus()
                              return
                            }
                            workbenchMenuAnchorRef.current = event.currentTarget
                            setWorkbenchMenuPosition(undefined)
                            setWorkbenchMenuOpenId(row.workbenchId)
                            requestAnimationFrame(() => {
                              workbenchMenuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus()
                            })
                          }}
                          onClick={(event) => {
                            event.stopPropagation()
                            if (workbenchMenuOpenId === row.workbenchId) {
                              setWorkbenchMenuOpenId(undefined)
                              setWorkbenchMenuPosition(undefined)
                              workbenchMenuAnchorRef.current = undefined
                              return
                            }
                            workbenchMenuAnchorRef.current = event.currentTarget
                            setWorkbenchMenuPosition(undefined)
                            setWorkbenchMenuOpenId(row.workbenchId)
                          }}
                        ><IconEllipsisOutlineMedium size={16} /></button>
                        {workbenchMenuOpenId === row.workbenchId && typeof document !== 'undefined' ? (
                          createPortal(<div
                            ref={workbenchMenuRef}
                            className={css.workbenchTabMenu}
                            style={workbenchMenuPosition === undefined
                              ? { visibility: 'hidden', left: 0, top: 0 }
                              : { top: workbenchMenuPosition.top, left: workbenchMenuPosition.left }}
                            role="menu"
                            aria-label={t('shell.workbenchActionsForValue1', { value1: row.name })}
                            data-workbench-tab-menu={row.workbenchId}
                            onClick={event => { event.stopPropagation() }}
                            onKeyDown={event => {
                              if (event.key !== 'Escape') return
                              event.preventDefault()
                              workbenchMenuAnchorRef.current?.focus()
                              setWorkbenchMenuOpenId(undefined)
                              setWorkbenchMenuPosition(undefined)
                              workbenchMenuAnchorRef.current = undefined
                            }}
                          >
                            <button
                              type="button"
                              role="menuitem"
                              disabled={browserOwned || frameTransition !== undefined || workbenchRenaming}
                              onClick={() => {
                                setWorkbenchMenuOpenId(undefined)
                                setWorkbenchMenuPosition(undefined)
                                workbenchMenuAnchorRef.current = undefined
                                startWorkbenchRename(row.workbenchId, row.name)
                              }}
                            ><IconEditOutlineMedium size={16} /><span>{t('shell.rename')}</span></button>
                            <button
                              type="button"
                              role="menuitem"
                              disabled={browserOwned || frameTransition !== undefined || workbenchRenaming || workbenchDirectory.getWorkbenchContext === undefined}
                              onClick={() => {
                                const returnFocus = workbenchMenuAnchorRef.current
                                setWorkbenchMenuOpenId(undefined)
                                setWorkbenchMenuPosition(undefined)
                                workbenchMenuAnchorRef.current = undefined
                                setContextDialog({ workbenchId: row.workbenchId })
                                void returnFocus
                              }}
                            ><IconListPenOutlineMedium size={16} /><span>{t('shell.editWorkbenchContext')}</span></button>
                            {workbenchDirectory.memoryRequest ? <button type="button" role="menuitem" disabled={browserOwned} onClick={() => {
                              setWorkbenchMenuOpenId(undefined); setWorkbenchMenuPosition(undefined); setMemoryWorkbenchId(row.workbenchId)
                            }}><IconDatabaseOutlineMedium size={16} /><span>{t('shell.workbenchMemory')}</span></button> : null}
                            <button
                              type="button"
                              role="menuitem"
                              disabled={!canReadTargetDocument || browserOwned || frameTransition !== undefined || templateSaving}
                              title={browserOwned
                                ? t('shell.takeBackControlInDshBeforeEditing')
                                : canReadTargetDocument ? undefined : t('shell.thisLayoutIsUnavailableRefreshAndTry')}
                              onClick={() => {
                                const returnFocus = workbenchMenuAnchorRef.current
                                setWorkbenchMenuOpenId(undefined)
                                setWorkbenchMenuPosition(undefined)
                                workbenchMenuAnchorRef.current = undefined
                                if (canReadTargetDocument) openTemplateDialog(row.workbenchId, returnFocus)
                              }}
                            ><IconCopyOutlineMedium size={16} /><span>{t('shell.saveAsLayoutTemplate')}</span></button>
                            {desktopControls ? <button type="button" role="menuitem" disabled={browserOwned} onClick={() => {
                              setWorkbenchMenuOpenId(undefined); setWorkbenchMenuPosition(undefined)
                              desktopControls.openSettings({ section: 'sharing', workbenchId: row.workbenchId, shareMode: 'export' })
                            }}><IconCopyOutlineMedium size={16} /><span>{t('shell.shareWorkbench')}</span></button> : null}
                            {props.toolGateway === undefined ? null : <button type="button" role="menuitem" disabled={browserOwned} onClick={() => {
                              toolGatewayReturnFocusRef.current = workbenchMenuAnchorRef.current ?? null
                              setWorkbenchMenuOpenId(undefined); setWorkbenchMenuPosition(undefined)
                              workbenchMenuAnchorRef.current = undefined
                              setToolGatewayOpenId(row.workbenchId)
                            }}><IconSettingsOutlineMedium size={16} /><span>{t('shell.agentAssembly')}</span></button>}
                            <WorkbenchBrowserAction
                              workbenchId={row.workbenchId}
                              workbenchName={row.name}
                              windowSnapshot={workbenchWindowSnapshot}
                              onPrepareOpen={prepareWorkbenchWindow}
                              onOpenWindow={openWorkbenchWindow}
                              onReclaim={async id => { if (!await reclaimWorkbenchWindow(id)) throw new Error(t('shell.transferIsNotCompleteCheckProgressOn')) }}
                              onTransition={(workbenchId, phase) => {
                                setWorkbenchMenuOpenId(undefined)
                                setWorkbenchMenuPosition(undefined)
                                workbenchMenuAnchorRef.current = undefined
                                reportBrowserActionTransition(workbenchId, phase)
                              }}
                              className={css.workbenchTabMenuItem}
                              showLabel
                            />
                            <button
                              type="button"
                              role="menuitem"
                              data-action="close"
                              disabled={browserOwned || frameTransition !== undefined || workbenchClosing}
                              title={browserOwned ? t('shell.takeBackControlInDshBeforeEditing') : undefined}
                              onClick={() => {
                                setWorkbenchMenuOpenId(undefined)
                                setWorkbenchMenuPosition(undefined)
                                workbenchMenuAnchorRef.current = undefined
                                void unloadWorkbench(row.workbenchId)
                              }}
                            ><IconCloseOutlineMedium size={16} /><span>{t('shell.unloadFromTabBar')}</span></button>
                          </div>, document.body)
                        ) : null}
                      </span>
                    </div>
                  )
                })}
              </div>
              <div className={css.createWorkbenchControl}>
                <WorkbenchCreateMenu onImport={props.onImportWorkbench}
                  onSelect={presetId => { void flushCurrentWorkbench().then(ok => { if (ok) setCreatePreset(presetId) }) }}
                  anchor={menuProps => <button ref={createWorkbenchButtonRef} type="button" className={css.createWorkbenchButton}
                    disabled={frameTransition !== undefined} aria-label={t('shell.newWorkbench')} title={t('shell.newWorkbench')} {...menuProps}>+</button>} />
              </div>
            </div>
          ) : (
            <div className={css.workspaceIdentity}>
              <span>{t('shell.workspace')}</span>
              <strong>{workspaceTitle}</strong>
              {sessionTitle === undefined ? null : <small>{sessionTitle}</small>}
            </div>
          )}
          {browserHandoffLabel === undefined ? null : <div
            className={css.browserHandoffStatus}
            data-workbench-browser-handoff={browserHandoffRequest?.status}
            role="status"
            aria-live="polite"
          >{browserHandoffLabel}</div>}
          <CollaborationParticipantNotice className={css.browserHandoffStatus} snapshot={collaborationSnapshot} currentParticipantId={props.collaborationClient?.participantId} />
          <div className={css.workspaceActions} data-workbench-layout-actions>
            <span
              className={css.visuallyHidden}
              aria-live="polite"
              aria-atomic="true"
              data-state={saveState}
            >{saveLabel}</span>
            {workbenchDirectory.setLayoutLocked === undefined ? null : <button
              type="button"
              onClick={toggleLayoutLocked}
              disabled={surfaceView === 'home' || !settingsWritable || layoutLockPending || activeBrowserOwned || browserOpening
                || browserActionPhase !== undefined || frameTransition !== undefined}
              aria-label={layoutLocked ? t('shell.unlockLayoutSizing') : t('shell.lockLayoutSizing')}
              title={layoutLocked ? t('shell.layoutSizingIsLockedClickToUnlock') : t('shell.lockLayoutSizingToPreventDraggingDividers')}
              aria-pressed={layoutLocked}
              data-workbench-layout-lock={layoutLocked ? 'locked' : 'unlocked'}
            ><WorkbenchLayoutLockIcon locked={layoutLocked} /></button>}
            <button
              type="button"
              onClick={undoLayout}
              disabled={surfaceView === 'home' || activeBrowserOwned || past.length === 0}
              aria-label={t('shell.undoLayoutChange')}
              title={t('shell.undoLayoutChange')}
            ><UndoLayoutIcon /></button>
            <button
              type="button"
              onClick={redoLayout}
              disabled={surfaceView === 'home' || activeBrowserOwned || future.length === 0}
              aria-label={t('shell.redoLayoutChange2')}
              title={t('shell.redoLayoutChange2')}
            ><RedoLayoutIcon /></button>
            {!projectNeutral && embeddedDesktop && desktopControls !== undefined ? <button
              type="button"
              className={css.desktopControl}
              onClick={() => desktopControls.openSettings()}
              aria-label={t('home.workbenchSettings')}
              title={t('home.workbenchSettings')}
            >{t('shell.settings')}</button> : null}
            {props.floatingRuntime && selectedWorkbenchId && surfaceView === 'workbench' ? <FloatingWorkspaceToolbarButton runtime={props.floatingRuntime} workbenchId={selectedWorkbenchId} canvasRef={resizeCanvasRef} className={css.workbenchSettingsButton} disabled={activeBrowserOwned} /> : null}
            {projectNeutral && desktopControls !== undefined ? <button
              type="button"
              className={css.workbenchSettingsButton}
              onClick={() => desktopControls.openSettings()}
              aria-label={t('home.workbenchSettings')}
              title={t('home.workbenchSettings')}
            ><IconSettingsOutlineMedium size={16} /></button> : null}
          </div>
        </header>}
        {frameTransition !== undefined || browserOpening || (browserActionPhase !== undefined && browserActionPhase !== 'reclaiming')
          || (isBrowserSurface === true && browserHandoffRequest?.status === 'reclaiming') ? (
          <div className={css.transitionWait} role="status" aria-live="polite" aria-busy="true" data-workbench-transition-wait>
            <section className={css.transitionWaitPanel}>
              <span className={css.transitionWaitSpinner} aria-hidden="true" />
              <h2>{frameTransition !== undefined
                ? t('shell.loadingValue1', { value1: workbenchDirectorySnapshot.rows.find(row => row.workbenchId === frameTransition.workbenchId)?.name ?? t('shell.workbench') })
                : isBrowserSurface === true ? t('shell.takingBackControlInDsh') : browserActionPhase === 'preparing' || browserHandoffRequest?.status === 'preparing' || browserHandoffRequest?.status === 'prepared' ? t('shell.preparingBrowserWindow') : browserActionPhase === 'reclaiming' ? t('home.returningControlToTheDshClient') : t('shell.openingWorkbenchPage')}</h2>
              <p>{frameTransition !== undefined
                ? t('shell.loadingLayoutAndRestoringAreaContents')
                : isBrowserSurface === true
                  ? t('shell.thisPageIsPausedWhileTheLayout')
                  : browserActionPhase === 'preparing' || browserHandoffRequest?.status === 'preparing' || browserHandoffRequest?.status === 'prepared'
                    ? t('shell.savingTheLayoutAndRequestingAOne')
                    : browserActionPhase === 'reclaiming'
                      ? t('shell.theBrowserStaysLockedUntilTheDsh')
                      : t('shell.theBrowserIsConnectingToDshAnd')}</p>
            </section>
          </div>
        ) : null}
        <div
          ref={resizeCanvasRef}
          className={css.canvas}
          data-workbench-canvas
          data-workbench-logical-width={collaborationSnapshot?.sharedCanvas.viewport.width}
          data-workbench-logical-height={collaborationSnapshot?.sharedCanvas.viewport.height}
          data-workbench-scale-mode={collaborationSnapshot?.sharedCanvas.viewport.scaleMode}
          data-layout-locked={layoutLocked ? 'true' : undefined}
          data-session-accent-frames={props.showSessionAccentFrames === false ? 'hidden' : undefined}
          {...(frameTransition !== undefined || browserOpening || (browserActionPhase !== undefined && browserActionPhase !== 'reclaiming') ? { inert: '' } : {})}
        >
          {props.floatingRuntime && selectedWorkbenchId ? <WorkbenchFloatingWorkspace
            runtime={props.floatingRuntime} workbenchId={selectedWorkbenchId} canvasRef={resizeCanvasRef}
            visible={surfaceView === 'workbench' && !activeBrowserOwned && !browserOpening}
            editors={editors} hidden={workbenchDirectorySnapshot.globalHiddenEditorIds ?? []} extensionAccess={extensionAccess}
            editorMenu={workbenchDirectorySnapshot.editorMenu}
            frame={props} layout={layout} policy={conversationResourcePolicy} sessionMarkers={allWorkspaceSessionMarkers}
            selectedAreaBinding={activePageSessionBinding(groupsOf(layout.root).find(group => group.id === layout.activeGroupId), workspaces, projectNeutral, account)}
            commit={commit} pin={pinFloatingTab} {...(props.bayAgent === undefined ? {} : { bayAgent: props.bayAgent })} /> : null}
          {createPreset && isBrowserSurface !== true ? <WorkbenchCreateDialog directory={workbenchDirectory} presetId={createPreset} {...(props.generateContextDraft === undefined ? {} : { generateDraft: props.generateContextDraft })}
            onClose={() => { setCreatePreset(undefined); requestAnimationFrame(() => createWorkbenchButtonRef.current?.focus()) }}
            onCreated={() => { props.onShowWorkbench?.(); navigationReservationsRef.current.clear(); setStateDiagnostic(undefined) }} /> : null}
          {projectDialog ? <AreaProjectDialog directory={workbenchDirectory} {...projectDialog} onClose={() => setProjectDialog(undefined)} /> : null}
          {memoryWorkbenchId ? <WorkbenchMemoryDialog directory={workbenchDirectory} workbenchId={memoryWorkbenchId} onClose={() => setMemoryWorkbenchId(undefined)} /> : null}
          {contextDialog && workbenchDirectory.getWorkbenchContext !== undefined ? (() => {
            const areaId = contextDialog.areaId
            const context = areaId === undefined
              ? workbenchDirectory.getWorkbenchContext!(contextDialog.workbenchId)
              : workbenchDirectory.getAreaContext?.(contextDialog.workbenchId, areaId)
            return <WorkbenchContextDialog
              directory={workbenchDirectory}
              workbenchId={contextDialog.workbenchId}
              {...(areaId === undefined ? {} : { areaId })}
              title={areaId === undefined ? t('shell.editWorkbenchContext') : t('shell.editProjectContext')}
              initialValue={areaId === undefined
                ? context !== undefined && 'goal' in context.human ? context.human.goal : ''
                : context !== undefined && 'objective' in context.human ? context.human.objective : ''}
              {...(props.generateContextDraft === undefined ? {} : { generateDraft: props.generateContextDraft })}
              onClose={() => setContextDialog(undefined)}
            />
          })() : null}
          {surfaceView === 'home' ? props.renderHome : <>{activeBrowserOwned && browserHandoffRequest !== undefined ? <WorkbenchBrowserControlPage
            workbenchId={browserHandoffRequest.workbenchId}
            workbenchName={workbenchDirectorySnapshot.rows.find(row => row.workbenchId === browserHandoffRequest.workbenchId)?.name ?? browserHandoffRequest.workbenchId}
            browserStatus={browserHandoffRequest.status}
            {...(browserHandoffRequest.code === undefined ? {} : { browserCode: browserHandoffRequest.code })}
            {...(shareController === undefined ? {} : { shareController })}
            shareSnapshot={workbenchShareSnapshot}
            {...(runtimeMetrics === undefined ? {} : { runtimeMetrics: runtimeMetrics.getSnapshot() })}
            {...(browserWorkbenchMetrics === undefined ? {} : {
              workbenchMetrics: browserWorkbenchMetrics,
            })}
            {...(props.toolGateway === undefined ? {} : { toolGateway: props.toolGateway })}
            layout={layout}
            layoutLocked={layoutLocked}
            {...(desktopControls === undefined ? {} : { onOpenSettings: desktopControls.openSettings })}
            editors={editors}
            areaLabels={workbenchDirectory.getAreaLabels?.(browserHandoffRequest.workbenchId)}
            reclaimProgress={'reclaimProgress' in browserHandoffRequest ? browserHandoffRequest.reclaimProgress : undefined}
            requestReclaim={async options => (await reclaimWorkbenchWindow(browserHandoffRequest.workbenchId, options)) === true}

          /> : <Profiler id="workbench-layout" onRender={reportWorkbenchLayoutCommit}>
          <LayoutView
            directory={workbenchDirectory} bayAgentSnapshot={bayAgentSnapshot} bayAgentController={props.bayAgent}
            activeBayAgentAreaIds={activeBayAgentAreaIds}
            {...(workbenchDirectory.getAreaProjects === undefined ? {} : {
              areaProjects: workbenchDirectory.getAreaProjects(placementWorkbenchId),
              editAreaProject: (areaId: string) => setProjectDialog({ workbenchId: placementWorkbenchId, areaId }),
            })}
            onManageEditors={props.onManageEditors}
            {...(workbenchDirectory.getAreaContext === undefined ? {} : {
              editAreaBackground: (areaId: string) => { setContextDialog({ workbenchId: placementWorkbenchId, areaId }) },
            })}
            workbenchId={placementWorkbenchId}
            collaborationClient={props.collaborationClient}
            node={layout.root} document={layout} commit={commit} renderSlot={renderSlot}
            runtimeMetrics={runtimeMetrics}
            groupOrdinals={groupOrdinals}
            editorIndex={editorIndex}
            conversationStatus={props.conversationStatus}
            extensionAccess={extensionAccess}
            editors={editors} currentSession={current} account={account} workspaces={workspaces}
            hiddenEditorIds={workbenchDirectorySnapshot.globalHiddenEditorIds}
            editorMenu={workbenchDirectorySnapshot.editorMenu}
            conversationResourcePolicy={conversationResourcePolicy}
            projectNeutral={projectNeutral}
            openOfficialSession={openOfficialSession === undefined ? undefined : (areaId, sessionId, expectedClaim) => {
              const assertClaim = () => {
                const target = groupsOf(documentRef.current.root).find(group => group.id === areaId)
                const current = target === undefined ? undefined : activeTab(target)
                const claim = `workbench-area:${areaId}:${current?.id ?? 'empty'}:${current?.bindingGeneration ?? 0}`
                if (!current || current.binding?.sessionId !== sessionId || claim !== expectedClaim) throw new Error('Workbench Area claim has expired')
              }
              assertClaim()
              return openOfficialSession(sessionId, assertClaim)
            }}
            sessionRows={sessionRows} sessionMarkers={markerProjection.markers}
            sessionMarkersByWorkspace={Object.fromEntries(Object.entries(markerProjections)
              .map(([workspaceId, projection]) => [workspaceId, projection.markers]))}
            sessionIds={activeWorkspace?.sessionIds ?? []} workspaceTitle={workspaceTitle}
            archivedSessionIds={archivedSessionIds}
            openExternalSession={(target) => { dispatchNavigation({
              version: 1,
              requestId: nextId('binding-external'),
              target: target as SessionOpenCommandV1['target'],
              disposition: 'reuse',
              origin: 'module-action',
            }) }}
            updateSessionMarker={updateSessionMarker}
            placeConversation={placeConversation}
            completePreparedConversation={(areaId, input) => completePreparedConversation({ areaId, ...input })}
            bindSession={(areaId, sessionId, expectedClaim) => {
              const target = groupsOf(documentRef.current.root).find(group => group.id === areaId)
              const current = target === undefined ? undefined : activeTab(target)
              const claim = `workbench-area:${areaId}:${current?.id ?? 'empty'}:${current?.bindingGeneration ?? 0}`
              if (target === undefined || claim !== expectedClaim) return Promise.reject(new Error('Workbench Area claim has expired'))
              return bindSidebarSession({ areaId, sessionId, strategy: 'replace-focused-area' })
            }}
            splitEmpty={splitEmpty}
            reportStateFailure={setStateDiagnostic}
            splitPlacement={splitPlacement}
            requestSplitPlacement={(sourceGroupId, sourceTabId, edge) => {
              setSplitPlacement({ sourceGroupId, sourceTabId, targetGroupId: sourceGroupId, edge, ratio: 0.5 })
            }}
            updateSplitPlacement={(placement) => {
              setSplitPlacement(placement)
            }}
            confirmSplitPlacement={(placement) => {
              splitEmpty(
                placement.targetGroupId,
                placement.edge,
                placement.ratio,
              )
              setSplitPlacement(undefined)
            }}
            cancelSplitPlacement={() => { setSplitPlacement(undefined) }}
            collapsedAreaIds={collapsedAreaIds}
            summarySplitIds={collapseProjection.summarySplitIds}
            expandedAreaCount={Math.max(0, groupsOf(layout.root).length - collapsedAreaIds.size)}
            layoutLocked={layoutLocked}
            layoutActionsEnabled={layoutActionsEnabled}
            resizeEnabled={resizeEnabled}
            resizeCanvasRef={resizeCanvasRef}
            toggleAreaCollapsed={(groupId) => {
              const current = collapseProjection.collapsedAreaIds
              const wasCollapsed = current.has(groupId)
              if (wasCollapsed) {
                setCollapseRuntimeState(previous => {
                  const next = new Map(previous)
                  next.delete(groupId)
                  return next
                })
                return
              }
              if (groupsOf(layout.root).length - current.size <= 1) return
              setCollapseRuntimeState(previous => {
                const next = new Map(previous)
                next.set(groupId, { mode: 'manual-area' })
                return next
              })
            }}
          />
          </Profiler>}
          {(saveState !== 'saved' || stateDiagnostic !== undefined || invalidLayout !== undefined || sidebarDiagnostic !== undefined) && (
            <div className={css.diagnostic} role="status" data-workbench-diagnostic>
              {sidebarDiagnostic === undefined ? null : <p>{sidebarDiagnostic}</p>}
              {stateDiagnostic === undefined && invalidLayout === undefined && saveState === 'saved' ? null : (
                <p>{stateDiagnostic ?? (invalidLayout !== undefined
                  ? t('layout.unsupportedLayout')
                  : saveState === 'saving'
                    ? t('layout.savingLayout')
                    : saveState === 'offline'
                      ? t('layout.unsavedLayout')
                      : t('layout.layoutConflict'))}</p>
              )}
              {invalidLayout !== undefined && (
                <div className={css.conflictActions}>
                  <button onClick={exportInvalid}>{t('area.exportOriginalLayout')}</button>
                  <button onClick={resetInvalid}>{t('area.resetThisLayout')}</button>
                </div>
              )}
              {saveState === 'offline' && conflict === undefined && invalidLayout === undefined ? (
                <div className={css.conflictActions}>
                  <button onClick={retrySave} disabled={!settingsWritable}>{t('area.retrySave')}</button>
                  <button onClick={exportLocal}>{t('area.exportLocalLayout')}</button>
                </div>
              ) : null}
              {conflict !== undefined && (
                <div className={css.conflictActions}>
                  <button onClick={reloadRemote}>{t('area.reloadRemoteLayout')}</button>
                  <button onClick={overwriteRemote}>{t('area.overwriteRemoteLayout')}</button>
                  <button onClick={exportLocal}>{t('area.exportLocalLayout')}</button>
                </div>
              )}
            </div>
          )}</>}
        </div>
        {templateDialogOpen ? (
          <div
            className={css.templateDialogBackdrop}
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) closeTemplateDialog()
            }}
          >
            <form
              className={css.templateDialog}
              role="dialog"
              aria-modal="true"
              aria-labelledby={`${templateNameId}-title`}
              aria-describedby={`${templateNameId}-description`}
              onSubmit={(event) => {
                event.preventDefault()
                void saveWorkbenchTemplate()
              }}
              onKeyDown={(event) => {
                if (event.key !== 'Escape') return
                event.preventDefault()
                closeTemplateDialog()
              }}
            >
              <div className={css.templateDialogHeader}>
                <h2 id={`${templateNameId}-title`}>{t('area.saveAsWorkbenchLayout')}</h2>
                <button
                  type="button"
                  onClick={closeTemplateDialog}
                  disabled={templateSaving}
                  aria-label={t('action.close')}
                  title={t('action.close')}
                ><CloseWorkbenchIcon /></button>
              </div>
              <p id={`${templateNameId}-description`}>
                {t('layout.saveNamedLayout', { name: workbenchDirectorySnapshot.rows.find(row => row.workbenchId === templateTargetWorkbenchId)?.name ?? t('layout.targetWorkbench') })}
              </p>
              <label htmlFor={`${templateNameId}-input`}>{t('area.layoutName')}</label>
              <input
                id={`${templateNameId}-input`}
                value={templateName}
                autoFocus
                aria-invalid={templateError === undefined ? undefined : true}
                aria-describedby={templateError === undefined ? `${templateNameId}-description` : `${templateNameId}-error`}
                placeholder={t('area.eGTwoConversationReview')}
                onFocus={(event) => { event.currentTarget.select() }}
                onChange={(event) => {
                  setTemplateName(event.currentTarget.value)
                  setTemplateError(undefined)
                }}
              />
              {templateError === undefined ? null : (
                <p id={`${templateNameId}-error`} className={css.templateDialogError} role="alert">
                  {templateError}
                </p>
              )}
              <div className={css.templateDialogActions}>
                <button type="button" onClick={closeTemplateDialog} disabled={templateSaving}>{t('action.cancel')}</button>
                <button type="submit" disabled={templateSaving}>
                  {templateSaving ? t('shell.saving') : t('layout.saveLayout')}
                </button>
              </div>
            </form>
          </div>
        ) : null}
      </main>
      {toolGatewayOpenId !== undefined && props.toolGateway !== undefined ? (() => {
        const row = workbenchDirectorySnapshot.rows.find(item => item.workbenchId === toolGatewayOpenId)
        if (row === undefined) return null
        return <WorkbenchAgentAssemblyDialog
          gateway={props.toolGateway.forWorkbench(toolGatewayOpenId)}
          workbenchId={toolGatewayOpenId}
          workbenchName={row.name}
          editors={editors}
          returnFocusRef={toolGatewayReturnFocusRef}
          onClose={() => setToolGatewayOpenId(undefined)}
        />
      })() : null}
    </div>
  )
}

interface LayoutViewProps {
  directory?: WorkbenchDirectory | undefined
  bayAgentSnapshot?: import('./workbench-bay-agent-work.ts').BayAgentControllerSnapshotV1 | undefined
  bayAgentController?: BayAgentControllerV1 | undefined
  activeBayAgentAreaIds: ReadonlySet<string>
  areaProjects?: Readonly<Record<string, import('../workbench-directory-contract.ts').AreaProjectV1>>
  editAreaProject?: (areaId: string) => void
  onManageEditors?: (() => void) | undefined
  editAreaBackground?: (areaId: string) => void
  /** Runtime identity; never part of a persisted Area or editor state. */
  workbenchId: string
  collaborationClient?: WorkbenchCollaborationClientV1 | undefined
  runtimeMetrics?: WorkbenchRuntimeMetricsSinkV1 | undefined
  groupOrdinals: ReadonlyMap<string, number>
  editorIndex: WorkbenchEditorIndex
  conversationStatus?: ConversationTabStatusSource | undefined
  node: LayoutNode
  document: WorkbenchLayoutDocument
  commit: Commit
  renderSlot: RenderSlot
  editors: readonly import('./catalog.ts').WorkbenchEditorCatalogRow[]
  extensionAccess?: WorkbenchExtensionAccessSnapshotV1 | undefined
  hiddenEditorIds?: readonly string[] | undefined
  editorMenu?: import('./editor-menu-preferences.ts').EditorMenuPreferences | undefined
  conversationResourcePolicy?: WorkbenchConversationInteractionPolicyV1 | undefined
  currentSession: SessionId | undefined
  account: WorkspaceAccountKey
  projectNeutral: boolean
  workspaces: readonly { workspaceId: string; title?: string; path?: string; sessionIds: readonly string[] }[]
  sessionRows: Record<string, (WorkbenchTabInformationSession & { displayTitle: string; running: boolean; blank: boolean; updatedAt: number }) | undefined>
  sessionMarkers: Record<string, SessionMarkerRecord>
  sessionMarkersByWorkspace: Record<string, Record<string, SessionMarkerRecord>>
  sessionIds: readonly string[]
  workspaceTitle: string
  archivedSessionIds: readonly string[]
  openExternalSession: (target: SessionBindingV1) => void
  openOfficialSession?: ((areaId: string, sessionId: string, expectedClaim: string) => Promise<void>) | undefined
  bindSession: (areaId: string, sessionId: string, expectedClaim: string) => Promise<void>
  updateSessionMarker: (workspaceId: string | undefined, sessionId: string, marker: SessionMarkerRecord) => void
  placeConversation: (
    areaId: string,
    input: { workspaceId: string; agentPreset?: string; presentation?: 'start' | 'conversation'; startModuleInstanceId?: string },
  ) => Promise<SessionBindingV1>
  completePreparedConversation: (
    areaId: string,
    input: { moduleInstanceId: string; bindingGeneration: number; target: SessionBindingV1 },
  ) => boolean
  splitEmpty: (sourceAreaId: string, edge: Exclude<DropEdge, 'center'>, ratio?: number) => void
  reportStateFailure: (message: string | undefined) => void
  splitPlacement: SplitPlacement | undefined
  requestSplitPlacement: (
    sourceGroupId: string,
    sourceTabId: string,
    edge: Exclude<DropEdge, 'center'>,
  ) => void
  updateSplitPlacement: (placement: SplitPlacement) => void
  confirmSplitPlacement: (placement: SplitPlacement) => void
  cancelSplitPlacement: () => void
  collapsedAreaIds: ReadonlySet<string>
  summarySplitIds: ReadonlySet<string>
  expandedAreaCount: number
  layoutLocked: boolean
  layoutActionsEnabled: boolean
  resizeEnabled: boolean
  resizeCanvasRef: RefObject<HTMLDivElement>
  toggleAreaCollapsed: (groupId: string) => void
  summary?: boolean
  collapseEdgeOverride?: CollapseEdge
}

type MergeDirection = 'left' | 'right' | 'up' | 'down'
type CollapseEdge = MergeDirection
type SplitPlacement = {
  sourceGroupId: string
  sourceTabId: string
  targetGroupId: string
  edge: Exclude<DropEdge, 'center'>
  ratio: number
}
type AreaGesture =
  | {
    kind: 'split'
    edge: SplitTargetEdge
    orientation: SplitTargetOrientation
    ratio: number
    style: CSSProperties
  }
  | { kind: 'center'; style: CSSProperties }
  | { kind: 'join'; targetGroupId: string; direction: MergeDirection; style: CSSProperties }
  | { kind: 'invalid'; message: string; style: CSSProperties }

interface SiblingArea {
  split: SplitNode
  group: GroupNode
  sourceFirst: boolean
  direction: MergeDirection
}

function activeTab(group: GroupNode): TabDocument | undefined {
  return group.tabs.find(tab => tab.id === group.activeTabId) ?? group.tabs[0]
}

function parentSplit(node: LayoutNode, childId: string): SplitNode | undefined {
  if (node.kind === 'group') return undefined
  if (node.first.id === childId || node.second.id === childId) return node
  return parentSplit(node.first, childId) ?? parentSplit(node.second, childId)
}

/** Returns the edge on which an Area's collapsed rail must remain anchored. */
export function collapseEdgeForGroup(document: WorkbenchLayoutDocument, groupId: string): CollapseEdge | undefined {
  const split = parentSplit(document.root, groupId)
  if (split === undefined) return undefined
  const sourceFirst = containsLayoutNode(split.first, groupId)
  if (split.axis === 'horizontal') return sourceFirst ? 'left' : 'right'
  return sourceFirst ? 'up' : 'down'
}

function containsLayoutNode(node: LayoutNode, groupId: string): boolean {
  return node.kind === 'group'
    ? node.id === groupId
    : containsLayoutNode(node.first, groupId) || containsLayoutNode(node.second, groupId)
}

function branchFullyCollapsed(node: LayoutNode, collapsedAreaIds: ReadonlySet<string>): boolean {
  return node.kind === 'group'
    ? collapsedAreaIds.has(node.id)
    : branchFullyCollapsed(node.first, collapsedAreaIds)
      && branchFullyCollapsed(node.second, collapsedAreaIds)
}

interface SplitResizeConstraintsV1 {
  dividerSize: number
  firstMinimum: number
  secondMinimum: number
}

function splitResizeConstraints(
  split: SplitNode,
  collapsedAreaIds: ReadonlySet<string>,
): SplitResizeConstraintsV1 | undefined {
  // Fully-collapsed branches are represented by fixed compact rails. Changing
  // their parent split ratio cannot move a live divider, so preserve the ratio.
  if (branchFullyCollapsed(split.first, collapsedAreaIds)
    || branchFullyCollapsed(split.second, collapsedAreaIds)) return undefined
  const extent = (node: LayoutNode) => {
    const footprint = projectedMinimumFootprint(node, collapsedAreaIds)
    return split.axis === 'horizontal' ? footprint.width : footprint.height
  }
  return {
    dividerSize: COLLAPSED_DIVIDER_SIZE,
    firstMinimum: extent(split.first),
    secondMinimum: extent(split.second),
  }
}

/**
 * Return the compact extent a fully-collapsed branch needs along an ancestor
 * split's axis.  A nested split must contribute the sum of its rails when it
 * uses the same axis, and the largest child rail when it turns the corner.
 *
 * Keeping this projection runtime-only is important: the persisted split ratio
 * remains untouched and is restored as soon as a branch becomes usable again.
 */
export function collapsedBranchExtent(
  node: LayoutNode,
  axis: SplitNode['axis'],
  collapsedAreaIds: ReadonlySet<string>,
): number {
  if (!branchFullyCollapsed(node, collapsedAreaIds)) return 0
  const footprint = compactFootprint(node)
  return axis === 'horizontal' ? footprint.width : footprint.height
}

/** Whether a nested split can use the compact identity-summary presentation. */
export function collapsedBranchSummaryAxis(
  split: SplitNode,
  collapsedAreaIds: ReadonlySet<string>,
): SplitNode['axis'] | undefined {
  if (!branchFullyCollapsed(split.first, collapsedAreaIds)
    || !branchFullyCollapsed(split.second, collapsedAreaIds)) return undefined
  return split.axis
}

/**
 * Resolve only the runtime grid tracks for a split. Persisted ratios remain
 * authoritative and are used again as soon as both branches are expanded.
 */
export function splitGridStyle(
  split: SplitNode,
  collapsedAreaIds: ReadonlySet<string>,
): CSSProperties {
  const projection = splitGridTracks(split, collapsedAreaIds)
  return splitTrackStyle(projection.axis, projection.tracks)
}

function splitTrackStyle(axis: SplitNode['axis'], tracks: string): CSSProperties {
  // Keep the persisted projection as a static fallback, while allowing the
  // resize controller to update only the current split's custom property.
  // Updating the inline grid track declaration itself would invalidate the
  // whole React subtree on every pointer frame.
  const style: CSSProperties = {
    '--workbench-split-tracks': tracks,
    // Custom properties inherit. Give every split/summary its own invalid
    // transient value so a parent divider's temporary tracks cannot leak into
    // nested grids while the pointer is down.
    '--workbench-split-tracks-transient': 'initial',
  } as CSSProperties
  if (!supportsSplitTrackVariables()) {
    if (axis === 'horizontal') style.gridTemplateColumns = tracks
    else style.gridTemplateRows = tracks
  }
  return style
}

interface SplitResizeControllerOptions {
  root: RefObject<HTMLDivElement>
  canvas: RefObject<HTMLDivElement>
  splitId: string
  axis: SplitNode['axis']
  persistedRatio: number
  constraints: SplitResizeConstraintsV1 | undefined
  enabled: boolean
  getTracks: (ratio: number) => string
  commit: Commit
}

export interface AreaContentCommandHandlersV1 {
  commit: Commit
  openBindingPicker: () => void
  placeConversation: (input: { workspaceId: string; agentPreset?: string; presentation?: 'start' | 'conversation' }) => Promise<SessionBindingV1>
  completePreparedConversation: (input: { moduleInstanceId: string; bindingGeneration: number; target: SessionBindingV1 }) => boolean
  openSession: (sessionId: string) => Promise<void>
  openNativeTab: (kind: string, options?: Record<string, unknown>) => boolean
  openConversationResource: (address: string, placement?: Record<string, unknown>, source?: WorkbenchResourceSourceV1) => WorkbenchResourceRouteResult
  reportStateFailure: (message: string | undefined) => void
}

interface AreaContentCommandStateV1 {
  identity: AreaContentCommandIdentityV1 | undefined
  handlers: AreaContentCommandHandlersV1
}

interface AreaContentCommandFacadeV1 extends AreaContentCommandHandlersV1 {}

interface SplitResizePointerMetaV1 {
  pointerId: number
  divider: HTMLDivElement
  captured: boolean
  onResize: () => void
  onBlur: () => void
  onLostPointerCapture: EventListener
  onWindowMove: ((event: globalThis.PointerEvent) => void) | undefined
  onWindowUp: ((event: globalThis.PointerEvent) => void) | undefined
  onWindowCancel: ((event: globalThis.PointerEvent) => void) | undefined
}

function requestResizeFrame(callback: FrameRequestCallback): number {
  if (typeof globalThis.requestAnimationFrame === 'function') return globalThis.requestAnimationFrame(callback)
  return globalThis.setTimeout(() => { callback(globalThis.performance?.now?.() ?? Date.now()) }, 0) as unknown as number
}

function cancelResizeFrame(frame: number): void {
  if (typeof globalThis.cancelAnimationFrame === 'function') globalThis.cancelAnimationFrame(frame)
  else globalThis.clearTimeout(frame)
}

function supportsSplitTrackVariables(): boolean {
  return typeof globalThis.CSS !== 'undefined'
    && typeof globalThis.CSS.supports === 'function'
    && globalThis.CSS.supports(
      'grid-template-columns',
      'var(--workbench-split-tracks-transient, var(--workbench-split-tracks))',
    )
}

function writeSplitTracks(root: HTMLDivElement, axis: SplitNode['axis'], tracks: string): void {
  if (supportsSplitTrackVariables()) {
    root.style.setProperty('--workbench-split-tracks-transient', tracks)
    recordSplitResizeCssWrite()
  } else {
    if (axis === 'horizontal') root.style.gridTemplateColumns = tracks
    else root.style.gridTemplateRows = tracks
  }
}

function restoreSplitTracks(root: HTMLDivElement, axis: SplitNode['axis'], tracks: string): void {
  // Keep the local inheritance barrier in place after the drag. `initial` is
  // an invalid custom-property value, so the CSS var() falls back to the
  // committed stable tracks on this node rather than inheriting an ancestor.
  root.style.setProperty('--workbench-split-tracks-transient', 'initial')
  recordSplitResizeCssWrite()
  // React owns the stable --workbench-split-tracks value. Set it to the
  // finishing ratio before the single commit so the visual track never snaps
  // back to the previous ratio while React applies the committed document.
  if (supportsSplitTrackVariables()) {
    root.style.setProperty('--workbench-split-tracks', tracks)
    recordSplitResizeCssWrite()
  }
  else if (axis === 'horizontal') root.style.gridTemplateColumns = tracks
  else root.style.gridTemplateRows = tracks
}

function splitNodesById(node: LayoutNode, output = new Map<string, SplitNode>()): Map<string, SplitNode> {
  if (node.kind === 'group') return output
  output.set(node.id, node)
  splitNodesById(node.first, output)
  splitNodesById(node.second, output)
  return output
}

/** Keep the size of every surviving split stable when undo/redo runs under a layout lock. */
function preserveSplitRatios(
  current: WorkbenchLayoutDocument,
  target: WorkbenchLayoutDocument,
): WorkbenchLayoutDocument {
  const ratios = new Map([...splitNodesById(current.root)].map(([id, split]) => [id, split.ratio]))
  let changed = false
  const project = (node: LayoutNode): LayoutNode => {
    if (node.kind === 'group') return node
    const first = project(node.first)
    const second = project(node.second)
    const ratio = ratios.get(node.id) ?? node.ratio
    if (first === node.first && second === node.second && ratio === node.ratio) return node
    changed = true
    return { ...node, ratio, first, second }
  }
  const root = project(target.root)
  return changed ? { ...target, root } : target
}

/**
 * Owns transient divider geometry without putting pointermove state in React.
 * The controller intentionally writes one CSS variable and one ARIA
 * attribute per animation frame, then emits one layout command on release.
 */
function useSplitResizeController(options: SplitResizeControllerOptions) {
  const optionsRef = useRef(options)
  optionsRef.current = options
  const metaRef = useRef<SplitResizePointerMetaV1>()
  const controllerRef = useRef<SplitResizeControllerV1>()
  if (controllerRef.current === undefined) {
    controllerRef.current = new SplitResizeControllerV1({
      readGeometry: () => {
        const element = optionsRef.current.root.current
        if (element === null) return undefined
        const rect = element.getBoundingClientRect()
        recordSplitResizeGeometryRead()
        return { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
      },
      getTracks: (ratio) => optionsRef.current.getTracks(ratio),
      resolveRatio: (input) => {
        const current = optionsRef.current
        const constraints = current.constraints
        if (constraints === undefined) return undefined
        return splitResizeRatioForPointerV1({ ...input, ...constraints })
      },
      writeTracks: (tracks) => {
        const current = optionsRef.current
        const root = current.root.current
        if (root !== null) writeSplitTracks(root, current.axis, tracks)
      },
      restoreTracks: (tracks) => {
        const current = optionsRef.current
        const root = current.root.current
        if (root !== null) restoreSplitTracks(root, current.axis, tracks)
      },
      writeAriaValue: (value) => metaRef.current?.divider.setAttribute('aria-valuenow', String(value)),
      setActive: (active) => {
        const root = optionsRef.current.root.current
        if (root === null) return
        if (active) root.dataset.workbenchResizeActive = 'true'
        else root.removeAttribute('data-workbench-resize-active')
      },
      commit: (splitId, ratio) => {
        return optionsRef.current.commit({ type: 'set-ratio', splitId, ratio })
      },
      requestFrame: (callback) => requestResizeFrame((frameTimestamp) => {
        const shouldMeasure = isWorkbenchResizeMetricsEnabled()
        const startedAt = shouldMeasure ? globalThis.performance?.now?.() ?? Date.now() : 0
        callback()
        if (shouldMeasure) {
          recordSplitResizeFrame(frameTimestamp, (globalThis.performance?.now?.() ?? Date.now()) - startedAt)
        }
      }),
      cancelFrame: cancelResizeFrame,
    })
  }

  const hasPointer = (target: HTMLDivElement, pointerId: number): boolean => {
    try {
      return typeof target.hasPointerCapture !== 'function' || target.hasPointerCapture(pointerId)
    } catch {
      return true
    }
  }

  const end = useCallback((shouldCommit: boolean) => {
    const meta = metaRef.current
    if (meta === undefined) return
    // Finish while the divider is still attached to metaRef so the controller
    // can restore aria-valuenow on cancel or flush the final pointer position.
    // Clear ownership before releasing pointer capture: some WebViews emit
    // `lostpointercapture` synchronously from `releasePointerCapture`.
    controllerRef.current?.finish(shouldCommit)
    metaRef.current = undefined
    finishSplitResizeMeasurement(shouldCommit)
    globalThis.window?.removeEventListener('resize', meta.onResize)
    globalThis.window?.removeEventListener('blur', meta.onBlur)
    meta.divider.removeEventListener('lostpointercapture', meta.onLostPointerCapture)
    if (meta.onWindowMove !== undefined) globalThis.window?.removeEventListener('pointermove', meta.onWindowMove)
    if (meta.onWindowUp !== undefined) globalThis.window?.removeEventListener('pointerup', meta.onWindowUp)
    if (meta.onWindowCancel !== undefined) globalThis.window?.removeEventListener('pointercancel', meta.onWindowCancel)
    try {
      if (meta.divider.hasPointerCapture?.(meta.pointerId)) meta.divider.releasePointerCapture(meta.pointerId)
    } catch { /* WebView may reject a late release. */ }
  }, [])

  // A Workbench switch, browser handoff, or reclaim makes the canvas inert.
  // Cancel in the same commit so transient CSS tracks and pointer capture
  // cannot outlive the visible Workbench transition.
  useLayoutEffect(() => {
    if (!options.enabled) end(false)
  }, [end, options.enabled])

  const onPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    const current = optionsRef.current
    if (!current.enabled || current.constraints === undefined) return
    const root = current.root.current
    if (root === null) return
    const rect = root.getBoundingClientRect()
    const extent = current.axis === 'horizontal' ? rect.width : rect.height
    if (!Number.isFinite(extent) || extent <= 0) return
    end(false)
    const divider = event.currentTarget
    const pointer = current.axis === 'horizontal' ? event.clientX : event.clientY
    const controller = controllerRef.current
    if (controller === undefined) return
    const meta: SplitResizePointerMetaV1 = {
      pointerId: event.pointerId,
      divider,
      captured: false,
      onResize: () => {
        controller.invalidateGeometry()
      },
      onBlur: () => { end(false) },
      onLostPointerCapture: () => {
        if (controller.ownsPointer(event.pointerId)) end(false)
      },
      onWindowMove: undefined,
      onWindowUp: undefined,
      onWindowCancel: undefined,
    }
    metaRef.current = meta
    if (!controller.begin({
      splitId: current.splitId,
      axis: current.axis,
      persistedRatio: current.persistedRatio,
      pointerId: event.pointerId,
      pointer,
      geometry: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
    })) {
      metaRef.current = undefined
      return
    }
    // The cached pointerdown rect is part of this drag's geometry-read count.
    // Initialize the run after validating the geometry, then seed that read.
    beginSplitResizeMeasurement(current.splitId, 1)
    try {
      if (typeof divider.setPointerCapture === 'function') {
        divider.setPointerCapture(event.pointerId)
        meta.captured = typeof divider.hasPointerCapture === 'function'
          ? divider.hasPointerCapture(event.pointerId)
          : true
      }
    } catch { /* Use window-level pointer listeners in embedded WebViews without capture. */ }
    divider.addEventListener('lostpointercapture', meta.onLostPointerCapture)
    if (!meta.captured) {
      meta.onWindowMove = pointerEvent => {
        if (pointerEvent.pointerId !== meta.pointerId) return
        recordSplitResizePointerMove()
        controller.move(pointerEvent.pointerId, current.axis === 'horizontal' ? pointerEvent.clientX : pointerEvent.clientY)
      }
      meta.onWindowUp = pointerEvent => {
        if (pointerEvent.pointerId !== meta.pointerId) return
        controller.move(pointerEvent.pointerId, current.axis === 'horizontal' ? pointerEvent.clientX : pointerEvent.clientY)
        end(true)
      }
      meta.onWindowCancel = pointerEvent => {
        if (pointerEvent.pointerId === meta.pointerId) end(false)
      }
      globalThis.window?.addEventListener('pointermove', meta.onWindowMove, { passive: true })
      globalThis.window?.addEventListener('pointerup', meta.onWindowUp)
      globalThis.window?.addEventListener('pointercancel', meta.onWindowCancel)
    }
    globalThis.window?.addEventListener('resize', meta.onResize, { passive: true })
    globalThis.window?.addEventListener('blur', meta.onBlur)
    event.preventDefault()
  }, [end])

  const onPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const controller = controllerRef.current
    if (controller === undefined || !controller.ownsPointer(event.pointerId)
      || metaRef.current?.captured !== true) return
    if (!hasPointer(event.currentTarget, event.pointerId)) {
      end(false)
      return
    }
    const current = optionsRef.current
    recordSplitResizePointerMove()
    controller.move(event.pointerId, current.axis === 'horizontal' ? event.clientX : event.clientY)
  }, [end])

  const onPointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const controller = controllerRef.current
    if (controller === undefined || !controller.ownsPointer(event.pointerId)
      || metaRef.current?.captured !== true) return
    if (!hasPointer(event.currentTarget, event.pointerId)) {
      end(false)
      return
    }
    const current = optionsRef.current
    controller.move(event.pointerId, current.axis === 'horizontal' ? event.clientX : event.clientY)
    end(true)
  }, [end])

  const onPointerCancel = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!controllerRef.current?.ownsPointer(event.pointerId)) return
    end(false)
  }, [end])

  useEffect(() => () => { end(false) }, [end])

  return { onPointerDown, onPointerMove, onPointerUp, onPointerCancel }
}

function siblingArea(document: WorkbenchLayoutDocument, groupId: string): SiblingArea | undefined {
  const split = parentSplit(document.root, groupId)
  if (split === undefined) return undefined
  const sourceFirst = split.first.id === groupId
  const sibling = sourceFirst ? split.second : split.first
  if (sibling.kind !== 'group') return undefined
  const direction: MergeDirection = split.axis === 'horizontal'
    ? sourceFirst ? 'right' : 'left'
    : sourceFirst ? 'down' : 'up'
  return { split, group: sibling, sourceFirst, direction }
}

function mergeDirectionBetween(source: DOMRect, target: DOMRect): MergeDirection {
  const sourceCenter = { x: source.left + source.width / 2, y: source.top + source.height / 2 }
  const targetCenter = { x: target.left + target.width / 2, y: target.top + target.height / 2 }
  const delta = { x: targetCenter.x - sourceCenter.x, y: targetCenter.y - sourceCenter.y }
  if (Math.abs(delta.x) >= Math.abs(delta.y)) return delta.x < 0 ? 'left' : 'right'
  return delta.y < 0 ? 'up' : 'down'
}

export function splitPreviewStyle(edge: Exclude<DropEdge, 'center'>, ratio: number): CSSProperties {
  const percent = (value: number) => `${String(Number((value * 100).toFixed(4)))}%`
  if (edge === 'left') return { inset: `0 ${percent(1 - ratio)} 0 0` }
  // For right/bottom, the requested ratio belongs to the inserted second track.
  if (edge === 'right') return { inset: `0 0 0 ${percent(1 - ratio)}` }
  if (edge === 'top') return { inset: `0 0 ${percent(1 - ratio)} 0` }
  return { inset: `${percent(1 - ratio)} 0 0 0` }
}

export function splitRetainedPreviewStyle(
  edge: Exclude<DropEdge, 'center'>,
  ratio: number,
): CSSProperties {
  const percent = (value: number) => `${String(Number((value * 100).toFixed(4)))}%`
  if (edge === 'left') return { inset: `0 0 0 ${percent(ratio)}` }
  if (edge === 'right') return { inset: `0 ${percent(ratio)} 0 0` }
  if (edge === 'top') return { inset: `${percent(ratio)} 0 0 0` }
  return { inset: `0 0 ${percent(ratio)} 0` }
}

function splitCursorMode(target: SplitTarget): 'columns' | 'rows' | 'center' | 'invalid' {
  if (target.kind === 'edge') return target.orientation
  return target.kind
}

function SplitRegionPreview({
  edge, style, source, region,
}: {
  edge: Exclude<DropEdge, 'center'>
  style: CSSProperties
  source: 'gesture' | 'placement'
  region?: 'retained' | 'new'
}) {
  const direction = edge === 'left' || edge === 'right' ? 'vertical' : 'horizontal'
  const { t } = useWorkbenchLocale()
  const message = region === 'retained' ? t('layout.originalArea') : t(`layout.split.${edge}`)
  return (
    <div
      className={css.splitRegionPreview}
      style={style}
      data-workbench-split-preview
      data-workbench-gesture-preview={source === 'gesture' ? 'split' : undefined}
      data-split-placement-preview={source === 'placement' && region === 'new' ? true : undefined}
      data-split-placement-region={source === 'placement' ? region : undefined}
      data-split-edge={edge}
      data-split-orientation={edge === 'left' || edge === 'right' ? 'columns' : 'rows'}
    >
      <div className={css.splitPlacementBadge} data-split-placement-badge>
        <span
          className={css.splitPlacementIcon}
          data-split-direction-icon={direction}
          aria-hidden="true"
        />
        <strong>{message}</strong>
      </div>
    </div>
  )
}

function CenterRegionPreview() {
  const { t } = useWorkbenchLocale()
  return (
    <div
      className={css.centerRegionPreview}
      data-workbench-gesture-preview="center"
      data-split-target="center"
    >
      <div className={css.splitPlacementBadge}>
        <span className={css.centerPlacementIcon} aria-hidden="true" />
        <strong>{t('area.moveToAnEdgeToChooseA')}</strong>
      </div>
    </div>
  )
}

function JoinRegionPreview({
  direction, style,
}: {
  direction: MergeDirection
  style: CSSProperties
}) {
  const { t } = useWorkbenchLocale()
  const arrow = direction === 'left' ? '←'
    : direction === 'right' ? '→'
      : direction === 'up' ? '↑' : '↓'
  return (
    <div
      className={css.joinRegionPreview}
      style={style}
      data-workbench-join-preview
      data-workbench-gesture-preview="join"
      data-workbench-area-merge-preview="target"
    >
      <div className={css.splitPlacementBadge} data-merge-placement-badge>
        <span
          className={css.mergePlacementIcon}
          data-merge-direction-icon={direction}
          aria-hidden="true"
        >{arrow}</span>
        <strong>{t(`layout.merge.${direction}`)}</strong>
      </div>
    </div>
  )
}

function fixedPreviewStyle(rect: DOMRect): CSSProperties {
  return {
    position: 'fixed', inset: 'auto', left: rect.left, top: rect.top,
    width: rect.width, height: rect.height,
  }
}

function LayoutView(props: LayoutViewProps) {
  const { t } = useWorkbenchLocale()
  if (props.node.kind === 'group' && !props.node.id) return <section className={css.empty} aria-label={t('area.noAreasInThisWorkbench')}><strong>{t('area.startWithAProject')}</strong><span>{t('area.projectFilesAndHistoryAreKeptChoose')}</span>
    {Object.values(props.directory?.getProjects?.(props.workbenchId) ?? {}).map(project => <button key={project.projectId} disabled={!props.layoutActionsEnabled} onClick={() => { void props.directory?.openProject?.(props.workbenchId, project.projectId).catch(error => props.reportStateFailure(String(error))) }}>{project.name} {t('area.openInANewArea')}</button>)}
    <button disabled={!props.layoutActionsEnabled} onClick={() => { const id = nextId('area'); props.commit({ type: 'replace-layout', document: { version: 2, root: { kind: 'group', id, tabs: [] }, activeGroupId: id } }) }}>{t('area.newArea')}</button>
  </section>

  return props.node.kind === 'group'
    ? <AreaView {...props} group={props.node} />
    : <SplitView {...props} split={props.node} />
}

function CollapsedSummaryNode({
  props, node, parentAxis, collapseEdge,
}: {
  props: LayoutViewProps
  node: LayoutNode
  parentAxis: SplitNode['axis']
  collapseEdge: CollapseEdge
}) {
  if (node.kind === 'group') {
    return <AreaView {...props} node={node} group={node} summary collapseEdgeOverride={collapseEdge} />
  }
  return <CollapsedSummarySplit
    props={props} split={node} parentAxis={parentAxis} collapseEdge={collapseEdge}
  />
}

/**
 * A fully-collapsed split keeps its saved ratio unchanged. Its summary divider
 * is informational because changing it cannot meaningfully resize live Areas.
 */
function CollapsedSummarySplit({
  props, split, parentAxis, collapseEdge,
}: {
  props: LayoutViewProps
  split: SplitNode
  parentAxis: SplitNode['axis']
  collapseEdge: CollapseEdge
}) {
  const { t } = useWorkbenchLocale()
  const summaryTracks = summaryGridTracks(split, parentAxis)
  const ratio = normalizedSplitRatio(split.ratio)
  // The parent split already owns the compact/main-axis track. A summary node
  // must fill that grid cell on the cross-axis; applying compactFootprint here
  // again leaves the turned child pinned to one corner of a much larger cell.
  return (
    <div
      className={css.collapsedBranchSummary}
      data-collapse-summary
      data-workbench-split-id={split.id}
      data-axis={split.axis}
      aria-label={t('area.collapsedAreaGroup')}
      style={{
        width: '100%',
        height: '100%',
        ...splitTrackStyle(summaryTracks.axis, summaryTracks.tracks),
      }}
    >
      <CollapsedSummaryNode
        props={props} node={split.first} parentAxis={split.axis} collapseEdge={collapseEdge}
      />
      <div
        className={css.collapsedSummaryDivider}
        role="separator"
        tabIndex={-1}
        aria-label={t('area.collapsedGroupDivider')}
        aria-orientation={split.axis === 'horizontal' ? 'vertical' : 'horizontal'}
        aria-disabled="true"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(ratio * 100)}
        data-collapsed-summary-divider
      />
      <CollapsedSummaryNode
        props={props} node={split.second} parentAxis={split.axis} collapseEdge={collapseEdge}
      />
    </div>
  )
}

function CollapsedBranchSummary({
  props, split, parentAxis, collapseEdge,
}: {
  props: LayoutViewProps
  split: SplitNode
  parentAxis: SplitNode['axis']
  collapseEdge: CollapseEdge
}) {
  return <CollapsedSummaryNode
    props={props} node={split} parentAxis={parentAxis} collapseEdge={collapseEdge}
  />
}

function normalizedSplitRatio(value: number): number {
  if (!Number.isFinite(value)) return 0.5
  return Math.min(1, Math.max(0, value))
}

function splitCanFit(container: number, minimum: number): boolean {
  return Number.isFinite(container) && container >= minimum * 2 + SPLIT_DIVIDER_SIZE
}

function SplitView(props: LayoutViewProps & { split: SplitNode }) {
  const { t } = useWorkbenchLocale()
  const { split, commit, collapsedAreaIds, summarySplitIds } = props
  const root = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [menu, setMenu] = useState<{
    x: number
    y: number
    targetGroupId: string
    columnEdge: 'left' | 'right'
    rowEdge: 'top' | 'bottom'
  }>()
  useEffect(() => {
    if (menu === undefined) return
    const close = () => { setMenu(undefined) }
    const closeOnOutsideEvent = (event: Event) => {
      if (event.target instanceof Node && !menuRef.current?.contains(event.target)) close()
    }
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') close()
    }
    globalThis.document.addEventListener('pointerdown', closeOnOutsideEvent, true)
    globalThis.document.addEventListener('contextmenu', closeOnOutsideEvent, true)
    globalThis.window.addEventListener('keydown', closeOnEscape)
    globalThis.window.addEventListener('blur', close)
    return () => {
      globalThis.document.removeEventListener('pointerdown', closeOnOutsideEvent, true)
      globalThis.document.removeEventListener('contextmenu', closeOnOutsideEvent, true)
      globalThis.window.removeEventListener('keydown', closeOnEscape)
      globalThis.window.removeEventListener('blur', close)
    }
  }, [menu])
  const resizeConstraints = splitResizeConstraints(split, collapsedAreaIds)
  const canResize = props.resizeEnabled && resizeConstraints !== undefined
  const resize = useSplitResizeController({
    root,
    canvas: props.resizeCanvasRef,
    splitId: split.id,
    axis: split.axis,
    persistedRatio: split.ratio,
    constraints: resizeConstraints,
    enabled: canResize,
    getTracks: (ratio) => splitGridTracks({ ...split, ratio }, collapsedAreaIds).tracks,
    commit,
  })
  const ratio = normalizedSplitRatio(split.ratio)
  const style = splitGridStyle({ ...split, ratio }, collapsedAreaIds)
  const openSeparatorMenu = (
    divider: HTMLDivElement,
    x: number,
    y: number,
    keyboardSide?: 'first' | 'second',
  ) => {
    const dividerRect = divider.getBoundingClientRect()
    const firstSide = keyboardSide === undefined
      ? split.axis === 'horizontal'
        ? x < dividerRect.left + dividerRect.width / 2
        : y < dividerRect.top + dividerRect.height / 2
      : keyboardSide === 'first'
    const branch = firstSide ? split.first : split.second
    const branchGroups = groupsOf(branch)
    const branchIds = new Set(branchGroups.map(group => group.id))
    const sampleX = split.axis === 'horizontal'
      ? firstSide ? dividerRect.left - 1 : dividerRect.right + 1
      : x
    const sampleY = split.axis === 'vertical'
      ? firstSide ? dividerRect.top - 1 : dividerRect.bottom + 1
      : y
    const pointedArea = [...(root.current?.querySelectorAll<HTMLElement>('[data-workbench-group]') ?? [])]
      .filter(element => branchIds.has(element.dataset.workbenchGroup ?? ''))
      .find((element) => {
        const rect = element.getBoundingClientRect()
        return rect.width > 0 && rect.height > 0
          && sampleX >= rect.left && sampleX <= rect.right
          && sampleY >= rect.top && sampleY <= rect.bottom
      })
    const targetGroupId = pointedArea?.dataset.workbenchGroup ?? branchGroups[0]?.id
    if (targetGroupId === undefined) return
    const pointedRect = pointedArea?.getBoundingClientRect()
    const columnEdge: 'left' | 'right' = split.axis === 'horizontal'
      ? firstSide ? 'right' : 'left'
      : pointedRect !== undefined && pointedRect.width > 0
        ? x < pointedRect.left + pointedRect.width / 2 ? 'left' : 'right'
        : 'right'
    const rowEdge: 'top' | 'bottom' = split.axis === 'vertical'
      ? firstSide ? 'bottom' : 'top'
      : pointedRect !== undefined && pointedRect.height > 0
        ? y < pointedRect.top + pointedRect.height / 2 ? 'top' : 'bottom'
        : 'bottom'
    setMenu({ x, y, targetGroupId, columnEdge, rowEdge })
  }
  const keyStep = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const delta = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -0.05
      : event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 0.05 : 0
    if (delta !== 0) {
      event.preventDefault()
      if (!canResize) return
      commit({ type: 'set-ratio', splitId: split.id, ratio: split.ratio + delta })
      return
    }
    if (((event.shiftKey && event.key === 'F10') || event.key === 'ContextMenu') && props.layoutActionsEnabled) {
      event.preventDefault()
      const rect = event.currentTarget.getBoundingClientRect()
      openSeparatorMenu(
        event.currentTarget,
        rect.left + rect.width / 2,
        rect.top + rect.height / 2,
        'first',
      )
    }
  }
  const targetGroup = menu === undefined
    ? undefined
    : groupsOf(props.document.root).find(group => group.id === menu.targetGroupId)
  const targetTab = targetGroup === undefined ? undefined : activeTab(targetGroup)
  const renderBranch = (node: LayoutNode, first: boolean) => {
    if (node.kind === 'split' && summarySplitIds.has(node.id)) {
      const collapseEdge: CollapseEdge = split.axis === 'horizontal'
        ? first ? 'left' : 'right'
        : first ? 'up' : 'down'
      return <CollapsedBranchSummary
        props={props} split={node} parentAxis={split.axis} collapseEdge={collapseEdge}
      />
    }
    return <LayoutView {...props} node={node} />
  }
  return (
    <div ref={root} className={css.split} data-workbench-split-id={split.id} data-axis={split.axis} data-collapse-active={
      summarySplitIds.has(split.first.id) || summarySplitIds.has(split.second.id) || undefined
    } style={style}>
      {renderBranch(split.first, true)}
      <div
        className={css.divider} role="separator" tabIndex={canResize || (props.layoutLocked && props.layoutActionsEnabled) ? 0 : -1}
        data-resize-disabled={!canResize || undefined}
        data-layout-locked={props.layoutLocked ? 'true' : undefined}
        aria-label={t('area.areaDivider')}
        aria-orientation={split.axis === 'horizontal' ? 'vertical' : 'horizontal'}
        aria-disabled={canResize ? undefined : true}
        aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(ratio * 100)}
        onKeyDown={keyStep}
        onPointerDown={resize.onPointerDown}
        onPointerMove={resize.onPointerMove}
        onPointerUp={resize.onPointerUp}
        onPointerCancel={resize.onPointerCancel}
        onDoubleClick={() => {
          if (canResize) commit({ type: 'set-ratio', splitId: split.id, ratio: 0.5 })
        }}
        onContextMenu={(event) => {
          event.preventDefault()
          if (!props.layoutActionsEnabled || (!canResize && !props.layoutLocked)) return
          openSeparatorMenu(event.currentTarget, event.clientX, event.clientY)
        }}
      >
        <span
          className={css.dividerHitTarget}
          data-divider-hit-target={props.layoutLocked ? 'disabled' : 'active'}
          aria-hidden="true"
        />
      </div>
      {renderBranch(split.second, false)}
      {menu === undefined ? null : (
        <SeparatorMenu
          menuRef={menuRef}
          split={split} document={props.document} x={menu.x} y={menu.y}
          targetGroupId={menu.targetGroupId}
          targetAvailable={targetTab !== undefined}
          columnEdge={menu.columnEdge}
          rowEdge={menu.rowEdge}
          layoutLocked={props.layoutLocked}
          requestPlacement={(edge) => {
            if (targetTab !== undefined) {
              props.requestSplitPlacement(menu.targetGroupId, targetTab.id, edge)
            }
          }}
          commit={commit} close={() => { setMenu(undefined) }}
        />
      )}
    </div>
  )
}

function SeparatorMenu({
  menuRef, split, document, x, y, targetGroupId, targetAvailable, columnEdge, rowEdge,
  layoutLocked, requestPlacement, commit, close,
}: {
  menuRef: RefObject<HTMLDivElement>
  split: SplitNode
  document: WorkbenchLayoutDocument
  x: number
  y: number
  targetGroupId: string
  targetAvailable: boolean
  columnEdge: 'left' | 'right'
  rowEdge: 'top' | 'bottom'
  layoutLocked: boolean
  requestPlacement: (edge: Exclude<DropEdge, 'center'>) => void
  commit: Commit
  close: () => void
}) {
  const { t } = useWorkbenchLocale()
  const first = split.first.kind === 'group' ? split.first : undefined
  const second = split.second.kind === 'group' ? split.second : undefined
  const canMerge = first !== undefined && second !== undefined
    ? canMergeGroups(document, first.id, second.id)
    : false
  const run = (command: LayoutCommand) => { commit(command); close() }
  return (
    <div
      ref={menuRef}
      className={css.separatorMenu}
      data-separator-menu
      data-separator-target-group={targetGroupId}
      style={{ left: x, top: y }}
      role="menu"
      aria-label={t('area.sharedDividerMenu')}
    >
      <span className={css.menuHeading}>{t('area.sharedDivider')}</span>
      <button role="menuitem" disabled={!targetAvailable} data-primary onClick={() => {
        requestPlacement(columnEdge)
        close()
      }}>{t('area.splitHorizontal')}</button>
      <button role="menuitem" disabled={!targetAvailable} data-primary onClick={() => {
        requestPlacement(rowEdge)
        close()
      }}>{t('area.splitVertical')}</button>
      <div className={css.menuDivider} />
      <button role="menuitem" disabled={layoutLocked} title={layoutLocked ? t('layout.unlockToResize') : undefined} onClick={() => {
        run({ type: 'set-ratio', splitId: split.id, ratio: 0.5 })
      }}>{t('area.balanceBothAreas')}</button>
      {first === undefined || second === undefined ? (
        <span className={css.menuHint}>{t('area.thisDividerBordersNestedAreasYouCan')}</span>
      ) : (
        <>
          <div className={css.menuDivider} />
          <button role="menuitem" disabled={!canMerge} title={canMerge ? undefined : t('layout.cannotMergeProjects')} onClick={() => {
            run({ type: 'merge-group', sourceGroupId: first.id, targetGroupId: second.id })
          }}>{split.axis === 'horizontal' ? t('layout.merge.right') : t('layout.merge.down')}</button>
          <button role="menuitem" disabled={!canMerge} title={canMerge ? undefined : t('layout.cannotMergeProjects')} onClick={() => {
            run({ type: 'merge-group', sourceGroupId: second.id, targetGroupId: first.id })
          }}>{split.axis === 'horizontal' ? t('layout.merge.left') : t('layout.merge.up')}</button>
          <button role="menuitem" onClick={() => {
            run({ type: 'swap-groups', firstGroupId: first.id, secondGroupId: second.id })
          }}>{t('area.swapBothAreas')}</button>
        </>
      )}
      <span className={css.menuHint}>{t('area.dragTheDividerToResizeRightClick')}</span>
    </div>
  )
}

interface SessionBindingChipProps {
  binding: SessionBindingV1
  resolved: ResolvedSessionTarget
  marker: SessionMarkerRecord
  sessionRows: LayoutViewProps['sessionRows']
  sessionMarkers: Record<string, SessionMarkerRecord>
  sessionMarkersByWorkspace: LayoutViewProps['sessionMarkersByWorkspace']
  sessionIds: readonly string[]
  workspaces: LayoutViewProps['workspaces']
  workspaceTitle: string
  archivedSessionIds: readonly string[]
  updateMarker: (marker: SessionMarkerRecord) => void
  open: boolean
  setOpen: (open: boolean) => void
  onSelect: (binding: SessionBindingV1) => void
  onOpenExternal: (binding: SessionBindingV1) => void
}

interface PendingSessionBindingPickerProps {
  sessionRows: LayoutViewProps['sessionRows']
  sessionIds: readonly string[]
  sessionMarkers: Record<string, SessionMarkerRecord>
  sessionMarkersByWorkspace: LayoutViewProps['sessionMarkersByWorkspace']
  workspaces: LayoutViewProps['workspaces']
  archivedSessionIds: readonly string[]
  open: boolean
  setOpen: (open: boolean) => void
  onSelect: (binding: SessionBindingV1) => void
  triggerLabel?: string
  disabled?: boolean
  emptyMessage?: string
}

/**
 * Picker for an unbound Session editor. It deliberately has no "new
 * conversation" action: choosing a module in an unbound Area must remain a
 * pending tab until the user explicitly chooses an existing Conversation.
 */
export function PendingSessionBindingPicker({
  sessionRows, sessionIds, sessionMarkers, sessionMarkersByWorkspace, workspaces,
  archivedSessionIds, open, setOpen, onSelect, triggerLabel, disabled, emptyMessage,
}: PendingSessionBindingPickerProps) {
  const { t, language } = useWorkbenchLocale()
  const copy = sessionBindingCopy(language)
  const controlRef = useRef<HTMLDivElement>(null)
  const pickerRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const pickerId = useId()
  const [query, setQuery] = useState('')
  const [collapsedWorkspaceGroups, setCollapsedWorkspaceGroups] = useState<Set<string>>(() => new Set())
  useEffect(() => { if (!open) setQuery('') }, [open])
  const archived = new Set(archivedSessionIds)
  const workspaceOf = new Map<string, { id: string; title: string }>()
  for (const workspace of workspaces) {
    for (const sessionId of workspace.sessionIds) workspaceOf.set(sessionId, {
      id: workspace.workspaceId,
      title: workspace.title ?? workspace.workspaceId,
    })
  }
  const candidates = [...new Set([
    ...sessionIds,
    ...workspaces.flatMap(workspace => workspace.sessionIds),
  ])].filter(sessionId => {
    const row = sessionRows[sessionId]
    if (row === undefined || row.blank || archived.has(sessionId)) return false
    const normalized = query.trim().normalize('NFKC').toLocaleLowerCase('und')
    if (normalized === '') return true
    const marker = workspaceOf.get(sessionId) === undefined
      ? sessionMarkers[sessionId]
      : sessionMarkersByWorkspace[workspaceOf.get(sessionId)!.id]?.[sessionId]
    return [row.title ?? '', row.displayTitle, sessionId, marker?.label ?? '', workspaceOf.get(sessionId)?.title ?? '']
      .some(value => value.normalize('NFKC').toLocaleLowerCase('und').includes(normalized))
  }).map(sessionId => {
    const workspace = workspaceOf.get(sessionId)
    const binding: SessionBindingV1 = {
      ...(workspace === undefined ? {} : { workspaceId: workspace.id }),
      sessionId,
    }
    const marker = (workspace === undefined
      ? sessionMarkers[sessionId]
      : sessionMarkersByWorkspace[workspace.id]?.[sessionId])
      ?? allocateSessionMarker(workspace === undefined ? sessionMarkers : (sessionMarkersByWorkspace[workspace.id] ?? {}))
    return { binding, marker, workspaceTitle: workspace?.title ?? t('binding.ungrouped') }
  }).sort((left, right) =>
    (sessionRows[right.binding.sessionId]?.updatedAt ?? 0) - (sessionRows[left.binding.sessionId]?.updatedAt ?? 0),
  )
  const groupedCandidates = [...candidates.reduce((groups, candidate) => {
    const key = candidate.binding.workspaceId ?? 'ungrouped'
    const group = groups.get(key)
    if (group === undefined) groups.set(key, { key, title: candidate.workspaceTitle, candidates: [candidate] })
    else group.candidates.push(candidate)
    return groups
  }, new Map<string, { key: string; title: string; candidates: typeof candidates }>()).values()]
  const renderCandidate = (candidate: (typeof candidates)[number]) => {
    const row = sessionRows[candidate.binding.sessionId]
    const title = sessionDisplayTitle(row, candidate.binding.sessionId, copy.newSession)
    const updatedAt = row?.updatedAt === undefined ? copy.updatedUnknown : copy.updatedAt(new Date(row.updatedAt))
    return <button key={sessionTargetKey(candidate.binding)} type="button" role="option" aria-label={`${title} · ${candidate.workspaceTitle} · ${candidate.binding.sessionId}`} onClick={() => { onSelect(candidate.binding); setOpen(false); triggerRef.current?.focus() }}>
      <span className={css.markerLabel} data-accent={candidate.marker.accentToken}>{candidate.marker.label}</span>
      <span className={css.pickerIdentity}><strong>{title}</strong><small>{row?.running ? copy.running : copy.idle} · {updatedAt} · {candidate.binding.sessionId.slice(-8)}</small></span>
    </button>
  }
  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !controlRef.current?.contains(event.target)
        && !pickerRef.current?.contains(event.target)) setOpen(false)
    }
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); setOpen(false); triggerRef.current?.focus() }
    }
    globalThis.document.addEventListener('pointerdown', onPointerDown)
    globalThis.document.addEventListener('keydown', onKeyDown)
    return () => {
      globalThis.document.removeEventListener('pointerdown', onPointerDown)
      globalThis.document.removeEventListener('keydown', onKeyDown)
    }
  }, [open, setOpen])
  return <div ref={controlRef} className={css.bindingControl} data-workbench-pending-binding-picker>
    <button ref={triggerRef} type="button" disabled={disabled} className={css.bindingChip} aria-label={copy.chooseConversation} aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? pickerId : undefined} onClick={(event) => { event.stopPropagation(); setOpen(!open) }}>
      <span className={css.markerLabel} aria-hidden="true">＋</span>
      <span className={css.bindingTitle}>{triggerLabel ?? t('binding.pending')}</span>
    </button>
    {open ? <WorkbenchFloatingMenu kind="binding" ownerId={pickerId} anchorRef={triggerRef} surfaceRef={pickerRef} side="bottom" className={css.bindingPicker} label={copy.chooseConversation}>
      <div className={css.bindingPickerHeading}><span><strong>{copy.chooseConversation}</strong><small>{t('binding.existingOnly')}</small></span><kbd>Esc</kbd></div>
      <div className={css.bindingSearch} role="search"><IconSearchOutlineMedium className={css.searchIcon} size={15} /><label className={css.visuallyHidden} htmlFor={`${pickerId}-search`}>{copy.search}</label><input id={`${pickerId}-search`} autoFocus type="search" role="searchbox" placeholder={copy.searchPlaceholder} value={query} onChange={event => setQuery(event.currentTarget.value)} /></div>
      <div id={pickerId} role="listbox" aria-label={t('binding.available')}>
        {candidates.length === 0 ? <span className={css.bindingPickerEmpty}>{query.trim() ? t('binding.noMatches') : emptyMessage ?? t('binding.empty')}</span> : <section className={css.bindingPickerSection} data-binding-section="recent">
          <span className={css.bindingPickerSectionLabel}>{t('binding.recent')}</span>
          <WorkspacePickerGroups
            groups={groupedCandidates.map(group => ({ key: group.key, title: group.title, items: group.candidates }))}
            idPrefix={`${pickerId}-workspace`}
            collapsedKeys={collapsedWorkspaceGroups}
            onToggle={key => setCollapsedWorkspaceGroups(previous => {
              const next = new Set(previous)
              if (next.has(key)) next.delete(key)
              else next.add(key)
              return next
            })}
            renderItem={renderCandidate}
          />
        </section>}
      </div>
    </WorkbenchFloatingMenu> : null}
  </div>
}

interface SessionBindingCandidate {
  binding: SessionBindingV1
  marker: SessionMarkerRecord
  workspaceTitle: string
  external: boolean
}

function sessionDisplayTitle(
  row: LayoutViewProps['sessionRows'][string],
  fallback: string,
  blankTitle: string,
): string {
  const durableTitle = row?.title?.trim()
  if (durableTitle !== undefined && durableTitle.length !== 0) return durableTitle
  if (row?.blank === true) return blankTitle
  return row?.displayTitle ?? fallback
}

interface WorkspacePickerGroup<T> {
  key: string
  title: string
  items: readonly T[]
}

function WorkspacePickerGroups<T>({
  groups, idPrefix, collapsedKeys, onToggle, renderItem,
}: {
  groups: readonly WorkspacePickerGroup<T>[]
  idPrefix: string
  collapsedKeys: ReadonlySet<string>
  onToggle: (key: string) => void
  renderItem: (item: T) => ReactNode
}) {
  return <>{groups.map((group, groupIndex) => {
    const collapsed = collapsedKeys.has(group.key)
    const groupDomId = `${idPrefix}-${String(groupIndex)}`
    return <div key={group.key} className={css.bindingPickerGroup} data-workspace-group={group.key}>
      <button
        type="button"
        className={css.bindingPickerGroupTitle}
        aria-expanded={!collapsed}
        aria-controls={groupDomId}
        onClick={() => onToggle(group.key)}
      >
        <span className={css.bindingPickerGroupIcon} aria-hidden="true"><IconFolderOpenOutlineMedium size={14} /></span>
        <span>{group.title}</span>
        <span className={css.bindingPickerGroupChevron} aria-hidden="true">
          {collapsed ? <IconChevronRightOutlineMedium size={13} /> : <IconChevronDownOutlineMedium size={13} />}
        </span>
      </button>
      <div id={groupDomId} hidden={collapsed}>{group.items.map(renderItem)}</div>
    </div>
  })}</>
}

function SessionBindingChip({
  binding, resolved, marker, sessionRows, sessionMarkers, sessionMarkersByWorkspace, sessionIds, workspaces, workspaceTitle,
  archivedSessionIds, open, setOpen, onSelect, onOpenExternal,
  updateMarker,
}: SessionBindingChipProps) {
  const controlRef = useRef<HTMLDivElement>(null)
  const chipRef = useRef<HTMLButtonElement>(null)
  const pickerRef = useRef<HTMLDivElement>(null)
  const selectorId = useId()
  const [query, setQuery] = useState('')
  const [highlighted, setHighlighted] = useState(0)
  const [collapsedWorkspaceGroups, setCollapsedWorkspaceGroups] = useState<Set<string>>(() => new Set())
  const [editingMarker, setEditingMarker] = useState(false)
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false)
  const [draftLabel, setDraftLabel] = useState(marker.label)
  const [draftAccent, setDraftAccent] = useState(marker.accentToken)
  const [markerError, setMarkerError] = useState<string>()
  const [bindingAnnouncement, setBindingAnnouncement] = useState('')
  const { t, language } = useWorkbenchLocale()
  const copy = sessionBindingCopy(language)
  const pickerCopy = {
    current: t('conversation.currentBinding'),
    recent: t('conversation.recent'),
    noRecent: t('conversation.noRecent'),
  }
  const archived = new Set(archivedSessionIds)
  const allSessionIds = [...new Set([...sessionIds, binding.sessionId])]
  const projectedMarkers = ensureSessionMarkers(allSessionIds, sessionMarkers).markers
  const normalizedQuery = query.trim().normalize('NFKC').toLocaleLowerCase('und')
  const localCandidates: SessionBindingCandidate[] = allSessionIds.filter((sessionId) => {
    if (archived.has(sessionId) && sessionId !== binding.sessionId) return false
    // Blank sessions belong in the dedicated Conversation Launcher. Keep the
    // currently bound blank target visible so the picker never loses identity,
    // but do not offer every reusable empty session as a recent conversation.
    if (sessionRows[sessionId]?.blank === true && sessionId !== binding.sessionId) return false
    if (normalizedQuery.length === 0) return true
    const row = sessionRows[sessionId]
    const rowMarker = projectedMarkers[sessionId]
    return [row?.title ?? '', row?.displayTitle ?? '', rowMarker?.label ?? '', sessionId]
      .some(value => value.normalize('NFKC').toLocaleLowerCase('und').includes(normalizedQuery))
  }).map(sessionId => ({
    binding: {
      ...(binding.workspaceId === undefined ? {} : { workspaceId: binding.workspaceId }),
      sessionId,
    },
    marker: projectedMarkers[sessionId] ?? allocateSessionMarker(projectedMarkers),
    workspaceTitle,
    external: false,
  }))
  const externalCandidates: SessionBindingCandidate[] = workspaces
    .filter(workspace => workspace.workspaceId !== binding.workspaceId)
    .flatMap(workspace => workspace.sessionIds
      .filter(sessionId => !archived.has(sessionId))
      .map((sessionId): SessionBindingCandidate => ({
        binding: { workspaceId: workspace.workspaceId, sessionId },
        marker: sessionMarkersByWorkspace[workspace.workspaceId]?.[sessionId]
          ?? allocateSessionMarker(sessionMarkersByWorkspace[workspace.workspaceId] ?? {}),
        workspaceTitle: workspace.title ?? workspace.workspaceId,
        external: true,
      })))
    .filter((candidate) => {
      const candidateRow = sessionRows[candidate.binding.sessionId]
      if (candidateRow === undefined || candidateRow.blank || archived.has(candidate.binding.sessionId)) return false
      if (normalizedQuery.length === 0) return true
      return [
        candidateRow.title ?? '', candidateRow.displayTitle, candidate.marker.label,
        candidate.binding.sessionId, candidate.workspaceTitle,
      ].some(value => value.normalize('NFKC').toLocaleLowerCase('und').includes(normalizedQuery))
    })
  const currentCandidate = localCandidates.find(option => option.binding.sessionId === binding.sessionId)
  const sortByUpdatedAt = (left: SessionBindingCandidate, right: SessionBindingCandidate) =>
    (sessionRows[right.binding.sessionId]?.updatedAt ?? 0) - (sessionRows[left.binding.sessionId]?.updatedAt ?? 0)
  const nonCurrentCandidates = [
    ...localCandidates.filter(option => option.binding.sessionId !== binding.sessionId),
    ...externalCandidates,
  ].filter((candidate, index, all) => all.findIndex(other =>
    sessionTargetKey(other.binding) === sessionTargetKey(candidate.binding),
  ) === index)
  const sortedCandidates = nonCurrentCandidates.sort(sortByUpdatedAt)
  const recentCandidates = normalizedQuery.length === 0
    ? sortedCandidates.slice(0, 5)
    : sortedCandidates
  const candidates = [
    ...(currentCandidate === undefined ? [] : [currentCandidate]),
    ...recentCandidates,
  ]
  const currentCandidateIndex = currentCandidate === undefined ? -1 : 0
  const groupedCandidates = [...candidates.reduce((groups, option, index) => {
    if (index === currentCandidateIndex) return groups
    const key = option.binding.workspaceId ?? 'ungrouped'
    const group = groups.get(key)
    if (group === undefined) {
      groups.set(key, { workspaceId: option.binding.workspaceId, title: option.workspaceTitle, options: [{ option, index }] })
    } else {
      group.options.push({ option, index })
    }
    return groups
  }, new Map<string, { workspaceId: string | undefined; title: string; options: Array<{ option: SessionBindingCandidate; index: number }> }>()).values()]
  const title = sessionDisplayTitle(sessionRows[binding.sessionId], resolved.sessionTitle, copy.newSession)
  const shortId = resolved.shortId
  const identityState = resolved.status === 'missing'
    ? copy.missing
    : resolved.status === 'moved' ? copy.moved
      : resolved.status === 'archived' ? copy.archived : copy.available
  const lifecycle = resolved.running ? copy.running : resolved.status === 'missing' ? copy.unavailable : copy.idle
  const updatedAt = resolved.updatedAt === undefined
    ? copy.updatedUnknown
    : copy.updatedAt(new Date(resolved.updatedAt))
  const tooltip = `${title} · ${resolved.workspaceTitle} · ${identityState} · ${updatedAt} · ${shortId}`
  const close = useCallback(() => {
    setOpen(false)
    setQuery('')
    setHighlighted(0)
    setEditingMarker(false)
    setEmojiPickerOpen(false)
    setMarkerError(undefined)
    queueMicrotask(() => { chipRef.current?.focus() })
  }, [setOpen])
  const choose = (candidate: SessionBindingCandidate) => {
    const selectedTitle = sessionDisplayTitle(
      sessionRows[candidate.binding.sessionId],
      copy.unavailableConversation,
      copy.newSession,
    )
    if (candidate.external) {
      onOpenExternal(candidate.binding)
      setBindingAnnouncement(copy.opening(candidate.workspaceTitle, candidate.marker.label, selectedTitle))
    } else {
      onSelect(candidate.binding)
      setBindingAnnouncement(copy.bound(candidate.marker.label, selectedTitle))
    }
    close()
  }
  const renderCandidate = (option: SessionBindingCandidate, index: number) => {
    const candidate = resolveSessionTarget(option.binding, {
      workspaces,
      sessions: sessionRows,
      archivedSessionIds,
      markersByWorkspace: sessionMarkersByWorkspace,
    })
    const candidateTitle = sessionDisplayTitle(
      sessionRows[option.binding.sessionId],
      candidate.sessionTitle,
      copy.newSession,
    )
    const candidateLifecycle = candidate.running
      ? copy.running
      : candidate.status === 'archived' ? copy.archived
        : candidate.status === 'missing' ? copy.missing
          : candidate.status === 'moved' ? copy.moved : copy.idle
    const candidateUpdatedAt = candidate.updatedAt === undefined
      ? copy.updatedUnknown
      : copy.updatedAt(new Date(candidate.updatedAt))
    const isCurrent = !option.external && option.binding.sessionId === binding.sessionId
    return (
      <button
        key={sessionTargetKey(option.binding)}
        type="button"
        role="option"
        aria-selected={isCurrent}
        aria-current={isCurrent ? 'true' : undefined}
        data-current-binding={isCurrent || undefined}
        data-highlighted={index === highlighted || undefined}
        data-accent={option.marker.accentToken}
        aria-label={`${option.marker.label} · ${candidateTitle}${option.external ? ` · ${option.workspaceTitle}` : ''} · ${candidateLifecycle} · ${candidateUpdatedAt} · ${option.binding.sessionId.slice(-8)}`}
        onMouseEnter={() => { setHighlighted(index) }}
        onClick={() => { choose(option) }}
      >
        <span className={css.markerLabel} data-accent={option.marker.accentToken}>{option.marker.label}</span>
        <span className={css.pickerIdentity}>
          <strong>{candidateTitle}</strong>
          <small>{candidateLifecycle} · {candidateUpdatedAt} · {option.binding.sessionId.slice(-8)}</small>
        </span>
        {isCurrent ? <span className={css.pickerCheck} aria-hidden="true">✓</span> : null}
      </button>
    )
  }
  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent): void => {
      if (event.target instanceof Node && !controlRef.current?.contains(event.target)
        && !pickerRef.current?.contains(event.target)) close()
    }
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); close() }
    }
    const focusFrame = requestAnimationFrame(() => { pickerRef.current?.querySelector<HTMLInputElement>('input[type="search"]')?.focus() })
    globalThis.document.addEventListener('pointerdown', onPointerDown)
    globalThis.document.addEventListener('keydown', onKeyDown)
    return () => {
      cancelAnimationFrame(focusFrame)
      globalThis.document.removeEventListener('pointerdown', onPointerDown)
      globalThis.document.removeEventListener('keydown', onKeyDown)
    }
  }, [close, open])
  return (
    <div ref={controlRef} className={css.bindingControl}>
      <button
        ref={chipRef}
        type="button"
        className={css.bindingChip}
        data-accent={marker.accentToken}
        data-session-id={binding.sessionId}
        {...(binding.workspaceId === undefined ? {} : { 'data-workspace-id': binding.workspaceId })}
        aria-label={`${copy.bindLabel(marker.label, title)} · ${resolved.workspaceTitle} · ${shortId}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? selectorId : undefined}
        title={tooltip}
        onClick={(event) => {
          event.stopPropagation()
          if (open) close()
          else setOpen(true)
        }}
      >
        <span className={css.markerLabel} aria-hidden="true">{marker.label}</span>
        <span className={css.bindingTitle}>{title}</span>
        {resolved.running ? <span className={css.bindingRunning} data-session-lifecycle data-running aria-label={lifecycle} title={lifecycle}>●</span> : null}
      </button>
      <span
        className={css.visuallyHidden}
        aria-label={copy.bindingChange}
        aria-live="polite"
      >{bindingAnnouncement}</span>
      {open ? (
        <WorkbenchFloatingMenu kind="binding" ownerId={selectorId} anchorRef={chipRef} surfaceRef={pickerRef}
          side="bottom" className={css.bindingPicker} label={copy.chooseConversation}>
          <div className={css.bindingPickerHeading}>
            <span>
              <strong>{copy.chooseConversation}</strong>
              <small>{title} · {resolved.workspaceTitle} · {shortId}</small>
            </span>
            <kbd>Esc</kbd>
          </div>
          <div className={css.bindingSearch} role="search">
            <IconSearchOutlineMedium className={css.searchIcon} size={15} />
            <label className={css.visuallyHidden} htmlFor={`${selectorId}-search`}>{copy.search}</label>
            <input
              id={`${selectorId}-search`}
              autoFocus
              type="search"
              role="searchbox"
              placeholder={copy.searchPlaceholder}
              aria-label={copy.search}
              value={query}
              onChange={(event) => { setQuery(event.currentTarget.value); setHighlighted(0) }}
              onKeyDown={(event) => {
                if (event.key === 'Escape') { event.preventDefault(); close(); return }
                if (event.key === 'ArrowDown') {
                  event.preventDefault()
                  setHighlighted(value => Math.min(candidates.length - 1, value + 1))
                }
                if (event.key === 'ArrowUp') {
                  event.preventDefault()
                  setHighlighted(value => Math.max(0, value - 1))
                }
                if (event.key === 'Enter') {
                  event.preventDefault()
                  const candidate = candidates[highlighted]
                  if (candidate !== undefined) choose(candidate)
                }
              }}
            />
          </div>
          <button
            type="button"
            className={css.markerEditToggle}
            data-accent={marker.accentToken}
            aria-expanded={editingMarker}
            aria-controls={`${selectorId}-marker-editor`}
            onClick={() => {
              setEditingMarker(value => !value)
              setEmojiPickerOpen(false)
              setDraftLabel(marker.label)
              setDraftAccent(marker.accentToken)
              setMarkerError(undefined)
            }}
          >
            <span className={css.markerLabel} aria-hidden="true">{marker.label}</span>
            <span className={css.markerEditText}>{copy.editMarker}</span>
            <span className={css.markerEditChevron} aria-hidden="true">{editingMarker
              ? <IconChevronUpOutlineMedium size={14} />
              : <IconChevronDownOutlineMedium size={14} />}</span>
          </button>
          {editingMarker ? (
            <div id={`${selectorId}-marker-editor`} className={css.markerEditor}>
              <label htmlFor={`${selectorId}-marker-label`}>{copy.shortLabel}</label>
              <span className={css.markerInputRow}>
                <input
                  id={`${selectorId}-marker-label`}
                  type="text"
                  aria-label={copy.shortLabel}
                  placeholder={copy.shortLabelPlaceholder}
                  value={draftLabel}
                  onChange={(event) => { setDraftLabel(event.currentTarget.value); setMarkerError(undefined) }}
                />
                <button
                  type="button"
                  className={css.emojiButton}
                  aria-label={copy.chooseEmoji}
                  aria-expanded={emojiPickerOpen}
                  aria-controls={`${selectorId}-emoji`}
                  onClick={() => { setEmojiPickerOpen(value => !value); setMarkerError(undefined) }}
                >😀</button>
              </span>
              {emojiPickerOpen ? (
                <span id={`${selectorId}-emoji`} className={css.emojiPicker} role="group" aria-label={copy.chooseEmoji}>
                  {SESSION_MARKER_EMOJIS.map(emoji => (
                    <button
                      key={emoji}
                      type="button"
                      className={css.emojiChoice}
                      aria-label={emoji}
                      onClick={() => {
                        setDraftLabel(emoji)
                        setMarkerError(undefined)
                        setEmojiPickerOpen(false)
                      }}
                    >{emoji}</button>
                  ))}
                </span>
              ) : null}
              <div className={css.accentChoices} aria-label={copy.conversationColor}>
                <span className={css.accentHeading}>{copy.conversationColor}</span>
                {SESSION_ACCENT_TOKENS.map((accent, index) => (
                  <button
                    key={accent}
                    type="button"
                    data-accent={accent}
                    data-selected={accent === draftAccent || undefined}
                    aria-pressed={accent === draftAccent}
                    aria-label={copy.color(index + 1)}
                    title={copy.color(index + 1)}
                    onClick={() => { setDraftAccent(accent) }}
                  >
                    <span className={css.accentSwatch} aria-hidden="true" />
                  </button>
                ))}
              </div>
              {markerError === undefined ? null : <p role="alert">{markerError}</p>}
              <div className={css.markerEditorActions}>
                <button type="button" onClick={() => {
                  const validation = validateSessionLabel(draftLabel, projectedMarkers, binding.sessionId)
                  if (!validation.ok) {
                    const message = validation.code === 'conflict'
                      ? copy.markerConflict(sessionRows[validation.conflictSessionId]?.displayTitle ?? validation.conflictSessionId)
                      : validation.code === 'length' ? copy.markerLength
                        : validation.code === 'control' ? copy.markerControl : copy.markerEmpty
                    setMarkerError(message)
                    return
                  }
                  updateMarker({ label: validation.label, accentToken: draftAccent, customized: true })
                  setEditingMarker(false)
                }}>{copy.saveMarker}</button>
                <button type="button" onClick={() => {
                  const otherMarkers = withoutRecordKey(projectedMarkers, binding.sessionId)
                  updateMarker(allocateSessionMarker(otherMarkers))
                  setEditingMarker(false)
                }}>{copy.restoreMarker}</button>
              </div>
            </div>
          ) : null}
          <div id={selectorId} role="listbox" aria-label={copy.chooseConversation} aria-live="polite">
            {currentCandidate === undefined ? null : (
              <section className={css.bindingPickerSection} data-binding-section="current" data-testid="binding-picker-current">
                <span className={css.bindingPickerSectionLabel}>{pickerCopy.current}</span>
                {renderCandidate(currentCandidate, currentCandidateIndex)}
              </section>
            )}
            <section className={css.bindingPickerSection} data-binding-section="recent" data-testid="binding-picker-recent">
              <span className={css.bindingPickerSectionLabel}>{pickerCopy.recent}</span>
              {groupedCandidates.length === 0 ? (
                <span className={css.bindingPickerEmpty}>{candidates.length === 0 ? copy.noMatches : pickerCopy.noRecent}</span>
              ) : <WorkspacePickerGroups
                groups={groupedCandidates.map(group => ({ key: group.workspaceId ?? 'ungrouped', title: group.title, items: group.options }))}
                idPrefix={`${selectorId}-workspace`}
                collapsedKeys={collapsedWorkspaceGroups}
                onToggle={groupKey => setCollapsedWorkspaceGroups(previous => {
                  const next = new Set(previous)
                  if (next.has(groupKey)) next.delete(groupKey)
                  else next.add(groupKey)
                  return next
                })}
                renderItem={({ option, index }) => renderCandidate(option, index)}
              />}
            </section>
          </div>
        </WorkbenchFloatingMenu>
      ) : null}
    </div>
  )
}

function AreaView(props: LayoutViewProps & { group: GroupNode }) {
  const { t } = useWorkbenchLocale()
  const {
    workbenchId, collaborationClient, group, document, commit, renderSlot, editors, currentSession, account, workspaces, reportStateFailure,
    projectNeutral,
    sessionRows, sessionMarkers, sessionMarkersByWorkspace, sessionIds, workspaceTitle, archivedSessionIds,
    updateSessionMarker, openExternalSession, openOfficialSession, placeConversation, completePreparedConversation, bindSession,
    splitEmpty,
    splitPlacement, requestSplitPlacement, updateSplitPlacement, confirmSplitPlacement, cancelSplitPlacement,
    collapsedAreaIds, expandedAreaCount, toggleAreaCollapsed,
    summary,
    editAreaBackground, editAreaProject, areaProjects,
    conversationResourcePolicy,
  } = props
  const [projectOverviewOpen, setProjectOverviewOpen] = useState(false)
  const projectId = areaProjects?.[group.id]?.projectId
  const project = projectId ? props.directory?.getProjects?.(workbenchId)[projectId] : undefined
  const floating = useFloatingWorkspace()
  const interactionPolicy = normalizeWorkbenchConversationInteractionPolicy(conversationResourcePolicy)
  const tabFontSize = workbenchTabFontSizePx(interactionPolicy.tabFontSize)
  const active = activeTab(group)
  const projectOverviewLabel = t(active === undefined ? 'project.overview' : projectOverviewOpen ? 'project.hideOverview' : 'project.showOverview')
  const isUnboundConversationTab = (tab: TabDocument): boolean => tab.editorId === 'workbench.conversation'
    && tab.editorScope === 'session'
    && tab.binding === undefined
    && tab.sessionId === undefined
    && tab.pendingBinding === undefined
  const activePendingSession = active?.editorScope === 'session'
    && (active.pendingBinding !== undefined || isUnboundConversationTab(active))
  const activeSessionId = active?.sessionId
  const areaClaim = `workbench-area:${group.id}:${active?.id ?? 'empty'}:${active?.bindingGeneration ?? 0}`
  const activeRosterWorkspace = activeSessionId === undefined
    ? undefined
    : workspaces.find(workspace => workspace.sessionIds.includes(activeSessionId))
  const activeBinding = activePendingSession ? undefined : activePageSessionBinding(group, workspaces, projectNeutral, account)
  const currentRosterWorkspace = currentSession === undefined
    ? undefined
    : workspaces.find(workspace => workspace.sessionIds.includes(currentSession))
  const targetBinding: SessionBindingV1 | undefined = activeBinding ?? (projectNeutral || currentSession === undefined
    ? undefined
    : {
      ...(projectNeutral
        ? currentRosterWorkspace === undefined ? {} : { workspaceId: currentRosterWorkspace.workspaceId }
        : account.startsWith('workspace:') ? { workspaceId: account.slice('workspace:'.length) } : {}),
      sessionId: currentSession,
    })
  // Legacy v1 tabs only stored `sessionId`.  Resolve their workspace from the
  // live roster before deciding whether the binding moved.  Treating the
  // missing workspace as the current Area account makes an archived/moved
  // legacy tab look healthy and mounts a provider for the wrong Session.
  const resolvedActive = activeBinding === undefined ? undefined : resolveSessionTarget(activeBinding, {
    workspaces,
    sessions: sessionRows,
    archivedSessionIds,
    markersByWorkspace: sessionMarkersByWorkspace,
  })
  const sessionUnavailable: 'archived' | 'missing' | 'moved' | undefined = resolvedActive === undefined
    || resolvedActive.status === 'available' ? undefined : resolvedActive.status
  const bindingWorkspace = activeBinding?.workspaceId === undefined
    ? activeRosterWorkspace
    : workspaces.find(workspace => workspace.workspaceId === activeBinding.workspaceId)
  const areaSessionIds = bindingWorkspace?.sessionIds ?? sessionIds
  const areaWorkspaceTitle = bindingWorkspace?.title ?? workspaceTitle
  const areaSessionMarkers = activeBinding?.workspaceId === undefined
    ? sessionMarkers
    : sessionMarkersByWorkspace[activeBinding.workspaceId] ?? sessionMarkers
  const areaMarker = activeBinding === undefined ? undefined
    : areaSessionMarkers[activeBinding.sessionId] ?? allocateSessionMarker(areaSessionMarkers)
  const pickerWorkspaces = areaProjects === undefined ? workspaces
    : workspaces.filter(workspace => workspace.workspaceId === areaProjects[group.id]?.workspaceId)
  const pickerSessionIds = areaProjects === undefined ? areaSessionIds : pickerWorkspaces.flatMap(workspace => workspace.sessionIds)
  const areaRef = useRef<HTMLElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const collapsePreviewId = useId()
  const editorTriggerRef = useRef<HTMLButtonElement>(null)
  const editorMenuAnchorRef = useRef<HTMLElement | null>(null) as MutableRefObject<HTMLElement | null>
  // Empty Areas have no tab to act as the floating editor menu anchor. Keep
  // the chooser button on the same ref so the menu remains positionable after
  // the last tab is closed.
  const emptyEditorTriggerRef = editorTriggerRef
  const collapseTriggerRef = useRef<HTMLButtonElement>(null)
  const areaTabsRef = useRef<HTMLDivElement>(null)
  const areaTabStripRef = useRef<HTMLDivElement>(null)
  const tabOverviewTriggerRef = useRef<HTMLButtonElement>(null)
  const tabOverviewSurfaceRef = useRef<HTMLDivElement>(null)
  const collapsePreviewTimerRef = useRef<ReturnType<typeof globalThis.setTimeout>>()
  const collapsePreviewHideTimerRef = useRef<ReturnType<typeof globalThis.setTimeout>>()
  const areaMenuTriggerRef = useRef<HTMLButtonElement>(null)
  const editorMenuSurfaceRef = useRef<HTMLDivElement>(null)
  const areaMenuSurfaceRef = useRef<HTMLDivElement>(null)
  const gestureCleanupRef = useRef<(() => void)>()
  const suppressAreaMenuClickRef = useRef(false)
  const [menu, setMenu] = useState<'editor' | 'area'>()
  const [editorMenuMode, setEditorMenuMode] = useState<'replace' | 'add'>('replace')
  const [collapsePreviewOpen, setCollapsePreviewOpen] = useState(false)
  const [tabOverviewOpen, setTabOverviewOpen] = useState(false)
  const [tabOverviewQuery, setTabOverviewQuery] = useState('')
  const tabOverviewAnchorRef = useRef<HTMLElement | null>(null)
  const [tabStripOverflow, setTabStripOverflow] = useState({ left: false, right: false })
  const [bindingTabId, setBindingTabId] = useState<string>()
  const bindingOpen = active !== undefined && bindingTabId === active.id
  const setBindingOpen = (open: boolean) => setBindingTabId(open ? active?.id : undefined)
  const [gesture, setGesture] = useState<AreaGesture>()
  const [areaMergeDragging, setAreaMergeDragging] = useState(false)
  const sibling = siblingArea(document, group.id)
  const collapseEdge = props.collapseEdgeOverride ?? collapseEdgeForGroup(document, group.id)
  const areaCollapsed = collapsedAreaIds.has(group.id)
  const canCollapse = areaCollapsed || expandedAreaCount > 1
  const collapseLabel = collapseEdge === undefined
    ? t('layout.noAdjacentArea')
    : !canCollapse
      ? t('layout.keepExpanded')
    : areaCollapsed
      ? t('area.expandFrom', { side: t(`area.from.${collapseEdge}`), page: active ? workbenchPageTitle(t, active.editorId, active.lastKnownTitle) : t('settings.current2') })
      : t('area.collapseTowards', { side: t(`area.towards.${collapseEdge}`), page: active ? workbenchPageTitle(t, active.editorId, active.lastKnownTitle) : t('settings.current2') })
  const areaProject = areaProjects?.[group.id]
  const areaWorkspaceId = areaProject?.workspaceId ?? group.project?.workspaceId
  const areaWorkspace = areaWorkspaceId === undefined
    ? undefined
    : workspaces.find(workspace => workspace.workspaceId === areaWorkspaceId)
  const hasWorkspace = areaProjects === undefined || areaWorkspaceId !== undefined
  const hasSession = hasWorkspace && areaWorkspace !== undefined
    && areaWorkspace.sessionIds.some(sessionId => {
      const session = sessionRows[sessionId]
      return session !== undefined && !session.blank && !archivedSessionIds.includes(sessionId)
    })
  const selectableEditors = editorsAvailableForWorkbenchContext(
    selectableWorkbenchEditors(editors, props.hiddenEditorIds),
    { hasWorkspace, hasSession },
  )
  const activeEditor = active === undefined
    ? undefined
    : workbenchEditorFromIndex(props.editorIndex, active.editorId, active.editorScope)
  const activePresentation = resolveWorkbenchEditorPresentation(activeEditor)
  // Visibility describes whether this Area is rendered in the current Workbench.
  // Focus is tracked separately so a visible sibling does not get paused or
  // treated as a background document merely because another Area is active.
  const areaFocused = !areaCollapsed && document.activeGroupId === group.id
  const editorVisibility = areaCollapsed ? 'collapsed' as const : 'visible' as const
  const disposeWhenCollapsed = areaCollapsed && activeEditor?.declaration?.runtime.collapsed === 'dispose'
  const editorLifecycle = useMemo(() => ({
    visibility: editorVisibility,
    focused: areaFocused,
    ...(activeEditor?.declaration?.runtime.background === undefined ? {} : { background: activeEditor.declaration.runtime.background }),
    ...(activeEditor?.declaration?.runtime.collapsed === undefined ? {} : { collapsed: activeEditor.declaration.runtime.collapsed }),
  }), [activeEditor?.declaration?.runtime.background, activeEditor?.declaration?.runtime.collapsed, areaFocused, editorVisibility])
  const areaOrdinal = Math.max(1, props.groupOrdinals.get(group.id) ?? 1)
  const conversationStates = useConversationTabStatus(props.conversationStatus, group.tabs.flatMap(tab => {
    const binding = conversationTabBinding(tab, activeBinding)
    return binding && sessionRows[binding.sessionId] && !archivedSessionIds.includes(binding.sessionId) ? [binding.sessionId] : []
  }))
  const tabRows = useMemo(() => buildWorkbenchAreaTabRows({
    tabs: group.tabs,
    editorIndex: props.editorIndex,
    activeTabId: active?.id,
    areaBinding: activeBinding,
    pausedTabId: disposeWhenCollapsed ? active?.id : undefined,
    conversations: conversationStates,
    sessionAvailability: binding => conversationTabUnavailable(binding, { workspaces, sessions: sessionRows, archivedSessionIds }, t),
    information: { sessions: sessionRows, workspaces, markersByWorkspace: sessionMarkersByWorkspace, location: t('page.area', { index: String(areaOrdinal).padStart(2, '0') }) },
    t,
  }), [active?.id, activeBinding, disposeWhenCollapsed, group.tabs, props.editorIndex, conversationStates, workspaces, sessionRows, archivedSessionIds, sessionMarkersByWorkspace, areaOrdinal, t])
  const tabSummaries = tabRows.summaries
  const filteredTabSummaries = useMemo(() => {
    const query = tabOverviewQuery.trim().toLocaleLowerCase('zh-CN')
    if (query === '') return tabSummaries
    return tabSummaries.filter(tab => tab.title.toLocaleLowerCase('zh-CN').includes(query) || (tab.information?.searchText ?? tab.statusLabel.toLocaleLowerCase('zh-CN')).includes(query))
  }, [tabOverviewQuery, tabSummaries])
  const collapsePreviewTitle = `${t('page.area', { index: String(areaOrdinal).padStart(2, '0') })} · ${active ? workbenchPageTitle(t, active.editorId, active.lastKnownTitle) : t('layout.noneSelected')}`
  const collapsePreviewDetail = [
    activeEditor?.category ?? (active?.editorScope === 'session' ? t('layout.conversationPage') : t('layout.workspacePage')),
    activeEditor?.pluginId,
  ].filter((value): value is string => value !== undefined && value.length > 0).join(' · ')
  const collapsePreviewSummary = group.tabs.length > 1
    ? `${collapsePreviewDetail} · ${t('area.pageCount', { count: group.tabs.length })}${group.tabs.length > 6 ? ' · ' + t('area.extraPages', { count: group.tabs.length - 6 }) : ''}`
    : collapsePreviewDetail
  const floatingMenuSide: FloatingMenuSide = collapseEdge === 'left' ? 'right'
    : collapseEdge === 'right' ? 'left'
      : collapseEdge === 'up' ? 'bottom'
      : collapseEdge === 'down' ? 'top' : 'bottom'
  const tabStripVertical = areaCollapsed && (collapseEdge === 'left' || collapseEdge === 'right')

  const showCollapsePreview = () => {
    if (!areaCollapsed) return
    if (collapsePreviewHideTimerRef.current !== undefined) clearTimeout(collapsePreviewHideTimerRef.current)
    if (collapsePreviewTimerRef.current !== undefined) clearTimeout(collapsePreviewTimerRef.current)
    collapsePreviewTimerRef.current = globalThis.setTimeout(() => {
      collapsePreviewTimerRef.current = undefined
      setCollapsePreviewOpen(true)
    }, 260)
  }
  const keepCollapsePreview = () => {
    if (collapsePreviewHideTimerRef.current !== undefined) clearTimeout(collapsePreviewHideTimerRef.current)
    collapsePreviewHideTimerRef.current = undefined
    setCollapsePreviewOpen(true)
  }
  const hideCollapsePreview = () => {
    if (collapsePreviewTimerRef.current !== undefined) clearTimeout(collapsePreviewTimerRef.current)
    collapsePreviewTimerRef.current = undefined
    if (collapsePreviewHideTimerRef.current !== undefined) clearTimeout(collapsePreviewHideTimerRef.current)
    collapsePreviewHideTimerRef.current = globalThis.setTimeout(() => {
      collapsePreviewHideTimerRef.current = undefined
      setCollapsePreviewOpen(false)
    }, 160)
  }

  useEffect(() => () => {
    if (collapsePreviewTimerRef.current !== undefined) clearTimeout(collapsePreviewTimerRef.current)
    if (collapsePreviewHideTimerRef.current !== undefined) clearTimeout(collapsePreviewHideTimerRef.current)
  }, [])

  useEffect(() => {
    if (!tabOverviewOpen) return
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      setTabOverviewOpen(false)
      tabOverviewAnchorRef.current?.focus()
    }
    const closeOnOutside = (event: globalThis.PointerEvent) => {
      if (event.target instanceof Node
        && (tabOverviewSurfaceRef.current?.contains(event.target) || tabOverviewAnchorRef.current?.contains(event.target))) return
      setTabOverviewOpen(false)
    }
    globalThis.window.addEventListener('keydown', closeOnEscape)
    globalThis.document.addEventListener('pointerdown', closeOnOutside)
    return () => {
      globalThis.window.removeEventListener('keydown', closeOnEscape)
      globalThis.document.removeEventListener('pointerdown', closeOnOutside)
    }
  }, [tabOverviewOpen])

  const updateTabStripOverflow = useCallback(() => {
    const element = areaTabsRef.current
    if (element === null) return
    const vertical = areaCollapsed && (collapseEdge === 'left' || collapseEdge === 'right')
    const maxScroll = Math.max(0, vertical ? element.scrollHeight - element.clientHeight : element.scrollWidth - element.clientWidth)
    setTabStripOverflow(previous => {
      const position = vertical ? element.scrollTop : element.scrollLeft
      const next = { left: position > 2, right: maxScroll - position > 2 }
      return previous.left === next.left && previous.right === next.right ? previous : next
    })
  }, [areaCollapsed, collapseEdge])

  useLayoutEffect(() => {
    const element = areaTabsRef.current
    if (element === null) return
    updateTabStripOverflow()
    const trackedObserver = createWorkbenchResizeObserver('tab-strip', updateTabStripOverflow)
    trackedObserver?.observer.observe(element)
    element.addEventListener('scroll', updateTabStripOverflow, { passive: true })
    return () => {
      trackedObserver?.disconnect()
      element.removeEventListener('scroll', updateTabStripOverflow)
    }
  }, [areaCollapsed, collapseEdge, group.tabs.length, updateTabStripOverflow])

  useEffect(() => {
    const strip = areaTabStripRef.current
    const tabs = areaTabsRef.current
    if (strip === null || tabs === null || areaCollapsed) return
    const scrollWithWheel = (event: WheelEvent) => {
      // Preserve browser zoom and let non-overflowing Areas keep normal wheel behavior.
      if (event.ctrlKey || event.metaKey || event.altKey || event.defaultPrevented) return
      const maxScroll = tabs.scrollWidth - tabs.clientWidth
      if (tabs.clientWidth === 0 || maxScroll <= 0) return
      const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY
      if (delta === 0) return
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? tabs.clientWidth : 1
      event.preventDefault()
      event.stopPropagation()
      tabs.scrollLeft = Math.max(0, Math.min(maxScroll, tabs.scrollLeft + delta * unit))
      updateTabStripOverflow()
    }
    // A native non-passive listener is needed to turn vertical wheel input into
    // horizontal tab scrolling without also scrolling the surrounding surface.
    strip.addEventListener('wheel', scrollWithWheel, { passive: false })
    return () => strip.removeEventListener('wheel', scrollWithWheel)
  }, [areaCollapsed, updateTabStripOverflow])

  useEffect(() => {
    if (active === undefined || areaCollapsed) return
    const reveal = () => {
      const element = areaTabsRef.current
      const target = findAreaTabElement(element, active.id)
      if (target !== undefined && typeof target.scrollIntoView === 'function') {
        target.scrollIntoView({ block: 'nearest', inline: 'nearest' })
      }
      updateTabStripOverflow()
    }
    if (typeof requestAnimationFrame === 'function') {
      const frame = requestAnimationFrame(reveal)
      return () => cancelAnimationFrame(frame)
    }
    reveal()
    return undefined
  }, [active?.id, areaCollapsed, group.tabs.length, updateTabStripOverflow])

  useEffect(() => {
    if (!areaCollapsed) return
    setTabOverviewOpen(false)
  }, [areaCollapsed])

  const scrollTabs = (direction: -1 | 1) => {
    const element = areaTabsRef.current
    if (element === null) return
    const vertical = areaCollapsed && (collapseEdge === 'left' || collapseEdge === 'right')
    const amount = Math.max(120, (vertical ? element.clientHeight : element.clientWidth) * .7)
    if (typeof element.scrollBy === 'function') {
      if (vertical) element.scrollBy({ top: direction * amount, behavior: 'smooth' })
      else element.scrollBy({ left: direction * amount, behavior: 'smooth' })
    }
    else if (vertical) element.scrollTop += direction * amount
    else element.scrollLeft += direction * amount
  }

  useEffect(() => {
    if (menu === undefined) return
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setMenu(undefined)
      if (menu === 'editor') editorMenuAnchorRef.current?.focus()
    }
    const onPointerDown = (event: globalThis.PointerEvent) => {
      const floatingMenu = menu === 'editor' ? editorMenuSurfaceRef.current : areaMenuSurfaceRef.current
      if (event.target instanceof Node && floatingMenu?.contains(event.target) === true) return
      const owner = menu === 'editor'
        ? editorMenuAnchorRef.current
        : areaRef.current?.querySelector<HTMLElement>('[data-area-actions]')
      if (event.target instanceof Node && !owner?.contains(event.target)) setMenu(undefined)
    }
    window.addEventListener('keydown', onKey)
    globalThis.document.addEventListener('pointerdown', onPointerDown)
    return () => {
      window.removeEventListener('keydown', onKey)
      globalThis.document.removeEventListener('pointerdown', onPointerDown)
    }
  }, [menu])

  useEffect(() => () => { gestureCleanupRef.current?.() }, [])

  const makeTab = (
    editor: import('./catalog.ts').WorkbenchEditorCatalogRow,
    initialState: JsonValue = {},
  ): TabDocument | undefined => {
    if (editor.scope === 'session') {
      if (targetBinding === undefined) return createPendingSessionTab(editor, nextId('tab'), group, tabsOf(document.root), initialState)
      return createSessionTab(nextId('tab'), editor.id, targetBinding, editor.label, initialState)
    }
    return {
      id: nextId('tab'), editorId: editor.id, editorScope: 'root',
      lastKnownTitle: editor.label, state: editor.id === 'workbench.workspace-files' ? (projectId ? { projectId } : { projectAreaId: group.id }) : structuredClone(initialState),
    }
  }

  const makeReplacementTab = (
    editor: import('./catalog.ts').WorkbenchEditorCatalogRow,
    initialState: JsonValue = {},
  ): TabDocument | undefined => {
    if (active === undefined) return undefined
    if (editor.scope === 'session') {
      if (targetBinding === undefined) return createPendingSessionTab(editor, active.id, group, tabsOf(document.root), initialState)
      return createSessionTab(active.id, editor.id, targetBinding, editor.label, initialState)
    }
    return {
      id: active.id, editorId: editor.id, editorScope: 'root',
      lastKnownTitle: editor.label, state: structuredClone(initialState),
    }
  }

  const replaceEditor = (
    editor: import('./catalog.ts').WorkbenchEditorCatalogRow,
  ) => {
    const tab = active && editor.scope === 'session'
      ? createPendingSessionTab(editor, active.id, group, tabsOf(document.root))
      : makeReplacementTab(editor)
    if (tab !== undefined) {
      commit({ type: 'replace-tab', tabId: tab.id, tab })
      if (tab.pendingBinding) setBindingTabId(tab.id)
    }
    setMenu(undefined)
  }

  const addEditor = (
    editor: import('./catalog.ts').WorkbenchEditorCatalogRow,
  ) => {
    const tab = editor.scope === 'session'
      ? createPendingSessionTab(editor, nextId('tab'), group, tabsOf(document.root))
      : makeTab(editor)
    /* v8 ignore next -- makeTab is undefined only behind the disabled Session-editor action. */
    if (tab !== undefined) {
      commit({ type: 'add-tab', groupId: group.id, tab })
      if (tab.pendingBinding) setBindingTabId(tab.id)
    }
    setMenu(undefined)
  }

  const openNativeTab = (
    kind: string,
    options?: Record<string, unknown>,
  ): boolean => {
    const requestedContentId = typeof options?.nativeContentId === 'string' && options.nativeContentId.length > 0
      ? options.nativeContentId
      : typeof options?.resourceAddress === 'string' && options.resourceAddress.length > 0
        ? options.resourceAddress
        : undefined
    if (requestedContentId !== undefined) {
      const action = conversationResourceActionFor(
        typeof options?.resourceType === 'string' ? options.resourceType : workbenchConversationResourceType(requestedContentId),
        conversationResourcePolicy,
      )
      if (!action.handled) return false
      if (action.options?.ignoreResource === true) return true
      options = { ...(options ?? {}), ...(action.options ?? {}) }
    }
    const definition = workbenchNativeSidebarForKind(kind)
    const editorId = definition?.editorId ?? (typeof options?.editorId === 'string' ? options.editorId : undefined)
    if (definition === undefined && editorId !== undefined) {
      // Extension declarations use their editorId directly. Their renderer is
      // registered through the Workbench editor slot and does not need a DSH
      // Sidebar definition.
    } else if (definition?.projection !== 'ready') {
      reportStateFailure(definition === undefined
        ? t('page.notCataloged')
        : t('page.adapterRequired', { name: definition.label }))
      return false
    }
    if (editorId === undefined) {
      reportStateFailure(t('page.notRegistered', { kind }))
      return false
    }
    const editor = editors.find(row => row.id === editorId && row.scope === 'session')
    if (editor === undefined) {
      reportStateFailure(t('page.openFailed', { kind }))
      return false
    }
    if (floating && options?.floating === true) {
      return floating.route?.({ workbenchId, kind, options, ...(targetBinding ? { binding: targetBinding } : {}), ...(active ? { sourceId: active.id } : {}) }) ?? false
    }
    const state = nativeTabState(kind, options)
    const replace = options?.replaceTab === true
    const targetSessionId = targetBinding?.sessionId
    if (requestedContentId !== undefined && targetSessionId !== undefined
      && !workbenchResourceMatchesSession(requestedContentId, targetSessionId)) {
      // A late resource event may arrive after this Area has been rebound.
      // Refuse it here instead of attaching another Session's content to
      // the new Area or silently falling through to the global Sidebar.
      return false
    }
    if (!replace && options?.revealIfOpened !== false) {
      const requestedParams = options?.params
      const existing = group.tabs.find(tab => {
        if (tab.editorId !== editor.id || tab.editorScope !== 'session' || !sameEditorSource(tab, targetBinding)) return false
        const previous = tab.state !== null && typeof tab.state === 'object' && !Array.isArray(tab.state)
          ? tab.state as { readonly nativeParams?: unknown; readonly nativeContentId?: unknown }
          : undefined
        const sameContent = requestedContentId === undefined || previous?.nativeContentId === requestedContentId
        const resourceIdentity = requestedContentId !== undefined
          && (workbenchNativeSidebarForResourceAddress(requestedContentId) !== undefined || typeof options?.resourceType === 'string')
        return sameContent && (resourceIdentity || JSON.stringify(previous?.nativeParams) === JSON.stringify(requestedParams))
      })
      if (existing !== undefined) {
        // Resource tabs keep one identity while navigation (file line,
        // changed-file index, etc.) moves independently. Persist the latest
        // navigation before revealing the existing Area tab.
        if (requestedContentId !== undefined && workbenchNativeSidebarForResourceAddress(requestedContentId) !== undefined) {
          commit({
            type: 'update-tab-state', tabId: existing.id, state,
            ...(existing.bindingGeneration === undefined ? {} : { bindingGeneration: existing.bindingGeneration }),
          })
        }
        commit({ type: 'activate', groupId: group.id, tabId: existing.id })
        return true
      }
    }
    const tab = replace ? makeReplacementTab(editor, state) : makeTab(editor, state)
    if (tab === undefined) {
      const pending = makeTab(editor, state)
      if (pending !== undefined) commit({ type: 'add-tab', groupId: group.id, tab: pending })
      return pending !== undefined
    }
    commit(replace
      ? { type: 'replace-tab', tabId: tab.id, tab }
      : { type: 'add-tab', groupId: group.id, tab })
    return true
  }

  const openConversationResource = (
    address: string,
    placement?: Record<string, unknown>,
    source?: WorkbenchResourceSourceV1,
  ): WorkbenchResourceRouteResult => routeWorkbenchConversationResource(
    openNativeTab,
    address,
    conversationResourcePolicy,
    placement,
    targetBinding?.sessionId,
    source,
    editors.flatMap(editor => editor.declaration?.conversationResources ?? []),
  )

  const areaContentIdentity = useMemo<AreaContentCommandIdentityV1 | undefined>(() => active === undefined
    ? undefined
    : {
      areaId: group.id,
      ...((areaProjects?.[group.id]?.projectId ?? group.project?.projectId) ? { projectId: (areaProjects?.[group.id]?.projectId ?? group.project?.projectId)! } : {}),
      tabId: active.id,
      editorId: active.editorId,
      editorScope: active.editorScope,
      ...(active.sessionId === undefined ? {} : { sessionId: active.sessionId }),
      bindingGeneration: active.bindingGeneration ?? 0,
    }, [active?.bindingGeneration, active?.editorId, active?.editorScope, active?.id, active?.sessionId, group.id])
  const areaContentCommandStateRef = useRef<AreaContentCommandStateV1>()
  const areaContentCommandHandlers: AreaContentCommandHandlersV1 = {
    commit,
    openBindingPicker: () => { setBindingOpen(true) },
    placeConversation: input => placeConversation(group.id, {
      ...input,
      ...(active?.editorId === 'workbench.conversation.start'
        ? { startModuleInstanceId: active.id }
        : {}),
    }),
    completePreparedConversation: input => completePreparedConversation(group.id, input),
    openSession: sessionId => bindSession(group.id, sessionId, areaClaim),
    openNativeTab,
    openConversationResource,
    reportStateFailure,
  }
  areaContentCommandStateRef.current = {
    identity: areaContentIdentity,
    handlers: areaContentCommandHandlers,
  }
  const areaContentCommands = useMemo<AreaContentCommandFacadeV1 | undefined>(() => {
    if (areaContentIdentity === undefined) return undefined
    const currentHandlers = () => {
      const current = areaContentCommandStateRef.current
      return current !== undefined && isAreaContentCommandCurrent(areaContentIdentity, current.identity)
        ? current.handlers
        : undefined
    }
    return {
      commit: command => { currentHandlers()?.commit(command) },
      openBindingPicker: () => { currentHandlers()?.openBindingPicker() },
      placeConversation: input => currentHandlers()?.placeConversation(input)
        ?? Promise.reject(new Error('Workbench Area content claim has expired')),
      completePreparedConversation: input => currentHandlers()?.completePreparedConversation(input) ?? false,
      openSession: sessionId => currentHandlers()?.openSession(sessionId)
        ?? Promise.reject(new Error('Workbench Area content claim has expired')),
      openNativeTab: (kind, options) => currentHandlers()?.openNativeTab(kind, options) ?? false,
      openConversationResource: (address, placement, source) => currentHandlers()?.openConversationResource(address, placement, source) ?? 'rejected',
      reportStateFailure: message => { currentHandlers()?.reportStateFailure(message) },
    }
  }, [areaContentIdentity])
  const areaContentProjection: AreaContentProjectionV1 | undefined = active === undefined
    ? undefined
    : {
      areaId: group.id,
      ...((areaProjects?.[group.id]?.projectId ?? group.project?.projectId) ? { projectId: (areaProjects?.[group.id]?.projectId ?? group.project?.projectId)! } : {}),
      tabId: active.id,
      editorId: active.editorId,
      editorScope: active.editorScope,
      ...(active.sessionId === undefined ? {} : { sessionId: active.sessionId }),
      ...((active.binding?.workspaceId ?? areaProjects?.[group.id]?.workspaceId ?? group.project?.workspaceId) === undefined ? {} : { workspaceId: (active.binding?.workspaceId ?? areaProjects?.[group.id]?.workspaceId ?? group.project?.workspaceId)! }),
      bindingGeneration: active.bindingGeneration ?? 0,
      state: active.state,
      availability: sessionUnavailable ?? (editors.some(row => row.id === active.editorId && row.scope === active.editorScope)
        ? 'available' : 'unsupported'),
      lastKnownTitle: active.lastKnownTitle,
      ...(active.pendingBinding === undefined ? {} : { pendingBinding: active.pendingBinding }),
      ...(sessionUnavailable === undefined ? {} : { sessionUnavailable }),
    }

  const splitActive = (
    edge: Exclude<DropEdge, 'center'>,
    ratio = 0.5,
  ) => {
    /* v8 ignore next -- every split trigger is disabled or absent when the Area has no active editor. */
    if (active === undefined) return
    const rect = areaRef.current?.getBoundingClientRect()
    const extent = rect === undefined ? 0 : edge === 'left' || edge === 'right' ? rect.width : rect.height
    if (extent > 0 && !splitCanFit(
      extent,
      edge === 'left' || edge === 'right' ? EXPANDED_AREA_MIN_WIDTH : EXPANDED_AREA_MIN_HEIGHT,
    )) {
      reportStateFailure(edge === 'left' || edge === 'right'
        ? t('layout.tooNarrow')
        : t('layout.tooShort'))
      return
    }
    commit({
      type: 'duplicate-tab', tabId: active.id, newTabId: nextId('tab'),
      targetGroupId: group.id, edge,
      ids: { groupId: nextId('group'), splitId: nextId('split') },
      ratio,
    })
  }

  const openRelated = (
    editorId: 'workbench.conversation' | 'workbench.agent-trajectory',
    placement: 'current' | 'right',
  ) => {
    if (activeBinding === undefined) return
    const label = editorId === 'workbench.conversation'
      ? '对话' : 'Agent 轨迹'
    if (placement === 'current') {
      const existing = group.tabs.find(tab => tab.editorId === editorId
        && tab.binding?.workspaceId === activeBinding.workspaceId
        && tab.sessionId === activeBinding.sessionId)
      if (existing !== undefined) commit({ type: 'activate', groupId: group.id, tabId: existing.id })
      else {
        commit({
          type: 'add-tab', groupId: group.id,
          tab: createSessionTab(nextId('tab'), editorId, activeBinding, label),
        })
      }
      return
    }
    const tabId = nextId('tab')
    // `active` is the tab rendered by this Area. Use it as the source of
    // truth instead of the group object captured before the menu opened; the
    // placement repository may have committed a binding between renders.
    const previousActiveTabId = active?.id ?? group.activeTabId
    commit({
      type: 'add-tab', groupId: group.id,
      tab: createSessionTab(tabId, editorId, activeBinding, label),
    })
    // Moving the newly added tab removes it from the source group. Without
    // restoring the original active tab first, closeTab() exposes the older
    // Start tab in the source Area, making a right-hand Conversation split
    // look like it changed the original Area back to "新建对话".
    if (previousActiveTabId !== undefined) {
      commit({ type: 'activate', groupId: group.id, tabId: previousActiveTabId })
    }
    commit({
      type: 'move-tab', tabId, targetGroupId: group.id, edge: 'right',
      ids: { groupId: nextId('group'), splitId: nextId('split') }, ratio: 0.5,
    })
  }

  const ratioAt = (
    event: React.PointerEvent<HTMLDivElement>,
    edge: Exclude<DropEdge, 'center'>,
  ) => {
    const rect = bodyRef.current?.getBoundingClientRect()
    /* v8 ignore next -- the placement overlay and its area body are mounted together. */
    if (rect === undefined) return 0.5
    const pointerPosition = edge === 'left' || edge === 'right'
      ? (event.clientX - rect.left) / rect.width
      : (event.clientY - rect.top) / rect.height
    return insertedRatioAtPointer(edge, pointerPosition)
  }

  const startCornerGesture = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0 || active === undefined) return
    event.preventDefault()
    event.stopPropagation()
    gestureCleanupRef.current?.()
    const rect = bodyRef.current?.getBoundingClientRect()
    /* v8 ignore next -- the corner handle and its unconditional Area body mount and unmount together. */
    if (rect === undefined) return
    const handle = event.currentTarget
    const pointerId = event.pointerId
    try {
      handle.setPointerCapture(pointerId)
    } catch {
      // Window listeners keep the gesture usable in WebViews that reject pointer capture.
    }
    const start = { x: event.clientX, y: event.clientY }
    let preview: AreaGesture | undefined
    const setSplitCursor = (target: SplitTarget) => {
      globalThis.document.documentElement.dataset.workbenchSplitMode = splitCursorMode(target)
    }
    const clearSplitCursor = () => {
      globalThis.document.documentElement.removeAttribute('data-workbench-split-mode')
    }
    globalThis.document.documentElement.dataset.workbenchSplitMode = 'pending'
    const move = (moveEvent: PointerEvent) => {
      if (Math.hypot(moveEvent.clientX - start.x, moveEvent.clientY - start.y) < 9) return
      const hits = typeof globalThis.document.elementsFromPoint === 'function'
        ? globalThis.document.elementsFromPoint(moveEvent.clientX, moveEvent.clientY)
        : [globalThis.document.elementFromPoint(moveEvent.clientX, moveEvent.clientY)]
          .filter((row): row is Element => row !== null)
      const target = hits
        .map(element => element.closest<HTMLElement>('[data-workbench-group]'))
        .find((element): element is HTMLElement => element !== null)
      const targetGroupId = target?.dataset.workbenchGroup
      if (target !== undefined && targetGroupId !== undefined && targetGroupId !== group.id) {
        clearSplitCursor()
        const relation = siblingArea(document, group.id)
        if (relation?.group.id !== targetGroupId) {
          preview = {
            kind: 'invalid', message: t('layout.onlyAdjacent'),
            style: fixedPreviewStyle(target.getBoundingClientRect()),
          }
        } else if (!canMergeGroups(document, group.id, targetGroupId)) {
          preview = {
            kind: 'invalid', message: t('layout.cannotMergeDetails'),
            style: fixedPreviewStyle(target.getBoundingClientRect()),
          }
        } else {
          preview = {
            kind: 'join', targetGroupId, direction: relation.direction,
            style: fixedPreviewStyle(target.getBoundingClientRect()),
          }
        }
      } else {
        const inside = targetGroupId === group.id
          || (moveEvent.clientX >= rect.left && moveEvent.clientX <= rect.right
            && moveEvent.clientY >= rect.top && moveEvent.clientY <= rect.bottom)
        if (!inside) {
          clearSplitCursor()
          preview = { kind: 'invalid', message: t('layout.movePointer'), style: { inset: 0 } }
        } else {
          // The handle is only a drag affordance.  The final pointer position
          // determines the nearest edge of the Area, so the starting corner
          // and the path taken there cannot flip the requested split.
          const target = resolveSplitTarget(
            { width: rect.width, height: rect.height },
            { x: moveEvent.clientX - rect.left, y: moveEvent.clientY - rect.top },
            { minimumWidth: EXPANDED_AREA_MIN_WIDTH, minimumHeight: EXPANDED_AREA_MIN_HEIGHT, dividerSize: SPLIT_DIVIDER_SIZE },
          )
          setSplitCursor(target)
          if (target.kind === 'center') {
            preview = { kind: 'center', style: { inset: '20%' } }
            setGesture(preview)
            return
          }
          if (target.kind === 'invalid') {
            preview = {
              kind: 'invalid',
              message: 'Area is too small to split.',
              style: { inset: 0 },
            }
            setGesture(preview)
            return
          }
          const edge = target.edge
          const axis: SplitNode['axis'] = target.orientation === 'columns' ? 'horizontal' : 'vertical'
          if (!splitCanFit(
            axis === 'horizontal' ? rect.width : rect.height,
            axis === 'horizontal' ? EXPANDED_AREA_MIN_WIDTH : EXPANDED_AREA_MIN_HEIGHT,
          )) {
            preview = {
              kind: 'invalid',
              message: axis === 'horizontal'
                ? t('area.splitTooNarrow')
                : t('area.splitTooShort'),
              style: { inset: 0 },
            }
            setGesture(preview)
            return
          }
          const ratio = target.ratio
          preview = {
            kind: 'split', edge, orientation: target.orientation, ratio,
            style: splitPreviewStyle(edge, ratio),
          }
        }
      }
      setGesture(preview)
    }
    let cleaned = false
    const cleanup = () => {
      if (cleaned) return
      cleaned = true
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', cancel)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('contextmenu', onContextMenu)
      if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId)
      if (gestureCleanupRef.current === cleanup) gestureCleanupRef.current = undefined
      clearSplitCursor()
      setGesture(undefined)
    }
    const finish = () => {
      const result = preview
      cleanup()
      if (result?.kind === 'split') splitEmpty(group.id, result.edge, result.ratio)
      if (result?.kind === 'join') {
        commit({ type: 'merge-group', sourceGroupId: group.id, targetGroupId: result.targetGroupId })
      }
    }
    const cancel = () => { cleanup() }
    const onKey = (keyEvent: globalThis.KeyboardEvent) => {
      if (keyEvent.key === 'Escape') cleanup()
    }
    const onContextMenu = (contextEvent: MouseEvent) => {
      contextEvent.preventDefault()
      contextEvent.stopPropagation()
      cleanup()
    }
    gestureCleanupRef.current = cleanup
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', cancel)
    window.addEventListener('keydown', onKey)
    window.addEventListener('contextmenu', onContextMenu)
  }

  const startAreaMergeGesture = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return
    event.stopPropagation()
    gestureCleanupRef.current?.()
    const source = areaRef.current
    if (source === null) return
    const sourceRect = source.getBoundingClientRect()
    const handle = event.currentTarget
    const pointerId = event.pointerId
    const start = { x: event.clientX, y: event.clientY }
    let dragged = false
    let preview: AreaGesture | undefined
    let cleaned = false
    try {
      handle.setPointerCapture(pointerId)
    } catch {
      // Window listeners keep the gesture usable in WebViews that reject pointer capture.
    }
    const clearMergeCursor = () => {
      globalThis.document.documentElement.removeAttribute('data-workbench-area-merge-mode')
    }
    const deferClickReset = () => {
      globalThis.setTimeout(() => { suppressAreaMenuClickRef.current = false }, 0)
    }
    const move = (moveEvent: PointerEvent) => {
      if (!dragged && Math.hypot(moveEvent.clientX - start.x, moveEvent.clientY - start.y) < 9) return
      if (!dragged) {
        dragged = true
        suppressAreaMenuClickRef.current = true
        setMenu(undefined)
        setBindingOpen(false)
        setAreaMergeDragging(true)
        globalThis.document.documentElement.setAttribute('data-workbench-area-merge-mode', 'dragging')
      }
      const hits = typeof globalThis.document.elementsFromPoint === 'function'
        ? globalThis.document.elementsFromPoint(moveEvent.clientX, moveEvent.clientY)
        : [globalThis.document.elementFromPoint(moveEvent.clientX, moveEvent.clientY)]
          .filter((row): row is Element => row !== null)
      const target = hits
        .map(element => element.closest<HTMLElement>('[data-workbench-group]'))
        .find((element): element is HTMLElement => element !== null
          && element.dataset.workbenchGroup !== group.id)
      const targetGroupId = target?.dataset.workbenchGroup
      if (target === undefined || targetGroupId === undefined) {
        preview = {
          kind: 'invalid',
          message: t('layout.mergeDrop'),
          style: fixedPreviewStyle(sourceRect),
        }
      } else {
        const targetRect = target.getBoundingClientRect()
        preview = canMergeGroups(document, group.id, targetGroupId)
          ? {
              kind: 'join',
              targetGroupId,
              direction: mergeDirectionBetween(sourceRect, targetRect),
              style: fixedPreviewStyle(targetRect),
            }
          : {
              kind: 'invalid',
              message: t('layout.cannotMergeDetails'),
              style: fixedPreviewStyle(targetRect),
            }
      }
      setGesture(preview)
    }
    const cleanup = () => {
      if (cleaned) return
      cleaned = true
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', cancel)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('contextmenu', onContextMenu)
      if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId)
      if (gestureCleanupRef.current === cleanup) gestureCleanupRef.current = undefined
      clearMergeCursor()
      setAreaMergeDragging(false)
      setGesture(undefined)
    }
    const finish = () => {
      const result = preview
      const didDrag = dragged
      cleanup()
      if (didDrag) deferClickReset()
      if (result?.kind === 'join') {
        commit({ type: 'merge-group', sourceGroupId: group.id, targetGroupId: result.targetGroupId })
      }
    }
    const cancel = () => {
      const didDrag = dragged
      cleanup()
      if (didDrag) deferClickReset()
    }
    const onKey = (keyEvent: globalThis.KeyboardEvent) => {
      if (keyEvent.key === 'Escape') cancel()
    }
    const onContextMenu = (contextEvent: MouseEvent) => {
      contextEvent.preventDefault()
      contextEvent.stopPropagation()
      cancel()
    }
    gestureCleanupRef.current = cleanup
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', cancel)
    window.addEventListener('keydown', onKey)
    window.addEventListener('contextmenu', onContextMenu)
  }

  return (
    <section
      ref={areaRef}
      className={css.group + ' ' + accentFrameCss.frame}
      data-session-frame={areaMarker ? 'area' : undefined}
      data-accent={areaMarker?.accentToken}
      data-layout-locked={props.layoutLocked ? 'true' : undefined}
      data-active={document.activeGroupId === group.id || undefined}
      data-area-collapsed={areaCollapsed || undefined}
      data-collapse-edge={collapseEdge}
      data-area-menu-open={menu !== undefined || undefined}
      data-workbench-group={group.id}
      data-workbench-area-merge-source={areaMergeDragging || undefined}
      onFocusCapture={() => {
        if (floating && (active?.editorId === 'workbench.conversation' || active?.editorId === 'workbench.conversation.start')) { floating.focusedWorkbenchId = workbenchId; floating.focusedBinding = targetBinding; floating.invalidate() }
      }}
      onPointerDown={() => {
        if (floating && (active?.editorId === 'workbench.conversation' || active?.editorId === 'workbench.conversation.start')) { floating.focusedWorkbenchId = workbenchId; floating.focusedBinding = targetBinding; floating.invalidate() }
        if (active !== undefined) commit({ type: 'activate', groupId: group.id, tabId: active.id })
      }}
    >
      <header className={css.areaHeader} data-workbench-area-header>
        <div ref={areaTabStripRef} className={css.areaTabStrip} data-workbench-area-tab-strip>
          <button
            type="button"
            className={css.areaTabScroll}
            aria-label={t('page.scrollLeft')}
            title={t('page.scrollLeft')}
            disabled={!tabStripOverflow.left}
            data-direction="left"
            onClick={(event) => { event.stopPropagation(); scrollTabs(-1) }}
          ><IconChevronLeftOutlineMedium size={15} /></button>
          <div ref={areaTabsRef} className={css.areaTabs} role="tablist" aria-orientation={tabStripVertical ? 'vertical' : 'horizontal'} aria-label={t('page.tabs')} data-workbench-area-tabs>
          {tabRows.rows.map(({ tab, summary, presentation: tabPresentation }) => {
            const selected = summary.selected
            return <div className={css.areaTab} data-workbench-area-tab={tab.id} data-active={selected || undefined} key={tab.id}>
              <WorkbenchTabTooltip summary={summary} side={floatingMenuSide} disabled={menu !== undefined || tabOverviewOpen}>
              <button ref={selected ? editorTriggerRef : undefined} type="button" role="tab" aria-selected={selected}
                aria-controls={`workbench-area-body-${group.id}`} tabIndex={selected ? 0 : -1}
                className={css.areaTabSelect} data-workbench-active-tab={selected || undefined}
                aria-haspopup={selected ? 'menu' : undefined} aria-expanded={selected ? menu === 'editor' : undefined}
                aria-label={t(selected ? 'page.activeTab' : 'page.switchTab', { name: summary.title })}
                aria-description={[summary.information?.detail, summary.statusLabel].filter(Boolean).join(' · ')}
                onClick={(event) => {
                  event.stopPropagation()
                  if (areaCollapsed) {
                    if (!selected) commit({ type: 'activate', groupId: group.id, tabId: tab.id })
                    toggleAreaCollapsed(group.id)
                  }
                  else if (selected) {
                    editorMenuAnchorRef.current = event.currentTarget
                    setEditorMenuMode('replace')
                    setMenu(value => value === 'editor' ? undefined : 'editor')
                  }
                  else commit({ type: 'activate', groupId: group.id, tabId: tab.id })
                }}
                onKeyDown={(event) => {
                  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
                  event.preventDefault(); const index = group.tabs.findIndex(item => item.id === tab.id)
                  const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? group.tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + group.tabs.length) % group.tabs.length
                  const next = group.tabs[nextIndex]; if (next !== undefined) { commit({ type: 'activate', groupId: group.id, tabId: next.id }); requestAnimationFrame(() => findAreaTabElement(areaRef.current, next.id)?.querySelector<HTMLButtonElement>('[role="tab"]')?.focus()) }
                }}>
                <span className={css.editorGlyph} data-editor-icon={tabPresentation.icon}><EditorIcon name={tabPresentation.icon} iconSvg={tabPresentation.iconSvg} /></span>
                <WorkbenchTabStatus summary={summary} />
                <WorkbenchAreaTabLabel tab={tab} fallback={summary.title} fontSize={tabFontSize} />
              </button>
              </WorkbenchTabTooltip>
              <button type="button" className={css.areaTabDetach} aria-label={t('page.detachTab', { name: summary.title })} title={t('page.detachArea')} onClick={(event) => { event.stopPropagation(); commit({ type: 'move-tab', tabId: tab.id, targetGroupId: group.id, edge: 'right', ids: { groupId: nextId('group'), splitId: nextId('split') } }) }}><IconCompareSplitOutlineMedium size={14} /></button>
              {interactionPolicy.showTabCloseButtons !== false ? <button type="button" className={css.areaTabClose} aria-label={t('page.closeTab', { name: summary.title })} title={t('page.closeTab', { name: summary.title })} onClick={(event) => { event.stopPropagation(); commit({ type: 'close-tab', tabId: tab.id }) }}><IconCloseOutlineMedium size={14} /></button> : null}
            </div>
          })}
          </div>
          {group.tabs.length === 0 ? <span className={css.areaTabsEmpty}>{t('page.area', { index: areaOrdinal })}</span> : null}
          <button
            type="button"
            className={css.areaTabAdd}
            data-workbench-editor-add-trigger="true"
            aria-label={t('page.addTab')}
            title={t('page.addTab')}
            aria-haspopup="menu"
            aria-expanded={menu === 'editor'}
            onClick={(event) => {
              event.stopPropagation()
              editorMenuAnchorRef.current = event.currentTarget
              setEditorMenuMode('add')
              setTabOverviewOpen(false)
              setMenu(value => value === 'editor' ? undefined : 'editor')
            }}
          ><IconPlusOutlineMedium size={16} /></button>
          <button
            type="button"
            className={css.areaTabScroll}
            aria-label={t('page.scrollRight')}
            title={t('page.scrollRight')}
            disabled={!tabStripOverflow.right}
            data-direction="right"
            onClick={(event) => { event.stopPropagation(); scrollTabs(1) }}
          ><IconChevronRightOutlineMedium size={15} /></button>
        </div>
        {tabOverviewOpen ? (
          <WorkbenchFloatingMenu kind="editor" ownerId={`${group.id}:tab-overview`} anchorRef={tabOverviewAnchorRef} surfaceRef={tabOverviewSurfaceRef} side={floatingMenuSide} align="end" className={css.tabOverviewMenu} label={t('page.all')}>
            <label className={css.tabOverviewSearch}>
              <span className={css.visuallyHidden}>{t('page.search')}</span>
              <input autoFocus value={tabOverviewQuery} onChange={(event) => setTabOverviewQuery(event.target.value)} placeholder={t('page.searchDetails')} />
            </label>
            <div className={css.tabOverviewList} role="listbox" aria-label={t('page.all')}>
              {filteredTabSummaries.length === 0 ? <span className={css.tabOverviewEmpty}>{t('page.noMatches')}</span> : filteredTabSummaries.map(summary => <WorkbenchTabTooltip key={summary.id} summary={summary}><button
                type="button"
                role="option"
                aria-selected={summary.selected}
                className={css.tabOverviewItem}
                data-selected={summary.selected || undefined}
                onClick={() => {
                  commit({ type: 'activate', groupId: group.id, tabId: summary.id })
                  setTabOverviewOpen(false)
                }}
              >
                <WorkbenchTabStatus summary={summary} />
                <span className={css.editorOptionIcon} data-editor-icon={summary.icon}><EditorIcon name={summary.icon} iconSvg={summary.iconSvg} /></span>
                <span className={css.tabOverviewItemTitle}>{summary.title}{summary.information?.detail ? <small>{summary.information.detail}</small> : null}</span>
                <small>{summary.statusLabel}</small>
              </button></WorkbenchTabTooltip>)}
            </div>
          </WorkbenchFloatingMenu>
        ) : null}
        {menu === 'editor' ? (
          <WorkbenchFloatingMenu kind="editor" ownerId={group.id} anchorRef={editorMenuAnchorRef} surfaceRef={editorMenuSurfaceRef} side={floatingMenuSide} align="start" className={css.editorMenu}>
            <WorkbenchEditorPicker key={editorMenuMode} editors={selectableEditors} mode={editorMenuMode} preferences={props.editorMenu}
              onSelect={editor => editorMenuMode === 'replace' ? replaceEditor(editor) : addEditor(editor)} />
          </WorkbenchFloatingMenu>
        ) : null}
        {project ? <button className={css.areaTabOverviewTrigger} type="button" title={projectOverviewLabel} aria-label={projectOverviewLabel} aria-pressed={active === undefined || projectOverviewOpen} data-active={active === undefined || projectOverviewOpen || undefined} onClick={() => setProjectOverviewOpen(value => !value)}><IconFolderOpenOutlineMedium size={14} /><span className={css.areaTabOverviewLabel}>{t('project.overview')}</span></button> : null}
        {areaProjects !== undefined ? <AreaProjectButton relativePath={areaProjects[group.id]?.relativePath} onClick={() => editAreaProject?.(group.id)} /> : null}
        {activePendingSession ? (
          <PendingSessionBindingPicker
            key={active?.id}
            sessionRows={sessionRows}
            sessionIds={pickerSessionIds}
            sessionMarkers={areaSessionMarkers}
            sessionMarkersByWorkspace={sessionMarkersByWorkspace}
            workspaces={pickerWorkspaces}
            archivedSessionIds={archivedSessionIds}
            open={bindingOpen}
            {...(areaProjects === undefined ? {} : { emptyMessage: areaProjects[group.id]
              ? t('binding.emptyProject')
              : t('binding.setProjectFirst') })}
            setOpen={(open) => { setBindingOpen(open); if (open) setMenu(undefined) }}
            onSelect={(binding) => {
              if (active) commit({ type: 'retarget-session', tabId: active.id, binding })
              setBindingOpen(false)
            }}
          />
        ) : activeBinding !== undefined && resolvedActive !== undefined ? (
          <SessionBindingChip
            binding={activeBinding}
            resolved={resolvedActive}
            marker={areaMarker!}
            sessionRows={sessionRows}
            sessionMarkers={areaSessionMarkers}
            sessionMarkersByWorkspace={sessionMarkersByWorkspace}
            sessionIds={pickerSessionIds}
            workspaces={pickerWorkspaces}
            workspaceTitle={areaWorkspaceTitle}
            archivedSessionIds={archivedSessionIds}
            open={bindingOpen}
            setOpen={(open) => { setBindingOpen(open); if (open) setMenu(undefined) }}
            onSelect={(binding) => {
              if (active?.editorScope === 'session') commit({ type: 'retarget-session', tabId: active.id, binding })
            }}
            onOpenExternal={(binding) => {
              if (projectNeutral && active !== undefined) {
                commit({ type: 'retarget-session', tabId: active.id, binding })
              } else openExternalSession(binding)
            }}
            updateMarker={(marker) => {
              updateSessionMarker(activeBinding.workspaceId, activeBinding.sessionId, marker)
            }}
          />
        ) : null}
        <div className={css.areaActions} data-area-actions>
          {group.tabs.length > 0 ? <button
            ref={tabOverviewTriggerRef}
            type="button"
            className={css.areaTabOverviewTrigger}
            data-workbench-tab-overview-trigger="true"
            aria-label={t('layout.listAllPages', { count: group.tabs.length })}
            title={t('page.showAll')}
            aria-haspopup="menu"
            aria-expanded={tabOverviewOpen}
            onClick={(event) => {
              event.stopPropagation()
              tabOverviewAnchorRef.current = event.currentTarget
              setMenu(undefined)
              setTabOverviewQuery('')
              setTabOverviewOpen(value => !value)
            }}
          ><IconFlatListOutlineMedium size={15} /><span className={css.areaTabOverviewCount}>{group.tabs.length}</span></button> : null}
          {collapseEdge === undefined ? null : <button
            ref={collapseTriggerRef}
            type="button"
            className={css.iconButton}
            aria-label={collapseLabel}
            aria-describedby={collapsePreviewOpen ? collapsePreviewId : undefined}
            title={areaCollapsed ? undefined : collapseLabel}
            disabled={!canCollapse}
            aria-expanded={!areaCollapsed}
            aria-controls={`workbench-area-body-${group.id}`}
            data-area-collapse-toggle="true"
            onPointerEnter={showCollapsePreview}
            onPointerLeave={hideCollapsePreview}
            onFocus={() => { if (areaCollapsed) keepCollapsePreview() }}
            onBlur={hideCollapsePreview}
            onClick={(event) => {
              event.stopPropagation()
              hideCollapsePreview()
              toggleAreaCollapsed(group.id)
            }}
          ><AreaCollapseIcon direction={areaCollapsed
              ? collapseEdge === 'left' ? 'right'
                : collapseEdge === 'right' ? 'left'
                  : collapseEdge === 'up' ? 'down' : 'up'
              : collapseEdge}
            /></button>}
          {areaCollapsed && collapseEdge !== undefined ? (
            <WorkbenchFloatingInfo
              anchorRef={collapseTriggerRef}
              id={collapsePreviewId}
              ownerId={group.id}
              side={floatingMenuSide}
              open={collapsePreviewOpen}
              icon={activePresentation.icon} iconSvg={activePresentation.iconSvg}
              title={collapsePreviewTitle}
              detail={collapsePreviewSummary}
              tabs={tabSummaries.slice(0, 6)}
              onExpand={() => {
                setCollapsePreviewOpen(false)
                toggleAreaCollapsed(group.id)
              }}
              onActivate={(tabId) => {
                setCollapsePreviewOpen(false)
                toggleAreaCollapsed(group.id)
                commit({ type: 'activate', groupId: group.id, tabId })
              }}
              onPointerEnter={keepCollapsePreview}
              onPointerLeave={hideCollapsePreview}
            />
          ) : null}
          <button
            ref={areaMenuTriggerRef}
            type="button"
            className={css.iconButton}
            aria-label={t('area.actions')}
            title={t('area.actionsHint')}
            aria-haspopup="menu"
            aria-expanded={menu === 'area' || menu === 'editor' && editorMenuAnchorRef.current === areaMenuTriggerRef.current || tabOverviewOpen && tabOverviewAnchorRef.current === areaMenuTriggerRef.current}
            data-area-merge-drag-handle="true"
            onPointerDown={startAreaMergeGesture}
            onClick={(event) => {
              event.stopPropagation()
              if (suppressAreaMenuClickRef.current) {
                suppressAreaMenuClickRef.current = false
                event.preventDefault()
                return
              }
              setMenu(value => value === 'area' ? undefined : 'area')
            }}
          ><IconEllipsisOutlineMedium size={16} /></button>
          {menu === 'area' ? (
            <AreaMenu
              anchorRef={areaMenuTriggerRef}
              surfaceRef={areaMenuSurfaceRef}
              side={floatingMenuSide}
              align={areaCollapsed ? 'start' : 'end'}
              active={active} group={group} sibling={sibling}
              activeTask={props.activeBayAgentAreaIds.has(group.id)} canCloseArea={true}
              document={document}
              commit={commit} close={() => { setMenu(undefined) }}
              addPage={() => {
                editorMenuAnchorRef.current = areaMenuTriggerRef.current
                setTabOverviewOpen(false)
                setEditorMenuMode('add')
                setMenu('editor')
              }}
              showPages={() => {
                tabOverviewAnchorRef.current = areaMenuTriggerRef.current
                setMenu(undefined)
                setTabOverviewQuery('')
                setTabOverviewOpen(true)
              }}
              {...(editAreaProject === undefined ? {} : { editProject: () => editAreaProject(group.id) })}
              {...(collapseEdge === undefined ? {} : { toggleCollapse: () => toggleAreaCollapsed(group.id), canCollapse, collapseLabel })}
              requestSplit={(axis) => {
                setMenu(undefined)
                /* v8 ignore next -- AreaMenu disables split actions without an active tab. */
                if (active !== undefined) requestSplitPlacement(
                  group.id,
                  active.id,
                  axis === 'horizontal' ? 'right' : 'bottom',
                )
              }}
              splitActive={splitActive}
              {...(openOfficialSession === undefined || activeBinding === undefined ? {} : {
                openOfficial: () => {
                  void openOfficialSession(group.id, activeBinding.sessionId, areaClaim)
                    .catch(error => reportStateFailure(error instanceof Error ? error.message : t('layout.openOriginalFailed')))
                },
              })}
              {...(activeBinding === undefined ? {} : { openRelated })}
            />
          ) : null}
        </div>
      </header>
      <div ref={bodyRef} id={`workbench-area-body-${group.id}`} className={css.body} data-workbench-body>
        {project && props.directory && (active === undefined || projectOverviewOpen) ? <WorkbenchProjectOverview project={project} directory={props.directory} workbenchId={workbenchId} tasks={props.bayAgentSnapshot} controller={props.bayAgentController} writable={props.layoutActionsEnabled} onEditBackground={editAreaBackground ? () => editAreaBackground(group.id) : undefined}
          onAddPage={() => { setProjectOverviewOpen(false); editorMenuAnchorRef.current = emptyEditorTriggerRef.current ?? areaMenuTriggerRef.current; setEditorMenuMode('add'); setMenu('editor') }}
          onOpenSession={session => { const binding = { sessionId: session.sessionId!, ...(project.workspaceId ? { workspaceId: project.workspaceId } : {}) }; const existing = group.tabs.find(tab => tab.binding?.sessionId === binding.sessionId && tab.editorId === 'workbench.conversation'); if (existing) commit({ type: 'activate', groupId: group.id, tabId: existing.id }); else commit({ type: 'add-tab', groupId: group.id, tab: createSessionTab(nextId('tab'), 'workbench.conversation', binding, sessionRows[binding.sessionId]?.displayTitle ?? session.title) }); setProjectOverviewOpen(false) }} /> : active === undefined ? (
          <WorkbenchEmptyArea editors={selectableEditors} context={{ hasWorkspace, hasSession }} onSelect={addEditor} triggerRef={emptyEditorTriggerRef} expanded={menu === 'editor'}
            onSetProject={editAreaProject === undefined ? undefined : () => editAreaProject(group.id)}
            onManage={props.onManageEditors}
            onBrowse={anchor => { editorMenuAnchorRef.current = anchor; setEditorMenuMode('add'); setMenu(value => value === 'editor' ? undefined : 'editor') }} />
        ) : disposeWhenCollapsed ? (
          <div className={css.empty} data-workbench-editor-suspended="collapsed" role="status">
            <strong>{active ? workbenchPageTitle(t, active.editorId, active.lastKnownTitle) : t('layout.currentPage')}{t('tab.paused')}</strong>
            <span>{t('area.expandThisAreaToResumeItsPage')}</span>
          </div>
        ) : (
          <AreaEditorTarget id={active.id}><MemoizedEditor
            workbenchId={workbenchId}
            collaborationClient={collaborationClient}
            projection={areaContentProjection!}
            commands={areaContentCommands!}
            tab={active} renderSlot={renderSlot}
            runtimeMetrics={props.runtimeMetrics}
            editorAvailable={editors.some(row => row.id === active.editorId && row.scope === active.editorScope)}
            editors={editors}
            extensionAccess={props.extensionAccess}
            editor={activeEditor}
            {...(sessionUnavailable === undefined ? {} : { sessionUnavailable })}
            areaClaim={areaClaim}
            lifecycle={editorLifecycle}
          /></AreaEditorTarget>
        )}
        {/*
         * Kept as a non-visual compatibility seam for older automated tests and
         * integrations.  The product UI no longer exposes corner controls; all
         * user-facing splitting starts from the Area menu or a shared divider.
         */}
        <button
          className={[css.cornerHandle, css.topRight, css.legacyCornerHandle].join(' ')}
          data-corner="top-right"
          type="button"
          aria-hidden="true"
          tabIndex={-1}
          aria-label={t('area.dragTheTopRightCornerToSplit')}
          title={t('area.dragToSplitOrMerge')}
          onPointerDown={startCornerGesture}
        />
        <button
          className={[css.cornerHandle, css.bottomLeft, css.legacyCornerHandle].join(' ')}
          data-corner="bottom-left"
          type="button"
          aria-hidden="true"
          tabIndex={-1}
          aria-label={t('area.dragTheBottomLeftCornerToSplit')}
          title={t('area.dragToSplitOrMerge')}
          onPointerDown={startCornerGesture}
        />
        {areaCollapsed || gesture === undefined ? null : <GesturePreview gesture={gesture} />}
        {splitPlacement === undefined ? null : (
          <div
            className={css.splitPlacement}
            data-active={splitPlacement.targetGroupId === group.id || undefined}
            data-split-target-area-id={group.id}
            role={splitPlacement.targetGroupId === group.id ? 'application' : undefined}
            aria-label={splitPlacement.targetGroupId === group.id
              ? splitPlacement.edge === 'left' || splitPlacement.edge === 'right'
                ? t('layout.chooseColumnPosition') : t('layout.chooseRowPosition')
              : undefined}
            onPointerMove={(event) => {
              updateSplitPlacement({
                ...splitPlacement,
                targetGroupId: group.id,
                ratio: ratioAt(event, splitPlacement.edge),
              })
            }}
            onPointerDown={(event) => {
              event.preventDefault()
              event.stopPropagation()
              if (event.button !== 0) {
                cancelSplitPlacement()
                return
              }
              confirmSplitPlacement({
                ...splitPlacement,
                targetGroupId: group.id,
                ratio: ratioAt(event, splitPlacement.edge),
              })
            }}
            onContextMenu={(event) => {
              event.preventDefault()
              event.stopPropagation()
              cancelSplitPlacement()
            }}
          >
            {splitPlacement.targetGroupId === group.id ? (
              <>
                <SplitRegionPreview
                  source="placement"
                  region="retained"
                  edge={splitPlacement.edge}
                  style={splitRetainedPreviewStyle(
                    splitPlacement.edge,
                    splitPlacement.ratio,
                  )}
                />
                <SplitRegionPreview
                  source="placement"
                  region="new"
                  edge={splitPlacement.edge}
                  style={splitPreviewStyle(
                    splitPlacement.edge,
                    splitPlacement.ratio,
                  )}
                />
              </>
            ) : null}
          </div>
        )}
      </div>
      {/* A collapsed Area hides its body, but its drag-to-merge feedback must
          remain mounted. Fixed merge previews can safely live at Area level. */}
      {!areaCollapsed || gesture === undefined ? null : <GesturePreview gesture={gesture} />}
    </section>
  )
}

function WorkbenchAreaTabLabel({ tab, fallback, fontSize }: { tab: TabDocument; fallback: string; fontSize: number }) {
  const runtime = useFloatingWorkspace()
  const identity = runtime?.visibleWorkbenchId ? floatingInstanceKey(runtime.visibleWorkbenchId, tab.id) : tab.id
  const renderNativeTitle = useSyncExternalStore(
    subscribeWorkbenchNativeTabTitles,
    () => getWorkbenchNativeTabTitle(identity),
    () => getWorkbenchNativeTabTitle(identity),
  )
  const nativeTitle = renderNativeTitle?.()
  return <span className={css.areaTabLabel} style={{ fontSize: `${fontSize}px` }}>{nativeTitle ?? fallback}</span>
}

function AreaMenu({
  anchorRef, surfaceRef, side, align, active, activeTask, canCloseArea, group, sibling, document, commit, close, requestSplit, splitActive, openRelated, openOfficial, addPage, showPages, editProject, toggleCollapse, canCollapse, collapseLabel,
}: {
  anchorRef: RefObject<HTMLElement>
  surfaceRef: RefObject<HTMLDivElement>
  side: FloatingMenuSide
  align: 'start' | 'end'
  active: TabDocument | undefined
  activeTask: boolean
  canCloseArea: boolean
  group: GroupNode
  sibling: SiblingArea | undefined
  document: WorkbenchLayoutDocument
  commit: Commit
  close: () => void
  addPage: () => void
  showPages: () => void
  editProject?: () => void
  toggleCollapse?: () => void
  canCollapse?: boolean
  collapseLabel?: string
  requestSplit: (axis: SplitNode['axis']) => void
  splitActive: (edge: Exclude<DropEdge, 'center'>, ratio?: number) => void
  openOfficial?: () => void
  openRelated?: (
    editorId: 'workbench.conversation' | 'workbench.agent-trajectory',
    placement: 'current' | 'right',
  ) => void
}) {
  const { t } = useWorkbenchLocale()
  const run = (command: LayoutCommand) => { commit(command); close() }
  const canMerge = sibling === undefined ? false : canMergeGroups(document, group.id, sibling.group.id)
  return (
    <WorkbenchFloatingMenu
      kind="area"
      ownerId={group.id}
      anchorRef={anchorRef}
      surfaceRef={surfaceRef}
      side={side}
      align={align}
      className={css.areaMenu}
    >
      <button role="menuitem" onClick={addPage}>{t('page.add')}</button>
      <button role="menuitem" disabled={group.tabs.length === 0} onClick={showPages}>{t('page.showAll')}</button>
      {editProject === undefined ? null : <button role="menuitem" onClick={() => { editProject(); close() }}>{t('project.setFolder')}</button>}
      {toggleCollapse === undefined ? null : <button role="menuitem" disabled={!canCollapse} onClick={() => { toggleCollapse(); close() }}>{collapseLabel}</button>}
      <div className={css.menuDivider} />
      <button role="menuitem" disabled={active === undefined} onClick={() => {
        if (active !== undefined) run({ type: 'move-tab', tabId: active.id, targetGroupId: group.id, edge: 'right', ids: { groupId: nextId('group'), splitId: nextId('split') } })
      }}>{t('area.detachCurrent')}</button>
      {openOfficial === undefined ? null : <button role="menuitem" onClick={() => { openOfficial(); close() }}>{t('area.openOfficial')}</button>}
      {openRelated === undefined ? null : (
        <>
          <button role="menuitem" onClick={() => { openRelated('workbench.conversation', 'current'); close() }}>
            {t('area.openConversationHere')}
          </button>
          <button role="menuitem" onClick={() => { openRelated('workbench.conversation', 'right'); close() }}>
            {t('area.openConversationRight')}
          </button>
          <button role="menuitem" onClick={() => { openRelated('workbench.agent-trajectory', 'right'); close() }}>
            {t('area.openTraceRight')}
          </button>
          <div className={css.menuDivider} />
        </>
      )}
      <button role="menuitem" disabled={active === undefined} onClick={() => { requestSplit('horizontal') }}>
        {t('area.splitHorizontal')}
      </button>
      <button role="menuitem" disabled={active === undefined} onClick={() => { requestSplit('vertical') }}>
        {t('area.splitVertical')}
      </button>
      <button role="menuitem" disabled={active === undefined} onClick={() => {
        splitActive('right')
        close()
      }}>{t('area.copyRight')}</button>
      {sibling === undefined ? null : (
        <>
          <div className={css.menuDivider} />
          <button role="menuitem" disabled={!canMerge} title={canMerge ? undefined : t('area.mergeBlocked')} onClick={() => {
            run({ type: 'merge-group', sourceGroupId: group.id, targetGroupId: sibling.group.id })
          }}>{t(`area.merge.${sibling.direction}`)}</button>
          <button role="menuitem" onClick={() => {
            run({ type: 'swap-groups', firstGroupId: group.id, secondGroupId: sibling.group.id })
          }}>{t('area.swap')}</button>
        </>
      )}
      <div className={css.menuDivider} />
      <button role="menuitem" disabled={!canCloseArea || activeTask} title={activeTask ? t('area.closeTask') : !canCloseArea ? t('area.closeBlocked') : undefined} onClick={() => run({ type: 'close-area', areaId: group.id })}>
        {t('area.close')}
      </button>
      <button role="menuitem" disabled={active === undefined} onClick={() => {
        /* v8 ignore next -- the button is disabled when no active editor exists. */
        if (active !== undefined) run({ type: 'close-tab', tabId: active.id })
      }}>{t('area.closeView')}</button>
      <span className={css.menuHint}>{t('area.closeHint')}</span>
    </WorkbenchFloatingMenu>
  )
}

function GesturePreview({ gesture }: { gesture: AreaGesture }) {
  const { t } = useWorkbenchLocale()
  if (gesture.kind === 'split') {
    return <SplitRegionPreview source="gesture" edge={gesture.edge} style={gesture.style} />
  }
  if (gesture.kind === 'center') return <CenterRegionPreview />
  if (gesture.kind === 'join') {
    return <JoinRegionPreview direction={gesture.direction} style={gesture.style} />
  }
  return (
    <div
      className={[css.gesturePreview, css.invalidPreview].join(' ')}
      style={gesture.style}
      data-workbench-gesture-preview="invalid"
    >
      <strong>{t('area.actionUnavailable')}</strong>
      <span>{gesture.message}</span>
    </div>
  )
}

/** Track the Core outlet only after pending/unavailable guards have passed. */
function MountedEditorOutlet({ metrics, children }: {
  metrics: WorkbenchRuntimeMetricsSinkV1 | undefined
  children: ReactNode
}) {
  useEffect(() => {
    const release = metrics?.mountEditorOutlet()
    recordAreaContentMount(true)
    return () => {
      release?.()
      recordAreaContentMount(false)
    }
  }, [metrics])
  return <>{children}</>
}

export interface EditorPropsV1 {
  workbenchId: string
  collaborationClient?: WorkbenchCollaborationClientV1 | undefined
  projection: AreaContentProjectionV1
  commands: AreaContentCommandFacadeV1
  tab: TabDocument
  renderSlot: RenderSlot
  editorAvailable: boolean
  editors: readonly import('./catalog.ts').WorkbenchEditorCatalogRow[]
  extensionAccess?: WorkbenchExtensionAccessSnapshotV1 | undefined
  editor: import('./catalog.ts').WorkbenchEditorCatalogRow | undefined
  sessionUnavailable?: 'archived' | 'missing' | 'moved'
  areaClaim: string
  lifecycle: {
    visibility: 'visible' | 'background' | 'collapsed'
    focused: boolean
    background?: 'keep' | 'pause' | 'dispose'
    collapsed?: 'keep' | 'pause' | 'dispose'
  }
  runtimeMetrics?: WorkbenchRuntimeMetricsSinkV1 | undefined
}

function Editor({
  workbenchId, collaborationClient, projection, commands, tab: suppliedTab, renderSlot, editorAvailable, editors, extensionAccess, editor, sessionUnavailable,
  areaClaim, lifecycle, runtimeMetrics,
}: EditorPropsV1) {
  const { t } = useWorkbenchLocale()
  const floating = useFloatingWorkspace()
  useSyncExternalStore(floating?.subscribe ?? (() => () => {}), floating?.getSnapshot ?? (() => 0), () => 0)
  const managed = floating?.find(suppliedTab.id, workbenchId)
  const tab = managed?.tab ?? suppliedTab
  const sourceEpoch = floating?.epoch
  const placementGeneration = managed?.generation
  const actionable = (automatic = false) => !floating || floating.enabled && floating.epoch === sourceEpoch && (automatic || floating.visibleWorkbenchId === workbenchId)
    && floating.hasControl?.(workbenchId) !== false
    && floating.canUseEditor?.(workbenchId, tab.editorId) !== false
    && (!managed || floating.find(tab.id, workbenchId) === managed && managed.generation === placementGeneration && !managed.busy
      && managed.tab.bindingGeneration === tab.bindingGeneration)
  const effectiveLifecycle = managed && (!floating?.enabled || floating.visibleWorkbenchId !== workbenchId || !managed.target)
    ? { ...lifecycle, visibility: 'background' as const, focused: false } : lifecycle
  useEffect(() => {
    if (!managed?.pendingState || managed.location !== 'area' || !actionable() || effectiveLifecycle.visibility !== 'visible') return
    const accepted = commands.commit({ type: 'update-tab-state', tabId: tab.id, state: tab.state, bindingGeneration: tab.bindingGeneration ?? 0 })
    if (accepted !== false && managed.tab.state === tab.state) managed.pendingState = false
  }, [managed, tab.state, tab.bindingGeneration, commands, effectiveLifecycle.visibility, sourceEpoch, floating?.visibleWorkbenchId, managed?.busy])
  const workspaceId = tab.binding?.workspaceId ?? (tab.editorId === 'workbench.conversation.start' ? projection.workspaceId : undefined)
  const persistedStateFailure = editor?.extension === undefined || editor.declaration === undefined
    ? undefined
    : workbenchEditorStateFailureV1(tab.state, editor.declaration)
  const props = {
    presentation: managed?.location ?? 'area' as const,
    ...(managed ? { runtimeIdentity: floatingInstanceKey(workbenchId, tab.id), registerCloseGuard: (guard: () => boolean | Promise<boolean>) => floating!.registerCloseGuard(tab.id, guard, workbenchId) } : {}),
    instanceId: tab.id,
    workbenchId,
    collaborationClient,
    areaId: projection.areaId,
    ...(projection.projectId ? { projectId: projection.projectId } : {}),
    areaClaim,
    ...(tab.sessionId === undefined ? {} : { sessionId: tab.sessionId }),
    ...(workspaceId === undefined ? {} : { workspaceId }),
    bindingGeneration: tab.bindingGeneration ?? 0,
    state: persistedStateFailure === undefined ? tab.state : {},
    lifecycle: effectiveLifecycle,
    ...(editor?.declaration === undefined ? {} : { declaration: editor.declaration }),
    renderLoading: (options?: { label?: string; compact?: boolean }) => <WorkbenchPageLoading label={workbenchPageTitle(t, tab.editorId, options?.label ?? editor?.label ?? tab.lastKnownTitle)} icon={editor?.icon ?? 'extension'} compact={options?.compact ?? false} />,
    ...(commands.placeConversation === undefined ? {} : { placeConversation: (input: Parameters<NonNullable<typeof commands.placeConversation>>[0]) => {
      if (!actionable()) return Promise.reject(new Error(t('layout.sourceNoLongerAvailable')))
      return commands.placeConversation!(input)
    } }),
    ...(commands.completePreparedConversation === undefined ? {} : { completePreparedConversation: (input: Parameters<NonNullable<typeof commands.completePreparedConversation>>[0]) => actionable(true) && commands.completePreparedConversation!(input) }),
    ...(commands.openSession === undefined ? {} : { openSession: (id: string) => actionable() ? commands.openSession!(id) : Promise.reject(new Error(t('layout.sourceWorkbenchGone'))) }),
    openNativeTab: (kind: string, options?: Record<string, unknown>) => {
      if (!actionable(options?.trigger === 'automatic')) return false
      const request = { floating: true, ...options, sourceEpoch, sourceGeneration: tab.bindingGeneration ?? 0, sourceLocationGeneration: placementGeneration }
      return floating && managed ? floating.route?.({ workbenchId, kind, options: request, ...(tab.binding ? { binding: tab.binding } : {}), sourceId: tab.id }) ?? false : commands.openNativeTab(kind, request)
    },
    openConversationResource: (...args: Parameters<typeof commands.openConversationResource>) => {
      const automatic = args[1]?.trigger === 'automatic'
      if (!actionable(automatic)) return 'rejected' as const
      if (automatic && floating && managed) return routeWorkbenchConversationResource((kind, options) => floating.route?.({
        workbenchId, kind, options: { ...options, sourceEpoch, sourceGeneration: tab.bindingGeneration ?? 0, sourceLocationGeneration: placementGeneration },
        ...(tab.binding ? { binding: tab.binding } : {}), sourceId: tab.id,
      }) ?? false, args[0], floating.policy?.(), args[1], tab.sessionId, args[2], editors.flatMap(row => row.declaration?.conversationResources ?? []))
      const result = commands.openConversationResource(...args)
      if (result === 'rejected') commands.reportStateFailure(t('layout.sourcePageDenied'))
      return result
    },
    setState: (state: JsonValue) => {
      const failure = workbenchEditorStateFailureV1(state, editor?.declaration)
      commands.reportStateFailure(failure)
      if (failure === undefined && managed) {
        if (floating!.hasControl?.(workbenchId) !== false && floating!.canUseEditor?.(workbenchId, tab.editorId) !== false && managed.tab.bindingGeneration === tab.bindingGeneration && managed.generation === placementGeneration) floating!.updateState(tab.id, state, workbenchId)
        return
      }
      if (failure === undefined && actionable()) commands.commit({
        type: 'update-tab-state', tabId: tab.id, state,
        bindingGeneration: tab.bindingGeneration ?? 0,
      })
    },
    close: () => {
      if (!actionable()) return
      commands.commit({ type: 'close-tab', tabId: tab.id })
    },
    focus: () => { if (actionable()) commands.commit({ type: 'activate', groupId: projection.areaId, tabId: tab.id }) },
  }
  const unavailableReason = sessionUnavailable
    ?? (!editorAvailable ? 'editor' : undefined)
  const extensionRow = workbenchExtensionAccessForEditorV1(extensionAccess, tab.editorId, editors.map(row => row.id))
  const extensionUnavailable = extensionRow === undefined ? undefined : extensionRow
  const extensionCopy = extensionUnavailable === undefined ? undefined : workbenchExtensionUnavailableCopyV1(extensionUnavailable)
  const unavailable = (
    <div className={css.unavailable} data-session-unavailable={sessionUnavailable} data-extension-availability={extensionUnavailable?.availability}>
      <strong>{extensionCopy?.title ?? (sessionUnavailable === 'archived'
        ? t('area.thisConversationIsArchived')
        : sessionUnavailable === 'missing'
          ? t('area.thisConversationIsTemporarilyUnavailable')
          : sessionUnavailable === 'moved'
            ? t('area.thisConversationMovedOutOfTheWorkspace')
            : t('area.editorUnavailable'))}</strong>
      <span>{tab.editorId}</span>
      <span>{extensionCopy?.detail ?? (sessionUnavailable === 'archived'
        ? t('area.thisViewRetainsTheConversationAndIts')
        : sessionUnavailable === 'missing'
          ? t('area.thisViewStillReferencesTheOriginalConversation')
          : sessionUnavailable === 'moved'
            ? t('area.thisViewDoesNotMoveAutomaticallyReopen')
            : t('area.theEditorConversationBindingTitleAndState'))}</span>
      {sessionUnavailable !== undefined ? (
        <button type="button" onClick={commands.openBindingPicker}>{t('area.chooseAnotherConversation')}</button>
      ) : null}
      {unavailableReason === 'editor' && editors
        .filter(editor => editor.scope === tab.editorScope && editor.id !== tab.editorId)
        .map(editor => (
          <button key={`${editor.scope}:${editor.id}`} onClick={() => { commands.commit({
            type: 'replace-editor', tabId: tab.id, editorId: editor.id, lastKnownTitle: editor.label,
          }) }}>{t('area.replaceWith')} {editor.label}</button>
        ))}
      <button onClick={() => { props.focus() }}>{t('action.retry')}</button>
      <button onClick={() => { props.close() }}>{t('settings.closeView')}</button>
    </div>
  )
  if (!editorAvailable || sessionUnavailable !== undefined || floating?.canUseEditor?.(workbenchId, tab.editorId) === false) return unavailable
  if (persistedStateFailure !== undefined) return <div className={css.unavailable} role="alert" data-workbench-extension-state="rejected">
    <strong>{t('area.savedPageStateExceedsTheExtensionS')}</strong>
    <span>{tab.editorId}</span>
    <span>{persistedStateFailure}{t('area.thePageReferenceAndOriginalStateAre')}</span>
    <button type="button" onClick={() => commands.commit({
      type: 'update-tab-state', tabId: tab.id, state: {},
      bindingGeneration: tab.bindingGeneration ?? 0,
    })}>{t('area.clearPageStateAndContinue')}</button>
    <button type="button" onClick={() => props.close()}>{t('area.closePage')}</button>
  </div>
  if (tab.pendingDistribution !== undefined) return <div className={css.body} role="status" data-workbench-pending-distribution><strong>{tab.lastKnownTitle}{t('area.waitingForExtensionAndSettingsRecovery')}</strong><p>{t('area.originalSettingsAreSavedInLocalImport')}</p></div>
  const isUnboundConversation = tab.editorId === 'workbench.conversation'
    && tab.editorScope === 'session'
    && tab.binding === undefined
    && tab.sessionId === undefined
    && tab.pendingBinding === undefined
  if (tab.pendingBinding !== undefined || isUnboundConversation) {
    const policy: WorkbenchEditorBindingPolicyV1 = editor?.declaration?.binding ?? {
      requirement: editor?.declaration?.requiredBinding ?? 'session',
      unbound: 'pending',
      sharing: 'independent',
    }
    return <div className={css.body + ' ' + css.pendingBindingBody} data-workbench-pending-binding>
      <section className={css.pendingBindingPanel} role="region" aria-label={t('area.unboundConversationPage')}>
        <div className={css.pendingBindingMain}>
          <div className={css.pendingBindingEyebrow}><span className={css.pendingBindingDot} /> <span>{t('area.conversationPage')}</span><span className={css.pendingBindingBadge}>{t('tab.unbound')}</span></div>
          <h2 className={css.pendingBindingTitle}>{t('area.connectAnExistingConversation')}</h2>
          <p className={css.pendingBindingDescription}>{t('area.chooseAConversationToContinueItsMessages')}</p>
          <div className={css.pendingBindingSteps} role="list" aria-label={t('area.connectionSteps')}>
            <div role="listitem"><span>1</span><span><strong>{t('area.chooseAConversation')}</strong><small>{t('area.chooseWhichConversationToContinueOnThis')}</small></span></div>
            <div role="listitem"><span>2</span><span><strong>{t('area.continueYourWork')}</strong><small>{t('area.useSelectedContext', { context: policy.requirement === 'workspace' ? t('area.workspaceContext') : t('area.conversationContext') })}</small></span></div>
          </div>
          <button type="button" className={css.pendingBindingPrimary} data-workbench-bind-conversation onClick={commands.openBindingPicker}><IconLinkOutlineMedium size={16} />{t('area.chooseExistingConversation')}</button>
          <p className={css.pendingBindingNote}><IconLinkOutlineMedium size={13} />{t('area.thisDoesNotCreateAConversationOr')}</p>
        </div>
        <aside className={css.pendingBindingPreview} aria-label={t('area.connectedConversationPreview')}>
          <div className={css.pendingBindingPreviewHeader}>
            <span className={css.pendingBindingPreviewIcon} aria-hidden="true"><IconLinkOutlineMedium size={15} /></span>
            <span><strong>{t('area.availableAfterConnecting')}</strong><small>{t('area.workFromTheSelectedConversation')}</small></span>
            <span className={css.pendingBindingPreviewStatus}>{t('area.notConnected')}</span>
          </div>
          <div className={css.pendingBindingPreviewBody} aria-hidden="true">
            <div className={css.pendingBindingMessage}><i /><span /><span /></div>
            <div className={css.pendingBindingMessage + ' ' + css.pendingBindingMessageUser}><span /><span /></div>
            <div className={css.pendingBindingActivity}><span /><span>{t('area.messagesAndContext')}</span><b /></div>
            <div className={css.pendingBindingActivity}><span /><span>{t('area.toolCallsAndRuntimeStatus')}</span><b /></div>
          </div>
          <div className={css.pendingBindingPreviewComposer}><span>{t('area.messageComposer')}</span><span aria-hidden="true">↑</span></div>
        </aside>
      </section>
    </div>
  }
  // The contract permits releasing a background view, never its underlying
  // task. A registered close guard keeps an unsaved view mounted instead.
  if (effectiveLifecycle.visibility !== 'visible' && effectiveLifecycle[effectiveLifecycle.visibility] === 'dispose'
    && !floating?.hasGuard(tab.id, workbenchId)) return null
  return <MountedEditorOutlet metrics={runtimeMetrics}><Suspense fallback={<WorkbenchPageLoading label={workbenchPageTitle(t, tab.editorId, editor?.label ?? tab.lastKnownTitle)} icon={editor?.icon ?? 'extension'} />}>{tab.editorScope === 'session' && tab.sessionId !== undefined
    ? renderSlot('workbench.editor.session', props, {
      only: tab.editorId, fallback: unavailable,
    })
    : renderSlot('workbench.editor.root', props, { only: tab.editorId, fallback: unavailable })}</Suspense></MountedEditorOutlet>
}

function AreaEditorTarget({ id, children }: { id: string; children: ReactNode }) {
  const floating = useFloatingWorkspace()
  const content = children as import('react').ReactElement<EditorPropsV1>
  if (floating && content.props) floating.retain(content.props.workbenchId, content.props.tab)
  return floating ? <RetainedEditorTarget id={id} workbenchId={content.props.workbenchId}>{children}</RetainedEditorTarget> : <>{children}</>
}

function areaContentRenderProps(props: EditorPropsV1): AreaContentRenderPropsV1 {
  return {
    projection: props.projection,
    commands: props.commands,
    renderSlot: props.renderSlot,
    replacementEditors: props.editors,
    areaClaim: props.areaClaim,
    editor: props.editor,
    extensionAccess: props.extensionAccess,
    editorAvailable: props.editorAvailable,
    lifecycle: props.lifecycle,
    runtimeMetrics: props.runtimeMetrics,
  }
}

export const MemoizedEditor = memo(Editor, (previous, next) =>
  previous.workbenchId === next.workbenchId
    && areAreaContentRenderPropsEqual(areaContentRenderProps(previous), areaContentRenderProps(next)))

/** Registration-side reactive settings face for the Workbench maintenance page. */
export interface WorkbenchSettingsSectionInjected {
  hooks: {
    workbenchSettings: HostObservable<SettingsScopeSnapshot<WorkbenchSettingsV4>>
  }
  editorCatalog: WorkbenchEditorCatalog
  /** Live Session summaries used only for truthful mode/status projection. */
  sessionList?: HostObservable<SessionListState>
  workspaceList?: HostObservable<WorkspaceListState>
  /** Optional live model-selection projection; absent on hosts without the model plugin. */
  modelSelectionSource?: WorkbenchPreviewModelSelectionSource
  loadModelCatalog?: () => Promise<import('@deepseek-ai/dsh-api-session-controller').ModelCatalog>
  workbenchDirectory?: WorkbenchDirectory
  /** Browser-facing package preflight/import/export seam. */
  workbenchPackage?: WorkbenchPackageServiceV1
  /** Legacy compatibility for older Settings harnesses; runtime uses directory.remove. */
  removeWorkbench?(workbenchId: string): Promise<boolean>
}

type WorkbenchSettingsSectionProps =
  & Pick<PropsRuntime<'settings.section'>, 'close' | 'useSessions' | 'useWorkspaces'>
  & InjectFace<WorkbenchSettingsSectionInjected>

type PreviewInspectorSignal = {
  label: string
  detail?: string
  tone?: 'neutral' | 'info' | 'success' | 'warning' | 'error'
}

type PreviewInspectorCandidate = PreviewInspectorSignal & { priority: number }

function collectPreviewInspectorSignals(node: SlotPreviewNodeV1, result: PreviewInspectorCandidate[]): void {
  if (result.length >= 12) return
  switch (node.kind) {
    case 'stack':
      for (const child of node.children) collectPreviewInspectorSignals(child, result)
      break
    case 'text':
      if (node.text.trim() !== '') result.push({ label: node.text, tone: node.tone === 'muted' ? 'neutral' : 'info', priority: node.emphasis === 'strong' ? 1 : 2 })
      break
    case 'badge':
      result.push({ label: node.label, tone: node.tone, priority: 4 })
      break
    case 'input':
      result.push({ label: '输入能力', detail: node.disabled ? '不可用' : '可用', tone: node.disabled ? 'warning' : 'success', priority: 5 })
      break
    case 'list':
      if (node.items.length > 0) {
        const first = node.items[0]
        const tone = first?.state === 'error' ? 'error' : 'neutral'
        if (first?.primary === undefined) result.push({ label: `${node.items.length} 个条目`, tone, priority: 5 })
        else result.push({ label: `${node.items.length} 个条目`, detail: first.primary, tone, priority: 5 })
      }
      break
    case 'timeline':
      if (node.items.length > 0) {
        const active = node.items.find(item => item.state === 'active')
        const detail = active?.label ?? node.items[0]?.label
        if (detail === undefined) result.push({ label: `${node.items.length} 个步骤`, tone: active === undefined ? 'neutral' : 'info', priority: 5 })
        else result.push({ label: `${node.items.length} 个步骤`, detail, tone: active === undefined ? 'neutral' : 'info', priority: 5 })
      }
      break
    case 'empty':
      if (node.detail === undefined) result.push({ label: node.label, tone: 'neutral', priority: 5 })
      else result.push({ label: node.label, detail: node.detail, tone: 'neutral', priority: 5 })
      break
    case 'icon':
    case 'divider':
      break
  }
}

function previewInspectorSignals(node: SlotPreviewNodeV1): PreviewInspectorSignal[] {
  const candidates: PreviewInspectorCandidate[] = []
  collectPreviewInspectorSignals(node, candidates)
  return candidates
    .sort((left, right) => right.priority - left.priority)
    .slice(0, 3)
    .map(({ priority: _priority, ...signal }) => signal)
}

function previewInspectorStatus(page: WorkbenchPreviewPage): PreviewInspectorSignal {
  if (!page.available || page.bindingState === 'missing') return { label: '内页不可用', tone: 'error' }
  if (page.previewStatus === 'unsupported') return { label: '无语义预览', detail: '使用身份回退', tone: 'warning' }
  if (page.previewStatus === 'error') return { label: '预览异常', detail: '使用身份回退', tone: 'error' }
  if (page.bindingState === 'bound') return { label: '已绑定', tone: 'success' }
  if (page.bindingState === 'unbound') return { label: '未绑定', tone: 'neutral' }
  return { label: '状态未知', tone: 'warning' }
}

function modelLabelForPage(page: WorkbenchPreviewPage): string | undefined {
  if (page.bindingState !== 'bound') return page.bindingState === 'unbound' ? '未选择模型' : '模型不可用'
  const selection = page.modelSelection
  if (selection === undefined || selection.status === 'unknown') return '模型状态未知'
  if (selection.status === 'error' || selection.routable === false) return '模型不可用'
  if (selection.model === undefined || selection.model === '' || selection.provider === undefined || selection.provider === '') return '模型状态未知'
  const model = selection.modelLabel ?? selection.model
  const effort = selection.reasoningEffortLabel ?? selection.reasoningEffort
  return effort === undefined || effort === '' ? model : `${model} · ${effort}`
}

function WorkbenchPreviewInspectorArea({ area }: { area: PreviewArea }) {
  const { t } = useWorkbenchLocale()
  const page = area.active
  const status = page === undefined ? { label: t('share.emptyArea'), tone: 'neutral' as const } : previewInspectorStatus(page)
  const model = page === undefined ? undefined : modelLabelForPage(page)
  const signals = page === undefined ? [] : previewInspectorSignals(page.preview.root)
  return (
    <article className={css.settingsInspectorArea} data-active={area.focused || undefined} data-empty={page === undefined || undefined}>
      <header className={css.settingsInspectorAreaHeader}>
        <span className={css.settingsInspectorAreaOrdinal}>Area {String(area.ordinal).padStart(2, '0')}</span>
        <strong>{page?.title ?? t('share.emptyArea')}</strong>
        <span className={css.settingsPreviewInspectorStatus} data-tone={status.tone}>{status.label}</span>
      </header>
      {page === undefined ? <p className={css.settingsInspectorAreaEmpty}>{t('layout.noPagesToShow')}</p> : (
        <>
          <div className={css.settingsInspectorIdentity}>
            <span><small>{t('layout.currentPage')}</small><strong>{page.title}</strong></span>
            <code title={page.editorId}>{page.editorId}</code>
          </div>
          <div className={css.settingsInspectorRuntime}>
            <span><small>{t('layout.bindingStatus')}</small><strong>{page.bindingState === 'bound' ? 'Session 已绑定' : page.bindingState === 'unbound' ? '尚未绑定' : page.bindingState === 'missing' ? '内页缺失' : '状态未知'}</strong></span>
            <span><small>{t('workspace.agentMode')}</small><strong>{page.agentPresetLabel ?? '未提供'}</strong></span>
            <span><small>{t('settings.model')}</small><strong title={model}>{page.bindingState === 'bound' ? model ?? '模型状态未知' : '未绑定'}</strong></span>
          </div>
          <div className={css.settingsInspectorSignals}>
            <span className={css.settingsInspectorSignalsLabel}>{t('layout.semanticPreview')}</span>
            {signals.length === 0 ? <span className={css.settingsInspectorMuted}>{t('layout.noDisplayableStateDeclared')}</span> : signals.map((signal, index) => <span key={`${signal.label}-${index}`} data-tone={signal.tone}><i />{signal.label}{signal.detail === undefined ? null : <small>{signal.detail}</small>}</span>)}
          </div>
        </>
      )}
    </article>
  )
}

function WorkbenchPreviewInspectorLayoutNode({ node }: { node: WorkbenchPreviewNode }): React.ReactNode {
  if (node.kind === 'area') return <WorkbenchPreviewInspectorArea area={node} />
  const ratio = Math.min(.9, Math.max(.1, node.ratio))
  const style = node.axis === 'horizontal'
    ? { gridTemplateColumns: `minmax(0, ${ratio}fr) 12px minmax(0, ${1 - ratio}fr)` }
    : { gridTemplateRows: `minmax(0, ${ratio}fr) 12px minmax(0, ${1 - ratio}fr)` }
  return <div className={css.settingsInspectorSplit} data-axis={node.axis} style={style}>
    <WorkbenchPreviewInspectorLayoutNode node={node.first} />
    <span className={css.settingsInspectorDivider} aria-hidden="true" />
    <WorkbenchPreviewInspectorLayoutNode node={node.second} />
  </div>
}

interface PreviewSvgFrame { x: number; y: number; width: number; height: number }

/**
 * Keep the miniature layout renderer on the same alias palette as the rest
 * of DSH.  The renderer intentionally has no private colours: theme changes
 * are picked up through these variables by both the light and dark shells.
 */
const PREVIEW_SVG_PALETTE = {
  base: 'var(--dsw-alias-bg-base)',
  surface: 'var(--dsw-alias-bg-layer-1)',
  raised: 'var(--dsw-alias-bg-layer-2)',
  border: 'var(--dsw-alias-border-l2)',
  text: 'var(--dsw-alias-label-primary)',
  muted: 'var(--dsw-alias-label-secondary)',
  subtle: 'var(--dsw-alias-label-tertiary)',
  accent: 'var(--dsw-alias-state-business-primary)',
  accentSoft: 'var(--dsw-alias-state-business-tertiary)',
  error: 'var(--dsw-alias-state-error-primary)',
} as const

function previewSvgColor(page: WorkbenchPreviewPage | undefined): string {
  if (page === undefined) return PREVIEW_SVG_PALETTE.subtle
  if (!page.available || page.bindingState === 'missing' || page.previewStatus === 'error') return PREVIEW_SVG_PALETTE.error
  if (page.previewStatus === 'unsupported') return PREVIEW_SVG_PALETTE.muted
  if (page.bindingState === 'bound') return PREVIEW_SVG_PALETTE.accent
  if (page.bindingState === 'unbound') return PREVIEW_SVG_PALETTE.subtle
  return PREVIEW_SVG_PALETTE.accent
}

function previewSvgText(value: string | undefined, max = 22): string {
  if (value === undefined || value === '') return ''
  return value.length > max ? `${value.slice(0, Math.max(1, max - 1))}…` : value
}

function previewSvgStatusLabel(page: WorkbenchPreviewPage | undefined): string {
  if (page === undefined) return '空容器'
  if (!page.available || page.bindingState === 'missing') return '内页缺失'
  if (page.previewStatus === 'unsupported') return '无预览协议'
  if (page.previewStatus === 'error') return '预览异常'
  if (page.bindingState === 'bound') {
    const model = page.modelSelection
    if (model?.status === 'ready' && model.routable !== false) return '模型就绪'
    if (model?.status === 'error' || model?.routable === false) return '模型不可用'
    return '已绑定'
  }
  if (page.bindingState === 'unbound') return '未绑定'
  return '状态未知'
}

function previewSvgStatusTone(page: WorkbenchPreviewPage | undefined): 'accent' | 'neutral' | 'warning' | 'error' {
  if (page === undefined) return 'neutral'
  if (!page.available || page.bindingState === 'missing' || page.previewStatus === 'error') return 'error'
  if (page.previewStatus === 'unsupported') return 'warning'
  if (page.bindingState === 'bound') return 'accent'
  return 'neutral'
}

function WorkbenchLayoutPreviewSvg({ model, ariaLabel }: { model: WorkbenchPreviewModel; ariaLabel: string }): React.ReactNode {
  const { t } = useWorkbenchLocale()
  const svgInstanceId = useId().replaceAll(':', '')
  const renderNode = (node: WorkbenchPreviewNode, frame: PreviewSvgFrame, keyPrefix: string): React.ReactNode => {
    if (node.kind === 'area') {
      const page = node.active
      const tone = previewSvgStatusTone(page)
      const stateColor = previewSvgColor(page)
      const stateFill = tone === 'accent' ? PREVIEW_SVG_PALETTE.accentSoft : tone === 'warning' ? PREVIEW_SVG_PALETTE.muted : tone === 'error' ? PREVIEW_SVG_PALETTE.error : PREVIEW_SVG_PALETTE.subtle
      const headerHeight = Math.min(10, Math.max(7, frame.height * .2))
      const body = { x: frame.x + 2, y: frame.y + headerHeight + 2, width: Math.max(0, frame.width - 4), height: Math.max(0, frame.height - headerHeight - 4) }
      const status = previewSvgStatusLabel(page)
      // Keep the identity visible in compact Areas; only suppress it when the
      // geometry genuinely cannot fit a readable single line.
      const tiny = frame.width < 16 || frame.height < 9
      const availableTitleWidth = Math.max(8, frame.width - 8)
      const rawTitle = page?.title ?? t('share.emptyArea')
      const title = previewSvgText(rawTitle, Math.max(4, Math.floor(availableTitleWidth / 2.5)))
      const titleIsClipped = title !== rawTitle
      const clipId = `workbench-preview-${svgInstanceId}-${keyPrefix}`
      return <g key={keyPrefix}><title>{`Area ${String(node.ordinal).padStart(2, '0')}：${rawTitle}，${status}`}</title><defs><clipPath id={clipId}><rect x={frame.x + .5} y={frame.y + .5} width={Math.max(0, frame.width - 1)} height={Math.max(0, frame.height - 1)} rx="1.5" /></clipPath></defs><rect x={frame.x} y={frame.y} width={frame.width} height={frame.height} rx="2" fill={PREVIEW_SVG_PALETTE.surface} /><g clipPath={`url(#${clipId})`}><rect x={frame.x + .8} y={frame.y + .8} width={Math.max(0, frame.width - 1.6)} height={Math.max(0, frame.height - 1.6)} rx="1.5" fill={stateFill} fillOpacity=".08" /><rect x={frame.x + 1.5} y={frame.y + 1.5} width={Math.min(1.4, Math.max(.8, frame.width * .03))} height={Math.max(0, frame.height - 3)} rx=".5" fill={stateColor} /><line x1={frame.x + 1.5} y1={frame.y + headerHeight} x2={frame.x + frame.width - 1.5} y2={frame.y + headerHeight} stroke={PREVIEW_SVG_PALETTE.border} strokeWidth=".45" /><circle cx={frame.x + 3.5} cy={frame.y + Math.min(3.8, headerHeight * .48)} r="1.15" fill={stateColor} />{tiny ? null : <text x={frame.x + 5.5} y={frame.y + Math.min(headerHeight - 1.5, 6.5)} fill={PREVIEW_SVG_PALETTE.text} fontSize={Math.max(3.5, Math.min(4.8, headerHeight * .5))} fontWeight="600" textLength={titleIsClipped ? availableTitleWidth : undefined} lengthAdjust={titleIsClipped ? 'spacingAndGlyphs' : undefined}>{title}</text>}{page === undefined ? <rect x={body.x + body.width * .28} y={body.y + body.height * .4} width={Math.max(3, body.width * .44)} height={Math.max(1, body.height * .12)} rx=".8" fill="none" stroke={PREVIEW_SVG_PALETTE.subtle} strokeWidth=".5" strokeDasharray="1.5 1" /> : <g><rect x={body.x} y={body.y + Math.min(3, body.height * .22)} width={Math.max(5, body.width * .62)} height={Math.max(1, Math.min(2, body.height * .12))} rx=".7" fill={PREVIEW_SVG_PALETTE.text} opacity=".16" />{tiny ? null : <rect x={body.x} y={body.y + Math.max(6, body.height * .48)} width={Math.max(5, Math.min(body.width * .42, 18))} height={Math.max(1, Math.min(2.8, body.height * .2))} rx=".8" fill={stateFill} fillOpacity=".55" />}</g>}</g><rect x={frame.x} y={frame.y} width={frame.width} height={frame.height} rx="2" fill="none" stroke={node.focused ? PREVIEW_SVG_PALETTE.accent : PREVIEW_SVG_PALETTE.border} strokeWidth={node.focused ? 1.05 : .7} /></g>
    }
    const ratio = Math.min(.9, Math.max(.1, node.ratio))
    const axisSize = node.axis === 'horizontal' ? frame.width : frame.height
    const gap = Math.min(4.2, Math.max(.6, axisSize * .075))
    if (node.axis === 'horizontal') {
      const firstWidth = Math.max(0, (frame.width - gap) * ratio)
      const dividerX = frame.x + firstWidth
      return <g key={keyPrefix}>{renderNode(node.first, { x: frame.x, y: frame.y, width: firstWidth, height: frame.height }, `${keyPrefix}-a`)}<rect x={dividerX} y={frame.y} width={gap} height={frame.height} fill={PREVIEW_SVG_PALETTE.border} />{renderNode(node.second, { x: dividerX + gap, y: frame.y, width: Math.max(0, frame.width - firstWidth - gap), height: frame.height }, `${keyPrefix}-b`)}</g>
    }
    const firstHeight = Math.max(0, (frame.height - gap) * ratio)
    const dividerY = frame.y + firstHeight
    return <g key={keyPrefix}>{renderNode(node.first, { x: frame.x, y: frame.y, width: frame.width, height: firstHeight }, `${keyPrefix}-a`)}<rect x={frame.x} y={dividerY} width={frame.width} height={gap} fill={PREVIEW_SVG_PALETTE.border} />{renderNode(node.second, { x: frame.x, y: dividerY + gap, width: frame.width, height: Math.max(0, frame.height - firstHeight - gap) }, `${keyPrefix}-b`)}</g>
  }
  return <svg className={css.settingsCardPreviewSvg} viewBox="0 0 100 64" preserveAspectRatio="xMidYMid meet" role="img" aria-label={ariaLabel}><rect x=".6" y=".6" width="98.8" height="62.8" rx="3" fill={PREVIEW_SVG_PALETTE.base} stroke={PREVIEW_SVG_PALETTE.border} strokeWidth=".7" />{renderNode(model.root, { x: 4, y: 4, width: 92, height: 56 }, 'root')}</svg>
}

function pluginStatusLabel(status: 'available' | 'missing' | 'unresolved'): string {
  if (status === 'available') return '已安装'
  if (status === 'missing') return '内页缺失'
  return '来源待确认'
}

function importDependencyLocalStatusLabel(status: WorkbenchPackageImportDependencyStatusV1['localStatus']): string {
  if (status === 'installed') return '本机已安装并注册'
  // An artifact in the local store is not proof that the Runtime has loaded
  // it.  Keep this distinction visible in the import review so users know
  // that the confirmation action still has work to do.
  if (status === 'available') return '本机已有制品（待激活）'
  if (status === 'conflict') return '本机版本/摘要冲突'
  if (status === 'missing') return '本机未找到'
  return 'Runtime 无法检查'
}

function importDependencySummary(dependencies: readonly WorkbenchPackageImportDependencyStatusV1[]): string {
  if (dependencies.length === 0) return '没有需要安装的依赖'
  const installed = dependencies.filter(item => item.localStatus === 'installed').length
  const available = dependencies.filter(item => item.localStatus === 'available').length
  const missing = dependencies.filter(item => item.localStatus === 'missing').length
  const conflicts = dependencies.filter(item => item.localStatus === 'conflict').length
  const unknown = dependencies.filter(item => item.localStatus === 'unknown').length
  return [
    installed > 0 ? `${installed} 个已注册` : undefined,
    available > 0 ? `${available} 个已有制品待激活` : undefined,
    missing > 0 ? `${missing} 个待安装` : undefined,
    conflicts > 0 ? `${conflicts} 个冲突` : undefined,
    unknown > 0 ? `${unknown} 个待 Runtime 检查` : undefined,
  ].filter((value): value is string => value !== undefined).join(' · ') || '状态待检查'
}

function importDependencyLocalStatusTone(status: WorkbenchPackageImportDependencyStatusV1['localStatus']): 'ready' | 'warning' | 'error' | 'unknown' {
  if (status === 'installed') return 'ready'
  if (status === 'available') return 'warning'
  if (status === 'conflict') return 'error'
  if (status === 'missing') return 'warning'
  return 'unknown'
}

function importDependencyPackageStatusLabel(status: WorkbenchPackageImportDependencyStatusV1['packageStatus']): string {
  if (status === 'embedded') return '包内含离线制品'
  if (status === 'registry') return '需要 Registry'
  return '包内没有可安装制品'
}

function fallbackImportDependencyInspection(
  report: WorkbenchPackagePreflightResultV1,
  editors: readonly WorkbenchEditorCatalogRow[],
): readonly WorkbenchPackageImportDependencyStatusV1[] {
  return (report.dependencyLock ?? []).map(dependency => {
    const expectedEditors = dependency.editorIds
    const digestOf = (row: WorkbenchEditorCatalogRow): string | undefined =>
      row.provenance?.artifactDigest ?? row.provenance?.dynamic?.artifactDigest
    const installed = expectedEditors.length > 0 && expectedEditors.every(editorId => {
      const scope = dependency.editorScopes?.find(item => item.editorId === editorId)?.scope
      return editors.some(row => row.id === editorId
        && (scope === undefined || row.scope === scope)
        && digestOf(row)?.toUpperCase() === dependency.digest.toUpperCase())
    })
    const conflict = expectedEditors.some(editorId => editors.some(row => row.id === editorId
      && digestOf(row) !== undefined
      && digestOf(row)?.toUpperCase() !== dependency.digest.toUpperCase()))
    return {
      portableId: dependency.portableId,
      ...(dependency.packageName === undefined ? {} : { packageName: dependency.packageName }),
      version: dependency.version,
      digest: dependency.digest,
      kind: dependency.kind,
      editorIds: [...dependency.editorIds],
      localStatus: installed ? 'installed' : conflict ? 'conflict' : 'unknown',
      packageStatus: dependency.artifactPath !== undefined || dependency.npmArtifactPath !== undefined
        ? 'embedded' : dependency.installSource === 'npm' || dependency.installSource === 'registry' || dependency.registryUrl !== undefined
          ? 'registry' : 'unavailable',
    }
  })
}

const WORKBENCH_IMPORT_STEPS = [
  { id: 'local', label: '检查本机依赖' },
  { id: 'scan', label: '扫描包内制品' },
  { id: 'install', label: '安装并激活' },
  { id: 'verify', label: '验证内页' },
  { id: 'finish', label: '保存并完成' },
] as const

const WORKBENCH_IMPORT_RESUME_KEY = 'dsh.workbench.import.resume.v1'

function readWorkbenchImportResumeId(): string | undefined {
  try {
    const value = globalThis.localStorage?.getItem(WORKBENCH_IMPORT_RESUME_KEY)?.trim()
    return value === undefined || value === '' ? undefined : value
  } catch {
    return undefined
  }
}

function writeWorkbenchImportResumeId(transactionId: string | undefined): void {
  try {
    if (transactionId === undefined) globalThis.localStorage?.removeItem(WORKBENCH_IMPORT_RESUME_KEY)
    else globalThis.localStorage?.setItem(WORKBENCH_IMPORT_RESUME_KEY, transactionId)
  } catch {
    // Runtime journal remains authoritative when browser storage is disabled.
  }
}

function importStepState(
  id: (typeof WORKBENCH_IMPORT_STEPS)[number]['id'],
  phase: WorkbenchSettingsSectionImportPhase,
  confirmed: boolean,
  restartPending: boolean,
  dependenciesChecked: boolean,
): 'complete' | 'active' | 'pending' {
  const rank: Record<(typeof WORKBENCH_IMPORT_STEPS)[number]['id'], number> = { local: 1, scan: 2, install: 3, verify: 4, finish: 5 }
  const currentRank = phase === 'checking-local' ? 1
    : phase === 'scanning-package' ? 2
      : phase === 'staging-artifacts' || phase === 'installing-dependencies' || phase === 'activating' ? 3
        : phase === 'verifying-editors' ? 4
          : phase === 'restoring-state' || phase === 'committing' || phase === 'waiting-restart' ? 5
            : phase === 'idle' && confirmed ? (restartPending ? 5 : 1)
              : phase === 'idle' && dependenciesChecked ? 2 : 0
  if (id === 'finish' && restartPending) return 'active'
  if (currentRank > rank[id]) return 'complete'
  if (currentRank === rank[id]) return 'active'
  return 'pending'
}

type WorkbenchSettingsSectionImportPhase =
  | 'idle' | 'reading' | 'preflight' | 'checking-local' | 'scanning-package'
  | 'staging-artifacts' | 'installing-dependencies' | 'preparing' | 'binding'
  | 'activating' | 'verifying-editors' | 'restoring-state' | 'committing'
  | 'waiting-restart'

export function dependencyAvailabilityPresentation(
  availability: WorkbenchDependencyAvailabilityV1 | undefined,
): { label: string; state: 'available' | 'missing' | 'unresolved' } {
  if (availability === 'embedded') return { label: '已嵌入', state: 'available' }
  if (availability === 'registry') return { label: '可在线获取', state: 'available' }
  if (availability === 'installed') return { label: '仅本机已安装', state: 'unresolved' }
  if (availability === 'forbidden') return { label: '禁止分发', state: 'missing' }
  return { label: '制品缺失', state: 'missing' }
}

function dependencyAvailability(
  snapshot: WorkbenchDependencySnapshotV1,
  portableId: string,
): WorkbenchDependencyAvailabilityV1 | undefined {
  return [...snapshot.staticPackages, ...snapshot.dynamicPackages]
    .find(candidate => candidate.portableId === portableId)?.availability
}

function exportReadinessLabel(value: WorkbenchExportReadinessInspectionV1['completeness'] | undefined): string {
  if (value === 'complete-offline') return '离线完整，可断网导入'
  if (value === 'complete-online') return '在线完整，需要 Registry'
  if (value === 'needs-preparation') return '需要准备依赖'
  if (value === 'needs-input') return '需要接收端绑定'
  if (value === 'blocked') return '存在必须解决的阻塞项'
  if (value === 'layout-only') return '仅布局，不能保证内页开箱即用'
  return '重新扫描中'
}

function exportReadinessRepairLabel(value: WorkbenchReadinessRepairV1): string {
  if (value === 'embed-local') return '保存为离线制品'
  if (value === 'install-registry') return '按精确版本安装'
  if (value === 'configure-registry') return '配置受信任 Registry'
  if (value === 'prepare-distribution') return '准备分发资料'
  if (value === 'bind-input') return '导入后绑定'
  return '查看详情'
}

function canExportFromReadiness(
  inspection: WorkbenchExportReadinessInspectionV1 | undefined,
  mode: 'online-reference' | 'offline-embedded',
): boolean {
  if (inspection === undefined || inspection.mode !== mode) return false
  // External inputs (model, credential, target Session, MCP, etc.) are
  // recipient-owned and intentionally do not prevent exporting a dependency-
  // complete package. The recipient binds them after import. Hard dependency
  // blockers, however, must never be presented as a complete package.
  if (inspection.completeness === 'needs-input') return true
  return mode === 'offline-embedded'
    ? inspection.completeness === 'complete-offline'
    : inspection.completeness === 'complete-online'
}

function canExportLayoutFromReadiness(
  inspection: WorkbenchExportReadinessInspectionV1 | undefined,
): boolean {
  return inspection !== undefined
    && (inspection.completeness === 'layout-only'
      || inspection.completeness === 'needs-preparation'
      || inspection.completeness === 'blocked')
}

type WorkbenchExportTargetModeV1 = 'online-reference' | 'offline-embedded' | 'layout-only'

function exportTargetLabel(target: WorkbenchExportTargetModeV1): string {
  if (target === 'offline-embedded') return '离线完整包'
  if (target === 'online-reference') return '在线引用包'
  return '布局包（依赖需另行准备）'
}

function exportTargetDescription(target: WorkbenchExportTargetModeV1): string {
  if (target === 'offline-embedded') return '包含已验证的可嵌入制品，可在断网环境导入。'
  if (target === 'online-reference') return '包含精确版本、digest 和受信任 Registry 引用，接收端导入时需要网络。'
  return '只包含布局、当前 active 内页身份和安全可迁移状态，不能保证内页开箱即用。'
}

function isAutomaticExportRepair(repair: WorkbenchReadinessRepairV1): boolean {
  return repair === 'embed-local' || repair === 'install-registry'
}

function workbenchTimestamp(value: number): string | undefined {
  if (!Number.isFinite(value) || value <= 0) return undefined
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).format(new Date(value))
}

/** Render the share-readiness view without owning the surrounding Settings chrome. */
export function WorkbenchSettingsSection({
  useWorkbenchSettings, editorCatalog, sessionList, modelSelectionSource: injectedModelSelectionSource,
  workspaceList, workbenchDirectory: injectedDirectory,
  workbenchPackage, removeWorkbench: propsRemoveWorkbench,
}: WorkbenchSettingsSectionProps) {
  const { t } = useWorkbenchLocale()
  const legacySettingsView = injectedDirectory === undefined
  const workbenchDirectory = injectedDirectory ?? EMPTY_WORKBENCH_DIRECTORY
  const snapshot = useWorkbenchSettings(value => value)
  const [message, setMessage] = useState<string>()
  const getDirectorySnapshot = useMemo(
    () => cachedDirectorySnapshot(() => workbenchDirectory.getSnapshot()), [workbenchDirectory],
  )
  const directorySnapshot = useSyncExternalStore(workbenchDirectory.subscribe, getDirectorySnapshot, getDirectorySnapshot)
  const [category, setCategory] = useState<'open' | 'inactive' | 'archived'>('open')
  const [searchQuery, setSearchQuery] = useState('')
  const subscribeEditors = useCallback(
    (listener: () => void) => editorCatalog.subscribe(listener), [editorCatalog],
  )
  const getEditors = useCallback(() => editorCatalog.getSnapshot(), [editorCatalog])
  const editors = useSyncExternalStore(subscribeEditors, getEditors, getEditors)
  const getSessions = useCallback(() => sessionList?.getSnapshot() ?? EMPTY_SESSION_LIST_SNAPSHOT, [sessionList])
  const subscribeSessions = useCallback((listener: () => void) => sessionList?.subscribe(listener) ?? (() => {}), [sessionList])
  const sessions = useSyncExternalStore(subscribeSessions, getSessions, getSessions)
  const getWorkspaces = useCallback(() => workspaceList?.getSnapshot() ?? EMPTY_WORKSPACE_LIST_SNAPSHOT, [workspaceList])
  const subscribeWorkspaces = useCallback((listener: () => void) => workspaceList?.subscribe(listener) ?? (() => {}), [workspaceList])
  const workspaceSnapshot = useSyncExternalStore(subscribeWorkspaces, getWorkspaces, getWorkspaces)
  const modelSelectionSource = injectedModelSelectionSource ?? EMPTY_MODEL_SELECTION_SOURCE
  const modelSelectionVersion = useSyncExternalStore(
    modelSelectionSource.subscribe, modelSelectionSource.getSnapshot, modelSelectionSource.getSnapshot,
  )
  const previewSessions = useMemo<WorkbenchPreviewSession[]>(
    () => sessions.ids.map(id => {
      const summary = sessions.byId[id]
      const modelSelection = modelSelectionSource.get(id)
      return summary === undefined
        ? { id, displayTitle: id, ...(modelSelection === undefined ? {} : { modelSelection }) }
        : {
          id,
          displayTitle: summary.displayTitle,
          ...(summary.projectionValues?.agentPreset == null ? {} : { agentPreset: summary.projectionValues.agentPreset }),
          ...(modelSelection === undefined ? {} : { modelSelection }),
        }
    }),
    [modelSelectionSource, modelSelectionVersion, sessions],
  )
  const workbenches = snapshot.value?.workbenches ?? {}
  const invalid = snapshot.value?.invalidWorkbenches ?? {}
  const activeWorkbenchId = snapshot.value?.activeWorkbenchId
  const openWorkbenchIds = directorySnapshot?.openWorkbenchIds ?? Object.keys(workbenches)
  const workbenchIds = [...new Set([...Object.keys(workbenches), ...Object.keys(invalid)])]
    .sort((left, right) => {
      const leftName = workbenches[left]?.name ?? left
      const rightName = workbenches[right]?.name ?? right
      return leftName.localeCompare(rightName, 'zh-CN')
    })
  const metadataFor = (workbenchId: string) => workbenches[workbenchId] ?? invalid[workbenchId]
  const tagsFor = (workbenchId: string): readonly string[] => metadataFor(workbenchId)?.tags ?? []
  const normalizedSearch = searchQuery.trim().toLocaleLowerCase('zh-CN')
  const matchesSearch = (workbenchId: string): boolean => {
    if (normalizedSearch === '') return true
    const metadata = metadataFor(workbenchId)
    if (metadata === undefined) return false
    return [metadata.name, metadata.description, ...tagsFor(workbenchId)]
      .some(value => value.toLocaleLowerCase('zh-CN').includes(normalizedSearch))
  }
  const visibleWorkbenchIds = workbenchIds.filter(id => category === 'open'
    ? openWorkbenchIds.includes(id)
    : category === 'inactive'
      ? !openWorkbenchIds.includes(id) && metadataFor(id)?.archivedAt === undefined
      : metadataFor(id)?.archivedAt !== undefined).filter(matchesSearch).sort((left, right) => {
    const leftMeta = metadataFor(left); const rightMeta = metadataFor(right)
    const leftPinned = leftMeta?.pinnedAt ?? 0; const rightPinned = rightMeta?.pinnedAt ?? 0
    if ((leftPinned > 0) !== (rightPinned > 0)) return leftPinned > 0 ? -1 : 1
    if (leftPinned !== rightPinned) return rightPinned - leftPinned
    if (category === 'archived') return (rightMeta?.archivedAt ?? 0) - (leftMeta?.archivedAt ?? 0)
    return (rightMeta?.updatedAt ?? 0) - (leftMeta?.updatedAt ?? 0)
  })
  const [selectedWorkbenchId, setSelectedWorkbenchId] = useState<string | undefined>(
    () => legacySettingsView ? activeWorkbenchId ?? workbenchIds[0] : undefined,
  )
  const [editingMetadata, setEditingMetadata] = useState(false)
  const [metadataNameDraft, setMetadataNameDraft] = useState('')
  const [metadataDescriptionDraft, setMetadataDescriptionDraft] = useState('')
  const [metadataTagsDraft, setMetadataTagsDraft] = useState('')
  const [packageDialog, setPackageDialog] = useState<{
    fileName: string
    archive: Uint8Array
    report: WorkbenchPackagePreflightResultV1
    dependencies: readonly WorkbenchPackageImportDependencyStatusV1[]
  }>()
  const [packageDependenciesChecking, setPackageDependenciesChecking] = useState(false)
  const [packageDependenciesChecked, setPackageDependenciesChecked] = useState(false)
  const [packageDependencyCheckError, setPackageDependencyCheckError] = useState<string>()
  const [packageSessionTargets, setPackageSessionTargets] = useState<Record<string, string>>({})
  const [packagePermissionApprovals, setPackagePermissionApprovals] = useState<Record<string, boolean>>({})
  const [exportPermissionApprovals, setExportPermissionApprovals] = useState<Record<string, boolean>>({})
  const packageSessionFieldId = useId()
  const [packageBusy, setPackageBusy] = useState(false)
  const [packageOperationPhase, setPackageOperationPhase] = useState<WorkbenchSettingsSectionImportPhase>('idle')
  const [packageImportProgress, setPackageImportProgress] = useState<WorkbenchPackageImportProgressV1>()
  const [packageImportConfirmed, setPackageImportConfirmed] = useState(false)
  const [packageRestartPrompt, setPackageRestartPrompt] = useState<{ transactionId: string; reason: string }>()
  const [packageResumeTransactionId, setPackageResumeTransactionId] = useState<string>()
  const packageResumeAttemptedRef = useRef<string>()
  const [externalBindingDialog, setExternalBindingDialog] = useState<{
    workbenchId: string
    inputs: WorkbenchRuntimeReadinessSnapshotV1['requiredInputs']
  }>()
  const [externalBindingValues, setExternalBindingValues] = useState<Record<string, string>>({})
  const [dependencyRefreshTick, setDependencyRefreshTick] = useState(0)
  const [exportModeDialog, setExportModeDialog] = useState<{
    workbenchId: string
    mode: 'online-reference' | 'offline-embedded'
  }>()
  const [exportDialogStep, setExportDialogStep] = useState<'readiness' | 'review'>('readiness')
  const [exportTargetMode, setExportTargetMode] = useState<WorkbenchExportTargetModeV1>()
  const [exportPreparationTransactionId, setExportPreparationTransactionId] = useState<string>()
  const [exportDialogMessage, setExportDialogMessage] = useState<string>()
  const packageFileInputRef = useRef<HTMLInputElement>(null)
  const workbenchCardRefs = useRef(new Map<string, HTMLElement>())
  const returnFocusWorkbenchId = useRef<string>()
  const pendingImportedWorkbenchId = useRef<string>()
  const [packageRuntimeStatus, setPackageRuntimeStatus] = useState<WorkbenchDistributionRuntimeStatusV1 | undefined>(
    () => workbenchPackage?.runtimeStatus?.(),
  )
  const [packageRuntimeReadiness, setPackageRuntimeReadiness] = useState<WorkbenchRuntimeReadinessSnapshotV1 | undefined>(
    () => workbenchPackage?.runtimeReadiness?.(),
  )
  useEffect(() => {
    setPackageRuntimeStatus(workbenchPackage?.runtimeStatus?.())
    setPackageRuntimeReadiness(workbenchPackage?.runtimeReadiness?.())
    if (workbenchPackage?.subscribeRuntime === undefined) return
    return workbenchPackage.subscribeRuntime(() => {
      setPackageRuntimeStatus(workbenchPackage.runtimeStatus?.())
      setPackageRuntimeReadiness(workbenchPackage.runtimeReadiness?.())
    })
  }, [workbenchPackage])
  // A Manager restart tears down the browser page, so the in-memory import
  // dialog disappears while the durable transaction intentionally remains.
  // Resume once from the opaque browser hint; the Runtime reopens the
  // validated archive from its Registry and never receives archive bytes here.
  useEffect(() => {
    const resumeImport = workbenchPackage?.resumeImport
    const transactionId = readWorkbenchImportResumeId()
    if (resumeImport === undefined || transactionId === undefined
      || packageRuntimeStatus === undefined || packageRuntimeStatus.authority === 'browser'
      || packageResumeAttemptedRef.current === transactionId) return
    packageResumeAttemptedRef.current = transactionId
    setPackageResumeTransactionId(transactionId)
    setPackageOperationPhase('waiting-restart')
    setPackageImportProgress({ phase: 'waiting-restart', current: 0, total: 1, label: '正在恢复上次导入事务…', requiresRestart: true })
    setPackageBusy(true)
    void resumeImport(transactionId).then(result => {
      if (result.status === 'committed') {
        writeWorkbenchImportResumeId(undefined)
        setPackageResumeTransactionId(undefined)
        setCategory('inactive')
        pendingImportedWorkbenchId.current = result.workbenchId
        setSelectedWorkbenchId(result.workbenchId)
        setMessage('DSH 已重启并完成工作台依赖验证；工作台已放入未使用，当前工作不受影响。')
      } else if (result.status === 'waiting-restart') {
        writeWorkbenchImportResumeId(result.transactionId)
        setPackageResumeTransactionId(result.transactionId)
        setPackageRestartPrompt({ transactionId: result.transactionId, reason: result.reason })
        setMessage(`导入事务仍需重启后验证（事务 ${result.transactionId}）。`)
      } else {
        writeWorkbenchImportResumeId(undefined)
        setPackageResumeTransactionId(undefined)
        setMessage(result.status === 'preflight-failed'
          ? '上次导入事务的归档预检未通过，未修改当前设置。'
          : result.status === 'conflict'
            ? '上次导入事务遇到 Settings 版本冲突，未修改当前设置。'
            : (result.reason ?? '上次导入事务未能恢复。'))
      }
    }).catch(error => {
      setMessage(error instanceof Error ? error.message : '上次导入事务恢复失败；当前工作台没有改变。')
    }).finally(() => {
      setPackageBusy(false)
      setPackageOperationPhase('idle')
    })
  }, [packageRuntimeStatus, workbenchPackage])
  useEffect(() => {
    if (pendingImportedWorkbenchId.current !== undefined && workbenchIds.includes(pendingImportedWorkbenchId.current)) {
      pendingImportedWorkbenchId.current = undefined
    }
    if (selectedWorkbenchId !== undefined && workbenchIds.includes(selectedWorkbenchId)) return
    if (selectedWorkbenchId !== undefined && selectedWorkbenchId === pendingImportedWorkbenchId.current) return
    if (selectedWorkbenchId !== undefined && !workbenchIds.includes(selectedWorkbenchId)) setSelectedWorkbenchId(undefined)
    if (legacySettingsView && selectedWorkbenchId === undefined) setSelectedWorkbenchId(activeWorkbenchId ?? workbenchIds[0])
  }, [activeWorkbenchId, legacySettingsView, selectedWorkbenchId, workbenchIds])
  const inventories = useMemo(() => new Map(Object.entries(workbenches).map(([workbenchId, record]) => [
    workbenchId, buildWorkbenchInventory(record.document, editors),
  ])), [editors, workbenches])
  const selectedRecord = selectedWorkbenchId === undefined ? undefined : workbenches[selectedWorkbenchId]
  const selectedInvalid = selectedWorkbenchId === undefined ? undefined : invalid[selectedWorkbenchId]
  const selectedInventory = selectedWorkbenchId === undefined ? undefined : inventories.get(selectedWorkbenchId)
  const selectedDependencySnapshot = useMemo(() => selectedWorkbenchId === undefined
    || workbenchPackage === undefined
    || typeof workbenchPackage.inspectDependencies !== 'function'
    ? undefined
    : workbenchPackage.inspectDependencies(selectedWorkbenchId),
  [dependencyRefreshTick, selectedWorkbenchId, workbenchPackage])
  const selectedDependencyScan = useMemo(() => selectedWorkbenchId === undefined
    || workbenchPackage === undefined
    || typeof workbenchPackage.scanDependencies !== 'function'
    ? undefined
    : workbenchPackage.scanDependencies(selectedWorkbenchId),
  [dependencyRefreshTick, selectedWorkbenchId, workbenchPackage])
  const exportDependencySnapshot = useMemo(() => exportModeDialog === undefined
    || workbenchPackage === undefined
    || typeof workbenchPackage.inspectDependencies !== 'function'
    ? undefined
    : workbenchPackage.inspectDependencies(exportModeDialog.workbenchId),
  [dependencyRefreshTick, exportModeDialog, workbenchPackage])
  const exportReadiness = useMemo(() => exportModeDialog === undefined
    || workbenchPackage === undefined
    || typeof workbenchPackage.inspectExportReadiness !== 'function'
    ? undefined
    : workbenchPackage.inspectExportReadiness(exportModeDialog.workbenchId, exportModeDialog.mode),
  [dependencyRefreshTick, exportModeDialog, workbenchPackage])
  const exportOnlineReadiness = useMemo(() => exportModeDialog === undefined
    || workbenchPackage === undefined
    || typeof workbenchPackage.inspectExportReadiness !== 'function'
    ? undefined
    : workbenchPackage.inspectExportReadiness(exportModeDialog.workbenchId, 'online-reference'),
  [dependencyRefreshTick, exportModeDialog, workbenchPackage])
  const exportOfflineReadiness = useMemo(() => exportModeDialog === undefined
    || workbenchPackage === undefined
    || typeof workbenchPackage.inspectExportReadiness !== 'function'
    ? undefined
    : workbenchPackage.inspectExportReadiness(exportModeDialog.workbenchId, 'offline-embedded'),
  [dependencyRefreshTick, exportModeDialog, workbenchPackage])
  // Layout export is a separate, explicit escape hatch.  It always uses the
  // online-reference serialization path so the package builder strips local
  // artifact paths and emits only the safe portable projection.
  const exportLayoutReadiness = useMemo(() => exportModeDialog === undefined
    || workbenchPackage === undefined
    || typeof workbenchPackage.inspectExportReadiness !== 'function'
    ? undefined
    : workbenchPackage.inspectExportReadiness(exportModeDialog.workbenchId, 'online-reference'),
  [dependencyRefreshTick, exportModeDialog, workbenchPackage])
  const exportHighRiskPermissions = useMemo(() => {
    if (exportReadiness === undefined) return []
    return [...new Set([...exportReadiness.ready, ...exportReadiness.repairable]
      .flatMap(item => item.requiredPermissions)
      .filter(permission => WORKBENCH_HIGH_RISK_PERMISSIONS_V1.includes(permission as never)))].sort()
  }, [exportReadiness])
  const exportPreparationAvailable = workbenchPackage?.prepareExportDependencies !== undefined
  const exportTargetReadiness = useMemo(() => {
    if (exportModeDialog === undefined || exportTargetMode === undefined || workbenchPackage?.inspectExportReadiness === undefined) return undefined
    return workbenchPackage.inspectExportReadiness(
      exportModeDialog.workbenchId,
      exportTargetMode === 'offline-embedded' ? 'offline-embedded' : 'online-reference',
    )
  }, [dependencyRefreshTick, exportModeDialog, exportTargetMode, workbenchPackage])
  const exportReviewAllowed = exportTargetMode === undefined
    ? false
    : exportTargetMode === 'layout-only'
      ? canExportLayoutFromReadiness(exportTargetReadiness)
      : canExportFromReadiness(exportTargetReadiness, exportTargetMode)
  const selectedMetadata = selectedWorkbenchId === undefined ? undefined : metadataFor(selectedWorkbenchId)
  const selectedArchived = selectedMetadata?.archivedAt !== undefined
  const selectedLoaded = selectedWorkbenchId === undefined ? false : openWorkbenchIds.includes(selectedWorkbenchId)
  const showingDetail = !legacySettingsView && selectedWorkbenchId !== undefined
  const openWorkbenchDetail = (workbenchId: string) => {
    returnFocusWorkbenchId.current = workbenchId
    setSelectedWorkbenchId(workbenchId)
  }
  const closeWorkbenchDetail = () => {
    setSelectedWorkbenchId(undefined)
    setEditingMetadata(false)
    if (typeof window !== 'undefined') window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`)
  }
  useEffect(() => {
    if (showingDetail || returnFocusWorkbenchId.current === undefined) return
    const workbenchId = returnFocusWorkbenchId.current
    returnFocusWorkbenchId.current = undefined
    const card = workbenchCardRefs.current.get(workbenchId)
    if (card === undefined) return
    card.scrollIntoView({ block: 'center', behavior: 'auto' })
    card.focus()
  }, [showingDetail])
  const beginMetadataEdit = () => {
    if (selectedMetadata === undefined) return
    setMetadataNameDraft(selectedMetadata.name)
    setMetadataDescriptionDraft(selectedMetadata.description)
    setMetadataTagsDraft(selectedWorkbenchId === undefined ? '' : tagsFor(selectedWorkbenchId).join(', '))
    setEditingMetadata(true)
  }
  const saveMetadata = () => {
    if (selectedWorkbenchId === undefined) return
    void workbenchDirectory.updateMetadata(selectedWorkbenchId, {
      name: metadataNameDraft,
      description: metadataDescriptionDraft,
      tags: normalizeWorkbenchTags(metadataTagsDraft.split(/[,，]/u)),
    }).then(result => {
      if (result.status === 'committed') setEditingMetadata(false)
      else setMessage('资料保存失败，请检查名称是否为空或重复。')
    })
  }
  const runPrimaryAction = () => {
    if (selectedWorkbenchId === undefined) return
    if (selectedArchived) {
      void workbenchDirectory.restore(selectedWorkbenchId).then(result => {
        if (result.status !== 'committed') setMessage('恢复工作台失败，请刷新后重试。')
      })
      return
    }
    if (selectedRecord?.packageOrigin !== undefined && workbenchPackage?.activate !== undefined) {
      setPackageBusy(true)
      setPackageOperationPhase('activating')
      void workbenchPackage.activate(selectedWorkbenchId).then(result => {
        if (result.status === 'committed') {
          setMessage('工作台已完成依赖验证并加载，当前对话未被替换。')
        } else if (result.status === 'needs-input') {
          setExternalBindingValues({})
          setExternalBindingDialog({ workbenchId: selectedWorkbenchId, inputs: result.inputs })
          setMessage('工作台依赖已准备，但仍需要绑定本机资源。')
        } else if (result.status === 'conflict') {
          setMessage('Settings 版本发生冲突，工作台未切换，请刷新后重试。')
        } else {
          setMessage(result.reason ?? '工作台依赖尚未就绪，当前布局未改变。')
        }
      }).catch(error => {
        setMessage(error instanceof Error ? error.message : '工作台加载失败，当前布局未改变。')
      }).finally(() => {
        setPackageBusy(false)
        setPackageOperationPhase('idle')
      })
      return
    }
    if (selectedLoaded) {
      if (selectedWorkbenchId === activeWorkbenchId) return
      void workbenchDirectory.select(selectedWorkbenchId).then(result => {
        if (result.status !== 'committed') setMessage('切换工作台失败，当前布局尚未改变。')
      })
      return
    }
    void workbenchDirectory.openAndSelect(selectedWorkbenchId).then(result => {
      if (result.status !== 'committed') setMessage('加载工作台失败，当前布局尚未改变。')
    })
  }
  const exportWorkbench = (workbenchId: string) => {
    downloadJson(
      `dsh-workbench-${workbenchId}.json`, invalid[workbenchId]?.rawRecord ?? workbenches[workbenchId],
    )
  }
  const exportWorkbenchPackage = (workbenchId: string, distributionMode: 'online-reference' | 'offline-embedded') => {
    if (workbenchPackage === undefined) {
      setExportDialogMessage('当前运行时尚未提供工作台分享包导出能力。')
      return
    }
    setPackageBusy(true)
    setExportDialogMessage(`正在生成${distributionMode === 'offline-embedded' ? t('layout.embeddedOfflineArtifacts') : t('layout.onlineReferences')}工作台包…`)
    void (async () => {
      try {
        // Export must observe the same latest layout that the user sees. The
        // lifecycle guard only runs when switching/unmounting; a share action
        // can happen while the frame still has a queued layout patch. Flush
        // with CAS before scanning dependencies or building the archive.
        if (workbenchDirectory.flushBeforeLifecycleTransition !== undefined
          && !await workbenchDirectory.flushBeforeLifecycleTransition()) return
        const result = await workbenchPackage.exportArchive(workbenchId, { distributionMode })
        if (result.status !== 'committed') {
          setExportDialogMessage(result.reason)
          return
        }
        const transactionId = exportPreparationTransactionId
        await downloadArchive(result.filename, result.archive)
        if (transactionId !== undefined && workbenchPackage.exportReadinessCoordinator?.commitPreparation !== undefined) {
          try {
            await workbenchPackage.exportReadinessCoordinator.commitPreparation(transactionId)
            setExportPreparationTransactionId(undefined)
          } catch (error) {
            // The archive is already in the user's download folder. Keep the
            // journaled preparation visible/retryable instead of claiming the
            // local artifact reference was committed when it was not.
            setExportDialogMessage(`分享包已下载，但本机准备收据尚未提交：${error instanceof Error ? error.message : String(error)}。可重试导出确认或取消本次准备。`)
            return
          }
        } else if (transactionId !== undefined) {
          setExportPreparationTransactionId(undefined)
        }
        setExportDialogMessage(result.manifest.completeness === 'layout-only'
          ? '已导出布局级分享包；依赖未达到完整开箱即用条件。'
          : `已导出${distributionMode === 'offline-embedded' ? t('layout.embeddedOfflineArtifacts') : t('layout.onlineReferences')}完整工作台包；依赖锁定和可迁移状态已写入分享包。`)
      } catch (error) {
        setExportDialogMessage(error instanceof Error ? error.message : '工作台包导出失败，当前 Workbench 未改变。')
      } finally {
        setPackageBusy(false)
      }
    })()
  }
  const prepareExportDependencies = (workbenchId: string, mode: 'online-reference' | 'offline-embedded') => {
    const prepareExport = workbenchPackage?.prepareExportDependencies
    if (prepareExport === undefined) {
      setExportDialogMessage('当前 DSH Runtime 未提供安全的依赖准备能力；可保留为布局包，或先配置 Profile/Manager adapter。')
      return
    }
    setPackageBusy(true)
    setPackageOperationPhase('preparing')
    setExportDialogMessage('正在从当前 Runtime 提取并校验依赖制品…')
    void (async () => {
      try {
        // Preparation and its readiness scan must use the same persisted
        // revision as the eventual archive. Never prepare artifacts for a
        // stale layout that is still queued in the Frame.
        if (workbenchDirectory.flushBeforeLifecycleTransition !== undefined
          && !await workbenchDirectory.flushBeforeLifecycleTransition()) return
        const inspection = workbenchPackage?.inspectExportReadiness?.(workbenchId, mode)
        const result = await prepareExport({
          workbenchId, mode,
          ...(inspection === undefined ? {} : {
            issueIds: inspection.repairable.filter(item => isAutomaticExportRepair(item.repair)).map(item => item.issueId),
          }),
        }, {
          approvedPermissions: Object.entries(exportPermissionApprovals).filter(([, approved]) => approved).map(([permission]) => permission),
          networkApproved: exportPermissionApprovals.network === true,
          allowScripts: false,
        })
        if (result.status === 'committed') {
          setExportPreparationTransactionId(result.transactionId)
          setDependencyRefreshTick(value => value + 1)
          setExportDialogMessage('依赖准备完成，已重新扫描当前工作台；请确认结果后再导出。')
        } else {
          setExportDialogMessage(result.reason)
        }
      } catch (error) {
        setExportDialogMessage(error instanceof Error ? error.message : '依赖准备失败，当前 Workbench 未改变。')
      } finally {
        setPackageBusy(false)
        setPackageOperationPhase('idle')
      }
    })()
  }
  const openExportPackageDialog = (workbenchId: string) => {
    // Readiness is meaningful only after the Frame's queued layout has been
    // persisted. Keep the dialog opening behind the same CAS flush used by
    // preparation/export so its issue list cannot describe an old revision.
    setPackageBusy(true)
    void (async () => {
      try {
        if (workbenchDirectory.flushBeforeLifecycleTransition !== undefined
          && !await workbenchDirectory.flushBeforeLifecycleTransition()) return
        const snapshot = workbenchPackage?.inspectDependencies?.(workbenchId)
        const mode = snapshot?.completeness === 'complete-offline' ? 'offline-embedded' : 'online-reference'
        const inspection = workbenchPackage?.inspectExportReadiness?.(workbenchId, mode)
        const permissions = [...new Set((inspection === undefined ? [] : [...inspection.ready, ...inspection.repairable]
          .flatMap(item => item.requiredPermissions)
          .filter(permission => WORKBENCH_HIGH_RISK_PERMISSIONS_V1.includes(permission as never))))]
        setExportPermissionApprovals(Object.fromEntries(permissions.map(permission => [permission, false])))
        setExportPreparationTransactionId(undefined)
        setExportDialogMessage(undefined)
        setMessage(undefined)
        setExportDialogStep('readiness')
        setExportTargetMode(undefined)
        setExportModeDialog({ workbenchId, mode })
      } finally {
        setPackageBusy(false)
      }
    })()
  }
  const selectExportMode = (mode: 'online-reference' | 'offline-embedded') => {
    if (exportModeDialog === undefined) return
    if (mode !== exportModeDialog.mode) {
      const previousTransactionId = exportPreparationTransactionId
      if (previousTransactionId !== undefined) void workbenchPackage?.exportReadinessCoordinator?.cancelPreparation(previousTransactionId)
      setExportPreparationTransactionId(undefined)
    }
    const inspection = workbenchPackage?.inspectExportReadiness?.(exportModeDialog.workbenchId, mode)
    const permissions = [...new Set((inspection === undefined ? [] : [...inspection.ready, ...inspection.repairable]
      .flatMap(item => item.requiredPermissions)
      .filter(permission => WORKBENCH_HIGH_RISK_PERMISSIONS_V1.includes(permission as never))))]
    setExportPermissionApprovals(Object.fromEntries(permissions.map(permission => [permission, false])))
    setExportDialogMessage(undefined)
    setExportDialogStep('readiness')
    setExportTargetMode(undefined)
    setExportModeDialog({ ...exportModeDialog, mode })
  }

  const openExportReview = (target: WorkbenchExportTargetModeV1) => {
    if (exportModeDialog === undefined) return
    setExportDialogMessage(undefined)
    setExportTargetMode(target)
    setExportDialogStep('review')
  }
  const openPackagePicker = () => {
    packageFileInputRef.current?.click()
  }
  const handlePackageFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    if (file === undefined || workbenchPackage === undefined) return
    setPackageBusy(true)
    setPackageOperationPhase('reading')
    setPackageImportProgress(undefined)
    setPackageImportConfirmed(false)
    setPackageDependenciesChecking(false)
    setPackageDependenciesChecked(false)
    setPackageDependencyCheckError(undefined)
    setPackageRestartPrompt(undefined)
    void (async () => {
      try {
        const archive = new Uint8Array(await file.arrayBuffer())
        setPackageOperationPhase('preflight')
        const report = await (workbenchPackage.preflight?.(archive) ?? workbenchPackage.preflightArchive(archive))
        // Show the package shell immediately after the bounded archive scan so
        // the user can see that local dependency inspection is a distinct,
        // non-mutating step rather than an invisible install side effect.
        setPackageDialog({ fileName: file.name, archive, report, dependencies: [] })
        setPackageOperationPhase('checking-local')
        setPackageDependenciesChecking(true)
        setPackageDependencyCheckError(undefined)
        setPackageImportProgress({ phase: 'checking-local', current: 0, total: 1, label: '正在检查本机已安装的插件与制品…' })
        const dependencies = workbenchPackage.inspectImportDependencies === undefined
          ? fallbackImportDependencyInspection(report, editors)
          : await workbenchPackage.inspectImportDependencies(report)
        setPackageDependenciesChecking(false)
        setPackageDependenciesChecked(true)
        setPackageDependencyCheckError(undefined)
        setPackageImportProgress({ phase: 'checking-local', current: 1, total: 1, label: '本机依赖检查完成' })
        setPackageResumeTransactionId(undefined)
        setPackageSessionTargets(Object.fromEntries((report.sessions?.templates ?? []).map(template => [template.templateId, ''])))
        setPackagePermissionApprovals(Object.fromEntries(report.permissions
          .filter(permission => WORKBENCH_HIGH_RISK_PERMISSIONS_V1.includes(permission as never))
          .map(permission => [permission, false])))
        setPackageDialog(current => current === undefined ? undefined : { ...current, dependencies })
      } catch (error) {
        setPackageDependenciesChecked(false)
        setPackageDependencyCheckError(error instanceof Error ? error.message : '本机依赖检查失败。')
        setMessage(error instanceof Error ? error.message : '无法读取工作台包。')
      } finally {
        setPackageDependenciesChecking(false)
        setPackageBusy(false)
        setPackageOperationPhase('idle')
      }
    })()
  }
  const cancelPackageImport = () => {
    if (packageBusy) return
    setPackageDialog(undefined)
    setPackageSessionTargets({})
    setPackagePermissionApprovals({})
    setPackageResumeTransactionId(undefined)
    setPackageImportProgress(undefined)
    setPackageImportConfirmed(false)
    setPackageDependenciesChecking(false)
    setPackageDependenciesChecked(false)
    setPackageDependencyCheckError(undefined)
    setPackageRestartPrompt(undefined)
    setPackageOperationPhase('idle')
  }
  const deferPackageRestart = () => {
    if (packageRestartPrompt === undefined) return
    writeWorkbenchImportResumeId(packageRestartPrompt.transactionId)
    setPackageRestartPrompt(undefined)
    setPackageOperationPhase('idle')
    setMessage(`依赖已安装，但需要重启 Runtime 后才能完成验证。事务 ${packageRestartPrompt.transactionId} 已保留，可稍后继续。`)
  }
  const requestPackageRestart = () => {
    if (packageRestartPrompt === undefined) return
    const requestRestart = workbenchPackage?.requestRestart
    const restartAvailable = workbenchPackage?.restartAvailable?.()
      ?? (requestRestart !== undefined && packageRuntimeStatus?.authority !== 'browser')
    if (requestRestart === undefined || !restartAvailable) {
      setMessage('当前启动方式不支持一键安全重启。请先关闭此 DSH 实例，再使用相同 Profile 重新启动，然后返回此窗口继续验证。')
      return
    }
    setPackageBusy(true)
    setPackageOperationPhase('waiting-restart')
    void Promise.resolve(requestRestart(packageRestartPrompt.transactionId)).then(() => {
      setMessage('重启请求已提交，请等待新实例就绪和导入事务验证。')
    }).catch(error => {
      setMessage(error instanceof Error ? error.message : 'Runtime 重启请求失败；依赖仍保留在待验证事务中。')
    }).finally(() => setPackageBusy(false))
  }
  const confirmPackageImport = () => {
    if (packageDialog === undefined || workbenchPackage === undefined || !packageDialog.report.valid) return
    setPackageBusy(true)
    setPackageImportConfirmed(true)
    setPackageRestartPrompt(undefined)
    setPackageOperationPhase('scanning-package')
    setPackageImportProgress({ phase: 'scanning-package', current: 0, total: 1, label: '正在扫描离线分享包…' })
    void (async () => {
      const onProgress = (progress: WorkbenchPackageImportProgressV1): void => {
        setPackageImportProgress(progress)
        setPackageOperationPhase(progress.phase === 'scanning-package' ? 'scanning-package'
          : progress.phase === 'staging-artifacts' ? 'staging-artifacts'
            : progress.phase === 'installing-dependencies' ? 'installing-dependencies'
              : progress.phase === 'activating-dependencies' ? 'activating'
                : progress.phase === 'verifying-editors' ? 'verifying-editors'
                  : progress.phase === 'restoring-state' ? 'restoring-state'
                    : progress.phase === 'committing' ? 'committing'
                      : progress.phase === 'waiting-restart' ? 'waiting-restart' : 'preparing')
      }
      const templateBindings: Record<string, SessionBindingV1> = {}
      for (const template of packageDialog.report.sessions?.templates ?? []) {
        const selection = packageSessionTargets[template.templateId] ?? ''
        if (selection.startsWith('session:')) {
          const sessionId = selection.slice('session:'.length)
          const workspace = workspaceSnapshot.items.find(item => item.sessionIds.includes(sessionId as never))
          templateBindings[template.templateId] = {
            ...(workspace === undefined ? {} : { workspaceId: String(workspace.workspaceId) }),
            sessionId,
          }
        }
      }
      const approvedPermissions = Object.entries(packagePermissionApprovals)
        .filter(([, approved]) => approved)
        .map(([permission]) => permission)
      const sessionBindingOptions = Object.keys(templateBindings).length === 0
        ? {} : { sessionTemplateBindings: templateBindings }
      const transactionOption = packageResumeTransactionId === undefined ? {} : { transactionId: packageResumeTransactionId }
      if (workbenchPackage.prepare !== undefined && workbenchPackage.bind !== undefined) {
        const prepareOptions = approvedPermissions.length === 0
          ? { ...transactionOption, onProgress }
          : { ...transactionOption, approvedPermissions, onProgress }
        const prepared = await workbenchPackage.prepare(packageDialog.archive, prepareOptions)
        if (prepared.status !== 'ready-to-bind') {
          if (prepared.status === 'preflight-failed' || prepared.status === 'conflict'
            || prepared.status === 'unavailable' || prepared.status === 'waiting-restart') return prepared
          return { status: 'unavailable' as const, reason: '工作台依赖准备未完成。' }
        }
        setPackageOperationPhase('binding')
        const bound = await workbenchPackage.bind(prepared.workbenchId, sessionBindingOptions)
        if (bound.status !== 'committed') return bound.status === 'conflict'
          ? bound
          : { status: 'unavailable' as const, reason: bound.reason }
        return { status: 'committed' as const, workbenchId: bound.workbenchId, revision: bound.revision }
      }
      if (workbenchPackage.prepareImport !== undefined) {
        return approvedPermissions.length === 0
          ? workbenchPackage.prepareImport(packageDialog.archive, { ...sessionBindingOptions, ...transactionOption, onProgress })
          : workbenchPackage.prepareImport(packageDialog.archive, { ...sessionBindingOptions, ...transactionOption, approvedPermissions, onProgress })
      }
      const shouldPrepareDependencies = packageDialog.report.manifest?.schemaVersion === 2
        && packageDialog.report.manifest.completeness !== 'layout-only'
      const legacyImportOptions = {
        // Older host adapters may not expose prepareImport yet. Preserve the
        // product contract in that compatibility path. Complete v2 packages
        // still prepare and verify dependencies; v1/layout-only packages
        // remain safe layout imports because their plugin list is not proof of
        // an installable artifact. loadAfterImport is always false so the new
        // Workbench stays inactive.
        installPlugins: shouldPrepareDependencies,
        loadAfterImport: false,
        ...sessionBindingOptions,
        ...transactionOption,
        ...(approvedPermissions.length === 0 ? {} : { approvedPermissions }),
      }
      return workbenchPackage.importArchive(packageDialog.archive, legacyImportOptions)
    })().then((result: WorkbenchPackageImportResultV1) => {
      if (result.status === 'committed') {
        const importedName = packageDialog.report.manifest?.name ?? t('shell.workbench')
        setPackageDialog(undefined)
        setPackageSessionTargets({})
        setPackagePermissionApprovals({})
        setPackageResumeTransactionId(undefined)
        setCategory('inactive')
        pendingImportedWorkbenchId.current = result.workbenchId
        setSelectedWorkbenchId(result.workbenchId)
        setMessage(`已导入“${importedName}”，并已准备依赖；工作台已放入未使用，当前工作不受影响。`)
      } else if (result.status === 'preflight-failed') {
        setPackageDialog(current => current === undefined ? undefined : { ...current, report: result.report })
        setMessage('工作台包预检未通过，未修改当前设置。')
      } else if (result.status === 'conflict') {
        setMessage('Settings 版本发生冲突，导入已中止，请刷新后重试。')
      } else if (result.status === 'waiting-restart') {
        writeWorkbenchImportResumeId(result.transactionId)
        setPackageResumeTransactionId(result.transactionId)
        setPackageRestartPrompt({ transactionId: result.transactionId, reason: result.reason })
        setPackageOperationPhase('waiting-restart')
        setPackageImportProgress({ phase: 'waiting-restart', current: 1, total: 1, label: '依赖需要重启 Runtime 后继续验证', requiresRestart: true })
        setMessage(`依赖已准备，Runtime 要求重启后继续验证（事务 ${result.transactionId}）。`)
      } else {
        setMessage(result.reason ?? '工作台包导入失败，未修改当前设置。')
      }
    }).catch(error => {
      setMessage(error instanceof Error ? error.message : '工作台包导入失败，未修改当前设置。')
    }).finally(() => {
      setPackageBusy(false)
      setPackageOperationPhase('idle')
    })
  }
  const closeExternalBindingDialog = () => {
    if (packageBusy) return
    setExternalBindingDialog(undefined)
    setExternalBindingValues({})
  }
  const submitExternalBindings = () => {
    if (externalBindingDialog === undefined || workbenchPackage?.bind === undefined) return
    const inputs: Record<string, WorkbenchExternalBindingRefV1> = {}
    for (const input of externalBindingDialog.inputs) {
      const reference = (externalBindingValues[input.id] ?? '').trim()
      if (input.required && reference === '') {
        setMessage(`请先填写“${input.label}”。`)
        return
      }
      if (reference === '') continue
      inputs[input.id] = { kind: input.kind, reference }
    }
    setPackageBusy(true)
    setPackageOperationPhase('binding')
    void workbenchPackage.bind(externalBindingDialog.workbenchId, { inputs }).then(result => {
      if (result.status === 'committed') {
        setExternalBindingDialog(undefined)
        setExternalBindingValues({})
        setMessage(result.pendingInputs.some(input => input.required && input.status !== 'satisfied')
          ? '绑定已保存，但仍有必需资源未满足。'
          : '本机资源绑定已保存，请再次点击“加载并切换”。')
      } else if (result.status === 'conflict') {
        setMessage('Settings 版本发生冲突，绑定未保存，请刷新后重试。')
      } else {
        setMessage(result.reason)
      }
    }).catch(error => {
      setMessage(error instanceof Error ? error.message : '本机资源绑定失败。')
    }).finally(() => {
      setPackageBusy(false)
      setPackageOperationPhase('idle')
    })
  }
  const remove = (workbenchId: string) => {
    const removal = workbenchDirectory === EMPTY_WORKBENCH_DIRECTORY && injectedDirectory === undefined && propsRemoveWorkbench !== undefined
      ? propsRemoveWorkbench(workbenchId).then(ok => ({ status: ok ? 'committed' : 'unavailable' } as const))
      : workbenchDirectory.remove(workbenchId)
    void removal.then((result) => {
      const name = workbenches[workbenchId]?.name ?? workbenchId
      const ok = result.status === 'committed'
      setMessage(ok ? `已删除工作台“${name}”。` : `无法删除工作台“${name}”。`)
    })
  }
  const unapprovedHighRiskPermissions = (packageDialog?.report.permissions ?? []).filter(permission =>
    WORKBENCH_HIGH_RISK_PERMISSIONS_V1.includes(permission as never) && packagePermissionApprovals[permission] !== true)
  const packageNeedsDistributionRuntime = packageDialog?.report.manifest?.schemaVersion === 2
    && packageDialog.report.manifest.completeness !== 'layout-only'
  const packageRuntimeBlocked = packageNeedsDistributionRuntime && packageRuntimeStatus?.available !== true
  return (
    <section className={css.settingsWorkbenchSection}>
      <input
        ref={packageFileInputRef}
        className={css.settingsPackageFileInput}
        type="file"
        accept=".dsh-workbench-package,.zip,application/zip"
        aria-label={t('layout.chooseWorkbenchPackage')}
        onChange={handlePackageFile}
      />
      {!showingDetail ? <>
        <header className={css.settingsWorkbenchIntro}>
          <div className={css.settingsWorkbenchIntroCopy}>
            <h2>{t('share.workbenchLayout')}</h2>
            <p>{t('layout.workbenchesStoreAreasPagesAndModuleCombinations')}</p>
          </div>
        </header>
        <div className={css.settingsWorkbenchToolbar}>
          <label className={css.settingsWorkbenchSearch}>
            <span aria-hidden="true">⌕</span>
            <input
              type="search"
              value={searchQuery}
              aria-label={t('home.searchWorkbenches')}
              placeholder={t('layout.searchNamesDescriptionsOrTags')}
              onChange={event => setSearchQuery(event.target.value)}
            />
            {searchQuery === '' ? null : <button type="button" aria-label={t('layout.clearWorkbenchSearch')} onClick={() => setSearchQuery('')}>×</button>}
          </label>
          {workbenchPackage === undefined ? null : <div className={css.settingsWorkbenchImportAction}>
            {packageRuntimeStatus === undefined ? null : <span data-state={packageRuntimeStatus.available ? 'ready' : 'limited'}>
              {packageRuntimeStatus.available ? packageRuntimeStatus.label : '仅布局导入'}
            </span>}
            <button type="button" data-action="primary" disabled={packageBusy} onClick={openPackagePicker}>
              {packageBusy ? '处理中…' : t('home.importWorkbenchPackage')}
            </button>
          </div>}
        </div>
        <div className={css.settingsWorkbenchTabs} role="tablist" aria-label={t('layout.workbenchCategory')}>
          {([['open', `使用中 ${workbenchIds.filter(id => openWorkbenchIds.includes(id)).length}`], ['inactive', `未使用 ${workbenchIds.filter(id => !openWorkbenchIds.includes(id) && metadataFor(id)?.archivedAt === undefined).length}`], ['archived', `已归档 ${workbenchIds.filter(id => metadataFor(id)?.archivedAt !== undefined).length}`]] as const).map(([id, label], index, tabs) => (
            <button key={id} type="button" role="tab" id={`workbench-tab-${id}`} aria-controls={`workbench-panel-${id}`} aria-selected={category === id} tabIndex={category === id ? 0 : -1}
              onClick={() => { setCategory(id); setSelectedWorkbenchId(undefined) }}
              onKeyDown={event => {
                if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
                event.preventDefault(); const next = tabs[(index + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length]?.[0]
                if (next !== undefined) { setCategory(next); setSelectedWorkbenchId(undefined) }
              }}>{label}</button>
          ))}
        </div>
      </> : null}
      <div role="tabpanel" id={`workbench-panel-${category}`} aria-labelledby={showingDetail ? undefined : `workbench-tab-${category}`} aria-label={showingDetail ? `${selectedMetadata?.name ?? t('shell.workbench')}详情` : undefined} tabIndex={0}>
      {!legacySettingsView && selectedWorkbenchId === undefined ? (
        <div className={css.settingsWorkbenchCards}>
          {visibleWorkbenchIds.length === 0 ? <p className={css.settingsEmptyState}>{t('layout.noWorkbenchesInThisCategory')}</p> : visibleWorkbenchIds.map(workbenchId => {
            const record = workbenches[workbenchId]
            const inventory = inventories.get(workbenchId)
            const previewModel: WorkbenchPreviewModel | undefined = record && inventory
              ? deriveWorkbenchPreviewModel(record.document, inventory, editors, previewSessions)
              : undefined
            return <article key={workbenchId} ref={element => { if (element === null) workbenchCardRefs.current.delete(workbenchId); else workbenchCardRefs.current.set(workbenchId, element) }} className={css.settingsWorkbenchCard} tabIndex={0} onClick={() => openWorkbenchDetail(workbenchId)} onKeyDown={event => { if (event.key === 'Enter') openWorkbenchDetail(workbenchId) }}>
              <div className={css.settingsCardPreview}>{previewModel === undefined ? <span>{t('layout.layoutUnavailable')}</span> : <WorkbenchLayoutPreviewSvg model={previewModel} ariaLabel={`${record?.name ?? workbenchId}布局预览`} />}</div>
              <div className={css.settingsCardBody}><div className={css.settingsWorkbenchNameLine}><strong>{record?.name ?? invalid[workbenchId]?.name ?? workbenchId}</strong>{workbenchId === activeWorkbenchId ? <span className={css.settingsCurrentBadge}>{t('settings.current2')}</span> : null}</div><p>{record?.description || invalid[workbenchId]?.description || '暂无简介'}</p>{tagsFor(workbenchId).length === 0 ? null : <div className={css.settingsWorkbenchTags} aria-label={t('layout.workbenchTags')}>{tagsFor(workbenchId).map(tag => <span key={tag}>{tag}</span>)}</div>}<small>{record && inventory ? `插件 ${inventory.plugins.length}` : '插件：未知'} {t('layout.lastModified')}{workbenchTimestamp(record?.updatedAt ?? invalid[workbenchId]?.updatedAt ?? 0) ?? '未知'} {t('layout.authorMe')}</small><div className={css.settingsCardActions}><button type="button" aria-pressed={record?.pinnedAt !== undefined || invalid[workbenchId]?.pinnedAt !== undefined} onClick={event => { event.stopPropagation(); void workbenchDirectory.setPinned(workbenchId, !(record?.pinnedAt !== undefined || invalid[workbenchId]?.pinnedAt !== undefined)).then(result => { if (result.status !== 'committed') setMessage('置顶状态保存失败，请刷新后重试。') }) }}>{record?.pinnedAt !== undefined || invalid[workbenchId]?.pinnedAt !== undefined ? '取消置顶' : '置顶'}</button>{category === 'archived' ? <button type="button" aria-label={`恢复工作台“${record?.name ?? invalid[workbenchId]?.name ?? workbenchId}”`} onClick={event => { event.stopPropagation(); void workbenchDirectory.restore(workbenchId).then(result => { if (result.status !== 'committed') setMessage('恢复工作台失败，请刷新后重试。') }) }}>{t('home.restore')}</button> : <button type="button" aria-label={`归档工作台“${record?.name ?? invalid[workbenchId]?.name ?? workbenchId}”`} onClick={event => { event.stopPropagation(); void workbenchDirectory.archive(workbenchId).then(result => { if (result.status !== 'committed') setMessage('归档工作台失败，请刷新后重试。') }) }}>{t('layout.archive')}</button>}</div></div>
            </article>
          })}
        </div>
      ) : workbenchIds.length === 0
        ? <p className={css.settingsEmptyState}>{t('layout.noSavedWorkbenches')}</p>
        : (
          <div className={css.settingsWorkbenchGrid} data-details={!legacySettingsView && selectedWorkbenchId !== undefined || undefined}>
            {legacySettingsView || selectedWorkbenchId === undefined ? <div className={css.settingsWorkbenchRoster}>
              <h3>{t('layout.savedWorkbenches')}</h3>
              <ul aria-label={t('layout.savedWorkbenches')}>
                {workbenchIds.map(workbenchId => {
                  const record = workbenches[workbenchId]
                  const inventory = inventories.get(workbenchId)
                  const name = record?.name ?? t('layout.unreadableWorkbench')
                  return (
                    <li key={workbenchId} data-selected={workbenchId === selectedWorkbenchId || undefined}>
                      <button
                        type="button"
                        className={css.settingsWorkbenchSelect}
                        aria-pressed={workbenchId === selectedWorkbenchId}
                        onClick={() => { setSelectedWorkbenchId(workbenchId) }}
                      >
                        <span className={css.settingsWorkbenchNameLine}>
                          <strong>{name}</strong>
                          {workbenchId === activeWorkbenchId
                            ? <span className={css.settingsCurrentBadge}>{t('settings.current2')}</span> : null}
                        </span>
                        <code>{workbenchId}</code>
                        {record === undefined
                          ? <small data-state="missing">{t('layout.unsupportedVersion')}</small>
                          : <small>{inventory?.areas.length ?? 0} {t('layout.areas')} {inventory?.pageCount ?? 0} {t('layout.pages')} {inventory?.plugins.length ?? 0} {t('layout.plugins')}</small>}
                      </button>
                      <div className={css.settingsWorkbenchRowActions}>
                        <button type="button" onClick={() => { exportWorkbench(workbenchId) }}>{t('layout.exportConfiguration')}</button>
                        <button
                          type="button"
                          disabled={workbenchId === activeWorkbenchId}
                          title={workbenchId === activeWorkbenchId ? '请先切换到其他工作台' : undefined}
                          onClick={() => { remove(workbenchId) }}
                        >{t('editor.delete')}</button>
                      </div>
                    </li>
                  )
                })}
              </ul>
            </div> : null}
            <div className={css.settingsWorkbenchDetail}>
              {!legacySettingsView && selectedWorkbenchId !== undefined ? (
                <header id="workbench-detail-top" className={css.settingsDetailToolbar}>
                  <div className={css.settingsDetailToolbarTop}>
                    <button className={css.settingsDetailBack} type="button" onClick={closeWorkbenchDetail}><span aria-hidden="true">‹</span> {t('layout.backToWorkbenches')}</button>
                    <span className={css.settingsDetailState}>{selectedArchived ? '已归档' : selectedLoaded && selectedWorkbenchId === activeWorkbenchId ? '当前使用中' : selectedLoaded ? '已加载' : selectedRecord?.packageOrigin !== undefined ? '待加载' : '未加载'}</span>
                  </div>
                  {editingMetadata ? (
                    <div className={css.settingsEditForm}>
                      <label>{t('home.name')}<input aria-label={t('shell.workbenchName')} value={metadataNameDraft} onChange={event => setMetadataNameDraft(event.target.value)} /></label>
                      <label>{t('settings.description')}<textarea aria-label={t('layout.workbenchDescription')} rows={3} value={metadataDescriptionDraft} onChange={event => setMetadataDescriptionDraft(event.target.value)} /></label>
                      <label>{t('settings.tags')}<input aria-label={t('layout.workbenchTags')} value={metadataTagsDraft} placeholder={t('layout.eGDevelopmentTwoColumnsAgent')} onChange={event => setMetadataTagsDraft(event.target.value)} /></label>
                      <div><button type="button" onClick={saveMetadata}>{t('settings.saveDetails')}</button><button type="button" onClick={() => setEditingMetadata(false)}>{t('action.cancel')}</button></div>
                    </div>
                  ) : (
                    <div className={css.settingsDetailHero}>
                      <div className={css.settingsDetailTitle}>
                        <span>{t('settings.workbenchDetails')}</span><h3>{selectedMetadata?.name ?? t('layout.unreadableWorkbench')}</h3><p>{selectedMetadata?.description || '暂无简介'}</p>{selectedWorkbenchId === undefined || tagsFor(selectedWorkbenchId).length === 0 ? null : <div className={css.settingsWorkbenchTags} aria-label={t('layout.workbenchTags')}>{tagsFor(selectedWorkbenchId).map(tag => <span key={tag}>{tag}</span>)}</div>}{selectedRecord?.packageOrigin === undefined ? null : <small>{t('layout.basedOn')} {selectedRecord.packageOrigin.packageId} {t('layout.editableAndShareable')}</small>}
                      </div>
                      <div className={css.settingsDetailActions}>
                        <button type="button" data-action="secondary" onClick={beginMetadataEdit} disabled={selectedRecord === undefined}>{t('layout.editDetails')}</button>
                        {selectedRecord?.packageOrigin !== undefined && workbenchPackage?.bind !== undefined && packageRuntimeReadiness?.status === 'needs-input'
                          ? <button type="button" data-action="secondary" disabled={packageBusy} onClick={() => {
                              if (selectedWorkbenchId === undefined) return
                              setExternalBindingValues({})
                              setExternalBindingDialog({ workbenchId: selectedWorkbenchId, inputs: packageRuntimeReadiness.requiredInputs })
                            }}>{t('layout.connectLocalResources')}</button>
                          : null}
                        {selectedInvalid !== undefined && selectedArchived ? <button type="button" onClick={runPrimaryAction}>{t('home.restore')}</button>
                          : selectedArchived ? <button type="button" onClick={runPrimaryAction}>{t('home.restore')}</button>
                            : selectedLoaded && selectedWorkbenchId === activeWorkbenchId ? null
                              : <button type="button" data-action="primary" disabled={packageBusy} onClick={runPrimaryAction}>{selectedLoaded ? '切换到此工作台' : selectedRecord?.packageOrigin !== undefined ? '验证并加载' : '加载并切换'}</button>}
                        <button type="button" data-action="secondary" aria-pressed={selectedMetadata?.pinnedAt !== undefined} onClick={() => { if (selectedWorkbenchId !== undefined) void workbenchDirectory.setPinned(selectedWorkbenchId, selectedMetadata?.pinnedAt === undefined).then(result => { if (result.status !== 'committed') setMessage('置顶状态保存失败，请刷新后重试。') }) }}>{selectedMetadata?.pinnedAt === undefined ? '置顶' : '取消置顶'}</button>
                        {!selectedArchived ? <button type="button" data-action="danger" onClick={() => { if (selectedWorkbenchId !== undefined) void workbenchDirectory.archive(selectedWorkbenchId).then(result => { if (result.status !== 'committed') setMessage('归档工作台失败，请刷新后重试。') }) }}>{t('layout.archive')}</button> : null}
                      </div>
                    </div>
                  )}
              </header>
              ) : null}
              {!legacySettingsView && selectedWorkbenchId !== undefined && !editingMetadata && selectedRecord !== undefined ? <nav className={css.settingsDetailSectionNav} aria-label={t('layout.workbenchDetailsSections')}>
                <a href="#workbench-detail-top">{t('layout.overview')}</a>
                <a href="#workbench-detail-layout">{t('layout.layout')}</a>
                <a href="#workbench-detail-pages">{t('layout.pages2')}</a>
                <a href="#workbench-detail-plugins">{t('layout.pluginDependencies')}</a>
                <a href="#workbench-detail-export">{t('layout.exportAndDangerZone')}</a>
              </nav> : null}
              {selectedRecord === undefined || selectedInventory === undefined ? (
                <div className={css.settingsUnsupportedWorkbench}>
                  <span>Unsupported document</span>
                  <h3>{t('layout.unreadableWorkbench')}</h3>
                  <p>{t('layout.thisVersionCannotReadTheConfigurationExport')}</p>
                  {selectedWorkbenchId === undefined ? null : (
                    <button type="button" onClick={() => { exportWorkbench(selectedWorkbenchId) }}>
                      {t('layout.exportOriginalConfiguration')}
                    </button>
                  )}
                  {selectedInvalid === undefined ? null : <code>{selectedWorkbenchId}</code>}
                </div>
              ) : (
                <>
                  <header className={css.settingsDetailHeader}>
                    <div>
                      <span>{t('layout.layoutSummary')}</span>
                      {legacySettingsView ? <h3>{selectedRecord.name}</h3> : null}
                      <p>{t('layout.splitRatiosAreaOrderAndActivePage')}</p>
                    </div>
                    <div className={css.settingsDetailStats} aria-label={t('layout.workbenchCounts')}>
                      <span><strong>{selectedInventory.areas.length}</strong>{t('layout.areas2')}</span>
                      <span><strong>{selectedInventory.pageCount}</strong>{t('home.pages')}</span>
                      <span><strong>{selectedInventory.plugins.length}</strong>{t('layout.plugins')}</span>
                      <span><strong>{selectedDependencySnapshot?.dynamicPackages.length ?? 0}</strong>{t('layout.dynamic')}</span>
                      <span><strong>{selectedDependencySnapshot?.agentPresetPackages?.length ?? 0}</strong>Agent</span>
                    </div>
                  </header>
                  <section id="workbench-detail-layout" className={css.settingsLayoutSection}>
                    <div className={css.settingsSectionHeading}>
                      <div><span>{t('layout.structure')}</span><h4>{t('settings.layoutPreview')}</h4></div>
                      {workbenchTimestamp(selectedRecord.updatedAt) === undefined ? null : (
                        <small>{t('layout.updated')} {workbenchTimestamp(selectedRecord.updatedAt)}</small>
                      )}
                    </div>
                    <div
                      className={css.settingsLayoutPreview}
                      role="img"
                      aria-label={`${selectedRecord.name}，${String(selectedInventory.areas.length)} 个容器`}
                    >
                      <WorkbenchPreviewInspectorLayoutNode
                        node={deriveWorkbenchPreviewModel(selectedRecord.document, selectedInventory, editors, previewSessions).root}
                      />
                    </div>
                    <div className={css.settingsLayoutLegend}>
                       <span><i data-tone="active" />{t('layout.theDiagramShowsSplitsActivePagesAnd')}</span>
                       <span><i data-tone="history" />{t('layout.eachAreaKeepsItsActivePageDsh')}</span>
                    </div>
                  </section>
                  <section id="workbench-detail-pages" className={css.settingsCompositionSection}>
                    <div className={css.settingsSectionHeading}>
                      <div><span>{t('layout.content')}</span><h4>{t('layout.areasAndPages')}</h4></div>
                      <small>{selectedInventory.missingPageCount === 0
                        ? '所有内页均可用'
                        : `${String(selectedInventory.missingPageCount)} 个内页当前不可用`}</small>
                    </div>
                    <div className={css.settingsAreaList}>
                       {selectedInventory.areas.map(area => {
                         return <article key={area.areaId} className={css.settingsAreaCard}>
                           <header>
                             <span>{t('layout.areas2')} {String(area.ordinal).padStart(2, '0')}</span>
                             <code>{area.areaId}</code>
                             <small>{area.pages.length === 0 ? '无当前内页' : t('layout.currentPage')}</small>
                           </header>
                           {area.pages.length === 0 ? <p>{t('share.emptyArea')}</p> : (
                             <ul>
                               {area.pages.map(page => (
                                 <li key={page.moduleInstanceId} data-active={page.active || undefined}>
                                   <span className={css.settingsPageState}>{t('layout.currentPage')}</span>
                                  <div>
                                    <strong>{page.name}</strong>
                                    <code>{page.editorId}</code>
                                  </div>
                                  <span className={css.settingsPagePlugin}>
                                    {page.pluginId ?? '插件来源待确认'}
                                  </span>
                                  <span className={css.settingsPageAvailability} data-state={page.available ? 'available' : 'missing'}>
                                    {page.available ? '可用' : '缺失'}
                                  </span>
                                </li>
                               ))}
                             </ul>
                           )}
                         </article>
                      })}
                    </div>
                  </section>
                  <section id="workbench-detail-plugins" className={css.settingsCompositionSection}>
                    <details className={css.settingsPluginDetails}>
                      <summary>
                        <div><span>{t('layout.dependencies')}</span><h4>{t('layout.requiredPlugins')}</h4></div>
                        <small>{selectedDependencySnapshot === undefined
                          ? `${selectedInventory.plugins.length} 个插件 · 点击展开`
                          : `${selectedDependencySnapshot.dependencies.length} 个依赖 · ${selectedDependencyScan?.npmDependencies.length ?? 0} 个 npm · ${selectedDependencySnapshot.completeness}`}</small>
                      </summary>
                      <div className={css.settingsPluginList}>
                        {selectedDependencySnapshot !== undefined ? (
                          <>
                            <p>{t('layout.onlyActivePagesContributeDependenciesPreviousPages')}</p>
                            {packageRuntimeStatus === undefined ? null : <div className={css.settingsRuntimeCapability} data-state={packageRuntimeStatus.available ? 'ready' : 'limited'}>
                              <div><strong>{packageRuntimeStatus.label}</strong><span>{packageRuntimeStatus.available ? '持久安装链路已就绪' : '当前只能安全导入布局包'}</span></div>
                              {packageRuntimeStatus.blockers.length === 0 ? null : <small>{packageRuntimeStatus.blockers.join(' · ')}</small>}
                            </div>}
                            {packageRuntimeReadiness === undefined || packageRuntimeReadiness.requiredInputs.every(input => input.status === 'satisfied') ? null : <div className={css.settingsRuntimeCapability} data-state="limited">
                              <div><strong>{t('layout.reconnectAfterImport')}</strong><span>{packageRuntimeReadiness.requiredInputs.filter(input => input.status !== 'satisfied').map(input => input.label).join('、')}</span></div>
                            </div>}
                            {packageRuntimeReadiness === undefined || packageRuntimeReadiness.status === 'ready' ? null : <div className={css.settingsRuntimeCapability} data-state="limited">
                              <div><strong>{packageRuntimeReadiness.status === 'needs-input' ? 'Runtime 等待绑定' : packageRuntimeReadiness.status === 'blocked' ? 'Runtime 依赖被阻塞' : 'Runtime 就绪状态未知'}</strong><span>{packageRuntimeReadiness.blockers.map(blocker => blocker.message).join('；') || packageRuntimeReadiness.warnings.map(warning => warning.message).join('；')}</span></div>
                            </div>}
                            {selectedDependencySnapshot.blockers.length > 0 ? <ul className={css.settingsPackageDialogIssues}>{selectedDependencySnapshot.blockers.map((issue: WorkbenchDependencyIssueV1, index: number) => {
                              const canRescan = issue.code === 'provider-unresolved' || issue.code === 'editor-missing' || issue.code === 'artifact-missing' || issue.code === 'dependency-missing'
                              const actionLabel = issue.code === 'agent-preset-unprepared' ? '准备分发' : canRescan ? '重新扫描' : undefined
                              return <li key={`${issue.code}-${index}`} data-severity="error"><strong>{t('layout.blocked')}</strong><span>{issue.message}</span>{actionLabel === undefined ? null : <button type="button" disabled={packageBusy} onClick={() => {
                                if (canRescan) setDependencyRefreshTick(value => value + 1)
                                setMessage(issue.code === 'agent-preset-unprepared' ? '请在 Creator 中对该 Agent 执行“准备分发”，再重新扫描当前工作台。' : '已重新扫描当前 Workbench 的 active 内页依赖。')
                              }}>{actionLabel}</button>}</li>
                            })}</ul> : null}
                            {selectedDependencySnapshot.dependencies.map((dependency: WorkbenchDependencyLockEntryV1) => {
                              const presentation = dependencyAvailabilityPresentation(
                                dependencyAvailability(selectedDependencySnapshot, dependency.portableId),
                              )
                              return <article key={dependency.portableId} data-state={presentation.state}><div><strong>{dependency.portableId}</strong><span>{dependency.version} · {dependency.digest === '' ? 'digest 未解析' : dependency.digest}</span></div><small>{dependency.kind} · {dependency.exportPolicy}{dependency.packageName === undefined ? '' : ` · npm ${dependency.packageName}`}</small><span className={css.settingsPluginStatus} data-state={presentation.state}>{presentation.label}</span></article>
                            })}
                          </>
                        ) : selectedInventory.plugins.length === 0 ? <p>{t('layout.thisWorkbenchHasNoPagePluginDependencies')}</p> : (
                          selectedInventory.plugins.map(plugin => (
                            <article key={plugin.key} data-state={plugin.status}>
                              <div>
                                <strong>{plugin.pluginId ?? '插件来源待确认'}</strong>
                                <span>{plugin.editorIds.join(' · ')}</span>
                              </div>
                              <small>{plugin.pageCount} {t('transfer.pages')}</small>
                              <span className={css.settingsPluginStatus} data-state={plugin.status}>
                                {pluginStatusLabel(plugin.status)}
                              </span>
                            </article>
                          ))
                        )}
                      </div>
                    </details>
                  </section>
                  <footer id="workbench-detail-export" className={css.settingsExportBoundary}>
                    <div className={css.settingsTransferHeading}><div><span>{t('layout.workbenchFiles')}</span><strong>{t('layout.saveAndDistribute')}</strong></div><small>{t('layout.layoutPageStateAndCompatibilityAreIndependent')}</small></div>
                    <div className={css.settingsTransferGrid}>
                      {workbenchPackage === undefined ? null : <article className={css.settingsTransferCard}>
                        <div className={css.settingsTransferIcon} aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 3v11m0 0-4-4m4 4 4-4M5 15v3a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3" /></svg></div>
                        <div><strong>{t('shell.shareWorkbench')}</strong><span>{t('layout.exportAPackageWithoutIncludingTheCurrent')}</span>{packageRuntimeStatus === undefined ? null : <small>{packageRuntimeStatus.available ? `${packageRuntimeStatus.label} 已连接` : '当前 Runtime 只保证布局包'}</small>}</div>
                        <button type="button" data-action="primary" disabled={packageBusy} onClick={() => {
                          if (selectedWorkbenchId !== undefined) openExportPackageDialog(selectedWorkbenchId)
                        }}>{packageBusy ? '处理中…' : selectedRecord?.packageOrigin === undefined ? '导出工作台包' : '再次分发工作台'}</button>
                      </article>}
                      <article className={css.settingsTransferCard}>
                        <div className={css.settingsTransferIcon} aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 4v11m0 0-4-4m4 4 4-4M6 19h12" /></svg></div>
                        <div><strong>{t('layout.originalConfiguration')}</strong><span>{t('layout.keepInternalFieldsForTroubleshootingAndRecovery')}</span></div>
                        <button type="button" onClick={() => { if (selectedWorkbenchId !== undefined) exportWorkbench(selectedWorkbenchId) }}>{t('layout.exportOriginalConfiguration')}</button>
                      </article>
                      {workbenchPackage === undefined ? null : <article className={css.settingsTransferCard}>
                        <div className={css.settingsTransferIcon} aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 20V9m0 0-4 4m4-4 4 4M5 6V4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v2" /></svg></div>
                        <div><strong>{t('transfer.importAnotherWorkbench')}</strong><span>{t('layout.theImportAppearsAsInactiveWithoutInterrupting')}</span></div>
                        <button type="button" disabled={packageBusy} onClick={openPackagePicker}>{packageBusy ? '处理中…' : t('layout.chooseWorkbenchPackage')}</button>
                      </article>}
                    </div>
                    <div className={css.settingsDangerZone}>
                      <strong>{t('settings.dangerZone')}</strong>
                      <span>{t('layout.permanentDeletionCannotBeUndoneUnloadOr')}</span>
                      <button type="button" disabled={selectedWorkbenchId === undefined || selectedLoaded}
                        onClick={() => {
                          if (selectedWorkbenchId === undefined) return
                          const name = selectedMetadata?.name ?? selectedWorkbenchId
                          if (!globalThis.confirm(`永久删除工作台“${name}”？此操作不可恢复。`)) return
                          void workbenchDirectory.remove(selectedWorkbenchId).then(result => {
                            if (result.status === 'committed') { setSelectedWorkbenchId(undefined); setMessage(`已永久删除工作台“${name}”。`) }
                            else setMessage(`无法删除工作台“${name}”。请先卸载并确认仍有其他可运行工作台。`)
                          })
                        }}>{t('layout.permanentlyDelete')}</button>
                    </div>
                  </footer>
                </>
              )}
            </div>
          </div>
        )}
      </div>
      {packageDialog === undefined ? null : (
        <div className={css.settingsPackageDialogLayer} role="presentation">
          <section className={css.settingsPackageDialog} role="dialog" aria-modal="true" aria-labelledby="workbench-package-dialog-title">
            <header>
              <div>
                <span>SHARE PACKAGE</span>
                <h3 id="workbench-package-dialog-title">{t('home.importWorkbenchPackage')}</h3>
              </div>
              <button type="button" aria-label={t('layout.closeWorkbenchImport')} disabled={packageBusy} onClick={cancelPackageImport}>×</button>
            </header>
            <p className={css.settingsPackageDialogFile}>{packageDialog.fileName}</p>
            {packageDialog.report.manifest === undefined ? (
              <div className={css.settingsPackageDialogInvalid}>{t('layout.thePackageManifestCouldNotBeRead')}</div>
            ) : (
              <>
                <div className={css.settingsPackageDialogSummary}>
                  <div><small>{t('shell.workbench')}</small><strong>{packageDialog.report.manifest.name}</strong></div>
                  <div><small>{t('layout.version')}</small><strong>{packageDialog.report.manifest.version}</strong></div>
                  <div><small>{t('layout.dependencyClosure')}</small><strong>{packageDialog.report.dependencyLock?.length ?? packageDialog.report.plugins.length} 个</strong></div>
                  <div><small>{t('layout.dynamicAgent')}</small><strong>{(packageDialog.report.dependencyLock?.filter(dependency => dependency.kind === 'dynamic').length ?? 0)} / {(packageDialog.report.agentPresets?.length ?? 0)}</strong></div>
                  <div><small>{t('modules.permissions')}</small><strong>{packageDialog.report.permissions.length === 0 ? '无' : `${packageDialog.report.permissions.length} 项`}</strong></div>
                </div>
                <div className={css.settingsPackageDialogProjection}>
                  <span>{t('layout.importContents')}</span>
                  <strong>{packageDialog.report.projection?.description || '布局与内页状态投影'}</strong>
                  <small>{packageImportConfirmed ? '已确认安装缺失制品，正在按依赖锁定信息校验并导入。' : '先检查本机依赖，再由你确认安装缺失制品；完成后进入“未使用”，不会自动切换当前工作台。'}</small>
                </div>
                <section className={css.settingsPackageDependencyCheck} aria-labelledby="workbench-package-dependency-check-title">
                  <div className={css.settingsPackageDependencyCheckHeading}>
                    <div>
                      <span>LOCAL DEPENDENCIES</span>
                      <strong id="workbench-package-dependency-check-title">{t('layout.localDependencyCheck')}</strong>
                    </div>
                    <small>{packageDependenciesChecking ? '正在检查本机依赖…' : packageDependencyCheckError !== undefined ? '检查失败' : importDependencySummary(packageDialog.dependencies)}</small>
                  </div>
                  {packageDependenciesChecking ? <p className={css.settingsPackageDependencyEmpty} role="status">{t('layout.checkingInstalledPluginsAndArtifacts')}</p> : packageDependencyCheckError !== undefined ? <p className={css.settingsPackageDependencyWarning} role="alert">{t('layout.localDependencyCheckFailed')}{packageDependencyCheckError}{t('layout.closeThisDialogAndChooseThePackage')}</p> : packageDialog.dependencies.length === 0 ? <p className={css.settingsPackageDependencyEmpty}>{t('layout.thisPackageDeclaresNoInstallableDependenciesThe')}</p> : (
                    <ul className={css.settingsPackageDependencyList} aria-label={t('layout.localDependencyCheckResult')}>
                      {packageDialog.dependencies.map(dependency => {
                        const tone = importDependencyLocalStatusTone(dependency.localStatus)
                        return <li key={`${dependency.portableId}@${dependency.version}`} data-state={tone}>
                          <div className={css.settingsPackageDependencyIdentity}>
                            <strong>{dependency.portableId}</strong>
                            <small>{dependency.kind} · {dependency.version}{dependency.editorIds.length === 0 ? '' : ` · ${dependency.editorIds.join('、')}`}</small>
                          </div>
                          <div className={css.settingsPackageDependencyFacts}>
                            <span data-state={tone}>{importDependencyLocalStatusLabel(dependency.localStatus)}</span>
                            <small>{importDependencyPackageStatusLabel(dependency.packageStatus)}{dependency.requiresRestart ? ' · 可能需要重启' : ''}</small>
                          </div>
                        </li>
                      })}
                    </ul>
                  )}
                  {packageDialog.dependencies.some(item => item.localStatus === 'conflict') ? <p className={css.settingsPackageDependencyWarning}>{t('layout.aLocalPageHasTheSameName')}</p> : null}
                </section>
                <ol className={css.settingsPackageImportSteps} aria-label={t('layout.importProgress')}>
                  {WORKBENCH_IMPORT_STEPS.map(step => {
                    const state = importStepState(step.id, packageOperationPhase, packageImportConfirmed, packageRestartPrompt !== undefined, packageDependenciesChecked)
                    return <li key={step.id} data-state={state}><span aria-hidden="true">{state === 'complete' ? '✓' : state === 'active' ? '•' : String(WORKBENCH_IMPORT_STEPS.indexOf(step) + 1)}</span><strong>{step.label}</strong></li>
                  })}
                </ol>
                {packageBusy || packageRestartPrompt !== undefined ? <div className={css.settingsPackageProgress} role="status" aria-live="polite">
                  <strong>{packageImportProgress?.label ?? (packageOperationPhase === 'reading' ? '读取分享包…' : packageOperationPhase === 'preflight' ? '安全预检…' : packageOperationPhase === 'checking-local' ? '检查本机依赖…' : packageOperationPhase === 'binding' ? '保存本机绑定…' : '准备依赖并验证内页…')}</strong>
                  {packageImportProgress === undefined || packageImportProgress.total <= 0 ? null : <span className={css.settingsPackageProgressBar} aria-hidden="true"><span style={{ width: `${Math.min(100, Math.max(0, packageImportProgress.current / packageImportProgress.total * 100))}%` }} /></span>}
                  <span>{packageImportProgress === undefined || packageImportProgress.total <= 0 ? '不会覆盖当前工作台，也不会导入作者对话。' : `${packageImportProgress.current} / ${packageImportProgress.total} · 不会覆盖当前工作台，也不会导入作者对话。`}</span>
                </div> : null}
                {packageRestartPrompt === undefined ? null : <section className={css.settingsPackageRestartPrompt} aria-live="polite">
                  <div>
                    <span>RUNTIME RESTART</span>
                    <strong>{t('layout.restartToFinishVerification')}</strong>
                    <small>{packageRestartPrompt.reason}</small>
                  </div>
                  <p>{t('layout.dependenciesAreStagedTheCurrentWorkbenchHas')}</p>
                  <div className={css.settingsPackageRestartActions}>
                    <button type="button" data-action="secondary" disabled={packageBusy} onClick={deferPackageRestart}>{t('layout.restartLater')}</button>
                    <button type="button" data-action="primary" disabled={packageBusy} onClick={requestPackageRestart}>{(workbenchPackage?.restartAvailable?.() ?? (workbenchPackage?.requestRestart !== undefined && packageRuntimeStatus?.authority !== 'browser')) ? '一键安全重启' : '查看重启说明'}</button>
                  </div>
                </section>}
                {!packageNeedsDistributionRuntime ? null : <div className={css.settingsRuntimeCapability} data-state={packageRuntimeBlocked ? 'limited' : 'ready'}>
                  <div><strong>{packageRuntimeStatus?.label ?? '依赖安装 Runtime'}</strong><span>{packageRuntimeBlocked ? '完整包尚不能激活' : '完整包安装链路已就绪'}</span></div>
                  {packageRuntimeBlocked ? <small>{packageRuntimeStatus?.blockers.join(' · ') ?? '当前 Runtime 未提供持久安装服务。'}</small> : null}
                </div>}
                {(packageDialog.report.sessions?.templates.length ?? 0) === 0 ? null : (
                  <section className={css.settingsPackageSessionBindings} aria-labelledby={`${packageSessionFieldId}-title`}>
                    <div>
                      <span>SESSION TEMPLATES</span>
                      <strong id={`${packageSessionFieldId}-title`}>{t('layout.chooseLocalConversations')}</strong>
                      <small>{t('layout.chooseOncePerTemplateAreasUsingThe')}</small>
                    </div>
                    {packageDialog.report.sessions?.templates.map((template, index) => {
                      const inputId = `${packageSessionFieldId}-${index}`
                      return <label key={template.templateId} htmlFor={inputId}>
                        <span><strong>{template.displayTitle}</strong><small>{packageDialog.report.sessions?.areaBindings.filter(binding => binding.templateId === template.templateId).length ?? 0} {t('layout.areas3')}</small></span>
                        <select id={inputId} value={packageSessionTargets[template.templateId] ?? ''} disabled={packageBusy} onChange={event => {
                          const value = event.currentTarget.value
                          setPackageSessionTargets(current => ({ ...current, [template.templateId]: value }))
                        }}>
                          <option value="">{t('layout.connectManuallyLater')}</option>
                          {sessions.ids.length === 0 ? null : <optgroup label={t('layout.useExistingConversation')}>
                            {sessions.ids.map(sessionId => {
                              const session = sessions.byId[sessionId]
                              const workspace = workspaceSnapshot.items.find(item => item.sessionIds.includes(sessionId))
                              return <option key={sessionId} value={`session:${sessionId}`}>{workspace === undefined ? '' : `${workspace.title} · `}{session?.displayTitle ?? sessionId}</option>
                            })}
                          </optgroup>}
                        </select>
                      </label>
                    })}
                  </section>
                )}
                {Object.keys(packagePermissionApprovals).length === 0 ? null : (
                  <fieldset className={css.settingsPackagePermissions}>
                    <legend>{t('layout.sensitivePermissions')}</legend>
                    <p>{t('layout.theseCapabilitiesCanAccessResourcesOutsideThe')}</p>
                    {Object.keys(packagePermissionApprovals).map(permission => <label key={permission}>
                      <input type="checkbox" checked={packagePermissionApprovals[permission] === true} disabled={packageBusy} onChange={event => {
                        const checked = event.currentTarget.checked
                        setPackagePermissionApprovals(current => ({ ...current, [permission]: checked }))
                      }} />
                      <span><strong>{permission}</strong><small>{permission === 'network' ? '允许插件访问网络' : permission === 'filesystem' ? '允许插件访问文件系统' : permission === 'host.code' ? '允许执行 Host 代码' : permission === 'dynamic.cordis' ? '允许定义并运行 Dynamic Cordis Package' : '允许读取本机 Session 元数据'}</small></span>
                    </label>)}
                  </fieldset>
                )}
                {packageDialog.report.plugins.length === 0 ? null : (
                  <ul className={css.settingsPackageDialogPlugins} aria-label={t('layout.packagedPluginDeclarations')}>
                    {packageDialog.report.plugins.map(plugin => <li key={`${plugin.manifest.packageId}@${plugin.manifest.version}`}><span>{plugin.manifest.packageId}</span><small>{plugin.manifest.version} · {plugin.manifest.sourcePolicy === 'binary-only' ? '闭源二进制' : plugin.manifest.sourcePolicy === 'source-included' ? '包含源码' : '远程来源'}{plugin.requiresRestart ? ' · 需要重启' : ''}</small></li>)}
                  </ul>
                )}
              </>
            )}
            {packageDialog.report.issues.length === 0 ? <p className={css.settingsPackageDialogOk}>{t('layout.preflightPassedYouCanCreateANew')}</p> : (
              <ul className={css.settingsPackageDialogIssues} aria-label={t('layout.packagePreflightResult')}>
                {packageDialog.report.issues.map((issue, index) => <li key={`${issue.code}-${index}`} data-severity={issue.severity}><strong>{issue.severity === 'error' ? t('layout.blocked') : '提示'}</strong><span>{issue.message}</span></li>)}
              </ul>
            )}
            <footer>
              <button type="button" data-action="secondary" disabled={packageBusy} onClick={cancelPackageImport}>{t('action.cancel')}</button>
              <button type="button" data-action="primary" disabled={packageBusy || packageDependenciesChecking || packageDependencyCheckError !== undefined || !packageDependenciesChecked || packageRestartPrompt !== undefined || !packageDialog.report.valid || unapprovedHighRiskPermissions.length > 0 || packageRuntimeBlocked} onClick={confirmPackageImport}>{packageBusy ? '处理中…' : packageDependenciesChecking ? '检查本机依赖…' : packageDependencyCheckError !== undefined ? '无法确认依赖' : packageRestartPrompt !== undefined ? '等待重启验证' : packageRuntimeBlocked ? '缺少安装 Runtime' : unapprovedHighRiskPermissions.length > 0 ? `确认 ${unapprovedHighRiskPermissions.length} 项权限` : packageResumeTransactionId === undefined ? packageDialog.dependencies.some(item => item.localStatus === 'missing') ? '确认安装缺失依赖' : packageDialog.dependencies.some(item => item.localStatus === 'available') ? '确认激活并导入' : packageDialog.dependencies.some(item => item.localStatus === 'conflict') ? '确认按包版本验证' : '确认并导入' : '继续验证'}</button>
            </footer>
          </section>
        </div>
      )}
      {externalBindingDialog === undefined ? null : (
        <div className={css.settingsPackageDialogLayer} role="presentation">
          <section className={css.settingsPackageDialog} role="dialog" aria-modal="true" aria-labelledby="workbench-binding-dialog-title">
            <header>
              <div>
                <span>RECIPIENT BINDINGS</span>
                <h3 id="workbench-binding-dialog-title">{t('layout.connectLocalResources')}</h3>
              </div>
              <button type="button" aria-label={t('layout.closeLocalResourceBinding')} disabled={packageBusy} onClick={closeExternalBindingDialog}>×</button>
            </header>
            <div className={css.settingsPackageDialogProjection}>
              <span>{t('layout.onlyRecipientReferencesAreSaved')}</span>
              <strong>{t('layout.credentialsTranscriptsAndTheAuthorSMachine')}</strong>
              <small>{t('layout.useAnOpaqueReferenceFromTheLocal')}</small>
            </div>
            <div className={css.settingsExternalBindings}>
              {externalBindingDialog.inputs.map((input, index) => {
                const inputId = `workbench-external-binding-${index}`
                const value = externalBindingValues[input.id] ?? ''
                return <label key={input.id} htmlFor={inputId}>
                  <span><strong>{input.label}</strong><small>{input.kind} · {input.required ? '必需' : '可选'} · {input.status === 'invalid' ? 'Runtime 当前判定无效' : input.status === 'satisfied' ? '已满足' : '待绑定'}</small></span>
                  <input id={inputId} type="text" autoComplete="off" value={value} disabled={packageBusy} placeholder={t('layout.enterLocalOpaqueReference')} onChange={event => {
                    const next = event.currentTarget.value
                    setExternalBindingValues(current => ({ ...current, [input.id]: next }))
                  }} />
                </label>
              })}
            </div>
            <footer>
              <button type="button" data-action="secondary" disabled={packageBusy} onClick={closeExternalBindingDialog}>{t('layout.connectLater')}</button>
              <button type="button" data-action="primary" disabled={packageBusy} onClick={submitExternalBindings}>{packageOperationPhase === 'binding' ? '保存中…' : '保存绑定'}</button>
            </footer>
          </section>
        </div>
      )}
      {exportModeDialog === undefined ? null : (
        <div className={css.settingsPackageDialogLayer} role="presentation">
          <section className={`${css.settingsPackageDialog} ${css.settingsExportDialog}`} role="dialog" aria-modal="true" aria-labelledby="workbench-export-mode-title">
            <header>
              <div><span>{exportDialogStep === 'review' ? 'FINAL REVIEW' : 'PACKAGE MODE'}</span><h3 id="workbench-export-mode-title">{exportDialogStep === 'review' ? '确认导出内容' : '选择分享包类型'}</h3></div>
              <button type="button" aria-label={t('layout.closeWorkbenchExport')} disabled={packageBusy} onClick={() => { setExportModeDialog(undefined); setExportDialogStep('readiness'); setExportTargetMode(undefined); setExportPermissionApprovals({}); setExportDialogMessage(undefined) }}>×</button>
            </header>
            <div className={css.settingsExportDialogBody}>
            {exportDialogMessage === undefined ? null : <p className={css.settingsExportDialogStatus} role="status" aria-live="polite" data-state={packageBusy ? 'busy' : 'info'}>{exportDialogMessage}</p>}
            {exportDialogStep === 'review' && exportTargetMode !== undefined ? <>
              <div className={css.settingsExportReviewHero} data-state={exportTargetMode === 'layout-only' ? 'warning' : 'ready'}>
                <span>{t('layout.readyToExport')}</span>
                <strong>{exportTargetLabel(exportTargetMode)}</strong>
                <small>{exportTargetDescription(exportTargetMode)}</small>
              </div>
              <div className={css.settingsExportReviewGrid}>
                <div><small>{t('layout.included')}</small><span>{t('layout.activePagesLockedDependenciesLayoutPreviewAnd')}</span></div>
                <div><small>{t('layout.excluded')}</small><span>{t('layout.conversationIdsTranscriptsCredentialsAbsolutePathsAnd')}</span></div>
                <div><small>{t('layout.recipientRequirements')}</small><span>{exportTargetReadiness?.requiredInputs.length === 0 ? '按需选择目标项目或对话' : exportTargetReadiness?.requiredInputs.map(input => input.label).join('、')}</span></div>
                <div><small>{t('layout.localChanges')}</small><span>{exportTargetReadiness?.estimatedArtifactBytes === undefined ? '磁盘占用无法在当前 Runtime 中确认' : `预计新增 ${(exportTargetReadiness.estimatedArtifactBytes / 1024 / 1024).toFixed(1)} MB；不会改变当前 Workbench`}</span></div>
              </div>
              {exportTargetMode === 'layout-only' ? <p className={css.settingsPackageLayoutOnlyHint}>{t('layout.thisIsALayoutOnlyPackageRecipients')}</p> : null}
            </> : <>
            <p className={css.settingsExportDialogIntro}>{t('layout.onlyActivePagesContributeDependenciesPageHistory')}</p>
            <div className={css.settingsPackageModeOptions} role="group" aria-label={t('layout.packageDistributionMode')}>
              <button
                type="button"
                className={exportModeDialog.mode === 'online-reference' ? css.settingsPackageModeOptionSelected : undefined}
                aria-pressed={exportModeDialog.mode === 'online-reference'}
                disabled={packageBusy}
                onClick={() => selectExportMode('online-reference')}
              >
                <strong>{t('layout.onlineReferences')}</strong>
                <small>{t('layout.recipientsRetrieveExactArtifactsFromATrusted')}</small>
              </button>
              <button
                type="button"
                className={exportModeDialog.mode === 'offline-embedded' ? css.settingsPackageModeOptionSelected : undefined}
                aria-pressed={exportModeDialog.mode === 'offline-embedded'}
                disabled={packageBusy}
                onClick={() => selectExportMode('offline-embedded')}
              >
                <strong>{t('layout.embeddedOfflineArtifacts')}</strong>
                <small>{t('layout.includeVerifiedArtifactsForOfflineInstallation')}</small>
              </button>
            </div>
            <div className={css.settingsExportQuickActions}>
              {exportReadiness?.repairable.filter(item => isAutomaticExportRepair(item.repair)).length === 0
                ? null
                : <button
                  type="button"
                  data-action="secondary"
                  disabled={packageBusy || !exportPreparationAvailable}
                  onClick={() => prepareExportDependencies(exportModeDialog.workbenchId, exportModeDialog.mode)}
                >{!exportPreparationAvailable ? '需要 Runtime 才能准备依赖' : `一键准备 ${exportReadiness?.repairable.filter(item => isAutomaticExportRepair(item.repair)).length ?? 0} 个依赖`}</button>}
            </div>
            <div className={css.settingsPackageDialogSummary}>
              <div><small>{t('layout.currentIntegrity')}</small><strong>{exportReadinessLabel(exportReadiness?.completeness ?? exportDependencySnapshot?.completeness)}</strong></div>
              <div><small>{t('layout.onlineReferences')}</small><strong>{exportOnlineReadiness?.completeness === 'complete-online' || exportOnlineReadiness?.completeness === 'needs-input' ? '精确版本 + digest' : exportReadinessLabel(exportOnlineReadiness?.completeness)}</strong></div>
              <div><small>{t('layout.embeddedOfflineArtifacts')}</small><strong>{exportOfflineReadiness?.completeness === 'complete-offline' || exportOfflineReadiness?.completeness === 'needs-input' ? '断网可安装制品' : exportReadinessLabel(exportOfflineReadiness?.completeness)}</strong></div>
            </div>
            {exportReadiness === undefined ? null : <div className={css.settingsExportReadiness}>
              <div className={css.settingsExportReadinessCounts}>
                <span>{t('layout.activePages')} <strong>{exportReadiness.activeEditorCount}</strong></span>
                <span>{t('workspace.agentMode')} <strong>{exportReadiness.agentPresetCount}</strong></span>
                <span>{t('layout.dynamicPlugins')} <strong>{exportReadiness.dynamicPackageCount}</strong></span>
                <span>{t('layout.sharedDependencies')} <strong>{exportReadiness.sharedDependencyCount}</strong></span>
              </div>
              {exportReadiness.ready.length === 0 ? null : <div className={css.settingsExportReadinessReady}>
                <strong>{t('settings.ready')} {exportReadiness.ready.length} {t('layout.dependencies2')}</strong>
                <span>{exportReadiness.ready.map(item => item.packageName ?? item.portableId).join('、')}</span>
              </div>}
              {exportReadiness.repairable.length === 0 && exportReadiness.blockers.length === 0 ? null : <div className={css.settingsExportReadinessIssues}>
                {exportReadiness.repairable.map(item => {
                  const locked = exportDependencySnapshot?.dependencies.find(dependency => dependency.portableId === item.portableId)
                  const editorScopes = locked?.editorScopes?.map(scope => `${scope.editorId} (${scope.scope})`) ?? []
                  return <div key={item.issueId} className={css.settingsExportReadinessIssue}>
                    <div><strong>{item.packageName ?? item.portableId}</strong><small>{item.kind} · {item.currentAvailability} · {item.version ?? '版本待确认'}</small></div>
                    <span>{exportReadinessRepairLabel(item.repair)}</span>
                    <p>{item.consequence}</p>
                    <details>
                      <summary>{t('layout.reviewSourcesAndValidation')}</summary>
                      <dl>
                        <dt>portableId</dt><dd><code>{item.portableId}</code></dd>
                        <dt>artifact digest</dt><dd><code>{item.digest ?? locked?.digest ?? '未解析'}</code></dd>
                        <dt>{t('layout.sourcePolicy')}</dt><dd>{locked?.sourcePolicy ?? '未声明'} · {locked?.exportPolicy ?? '未声明'}</dd>
                        {locked?.installSource === undefined ? null : <><dt>{t('layout.installationSource')}</dt><dd>{locked.installSource}{locked.registryUrl === undefined ? '' : ` · ${locked.registryUrl}`}</dd></>}
                        {editorScopes.length === 0 ? null : <><dt>editor / scope</dt><dd>{editorScopes.join('、')}</dd></>}
                        {item.requiredPermissions.length === 0 ? null : <><dt>{t('modules.permissions')}</dt><dd>{item.requiredPermissions.join('、')}</dd></>}
                      </dl>
                    </details>
                  </div>
                })}
                {exportReadiness.blockers.filter(issue => issue.repair === 'none').map(issue => <div key={issue.issueId} className={`${css.settingsExportReadinessIssue} ${css.settingsExportReadinessIssueBlocked}`}>
                  <div><strong>{issue.portableId ?? '工作台依赖'}</strong><small>{issue.code}</small></div>
                  <span>{t('layout.blocked2')}</span>
                  <p>{issue.message}</p>
                </div>)}
              </div>}
              {exportReadiness.requiredInputs.length === 0 ? null : <p className={css.settingsExportReadinessInputs}>{t('layout.resourcesForTheRecipientToConnect')}{exportReadiness.requiredInputs.map(input => input.label).join('、')}</p>}
              {exportHighRiskPermissions.length === 0 ? null : <fieldset className={css.settingsPackagePermissions}>
                <legend>{t('layout.permissionsRequiredToPrepareDependencies')}</legend>
                <p>{t('layout.preparationDoesNotAccessTheNetworkFilesystem')}</p>
                {exportHighRiskPermissions.map(permission => <label key={permission}>
                  <input
                    type="checkbox"
                    checked={exportPermissionApprovals[permission] === true}
                    disabled={packageBusy}
                    onChange={event => setExportPermissionApprovals(current => ({ ...current, [permission]: event.currentTarget.checked }))}
                  />
                  <span><strong>{permission}</strong><small>{permission === 'network' ? '允许访问受信任 Registry 或远程依赖' : permission === 'filesystem' ? '允许提取或读取本机制品资源' : permission === 'host.code' ? '允许在激活验证阶段加载 Host 制品' : permission === 'dynamic.cordis' ? '允许创建并运行 Dynamic Cordis Package' : '允许读取受限 Session 元数据'}</small></span>
                </label>)}
              </fieldset>}
            </div>}
            </>}
            </div>
            <footer className={css.settingsExportDialogFooter}>
              {exportDialogStep === 'review' && exportTargetMode !== undefined ? <>
                <button type="button" data-action="secondary" disabled={packageBusy} onClick={() => { setExportDialogStep('readiness'); setExportTargetMode(undefined); setExportDialogMessage(undefined) }}>{t('layout.backToChecks')}</button>
                <button type="button" data-action="primary" disabled={packageBusy || !exportReviewAllowed} title={!exportReviewAllowed ? '依赖状态已变化，请返回检查并重新扫描。' : undefined} onClick={() => exportWorkbenchPackage(exportModeDialog.workbenchId, exportTargetMode === 'offline-embedded' ? 'offline-embedded' : 'online-reference')}>
                  {packageBusy ? '导出中…' : `确认并导出${exportTargetLabel(exportTargetMode)}`}
                </button>
              </> : <>
                <button
                  type="button"
                  data-action={exportModeDialog.mode === 'online-reference' ? 'primary' : 'secondary'}
                  disabled={packageBusy || !canExportFromReadiness(
                    exportModeDialog.mode === 'online-reference'
                      ? exportReadiness
                      : (workbenchPackage?.inspectExportReadiness?.(exportModeDialog.workbenchId, 'online-reference')),
                    'online-reference',
                  )}
                  title={!canExportFromReadiness(
                    exportModeDialog.mode === 'online-reference'
                      ? exportReadiness
                      : (workbenchPackage?.inspectExportReadiness?.(exportModeDialog.workbenchId, 'online-reference')),
                    'online-reference',
                  ) ? '在线模式需要精确版本、digest 和受信任 Registry；否则只能导出布局包。' : undefined}
                  onClick={() => openExportReview('online-reference')}
                >{t('layout.onlineReferencePackage')}</button>
                <button
                  type="button"
                  data-action={exportModeDialog.mode === 'offline-embedded' ? 'primary' : 'secondary'}
                  disabled={packageBusy || !canExportFromReadiness(
                    exportModeDialog.mode === 'offline-embedded'
                      ? exportReadiness
                      : (workbenchPackage?.inspectExportReadiness?.(exportModeDialog.workbenchId, 'offline-embedded')),
                    'offline-embedded',
                  )}
                  title={!canExportFromReadiness(
                    exportModeDialog.mode === 'offline-embedded'
                      ? exportReadiness
                      : (workbenchPackage?.inspectExportReadiness?.(exportModeDialog.workbenchId, 'offline-embedded')),
                    'offline-embedded',
                  ) ? '离线模式需要所有必需制品已嵌入并通过 digest 验证。' : undefined}
                  onClick={() => openExportReview('offline-embedded')}
                >{t('layout.offlinePackage')}</button>
                {canExportLayoutFromReadiness(exportLayoutReadiness) ? <button
                  type="button"
                  data-action="secondary"
                  className={css.settingsPackageLayoutOnlyAction}
                  disabled={packageBusy}
                  title={t('layout.exportLayoutAndPortableStateOnlyRecipients')}
                  onClick={() => openExportReview('layout-only')}
                >{t('layout.exportLayoutPackageDependenciesSeparate')}</button> : null}
              </>}
            </footer>
          </section>
        </div>
      )}
      {message === undefined ? null : <p className={css.settingsOperationStatus} role="status">{message}</p>}
    </section>
  )
}
