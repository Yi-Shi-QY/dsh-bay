import type { WorkbenchSnapshotObject } from './workbench-snapshot.ts'
import {
  flushLiveSessionLog,
  readSessionLogText,
  sessionLogZipEntries,
  type SessionLogExportReady,
  type SessionLogExportDeps,
} from '@deepseek-ai/dsh-session-log-export'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkbenchSessionEntryV1 } from './workbench-directory-contract.ts'

export { formatSessionMarkdown } from '@deepseek-ai/dsh-session-log-export'

/** Narrow seam for @deepseek-ai/dsh-session-log-export RC3. */
export interface WorkbenchSessionCheckpointSource {
  flushLiveSessionLog: (sessionId: string, signal?: AbortSignal) => Promise<void>
  sessionLogZipEntries: (sessionId: string, signal?: AbortSignal) => AsyncIterable<{ path: string; content?: string; data?: Uint8Array; chunks?: AsyncIterable<Uint8Array> }>
}

export interface WorkbenchSessionCheckpointEntry extends WorkbenchSnapshotObject {
  path: string
}

export interface WorkbenchSessionCheckpoint {
  sessionId: string
  entries: readonly WorkbenchSessionCheckpointEntry[]
}

export interface WorkbenchSessionCheckpointRestoreInput {
  readonly entries: readonly { sourceSessionId: string; path: string; content: Uint8Array }[]
  readonly targetRoot: string
  readonly sessionIds: Readonly<Record<string, string>>
  readonly sourceCatalog: Readonly<Record<string, WorkbenchSessionEntryV1>>
}

export interface WorkbenchSessionCheckpointRestorer {
  restore(input: WorkbenchSessionCheckpointRestoreInput, signal?: AbortSignal): Promise<void>
}

/** RC3 services used by the Host-owned native session export API. */
export interface Rc3WorkbenchSessionCheckpointDeps extends SessionLogExportReady {}

/** Build the checkpoint source from the exact RC3 export services. */
export function createRc3WorkbenchSessionCheckpointSource(deps: Rc3WorkbenchSessionCheckpointDeps): WorkbenchSessionCheckpointSource {
  return {
    flushLiveSessionLog: async (sessionId, signal) => {
      await flushLiveSessionLog({ sessions: deps.sessions }, sessionId as SessionId, signal)
    },
    sessionLogZipEntries: async function* (sessionId, signal) {
      const rootContent = await readSessionLogText(deps.sessionPersistence, sessionId as SessionId, signal)
      if (rootContent === undefined) throw new Error('session checkpoint source does not exist')
      for await (const entry of sessionLogZipEntries(deps, rootContent, sessionId as SessionId, true, signal)) yield entry
    },
  }
}

/** Resolve the RC3 export services from a Host dependency bag without persisting credentials. */
export function rc3CheckpointDeps(value: SessionLogExportDeps): Rc3WorkbenchSessionCheckpointDeps {
  if (!value.sessionQuery || !value.sessionPersistence || !value.attachments) throw new Error('RC3 session export services are unavailable')
  return { sessionQuery: value.sessionQuery, sessionPersistence: value.sessionPersistence, attachments: value.attachments, sessions: value.sessions }
}

async function readEntry(entry: { content?: string; data?: Uint8Array; chunks?: AsyncIterable<Uint8Array> }): Promise<Uint8Array> {
  if (entry.data !== undefined) return new Uint8Array(entry.data)
  if (entry.content !== undefined) return new TextEncoder().encode(entry.content)
  if (entry.chunks !== undefined) {
    const chunks: Uint8Array[] = []
    for await (const chunk of entry.chunks) chunks.push(chunk)
    const result = new Uint8Array(chunks.reduce((size, chunk) => size + chunk.byteLength, 0))
    let offset = 0
    for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength }
    return result
  }
  throw new Error('session checkpoint entry has no content')
}

/** Flushes the RC3 live log first, then materializes only a closed checkpoint. */
export async function createWorkbenchSessionCheckpoint(source: WorkbenchSessionCheckpointSource, sessionId: string, signal?: AbortSignal): Promise<WorkbenchSessionCheckpoint> {
  await source.flushLiveSessionLog(sessionId, signal)
  const entries: WorkbenchSessionCheckpointEntry[] = []
  for await (const entry of source.sessionLogZipEntries(sessionId, signal)) {
    signal?.throwIfAborted()
    const content = await readEntry(entry)
    entries.push({ path: entry.path, digest: '', content })
    const current = entries[entries.length - 1]!
    const digest = await crypto.subtle.digest('SHA-256', content as BufferSource)
    current.digest = `sha256:${[...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')}`
  }
  return { sessionId, entries }
}
