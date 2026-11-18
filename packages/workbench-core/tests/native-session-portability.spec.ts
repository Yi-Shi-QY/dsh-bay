import { afterEach, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import * as jsonl from '@deepseek-ai/dsh-session-persistence-jsonl'
import { LocalAttachmentStore } from '@deepseek-ai/dsh-attachment-local'
import { Session, SessionId, SessionLogOffset, SESSION_FORMAT_VERSION, buildForkSeed } from '@deepseek-ai/dsh-session'
import { createAssistantMessage, createUserMessage, createToolResultMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-tool-present/types'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { NativeSessionPortability, portableRelativePath, remapNativeEvent, resolvePortablePath } from '../src/host-native-session-portability.ts'

const disposers: (() => Promise<unknown>)[] = []
afterEach(async () => { const errors: unknown[] = []; for (const dispose of disposers.splice(0).reverse()) { try { await dispose() } catch (error) { errors.push(error) } } if (errors.length) throw new AggregateError(errors) })
async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'bay-portability-'))
  disposers.push(() => rm(root, { recursive: true, force: true }))
  const source = new Context(), target = new Context()
  await jsonl.apply(source, { root: join(root, 'source-store'), compression: 'none' })
  await jsonl.apply(target, { root: join(root, 'target-store'), compression: 'none' })
  disposers.push(() => source.fiber.dispose(), () => target.fiber.dispose())
  const sourceFiles = new LocalAttachmentStore(source, { dshHome: join(root, 'source-files') })
  const targetFiles = new LocalAttachmentStore(target, { dshHome: join(root, 'target-files') })
  const sourceRoot = join(root, 'workbench'), targetRoot = join(root, 'recipient'), snapshotDir = join(root, 'snapshot')
  await mkdir(join(sourceRoot, 'project'), { recursive: true }); await mkdir(join(targetRoot, 'project'), { recursive: true })
  return { root, source, target, sourceFiles, targetFiles, sourceRoot, targetRoot, snapshotDir,
    exporter: new NativeSessionPortability(source.sessionPersistence, sourceFiles), importer: new NativeSessionPortability(target.sessionPersistence, targetFiles) }
}
async function persist(ctx: Context, session: Session, inherited = 0) {
  const handle = await ctx.sessionPersistence.create(session.header, { inheritedEventCount: SessionLogOffset(inherited) })
  try { await handle.append(session.snapshotEvents()); await handle.flush() } finally { await handle.close() }
}

it('round-trips real native logs, binary attachments, a fork and compacted surface into a fresh store and continues', async () => {
  const f = await setup()
  const file = await f.sourceFiles.saveFile({ data: Buffer.from('binary\0attachment'), name: 'evidence.txt' })
  const image = await f.sourceFiles.saveImage({ data: await sharp({ create: { width: 2, height: 2, channels: 3, background: '#ff0000' } }).png().toBuffer(), mediaType: 'image/png', name: 'pixel.png' })
  const original = Session.create(SessionId('main'), [], { version: SESSION_FORMAT_VERSION, id: SessionId('main'), cwd: join(f.sourceRoot, 'project'), createdAt: 1, isSeeded: false })
  original.append('turn/start', { turn: 1 })
  original.append('step/start', { turn: 1, step: 1 })
  const first = original.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'Original path ' + f.sourceRoot }, { type: 'file', attachment: file }, { type: 'image', attachment: image }], source: { kind: 'user' } }), { surfaceOp: 'append' })
  original.append('assistant/message', { turn: 1, step: 1, message: createAssistantMessage({ content: [{ type: 'tool-call', id: ToolCallId('call-1'), name: 'read', arguments: '{"file":"evidence.txt"}' }], source: { provider: 'fixture', model: 'controlled' } }), stream: [] }, { surfaceOp: 'append' })
  original.append('tool/call', { turn: 1, step: 1, callId: ToolCallId('call-1'), name: 'read', arguments: '{"file":"evidence.txt"}' })
  original.append('tool/result', { turn: 1, step: 1, message: createToolResultMessage({ callId: ToolCallId('call-1'), content: [{ type: 'text', text: 'verified' }], isError: false }) }, { surfaceOp: 'append' })
  original.append('assistant/message', { turn: 1, step: 1, message: createAssistantMessage({ content: [{ type: 'text', text: 'Read verified' }], source: { provider: 'fixture', model: 'controlled' } }), stream: [] }, { surfaceOp: 'append' })
  original.append('step/end', { turn: 1, step: 1 })
  original.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'Compacted context' }], source: { kind: 'user' } }), { surfaceOp: { op: 'replace', startSeq: first.seq, endSeq: first.seq }, sourceEventSeqs: [first.seq] })
  original.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  const inherited = original.snapshotEvents().length
  const forkSeed = buildForkSeed(original.snapshotEvents(), original.snapshotEvents().at(-1)!.seq)
  const child = Session.create(SessionId('child'), forkSeed, { version: SESSION_FORMAT_VERSION, id: SessionId('child'), cwd: join(f.sourceRoot, 'project'), parentSession: original.id, origin: 'subagent', delegationDepth: 1, createdAt: 2, isSeeded: true }, SessionLogOffset(inherited))
  await persist(f.source, original); await persist(f.source, child, inherited)
  const snapshot = await f.exporter.exportSnapshot(['main'], f.sourceRoot, f.snapshotDir)
  expect(snapshot.sessions.map(row => row.key).sort()).toEqual(['child', 'main'])
  expect(snapshot.attachments).toHaveLength(2)
  const mapping = { sourceRoot: f.sourceRoot, targetRoot: f.targetRoot, sessionIds: { main: 'import-main', child: 'import-child' } }
  await f.importer.importSnapshot(snapshot, f.snapshotDir, mapping)
  await f.importer.importSnapshot(snapshot, f.snapshotDir, mapping)
  expect(await f.target.sessionPersistence.list()).toHaveLength(2)
  const handle = await f.target.sessionPersistence.open(SessionId('import-child'), 'read')
  const read = await handle.read()
  expect(handle.header.cwd).toBe(join(f.targetRoot, 'project'))
  expect(handle.header.parentSession).toBe('import-main')
  expect(handle.inheritedEventCount).toBe(inherited)
  const restored = Session.fromRestore(handle.id, read.events, handle.header, handle.inheritedEventCount, read.eventState)
  await handle.close()
  expect(restored.deriveMessages()).toEqual(child.deriveMessages())
  restored.append('turn/start', { turn: 2 }); restored.append('step/start', { turn: 2, step: 1 })
  restored.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'Continue the imported task' }], source: { kind: 'user' } }), { surfaceOp: 'append' })
  restored.append('assistant/message', { turn: 2, step: 1, message: createAssistantMessage({ content: [{ type: 'text', text: 'Continued with prior context' }], source: { provider: 'fixture', model: 'controlled' } }), stream: [] }, { surfaceOp: 'append' })
  restored.append('step/end', { turn: 2, step: 1 }); restored.append('turn/end', { turn: 2, reason: { kind: 'completed' } })
  const writer = await f.target.sessionPersistence.open(restored.id, 'write')
  await writer.append(restored.snapshotEvents().slice(read.events.length)); await writer.close()
  const bytes: Buffer[] = []; for await (const chunk of f.targetFiles.readFileStream(file)) bytes.push(Buffer.from(chunk))
  expect(Buffer.concat(bytes)).toEqual(Buffer.from('binary\0attachment'))
  expect((await f.targetFiles.readImage(image)).ref.attachmentId).toBe(image.attachmentId)
})

it('preflights missing attachments before publishing any recipient session', async () => {
  const f = await setup()
  const ref = await f.sourceFiles.saveFile({ data: Buffer.from('evidence'), name: 'proof.txt' })
  const session = Session.create(SessionId('source'), [], { version: SESSION_FORMAT_VERSION, id: SessionId('source'), cwd: f.sourceRoot, createdAt: 1, isSeeded: false })
  session.append('user/message', createUserMessage({ content: [{ type: 'file', attachment: ref }], source: { kind: 'user' } }), { surfaceOp: 'append' })
  await persist(f.source, session)
  const snapshot = await f.exporter.exportSnapshot(['source'], f.sourceRoot, f.snapshotDir)
  snapshot.attachments = []
  await expect(f.importer.importSnapshot(snapshot, f.snapshotDir, { sourceRoot: f.sourceRoot, targetRoot: f.targetRoot, sessionIds: { source: 'recipient' } })).rejects.toThrow('附件清单')
  expect(await f.target.sessionPersistence.list()).toHaveLength(0)
})

it('rebases delivered file paths from the source workbench into the imported workbench', async () => {
  const f = await setup()
  const session = Session.create(SessionId('delivery'), [], { version: SESSION_FORMAT_VERSION, id: SessionId('delivery'), cwd: join(f.sourceRoot, 'project'), createdAt: 1, isSeeded: false })
  session.append('deliverables/presented', { turn: 1, callId: ToolCallId('call-delivered'), files: [
    { path: join(f.sourceRoot, 'project', 'absolute-output.md'), description: 'Absolute path' },
    { path: 'relative-output.md', description: 'Legacy session-relative path' },
  ] })
  await persist(f.source, session)
  const snapshot = await f.exporter.exportSnapshot(['delivery'], f.sourceRoot, f.snapshotDir)
  const mapping = { sourceRoot: f.sourceRoot, targetRoot: f.targetRoot, sessionIds: { delivery: 'import-delivery' } }

  await f.importer.importSnapshot(snapshot, f.snapshotDir, mapping)

  const handle = await f.target.sessionPersistence.open(SessionId('import-delivery'), 'read')
  try {
    const event = (await handle.read()).events.find(row => row.type === 'deliverables/presented')
    expect(event?.data).toMatchObject({ files: [
      { path: join(f.targetRoot, 'project', 'absolute-output.md'), description: 'Absolute path' },
      { path: join(f.targetRoot, 'project', 'relative-output.md'), description: 'Legacy session-relative path' },
    ] })
  } finally { await handle.close() }
})

it('rejects delivered file paths that escape the source workbench before publishing a recipient session', async () => {
  const f = await setup()
  const session = Session.create(SessionId('external-delivery'), [], { version: SESSION_FORMAT_VERSION, id: SessionId('external-delivery'), cwd: join(f.sourceRoot, 'project'), createdAt: 1, isSeeded: false })
  session.append('deliverables/presented', { turn: 1, callId: ToolCallId('call-external'), files: [
    { path: join(f.root, 'outside.md') },
  ] })
  await persist(f.source, session)
  await expect(f.exporter.exportSnapshot(['external-delivery'], f.sourceRoot, f.snapshotDir)).rejects.toThrow('工作台根目录之外')
  expect(await f.target.sessionPersistence.list()).toHaveLength(0)
})

it('understands foreign path dialects and rejects escaping paths', () => {
  expect(portableRelativePath('C:\\Work\\Bay', 'c:\\work\\bay\\app')).toBe('app')
  expect(portableRelativePath('/home/bay', '/home/bay/project')).toBe('project')
  expect(() => portableRelativePath('/home/bay', '/home/bay-other/project')).toThrow()
  expect(() => resolvePortablePath('/tmp/bay', '../outside')).toThrow()
  expect(() => resolvePortablePath('/tmp/bay', 'C:/outside')).toThrow()
  const event = remapNativeEvent({ type: 'deliverables/presented', data: { files: [{ path: 'output.md' }] } } as never, {
    sourceRoot: 'C:\\Work\\Bay', sourceCwd: 'C:\\Work\\Bay\\app', targetRoot: join(tmpdir(), 'recipient'), sessionIds: {},
  })
  expect(event).toMatchObject({ data: { files: [{ path: join(tmpdir(), 'recipient', 'app', 'output.md') }] } })
})

it('carries workspace change markers verbatim; the summary they point to stays on the source Host', () => {
  const context = { sourceRoot: '/home/bay', targetRoot: join(tmpdir(), 'recipient'), sessionIds: {} }
  const marker = { type: 'workspace/changes', seq: 7, data: { turn: 3 } } as never
  expect(remapNativeEvent(marker, context)).toEqual(marker)
  expect(() => remapNativeEvent({ type: 'workspace/changes', data: {} } as never, context)).toThrow('工作区变更记录无效')
  expect(() => remapNativeEvent({ type: 'team/member', data: {} } as never, context)).toThrow('迁移适配器')
})
