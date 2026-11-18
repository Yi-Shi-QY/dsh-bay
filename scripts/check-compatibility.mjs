import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
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
const root = readJson('package.json')
const core = readJson('packages/workbench-core/package.json')
const lockfile = parseYaml(readFileSync(path.join(project, 'pnpm-lock.yaml'), 'utf8'))

// RC2 manifests and source mirrors are historical evidence. They remain in
// the repository for auditability, but they are deliberately not part of the
// active compatibility gate for the public v0.1 candidate.
assert.equal(WORKBENCH_DSH_GENERATION, '0.2.2-rc.3')
assert.equal(WORKBENCH_DSH_ENGINE_RANGE, '>=0.2.2-rc.3 <0.2.3')
assert.equal(root.version, WORKBENCH_CORE_VERSION)
assert.equal(root.devDependencies['@deepseek-ai/dsh'], WORKBENCH_DSH_GENERATION)
assert.equal(root.devDependencies['@deepseek-ai/dsh-session-log-export'], WORKBENCH_DSH_GENERATION)
assert.equal(core.name, WORKBENCH_PACKAGE_NAME)
assert.equal(core.version, WORKBENCH_CORE_VERSION)
assert.equal(core.engines.dsh, WORKBENCH_DSH_ENGINE_RANGE)
assert.equal(core.dsh.workbench.dshGeneration, WORKBENCH_DSH_GENERATION)
assert.equal(core.dsh.workbench.upstreamCommit, WORKBENCH_UPSTREAM_COMMIT)
assert.equal(core.dsh.workbench.candidateId, `dsh-bay-${WORKBENCH_CORE_VERSION}-dsh-${WORKBENCH_DSH_GENERATION}`)
assert.equal(core.dsh.client.officialMore, 'host-only-rc3-ui-entry-customization')
assert.deepEqual(core.dsh.workbench.defaultInstall, [WORKBENCH_PACKAGE_NAME])
for (const section of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
  for (const [name, version] of Object.entries(core[section] ?? {})) {
    if (name.startsWith('@deepseek-ai/dsh')) assert.equal(version, section === 'peerDependencies' ? WORKBENCH_DSH_ENGINE_RANGE : WORKBENCH_DSH_GENERATION, `${section}.${name}`)
  }
}
assert.equal(lockfile.importers['.'].devDependencies['@deepseek-ai/dsh'].specifier, WORKBENCH_DSH_GENERATION)
assert.equal(lockfile.importers['.'].devDependencies['@deepseek-ai/dsh-session-log-export'].specifier, WORKBENCH_DSH_GENERATION)
const coreImporter = lockfile.importers['packages/workbench-core']
for (const [name, version] of Object.entries(core.peerDependencies ?? {})) {
  if (!name.startsWith('@deepseek-ai/dsh')) continue
  assert.equal(version, WORKBENCH_DSH_ENGINE_RANGE, `package.json peerDependencies.${name}`)
  assert.equal(coreImporter.dependencies[name]?.specifier, WORKBENCH_DSH_ENGINE_RANGE, `pnpm-lock auto-installed peer ${name}`)
}
console.log(JSON.stringify({ status: 'passed', candidateId: core.dsh.workbench.candidateId, version: WORKBENCH_CORE_VERSION, generation: WORKBENCH_DSH_GENERATION, upstreamCommit: WORKBENCH_UPSTREAM_COMMIT, activeCompatibility: 'rc3', historicalEvidence: ['rc1', 'rc2'] }, null, 2))
