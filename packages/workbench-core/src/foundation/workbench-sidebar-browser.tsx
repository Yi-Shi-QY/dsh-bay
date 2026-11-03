import { useEffect, useMemo, useRef, useSyncExternalStore, type ReactNode } from 'react'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionStatusSnapshot } from '@deepseek-ai/dsh-client-ui-session/client'
import { type SessionListState as ProjectedSessionListState, projectWorkbenchSidebarSessions } from './workbench-sidebar-session-list.ts'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SessionListState, SessionSearchResultItem } from '@deepseek-ai/dsh-api-session-controller/client'
import type { WorkspaceId, WorkspaceSnapshot as WorkspaceListState, WorkspaceView } from '@deepseek-ai/dsh-api-workspace-controller/client'
import { WorkspaceBrowser } from './workbench-sidebar/generated/upstream/ui-workspace/WorkspaceBrowser.tsx'
import { createWorkspaceViewStore } from './workbench-sidebar/generated/upstream/ui-workspace/stores.ts'
import { zh as workspaceZh } from './workbench-sidebar/generated/upstream/ui-workspace/locales.ts'
import type { DirectoryFlowOwnerProps, WorkspaceBrowserProps } from './workbench-sidebar/generated/upstream/ui-workspace/contract/slots.ts'
/** Structural routing face supplied by Core.  Shell deliberately does not
 * import Workbench's repository/session-placement implementation. */
export interface WorkbenchShellSidebarRoutingV1 {
  getSnapshot(): { focusedAreaId?: string; focusedSessionId?: string }
  subscribe(listener: () => void): () => void
  startSession(input: { workspaceId?: string; areaId: string; agentPreset?: string }): Promise<unknown>
  bindExistingSession(input: { sessionId: string; areaId: string; strategy: 'replace-focused-area' }): Promise<unknown>
}

export interface WorkbenchSidebarHostActionsV1 {
  sessionStatus: HostObservable<SessionStatusSnapshot>
  searchSessions(query: string, signal: AbortSignal): Promise<{ items: readonly SessionSearchResultItem[]; hasMore: boolean }>
  searchResultLimit: number
  renameSession(sessionId: SessionId, title: string): Promise<void>
  forkSession(sessionId: SessionId): Promise<SessionId>
  renameWorkspace(workspaceId: WorkspaceId, title: string): Promise<void>
  deleteWorkspace(workspaceId: WorkspaceId): Promise<void>
  insertWorkspaceBefore(workspaceId: WorkspaceId, beforeWorkspaceId?: WorkspaceId): Promise<void>
  archiveSession(sessionId: SessionId): Promise<void>
  insertSessionBefore(workspaceId: WorkspaceId, sessionId: SessionId, beforeSessionId?: SessionId): Promise<void>
  createWorkspace(input: { path: string }): Promise<WorkspaceView>
  pickDirectory?: () => Promise<string | null>
  hostHome?: string
}

export interface WorkbenchSidebarBrowserProps {
  wide: boolean
  expandSidebar: () => void
  useSessions: <T>(selector: (state: SessionListState) => T) => T
  useWorkspaces: <T>(selector: (state: WorkspaceListState) => T) => T
  routing: WorkbenchShellSidebarRoutingV1
  hostActions: WorkbenchSidebarHostActionsV1
}

const workspaceLabels: Readonly<Record<string, string>> = {
  ...workspaceZh,
  copy: '复制',
  search: '搜索',
  close: '关闭',
  cancel: '取消',
}

/** Include the common labels normally supplied by the official locale seat. */
function workspaceTranslate(key: string, vars?: Record<string, string | number>): string {
  const value = workspaceLabels[key] ?? key
  if (vars === undefined) return value
  return value.replace(/\{(\w+)\}/g, (_match, name: string) => String(vars[name] ?? `{${name}}`))
}

function DirectoryFlowDriver({ owner, pickDirectory }: {
  owner: DirectoryFlowOwnerProps
  pickDirectory: () => Promise<string | null>
}): ReactNode {
  useEffect(() => {
    if (!owner.open || owner.busy) return
    let live = true
    void pickDirectory().then(path => {
      if (!live) return
      if (path === null) owner.onCancel()
      else owner.onPicked(path)
    }, reason => {
      if (live) owner.onError(reason instanceof Error ? reason.message : String(reason))
    })
    return () => { live = false }
  }, [owner, pickDirectory])
  return null
}

/**
 * Exact upstream WorkspaceBrowser with only its navigation callbacks adapted
 * to explicit Workbench Area placement. Search, grouping, drag ordering,
 * menus, dialogs and keyboard behavior remain in the locked upstream copy.
 */
export function WorkbenchSidebarBrowser({
  wide, expandSidebar, useSessions, useWorkspaces, routing, hostActions,
}: WorkbenchSidebarBrowserProps): ReactNode {
  const routeSnapshot = useSyncExternalStore(routing.subscribe, routing.getSnapshot, routing.getSnapshot)
  const storeRef = useRef<ReturnType<ReturnType<typeof createWorkspaceViewStore>['create']>>()
  if (storeRef.current === undefined) storeRef.current = createWorkspaceViewStore().create('workbench-mode')
  const store = storeRef.current
  const useStore = <T,>(selector: (state: ReturnType<typeof store.getSnapshot>) => T): T => useSyncExternalStore(
    store.subscribe,
    () => selector(store.getSnapshot()),
    () => selector(store.getSnapshot()),
  )
  // The upstream browser may read `current` for row emphasis and expansion.
  // Project the focused Workbench binding instead of DSH's global current.
  const officialList = useSessions(state => state)
  const pending = useSyncExternalStore(hostActions.sessionStatus.subscribe, hostActions.sessionStatus.getSnapshot)
  const areaList = useMemo(() => projectWorkbenchSidebarSessions(
    officialList, routeSnapshot.focusedSessionId as SessionId | undefined, pending,
  ), [officialList, routeSnapshot.focusedSessionId, pending])
  const useAreaSessions = <T,>(selector: (state: ProjectedSessionListState) => T): T => selector(areaList)
  const areaId = routeSnapshot.focusedAreaId
  const bind = (sessionId: SessionId): void => {
    if (areaId === undefined) return
    void routing.bindExistingSession({ sessionId, areaId, strategy: 'replace-focused-area' })
  }
  const start = (workspaceId?: WorkspaceId): void => {
    if (areaId === undefined) return
    void routing.startSession({ ...(workspaceId === undefined ? {} : { workspaceId: String(workspaceId) }), areaId })
  }
  const fork = (sessionId: SessionId): void => {
    if (areaId === undefined) return
    void hostActions.forkSession(sessionId).then(childId => routing.bindExistingSession({
      sessionId: childId, areaId, strategy: 'replace-focused-area',
    }))
  }
  const useDirectoryFlow = <T,>(selector: (available: boolean) => T): T => selector(hostActions.pickDirectory !== undefined)
  const useHostDescription = <T,>(selector: (description: { home?: string } | undefined) => T): T => selector(
    hostActions.hostHome === undefined ? undefined : { home: hostActions.hostHome },
  )
  const renderSlot = (name: string, owner: object, options?: { fallback?: ReactNode }): ReactNode => {
    if (name === 'sidebar.workspaces.directoryFlow' && hostActions.pickDirectory !== undefined) {
      return <DirectoryFlowDriver owner={owner as DirectoryFlowOwnerProps} pickDirectory={hostActions.pickDirectory} />
    }
    return options?.fallback ?? null
  }
  const browserProps = {
    wide,
    expandSidebar,
    useSessions: useAreaSessions,
    useWorkspaces,
    useStore,
    actions: store.actions,
    startSession: start,
    open: bind,
    searchSessions: hostActions.searchSessions,
    searchResultLimit: hostActions.searchResultLimit,
    renameSession: hostActions.renameSession,
    forkSession: fork,
    renameWorkspace: hostActions.renameWorkspace,
    deleteWorkspace: hostActions.deleteWorkspace,
    insertWorkspaceBefore: hostActions.insertWorkspaceBefore,
    archiveSession: hostActions.archiveSession,
    insertSessionBefore: hostActions.insertSessionBefore,
    createWorkspace: hostActions.createWorkspace,
    useDirectoryFlow,
    useHostDescription,
    renderSlot,
    t: workspaceTranslate as never,
  } as unknown as WorkspaceBrowserProps
  return <WorkspaceBrowser {...browserProps} />
}
