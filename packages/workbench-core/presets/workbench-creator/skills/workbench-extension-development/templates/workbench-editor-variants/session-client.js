// DSH 0.2.2-rc.1 upstream commit: 66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db
// Drop-in variant for a Workbench Area editor that follows one exact Session.
// Copy this file over client.js after updating package.json and cordis.patch.yml.
window.__ModuleLoader__.load({
  id: '@local/workbench-editor-example',
  factory(require) {
    function createEditor(React) {
      const h = React.createElement
      function Editor(owner) {
        React.useEffect(() => owner.registerCloseGuard?.(() => true), [owner.registerCloseGuard])
        if (owner.sessionId === undefined) {
          return h('section', { style: { padding: 16, color: 'inherit' }, 'data-workbench-editor-example': true },
            h('h2', { style: { margin: 0 } }, '等待绑定对话'),
            h('p', { style: { opacity: 0.75 } }, '这个内页需要当前区域中的一个具体对话。请从区域内页菜单选择或新建对话。'))
        }
        return h('section', {
          style: { display: 'grid', gap: 8, padding: 16, minHeight: '100%', color: 'inherit' },
          'data-workbench-editor-example': true,
        },
        h('h2', { style: { margin: 0 } }, 'Session 内页示例'),
        h('p', { style: { margin: 0, opacity: 0.75 } }, `Workspace ${owner.workspaceId ?? '未知'}`),
        h('p', { style: { margin: 0, opacity: 0.75 } }, `Session ${owner.sessionId}`),
        h('p', { style: { margin: 0, opacity: 0.75 } }, `实例 ${owner.runtimeIdentity ?? owner.instanceId}`),
        h('button', {
          type: 'button',
          onClick: () => owner.setState({ schemaVersion: 1, acknowledged: true }),
        }, '记录本机状态'))
      }
      return Editor
    }

    const declaration = {
      editorId: 'workbench.example',
      scope: 'session',
      label: 'Session 内页示例',
      requiredBinding: 'session',
      presentation: { floating: false },
      binding: { requirement: 'session', unbound: 'pending', sharing: 'independent' },
      state: { schemaVersion: 1, maxBytes: 16 * 1024, restore: 'if-valid', share: 'portable' },
      runtime: { background: 'pause', collapsed: 'dispose', reacquire: 'on-visible' },
    }
    const extension = {
      schemaVersion: 1,
      moduleId: 'workbench.editor-example',
      apiVersion: 1,
      editorIds: ['workbench.example'],
      coreCompatibility: '>=0.2.2-alpha.18.0 <0.2.2-alpha.19.0',
      dshGeneration: '0.2.2-rc.1',
    }

    return {
      name: '@local/workbench-editor-example',
      inject: ['slots', 'modules'],
      async apply(ctx) {
        const React = await ctx.modules.import('react', '', {})
        const Editor = createEditor(React)
        ctx.slots.inject('workbench.editor.session', () => ctx.slots.register({
          name: 'workbench.editor.session',
          id: 'workbench.example',
          label: 'Session 内页示例',
          order: 500,
          registrant: '@local/workbench-editor-example',
          inject: () => ({ workbenchEditor: {
            schemaVersion: 1,
            declaration,
            extension,
            distribution: { version: 1, portableId: 'workbench.editor-example', packageVersion: '0.1.0', packageName: '@local/workbench-editor-example', exportPolicy: 'embed', sourcePolicy: 'binary-only', provides: { editorIds: ['workbench.example'] }, requires: [], permissions: [] },
            portability: { version: 1, exportState: value => ({ schemaVersion: 1, acknowledged: value?.acknowledged === true }), importState: value => { if (value?.schemaVersion !== 1) throw new Error('Unsupported portable state'); return { schemaVersion: 1, acknowledged: value.acknowledged === true } } },
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
