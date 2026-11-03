import { WORKBENCH_TEAM_TRUST_ROOT_V1 } from '../src/signed-catalog.ts'
import { WORKBENCH_CORE_VERSION, WORKBENCH_SUITE_VERSION, WORKBENCH_DSH_GENERATION, WORKBENCH_UPSTREAM_COMMIT } from '../src/release-compatibility.ts'
import { canonicalizeWorkbenchCatalogJsonV1 } from '../src/signed-catalog.ts'
import { WORKBENCH_CONVERSATION_PAGE_METADATA } from '../src/conversation-page-metadata.ts'
import type { WorkbenchRecordV2 } from '../src/foundation/persistence.ts'
import { offlineSha256 } from '../src/offline-package.ts'
import { writeWorkbenchOfflineArchive } from '../src/offline-archive.ts'
export const catalogOptions = { verifier: { verify: async () => true }, verifiedSeams: [], allowedPermissions: ['dsh.conversation.render'] }

export function record(): WorkbenchRecordV2 {
  const area = (index: number) => {
    const page = WORKBENCH_CONVERSATION_PAGE_METADATA[index]!
    return { kind: 'area' as const, areaId: `local-area-${index}`, activeModuleInstanceId: `local-page-${index}`, moduleHistory: [{
      moduleInstanceId: `local-page-${index}`, editorId: page.id, editorScope: page.scope,
      ...(index === 0 ? {} : { binding: { workspaceId: 'private-workspace-id', sessionId: 'private-session-id' } }),
      state: index === 1 ? { workbenchConversationDraft: 'private draft body' } : {}, lastKnownTitle: 'private transcript title',
    }] }
  }
  return { workbenchId: 'author-workbench-id', name: 'Shared layout', description: 'Team example', tags: ['team'], createdAt: 100, updatedAt: 200,
    hiddenEditorIds: ['workbench.conversation'], document: { version: 3, activeAreaId: 'local-area-0', root: { kind: 'split', id: 'local-split-a', axis: 'horizontal', ratio: 0.35,
      first: area(0), second: { kind: 'split', id: 'local-split-b', axis: 'vertical', ratio: 0.6, first: area(1), second: area(2) } } } }
}

export async function fixture(revoked = false) {
  const artifact = new Uint8Array([1, 2, 3, 4]), digest = await offlineSha256(artifact)
  const identity = { moduleId: 'workbench.conversation-suite', version: WORKBENCH_SUITE_VERSION, artifactDigest: digest }
  const sha512 = new Uint8Array(await crypto.subtle.digest('SHA-512', artifact))
  const integrity = `sha512-${Buffer.from(sha512).toString('base64')}`
  const entry = { moduleId: identity.moduleId, packageName: '@dsh-workbench/conversation-suite', version: identity.version,
    artifact: { locator: `artifacts/${digest}.tgz`, sha256: digest, integrity, size: artifact.length },
    dshGeneration: WORKBENCH_DSH_GENERATION, requiredCapabilities: [], permissions: ['dsh.conversation.render'],
    provenance: { upstreamCommit: WORKBENCH_UPSTREAM_COMMIT, sourceDigest: 'a'.repeat(64), patchDigest: 'b'.repeat(64) },
    publisherKeyId: WORKBENCH_TEAM_TRUST_ROOT_V1.keyId, revoked,
    manifest: { coreCompatibility: WORKBENCH_CORE_VERSION, editorIds: WORKBENCH_CONVERSATION_PAGE_METADATA.map(page => page.id), scope: 'area' } }
  const catalog = { schemaVersion: 1, kind: 'dsh-workbench-team-catalog', catalogId: 'offline-test-catalog',
    compatibility: { dshGeneration: WORKBENCH_DSH_GENERATION, upstreamCommit: entry.provenance.upstreamCommit, requiredSeams: [] }, entries: [entry] }
  const catalogArchive = await writeWorkbenchOfflineArchive(new Map([
    ['catalog.json', canonicalizeWorkbenchCatalogJsonV1(catalog)], ['catalog.sig', new TextEncoder().encode('AQ==')], [entry.artifact.locator, artifact],
  ]))
  return { record: record(), editorModules: new Map(WORKBENCH_CONVERSATION_PAGE_METADATA.map(page => [page.id, identity])), catalogArchive, catalogOptions }
}
