import { describe, expect, it } from 'vitest'
import {
  createWorkbenchToolGateway,
  createWorkbenchToolGatewayManager,
  createToolProviderAdaptersV1,
  validateContainerEditorContributionV1,
  validateToolContributionV1,
  type ToolContributionV1,
} from '../src/tool-gateway.ts'

const digest = 'a'.repeat(64)

function tool(overrides: Partial<ToolContributionV1> = {}): ToolContributionV1 {
  return {
    id: 'github.search',
    kind: 'mcp',
    moduleId: 'workbench.github',
    editorId: 'github.tools',
    version: '1.0.0',
    artifactDigest: digest,
    display: { name: 'Search GitHub' },
    execution: { providerId: 'github-provider', reference: { name: 'search' } },
    ...overrides,
  }
}

describe('Workbench Tool Gateway Alpha.15', () => {
  it('accepts all four tool kinds and rejects invalid identity', () => {
    for (const kind of ['mcp', 'cli', 'tool', 'skill'] as const) {
      expect(() => validateToolContributionV1(tool({ id: `example.${kind}`, kind }))).not.toThrow()
    }
    expect(() => validateToolContributionV1(tool({ id: 'bad id' }))).toThrow('id is invalid')
    expect(() => validateToolContributionV1(tool({ artifactDigest: 'bad' }))).toThrow('artifactDigest')
  })

  it('enforces the three container editor types and provider declarations', () => {
    expect(() => validateContainerEditorContributionV1({
      id: 'editor.conversation', moduleId: 'workbench.example', editorId: 'example.conversation',
      type: 'conversation-bound', binding: { kind: 'conversation', target: 'session' },
    })).not.toThrow()
    expect(() => validateContainerEditorContributionV1({
      id: 'editor.tools', moduleId: 'workbench.example', editorId: 'example.tools',
      type: 'standalone-provider', binding: { kind: 'none' }, provides: { mcp: ['github.search'] },
    })).not.toThrow()
    expect(() => validateContainerEditorContributionV1({
      id: 'editor.tools', moduleId: 'workbench.example', editorId: 'example.tools',
      type: 'standalone-provider', binding: { kind: 'none' },
    })).toThrow('must expose')
    expect(() => validateContainerEditorContributionV1({
      id: 'editor.standalone', moduleId: 'workbench.example', editorId: 'example.standalone',
      type: 'standalone', binding: { kind: 'conversation' },
    })).toThrow('cannot require')
    expect(() => validateContainerEditorContributionV1({
      id: 'editor.standalone-tools', moduleId: 'workbench.example', editorId: 'example.standalone-tools',
      type: 'standalone', binding: { kind: 'none' }, provides: { tool: ['example.tool'] },
    })).toThrow('cannot expose')
  })

  it('projects only enabled, authorized and allowlisted tools', async () => {
    const gateway = createWorkbenchToolGateway({
      workbenchId: 'main',
      capabilities: () => ['network'],
      permissions: () => ['github.read'],
      credentials: () => ['github'],
    })
    gateway.register(tool({ requires: { capabilities: ['network'], permissions: ['github.read'], credentials: ['github'] } }))
    gateway.register(tool({ id: 'github.write', display: { name: 'Write GitHub' }, requires: { permissions: ['github.write'] } }))
    gateway.register(tool({ id: 'local.cli', kind: 'cli', display: { name: 'Local CLI' } }))
    await gateway.setAgentAllowlist('reviewer', ['github.search', 'github.write', 'local.cli'])

    const projection = await gateway.projectForAgent('reviewer')
    expect(projection.allowedToolIds).toEqual(['github.search', 'local.cli'])
    expect(projection.tools.map(entry => entry.id)).toEqual(['github.search', 'local.cli'])
    expect(projection.blocked).toEqual(expect.arrayContaining([
      { toolId: 'github.write', reason: '缺少权限：github.write' },
    ]))
  })

  it('supports Workbench visibility, revocation and stable gateway snapshots', async () => {
    const gateway = createWorkbenchToolGateway({ workbenchId: 'main' })
    gateway.register(tool())
    await gateway.setAgentAllowlist('reviewer', ['github.search'])
    const first = await gateway.snapshot()
    const second = await gateway.snapshot()
    expect(first.snapshotDigest).toBe(second.snapshotDigest)
    expect(first.entries[0]).toMatchObject({ toolId: 'github.search', visibility: 'enabled', availability: 'available' })

    await gateway.setVisibility({ toolId: 'github.search', state: 'disabled' })
    expect((await gateway.projectForAgent('reviewer')).allowedToolIds).toEqual([])
    await gateway.setVisibility({ toolId: 'github.search', state: 'enabled' })
    await gateway.setAvailability({ toolId: 'github.search', state: 'revoked', reason: 'provider disabled' })
    expect((await gateway.projectForAgent('reviewer')).blocked).toEqual([{ toolId: 'github.search', reason: 'provider disabled' }])
    await gateway.setAvailability({ toolId: 'github.search', state: 'available' })
    expect((await gateway.projectForAgent('reviewer')).allowedToolIds).toEqual(['github.search'])
    const immutable = await gateway.snapshot()
    expect(Object.isFrozen(immutable)).toBe(true)
    expect(Object.isFrozen(immutable.entries)).toBe(true)
    expect(Object.isFrozen(immutable.agentAllowlists)).toBe(true)
  })

  it('commits module visibility changes atomically and reports unknown tools', async () => {
    const persisted: unknown[] = []
    const gateway = createWorkbenchToolGateway({ workbenchId: 'main', persistPolicy: async policy => { persisted.push(policy) } })
    gateway.register(tool())
    gateway.register(tool({ id: 'github.run', kind: 'cli', display: { name: 'Run GitHub' } }))
    const result = await gateway.setVisibilityBatch({ toolIds: ['github.search', 'github.run', 'missing.tool'], state: 'disabled' })
    expect(result.appliedToolIds).toEqual(['github.search', 'github.run'])
    expect(result.rejected).toEqual([{ toolId: 'missing.tool', reason: 'Unknown tool contribution: missing.tool' }])
    expect(persisted).toHaveLength(1)
    expect(gateway.catalog().every(row => row.visibility === 'disabled')).toBe(true)
  })

  it('keeps editor/tool identity explicit and refuses unsafe removal', () => {
    const gateway = createWorkbenchToolGateway({ workbenchId: 'main' })
    const disposeTool = gateway.register(tool())
    gateway.registerEditor({
      id: 'editor.github', moduleId: 'workbench.github', editorId: 'github.tools',
      type: 'standalone-provider', binding: { kind: 'none' }, provides: { mcp: ['github.search'] },
    })
    expect(() => disposeTool()).toThrow('while editor editor.github exposes it')
    expect(gateway.catalog()).toHaveLength(1)
    expect(gateway.editorCatalog()).toHaveLength(1)
  })

  it('adapts all provider kinds and isolates policy by Workbench', async () => {
    const adapters = createToolProviderAdaptersV1()
    for (const kind of ['mcp', 'cli', 'tool', 'skill'] as const) {
      const { kind: _kind, ...source } = tool({ id: `adapter.${kind}` })
      expect(adapters[kind].adapt(source)).toMatchObject({ kind })
    }
    let active = 'one'
    const persisted: Record<string, unknown> = {}
    const manager = createWorkbenchToolGatewayManager({
      activeWorkbenchId: () => active,
      readPolicy: id => persisted[id] as never,
      persistPolicy: async (id, policy) => { persisted[id] = policy },
    })
    manager.register(tool())
    const one = manager.forWorkbench('one')
    const two = manager.forWorkbench('two')
    await one.setAgentAllowlist('reviewer', ['github.search'])
    await one.setVisibility({ toolId: 'github.search', state: 'disabled' })
    expect((await one.projectForAgent('reviewer')).allowedToolIds).toEqual([])
    expect((await two.projectForAgent('reviewer')).allowedToolIds).toEqual([])
    await two.setAgentAllowlist('reviewer', ['github.search'])
    expect((await two.projectForAgent('reviewer')).allowedToolIds).toEqual(['github.search'])
    active = 'two'
    expect(manager.active().workbenchId).toBe('two')
    const restored = createWorkbenchToolGatewayManager({ activeWorkbenchId: () => 'one', readPolicy: id => persisted[id] as never })
    restored.register(tool())
    expect((await restored.forWorkbench('one').projectForAgent('reviewer')).allowedToolIds).toEqual([])
  })

  it('requires provider declarations to match the exposed tool identity', () => {
    const gateway = createWorkbenchToolGateway({ workbenchId: 'main' })
    gateway.register(tool())
    expect(() => gateway.registerEditor({
      id: 'editor.other', moduleId: 'workbench.other', editorId: 'other.tools',
      type: 'standalone-provider', binding: { kind: 'none' }, provides: { mcp: ['github.search'] },
    })).toThrow('conflicts with tool identity')
  })

  it('copies nested provider declarations before exposing them in the catalog', () => {
    const gateway = createWorkbenchToolGateway({ workbenchId: 'main' })
    const reference = { command: 'search', args: ['initial'] }
    const schema = { input: { type: 'object' } }
    gateway.register(tool({ execution: { providerId: 'github-provider', reference }, schema }))
    reference.args[0] = 'mutated'
    schema.input = { type: 'string' }
    const entry = gateway.catalog()[0]!
    expect(entry.execution.reference).toEqual({ command: 'search', args: ['initial'] })
    expect(entry.schema).toEqual({ input: { type: 'object' } })
  })
})
