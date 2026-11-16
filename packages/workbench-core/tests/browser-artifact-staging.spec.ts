import { describe, expect, it, vi } from 'vitest'
import { createWorkbenchBrowserArtifactStager, WORKBENCH_MODULE_ARTIFACT_STAGE_ROUTE_V1 } from '../src/browser-artifact-staging.ts'

const identity = {
  moduleId: 'workbench.conversation-suite',
  version: '0.1.5-alpha.2',
  artifactDigest: 'a'.repeat(64),
} as const
const integrity = `sha512-${'A'.repeat(86)}`

describe('fixed Workbench Host artifact staging bridge', () => {
  it('posts only exact immutable catalog facts to the fixed same-origin route', async () => {
    const fetcher = vi.fn(async () => new Response('{}', { status: 200 }))
    await createWorkbenchBrowserArtifactStager(fetcher)({
      identity, packageName: '@dsh-workbench/conversation-suite', integrity, tarball: new Uint8Array([1, 2, 3]),
    })
    expect(fetcher).toHaveBeenCalledWith(WORKBENCH_MODULE_ARTIFACT_STAGE_ROUTE_V1, expect.objectContaining({
      method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' },
    }))
    const payload = JSON.parse((fetcher.mock.calls[0]?.[1] as RequestInit).body as string)
    expect(payload).toEqual({
      schemaVersion: 1, ...identity, packageName: '@dsh-workbench/conversation-suite', integrity, tarballBase64: 'AQID',
    })
    expect(JSON.stringify(payload)).not.toContain('http')
    expect(JSON.stringify(payload)).not.toContain('registry')
  })

  it('does not continue on a Host staging failure', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ error: 'digest mismatch' }), { status: 400 }))
    await expect(createWorkbenchBrowserArtifactStager(fetcher)({
      identity, packageName: '@dsh-workbench/conversation-suite', integrity, tarball: new Uint8Array([1]),
    })).rejects.toThrow('digest mismatch')
  })
})
