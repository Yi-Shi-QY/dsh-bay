import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const project = fileURLToPath(new URL('../', import.meta.url))
const output = path.join(project, 'releases', 'alpha17-private')
const core = path.join(project, 'packages', 'workbench-core')
mkdirSync(output, { recursive: true })
const node = process.execPath
execFileSync(node, [path.join(project, 'scripts/build.mjs')], { cwd: project, stdio: 'inherit', windowsHide: true })
execFileSync(node, [path.join(project, 'node_modules/typescript/bin/tsc'), '-b', 'packages/workbench-core/tsconfig.host.json', 'packages/workbench-core/tsconfig.client.json', '--pretty', 'false'], { cwd: project, stdio: 'inherit', windowsHide: true })
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
if (process.platform === 'win32') {
  execFileSync(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', `"${pnpm} pack --pack-destination \"${output}\""`], { cwd: core, stdio: 'inherit', windowsHide: true })
} else {
  execFileSync(pnpm, ['pack', '--pack-destination', output], { cwd: core, stdio: 'inherit', windowsHide: true })
}
const tarball = readdirSync(output).find(file => file.endsWith('.tgz'))
if (tarball === undefined) throw new Error('Core package tarball was not produced')
const bytes = readFileSync(path.join(output, tarball))
const manifest = JSON.parse(readFileSync(path.join(core, 'package.json'), 'utf8'))
const candidate = {
  status: 'private-staging',
  candidateId: 'dsh-bay-0.2.2-alpha.17-dsh-0.2.1-rc.5',
  product: 'DSH Bay / 湾域',
  packageName: manifest.name,
  version: manifest.version,
  dshGeneration: manifest.dsh.workbench.dshGeneration,
  upstreamCommit: manifest.dsh.workbench.upstreamCommit,
  artifact: {
    path: `releases/alpha17-private/${tarball}`,
    size: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}`,
  },
}
writeFileSync(path.join(output, 'candidate.json'), JSON.stringify(candidate, null, 2) + '\n')
console.log(JSON.stringify(candidate, null, 2))
