// DSH 0.2.2-rc.1 upstream commit: 66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db
window.__ModuleLoader__.load({
  id: '@local/workbench-editor-example',
  factory(require) {
    // The owner object is supplied by Workbench Core. It is the only source
    // of Area, Workspace and Session identity for this editor instance.
    function createEditor(React) {
      const h = React.createElement
      function Editor(owner) {
        // For real asynchronous data loading, return owner.renderLoading?.({
        //   label: '示例内页', compact: false,
        // }) while pending. Keep errors and empty results as separate states.
        // This example persists edits immediately. Editors with unsaved local
        // drafts must return false (or ask to save/discard) from this guard.
        React.useEffect(() => owner.registerCloseGuard?.(() => true), [owner.registerCloseGuard])
        const binding = owner.sessionId === undefined
          ? '等待绑定 Session'
          : `Session ${owner.sessionId}`
        return h('section', {
          style: { display: 'grid', gap: 8, padding: 16, minHeight: '100%', color: 'inherit' },
          'data-workbench-editor-example': true,
        },
        h('h2', { style: { margin: 0 } }, 'Workbench 内页示例'),
        h('p', { style: { margin: 0, opacity: 0.75 } }, binding),
        h('p', { style: { margin: 0, opacity: 0.75 } }, owner.workspaceId === undefined
          ? '当前没有工作区绑定。'
          : `Workspace ${owner.workspaceId}`),
        h('button', {
          type: 'button',
          onClick: () => owner.setState({ schemaVersion: 1, acknowledged: true }),
        }, '记录本机状态'))
      }
      return Editor
    }

    const declaration = {
      editorId: 'workbench.example',
      scope: 'root',
      label: '示例内页',
      requiredBinding: 'none',
      presentation: { floating: true },
      binding: { requirement: 'none', unbound: 'available', sharing: 'none' },
      state: { schemaVersion: 1, maxBytes: 16 * 1024, restore: 'if-valid', share: 'portable' },
      runtime: { background: 'pause', collapsed: 'dispose', reacquire: 'on-visible' },
    }
    const extension = {
      schemaVersion: 1,
      moduleId: 'workbench.editor-example',
      apiVersion: 1,
      editorIds: ['workbench.example'],
      coreCompatibility: '0.2.2-alpha.18.0',
      dshGeneration: '0.2.2-rc.1',
    }

    return {
      // DSH's SlotCore uses the active Cordis Fiber name as the default
      // registrant. Keep it equal to package.json.name so Workbench Core can
      // map the Slot contribution to pluginInventory/listBundles exactly.
      name: '@local/workbench-editor-example',
      inject: ['slots', 'modules'],
      async apply(ctx) {
        const React = await ctx.modules.import('react', '', {})
        const Editor = createEditor(React)
        ctx.slots.inject('workbench.editor.root', () => ctx.slots.register({
          name: 'workbench.editor.root',
          id: 'workbench.example',
          label: '示例内页',
          order: 500,
          // Keep the Slot owner explicit as well as the Cordis plugin name.
          // Core verifies this value against DSH's live inventory.
          registrant: '@local/workbench-editor-example',
          // DSH SlotCore drops unknown option fields. Core metadata must travel
          // through the preserved inject face instead.
          inject: () => ({ workbenchEditor: {
            schemaVersion: 1,
            declaration,
            extension,
            distribution: { version: 1, portableId: 'workbench.editor-example', packageVersion: '0.1.0', packageName: '@local/workbench-editor-example', exportPolicy: 'embed', sourcePolicy: 'binary-only', provides: { editorIds: ['workbench.example'] }, requires: [], permissions: [] },
            portability: { version: 1, exportState: value => ({ schemaVersion: 1, acknowledged: value?.acknowledged === true }), importState: value => { if (value?.schemaVersion !== 1) throw new Error('Unsupported portable state'); return { schemaVersion: 1, acknowledged: value.acknowledged === true } } },
            // Supply editor-specific 24×24 path geometry, tested at 16/20/24px.
            // Core owns stroke, theme and SVG elements; never pass raw SVG markup or URLs.
            // Replace this example's notebook glyph with your editor's own semantic icon.
            presentation: { iconSvg: { version: 1, paths: [
              'M7 3h12a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z',
              'M3 7h4M3 12h4M3 17h4M10 8h7M10 12h7M10 16h4',
            ] } },
          } }),
        }, Editor))
      },
    }
  },
})
