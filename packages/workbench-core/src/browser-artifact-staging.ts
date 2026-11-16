import type { WorkbenchModuleIdentityV1 } from './module-catalog.ts'

export const WORKBENCH_MODULE_ARTIFACT_STAGE_ROUTE_V1 = '/api/workbench/module-artifact/stage'

export interface WorkbenchCatalogArtifactStagingInputV1 {
  readonly identity: WorkbenchModuleIdentityV1
  readonly packageName: '@dsh-workbench/conversation-suite'
  readonly integrity: string
  readonly tarball: Uint8Array
}

export interface WorkbenchArtifactStageFetchV1 {
  (input: RequestInfo | URL, init?: RequestInit): Promise<Response>
}

function base64(bytes: Uint8Array): string {
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + 0x8000, bytes.length)))
  }
  if (typeof btoa !== 'function') throw new Error('Workbench Host artifact staging requires browser Base64 support')
  return btoa(binary)
}

/**
 * Fixed-origin bridge to the Host staging route. It deliberately takes no
 * endpoint option: a catalog cannot redirect an install toward a registry or
 * arbitrary network URL.
 */
export function createWorkbenchBrowserArtifactStager(fetcher: WorkbenchArtifactStageFetchV1 = fetch): (input: WorkbenchCatalogArtifactStagingInputV1) => Promise<void> {
  return async ({ identity, packageName, integrity, tarball }) => {
    const response = await fetcher(WORKBENCH_MODULE_ARTIFACT_STAGE_ROUTE_V1, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        schemaVersion: 1,
        moduleId: identity.moduleId,
        version: identity.version,
        artifactDigest: identity.artifactDigest,
        packageName,
        integrity,
        tarballBase64: base64(tarball),
      }),
    })
    if (response.ok) return
    let message = `Workbench Host artifact staging failed (${response.status})`
    try {
      const value = await response.json() as { error?: unknown }
      if (typeof value.error === 'string' && value.error.trim() !== '') message = value.error
    } catch { /* retain a non-sensitive HTTP failure */ }
    throw new Error(message)
  }
}
