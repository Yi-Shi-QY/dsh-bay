/**
 * DSH rc.1 keeps one InputShell/editor per Session. Its native Composer cleanup
 * unconditionally detaches that shared editor. A hidden original-mode view can
 * therefore detach a newly mounted Workbench composer. Keep the native editor
 * and draft, while giving each Workbench occurrence a root/readonly lease.
 */
interface NativeEditor {
  getRootElement(): HTMLElement | null
  setRootElement(root: HTMLElement | null): void
  setEditable(editable: boolean): void
  isEditable(): boolean
}
interface Claim { root: HTMLElement | null; editable: boolean; focus: () => void }
interface Ownership {
  editor: NativeEditor
  claims: Set<Claim>
  active?: Claim
  originalRoot: NativeEditor['setRootElement']
  originalEditable: NativeEditor['setEditable']
  rootShim: NativeEditor['setRootElement']
  editableShim: NativeEditor['setEditable']
  nativeRoot: HTMLElement | null
  nativeEditable: boolean
  nativeFocus: () => void
}
const ownership = new WeakMap<NativeEditor, Ownership>()
const owns = (state: Ownership) => state.active?.root?.isConnected === true
function activate(state: Ownership, claim: Claim) {
  if (!claim.root) return
  state.active = claim
  if (state.editor.getRootElement() !== claim.root) state.originalRoot.call(state.editor, claim.root)
  state.originalEditable.call(state.editor, claim.editable)
}
function releaseRoot(state: Ownership, claim: Claim) {
  claim.root?.removeEventListener('focusin', claim.focus)
  claim.root?.removeEventListener('pointerdown', claim.focus)
  claim.root = null
  if (state.active !== claim) return
  delete state.active
  const next = [...state.claims].reverse().find(item => item.root?.isConnected)
  if (next) activate(state, next)
  else {
    state.originalRoot.call(state.editor, state.nativeRoot?.isConnected ? state.nativeRoot : null)
    state.originalEditable.call(state.editor, state.nativeEditable)
  }
}
function editorOwnership(editor: NativeEditor): Ownership {
  const existing = ownership.get(editor)
  if (existing) return existing
  const state: Ownership = {
    editor, claims: new Set(), originalRoot: editor.setRootElement, originalEditable: editor.setEditable,
    nativeRoot: editor.getRootElement(), nativeEditable: editor.isEditable(),
    rootShim(root) {
      state.nativeRoot?.removeEventListener('focusin', state.nativeFocus)
      state.nativeRoot?.removeEventListener('pointerdown', state.nativeFocus)
      state.nativeRoot = root
      root?.addEventListener('focusin', state.nativeFocus)
      root?.addEventListener('pointerdown', state.nativeFocus)
      if (!owns(state)) state.originalRoot.call(editor, root)
    },
    editableShim(editable) {
      state.nativeEditable = editable
      if (!owns(state)) state.originalEditable.call(editor, editable)
    },
    nativeFocus() {
      const root = state.nativeRoot
      if (!root?.isConnected) return
      // Workbench mode keeps its canvas mounted while hidden. Connectivity
      // alone cannot own input: focusing the native occurrence transfers the
      // same editor/draft back, even before the retained canvas is disposed.
      delete state.active
      if (state.editor.getRootElement() !== root) state.originalRoot.call(editor, root)
      state.originalEditable.call(editor, state.nativeEditable)
    },
  }
  state.nativeRoot?.addEventListener('focusin', state.nativeFocus)
  state.nativeRoot?.addEventListener('pointerdown', state.nativeFocus)
  editor.setRootElement = state.rootShim
  editor.setEditable = state.editableShim
  ownership.set(editor, state)
  return state
}

export function createNativeComposerOwnership() {
  const wrappers = new Map<object, { value: unknown; dispose(): void }>()
  return {
    keyboard(input: unknown): unknown {
      if (!input || typeof input !== 'object') return input
      const cached = wrappers.get(input)
      if (cached) return cached.value
      const editor = (input as { editor?: NativeEditor }).editor
      if (!editor || typeof editor.getRootElement !== 'function' || typeof editor.setRootElement !== 'function'
        || typeof editor.setEditable !== 'function' || typeof editor.isEditable !== 'function') return input
      const state = editorOwnership(editor)
      const claim: Claim = { root: null, editable: editor.isEditable(), focus: () => activate(state, claim) }
      state.claims.add(claim)
      const methods = new Map<PropertyKey, unknown>()
      const scopedEditor = new Proxy(editor, {
        get(target, key) {
          if (key === 'setRootElement') return (root: HTMLElement | null) => {
            if (root === null) { releaseRoot(state, claim); return }
            if (claim.root !== root) {
              releaseRoot(state, claim)
              claim.root = root
              root.addEventListener('focusin', claim.focus)
              root.addEventListener('pointerdown', claim.focus)
            }
            activate(state, claim)
          }
          if (key === 'setEditable') return (editable: boolean) => {
            claim.editable = editable
            if (state.active === claim) state.originalEditable.call(target, editable)
          }
          const value = Reflect.get(target, key, target)
          if (typeof value !== 'function') return value
          if (!methods.has(key)) methods.set(key, value.bind(target))
          return methods.get(key)
        },
      })
      const keyboardMethods = new Map<PropertyKey, unknown>()
      const value = new Proxy(input, { get(target, key) {
        if (key === 'editor') return scopedEditor
        const member = Reflect.get(target, key, target)
        if (typeof member !== 'function') return member
        if (!keyboardMethods.has(key)) keyboardMethods.set(key, member.bind(target))
        return keyboardMethods.get(key)
      } })
      wrappers.set(input, { value, dispose() {
        releaseRoot(state, claim)
        state.claims.delete(claim)
        if (!state.claims.size) {
          state.nativeRoot?.removeEventListener('focusin', state.nativeFocus)
          state.nativeRoot?.removeEventListener('pointerdown', state.nativeFocus)
          if (editor.setRootElement === state.rootShim) editor.setRootElement = state.originalRoot
          if (editor.setEditable === state.editableShim) editor.setEditable = state.originalEditable
          ownership.delete(editor)
        }
      } })
      return value
    },
    dispose() { for (const row of wrappers.values()) row.dispose(); wrappers.clear() },
  }
}
