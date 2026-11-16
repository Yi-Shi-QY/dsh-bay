/**
 * Workbench-owned, JSON-only Slot metadata contracts.
 *
 * These types intentionally live in the plugin instead of being imported from
 * DSH's optional compatibility layer.  A vanilla DSH may not expose preview,
 * portability, or distribution metadata on StoredEntry yet; the plugin can
 * still compile and run there, while the runtime adapter uses these values
 * when the richer seam is present.
 */

export type SlotPortableValue =
  | null
  | boolean
  | number
  | string
  | readonly SlotPortableValue[]
  | { readonly [key: string]: SlotPortableValue }

export type SlotPreviewValue = SlotPortableValue

export interface SlotPortabilityContextV1 {
  readonly version: 1
  readonly editor: {
    readonly id: string
    readonly scope: 'root' | 'session'
    readonly moduleInstanceId: string
    readonly title: string
  }
  readonly target?: {
    readonly workspaceId?: string
    readonly sessionId: string
  }
}

/** Runtime-only descriptor; functions are never persisted in Settings. */
export interface SlotPortabilityDescriptorV1 {
  readonly version: 1
  readonly exportState?: (
    state: SlotPortableValue,
    context: SlotPortabilityContextV1,
  ) => SlotPortableValue | undefined
  readonly importState?: (
    state: SlotPortableValue,
    context: SlotPortabilityContextV1,
  ) => SlotPortableValue
}

export interface SlotPreviewModelSelectionV1 {
  readonly provider?: string
  readonly model?: string
  readonly modelLabel?: string
  readonly reasoningEffort?: string
  readonly reasoningEffortLabel?: string
  readonly routable: boolean | null
  readonly status: 'idle' | 'loading' | 'ready' | 'selecting' | 'error' | 'unknown'
}

export interface SlotPreviewContextV1 {
  readonly version: 1
  readonly density: 'compact' | 'detail'
  readonly editor: {
    readonly id: string
    readonly scope: 'root' | 'session'
    readonly moduleInstanceId: string
    readonly title: string
    readonly available: boolean
    readonly bindingState: 'bound' | 'unbound' | 'missing' | 'unknown'
  }
  readonly module: { readonly state: SlotPreviewValue }
  readonly binding?: { readonly workspaceId?: string; readonly sessionId: string }
  readonly session?: {
    readonly id: string
    readonly displayTitle: string
    readonly agentPreset?: string
    readonly modelSelection?: SlotPreviewModelSelectionV1
  }
  readonly area: { readonly historyCount: number; readonly active: boolean }
}

export type SlotPreviewTextTone = 'primary' | 'secondary' | 'tertiary' | 'muted'
export type SlotPreviewBadgeTone = 'neutral' | 'info' | 'success' | 'warning' | 'error'
export type SlotPreviewListState = 'default' | 'active' | 'muted' | 'warning' | 'error'
export type SlotPreviewTimelineState = 'pending' | 'active' | 'success' | 'warning' | 'error'

export type SlotPreviewNodeV1 =
  | { readonly kind: 'stack'; readonly direction: 'row' | 'column'; readonly gap: 'none' | 'xs' | 'sm' | 'md'; readonly align?: 'start' | 'center' | 'stretch'; readonly children: readonly SlotPreviewNodeV1[] }
  | { readonly kind: 'text'; readonly text: string; readonly tone?: SlotPreviewTextTone; readonly emphasis?: 'normal' | 'medium' | 'strong' }
  | { readonly kind: 'icon'; readonly name: string; readonly label?: string }
  | { readonly kind: 'badge'; readonly label: string; readonly tone: SlotPreviewBadgeTone }
  | { readonly kind: 'input'; readonly placeholder?: string; readonly valueLabel?: string; readonly disabled?: boolean; readonly status?: 'idle' | 'blocked' | 'unknown' }
  | { readonly kind: 'list'; readonly items: readonly { readonly primary: string; readonly secondary?: string; readonly icon?: string; readonly state?: SlotPreviewListState }[] }
  | { readonly kind: 'timeline'; readonly items: readonly { readonly label: string; readonly detail?: string; readonly state?: SlotPreviewTimelineState }[] }
  | { readonly kind: 'divider' }
  | { readonly kind: 'empty'; readonly label: string; readonly detail?: string }

export interface SlotPreviewDocumentV1 {
  readonly version: 1
  readonly root: SlotPreviewNodeV1
  readonly ariaLabel?: string
}

export interface SlotPreviewDescriptorV1 {
  readonly version: 1
  readonly presentation?: {
    readonly icon?: string
    readonly category?: string
    readonly categoryOrder?: number
  }
  readonly resolve: (context: SlotPreviewContextV1) => SlotPreviewDocumentV1
}

export interface SlotPreviewParseResultV1 {
  readonly document?: SlotPreviewDocumentV1
  readonly error?: 'invalid-document' | 'unknown-version' | 'unknown-node' | 'budget-exceeded'
}

const MAX_DEPTH = 6
const MAX_NODES = 80
const MAX_TEXT = 240
const MAX_LIST_ITEMS = 12

const isText = (value: unknown): value is string => typeof value === 'string' && value.length <= MAX_TEXT
const isOneOf = <T extends string>(value: unknown, values: readonly T[]): value is T => typeof value === 'string' && values.includes(value as T)

function parseNode(value: unknown, depth: number, budget: { count: number }): SlotPreviewNodeV1 | 'unknown-node' | 'budget-exceeded' | undefined {
  if (depth > MAX_DEPTH) return 'budget-exceeded'
  if (budget.count++ >= MAX_NODES) return 'budget-exceeded'
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const source = value as Record<string, unknown>
  const kind = source.kind
  if (kind === 'divider') return { kind: 'divider' }
  if (kind === 'text') return !isText(source.text) ? undefined : { kind, text: source.text, ...(isOneOf(source.tone, ['primary', 'secondary', 'tertiary', 'muted']) ? { tone: source.tone } : {}), ...(isOneOf(source.emphasis, ['normal', 'medium', 'strong']) ? { emphasis: source.emphasis } : {}) }
  if (kind === 'icon') return !isText(source.name) ? undefined : { kind, name: source.name, ...(isText(source.label) ? { label: source.label } : {}) }
  if (kind === 'badge') return !isText(source.label) || !isOneOf(source.tone, ['neutral', 'info', 'success', 'warning', 'error']) ? undefined : { kind, label: source.label, tone: source.tone }
  if (kind === 'empty') return !isText(source.label) ? undefined : { kind, label: source.label, ...(isText(source.detail) ? { detail: source.detail } : {}) }
  if (kind === 'input') return { kind, ...(isText(source.placeholder) ? { placeholder: source.placeholder } : {}), ...(isText(source.valueLabel) ? { valueLabel: source.valueLabel } : {}), ...(typeof source.disabled === 'boolean' ? { disabled: source.disabled } : {}), ...(isOneOf(source.status, ['idle', 'blocked', 'unknown']) ? { status: source.status } : {}) }
  if (kind === 'stack') {
    if (!isOneOf(source.direction, ['row', 'column']) || !isOneOf(source.gap, ['none', 'xs', 'sm', 'md']) || !Array.isArray(source.children) || source.children.length > MAX_LIST_ITEMS) return undefined
    const children: SlotPreviewNodeV1[] = []
    for (const child of source.children) {
      const parsed = parseNode(child, depth + 1, budget)
      if (parsed === 'unknown-node' || parsed === 'budget-exceeded') return parsed
      if (parsed === undefined) return undefined
      children.push(parsed)
    }
    return { kind, direction: source.direction, gap: source.gap, ...(isOneOf(source.align, ['start', 'center', 'stretch']) ? { align: source.align } : {}), children }
  }
  if (kind === 'list' || kind === 'timeline') {
    if (!Array.isArray(source.items) || source.items.length > MAX_LIST_ITEMS) return 'budget-exceeded'
    if (kind === 'list') {
      const items: Array<{ primary: string; secondary?: string; icon?: string; state?: SlotPreviewListState }> = []
      for (const item of source.items) {
        if (typeof item !== 'object' || item === null || Array.isArray(item)) return undefined
        const row = item as Record<string, unknown>
        if (!isText(row.primary)) return undefined
        items.push({ primary: row.primary, ...(isText(row.secondary) ? { secondary: row.secondary } : {}), ...(isText(row.icon) ? { icon: row.icon } : {}), ...(isOneOf(row.state, ['default', 'active', 'muted', 'warning', 'error']) ? { state: row.state } : {}) })
      }
      return { kind: 'list', items }
    }
    const items: Array<{ label: string; detail?: string; state?: SlotPreviewTimelineState }> = []
    for (const item of source.items) {
      if (typeof item !== 'object' || item === null || Array.isArray(item)) return undefined
      const row = item as Record<string, unknown>
      if (!isText(row.label)) return undefined
      items.push({ label: row.label, ...(isText(row.detail) ? { detail: row.detail } : {}), ...(isOneOf(row.state, ['pending', 'active', 'success', 'warning', 'error']) ? { state: row.state } : {}) })
    }
    return { kind: 'timeline', items }
  }
  return 'unknown-node'
}

/** Validate and budget a resolver result before exposing it to React. */
export function parseSlotPreviewDocumentV1(value: unknown): SlotPreviewParseResultV1 {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return { error: 'invalid-document' }
  const source = value as Record<string, unknown>
  if (source.version !== 1) return { error: 'unknown-version' }
  const root = parseNode(source.root, 0, { count: 0 })
  if (root === 'unknown-node') return { error: 'unknown-node' }
  if (root === 'budget-exceeded') return { error: 'budget-exceeded' }
  if (root === undefined) return { error: 'invalid-document' }
  return { document: { version: 1, root, ...(isText(source.ariaLabel) ? { ariaLabel: source.ariaLabel } : {}) } }
}
