interface HostCapabilityContext { get(name: string): unknown }
function property(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null ? Reflect.get(value, key) : undefined
}
export function inspectWorkbenchHostInstallCapabilities(ctx: HostCapabilityContext): readonly string[] {
  const capabilities = ['workbench.conversation.areas']
  try {
    const sessions = ctx.get('sessions')
    const api = ctx.get('sessionController')
    if (typeof property(sessions, 'get') !== 'function') return capabilities
    capabilities.push('sessions.scope')
    if (typeof property(api, 'prompt') === 'function') capabilities.push('conversation.send')
    if (typeof property(api, 'cancel') === 'function') capabilities.push('conversation.cancel')
  } catch { /* Missing service faces leave the install plan blocked. */ }
  return capabilities
}
