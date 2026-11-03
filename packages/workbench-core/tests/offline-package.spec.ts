import { describe, expect, it } from 'vitest'
import { ZipWriter, Uint8ArrayReader, Uint8ArrayWriter } from '@zip.js/zip.js/lib/zip-core-native.js'
import { buildWorkbenchOfflinePackage, inspectWorkbenchOfflinePackage, offlineSha256, projectWorkbenchOfflineLayout } from '../src/offline-package.ts'
import { readWorkbenchOfflineArchive, writeWorkbenchOfflineArchive } from '../src/offline-archive.ts'
import { canonicalizeWorkbenchCatalogJsonV1 } from '../src/signed-catalog.ts'
import { validateWorkbenchDocumentV3 } from '../src/foundation/document-v3.ts'

import { catalogOptions, record, fixture } from './offline-fixture.ts'

describe('Workbench offline package', () => {
  it('strips both the frozen draft field and the early new-generation alias without transferring either', () => {
    const input = record()
    if (input.document.root.kind !== 'split' || input.document.root.first.kind !== 'area') throw new Error('Invalid test layout')
    const page = input.document.root.first.moduleHistory[0]!
    page.state = { draft: 'candidate-private-draft', workbenchConversationDraft: 'frozen-private-draft' }
    const result = JSON.stringify(projectWorkbenchOfflineLayout(input))
    expect(result).not.toContain('candidate-private-draft')
    expect(result).not.toContain('frozen-private-draft')
    page.state = { draft: { unsupported: true } }
    expect(() => projectWorkbenchOfflineLayout(input)).toThrow('portable contract')
  })

  it('exports reproducible bytes, preserves topology and preferences, strips local data and retains original artifacts', async () => {
    const input = await fixture(), first = await buildWorkbenchOfflinePackage(input), second = await buildWorkbenchOfflinePackage(input)
    expect(first.archive).toEqual(second.archive)
    const imported = await inspectWorkbenchOfflinePackage(first.archive, catalogOptions)
    expect(imported.packageId).toBe(first.packageId)
    expect(imported.catalogArchive).toEqual(input.catalogArchive)
    expect(imported.manifest.modules).toHaveLength(1)
    expect(imported.layout.hiddenEditorIds).toEqual(['workbench.conversation'])
    expect(imported.layout.document.root).toMatchObject({ kind: 'split', ratio: 0.35, second: { kind: 'split', ratio: 0.6 } })
    // Native Start creates a recipient-local Session; only bound Areas share a placeholder.
    expect(imported.layout.bindings).toHaveLength(1)
    expect(imported.layout.bindings[0]?.areaIds).toEqual(['area-2', 'area-3'])
    expect(validateWorkbenchDocumentV3(imported.layout.document)).toBeUndefined()
    expect(validateWorkbenchDocumentV3(imported.layout.document, { allowDetachedSession: true })).toBeDefined()
    const output = JSON.stringify({ manifest: imported.manifest, layout: imported.layout })
    for (const forbidden of ['private-', 'local-area-', 'local-page-', 'author-workbench-id', 'draft body', 'transcript title', 'windowId', 'sessionId', 'workspaceId']) expect(output).not.toContain(forbidden)
  })

  it('blocks absent artifacts, missing verified ownership and revoked modules', async () => {
    const input = await fixture()
    await expect(buildWorkbenchOfflinePackage({ record: input.record, editorModules: input.editorModules })).rejects.toThrow('trusted artifact')
    await expect(buildWorkbenchOfflinePackage({ ...input, editorModules: new Map() })).rejects.toThrow('trusted artifact')
    await expect(buildWorkbenchOfflinePackage(await fixture(true))).rejects.toThrow('trusted artifact')
  })

  it('blocks unknown inner-page state and local paths in workbench metadata', () => {
    const input = record()
    input.description = 'C:/Users/author/private-project'
    expect(() => projectWorkbenchOfflineLayout(input)).toThrow('portable text')
    input.description = 'Shared'
    if (input.document.root.kind !== 'split' || input.document.root.first.kind !== 'area') throw new Error('Invalid test layout')
    input.document.root.first.moduleHistory[0]!.state = { privateExtension: { path: 'local' } }
    expect(() => projectWorkbenchOfflineLayout(input)).toThrow('portable contract')
  })

  it('rejects missing entries, extra fields, tampered layout, unsupported Core and undeclared bindings', async () => {
    const built = await buildWorkbenchOfflinePackage(await fixture())
    const original = await readWorkbenchOfflineArchive(built.archive)
    for (const change of ['missing-catalog', 'extra-entry', 'layout-tamper', 'core-version', 'binding-extra']) {
      const files = new Map(original)
      if (change === 'missing-catalog') files.delete(built.manifest.catalog!.path)
      if (change === 'extra-entry') files.set('extra.txt', new Uint8Array([1]))
      if (change === 'core-version') files.set('manifest.json', canonicalizeWorkbenchCatalogJsonV1({ ...built.manifest, core: { ...built.manifest.core, version: '9.0.0' } }))
      if (change === 'layout-tamper') files.set('workbench.json', canonicalizeWorkbenchCatalogJsonV1({ ...built.layout, name: 'tampered' }))
      if (change === 'binding-extra') {
        const layout = { ...built.layout, bindings: built.layout.bindings.map(binding => ({ ...binding, sessionId: 'private' })) }
        const bytes = canonicalizeWorkbenchCatalogJsonV1(layout)
        files.set('workbench.json', bytes)
        files.set('manifest.json', canonicalizeWorkbenchCatalogJsonV1({ ...built.manifest, layout: { path: 'workbench.json', sha256: await offlineSha256(bytes) } }))
      }
      await expect(inspectWorkbenchOfflinePackage(await writeWorkbenchOfflineArchive(files), catalogOptions)).rejects.toThrow()
    }
  })

  it('supports a genuinely empty Core-only workbench without fabricating a Module dependency', async () => {
    const input = record()
    input.hiddenEditorIds = []
    input.document = { version: 3, root: { kind: 'area', areaId: 'empty', moduleHistory: [] }, activeAreaId: 'empty' }
    const built = await buildWorkbenchOfflinePackage({ record: input, editorModules: new Map() })
    const result = await inspectWorkbenchOfflinePackage(built.archive)
    expect(result.manifest.modules).toEqual([])
    expect(result.catalogArchive).toBeUndefined()
    expect(result.layout.bindings).toEqual([])
  })

  it('rejects symbolic links and unsafe archive paths through structured ZIP metadata', async () => {
    for (const { name, attributes } of [{ name: '../outside', attributes: 0 }, { name: 'link', attributes: 0xa1ff0000 }, { name: 'WorkBench.json', attributes: 0 }]) {
      const writer = new ZipWriter(new Uint8ArrayWriter(), { level: 0, dataDescriptor: false })
      await writer.add(name, new Uint8ArrayReader(new Uint8Array([1])), { useWebWorkers: false, externalFileAttributes: attributes, msDosCompatible: false })
      await expect(readWorkbenchOfflineArchive(await writer.close())).rejects.toThrow('Unsafe')
    }
  })

  it('rejects duplicate central entries and declared oversized payloads before decoding', async () => {
    const bytes = await writeWorkbenchOfflineArchive(new Map([['a.txt', new Uint8Array([1])], ['b.txt', new Uint8Array([2])]]))
    const corrupted = new Uint8Array(bytes), name = new TextEncoder().encode('b.txt')
    for (let offset = 0; offset <= corrupted.length - name.length; offset++) {
      if (name.every((value, index) => corrupted[offset + index] === value)) corrupted[offset] = 'a'.charCodeAt(0)
    }
    await expect(readWorkbenchOfflineArchive(corrupted)).rejects.toThrow('duplicate')
    const writer = new ZipWriter(new Uint8ArrayWriter(), { level: 0, passThrough: true, dataDescriptor: false })
    await writer.add('oversize.bin', new Uint8ArrayReader(new Uint8Array([1])), { useWebWorkers: false, uncompressedSize: 65 * 1024 * 1024, signature: 0 })
    await expect(readWorkbenchOfflineArchive(await writer.close())).rejects.toThrow('limits')
  })
})
