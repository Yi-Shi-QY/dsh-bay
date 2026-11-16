import { describe, expect, it, vi } from 'vitest'
import { buildWorkbenchPackageV4 } from '../src/foundation/workbench-package-v4.ts'
import { createDistributionPackageService } from '../src/foundation/distribution-package-service.ts'
import { createProjectNeutralFrameSettings } from '../src/foundation/frame-settings-adapter.ts'
import { mutableSettings, settingsFixture } from './settings-fixtures.ts'
import { createWorkbenchContext, createAreaContext } from '../src/foundation/workbench-context.ts'
import type { WorkbenchRecordV2 } from '../src/foundation/persistence.ts'

const digest = (value: string): string => value.repeat(64)

function setup(change?: (record: WorkbenchRecordV2) => void) {
  const base = settingsFixture()
  const record = structuredClone(base.workbenches.a!)
  if (record.document.root.kind !== 'area') throw new Error('fixture must contain one area')
  record.document.root.moduleHistory = [{
    moduleInstanceId: 'custom-page', editorId: 'example.custom', editorScope: 'root',
    lastKnownTitle: 'Custom', state: { schemaVersion: 1, color: 'blue' },
  }]
  record.document.root.activeModuleInstanceId = 'custom-page'
  change?.(record)
  const { source } = mutableSettings({ ...base, workbenches: { ...base.workbenches, a: record } })
  const { directory } = createProjectNeutralFrameSettings(source)
  const editor = {
    id: 'example.custom', label: 'Custom', scope: 'root' as const, pluginId: '@local/custom',
    extension: { schemaVersion: 1 as const, moduleId: 'custom.module', apiVersion: 1 as const, editorIds: ['example.custom'], coreCompatibility: '0.1.0-beta.0', dshGeneration: '0.2.2-rc.1' },
    declaration: { state: { schemaVersion: 1, maxBytes: 4096, share: 'portable', restore: 'if-valid' } },
    portability: { version: 1 as const, exportState: (state: unknown) => state, importState: (state: unknown) => state },
  } as any
  const identity = {
    packageName: '@local/custom', version: '1.2.3', moduleId: 'custom.module', digest: digest('a'), archiveSha256: digest('b'),
    integrity: 'sha512-' + 'A'.repeat(43) + '=', editorScopes: [{ editorId: 'example.custom', scope: 'root' as const }],
    permissions: [], exportPolicy: 'reference' as const, runtimeFiles: ['package.json'], requires: [], host: false,
    bundleEntries: [{ entryId: 'custom', moduleName: '@local/custom' }], registryUrl: 'https://registry.example/custom',
  }
  const registry = {
    getSnapshot: () => ({ status: 'ready' as const, extensions: [{ key: '@local/custom::custom.module', packageName: '@local/custom', packageVersion: '1.2.3', moduleId: 'custom.module', apiVersion: 1, editorIds: ['example.custom'], availability: 'ready' as const, allowed: true, contractFingerprint: 'a'.repeat(32), detail: '' }] }),
    refresh: vi.fn(async () => {}), subscribe: () => () => {}, dispose: () => {}, catalog: { getSnapshot: () => [editor], subscribe: () => () => {} },
  } as any
  let exportedLayout: any
  const client = {
    artifactIdentities: vi.fn(async () => [identity]),
    prepare: vi.fn(async (input: any) => { exportedLayout = input.layout; return buildWorkbenchPackageV4({ layout: input.layout, mode: 'layout-only' }) }),
    inspect: vi.fn(), consent: vi.fn(), resume: vi.fn(), complete: vi.fn(), restorePending: vi.fn(), cancel: vi.fn(), history: vi.fn(async () => []), preparePending: vi.fn(),
  } as any
  const service = createDistributionPackageService({ client, settings: source as any, directory, editors: { getSnapshot: () => [editor], subscribe: () => () => {} }, rawEditors: { getSnapshot: () => [editor], subscribe: () => () => {} }, registry, canExport: () => true, canImport: () => true })
  return { service, client, identity, exportedLayout }
}

describe('workbench package service', () => {
  it('exports only reusable configuration and includes human background only when selected', async () => {
    const fixture = setup(record => {
      record.context = createWorkbenchContext(); record.context.human.goal = 'Reusable background'
      record.areaContexts = { 'area-a': createAreaContext() }; record.areaContexts['area-a']!.human.objective = 'Current project'
      record.workbenchAi = { provider: 'local-provider', model: 'local-model' }
    })
    const plain = await fixture.service.prepareExport('a', 'layout-only')
    expect(plain.preview.layout.context).toBeUndefined()
    expect(plain.preview.layout.modelPreference).toBeUndefined()
    expect(plain.preview.layout.orchestration).toBeUndefined()
    const background = await fixture.service.prepareExport('a', 'layout-only', false, true)
    expect(background.preview.layout.context?.workbench.human.goal).toBe('Reusable background')
    expect(background.preview.layout.context?.workbench.agent).toBeUndefined()
    expect(background.preview.layout.context?.areas).toEqual({})
    expect(background.preview.layout.modelPreference).toBeUndefined()
  })

  it('includes a custom editor when its live catalog row lacks distribution metadata', async () => {
    const fixture = setup()
    await fixture.service.prepareExport('a', 'layout-only')
    expect(fixture.client.artifactIdentities).toHaveBeenCalled()
    expect(fixture.client.prepare).toHaveBeenCalled()
    expect(fixture.client.prepare.mock.calls[0]![0].layout.modules).toEqual([{
      editorId: 'example.custom', scope: 'root', packageName: '@local/custom', version: '1.2.3', digest: digest('a'),
    }])
  })

  it('restores the same custom editor identity without a second manual verification step', async () => {
    const fixture = setup()
    await fixture.service.prepareExport('a', 'layout-only')
    const row: any = {
      transactionId: 'distribution-00000000-0000-4000-8000-000000000001', archiveSha256: digest('c'), workbenchId: 'imported', name: 'Imported', createdAt: 1,
      mode: 'layout-only', state: 'awaiting-restore', dependencies: [fixture.identity], installed: [], reused: [], blockers: [], layout: fixture.client.prepare.mock.calls[0]![0].layout,
    }
    fixture.client.consent.mockResolvedValue(row)
    fixture.client.complete.mockImplementation(async (_id: string, document: unknown) => ({ ...row, state: 'ready', layout: undefined, restoredDocument: document }))
    const result = await fixture.service.confirm(row)
    expect(fixture.client.complete).toHaveBeenCalled()
    expect(result.state).toBe('ready')
    expect(fixture.client.complete.mock.calls[0]![2]).toMatchObject({ '@local/custom::custom.module': { packageName: '@local/custom', moduleId: 'custom.module', allowed: true } })
  })
})
