import type { Context } from '@deepseek-ai/cordis'
import { HostWorkbenchDirectory } from './host-workbench-directory.ts'
import { HostWorkbenchAccess } from './host-workbench-access.ts'
import { HostWorkbenchMemory } from './host-workbench-memory.ts'
import { installWorkbenchDirectoryRoute } from './host-workbench-directory-route.ts'
import { WORKBENCH_DIRECTORY_SERVICE } from './workbench-directory-contract.ts'
import { WORKBENCH_ACCESS_SERVICE } from './workbench-access-contract.ts'
import { readDshExtensionInventoryV1 } from './read-dsh-extension-inventory.ts'

export interface WorkbenchSessionRuntime {
  ensure(id: string): Promise<unknown>
  createUserSession(input: { workbenchId: string; areaId: string; requestId: string; agentPreset: string; workspaceId: string }): Promise<string>
}
export const WORKBENCH_SESSION_RUNTIME = 'workbenchSessionRuntime'

/** Directory and memory availability do not depend on model or Agent startup. */
export function installWorkbenchDirectoryHost(ctx: Context): (() => void) | undefined {
  const connection = ctx.get('connection', false), profile = ctx.get('profileContext', false), workspaces = ctx.get('workspaceRegistry', false)
  if (!connection?.fetch || !profile?.dir || !workspaces) return undefined
  const directory = new HostWorkbenchDirectory(profile.dir, workspaces)
  const memory = new HostWorkbenchMemory(id => directory.rootPath(id), id => directory.getSnapshot().value.workbenches[id]!)
  const access = new HostWorkbenchAccess(directory, memory)
  ctx.provide(WORKBENCH_DIRECTORY_SERVICE, directory)
  ctx.provide(WORKBENCH_ACCESS_SERVICE, access)
  const runtime = () => {
    const value = ctx.get(WORKBENCH_SESSION_RUNTIME, false) as WorkbenchSessionRuntime | undefined
    if (!value) throw new Error('会话服务正在启动，请稍后重试；工作台目录已保留。')
    return value
  }
  // LAN participants may not call the native plugin manager: its bundle rows
  // carry install specs with absolute local paths. The Host reads it and
  // returns only the identity and state fields Workbench needs.
  const readExtensionInventory = async () => {
    const manager = ctx.get('pluginManager', false) as { listPlugins(): Promise<unknown>; listBundles(): Promise<unknown> } | undefined
    if (manager === undefined) throw new Error('插件清单服务不可用。')
    return readDshExtensionInventoryV1({
      pluginInventory: { list: async () => ({ entries: await manager.listPlugins() }) },
      pluginManager: { listBundles: () => manager.listBundles() },
    })
  }
  const dispose = installWorkbenchDirectoryRoute(connection, directory, id => runtime().ensure(id), memory, input => runtime().createUserSession(input), access, readExtensionInventory)
  return () => { dispose(); access.dispose() }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    workbenchDirectoryHost: HostWorkbenchDirectory
    workbenchAccessHost: HostWorkbenchAccess
    workbenchSessionRuntime: WorkbenchSessionRuntime
  }
}
