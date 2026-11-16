import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID, createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { mkdir, readFile, rename, rm } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { createRequire } from 'node:module'
import { createServer, type Socket } from 'node:net'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

export const WORKBENCH_WINDOW_ROUTE = '/api/workbench/windows'
interface WindowIdentity { windowId: string; workbenchId: string; focused: boolean }
export interface CompanionHandle {
  command(action: 'focus' | 'close'): Promise<boolean>
  dispose(): void
}
interface WindowRecord extends WindowIdentity { handle?: CompanionHandle; ready: boolean; unregister: () => void }
interface WindowDependencies {
  supported: boolean
  lookup(id: string): { name: string } | undefined
  register(identity: WindowIdentity): () => void
  launch(identity: WindowIdentity, title: string, event: (type: 'exit' | 'focus' | 'blur') => void): Promise<CompanionHandle>
}

/** One Host directory; no layout, Session, Profile or renderer ownership. */
export function createHostWindowController(deps: WindowDependencies) {
  const windows = new Map<string, WindowRecord>()
  const openings = new Map<string, Promise<unknown>>()
  let disposed = false
  const remove = (row: WindowRecord) => {
    if (!windows.delete(row.windowId)) return
    row.unregister(); row.handle?.dispose()
  }
  const snapshot = () => ({ supported: deps.supported && !disposed, windows: [...windows.values()]
    .filter(row => row.ready).map(({ windowId, workbenchId, focused }) => ({ windowId, workbenchId, focused })) })
  const open = (workbenchId: unknown): Promise<unknown> => {
    if (disposed || !deps.supported) return Promise.resolve({ status: 'unsupported', code: 'companion-runtime-unavailable' })
    if (typeof workbenchId !== 'string' || !/^[a-zA-Z0-9_-]{1,160}$/.test(workbenchId) || !deps.lookup(workbenchId)) {
      return Promise.resolve({ status: 'failed', code: 'workbench-unavailable' })
    }
    const pending = openings.get(workbenchId)
    if (pending) return pending
    const operation = (async () => {
      const existing = [...windows.values()].find(row => row.workbenchId === workbenchId && row.ready)
      if (existing) return await existing.handle?.command('focus')
        ? { status: 'opened', windowId: existing.windowId } : { status: 'failed', code: 'window-focus-failed' }
      if (windows.size >= 8) return { status: 'failed', code: 'window-limit-reached' }
      const row: WindowRecord = { windowId: randomUUID(), workbenchId, focused: false, ready: false, unregister: () => {} }
      windows.set(row.windowId, row)
      try {
        row.unregister = deps.register(row)
        const handle = await deps.launch(row, deps.lookup(workbenchId)!.name, event => {
          if (event === 'exit') remove(row)
          else row.focused = event === 'focus'
        })
        if (disposed || !windows.has(row.windowId) || !deps.lookup(workbenchId)) {
          handle.dispose(); remove(row)
          return { status: 'failed', code: 'window-open-cancelled' }
        }
        row.handle = handle; row.ready = true
        return { status: 'opened', windowId: row.windowId }
      } catch (error) {
        remove(row)
        const code = error instanceof Error && /^companion-[a-z-]+-failed$/.test(error.message) ? error.message : 'companion-startup-failed'
        return { status: 'failed', code }
      }
    })().finally(() => { openings.delete(workbenchId) })
    openings.set(workbenchId, operation)
    return operation
  }
  return {
    snapshot, open,
    has: (windowId: string) => windows.has(windowId),
    async action(windowId: unknown, action: 'focus' | 'close') {
      const row = typeof windowId === 'string' ? windows.get(windowId) : undefined
      if (!row?.ready) return { status: 'failed', code: 'window-not-found' }
      if (!await row.handle?.command(action)) return { status: 'failed', code: `window-${action}-failed` }
      if (action === 'close') remove(row)
      return { status: action === 'focus' ? 'focused' : 'closed' }
    },
    dispose() { disposed = true; for (const row of [...windows.values()]) remove(row) },
  }
}

interface WindowHostContext {
  get<T = unknown>(name: string, strict?: boolean): T | undefined
  effect?(handler: () => (() => void) | void, key?: string): unknown
}
interface WindowConnection {
  authenticatedUrl(origin: string): string
  authorizeIndex(request: { method: string; headers: IncomingMessage['headers']; url: string }, response: ServerResponse): boolean
  fetch: { register(route: { path: string; methods: readonly ['GET', 'POST']; requestBody: 'buffered'; fetch(request: Request): Promise<Response> }): () => Promise<void> }
}
interface WindowWebServer {
  getOrigin(): string
  renderIndex(html: string): string
  register(route: { kind: 'exact'; path: string; handler(request: IncomingMessage, response: ServerResponse): Promise<void> }): () => void
}

/** Runtime is shipped in Core; extraction never executes an install script or downloads code. */
export async function prepareCompanionRuntime(packageDirectory: string, dataDirectory: string): Promise<string> {
  const manifest = JSON.parse(await readFile(join(packageDirectory, 'runtime.json'), 'utf8')) as {
    version: string; sha256: string; externalRoot?: string; archive?: string
  }
  if (!/^\d+\.\d+\.\d+$/.test(manifest.version) || !/^[a-f0-9]{64}$/.test(manifest.sha256)) throw new Error('Invalid runtime identity')
  const external = join(process.env.LOCALAPPDATA ?? process.env.APPDATA ?? dataDirectory, manifest.externalRoot ?? 'DSH Workbench/companion-runtime', 'electron.exe')
  if (existsSync(external) && createHash('sha256').update(await readFile(external)).digest('hex') === manifest.sha256) return external
  if (manifest.archive === undefined) throw new Error('Companion runtime is not installed')
  const archive = join(packageDirectory, manifest.archive)
  if (createHash('sha256').update(await readFile(archive)).digest('hex') !== manifest.sha256) throw new Error('Companion runtime digest mismatch')
  const destination = join(dataDirectory, `electron-${manifest.version}-${manifest.sha256.slice(0, 16)}`)
  const executable = join(destination, 'electron.exe')
  if (existsSync(executable)) return executable
  await mkdir(dataDirectory, { recursive: true })
  const staging = join(dataDirectory, `extract-${randomUUID()}`)
  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File',
        join(packageDirectory, 'expand-runtime.ps1'), '-Archive', archive, '-Destination', staging], { windowsHide: true, stdio: 'ignore' })
      child.once('error', reject)
      child.once('exit', code => code === 0 ? resolve() : reject(new Error('Runtime extraction failed')))
    })
    await rename(staging, destination).catch(error => { if (!existsSync(executable)) throw error })
    return executable
  } finally { await rm(staging, { recursive: true, force: true }) }
}

async function launchCompanion(executable: string, packageDirectory: string, config: object,
  dataDirectory: string, event: (type: 'exit' | 'focus' | 'blur') => void): Promise<CompanionHandle> {
  const pipeName = `\\\\.\\pipe\\workbench-${randomUUID()}`
  const server = createServer()
  let child: ChildProcess | undefined
  let socket: Socket | undefined
  let stopped = false
  const requests = new Map<string, (ok: boolean) => void>()
  const dispose = () => {
    if (stopped) return
    stopped = true
    server.close(); socket?.end()
    for (const finish of requests.values()) finish(false)
    requests.clear()
    // The companion normally exits on pipe EOF. Bound cleanup also covers a hung renderer.
    const timer = setTimeout(() => { if (child?.exitCode === null) child.kill() }, 3000)
    timer.unref()
  }
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(pipeName, resolve) })
  return new Promise<CompanionHandle>((resolve, reject) => {
    const fail = (code?: unknown) => { clearTimeout(deadline); dispose(); reject(new Error(typeof code === 'string' && /^companion-[a-z-]+-failed$/.test(code) ? code : 'companion-startup-failed')) }
    const deadline = setTimeout(fail, 45000)
    server.once('connection', peer => {
      server.close(); socket = peer; peer.setEncoding('utf8')
      let partial = ''
      peer.on('data', (chunk: string) => {
        partial += chunk
        if (partial.length > 16384) { fail(); return }
        const lines = partial.split('\n'); partial = lines.pop() ?? ''
        for (const line of lines) {
          try {
            const message = JSON.parse(line) as { type: string; requestId?: string; ok?: boolean; code?: string }
            if (message.type === 'ready') {
              clearTimeout(deadline)
              resolve({ dispose, command: action => new Promise<boolean>(done => {
                if (stopped || !socket?.writable) { done(false); return }
                const requestId = randomUUID()
                const timeout = setTimeout(() => finish(false), 5000)
                const finish = (ok: boolean) => { clearTimeout(timeout); requests.delete(requestId); done(ok) }
                requests.set(requestId, finish)
                socket.write(JSON.stringify({ action, requestId }) + '\n')
              }) })
            } else if (message.type === 'ack' && message.requestId) requests.get(message.requestId)?.(message.ok === true)
            else if (message.type === 'focus' || message.type === 'blur') event(message.type)
            else if (message.type === 'failed') fail(message.code)
          } catch { fail() }
        }
      })
      peer.on('error', fail)
      peer.on('close', () => { event('exit'); dispose() })
      // Credentials travel over the private local pipe, never in argv, files, layout or logs.
      peer.write(JSON.stringify({ action: 'boot', ...config, dataDirectory }) + '\n')
    })
    const environment: NodeJS.ProcessEnv = {
      WORKBENCH_BOOT_PIPE: pipeName,
      SystemRoot: process.env.SystemRoot,
      WINDIR: process.env.WINDIR,
      PATH: process.env.PATH,
      APPDATA: process.env.APPDATA,
      LOCALAPPDATA: process.env.LOCALAPPDATA,
      USERPROFILE: process.env.USERPROFILE,
      TEMP: process.env.TEMP,
      TMP: process.env.TMP,
      OS: process.env.OS,
      PROCESSOR_ARCHITECTURE: process.env.PROCESSOR_ARCHITECTURE,
      WORKBENCH_WINDOW_DEBUG_PORT: process.env.WORKBENCH_WINDOW_DEBUG_PORT,
    }
    child = spawn(executable, [join(packageDirectory, 'main.cjs')], { windowsHide: true, stdio: 'ignore', env: environment })
    child.once('error', fail)
    child.once('exit', () => { clearTimeout(deadline); event('exit'); dispose(); reject(new Error('Companion exited')) })
  })
}

export function installWorkbenchWindowRoutes(ctx: WindowHostContext): (() => void) | undefined {
  const connection = ctx.get<WindowConnection>('connection', false)
  const server = ctx.get<WindowWebServer>('webServer', false)
  const settings = ctx.get<{ describe(): { ns: string; value?: { workbenches?: Record<string, { name: string; archivedAt?: number }> } }[] }>('settings', false)
  if (!connection || !server || !settings) return undefined
  const packageDirectory = fileURLToPath(new URL('../desktop-window/', import.meta.url))
  const dataDirectory = join(process.env.LOCALAPPDATA ?? process.env.APPDATA ?? dirname(packageDirectory), 'DSH Workbench', 'windows')
  const runtimeIdentity = JSON.parse(readFileSync(join(packageDirectory, 'runtime.json'), 'utf8')) as { externalRoot: string; sha256: string }
  const installedExecutable = join(process.env.LOCALAPPDATA ?? process.env.APPDATA ?? dirname(packageDirectory), runtimeIdentity.externalRoot, 'electron.exe')
  const companionReady = existsSync(installedExecutable)
    && createHash('sha256').update(readFileSync(installedExecutable)).digest('hex') === runtimeIdentity.sha256
  const require = createRequire(import.meta.url)
  const frontend = join(dirname(require.resolve('@deepseek-ai/dsh-web-frontend/package.json')), 'dist/index.html')
  let preparation: Promise<string> | undefined
  const controller = createHostWindowController({
    supported: process.platform === 'win32' && process.arch === 'x64' && companionReady,
    lookup(id) {
      const record = settings.describe().find(row => row.ns === 'workbench-layout')?.value?.workbenches?.[id]
      return record?.archivedAt === undefined ? record : undefined
    },
    register(identity) {
      return server.register({ kind: 'exact', path: `/_workbench/window/${identity.windowId}/`, async handler(request, response) {
        if (request.method !== 'GET' || !controller.has(identity.windowId)) { response.writeHead(410); response.end(); return }
        const url = new URL(request.url ?? '/', server.getOrigin())
        if ([...url.searchParams.keys()].some(key => key !== 'token') || url.searchParams.getAll('token').length > 1) {
          response.writeHead(400); response.end(); return
        }
        // Desktop Hosts need not mount a public root index. This exact, live-window
        // route delegates the configured-index token exchange to DSH; it never
        // mints, parses or bypasses the native cookie. The clean document still
        // requires DSH authentication on every load.
        if (!connection.authorizeIndex({ method: 'GET', headers: request.headers,
          url: url.search === '' ? url.pathname : '/' + url.search }, response)) return
        const view = { schemaVersion: 1, windowId: identity.windowId, workbenchId: identity.workbenchId }
        const html = server.renderIndex(await readFile(frontend, 'utf8')).replace(/<head(?:\s[^>]*)?>/i,
          head => `${head}<base href="/"><script>globalThis.__WORKBENCH_WINDOW_VIEW__=${JSON.stringify(view)};</script>`)
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' })
        response.end(html)
      } })
    },
    async launch(identity, title, event) {
      const origin = server.getOrigin()
      if (new URL(origin).hostname !== '127.0.0.1') throw new Error('Companion requires a loopback Host')
      const executable = await (preparation ??= prepareCompanionRuntime(packageDirectory, dataDirectory).catch(error => { preparation = undefined; throw error }))
      const target = new URL(`/_workbench/window/${identity.windowId}/`, origin)
      const authenticated = connection.authenticatedUrl(target.href)
      return launchCompanion(executable, packageDirectory, { authUrl: authenticated, url: target.href, windowId: identity.windowId,
        workbenchId: identity.workbenchId, title }, dataDirectory, event)
    },
  })
  const unregister = connection.fetch.register({ path: WORKBENCH_WINDOW_ROUTE, methods: ['GET', 'POST'], requestBody: 'buffered', async fetch(request) {
    const json = (value: unknown) => Response.json(value, { headers: { 'cache-control': 'no-store' } })
    if (request.method === 'GET') return json(controller.snapshot())
    let body: { action?: string; windowId?: unknown; workbenchId?: unknown }
    try { body = await request.json() as typeof body; if (typeof body !== 'object' || body === null) throw new Error() }
    catch { return json({ status: 'failed', code: 'invalid-request' }) }
    if (body.action === 'open') return json(await controller.open(body.workbenchId))
    if (body.action === 'focus' || body.action === 'close') return json(await controller.action(body.windowId, body.action))
    return json({ status: 'failed', code: 'invalid-action' })
  } })
  return () => { controller.dispose(); void unregister() }
}
