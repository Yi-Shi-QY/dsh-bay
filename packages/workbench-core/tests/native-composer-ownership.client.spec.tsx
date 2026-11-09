// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useLayoutEffect, useRef } from 'react'
import { createNativeComposerOwnership } from '../src/client/native-composer-ownership.ts'

afterEach(cleanup)

/** The public InputShell/editor boundary used by the locked rc.1 Composer. */
function nativeShell() {
  let root: HTMLElement | null = null, editable = true
  const submitted: string[] = []
  const shell = { draft: '', editor: {
    getRootElement: () => root,
    isEditable: () => editable,
    setRootElement(next: HTMLElement | null) {
      root?.removeEventListener('input', input)
      root = next
      root?.addEventListener('input', input)
      if (root) { root.textContent = shell.draft; root.contentEditable = String(editable) }
    },
    setEditable(value: boolean) { editable = value; if (root) root.contentEditable = String(value) },
  }, submit() { submitted.push(this.draft); this.draft = ''; if (root) root.textContent = '' } }
  function input() { if (editable && root) shell.draft = root.textContent ?? '' }
  return { shell, submitted }
}

function Composer({ shell, name }: { shell: ReturnType<typeof nativeShell>['shell']; name: string }) {
  const root = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => { shell.editor.setRootElement(root.current); return () => shell.editor.setRootElement(null) }, [shell.editor])
  useLayoutEffect(() => { shell.editor.setEditable(true) }, [shell.editor])
  return <section><div ref={root} role="textbox" aria-label={name} contentEditable suppressContentEditableWarning /><button onClick={() => shell.submit()}>send {name}</button></section>
}

it('keeps actual input and submit connected after original-mode delayed cleanup', () => {
  const { shell, submitted } = nativeShell()
  const adapter = createNativeComposerOwnership()
  const workbench = adapter.keyboard(shell) as typeof shell
  const original = render(<Composer shell={shell} name="original" />)
  render(<Composer shell={workbench} name="workbench" />)
  const root = screen.getByRole('textbox', { name: 'workbench' })
  original.unmount() // rc.1 cleanup calls the same native editor.setRootElement(null)
  shell.editor.setEditable(false) // hidden original surface's final readonly update
  expect(shell.editor.getRootElement()).toBe(root)
  expect(shell.editor.isEditable()).toBe(true)
  root.textContent = 'after returning to Workbench'
  fireEvent.input(root)
  fireEvent.click(screen.getByRole('button', { name: 'send workbench' }))
  expect(submitted).toEqual(['after returning to Workbench'])
  expect(shell.draft).toBe('')
  cleanup(); adapter.dispose()
})

it('returns the same Session draft to original mode and reacquires it on the next Workbench visit', () => {
  const { shell, submitted } = nativeShell()
  const originalRoot = document.createElement('div'); document.body.append(originalRoot)
  const setRootElement = shell.editor.setRootElement
  shell.editor.setRootElement(originalRoot)
  for (const value of ['first visit', 'second visit']) {
    const adapter = createNativeComposerOwnership(), view = render(<Composer shell={adapter.keyboard(shell) as typeof shell} name="workbench" />)
    const root = screen.getByRole('textbox')
    root.textContent = value; fireEvent.input(root)
    view.unmount(); adapter.dispose()
    expect(shell.editor.getRootElement()).toBe(originalRoot)
    expect(shell.editor.setRootElement).toBe(setRootElement)
    expect(shell.draft).toBe(value)
    shell.submit()
  }
  expect(submitted).toEqual(['first visit', 'second visit'])
  originalRoot.remove()
})

it('allows two views of one Session to focus without the inactive view detaching the active root', () => {
  const { shell, submitted } = nativeShell()
  const firstAdapter = createNativeComposerOwnership(), secondAdapter = createNativeComposerOwnership()
  const first = render(<Composer shell={firstAdapter.keyboard(shell) as typeof shell} name="first" />)
  render(<Composer shell={secondAdapter.keyboard(shell) as typeof shell} name="second" />)
  const second = screen.getByRole('textbox', { name: 'second' })
  fireEvent.pointerDown(screen.getByRole('textbox', { name: 'first' }))
  expect(shell.editor.getRootElement()).toBe(screen.getByRole('textbox', { name: 'first' }))
  fireEvent.pointerDown(second)
  first.unmount(); firstAdapter.dispose()
  expect(shell.editor.getRootElement()).toBe(second)
  second.textContent = 'second view'; fireEvent.input(second)
  fireEvent.click(screen.getByRole('button', { name: 'send second' }))
  expect(submitted).toEqual(['second view'])
  cleanup(); secondAdapter.dispose()
})

it('transfers a retained but hidden Workbench editor to original mode on focus and back', () => {
  const { shell, submitted } = nativeShell(), adapter = createNativeComposerOwnership()
  const workbench = render(<Composer shell={adapter.keyboard(shell) as typeof shell} name="workbench" />)
  workbench.container.style.display = 'none' // mode exit retains the existing canvas
  const original = render(<Composer shell={shell} name="original" />)
  const originalRoot = screen.getByRole('textbox', { name: 'original' })
  fireEvent.focusIn(originalRoot)
  originalRoot.textContent = 'original mode'; fireEvent.input(originalRoot)
  expect(shell.draft).toBe('original mode')
  fireEvent.click(screen.getByRole('button', { name: 'send original' }))
  expect(submitted).toEqual(['original mode'])
  original.container.style.display = 'none'
  workbench.container.style.display = ''
  const workbenchRoot = screen.getByRole('textbox', { name: 'workbench' })
  fireEvent.focusIn(workbenchRoot)
  workbenchRoot.textContent = 'return to Workbench'; fireEvent.input(workbenchRoot)
  original.unmount()
  expect(shell.editor.getRootElement()).toBe(workbenchRoot)
  fireEvent.click(screen.getByRole('button', { name: 'send workbench' }))
  expect(submitted).toEqual(['original mode', 'return to Workbench'])
  cleanup(); adapter.dispose()
})

it('keeps absent or unsupported native keyboards unchanged', () => {
  const adapter = createNativeComposerOwnership(), value = { submit: vi.fn() }
  expect(adapter.keyboard(undefined)).toBeUndefined()
  expect(adapter.keyboard(value)).toBe(value)
  adapter.dispose()
})
