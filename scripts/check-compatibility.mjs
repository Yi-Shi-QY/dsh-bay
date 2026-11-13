import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse as parseYaml } from 'yaml'
import {
  WORKBENCH_CORE_VERSION,
  WORKBENCH_DSH_ENGINE_RANGE,
  WORKBENCH_DSH_GENERATION,
  WORKBENCH_PACKAGE_NAME,
  WORKBENCH_UPSTREAM_COMMIT,
} from '../packages/workbench-core/src/release-compatibility.ts'

const project = fileURLToPath(new URL('../', import.meta.url))
const readJson = relative => JSON.parse(readFileSync(path.join(project, relative), 'utf8').replace(/^\uFEFF/u, ''))
const canonicalTextBytes = bytes => Buffer.from(bytes.toString('utf8').replace(/\r\n/g, '\n'), 'utf8')
const sha256 = bytes => createHash('sha256').update(canonicalTextBytes(bytes)).digest('hex')
const sha256Raw = bytes => createHash('sha256').update(bytes).digest('hex')
const sha256File = relative => sha256(readFileSync(path.join(project, relative)))
const walk = root => readdirSync(root, { withFileTypes: true }).flatMap(entry => {
  const full = path.join(root, entry.name)
  return entry.isDirectory() ? walk(full) : [full]
})

const rootManifest = readJson('package.json')
const core = readJson('packages/workbench-core/package.json')
const compatibility = readJson('compat/dsh-0.2.2-rc.2/manifest.json')
const sourceIndex = readJson('packages/workbench-core/rc2-sidebar-workspace-source-index.json')
const provenance = readJson('provenance/dsh-0.2.2-rc.2.json')
const copyManifest = readJson('packages/workbench-core/src/foundation/workbench-sidebar.copy-manifest.json')
const candidateId = `dsh-bay-${WORKBENCH_CORE_VERSION}-dsh-${WORKBENCH_DSH_GENERATION}`
const isPinnedResolution = version => version === WORKBENCH_DSH_GENERATION
  || version.startsWith(`${WORKBENCH_DSH_GENERATION}(`)
const identity = {
  candidateId,
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
assert.equal(rootManifest.version, identity.version)
assert.equal(rootManifest.devDependencies['@deepseek-ai/dsh'], identity.generation)
assert.equal(core.engines.dsh, WORKBENCH_DSH_ENGINE_RANGE)
assert.equal(WORKBENCH_DSH_ENGINE_RANGE, '>=0.2.2-rc.2 <0.2.3')
assert.equal(compatibility.delivery.dshEngineRange, WORKBENCH_DSH_ENGINE_RANGE)
assert.equal(provenance.delivery.dshEngineRange, WORKBENCH_DSH_ENGINE_RANGE)
assert.equal(rootManifest.scripts.typecheck, `pnpm --filter ${WORKBENCH_PACKAGE_NAME} build:types`)
assert.equal(core.name, WORKBENCH_PACKAGE_NAME)
assert.notEqual(rootManifest.name, core.name)
assert.deepEqual(core.dsh.workbench.defaultInstall, [WORKBENCH_PACKAGE_NAME])
assert.deepEqual(compatibility.delivery.defaultInstall, [WORKBENCH_PACKAGE_NAME])
assert.deepEqual(provenance.delivery.defaultInstall, [WORKBENCH_PACKAGE_NAME])
assert.deepEqual(core.dsh.workbench.excludedModules, ['@dsh-workbench/conversation-suite', '@dsh-workbench/svgdeepseek-pet'])
assert.equal(core.dsh.client.officialMore, 'host-only-rc2-ui-entry-customization')
assert.equal(compatibility.candidateId, identity.candidateId)
assert.equal(compatibility.productLine, `DSH Bay ${WORKBENCH_CORE_VERSION}`)
assert.equal(compatibility.upstream.generation, identity.generation)
assert.equal(compatibility.upstream.commit, identity.commit)
assert.equal(compatibility.upstream.sourceDigest, sourceIndex.sourceDigest)
assert.equal(provenance.candidateId, identity.candidateId)
assert.equal(provenance.workbenchVersion, identity.version)
assert.equal(provenance.dshGeneration, identity.generation)
assert.equal(provenance.upstream.commit, identity.commit)
assert.equal(provenance.upstream.sourceDigest, sourceIndex.sourceDigest)
assert.deepEqual(compatibility.upstream.registryArtifacts, provenance.upstream.registryArtifacts)

for (const section of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
  for (const [name, version] of Object.entries(core[section] ?? {})) {
    if (name.startsWith('@deepseek-ai/dsh')) {
      const expectedVersion = section === 'peerDependencies' ? WORKBENCH_DSH_ENGINE_RANGE : identity.generation
      assert.equal(version, expectedVersion, `${section}.${name}`)
    }
  }
}

const lockfile = parseYaml(readFileSync(path.join(project, 'pnpm-lock.yaml'), 'utf8'))
assert.equal(lockfile.importers['.'].devDependencies['@deepseek-ai/dsh'].specifier, identity.generation)
assert.ok(isPinnedResolution(lockfile.importers['.'].devDependencies['@deepseek-ai/dsh'].version))
const coreImporter = lockfile.importers['packages/workbench-core']
for (const [name, version] of Object.entries(core.peerDependencies ?? {})) {
  if (!name.startsWith('@deepseek-ai/dsh')) continue
  assert.equal(version, WORKBENCH_DSH_ENGINE_RANGE, `package.json peerDependencies.${name}`)
  assert.equal(coreImporter.dependencies[name]?.specifier, WORKBENCH_DSH_ENGINE_RANGE, `pnpm-lock auto-installed peer ${name}`)
  assert.ok(isPinnedResolution(coreImporter.dependencies[name]?.version), `pnpm-lock resolved peer ${name}`)
}
const staleLockedDshPackages = Object.keys(lockfile.packages ?? {})
  .filter(key => key.startsWith('@deepseek-ai/dsh') && key.includes('0.2.2-rc.1'))
assert.deepEqual(staleLockedDshPackages, [])
assert.equal(provenance.digests.lockfile, sha256File('pnpm-lock.yaml'))

const sourceRoot = path.join(project, 'packages/workbench-core/src/foundation/workbench-sidebar/generated/upstream/rc2-source')
const runtimeRoot = path.join(project, 'packages/workbench-core/src/foundation/workbench-sidebar/generated/upstream')
const sourceRows = walk(sourceRoot).sort().map(file => ({
  path: path.relative(sourceRoot, file).split(path.sep).join('/'),
  sha256: sha256(readFileSync(file)),
  rawSha256: sha256Raw(readFileSync(file)),
}))
const indexedSourceRows = sourceIndex.packages.map(entry => ({
  path: `${entry.package}/${entry.path}`,
  sha256: entry.sha256,
})).sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0)
assert.deepEqual(sourceRows.map(row => row.path), indexedSourceRows.map(row => row.path))
for (const [index, row] of sourceRows.entries()) {
  assert.equal(row.rawSha256, indexedSourceRows[index]?.sha256, `RC2 source bytes: ${row.path}`)
}
const sourceDigest = sha256Raw(Buffer.from(indexedSourceRows.map(row => `${row.path}\0${row.sha256}\n`).join('')))
assert.equal(sourceRows.length, sourceIndex.fileCount)
assert.equal(sourceDigest, sourceIndex.sourceDigest)
assert.equal(sourceIndex.generation, identity.generation)
assert.equal(sourceIndex.upstreamCommit, identity.commit)
assert.equal(sourceIndex.product, `DSH Bay ${identity.version}`)
assert.equal(copyManifest.sourceDigest, sourceDigest)
assert.equal(copyManifest.baselinePatchDigest, sourceDigest)
assert.equal(core.dsh.workbench.sourceDigest, sourceDigest)
assert.equal(copyManifest.migration.targetGeneration, identity.generation)
assert.equal(copyManifest.migration.targetUpstreamCommit, identity.commit)
assert.equal(compatibility.controlledRebase.sourceDigest, sourceDigest)
assert.equal(compatibility.controlledRebase.patchDigest, copyManifest.patchDigest)
assert.equal(provenance.digests.patch, copyManifest.patchDigest)

const adaptedFiles = new Set(copyManifest.adaptedFiles)
const runtimeExtras = new Set(copyManifest.runtimeExtras.map(entry => entry.path))
for (const row of sourceRows) {
  const runtimeFile = path.join(runtimeRoot, row.path)
  const sourceFile = path.join(sourceRoot, row.path)
  const runtimeHash = sha256(readFileSync(runtimeFile))
  if (adaptedFiles.has(row.path)) continue
  assert.equal(runtimeHash, row.sha256, `unregistered source difference: ${row.path}`)
}
const runtimeFiles = [...walk(path.join(runtimeRoot, 'ui-sidebar')), ...walk(path.join(runtimeRoot, 'ui-workspace'))]
  .map(file => path.relative(runtimeRoot, file).split(path.sep).join('/')).sort()
const expectedRuntimeFiles = [...new Set([...sourceRows.map(row => row.path), ...runtimeExtras])].sort()
assert.deepEqual(runtimeFiles, expectedRuntimeFiles)

const patchRows = [
  ...copyManifest.adaptedFiles.toSorted().map(relative =>
    `${relative}\0${sha256(readFileSync(path.join(sourceRoot, relative)))}\0${sha256(readFileSync(path.join(runtimeRoot, relative)))}\n`),
  ...copyManifest.runtimeExtras.toSorted((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0).map(entry =>
    `${entry.path}\0-\0${sha256(readFileSync(path.join(runtimeRoot, entry.path)))}\n`),
]
assert.equal(sha256(Buffer.from(patchRows.join(''))), copyManifest.patchDigest)
assert.equal(provenance.digests.lockfile, sha256File('pnpm-lock.yaml'))

const bundlePatch = parseYaml(readFileSync(path.join(project, 'packages/workbench-core/dsh.bundle.patch.yml'), 'utf8'))
assert.deepEqual(bundlePatch.flatMap(operation => operation.insert.map(row => row.name)), [WORKBENCH_PACKAGE_NAME])
assert.ok(existsFile(path.join(project, 'packages/workbench-core/src/client/native-area-slot-renderer.tsx')))

function existsFile(file) {
  try { readFileSync(file); return true } catch { return false }
}

console.log(JSON.stringify({ status: 'passed', ...identity, sourceFileCount: sourceRows.length, sourceDigest, patchDigest: copyManifest.patchDigest, lockfileDigest: provenance.digests.lockfile }, null, 2))
