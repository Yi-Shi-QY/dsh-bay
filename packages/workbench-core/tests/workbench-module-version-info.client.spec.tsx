// @vitest-environment jsdom
import React from 'react'
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { WORKBENCH_CORE_VERSION, WORKBENCH_DSH_GENERATION } from '../src/release-compatibility.ts'
import { WorkbenchModuleManagerSection } from '../src/foundation/WorkbenchModuleManagerSection.tsx'

afterEach(() => cleanup())

describe('Workbench module center version information', () => {
  it('shows the running Core and Core-bundled default native pages without claiming a separate package install', () => {
    const editors: [] = []
    const editorCatalog = { getSnapshot: () => editors, subscribe: () => () => {} }
    const view = render(<WorkbenchModuleManagerSection editorCatalog={editorCatalog} />)
    const info = view.container.querySelector<HTMLElement>('[data-workbench-version-info="true"]')

    expect(info).not.toBeNull()
    expect(info?.dataset.workbenchCoreVersion).toBe(WORKBENCH_CORE_VERSION)
    expect(info?.dataset.workbenchNativePagesVersion).toBe(WORKBENCH_CORE_VERSION)
    expect(view.container.querySelector('[data-workbench-version-card="core"]')?.textContent).toContain(WORKBENCH_CORE_VERSION)

    const nativePages = view.container.querySelector('[data-workbench-version-card="native-pages"]')
    expect(nativePages?.textContent).toContain(WORKBENCH_CORE_VERSION)
    expect(nativePages?.textContent).toContain(`适配 DSH ${WORKBENCH_DSH_GENERATION}`)
    expect(nativePages?.textContent).toContain('随 Core 交付')
    expect(nativePages?.textContent).toContain('没有单独安装包')
  })
})
