import { afterEach, expect, it } from 'vitest'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { HostWorkbenchMemory } from '../src/host-workbench-memory.ts'
import type { WorkbenchMemoryWrite } from '../src/workbench-memory-contract.ts'

const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })
async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'bay-memory-')); roots.push(root)
  return { root, service: new HostWorkbenchMemory(() => root) }
}
const input: WorkbenchMemoryWrite = { id: 'decision-a', requestId: 'request-a', expectedRevision: 0, title: 'Project scope', summary: 'Confirmed scope',
  body: 'Original decision', source: { kind: 'user', reference: 'decision-42', description: 'Confirmed by user' }, verification: 'verified', environmentDependent: true }
it('keeps sourced immutable history, idempotent writes, conflicts and tombstones across reopen', async () => {
  const f = await setup()
  expect(f.service.write('wb', input, 'human').status).toBe('committed')
  expect(f.service.write('wb', input, 'human').status).toBe('committed')
  expect(f.service.write('wb', { ...input, requestId: 'other' }, 'human')).toEqual({ status: 'conflict', actualRevision: 1 })
  f.service.write('wb', { ...input, expectedRevision: 1, requestId: 'second', body: 'Updated', removed: true }, 'human')
  const reopened = new HostWorkbenchMemory(() => f.root)
  expect(reopened.list('wb')).toEqual([])
  expect(reopened.read('wb', input.id, 1).body).toBe('Original decision')
  expect(reopened.read('wb', input.id).entry.removed).toBe(true)
  expect(await readFile(join(f.root, '.dshbay', 'memory', 'entries', input.id, '2.md'), 'utf8')).toBe('Updated')
})
it('limits worker claims and prompt size, and revalidates machine-dependent memories after import', async () => {
  const f = await setup()
  expect(() => f.service.write('wb', input, 'worker')).toThrow('待核验')
  f.service.write('wb', input, 'human')
  f.service.markEnvironmentForRevalidation('wb')
  expect(f.service.read('wb', input.id).entry.verification).toBe('needs-revalidation')
  expect(f.service.read('wb', input.id, 1).entry.verification).toBe('verified')
  expect(f.service.projection('wb', undefined, 100).length).toBeLessThanOrEqual(100)
  expect(f.service.projection('wb')).toContain('decision-42')
})
