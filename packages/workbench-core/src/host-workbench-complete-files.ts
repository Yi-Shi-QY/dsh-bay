import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { chmod, lstat, mkdir, open, opendir, readlink, realpath, rename, symlink } from 'node:fs/promises'
import path from 'node:path'
import { createInterface } from 'node:readline'
import { pipeline } from 'node:stream/promises'
import { portableRelativePath, resolvePortablePath } from './host-native-session-portability.ts'

export interface CompleteFileEntry { path: string; type: 'file' | 'directory' | 'symlink'; bytes: number; mode: number; sha256?: string; target?: string }
export async function hashFile(file: string): Promise<string> {
  const hash = createHash('sha256'); for await (const chunk of createReadStream(file)) hash.update(chunk); return hash.digest('hex')
}
/** Streaming traversal includes dotfiles and empty directories, and never follows links. */
export async function* walkFiles(root: string, relative = ''): AsyncGenerator<CompleteFileEntry> {
  const directory = await opendir(resolvePortablePath(root, relative))
  for await (const child of directory) {
    const name = [relative, child.name].filter(Boolean).join('/'), absolute = resolvePortablePath(root, name), info = await lstat(absolute)
    if (info.isSymbolicLink()) {
      const target = await readlink(absolute)
      const lexicalTarget = path.resolve(path.dirname(absolute), target)
      const targetRelative = portableRelativePath(root, lexicalTarget)
      portableRelativePath(await realpath(root), await realpath(absolute))
      yield { path: name, type: 'symlink', bytes: 0, mode: info.mode & 0o777, target: targetRelative }
    } else if (info.isDirectory()) {
      yield { path: name, type: 'directory', bytes: 0, mode: info.mode & 0o777 }
      yield* walkFiles(root, name)
    } else if (info.isFile()) yield { path: name, type: 'file', bytes: info.size, mode: info.mode & 0o777 }
    else throw new Error('无法打包特殊文件：' + name)
  }
}
export async function copyStableFile(source: string, target: string, signal?: AbortSignal): Promise<string> {
  const before = await lstat(source); if (!before.isFile()) throw new Error('快照文件类型发生变化。')
  await mkdir(path.dirname(target), { recursive: true })
  const temporary = target + '.copying'
  await pipeline(createReadStream(source), createWriteStream(temporary, { mode: before.mode & 0o777 }), ...(signal ? [{ signal }] : []))
  const after = await lstat(source), hash = await hashFile(temporary)
  if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ino !== after.ino || await hashFile(source) !== hash) throw new Error('文件正在被外部程序修改，未能取得稳定快照：' + source)
  await rename(temporary, target)
  return hash
}
export async function copyTree(source: string, target: string, options: { signal?: AbortSignal; exclude?: (relative: string) => boolean; progress?: (entry: CompleteFileEntry) => void } = {}) {
  await mkdir(target, { recursive: true }); const links: CompleteFileEntry[] = []
  for await (const entry of walkFiles(source)) {
    options.signal?.throwIfAborted(); if (options.exclude?.(entry.path)) continue
    const destination = resolvePortablePath(target, entry.path)
    if (entry.type === 'directory') await mkdir(destination, { recursive: true })
    else if (entry.type === 'file') await copyStableFile(resolvePortablePath(source, entry.path), destination, options.signal)
    else links.push(entry)
    if (entry.type !== 'symlink' && process.platform !== 'win32') await chmod(destination, entry.mode)
    options.progress?.(entry)
  }
  // Links are created last, so no file write can traverse an archive-owned link.
  for (const entry of links) {
    const destination = resolvePortablePath(target, entry.path), resolved = resolvePortablePath(target, entry.target!)
    await mkdir(path.dirname(destination), { recursive: true })
    const info = await lstat(resolved)
    try { await symlink(path.relative(path.dirname(destination), resolved), destination, process.platform === 'win32' ? (info.isDirectory() ? 'junction' : 'file') : (info.isDirectory() ? 'dir' : 'file')) }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST' || await realpath(destination) !== await realpath(resolved)) throw error }
  }
}
export async function writeInventory(root: string, file: string, signal?: AbortSignal) {
  const handle = await open(file, 'w')
  try {
    for await (const entry of walkFiles(root)) {
      signal?.throwIfAborted()
      if (entry.type === 'file') entry.sha256 = await hashFile(resolvePortablePath(root, entry.path))
      await handle.writeFile(JSON.stringify(entry) + '\n')
    }
    await handle.sync()
  } finally { await handle.close() }
}
export async function* readInventory(file: string): AsyncGenerator<CompleteFileEntry> {
  const input = createReadStream(file, { encoding: 'utf8' }), lines = createInterface({ input, crlfDelay: Infinity })
  try { for await (const line of lines) { if (!line.trim()) throw new Error('空文件清单记录。'); yield JSON.parse(line) as CompleteFileEntry } }
  finally { lines.close(); input.destroy() }
}
export function validateTargetName(relative: string, platform: NodeJS.Platform): void {
  resolvePortablePath(path.resolve('.'), relative)
  for (const segment of relative.split('/')) {
    if (segment.includes('\0')) throw new Error('文件名包含无效字符：' + relative)
    if (platform === 'win32' && (/[<>:"|?*\u0000-\u001f]/u.test(segment) || /[. ]$/u.test(segment) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(segment))) throw new Error('目标平台不支持文件名：' + relative)
  }
}

/** Checks the selected target on export and the actual recipient on import. */
export async function checkInventoryPlatform(file: string, platform: NodeJS.Platform): Promise<void> {
  const paths = new Set<string>()
  for await (const entry of readInventory(file)) {
    validateTargetName(entry.path, platform)
    const key = platform === 'linux' ? entry.path : entry.path.normalize('NFC').toLocaleLowerCase('und')
    if (paths.has(key)) throw new Error('目标平台存在文件名冲突：' + entry.path)
    paths.add(key)
    if (entry.target !== undefined) validateTargetName(entry.target, platform)
  }
}
