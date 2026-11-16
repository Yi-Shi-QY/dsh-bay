import { createHash, timingSafeEqual } from 'node:crypto'
import { readWorkbenchArtifactFiles } from './host-artifact-files.ts'
import { compareWorkbenchVersions, validateWorkbenchModuleSourceRequest, workbenchVersionSatisfies, type WorkbenchModuleSourceRequestV1 } from './module-source.ts'
import type { WorkbenchDirectSourceResolvedArtifactV1, WorkbenchDirectSourceResolverV1 } from './host-direct-source-service.ts'

const object = (value: unknown): Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('package-manifest-invalid')
  return value as Record<string, unknown>
}
const strings = (value: unknown): string[] => {
  if (!Array.isArray(value) || value.length > 128 || value.some(item => typeof item !== 'string' || !/^[a-zA-Z0-9._:-]{1,160}$/u.test(item)) || new Set(value).size !== value.length) throw new Error('package-manifest-invalid')
  return value as string[]
}
export interface WorkbenchHostSourceResolverOptionsV1 {
  readonly fetch?: typeof fetch
  /** Manager-owned Git transport returns only committed bytes; never executes package scripts. */
  readonly gitArchive?: (source: Extract<WorkbenchModuleSourceRequestV1, { kind: 'git' }>) => Promise<{ tarball: Uint8Array; commit: string }>
}

/** Parses the real tarball. Caller-provided descriptor metadata cannot replace package.json. */
export async function inspectWorkbenchDirectTarball(bytes: Uint8Array): Promise<Omit<WorkbenchDirectSourceResolvedArtifactV1, 'resolvedVersion' | 'registry' | 'repository' | 'subpath' | 'resolvedCommit'>> {
  let pkg: Record<string, unknown>
  try { const files = await readWorkbenchArtifactFiles(bytes); pkg = object(JSON.parse(files.get('package.json')!.toString('utf8'))) } catch { throw new Error('package-manifest-invalid') }
  let declared: Record<string, unknown>, provenance: Record<string, unknown>
  try { declared = object(object(pkg.dsh).workbench); provenance = object(declared.provenance) } catch { throw new Error('package-manifest-invalid') }
  if (declared.schemaVersion !== 1 || declared.activation !== 'restart-only' || typeof pkg.name !== 'string' || typeof pkg.version !== 'string'
    || typeof declared.moduleId !== 'string' || typeof declared.coreCompatibility !== 'string' || typeof declared.dshGeneration !== 'string'
    || !['area', 'root', 'session'].includes(String(declared.scope))
    || typeof provenance.upstreamCommit !== 'string' || typeof provenance.sourceDigest !== 'string' || typeof provenance.patchDigest !== 'string') throw new Error('package-manifest-invalid')
  for (const key of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
    if (pkg[key] !== undefined && Object.values(object(pkg[key])).some(spec => typeof spec !== 'string' || /^(workspace:|file:|link:)/u.test(spec))) throw new Error('package-manifest-invalid')
  }
  const editorIds = strings(declared.editorIds)
  if (!editorIds.length || editorIds.some(id => !id.startsWith('workbench.'))) throw new Error('package-manifest-invalid')
  return {
    packageName: pkg.name, artifactBytes: new Uint8Array(bytes), dshGeneration: declared.dshGeneration,
    integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}`,
    permissions: strings(declared.permissions),
    provenance: { upstreamCommit: provenance.upstreamCommit, sourceDigest: provenance.sourceDigest, patchDigest: provenance.patchDigest },
    manifest: {
      moduleId: declared.moduleId, version: pkg.version, coreCompatibility: declared.coreCompatibility,
      provides: { editorIds, surfaces: [] }, requires: { capabilities: strings(declared.requiredCapabilities), modules: [] },
      activation: { mode: 'workbench', scope: declared.scope as 'area' | 'root' | 'session' },
    },
  }
}

export function createWorkbenchHostSourceResolver(options: WorkbenchHostSourceResolverOptionsV1 = {}): WorkbenchDirectSourceResolverV1 {
  const fetcher = options.fetch ?? fetch
  const download = async (url: string, maximum: number): Promise<Uint8Array> => {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.hash) throw new Error('source-not-allowed')
    const response = await fetcher(parsed.href, { redirect: 'error', credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(30_000) })
    if (!response.ok || Number(response.headers.get('content-length')) > maximum || !response.body) throw new Error('source-resolution-failed')
    const reader = response.body.getReader(), chunks: Uint8Array[] = []; let total = 0
    try {
      while (true) { const chunk = await reader.read(); if (chunk.done) break; total += chunk.value.byteLength; if (total > maximum) throw new Error('source-resolution-failed'); chunks.push(chunk.value) }
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
    return new Uint8Array(Buffer.concat(chunks, total))
  }
  return { async resolve(request) {
    if (!validateWorkbenchModuleSourceRequest(request)) throw new Error('source-not-allowed')
    if (request.kind === 'git') {
      if (!options.gitArchive) throw new Error('source-not-allowed')
      const packed = await options.gitArchive(request)
      if (!/^[a-f0-9]{40}$/iu.test(packed.commit) || packed.tarball.byteLength > 64 * 1024 * 1024) throw new Error('source-resolution-failed')
      return { ...await inspectWorkbenchDirectTarball(packed.tarball), repository: request.repository, resolvedCommit: packed.commit.toLowerCase(), ...(request.subpath === undefined ? {} : { subpath: request.subpath }) }
    }
    const registry = new URL(request.registry ?? 'https://registry.npmjs.org/').href
    const metadata = object(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await download(`${registry.replace(/\/$/u, '')}/${encodeURIComponent(request.packageName)}`, 16 * 1024 * 1024))))
    if (metadata.name !== request.packageName) throw new Error('source-resolution-failed')
    const versions = object(metadata.versions), tags = object(metadata['dist-tags']), selector = request.requestedRange ?? 'latest'
    const version = typeof tags[selector] === 'string' ? tags[selector] as string : Object.keys(versions).filter(version => workbenchVersionSatisfies(version, selector)).sort((a, b) => compareWorkbenchVersions(b, a))[0]
    if (!version) throw new Error('source-resolution-failed')
    const resolved = object(versions[version]), dist = object(resolved.dist)
    if (resolved.name !== request.packageName || resolved.version !== version || typeof dist.tarball !== 'string' || typeof dist.integrity !== 'string') throw new Error('source-resolution-failed')
    const integrity = /^(sha256|sha384|sha512)-([A-Za-z0-9+/]+={0,2})$/u.exec(dist.integrity)
    if (!integrity) throw new Error('artifact-integrity-mismatch')
    const bytes = await download(dist.tarball, 64 * 1024 * 1024)
    const actual = createHash(integrity[1]!).update(bytes).digest(), expected = Buffer.from(integrity[2]!, 'base64')
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error('artifact-integrity-mismatch')
    const descriptor = await inspectWorkbenchDirectTarball(bytes)
    if (descriptor.packageName !== request.packageName || descriptor.manifest.version !== version) throw new Error('package-manifest-invalid')
    return { ...descriptor, registry, resolvedVersion: version }
  } }
}
