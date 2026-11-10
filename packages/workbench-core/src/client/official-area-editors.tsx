import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { RemoteFailure } from '@deepseek-ai/dsh-api-remotes/client'
import type { TerminalLaunchShells, TerminalView, TerminalViewState } from '@deepseek-ai/dsh-api-terminal-controller/client'
import type { WebTerminalId, WebTerminalInfo } from '@deepseek-ai/dsh-api-terminal-controller/types'
import type { WorkspaceDirectoryEntry } from '@deepseek-ai/dsh-api-workspace-files/types'
import { ProjectFilesEditor } from './ProjectFilesEditor.tsx'
import { WorkbenchPageLoading, WorkbenchPageTransition } from '../foundation/WorkbenchPageLoading.tsx'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SidebarRightTabClaim, SidebarRightTabInfo } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type {} from '@deepseek-ai/dsh-client-resources/client'
import {
  Button,
  IconChevronDownOutlineMedium,
  IconChevronLeftOutlineMedium,
  IconChevronRightOutlineMedium,
  IconFolderCloseMedium,
  IconFolderOpenMedium,
  IconPlusOutlineMedium,
  IconRefreshOutlineMedium,
  IconRightUpOutlineMedium,
  IconShieldOutlineMedium,
  FileTypeIcon,
  Menu,
  classifyFileType,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import { fileAddressFor, parseFileAddress, pathPartsOf } from '@deepseek-ai/dsh-util-workspace-path'
import type { WorkbenchEditorOwnerProps } from './editor-slots.ts'
import type { ThemeSnapshot } from '@deepseek-ai/dsh-client-ui-theme/client'
import type { JsonValue } from '../foundation/model.ts'
import { DshTerminalTheme, observeDshTerminalCursor } from './dsh-terminal-theme.ts'
import { createWorkbenchNativeAreaSlotRenderer } from './native-area-slot-renderer.tsx'
import { retainWorkbenchArea } from './native-area-reference.ts'
import { NativeSidebarAreaEditor } from './native-sidebar-area-editor.tsx'
import { createWorkbenchNativeConversationEditors } from './native-conversation-editors.tsx'
import { workbenchNativeSidebarForKind } from './native-sidebar-registry.ts'
import css from './official-area-editors.module.css'

declare const __WORKBENCH_XTERM_CSS__: string | undefined

function ensureXtermCss(): void {
  if (typeof document === 'undefined' || document.querySelector('style[data-workbench-xterm-css]') !== null) return
  const css = typeof __WORKBENCH_XTERM_CSS__ === 'string' ? __WORKBENCH_XTERM_CSS__ : ''
  if (css === '') return
  const style = document.createElement('style')
  style.dataset.workbenchXtermCss = ''
  style.textContent = `${css}
    [data-workbench-terminal-screen] .xterm { height: 100%; }
    [data-workbench-terminal-screen] .xterm-viewport { background: var(--dsw-alias-bg-base, #111) !important; }
    [data-workbench-terminal-screen] .xterm-cursor { opacity: 1; }
    [data-workbench-terminal-screen] .xterm-rows .xterm-cursor.xterm-cursor-block { background-color: var(--terminal-cursor, currentColor); color: var(--terminal-cursor-accent, var(--dsw-alias-bg-base, #111)); }
    [data-workbench-terminal-screen] .xterm-rows .xterm-cursor.xterm-cursor-outline { outline-color: var(--terminal-cursor, currentColor); }
    [data-workbench-terminal-screen] .xterm-rows .xterm-cursor.xterm-cursor-bar { box-shadow: 1px 0 0 var(--terminal-cursor, currentColor) inset; }
    [data-workbench-terminal-screen] .xterm-rows .xterm-cursor.xterm-cursor-underline { border-bottom-color: var(--terminal-cursor, currentColor); }
    [data-workbench-terminal-screen] .xterm-rows.xterm-focus .xterm-cursor.xterm-cursor-block.xterm-cursor-blink { animation: workbench-terminal-cursor-blink 1s step-end infinite; }
    @keyframes workbench-terminal-cursor-blink { 0%, 49% { background-color: var(--terminal-cursor, currentColor); color: var(--terminal-cursor-accent, var(--dsw-alias-bg-base, #111)); } 50%, 100% { background-color: var(--terminal-cursor-cell-background, var(--dsw-alias-bg-base, #111)); color: var(--terminal-cursor-cell-foreground, currentColor); } }
  `
  document.head.appendChild(style)
}

/** DSH-owned capabilities exposed as Workbench Area editors. */
export const WORKBENCH_OFFICIAL_AREA_EDITOR_IDS = Object.freeze({
  files: 'workbench.workspace-files',
  terminal: 'workbench.terminal',
  browser: 'workbench.browser',
  documentPreview: 'workbench.document-preview',
  start: 'workbench.conversation.start',
  conversation: 'workbench.conversation',
  trajectory: 'workbench.agent-trajectory',
  changesReview: 'workbench.changes-review',
  plan: 'workbench.plan',
  scheduleTask: 'workbench.schedule-task',
  guide: 'workbench.guide',
  subagentChat: 'workbench.subagent-chat',
})

/** DSH tab implementation identities live in the centralized compatibility table. */
const NATIVE_TAB_ENTRY_KEYS = Object.freeze({
  files: workbenchNativeSidebarForKind('files')!.entryKey,
  terminal: workbenchNativeSidebarForKind('terminal')!.entryKey,
  browser: workbenchNativeSidebarForKind('browser')!.entryKey,
  documentPreview: workbenchNativeSidebarForKind('documentpreview')!.entryKey,
  changesReview: workbenchNativeSidebarForKind('changes-review')!.entryKey,
  plan: workbenchNativeSidebarForKind('plan')!.entryKey,
  scheduleTask: workbenchNativeSidebarForKind('schedule-task')!.entryKey,
  guide: workbenchNativeSidebarForKind('guide')!.entryKey,
  subagentChat: workbenchNativeSidebarForKind('subagent-chat')!.entryKey,
})

type AreaProps = WorkbenchEditorOwnerProps

function sessionIdOf(owner: AreaProps): SessionId | undefined {
  return owner.sessionId as SessionId | undefined
}

function MissingSession(): ReactNode {
  return <section data-workbench-official-area-state="missing-session" style={{ padding: 20 }}>
    <strong>此官方内页需要绑定 DSH Session</strong>
    <p>请在此内页菜单中选择来源对话，然后重新打开此内页。</p>
  </section>
}

function NativeResourceUnavailable({ label }: { readonly label: string }): ReactNode {
  return <section data-workbench-official-area-state="native-resource-unavailable" style={{ padding: 20 }}>
    <strong>{label}</strong>
    <p>DSH 原生内页需要对应资源后才能显示，请从原生对话中的入口打开。</p>
  </section>
}

function useSessionSnapshot(ctx: Context) {
  const list = ctx.sessions.list
  return useSyncExternalStore(list.subscribe.bind(list), list.getSnapshot.bind(list), list.getSnapshot.bind(list))
}

const FALLBACK_THEME = {
  preference: 'system',
  fontSizes: { text: 14, code: 11, terminal: 13 },
  fontFamilies: { text: '', code: '', terminal: '' },
  fontSize: 14,
  active: { id: 'system', colorScheme: 'dark', tokens: {} },
  themes: [],
  revision: 0,
} as ThemeSnapshot

function useThemeSnapshot(ctx: Context): ThemeSnapshot {
  const theme = (ctx as unknown as { theme?: { getTheme(): ThemeSnapshot } }).theme
  return useSyncExternalStore(
    listener => theme === undefined || typeof ctx.on !== 'function' ? () => {} : ctx.on('theme/change', listener),
    () => theme?.getTheme() ?? FALLBACK_THEME,
    () => theme?.getTheme() ?? FALLBACK_THEME,
  )
}

type FileLevel =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly entries: readonly WorkspaceDirectoryEntry[]; readonly truncated: boolean }
  | { readonly status: 'failed'; readonly code?: string; readonly message: string }

interface PersistedFilesState {
  readonly expanded?: readonly string[]
  readonly scrollTop?: number
  readonly levels?: Readonly<Record<string, {
    readonly status: 'ready'
    readonly entries: readonly WorkspaceDirectoryEntry[]
    readonly truncated: boolean
  }>>
}

function persistedFilesState(value: unknown): PersistedFilesState {
  if (typeof value !== 'object' || value === null) return {}
  const candidate = value as PersistedFilesState
  return {
    ...(Array.isArray(candidate.expanded) ? { expanded: candidate.expanded.filter(item => typeof item === 'string') } : {}),
    ...(typeof candidate.scrollTop === 'number' && Number.isFinite(candidate.scrollTop) ? { scrollTop: candidate.scrollTop } : {}),
    ...(typeof candidate.levels === 'object' && candidate.levels !== null ? { levels: candidate.levels } : {}),
  }
}

function sortEntries(entries: readonly WorkspaceDirectoryEntry[]): WorkspaceDirectoryEntry[] {
  return [...entries].sort((left, right) => {
    const group = Number(right.type === 'directory') - Number(left.type === 'directory')
    return group || left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: 'base' })
  })
}

/**
 * Area adapter for DSH's workspaceFiles Remote.  The Host remains the only
 * filesystem authority; this component only renders the bounded list result.
 */
function WorkspaceFilesEditor({ owner, ctx }: { owner: AreaProps; ctx: Context }): ReactNode {
  const sessionId = sessionIdOf(owner)
  const sessions = useSessionSnapshot(ctx)
  const cwd = sessionId === undefined ? undefined : sessions.byId[sessionId]?.cwd
  const stored = useMemo(() => persistedFilesState(owner.state), [owner.instanceId])
  const [levels, setLevels] = useState<Record<string, FileLevel>>(() => stored.levels ?? {})
  const [expanded, setExpanded] = useState<readonly string[]>(() => stored.expanded ?? [])
  const [error, setError] = useState<string>()
  const [scrollTop, setScrollTop] = useState(stored.scrollTop ?? 0)
  const scrollTopRef = useRef(stored.scrollTop ?? 0)
  const scrollPersistTimerRef = useRef<ReturnType<typeof globalThis.setTimeout>>()
  const levelsRef = useRef(levels)
  const expandedRef = useRef(expanded)
  // A scroll settle, directory refresh, or React replay can present the same
  // serializable snapshot more than once. Avoid turning an identical editor
  // state into another layout write; token/output updates never reach this
  // path in the first place.
  const persistedStateFingerprintRef = useRef<string>()
  const scrollRef = useRef<HTMLDivElement>(null)
  const controller = useMemo(() => new AbortController(), [owner.instanceId])
  const [nativePreview, setNativePreview] = useState<ReturnType<typeof createWorkbenchNativeAreaSlotRenderer>>()
  const [preview, setPreview] = useState<{ readonly address: string; readonly claim: SidebarRightTabClaim; readonly implementationId: string; readonly info: SidebarRightTabInfo }>()
  const previewLifetime = useRef<AbortController>()
  const rootStatus = cwd === undefined ? undefined : levels[cwd]?.status
  const closePreview = useCallback(() => {
    previewLifetime.current?.abort()
    previewLifetime.current = undefined
    setPreview(undefined)
  }, [])
  useEffect(() => () => { controller.abort() }, [controller])
  useEffect(() => {
    if (sessionId === undefined) return
    if (owner.areaId === undefined || owner.areaClaim === undefined) {
      setError('当前文件内页的对话绑定已失效，请重新绑定对话。')
      return
    }
    let live = true
    let renderer: ReturnType<typeof createWorkbenchNativeAreaSlotRenderer> | undefined
    let lease: ReturnType<typeof retainWorkbenchArea>
    try {
      lease = retainWorkbenchArea(ctx.sessions, { sessionId, areaId: owner.areaId, claim: owner.areaClaim })
    } catch {
      setError('当前文件内页的对话绑定已失效，请重新绑定对话。')
      return
    }
    void lease.ready.then(reference => {
      if (!live) return
      renderer = createWorkbenchNativeAreaSlotRenderer(ctx, sessionId, {}, { sessionReference: reference })
      setNativePreview(renderer)
    }).catch(() => {
      if (live) setError('当前文件内页无法连接 DSH 文件预览，请重新绑定对话。')
    })
    return () => { live = false; closePreview(); renderer?.dispose(); lease.release() }
  }, [ctx, sessionId, owner.areaId, owner.areaClaim, closePreview])

  const persist = useCallback((nextLevels: Record<string, FileLevel>, nextExpanded: readonly string[], nextScrollTop = scrollTopRef.current): void => {
    const serializableLevels = Object.fromEntries(Object.entries(nextLevels).flatMap(([path, level]) =>
      level.status === 'ready' ? [[path, level]] : []))
    const nextState = { expanded: [...nextExpanded], scrollTop: nextScrollTop, levels: serializableLevels }
    const fingerprint = JSON.stringify(nextState)
    if (persistedStateFingerprintRef.current === fingerprint) return
    persistedStateFingerprintRef.current = fingerprint
    owner.setState(nextState as unknown as JsonValue)
  }, [owner])

  const persistScrollAfterIdle = useCallback((nextScrollTop: number): void => {
    scrollTopRef.current = nextScrollTop
    if (scrollPersistTimerRef.current !== undefined) clearTimeout(scrollPersistTimerRef.current)
    scrollPersistTimerRef.current = globalThis.setTimeout(() => {
      scrollPersistTimerRef.current = undefined
      persist(levelsRef.current, expandedRef.current, scrollTopRef.current)
    }, 180)
  }, [persist])

  useEffect(() => () => {
    if (scrollPersistTimerRef.current !== undefined) clearTimeout(scrollPersistTimerRef.current)
    if (scrollTopRef.current !== scrollTop) persist(levelsRef.current, expandedRef.current, scrollTopRef.current)
  }, [persist])

  const load = useCallback(async (path: string) => {
    if (sessionId === undefined || controller.signal.aborted) return
    setLevels(previous => ({ ...previous, [path]: { status: 'loading' } }))
    try {
      const result = await ctx.remote.workspaceFiles.list(sessionId, path, controller.signal)
      if (controller.signal.aborted) return
      if (result.ok) {
        const next = { ...levelsRef.current, [path]: { status: 'ready' as const, entries: sortEntries(result.value.entries), truncated: result.value.truncated } }
        levelsRef.current = next
        setLevels(next)
        persist(next, expandedRef.current)
        setError(undefined)
      } else {
        const next = { ...levelsRef.current, [path]: { status: 'failed' as const, code: result.error.code, message: fileFailureMessage(result.error) } }
        levelsRef.current = next
        setLevels(next)
      }
    } catch (reason) {
      if (!controller.signal.aborted) setError('DSH 未能读取此目录，请检查工作区连接后重试。')
    }
  // The DSH remote face is stable for the lifetime of a ClientContext. Do not
  // include its getter result in this dependency list: alpha2 may project a
  // fresh service wrapper during every render, which would otherwise abort
  // the current request and immediately start the same directory again.
  }, [controller, sessionId])

  useEffect(() => {
    if (cwd === undefined) return
    if (expandedRef.current.length === 0) {
      expandedRef.current = [cwd]
      setExpanded([cwd])
      persist(levelsRef.current, [cwd])
    }
    if (rootStatus === undefined) void load(cwd)
  }, [cwd, load, rootStatus])

  useEffect(() => {
    if (scrollRef.current !== null) scrollRef.current.scrollTop = scrollTop
  }, [scrollTop])

  if (sessionId === undefined) return <MissingSession />
  if (cwd === undefined) return <section data-workbench-official-area-state="workspace-missing" style={{ padding: 20 }}>当前 Session 没有可用工作区。</section>

  const toggle = (path: string): void => {
    const previous = expandedRef.current
    if (previous.includes(path)) {
      const next = previous.filter(item => item !== path)
      expandedRef.current = next
      setExpanded(next)
      persist(levelsRef.current, next)
      return
    }
    if (levelsRef.current[path] === undefined) void load(path)
    const next = [...previous, path]
    expandedRef.current = next
    setExpanded(next)
    persist(levelsRef.current, next)
  }
  const openAddress = (address: string): void => {
    if (sessionId === undefined) return
    if (nativePreview === undefined) {
      setError('当前 Area 没有可用的 DSH 文件预览服务。')
      return
    }
    try {
      const parsed = parseFileAddress(address)
      if (parsed?.scope !== 'session' || parsed.sessionId !== sessionId) {
        setError('此文件不属于当前 Area 绑定的 Session。')
        return
      }
      const claim = ctx.sidebarRightTabs.claim(address)
      const definition = ctx.sidebarRightTabs.get(claim.kind)
      if (definition === undefined) {
        setError('DSH 没有为此文件注册可用的预览器。')
        return
      }
      closePreview()
      const lifetime = new AbortController()
      previewLifetime.current = lifetime
      ctx.resources.pin(address, lifetime.signal)
      setError(undefined)
      const signal = lifetime.signal
      setPreview({ address, claim, implementationId: definition.id, info: {
        sidebar: { expanded: true, fullscreen: false },
        panel: { id: (owner.areaId ?? owner.instanceId) as never, isFloating: false },
        tab: {
          id: `workbench-file-${owner.instanceId}` as never,
          kind: claim.kind,
          contentId: claim.contentId,
          title: claim.title,
          visible: true,
          signal,
          navigation: { address, params: undefined, revision: 0 },
          actions: { close: closePreview, openResource: (next: string) => openAddress(next), openTab: () => { throw new Error('当前 Area 仅支持文件资源预览。') } },
        },
      } as SidebarRightTabInfo })
    } catch {
      setError('DSH 无法打开此文件预览，请检查工作区连接后重试。')
    }
  }
  const openResource = (path: string): void => {
    if (sessionId === undefined || cwd === undefined) return
    openAddress(fileAddressFor(sessionId, cwd, path))
  }
  const renderLevel = (path: string, depth: number): ReactNode => {
    const level = levels[path]
    if (level === undefined || level.status === 'loading') return <div style={{ paddingLeft: depth * 18 }}><WorkbenchPageLoading label="文件目录" icon="folder" compact /></div>
    if (level.status === 'failed') return <div role="alert" style={{ paddingLeft: depth * 18 + 12, color: 'var(--dsw-alias-danger, #b42318)' }}>{level.message}</div>
    if (level.entries.length === 0) return <div style={{ paddingLeft: depth * 18 + 12, opacity: .65 }}>空目录</div>
    const rows = level.entries.map(entry => {
      const child = `${path.replace(/[/\\]+$/u, '')}/${entry.name}`
      const isOpen = expanded.includes(child)
      return <div key={child}>
        <button className={css.fileTreeRow} type="button" aria-expanded={entry.type === 'directory' ? isOpen : undefined} onClick={() => { if (entry.type === 'directory') toggle(child); else if (entry.type === 'file') openResource(child) }} disabled={entry.type === 'other' || (entry.type === 'file' && nativePreview === undefined)} style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%', minWidth: 0, padding: '5px 10px', paddingLeft: depth * 18 + 10, border: 0, borderRadius: 10, background: 'transparent', color: entry.type === 'other' ? 'var(--dsw-alias-label-tertiary, currentColor)' : 'inherit', opacity: entry.type === 'other' ? .72 : 1, textAlign: 'left', cursor: entry.type === 'other' ? 'default' : 'pointer', font: 'inherit' }}>
          <span aria-hidden="true" style={{ width: 12, flex: 'none', color: 'var(--dsw-alias-label-tertiary, currentColor)' }}>{entry.type === 'directory' ? `${isOpen ? '▾' : '▸'} ` : entry.type === 'other' ? '· ' : '  '}</span>
          {entry.type === 'directory' ? <span aria-hidden="true" style={{ color: 'var(--dsw-alias-label-tertiary, currentColor)', display: 'inline-flex' }}>{isOpen ? <IconFolderOpenMedium /> : <IconFolderCloseMedium />}</span> : entry.type === 'file' ? <FileTypeIcon kind={classifyFileType(entry.name)} size={16} /> : null}
          <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.name}</span>
        </button>
        {entry.type === 'directory' && isOpen ? renderLevel(child, depth + 1) : null}
      </div>
    })
    return <>{rows}{level.truncated ? <div style={{ paddingLeft: depth * 18 + 12, opacity: .65 }}>列表已截断，点击刷新查看最新内容。</div> : null}</>
  }
  const titleParts = pathPartsOf(cwd)
  return <section className={css.officialArea} data-workbench-official-area="workspace-files" style={{ position: 'relative', display: 'flex', minHeight: 0, height: '100%', flexDirection: 'column' }}>
    <header className={css.areaToolbar} style={{ display: 'flex', alignItems: 'center', gap: 4, height: 38, boxSizing: 'border-box', padding: '0 6px 0 16px', borderBottom: '.5px solid var(--dsw-alias-border-l3, color-mix(in srgb, currentColor 16%, transparent))' }}>
      <strong aria-label="工作区路径" title={cwd} style={{ display: 'flex', minWidth: 0, flex: 1, marginRight: 12, overflow: 'hidden', whiteSpace: 'nowrap', fontSize: 12 }}><span style={{ overflow: 'hidden', textOverflow: 'ellipsis', color: 'var(--dsw-alias-label-tertiary, currentColor)' }}>{titleParts.directory}</span><span style={{ flex: 'none', color: 'var(--dsw-alias-label-primary, currentColor)' }}>{titleParts.name}</span></strong>
      <button className={css.toolbarButton} type="button" aria-label="刷新工作区文件" title="刷新" onClick={() => { levelsRef.current = {}; setLevels({}); persist({}, expandedRef.current); void load(cwd) }} style={{ width: 28, height: 28, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flex: 'none', border: 0, borderRadius: 28, background: 'transparent', color: 'var(--dsw-alias-label-secondary, currentColor)', cursor: 'pointer' }}><IconRefreshOutlineMedium /></button>
    </header>
    {nativePreview === undefined && error === undefined && levels[cwd]?.status === 'ready' ? <WorkbenchPageLoading label="文件预览" icon="file-preview" compact /> : null}
    <div ref={scrollRef} onScroll={event => { const next = event.currentTarget.scrollTop; setScrollTop(next); persistScrollAfterIdle(next) }} style={{ minHeight: 0, flex: 1, overflow: 'auto', padding: '8px 0 8px 8px', fontSize: 'var(--dsh-content-font-size-secondary, 13px)', lineHeight: 1.5 }}>{levels[cwd] === undefined || levels[cwd]?.status === 'loading' ? <WorkbenchPageLoading label="项目文件" icon="folder" /> : renderLevel(cwd, 0)}</div>
    {error === undefined ? null : <p role="alert" style={{ margin: 0, padding: '10px 12px', color: 'var(--dsw-alias-state-error-primary, #b42318)', background: 'color-mix(in srgb, var(--dsw-alias-state-error-primary, #b42318) 8%, transparent)' }}>{error}</p>}
    {preview !== undefined && nativePreview !== undefined ? <aside className={css.resourcePreview} data-workbench-resource-preview="" aria-label={preview.info.tab.title} style={{ position: 'absolute', inset: 0, zIndex: 2, display: 'flex', minHeight: 0, flexDirection: 'column', background: 'var(--dsw-alias-bg-base, Canvas)' }}>
      <header className={css.areaToolbar} style={{ display: 'flex', alignItems: 'center', minHeight: 38, padding: '0 12px', borderBottom: '.5px solid var(--dsw-alias-border-l3, color-mix(in srgb, currentColor 16%, transparent))' }}>
        <strong style={{ minWidth: 0, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{preview.info.tab.title}</strong>
        <button className={css.toolbarButton} type="button" onClick={closePreview} aria-label="关闭文件预览" title="关闭文件预览">×</button>
      </header>
      <div style={{ minHeight: 0, flex: 1 }}>{nativePreview.render('sidebar.right.pane.tab', {}, { entryKey: preview.implementationId, hookContext: () => preview.info })}</div>
    </aside> : null}
  </section>
}

function fileFailureMessage(failure: RemoteFailure): string {
  switch (failure.code) {
    case 'workspace-file/not-found': return '找不到此目录。'
    case 'workspace-file/outside-workspace': return '此路径位于工作区之外。'
    case 'workspace-file/not-directory': return '此路径不是目录。'
    default: return 'DSH 未能读取此目录，请稍后重试。'
  }
}

function useNativeTerminal(ctx: Context, sessionId: SessionId, key: string, terminalId?: WebTerminalId, shellPath?: string): TerminalView {
  return useMemo(() => ctx.webTerminals.view(sessionId, key, `workbench://terminal/${key}`, terminalId, shellPath), [ctx.webTerminals, key, sessionId, shellPath, terminalId])
}

function terminalErrorMessage(state: TerminalViewState): string | undefined {
  if (state.phase === 'disconnected') return undefined
  if (state.issue === 'missingTerminal') return '此终端已不存在，请新建终端。'
  if (state.issue === 'inputFull') return '终端输入暂时繁忙，请稍后重试。'
  if (state.issue === 'attachmentEnded') return '终端连接已结束，请重新连接。'
  if (state.issue === 'invalidOutput') return '终端输出无效，无法继续显示。'
  if (state.issue === 'terminalLimit') return '已达到终端数量上限。'
  if (state.phase === 'failed' || state.info?.state === 'failed') return '终端暂时不可用，请重试。'
  return undefined
}

/** DSH's native xterm renderer over the Workbench-owned Area frame. */
function NativeTerminalScreen({ model, state, theme, visible = true, focused = false, label = '终端' }: {
  readonly model: TerminalView
  readonly state: TerminalViewState
  readonly theme: ThemeSnapshot
  readonly visible?: boolean
  readonly focused?: boolean
  readonly label?: string
}): ReactNode {
  const element = useRef<HTMLDivElement>(null)
  const terminal = useRef<Terminal>()
  const fit = useRef<FitAddon>()
  const colors = useRef<DshTerminalTheme>()
  const cursor = useRef<{ dispose(): void }>()
  const lastRevision = useRef(0)
  const current = useRef({ state, visible, focused })
  current.current = { state, visible, focused }

  useLayoutEffect(() => {
    const node = element.current
    if (node === null) return
    ensureXtermCss()
    const xterm = new Terminal({
      minimumContrastRatio: 4.5,
      cursorBlink: true,
      fontSize: 13,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      scrollback: current.current.state.environment?.scrollback ?? 0,
    })
    const addon = new FitAddon()
    xterm.loadAddon(addon)
    xterm.open(node)
    const surface = node.closest<HTMLElement>('[data-workbench-official-area="terminal"]') ?? node
    const style = getComputedStyle(surface)
    const palette = new DshTerminalTheme(xterm)
    palette.update(style.backgroundColor || '#111', style.color || '#fff')
    colors.current = palette
    cursor.current = observeDshTerminalCursor(xterm, node, () => palette.cursor)
    xterm.textarea?.setAttribute('aria-label', label)
    terminal.current = xterm
    fit.current = addon
    lastRevision.current = 0
    const input = xterm.onData(data => {
      try { model.write(data) } catch { /* native state publishes the failure */ }
    })
    const measure = (): void => {
      const stateNow = current.current.state
      if (!current.current.visible || !stateNow.writable || node.clientWidth === 0 || node.clientHeight === 0) return
      const dimensions = addon.proposeDimensions()
      const environment = stateNow.environment
      if (dimensions === undefined || environment === undefined) return
      const cols = Math.min(dimensions.cols, environment.maxCols)
      const rows = Math.min(dimensions.rows, environment.maxRows)
      if (cols < 2 || rows < 1) return
      xterm.resize(cols, rows)
      try { model.resize(cols, rows) } catch { /* native state publishes the failure */ }
    }
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measure)
    observer?.observe(node)
    measure()
    return () => {
      observer?.disconnect()
      input.dispose()
      cursor.current?.dispose()
      colors.current?.dispose()
      xterm.dispose()
      terminal.current = undefined
      fit.current = undefined
      cursor.current = undefined
      colors.current = undefined
    }
  }, [model])

  useLayoutEffect(() => {
    const node = element.current
    const palette = colors.current
    if (node === null || palette === undefined) return
    const surface = node.closest<HTMLElement>('[data-workbench-official-area="terminal"]') ?? node
    const style = getComputedStyle(surface)
    palette.update(style.backgroundColor || '#111', style.color || '#fff')
  }, [model, theme])

  useLayoutEffect(() => {
    const xterm = terminal.current
    const render = state.render
    if (xterm === undefined || render === undefined || render.revision <= lastRevision.current) return
    lastRevision.current = render.revision
    if (render.frame.type === 'snapshot') {
      xterm.reset()
      xterm.resize(render.frame.info.cols, render.frame.info.rows)
    }
    xterm.write(render.frame.type === 'snapshot' ? render.frame.screen : render.frame.data, () => model.acknowledge(render.revision))
  }, [model, state.render])

  useLayoutEffect(() => {
    const xterm = terminal.current
    if (xterm === undefined) return
    xterm.options.disableStdin = !state.writable
    if (visible && state.writable && element.current !== null && element.current.clientWidth > 0 && element.current.clientHeight > 0) {
      const dimensions = fit.current?.proposeDimensions()
      const environment = state.environment
      if (dimensions !== undefined && environment !== undefined && dimensions.cols >= 2 && dimensions.rows >= 1) {
        const cols = Math.min(dimensions.cols, environment.maxCols)
        const rows = Math.min(dimensions.rows, environment.maxRows)
        xterm.resize(cols, rows)
        try { model.resize(cols, rows) } catch { /* native state publishes the failure */ }
      }
    } else if (state.info !== undefined && !state.writable) xterm.resize(state.info.cols, state.info.rows)
  }, [model, state.environment, state.info?.cols, state.info?.rows, state.writable, visible])

  useEffect(() => {
    terminal.current?.textarea?.setAttribute('aria-label', label)
    if (focused && state.writable) terminal.current?.focus()
  }, [focused, label, state.writable])

  return <div ref={element} data-workbench-terminal-screen role="textbox" aria-label={label} tabIndex={0} style={{ minWidth: 0, minHeight: 0, flex: 1, width: '100%', overflow: 'hidden', outline: 'none', cursor: 'text', color: 'var(--dsw-alias-label-primary, #fff)', background: 'var(--dsw-alias-bg-base, #111)', padding: 8 }} />
}

/** Area adapter over DSH's native ClientTerminals view and lifecycle. */
function TerminalEditor({ owner, ctx }: { owner: AreaProps; ctx: Context }): ReactNode {
  const sessionId = sessionIdOf(owner)
  const [missing, setMissing] = useState<string>()
  const [renaming, setRenaming] = useState(false)
  const [titleDraft, setTitleDraft] = useState('')
  const [shellPath, setShellPath] = useState<string>()
  const [terminalId, setTerminalId] = useState<WebTerminalId>()
  const [shellMenuOpen, setShellMenuOpen] = useState(false)
  const [shellAttempt, setShellAttempt] = useState(0)
  const [shellChoices, setShellChoices] = useState<{ phase: 'closed' | 'loading' | 'ready' | 'failed'; value?: TerminalLaunchShells; message?: string }>({ phase: 'closed' })
  const [recoveryOpen, setRecoveryOpen] = useState(false)
  const [recoveryAttempt, setRecoveryAttempt] = useState(0)
  const [recovery, setRecovery] = useState<{ phase: 'closed' | 'loading' | 'ready' | 'failed'; value?: readonly WebTerminalInfo[]; message?: string }>({ phase: 'closed' })
  const key = owner.runtimeIdentity ?? owner.instanceId
  if (sessionId === undefined) return <MissingSession />
  if (ctx.webTerminals === undefined) return <section data-workbench-official-area-state="terminal-unavailable" style={{ padding: 20 }}>当前 DSH 没有提供终端服务。</section>
  const theme = useThemeSnapshot(ctx)
  const model = useNativeTerminal(ctx, sessionId, key, terminalId, shellPath)
  const state = useSyncExternalStore(model.state.subscribe, model.state.getSnapshot, model.state.getSnapshot)
  const closeFailureStore = ctx.webTerminals.closeFailures
  const closeFailures = useSyncExternalStore(closeFailureStore.subscribe, closeFailureStore.getSnapshot, closeFailureStore.getSnapshot)
  useEffect(() => model.mount(), [model])
  useEffect(() => {
    if (!shellMenuOpen) return
    const lifetime = new AbortController()
    setShellChoices({ phase: 'loading' })
    ctx.webTerminals.launchShells(sessionId, lifetime.signal).then(value => {
      if (!lifetime.signal.aborted) setShellChoices({ phase: 'ready', value })
    }, reason => {
      if (!lifetime.signal.aborted) setShellChoices({ phase: 'failed', message: reason instanceof Error ? reason.message : String(reason) })
    })
    return () => lifetime.abort()
  }, [ctx.webTerminals, shellAttempt, shellMenuOpen, sessionId])
  useEffect(() => {
    if (!recoveryOpen) return
    setRecovery({ phase: 'loading' })
    ctx.webTerminals.recover(sessionId).then(value => setRecovery({ phase: 'ready', value }), reason => setRecovery({ phase: 'failed', message: reason instanceof Error ? reason.message : String(reason) }))
  }, [ctx.webTerminals, recoveryAttempt, recoveryOpen, sessionId])
  const rename = async (): Promise<void> => {
    const value = titleDraft.trim()
    if (value === '') return
    try { await model.rename(value); setRenaming(false) } catch { setMissing('终端重命名失败，请稍后重试。') }
  }
  const title = state.info?.title ?? state.title ?? '终端'
  const error = terminalErrorMessage(state)
  const ended = state.info?.state === 'exited' || state.phase === 'closed'
  const retryable = !ended && (state.phase === 'failed' || state.phase === 'disconnected')
  const readOnly = state.phase === 'connected' && state.info?.state === 'running' && !state.writable
  const phaseLabel = state.phase === 'idle' || state.phase === 'loading' ? '正在加载…'
    : state.phase === 'creating' || state.phase === 'connecting' ? '正在连接…'
      : state.phase === 'disconnected' ? '连接已断开'
        : state.info?.state === 'exited' ? `已退出（${state.info.exitCode ?? '—'}）`
          : state.info?.state === 'failed' ? '终端不可用'
            : state.phase === 'closed' ? '已关闭' : state.phase === 'connected' ? '已连接' : ''
  const recover = (): void => {
    try {
      if (state.info === undefined || state.phase === 'failed') void model.refresh().catch(() => setMissing('终端连接失败，请重试。'))
      else model.connect()
    } catch { setMissing('终端连接失败，请重试。') }
  }
  const replaceTerminal = (nextShell?: string, nextTerminalId?: WebTerminalId): void => {
    ctx.webTerminals.close(sessionId, key, `workbench://terminal/${key}`, state.info?.id)
    setShellPath(nextShell)
    setTerminalId(nextTerminalId)
    setMissing(undefined)
  }
  const shellItems = shellChoices.phase === 'ready'
    ? (shellChoices.value?.shells ?? []).map(shell => ({ id: shell.path, label: shell.name }))
    : shellChoices.phase === 'loading'
      ? [{ id: 'loading', label: '正在读取 Shell…', disabled: true }]
      : shellChoices.phase === 'failed'
        ? [{ id: 'error', label: '读取 Shell 失败，请重试。', disabled: true }, { id: 'retry', label: '重试' }]
        : [{ id: 'empty', label: '选择 Shell', disabled: true }]
  const recoveryItems = recovery.phase === 'ready'
    ? (recovery.value ?? []).map(item => ({ id: item.id, label: `${item.title} · ${item.shell.name}` }))
    : recovery.phase === 'loading'
      ? [{ id: 'loading', label: '正在读取可恢复终端…', disabled: true }]
      : recovery.phase === 'failed'
        ? [{ id: 'error', label: '读取可恢复终端失败，请重试。', disabled: true }, { id: 'retry', label: '重试' }]
        : [{ id: 'empty', label: '恢复已退出的终端', disabled: true }]
  const newTerminal = <Button variant="primary" size={ended ? 'md' : 'sm'} icon={<IconPlusOutlineMedium />} onClick={() => replaceTerminal(shellChoices.value?.selectedShell)}>{ended ? '新建终端' : '重建终端'}</Button>
  return <section className={css.officialArea} data-workbench-official-area="terminal" style={{ display: 'flex', minHeight: 0, height: '100%', flexDirection: 'column', background: 'var(--dsw-alias-bg-base, #111)', color: 'var(--dsw-alias-label-primary, #fff)', fontSize: 13 }}>
    <header className={css.areaToolbar} style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 38, padding: '0 10px', borderBottom: '1px solid var(--dsw-alias-border-l4, color-mix(in srgb, currentColor 20%, transparent))' }}>
      {renaming ? <form className={css.toolbarForm} onSubmit={event => { event.preventDefault(); void rename() }} style={{ display: 'flex', gap: 6, minWidth: 0, flex: 1 }}><input autoFocus aria-label="终端名称" maxLength={120} value={titleDraft} onChange={event => setTitleDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Escape') { setRenaming(false); event.preventDefault() } }} style={{ minWidth: 48, width: 120, maxWidth: '100%', color: 'inherit', font: 'inherit', background: 'var(--dsw-alias-bg-l1, #222)', border: '.5px solid var(--dsw-alias-border-l3, #555)', borderRadius: 4, outline: 'none', padding: '2px 4px' }} /><Button variant="outline" size="sm" type="submit">保存</Button></form> : <button className={css.toolbarTitle} type="button" onDoubleClick={() => { setTitleDraft(title); setRenaming(true) }} title="双击重命名终端" style={{ border: 0, padding: 0, background: 'transparent', color: 'inherit', cursor: 'text', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{title}</button>}
      <span role="status" style={{ opacity: .62, fontSize: 12, whiteSpace: 'nowrap' }}>{phaseLabel}</span>
      <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 4 }}>
        <Menu open={shellMenuOpen} portal autoFocus align="end" items={shellItems} selectedId={shellChoices.value?.selectedShell} onClose={() => setShellMenuOpen(false)} onSelect={path => { if (path === 'retry') { setShellAttempt(value => value + 1); return } ctx.webTerminals.selectShell(path); setShellMenuOpen(false); replaceTerminal(path) }} anchor={<Button variant="ghost" size="sm" aria-label="选择 Shell" aria-haspopup="menu" aria-expanded={shellMenuOpen} onClick={() => { setShellChoices({ phase: 'loading' }); setShellMenuOpen(value => !value) }} icon={<IconChevronDownOutlineMedium />}>Shell</Button>} />
        <Menu open={recoveryOpen} portal autoFocus align="end" items={recoveryItems} onClose={() => setRecoveryOpen(false)} onSelect={id => { if (id === 'retry') { setRecoveryAttempt(value => value + 1); return } setRecoveryOpen(false); replaceTerminal(undefined, id as WebTerminalId) }} anchor={<Button variant="ghost" size="sm" aria-label="恢复终端" aria-haspopup="menu" aria-expanded={recoveryOpen} onClick={() => setRecoveryOpen(value => !value)}>恢复</Button>} />
      </span>
      {state.writable ? <span aria-label="终端可输入" title="终端可输入" style={{ opacity: .55 }}>●</span> : null}
    </header>
    {retryable || readOnly || ended ? <div role="status" style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 34, padding: '5px 12px', background: 'var(--dsw-alias-bg-l2, #1c1f24)', flexWrap: 'wrap' }}>
      {readOnly ? <><span>此页面当前只读。</span><Button variant="outline" size="sm" onClick={() => model.connect()}>接管输入</Button></> : null}
      {retryable ? <><span>{state.phase === 'disconnected' ? '连接已断开。' : '终端暂时不可用。'}</span><Button variant="outline" size="sm" onClick={recover}>{state.phase === 'disconnected' ? '重新连接' : '重试'}</Button></> : null}
      {ended ? <><span>终端进程已结束。</span>{newTerminal}</> : null}
    </div> : null}
    {closeFailures.length === 0 ? null : <div role="alert" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: 'var(--dsw-alias-bg-l2, #1c1f24)', overflowWrap: 'anywhere' }}><span>终端「{closeFailures[0]!.title}」未能结束，请重试清理。</span><Button variant="outline" size="sm" onClick={() => ctx.webTerminals.retryClose(closeFailures[0]!.id)}>重试清理</Button></div>}
    {state.info === undefined
      ? state.issue === 'missingTerminal'
        ? <div data-workbench-official-area-state="terminal-missing" style={{ display: 'flex', flex: 1, minHeight: 0, flexDirection: 'column', justifyContent: 'center', alignItems: 'center', gap: 16, padding: 24, textAlign: 'center' }}><span aria-hidden="true" style={{ fontSize: 36 }}>›_</span><p role="alert" style={{ maxWidth: '28ch', lineHeight: 1.6, margin: 0 }}>此终端已不存在，请新建终端。</p>{newTerminal}</div>
        : state.phase === 'failed' ? <div data-workbench-official-area-state="terminal-failed" role="alert" style={{ display: 'flex', flex: 1, minHeight: 0, alignItems: 'center', justifyContent: 'center', padding: 24, color: 'var(--dsw-alias-label-tertiary, currentColor)' }}>终端暂时不可用。</div> : <WorkbenchPageLoading label="终端" icon="terminal" />
      : <NativeTerminalScreen
        model={model}
        state={state}
        theme={theme}
        visible={owner.lifecycle?.visibility === 'visible'}
        focused={owner.lifecycle?.focused === true}
      />}
    {error === undefined && missing === undefined ? null : <p role="alert" style={{ overflowWrap: 'anywhere', color: 'var(--dsw-alias-label-primary, #fff)', background: 'var(--dsw-alias-bg-l2, #1c1f24)', margin: 0, padding: '10px 12px' }}>{missing ?? error}</p>}
  </section>
}

function parseBrowserAddress(value: string): URL | undefined {
  try {
    const input = value.trim()
    if (input === '' || input.length > 16384) return undefined
    const url = new URL(/^[A-Za-z][A-Za-z\d+.-]*:(?!\d+(?:[/?#]|$))/u.test(input) ? input : `https://${input}`)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined
    if (url.username !== '' || url.password !== '') return undefined
    if (typeof window !== 'undefined' && url.origin === window.location.origin) return undefined
    return url
  } catch { return undefined }
}

function restoreBrowserState(value: unknown) {
  const saved = typeof value === 'object' && value !== null ? value as { url?: unknown; history?: unknown; index?: unknown } : {}
  const entries: unknown[] = Array.isArray(saved.history) && saved.history.length > 0
    ? saved.history : typeof saved.url === 'string' && saved.url !== '' ? [saved.url] : []
  const parsed = entries.map(entry => typeof entry === 'string' ? parseBrowserAddress(entry)?.href : undefined)
  const invalid = parsed.some(entry => entry === undefined)
  const history = invalid ? [] : parsed.filter((entry): entry is string => entry !== undefined)
  const index = typeof saved.index === 'number' && Number.isInteger(saved.index)
    ? Math.max(0, Math.min(saved.index, Math.max(0, history.length - 1))) : Math.max(0, history.length - 1)
  return { history, index, invalid }
}

/** Web-only preview adapter. An iframe load is not proof that a site rendered. */
function BrowserPreview({ url, title, sandboxed, onLoad, onError }: { url: string; title: string; sandboxed: boolean; onLoad: () => void; onError: () => void }) {
  const [ready, setReady] = useState(false)
  return <WorkbenchPageTransition loading={!ready} label="网页" icon="browser"><iframe title={title} src={url} sandbox={sandboxed ? 'allow-scripts allow-forms allow-same-origin allow-popups allow-popups-to-escape-sandbox' : undefined} referrerPolicy="no-referrer" onLoad={() => { setReady(true); onLoad() }} onErrorCapture={() => { setReady(true); onError() }} style={{ minHeight: 0, flex: 1, width: '100%', border: 0, background: 'var(--dsw-alias-bg-base, transparent)' }} /></WorkbenchPageTransition>
}

function BrowserEditor({ owner }: { owner: AreaProps }): ReactNode {
  const [initial] = useState(() => restoreBrowserState(owner.state))
  const [history, setHistory] = useState<readonly string[]>(initial.history)
  const [index, setIndex] = useState(initial.index)
  const [draft, setDraft] = useState(initial.history[initial.index] ?? '')
  const [message, setMessage] = useState<string | undefined>(initial.invalid ? '已保存的网址无效，未加载此页面。请重新输入不带凭据的 HTTP(S) 地址。' : undefined)
  const [revision, setRevision] = useState(0)
  const loadedRevision = useRef<number>()
  // Remounting loads the last controlled URL, not the previous unreadable URL.
  const [unknown, setUnknown] = useState(false)
  const [sandboxed, setSandboxed] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)
  const url = history[index]
  const externalDraft = parseBrowserAddress(draft)?.href
  const paused = owner.lifecycle?.visibility === 'background' && owner.lifecycle.background === 'pause'
  const persist = (nextHistory: readonly string[], nextIndex: number, nextUnknown = false): void => {
    const next = nextHistory[nextIndex]
    owner.setState({ history: [...nextHistory], index: nextIndex, ...(next === undefined ? {} : { url: next }), unknown: nextUnknown })
  }
  const navigate = (): void => {
    const parsed = parseBrowserAddress(draft)
    if (parsed === undefined) { setMessage('地址无效。只支持不带凭据的 HTTP(S) 地址，且不能打开 DSH 当前页面。'); return }
    const nextUrl = parsed.toString()
    const current = history[index]
    const nextHistory = current === nextUrl ? history : [...history.slice(0, index + 1), nextUrl]
    const nextIndex = current === nextUrl ? index : nextHistory.length - 1
    setMessage(undefined); setLoadFailed(false); setUnknown(false); setHistory(nextHistory); setIndex(nextIndex); setDraft(nextUrl); loadedRevision.current = undefined; setRevision(value => value + 1); persist(nextHistory, nextIndex)
  }
  const go = (delta: -1 | 1): void => {
    if (unknown) return
    const nextIndex = index + delta
    if (nextIndex < 0 || nextIndex >= history.length) return
    setIndex(nextIndex); setDraft(history[nextIndex] ?? ''); setMessage(undefined); setLoadFailed(false); setUnknown(false); loadedRevision.current = undefined; setRevision(value => value + 1); persist(history, nextIndex)
  }
  const reload = (): void => {
    if (url === undefined) return
    setMessage(undefined); setLoadFailed(false); setUnknown(false); loadedRevision.current = undefined; setRevision(value => value + 1); persist(history, index)
  }
  const currentHost = url === undefined ? undefined : (() => { try { return new URL(url).hostname } catch { return undefined } })()
  const reportLoaded = (): void => {
    if (loadedRevision.current === revision) {
      setUnknown(true); persist(history, index, true)
      return
    }
    loadedRevision.current = revision
  }
  return <section className={css.officialArea} data-workbench-official-area="browser" data-workbench-browser-carrier="iframe" style={{ display: 'flex', minWidth: 0, minHeight: 0, height: '100%', flexDirection: 'column' }}>
    <form className={css.browserToolbar} onSubmit={event => { event.preventDefault(); navigate() }} style={{ display: 'flex', flexWrap: 'wrap', flexShrink: 0, alignItems: 'center', gap: 4, minHeight: 38, boxSizing: 'border-box', padding: '5px 6px', borderBottom: '.5px solid var(--dsw-alias-border-l3, color-mix(in srgb, currentColor 16%, transparent))', background: 'var(--dsw-alias-bg-base, transparent)' }}>
      <button type="button" aria-label="后退" title="后退" disabled={unknown || index <= 0} onClick={() => go(-1)} style={{ width: 28, height: 28, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flex: 'none', border: 0, borderRadius: 6, background: 'transparent', color: 'var(--dsw-alias-label-secondary, currentColor)', cursor: 'pointer' }}><IconChevronLeftOutlineMedium /></button>
      <button type="button" aria-label="前进" title="前进" disabled={unknown || index >= history.length - 1} onClick={() => go(1)} style={{ width: 28, height: 28, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flex: 'none', border: 0, borderRadius: 6, background: 'transparent', color: 'var(--dsw-alias-label-secondary, currentColor)', cursor: 'pointer' }}><IconChevronRightOutlineMedium /></button>
      <button type="button" aria-label="刷新" title="刷新" disabled={url === undefined} onClick={reload} style={{ width: 28, height: 28, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flex: 'none', border: 0, borderRadius: 6, background: 'transparent', color: 'var(--dsw-alias-label-secondary, currentColor)', cursor: 'pointer' }}><IconRefreshOutlineMedium /></button>
      <div style={{ display: 'flex', minWidth: 0, flex: '1 1 120px', alignItems: 'center', gap: 4, position: 'relative' }}><input aria-label="浏览器地址" value={draft} onChange={event => setDraft(event.target.value)} placeholder="输入 HTTP(S) 地址" spellCheck={false} style={{ boxSizing: 'border-box', width: '100%', height: 28, minWidth: 0, padding: '0 9px', color: unknown ? 'var(--dsw-alias-label-tertiary, currentColor)' : 'var(--dsw-alias-label-primary, currentColor)', font: 'inherit', background: unknown ? 'var(--dsw-alias-bg-layer-2, #222)' : 'var(--dsw-alias-bg-layer-1, #222)', border: '.5px solid var(--dsw-alias-border-l2, #555)', borderRadius: 6, outline: 'none' }} /></div>
      <button type="submit" aria-label="前往" title="前往" style={{ width: 28, height: 28, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flex: 'none', border: 0, background: 'transparent', color: 'inherit', cursor: 'pointer' }}><IconChevronRightOutlineMedium /></button>
      <button type="button" aria-label="在新标签页打开当前已知网址" title="在新标签页打开当前已知网址" disabled={url === undefined || unknown} onClick={() => { if (url !== undefined && typeof window !== 'undefined') window.open(url, '_blank', 'noopener,noreferrer') }} style={{ width: 28, height: 28, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flex: 'none', border: 0, borderRadius: 6, background: 'transparent', color: 'var(--dsw-alias-label-secondary, currentColor)', cursor: 'pointer' }}><IconRightUpOutlineMedium /></button>
      <button type="button" aria-label={sandboxed ? '关闭沙箱限制' : '恢复沙箱限制'} title={sandboxed ? '关闭沙箱限制' : '恢复沙箱限制'} disabled={url === undefined} aria-pressed={!sandboxed} onClick={() => { setSandboxed(value => !value); reload() }} style={{ width: 28, height: 28, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flex: 'none', border: 0, borderRadius: 6, background: sandboxed ? 'transparent' : 'color-mix(in srgb, var(--dsw-alias-state-error-primary, #b42318) 10%, transparent)', color: sandboxed ? 'var(--dsw-alias-label-secondary, currentColor)' : 'var(--dsw-alias-state-error-primary, #b42318)', cursor: 'pointer' }}><IconShieldOutlineMedium /></button>
    </form>
    <div className={css.browserNotice} data-workbench-browser-web-limit="" style={{ display: 'flex', flexWrap: 'wrap', flexShrink: 0, alignItems: 'center', gap: '4px 12px', padding: '6px 10px', fontSize: 12, lineHeight: 1.5, borderBottom: '.5px solid var(--dsw-alias-border-l3, transparent)', color: 'var(--dsw-alias-label-secondary, currentColor)' }}>
      <span style={{ flex: '1 1 180px', minWidth: 0, overflowWrap: 'anywhere' }}>Web 网页预览：部分网站禁止内嵌。空白或拒绝连接时请在新标签页打开；关闭沙箱不能解除网站限制。</span>
      {externalDraft === undefined ? null : <a aria-label="在新标签页打开地址栏网址" href={externalDraft} target="_blank" rel="noopener noreferrer" title="打开地址栏中输入的网址" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--dsw-alias-label-link, #2380b8)', overflowWrap: 'anywhere' }}><IconRightUpOutlineMedium />新标签页打开</a>}
    </div>
    {!sandboxed ? <div role="status" style={{ padding: '6px 12px', background: 'color-mix(in srgb, var(--dsw-alias-state-warning-primary, #8a4b08) 8%, transparent)', color: 'var(--dsw-alias-state-warning-primary, #8a4b08)', fontSize: 11 }}>沙箱限制已关闭；页面可以导航顶层应用，并使用下载、模态对话框与输入锁定。</div> : null}
    {loadFailed ? <div role="status" style={{ padding: '6px 12px', color: 'var(--dsw-alias-state-error-primary, #b42318)', background: 'color-mix(in srgb, var(--dsw-alias-state-error-primary, #b42318) 8%, transparent)', fontSize: 11 }}>页面报告加载失败，请检查地址或在新标签页打开。</div> : null}
    {message === undefined ? null : <p role="alert" style={{ overflowWrap: 'anywhere', margin: 0, padding: '10px 12px', color: 'var(--dsw-alias-state-error-primary, #b42318)', background: 'color-mix(in srgb, var(--dsw-alias-state-error-primary, #b42318) 8%, transparent)' }}>{message}</p>}
    {paused ? <div data-workbench-official-area-state="browser-paused" role="status" style={{ display: 'flex', flex: 1, minHeight: 0, justifyContent: 'center', alignItems: 'center', padding: 24, color: 'var(--dsw-alias-label-tertiary, currentColor)', textAlign: 'center' }}>后台区域已暂停网页预览；激活此区域后恢复。</div> : url === undefined ? <div data-workbench-official-area-state="browser-empty" style={{ display: 'flex', flex: 1, minHeight: 0, justifyContent: 'center', alignItems: 'center', padding: 24, color: 'var(--dsw-alias-label-tertiary, currentColor)', textAlign: 'center' }}>输入 HTTP(S) 地址开始浏览</div> : <BrowserPreview key={`${url}:${String(revision)}:${sandboxed ? 'sandbox' : 'open'}`} title={currentHost === undefined ? 'Workbench 浏览器' : currentHost} url={url} sandboxed={sandboxed} onLoad={reportLoaded} onError={() => setLoadFailed(true)} />}
    {unknown ? <p style={{ margin: 0, padding: '4px 10px', color: 'var(--dsw-alias-label-tertiary, currentColor)', fontSize: 11, borderTop: '.5px solid var(--dsw-alias-border-l3, transparent)' }}>页面已在 iframe 内跳转；当前 URL 无法由 DSH 读取。地址栏保留最后输入的网址；刷新会返回该地址。</p> : null}
  </section>
}

function resourcePreviewTitle(owner: AreaProps): string {
  const state = owner.state !== null && typeof owner.state === 'object' && !Array.isArray(owner.state)
    ? owner.state as { readonly resourceAddress?: unknown }
    : undefined
  const address = typeof state?.resourceAddress === 'string' ? state.resourceAddress : undefined
  if (address === undefined || address.length === 0) return '文件预览'
  const name = address.slice(address.lastIndexOf('/') + 1)
  if (name.length === 0) return '文件预览'
  try { return decodeURIComponent(name) } catch { return name }
}

export interface WorkbenchOfficialAreaEditorSetV1 {
  readonly files: (owner: AreaProps) => ReactNode
  readonly terminal: (owner: AreaProps) => ReactNode
  readonly browser: (owner: AreaProps) => ReactNode
  readonly documentPreview: (owner: AreaProps) => ReactNode
  readonly start: (owner: AreaProps) => ReactNode
  readonly conversation: (owner: AreaProps) => ReactNode
  readonly trajectory: (owner: AreaProps) => ReactNode
  readonly changesReview: (owner: AreaProps) => ReactNode
  readonly plan: (owner: AreaProps) => ReactNode
  readonly scheduleTask: (owner: AreaProps) => ReactNode
  readonly guide: (owner: AreaProps) => ReactNode
  readonly subagentChat: (owner: AreaProps) => ReactNode
}

export function createWorkbenchOfficialAreaEditors(ctx: Context): WorkbenchOfficialAreaEditorSetV1 {
  const conversation = createWorkbenchNativeConversationEditors(ctx)
  return {
    files: owner => <ProjectFilesEditor projectId={typeof (owner.state as { projectId?: unknown } | undefined)?.projectId === 'string' ? (owner.state as { projectId: string }).projectId : undefined} workbenchId={owner.workbenchId} areaId={typeof (owner.state as { projectAreaId?: unknown } | undefined)?.projectAreaId === 'string' ? (owner.state as { projectAreaId: string }).projectAreaId : owner.areaId} />,
    terminal: owner => <NativeSidebarAreaEditor
      key={`${owner.instanceId}:${owner.sessionId}:${owner.runtimeIdentity ? owner.bindingGeneration : owner.areaClaim}`}
      owner={owner}
      ctx={ctx}
      kind="terminal"
      title="终端"
      entryKey={NATIVE_TAB_ENTRY_KEYS.terminal}
      fallback={<TerminalEditor owner={owner} ctx={ctx} />}
    />,
    browser: owner => <NativeSidebarAreaEditor
      key={`${owner.instanceId}:${owner.sessionId}:${owner.runtimeIdentity ? owner.bindingGeneration : owner.areaClaim}`}
      owner={owner}
      ctx={ctx}
      kind="browser"
      title="浏览器"
      entryKey={NATIVE_TAB_ENTRY_KEYS.browser}
      fallback={<BrowserEditor owner={owner} />}
    />,
    documentPreview: owner => <NativeSidebarAreaEditor
      key={`${owner.instanceId}:${owner.sessionId}:${owner.runtimeIdentity ? owner.bindingGeneration : owner.areaClaim}`}
      owner={owner}
      ctx={ctx}
      kind="documentpreview"
      title={resourcePreviewTitle(owner)}
      entryKey={NATIVE_TAB_ENTRY_KEYS.documentPreview}
      fallback={<section data-workbench-official-area-state="document-preview-unavailable" style={{ padding: 20 }}>当前宿主没有可用的 DSH 原生文件预览。</section>}
    />,
    changesReview: owner => <NativeSidebarAreaEditor key={`${owner.instanceId}:${owner.sessionId}:${owner.runtimeIdentity ? owner.bindingGeneration : owner.areaClaim}`} owner={owner} ctx={ctx} kind="changes-review" title="变更审查" entryKey={NATIVE_TAB_ENTRY_KEYS.changesReview} fallback={<NativeResourceUnavailable label="变更审查" />} />,
    plan: owner => <NativeSidebarAreaEditor key={`${owner.instanceId}:${owner.sessionId}:${owner.runtimeIdentity ? owner.bindingGeneration : owner.areaClaim}`} owner={owner} ctx={ctx} kind="plan" title="计划" entryKey={NATIVE_TAB_ENTRY_KEYS.plan} fallback={<NativeResourceUnavailable label="计划" />} />,
    scheduleTask: owner => <NativeSidebarAreaEditor key={`${owner.instanceId}:${owner.sessionId}:${owner.runtimeIdentity ? owner.bindingGeneration : owner.areaClaim}`} owner={owner} ctx={ctx} kind="schedule-task" title="计划任务" entryKey={NATIVE_TAB_ENTRY_KEYS.scheduleTask} fallback={<NativeResourceUnavailable label="计划任务" />} />,
    guide: owner => <NativeSidebarAreaEditor key={`${owner.instanceId}:${owner.sessionId}:${owner.runtimeIdentity ? owner.bindingGeneration : owner.areaClaim}`} owner={owner} ctx={ctx} kind="guide" title="功能指南" entryKey={NATIVE_TAB_ENTRY_KEYS.guide} fallback={<NativeResourceUnavailable label="功能指南" />} />,
    subagentChat: owner => <NativeSidebarAreaEditor key={`${owner.instanceId}:${owner.sessionId}:${owner.runtimeIdentity ? owner.bindingGeneration : owner.areaClaim}`} owner={owner} ctx={ctx} kind="subagent-chat" title="子 Agent 对话" entryKey={NATIVE_TAB_ENTRY_KEYS.subagentChat} fallback={<NativeResourceUnavailable label="子 Agent 对话" />} />,
    start: conversation.start as unknown as (owner: AreaProps) => ReactNode,
    conversation: conversation.conversation as unknown as (owner: AreaProps) => ReactNode,
    trajectory: conversation.trajectory as unknown as (owner: AreaProps) => ReactNode,
  }
}
