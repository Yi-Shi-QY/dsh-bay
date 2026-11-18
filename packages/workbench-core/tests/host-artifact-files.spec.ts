import { createHash } from 'node:crypto'
import { link, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { Header } from 'tar'
import { afterEach, describe, expect, it } from 'vitest'
import { readWorkbenchArtifactFiles, repairWorkbenchArtifactFiles, verifyWorkbenchArtifactFiles, verifyNativeResolvedArtifactFiles, describeInstalledArtifactDrift } from '../src/host-artifact-files.ts'

const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })

function archive(entries: { path: string; content?: string; type?: 'File' | 'SymbolicLink' }[]) {
  return gzipSync(Buffer.concat([...entries.flatMap(entry => {
    const bytes = Buffer.from(entry.content ?? '')
    const header = new Header({ path: entry.path, type: entry.type ?? 'File', size: bytes.length, mode: 0o644,
      ...(entry.type === 'SymbolicLink' ? { linkpath: '../../outside' } : {}) })
    const block = Buffer.alloc(512); header.encode(block)
    return [block, bytes, Buffer.alloc((512 - bytes.length % 512) % 512)]
  }), Buffer.alloc(1024)]))
}

async function fixture() {
  const profile = await mkdtemp(join(tmpdir(), 'workbench-file-verification-')); roots.push(profile)
  const packageRoot = join(profile, 'node_modules', '@dsh-workbench', 'conversation-suite')
  const declaration = { schemaVersion: 1, moduleId: 'workbench.conversation-suite', coreCompatibility: '*', editorIds: ['workbench.conversation'],
    scope: 'area', permissions: [], requiredCapabilities: [], provenance: { upstreamCommit: 'a'.repeat(40), sourceDigest: 'b'.repeat(64), patchDigest: 'c'.repeat(64) } }
  const manifest = { name: '@dsh-workbench/conversation-suite', version: '0.1.5-alpha.2', dsh: { workbench: declaration } }
  const bytes = archive([{ path: 'package/package.json', content: JSON.stringify(manifest) }, { path: 'package/lib/client.js', content: 'export const intact = true;\n' }])
  const files = await readWorkbenchArtifactFiles(bytes)
  for (const [path, content] of files) {
    const target = join(packageRoot, path)
    await mkdir(join(target, '..'), { recursive: true }); await writeFile(target, content)
  }
  const identity = { moduleId: 'workbench.conversation-suite' as const, packageName: '@dsh-workbench/conversation-suite' as const,
    version: manifest.version, artifactDigest: createHash('sha256').update(bytes).digest('hex'), integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}` }
  const verification = { ...identity, ...declaration, sourceLocator: 'local', catalogId: 'test', publisherKeyId: 'test', dshGeneration: '0.1.5-alpha.2' }
  return { profile, packageRoot, bytes, files, identity, verification }
}

describe('installed Module byte verification and exact repair', () => {
  it('rejects altered code even when package metadata is unchanged, then repairs without changing shared hardlinks', async () => {
    const f = await fixture(), target = join(f.packageRoot, 'lib/client.js'), outside = join(f.profile, 'shared-store-copy')
    await verifyWorkbenchArtifactFiles(f.profile, f.packageRoot, f.files)
    await writeFile(target, 'export const intact = null;\n')
    await link(target, outside)
    await expect(verifyWorkbenchArtifactFiles(f.profile, f.packageRoot, f.files)).rejects.toThrow('file bytes')
    await repairWorkbenchArtifactFiles(f.profile, f.packageRoot, f.files)
    expect(await readFile(target)).toEqual(f.files.get('lib/client.js'))
    expect(await readFile(outside, 'utf8')).toBe('export const intact = null;\n')
  })

  it('restores missing files and refuses unexpected installed files', async () => {
    const f = await fixture(), target = join(f.packageRoot, 'lib/client.js')
    await rm(target)
    await expect(verifyWorkbenchArtifactFiles(f.profile, f.packageRoot, f.files)).rejects.toThrow()
    await repairWorkbenchArtifactFiles(f.profile, f.packageRoot, f.files)
    await writeFile(join(f.packageRoot, 'extra.js'), 'untracked')
    await expect(verifyWorkbenchArtifactFiles(f.profile, f.packageRoot, f.files)).rejects.toThrow('unexpected file')
    await expect(repairWorkbenchArtifactFiles(f.profile, f.packageRoot, f.files)).rejects.toThrow('unexpected file')
    expect(await readFile(join(f.packageRoot, 'extra.js'), 'utf8')).toBe('untracked')
  })

  it.each(['package/../escape', 'package/lib/CON', 'package/lib/x.js.', '/package/absolute', 'package/lib\\escape'])('rejects unsafe tar entry %s', async path => {
    await expect(readWorkbenchArtifactFiles(archive([{ path, content: 'x' }]))).rejects.toThrow()
  })

  it('rejects links, case-colliding entries and truncated archives', async () => {
    await expect(readWorkbenchArtifactFiles(archive([{ path: 'package/lib/a', type: 'SymbolicLink' }]))).rejects.toThrow()
    await expect(readWorkbenchArtifactFiles(archive([{ path: 'package/lib/a', content: 'a' }, { path: 'package/lib/A', content: 'b' }]))).rejects.toThrow()
    const f = await fixture()
    await expect(readWorkbenchArtifactFiles(f.bytes.subarray(0, f.bytes.length - 8))).rejects.toThrow()
  })

  it('verifies a native resolved package read-only, including corrupt and extra files', async () => {
    const f = await fixture()
    await verifyNativeResolvedArtifactFiles(f.packageRoot, f.files)
    const target = join(f.packageRoot, 'lib/client.js')
    await writeFile(target, 'corrupted')
    await expect(verifyNativeResolvedArtifactFiles(f.packageRoot, f.files)).rejects.toThrow('file bytes')
    expect(await readFile(target, 'utf8')).toBe('corrupted')
    await writeFile(target, f.files.get('lib/client.js')!)
    await writeFile(join(f.packageRoot, 'injected.js'), 'unexpected')
    await expect(verifyNativeResolvedArtifactFiles(f.packageRoot, f.files)).rejects.toThrow('unexpected file')
    expect(await readFile(join(f.packageRoot, 'injected.js'), 'utf8')).toBe('unexpected')
  })

  it('reports files a development checkout adds without failing, but still rejects altered declared bytes', async () => {
    const f = await fixture()
    await mkdir(join(f.packageRoot, 'src'), { recursive: true })
    await writeFile(join(f.packageRoot, 'src', 'page.js'), 'source')
    await writeFile(join(f.packageRoot, 'README.md'), 'notes')
    const drift = await describeInstalledArtifactDrift(f.packageRoot, f.files)
    expect(drift.unexpected.sort()).toEqual(['README.md', 'src/page.js'])
    await writeFile(join(f.packageRoot, 'lib/client.js'), 'tampered')
    await expect(describeInstalledArtifactDrift(f.packageRoot, f.files)).rejects.toThrow('file bytes')
  })
})
