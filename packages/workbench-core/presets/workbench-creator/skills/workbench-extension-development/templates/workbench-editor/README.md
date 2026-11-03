# Workbench editor extension template

模板兼容 DSH `0.2.1-rc.5`，锁定上游提交 `b830ec950faba0a46dda564be3e2d854afed94f1`。

完整字段、生命周期、身份校验、权限和验收要求见[Workbench 容器内页扩展插件开发规范](../../../../../../../../docs/WORKBENCH-CONTAINER-INNER-PAGE-EXTENSION-SPEC.zh.md)。

这是一个可安装的 DSH UI Plugin 起点。它注册一个不需要 Session 的 `workbench.editor.root` 内页，展示 Core 传入的 Area owner，并把一个小型 JSON 状态交给 Core 保存。

复制本目录到工作区后，必须同时替换以下身份：

- `package.json` 的 `name` 和版本；
- `package.json` 的 `dsh.workbench.moduleId`、版本、Core 兼容版本和 editor ID；
- `cordis.patch.yml` 的 row id 与 package name；
- `client.js` 中 `window.__ModuleLoader__.load` 的 id、编辑器 id、声明与扩展身份。
- `client.js` 返回的 DSH 插件对象必须设置 `name`，且与 `package.json.name` 和 DSH 清单中的 `moduleName` 完全一致；Slot 注册还必须显式设置同一个 `registrant`。DSH SlotCore 默认会用 Cordis Fiber 名称写入 Slot `registrant`，显式值可以避免嵌套加载时继承 `root` 等父级名称；Workbench Core 会将这个身份与 DSH 清单精确核对。

所有清单和运行时 Slot 必须使用同一组唯一 editor ID。若模块 manifest 提供 `provides.editors`，其中的 editor ID 必须与 `provides.editorIds` 完全一致；每个运行时 Slot 都要携带完整的 `extension.editorIds` 列表，而不是只写当前 Slot 的 ID。扩展声明可以在 Creator/开发工具中用 `validateWorkbenchExtensionDeclarationV1()` 校验；不要让可独立安装的 DSH 插件在运行时依赖 Core 才能启动。

DSH SlotCore 只保留其定义过的 Slot option 字段，会丢弃附加在 options 上的自定义字段。请像模板一样把声明与扩展身份放在 `inject()` 返回的 `workbenchEditor` 元数据中；Core 会从这个保留的注入面读取它们。不要把 `declaration` 或 `extension` 直接写成 Slot options。

模板也会在同一 metadata 中声明 `presentation.icon`。它必须使用 Core 支持的语义图标 token（例如 `extension`、`tool`、`browser`、`folder`）；未提供或 token 不受支持时，Workbench 会显示通用扩展图标。图标由 Core 绘制并跟随 DSH 主题，不要把 SVG、颜色值或远程图片放入声明。

如果内页需要当前区域的精确 Session，必须同时把注册目标从 `workbench.editor.root` 改为 `workbench.editor.session`，并将 `client.js` 中对应的 options 改成：

```js
ctx.slots.inject('workbench.editor.session', () => ctx.slots.register({
  name: 'workbench.editor.session',
  id: 'workbench.example',
  label: '示例内页',
  order: 500,
  registrant: '@local/workbench-editor-example',
  inject: () => ({ workbenchEditor: { schemaVersion: 1, declaration: {
    editorId: 'workbench.example',
    scope: 'session',
    label: '示例内页',
    requiredBinding: 'session',
    binding: { requirement: 'session', unbound: 'pending', sharing: 'area' },
    state: { schemaVersion: 1, maxBytes: 16 * 1024, restore: 'if-valid', share: 'portable' },
    runtime: { background: 'pause', collapsed: 'dispose', reacquire: 'on-visible' },
  }, extension: {
    schemaVersion: 1,
    moduleId: 'workbench.editor-example',
    apiVersion: 1,
    editorIds: ['workbench.example'],
    coreCompatibility: '0.2.2-alpha.17',
    dshGeneration: '0.2.1-rc.5',
  } } }),
}, Editor))
```

即使改成 Session 内页，也只能读取 Core 传入的精确 Workspace/Session 身份；不能通过全局当前 Session 猜测绑定，也不要在打开内页时创建 Session。

声明本身的最小差异是：

```js
scope: 'session'
requiredBinding: 'session'
binding: { requirement: 'session', unbound: 'pending', sharing: 'area' }
```

`package.json` 中的 `dsh.workbench` 声明也必须与编辑器 ID、模块身份和版本兼容条件一致。这是普通 DSH Bundle / Client Plugin 模板。它不是 Dynamic Cordis Package，也不代表 Catalog 发布或离线分享已经完成。请使用 DSH Plugin Manager 在独立测试 Profile 中安装，并分别记录 build、installed、active 等状态。
