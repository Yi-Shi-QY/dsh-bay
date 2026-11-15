/**
 * Boots manual agent assembly once the directory and the preset registry exist.
 * Registration is memory-only, so it happens again on every Host start.
 *
 * Install this before Bay Agent: Bay waits on `AGENT_ASSEMBLY_READY` before it
 * creates or resumes a native session, so a session that names a `bay:` preset
 * is not resolved before that preset is registered again.
 */

import type { Context } from '@deepseek-ai/cordis'
import type { HostConnectionHandle } from '@deepseek-ai/dsh-client-connection'
import type { AgentPresetRegistry } from '@deepseek-ai/dsh-agent-preset-registry'
import { HostAgentAssemblyStore, type AgentAssemblySessionUseV1 } from './host-agent-assembly.ts'
import { installAgentAssemblyRoute } from './host-agent-assembly-route.ts'
import { setDirectoryRoutePresetOffer } from './host-workbench-directory-route.ts'
import { HostAgentKit } from './host-agent-kit.ts'
import { installAgentKitBinder } from './host-agent-kit-binder.ts'
import { AGENT_KIT_SERVICE } from './agent-kit-contract.ts'
import type { HostWorkbenchDirectory } from './host-workbench-directory.ts'
import type { HostWorkbenchAccess } from './host-workbench-access.ts'
import { WORKBENCH_DIRECTORY_SERVICE, type WorkbenchSessionEntryV1 } from './workbench-directory-contract.ts'
import { WORKBENCH_ACCESS_SERVICE } from './workbench-access-contract.ts'
import { AGENT_ASSEMBLY_READY, AGENT_ASSEMBLY_SERVICE } from './agent-assembly-model.ts'
import type { BayAgentWorkStateV1 } from './foundation/workbench-bay-agent-work.ts'

const OPEN_TASKS = new Set(['proposed', 'queued', 'running', 'waiting', 'needs_input', 'ready', 'blocked'])

/** Sessions in the catalog plus unfinished tasks, so an unregister warning names every live use. */
export function presetUses(record: { sessionCatalog?: Record<string, WorkbenchSessionEntryV1> } | undefined, tasks: Pick<BayAgentWorkStateV1, 'workItems'> | undefined, presetId: string): AgentAssemblySessionUseV1[] {
  const sessions = Object.values(record?.sessionCatalog ?? {})
    .filter(entry => entry.agentPreset === presetId)
    .map(entry => ({ sessionKey: entry.sessionKey, title: entry.title, role: entry.role }))
  const work = (tasks?.workItems ?? [])
    .filter(item => item.agentPreset === presetId && OPEN_TASKS.has(item.status))
    .map(item => ({ sessionKey: 'task:' + item.workItemId, title: '任务：' + item.objective, role: 'task' }))
  return [...sessions, ...work]
}

export function installAgentAssemblyHost(ctx: Context): (() => void) | undefined {
  const connection = ctx.get('connection', false) as HostConnectionHandle | undefined
  const directory = ctx.get(WORKBENCH_DIRECTORY_SERVICE, false) as HostWorkbenchDirectory | undefined
  const presets = ctx.get('agentPresets', false) as AgentPresetRegistry | undefined
  if (!connection?.fetch || !directory || !presets) return undefined
  const access = ctx.get(WORKBENCH_ACCESS_SERVICE, false) as HostWorkbenchAccess | undefined
  const kit = new HostAgentKit()
  const store = new HostAgentAssemblyStore(directory, presets, kit)
  store.sessionsUsing = (workbenchId, presetId) => {
    const runtime = ctx.get('workbenchSessionRuntime', false) as { store?: { load(id: string): BayAgentWorkStateV1 } } | undefined
    let tasks: BayAgentWorkStateV1 | undefined
    try { tasks = runtime?.store?.load(workbenchId) } catch { tasks = undefined }
    return presetUses(directory.getSnapshot().value.workbenches[workbenchId], tasks, presetId)
  }
  ctx.provide(AGENT_KIT_SERVICE, kit)
  ctx.provide(AGENT_ASSEMBLY_SERVICE, store)
  setDirectoryRoutePresetOffer((workbenchId, presetId, guest) => store.offers(workbenchId, presetId, guest))
  const ready = store.restore().then(() => undefined, error => {
    ctx.logger?.warn('Agent assembly restore failed: %s', String(error))
    throw error
  })
  ctx.provide(AGENT_ASSEMBLY_READY, ready)
  // Extensions load after Core. A revision a person selected registers once its executors arrive.
  const offKit = kit.subscribe(() => {
    void ready.then(() => store.refreshAvailability()).then(() => store.restore()).catch(error => ctx.logger?.warn('Agent assembly refresh failed: %s', String(error)))
  })
  const offDirectory = directory.subscribe(() => {
    void ready.then(() => store.pruneDeletedWorkbenches()).catch(error => ctx.logger?.warn('Agent assembly directory cleanup failed: %s', String(error)))
  })
  const disposeBinder = typeof ctx.on === 'function'
    ? installAgentKitBinder(ctx as never, { kit, presets, binding: presetId => store.binding(presetId) })
    : () => {}
  const disposeRoute = installAgentAssemblyRoute(connection, store, access)
  return () => { setDirectoryRoutePresetOffer(undefined); disposeRoute(); disposeBinder(); offDirectory(); offKit(); void store.dispose() }
}
