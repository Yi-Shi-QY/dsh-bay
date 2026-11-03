export type WorkbenchShareGuestStateV1 = 'active' | 'stopped' | 'kicked' | 'host-unavailable'

export function isWorkbenchShareGuestPage(): boolean {
  return typeof window !== 'undefined'
    && (window as Window & { __WORKBENCH_SHARE_GUEST__?: unknown }).__WORKBENCH_SHARE_GUEST__ === true
}

export function startWorkbenchShareLifecycleMonitor(
  onState: (state: Exclude<WorkbenchShareGuestStateV1, 'active'>) => void,
  intervalMs = 1_000,
): () => void {
  if (!isWorkbenchShareGuestPage() || typeof window === 'undefined' || typeof fetch !== 'function') return () => {}
  let stopped = false
  let pending = false
  let hostFailures = 0
  const poll = async () => {
    if (stopped || pending) return
    pending = true
    try {
      const response = await fetch('/api/workbench-share/lifecycle', {
        method: 'GET', cache: 'no-store', credentials: 'same-origin',
        headers: { accept: 'application/json' },
      })
      if (response.status === 410 && (response.headers.get('x-dsh-share-state') === 'stopped' || response.headers.get('x-dsh-share-state') === 'kicked')) {
        stopped = true
        onState(response.headers.get('x-dsh-share-state') === 'kicked' ? 'kicked' : 'stopped')
      } else if (response.ok) {
        hostFailures = 0
      } else if (response.status >= 500) {
        hostFailures += 1
      }
    } catch {
      hostFailures += 1
    } finally {
      pending = false
      if (!stopped && hostFailures >= 3) {
        hostFailures = 0
        onState('host-unavailable')
      }
    }
  }
  void poll()
  const timer = window.setInterval(() => { void poll() }, intervalMs)
  return () => {
    stopped = true
    window.clearInterval(timer)
  }
}

export async function updateWorkbenchShareGuestNickname(nickname: string): Promise<boolean> {
  if (!isWorkbenchShareGuestPage() || typeof fetch !== 'function') return false
  const response = await fetch('/api/workbench-share/guest-profile', {
    method: 'POST', credentials: 'same-origin', cache: 'no-store',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ nickname }),
  })
  return response.ok
}

export async function readWorkbenchShareGuestNickname(): Promise<string | undefined> {
  if (!isWorkbenchShareGuestPage() || typeof fetch !== 'function') return undefined
  try {
    const response = await fetch('/api/workbench-share/guest-profile', { method: 'GET', credentials: 'same-origin', cache: 'no-store', headers: { accept: 'application/json' } })
    if (!response.ok) return undefined
    const payload = await response.json() as { nickname?: unknown }
    return typeof payload.nickname === 'string' ? payload.nickname : undefined
  } catch { return undefined }
}

export function startWorkbenchShareGuestHeartbeat(intervalMs = 5_000): () => void {
  if (!isWorkbenchShareGuestPage() || typeof window === 'undefined' || typeof fetch !== 'function') return () => {}
  let stopped = false
  let pending = false
  const beat = async () => {
    if (stopped || pending) return
    pending = true
    const started = typeof performance === 'undefined' ? Date.now() : performance.now()
    try {
      const response = await fetch('/api/workbench-share/heartbeat', {
        method: 'POST', credentials: 'same-origin', cache: 'no-store',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ rttMs: Math.max(0, (typeof performance === 'undefined' ? Date.now() : performance.now()) - started) }),
      })
      if (response.status === 410 && response.headers.get('x-dsh-share-state') === 'kicked') {
        window.dispatchEvent(new CustomEvent('workbench-share-ended', { detail: { state: 'kicked' } }))
      }
    } catch { /* lifecycle monitor owns the user-facing unavailable state */ }
    finally { pending = false }
  }
  void beat()
  const timer = window.setInterval(() => { void beat() }, intervalMs)
  return () => { stopped = true; window.clearInterval(timer) }
}
