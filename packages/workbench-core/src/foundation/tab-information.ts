import { defaultWorkbenchTranslate, workbenchPageTitle, type WorkbenchTranslate } from './workbench-locale.ts'
import { parseFileAddress } from '@deepseek-ai/dsh-util-workspace-path'
import { workbenchBrowserUrlFromAddress, workbenchResourceSessionId } from '../client/workbench-resource-opener.ts'
import { workbenchAgentPresetLabel } from './agent-preset-label.ts'
import type { WorkbenchEditorCatalogRow } from './catalog.ts'
import type { SessionBindingV1, TabDocument } from './model.ts'
import type { SessionTargetResolverWorkspace } from './session-target-resolver.ts'

export interface WorkbenchTabInformationSession {
  title?: string
  displayTitle?: string
  cwd?: string
  projectionValues?: { readonly agentPreset?: string | null }
}

export interface WorkbenchTabInformationFacts {
  sessions: Readonly<Record<string, WorkbenchTabInformationSession | undefined>>
  workspaces: readonly SessionTargetResolverWorkspace[]
  markersByWorkspace?: Readonly<Record<string, Readonly<Record<string, { label: string }>>>>
  location: string
}

export interface WorkbenchTabInformation {
  tooltip: string
  detail: string
  searchText: string
  accessibleLabel: string
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function browserUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined
    url.username = ''; url.password = ''
    return url.href
  } catch { return undefined }
}

/** Derive display-only information from current facts. Never mount editors or fetch on hover. */
export function buildWorkbenchTabInformation(input: {
  tab: TabDocument
  title?: string
  editor: WorkbenchEditorCatalogRow | undefined
  areaBinding: SessionBindingV1 | undefined
  statusLabel: string
  ordinal: number
  facts?: WorkbenchTabInformationFacts
  t?: WorkbenchTranslate
}): WorkbenchTabInformation {
  const { tab, editor, facts, t = defaultWorkbenchTranslate } = input
  const title = input.title ?? tab.lastKnownTitle
  const lines = [title, t('tab.info.type', { name: editor ? workbenchPageTitle(t, editor.id, editor.label) : t('tab.unavailablePage') })]
  const details: string[] = []
  const state = record(tab.state)
  const address = text(state?.resourceAddress)
  const pending = tab.pendingBinding !== undefined
  const binding = pending ? undefined : tab.binding ?? (tab.sessionId ? { sessionId: tab.sessionId } : undefined)
  const resourceSession = !pending && address ? workbenchResourceSessionId(address) : undefined
  const sessionId = resourceSession ?? binding?.sessionId
  const session = sessionId ? facts?.sessions[sessionId] : undefined
  // Resource previews can belong to a child Agent; never borrow the parent's mode or marker.
  const workspace = sessionId ? facts?.workspaces.find(row => row.sessionIds.includes(sessionId))
    ?? (sessionId === binding?.sessionId && binding?.workspaceId ? facts?.workspaces.find(row => row.workspaceId === binding.workspaceId) : undefined) : undefined
  const marker = workspace && sessionId ? facts?.markersByWorkspace?.[workspace.workspaceId]?.[sessionId]?.label : undefined
  const conversationTitle = text(session?.title) ?? text(session?.displayTitle)
  if (sessionId) {
    const name = [marker, conversationTitle ?? t('tab.conversationInfoUnavailable')].filter(Boolean).join(' · ')
    lines.push(t('tab.info.conversation', { name }))
    details.push(name)
    const preset = session?.projectionValues?.agentPreset
    const mode = preset === null ? t('tab.modeNotSet') : preset ? workbenchAgentPresetLabel(preset) : t('tab.notSynced')
    lines.push(t('tab.info.mode', { name: mode }))
    if (preset) details.push(mode)
  } else if (tab.editorScope === 'session' || pending) {
    lines.push(t('tab.pendingConversation'))
  }
  const project = text(workspace?.title) ?? text(workspace?.path)?.split(/[\\/]/).filter(Boolean).at(-1)
  if (project) { lines.push(t('tab.info.project', { name: project })); details.push(project) }

  if (!pending) {
    let path: string | undefined
    if (address) {
      try { path = parseFileAddress(address)?.path } catch { /* An invalid saved address is not display metadata. */ }
    }
    if (path) { lines.push(t('tab.info.file', { path })); details.push(path) }
    if (tab.editorId === 'workbench.workspace-files' || tab.editorId === 'workbench.terminal') {
      const directory = text(session?.cwd) ?? text(workspace?.path)
      if (directory) { lines.push(t(tab.editorId === 'workbench.terminal' ? 'tab.info.conversationFolder' : 'tab.info.folder', { path: directory })); details.push(directory) }
    }
    if (tab.editorId === 'workbench.browser') {
      const history = state?.history
      const index = state?.index
      const persistedUrl = browserUrl(Array.isArray(history) && typeof index === 'number' ? history[index] : undefined) ?? browserUrl(state?.url)
      const url = persistedUrl ?? (address ? browserUrl(workbenchBrowserUrlFromAddress(address)) : undefined)
      if (url) { lines.push(t(persistedUrl && state?.unknown === true ? 'tab.info.lastUrl' : 'tab.info.openUrl', { url })); details.push(url) }
    }
    if (tab.editorId === 'workbench.plan') {
      const planTitle = text(record(record(state?.nativeParams)?.planReview)?.title)
      if (planTitle) { lines.push(t('tab.info.plan', { name: planTitle })); details.push(planTitle) }
    }
  }
  lines.push(t('tab.info.status', { status: input.statusLabel }))
  if (facts?.location) lines.push(t('tab.info.location', { location: facts.location, index: input.ordinal }))
  return {
    tooltip: lines.join('\n'),
    detail: details.join(' · '),
    searchText: [...lines, session?.projectionValues?.agentPreset ?? ''].join(' ').toLocaleLowerCase('zh-CN'),
    accessibleLabel: [title, ...details].join(' · '),
  }
}
