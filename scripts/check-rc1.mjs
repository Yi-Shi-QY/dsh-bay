import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const project = fileURLToPath(new URL('../', import.meta.url))
const readJson = relative => JSON.parse(readFileSync(path.join(project, relative), 'utf8').replace(/^\uFEFF/u, ''))
const sha256Bytes = bytes => createHash('sha256').update(Buffer.from(bytes.toString('utf8').replace(/\r\n/g, '\n'), 'utf8')).digest('hex')
const walk = root => readdirSync(root, { withFileTypes: true }).flatMap(entry => {
  const full = path.join(root, entry.name)
  return entry.isDirectory() ? walk(full) : [full]
})

const compatibility = readJson('compat/dsh-0.2.2-rc.1/manifest.json')
const sourceIndex = readJson('packages/workbench-core/rc1-sidebar-workspace-source-index.json')
const provenance = readJson('provenance/dsh-0.2.2-rc.1.json')
const sourceRoot = path.join(project, 'packages/workbench-core/src/foundation/workbench-sidebar/generated/upstream/rc1-source')
const sourceRows = walk(sourceRoot).sort().map(file => ({
  path: path.relative(sourceRoot, file).split(path.sep).join('/'),
  sha256: sha256Bytes(readFileSync(file)),
}))
const sourceDigest = sha256Bytes(sourceRows.map(row => `${row.path}\0${row.sha256}\n`).join(''))
assert.equal(sourceRows.length, sourceIndex.fileCount)
assert.equal(sourceDigest, sourceIndex.sourceDigest, 'RC1 source index digest does not match its LF-normalized rows')
assert.equal(sourceIndex.generation, compatibility.upstream.generation)
assert.equal(sourceIndex.upstreamCommit, compatibility.upstream.commit)
assert.equal(sourceIndex.sourceDigest, compatibility.upstream.sourceDigest)
assert.equal(provenance.upstream.sourceDigest, compatibility.upstream.sourceDigest)
assert.equal(provenance.candidateId, compatibility.candidateId)
assert.equal(provenance.upstream.commit, compatibility.upstream.commit)
assert.equal(provenance.digests.patch, compatibility.controlledRebase.patchDigest)
assert.deepEqual(provenance.delivery.defaultInstall, compatibility.delivery.defaultInstall)
assert.equal(sourceIndex.packages.length, sourceIndex.fileCount)

const indexedRows = new Map(sourceIndex.packages.map(entry => [`${entry.package}/${entry.path}`, entry.sha256]))
const sourceMismatches = sourceRows.filter(row => indexedRows.get(row.path) !== row.sha256).map(row => row.path)
assert.deepEqual(sourceMismatches, [], 'RC1 source snapshot does not match its LF-normalized historical index')
const sourceRootEvidence = {
  indexedFiles: sourceIndex.fileCount,
  mirroredFiles: sourceRows.length,
  indexedRowsConsistent: sourceMismatches.length === 0,
  sourceDigestConsistent: sourceDigest === sourceIndex.sourceDigest,
  mismatchCount: sourceMismatches.length,
}

console.log(JSON.stringify({
  status: 'historical-metadata-preserved',
  generation: compatibility.upstream.generation,
  upstreamCommit: compatibility.upstream.commit,
  sourceEvidence: 'source-mirror-matches-lf-normalized-index',
  ...sourceRootEvidence,
}, null, 2))
