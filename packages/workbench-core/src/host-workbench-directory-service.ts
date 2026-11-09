import type { Context } from '@deepseek-ai/cordis'
import { HostWorkbenchDirectory } from './host-workbench-directory.ts'
import { HostWorkbenchAccess } from './host-workbench-access.ts'
import { HostWorkbenchMemory } from './host-workbench-memory.ts'
import { installWorkbenchDirectoryRoute } from './host-workbench-directory-route.ts'
import { WORKBENCH_DIRECTORY_SERVICE } from './workbench-directory-contract.ts'
import { WORKBENCH_ACCESS_SERVICE } from './workbench-access-contract.ts'
import { decodeWorkbenchSettingsV4 } from './foundation/persistence.ts'

export interface WorkbenchSessionRuntime {
  ensure(id: string): Promise<unknown>
  createUserSession(input: { workbenchId: string; areaId: string; requestId: string; agentPreset: string; workspaceId: string }): Promise<string>
}
export const WORKBENCH_SESSION_RUNTIME = 'workbenchSessionRuntime'

/** Directory and memory availability do not depend on model or Agent startup. */
export function installWorkbenchDirectoryHost(ctx: Context): (() => void) | undefined {
  const connection = ctx.get('connection', false), profile = ctx.get('profileContext', false), workspaces = ctx.get('workspaceRegistry', false)
  if (!connection?.fetch || !profile?.dir || !workspaces) return undefined
  const directory = new HostWorkbenchDirectory(profile.dir, workspaces, decodeWorkbenchSettingsV4(ctx.get('settings', false)?.describe().find(row => row.ns === 'workbench-layout')?.value))
  const access = new HostWorkbenchAccess(directory)
  ctx.provide(WORKBENCH_DIRECTORY_SERVICE, directory)
  ctx.provide(WORKBENCH_ACCESS_SERVICE, access)
  const runtime = () => {
    const value = ctx.get(WORKBENCH_SESSION_RUNTIME, false) as WorkbenchSessionRuntime | undefined
    if (!value) throw new Error('会话服务正在启动，请稍后重试；工作台目录已保留。')
    return value
  }
  const memory = new HostWorkbenchMemory(id => directory.rootPath(id))
  const dispose = installWorkbenchDirectoryRoute(connection, directory, id => runtime().ensure(id), memory, input => runtime().createUserSession(input), access)
  return () => { dispose(); access.dispose() }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    workbenchDirectoryHost: HostWorkbenchDirectory
    workbenchAccessHost: HostWorkbenchAccess
    workbenchSessionRuntime: WorkbenchSessionRuntime
  }
}
