import { useCallback, useEffect, useSyncExternalStore } from 'react'
import type { ConversationTabStatus, ConversationTabStatusSource } from './conversation-tab-status.ts'

const EMPTY: ReadonlyMap<string, ConversationTabStatus> = new Map()

export function useConversationTabStatus(source: ConversationTabStatusSource | undefined, sessionIds: readonly string[]) {
  const key = JSON.stringify([...new Set(sessionIds)].sort())
  useEffect(() => source?.watch(JSON.parse(key) as string[]), [source, key])
  const subscribe = useCallback((listener: () => void) => source?.subscribe(listener) ?? (() => {}), [source])
  const read = useCallback(() => source?.getSnapshot() ?? EMPTY, [source])
  return useSyncExternalStore(subscribe, read, read)
}
