import { workbenchNativeSidebarForResourceAddress } from './native-sidebar-registry.ts'
import { parseFileAddress } from '@deepseek-ai/dsh-util-workspace-path'
import type { WorkbenchConversationResourceBindingV1 } from '../module-contract.ts'
import {
  conversationResourceActionFor,
  normalizeWorkbenchConversationInteractionPolicy,
  type WorkbenchConversationInteractionPolicyV1,
} from '../workbench-interaction-policy.ts'

/** Placement options forwarded from a DSH resource action. */
export type WorkbenchResourcePlacement = Record<string, unknown>

/** Result of routing a native Conversation resource through its Area owner. */
export type WorkbenchResourceRouteResult = 'handled' | 'native-fallback' | 'rejected'

/** Session identity that emitted a native resource action. */
export interface WorkbenchResourceSourceV1 {
  readonly sessionId: string
  readonly parentSessionId?: string
}

/** Stable resource type used by the user-facing Workbench interaction settings. */
export function workbenchConversationResourceType(address: string): string | undefined {
  if (address.startsWith('dsh-resource://trajectory-inspect/session/')) return 'trajectory-inspect'
  if (workbenchBrowserUrlFromAddress(address) !== undefined) return 'browser'
  const definition = workbenchNativeSidebarForResourceAddress(address)
  switch (definition?.kind) {
    case 'documentpreview': return 'file'
    case 'changes-review': return 'changes-review'
    case 'plan': return 'plan'
    case 'subagent-chat': return 'subagent-chat'
    case 'schedule-task': return 'schedule-task'
    default: return undefined
  }
}

/**
 * Keep an external URL in the same resource-address namespace as the other
 * Conversation results.  The URL is encoded into the identity so two URLs
 * become two Workbench tabs while navigation params remain available to the
 * native Browser body.
 */
export function workbenchBrowserAddressFor(sessionId: string, url: string): string | undefined {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined
    return `dsh-resource://browser/session/${encodeURIComponent(sessionId)}/${encodeURIComponent(parsed.href)}`
  } catch {
    return undefined
  }
}

export function workbenchBrowserUrlFromAddress(address: string): string | undefined {
  const match = addressWithoutNavigation(address).match(/^dsh-resource:\/\/browser\/session\/([^/]+)\/(.+)$/u)
  if (match === null) return undefined
  try {
    const url = new URL(decodeURIComponent(match[2] ?? ''))
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined
    return url.href
  } catch {
    return undefined
  }
}

export function workbenchConversationResourceBindingForAddress(
  address: string,
  bindings: readonly WorkbenchConversationResourceBindingV1[] | undefined,
): WorkbenchConversationResourceBindingV1 | undefined {
  return bindings?.find(binding => binding.resourcePatterns.some(pattern => pattern.endsWith('**')
    ? address.startsWith(pattern.slice(0, -2))
    : address === pattern))
}

const SESSION_RESOURCE_PREFIXES = [
  'dsh-resource://trajectory-inspect/session/',
  'dsh-resource://changes-review/session/',
  'dsh-resource://subagentchat/session/',
  'dsh-resource://schedule-task/session/',
] as const

function planSessionId(address: string): string | undefined {
  try {
    const normalized = addressWithoutNavigation(address)
    const plan = normalized.match(/^dsh-resource:\/\/plan\/([^/]+)(?:\/([^/]+))?/u)
    if (plan !== null) {
      if (decodeURIComponent(plan[1] ?? '') === 'subagent') {
        const child = normalized.split('/')[5]
        return child === undefined ? undefined : decodeURIComponent(child)
      }
      return plan[1] === undefined ? undefined : decodeURIComponent(plan[1])
    }
    const review = normalized.match(/^dsh-resource:\/\/plan-review\/([^/]+)/u)
    return review?.[1] === undefined ? undefined : decodeURIComponent(review[1])
  } catch {
    return undefined
  }
}

/**
 * Return the direct parent carried by a child-Agent resource address. A
 * Workbench Area bound to that parent may host the child resource; the native
 * body retains the child Session through DSH's resource provider.
 */
function resourceParentSessionId(address: string): string | undefined {
  // `parent` is part of the canonical subagent resource identity, not a
  // transient navigation parameter. Keep the query while parsing this field.
  const identity = address.split('#', 1)[0] ?? address
  const normalized = addressWithoutNavigation(address)
  if (identity.startsWith('dsh-resource://subagentchat/session/')) {
    try {
      return new URL(identity).searchParams.get('parent') ?? undefined
    } catch {
      return undefined
    }
  }
  const plan = normalized.match(/^dsh-resource:\/\/plan\/subagent\/([^/]+)\//u)
  if (plan?.[1] === undefined) return undefined
  try { return decodeURIComponent(plan[1]) } catch { return undefined }
}

function addressWithoutNavigation(address: string): string {
  // Query data is part of some resource identities (notably subagent chat's
  // direct-parent and mode), while fragments are never resource identity.
  const end = address.indexOf('#')
  return end === -1 ? address : address.slice(0, end)
}

/**
 * Return the Session carried by a Workbench-supported resource address.
 * `undefined` means either an address with no Session identity (for example an
 * absolute file) or a resource whose ownership is not encoded by the address.
 */
export function workbenchResourceSessionId(address: string): string | undefined {
  const file = parseFileAddress(address)
  if (file?.scope === 'session') return file.sessionId
  const normalized = addressWithoutNavigation(address)
  if (normalized.startsWith('dsh-resource://browser/session/')) {
    const match = normalized.match(/^dsh-resource:\/\/browser\/session\/([^/]+)\//u)
    if (match?.[1] === undefined) return undefined
    try { return decodeURIComponent(match[1]) } catch { return undefined }
  }
  if (normalized.startsWith('dsh-resource://plan/') || normalized.startsWith('dsh-resource://plan-review/')) return planSessionId(normalized)
  for (const prefix of SESSION_RESOURCE_PREFIXES) {
    if (!normalized.startsWith(prefix)) continue
    const segment = normalized.slice(prefix.length).split(/[/?#]/u)[0]
    if (segment === undefined || segment.length === 0) return undefined
    try {
      return decodeURIComponent(segment)
    } catch {
      return undefined
    }
  }
  return undefined
}

/**
 * Check a resource before placing it in an Area. Known Session-scoped
 * addresses must belong to the Area Session. Child-Agent resources are the
 * one deliberate exception: their direct parent is also an owning context,
 * because DSH's native body retains and provides the child Session itself.
 * Session-less or currently opaque addresses remain eligible for the native
 * resource adapter.
 */
export function workbenchResourceMatchesSession(address: string, sessionId: string): boolean {
  const normalized = addressWithoutNavigation(address)
  const isKnownSessionAddress = parseFileAddress(normalized)?.scope === 'session'
    || normalized.startsWith('dsh-resource://browser/session/')
    || normalized.startsWith('dsh-resource://plan/')
    || normalized.startsWith('dsh-resource://plan-review/')
    || SESSION_RESOURCE_PREFIXES.some(prefix => normalized.startsWith(prefix))
  if (!isKnownSessionAddress) return true
  const resourceSessionId = workbenchResourceSessionId(normalized)
  return resourceSessionId === sessionId || resourceParentSessionId(normalized) === sessionId
}

/**
 * Route one DSH resource address into the owning Workbench Area.
 *
 * The resource address remains the identity.  Navigation parameters (for
 * example a file line or a changed-file index) are forwarded separately so
 * the Area can reveal the same resource tab and update its view.
 */
export function openWorkbenchResource(
  openNativeTab: ((kind: string, options?: Record<string, unknown>) => boolean | void) | undefined,
  address: string,
  placement?: WorkbenchResourcePlacement,
  expectedSessionId?: string,
  declaredBinding?: WorkbenchConversationResourceBindingV1,
): boolean {
  if (expectedSessionId !== undefined && !workbenchResourceMatchesSession(address, expectedSessionId)) return false
  const inspect = address.match(/^dsh-resource:\/\/trajectory-inspect\/session\/([^/]+)\/([^/#?]+)$/u)
  if (inspect) {
    if (openNativeTab === undefined) return false
    try { return openNativeTab('trajectory', { ...placement, editorId: 'workbench.agent-trajectory', resourceType: 'trajectory-inspect',
      nativeContentId: address, resourceAddress: address, params: { inspectCallId: decodeURIComponent(inspect[2]!) } }) !== false } catch { return false }
  }
  const browserUrl = workbenchBrowserUrlFromAddress(address)
  if (browserUrl !== undefined) {
    if (openNativeTab === undefined) return false
    return openNativeTab('browser', {
      ...(placement ?? {}),
      params: { ...((placement?.params as Record<string, unknown> | undefined) ?? {}), url: browserUrl },
      nativeContentId: address,
      resourceAddress: address,
      resourceType: 'browser',
    }) !== false
  }
  const definition = workbenchNativeSidebarForResourceAddress(address)
  if (openNativeTab === undefined) return false
  if (definition?.editorId !== undefined) return openNativeTab(definition.kind, {
    ...(placement ?? {}),
    nativeContentId: address,
    resourceAddress: address,
  }) !== false
  if (declaredBinding === undefined) return false
  return openNativeTab(declaredBinding.resourceType, {
    ...(placement ?? {}),
    editorId: declaredBinding.editorId,
    resourceType: declaredBinding.resourceType,
    nativeContentId: address,
    resourceAddress: address,
  }) !== false
}

function actionForPlacement(
  placement: WorkbenchConversationResourceBindingV1['defaultPlacement'],
): { readonly handled: boolean; readonly options?: Readonly<Record<string, unknown>> } {
  if (placement === 'official-sidebar' || placement === 'floating') return { handled: true, options: { floating: true } }
  if (placement === 'disabled') return { handled: true, options: { ignoreResource: true } }
  if (placement === 'new-tab') return { handled: true, options: { revealIfOpened: false } }
  if (placement === 'replace-current') return { handled: true, options: { replaceTab: true } }
  return { handled: true }
}

/**
 * Route one native Conversation resource using the user's explicit policy.
 * The result keeps an intentional DSH fallback distinct from an Area/session
 * rejection, so callers never turn a stale Workbench event into global nav.
 */
export function routeWorkbenchConversationResource(
  openNativeTab: ((kind: string, options?: Record<string, unknown>) => boolean | void) | undefined,
  address: string,
  policy: WorkbenchConversationInteractionPolicyV1 | undefined,
  placement?: WorkbenchResourcePlacement,
  expectedSessionId?: string,
  source?: WorkbenchResourceSourceV1,
  resourceBindings?: readonly WorkbenchConversationResourceBindingV1[],
): WorkbenchResourceRouteResult {
  if (expectedSessionId !== undefined && source !== undefined
    && source.sessionId !== expectedSessionId && source.parentSessionId !== expectedSessionId) return 'rejected'
  if (expectedSessionId !== undefined) {
    const matchesAreaSession = workbenchResourceMatchesSession(address, expectedSessionId)
    const matchesEmbeddedChild = source?.parentSessionId === expectedSessionId
      && workbenchResourceMatchesSession(address, source.sessionId)
    // This check must happen before policy fallback. A stale resource cannot
    // escape to DSH's global Sidebar merely because the user selected the
    // official-sidebar placement for that resource type.
    if (!matchesAreaSession && !matchesEmbeddedChild) return 'rejected'
  }
  const declaredBinding = workbenchConversationResourceBindingForAddress(address, resourceBindings)
  const resourceType = workbenchConversationResourceType(address) ?? declaredBinding?.resourceType
  const configured = resourceType === undefined
    ? undefined
    : normalizeWorkbenchConversationInteractionPolicy(policy).conversationResources[resourceType]
  let action: ReturnType<typeof conversationResourceActionFor>
  if (configured !== undefined) {
    action = conversationResourceActionFor(resourceType, policy)
  } else if (declaredBinding !== undefined) {
    action = actionForPlacement(declaredBinding.defaultPlacement)
  } else {
    const unknown = normalizeWorkbenchConversationInteractionPolicy(policy).unknownResource
    if (unknown === 'disabled') return 'handled'
    // `module-default` is deliberately strict: without a Workbench module
    // declaration there is no owner or lifecycle contract to invoke. The
    // legacy sidebar preference cannot authorize an undeclared resource.
    if (unknown === 'official-sidebar') return 'rejected'
    return 'rejected'
  }
  if (!action.handled) return 'native-fallback'
  if (action.options?.ignoreResource === true) return 'handled'
  return openWorkbenchResource(openNativeTab, address, {
    ...(placement ?? {}),
    ...(action.options ?? {}),
    ...(source ? { resourceSource: source } : {}),
  }, undefined, declaredBinding) ? 'handled' : 'rejected'
}

/** DSH ui-deliverables' canonical address shape, kept in one adapter seam. */
export function workbenchChangesReviewAddress(input: {
  sessionId: string
  seq: number
  turn: number
}): string {
  return `dsh-resource://changes-review/session/${encodeURIComponent(input.sessionId)}/${input.seq}/${input.turn}`
}
