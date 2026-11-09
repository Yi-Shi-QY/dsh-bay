import { afterEach, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { copyTree, walkFiles, writeInventory, readInventory, validateTargetName } from '../src/host-workbench-complete-files.ts'

const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })
it('copies hidden files, empty directories and internal links without following external links', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bay-package-files-')); roots.push(root)
  const source = join(root, 'source'), target = join(root, 'target'); await writeFile(join(root, 'placeholder'), '')
  await (await import('node:fs/promises')).mkdir(join(source, '.hidden', 'empty'), { recursive: true }); await writeFile(join(source, '.hidden', 'note'), 'ok')
  await symlink('.hidden', join(source, 'inside-link'), 'junction')
  const outside = join(root, 'outside'); await (await import('node:fs/promises')).mkdir(outside); await writeFile(join(outside, 'external'), 'external'); await symlink(outside, join(source, 'outside-link'), 'junction')
  await expect(copyTree(source, target)).rejects.toThrow()
  await rm(join(source, 'outside-link')); await copyTree(source, target)
  expect(await readFile(join(target, '.hidden', 'note'), 'utf8')).toBe('ok')
  const entries: string[] = []; for await (const entry of walkFiles(target)) entries.push(entry.path)
  expect(entries).toEqual(expect.arrayContaining(['.hidden', '.hidden/empty', '.hidden/note', 'inside-link']))
  const inventory = join(root, 'inventory.ndjson'); await writeInventory(source, inventory); const rows: string[] = []; for await (const row of readInventory(inventory)) rows.push(row.path)
  expect(rows).toContain('.hidden/note')
})
it('rejects traversal and platform-invalid target names', () => {
  expect(() => validateTargetName('../escape', 'win32')).toThrow()
  expect(() => validateTargetName('CON/file', 'win32')).toThrow()
  expect(() => validateTargetName('projects/app', 'win32')).not.toThrow()
})
