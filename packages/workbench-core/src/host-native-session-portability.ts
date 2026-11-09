import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, open, readFile, writeFile } from 'node:fs/promises'
import { isDeepStrictEqual } from 'node:util'
import path from 'node:path'
import { createInterface } from 'node:readline'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import { Session, SessionId, SessionLogOffset, KNOWN_SESSION_EVENT_TYPES, type SessionEvent, type SessionHeader } from '@deepseek-ai/dsh-session'
import { restoreReleasedV4Artifact } from '@deepseek-ai/dsh-session-format-v3-to-v4'
import type { SessionFormatArtifact } from '@deepseek-ai/dsh-session-format'
import { assertContiguous, materializeCreateHeader, validateStoredEvents, type SessionPersistence } from '@deepseek-ai/dsh-session-persistence'
import type { AttachmentStore, FileAttachmentRef, ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'

/** Logical snapshots deliberately do not copy the backend's physical files. */
export interface PortableNativeSession {
  key: string
  header: SessionHeader
  relativeCwd?: string
  inheritedEventCount: number
  eventCount: number
  log: string
  sha256: string
}
export type PortableAttachment = { kind: 'file'; ref: FileAttachmentRef; file: string; sha256: string }
  | { kind: 'image'; ref: ImageAttachmentRef; file: string; sha256: string }
export interface NativeSessionSnapshot {
  version: 1
  sourceRoot: string
  sessions: PortableNativeSession[]
  attachments: PortableAttachment[]
}
export interface NativeSessionRemap {
  sessionIds: Readonly<Record<string, string>>
  sourceRoot: string
  targetRoot: string
}
export type NativeEventRemapper = (event: SessionEvent, context: NativeSessionRemap) => SessionEvent

const digest = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex')
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)

/** Source path dialect is chosen from the source, never from the recipient OS. */
export function portableRelativePath(root: string, absolute: string): string {
  const dialect = /^[A-Za-z]:[\\/]|^\\\\/u.test(root) ? path.win32 : path.posix
  if (!dialect.isAbsolute(root) || !dialect.isAbsolute(absolute)) throw new Error('会话项目必须是绝对路径。')
  const relative = dialect.relative(root, absolute)
  if (dialect.isAbsolute(relative) || relative === '..' || relative.startsWith('..' + dialect.sep)) throw new Error('会话引用了工作台根目录之外的项目。')
  return relative.split(dialect.sep).join('/')
}
export function resolvePortablePath(root: string, relative: string): string {
  if (relative && (relative.includes('\\') || relative.startsWith('/') || relative.split('/').some(part => !part || part === '.' || part === '..' || part.includes(':')))) throw new Error('包内相对路径无效。')
  const target = path.resolve(root, ...relative.split('/'))
  portableRelativePath(path.resolve(root), target)
  return target
}
function mappedSession(id: unknown, context: NativeSessionRemap): string {
  if (typeof id !== 'string' || !Object.hasOwn(context.sessionIds, id)) throw new Error('会话引用缺少身份映射。')
  return context.sessionIds[id]!
}

/** Only schema-owned fields are changed; natural-language history stays verbatim. */
export function remapNativeEvent(event: SessionEvent, context: NativeSessionRemap): SessionEvent {
  const copy = structuredClone(event)
  const row = copy as unknown as { type: string; data: Record<string, unknown> }
  if (row.type === 'subagent/catalog') {
    if (row.data.mode === 'external') throw new Error('外部子任务需要 Runtime 会话迁移适配器。')
    row.data.childId = mappedSession(row.data.childId, context)
  } else if (row.type === 'working-directory/change') {
    if (typeof row.data.cwd !== 'string') throw new Error('会话工作目录记录无效。')
    row.data.cwd = resolvePortablePath(context.targetRoot, portableRelativePath(context.sourceRoot, row.data.cwd))
  } else if (row.type === 'session-log-deepseek/delivery-accepted') {
    row.data.sessionId = mappedSession(row.data.sessionId, context)
  } else if (row.type.startsWith('team/') || row.type.startsWith('tool-workflow/') || row.type === 'deliverables/presented' || row.type === 'workspace/changes') {
    throw new Error('该会话资源需要已注册的迁移适配器：' + row.type)
  }
  return copy
}

/** Collect typed binary references, including references retained by compaction. */
function attachmentRefs(value: unknown, result: Map<string, Omit<PortableAttachment, 'file' | 'sha256'>>): void {
  if (Array.isArray(value)) { for (const child of value) attachmentRefs(child, result); return }
  if (!object(value)) return
  if ((value.type === 'image' || value.type === 'file') && object(value.attachment)) {
    const ref = value.attachment
    if (typeof ref.attachmentId !== 'string' || !Number.isSafeInteger(ref.bytes) || Number(ref.bytes) < 0) throw new Error('会话附件引用无效。')
    const key = value.type + ':' + ref.attachmentId + ':' + String(ref.name ?? '')
    result.set(key, value.type === 'image' ? { kind: 'image', ref: ref as unknown as ImageAttachmentRef } : { kind: 'file', ref: ref as unknown as FileAttachmentRef })
  }
  for (const child of Object.values(value)) attachmentRefs(child, result)
}
async function fileDigest(file: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  return hash.digest('hex')
}
async function* readEvents(file: string): AsyncGenerator<SessionEvent> {
  const stream = createReadStream(file, { encoding: 'utf8' })
  const lines = createInterface({ input: stream, crlfDelay: Infinity })
  try { for await (const line of lines) { if (!line.trim()) throw new Error('会话快照含空记录。'); yield JSON.parse(line) as SessionEvent } }
  finally { lines.close(); stream.destroy() }
}

export class NativeSessionPortability {
  constructor(private readonly persistence: SessionPersistence, private readonly attachments?: AttachmentStore,
    private readonly adapters: ReadonlyMap<string, NativeEventRemapper> = new Map()) {}

  async exportSnapshot(sessionIds: readonly string[], sourceRoot: string, directory: string, signal?: AbortSignal): Promise<NativeSessionSnapshot> {
    await mkdir(path.join(directory, 'sessions'), { recursive: true })
    await mkdir(path.join(directory, 'attachments'), { recursive: true })
    await this.persistence.flush()
    const snapshots = await this.persistence.list(), byId = new Map(snapshots.map(row => [String(row.header.id), row.header]))
    const queue = [...new Set(sessionIds)], seen = new Set<string>()
    const refs = new Map<string, Omit<PortableAttachment, 'file' | 'sha256'>>()
    const result: NativeSessionSnapshot = { version: 1, sourceRoot, sessions: [], attachments: [] }
    for (let i = 0; i < queue.length; i++) {
      signal?.throwIfAborted()
      const id = queue[i]!
      if (seen.has(id)) continue
      seen.add(id)
      const handle = await this.persistence.open(SessionId(id), 'read')
      try {
        const header = handle.header, log = 'sessions/' + digest(id) + '.ndjson'
        if (header.parentSession) queue.push(header.parentSession)
        for (const [childId, child] of byId) if (child.parentSession === id && child.origin === 'subagent') queue.push(childId)
        const row: PortableNativeSession = { key: id, header: structuredClone(header), inheritedEventCount: handle.inheritedEventCount, eventCount: 0, log, sha256: '',
          ...(header.cwd === undefined ? {} : { relativeCwd: portableRelativePath(sourceRoot, header.cwd) }) }
        const output = await open(resolvePortablePath(directory, log), 'w')
        try {
          for (let offset = 0;;) {
            signal?.throwIfAborted()
            const { events } = await handle.read(offset, 256, signal ? { signal } : {})
            if (!events.length) break
            for (const event of events) {
              attachmentRefs(event.data, refs)
              const data = event.data as unknown
              if (String(event.type) === 'subagent/catalog' && object(data) && typeof data.childId === 'string') {
                if (data.mode === 'external') throw new Error('外部子任务尚未提供会话迁移能力。')
                queue.push(data.childId)
              }
            }
            await output.writeFile(events.map(event => JSON.stringify(event) + '\n').join(''))
            offset += events.length; row.eventCount = offset
          }
          await output.sync()
        } finally { await output.close() }
        row.sha256 = await fileDigest(resolvePortablePath(directory, log))
        result.sessions.push(row)
      } finally { await handle.close() }
    }
    for (const [key, attachment] of refs) {
      signal?.throwIfAborted()
      if (!this.attachments) throw new Error('附件服务不可用，不能导出完整会话。')
      const file = 'attachments/' + digest(key), target = resolvePortablePath(directory, file)
      if (attachment.kind === 'image') {
        const image = await this.attachments.readImage(attachment.ref as ImageAttachmentRef, signal)
        await writeFile(target, image.data)
      } else {
        await pipeline(Readable.from(this.attachments.readFileStream(attachment.ref as FileAttachmentRef, signal)), createWriteStream(target), signal ? { signal } : {})
      }
      result.attachments.push({ ...attachment, file, sha256: await fileDigest(target) } as PortableAttachment)
    }
    await writeFile(path.join(directory, 'native-sessions.json'), JSON.stringify(result), 'utf8')
    return result
  }

  private async prepared(row: PortableNativeSession, snapshot: NativeSessionSnapshot, directory: string, context: NativeSessionRemap) {
    if (await fileDigest(resolvePortablePath(directory, row.log)) !== row.sha256) throw new Error('会话日志摘要不一致。')
    const header = materializeCreateHeader({ ...row.header, id: SessionId(mappedSession(row.key, context)),
      ...(row.header.parentSession ? { parentSession: SessionId(mappedSession(row.header.parentSession, context)) } : {}),
      ...(row.relativeCwd === undefined ? {} : { cwd: resolvePortablePath(context.targetRoot, row.relativeCwd) }) })
    if (row.header.id !== row.key || (row.header.cwd !== undefined && row.relativeCwd !== portableRelativePath(snapshot.sourceRoot, row.header.cwd))) throw new Error('会话路径或身份清单不一致。')
    const events: SessionEvent[] = []
    for await (const event of readEvents(resolvePortablePath(directory, row.log))) {
      const remap = this.adapters.get(String(event.type)) ?? remapNativeEvent
      events.push(remap(event, context))
    }
    if (events.length !== row.eventCount) throw new Error('会话事件清单不完整。')
    assertContiguous(header.id, events, 0)
    validateStoredEvents(header, events)
    restoreReleasedV4Artifact({ header, events, inheritedEventCount: row.inheritedEventCount } as unknown as SessionFormatArtifact, KNOWN_SESSION_EVENT_TYPES)
    const refs = new Map<string, Omit<PortableAttachment, 'file' | 'sha256'>>()
    for (const event of events) attachmentRefs(event.data, refs)
    for (const expected of refs.values()) {
      if (!snapshot.attachments.some(entry => entry.kind === expected.kind && isDeepStrictEqual(entry.ref, expected.ref))) throw new Error('附件清单缺少会话引用。')
    }
    // Validates the surface graph and fork cut without publishing a live agent.
    const restored = Session.fromRestore(header.id, events, header, SessionLogOffset(row.inheritedEventCount), 'shared-frozen')
    restored.deriveMessages()
    return { header, events }
  }

  /** Caller persists the complete ID map before invoking this method. No agent is activated. */
  async importSnapshot(snapshot: NativeSessionSnapshot, directory: string, context: NativeSessionRemap, signal?: AbortSignal): Promise<void> {
    if (snapshot.version !== 1 || context.sourceRoot !== snapshot.sourceRoot) throw new Error('不支持的会话快照。')
    const keys = new Set(snapshot.sessions.map(row => row.key))
    const targets = snapshot.sessions.map(row => mappedSession(row.key, context))
    if (keys.size !== snapshot.sessions.length || new Set(targets).size !== targets.length || targets.some(id => keys.has(id))) throw new Error('导入会话必须使用独立且唯一的新身份。')
    // Validate every source before creating any native Session. At most one log is materialized.
    for (const row of snapshot.sessions) { signal?.throwIfAborted(); await this.prepared(row, snapshot, directory, context) }
    for (const entry of snapshot.attachments) {
      signal?.throwIfAborted()
      if (!this.attachments || await fileDigest(resolvePortablePath(directory, entry.file)) !== entry.sha256) throw new Error('会话附件缺失或校验失败。')
      if (entry.kind === 'image') await this.attachments.validateImage({ data: await readFile(resolvePortablePath(directory, entry.file)), mediaType: entry.ref.mediaType, ...(entry.ref.name ? { name: entry.ref.name } : {}) })
    }
    for (const entry of snapshot.attachments) {
      signal?.throwIfAborted()
      const file = resolvePortablePath(directory, entry.file)
      const restored = entry.kind === 'image'
        ? await this.attachments!.saveImage({ data: await readFile(file), mediaType: entry.ref.mediaType, ...(entry.ref.name ? { name: entry.ref.name } : {}) })
        : await this.attachments!.saveFileStream({ data: createReadStream(file), name: entry.ref.name, ...(signal ? { signal } : {}) })
      if (restored.attachmentId !== entry.ref.attachmentId || restored.bytes !== entry.ref.bytes) throw new Error('接收方附件转换改变了内容，无法完整恢复。')
      if (entry.kind === 'image' && ('width' in restored && (restored.width !== entry.ref.width || restored.height !== entry.ref.height || restored.mediaType !== entry.ref.mediaType))) throw new Error('图片尺寸或格式恢复不一致。')
    }
    for (const row of snapshot.sessions) {
      signal?.throwIfAborted()
      const { header, events } = await this.prepared(row, snapshot, directory, context)
      const existing = await this.persistence.stat(header.id)
      const handle = existing ? await this.persistence.open(header.id, 'write') : await this.persistence.create(header, { inheritedEventCount: SessionLogOffset(row.inheritedEventCount) })
      try {
        if (!isDeepStrictEqual(handle.header, header) || handle.inheritedEventCount !== row.inheritedEventCount) throw new Error('导入会话身份已被其他数据占用。')
        let offset = 0
        for (;;) {
          const current = await handle.read(offset, 256)
          if (!current.events.length) break
          if (!isDeepStrictEqual(current.events, events.slice(offset, offset + current.events.length))) throw new Error('导入进度与现有会话事件不一致。')
          offset += current.events.length
        }
        for (; offset < events.length; offset += 256) {
          signal?.throwIfAborted()
          await handle.append(events.slice(offset, offset + 256), signal ? { signal } : {})
          await handle.flush(signal ? { signal } : {})
        }
        await handle.flush()
      } finally { await handle.close() }
    }
  }
}
