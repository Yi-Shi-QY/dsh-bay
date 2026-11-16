import { normalizeWorkbenchEditorSvgIcon } from '../src/foundation/workbench-editor-icons.ts'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { resolveWorkbenchExtensionAccessV1 } from '../src/workbench-extension-access.ts'
import type { WorkbenchEditorCatalogRow } from '../src/foundation/catalog.ts'

const templateRoot = new URL('../presets/workbench-creator/skills/workbench-extension-development/templates/workbench-editor/', import.meta.url)
const variantRoot = new URL('../presets/workbench-creator/skills/workbench-extension-development/templates/workbench-editor-variants/', import.meta.url)
const packageName = '@local/workbench-editor-example'

function loadTemplatePlugin(fileName = 'client.js', root = templateRoot): Record<string, unknown> {
  let entry: { factory(require: (name: string) => unknown): Record<string, unknown> } | undefined
  vm.runInNewContext(readFileSync(new URL(fileName, root), 'utf8'), {
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
    await (plugin.apply as (context: unknown) => Promise<void>)({
      slots: {
        inject(_name: string, register: () => unknown) { return register() },
        register(options: Record<string, unknown>) {
          registration = options
          return () => {}
        },
      },
      modules: {
        import: async (name: string) => name === 'react' ? { createElement: () => null, useEffect: () => {} } : undefined,
      },
    })
    expect(registration?.registrant).toBe(packageName)
    const registrationMetadata = (registration?.inject as (() => { workbenchEditor: { presentation?: { iconSvg?: unknown }; declaration: { state: { share: string } }; portability?: { exportState?: (value: any, context: any) => unknown; importState?: (value: any, context: any) => unknown } } }) | undefined)?.()
    expect(normalizeWorkbenchEditorSvgIcon(registrationMetadata?.workbenchEditor.presentation?.iconSvg)?.paths).toHaveLength(2)
    expect(registrationMetadata?.workbenchEditor.declaration.state.share).toBe('portable')
    expect(registrationMetadata?.workbenchEditor.portability).toEqual(expect.objectContaining({
      version: 1, exportState: expect.any(Function), importState: expect.any(Function),
    }))
    const portableState = registrationMetadata!.workbenchEditor.portability!
    const projectedState = portableState.exportState!({ schemaVersion: 1, acknowledged: true, localOnly: 'drop me' }, {} as never)
    expect(projectedState).toEqual({ schemaVersion: 1, acknowledged: true })
    expect(portableState.importState!(projectedState, {} as never)).toEqual({ schemaVersion: 1, acknowledged: true })

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
        editorIds: ['workbench.example'], coreCompatibility: '0.1.0-beta.0', dshGeneration: '0.2.2-rc.2',
      },
    }] satisfies WorkbenchEditorCatalogRow[]
    const inventory = {
      plugins: [{ entryId: 'example-entry', moduleName: packageName, enabled: true, fiberPhase: 'active' }],
      bundles: [{ name: packageName, version: '0.1.0', installed: true, enabled: true,
        rows: [{ rowId: 'example-row', moduleName: packageName, entryId: 'example-entry' }] }],
    }
    const pending = resolveWorkbenchExtensionAccessV1({
      editors, inventory, consents: {}, coreVersion: '0.1.0-beta.0', dshGeneration: '0.2.2-rc.2', coreEditorIds: [],
    })

    expect(pending.snapshot.extensions[0]).toMatchObject({
      packageName, availability: 'not-allowed', allowed: false,
    })
    expect(pending.editors).toEqual([])
    await fiber.dispose()
  })
})

describe('Workbench session editor template variant', () => {
  it('keeps each inner page bound to the exact Session and marks the artifact embeddable', async () => {
    const plugin = loadTemplatePlugin('session-client.js', variantRoot)
    const context = new Context()
    const fiber = context.plugin(plugin as never)
    let registration: Record<string, unknown> | undefined
    await (plugin.apply as (context: unknown) => Promise<void>)({
      slots: {
        inject(_name: string, register: () => unknown) { return register() },
        register(options: Record<string, unknown>) { registration = options; return () => {} },
      },
      modules: { import: async (name: string) => name === 'react' ? { createElement: () => null, useEffect: () => {} } : undefined },
    })
    expect(registration?.name).toBe('workbench.editor.session')
    expect(registration?.registrant).toBe(packageName)
    const metadata = (registration?.inject as (() => { workbenchEditor: any }) | undefined)?.().workbenchEditor
    expect(metadata.declaration).toMatchObject({ scope: 'session', requiredBinding: 'session', presentation: { floating: false }, binding: { requirement: 'session', unbound: 'pending', sharing: 'independent' } })
    expect(metadata.distribution).toMatchObject({ exportPolicy: 'embed', packageName, provides: { editorIds: ['workbench.example'] } })
    expect(metadata.portability).toEqual(expect.objectContaining({ version: 1, exportState: expect.any(Function), importState: expect.any(Function) }))
    expect(metadata.declaration.state.share).toBe('portable')
    await fiber.dispose()
  })
})
