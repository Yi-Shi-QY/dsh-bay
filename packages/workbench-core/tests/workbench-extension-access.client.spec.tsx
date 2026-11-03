// @vitest-environment jsdom
import React from 'react'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorkbenchExtensionAccessSection } from '../src/foundation/WorkbenchExtensionAccessSection.tsx'
import type { WorkbenchExtensionRegistryV1 } from '../src/client/workbench-extension-registry.ts'
import type { WorkbenchDirectory } from '../src/foundation/frame-settings-adapter.ts'
import type { WorkbenchExtensionAccessSnapshotV1 } from '../src/workbench-extension-access.ts'

afterEach(() => cleanup())

const extensionRow = {
  key: '@example/pet::example.pet', packageName: '@example/pet', packageVersion: '1.0.0',
  moduleId: 'example.pet', apiVersion: 1, editorIds: ['example.pet.page'],
  availability: 'not-allowed' as const, allowed: false,
  contractFingerprint: '0123456789abcdef0123456789abcdef',
  detail: '已发现兼容的 Workbench 扩展；允许后，它才会出现在“添加内页”中。',
}

function registry(snapshot: WorkbenchExtensionAccessSnapshotV1): WorkbenchExtensionRegistryV1 {
  return {
    catalog: { getSnapshot: () => [], subscribe: () => () => {} },
    getSnapshot: () => snapshot,
    subscribe: () => () => {},
    refresh: async () => {},
    dispose: () => {},
  }
}

function directory(snapshot: ReturnType<WorkbenchDirectory['getSnapshot']>, setExtensionAllowed: WorkbenchDirectory['setExtensionAllowed']) {
  return {
    getSnapshot: () => snapshot,
    subscribe: () => () => {},
    setExtensionAllowed,
  } as unknown as WorkbenchDirectory
}

describe('Workbench extension access settings', () => {
  it('requires an explicit Workbench opt-in and reports the atomic save result', async () => {
    const setExtensionAllowed = vi.fn(async () => ({ status: 'committed' as const, revision: 2 }))
    const view = render(<WorkbenchExtensionAccessSection
      registry={registry({ status: 'ready', extensions: [extensionRow] })}
      directory={directory({ openWorkbenchIds: [], globalHiddenEditorIds: [], extensionConsents: {}, rows: [], invalidRows: [], templates: [] }, setExtensionAllowed)} />)

    expect(view.getByText('已发现兼容的 Workbench 扩展；允许后，它才会出现在“添加内页”中。')).toBeTruthy()
    expect(view.getByText('example.pet.page')).toBeTruthy()
    fireEvent.click(view.getByRole('button', { name: '允许使用' }))
    expect(setExtensionAllowed).toHaveBeenCalledWith({
      packageName: '@example/pet', moduleId: 'example.pet', apiVersion: 1,
      editorIds: ['example.pet.page'],
      contractFingerprint: extensionRow.contractFingerprint,
    }, true)
    expect(await view.findByText('已允许此扩展在 Workbench 中提供内页。')).toBeTruthy()
  })

  it('keeps revoke available for a missing plugin and never offers allow while inventory is unavailable', () => {
    const setExtensionAllowed = vi.fn(async () => ({ status: 'committed' as const, revision: 2 }))
    const revokedView = render(<WorkbenchExtensionAccessSection
      registry={registry({ status: 'ready', extensions: [{ ...extensionRow, availability: 'dsh-disabled' }] })}
      directory={directory({ openWorkbenchIds: [], globalHiddenEditorIds: [], extensionConsents: {
        [extensionRow.key]: { packageName: extensionRow.packageName, moduleId: extensionRow.moduleId, apiVersion: 1,
          editorIds: ['example.pet.page'],
          contractFingerprint: extensionRow.contractFingerprint, allowedAt: 1 },
      }, rows: [], invalidRows: [], templates: [] }, setExtensionAllowed)} />)
    expect(revokedView.queryByRole('button', { name: '允许使用' })).toBeNull()
    fireEvent.click(revokedView.getByRole('button', { name: '撤销许可' }))
    expect(setExtensionAllowed).toHaveBeenCalledWith({ packageName: '@example/pet', moduleId: 'example.pet', apiVersion: 1,
      editorIds: ['example.pet.page'] }, false)

    cleanup()
    const unavailableView = render(<WorkbenchExtensionAccessSection
      registry={registry({ status: 'unavailable', extensions: [extensionRow] })}
      directory={directory({ openWorkbenchIds: [], globalHiddenEditorIds: [], rows: [], invalidRows: [], templates: [] }, setExtensionAllowed)} />)
    expect(unavailableView.getByText(/无法核对 DSH 插件包和运行清单/)).toBeTruthy()
    expect(unavailableView.queryByRole('button', { name: '允许使用' })).toBeNull()
  })

  it('shows exact DSH provider identity diagnostics for an unverified extension', () => {
    const view = render(<WorkbenchExtensionAccessSection
      registry={registry({ status: 'ready', extensions: [{
        ...extensionRow,
        availability: 'identity-unverified',
        detail: 'No DSH bundle row maps this runtime entry.',
        providerDiagnostic: {
          code: 'bundle-not-found',
          registrant: '@example/pet',
          runtimeEntryIds: ['pet-entry'],
          runtimeModuleNames: ['@example/pet'],
          bundleNames: [],
          detail: 'No DSH bundle row maps this runtime entry.',
        },
      }] })}
      directory={directory({ openWorkbenchIds: [], globalHiddenEditorIds: [], extensionConsents: {}, rows: [], invalidRows: [], templates: [] }, vi.fn())} />)

    fireEvent.click(view.getByText('身份核验诊断'))
    expect(view.getByText('bundle-not-found')).toBeTruthy()
    expect(view.getAllByText('@example/pet')).toHaveLength(2)
    expect(view.getByText('pet-entry')).toBeTruthy()
    expect(view.getAllByText('No DSH bundle row maps this runtime entry.')).toHaveLength(2)
  })
})
