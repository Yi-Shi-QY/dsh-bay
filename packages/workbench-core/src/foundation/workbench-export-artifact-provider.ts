import type { WorkbenchDependencyArtifactInfoV1 } from './workbench-distribution.ts'
import { sha256Hex, sha512Integrity } from './workbench-sharing.ts'

export interface WorkbenchExportArtifactProviderDependencyV1 {
  readonly portableId: string
  readonly packageName: string
  readonly version: string
  readonly digest: string
  readonly editorIds?: readonly string[]
  readonly clientEntry?: string
  readonly hostEntry?: string
  readonly permissions?: readonly string[]
  readonly sourcePolicy?: 'source-included' | 'binary-only' | 'remote'
}

export interface WorkbenchExportArtifactProviderV1 {
  prepare(input: { readonly dependencies: readonly WorkbenchExportArtifactProviderDependencyV1[] }): Promise<{
    readonly artifacts: readonly WorkbenchDependencyArtifactInfoV1[]
    readonly npmArtifacts: readonly {
      readonly portableId: string
      readonly digest: string
      readonly integrity: string
      readonly tarball: Uint8Array
    }[]
  }>
}

interface HostResponseV1 {
  schemaVersion: 1
  artifacts: readonly {
    portableId: string
    packageName: string
    version: string
    digest: string
    integrity: string
    tarballBase64: string
    clientFiles: readonly { path: string; contentBase64: string }[]
  }[]
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

function validResponse(value: unknown): value is HostResponseV1 {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const row = value as Record<string, unknown>
  return row.schemaVersion === 1 && Array.isArray(row.artifacts)
}

/** Client adapter for the Workbench-owned Host export route. */
export function createWorkbenchHttpExportArtifactProvider(
  fetcher: typeof fetch = globalThis.fetch.bind(globalThis),
  endpoint = '/api/workbench/distribution/export',
): WorkbenchExportArtifactProviderV1 {
  return {
    prepare: async input => {
      const response = await fetcher(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ schemaVersion: 1, dependencies: input.dependencies }),
      })
      let decoded: unknown
      try { decoded = await response.json() } catch { throw new Error(`Workbench Host export returned invalid JSON (${response.status})`) }
      if (!response.ok || !validResponse(decoded)) {
        const reason = typeof decoded === 'object' && decoded !== null && typeof (decoded as Record<string, unknown>).error === 'string'
          ? String((decoded as Record<string, unknown>).error) : `HTTP ${response.status}`
        throw new Error(`Workbench npm artifact preparation failed: ${reason}`)
      }
      const artifacts: WorkbenchDependencyArtifactInfoV1[] = []
      const npmArtifacts: { portableId: string; digest: string; integrity: string; tarball: Uint8Array }[] = []
      for (const item of decoded.artifacts) {
        if (typeof item.portableId !== 'string' || typeof item.version !== 'string' || typeof item.digest !== 'string'
          || !/^[a-f0-9]{64}$/iu.test(item.digest) || typeof item.integrity !== 'string'
          || !Array.isArray(item.clientFiles) || typeof item.tarballBase64 !== 'string') {
          throw new Error('Workbench Host export returned an invalid artifact')
        }
        const tarball = decodeBase64(item.tarballBase64)
        if (await sha512Integrity(tarball) !== item.integrity) throw new Error(`npm artifact integrity mismatch: ${item.portableId}`)
        const files = item.clientFiles.map(file => ({ path: file.path, content: decodeBase64(file.contentBase64) }))
        if (await sha256Hex(files[0]?.content ?? new Uint8Array()) !== item.digest.toUpperCase()) {
          throw new Error(`Client artifact digest mismatch: ${item.portableId}`)
        }
        const request = input.dependencies.find(dependency => dependency.portableId === item.portableId)
        artifacts.push({
          digest: item.digest,
          availability: 'embedded',
          files,
          record: {
            digest: item.digest,
            portableId: item.portableId,
            version: item.version,
            editorIds: [...(request?.editorIds ?? [])],
            sourcePolicy: request?.sourcePolicy ?? 'binary-only',
            permissions: [...(request?.permissions ?? [])],
            ...(request?.clientEntry === undefined ? {} : { clientEntry: request.clientEntry }),
            ...(request?.hostEntry === undefined ? {} : { hostEntry: request.hostEntry }),
            size: files.reduce((total, file) => total + file.content.byteLength, 0),
          },
        })
        npmArtifacts.push({ portableId: item.portableId, digest: item.digest, integrity: item.integrity, tarball })
      }
      return { artifacts, npmArtifacts }
    },
  }
}
