export type WorkbenchModuleSourceV1 =
  | {
      readonly kind: 'signed-catalog'
      readonly catalogId: string
      readonly moduleId: string
      readonly version: string
      readonly artifactDigest: string
    }
  | {
      readonly kind: 'npm'
      readonly packageName: string
      readonly requestedRange?: string
      readonly resolvedVersion: string
      readonly artifactDigest: string
      readonly registry: string
    }
  | {
      readonly kind: 'git'
      readonly repository: string
      readonly resolvedCommit: string
      readonly subpath?: string
      readonly artifactDigest: string
    }

export type WorkbenchModuleSourceRequestV1 =
  | { readonly kind: 'npm'; readonly packageName: string; readonly requestedRange?: string; readonly registry?: string }
  | { readonly kind: 'git'; readonly repository: string; readonly ref: string; readonly subpath?: string }

export type WorkbenchModuleTrustV1 = 'catalog-verified' | 'user-approved-unverified' | 'runtime-verified' | 'revoked'

const SHA256 = /^[a-f0-9]{64}$/iu
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/u
const COMMIT = /^[a-f0-9]{40}$/iu
const NPM_NAME = /^(?:@[a-z0-9][a-z0-9._~-]*\/[a-z0-9][a-z0-9._~-]*|[a-z0-9][a-z0-9._~-]*)$/u
const SAFE_SUBPATH = /^(?![\/])(?!(?:\.\.?)(?:\/|$))(?!.*\/(?:\.\.?)(?:\/|$))(?:[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*\/)*[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/u

function validSemver(value: string): boolean {
  const match = value.length <= 256 ? SEMVER.exec(value) : null
  if (match === null || match.slice(1, 4).some(part => !Number.isSafeInteger(Number(part)))) return false
  return (match[4]?.split('.') ?? []).every(part => part.length > 0 && (!/^\d+$/u.test(part) || part === '0' || !part.startsWith('0')))
    && (value.split('+')[1]?.split('.') ?? []).every(part => part.length > 0)
}
function validHttps(value: string): boolean {
  try {
    if (value.length > 2048 || !value.startsWith('https://') || /[\s\\]/u.test(value)) return false
    const url = new URL(value)
    return url.protocol === 'https:' && url.username === '' && url.password === '' && url.search === '' && url.hash === ''
  } catch { return false }
}
function validDigest(value: string): boolean { return SHA256.test(value) }
function keys(row: Record<string, unknown>, allowed: readonly string[]): boolean { return Object.keys(row).every(key => allowed.includes(key)) }
function npmName(value: unknown): value is string { return typeof value === 'string' && value.length <= 214 && NPM_NAME.test(value) && !['node_modules', 'favicon.ico'].includes(value) }
function npmSelector(value: unknown): value is string {
  // Only semver selectors or dist-tags. Never package locators or CLI options.
  return typeof value === 'string' && value.length > 0 && value.length <= 128
    && (/^[a-z][a-z0-9._-]*$/u.test(value) || /^(?:[~^<>=]*[v0-9xX*][0-9A-Za-z.*+~-]*)(?: *(?:\|\||-)? *[~^<>=]*[v0-9xX*][0-9A-Za-z.*+~-]*)*$/u.test(value))
}
function subpath(value: unknown): boolean { return value === undefined || typeof value === 'string' && value.length <= 256 && SAFE_SUBPATH.test(value) }
function gitRef(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._/-]{0,255}$/u.test(value)
    && !value.includes('..') && !value.includes('//') && !value.endsWith('/') && !value.endsWith('.')
    && value.split('/').every(part => !part.startsWith('.') && !part.endsWith('.lock'))
}

export function validateWorkbenchModuleSource(value: unknown): value is WorkbenchModuleSourceV1 {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const row = value as Record<string, unknown>
  if (typeof row.artifactDigest !== 'string' || !validDigest(row.artifactDigest)) return false
  if (row.kind === 'signed-catalog') {
    return keys(row, ['kind', 'catalogId', 'moduleId', 'version', 'artifactDigest'])
      && typeof row.catalogId === 'string' && /^[A-Za-z0-9._:-]{1,160}$/u.test(row.catalogId)
      && typeof row.moduleId === 'string' && /^[A-Za-z0-9._:-]{1,160}$/u.test(row.moduleId)
      && typeof row.version === 'string' && validSemver(row.version)
  }
  if (row.kind === 'npm') {
    return keys(row, ['kind', 'packageName', 'requestedRange', 'resolvedVersion', 'artifactDigest', 'registry']) && npmName(row.packageName)
      && (row.requestedRange === undefined || npmSelector(row.requestedRange))
      && typeof row.resolvedVersion === 'string' && validSemver(row.resolvedVersion)
      && typeof row.registry === 'string' && validHttps(row.registry)
  }
  if (row.kind === 'git') {
    return keys(row, ['kind', 'repository', 'resolvedCommit', 'subpath', 'artifactDigest']) && typeof row.repository === 'string' && validHttps(row.repository)
      && typeof row.resolvedCommit === 'string' && COMMIT.test(row.resolvedCommit)
      && subpath(row.subpath)
  }
  return false
}

export function validateWorkbenchModuleSourceRequest(value: unknown): value is WorkbenchModuleSourceRequestV1 {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const row = value as Record<string, unknown>
  if (row.kind === 'npm') {
    return keys(row, ['kind', 'packageName', 'requestedRange', 'registry']) && npmName(row.packageName)
      && (row.requestedRange === undefined || npmSelector(row.requestedRange))
      && (row.registry === undefined || typeof row.registry === 'string' && validHttps(row.registry))
  }
  if (row.kind === 'git') {
    return keys(row, ['kind', 'repository', 'ref', 'subpath']) && typeof row.repository === 'string' && validHttps(row.repository)
      && gitRef(row.ref) && subpath(row.subpath)
  }
  return false
}

export function sameWorkbenchModuleSource(left: WorkbenchModuleSourceV1, right: WorkbenchModuleSourceV1): boolean {
  if (left.kind !== right.kind) return false
  if (left.kind === 'signed-catalog' && right.kind === 'signed-catalog') return left.catalogId === right.catalogId && left.moduleId === right.moduleId && left.version === right.version && left.artifactDigest.toLowerCase() === right.artifactDigest.toLowerCase()
  if (left.kind === 'npm' && right.kind === 'npm') return left.packageName === right.packageName && left.registry === right.registry && left.resolvedVersion === right.resolvedVersion && left.artifactDigest.toLowerCase() === right.artifactDigest.toLowerCase()
  if (left.kind === 'git' && right.kind === 'git') return left.repository === right.repository && left.resolvedCommit.toLowerCase() === right.resolvedCommit.toLowerCase() && left.subpath === right.subpath && left.artifactDigest.toLowerCase() === right.artifactDigest.toLowerCase()
  return false
}

export type WorkbenchSourceUpdateDecisionV1 = 'update-available' | 'current' | 'downgrade' | 'source-change' | 'identity-conflict'

export function compareWorkbenchVersions(left: string, right: string): -1 | 0 | 1 {
  const a = left.match(SEMVER); const b = right.match(SEMVER)
  if (a === null || b === null || !validSemver(left) || !validSemver(right)) throw new Error('Invalid exact semver')
  for (let index = 1; index <= 3; index++) { const delta = Number(a[index]!) - Number(b[index]!); if (delta !== 0) return delta < 0 ? -1 : 1 }
  const ap = a[4]; const bp = b[4]
  if (ap === bp) return 0
  if (ap === undefined) return 1
  if (bp === undefined) return -1
  const aa = ap.split('.'); const bb = bp.split('.')
  for (let index = 0; index < Math.max(aa.length, bb.length); index++) {
    const left = aa[index]; const right = bb[index]
    if (left === undefined) return -1
    if (right === undefined) return 1
    if (left === right) continue
    const an = /^\d+$/u.test(left); const bn = /^\d+$/u.test(right)
    if (an && bn) return BigInt(left) < BigInt(right) ? -1 : 1
    if (an !== bn) return an ? -1 : 1
    return left < right ? -1 : 1
  }
  return 0
}

export function classifyWorkbenchSourceUpdate(current: WorkbenchModuleSourceV1, candidate: WorkbenchModuleSourceV1): WorkbenchSourceUpdateDecisionV1 {
  if (current.kind !== candidate.kind) return 'source-change'
  if (current.kind === 'npm' && candidate.kind === 'npm') {
    if (current.packageName !== candidate.packageName || current.registry !== candidate.registry) return 'source-change'
    const version = compareWorkbenchVersions(current.resolvedVersion, candidate.resolvedVersion)
    return version < 0 ? 'update-available' : version > 0 ? 'downgrade'
      : current.artifactDigest.toLowerCase() === candidate.artifactDigest.toLowerCase() ? 'current' : 'identity-conflict'
  }
  if (current.kind === 'git' && candidate.kind === 'git') {
    if (current.repository !== candidate.repository || current.subpath !== candidate.subpath) return 'source-change'
    return current.resolvedCommit.toLowerCase() !== candidate.resolvedCommit.toLowerCase() ? 'update-available'
      : current.artifactDigest.toLowerCase() === candidate.artifactDigest.toLowerCase() ? 'current' : 'identity-conflict'
  }
  return sameWorkbenchModuleSource(current, candidate) ? 'current' : 'source-change'
}

/** Bounded compatibility grammar: exact versions and comparator intersections. */
export function workbenchVersionSatisfies(version: string, range: string): boolean {
  if (!validSemver(version) || typeof range !== 'string' || range.length > 256) return false
  return range.split('||').some(alternative => {
    const parts = alternative.trim().split(/\s+/u)
    return parts.length > 0 && parts.every(part => {
      const match = /^(>=|<=|>|<|=|\^|~)?(.+)$/u.exec(part)
      if (!match || !validSemver(match[2]!)) return false
      const target = match[2]!, comparison = compareWorkbenchVersions(version, target)
      switch (match[1] ?? '=') {
        case '>=': return comparison >= 0
        case '>': return comparison > 0
        case '<=': return comparison <= 0
        case '<': return comparison < 0
        case '^': {
          const [major, minor, patch] = target.split(/[.+-]/u).slice(0, 3).map(Number)
          const upper = major! > 0 ? `${major! + 1}.0.0` : minor! > 0 ? `0.${minor! + 1}.0` : `0.0.${patch! + 1}`
          return comparison >= 0 && compareWorkbenchVersions(version, upper) < 0
        }
        case '~': { const [major, minor] = target.split('.').map(Number); return comparison >= 0 && compareWorkbenchVersions(version, `${major}.${minor! + 1}.0`) < 0 }
        default: return comparison === 0
      }
    })
  })
}

/** Exact declarations from an earlier beta remain valid within the same beta line. */
export function workbenchCoreCompatibilitySatisfies(version: string, range: string): boolean {
  if (workbenchVersionSatisfies(version, range)) return true
  const current = /^(0\.1\.0-beta)\.(\d+)$/u.exec(version)
  const required = /^(0\.1\.0-beta)\.(\d+)$/u.exec(range)
  return current !== null && required !== null && current[1] === required[1]
    && Number(current[2]) >= Number(required[2])
}
