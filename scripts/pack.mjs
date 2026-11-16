import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const project = fileURLToPath(new URL('../', import.meta.url))
const core = path.join(project, 'packages', 'workbench-core')
const manifest = JSON.parse(readFileSync(path.join(core, 'package.json'), 'utf8'))
const outputArgument = process.argv.find(arg => arg.startsWith('--output='))?.slice('--output='.length)
const output = outputArgument ? path.resolve(project, outputArgument) : path.join(project, 'releases', manifest.version)
if (!output.startsWith(path.join(project, 'releases') + path.sep)) throw new Error('Package output must be a directory inside releases/')
const tarball = `${manifest.name.replace(/^@/u, '').replaceAll('/', '-')}-${manifest.version}.tgz`
mkdirSync(output, { recursive: true })
// TypeScript's incremental build does not remove declarations emitted by a
// previous DSH generation. Start from a clean generated directory so the
// archive cannot carry declarations from a different upstream generation.
rmSync(path.join(core, 'lib'), { recursive: true, force: true })
const node = process.execPath
execFileSync(node, [path.join(project, 'scripts/build.mjs')], { cwd: project, stdio: 'inherit', windowsHide: true })
execFileSync(node, [path.join(project, 'node_modules/typescript/bin/tsc'), '-b', 'packages/workbench-core/tsconfig.host.json', 'packages/workbench-core/tsconfig.client.json', '--pretty', 'false'], { cwd: project, stdio: 'inherit', windowsHide: true })
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
if (process.platform === 'win32') {
  // Pass a relative destination without spaces so cmd does not preserve quote
  // characters as part of pnpm's destination argument.
  const destination = path.relative(core, output)
  execFileSync(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', `${pnpm} pack --pack-destination ${destination}`], {
    cwd: core, stdio: 'inherit', windowsHide: true,
  })
} else {
  execFileSync(pnpm, ['pack', '--pack-destination', output], { cwd: core, stdio: 'inherit', windowsHide: true })
}
if (!existsSync(path.join(output, tarball))) throw new Error(`Core package tarball was not produced: ${tarball}`)
const bytes = readFileSync(path.join(output, tarball))
const buildInputs = JSON.parse(readFileSync(path.join(core, 'lib/build-inputs.json'), 'utf8'))
if (buildInputs.workbenchVersion !== manifest.version) throw new Error('Build/package version mismatch')
if (buildInputs.packageName !== manifest.name) throw new Error('Build/package name mismatch')
const candidate = {
  status: 'public-beta',
  candidateId: buildInputs.candidateId,
  product: 'DSH Bay / 湾',
  packageName: manifest.name,
  version: manifest.version,
  dshGeneration: manifest.dsh.workbench.dshGeneration,
  dshCompatibility: manifest.engines.dsh,
  upstreamCommit: manifest.dsh.workbench.upstreamCommit,
  artifact: {
    path: path.relative(project, path.join(output, tarball)).replaceAll(path.sep, '/'),
    size: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}`,
  },
}
writeFileSync(path.join(output, 'candidate.json'), JSON.stringify(candidate, null, 2) + '\n')
console.log(JSON.stringify(candidate, null, 2))
