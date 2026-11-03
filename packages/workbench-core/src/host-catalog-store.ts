import { createHash, randomBytes } from 'node:crypto'
import { mkdir, readFile, rename, writeFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { importWorkbenchSignedCatalogV1, type WorkbenchSignedCatalogImportOptionsV1 } from './signed-catalog.ts'

const MAX_BYTES = 64 * 1024 * 1024

/** Original signed archives only. Neither installed files nor package names are export sources. */
export function createWorkbenchProfileCatalogStore(profile: string, options: WorkbenchSignedCatalogImportOptionsV1) {
  const root = join(profile, '.dsh-workbench', 'catalog-archives-v1')
  const reference = join(root, 'current.sha256')
  const atomicWrite = async (path: string, bytes: Uint8Array | string) => {
    const temporary = `${path}.${randomBytes(12).toString('hex')}.tmp`
    await writeFile(temporary, bytes, { flag: 'wx', mode: 0o600 })
    await rename(temporary, path)
  }
  const verify = async (bytes: Uint8Array) => {
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_BYTES) throw new Error('Workbench Catalog archive exceeds its size limit')
    return importWorkbenchSignedCatalogV1(bytes, options)
  }
  return {
    async retain(input: Uint8Array): Promise<void> {
      const bytes = new Uint8Array(input)
      await verify(bytes)
      const digest = createHash('sha256').update(bytes).digest('hex')
      await mkdir(root, { recursive: true })
      await atomicWrite(join(root, `${digest}.zip`), bytes)
      await atomicWrite(reference, digest)
    },
    async read() {
      let digest: string
      try { digest = await readFile(reference, 'utf8') }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw new Error('Workbench retained Catalog is unreadable') }
      if (!/^[a-f0-9]{64}$/u.test(digest)) throw new Error('Workbench retained Catalog reference is invalid')
      const path = join(root, `${digest}.zip`)
      try {
        if ((await stat(path)).size > MAX_BYTES) throw new Error('Archive is too large')
        const bytes = new Uint8Array(await readFile(path))
        if (createHash('sha256').update(bytes).digest('hex') !== digest) throw new Error('Archive digest mismatch')
        return { bytes, imported: await verify(bytes) }
      } catch { throw new Error('Workbench retained Catalog verification failed') }
    },
  }
}

export type WorkbenchProfileCatalogStoreV1 = ReturnType<typeof createWorkbenchProfileCatalogStore>
