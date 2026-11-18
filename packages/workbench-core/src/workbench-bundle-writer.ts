import { open, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { buildWorkbenchBundle, workbenchBundleFilename, type WorkbenchBundle, type WorkbenchBundleInput } from './workbench-bundle.ts'

export class WorkbenchBundleWriter {
  async build(input: WorkbenchBundleInput): Promise<WorkbenchBundle> { return buildWorkbenchBundle(input) }
  async writeFile(target: string, input: WorkbenchBundleInput): Promise<{ path: string; manifest: WorkbenchBundle['manifest']; bytes: number }> {
    const bundle = await this.build(input)
    const destination = path.resolve(target)
    if (!destination.toLowerCase().endsWith('.dshbay.zip')) throw new Error('工作台包文件名必须以 .dshbay.zip 结尾')
    const temporary = destination + '.staging-' + crypto.randomUUID() + '.tmp'
    await writeFile(temporary, bundle.archive, { flag: 'wx' })
    const handle = await open(temporary, 'r')
    try { await handle.sync() } finally { await handle.close() }
    const backup = destination + '.backup-' + crypto.randomUUID() + '.tmp'
    let movedExisting = false
    try {
      try { await stat(destination); await rename(destination, backup); movedExisting = true } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
      await rename(temporary, destination)
      if (movedExisting) await rm(backup, { force: true }).catch(() => {})
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => {})
      if (movedExisting) {
        await rm(destination, { force: true }).catch(() => {})
        await rename(backup, destination).catch(() => {})
      }
      throw error
    }
    return { path: destination, manifest: bundle.manifest, bytes: bundle.archive.byteLength }
  }
  async writeNamed(directory: string, workbenchName: string, input: WorkbenchBundleInput): Promise<ReturnType<WorkbenchBundleWriter['writeFile']>> {
    return this.writeFile(path.join(directory, workbenchBundleFilename(workbenchName)), input)
  }
}
