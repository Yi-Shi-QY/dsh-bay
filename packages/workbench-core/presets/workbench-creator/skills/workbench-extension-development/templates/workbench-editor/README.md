# Workbench editor extension template

## 18.0 项目身份与实例生命周期

Core 兼容范围为 `>=0.2.2-alpha.18.0 <0.2.2-alpha.19.0`。模板扩展自身保留独立的 `0.1.0` 版本，不能把它误当成 Core 版本。

- 声明 `presentation.floating: false` 可禁止浮窗；缺少完整绑定及生命周期声明的内页不能在浮窗运行。
- `owner.projectId` 是项目持久身份；`owner.areaId` 只是展示位置。关闭 Area 后 Project 保留，重新打开显示概览，不自动恢复扩展内页。两个 Area 共享项目时背景和记忆共享，内页视图状态独立。全局页或 Main 可无 projectId，不能退回用 areaId 猜测。
- `owner.instanceId` 是布局内标签 ID，运行时缓存使用 `owner.runtimeIdentity`；不能跨工作台仅按标签 ID 缓存。`owner.presentation` 为 `floating` 或 `area`，位置变化不是新建实例。
- 标签从浮窗固定到 Area 保持挂载和控制器。不要把 `areaId` 变化当成新任务；仅真实绑定代际改变才释放旧绑定。异步回调必须检查当前绑定与生命周期。
- `owner.lifecycle.visibility` 变成 background/collapsed 时撤销键盘和前台交互；pause 停止 UI 轮询，keep 保留必要控制器。dispose 只允许释放能从 owner.state 恢复的视图，不能因此终止终端或底层任务。Core 会保留已登记关闭保护的视图，防止未保存内容因后台卸载丢失。
- 有未保存数据时注册 `owner.registerCloseGuard(() => boolean | Promise<boolean>)`，组件卸载时注销。返回 false 或抛错会取消关闭、工作台清理及受控退出。保存成功后才返回 true；没有接入时不具备完整防丢保障。
- 所有资源跳转使用 `owner.openConversationResource` / `owner.openNativeTab`，保留精确资源地址及导航参数。不要调用全局 sidebarRight，也不要读取全局当前 Session 猜测目标。
- 临时标签只在本客户端本次运行中保留；几何存于独立 Profile UI namespace，均不写入 PortableLayout 或分享包。正式固定后才参与布局保存和现有分发。
- 必测：两个工作台相同标签 ID、最小化和总览往返、退出再进入、固定前后 DOM/控制器一致、关闭取消、固定冲突、权限撤回和旧绑定回调。

模板兼容 DSH `0.2.2-rc.1`，锁定上游提交 `66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db`。

完整字段、生命周期、身份校验、权限和验收要求见[Workbench 容器内页扩展插件开发规范](../../WORKBENCH-CONTAINER-INNER-PAGE-EXTENSION-SPEC.zh.md)。

这是一个可安装的 DSH UI Plugin 起点。默认 `client.js` 注册一个不需要 Session 的 `workbench.editor.root` 内页，展示 Core 传入的 Area owner，并把一个小型 JSON 状态交给 Core 保存。需要跟随区域内具体对话的扩展应使用相邻 `templates/workbench-editor-variants/session-client.js` 变体：复制它覆盖 `client.js`，同时把 `package.json` 的 `scope`、`editors[].scope` 和运行时声明改成 `session`，保留 `binding.sharing: 'independent'`。这样一个区域可以有多个不同对话，每个内页只跟随 Core 传入的那个 Session。变体不放在可直接安装的模板目录中，因为 Host 会按 `runtimeFiles` 拒绝未声明的额外文件。

复制本目录到工作区后，必须同时替换以下身份：

- `package.json` 的 `name` 和版本；
- `package.json` 的 `dsh.workbench.moduleId`、版本、Core 兼容版本和 editor ID；
- `cordis.patch.yml` 的 row id 与 package name；
- `client.js` 中 `window.__ModuleLoader__.load` 的 id、编辑器 id、声明与扩展身份。
- `client.js` 返回的 DSH 插件对象必须设置 `name`，且与 `package.json.name` 和 DSH 清单中的 `moduleName` 完全一致；Slot 注册还必须显式设置同一个 `registrant`。DSH SlotCore 默认会用 Cordis Fiber 名称写入 Slot `registrant`，显式值可以避免嵌套加载时继承 `root` 等父级名称；Workbench Core 会将这个身份与 DSH 清单精确核对。

所有清单和运行时 Slot 必须使用同一组唯一 editor ID。若模块 manifest 提供 `provides.editors`，其中的 editor ID 必须与 `provides.editorIds` 完全一致；每个运行时 Slot 都要携带完整的 `extension.editorIds` 列表，而不是只写当前 Slot 的 ID。扩展声明可以在 Creator/开发工具中用 `validateWorkbenchExtensionDeclarationV1()` 校验；不要让可独立安装的 DSH 插件在运行时依赖 Core 才能启动。

DSH SlotCore 只保留其定义过的 Slot option 字段，会丢弃附加在 options 上的自定义字段。请像模板一样把声明与扩展身份放在 `inject()` 返回的 `workbenchEditor` 元数据中；Core 会从这个保留的注入面读取它们。不要把 `declaration` 或 `extension` 直接写成 Slot options。

模板在同一 metadata 中声明 `presentation.iconSvg: { version: 1, paths: [...] }`。每个内页必须有与功能对应的专属图形；模板中的笔记本只是示例，请按实际功能设计。同一扩展的多个内页也应容易区分。Core 统一绘制 24×24、无填充、主题描边的安全 SVG；只允许受限路径，不接受原始 SVG、样式、事件、颜色或图片 URL。用 `normalizeWorkbenchEditorSvgIcon()` 检查结构，并在 16/20/24px、浅色/深色、仅图标与悬停/键盘聚焦状态进行视觉验收。原有语义 token 继续兼容，旧扩展的几何回退标识不能代替新内页的图标设计。

如果内页需要当前区域的精确 Session，可以先复制 `templates/workbench-editor-variants/session-client.js` 覆盖 `client.js`，或者手动把注册目标从 `workbench.editor.root` 改为 `workbench.editor.session`，并将 `client.js` 中对应的 options 改成：

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
    binding: { requirement: 'session', unbound: 'pending', sharing: 'independent' },
    state: { schemaVersion: 1, maxBytes: 16 * 1024, restore: 'if-valid', share: 'portable' },
    runtime: { background: 'pause', collapsed: 'dispose', reacquire: 'on-visible' },
  }, extension: {
    schemaVersion: 1,
    moduleId: 'workbench.editor-example',
    apiVersion: 1,
    editorIds: ['workbench.example'],
    coreCompatibility: '>=0.2.2-alpha.18.0 <0.2.2-alpha.19.0',
    dshGeneration: '0.2.2-rc.1',
  } } }),
}, Editor))
```

即使改成 Session 内页，也只能读取 Core 传入的精确 Workspace/Session 身份；不能通过全局当前 Session 猜测绑定，也不要在打开内页时创建 Session。

声明本身的最小差异是：

```js
scope: 'session'
requiredBinding: 'session'
binding: { requirement: 'session', unbound: 'pending', sharing: 'independent' }
```

`package.json` 中的 `dsh.workbench` 声明也必须与编辑器 ID、模块身份和版本兼容条件一致。这是普通 DSH Bundle / Client Plugin 模板。它不是 Dynamic Cordis Package，也不代表 Catalog 发布或离线分享已经完成。请使用 DSH Plugin Manager 在独立测试 Profile 中安装，并分别记录 build、installed、active 等状态。


## 18.0 offline-embedded 分发

完整工作台迁移使用 V6；模板中的内页状态必须通过运行时注册暴露 `portability.exportState/importState`。旧扩展升级流程和状态 schema 迁移要求见技能与扩展规范。

本模板已包含 distribution、精确 runtimeFiles、许可证及 exportState/importState。它的 client-only Host 入口仅用于原生注册，不执行 Host 业务；若需要 Host 功能，改为 client-host 并明确权限和行为。所有 Bundle row ID 必须与其他扩展不同。`exportPolicy: 'embed'` 是扩展制品可离线嵌入的前提；Host 会按 `runtimeFiles` 生成带 digest/integrity 的制品，不能把在线 URL 或未验证目录当作离线依赖。`offline-embedded` 是扩展/布局分发模式，完整工作台迁移使用 V6 `workbench-complete`。

准备制品只收集发布清单中的文件，不打包整个工程，不运行构建命令。运行依赖须已打入产物；宿主 peer 使用精确版本。禁止安装脚本、凭据、本机路径、源码工程及会话记录。应分别测试多个后台标签的配置往返、无状态处理器、缺失依赖及错误状态。

将目录作为持久 Bundle 安装到测试 Profile 后，先验证扩展制品可被离线收集，再通过完整工作台 V6 导出验证实际嵌入与资源关系。接收方按恢复报告处理 DSH 插件安装/启用、Workbench 许可及重启注册，再验证内页状态。完整包负责根目录文件、持久 Project、原生 Session、附件、背景、记忆和任务关系；扩展制品本身不携带模型、凭据、工作台文件或 Session transcript。只导出布局与扩展不能代替完整迁移验收。

## 18.0 开发验收最小路径

```text
复制模板并替换身份
→ 选择 root 工具或 session 内页变体
→ 用 pinned DSH/Core 运行类型检查和扩展合同测试
→ prepareDistributionArtifact 验证 runtimeFiles、依赖闭包和摘要
→ 在隔离 DSH Profile 安装/启用并重启
→ 在 Workbench 明确允许扩展
→ 在一个 Area 创建至少三个独立 Session 并分别添加内页
→ 导出 V6 完整工作台包，确认包含所需离线扩展制品
→ 在干净接收环境导入，确认项目目录、Session 和内页状态恢复
```

归档检查通过只代表 `build-passed`。只有 DSH 安装、Core consent、实际注册、完整包导入和继续对话都分别通过，才可以记录为 `installed`、`active` 或 `desktop-verified`。
