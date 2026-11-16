import { describe, expect, it, vi } from 'vitest'
import { createWorkbenchNativeTabOccurrence } from '../src/client/native-tab-occurrence.ts'

describe('Workbench Area-local native tab occurrence', () => {
  it('updates navigation without replacing the occurrence', () => {
    const occurrence = createWorkbenchNativeTabOccurrence({
      sessionId: 'session-a', areaId: 'area-a', instanceId: 'tab-a', kind: 'browser', contentId: 'browser:a', title: 'Browser A',
    })
    const first = occurrence.read()
    occurrence.update({ contentId: 'browser:b', title: 'Browser B', params: { url: 'https://example.com' } })
    const second = occurrence.read()
    expect(second.tab.id).toBe(first.tab.id)
    expect(second.tab.signal).toBe(first.tab.signal)
    expect(second.tab.contentId).toBe('browser:b')
    expect(second.tab.title).toBe('Browser B')
    expect(second.tab.navigation).toMatchObject({ address: 'browser:b', params: { url: 'https://example.com' }, revision: 1 })
    occurrence.dispose()
  })

  it('does not replace the occurrence when focus or visibility changes', () => {
    const occurrence = createWorkbenchNativeTabOccurrence({
      sessionId: 'session-a', areaId: 'area-a', instanceId: 'tab-a', kind: 'terminal', contentId: 'terminal:a', title: 'Terminal A',
    })
    const signal = occurrence.signal
    occurrence.setVisible(false)
    occurrence.setFocused(false)
    expect(occurrence.read().tab.signal).toBe(signal)
    expect(occurrence.read().tab.visible).toBe(false)
    expect((occurrence.read().tab as unknown as { focused: boolean }).focused).toBe(false)
    occurrence.dispose()
  })

  it('gives an explicitly replaced Terminal a new DSH identity while keeping the Workbench occurrence', () => {
    const occurrence = createWorkbenchNativeTabOccurrence({
      sessionId: 'session-a', areaId: 'area-a', instanceId: 'tab-a', kind: 'terminal',
      contentId: 'workbench://terminal/first', title: 'Terminal',
    })
    const first = occurrence.read().tab
    occurrence.update({ contentId: 'workbench://terminal/second' })
    const second = occurrence.read().tab

    expect(second.id).not.toBe(first.id)
    expect(second.contentId).toBe('workbench://terminal/second')
    expect(second.navigation.revision).toBe(1)
    expect(second.signal).toBe(first.signal)
    occurrence.dispose()
  })

  it('keeps non-Terminal native tab identity stable when its content navigation changes', () => {
    const occurrence = createWorkbenchNativeTabOccurrence({
      sessionId: 'session-a', areaId: 'area-a', instanceId: 'tab-a', kind: 'browser',
      contentId: 'browser:first', title: 'Browser',
    })
    const firstId = occurrence.read().tab.id
    occurrence.update({ contentId: 'browser:second' })
    expect(occurrence.read().tab.id).toBe(firstId)
    occurrence.dispose()
  })

  it('publishes native tab-info changes and the effective refresh shortcut', () => {
    const shortcut = {
      id: 'page.refresh' as never,
      label: 'Refresh', aliases: [], keys: ['Ctrl+R'], aria: 'Control+R', binding: null,
    }
    const occurrence = createWorkbenchNativeTabOccurrence({
      sessionId: 'session-a', areaId: 'area-a', instanceId: 'tab-a', kind: 'files', contentId: 'files:a', title: 'Files A',
      refreshShortcut: shortcut,
    })
    const listener = vi.fn()
    const unsubscribe = occurrence.subscribe(listener)
    const first = occurrence.read()
    occurrence.setVisible(false)
    expect(listener).toHaveBeenCalledTimes(1)
    expect(occurrence.read()).not.toBe(first)
    expect(occurrence.read().tab.visible).toBe(false)
    occurrence.setRefreshShortcut(undefined)
    expect(listener).toHaveBeenCalledTimes(2)
    expect(occurrence.read().tab.refreshShortcut).toBeUndefined()
    unsubscribe()
    occurrence.setFocused(false)
    expect(listener).toHaveBeenCalledTimes(2)
    occurrence.dispose()
  })

  it('keeps tab actions and abort signals isolated per Area', () => {
    const firstOpen = vi.fn()
    const secondOpen = vi.fn()
    const first = createWorkbenchNativeTabOccurrence({
      sessionId: 'session-a', areaId: 'area-a', instanceId: 'tab-a', kind: 'browser', contentId: 'browser:a', title: 'A',
      onOpenTab: firstOpen,
    })
    const second = createWorkbenchNativeTabOccurrence({
      sessionId: 'session-a', areaId: 'area-b', instanceId: 'tab-b', kind: 'browser', contentId: 'browser:b', title: 'B',
      onOpenTab: secondOpen,
    })

    first.read().tab.actions.openTab('browser', { params: { url: 'https://a.example' } })
    expect(firstOpen).toHaveBeenCalledTimes(1)
    expect(secondOpen).not.toHaveBeenCalled()
    expect(first.read().tab.id).not.toBe(second.read().tab.id)
    expect(first.signal).not.toBe(second.signal)
    first.dispose()
    expect(first.signal.aborted).toBe(true)
    expect(second.signal.aborted).toBe(false)
    second.read().tab.actions.openTab('browser', { params: { url: 'https://b.example' } })
    expect(secondOpen).toHaveBeenCalledTimes(1)
  })

  it('does not let an old command disposer remove a newer command', () => {
    const occurrence = createWorkbenchNativeTabOccurrence({
      sessionId: 'session-a', areaId: 'area-a', instanceId: 'tab-a', kind: 'files', contentId: 'files', title: 'Files',
    })
    const refreshA = vi.fn()
    const refreshB = vi.fn()
    const releaseA = occurrence.read().tab.actions.bindCommands({ refresh: refreshA })
    const releaseB = occurrence.read().tab.actions.bindCommands({ refresh: refreshB })
    releaseA()
    // The current command remains owned by B, so a stale cleanup from A must
    // not remove the command that the still-mounted native body registered.
    occurrence.refresh()
    expect(refreshB).toHaveBeenCalledTimes(1)
    expect(refreshA).not.toHaveBeenCalled()
    releaseB()
    occurrence.refresh()
    occurrence.dispose()
    expect(occurrence.signal.aborted).toBe(true)
    expect(refreshA).not.toHaveBeenCalled()
    expect(refreshB).toHaveBeenCalledTimes(1)
  })

  it('increments navigation revisions without changing tab identity', () => {
    const occurrence = createWorkbenchNativeTabOccurrence({
      sessionId: 'session-a', areaId: 'area-a', instanceId: 'tab-a', kind: 'browser', contentId: 'browser:a', title: 'A',
    })
    expect(occurrence.read().tab.navigation.revision).toBe(0)
    occurrence.navigate('https://example.com', { url: 'https://example.com' })
    expect(occurrence.read().tab.navigation).toMatchObject({ address: 'https://example.com', revision: 1 })
    expect(occurrence.read().tab.id).toBe('tab-a')
    occurrence.dispose()
    occurrence.navigate('https://ignored.example')
    expect(occurrence.read().tab.navigation.revision).toBe(1)
  })

  it('does not invoke a stale refresh command after the occurrence is disposed', () => {
    const refresh = vi.fn()
    const occurrence = createWorkbenchNativeTabOccurrence({
      sessionId: 'session-a', areaId: 'area-a', instanceId: 'tab-a', kind: 'files', contentId: 'files:a', title: 'Files',
    })
    occurrence.read().tab.actions.bindCommands({ refresh })
    occurrence.dispose()
    occurrence.refresh()
    expect(refresh).not.toHaveBeenCalled()
  })
})
