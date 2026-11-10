// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { applyWorkbenchCoreFoundation } from '../src/foundation/apply-core.ts'
import { inject as foundationInject } from '../src/foundation/apply-core.ts'
import { createWorkbenchModeController } from '../src/mode-controller.ts'
import { WorkbenchCoreEntryAction } from '../src/foundation/WorkbenchCoreEntryAction.tsx'
import { WorkbenchCoreInnerPage } from '../src/foundation/WorkbenchCoreInnerPage.tsx'
import { inject } from '../src/client/index.ts'
import { backgroundAiPreferencesOf } from '../src/foundation/background-ai-preferences.ts'
import type { WorkbenchCoreSettingsSectionProps } from '../src/foundation/WorkbenchCoreSettingsSection.tsx'
import type { WorkbenchAiDraftGeneratorV1 } from '../src/foundation/workbench-ai.ts'
import { HostWorkbenchDirectory } from '../src/host-workbench-directory.ts'
import { HostWorkbenchAccess } from '../src/host-workbench-access.ts'
import { installWorkbenchDirectoryRoute } from '../src/host-workbench-directory-route.ts'
import { createFileWorkbenchSettings } from '../src/client/file-workbench-settings.ts'
import { WORKBENCH_DIRECTORY_ROUTE } from '../src/workbench-directory-contract.ts'
import { WORKBENCH_ACCESS_HEADER } from '../src/workbench-access-contract.ts'

const cleanup: Array<() => Promise<void> | void> = []
afterEach(async () => { for (const dispose of cleanup.splice(0).reverse()) await dispose(); vi.unstubAllGlobals() })

async function fileAuthority() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'bay-apply-file-')))
  cleanup.push(() => rm(root, { recursive: true, force: true }))
  const directory = new HostWorkbenchDirectory(join(root, 'profile'), { create: async (folder: string) => ({ id: folder }) } as never)
  await directory.create({ requestId: 'create', parentPath: root, folderName: 'workbench', record: {
    workbenchId: 'a', name: 'File workbench', description: '', createdAt: 1, updatedAt: 1,
    document: { version: 3, activeAreaId: 'area-a', root: { kind: 'area', areaId: 'area-a', moduleHistory: [] } },
  } })
  const access = new HostWorkbenchAccess(directory)
  let route!: (request: Request) => Promise<Response>
  installWorkbenchDirectoryRoute({ fetch: { register: (config: { fetch: typeof route }) => { route = config.fetch; return () => {} } } } as never, directory, async () => {}, undefined, undefined, access)
  const fetcher = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => String(url) === WORKBENCH_DIRECTORY_ROUTE
    ? route(new Request('http://localhost' + WORKBENCH_DIRECTORY_ROUTE, init))
    : Response.json({ draft: 'Draft' }))
  vi.stubGlobal('fetch', fetcher)
  return { directory, access, fetcher }
}

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

async function bench(configForms?: unknown, modeController?: Parameters<typeof applyWorkbenchCoreFoundation>[1]) {
  const file = await fileAuthority()
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
    effect: vi.fn((handler?: () => unknown, name?: string) => {
      if (name === 'workbench: file authority') { const dispose = handler?.(); if (typeof dispose === 'function') cleanup.push(dispose as () => void) }
      return () => {}
    }),
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
  const foundation = applyWorkbenchCoreFoundation(ctx as never, modeController)
  return { slots, bind, open, ctx, foundation, ...file }
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
  async function repairBench() {
    const mode = createWorkbenchModeController(), exit = vi.spyOn(mode, 'exit'), enter = vi.spyOn(mode, 'enter')
    const b = await bench(undefined, mode)
    await b.foundation.ready()
    const rename = vi.fn(async () => ({ ok: true, value: undefined }))
    const binding = { sessionId: 'repair-session', session: { rename } }
    const release = vi.fn()
    const create = vi.fn(async (options: { sessionId: string }) => options.sessionId)
    const retain = vi.fn((id: string) => ({ sessionId: id, binding, ready: Promise.resolve(binding), release }))
    const draft = vi.fn(() => 'applied' as 'applied' | 'blocked')
    Object.assign(b.ctx.sessions, { create, retain })
    Object.assign(b.ctx, { conversation: { input: { requestDraftInitialization: draft } } })
    const page = (b.slots.entries('settings.section').at(-1)!.inject as () => WorkbenchCoreSettingsSectionProps)()
    const target = { workbenchId: 'a', moduleId: 'old.plugin', packageName: '@local/old' }
    const open = () => page.openCreator!('Repair old.plugin', '适配 old.plugin', target)
    return { ...b, exit, enter, binding, rename, release, create, retain, draft, open, target }
  }
  it('opens a cordis repair in an independent project without adding Areas or leaving Workbench', async () => {
    const b = await repairBench()
    const upstream = await readFile(join(process.cwd(), 'node_modules/@deepseek-ai/dsh-web-app/presets/cordis.patch.yml'), 'utf8')
    expect(upstream).toMatch(/^        id: cordis\r?$/mu)
    const before = structuredClone(b.directory.getSnapshot().value.workbenches.a!.document)
    await Promise.all([b.open(), b.open()])
    expect(b.create).toHaveBeenCalledTimes(1)
    const project = await b.directory.prepareCreatorRepair(b.target)
    expect(b.create).toHaveBeenCalledWith({ workspaceId: project.workspaceId, agentPreset: 'cordis', sessionId: project.sessionId })
    expect(b.rename).toHaveBeenCalledWith('适配 old.plugin')
    expect(b.draft).toHaveBeenCalledWith(b.binding, { prompt: expect.stringContaining(project.relativePath), whenDraftExists: 'keep' })
    expect(b.draft.mock.calls[0]?.[1].prompt).toContain('不包含插件源码')
    expect(b.directory.getSnapshot().value.workbenches.a!.document).toEqual(before)
    expect(b.directory.getSnapshot().value.workbenches.a!.areaProjects).toEqual({})
    expect(b.directory.getSnapshot().value.workbenches.a!.sessionCatalog?.[project.sessionKey]).toMatchObject({ role: 'user', relativePath: project.relativePath, agentPreset: 'cordis' })
    expect(b.directory.getSnapshot().value.workbenches.a!.sessionCatalog?.[project.sessionKey]?.areaId).toBeUndefined()
    expect(b.foundation.floatingRuntime.find(project.sessionKey, 'a')?.tab).toMatchObject({
      editorId: 'workbench.conversation', lastKnownTitle: '适配 old.plugin', binding: { sessionId: project.sessionId, workspaceId: project.workspaceId },
    })
    expect(b.foundation.floatingRuntime.workspace('a')).toMatchObject({ activeId: project.sessionKey, expanded: true })
    await b.open()
    expect(b.create).toHaveBeenCalledTimes(1)
    expect(b.draft).toHaveBeenCalledTimes(1)
    expect(b.exit).not.toHaveBeenCalled()
    expect(b.enter).toHaveBeenCalledWith({ workbenchId: 'a' })
    expect(b.ctx.sessions.open).not.toHaveBeenCalled()
    await b.foundation.floatingRuntime.close(project.sessionKey, 'a')
    await b.open()
    expect(b.create).toHaveBeenCalledTimes(1)
    expect(b.draft).toHaveBeenCalledTimes(1)
    expect(b.retain).toHaveBeenLastCalledWith(project.sessionId, { source: 'workbenchFloatingCreator' })
    const pinned = b.foundation.floatingRuntime.find(project.sessionKey, 'a')!
    pinned.location = 'area'
    await b.open()
    expect(pinned.location).toBe('area')
    expect([...b.foundation.floatingRuntime.instances.values()].filter(row => row.location === 'floating')).toHaveLength(1)
    expect(b.create).toHaveBeenCalledTimes(1)
  })
  it('retries failed creation with the reserved identity and unchanged layout', async () => {
    const b = await repairBench()
    b.create.mockRejectedValueOnce(new Error('preset temporarily unavailable'))
    await expect(b.open()).rejects.toThrow('preset temporarily unavailable')
    await b.open()
    expect(b.create).toHaveBeenCalledTimes(2)
    expect(b.create.mock.calls[0]).toEqual(b.create.mock.calls[1])
    expect(Object.keys(b.directory.getSnapshot().value.workbenches.a!.sessionCatalog!)).toHaveLength(1)
  })
  it('retains registration and retries the same blank conversation after draft initialization fails', async () => {
    const b = await repairBench()
    b.draft.mockReturnValueOnce('blocked')
    await expect(b.open()).rejects.toThrow('输入区')
    const project = await b.directory.prepareCreatorRepair(b.target)
    expect(project.registered).toBe(true)
    expect(b.release).toHaveBeenCalledTimes(1)
    expect(b.foundation.floatingRuntime.find(project.sessionKey, 'a')).toBeUndefined()
    b.ctx.sessions.list.getSnapshot = () => ({ byId: { [project.sessionId]: { blank: true } }, ids: [], current: undefined }) as never
    await b.open()
    expect(b.create).toHaveBeenCalledTimes(1)
    expect(b.draft).toHaveBeenCalledTimes(2)
    expect(b.foundation.floatingRuntime.find(project.sessionKey, 'a')).toBeDefined()
  })
  it('declares only the official services it reads', () => {
    expect(inject).toEqual([
      'connection', 'slots', 'layout', 'sessions', 'workspaces', 'uiWorkspace', 'uiSession', 'configForms', 'modules', 'locale', 'conversation',
      'remote', 'remote.session', 'remote.settings', 'remote.agentPresets', 'remote.pluginInventory', 'remote.pluginManager', 'remote.workspaceFiles', 'webTerminals', 'sidebarRight', 'sidebarRightTabs', 'shortcuts', 'resources', 'contextMenus', 'theme', 'uiConversation', 'cordisInspect',
    ])
  })

  it('mounts on a clean official root without declaring or replacing layout.frame', async () => {
    const b = await bench()
    expect(b.bind).not.toHaveBeenCalled()
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
    b.ctx.effect.mockImplementation((handler: () => unknown, name?: string) => {
      const result = handler(); if (name === 'workbench: file authority' && typeof result === 'function') cleanup.push(result as () => void)
      return result as never
    })
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
      effect: (handler: () => unknown, key: string) => {
        if (!['workbench: browser window controller', 'workbench: file authority'].includes(key)) return undefined
        const result = handler(); if (typeof result === 'function') cleanup.push(result as () => void)
        return result
      },
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
    // Start and Project Files are root-scoped entries.  Browser is a native
    // DSH sidebar body and therefore follows the same explicit Session/Area
    // binding as Files and Terminal; it must not create an unbound root tab.
    expect(b.slots.entries('workbench.editor.root')).toHaveLength(2)
    expect(b.slots.entries('workbench.editor.root')[0]?.component).toBeTypeOf('function')
    // Core now registers the complete DSH 0.2.0-rc.2 native Area roster:
    // Conversation, trajectory, the four original sidebar bodies, and the
    // five resource/guide bodies introduced by the upstream release.
    expect(b.slots.entries('workbench.editor.session').map(row => row.component)).toHaveLength(10)
    expect(b.slots.entries('workbench.editor.session').every(row => typeof row.component === 'function')).toBe(true)
    const browser = b.slots.entries('workbench.editor.session').find(row => row.options.id === 'workbench.browser')
    const browserMetadata = (browser?.inject as () => { workbenchEditor: Record<string, unknown> })().workbenchEditor
    expect(browserMetadata).toMatchObject({
      schemaVersion: 1,
      declaration: { requiredBinding: 'session', binding: { unbound: 'pending', sharing: 'independent' } },
    })
    const files = b.slots.entries('workbench.editor.root').find(row => row.options.id === 'workbench.workspace-files')
    const filesMetadata = (files?.inject as () => { workbenchEditor: Record<string, unknown> })().workbenchEditor
    expect(filesMetadata).toMatchObject({
      schemaVersion: 1,
      declaration: { requiredBinding: 'none', binding: { unbound: 'available', sharing: 'none' } },
    })
    const documentPreview = b.slots.entries('workbench.editor.session').find(row => row.options.id === 'workbench.document-preview')
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

  it('persists background AI preferences from both settings entries with the expected revision', async () => {
    const b = await bench()
    const injected = (b.slots.entries('settings.section')[0]!.inject as () => WorkbenchCoreSettingsSectionProps)()
    const overlay = (b.slots.entries('shell.overlay')[0]!.inject as () => { settingsPage: WorkbenchCoreSettingsSectionProps; workbenchSettings: { getSnapshot(): { status: string } } })()
    expect(overlay.settingsPage.saveBackgroundAi).toBe(injected.saveBackgroundAi)
    await vi.waitFor(() => expect(overlay.workbenchSettings.getSnapshot().status).toBe('ready'))
    const value = backgroundAiPreferencesOf()
    await expect(injected.saveBackgroundAi!(value, 1)).resolves.toEqual({ status: 'committed', revision: 2 })
    expect(b.directory.getSnapshot().value.backgroundAi).toEqual(value)
    const mutations = () => b.fetcher.mock.calls.map(([, init]) => JSON.parse(String(init?.body))).filter(input => input.action === 'patch')
    expect(mutations()).toEqual([expect.objectContaining({ operation: { operation: 'set', path: ['backgroundAi'], value, expectedRevision: 1 } })])
    await expect(injected.saveBackgroundAi!(value, 99)).resolves.toMatchObject({ status: 'conflict' })
    await expect(injected.saveBackgroundAi!({ ...value, systemPrompt: '' }, 1)).rejects.toThrow('提示词')
    expect(mutations()).toHaveLength(2)
    expect(b.ctx.remote.settings.mutate).not.toHaveBeenCalled()
  })

  it('lets the Host select the saved background model for every UI entrance', async () => {
      const b = await bench()
      const overlay = (b.slots.entries('shell.overlay')[0]!.inject as () => WorkbenchAiDraftGeneratorV1)()
      await overlay.generateContextDraft({ scope: 'create', name: 'New', description: 'Goal', currentValue: '' })
      await overlay.generateContextDraft({ scope: 'workbench', workbenchId: 'a', currentValue: '' })
      await overlay.generateContextDraft({ scope: 'area', workbenchId: 'a', areaId: 'area-a', currentValue: '' })
      const generations = b.fetcher.mock.calls.filter(([url]) => String(url) !== WORKBENCH_DIRECTORY_ROUTE)
      expect(generations).toHaveLength(3)
      for (const call of generations) expect(JSON.parse(String(call[1]?.body))).not.toHaveProperty('selection')
  })

  it('keeps file snapshots stable and ignores legacy ConfigForm updates', async () => {
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
    const injected = (b.slots.entries('shell.overlay')[0]!.inject as () => {
      workbenchSettings: { getSnapshot(): { status: string; revision?: number } }
      settingsPage: { workbenchDirectory: { memoryRequest(input: object): Promise<unknown> } }
    })()
    const settings = injected.workbenchSettings
    await injected.settingsPage.workbenchDirectory.memoryRequest({ action: 'snapshot' })

    const first = settings.getSnapshot()
    expect(settings.getSnapshot()).toBe(first)

    current.revision += 1
    await injected.settingsPage.workbenchDirectory.memoryRequest({ action: 'snapshot' })
    expect(settings.getSnapshot()).toBe(first)
    const hostRevision = b.directory.getSnapshot().revision
    await b.directory.patch({ operation: 'set', path: ['workbenches', 'a', 'description'], value: 'Changed on disk', expectedRevision: hostRevision })
    await injected.settingsPage.workbenchDirectory.memoryRequest({ action: 'snapshot' })
    const updated = settings.getSnapshot()
    expect(updated).not.toBe(first)
    expect(settings.getSnapshot()).toBe(updated)
    expect(configForms.get).not.toHaveBeenCalled()
  })

  it('stores browser background preferences only in the current file workbench and rejects stale versions', async () => {
    const f = await fileAuthority()
    const profileDefaults = { ...backgroundAiPreferencesOf(), systemPrompt: 'Host-wide default' }
    await f.directory.patch({ operation: 'set', path: ['backgroundAi'], value: profileDefaults, expectedRevision: f.directory.getSnapshot().revision })
    const token = f.access.registerOwner('owner', 'a', () => true)
    const browserFetch: typeof fetch = (url, init) => { const headers = new Headers(init?.headers); headers.set(WORKBENCH_ACCESS_HEADER, token); return f.fetcher(url, { ...init, headers }) }
    const mirror = createFileWorkbenchSettings(browserFetch); cleanup.push(() => mirror.dispose())
    await mirror.refresh()
    expect(mirror.scope.getSnapshot().value?.backgroundAi).toEqual(profileDefaults)
    const revision = mirror.scope.getSnapshot().revision!
    const value = { ...backgroundAiPreferencesOf(), selection: { provider: 'portable-provider', model: 'portable-model' }, systemPrompt: 'Workbench instructions' }
    await expect(mirror.scope.patch!({ operation: 'set', path: ['backgroundAi'], value, expectedRevision: revision })).resolves.toEqual({ status: 'committed', revision: revision + 1 })
    expect(f.directory.getSnapshot().value.backgroundAi).toEqual(profileDefaults)
    expect(f.directory.getSnapshot().value.workbenches.a?.backgroundAi).toEqual(value)
    expect(mirror.scope.getSnapshot().value?.backgroundAi).toEqual(value)
    expect(JSON.parse(await readFile(join(f.directory.rootPath('a'), '.bay', 'workbench.json'), 'utf8')).record.backgroundAi).toEqual(value)
    await expect(mirror.scope.patch!({ operation: 'set', path: ['backgroundAi'], value: { ...value, systemPrompt: 'stale' }, expectedRevision: revision })).resolves.toMatchObject({ status: 'conflict' })
    expect(f.directory.getSnapshot().value.workbenches.a?.backgroundAi?.systemPrompt).toBe('Workbench instructions')
    const globalWrite = await browserFetch(WORKBENCH_DIRECTORY_ROUTE, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'patch', requestId: 'forged-global-preference', operation: { operation: 'set', path: ['backgroundAi'], value, expectedRevision: revision + 1 } }) })
    expect(globalWrite.status).toBe(403)
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
