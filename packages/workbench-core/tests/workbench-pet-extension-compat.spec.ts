import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { describe, expect, it } from 'vitest'
import { validateWorkbenchEditorDeclarationV1 } from '../src/module-contract.ts'
import { isWorkbenchExtensionDeclarationV1 } from '../src/workbench-extension-access.ts'

const packageUrl = new URL('../../workbench-svgdeepseek-pet/package.json', import.meta.url)
const clientUrl = new URL('../../workbench-svgdeepseek-pet/client.js', import.meta.url)
const petPackage = JSON.parse(readFileSync(packageUrl, 'utf8')) as {
  dsh: { workbench: Record<string, unknown> & { editors: unknown[]; editorIds: string[] } }
}

function loadPetRegistration(): { options: Record<string, unknown> } {
  const clientSource = readFileSync(clientUrl, 'utf8')
  let entry: { factory(require: (name: string) => unknown): { apply(context: unknown): void } } | undefined
  vm.runInNewContext(clientSource, {
    window: { __ModuleLoader__: { load(value: typeof entry) { entry = value } } },
  }, { filename: 'workbench-svgdeepseek-pet/client.js' })

  const react = { createElement: () => null, useState: (initial: unknown) => [initial, () => {}] }
  const plugin = entry?.factory(name => name === 'react' ? react : undefined)
  expect(plugin).toBeDefined()
  let registration: { options: Record<string, unknown> } | undefined
  plugin!.apply({
    slots: {
      inject(_name: string, register: () => unknown) { return register() },
      register(options: Record<string, unknown>) {
        registration = { options }
        return () => {}
      },
    },
    effect() {},
  })
  expect(registration).toBeDefined()
  return registration!
}

describe('pet extension against the Core contract', () => {
  it('validates the packaged manifest and actual DSH Slot metadata with Core validators', () => {
    const metadata = (loadPetRegistration().options.inject as () => {
      workbenchEditor: { declaration: unknown; extension: unknown }
    })().workbenchEditor
    const workbench = petPackage.dsh.workbench
    const packagedEditor = workbench.editors[0]

    expect(isWorkbenchExtensionDeclarationV1(metadata.extension)).toBe(true)
    validateWorkbenchEditorDeclarationV1(metadata.declaration)
    expect(metadata.extension).toMatchObject({
      moduleId: workbench.moduleId,
      editorIds: workbench.editorIds,
      coreCompatibility: workbench.coreCompatibility,
      dshGeneration: workbench.dshGeneration,
    })
    expect(metadata.declaration).toEqual(packagedEditor)
  })
})
