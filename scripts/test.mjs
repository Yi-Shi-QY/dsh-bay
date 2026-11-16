import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const project = fileURLToPath(new URL('../', import.meta.url))
const temp = path.join(project, '.tmp-vitest-dsh-bay')
mkdirSync(temp, { recursive: true })
execFileSync(process.execPath, [path.join(project, 'node_modules/vitest/vitest.mjs'), 'run', '--config', 'vitest.config.ts', ...process.argv.slice(2)], {
  cwd: project,
  env: { ...process.env, TEMP: temp, TMP: temp, TMPDIR: temp },
  stdio: 'inherit',
  windowsHide: true,
})
