import { describe, expect, it } from 'vitest'
import { createWorkbenchInstallTransactionJournal, createWorkbenchStorageTransactionJournal } from '../src/transaction-journal.ts'
import { createWorkbenchHostModuleInstallAdapter } from '../src/host-adapter.ts'

const digest = 'a'.repeat(64)

describe('Workbench Core transaction journal', () => {
  it('persists restart-required journal rows through the Host storage shape', () => {
    let raw: string | null = null
    const storage = { getItem: () => raw, setItem: (_key: string, value: string) => { raw = value }, removeItem: () => { raw = null } }
    const journal = createWorkbenchStorageTransactionJournal(storage)
    const snapshot = { transactionId: 'tx-storage', planId: 'plan', state: 'restart-required' as const, stagedModules: ['workbench.conversation-suite'], installedModules: ['workbench.conversation-suite'], activatedModules: [] }
    journal.save({ transactionId: snapshot.transactionId, snapshot, modules: [{ moduleId: 'workbench.conversation-suite', version: '1.0.0', artifactDigest: digest }], installTargets: [{ moduleId: 'workbench.conversation-suite', version: '1.0.0', artifactDigest: digest }], installCompleted: true, updatedAt: '2026-09-05T00:00:00.000Z' })
    expect(raw).toContain('restart-required')
    expect(createWorkbenchStorageTransactionJournal(storage).get('tx-storage')?.snapshot.state).toBe('restart-required')
  })

  it('rejects a malformed persisted snapshot', () => {
    const storage = { getItem: () => JSON.stringify([{ transactionId: 'tx-tampered', snapshot: { transactionId: 'tx-tampered', planId: 'plan', state: 'restart-required', stagedModules: [], installedModules: [42], activatedModules: [] }, updatedAt: '2026-09-05T00:00:00.000Z' }]), setItem: () => {}, removeItem: () => {} }
    expect(() => createWorkbenchStorageTransactionJournal(storage)).toThrow('Invalid Workbench transaction journal snapshot')
  })

  it('bridges the public Host verifier without exposing Profile authority to Modules', async () => {
    const calls: string[] = []
    const host = {
      capabilities: () => ['sessions.scope'],
      invoke: async () => ({}),
      stageModule: async (input: { moduleId: string; artifact: Uint8Array }) => { calls.push(`stage:${input.moduleId}:${input.artifact.byteLength}`) },
      installModule: async (input: { moduleId: string }) => { calls.push(`install:${input.moduleId}`) },
      verifyModule: async (input: { moduleId: string }) => { calls.push(`verify:${input.moduleId}`) },
      activateModule: async (id: string) => { calls.push(`activate:${id}`) },
      rollbackModule: async (id: string) => { calls.push(`rollback:${id}`) },
      createRecipientBinding: async () => ({ bindingId: 'recipient' }),
      readReceipts: async () => [],
    }
    const adapter = createWorkbenchHostModuleInstallAdapter(host, { installed: () => undefined, artifact: async () => new Uint8Array([1, 2, 3]) })
    const identity = { moduleId: 'workbench.conversation-suite', version: '1.0.0', artifactDigest: digest }
    await adapter.stage(identity)
    await adapter.install(identity)
    await adapter.verify(identity)
    expect(calls).toEqual(['stage:workbench.conversation-suite:3', 'install:workbench.conversation-suite', 'verify:workbench.conversation-suite'])
  })

  it('stores a complete record in the in-memory implementation', () => {
    const journal = createWorkbenchInstallTransactionJournal()
    const snapshot = { transactionId: 'tx-memory', planId: 'plan', state: 'staged' as const, stagedModules: [], installedModules: [], activatedModules: [] }
    journal.save({ transactionId: snapshot.transactionId, snapshot, updatedAt: '2026-09-05T00:00:00.000Z' })
    expect(journal.list()).toHaveLength(1)
    expect(journal.get('tx-memory')).toMatchObject({ snapshot: { state: 'staged' } })
  })
})
