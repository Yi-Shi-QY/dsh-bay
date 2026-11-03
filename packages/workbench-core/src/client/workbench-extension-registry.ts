import type { WorkbenchEditorCatalog, WorkbenchEditorCatalogRow } from '../foundation/catalog.ts'
import type { WorkbenchSettingsV4 } from '../foundation/persistence.ts'
import {
  resolveWorkbenchExtensionAccessV1,
  type WorkbenchDshExtensionInventoryV1,
  WorkbenchExtensionInventoryReadError,
  type WorkbenchExtensionInventoryFailureV1,
  type WorkbenchExtensionAccessSnapshotV1,
} from '../workbench-extension-access.ts'

export interface WorkbenchExtensionRegistryV1 {
  readonly catalog: WorkbenchEditorCatalog
  getSnapshot(): WorkbenchExtensionAccessSnapshotV1
  subscribe(listener: () => void): () => void
  refresh(): Promise<void>
  dispose(): void
}

/** Join live editor Slots to DSH's read-only bundle and Loader inventories. */
export function createWorkbenchExtensionRegistryV1(options: {
  readonly catalog: WorkbenchEditorCatalog
  readonly settings: { getSnapshot(): { value: WorkbenchSettingsV4 | undefined }; subscribe(listener: () => void): () => void }
  readonly coreEditorIds: readonly string[]
  readonly coreVersion: string
  readonly dshGeneration: string
  readonly readDshInventory?: () => Promise<WorkbenchDshExtensionInventoryV1>
  readonly subscribeDshChanges?: (listener: () => void) => () => void
  readonly subscribeConnectionReset?: (listener: () => void) => () => void
}): WorkbenchExtensionRegistryV1 {
  let dshInventory: WorkbenchDshExtensionInventoryV1 | undefined
  let inventoryFailures: readonly WorkbenchExtensionInventoryFailureV1[] = []
  let visibleEditors: readonly WorkbenchEditorCatalogRow[] = []
  let accessSnapshot: WorkbenchExtensionAccessSnapshotV1 = { status: 'unavailable', extensions: [] }
  let disposed = false
  let refreshGeneration = 0
  const listeners = new Set<() => void>()

  const recompute = (publish: boolean) => {
    const resolved = resolveWorkbenchExtensionAccessV1({
      editors: options.catalog.getSnapshot(),
      ...(dshInventory === undefined ? {} : { inventory: dshInventory }),
      consents: options.settings.getSnapshot().value?.extensionConsents ?? {},
      coreVersion: options.coreVersion,
      dshGeneration: options.dshGeneration,
      coreEditorIds: options.coreEditorIds,
    })
    // The resolver returns a minimal structural projection for the Host-safe
    // contract module; these are the same original Slot rows, already filtered.
    visibleEditors = resolved.editors as unknown as readonly WorkbenchEditorCatalogRow[]
    accessSnapshot = inventoryFailures.length === 0
      ? resolved.snapshot
      : { ...resolved.snapshot, inventoryFailures }
    if (publish) for (const listener of listeners) listener()
  }
  recompute(false)

  const registry: WorkbenchExtensionRegistryV1 = {
    catalog: {
      getSnapshot: () => visibleEditors,
      subscribe: listener => registry.subscribe(listener),
    },
    getSnapshot: () => accessSnapshot,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) },
    async refresh() {
      if (disposed) return
      const generation = ++refreshGeneration
      if (options.readDshInventory === undefined) {
        dshInventory = undefined
        recompute(true)
        return
      }
      try {
        const next = await options.readDshInventory()
        if (disposed || generation !== refreshGeneration) return
        dshInventory = next
        inventoryFailures = []
      } catch (error) {
        if (disposed || generation !== refreshGeneration) return
        dshInventory = undefined
        inventoryFailures = error instanceof WorkbenchExtensionInventoryReadError
          ? error.failures
          : [{
            operation: 'unknown',
            ...(typeof error === 'object' && error !== null && 'code' in error
              && typeof (error as { code?: unknown }).code === 'string'
              ? { code: (error as { code: string }).code.slice(0, 96) } : {}),
            message: (error instanceof Error ? error.message : String(error)).slice(0, 500),
          }]
      }
      recompute(true)
    },
    dispose() {
      if (disposed) return
      disposed = true
      refreshGeneration += 1
      offCatalog()
      offSettings()
      offDsh?.()
      offConnectionReset?.()
      listeners.clear()
    },
  }

  const onCatalogChange = () => {
    recompute(true)
    void registry.refresh()
  }
  const offCatalog = options.catalog.subscribe(onCatalogChange)
  const offSettings = options.settings.subscribe(() => recompute(true))
  const offDsh = options.subscribeDshChanges?.(() => { void registry.refresh() })
  const offConnectionReset = options.subscribeConnectionReset?.(() => { void registry.refresh() })
  void registry.refresh()
  return registry
}
