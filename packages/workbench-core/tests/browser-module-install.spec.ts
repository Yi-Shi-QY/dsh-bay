import { describe, expect, it, vi } from 'vitest'
import {
  createWorkbenchBrowserSignedCatalogInstallCommit,
  createWorkbenchBrowserDirectSourceInstallCommit,
  WORKBENCH_MODULE_INSTALL_ROUTE_V1,
  WORKBENCH_DIRECT_SOURCE_INSTALL_ROUTE_V1,
} from '../src/browser-module-install.ts'

const restartTransaction = {
  transactionId: 'transaction-1',
  planId: 'workbench-plan-signed-local-catalog-workbench.conversation-suite@0.1.5-alpha.2',
  state: 'restart-required' as const,
  stagedModules: ['workbench.conversation-suite'],
  installedModules: ['workbench.conversation-suite'],
  activatedModules: [],
}

describe('browser signed-catalog installation commit', () => {
  it('uses one fixed same-origin route and transmits only the complete archive plus fixed module identity', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ schemaVersion: 1, transaction: restartTransaction }), { status: 200 }))
    await expect(createWorkbenchBrowserSignedCatalogInstallCommit(fetcher)({
      moduleId: 'workbench.conversation-suite', archive: new Uint8Array([1, 2, 3]),
    })).resolves.toEqual(restartTransaction)
    expect(fetcher).toHaveBeenCalledWith(WORKBENCH_MODULE_INSTALL_ROUTE_V1, expect.objectContaining({
      method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' },
    }))
    const payload = JSON.parse((fetcher.mock.calls[0]?.[1] as RequestInit).body as string)
    expect(payload).toEqual({ schemaVersion: 1, moduleId: 'workbench.conversation-suite', catalogArchiveBase64: 'AQID' })
    expect(JSON.stringify(payload)).not.toMatch(/registry|packageName|path|session|https?:/iu)
  })

  it('fails closed when the Host does not confirm a restart-required transaction', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ transaction: { ...restartTransaction, state: 'active' } }), { status: 200 }))
    await expect(createWorkbenchBrowserSignedCatalogInstallCommit(fetcher)({
      moduleId: 'workbench.conversation-suite', archive: new Uint8Array([1]),
    })).rejects.toThrow('invalid restart-required transaction')
  })

  it('localizes the Host ownership conflict instead of exposing its internal English diagnostic', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ error: 'profile-unowned-module-conflict' }), { status: 400 }))
    await expect(createWorkbenchBrowserSignedCatalogInstallCommit(fetcher)({
      moduleId: 'workbench.conversation-suite', archive: new Uint8Array([1]),
    })).rejects.toThrow('当前 Profile 已存在未由 Workbench 管理的内页模块')
  })

  it('sends only a validated structured direct-source request to the fixed Host route', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ schemaVersion: 1, transaction: restartTransaction }), { status: 200 }))
    await expect(createWorkbenchBrowserDirectSourceInstallCommit(fetcher)({
      source: { kind: 'npm', packageName: '@example/workbench-suite', requestedRange: '^1.2.0', registry: 'https://registry.example.test' },
    })).resolves.toEqual(restartTransaction)
    expect(fetcher).toHaveBeenCalledWith(WORKBENCH_DIRECT_SOURCE_INSTALL_ROUTE_V1, expect.objectContaining({ method: 'POST', credentials: 'same-origin' }))
    const payload = JSON.parse((fetcher.mock.calls[0]?.[1] as RequestInit).body as string)
    expect(payload).toEqual({ schemaVersion: 1, source: { kind: 'npm', packageName: '@example/workbench-suite', requestedRange: '^1.2.0', registry: 'https://registry.example.test' } })
    expect(JSON.stringify(payload)).not.toMatch(/shell|path|session|pnpm/iu)
  })
})
