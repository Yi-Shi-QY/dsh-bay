import { describe, expect, it } from 'vitest'
import { canonicalJson } from '../src/foundation/workbench-sharing.ts'
import { createWorkbenchSnapshot, snapshotDigest } from '../src/workbench-snapshot.ts'
import { WebDavWorkbenchSyncProvider, type WebDavFetchLike, type WebDavResponseLike } from '../src/workbench-sync-provider.ts'

type Stored = { content: Uint8Array; etag?: string }

function response(status: number, content: Uint8Array = new Uint8Array(), etag?: string): WebDavResponseLike {
  return {
    ok: status >= 200 && status < 300,
    status,
    arrayBuffer: async () => content.slice().buffer,
    text: async () => new TextDecoder().decode(content),
    headers: { get: name => name.toLowerCase() === 'content-length' ? String(content.byteLength) : name.toLowerCase() === 'etag' ? etag ?? null : null },
  }
}

function makeDav() {
  const files = new Map<string, Stored>()
  const calls: { url: string; method: string; headers: Record<string, string> }[] = []
  let nextEtag = 1
  let failNextStagingPut = false
  let mutateBeforeHeadPut = false
  const fetcher: WebDavFetchLike = async (url, init = {}) => {
    const method = init.method ?? 'GET'
    const headers = Object.fromEntries(Object.entries(init.headers ?? {}).map(([key, value]) => [key.toLowerCase(), value]))
    calls.push({ url, method, headers })
    const key = new URL(url).pathname
    const body = typeof init.body === 'string' ? new TextEncoder().encode(init.body) : new Uint8Array(init.body ?? [])
    if (method === 'HEAD' || method === 'GET') {
      const item = files.get(key)
      if (!item) return response(404)
      return response(200, item.content, item.etag)
    }
    if (method === 'DELETE') { files.delete(key); return response(204) }
    if (method === 'PUT') {
      if (key.includes('/staging/') && failNextStagingPut) { failNextStagingPut = false; return response(503) }
      const current = files.get(key)
      if (headers['if-none-match'] === '*' && current) return response(412)
      if (key.includes('/refs/') && key.endsWith('/head') && mutateBeforeHeadPut) {
        mutateBeforeHeadPut = false
        files.set(key, { content: new TextEncoder().encode('sha256:' + 'f'.repeat(64) + '\n'), etag: 'external' })
      }
      const latest = files.get(key)
      if (headers['if-match'] !== undefined && (!latest || headers['if-match'] !== latest.etag)) return response(412)
      const range = headers['content-range']?.match(/^bytes (\d+)-(\d+)\/(\d+)$/u)
      let content = body
      if (range && current) {
        const offset = Number(range[1])
        if (offset !== current.content.byteLength) return response(416)
        content = new Uint8Array(current.content.byteLength + body.byteLength)
        content.set(current.content); content.set(body, current.content.byteLength)
      }
      const etag = key.includes('/refs/') && key.endsWith('/head') ? `etag-${nextEtag++}` : current?.etag
      files.set(key, { content, ...(etag === undefined ? {} : { etag }) })
      return response(201, new Uint8Array(), etag)
    }
    if (method === 'MOVE') {
      const current = files.get(key)
      if (!current) return response(404)
      const target = new URL(headers.destination!).pathname
      if (files.has(target)) return response(412)
      files.set(target, current); files.delete(key); return response(201)
    }
    return response(405)
  }
  return { files, calls, fetcher, failNextStagingPut: () => { failNextStagingPut = true }, mutateBeforeHeadPut: () => { mutateBeforeHeadPut = true } }
}

const bytes = (value: string) => new TextEncoder().encode(value)

describe('WebDAV workbench sync provider', () => {
  it('writes through staging, retries transient failures, and resumes partial uploads', async () => {
    const dav = makeDav()
    const provider = new WebDavWorkbenchSyncProvider('https://dav.example/workbench', 'example', dav.fetcher)
    const content = bytes('resumable object')
    const digest = await snapshotDigest(content)
    const staging = `/workbench/staging/objects/${digest.replace(/^sha256:/u, '')}`
    dav.files.set(staging, { content: content.slice(0, 5) })
    dav.failNextStagingPut()
    await provider.putObjects((async function* () { yield { digest, content } })())
    const target = `/workbench/objects/sha256/${digest.replace(/^sha256:/u, '')}`
    expect(new TextDecoder().decode(dav.files.get(target)?.content)).toBe('resumable object')
    expect(dav.calls.some(call => call.method === 'MOVE')).toBe(true)
    expect(dav.calls.some(call => call.headers['content-range']?.startsWith('bytes 5-'))).toBe(true)
  })

  it('keeps a concurrent WebDAV head update as a conflict', async () => {
    const dav = makeDav()
    const provider = new WebDavWorkbenchSyncProvider('https://dav.example/workbench', 'example', dav.fetcher)
    const first = await createWorkbenchSnapshot({ kind: 'complete', workbenchId: 'example', entries: [{ path: 'layout.json', kind: 'layout', content: bytes('{}') }] })
    const firstManifest = new TextEncoder().encode(canonicalJson(first.snapshot))
    expect((await provider.commitHead({ manifest: firstManifest })).status).toBe('committed')
    const second = await createWorkbenchSnapshot({ kind: 'complete', workbenchId: 'example', parentSnapshotId: first.snapshot.snapshotId, entries: [{ path: 'layout.json', kind: 'layout', content: bytes('{"changed":true}') }] })
    dav.mutateBeforeHeadPut()
    const result = await provider.commitHead({ expectedParent: first.snapshot.snapshotId, manifest: new TextEncoder().encode(canonicalJson(second.snapshot)) })
    expect(result.status).toBe('conflict')
    expect(result.currentHead).toBe('sha256:' + 'f'.repeat(64))
  })
})
