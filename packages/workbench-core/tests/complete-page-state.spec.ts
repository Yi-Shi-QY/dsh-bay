import { expect, it, vi } from 'vitest'
import { migrateCompletePageStates } from '../src/foundation/complete-page-state.ts'
import type { WorkbenchEditorCatalogRow } from '../src/foundation/catalog.ts'
import type { ModuleInstanceDocument } from '../src/foundation/document-v3.ts'
import { CompleteMigrationRegistry } from '../src/host-complete-migrations.ts'
import type { CompleteExtensionLock } from '../src/workbench-complete-contract.ts'
import type { SessionEvent } from '@deepseek-ai/dsh-session'

const page: ModuleInstanceDocument = { moduleInstanceId: 'page', editorId: 'test.editor', editorScope: 'root', lastKnownTitle: 'Notes', state: { schemaVersion: 1, note: 'portable', localCache: 42 } }
const editor: WorkbenchEditorCatalogRow = { id: 'test.editor', label: 'Notes', scope: 'root',
  declaration: { editorId: 'test.editor', label: 'Notes', scope: 'root', requiredBinding: 'none', runtime: { background: 'pause', collapsed: 'dispose', reacquire: 'on-visible' }, state: { schemaVersion: 1, maxBytes: 4096, share: 'portable', restore: 'if-valid' } },
  portability: { version: 1, exportState: () => ({ schemaVersion: 1, note: 'portable' }), importState: value => value },
}
it('uses explicit portable projections and blocks unavailable or failed page handlers', () => {
  expect(migrateCompletePageStates([page], [editor], 'export')).toEqual([{ moduleInstanceId: 'page', editorId: 'test.editor', state: { schemaVersion: 1, note: 'portable' } }])
  expect(() => migrateCompletePageStates([page], [], 'import')).toThrow('恢复处理器')
  expect(() => migrateCompletePageStates([page], [{ ...editor, portability: { version: 1, importState() { throw new Error('migration failed') } } }], 'import')).toThrow('migration failed')
  expect(page.state).toEqual({ schemaVersion: 1, note: 'portable', localCache: 42 })
})

it('binds Host migration handlers to exact artifacts and schema versions, and rejects undeclared data', async () => {
  const registry = new CompleteMigrationRegistry(), restore = vi.fn(async () => {})
  const extension: CompleteExtensionLock = { packageName: 'test', moduleId: 'test', version: '1.0.0', artifactSha256: 'a'.repeat(64), permissions: [], editorIds: [], exportPolicy: 'embed', platforms: ['linux'], migrations: { events: [{ type: 'test/event', schemaVersion: 1 }], workbenchData: [{ key: 'notes', schemaVersion: 1 }] } }
  const unregister = registry.register({ ...extension, events: [{ type: 'test/event', schemaVersion: 1, remap: event => event }], workbenchData: [{ key: 'notes', schemaVersion: 1, export: async () => ({ text: 'note' }), restore }] })
  expect(() => registry.adapters([{ ...extension, artifactSha256: 'b'.repeat(64) }])).toThrow('缺少事件迁移器')
  const context = { sessionIds: {}, sourceRoot: '/source', targetRoot: '/target' }
  expect(() => registry.adapters([extension]).get('test/event')!({ type: 'test/event', seq: 0, data: { schemaVersion: 2 } } as unknown as SessionEvent, context)).toThrow('schema')
  const data = await registry.exportData([extension], { workbenchId: 'source', root: '/source' })
  await registry.restoreData([extension], data, { jobId: 'fixed-job', workbenchId: 'target', root: '/target', remap: context })
  expect(restore).toHaveBeenCalledWith({ text: 'note' }, expect.objectContaining({ jobId: 'fixed-job' }))
  await expect(registry.restoreData([extension], [], { jobId: 'fixed-job', workbenchId: 'target', root: '/target', remap: context })).rejects.toThrow('不完整')
  unregister()
  expect(() => registry.adapters([extension])).toThrow('缺少事件迁移器')
})
