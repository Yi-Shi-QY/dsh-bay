// @vitest-environment jsdom
import React from 'react'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorkbenchAgentAssemblyDialog, type AgentAssemblyClientV1, type AgentAssemblyDraftV1, type AgentAssemblyRowV1 } from '../src/foundation/WorkbenchAgentAssemblyDialog.tsx'
import type { ToolCatalogEntryV1, WorkbenchToolGatewayV1 } from '../src/tool-gateway.ts'
import type { WorkbenchAgentDefinitionV1 } from '../src/agent-assembly-model.ts'

afterEach(() => cleanup())

const entry = (overrides: Partial<ToolCatalogEntryV1> = {}): ToolCatalogEntryV1 => ({
  id: 'workbench.quote.lookup', kind: 'tool', moduleId: 'workbench.quote', editorId: 'quote.page', version: '1.0.0',
  display: { name: '查询报价', description: '按客户读取报价单' }, execution: { providerId: 'quote-provider', reference: { name: 'lookup' } },
  visibility: 'enabled', availability: 'available', ...overrides,
})

const saved = (input: AgentAssemblyDraftV1): WorkbenchAgentDefinitionV1 => ({
  schemaVersion: 1, agentId: input.agentId, name: input.name, description: input.description, basePreset: input.basePreset,
  tools: input.tools, skills: input.skills, blocks: input.blocks, ...(input.instructions === undefined ? {} : { instructions: input.instructions }),
  guestAccess: input.guestAccess, revision: 1, origin: { kind: 'manual' }, updatedAt: '2026-11-15T00:00:00.000Z',
})

const rowOf = (definition: WorkbenchAgentDefinitionV1, status: AgentAssemblyRowV1['status'] = 'saved'): AgentAssemblyRowV1 =>
  ({ definition, presetId: `bay:main:${definition.agentId}@${definition.revision}`, status })

function harness(catalog: ToolCatalogEntryV1[], agents: AgentAssemblyRowV1[] = [], sessions: { sessionKey: string; title: string; role: string }[] = []) {
  const setAgentAllowlist = vi.fn(async () => {})
  const gateway = { catalog: () => catalog, policy: () => ({ visibility: {}, agentAllowlists: {} }), setAgentAllowlist, revision: 1 } as unknown as WorkbenchToolGatewayV1
  const save = vi.fn(async (_workbenchId: string, input: AgentAssemblyDraftV1) => rowOf(saved(input)))
  const register = vi.fn(async (_workbenchId: string, agentId: string, revision: number) => rowOf(agents.find(row => row.definition.agentId === agentId && row.definition.revision === revision)!.definition, 'registered'))
  const unregister = vi.fn(async (_workbenchId: string, agentId: string, revision: number) => ({ row: rowOf(agents.find(row => row.definition.agentId === agentId && row.definition.revision === revision)!.definition), sessions }))
  const client: AgentAssemblyClientV1 = { list: vi.fn(async () => agents), save, register, unregister }
  return { gateway, client, setAgentAllowlist, save, register, unregister }
}

describe('Workbench Agent assembly drawer', () => {
  it('lists assembled agents and opens the tool catalog as a tab', async () => {
    const state = harness([entry()], [rowOf(saved({ agentId: 'quote-assistant', name: '报价助手', description: '处理报价单', basePreset: 'standard', blocks: ['tool-fs'], tools: ['workbench.quote.lookup'], skills: [], guestAccess: 'none' }))])
    const view = render(<WorkbenchAgentAssemblyDialog gateway={state.gateway} workbenchId="main" workbenchName="主工作台" client={state.client} onClose={() => {}} />)
    expect(view.getByRole('dialog', { name: 'Agent 组装' })).toBeTruthy()
    await waitFor(() => expect(view.getByText('报价助手')).toBeTruthy())
    expect(view.getByText(/1 个工具/)).toBeTruthy()
    fireEvent.click(view.getByRole('tab', { name: '工具集成' }))
    expect(view.getByRole('tab', { name: '工具开关' })).toBeTruthy()
    expect(view.queryByRole('dialog', { name: '工具集成' })).toBeNull()
  })

  it('assembles an agent from blocks and tools and saves a revision without registering it', async () => {
    const state = harness([
      entry(),
      entry({ id: 'workbench.quote.skill', kind: 'skill', display: { name: '报价流程' } }),
      entry({ id: 'quote.remote', kind: 'mcp', display: { name: '远程 MCP' } }),
      entry({ id: 'quote.shell', kind: 'cli', display: { name: '命令行工具' } }),
    ])
    const view = render(<WorkbenchAgentAssemblyDialog gateway={state.gateway} workbenchId="main" workbenchName="主工作台" client={state.client} onClose={() => {}} />)
    fireEvent.click(view.getByRole('button', { name: '组装新 Agent' }))
    fireEvent.click(view.getByRole('button', { name: '下一步' }))
    fireEvent.click(view.getByRole('checkbox', { name: /终端/ }))
    fireEvent.click(view.getByRole('button', { name: '下一步' }))
    fireEvent.click(view.getByRole('checkbox', { name: /查询报价/ }))
    fireEvent.click(view.getByRole('checkbox', { name: /报价流程/ }))
    expect(view.queryByRole('checkbox', { name: /远程 MCP/ })).toBeNull()
    expect(view.queryByRole('checkbox', { name: /命令行工具/ })).toBeNull()
    fireEvent.click(view.getByRole('button', { name: '下一步' }))
    fireEvent.change(view.container.querySelectorAll('input:not([type="radio"]):not([type="checkbox"])')[0]!, { target: { value: 'quote-assistant' } })
    fireEvent.change(view.container.querySelectorAll('input:not([type="radio"]):not([type="checkbox"])')[1]!, { target: { value: '报价助手' } })
    fireEvent.change(view.container.querySelectorAll('textarea')[0]!, { target: { value: '处理客户报价单' } })
    fireEvent.click(view.getByRole('button', { name: '保存修订' }))
    await waitFor(() => expect(state.save).toHaveBeenCalled())
    const draft = state.save.mock.calls[0]![1]
    expect(draft.agentId).toBe('quote-assistant')
    expect(draft.blocks).not.toContain('tool-shell')
    expect(draft.tools).toEqual(expect.arrayContaining(['workbench.quote.lookup', 'workbench.quote.skill']))
    expect(draft.skills).toEqual(['workbench.quote.skill'])
    await waitFor(() => expect(view.getByText('报价助手')).toBeTruthy())
    expect(state.register).not.toHaveBeenCalled()
    expect(state.setAgentAllowlist).not.toHaveBeenCalled()
  })

  it('keeps the agent id fixed when revising and refuses to publish an empty name', async () => {
    const state = harness([entry()], [rowOf(saved({ agentId: 'quote-assistant', name: '报价助手', description: '处理报价单', basePreset: 'minimal', blocks: [], tools: [], skills: [], guestAccess: 'none' }))])
    const view = render(<WorkbenchAgentAssemblyDialog gateway={state.gateway} workbenchId="main" workbenchName="主工作台" client={state.client} onClose={() => {}} />)
    await waitFor(() => expect(view.getByText('报价助手')).toBeTruthy())
    fireEvent.click(view.getByRole('button', { name: '修改' }))
    fireEvent.click(view.getByRole('button', { name: '4. 身份与发布' }))
    const inputs = view.container.querySelectorAll('input:not([type="radio"]):not([type="checkbox"])')
    expect((inputs[0] as HTMLInputElement).disabled).toBe(true)
    fireEvent.change(inputs[1]!, { target: { value: '' } })
    const publish = view.getByRole('button', { name: '保存新修订' }) as HTMLButtonElement
    expect(publish.disabled).toBe(true)
    expect(view.getByRole('alert').textContent).toContain('名称')
  })

  it('registers a picked revision, sets its allowlist, and warns when sessions still use it', async () => {
    const definition = saved({ agentId: 'quote-assistant', name: '报价助手', description: '处理报价单', basePreset: 'standard', blocks: ['tool-fs'], tools: ['workbench.quote.lookup'], skills: [], guestAccess: 'none' })
    const state = harness([entry()], [rowOf(definition)], [{ sessionKey: 's1', title: '报价对话', role: 'user' }])
    const view = render(<WorkbenchAgentAssemblyDialog gateway={state.gateway} workbenchId="main" workbenchName="主工作台" client={state.client} onClose={() => {}} />)
    await waitFor(() => expect(view.getByText('报价助手')).toBeTruthy())
    fireEvent.click(view.getByRole('button', { name: '注册' }))
    await waitFor(() => expect(state.register).toHaveBeenCalledWith('main', 'quote-assistant', 1))
    await waitFor(() => expect(state.setAgentAllowlist).toHaveBeenCalledWith('quote-assistant', ['workbench.quote.lookup']))
    fireEvent.click(await view.findByRole('button', { name: '取消注册' }))
    await waitFor(() => expect(view.getByRole('alert').textContent).toContain('报价对话'))
  })

  it('marks a revision unavailable when its tools left the catalog', async () => {
    const definition = saved({ agentId: 'quote-assistant', name: '报价助手', description: '处理报价单', basePreset: 'standard', blocks: [], tools: ['quote.gone'], skills: [], guestAccess: 'none' })
    const state = harness([entry()], [rowOf(definition)])
    const view = render(<WorkbenchAgentAssemblyDialog gateway={state.gateway} workbenchId="main" workbenchName="主工作台" client={state.client} onClose={() => {}} />)
    await waitFor(() => expect(view.getByText(/缺少工具或 Skill：quote\.gone/)).toBeTruthy())
    expect((view.getByRole('button', { name: '注册' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('shows an import suggestion and warns harder when the package was unsigned', async () => {
    const definition = saved({ agentId: 'quote-assistant', name: '报价助手', description: '处理报价单', basePreset: 'standard', blocks: [], tools: ['workbench.quote.lookup'], skills: [], guestAccess: 'none' })
    const state = harness([entry()], [{ ...rowOf(definition), suggested: 'template-unsigned' }])
    const view = render(<WorkbenchAgentAssemblyDialog gateway={state.gateway} workbenchId="main" workbenchName="主工作台" client={state.client} onClose={() => {}} />)
    await waitFor(() => expect(view.getByText(/未签名/)).toBeTruthy())
    expect(state.register).not.toHaveBeenCalled()
  })

  it('treats Host-reported missing executors as unavailable even when the catalog lists the tool', async () => {
    const definition = saved({ agentId: 'quote-assistant', name: '报价助手', description: '处理报价单', basePreset: 'standard', blocks: [], tools: ['workbench.quote.lookup'], skills: [], guestAccess: 'none' })
    const state = harness([entry()], [{ ...rowOf(definition), status: 'unavailable', missing: ['workbench.quote.lookup'] }])
    const view = render(<WorkbenchAgentAssemblyDialog gateway={state.gateway} workbenchId="main" workbenchName="主工作台" client={state.client} onClose={() => {}} />)
    await waitFor(() => expect(view.getByText(/缺少工具或 Skill：workbench\.quote\.lookup/)).toBeTruthy())
    expect((view.getByRole('button', { name: '注册' }) as HTMLButtonElement).disabled).toBe(true)
  })
})
