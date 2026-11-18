import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import * as jsonl from '@deepseek-ai/dsh-session-persistence-jsonl'
import { LocalAttachmentStore } from '@deepseek-ai/dsh-attachment-local'
import { Session, SessionId, SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { serializeSessionLog } from '@deepseek-ai/dsh-session-log-export'
import { createRc3WorkbenchSessionCheckpointRestorer } from '../src/host-workbench-session-checkpoint.ts'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import sharp from 'sharp'

const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })

describe('RC3 workbench Session checkpoint restore', () => {
  it('creates a recipient-local persisted session with remapped identity and cwd', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dshbay-session-checkpoint-')); roots.push(root)
    const sourceRoot = join(root, 'source'), targetRoot = join(root, 'target')
    const session = Session.create(SessionId('source-session'), [], {
      version: SESSION_FORMAT_VERSION, id: SessionId('source-session'), cwd: join(sourceRoot, 'project'), createdAt: 1, isSeeded: false,
    })
    session.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'portable history' }], source: { kind: 'user' } }), { surfaceOp: 'append' })
    const content = new TextEncoder().encode(serializeSessionLog(session.header, session.snapshotEvents()))
    const context = new Context()
    await jsonl.apply(context, { root: join(root, 'sessions'), compression: 'none' })
    try {
      const restorer = createRc3WorkbenchSessionCheckpointRestorer(context.sessionPersistence)
      await restorer.restore({
        targetRoot,
        sessionIds: { 'source-session': 'recipient-session' },
        sourceCatalog: { 'source-session': { sessionKey: 'main', sessionId: 'source-session', role: 'main', relativePath: 'project', title: 'Main', agentPreset: 'standard', createdAt: 1 } },
        entries: [{ sourceSessionId: 'source-session', path: 'sessions/checkpoints/source-session/session.v2.jsonl', content }],
      })
      const restored = await context.sessionPersistence.open(SessionId('recipient-session'), 'read')
      try {
        expect(restored.header.id).toBe('recipient-session')
        expect(restored.header.cwd).toBe(join(targetRoot, 'project'))
        expect((await restored.read()).events).toHaveLength(session.snapshotEvents().length)
        expect(JSON.stringify((await restored.read()).events)).toContain('portable history')
      } finally { await restored.close() }
    } finally { /* persistence service is scoped to the test context */ }
  })

  it('rejects a checkpoint whose required source mapping is absent', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dshbay-session-checkpoint-missing-')); roots.push(root)
    const context = new Context()
    await jsonl.apply(context, { root: join(root, 'sessions'), compression: 'none' })
    try {
      const restorer = createRc3WorkbenchSessionCheckpointRestorer(context.sessionPersistence)
      const content = new TextEncoder().encode(JSON.stringify({ type: 'session', version: SESSION_FORMAT_VERSION, id: 'missing', createdAt: 1, isSeeded: false }) + '\n')
      await expect(restorer.restore({ targetRoot: root, sessionIds: {}, sourceCatalog: {}, entries: [{ sourceSessionId: 'missing', path: 'sessions/checkpoints/missing/session.v2.jsonl', content }] })).rejects.toThrow('mapping is missing')
    } finally { /* persistence service is scoped to the test context */ }
  })

  it('restores RC3 media and file attachments before publishing the Session', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dshbay-session-checkpoint-attachments-')); roots.push(root)
    const source = new Context(), target = new Context()
    await jsonl.apply(target, { root: join(root, 'target-sessions'), compression: 'none' })
    const sourceFiles = new LocalAttachmentStore(source, { dshHome: join(root, 'source-files') })
    const targetFiles = new LocalAttachmentStore(target, { dshHome: join(root, 'target-files') })
    const file = await sourceFiles.saveFile({ data: Buffer.from('checkpoint file'), name: 'proof.txt' })
    const image = await sourceFiles.saveImage({ data: await sharp({ create: { width: 2, height: 2, channels: 3, background: '#00ff00' } }).png().toBuffer(), mediaType: 'image/png', name: 'proof.png' })
    const session = Session.create(SessionId('source-session'), [], { version: SESSION_FORMAT_VERSION, id: SessionId('source-session'), createdAt: 1, isSeeded: false })
    session.append('user/message', createUserMessage({ content: [{ type: 'file', attachment: file }, { type: 'image', attachment: image }], source: { kind: 'user' } }), { surfaceOp: 'append' })
    const content = new TextEncoder().encode(serializeSessionLog(session.header, session.snapshotEvents()))
    const fileDigest = String(file.attachmentId).replace(/^sha256:/u, '')
    const restorer = createRc3WorkbenchSessionCheckpointRestorer(target.sessionPersistence, targetFiles)
    try {
      await restorer.restore({
        targetRoot: join(root, 'target'),
        sessionIds: { 'source-session': 'recipient-session' },
        sourceCatalog: {},
        entries: [
          { sourceSessionId: 'source-session', path: 'sessions/checkpoints/source-session/session.v2.jsonl', content },
          { sourceSessionId: 'source-session', path: `sessions/checkpoints/source-session/media/${String(image.attachmentId)}.png`, content: await sourceFiles.readImage(image).then(value => value.data) },
          { sourceSessionId: 'source-session', path: `sessions/checkpoints/source-session/files/${fileDigest.slice(0, 2)}/${fileDigest}/${file.name}`, content: new TextEncoder().encode('checkpoint file') },
        ],
      })
      const restored = await target.sessionPersistence.open(SessionId('recipient-session'), 'read')
      try { expect((await restored.read()).events).toHaveLength(session.snapshotEvents().length) } finally { await restored.close() }
      const chunks: Uint8Array[] = []; for await (const chunk of targetFiles.readFileStream(file)) chunks.push(chunk)
      expect(new TextDecoder().decode(Buffer.concat(chunks))).toBe('checkpoint file')
      expect((await targetFiles.readImage(image)).ref.attachmentId).toBe(image.attachmentId)
    } finally { source.fiber.dispose(); target.fiber.dispose() }
  })
})
