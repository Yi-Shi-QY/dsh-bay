import { describe, expect, it, vi } from 'vitest'
import { WORKBENCH_CONVERSATION_SUITE_EDITOR_IDS as editors } from '../src/conversation-suite-contract.ts'
import { createAreaSessionCreator } from '../src/client/session-placement.ts'
import { ConversationAreaCoordinator } from '../src/foundation/conversation-area-coordinator.ts'
import { migrateDocumentV2ToV3, projectDocumentV3ToLayoutV2, validateWorkbenchDocumentV3 } from '../src/foundation/document-v3.ts'
import { defaultLayout } from '../src/foundation/model.ts'
import { WorkbenchRepository } from '../src/foundation/repository.ts'

function fixture(withStart = false) {
  const base = migrateDocumentV2ToV3(defaultLayout())
  const document = withStart && base.root.kind === 'area'
    ? {
      ...base,
      root: {
        ...base.root,
        activeModuleInstanceId: 'start',
        moduleHistory: [{
          moduleInstanceId: 'start', editorId: editors.start, editorScope: 'root' as const,
          state: {}, lastKnownTitle: '新建对话',
        }],
      },
    }
    : base
  const repository = new WorkbenchRepository({
    version: 4, activeWorkbenchId: 'main', openWorkbenchIds: ['main'],
    workbenches: { main: { workbenchId: 'main', name: 'Main', description: '', createdAt: 0, updatedAt: 0, document } },
    layoutTemplates: {}, invalidWorkbenches: {}, sessionMarkers: {},
  })
  const module = () => {
    const root = repository.getWorkbench('main')!.document.root
    if (root.kind !== 'area') throw new Error('Expected one Area')
    return root.moduleHistory.find(item => item.moduleInstanceId === root.activeModuleInstanceId)!
  }
  return { repository, areaId: document.activeAreaId, module }
}

describe('Core Area binding to Conversation Suite', () => {
  it('keeps the initial Area empty until Conversation Suite is activated', () => {
    expect(fixture().module()).toBeUndefined()
  })

  it('binds the created Session to the registered conversation editor', async () => {
    const { repository, areaId, module } = fixture()
    const createWorkspaceSession = createAreaSessionCreator({
      create: async () => 'created',
    })
    const coordinator = new ConversationAreaCoordinator(repository, {
      createWorkspaceSession,
      connectWorkspace: async () => { throw new Error('Unexpected reuse') },
      createWorkspace: async () => { throw new Error('Unexpected workspace creation') },
    })
    const result = await coordinator.execute({
      type: 'create-in-workspace', workspaceId: 'workspace',
      claim: repository.claimArea('main', areaId, 'create'),
    })
    expect(result.status).toBe('bound')
    expect(module()).toMatchObject({ editorId: editors.conversation, binding: { sessionId: 'created', workspaceId: 'workspace' } })
  })

  it('replaces the active Start occurrence instead of appending a second tab', async () => {
    const { repository, areaId, module } = fixture(true)
    const startId = repository.getWorkbench('main')!.document.root.kind === 'area'
      ? repository.getWorkbench('main')!.document.root.activeModuleInstanceId
      : undefined
    const coordinator = new ConversationAreaCoordinator(repository, {
      createWorkspaceSession: async () => ({ target: { sessionId: 'created', workspaceId: 'workspace' }, reusedBlank: false }),
      connectWorkspace: async () => { throw new Error('Unexpected reuse') },
      createWorkspace: async () => { throw new Error('Unexpected workspace creation') },
    })

    expect(await coordinator.execute({
      type: 'create-in-workspace', workspaceId: 'workspace',
      claim: repository.claimArea('main', areaId, 'replace-start'),
    })).toMatchObject({ status: 'bound' })

    const root = repository.getWorkbench('main')!.document.root
    expect(root.kind).toBe('area')
    if (root.kind !== 'area') return
    expect(root.moduleHistory).toHaveLength(1)
    expect(root.activeModuleInstanceId).toBe(startId)
    expect(root.moduleHistory[0]).toMatchObject({
      moduleInstanceId: startId,
      editorId: editors.conversation,
      editorScope: 'session',
      binding: { sessionId: 'created', workspaceId: 'workspace' },
    })
  })

  it('finishes asynchronous creation in its claimed page even after focus moves', async () => {
    const { repository, areaId } = fixture(true)
    const pending = Promise.withResolvers<{ target: { sessionId: string; workspaceId: string }; reusedBlank: false }>()
    const coordinator = new ConversationAreaCoordinator(repository, { createWorkspaceSession: () => pending.promise, connectWorkspace: vi.fn(), createWorkspace: vi.fn() })
    const preparing = coordinator.execute({ type: 'create-in-workspace', workspaceId: 'workspace', presentation: 'start', startModuleInstanceId: 'start', claim: repository.claimArea('main', areaId, 'async-target') })
    const document = repository.getWorkbench('main')!.document
    if (document.root.kind !== 'area') throw new Error('Expected Area')
    repository.replaceDocument('main', { ...document, root: { ...document.root, activeModuleInstanceId: 'other', moduleHistory: [...document.root.moduleHistory,
      { moduleInstanceId: 'other', editorId: 'workbench.conversation', editorScope: 'session', binding: { sessionId: 'independent', workspaceId: 'workspace' }, lastKnownTitle: 'Other', state: {} }] } })
    pending.resolve({ target: { sessionId: 'created', workspaceId: 'workspace' }, reusedBlank: false })
    expect(await preparing).toMatchObject({ status: 'bound' })
    const root = repository.getWorkbench('main')!.document.root
    if (root.kind !== 'area') throw new Error('Expected Area')
    expect(root.moduleHistory.find(page => page.moduleInstanceId === 'other')?.binding?.sessionId).toBe('independent')
    expect(root.moduleHistory.find(page => page.moduleInstanceId === 'start')?.binding?.sessionId).toBe('created')
  })

  it('keeps the Start editor visible after Workspace selection while binding its native Session', async () => {
    const { repository, areaId, module } = fixture(true)
    const create = vi.fn(async () => 'created')
    const createWorkspaceSession = createAreaSessionCreator({
      create,
    })
    const coordinator = new ConversationAreaCoordinator(repository, {
      createWorkspaceSession,
      connectWorkspace: async () => { throw new Error('Unexpected reuse') },
      createWorkspace: async () => { throw new Error('Unexpected workspace creation') },
    })
    const result = await coordinator.execute({
      type: 'create-in-workspace', workspaceId: 'workspace', presentation: 'start', startModuleInstanceId: 'start',
      claim: repository.claimArea('main', areaId, 'prepare'),
    })
    expect(result).toMatchObject({ status: 'bound', target: { sessionId: 'created', workspaceId: 'workspace' } })
    expect(create).toHaveBeenCalledOnce()
    expect(module()).toMatchObject({
      editorId: editors.start, editorScope: 'root',
      binding: { sessionId: 'created', workspaceId: 'workspace' },
    })
    expect(repository.getWorkbench('main')!.document.root).toMatchObject({
      moduleHistory: [{ editorId: editors.start, editorScope: 'root', binding: { sessionId: 'created', workspaceId: 'workspace' } }],
    })
    expect(projectDocumentV3ToLayoutV2(repository.getWorkbench('main')!.document).root).toMatchObject({
      tabs: [{ id: 'start', editorId: editors.start, editorScope: 'root', sessionId: 'created' }],
    })
    const stored = repository.getWorkbench('main')!.document
    const restored = validateWorkbenchDocumentV3(JSON.parse(JSON.stringify(stored)))!
    expect(restored).toEqual(stored)
    expect(migrateDocumentV2ToV3(projectDocumentV3ToLayoutV2(restored))).toEqual(stored)
    await coordinator.execute({
      type: 'create-in-workspace', workspaceId: 'workspace', presentation: 'start', startModuleInstanceId: 'start',
      claim: repository.claimArea('main', areaId, 'repeat'),
    })
    expect(create).toHaveBeenCalledOnce()
  })

  it('promotes the prepared Start to Conversation only after the native Session reports an accepted prompt', async () => {
    const { repository, areaId, module } = fixture(true)
    const createWorkspaceSession = createAreaSessionCreator({
      create: async () => 'created',
    })
    const coordinator = new ConversationAreaCoordinator(repository, {
      createWorkspaceSession,
      connectWorkspace: async () => { throw new Error('Unexpected reuse') },
      createWorkspace: async () => { throw new Error('Unexpected workspace creation') },
    })
    const result = await coordinator.execute({
      type: 'create-in-workspace', workspaceId: 'workspace', presentation: 'start', startModuleInstanceId: 'start',
      claim: repository.claimArea('main', areaId, 'prepare'),
    })
    expect(result).toMatchObject({ status: 'bound' })
    expect(module()).toMatchObject({ editorId: editors.start, editorScope: 'root' })
    expect(repository.activatePreparedConversation('main', areaId, { sessionId: 'created', workspaceId: 'workspace' }, 'stale-start', 1)).toBe(false)
    expect(repository.activatePreparedConversation('main', areaId, { sessionId: 'created', workspaceId: 'workspace' }, 'start', 2)).toBe(false)
    expect(repository.activatePreparedConversation('main', areaId, { sessionId: 'created', workspaceId: 'workspace' }, 'start', 1)).toBe(true)
    expect(module()).toMatchObject({
      editorId: editors.conversation, editorScope: 'session',
      binding: { sessionId: 'created', workspaceId: 'workspace' },
    })
  })

  it('drops a late creation result after a newer claim binds the Area', async () => {
    const { repository, areaId, module } = fixture()
    const pending = Promise.withResolvers<{ target: { sessionId: string }; reusedBlank: false }>()
    const coordinator = new ConversationAreaCoordinator(repository, {
      createWorkspaceSession: () => pending.promise,
      connectWorkspace: async () => { throw new Error('Unexpected reuse') },
      createWorkspace: async () => { throw new Error('Unexpected workspace creation') },
    })
    const late = coordinator.execute({ type: 'create-in-workspace', workspaceId: 'workspace', claim: repository.claimArea('main', areaId, 'old') })
    repository.bindConversation(repository.claimArea('main', areaId, 'new'), { sessionId: 'newer' }, false)
    pending.resolve({ target: { sessionId: 'late' }, reusedBlank: false })
    expect(await late).toMatchObject({ status: 'stale', reason: 'area-replaced' })
    expect(module()).toMatchObject({ editorId: editors.conversation, binding: { sessionId: 'newer' } })
  })

  it('creates an independent Session when sibling pages already use another conversation', async () => {
    const { repository, areaId, module } = fixture(true)
    const doc = repository.getWorkbench('main')!.document
    if (doc.root.kind !== 'area') throw new Error('Expected Area')
    repository.replaceDocument('main', { ...doc, root: { ...doc.root,
      moduleHistory: [...doc.root.moduleHistory, {
        moduleInstanceId: 'existing', editorId: editors.conversation, editorScope: 'session',
        binding: { sessionId: 'existing', workspaceId: 'workspace' }, state: {}, lastKnownTitle: 'Conversation',
      }],
    } })
    const createWorkspaceSession = vi.fn(async () => ({ target: { sessionId: 'new-session', workspaceId: 'workspace' }, reusedBlank: false as const }))
    const coordinator = new ConversationAreaCoordinator(repository, {
      createWorkspaceSession, connectWorkspace: vi.fn(), createWorkspace: vi.fn(),
    })
    expect(await coordinator.execute({
      type: 'create-in-workspace', workspaceId: 'workspace', presentation: 'start', startModuleInstanceId: 'start',
      claim: repository.claimArea('main', areaId, 'conflict'),
    })).toMatchObject({ status: 'bound', target: { sessionId: 'new-session', workspaceId: 'workspace' } })
    expect(createWorkspaceSession).toHaveBeenCalledOnce()
    expect(module()).toMatchObject({ editorId: editors.start, binding: { sessionId: 'new-session', workspaceId: 'workspace' } })
    const updated = repository.getWorkbench('main')!.document.root
    expect(updated.kind).toBe('area')
    if (updated.kind === 'area') {
      expect(updated.moduleHistory.find(item => item.moduleInstanceId === 'existing')).toMatchObject({
        editorId: editors.conversation,
        binding: { sessionId: 'existing', workspaceId: 'workspace' },
      })
    }
  })

  it('rejects late preparation and promotion after the Start occurrence is replaced', async () => {
    const { repository, areaId, module } = fixture(true)
    const pending = Promise.withResolvers<{ target: { sessionId: string; workspaceId: string }; reusedBlank: false }>()
    const coordinator = new ConversationAreaCoordinator(repository, {
      createWorkspaceSession: () => pending.promise, connectWorkspace: vi.fn(), createWorkspace: vi.fn(),
    })
    const preparing = coordinator.execute({
      type: 'create-in-workspace', workspaceId: 'workspace', presentation: 'start', startModuleInstanceId: 'start',
      claim: repository.claimArea('main', areaId, 'pending'),
    })
    const doc = repository.getWorkbench('main')!.document
    if (doc.root.kind !== 'area') throw new Error('Expected Area')
    repository.replaceDocument('main', { ...doc, root: { ...doc.root,
      moduleHistory: doc.root.moduleHistory.map(item => ({ ...item, editorId: 'workbench.browser' })),
    } })
    pending.resolve({ target: { sessionId: 'late', workspaceId: 'workspace' }, reusedBlank: false })
    expect(await preparing).toMatchObject({ status: 'stale' })
    expect(repository.activatePreparedConversation('main', areaId, { sessionId: 'late', workspaceId: 'workspace' }, 'start', 1)).toBe(false)
    expect(module().editorId).toBe('workbench.browser')
  })
})
