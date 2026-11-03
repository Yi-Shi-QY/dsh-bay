import { describe, expect, it } from 'vitest'
import { defaultLayout } from '../src/foundation/model.ts'
import { migrateDocumentV2ToV3 } from '../src/foundation/document-v3.ts'
import { createWorkbenchCreatorInspectProvider, deriveWorkbenchCreatorInspectSnapshot, type WorkbenchCreatorInspectOptions } from '../src/client/workbench-creator-inspect.ts'
import type { WorkbenchSettingsV4 } from '../src/foundation/persistence.ts'

function fixture(): WorkbenchCreatorInspectOptions {
  const document = migrateDocumentV2ToV3(defaultLayout('bound-session', 'workspace:workspace-a'))
  if (document.root.kind === 'area') document.root.moduleHistory[0]!.state = { apiKey: 'private-key-fixture', transcript: 'private-message-fixture' }
  const value: WorkbenchSettingsV4 = {
    version: 4, activeWorkbenchId: 'main', openWorkbenchIds: ['main'],
    workbenches: { main: { workbenchId: 'main', name: '主工作台', description: '', document, createdAt: 1, updatedAt: 2 } },
    invalidWorkbenches: {}, layoutTemplates: {}, sessionMarkers: {},
  }
  return {
    settings: { getSnapshot: () => ({ status: 'ready', writable: true, revision: 17, mode: 'host', value }), subscribe: () => () => {}, set: async () => {}, unset: async () => {} },
    editorCatalog: { getSnapshot: () => [{ id: 'workbench.conversation', label: '对话', scope: 'session', pluginId: '@dsh-workbench/core' }], subscribe: () => () => {} },
    sessions: { list: { getSnapshot: () => ({ ids: ['main-session', 'bound-session'], byId: {
      'bound-session': { displayTitle: '本区域对话', running: true, updatedAt: 3, agentPreset: 'workbench-creator' },
      'main-session': { displayTitle: '官方主对话', running: false, updatedAt: 4 },
    } }), subscribe: () => () => {} } },
    workspaces: { list: { getSnapshot: () => ({ items: [{ workspaceId: 'workspace-a', path: 'C:/private/workspace-path', sessionIds: ['bound-session'] }], archivedSessionIds: [] }), subscribe: () => () => {} } },
  }
}

describe('Core Workbench Creator inspection', () => {
  it('projects the exact Area binding and revision without borrowing the official main Session', () => {
    const result = deriveWorkbenchCreatorInspectSnapshot(fixture())
    expect(result.source.revision).toBe(17)
    expect(result.current?.areas[0]?.current?.binding).toMatchObject({ sessionId: 'bound-session', workspaceId: 'workspace-a', state: 'bound', agentPreset: 'workbench-creator' })
    expect(JSON.stringify(result)).not.toContain('main-session')
    expect(result.supportedIntents.every(intent => intent === 'inspect' || intent.startsWith('plan.'))).toBe(true)
  })

  it('does not expose raw editor state, transcripts or a fallback Workspace path', () => {
    const result = deriveWorkbenchCreatorInspectSnapshot(fixture())
    expect(result.current?.areas[0]?.current?.state).toEqual({ present: true, kind: 'object' })
    const encoded = JSON.stringify(result)
    for (const secret of ['private-key-fixture', 'private-message-fixture', 'C:/private/workspace-path', 'apiKey']) expect(encoded).not.toContain(secret)
  })

  it('reports unavailable resources and never creates or mutates a Session', async () => {
    const options = fixture()
    options.sessions = { list: { getSnapshot: () => ({ ids: [], byId: {} }), subscribe: () => () => {} } }
    const provider = createWorkbenchCreatorInspectProvider(options)
    expect(provider.manifest.methods.map(method => method.name)).toEqual(['inspect'])
    expect((await provider.query('inspect', undefined)) as unknown).toMatchObject({ current: { areas: [{ current: { binding: { state: 'missing' } } }] } })
    await expect(provider.query('apply', undefined)).rejects.toThrow('unknown WorkbenchCreator inspect method')
  })
})
