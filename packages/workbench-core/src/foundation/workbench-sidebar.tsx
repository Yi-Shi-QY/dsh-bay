import type { SidebarRootComponentProps } from './workbench-sidebar/generated/upstream/ui-sidebar/contract/slots.ts'
import { SidebarRoot } from './workbench-sidebar/generated/upstream/ui-sidebar/SidebarRoot.tsx'

type WorkspaceId = string

/** Locked upstream Sidebar shell with only the New Session callback replaced. */
export type WorkbenchSidebarProps = Omit<SidebarRootComponentProps, 'startSession'> & {
  startSession: (workspaceId?: WorkspaceId) => void | Promise<void>
}

export function WorkbenchSidebar(props: WorkbenchSidebarProps) {
  return <SidebarRoot {...(props as SidebarRootComponentProps)} />
}
