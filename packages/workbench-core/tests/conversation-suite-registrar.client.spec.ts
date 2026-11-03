import { describe, expect, it } from 'vitest'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { createWorkbenchConversationSuiteRegistrar } from '../src/client/conversation-suite-registrar.ts'
import { createWorkbenchCoreRuntime } from '../src/core-runtime.ts'
import { WORKBENCH_CORE_MANIFEST } from '../src/core-manifest.ts'

const digest = (character: string): string => character.repeat(64)

function createContext() {
  const injections: string[] = []
  const registrations: Array<{ name: string; id: string }> = []
  const removed: string[] = []
  const slots = {
    inject(name: string, callback: () => unknown) {
      injections.push(name)
      const dispose = callback()
      return typeof dispose === 'function' ? dispose : () => {}
    },
    register(options: { name: string; id: string }, _component: unknown) {
      registrations.push(options)
      return () => { removed.push(options.id) }
    },
  }
  return { ctx: { slots } as unknown as ClientContext, injections, registrations, removed }
}

describe('Conversation Suite Core registrar', () => {
  it('uses only Core-owned editor slots and releases them during cleanup', () => {
    const runtime = createWorkbenchCoreRuntime({ core: WORKBENCH_CORE_MANIFEST })
    const { ctx, injections, registrations, removed } = createContext()
    const registrar = createWorkbenchConversationSuiteRegistrar(ctx, runtime)
    const dispose = registrar.register({
      identity: { moduleId: 'workbench.conversation-suite', version: '0.1.5-alpha.2', artifactDigest: digest('a') },
      editors: { start: () => null, conversation: () => null, trajectory: () => null },
    })

    expect(injections).toEqual(['workbench.editor.root', 'workbench.editor.session', 'workbench.editor.session'])
    expect(registrations.map(({ name, id }) => [name, id])).toEqual([
      ['workbench.editor.root', 'workbench.conversation.start'],
      ['workbench.editor.session', 'workbench.conversation'],
      ['workbench.editor.session', 'workbench.agent-trajectory'],
    ])
    expect(injections).not.toContain('root')
    expect(injections).not.toContain('layout.frame')
    expect(injections).not.toContain('sidebar')
    expect(injections).not.toContain('conversation')
    expect(injections).not.toContain('details')
    expect(runtime.getSnapshot()).toMatchObject({ state: 'modules-ready', activeModules: ['workbench.conversation-suite'] })

    dispose()

    expect(removed).toEqual(['workbench.agent-trajectory', 'workbench.conversation', 'workbench.conversation.start'])
    expect(runtime.getSnapshot()).toMatchObject({ state: 'modules-ready', activeModules: [] })
  })

  it('accepts only the exact Conversation Suite identity and does not replace it', () => {
    const runtime = createWorkbenchCoreRuntime({ core: WORKBENCH_CORE_MANIFEST })
    const { ctx, registrations } = createContext()
    const registrar = createWorkbenchConversationSuiteRegistrar(ctx, runtime)
    const editors = { start: () => null, conversation: () => null, trajectory: () => null }

    expect(() => registrar.register({
      identity: { moduleId: 'workbench.other', version: '0.1.5-alpha.2', artifactDigest: digest('a') }, editors,
    })).toThrow('only accepts the Conversation Suite')
    expect(() => registrar.register({
      identity: { moduleId: 'workbench.conversation-suite', version: '0.1.5-alpha.2', artifactDigest: 'not-a-digest' }, editors,
    })).toThrow('SHA-256 artifact digest')

    const first = registrar.register({
      identity: { moduleId: 'workbench.conversation-suite', version: '0.1.5-alpha.2', artifactDigest: digest('a') }, editors,
    })
    const repeated = registrar.register({
      identity: { moduleId: 'workbench.conversation-suite', version: '0.1.5-alpha.2', artifactDigest: digest('a') }, editors,
    })
    expect(registrations).toHaveLength(3)
    expect(() => registrar.register({
      identity: { moduleId: 'workbench.conversation-suite', version: '0.1.1-rc.3', artifactDigest: digest('b') }, editors,
    })).toThrow('different identity')

    repeated()
    expect(runtime.getSnapshot().state).toBe('modules-ready')
    first()
    expect(runtime.getSnapshot().state).toBe('modules-ready')
  })
})
