import type { HostConnectionHandle } from '@deepseek-ai/dsh-client-connection'
import { WORKBENCH_DIRECTORY_ROUTE } from './workbench-directory-contract.ts'
import type { DirectoryPatch } from './workbench-directory-contract.ts'
import type { HostWorkbenchDirectory } from './host-workbench-directory.ts'
import type { WorkbenchRecordV2 } from './foundation/persistence.ts'
import type { HostWorkbenchMemory } from './host-workbench-memory.ts'
import type { WorkbenchMemoryWrite } from './workbench-memory-contract.ts'
import { HostWorkbenchAccess, WorkbenchAccessError } from './host-workbench-access.ts'
import type { WorkbenchAccessTarget, WorkbenchCapability } from './workbench-access-contract.ts'
import { isDeepStrictEqual } from 'node:util'
import { areasOf } from './foundation/document-v3.ts'
import { allocateSessionMarker, validateSessionLabel } from './foundation/session-markers.ts'
import { validSessionMarker, workbenchSessionLocation } from './host-workbench-session-markers.ts'

/** Assembled presets a browser owner or guest may name when creating a session. Set by agent assembly. */
let presetOffered: (workbenchId: string, presetId: string, guest: boolean) => boolean = (_workbenchId, presetId) => !presetId.startsWith('bay:')
export function setDirectoryRoutePresetOffer(offer: typeof presetOffered | undefined) { presetOffered = offer ?? ((_workbenchId, presetId) => !presetId.startsWith('bay:')) }

export function installWorkbenchDirectoryRoute(connection: HostConnectionHandle, directory: HostWorkbenchDirectory, ensureMain: (id: string) => Promise<unknown>, memory?: HostWorkbenchMemory,
  createSession?: (input: { workbenchId: string; areaId: string; requestId: string; agentPreset: string; workspaceId: string }) => Promise<string>, access?: HostWorkbenchAccess,
  readExtensionInventory?: () => Promise<unknown>) {
  const requests = new Map<string, { fingerprint: string; result: Promise<Response> }>()
  return connection.fetch.register({ path: WORKBENCH_DIRECTORY_ROUTE, methods: ['POST'], requestBody: 'streaming', async fetch(request) {
    try {
      if (request.headers.get('content-type')?.split(';')[0] !== 'application/json') return Response.json({ error: '需要 JSON 请求。' }, { status: 415 })
      const chunks: Uint8Array[] = []; let length = 0
      if (!request.body) throw new Error('缺少请求。')
      for await (const chunk of request.body) { length += chunk.length; if (length > 8 * 1024 * 1024) throw new Error('请求内容超限。'); chunks.push(chunk) }
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>
      const text = (key: string) => { const value = body[key]; if (typeof value !== 'string') throw new Error('缺少字段：' + key); return value }
      const actor = access?.resolve(request.headers)
      const patch = body.action === 'patch' ? body.operation as DirectoryPatch : undefined
      const workbenchId = typeof body.workbenchId === 'string' ? body.workbenchId : patch?.path?.[0] === 'workbenches' ? patch.path[1] : actor?.workbenchId
      const mutation = ['create', 'create-session', 'prepare-creator-repair', 'show-area', 'open-project', 'bind-area', 'register-session', 'patch', 'memory-write', 'project-write'].includes(String(body.action))
      const writeTargets = new Set<string>(workbenchId ? [workbenchId] : [])
      // transaction wrapper. Rechecking only the workbench would discard the
      const writeAreas = new Map<string, Set<string>>()
      const scopedRequirements: { capability: WorkbenchCapability; target: WorkbenchAccessTarget }[] = []
      const archivedManagementTargets = new Set<string>()
      const addScopedRequirement = (capability: WorkbenchCapability, target: WorkbenchAccessTarget) => {
        if (!scopedRequirements.some(row => row.capability === capability && row.target.workbenchId === target.workbenchId && row.target.areaId === target.areaId)) scopedRequirements.push({ capability, target })
      }
      const addWriteArea = (id: string | undefined, areaId: string | undefined) => {
        if (!id || !areaId) return
        const areas = writeAreas.get(id) ?? new Set<string>()
        areas.add(areaId); writeAreas.set(id, areas)
      }
      const writeScopeTargets = (): WorkbenchAccessTarget[] => [...writeTargets].flatMap(id => {
        const areas = writeAreas.get(id)
        return areas && areas.size > 0
          ? [...areas].map(areaId => ({ workbenchId: id, areaId }))
          : [{ workbenchId: id }]
      })
      let capability: WorkbenchCapability = 'view'
      if (['create-session', 'show-area', 'open-project', 'bind-area', 'register-session', 'patch'].includes(String(body.action))) capability = 'layout'
      if (body.action === 'memory-write') capability = 'memory'
      if (['directories', 'project-entries', 'project-preview', 'project-read'].includes(String(body.action))) capability = 'read-files'
      if (['project-write', 'prepare-creator-repair'].includes(String(body.action))) capability = 'write-files'
      if (access && actor) {
        if (['create', 'create-preflight'].includes(String(body.action)) && actor.actor !== 'desktop') throw new WorkbenchAccessError('create-denied', '请在 DSH 中选择父目录并新建工作台。')
        if (mutation && actor.actor !== 'desktop' && (typeof body.requestId !== 'string' || !body.requestId)) throw new WorkbenchAccessError('request-id-required', '修改操作缺少请求标识。', 400)
        if (body.action === 'create-session' && actor.actor !== 'desktop' && typeof body.agentPreset === 'string' && typeof body.workbenchId === 'string' && !presetOffered(body.workbenchId, body.agentPreset, actor.actor === 'lan-guest')) throw new WorkbenchAccessError('agent-preset-denied', '这个模式不属于分享的工作台，或不对访客开放。')
        if (body.action === 'register-session' && actor.actor !== 'desktop') throw new WorkbenchAccessError('session-registration-denied', '请通过区域新建会话或打开已登记的会话。')
        if (body.action === 'prepare-creator-repair' && actor.actor !== 'desktop') throw new WorkbenchAccessError('creator-repair-desktop-required', '请在 DSH 客户端中打开插件修复会话。')
        if (patch) {
          if (!Array.isArray(patch.path)) throw new Error('无效的修改路径。')
          if (patch.path[0] === 'workbenches' && patch.path[1]) writeTargets.add(patch.path[1])
          if (actor.actor === 'desktop' && (patch.path.length === 0 || patch.path.length === 1 && patch.path[0] === 'workbenches')) {
            const before = directory.getSnapshot().value.workbenches
            const value = patch.value as Record<string, unknown> | undefined
            const after = (patch.path.length === 0 ? value?.workbenches : value) as Record<string, unknown> | undefined
            if (after) for (const id of new Set([...Object.keys(before), ...Object.keys(after)])) if (before[id] && !isDeepStrictEqual(before[id], after[id])) {
              writeTargets.add(id)
              const previous = before[id]!
              if (previous.archivedAt !== undefined) {
                const { archivedAt: _archivedAt, ...restored } = previous
                if (after[id] === undefined || isDeepStrictEqual(after[id], restored)) archivedManagementTargets.add(id)
              }
            }
          }
          // A browser owner or LAN participant may set the marker of a Session
          // of its own Workbench; every other preference stays Host-only.
          const markerPatch = actor.workbenchId !== undefined && patch.path[0] === 'sessionMarkers' && patch.path.length === 3
          if (markerPatch) {
            const [, workspaceId, sessionId] = patch.path as [string, string, string]
            const location = workbenchSessionLocation(access.getRecord(actor.workbenchId!), sessionId)
            if (location?.workspaceId !== workspaceId) throw new WorkbenchAccessError('patch-scope-denied', '只能修改当前工作台的对话标记。')
            if (patch.operation !== 'set' || !validSessionMarker(patch.value)) throw new WorkbenchAccessError('invalid-operation', '对话标记无效。', 400)
            const label = validateSessionLabel(patch.value.label, directory.getSnapshot().value.sessionMarkers?.[workspaceId] ?? {}, sessionId)
            if (!label.ok) throw new WorkbenchAccessError('invalid-operation', label.code === 'conflict' ? '同一项目中已有相同的对话标记。' : '对话标记无效。', 400)
          } else if (actor.workbenchId && (patch.path[0] !== 'workbenches' || patch.path[1] !== actor.workbenchId)) throw new WorkbenchAccessError('patch-scope-denied', '只能修改当前工作台。')
        }
        if (workbenchId) {
          if (mutation && typeof body.areaId === 'string') addWriteArea(workbenchId, body.areaId)
          let relativePath = typeof body.relativePath === 'string' ? body.relativePath : undefined
          if (['project-entries', 'project-preview'].includes(String(body.action)) && (typeof body.areaId === 'string' || typeof body.projectId === 'string')) {
            const record = access.getRecord(workbenchId)
            const project = typeof body.projectId === 'string' ? record.projects?.[body.projectId] : record.areaProjects?.[String(body.areaId)]
            if (!project) throw new Error('请先设置区域项目目录。')
            relativePath = [project.relativePath, relativePath].filter(Boolean).join('/')
          }
          // `patch` performs field-level checks above. Applying a second bare
          // though every changed area has already been authorized.
          if (body.action !== 'patch') access.authorize(actor, capability, { workbenchId, ...(typeof body.areaId === 'string' ? { areaId: body.areaId } : {}), ...(relativePath !== undefined ? { relativePath } : {}) })
          if (body.action === 'bind-area' && body.createDirectory === true) access.authorize(actor, 'write-files', { workbenchId, ...(typeof body.areaId === 'string' ? { areaId: body.areaId } : {}), relativePath: text('relativePath') })
        } else if (actor.actor !== 'desktop') throw new WorkbenchAccessError('workbench-required', '缺少工作台身份。')
        if (mutation) for (const requirement of scopedRequirements.length > 0 ? scopedRequirements : writeScopeTargets().map(target => ({ capability, target }))) {
          if (actor.actor === 'desktop' && archivedManagementTargets.has(requirement.target.workbenchId)) access.authorizeDirectoryManagement(actor, requirement.target.workbenchId)
          else access.authorize(actor, requirement.capability, requirement.target)
        }
      }
      const execute = async () => {
      let value: unknown
      switch (body.action) {
        case 'create-preflight': value = await directory.checkCreateLocation(text('parentPath'), text('folderName')); break
        case 'snapshot': break
        case 'extension-inventory': if (!readExtensionInventory) throw new Error('插件清单服务不可用。'); value = await readExtensionInventory(); break
        case 'prepare-creator-repair': value = await directory.prepareCreatorRepair({ workbenchId: text('workbenchId'), moduleId: text('moduleId'), ...(body.packageName === undefined ? {} : { packageName: text('packageName') }) }); break
        case 'create-session': if (!createSession) throw new Error('会话服务不可用。'); value = await createSession({ workbenchId: text('workbenchId'), areaId: text('areaId'), requestId: text('requestId'), agentPreset: typeof body.agentPreset === 'string' ? body.agentPreset : 'standard', workspaceId: text('workspaceId') });
          {
            // Allocate the new Session's marker once, on the Host, so every
            // surface shows the same one instead of allocating its own.
            const workspaceId = text('workspaceId'), sessionId = String(value)
            const markers = directory.getSnapshot().value.sessionMarkers?.[workspaceId] ?? {}
            if (markers[sessionId] === undefined) await directory.patch({ operation: 'set', path: ['sessionMarkers', workspaceId, sessionId], value: allocateSessionMarker(markers) }).catch(() => undefined)
          }
          break
        case 'open-project': value = await directory.openProject({ workbenchId: text('workbenchId'), projectId: text('projectId'), requestId: text('requestId'), expectedRevision: Number(body.expectedRevision) }); break
        case 'show-area': value = await directory.showArea(text('workbenchId'), text('areaId'), Number(body.expectedRevision)); break
        case 'memory-list': if (!memory) throw new Error('记忆服务不可用。'); value = memory.list(text('workbenchId'), typeof body.query === 'string' ? body.query : '', typeof body.projectId === 'string' ? body.projectId : undefined); break
        case 'memory-read': if (!memory) throw new Error('记忆服务不可用。'); value = memory.read(text('workbenchId'), text('id'), body.revision === undefined ? undefined : Number(body.revision)); break
        case 'memory-write': if (!memory) throw new Error('记忆服务不可用。'); value = memory.write(text('workbenchId'), body.entry as WorkbenchMemoryWrite, 'human'); break
        case 'patch': value = await directory.patch(body.operation as DirectoryPatch); break
        case 'create': {
          value = await directory.create({ requestId: text('requestId'), parentPath: text('parentPath'), folderName: text('folderName'), record: body.record as WorkbenchRecordV2 })
          await ensureMain((value as { workbenchId: string }).workbenchId)
          break
        }
        case 'bind-area': value = await directory.bindArea({ workbenchId: text('workbenchId'), areaId: text('areaId'), relativePath: text('relativePath'), createDirectory: body.createDirectory === true, expectedRevision: Number(body.expectedRevision) }); break
        case 'register-session': value = await directory.registerSession(text('workbenchId'), text('sessionId'), {
          sessionKey: text('sessionKey'), role: body.role === 'worker' ? 'worker' : body.role === 'main' ? 'main' : 'user',
          ...(typeof body.areaId === 'string' ? { areaId: body.areaId } : {}), relativePath: text('relativePath'), title: text('title'), agentPreset: text('agentPreset'), createdAt: Number(body.createdAt),
          ...(typeof body.requestId === 'string' ? { requestId: body.requestId } : {}),
        }); break
        case 'directories': value = await directory.listDirectories(text('workbenchId'), typeof body.relativePath === 'string' ? body.relativePath : ''); break
        case 'project-entries': value = await directory.projectEntries(text('workbenchId'), typeof body.projectId === 'string' ? body.projectId : text('areaId'), typeof body.relativePath === 'string' ? body.relativePath : ''); break
        case 'project-preview': value = await directory.projectPreview(text('workbenchId'), typeof body.projectId === 'string' ? body.projectId : text('areaId'), text('relativePath')); break
        case 'project-read': value = { bytes: Buffer.from(await directory.readProjectFile(text('workbenchId'), text('relativePath'))).toString('base64') }; break
        case 'project-write': value = await directory.writeProjectFile(text('workbenchId'), text('relativePath'), Buffer.from(text('bytes'), 'base64')); break
        default: throw new Error('不支持的工作台目录操作。')
      }
      return Response.json({ snapshot: access && actor ? access.snapshot(actor) : directory.getSnapshot(), value,
        ...(access && actor ? { access: { context: actor, capabilities: access.capabilities(actor), controller: workbenchId ? access.controller(workbenchId) : 'desktop' } } : {}),
      }, { headers: { 'cache-control': 'no-store' } })
      }
      const key = typeof body.requestId === 'string' && mutation ? (actor?.accessId ?? 'desktop') + ':' + body.requestId : undefined
      const run = () => {
        let operation = execute
        if (mutation && access && actor) for (const requirement of scopedRequirements.length > 0 ? scopedRequirements : writeScopeTargets().map(target => ({ capability, target }))) {
          const next = operation
          operation = () => actor.actor === 'desktop' && archivedManagementTargets.has(requirement.target.workbenchId)
            ? access.runDirectoryManagement(actor, requirement.target.workbenchId, next)
            : access.run(actor, requirement.capability, requirement.target, next)
        }
        return operation()
      }
      if (!key) return await run()
      const fingerprint = JSON.stringify(body), prior = requests.get(key)
      if (prior) { if (prior.fingerprint !== fingerprint) throw new WorkbenchAccessError('request-conflict', '重复请求的内容不同。', 409); return (await prior.result).clone() }
      const result = run()
      requests.set(key, { fingerprint, result })
      if (requests.size > 2048) requests.delete(requests.keys().next().value!)
      try { return (await result).clone() } catch (error) { requests.delete(key); throw error }
    } catch (error) { return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: error instanceof WorkbenchAccessError ? error.status : 400, headers: { 'cache-control': 'no-store' } }) }
  } })
}
