/**
 * Host route for the manual agent assembly drawer.
 * Guests can read the roster; only the desktop owner and browser owner can save.
 */

import type { HostConnectionHandle } from '@deepseek-ai/dsh-client-connection'
import { HostWorkbenchAccess, WorkbenchAccessError } from './host-workbench-access.ts'
import type { HostAgentAssemblyStore } from './host-agent-assembly.ts'
import { AgentAssemblyError, AGENT_ASSEMBLY_ROUTE, type WorkbenchAgentDefinitionV1 } from './agent-assembly-model.ts'

export function installAgentAssemblyRoute(connection: HostConnectionHandle, store: HostAgentAssemblyStore, access?: HostWorkbenchAccess) {
  return connection.fetch.register({ path: AGENT_ASSEMBLY_ROUTE, methods: ['POST'], requestBody: 'streaming', async fetch(request) {
    try {
      if (request.headers.get('content-type')?.split(';')[0] !== 'application/json') return Response.json({ error: '需要 JSON 请求。', messageKey: 'assembly.invalidRequest' }, { status: 415 })
      const chunks: Uint8Array[] = []
      let length = 0
      if (!request.body) throw new AgentAssemblyError('缺少请求。', 'assembly.invalidRequest')
      for await (const chunk of request.body) {
        length += chunk.length
        if (length > 1024 * 1024) throw new AgentAssemblyError('请求内容超限。', 'assembly.invalidRequest')
        chunks.push(chunk)
      }
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>
      const workbenchId = typeof body.workbenchId === 'string' ? body.workbenchId : ''
      if (!workbenchId) throw new AgentAssemblyError('缺少工作台身份。', 'assembly.invalidRequest')
      const actor = access?.resolve(request.headers)
      if (access && actor) access.authorize(actor, body.action === 'list' ? 'view' : 'layout', { workbenchId })
      if (body.action !== 'list' && actor && actor.actor === 'lan-guest') throw new WorkbenchAccessError('agent-assembly-denied', '访客不能组装或注册专用 Agent。')
      const value = body.action === 'list'
        ? store.list(workbenchId)
        : body.action === 'portable'
          ? store.portable(workbenchId)
        : body.action === 'save'
          ? await store.save({
            workbenchId,
            agentId: text(body, 'agentId'),
            name: text(body, 'name'),
            description: text(body, 'description'),
            basePreset: body.basePreset === 'minimal' ? 'minimal' : 'standard',
            tools: strings(body.tools),
            skills: strings(body.skills),
            blocks: strings(body.blocks),
            ...(typeof body.instructions === 'string' ? { instructions: body.instructions } : {}),
            guestAccess: guestAccess(body.guestAccess),
          })
          : body.action === 'register' || body.action === 'unregister'
            ? await registration(store, body.action, workbenchId, text(body, 'agentId'), revision(body.revision))
            : undefined
      if (value === undefined) throw new AgentAssemblyError('不支持的组装操作。', 'assembly.invalidRequest')
      return Response.json({ value }, { headers: { 'cache-control': 'no-store' } })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const issue = error instanceof AgentAssemblyError ? { messageKey: error.messageKey, params: error.params }
        : error instanceof WorkbenchAccessError && error.code === 'agent-assembly-denied' ? { messageKey: 'assembly.guestDenied' } : {}
      return Response.json({ error: message, ...issue }, { status: error instanceof WorkbenchAccessError ? error.status : 400, headers: { 'cache-control': 'no-store' } })
    }
  } })
}

function text(body: Record<string, unknown>, key: string): string {
  const value = body[key]
  if (typeof value !== 'string' || !value.trim()) throw new AgentAssemblyError('缺少字段：' + key, 'assembly.requiredField', { field: key })
  return value
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function guestAccess(value: unknown): WorkbenchAgentDefinitionV1['guestAccess'] {
  return value === 'read-only' || value === 'approved' ? value : 'none'
}

function revision(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) throw new AgentAssemblyError('缺少字段：revision', 'assembly.requiredField', { field: 'revision' })
  return value
}

async function registration(store: HostAgentAssemblyStore, action: 'register' | 'unregister', workbenchId: string, agentId: string, revision: number) {
  return action === 'register' ? store.registerRevision(workbenchId, agentId, revision) : store.unregisterRevision(workbenchId, agentId, revision)
}
