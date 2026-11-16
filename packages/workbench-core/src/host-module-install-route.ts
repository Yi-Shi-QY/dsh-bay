/**
 * Host-only commit boundary for V1 team Modules.
 *
 * This module is deliberately unreachable from the browser entry. The browser
 * submits a complete signed archive; the Host derives every install fact from
 * those bytes again and owns staging, package installation and rollback.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type {
  WorkbenchInstallTransactionSnapshotV1,
  WorkbenchModuleInstallCoordinatorV1,
} from './install-coordinator.ts'
import { createWorkbenchModuleInstallPlan, type WorkbenchModuleInstallVerificationV1 } from './install-plan.ts'
import type { WorkbenchModuleIdentityV1 } from './module-catalog.ts'
import type { WorkbenchModuleReceiptStoreV1 } from './module-receipt.ts'
import {
  importWorkbenchSignedCatalogV1,
  type WorkbenchSignedCatalogImportOptionsV1,
} from './signed-catalog.ts'
import type { WorkbenchInstallTransactionJournalV1 } from './transaction-journal.ts'
import { WORKBENCH_MODULE_INSTALL_ROUTE_V1, type WorkbenchUserErrorCodeV2, type WorkbenchUserErrorV2 } from './browser-module-install.ts'

const MAX_ARCHIVE_BYTES = 64 * 1024 * 1024
const MAX_REQUEST_BYTES = Math.ceil(MAX_ARCHIVE_BYTES * 4 / 3) + 4096
const MODULE_ID = 'workbench.conversation-suite' as const

export interface WorkbenchHostCatalogArtifactStagerV1 {
  stage(input: {
    readonly moduleId: typeof MODULE_ID
    readonly version: string
    readonly artifactDigest: string
    readonly packageName: '@dsh-workbench/conversation-suite'
    readonly integrity: string
    readonly tarball: Uint8Array
  }): Promise<unknown>
}

export interface WorkbenchHostSignedCatalogInstallServiceOptionsV1 {
  readonly catalogImport: WorkbenchSignedCatalogImportOptionsV1
  readonly capabilities: () => readonly string[]
  readonly receipts: WorkbenchModuleReceiptStoreV1
  readonly journal: WorkbenchInstallTransactionJournalV1
  readonly artifactStager: WorkbenchHostCatalogArtifactStagerV1
  /** A Host-only adapter. It has the Profile package manager and verifier. */
  readonly coordinator: WorkbenchModuleInstallCoordinatorV1
  readonly retainCatalog?: (bytes: Uint8Array) => Promise<void>
  readonly verifyReusable?: (module: WorkbenchModuleInstallVerificationV1) => Promise<void>
  readonly verifyProfile?: (module: WorkbenchModuleInstallVerificationV1) => Promise<void>
  readonly operation?: 'install' | 'claim' | 'repair'
  readonly profileVersion?: () => string | undefined
}

function installedFromReceipts(receipts: WorkbenchModuleReceiptStoreV1): Map<string, WorkbenchModuleIdentityV1> {
  const rows = new Map<string, WorkbenchModuleIdentityV1>()
  for (const receipt of receipts.list()) {
    if (!['installed', 'restart-required', 'active'].includes(receipt.state)) continue
    rows.set(receipt.moduleId, {
      moduleId: receipt.moduleId,
      version: receipt.version,
      artifactDigest: receipt.artifactDigest,
    })
  }
  return rows
}

function exactRequest(value: unknown): { readonly moduleId: typeof MODULE_ID; readonly archive: Uint8Array; readonly operation?: 'install' | 'claim' | 'repair' } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Workbench Module install request is invalid')
  const row = value as Record<string, unknown>
  const expected = new Set(['schemaVersion', 'moduleId', 'catalogArchiveBase64', 'operation'])
  if (Object.keys(row).some(key => !expected.has(key))
    || row.schemaVersion !== 1 || row.moduleId !== MODULE_ID || typeof row.catalogArchiveBase64 !== 'string') {
    throw new Error('Workbench Module install request is invalid')
  }
  const encoded = row.catalogArchiveBase64
  if (row.operation !== undefined && row.operation !== 'install' && row.operation !== 'claim' && row.operation !== 'repair') throw new Error('Workbench Module install operation is invalid')
  if (encoded.length === 0 || encoded.length > MAX_REQUEST_BYTES || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(encoded)) {
    throw new Error('Workbench Module catalog archive encoding is invalid')
  }
  const archive = new Uint8Array(Buffer.from(encoded, 'base64'))
  if (archive.byteLength === 0 || archive.byteLength > MAX_ARCHIVE_BYTES || Buffer.from(archive).toString('base64') !== encoded) {
    throw new Error('Workbench Module catalog archive is invalid')
  }
  return { moduleId: MODULE_ID, archive, ...(row.operation === undefined ? {} : { operation: row.operation }) }
}

function publicSnapshot(snapshot: WorkbenchInstallTransactionSnapshotV1): WorkbenchInstallTransactionSnapshotV1 {
  return Object.freeze({
    transactionId: snapshot.transactionId,
    planId: snapshot.planId,
    state: snapshot.state,
    stagedModules: [...snapshot.stagedModules],
    installedModules: [...snapshot.installedModules],
    activatedModules: [...snapshot.activatedModules],
    ...(snapshot.error === undefined ? {} : { error: snapshot.error }),
  })
}

/** Creates the sole authoritative V1 signed-catalog installation operation. */
export function createWorkbenchHostSignedCatalogInstallService(
  options: WorkbenchHostSignedCatalogInstallServiceOptionsV1,
): { commit(input: { readonly moduleId: typeof MODULE_ID; readonly archive: Uint8Array; readonly operation?: 'install' | 'claim' | 'repair' }, onStaged?: (transactionId: string) => void): Promise<WorkbenchInstallTransactionSnapshotV1> } {
  return {
    async commit(input, onStaged) {
      if (input.moduleId !== MODULE_ID || input.archive.byteLength === 0 || input.archive.byteLength > MAX_ARCHIVE_BYTES) {
        throw new Error('Unsupported Workbench Module install request')
      }
      // The Host never accepts Catalog metadata constructed by the renderer.
      const imported = await importWorkbenchSignedCatalogV1(new Uint8Array(input.archive), options.catalogImport)
      const ownedInstalled = new Map(installedFromReceipts(options.receipts))
      const catalogEntry = imported.moduleCatalog.resolve({ moduleId: MODULE_ID })
      const profileVersion = options.profileVersion?.()
      const requestedOperation = input.operation ?? options.operation ?? 'install'
      if (requestedOperation === 'install' && profileVersion !== undefined && !ownedInstalled.has(MODULE_ID)) {
        throw new Error('Workbench Module profile identity conflict: an external package with the same name is already present')
      }
      if (profileVersion !== undefined && catalogEntry !== undefined && !ownedInstalled.has(MODULE_ID)) ownedInstalled.set(MODULE_ID, { moduleId: MODULE_ID, version: profileVersion, artifactDigest: catalogEntry.artifactDigest })
      const plan = createWorkbenchModuleInstallPlan({
        source: 'signed-local-catalog',
        requested: [{ moduleId: MODULE_ID }],
        catalog: imported.moduleCatalog,
        installed: ownedInstalled,
        capabilities: options.capabilities(),
      })
      if (plan.status !== 'ready' || plan.resolved.length !== 1 || plan.resolved[0]?.moduleId !== MODULE_ID) {
        throw new Error(plan.blockers[0]?.message ?? 'Workbench Module install plan is blocked')
      }
      const pending = options.journal.list().filter(record => !['active', 'rolled-back', 'failed'].includes(record.snapshot.state))
      if (pending.length > 0) {
        const identity = plan.resolved[0]
        const existing = pending.length === 1 ? pending[0] : undefined
        if (existing?.snapshot.state === 'restart-required' && existing.modules?.some(module => module.moduleId === identity.moduleId
          && module.version === identity.version && module.artifactDigest === identity.artifactDigest)) return publicSnapshot(existing.snapshot)
        throw new Error('transaction-recovery-required')
      }
      await options.retainCatalog?.(new Uint8Array(input.archive))
      const repair: WorkbenchModuleIdentityV1[] = []
      const claim: WorkbenchModuleIdentityV1[] = []
      if (requestedOperation === 'claim') {
        const identity = plan.resolved[0]
        if (identity === undefined || plan.toInstall.length > 0 || plan.reused.length === 0 || profileVersion !== identity.version) throw new Error('Workbench Module claim requires an exact existing identity')
        const verification = plan.verification.find(item => item.moduleId === MODULE_ID)
        const artifact = imported.artifact(identity)
        if (verification === undefined || artifact === undefined || options.verifyProfile === undefined) throw new Error('Workbench Module claim verifier is unavailable')
        // The artifact store is only a trusted verification cache here. This
        // does not run pnpm or replace the existing Profile package.
        await options.artifactStager.stage({
          moduleId: MODULE_ID,
          version: identity.version,
          artifactDigest: identity.artifactDigest,
          packageName: '@dsh-workbench/conversation-suite',
          integrity: verification.integrity,
          tarball: artifact,
        })
        await options.verifyProfile(verification)
        claim.push(identity)
      }
      if (plan.toInstall.length === 0) {
        const receipt = options.receipts.get(MODULE_ID)
        if ((receipt === undefined || receipt.state === 'rolled-back') && claim.length === 0) throw new Error('Workbench Module install plan has no install target')
        if ((receipt === undefined || receipt.state === 'rolled-back') && claim.length > 0) {
          const transactionId = `workbench-install-${crypto.randomUUID()}`
          onStaged?.(transactionId)
          const staged = claim.length === 0
            ? await options.coordinator.stagePlan(plan, transactionId)
            : await options.coordinator.stagePlan(plan, transactionId, [], claim)
          await options.coordinator.install(staged.transactionId)
          const transaction = options.coordinator.getTransaction(staged.transactionId)
          if (transaction?.state !== 'restart-required') throw new Error('Workbench Module claim did not reach restart-required state')
          return publicSnapshot(transaction)
        }
        if (receipt === undefined) throw new Error('Workbench Module install plan has no owned receipt')
        if (receipt.state === 'active') {
          if (options.verifyReusable === undefined || plan.verification[0] === undefined) throw new Error('Workbench installed artifact verifier is unavailable')
          try { await options.verifyReusable(plan.verification[0]) }
          catch { repair.push(...plan.reused) }
        }
        if (repair.length === 0 && receipt.state !== 'active') throw new Error('transaction-recovery-required')
        if (repair.length === 0) return publicSnapshot({
          transactionId: receipt.planId,
          planId: receipt.planId,
          state: receipt.state === 'active' ? 'active' : 'restart-required',
          stagedModules: [],
          installedModules: [],
          activatedModules: receipt.state === 'active' ? [MODULE_ID] : [],
        })
      }
      for (const identity of [...plan.toInstall, ...repair]) {
        const verification = plan.verification.find(item => item.moduleId === identity.moduleId)
        const artifact = imported.artifact(identity)
        if (verification === undefined || artifact === undefined || verification.packageName !== '@dsh-workbench/conversation-suite') {
          throw new Error('Signed Workbench Module artifact is unavailable')
        }
        await options.artifactStager.stage({
          moduleId: MODULE_ID,
          version: identity.version,
          artifactDigest: identity.artifactDigest,
          packageName: verification.packageName,
          integrity: verification.integrity,
          tarball: artifact,
        })
      }
      const transactionId = `workbench-install-${crypto.randomUUID()}`
      // Link the enclosing import before a Module transaction or Profile
      // install can be created. Recovery can distinguish an unstarted link.
      onStaged?.(transactionId)
      const staged = claim.length === 0
        ? await options.coordinator.stagePlan(plan, transactionId, repair)
        : await options.coordinator.stagePlan(plan, transactionId, repair, claim)
      await options.coordinator.install(staged.transactionId)
      const transaction = options.coordinator.getTransaction(staged.transactionId)
      if (transaction?.state !== 'restart-required') throw new Error('Workbench Module installation did not reach restart-required state')
      return publicSnapshot(transaction)
    },
  }
}

type HostWebServerV1 = {
  register(route: { kind: 'exact'; path: string; handler: (request: IncomingMessage, response: ServerResponse) => Promise<void> }): () => void
}

export interface WorkbenchHostSignedCatalogRouteContextV1 {
  get<T = unknown>(name: string, strict?: boolean): T | undefined
}

async function requestBytes(request: IncomingMessage): Promise<Uint8Array> {
  const chunks: Buffer[] = []
  let length = 0
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    length += bytes.byteLength
    if (length > MAX_REQUEST_BYTES) throw new Error('Workbench Module install request is too large')
    chunks.push(bytes)
  }
  return new Uint8Array(Buffer.concat(chunks, length))
}

function responseJson(response: ServerResponse, status: number, body: unknown): void {
  const bytes = Buffer.from(JSON.stringify(body), 'utf8')
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': bytes.byteLength,
    'cache-control': 'no-store',
  })
  response.end(bytes)
}

function userError(error: unknown): WorkbenchUserErrorV2 {
  const raw = error instanceof Error ? error.message : String(error)
  if (raw.includes('Profile already contains an unowned Workbench Module package') || raw.includes('claim requires')) {
    return { code: 'profile-unowned-module', message: '当前 Profile 中存在未由 Workbench 管理的同名内页模块，请先验证并认领，或使用原安装来源处理。', nextAction: '验证并认领，或从原安装来源卸载后重新检查。' }
  }
  if (raw.includes('identity conflict') || raw.includes('身份不一致')) {
    return { code: 'profile-identity-conflict', message: '当前 Profile 中的同名内页模块版本或摘要不匹配，Workbench 不会覆盖它。请使用原安装来源卸载或升级后重新检查。', nextAction: '使用原安装来源处理该扩展，然后返回此处重新检查。' }
  }
  if (raw.includes('verification') || raw.includes('manifest') || raw.includes('artifact')) {
    return { code: 'owned-module-not-verified', message: '内页模块文件或身份验证失败，未改变现有 Profile。请检查来源后重试。', nextAction: '检查来源和包完整性后重试。' }
  }
  if (raw.includes('restart')) return { code: 'restart-required', message: '操作已完成，必须重启 DSH 后才能激活内页模块。', nextAction: '在支持的 Manager 实例中执行一键安全重启。' }
  if (raw.includes('transaction') || raw.includes('recovery')) return { code: 'transaction-recovery-required', message: '已有安装事务需要恢复或重启，请先完成恢复后再操作。', nextAction: '恢复当前事务后再开始新的操作。' }
  if (raw.includes('catalog') || raw.includes('Catalog')) return { code: 'catalog-invalid', message: '扩展目录无效或未通过信任校验，请重新导入受信目录。', nextAction: '重新导入完整签名目录。' }
  const code: WorkbenchUserErrorCodeV2 = raw.includes('source') ? 'source-resolution-failed' : 'module-incompatible'
  return { code, message: code === 'source-resolution-failed' ? '无法解析所选来源，请检查网络、版本或仓库地址后重试。' : '当前内页模块无法在此 DSH 配置中安装，请检查兼容性和所需能力。', nextAction: '刷新状态并检查兼容性。' }
}

/** Installs only `/api/workbench/module-install/v1` on a Host WebServer. */
export function installWorkbenchHostSignedCatalogInstallRoute(
  ctx: WorkbenchHostSignedCatalogRouteContextV1,
  options: { readonly serviceName?: string } = {},
): (() => void) | undefined {
  // Core provides the installer from the same Host fiber immediately before
  // this function runs. During Cordis apply the fiber may still be pending,
  // so strict lookup would hide that service and skip route registration.
  const webServer = ctx.get<HostWebServerV1>('webServer', false)
  const service = ctx.get<ReturnType<typeof createWorkbenchHostSignedCatalogInstallService>>(options.serviceName ?? 'workbenchHostSignedCatalogInstaller', false)
  if (webServer === undefined || service === undefined) return undefined
  const dispose = webServer.register({
    kind: 'exact', path: WORKBENCH_MODULE_INSTALL_ROUTE_V1,
    handler: async (request, response) => {
      if (request.method !== 'POST') { responseJson(response, 405, { error: 'method-not-allowed' }); return }
      try {
        const input = exactRequest(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await requestBytes(request))))
        responseJson(response, 200, { schemaVersion: 1, transaction: await service.commit(input) })
      } catch (error) {
        // The response contains a policy reason only. Host paths, command
        // arguments and profile state never cross this boundary.
        const failure = userError(error)
        responseJson(response, 400, { error: failure.code, message: failure.message, nextAction: failure.nextAction, ...(failure.transactionId === undefined ? {} : { transactionId: failure.transactionId }), ...(failure.diagnosticId === undefined ? {} : { diagnosticId: failure.diagnosticId }) })
      }
    },
  })
  return dispose
}

export const WORKBENCH_MODULE_INSTALL_MAX_ARCHIVE_BYTES_V1 = MAX_ARCHIVE_BYTES
