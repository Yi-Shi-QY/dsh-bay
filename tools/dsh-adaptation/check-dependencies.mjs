import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const project = fileURLToPath(new URL('../../', import.meta.url))
const readJson = relative => JSON.parse(readFileSync(path.join(project, relative), 'utf8').replace(/^\uFEFF/u, ''))
const map = readJson('tools/dsh-adaptation/dependency-map.json')
const rootManifest = readJson('package.json')
const coreManifest = readJson('packages/workbench-core/package.json')

const walk = root => readdirSync(root, { withFileTypes: true }).flatMap(entry => {
  const full = path.join(root, entry.name)
  return entry.isDirectory() ? walk(full) : [full]
})
const sourceFiles = map.scan.sourceRoots.flatMap(relative => walk(path.join(project, relative)))
  .filter(file => map.scan.sourceExtensions.includes(path.extname(file)))
const globToRegExp = pattern => {
  let source = '^'
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index]
    if (character === '*') {
      if (pattern[index + 1] === '*') { source += '.*'; index += 1 } else source += '[^/]*'
    } else if (character === '{') {
      const end = pattern.indexOf('}', index)
      if (end < 0) source += '\\{'
      else { source += `(${pattern.slice(index + 1, end).split(',').map(value => value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')).join('|')})`; index = end }
    } else source += character.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
  }
  return new RegExp(source + '$', 'u')
}
const readEvidenceText = patterns => patterns.flatMap(pattern => {
  if (!pattern.includes('*') && !pattern.includes('{')) return [readFileSync(path.join(project, pattern), 'utf8')]
  const matcher = globToRegExp(pattern)
  return sourceFiles.filter(file => matcher.test(path.relative(project, file).split(path.sep).join('/'))).map(file => readFileSync(file, 'utf8'))
}).join('\n')
const rootPackage = value => value.startsWith('@') ? value.split('/').slice(0, 2).join('/') : value.split('/')[0]
const directDeclarations = new Map()
for (const [manifestName, manifest] of [['package.json', rootManifest], ['packages/workbench-core/package.json', coreManifest]]) {
  for (const section of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
    for (const name of Object.keys(manifest[section] ?? {})) {
      const prior = directDeclarations.get(name) ?? []
      prior.push(`${manifestName}#${section}`)
      directDeclarations.set(name, prior)
    }
  }
}

const packageGroups = map.packageGroups.flatMap(group => group.members.map(name => ({ name, group: group.id, ecosystem: group.ecosystem })))
assert.equal(map.upstreamPackageIdentity, 'path-candidate-matched-to-dependency-target', 'upstream package paths must resolve only to registered dependency targets')
const packageGroupNames = new Set(packageGroups.map(row => row.name))
const duplicatePackageGroups = packageGroups.filter((row, index) => packageGroups.findIndex(other => other.name === row.name) !== index)
assert.deepEqual(duplicatePackageGroups, [], `dependency map package appears in multiple groups: ${duplicatePackageGroups.map(row => row.name).join(', ')}`)
const missingDeclarations = [...directDeclarations.keys()].filter(name => !packageGroupNames.has(name))
const extraDeclarations = [...packageGroupNames].filter(name => !directDeclarations.has(name))
assert.deepEqual(missingDeclarations, [], `direct dependency is missing from the map: ${missingDeclarations.join(', ')}`)
assert.deepEqual(extraDeclarations, [], `map member is not a direct dependency: ${extraDeclarations.join(', ')}`)

const hostProvided = new Set(map.hostProvidedPackages.map(row => row.name))
const resourceMembers = map.resourceIdentities.flatMap(row => row.members)
const resourceRoots = new Set(resourceMembers.map(rootPackage))
const mappedTargetNames = new Set([...packageGroupNames, ...hostProvided, ...resourceRoots])
for (const override of map.upstreamPathOverrides ?? []) {
  assert.ok(/^(?:packages|apps)\//u.test(override.pathPrefix), `upstream path override must be under packages/ or apps/: ${override.pathPrefix}`)
  assert.ok(mappedTargetNames.has(override.packageName), `upstream path override references an untracked package: ${override.packageName}`)
}
const packageLiteral = /@deepseek-ai\/[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*/gu
const observed = new Map()
for (const file of sourceFiles) {
  const relative = path.relative(project, file).split(path.sep).join('/')
  const source = readFileSync(file, 'utf8')
  for (const match of source.matchAll(packageLiteral)) {
    const literal = match[0]
    const name = rootPackage(literal)
    const rows = observed.get(name) ?? []
    if (!rows.includes(relative)) rows.push(relative)
    observed.set(name, rows)
  }
}
const unclassified = [...observed.keys()].filter(name => !packageGroupNames.has(name) && !hostProvided.has(name) && !resourceRoots.has(name))
assert.deepEqual(unclassified, [], `DSH package literal is not classified: ${unclassified.join(', ')}`)

for (const row of map.hostProvidedPackages) {
  assert.equal(typeof row.name, 'string', 'host-provided package needs a name')
  assert.ok(row.evidence?.length > 0, `host-provided package needs evidence: ${row.name}`)
  assert.ok(row.verification?.length > 0, `host-provided package needs verification: ${row.name}`)
}
for (const row of map.resourceIdentities) {
  assert.ok(row.members.length > 0, `resource identity group is empty: ${row.id}`)
  for (const member of row.members) {
    const evidence = readEvidenceText(row.evidence)
    const observedInScan = [...observed.keys()].some(name => member === name || rootPackage(member) === name)
    const observedInEvidence = [member, member.replaceAll('/', '\\/')].some(value => evidence.includes(value))
    assert.ok(observedInScan || observedInEvidence, `resource identity is not observed: ${member}`)
    assert.ok(observedInEvidence, `resource identity evidence does not contain ${member}: ${row.id}`)
  }
}

for (const row of map.sourceCopies) {
  for (const key of ['sourceIndex', 'copyManifest', 'provenance', 'runtimeMirror']) {
    if (row[key] === undefined) continue
    const target = path.join(project, row[key])
    assert.ok(row[key].endsWith('/') ? false : true, `source copy path must be a file or directory: ${row.id}.${key}`)
    try { readFileSync(target) } catch {
      try { readdirSync(target) } catch { throw new Error(`source copy path does not exist: ${row.id}.${key}=${row[key]}`) }
    }
  }
}

const counts = [...observed.entries()].map(([name, files]) => ({
  name,
  classification: packageGroupNames.has(name) ? 'declared' : hostProvided.has(name) ? 'host-provided' : 'resource-identity',
  files: files.length,
})).sort((left, right) => left.name.localeCompare(right.name))
console.log(JSON.stringify({
  status: 'passed',
  directDependencyCount: directDeclarations.size,
  declaredPackageGroupCount: packageGroupNames.size,
  observedDshPackageCount: observed.size,
  sourceFileCount: sourceFiles.length,
  classifications: counts,
}, null, 2))
