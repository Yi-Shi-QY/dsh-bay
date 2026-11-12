import { afterEach, describe, expect, it, vi } from 'vitest'
import { createFloatingWorkspaceRuntime } from '../src/client/floating-workspace-runtime.ts'
import { connectSharedFloatingWorkspace } from '../src/client/shared-floating-workspace.ts'
import type { TabDocument } from '../src/foundation/model.ts'

function createHost() {
  let floatingPanels: readonly unknown[] = []
  const listeners = new Set<() => void>()
  let snapshot = { collaborationId: 'collab', workbenchId: 'wb', ownerParticipantId: 'owner', sharedCanvas: { floatingPanels } }
  const commands: unknown[] = []
  const client = (participantId: string) => ({
    participantId,
    getState: () => 'connected' as const,
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    command: async (operation: { kind: string; floatingPanels?: readonly unknown[] }) => {
      commands.push(operation)
      floatingPanels = structuredClone(operation.floatingPanels ?? [])
      snapshot = { ...snapshot, sharedCanvas: { floatingPanels } }
      for (const listener of [...listeners]) listener()
      return { ok: true as const, requestId: 'r', workbenchRevision: 0, canvasRevision: 0 }
    },
  })
  return { client, commands, panels: () => floatingPanels }
}

const tab = (id: string, title = id): TabDocument => ({ id, editorId: 'workbench.files', editorScope: 'root', lastKnownTitle: title, state: {} })
const floatingTitles = (runtime: ReturnType<typeof createFloatingWorkspaceRuntime>) =>
  [...runtime.instances.values()].filter(row => row.workbenchId === 'wb' && row.location === 'floating').map(row => row.tab.lastKnownTitle)
const settle = async () => { for (let index = 0; index < 4; index++) { await vi.advanceTimersByTimeAsync(80) } }

afterEach(() => { vi.useRealTimers() })

describe('shared floating workspace', () => {
  it('shares pages, the selected page and expansion between the owner and a participant, but not geometry', async () => {
    vi.useFakeTimers()
    const host = createHost()
    const owner = createFloatingWorkspaceRuntime(), guest = createFloatingWorkspaceRuntime()
    const disconnect = [connectSharedFloatingWorkspace(owner, host.client('owner') as never), connectSharedFloatingWorkspace(guest, host.client('guest') as never)]
    await settle()

    owner.open('wb', tab('files', '文件'))
    await settle()
    expect(floatingTitles(guest)).toEqual(['文件'])
    expect(guest.workspace('wb')).toMatchObject({ expanded: true, activeId: 'files' })

    guest.open('wb', tab('notes', '笔记'))
    await settle()
    expect(floatingTitles(owner)).toEqual(['文件', '笔记'])
    expect(owner.workspace('wb').activeId).toBe('notes')

    guest.patch('wb', { expanded: false })
    await settle()
    expect(owner.workspace('wb').expanded).toBe(false)

    // Window position and size stay on each screen.
    const commandsBefore = host.commands.length
    owner.patch('wb', { rect: { x: 10, y: 20, width: 400, height: 300 } }, true)
    await settle()
    expect(host.commands.length).toBe(commandsBefore)
    expect(guest.workspace('wb').rect).toBeUndefined()

    await guest.close('notes', 'wb')
    await settle()
    expect(floatingTitles(owner)).toEqual(['文件'])
    for (const stop of disconnect) stop()
  })

  it('restores the shared floating workspace into a refreshed page instead of clearing it', async () => {
    vi.useFakeTimers()
    const host = createHost()
    const owner = createFloatingWorkspaceRuntime()
    const stopOwner = connectSharedFloatingWorkspace(owner, host.client('owner') as never)
    await settle()
    owner.open('wb', tab('files', '文件'))
    await settle()

    // A refreshed participant page starts with an empty runtime.
    const refreshed = createFloatingWorkspaceRuntime()
    const stopGuest = connectSharedFloatingWorkspace(refreshed, host.client('guest') as never)
    await settle()
    expect(floatingTitles(refreshed)).toEqual(['文件'])
    expect(floatingTitles(owner)).toEqual(['文件'])
    expect((host.panels()[0] as { tabs: TabDocument[] }).tabs.map(row => row.id)).toEqual(['files'])
    stopOwner(); stopGuest()
  })

  it('lets a joining owner publish its own pages and settles without echoing updates', async () => {
    vi.useFakeTimers()
    const host = createHost()
    const guest = createFloatingWorkspaceRuntime()
    const stopGuest = connectSharedFloatingWorkspace(guest, host.client('guest') as never)
    guest.open('wb', tab('old', '旧内页'))
    await settle()

    const owner = createFloatingWorkspaceRuntime()
    owner.open('wb', tab('desk', '桌面内页'))
    const stopOwner = connectSharedFloatingWorkspace(owner, host.client('owner') as never)
    await settle()
    expect(floatingTitles(guest)).toEqual(['桌面内页'])
    const settled = host.commands.length
    await settle()
    expect(host.commands.length).toBe(settled)
    stopOwner(); stopGuest()
  })
})
