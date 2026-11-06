// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { applyWorkbenchCoreFoundation } from '../src/foundation/apply-core.ts'
import { inject as foundationInject } from '../src/foundation/apply-core.ts'
import { WorkbenchCoreEntryAction } from '../src/foundation/WorkbenchCoreEntryAction.tsx'
import { WorkbenchCoreInnerPage } from '../src/foundation/WorkbenchCoreInnerPage.tsx'
import { inject } from '../src/client/index.ts'

function settingsScope() {
  const snapshot = {
    status: 'ready' as const,
    value: undefined,
    base: {}, user: {}, revision: 1, writable: true, mode: 'host' as const,
  }
  return {
    getSnapshot: () => snapshot,
    subscribe: () => () => {},
    set: vi.fn(() => Promise.resolve()),
    unset: vi.fn(() => Promise.resolve()),
    patch: vi.fn(() => Promise.resolve({ status: 'committed' as const, revision: 2 })),
  }
}

async function bench(configForms?: unknown) {
  const bind = vi.fn(() => settingsScope())
  const open = vi.fn()
  const entries = new Map<string, Array<{ component: unknown; inject?: unknown; options?: Record<string, unknown> }>>()
  const slots = {
    getVersion: () => 0,
    entriesOfSlot: () => [],
    subscribe: () => () => {},
    entries: (name: string) => entries.get(name) ?? [],
    inject: (_name: string, register: () => unknown) => {
      const result = register()
      if (result !== null && typeof result === 'object' && Symbol.iterator in result) {
        for (const value of result as Iterable<unknown>) void value
      }
    },
    register: (definition: { name: string; inject?: unknown; options?: Record<string, unknown> }, component: unknown) => {
      const row = { component, options: definition as Record<string, unknown>, ...(definition.inject === undefined ? {} : { inject: definition.inject }), ...(definition.options === undefined ? {} : { options: definition.options }) }
      const rows = entries.get(definition.name) ?? []
      rows.push(row)
      entries.set(definition.name, rows)
      return () => {
        const next = (entries.get(definition.name) ?? []).filter(candidate => candidate !== row)
        entries.set(definition.name, next)
      }
    },
  }
  const ctx = {
    remote: { settings: { mutate: vi.fn() }, $on: vi.fn(() => () => {}) },
    ...(configForms === undefined ? {} : { configForms }),
    uiSession: { sessionStatus: { getSnapshot: () => new Map(), subscribe: () => () => {} } },
    uiWorkspace: { connectWorkspace: vi.fn(async () => 'new-session'), pickDirectory: vi.fn() },
    effect: vi.fn(() => () => {}),
    slots,
    sessions: {
      open,
    list: { getSnapshot: () => ({ byId: {}, ids: [], current: undefined }), subscribe: () => () => {} },
    },
    workspaces: {
    list: { getSnapshot: () => ({ items: [], archivedSessionIds: [] }), subscribe: () => () => {} },
    create: vi.fn(),
    },
    settingsScope: { bind },
  }
  applyWorkbenchCoreFoundation(ctx as never)
  return { slots, bind, open, ctx }
}

describe('Core additive browser foundation', () => {
  it('declares the Connection service required by the browser window controller', () => {
    expect(foundationInject).toContain('connection')
  })

  it('declares both DSH remotes required to verify installed and running extensions', () => {
    expect(inject).toContain('remote.pluginInventory')
    expect(inject).toContain('remote.pluginManager')
    expect(foundationInject).toContain('remote.pluginInventory')
    expect(foundationInject).toContain('remote.pluginManager')
  })

  it('borrows a native reference to rename a Session which has no open Area', async () => {
    const b = await bench()
    const rename = vi.fn(async () => ({ ok: true, value: undefined }))
    const using = vi.fn(async (_target, _options, operation) => operation({ binding: { session: { rename } } }))
    Object.assign(b.ctx.sessions, { using })
    const overlay = (b.slots.entries('shell.overlay')[0]!.inject as () => {
      sidebarHostActions: { renameSession(id: string, title: string): Promise<void> }
    })()
    await overlay.sidebarHostActions.renameSession('closed-session', '本机标题')
    expect(using).toHaveBeenCalledWith('closed-session', { source: 'controllerOperation' }, expect.any(Function))
    expect(rename).toHaveBeenCalledWith('本机标题')
    expect(b.open).not.toHaveBeenCalled()
  })
  it('declares only the official services it reads', () => {
    expect(inject).toEqual([
      'connection', 'slots', 'layout', 'sessions', 'workspaces', 'uiWorkspace', 'uiSession', 'configForms', 'modules', 'locale', 'conversation',
      'remote', 'remote.session', 'remote.settings', 'remote.agentPresets', 'remote.pluginInventory', 'remote.pluginManager', 'remote.workspaceFiles', 'webTerminals', 'sidebarRight', 'sidebarRightTabs', 'shortcuts', 'resources', 'contextMenus', 'theme', 'uiConversation', 'cordisInspect',
    ])
  })

  it('mounts on a clean official root without declaring or replacing layout.frame', async () => {
    const b = await bench()
    expect(b.bind).toHaveBeenCalledOnce()
    expect(b.slots.entries('layout.frame')).toHaveLength(0)
    expect(b.slots.entries('sidebar.brand.mark')).toHaveLength(0)
    expect(b.slots.entries('sidebar.brand.name')).toHaveLength(0)
    expect(b.slots.entries('shell.overlay')).toHaveLength(1)
    expect(b.slots.entries('shell.overlay')[0]?.component).toBe(WorkbenchCoreInnerPage)
    expect(b.slots.entries('sidebar.footer.action')[0]?.component).toBe(WorkbenchCoreEntryAction)

    expect(b.slots.entries('shell.overlay')[0]?.inject).toBeTypeOf('function')
    expect(b.open).not.toHaveBeenCalled()
  })

  it('registers the read-only Creator provider through the optional native client bridge and releases it', async () => {
    const b = await bench()
    const dispose = vi.fn()
    const register = vi.fn(() => dispose)
    Object.assign(b.ctx, { get: (name: string) => name === 'cordisInspect' ? { register } : undefined })
    b.ctx.effect.mockImplementation((handler: () => unknown) => handler() as never)
    applyWorkbenchCoreFoundation(b.ctx as never)
    expect(register).toHaveBeenCalledOnce()
    expect(register).toHaveBeenCalledWith(expect.objectContaining({ manifest: expect.objectContaining({ id: 'WorkbenchCreator' }) }))
    const effect = b.ctx.effect.mock.results.find(result => result.value === dispose)
    expect(effect?.value).toBe(dispose)
    effect!.value()
    expect(dispose).toHaveBeenCalledOnce()
  })

  it('does not read an undeclared optional model service from the Cordis Context', async () => {
    const b = await bench()
    const strict = new Proxy(b.ctx, { get(target, key, receiver) {
      if (key === 'modelSelectionSource') throw new Error('undeclared service')
      return Reflect.get(target, key, receiver)
    } })
    expect(() => applyWorkbenchCoreFoundation(strict as never)).not.toThrow()
  })

  it('resolves the browser window RPC from the injected Connection service', async () => {
    const b = await bench()
    const rpc = { call: vi.fn() }
    Object.assign(b.ctx, { get: vi.fn((name: string) => name === 'connection' ? { rpc } : undefined) })
    const result = applyWorkbenchCoreFoundation(b.ctx as never)
    const injected = (b.slots.entries('shell.overlay').at(-1)!.inject as () => {
      windowController: { getSnapshot(): { supported: boolean } }
    })()
    expect(injected.windowController.getSnapshot().supported).toBe(true)
    expect(rpc.call).not.toHaveBeenCalled()
    result.runtimeMetrics.getSnapshot()
  })

  it('refreshes browser window support after the DSH Connection generation is restored', async () => {
    const b = await bench()
    const listeners: Array<() => void> = []
    let connection: { rpc: { call: ReturnType<typeof vi.fn> } } | undefined
    const rpc = { call: vi.fn() }
    Object.assign(b.ctx, {
      get: (name: string) => name === 'connection' ? connection : undefined,
      on: (event: string, callback: () => void) => {
        expect(event).toBe('connection/reset')
        listeners.push(callback)
        return () => {
          const index = listeners.indexOf(callback)
          if (index >= 0) listeners.splice(index, 1)
        }
      },
      effect: (handler: () => unknown, key: string) => key === 'workbench: browser window controller' ? handler() : undefined,
    })
    applyWorkbenchCoreFoundation(b.ctx as never)
    const injected = (b.slots.entries('shell.overlay').at(-1)!.inject as () => {
      windowController: { getSnapshot(): { supported: boolean } }
    })()
    expect(injected.windowController.getSnapshot().supported).toBe(false)

    connection = { rpc }
    for (const listener of [...listeners]) listener()
    expect(injected.windowController.getSnapshot().supported).toBe(true)
  })

  it('registers native Conversation editors from Core without a Suite identity', async () => {
    const b = await bench()
    // The Start editor is the only root-scoped entry.  Browser is a native
    // DSH sidebar body and therefore follows the same explicit Session/Area
    // binding as Files and Terminal; it must not create an unbound root tab.
    expect(b.slots.entries('workbench.editor.root')).toHaveLength(1)
    expect(b.slots.entries('workbench.editor.root')[0]?.component).toBeTypeOf('function')
    // Core now registers the complete DSH 0.2.0-rc.2 native Area roster:
    // Conversation, trajectory, the four original sidebar bodies, and the
    // five resource/guide bodies introduced by the upstream release.
    expect(b.slots.entries('workbench.editor.session').map(row => row.component)).toHaveLength(11)
    expect(b.slots.entries('workbench.editor.session').every(row => typeof row.component === 'function')).toBe(true)
    const browser = b.slots.entries('workbench.editor.session').find(row => row.options.id === 'workbench.browser')
    const browserMetadata = (browser?.inject as () => { workbenchEditor: Record<string, unknown> })().workbenchEditor
    expect(browserMetadata).toMatchObject({
      schemaVersion: 1,
      declaration: { requiredBinding: 'session', binding: { unbound: 'pending', sharing: 'area' } },
    })
    const files = b.slots.entries('workbench.editor.session').find(row => row.options.id === 'workbench.workspace-files')
    const filesMetadata = (files?.inject as () => { workbenchEditor: Record<string, unknown> })().workbenchEditor
    expect(filesMetadata).toMatchObject({
      schemaVersion: 1,
      declaration: { requiredBinding: 'session', binding: { unbound: 'pending', sharing: 'area' } },
    })
    const documentPreview = b.slots.entries('workbench.editor.session').find(row => row.options.id === 'workbench.document-preview')
    console.log('DEBUG DOC PREVIEW SLOT', documentPreview?.inject?.())
    const documentPreviewMetadata = (documentPreview?.inject as () => { workbenchEditor: Record<string, unknown> })().workbenchEditor
    expect(documentPreviewMetadata).toMatchObject({ schemaVersion: 1, resourceOnly: true })
  })

  it('provides the complete Workbench settings projection alongside Module Manager', async () => {
    const b = await bench()
    const entries = b.slots.entries('settings.section')
    expect(entries).toHaveLength(1)
    const injected = (entries[0]!.inject as () => Record<string, unknown>)()
    expect(injected.hooks).toEqual({ workbenchSettings: expect.objectContaining({ getSnapshot: expect.any(Function) }) })
    expect(injected.editorCatalog).toBeDefined()
    expect(injected.workbenchDirectory).toEqual(expect.objectContaining({
      updateMetadata: expect.any(Function), archive: expect.any(Function), restore: expect.any(Function),
    }))
    expect(injected.sessionList).toBe(b.ctx.sessions.list)
    expect(injected.workspaceList).toBe(b.ctx.workspaces.list)
    const overlay = (b.slots.entries('shell.overlay')[0]!.inject as () => {
      settingsPage: Record<string, unknown>; workbenchSettings: unknown
    })()
    expect((injected.hooks as { workbenchSettings: { getSnapshot(): unknown } }).workbenchSettings.getSnapshot()).toEqual((overlay.workbenchSettings as { getSnapshot(): unknown }).getSnapshot())
    for (const key of ['editorCatalog', 'sessionList', 'workspaceList', 'workbenchDirectory', 'moduleManager']) {
      expect(overlay.settingsPage[key]).toBe(injected[key])
    }
    expect(b.slots.entries('sidebar.settings')).toHaveLength(0)
  })

  it('keeps DSH 0.1.7 ConfigForm snapshots referentially stable until their facts change', async () => {
    const current = {
      status: 'ready' as const,
      value: undefined,
      base: {}, user: {}, revision: 1, writable: true, mode: 'host' as const,
    }
    const configForms = {
      get: vi.fn(() => ({
        getSnapshot: () => ({ ...current }),
        subscribe: () => () => {},
        set: vi.fn(async () => true),
        unset: vi.fn(async () => true),
        mutate: vi.fn(async () => true),
      })),
    }
    const b = await bench(configForms)
    const settings = (b.slots.entries('shell.overlay')[0]!.inject as () => {
      workbenchSettings: { getSnapshot(): object }
    })().workbenchSettings

    const first = settings.getSnapshot()
    expect(settings.getSnapshot()).toBe(first)

    current.revision += 1
    const updated = settings.getSnapshot()
    expect(updated).not.toBe(first)
    expect(settings.getSnapshot()).toBe(updated)
    expect(configForms.get).toHaveBeenCalledOnce()
  })

  it('adapts the official Workspace result into an explicit Area binding', async () => {
    const b = await bench()
    const injected = (b.slots.entries('shell.overlay')[0]!.inject as () => {
      connectWorkspace(workspaceId: string): Promise<unknown>
    })()
    expect(await injected.connectWorkspace('workspace')).toEqual({
      target: { workspaceId: 'workspace', sessionId: 'new-session' }, reusedBlank: false,
    })
    expect(b.open).not.toHaveBeenCalled()
  })
})
