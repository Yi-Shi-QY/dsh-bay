import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { WORKBENCH_PACKAGE_NAME, WORKBENCH_CORE_VERSION, WORKBENCH_DSH_GENERATION, WORKBENCH_UPSTREAM_COMMIT } from '../packages/workbench-core/src/release-compatibility.ts'

const project = fileURLToPath(new URL('../', import.meta.url))
const readJson = relative => JSON.parse(readFileSync(path.join(project, relative), 'utf8').replace(/^\uFEFF/u, ''))
const canonicalTextBytes = bytes => Buffer.from(bytes.toString('utf8').replace(/\r\n/g, '\n'), 'utf8')
const sha256Bytes = bytes => createHash('sha256').update(canonicalTextBytes(bytes)).digest('hex')
const sha256File = relative => sha256Bytes(readFileSync(path.join(project, relative)))
const walk = root => readdirSync(root, { withFileTypes: true }).flatMap(entry => {
  const full = path.join(root, entry.name)
  return entry.isDirectory() ? walk(full) : [full]
})

const root = readJson('package.json')
const core = readJson('packages/workbench-core/package.json')
const compatibility = readJson('compat/dsh-0.2.2-rc.1/manifest.json')
const sourceIndex = readJson('packages/workbench-core/rc1-sidebar-workspace-source-index.json')
const provenance = readJson('provenance/dsh-0.2.2-rc.1.json')
const copyManifest = readJson('packages/workbench-core/src/foundation/workbench-sidebar.copy-manifest.json')
const identity = {
  candidateId: `dsh-bay-${WORKBENCH_CORE_VERSION}-dsh-${WORKBENCH_DSH_GENERATION}`,
  version: WORKBENCH_CORE_VERSION,
  generation: WORKBENCH_DSH_GENERATION,
  commit: WORKBENCH_UPSTREAM_COMMIT,
}

assert.deepEqual(identity, {
  candidateId: core.dsh.workbench.candidateId,
  version: core.version,
  generation: core.dsh.workbench.dshGeneration,
  commit: core.dsh.workbench.upstreamCommit,
})
assert.equal(root.version, identity.version)
assert.equal(core.name, WORKBENCH_PACKAGE_NAME)
assert.notEqual(root.name, core.name)
assert.equal(root.scripts.typecheck, `pnpm --filter ${WORKBENCH_PACKAGE_NAME} build:types`)
assert.equal(root.devDependencies['@deepseek-ai/dsh'], identity.generation)
assert.deepEqual(core.dsh.workbench.defaultInstall, ['dsh-bay'])
assert.deepEqual(provenance.delivery.defaultInstall, [WORKBENCH_PACKAGE_NAME])
assert.equal(compatibility.candidateId, identity.candidateId)
assert.equal(compatibility.productLine, `DSH Bay ${WORKBENCH_CORE_VERSION}`)
assert.equal(compatibility.upstream.generation, identity.generation)
assert.equal(compatibility.upstream.commit, identity.commit)
assert.equal(compatibility.upstream.sourceDigest, sourceIndex.sourceDigest)
assert.deepEqual(compatibility.delivery.defaultInstall, [WORKBENCH_PACKAGE_NAME])
assert.equal(compatibility.controlledRebase.patchDigest, copyManifest.patchDigest)
assert.deepEqual(core.dsh.workbench.excludedModules, ['@dsh-workbench/conversation-suite', '@dsh-workbench/svgdeepseek-pet'])
assert.equal(core.dsh.client.officialMore, 'host-only-rc1-ui-entry-customization')
assert.equal(core.peerDependencies['@deepseek-ai/dsh-client-ui-context-menu'], identity.generation)
assert.equal(core.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-context-menu'), true)
for (const section of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
  for (const [name, version] of Object.entries(core[section] ?? {})) {
    if (name.startsWith('@deepseek-ai/dsh')) assert.equal(version, identity.generation, `${section}.${name}`)
  }
}
assert.equal(sourceIndex.generation, identity.generation)
assert.equal(sourceIndex.upstreamCommit, identity.commit)
assert.equal(sourceIndex.fileCount, 34)
assert.match(sourceIndex.sourceDigest, /^[a-f0-9]{64}$/u)
assert.equal(copyManifest.sourceDigest, sourceIndex.sourceDigest)
assert.equal(copyManifest.migration.targetGeneration, identity.generation)
assert.equal(copyManifest.migration.targetUpstreamCommit, identity.commit)
assert.equal(provenance.candidateId, identity.candidateId)
assert.equal(provenance.upstream.commit, identity.commit)
assert.equal(provenance.upstream.sourceDigest, sourceIndex.sourceDigest)
assert.equal(provenance.digests.lockfile, sha256File('pnpm-lock.yaml'))
assert.equal(provenance.digests.patch, copyManifest.patchDigest)
assert.equal(existsSync(path.join(project, 'packages/workbench-core/src/client/native-area-slot-renderer.tsx')), true)
const runtimeRootForPatch = path.join(project, 'packages/workbench-core/src/foundation/workbench-sidebar/generated/upstream')
const sourceRootForPatch = path.join(runtimeRootForPatch, 'rc1-source')
const patchRows = [
  ...copyManifest.adaptedFiles.toSorted().map(relative =>
    `${relative}\0${sha256Bytes(readFileSync(path.join(sourceRootForPatch, relative)))}\0${sha256Bytes(readFileSync(path.join(runtimeRootForPatch, relative)))}\n`),
  ...copyManifest.runtimeExtras.toSorted((left, right) => left.path.localeCompare(right.path)).map(entry =>
    `${entry.path}\0-\0${sha256Bytes(readFileSync(path.join(runtimeRootForPatch, entry.path)))}\n`),
]
assert.equal(sha256Bytes(patchRows.join('')), copyManifest.patchDigest)

const sourceRoot = path.join(project, 'packages/workbench-core/src/foundation/workbench-sidebar/generated/upstream/rc1-source')
const sourceRows = walk(sourceRoot).sort().map(file => ({
  path: path.relative(sourceRoot, file).split(path.sep).join('/'),
  sha256: sha256Bytes(readFileSync(file)),
}))
assert.equal(sourceRows.length, sourceIndex.fileCount)
assert.equal(sha256Bytes(sourceRows.map(row => `${row.path}\0${row.sha256}\n`).join('')), sourceIndex.sourceDigest)
const indexedRows = sourceIndex.packages.flatMap(entry => [{ path: `${entry.package}/${entry.path}`, sha256: entry.sha256 }])
assert.deepEqual(indexedRows, sourceRows)

console.log(JSON.stringify({ status: 'passed', ...identity, sourceDigest: sourceIndex.sourceDigest, lockfileDigest: provenance.digests.lockfile }, null, 2))
