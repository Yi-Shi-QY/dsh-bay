import { createHash, randomBytes } from 'node:crypto'
import { existsSync, realpathSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import type { HostWorkbenchDirectory } from './host-workbench-directory.ts'
import type { FileWorkbenchSnapshot } from './workbench-directory-contract.ts'
import { areasOf } from './foundation/document-v3.ts'
import { WORKBENCH_ACCESS_HEADER, WORKBENCH_GUEST_EDITORS, isGrantReduction, parseWorkbenchGrant, type WorkbenchAccessContext, type WorkbenchAccessTarget, type WorkbenchCapability, type WorkbenchGrant } from './workbench-access-contract.ts'

const hash = (token: string) => createHash('sha256').update(token).digest('hex')
const DESKTOP: WorkbenchAccessContext = Object.freeze({ actor: 'desktop', accessId: 'desktop' })
const ALL: readonly WorkbenchCapability[] = ['view', 'message', 'main-message', 'read-files', 'write-files', 'layout', 'context', 'tasks', 'memory', 'package']
type Lease = { context: WorkbenchAccessContext; active: () => boolean; tokenHash: string; writable?: (capability: WorkbenchCapability) => boolean }

export class WorkbenchAccessError extends Error {
  constructor(readonly code: string, message: string, readonly status = 403) { super(message) }
}

/** The Host owns access identities; transports never supply trusted role or grant fields. */
export class HostWorkbenchAccess {
  private readonly leases = new Map<string, Lease>()
  private readonly tokens = new Map<string, string>()
  private readonly owners = new Map<string, { accessId: string; epoch: number }>()
  private epoch = 0
  private readonly barriers = new Set<string>()
  private readonly writes = new Map<string, Set<Promise<unknown>>>()
  private readonly snapshotParticipants = new Set<(id: string) => Promise<() => void | Promise<void>>>()
  private readonly revokeListeners = new Set<(id: string) => void>()
  private readonly definitions = new Map<string, { stamp: string; valid: boolean }>()

  constructor(readonly directory: HostWorkbenchDirectory) {}

  lookup(workbenchId: string): boolean {
    const record = this.directory.getSnapshot().value.workbenches[workbenchId]
    if (!record || record.archivedAt !== undefined || typeof record.fileWorkbench?.rootPath !== 'string') return false
    try {
      const file = path.join(record.fileWorkbench.rootPath, '.bay', 'workbench.json'), stat = statSync(file)
      const stamp = [file, stat.mtimeMs, stat.ctimeMs, stat.size, stat.ino].join(':')
      const prior = this.definitions.get(workbenchId)
      if (prior?.stamp === stamp) return prior.valid
      const data = JSON.parse(readFileSync(file, 'utf8'))
      const valid = data?.schemaVersion === 1 && data.record?.workbenchId === workbenchId && data.record?.document?.version === 3
      this.definitions.set(workbenchId, { stamp, valid })
      return valid
    } catch { return false }
  }
  getRecord(workbenchId: string) {
    if (!this.lookup(workbenchId)) throw new WorkbenchAccessError('workbench-unavailable', '工作台目录丢失、已归档或定义损坏，请在 DSH 中检查目录和 .bay/workbench.json。', 404)
    return this.directory.getSnapshot().value.workbenches[workbenchId]!
  }
  sessionTarget(sessionId: string): WorkbenchAccessTarget | undefined {
    for (const record of Object.values(this.directory.getSnapshot().value.workbenches)) {
      const entry = Object.values(record.sessionCatalog ?? {}).find(row => row.sessionId === sessionId)
      if (entry) return { workbenchId: record.workbenchId, sessionId, ...(entry.areaId ? { areaId: entry.areaId } : {}) }
      if (record.bayAgentSession?.sessionId === sessionId) return { workbenchId: record.workbenchId, sessionId }
    }
    return undefined
  }
  private install(context: WorkbenchAccessContext, active: () => boolean, token = randomBytes(32).toString('base64url')) {
    this.revoke(context.accessId)
    const tokenHash = hash(token)
    this.leases.set(context.accessId, { context: Object.freeze(context), active, tokenHash })
    this.tokens.set(tokenHash, context.accessId)
    return token
  }
  registerOwner(accessId: string, workbenchId: string, active: () => boolean, token?: string, writable?: (capability: WorkbenchCapability) => boolean) {
    this.getRecord(workbenchId)
    const previous = this.owners.get(workbenchId)
    if (previous) this.revoke(previous.accessId)
    const epoch = ++this.epoch
    const credential = this.install({ actor: 'browser-owner', accessId, workbenchId, controlEpoch: epoch }, active, token)
    if (writable) this.leases.get(accessId)!.writable = writable
    this.owners.set(workbenchId, { accessId, epoch })
    return credential
  }
  registerGuest(accessId: string, workbenchId: string, grant: WorkbenchGrant, getActive: () => boolean) {
    this.getRecord(workbenchId)
    return this.install({ actor: 'lan-guest', accessId, workbenchId, grantRevision: 1, grant: parseWorkbenchGrant(grant) }, getActive)
  }
  reduceGuest(accessId: string, grant: WorkbenchGrant) {
    const lease = this.leases.get(accessId), next = parseWorkbenchGrant(grant)
    if (!lease || lease.context.actor !== 'lan-guest' || !isGrantReduction(lease.context.grant!, next)) throw new WorkbenchAccessError('grant-expansion-denied', '扩大权限需要重新建立分享。')
    lease.context = Object.freeze({ ...lease.context, grant: next, grantRevision: lease.context.grantRevision! + 1 })
    for (const notify of this.revokeListeners) notify(accessId)
  }
  getContext(accessId: string): WorkbenchAccessContext {
    if (accessId === 'desktop') return DESKTOP
    const lease = this.leases.get(accessId)
    if (!lease || !lease.active()) { this.revoke(accessId); throw new WorkbenchAccessError('access-expired', '访问已结束，请重新打开工作台。', 401) }
    return lease.context
  }
  resolve(headers: Headers): WorkbenchAccessContext {
    const token = headers.get(WORKBENCH_ACCESS_HEADER) ?? headers.get('cookie')?.split(';').map(value => value.trim()).find(value => value.startsWith('bay-browser-access='))?.slice('bay-browser-access='.length) ?? null
    if (token === null) return DESKTOP
    const id = this.tokens.get(hash(token))
    if (!id) throw new WorkbenchAccessError('access-expired', '访问凭证已失效。', 401)
    return this.getContext(id)
  }
  onRevoke(listener: (id: string) => void) { this.revokeListeners.add(listener); return () => { this.revokeListeners.delete(listener) } }
  revoke(accessId: string) {
    const lease = this.leases.get(accessId)
    if (!lease) return
    this.leases.delete(accessId); this.tokens.delete(lease.tokenHash)
    if (lease.context.workbenchId && this.owners.get(lease.context.workbenchId)?.accessId === accessId) this.owners.delete(lease.context.workbenchId)
    for (const notify of this.revokeListeners) notify(accessId)
  }
  controller(workbenchId: string): 'desktop' | 'browser' {
    const owner = this.owners.get(workbenchId)
    if (owner) { try { this.getContext(owner.accessId); return 'browser' } catch { /* revoke stale owner */ } }
    return 'desktop'
  }
  capabilities(context: WorkbenchAccessContext): readonly WorkbenchCapability[] { return context.actor === 'lan-guest' ? this.getContext(context.accessId).grant!.capabilities : ALL }

  authorize(context: WorkbenchAccessContext, capability: WorkbenchCapability, target: WorkbenchAccessTarget): void {
    this.checkAuthorization(context, capability, target, false)
  }
  /** Only the native snapshot participant may drain execution accepted before its barrier. */
  authorizeAcceptedExecution(context: WorkbenchAccessContext, capability: WorkbenchCapability, target: WorkbenchAccessTarget): void {
    this.checkAuthorization(context, capability, target, true)
  }
  private checkAuthorization(context: WorkbenchAccessContext, capability: WorkbenchCapability, target: WorkbenchAccessTarget, acceptedExecution: boolean): void {
    const current = this.getContext(context.accessId)
    if (current.workbenchId !== undefined && current.workbenchId !== target.workbenchId) throw new WorkbenchAccessError('workbench-scope-denied', '此访问只允许当前工作台。')
    if (context.grantRevision !== current.grantRevision || context.controlEpoch !== current.controlEpoch) throw new WorkbenchAccessError('access-revision-conflict', '访问权限已变化，请刷新后重试。', 409)
    const record = this.getRecord(target.workbenchId)
    const read = capability === 'view' || capability === 'read-files'
    if (!read && current.actor === 'browser-owner' && this.leases.get(current.accessId)?.writable?.(capability) === false) throw new WorkbenchAccessError('browser-not-ready', '浏览器正在交接，请完成交接后再操作。', 409)
    if (!read && !acceptedExecution && this.barriers.has(target.workbenchId)) throw new WorkbenchAccessError('snapshot-in-progress', '正在生成工作台快照，请稍后重试。', 423)
    if (!read && current.actor === 'desktop' && this.controller(target.workbenchId) === 'browser') throw new WorkbenchAccessError('browser-controls-workbench', '此工作台由浏览器控制，请先收回。', 409)
    if (target.sessionId) {
      const actual = this.sessionTarget(target.sessionId)
      if (!actual || actual.workbenchId !== target.workbenchId || target.areaId && target.areaId !== actual.areaId) throw new WorkbenchAccessError('session-scope-denied', '会话不属于指定工作台或区域。')
      if (current.actor === 'lan-guest' && capability === 'message') {
        const main = record.bayAgentSession?.sessionId === target.sessionId || Object.values(record.sessionCatalog ?? {}).some(row => row.sessionId === target.sessionId && row.role === 'main')
        if (main && !current.grant!.capabilities.includes('main-message')) throw new WorkbenchAccessError('main-message-denied', '主控未授权向 Bay Agent 发送消息。')
      }
    }
    if (current.actor !== 'lan-guest') return
    const grant = current.grant!
    if (!grant.capabilities.includes(capability)) throw new WorkbenchAccessError('capability-denied', '此操作需要主控授权：' + capability)
    const areaId = target.areaId ?? (target.sessionId ? this.sessionTarget(target.sessionId)?.areaId : undefined)
    if (target.sessionId && grant.areaIds && !areaId) throw new WorkbenchAccessError('area-scope-denied', '工作台主会话不属于本次区域分享范围。')
    if (areaId && grant.areaIds && !grant.areaIds.includes(areaId)) throw new WorkbenchAccessError('area-scope-denied', '此区域不在分享授权范围内。')
    if (target.relativePath !== undefined) {
      const relative = target.relativePath
      if (relative.startsWith('/') || relative.includes('\\') || relative.split('/').some(part => part === '..' || part.toLowerCase() === '.bay') || /[\u0000-\u001f:]/u.test(relative)) throw new WorkbenchAccessError('path-scope-denied', '文件路径不在授权范围内。')
      const within = (value: string, prefix: string) => prefix === '' || value === prefix || value.startsWith(prefix + '/')
      if (grant.areaIds && !grant.areaIds.some(id => record.areaProjects?.[id] && within(relative, record.areaProjects[id]!.relativePath))) throw new WorkbenchAccessError('area-path-denied', '文件不在已授权区域的项目目录内。')
      if (grant.paths && !grant.paths.some(prefix => within(relative, prefix))) throw new WorkbenchAccessError('path-scope-denied', '文件路径不在授权范围内。')
      const root = realpathSync(record.fileWorkbench!.rootPath!), absolute = path.resolve(root, relative)
      let existing = absolute
      while (!existsSync(existing) && path.dirname(existing) !== existing) existing = path.dirname(existing)
      const resolved = path.resolve(realpathSync(existing), path.relative(existing, absolute))
      const actual = path.relative(root, resolved).split(path.sep).join('/')
      if (actual.startsWith('../') || path.isAbsolute(actual) || actual.split('/').some(part => part.toLowerCase() === '.bay') || grant.paths && !grant.paths.some(prefix => within(actual, prefix))) throw new WorkbenchAccessError('path-scope-denied', '链接目标不在授权范围内。')
      if (grant.areaIds && !grant.areaIds.some(id => record.areaProjects?.[id] && within(actual, record.areaProjects[id]!.relativePath))) throw new WorkbenchAccessError('area-path-denied', '链接目标不在已授权区域内。')
    }
  }
  snapshot(context: WorkbenchAccessContext): FileWorkbenchSnapshot {
    const source = this.directory.getSnapshot()
    if (!context.workbenchId) return source
    this.authorize(context, 'view', { workbenchId: context.workbenchId })
    const record = structuredClone(this.getRecord(context.workbenchId))
    if (context.actor === 'lan-guest') {
      if (record.fileWorkbench) delete record.fileWorkbench.rootPath
      delete record.externalBindings
      delete record.backgroundAi
      delete record.bayAgentOrchestration
      for (const area of areasOf(record.document.root)) for (const page of area.moduleHistory) {
        delete page.sessionStates; delete page.sessionStateOrder
        if (!WORKBENCH_GUEST_EDITORS.includes(page.editorId)) page.state = {}
      }
      if (context.grant?.areaIds) {
        const allowed = new Set(context.grant.areaIds)
        const filterAreas = <T>(values: Record<string, T> | undefined) => Object.fromEntries(Object.entries(values ?? {}).filter(([id]) => allowed.has(id)))
        record.areaProjects = filterAreas(record.areaProjects)
        record.areaDefinitions = filterAreas(record.areaDefinitions)
        record.areaMetadata = filterAreas(record.areaMetadata)
        record.areaContexts = filterAreas(record.areaContexts)
        record.sessionCatalog = Object.fromEntries(Object.entries(record.sessionCatalog ?? {}).filter(([, row]) => row.areaId && allowed.has(row.areaId)))
        delete record.bayAgentSession
        const sessions = new Set(Object.values(record.sessionCatalog).map(row => row.sessionId))
        for (const area of areasOf(record.document.root)) {
          area.moduleHistory = allowed.has(area.areaId) ? area.moduleHistory.filter(page => !page.binding || sessions.has(page.binding.sessionId)) : []
          if (!area.moduleHistory.some(page => page.moduleInstanceId === area.activeModuleInstanceId)) delete area.activeModuleInstanceId
        }
      }
    }
    // A browser-owner is the same local operator as the DSH desktop client.
    // Keep the profile-wide editor consent and visibility preferences in its
    // scoped snapshot so the browser can reconstruct the exact same inner-page
    // catalog and layout affordances. LAN guests intentionally receive neither
    // field: they use the explicit share projection below.
    const ownerGlobals = context.actor === 'browser-owner' ? {
      ...(source.value.globalHiddenEditorIds === undefined ? {} : { globalHiddenEditorIds: [...source.value.globalHiddenEditorIds] }),
      ...(source.value.extensionConsents === undefined ? {} : { extensionConsents: structuredClone(source.value.extensionConsents) }),
    } : {}
    return { ...source, writable: context.actor !== 'lan-guest' || this.capabilities(context).some(c => ['layout', 'context', 'tasks'].includes(c)), value: {
      version: 4, activeWorkbenchId: context.workbenchId, openWorkbenchIds: [context.workbenchId], workbenches: { [context.workbenchId]: record }, invalidWorkbenches: {}, layoutTemplates: {}, sessionMarkers: {},
      ...ownerGlobals,
      ...(context.actor === 'browser-owner' && source.value.backgroundAi ? { backgroundAi: source.value.backgroundAi } : {}),
    } }
  }
  async run<T>(context: WorkbenchAccessContext, capability: WorkbenchCapability, target: WorkbenchAccessTarget, operation: () => Promise<T>): Promise<T> {
    this.authorize(context, capability, target)
    const set = this.writes.get(target.workbenchId) ?? new Set<Promise<unknown>>()
    this.writes.set(target.workbenchId, set)
    const result = operation(); set.add(result)
    try { return await result } finally { set.delete(result) }
  }
  registerSnapshotParticipant(participant: (id: string) => Promise<() => void | Promise<void>>) { this.snapshotParticipants.add(participant); return () => { this.snapshotParticipants.delete(participant) } }
  async withSnapshot<T>(workbenchId: string, operation: () => Promise<T>): Promise<T> {
    if (this.barriers.has(workbenchId)) throw new WorkbenchAccessError('snapshot-in-progress', '已有快照作业正在进行。', 423)
    this.barriers.add(workbenchId)
    const releases: (() => void | Promise<void>)[] = []
    try {
      for (const participant of this.snapshotParticipants) releases.push(await participant(workbenchId))
      await Promise.all(this.writes.get(workbenchId) ?? [])
      return await operation()
    } finally {
      try { for (const release of releases.reverse()) { try { await release() } catch { /* Always release the remaining participants and the write barrier. */ } } }
      finally { this.barriers.delete(workbenchId) }
    }
  }
  isSnapshotting(workbenchId: string) { return this.barriers.has(workbenchId) }
  dispose() { for (const id of [...this.leases.keys()]) this.revoke(id); this.snapshotParticipants.clear(); this.revokeListeners.clear() }
}
