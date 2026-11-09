import { afterEach, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LlmRuntime, { LlmAdapter, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolsService from '@deepseek-ai/dsh-tools'
import { apply as applyNativeToolExecutor } from '@deepseek-ai/dsh-tool-executor-native'
import TokenMeter from '@deepseek-ai/dsh-token-meter'
import BasicCompactionEngine from '@deepseek-ai/dsh-compaction-basic'
import * as jsonl from '@deepseek-ai/dsh-session-persistence-jsonl'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createUserMessage } from '@deepseek-ai/dsh-llm'

class FakeAdapter extends LlmAdapter {
  constructor(private readonly contextWindow = 4096) { super() }
  readonly calls: GenerateOptions[] = []
  providerInfo(provider: string) { return { id: provider, name: 'Bay test model' } }
  async resolveModel(provider: string, model: string) {
    return { provider, id: model, name: model, context: { contextWindow: this.contextWindow }, defaultMaxTokens: 64 }
  }
  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.calls.push(options)
    const text = options.purpose === 'compaction' ? 'Compaction checkpoint: preserve the task and important decisions.' : 'ack'
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text }
    yield { type: 'block-end', index: 0, block: { type: 'text', text } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

const contexts: Context[] = []
afterEach(async () => { for (const ctx of contexts.splice(0).reverse()) await ctx.fiber.dispose() })

async function fixture() {
  const root = new Context()
  const storage = mkdtempSync(join(tmpdir(), 'bay-native-compaction-'))
  contexts.push(root)
  await root.plugin(SessionProjectionRegistry)
  await root.plugin(SessionStore)
  await root.plugin(AgentRegistry)
  await root.plugin(LlmRuntime)
  await root.plugin(SystemPrompt)
  await root.plugin(ToolsService)
  await root.plugin({ apply: applyNativeToolExecutor, inject: ['tools'] })
  await root.plugin(TokenMeter)
  await jsonl.apply(root, { root: storage, compression: 'none' })
  const adapter = new FakeAdapter()
  root.llm.registerAdapter(['fake'], adapter)
  await root.plugin(AgentLoop, { agents: [] })
  await root.plugin(BasicCompactionEngine, { thresholdRatio: 0.5, headroomTokens: 1, retainTokens: 1, maxTokens: 64 })
  return { root, adapter, storage }
}

it('runs native Bay-style Session compaction and resumes the same durable history', async () => {
  const { root, adapter, storage } = await fixture()
  try {
    const handle = await root.agents.create({ sessionId: 'bay-native-compaction', agentOptions: { provider: 'fake', model: 'tiny', maxTokens: 64 }, meta: { cwd: process.cwd() } })
    const agent = handle.agent
    for (let index = 0; index < 10; index++) {
      agent.followup(createUserMessage({ content: [{ type: 'text', text: `Long Bay task context ${index} ${'x'.repeat(180)}` }], source: { kind: 'user' } }))
      await agent.whenIdle()
    }
    const result = await root.compaction.compactNow(agent, new AbortController().signal)
    await root.sessionPersistence.flush()
    const events = agent.session.snapshotEvents()
    expect(result).not.toBeNull()
    expect(events.some(event => event.type === 'compaction/start')).toBe(true)
    expect(events.some(event => event.type === 'compaction/summary')).toBe(true)
    expect(events.some(event => event.type === 'compaction/end')).toBe(true)
    expect(events.some(event => event.type === 'user/message' && event.data.source.kind === 'compact-checkpoint')).toBe(true)
    const session = await root.sessionPersistence.open('bay-native-compaction' as never, 'read')
    const persisted = await session.read()
    await session.close()
    expect(persisted.events.some(event => event.type === 'compaction/end')).toBe(true)
    await handle.dispose()
    const resumed = await root.agents.resume({ resumeSessionId: 'bay-native-compaction' as never, agentOptions: { provider: 'fake', model: 'tiny', maxTokens: 64 } })
    resumed.agent.followup(createUserMessage({ content: [{ type: 'text', text: '继续压缩后的任务' }], source: { kind: 'user' } }))
    await resumed.agent.whenIdle()
    expect(resumed.agent.session.snapshotEvents().some(event => event.type === 'assistant/message')).toBe(true)
    expect(adapter.calls.some(call => call.purpose === 'compaction')).toBe(true)
    await resumed.dispose()
  } finally {
    await root.fiber.dispose()
    rmSync(storage, { recursive: true, force: true })
  }
})
