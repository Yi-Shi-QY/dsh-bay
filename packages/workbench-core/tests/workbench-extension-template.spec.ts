import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { resolveWorkbenchExtensionAccessV1 } from '../src/workbench-extension-access.ts'
import type { WorkbenchEditorCatalogRow } from '../src/foundation/catalog.ts'

const templateUrl = new URL('../presets/workbench-creator/skills/workbench-extension-development/templates/workbench-editor/client.js', import.meta.url)
const packageName = '@local/workbench-editor-example'

function loadTemplatePlugin(): Record<string, unknown> {
  let entry: { factory(require: (name: string) => unknown): Record<string, unknown> } | undefined
  vm.runInNewContext(readFileSync(templateUrl, 'utf8'), {
    window: { __ModuleLoader__: { load(value: typeof entry) { entry = value } } },
  }, { filename: 'workbench-editor/client.js' })
  const react = { createElement: () => null, useState: (initial: unknown) => [initial, () => {}] }
  return entry!.factory(name => name === 'react' ? react : undefined)
}

describe('Workbench editor extension template identity', () => {
  it('keeps the Cordis Fiber name equal to the DSH moduleName used by inventory matching', async () => {
    const plugin = loadTemplatePlugin()
    const context = new Context()
    const fiber = context.plugin(plugin as never)
    expect(fiber.name).toBe(packageName)

    let registration: Record<string, unknown> | undefined
    ;(plugin.apply as (context: unknown) => void)({
      slots: {
        inject(_name: string, register: () => unknown) { return register() },
        register(options: Record<string, unknown>) {
          registration = options
          return () => {}
        },
      },
    })
    expect(registration?.registrant).toBe(packageName)
    const registrationMetadata = (registration?.inject as (() => { workbenchEditor: { presentation?: { icon?: string } } }) | undefined)?.()
    expect(registrationMetadata?.workbenchEditor.presentation).toEqual({ icon: 'extension' })

    const editors = [{
      id: 'workbench.example', label: 'Example', scope: 'root', pluginId: fiber.name,
      declaration: {
        editorId: 'workbench.example', scope: 'root', label: 'Example', requiredBinding: 'none',
        binding: { requirement: 'none', unbound: 'available', sharing: 'none' },
        state: { schemaVersion: 1, maxBytes: 16384, restore: 'if-valid', share: 'portable' },
        runtime: { background: 'pause', collapsed: 'dispose', reacquire: 'on-visible' },
      },
      extension: {
        schemaVersion: 1, moduleId: 'workbench.editor-example', apiVersion: 1,
        editorIds: ['workbench.example'], coreCompatibility: '0.2.2-alpha.12', dshGeneration: '0.2.1-rc.2',
      },
    }] satisfies WorkbenchEditorCatalogRow[]
    const inventory = {
      plugins: [{ entryId: 'example-entry', moduleName: packageName, enabled: true, fiberPhase: 'active' }],
      bundles: [{ name: packageName, version: '0.1.0', installed: true, enabled: true,
        rows: [{ rowId: 'example-row', moduleName: packageName, entryId: 'example-entry' }] }],
    }
    const pending = resolveWorkbenchExtensionAccessV1({
      editors, inventory, consents: {}, coreVersion: '0.2.2-alpha.12', dshGeneration: '0.2.1-rc.2', coreEditorIds: [],
    })

    expect(pending.snapshot.extensions[0]).toMatchObject({
      packageName, availability: 'not-allowed', allowed: false,
    })
    expect(pending.editors).toEqual([])
    await fiber.dispose()
  })
})
