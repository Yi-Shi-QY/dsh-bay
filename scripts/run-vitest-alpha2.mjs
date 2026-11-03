import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const project = fileURLToPath(new URL('../', import.meta.url))
const temp = path.join(project, '.tmp-vitest-rc1')
mkdirSync(temp, { recursive: true })
const env = { ...process.env, TEMP: temp, TMP: temp, TMPDIR: temp }
execFileSync(process.execPath, [path.join(project, 'node_modules/vitest/vitest.mjs'), 'run', '--config', 'vitest.alpha2.config.ts', ...process.argv.slice(2)], {
  cwd: project,
  env,
  stdio: 'inherit',
  windowsHide: true,
})
