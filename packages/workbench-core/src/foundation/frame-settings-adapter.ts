import type { SettingsScopeSnapshot, WorkbenchSettingsScope as SettingsScope } from '../client/workbench-settings-contracts.ts'
import type { SettingsScopePathOperation, SettingsScopePatchResult } from '../client/workbench-settings-contracts.ts'
import { patchWorkbenchSettings } from '../client/workbench-settings-contracts.ts'
import {
  cloneWorkbenchDocumentWithFreshIds, migrateDocumentV2ToV3, projectDocumentV3ToLayoutV2,
} from './document-v3.ts'
import type { WorkbenchDocumentV3 } from './document-v3.ts'
import { defaultLayout, groupsOf, type WorkbenchLayoutDocument } from './model.ts'
import { decodeWorkbenchHiddenEditorIds, normalizeWorkbenchTags, type WorkbenchSettings, type WorkbenchSettingsV4 } from './persistence.ts'
import { workbenchExtensionConsentKey, type WorkbenchExtensionConsentV1 } from '../workbench-extension-access.ts'

/** Read-only named Workbench and layout-template roster for the outer rail. */
export interface WorkbenchDirectorySnapshot {
  activeWorkbenchId?: string
  openWorkbenchIds: readonly string[]
  globalHiddenEditorIds?: readonly string[]
  extensionConsents?: Readonly<Record<string, WorkbenchExtensionConsentV1>>
  rows: readonly {
    workbenchId: string
    name: string
    description: string
    tags?: readonly string[]
    hiddenEditorIds?: readonly string[]
    layoutLocked?: boolean
    createdAt: number
    updatedAt: number
    pinnedAt?: number
    archivedAt?: number
  }[]
  invalidRows: readonly {
    workbenchId: string
    name: string
    description: string
    createdAt?: number
    updatedAt?: number
    pinnedAt?: number
    archivedAt?: number
    rawRecord: unknown
  }[]
  templates: readonly { templateId: string; name: string }[]
}

/** Settings mutation outcome including user-correctable directory rejections. */
export type WorkbenchDirectoryOperationResult = SettingsScopePatchResult | {
  status: 'rejected'
  reason: 'invalid-name' | 'duplicate-name' | 'not-found' | 'already-open' | 'archived' | 'last-runnable' | 'still-open'
}

/** Named-Workbench selector backed by the same revision-aware Settings scope. */
export interface WorkbenchDirectory {
  getSnapshot(): WorkbenchDirectorySnapshot
  /** Read a persisted document without selecting or mutating the Workbench. */
  getDocument?(workbenchId: string): WorkbenchDocumentV3 | undefined
  subscribe(listener: () => void): () => void
  select(workbenchId: string): Promise<SettingsScopePatchResult>
  /** Persist the tab order without changing the active Workbench. */
  reorder?(workbenchId: string, targetIndex: number): Promise<WorkbenchDirectoryOperationResult>
  openAndSelect(workbenchId: string): Promise<WorkbenchDirectoryOperationResult>
  unload(workbenchId: string): Promise<WorkbenchDirectoryOperationResult>
  create(options?: { templateId?: string }): Promise<WorkbenchDirectoryOperationResult>
  saveTemplate(name: string, document: WorkbenchLayoutDocument): Promise<WorkbenchDirectoryOperationResult>
  rename(workbenchId: string, name: string): Promise<WorkbenchDirectoryOperationResult>
  updateMetadata(workbenchId: string, metadata: { name: string; description: string; tags?: readonly string[] }): Promise<WorkbenchDirectoryOperationResult>
  setEditorVisible?(workbenchId: string, editorId: string, visible: boolean): Promise<WorkbenchDirectoryOperationResult>
  setLayoutLocked?(workbenchId: string, locked: boolean): Promise<WorkbenchDirectoryOperationResult>
  setGlobalEditorVisible?(editorId: string, visible: boolean): Promise<WorkbenchDirectoryOperationResult>
  setExtensionAllowed?(input: {
    packageName: string
    moduleId: string
    apiVersion: number
    editorIds?: readonly string[]
    contractFingerprint?: string
  }, allowed: boolean): Promise<WorkbenchDirectoryOperationResult>
  setPinned(workbenchId: string, pinned: boolean): Promise<WorkbenchDirectoryOperationResult>
  archive(workbenchId: string): Promise<WorkbenchDirectoryOperationResult>
  restore(workbenchId: string): Promise<WorkbenchDirectoryOperationResult>
  remove(workbenchId: string): Promise<WorkbenchDirectoryOperationResult>
  /** Frame-owned flush/conflict gate for operations which can change the active document. */
  setBeforeLifecycleTransition?(listener: () => Promise<boolean>): () => void
  /** Invoke the currently registered Frame flush before a Settings-side transfer action. */
  flushBeforeLifecycleTransition?(): Promise<boolean>
  /** @deprecated Use unload. Preserved temporarily for API consumers. */
  close(workbenchId: string): Promise<WorkbenchDirectoryOperationResult>
}

/** v3 persistence adapters consumed by the mature v2 visual Frame. */
export interface ProjectNeutralFrameSettings {
  settings: SettingsScope<WorkbenchSettings>
  directory: WorkbenchDirectory
}

export type PatchableV4Scope = SettingsScope<WorkbenchSettingsV4>

function blankWorkbenchDocument(): WorkbenchDocumentV3 {
  const document = migrateDocumentV2ToV3(defaultLayout())
  if (document.root.kind !== 'area') return document
  return {
    ...document,
    root: {
      ...document.root,
      moduleHistory: document.root.moduleHistory.map((module, index) => index === 0
        ? { ...module, editorId: 'workbench.conversation.start', lastKnownTitle: '新建对话' }
        : module),
    },
  }
}

function nameKey(name: string): string {
  return name.trim().normalize('NFKC').toLocaleLowerCase('zh-CN')
}

function acceptedName(name: string): string | undefined {
  const trimmed = name.trim()
  return trimmed.length === 0 ? undefined : trimmed
}

function uniqueName(base: string, occupiedNames: readonly string[]): string {
  const occupied = new Set(occupiedNames.map(nameKey))
  if (!occupied.has(nameKey(base))) return base
  for (let index = 2; ; index += 1) {
    const candidate = `${base} ${String(index)}`
    if (!occupied.has(nameKey(candidate))) return candidate
  }
}

function openIdsOf(value: WorkbenchSettingsV4): string[] {
  return value.openWorkbenchIds ?? Object.keys(value.workbenches).filter(id => value.workbenches[id]?.archivedAt === undefined)
}

function nextWorkbenchName(value: WorkbenchSettingsV4): string {
  const occupied = Object.values(value.workbenches).map(record => record.name)
  for (let index = Object.keys(value.workbenches).length + 1; ; index += 1) {
    const candidate = `工作台 ${String(index)}`
    if (!occupied.some(name => nameKey(name) === nameKey(candidate))) return candidate
  }
}

/**
 * Project the active v3 Workbench onto the mature visual reducer while all
 * durable writes remain v3 and project-neutral.
 * @param source - revision-aware v3 Settings scope.
 * @returns visual Settings projection and named Workbench directory.
 */
export function createProjectNeutralFrameSettings(
  source: PatchableV4Scope,
  options: { workbenchId?: string; isBrowserOwned?: (id: string) => boolean } = {},
): ProjectNeutralFrameSettings {
  // A companion is a pinned view, never a second directory or layout Store.
  const activeId = (value: WorkbenchSettingsV4): string => options.workbenchId ?? value.activeWorkbenchId
  let sourceSnapshot: SettingsScopeSnapshot<WorkbenchSettingsV4> | undefined
  let projectedSnapshot: SettingsScopeSnapshot<WorkbenchSettings> | undefined
  let directorySource: SettingsScopeSnapshot<WorkbenchSettingsV4> | undefined
  let directorySnapshot: WorkbenchDirectorySnapshot = { openWorkbenchIds: [], globalHiddenEditorIds: [], extensionConsents: {}, rows: [], invalidRows: [], templates: [] }
  let beforeLifecycleTransition: (() => Promise<boolean>) | undefined

  const project = (): SettingsScopeSnapshot<WorkbenchSettings> => {
    const next = source.getSnapshot()
    if (next === sourceSnapshot && projectedSnapshot !== undefined) return projectedSnapshot
    sourceSnapshot = next
    const value = next.value
    const active = value === undefined ? undefined : value.workbenches[activeId(value)]
    const projectedValue: WorkbenchSettings | undefined = value === undefined || active === undefined
      ? undefined
      : {
        version: 2,
        layouts: { ungrouped: projectDocumentV3ToLayoutV2(active.document) },
        invalidLayouts: value.invalidWorkbenches[activeId(value)] === undefined
          ? {}
          : { ungrouped: structuredClone(value.invalidWorkbenches[activeId(value)]) },
        sessionMarkers: structuredClone(value.sessionMarkers),
        ...(value.migrationRequired === true ? { migrationRequired: true } : {}),
      }
    projectedSnapshot = {
      ...next,
      value: projectedValue,
    }
    return projectedSnapshot
  }

  const patch = async (operation: SettingsScopePathOperation): Promise<SettingsScopePatchResult> => {
    const value = source.getSnapshot().value
    if (operation.path.length === 0) {
      if (value === undefined) return { status: 'unavailable' }
      const { migrationRequired: _migrationRequired, ...persisted } = value
      return patchWorkbenchSettings(source, { ...operation, operation: 'set', value: persisted }, { requireAtomic: true })
    }
    const [root, account, ...rest] = operation.path
    if (root === 'sessionMarkers') return patchWorkbenchSettings(source, operation, { requireAtomic: true })
    if (root === 'layouts' && account === 'ungrouped' && rest.length === 0) {
      if (operation.operation === 'unset') {
        if (value === undefined) return { status: 'unavailable' }
        return patchWorkbenchSettings(source, {
          operation: 'unset', path: ['workbenches', activeId(value)],
          ...(operation.expectedRevision === undefined ? {} : { expectedRevision: operation.expectedRevision }),
        })
      }
      const document = operation.value as WorkbenchLayoutDocument
      if (value !== undefined) {
        const active = value.workbenches[activeId(value)]
        if (active === undefined) return { status: 'unavailable' }
        return patchWorkbenchSettings(source, {
          operation: 'set', path: ['workbenches', activeId(value)],
          value: {
            ...active,
            document: migrateDocumentV2ToV3(document),
            updatedAt: Date.now(),
          },
          ...(operation.expectedRevision === undefined ? {} : { expectedRevision: operation.expectedRevision }),
        })
      }
      if (options.workbenchId !== undefined) return { status: 'unavailable' }
      const now = Date.now()
      const workbenchId = 'main'
      const initial: WorkbenchSettingsV4 = {
        version: 4,
        activeWorkbenchId: workbenchId,
        openWorkbenchIds: [workbenchId],
        workbenches: {
          [workbenchId]: {
            workbenchId, name: '主工作台', document: migrateDocumentV2ToV3(document),
            description: '', createdAt: now, updatedAt: now,
          },
        },
        invalidWorkbenches: {}, sessionMarkers: {}, globalHiddenEditorIds: [],
        layoutTemplates: {},
      }
      return patchWorkbenchSettings(source, {
        operation: 'set', path: [], value: initial,
        ...(operation.expectedRevision === undefined ? {} : { expectedRevision: operation.expectedRevision }),
      })
    }
    if (root === 'invalidLayouts' && account === 'ungrouped' && value !== undefined) {
      return patchWorkbenchSettings(source, {
        ...operation,
        path: ['invalidWorkbenches', activeId(value), ...rest],
      })
    }
    return { status: 'unavailable' }
  }

  const settings: SettingsScope<WorkbenchSettings> = {
    getSnapshot: project,
    subscribe: listener => source.subscribe(listener),
    set: async (field, value) => { await source.set(field, value) },
    unset: async (field) => { await source.unset(field) },
    patch,
  }
  const rootUpdate = (transform: (value: WorkbenchSettingsV4) => WorkbenchSettingsV4): Promise<WorkbenchDirectoryOperationResult> => {
    const snapshot = source.getSnapshot()
    const value = snapshot.value
    if (snapshot.status !== 'ready' || !snapshot.writable || value === undefined) return Promise.resolve({ status: 'unavailable' })
    const nextValue = transform(value)
    if (Object.entries(nextValue.workbenches).some(([id, record]) => record !== value.workbenches[id] && options.isBrowserOwned?.(id))
      || Object.keys(value.workbenches).some(id => nextValue.workbenches[id] === undefined && options.isBrowserOwned?.(id))) return Promise.resolve({ status: 'unavailable' })
    const { migrationRequired: _migrationRequired, ...persisted } = nextValue
    return patchWorkbenchSettings(source, { operation: 'set', path: [], value: persisted,
      ...(snapshot.revision === undefined ? {} : { expectedRevision: snapshot.revision }) })
      .catch(() => ({ status: 'unavailable' as const }))
  }
  const flush = async (): Promise<boolean> => {
    try { return beforeLifecycleTransition === undefined || await beforeLifecycleTransition() }
    catch { return false }
  }
  const guarded = async (changesActive: boolean, operation: () => Promise<WorkbenchDirectoryOperationResult>) => {
    if (changesActive && !(await flush())) return { status: 'unavailable' } as const
    return operation()
  }
  const fallbackFor = (value: WorkbenchSettingsV4, removedId: string): { activeWorkbenchId: string; openWorkbenchIds: string[] } | undefined => {
    const before = openIdsOf(value)
    const index = before.indexOf(removedId)
    const remaining = before.filter(id => id !== removedId)
    if (removedId !== value.activeWorkbenchId) return { activeWorkbenchId: value.activeWorkbenchId, openWorkbenchIds: remaining }
    const adjacent = before.slice(index + 1).find(id => id !== removedId) ?? before.slice(0, index).reverse().find(id => id !== removedId)
    if (adjacent !== undefined) return { activeWorkbenchId: adjacent, openWorkbenchIds: remaining }
    const inactive = Object.values(value.workbenches)
      .filter(record => record.workbenchId !== removedId && record.archivedAt === undefined && !before.includes(record.workbenchId))
      .sort((left, right) => right.updatedAt - left.updatedAt)[0]
    if (inactive === undefined) return undefined
    return { activeWorkbenchId: inactive.workbenchId, openWorkbenchIds: [...remaining, inactive.workbenchId] }
  }
  const directory: WorkbenchDirectory = {
    getSnapshot: () => {
      const next = source.getSnapshot()
      if (next === directorySource) return directorySnapshot
      directorySource = next
      directorySnapshot = {
        ...(next.value === undefined ? {} : { activeWorkbenchId: activeId(next.value) }),
        openWorkbenchIds: next.value === undefined ? [] : options.workbenchId === undefined ? openIdsOf(next.value) : [options.workbenchId],
        globalHiddenEditorIds: next.value === undefined
          ? []
          : [...(next.value.globalHiddenEditorIds ?? next.value.workbenches[activeId(next.value)]?.hiddenEditorIds ?? [])],
        extensionConsents: next.value === undefined ? {} : { ...(next.value.extensionConsents ?? {}) },
        rows: Object.values(next.value?.workbenches ?? {}).filter(record => options.workbenchId === undefined || record.workbenchId === options.workbenchId).map(record => ({
          workbenchId: record.workbenchId, name: record.name, description: record.description,
          ...(record.tags === undefined ? {} : { tags: [...record.tags] }),
          ...(record.hiddenEditorIds === undefined ? {} : { hiddenEditorIds: [...record.hiddenEditorIds] }),
          ...(record.layoutLocked === true ? { layoutLocked: true } : {}),
          createdAt: record.createdAt, updatedAt: record.updatedAt,
          ...(record.pinnedAt === undefined ? {} : { pinnedAt: record.pinnedAt }),
          ...(record.archivedAt === undefined ? {} : { archivedAt: record.archivedAt }),
        })),
        invalidRows: Object.values(next.value?.invalidWorkbenches ?? {}).filter(record => options.workbenchId === undefined || record.workbenchId === options.workbenchId).map(record => structuredClone(record)),
        templates: options.workbenchId !== undefined ? [] : [
          ...Object.values(next.value?.layoutTemplates ?? {})
            .map(record => ({ templateId: record.templateId, name: record.name })),
          ...Object.values(next.value?.workbenches ?? {})
            .filter(record => !openIdsOf(next.value!).includes(record.workbenchId) && record.archivedAt === undefined)
            .map(record => ({ templateId: record.workbenchId, name: record.name })),
        ]
          .sort((left, right) => left.name.localeCompare(right.name, 'zh-CN')),
      }
      return directorySnapshot
    },
    getDocument: (workbenchId) => {
      if (options.workbenchId !== undefined && workbenchId !== options.workbenchId) return undefined
      const record = source.getSnapshot().value?.workbenches[workbenchId]
      return record === undefined ? undefined : structuredClone(record.document)
    },
    subscribe: listener => source.subscribe(listener),
    select: async (workbenchId) => {
      if (options.workbenchId !== undefined) return { status: 'unavailable' }
      const current = source.getSnapshot().value
      return guarded(current?.activeWorkbenchId !== workbenchId, () => {
        const value = source.getSnapshot().value
        if (value === undefined || value.workbenches[workbenchId] === undefined
          || !openIdsOf(value).includes(workbenchId) || value.workbenches[workbenchId].archivedAt !== undefined) return Promise.resolve({ status: 'unavailable' })
        return rootUpdate(next => ({ ...next, activeWorkbenchId: workbenchId }))
      }) as Promise<SettingsScopePatchResult>
    },
    reorder: (workbenchId, targetIndex) => options.workbenchId !== undefined
      ? Promise.resolve({ status: 'unavailable' })
      : guarded(false, () => {
        const value = source.getSnapshot().value
        if (value === undefined) return Promise.resolve({ status: 'unavailable' })
        const open = openIdsOf(value)
        const currentIndex = open.indexOf(workbenchId)
        if (currentIndex < 0) return Promise.resolve({ status: 'rejected', reason: 'not-found' })
        const boundedIndex = Math.max(0, Math.min(Math.trunc(targetIndex), open.length - 1))
        if (boundedIndex === currentIndex) return Promise.resolve({ status: 'committed', revision: source.getSnapshot().revision ?? 0 })
        const next = open.filter(id => id !== workbenchId)
        next.splice(boundedIndex, 0, workbenchId)
        return rootUpdate(current => ({ ...current, openWorkbenchIds: next }))
      }),
    openAndSelect: (workbenchId) => options.workbenchId !== undefined ? Promise.resolve({ status: 'unavailable' }) : guarded(source.getSnapshot().value?.activeWorkbenchId !== workbenchId, () => {
      const value = source.getSnapshot().value
      if (value === undefined || value.workbenches[workbenchId] === undefined) return Promise.resolve({ status: 'rejected', reason: 'not-found' })
      if (value.workbenches[workbenchId].archivedAt !== undefined) return Promise.resolve({ status: 'rejected', reason: 'archived' })
      return rootUpdate(current => ({ ...current, activeWorkbenchId: workbenchId,
        openWorkbenchIds: openIdsOf(current).includes(workbenchId) ? openIdsOf(current) : [...openIdsOf(current), workbenchId] }))
    }),
    unload: (workbenchId) => options.workbenchId !== undefined ? Promise.resolve({ status: 'unavailable' }) : guarded(source.getSnapshot().value?.activeWorkbenchId === workbenchId, () => {
      const value = source.getSnapshot().value
      if (value === undefined || !openIdsOf(value).includes(workbenchId)) return Promise.resolve({ status: 'rejected', reason: 'not-found' })
      const fallback = fallbackFor(value, workbenchId)
      if (fallback === undefined) return Promise.resolve({ status: 'unavailable' })
      return rootUpdate(current => ({ ...current, ...fallback }))
    }),
    create: (createOptions) => options.workbenchId !== undefined ? Promise.resolve({ status: 'unavailable' }) : guarded(true, () => {
      const options = createOptions
      const snapshot = source.getSnapshot(); const value = snapshot.value
      if (snapshot.status !== 'ready' || !snapshot.writable || value === undefined) return Promise.resolve({ status: 'unavailable' })
      const template = options?.templateId === undefined ? undefined
        : value.layoutTemplates[options.templateId] ?? value.workbenches[options.templateId]
      if (options?.templateId !== undefined && template === undefined) return Promise.resolve({ status: 'rejected', reason: 'not-found' })
      const now = Date.now(); const workbenchId = `workbench-${globalThis.crypto.randomUUID()}`
      const name = template === undefined ? nextWorkbenchName(value) : uniqueName(template.name, Object.values(value.workbenches).map(record => record.name))
      return rootUpdate(current => ({ ...current, activeWorkbenchId: workbenchId, openWorkbenchIds: [...openIdsOf(current), workbenchId], workbenches: { ...current.workbenches, [workbenchId]: { workbenchId, name, description: '', document: template === undefined ? blankWorkbenchDocument() : cloneWorkbenchDocumentWithFreshIds(template.document), createdAt: now, updatedAt: now } } }))
    }),
    saveTemplate: (requestedName, document) => {
      if (options.workbenchId !== undefined) return Promise.resolve({ status: 'unavailable' })
      const value = source.getSnapshot().value
      if (value === undefined) return Promise.resolve({ status: 'unavailable' })
      const name = acceptedName(requestedName)
      if (name === undefined) return Promise.resolve({ status: 'rejected', reason: 'invalid-name' })
      if (Object.values(value.layoutTemplates).some(template => nameKey(template.name) === nameKey(name))
        || Object.values(value.workbenches).some(workbench => nameKey(workbench.name) === nameKey(name))) {
        return Promise.resolve({ status: 'rejected', reason: 'duplicate-name' })
      }
      const now = Date.now()
      const workbenchId = `saved-layout-${globalThis.crypto.randomUUID()}`
      return rootUpdate(current => ({
        ...current,
        workbenches: {
          ...current.workbenches,
          [workbenchId]: {
            workbenchId, name, description: '', document: migrateDocumentV2ToV3(document),
            createdAt: now, updatedAt: now,
          },
        },
      }))
    },
    /** Legacy entry point retained for callers compiled against V4; visibility
     * is now intentionally global regardless of the old workbench argument. */
    setEditorVisible: (_workbenchId, editorId, visible) => directory.setGlobalEditorVisible!(editorId, visible),
    setLayoutLocked: (workbenchId, locked) => {
      if (options.workbenchId !== undefined && options.workbenchId !== workbenchId) return Promise.resolve({ status: 'unavailable' })
      if (source.getSnapshot().value?.workbenches[workbenchId] === undefined) {
        return Promise.resolve({ status: 'rejected', reason: 'not-found' })
      }
      return rootUpdate(value => {
        const record = value.workbenches[workbenchId]
        if (record === undefined || record.layoutLocked === locked) return value
        const { layoutLocked: _previous, ...withoutLayoutLock } = record
        return {
          ...value,
          workbenches: {
            ...value.workbenches,
            [workbenchId]: { ...withoutLayoutLock, ...(locked ? { layoutLocked: true } : {}) },
          },
        }
      })
    },
    setGlobalEditorVisible: (editorId, visible) => {
      if (options.workbenchId !== undefined) return Promise.resolve({ status: 'unavailable' })
      const value = source.getSnapshot().value
      if (value === undefined) return Promise.resolve({ status: 'unavailable' })
      const hidden = value.globalHiddenEditorIds ?? []
      const next = decodeWorkbenchHiddenEditorIds(visible ? hidden.filter(id => id !== editorId) : [...hidden, editorId])
      if (next === undefined || decodeWorkbenchHiddenEditorIds([editorId]) === undefined) return Promise.resolve({ status: 'unavailable' })
      return rootUpdate(current => ({ ...current, globalHiddenEditorIds: next }))
    },
    setExtensionAllowed: (input, allowed) => {
      if (options.workbenchId !== undefined) return Promise.resolve({ status: 'unavailable' })
      const editorIds = input.editorIds ?? []
      if (typeof input.packageName !== 'string' || input.packageName.trim() === '' || input.packageName.length > 214
        || typeof input.moduleId !== 'string' || !/^[a-zA-Z0-9._:-]{1,128}$/u.test(input.moduleId)
        || !Number.isInteger(input.apiVersion) || input.apiVersion < 1
        || (allowed && (input.apiVersion !== 1 || editorIds.length === 0 || editorIds.length > 32
          || !editorIds.every(id => /^[a-zA-Z0-9._:-]{1,128}$/u.test(id))
          || new Set(editorIds).size !== editorIds.length
          || input.contractFingerprint === undefined || !/^[a-f0-9]{32}$/u.test(input.contractFingerprint)))) {
        return Promise.resolve({ status: 'unavailable' })
      }
      const key = workbenchExtensionConsentKey(input.packageName, input.moduleId)
      return rootUpdate(current => {
        const extensionConsents = { ...(current.extensionConsents ?? {}) }
        if (allowed) {
          const previous = extensionConsents[key]
          extensionConsents[key] = {
            packageName: input.packageName,
            moduleId: input.moduleId,
            apiVersion: 1,
            editorIds: [...new Set([...(previous?.editorIds ?? []), ...editorIds])].sort(),
            contractFingerprint: input.contractFingerprint!,
            allowedAt: Date.now(),
            allowed: true,
          }
        } else {
          // Keep the confirmed editor identity so existing layouts can explain
          // stale references after the user revokes Workbench access.
          const previous = extensionConsents[key]
          if (previous === undefined) delete extensionConsents[key]
          else extensionConsents[key] = {
            ...previous,
            editorIds: [...new Set([...previous.editorIds, ...editorIds])].sort(),
            allowed: false,
          }
        }
        return { ...current, extensionConsents }
      })
    },
    rename: (workbenchId, name) => directory.updateMetadata(workbenchId, { name, description: source.getSnapshot().value?.workbenches[workbenchId]?.description ?? '' }),
    updateMetadata: (workbenchId, requested) => {
      const value = source.getSnapshot().value; const current = value?.workbenches[workbenchId]
      if (value === undefined || current === undefined) return Promise.resolve({ status: 'rejected', reason: 'not-found' })
      const name = acceptedName(requested.name)
      if (name === undefined) return Promise.resolve({ status: 'rejected', reason: 'invalid-name' })
      if (Object.values(value.workbenches).some(record => record.workbenchId !== workbenchId && nameKey(record.name) === nameKey(name))) return Promise.resolve({ status: 'rejected', reason: 'duplicate-name' })
      return rootUpdate(next => {
        const existing = next.workbenches[workbenchId]
        if (existing === undefined) return next
        const { tags: previousTags, ...withoutTags } = existing
        const tags = normalizeWorkbenchTags(requested.tags ?? previousTags)
        return { ...next, workbenches: { ...next.workbenches, [workbenchId]: { ...withoutTags, name, description: requested.description.trim(), ...(tags.length === 0 ? {} : { tags }), updatedAt: Date.now() } } }
      })
    },
    setPinned: (workbenchId, pinned) => rootUpdate(value => {
      const record = value.workbenches[workbenchId]
      if (record !== undefined) {
        const { pinnedAt: _pinnedAt, ...withoutPinned } = record
        return { ...value, workbenches: { ...value.workbenches, [workbenchId]: pinned ? { ...record, pinnedAt: Date.now() } : withoutPinned } }
      }
      const invalid = value.invalidWorkbenches[workbenchId]
      if (invalid === undefined) return value
      const { pinnedAt: _pinnedAt, ...withoutPinned } = invalid
      return { ...value, invalidWorkbenches: { ...value.invalidWorkbenches, [workbenchId]: pinned ? { ...invalid, pinnedAt: Date.now() } : withoutPinned } }
    }),
    archive: (workbenchId) => options.workbenchId !== undefined ? Promise.resolve({ status: 'unavailable' }) : guarded(source.getSnapshot().value?.activeWorkbenchId === workbenchId, () => {
      const value = source.getSnapshot().value; const record = value?.workbenches[workbenchId]
      if (value === undefined) return Promise.resolve({ status: 'unavailable' })
      if (record === undefined) return rootUpdate(current => current.invalidWorkbenches[workbenchId] === undefined ? current : { ...current, invalidWorkbenches: { ...current.invalidWorkbenches, [workbenchId]: { ...current.invalidWorkbenches[workbenchId], archivedAt: Date.now() } } })
      if (record.archivedAt !== undefined) return Promise.resolve({ status: 'rejected', reason: 'archived' })
      if (Object.values(value.workbenches).filter(item => item.archivedAt === undefined).length <= 1) return Promise.resolve({ status: 'rejected', reason: 'last-runnable' })
      const fallback = openIdsOf(value).includes(workbenchId) ? fallbackFor(value, workbenchId) : undefined
      if (value.activeWorkbenchId === workbenchId && fallback === undefined) return Promise.resolve({ status: 'unavailable' })
      return rootUpdate(current => {
        const currentRecord = current.workbenches[workbenchId]
        if (currentRecord === undefined) return current
        return { ...current, ...fallback, workbenches: { ...current.workbenches, [workbenchId]: { ...currentRecord, archivedAt: Date.now() } } }
      })
    }),
    restore: (workbenchId) => rootUpdate(value => {
      const record = value.workbenches[workbenchId]
      if (record !== undefined) {
        if (record.archivedAt === undefined) return value
        const { archivedAt: _archivedAt, ...withoutArchived } = record
        return { ...value, workbenches: { ...value.workbenches, [workbenchId]: withoutArchived } }
      }
      const invalid = value.invalidWorkbenches[workbenchId]
      if (invalid === undefined || invalid.archivedAt === undefined) return value
      const { archivedAt: _archivedAt, ...withoutArchived } = invalid
      return { ...value, invalidWorkbenches: { ...value.invalidWorkbenches, [workbenchId]: withoutArchived } }
    }),
    remove: (workbenchId) => {
      const value = source.getSnapshot().value
      if (value === undefined) return Promise.resolve({ status: 'unavailable' })
      if (openIdsOf(value).includes(workbenchId)) return Promise.resolve({ status: 'rejected', reason: 'still-open' })
      const record = value.workbenches[workbenchId]
      if (record !== undefined && record.archivedAt === undefined && Object.values(value.workbenches).filter(item => item.archivedAt === undefined).length <= 1) return Promise.resolve({ status: 'rejected', reason: 'last-runnable' })
      if (record === undefined && value.invalidWorkbenches[workbenchId] === undefined) return Promise.resolve({ status: 'rejected', reason: 'not-found' })
      return rootUpdate(current => { const { [workbenchId]: _valid, ...workbenches } = current.workbenches; const { [workbenchId]: _invalid, ...invalidWorkbenches } = current.invalidWorkbenches; return { ...current, workbenches, invalidWorkbenches } })
    },
    setBeforeLifecycleTransition: listener => {
      beforeLifecycleTransition = listener
      return () => { if (beforeLifecycleTransition === listener) beforeLifecycleTransition = undefined }
    },
    flushBeforeLifecycleTransition: flush,
    close: workbenchId => directory.unload(workbenchId),
  }
  // Scope checks run at invocation and after lifecycle flush, rather than
  // trusting whether a settings button happened to be disabled at render time.
  for (const method of ['updateMetadata', 'rename', 'setPinned', 'archive', 'restore', 'remove', 'unload', 'reorder'] as const) {
    const original = directory[method]
    if (original === undefined) continue
    Object.assign(directory, { [method]: (...args: [string, ...unknown[]]) => {
      if ((options.workbenchId !== undefined && (args[0] !== options.workbenchId || ['setPinned', 'archive', 'restore', 'remove', 'unload', 'reorder'].includes(method)))
        || options.isBrowserOwned?.(args[0]) === true) return Promise.resolve({ status: 'unavailable' })
      return (original as (...values: unknown[]) => Promise<WorkbenchDirectoryOperationResult>)(...args)
    } })
  }
  return { settings, directory }
}
