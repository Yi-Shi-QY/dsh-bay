import { describe, expect, it, vi } from 'vitest'
import { retainWorkbenchTerminalTab, workbenchTerminalControllerTabId } from '../src/client/native-terminal-retention.ts'

function makeContext() {
  let official: readonly { sessionId: string; tabId: string; contentId: string; kind: string }[] = []
  let listener: (() => void) | undefined
  const retainTabs = vi.fn()
  const services = {
    sidebarRight: {
      openTabs: {
        getSnapshot: () => official,
        subscribe: (next: () => void) => {
          listener = next
          return () => { if (listener === next) listener = undefined }
        },
      },
    },
    webTerminals: { retainTabs },
  }
  const ctx = {
    get(name: string) {
      return services[name as keyof typeof services]
    },
  } as never
  return {
    ctx,
    retainTabs,
    setOfficial(next: typeof official) {
      official = next
      listener?.()
    },
  }
}

describe('Workbench terminal retention coordinator', () => {
  it('merges official Sidebar tabs with every Workbench Area occurrence', () => {
    const host = makeContext()
    host.setOfficial([{ sessionId: 'official-session', tabId: 'official-tab', contentId: 'official', kind: 'terminal' }])
    const releaseA = retainWorkbenchTerminalTab(host.ctx, { instanceId: 'area-a', sessionId: 'session-a', contentId: 'terminal:a' })
    const releaseB = retainWorkbenchTerminalTab(host.ctx, { instanceId: 'area-b', sessionId: 'session-b', contentId: 'terminal:b' })

    expect(host.retainTabs).toHaveBeenLastCalledWith([
      { sessionId: 'official-session', tabId: 'official-tab', contentId: 'official' },
      { sessionId: 'session-a', tabId: 'area-a', contentId: 'terminal:a' },
      { sessionId: 'session-b', tabId: 'area-b', contentId: 'terminal:b' },
    ])

    releaseA()
    expect(host.retainTabs).toHaveBeenLastCalledWith([
      { sessionId: 'official-session', tabId: 'official-tab', contentId: 'official' },
      { sessionId: 'session-b', tabId: 'area-b', contentId: 'terminal:b' },
    ])
    releaseB()
    expect(host.retainTabs).toHaveBeenLastCalledWith([
      { sessionId: 'official-session', tabId: 'official-tab', contentId: 'official' },
    ])
  })

  it('retains the DSH-facing identity for a replaced Terminal occurrence', () => {
    const host = makeContext()
    const firstId = workbenchTerminalControllerTabId('tab-a', 'workbench://terminal/first')
    const secondId = workbenchTerminalControllerTabId('tab-a', 'workbench://terminal/second')
    const releaseFirst = retainWorkbenchTerminalTab(host.ctx, {
      instanceId: 'tab-a', tabId: firstId, sessionId: 'session-a', contentId: 'workbench://terminal/first',
    })
    expect(host.retainTabs).toHaveBeenLastCalledWith([{
      sessionId: 'session-a', tabId: firstId, contentId: 'workbench://terminal/first',
    }])

    const releaseSecond = retainWorkbenchTerminalTab(host.ctx, {
      instanceId: 'tab-a', tabId: secondId, sessionId: 'session-a', contentId: 'workbench://terminal/second',
    })
    expect(host.retainTabs).toHaveBeenLastCalledWith([{
      sessionId: 'session-a', tabId: secondId, contentId: 'workbench://terminal/second',
    }])

    releaseFirst()
    expect(host.retainTabs).toHaveBeenLastCalledWith([{
      sessionId: 'session-a', tabId: secondId, contentId: 'workbench://terminal/second',
    }])
    releaseSecond()
    expect(host.retainTabs).toHaveBeenLastCalledWith([])
  })

  it('refreshes the projection when the official Sidebar membership changes', () => {
    const host = makeContext()
    const release = retainWorkbenchTerminalTab(host.ctx, { instanceId: 'area-a', sessionId: 'session-a', contentId: 'terminal:a' })
    host.setOfficial([
      { sessionId: 'official-session', tabId: 'official-tab', contentId: 'official', kind: 'terminal' },
      { sessionId: 'official-session', tabId: 'files-tab', contentId: 'files', kind: 'files' },
    ])
    expect(host.retainTabs).toHaveBeenLastCalledWith([
      { sessionId: 'official-session', tabId: 'official-tab', contentId: 'official' },
      { sessionId: 'session-a', tabId: 'area-a', contentId: 'terminal:a' },
    ])
    release()
  })

  it('does not retain stale Workbench tabs after the last Area releases', () => {
    const host = makeContext()
    const release = retainWorkbenchTerminalTab(host.ctx, { instanceId: 'area-a', sessionId: 'session-a', contentId: 'terminal:a' })
    release()
    const calls = host.retainTabs.mock.calls.length
    host.setOfficial([{ sessionId: 'official-session', tabId: 'official-tab', contentId: 'official', kind: 'terminal' }])
    expect(host.retainTabs.mock.calls.length).toBe(calls)
  })

  it('never reads undeclared Cordis services as context properties', () => {
    const host = makeContext()
    const guarded = new Proxy(host.ctx as object, {
      get(target, property, receiver) {
        if (property === 'sidebarRight' || property === 'webTerminals') {
          throw new Error(`undeclared property read: ${String(property)}`)
        }
        return Reflect.get(target, property, receiver)
      },
    }) as never

    expect(() => retainWorkbenchTerminalTab(guarded, {
      instanceId: 'area-a', sessionId: 'session-a', contentId: 'terminal:a',
    })).not.toThrow()
  })

  it('preserves the native webTerminals receiver when retaining tabs', () => {
    const calls: unknown[][] = []
    const service = {
      openTabs: 'native-controller-state',
      retainTabs(this: { openTabs: string }, tabs: readonly unknown[]) {
        expect(this.openTabs).toBe('native-controller-state')
        calls.push([...tabs])
      },
    }
    const ctx = {
      get(name: string) {
        if (name === 'sidebarRight') return { openTabs: { getSnapshot: () => [], subscribe: () => () => {} } }
        if (name === 'webTerminals') return service
        return undefined
      },
    } as never

    expect(() => retainWorkbenchTerminalTab(ctx, {
      instanceId: 'area-a', sessionId: 'session-a', contentId: 'terminal:a',
    })).not.toThrow()
    expect(calls).toHaveLength(2)
  })
})
