import { createHash } from 'node:crypto'
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse as parseYaml } from 'yaml'

const project = fileURLToPath(new URL('../../', import.meta.url))
const args = new Set(process.argv.slice(2).filter(argument => !argument.startsWith('--output=')))
const outputArgument = process.argv.find(argument => argument.startsWith('--output='))
const outputPath = outputArgument?.slice('--output='.length)
const remote = args.has('--remote')
const npmOnly = args.has('--npm-only')
const offline = args.has('--offline') || (!remote && !npmOnly)
const strict = args.has('--strict')

if ([remote, npmOnly, args.has('--offline')].filter(Boolean).length > 1) throw new Error('Choose one of --offline, --npm-only, or --remote')
for (const argument of args) {
  if (!['--offline', '--npm-only', '--remote', '--strict'].includes(argument)) throw new Error(`Unknown option: ${argument}`)
}
if (outputArgument && !outputPath) throw new Error('--output needs a file path')

const readText = relative => readFileSync(path.join(project, relative), 'utf8').replace(/^\uFEFF/u, '')
const readJson = relative => JSON.parse(readText(relative))
const runGitBounded = (args, timeoutMs) => new Promise((resolve, reject) => {
  const child = spawn('git', args, {
    cwd: project,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'Never' },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  const stdout = []
  const stderr = []
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    if (process.platform === 'win32' && child.pid) {
      const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
      killer.on('error', () => child.kill())
    } else child.kill('SIGKILL')
  }, timeoutMs)
  child.stdout.on('data', chunk => stdout.push(chunk))
  child.stderr.on('data', chunk => stderr.push(chunk))
  child.on('error', error => {
    clearTimeout(timer)
    reject(error)
  })
  child.on('close', (code, signal) => {
    clearTimeout(timer)
    const errorOutput = Buffer.concat(stderr)
    if (timedOut || code !== 0) {
      const error = new Error(timedOut ? `git fetch timed out after ${timeoutMs}ms` : `git exited with ${code ?? signal}`)
      error.stderr = errorOutput
      reject(error)
      return
    }
    resolve(Buffer.concat(stdout).toString('utf8').trimEnd())
  })
})
const map = readJson('tools/dsh-adaptation/dependency-map.json')
const provenance = readJson('provenance/dsh-0.2.2-rc.2.json')
const rootManifest = readJson('package.json')
const coreManifest = readJson('packages/workbench-core/package.json')
const lock = parseYaml(readText('pnpm-lock.yaml'))
const upstreamRepository = provenance.upstream.repository.replace(/\.git$/u, '')
const upstreamGitRemote = `${upstreamRepository}.git`
const baselineTag = provenance.upstream.tag
const baselineCommit = provenance.upstream.commit
const mirrorPath = path.join(project, 'tools/dsh-adaptation/.cache/deepseek-harness.git')

const parseVersion = value => {
  const match = String(value ?? '').match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/u)
  return match ? { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]), prerelease: match[4]?.split('.') ?? [] } : null
}
const compareVersions = (left, right) => {
  const a = parseVersion(left)
  const b = parseVersion(right)
  if (!a || !b) return String(left).localeCompare(String(right), 'en', { numeric: true })
  for (const key of ['major', 'minor', 'patch']) if (a[key] !== b[key]) return a[key] - b[key]
  if (a.prerelease.length === 0 || b.prerelease.length === 0) return a.prerelease.length === b.prerelease.length ? 0 : a.prerelease.length === 0 ? 1 : -1
  for (let index = 0; index < Math.max(a.prerelease.length, b.prerelease.length); index += 1) {
    const x = a.prerelease[index]
    const y = b.prerelease[index]
    if (x === undefined || y === undefined) return x === y ? 0 : x === undefined ? -1 : 1
    if (x === y) continue
    const xn = /^\d+$/u.test(x)
    const yn = /^\d+$/u.test(y)
    if (xn && yn) return Number(x) - Number(y)
    if (xn !== yn) return xn ? -1 : 1
    return x.localeCompare(y, 'en')
  }
  return 0
}
const canonical = value => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
  return JSON.stringify(value)
}
const digest = value => createHash('sha256').update(canonical(value)).digest('hex')
const packageGroups = new Map(map.packageGroups.flatMap(group => group.members.map(name => [name, group])))
const hostProvided = new Map(map.hostProvidedPackages.map(row => [row.name, row]))
const packageRoot = name => name.startsWith('@') ? name.split('/').slice(0, 2).join('/') : name.split('/')[0]
const resourceTargets = new Map()
for (const identity of map.resourceIdentities) {
  for (const member of identity.members) {
    const name = packageRoot(member)
    if (!resourceTargets.has(name)) resourceTargets.set(name, {
      name,
      group: identity.id,
      impact: identity.impact,
      moduleScopes: identity.evidence,
      consumerFiles: [],
      changeSignals: identity.changeSignals,
      verification: identity.verification,
      resourceIdentity: identity.id,
    })
  }
}
const artifactBaselines = new Map((provenance.upstream.registryArtifacts ?? []).map(row => [`${row.name}@${row.version}`, row]))
const npmNames = [...new Set([...packageGroups.keys(), ...hostProvided.keys()])].sort()

const packageRowsByNameVersion = new Map()
for (const [key, value] of Object.entries(lock.packages ?? {})) {
  const atIndex = key.startsWith('@') ? key.indexOf('@', key.indexOf('/') + 1) : key.indexOf('@')
  if (atIndex < 0) continue
  const name = key.slice(0, atIndex)
  const version = key.slice(atIndex + 1).match(/^(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/u)?.[1]
  if (!version) continue
  const identity = `${name}@${version}`
  const rows = packageRowsByNameVersion.get(identity) ?? []
  rows.push({ key, integrity: value.resolution?.integrity ?? null })
  packageRowsByNameVersion.set(identity, rows)
}

const manifestRecords = new Map([
  ['package.json', { manifest: rootManifest, importer: lock.importers?.['.'] }],
  ['packages/workbench-core/package.json', { manifest: coreManifest, importer: lock.importers?.['packages/workbench-core'] }],
])
const lockedArtifactFor = (name, version) => {
  if (!version) return { integrity: null, lockKeys: [] }
  const rows = packageRowsByNameVersion.get(`${name}@${version}`) ?? []
  const integrities = [...new Set(rows.map(row => row.integrity).filter(Boolean))]
  return { integrity: integrities.length === 1 ? integrities[0] : null, integrities, lockKeys: rows.map(row => row.key) }
}
const declaredVersions = (name, group) => (group?.declarations ?? []).flatMap(declaration => {
  const [manifestPath, section] = declaration.split('#')
  const source = manifestRecords.get(manifestPath)
  const specifier = source?.manifest?.[section]?.[name]
  const lockSection = section === 'peerDependencies' ? 'dependencies' : section
  const lockedRecord = source?.importer?.[lockSection]?.[name]
  const version = String(lockedRecord?.version ?? '').match(/^(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/u)?.[1]
  return specifier && version ? [{ manifest: manifestPath, section, specifier, version }] : []
})
const consumerFilesByPackage = new Map()
const packageLiteral = /(?:from\s*|import\s*|require\s*\()?['"]([^'"]+)['"]/gu
const walk = directory => readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
  const full = path.join(directory, entry.name)
  return entry.isDirectory() ? walk(full) : [full]
})
for (const sourceRoot of map.scan.sourceRoots) {
  for (const file of walk(path.join(project, sourceRoot))) {
    if (!map.scan.sourceExtensions.includes(path.extname(file))) continue
    const source = readFileSync(file, 'utf8')
    for (const match of source.matchAll(packageLiteral)) {
      const specifier = match[1]
      const importedName = specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0]
      const files = consumerFilesByPackage.get(importedName) ?? []
      const relative = path.relative(project, file).split(path.sep).join('/')
      if (!files.includes(relative)) files.push(relative)
      consumerFilesByPackage.set(importedName, files)
    }
  }
}

const npmTargets = npmNames.map(name => {
  const artifact = provenance.upstream.registryArtifacts?.find(row => row.name === name)
  const group = packageGroups.get(name)
  const host = hostProvided.get(name)
  const declarations = declaredVersions(name, group)
  const lockVersions = [...new Set(declarations.map(row => row.version))]
  const fallbackVersions = [...new Set((packageRowsByNameVersion.size > 0 ? [...packageRowsByNameVersion.keys()] : [])
    .filter(identity => identity.startsWith(`${name}@`))
    .map(identity => identity.slice(name.length + 1)))].sort(compareVersions)
  const baselineVersion = lockVersions[0] ?? artifact?.version ?? fallbackVersions.at(-1) ?? (host?.name.startsWith('@deepseek-ai/') ? provenance.dshGeneration : null)
  const lockArtifact = lockedArtifactFor(name, baselineVersion)
  const integrity = lockArtifact.integrity ?? artifactBaselines.get(`${name}@${baselineVersion}`)?.integrity ?? null
  return {
    name,
    group: group?.id ?? 'host-provided',
    ecosystem: group?.ecosystem ?? 'dsh-host',
    impact: group?.impact ?? host?.impact ?? 'P1',
    baselineVersion,
    baselineSource: lockVersions.length ? 'manifest-importer-and-pnpm-lock' : artifact ? 'provenance-registry-artifact' : fallbackVersions.length ? 'pnpm-lock-transitive' : host && baselineVersion ? 'dsh-generation-assumption' : 'unresolved',
    declarationRecords: declarations,
    baselineLockKeys: lockArtifact.lockKeys,
    baselineIntegrity: integrity,
    integritySource: lockArtifact.integrity ? 'pnpm-lock' : artifactBaselines.has(`${name}@${baselineVersion}`) ? 'provenance-registry-artifact' : null,
    moduleScopes: group?.moduleScopes ?? [],
    consumerFileCount: consumerFilesByPackage.get(name)?.length ?? 0,
    consumerFiles: (consumerFilesByPackage.get(name) ?? []).toSorted().slice(0, 12),
    changeSignals: group?.changeSignals ?? (host?.reason ? [host.reason] : []),
    verification: group?.verification ?? host?.verification ?? ['pnpm typecheck', 'pnpm test'],
  }
})

const findings = []
const addFinding = (severity, kind, message, extra = {}) => findings.push({ severity, kind, message, ...extra })
const baseline = {
  candidate: provenance.workbenchVersion,
  dshGeneration: provenance.dshGeneration,
  upstreamTag: baselineTag,
  upstreamCommit: baselineCommit,
  lockfileDigest: provenance.digests.lockfile,
  scannedPackages: npmTargets.length,
  packagesWithPinnedIntegrity: npmTargets.filter(row => row.baselineIntegrity).length,
  packagesWithoutPinnedIntegrity: npmTargets.filter(row => !row.baselineIntegrity).map(row => ({ name: row.name, baselineVersion: row.baselineVersion, baselineSource: row.baselineSource })),
}
const report = {
  schemaVersion: 1,
  status: 'passed',
  mode: npmOnly ? 'npm-only' : remote ? 'remote' : 'offline',
  generatedAt: new Date().toISOString(),
  baseline,
  github: {
    repository: upstreamRepository,
    transport: 'git-fetch-local-diff',
    localMirror: 'tools/dsh-adaptation/.cache/deepseek-harness.git',
    baselineTag,
    baselineCommit,
    latestTag: null,
    latestCommit: null,
    fetch: null,
    comparison: null,
    status: npmOnly ? 'not-queried' : null,
  },
  npm: { packages: [] },
  findings,
  summary: null,
  limitations: [
    'Remote metadata and source history identify change signals; they do not establish desktop runtime compatibility.',
    'Copied-source hashes and official resource registrations remain checked by pnpm check:compat and targeted tests.',
  ],
}

const mapDshVersions = () => report.npm.packages = npmTargets.map(target => {
  return {
    ...target,
    registry: null,
  }
})

const findingSeverityForImpact = impact => impact === 'P0' ? 'P1' : 'P2'
const isRuntimeSource = filename => {
  const normalized = filename.replaceAll('\\', '/').toLowerCase()
  if (/(^|\/)(?:test|tests|__snapshots__|docs?|locale)(\/|$)/u.test(normalized)) return false
  if (/(^|\/)readme(?:\.[^/]*)?$/u.test(normalized) || normalized.endsWith('/package.json') || normalized === 'package.json') return false
  return /\.(?:[cm]?[jt]sx?|css|scss|sass|h|hpp|c|cc|cpp|ps1|sh|nsi)$/u.test(normalized)
}

if (offline) {
  mapDshVersions()
  report.npm.status = 'not-queried'
  report.status = 'passed'
} else {
  const requestJson = async (url, headers = {}) => {
    let lastError
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const response = await fetch(url, { headers, signal: AbortSignal.timeout(20000) })
        if (!response.ok) {
          const detail = await response.text()
          const error = new Error(`HTTP ${response.status} for ${url}: ${detail.slice(0, 240)}`)
          if (response.status < 500 && response.status !== 429) throw error
          lastError = error
        } else return await response.json()
      } catch (error) {
        lastError = error
      }
      if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 300 * 2 ** attempt))
    }
    throw lastError
  }
  if (!npmOnly) try {
    const runGit = (args, options = {}) => execFileSync('git', args, {
      cwd: project,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 45000,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'Never' },
      maxBuffer: 32 * 1024 * 1024,
      ...options,
    }).trimEnd()
    if (!existsSync(mirrorPath)) {
      mkdirSync(path.dirname(mirrorPath), { recursive: true })
      runGit(['init', '--bare', mirrorPath])
    }
    const remoteUrl = (() => {
      try { return runGit(['-C', mirrorPath, 'remote', 'get-url', 'origin']) } catch { return null }
    })()
    if (remoteUrl === null) runGit(['-C', mirrorPath, 'remote', 'add', 'origin', upstreamGitRemote])
    else if (remoteUrl !== upstreamGitRemote) runGit(['-C', mirrorPath, 'remote', 'set-url', 'origin', upstreamGitRemote])
    let tags
    try {
      await runGitBounded(['-C', mirrorPath, '-c', 'http.connectTimeout=15', '-c', 'http.lowSpeedLimit=1', '-c', 'http.lowSpeedTime=15', 'fetch', '--filter=blob:none', '--force', '--prune', 'origin', '+refs/tags/*:refs/tags/*'], 35000)
      tags = runGit(['-C', mirrorPath, 'tag', '--list', 'dsh-v*']).split(/\r?\n/u).filter(Boolean)
      report.github.fetch = { status: 'passed', refreshedAt: new Date().toISOString(), tagCount: tags.length }
    } catch (error) {
      tags = runGit(['-C', mirrorPath, 'tag', '--list', 'dsh-v*']).split(/\r?\n/u).filter(Boolean)
      if (!tags.includes(baselineTag)) throw error
      report.github.fetch = { status: 'failed', cachedMirrorUsed: true, error: error.stderr?.toString().trim() || error.message, tagCount: tags.length }
      addFinding('P1', 'upstream-git-error', `Could not refresh the DSH Git mirror; comparing the cached tags instead. ${report.github.fetch.error}`, {
        verification: ['Retry the DSH Git fetch to confirm no newer tag has been published.'],
      })
    }
    const resolveTag = tag => runGit(['-C', mirrorPath, 'rev-parse', '--verify', `${tag}^{commit}`])
    const baselineResolved = resolveTag(baselineTag)
    if (baselineResolved !== baselineCommit) {
      addFinding('P0', 'baseline-tag-moved', `The baseline tag now resolves to ${baselineResolved}, recorded commit is ${baselineCommit}.`, { verification: ['Review the upstream tag and provenance before accepting any comparison.'] })
    }
    const candidates = tags.flatMap(tag => {
      const match = tag?.match(/^dsh-v(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/u)
      return match && compareVersions(match[1], provenance.dshGeneration) > 0 ? [{ tag, version: match[1] }] : []
    }).sort((left, right) => compareVersions(left.version, right.version))
    const latest = candidates.at(-1) ?? { tag: baselineTag, version: provenance.dshGeneration }
    report.github.latestTag = latest.tag
    const latestResolved = latest.tag === baselineTag ? baselineResolved : resolveTag(latest.tag)
    report.github.latestCommit = latestResolved
    if (latestResolved !== baselineCommit) {
      const aheadBy = Number(runGit(['-C', mirrorPath, 'rev-list', '--count', `${baselineCommit}..${latestResolved}`]))
      const behindBy = Number(runGit(['-C', mirrorPath, 'rev-list', '--count', `${latestResolved}..${baselineCommit}`]))
      const commitRows = runGit(['-C', mirrorPath, 'log', '--reverse', `--format=%H%x09%aI%x09%s`, `${baselineCommit}..${latestResolved}`])
        .split(/\r?\n/u).filter(Boolean).map(line => {
          const [sha, date, message] = line.split('\t')
          return { sha, date, message }
        })
      const diffParts = runGit(['-C', mirrorPath, 'diff', '--name-status', '-z', '--find-renames', baselineCommit, latestResolved]).split('\0').filter(Boolean)
      const files = []
      for (let index = 0; index < diffParts.length;) {
        const status = diffParts[index++]
        const oldPath = diffParts[index++]
        const renamed = status.startsWith('R') || status.startsWith('C')
        const newPath = renamed ? diffParts[index++] : oldPath
        files.push({ filename: newPath, previousFilename: renamed ? oldPath : undefined, status })
      }
      const comparison = { status: behindBy === 0 ? 'ahead' : aheadBy === 0 ? 'behind' : 'diverged', aheadBy, behindBy, totalCommits: commitRows.length, commits: commitRows, files }
      report.github.comparison = {
        ...comparison,
      }
      report.github.comparison.filesTruncated = false
      const targetsByName = new Map([...resourceTargets, ...npmTargets.map(target => [target.name, target])])
      const pathOverrides = map.upstreamPathOverrides ?? []
      const packageDirectoriesAt = revision => new Set(
        runGit(['-C', mirrorPath, 'ls-tree', '-r', '--name-only', revision, '--', 'packages', 'apps'])
          .split(/\r?\n/u)
          .filter(filename => filename.endsWith('/package.json'))
          .map(filename => path.posix.dirname(filename)),
      )
      const latestPackageDirectories = packageDirectoriesAt(latestResolved)
      const baselinePackageDirectories = packageDirectoriesAt(baselineCommit)
      const owningPackageDirectory = (filename, directories) => {
        let directory = path.posix.dirname(filename)
        while (directory !== '.') {
          if (directories.has(directory)) return directory
          const parent = path.posix.dirname(directory)
          if (parent === directory) break
          directory = parent
        }
        return null
      }
      const inferredPackageName = filename => {
        if (filename === 'package.json') return '@deepseek-ai/dsh'
        const override = pathOverrides
          .filter(row => filename.startsWith(row.pathPrefix))
          .toSorted((left, right) => right.pathPrefix.length - left.pathPrefix.length)[0]
        if (override) return override.packageName
        const parts = filename.split('/')
        if (parts[0] === 'apps' && parts[1]) return `@deepseek-ai/dsh-${parts[1] === 'desktop' ? 'desktop' : parts[1]}`
        if (parts[0] !== 'packages') return null
        const module = parts[2] === 'package.json' ? parts[1] : parts[2]
        if (!module) return null
        const prefix = {
          api: 'dsh-api',
          client: 'dsh-client',
          cordis: 'dsh-cordis',
          host: 'dsh-host',
          typert: 'dsh-typert',
          util: 'dsh-util',
          web: 'dsh-web',
        }[parts[1]] ?? 'dsh'
        return `@deepseek-ai/${prefix}-${module}`
      }
      const dependencyImpacts = new Map()
      const untrackedPaths = new Map()
      const unmappedPaths = new Map()
      for (const file of files) {
        if (file.filename !== 'package.json' && !file.filename.startsWith('packages/') && !file.filename.startsWith('apps/')) continue
        const directory = owningPackageDirectory(file.filename, latestPackageDirectories)
          ?? owningPackageDirectory(file.previousFilename ?? file.filename, baselinePackageDirectories)
        const packagePath = directory ? `${directory}/package.json` : null
        const packageName = packagePath ? inferredPackageName(packagePath) : file.filename === 'package.json' ? '@deepseek-ai/dsh' : null
        if (!directory && file.filename !== 'package.json') {
          const upstreamPath = file.filename.split('/').slice(0, 3).join('/')
          const changedFiles = untrackedPaths.get(upstreamPath) ?? []
          changedFiles.push(file.filename)
          untrackedPaths.set(upstreamPath, changedFiles)
          continue
        }
        if (!packageName) {
          const upstreamPath = file.filename.split('/').slice(0, 3).join('/')
          const changedFiles = unmappedPaths.get(upstreamPath) ?? []
          changedFiles.push(file.filename)
          unmappedPaths.set(upstreamPath, changedFiles)
          continue
        }
        const target = packageName ? targetsByName.get(packageName) : null
        if (!target) {
          const upstreamPath = file.filename.split('/').slice(0, 3).join('/')
          const changedFiles = untrackedPaths.get(upstreamPath) ?? []
          changedFiles.push(file.filename)
          untrackedPaths.set(upstreamPath, changedFiles)
          continue
        }
        const row = dependencyImpacts.get(packageName) ?? {
          package: packageName,
          expectedPackage: packageName,
          group: target.group,
          impact: target.impact,
          changedFiles: [],
          moduleScopes: target.moduleScopes,
          consumerFiles: target.consumerFiles,
          changeSignals: target.changeSignals,
          verification: target.verification,
        }
        row.changedFiles.push(file.filename)
        dependencyImpacts.set(packageName, row)
      }
      report.github.comparison.dependencyImpacts = [...dependencyImpacts.values()].sort((left, right) => left.expectedPackage.localeCompare(right.expectedPackage))
      for (const row of report.github.comparison.dependencyImpacts) {
        row.runtimeSourceChanged = row.changedFiles.some(isRuntimeSource)
        row.changeClass = row.runtimeSourceChanged ? 'runtime-source' : 'metadata-docs-or-tests'
        addFinding(row.runtimeSourceChanged ? findingSeverityForImpact(row.impact) : 'P2', 'dependency-area-change', `Upstream files for ${row.package} changed; Bay consumer modules and verification steps are mapped below.`, row)
      }
      report.github.comparison.untrackedUpstreamPaths = [...untrackedPaths].map(([upstreamPath, changedFiles]) => ({
        upstreamPath,
        changedFileCount: changedFiles.length,
        sampleFiles: changedFiles.slice(0, 3),
      }))
      report.github.comparison.untrackedUpstreamPaths.sort((left, right) => left.upstreamPath.localeCompare(right.upstreamPath))
      report.github.comparison.untrackedUpstreamFileCount = [...untrackedPaths.values()].reduce((total, changedFiles) => total + changedFiles.length, 0)
      report.github.comparison.unmappedUpstreamPaths = [...unmappedPaths].map(([upstreamPath, changedFiles]) => ({ upstreamPath, changedFiles }))
      for (const row of report.github.comparison.unmappedUpstreamPaths) {
        addFinding('P1', 'unmapped-upstream-path', `Could not infer a package candidate for changed upstream path ${row.upstreamPath}.`, {
          ...row,
          verification: ['Inspect the changed upstream path and add a dependency-map rule if Bay consumes it.'],
        })
      }
      report.github.comparison.sourceCopyChanges = map.sourceCopies.flatMap(row => {
        const paths = row.upstreamPaths ?? []
        const files = report.github.comparison.files.map(file => file.filename).filter(filename => paths.some(upstreamPath => filename === upstreamPath || filename.startsWith(`${upstreamPath}/`)))
        if (files.length === 0) return []
        addFinding(findingSeverityForImpact(row.impact), 'source-copy-change', `Upstream files used by ${row.id} changed since the recorded baseline.`, {
          sourceCopy: row.id,
          changedFiles: files,
          verification: row.verification,
        })
        return [{ id: row.id, files }]
      })
      addFinding('P1', 'upstream-commit', `${latest.tag} points to ${latestResolved}, ahead ${aheadBy} commit(s) of the recorded DSH baseline.`, {
        tag: latest.tag,
        commit: latestResolved,
        changedFiles: report.github.comparison.files.map(file => file.filename),
        verification: ['Review upstream type and runtime contract changes', 'pnpm check:compat', 'pnpm typecheck', 'pnpm test', 'DSH desktop acceptance'],
      })
    }
  } catch (error) {
    addFinding('P1', 'upstream-git-error', error.stderr?.toString().trim() || error.message, { verification: ['Retry the local mirror fetch and inspect the upstream Git remote.'] })
  }

  let nextIndex = 0
  const worker = async () => {
    while (nextIndex < npmTargets.length) {
      const target = npmTargets[nextIndex++]
      const row = {
        ...target,
        registry: null,
      }
      report.npm.packages.push(row)
      try {
        const metadata = await requestJson(`https://registry.npmjs.org/${encodeURIComponent(target.name)}`, { accept: 'application/vnd.npm.install-v1+json' })
        const versions = metadata.versions ?? {}
        const available = Object.keys(versions).sort(compareVersions)
        const latestVersion = target.ecosystem === 'dsh' || target.ecosystem === 'dsh-host'
          ? available.at(-1) ?? metadata['dist-tags']?.latest ?? null
          : metadata['dist-tags']?.latest ?? available.at(-1) ?? null
        const baselineRecord = target.baselineVersion ? versions[target.baselineVersion] : null
        const latestRecord = latestVersion ? versions[latestVersion] : null
        const baselineGitHead = baselineRecord?.gitHead ?? null
        const latestGitHead = latestRecord?.gitHead ?? null
        const baselineIntegrity = baselineRecord?.dist?.integrity ?? null
        const knownIntegrity = row.baselineIntegrity
        const normalizedPeers = peers => Object.fromEntries(Object.entries(peers ?? {}).map(([name, version]) => [
          name,
          target.baselineVersion && latestVersion ? String(version).replaceAll(latestVersion, target.baselineVersion) : version,
        ]))
        const baselinePeers = normalizedPeers(baselineRecord?.peerDependencies)
        const latestPeers = normalizedPeers(latestRecord?.peerDependencies)
        const peerDependencyChanges = [...new Set([...Object.keys(baselinePeers), ...Object.keys(latestPeers)])].sort().flatMap(name => {
          if (baselinePeers[name] === latestPeers[name]) return []
          return [{ name, baseline: baselinePeers[name] ?? null, latest: latestPeers[name] ?? null }]
        })
        row.registry = {
          distTags: metadata['dist-tags'] ?? {},
          latestVersion,
          latestPublishedAt: latestVersion ? metadata.time?.[latestVersion] ?? null : null,
          baselinePublishedAt: target.baselineVersion ? metadata.time?.[target.baselineVersion] ?? null : null,
          baselineExists: Boolean(baselineRecord),
          baselineGitHead,
          latestGitHead,
          baselineIntegrity,
          expectedIntegrity: knownIntegrity,
          expectedIntegritySource: target.integritySource,
          latestIntegrity: latestRecord?.dist?.integrity ?? null,
          peerDependenciesChanged: peerDependencyChanges.length > 0,
          peerDependencyChanges,
          exportsChanged: Boolean(baselineRecord && latestRecord && digest(baselineRecord.exports ?? {}) !== digest(latestRecord.exports ?? {})),
        }
        if (!baselineRecord) {
          addFinding(target.impact === 'P0' ? 'P0' : 'P1', 'package-baseline-missing', `${target.name}@${target.baselineVersion ?? 'unknown'} is not present in npm metadata.`, { package: target.name, verification: target.verification })
        }
        if (baselineRecord && !knownIntegrity) {
          addFinding(findingSeverityForImpact(target.impact), 'integrity-baseline-unpinned', `${target.name}@${target.baselineVersion} exists in npm, but the project has no lockfile or provenance integrity for this baseline.`, {
            package: target.name,
            baselineSource: target.baselineSource,
            verification: ['Record the DSH host-provided artifact version and integrity when it becomes an explicit dependency or part of the host closure manifest.'],
          })
        }
        if (target.baselineVersion && latestVersion && compareVersions(latestVersion, target.baselineVersion) > 0) {
          addFinding(findingSeverityForImpact(target.impact), 'newer-version', `${target.name} has ${latestVersion}; the project baseline is ${target.baselineVersion}.`, {
            package: target.name,
            baselineVersion: target.baselineVersion,
            latestVersion,
            verification: target.verification,
          })
        }
        if ((target.ecosystem === 'dsh' || target.ecosystem === 'dsh-host') && baselineRecord && baselineGitHead && baselineGitHead !== baselineCommit) {
          addFinding(target.impact === 'P0' ? 'P1' : 'P2', 'gitHead-drift', `${target.name}@${target.baselineVersion} reports gitHead ${baselineGitHead}, differing from recorded DSH commit ${baselineCommit}.`, { package: target.name, verification: target.verification })
        }
        if (baselineRecord && knownIntegrity && baselineIntegrity !== knownIntegrity) {
          addFinding('P0', 'integrity-drift', `${target.name}@${target.baselineVersion} registry integrity differs from the recorded artifact.`, {
            package: target.name,
            expectedIntegrity: knownIntegrity,
            registryIntegrity: baselineIntegrity,
            verification: ['Check npm provenance and the recorded release tarball before updating the baseline.'],
          })
        }
        if (row.registry.peerDependenciesChanged) addFinding(findingSeverityForImpact(target.impact), 'peer-contract-drift', `${target.name} changed peerDependencies beyond the DSH generation version bump between ${target.baselineVersion} and ${latestVersion}.`, { package: target.name, changes: peerDependencyChanges, verification: target.verification })
        if (row.registry.exportsChanged) addFinding(findingSeverityForImpact(target.impact), 'exports-drift', `${target.name} changed its package exports between ${target.baselineVersion} and ${latestVersion}.`, { package: target.name, verification: target.verification })
      } catch (error) {
        addFinding(target.impact === 'P0' ? 'P1' : 'P2', 'npm-metadata-error', `${target.name}: ${error.message}`, { package: target.name, verification: target.verification })
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(8, npmTargets.length) }, worker))
  report.npm.packages.sort((left, right) => left.name.localeCompare(right.name))
  report.npm.status = report.npm.packages.some(row => row.registry === null) ? 'partial' : 'complete'
  report.status = report.npm.status === 'partial' || findings.some(row => row.kind.endsWith('error')) ? 'partial' : findings.length ? 'drift-detected' : 'passed'
}

report.findings.sort((left, right) => left.severity.localeCompare(right.severity) || left.kind.localeCompare(right.kind) || (left.package ?? '').localeCompare(right.package ?? ''))
const countBy = key => Object.fromEntries([...new Set(report.findings.map(row => row[key]))].sort().map(value => [value, report.findings.filter(row => row[key] === value).length]))
report.summary = {
  status: report.status,
  mode: report.mode,
  latestDshTag: report.github.latestTag,
  upstreamCommitsAhead: report.github.comparison?.aheadBy ?? null,
  npmPackagesScanned: report.npm.packages.length,
  npmScanStatus: report.npm.status,
  integrityCoverage: {
    pinned: npmTargets.filter(row => row.baselineIntegrity).length,
    total: npmTargets.length,
    unpinned: npmTargets.filter(row => !row.baselineIntegrity).map(row => row.name),
  },
  upstreamFilesReported: report.github.comparison?.files.length ?? null,
  upstreamDiffTruncated: report.github.comparison?.filesTruncated ?? false,
  sourceCopiesChanged: report.github.comparison?.sourceCopyChanges?.length ?? 0,
  affectedDependencies: report.github.comparison?.dependencyImpacts?.length ?? 0,
  untrackedUpstreamPaths: report.github.comparison?.untrackedUpstreamPaths?.length ?? 0,
  untrackedUpstreamFiles: report.github.comparison?.untrackedUpstreamFileCount ?? 0,
  unmappedUpstreamPaths: report.github.comparison?.unmappedUpstreamPaths?.length ?? 0,
  findingCount: report.findings.length,
  findingsBySeverity: countBy('severity'),
  findingsByKind: countBy('kind'),
}
if (outputPath) {
  const absoluteOutput = path.resolve(project, outputPath)
  mkdirSync(path.dirname(absoluteOutput), { recursive: true })
  writeFileSync(absoluteOutput, `${JSON.stringify(report, null, 2)}\n`)
}
console.log(JSON.stringify(outputPath ? { ...report.summary, reportPath: path.relative(project, path.resolve(project, outputPath)).split(path.sep).join('/') } : report, null, 2))
if (strict && report.status !== 'passed') process.exitCode = 1
