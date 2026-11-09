import { AsyncLocalStorage } from 'node:async_hooks'
import { createHash, randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import { realpathSync } from 'node:fs'
import path from 'node:path'
import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import { WebSocketServer, type WebSocket } from 'ws'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { RemoteError, type PeerScope } from '@deepseek-ai/dsh-typert-protocol'
import { clientRequestSchema } from '@deepseek-ai/dsh-client-connection'
import type { RemoteAccessBinding, RemoteAccessAction, RemoteAccessCondition } from '@deepseek-ai/dsh-api-remote-access'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import type { UserMessage } from '@deepseek-ai/dsh-session'
import type { HostWorkbenchAccess } from './host-workbench-access.ts'
import type { WorkbenchAccessContext, WorkbenchAccessTarget, WorkbenchCapability } from './workbench-access-contract.ts'
import type {} from '@deepseek-ai/dsh-api-gateway'
import type {} from '@deepseek-ai/dsh-api-remote-access'
import type {} from '@deepseek-ai/dsh-working-directory'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-client-file-upload'

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface PrincipalMap {
    'bay-workbench': { kind: 'bay-workbench'; actor: 'lan-guest' | 'browser-owner'; accessId: string; workbenchId: string; inheritedAccessIds?: readonly string[] }
  }
}

type BayPrincipal = import('@deepseek-ai/dsh-typert-protocol').PrincipalMap['bay-workbench']
type NativePrincipal = BayPrincipal | import('@deepseek-ai/dsh-typert-protocol').PrincipalMap['owner']
type ExecutionOrigin = { accessId: string; workbenchId: string; actor: 'lan-guest' | 'browser-owner'; inheritedAccessIds?: readonly string[] }
const executionOrigin = new AsyncLocalStorage<ExecutionOrigin>()
/** A relay or Runtime adapter must copy this origin before leaving a native tool's execution. */
export function currentWorkbenchExecutionOrigin(): ExecutionOrigin | undefined { return executionOrigin.getStore() }
export function withWorkbenchExecutionOrigin<T>(origin: ExecutionOrigin, operation: () => T): T { return executionOrigin.run(origin, operation) }

const READ_ACTIONS: readonly RemoteAccessAction[] = [
  'session/list', 'session/search', 'session/page', 'session/observeEvent', 'session/observeProjections',
  'session/observeState', 'session/state', 'session/wait', 'session/follow', 'session/projections', 'session/attachment',
  'session/modelCatalog', 'skills/list', 'workspace/follow',
  'event:api-session/activity', 'event:api-session/added', 'event:api-session/error',
  'event:api-session/removed', 'event:api-session/status',
]
const GLOBAL_READS: readonly RemoteAccessAction[] = ['session/list', 'session/search', 'session/observeProjections', 'session/control', 'session/modelCatalog', 'agentPresets/list', 'remoteAccess/follow', 'workspace/follow']
const OWNER_SESSION_WRITES: readonly RemoteAccessAction[] = ['session/prompt', 'session/cancel', 'session/updateQueue', 'session/rename', 'session/selectModel', 'session/fork', 'agentPresets/select', 'fileUploads/upload']
const FILE_READS: readonly RemoteAccessAction[] = ['workspaceFiles/read', 'workspaceFiles/readBytes', 'workspaceFiles/stat', 'workspaceFiles/list', 'workspaceFiles/changes']
const OWNER_TERMINAL: readonly RemoteAccessAction[] = ['terminal/environment', 'terminal/shells', 'terminal/list', 'terminal/create', 'terminal/retain', 'terminal/attach', 'terminal/rename', 'terminal/close']
const MUTATIONS = new Set<string>(['session/prompt', 'session/cancel', 'session/updateQueue', 'session/rename', 'session/selectModel', 'session/fork', 'agentPresets/select'])
const LIMIT = 16 * 1024 * 1024
const INBOX_LIMIT = 1024 * 1024
const realPath = (value: string): string => {
  try { return realpathSync.native(value) }
  catch { return realpathSync(value) }
}
const obj = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const principal = (message: UserMessage): BayPrincipal | undefined => {
  const candidate = obj(obj(message.source).principal)
  return candidate.kind === 'bay-workbench' && typeof candidate.accessId === 'string' && typeof candidate.workbenchId === 'string'
    && (candidate.actor === 'lan-guest' || candidate.actor === 'browser-owner') ? candidate as unknown as BayPrincipal : undefined
}
const failure = (message: string) => new RemoteError('remote-access/denied', message, { action: 'workbench/native', reason: message })

/** Bounded, cancellation-aware uplink; no frames are retained after delivery. */
class Uplink implements AsyncIterable<unknown> {
  private queue: { value: unknown; size: number }[] = []
  private bytes = 0
  private done = false
  private wake: (() => void) | undefined
  push(value: unknown) {
    if (this.done) throw failure('流已经结束。')
    const size = Buffer.byteLength(JSON.stringify(value) ?? '')
    if (this.bytes + size > INBOX_LIMIT) throw failure('访客输入流超限。')
    this.queue.push({ value, size }); this.bytes += size; this.wake?.(); this.wake = undefined
  }
  end() { this.done = true; this.wake?.(); this.wake = undefined }
  async *[Symbol.asyncIterator]() {
    try {
      while (this.queue.length || !this.done) {
        const row = this.queue.shift()
        if (row) { this.bytes -= row.size; yield row.value }
        else await new Promise<void>(resolve => { this.wake = resolve })
      }
    } finally { this.queue = []; this.bytes = 0; this.end() }
  }
}

export interface WorkbenchNativeApproval {
  id: string
  workbenchId: string
  sessionId: string
  accessId: string
  turn: number
  tool: string
  arguments: unknown
  createdAt: number
  grantRevision: number
  grantRevisions: Readonly<Record<string, number>>
  workbenchRevision: number
}

/**
 * Terminate native HTTP/mux at a real non-owner Peer. An upstream owner cookie
 * is deliberately never used for a guest request, including read subscriptions.
 */
export function createGuestNativeTransport(ctx: Context, access: HostWorkbenchAccess) {
  const connection = ctx.get('connection', false), gateway = ctx.get('typertGateway', false), remoteAccess = ctx.get('remoteAccess', false)
  if (!connection || !gateway || !remoteAccess) return undefined
  const handler = connection.createSharedFetchHandler('/api')
  const peers = new Map<string, PeerScope>()
  const sockets = new Map<string, Set<WebSocket>>()
  const live = new Map<string, { agent: Agent; turn: number; origin: ExecutionOrigin }>()
  const inherited = new WeakMap<UserMessage, ExecutionOrigin>()
  const approvals = new Map<string, { value: WorkbenchNativeApproval; digest: string; resolve: (allow: boolean) => void }>()
  const approved = new Map<ToolExecution['token'], { accessId: string; revisions: Readonly<Record<string, number>>; workbenchRevision: number; digest: string }>()
  const snapshotExecuting = new Map<string, Set<Agent>>()
  const disposers: (() => void)[] = []
  const wss = new WebSocketServer({ noServer: true, maxPayload: LIMIT, perMessageDeflate: false })
  let disposed = false

  const current = (input: WorkbenchAccessContext | string) => {
    if (disposed) throw failure('工作台访问服务已停止。')
    const value = access.getContext(typeof input === 'string' ? input : input.accessId)
    if (value.actor === 'desktop' || !value.workbenchId) throw failure('此通道需要浏览器或协作者身份。')
    access.authorize(value, 'view', { workbenchId: value.workbenchId })
    return value
  }
  const peerFor = (input: WorkbenchAccessContext) => {
    const value = current(input)
    let peer = peers.get(value.accessId)
    if (!peer || peer.signal.aborted) {
      const principal: NativePrincipal = value.actor === 'browser-owner'
        ? { kind: 'owner' }
        : { kind: 'bay-workbench', actor: 'lan-guest', accessId: value.accessId, workbenchId: value.workbenchId! }
      peer = connection.createPeer({ principal, interactions: 'answer' })
      peers.set(value.accessId, peer)
    }
    return peer
  }
  const targetFor = (accessContext: WorkbenchAccessContext, sessionId: string): WorkbenchAccessTarget => {
    const target = access.sessionTarget(sessionId)
    if (!target || target.workbenchId !== accessContext.workbenchId) throw failure('会话不属于分享的工作台。')
    return target
  }
  const can = (value: WorkbenchAccessContext, capability: WorkbenchCapability, target: WorkbenchAccessTarget) => {
    try { access.authorize(value, capability, target); return true } catch { return false }
  }
  const bindingsFor = (p: BayPrincipal): readonly RemoteAccessBinding[] => {
    let value: WorkbenchAccessContext
    try { value = current(p.accessId) } catch { return [] }
    const record = access.getRecord(value.workbenchId!)
    const bindings: RemoteAccessBinding[] = [{ role: { name: 'bay-native-catalog', resource: 'global', actions: GLOBAL_READS }, resource: { kind: 'global' } }]
    const workspaceIds = new Set(Object.entries(record.areaProjects ?? {}).filter(([areaId]) => can(value, 'view', { workbenchId: record.workbenchId, areaId })).map(([, row]) => row.workspaceId).filter((id): id is string => !!id))
    if (record.bayAgentSession?.workspaceId) workspaceIds.add(record.bayAgentSession.workspaceId)
    for (const workspaceId of workspaceIds) bindings.push({ role: { name: 'bay-native-workspace', resource: 'workspace', actions: ['workspace/follow'] }, resource: { kind: 'workspace', id: workspaceId as never } })
    const ids = new Set(Object.values(record.sessionCatalog ?? {}).map(row => row.sessionId).filter((id): id is string => !!id))
    if (record.bayAgentSession?.sessionId) ids.add(record.bayAgentSession.sessionId)
    for (const sessionId of ids) {
      const target = targetFor(value, sessionId)
      if (!can(value, 'view', target)) continue
      const actions = [...READ_ACTIONS]
      if (value.actor === 'browser-owner') actions.push(...OWNER_SESSION_WRITES, ...OWNER_TERMINAL)
      else if (can(value, 'message', target)) actions.push('session/prompt', 'fileUploads/upload')
      if (can(value, 'read-files', target)) actions.push(...FILE_READS)
      const condition: RemoteAccessCondition<'session'> = ({ action, args }) => {
        try {
          const now = current(p.accessId)
          access.authorize(now, action === 'session/prompt' || action === 'fileUploads/upload' ? 'message'
            : FILE_READS.includes(action) ? 'read-files' : action.startsWith('event:') || READ_ACTIONS.includes(action) ? 'view' : 'tasks', target)
          if (action === 'session/prompt' && now.actor === 'lan-guest' && args !== undefined && obj(args.request).mode !== 'queue') return { kind: 'deny', reason: '访客消息只能进入下一轮队列。' }
          return { kind: 'allow' }
        } catch (error) { return { kind: 'deny', reason: String(error) } }
      }
      bindings.push({ role: { name: 'bay-native-session', resource: 'session', actions }, resource: { kind: 'session', id: sessionId as never }, condition })
    }
    return bindings
  }
  disposers.push(remoteAccess.registerPolicy('bay-workbench', { bindings: bindingsFor, explain: () => '此原生操作或资源未获工作台授权。' }))
  // A newly registered Worker must become visible through the same scoped
  // baseline; refreshing grants must not revoke an accepted guest execution.
  disposers.push(access.directory.subscribe(() => remoteAccess.invalidate()))

  const containsAttachment = (value: unknown, attachmentId: string): boolean => {
    if (Array.isArray(value)) return value.some(child => containsAttachment(child, attachmentId))
    if (!value || typeof value !== 'object') return false
    const data = obj(value)
    return data.attachmentId === attachmentId || Object.values(data).some(child => containsAttachment(child, attachmentId))
  }
  const verifyAttachment = async (sessionId: string, attachmentId: string) => {
    const persistence = ctx.get('sessionPersistence', false)
    if (!persistence) throw failure('当前宿主无法核验会话附件。')
    await using handle = await persistence.open(sessionId as never, 'read')
    for (let offset = 0;;) {
      const { events } = await handle.read(offset as never, 256)
      if (!events.length) throw failure('附件不属于此会话。')
      if (events.some(event => containsAttachment(event, attachmentId))) return
      offset += events.length
    }
  }
  const inspect = async (endpoint: string, payload: unknown, input: WorkbenchAccessContext) => {
    const value = current(input), args = obj(obj(payload).args), request = obj(args.request)
    if (endpoint === '$events') return
    if (!/^[A-Za-z][A-Za-z0-9]*\/[A-Za-z][A-Za-z0-9]*$/u.test(endpoint)) throw failure('无效的原生接口。')
    if (FILE_READS.includes(endpoint as RemoteAccessAction)) {
      const sessionId = args.workspaceFileScopeId
      if (typeof sessionId !== 'string' || typeof args.path !== 'string' || args.path.startsWith('~')) throw failure('文件访问需要明确会话和路径。')
      const target = targetFor(value, sessionId), record = access.getRecord(target.workbenchId)
      const row = Object.values(record.sessionCatalog ?? {}).find(entry => entry.sessionId === sessionId)
      const root = record.fileWorkbench?.rootPath
      if (!root || !row) throw failure('文件访问没有可确认的项目关联。')
      const liveHeader = ctx.get('sessions', false)?.get(sessionId as never)?.header
      const storedHeader = liveHeader ? undefined : (await ctx.get('sessionPersistence', false)?.stat(sessionId as never))?.header
      const cwd = liveHeader?.cwd ?? storedHeader?.cwd
      if (!cwd) throw failure('无法确认原生会话的文件目录。')
      let base = cwd
      try { base = realPath(cwd) } catch { /* A missing cwd is rejected by the resolved path checks below. */ }
      const baseFile = obj(args.options).baseFile
      if (baseFile !== undefined && typeof baseFile !== 'string') throw failure('无效的相对资源路径。')
      if (typeof baseFile === 'string') base = path.dirname(realPath(path.resolve(base, baseFile)))
      const absolute = path.resolve(base, args.path), relativePath = path.relative(realPath(root), absolute).split(path.sep).join('/')
      if (relativePath === '..' || relativePath.startsWith('../') || path.isAbsolute(relativePath)) throw failure('文件不在工作台目录内。')
      const actual = path.relative(realPath(root), realPath(absolute)).split(path.sep).join('/')
      if (actual === '..' || actual.startsWith('../') || path.isAbsolute(actual)) throw failure('文件链接目标不在工作台内。')
      access.authorize(value, 'read-files', { ...target, relativePath })
      access.authorize(value, 'read-files', { ...target, relativePath: actual })
    }
    if (OWNER_TERMINAL.includes(endpoint as RemoteAccessAction)) {
      if (value.actor !== 'browser-owner' || typeof args.agentId !== 'string') throw failure('会话终端仅向当前主控开放。')
      // Repeated for terminal uplink and output, so a previously opened stream
      // cannot outlive its control lease or a package snapshot write barrier.
      access.authorize(value, 'tasks', targetFor(value, args.agentId))
    }
    // SessionController's attachment method only checks its reference bytes;
    // its public contract explicitly does NOT verify membership in the Session.
    if (endpoint === 'session/attachment') {
      const sessionId = request.sessionId, attachmentId = obj(request.attachment).attachmentId
      if (typeof sessionId !== 'string' || typeof attachmentId !== 'string') throw failure('缺少会话附件身份。')
      access.authorize(value, 'view', targetFor(value, sessionId))
      await verifyAttachment(sessionId, attachmentId)
    }
    if (endpoint === 'session/prompt') {
      if (typeof request.sessionId !== 'string') throw failure('缺少会话身份。')
      access.authorize(value, 'message', targetFor(value, request.sessionId))
      if (value.actor === 'lan-guest' && request.mode !== 'queue') throw failure('访客消息只能进入下一轮队列。')
    }
  }

  const toolDigest = (exec: Readonly<ToolExecution>) => createHash('sha256').update(JSON.stringify([exec.callId, exec.name, exec.arguments])).digest('hex')
  const originFor = (agent: Agent | undefined) => agent ? live.get(agent.id) : undefined
  const authorizeExecution = (agent: Agent, value: WorkbenchAccessContext, capability: WorkbenchCapability, target: WorkbenchAccessTarget) => {
    if (snapshotExecuting.get(target.workbenchId)?.has(agent)) access.authorizeAcceptedExecution(value, capability, target)
    else access.authorize(value, capability, target)
  }
  const sourceIds = (origin: ExecutionOrigin) => [...new Set([origin.accessId, ...(origin.inheritedAccessIds ?? [])])]
  const revisionsFor = (origin: ExecutionOrigin) => Object.fromEntries(sourceIds(origin).map(id => [id, current(id).grantRevision ?? 0]))
  const checkOneTool = (exec: Readonly<ToolExecution>, origin: ExecutionOrigin, accessId: string): boolean => {
    const value = current(accessId), target = exec.agent ? targetFor(value, exec.agent.id) : undefined
    if (!target) return false
    if (value.actor === 'browser-owner') return true
    const args = obj(exec.arguments)
    let capability: WorkbenchCapability | undefined
    let rawPath: string | undefined
    if (['read', 'read_image'].includes(exec.name)) { capability = 'read-files'; rawPath = typeof args.file_path === 'string' ? args.file_path : undefined }
    if (['grep', 'glob'].includes(exec.name)) { capability = 'read-files'; rawPath = typeof args.path === 'string' ? args.path : '.' }
    if (['write', 'edit', 'str_replace_editor'].includes(exec.name)) { capability = exec.name === 'str_replace_editor' && args.command === 'view' ? 'read-files' : 'write-files'; rawPath = typeof args.file_path === 'string' ? args.file_path : typeof args.path === 'string' ? args.path : undefined }
    // Composite programs, patches, commands, plugins, memory and delegation are
    // deliberately sent to the operator unless an adapter knows every target.
    if (!capability) return false
    let relativePath: string | undefined
    if (capability === 'read-files' || capability === 'write-files') {
      if (rawPath === undefined || rawPath.startsWith('~') || /[\u0000-\u001f]/u.test(rawPath)) return false
      const record = access.getRecord(origin.workbenchId), root = record.fileWorkbench?.rootPath
      if (!root) return false
      const workingDirectory = ctx.get('workingDirectory', false)
      // Tools follow the Session's effective cwd, which may have changed since
      // creation. Never authorize against its original project path instead.
      if (!workingDirectory || !exec.agent) return false
       const cwd = workingDirectory.get(exec.agent.session)
       const absolute = path.resolve(realPath(cwd), rawPath)
       relativePath = path.relative(realPath(root), absolute).split(path.sep).join('/')
    }
    try { authorizeExecution(exec.agent!, value, capability, { ...target, ...(relativePath === undefined ? {} : { relativePath }) }); return true }
    catch { return false }
  }
  const checkTool = (exec: Readonly<ToolExecution>, origin: ExecutionOrigin) => sourceIds(origin).every(id => checkOneTool(exec, origin, id))
  const requestApproval = (exec: Readonly<ToolExecution>, run: NonNullable<ReturnType<typeof originFor>>) => new Promise<boolean>(resolve => {
    const value = current(run.origin.accessId), id = randomUUID()
    const finish = (allow: boolean) => { exec.signal.removeEventListener('abort', abort); approvals.delete(id); resolve(allow) }
    const abort = () => finish(false)
    const approval: WorkbenchNativeApproval = { id, workbenchId: run.origin.workbenchId, sessionId: run.agent.id, accessId: value.accessId, turn: run.turn,
      tool: exec.name, arguments: structuredClone(exec.arguments), createdAt: Date.now(), grantRevision: value.grantRevision!, grantRevisions: revisionsFor(run.origin), workbenchRevision: access.directory.definition(run.origin.workbenchId).revision }
    approvals.set(id, { value: approval, digest: toolDigest(exec), resolve: finish })
    exec.signal.addEventListener('abort', abort, { once: true })
    if (exec.signal.aborted) abort()
  })
  if (typeof ctx.on === 'function' && ctx.get('tools', false)) {
    disposers.push(ctx.on('agent/inbox/inserted', ({ agent, message }) => {
      const origin = executionOrigin.getStore()
      if (!origin || principal(message)) return
      inherited.set(message, origin)
      // Use the Agent's durable inbox API, never hand-written conversation
      // events. Explicit producers should set this source before send(); this
      // covers native tools that relay through their own existing producers.
      const tagged = { ...message, source: { ...message.source, principal: { kind: 'bay-workbench', ...origin } } } as UserMessage
      if (!agent.inbox.replace(message.id, tagged)) agent.cancel({ kind: 'hook', reason: '无法保存协作者执行来源，请由主控重新派发。' }, { keepInbox: true })
    }))
    disposers.push(ctx.on('agent/pre-step', async (payload, next) => {
      const decided = await next()
      if (decided.kind !== 'enter') return decided
      const previous = live.get(payload.agent.id)
      const origins = decided.messages.map(message => principal(message) ?? inherited.get(message)).filter((origin): origin is ExecutionOrigin => !!origin)
      const selected = origins.find(row => row.actor === 'lan-guest') ?? origins[0] ?? (previous?.turn === payload.turn ? previous.origin : undefined)
      const origin = selected && { ...selected, inheritedAccessIds: [...new Set(origins.filter(row => row.actor === 'lan-guest').flatMap(sourceIds).concat(selected.inheritedAccessIds ?? []))] }
      if (origin) {
        // Releasing an operator view must not cancel the operator's accepted run.
        if (origin.actor === 'browser-owner' && previous?.turn === payload.turn && previous.origin.accessId === origin.accessId) return decided
        try {
          for (const id of sourceIds(origin)) {
            const value = current(id), target = targetFor(value, payload.agent.id)
            authorizeExecution(payload.agent, value, 'message', target)
          }
          live.set(payload.agent.id, { agent: payload.agent, turn: payload.turn, origin })
          // Persist inherited origin on the actual admitted message, so a queued
          // relay or imported history cannot later masquerade as owner input.
          return { ...decided, messages: decided.messages.map(message => inherited.has(message) && !principal(message)
            ? { ...message, source: { ...message.source, principal: { kind: 'bay-workbench', ...origin } } } as UserMessage : message) }
        } catch { return { kind: 'reject' } }
      }
      const target = access.sessionTarget(payload.agent.id)
      if (target && access.controller(target.workbenchId) === 'browser' && decided.messages.some(message => message.source.kind === 'user')) return { kind: 'reject' }
      if (previous?.turn !== payload.turn) live.delete(payload.agent.id)
      return decided
    }))
    disposers.push(ctx.on('tools/pre-execute', async (exec, next) => {
      const decision = await next(), run = originFor(exec.agent)
      if (decision.kind === 'deny' || !run || run.origin.actor !== 'lan-guest') return decision
      try {
        if (checkTool(exec, run.origin)) return decision
        const revisions = revisionsFor(run.origin)
        const workbenchRevision = access.directory.definition(run.origin.workbenchId).revision
        if (!await requestApproval(exec, run)) return { kind: 'deny', reason: '主控未批准此协作者操作。' }
        const value = current(run.origin.accessId)
        if (!Object.entries(revisions).every(([id, revision]) => (current(id).grantRevision ?? 0) === revision)) return { kind: 'deny', reason: '分享权限已变化，请重新请求。' }
        if (access.directory.definition(run.origin.workbenchId).revision !== workbenchRevision) return { kind: 'deny', reason: '工作台已变化，请重新确认此操作。' }
        approved.set(exec.token, { accessId: value.accessId, revisions, workbenchRevision, digest: toolDigest(exec) })
        return decision
      } catch { return { kind: 'deny', reason: '分享权限已失效。' } }
    }))
    disposers.push(ctx.tools.guard(exec => {
      const run = originFor(exec.agent)
      if (!run || run.origin.actor !== 'lan-guest') return undefined
      try {
        const value = current(run.origin.accessId), permit = approved.get(exec.token)
        if (permit && permit.accessId === value.accessId && Object.entries(permit.revisions).every(([id, revision]) => (current(id).grantRevision ?? 0) === revision)
          && permit.workbenchRevision === access.directory.definition(run.origin.workbenchId).revision && permit.digest === toolDigest(exec)) return undefined
        if (checkTool(exec, run.origin)) return undefined
      } catch { /* failed closed after an approval or permission change */ }
      return '此操作超出协作者授权。'
    }))
    disposers.push(ctx.on('tools/execute', (exec, next) => {
      const run = originFor(exec.agent)
      return run ? executionOrigin.run(run.origin, next) : next()
    }))
    disposers.push(ctx.on('tools/result', exec => { approved.delete(exec.token) }))
    disposers.push(ctx.on('agent/turn-stopping', ({ agent, turn }) => { if (live.get(agent.id)?.turn === turn) live.delete(agent.id) }))
    disposers.push(ctx.on('agent/disposed', ({ agent }) => { live.delete(agent.id) }))
  }
  const revoke = (accessId: string) => {
    const peer = peers.get(accessId); peers.delete(accessId); void peer?.dispose()
    for (const socket of sockets.get(accessId) ?? []) socket.close(1008, 'Workbench access changed')
    sockets.delete(accessId)
    for (const pending of [...approvals.values()]) if (pending.value.accessId === accessId) pending.resolve(false)
    for (const { agent, origin } of live.values()) if (sourceIds(origin).includes(accessId) && origin.actor === 'lan-guest') agent.cancel({ kind: 'hook', reason: '工作台分享权限已撤销。' }, { keepInbox: true })
    remoteAccess.invalidate()
  }
  disposers.push(access.onRevoke(revoke))
  disposers.push(access.registerSnapshotParticipant(async workbenchId => {
    try {
      const record = access.getRecord(workbenchId), agents = ctx.get('agents', false)
      const ids = new Set(Object.values(record.sessionCatalog ?? {}).map(row => row.sessionId).filter((id): id is string => !!id))
      if (record.bayAgentSession?.sessionId) ids.add(record.bayAgentSession.sessionId)
      const running = new Set<Agent>()
      for (const id of ids) { const agent = agents?.get(id as never); if (agent?.status === 'running') running.add(agent) }
      snapshotExecuting.set(workbenchId, running)
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        await Promise.race([
          Promise.all([...running].map(async agent => { await agent.whenIdle(); running.delete(agent) })),
          new Promise<never>((_, reject) => { timer = setTimeout(() => reject(failure('会话未能在 30 秒内到达快照边界，请稍后重试导出。')), 30_000) }),
        ])
      } finally { if (timer) clearTimeout(timer) }
      return () => { snapshotExecuting.delete(workbenchId) }
    } catch (error) { snapshotExecuting.delete(workbenchId); throw error }
  }))
  const openStream = async (endpoint: string, payload: unknown, input: WorkbenchAccessContext, signal: AbortSignal, uplink: AsyncIterable<unknown> = new Uplink()) => {
    await inspect(endpoint, payload, input)
    const peer = peerFor(input)
    const stream = await gateway.wireStream.open(endpoint, payload, uplink, peer, signal)
    return (async function* () {
      for await (const item of stream) {
        const actor = current(input)
        if (FILE_READS.includes(endpoint as RemoteAccessAction) || OWNER_TERMINAL.includes(endpoint as RemoteAccessAction)) await inspect(endpoint, payload, input)
        if (endpoint === 'session/control') {
          // Native control is essential to ClientSessions boot, but its Host
          // implementation emits every live Session without filtering.
          const frame = obj(item)
          const visible = (sessionId: string) => {
            try { return can(actor, 'view', targetFor(actor, sessionId)) } catch { return false }
          }
          if (frame.type === 'baseline') {
            const projections = Object.fromEntries(Object.entries(obj(obj(frame.value).projections)).filter(([sessionId]) => visible(sessionId)))
            yield { type: 'baseline', value: { projections } }
          } else if (frame.type === 'projection' && typeof frame.sessionId === 'string' && visible(frame.sessionId)) yield item
          continue
        }
        // The ready item is transport state; publishing the operator's home is unnecessary.
        yield endpoint === '$events' && obj(item).type === 'ready' ? { ...obj(item), host: { home: '' } } : item
      }
    })()
  }
  return {
    async renderDocument(input: WorkbenchAccessContext): Promise<string> {
      const server = ctx.get('webServer', false)
      if (!server) throw failure('Host 浏览器页面服务不可用。')
      const root = path.dirname(createRequire(import.meta.url).resolve('@deepseek-ai/dsh-web-frontend/package.json'))
      const source = await readFile(path.join(root, 'dist', 'index.html'), 'utf8')
      return server.renderIndex(source, peerFor(input))
        .replace(/<html(?=\s|>)/iu, '<html data-workbench-document="v1"')
        .replace(/<title>[\s\S]*?<\/title>/iu, '<title>Workbench</title>')
    },
    async handleHttp(request: Request, input: WorkbenchAccessContext): Promise<Response> {
      let rpcId: string | undefined
      try {
        const url = new URL(request.url), endpoint = url.pathname.replace(/^\/api\//u, '')
        if (endpoint === 'session/uploadFileBinary') {
          const sessionId = url.searchParams.get('sessionId'), value = current(input), uploads = ctx.get('fileUploads', false)
          if (request.method !== 'POST' || !sessionId || !uploads || request.headers.get('content-type')?.split(';', 1)[0] !== 'application/octet-stream'
            || [...url.searchParams.keys()].some(key => !['sessionId', 'name', 'mediaType'].includes(key))) throw failure('无效的会话附件上传请求。')
          const target = targetFor(value, sessionId)
          access.authorize(value, 'message', target)
          const body = request.body
          const data = (async function* () {
            if (!body) return
            for await (const chunk of body) { access.authorize(current(input), 'message', target); yield chunk }
          })()
          const name = url.searchParams.get('name'), mediaType = url.searchParams.get('mediaType')
          const upload = { sessionId: sessionId as never, data, signal: request.signal, ...(name === null ? {} : { name }) }
          const result = mediaType === null ? await uploads.uploadStream(upload) : await uploads.uploadImageStream({ ...upload, mediaType })
          access.authorize(current(input), 'message', target)
          return Response.json({ ok: true, value: result }, { headers: { 'cache-control': 'no-store' } })
        }
        if (request.method !== 'POST' || url.search) return new Response('不支持的原生请求。', { status: 403 })
        const chunks: Uint8Array[] = []; let length = 0
        if (!request.body) return new Response('缺少请求。', { status: 400 })
        for await (const chunk of request.body) {
          length += chunk.byteLength
          if (length > LIMIT) return new Response('请求过大。', { status: 413 })
          chunks.push(chunk)
        }
        const bytes = Buffer.concat(chunks)
        const envelope = clientRequestSchema.parse(JSON.parse(Buffer.from(bytes).toString('utf8')))
        rpcId = envelope.rpcId
        if (envelope.method !== endpoint) throw failure('请求方法与地址不匹配。')
        if (endpoint === 'session/prompt' && current(input).actor === 'lan-guest') obj(obj(envelope.payload).args).request = { ...obj(obj(obj(envelope.payload).args).request), mode: 'queue' }
        await inspect(endpoint, envelope.payload, input)
        if (MUTATIONS.has(endpoint)) {
          const args = obj(obj(envelope.payload).args), mutationRequest = obj(args.request)
          const targetId = mutationRequest.sessionId ?? args.sessionId ?? args.agentId
          if (typeof targetId !== 'string') throw failure('姝ゆ搷浣滅己灏戞槑纭殑浼氳瘽韬唤銆?')
          // The browser owner uses DSH's owner principal for the initial
          // client baseline. Keep the Host lease as the source of truth for
          // every mutation, including mutations without a prompt inspect.
          access.authorize(current(input), endpoint === 'session/prompt' ? 'message' : 'tasks', targetFor(current(input), targetId))
          const [namespace, method] = endpoint.split('/')
          const value = await gateway.invoke({ namespace: namespace!, method: method!, args: obj(obj(envelope.payload).args), peer: peerFor(input), signal: request.signal })
          return Response.json({ type: 'server-response', rpcId, result: { ok: true, value } })
        }
        const headers = new Headers({ 'content-type': 'application/json' })
        return await handler.fetch(new Request(request.url, { method: 'POST', body: bytes, headers, signal: request.signal }), peerFor(input))
      } catch (error) {
        const result = { ok: false, error: gateway.wireStream.failure(error) }
        return rpcId === undefined ? Response.json(result, { status: 403 }) : Response.json({ type: 'server-response', rpcId, result })
      }
    },
    openStream,
    handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer, input: WorkbenchAccessContext,
      authorizeFrame?: (endpoint: string, payload: unknown, phase: 'open' | 'item' | 'out') => void) {
      try { current(input); if (request.url !== '/api/remote.mux') throw failure('不支持的流地址。') }
      catch { socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return }
      wss.handleUpgrade(request, socket, head, ws => {
        const set = sockets.get(input.accessId) ?? new Set<WebSocket>(); set.add(ws); sockets.set(input.accessId, set)
        const streams = new Map<string, { lifetime: AbortController; uplink: Uplink; endpoint: string; payload: unknown }>()
        const send = async (frame: unknown) => {
          while (ws.bufferedAmount > INBOX_LIMIT && ws.readyState === 1) await new Promise(resolve => setTimeout(resolve, 10))
          if (ws.readyState !== 1) throw failure('连接已关闭。')
          await new Promise<void>((resolve, reject) => ws.send(JSON.stringify(frame), error => error ? reject(error) : resolve()))
        }
        const end = (id: string) => { const row = streams.get(id); streams.delete(id); row?.lifetime.abort(); row?.uplink.end() }
        ws.on('message', (raw, isBinary) => {
          void (async () => {
            if (isBinary) throw failure('只接受 JSON 流帧。')
            const frame = obj(JSON.parse(raw.toString())), id = frame.streamId
            if (typeof id !== 'string' || !id || id.length > 160) throw failure('无效的流标识。')
            current(input)
            if (frame.type === 'open') {
              if (streams.has(id) || streams.size >= 128 || typeof frame.endpoint !== 'string') throw failure('无效的流打开请求。')
              authorizeFrame?.(frame.endpoint, frame.payload, 'open')
              const row = { lifetime: new AbortController(), uplink: new Uplink(), endpoint: frame.endpoint, payload: frame.payload }
              streams.set(id, row)
              try {
                const stream = await openStream(row.endpoint, row.payload, input, row.lifetime.signal, row.uplink)
                for await (const value of stream) { authorizeFrame?.(row.endpoint, row.payload, 'out'); await send({ type: 'item', streamId: id, value }) }
                await send({ type: 'end', streamId: id })
              } catch (error) { if (ws.readyState === 1) await send({ type: 'error', streamId: id, error: gateway.wireStream.failure(error) }) }
              finally { end(id) }
            } else {
              const row = streams.get(id)
              if (!row) return
              if (frame.type === 'cancel') end(id)
              else if (frame.type === 'end') row.uplink.end()
              else if (frame.type === 'item') { authorizeFrame?.(row.endpoint, row.payload, 'item'); await inspect(row.endpoint, row.payload, input); row.uplink.push(frame.value) }
              else throw failure('不支持的流帧。')
            }
          })().catch(() => ws.close(1008, 'Invalid workbench stream'))
        })
        const heartbeat = setInterval(() => { if (ws.readyState === 1) ws.ping() }, 15_000)
        ws.once('close', () => { clearInterval(heartbeat); for (const id of [...streams.keys()]) end(id); set.delete(ws); if (!set.size) sockets.delete(input.accessId) })
        ws.on('error', () => ws.close())
      })
    },
    bootstrap(input: WorkbenchAccessContext) { return remoteAccess.snapshotFor(peerFor(input).principal) },
    pending(workbenchId: string) { return [...approvals.values()].filter(row => row.value.workbenchId === workbenchId).map(row => structuredClone(row.value)) },
    /** Rebuild remote-access snapshots after a browser lease changes phase.
     * This intentionally does not revoke the non-owner peer: the page may be
     * refreshing from `redeemed` to `ready`, and a revoke would close its mux
     * and cancel already accepted work. */
    refresh() { remoteAccess.invalidate() },
    answer(operator: WorkbenchAccessContext, id: string, allow: boolean) {
      const row = approvals.get(id)
      if (!row) throw failure('确认请求已结束。')
      if (operator.actor === 'lan-guest') throw failure('协作者不能批准自己的操作。')
      access.authorize(operator, 'tasks', { workbenchId: row.value.workbenchId })
      if (!Object.entries(row.value.grantRevisions).every(([id, revision]) => (current(id).grantRevision ?? 0) === revision)) { row.resolve(false); throw failure('权限已变化，请重新请求。') }
      if (access.directory.definition(row.value.workbenchId).revision !== row.value.workbenchRevision) { row.resolve(false); throw failure('工作台已变化，请重新请求。') }
      row.resolve(allow)
    },
    revoke,
    invalidate: revoke,
    dispose() {
      if (disposed) return
      disposed = true
      for (const id of [...peers.keys()]) revoke(id)
      for (const off of disposers.reverse()) off()
      for (const pending of approvals.values()) pending.resolve(false)
      approvals.clear(); approved.clear(); wss.close()
    },
  }
}

/** Exact JSON mutation routes fence native desktop writes before the owner bypass. */
export function installWorkbenchNativeMutationRoutes(ctx: Context, access: HostWorkbenchAccess,
  transport: NonNullable<ReturnType<typeof createGuestNativeTransport>>) {
  const connection = ctx.get('connection', false), gateway = ctx.get('typertGateway', false)
  if (!connection || !gateway) return () => {}
  const disposers = [...MUTATIONS].map(endpoint => connection.fetch.register({
    path: '/api/' + endpoint, methods: ['POST'], requestBody: 'buffered',
    async fetch(request) {
      let rpcId: string | undefined
      try {
        const context = access.resolve(request.headers)
        if (context.actor !== 'desktop') return await transport.handleHttp(request, context)
        const envelope = clientRequestSchema.parse(await request.json())
        rpcId = envelope.rpcId
        if (envelope.method !== endpoint) throw failure('请求方法与地址不匹配。')
        const args = obj(obj(envelope.payload).args), targetId = obj(args.request).sessionId ?? args.sessionId ?? args.agentId
        if (typeof targetId !== 'string') throw failure('此操作缺少明确的会话身份。')
        const target = access.sessionTarget(targetId)
        if (target) access.authorize(context, endpoint === 'session/prompt' ? 'message' : 'tasks', target)
        const [namespace, method] = endpoint.split('/')
        const value = await gateway.invoke({ namespace: namespace!, method: method!, args, peer: connection.browserPeer, signal: request.signal })
        return Response.json({ type: 'server-response', rpcId, result: { ok: true, value } })
      } catch (error) {
        return Response.json({ type: 'server-response', rpcId: rpcId ?? 'invalid-request', result: { ok: false, error: gateway.wireStream.failure(error) } })
      }
    },
  }))
  return () => { for (const dispose of disposers.reverse()) void dispose() }
}
