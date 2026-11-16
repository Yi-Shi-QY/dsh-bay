import { spawnSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const generatedDirectories = new Set(['.git', 'node_modules', 'lib', 'tmp', 'output', 'prototypes', 'releases'])
const forbiddenPath = /(?:^|\/)(?:\.env(?:\..*)?|docs\/reviews|dsh-superagent|node_modules|tmp|output|prototypes)(?:\/|$)|(?:^|\/)\.tmp-[^/]+(?:\/|$)|(?:^|\/)releases\/[^/]*private(?:\/|$)|\.(?:log|tgz|zip)$/iu
const secretPatterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u,
  /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b/u,
  /\bAKIA[0-9A-Z]{16}\b/u,
  /\bAIza[0-9A-Za-z_-]{35}\b/u,
  /\bsk-[A-Za-z0-9]{32,}\b/u,
]
const localPath = /(?:[A-Za-z]:[\\/]Users[\\/][^\s"'<>]+|\/(?:Users|home)\/[^/\s"'<>]+|\.codex[\\/]worktrees)/iu
const internalRelease = /(?:dsh-bay@)?0\.2\.2-alpha\.18\.\d+|releases\/[^\s"'<>]*-private|private staging/iu

function trackedFiles() {
  const result = spawnSync('git', ['ls-files', '-co', '--exclude-standard', '-z'], { cwd: root, encoding: 'utf8' })
  if (result.status === 0) {
    return result.stdout.split('\0').filter(Boolean).map(file => file.replaceAll('\\', '/'))
  }
  if (result.error?.code !== 'ENOENT' && result.stderr && !result.stderr.includes('not a git repository')) {
    throw result.error ?? new Error(result.stderr.trim())
  }
  const files = []
  const visit = (directory, relative = '') => {
    for (const entry of readdirSync(path.join(root, directory), { withFileTypes: true })) {
      const child = relative ? `${relative}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        const first = child.split('/')[0]
        if (generatedDirectories.has(first) || first.startsWith('.tmp-')) continue
        visit(child, child)
      } else if (entry.isFile()) files.push(child)
    }
  }
  visit('')
  return files
}

const files = trackedFiles()
const failures = []
for (const file of files) {
  if (forbiddenPath.test(file)) failures.push(`${file}: forbidden public path`)
  if (file === 'scripts/check-public-tree.mjs') continue
  let contents
  try {
    contents = readFileSync(path.join(root, file))
  } catch {
    failures.push(`${file}: tracked file is missing`)
    continue
  }
  if (contents.includes(0)) continue
  const text = contents.toString('utf8')
  for (const pattern of secretPatterns) {
    const match = pattern.exec(text)
    if (match) failures.push(`${file}:${text.slice(0, match.index).split('\n').length}: possible credential material`)
  }
  if (!/(?:^|\/)tests?\//iu.test(file)) {
    const pathMatch = localPath.exec(text)
    if (pathMatch) failures.push(`${file}:${text.slice(0, pathMatch.index).split('\n').length}: local absolute path`)
    const releaseMatch = internalRelease.exec(text)
    if (releaseMatch) failures.push(`${file}:${text.slice(0, releaseMatch.index).split('\n').length}: internal candidate reference`)
  }
}

if (failures.length) {
  console.error(failures.map(item => `FAIL ${item}`).join('\n'))
  process.exitCode = 1
} else {
  console.log(`Public snapshot check passed (${files.length} files).`)
}
