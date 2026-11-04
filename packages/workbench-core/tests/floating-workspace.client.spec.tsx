// @vitest-environment jsdom
import { useEffect, useState } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { createFloatingWorkspaceRuntime, clampFloatingRect } from '../src/client/floating-workspace-runtime.ts'
import { FloatingWorkspaceContext, FloatingInstanceHost, RetainedEditorTarget, FloatingWorkspaceUnread } from '../src/foundation/FloatingWorkspaceContext.tsx'
import type { TabDocument } from '../src/foundation/model.ts'
import { createFloatingEditorTab } from '../src/foundation/editor-selection.ts'
import type { WorkbenchEditorCatalogRow } from '../src/foundation/catalog.ts'

afterEach(cleanup)
const tab = (id = 'temporary'): TabDocument => ({ id, editorId: 'test.editor', editorScope: 'root', lastKnownTitle: id, state: {} })
it('honors a root editor binding contract without creating a Session', () => {
  const editor: WorkbenchEditorCatalogRow = { id: 'root.bound', label: 'Bound root', scope: 'root', declaration: {
    editorId: 'root.bound', label: 'Bound root', scope: 'root', requiredBinding: 'workspace',
    binding: { requirement: 'workspace', unbound: 'pending', sharing: 'independent' },
    state: { schemaVersion: 1, maxBytes: 1024, restore: 'if-valid', share: 'portable' },
    runtime: { background: 'keep', collapsed: 'keep', reacquire: 'on-visible' },
  } }
  expect(createFloatingEditorTab(editor, 'one').pendingBinding).toBe('one')
  expect(createFloatingEditorTab(editor, 'one', { sessionId: 'missing-workspace' }).pendingBinding).toBe('one')
  const bound = createFloatingEditorTab(editor, 'one', { sessionId: 'session', workspaceId: 'workspace' })
  expect(bound.editorScope).toBe('root'); expect(bound.binding).toEqual({ sessionId: 'session', workspaceId: 'workspace' })
  expect(bound.pendingBinding).toBeUndefined()
})
it('retains React state and the DOM identity when moving from floating to an Area', async () => {
  const runtime = createFloatingWorkspaceRuntime(), mounts = vi.fn(), unmounts = vi.fn()
  runtime.open('one', tab())
  function Content() {
    const [value, setValue] = useState(0)
    useEffect(() => { mounts(); return unmounts }, [])
    return <button onClick={() => setValue(value + 1)}>value {value}</button>
  }
  function App({ area, hidden = false }: { area: boolean; hidden?: boolean }) {
    return <FloatingWorkspaceContext.Provider value={runtime}>
      <section data-testid="floating" style={{ display: hidden ? 'none' : undefined }}>{!area && <RetainedEditorTarget id="temporary"><Content /></RetainedEditorTarget>}</section>
      <section data-testid="area">{area && <RetainedEditorTarget id="temporary"><Content /></RetainedEditorTarget>}</section>
      <FloatingInstanceHost runtime={runtime} />
    </FloatingWorkspaceContext.Provider>
  }
  const view = render(<App area={false} />)
  const button = screen.getByRole('button'); fireEvent.click(button)
  view.rerender(<App area={false} hidden />)
  view.rerender(<App area />)
  expect(screen.getByRole('button')).toBe(button)
  expect(button.textContent).toBe('value 1')
  expect(mounts).toHaveBeenCalledTimes(1); expect(unmounts).not.toHaveBeenCalled()
  await act(() => runtime.close('temporary'))
  expect(unmounts).toHaveBeenCalledTimes(1)
})
it('keeps the temporary instance on conflict and serializes pin/close', async () => {
  const runtime = createFloatingWorkspaceRuntime(); runtime.open('one', tab())
  let resolve!: (ok: boolean) => void
  const commit = vi.fn(() => new Promise<boolean>(done => { resolve = done }))
  const saving = runtime.transfer('temporary', commit)
  expect(await runtime.close('temporary')).toBe(false)
  expect(await runtime.transfer('temporary', commit)).toBe(false)
  resolve(false); expect(await saving).toBe(false)
  expect(runtime.find('temporary')?.location).toBe('floating')
  expect(await runtime.transfer('temporary', async () => true)).toBe(true)
  expect(runtime.find('temporary')?.location).toBe('area')
})
it('respects close guards and persists geometry only after gestures finish', async () => {
  const runtime = createFloatingWorkspaceRuntime(), save = vi.fn()
  runtime.configureGeometry(() => ({}), save); runtime.open('one', tab())
  runtime.registerCloseGuard('temporary', () => false)
  expect(await runtime.close('temporary')).toBe(false)
  expect(await runtime.guardWorkbench('one')).toBe(false)
  runtime.patch('one', { rect: { x: 1, y: 2, width: 720, height: 480 } })
  expect(save).not.toHaveBeenCalled()
  runtime.patch('one', {}, true)
  expect(save).toHaveBeenCalledWith('one', { rect: { x: 1, y: 2, width: 720, height: 480 } })
  runtime.setSurface(false); runtime.setSurface(true, 'two')
  expect(!!runtime.find('temporary')).toBe(true)
})
it('rejects old mode generations and does not guess a different workbench', () => {
  const runtime = createFloatingWorkspaceRuntime(), route = vi.fn(() => true)
  runtime.routes.set('one', route); runtime.setSurface(true, 'one')
  const old = runtime.epoch; runtime.setSurface(false); runtime.setSurface(true, 'two')
  expect(runtime.route?.({ workbenchId: 'one', kind: 'file', options: { sourceEpoch: old } })).toBe(false)
  expect(runtime.route?.({ workbenchId: 'missing', kind: 'file' })).toBe(false)
  expect(route).not.toHaveBeenCalled()
})
it('fits small content rectangles and clamps all edges', () => {
  expect(clampFloatingRect({ x: 900, y: -100, width: 720, height: 480 }, 250, 180)).toEqual({ x: 0, y: 0, width: 250, height: 180 })
})
it('rejects removed sources, old placements, changed bindings and lost control', () => {
  const runtime = createFloatingWorkspaceRuntime(), route = vi.fn(() => true)
  runtime.setSurface(true, 'one'); runtime.routes.set('one', route)
  const input = { workbenchId: 'one', kind: 'file', sourceId: 'temporary', options: { sourceLocationGeneration: 0, sourceGeneration: 0 } }
  expect(runtime.route?.(input)).toBe(false)
  runtime.open('one', tab()); expect(runtime.route?.(input)).toBe(true)
  runtime.find('temporary')!.generation++
  expect(runtime.route?.(input)).toBe(false)
  runtime.hasControl = () => false
  expect(runtime.route?.({ ...input, options: {} })).toBe(false)
})
it('serializes asynchronous close guards without discarding editor state', async () => {
  const runtime = createFloatingWorkspaceRuntime(); runtime.open('one', tab())
  let finish!: (ok: boolean) => void
  runtime.registerCloseGuard('temporary', () => new Promise(done => { finish = done }))
  const close = runtime.close('temporary')
  expect(await runtime.close('temporary')).toBe(false)
  expect(await runtime.transfer('temporary', async () => true)).toBe(false)
  runtime.update('temporary', { ...tab(), state: { changed: true } })
  expect(runtime.find('temporary')?.tab.state).toEqual({ changed: true })
  finish(false); expect(await close).toBe(false)
  expect(!!runtime.find('temporary')).toBe(true)
})

it('isolates identical layout tab IDs by workbench, including guards and cleanup', async () => {
  const runtime = createFloatingWorkspaceRuntime(), cleanup = vi.fn(), one = vi.fn(() => true), two = vi.fn(() => true)
  runtime.setCleanup(cleanup)
  runtime.open('one', tab()); runtime.open('two', tab())
  expect(runtime.instances.size).toBe(2)
  expect(runtime.find('temporary')).toBeUndefined()
  runtime.update('temporary', { ...tab(), state: { owner: 'one' } }, 'one')
  expect(runtime.find('temporary', 'two')?.tab.state).toEqual({})
  runtime.registerCloseGuard('temporary', () => false, 'one')
  expect(await runtime.close('temporary', 'one')).toBe(false)
  runtime.routes.set('one', one); runtime.routes.set('two', two); runtime.setSurface(true, 'two')
  expect(runtime.route?.({ workbenchId: 'two', sourceId: 'temporary', kind: 'file' })).toBe(true)
  expect(one).not.toHaveBeenCalled(); expect(two).toHaveBeenCalledOnce()
  expect(await runtime.close('temporary', 'two')).toBe(true)
  expect(cleanup).toHaveBeenCalledWith(JSON.stringify(['two', 'temporary']))
  expect(runtime.find('temporary', 'one')).toBeDefined()
})

it('retains late controller state while pinning and on a failed commit', async () => {
  const runtime = createFloatingWorkspaceRuntime(); runtime.open('one', tab())
  let finish!: (ok: boolean) => void
  const pending = runtime.transfer('temporary', () => new Promise(done => { finish = done }), 'one')
  runtime.update('temporary', { ...tab(), state: { output: 'late' } }, 'one')
  finish(false); expect(await pending).toBe(false)
  expect(runtime.find('temporary', 'one')?.tab.state).toEqual({ output: 'late' })
})
it('queues background direct-Area events without switching workbenches and drops stale epochs', () => {
  const runtime = createFloatingWorkspaceRuntime(), route = vi.fn(() => true)
  runtime.retain('one', tab()); runtime.routes.set('one', route); runtime.setSurface(true, 'two')
  const input = { workbenchId: 'one', sourceId: 'temporary', kind: 'plan', options: { trigger: 'automatic', eventId: 'review-1', sourceEpoch: runtime.epoch } }
  expect(runtime.route?.(input)).toBe(true); expect(runtime.route?.(input)).toBe(true)
  expect(runtime.pendingAreaRoutes.size).toBe(1); expect(route).not.toHaveBeenCalled()
  expect(runtime.visibleWorkbenchId).toBe('two'); expect(runtime.find('temporary')?.unread).toBe(true)
  runtime.setSurface(false); expect(runtime.pendingAreaRoutes.size).toBe(0)
})

it('preserves hidden Area state until the normal layout save accepts it', () => {
  const runtime = createFloatingWorkspaceRuntime(); runtime.retain('one', tab())
  runtime.updateState('temporary', { draft: 'background output' }, 'one')
  runtime.retain('one', tab())
  expect(runtime.find('temporary', 'one')?.tab.state).toEqual({ draft: 'background output' })
  expect(runtime.find('temporary', 'one')?.pendingState).toBe(true)
  runtime.retain('one', { ...tab(), bindingGeneration: 1 })
  expect(runtime.find('temporary', 'one')?.pendingState).toBe(false)
})

it('does not apply a background session event to the foreground Area', () => {
  const runtime = createFloatingWorkspaceRuntime(), route = vi.fn(() => true)
  runtime.setSurface(true, 'one'); runtime.routes.set('one', route)
  runtime.focusedWorkbenchId = 'one'; runtime.focusedBinding = { sessionId: 'active' }
  runtime.retain('one', { ...tab(), sessionId: 'background', binding: { sessionId: 'background' } })
  expect(runtime.route?.({ workbenchId: 'one', sourceId: 'temporary', binding: { sessionId: 'background' }, kind: 'plan', options: { trigger: 'automatic' } })).toBe(true)
  expect(route).not.toHaveBeenCalled(); expect(runtime.pendingAreaRoutes.size).toBe(1)
})

it('serializes session creation and rejects a completion after leaving the source', async () => {
  const runtime = createFloatingWorkspaceRuntime(); runtime.open('one', tab()); runtime.setSurface(true, 'one')
  let finish!: (value: { sessionId: string }) => void
  const create = vi.fn(() => new Promise<{ sessionId: string }>(resolve => { finish = resolve }))
  const pending = runtime.prepareConversation('temporary', 'one', create)
  await expect(runtime.prepareConversation('temporary', 'one', create)).rejects.toThrow('当前无法')
  expect(create).toHaveBeenCalledOnce()
  runtime.setSurface(false); runtime.setSurface(true, 'one')
  finish({ sessionId: 'late-session' })
  await expect(pending).rejects.toThrow('已改变')
  expect(runtime.find('temporary', 'one')?.tab.sessionId).toBeUndefined()
  expect(runtime.find('temporary', 'one')?.busy).toBe(false)
  await expect(runtime.prepareConversation('temporary', 'one', async () => ({ sessionId: 'current' }))).resolves.toEqual({ sessionId: 'current' })
  expect(runtime.find('temporary', 'one')?.tab.bindingGeneration).toBe(1)
})

it('rejects session completion after control is revoked without changing the instance', async () => {
  const runtime = createFloatingWorkspaceRuntime(); runtime.open('one', tab()); runtime.setSurface(true, 'one')
  const create = async () => { runtime.hasControl = () => false; return { sessionId: 'late' } }
  await expect(runtime.prepareConversation('temporary', 'one', create)).rejects.toThrow('已改变')
  expect(runtime.find('temporary', 'one')?.tab).toEqual(tab())
})

it('shows background updates for the owning workbench even on Home', () => {
  const runtime = createFloatingWorkspaceRuntime()
  render(<FloatingWorkspaceContext.Provider value={runtime}><FloatingWorkspaceUnread workbenchId="one" /><FloatingWorkspaceUnread workbenchId="two" /></FloatingWorkspaceContext.Provider>)
  expect(screen.queryByRole('status')).toBeNull()
  act(() => { runtime.open('one', tab(), true, false); runtime.setSurface(true) })
  expect(screen.getAllByRole('status')).toHaveLength(1)
  act(() => { runtime.find('temporary', 'one')!.unread = false; runtime.invalidate() })
  expect(screen.queryByRole('status')).toBeNull()
})
