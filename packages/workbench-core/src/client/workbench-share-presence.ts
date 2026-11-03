import type { ClientConnectionRpc, ConnectionRpcResult } from '@deepseek-ai/dsh-client-connection/client'
import { isWorkbenchShareGuestPage } from './workbench-share-guest.ts'

export interface WorkbenchSharePresenceV1 {
  readonly workbenchId: string
  readonly sessionId: string
  readonly areaId: string
  readonly participantId: string
  readonly role: 'host' | 'guest'
  readonly typing: boolean
  readonly draftText: string
  readonly hasAttachments: boolean
  readonly revision: number
  readonly updatedAt: number
}

interface PresenceReadResult {
  readonly presence?: readonly WorkbenchSharePresenceV1[]
}

function rpcFor(ctx: unknown): ClientConnectionRpc | undefined {
  const value = ctx as {
    connection?: { rpc?: ClientConnectionRpc }
    get?: (name: string, strict?: boolean) => unknown
  }
  if (value.connection?.rpc !== undefined) return value.connection.rpc
  try {
    return (value.get?.('connection', false) as { rpc?: ClientConnectionRpc } | undefined)?.rpc
  } catch {
    return undefined
  }
}

function unwrap<T>(result: ConnectionRpcResult<unknown>): T {
  if (!result.ok) throw new Error(result.error.code)
  return result.value as T
}

function newParticipantId(): string {
  const cryptoObject = globalThis.crypto
  if (cryptoObject?.randomUUID !== undefined) return cryptoObject.randomUUID().replace(/[^A-Za-z0-9_-]/gu, '')
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

const participantKey = '__DSH_WORKBENCH_SHARE_PARTICIPANT__'

function participantId(): string {
  const globalValue = globalThis as typeof globalThis & { [participantKey]?: string }
  const existing = globalValue[participantKey]
  if (typeof existing === 'string' && existing.length > 0) return existing
  const created = newParticipantId()
  globalValue[participantKey] = created
  return created
}

/**
 * Client adapter for the Host-owned ephemeral presence channel.  The adapter
 * only carries draft projections and input activity; it never writes the
 * official Conversation draft or any Workbench persistence store.
 */
export function createWorkbenchSharePresenceClient(ctx: unknown) {
  const role: WorkbenchSharePresenceV1['role'] = isWorkbenchShareGuestPage() ? 'guest' : 'host'
  const id = participantId()
  let rpc = rpcFor(ctx)
  const call = async <T>(payload: unknown): Promise<T> => {
    if (rpc === undefined) throw new Error('workbench-share-connection-unavailable')
    return unwrap<T>(await rpc.call('/api', 'workbench-share/presence', payload, AbortSignal.timeout(5_000)))
  }
  return {
    participantId: id,
    role,
    refreshRpc(): void { rpc = rpcFor(ctx) },
    async read(workbenchId: string, sessionId: string, areaId: string): Promise<readonly WorkbenchSharePresenceV1[]> {
      const result = await call<PresenceReadResult>({ action: 'read', workbenchId, sessionId, areaId })
      return Array.isArray(result.presence) ? result.presence : []
    },
    async publish(input: {
      readonly workbenchId: string
      readonly sessionId: string
      readonly areaId: string
      readonly typing: boolean
      readonly draftText: string
      readonly hasAttachments: boolean
      readonly revision: number
    }): Promise<void> {
      await call({ action: 'publish', ...input, participantId: id, role })
    },
    async clear(workbenchId: string, sessionId?: string, areaId?: string): Promise<void> {
      await call({ action: 'clear', workbenchId, participantId: id, ...(sessionId === undefined ? {} : { sessionId }), ...(areaId === undefined ? {} : { areaId }) })
    },
  }
}

export type WorkbenchSharePresenceClientV1 = ReturnType<typeof createWorkbenchSharePresenceClient>
