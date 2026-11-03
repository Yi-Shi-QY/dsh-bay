import { createHash, randomBytes } from 'node:crypto'
import { lstat, mkdir, readFile, readdir, realpath, rename, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, sep } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { Parser, type ReadEntry } from 'tar'

const MAX_EXPANDED = 128 * 1024 * 1024
const MAX_FILE = 64 * 1024 * 1024
const MAX_ENTRIES = 4096

/** Inspect trusted npm bytes without extracting paths or executing package code. */
export async function readWorkbenchArtifactFiles(bytes: Uint8Array): Promise<ReadonlyMap<string, Buffer>> {
  const expanded = gunzipSync(bytes, { maxOutputLength: MAX_EXPANDED })
  const files = new Map<string, Buffer>(), paths = new Set<string>()
  await new Promise<void>((done, reject) => {
    const parser = new Parser({ strict: true, maxMetaEntrySize: 16 * 1024 })
    parser.on('error', reject)
    parser.on('end', done)
    parser.on('entry', (entry: ReadEntry) => {
      const path = entry.path.replace(/\/$/u, '')
      const parts = path.split('/')
      const key = path.toLowerCase()
      if (parts[0] !== 'package' || parts.some(part => !/^[a-zA-Z0-9@_+.-]+$/u.test(part) || part === '.' || part === '..' || /[.]$/u.test(part) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(part))
        || paths.has(key) || paths.size >= MAX_ENTRIES || !['File', 'Directory'].includes(entry.type)
        || !Number.isSafeInteger(entry.size) || entry.size < 0 || entry.size > MAX_FILE
        || (entry.type === 'Directory' && entry.size !== 0)) {
        parser.abort(new Error('Workbench artifact contains an unsafe or unsupported entry'))
        return
      }
      paths.add(key)
      if (entry.type === 'Directory') { entry.resume(); return }
      if (parts.length < 2 || parts[1] === 'node_modules') {
        parser.abort(new Error('Workbench artifact package closure is unsupported'))
        return
      }
      const chunks: Buffer[] = []
      let size = 0
      entry.on('data', (chunk: Buffer) => { size += chunk.length; chunks.push(chunk) })
      entry.on('end', () => {
        if (size !== entry.size) { parser.abort(new Error('Workbench artifact entry is truncated')); return }
        files.set(parts.slice(1).join('/'), Buffer.concat(chunks, size))
      })
      entry.resume()
    })
    parser.end(expanded)
  })
  if (!files.has('package.json') || !files.has('lib/client.js')) throw new Error('Workbench artifact lacks its runtime files')
  const fileKeys = new Set([...files.keys()].map(path => path.toLowerCase()))
  for (const path of files.keys()) {
    const parts = path.split('/')
    for (let i = 1; i < parts.length; i++) if (fileKeys.has(parts.slice(0, i).join('/').toLowerCase())) throw new Error('Workbench artifact has conflicting file paths')
  }
  return files
}

async function installedRoot(profile: string, packageRoot: string): Promise<string> {
  const root = await realpath(packageRoot)
  const base = await realpath(join(profile, 'node_modules'))
  const child = relative(base, root)
  if (child === '' || child === '..' || child.startsWith(`..${sep}`) || isAbsolute(child)) throw new Error('Workbench installed package is outside its Profile')
  return root
}

async function filePath(root: string, path: string, create: boolean): Promise<string> {
  const parts = path.split('/')
  let current = root
  for (const part of parts.slice(0, -1)) {
    current = join(current, part)
    if (create) await mkdir(current).catch(error => { if (error.code !== 'EEXIST') throw error })
    const stat = await lstat(current)
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Workbench installed package has an unsafe directory')
  }
  return join(current, parts.at(-1)!)
}

export async function verifyWorkbenchArtifactFiles(profile: string, packageRoot: string, files: ReadonlyMap<string, Buffer>): Promise<void> {
  await verifyNativeResolvedArtifactFiles(await installedRoot(profile, packageRoot), files)
}

/** Read-only verification of a package directory obtained from DSH pluginPackages.
 * Native runtime resolution may select an immutable store outside node_modules.
 * Callers must never pass a browser-provided path. No repair/writes use this seam.
 */
export async function verifyNativeResolvedArtifactFiles(packageRoot: string, files: ReadonlyMap<string, Buffer>): Promise<void> {
  const root = await realpath(packageRoot)
  const queue = [{ directory: root, prefix: '' }]
  let entries = 0
  while (queue.length > 0) {
    const { directory, prefix } = queue.shift()!
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (++entries > MAX_ENTRIES) throw new Error('Workbench installed package has too many entries')
      const path = `${prefix}${entry.name}`
      if (entry.isSymbolicLink() || (!entry.isDirectory() && !entry.isFile())) throw new Error('Workbench installed package has an unsafe entry')
      if (entry.isDirectory()) queue.push({ directory: join(directory, entry.name), prefix: `${path}/` })
      else if (!files.has(path)) throw new Error('Workbench installed package contains an unexpected file')
    }
  }
  for (const [path, bytes] of files) {
    const target = await filePath(root, path, false)
    const stat = await lstat(target)
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== bytes.length
      || createHash('sha256').update(await readFile(target)).digest('hex') !== createHash('sha256').update(bytes).digest('hex')) {
      throw new Error('Installed Workbench Module file bytes do not match the trusted artifact')
    }
  }
}

/** Atomic replacement avoids modifying pnpm's shared hardlinked store bytes. */
export async function repairWorkbenchArtifactFiles(profile: string, packageRoot: string, files: ReadonlyMap<string, Buffer>): Promise<void> {
  const root = await installedRoot(profile, packageRoot)
  for (const [path, bytes] of files) {
    const target = await filePath(root, path, true)
    const stat = await lstat(target).catch(error => { if (error.code !== 'ENOENT') throw error; return undefined })
    if (stat !== undefined && (!stat.isFile() || stat.isSymbolicLink())) throw new Error('Workbench repair target is not an owned regular file')
    if (stat?.size === bytes.length && Buffer.compare(await readFile(target), bytes) === 0) continue
    // Keep temporary files outside the package so an interrupted write cannot
    // become an unexpected runtime file on the next verification.
    const temporary = join(profile, '.dsh-workbench', 'module-repairs-v1', `${randomBytes(16).toString('hex')}.tmp`)
    await mkdir(dirname(temporary), { recursive: true })
    await writeFile(temporary, bytes, { flag: 'wx', mode: 0o600 })
    await rename(temporary, target)
  }
  await verifyWorkbenchArtifactFiles(profile, packageRoot, files)
}
