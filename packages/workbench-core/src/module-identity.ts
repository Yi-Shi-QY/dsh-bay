import type { WorkbenchModuleIdentityV1 } from './module-catalog.ts'
import { WORKBENCH_SUITE_VERSION } from './release-compatibility.ts'

export const WORKBENCH_MODULE_IDENTITY_ROUTE_V1 = '/api/workbench/module-identity/v1'

/** Read only the identity that Core verified during this Host startup. */
export async function readWorkbenchVerifiedModuleIdentity(
  fetcher: typeof fetch = fetch,
): Promise<WorkbenchModuleIdentityV1 | undefined> {
  try {
    const response = await fetcher(WORKBENCH_MODULE_IDENTITY_ROUTE_V1, {
      method: 'GET', credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(10_000),
    })
    if (!response.ok) return undefined
    const body: unknown = await response.json()
    if (typeof body !== 'object' || body === null || !('schemaVersion' in body) || body.schemaVersion !== 1
      || !('identity' in body) || typeof body.identity !== 'object' || body.identity === null) return undefined
    const identity = body.identity
    if (!('moduleId' in identity) || identity.moduleId !== 'workbench.conversation-suite'
      || !('version' in identity) || identity.version !== WORKBENCH_SUITE_VERSION
      || !('artifactDigest' in identity) || typeof identity.artifactDigest !== 'string'
      || !/^[a-f0-9]{64}$/u.test(identity.artifactDigest)) return undefined
    return { moduleId: identity.moduleId, version: identity.version, artifactDigest: identity.artifactDigest }
  } catch { return undefined }
}
