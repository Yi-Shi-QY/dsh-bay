import { useWorkbenchLocale, workbenchPageTitle } from './workbench-locale.ts'
import { browserSafeUuid } from '../browser-safe-id.ts'
import { WorkbenchBayAgentTasks } from './WorkbenchBayAgentTasks.tsx'
import { WorkbenchPageLoading } from './WorkbenchPageLoading.tsx'
import { WorkbenchPlacementPicker } from './WorkbenchPlacementPicker.tsx'
import { placementReason } from './area-identity.ts'
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type PointerEvent as ReactPointerEvent, type RefObject } from 'react'
import { IconAgentPresetOutlineMedium, IconCloseOutlineMedium, IconPlusOutlineMedium, IconEllipsisOutlineMedium } from '@deepseek-ai/dsh-client-ui-primitives'
import type { FloatingWorkspaceRuntime, FloatingRect, FloatingInstance } from '../client/floating-workspace-runtime.ts'
import { clampFloatingRect, defaultFloatingRect } from '../client/floating-workspace-runtime.ts'
import { RetainedEditorTarget } from './FloatingWorkspaceContext.tsx'
import { MemoizedEditor, PendingSessionBindingPicker, WorkbenchFloatingMenu, type WorkbenchFrameProps, type AreaContentCommandHandlersV1 } from './WorkbenchFrame.tsx'
import { WorkbenchEditorPicker } from './WorkbenchEditorPicker.tsx'
import { WorkbenchEditorIcon } from './WorkbenchEditorIcon.tsx'
import type { WorkbenchEditorCatalogRow } from './catalog.ts'
import { buildWorkbenchAreaTabRows, conversationTabBinding, conversationTabUnavailable, indexWorkbenchEditors } from './area-tab-rows.ts'
import { useConversationTabStatus } from '../client/use-conversation-tab-status.ts'
import { WorkbenchTabStatus } from './WorkbenchTabStatus.tsx'
import { WorkbenchTabTooltip } from './WorkbenchTabTooltip.tsx'
import { selectableWorkbenchEditors, createFloatingEditorTab } from './editor-selection.ts'
import { applyLayoutCommand, createSessionTab, groupsOf, tabsOf, type TabDocument, type SessionBindingV1, type DropEdge, type WorkbenchLayoutDocument } from './model.ts'
import { workbenchNativeSidebarForKind } from '../client/native-sidebar-registry.ts'
import { routeWorkbenchConversationResource, workbenchResourceMatchesSession, workbenchConversationResourceType } from '../client/workbench-resource-opener.ts'
import { conversationResourceActionFor, conversationResourcePolicyFor, normalizeWorkbenchConversationInteractionPolicy, workbenchTabFontSizePx } from '../workbench-interaction-policy.ts'
import { workbenchEditorStateFailureV1 } from '../workbench-editor-state.ts'
import type { WorkbenchExtensionAccessSnapshotV1 } from '../workbench-extension-access.ts'
import type { WorkbenchConversationInteractionPolicyV1 } from '../workbench-interaction-policy.ts'
import css from './WorkbenchFloatingWorkspace.module.css'
import { COLLAPSED_DIVIDER_SIZE, EXPANDED_AREA_MIN_HEIGHT, EXPANDED_AREA_MIN_WIDTH } from './collapse-projection.ts'
import type { SessionMarkerRecord } from './persistence.ts'
import { allocateSessionMarker } from './session-markers.ts'
import frameCss from './WorkbenchFrame.module.css'
import accentFrameCss from './SessionAccentFrame.module.css'
import type { BayAgentControllerV1 } from './workbench-bay-agent-work.ts'

const uid = () => 'floating-' + browserSafeUuid()
const EMPTY_BAY_AGENT_SNAPSHOT = { workbenchId: '', areas: [], workItems: [], assignments: [], attention: [], orchestration: { workbenchId: '', currentEventSeq: 0, activeWorkItems: [], activeAssignments: [], openAttention: [], recentReports: [], recentBlockers: [], recentDecisions: [], recentEvents: [] } } as const
export function FloatingWorkspaceIcon({ size = 24, className }: { size?: number; className?: string } = {}) {
  return <svg className={className} width={size} height={size} style={{ width: size, height: size, display: 'block', flex: '0 0 auto' }} viewBox="0 0 1024 1024" fill="none" aria-hidden="true">
    <path d="M814 377 784 317 751 273 697 224 638 190 593 174 530 163 446 167 377 186 319 215 267 255 225 302 190 362 168 427 161 481 166 551 187 619 225 608 204 537 201 478 213 414 238 356 269 311 312 269 355 240 405 218 469 204 523 203 555 207 602 220 643 239 673 258 723 304 761 359 775 389 787 428 828 428Z" fill="var(--dsw-alias-label-link, #0b4596)" />
    <path d="M422 448 419 461 426 480 471 546 498 596 497 621 535 638 495 566 433 481 430 471 434 466 467 467 499 477 537 497 574 524 606 554 642 598 667 638 689 684 749 684 796 675 773 600 778 590 800 565 816 554 873 535 866 525 857 520 810 507 769 506 728 513 696 481 653 452 620 437 572 424 542 420 478 423 440 434Z" fill="var(--dsw-alias-label-primary, #050608)" />
    <path d="M569 462 577 458 594 459 630 472 663 499 670 516 663 520 651 519 620 507 581 479Z" fill="var(--dsw-alias-bg-base, #fff)" />
    <path d="M62 727 127 697 189 678 249 668 310 666 353 670 408 682 539 732 596 748 656 756 712 754 787 736 843 710 894 673 918 649 937 623 877 663 816 688 757 701 692 703 606 687 490 639 438 624 368 614 291 616 231 627 166 651 109 685Z" fill="var(--dsw-alias-label-link, #0b4596)" />
    <path d="M239 711 288 760 348 799 428 832 491 845 548 846 611 834 673 809 730 772 637 791 561 791 486 773 388 730 343 716 296 709Z" fill="var(--dsw-alias-label-link, #0b4596)" />
    <path d="M900 580 887 580 868 596 855 620 848 643 899 599 903 590Z" fill="var(--dsw-alias-label-link, #0b4596)" />
    <path d="M832 632 822 640 820 659 834 642Z" fill="var(--dsw-alias-label-link, #0b4596)" />
  </svg>
}

export function FloatingWorkspaceToolbarButton({ runtime, workbenchId, canvasRef, className, disabled }: {
  runtime: FloatingWorkspaceRuntime; workbenchId: string; canvasRef: RefObject<HTMLDivElement>; className: string | undefined; disabled: boolean
}) {
  const { t } = useWorkbenchLocale()
  const [menu, setMenu] = useState(false), anchor = useRef<HTMLButtonElement>(null), surface = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!menu) return
    surface.current?.querySelector<HTMLButtonElement>('button')?.focus()
    const outside = (event: PointerEvent) => { if (event.target instanceof Node && !surface.current?.contains(event.target) && !anchor.current?.contains(event.target)) setMenu(false) }
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); setMenu(false); anchor.current?.focus() } }
    window.addEventListener('pointerdown', outside); window.addEventListener('keydown', key, true)
    return () => { window.removeEventListener('pointerdown', outside); window.removeEventListener('keydown', key, true) }
  }, [menu])
  return <><button ref={anchor} type="button" className={className} aria-label={t('workspace.floatingWorkspace')} title={t('workspace.floatingWorkspaceRightClickOrPressShift')} disabled={disabled}
    aria-haspopup="menu" aria-expanded={menu} onClick={() => { runtime.patch(workbenchId, { expanded: true }); setMenu(false) }}
    onContextMenu={event => { event.preventDefault(); if (!disabled) setMenu(true) }}
    onKeyDown={event => { if (event.key === 'ContextMenu' || event.shiftKey && event.key === 'F10' || event.altKey && event.key === 'ArrowDown') { event.preventDefault(); setMenu(true) } }}><FloatingWorkspaceIcon size={22} /></button>
    {menu ? <WorkbenchFloatingMenu kind="editor" ownerId={'floating-toolbar:' + workbenchId} anchorRef={anchor} surfaceRef={surface} side="bottom" align="end" className={css.toolbarMenu} label={t('workspace.floatingWorkspace')}>
      <div className={css.menuHeader}><strong>{t('workspace.floatingWorkspace')}</strong><button type="button" className={css.menuClose} aria-label={t('workspace.closeFloatingWorkspaceMenu')} title={t('workspace.closeMenu')} onClick={() => setMenu(false)}><IconCloseOutlineMedium size={14} /></button></div>
      <button role="menuitem" onClick={() => { runtime.patch(workbenchId, { expanded: true }); setMenu(false) }}>{t('workspace.openFloatingWorkspace')}</button>
      <button role="menuitem" onClick={() => { const width = canvasRef.current?.clientWidth || 900, height = canvasRef.current?.clientHeight || 600; runtime.patch(workbenchId, { rect: defaultFloatingRect(width, height), launcher: { x: Math.max(0, width - 54), y: Math.max(0, height - 54) }, maximized: false, expanded: true }, true); setMenu(false) }}>{t('workspace.resetPosition')}</button>
    </WorkbenchFloatingMenu> : null}</>
}

interface Props {
  runtime: FloatingWorkspaceRuntime
  workbenchId: string
  canvasRef: RefObject<HTMLDivElement>
  visible: boolean
  editors: readonly WorkbenchEditorCatalogRow[]
  hidden: readonly string[]
  editorMenu?: import('./editor-menu-preferences.ts').EditorMenuPreferences | undefined
  extensionAccess: WorkbenchExtensionAccessSnapshotV1
  frame: WorkbenchFrameProps
  layout: WorkbenchLayoutDocument
  policy?: WorkbenchConversationInteractionPolicyV1 | undefined
  sessionMarkers?: Readonly<Record<string, Readonly<Record<string, SessionMarkerRecord>>>>
  selectedAreaBinding?: SessionBindingV1 | undefined
  commit: (command: Parameters<typeof applyLayoutCommand>[1]) => boolean | void
  pin: (tab: TabDocument, areaId: string, edge: DropEdge) => Promise<boolean>
  bayAgent?: BayAgentControllerV1
}

/** Temporary content belongs to the client runtime, never to layout autosave. */
export function WorkbenchFloatingWorkspace(props: Props) {
  const { t } = useWorkbenchLocale()
  const { runtime, workbenchId, canvasRef, visible, editors, frame, bayAgent } = props
  const interactionPolicy = normalizeWorkbenchConversationInteractionPolicy(props.policy)
  const tabFontSize = workbenchTabFontSizePx(interactionPolicy.tabFontSize, 13)
  const runtimeRevision = useSyncExternalStore(runtime.subscribe, runtime.getSnapshot, runtime.getSnapshot)
  const subscribeBayAgent = useCallback((listener: () => void) => bayAgent?.subscribe(listener) ?? (() => {}), [bayAgent])
  const getBayAgentSnapshot = useCallback(() => bayAgent?.getSnapshot() ?? EMPTY_BAY_AGENT_SNAPSHOT, [bayAgent])
  const baySnapshot = useSyncExternalStore(subscribeBayAgent, getBayAgentSnapshot, getBayAgentSnapshot)
  const space = runtime.workspace(workbenchId)
  const rows = [...runtime.instances.values()].filter(row => row.workbenchId === workbenchId && row.location === 'floating')
  const [bayError, setBayError] = useState('')
  const [size, setSize] = useState({ width: 900, height: 600 })
  const [menu, setMenu] = useState<'add' | 'window' | 'pin' | 'tabs'>()
  const [bindingTabId, setBindingTabId] = useState<string>()
  const openBindingPicker = (id: string) => { setMenu(undefined); setBindingTabId(id) }
  const [tabQuery, setTabQuery] = useState('')
  const [drop, setDrop] = useState<{ areaId: string; edge: DropEdge; rect: DOMRect; reason?: string | undefined }>()
  const gesture = useRef<() => void>()
  const windowRef = useRef<HTMLDivElement>(null)
  const strip = useRef<HTMLDivElement>(null)
  const suppressClick = useRef(false)
  const active = rows.find(row => row.tab.id === space.activeId) ?? rows[0]
  const raw = space.rect ?? defaultFloatingRect(size.width, size.height)
  const rect = space.maximized ? { x: 0, y: 0, ...size } : clampFloatingRect(raw, size.width, size.height)
  const launcher = { x: Math.max(0, Math.min(size.width - 38, space.launcher?.x ?? size.width - 54)), y: Math.max(0, Math.min(size.height - 38, space.launcher?.y ?? size.height - 54)) }
  const sessions = frame.useSessions(state => state.byId)
  const workspaces = frame.useWorkspaces(state => state.items)
  const archived = frame.useWorkspaces(state => state.archivedSessionIds)
  const conversationStates = useConversationTabStatus(frame.conversationStatus, rows.flatMap(row => {
    const binding = conversationTabBinding(row.tab)
    return binding && sessions[binding.sessionId as keyof typeof sessions] && !archived.includes(binding.sessionId as never) ? [binding.sessionId] : []
  }))
  const tabRows = buildWorkbenchAreaTabRows({
    tabs: rows.map(row => row.tab), editorIndex: indexWorkbenchEditors(editors), activeTabId: active?.tab.id,
    areaBinding: undefined, pausedTabId: undefined, conversations: conversationStates,
    sessionAvailability: binding => conversationTabUnavailable(binding, { workspaces, sessions, archivedSessionIds: archived }, t),
    information: { sessions, workspaces, ...(props.sessionMarkers ? { markersByWorkspace: props.sessionMarkers } : {}), location: t('workspace.floatingWorkspace') },
  }).rows
  const revealBayAgent = async () => {
    if (!bayAgent) return
    setBayError('')
    try {
      const sessionId = await bayAgent.ensureMainSession(workbenchId)
      if (!sessionId) throw new Error(t('floating.mainUnavailable'))
      const workspace = workspaces.find(item => item.sessionIds.includes(sessionId as never))
      const tab = createSessionTab('bay-agent-main', 'workbench.conversation', { sessionId, ...(workspace ? { workspaceId: workspace.workspaceId } : {}) }, 'Bay Agent')
      if (runtime.find('bay-agent-main', workbenchId)) runtime.update('bay-agent-main', tab, workbenchId)
      else runtime.open(workbenchId, tab, false, true)
      runtime.patch(workbenchId, { error: undefined })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setBayError(message)
      runtime.patch(workbenchId, { error: message })
    }
  }
  const toggleBayAgent = () => {
    if (!runtime.find('bay-agent-main', workbenchId)) { void revealBayAgent(); return }
    runtime.forget('bay-agent-main', workbenchId)
    runtime.patch(workbenchId, { error: undefined })
  }
  const bayAgentTabVisible = runtime.find('bay-agent-main', workbenchId) !== undefined
  const binding = active?.tab.binding
  const sessionId = binding?.sessionId ?? active?.tab.sessionId
  const sourceWorkspace = binding?.workspaceId
    ? workspaces.find(workspace => workspace.workspaceId === binding.workspaceId)
    : workspaces.find(workspace => workspace.sessionIds.includes(sessionId as never))
  const sourceTitle = active?.tab.id === 'bay-agent-main' ? t('floating.currentWorkbench') : sourceWorkspace?.title || sourceWorkspace?.path?.split(/[\\/]/).filter(Boolean).at(-1)
    || (binding?.workspaceId ? t('floating.projectUnavailable') : sessionId ? t('floating.ungroupedProject') : t('floating.projectNotLinked'))
  const sourceSession = sessionId ? sessions[sessionId as keyof typeof sessions] : undefined
  const sessionTitle = active?.tab.id === 'bay-agent-main' ? t('floating.mainSession') : sourceSession?.displayTitle || (sessionId ? t('floating.conversationUnavailable') : t('floating.conversationNotLinked'))
  const markerFor = (target: SessionBindingV1 | undefined) => {
    if (!target) return undefined
    const workspaceId = target.workspaceId ?? workspaces.find(workspace => workspace.sessionIds.includes(target.sessionId as never))?.workspaceId
    const markers = workspaceId ? props.sessionMarkers?.[workspaceId] ?? {} : {}
    return markers[target.sessionId] ?? allocateSessionMarker(markers)
  }
  const sourceMarker = markerFor(binding ?? (sessionId ? { sessionId } : undefined))
  const launcherMarker = markerFor(props.selectedAreaBinding)
  const menuTitle = menu === 'add' ? t('page.add') : menu === 'window' ? t('workspace.floatingWorkspace') : menu === 'pin' ? t('workspace.moveToArea') : menu === 'tabs' ? t('workspace.temporaryPages') : undefined
  const notice = (error: string) => runtime.patch(workbenchId, { error })
  const pinReason = (tab: TabDocument, areaId: string, edge: DropEdge) => {
    if (tab.id === 'bay-agent-main') return t('floating.retainedMain')
    if (runtime.hasControl?.(workbenchId) === false) return t('floating.controlLost')
    if (runtime.canUseEditor?.(workbenchId, tab.editorId) === false) return t('floating.permissionChanged')
    const group = groupsOf(props.layout.root).find(row => row.id === areaId)
    if (!group) return t('floating.areaGone')
    const project = frame.workbenchDirectory?.getAreaProjects?.(workbenchId)[areaId] ?? group.project
    const reason = placementReason(tab, project, frame.workbenchDirectory?.getAreaProjects !== undefined || group.project !== undefined)
    if (edge === 'center' && reason) return reason
    const element = [...(canvasRef.current?.querySelectorAll<HTMLElement>('[data-workbench-group]') ?? [])].find(el => el.dataset.workbenchGroup === areaId)
    const bounds = element?.getBoundingClientRect()
    if (edge !== 'center' && bounds) {
      const horizontal = edge === 'left' || edge === 'right'
      if ((horizontal ? bounds.width : bounds.height) < 2 * (horizontal ? EXPANDED_AREA_MIN_WIDTH : EXPANDED_AREA_MIN_HEIGHT) + COLLAPSED_DIVIDER_SIZE) return t('floating.notEnoughSpace')
    }
    return undefined
  }
  const bind = async (id: string, sessionId: string) => {
    if (id === 'bay-agent-main') return
    const row = runtime.find(id, workbenchId)
    if (!row || row.busy || runtime.hasControl?.(workbenchId) === false || !sessions[sessionId as keyof typeof sessions] || archived.includes(sessionId as never)) return
    const before = row.tab
    row.busy = true; runtime.invalidate()
    try {
      if (!await runtime.authorizeClose(id, workbenchId) || runtime.find(id, workbenchId) !== row || row.tab !== before || runtime.hasControl?.(workbenchId) === false) return
      const workspace = workspaces.find(item => item.sessionIds.includes(sessionId as never))
      const binding = { sessionId, ...(workspace ? { workspaceId: workspace.workspaceId } : {}) }
      if (runtime.validBinding?.(binding) === false) return
      const tab = createSessionTab(id, row.tab.editorId, binding, row.tab.lastKnownTitle, row.tab.state)
      runtime.update(id, { ...tab, editorScope: row.tab.editorScope, bindingGeneration: (row.tab.bindingGeneration ?? 0) + 1 }, workbenchId)
      setMenu(undefined); setBindingTabId(undefined)
    } catch (error) { notice(error instanceof Error ? error.message : String(error)) }
    finally { row.busy = false; runtime.invalidate() }
  }
  const open = (editor: WorkbenchEditorCatalogRow, binding?: SessionBindingV1, options?: Record<string, unknown>) => {
    if (!runtime.enabled || runtime.hasControl?.(workbenchId) === false || runtime.canUseEditor?.(workbenchId, editor.id) === false || !editor.declaration || editor.declaration.presentation?.floating === false) { notice(t('floating.unsupportedPage')); return false }
    const address = typeof options?.resourceAddress === 'string' ? options.resourceAddress : typeof options?.nativeContentId === 'string' ? options.nativeContentId : undefined
    const automatic = options?.trigger === 'automatic'
    const previousFocus = automatic && document.activeElement instanceof HTMLElement ? document.activeElement : undefined
    const eventKey = JSON.stringify([workbenchId, binding?.sessionId, editor.id, address, options?.eventId])
    if (automatic && runtime.seenAutomatic.has(eventKey)) return true
    const resourceSource = options?.resourceSource as { sessionId?: string; parentSessionId?: string } | undefined
    const childResource = binding && resourceSource?.parentSessionId === binding.sessionId && resourceSource.sessionId && address && workbenchResourceMatchesSession(address, resourceSource.sessionId)
    if (binding && (runtime.validBinding ? !runtime.validBinding(binding) : !sessions[binding.sessionId as keyof typeof sessions] || archived.includes(binding.sessionId as never))) { notice(t('floating.originalConversationGone')); return false }
    if (binding && address && !workbenchResourceMatchesSession(address, binding.sessionId) && !childResource) { notice(t('floating.resourceMismatch')); return false }
    const state = { ...(address ? { nativeContentId: address, resourceAddress: address } : {}), ...(options?.params === undefined ? {} : { nativeParams: options.params }) }
    const failure = workbenchEditorStateFailureV1(state, editor.declaration)
    if (failure) { notice(failure); return false }
    const matches = (tab: TabDocument) => tab.editorId === editor.id && tab.editorScope === editor.scope && tab.sessionId === binding?.sessionId && tab.binding?.workspaceId === binding?.workspaceId
      && address !== undefined && (tab.state as { nativeContentId?: unknown } | null)?.nativeContentId === address
    if (options?.revealIfOpened !== false && !automatic) {
      for (const group of groupsOf(props.layout.root)) {
        const existing = group.tabs.find(matches)
        if (existing) {
          const updated = props.commit({ type: 'update-tab-state', tabId: existing.id, state: { ...(existing.state as object), ...state } as TabDocument['state'] })
          const activated = props.commit({ type: 'activate', groupId: group.id, tabId: existing.id })
          return updated !== false || activated !== false
        }
      }
    }
    const existing = options?.revealIfOpened === false ? undefined : [...runtime.instances.values()].find(row => row.workbenchId === workbenchId && row.location === 'floating' && matches(row.tab))
    const id = existing?.tab.id ?? uid()
    const tab: TabDocument = existing ? { ...existing.tab, state: { ...(existing.tab.state as object), ...state } as TabDocument['state'] }
      : createFloatingEditorTab(editor, id, binding, state as TabDocument['state'])
    const reveal = !automatic || (runtime.focusedWorkbenchId === workbenchId && runtime.focusedBinding?.sessionId === binding?.sessionId && runtime.visibleWorkbenchId === workbenchId)
    if (automatic) { runtime.seenAutomatic.add(eventKey); if (runtime.seenAutomatic.size > 2048) runtime.seenAutomatic.delete(runtime.seenAutomatic.values().next().value!) }
    runtime.open(workbenchId, tab, automatic, reveal)
    if (previousFocus?.isConnected) requestAnimationFrame(() => { if (previousFocus.isConnected && runtime.visibleWorkbenchId === workbenchId) previousFocus.focus({ preventScroll: true }) })
    return true
  }
  runtime.routes.set(workbenchId, input => {
    if (input.workbenchId !== workbenchId || !runtime.enabled || input.options?.trigger !== 'automatic' && runtime.visibleWorkbenchId !== workbenchId) return false
    const address = input.options?.resourceAddress ?? input.options?.nativeContentId
    const resourceType = typeof input.options?.resourceType === 'string' ? input.options.resourceType : typeof address === 'string' ? workbenchConversationResourceType(address) : undefined
    const policy = runtime.policy?.() ?? props.policy
    if (resourceType && conversationResourcePolicyFor(resourceType, policy)) {
      const action = conversationResourceActionFor(resourceType, policy)
      if (action.options?.ignoreResource) return true
      input = { ...input, options: { ...input.options, floating: action.options?.floating === true, ...action.options } }
    }
    const source = input.options?.resourceSource as { parentSessionId?: string; sessionId?: string } | undefined
    if (typeof address === 'string' && input.binding && !workbenchResourceMatchesSession(address, input.binding.sessionId)
      && !(source?.parentSessionId === input.binding.sessionId && source.sessionId && workbenchResourceMatchesSession(address, source.sessionId))) { notice(t('floating.sourceMismatch')); return false }
    const id = workbenchNativeSidebarForKind(input.kind)?.editorId ?? input.options?.editorId ?? input.kind
    const editor = editors.find(row => row.id === id)
    if (!editor) { notice(t('floating.resourcePageMissing')); return false }
    if (input.options?.floating !== true && input.options?.trigger === 'automatic'
      && (runtime.visibleWorkbenchId !== workbenchId || runtime.focusedWorkbenchId !== workbenchId || runtime.focusedBinding?.sessionId !== input.binding?.sessionId)) {
      const eventKey = JSON.stringify([workbenchId, input.binding?.sessionId, editor.id, address, input.options.eventId])
      runtime.pendingAreaRoutes.set(eventKey, input)
      const sourceRow = input.sourceId ? runtime.find(input.sourceId, workbenchId) : undefined
      if (sourceRow) sourceRow.unread = true
      runtime.invalidate(); return true
    }
    if (input.options?.floating !== true && runtime.visibleWorkbenchId === workbenchId) {
      if (runtime.canUseEditor?.(workbenchId, editor.id) === false) return false
      const sourceGroup = groupsOf(props.layout.root).find(group => group.tabs.some(tab => tab.id === input.sourceId))
      if (sourceGroup) {
        const address = input.options?.resourceAddress ?? input.options?.nativeContentId
        const eventKey = JSON.stringify([workbenchId, input.binding?.sessionId, editor.id, address, input.options?.eventId])
        const automatic = input.options?.trigger === 'automatic'
        const previousFocus = automatic && document.activeElement instanceof HTMLElement ? document.activeElement : undefined
        if (automatic && runtime.seenAutomatic.has(eventKey)) return true
        const state = { ...(typeof address === 'string' ? { nativeContentId: address, resourceAddress: address } : {}), ...(input.options?.params === undefined ? {} : { nativeParams: input.options.params }) } as TabDocument['state']
        if (workbenchEditorStateFailureV1(state, editor.declaration)) return false
        const existing = input.options?.revealIfOpened === false ? undefined : sourceGroup.tabs.find(tab => tab.editorId === editor.id && tab.sessionId === input.binding?.sessionId && (tab.state as { nativeContentId?: unknown })?.nativeContentId === address)
        let accepted: boolean
        if (existing) {
          const updated = props.commit({ type: 'update-tab-state', tabId: existing.id, state: { ...(existing.state as object), ...(state as object) } as TabDocument['state'] })
          const activated = props.commit({ type: 'activate', groupId: sourceGroup.id, tabId: existing.id })
          accepted = updated !== false || activated !== false
        } else {
          const replaceId = input.options?.replaceTab === true ? input.sourceId : undefined
          const tab = createFloatingEditorTab(editor, replaceId ?? uid(), input.binding, state)
          accepted = props.commit(replaceId ? { type: 'replace-tab', tabId: replaceId, tab } : { type: 'add-tab', groupId: sourceGroup.id, tab }) !== false
        }
        if (accepted && automatic) runtime.seenAutomatic.add(eventKey)
        if (accepted && previousFocus?.isConnected) requestAnimationFrame(() => { if (previousFocus.isConnected && runtime.visibleWorkbenchId === workbenchId) previousFocus.focus({ preventScroll: true }) })
        return accepted
      }
    }
    return open(editor, input.binding, input.options)
  })
  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return
    const measure = () => setSize({ width: canvas.clientWidth || 900, height: canvas.clientHeight || 600 })
    measure(); const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measure)
    observer?.observe(canvas); window.addEventListener('resize', measure)
    return () => { observer?.disconnect(); window.removeEventListener('resize', measure) }
  }, [canvasRef])
  useEffect(() => {
    if (!visible || !runtime.enabled || runtime.visibleWorkbenchId !== workbenchId) return
    for (const [key, input] of runtime.pendingAreaRoutes) if (input.workbenchId === workbenchId && runtime.focusedWorkbenchId === workbenchId && input.binding?.sessionId === runtime.focusedBinding?.sessionId) {
      runtime.pendingAreaRoutes.delete(key)
      if (runtime.route?.(input) && input.sourceId) {
        const source = runtime.find(input.sourceId, workbenchId)
        if (source) { source.unread = false; runtime.invalidate() }
      }
    }
  }, [runtime, visible, workbenchId, props.layout, runtimeRevision])
  useEffect(() => () => gesture.current?.(), [])
  useEffect(() => {
    if (!menu) return
    const outside = (event: PointerEvent) => { if (event.target instanceof Node && !windowRef.current?.contains(event.target)) setMenu(undefined) }
    document.addEventListener('pointerdown', outside); return () => document.removeEventListener('pointerdown', outside)
  }, [menu])
  useEffect(() => {
    const el = strip.current; if (!el) return
    const wheel = (event: WheelEvent) => { if (event.ctrlKey || event.metaKey || event.altKey || el.scrollWidth <= el.clientWidth) return; event.preventDefault(); el.scrollLeft += Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY }
    el.addEventListener('wheel', wheel, { passive: false }); return () => el.removeEventListener('wheel', wheel)
  }, [space.expanded, rows.length])
  const pointerGesture = (event: ReactPointerEvent, kind: string) => {
    if (event.button !== 0 || space.maximized && kind !== 'launcher') return
    if (kind === 'move' && (event.target as HTMLElement).closest('button,[role=tab]')) return
    event.preventDefault(); event.stopPropagation(); gesture.current?.()
    const x = event.clientX, y = event.clientY, original = { ...rect }, startLauncher = { ...launcher }
    let moved = false
    const move = (next: PointerEvent) => {
      const dx = next.clientX - x, dy = next.clientY - y
      moved ||= Math.abs(dx) + Math.abs(dy) > 4
      if (kind === 'launcher') runtime.patch(workbenchId, { launcher: { x: Math.max(0, Math.min(size.width - 38, startLauncher.x + dx)), y: Math.max(0, Math.min(size.height - 38, startLauncher.y + dy)) } })
      else {
        const value: FloatingRect = { ...original }
        if (kind === 'move') { value.x += dx; value.y += dy }
        else {
          if (kind.includes('e')) value.width += dx
          if (kind.includes('s')) value.height += dy
          if (kind.includes('w')) { value.x += dx; value.width -= dx }
          if (kind.includes('n')) { value.y += dy; value.height -= dy }
        }
        runtime.patch(workbenchId, { rect: clampFloatingRect(value, size.width, size.height) })
      }
    }
    const clean = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', end); window.removeEventListener('pointercancel', cancel); window.removeEventListener('keydown', key); gesture.current = undefined }
    const end = () => { clean(); runtime.patch(workbenchId, kind === 'launcher' && !moved ? { expanded: true } : {}, true) }
    const cancel = () => { clean(); runtime.patch(workbenchId, { rect: original, launcher: startLauncher }) }
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') cancel() }
    gesture.current = clean
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', end); window.addEventListener('pointercancel', cancel); window.addEventListener('keydown', key)
  }
  const pin = async (id: string, areaId: string, edge: DropEdge) => {
    if (id === 'bay-agent-main') { notice(t('floating.mainStays')); return }
    const row = runtime.find(id, workbenchId)
    if (!row || row.busy || row.location !== 'floating') return
    const reason = pinReason(row.tab, areaId, edge)
    if (reason) { notice(reason); return }
    setMenu(undefined)
    try { if (!await runtime.transfer(id, tab => props.pin(tab, areaId, edge), workbenchId)) notice(t('floating.placeFailed')) }
    catch (error) { notice(error instanceof Error ? error.message : t('floating.placeFailedShort')) }
  }
  const closeTab = async (id: string) => {
    if (id === 'bay-agent-main') return
    try {
      if (await runtime.close(id, workbenchId)) runtime.patch(workbenchId, { error: undefined })
      else if (runtime.find(id, workbenchId)) notice(t('floating.closeIncomplete'))
    } catch { notice(t('floating.closeFailed')) }
  }
  const dragTab = (event: ReactPointerEvent, row: FloatingInstance) => {
    if (event.button !== 0 || row.busy || (event.target as HTMLElement).closest('button')) return
    const x = event.clientX, y = event.clientY; let target: typeof drop; let dragged = false
    gesture.current?.()
    const move = (e: PointerEvent) => {
      if (!dragged && Math.abs(e.clientX - x) + Math.abs(e.clientY - y) < 6) return
      dragged = true; if (windowRef.current) windowRef.current.style.pointerEvents = 'none'
      const header = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('[data-workbench-area-header]')
      const area = header?.closest<HTMLElement>('[data-workbench-group]')
      if (!header || !area || !canvasRef.current?.contains(area)) { target = undefined; setDrop(undefined); return }
      const r = header.getBoundingClientRect()
      target = { areaId: area.dataset.workbenchGroup!, edge: 'center', rect: r, reason: pinReason(row.tab, area.dataset.workbenchGroup!, 'center') }; setDrop(target)
    }
    const clean = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', end); window.removeEventListener('pointercancel', cancel); window.removeEventListener('keydown', key); if (windowRef.current) windowRef.current.style.pointerEvents = ''; setDrop(undefined); gesture.current = undefined }
    const end = (event: PointerEvent) => { if (dragged) move(event); const result = target; clean(); suppressClick.current = dragged; setTimeout(() => { suppressClick.current = false }, 0); if (dragged && result && !result.reason) void pin(row.tab.id, result.areaId, result.edge) }
    const cancel = () => clean()
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') cancel() }
    gesture.current = clean; window.addEventListener('pointermove', move); window.addEventListener('pointerup', end); window.addEventListener('pointercancel', cancel); window.addEventListener('keydown', key)
  }
  const activate = (id: string) => { const row = runtime.find(id, workbenchId); if (row) { row.unread = false; if (row.tab.editorId === 'workbench.conversation' || row.tab.editorId === 'workbench.conversation.start') { runtime.focusedBinding = row.tab.binding; runtime.focusedWorkbenchId = workbenchId } }; runtime.patch(workbenchId, { activeId: id, expanded: true }) }
  const renderRow = (row: FloatingInstance) => {
    const tab = row.tab, editor = editors.find(item => item.id === tab.editorId && item.scope === tab.editorScope)
    const areaId = 'floating:' + tab.id
    const project = Object.values(frame.workbenchDirectory?.getProjects?.(workbenchId) ?? {}).find(project => tab.binding?.workspaceId ? project.workspaceId === tab.binding.workspaceId : tab.state && typeof tab.state === 'object' && !Array.isArray(tab.state) && tab.state.projectId === project.projectId)
    const commands: AreaContentCommandHandlersV1 = {
      commit(command) {
        if (row.busy) return false
        if (tab.id === 'bay-agent-main' && command.type !== 'activate') return false
        if (command.type === 'close-tab') { if (tab.id === 'bay-agent-main') return false; void closeTab(tab.id); return true }
        if (command.type === 'activate') { if (visible && runtime.enabled) activate(tab.id); return true }
        const next = applyLayoutCommand({ version: 2, root: { kind: 'group', id: areaId, tabs: [runtime.find(tab.id, workbenchId)?.tab ?? tab], activeTabId: tab.id }, activeGroupId: areaId }, command)
        const updated = tabsOf(next.root)[0]; if (updated) runtime.update(tab.id, updated, workbenchId)
        return true
      },
      openBindingPicker: () => { if (tab.id !== 'bay-agent-main') { activate(tab.id); openBindingPicker(tab.id) } },
      placeConversation: async input => {
        if (tab.id === 'bay-agent-main') throw new Error(t('floating.mainPersistent'))
        const create = frame.createWorkspaceSession
        if (!create) throw new Error(t('floating.prepareFailed'))
        return runtime.prepareConversation(tab.id, workbenchId, async () => {
          // Create through an Area of the same project when the Workbench has
          // one: the Host then records the Session in this Workbench, which a
          // LAN participant needs to use it at all, and which every surface
          // needs to see the same conversation.
          const areaId = Object.entries(frame.workbenchDirectory?.getAreaProjects?.(workbenchId) ?? {}).find(([, project]) => project?.workspaceId === input.workspaceId)?.[0]
          const created = await create(input.workspaceId, { requestId: uid(), ...(input.agentPreset ? { agentPreset: input.agentPreset } : {}), ...(areaId ? { workbenchId, areaId } : {}) })
          return created.target
        })
      },
      completePreparedConversation: input => {
        const current = runtime.find(tab.id, workbenchId)
        if (!current || input.moduleInstanceId !== tab.id || current.tab.bindingGeneration !== input.bindingGeneration || current.tab.sessionId !== input.target.sessionId) return false
        runtime.update(tab.id, { ...current.tab, editorId: 'workbench.conversation', editorScope: 'session', lastKnownTitle: '对话' }, workbenchId); return true
      },
      openSession: async id => { await bind(tab.id, id) },
      openNativeTab: (kind, options) => runtime.route?.({ workbenchId, kind, options: { floating: true, ...options }, ...(tab.binding ? { binding: tab.binding } : {}), sourceId: tab.id }) ?? false,
      openConversationResource: (address, placement, source) => routeWorkbenchConversationResource((kind, options) => commands.openNativeTab(kind, options), address, props.policy, placement, tab.sessionId, source, editors.flatMap(item => item.declaration?.conversationResources ?? [])),
      reportStateFailure: message => { if (message) notice(message) },
    }
    const shown = visible && space.expanded && active?.tab.id === tab.id
    const focusBinding = () => { if (tab.editorId === 'workbench.conversation' || tab.editorId === 'workbench.conversation.start') { runtime.focusedWorkbenchId = workbenchId; runtime.focusedBinding = tab.binding; runtime.invalidate() } }
    return <div key={tab.id} className={css.body} data-workbench-floating-visible={shown} data-workbench-floating-editor={tab.editorId} data-workbench-floating-session={tab.sessionId ?? tab.binding?.sessionId} onPointerDown={focusBinding} onFocusCapture={focusBinding} style={{ display: shown ? 'flex' : 'none', flexDirection: 'column' }}>{tab.id === 'bay-agent-main' && bayAgent && baySnapshot.workbenchId === workbenchId ? <WorkbenchBayAgentTasks key={workbenchId} controller={bayAgent} snapshot={baySnapshot} workspaces={workspaces} openWorker={sessionId => {
      const workspace = workspaces.find(row => row.sessionIds.includes(sessionId as never))
      const id = 'bay-worker:' + sessionId
      if (!runtime.find(id, workbenchId)) runtime.open(workbenchId, createSessionTab(id, 'workbench.conversation', { sessionId, ...(workspace ? { workspaceId: workspace.workspaceId } : {}) }, 'Worker 对话'), false, true)
      activate(id)
    }} /> : null}{tab.id === 'bay-agent-main' && !tab.sessionId ? bayError ? <div className={css.empty} role="alert"><strong>Bay Agent</strong><p>{bayError}</p><button onClick={() => void revealBayAgent()}>{t('workspace.reconnect')}</button></div> : <WorkbenchPageLoading label="Bay Agent" icon="message" /> : <div style={{ flex: 1, minHeight: 0, position: 'relative' }}><RetainedEditorTarget id={tab.id} workbenchId={workbenchId}>
      <MemoizedEditor workbenchId={workbenchId} tab={tab} renderSlot={frame.renderSlot} editors={editors} editor={editor} editorAvailable={!!editor} extensionAccess={props.extensionAccess}
        projection={{ areaId, ...(project ? { projectId: project.projectId, ...(project.workspaceId ? { workspaceId: project.workspaceId } : {}) } : {}), tabId: tab.id, editorId: tab.editorId, editorScope: tab.editorScope, state: tab.state, lastKnownTitle: tab.lastKnownTitle, availability: editor ? 'available' : 'unsupported', ...(tab.sessionId ? { sessionId: tab.sessionId } : {}), ...(tab.pendingBinding ? { pendingBinding: tab.pendingBinding } : {}) }}
        commands={commands} areaClaim={'floating:' + tab.id + ':' + (tab.bindingGeneration ?? 0)} lifecycle={{ visibility: shown ? 'visible' : 'background', focused: shown && runtime.focusedBinding?.sessionId === tab.sessionId, background: editor?.declaration?.runtime.background ?? 'keep', collapsed: editor?.declaration?.runtime.collapsed ?? 'keep' }} />
    </RetainedEditorTarget></div>}</div>
  }
  const chooser = selectableWorkbenchEditors(editors, props.hidden)
  const unavailable = (editor: WorkbenchEditorCatalogRow) => editor.declaration?.presentation?.floating === false
    ? t('floating.unsupportedFloating') : !editor.declaration ? t('floating.missingDeclaration') : undefined
  const canvasRect = canvasRef.current?.getBoundingClientRect()
  return <div className={css.layer} data-workbench-floating-layer style={{ display: visible ? undefined : 'none' }}>
    {!space.expanded ? <button type="button" className={css.launcher + ' ' + accentFrameCss.frame} data-session-frame={launcherMarker ? 'launcher' : undefined} data-accent={launcherMarker?.accentToken} style={{ left: launcher.x, top: launcher.y }} aria-label={t('workspace.expandFloatingWorkspace')} title={t('workspace.floatingWorkspaceDragToReposition')} onPointerDown={e => pointerGesture(e, 'launcher')} onClick={e => { if (e.detail === 0) runtime.patch(workbenchId, { expanded: true }) }}><FloatingWorkspaceIcon size={30} />{rows.some(row => row.unread) ? <span className={css.badge} /> : null}</button> : null}
    <div ref={windowRef} className={css.window + ' ' + accentFrameCss.frame} data-session-frame={sourceMarker ? 'floating' : undefined} data-accent={sourceMarker?.accentToken} data-workbench-floating-window role="region" aria-label={t('workspace.floatingWorkspace')} style={{ display: space.expanded ? undefined : 'none', left: rect.x, top: rect.y, width: rect.width, height: rect.height }}
      onKeyDown={event => { if (event.key === 'Escape' && menu) { event.stopPropagation(); setMenu(undefined) } if (event.altKey && event.key === 'm') { event.preventDefault(); runtime.patch(workbenchId, { expanded: false }) } }}>
      <header className={css.header} onPointerDown={e => pointerGesture(e, 'move')} onDoubleClick={e => { if (!(e.target as HTMLElement).closest('button,[role=tab]')) runtime.patch(workbenchId, { maximized: !space.maximized }) }}>
        <div ref={strip} className={css.tabs} role="tablist" aria-label={t('workspace.temporaryPages')}>{rows.map((row, index) => { const { presentation, summary } = tabRows[index]!; const systemTab = row.tab.id === 'bay-agent-main'; return <WorkbenchTabTooltip key={row.tab.id} summary={summary} disabled={menu !== undefined}><div className={css.tab} role="tab" aria-selected={active?.tab.id === row.tab.id} tabIndex={active?.tab.id === row.tab.id ? 0 : -1} aria-description={[summary.information?.detail, summary.statusLabel].filter(Boolean).join(' · ')} onPointerDown={e => { if (!systemTab) dragTab(e, row) }} onClick={() => { if (suppressClick.current) { suppressClick.current = false; return }; activate(row.tab.id) }} onKeyDown={e => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) { e.preventDefault(); const next = e.key === 'Home' ? 0 : e.key === 'End' ? rows.length - 1 : (index + (e.key === 'ArrowRight' ? 1 : -1) + rows.length) % rows.length; activate(rows[next]!.tab.id); strip.current?.querySelectorAll<HTMLElement>('[role=tab]')[next]?.focus() } if (e.key === 'Delete' && !systemTab) { e.preventDefault(); e.stopPropagation(); void closeTab(row.tab.id) } }}><WorkbenchEditorIcon name={presentation.icon} iconSvg={presentation.iconSvg} />{summary.conversation ? <WorkbenchTabStatus summary={summary} /> : null}<span style={{ fontSize: `${tabFontSize}px` }}>{summary.title}</span>{row.unread ? <i className={css.dot} aria-label={t('workspace.unreadContent')} title={t('workspace.unreadContent')} /> : null}{systemTab ? <i aria-label={t('workspace.bayAgentMainTab')} title={t('workspace.bayAgentMainTab')} style={{ fontStyle: 'normal', fontSize: 10, opacity: .7 }}>●</i> : interactionPolicy.showTabCloseButtons !== false ? <button type="button" disabled={row.busy} aria-label={t('floating.closePrefix') + summary.title} title={t('floating.closePrefix') + summary.title} onClick={e => { e.stopPropagation(); void closeTab(row.tab.id) }}><IconCloseOutlineMedium size={12} /></button> : null}</div></WorkbenchTabTooltip> })}</div>
        <button type="button" className={css.add} aria-label={t('workspace.addTemporaryPage')} title={t('page.add')} onClick={() => setMenu(menu === 'add' ? undefined : 'add')}><IconPlusOutlineMedium size={16} /></button>
        <div className={css.headerActions} role="group" aria-label={t('workspace.floatingWindowActions')}>
          {bayAgent ? <button type="button" aria-label={bayAgentTabVisible ? t('floating.returnAgent') : t('floating.summonAgent')} title={bayAgentTabVisible ? t('floating.returnAgent') : t('floating.summonAgent')} aria-pressed={bayAgentTabVisible} onClick={toggleBayAgent}><IconAgentPresetOutlineMedium size={16} /></button> : null}
          <button type="button" aria-label={t('workspace.floatingWorkspaceMenu')} title={t('workspace.floatingWorkspaceMenu')} aria-expanded={menu === 'window'} onClick={() => setMenu(menu === 'window' ? undefined : 'window')}><IconEllipsisOutlineMedium size={16} /></button>
          <button type="button" aria-label={space.maximized ? t('floating.restore') : t('floating.maximize')} title={space.maximized ? t('floating.restore') : t('floating.maximize')} onClick={() => runtime.patch(workbenchId, { maximized: !space.maximized })}><svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5"><path d={space.maximized ? 'M7 4h9v9M4 7h9v9H4Z' : 'M5 2H2v3m13-3h3v3M2 15v3h3m10 0h3v-3M6 14 14 6'} /></svg></button>
          <button type="button" aria-label={t('workspace.minimizeFloatingWorkspace')} title={t('workspace.minimizeFloatingWorkspace')} onClick={() => runtime.patch(workbenchId, { expanded: false })}><svg width="15" height="15" viewBox="0 0 20 20" stroke="currentColor"><path d="M4 10h12" /></svg></button>
        </div>
      </header>
      {active ? <div className={css.source} data-floating-source aria-label={t('workspace.pageSource')}>
        <span className={css.sourceProject} title={t('floating.projectPrefix') + sourceTitle}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M3 7V5a1 1 0 0 1 1-1h5l2 3h9a1 1 0 0 1 1 1v11H3Z" /></svg><span>{sourceTitle}</span></span>
        <span className={css.sourceDivider} aria-hidden="true">/</span>
        <span className={css.sourceConversation} data-accent={sourceMarker?.accentToken} title={t('floating.conversationPrefix') + sessionTitle} aria-label={t('floating.conversationPrefix') + (sourceMarker ? sourceMarker.label + ' · ' : '') + sessionTitle}>
          {sourceMarker ? <span className={frameCss.markerLabel} aria-hidden="true">{sourceMarker.label}</span> : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M5 4h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-8l-5 3v-3H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z" /></svg>}
          <span>{sessionTitle}</span>
        </span>
        {active.tab.id !== 'bay-agent-main' && (active.tab.editorScope === 'session' || active.tab.pendingBinding || active.tab.binding) ? <PendingSessionBindingPicker
          key={active.tab.id} sessionRows={sessions} sessionIds={Object.keys(sessions)} workspaces={workspaces}
          sessionMarkers={{}} sessionMarkersByWorkspace={props.sessionMarkers ?? {}} archivedSessionIds={archived}
          triggerLabel={sessionId ? t('floating.changeConversation') : t('floating.chooseConversation')} disabled={active.busy}
          open={visible && space.expanded && bindingTabId === active.tab.id}
          setOpen={open => { if (open) openBindingPicker(active.tab.id); else setBindingTabId(undefined) }}
          onSelect={binding => { void bind(active.tab.id, binding.sessionId) }}
        /> : null}
      </div> : null}
      {space.error ? <div className={css.error} role="status">{space.error}<button type="button" title={t('workspace.dismissTip')} aria-label={t('workspace.dismissTip')} onClick={() => runtime.patch(workbenchId, { error: undefined })}>{t('workspace.dismissTip')}</button></div> : null}
      <div className={css.content}>{rows.map(renderRow)}{!rows.length ? <div className={css.empty}><FloatingWorkspaceIcon size={44} /><p>{t('workspace.previewPagesBeforeMovingThemToAn')}</p><button onClick={() => setMenu('add')}><IconPlusOutlineMedium size={16} /> {t('page.add')}</button><small>{t('workspace.temporaryTabsAreKeptOnlyForThis')}</small></div> : null}</div>
      {menu ? <div className={css.menu} role={menu === 'pin' ? 'dialog' : 'menu'} aria-label={menu === 'pin' ? t('workspace.moveToArea') : t('floating.actions')} data-floating-menu-view={menu}>
        <div className={css.menuHeader}><strong>{menuTitle}</strong><button type="button" className={css.menuClose} aria-label={t('workspace.closeFloatingMenu')} title={t('workspace.closeMenu')} onClick={() => setMenu(undefined)}><IconCloseOutlineMedium size={14} /></button></div>
        {menu === 'add' ? <WorkbenchEditorPicker editors={chooser} mode="add" preferences={props.editorMenu} unavailable={unavailable} onSelect={editor => {
          setMenu(undefined)
          if (open(editor) && runtime.find(runtime.workspace(workbenchId).activeId ?? '', workbenchId)?.tab.pendingBinding) setBindingTabId(runtime.workspace(workbenchId).activeId)
        }} /> : null}
        {menu === 'window' ? <><button disabled={!active || active.busy || active.tab.id === 'bay-agent-main'} onClick={() => setMenu('pin')}>{t('workspace.moveToArea')}</button><button onClick={() => { setTabQuery(''); setMenu('tabs') }}>{t('workspace.allTemporaryPages')}</button><button disabled={!active || active.tab.id === 'bay-agent-main'} onClick={() => { if (active) openBindingPicker(active.tab.id) }}>{t('workspace.selectSourceConversation')}</button><button onClick={() => { runtime.patch(workbenchId, { rect: defaultFloatingRect(size.width, size.height), launcher: { x: size.width - 54, y: size.height - 54 }, maximized: false }, true); setMenu(undefined) }}>{t('workspace.resetPosition')}</button></> : null}
        {menu === 'pin' && active ? <WorkbenchPlacementPicker key={workbenchId + ':' + active.tab.id} layout={props.layout} title={workbenchPageTitle(t, active.tab.editorId, active.tab.lastKnownTitle)} busy={active.busy}
          reason={(areaId, edge) => pinReason(active.tab, areaId, edge)}
          projectPath={areaId => (frame.workbenchDirectory?.getAreaProjects?.(workbenchId)[areaId] ?? groupsOf(props.layout.root).find(group => group.id === areaId)?.project)?.relativePath}
          onConfirm={(areaId, edge) => void pin(active.tab.id, areaId, edge)} onCancel={() => setMenu(undefined)} /> : null}
        {menu === 'tabs' ? <>
          <input className={css.tabSearch} autoFocus aria-label={t('workspace.searchTemporaryPages')} placeholder={t('page.searchDetails')} value={tabQuery} onChange={event => setTabQuery(event.target.value)} />
          {tabRows.filter(({ summary }) => summary.information?.searchText.includes(tabQuery.trim().toLocaleLowerCase('zh-CN'))).map(({ tab, summary }) => <WorkbenchTabTooltip key={tab.id} summary={summary}><button className={css.tabListItem} onClick={() => { activate(tab.id); setMenu(undefined) }}>
            {summary.conversation ? <WorkbenchTabStatus summary={summary} /> : null}
            <span className={css.tabListCopy}>{summary.title}{summary.information?.detail ? <small>{summary.information.detail}</small> : null}</span>
            <small>{summary.statusLabel}</small>
          </button></WorkbenchTabTooltip>)}
          {!tabRows.some(({ summary }) => summary.information?.searchText.includes(tabQuery.trim().toLocaleLowerCase('zh-CN'))) ? <p>{t('page.noMatches')}</p> : null}
        </> : null}
      </div> : null}
      {!space.maximized ? ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'].map(edge => <div key={edge} className={css.resize + ' ' + css[edge]} data-floating-resize={edge} onPointerDown={e => pointerGesture(e, edge)} />) : null}
    </div>
    {drop && canvasRect ? <div className={css.drop} data-drop-valid={!drop.reason} style={{ left: drop.rect.left - canvasRect.left + (drop.edge === 'right' ? drop.rect.width / 2 : 0), top: drop.rect.top - canvasRect.top + (drop.edge === 'bottom' ? drop.rect.height / 2 : 0), width: drop.rect.width / (['left','right'].includes(drop.edge) ? 2 : 1), height: drop.rect.height / (['top','bottom'].includes(drop.edge) ? 2 : 1) }}>{drop.reason ?? (drop.edge === 'center' ? t('floating.addTab') : t('floating.splitArea'))}</div> : null}
  </div>
}
