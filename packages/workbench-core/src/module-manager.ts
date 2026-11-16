import {
  importWorkbenchSignedCatalogV1,
  type WorkbenchSignedCatalogImportOptionsV1,
  type WorkbenchSignedCatalogImportV1,
} from './signed-catalog.ts'
import {
  createWorkbenchModuleInstallPlan,
  type WorkbenchModuleInstallPlanV1,
} from './install-plan.ts'
import type { WorkbenchModuleCatalogEntryV1, WorkbenchModuleIdentityV1 } from './module-catalog.ts'
import type { WorkbenchModuleInstallCoordinatorV1, WorkbenchInstallTransactionSnapshotV1 } from './install-coordinator.ts'
import { isWorkbenchUnchangedActiveInstall } from './browser-module-install.ts'
import type { WorkbenchModuleCenterBridgeV1, WorkbenchModuleCenterFactsV1, WorkbenchModuleInventoryV1 } from './browser-module-center.ts'
import { isWorkbenchRestartComplete, WorkbenchRestartError, type WorkbenchRestartAvailabilityV1, type WorkbenchRestartCompletionV1, type WorkbenchRestartStatusV1, type WorkbenchRestartObserverV1 } from './restart-contract.ts'
import type { WorkbenchModuleSourceRequestV1 } from './module-source.ts'

export type WorkbenchModuleManagerStateV1 = 'empty' | 'catalog-imported' | 'restart-required' | 'active'

export interface WorkbenchModuleManagerSnapshotV1 {
  readonly state: WorkbenchModuleManagerStateV1
  readonly catalogId?: string
  readonly entries: readonly WorkbenchModuleCatalogEntryV1[]
  readonly restartRequiredTransaction?: WorkbenchInstallTransactionSnapshotV1
  readonly host?: WorkbenchModuleCenterFactsV1
  readonly inventory?: readonly WorkbenchModuleInventoryV1[]
  readonly restartStatus?: WorkbenchRestartStatusV1
  readonly restartPending?: boolean
  readonly restartErrorCode?: WorkbenchRestartError['code']
  readonly restartAvailability?: WorkbenchRestartAvailabilityV1
  readonly error?: string
}

export interface WorkbenchModuleManagerV1 {
  getSnapshot(): WorkbenchModuleManagerSnapshotV1
  subscribe(listener: () => void): () => void
  refresh?(): Promise<void>
  /** Parses bytes selected by the user. It accepts no path, URL, or package name. */
  importCatalogArchive(bytes: Uint8Array): Promise<WorkbenchModuleManagerSnapshotV1>
  catalog(): readonly WorkbenchModuleCatalogEntryV1[]
  createInstallPlan(moduleId: 'workbench.conversation-suite'): WorkbenchModuleInstallPlanV1
  /** Stages and installs the exact catalog artifact; activation remains restart-only. */
  install(moduleId: 'workbench.conversation-suite'): Promise<WorkbenchInstallTransactionSnapshotV1>
  claim(moduleId: 'workbench.conversation-suite'): Promise<WorkbenchInstallTransactionSnapshotV1>
  /** Explicit advanced channel; the Host resolves npm/Git and owns all authority. */
  installDirectSource?(source: WorkbenchModuleSourceRequestV1, confirmSourceChange?: boolean): Promise<WorkbenchInstallTransactionSnapshotV1>
  update?(moduleId: string): Promise<WorkbenchInstallTransactionSnapshotV1>
  requestRestart?(): Promise<WorkbenchRestartCompletionV1>
  resumeRestart?(): Promise<void>
  readonly restartAvailable?: boolean
  readonly restartAvailability?: WorkbenchRestartAvailabilityV1
}

export interface WorkbenchModuleManagerOptionsV1 {
  readonly center?: WorkbenchModuleCenterBridgeV1
  /**
   * Used only by an embedded Host/test composition. A browser deployment must
   * provide `commitSignedCatalogInstall`, so the durable transaction remains
   * on the Host side of the process boundary.
   */
  readonly coordinator?: WorkbenchModuleInstallCoordinatorV1
  readonly capabilities: () => readonly string[]
  readonly installed: () => ReadonlyMap<string, WorkbenchModuleIdentityV1>
  readonly catalogImport?: WorkbenchSignedCatalogImportOptionsV1
  readonly importCatalog?: (bytes: Uint8Array, options: WorkbenchSignedCatalogImportOptionsV1) => Promise<WorkbenchSignedCatalogImportV1>
  /**
   * The only browser-to-Host handoff. It receives a signed catalog artifact
   * and immutable metadata, never a locator, path, package query, or URL.
   */
  readonly stageCatalogArtifact?: (input: {
    readonly identity: WorkbenchModuleIdentityV1
    readonly packageName: '@dsh-workbench/conversation-suite'
    readonly integrity: string
    readonly tarball: Uint8Array
  }) => Promise<void>
  /**
   * Fixed browser-to-Host handoff. The complete selected archive is sent so
   * the Host can independently verify the signature, catalog facts and
   * artifact bytes before it creates a durable transaction.
   */
  readonly commitSignedCatalogInstall?: (input: {
    readonly moduleId: 'workbench.conversation-suite'
    readonly archive: Uint8Array
    readonly operation?: 'install' | 'claim' | 'repair'
  }) => Promise<WorkbenchInstallTransactionSnapshotV1>
  readonly commitDirectSourceInstall?: (input: { readonly source: WorkbenchModuleSourceRequestV1; readonly confirmSourceChange?: boolean }) => Promise<WorkbenchInstallTransactionSnapshotV1>
  /** Manager-owned restart callback. A completion is returned only after the
   * replacement Run is ready and Workbench verification has succeeded. */
  readonly requestRestart?: (transactionId: string, onStatus: WorkbenchRestartObserverV1) => Promise<WorkbenchRestartCompletionV1>
  readonly resumeRestart?: (onStatus: WorkbenchRestartObserverV1) => Promise<WorkbenchRestartCompletionV1 | undefined>
  /** Host capability projection. If omitted, the presence of requestRestart implies available. */
  readonly restartAvailability?: () => WorkbenchRestartAvailabilityV1
}

function snapshot(
  state: WorkbenchModuleManagerStateV1,
  imported: WorkbenchSignedCatalogImportV1 | undefined,
  transaction: WorkbenchInstallTransactionSnapshotV1 | undefined,
): WorkbenchModuleManagerSnapshotV1 {
  return {
    state,
    ...(imported === undefined ? { entries: [] } : { catalogId: imported.catalog.catalogId, entries: imported.entries }),
    ...(transaction?.state !== 'restart-required' ? {} : { restartRequiredTransaction: transaction }),
  }
}

/**
 * Core-owned Module Manager. User-selected archive bytes enter here, while
 * package installation remains entirely in the Core transaction coordinator.
 */
export function createWorkbenchModuleManager(options: WorkbenchModuleManagerOptionsV1): WorkbenchModuleManagerV1 {
  let imported: WorkbenchSignedCatalogImportV1 | undefined
  let archive: Uint8Array | undefined
  let transaction: WorkbenchInstallTransactionSnapshotV1 | undefined
  let host: WorkbenchModuleCenterFactsV1 | undefined
  let error: string | undefined
  let restartStatus: WorkbenchRestartStatusV1 | undefined
  let restartPending = false
  let restartErrorCode: WorkbenchRestartError['code'] | undefined
  let restartPromise: Promise<WorkbenchRestartCompletionV1> | undefined
  let busy = false
  let refreshing = false
  const refreshWaiters: Array<() => void> = []
  const listeners = new Set<() => void>()
  let cachedSnapshot: WorkbenchModuleManagerSnapshotV1 = snapshot('empty', undefined, undefined)
  const publish = (): void => {
    cachedSnapshot = { ...snapshot(
      transaction === undefined ? (host?.activation === 'restart-required' ? 'restart-required'
        : host?.activation === 'active' ? 'active' : imported === undefined ? 'empty' : 'catalog-imported')
        : transaction.state === 'active' ? 'active' : 'restart-required',
      imported,
      transaction,
    ), ...(host === undefined ? {} : { host, inventory: host.inventory ?? [] }), ...(restartStatus === undefined ? {} : { restartStatus }), ...(restartPending ? { restartPending: true } : {}), ...(error === undefined ? {} : { error }) }
    if (restartErrorCode !== undefined) cachedSnapshot = { ...cachedSnapshot, restartErrorCode }
    cachedSnapshot = { ...cachedSnapshot, restartAvailability: restartAvailability() }
    for (const listener of [...listeners]) listener()
  }
  const current = (): WorkbenchModuleManagerSnapshotV1 => cachedSnapshot
  const planFor = (moduleId: 'workbench.conversation-suite'): WorkbenchModuleInstallPlanV1 => {
    if (imported === undefined) throw new Error('Workbench signed Module catalog is unavailable')
    return createWorkbenchModuleInstallPlan({
      source: 'signed-local-catalog',
      requested: [{ moduleId }],
      catalog: imported.moduleCatalog,
      capabilities: options.capabilities(),
      installed: host === undefined ? options.installed() : new Map(host.installed === undefined ? [] : [[host.installed.moduleId, host.installed]]),
      ...(host?.profileConflict === undefined ? {} : { profileConflict: host.profileConflict }),
    })
  }
  const restartAvailability = (): WorkbenchRestartAvailabilityV1 => {
    const capability = options.requestRestart === undefined ? 'unsupported' : options.restartAvailability?.() ?? 'available'
    if (capability !== 'available') return capability
    if (busy || restartPending) return 'busy'
    if (transaction?.transactionId === undefined && host?.restartTransactionId === undefined) return 'transaction-missing'
    return 'available'
  }
  const drainRefresh = async (): Promise<void> => {
    if (options.center === undefined || busy || restartPending || refreshing || refreshWaiters.length === 0) return
    refreshing = true
    try {
      while (refreshWaiters.length > 0 && !restartPending) {
        const waiters = refreshWaiters.splice(0)
        busy = true
        try {
          // Publish facts and Catalog together; a failed read must not retain
          // an old active identity after a native disable/remove operation.
          const nextHost = await options.center.facts()
          const bytes = nextHost.catalog === 'available' ? await options.center.archive() : undefined
          const result = bytes === undefined ? undefined : await (options.importCatalog ?? importWorkbenchSignedCatalogV1)(bytes, options.catalogImport ?? {})
          host = nextHost; imported = result; archive = bytes; transaction = undefined
          error = host.catalog === 'invalid' ? '已保存目录验证失败，请重新导入受信任目录。' : undefined
        } catch {
          error = '模块状态恢复失败，请刷新后重试。'
          host = undefined; imported = undefined; archive = undefined
          // Keep a pending restart transaction for recovery, but never an
          // active browser cache once the authoritative Host is unavailable.
          if (transaction?.state === 'active') transaction = undefined
        } finally {
          busy = false; publish()
          for (const resolve of waiters) resolve()
        }
      }
    } finally { refreshing = false }
  }
  const operationSettled = (): void => {
    busy = false
    publish()
    void drainRefresh()
  }
  return {
    restartAvailable: options.requestRestart !== undefined,
    get restartAvailability() { return restartAvailability() },
    getSnapshot: current,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener) } },
    refresh() {
      if (options.center === undefined) return Promise.resolve()
      // Native DSH emits changed before installBundle returns. Queue that
      // invalidation through our local operation instead of dropping it.
      const result = new Promise<void>(resolve => refreshWaiters.push(resolve))
      void drainRefresh()
      return result
    },
    async importCatalogArchive(bytes) {
      if (busy || restartPending || transaction?.state === 'restart-required' || host?.activation === 'restart-required') throw new Error('Workbench Module catalog cannot change while restart is required or an operation is pending')
      busy = true
      try {
        const importer = options.importCatalog ?? importWorkbenchSignedCatalogV1
        const owned = new Uint8Array(bytes)
        const result = await importer(owned, options.catalogImport ?? {})
        await options.center?.retain(owned)
        if (options.center !== undefined) host = await options.center.facts()
        imported = result
        transaction = undefined
        archive = owned
        error = undefined
        publish()
        return current()
      } finally { operationSettled() }
    },
    catalog: () => imported?.entries ?? [],
    createInstallPlan: planFor,
    async install(moduleId) {
      if (busy || restartPending) throw new Error('Workbench Module operation is pending')
      if (transaction?.state === 'active') return transaction
      if (transaction !== undefined) throw new Error('Workbench Module installation already requires a restart')
      const plan = planFor(moduleId)
      // A plan represents the signed catalog decision before the Host gets
      // any artifact authority. Blocked plans must never reach staging.
      if (plan.status !== 'ready') {
        throw new Error(`Workbench Module install plan blocked: ${plan.blockers.map(blocker => blocker.message).join('; ')}`)
      }
      if (options.commitSignedCatalogInstall !== undefined) {
        if (archive === undefined) throw new Error('Workbench signed Module catalog bytes are unavailable')
        busy = true
        try {
          const committed = await options.commitSignedCatalogInstall({ moduleId, archive: new Uint8Array(archive) })
          if (committed.state !== 'restart-required' && !isWorkbenchUnchangedActiveInstall(committed)) {
            throw new Error('Workbench Host Module installation did not reach restart-required state')
          }
          transaction = committed
          publish()
          return committed
        } finally { operationSettled() }
      }
      if (options.coordinator === undefined) {
        throw new Error('Workbench Host signed catalog install bridge is unavailable')
      }
      // planFor() proves this at the beginning of the operation. Keep a local
      // reference so TypeScript also preserves that invariant across awaits.
      const importedCatalog = imported
      if (importedCatalog === undefined) throw new Error('Workbench signed Module catalog is unavailable')
      const identity = plan.toInstall.find(candidate => candidate.moduleId === moduleId)
      if (identity !== undefined) {
        const entry = importedCatalog.moduleCatalog.get(identity.moduleId, identity.version, identity.artifactDigest)
        const signed = entry?.signedCatalog
        const artifact = importedCatalog.artifact(identity)
        if (entry === undefined || signed === undefined || artifact === undefined) {
          throw new Error(`Workbench signed Module artifact is unavailable: ${moduleId}`)
        }
        if (options.stageCatalogArtifact === undefined) {
          throw new Error('Workbench Host artifact staging bridge is unavailable')
        }
        // The Host repeats digest and integrity verification before Core
        // creates a transaction. Exact reuse deliberately skips this upload:
        // the coordinator records a durable no-op repair transaction instead.
        await options.stageCatalogArtifact({
          identity,
          packageName: signed.packageName as '@dsh-workbench/conversation-suite',
          integrity: signed.integrity,
          tarball: new Uint8Array(artifact),
        })
      } else if (!plan.reused.some(candidate => candidate.moduleId === moduleId)) {
        throw new Error(`Workbench Module install plan did not resolve ${moduleId}`)
      }
      const staged = await options.coordinator.stagePlan(plan)
      await options.coordinator.install(staged.transactionId)
      transaction = options.coordinator.getTransaction(staged.transactionId)
      if (transaction?.state !== 'restart-required') throw new Error('Workbench Module installation did not reach restart-required state')
      publish()
      return transaction
    },
    async claim(moduleId) {
      if (busy || restartPending || transaction !== undefined) throw new Error('Workbench Module operation is pending or requires a restart')
      if (archive === undefined) throw new Error('Workbench signed Module catalog bytes are unavailable')
      if (options.commitSignedCatalogInstall === undefined) throw new Error('Workbench Host signed catalog claim bridge is unavailable')
      busy = true
      try {
        const committed = await options.commitSignedCatalogInstall({ moduleId, archive: new Uint8Array(archive), operation: 'claim' })
        if (committed.state !== 'restart-required') throw new Error('Workbench Module claim did not reach restart-required state')
        transaction = committed
        publish()
        return committed
      } finally { operationSettled() }
    },
    ...(options.commitDirectSourceInstall === undefined ? {} : {
      installDirectSource: async (source: WorkbenchModuleSourceRequestV1, confirmSourceChange = false) => {
        if (busy || restartPending || transaction !== undefined) throw new Error('Workbench Module operation is pending or requires a restart')
        busy = true; error = undefined; publish()
        try {
          const committed = await options.commitDirectSourceInstall!({ source, confirmSourceChange })
          if (committed.state !== 'restart-required' && !isWorkbenchUnchangedActiveInstall(committed)) throw new Error('Workbench direct-source install did not reach restart-required state')
          transaction = committed; publish(); return committed
        } finally { operationSettled() }
      },
    }),
    async resumeRestart() {
      if (restartPending || busy || options.resumeRestart === undefined) return
      restartPending = true; restartErrorCode = undefined; restartStatus = undefined; publish()
      try {
        const result = await options.resumeRestart(status => { restartStatus = status; publish() })
        if (result !== undefined) {
          if (result.status.transactionId !== result.transactionId || result.status.operationId !== result.operationId || !isWorkbenchRestartComplete(result.status)) throw new WorkbenchRestartError('restart-failed')
          restartStatus = result.status
        }
      } catch (reason) {
        const failure = reason instanceof WorkbenchRestartError ? reason : new WorkbenchRestartError('restart-failed')
        error = failure.message; restartErrorCode = failure.code
      }
      finally { restartPending = false; publish(); void drainRefresh() }
    },
    async requestRestart() {
      if (restartPromise !== undefined) return restartPromise
      if (busy || restartPending) throw new WorkbenchRestartError('restart-busy')
      const transactionId = transaction?.transactionId ?? host?.restartTransactionId
      if (transactionId === undefined) throw new WorkbenchRestartError('transaction-missing')
      if (options.requestRestart === undefined) throw new WorkbenchRestartError('restart-unsupported')
      if (restartAvailability() !== 'available') throw new WorkbenchRestartError(restartAvailability() === 'busy' ? 'restart-busy' : 'restart-unsupported')
      restartPending = true; error = undefined; restartErrorCode = undefined; restartStatus = undefined; publish()
      restartPromise = Promise.resolve().then(() => options.requestRestart!(transactionId, status => { restartStatus = status; publish() })).then(result => {
        if (!result || result.transactionId !== transactionId || result.status.transactionId !== transactionId || result.status.operationId !== result.operationId || !isWorkbenchRestartComplete(result.status)) throw new WorkbenchRestartError('restart-failed')
        restartStatus = result.status
        return result
      }).catch(reason => {
        const failure = reason instanceof WorkbenchRestartError ? reason : new WorkbenchRestartError('restart-failed')
        error = failure.message
        restartErrorCode = failure.code
        throw failure
      }).finally(() => { restartPending = false; restartPromise = undefined; publish(); void drainRefresh() })
      return restartPromise
    },
  }
}
