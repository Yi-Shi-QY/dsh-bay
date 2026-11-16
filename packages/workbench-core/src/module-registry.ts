import {
  type WorkbenchModuleContextV1,
  type WorkbenchModuleDiagnosticV1,
  type WorkbenchModuleLifecycleStateV1,
  type WorkbenchModuleV1,
  createWorkbenchModuleContextV1,
  validateWorkbenchModuleManifestV1,
} from './module-contract.ts'

interface RecordV1 { readonly module: WorkbenchModuleV1; state: WorkbenchModuleLifecycleStateV1; message: string | undefined }
export interface WorkbenchModuleRegistryV1 {
  register(module: WorkbenchModuleV1): void
  list(): readonly WorkbenchModuleV1['manifest'][]
  get(moduleId: string): WorkbenchModuleV1 | undefined
  activate(moduleId: string): Promise<void>
  deactivate(moduleId: string, reason?: 'user' | 'rollback' | 'upgrade' | 'shutdown'): Promise<void>
  diagnostics(): readonly WorkbenchModuleDiagnosticV1[]
}

export function createWorkbenchModuleRegistry(options: { context: WorkbenchModuleContextV1; capabilities?: readonly string[] }): WorkbenchModuleRegistryV1 {
  const records = new Map<string, RecordV1>()
  const contexts = new Map<string, WorkbenchModuleContextV1>()
  const ownedDisposers = new Map<string, Array<() => void>>()
  const capabilities = new Set(options.capabilities ?? options.context.host.capabilities())
  const mark = (record: RecordV1, state: WorkbenchModuleLifecycleStateV1, message?: string): void => {
    record.state = state
    record.message = message
    if (message !== undefined) options.context.diagnostics.report({ moduleId: record.module.manifest.moduleId, state, message })
  }
  const activateOne = async (id: string, path: string[], activated: string[]): Promise<void> => {
    const record = records.get(id)
    if (record === undefined) throw new Error(`Unknown Workbench module: ${id}`)
    if (record.state === 'active') return
    if (record.state === 'activating') throw new Error(`Workbench module dependency cycle: ${[...path, id].join(' → ')}`)
    mark(record, 'activating')
    try {
      const missing = record.module.manifest.requires.capabilities.filter(capability => !capabilities.has(capability))
      if (missing.length > 0) throw new Error(`Module ${id} missing capabilities: ${missing.join(', ')}`)
      for (const dependency of record.module.manifest.requires.modules) await activateOne(dependency, [...path, id], activated)
      await record.module.activate(contexts.get(id) ?? options.context)
      mark(record, 'active')
      activated.push(id)
    } catch (error) {
      for (const dispose of [...(ownedDisposers.get(id) ?? [])].reverse()) dispose()
      ownedDisposers.get(id)?.splice(0)
      mark(record, 'failed', error instanceof Error ? error.message : String(error))
      throw error
    }
  }
  const deactivate = async (id: string, reason: 'user' | 'rollback' | 'upgrade' | 'shutdown' = 'user'): Promise<void> => {
    const record = records.get(id)
    if (record === undefined || record.state !== 'active') return
    const dependent = [...records.values()].find(candidate => candidate.state === 'active' && candidate.module.manifest.requires.modules.includes(id))
    if (dependent !== undefined) throw new Error(`Cannot deactivate ${id} while ${dependent.module.manifest.moduleId} is active`)
    mark(record, 'deactivating')
    try {
      await record.module.deactivate(reason)
      for (const dispose of [...(ownedDisposers.get(id) ?? [])].reverse()) dispose()
      ownedDisposers.delete(id)
      mark(record, 'registered')
    }
    catch (error) { mark(record, 'failed', error instanceof Error ? error.message : String(error)); throw error }
  }
  return {
    register(module) {
      validateWorkbenchModuleManifestV1(module.manifest)
      const id = module.manifest.moduleId
      const existing = records.get(id)
      if (existing !== undefined) {
        if (existing.module.manifest.version === module.manifest.version && existing.module.manifest.artifactDigest.toLowerCase() === module.manifest.artifactDigest.toLowerCase()) return
        throw new Error(`Workbench module identity conflict: ${id}`)
      }
      const disposers: Array<() => void> = []
      const moduleContext: WorkbenchModuleContextV1 = createWorkbenchModuleContextV1({
        ...options.context,
        ...(options.context.contributions === undefined ? {} : {
          contributions: {
            register(input: { id: string; kind: string; value?: unknown }) {
              const dispose = options.context.contributions!.register({ ...input, ownerModuleId: id })
              disposers.push(dispose)
              return () => { dispose(); const index = disposers.indexOf(dispose); if (index >= 0) disposers.splice(index, 1) }
            },
          },
        }),
      })
      try { module.register(moduleContext) } catch (error) {
        for (const dispose of [...disposers].reverse()) dispose()
        throw error
      }
      contexts.set(id, moduleContext)
      ownedDisposers.set(id, disposers)
      records.set(id, { module, state: 'registered', message: undefined })
    },
    list: () => [...records.values()].map(record => record.module.manifest).sort((a, b) => a.moduleId.localeCompare(b.moduleId)),
    get: id => records.get(id)?.module,
    async activate(id) {
      const activated: string[] = []
      try { await activateOne(id, [], activated) }
      catch (error) { for (const activatedId of activated.reverse()) await deactivate(activatedId, 'rollback').catch(() => undefined); throw error }
    },
    deactivate,
    diagnostics: () => [...records.values()].map(record => ({ moduleId: record.module.manifest.moduleId, state: record.state, ...(record.message === undefined ? {} : { message: record.message }) })).sort((a, b) => a.moduleId.localeCompare(b.moduleId)),
  }
}
