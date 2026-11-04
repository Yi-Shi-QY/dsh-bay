import { FLOATING_UI_SETTINGS_ROUTE, validFloatingGeometry } from '../floating-ui-settings.ts'
import type { FloatingGeometry, FloatingWorkspaceRuntime } from './floating-workspace-runtime.ts'

export function connectFloatingUiPreferences(runtime: FloatingWorkspaceRuntime, companion: boolean, fetcher: typeof fetch = fetch) {
  let clientId: string = globalThis.crypto.randomUUID()
  try {
    const key = 'dsh-bay:floating-client:' + (companion ? 'companion' : 'desktop')
    clientId = localStorage.getItem(key) ?? clientId; localStorage.setItem(key, clientId)
  } catch { /* No persistent identity is safer than sharing another client's geometry. */ }
  let values: Record<string, FloatingGeometry> = {}, disposed = false
  let queue = Promise.resolve()
  const dirty = new Set<string>()
  const request = async (body: unknown) => {
    const response = await fetcher(FLOATING_UI_SETTINGS_ROUTE, { method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ clientId, ...(body as object) }) })
    if (!response.ok) throw new Error('UI preferences unavailable')
    const result = await response.json() as { value: Record<string, FloatingGeometry> }
    return result.value
  }
  runtime.configureGeometry(() => values, (id, geometry) => {
    dirty.add(id); values[id] = geometry
    queue = queue.catch(() => {}).then(async () => { if (!disposed) await request({ workbenchId: id, geometry }) }).catch(() => {
      runtime.patch(id, { error: '位置未能保存，当前浮窗仍可使用。下次移动结束后将重试。' })
    })
  })
  void request({}).then(saved => {
    if (disposed) return
    for (const [id, geometry] of Object.entries(saved)) if (!dirty.has(id) && validFloatingGeometry(geometry)) { values[id] = geometry; runtime.patch(id, geometry) }
  }).catch(() => {})
  return () => { disposed = true }
}
