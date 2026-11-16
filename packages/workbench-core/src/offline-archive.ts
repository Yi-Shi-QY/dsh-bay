import { ZipReader, ZipWriter, Uint8ArrayReader, Uint8ArrayWriter } from '@zip.js/zip.js/lib/zip-core-native.js'

const MAX_BYTES = 72 * 1024 * 1024
const MAX_FILE = 64 * 1024 * 1024
const MAX_ENTRIES = 16

function safePath(path: string): boolean {
  return /^[a-z0-9][a-z0-9._/-]{0,199}$/u.test(path)
    && !path.split('/').some(part => part === '' || part === '.' || part === '..')
}

/** zip.js owns ZIP parsing; policy checks run before any payload is decoded. */
export async function readWorkbenchOfflineArchive(bytes: Uint8Array): Promise<ReadonlyMap<string, Uint8Array>> {
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_BYTES) throw new Error('Offline archive size is unsupported')
  const reader = new ZipReader(new Uint8ArrayReader(bytes), { useWebWorkers: false, checkSignature: true })
  try {
    const entries = []
    for await (const entry of reader.getEntriesGenerator()) {
      if (entries.length >= MAX_ENTRIES) throw new Error('Offline archive has too many entries')
      entries.push(entry)
    }
    const seen = new Set<string>()
    let declaredSize = 0
    for (const entry of entries) {
      const mode = (entry.externalFileAttributes >>> 16) & 0xf000
      if (!safePath(entry.filename) || seen.has(entry.filename) || entry.directory || entry.encrypted
        || (mode !== 0 && mode !== 0x8000)) throw new Error('Unsafe or duplicate offline archive entry')
      seen.add(entry.filename)
      declaredSize += entry.uncompressedSize
      if (!Number.isSafeInteger(entry.uncompressedSize) || entry.uncompressedSize > MAX_FILE || declaredSize > MAX_BYTES) throw new Error('Offline archive payload exceeds limits')
    }
    const files = new Map<string, Uint8Array>()
    let total = 0
    for (const entry of entries) {
      if (entry.directory) throw new Error('Offline archive directories are unsupported')
      const chunks: Uint8Array[] = []
      let size = 0
      await entry.getData(new WritableStream<Uint8Array>({ write(chunk) {
        size += chunk.byteLength; total += chunk.byteLength
        if (size > MAX_FILE || total > MAX_BYTES || size > entry.uncompressedSize) throw new Error('Offline archive expansion exceeds limits')
        chunks.push(new Uint8Array(chunk))
      } }), { useWebWorkers: false, checkSignature: true })
      if (size !== entry.uncompressedSize) throw new Error('Offline archive size mismatch')
      const content = new Uint8Array(size)
      let offset = 0
      for (const chunk of chunks) { content.set(chunk, offset); offset += chunk.byteLength }
      files.set(entry.filename, content)
    }
    return files
  } finally { await reader.close() }
}

export async function writeWorkbenchOfflineArchive(files: ReadonlyMap<string, Uint8Array>): Promise<Uint8Array> {
  const writer = new ZipWriter(new Uint8ArrayWriter(), { level: 0,
    lastModDate: new Date(1980, 0, 1), extendedTimestamp: false, dataDescriptor: false, zip64: false,
    msDosCompatible: true, externalFileAttributes: 0 })
  for (const [name, bytes] of [...files].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)) {
    if (!safePath(name) || bytes.byteLength > MAX_FILE) throw new Error('Invalid offline archive output')
    await writer.add(name, new Uint8ArrayReader(bytes), { useWebWorkers: false })
  }
  const bytes = await writer.close()
  await readWorkbenchOfflineArchive(bytes)
  return bytes
}
