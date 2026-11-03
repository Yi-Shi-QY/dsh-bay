import { validateWorkbenchCompositionPackageV2, type WorkbenchCompositionPackageV2 } from './composition-package.ts'
import type { WorkbenchModuleIdentityV1 } from './module-catalog.ts'
import type { WorkbenchModuleInstallPlanV1, WorkbenchModuleInstallVerificationV1 } from './install-plan.ts'
import type { WorkbenchModuleReceiptStoreV1, WorkbenchModuleReceiptStateV1, WorkbenchModuleReceiptV1 } from './module-receipt.ts'
import type { WorkbenchInstallTransactionJournalV1 } from './transaction-journal.ts'

export interface WorkbenchInstallConflictV1 { readonly moduleId: string; readonly installed: { readonly version: string; readonly artifactDigest: string }; readonly requested: { readonly version: string; readonly artifactDigest: string } }
export interface WorkbenchInstallPreflightResultV1 { readonly ok: boolean; readonly blockers: readonly string[]; readonly missingModules: readonly string[]; readonly conflicts: readonly WorkbenchInstallConflictV1[] }
export type WorkbenchModuleVerificationInputV1 = WorkbenchModuleInstallVerificationV1 | WorkbenchModuleIdentityV1

/**
 * The adapter is Host-owned. Browser Modules never receive it and cannot
 * invoke the Profile package manager, artifact store or verifier directly.
 */
export interface WorkbenchModuleInstallAdapterV1 {
  readonly capabilities: () => readonly string[]
  readonly installed: (moduleId: string) => { version: string; artifactDigest: string } | undefined
  readonly stage: (module: WorkbenchModuleIdentityV1) => Promise<void>
  readonly unstage?: (module: WorkbenchModuleIdentityV1) => Promise<void>
  readonly install: (module: WorkbenchModuleIdentityV1) => Promise<void>
  readonly repair?: (module: WorkbenchModuleIdentityV1) => Promise<void>
  /** Records ownership of an already installed, exactly verified package. */
  readonly claim?: (module: WorkbenchModuleIdentityV1) => Promise<void>
  /** Removes only an ownership marker written by a failed claim transaction. */
  readonly unclaim?: (moduleId: string) => Promise<void>
  /** Validates installed package manifest, editor IDs, scope and provenance. */
  readonly verify: (module: WorkbenchModuleVerificationInputV1) => Promise<void>
  /** Called only by a coordinator re-created after DSH restarts. */
  readonly activate: (moduleId: string) => Promise<void>
  readonly rollback: (moduleId: string) => Promise<void>
}

export type WorkbenchInstallTransactionStateV1 = 'staged' | 'restart-required' | 'verifying' | 'active' | 'rolling-back' | 'rolled-back' | 'failed'
export interface WorkbenchInstallTransactionSnapshotV1 {
  readonly transactionId: string
  readonly planId: string
  readonly state: WorkbenchInstallTransactionStateV1
  readonly stagedModules: readonly string[]
  readonly installedModules: readonly string[]
  readonly activatedModules: readonly string[]
  readonly error?: string
}
export interface WorkbenchModuleInstallCoordinatorOptionsV1 { readonly receipts?: WorkbenchModuleReceiptStoreV1; readonly journal?: WorkbenchInstallTransactionJournalV1; readonly now?: () => string }
export interface WorkbenchModuleInstallCoordinatorV1 {
  preflight(pkg: WorkbenchCompositionPackageV2): Promise<WorkbenchInstallPreflightResultV1>
  stage(pkg: WorkbenchCompositionPackageV2): Promise<{ transactionId: string }>
  stagePlan(plan: WorkbenchModuleInstallPlanV1, transactionId?: string, repair?: readonly WorkbenchModuleIdentityV1[], claim?: readonly WorkbenchModuleIdentityV1[]): Promise<{ transactionId: string }>
  install(transactionId: string): Promise<void>
  /** V1 has no in-process activation or Dynamic Loader. */
  activate(transactionId: string, options: { workspaceId?: string; explicitRecipientBinding: boolean }): Promise<never>
  /** Must run after a renderer/DSH restart from a durable journal record. */
  verifyAfterRestart(transactionId: string): Promise<void>
  rollback(transactionId: string): Promise<void>
  getTransaction(transactionId: string): WorkbenchInstallTransactionSnapshotV1 | undefined
  recoverableTransactions(): readonly WorkbenchInstallTransactionSnapshotV1[]
}

type ModuleRef = WorkbenchModuleIdentityV1
type Transaction = {
  transactionId: string
  planId: string
  modules: ModuleRef[]
  verification: WorkbenchModuleInstallVerificationV1[]
  installTargets: ModuleRef[]
  claimTargets: ModuleRef[]
  claimedTargets: string[]
  preservedReceipts: WorkbenchModuleReceiptV1[]
  staged: string[]
  installed: string[]
  activated: string[]
  installCompleted: boolean
  rehydrated: boolean
  state: WorkbenchInstallTransactionStateV1
  error?: string
}

const identityEqual = (left: { readonly version: string; readonly artifactDigest: string }, right: ModuleRef): boolean => left.version === right.version && left.artifactDigest.toLowerCase() === right.artifactDigest.toLowerCase()
const terminal = (state: WorkbenchInstallTransactionStateV1): boolean => state === 'active' || state === 'rolled-back' || state === 'failed'

export function createWorkbenchModuleInstallCoordinator(adapter: WorkbenchModuleInstallAdapterV1, options: WorkbenchModuleInstallCoordinatorOptionsV1 = {}): WorkbenchModuleInstallCoordinatorV1 {
  const transactions = new Map<string, Transaction>()
  const completed = new Map<string, WorkbenchInstallTransactionSnapshotV1>()
  const all = (pkg: WorkbenchCompositionPackageV2): ModuleRef[] => [pkg.core, ...pkg.modules]
  const createTransactionId = (): string => `workbench-install-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  const now = options.now ?? (() => new Date().toISOString())
  const snapshot = (state: Transaction): WorkbenchInstallTransactionSnapshotV1 => ({
    transactionId: state.transactionId,
    planId: state.planId,
    state: state.state,
    stagedModules: [...state.staged],
    installedModules: [...state.installed],
    activatedModules: [...state.activated],
    ...(state.error === undefined ? {} : { error: state.error }),
  })
  const saveJournal = (state: Transaction): void => {
    options.journal?.save({
      transactionId: state.transactionId,
      snapshot: snapshot(state),
      modules: [...state.modules],
      verification: [...state.verification],
      installTargets: [...state.installTargets],
      claimTargets: [...state.claimTargets],
      claimedTargets: [...state.claimedTargets].map(moduleId => state.modules.find(module => module.moduleId === moduleId)).filter((module): module is ModuleRef => module !== undefined),
      preservedReceipts: [...state.preservedReceipts],
      installCompleted: state.installCompleted,
      updatedAt: now(),
    })
  }
  const saveCompleted = (state: Transaction): void => { const value = snapshot(state); completed.set(state.transactionId, value); saveJournal(state) }
  const saveReceipts = (state: Transaction, moduleIds: readonly string[], receiptState: WorkbenchModuleReceiptStateV1): void => {
    if (options.receipts === undefined) return
    for (const moduleId of moduleIds) {
      const module = state.modules.find(candidate => candidate.moduleId === moduleId)
      const verification = state.verification.find(candidate => candidate.moduleId === moduleId)
      if (module !== undefined) {
        const previous = options.receipts.get(moduleId)
        options.receipts.put({
          receiptId: `${state.planId}:${module.moduleId}`,
          planId: state.planId,
          moduleId: module.moduleId,
          version: module.version,
          artifactDigest: module.artifactDigest,
          state: receiptState,
          installedAt: previous?.installedAt ?? now(),
          ...(receiptState === 'active' ? { verifiedAt: now() } : {}),
          ...((state.claimTargets.some(target => target.moduleId === moduleId) || previous?.claimedFromExternal) ? { claimedFromExternal: true } : {}),
          ...(verification === undefined ? {} : {
            verification,
            source: verification.origin ?? previous?.source ?? { kind: 'signed-catalog', catalogId: verification.catalogId, moduleId, version: module.version, artifactDigest: module.artifactDigest },
            trust: (verification.origin ?? previous?.source)?.kind === 'npm' || (verification.origin ?? previous?.source)?.kind === 'git'
              ? receiptState === 'active' ? 'runtime-verified' : 'user-approved-unverified' : 'catalog-verified',
            provenance: { source: verification.origin?.kind ?? `signed-local-catalog:${verification.catalogId}`, upstreamCommit: verification.provenance.upstreamCommit, patchDigest: verification.provenance.patchDigest },
          }),
        })
      }
    }
  }
  const transition = (state: Transaction, next: WorkbenchInstallTransactionStateV1): void => {
    const current = state.state
    const allowed = current === 'staged' ? next === 'restart-required' || next === 'rolling-back'
      : current === 'restart-required' ? next === 'verifying' || next === 'rolling-back'
        : current === 'verifying' ? next === 'active' || next === 'rolling-back'
          : current === 'active' ? next === 'rolling-back'
            : current === 'rolling-back' ? next === 'rolled-back' || next === 'failed'
              : false
    if (!allowed) throw new Error(`Invalid Workbench transaction transition: ${current} → ${next}`)
    state.state = next
    saveJournal(state)
  }
  const createTransaction = (planId: string, modules: readonly ModuleRef[], installTargets: readonly ModuleRef[], verification: readonly WorkbenchModuleInstallVerificationV1[] = [], transactionId?: string, preservedReceipts: readonly WorkbenchModuleReceiptV1[] = [], claimTargets: readonly ModuleRef[] = []): { transactionId: string; state: Transaction } => {
    const id = transactionId ?? createTransactionId()
    if (transactions.has(id) || completed.has(id) || options.journal?.get(id) !== undefined) throw new Error('Workbench install transaction identity already exists')
    const state: Transaction = { transactionId: id, planId, modules: [...modules], verification: [...verification], installTargets: [...installTargets], claimTargets: [...claimTargets], claimedTargets: [], preservedReceipts: [...preservedReceipts], staged: [], installed: [], activated: [], installCompleted: false, rehydrated: false, state: 'staged' }
    transactions.set(id, state)
    saveJournal(state)
    return { transactionId: id, state }
  }
  const preflight = async (pkg: WorkbenchCompositionPackageV2): Promise<WorkbenchInstallPreflightResultV1> => {
    validateWorkbenchCompositionPackageV2(pkg)
    const capabilities = new Set(adapter.capabilities())
    const blockers = [...new Set(pkg.runtimeRequirements.capabilities)].filter(capability => !capabilities.has(capability)).map(capability => `missing capability: ${capability}`)
    const missingModules: string[] = []
    const conflicts: WorkbenchInstallConflictV1[] = []
    for (const module of all(pkg)) {
      const installed = adapter.installed(module.moduleId)
      if (installed === undefined) missingModules.push(module.moduleId)
      else if (!identityEqual(installed, module)) conflicts.push({ moduleId: module.moduleId, installed, requested: module })
    }
    return { ok: blockers.length === 0 && conflicts.length === 0, blockers: [...blockers, ...conflicts.map(conflict => `module identity conflict: ${conflict.moduleId}`)], missingModules, conflicts }
  }
  const rollback = async (transactionId: string): Promise<void> => {
    let state = transactions.get(transactionId)
    if (state === undefined) {
      const record = options.journal?.get(transactionId)
      if (record?.snapshot.state === 'active' && record.modules !== undefined && record.installTargets !== undefined) {
        state = { transactionId, planId: record.snapshot.planId, modules: [...record.modules], verification: [...(record.verification ?? [])],
          installTargets: [...record.installTargets], claimTargets: [...(record.claimTargets ?? [])], claimedTargets: [...(record.claimedTargets ?? [])].map(module => module.moduleId), preservedReceipts: [...(record.preservedReceipts ?? [])], staged: [...record.snapshot.stagedModules], installed: [...record.snapshot.installedModules],
          activated: [...record.snapshot.activatedModules], installCompleted: true, rehydrated: true, state: 'active' }
        transactions.set(transactionId, state)
      }
    }
    if (state === undefined) {
      const previous = completed.get(transactionId) ?? options.journal?.get(transactionId)?.snapshot
      if (previous?.state === 'rolled-back') return
      throw new Error(`Unknown or terminal Workbench transaction: ${transactionId}`)
    }
    if (state.state === 'rolled-back') return
    if (state.state !== 'rolling-back') transition(state, 'rolling-back')
    const cleanupErrors: string[] = []
    // Only modules installed by this transaction can be removed. Exact-identity
    // reuse is represented by installTargets exclusion and is never rolled back.
    for (const moduleId of [...new Set(state.installed)].reverse()) {
      if (state.preservedReceipts.some(receipt => receipt.moduleId === moduleId)) continue
      try { await adapter.rollback(moduleId) } catch (error) { cleanupErrors.push(`${moduleId}: ${error instanceof Error ? error.message : String(error)}`) }
    }
    // A claim never owns or removes the Profile package. If the transaction
    // fails after writing its ownership marker, remove only that marker so a
    // later scan returns to the explicit-claim state.
    if (adapter.unclaim !== undefined) {
      for (const module of state.claimTargets.filter(module => state.claimedTargets.includes(module.moduleId)).slice().reverse()) {
        try { await adapter.unclaim(module.moduleId) } catch (error) { cleanupErrors.push(`unclaim ${module.moduleId}: ${error instanceof Error ? error.message : String(error)}`) }
      }
    }
    if (adapter.unstage !== undefined) {
      for (const module of state.installTargets.filter(candidate => state.staged.includes(candidate.moduleId) && !state.preservedReceipts.some(receipt => receipt.moduleId === candidate.moduleId)).reverse()) {
        try { await adapter.unstage(module) } catch (error) { cleanupErrors.push(`unstage ${module.moduleId}: ${error instanceof Error ? error.message : String(error)}`) }
      }
    }
    if (cleanupErrors.length > 0) {
      state.error = [state.error, `rollback cleanup failed: ${cleanupErrors.join('; ')}`].filter(Boolean).join(' | ')
      // Keep failed cleanup recoverable across process restarts.
      saveCompleted(state)
      throw new Error(state.error)
    }
    saveReceipts(state, [...new Set([...state.staged, ...state.installed, ...state.activated, ...state.claimedTargets])].filter(moduleId => !state.preservedReceipts.some(receipt => receipt.moduleId === moduleId)), 'rolled-back')
    for (const receipt of state.preservedReceipts) options.receipts?.put(receipt)
    transition(state, 'rolled-back')
    saveCompleted(state)
    transactions.delete(transactionId)
  }
  const failAndRollback = async (state: Transaction, error: unknown): Promise<void> => {
    state.error = error instanceof Error ? error.message : String(error)
    try { await rollback(state.transactionId) } catch (cleanupError) {
      if (state.state !== 'failed' && cleanupError instanceof Error) state.error = `${state.error} | ${cleanupError.message}`
    }
  }

  for (const record of options.journal?.list() ?? []) {
    if (terminal(record.snapshot.state)) { completed.set(record.transactionId, record.snapshot); continue }
    if (record.modules === undefined || record.installTargets === undefined) { completed.set(record.transactionId, record.snapshot); continue }
    transactions.set(record.transactionId, {
      transactionId: record.transactionId,
      planId: record.snapshot.planId,
      modules: [...record.modules],
      verification: [...(record.verification ?? [])],
      installTargets: [...record.installTargets],
      claimTargets: [...(record.claimTargets ?? [])],
      claimedTargets: [...(record.claimedTargets ?? [])].map(module => module.moduleId),
      preservedReceipts: [...(record.preservedReceipts ?? [])],
      staged: [...record.snapshot.stagedModules],
      installed: [...record.snapshot.installedModules],
      activated: [...record.snapshot.activatedModules],
      installCompleted: record.installCompleted ?? record.snapshot.state === 'restart-required',
      rehydrated: true,
      state: record.snapshot.state,
      ...(record.snapshot.error === undefined ? {} : { error: record.snapshot.error }),
    })
  }

  return {
    preflight,
    async stage(pkg) {
      const check = await preflight(pkg)
      if (!check.ok) throw new Error(`Workbench preflight blocked: ${check.blockers.join(', ')}`)
      const modules = all(pkg)
      const installTargets = modules.filter(module => adapter.installed(module.moduleId) === undefined)
      const created = createTransaction(`legacy-composition:${Date.now().toString(36)}`, modules, installTargets)
      try {
        for (const module of installTargets) { await adapter.stage(module); created.state.staged.push(module.moduleId); saveJournal(created.state) }
      } catch (error) { await failAndRollback(created.state, error); throw error }
      saveReceipts(created.state, created.state.staged, 'staged')
      saveCompleted(created.state)
      return { transactionId: created.transactionId }
    },
    async stagePlan(plan, transactionId, repair = [], claim = []) {
      if (plan.status !== 'ready') throw new Error(`Workbench install plan blocked: ${plan.blockers.map(blocker => blocker.message).join(', ') || 'unknown blocker'}`)
      const preservedReceipts = repair.map(module => {
        const receipt = options.receipts?.get(module.moduleId)
        if (adapter.repair === undefined || receipt === undefined || !identityEqual(receipt, module)
          || !plan.reused.some(reused => reused.moduleId === module.moduleId && identityEqual(reused, module))) throw new Error('Workbench exact repair lacks an owned matching identity')
        return receipt
      })
      const targets = [...plan.toInstall, ...repair]
      const created = createTransaction(plan.planId, plan.resolved, targets, plan.verification, transactionId, preservedReceipts, claim)
      try {
        for (const module of targets) { await adapter.stage(module); created.state.staged.push(module.moduleId); saveJournal(created.state) }
      } catch (error) { await failAndRollback(created.state, error); throw error }
      saveReceipts(created.state, created.state.staged, 'staged')
      // An old rolled-back claim must enter staged before a fresh ownership
      // receipt can advance to restart-required.
      saveReceipts(created.state, claim.map(module => module.moduleId), 'staged')
      saveCompleted(created.state)
      return { transactionId: created.transactionId }
    },
    async install(id) {
      const state = transactions.get(id)
      if (state === undefined) {
        const previous = completed.get(id) ?? options.journal?.get(id)?.snapshot
        if (previous?.state === 'restart-required' || previous?.state === 'active') return
        throw new Error(`Unknown Workbench install transaction: ${id}`)
      }
      if (state.state === 'restart-required' || state.state === 'active') return
      if (state.state !== 'staged') throw new Error(`Invalid Workbench install transition from ${state.state}`)
      if (state.staged.length !== state.installTargets.length) throw new Error('Workbench install transaction has not completed staging')
      try {
        for (const module of state.installTargets) {
          const installed = adapter.installed(module.moduleId)
          const repairing = state.preservedReceipts.some(receipt => receipt.moduleId === module.moduleId)
          if (installed !== undefined && !identityEqual(installed, module)) throw new Error(`Workbench module identity conflict: ${module.moduleId}`)
          if (installed !== undefined && !repairing) continue
          // Record rollback ownership before the installer can partially
          // modify Profile state or the process can stop during installation.
          if (!state.installed.includes(module.moduleId)) state.installed.push(module.moduleId)
          saveJournal(state)
          if (repairing) {
            if (adapter.repair === undefined) throw new Error('Workbench exact repair service is unavailable')
            await adapter.repair(module)
          } else await adapter.install(module)
        }
        for (const module of state.claimTargets) {
          if (adapter.claim === undefined) throw new Error('Workbench Module claim service is unavailable')
          const verification = state.verification.find(candidate => candidate.moduleId === module.moduleId)
          await adapter.verify(verification ?? module)
          await adapter.claim(module)
          state.claimedTargets.push(module.moduleId)
          saveJournal(state)
        }
        state.installCompleted = true
        // A recovered stage that installs in this process still needs a restart.
        state.rehydrated = false
        transition(state, 'restart-required')
        saveReceipts(state, state.modules.map(module => module.moduleId), 'restart-required')
        saveCompleted(state)
      } catch (error) { await failAndRollback(state, error); throw error }
    },
    async activate() { throw new Error('Workbench Module activation requires a DSH restart and post-restart verification') },
    async verifyAfterRestart(id) {
      const state = transactions.get(id)
      if (state === undefined) {
        if (completed.get(id)?.state === 'active') return
        throw new Error(`Unknown Workbench install transaction: ${id}`)
      }
      if (!state.rehydrated) throw new Error('Workbench Module activation requires a DSH restart and a rehydrated transaction')
      if (state.state !== 'restart-required' && state.state !== 'verifying') throw new Error(`Invalid Workbench post-restart verification transition from ${state.state}`)
      try {
        if (state.state === 'restart-required') transition(state, 'verifying')
        // The journal may have committed just before the receipt write was
        // interrupted. Artifact verification below remains authoritative.
        if (state.installCompleted) saveReceipts(state, state.modules.map(module => module.moduleId).filter(moduleId => options.receipts?.get(moduleId)?.state !== 'active'), 'restart-required')
        for (const module of state.modules) {
          const installed = adapter.installed(module.moduleId)
          if (installed === undefined || !identityEqual(installed, module)) throw new Error(`Workbench Module installed identity mismatch: ${module.moduleId}`)
          const verification = state.verification.find(candidate => candidate.moduleId === module.moduleId)
          await adapter.verify(verification ?? module)
        }
        for (const module of state.modules) { await adapter.activate(module.moduleId); state.activated.push(module.moduleId); saveJournal(state) }
        saveReceipts(state, state.modules.map(module => module.moduleId), 'active')
        transition(state, 'active')
        saveCompleted(state)
      } catch (error) { await failAndRollback(state, error); throw error }
    },
    rollback,
    getTransaction(id) { const state = transactions.get(id); return state === undefined ? completed.get(id) ?? options.journal?.get(id)?.snapshot : snapshot(state) },
    recoverableTransactions: () => [...transactions.values()].map(snapshot).filter(value => !terminal(value.state)),
  }
}
