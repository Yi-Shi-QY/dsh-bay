// DSH 0.2.1-rc.5 upstream commit: b830ec950faba0a46dda564be3e2d854afed94f1
window.__ModuleLoader__.load({
  id: '@local/workbench-editor-example',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    // The owner object is supplied by Workbench Core. It is the only source
    // of Area, Workspace and Session identity for this editor instance.
    function Editor(owner) {
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
        onClick: () => owner.setState({ acknowledged: true }),
      }, '记录本机状态'))
    }

    const declaration = {
      editorId: 'workbench.example',
      scope: 'root',
      label: '示例内页',
      requiredBinding: 'none',
      binding: { requirement: 'none', unbound: 'available', sharing: 'none' },
      state: { schemaVersion: 1, maxBytes: 16 * 1024, restore: 'if-valid', share: 'portable' },
      runtime: { background: 'pause', collapsed: 'dispose', reacquire: 'on-visible' },
    }
    const extension = {
      schemaVersion: 1,
      moduleId: 'workbench.editor-example',
      apiVersion: 1,
      editorIds: ['workbench.example'],
      coreCompatibility: '0.2.2-alpha.17',
      dshGeneration: '0.2.1-rc.5',
    }

    return {
      // DSH's SlotCore uses the active Cordis Fiber name as the default
      // registrant. Keep it equal to package.json.name so Workbench Core can
      // map the Slot contribution to pluginInventory/listBundles exactly.
      name: '@local/workbench-editor-example',
      inject: ['slots'],
      apply(ctx) {
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
            // Use one of Workbench Core's stable semantic icon tokens. The
            // same glyph appears in tabs, page menus, collapsed previews and settings.
            presentation: { icon: 'extension' },
          } }),
        }, Editor))
      },
    }
  },
})
