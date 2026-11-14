import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import { hasWorkbenchNativeSidebarRegistration } from '../src/client/native-sidebar-area-editor.tsx'
import {
  WORKBENCH_NATIVE_SIDEBAR_DEFINITIONS,
  workbenchReadyNativeSidebarDefinitions,
} from '../src/client/native-sidebar-registry.ts'

function contextFor(input: {
  readonly declared?: boolean
  readonly keys?: readonly string[]
}) {
  return {
    slots: {
      spec: (name: string) => input.declared === true && name === 'sidebar.right.pane.tab' ? { kind: 'keyed' } : undefined,
      entriesOfSlot: (name: string) => name === 'sidebar.right.pane.tab'
        ? (input.keys ?? []).map(key => ({ options: { key } }))
        : [],
    },
  } as never
}

describe('Workbench native Sidebar registration probe', () => {
  it('accounts for every stable RC2 Sidebar body shipped in the installed official UI sources', () => {
    const vendor = path.resolve('node_modules/@deepseek-ai')
    const registrations: string[] = []
    const scan = (directory: string, provider: string): void => {
      for (const file of readdirSync(directory, { withFileTypes: true })) {
        const absolute = path.join(directory, file.name)
        if (file.isDirectory()) { scan(absolute, provider); continue }
        if (!/\.tsx?$/u.test(file.name) || file.name.endsWith('.d.ts')) continue
        const parsed = ts.createSourceFile(absolute, readFileSync(absolute, 'utf8'), ts.ScriptTarget.Latest, true)
        const visit = (node: ts.Node): void => {
          if (ts.isPropertyAssignment(node) && node.name.getText(parsed) === 'name'
            && ts.isStringLiteral(node.initializer) && node.initializer.text === 'sidebar.right.pane.tab') {
            registrations.push(provider)
          }
          ts.forEachChild(node, visit)
        }
        visit(parsed)
      }
    }
    for (const name of readdirSync(vendor).filter(name => name.startsWith('dsh-client-ui-'))) {
      scan(path.join(vendor, name, 'src'), `@deepseek-ai/${name}`)
    }
    // Count registrations too: a second body from an existing provider still
    // requires a new compatibility decision, even if the package list is unchanged.
    expect(registrations.sort()).toEqual(WORKBENCH_NATIVE_SIDEBAR_DEFINITIONS
      .map(item => item.entryKey.split('/').slice(0, 2).join('/')).sort())
  })

  it('keeps every DSH body in one adapter table and exposes entries with configured Area projections', () => {
    expect(WORKBENCH_NATIVE_SIDEBAR_DEFINITIONS.map(item => item.entryKey)).toEqual([
      '@deepseek-ai/dsh-client-ui-sidebar-files',
      '@deepseek-ai/dsh-client-ui-sidebar-terminal',
      '@deepseek-ai/dsh-client-ui-sidebar-browser',
      '@deepseek-ai/dsh-client-ui-sidebar-documentpreview',
      '@deepseek-ai/dsh-client-ui-deliverables',
      '@deepseek-ai/dsh-client-ui-plan',
      '@deepseek-ai/dsh-client-ui-schedule/task',
      '@deepseek-ai/dsh-client-ui-sidebar-right/guide',
      '@deepseek-ai/dsh-client-ui-subagent',
    ])
    expect(workbenchReadyNativeSidebarDefinitions().map(item => item.kind)).toEqual([
      'files', 'terminal', 'browser', 'documentpreview', 'changes-review', 'plan', 'schedule-task', 'guide', 'subagent-chat',
    ])
    expect(WORKBENCH_NATIVE_SIDEBAR_DEFINITIONS.filter(item => item.projection === 'resource-pending')).toHaveLength(0)
  })

  it('requires both the DSH slot contract and the exact native entry key', () => {
    expect(hasWorkbenchNativeSidebarRegistration(contextFor({}), 'native/files')).toBe(false)
    expect(hasWorkbenchNativeSidebarRegistration(contextFor({ declared: true }), 'native/files')).toBe(false)
    expect(hasWorkbenchNativeSidebarRegistration(contextFor({ declared: true, keys: ['other'] }), 'native/files')).toBe(false)
    expect(hasWorkbenchNativeSidebarRegistration(contextFor({ declared: true, keys: ['native/files'] }), 'native/files')).toBe(true)
  })

  it('does not confuse a title registration with a body registration', () => {
    const context = {
      slots: {
        spec: (name: string) => name === 'sidebar.right.pane.tab' || name === 'sidebar.right.pane.tab.title' ? { kind: 'keyed' } : undefined,
        entriesOfSlot: (name: string) => name === 'sidebar.right.pane.tab.title'
          ? [{ options: { key: 'native/files' } }]
          : [],
      },
    } as never
    expect(hasWorkbenchNativeSidebarRegistration(context, 'native/files')).toBe(false)
  })
})
