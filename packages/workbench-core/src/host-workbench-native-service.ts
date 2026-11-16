import type { Context } from '@deepseek-ai/cordis'
import { createGuestNativeTransport, installWorkbenchNativeMutationRoutes } from './host-workbench-native-access.ts'
import { WORKBENCH_ACCESS_SERVICE } from './workbench-access-contract.ts'
import { WorkbenchAccessError } from './host-workbench-access.ts'

export const WORKBENCH_NATIVE_SERVICE = 'workbenchNativeAccess'
declare module '@deepseek-ai/cordis' { interface Context { workbenchNativeAccess: NonNullable<ReturnType<typeof createGuestNativeTransport>> } }

export function installWorkbenchNativeAccess(ctx: Context) {
  const access = ctx.get(WORKBENCH_ACCESS_SERVICE, false), connection = ctx.get('connection', false)
  if (!access || !connection) return undefined
  const native = createGuestNativeTransport(ctx, access)
  if (!native) return undefined
  ctx.provide(WORKBENCH_NATIVE_SERVICE, native)
  const disposeMutations = installWorkbenchNativeMutationRoutes(ctx, access, native)
  const disposeRoute = connection.fetch.register({ path: '/api/workbench/access/v1', methods: ['POST'], requestBody: 'buffered', async fetch(request) {
    try {
      const actor = access.resolve(request.headers), input = await request.json() as { action: string; workbenchId: string; id?: string; allow?: boolean }
      if (actor.actor === 'lan-guest') throw new WorkbenchAccessError('owner-required', '确认操作由当前主控处理。')
      access.authorize(actor, 'view', { workbenchId: input.workbenchId })
      if (input.action === 'answer') {
        if (typeof input.id !== 'string' || typeof input.allow !== 'boolean' || !native.pending(input.workbenchId).some(row => row.id === input.id)) throw new Error('无效的确认请求。')
        native.answer(actor, input.id, input.allow)
      } else if (input.action !== 'pending') throw new Error('不支持的访问操作。')
      return Response.json({ value: native.pending(input.workbenchId) }, { headers: { 'cache-control': 'no-store' } })
    } catch (error) { return Response.json({ error: String(error) }, { status: error instanceof WorkbenchAccessError ? error.status : 400 }) }
  } })
  return () => { disposeMutations(); disposeRoute(); native.dispose() }
}
