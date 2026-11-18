import { afterEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { HostWorkbenchDirectory } from '../src/host-workbench-directory.ts'
import { installWorkbenchBundleRoute } from '../src/host-workbench-bundle-route.ts'
import type { WorkbenchRecordV2 } from '../src/foundation/persistence.ts'

const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })

function record(workbenchId: string): WorkbenchRecordV2 {
  return { workbenchId, name: 'Project Test', description: '', createdAt: 1, updatedAt: 1,
    document: { version: 3, activeAreaId: 'area', root: { kind: 'area', areaId: 'area', moduleHistory: [] } } }
}

function route(directory: HostWorkbenchDirectory) {
  const handlers = new Map<string, (request: Request) => Promise<Response>>()
  const connection = { fetch: { register(config: { path: string; fetch: (request: Request) => Promise<Response> }) { handlers.set(config.path, config.fetch); return () => { handlers.delete(config.path) } } } }
  const dispose = installWorkbenchBundleRoute(connection as never, { directory })
  return { handlers, dispose }
}

describe('dshbay bundles of workbenches with Area projects', () => {
  it.each(['template', 'complete'] as const)('imports a %s package whose Area is bound to a project folder', async kind => {
    const root = await mkdtemp(join(tmpdir(), 'dshbay-projects-')); roots.push(root)
    const workspaces = { async create(folder: string) { return { id: folder } } }
    const source = new HostWorkbenchDirectory(join(root, 'source-profile'), workspaces as never)
    await source.create({ requestId: 'create-source', parentPath: root, folderName: 'source', record: record('source'), open: false })
    const bound = await source.bindArea({ workbenchId: 'source', areaId: 'area', relativePath: 'aa', createDirectory: true, expectedRevision: source.getSnapshot().revision })
    expect(bound.status).toBe('committed')
    await writeFile(join(source.rootPath('source'), 'aa', 'notes.md'), 'project notes')
    const sourceRoute = route(source)
    try {
      const exported = await sourceRoute.handlers.get('/api/workbench/bundle/v1/export')!(new Request('http://localhost', { method: 'POST', body: JSON.stringify({ workbenchId: 'source', kind }) }))
      expect(exported.ok, await exported.clone().text()).toBe(true)
      const bytes = new Uint8Array(await exported.arrayBuffer())
      const recipient = new HostWorkbenchDirectory(join(root, 'recipient-profile'), workspaces as never)
      const recipientRoute = route(recipient)
      try {
        const response = await recipientRoute.handlers.get('/api/workbench/bundle/v1/import')!(new Request('http://localhost/api/workbench/bundle/v1/import?parentPath=' + encodeURIComponent(root) + '&folderName=recipient', { method: 'POST', body: bytes }))
        expect(response.ok, JSON.stringify(await response.clone().json())).toBe(true)
        const imported = await response.json() as { workbenchId: string }
        const snapshot = recipient.getSnapshot()
        expect(snapshot.value.workbenches[imported.workbenchId], JSON.stringify(snapshot.value.invalidWorkbenches)).toBeDefined()
        expect(snapshot.value.workbenches[imported.workbenchId]!.areaProjects?.area?.relativePath).toBe('aa')
        if (kind === 'complete') expect(await readFile(join(root, 'recipient', 'aa', 'notes.md'), 'utf8')).toBe('project notes')
      } finally { recipientRoute.dispose() }
    } finally { sourceRoute.dispose() }
  })

  it('never declares a streaming body for GET routes, which the HTTP bridge cannot build', async () => {
    // The bridge passes the socket as the body of every streaming route, and
    // undici refuses a GET Request with a body; the browser then sees an empty 500.
    const root = await mkdtemp(join(tmpdir(), 'dshbay-modes-')); roots.push(root)
    const configs: { path: string; methods: string[]; requestBody: string }[] = []
    const connection = { fetch: { register(config: { path: string; methods: string[]; requestBody: string }) { configs.push(config); return () => {} } } }
    installWorkbenchBundleRoute(connection as never, { directory: new HostWorkbenchDirectory(join(root, 'profile'), { async create(folder: string) { return { id: folder } } } as never) })
    const gets = configs.filter(config => config.methods.includes('GET'))
    expect(gets.map(config => config.path).sort()).toEqual(['/api/workbench/bundle/v1/export-check', '/api/workbench/bundle/v1/export-location', '/api/workbench/bundle/v1/job'])
    for (const config of gets) expect(config.requestBody, config.path).toBe('buffered')
    expect(() => new Request('http://localhost/', { method: 'GET', body: new ReadableStream(), duplex: 'half' } as RequestInit)).toThrow()
  })

  it('skips .git, node_modules, symlinks and private files instead of failing a complete export', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dshbay-excludes-')); roots.push(root)
    const workspaces = { async create(folder: string) { return { id: folder } } }
    const source = new HostWorkbenchDirectory(join(root, 'source-profile'), workspaces as never)
    await source.create({ requestId: 'create-source', parentPath: root, folderName: 'source', record: record('source'), open: false })
    const base = source.rootPath('source')
    await mkdir(join(base, 'app', 'node_modules', 'left-pad'), { recursive: true })
    await writeFile(join(base, 'app', 'node_modules', 'left-pad', 'index.js'), 'x')
    await mkdir(join(base, '.git'), { recursive: true }); await writeFile(join(base, '.git', 'HEAD'), 'ref')
    await mkdir(join(base, 'app', 'cache'), { recursive: true }); await writeFile(join(base, 'app', 'cache', 'blob'), 'x')
    await writeFile(join(base, 'app', 'main.ts'), 'export {}')
    let linked = true
    try { await symlink(join(base, 'app'), join(base, 'shortcut'), 'junction') } catch { linked = false }
    const installed = route(source)
    try {
      const exported = await installed.handlers.get('/api/workbench/bundle/v1/export')!(new Request('http://localhost', { method: 'POST', body: JSON.stringify({ workbenchId: 'source', kind: 'complete' }) }))
      expect(exported.ok, await exported.clone().text()).toBe(true)
      const notices = JSON.parse(decodeURIComponent(exported.headers.get('x-dshbay-export-notices') ?? '[]')) as { sessionKey: string; reason: string }[]
      expect(notices.find(notice => notice.sessionKey === '私密文件')?.reason).toContain('app/cache')
      if (linked) expect(notices.find(notice => notice.sessionKey === '符号链接')?.reason).toContain('shortcut')
      const text = new TextDecoder('latin1').decode(new Uint8Array(await exported.arrayBuffer()))
      expect(text).toContain('app/main.ts')
      expect(text).not.toContain('node_modules')
      expect(text).not.toContain('.git/HEAD')
    } finally { installed.dispose() }
  })

  it('blocks export up front when an inner-page extension cannot be distributed', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dshbay-blocked-')); roots.push(root)
    const workspaces = { async create(folder: string) { return { id: folder } } }
    const source = new HostWorkbenchDirectory(join(root, 'source-profile'), workspaces as never)
    await source.create({ requestId: 'create-source', parentPath: root, folderName: 'source', record: record('source'), open: false })
    const problem = { packageName: 'pet-page', moduleId: 'pet', version: '0.1.0', editorIds: ['pet.page'], reason: '扩展缺少有效的 17.2 分发声明' }
    let collected = false
    const extensions = () => ({ async exportProblems() { return [problem] }, async collect() { collected = true; return { locks: [], notices: [] } }, async check() { return [] }, async install() { return { restartRequired: false } } })
    const handlers = new Map<string, (request: Request) => Promise<Response>>()
    const connection = { fetch: { register(config: { path: string; fetch: (request: Request) => Promise<Response> }) { handlers.set(config.path, config.fetch); return () => {} } } }
    installWorkbenchBundleRoute(connection as never, { directory: source, extensions: extensions as never })
    const checked = await handlers.get('/api/workbench/bundle/v1/export-check')!(new Request('http://localhost/api/workbench/bundle/v1/export-check?workbenchId=source'))
    expect(await checked.json()).toEqual({ problems: [problem] })
    const outbox = join(root, 'outbox'); await mkdir(outbox)
    const started = await handlers.get('/api/workbench/bundle/v1/export-job')!(new Request('http://localhost', { method: 'POST', body: JSON.stringify({ workbenchId: 'source', kind: 'template', directory: outbox }) }))
    expect(started.status).toBe(409)
    expect(await started.json()).toMatchObject({ problems: [problem] })
    expect(collected).toBe(false)
  })

  it('runs export and import as progress jobs, writes to the chosen folder and never overwrites', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dshbay-jobs-')); roots.push(root)
    const workspaces = { async create(folder: string) { return { id: folder } } }
    const source = new HostWorkbenchDirectory(join(root, 'source-profile'), workspaces as never)
    await source.create({ requestId: 'create-source', parentPath: root, folderName: 'source', record: record('source'), open: false })
    const outbox = join(root, 'outbox'); await mkdir(outbox)
    const installed = route(source)
    const call = (name: string, init?: RequestInit, query = '') => installed.handlers.get('/api/workbench/bundle/v1/' + name)!(new Request('http://localhost/api/workbench/bundle/v1/' + name + query, init))
    const settle = async (jobId: string) => {
      for (let i = 0; i < 200; i += 1) {
        const job = await (await call('job', undefined, '?jobId=' + encodeURIComponent(jobId))).json() as { state: string; progress: { stage: string }; result?: { path: string; filename: string; bytes: number }; error?: string }
        if (job.state !== 'running') return job
        await new Promise(resolve => setTimeout(resolve, 10))
      }
      throw new Error('job did not settle')
    }
    try {
      const exportJob = async () => {
        const started = await call('export-job', { method: 'POST', body: JSON.stringify({ workbenchId: 'source', kind: 'template', directory: outbox }) })
        expect(started.ok, await started.clone().text()).toBe(true)
        return settle((await started.json() as { jobId: string }).jobId)
      }
      const first = await exportJob()
      expect(first.state, first.error).toBe('done')
      expect(first.progress.stage).toBe('write')
      expect(first.result!.path).toBe(join(outbox, 'Project-Test.dshbay.zip'))
      expect((await stat(first.result!.path)).size).toBe(first.result!.bytes)
      const second = await exportJob()
      expect(second.result!.filename).toBe('Project-Test (2).dshbay.zip')

      const missing = await call('export-job', { method: 'POST', body: JSON.stringify({ workbenchId: 'source', kind: 'template', directory: join(root, 'nowhere') }) })
      expect(missing.ok).toBe(false)
      const foreign = await call('reveal', { method: 'POST', body: JSON.stringify({ jobId: 'not-a-job' }) })
      expect(foreign.ok).toBe(false)

      const imported = await call('import-job', { method: 'POST', body: await readFile(first.result!.path) }, '?parentPath=' + encodeURIComponent(root) + '&folderName=copy')
      expect(imported.ok, await imported.clone().text()).toBe(true)
      const done = await settle((await imported.json() as { jobId: string }).jobId) as unknown as { state: string; error?: string; result: { workbenchId: string } }
      expect(done.state, done.error).toBe('done')
      expect(source.getSnapshot().value.workbenches[done.result.workbenchId]).toBeDefined()

      const clash = await call('import-job', { method: 'POST', body: await readFile(first.result!.path) }, '?parentPath=' + encodeURIComponent(root) + '&folderName=copy')
      const failed = await settle((await clash.json() as { jobId: string }).jobId)
      expect(failed.state).toBe('failed')
      expect(failed.error).toMatch('已存在')
    } finally { installed.dispose() }
  })
})
