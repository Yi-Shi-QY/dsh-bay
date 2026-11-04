// @vitest-environment jsdom
import React from 'react'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { WorkbenchCoreSettingsSection } from '../src/foundation/WorkbenchCoreSettingsSection.tsx'
import { defaultLayout } from '../src/foundation/model.ts'

afterEach(() => cleanup())

function source<T>(value: T) {
  return { getSnapshot: () => value, subscribe: () => () => {} }
}

function directory() {
  const snapshot = { activeWorkbenchId: undefined, openWorkbenchIds: [], globalHiddenEditorIds: [], rows: [], invalidRows: [], templates: [] }
  const unavailable = async () => ({ status: 'unavailable' as const })
  return {
    getSnapshot: () => snapshot,
    subscribe: () => () => {},
    select: unavailable,
    openAndSelect: unavailable,
    unload: unavailable,
    create: unavailable,
    saveTemplate: unavailable,
    rename: unavailable,
    updateMetadata: unavailable,
    setPinned: unavailable,
    archive: unavailable,
    restore: unavailable,
    remove: unavailable,
    close: unavailable,
  }
}

describe('official DSH settings section', () => {
  it('renders the Core page when mounted by settings.section', () => {
    const settings = {
      status: 'ready' as const,
      value: { version: 4, workbenches: {}, invalidWorkbenches: {}, activeWorkbenchId: '', openWorkbenchIds: [], sessionMarkers: {} },
      revision: 1,
      writable: true,
      mode: 'host' as const,
    }
    const editorCatalog = source([{ id: 'workbench.conversation', label: '对话', scope: 'session' as const }])
    const sessions = { ids: [], byId: {}, current: undefined, phase: 'ready', subagentsByParent: {}, jobsBySession: {} }
    const workspaces = { items: [], archivedSessionIds: [], phase: 'ready' }
    const view = render(<WorkbenchCoreSettingsSection {...{
      close: () => {},
      editorCatalog,
      workbenchDirectory: directory(),
      useWorkbenchSettings: <T,>(select: (value: typeof settings) => T) => select(settings),
      useSessions: <T,>(select: (value: typeof sessions) => T) => select(sessions),
      useWorkspaces: <T,>(select: (value: typeof workspaces) => T) => select(workspaces),
    } as never} />)

    expect(view.container.querySelector('[data-workbench-settings="core"]')).not.toBeNull()
    expect(view.container.textContent).not.toContain('工作台管理')
    expect(view.container.textContent).toContain('内页与扩展')
  })

  it('keeps the injected settings hook count stable when visiting lazy tabs', () => {
    const settings = {
      status: 'ready' as const,
      value: { version: 4, workbenches: {}, invalidWorkbenches: {}, activeWorkbenchId: '', openWorkbenchIds: [], sessionMarkers: {} },
      revision: 1,
      writable: true,
      mode: 'host' as const,
    }
    const view = render(<WorkbenchCoreSettingsSection {...{
      close: () => {},
      editorCatalog: source([]),
      workbenchDirectory: directory(),
      useWorkbenchSettings: <T,>(select: (value: typeof settings) => T) => select(settings),
      useSessions: <T,>(select: (value: { ids: string[]; byId: Record<string, unknown>; current?: string; phase: 'ready'; subagentsByParent: Record<string, unknown>; jobsBySession: Record<string, unknown> }) => T) => select({ ids: [], byId: {}, phase: 'ready', subagentsByParent: {}, jobsBySession: {} }),
      useWorkspaces: <T,>(select: (value: { items: never[]; archivedSessionIds: never[]; phase: 'ready' }) => T) => select({ items: [], archivedSessionIds: [], phase: 'ready' }),
    } as never} />)

    fireEvent.click(view.getByRole('tab', { name: '交互偏好' }))
    expect(view.container.textContent).toContain('此页偏好适用于当前 DSH 实例中的所有工作台。')
    expect(view.container.querySelector('[data-workbench-settings="core"]')).not.toBeNull()
  })
})
