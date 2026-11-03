// @vitest-environment jsdom
import React from 'react'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorkbenchToolGatewayDialog } from '../src/foundation/WorkbenchToolGatewayDialog.tsx'
import type { ToolCatalogEntryV1, WorkbenchToolGatewayV1 } from '../src/tool-gateway.ts'
import type { WorkbenchToolGatewayUsageSnapshotV1 } from '../src/tool-gateway-usage.ts'

afterEach(() => cleanup())

const entry = (overrides: Partial<ToolCatalogEntryV1> = {}): ToolCatalogEntryV1 => ({
  id: 'example.search', kind: 'mcp', moduleId: 'workbench.example', editorId: 'example.tools', version: '1.0.0',
  display: { name: 'Example Search', description: '搜索示例数据' }, execution: { providerId: 'example-provider', reference: { name: 'search' } },
  visibility: 'enabled', availability: 'available', ...overrides,
})

function gateway(catalog: ToolCatalogEntryV1[], usage?: WorkbenchToolGatewayUsageSnapshotV1) {
  let current = catalog
  const setVisibility = vi.fn(async ({ toolId, state }: { toolId: string; state: 'enabled' | 'disabled' }) => { current = current.map(row => row.id === toolId ? { ...row, visibility: state } : row) })
  const setVisibilityBatch = vi.fn(async ({ toolIds, state }: { toolIds: readonly string[]; state: 'enabled' | 'disabled' }) => { current = current.map(row => toolIds.includes(row.id) ? { ...row, visibility: state } : row); return { appliedToolIds: toolIds, rejected: [] } })
  const usageSnapshot = vi.fn(() => usage ?? emptyUsageSnapshot())
  const subscribeUsage = vi.fn(() => () => {})
  return { api: { catalog: () => current, setVisibility, setVisibilityBatch, usageSnapshot, subscribeUsage, revision: 1 } as unknown as WorkbenchToolGatewayV1, setVisibility, setVisibilityBatch, usageSnapshot }
}

function emptyUsageSnapshot(): WorkbenchToolGatewayUsageSnapshotV1 {
  const now = new Date().toISOString()
  return { workbenchId: 'main', gatewayRevision: 1, gatewaySnapshotDigest: 'test', from: new Date(Date.now() - 3600000).toISOString(), to: now, generatedAt: now, sourceStatus: 'ready', totals: { calls: 0, successes: 0, failures: 0, rejected: 0, cancelled: 0, timeouts: 0, incomplete: 0, totalDurationMs: 0 }, byTool: [], buckets: [] }
}

const gatewayUsageSnapshot: WorkbenchToolGatewayUsageSnapshotV1 = {
  ...emptyUsageSnapshot(),
  totals: { calls: 2, successes: 1, failures: 1, rejected: 0, cancelled: 0, timeouts: 0, incomplete: 0, totalDurationMs: 300 },
  byTool: [{ toolId: 'example.search', moduleId: 'workbench.example', editorId: 'example.tools', kind: 'mcp', calls: 2, successes: 1, failures: 1, rejected: 0, cancelled: 0, timeouts: 0, incomplete: 0, totalDurationMs: 300, averageDurationMs: 150, p50DurationMs: 100, p95DurationMs: 200, byAgent: [{ agentId: 'agent-a', calls: 2, successes: 1, failures: 1, rejected: 0, cancelled: 0, timeouts: 0, incomplete: 0, totalDurationMs: 300, averageDurationMs: 150 }], errors: [{ code: 'provider.error', message: 'provider unavailable', count: 1, lastOccurredAt: new Date().toISOString() }] }],
  buckets: [{ startAt: new Date(Date.now() - 3600000).toISOString(), endAt: new Date().toISOString(), calls: 2, successes: 1, failures: 1, rejected: 0, cancelled: 0, timeouts: 0, incomplete: 0, totalDurationMs: 300 }],
}

describe('Workbench Tool Gateway drawer', () => {
  it('opens the drawer layout, expands modules, toggles a tool and switches tabs', async () => {
    const state = gateway([entry(), entry({ id: 'example.run', kind: 'cli', display: { name: 'Example Run' } })])
    const view = render(<WorkbenchToolGatewayDialog gateway={state.api} workbenchId="main" workbenchName="主工作台" onClose={() => {}} />)
    expect(view.getByRole('dialog', { name: '工具集成' })).toBeTruthy()
    expect(view.getByRole('tab', { name: '工具开关' }).getAttribute('aria-selected')).toBe('true')
    fireEvent.click(view.getByRole('button', { name: /workbench\.example/ }))
    expect(view.getByText('MCP')).toBeTruthy()
    expect(view.getByText('CLI')).toBeTruthy()
    fireEvent.click(view.getByRole('switch', { name: 'Example Search 已启用' }))
    await waitFor(() => expect(state.setVisibility).toHaveBeenCalledWith({ toolId: 'example.search', state: 'disabled' }))
    fireEvent.click(view.getByRole('tab', { name: '统一接口' }))
    expect(view.getByText(/ToolContributionV1/)).toBeTruthy()
    fireEvent.click(view.getByRole('tab', { name: '工具开关' }))
    fireEvent.click(view.getByRole('button', { name: '全部启用' }))
    await waitFor(() => expect(state.setVisibilityBatch).toHaveBeenCalled())
  })

  it('reads the Gateway aggregate and expands only Gateway-owned details', async () => {
    const state = gateway([entry()], gatewayUsageSnapshot)
    const view = render(<WorkbenchToolGatewayDialog gateway={state.api} workbenchId="main" workbenchName="主工作台" onClose={() => {}} />)
    fireEvent.click(view.getByRole('tab', { name: '运行统计' }))
    await waitFor(() => expect(state.usageSnapshot).toHaveBeenCalled())
    expect(view.getByText('全部调用')).toBeTruthy()
    expect(view.getByText('成功率')).toBeTruthy()
    fireEvent.click(view.getByRole('button', { name: /example\.search/ }))
    expect(view.getByText('Agent 调用分布')).toBeTruthy()
    expect(view.getByText('agent-a')).toBeTruthy()
    expect(view.getByText('provider unavailable')).toBeTruthy()
    expect(view.queryByText('session-1')).toBeNull()
  })

  it('shows provider health reasons and closes on Escape', () => {
    const onClose = vi.fn()
    const state = gateway([entry({ availability: 'degraded', reason: '缺少凭据连接' })])
    render(<WorkbenchToolGatewayDialog gateway={state.api} workbenchId="main" workbenchName="主工作台" onClose={onClose} />)
    expect(document.querySelector('[data-workbench-tool-gateway-dialog]')).toBeTruthy()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })
})
