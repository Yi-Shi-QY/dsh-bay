/**
 * Workbench-local copy of the pure first-use Workspace label helper.
 *
 * DSH RC1 publishes this helper as a type-only API package subpath rather
 * than a client module-table row, so the browser bundle must inline it.
 */
export const DEFAULT_WORKSPACE_DIRECTORY = 'default-workspace'

export function workspaceDisplayTitle(title: string, localizedDefault: string): string {
  return title === DEFAULT_WORKSPACE_DIRECTORY ? localizedDefault : title
}
