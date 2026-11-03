/** Shared DSH Connection transport identity for the browser Workbench view. */
export const WORKBENCH_WINDOW_RPC_CHANNEL = '/api' as const
export const WORKBENCH_WINDOW_RPC_PREFIX = 'workbench-window' as const

export function workbenchWindowRpcEndpoint(endpoint: string): string {
  return `${WORKBENCH_WINDOW_RPC_PREFIX}/${endpoint}`
}

export function workbenchWindowEndpointForRpc(endpoint: string): string | undefined {
  const prefix = `${WORKBENCH_WINDOW_RPC_PREFIX}/`
  return endpoint.startsWith(prefix) ? endpoint.slice(prefix.length) : undefined
}
