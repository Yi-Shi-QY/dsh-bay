interface CapabilityContext {
  get?: (name: string) => unknown
}

function hasMethod(value: unknown, name: string): boolean {
  return typeof value === 'object' && value !== null
    && typeof Reflect.get(value, name) === 'function'
}

/** Inspect public service faces without opening or selecting a Session. */
export function inspectWorkbenchClientInstallEnvironment(ctx: CapabilityContext) {
  const service = (name: string): unknown => {
    try { return ctx.get?.(name) } catch { return undefined }
  }
  const sessionRemote = service('remote.session')
  const sessions = service('sessions')
  const capabilities: string[] = ['workbench.conversation.areas']
  if (hasMethod(sessionRemote, 'prompt')) capabilities.push('conversation.send')
  if (hasMethod(sessionRemote, 'cancel')) capabilities.push('conversation.cancel')
  if (hasMethod(sessions, 'scope')) capabilities.push('sessions.scope')
  const verifiedSeams: string[] = []
  if (service('layout') !== undefined && hasMethod(service('slots'), 'entriesOfSlot')) verifiedSeams.push('client.ui-layout')
  if (hasMethod(service('configForms'), 'get') || hasMethod(service('settingsScope'), 'bind')) verifiedSeams.push('client.ui-settings')
  return { capabilities, verifiedSeams }
}
