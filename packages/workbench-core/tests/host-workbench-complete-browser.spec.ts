import { afterEach, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { HostWorkbenchDirectory } from '../src/host-workbench-directory.ts'
import { HostWorkbenchAccess } from '../src/host-workbench-access.ts'
import { installWorkbenchCompleteRoute, type CompleteOptions } from '../src/host-workbench-complete.ts'
import { WORKBENCH_COMPLETE_ROUTE, WORKBENCH_COMPLETE_UPLOAD_ROUTE, WORKBENCH_COMPLETE_DOWNLOAD_ROUTE, type CompletePackageJobView, type CompletePackageUpload } from '../src/workbench-complete-contract.ts'
import { SHARED_CONTROL_GRANT, WORKBENCH_ACCESS_HEADER } from '../src/workbench-access-contract.ts'
import { backgroundAiPreferencesOf } from '../src/foundation/background-ai-preferences.ts'

const cleanups: (() => Promise<void>)[] = []
afterEach(async () => { for (const dispose of cleanups.splice(0).reverse()) await dispose() })
async function fixture(setBarrier?: CompleteOptions['setBarrier'], createSource = true) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'bay-browser-package-')))
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  const workspaces = { async create(folder: string) { return { id: folder } } }
  const directory = new HostWorkbenchDirectory(join(root, 'profile'), workspaces as never)
  if (createSource) {
    await directory.create({ requestId: 'create', parentPath: root, folderName: 'source', record: { workbenchId: 'wb', name: 'Workbench', description: '', createdAt: 1, updatedAt: 1, document: { version: 3, activeAreaId: 'area', root: { kind: 'area', areaId: 'area', moduleHistory: [] } } } })
    await writeFile(join(directory.rootPath('wb'), 'result.txt'), 'portable result')
  }
  const access = new HostWorkbenchAccess(directory)
  const token = createSource ? access.registerOwner('browser-1', 'wb', () => true) : null
  const routes = new Map<string, (request: Request) => Promise<Response>>()
  const connection = { fetch: { register(config: { path: string; fetch: (request: Request) => Promise<Response> }) { routes.set(config.path, config.fetch); return async () => { routes.delete(config.path) } } } }
  const options: CompleteOptions = { profile: join(root, 'profile'), directory, access, persistence: { async flush() {}, async list() { return [] } } as never, workspaces: workspaces as never, ...(setBarrier ? { setBarrier } : {}) }
  const install = () => { const dispose = installWorkbenchCompleteRoute(connection as never, options); cleanups.push(dispose); return dispose }
  const dispose = install()
  const call = async <T = unknown>(input: object, credential: string | null = token) => {
    const response = await routes.get(WORKBENCH_COMPLETE_ROUTE)!(new Request('http://localhost' + WORKBENCH_COMPLETE_ROUTE, { method: 'POST', headers: { 'content-type': 'application/json', ...(credential ? { [WORKBENCH_ACCESS_HEADER]: credential } : {}) }, body: JSON.stringify(input) }))
    return { status: response.status, ...await response.json() as { value: T; error?: string } }
  }
  const until = async (id: string, stage: CompletePackageJobView['stage']) => {
    let result!: CompletePackageJobView
    await vi.waitFor(async () => { result = (await call<CompletePackageJobView>({ action: 'status', id })).value; expect(result.stage, result.error).toBe(stage); expect(result.running).toBe(false) }, { timeout: 10_000, interval: 20 })
    return result
  }
  const sendChunk = async (id: string, offset: number, body: Uint8Array, requestId = 'chunk-' + offset, declaredLength = body.byteLength) => {
    const response = await routes.get(WORKBENCH_COMPLETE_UPLOAD_ROUTE)!(new Request('http://localhost' + WORKBENCH_COMPLETE_UPLOAD_ROUTE + '?id=' + id, { method: 'POST', headers: { ...(token ? { [WORKBENCH_ACCESS_HEADER]: token } : {}), 'x-bay-upload-offset': String(offset), 'x-bay-upload-length': String(declaredLength), 'x-bay-request-id': requestId }, body: body as BodyInit }))
    return { status: response.status, ...await response.json() as { value: CompletePackageUpload; error?: string } }
  }
  return { root, token, directory, access, routes, call, until, sendChunk, install, dispose }
}

it('starts one persistent export, uses a snapshot barrier, streams ranged download and invalidates its ticket on reclaim', async () => {
  const barrier = vi.fn()
  const f = await fixture(barrier)
  const first = await f.call<CompletePackageJobView>({ action: 'start-export', workbenchId: 'wb', requestId: 'export-once' })
  expect(first.status).toBe(200)
  expect(first.value.running).toBe(true)
  const again = await f.call<CompletePackageJobView>({ action: 'start-export', workbenchId: 'wb', requestId: 'export-once' })
  expect(again.value.id).toBe(first.value.id)
  const job = await f.until(first.value.id, 'complete')
  expect(job).not.toHaveProperty('path')
  expect(barrier.mock.calls).toEqual([['wb', true], ['wb', false]])
  const ticket = (await f.call<{ url: string }>({ action: 'download-ticket', id: job.id })).value.url
  const response = await f.routes.get(WORKBENCH_COMPLETE_DOWNLOAD_ROUTE)!(new Request('http://localhost' + ticket, { headers: { range: 'bytes=0-5' } }))
  expect(response.status).toBe(206)
  expect(response.headers.get('content-length')).toBe('6')
  expect(new Uint8Array(await response.arrayBuffer())).toHaveLength(6)
  f.access.revoke('browser-1')
  expect((await f.routes.get(WORKBENCH_COMPLETE_DOWNLOAD_ROUTE)!(new Request('http://localhost' + ticket))).status).toBe(401)
  expect((await f.call({ action: 'status', id: '../outside' }, null)).status).toBe(400)
})

it('persists upload offsets, validates duplicate chunks and resumes without appending a failed partial chunk', async () => {
  const f = await fixture()
  const upload = (await f.call<CompletePackageUpload>({ action: 'upload-begin', workbenchId: 'wb', requestId: 'upload-once', name: 'test.tar.gz', size: 8 })).value
  expect((await f.sendChunk(upload.id, 0, new Uint8Array([1, 2, 3, 4]))).value.received).toBe(4)
  expect((await f.sendChunk(upload.id, 0, new Uint8Array([1, 2, 3, 4]))).value.received).toBe(4)
  expect((await f.sendChunk(upload.id, 0, new Uint8Array([9, 2, 3, 4]))).status).toBe(409)
  expect((await f.sendChunk(upload.id, 4, new Uint8Array([5, 6]), 'partial', 4)).status).toBe(400)
  await f.dispose(); f.install()
  expect((await f.call<CompletePackageUpload>({ action: 'upload-status', id: upload.id })).value.received).toBe(4)
  expect((await f.sendChunk(upload.id, 4, new Uint8Array([5, 6, 7, 8]))).value.received).toBe(8)
  expect([...await readFile(join(f.root, 'profile', '.dsh-workbench', 'complete-v5', 'uploads', upload.id + '.tar.gz'))]).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
})

it('requires desktop directory selection and imports a browser upload as an inert new workbench', async () => {
  const f = await fixture()
  const backgroundAi = { ...backgroundAiPreferencesOf(), systemPrompt: 'Portable draft instructions', selection: { provider: 'draft', model: 'small' } }
  await f.directory.patch({ operation: 'set', path: ['workbenches', 'wb', 'backgroundAi'], value: backgroundAi, expectedRevision: f.directory.getSnapshot().revision })
  const exported = (await f.call<CompletePackageJobView>({ action: 'start-export', workbenchId: 'wb', requestId: 'source-export' })).value
  await f.until(exported.id, 'complete')
  const ticket = (await f.call<{ url: string }>({ action: 'download-ticket', id: exported.id })).value.url
  const archive = new Uint8Array(await (await f.routes.get(WORKBENCH_COMPLETE_DOWNLOAD_ROUTE)!(new Request('http://localhost' + ticket))).arrayBuffer())
  const upload = (await f.call<CompletePackageUpload>({ action: 'upload-begin', workbenchId: 'wb', requestId: 'browser-upload', name: 'source.tar.gz', size: archive.length })).value
  expect((await f.sendChunk(upload.id, 0, archive)).status).toBe(200)
  expect(await f.call({ action: 'upload-finish', id: upload.id })).toMatchObject({ status: 200, value: { valid: true, workbenchId: 'wb', overview: { name: 'Workbench', areaCount: 1, projectCount: 0, memoryCount: 0, taskCount: 0, fileCount: expect.any(Number), layout: { kind: 'area', moduleHistory: [] } } } })
  await f.call({ action: 'directory-request', uploadId: upload.id, requestId: 'pick-parent' })
  expect((await f.call({ action: 'directory-complete', id: 'pick-parent', parentPath: f.root })).status).toBe(403)
  expect(await f.call({ action: 'directory-complete', id: 'pick-parent', parentPath: f.root }, null)).toMatchObject({ status: 200, value: { state: 'selected', displayPath: f.root } })
  const request = { action: 'start-import', requestId: 'import-once', workbenchId: 'wb', uploadId: upload.id, directoryRequestId: 'pick-parent', folderName: 'received', name: '接收工作台' }
  expect(await f.call({ ...request, folderName: 'source' })).toMatchObject({ status: 409, error: expect.stringContaining('目标工作台文件夹已存在') })
  expect(await f.call({ action: 'directory-status', id: 'pick-parent' })).toMatchObject({ value: { state: 'selected' } })
  const imported = await f.call<CompletePackageJobView>(request)
  const completed = await f.until(imported.value.id, 'complete')
  expect((await f.call<CompletePackageJobView>(request)).value.id).toBe(completed.id)
  expect((await f.call({ ...request, requestId: 'different-import' })).status).toBe(409)
  expect(await readFile(join(f.root, 'received', 'result.txt'), 'utf8')).toBe('portable result')
  expect(f.directory.getSnapshot().value.workbenches[completed.workbenchId]?.executionPaused).toBe(true)
  expect(f.directory.getSnapshot().value.workbenches[completed.workbenchId]?.name).toBe('接收工作台')
  expect(f.directory.getSnapshot().value.workbenches[completed.workbenchId]?.backgroundAi).toEqual(backgroundAi)
  expect(completed.workbenchId).not.toBe('wb')
  expect(completed.report).toMatchObject({ data: 'complete', environment: 'needs-setup', tasks: 'waiting-for-user' })
  expect((await f.call<CompletePackageJobView[]>({ action: 'jobs', workbenchId: '', allImports: true }, null)).value.map(job => job.id)).toContain(completed.id)
  // A pre-existing failed job that never wrote destination data can return to
  // location selection without uploading again or leaving two runnable jobs.
  const failedId = 'legacy-failed-import'
  await writeFile(join(f.root, 'profile', '.dsh-workbench', 'complete-v5', failedId + '.json'), JSON.stringify({ version: 5, id: failedId, kind: 'import', requestId: 'failed-import', workbenchId: 'wb', accessWorkbenchId: 'wb', ownerAccessId: 'browser-1', uploadId: upload.id, path: join(f.root, 'profile', '.dsh-workbench', 'complete-v5', 'uploads', upload.id + '.tar.gz'), parentPath: f.root, folderName: 'source', stage: 'failed', files: 0, bytes: 0, updatedAt: 1, report: completed.report }))
  const corrected = await f.call<{ selection: { id: string; state: string }; upload: { id: string } }>({ action: 'reset-import-location', id: failedId })
  expect(corrected).toMatchObject({ status: 200, value: { selection: { state: 'selected' }, upload: { id: upload.id } } })
  expect((await f.call({ action: 'reset-import-location', id: failedId })).value).toEqual(corrected.value)
  expect((await f.call({ action: 'resume', id: failedId })).status).toBe(409)
  const guest = f.access.registerGuest('guest-1', 'wb', SHARED_CONTROL_GRANT, () => true)
  expect((await f.call({ action: 'jobs', workbenchId: 'wb' }, guest)).status).toBe(200)
  const guestExport = await f.call<CompletePackageJobView>({ action: 'start-export', workbenchId: 'wb', requestId: 'guest-export' }, guest)
  expect(guestExport.status).toBe(200)
  expect(guestExport.value.workbenchId).toBe('wb')
})

it('cancels and resumes a job with the same identity after a delayed snapshot boundary', async () => {
  let release!: () => void
  const ready = new Promise<void>(resolve => { release = resolve })
  let first = true
  const f = await fixture(async (_id, active) => { if (active && first) { first = false; await ready } })
  const job = (await f.call<CompletePackageJobView>({ action: 'start-export', workbenchId: 'wb', requestId: 'cancel-export' })).value
  await f.call({ action: 'cancel', id: job.id }); release()
  expect((await f.until(job.id, 'cancelled')).recoverable).toBe(true)
  expect((await f.call<CompletePackageJobView>({ action: 'resume', id: job.id })).value.id).toBe(job.id)
  await f.until(job.id, 'complete')
})

it('allows desktop to receive its first workbench without an existing source scope', async () => {
  const source = await fixture()
  const exported = (await source.call<CompletePackageJobView>({ action: 'start-export', workbenchId: 'wb', requestId: 'first-source-export' })).value
  await source.until(exported.id, 'complete')
  const ticket = (await source.call<{ url: string }>({ action: 'download-ticket', id: exported.id })).value.url
  const archive = new Uint8Array(await (await source.routes.get(WORKBENCH_COMPLETE_DOWNLOAD_ROUTE)!(new Request('http://localhost' + ticket))).arrayBuffer())
  const target = await fixture(undefined, false)
  expect(Object.keys(target.directory.getSnapshot().value.workbenches)).toEqual([])
  const upload = await target.call<CompletePackageUpload>({ action: 'upload-begin', workbenchId: '', requestId: 'first-upload', name: 'first.tar.gz', size: archive.length })
  expect(upload.status).toBe(200)
  expect((await target.sendChunk(upload.value.id, 0, archive)).status).toBe(200)
  expect((await target.call({ action: 'upload-finish', id: upload.value.id })).status).toBe(200)
  expect((await target.call({ action: 'directory-request', uploadId: upload.value.id, requestId: 'first-parent' })).status).toBe(200)
  expect((await target.call({ action: 'directory-complete', id: 'first-parent', parentPath: target.root })).status).toBe(200)
  const result = await target.call<CompletePackageJobView>({ action: 'start-import', workbenchId: '', uploadId: upload.value.id, directoryRequestId: 'first-parent', folderName: 'first-workbench', requestId: 'first-import' })
  expect(result.status).toBe(200)
  const job = await target.until(result.value.id, 'complete')
  expect(target.directory.getSnapshot().value.workbenches[job.workbenchId]?.executionPaused).toBe(true)
  expect(await readFile(join(target.root, 'first-workbench', 'result.txt'), 'utf8')).toBe('portable result')
  expect((await target.call<CompletePackageJobView[]>({ action: 'jobs', workbenchId: '' })).value.map(row => row.id)).toEqual([job.id])
  expect((await source.call({ action: 'upload-begin', workbenchId: '', requestId: 'unscoped-browser', name: 'first.tar.gz', size: 1 })).status).toBe(400)
})
