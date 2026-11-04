# Workbench editor extension template

模板兼容 DSH `0.2.1-rc.5`，锁定上游提交 `b830ec950faba0a46dda564be3e2d854afed94f1`。

完整字段、生命周期、身份校验、权限和验收要求见[Workbench 容器内页扩展插件开发规范](../../WORKBENCH-CONTAINER-INNER-PAGE-EXTENSION-SPEC.zh.md)。

这是一个可安装的 DSH UI Plugin 起点。它注册一个不需要 Session 的 `workbench.editor.root` 内页，展示 Core 传入的 Area owner，并把一个小型 JSON 状态交给 Core 保存。

复制本目录到工作区后，必须同时替换以下身份：

- `package.json` 的 `name` 和版本；
- `package.json` 的 `dsh.workbench.moduleId`、版本、Core 兼容版本和 editor ID；
- `cordis.patch.yml` 的 row id 与 package name；
- `client.js` 中 `window.__ModuleLoader__.load` 的 id、编辑器 id、声明与扩展身份。
- `client.js` 返回的 DSH 插件对象必须设置 `name`，且与 `package.json.name` 和 DSH 清单中的 `moduleName` 完全一致；Slot 注册还必须显式设置同一个 `registrant`。DSH SlotCore 默认会用 Cordis Fiber 名称写入 Slot `registrant`，显式值可以避免嵌套加载时继承 `root` 等父级名称；Workbench Core 会将这个身份与 DSH 清单精确核对。

所有清单和运行时 Slot 必须使用同一组唯一 editor ID。若模块 manifest 提供 `provides.editors`，其中的 editor ID 必须与 `provides.editorIds` 完全一致；每个运行时 Slot 都要携带完整的 `extension.editorIds` 列表，而不是只写当前 Slot 的 ID。扩展声明可以在 Creator/开发工具中用 `validateWorkbenchExtensionDeclarationV1()` 校验；不要让可独立安装的 DSH 插件在运行时依赖 Core 才能启动。

DSH SlotCore 只保留其定义过的 Slot option 字段，会丢弃附加在 options 上的自定义字段。请像模板一样把声明与扩展身份放在 `inject()` 返回的 `workbenchEditor` 元数据中；Core 会从这个保留的注入面读取它们。不要把 `declaration` 或 `extension` 直接写成 Slot options。

模板在同一 metadata 中声明 `presentation.iconSvg: { version: 1, paths: [...] }`。每个内页必须有与功能对应的专属图形；模板中的笔记本只是示例，请按实际功能设计。同一扩展的多个内页也应容易区分。Core 统一绘制 24×24、无填充、主题描边的安全 SVG；只允许受限路径，不接受原始 SVG、样式、事件、颜色或图片 URL。用 `normalizeWorkbenchEditorSvgIcon()` 检查结构，并在 16/20/24px、浅色/深色、仅图标与悬停/键盘聚焦状态进行视觉验收。原有语义 token 继续兼容，旧扩展的几何回退标识不能代替新内页的图标设计。

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
    coreCompatibility: '0.2.2-alpha.17.2',
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


## 17.2 完整分发

本模板已包含 distribution、精确 runtimeFiles、许可证及 exportState/importState。它的 client-only Host 入口仅用于原生注册，不执行 Host 业务；若需要 Host 功能，改为 client-host 并明确权限和行为。所有 Bundle row ID 必须与其他扩展不同。

准备制品只收集发布清单中的文件，不打包整个工程，不运行构建命令。运行依赖须已打入产物；宿主 peer 使用精确版本。禁止安装脚本、凭据、本机路径、源码工程及会话记录。应分别测试多个后台标签的配置往返、无状态处理器、缺失依赖及错误状态。

将目录作为持久 Bundle 安装到测试 Profile 后，可在工作台分享页选择离线嵌入并准备制品；导出检查通过才会生成签名包。接收方确认后安装，重启并继续恢复。工作台授权不是 Host 代码沙箱；完整离线也不包含模型、外部服务、Session 或工作目录。
