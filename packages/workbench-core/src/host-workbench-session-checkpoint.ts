import path from 'node:path'
import { SessionId, type SessionEvent, type SessionHeader } from '@deepseek-ai/dsh-session'
import { assertContiguous, materializeCreateHeader, validateStoredEvents, type SessionPersistence } from '@deepseek-ai/dsh-session-persistence'
import type { AttachmentStore, FileAttachmentRef, ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { WorkbenchSessionEntryV1 } from './workbench-directory-contract.ts'
import { remapNativeEvent } from './host-native-session-portability.ts'
import type { WorkbenchSessionCheckpointRestoreInput, WorkbenchSessionCheckpointRestorer } from './workbench-session-checkpoint.ts'

function decodeJsonl(content: Uint8Array): { header: SessionHeader; events: SessionEvent[] } {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(content)
  const lines = text.split(/\r?\n/u).filter(line => line.length > 0)
  if (lines.length < 1) throw new Error('session checkpoint is empty')
  let header: SessionHeader
  try {
    const value = JSON.parse(lines[0]!) as Record<string, unknown>
    if (value.type !== 'session') throw new Error('missing session header')
    const { type: _type, ...candidate } = value
    header = candidate as unknown as SessionHeader
  } catch (error) {
    throw new Error(`invalid session checkpoint header: ${error instanceof Error ? error.message : String(error)}`)
  }
  const events: SessionEvent[] = []
  for (const line of lines.slice(1)) {
    try { events.push(JSON.parse(line) as SessionEvent) }
    catch (error) { throw new Error(`invalid session checkpoint event: ${error instanceof Error ? error.message : String(error)}`) }
  }
  return { header, events }
}

function checkpointSessionId(value: string): string | undefined {
  const parts = value.split('/')
  if (parts.length < 2 || parts[0] !== 'sessions' || parts[1] !== 'checkpoints') return undefined
  const relative = parts.slice(3)
  const group = parts[2]
  if (!group || relative.length === 0) return undefined
  if (relative[0] === 'subagents' && relative[1] && relative.length >= 3) return relative[1]
  if (/^session(?:\.v\d+)?\.jsonl$/u.test(relative[0]!)) return group
  return undefined
}

function checkpointLogPath(value: string): boolean {
  const parts = value.split('/')
  if (parts.length < 4 || parts[0] !== 'sessions' || parts[1] !== 'checkpoints') return false
  const relative = parts.slice(3)
  return /^session(?:\.v\d+)?\.jsonl$/u.test(relative[0]!) || (relative[0] === 'subagents' && /^session(?:\.v\d+)?\.jsonl$/u.test(relative[2] ?? ''))
}

function inheritedEventCount(events: readonly SessionEvent[], seeded: boolean): number {
  if (!seeded) return 0
  const marker = events.find(event => event.type === 'session/end-seed' && (event.data as { inherited?: unknown } | undefined)?.inherited === true)
  if (!marker || !Number.isSafeInteger(marker.seq) || marker.seq < 1) throw new Error('seeded session checkpoint is missing its inherited boundary')
  return marker.seq - 1
}

function sourceCatalogValue(input: WorkbenchSessionCheckpointRestoreInput, sourceId: string): WorkbenchSessionEntryV1 | undefined {
  return input.sourceCatalog[sourceId]
}

type CheckpointAttachment = { kind: 'image'; ref: ImageAttachmentRef } | { kind: 'file'; ref: FileAttachmentRef }

function collectAttachmentRefs(value: unknown, result: Map<string, CheckpointAttachment>): void {
  if (Array.isArray(value)) { for (const child of value) collectAttachmentRefs(child, result); return }
  if (typeof value !== 'object' || value === null) return
  const row = value as Record<string, unknown>
  if ((row.type === 'image' || row.type === 'file') && typeof row.attachment === 'object' && row.attachment !== null) {
    const ref = row.attachment as Partial<ImageAttachmentRef & FileAttachmentRef>
    if (typeof ref.attachmentId !== 'string' || !Number.isSafeInteger(ref.bytes) || ref.bytes === undefined || ref.bytes < 0) throw new Error('session checkpoint attachment reference is invalid')
    const kind = row.type
    const key = `${kind}:${String(ref.attachmentId)}:${typeof ref.name === 'string' ? ref.name : ''}`
    result.set(key, { kind, ref: ref as ImageAttachmentRef & FileAttachmentRef })
  }
  for (const child of Object.values(row)) collectAttachmentRefs(child, result)
}

function safeFileName(name: string): string {
  const value = name.replace(/[\\/\u0000-\u001f\u007f]/gu, '_')
  return value === '.' || value === '..' || value === '' ? 'file' : value
}

function imagePath(ref: ImageAttachmentRef): string {
  const extensions: Record<ImageAttachmentRef['mediaType'], string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' }
  return `media/${String(ref.attachmentId)}.${extensions[ref.mediaType]}`
}

function filePath(ref: FileAttachmentRef): string {
  const digest = String(ref.attachmentId).replace(/^sha256:/u, '')
  return `files/${digest.slice(0, 2)}/${digest}/${safeFileName(ref.name)}`
}

function checkpointRelativePath(value: string): string | undefined {
  const marker = 'sessions/checkpoints/'
  if (!value.startsWith(marker)) return undefined
  const rest = value.slice(marker.length)
  const slash = rest.indexOf('/')
  return slash < 1 ? undefined : rest.slice(slash + 1)
}

async function* oneChunk(content: Uint8Array): AsyncIterable<Uint8Array> { yield content }

async function restoreCheckpointAttachments(input: WorkbenchSessionCheckpointRestoreInput, logs: ReadonlyMap<string, { events: readonly SessionEvent[] }>, attachments: AttachmentStore | undefined, signal?: AbortSignal): Promise<void> {
  const refs = new Map<string, CheckpointAttachment>()
  for (const parsed of logs.values()) for (const event of parsed.events) collectAttachmentRefs(event, refs)
  const payload = new Map<string, Uint8Array>()
  for (const entry of input.entries) {
    const relative = checkpointRelativePath(entry.path)
    if (relative === 'attachments-missing.txt') throw new Error('Session checkpoint is missing one or more attachments')
    if (relative?.startsWith('media/') || relative?.startsWith('files/')) payload.set(relative, entry.content)
  }
  if (refs.size === 0) return
  if (!attachments) throw new Error('Session checkpoint attachments cannot be restored because the attachment service is unavailable')
  for (const { kind, ref } of refs.values()) {
    signal?.throwIfAborted()
    const expectedPath = kind === 'image' ? imagePath(ref as ImageAttachmentRef) : filePath(ref as FileAttachmentRef)
    const content = payload.get(expectedPath)
    if (!content || content.byteLength !== ref.bytes) throw new Error(`Session checkpoint attachment is missing or has the wrong size: ${expectedPath}`)
    if (kind === 'image') {
      const image = ref as ImageAttachmentRef
      await attachments.validateImage({ data: content, mediaType: image.mediaType, ...(image.name === undefined ? {} : { name: image.name }) })
      const restored = await attachments.saveImage({ data: content, mediaType: image.mediaType, ...(image.name === undefined ? {} : { name: image.name }) })
      if (String(restored.attachmentId) !== String(image.attachmentId) || restored.bytes !== image.bytes || restored.width !== image.width || restored.height !== image.height || restored.mediaType !== image.mediaType) throw new Error(`Session checkpoint image attachment changed during restore: ${expectedPath}`)
    } else {
      const file = ref as FileAttachmentRef
      const restored = await attachments.saveFileStream({ data: oneChunk(content), name: file.name })
      if (String(restored.attachmentId) !== String(file.attachmentId) || restored.bytes !== file.bytes || restored.name !== file.name) throw new Error(`Session checkpoint file attachment changed during restore: ${expectedPath}`)
    }
  }
}

/** Restore RC3 JSONL checkpoints as inactive, recipient-local Sessions. */
export function createRc3WorkbenchSessionCheckpointRestorer(persistence: SessionPersistence, attachments?: AttachmentStore): WorkbenchSessionCheckpointRestorer {
  return {
    async restore(input, signal) {
      const logs = new Map<string, { header: SessionHeader; events: SessionEvent[] }>()
      for (const entry of input.entries) {
        signal?.throwIfAborted()
        if (!checkpointLogPath(entry.path)) continue
        const sourceId = checkpointSessionId(entry.path)
        if (!sourceId) continue
        const parsed = decodeJsonl(entry.content)
        const prior = logs.get(sourceId)
        if (prior) {
          if (JSON.stringify(prior.header) !== JSON.stringify(parsed.header) || JSON.stringify(prior.events) !== JSON.stringify(parsed.events)) throw new Error(`duplicate Session checkpoint differs: ${sourceId}`)
          continue
        }
        logs.set(sourceId, parsed)
      }
      if (logs.size === 0) return
      for (const sourceId of logs.keys()) if (!input.sessionIds[sourceId]) throw new Error(`Session checkpoint mapping is missing: ${sourceId}`)
      await restoreCheckpointAttachments(input, logs, attachments, signal)
      const ordered = [...logs.entries()].sort(([left], [right]) => left.localeCompare(right, 'en'))
      for (const [sourceId, parsed] of ordered) {
        signal?.throwIfAborted()
        const source = sourceCatalogValue(input, sourceId)
        const sourceCwd = parsed.header.cwd
        const targetCwd = source?.relativePath === undefined ? input.targetRoot : path.resolve(input.targetRoot, source.relativePath)
        const context = {
          sourceRoot: sourceCwd ?? targetCwd,
          targetRoot: targetCwd,
          sessionIds: input.sessionIds,
          ...(sourceCwd === undefined ? {} : { sourceCwd }),
        }
        const header = materializeCreateHeader({
          ...parsed.header,
          id: SessionId(input.sessionIds[sourceId]!),
          ...(sourceCwd === undefined ? {} : { cwd: targetCwd }),
          ...(parsed.header.parentSession === undefined ? {} : { parentSession: SessionId(input.sessionIds[parsed.header.parentSession] ?? parsed.header.parentSession) }),
        })
        const events = parsed.events.map(event => remapNativeEvent(event, context))
        assertContiguous(header.id, events, 0)
        validateStoredEvents(header, events)
        const inherited = inheritedEventCount(events, header.isSeeded)
        const handle = await persistence.create(header, { inheritedEventCount: inherited as never })
        try {
          for (let offset = 0; offset < events.length; offset += 256) {
            await handle.append(events.slice(offset, offset + 256), signal ? { signal } : {})
            await handle.flush(signal ? { signal } : {})
          }
          await handle.flush(signal ? { signal } : {})
        } finally { await handle.close() }
      }
    },
  }
}
