import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { WORKBENCH_CORE_VERSION, WORKBENCH_DSH_GENERATION, WORKBENCH_UPSTREAM_COMMIT } from '../packages/workbench-core/src/release-compatibility.ts'

const project = fileURLToPath(new URL('../', import.meta.url))
const readJson = relative => JSON.parse(readFileSync(path.join(project, relative), 'utf8').replace(/^\uFEFF/u, ''))
const sha256 = relative => createHash('sha256').update(readFileSync(path.join(project, relative))).digest('hex')
const root = readJson('package.json')
const core = readJson('packages/workbench-core/package.json')
const sourceIndex = readJson('packages/workbench-core/rc5-sidebar-workspace-source-index.json')
const provenance = readJson('provenance/dsh-0.2.1-rc.5.json')
const identity = { candidateId: `dsh-bay-${WORKBENCH_CORE_VERSION}-dsh-${WORKBENCH_DSH_GENERATION}`, version: WORKBENCH_CORE_VERSION, generation: WORKBENCH_DSH_GENERATION, commit: WORKBENCH_UPSTREAM_COMMIT }

assert.equal(root.version, WORKBENCH_CORE_VERSION)
assert.equal(root.devDependencies['@deepseek-ai/dsh'], WORKBENCH_DSH_GENERATION)
assert.equal(core.version, WORKBENCH_CORE_VERSION)
assert.equal(core.dsh.workbench.candidateId, identity.candidateId)
assert.equal(core.dsh.workbench.dshGeneration, identity.generation)
assert.equal(core.dsh.workbench.upstreamCommit, identity.commit)
assert.deepEqual(core.dsh.workbench.defaultInstall, ['@dsh-workbench/core'])
assert.deepEqual(core.dsh.workbench.excludedModules, ['@dsh-workbench/conversation-suite', '@dsh-workbench/svgdeepseek-pet'])
assert.equal(core.dsh.client.officialMore, 'host-only-rc5-ui-entry-customization')
assert.equal(core.dsh.client.external.includes('@deepseek-ai/dsh-client-ui-entry-customization'), false)
assert.equal(sourceIndex.generation, identity.generation)
assert.equal(sourceIndex.upstreamCommit, identity.commit)
assert.equal(sourceIndex.fileCount, 34)
assert.match(sourceIndex.sourceDigest, /^[a-f0-9]{64}$/u)
assert.equal(provenance.candidateId, identity.candidateId)
assert.equal(provenance.derivedFrom.candidateId, 'workbench-15.2-rc5-core-only-20261102')
assert.equal(provenance.digests.lockfile, sha256('pnpm-lock.yaml'))
assert.equal(existsSync(path.join(project, 'packages/workbench-core/src/client/native-area-slot-renderer.tsx')), true)
assert.equal(readFileSync(path.join(project, 'packages/workbench-core/src/client/native-area-slot-renderer.tsx'), 'utf8').includes('entry-customization'), true)

console.log(JSON.stringify({ status: 'passed', ...identity, sourceDigest: sourceIndex.sourceDigest, lockfileDigest: provenance.digests.lockfile }, null, 2))
